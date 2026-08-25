---
name: review-checklist
description: |
 PR 自动评审 + 多维度质量检查。基于规则引擎 + AI 推理，覆盖：
 业务正确性 / 安全 / 性能 / 可维护性 / 契约一致性 / 测试覆盖。
 输出可执行的 checklist（每项通过/警告/失败），支持自动阻止 merge。
 为团队提供"客观、统一、可审计"的 review 标准。
version: 1.0.0
tags:
  - code-review
  - quality-gate
  - security
  - performance
  - maintainability
  - contract-consistency
entry-points:
  - review
  - checklist
  - approve
  - request-changes
  - block
requires:
  - node: ">=18"
  - mcp: "filesystem, git"
binds:
  - implement-executor
  - code-patterns
  - test-runner
  - git-workflow
  - debug-helper
  - api-contract
parent: project-orchestrator
phase: 2.5
position: pr-quality-gate
---

# review-checklist

> 把"代码评审"从主观判断变成"客观清单"——每一项都有明确通过标准。

## 一、定位与价值

传统 PR review 的问题：
- ❌ Reviewer 凭感觉，容易漏关键问题
- ❌ 不同 reviewer 标准不同，结果不一致
- ❌ 重复劳动（每次 review 都看同样的常见错误）
- ❌ 业务理解差异（reviewer 不一定懂业务）

`review-checklist` 把这些问题变成"可量化、可自动化的清单"：
- ✅ 规则引擎：100+ 条检查项，自动跑
- ✅ 统一标准：所有 PR 用同一份 checklist
- ✅ 业务对齐：对照 spec.md / openapi.yaml / tasks.md 验证业务正确性
- ✅ 失败自动阻止：严重问题直接 block merge

**核心价值**：
- ✅ 人类 reviewer 只需关注"业务决策"，机械检查全部自动化
- ✅ PR 质量基线统一，避免"看 reviewer 心情"
- ✅ 安全漏洞、性能问题、契约不一致等"易遗漏项"100% 覆盖

## 二、能力范围

### 2.1 `/review` 主命令

```bash
/review-checklist.review --pr=42
# 内部自动：
# 1. 获取 PR diff（git diff main..feature-branch）
# 2. 加载相关上下文（spec.md / openapi.yaml / tasks.md）
# 3. 跑规则引擎（100+ 检查项）
# 4. AI 推理（业务逻辑、命名、注释质量）
# 5. 输出报告：每项 [PASS/WARN/FAIL] + 详细说明
# 6. 输出最终建议：approve / request-changes / block
```

### 2.2 `/checklist` 查看清单

```bash
/review-checklist.checklist                 # 默认清单
/review-checklist.checklist --category=security  # 某类别
/review-checklist.checklist --as-markdown   # 输出为 Markdown
```

### 2.3 `/approve` / `/request-changes` / `/block` 操作

```bash
/review-checklist.approve --pr=42 --comment="LGTM"
/review-checklist.request-changes --pr=42 --reason="缺测试覆盖"
/review-checklist.block --pr=42 --reason="安全漏洞：硬编码密钥"
# 自动调用 GitHub/GitLab API
```

### 2.4 `/explain` 解释规则

```bash
/review-checklist.explain --rule="SEC-001"
# 为什么这条规则存在 + 如何修复 + 业界案例
```

## 三、Checklist 分类（6 大类，100+ 项）

### 3.1 类别 1：业务正确性（BIZ-001 ~ 050）

| 规则 ID | 检查项 | 自动化 |
|---|---|---|
| BIZ-001 | 实现的 User Story 与 spec.md 对应 | ✅ 自动 |
| BIZ-002 | 所有 P1 Story 的 Acceptance Scenario 可演示 | ⚠️ AI 推理 |
| BIZ-003 | 边界条件（空值/极值）已处理 | ✅ 自动 + AI |
| BIZ-004 | 错误分支有对应错误码（与 openapi.yaml 一致）| ✅ 自动 |
| BIZ-005 | 业务术语与 constitution.md 一致 | ⚠️ AI |
| BIZ-006 | 关键计算逻辑有单元测试 | ✅ 自动 |
| BIZ-007 | 业务流程符合状态机设计 | ⚠️ AI |
| ... | ... | ... |

### 3.2 类别 2：契约一致性（CONTRACT-001 ~ 030）

| 规则 ID | 检查项 | 自动化 |
|---|---|---|
| CONTRACT-001 | 请求 schema 匹配 openapi.yaml | ✅ Spectral |
| CONTRACT-002 | 响应 schema 匹配 openapi.yaml | ✅ Spectral |
| CONTRACT-003 | HTTP 状态码符合规范（200/201/400/401/404/422/500）| ✅ 自动 |
| CONTRACT-004 | 错误响应使用 Problem schema | ✅ 自动 |
| CONTRACT-005 | 必填字段都校验 | ✅ 自动 |
| CONTRACT-006 | traceId 在所有响应中存在 | ✅ 自动 |
| CONTRACT-007 | 鉴权 header 正确传递 | ✅ 自动 |
| CONTRACT-008 | x-page-id / x-button-id 锚点存在 | ✅ 自动 |
| ... | ... | ... |

### 3.3 类别 3：安全（SEC-001 ~ 040）

| 规则 ID | 检查项 | 自动化 |
|---|---|---|
| SEC-001 | 无硬编码密钥（API key / password / token）| ✅ git-secrets |
| SEC-002 | SQL 查询使用参数化（防 SQL 注入）| ✅ linter |
| SEC-003 | 用户输入已 sanitization（防 XSS）| ⚠️ AI |
| SEC-004 | 鉴权检查在每个需要鉴权的 endpoint | ⚠️ AI |
| SEC-005 | 敏感数据加密存储（密码 bcrypt 而非明文）| ✅ 自动 |
| SEC-006 | CORS 配置不允许 * | ✅ 自动 |
| SEC-007 | 无 dangerouslySetInnerHTML（React）| ✅ linter |
| SEC-008 | 依赖包无已知漏洞（npm audit）| ✅ 自动 |
| SEC-009 | rate limiting 在敏感端点存在 | ⚠️ AI |
| SEC-010 | HTTPS 在生产强制 | ✅ 自动 |
| ... | ... | ... |

### 3.4 类别 4：性能（PERF-001 ~ 030）

| 规则 ID | 检查项 | 自动化 |
|---|---|---|
| PERF-001 | 无 N+1 查询（database）| ⚠️ AI |
| PERF-002 | 大列表使用分页（Page/PageSize）| ✅ 自动 |
| PERF-003 | 数据库字段有索引 | ⚠️ AI |
| PERF-004 | 无阻塞同步调用（IO bound）| ⚠️ AI |
| PERF-005 | 大文件使用流式处理 | ⚠️ AI |
| PERF-006 | 前端列表虚拟化（>100 项）| ⚠️ AI |
| PERF-007 | 无不必要的 re-render（React）| ⚠️ AI |
| PERF-008 | 图片懒加载 + WebP | ⚠️ AI |
| PERF-009 | bundle 体积 < 阈值 | ✅ 自动 |
| PERF-010 | 关键路径 LCP < 2.5s | ⚠️ Lighthouse |
| ... | ... | ... |

### 3.5 类别 5：可维护性（MAINT-001 ~ 040）

| 规则 ID | 检查项 | 自动化 |
|---|---|---|
| MAINT-001 | 函数长度 < 50 行 | ✅ 自动 |
| MAINT-002 | 圈复杂度 < 15 | ✅ 自动 |
| MAINT-003 | 文件行数 < 300 行 | ✅ 自动 |
| MAINT-004 | 函数参数 ≤ 5 个（超出用 options）| ✅ 自动 |
| MAINT-005 | 命名符合 code-patterns | ✅ 自动 |
| MAINT-006 | 无 console.log / debugger | ✅ linter |
| MAINT-007 | 无 TODO 长期未清理 | ✅ 自动 |
| MAINT-008 | 无注释掉的代码 | ⚠️ AI |
| MAINT-009 | 注释解释"为什么"而非"做什么" | ⚠️ AI |
| MAINT-010 | 无循环依赖 | ✅ 自动 |
| MAINT-011 | import 顺序符合约定 | ✅ linter |
| ... | ... | ... |

### 3.6 类别 6：测试覆盖（TEST-001 ~ 020）

| 规则 ID | 检查项 | 自动化 |
|---|---|---|
| TEST-001 | 覆盖率 ≥ 80% | ✅ 自动 |
| TEST-002 | 新代码覆盖率 ≥ 90% | ✅ 自动 |
| TEST-003 | 每个 public function 有 happy test | ✅ 自动 |
| TEST-004 | 每个 error branch 有 negative test | ✅ 自动 |
| TEST-005 | 无 flaky tests | ✅ 自动 |
| TEST-006 | E2E 覆盖 P1 Story | ⚠️ AI |
| TEST-007 | 契约测试覆盖所有 endpoints | ✅ 自动 |
| TEST-008 | 集成测试覆盖关键路径 | ⚠️ AI |
| TEST-009 | 性能基线测试（关键 endpoint P95 < 阈值）| ⚠️ AI |
| ... | ... | ... |

## 四、`/review` 输出格式

```
═══════════════════════════════════════════════════════════
 PR Review 报告：#42 (feature/001-init → main)
═══════════════════════════════════════════════════════════

📊 总览
  ┌─────────────────┬───────┐
  │ 通过（PASS）     │ 87    │
  │ 警告（WARN）     │  8    │
  │ 失败（FAIL）     │  3    │
  │ 总计           │ 98    │
  └─────────────────┴───────┘
  建议：REQUEST_CHANGES（3 个 FAIL 必须修复）

🔴 FAIL（必须修复，3 项）

❌ SEC-001：硬编码密钥
  位置：src/api/config.ts:12
  代码：
    const API_KEY = 'sk-abc123def456...'  // ❌ 硬编码
  修复：从 env 读取：const API_KEY = process.env.API_KEY!
  风险：密钥泄露 → 严重安全事故

❌ CONTRACT-002：响应 schema 不匹配
  位置：src/api/users.ts:34
  openapi.yaml 定义：response.data.user.name (string, required)
  实际返回：response.data.user.name (可能被省略)
  修复：服务端必须保证 required 字段始终返回

❌ TEST-002：新代码覆盖率不达标
  位置：src/auth/login.ts（新代码 120 行）
  覆盖率：78%（要求 90%）
  缺失：登录失败的 negative test

⚠️ WARN（建议修复，8 项）

⚠️ PERF-005：可能的大文件阻塞
  位置：src/utils/export.ts:45
  代码：const data = fs.readFileSync('large-file.json')
  建议：改用流式：fs.createReadStream(...).pipe(...)

⚠️ MAINT-002：圈复杂度偏高
  位置：src/utils/validate.ts:12
  圈复杂度：18（要求 ≤ 15）
  建议：拆分函数

⚠️ MAINT-009：注释不够"为什么"
  位置：src/auth/jwt.ts:23
  注释：// 生成 token
  建议：改为解释为什么用 HS256 而非 RS256：
        // HS256: 单服务场景，对称加密更快

（... 5 个 WARN 已省略 ...）

✅ PASS（精选，5 项）

✓ BIZ-001：US-01 用户登录已实现
✓ BIZ-002：所有 P1 Story 有 Acceptance Scenario
✓ CONTRACT-001：请求 schema 匹配
✓ SEC-002：SQL 使用参数化
✓ TEST-001：覆盖率 87%（达标）

═══════════════════════════════════════════════════════════
 最终建议：REQUEST_CHANGES
═══════════════════════════════════════════════════════════
```

## 五、自动阻止 merge

### 5.1 阈值

| 类别 | 策略 |
|---|---|
| 安全（SEC-***）| 任何 1 项 FAIL → block |
| 契约（CONTRACT-***）| 任何 1 项 FAIL → block |
| 业务（BIZ-***）| P1 Story 未实现 → block；其他 → request-changes |
| 性能（PERF-***）| LCP > 4s → block；其他 → request-changes |
| 可维护性（MAINT-***）| WARN > 5 → request-changes |
| 测试（TEST-***）| 覆盖率 < 70% → block |

### 5.2 与 git-workflow 集成

```yaml
# .github/workflows/pr-check.yml
name: PR Auto Review
on: pull_request
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run review-checklist
        run: review-checklist.review --pr=${{ github.event.number }}
      - name: Block on FAIL
        run: |
          if [ "$(cat .review-result.json | jq '.verdict')" = "BLOCK" ]; then
            exit 1
          fi
      - name: Comment on PR
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('.review-result.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            });
```

## 六、可定制规则

### 6.1 项目级 `.review-rules.yaml`

```yaml
# 团队可调整的规则
project: my-saas-app
strict_mode: true      # strict = 任何 FAIL 都 block

overrides:
  # 项目特殊豁免（需明确注释原因）
  - rule_id: SEC-006
    reason: "内部工具，不需要 CORS"
    scope: "src/internal/**"

# 严格度升级
  - rule_id: MAINT-001
    max_function_lines: 30  # 默认 50 → 提高到 30

# 新增项目特定规则
  - rule_id: BIZ-CUSTOM-001
    description: "所有支付相关 endpoint 必须有幂等性检查"
    severity: FAIL
    check: "code_search('idempotency_key', pattern='payment')"
```

### 6.2 团队规则库

```bash
# 团队可发布自己的规则集
review-checklist.publish --rules=my-team.yaml --as=acme-team/strict

# 项目订阅
review-checklist.subscribe acme-team/strict
```

## 七、与上游下游的衔接

### 7.1 被调用方

| 来自 | 何时 |
|---|---|
| **git-workflow** | PR 创建后自动触发 |
| **CI/CD** | 每次 PR 触发 |

### 7.2 调用

| 调用 | 何时 |
|---|---|
| **debug-helper** | 发现严重问题 → 自动生成修复任务 |
| **code-patterns.validate** | 风格违规 → 详细列出 |
| **api-contract** | 契约不一致 → 触发重新生成 |
| **test-runner** | 覆盖率不达标 → 自动跑测试生成 |

## 八、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| Review 报告 | `.review-reports/pr-{N}.md` | 完整 PR 评审 |
| JSON 结果 | `.review-result.json` | 机器可读（CI 用） |
| Checklist 配置 | `.review-rules.yaml` | 项目自定义 |
| 规则库 | `.review-rules/library/` | 团队规则集 |

## 九、强制约束

| 禁止 | 必须 |
|---|---|
| 跳过 PR review | 每个 PR 必跑 checklist |
| FAIL 项"先合并再说" | 修复后才能合并 |
| 修改规则绕过检查 | 规则变更必须 PR + 团队 review |
| 用旧的 review 报告 | 每次新 commit 必重跑 |

## 十、失败回退

| 失败点 | 恢复动作 |
|---|---|
| LLM 推理服务不可用 | 回退到纯规则引擎（覆盖 60% 检查项）|
| git diff 太大（> 1000 行）| 分批 review + 提示 reviewer |
| 规则冲突（strict_mode 但有 override）| 提示 + 列出 override 清单 |
| 报告生成失败 | 至少输出 JSON 结果（保证 CI 可读）|

## 十一、依赖

- Node.js 18+
- LLM API（AI 推理）
- Static Analysis 工具（ESLint / Spectral / SonarQube）
- GitHub/GitLab API
- MCP：filesystem + git

## 十二、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `git-workflow`, CI/CD
- 配套: `code-patterns`, `test-runner`, `api-contract`, `debug-helper`
- 同类工具: SonarQube, CodeClimate, DeepSource, Codacy

## 十三、许可

MIT