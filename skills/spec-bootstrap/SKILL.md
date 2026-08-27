---
name: spec-bootstrap
description: |
 兼容 SpecKit 工作流设计的项目初始化规范生成（自研实现，不依赖 SpecKit CLI）。
 实现 constitution / specify / clarify / plan / checklist / tasks / analyze / implement 完整工作流。
 强制写入顶层宪法 + 严格规范驱动。
version: 1.0.0
tags:
  - spec-driven-development
  - speckit
  - project-init
entry-points:
  - default
requires:
  - node: ">=18.0.0"
binds: []
parent: project-orchestrator
phase: 1.1
position: bootstrap-start
---

# spec-bootstrap

> 把自然语言需求转化为可被多个 AI 代理执行的工程任务包。

## 一、能力范围

| 命令 | 用途 | 设计来源 |
|---|---|---|
| `spec_bootstrap_constitution` | 建立治理宪法 | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_specify` | 创建首个 feature 的 spec | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_clarify` | 消除歧义，最多 5 个问题 | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_plan` | 技术化 + 架构 | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_checklist` | 领域质量门 | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_tasks` | 任务拆分 | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_analyze` | 一致性扫描 | 兼容 Spec Kit 工作流 |
| `spec_bootstrap_implement` | 执行实现 | 兼容 Spec Kit 工作流 |

> **关于 Spec Kit CLI**：本 Skill 兼容 Spec Kit 工作流设计，但**不依赖 specify-cli 或任何外部 CLI**，所有命令均为自研实现。如需对比官方 Spec Kit 行为，可参考其文档，但无需安装。

## 二、使用方法

### 2.1 一次性环境准备

无外部 CLI 依赖。唯一硬依赖为 **Node.js >= 18.0.0**。在支持 MCP 的客户端（TRAE / Claude Code / Cursor）中加载 `orchestrator-tools` MCP Server 后即可直接调用。

### 2.2 完整 Bootstrap（推荐）

通过 MCP Tool 或父 Skill entry-point 调用：

```
MCP Tool: spec_bootstrap_specify → spec_bootstrap_plan → spec_bootstrap_tasks → ...
父 Skill entry-point: bootstrap
```

内部自动按以下顺序执行：

```
Step 0  环境校验（Node.js 版本 + MCP 连通性）
Step 1  Constitution 建立（用户回答问卷 → constitution.md）
Step 2  Specify（自然语言 → spec.md）
Step 3  Clarify（如有 NEEDS CLARIFICATION，最多 5 个问题）
Step 4  Plan（技术栈 → plan.md + research.md + data-model.md + contracts/ + quickstart.md）
Step 5  Checklist（生成 spec-quality.md）
Step 6  Tasks（按 Phase 分层 + [P] [Story] 标记）
Step 7  Analyze（spec ↔ plan ↔ tasks 一致性）
Step 8  Implement（按 Phase 执行 + Checkpoint）
```

### 2.3 单独调用（MCP Tool）

```
spec_bootstrap_constitution   # 仅建立宪法
spec_bootstrap_specify        # 仅生成 spec（传入需求 description）
spec_bootstrap_plan           # 仅技术化（基于 spec.md）
spec_bootstrap_tasks          # 仅任务拆分（基于 plan.md）
```

## 三、关键产出物

### 3.1 constitution.md 模板

```markdown
# [PROJECT_NAME] Constitution

## Core Principles
### [PRINCIPLE_1_NAME]
### [PRINCIPLE_2_NAME]
### [PRINCIPLE_3_NAME]
### [PRINCIPLE_4_NAME]
### [PRINCIPLE_5_NAME]

## [SECTION_2_NAME]  ← 如 Tech Stack / Quality Gates
## [SECTION_3_NAME]
## Governance
[GOVERNANCE_RULES]

**Version**: [V] | **Ratified**: [DATE] | **Last Amended**: [DATE]
```

### 3.2 spec.md 模板（强制章节）

```markdown
# Feature Specification: [FEATURE]

**Feature Branch**: `001-feature-name`
**Status**: Draft
**Input**: User description: "..."

## User Scenarios & Testing（强制）
### User Story 1 - [Title]（Priority: P1）
**Why this priority**: [...]
**Independent Test**: [...]
**Acceptance Scenarios**:
1. **Given** [前置] **When** [动作] **Then** [结果]

### User Story 2 - [Title]（Priority: P2）
...

## Requirements（强制）
### Functional Requirements
- **FR-001**: System MUST [...]
- **[NEEDS CLARIFICATION: ...]**: ...

### Key Entities
- **[Entity1]**: 代表什么；关键属性

## Success Criteria（强制）
- **SC-001**: [度量指标，技术无关]
- **SC-002**: [...]

## Assumptions
- [...]
```

### 3.3 plan.md 模板

```markdown
# Implementation Plan: [FEATURE]
**Branch**: `001-feature-name` | **Date**: [...] | **Spec**: [link]

## Summary
## Technical Context
**Language/Version**: ...
**Primary Dependencies**: ...
**Storage**: ...
**Testing**: ...
**Target Platform**: ...
**Project Type**: web-service | mobile-app | ...

## Constitution Check（GATE）
[Gates determined based on constitution file]

## Project Structure
### Documentation (this feature)
specs/[###-feature]/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md

### Source Code (repository root)
[按 Web App / Single Project / Mobile+API 选项填充]

## Complexity Tracking
| Violation | Why Needed | Simpler Alternative Rejected Because |
```

### 3.4 tasks.md 模板

```markdown
## Phase 1: Setup（Shared Infrastructure）
- [ ] T001 [P] 使用 create-vite 创建前端工程
- [ ] T002 [P] 安装 ESLint + Prettier

## Phase 2: Foundational（Blocking Prerequisites）
- [ ] T003 [P] [US1] 实现 JWT 鉴权中间件 src/middleware/auth.ts
- [ ] T004 [P] 创建数据模型 Project entity
⚠️ Checkpoint: Foundation ready

## Phase 3: User Story 1 - [Title]（Priority: P1）MVP
- [ ] T010 [P] [US1] 契约测试：POST /api/v1/auth/login
- [ ] T011 [US1] 实现 login service
- [ ] T012 [US1] 实现 POST /api/v1/auth/login endpoint
⚠️ Checkpoint: US1 可独立测试

## Phase N: Polish & Cross-Cutting Concerns
- [ ] T040 [P] 文档
- [ ] T041 [P] 性能优化

## Dependencies & Execution Order
Phase 1 → Phase 2 → (US1 ‖ US2 ‖ US3) → Phase N
```

## 四、失败回退

| 失败点 | 恢复动作 |
|---|---|
| Constitution Check 不通过 | 必须修订 constitution 或 plan，禁止绕过 |
| spec 含糊度过高 | 强制 Step 3 clarify；如仍有 NEEDS CLARIFICATION，禁止下游 |
| Tasks 与 Plan 冲突 | 人工合并后回退到 Step 6 |
| Implement Checkpoint 失败 | 禁止继续；回到对应 Phase 修复 |

## 五、依赖

- Node.js: >=18.0.0（唯一硬依赖）
- Git: 可选（用于分支管理）
- 本 Skill 兼容 SpecKit 工作流设计，但**不依赖 SpecKit CLI**，所有命令均为自研实现

## 六、相关链接

- [Spec Kit 官方仓库](https://github.com/github/spec-kit)（工作流设计参考）
- [Agentic SDD 文档](https://github.github.io/spec-kit/reference/agentic-sdd.html)
- 父 Skill: `project-orchestrator`
- 下游消费者: `scaffold-runner`, `ui-design`, `spec-userstory-to-design`

## 七、许可

MIT