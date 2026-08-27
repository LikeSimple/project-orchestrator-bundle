# Feature Specification: P2 修复 + 编排推进

**Feature Branch**: `001-test`（沿用目录，scope 已纠偏为真实 P2 推进内容）
**Status**: Active（已通过 S01-S05 编排推进）
**Input**: User goal "完成 P2 的修复"（成熟度报告 v9 中问题 7 + 问题 9）
**Related Artifacts**:
- [plan.md](./plan.md) — 技术方案（S04 产物，152 行 / 8 章节）
- [checklist.md](./checklist.md) — 质量门清单（S05 产物，10 章节 / 28 条 CHK）
- [constitution.md](../../.specify/memory/constitution.md) — 治理原则（S01 产物）
- [maturity-analysis-report.md](../../maturity-analysis-report.md) — 成熟度报告 v9

## User Scenarios & Testing

### User Story US-01 - 完成 P2 修复并验证编排状态机推进（Priority: P1）

作为 project-orchestrator-bundle 的维护者，我希望基于成熟度报告 v9 完成 P2 可代码修复项（问题 7 健康度监控 + 问题 9 编排状态机），并通过编排状态机自动串联 Phase 1 的 S01→S11 推进流程，从而让 6 个新 MCP Tool 在 TRAE 中稳定可用，并为进入 Phase 2 实现层提供准入门槛。

**Why this priority**: MVP 核心需求 — 没有这两项 P2 修复，编排状态机与健康度监控都无法工作，Phase 2 实现层缺少治理依据。

**Independent Test**: 可通过以下 3 步独立验证：
1. `node tests/smoke-p2.cjs` 退出码 0 且输出含 `rollbackRate=33.3%`、3 告警、MD+HTML+JSON+周报 4 种仪表盘输出
2. `node tests/test-esm-import.mjs <projectRoot>` 退出码 0 且 4+4 个关键函数全部 `PRESENT ✓`
3. `orchestrator_transition(action=recompute)` 后 `completedSteps` 包含 `["S01","S02","S03","S04","S05","S07","S11"]`

**Acceptance Scenarios**:
1. **Given** 用户已重启 MCP Server **When** 调用 `health_monitor_check(scanNpm=false)` **Then** 返回 `healthy=true` 且 `metricsSummary` 含 4 个指标（rollbackRate/clarifyPerTask/complaintPerWeek/outdatedCore）
2. **Given** 用户已重启 MCP Server **When** 调用 `orchestrator_status` **Then** 返回 `currentPhase=1`、`phaseProgress` 含 3 个 Phase（1/2/3）、`nextCandidates` 第一顺位对应未完成的最小步骤编号
3. **Given** MCP Server 不可用（TRAE 侧未重连）**When** Agent 切换为 CLI 直跑 `cli-spec-bootstrap.cjs` 或 `cli-orchestrator-status.cjs` **Then** 产出与 MCP 调用等价的文件（spec.md/plan.md/checklist.md/tasks.md 或 state.json 更新）
4. **Given** spec-bootstrap Skill 输出 `ok=true` **When** Agent 执行三重验证（Glob 存在 + Read 内容长度 > 阈值 + SM recompute 出现该步骤）**Then** 才标记该步骤完成；否则识别为「占位骨架 Bug」（1425871）并手动重写到正确路径

## Requirements

### Functional Requirements

- **FR-001**: System MUST 实现 4 项健康度阈值监控（撤销率 > 25%、澄清次数/任务 > 2.5、投诉/周 > 10、npm outdated 核心库 > 3），并通过 `.orchestrator-health/events.ndjson` 持久化 7 天滑窗事件流
  - **来源**：成熟度报告 v9 问题 7 + plan.md §7 C6
  - **验收**：smoke-p2.cjs 模拟 12 任务+4 撤销+40 澄清+12 投诉 → 精准触发 warning/info/critical 3 条告警

- **FR-002**: System MUST 实现 19 步编排状态机（Phase 1 · 11 步 + Phase 2 · 4 步 + Phase 3 · 3 步 + 按需 1 步），通过文件系统存在性推断当前进度，并提供 `status` / `next` / `transition` 三个 MCP Tool
  - **来源**：成熟度报告 v9 问题 9 + plan.md §6 M1-M10
  - **验收**：空项目 → `nextCandidates` 第一顺位为 S01 `spec_bootstrap_constitution`；S01 完成后 recompute → completedSteps 出现 S01、Phase 1 进度 +10pp

- **FR-003**: System MUST 在 ESM 模块系统下通过异步 `import('file:///...')` 加载 CommonJS 风格的 Sub-Skill/Lib，避免 `require is not defined` 运行时错误
  - **来源**：plan.md §7 C1（本会话内已踩并修复的 Bug）
  - **验收**：`test-esm-import.mjs` 输出 HM 4 函数 + SM 4 函数全部 PRESENT

- **FR-004**: System MUST 在 spec-bootstrap Skill 与 orchestrator-state-machine 之间保持「特征目录探测」的写读一致性，统一使用 `findFirstFeatureDir()` / `findFeatureDir()` 实现
  - **来源**：plan.md §7 C2 + §3 Contract Consistency
  - **验收**：spec 目录名非 `001-feature` 时（如本项目的 `001-test`），clarify/plan/checklist/tasks 都能正确找到 spec.md，不报 not found

- **FR-005**: System MUST 在 clarify Skill 成功执行后写 `.clarified` 标记文件，并在 SM S03.detect 中接受 3 种信号（`.clarified` 存在 / spec.md 含 `## 已澄清` / spec.md 含 `## Clarifications`）任意命中其一
  - **来源**：plan.md §7 C3
  - **验收**：clarify CLI 跑完后 recompute → S03 出现在 completedSteps

- **FR-006**: System MUST 提供 4 种仪表盘输出格式（Markdown 表格 / HTML 响应式 / JSON 快照 / 周报），并支持 `scanNpm=true/false` 开关控制是否真实运行 `npm outdated --json`
  - **来源**：plan.md §6 M4 + §7 C6
  - **验收**：smoke-p2.cjs 输出 md+html+json+周报 4 种格式且字节数分别 > 300

### Key Entities

- **HealthMonitorEvent**: 7 类事件（task.start / task.complete / rollback.exec / clarify.issue / complaint.user / build.fail / build.success），每条含 `timestamp` + `eventType` + `payload`，append 到 `.orchestrator-health/events.ndjson`
- **OrchestratorState**: 19 步完成位 + 当前 Phase + 历史 transition 记录，持久化到 `.orchestrator-sm/state.json`
- **StepDefinition**: 每步含 `id`（S01-S19）/ `phase` / `name` / `requires`（前置步骤）/ `detect()`（存在性判定函数）/ `tool`（对应 MCP Tool 名）/ `reason`（下一步推荐文案）
- **SkillOutputContract**: 所有 Sub-Skill 与 Lib 模块统一返回 `{ ok, data, warnings, nextActions, errors, path }` 结构，便于 orchestrator-tools.ts 标准化为 MCP 文本

## Success Criteria

- **SC-001**: Phase 1 完成度 ≥ 80%（即 8/10 必需步骤完成，对应 S01-S06 + S07 + S11），进入 Phase 2 前由 `orchestrator_next()` 推荐下一步
  - **度量**：`orchestrator_status` 返回 `phaseProgress["1"].pct >= 80`
  - **当前**：S05 完成后为 70%（7/10），S06 完成后预期 80%（8/10）

- **SC-002**: 6 个 P2 新增 MCP Tool 全部在 TRAE 中可见且可调用
  - **度量**：MCP 面板 `orchestrator-tools` 状态 🟢 已连接 + 搜 `health_monitor_` 出现 3 个 + 搜 `orchestrator_` 出现 3 个
  - **当前**：代码层已就绪（dist/orchestrator-tools.js 中 6 Tool 注册），TRAE 侧需用户手动重连后验证（CHK-S04）

- **SC-003**: 构建门 4 项全通过（TS 0 errors / build 成功 / ESM smoke 通过 / smoke-p2.cjs 全断言 PASS）
  - **度量**：checklist.md §1 CHK-B01~B04 全部 ✅
  - **当前**：4/4 = 100% ✅

- **SC-004**: 进入 Phase 2 准入门槛 14 项全通过（构建门 4 + 治理门 5 + 模块边界 4 + 内容门 CHK-C01/C05）
  - **度量**：checklist.md §9 总计 14/14
  - **当前**：本文件重写后 CHK-C01/C05 通过 → 14/14 = 100% ✅

## Scope Boundaries

**本 spec 包含**：
- P2 修复 6 个新 MCP Tool 的功能需求（FR-001 ~ FR-006）
- 编排状态机 Phase 1 推进流程的验收场景（US-01 的 4 个 Acceptance Scenarios）
- 进入 Phase 2 的准入门槛量化（SC-001 ~ SC-004）

**本 spec 不包含**（留待 Phase 2 / Phase 3）：
- Phase 2 openspec-implementer → implement → test → commit 四步的具体实现
- Phase 3 review / audit / env 三步的具体执行
- spec-bootstrap Skill 自身的代码层修复（如 resolveSpecPath 统一路径、内容校验等，列入 §7 坑 1 的长期修复建议）

## Out-of-Scope Disclaimers

- 本 spec 不描述具体源码实现（遵循 1925179 / 100000920 越界红线）
- 本 spec 不输出任何可执行命令（Shell 命令、CLI 调用示例仅出现在 Acceptance Scenarios 的验证步骤中，作为质量门验收方法，不作为代码生成依据）
- 本 spec 中所有「来源」字段指向 [plan.md](./plan.md) / [checklist.md](./checklist.md) / [constitution.md](../../.specify/memory/constitution.md) 的具体章节，确保三文档 scope 一致（满足 CHK-C04）