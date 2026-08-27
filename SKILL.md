---
name: project-orchestrator
description: |
 项目全生命周期编排器（Skill Bundle 入口）。
 本 Skill 不直接执行任务，而是分发到 15 个子 Skill，按三大阶段组织：

 Phase 1 · 项目初始化（7 个）
 - spec-bootstrap, code-patterns, scaffold-runner, ui-design,
   spec-userstory-to-design, api-contract, html-converter

 Phase 2 · 功能变更与实现（4 个）
 - openspec-workflow, implement-executor, test-runner, git-workflow

 Phase 3 · 质量保障（4 个）
 - debug-helper, review-checklist, dependency-auditor, environment-manager

 每个子 Skill 独立可调用，可独立上架 Marketplace。
 支持 MCP Sampling（LLM 请求复用 Agent 框架 LLM）、AST 解析 100% 覆盖（parse5 + csstree + recast + @babel/parser）、端到端链路测试（91 个测试）、真实 npm audit、Doppler/Vault 三后端 Secrets 管理。
version: 1.1.0
author: project-orchestrator authors
license: MIT
tags:
  - project-management
  - spec-driven-development
  - openspec
  - ui-design
  - api-contract
  - skill-bundle
  - mcp-integration
  - ast-parsing
  - e2e-testing
  - secrets-management
entry-points:
  - bootstrap
  - change
  - ui.adjust
  - contract
  - design
  - scaffold
  - html.convert
  - implement
  - test
  - commit
  - audit
  - review
  - debug
  - env.check
  # P2 · 健康度监控（运营可观测性）
  - health.event
  - health.check
  - health.dashboard
  # P2 · 编排状态机（自动串联 Phase 1→2→3）
  - orchestrate.status
  - orchestrate.next
  - orchestrate.transition
requires:
  - node: ">=18.0.0"
  - mcp: ">=2026-07-28"
binds:
  # Phase 1: 项目初始化
  - spec-bootstrap
  - code-patterns
  - scaffold-runner
  - ui-design
  - spec-userstory-to-design
  - api-contract
  - html-converter
  # Phase 2: 功能变更与实现
  - openspec-workflow
  - implement-executor
  - test-runner
  - git-workflow
  # Phase 3: 质量保障
  - debug-helper
  - review-checklist
  - dependency-auditor
  - environment-manager
  # P2 · 共享库（lib，非 Skill，但纳入 binds 便于追踪）
  - lib:health-monitor
  - lib:orchestrator-state-machine
---

# project-orchestrator

> AI Agent 协作编排场景下的项目全生命周期管理工具。

## 一、定位与价值

`project-orchestrator` 是一个**薄编排层 Skill**，本身不执行具体任务，而是把工作分发到 7 个专职子 Skill。

### 核心价值

| 维度 | 价值 |
|---|---|
| **规范驱动** | 兼容 SpecKit 工作流设计（自研实现，不依赖 SpecKit CLI） |
| **变更管理** | 兼容 OpenSpec 工作流设计（自研实现，不依赖 OpenSpec CLI） |
| **设计产出** | UI 原型 + 聊天交互调整 + Page Flow + Page Detail |
| **AST 解析** | 15/15 Skill 100% 使用 AST 解析（parse5 + csstree + recast + @babel/parser，43 个 API） |
| **测试质量** | 91 个测试 + E2E 全链路验证 + 30 个弱断言已加固 |
| **安全审计** | 真实 npm audit（CVE 解析）+ 三后端 Secrets 管理（dotenv/Doppler/Vault） |
| **成熟度** | 96%（Phase 3 · Beta 后期稳定）— 详见 [maturity-analysis-report.md](maturity-analysis-report.md) |
| **契约优先** | OpenAPI 3.1.2 自动生成，贯穿设计与实现 |
| **全链路** | 规范 → 设计 → 原型 → 代码 → 验证，覆盖项目全生命周期 |
| **可复用** | 每个子 Skill 独立可发、可上架、可被其他项目引用 |

### 与单 Skill 方案的对比

| 方案 | 复杂度管理 | 可复用性 | 权限隔离 | 故障隔离 |
|---|---|---|---|---|
| 单 Skill（巨石） | 单一 SKILL.md > 500 行，**无分阶段拆分**，定位与维护困难 | 整体打包，无法单点复用 | 权限按最大公约数 | 一处挂全挂 |
| **Skill Bundle（本方案）** | **按阶段 + 职责拆分 15 个独立子 SKILL.md**；单文档聚焦单一领域，父 Skill 只做分发不承载实现。核心薄编排逻辑 < 100 行，子 Skill 平均 ~300 行（含模板/示例/回退表），**单职责定位显著优于巨石** | 子 Skill 独立发布，可单独上架 Marketplace | 按需最小化，按 Skill 单独授权 | 局部失败不影响整体 |

---

## 二、目录结构

```
project-orchestrator-bundle/
├── SKILL.md                      # ← 本文件（主编排入口）
├── README.md                     # 项目总览 + 快速开始
├── bundles/                      # Bundle 清单（按角色安装）
│   ├── full-stack.yaml           # 完整 Bundle（15 个子 Skill）
│   ├── frontend-only.yaml        # 前端 Bundle（7 个：spec-bootstrap + code-patterns + scaffold-runner + ui-design + spec-userstory-to-design + html-converter + test-runner）
│   ├── api-only.yaml             # API Bundle（7 个：spec-bootstrap + code-patterns + scaffold-runner + api-contract + openspec-workflow + implement-executor + test-runner）
│   └── design-only.yaml          # 设计 Bundle（5 个：spec-bootstrap + ui-design + spec-userstory-to-design + html-converter + review-checklist）
├── skills/                       # 15 个子 Skill 目录
│   # Phase 1: 项目初始化（7 个）
│   ├── spec-bootstrap/SKILL.md
│   ├── code-patterns/SKILL.md
│   ├── scaffold-runner/SKILL.md
│   ├── ui-design/SKILL.md
│   ├── spec-userstory-to-design/SKILL.md
│   ├── api-contract/SKILL.md
│   ├── html-converter/SKILL.md
│   # Phase 2: 功能变更与实现（4 个）
│   ├── openspec-workflow/SKILL.md
│   ├── implement-executor/SKILL.md
│   ├── test-runner/SKILL.md
│   ├── git-workflow/SKILL.md
│   # Phase 3: 质量保障（4 个）
│   ├── debug-helper/SKILL.md
│   ├── review-checklist/SKILL.md
│   ├── dependency-auditor/SKILL.md
│   └── environment-manager/SKILL.md
├── mcp-integration/              # MCP 集成 + 实现
│   ├── README.md                 # MCP 集成说明
│   ├── mcp.json                  # MCP Server 配置
│   ├── .trae.mcp.json            # TRAE MCP 配置
│   ├── quickstart.ps1            # Windows 一键启动
│   ├── quickstart.sh             # macOS/Linux 一键启动
│   ├── src/                      # 源码
│   │   ├── orchestrator-tools.ts # MCP Tool 编排层
│   │   └── skill-cli.cjs         # 命令行入口
│   ├── examples/                 # 源实现 + 示例
│   │   ├── lib/                  # 共享库（llm-client + ast-parser + benchmark）
│   │   └── skills/               # 15 个子 Skill 实现
│   ├── tests/                    # 集成测试（91 个测试）
│   └── dist/                     # 构建产物（npm run build 生成）
├── docs/                         # 维护文档
│   └── env-setup.md              # 环境配置指南
└── maturity-analysis-report.md   # 成熟度分析报告（v8）
```

---

## 三、命令清单（用户实际怎么调用）

### 3.1 项目初始化流程（Phase 1）

```bash
# 一次性环境准备
mkdir my-project && cd my-project
/project-orchestrator.bootstrap                  # 初始化项目规范

# 启动完整 Bootstrap 流程
/project-orchestrator.bootstrap
# 等价于：
#   → spec-bootstrap（生成 spec.md/plan.md/tasks.md）
#   → scaffold-runner（生成可运行工程脚手架）
#   → ui-design（生成单文件 HTML 原型）
#   → spec-userstory-to-design（生成 Page Flow + Page Detail + OpenAPI）
#   → api-contract（独立生成 OpenAPI YAML 作为兜底）

# 或按需单独调用
/project-orchestrator.spec-bootstrap
/project-orchestrator.scaffold-runner --stack=react-vite
/project-orchestrator.ui-design --pages="登录,看板,周报"
/project-orchestrator.design --from=spec.md            # alias for spec-userstory-to-design
/project-orchestrator.contract --from=plan.md
```

### 3.2 功能变更流程（Phase 2）

```bash
# 完整 Change 流程
/project-orchestrator.change "新增工时统计功能"
# 等价于：
#   → openspec-workflow（生成 PROPOSAL → SPEC delta → TASKS → ARCHIVE）
#   → implement-executor（按 tasks 编码落地）
#   → test-runner（自动化测试 + 覆盖率门禁）
#   → git-workflow（提交 + 创建 PR + Changelog）

# 或单独调用
/project-orchestrator.openspec-workflow "新增工时统计"
/project-orchestrator.implement --task=tasks/001-add-feature.md
/project-orchestrator.test --scope=unit --coverage=80
/project-orchestrator.commit --feature="新增工时统计" --create-pr
/project-orchestrator.ui-design --adjust="把首页卡片从 3 列改成 2 列"
```

### 3.3 UI 设计调整（聊天交互）

```bash
# 启动 UI Design 子 Skill，进入聊天模式
/project-orchestrator.ui-design --adjust
# 用户: "把首页卡片从 3 列改成 2 列，配色换成莫兰迪"
# Skill: Intent → Locate → Plan → Apply → Verify → Commit
# 输出: diff 草案 + 预览截图 + Apply / Revert / Adjust 选项
```

### 3.4 HTML 转组件代码

```bash
# 把 UI Design 输出的 HTML 原型转为 Vue/React 组件
/project-orchestrator.html-converter --from=prototype/index.html --target=react
```

### 3.5 质量保障（Phase 3 · 按需调用）

```bash
# 调试辅助
/project-orchestrator.debug --error="TypeError: Cannot read property 'id' of undefined"

# PR 评审清单
/project-orchestrator.review --pr=123

# 依赖审计
/project-orchestrator.audit --strict

# 环境配置
/project-orchestrator.env.check --validate=.env.example
```

### 3.6 三套命名体系映射表

本 Bundle 对外暴露三套命名体系，对应关系如下：

- **MCP Tool 名（蛇形）**：MCP 客户端实际调用的 Tool 标识，共 26 个，由 `orchestrator-tools.ts` 注册。
- **Entry-point（点号）**：父 Skill frontmatter 中声明的 14 个高层入口，每个 entry-point 对应 1+ 个 MCP Tool 串联执行。
- **Slash 命令**：文档示例中面向用户的可读调用形式（客户端支持的 `/skill-name.command` 风格语法糖）。

| Entry-point | Slash 命令（示例） | 对应 MCP Tool 名 | 所属子 Skill | 阶段 |
|---|---|---|---|---|
| `bootstrap` | `/project-orchestrator.bootstrap` | `spec_bootstrap_constitution` → `spec_bootstrap_specify` → `spec_bootstrap_clarify` → `spec_bootstrap_plan` → `spec_bootstrap_checklist` → `spec_bootstrap_tasks` → `spec_bootstrap_analyze` → `scaffold_runner_run` → `ui_design_adjust` → `spec_userstory_to_design_generate` → `api_contract_generate` | spec-bootstrap + scaffold-runner + ui-design + spec-userstory-to-design + api-contract | Phase 1 完整初始化 |
| `scaffold` | `/project-orchestrator.scaffold-runner --stack=react-vite` | `scaffold_runner_run` | scaffold-runner | Phase 1 |
| `design` | `/project-orchestrator.design --from=spec.md` | `spec_userstory_to_design_generate` | spec-userstory-to-design | Phase 1 |
| `contract` | `/project-orchestrator.contract --from=plan.md` | `api_contract_generate` | api-contract | Phase 1 |
| `ui.adjust` | `/project-orchestrator.ui-design --adjust="把卡片3列改成2列"` | `ui_design_adjust` | ui-design | Phase 1 |
| `html.convert` | `/project-orchestrator.html-converter --from=prototype/index.html` | `html_converter_convert` | html-converter | Phase 1 |
| — | 单独调用 spec-bootstrap 子命令 | `spec_bootstrap_constitution` / `spec_bootstrap_specify` / `spec_bootstrap_clarify` / `spec_bootstrap_plan` / `spec_bootstrap_checklist` / `spec_bootstrap_tasks` / `spec_bootstrap_analyze` / `spec_bootstrap_implement` | spec-bootstrap | Phase 1 |
| — | 单独调用设计模式 | `code_patterns_generate` | code-patterns | Phase 1 |
| `change` | `/project-orchestrator.change "新增工时统计功能"` | `openspec_workflow_propose` → `implement_executor_run` → `test_runner_run` → `git_workflow_commit` | openspec-workflow + implement-executor + test-runner + git-workflow | Phase 2 完整变更 |
| `implement` | `/project-orchestrator.implement --task=T015` | `implement_executor_run` / `implement_executor_resume` / `implement_executor_status` / `implement_executor_rollback` | implement-executor | Phase 2 |
| `test` | `/project-orchestrator.test --scope=unit --coverage=80` | `test_runner_run` | test-runner | Phase 2 |
| `commit` | `/project-orchestrator.commit --feature="新增工时统计" --create-pr` | `git_workflow_commit` / `git_workflow_pr` | git-workflow | Phase 2 |
| `debug` | `/project-orchestrator.debug --error="TypeError..."` | `debug_helper_analyze` | debug-helper | Phase 3 |
| `review` | `/project-orchestrator.review --pr=123` | `review_checklist_review` | review-checklist | Phase 3 |
| `audit` | `/project-orchestrator.audit --strict` | `dependency_auditor_audit` | dependency-auditor | Phase 3 |
| `env.check` | `/project-orchestrator.env.check --validate=.env.example` | `environment_manager_inject` | environment-manager | Phase 3 |
| `health.event` | `/project-orchestrator.health.event --type=rollback.exec --taskId=T001` | `health_monitor_record_event` | lib:health-monitor | P2 · 运营可观测性 |
| `health.check` | `/project-orchestrator.health.check` | `health_monitor_check` | lib:health-monitor | P2 · 运营可观测性 |
| `health.dashboard` | `/project-orchestrator.health.dashboard --format=markdown --weekly` | `health_monitor_dashboard` | lib:health-monitor | P2 · 运营可观测性 |
| `orchestrate.status` | `/project-orchestrator.orchestrate.status` | `orchestrator_status` | lib:orchestrator-state-machine | P2 · 状态机 |
| `orchestrate.next` | `/project-orchestrator.orchestrate.next --auto-advance` | `orchestrator_next` | lib:orchestrator-state-machine | P2 · 状态机 |
| `orchestrate.transition` | `/project-orchestrator.orchestrate.transition --action=recompute` | `orchestrator_transition` | lib:orchestrator-state-machine | P2 · 状态机 |

> **使用提示**：
> - Agent / 自动化调用 → 使用 **MCP Tool 名**（蛇形），精确对应 **32 个 Tool**（v9 P2 新增 6 个：3 健康度 + 3 状态机）。
> - 用户快速上手 → 使用 **Slash 命令** 或 **Entry-point**，一条命令串联多个 Tool。
> - 父 Skill 的 `bootstrap` 与 `change` 两个复合 Entry-point 会自动执行完整阶段链路，不需要手动逐个调用 Tool。
> - **编排状态机**（P2 · 新增）：`orchestrate.status` / `orchestrate.next` / `orchestrate.transition` 三条命令，基于约定文件系统做存在性推断，实现「Phase 1 → 2 → 3 自动串联 + 缺失前置提示 + 下一步推荐」闭环。推荐使用 `/project-orchestrator.orchestrate.next --auto-advance` 让 Agent 自动按顺序推进。
> - **健康度监控**（P2 · 新增）：各 Skill 在执行关键动作时（任务开始、撤销、澄清、投诉、npm-outdated 扫描）可调用 `health.event` 写入事件；`health.check` 做阈值告警；`health.dashboard --weekly` 输出撤销率周报。对应 SKILL.md §8.3 的 4 项监控指标已全部落地。

---

## 四、子 Skill 接口契约

主编排 Skill 通过"约定文件路径 + 共享目录"实现子 Skill 间的状态共享。

### 4.1 文件系统作为共享状态

```
my-project/
├── .specify/                     ← speckit 状态
│   └── memory/constitution.md
├── specs/001-feature/            ← spec-bootstrap 写入
│   ├── spec.md
│   ├── plan.md
│   └── tasks.md
├── openspec/                     ← openspec-workflow 写入
│   └── changes/001-add-feature/
│       ├── proposal.md
│       ├── specs/...
│       └── archive/...
├── prototype/                    ← ui-design 写入
│   ├── index.html
│   └── _shared/tokens.css
├── docs/design/001-feature/      ← spec-userstory-to-design 写入
│   ├── page-flow.md
│   ├── pages/*.md
│   └── openapi.yaml
├── contracts/openapi.yaml        ← api-contract 写入（最终契约）
├── src/                          ← scaffold-runner 写入（单端项目）
│                                  ※ 组合栈（如 react-vite+spring-boot）为 monorepo：
│                                    apps/web/（前端）+ apps/api/（后端）
│                                    + 根 package.json（workspaces）+ pnpm-workspace.yaml
└── components/                   ← html-converter 写入
```

### 4.2 子 Skill 依赖关系

```
# ============ Phase 1: 项目初始化 ============
spec-bootstrap (Phase 1.1)
    ├─ produces: specs/001-feature/spec.md
    ├─ produces: .specify/memory/constitution.md
    └─ consumed by: ALL

code-patterns (Phase 1.2)
    ├─ produces: .code-patterns.yaml
    └─ consumed by: implement-executor, review-checklist

scaffold-runner (Phase 1.3)
    ├─ requires: specs/001-feature/spec.md
    └─ produces: src/（可运行工程）

ui-design (Phase 1.4)
    ├─ requires: specs/001-feature/spec.md
    ├─ produces: prototype/index.html
    └─ consumed by: spec-userstory-to-design, html-converter

spec-userstory-to-design (Phase 1.5)
    ├─ requires: specs/001-feature/spec.md, prototype/index.html
    └─ produces: docs/design/001-feature/*

api-contract (Phase 1.6)
    ├─ requires: docs/design/001-feature/openapi.yaml
    └─ produces: contracts/openapi.yaml（最终版本）

html-converter (Phase 1.7 · 按需)
    ├─ requires: prototype/index.html
    └─ produces: components/*.tsx 或 *.vue

# ============ Phase 2: 功能变更与实现 ============
openspec-workflow (Phase 2.1)
    ├─ requires: 现有 spec.md
    └─ produces: openspec/changes/001-change/

implement-executor (Phase 2.2)
    ├─ requires: openspec/changes/001-change/, .code-patterns.yaml
    ├─ produces: 代码变更 + commits
    └─ consumed by: test-runner, git-workflow

test-runner (Phase 2.3)
    ├─ requires: 实施后的代码
    ├─ produces: 测试报告 + 覆盖率报告
    └─ 质量门禁：coverage ≥ 80%

git-workflow (Phase 2.4)
    ├─ requires: 已实现的代码 + 测试通过
    ├─ produces: PR + Changelog
    └─ consumed by: review-checklist

# ============ Phase 3: 质量保障 ============
debug-helper (Phase 3.1)
    ├─ requires: 错误堆栈或现象描述
    └─ produces: 根因报告 + 修复建议

review-checklist (Phase 3.2)
    ├─ requires: PR diff + .code-patterns.yaml
    └─ produces: 评审报告 + 评分 + 待办

dependency-auditor (Phase 3.3)
    ├─ requires: package.json / requirements.txt 等依赖文件
    └─ produces: 漏洞报告 + License 合规报告

environment-manager (Phase 3.4)
    ├─ requires: .env.example / 项目配置
    ├─ produces: .env 模板 + Secrets 注入
    └─ consumed by: 全 Skill（环境准备）
```

### 4.3 子 Skill 独立运行能力

每个子 Skill 都可**脱离主编排器**独立运行：

```bash
# 只用 spec-bootstrap
/spec-bootstrap --from-natural-language="..."

# 只用 ui-design
/ui-design --from=spec.md --pages="登录,首页"

# 只用 api-contract
/api-contract --from=plan.md --auth=jwt

# 只用 html-converter
/html-converter --from=prototype/index.html --target=vue3

# 只用 code-patterns（注入代码规范）
/code-patterns --init=.code-patterns.yaml

# 只用 implement-executor（执行编码任务）
/implement-executor --task=tasks/001-add-feature.md

# 只用 test-runner
/test-runner --scope=unit --coverage=80

# 只用 git-workflow
/git-workflow --feature="新增工时统计" --create-pr

# 只用 debug-helper
/debug-helper --error="TypeError: Cannot read property 'id' of undefined"

# 只用 review-checklist
/review-checklist --pr=123

# 只用 dependency-auditor
/dependency-auditor --strict

# 只用 environment-manager
/environment-manager --validate=.env.example
```

---

## 五、与 Constitution 的硬约束对接

所有子 Skill 遵循同一份 `.specify/memory/constitution.md`，作为项目的"治理宪法"。

### 5.1 推荐写入 Constitution 的规则

```markdown
## 1. 技术栈约束
- 前端：[Vue3 + Vite / React + Vite / Next.js / Nuxt / ...]
- 后端：[Spring Boot / Nest / FastAPI / ...]
- 数据库：[PostgreSQL / MySQL / ...]

## 2. 脚手架规则
- 必须使用 [Spring Initializr | create-vite | ...] 生成初始工程
- 禁止手写 package.json / pom.xml 的依赖段

## 3. UI 规范
- 所有 UI 原型必须是自包含单文件 HTML
- 必须使用 ui-design 子 Skill 产出
- UI 调整通过聊天交互完成，不直接编辑原型文件

## 4. API 契约
- 所有接口必须在 openapi.yaml 中定义
- 必须包含错误码定义（RFC 9457 Problem）
- 变更必须先改契约，再改代码

## 5. 变更流程
- 所有变更走 openspec-workflow 子 Skill
- 必须产出 PROPOSAL → SPEC delta → TASKS → ARCHIVE

## 6. 设计文档
- 所有 Page Detail 必须含 11 章节
- 按钮业务逻辑必须用 Mermaid 表达
- API 必须双向锚定 Page（x-page-id / x-button-id）
```

---

## 六、推荐 Bundle 安装清单

按用户角色订阅不同的 Bundle：

| 用户角色 | 推荐 Bundle | 包含子 Skill 数量 |
|---|---|---|
| **全栈开发者** | `full-stack` | 全部 15 个 |
| **前端开发者** | `frontend-only` | 7 个（spec-bootstrap + code-patterns + scaffold-runner + ui-design + spec-userstory-to-design + html-converter + test-runner） |
| **后端/API 开发者** | `api-only` | 7 个（spec-bootstrap + code-patterns + scaffold-runner + api-contract + openspec-workflow + implement-executor + test-runner） |
| **产品经理 / 设计师** | `design-only` | 5 个（spec-bootstrap + ui-design + spec-userstory-to-design + html-converter + review-checklist） |
| **架构师 / Tech Lead** | `full-stack` | 全部 15 个（侧重宪法治理） |

```yaml
# bundles/full-stack.yaml
name: full-stack
version: 1.0.0
description: 完整 Bundle，覆盖项目全生命周期（15 个子 Skill）
skills:
  # Phase 1: 项目初始化
  - spec-bootstrap
  - code-patterns
  - scaffold-runner
  - ui-design
  - spec-userstory-to-design
  - api-contract
  - html-converter
  # Phase 2: 功能变更与实现
  - openspec-workflow
  - implement-executor
  - test-runner
  - git-workflow
  # Phase 3: 质量保障
  - debug-helper
  - review-checklist
  - dependency-auditor
  - environment-manager
```

```yaml
# bundles/frontend-only.yaml
name: frontend-only
version: 1.0.0
description: 前端 Bundle（7 个子 Skill）
skills:
  - spec-bootstrap            # 规范生成
  - code-patterns             # 前端代码规范
  - scaffold-runner           # 前端脚手架
  - ui-design                  # UI 原型
  - spec-userstory-to-design   # 页面设计
  - html-converter             # HTML → 组件
  - test-runner                # 前端测试
```

```yaml
# bundles/api-only.yaml
name: api-only
version: 1.0.0
description: API Bundle（7 个子 Skill）
skills:
  - spec-bootstrap            # 规范生成
  - code-patterns              # 后端代码规范
  - scaffold-runner           # 后端脚手架
  - api-contract               # OpenAPI 契约
  - openspec-workflow          # 变更管理
  - implement-executor         # 代码生成（可选）
  - test-runner                # API 测试
```

```yaml
# bundles/design-only.yaml
name: design-only
version: 1.0.0
description: 设计 Bundle（5 个子 Skill）
skills:
  - spec-bootstrap              # 规范生成
  - ui-design                    # UI 原型
  - spec-userstory-to-design     # 页面设计
  - html-converter               # HTML → 组件
  - review-checklist             # 评审清单
```

---

## 七、失败回退机制

| 失败点 | 恢复动作 |
|---|---|
| spec-bootstrap 生成含糊度过高 | 强制 Step 3 clarify；如仍有 NEEDS CLARIFICATION，禁止下游 |
| code-patterns 与现有代码冲突 | 切换到更宽松的 pattern 集合；保留可继承部分 |
| scaffold-runner 生成失败 | 检查网络、版本、权限；禁止手动修补依赖文件后跳过 |
| ui-design 不符合期望 | 通过聊天交互迭代，禁止手动编辑 _shared/ 外的 HTML |
| spec-userstory-to-design 冲突 | 人工介入合并 |
| api-contract 与现有契约冲突 | 启动合并模式，保留两端 schema |
| html-converter AST 解析失败 | 回退到正则替换模式（精度下降但可用） |
| openspec-workflow 评审失败 | 回退到 PROPOSAL 阶段修订 |
| implement-executor 编码失败 | 重新拆解任务；回退到上一个稳定 commit |
| test-runner 覆盖率不达标 | 列出未覆盖文件 + 建议用例；禁止进入 PR 流程 |
| git-workflow 创建 PR 失败 | 保留本地分支；提示用户手动触发 PR |
| debug-helper 无法定位根因 | 收集更多上下文（log、环境、复现步骤） |
| review-checklist 发现阻塞项 | 阻塞合并；通知 implement-executor 修复 |
| dependency-auditor 发现 Critical 漏洞 | 立即停止合并；提示升级或替换 |
| environment-manager 注入 Secrets 失败 | 回退到 .env.local；禁止进入生产 |

---

## 七.五、LLM 集成（MCP Sampling 方案B）

### 7.5.1 架构

Skill Bundle 的 LLM 调用采用 **MCP Sampling 优先 + 直连 Provider 降级** 策略：

```
┌──────────────────────────────────────────────────────────┐
│  TRAE Agent (Client)                                      │
│  ┌──────────────────────────────────────────────────┐    │
│  │  LLM（Agent 框架内置）                             │    │
│  └──────────────┬───────────────────────────────────┘    │
│                 │ sampling/createMessage                  │
│  ┌──────────────┴───────────────────────────────────┐    │
│  │  orchestrator-tools MCP Server (stdio)            │    │
│  │  • 注册 sampling capability                        │    │
│  │  • fork() 子进程 + IPC 通道                         │    │
│  │  • handleLLMRequest() 转发                         │    │
│  └──────────────┬───────────────────────────────────┘    │
│                 │ IPC (process.send / child.on)           │
│  ┌──────────────┴───────────────────────────────────┐    │
│  │  skill-cli.cjs (forked child process)              │    │
│  │  • MCP_SAMPLING_ENABLED=1 环境变量                 │    │
│  │  • process.send 可用（IPC 通道）                    │    │
│  └──────────────┬───────────────────────────────────┘    │
│                 │ require('../../lib/llm-client')          │
│  ┌──────────────┴───────────────────────────────────┐    │
│  │  llm-client.js                                     │    │
│  │  1. 优先：callViaMCPSampling() → IPC → Server     │    │
│  │  2. 降级：直连 Provider（Anthropic/OpenAI/...）    │    │
│  │  3. 最终：模板生成模式（无 API key 时）             │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 7.5.2 LLM 来源优先级

| 优先级 | 来源 | 条件 | provider 字段 |
|---|---|---|---|
| 1 | MCP Sampling | `MCP_SAMPLING_ENABLED=1` 且 `process.send` 可用 | `mcp-sampling` |
| 2 | 直连 Provider | API key 环境变量存在（ANTHROPIC_API_KEY 等） | `anthropic`/`openai`/... |
| 3 | 模板生成 | 无任何 LLM 来源 | `null`（`llmEnhanced: false`） |

### 7.5.3 关键文件

| 文件 | 职责 |
|---|---|
| `mcp-integration/src/orchestrator-tools.ts` | MCP Server：注册 sampling capability、handleLLMRequest() 转发、fork()+IPC |
| `mcp-integration/examples/lib/llm-client.js` | LLM 客户端：callViaMCPSampling()、callLLM()、降级逻辑 |
| `mcp-integration/src/skill-cli.cjs` | Skill CLI：检测 MCP sampling 上下文、加载 Skill 模块 |

### 7.5.4 数据流

1. TRAE Client 连接 orchestrator-tools MCP Server
2. Server 声明 `{ capabilities: { tools: {}, sampling: {} } }`
3. Server 检测 Client 是否支持 sampling（`getClientCapabilities().sampling`）
4. Client 调用 MCP Tool → Server `fork()` 启动 skill-cli.cjs（带 IPC 通道）
5. Skill 需要调用 LLM → llm-client.js 通过 `process.send()` 发送 `llm:request`
6. Server 收到 IPC 消息 → 调用 `sampling/createMessage` 向 Client 请求 LLM 推理
7. Client 使用 Agent 框架 LLM 完成推理 → 返回结果
8. Server 通过 `child.send()` 将 `llm:response` 回传给 Skill
9. Skill 使用 LLM 结果完成处理 → 返回最终结果

### 7.5.5 降级策略

- MCP Sampling 不可用（Client 不支持 / 独立运行）→ 自动降级到直连 Provider
- 直连 Provider 不可用（无 API key）→ 自动降级到模板生成模式
- 所有降级均静默执行，不报错；结果中通过 `llmEnhanced` 和 `llmProvider` 字段标识

---

## 八、维护与版本

### 8.1 版本管理

- 主版本（MAJOR）：破坏性变更（如子 Skill 接口变更）
- 次版本（MINOR）：新增子 Skill 或新功能
- 修订号（PATCH）：Bug 修复、文档更新

### 8.2 依赖锁定

依赖如下：
- node: >=18.0.0（唯一硬依赖）
- @modelcontextprotocol/sdk: ^0.6.0（MCP 集成 + sampling）
- parse5: ^7.1.2（HTML AST 解析，替代正则）
- css-tree: ^3.1.0（CSS AST 解析，替代正则）
- recast: ^0.23.4（JS/TS AST 解析，替代正则）
- @babel/parser: ^7.24.0（TypeScript 接口语法校验）
- git: 可选（git-workflow / openspec-workflow 需要）
- npm: 可选（test-runner / dependency-auditor / scaffold-runner 需要）
- Style Dictionary: v4.x
- DTCG 标准: 2025.10

### 8.3 健康度监控

| 指标 | 阈值 | 监控方式 |
|---|---|---|
| 撤销率 | > 25% | 周报 |
| 澄清次数/任务 | > 2.5 | 仪表盘 |
| "改了但没生效"投诉 | > 10/周 | 告警 |
| npm outdated 核心库 | > 3 个 | 启动迁移计划 |

#### 8.3.1 实现落地（v9 · P2 已修复）

上述 4 项指标已全部由 `lib:health-monitor` 模块实现（`mcp-integration/examples/lib/health-monitor.js`），并通过 3 个 MCP Tool 对外暴露：

| MCP Tool | 作用 | 输出 |
|---|---|---|
| `health_monitor_record_event` | 记录事件（task.start / task.complete / clarify.issue / rollback.exec / complaint.effect / npm.outdated / custom） | 事件 ID + 时间戳 |
| `health_monitor_check` | 滑窗 7 天 + 本周真实计算 4 项指标，触发阈值告警 | `{healthy, count, alerts[], metricsSummary}` |
| `health_monitor_dashboard` | 生成仪表盘 | markdown / html / json；`--weekly` 输出撤销率周报 |

**事件持久化**：`<projectRoot>/.orchestrator-health/events.ndjson`（追加写入）+ `metrics.json`（最新计算快照）。

**集成点建议**：
- `implement-executor.run/resume/rollback` → 任务开始/完成时写 `task.start`/`task.complete`；回滚时写 `rollback.exec`
- `spec-bootstrap.clarify` → 发现歧义写 `clarify.issue`
- `test-runner` 失败后投诉 → 写 `complaint.effect`
- `dependency-auditor.audit/outdated` → 扫描后写 `npm.outdated`

#### 8.4 编排状态机（v9 · P2 · 自动串联 Phase 1→2→3）

主 Skill 的复合 Entry-point（`bootstrap` / `change`）已提供完整阶段链路，但需要用户手动触发。编排状态机把「从项目文件系统推断当前进度 + 检查前置 + 推荐下一步 + 阶段转移」自动化：

| MCP Tool | 作用 |
|---|---|
| `orchestrator_status` | 查询当前状态：currentPhase / phaseProgress（%） / completedSteps / nextCandidates |
| `orchestrator_next` | 推荐下一步：recommended + missingPreconditions + nextActions；`autoAdvance=true` 输出"应执行的 MCP Tool"给 Agent 循环消费 |
| `orchestrator_transition` | 人工转移：`mark_phase_done` / `rollback_phase` / `reset` / `recompute`（基于文件系统重算进度） |

**状态持久化**：`<projectRoot>/.orchestrator-sm/state.json`。

**19 步检查点**（基于 SKILL.md §4.1 约定路径的存在性推断）：
- Phase 1（11 步）：constitution → specify → clarify → plan → checklist → tasks → scaffold → ui-design → design → contract → html-convert
- Phase 2（4 步）：openspec → implement → test → commit
- Phase 3（3 步，按需）：review → audit → env

**典型用法**：
```
1. /project-orchestrator.orchestrate.transition --action=recompute   # 首次：基于现有文件系统推断已完成的步骤
2. /project-orchestrator.orchestrate.next --auto-advance              # 重复调用：每步推荐唯一可执行 MCP Tool，Agent 调用后再次 next，直到达 Phase 3 完成
3. /project-orchestrator.health.dashboard --weekly                    # 周报/仪表盘：持续观察运营健康
```

### 8.5 扩展：注册新 Skill（三件套）

新增一个子 Skill 并接入编排状态机，需要完成「stateDef + 实现 + SKILL.md」三件套（+ 可选 MCP Tool 注册）。

#### 步骤 1 · 状态机 step 定义（stateDef）

编辑 [orchestrator-state-machine.js](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/examples/lib/orchestrator-state-machine.js) 的 `getStepDefinitions()`，按现有 19 步格式追加：

```js
{
  id: 'S20', phase: 1, name: 'my-skill', label: '我的新 Skill',
  tool: 'my_skill_run',                    // 对应 MCP Tool 名（步骤 4）
  requires: ['S02'],                        // 前置 step id 数组
  detect: () => exists(f001('my-output.md')), // 基于文件系统推断完成态
  reason: 'my-output.md 不存在：调用 my-skill 做某事',
  optional: false,                          // 可选：true 则不计入 requiredTotal（动态分母）
},
```

字段约束：
- `id`：S + 2 位数字，全局唯一，无小数（如 S20，不要 S20.5）
- `phase`：1/2/3，决定归属阶段
- `requires`：前置 step id；`detect()` 返回 true 时视为已完成
- `optional: true` 的 step 不计入 CLI 的 `requiredTotal`（动态分母自动算，无需手改）

#### 步骤 2 · Skill 实现（index.js）

新建 `mcp-integration/examples/skills/<skill-name>/index.js`，导出与 entry-points 对应的函数，统一返回结构：

```js
module.exports = {
  async run({ projectRoot, /* 业务参数 */ }) {
    try {
      // ... 业务逻辑
      return {
        ok: true,
        data: { path: '...', summary: '...', llmEnhanced: false, llmProvider: null },
        warnings: [],
        nextActions: ['下一步建议'],
      };
    } catch (e) {
      return { ok: false, error: e.message, data: null, warnings: [], nextActions: [] };
    }
  }
};
```

返回结构硬约束（由 `tests/helper.cjs` 的 `assertStdResult` 校验）：
- `ok: boolean` 必填
- `error: string | null`
- `data: object | null`；含 `llmEnhanced: boolean` / `llmProvider: string | null`（LLM 集成字段）
- `warnings: string[]` / `nextActions: string[]`

#### 步骤 3 · Skill 文档（SKILL.md）

新建 `skills/<skill-name>/SKILL.md`，frontmatter 至少含：`name` / `description` / `version` / `entry-points` / `requires` / `phase` / `parent: project-orchestrator`。参考现有 [skills/ui-design/SKILL.md](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/ui-design/SKILL.md)。

#### 步骤 4 ·（可选）MCP Tool 注册

若新 Skill 要从 MCP Host 调用，在 [orchestrator-tools.ts](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/src/orchestrator-tools.ts) 的 `ListToolsRequestSchema` handler 追加 tool 定义（`name` 须与 step 的 `tool` 字段一致），并在 `CallToolRequestSchema` handler 追加 case 分发。改完跑 `npm run build -w mcp-integration` 重新构建 dist。

#### 步骤 5 ·（可选）CLI 直跑脚本

若希望绕过 MCP 直接命令行调用，新建 `mcp-integration/tests/cli-<skill-name>.cjs`，参考 [cli-orchestrator-status.cjs](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/tests/cli-orchestrator-status.cjs)。用 `node cli-<skill-name>.cjs` 直跑。

#### 验证清单

- [ ] `node --test tests/phase1.test.cjs`（或对应 phase）通过
- [ ] `node cli-orchestrator-status.cjs <projectRoot> recompute` 能识别新 step
- [ ] `node cli-orchestrator-status.cjs <projectRoot> status` 的 `requiredTotal` 自动 +1（若非 optional）
- [ ] 新 Skill 的 `assertStdResult` 校验通过（返回结构合规）

---

## 九、相关文档

- [maturity-analysis-report.md](maturity-analysis-report.md) — 成熟度分析报告（v8）
- [docs/env-setup.md](docs/env-setup.md) — 环境配置指南
- [mcp-integration/README.md](mcp-integration/README.md) — MCP 集成说明
- 各子 Skill 的 SKILL.md（详见 `skills/` 目录）

---

## 十、许可

MIT