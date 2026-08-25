---
name: openspec-workflow
description: |
 兼容 OpenSpec 工作流设计的提案驱动变更管理（自研实现，不依赖 OpenSpec CLI）。
 完整 PROPOSAL → SPEC delta → TASKS → ARCHIVE 流程。
 支持棕地修改（brownfield）场景，单一事实源保持同步。
version: 1.0.0
tags:
  - openspec
  - change-management
  - proposal-driven
  - spec-evolution
entry-points:
  - propose
  - apply
  - archive
requires:
  - node: ">=18.0.0"
  - git: ">=2.30 (optional)"
binds: []
parent: project-orchestrator
phase: 2.1
position: change-start
---

# openspec-workflow

> 提案驱动的规范演进流程。

## 一、能力范围

### 1.1 `/propose` 发起变更

```bash
/change "新增工时统计功能"
# 内部自动：
#   1. 扫描现有 spec.md
#   2. 生成 PROPOSAL.md（变更原因、范围、影响）
#   3. 生成 SPEC delta（与现行 spec 的 diff）
#   4. 生成 TASKS.md（拆解为可执行任务）
#   5. 创建 git 分支 openspec/changes/001-add-timesheet
```

### 1.2 `/apply` 应用变更

```bash
/change.apply openspec/changes/001-add-timesheet
# 内部自动：
#   1. 合并 SPEC delta 到主 spec.md
#   2. 执行 TASKS.md 中的任务
#   3. 生成 ARCHIVE（变更归档 + 决策记录）
#   4. 合并 git 分支
```

### 1.3 `/archive` 仅归档

```bash
/change.archive openspec/changes/001-add-timesheet
# 不应用变更，仅归档到 openspec/changes/archive/
```

## 二、完整 6 步流程

```
用户输入（自然语言）
        ↓
① 生成 PROPOSAL.md（变更原因 / 范围 / 影响）
        ↓
② 与现行 SPEC.md 做 diff，识别需更新的规范章节
        ↓
③ 生成 SPEC delta（ADDED / MODIFIED / REMOVED Requirements）
        ↓
④ 生成 TASKS.md（拆解为可执行任务）
        ↓
⑤ 执行修改：规范 → API 契约 → UI 原型 → 代码
        ↓
⑥ 生成 ARCHIVE（变更归档 + 决策记录）
```

## 三、PROPOSAL.md 模板

```markdown
# Proposal: [变更标题]

**Change ID**: 001-add-timesheet
**Status**: Draft | In Review | Approved | Applied | Archived
**Author**: [name]
**Created**: 2026-08-24
**Target Release**: v1.2.0

## Why

[1-3 段描述：为什么要做这个变更？业务背景、用户痛点、商业价值]

## What Changes

[具体列出变更内容]
- 新增 [功能 1] 在 [模块 X]
- 修改 [行为 2] 的 [默认值]
- 删除 [已废弃的 Y]

## Impact

| 维度 | 影响 |
|---|---|
| 受影响的 Spec 章节 | §X.Y, §Z.W |
| 受影响的 API endpoints | GET /api/v1/..., POST /api/v1/... |
| 受影响的 UI 页面 | /timesheet/list, /timesheet/detail |
| 数据库迁移 | 是（新增 timesheet 表） |
| Breaking Change | 否 |
| 回滚方案 | git revert commit; drop table timesheet |

## Success Criteria

- [ ] SC-1：用户可在 [时长] 内完成 [任务]
- [ ] SC-2：API P95 延迟 < [X] ms
- [ ] SC-3：单元测试覆盖率 ≥ 80%
```

## 四、SPEC Delta 模板

```markdown
## ADDED Requirements

### Requirement: 工时记录
系统 SHALL 提供工时记录功能。

#### Scenario: 用户记录工时
- WHEN 用户在工时页面提交表单
- THEN 系统 SHALL 保存工时记录
- AND 返回 201 Created

#### Scenario: 工时聚合查询
- WHEN 用户查询本周工时
- THEN 系统 SHALL 返回按项目聚合的工时数据

## MODIFIED Requirements

### Requirement: 项目列表（修改）
原内容: ...
新内容: ...（包含工时字段）

## REMOVED Requirements

### Requirement: 旧版统计报表
原因：被新版统计取代
```

## 五、TASKS.md 模板

```markdown
## Phase 1: Schema & Migration
- [ ] T001 [P] 创建 timesheet 表的 migration
- [ ] T002 [P] 创建 Timesheet entity

## Phase 2: API
- [ ] T003 [P] 定义 OpenAPI: POST /api/v1/timesheets
- [ ] T004 [P] 定义 OpenAPI: GET /api/v1/timesheets
- [ ] T005 实现 timesheet service
- [ ] T006 实现 timesheet controller

## Phase 3: UI
- [ ] T010 [P] [US-X] 创建 /timesheet/list 页面
- [ ] T011 [US-X] 实现工时录入表单
- [ ] T012 [US-X] 实现工时聚合图表

## Phase 4: 测试 & 部署
- [ ] T020 集成测试
- [ ] T021 灰度发布

⚠️ Checkpoint: 每个 Phase 必须通过测试才能进入下一 Phase
```

## 六、ARCHIVE.md 模板

```markdown
# Archive: 001-add-timesheet

## Metadata
- **Change ID**: 001-add-timesheet
- **Title**: 新增工时统计功能
- **Applied**: 2026-09-15
- **Author**: [name]
- **Reviewers**: [@alice, @bob]

## Summary
[1-2 段最终实施总结]

## Spec Changes
- ADDED: 工时记录（§3.2）
- MODIFIED: 项目列表（§2.1）
- REMOVED: 旧版统计报表（§4.5）

## Decisions
| Decision | Rationale | Alternatives Considered |
|---|---|---|
| 选择 PostgreSQL | 团队熟悉 | MySQL, MongoDB |
| 工时粒度 15min | 业务需求 | 5min, 1h |

## Lessons Learned
- L1：SCHEMA 变更前需先与 DBA 同步
- L2：UI 原型应在 PROPOSAL 阶段同步出图

## Related Links
- PR: [link]
- Slack: [link]
- Confluence: [link]
```

## 七、与 Phase 1 的衔接

openspec-workflow 的产物会**反向更新** Phase 1 产出的 `spec.md`、`openapi.yaml`、HTML 原型，保持单一事实源：

```
Phase 1.1  spec.md  ────────→  openspec/changes/001-x/SPEC-delta.md
                                    │
                                    ▼
                            合并 → spec.md（更新版）
                                    │
                                    ▼
                            触发 ui-design 重新生成 HTML
                                    │
                                    ▼
                            触发 api-contract 重新生成 OpenAPI
```

## 八、失败回退

| 失败点 | 恢复动作 |
|---|---|
| PROPOSAL 评审未通过 | 回退到 Draft 状态 |
| SPEC delta 与现行 spec 冲突 | 列出冲突点，人工介入 |
| TASKS 执行失败 | 禁止进入下一 Phase，回到对应任务修复 |
| ARCHIVE 缺失 | 警告 + 强制补写 |

## 九、依赖

- Node.js: >=18.0.0（唯一硬依赖）
- Git: 可选（用于分支管理）
- 现有 spec.md（来自 spec-bootstrap）
- 本 Skill 兼容 OpenSpec 工作流设计，但**不依赖 OpenSpec CLI**，所有命令均为自研实现

## 十、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `spec-bootstrap`（提供 baseline spec）
- 下游: `ui-design`, `api-contract`（同步更新）

## 十一、许可

MIT