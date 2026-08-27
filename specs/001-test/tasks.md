# Tasks: P2 修复 + 编排推进

> 基于 [plan.md](./plan.md) §5 模块拆分 + §6 里程碑 + §7 复杂度风险
> 严格按 Phase 顺序执行，每条任务可独立验收
> **不生成任何源码**（遵循 1925179 / 100000920 / CHK-T03）

## Phase 1: Setup（共享基础设施）

- [ ] **T001** [S] 创建 .orchestrator-sm/ 目录与 state.json 初始结构  
  **验收**: orchestrator_status 返回 currentPhase=1、phaseProgress 3 个 Phase  
  **来源**: plan.md §5 目录树 + §7 C1  
  **依赖**: 无

- [ ] **T002** [S] 创建 .orchestrator-health/ 目录与 events.ndjson 空文件  
  **验收**: health_monitor_check(scanNpm=false) 返回 healthy=true、4 指标全 0  
  **来源**: plan.md §5 目录树 + §7 C6  
  **依赖**: 无

- [ ] **T003** [M] 实现 health-monitor.js 的 4 项指标计算函数  
  **验收**: smoke-p2.cjs 模拟 12 任务+4 撤销+40 澄清+12 投诉 → rollbackRate=33.3%、clarifyPerTask=3.33、complaintPerWeek=12  
  **来源**: plan.md §7 C6 + spec.md FR-001  
  **依赖**: T002

- [ ] **T004** [M] 实现 health-monitor.js 的 4 种仪表盘输出（MD/HTML/JSON/周报）  
  **验收**: smoke-p2.cjs 输出 4 种格式且字节数分别 > 300  
  **来源**: plan.md §6 M4 + spec.md FR-006  
  **依赖**: T003

- [ ] **T005** [L] 实现 orchestrator-state-machine.js 的 19 步 detect() 函数  
  **验收**: 空项目 → nextCandidates 第一顺位 S01；S01 完成后 recompute → completedSteps 含 S01  
  **来源**: plan.md §6 M1-M10 + spec.md FR-002  
  **依赖**: T001

- [ ] **T006** [M] 实现 orchestrator-state-machine.js 的 status/next/transition API  
  **验收**: transition(recompute) + status + next 三个调用都返回结构化 JSON  
  **来源**: plan.md §5.1 第 3 行 + spec.md FR-002  
  **依赖**: T005

## Phase 2: Foundational（阻塞前置）

- [ ] **T010** [M] [US1] 在 orchestrator-tools.ts 中注册 6 个新 MCP Tool 定义  
  **验收**: dist/orchestrator-tools.js 中搜到 6 个 tool 名（health_monitor_record_event/check/dashboard + orchestrator_status/next/transition）  
  **来源**: plan.md §5.1 第 1 行 + spec.md FR-001/FR-002  
  **依赖**: T004, T006

- [ ] **T011** [S] [US1] 实现 requireLib() 异步 import() 加载（ESM 兼容）  
  **验收**: test-esm-import.mjs 输出 HM 4 函数 + SM 4 函数全部 PRESENT  
  **来源**: plan.md §7 C1 + spec.md FR-003  
  **依赖**: T010

- [ ] **T012** [M] [US1] 统一 findFeatureDir() 在 spec-bootstrap 与 SM 的实现  
  **验收**: spec 目录名非 001-feature 时（如 001-test），clarify/plan/checklist/tasks 都能找到 spec.md  
  **来源**: plan.md §7 C2 + §3 Contract Consistency + spec.md FR-004  
  **依赖**: T010

- [ ] **T013** [S] [US1] 在 clarify Skill 写 .clarified 标记 + SM S03.detect 3 信号兼容  
  **验收**: clarify CLI 跑完后 recompute → S03 出现在 completedSteps  
  **来源**: plan.md §7 C3 + spec.md FR-005  
  **依赖**: T012

## Phase 3: 编排推进与验证（User Story 1 - MVP）

- [ ] **T020** [S] [US1] 执行 S01 spec_bootstrap_constitution 建立宪法  
  **验收**: .specify/memory/constitution.md 存在且非空  
  **来源**: plan.md §6 M1  
  **依赖**: T006

- [ ] **T021** [S] [US1] 执行 S02 specify + S03 clarify 闭环  
  **验收**: specs/001-test/spec.md + .clarified 存在  
  **来源**: plan.md §6 M2  
  **依赖**: T020

- [ ] **T022** [M] [US1] 执行 S04 plan + S05 checklist + S06 tasks（本文件）  
  **验收**: specs/001-test/ 下 plan.md + checklist.md + tasks.md 三件齐全  
  **来源**: plan.md §6 M3-M5  
  **依赖**: T021

- [ ] **T023** [S] [US1] 执行构建门验证（TS 0 errors + build + smoke）  
  **验收**: checklist.md §1 CHK-B01~B04 全 PASS  
  **来源**: plan.md §3 TDD  
  **依赖**: T022

## Phase 4: 质量保障与准入

- [ ] **T030** [S] [US1] 验证内容门 CHK-C01/C05（spec.md 非占位）  
  **验收**: spec.md 字节数 > 1000 且无 3 个以上 [xxx] 占位  
  **来源**: checklist.md §3  
  **依赖**: T021

- [ ] **T031** [S] [US1] 验证治理门 CHK-G01~G04（宪法 + Library-First + API-First + Contract Consistency）  
  **验收**: checklist.md §2 4 项全 PASS  
  **来源**: checklist.md §2  
  **依赖**: T020, T010

- [ ] **T032** [S] [US1] 验证模块边界门 CHK-M01~M04  
  **验收**: checklist.md §6 4 项全 PASS  
  **来源**: checklist.md §6  
  **依赖**: T010, T012

- [ ] **T040** [S] 文档：更新 SKILL.md entry-points（14 → 20）+ binds  
  **验收**: SKILL.md 含 20 个 entry-points + 15 个 binds  
  **来源**: plan.md §4 Architecture Layer 3  
  **依赖**: T010

## 复杂度标签说明

| 标签 | 含义 | 验收粒度 |
|---|---|---|
| **[S]** | Small · 单文件改动 · 1 个函数 | 单次调用可验证 |
| **[M]** | Medium · 多文件或单模块 · 2-5 个函数 | 单次 smoke 可验证 |
| **[L]** | Large · 跨模块改动 · 5+ 函数 | 多次调用 + 集成验证 |

## 依赖图

```
T001 ─┬─ T005 ─ T006 ─┬─ T020 ─ T021 ─ T022 ─ T023
      │              │
T002 ─┼─ T003 ─ T004 ─┤
      │              ├─ T010 ─┬─ T011
      │              │        ├─ T012 ─ T013
      │              │        ├─ T031
      │              │        └─ T032
      │              └─ T040
      └─ T030
```

## 执行顺序建议

1. **Phase 1** (T001-T006): 基础设施 — health-monitor + state-machine lib
2. **Phase 2** (T010-T013): MCP 集成 — 注册 Tool + ESM 兼容 + 写读一致
3. **Phase 3** (T020-T023): 编排推进 — S01→S06 实际执行 + 构建验证
4. **Phase 4** (T030-T040): 质量保障 — 内容/治理/边界门验证 + 文档更新

## 不包含（Out of Scope）

- 不生成任何源码实现（遵循 1925179 / CHK-T03）
- 不给出小时/天数估算（遵循 No-Estimate / CHK-T02）
- 不包含 Phase 2 openspec-implementer → implement → test → commit 的具体任务（留待 S13 后）
- 不包含 Phase 3 review/audit/env 的具体任务（留待 S17-S19）
