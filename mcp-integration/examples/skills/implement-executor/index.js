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
 *   dry-run    - 预览任务执行计划（不实际写文件）
 *   status     - 查看任务进度
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
  // 匹配 "- [ ] T015 [P] [US1] 实现登录中间件 src/middleware/auth.ts"
  const regex = new RegExp(`-\\s*\\[([ xX])\\]\\s*(${taskId})\\s*(\\[P\\])?\\s*(\\[US\\d+\\])?\\s*(.+?)(?:\\s+([\\w\\-\\/\\.]+\\.\\w+))?$`, 'm');
  const match = regex.exec(tasksContent);
  if (!match) return null;

  return {
    id: match[2],
    done: match[1].toLowerCase() === 'x',
    parallel: !!match[3],
    storyId: match[4] || null,
    description: match[5].trim(),
    filePath: match[6] ? match[6].trim() : null,
  };
}

function extractAllTasks(tasksContent) {
  const tasks = [];
  const regex = /-\s*\[([ xX])\]\s*(T\d+)\s*(\[P\])?\s*(\[US\d+\])?\s*(.+?)(?:\s+([\w\-\/\.]+\.\w+))?$/gm;
  let match;
  while ((match = regex.exec(tasksContent)) !== null) {
    tasks.push({
      id: match[2],
      done: match[1].toLowerCase() === 'x',
      parallel: !!match[3],
      storyId: match[4] || null,
      description: match[5].trim(),
      filePath: match[6] ? match[6].trim() : null,
    });
  }
  return tasks;
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
  const taskRegex = /-\s*\[([ xX])\]\s*(T\d+)\s*(\[P\])?\s*(\[US\d+\])?\s*(.+?)(?:\s+([\w\-\/\.]+\.\w+))?$/;

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
        description: taskMatch[5].trim(),
        filePath: taskMatch[6] ? taskMatch[6].trim() : null,
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
  // 尝试检测测试命令
  let testCmd = null;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
    if (pkg.scripts?.test) {
      testCmd = 'npm test --silent';
    } else if (pkg.scripts?.['test:unit']) {
      testCmd = 'npm run test:unit --silent';
    }
  } catch { /* no package.json */ }

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

  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    ok: true,
    data: {
      summary: `📊 ${done}/${total} tasks done (${progress}%)`,
      done,
      total,
      progress,
      llmEnhanced: false,
      llmProvider: null,
      tasks: tasks.map(t => ({
        id: t.id,
        description: t.description,
        done: t.done,
        parallel: t.parallel,
        storyId: t.storyId,
      })),
    },
    warnings: [],
    nextActions: [
      done < total ? `Run \`implement batch\` to continue` : 'All tasks done! 🎉',
      'Run `openspec apply` to apply the change',
    ],
  };
}

// ============================================================
// Phase 驱动编排：run / resume / abort / checkpoint / report
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
  let state = await loadState(cwd);
  if (!state) {
    state = {
      feature: featureId || path.basename(path.dirname(tasksPath)),
      tasksPath: path.relative(cwd, tasksPath),
      currentPhase: phases.length ? phases[0].phase : 0,
      totalPhases: phases.length,
      completedTasks: [],
      failedTasks: [],
      lastCheckpoint: null,
      gitHead: await getGitHead(cwd),
      status: 'running',
      startedAt: now,
      updatedAt: now,
    };
  } else {
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
        // 任务失败 → 保存状态，暂停执行
        if (!state.failedTasks.includes(freshTask.id)) {
          state.failedTasks.push(freshTask.id);
        }
        state.status = 'paused';
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
      await saveState(cwd, state);
    }

    // Phase 完成 → Checkpoint 门禁
    const phaseInfo = {
      ...phase,
      tasks: phase.tasks.map(t => ({ ...t, done: t.done || state.completedTasks.includes(t.id) })),
    };
    const checkpointResult = await runCheckpoint(cwd, phaseInfo);
    if (!checkpointResult.passed) {
      state.status = 'paused';
      state.lastCheckpoint = new Date().toISOString();
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
    state.updatedAt = new Date().toISOString();
    await saveState(cwd, state);
  }

  // 5. 全部完成
  state.status = 'completed';
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
 */
async function resume({ featureId, projectRoot }) {
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
  // 从 state.currentPhase 继续
  return await runPhases({ featureId: featureId || state.feature, projectRoot: cwd, dryRun: false });
}

/**
 * abort 命令：中止执行，保存状态，提供回滚信息。
 */
async function abort({ featureId, reason, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  let state = await loadState(cwd);
  if (!state) {
    // 如果没有状态文件，创建一个基本的 aborted 状态
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
    state.status = 'aborted';
    state.abortReason = reason || 'User aborted';
    state.updatedAt = new Date().toISOString();
  }
  await saveState(cwd, state);

  const gitStatus = await getGitStatus(cwd);

  return {
    ok: true,
    data: {
      summary: '⏹️ Execution aborted',
      state,
      gitStatus,
      rollbackInfo: {
        completedTasks: state.completedTasks,
        failedTasks: state.failedTasks,
        gitHead: state.gitHead,
        suggestion: 'Use git reset to rollback to previous state',
      },
      llmEnhanced: false,
      llmProvider: llm.getProviderName(),
    },
    warnings: [`Aborted: ${state.abortReason}`],
    nextActions: ['Review git status', 'Use `git reset` to rollback if needed', 'Run `implement run` to start over'],
  };
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
  // Phase 驱动编排 entry-points
  run: runPhases,
  runPhases,
  resume,
  checkpoint,
  abort,
  // AST 增强函数
  analyzeCodeWithAST,
  safeAddImport,
  validateCodeSyntax,
  cleanGeneratedCode,
  // 辅助函数导出（便于复用/测试）
  parsePhases,
  executeTaskWithRetry,
  runCheckpoint,
  saveState,
  loadState,
  generateReport,
  gitCommit,
  getGitStatus,
  getGitHead,
  generateCodeForTask,
};
