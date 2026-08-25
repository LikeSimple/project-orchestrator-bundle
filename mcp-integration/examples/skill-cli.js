#!/usr/bin/env node
/**
 * Skill CLI 统一入口（dist/skill-cli.js）
 *
 * 用法：
 *   node skill-cli.js <skill-name> <command> --input '<json>' --project-root <path>
 *
 * 协议：
 *   - stdout: JSON 格式结果 { ok, command, data, warnings?, nextActions? }
 *   - stderr: 日志（不影响 stdout 解析）
 *   - exit code: 0 成功, 非0 失败
 *
 * 示例：
 *   node skill-cli.js scaffold-runner run --input '{"stack":"react-vite"}'
 *   node skill-cli.js code-patterns inject --input '{"section":"naming"}'
 *   node skill-cli.js git-workflow commit --input '{"files":["src/foo.ts"],"message":"feat: foo"}'
 */

const path = require('path');

// ============================================================
// 解析 CLI 参数
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const positional = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  // 修复 PowerShell 把 JSON 折成单个参数的情况
  if (positional.length === 1 && positional[0].includes('{')) {
    // 形如 ["api-contract", "{...}"] → 拆分为 ["api-contract", "generate"] 然后取 JSON
    const idx = positional[0].indexOf('{');
    const skillName = positional[0].substring(0, idx).trim();
    const jsonPart = positional[0].substring(idx);
    positional.length = 0;
    positional.push(skillName);
    // 不预设 command，让它从 flags 或后续 args 推断
    // 简化处理：整个 positional[0] 当作 skill name + 剩余内容
  }

  return {
    skill: positional[0],
    command: positional[1],
    // 支持从命令行参数或环境变量读取 input（处理 PowerShell 引用问题）
    inputJson: flags.input || process.env.SKILL_INPUT || '{}',
    projectRoot: flags['project-root'] || process.env.PROJECT_ROOT || process.cwd(),
  };
}

// ============================================================
// 输出工具
// ============================================================

function emit(result) {
  // stdout 只能输出 JSON（被 orchestrator-tools 解析）
  process.stdout.write(JSON.stringify(result) + '\n');
}

function log(msg) {
  // stderr 用于日志（不影响 stdout 解析）
  process.stderr.write(`[skill-cli] ${msg}\n`);
}

// ============================================================
// Skill Dispatcher
// ============================================================

const handlers = {
  'scaffold-runner': () => require('./skills/scaffold-runner'),
  'code-patterns': () => require('./skills/code-patterns'),
  'git-workflow': () => require('./skills/git-workflow'),
  'ui-design': () => require('./skills/ui-design'),
  'api-contract': () => require('./skills/api-contract'),
  'spec-bootstrap': () => require('./skills/spec-bootstrap'),
  'spec-userstory-to-design': () => require('./skills/spec-userstory-to-design'),
  'html-converter': () => require('./skills/html-converter'),
  'openspec-workflow': () => require('./skills/openspec-workflow'),
  'code-patterns-extra': () => require('./skills/code-patterns'), // alias
  'implement-executor': () => require('./skills/implement-executor'),
  'test-runner': () => require('./skills/test-runner'),
  'debug-helper': () => require('./skills/debug-helper'),
  'review-checklist': () => require('./skills/review-checklist'),
  'dependency-auditor': () => require('./skills/dependency-auditor'),
  'environment-manager': () => require('./skills/environment-manager'),
};

// ============================================================
// 主入口
// ============================================================

async function main() {
  const { skill, command, inputJson, projectRoot } = parseArgs();

  if (!skill || !command) {
    emit({
      ok: false,
      command: `${skill || '?'}.${command || '?'}`,
      error: 'Usage: skill-cli <skill> <command> --input <json> --project-root <path>',
    });
    process.exit(1);
  }

  // 解析 input
  let input;
  try {
    input = JSON.parse(inputJson);
  } catch (e) {
    emit({
      ok: false,
      command: `${skill}.${command}`,
      error: `Invalid JSON in --input: ${e.message}`,
    });
    process.exit(1);
  }

  // 注入 projectRoot
  input.projectRoot = input.projectRoot || projectRoot;

  // 加载并执行 Skill
  const loader = handlers[skill];
  if (!loader) {
    emit({
      ok: false,
      command: `${skill}.${command}`,
      error: `Unknown skill: ${skill}. Available: ${Object.keys(handlers).join(', ')}`,
    });
    process.exit(1);
  }

  const startTime = Date.now();
  try {
    log(`Executing ${skill}.${command}...`);
    const skillModule = loader();
    const handler = skillModule[command];

    if (typeof handler !== 'function') {
      emit({
        ok: false,
        command: `${skill}.${command}`,
        error: `Unknown command '${command}' for skill '${skill}'. ` +
          `Available: ${Object.keys(skillModule).filter(k => typeof skillModule[k] === 'function').join(', ')}`,
      });
      process.exit(1);
    }

    const result = await handler(input);
    result.command = `${skill}.${command}`;
    result.duration = Date.now() - startTime;
    emit(result);

    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    log(`Error in ${skill}.${command}: ${err.message}`);
    log(`Stack: ${err.stack}`);
    emit({
      ok: false,
      command: `${skill}.${command}`,
      error: err.message?.slice(0, 500) || 'Unknown error',
      duration: Date.now() - startTime,
    });
    process.exit(1);
  }
}

main();

// 占位：所有 Skill 的实现都从 ./skills/<skill>/index.js 加载
function _placeholder() {
  return {
    scaffold_run: () => {},
  };
}
_placeholder();