---
name: code-patterns
description: |
 团队编码约定注入器。让 Agent 写代码时自动遵守团队的命名、错误处理、日志、
 API 调用、注释等约定。相当于"团队内的 CLAUDE.md / .cursor/rules" 自动化。
 通过扫描项目 + constitution.md 自动生成 + 团队可手动覆盖。
version: 1.0.0
tags:
  - team-conventions
  - code-quality
  - llm-context
  - pattern-injection
entry-points:
  - init
  - show
  - inject
  - update
  - validate
requires:
  - node: ">=18"
binds: []
parent: project-orchestrator
phase: 1.0
position: convention-foundation
---

# code-patterns

> 团队编码约定的"单一真相源"——Agent 写代码时必须遵守的规则。

## 一、定位与价值

`implement-executor` 在每个任务开始时会调用 `code-patterns.inject` 把当前规则注入 Agent prompt。没有这个 Skill，Agent 写的代码会"千人千面"——每个任务的风格不一致、错误处理方式不同、命名混乱。

**核心价值**：
- ✅ Agent 一次写出的代码就是团队标准
- ✅ 无需人类 review 风格问题（聚焦业务逻辑）
- ✅ 跨项目可复用（同一团队不同项目共享同一套约定）
- ✅ 可版本化、可审计、可回滚

## 二、命令清单

### 2.1 `/init` 初始化

```bash
/code-patterns.init
# 扫描项目 + constitution.md + 已有代码
# 生成 .code-patterns.yaml（项目级约定）
# 输出：
#   - 命名约定（变量、函数、类、文件、常量）
#   - 错误处理约定
#   - 日志约定
#   - API 调用约定
#   - 测试约定
#   - 注释/Doc 约定
```

### 2.2 `/show` 查看

```bash
/code-patterns.show                 # 完整规则
/code-patterns.show --section=naming  # 某个章节
/code-patterns.show --as-prompt     # 输出为可注入 Agent 的 prompt 格式
```

### 2.3 `/inject` 注入 Agent

```bash
/code-patterns.inject
# 返回结构化 YAML / Markdown，供 implement-executor 拼接到 Agent system prompt
# 示例输出：
#   # Team Code Conventions
#   ## 命名
#   - 变量：camelCase
#   - 函数：camelCase + 动词开头
#   - 类：PascalCase
#   - 常量：UPPER_SNAKE_CASE
#   - 文件名：kebab-case (例: user-profile.ts)
```

### 2.4 `/update` 更新

```bash
/code-patterns.update --section=naming --rule="组件文件用 PascalCase"
# 人类主导的更新 + git commit 留痕
```

### 2.5 `/validate` 验证代码合规

```bash
/code-patterns.validate --path=src/
# 扫描代码 vs 约定，列出违规
# 输出：
#   ❌ src/utils/math.ts:5  函数名 'Calc' 应改为 camelCase 'calc'
#   ❌ src/api/users.ts:12  console.log 应替换为 logger
```

## 三、规则文件 `.code-patterns.yaml`

```yaml
# Team Code Conventions
version: 1.0
project: my-saas-app
last_updated: 2026-08-24
inherits_from:
  - .specify/memory/constitution.md  # 治理宪法

sections:
  naming:
    variables: camelCase
    functions: camelCase + verb prefix (get, set, calculate, validate)
    classes: PascalCase
    interfaces: PascalCase + I prefix (TypeScript) | 无前缀 (Java/Python)
    constants: UPPER_SNAKE_CASE
    files:
      components: PascalCase.tsx       # React 组件
      utilities: kebab-case.ts         # 工具函数
      types: kebab-case.types.ts      # 类型定义
      tests: {name}.test.ts (or __tests__/{name}.test.ts)
      routes: kebab-case/route-name.ts

  error_handling:
    style: typed exceptions + Result types
    backend:
      framework: nestjs
      pattern: |
        // 抛业务异常
        if (!user) throw new NotFoundException('User not found');
        // 全局异常过滤器统一处理
      custom_errors:
        location: src/common/errors/
        base_class: BusinessException
        required_fields: [code, message, httpStatus]
    frontend:
      style: try-catch + 用户友好 toast
      pattern: |
        try {
          await api.call(...)
          return result
        } catch (err) {
          if (err.code === 'USER_NOT_FOUND') {
            toast.error('用户不存在')
          } else {
            logger.error('Unexpected error', err)
            toast.error('系统异常，请稍后重试')
          }
          throw err
        }

  logging:
    library: pino (backend) / consola (frontend)
    format: |
      logger.info({ userId, action: 'login' }, 'user login success')
    levels:
      - error: 系统异常、不可恢复错误
      - warn: 业务异常、可恢复
      - info: 关键业务事件
      - debug: 调试信息
    required_fields: [timestamp, level, message, traceId]
    forbidden:
      - console.log (生产代码)
      - print
      - System.out.println

  api_calls:
    style: generated client + typed responses
    generator: orval (from contracts/openapi.yaml)
    location: src/api/
    pattern: |
      import { getUserById } from '@/api/users'

      const user = await getUserById(id)
      // user 已经是强类型
    error_handling: 统一在 apiClient 拦截器处理

  testing:
    framework: vitest (frontend) / jest (backend)
    coverage:
      threshold: 80% (lines/branches/functions)
      exclude:
        - src/**/*.types.ts
        - src/**/*.d.ts
        - src/main.ts
    structure: AAA (Arrange, Act, Assert)
    naming: {describe}.{it}.test.ts
    required_tests:
      - 每个 public function 至少 1 个 happy path
      - 每个 error branch 至少 1 个 negative test
      - 每个组件至少 1 个渲染快照测试

  comments:
    language: zh-CN (内部说明) + en (公共 API doc)
    style:
      function_doc: JSDoc / TSDoc
      inline: 解释"为什么"而非"做什么"
      forbidden:
        - 显而易见的注释（// 初始化变量）
        - TODO 长期不清理（> 30 天自动 issue）
        - 注释掉的代码（直接删除 + git history）

  git:
    branch_strategy: git-flow (main / develop / feature/*)
    commit_message: Conventional Commits
    format: |
      <type>(<scope>): <subject>
      <body>
      <footer>
    types: [feat, fix, docs, style, refactor, test, chore]
    pr_template: .github/PULL_REQUEST_TEMPLATE.md
    required_checks:
      - CI green
      - 1 个 reviewer approve
      - 没有 merge conflict

  imports:
    order:
      - 1. Node 内置 (path, fs)
      - 2. 第三方 (react, lodash)
      - 3. 绝对路径 (@/...)
      - 4. 相对路径 (./)
    grouping: 空行分隔
    sort: alphabet within group
    forbidden:
      - 循环依赖
      - 跨层级引用 (e.g., pages → components → pages)

  file_structure:
    max_lines: 300          # 单文件代码行数上限
    max_cyclomatic: 15      # 圈复杂度上限
    max_params: 5           # 函数参数上限（超出用 options 对象）
```

## 四、自动注入格式

`code-patterns.inject` 返回的是可直接拼接到 Agent system prompt 的文本：

```text
# Team Code Conventions (v1.0)

你必须严格遵守以下团队约定。违反约定的代码将被 lint reject。

## 命名约定
- 变量/函数：camelCase，函数必须动词开头
- 类/接口：PascalCase（TS 用 I 前缀，其他语言不用）
- 常量：UPPER_SNAKE_CASE
- 文件：组件 PascalCase.tsx、工具 kebab-case.ts、类型 .types.ts 后缀

## 错误处理
- 后端：使用 NestJS 内置异常 + 自定义 BusinessException
- 前端：try-catch + 用户友好 toast + 不吞错
- 严禁：吞错、返回 -1 表示错误、空 catch 块

## 日志
- 使用 pino（后端）/ consola（前端）
- 严禁：console.log 出现在生产代码中

## API 调用
- 使用 orval 生成的 client，禁止手写 fetch/axios
- 类型自动从 openapi.yaml 推导

## 测试
- 覆盖率 ≥ 80%
- AAA 结构，每个 public function 必有 happy + negative 测试

## 注释
- 中文写内部说明，英文写公共 API
- 严禁：显而易见的注释、TODO 长期不清理

## Git
- Conventional Commits 格式
- feat/fix/docs/style/refactor/test/chore
- 1 个 reviewer approve 才能 merge
```

## 五、规则来源优先级

```
1. .code-patterns.yaml（项目级，最高优先级）
   ↓ 缺失时
2. constitution.md 中的相关条款
   ↓ 缺失时
3. 已有代码的统计规律（自动推断）
   ↓ 缺失时
4. 团队默认（来自 Skill 内置）
```

### 5.1 自动推断逻辑

`/init` 时扫描 `src/`、`tests/`，统计：
- 文件名命名风格（占比 > 80% 视为约定）
- 变量命名（regex 匹配）
- 错误处理模式（grep throw / try-catch）
- 日志库（package.json + import 统计）
- 测试覆盖率（jest/vitest 配置）

### 5.2 人工覆盖

```bash
# 团队成员可手动编辑 .code-patterns.yaml
# 或通过 /update 命令
/code-patterns.update --section=naming --rule="React 组件 props 解构顺序：children 在最前"
# 自动 git commit + 创建 PR
```

## 六、与 LLM 生态的对标

| 工具 | 等价物 | 我们的优势 |
|---|---|---|
| Claude Code | `CLAUDE.md` | 标准化 + 可版本化 + 跨项目复用 |
| Cursor | `.cursor/rules` | 规则可自动推导，不强制手写 |
| GitHub Copilot | `.github/copilot-instructions.md` | 与 Spec Kit 整合，含完整规则 schema |
| Aider | `--edit-format` flag | 默认遵守 + 无需每次指定 |
| Continue | `.continuerc.json` | 多 Skill 协作，不孤立 |

## 七、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| 规则定义 | `.code-patterns.yaml` | 主规则文件 |
| Lint 配置 | `.eslintrc.cp.json`（或同等） | 自动从规则生成 |
| 验证脚本 | `scripts/validate-patterns.ts` | /validate 命令实现 |
| 注入器 | `scripts/inject-patterns.ts` | /inject 命令实现 |
| 文档 | `docs/code-patterns.md` | 人类可读的规则说明 |

## 八、与上下游的衔接

### 8.1 上游

| 来自 | 读取 |
|---|---|
| spec-bootstrap | constitution.md（治理宪法） |
| 项目本身 | 已有代码（自动推断） |

### 8.2 下游

| 被谁调用 | 用途 |
|---|---|
| **implement-executor** | 每个任务开始前 /inject → 拼接到 Agent system prompt |
| git-workflow | PR title / commit message 校验 |
| review-checklist | 评审时检查代码是否违反约定 |
| debug-helper | 报错时定位风格问题 |

### 8.3 在 Bundle 主流程中的位置

```
Phase 1.0: code-patterns（最早建立规则）
）
Phase 1.1-1.7: spec-bootstrap / scaffold / ui-design / design / contract
）
Phase 2.0: implement-executor（每个任务 inject patterns）
```

## 九、强制约束

| 禁止 | 必须 |
|---|---|
| 跳过 /init 直接开始 implement | 第一次 implement 前必须 /init |
| 手动编辑生成的 lint 配置 | 修改应通过 /update → 自动重新生成 |
| 规则与 constitution 冲突时仍使用 | 冲突必须修改规则，且必须更新 constitution |
| 不同项目用不同规则 | 同一团队应共享基础规则集 |

## 十、失败回退

| 失败点 | 恢复动作 |
|---|---|
| 自动推断错误率高 | 提示人工 review + 修正 |
| Agent 仍违反规则 | /validate → 列出违规 → 强制重写 |
| 规则与 constitution 冲突 | 中止 + 列出冲突点 + 等人工解决 |
| 规则文件被破坏 | 从 git history 恢复 + 重新 /init |

## 十一、依赖

- Node.js 18+
- 项目内源代码（用于自动推断）
- constitution.md（来自 spec-bootstrap）

## 十二、相关链接

- 父 Skill: `project-orchestrator`
- 平行: `spec-bootstrap`, `scaffold-runner`
- 下游: `implement-executor`, `git-workflow`, `review-checklist`
- 同类工具: CLAUDE.md / .cursor/rules

## 十三、许可

MIT