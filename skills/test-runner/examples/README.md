# 契约测试模板（test-runner.contract 自动生成示例）

本目录是 `test-runner` 子 Skill 的**完整契约测试模板**示例，演示如何从 `openapi.yaml` 自动生成覆盖 18 个端点的契约测试。

## 📂 文件清单

| 文件 | 作用 |
|---|---|
| `openapi.yaml` | OpenAPI 3.1.2 契约源（18 个端点 + 完整 schema + RFC 9457 Problem） |
| `contract.test.ts` | vitest 格式的契约测试（18 个 describe + 70+ 个 it）|
| `spectral.yaml` | Spectral lint 配置（契约验证规则）|
| `package.json` | 依赖与脚本 |
| `README.md` | 本文件 |

## 🎯 覆盖范围

### 18 个端点（按业务模块分组）

| 模块 | 端点 |
|---|---|
| **Auth（3）** | POST /auth/login · POST /auth/sms · POST /auth/oauth/douyin |
| **Accounts（3）** | GET /accounts · POST /accounts/{id}/disable · DELETE /accounts/{id} |
| **Timesheets（2）** | POST /timesheets · GET /timesheets |
| **Projects（2）** | GET /projects · POST /projects |
| **Boards（4）** | GET /boards/{id} · POST /boards/{id}/cards · PATCH /cards/{id} · DELETE /cards/{id} |
| **Notifications（1）** | GET /notifications |
| **Uploads（1）** | POST /uploads |
| **Reports（1）** | GET /reports/weekly |
| **Webhooks（1）** | POST /webhooks/douyin |

### 测试用例统计

每个端点至少 3-5 个用例：

- ✅ **Happy path**（200/201/204）
- ❌ **Validation error**（400）— 必填字段缺失、格式错误
- ❌ **Authentication error**（401）— 未带 token / token 失效
- ❌ **Business rule violation**（422）— 业务校验失败
- ❌ **Resource conflict**（409）— 重复创建、状态冲突
- ❌ **Rate limiting**（429）— 超限流阈值
- ❌ **Internal error**（500）— 系统异常（带 traceId）

总计 **70+ 个测试用例**。

### Schema 验证

每个成功响应都通过 `ajv` 校验 OpenAPI schema：

```typescript
validateSchema(res.data, getSchema('LoginResponse'));
```

自动失败归类（参考 `test-runner` SKILL.md 第6节）：

- `logic-error` — 业务逻辑错误
- `type-error` — Schema 不匹配
- `missing-dependency` — 环境问题
- `integration-error` — 网络/Mock 问题
- `performance-issue` — 超时

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install --save-dev vitest @vitest/coverage-v8 ajv ajv-formats yamljs jspectral
```

### 2. 准备 Mock Server

测试需要运行中的 API 服务。建议两种方式：

**方式 A：Prism Mock Server（推荐）**

```bash
npx @stoplight/prism-cli mock contracts/openapi.yaml --port 4010
```

**方式 B：真实服务**

```bash
export API_BASE=https://staging-api.example.com/v1
export TEST_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. 运行测试

```bash
# 全部契约测试
npm run test:contract

# 覆盖率
npm run test:contract -- --coverage

# 单个端点
npx vitest run contract.test.ts -t "POST /auth/login"

# 监听模式
npm run test:contract:watch
```

### 4. 验证契约（lint）

```bash
# Spectral lint
npx spectral lint contracts/openapi.yaml --ruleset spectral.yaml
```

### 5. 生成覆盖率报告

```bash
npm run test:contract:report
# 输出：
#   - coverage/index.html（人类可读）
#   - coverage/coverage-final.json（机器可读）
#   - coverage/lcov.info（CI 集成）
#   - docs/contract-coverage.html（端点覆盖详情）
```

## 🔄 工作流：与 test-runner / implement-executor 协作

```
1. api-contract 生成 contracts/openapi.yaml
   ↓
2. test-runner.contract 自动生成 contract.test.ts（本目录示例）
   ↓
3. implement-executor 写代码时：
   - 实现 endpoint → 跑契约测试
   - 修改 schema → 重跑契约测试
   ↓
4. CI 阶段：
   - lint openapi.yaml (Spectral)
   - 跑 contract.test.ts（vitest）
   - 覆盖率 ≥ 95%
   ↓
5. PR Review：
   - review-checklist 校验 CONTRACT-001/002/003/004/005/006/007/008
   - 自动阻止合并（如未通过）
```

## 📊 自检 Checklist

```yaml
contract_quality:
  ✅ 所有 endpoint 都有 operationId
  ✅ 所有 operation 都有 summary
  ✅ 所有 response 都引用标准 Problem schema
  ✅ 所有 protected operation 都定义 security
  ✅ 所有 mutating operation 都使用 Idempotency-Key（推荐）
  ✅ 必填字段在 required 数组
  ✅ 错误码语义清晰（U1xxx/U2xxx/U3xxx/U4xxx）

test_quality:
  ✅ 每个 endpoint 至少 3 个用例（happy + validation + auth）
  ✅ 所有错误响应都验证 traceId 存在
  ✅ 所有 schema 校验都用 ajv 实际匹配
  ✅ 测试用例命名清晰（"should return..."）
  ✅ 无 console.log / debugger
  ✅ 无 mock 残留（每个测试独立）
```

## 🎨 关键设计原则

### 1. **每个 endpoint 必含3+ 用例**

不只测"能跑"，还测"会失败"——验证契约的所有错误分支。

### 2. **错误响应统一 RFC 9457**

所有 4xx/5xx 响应都是 Problem+JSON：

```typescript
validateProblem(res.data);
// 校验：traceId / type / title / status / code / category 必填
```

### 3. **Schema 校验而非字段校验**

不要写 `expect(data.name).toBe('xxx')`——让 ajv 校验整个 schema：

```typescript
// ❌ 脆弱
expect(data.token).toBeDefined();
expect(data.user.id).toMatch(/uuid/);

// ✅ 健壮
validateSchema(res.data, getSchema('LoginResponse'));
```

### 4. **测试客户端复用**

`apiClient` 单例包含 token、traceId、Idempotency-Key 注入——避免重复样板代码。

### 5. **测试数据驱动（可选扩展）**

未来可加入 `fixtures/` 目录存储测试数据：

```
fixtures/
├── login-success.json
├── login-invalid.json
└── timesheet-create.json
```

## 🚨 常见错误与修复

### 错误1：Schema 校验失败

```
Error: Schema validation failed: must have required property 'token'
```

**修复**：检查 `openapi.yaml` 中 `LoginResponse.required` 是否包含 `token`。

### 错误2：traceId 缺失

```
Error: expected data to have property 'traceId'
```

**修复**：服务端每个响应都必须包含 `traceId`（middleware 自动注入）。

### 错误3：401 vs 403 混淆

```
Expected: 401 Unauthorized
Received: 403 Forbidden
```

**修复**：
- `401` = 未认证（缺 token / token 过期）
- `403` = 已认证但权限不足（检查 security 配置）

## 🔗 相关链接

- [Spec Kit](https://github.com/github/spec-kit) — 规范驱动
- [OpenAPI 3.1 规范](https://spec.openapis.org/oas/v3.1.0) — 契约标准
- [RFC 9457 Problem Details](https://datatracker.ietf.org/doc/rfc9457/) — 错误响应标准
- [vitest](https://vitest.dev/) — 测试框架
- [Spectral](https://stoplight.io/open-source/spectral) — OpenAPI lint
- [Ajv](https://ajv.js.org/) — JSON Schema 校验
- [Prism](https://stoplight.io/open-source/prism) — Mock Server

## 📝 版本

- v1.0.0 (2026-08-24) — 初版，覆盖 18 个端点 + 70+ 测试用例
- 由 `project-orchestrator-bundle / test-runner` 自动生成