/**
 * Health Monitor — 健康度监控模块
 *
 * 对应 SKILL.md §8.3 健康度监控表：
 *   指标                  阈值           监控方式
 *   撤销率                > 25%          周报
 *   澄清次数/任务         > 2.5          仪表盘
 *   "改了但没生效"投诉    > 10/周        告警
 *   npm outdated 核心库   > 3 个         启动迁移计划
 *
 * 功能：
 *   recordEvent()     事件采集（rollback / clarify / complaint / npm-outdated / task 等）
 *   computeMetrics()  指标计算（按周 / 按任务 归一化）
 *   checkThresholds() 阈值检查，返回告警列表
 *   generateDashboard()  生成仪表盘（markdown / html / json）
 *   getWeeklyReport()    周报输出（markdown）
 *
 * 数据持久化：
 *   <projectRoot>/.orchestrator-health/events.ndjson   事件日志（追加写入）
 *   <projectRoot>/.orchestrator-health/metrics.json    最新计算缓存
 *
 * 用法：
 *   const hm = require('./lib/health-monitor');
 *   await hm.init({ projectRoot: process.cwd() });
 *   await hm.recordEvent('rollback', { taskId: 'T001', reason: '实现有误' });
 *   const alerts = await hm.checkThresholds();
 *   console.log(await hm.generateDashboard({ format: 'markdown' }));
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================================
// 类型与常量
// ============================================================

const EVENT_TYPES = Object.freeze([
  'task.start',        // 任务开始  { taskId, featureId, side }
  'task.complete',     // 任务完成  { taskId, featureId, ok }
  'clarify.issue',     // 澄清请求  { taskId, issue }
  'rollback.exec',     // 撤销执行  { taskId, reason, scope: 'commit'|'task'|'phase' }
  'complaint.effect',  // "改了没生效"投诉 { taskId, description }
  'npm.outdated',      // npm outdated 扫描结果 { outdatedCount, coreCount, packages: [] }
  'custom',            // 自定义事件 { key, value }
]);

const THRESHOLDS = Object.freeze({
  ROLLBACK_RATE:        0.25,   // 撤销率 > 25%
  CLARIFY_PER_TASK:     2.5,    // 澄清/任务 > 2.5
  COMPLAINT_PER_WEEK:   10,     // 投诉 > 10/周
  OUTDATED_CORE_COUNT:  3,      // outdated 核心库 > 3 个
});

// 核心依赖判定（匹配包名前缀，可自定义覆盖）
const DEFAULT_CORE_PACKAGE_PREFIXES = Object.freeze([
  'react', 'vue', 'next', 'nuxt', 'svelte', 'angular',
  'express', 'koa', 'nest', 'fastify', 'hapi',
  'spring-boot-starter', 'fastapi', 'django', 'flask',
  'go-gin', 'actix-web', 'axum', 'dotnet',
  'typescript', '@babel/', 'webpack', 'vite', 'rollup', 'esbuild',
  'vitest', 'jest', 'mocha', 'pytest', 'junit',
  '@modelcontextprotocol/', 'openapi-', 'axios', 'fetch',
  'tailwindcss',
]);

// ============================================================
// 内部状态
// ============================================================

let _initialized = false;
let _config = {
  projectRoot: process.cwd(),
  corePrefixes: [...DEFAULT_CORE_PACKAGE_PREFIXES],
  // 周起始日（默认周一 = 1）
  weekStartsOn: 1,
};
let _stateDir = '';
let _eventsFile = '';
let _metricsFile = '';

// ============================================================
// 初始化 / 路径
// ============================================================

async function init(opts = {}) {
  _config = {
    ..._config,
    ...opts,
    corePrefixes: opts.corePrefixes
      ? [...opts.corePrefixes]
      : [...DEFAULT_CORE_PACKAGE_PREFIXES],
  };
  _stateDir = path.resolve(_config.projectRoot, '.orchestrator-health');
  _eventsFile = path.join(_stateDir, 'events.ndjson');
  _metricsFile = path.join(_stateDir, 'metrics.json');

  if (!fsSync.existsSync(_stateDir)) {
    await fs.mkdir(_stateDir, { recursive: true });
  }
  if (!fsSync.existsSync(_eventsFile)) {
    await fs.writeFile(_eventsFile, '', 'utf-8');
  }
  if (!fsSync.existsSync(_metricsFile)) {
    await fs.writeFile(_metricsFile, JSON.stringify({ computedAt: null, metrics: {}, alerts: [] }, null, 2), 'utf-8');
  }
  _initialized = true;
  return { ok: true, stateDir: _stateDir };
}

function ensureInit() {
  if (!_initialized) {
    throw new Error('[health-monitor] 未初始化，请先调用 init({ projectRoot })');
  }
}

// ============================================================
// 事件采集
// ============================================================

function validateEventType(type) {
  if (!EVENT_TYPES.includes(type) && !type.startsWith('custom.')) {
    throw new Error(`[health-monitor] 未知事件类型: ${type}。允许值: ${EVENT_TYPES.join(', ')} 或 custom.*`);
  }
}

/**
 * 记录一个健康度事件。
 *
 * @param {string} type    事件类型（EVENT_TYPES 之一 或 custom.*）
 * @param {object} payload 事件负载（键值对，可序列化）
 * @returns {Promise<{ ok: true, id: string, timestamp: string }>}
 */
async function recordEvent(type, payload = {}) {
  ensureInit();
  validateEventType(type);
  const timestamp = new Date().toISOString();
  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const line = JSON.stringify({
    id,
    t: timestamp,
    type,
    payload,
  }) + '\n';
  await fs.appendFile(_eventsFile, line, 'utf-8');
  return { ok: true, id, timestamp };
}

// ============================================================
// 事件读取与时间辅助
// ============================================================

async function loadAllEvents() {
  ensureInit();
  const raw = await fs.readFile(_eventsFile, 'utf-8');
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function getWeekKey(dateIso) {
  // ISO-周 兼容的简单分组：返回 YYYY-Www
  const d = new Date(dateIso);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // 周一=0
  target.setDate(target.getDate() - dayNr + 3); // 周四定位
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = (target - firstThursday) / 86400000;
  const week = 1 + Math.ceil((diff + ((firstThursday.getDay() + 6) % 7 - 3)) / 7);
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getCurrentWeekKey() { return getWeekKey(new Date().toISOString()); }

function isWithin(d1Iso, daysBack) {
  const now = Date.now();
  const t = new Date(d1Iso).getTime();
  return now - t <= daysBack * 86400_000;
}

// ============================================================
// npm outdated 真实采集
// ============================================================

/**
 * 运行 `npm outdated --json`，提取过期依赖数。
 * 失败（命令不可用 / 无 package.json）时返回 null，不抛异常。
 *
 * @param {string} cwd 项目根
 * @returns {Promise<{ total: number, core: number, packages: Array<{name,current,wanted,latest}> } | null>}
 */
async function scanNpmOutdated(cwd = _config.projectRoot) {
  const pkgFile = path.join(cwd, 'package.json');
  if (!fsSync.existsSync(pkgFile)) return null;
  try {
    const { stdout } = await execAsync('npm outdated --json', {
      cwd, timeout: 45_000, encoding: 'utf-8',
    }).catch(err => {
      // npm outdated 有过期时 exit code = 1，但 stdout 仍有 JSON
      if (err && err.stdout) return { stdout: err.stdout };
      throw err;
    });
    const data = JSON.parse(stdout || '{}');
    const names = Object.keys(data);
    const prefixes = _config.corePrefixes;
    const corePkgs = names.filter(n => prefixes.some(p => n === p || n.startsWith(p) || n.startsWith(p + '/')));
    return {
      total: names.length,
      core: corePkgs.length,
      packages: names.map(n => ({
        name: n,
        current: data[n].current ?? '',
        wanted: data[n].wanted ?? '',
        latest: data[n].latest ?? '',
        core: corePkgs.includes(n),
      })),
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// 指标计算
// ============================================================

/**
 * 计算所有健康度指标。
 *
 * 返回结构：
 *   {
 *     computedAt: ISO string,
 *     windowDays: 7,
 *     metrics: {
 *       rollbackRate:     { value, overThreshold, threshold, events: { tasks, rollbacks } },
 *       clarifyPerTask:   { value, overThreshold, threshold, events: { tasks, clarifies } },
 *       complaintPerWeek: { value, overThreshold, threshold, weekKey, count },
 *       outdatedCore:     { value, overThreshold, threshold, totalOutdated, coreOutdated, packages: [...] },
 *     },
 *     alerts: [ { level, code, message, metric, detail } ],
 *   }
 */
async function computeMetrics({ scanNpm = true } = {}) {
  ensureInit();
  const events = await loadAllEvents();
  const currentWeek = getCurrentWeekKey();

  // 7 天滑窗内事件（撤销率 / 澄清率 按 7 天统计更敏感）
  const recent = events.filter(e => isWithin(e.t, 7));
  const taskStarts = recent.filter(e => e.type === 'task.start');
  const taskCount = taskStarts.length;

  // ---- 撤销率（rollback.exec / task.complete + task.start）
  const rollbacks = recent.filter(e => e.type === 'rollback.exec');
  const completes = recent.filter(e => e.type === 'task.complete');
  const denom = Math.max(taskCount, completes.length);
  const rollbackRate = denom === 0 ? 0 : rollbacks.length / denom;

  // ---- 澄清/任务 比
  const clarifies = recent.filter(e => e.type === 'clarify.issue');
  const clarifyPerTask = taskCount === 0 ? 0 : clarifies.length / taskCount;

  // ---- 本周 "改了没生效" 投诉
  const weeklyComplaints = events.filter(e =>
    e.type === 'complaint.effect' && getWeekKey(e.t) === currentWeek
  );

  // ---- npm outdated 核心库数（实时扫描 + 事件回退）
  let outdated = scanNpm ? await scanNpmOutdated() : null;
  if (!outdated) {
    // 取最后一条 npm.outdated 事件作为回退
    const lastOutdated = [...events]
      .filter(e => e.type === 'npm.outdated')
      .slice(-1)[0];
    if (lastOutdated) {
      outdated = {
        total: lastOutdated.payload.outdatedCount ?? 0,
        core: lastOutdated.payload.coreCount ?? 0,
        packages: lastOutdated.payload.packages ?? [],
      };
    } else {
      outdated = { total: 0, core: 0, packages: [] };
    }
  }

  // ---- 阈值判定
  const alerts = [];
  const mkAlert = (level, code, message, metric, detail) => alerts.push({ level, code, message, metric, detail });

  if (denom > 0 && rollbackRate > THRESHOLDS.ROLLBACK_RATE) {
    mkAlert('warning', 'HM_ROLLBACK_HIGH',
      `撤销率 ${(rollbackRate * 100).toFixed(1)}% 超过阈值 25%`,
      'rollbackRate',
      { rollbacks: rollbacks.length, tasks: denom, threshold: THRESHOLDS.ROLLBACK_RATE },
    );
  }

  if (taskCount > 0 && clarifyPerTask > THRESHOLDS.CLARIFY_PER_TASK) {
    mkAlert('info', 'HM_CLARIFY_HIGH',
      `澄清/任务比 ${clarifyPerTask.toFixed(2)} 超过阈值 2.5 — 任务描述质量待提升`,
      'clarifyPerTask',
      { clarifies: clarifies.length, tasks: taskCount, threshold: THRESHOLDS.CLARIFY_PER_TASK },
    );
  }

  if (weeklyComplaints.length > THRESHOLDS.COMPLAINT_PER_WEEK) {
    mkAlert('critical', 'HM_COMPLAINT_SPIKE',
      `本周"改了没生效"投诉 ${weeklyComplaints.length} 次，超过阈值 10 — 质量红线`,
      'complaintPerWeek',
      { week: currentWeek, count: weeklyComplaints.length, threshold: THRESHOLDS.COMPLAINT_PER_WEEK },
    );
  }

  if (outdated.core > THRESHOLDS.OUTDATED_CORE_COUNT) {
    mkAlert('info', 'HM_OUTDATED_CORE',
      `npm outdated 核心库 ${outdated.core} 个，超过阈值 3 — 建议启动迁移计划`,
      'outdatedCore',
      { core: outdated.core, total: outdated.total, threshold: THRESHOLDS.OUTDATED_CORE_COUNT, packages: outdated.packages.filter(p => p.core).map(p => p.name) },
    );
  }

  const metrics = {
    rollbackRate: {
      value: Math.round(rollbackRate * 10000) / 10000,
      overThreshold: rollbackRate > THRESHOLDS.ROLLBACK_RATE,
      threshold: THRESHOLDS.ROLLBACK_RATE,
      events: { tasks: denom, rollbacks: rollbacks.length },
    },
    clarifyPerTask: {
      value: Math.round(clarifyPerTask * 100) / 100,
      overThreshold: clarifyPerTask > THRESHOLDS.CLARIFY_PER_TASK,
      threshold: THRESHOLDS.CLARIFY_PER_TASK,
      events: { tasks: taskCount, clarifies: clarifies.length },
    },
    complaintPerWeek: {
      value: weeklyComplaints.length,
      overThreshold: weeklyComplaints.length > THRESHOLDS.COMPLAINT_PER_WEEK,
      threshold: THRESHOLDS.COMPLAINT_PER_WEEK,
      weekKey: currentWeek,
      count: weeklyComplaints.length,
    },
    outdatedCore: {
      value: outdated.core,
      overThreshold: outdated.core > THRESHOLDS.OUTDATED_CORE_COUNT,
      threshold: THRESHOLDS.OUTDATED_CORE_COUNT,
      totalOutdated: outdated.total,
      coreOutdated: outdated.core,
      packages: outdated.packages,
    },
  };

  const snapshot = {
    computedAt: new Date().toISOString(),
    windowDays: 7,
    metrics,
    alerts,
  };

  // 缓存
  await fs.writeFile(_metricsFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  return snapshot;
}

/**
 * 只返回告警列表（内部调用 computeMetrics）
 */
async function checkThresholds(opts = {}) {
  const snap = await computeMetrics(opts);
  return {
    ok: true,
    checkedAt: snap.computedAt,
    healthy: snap.alerts.length === 0,
    count: snap.alerts.length,
    alerts: snap.alerts,
    metricsSummary: {
      rollbackRate: snap.metrics.rollbackRate.value,
      clarifyPerTask: snap.metrics.clarifyPerTask.value,
      complaintPerWeek: snap.metrics.complaintPerWeek.value,
      outdatedCore: snap.metrics.outdatedCore.value,
    },
  };
}

// ============================================================
// 仪表盘输出
// ============================================================

/**
 * 生成仪表盘
 * @param {'markdown'|'html'|'json'} [format='markdown']
 */
async function generateDashboard({ format = 'markdown', includePackages = true } = {}) {
  ensureInit();
  const snap = await computeMetrics({ scanNpm: true });
  const { metrics, alerts } = snap;

  if (format === 'json') {
    return JSON.stringify(snap, null, 2);
  }

  // 卡片辅助
  const levelIcon = lvl => lvl === 'critical' ? '🔴' : lvl === 'warning' ? '🟡' : 'ℹ️';
  const statusIcon = over => over ? '⚠️ 超阈值' : '✅ 正常';

  const rollbackPct = (metrics.rollbackRate.value * 100).toFixed(1);
  const corePkgsCount = metrics.outdatedCore.packages.filter(p => p.core).length;
  const coreList = includePackages
    ? metrics.outdatedCore.packages.filter(p => p.core).map(p => `- ${p.name}: ${p.current} → ${p.latest}`).join('\n') || '  (无)'
    : `  (共 ${corePkgsCount} 个核心包)`;

  if (format === 'markdown') {
    const md = [];
    md.push(`# 健康度仪表盘`);
    md.push('');
    md.push(`> 计算时间：${snap.computedAt}   滑窗：最近 ${snap.windowDays} 天`);
    md.push(`> 整体状态：${alerts.length === 0 ? '✅ 健康' : `⚠️ ${alerts.length} 条告警`}`);
    md.push('');
    md.push('## 指标概览');
    md.push('');
    md.push('| 指标 | 当前值 | 阈值 | 状态 |');
    md.push('|---|---|---|---|');
    md.push(`| 撤销率 | ${rollbackPct}% | >25% | ${statusIcon(metrics.rollbackRate.overThreshold)} |`);
    md.push(`| 澄清次数/任务 | ${metrics.clarifyPerTask.value} | >2.5 | ${statusIcon(metrics.clarifyPerTask.overThreshold)} |`);
    md.push(`| "改了没生效"投诉（${metrics.complaintPerWeek.weekKey}） | ${metrics.complaintPerWeek.value}/周 | >10/周 | ${statusIcon(metrics.complaintPerWeek.overThreshold)} |`);
    md.push(`| npm outdated 核心库 | ${metrics.outdatedCore.value} 个 | >3 个 | ${statusIcon(metrics.outdatedCore.overThreshold)} |`);
    md.push('');

    if (alerts.length > 0) {
      md.push('## 告警');
      md.push('');
      alerts.forEach(a => md.push(`- ${levelIcon(a.level)} **${a.code}**: ${a.message}`));
      md.push('');
    }

    md.push('## 详细：npm outdated 核心库');
    md.push('');
    md.push(`总计：${metrics.outdatedCore.totalOutdated} 个过期，其中核心库 ${metrics.outdatedCore.coreOutdated} 个`);
    md.push('');
    md.push(coreList);
    md.push('');

    md.push('## 建议动作');
    md.push('');
    if (metrics.rollbackRate.overThreshold) md.push('- [ ] 复盘最近撤销任务的根因（任务描述歧义 / 设计缺失 / 测试遗漏）');
    if (metrics.clarifyPerTask.overThreshold) md.push('- [ ] 在 tasks.md 中增加"验收标准"字段，降低任务间歧义');
    if (metrics.complaintPerWeek.overThreshold) md.push('- [ ] 启动质量红线会议：逐个追溯投诉根因，补充 E2E 测试覆盖修改点');
    if (metrics.outdatedCore.overThreshold) md.push('- [ ] 制定核心依赖迁移计划：按包风险优先级分批升级，配合 CI 回归');
    if (alerts.length === 0) md.push('- [x] 当前所有指标均在阈值内 ✅');
    return md.join('\n');
  }

  // HTML
  const alertBadges = alerts.length === 0
    ? `<div class="badge badge-ok">健康 ✅</div>`
    : `<div class="badge badge-warn">${alerts.length} 条告警 ⚠️</div>`;
  const alertsHtml = alerts.map(a =>
    `<li><span class="lv lv-${a.level}">${levelIcon(a.level)}</span> <strong>${a.code}</strong>：${a.message}</li>`
  ).join('') || '<li class="muted">无告警</li>';

  const cardMeter = (label, value, unit, threshold, over, extra = '') => `
    <div class="card">
      <div class="card-title">${label}</div>
      <div class="card-value">${value}<span class="unit">${unit}</span></div>
      <div class="card-sub">阈值：${threshold}${unit} · ${over ? '<span class="warn-color">超阈值</span>' : '<span class="ok-color">正常</span>'}</div>
      ${extra ? `<div class="card-extra">${extra}</div>` : ''}
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>健康度仪表盘</title>
<style>
:root { --bg:#0f172a; --card:#1e293b; --fg:#e2e8f0; --muted:#94a3b8; --ok:#22c55e; --warn:#f59e0b; --crit:#ef4444; --info:#3b82f6; --border:#334155; }
* { box-sizing:border-box; }
body { margin:0; padding:24px; font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--fg); }
h1 { margin:0 0 8px; }
.sub { color:var(--muted); margin-bottom:24px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin-bottom:24px; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px; }
.card-title { color:var(--muted); font-size:13px; margin-bottom:6px; }
.card-value { font-size:32px; font-weight:700; }
.card-value .unit { font-size:16px; color:var(--muted); margin-left:4px; font-weight:400; }
.card-sub { font-size:12px; color:var(--muted); margin-top:6px; }
.card-extra { font-size:12px; color:var(--muted); margin-top:8px; border-top:1px dashed var(--border); padding-top:8px; }
.badge { display:inline-block; padding:4px 12px; border-radius:999px; font-weight:600; font-size:14px; }
.badge-ok { background:#064e3b; color:#6ee7b7; }
.badge-warn { background:#78350f; color:#fcd34d; }
.section { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:20px; }
.section h2 { margin:0 0 12px; font-size:18px; }
ul { padding-left:20px; margin:0; }
li { margin-bottom:6px; }
li.muted { color:var(--muted); }
.lv { margin-right:6px; }
.ok-color { color:var(--ok); }
.warn-color { color:var(--warn); }
table { width:100%; border-collapse:collapse; font-size:14px; }
th,td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--border); }
th { color:var(--muted); font-weight:500; }
code { background:#0b1220; padding:2px 6px; border-radius:4px; font-family:ui-monospace,Consolas,monospace; }
.todo { background:#0b1220; border-radius:8px; padding:12px 16px; }
.todo li { list-style:none; margin-left:-20px; }
</style>
</head>
<body>
  <h1>健康度仪表盘</h1>
  <div class="sub">
    计算时间：${snap.computedAt} · 滑窗：最近 ${snap.windowDays} 天 · ${alertBadges}
  </div>

  <div class="grid">
    ${cardMeter('撤销率', rollbackPct, '%', '>25', metrics.rollbackRate.overThreshold, `撤销 ${metrics.rollbackRate.events.rollbacks} 次 / 任务 ${metrics.rollbackRate.events.tasks} 个`)}
    ${cardMeter('澄清次数 / 任务', metrics.clarifyPerTask.value, '', '>2.5', metrics.clarifyPerTask.overThreshold, `澄清 ${metrics.clarifyPerTask.events.clarifies} 次 / 任务 ${metrics.clarifyPerTask.events.tasks} 个`)}
    ${cardMeter(`"改了没生效"投诉 (${metrics.complaintPerWeek.weekKey})`, metrics.complaintPerWeek.value, '/周', '>10', metrics.complaintPerWeek.overThreshold)}
    ${cardMeter('npm outdated 核心库', metrics.outdatedCore.value, '个', '>3', metrics.outdatedCore.overThreshold, `总过期 ${metrics.outdatedCore.totalOutdated} 个`)}
  </div>

  <div class="section">
    <h2>告警</h2>
    <ul>${alertsHtml}</ul>
  </div>

  <div class="section">
    <h2>npm outdated 核心库明细</h2>
    <table>
      <thead><tr><th>包名</th><th>当前</th><th>期望</th><th>最新</th><th>是否核心</th></tr></thead>
      <tbody>
        ${(includePackages ? metrics.outdatedCore.packages.filter(p => p.core) : []).map(p =>
          `<tr><td><code>${p.name}</code></td><td>${p.current}</td><td>${p.wanted}</td><td>${p.latest}</td><td>${p.core ? '✅ 核心' : ''}</td></tr>`
        ).join('') || `<tr><td colspan="5" class="muted">（无过期核心依赖）</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>建议动作</h2>
    <div class="todo">
      <ul>
        ${metrics.rollbackRate.overThreshold ? '<li>☐ 复盘最近撤销任务的根因（任务描述歧义 / 设计缺失 / 测试遗漏）</li>' : ''}
        ${metrics.clarifyPerTask.overThreshold ? '<li>☐ 在 tasks.md 中增加"验收标准"字段，降低任务间歧义</li>' : ''}
        ${metrics.complaintPerWeek.overThreshold ? '<li>☐ 启动质量红线会议：逐个追溯投诉根因，补充 E2E 测试覆盖修改点</li>' : ''}
        ${metrics.outdatedCore.overThreshold ? '<li>☐ 制定核心依赖迁移计划：按包风险优先级分批升级，配合 CI 回归</li>' : ''}
        ${alerts.length === 0 ? '<li>☑ 当前所有指标均在阈值内 ✅</li>' : ''}
      </ul>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================
// 周报（针对 撤销率 周报监控方式）
// ============================================================

async function getWeeklyReport({ weekKey } = {}) {
  ensureInit();
  const wk = weekKey || getCurrentWeekKey();
  const events = await loadAllEvents();
  const wkEvents = events.filter(e => getWeekKey(e.t) === wk);
  const tasks = wkEvents.filter(e => e.type === 'task.start').length;
  const completes = wkEvents.filter(e => e.type === 'task.complete').length;
  const rollbacks = wkEvents.filter(e => e.type === 'rollback.exec').length;
  const clarifies = wkEvents.filter(e => e.type === 'clarify.issue').length;
  const complaints = wkEvents.filter(e => e.type === 'complaint.effect').length;
  const rollbackRate = (tasks + completes) === 0 ? 0 : rollbacks / Math.max(tasks, completes);
  const clarifyPerTask = tasks === 0 ? 0 : clarifies / tasks;

  return `# 健康度周报 · ${wk}

> 生成时间：${new Date().toISOString()}

## 本周摘要

| 指标 | 数值 | 对比阈值 | 是否触发 |
|---|---|---|---|
| 任务数 | ${tasks} | — | — |
| 完成数 | ${completes} | — | — |
| 撤销次数 | ${rollbacks} | — | — |
| **撤销率** | **${(rollbackRate * 100).toFixed(1)}%** | >25% | ${rollbackRate > 0.25 ? '⚠️ 是' : '✅ 否'} |
| 澄清次数 | ${clarifies} | — | — |
| **澄清/任务** | **${clarifyPerTask.toFixed(2)}** | >2.5 | ${clarifyPerTask > 2.5 ? '⚠️ 是' : '✅ 否'} |
| **"改了没生效"投诉** | **${complaints}** | >10 | ${complaints > 10 ? '🔴 是' : '✅ 否'} |

## 撤销明细（TOP 原因）

${rollbacks === 0 ? '_（本周无撤销）_' :
  Object.entries(
    wkEvents
      .filter(e => e.type === 'rollback.exec')
      .reduce((acc, e) => {
        const r = e.payload?.reason || 'unknown';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v} 次`)
    .join('\n')
}
`;
}

// ============================================================
// 状态查询（只读）
// ============================================================

async function getCachedMetrics() {
  ensureInit();
  try {
    const raw = await fs.readFile(_metricsFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { computedAt: null, metrics: {}, alerts: [] };
  }
}

async function stats() {
  ensureInit();
  const events = await loadAllEvents();
  const typeCounts = events.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    stateDir: _stateDir,
    eventsFile: _eventsFile,
    metricsFile: _metricsFile,
    totalEvents: events.length,
    typeCounts,
    currentWeek: getCurrentWeekKey(),
  };
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  // 生命周期
  init,
  // 事件
  recordEvent,
  EVENT_TYPES,
  // 计算 / 检查
  computeMetrics,
  checkThresholds,
  // 输出
  generateDashboard,
  getWeeklyReport,
  getCachedMetrics,
  stats,
  // npm 扫描（供外部直接用）
  scanNpmOutdated,
  // 常量
  THRESHOLDS,
  DEFAULT_CORE_PACKAGE_PREFIXES,
};
