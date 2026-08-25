---
name: test-runner
description: |
 自动化测试执行 + 覆盖率分析 + 失败重试 + 报告生成。
 跨框架支持（vitest / jest / pytest / go test / cargo test / mvn test）。
 集成代码契约校验（对照 openapi.yaml）、可视化截图对比（Playwright）、E2E 流程编排。
 为 implement-executor 的 Checkpoint 提供"测试通过"质量门禁。
version: 1.0.0
tags:
  - testing
  - coverage
  - ci-quality-gate
  - vitest
  - jest
  - pytest
  - playwright
entry-points:
  - run
  - coverage
  - watch
  - debug
  - contract
  - e2e
requires:
  - node: ">=18"
  - python: ">=3.10"（如使用 pytest）
  - go: ">=1.21"（如使用 go test）
  - playwright: ">=1.40"（如使用 E2E）
binds:
  - implement-executor
  - code-patterns
  - api-contract
  - debug-helper
parent: project-orchestrator
phase: 2.2
position: quality-gate
---

# test-runner

> 让"测试通过"成为 Agent 写代码的硬性 Quality Gate，而不是事后人工检查。

## 一、定位与价值

`implement-executor` 每完成一个任务/Phase 都会调用 `test-runner` 验证结果。如果测试失败，Agent 必须修复；如果连续 3 次仍不通过，自动升级到人工介入。

**核心价值**：
- ✅ 测试作为硬性质量门禁，Agent 不能"跳过测试"
- ✅ 自动适配 6 种主流测试框架
- ✅ 覆盖率与契约校验联动（契约测试 = 业务正确性）
- ✅ 失败时自动归类 + 输出修复建议

## 二、能力范围

### 2.1 `/run` 主命令

```bash
/test-runner.run
# 自动检测项目类型（package.json / pyproject.toml / go.mod / pom.xml / Cargo.toml）
# 自动选择对应框架
# 跑全部测试 + 输出报告
```

### 2.2 `/coverage` 覆盖率

```bash
/test-runner.coverage
# 跑测试 + 生成覆盖率报告
# 阈值校验（默认 ≥ 80%，可在 code-patterns 配置）
# 输出 HTML + JSON + LCOV 三种格式
```

### 2.3 `/watch` 监听模式

```bash
/test-runner.watch
# 文件变化时自动跑测试
# Agent 开发期间实时反馈
```

### 2.4 `/debug` 调试失败用例

```bash
/test-runner.debug --test="src/auth/login.test.ts > should reject invalid password"
# 输出 stack trace + 上下文 + 修复建议
# 调用 debug-helper 解析错误
```

### 2.5 `/contract` 契约测试

```bash
/test-runner.contract --from=contracts/openapi.yaml
# 对每个 endpoint 自动生成契约测试
# 验证：
#   - 请求/响应 schema 匹配
#   - 错误码 4xx/5xx 覆盖
#   - 鉴权要求正确
#   - 必填字段校验
```

### 2.6 `/e2e` 端到端测试

```bash
/test-runner.e2e --from=specs/001-feature/spec.md
# 从 Acceptance Scenarios 自动生成 Playwright 用例
# 跑完整业务流程
# 截图归档到 docs/e2e/{date}/
```

## 三、框架适配矩阵

| 项目类型 | 检测文件 | 测试框架 | 命令 | 覆盖率工具 |
|---|---|---|---|---|
| Node.js (React/Vue/Next) | `package.json` | vitest / jest | `npm test` / `pnpm test` | c8 / istanbul |
| Python | `pyproject.toml` / `requirements.txt` | pytest | `pytest --cov` | coverage.py |
| Java/Kotlin | `pom.xml` / `build.gradle` | JUnit 5 | `mvn test` | JaCoCo |
| Go | `go.mod` | go test | `go test ./...` | go test -cover |
| Rust | `Cargo.toml` | cargo test | `cargo test` | tarpaulin |
| .NET | | xUnit / NUnit | `dotnet test` | coverlet |

### 自动检测逻辑

```javascript
function detectFramework(projectRoot) {
  const fs = require('fs');
  const path = require('path');

  if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
    const pkg = require(path.join(projectRoot, 'package.json'));
    if (pkg.devDependencies?.vitest) return 'vitest';
    if (pkg.devDependencies?.jest) return 'jest';
    return 'npm-test';
  }
  if (fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) return 'pytest';
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) return 'cargo';
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(projectRoot, 'pom.xml'))) return 'maven';
  throw new Error('No recognized framework');
}
```

## 四、覆盖策略

### 4.1 默认阈值（可在 `.code-patterns.yaml` 中覆盖）

```yaml
testing:
  coverage:
    threshold: 80%               # 全局最低线
    per_file_minimum: 50%        # 单文件最低线（防止"挂件"文件拉低平均）
    exclude:
      - src/**/*.types.ts
      - src/**/*.d.ts
      - src/main.ts
      - **/*.test.ts
      - **/*.spec.ts
      - **/migrations/**
```

### 4.2 增量覆盖率（PR 维度）

```bash
/test-runner.coverage --diff=main
# 只统计"本次 PR 改动"的覆盖率
# 阈值：新代码 90%，存量代码 80%
# 输出：
#   - src/auth/login.ts      新增 100% (45/45 lines)
#   - src/auth/logout.ts     新增 0%   ⚠️ 未测
#   - src/utils/format.ts    改动 30% (3/10 lines)
```

## 五、契约测试（核心差异化能力）

### 5.1 工作流程

```
contracts/openapi.yaml
        ↓
test-runner.contract 读取
        ↓
按 endpoint 生成 contract test 模板
        ↓
补充：示例请求体 + 期望响应 + 鉴权 header
        ↓
跑测试：每个 endpoint 至少 3 个用例
  - happy path（200/201）
  - validation error（400）
  - unauthorized（401）
  - not found（404）
        ↓
生成 docs/contract-coverage.html（覆盖率报告）
```

### 5.2 契约测试模板（自动生成）

```typescript
// test-runner.contract 自动生成的示例
// 文件：tests/contract/auth.test.ts

import { describe, it, expect } from 'vitest';
import { apiClient } from '@/api/client';

describe('POST /api/v1/auth/login (openapi.yaml:paths./auth/login)', () => {
  it('should return 200 + token on valid credentials', async () => {
    const res = await apiClient.post('/auth/login', {
      email: 'user@example.com',
      password: 'Password123',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchSchema({
      type: 'object',
      required: ['token', 'user'],
      properties: {
        token: { type: 'string' },
        user: { $ref: '#/components/schemas/User' },
      },
    });
  });

  it('should return 401 on invalid credentials', async () => {
    const res = await apiClient.post('/auth/login', {
      email: 'user@example.com',
      password: 'wrong',
    });
    expect(res.status).toBe(401);
  });

  it('should return 400 on missing fields', async () => {
    const res = await apiClient.post('/auth/login', {
      email: 'user@example.com',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'USER_VALIDATION_EMAIL_INVALID');
  });

  it('should return 429 after 5 failed attempts (rate limit)', async () => {
    for (let i = 0; i < 5; i++) {
      await apiClient.post('/auth/login', { email: 'x', password: 'x' });
    }
    const res = await apiClient.post('/auth/login', { email: 'x', password: 'x' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
```

## 六、失败归类 + 修复建议

### 6.1 自动归类

```javascript
function classifyFailure(testResult) {
  if (testResult.error.includes('AssertionError')) return 'logic-error';
  if (testResult.error.includes('TypeError')) return 'type-error';
  if (testResult.error.includes('NetworkError')) return 'integration-error';
  if (testResult.error.includes('TimeoutError')) return 'performance-issue';
  if (testResult.error.match(/Cannot find module/)) return 'missing-dependency';
  return 'unknown';
}
```

### 6.2 修复建议（按类别）

| 类别 | 建议 |
|---|---|
| `logic-error` | 检查边界条件、空值、特殊输入 |
| `type-error` | 检查 TypeScript 类型定义、schema 匹配 |
| `integration-error` | 检查 API 调用、mock 数据、网络层 |
| `performance-issue` | 检查 N+1 查询、循环复杂度、超时配置 |
| `missing-dependency` | 检查 package.json / pip install / go mod |
| `unknown` | 调用 debug-helper 进一步分析 |

### 6.3 输出格式

```
❌ 3 tests failed in src/auth/login.test.ts:

❌ [logic-error] should reject invalid password (Line 23)
  Expected: 401
  Received: 200
  Suggestion: 检查 login service 的密码校验逻辑；bcrypt.compare 是否正确调用

❌ [type-error] should return user object matching schema (Line 45)
  Expected: property 'createdAt' to be ISO date string
  Received: number (1734567890)
  Suggestion: 序列化时调用 .toISOString() 或调整 schema 为 integer (timestamp)

❌ [missing-dependency] should hash password with bcrypt
  Error: Cannot find module 'bcrypt'
  Suggestion: 运行 `pnpm add bcrypt` 或 `pnpm add -D @types/bcrypt`
```

## 七、E2E 测试（基于 Mermaid 流程图）

### 7.1 工作流程

```
specs/001-feature/spec.md
  ↓ 抽取 Acceptance Scenarios
test-runner.e2e --from=spec.md
  ↓ 翻译为 Playwright 测试
tests/e2e/us-01-login.spec.ts
  ↓ 跑测试 + 截图
docs/e2e/2026-08-24/
  - us-01-login-pass.png
  - us-01-login-fail.png
```

### 7.2 自动生成的 E2E 测试

```typescript
// test-runner.e2e 自动生成
// 文件：tests/e2e/us-01-login.spec.ts

import { test, expect } from '@playwright/test';

test('US-01: User can log in with valid credentials', async ({ page }) => {
  // Given: 游客在登录页
  await page.goto('/login');

  // When: 输入合法手机号 + 正确密码
  await page.fill('[data-testid=phone]', '13800138000');
  await page.fill('[data-testid=password]', 'Password123');
  await page.click('[data-testid=submit]');

  // Then: 跳转首页
  await expect(page).toHaveURL('/home');
  await expect(page.locator('[data-testid=welcome]')).toContainText('欢迎');

  // 截图存档
  await page.screenshot({ path: 'docs/e2e/2026-08-24/us-01-login-pass.png' });
});
```

## 八、与 implement-executor 的 Checkpoint 衔接

```javascript
// implement-executor 调用 test-runner 的伪代码
async function runCheckpoint(phase) {
  const testResult = await testRunner.run();
  const coverage = await testRunner.coverage({ diff: 'main' });
  const contract = await testRunner.contract({ from: 'contracts/openapi.yaml' });

  const checks = {
    allTestsPass: testResult.failed === 0,
    coverageMeets: coverage.total >= codePatterns.testing.coverage.threshold,
    newCodeCoverageMeets: coverage.newCode >= 90,
    contractCoverage: contract.coverage >= 95,
    noFlakyTests: testResult.flaky === 0,
  };

  const passed = Object.values(checks).every(v => v);
  if (!passed) {
    return { passed: false, checks, suggestion: generateSuggestion(checks) };
  }
  return { passed: true };
}
```

## 九、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| 测试代码 | `tests/` `__tests__/` `*_test.*` | Agent 按契约自动生成 |
| 覆盖率报告 | `coverage/` | HTML + JSON + LCOV |
| 契约覆盖率 | `docs/contract-coverage.html` | openapi.yaml 覆盖度 |
| E2E 截图 | `docs/e2e/{date}/` | 每次跑测试自动归档 |
| 测试日志 | `.test-logs/{date}.log` | 失败栈追踪 |
| CI 配置 | `.github/workflows/test.yml` | 自动生成 |

## 十、强制约束

| 禁止 | 必须 |
|---|---|
| 跳过测试直接 commit | implement-executor 每个任务必跑测试 |
| 写不稳定的测试（flaky）| 必须 deterministic，可重入 |
| 用 console.log 调试 | 必须用 debugger / 测试框架的 verbose 模式 |
| 测试覆盖 < 阈值 | 阈值可在 code-patterns 中配置 |
| 契约覆盖 < 95% | 阻止 PR merge |
| 写测试仅为了 100% 覆盖率 | 必须有真实断言，不能空测试 |
| 在 CI 上跑长 E2E（>5min）| 长 E2E 拆分为独立 job |

## 十一、失败回退

| 失败点 | 恢复动作 |
|---|---|
| 框架未识别 | 提示用户手动指定 + 检查项目文件 |
| 测试运行超时 | 自动拆分 + 提示用户加 timeout |
| 覆盖率不达标 | 列出未覆盖代码 → Agent 补测试 |
| 契约测试失败 | 调用 debug-helper + api-contract 校验 |
| E2E 截图失败 | 重试 1 次 → 跳过 + 警告 |
| CI 资源耗尽 | 自动降级为只跑 changed 文件的测试 |

## 十二、依赖

- Node.js 18+ / Python 3.10+ / Go 1.21+（按项目）
- MCP 服务：Terminal（用于跑命令）
- 配套: `implement-executor`、`code-patterns`、`api-contract`、`debug-helper`

## 十三、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `implement-executor`、`code-patterns`
- 配套: `api-contract`（契约来源）、`debug-helper`（失败归类）

## 十四、许可

MIT