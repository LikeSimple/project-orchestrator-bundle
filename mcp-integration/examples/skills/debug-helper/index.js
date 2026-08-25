/**
 * debug-helper Skill - 完整实现
 *
 * 错误分析（stack trace 解析 + 根因定位 + 修复建议）。
 * 支持 git bisect 自动定位引入 bug 的 commit。
 *
 * 对应 MCP Tool: analyze_error
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// ============================================================
// 错误分类器
// ============================================================

function classifyError(errorMessage) {
  const msg = String(errorMessage || '');

  if (msg.match(/SyntaxError|TypeError: undefined|Cannot find module|Type \w+ has no properties/)) {
    return {
      category: 'syntax',
      severity: 'high',
      typicalCauses: ['拼写错误', '导入路径错误', '类型注解错误'],
    };
  }
  if (msg.match(/Cannot read|undefined|null is not|NaN|out of bounds|RangeError/)) {
    return {
      category: 'runtime',
      severity: 'high',
      typicalCauses: ['空值访问', '数组越界', '异步未 await'],
    };
  }
  if (msg.match(/AssertionError|Expected.*Received|expected.*to (be|equal)/)) {
    return {
      category: 'logic',
      severity: 'medium',
      typicalCauses: ['边界条件遗漏', '业务逻辑错误', '状态管理问题'],
    };
  }
  if (msg.match(/fetch failed|NetworkError|404|500|CORS|ECONNREFUSED|timeout/)) {
    return {
      category: 'integration',
      severity: 'high',
      typicalCauses: ['API URL 错误', 'CORS 配置缺失', '网络问题'],
    };
  }
  if (msg.match(/out of memory|heap|stack overflow|MaxListenersExceeded/)) {
    return {
      category: 'performance',
      severity: 'high',
      typicalCauses: ['内存泄漏', '无限循环', '并发过高'],
    };
  }
  return {
    category: 'unknown',
    severity: 'medium',
    typicalCauses: ['需手动分析'],
  };
}

// ============================================================
// 修复建议生成器
// ============================================================

function generateFixSuggestion(category, errorMessage) {
  const suggestions = {
    syntax: [
      '检查 import 路径是否正确',
      '检查函数/变量名拼写',
      '检查 TypeScript 类型注解',
    ],
    runtime: [
      '添加空值检查：if (user) { ... }',
      '使用 optional chaining：user?.name',
      '检查异步函数是否正确 await',
    ],
    logic: [
      '添加边界条件测试',
      '检查状态管理（state）是否正确',
      '使用 console.log 在关键路径调试',
    ],
    integration: [
      '检查 API URL 和 HTTP 方法',
      '确认后端服务已启动',
      '检查 CORS 配置',
    ],
    performance: [
      '查看 heap dump 找内存泄漏',
      '检查是否有无限循环',
      '降低并发数或加 rate limit',
    ],
    unknown: [
      '在 IDE 中设置断点逐步调试',
      '查看完整的 stack trace',
      '搜索 GitHub Issues',
    ],
  };

  return suggestions[category] || suggestions.unknown;
}

// ============================================================
// 日志关联
// ============================================================

async function loadLogContext(logFile, projectRoot) {
  if (!logFile) return null;
  const cwd = projectRoot || process.cwd();
  const fullPath = path.resolve(cwd, logFile);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    // 提取最近的 ERROR 行
    const lines = content.split('\n').slice(-100);
    const errors = lines.filter(l => l.match(/ERROR|FATAL|EXCEPTION/i)).slice(-10);
    return { totalLines: lines.length, recentErrors: errors };
  } catch {
    return null;
  }
}

// ============================================================
// AST 增强分析（基于 recast + @babel/parser）
// ============================================================

/**
 * 从 stack trace 帧中提取文件路径并读取内容
 * @returns {Promise<Array<{file: string, code: string, line: number}>>}
 */
async function loadStackFrameSources(frames, cwd) {
  const results = [];
  for (const frame of frames) {
    // 跳过 node_modules 和内部模块
    if (frame.file.includes('node_modules') || frame.file.startsWith('internal/')) continue;
    const absPath = path.resolve(cwd, frame.file);
    try {
      const code = await fs.readFile(absPath, 'utf-8');
      results.push({ file: frame.file, absPath, code, line: frame.line, function: frame.function });
    } catch {
      // 文件不存在则跳过
    }
  }
  return results;
}

/**
 * 使用 AST 分析错误相关的源代码，提供增强的调试信息
 * 解析成功时返回增强数据，失败时返回 null（静默回退）
 */
async function analyzeErrorWithAST(stackTrace, projectRoot) {
  if (!stackTrace) return null;
  const cwd = projectRoot || process.cwd();

  try {
    // 1. 解析 stack trace 帧
    const lines = stackTrace.split('\n');
    const frameRegex = /\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/;
    const frames = [];
    for (const line of lines) {
      const m = line.match(frameRegex);
      if (m) {
        const [, func, file, lineNum] = m;
        const relPath = path.relative(cwd, path.isAbsolute(file) ? file : path.resolve(cwd, file));
        frames.push({ function: func, file: relPath, line: parseInt(lineNum) });
      }
    }

    if (frames.length === 0) return null;

    // 2. 读取相关源文件
    const sources = await loadStackFrameSources(frames, cwd);
    if (sources.length === 0) return null;

    // 3. AST 级分析
    const fileAnalyses = [];
    let allEmptyCatches = [];
    let allEvalUsages = [];
    let allConsoleLogs = [];
    let relevantFunctions = [];

    for (const src of sources) {
      const fileAnalysis = { file: src.file };

      // 提取所有函数
      const functions = ast.extractFunctions(src.code);
      fileAnalysis.functionCount = functions.length;

      // 找到错误行附近的函数（上下文）
      const nearbyFn = functions
        .filter(f => f.line <= src.line)
        .sort((a, b) => b.line - a.line)[0];
      if (nearbyFn) {
        fileAnalysis.nearbyFunction = nearbyFn;
        relevantFunctions.push({
          file: src.file,
          ...nearbyFn,
        });
      }

      // 检测空 catch（可能吞掉异常的位置）
      const emptyCatches = ast.detectEmptyCatches(src.code);
      if (emptyCatches.length > 0) {
        fileAnalysis.emptyCatches = emptyCatches;
        allEmptyCatches = allEmptyCatches.concat(emptyCatches.map(e => ({ file: src.file, ...e })));
      }

      // 检测 eval 调用（可能导致运行时错误）
      const evalUsages = ast.detectEvalUsage(src.code);
      if (evalUsages.length > 0) {
        fileAnalysis.evalUsages = evalUsages;
        allEvalUsages = allEvalUsages.concat(evalUsages.map(e => ({ file: src.file, ...e })));
      }

      // 检测 console 调用（调试日志位置）
      const consoleLogs = ast.detectConsoleLogs(src.code);
      if (consoleLogs.length > 0) {
        fileAnalysis.consoleLogs = consoleLogs;
        allConsoleLogs = allConsoleLogs.concat(consoleLogs.map(c => ({ file: src.file, ...c })));
      }

      fileAnalyses.push(fileAnalysis);
    }

    return {
      astEnhanced: true,
      filesAnalyzed: sources.length,
      fileAnalyses,
      relevantFunctions: relevantFunctions.slice(0, 5), // 最多 5 个相关函数
      emptyCatches: allEmptyCatches,
      evalUsages: allEvalUsages,
      consoleLogs: allConsoleLogs.slice(0, 20), // 最多 20 条 console 日志
      riskSummary: {
        emptyCatchCount: allEmptyCatches.length,
        evalUsageCount: allEvalUsages.length,
        consoleLogCount: allConsoleLogs.length,
      },
    };
  } catch {
    // AST 解析失败，静默回退到正则路径
    return null;
  }
}

// ============================================================
// 主命令：analyze
// ============================================================

async function analyze({ errorMessage, stackTrace, logFile, context, projectRoot }) {
  // 1. 分类
  const classification = classifyError(errorMessage);

  // 2. 加载日志上下文
  const logCtx = await loadLogContext(logFile, projectRoot);

  // 3. 生成修复建议
  const fixes = generateFixSuggestion(classification.category, errorMessage);

  // 4. 三层根因分析（启发式）
  const surfaceError = errorMessage.split('\n')[0];
  let directCause = '';
  let rootCause = '';

  if (classification.category === 'syntax') {
    directCause = '导入或拼写错误';
    rootCause = '需检查代码编辑器错误提示';
  } else if (classification.category === 'runtime') {
    directCause = `尝试访问 ${extractPropertyName(errorMessage)} 时变量为 null/undefined`;
    rootCause = '上游 API 返回结构发生变化，或异步时序问题';
  } else if (classification.category === 'logic') {
    directCause = '断言失败：实际值与期望不匹配';
    rootCause = '业务规则变更或边界条件遗漏';
  } else if (classification.category === 'integration') {
    directCause = '网络请求失败';
    rootCause = '服务端不可用 / CORS / 鉴权失效';
  } else if (classification.category === 'performance') {
    directCause = '资源耗尽';
    rootCause = '内存泄漏 / 无限循环 / 突发流量';
  } else {
    directCause = '未识别模式';
    rootCause = '需手动分析';
  }

  // 5. AST 增强分析（基于 recast + @babel/parser）
  let astAnalysis = null;
  let astEnhanced = false;

  try {
    const astResult = await analyzeErrorWithAST(stackTrace, projectRoot);
    if (astResult) {
      astAnalysis = astResult;
      astEnhanced = true;
    }
  } catch {
    // AST 分析失败，静默回退，不影响现有功能
  }

  // 6. LLM 深度分析（结构化方法 analyzeError）
  let llmAnalysis = null;
  let llmEnhanced = false;

  if (llm.isAvailable()) {
    try {
      const logContextStr = logCtx
        ? logCtx.recentErrors.join('\n')
        : '';

      const result = await llm.analyzeError({
        error: errorMessage,
        stackTrace: stackTrace || '',
        codeContext: context || '',
        language: 'javascript',
        logContext: logContextStr,
      });

      if (result.ok && result.analysis) {
        const a = result.analysis;
        llmAnalysis = {
          rootCause: a.rootCause || '',
          errorType: a.errorType || 'Unknown',
          category: a.category || 'other',
          fixSteps: Array.isArray(a.fixSteps)
            ? a.fixSteps.map(f => typeof f === 'string' ? f : (f.action || ''))
            : [],
          prevention: Array.isArray(a.prevention) ? a.prevention.join('; ') : (a.prevention || ''),
          confidence: typeof a.confidence === 'number' ? a.confidence : 0.5,
          summary: a.summary || '',
          provider: result.provider,
          model: result.model,
        };
        llmEnhanced = true;
      }
    } catch {
      // 静默回退，不影响现有功能
    }
  }

  // 基于 AST 分析补充 warnings
  const astWarnings = [];
  if (astEnhanced && astAnalysis) {
    if (astAnalysis.riskSummary.emptyCatchCount > 0) {
      astWarnings.push(`${astAnalysis.riskSummary.emptyCatchCount} empty catch block(s) found — exceptions may be silently swallowed`);
    }
    if (astAnalysis.riskSummary.evalUsageCount > 0) {
      astWarnings.push(`${astAnalysis.riskSummary.evalUsageCount} eval() call(s) found — potential code injection risk`);
    }
  }

  const allWarnings = [
    ...(classification.severity === 'high' ? ['High severity error, recommend immediate fix'] : []),
    ...astWarnings,
  ];

  return {
    ok: true,
    data: {
      summary: `Error categorized: ${classification.category} (severity: ${classification.severity})${astEnhanced ? ' | AST enhanced' : ''}`,
      category: classification.category,
      severity: classification.severity,
      surfaceError,
      directCause,
      rootCause,
      fixes,
      logContext: logCtx,
      stackTracePreview: stackTrace ? stackTrace.split('\n').slice(0, 5).join('\n') : null,
      astAnalysis,
      astEnhanced,
      llmAnalysis,
      llmEnhanced,
      llmProvider: llmEnhanced ? (llmAnalysis?.provider || null) : null,
    },
    warnings: allWarnings,
    nextActions: llmAnalysis && llmAnalysis.fixSteps.length > 0
      ? llmAnalysis.fixSteps.slice(0, 3)
      : fixes.slice(0, 3),
  };
}

function extractPropertyName(errorMessage) {
  const match = errorMessage.match(/Cannot read propert(?:y|ies) ['"]?(\w+)['"]?/);
  return match ? match[1] : 'unknown property';
}

// ============================================================
// 主命令：bisect（git bisect 包装）
// ============================================================

async function bisect({ bad = 'HEAD', good, test, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!good) {
    return { ok: false, error: 'good commit/tag is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }
  if (!test) {
    return { ok: false, error: 'test command is required (e.g., "npm test")', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  try {
    // 检查 git 可用
    await execAsync('git --version');
  } catch {
    return { ok: false, error: 'git is not installed', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  try {
    // git bisect start
    await execAsync('git bisect start', { cwd });
    await execAsync(`git bisect bad ${bad}`, { cwd });
    await execAsync(`git bisect good ${good}`, { cwd });

    // 自动跑测试（这会输出 "first bad commit"）
    const { stdout } = await execAsync(`git bisect run ${test}`, { cwd, timeout: 120_000 });

    // 提取第一个 bad commit
    const match = stdout.match(/([a-f0-9]{40})\s+is the first bad commit/);

    // 退出 bisect 模式
    await execAsync('git bisect reset', { cwd }).catch(() => {});

    if (match) {
      return {
        ok: true,
        data: {
          summary: `✅ First bad commit found: ${match[1]}`,
          badCommit: match[1],
          raw: stdout.split('\n').slice(-5).join('\n'),
          llmEnhanced: false,
          llmProvider: null,
        },
        warnings: [],
        nextActions: [
          `Run \`git show ${match[1]}\` to see the bad commit`,
          `Run \`git log --oneline ${match[1]}\` to see the context`,
        ],
      };
    }

    return {
      ok: false,
      error: 'Could not find first bad commit',
      data: { raw: stdout.split('\n').slice(-5).join('\n'), llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  } catch (err) {
    await execAsync('git bisect reset', { cwd }).catch(() => {});
    return { ok: false, error: `Bisect failed: ${err.message}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }
}

// ============================================================
// 调用链追踪 / 日志分析 / 历史记录
// ============================================================

const HISTORY_FILE = '.debug-history.json';

async function loadHistory(projectRoot) {
  const historyPath = path.join(projectRoot || process.cwd(), HISTORY_FILE);
  try {
    const raw = await fs.readFile(historyPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { sessions: [] };
  }
}

async function saveHistory(projectRoot, history) {
  const historyPath = path.join(projectRoot || process.cwd(), HISTORY_FILE);
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2) + '\n', 'utf-8');
}

async function appendHistory(projectRoot, entry) {
  const history = await loadHistory(projectRoot);
  history.sessions.push({ ...entry, timestamp: new Date().toISOString() });
  if (history.sessions.length > 100) history.sessions = history.sessions.slice(-100);
  await saveHistory(projectRoot, history);
}

/**
 * trace - 从 stack trace 解析调用链
 */
async function trace({ errorMessage, stackTrace, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!stackTrace && !errorMessage) {
    return { ok: false, error: 'errorMessage or stackTrace is required', data: null, warnings: [], nextActions: [] };
  }

  const trace = stackTrace || errorMessage || '';
  const lines = trace.split('\n');
  const frameRegex = /\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/;
  const frames = [];

  for (const line of lines) {
    const m = line.match(frameRegex);
    if (m) {
      const [, func, file, lineNum, col] = m;
      const relPath = path.relative(cwd, file);
      frames.push({ function: func, file: relPath, line: parseInt(lineNum), column: parseInt(col) });
    }
  }

  // AST 增强分析
  let astAnalysis = null;
  let astEnhanced = false;

  if (frames.length > 0) {
    try {
      const sources = await loadStackFrameSources(frames, cwd);
      if (sources.length > 0) {
        const fileAnalyses = [];
        let relevantFunctions = [];
        let allConsoleLogs = [];

        for (const src of sources) {
          const fileAnalysis = { file: src.file };

          // 提取函数上下文
          const functions = ast.extractFunctions(src.code);
          const nearbyFn = functions
            .filter(f => f.line <= src.line)
            .sort((a, b) => b.line - a.line)[0];
          if (nearbyFn) {
            fileAnalysis.nearbyFunction = nearbyFn;
            relevantFunctions.push({ file: src.file, ...nearbyFn });
          }

          // 检测 console 日志
          const consoleLogs = ast.detectConsoleLogs(src.code);
          if (consoleLogs.length > 0) {
            fileAnalysis.consoleLogs = consoleLogs;
            allConsoleLogs = allConsoleLogs.concat(consoleLogs.map(c => ({ file: src.file, ...c })));
          }

          fileAnalyses.push(fileAnalysis);
        }

        astAnalysis = {
          filesAnalyzed: sources.length,
          fileAnalyses,
          relevantFunctions: relevantFunctions.slice(0, 5),
          consoleLogs: allConsoleLogs.slice(0, 20),
        };
        astEnhanced = true;
      }
    } catch { /* graceful fallback */ }
  }

  let llmEnhanced = false;
  let llmProvider = null;
  let analysis = null;

  if (llm.isAvailable() && frames.length > 0) {
    try {
      const stackStr = frames.map(f => `  at ${f.function} (${f.file}:${f.line}:${f.column || 0})`).join('\n');
      const result = await llm.analyzeError({
        error: errorMessage || 'Runtime error in call chain',
        stackTrace: stackStr,
        language: 'javascript',
      });
      if (result.ok && result.analysis) {
        const a = result.analysis;
        analysis = {
          rootCause: a.rootCause || '',
          errorType: a.errorType || 'Unknown',
          category: a.category || 'other',
          callChain: frames.map(f => `${f.function} (${f.file}:${f.line})`),
          suspectedBug: a.summary || '',
          fixSteps: Array.isArray(a.fixSteps)
            ? a.fixSteps.map(f => typeof f === 'string' ? f : (f.action || ''))
            : [],
          confidence: a.confidence || 0.5,
        };
        llmEnhanced = true;
        llmProvider = llm.getProviderName();
      }
    } catch { /* graceful */ }
  }

  await appendHistory(cwd, { type: 'trace', errorMessage: (errorMessage || '').slice(0, 200), frameCount: frames.length });

  const summaryParts = [`${frames.length} stack frames parsed`];
  if (astEnhanced) summaryParts.push('AST enhanced');
  if (llmEnhanced) summaryParts.push('LLM enhanced');

  return {
    ok: true,
    data: {
      summary: summaryParts.join(' | '),
      frames,
      analysis,
      astAnalysis,
      astEnhanced,
      llmEnhanced,
      llmProvider,
    },
    warnings: frames.length === 0 ? ['No stack frames found in input'] : [],
    nextActions: frames.length > 0 ? [`Check ${frames[0].file}:${frames[0].line}`] : [],
  };
}

/**
 * logs - 读取并分析日志文件
 */
async function logs({ logFile, lines: maxLines, level, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!logFile) {
    return { ok: false, error: 'logFile is required', data: null, warnings: [], nextActions: [] };
  }

  const logPath = path.isAbsolute(logFile) ? logFile : path.join(cwd, logFile);

  let content;
  try {
    content = await fs.readFile(logPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot read log file: ${logFile}`, data: null, warnings: [], nextActions: ['Check file path and permissions'] };
  }

  const allLines = content.split('\n').filter(l => l.trim());
  const limit = maxLines ? parseInt(maxLines) : 200;
  const recent = allLines.slice(-limit);

  const levelRegex = level ? new RegExp(`\\b${level.toUpperCase()}\\b`, 'i') : null;
  const filtered = levelRegex ? recent.filter(l => levelRegex.test(l)) : recent;

  const errorLines = recent.filter(l => /\bERROR\b|\bFATAL\b|\bCRITICAL\b/i.test(l));
  const warnLines = recent.filter(l => /\bWARN/i.test(l));

  let llmEnhanced = false;
  let llmProvider = null;
  let logAnalysis = null;
  let summary = `${filtered.length} log lines (${errorLines.length} errors, ${warnLines.length} warnings)`;

  if (llm.isAvailable() && errorLines.length > 0) {
    try {
      const result = await llm.analyzeError({
        error: errorLines.slice(0, 10).join('\n'),
        logContext: errorLines.slice(0, 30).join('\n'),
        language: 'javascript',
      });
      if (result.ok && result.analysis) {
        const a = result.analysis;
        logAnalysis = {
          rootCause: a.rootCause || '',
          errorType: a.errorType || 'Unknown',
          category: a.category || 'other',
          confidence: a.confidence || 0.5,
        };
        summary += ` | LLM: ${a.rootCause || a.summary || ''}`;
        llmEnhanced = true;
        llmProvider = llm.getProviderName();
      }
    } catch { /* graceful */ }
  }

  await appendHistory(cwd, { type: 'logs', logFile, errorCount: errorLines.length });

  return {
    ok: true,
    data: {
      summary,
      logFile,
      totalLines: allLines.length,
      shownLines: filtered.length,
      errorLines: errorLines.slice(0, 20),
      warnLines: warnLines.slice(0, 10),
      logAnalysis,
      llmEnhanced,
      llmProvider,
    },
    warnings: errorLines.length > 0 ? [`${errorLines.length} error-level log entries found`] : [],
    nextActions: errorLines.length > 0 ? ['Investigate the first error-level log entry'] : [],
  };
}

/**
 * history - 查询历史调试记录
 */
async function history({ limit, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const hist = await loadHistory(cwd);
  const max = limit ? parseInt(limit) : 20;
  const sessions = hist.sessions.slice(-max);

  return {
    ok: true,
    data: {
      summary: `${sessions.length} debug sessions (total: ${hist.sessions.length})`,
      sessions,
      totalSessions: hist.sessions.length,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: hist.sessions.length === 0 ? ['No debug history yet. Run analyze/trace/logs to build history.'] : [],
    nextActions: [],
  };
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  analyze,
  bisect,
  trace,
  logs,
  history,
  classifyError,
  generateFixSuggestion,
};
