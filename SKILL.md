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

| 方案 | 复杂度 | 可复用性 | 权限隔离 | 故障隔离 |
|---|---|---|---|---|
| 单 Skill（巨石） | SKILL.md > 500 行 | 整体打包，无法单点复用 | 权限按最大公约数 | 一处挂全挂 |
| **Skill Bundle（本方案）** | 每个 SKILL.md < 200 行 | 子 Skill 独立发布 | 按需最小化 | 局部失败不影响整体 |

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
├── src/                          ← scaffold-runner 写入
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

---

## 九、相关文档

- [maturity-analysis-report.md](maturity-analysis-report.md) — 成熟度分析报告（v8）
- [docs/env-setup.md](docs/env-setup.md) — 环境配置指南
- [mcp-integration/README.md](mcp-integration/README.md) — MCP 集成说明
- 各子 Skill 的 SKILL.md（详见 `skills/` 目录）

---

## 十、许可

MIT