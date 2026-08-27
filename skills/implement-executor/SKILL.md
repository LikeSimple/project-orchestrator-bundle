---
name: implement-executor
description: |
 按 Spec Kit tasks.md 逐 Phase 驱动 Agent 执行实现的 Skill。
 每个 Phase 内：解析任务 → 调用 code-patterns → 写代码 → 跑测试 → lint → commit。
 Phase 间：强制 Checkpoint（人类验收 / 自动验证）才能进入下一 Phase。
 整合 MCP 工具链（FileSystem / Terminal / Git / Test Runner）。
version: 1.0.0
tags:
  - agent-execution
  - spec-implementation
  - checkpoint
  - phase-driven
  - mcp-integration
entry-points:
  - run
  - resume
  - checkpoint
  - abort
requires:
  - node: ">=18"
  - git: ">=2.30"
  - mcp: "filesystem, terminal, git, test-runner"
binds:
  - spec-bootstrap
  - code-patterns
  - test-runner
  - git-workflow
parent: project-orchestrator
phase: 2.0
position: execution-core
---

# implement-executor

> 让 Agent 真的能"按规范写代码"——而不是只会生成文档。

## 一、定位与价值

`spec-bootstrap` 生成的 `tasks.md` 是一份"待办清单"，但**谁来执行**？传统的 Spec Kit 流程假定人类开发者会按 tasks.md 写代码。本 Skill 把这个过程自动化：

```
spec-bootstrap (生成 tasks.md)
        ↓
implement-executor (本 Skill)
        ↓  Phase 1: Setup → Phase 2: Foundational → Phase 3: US1 → ... → Phase N: Polish
        ↓  每个 Phase: 任务解析 → code-patterns → 写代码 → test-runner → git-workflow
        ↓
完整可运行 + 测试通过 + 已 commit 的代码
```

## 二、能力范围

### 2.1 `/run` 主命令

```bash
/implement.run --from=specs/001-feature/tasks.md
# 内部自动：
# 1. 解析 tasks.md → 按 Phase 排序的任务列表
# 2. 对每个 Phase 启动独立的 Agent Loop：
#    a. 读取任务（task description + 文件路径 + Story）
#    b. 调用 code-patterns 注入团队规范
#    c. 调用 test-runner 上下文（如果已存在测试）
#    d. Agent 写代码（MCP: FileSystem）
#    e. Agent 跑命令（MCP: Terminal）
#    f. Agent 跑测试（MCP: TestRunner）
#    g. Agent 跑 lint（MCP: Terminal）
#    h. Agent 提交（MCP: Git）
# 3. 每个 Phase 完成后 → Checkpoint（自动验证 / 人工确认）
# 4. 全部完成 → 输出最终报告
```

### 2.2 `/resume` 断点续跑

```bash
/implement.resume
# 从上次中断的 Phase 继续
# 自动读取 .implement-state.json
```

### 2.3 `/checkpoint` 强制检查点

```bash
/implement.checkpoint
# 在任意 Phase 结束时触发：
# - 自动验证：所有任务标记 [x] + 测试通过 + lint 0 错
# - 人工验证（可选）：生成 PR Draft 等用户确认
```

### 2.4 `/abort` 中止

```bash
/implement.abort --reason="..."
# 保存当前进度到 .implement-state.json
# 输出 git stash + rollback 操作清单
```

## 三、与 tasks.md 的映射

### 3.1 tasks.md 结构（来自 spec-bootstrap）

```markdown
## Phase 1: Setup (Shared Infrastructure)
- [ ] T001 使用 create-vite 创建前端工程
- [ ] T002 [P] 安装 ESLint + Prettier
## Phase 2: Foundational (Blocking Prerequisites)
- [ ] T003 [P] [US1] [backend] 实现 JWT 鉴权中间件 src/middleware/auth.ts
- [ ] T004 [P] [US1] [frontend] 实现登录表单组件 src/components/LoginForm.tsx
## Phase 3: User Story 1 - 用户登录 (Priority: P1) MVP
- [ ] T010 [P] [US1] [backend] 契约测试：POST /api/v1/auth/login
- [ ] T011 [P] [US1] [frontend] 实现登录 UI 交互 src/pages/Login.tsx
...
```

### 3.2 解析逻辑

| 标记 | 含义 | 执行策略 |
|---|---|---|
| `## Phase N:` | 阶段标识 | 必须**串行**（Phase 1 → 2 → 3） |
| `- [ ]` | 未完成 | 待执行 |
| `- [x]` | 已完成 | 跳过 |
| `[P]` | 可并行 | 同 Phase 内可并行执行 |
| `[US1]` `[US2]` | 所属 User Story | 用于跨任务追踪 |
| `[frontend]` `[backend]` | 所属端 | 同 Phase 内不同端可并行，分别跑测试 |
| `[shared]` | 跨端共享 | 工程基础设施（如 ESLint/tsconfig/契约文件），前后端共用 |
| `T001` `T002` | 任务 ID | 用于日志和状态恢复 |
| `src/path/file.ts` | 文件路径 | Agent 必须创建该文件 |
| 描述文本 | 任务说明 | 作为 Agent prompt 输入 |

### 3.3 跨端并行执行策略（前后端协同）

当 scaffold-runner 生成的项目是组合栈（如 `react-vite+spring-boot`，结构 `apps/web` + `apps/api`）时：

| Phase 内任务标记 | 执行顺序 | 测试命令 |
|---|---|---|
| 仅 `[frontend]` 任务 | 串行执行 | `npm run test:web`（vitest/jest） |
| 仅 `[backend]` 任务 | 串行执行 | `npm run test:api`（mvn test/pytest/go test） |
| 同时存在 `[frontend]` + `[backend]` 任务 | **并行执行**（各自串行内有序） | Checkpoint 时分别跑 `test:web` + `test:api` |
| `[shared]` 任务（如契约、tsconfig） | 在 `[frontend]`/`[backend]` 之前 | 不单独跑测试 |
| 无端标记的任务 | 兜底串行执行 | 走 `npm test`（兼容单端项目） |

并行实现：Agent 在 Phase 内启动两个 sub-loop，frontend 任务串行 + backend 任务串行；两个 sub-loop 间互不阻塞。
Checkpoint 门禁等所有 sub-loop 完成后统一触发，分别跑前后端测试。

## 四、单任务执行流程（Agent Loop）

```
┌────────────────────────────────────────────┐
│ 输入：单个 task 对象                          │
│ { id, phase, story, file_path, description } │
└────────────────────┬───────────────────────┘
                     ▼
         ┌───────────────────────┐
         │ ① 读取上下文          │
         │ - spec.md（理解目的）│
         │ - plan.md（理解技术栈）│
         │ - openapi.yaml（理解契约）│
         │ - 已存在的 files        │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │ ② 加载 code-patterns  │
         │ - 注入命名规范、错误处理、│
         │   日志、API 调用约定    │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │ ③ Agent 写代码（MCP FS）│
         │ - 创建/修改 file_path  │
         │ - 调用 git-workflow 模板│
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │ ④ 验证（MCP Terminal）│
         │ - 跑测试（如存在）       │
         │ - 跑 lint              │
         │ - 类型检查（tsc）        │
         └───────────┬───────────┘
                     ▼
            ┌────────┴────────┐
            │ 验证通过?       │
            └───┬─────────┬───┘
              ✓ │         │ ✗
                │         │
                ▼         ▼
         ┌─────────┐  ┌──────────────┐
         │ git commit│ │ 重试（最多3次）│
         │ 继续下一任务│ │ 失败 → 人工介入│
         └─────────┘  └──────────────┘
```

## 五、Phase Checkpoint 机制

### 5.1 何时触发

- 每个 `## Phase N:` 完成后
- 用户主动调用 `/checkpoint`
- 全部任务完成时

### 5.2 检查清单（自动）

```yaml
checkpoint:
  - 所有任务已 [x]:
      验证: grep "- \[ \]" tasks.md
  - 测试通过:
      单端项目: npm test / mvn test / pytest / cargo test
      组合栈项目（apps/web + apps/api）:
        - npm run test:web   # 前端测试（vitest/jest）
        - npm run test:api   # 后端测试（mvn test/pytest/go test）
      阈值: 100% pass（两端分别通过）
  - 覆盖率达标:
      命令: npm run coverage
      阈值: ≥ 80% (configurable via constitution)
  - lint 零错误:
      单端: npm run lint
      组合栈: npm --prefix apps/web run lint && npm --prefix apps/api run lint
      阈值: 0 error
  - 类型检查通过:
      命令: tsc --noEmit / mvn compile
      阈值: 0 error
  - git 状态:
      验证: git status clean（无 untracked）
  - 契约符合:
      验证: 所有 endpoints 都有契约测试覆盖
```

### 5.3 检查点通过 → 进入下一 Phase

检查点全部通过 → 写入 `.implement-state.json`：
```json
{
  "feature": "001-init",
  "currentPhase": 1,
  "completedTasks": ["T001", "T002"],
  "lastCheckpoint": "2026-08-24T22:30:00Z",
  "gitHead": "abc1234",
  "nextPhase": 2
}
```

### 5.4 检查点失败 → 中止并报告

```
❌ Phase 1 Checkpoint 失败
- ✗ 测试未通过（3/45 失败）
  → src/middleware/auth.ts 编译错误
- ✓ lint 零错误
- ✓ 覆盖率 85%（达标）
- ✓ git 状态干净

建议：
1. 修复测试失败的 3 个用例
2. 重新运行 /implement.run --phase=1
3. 或使用 /implement.abort 回滚
```

## 六、产出物

### 6.1 代码层

| 产出 | 路径 | 说明 |
|---|---|---|
| 源代码 | `src/` `app/` `pkg/` 等 | 按 tasks.md 创建/修改 |
| 测试代码 | `tests/` `__tests__/` `*_test.go` | 与源码同目录或单独目录 |
| 配置文件 | 项目根 | vite.config / pom.xml / Cargo.toml 等 |

### 6.2 报告层

| 产出 | 路径 | 说明 |
|---|---|---|
| 执行日志 | `.implement-logs/{feature}.log` | 每个任务的 stdout/stderr |
| 状态文件 | `.implement-state.json` | 断点续跑用 |
| 报告 | `docs/implement/{feature}-report.md` | 最终执行报告 |

### 6.3 最终报告模板

```markdown
# Implement Report: 001-feature

## 总览
- 总任务数: 23
- 已完成: 23
- 失败: 0
- 总耗时: 4h 32m
- 总 commit: 23

## Phase 统计
| Phase | 任务数 | 通过 | 失败 | 备注 |
|---|---|---|---|---|
| Phase 1: Setup | 3 | 3 | 0 | - |
| Phase 2: Foundational | 5 | 5 | 0 | - |
| Phase 3: US1 (MVP) | 8 | 8 | 0 | ⚠️ 1 次重试 |
| ... |

## 测试覆盖
- 总测试: 142
- 通过: 142 (100%)
- 覆盖率: 87%
- 契约测试: 18 个 endpoints 全部覆盖

## Checkpoint 历史
- Phase 1 ✓ 2026-08-24 18:30
- Phase 2 ✓ 2026-08-24 19:45
- Phase 3 ✓ 2026-08-24 21:00（含 1 次重试）
- ...
```

## 七、与上游下游的衔接

### 7.1 上游依赖

| 来自 | 读取 | 必需 |
|---|---|---|
| spec-bootstrap | `specs/001-feature/{spec,plan,tasks}.md` | ✓ |
| api-contract | `contracts/openapi.yaml` | ✓ |
| scaffold-runner | 已生成的项目目录 | ✓ |
| code-patterns | 团队编码约定 | ✓ |
| constitution | `constitution.md` 中的质量门禁 | ✓ |

### 7.2 下游触发

| 完成 implement 后 | 自动触发 |
|---|---|
| 完整代码 + 测试 | git-workflow 创建 PR |
| 覆盖率报告 | 写入 docs/coverage/ |
| 实施报告 | 写入 docs/implement/ |

## 八、强制约束（写入 constitution）

| 禁止 | 必须 |
|---|---|
| 跳过 Phase 直接做后续 | 严格 Phase 顺序：1 → 2 → 3 → ... |
| 不跑测试就 commit | 每个任务必须测试通过 + lint 通过 |
| 在 main 分支直接改代码 | 必须使用 feature 分支 |
| 跳过 Checkpoint | 每个 Phase 必须 Checkpoint 通过 |
| Agent 自主提交大改 | 单个 commit 改动 < < < 500 行（除非任务本身就是大改）|
| 跑 --force 绕过测试失败 | 测试失败必须修复，不允许 force |

## 九、失败回退

| 失败点 | 恢复动作 |
|---|---|
| 任务失败重试 3 次仍不通过 | 中止 + 报告失败任务 + 列出错误 + 等人工介入 |
| Checkpoint 失败 | 列出失败项 + 不进入下一 Phase + 提示人工 |
| Agent Loop 超时 | 保存 state + 提供 /resume 续跑 |
| MCP 工具不可用 | 提示 + 切换到本地 fallback（直接 Read/Write/Bash）|
| git 冲突 | 自动 stash + 报告 + 等人工合并 |

## 十、依赖

- Node.js 18+（Agent runtime）
- MCP 服务：FileSystem / Terminal / Git / TestRunner
- code-patterns（必需）
- test-runner（必需）
- git-workflow（必需）

## 十一、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `spec-bootstrap`, `api-contract`, `scaffold-runner`, `code-patterns`
- 下游: `git-workflow`, `test-runner`
- 配套: `debug-helper`（失败时调用）

## 十二、许可

MIT