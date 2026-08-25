---
name: debug-helper
description: |
 智能调试助手。分析 stack trace + 日志关联 + 根因定位 + 修复建议。
 支持 Node.js / Python / Go / Java / 浏览器错误。整合 AI 推理 + 历史错误模式库。
 当 implement-executor 任务失败 3 次后自动调用，输出可操作的修复方案。
version: 1.0.0
tags:
  - debugging
  - error-analysis
  - stack-trace
  - log-correlation
  - root-cause
entry-points:
  - analyze
  - trace
  - logs
  - bisect
  - history
requires:
  - node: ">=18"
binds:
  - implement-executor
  - test-runner
  - code-patterns
  - git-workflow
parent: project-orchestrator
phase: 2.4
position: debugging-assistant
---

# debug-helper

> 让 Agent 不再"卡死"在错误上——而是系统化定位根因 + 输出修复方案。

## 一、定位与价值

当 Agent 写代码遇到错误（测试失败、构建错误、运行时异常），传统模式是：
1. 反复重试同一个修复 → 3 次仍失败 → 中止转人工

`debug-helper` 把这个过程系统化：
1. 智能解析 stack trace → 识别真正错误点（而非表面错误）
2. 关联日志 + git history → 找"上次为什么会坏"
3. 匹配已知错误模式库 → 给出**已验证的**修复方案
4. bisect 定位 → "是哪次 commit 引入的 bug"

**核心价值**：
- ✅ Agent 不再"无脑重试"，而是"有方法地修复"
- ✅ 错误归因到具体代码行 + commit + PR
- ✅ 修复建议基于"团队历史已验证的方案"
- ✅ 把"调试"从艺术变成科学

## 二、能力范围

### 2.1 `/analyze` 主命令

```bash
/debug-helper.analyze --error="<stack trace 或日志>"
# 内部自动：
# 1. 解析错误类型（见 5 大类）
# 2. 提取关键信息：错误位置 + 触发条件 + 上下文
# 3. 在知识库中匹配（团队历史错误模式）
# 4. AI 推理根因（LLM）
# 5. 输出：根因 + 修复方案 + 验证步骤
```

### 2.2 `/trace` 单步追踪

```bash
/debug-helper.trace --from=src/auth/login.ts --line=45
# 显示该位置的调用栈
# 列出该函数的最近 10 次修改
# 提示相关测试
```

### 2.3 `/logs` 日志关联

```bash
/debug-helper.logs --time="2026-08-24T10:00:00..11:00:00" --filter="ERROR"
# 拉取指定时间窗口的日志
# 按 traceId / requestId 关联
# 输出时间线视图
```

### 2.4 `/bisect` 二分定位

```bash
/debug-helper.bisect --bad=HEAD --good=v1.0.0 --test="npm test"
# 自动 git bisect
# 输出：引入 bug 的具体 commit hash + author + message
```

### 2.5 `/history` 错误历史

```bash
/debug-helper.history --error="Cannot read property 'user' of undefined"
# 列出团队历史上所有相同错误的出现
# 每个错误的：commit / 修复方案 / 耗时
```

## 三、5 大错误类别

### 3.1 错误分类体系

| 类别 | 典型特征 | 调试策略 |
|---|---|---|
| **1. SyntaxError** | 编译失败、TypeError、Cannot find module | 静态分析 + AST 对比 |
| **2. RuntimeError** | 空指针、数组越界、TypeError at runtime | 动态追踪 + 边界测试 |
| **3. LogicError** | 测试期望≠实际、断言失败 | 数据流追踪 + 反例构造 |
| **4. IntegrationError** | API 调用失败、超时、CORS、404 | 网络日志 + Mock 验证 |
| **5. PerformanceError** | 超时、内存泄漏、CPU 飙升 | profiling + 火焰图 |

### 3.2 自动识别逻辑

```javascript
function classifyError(errorMessage, stackTrace) {
  // 1. SyntaxError
  if (errorMessage.match(/SyntaxError|TypeError: undefined|Cannot find module|Type \w+ has no properties/)) {
    return 'syntax';
  }
  // 2. RuntimeError
  if (errorMessage.match(/Cannot read|undefined|null is not|NaN|out of bounds|RangeError/)) {
    return 'runtime';
  }
  // 3. LogicError
  if (errorMessage.match(/AssertionError|Expected.*Received|expected.*to (be|equal)/)) {
    return 'logic';
  }
  // 4. IntegrationError
  if (errorMessage.match(/fetch failed|NetworkError|404|500|CORS|ECONNREFUSED|timeout/)) {
    return 'integration';
  }
  // 5. PerformanceError
  if (errorMessage.match(/timeout|out of memory|heap|stack overflow|MaxListenersExceeded/)) {
    return 'performance';
  }
  return 'unknown';
}
```

## 四、根因定位算法

### 4.1 三层推理

```
Layer 1: 表面错误（What）
  ↓ "Cannot read property 'user' of undefined"
  ↓ 位置：src/api/users.ts:23
  
Layer 2: 直接原因（Why directly）
  ↓ 调用栈：getUserById → fetchUser → response.data.user
  ↓ 原因：API 返回的 response.data 是 null

Layer 3: 根本原因（Why fundamentally）
  ↓ 为什么 response.data 是 null？
  ↓ 历史：上次 commit (abc123) 修改了后端返回结构（移除外层包装）
  ↓ 但前端代码仍按老结构解析
  ↓ 根因：跨服务契约变更未同步 → 触发 git-workflow 的契约同步 + api-contract 校验
```

### 4.2 分析流程图

```
输入：错误信息 + stack trace + 上下文
        ↓
   ┌─────────────────────────────┐
   │ ① 解析 stack trace          │
   │ 提取：位置、函数、参数       │
   └──────────┬──────────────────┘
              ↓
   ┌─────────────────────────────┐
   │ ② 匹配错误模式库           │
   │ 查找历史相似问题 + 修复方案  │
   └──────────┬──────────────────┘
              ↓
   ┌─────────────────────────────┐
   │ ③ 关联上下文              │
   │ - 最近修改（git log -L）    │
   │ - 相关测试（grep）          │
   │ - 依赖变更（package.json） │
   └──────────┬──────────────────┘
              ↓
   ┌─────────────────────────────┐
   │ ④ LLM 推理根因             │
   │ 输入：错误 + 历史 + 上下文  │
   │ 输出：3 层根因 + 修复方案    │
   └──────────┬──────────────────┘
              ↓
   ┌─────────────────────────────┐
   │ ⑤ 输出报告               │
   │ - 根因（3 层）             │
   │ - 修复方案（具体到行）       │
   │ - 验证步骤                  │
   │ - 预防措施                  │
   └─────────────────────────────┘
```

## 五、错误模式知识库

### 5.1 知识库结构

```yaml
# .debug-knowledge.yaml（自动累积）
patterns:
  - id: PATTERN-001
    signature: "Cannot read property 'user' of undefined"
    category: runtime
    frequency: 23      # 出现次数
    first_seen: 2026-01-15
    last_seen: 2026-08-24
    common_causes:
      - API 返回结构变化未同步
      - 数据库返回 null（业务规则变更）
      - Mock 数据缺失字段
    fix_templates:
      - template: "添加 optional chaining: user?.id"
        success_rate: 85%
        avg_time: 5min
      - template: "添加 null check: if (!user) throw new NotFoundError()"
        success_rate: 90%
        avg_time: 8min
    preventive_measures:
      - "在 api-contract 中标记字段为 required/optional"
      - "使用 TypeScript strict mode"
      - "在 CI 中跑 schema 校验"
    related_commits:
      - abc123 (2026-08-20) "fix: add null check"
      - def456 (2026-07-15) "refactor: change API response structure"
```

### 5.2 自动累积

```bash
# debug-helper 每次成功解决一个错误，自动更新知识库
debug-helper.analyze --error="..." --fix="..." --commit=abc123
# → 自动追加到 .debug-knowledge.yaml
# → git commit 留痕
```

## 六、`/analyze` 输出格式

```
═══════════════════════════════════════════════════════════
 调试报告：Cannot read property 'user' of undefined
═══════════════════════════════════════════════════════════

📍 错误位置
  文件：src/api/users.ts:23
  函数：getUserById
  调用栈：
    getUserById (src/api/users.ts:23)
    ← UserProfile (src/components/UserProfile.tsx:15)
    ← render (src/main.tsx:8)

🔍 错误分类
  类型：RuntimeError (Category 2)
  模式匹配：PATTERN-001（23 次历史命中）

🎯 三层根因分析

【Layer 1: 表面错误】
  response.data.user 不存在，访问 .user 触发 TypeError

【Layer 2: 直接原因】
  fetchUser() 返回 null，但代码未做 null check
  → 实际：response = null
  → 期望：response.data.user = { id, name, ... }

【Layer 3: 根本原因】
  后端在 commit def456 移除外层包装：
    旧：{ code: 200, data: { user: {...} } }
    新：{ user: {...} }  ← data 层被移除

  但前端代码未同步更新，导致解析失败。
  这是典型的"跨服务契约变更未同步"。

🔧 推荐修复方案（基于历史成功率）

方案 A: Optional Chaining（成功率 85%，5 min）
  ```typescript
  // src/api/users.ts:23
  - const user = response.data.user
  + const user = response.data?.user
  ```

方案 B: Null Check + 抛错（成功率 90%，8 min）✅ 推荐
  ```typescript
  // src/api/users.ts:23
  if (!response?.data?.user) {
    throw new NotFoundException('User not found')
  }
  const user = response.data.user
  ```

✅ 验证步骤
  1. 应用修复
  2. 跑测试：npm test -- getUserById
  3. 添加新测试覆盖 null 情况
  4. 跑契约测试：test-runner.contract

🛡 预防措施
  - 在 openapi.yaml 中明确标记字段为 required
  - 在 CI 中加 schema 校验（api-contract 自动校验）
  - 启用 TypeScript strict mode
  - 在 git-workflow 中加契约同步步骤

📊 关联信息
  相关 commit: def456 (2026-07-15) "refactor: change API response structure"
  关联 PR: #45
  责任人: @alice
  耗时: 12 分钟

═══════════════════════════════════════════════════════════
```

## 七、`/bisect` 二分定位

### 7.1 工作流程

```
git log --oneline --all
  abc123 (HEAD) ← BAD
  def456
  ...
  xyz789 (v1.0.0) ← GOOD

debug-helper.bisect
  → 自动化 git bisect run
  → 中间 commit 自动跑测试
  → 输出第一个失败的 commit
```

### 7.2 实现（基于 git bisect run）

```bash
#!/bin/bash
# 由 debug-helper 自动执行
git bisect start
git bisect bad HEAD
git bisect good v1.0.0

# 自动跑测试
git bisect run npm test --silent

# 输出
# abc123 is the first bad commit
# commit abc123
# Author: Alice <alice@example.com>
# Date:   Mon Aug 24 10:00:00 2026
#
#     refactor: change API response structure
```

## 八、`/logs` 日志关联

### 8.1 自动收集（约定）

```yaml
# code-patterns.logging 中已配置：
logging:
  required_fields: [timestamp, level, message, traceId]
```

### 8.2 关联规则

```bash
debug-helper.logs --time="2026-08-24T10:00:00..11:00:00" --filter="ERROR"
# 输出：
# 10:30:15 [ERROR] [traceId=abc] login failed: Cannot read property 'user'
#   at src/api/users.ts:23
#   context: { userId: 'u123', requestId: 'r456' }
# 10:30:15 [WARN] [traceId=abc] retry attempt 1/3
#   context: { endpoint: '/api/users/u123' }
# 10:30:16 [ERROR] [traceId=abc] circuit breaker tripped
#   context: { service: 'users-api' }
```

### 8.3 跨服务追踪

```bash
debug-helper.logs --traceId=abc
# 自动聚合：
#   - 前端日志（错误）
#   - API 网关日志
#   - 用户服务日志
#   - 数据库查询日志
# 输出完整调用链
```

## 九、与上游下游的衔接

### 9.1 被调用方

| 来自 | 何时 |
|---|---|
| **implement-executor** | 任务失败 3 次后自动调用 |
| **test-runner** | 测试失败归类时调用 |
| **code-patterns.validate** | 违规提示 + 调用 |
| **git-workflow** | 冲突解决时调用 |
| **review-checklist** | 发现严重问题 + 阻止 merge |

### 9.2 调用

| 调用 | 何时 |
|---|---|
| **git-workflow** | 修复完成 → 自动 commit |
| **test-runner** | 修复后 → 跑测试验证 |

## 十、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| 知识库 | `.debug-knowledge.yaml` | 累积所有错误模式 + 修复方案 |
| 调试报告 | `.debug-reports/{error-id}.md` | 每次调试的完整记录 |
| bisect 结果 | `.debug-reports/bisect-{date}.log` | 二分定位日志 |
| 相关 git log | 自动嵌入报告中 | 显示最近修改历史 |

## 十一、强制约束

| 禁止 | 必须 |
|---|---|
| 无方法地重试 | 失败 3 次必须调用 debug-helper |
| 修改代码不记录原因 | 每次修复必须更新知识库 |
| 跳过根因直接修复表面 | 必须给出 3 层根因分析 |
| 删除调试日志 | 调试信息必须归档 |
| 用 console.log 调试 | 必须用 debugger / tracing |

## 十二、失败回退

| 失败点 | 恢复动作 |
|---|---|
| LLM 推理不出根因 | 回退到"已知模式库"匹配 |
| bisect 找不到 commit | 检查测试稳定性 + 重跑 |
| 日志拉取失败 | 用本地 stderr 替代 |
| 知识库损坏 | 从 git history 恢复 |

## 十三、依赖

- Node.js 18+
- Git（bisect 用）
- 日志系统（pino / winston / structlog 等）
- LLM API（用于根因推理）

## 十四、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `implement-executor`, `test-runner`, `code-patterns`
- 配套: `git-workflow`（自动 commit 修复）

## 十五、许可

MIT