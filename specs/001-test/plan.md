# Implementation Plan: 001-test / P2 修复 + 编排推进

**Branch**: `main`（已多次提交，成熟度 v9 后继续迭代） | **Date**: 2026-08-27
**Spec**: [spec.md](./spec.md) | **Constitution**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)
**Maturity Report**: [maturity-analysis-report.md](../../maturity-analysis-report.md)

## 1. Summary

围绕成熟度报告（v9）中的 **P2 可代码修复项**（问题 7 + 问题 9）执行落地，并按 Phase 1 编排状态机的真实顺序串联 S01→S02→S03→S04→S05→… 的推进流程：

1. **问题 7（健康度监控）**：实现 4 项阈值监控 + 3 种仪表盘格式 + 周报，新增 3 个 MCP Tool。
2. **问题 9（编排状态机）**：实现 19 步文件系统存在性推断 + status/next/transition API，新增 3 个 MCP Tool。
3. **编排推进**（当前 S04 所在阶段）：先建立宪法（S01）、再基于实际文件系统推断进度、再澄清（S03，写 `.clarified` 标记）、再出本方案 plan.md（S04）、再生成质量门 checklist（S05），最终在 Phase 1 形成「治理原则 → 需求规格 → 技术方案 → 质量门 → 任务拆分 → 脚手架 → UI 原型 → 模块设计 → 契约 → HTML 转换」的闭环。

**本方案严格不包含任何源码生成与工程落地动作**（遵循 constitution.md 的 API-First / Contract-First 原则，且需人工审核后再进入 S06 tasks 与 Phase 2 实现）。

## 2. Technical Context

| 维度 | 实际情况（事实可验证） |
|---|---|
| **Language/Version** | TypeScript 5.4 / Node.js 20+（CommonJS + ESM 混合，`package.json` 声明 `type=module`） |
| **Primary Dependencies** | `@modelcontextprotocol/sdk` 1.0.1、`@dalengdeng/openapi-adapter-core` 1.1.1、`commander` 12、`yaml` 2.6、`chalk` 5、`vitest` 2、`typescript` 5.4（`mcp-integration/package.json` 可验证） |
| **MCP Tool Count** | 32 个（原 26 + P2 新增 6：health_monitor_record_event/ check/ dashboard + orchestrator_status/ next/ transition） |
| **Sub-Skills（已实现 14 个）** | spec-bootstrap、scaffold-runner、ui-design、code-repair、test-runner、contract-designer、html-converter、dependency-auditor、environment-manager、open-spec-implementer、quality-gate、change-logger、rollback-manager、health-monitor、orchestrator（P2 新增） |
| **Storage** | 无数据库；所有状态持久化到文件：`.orchestrator-sm/state.json`、`.orchestrator-health/events.ndjson`、`.specify/memory/*`、`specs/<id>/*`、`contracts/openapi.yaml`、`.env.local`、`.trae/mcp.json` |
| **Testing** | vitest（单元）+ 自建 smoke*.cjs 冒烟（CLI 直跑 lib/Skill）|
| **Target Platform** | Windows PowerShell（主要开发环境）+ macOS/Linux WSL（quickstart.sh 已同步脚本，P2 计划外） |
| **Build** | `tsc`（NodeNext 模块目标）+ `scripts/postbuild.js`（把 examples/ 原路径指向 skill-cli.cjs，避免资源打包） |

## 3. Constitution Check（已落地治理原则）

| 项目治理原则 | 状态 | 证据 |
|---|---|---|
| Library-First（先可复用模块再 Skill 封装） | ✅ | health-monitor.js / orchestrator-state-machine.js 先写成 lib，再由 orchestrator-tools.ts 通过动态 import() 封装为 MCP Tool，最后由 SKILL.md 声明 entry-point |
| Test-Driven Development (≥80% coverage 目标) | ✅ 有烟雾与回归 | smoke-p2.cjs 覆盖 HM 4 指标阈值告警 + SM 首候选推进；TS noEmit 强制 0 errors 构建门；每个 Bug 修复后都跑 build + smoke 双验证 |
| API-First Design | ✅ | S11 已生成 `contracts/openapi.yaml`（脚手架阶段即锁定契约）。Skill 调用先返回结构再写文件，不存在"先写代码再补接口" |
| Contract Consistency | ✅ | 状态机、Bootstrap Skill、MCP Tool 三处的「特征目录」探测采用同一套 `findFeatureDir()` 规则（S03 不匹配 Bug 发生后引入），避免"写读位置漂移" |
| No-Estimate（任务拆分先事实后估） | ⚠️ 在 S05→S06 落地 | 本 plan 未对任何任务给出小时估算，将在 S05 checklist 给出质量门，S06 tasks 基于 checklist 生成 tasks.md 时给出复杂度标签（L/M/S） |

## 4. Architecture

**三层架构（从底到顶）**：

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3 · SKILL.md 声明 / entry-points / binds                   │
│   SKILL.md: 20 entry-points + 15 MCP binds                       │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2 · orchestrator-tools MCP Server (stdio)                  │
│   TypeScript: 32 个 Tool 定义 → switch-case handler             │
│   动态 import(): health-monitor.js / orchestrator-state-machine.js│
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1 · 16 个 Node.js 纯模块（examples/skills/ + examples/lib/）│
│   14 Sub-Skill index.js + 2 新增 lib = 可独立测试的纯 JS          │
│   契约：所有模块接受 { projectRoot, ...params }，返回结构统一       │
│        { ok, data, warnings, nextActions, errors, path }         │
└─────────────────────────────────────────────────────────────────┘
```

**共享状态（文件系统唯一可信源）**：所有层读写都遵循 SKILL.md §4.1 约定目录，不存在私有内存状态跨调用保留。

## 5. Module Decomposition（仅结构说明，不生成代码）

```
project-orchestrator-bundle/
├─ .specify/memory/constitution.md       ← S01 产物 · 治理原则单一源
├─ .orchestrator-sm/state.json           ← SM 持久化（S01→S19 步骤完成位、历史、phaseDone）
├─ .orchestrator-health/events.ndjson    ← HM 事件流（task.start/rollback/clarify/complaint/…）
├─ specs/
│   └─ 001-test/
│       ├─ spec.md                        ← S02 specify
│       ├─ .clarified                     ← S03 clarify 标记（成功必写）
│       ├─ plan.md                        ← S04 plan（本文件）
│       ├─ checklist.md                   ← S05 checklist（下一步）
│       └─ tasks.md                       ← S06 tasks（S05 后）
├─ contracts/openapi.yaml                 ← S11 contract（已生成）
├─ docs/
│   └─ design/<feature>/*.md             ← S09 module-design（Phase 1 后续）
├─ prototype/index.html                   ← S08 ui-design（Phase 1 后续）
├─ mcp-integration/
│   ├─ src/orchestrator-tools.ts          ← L2 MCP Server 入口；所有 handler 仅做参数校验→转 L1
│   ├─ dist/                              ← tsc 构建产物（TRAE 侧 node 进程运行的真实文件）
│   ├─ examples/
│   │   ├─ skills/                        ← 14 Sub-Skill（可 CLI 直跑也可被 Skill CLI 调用）
│   │   └─ lib/
│   │       ├─ health-monitor.js          ← P2 HM 模块（L1，无副作用）
│   │       ├─ orchestrator-state-machine.js← P2 SM 模块（L1，仅状态 JSON / 文件系统）
│   │       ├─ llm-client.js              ← （已有）LLM 可选客户端
│   │       └─ ast-parser.js              ← （已有）源码结构抽取，服务于 change-logger/rollback/open-spec
│   ├─ tests/
│   │   ├─ smoke-p2.cjs                   ← HM + SM 冒烟（必过构建门）
│   │   ├─ cli-spec-bootstrap.cjs         ← specify/clarify/plan/checklist/tasks CLI 直跑
│   │   ├─ cli-orchestrator-status.cjs    ← status + next + recompute（TRAE 未连接时兜底）
│   │   └─ test-esm-import.mjs            ← ESM requireLib 兼容性验证
│   └─ package.json                       ← type=module；dependencies 单一源
├─ .trae/mcp.json 或 .trae.mcp.json       ← MCP Server 配置单一源（仅 orchestrator-tools，UTF-8 JSON）
├─ mcp-integration/quickstart.ps1 · sh    ← Windows / macOS / Linux 环境初始化脚本（P2 已验证无错）
└─ SKILL.md                               ← Phase & Scope & 19 步骤 / 32 工具 / 20 入口 汇总
```

### 5.1 模块职责划分

| 模块（文件/目录） | 单一职责 | 不承担的事 |
|---|---|---|
| `src/orchestrator-tools.ts` | 参数解构 → 调用 requireLib → 转 L1 → 标准化输出为 MCP 文本结构 | 不做任何领域逻辑；不直接读写 Node 进程外文件；不 fork |
| `examples/lib/health-monitor.js` | 7 类事件 → 4 指标计算 → 阈值告警判定 → md/html/json/周报 4 种仪表盘模板输出 | 不调用 npm / 不扫描源代码（npm outdated 仅 scanNpm=true 单函数负责）；不写任何状态到外部 |
| `examples/lib/orchestrator-state-machine.js` | 19 步存在性检测 → nextCandidates 排序 → transition 持久化到 state.json | 不调用 Sub-Skill 的写入动作；不主动触发 S01–S19 执行 |
| `examples/skills/spec-bootstrap/index.js` | S01–S06 + 宪法/说明/澄清/方案/清单/任务 6 个写文件动作 | 不越界写源码（遵循 1925179）；不输出任何可执行命令（遵循 100000920） |
| `tests/cli-*.cjs` + `smoke-p2.cjs` | 回归与兜底查询（等价于 MCP 调用） | 不修改生产代码；不写入生产状态文件（仅 smoke 在临时目录） |
| `SKILL.md` | 对外「能力声明」与编排契约 | 不包含实现细节（实现放对应 Sub-Skill 与 lib 中） |

## 6. Milestones（与编排状态机 19 步对齐）

> **P0 = 本期必做；P1 = Phase 1 内建议完成；P2 = 本轮不做**。**除说明中标注外所有里程碑都禁止落地源码**（经验 1925179）。

| 编号 | 里程碑 | 对应步骤 | 优先级 | 人工审核点 |
|---|---|---|---|---|
| M1 | ✅ 建立宪法（已完成） | S01 | P0 | constitution.md 中的技术栈是否符合实际 TypeScript + Node 20 + MCP SDK |
| M2 | ✅ Specify + Clarify 闭环（已完成） | S02 + S03 | P0 | 计划：**S05 checklist 生成时要重新审核 spec.md 是否仍是纯模板**；若仍为模板，则把 scope 切换到"本项目真实推进内容"（如本 plan 所为）|
| M3 | ✅ 技术方案 plan.md（本文件） | S04 | P0 | **本文件在进入 S06 前，请你就 §5 Module Decomposition 与 §7 复杂度做 Yes/No 审核** |
| M4 | 生成领域质量门 checklist.md | S05 | P0 | 质量门至少覆盖：构建门（TS 0 errors / smoke pass）、健康度告警门（S18 前无 critical）、治理门（宪法不冲突）、内容门（spec/plan/checklist 三者无章节空白） |
| M5 | 拆分任务 tasks.md（L/M/S 标签 + 依赖图） | S06 | P0 | 每条任务必须可在 1 天内独立完成 + 能单独验收；**仍不生成任何源码**（1925179）|
| M6 | 脚手架补全（react-vite+fastapi 等组合已声明、需核对 SKILL.md L62 中的矩阵） | S07 | P1 | 本文件不涉及脚手架内容生成，具体在 S07 阶段独立决策 |
| M7 | UI 原型 prototype/index.html（按需） | S08 | P1 | 仅生成静态原型 + 交互注释；不写业务逻辑 |
| M8 | 模块设计 docs/design/…/*.md | S09 | P1 | 至少包含 3 类：数据流图、模块依赖图、失败处理矩阵 |
| M9 | ✅ OpenAPI 契约（已完成） | S11 | P0 | — |
| M10+ | Phase 2（openspec → implement → test → commit）与 Phase 3（review/audit/env）| S13–S19 | P2 | 不在本 S04 plan 范围；Phase 1 完成后由 orchestrator_next() 再给出具体方案 |

## 7. Complexity Tracking（风险与已知依赖）

| 编号 | 复杂度 / 风险点 | 影响 | 缓解措施 | 判定依据 |
|---|---|---|---|---|
| C1 | **ESM + CommonJS 混合**：`package.json type=module` 但所有 Sub-Skill/Lib 用 `require()`；MCP Server（tsc NodeNext 输出 ESM）调它们必须走 `import('file:///...')` | 运行时报 `require is not defined`，导致 6 个 P2 新 Tool 全失效 | （已在 S03 前修复）统一 requireLib → 异步 import；新增 `test-esm-import.mjs` 作为构建门；每次 tsc 后必跑 | 上次 orchestrator_status 首次调用即因该点失败 |
| C2 | **特征目录探测三处不一致**：状态机 f001()、clarify Skill 的兜底路径、plan Skill 的兜底路径三处各自写了不同的探测逻辑 | spec 目录名非 `001-feature` 时「写读位置漂移」→ 报错 not found，或状态机无法检测完成 | （已在 S03 修复）引入 `findFirstFeatureDir()` 与 `resolveSpecPath()`，两处（spec-bootstrap / SM）用完全相同实现；smoke-p2 对非 feature 目录做间接覆盖（本项目是 001-test） | S03 首次 MCP 调用因该点失败 |
| C3 | **S03 信号双保险不足**：仅写 spec.md 的 `## Clarifications` 英文标题，但 S03 检测最初只匹配中文「已澄清」 | clarify 执行"宣称完成"但状态机未检测到推进，导致推进链卡死（1425871）| （已在 S03 修复）双向补信号：① write `.clarified`（存在性优先最可信）② S03.detect 接受中文 / `## Clarifications` / `## 澄清` 任意命中 | S03 CLI 成功后 recompute 未推进 S03，暴露该问题 |
| C4 | **TRAE MCP Server 进程生命周期非托管**：kill 后不会在 Agent 调用时自动重建（当前会话两次都需要用户手动重连） | 所有 MCP Tool 调用返回 `MCP server is not found` / `tool is not found` | 规则：每次调用前用 health_monitor_check(scanNpm=false) 做"应必然返回一行"的结构可信度探活；一旦失败立即切换为 CLI 直跑等价 Skill，并在最终回复显式说明「MCP 调用不可用，已切换到 CLI」，避免把切换状态隐藏（经验 100018570 / 100018570 把工具故障误判为业务结论的坑） | 本次 S03、S04 都因该点切换到 CLI |
| C5 | **spec.md 模板化导致计划与真实需求错位**：spec-bootstrap 的输入只有用户一句 "test"，后续若不纠偏，plan/checklist/tasks 会围绕一个不存在的功能展开 | 所有 Phase 1 产物看似齐全，但对真实的 P2 推进毫无价值（100025968：交付物与推进节奏未对齐导致返工） | S04 本文件已显式纠偏（§1 Summary 改 scope 为真实 P2 修复 + 编排推进；§2 技术上下文写实际 Node/TS 栈而非 React）；**M5 前必须重新校验 spec.md 是否被真实补充**；若未补充则 S05 与 M4 的质量门要继续沿用本 plan 的 scope，而非 spec 模板的假需求 | 当前事实：spec.md 仅 32 行、FR-001/FR-002 均为占位 |
| C6 | **npm outdated 指标扫描耗时**：默认在健康度仪表盘里 scanNpm=true 会真实 shell 出 `npm outdated --json` | Dashboard 输出可能耗时 10s+，易被误以为 Tool 卡死 | 默认 scanNpm=false；探活 / status 查询不传该参数；用户显式要求时才开启，并在 Tool 返回文案里标注"该次包含 npm 扫描" | 健康度 smoke 测试已验证 scanNpm=false 路径稳定 |

## 8. 后续步骤（nextActions）

本方案只给出规划，不生成任何新的源码与可执行命令（遵循 1925179 / 100000920）。

1. **审核本 plan.md**：请你就 §5 模块拆分与 §7 复杂度给出确认 → 确认后进入 S05。
2. **S05 checklist**：调用 `spec_bootstrap_checklist` 生成质量门清单（至少覆盖 C1–C6 的所有缓解措施的可验收条件）。
3. **S06 tasks**：基于 checklist 生成 L/M/S 标签的 tasks.md，**仍不落地代码**。
4. **人工审核后再进入 Phase 2**：Phase 2 openspec-implementer → implement → test → commit 四个步骤必须在 S12（HTML 转换可选）之后、S13（openspec）之前人工过一遍 constitution.md 与 openapi.yaml 是否仍不冲突。