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
const fs = require('fs');

// ============================================================
// 从 stdin 读取完整输入（用于 MCP Server 调用时传递大 JSON）
// ============================================================

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', (err) => {
      reject(err);
    });

    // 超时保护：3 秒内没有数据就认为 stdin 为空
    const timeout = setTimeout(() => {
      resolve(data);
    }, 3000);
    timeout.unref?.();
  });
}

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

  // 修复 PowerShell 把 JSON 折成单个参数的情况（仅用于 --input 模式）
  if (positional.length >= 1) {
    const firstArg = positional[0];
    const braceIdx = firstArg.indexOf('{');
    if (braceIdx > 0) {
      const skillName = firstArg.substring(0, braceIdx).trim();
      const jsonPart = firstArg.substring(braceIdx);
      positional[0] = skillName;
      if (!flags.input) {
        flags.input = jsonPart;
      }
    }
  }

  return {
    skill: positional[0],
    command: positional[1],
    // 优先级：stdin > --input > SKILL_INPUT env > '{}'
    inputSource: process.env.SKILL_INPUT_FROM_STDIN === '1' ? 'stdin' : (flags.input ? 'cli' : (process.env.SKILL_INPUT ? 'env' : 'default')),
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
// Skill Dispatcher（15 个子 Skill）
// ============================================================

// 直接引用 examples/skills 目录（避免 dist 子目录文件损坏问题）
const SKILLS_DIR = path.join(__dirname, '..', 'examples', 'skills');

const skillMap = {
  // Phase 1: 项目初始化
  'spec-bootstrap': 'spec-bootstrap',
  'code-patterns': 'code-patterns',
  'scaffold-runner': 'scaffold-runner',
  'ui-design': 'ui-design',
  'spec-userstory-to-design': 'spec-userstory-to-design',
  'api-contract': 'api-contract',
  'html-converter': 'html-converter',
  // Phase 2: 功能变更与实现
  'openspec-workflow': 'openspec-workflow',
  'implement-executor': 'implement-executor',
  'test-runner': 'test-runner',
  'git-workflow': 'git-workflow',
  // Phase 3: 质量保障
  'debug-helper': 'debug-helper',
  'review-checklist': 'review-checklist',
  'dependency-auditor': 'dependency-auditor',
  'environment-manager': 'environment-manager',
};

function loadSkill(skillName) {
  const dir = skillMap[skillName];
  if (!dir) return null;
  const modulePath = path.join(SKILLS_DIR, dir, 'index.js');
  if (!fs.existsSync(modulePath)) return null;
  return require(modulePath);
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const { skill, command, inputJson: cliInputJson, inputSource, projectRoot } = parseArgs();

  // MCP Sampling 上下文（由 orchestrator-tools.ts fork 时注入）
  const mcpSampling = process.env.MCP_SAMPLING_ENABLED === '1' && typeof process.send === 'function';
  if (mcpSampling) {
    log('MCP sampling active — LLM requests will be forwarded to TRAE Agent via IPC');
  }

  if (!skill || !command) {
    emit({
      ok: false,
      command: `${skill || '?'}.${command || '?'}`,
      error: 'Usage: skill-cli <skill> <command> --input <json> --project-root <path>\n' +
        'Or pipe JSON via stdin with SKILL_INPUT_FROM_STDIN=1\n' +
        'Available skills: ' + Object.keys(skillMap).join(', '),
      data: { llmEnhanced: false, llmProvider: mcpSampling ? 'mcp-sampling' : null },
      warnings: [],
      nextActions: [],
    });
    process.exit(1);
  }

  // 确定 input JSON 来源：stdin（MCP 调用）或 CLI 参数（独立运行）
  let inputJson = cliInputJson;
  if (inputSource === 'stdin') {
    try {
      inputJson = await readStdin();
      log(`Read ${inputJson.length} bytes from stdin`);
    } catch (e) {
      emit({
        ok: false,
        command: `${skill}.${command}`,
        error: `Failed to read input from stdin: ${e.message}`,
        data: { llmEnhanced: false, llmProvider: mcpSampling ? 'mcp-sampling' : null },
        warnings: [],
        nextActions: [],
      });
      process.exit(1);
    }
  }

  // 解析 input
  let input;
  try {
    input = JSON.parse(inputJson);
  } catch (e) {
    emit({
      ok: false,
      command: `${skill}.${command}`,
      error: `Invalid JSON input (source: ${inputSource}): ${e.message}`,
      data: { llmEnhanced: false, llmProvider: mcpSampling ? 'mcp-sampling' : null },
      warnings: [],
      nextActions: [],
    });
    process.exit(1);
  }

  // 注入 projectRoot
  input.projectRoot = input.projectRoot || projectRoot;

  // 加载并执行 Skill
  const skillModule = loadSkill(skill);
  if (!skillModule) {
    emit({
      ok: false,
      command: `${skill}.${command}`,
      error: `Unknown skill: ${skill}. Available: ${Object.keys(skillMap).join(', ')}`,
      data: { llmEnhanced: false, llmProvider: mcpSampling ? 'mcp-sampling' : null },
      warnings: [],
      nextActions: [],
    });
    process.exit(1);
  }

  const startTime = Date.now();
  try {
    log(`Executing ${skill}.${command}...`);
    const handler = skillModule[command];

    if (typeof handler !== 'function') {
      const available = Object.keys(skillModule).filter(k => typeof skillModule[k] === 'function');
      emit({
        ok: false,
        command: `${skill}.${command}`,
        error: `Unknown command '${command}' for skill '${skill}'. Available: ${available.join(', ')}`,
        data: { llmEnhanced: false, llmProvider: mcpSampling ? 'mcp-sampling' : null },
        warnings: [],
        nextActions: [],
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
      data: { llmEnhanced: false, llmProvider: mcpSampling ? 'mcp-sampling' : null },
      warnings: [],
      nextActions: [],
      duration: Date.now() - startTime,
    });
    process.exit(1);
  }
}

main();
