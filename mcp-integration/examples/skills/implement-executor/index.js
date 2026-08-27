/**
 * implement-executor Skill - Agent 驱动的代码实现执行器
 *
 * 完整流程：
 *   解析任务 → 读取上下文 → 调用 LLM 生成代码 → 写入文件 → 跑测试 → 标记完成
 *
 * 支持多 Provider LLM 调用（anthropic / openai / deepseek / qwen / moonshot / custom）
 * 没有 API key 时优雅降级到模板生成模式
 *
 * 命令：
 *   task       - 执行单个任务
 *   batch      - 批量执行多个任务
 *   status     - 查看任务进度（含断点恢复状态）
 *   run        - Phase 驱动编排：按 Phase 顺序执行全部任务
 *   resume     - 从上次暂停/中断的状态继续执行（断点恢复）
 *                  选项：skipFailedTasks - 跳过失败任务
 *                        fromPhase       - 从指定 Phase 开始
 *   abort      - 中止执行（选项：rollback - 自动回滚到 pre-run HEAD）
 *   rollback   - 回滚到 pre-run git HEAD 并清理状态
 *   checkpoint - 手动运行检查（test/lint/typecheck）
 *
 * 断点恢复机制（v8）：
 *   - .implement-state.json 持久化：completedTasks/failedTasks/failedTaskDetails/
 *     checkpointFailures/retryBudget/progress/tasksMdHash/originalGitHead
 *   - resume 支持 skipFailedTasks 跳过持续失败的任务
 *   - retryBudget 跟踪跨 resume 的重试次数（maxRetryBudget=9）
 *   - validateStateForResume 检测 tasks.md 和 git HEAD 变更
 *   - rollback 命令支持 git reset --hard 回滚到 pre-run 状态
 *   - status 命令显示完整暂停/失败/跳过/重试预算信息
 *
 * 对应 MCP Tools: implement_task, implement_batch, implement_status
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

const execAsync = promisify(exec);

// ============================================================
// 任务解析
// ============================================================

function parseTaskFromTasksMd(tasksContent, taskId) {
  // 匹配 "- [ ] T015 [P] [US1] [backend] 实现登录中间件 src/middleware/auth.ts"
  // [frontend]/[backend]/[shared] 为前后端协同标记（v9 新增，可选）
  const regex = new RegExp(`-\\s*\\[([ xX])\\]\\s*(${taskId})\\s*(\\[P\\])?\\s*(\\[US\\d+\\])?\\s*(\\[(?:frontend|backend|shared)\\])?\\s*(.+?)(?:\\s+([\\w\\-\\/\\.]+\\.\\w+))?$`, 'm');
  const match = regex.exec(tasksContent);
  if (!match) return null;

  return {
    id: match[2],
    done: match[1].toLowerCase() === 'x',
    parallel: !!match[3],
    storyId: match[4] || null,
    side: parseSideTag(match[5]),
    description: match[6].trim(),
    filePath: match[7] ? match[7].trim() : null,
  };
}

function extractAllTasks(tasksContent) {
  const tasks = [];
  const regex = /-\s*\[([ xX])\]\s*(T\d+)\s*(\[P\])?\s*(\[US\d+\])?\s*(\[(?:frontend|backend|shared)\])?\s*(.+?)(?:\s+([\w\-\/\.]+\.\w+))?$/gm;
  let match;
  while ((match = regex.exec(tasksContent)) !== null) {
    tasks.push({
      id: match[2],
      done: match[1].toLowerCase() === 'x',
      parallel: !!match[3],
      storyId: match[4] || null,
      side: parseSideTag(match[5]),
      description: match[6].trim(),
      filePath: match[7] ? match[7].trim() : null,
    });
  }
  return tasks;
}

/**
 * 解析 [frontend]/[backend]/[shared] 标记为 side 字段
 * @param {string|null} raw - 形如 "[frontend]" 或 null
 * @returns {'frontend'|'backend'|'shared'|null}
 */
function parseSideTag(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^\[(frontend|backend|shared)\]$/i);
  return m ? m[1].toLowerCase() : null;
}

function extractFilePath(description) {
  const match = description.match(/([\w\-\/\.]+\.(?:ts|tsx|js|jsx|vue|py|go|rs|java))\b/);
  return match ? match[1] : null;
}

function detectLanguage(filePath) {
  if (!filePath) return 'typescript';
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.vue': 'vue',
  };
  return map[ext] || 'typescript';
}

// ============================================================
// Phase 解析
// ============================================================

/**
 * 解析 tasks.md 中的 `## Phase N: 名称` 标题行，将任务按 Phase 分组。
 * 如果没有 Phase 标题，所有任务归入 Phase 0。
 * @returns {Array<{phase:number,name:string,tasks:Array,completed:boolean}>}
 */
function parsePhases(tasksContent) {
  const phases = [];
  const lines = tasksContent.split('\n');
  let currentPhase = null;
  const taskRegex = /-\s*\[([ xX])\]\s*(T\d+)\s*(\[P\])?\s*(\[US\d+\])?\s*(\[(?:frontend|backend|shared)\])?\s*(.+?)(?:\s+([\w\-\/\.]+\.\w+))?$/;

  for (const line of lines) {
    // 匹配 "## Phase N: 名称" / "## Phase N - 名称" / "## Phase N"
    const phaseMatch = line.match(/^##\s*Phase\s+(\d+)\s*[:：\-—]?\s*(.*)$/i);
    if (phaseMatch) {
      currentPhase = {
        phase: parseInt(phaseMatch[1], 10),
        name: phaseMatch[2].trim() || `Phase ${phaseMatch[1]}`,
        tasks: [],
        completed: false,
      };
      phases.push(currentPhase);
      continue;
    }

    const taskMatch = taskRegex.exec(line);
    if (taskMatch) {
      const task = {
        id: taskMatch[2],
        done: taskMatch[1].toLowerCase() === 'x',
        parallel: !!taskMatch[3],
        storyId: taskMatch[4] || null,
        side: parseSideTag(taskMatch[5]),
        description: taskMatch[6].trim(),
        filePath: taskMatch[7] ? taskMatch[7].trim() : null,
      };
      if (currentPhase) {
        currentPhase.tasks.push(task);
      } else {
        // 还没有 Phase 标题 → 归入 Phase 0
        if (phases.length === 0) {
          phases.push({ phase: 0, name: 'Default', tasks: [], completed: false });
        }
        phases[0].tasks.push(task);
      }
    }
  }

  // 计算 completed 标志
  for (const p of phases) {
    p.completed = p.tasks.length > 0 && p.tasks.every(t => t.done);
  }

  return phases;
}

// ============================================================
// 上下文收集
// ============================================================

async function collectContext(task, cwd) {
  const context = {
    codePatterns: '',
    existingCode: '',
    specContent: '',
    projectTechStack: detectTechStack(cwd),
    existingCodeAnalysis: null, // AST 分析结果
  };

  // 1. code-patterns
  const patternsPath = path.join(cwd, '.code-patterns.yaml');
  try {
    context.codePatterns = await fs.readFile(patternsPath, 'utf-8');
  } catch {
    // 没有则跳过
  }

  // 2. 现有代码（如果文件已存在）
  if (task.filePath) {
    const fullPath = path.resolve(cwd, task.filePath);
    try {
      context.existingCode = await fs.readFile(fullPath, 'utf-8');
      // AST 增强：分析现有代码结构（失败则为 null，不影响主流程）
      context.existingCodeAnalysis = analyzeCodeWithAST(context.existingCode);
    } catch {
      // 文件不存在，跳过
    }
  }

  // 3. 规范（spec.md 摘要）
  const specPaths = [
    path.join(cwd, 'specs/spec.md'),
    path.join(cwd, 'spec.md'),
    path.join(cwd, 'docs/spec.md'),
  ];
  for (const sp of specPaths) {
    try {
      const content = await fs.readFile(sp, 'utf-8');
      // 只取前 2000 字符作为上下文
      context.specContent = content.slice(0, 2000);
      break;
    } catch { /* continue */ }
  }

  return context;
}

function detectTechStack(cwd) {
  const stack = [];
  try {
    const pkg = require(path.join(cwd, 'package.json'));
    if (pkg.dependencies?.react || pkg.devDependencies?.react) stack.push('react');
    if (pkg.dependencies?.vue || pkg.devDependencies?.vue) stack.push('vue');
    if (pkg.dependencies?.next) stack.push('nextjs');
    if (pkg.dependencies?.['@nestjs/core']) stack.push('nestjs');
    if (pkg.dependencies?.express) stack.push('express');
    if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) stack.push('typescript');
    if (pkg.dependencies?.vitest || pkg.devDependencies?.vitest) stack.push('vitest');
    if (pkg.dependencies?.jest || pkg.devDependencies?.jest) stack.push('jest');
  } catch { /* not a node project */ }
  return stack;
}

// ============================================================
// AST 增强：代码分析与修改
// ============================================================

/**
 * 使用 AST 分析现有代码的结构（函数、import、export）
 * 解析成功时使用 AST，失败时返回 null（调用方应回退到原有逻辑）
 * @param {string} code - 源代码
 * @returns {object|null} 代码结构分析结果，失败返回 null
 */
function analyzeCodeWithAST(code) {
  try {
    const parsed = ast.parseJS(code);
    if (!parsed) return null;

    const functions = ast.extractFunctions(code) || [];
    const imports = ast.extractImports(code) || [];
    const exports = ast.extractExports(code) || [];
    const unusedImports = ast.detectUnusedImports(code) || [];
    const interfaceNames = ast.extractInterfaceNames(code) || [];

    return {
      available: true,
      functions,
      imports,
      exports,
      unusedImports,
      interfaceNames,
      functionCount: functions.length,
      importCount: imports.length,
      exportCount: exports.length,
    };
  } catch (e) {
    return null; // AST 分析失败，调用方回退
  }
}

/**
 * 使用 AST 安全地添加 import 声明
 * 优先使用 AST 方式，失败时回退到字符串拼接
 * @param {string} code - 源代码
 * @param {string} importPath - import 路径
 * @param {string[]} namedImports - 命名 import 列表
 * @param {string|null} defaultImport - 默认 import
 * @returns {{code: string, usedAST: boolean}} 修改后的代码和是否使用了 AST
 */
function safeAddImport(code, importPath, namedImports, defaultImport) {
  // 先尝试 AST 方式
  try {
    const parsed = ast.parseJS(code);
    if (parsed) {
      // 检查是否已存在该 import
      const existingImports = ast.extractImports(code) || [];
      const exists = existingImports.some(imp => imp.source === importPath);
      if (exists) {
        return { code, usedAST: true };
      }
      const result = ast.addImport(code, importPath, namedImports || [], defaultImport);
      if (result && result !== code) {
        return { code: result, usedAST: true };
      }
    }
  } catch (e) {
    // AST 失败，回退到字符串拼接
  }

  // 字符串拼接 fallback
  const importRegex = new RegExp(`from\\s+['"]${importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  if (importRegex.test(code)) {
    return { code, usedAST: false };
  }

  const namedPart = namedImports && namedImports.length > 0
    ? `{ ${namedImports.join(', ')} }`
    : '';
  const defaultPart = defaultImport || '';
  const parts = [defaultPart, namedPart].filter(Boolean).join(', ');
  const importStmt = `import ${parts} from '${importPath}';\n`;

  return { code: importStmt + code, usedAST: false };
}

/**
 * 使用 AST 验证代码语法是否有效
 * @param {string} code - 源代码
 * @returns {{valid: boolean, error?: string}}
 */
function validateCodeSyntax(code) {
  try {
    const parsed = ast.parseJS(code);
    if (parsed) {
      return { valid: true };
    }
    return { valid: false, error: 'Parse returned null' };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * 清理 LLM 返回的代码（去除 markdown 代码块标记）
 * 先用正则清理，再用 AST 验证，验证失败时尝试进一步清理
 * @param {string} rawCode - LLM 返回的原始代码
 * @returns {{code: string, astValid: boolean}}
 */
function cleanGeneratedCode(rawCode) {
  let code = rawCode.trim();

  // 第一步：正则清理代码块标记
  const fenceMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    code = fenceMatch[1].trim();
  }
  // 也处理只有开头或只有结尾的情况
  code = code.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');

  // 第二步：AST 验证
  const validation = validateCodeSyntax(code);
  if (validation.valid) {
    return { code, astValid: true };
  }

  // 第三步：AST 验证失败，尝试进一步清理（去除解释文字等）
  const lines = code.split('\n');
  let codeStart = 0;
  let codeEnd = lines.length - 1;

  // 从前往后找第一个 import / const / function / class / export / type 行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(import|const|let|var|function|class|export|type|interface|\/\/)\b/.test(line)) {
      codeStart = i;
      break;
    }
  }

  // 从后往前找最后一行代码
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !/^[（(]注|^以下|^希望|^请|^```/.test(line)) {
      codeEnd = i;
      break;
    }
  }

  if (codeStart > 0 || codeEnd < lines.length - 1) {
    code = lines.slice(codeStart, codeEnd + 1).join('\n').trim();
  }

  const reValidation = validateCodeSyntax(code);
  return { code, astValid: reValidation.valid };
}

// ============================================================
// 核心：生成代码（LLM + fallback）
// ============================================================

async function generateCodeForTask(task, context, previousError = null, previousCode = null) {
  const language = detectLanguage(task.filePath);
  const llmAvailable = llm.isAvailable();

  // 修复模式：有上次错误和上次代码时，改用 callLLM 发送修复请求
  if (llmAvailable && previousError && previousCode) {
    const repairSystem = '你是代码修复专家，根据测试错误修复代码。只输出修复后的完整代码，不要解释，不要 markdown 代码块标记。';
    const repairUser = `任务：${task.description}\n\n上次代码：\n${previousCode}\n\n测试错误：\n${previousError}\n\n请修复代码使其通过测试。只输出修复后的完整代码，不要解释。`;
    const repairResult = await llm.callLLM({
      system: repairSystem,
      messages: [{ role: 'user', content: repairUser }],
      temperature: 0.2,
      maxTokens: 8192,
    });
    if (repairResult.ok) {
      // AST 增强：清理并验证 LLM 返回的代码
      const cleaned = cleanGeneratedCode(repairResult.content);
      return {
        code: cleaned.code,
        source: 'llm-repair',
        provider: repairResult.provider,
        model: repairResult.model,
        usage: repairResult.usage,
        language,
        astValidated: cleaned.astValid,
      };
    }
    // 修复调用失败，fallback 到模板
    return {
      code: generateFallbackCode(task, language, context),
      source: 'fallback',
      fallbackReason: `LLM repair failed: ${repairResult.error}`,
      language,
    };
  }

  // 有 LLM 时调用 LLM
  if (llmAvailable) {
    const result = await llm.generateCode({
      taskDescription: task.description,
      codePatterns: context.codePatterns,
      existingCode: context.existingCode,
      targetFile: task.filePath || '',
      language,
      additionalContext: `
项目技术栈：${context.projectTechStack.join(', ') || '未知'}
项目规范摘要：
${context.specContent.slice(0, 500)}
`.trim(),
    });

    if (result.ok) {
      // AST 增强：清理并验证 LLM 生成的代码
      const cleaned = cleanGeneratedCode(result.code);
      return {
        code: cleaned.code,
        source: 'llm',
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        language,
        astValidated: cleaned.astValid,
      };
    }

    // LLM 调用失败，fallback 到模板，但记录警告
    return {
      code: generateFallbackCode(task, language, context),
      source: 'fallback',
      fallbackReason: result.error,
      language,
    };
  }

  // 没有 LLM，直接用模板
  return {
    code: generateFallbackCode(task, language, context),
    source: 'template',
    language,
  };
}

function generateFallbackCode(task, language, context) {
  const safeId = task.id.replace(/[^a-zA-Z0-9]/g, '_');

  if (language === 'python') {
    return `#!/usr/bin/env python3
"""
${task.description}

Task ID: ${task.id}
Generated by: implement-executor (template fallback)
Note: No LLM provider configured. This is a placeholder implementation.
"""


def ${safeId}():
    """
    ${task.description}
    """
    # TODO: Implement ${task.id}
    # Generated as placeholder because no LLM API key is configured.
    # Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or other LLM provider key for real code generation.
    return None
`;
  }

  // 默认 TypeScript
  return `/**
 * ${task.description}
 *
 * Task ID: ${task.id}
 * Generated by: implement-executor (${context.existingCode ? 'existing file modified' : 'new file'})
 *
 * NOTE: This is a ${llm.isAvailable() ? 'LLM-fallback' : 'template-fallback'} implementation.
 *       Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or other LLM provider key for real code generation.
 */

export function ${safeId}() {
  // TODO: ${task.description}
  //
  // This is a placeholder implementation.
  // To get AI-generated code, configure an LLM provider:
  //   - Set ANTHROPIC_API_KEY for Anthropic Claude
  //   - Set OPENAI_API_KEY for OpenAI GPT
  //   - Set DEEPSEEK_API_KEY for DeepSeek
  //   - Set DASHSCOPE_API_KEY for Qwen (通义千问)
  //   - Set MOONSHOT_API_KEY for Moonshot (月之暗面)
  //   - Or set LLM_BASE_URL + LLM_API_KEY + LLM_MODEL for any OpenAI-compatible API
  return null;
}

export default { ${safeId} };
`;
}

// ============================================================
// 测试运行
// ============================================================

async function runTests(cwd) {
  // 1. 先检测组合栈项目（apps/web + apps/api 同时存在 test:web/test:api 脚本）
  //    v9 新增：前后端协同项目分别跑前后端测试，单端任一失败即整体失败
  let pkg = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
  } catch { /* no package.json - 走单端逻辑 */ }

  if (pkg && pkg.scripts && pkg.scripts['test:web'] && pkg.scripts['test:api']) {
    return await runCompositeTests(cwd);
  }

  // 2. 单端项目：原有逻辑
  let testCmd = null;
  if (pkg && pkg.scripts) {
    if (pkg.scripts.test) {
      testCmd = 'npm test --silent';
    } else if (pkg.scripts['test:unit']) {
      testCmd = 'npm run test:unit --silent';
    }
  }

  if (!testCmd) {
    return { passed: true, skipped: true, reason: 'No test command found' };
  }

  try {
    const { stdout, stderr } = await execAsync(testCmd, { cwd, timeout: 60_000 });
    const output = stdout + stderr;
    const failed = /FAIL|failed|failures|✗|✘/i.test(output);
    const passed = !failed;

    return {
      passed,
      skipped: false,
      output: output.split('\n').slice(-15).join('\n'),
      command: testCmd,
    };
  } catch (err) {
    return {
      passed: false,
      skipped: false,
      error: err.message,
      output: (err.stdout || '') + (err.stderr || '').split('\n').slice(-10).join('\n'),
      command: testCmd,
    };
  }
}

/**
 * 组合栈项目测试执行器：分别跑前端 (test:web) 和后端 (test:api) 测试。
 * v9 新增：前后端协同项目的测试门禁。
 *
 * 返回结构与 runTests 一致，额外附带 sides 字段标识两端结果。
 * 任一端失败即整体 passed=false，但另一端结果仍完整保留以便诊断。
 */
async function runCompositeTests(cwd) {
  const sides = {};
  const outputs = [];
  let allPassed = true;
  let anySkipped = false;

  for (const [side, script] of [['frontend', 'test:web'], ['backend', 'test:api']]) {
    const cmd = `npm run ${script} --silent`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 90_000 });
      const output = stdout + stderr;
      const failed = /FAIL|failed|failures|✗|✘/i.test(output);
      sides[side] = {
        passed: !failed,
        skipped: false,
        command: cmd,
        output: output.split('\n').slice(-10).join('\n'),
      };
      outputs.push(`--- ${side} (${cmd}) ---\n${output.split('\n').slice(-8).join('\n')}`);
      if (failed) allPassed = false;
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      sides[side] = {
        passed: false,
        skipped: false,
        error: err.message,
        command: cmd,
        output: out.split('\n').slice(-10).join('\n'),
      };
      outputs.push(`--- ${side} (${cmd}) FAILED ---\n${out.split('\n').slice(-8).join('\n')}`);
      allPassed = false;
    }
  }

  return {
    passed: allPassed,
    skipped: anySkipped && allPassed,
    output: outputs.join('\n\n').split('\n').slice(-15).join('\n'),
    command: 'npm run test:web && npm run test:api',
    sides,
  };
}

// ============================================================
// 任务状态更新
// ============================================================

function markTaskDone(tasksContent, taskId) {
  return tasksContent.replace(
    new RegExp(`(-\\s*)\\[\\s*\\](\\s*${taskId}\\s)`, 'm'),
    '$1[x]$2'
  );
}

// ============================================================
// LLM Agent 重试循环 & Checkpoint & 状态持久化 & Git
// ============================================================

/**
 * LLM Agent 重试循环：generate → write → test，失败时把测试错误反馈给 LLM 修复，最多重试 maxRetries 次。
 * 不负责标记任务完成（由调用方处理），仅返回执行结果。
 */
async function executeTaskWithRetry(task, context, cwd, maxRetries = 3) {
  const attempts = [];
  let lastError = null;
  let lastCode = null;
  let lastCodeResult = null;
  let lastTestResult = null;

  // 补全 filePath
  if (!task.filePath) {
    task.filePath = extractFilePath(task.description);
  }

  const targetPath = task.filePath
    ? path.resolve(cwd, task.filePath)
    : path.resolve(cwd, `src/generated/${task.id}.ts`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const fileExisted = await fileExists(targetPath);

  const effectiveRetries = Math.max(maxRetries, 1);

  for (let attempt = 1; attempt <= effectiveRetries; attempt++) {
    // 生成代码（如果有上次错误，传入 previousError/previousCode 触发修复模式）
    const codeResult = await generateCodeForTask(task, context, lastError, lastCode);
    lastCode = codeResult.code;
    lastCodeResult = codeResult;

    // 写文件
    await fs.writeFile(targetPath, codeResult.code, 'utf-8');

    // 跑测试
    const testResult = await runTests(cwd);
    lastTestResult = testResult;

    if (testResult.passed || testResult.skipped) {
      return {
        success: true,
        attempts,
        attemptCount: attempt,
        codeResult,
        targetPath,
        fileExisted,
        testResult,
        lastError: null,
      };
    }

    // 收集错误输出，反馈给 LLM
    lastError = testResult.output || testResult.error || 'Unknown test failure';
    attempts.push({
      attempt,
      testResult: { passed: false, skipped: false, output: lastError },
      codeSource: codeResult.source,
    });
  }

  return {
    success: false,
    attempts,
    attemptCount: effectiveRetries,
    codeResult: lastCodeResult,
    testResult: lastTestResult,
    targetPath,
    fileExisted,
    lastError,
    lastCode,
  };
}

/**
 * 运行可选的 npm 脚本（如 lint）。脚本不存在不算失败，只算 warning/skip。
 */
async function runOptionalScript(cwd, scriptName, cmd) {
  let hasScript = false;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
    hasScript = !!pkg.scripts && !!pkg.scripts[scriptName];
  } catch { /* no package.json */ }

  if (!hasScript) {
    return { name: scriptName, passed: true, skipped: true, details: `No ${scriptName} script` };
  }

  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 60_000 });
    return { name: scriptName, passed: true, skipped: false, details: (stdout + stderr).split('\n').slice(-5).join('\n') };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    return { name: scriptName, passed: false, skipped: false, details: out.split('\n').slice(-8).join('\n') || err.message, error: err.message };
  }
}

/**
 * 运行 TypeScript 类型检查（npx tsc --noEmit），仅当 tsconfig.json 存在时。
 */
async function runTypeCheck(cwd) {
  const tsconfigExists = await fileExists(path.join(cwd, 'tsconfig.json'));
  if (!tsconfigExists) {
    return { name: 'typecheck', passed: true, skipped: true, details: 'No tsconfig.json' };
  }
  try {
    const { stdout, stderr } = await execAsync('npx tsc --noEmit', { cwd, timeout: 120_000 });
    return { name: 'typecheck', passed: true, skipped: false, details: (stdout + stderr).split('\n').slice(-5).join('\n') };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    return { name: 'typecheck', passed: false, skipped: false, details: out.split('\n').slice(-8).join('\n') || err.message, error: err.message };
  }
}

/**
 * Checkpoint 门禁：运行测试、lint、类型检查，以及（可选）Phase 完整性检查。
 * 某些检查不可用（无 lint 脚本等）不算失败，只算 warning。
 * @param {object|null} phaseInfo - { phase, name, tasks:[{id,done}] }，传入时检查 Phase 内任务是否全部完成
 * @returns {{passed:boolean, checks:Array, failures:Array}}
 */
async function runCheckpoint(cwd, phaseInfo) {
  const checks = [];
  const failures = [];

  // 1. 测试
  const testResult = await runTests(cwd);
  checks.push({
    name: 'tests',
    passed: !!(testResult.passed || testResult.skipped),
    skipped: !!testResult.skipped,
    details: testResult.skipped
      ? 'No test command'
      : (testResult.passed ? 'Tests passed' : (testResult.output || testResult.error || 'Tests failed')),
  });
  if (!testResult.passed && !testResult.skipped) {
    failures.push({ name: 'tests', details: testResult.output || testResult.error || 'Tests failed' });
  }

  // 2. lint（如果有）
  const lintResult = await runOptionalScript(cwd, 'lint', 'npm run lint --silent');
  checks.push(lintResult);
  if (!lintResult.passed && !lintResult.skipped) {
    failures.push({ name: 'lint', details: lintResult.details });
  }

  // 3. 类型检查（如果有 tsconfig.json）
  const typeResult = await runTypeCheck(cwd);
  checks.push(typeResult);
  if (!typeResult.passed && !typeResult.skipped) {
    failures.push({ name: 'typecheck', details: typeResult.details });
  }

  // 4. Phase 完整性检查
  if (phaseInfo) {
    const incomplete = (phaseInfo.tasks || []).filter(t => !t.done);
    const phaseComplete = incomplete.length === 0;
    checks.push({
      name: 'phase-completeness',
      passed: phaseComplete,
      skipped: false,
      details: phaseComplete
        ? `Phase ${phaseInfo.phase} all tasks done`
        : `${incomplete.length} task(s) incomplete: ${incomplete.map(t => t.id).join(', ')}`,
    });
    if (!phaseComplete) {
      failures.push({ name: 'phase-completeness', details: `${incomplete.length} task(s) incomplete` });
    }
  }

  const passed = failures.length === 0;
  return { passed, checks, failures };
}

/**
 * 状态持久化：写入 .implement-state.json
 */
async function saveState(cwd, state) {
  const statePath = path.join(cwd, '.implement-state.json');
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 状态持久化：读取 .implement-state.json，不存在返回 null
 */
async function loadState(cwd) {
  const statePath = path.join(cwd, '.implement-state.json');
  try {
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ============================================================
// Pipeline 断点恢复辅助函数
// ============================================================

const crypto = require('crypto');

/**
 * 计算内容的简单哈希，用于检测 tasks.md 是否变更
 */
function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

/**
 * 从 phases 和 state 计算进度统计
 */
function computeProgress(phases, state) {
  const allTasks = phases.flatMap(p => p.tasks);
  const total = allTasks.length;
  const completed = (state.completedTasks || []).filter(id =>
    allTasks.some(t => t.id === id)
  ).length;
  const failed = (state.failedTasks || []).filter(id =>
    allTasks.some(t => t.id === id)
  ).length;
  const remaining = total - completed - failed;
  return { total, completed, failed, remaining };
}

/**
 * 状态初始化：构建完整的断点恢复状态对象
 */
function createInitialState({ feature, tasksPath, tasksContent, phases, cwd, gitHead }) {
  const now = new Date().toISOString();
  return {
    feature,
    tasksPath: path.relative(cwd, tasksPath),
    tasksMdHash: hashContent(tasksContent),
    originalGitHead: gitHead,
    currentPhase: phases.length ? phases[0].phase : 0,
    totalPhases: phases.length,
    completedTasks: [],
    failedTasks: [],
    failedTaskDetails: [],
    checkpointFailures: [],
    retryBudget: {},
    maxRetryBudget: 9,
    lastCheckpoint: null,
    gitHead,
    status: 'running',
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * 兼容旧状态：补全 v8 新增字段（向后兼容 v7 状态文件）
 */
function ensureStateFields(state) {
  if (!state.failedTaskDetails) state.failedTaskDetails = [];
  if (!state.checkpointFailures) state.checkpointFailures = [];
  if (!state.retryBudget) state.retryBudget = {};
  if (state.maxRetryBudget == null) state.maxRetryBudget = 9;
  if (!state.tasksMdHash) state.tasksMdHash = null;
  if (!state.originalGitHead) state.originalGitHead = state.gitHead || null;
  return state;
}

/**
 * 记录任务失败详情到状态
 */
function recordTaskFailure(state, { taskId, error, attemptCount, phase, phaseName }) {
  if (!state.failedTaskDetails) state.failedTaskDetails = [];
  // 移除同任务的旧记录，保留最新
  state.failedTaskDetails = state.failedTaskDetails.filter(d => d.taskId !== taskId);
  state.failedTaskDetails.push({
    taskId,
    error: (error || '').slice(0, 500),
    attemptCount,
    phase,
    phaseName,
    failedAt: new Date().toISOString(),
  });
  if (!state.failedTasks.includes(taskId)) {
    state.failedTasks.push(taskId);
  }
  // 更新重试预算
  if (!state.retryBudget) state.retryBudget = {};
  state.retryBudget[taskId] = (state.retryBudget[taskId] || 0) + attemptCount;
}

/**
 * 记录 checkpoint 失败到状态
 */
function recordCheckpointFailure(state, { failures, phase, phaseName }) {
  if (!state.checkpointFailures) state.checkpointFailures = [];
  state.checkpointFailures.push({
    phase,
    phaseName,
    failures: failures.map(f => ({ name: f.name, details: (f.details || '').slice(0, 300) })),
    timestamp: new Date().toISOString(),
  });
}

/**
 * 清除任务的失败记录（任务重试或跳过时调用）
 */
function clearTaskFailure(state, taskId) {
  state.failedTasks = (state.failedTasks || []).filter(id => id !== taskId);
  state.failedTaskDetails = (state.failedTaskDetails || []).filter(d => d.taskId !== taskId);
}

/**
 * 验证状态是否仍有效（tasks.md 未被手动修改、git HEAD 未意外移动）
 */
async function validateStateForResume(state, cwd, tasksPath) {
  const warnings = [];

  // 1. 检查 tasks.md 是否被手动修改
  if (state.tasksMdHash) {
    try {
      const currentContent = await fs.readFile(tasksPath, 'utf-8');
      const currentHash = hashContent(currentContent);
      if (currentHash !== state.tasksMdHash) {
        warnings.push(`⚠️ tasks.md has been modified since the run started (hash: ${state.tasksMdHash} → ${currentHash}). Task IDs may have changed.`);
      }
    } catch { /* tasks.md may have moved */ }
  }

  // 2. 检查 git HEAD 是否意外移动
  if (state.originalGitHead) {
    try {
      const currentHead = await getGitHead(cwd);
      if (currentHead && currentHead !== state.originalGitHead) {
        warnings.push(`⚠️ Git HEAD has moved since the run started (${state.originalGitHead.slice(0, 8)} → ${currentHead.slice(0, 8)}). Completed task commits are preserved.`);
      }
    } catch { /* not a git repo */ }
  }

  return warnings;
}

/**
 * Git commit 辅助：add 指定文件并 commit。不是 git 仓库或无可提交内容时静默跳过（优雅降级）。
 */
async function gitCommit(cwd, message) {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd });
  } catch {
    return { committed: false, reason: 'Not a git repository' };
  }
  try {
    await execAsync('git add -A', { cwd });
    const { stdout } = await execAsync(`git commit -m ${JSON.stringify(message)}`, { cwd });
    const head = await getGitHead(cwd);
    return { committed: true, head, output: stdout };
  } catch (err) {
    // nothing to commit 或 hook 失败 → 优雅降级
    return { committed: false, reason: err.message };
  }
}

/**
 * 获取当前 git HEAD 短 hash
 */
async function getGitHead(cwd) {
  try {
    const { stdout } = await execAsync('git rev-parse --short HEAD', { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * 获取 git 状态（porcelain + HEAD + dirty 标志）
 */
async function getGitStatus(cwd) {
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd });
    const head = await getGitHead(cwd);
    const porcelain = stdout.trim().split('\n').filter(Boolean);
    return { head, dirty: porcelain.length > 0, porcelain };
  } catch {
    return { head: null, dirty: null, porcelain: [] };
  }
}

// ============================================================
// 命令 1: task - 执行单个任务
// ============================================================

async function implementTask({ taskId, featureId, maxRetries = 2, dryRun = false, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!taskId) {
    return { ok: false, error: 'taskId is required (e.g. "T001")', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 1. 定位 tasks.md
  const tasksPath = await findTasksPath(cwd, featureId);
  if (!tasksPath) {
    return { ok: false, error: 'tasks.md not found. Run `openspec tasks` first, or specify --featureId.', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let tasksContent;
  try {
    tasksContent = await fs.readFile(tasksPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read tasks.md: ${err.message}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 2. 解析任务
  const task = parseTaskFromTasksMd(tasksContent, taskId);
  if (!task) {
    return { ok: false, error: `Task ${taskId} not found in ${tasksPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }
  if (task.done) {
    return {
      ok: true,
      data: { summary: `ℹ️ ${taskId} is already done`, task, alreadyDone: true, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run `implement status` to see progress'],
    };
  }

  // 补全 filePath
  if (!task.filePath) {
    task.filePath = extractFilePath(task.description);
  }

  // 3. 收集上下文
  const context = await collectContext(task, cwd);

  // 4. dry-run 模式
  if (dryRun) {
    return {
      ok: true,
      data: {
        summary: `🔍 [Dry-run] Would implement ${taskId}`,
        task,
        llmAvailable: llm.isAvailable(),
        llmEnhanced: llm.isAvailable(),
        llmProvider: llm.getProviderName(),
        codePatternsLoaded: !!context.codePatterns,
        existingFileExists: !!context.existingCode,
        targetFile: task.filePath || `src/generated/${taskId}.ts`,
        language: detectLanguage(task.filePath),
        techStack: context.projectTechStack,
      },
      warnings: [],
      nextActions: ['Run without --dryRun to actually implement'],
    };
  }

  // 5. 执行任务（LLM Agent 重试循环：测试失败时反馈给 LLM 重试）
  const retryResult = await executeTaskWithRetry(task, context, cwd, Math.max(maxRetries, 1));
  const { codeResult, targetPath, fileExisted, testResult, success, lastError } = retryResult;
  const retryHistory = retryResult.attempts || [];
  const attempts = retryResult.attemptCount || (retryHistory.length + 1);

  // 6. 标记任务完成（仅在成功时）
  if (success) {
    const updatedTasks = markTaskDone(tasksContent, taskId);
    await fs.writeFile(tasksPath, updatedTasks, 'utf-8');
  }

  // 7. 返回结果
  const llmEnhanced = codeResult.source === 'llm' || codeResult.source === 'llm-repair';

  return {
    ok: success,
    data: {
      summary: buildSummary(taskId, codeResult, testResult, fileExisted),
      task,
      fileWritten: targetPath,
      fileExisted,
      codeSource: codeResult.source,
      llmEnhanced,
      llmProvider: llmEnhanced ? (codeResult.provider || llm.getProviderName()) : null,
      model: codeResult.model || null,
      usage: codeResult.usage || null,
      fallbackReason: codeResult.fallbackReason || null,
      testResult: {
        passed: testResult.passed,
        skipped: testResult.skipped,
        reason: testResult.reason || null,
        output: testResult.output || null,
      },
      attempts,
      retryHistory,
      lastError: lastError || null,
    },
    warnings: buildWarnings(codeResult, testResult),
    nextActions: buildNextActions(task, testResult, success),
  };
}

function buildSummary(taskId, codeResult, testResult, fileExisted) {
  const prefix = testResult.passed ? '✅' : testResult.skipped ? '✅' : '⚠️';
  const source = (codeResult.source === 'llm' || codeResult.source === 'llm-repair')
    ? `LLM (${codeResult.provider}/${codeResult.model})`
    : codeResult.source === 'fallback'
      ? 'fallback'
      : 'template';
  const testStatus = testResult.passed ? 'tests passed' : testResult.skipped ? 'no tests' : 'tests failed';
  const fileStatus = fileExisted ? 'modified' : 'created';

  return `${prefix} ${taskId} implemented (${source}), ${fileStatus} file, ${testStatus}`;
}

function buildWarnings(codeResult, testResult) {
  const warnings = [];
  if (codeResult.source === 'template') {
    warnings.push('No LLM provider configured — generated placeholder template. Set an API key for real code.');
  }
  if (codeResult.source === 'fallback') {
    warnings.push(`LLM call failed, fell back to template: ${codeResult.fallbackReason}`);
  }
  if (!testResult.passed && !testResult.skipped) {
    warnings.push('Tests failed — task not marked as done. Fix and retry.');
  }
  return warnings;
}

function buildNextActions(task, testResult, success) {
  const actions = [];
  if (!success) {
    actions.push(`Fix the test failures in ${task.filePath || task.id}`);
    actions.push(`Run \`implement task ${task.id}\` again to retry`);
  } else {
    actions.push('Review the generated code');
    actions.push('Run `implement status` to see overall progress');
  }
  actions.push('Run `review-checklist` for code review');
  return actions;
}

// ============================================================
// 命令 2: batch - 批量执行任务
// ============================================================

async function implementBatch({ taskIds, featureId, phase, dryRun = false, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  const tasksPath = await findTasksPath(cwd, featureId);
  if (!tasksPath) {
    return { ok: false, error: 'tasks.md not found', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const tasksContent = await fs.readFile(tasksPath, 'utf-8');
  let allTasks = extractAllTasks(tasksContent);

  // 过滤
  let targetTasks = allTasks;
  if (taskIds && taskIds.length > 0) {
    targetTasks = allTasks.filter(t => taskIds.includes(t.id));
  } else if (phase) {
    // 按 Phase 过滤（简单的启发式）
    const phaseKeywords = {
      'schema': ['schema', 'migration', 'entity', 'model', 'data model'],
      'api': ['api', 'service', 'controller', 'endpoint'],
      'ui': ['ui', 'page', 'form', 'component', 'view'],
      'test': ['test', 'testing', 'unit test'],
    };
    const keywords = phaseKeywords[phase.toLowerCase()] || [];
    targetTasks = allTasks.filter(t =>
      !t.done && keywords.some(kw => t.description.toLowerCase().includes(kw))
    );
  } else {
    // 默认：所有未完成的任务
    targetTasks = allTasks.filter(t => !t.done);
  }

  if (targetTasks.length === 0) {
    return {
      ok: true,
      data: { summary: 'ℹ️ No tasks to implement', tasks: [], completed: 0, total: 0, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  if (dryRun) {
    return {
      ok: true,
      data: {
        summary: `🔍 [Dry-run] Would implement ${targetTasks.length} task(s)`,
        tasks: targetTasks.map(t => ({ id: t.id, description: t.description, done: t.done })),
        total: targetTasks.length,
        llmAvailable: llm.isAvailable(),
        llmEnhanced: llm.isAvailable(),
        llmProvider: llm.getProviderName(),
      },
      warnings: [],
      nextActions: ['Run without --dryRun to actually implement'],
    };
  }

  // 逐个执行
  const results = [];
  let completed = 0;
  let failed = 0;

  for (const task of targetTasks) {
    if (task.done) continue;
    const result = await implementTask({
      taskId: task.id,
      featureId,
      dryRun: false,
      projectRoot: cwd,
    });
    results.push(result.data || { taskId: task.id, error: result.error });
    if (result.ok) completed++;
    else failed++;
  }

  const llmEnhanced = results.some(r => r.codeSource === 'llm');

  return {
    ok: failed === 0,
    data: {
      summary: `✅ ${completed}/${targetTasks.length} task(s) implemented${failed > 0 ? ` (${failed} failed)` : ''}`,
      results,
      completed,
      failed,
      total: targetTasks.length,
      llmEnhanced,
      llmProvider: llmEnhanced ? llm.getProviderName() : null,
    },
    warnings: failed > 0 ? [`${failed} task(s) failed`] : [],
    nextActions: [
      'Run `implement status` to see progress',
      failed > 0 ? 'Fix failed tasks and retry' : 'Run `review-checklist` for code review',
    ],
  };
}

// ============================================================
// 命令 3: status - 查看任务进度
// ============================================================

async function implementStatus({ featureId, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  const tasksPath = await findTasksPath(cwd, featureId);
  if (!tasksPath) {
    return { ok: false, error: 'tasks.md not found', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const tasksContent = await fs.readFile(tasksPath, 'utf-8');
  const tasks = extractAllTasks(tasksContent);
  const state = await loadState(cwd);

  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // 从 state 读取断点恢复信息
  const stateInfo = state ? {
    status: state.status || 'unknown',
    currentPhase: state.currentPhase,
    totalPhases: state.totalPhases,
    feature: state.feature,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    lastCheckpoint: state.lastCheckpoint,
    progress: state.progress || null,
    failedTasks: state.failedTasks || [],
    failedTaskDetails: (state.failedTaskDetails || []).map(d => ({
      taskId: d.taskId,
      error: (d.error || '').slice(0, 200),
      attemptCount: d.attemptCount,
      phase: d.phase,
      failedAt: d.failedAt,
    })),
    checkpointFailures: state.checkpointFailures || [],
    skippedTasks: state.skippedTasks || [],
    retryBudget: state.retryBudget || {},
  } : null;

  // 构建 summary
  let summary = `📊 ${done}/${total} tasks done (${progress}%)`;
  if (stateInfo) {
    const statusIcons = { running: '🔄', paused: '⏸️', completed: '✅', aborted: '⏹️', 'rolled-back': '↩️' };
    const icon = statusIcons[stateInfo.status] || '❓';
    summary = `${icon} [${stateInfo.status}] ${done}/${total} tasks done (${progress}%)`;
    if (stateInfo.failedTasks.length > 0) {
      summary += ` | ${stateInfo.failedTasks.length} failed`;
    }
    if (stateInfo.skippedTasks.length > 0) {
      summary += ` | ${stateInfo.skippedTasks.length} skipped`;
    }
  }

  const warnings = [];
  const nextActions = [];

  if (stateInfo && stateInfo.status === 'paused') {
    warnings.push(`Execution is paused at Phase ${stateInfo.currentPhase}`);
    if (stateInfo.failedTaskDetails.length > 0) {
      for (const detail of stateInfo.failedTaskDetails) {
        warnings.push(`  ${detail.taskId}: ${detail.error.slice(0, 100)}... (${detail.attemptCount} attempts)`);
      }
    }
    nextActions.push('Run `implement resume` to continue');
    if (stateInfo.failedTasks.length > 0) {
      nextActions.push('Run `implement resume --skipFailedTasks` to skip failed tasks');
      nextActions.push('Run `implement rollback` to revert to pre-run state');
    }
  } else if (stateInfo && stateInfo.status === 'aborted') {
    warnings.push('Execution was aborted');
    nextActions.push('Run `implement run` to start fresh');
    if (state.originalGitHead) {
      nextActions.push('Run `implement rollback` to revert to pre-run state');
    }
  } else if (done < total) {
    nextActions.push('Run `implement batch` to continue');
    if (stateInfo) {
      nextActions.push('Run `implement resume` to continue from pause point');
    }
  } else {
    nextActions.push('All tasks done! 🎉');
  }
  nextActions.push('Run `openspec apply` to apply the change');

  return {
    ok: true,
    data: {
      summary,
      done,
      total,
      progress,
      state: stateInfo,
      llmEnhanced: false,
      llmProvider: null,
      tasks: tasks.map(t => ({
        id: t.id,
        description: t.description,
        done: t.done,
        parallel: t.parallel,
        storyId: t.storyId,
        failed: stateInfo ? stateInfo.failedTasks.includes(t.id) : false,
      })),
    },
    warnings,
    nextActions,
  };
}

// ============================================================
// Phase 驱动编排 + 断点恢复：run / resume / abort / rollback / checkpoint / report
// ============================================================

/**
 * 生成 Markdown 格式的实现报告，写入 docs/implement/{featureId}-report.md
 */
async function generateReport(phases, state, cwd) {
  const allTasks = phases.flatMap(p => p.tasks);
  const total = allTasks.length;
  const completed = (state.completedTasks || []).length;
  const failed = (state.failedTasks || []).length;

  let md = `# Implementation Report\n\n`;
  md += `**Feature:** ${state.feature || 'unknown'}\n`;
  md += `**Status:** ${state.status || 'unknown'}\n`;
  md += `**Started:** ${state.startedAt || '-'}\n`;
  md += `**Updated:** ${state.updatedAt || '-'}\n`;
  md += `**Last Checkpoint:** ${state.lastCheckpoint || '-'}\n\n`;
  md += `## Summary\n\n`;
  md += `- Total tasks: ${total}\n`;
  md += `- Completed: ${completed}\n`;
  md += `- Failed: ${failed}\n`;
  md += `- Progress: ${total > 0 ? Math.round((completed / total) * 100) : 0}%\n\n`;
  md += `## Phases\n\n`;

  for (const p of phases) {
    const doneCount = p.tasks.filter(t => (state.completedTasks || []).includes(t.id)).length;
    const status = p.tasks.length > 0 && doneCount === p.tasks.length ? '✅' : doneCount > 0 ? '⏳' : '⬜';
    md += `### ${status} Phase ${p.phase}: ${p.name}\n`;
    md += `- Tasks: ${doneCount}/${p.tasks.length}\n\n`;
    if (p.tasks.length > 0) {
      md += `| ID | Description | Status |\n| --- | --- | --- |\n`;
      for (const t of p.tasks) {
        const st = (state.completedTasks || []).includes(t.id)
          ? '✅ done'
          : (state.failedTasks || []).includes(t.id)
            ? '❌ failed'
            : (t.done ? '✅ done' : '⬜ pending');
        md += `| ${t.id} | ${t.description} | ${st} |\n`;
      }
      md += `\n`;
    }
  }

  const reportDir = path.join(cwd, 'docs', 'implement');
  await fs.mkdir(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${state.feature || 'implementation'}-report.md`);
  await fs.writeFile(reportFile, md, 'utf-8');
  return reportFile;
}

/**
 * Phase 驱动编排：解析 Phase 列表 → 按顺序执行每个 Phase 的任务 → 每个 Phase 完成后运行 Checkpoint → 持久化状态。
 * Checkpoint 通过则进入下一 Phase；失败则暂停。每个任务执行后保存状态并 git commit。
 */
async function runPhases({ featureId, projectRoot, dryRun = false, maxRetries = 3 }) {
  const cwd = projectRoot || process.cwd();

  // 1. 定位 tasks.md
  const tasksPath = await findTasksPath(cwd, featureId);
  if (!tasksPath) {
    return { ok: false, error: 'tasks.md not found. Run `openspec tasks` first, or specify --featureId.', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let tasksContent;
  try {
    tasksContent = await fs.readFile(tasksPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read tasks.md: ${err.message}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const phases = parsePhases(tasksContent);

  // 2. 加载或初始化状态
  const now = new Date().toISOString();
  const gitHead = await getGitHead(cwd);
  let state = await loadState(cwd);
  if (!state) {
    state = createInitialState({
      feature: featureId || path.basename(path.dirname(tasksPath)),
      tasksPath, tasksContent, phases, cwd, gitHead,
    });
  } else {
    ensureStateFields(state);
    state.status = 'running';
    state.updatedAt = now;
  }

  if (phases.length === 0) {
    return {
      ok: true,
      data: { summary: 'ℹ️ No phases/tasks found in tasks.md', phases: [], state, llmEnhanced: llm.isAvailable(), llmProvider: llm.getProviderName() },
      warnings: ['tasks.md has no parseable tasks'],
      nextActions: ['Add tasks to tasks.md'],
    };
  }

  // 3. dry-run 预览
  if (dryRun) {
    return {
      ok: true,
      data: {
        summary: `🔍 [Dry-run] Would run ${phases.length} phase(s), ${phases.reduce((n, p) => n + p.tasks.length, 0)} task(s)`,
        phases: phases.map(p => ({ phase: p.phase, name: p.name, tasks: p.tasks.length, completed: p.completed })),
        state,
        llmAvailable: llm.isAvailable(),
        llmEnhanced: llm.isAvailable(),
        llmProvider: llm.getProviderName(),
        maxRetries,
      },
      warnings: [],
      nextActions: ['Run without --dryRun to execute'],
    };
  }

  const llmEnhancedFlags = [];

  // 4. 按顺序执行每个 Phase
  for (const phase of phases) {
    // 跳过已完成的 Phase
    if (phase.completed) {
      llmEnhancedFlags.push(false);
      continue;
    }
    if (state.completedTasks.length > 0 && phase.tasks.every(t => state.completedTasks.includes(t.id))) {
      state.currentPhase = phase.phase;
      continue;
    }

    // 执行 Phase 内任务
    for (const task of phase.tasks) {
      if (task.done || state.completedTasks.includes(task.id)) continue;

      // 重新读取 tasks.md（保持新鲜）
      tasksContent = await fs.readFile(tasksPath, 'utf-8');
      const freshTask = parseTaskFromTasksMd(tasksContent, task.id) || task;
      if (!freshTask.filePath) freshTask.filePath = extractFilePath(freshTask.description);

      const context = await collectContext(freshTask, cwd);
      const result = await executeTaskWithRetry(freshTask, context, cwd, maxRetries);

      if (result.success) {
        // 标记完成
        tasksContent = await fs.readFile(tasksPath, 'utf-8');
        const updated = markTaskDone(tasksContent, freshTask.id);
        await fs.writeFile(tasksPath, updated, 'utf-8');

        if (!state.completedTasks.includes(freshTask.id)) {
          state.completedTasks.push(freshTask.id);
        }
        llmEnhancedFlags.push(result.codeResult.source === 'llm' || result.codeResult.source === 'llm-repair');

        // Git commit
        await gitCommit(cwd, `feat(${freshTask.id}): ${freshTask.description}`);
      } else {
        // 任务失败 → 记录详情，保存状态，暂停执行
        recordTaskFailure(state, {
          taskId: freshTask.id,
          error: result.lastError,
          attemptCount: result.attempts.length,
          phase: phase.phase,
          phaseName: phase.name,
        });
        state.status = 'paused';
        state.progress = computeProgress(phases, state);
        state.updatedAt = new Date().toISOString();
        await saveState(cwd, state);

        return {
          ok: true,
          data: {
            summary: `⏸️ Execution paused: task ${freshTask.id} failed after ${result.attempts.length} attempt(s)`,
            phase: phase.phase,
            phaseName: phase.name,
            failedTask: freshTask.id,
            attempts: result.attempts,
            lastError: result.lastError,
            state,
            llmEnhanced: llmEnhancedFlags.some(Boolean),
            llmProvider: llm.getProviderName(),
          },
          warnings: [`Task ${freshTask.id} failed`, `Last error: ${(result.lastError || '').slice(0, 200)}`],
          nextActions: [`Fix task ${freshTask.id} and run \`implement resume\``, 'Review the test output above'],
        };
      }

      state.updatedAt = new Date().toISOString();
      state.progress = computeProgress(phases, state);
      await saveState(cwd, state);
    }

    // Phase 完成 → Checkpoint 门禁
    const phaseInfo = {
      ...phase,
      tasks: phase.tasks.map(t => ({ ...t, done: t.done || state.completedTasks.includes(t.id) })),
    };
    const checkpointResult = await runCheckpoint(cwd, phaseInfo);
    if (!checkpointResult.passed) {
      recordCheckpointFailure(state, {
        failures: checkpointResult.failures,
        phase: phase.phase,
        phaseName: phase.name,
      });
      state.status = 'paused';
      state.lastCheckpoint = new Date().toISOString();
      state.progress = computeProgress(phases, state);
      state.updatedAt = new Date().toISOString();
      await saveState(cwd, state);
      return {
        ok: true,
        data: {
          summary: `⏸️ Phase ${phase.phase} checkpoint failed`,
          phase: phase.phase,
          phaseName: phase.name,
          checkpoint: checkpointResult,
          state,
          llmEnhanced: llmEnhancedFlags.some(Boolean),
          llmProvider: llm.getProviderName(),
        },
        warnings: checkpointResult.failures.map(f => `${f.name}: ${f.details}`),
        nextActions: [`Fix checkpoint failures for Phase ${phase.phase}`, 'Run `implement resume` after fixing'],
      };
    }

    state.currentPhase = phase.phase + 1;
    state.lastCheckpoint = new Date().toISOString();
    state.progress = computeProgress(phases, state);
    state.updatedAt = new Date().toISOString();
    await saveState(cwd, state);
  }

  // 5. 全部完成
  state.status = 'completed';
  state.progress = computeProgress(phases, state);
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);

  const reportPath = await generateReport(phases, state, cwd);

  return {
    ok: true,
    data: {
      summary: '✅ All phases completed',
      phases: phases.map(p => ({
        phase: p.phase,
        name: p.name,
        tasks: p.tasks.length,
        completed: p.tasks.every(t => t.done || state.completedTasks.includes(t.id)),
      })),
      state,
      reportPath,
      llmEnhanced: llmEnhancedFlags.some(Boolean),
      llmProvider: llm.getProviderName(),
    },
    warnings: [],
    nextActions: ['Review the implementation report', 'Run `review-checklist` for code review', 'Run `git log --oneline` to see commits'],
  };
}

/**
 * resume 命令：从上次暂停/中断的状态继续执行。
 *
 * 选项：
 *   skipFailedTasks - 跳过当前失败的任务，继续执行后续任务
 *   fromPhase       - 从指定 Phase 开始执行（跳过之前的 Phase）
 *   projectRoot     - 项目根目录
 */
async function resume({ featureId, projectRoot, skipFailedTasks = false, fromPhase = null } = {}) {
  const cwd = projectRoot || process.cwd();
  const state = await loadState(cwd);
  if (!state) {
    return { ok: false, error: 'No previous state found. Run `implement run` first.', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: ['Run `implement run` to start a new execution'] };
  }
  if (state.status === 'completed') {
    return { ok: false, error: 'Execution already completed.', data: { state, llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: ['Start a new feature if needed'] };
  }
  if (state.status === 'aborted') {
    return { ok: false, error: 'Execution was aborted. Start a new run instead.', data: { state, llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: ['Run `implement run` to start fresh'] };
  }

  ensureStateFields(state);

  // 定位 tasks.md 用于状态验证
  const tasksPath = await findTasksPath(cwd, featureId || state.feature);
  const validationWarnings = tasksPath
    ? await validateStateForResume(state, cwd, tasksPath)
    : [];

  // 跳过失败任务：标记为 skipped，清除失败记录
  if (skipFailedTasks && state.failedTasks.length > 0) {
    const skipped = [...state.failedTasks];
    for (const taskId of skipped) {
      clearTaskFailure(state, taskId);
      // 标记为已完成（跳过）以防止 runPhases 再次执行
      if (!state.completedTasks.includes(taskId)) {
        state.completedTasks.push(taskId);
      }
    }
    state.skippedTasks = [...(state.skippedTasks || []), ...skipped];
    validationWarnings.push(`⏭️ Skipped failed tasks: ${skipped.join(', ')}`);
  }

  // 从指定 Phase 开始：更新 currentPhase
  if (fromPhase != null) {
    state.currentPhase = fromPhase;
    validationWarnings.push(`📍 Resuming from Phase ${fromPhase}`);
  }

  // 检查重试预算：如果失败任务已超出预算，自动跳过
  const budgetWarnings = [];
  if (!skipFailedTasks) {
    for (const detail of state.failedTaskDetails) {
      const budget = state.retryBudget[detail.taskId] || 0;
      if (budget >= state.maxRetryBudget) {
        budgetWarnings.push(
          `⚠️ Task ${detail.taskId} has exceeded retry budget (${budget}/${state.maxRetryBudget}). Use --skipFailedTasks to skip it.`
        );
      }
    }
  }

  // 保存更新后的状态
  state.status = 'running';
  state.updatedAt = new Date().toISOString();
  await saveState(cwd, state);

  // 从 state.currentPhase 继续
  const result = await runPhases({
    featureId: featureId || state.feature,
    projectRoot: cwd,
    dryRun: false,
  });

  // 合并验证 warnings
  if (result.warnings) {
    result.warnings = [...validationWarnings, ...budgetWarnings, ...result.warnings];
  } else {
    result.warnings = [...validationWarnings, ...budgetWarnings];
  }

  return result;
}

/**
 * abort 命令：中止执行，保存状态，提供回滚信息。
 *
 * 选项：
 *   rollback - 中止后自动执行 git reset 回滚到 pre-run HEAD
 */
async function abort({ featureId, reason, projectRoot, rollback = false } = {}) {
  const cwd = projectRoot || process.cwd();
  let state = await loadState(cwd);
  if (!state) {
    state = {
      feature: featureId || 'unknown',
      status: 'aborted',
      abortReason: reason || 'User aborted',
      completedTasks: [],
      failedTasks: [],
      startedAt: null,
      updatedAt: new Date().toISOString(),
    };
  } else {
    ensureStateFields(state);
    state.status = 'aborted';
    state.abortReason = reason || 'User aborted';
    state.updatedAt = new Date().toISOString();
  }
  await saveState(cwd, state);

  const gitStatus = await getGitStatus(cwd);
  const warnings = [`Aborted: ${state.abortReason}`];
  const nextActions = ['Review git status', 'Use `git reset` to rollback if needed', 'Run `implement run` to start over'];

  const data = {
    summary: '⏹️ Execution aborted',
    state,
    gitStatus,
    rollbackInfo: {
      completedTasks: state.completedTasks,
      failedTasks: state.failedTasks,
      gitHead: state.gitHead,
      originalGitHead: state.originalGitHead,
      suggestion: 'Use git reset to rollback to previous state',
    },
    llmEnhanced: false,
    llmProvider: llm.getProviderName(),
  };

  // 自动回滚
  if (rollback && state.originalGitHead) {
    const rollbackResult = await doGitRollback(cwd, state.originalGitHead);
    if (rollbackResult.rolled) {
      data.rollbackResult = rollbackResult;
      warnings.push(`🔄 Rolled back to ${state.originalGitHead.slice(0, 8)}`);
      nextActions.unshift('Review the rollback with `git log --oneline -5`');
    } else {
      warnings.push(`⚠️ Rollback failed: ${rollbackResult.reason}`);
    }
  }

  return {
    ok: true,
    data,
    warnings,
    nextActions,
  };
}

/**
 * rollback 命令：回滚到 pre-run git HEAD 并清理状态文件。
 * 仅回滚 implement-executor 产生的提交，不影响手动提交。
 */
async function rollback({ featureId, projectRoot, toHead = null } = {}) {
  const cwd = projectRoot || process.cwd();
  const state = await loadState(cwd);

  if (!state && !toHead) {
    return {
      ok: false,
      error: 'No previous state found. Cannot determine rollback target.',
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Specify --toHead=<commit-hash> or run `implement run` first'],
    };
  }

  const targetHead = toHead || (state && state.originalGitHead) || null;
  if (!targetHead) {
    return {
      ok: false,
      error: 'No originalGitHead in state. Use --toHead=<commit-hash> to specify target.',
      data: { state, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Specify --toHead=<commit-hash>'],
    };
  }

  const rollbackResult = await doGitRollback(cwd, targetHead);

  // 清理状态文件
  if (state) {
    state.status = 'rolled-back';
    state.rollbackTarget = targetHead;
    state.updatedAt = new Date().toISOString();
    await saveState(cwd, state);
  }

  return {
    ok: true,
    data: {
      summary: rollbackResult.rolled
        ? `🔄 Rolled back to ${targetHead.slice(0, 8)}`
        : `⚠️ Rollback skipped: ${rollbackResult.reason}`,
      targetHead,
      rollbackResult,
      state,
      llmEnhanced: false,
      llmProvider: llm.getProviderName(),
    },
    warnings: rollbackResult.rolled
      ? [`All commits after ${targetHead.slice(0, 8)} have been reset`]
      : [`Rollback did not execute: ${rollbackResult.reason}`],
    nextActions: rollbackResult.rolled
      ? ['Run `git log --oneline -10` to verify', 'Run `implement run` to start fresh']
      : ['Check git status manually'],
  };
}

/**
 * 执行 git rollback：git reset --hard 到指定 commit。
 * 不是 git 仓库或目标 commit 不存在时静默跳过。
 */
async function doGitRollback(cwd, targetHead) {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd });
  } catch {
    return { rolled: false, reason: 'Not a git repository' };
  }
  try {
    // 验证目标 commit 存在
    await execAsync(`git rev-parse --verify ${targetHead}`, { cwd });
  } catch {
    return { rolled: false, reason: `Commit ${targetHead} does not exist` };
  }
  try {
    await execAsync(`git reset --hard ${targetHead}`, { cwd });
    return { rolled: true, target: targetHead };
  } catch (err) {
    return { rolled: false, reason: err.message };
  }
}

/**
 * checkpoint 命令：手动运行所有检查并更新状态。
 */
async function checkpoint({ featureId, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const state = await loadState(cwd);
  const checkpointResult = await runCheckpoint(cwd, null);
  if (state) {
    state.lastCheckpoint = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    await saveState(cwd, state);
  }
  return {
    ok: true,
    data: {
      summary: checkpointResult.passed ? '✅ Checkpoint passed' : '❌ Checkpoint failed',
      passed: checkpointResult.passed,
      checks: checkpointResult.checks,
      failures: checkpointResult.failures,
      state,
      llmEnhanced: false,
      llmProvider: llm.getProviderName(),
    },
    warnings: checkpointResult.failures.map(f => `${f.name}: ${f.details}`),
    nextActions: checkpointResult.passed ? ['Continue execution'] : ['Fix the failing checks', 'Run `implement checkpoint` again'],
  };
}

// ============================================================
// 辅助函数
// ============================================================

async function findTasksPath(cwd, featureId) {
  const candidates = [];

  if (featureId) {
    candidates.push(path.join(cwd, 'specs', featureId, 'tasks.md'));
    candidates.push(path.join(cwd, 'openspec', 'changes', featureId, 'tasks.md'));
  }

  // 扫描 openspec/changes/ 下的 tasks.md
  try {
    const changesDir = path.join(cwd, 'openspec', 'changes');
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        candidates.push(path.join(changesDir, e.name, 'tasks.md'));
      }
    }
  } catch { /* ignore */ }

  candidates.push(path.join(cwd, 'specs', '001-feature', 'tasks.md'));
  candidates.push(path.join(cwd, 'tasks.md'));

  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch { /* continue */ }
  }

  return null;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  // 单任务 / 批量 / 状态（向后兼容）
  task: implementTask,
  batch: implementBatch,
  status: implementStatus,
  // 别名兼容
  implement: implementTask,
  implementBatch,
  implementStatus,
  // Phase 驱动编排 entry-points（含断点恢复）
  run: runPhases,
  runPhases,
  resume,
  checkpoint,
  abort,
  rollback,
  // AST 增强函数
  analyzeCodeWithAST,
  safeAddImport,
  validateCodeSyntax,
  cleanGeneratedCode,
  // 辅助函数导出（便于复用/测试）
  parsePhases,
  parseSideTag,
  executeTaskWithRetry,
  runCheckpoint,
  runTests,
  runCompositeTests,
  saveState,
  loadState,
  generateReport,
  gitCommit,
  getGitStatus,
  getGitHead,
  generateCodeForTask,
  // 断点恢复辅助函数
  hashContent,
  computeProgress,
  createInitialState,
  ensureStateFields,
  recordTaskFailure,
  recordCheckpointFailure,
  clearTaskFailure,
  validateStateForResume,
  doGitRollback,
};
