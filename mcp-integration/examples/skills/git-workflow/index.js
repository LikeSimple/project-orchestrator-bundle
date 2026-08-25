/**
 * git-workflow Skill - 实际 CLI 实现
 *
 * 智能 commit + PR + changelog。
 * 对应 MCP Tool: commit_with_changelog / create_pull_request
 */

const { exec } = require('child_process');
const { spawnSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);
const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// Windows 下 exec/execSync 的 stdout pipe 不可靠，使用 spawnSync 直接调用
function gitExec(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', timeout: 15000 });
  if (r.status !== 0) {
    const err = r.stderr?.trim() || r.stdout?.trim() || `git ${args.join(' ')} failed`;
    throw new Error(err);
  }
  return r.stdout?.trim() || '';
}

// ============================================================
// commit - 智能 commit（Conventional Commits + changelog）
// ============================================================

async function commit({ files, message, taskId, storyId, signoff = false, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  // 2. 自动推断 type 和 scope
  let type = inferCommitType(files);
  let scope = inferScope(files, storyId);

  // 2.5 AST 增强：分析 diff 内容，更精准地推断 type 和 scope
  let diffContent = '';
  let astAnalysis = null;
  try {
    const filesStr = files.map(f => `"${f}"`).join(' ');
    await execAsync(`git add ${filesStr}`, { cwd });
    const { stdout: diffOut } = await execAsync('git diff --cached', { cwd });
    diffContent = diffOut.slice(0, 4000);
  } catch {
    // 获取 diff 失败，跳过
  }

  if (diffContent) {
    astAnalysis = await analyzeDiffAST(diffContent, cwd);
    if (astAnalysis.astEnhanced) {
      // AST 推断的 type/scope 优先级高于启发式
      if (astAnalysis.suggestedType) type = astAnalysis.suggestedType;
      if (astAnalysis.suggestedScope) scope = astAnalysis.suggestedScope;
    }
  }

  // 3. 构建完整 commit message
  let fullMessage = `${type}(${scope}): ${message}`;
  let llmEnhanced = false;
  let originalMessage = message;

  // LLM 增强：优化 commit message
  if (llm.isAvailable()) {
    try {

      const llmResult = await llm.callLLM({
        system: `你是一名资深 Git 专家，精通 Conventional Commits 规范。

请根据变更文件列表和 diff 内容，生成一条高质量的 commit message。
输出格式为 JSON：
{
  "type": "feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert",
  "scope": "影响范围（模块或功能名，小写）",
  "subject": "简短描述（50 字符以内，祈使句，首字母小写，不加句号）",
  "body": "详细说明（可选，每行 72 字符以内）",
  "breaking": false
}

要求：
1. 严格遵循 Conventional Commits v1.0.0 规范
2. type 必须从给定列表中选择
3. subject 简洁明了，准确描述变更内容
4. 如果有重大变更，breaking 设为 true
5. 基于 diff 内容推断，不要凭空猜测

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `变更文件列表：
${files.map(f => `- ${f}`).join('\n')}

用户提供的原始描述：${message}

${diffContent ? 'Diff 内容（已暂存）：\n```diff\n' + diffContent + '\n```' : ''}

请生成优化后的 commit message。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 1024,
      });

      if (llmResult.ok) {
        let improved;
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          improved = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        } catch {
          improved = null;
        }

        if (improved && improved.type && improved.subject) {
          llmEnhanced = true;
          const llmType = improved.type;
          const llmScope = improved.scope || scope;
          const llmSubject = improved.subject;

          fullMessage = `${llmType}(${llmScope}): ${llmSubject}`;
          if (improved.body) {
            fullMessage += '\n\n' + improved.body;
          }
          if (improved.breaking) {
            fullMessage = fullMessage.replace(/^(\w+\([^)]+\)):/, '$1!:');
          }

          // 保留 task/story/signer 信息
          if (taskId || storyId) {
            if (!fullMessage.includes('\n\n')) fullMessage += '\n\n';
            if (taskId) fullMessage += `Task: ${taskId}\n`;
            if (storyId) fullMessage += `Story: ${storyId}\n`;
          }
          if (signoff) fullMessage += '\nCo-authored-by: AI Agent <agent@project-orchestrator.local>';
        }
      }
    } catch {
      // 静默回退：LLM 调用失败时使用原有逻辑
      llmEnhanced = false;
    }
  }

  if (taskId || storyId) {
    if (!fullMessage.includes('\n\n')) {
      fullMessage += '\n\n';
    }
    if (taskId && !fullMessage.includes(`Task: ${taskId}`)) fullMessage += `Task: ${taskId}\n`;
    if (storyId && !fullMessage.includes(`Story: ${storyId}`)) fullMessage += `Story: ${storyId}\n`;
  }
  if (signoff && !fullMessage.includes('Co-authored-by:')) {
    fullMessage += '\nCo-authored-by: AI Agent <agent@project-orchestrator.local>';
  }

  try {
    // 4. git add + commit（使用 spawnSync 避免 Windows stdout pipe 问题）
    for (const f of files) {
      gitExec(['add', f], cwd);
    }

    gitExec(['commit', '-m', fullMessage], cwd);

    // 5. 获取 commit hash
    const hash = gitExec(['rev-parse', 'HEAD'], cwd);

    // 6. 更新 CHANGELOG.md（如果存在）
    await updateChangelog(cwd, type, scope, message, taskId, storyId);

    return {
      ok: true,
      data: {
        summary: `✅ Committed: ${fullMessage.split('\n')[0]}`,
        commitHash: hash.trim(),
        commitType: fullMessage.split('(')[0],
        scope: fullMessage.match(/\(([^)]+)\)/)?.[1] || scope,
        message: fullMessage,
        originalMessage,
        filesChanged: files,
        stdout: hash.trim(),
        astEnhanced: astAnalysis?.astEnhanced || false,
        astAnalysis: astAnalysis?.astEnhanced
          ? {
              changedFiles: astAnalysis.changedFiles,
              changedFunctions: astAnalysis.changedFunctions,
              summary: astAnalysis.summary,
            }
          : undefined,
        llmEnhanced,
        llmProvider: null,
      },
      warnings: [],
      nextActions: [
        'git log --oneline -5',
        'git push origin HEAD (when ready)',
      ],
    };
  } catch (err) {
    return {
      ok: false,
      error: `git commit failed: ${err.message?.slice(0, 300)}`,
      data: {
        llmEnhanced: false,
        llmProvider: null,
      },
      warnings: [
        'Check git config (user.name, user.email)',
        'Check if any pre-commit hooks are blocking',
      ],
      nextActions: [],
    };
  }
}

// ============================================================
// pr - 创建 Pull Request（需要 gh CLI）
// ============================================================

async function pr({ feature, base = 'main', reviewers = [], labels = [], draft = true, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const branch = `feature/${feature}`;

  try {
    // 1. 检查 gh CLI
    await execAsync('gh --version', { cwd });
  } catch {
    return {
      ok: false,
      error: 'gh CLI not installed. Install from https://cli.github.com/',
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Install gh CLI from https://cli.github.com/'],
    };
  }

  try {
    // 2. 检查当前分支
    const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd });
    const targetBranch = currentBranch.trim() || branch;

    // 3. push 当前分支
    await execAsync(`git push -u origin ${targetBranch}`, { cwd });

    // 4. 自动填充 PR 模板
    let body = await generatePRBody(feature, cwd);
    let prTitle = `feat(${feature}): implement ${feature}`;
    let prLlmEnhanced = false;

    // LLM 增强：生成更优质的 PR title 和 body
    if (llm.isAvailable()) {
      try {
        // 获取当前分支与 base 的 diff
        let diffContent = '';
        try {
          const { stdout: diffOut } = await execAsync(`git diff ${base}...HEAD`, { cwd });
          diffContent = diffOut.slice(0, 6000);
        } catch {
          // 获取 diff 失败，使用 commit log
          try {
            const { stdout: logOut } = await execAsync(`git log ${base}..HEAD --oneline`, { cwd });
            diffContent = `Commits:\n${logOut}`;
          } catch { /* 忽略 */ }
        }

        // 读取 spec 内容（如果存在）
        let specContent = '';
        const specPath = path.join(cwd, `specs/${feature}/spec.md`);
        try {
          if (fs.existsSync(specPath)) {
            specContent = fs.readFileSync(specPath, 'utf-8').slice(0, 2000);
          }
        } catch { /* 忽略 */ }

        const llmResult = await llm.callLLM({
          system: `你是一名资深技术团队负责人，擅长撰写高质量的 Pull Request 描述。

请根据 diff 内容和功能名，生成专业的 PR title 和 body。
输出格式为 JSON：
{
  "title": "PR 标题（遵循 Conventional Commits 格式，简洁明了）",
  "summary": "一段简要的变更概述（2-3 句话）",
  "changes": [
    "变更点 1",
    "变更点 2"
  ],
  "testing": "测试建议（如何验证变更）",
  "riskLevel": "low|medium|high",
  "riskDescription": "风险说明（如有）"
}

要求：
1. title 遵循 Conventional Commits 规范
2. changes 列出 3-6 个主要变更点
3. 基于实际 diff 内容，不要凭空编造
4. 语言简洁专业

只输出 JSON，不要任何解释或 markdown 标记。`,
          messages: [
            {
              role: 'user',
              content: `Feature 名称: ${feature}
Base 分支: ${base}

${specContent ? '需求规格（spec）：\n' + specContent + '\n' : ''}
${diffContent ? '代码变更（diff）：\n```diff\n' + diffContent + '\n```' : ''}

请生成专业的 PR title 和 body。`,
            },
          ],
          temperature: 0.2,
          maxTokens: 2048,
        });

        if (llmResult.ok) {
          let prContent;
          try {
            const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
            prContent = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          } catch {
            prContent = null;
          }

          if (prContent && prContent.title) {
            prLlmEnhanced = true;
            prTitle = prContent.title;

            // 用 LLM 生成的内容替换 body 中的关键部分
            let llmBody = `## 概述\n\n${prContent.summary || `实现 feature \`${feature}\``}\n\n`;

            llmBody += `## 关联\n`;
            const specPath2 = path.join(cwd, `specs/${feature}/spec.md`);
            const planPath2 = path.join(cwd, `specs/${feature}/plan.md`);
            const tasksPath2 = path.join(cwd, `specs/${feature}/tasks.md`);
            if (fs.existsSync(specPath2)) llmBody += `- Spec: \`specs/${feature}/spec.md\`\n`;
            if (fs.existsSync(planPath2)) llmBody += `- Plan: \`specs/${feature}/plan.md\`\n`;
            if (fs.existsSync(tasksPath2)) llmBody += `- Tasks: \`specs/${feature}/tasks.md\`\n`;
            llmBody += '\n';

            if (prContent.changes && prContent.changes.length) {
              llmBody += `## 主要变更\n`;
              for (const change of prContent.changes) {
                llmBody += `- ${change}\n`;
              }
              llmBody += '\n';
            }

            llmBody += `## 完成情况\n`;
            llmBody += `- [ ] 任务完成（详见 tasks.md）\n`;
            llmBody += `- [ ] 测试通过\n`;
            llmBody += `- [ ] 覆盖率达标\n\n`;

            if (prContent.testing) {
              llmBody += `## 测试建议\n${prContent.testing}\n\n`;
            }

            llmBody += `## 风险评估\n`;
            const riskBadge = prContent.riskLevel === 'low' ? '低风险'
              : prContent.riskLevel === 'medium' ? '中风险'
              : prContent.riskLevel === 'high' ? '高风险' : '未评估';
            llmBody += `- 风险等级：${riskBadge}\n`;
            if (prContent.riskDescription) {
              llmBody += `- 风险说明：${prContent.riskDescription}\n`;
            }

            body = llmBody;
          }
        }
      } catch {
        // 静默回退：LLM 调用失败时使用原有逻辑
        prLlmEnhanced = false;
      }
    }

    // 5. 创建 PR
    const reviewerArgs = reviewers.length
      ? `--reviewer ${reviewers.join(',')}`
      : '';
    const labelArgs = labels.length
      ? `--label ${labels.join(',')}`
      : '';
    const draftFlag = draft ? '--draft' : '';

    const cmd = [
      'gh pr create',
      `--base ${base}`,
      `--head ${targetBranch}`,
      `--title "${prTitle.replace(/"/g, '\\"')}"`,
      `--body "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      draftFlag,
      reviewerArgs,
      labelArgs,
    ].filter(Boolean).join(' ');

    const { stdout: prUrl } = await execAsync(cmd, { cwd });

    return {
      ok: true,
      data: {
        summary: `✅ Pull Request created`,
        prUrl: prUrl.trim(),
        prTitle,
        branch: targetBranch,
        base,
        reviewers,
        labels,
        draft,
        llmEnhanced: prLlmEnhanced,
        llmProvider: null,
      },
      warnings: [],
      nextActions: [
        'View PR in browser',
        'Request reviewers if not auto-assigned',
        'Link PR to issue',
      ],
    };
  } catch (err) {
    return {
      ok: false,
      error: `PR creation failed: ${err.message?.slice(0, 300)}`,
      data: {
        llmEnhanced: false,
        llmProvider: null,
      },
      warnings: [
        'Check gh auth status: gh auth status',
        'Check if origin remote is configured',
      ],
      nextActions: [],
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function inferCommitType(files) {
  // 所有都是测试文件 → test
  if (files.every(f => /\.(test|spec)\.[jt]sx?$/.test(f))) return 'test';
  // 所有都是文档 → docs
  if (files.every(f => /\.(md|txt|rst)$/.test(f))) return 'docs';
  // 配置文件 → chore
  if (files.every(f => /(package\.json|pom\.xml|Cargo\.toml|tsconfig)/.test(f))) return 'chore';
  // 包含 fix → fix
  if (files.some(f => /\b(fix|bug)/i.test(f))) return 'fix';
  // 默认
  return 'feat';
}

function inferScope(files, storyId) {
  if (storyId) return storyId.toLowerCase();
  if (files.some(f => f.includes('/auth/'))) return 'auth';
  if (files.some(f => f.includes('/api/'))) return 'api';
  if (files.some(f => f.includes('/components/'))) return 'ui';
  return 'core';
}

// ============================================================
// AST 增强分析：基于 diff 内容的智能 commit 推断
// ============================================================

/**
 * 使用 AST 分析 git diff 内容，提取变更的函数信息，
 * 增强 commit type 和 scope 的推断精度。
 * @param {string} diffContent - git diff --cached 输出
 * @param {string} cwd - 项目根目录
 * @returns {{astEnhanced: boolean, changedFiles: Array, changedFunctions: Array, suggestedType: string|null, suggestedScope: string|null, summary: string}}
 */
async function analyzeDiffAST(diffContent, cwd) {
  if (!diffContent || typeof diffContent !== 'string') {
    return { astEnhanced: false, changedFiles: [], changedFunctions: [], suggestedType: null, suggestedScope: null, summary: '' };
  }

  try {
    // 1. 解析 diff hunks
    const fileDiffs = ast.analyzeDiffHunks(diffContent);
    if (fileDiffs.length === 0) {
      return { astEnhanced: false, changedFiles: [], changedFunctions: [], suggestedType: null, suggestedScope: null, summary: '' };
    }

    const changedFiles = fileDiffs.map(fd => fd.file);
    const changedFunctions = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    // 2. 对每个变更的 JS/TS 文件，读取文件内容并提取函数
    for (const fd of fileDiffs) {
      const filePath = fd.file;
      if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath)) continue;

      const absPath = path.resolve(cwd, filePath);
      let code = '';
      try {
        code = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }

      // 提取文件中所有函数
      const functions = ast.extractFunctions(code);
      if (functions.length === 0) continue;

      // 找到在 diff hunks 行范围内的函数
      for (const hunk of fd.hunks) {
        for (const fn of functions) {
          if (fn.line > 0 && fn.line >= hunk.startLine && fn.line < hunk.startLine + hunk.lineCount) {
            changedFunctions.push({
              file: filePath,
              function: fn.name,
              line: fn.line,
              async: fn.async,
            });
          }
        }
        totalAdditions += hunk.additions;
        totalDeletions += hunk.deletions;
      }
    }

    // 3. 基于 AST 分析结果推断 commit type
    let suggestedType = null;
    if (changedFiles.every(f => /\.(test|spec)\.[jt]sx?$/.test(f))) {
      suggestedType = 'test';
    } else if (changedFiles.every(f => /\.(md|txt|rst)$/.test(f))) {
      suggestedType = 'docs';
    } else if (changedFiles.every(f => /(package\.json|pom\.xml|Cargo\.toml|tsconfig|\.config\.)/.test(f))) {
      suggestedType = 'chore';
    } else if (changedFunctions.some(f => /\b(fix|bug|patch|repair|hotfix)\b/i.test(f.function))) {
      suggestedType = 'fix';
    } else if (totalDeletions > totalAdditions * 2) {
      suggestedType = 'refactor';
    } else if (changedFunctions.some(f => /\b(handle|process|compute|generate|create|build)\b/i.test(f.function))) {
      suggestedType = 'feat';
    }

    // 4. 推断 scope
    let suggestedScope = null;
    if (changedFiles.some(f => f.includes('/auth/'))) suggestedScope = 'auth';
    else if (changedFiles.some(f => f.includes('/api/'))) suggestedScope = 'api';
    else if (changedFiles.some(f => f.includes('/components/'))) suggestedScope = 'ui';
    else if (changedFiles.some(f => f.includes('/utils/'))) suggestedScope = 'utils';
    else if (changedFiles.some(f => f.includes('/lib/'))) suggestedScope = 'lib';
    else if (changedFunctions.length > 0) {
      // 从变更函数名推断 scope
      const firstFn = changedFunctions[0].function;
      if (firstFn && firstFn !== '(anonymous)' && firstFn !== '(arrow)') {
        suggestedScope = firstFn.replace(/^(get|set|create|update|delete|handle)/, '').toLowerCase() || null;
        if (suggestedScope && suggestedScope.length > 0) {
          suggestedScope = suggestedScope.substring(0, 20);
        } else {
          suggestedScope = null;
        }
      }
    }

    const fnSummary = changedFunctions.length > 0
      ? `${changedFunctions.length} function(s): ${changedFunctions.slice(0, 3).map(f => f.function).join(', ')}`
      : 'no functions identified';

    return {
      astEnhanced: true,
      changedFiles,
      changedFunctions: changedFunctions.slice(0, 10),
      suggestedType,
      suggestedScope,
      summary: `${changedFiles.length} file(s), +${totalAdditions} -${totalDeletions}, ${fnSummary}`,
    };
  } catch {
    return { astEnhanced: false, changedFiles: [], changedFunctions: [], suggestedType: null, suggestedScope: null, summary: '' };
  }
}

async function updateChangelog(cwd, type, scope, message, taskId, storyId) {
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return; // 没有 changelog 不强制更新

  const date = new Date().toISOString().slice(0, 10);
  const entry = `- ${date} **${type}(${scope})**：${message}${taskId ? ` (${taskId})` : ''}${storyId ? ` [${storyId}]` : ''}`;

  const content = fs.readFileSync(changelogPath, 'utf-8');
  const lines = content.split('\n');

  // 在第一个 ## 章节下插入
  const insertIdx = lines.findIndex(l => l.startsWith('## '));
  if (insertIdx > 0) {
    lines.splice(insertIdx + 1, 0, entry);
    fs.writeFileSync(changelogPath, lines.join('\n'), 'utf-8');
  }
}

async function generatePRBody(feature, cwd) {
  // 自动生成 PR Body
  const specPath = path.join(cwd, `specs/${feature}/spec.md`);
  const planPath = path.join(cwd, `specs/${feature}/plan.md`);
  const tasksPath = path.join(cwd, `specs/${feature}/tasks.md`);

  let body = `## 概述\n\n实现 feature \`${feature}\`\n\n`;

  body += `## 关联\n`;
  if (fs.existsSync(specPath)) body += `- Spec: \`specs/${feature}/spec.md\`\n`;
  if (fs.existsSync(planPath)) body += `- Plan: \`specs/${feature}/plan.md\`\n`;
  if (fs.existsSync(tasksPath)) body += `- Tasks: \`specs/${feature}/tasks.md\`\n`;
  body += '\n';

  body += `## 完成情况\n`;
  body += `- [ ] 任务完成（详见 tasks.md）\n`;
  body += `- [ ] 测试通过\n`;
  body += `- [ ] 覆盖率达标\n\n`;

  body += `## 变更说明\n`;
  body += `- 请在此简要描述主要变更点\n\n`;

  body += `## 截图 / 演示\n`;
  body += `（如有）\n\n`;

  body += `## 风险评估\n`;
  body += `- [ ] 无风险\n`;
  body += `- [ ] 低风险（样式/文案变更）\n`;
  body += `- [ ] 中风险（业务逻辑变更）\n`;
  body += `- [ ] 高风险（核心流程/数据结构变更）\n`;

  return body;
}

// ============================================================
// summarize - 用 LLM 总结 git log / diff
// ============================================================

async function summarize({ range = 'HEAD~5..HEAD', format = 'markdown', projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 获取 git log
  let logOutput = '';
  let diffOutput = '';

  try {
    const { stdout: logOut } = await execAsync(
      `git log ${range} --oneline --no-merges`,
      { cwd }
    );
    logOutput = logOut.trim();
  } catch (err) {
    return {
      ok: false,
      error: `Failed to get git log: ${err.message?.slice(0, 200)}`,
      data: {
        llmEnhanced: false,
        llmProvider: null,
      },
      warnings: [],
      nextActions: [],
    };
  }

  // 2. 获取 diff（限制大小）
  try {
    const { stdout: diffOut } = await execAsync(
      `git diff ${range} --stat`,
      { cwd }
    );
    diffOutput = diffOut.trim().slice(0, 3000);
  } catch {
    // 获取 diff stat 失败，忽略
  }

  // 基础 fallback：直接返回原始 log
  const baseResult = {
    ok: true,
    data: {
      summary: `📋 ${logOutput.split('\n').filter(Boolean).length} commits in ${range}`,
      range,
      commitCount: logOutput.split('\n').filter(Boolean).length,
      commits: logOutput,
      diffStat: diffOutput,
      format: 'raw',
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: [],
    nextActions: [],
  };

  // 3. LLM 增强：智能总结
  if (llm.isAvailable()) {
    try {
      // 获取详细 diff 用于分析
      let detailedDiff = '';
      try {
        const { stdout: diffOut } = await execAsync(`git diff ${range}`, { cwd });
        detailedDiff = diffOut.slice(0, 8000);
      } catch { /* 忽略 */ }

      const llmResult = await llm.callLLM({
        system: `你是一名资深技术文档工程师，擅长总结代码变更。

请根据 git log 和 diff 内容，生成一份清晰的变更总结。
输出格式为 JSON：
{
  "headline": "一句话总览（不超过 30 字）",
  "highlights": [
    "亮点 1",
    "亮点 2"
  ],
  "categories": {
    "features": ["新增功能列表"],
    "fixes": ["修复列表"],
    "refactors": ["重构列表"],
    "docs": ["文档变更列表"],
    "chores": ["杂项列表"]
  },
  "impact": "影响范围说明",
  "riskLevel": "low|medium|high",
  "riskNote": "风险说明（如有）"
}

要求：
1. 基于实际内容，不要编造
2. 分类准确，符合 Conventional Commits
3. highlights 列出 3-5 个最重要的变更
4. 语言简洁专业

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `Git log 范围: ${range}

Commit 列表（oneline）：
\`\`\`
${logOutput}
\`\`\`

Diff stat：
\`\`\`
${diffOutput}
\`\`\`

${detailedDiff ? '详细 diff（节选）：\n```diff\n' + detailedDiff + '\n```' : ''}

请生成变更总结。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 2048,
      });

      if (llmResult.ok) {
        let summary;
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          summary = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        } catch {
          summary = null;
        }

        if (summary && summary.headline) {
          // 根据 format 生成不同格式的输出
          let formattedContent = '';
          if (format === 'markdown') {
            formattedContent = `# 变更总结：${summary.headline}\n\n`;
            formattedContent += `**范围**: \`${range}\`\n\n`;

            if (summary.highlights && summary.highlights.length) {
              formattedContent += `## ✨ 亮点\n\n`;
              for (const h of summary.highlights) {
                formattedContent += `- ${h}\n`;
              }
              formattedContent += '\n';
            }

            const categories = summary.categories || {};
            const catLabels = {
              features: '🚀 新增功能',
              fixes: '🐛 问题修复',
              refactors: '🔧 代码重构',
              docs: '📝 文档更新',
              chores: '📦 杂项变更',
            };
            for (const [key, label] of Object.entries(catLabels)) {
              if (categories[key] && categories[key].length) {
                formattedContent += `## ${label}\n\n`;
                for (const item of categories[key]) {
                  formattedContent += `- ${item}\n`;
                }
                formattedContent += '\n';
              }
            }

            if (summary.impact) {
              formattedContent += `## 📊 影响范围\n\n${summary.impact}\n\n`;
            }

            if (summary.riskLevel) {
              const riskBadge = summary.riskLevel === 'low' ? '🟢 低风险'
                : summary.riskLevel === 'medium' ? '🟡 中风险'
                : summary.riskLevel === 'high' ? '🔴 高风险' : '⚪ 未评估';
              formattedContent += `## ⚠️ 风险评估\n\n- 等级：${riskBadge}\n`;
              if (summary.riskNote) {
                formattedContent += `- 说明：${summary.riskNote}\n`;
              }
              formattedContent += '\n';
            }
          } else {
            formattedContent = JSON.stringify(summary, null, 2);
          }

          return {
            ok: true,
            data: {
              summary: summary.headline,
              range,
              commitCount: logOutput.split('\n').filter(Boolean).length,
              format,
              content: formattedContent,
              structured: summary,
              commits: logOutput,
              diffStat: diffOutput,
              llmEnhanced: true,
              llmProvider: llmResult.provider,
            },
            warnings: [],
            nextActions: [
              'View full diff with git diff',
              'Run /git-workflow.pr to create PR',
            ],
          };
        }
      }
    } catch {
      // 静默回退：LLM 调用失败时返回基础结果
      baseResult.data.llmEnhanced = false;
    }
  }

  return baseResult;
}

// ============================================================
// conflict - 检测和分析合并冲突
// ============================================================

function parseConflicts(fileContent) {
  const conflicts = [];
  const lines = fileContent.split('\n');
  let inConflict = false;
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('<<<<<<<')) {
      inConflict = true;
      current = { start: i + 1, ours: [], theirs: [], branch: lines[i].trim() };
    } else if (lines[i].startsWith('=======')) {
      if (current) current.theirsStart = i + 1;
    } else if (lines[i].startsWith('>>>>>>>')) {
      if (current) {
        current.end = i;
        conflicts.push(current);
      }
      inConflict = false;
      current = null;
    } else if (inConflict && current) {
      if (current.theirsStart === undefined) {
        current.ours.push(lines[i]);
      } else {
        current.theirs.push(lines[i]);
      }
    }
  }
  return conflicts;
}

function classifyConflict(ours, theirs) {
  // 空行差异 → trivial
  const oursTrimmed = ours.filter(l => l.trim()).join('\n');
  const theirsTrimmed = theirs.filter(l => l.trim()).join('\n');
  if (oursTrimmed === theirsTrimmed) return 'trivial';

  // import 顺序差异 → trivial
  const oursImports = ours.filter(l => l.match(/^\s*(import|require|from|using|include)/));
  const theirsImports = theirs.filter(l => l.match(/^\s*(import|require|from|using|include)/));
  if (oursImports.length === theirsImports.length &&
      oursImports.sort().join() === theirsImports.sort().join()) return 'trivial';

  // 注释差异 → trivial
  const oursCode = ours.filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  const theirsCode = theirs.filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
  if (oursCode === theirsCode) return 'trivial';

  // 函数签名变化 → structural
  const oursSigs = ours.filter(l => l.match(/^\s*(function|class|def|fn|public|private|protected|async|static)/));
  const theirsSigs = theirs.filter(l => l.match(/^\s*(function|class|def|fn|public|private|protected|async|static)/));
  if (oursSigs.join() !== theirsSigs.join()) return 'structural';

  // 默认 → semantic
  return 'semantic';
}

async function conflict({ projectRoot, strategy = 'manual' }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  // 2. 获取冲突文件列表
  let conflictFiles = [];
  try {
    const { stdout } = await execAsync('git diff --name-only --diff-filter=U', { cwd });
    conflictFiles = stdout.split('\n').filter(Boolean);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to detect conflict files: ${err.message?.slice(0, 300)}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  if (conflictFiles.length === 0) {
    return {
      ok: true,
      data: {
        summary: `No conflicts detected`,
        hasConflicts: false,
        conflicts: [],
        resolved: [],
        manualRequired: [],
        llmEnhanced: false,
        llmProvider: null,
      },
      warnings: [],
      nextActions: ['Working tree is clean of merge conflicts'],
    };
  }

  // 3. 提取 theirs 分支信息
  let theirsBranch = 'unknown';
  try {
    const { stdout: mergeHead } = await execAsync('git rev-parse MERGE_HEAD', { cwd });
    if (mergeHead.trim()) {
      try {
        const { stdout: branchName } = await execAsync(`git name-rev --name-only ${mergeHead.trim()}`, { cwd });
        theirsBranch = branchName.trim() || mergeHead.trim().slice(0, 7);
      } catch {
        theirsBranch = mergeHead.trim().slice(0, 7);
      }
    }
  } catch {
    // 没有 MERGE_HEAD，可能是 rebase 或其他情况
  }

  // 4. 解析每个冲突文件
  let llmEnhanced = false;
  let llmProvider = null;
  const conflicts = [];
  const resolved = [];
  const manualRequired = [];
  const counts = { trivial: 0, structural: 0, semantic: 0 };

  for (const file of conflictFiles) {
    let fileContent = '';
    try {
      fileContent = fs.readFileSync(path.join(cwd, file), 'utf-8');
    } catch {
      // 无法读取文件，跳过
      conflicts.push({
        file,
        type: 'unknown',
        oursBranch: 'HEAD',
        theirsBranch,
        conflictBlocks: [],
        suggestion: null,
        autoResolved: false,
      });
      manualRequired.push(file);
      continue;
    }

    const parsedConflicts = parseConflicts(fileContent);
    if (parsedConflicts.length === 0) {
      continue;
    }

    // 提取 ours 分支信息
    const branchMatch = parsedConflicts[0]?.branch?.match(/<<<<<<<\s+(.+)/);
    const oursBranch = branchMatch ? branchMatch[1] : 'HEAD';

    const conflictBlocks = [];
    let fileConflictType = 'trivial'; // 文件级冲突类型取最严重的

    for (const pc of parsedConflicts) {
      const type = classifyConflict(pc.ours, pc.theirs);
      counts[type]++;
      if (type === 'semantic') fileConflictType = 'semantic';
      else if (type === 'structural' && fileConflictType !== 'semantic') fileConflictType = 'structural';

      conflictBlocks.push({
        startLine: pc.start,
        endLine: pc.end,
        ours: pc.ours.join('\n'),
        theirs: pc.theirs.join('\n'),
        type,
      });
    }

    let suggestion = null;

    // 5. LLM 分析 semantic 冲突
    if (fileConflictType === 'semantic' && llm.isAvailable()) {
      try {
        const llmResult = await llm.callLLM({
          system: `你是一名资深代码合并专家，擅长分析复杂的代码冲突。

请分析冲突双方的内容，给出合并建议。
输出格式为 JSON：
{
  "suggestion": "具体的合并建议（如何组合 ours 和 theirs，保留两边的修改）",
  "riskLevel": "low|medium|high",
  "explanation": "为什么建议这样合并",
  "preferredSide": "ours|theirs|both|manual"
}

要求：
1. 基于实际代码内容分析，不要凭空猜测
2. 尽量保留两边的有效修改
3. 如果无法安全自动合并，preferredSide 设为 "manual"

只输出 JSON，不要任何解释或 markdown 标记。`,
          messages: [
            {
              role: 'user',
              content: `文件: ${file}

冲突块数量: ${conflictBlocks.length}

冲突详情:
${conflictBlocks.map((b, i) => `
--- 冲突 ${i + 1} (第 ${b.startLine}-${b.endLine} 行, 类型: ${b.type}) ---
ours (${oursBranch}):
${b.ours}

theirs (${theirsBranch}):
${b.theirs}
`).join('\n')}

请分析冲突并给出合并建议。`,
            },
          ],
          temperature: 0.2,
          maxTokens: 2048,
        });

        if (llmResult.ok) {
          try {
            const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
            suggestion = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
            llmEnhanced = true;
            llmProvider = llmResult.provider;
          } catch {
            suggestion = null;
          }
        }
      } catch {
        // 静默回退
      }
    }

    let autoResolved = false;

    // 6. 根据 strategy 自动解决 trivial 冲突
    if ((strategy === 'ours' || strategy === 'theirs') && fileConflictType === 'trivial') {
      try {
        const sideFlag = strategy === 'ours' ? '--ours' : '--theirs';
        await execAsync(`git checkout ${sideFlag} "${file}"`, { cwd });
        await execAsync(`git add "${file}"`, { cwd });
        autoResolved = true;
        resolved.push(file);
      } catch {
        // 自动解决失败
        manualRequired.push(file);
      }
    } else {
      manualRequired.push(file);
    }

    conflicts.push({
      file,
      type: fileConflictType,
      oursBranch,
      theirsBranch,
      conflictBlocks,
      suggestion,
      autoResolved,
    });
  }

  const total = conflicts.length;
  return {
    ok: true,
    data: {
      summary: `${total} conflicts detected (trivial: ${counts.trivial}, structural: ${counts.structural}, semantic: ${counts.semantic})`,
      hasConflicts: true,
      conflicts,
      resolved,
      manualRequired,
      llmEnhanced,
      llmProvider,
    },
    warnings: strategy === 'manual' && counts.trivial > 0
      ? [`${counts.trivial} trivial conflicts could be auto-resolved with strategy 'ours' or 'theirs'`]
      : [],
    nextActions: manualRequired.length > 0
      ? [
          'Edit conflicted files manually to resolve conflicts',
          'Run git add <file> after resolving each file',
          'Run git commit to complete the merge',
        ]
      : ['All conflicts resolved, run git commit to complete the merge'],
  };
}

// ============================================================
// tag - 创建 git tag（支持 LLM 生成 message）
// ============================================================

async function tag({ version, message, annotated = true, push = false, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  // 2. 验证 version 格式
  const versionPattern = /^v?\d+\.\d+\.\d+$/;
  if (!version || !versionPattern.test(version)) {
    return {
      ok: false,
      error: `Invalid version format: ${version}. Expected format: v1.0.0 or 1.0.0`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Use semantic versioning format: vMAJOR.MINOR.PATCH'],
    };
  }

  // 确保带 v 前缀
  const tagName = version.startsWith('v') ? version : `v${version}`;

  // 3. 检查 tag 是否已存在
  try {
    const { stdout } = await execAsync(`git tag -l "${tagName}"`, { cwd });
    if (stdout.trim()) {
      return {
        ok: false,
        error: `Tag ${tagName} already exists`,
        data: { llmEnhanced: false, llmProvider: null },
        warnings: [`Tag ${tagName} already exists`],
        nextActions: [
          `Delete it first: git tag -d ${tagName}`,
          `Or use a different version`,
        ],
      };
    }
  } catch {
    // 检查失败，继续
  }

  // 4. 获取最近的 commit 信息
  let commitHash = '';
  let commitMessage = '';
  try {
    const { stdout } = await execAsync('git log -1 --format="%H %s"', { cwd });
    const parts = stdout.trim().split(' ');
    commitHash = parts[0];
    commitMessage = parts.slice(1).join(' ');
  } catch {
    // 忽略
  }

  // 5. 确定 tag message
  let tagMessage = message;
  let llmEnhanced = false;
  let llmProvider = null;

  if (!tagMessage && llm.isAvailable()) {
    // LLM 生成 tag message
    try {
      // 获取最近的 commit 历史
      let commitHistory = '';
      try {
        const { stdout } = await execAsync('git log -10 --oneline', { cwd });
        commitHistory = stdout.trim();
      } catch { /* 忽略 */ }

      const llmResult = await llm.callLLM({
        system: `你是一名版本发布专家。请根据最近的 commit 历史，生成一条简洁的 git tag message。

输出格式为 JSON：
{
  "message": "简短的版本描述（一句话，50 字符以内）",
  "type": "major|minor|patch"
}

要求：
1. 基于实际 commit 内容总结
2. message 简洁明了
3. type 根据 semantic versioning 推断

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `版本号: ${tagName}

最近的 commit 历史：
${commitHistory}

请生成 tag message。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 512,
      });

      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          if (parsed.message) {
            tagMessage = parsed.message;
            llmEnhanced = true;
            llmProvider = llmResult.provider;
          }
        } catch { /* 忽略解析失败 */ }
      }
    } catch {
      // 静默回退
    }
  }

  if (!tagMessage) {
    tagMessage = commitMessage || `Release ${tagName}`;
  }

  // 6. 创建 tag
  try {
    const escapedMessage = tagMessage.replace(/"/g, '\\"');
    const tagCmd = annotated
      ? `git tag -a ${tagName} -m "${escapedMessage}"`
      : `git tag ${tagName}`;
    await execAsync(tagCmd, { cwd });

    // 7. 推送 tag
    let pushed = false;
    if (push) {
      try {
        await execAsync(`git push origin ${tagName}`, { cwd });
        pushed = true;
      } catch {
        // 推送失败
      }
    }

    return {
      ok: true,
      data: {
        summary: `Tag ${tagName} created${pushed ? ' and pushed' : ''}`,
        tag: tagName,
        message: tagMessage,
        commitHash,
        annotated,
        pushed,
        llmEnhanced,
        llmProvider,
      },
      warnings: push && !pushed ? ['Failed to push tag to remote'] : [],
      nextActions: [
        push && !pushed ? `Manually push: git push origin ${tagName}` : 'Tag created successfully',
      ],
    };
  } catch (err) {
    return {
      ok: false,
      error: `git tag failed: ${err.message?.slice(0, 300)}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [
        'Check if you have write permissions',
        'Check if the tag name is valid',
      ],
      nextActions: [],
    };
  }
}

// ============================================================
// release - 创建版本发布（changelog + tag + GitHub release）
// ============================================================

async function getLastTag(cwd) {
  try {
    const { stdout } = await execAsync('git describe --tags --abbrev=0', { cwd });
    return stdout.trim();
  } catch {
    return null; // 没有 tag
  }
}

async function updateChangelogForRelease(cwd, version, notes, commits) {
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  const date = new Date().toISOString().slice(0, 10);

  let entry = `## [${version}] - ${date}\n\n`;
  if (notes) {
    // LLM 生成的结构化 release notes
    if (notes.highlights?.length) {
      entry += `### Highlights\n\n`;
      notes.highlights.forEach(h => entry += `- ${h}\n`);
    }
    if (notes.breaking?.length) {
      entry += `\n### Breaking Changes\n\n`;
      notes.breaking.forEach(b => entry += `- ${b}\n`);
    }
    if (notes.fixes?.length) {
      entry += `\n### Bug Fixes\n\n`;
      notes.fixes.forEach(f => entry += `- ${f}\n`);
    }
  } else {
    // 原始 commit 列表
    entry += `### Commits\n\n`;
    commits.split('\n').forEach(c => { if (c.trim()) entry += `- ${c}\n`; });
  }
  entry += '\n';

  // 读取现有 CHANGELOG 或创建新的
  let content = '';
  if (fs.existsSync(changelogPath)) {
    content = fs.readFileSync(changelogPath, 'utf-8');
  } else {
    content = '# CHANGELOG\n\n';
  }

  // 在 # CHANGELOG 标题后插入
  const lines = content.split('\n');
  const insertIdx = lines.findIndex(l => l.startsWith('# '));
  if (insertIdx >= 0) {
    lines.splice(insertIdx + 2, 0, entry);
  } else {
    lines.splice(0, 0, entry);
  }
  fs.writeFileSync(changelogPath, lines.join('\n'), 'utf-8');
}

async function release({ version, projectRoot, createTag = true, pushTag = true, updateChangelog = true }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  // 2. 验证 version 格式
  const versionPattern = /^v?\d+\.\d+\.\d+$/;
  if (!version || !versionPattern.test(version)) {
    return {
      ok: false,
      error: `Invalid version format: ${version}. Expected format: v1.0.0 or 1.0.0`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Use semantic versioning format: vMAJOR.MINOR.PATCH'],
    };
  }

  const tagName = version.startsWith('v') ? version : `v${version}`;

  // 3. 获取上一个 tag
  const lastTag = await getLastTag(cwd);

  // 4. 获取 commit 历史
  let commits = '';
  try {
    const cmd = lastTag
      ? `git log ${lastTag}..HEAD --oneline --no-merges`
      : 'git log --oneline --no-merges -50';
    const { stdout } = await execAsync(cmd, { cwd });
    commits = stdout.trim();
  } catch {
    // 忽略
  }

  const commitCount = commits.split('\n').filter(Boolean).length;

  // 5. 获取 diff stat
  let diffStat = '';
  try {
    const cmd = lastTag
      ? `git diff ${lastTag}..HEAD --stat`
      : 'git diff --stat';
    const { stdout } = await execAsync(cmd, { cwd });
    diffStat = stdout.trim().slice(0, 3000);
  } catch {
    // 忽略
  }

  // 6. LLM 生成 release notes
  let releaseNotes = null;
  let llmEnhanced = false;
  let llmProvider = null;

  if (llm.isAvailable() && commitCount > 0) {
    try {
      // 获取详细 diff 用于分析
      let detailedDiff = '';
      try {
        const cmd = lastTag
          ? `git diff ${lastTag}..HEAD`
          : 'git diff';
        const { stdout } = await execAsync(cmd, { cwd });
        detailedDiff = stdout.slice(0, 8000);
      } catch { /* 忽略 */ }

      const llmResult = await llm.callLLM({
        system: `你是一名版本发布工程师，擅长撰写清晰的 release notes。

请根据 commit 历史和 diff 内容，生成结构化的 release notes。
输出格式为 JSON：
{
  "highlights": ["亮点 1", "亮点 2"],
  "breaking": ["破坏性变更 1"],
  "fixes": ["修复 1"],
  "summary": "一句话版本概述",
  "riskLevel": "low|medium|high",
  "riskNote": "风险说明"
}

要求：
1. 基于实际 commit 和 diff 内容，不要编造
2. highlights 列出 3-5 个最重要的变更
3. breaking 只包含真正的破坏性变更
4. 语言简洁专业

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `版本: ${tagName}
上一个版本: ${lastTag || '(none, initial release)'}

Commit 列表：
\`\`\`
${commits}
\`\`\`

Diff stat：
\`\`\`
${diffStat}
\`\`\`

${detailedDiff ? '详细 diff（节选）：\n```diff\n' + detailedDiff + '\n```' : ''}

请生成 release notes。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 2048,
      });

      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          releaseNotes = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          llmEnhanced = true;
          llmProvider = llmResult.provider;
        } catch {
          releaseNotes = null;
        }
      }
    } catch {
      // 静默回退
    }
  }

  // 7. 更新 CHANGELOG.md
  let changelogUpdated = false;
  if (updateChangelog) {
    try {
      await updateChangelogForRelease(cwd, tagName, releaseNotes, commits);
      changelogUpdated = true;
    } catch {
      // 更新失败
    }
  }

  // 8. 创建 git tag
  let tagCreated = false;
  let tagPushed = false;
  if (createTag) {
    const tagResult = await tag({
      version: tagName,
      message: releaseNotes?.summary || undefined,
      annotated: true,
      push: pushTag,
      projectRoot: cwd,
    });
    tagCreated = tagResult.ok;
    tagPushed = tagResult.ok && tagResult.data?.pushed;
  }

  // 9. 尝试创建 GitHub Release
  let githubRelease = null;
  try {
    await execAsync('gh --version', { cwd });
    // gh CLI 可用，尝试创建 release
    let releaseBody = '';
    if (releaseNotes) {
      releaseBody = releaseNotes.summary || '';
      if (releaseNotes.highlights?.length) {
        releaseBody += '\n\n## Highlights\n';
        releaseNotes.highlights.forEach(h => releaseBody += `- ${h}\n`);
      }
      if (releaseNotes.breaking?.length) {
        releaseBody += '\n## Breaking Changes\n';
        releaseNotes.breaking.forEach(b => releaseBody += `- ${b}\n`);
      }
      if (releaseNotes.fixes?.length) {
        releaseBody += '\n## Bug Fixes\n';
        releaseNotes.fixes.forEach(f => releaseBody += `- ${f}\n`);
      }
    } else {
      releaseBody = commits;
    }

    const escapedBody = releaseBody.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const { stdout } = await execAsync(
      `gh release create ${tagName} --title "${tagName}" --notes "${escapedBody}"`,
      { cwd }
    );
    githubRelease = stdout.trim();
  } catch {
    // gh CLI 不可用或创建失败，忽略
  }

  const warnings = [];
  if (createTag && !tagCreated) warnings.push('Failed to create git tag');
  if (createTag && pushTag && !tagPushed) warnings.push('Failed to push tag');
  if (!githubRelease) warnings.push('GitHub release not created (gh CLI not available or failed)');

  const nextActions = [];
  if (githubRelease) nextActions.push(`View release: ${githubRelease}`);
  nextActions.push('Verify the changelog is accurate');
  nextActions.push('Notify the team about the new release');

  return {
    ok: true,
    data: {
      summary: `Release ${tagName} created`,
      version: tagName,
      lastVersion: lastTag,
      commitCount,
      changelogUpdated,
      tagCreated,
      tagPushed,
      githubRelease,
      releaseNotes,
      commits,
      diffStat,
      llmEnhanced,
      llmProvider,
    },
    warnings,
    nextActions,
  };
}

// ============================================================
// branch - 创建并切换到规范命名的分支
// ============================================================

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('-');
}

async function branch({ type = 'feature', feature, taskId, description, push = false, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  // 2. 获取当前分支名
  let previousBranch = 'main';
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd });
    previousBranch = stdout.trim() || 'main';
  } catch {
    // 忽略
  }

  // 3. 确定 description（LLM 辅助：无 description 时从最近 commit 推断）
  let resolvedDescription = description;
  let llmEnhanced = false;
  let llmProvider = null;

  if (!resolvedDescription && llm.isAvailable()) {
    try {
      let commitHistory = '';
      try {
        const { stdout } = await execAsync('git log -10 --oneline', { cwd });
        commitHistory = stdout.trim();
      } catch { /* 忽略 */ }

      const llmResult = await llm.callLLM({
        system: `你是一名 Git 工作流专家。请根据最近的 commit 历史推断当前正在进行的特性描述。

输出格式为 JSON：
{
  "description": "简短的特性描述（3-6 个英文单词，便于生成分支名）"
}

要求：
1. 基于实际 commit 内容总结
2. description 简洁、使用英文
3. 只输出 JSON，不要任何解释或 markdown 标记`,
        messages: [
          {
            role: 'user',
            content: `类型: ${type}
Feature: ${feature || '(unknown)'}
TaskId: ${taskId || '(unknown)'}

最近的 commit 历史：
${commitHistory}

请推断特性描述。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 256,
      });

      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          if (parsed.description) {
            resolvedDescription = parsed.description;
            llmEnhanced = true;
            llmProvider = llmResult.provider;
          }
        } catch { /* 忽略解析失败 */ }
      }
    } catch {
      // 静默回退
    }
  }

  // 4. 构建分支名：<type>/<feature>-<taskId>-<short-desc>，无 feature/taskId 则简化为 <type>/<short-desc>
  const validTypes = ['feature', 'bugfix', 'hotfix', 'release'];
  const branchType = validTypes.includes(type) ? type : 'feature';
  const shortDesc = slugify(resolvedDescription || branchType);

  let branchName;
  if (feature && taskId) {
    branchName = `${branchType}/${feature}-${taskId}-${shortDesc}`;
  } else {
    branchName = `${branchType}/${shortDesc}`;
  }

  // 5. 检查分支是否已存在
  try {
    const { stdout } = await execAsync(`git branch -l "${branchName}"`, { cwd });
    if (stdout.trim()) {
      return {
        ok: false,
        error: `Branch ${branchName} already exists`,
        data: {
          branch: branchName,
          type: branchType,
          feature,
          taskId,
          pushed: false,
          previousBranch,
          llmEnhanced,
          llmProvider,
        },
        warnings: [`Branch ${branchName} already exists`],
        nextActions: [
          `Switch to it: git checkout ${branchName}`,
          `Or delete it: git branch -D ${branchName}`,
        ],
      };
    }
  } catch {
    // 检查失败，继续
  }

  // 6. 创建并切换
  try {
    await execAsync(`git checkout -b ${branchName}`, { cwd });

    // 7. 推送（可选）
    let pushed = false;
    if (push) {
      try {
        await execAsync(`git push -u origin ${branchName}`, { cwd });
        pushed = true;
      } catch {
        // 推送失败
      }
    }

    const nextActions = ['Start working on your feature'];
    if (!push) {
      nextActions.push(`Push when ready: git push -u origin ${branchName}`);
    }

    return {
      ok: true,
      data: {
        summary: `🌿 Branch ${branchName} created${pushed ? ' and pushed' : ''}`,
        branch: branchName,
        type: branchType,
        feature,
        taskId,
        pushed,
        previousBranch,
        llmEnhanced,
        llmProvider,
      },
      warnings: push && !pushed ? ['Failed to push branch to remote'] : [],
      nextActions,
    };
  } catch (err) {
    return {
      ok: false,
      error: `git checkout -b failed: ${err.message?.slice(0, 300)}`,
      data: {
        branch: branchName,
        type: branchType,
        feature,
        taskId,
        pushed: false,
        previousBranch,
        llmEnhanced,
        llmProvider,
      },
      warnings: ['Check if the branch name is valid', 'Check if you have the required permissions'],
      nextActions: [],
    };
  }
}

// ============================================================
// merge - 合并分支（squash + PR 检查 + 删除分支）
// ============================================================

async function merge({ prNumber, branch, base = 'main', squash = true, deleteBranch = true, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  if (!branch) {
    return {
      ok: false,
      error: 'Missing required parameter: branch',
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Provide the branch name to merge'],
    };
  }

  const warnings = [];

  // 2. 检查 PR 信息（如果有 prNumber，用 gh CLI；失败优雅降级）
  let prInfo = null;
  if (prNumber) {
    try {
      await execAsync('gh --version', { cwd });
      try {
        const { stdout } = await execAsync(
          `gh pr view ${prNumber} --json state,headRefName,baseRefName,reviews,commits`,
          { cwd }
        );
        const prData = JSON.parse(stdout);
        const approved = Array.isArray(prData.reviews) &&
          prData.reviews.some(r => r.state === 'APPROVED');
        prInfo = {
          number: prNumber,
          state: prData.state,
          headRefName: prData.headRefName,
          baseRefName: prData.baseRefName,
          approved,
        };

        // PR 必须是 open
        if (prData.state !== 'OPEN') {
          return {
            ok: false,
            error: `PR #${prNumber} is not open (state: ${prData.state})`,
            data: { prInfo, llmEnhanced: false, llmProvider: null },
            warnings,
            nextActions: ['Reopen the PR or choose a different one'],
          };
        }
        // 至少 1 个 approve
        if (!approved) {
          warnings.push(`PR #${prNumber} has no approvals - consider reviewing before merge`);
        }
      } catch {
        warnings.push(`PR #${prNumber} not found or gh CLI failed - proceeding with local merge`);
      }
    } catch {
      warnings.push('gh CLI not available - skipping PR checks');
    }
  }

  // 3. 切换到 base 分支
  try {
    await execAsync(`git checkout ${base}`, { cwd });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to checkout ${base}: ${err.message?.slice(0, 300)}`,
      data: { prInfo, llmEnhanced: false, llmProvider: null },
      warnings,
      nextActions: [`Check if branch ${base} exists`],
    };
  }

  // 4. 拉取最新
  try {
    await execAsync(`git pull origin ${base}`, { cwd });
  } catch {
    warnings.push(`Failed to pull latest ${base} from remote`);
  }

  // 5. LLM 生成 merge commit message（基于 PR 描述和 commit 历史）
  let mergeCommitMessage = '';
  let llmEnhanced = false;
  let llmProvider = null;

  if (llm.isAvailable()) {
    try {
      let commitHistory = '';
      try {
        const { stdout } = await execAsync(
          `git log ${base}..${branch} --oneline --no-merges`,
          { cwd }
        );
        commitHistory = stdout.trim();
      } catch { /* 忽略 */ }

      const llmResult = await llm.callLLM({
        system: `你是一名 Git 工作流专家。请根据分支的 commit 历史，生成一条 merge commit message。

输出格式为 JSON：
{
  "message": "Merge commit message（Conventional Commits 格式，例如: feat: merge branch xxx into main）"
}

要求：
1. 基于实际 commit 内容总结
2. 遵循 Conventional Commits 规范
3. 简洁明了，一行
4. 只输出 JSON，不要任何解释或 markdown 标记`,
        messages: [
          {
            role: 'user',
            content: `分支: ${branch}
目标: ${base}
PR: ${prNumber || 'N/A'}
${prInfo ? `PR 状态: ${prInfo.state}` : ''}

commit 历史：
${commitHistory}

请生成 merge commit message。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 512,
      });

      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          if (parsed.message) {
            mergeCommitMessage = parsed.message;
            llmEnhanced = true;
            llmProvider = llmResult.provider;
          }
        } catch { /* 忽略解析失败 */ }
      }
    } catch {
      // 静默回退
    }
  }

  if (!mergeCommitMessage) {
    mergeCommitMessage = squash
      ? `chore: merge ${branch} into ${base}`
      : `Merge branch '${branch}' into ${base}`;
  }

  // 6. 合并
  let mergeCommitHash = '';
  try {
    const escapedMsg = mergeCommitMessage.replace(/"/g, '\\"');
    if (squash) {
      await execAsync(`git merge --squash ${branch}`, { cwd });
      await execAsync(`git commit -m "${escapedMsg}"`, { cwd });
    } else {
      await execAsync(`git merge ${branch} --no-ff -m "${escapedMsg}"`, { cwd });
    }

    // 获取 merge commit hash
    try {
      const { stdout } = await execAsync('git log -1 --format="%H"', { cwd });
      mergeCommitHash = stdout.trim().slice(0, 7);
    } catch { /* 忽略 */ }
  } catch (err) {
    return {
      ok: false,
      error: `Merge failed: ${err.message?.slice(0, 300)}`,
      data: {
        branch,
        base,
        squash,
        branchDeleted: false,
        pushed: false,
        prInfo,
        mergeCommit: null,
        llmEnhanced,
        llmProvider,
      },
      warnings,
      nextActions: [
        'Resolve conflicts and retry',
        `Or abort: git merge --abort`,
      ],
    };
  }

  // 7. 删除分支（可选）
  let branchDeleted = false;
  if (deleteBranch) {
    try {
      await execAsync(`git branch -D ${branch}`, { cwd });
      branchDeleted = true;
    } catch {
      warnings.push(`Failed to delete local branch ${branch}`);
    }

    // 删除远程分支（可选，失败不阻塞）
    try {
      await execAsync(`git push origin --delete ${branch}`, { cwd });
    } catch {
      warnings.push(`Failed to delete remote branch ${branch}`);
    }
  }

  // 8. 推送合并结果
  let pushed = false;
  try {
    await execAsync(`git push origin ${base}`, { cwd });
    pushed = true;
  } catch {
    warnings.push(`Failed to push ${base} to remote`);
  }

  return {
    ok: true,
    data: {
      summary: `🔀 Merged ${branch} into ${base}`,
      branch,
      base,
      squash,
      branchDeleted,
      pushed,
      prInfo,
      mergeCommit: mergeCommitHash,
      llmEnhanced,
      llmProvider,
    },
    warnings,
    nextActions: [],
  };
}

// ============================================================
// changelog - 生成 Keep a Changelog 格式的变更日志
// ============================================================

function parseConventionalCommits(log) {
  const categories = {
    features: [],
    fixes: [],
    perf: [],
    refactors: [],
    docs: [],
    tests: [],
    chores: [],
    ci: [],
    breaking: [],
  };

  for (const line of log.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]+)\s+(\w+)(\([^)]+\))?!?:\s*(.+)$/);
    if (!match) continue;

    const [, hash, type, scope, desc] = match;
    const breaking = line.includes('!');
    const entry = scope
      ? `- **${scope.slice(1, -1)}**: ${desc} (${hash.slice(0, 7)})`
      : `- ${desc} (${hash.slice(0, 7)})`;

    if (breaking) {
      categories.breaking.push(entry);
    } else {
      const catMap = {
        feat: 'features',
        fix: 'fixes',
        perf: 'perf',
        refactor: 'refactors',
        docs: 'docs',
        test: 'tests',
        chore: 'chores',
        ci: 'ci',
        build: 'chores',
        revert: 'fixes',
      };
      const cat = catMap[type] || 'chores';
      if (categories[cat]) categories[cat].push(entry);
    }
  }
  return categories;
}

function generateChangelogMd(version, date, categories) {
  let md = `## [${version}] - ${date}\n\n`;

  const labels = {
    features: '### ✨ Features',
    breaking: '### ⚠️ Breaking Changes',
    fixes: '### 🐛 Bug Fixes',
    perf: '### ⚡ Performance',
    refactors: '### ♻️ Refactors',
    docs: '### 📝 Documentation',
    tests: '### 🧪 Tests',
    chores: '### 🔧 Chores',
    ci: '### 🤖 CI/CD',
  };

  for (const [key, label] of Object.entries(labels)) {
    if (categories[key]?.length) {
      md += `${label}\n\n`;
      categories[key].forEach(e => md += `${e}\n`);
      md += '\n';
    }
  }
  return md;
}

async function changelog({ from, to = 'HEAD', output, format = 'markdown', projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检查 git 仓库
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
  } catch {
    return {
      ok: false,
      error: `Not a git repository: ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: ['Run git init to initialize a repository'],
    };
  }

  // 2. 确定 from（未指定则用最近 tag，无 tag 用第一个 commit）
  let fromRef = from;
  if (!fromRef) {
    try {
      const { stdout } = await execAsync('git describe --tags --abbrev=0', { cwd });
      fromRef = stdout.trim();
    } catch {
      // 没有 tag，用第一个 commit
      try {
        const { stdout } = await execAsync('git rev-list --max-parents=0 HEAD', { cwd });
        fromRef = stdout.trim().split('\n')[0];
      } catch {
        fromRef = 'HEAD';
      }
    }
  }

  // 3. 获取 commit 历史
  let logOutput = '';
  let commitCount = 0;
  try {
    const { stdout } = await execAsync(
      `git log ${fromRef}..${to} --format="%H %s" --no-merges`,
      { cwd }
    );
    logOutput = stdout.trim();
    commitCount = logOutput ? logOutput.split('\n').length : 0;
  } catch (err) {
    return {
      ok: false,
      error: `Failed to get commit log: ${err.message?.slice(0, 300)}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [`Check if refs ${fromRef}..${to} are valid`],
      nextActions: [],
    };
  }

  // 4. 解析 Conventional Commits
  let categories = parseConventionalCommits(logOutput);

  // 5. LLM 优化 changelog 文案（让描述更可读，添加 emoji 前缀）
  let llmEnhanced = false;
  let llmProvider = null;

  if (llm.isAvailable() && commitCount > 0) {
    try {
      const llmResult = await llm.callLLM({
        system: `你是一名技术文档专家。请优化 changelog 中的描述，使其更可读、更专业。

输出格式为 JSON：
{
  "entries": {
    "features": ["- 优化后的条目 (hash)"],
    "fixes": ["..."],
    "breaking": ["..."],
    "perf": ["..."],
    "refactors": ["..."],
    "docs": ["..."],
    "tests": ["..."],
    "chores": ["..."],
    "ci": ["..."]
  }
}

要求：
1. 保留原始的 hash 后缀 (xxxxxxx)
2. 描述更清晰、面向用户
3. 保持分类不变
4. 只输出 JSON，不要任何解释或 markdown 标记`,
        messages: [
          {
            role: 'user',
            content: `请优化以下 changelog 条目：

${JSON.stringify(categories, null, 2)}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 2048,
      });

      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          if (parsed.entries) {
            // 合并 LLM 优化结果，只替换非空分类
            for (const key of Object.keys(categories)) {
              if (Array.isArray(parsed.entries[key]) && parsed.entries[key].length) {
                categories[key] = parsed.entries[key];
              }
            }
            llmEnhanced = true;
            llmProvider = llmResult.provider;
          }
        } catch { /* 忽略解析失败 */ }
      }
    } catch {
      // 静默回退
    }
  }

  // 6. 生成 Keep a Changelog 格式 Markdown
  const versionLabel = to === 'HEAD' ? 'Unreleased' : to;
  const date = new Date().toISOString().slice(0, 10);
  let content = generateChangelogMd(versionLabel, date, categories);

  // 如果有显式 from，附加上下文
  if (from && from !== 'HEAD') {
    content = `> Comparing ${from}...${to}\n\n` + content;
  }

  // format 非 markdown 时附注（当前仅支持 markdown，保留参数以备扩展）
  if (format && format !== 'markdown') {
    content = `<!-- requested format: ${format}; only markdown is supported -->\n` + content;
  }

  // 7. 写入文件或返回内容
  let outputWritten = false;
  let outputPath = null;
  if (output) {
    try {
      const outputPathFull = path.isAbsolute(output) ? output : path.resolve(cwd, output);
      // 如果文件已存在，将新内容插入到顶部（在第一个 ## 之前）
      let existingContent = '';
      try {
        existingContent = fs.readFileSync(outputPathFull, 'utf8');
      } catch { /* 文件不存在 */ }

      if (existingContent) {
        const headerEnd = existingContent.indexOf('## [');
        if (headerEnd >= 0) {
          const newContent = existingContent.slice(0, headerEnd) + content + '\n' + existingContent.slice(headerEnd);
          fs.writeFileSync(outputPathFull, newContent, 'utf8');
        } else {
          fs.writeFileSync(outputPathFull, existingContent + '\n' + content, 'utf8');
        }
      } else {
        const header = `# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n`;
        fs.writeFileSync(outputPathFull, header + content, 'utf8');
      }
      outputWritten = true;
      outputPath = outputPathFull;
    } catch {
      // 写入失败，仍然返回内容
    }
  }

  return {
    ok: true,
    data: {
      summary: `📋 Changelog generated: ${commitCount} commits from ${fromRef} to ${to}`,
      from: fromRef,
      to,
      commitCount,
      categories,
      content,
      outputWritten,
      outputPath,
      llmEnhanced,
      llmProvider,
    },
    warnings: [],
    nextActions: [],
  };
}

module.exports = {
  // 主命令
  commit,
  pr,
  summarize,
  inferCommitType,
  inferScope,
  conflict,
  tag,
  release,

  // 分支 / 合并 / 变更日志
  branch,
  merge,
  changelog,
};