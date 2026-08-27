/**
 * Orchestrator State Machine — 编排状态机
 *
 * 目标（成熟度报告 P2 · 问题 9）：
 *   让「主 Skill」能够基于文件系统的真实产物，自动串联
 *   Phase 1（初始化） →  Phase 2（功能变更与实现） →  Phase 3（质量保障），
 *   形成一条"推断当前状态 → 指出缺失前置 → 推荐下一步 MCP Tool"的闭环。
 *
 *  工作原理：
 *    1. 基于约定文件路径（见 SKILL.md §4.1）做存在性/新鲜度推断
 *    2. 将"已完成步骤"持久化到 .orchestrator-sm/state.json
 *    3. next() 输出候选 nextCandidates + recommended + missingPreconditions，
 *       可选 autoAdvance=true 时，找到唯一可执行的下一步就调用 MCP Tool。
 *    4. transition() 允许外部标记 Phase 完成 / 回退 / 重置 / 重算。
 *
 *  三阶段 19 步骤的顺序（对应 3 大 Phase + 子 Skill 编号）：
 *
 *    Phase 1 · 项目初始化
 *      S01 constitution   .specify/memory/constitution.md
 *      S02 specify        specs/001-feature/spec.md
 *      S03 clarify        (spec.md 被 clarify 过的特征：存在 specs/001-feature/.clarified)
 *      S04 plan           specs/001-feature/plan.md
 *      S05 checklist      specs/001-feature/checklist.md
 *      S06 tasks          specs/001-feature/tasks.md
 *      S07 scaffold       src/package.json 或 apps/web/package.json (组合栈)
 *      S08 ui-design      prototype/index.html
 *      S09 design         docs/design/001-feature/page-flow.md
 *      S10 refine-logic   docs/design/001-feature/logic/<operationId>.md（按需，复杂接口细化）
 *      S11 contract       contracts/openapi.yaml
 *      S12 html-converter components/*.tsx 或 components/*.vue（按需）
 *
 *    Phase 2 · 功能变更与实现
 *      S13 openspec       openspec/changes/*\/PROPOSAL.md
 *      S14 implement      .implement-state.json 或 git log 非空变更
 *      S15 test           coverage/ 或 test-results/ 存在
 *      S16 commit         .git 存在 且 至少一个变更 commit
 *
 *    Phase 3 · 质量保障
 *      S17 review         reviews/ 或 PR 标记（按需）
 *      S18 audit          .dependency-audit.json 或 npm audit 结果
 *      S19 env            .env.local 或注入痕迹（按需）
 *
 * 用法：
 *   const sm = require('./lib/orchestrator-state-machine');
 *   await sm.init({ projectRoot: process.cwd() });
 *   console.log(await sm.status());
 *   const next = await sm.next();           // 推荐下一步
 *   const advanced = await sm.next({ autoAdvance: true }); // 执行唯一可执行的那一步
 *   await sm.transition({ action: 'mark_phase_done', phase: 1 });
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================================
// 步骤定义（19 步）
// ============================================================

/**
 * 每一步：id / phase / 名称 / 存在性判定 (检测函数) / 对应的 MCP Tool / 下一步推荐文案
 * requires: 前置步骤 id（必须全部完成才算"可执行"）
 */
function getStepDefinitions(projectRoot) {
  const specsDir = path.resolve(projectRoot, 'specs');

  // 与 spec-bootstrap Skill 保持一致的特征目录探测：
  //   找 <specsDir>/*/spec.md 存在的第一个目录（按字典序）
  function findFeatureDir() {
    try {
      if (!fsSync.existsSync(specsDir)) return null;
      const items = fsSync.readdirSync(specsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const d of items) {
        if (fsSync.existsSync(path.join(specsDir, d.name, 'spec.md'))) return d.name;
      }
      return null;
    } catch { return null; }
  }

  const f001 = (file) => {
    const dir = findFeatureDir();
    return dir ? path.join(specsDir, dir, file) : path.join(specsDir, '001-feature', file);
  };
  const feature = () => findFeatureDir() || '001-feature';
  const designDir = () => path.resolve(projectRoot, 'docs', 'design', feature());

  const exists = (p) => !!p && fsSync.existsSync(p);
  const anyExists = (patterns) => patterns.some(p => fsSync.existsSync(path.resolve(projectRoot, p)));

  return [
    // ============ Phase 1 ============
    {
      id: 'S01', phase: 1, name: 'constitution', label: '建立项目宪法',
      tool: 'spec_bootstrap_constitution',
      requires: [],
      detect: () => exists(path.resolve(projectRoot, '.specify', 'memory', 'constitution.md')),
      reason: '需要先建立 constitution.md（项目治理原则与技术红线）',
    },
    {
      id: 'S02', phase: 1, name: 'specify', label: '生成 spec.md',
      tool: 'spec_bootstrap_specify',
      requires: ['S01'],
      detect: () => exists(f001('spec.md')),
      reason: 'spec.md 不存在：调用 specify 从自然语言需求生成规格说明',
    },
    {
      id: 'S03', phase: 1, name: 'clarify', label: '澄清 spec 歧义',
      tool: 'spec_bootstrap_clarify',
      requires: ['S02'],
      detect: () => {
        const fp = f001('.clarified');
        // 兼容信号：.clarified 标记文件（优先，最可靠）
        //          spec.md 出现 "## 已澄清问题"（中文）
        //          spec.md 出现 "## Clarifications"（英文，新 clarify Skill 写入）
        const sp = f001('spec.md');
        let mdHit = false;
        try {
          if (sp) {
            const body = fsSync.readFileSync(sp, 'utf-8');
            mdHit = /已澄清|##\s*Clarifications|##\s*澄清/i.test(body);
          }
        } catch {}
        return exists(fp) || mdHit;
      },
      reason: '尚未澄清：调用 clarify 列出 spec.md 中的歧义点（最多 5 条）',
    },
    {
      id: 'S04', phase: 1, name: 'plan', label: '生成技术方案 plan.md',
      tool: 'spec_bootstrap_plan',
      requires: ['S02'],
      detect: () => exists(f001('plan.md')),
      reason: 'plan.md 不存在：基于 spec.md 生成架构/模块/数据流方案',
    },
    {
      id: 'S05', phase: 1, name: 'checklist', label: '生成领域质量清单',
      tool: 'spec_bootstrap_checklist',
      requires: ['S02'],
      detect: () => exists(f001('checklist.md')),
      reason: 'checklist.md 不存在：为项目生成领域质量门清单',
    },
    {
      id: 'S06', phase: 1, name: 'tasks', label: '拆分 tasks.md',
      tool: 'spec_bootstrap_tasks',
      requires: ['S04'],
      detect: () => exists(f001('tasks.md')),
      reason: 'tasks.md 不存在：基于 plan.md 拆分为可执行 [frontend]/[backend]/[shared] 任务列表',
    },
    {
      id: 'S07', phase: 1, name: 'scaffold', label: '脚手架生成项目',
      tool: 'scaffold_runner_run',
      requires: ['S02'],
      detect: () => anyExists([
        'package.json', 'apps/web/package.json', 'pom.xml',
        'pyproject.toml', 'Cargo.toml', 'go.mod',
      ]),
      reason: '还没 scaffold：根据 tech stack 生成可运行工程（支持 react-vite+spring-boot 等组合栈 monorepo）',
    },
    {
      id: 'S08', phase: 1, name: 'ui-design', label: '生成 UI 原型',
      tool: 'ui_design_adjust',
      requires: ['S02'],
      detect: () => exists(path.resolve(projectRoot, 'prototype', 'index.html')),
      reason: 'prototype/index.html 不存在：基于 spec.md 的页面列表生成 UI 原型',
    },
    {
      id: 'S09', phase: 1, name: 'design', label: '生成设计文档 + openapi',
      tool: 'spec_userstory_to_design_generate',
      requires: ['S02', 'S08'],
      detect: () => exists(path.join(designDir(), 'page-flow.md')) || exists(path.join(designDir(), 'openapi.yaml')),
      reason: '需要 design 文档：消费 spec.md + prototype/index.html，产出 page-flow + pages/* + openapi.yaml',
    },
    {
      id: 'S10', phase: 1, name: 'refine-logic', label: '细化接口内部逻辑',
      tool: 'spec_userstory_to_design_refine_logic',
      requires: ['S09'],
      detect: () => {
        const logicDir = path.join(designDir(), 'logic');
        if (!fsSync.existsSync(logicDir)) return false;
        try {
          return fsSync.readdirSync(logicDir).some(n => /\.md$/.test(n) && n !== 'README.md');
        } catch { return false; }
      },
      reason: '复杂接口内部逻辑未细化：消费 docs/design/*/openapi.yaml + page-detail，交互式产出 logic/<operationId>.md（场景 + 状态机 + 时序图 + 决策表）',
      optional: true, // 复杂接口按需细化，不强制
    },
    {
      id: 'S11', phase: 1, name: 'contract', label: '生成正式 OpenAPI 契约',
      tool: 'api_contract_generate',
      requires: ['S09'],
      detect: () => exists(path.resolve(projectRoot, 'contracts', 'openapi.yaml')),
      reason: 'contracts/openapi.yaml 不存在：基于 docs/design/* 下的 openapi + pages 生成正式契约',
    },
    {
      id: 'S12', phase: 1, name: 'html.convert', label: 'HTML 原型 → 组件',
      tool: 'html_converter_convert',
      requires: ['S08'],
      detect: () => {
        const c = path.resolve(projectRoot, 'components');
        if (!fsSync.existsSync(c)) return false;
        try {
          return fsSync.readdirSync(c).some(n => /\.(tsx|vue)$/.test(n));
        } catch { return false; }
      },
      reason: '组件目录无 *.tsx / *.vue：将 prototype/index.html 转为前端组件（支持自定义重复结构阈值）',
      optional: true, // html-convert 属于按需，但仍会出现在候选
    },

    // ============ Phase 2 ============
    {
      id: 'S13', phase: 2, name: 'openspec', label: '创建变更提案',
      tool: 'openspec_workflow_propose',
      requires: ['S06'],
      detect: () => {
        const osd = path.resolve(projectRoot, 'openspec', 'changes');
        if (!fsSync.existsSync(osd)) return false;
        try {
          return fsSync.readdirSync(osd, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .some(d => fsSync.existsSync(path.join(osd, d.name, 'PROPOSAL.md')));
        } catch { return false; }
      },
      reason: 'openspec/changes/*/PROPOSAL.md 不存在：使用 OpenSpec 工作流创建变更提案',
    },
    {
      id: 'S14', phase: 2, name: 'implement', label: '执行编码任务',
      tool: 'implement_executor_run',
      requires: ['S13'],
      detect: () => {
        const s = path.resolve(projectRoot, '.implement-state.json');
        if (fsSync.existsSync(s)) return true;
        // 备选：implement 留下的 commit 痕迹
        try {
          const g = path.resolve(projectRoot, '.git');
          if (!fsSync.existsSync(g)) return false;
        } catch { return false; }
        return false;
      },
      reason: '.implement-state.json 不存在：按 tasks.md 执行 implement-executor（含断点恢复）',
    },
    {
      id: 'S15', phase: 2, name: 'test', label: '运行测试 + 覆盖率',
      tool: 'test_runner_run',
      requires: ['S14'],
      detect: () => anyExists([
        'coverage', 'test-results', '.nyc_output',
      ]),
      reason: '还没有覆盖率产物：运行 test-runner（支持 vitest/jest/mocha/pytest/junit 自动识别）',
    },
    {
      id: 'S16', phase: 2, name: 'commit', label: '生成 Conventional Commit',
      tool: 'git_workflow_commit',
      requires: ['S15'],
      detect: async () => {
        const g = path.resolve(projectRoot, '.git');
        if (!fsSync.existsSync(g)) return false;
        try {
          const { stdout } = await execAsync('git rev-list --count HEAD', { cwd: projectRoot, timeout: 5000 });
          return parseInt(String(stdout).trim(), 10) > 0;
        } catch { return false; }
      },
      reason: '尚未 commit：用 Conventional Commits 规范提交（支持自动推断 type/scope）',
    },

    // ============ Phase 3 ============
    {
      id: 'S17', phase: 3, name: 'review', label: 'PR 评审（7 大类 73 条）',
      tool: 'review_checklist_review',
      requires: ['S16'],
      detect: () => anyExists(['reviews', '.review-report.json']),
      reason: 'PR 评审未完成：调用 review-checklist 执行 7 大类 73 条评审',
      optional: true,
    },
    {
      id: 'S18', phase: 3, name: 'audit', label: '依赖审计（真实 npm audit）',
      tool: 'dependency_auditor_audit',
      requires: ['S07'],
      detect: () => anyExists(['.dependency-audit.json', 'audit-report.json']),
      reason: '未执行依赖审计：真实 npm audit + License 合规 + 健康评分',
    },
    {
      id: 'S19', phase: 3, name: 'env', label: '环境变量注入',
      tool: 'environment_manager_inject',
      requires: ['S01'],
      detect: () => anyExists(['.env.local', '.env']),
      reason: '环境未配置：注入 dev/test/staging/prod 四环境 + Doppler/Vault/dotenv 三后端',
      optional: true,
    },
  ];
}

// ============================================================
// 状态与路径
// ============================================================

let _initialized = false;
let _projectRoot = process.cwd();
let _stateDir = '';
let _stateFile = '';

async function init({ projectRoot } = {}) {
  if (projectRoot) _projectRoot = path.resolve(projectRoot);
  _stateDir = path.join(_projectRoot, '.orchestrator-sm');
  _stateFile = path.join(_stateDir, 'state.json');
  if (!fsSync.existsSync(_stateDir)) await fs.mkdir(_stateDir, { recursive: true });
  if (!fsSync.existsSync(_stateFile)) {
    await fs.writeFile(_stateFile, JSON.stringify(defaultState(), null, 2), 'utf-8');
  }
  _initialized = true;
  return { ok: true, projectRoot: _projectRoot, stateFile: _stateFile };
}

function defaultState() {
  return {
    currentPhase: null, // 1|2|3|null
    completedSteps: [],   // step id 列表（按完成顺序）
    phaseDone: { 1: false, 2: false, 3: false },
    history: [],        // [{ts, type, detail}]
    updatedAt: null,
  };
}

async function loadState() {
  if (!_initialized) throw new Error('[orchestrator-sm] 未初始化');
  try {
    const raw = await fs.readFile(_stateFile, 'utf-8');
    const s = JSON.parse(raw);
    return { ...defaultState(), ...s };
  } catch {
    return defaultState();
  }
}

async function saveState(s) {
  s.updatedAt = new Date().toISOString();
  await fs.writeFile(_stateFile, JSON.stringify(s, null, 2), 'utf-8');
  return s;
}

// ============================================================
// 步骤完成检测（文件系统 + 已保存列表）
// ============================================================

async function detectCompleted(steps, state) {
  const completedIds = new Set(state.completedSteps);
  for (const s of steps) {
    if (completedIds.has(s.id)) continue;
    try {
      const ok = await Promise.resolve(s.detect());
      if (ok) completedIds.add(s.id);
    } catch { /* ignore */ }
  }
  return steps.map(s => ({ ...s, done: completedIds.has(s.id) }));
}

function inferPhase(stepsDoneIds, steps) {
  // 以 "最早未完成步骤的 phase - 1" 作为当前 phase
  for (const s of steps) {
    if (!stepsDoneIds.has(s.id)) return Math.max(1, s.phase - 1) || 1;
  }
  return 3; // 全部完成 = Phase 3
}

// ============================================================
// 公共 API：status / next / transition
// ============================================================

async function status() {
  if (!_initialized) throw new Error('[orchestrator-sm] 未初始化');
  const steps = getStepDefinitions(_projectRoot);
  const state = await loadState();
  const enriched = await detectCompleted(steps, state);

  // 合并持久化 + 实际检测结果
  const completedIds = [];
  enriched.forEach(s => { if (s.done) completedIds.push(s.id); });
  // 保留用户手工 mark_phase_done
  const phaseDone = { ...state.phaseDone };
  const currentPhase = inferPhase(new Set(completedIds), enriched);

  // 下一步候选：所有前置已满足但本身未完成的步骤，按顺序
  const completedSet = new Set(completedIds);
  const nextCandidates = enriched
    .filter(s => !s.done && s.requires.every(r => completedSet.has(r)))
    .map(s => ({ step: s.id, phase: s.phase, tool: s.tool, label: s.label, reason: s.reason, optional: s.optional === true }))
    .sort((a, b) => a.phase - b.phase || steps.findIndex(x => x.id === a.step) - steps.findIndex(x => x.id === b.step));

  // 检查点：当前 Phase 需要全部完成才进入下一阶段
  const phaseProgress = {};
  for (let p = 1; p <= 3; p++) {
    const ps = enriched.filter(s => s.phase === p && !s.optional);
    const done = ps.filter(s => s.done).length;
    phaseProgress[p] = { total: ps.length, done, pct: ps.length ? Math.round(done * 100 / ps.length) : 0 };
    if (done > 0) phaseDone[p] = phaseDone[p] || false;
    if (ps.length && done === ps.length) phaseDone[p] = true;
  }

  return {
    ok: true,
    projectRoot: _projectRoot,
    stateFile: _stateFile,
    currentPhase,
    phaseProgress,
    phaseDone,
    completedSteps: completedIds,
    nextCandidates,
    updatedAt: state.updatedAt,
  };
}

async function next({ autoAdvance = false } = {}) {
  const st = await status();
  const candidates = st.nextCandidates;
  const missing = [];

  // 推荐第一个非 optional 的，或兜底第一个
  let recommended = null;
  if (candidates.length > 0) {
    recommended = candidates.find(c => !c.optional) || candidates[0];
  } else {
    // 全部完成
    recommended = null;
  }

  // 缺失前置：Phase 内本应先完成但还没的步骤
  const steps = getStepDefinitions(_projectRoot);
  const doneSet = new Set(st.completedSteps);
  if (recommended) {
    const recStep = steps.find(s => s.id === recommended.step);
    if (recStep) {
      for (const req of recStep.requires) {
        if (!doneSet.has(req)) {
          const rStep = steps.find(s => s.id === req);
          missing.push(`${req} (${rStep ? rStep.label : '前置步骤'}) 尚未完成`);
        }
      }
    }
  }

  const nextActions = candidates.map(c =>
    `${c.step} ${c.label}  →  MCP Tool: ${c.tool}${c.optional ? '  (按需)' : ''}`
  );
  if (candidates.length === 0) nextActions.push('✅ 全部步骤已完成，进入 Phase 4 就绪态');

  // autoAdvance：只有候选唯一 或 推荐明确时，才返回"可执行"状态，不直接 fork（避免 MCP 循环调用）
  // 实际执行交给调用方（MCP server 端 orchestrator_next handler 的上层）
  let executed = null;
  if (autoAdvance && recommended) {
    executed = {
      candidate: recommended.step,
      tool: recommended.tool,
      note: '请在宿主（MCP Server/Agent Loop）中调用对应 Tool：autoAdvance=true 为"建议执行"语义，状态机本身不递归调用 MCP',
    };
  }

  return {
    ok: true,
    currentPhase: st.currentPhase,
    phaseProgress: st.phaseProgress,
    recommended,
    missingPreconditions: missing,
    nextCandidates: candidates,
    nextActions,
    executed,
  };
}

async function transition({ action, phase } = {}) {
  if (!['mark_phase_done', 'rollback_phase', 'reset', 'recompute'].includes(action)) {
    throw new Error(`[orchestrator-sm] 未知 action: ${action}`);
  }
  const state = await loadState();
  let message = '';

  switch (action) {
    case 'mark_phase_done': {
      if (!phase) throw new Error('mark_phase_done 需要 phase 参数');
      state.phaseDone[phase] = true;
      // 同时把该 Phase 的所有必需步骤写入 completedSteps（若检测已完成）
      const steps = getStepDefinitions(_projectRoot);
      const enriched = await detectCompleted(steps, state);
      enriched
        .filter(s => s.phase === phase && !s.optional && s.done && !state.completedSteps.includes(s.id))
        .forEach(s => state.completedSteps.push(s.id));
      state.history.push({ ts: new Date().toISOString(), type: 'mark_phase_done', detail: `Phase ${phase}` });
      message = `Phase ${phase} 标记完成；已根据文件系统检测自动补齐 ${state.completedSteps.length} 步完成记录。`;
      break;
    }
    case 'rollback_phase': {
      if (!phase) throw new Error('rollback_phase 需要 phase 参数');
      const steps = getStepDefinitions(_projectRoot);
      state.completedSteps = state.completedSteps.filter(id => {
        const s = steps.find(x => x.id === id);
        return s ? s.phase < phase : true;
      });
      for (let p = phase; p <= 3; p++) state.phaseDone[p] = false;
      state.history.push({ ts: new Date().toISOString(), type: 'rollback_phase', detail: `回退到 < Phase ${phase}` });
      message = `已回退：移除 Phase >= ${phase} 的所有完成步骤，重置 phaseDone 标志。`;
      break;
    }
    case 'reset': {
      const ns = defaultState();
      await saveState(ns);
      return { ok: true, action, message: '状态机已重置为全新状态（清空 completedSteps/phaseDone/history）', state: ns };
    }
    case 'recompute': {
      const steps = getStepDefinitions(_projectRoot);
      const enriched = await detectCompleted(steps, state);
      state.completedSteps = enriched.filter(s => s.done).map(s => s.id);
      // 重算 phaseDone
      for (let p = 1; p <= 3; p++) {
        const ps = enriched.filter(s => s.phase === p && !s.optional);
        const doneCount = ps.filter(s => s.done).length;
        state.phaseDone[p] = ps.length > 0 && doneCount === ps.length;
      }
      state.history.push({ ts: new Date().toISOString(), type: 'recompute', detail: `completedSteps = ${state.completedSteps.length}` });
      message = `已基于文件系统重新推断：完成步骤 ${state.completedSteps.length} 个，Phase 完成度 = ${JSON.stringify(state.phaseDone)}。`;
      break;
    }
  }

  const s = await saveState(state);
  return { ok: true, action, phase, message, state: s };
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  init,
  status,
  next,
  transition,
  // 内部测试辅助
  _getStepDefinitions: () => getStepDefinitions(_projectRoot),
  _stateFile: () => _stateFile,
};
