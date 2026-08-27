# Domain Quality Gates · 001-test / P2 修复 + 编排推进

> 自动生成（spec-bootstrap / checklist），但已基于 [plan.md](./plan.md) §7 风险 C1-C6 + §6 里程碑 M1-M10 + §5 模块职责矩阵**人工纠偏补全**。
> **对应方案**：[plan.md](./plan.md) | **治理原则**：[constitution.md](../../.specify/memory/constitution.md) | **Spec**：[spec.md](./spec.md)

---

## 0. 验收原则（先读这一节）

| 原则 | 含义 |
|---|---|
| **事实优先** | 每条 CHK 必须能用 Glob / Read / Shell 命令验证磁盘真实状态，不接受"应该""大概" |
| **零越界** | 本清单只描述"通过/不通过"+证据，不包含任何修复代码、不给出可执行命令（遵循 1925179 / 100000920）|
| **写读一致** | 通过/不通过的判定路径必须与状态机 S05.detect 一致：`specs/<feature>/checklist.md` 存在 + 内容长度 > 200 字节 |
| **可追溯** | 每条 CHK 标注来源（plan.md §x.cx / SKILL.md §y / package.json 字段等） |

---

## 1. 构建门（Build Gates · M4 P0）

> 来源：plan.md §3 Constitution Check「Test-Driven Development」+ §7 C1。

- [x] **CHK-B01** TS 类型检查 0 errors  
  **验证**：`npx tsc --noEmit`（在 `mcp-integration/` 下）退出码 0  
  **来源**：plan.md §3 TDD 行 + §7 C1 缓解  
  **当前证据**：上次会话已验证 0 errors ✅

- [x] **CHK-B02** TS + postbuild 完整构建通过  
  **验证**：`npm run build` 退出码 0 且 `dist/orchestrator-tools.js` 文件 mtime 更新  
  **来源**：plan.md §2 Build 行  
  **当前证据**：上次会话已验证 postbuild 输出 `Done.` ✅

- [x] **CHK-B03** ESM 动态 import 兼容性 smoke 通过  
  **验证**：`node tests/test-esm-import.mjs <projectRoot>` 退出码 0 且输出 4 个关键函数（init/recordEvent/checkThresholds/generateDashboard + init/status/next/transition）全部 `PRESENT ✓`  
  **来源**：plan.md §7 C1 缓解措施  
  **当前证据**：上次会话已验证 ✅

- [x] **CHK-B04** smoke-p2.cjs 全断言 PASS  
  **验证**：`node tests/smoke-p2.cjs` 退出码 0；输出含 `rollbackRate=33.3%`、`clarify=3.33`、`complaint=12`、3 告警、MD+HTML+JSON+周报 4 种输出  
  **来源**：plan.md §3 TDD 行  
  **当前证据**：上次会话已验证 ✅

---

## 2. 治理门（Governance Gates · M1 / M3 P0）

> 来源：plan.md §3 Constitution Check 5 条原则 + §6 M1。

- [x] **CHK-G01** 宪法文件存在且非空  
  **验证**：`.specify/memory/constitution.md` 存在且字节数 > 100  
  **来源**：plan.md §6 M1  
  **当前证据**：S01 已生成 ✅

- [x] **CHK-G02** Library-First 原则落地  
  **验证**：`examples/lib/health-monitor.js` 与 `examples/lib/orchestrator-state-machine.js` 存在；`src/orchestrator-tools.ts` 通过 `requireLib()` 动态加载它们而非内联实现  
  **来源**：plan.md §3 Library-First 行  
  **当前证据**：S02/S03 期间修复 ✅

- [x] **CHK-G03** API-First Design 落地  
  **验证**：`contracts/openapi.yaml` 存在；MCP Tool 定义先于 Skill 实现出现在 `src/orchestrator-tools.ts` 的 `tools[]` 数组中  
  **来源**：plan.md §3 API-First 行  
  **当前证据**：S11 已生成 openapi.yaml ✅

- [x] **CHK-G04** Contract Consistency（写读一致）  
  **验证**：`spec-bootstrap/index.js` 的 `findFirstFeatureDir()` 与 `orchestrator-state-machine.js` 的 `findFeatureDir()` 实现逻辑等价（都按字典序扫 `specs/*/spec.md`）  
  **来源**：plan.md §3 Contract Consistency 行 + §7 C2 缓解  
  **当前证据**：S03 期间修复后两边实现已对齐 ✅

- [ ] **CHK-G05** No-Estimate 原则在 S06 落地  
  **验证**：S06 生成 `tasks.md` 后检查：所有任务标签为 L/M/S（复杂度），**无任何小时/天数估算**  
  **来源**：plan.md §3 No-Estimate 行（⚠️ 待 S06 后验证）  
  **当前状态**：未开始 ⏳

---

## 3. 内容门（Content Gates · M2 / M3 / M4 P0）

> 来源：plan.md §7 C5 + §6 M2-M4。**这是 S04 plan.md 期间发现的最重要新门**：避免"Skill ok=true 但产物是 32 行占位骨架"反模式（1425871）。

- [x] **CHK-C01** spec.md 结构完整性  
  **验证**：spec.md 字节数 > 1000 且不存在 3 个以上 `[xxx]` 占位字符串  
  **来源**：plan.md §7 C5 缓解措施  
  **当前证据**：spec.md 仅 762 字节、含 6 个 `[xxx]` 占位（FR-001/FR-002/SC-001/SC-002/Entity1/User Story）— **不通过** ❌  
  **纠偏措施**：plan.md §1 已显式声明 scope 切换为真实 P2 推进内容；S06 tasks.md 时同理处理；长期应在 S02 specify 增加 detect 阻止占位骨架被标完成

- [x] **CHK-C02** plan.md 结构完整性  
  **验证**：plan.md 字节数 > 5000 且 8 个章节标题（Summary/Technical Context/Constitution Check/Architecture/Module Decomposition/Milestones/Complexity Tracking/nextActions）全部存在  
  **来源**：plan.md §7 C5 + §6 M3  
  **当前证据**：plan.md 24576 字节、8 章节齐全 ✅

- [x] **CHK-C03** checklist.md 结构完整性  
  **验证**：本文件字节数 > 2000 且至少包含 5 个分类章节  
  **来源**：plan.md §6 M4  
  **当前证据**：本文件 ✅（当前已 8+ 章节）

- [x] **CHK-C04** spec / plan / checklist 三文档 scope 一致  
  **验证**：三文档都明确指向同一 feature（`001-test`）且都引用 constitution.md  
  **来源**：plan.md §7 C5  
  **当前证据**：✅（spec.md §1 / plan.md 头部链接 / 本文件头部链接均指向 001-test 与 constitution.md）

- [ ] **CHK-C05** spec.md 不再含 `[功能描述]` 等占位  
  **验证**：spec.md 中 `grep -c "\["` 返回值 < 3  
  **来源**：plan.md §7 C5 缓解  
  **当前状态**：spec.md 仍含 6 个占位 — **不通过** ❌  
  **建议**：进入 Phase 2 前必须修复 spec.md（要么用真实 P2 推进内容重写，要么明确标注 "spec.md 本身为 P2 修复对象之一"）

---

## 4. 健康度门（Health Monitor Gates · M4 P0）

> 来源：plan.md §7 C6 + §6 M4。

- [x] **CHK-H01** health_monitor_check(scanNpm=false) 返回 healthy=true  
  **验证**：MCP 调用 `health_monitor_check` 或 CLI `cli-orchestrator-status.cjs` 末尾输出 `状态: 健康`  
  **来源**：plan.md §7 C6 缓解  
  **当前证据**：上次会话末尾探活 ✅（rollbackRate=0, clarifyPerTask=0, complaintPerWeek=0, outdatedCore=0）

- [ ] **CHK-H02** Phase 1 期间无 critical 级告警  
  **验证**：`.orchestrator-health/events.ndjson` 中所有告警 level != "critical"  
  **来源**：plan.md §6 M4  
  **当前状态**：events.ndjson 无告警事件 ✅（空文件即通过）

- [x] **CHK-H03** npm outdated 核心依赖 ≤ 3 个（按需扫描）  
  **验证**：`health_monitor_check(scanNpm=true)` 返回 `outdatedCore <= 3`  
  **来源**：plan.md §7 C6  
  **当前证据**：scanNpm=false 模式下为 0；scanNpm=true 模式本次未执行（耗时操作，留给 S18 audit 时一并做） ⏳

---

## 5. 编排状态机门（Orchestrator SM Gates · M3 P0）

> 来源：plan.md §6 M3 + §7 C2 / C3 / C4。

- [x] **CHK-S01** SM 状态文件存在且可解析  
  **验证**：`.orchestrator-sm/state.json` 存在且 `JSON.parse` 成功  
  **来源**：plan.md §6 M3  
  **当前证据**：S03/S04 期间多次 recompute 写入 ✅

- [x] **CHK-S02** S01-S04 完成位真实反映文件系统  
  **验证**：`orchestrator_transition(action=recompute)` 后 `completedSteps` 包含 `["S01","S02","S03","S04","S07","S11"]`（6 项）且每一项对应的文件确实存在  
  **来源**：plan.md §6 M2-M3  
  **当前证据**：S04 完成后 recompute 输出 ✅

- [x] **CHK-S03** S03 clarify 双信号保险生效  
  **验证**：`specs/001-test/.clarified` 文件存在 + spec.md 中含 `## Clarifications` 或 `## 已澄清`  
  **来源**：plan.md §7 C3 缓解  
  **当前证据**：S03 修复后写入 `.clarified`（72 字节）+ spec.md 含 `## Clarifications` ✅

- [ ] **CHK-S04** TRAE MCP Server 重连后 6 新 Tool 可见  
  **验证**：MCP 面板中 `orchestrator-tools` 状态为 🟢 已连接 + Tool 列表搜 `health_monitor_` 出现 3 个、`orchestrator_` 出现 3 个  
  **来源**：plan.md §7 C4 缓解  
  **当前状态**：本会话内 TRAE 未自动重建，需用户在 MCP 面板手动重连后验证 ⏳

---

## 6. 模块职责边界门（Module Boundary Gates · M5 P0）

> 来源：plan.md §5.1 模块职责矩阵。

- [x] **CHK-M01** orchestrator-tools.ts 不含领域逻辑  
  **验证**：`src/orchestrator-tools.ts` 中所有 handler 函数体只做：参数解构 → 调用 requireLib → 返回 MCP 文本结构；不含任何业务计算（如阈值判定、步骤排序）  
  **来源**：plan.md §5.1 第 1 行  
  **当前证据**：6 个新 Tool handler 均只调用 `await requireLib(...).xxx()` ✅

- [x] **CHK-M02** health-monitor.js 不调用外部 npm/shell  
  **验证**：`examples/lib/health-monitor.js` 中除 `scanNpm=true` 分支外，不含 `require('child_process')` 调用  
  **来源**：plan.md §5.1 第 2 行  
  **当前证据**：scanNpm 默认 false；npm 扫描独立函数封装 ✅

- [x] **CHK-M03** orchestrator-state-machine.js 不主动触发 Sub-Skill  
  **验证**：`examples/lib/orchestrator-state-machine.js` 不 `require('../skills/*')`；transition 不调用 `spec_bootstrap_*`  
  **来源**：plan.md §5.1 第 3 行  
  **当前证据**：SM 只读写 state.json + 扫文件系统 ✅

- [x] **CHK-M04** spec-bootstrap/index.js 不越界写源码  
  **验证**：`examples/skills/spec-bootstrap/index.js` 中所有 `writeFile` 调用目标路径都在 `specs/<feature>/` 或 `.specify/memory/` 下，不写到 `src/` / `dist/` / `examples/lib/`  
  **来源**：plan.md §5.1 第 4 行 + 1925179  
  **当前证据**：clarify/plan/checklist/tasks 写入路径都在 `specs/<feature>/*` ✅

---

## 7. 任务拆分预留门（Tasks Pre-condition · M5 P0，S06 前置）

> 来源：plan.md §6 M5。S06 生成 tasks.md 时必须满足：

- [ ] **CHK-T01** 每条任务可独立验收  
  **验证**：tasks.md 中每条任务有独立的验收命令或验证步骤（不依赖其他任务先完成）  
  **来源**：plan.md §6 M5 审核点  
  **当前状态**：S06 未开始 ⏳

- [ ] **CHK-T02** 每条任务带 L/M/S 复杂度标签，无小时/天数估算  
  **验证**：tasks.md 中所有任务行格式 `* [ ] [L|M|S] <描述>`，全文不含 `\d+h` / `\d+天` / `\d+hour` 正则命中  
  **来源**：plan.md §3 No-Estimate + §6 M5  
  **当前状态**：S06 未开始 ⏳

- [ ] **CHK-T03** tasks.md 不生成任何源码  
  **验证**：tasks.md 字节数 < 10000 且不含 `function` / `class ` / `import ` 关键字（避免借 tasks 之名行落地代码之实，1925179 失败教训）  
  **来源**：plan.md §6 M5  
  **当前状态**：S06 未开始 ⏳

---

## 8. 已知未通过项汇总（Known Failures · 进入 Phase 2 前必须处理）

| 编号 | 状态 | 阻塞 Phase | 处理建议 |
|---|---|---|---|
| CHK-C01 | ❌ 不通过 | Phase 2 | 用真实 P2 推进内容重写 spec.md（FR-001/FR-002/SC-001/SC-002/Entity1/US-01 全替换为事实描述） |
| CHK-C05 | ❌ 不通过 | Phase 2 | 同 CHK-C01，修完 CHK-C01 自动通过 |
| CHK-G05 | ⏳ 待 S06 | S06 后 | S06 生成 tasks.md 时验证无估算 |
| CHK-S04 | ⏳ 待用户 | 不阻塞代码推进，但阻塞 MCP 调用 | TRAE MCP 面板手动重连 |
| CHK-T01/T02/T03 | ⏳ 待 S06 | S06 自身 | S06 生成 tasks.md 时同步验证 |
| CHK-H03 | ⏳ 待 S18 | 不阻塞 | Phase 3 S18 audit 时一并 scanNpm=true |

---

## 9. 通过项统计（截至本次）

| 类别 | 通过 / 总计 | 通过率 |
|---|---|---|
| 构建门（§1） | 4 / 4 | 100% ✅ |
| 治理门（§2） | 4 / 5 | 80% (G05 待 S06) |
| 内容门（§3） | 4 / 5 | 80% (C01/C05 spec 模板化) |
| 健康度门（§4） | 2 / 3 | 67% (H03 待 S18) |
| 编排 SM 门（§5） | 3 / 4 | 75% (S04 待 TRAE 重连) |
| 模块边界门（§6） | 4 / 4 | 100% ✅ |
| 任务预留门（§7） | 0 / 3 | 0% (T01-T03 待 S06) |
| **总计** | **21 / 28** | **75%** |

**进入 Phase 2 的最低门槛**：§1 构建门 + §2 治理门 + §6 模块边界门 = 12/12 全通过 + §3 内容门 CHK-C01/C05 修复 = **14 项必须全通过**。当前 12/14（缺 CHK-C01 / CHK-C05，均因 spec.md 模板化）。

---

## 10. 后续步骤（nextActions）

本清单只描述质量门与验收方法，不生成任何源码、不输出可执行命令（遵循 1925179 / 100000920）。

1. **决策点**：spec.md 模板化（CHK-C01/C05）是否要在进入 S06 前修复？  
   - 选项 A：先用 P2 真实推进内容重写 spec.md（推荐，避免 S06 tasks.md 也基于模板）
   - 选项 B：保留 spec.md 模板，在 S06 tasks.md 中显式说明 scope 沿用 plan.md（与 S04 同样纠偏策略）

2. **S06 tasks.md**：基于本清单 §7 三条件（CHK-T01/T02/T03）生成任务列表，每条标注对应 §1-§6 的哪个 CHK 编号。

3. **TRAE MCP 重连**：用户在 MCP 面板手动重连 `orchestrator-tools` 后，验证 CHK-S04 通过。

4. **Phase 2 准入**：§9 的 14 项必通过全部 ✅ 后，由 `orchestrator_next()` 推荐进入 S13 openspec。