---
name: api-contract
description: |
 API 契约生成与管理。基于 OpenAPI 3.1.2 + JSON Schema 2020-12。
 支持从 plan.md / page-detail 自动生成，统一 RFC 9457 Problem schema + traceId。
 集成 Stripe / GitHub / Twilio / Shopify 业界最佳实践。
version: 1.0.0
tags:
  - openapi
  - api-design
  - rfc9457
  - problem-details
  - contract-first
entry-points:
  - generate
  - validate
  - merge
  - mock
requires:
  - node: ">=18"
  - spectral-cli: ">=6.0"
  - openapi-typescript: ">=6.0"
binds: []
parent: project-orchestrator
phase: 1.8
position: bootstrap-final
---

# api-contract

> API 契约生成、验证、合并、Mock 生成。基于 OpenAPI 3.1.2。

## 一、能力范围

### 1.1 `/generate` 从 plan.md 生成

```bash
/contract.generate --from=specs/001-feature/plan.md --auth=jwt
# 输出：contracts/openapi.yaml
```

### 1.2 `/generate` 从 Page Detail 生成

```bash
/contract.generate --from=docs/design/001-feature/ --merge
# 输出：contracts/openapi.yaml（已合并 page detail 的 operationId）
```

### 1.3 `/validate` 验证

```bash
/contract.validate --from=contracts/openapi.yaml
# 检查：
#   - Spectral lint
#   - 所有 $ref 解析通过
#   - 错误响应覆盖 4xx/5xx
#   - 必填字段在 required 数组
#   - security 全局 + operation 覆盖
```

### 1.4 `/merge` 合并多源契约

```bash
/contract.merge \
  --from=contracts/openapi-from-plan.yaml \
  --with=contracts/openapi-from-pages.yaml \
  --output=contracts/openapi.yaml
```

### 1.5 `/mock` 生成 Mock Server

```bash
/contract.mock --from=contracts/openapi.yaml --port=4010
# 启动 Prism Mock Server
```

## 二、OpenAPI 3.1.2 完整骨架

```yaml
openapi: 3.1.2

info:
  title: ${API_NAME} API
  version: 1.0.0
  description: |
    由 project-orchestrator 自动生成。
    生成时间: ${TIMESTAMP}
    Skill 版本: api-contract/1.0
  contact:
    name: API Team
    email: api@example.com
  x-generated-by: project-orchestrator/api-contract@1.0

jsonSchemaDialect: https://json-schema.org/draft/2020-12/schema

servers:
  - url: https://api.example.com
    description: 生产
  - url: https://staging-api.example.com
    description: 预发
  - url: http://localhost:8080
    description: 本地

tags:
  - name: ${resource}
    summary: ${resource} 资源
    description: 自动从 page "${pageId}" 推导
    kind: domain

security:
  - BearerAuth: []

paths:
  /${resources}:
    get:
      operationId: list${Resource}
      summary: 列表
      tags: [${resource}]
      x-page-id: ${pageId}
      parameters:
        - $ref: '#/components/parameters/Page'
        - $ref: '#/components/parameters/PageSize'
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/${Resource}' }
                  pagination: { $ref: '#/components/schemas/Pagination' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    post:
      operationId: create${Resource}
      summary: 创建
      tags: [${resource}]
      x-page-id: ${pageId}
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/${Resource}Create' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/${Resource}' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '409': { $ref: '#/components/responses/Conflict' }

  /${resources}/{id}:
    parameters:
      - $ref: '#/components/parameters/Id'
    get:
      operationId: get${Resource}
      tags: [${resource}]
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/${Resource}' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      operationId: delete${Resource}
      tags: [${resource}]
      responses:
        '204': { description: No Content }
        '404': { $ref: '#/components/responses/NotFound' }

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  parameters:
    Id:
      name: id
      in: path
      required: true
      schema: { type: string, format: uuid }
    Page:
      name: page
      in: query
      schema: { type: integer, minimum: 0, default: 0 }
    PageSize:
      name: pageSize
      in: query
      schema: { type: integer, minimum: 1, maximum: 200, default: 20 }

  responses:
    BadRequest:
      description: 请求参数错误
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Unauthorized:
      description: 未认证
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Forbidden:
      description: 无权限
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    NotFound:
      description: 资源不存在
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Conflict:
      description: 资源冲突
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    UnprocessableEntity:
      description: 业务校验失败
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    TooManyRequests:
      description: 限流
      headers:
        Retry-After: { schema: { type: integer } }
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    InternalError:
      description: 服务器内部错误
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }

  schemas:
    Problem:
      type: object
      required: [type, title, status, traceId]
      properties:
        type:     { type: string, format: uri }
        title:    { type: string }
        status:   { type: integer }
        detail:   { type: string }
        instance: { type: string, format: uri }
        code:     { type: string, example: "U1023" }
        category: { type: string, enum: [USER_ERROR, SYSTEM_ERROR, EXTERNAL_ERROR] }
        traceId:  { type: string }
        spanId:   { type: string }
        errors:
          type: array
          items:
            type: object
            properties:
              field:   { type: string }
              code:    { type: string }
              message: { type: string }

    Pagination:
      type: object
      properties:
        page: { type: integer }
        pageSize:  { type: integer }
        total:     { type: integer }
        totalPages:{ type: integer }
        nextCursor:{ type: string, nullable: true }
        prevCursor:{ type: string, nullable: true }

    ${Resource}:
      type: object
      required: [id, createdAt]
      properties:
        id: { type: string, format: uuid, readOnly: true }
        createdAt: { type: string, format: date-time, readOnly: true }
        updatedAt: { type: string, format: date-time, readOnly: true }

webhooks:
  ${resource}Updated:
    post:
      summary: ${resource} 更新事件
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/${Resource}' }
      responses:
        '200': { description: Webhook received }

x-page-sources:
  - pageId: ${pageId}
    fields: 17
    actions: 5

x-required-scopes:
  - ${resources}:read
  - ${resources}:write

x-asyncapi-ref: ./asyncapi.yaml
x-mcp-tools: { enabled: true, serverRef: "./mcp-tools.json" }
```

## 三、安全方案（securitySchemes）

| 类型 | 用途 | 字段 |
|---|---|---|
| `http` + `bearer` + JWT | 自有系统、SPAs | `scheme: bearer`, `bearerFormat: JWT` |
| `http` + `basic` | 内部工具 | `scheme: basic` |
| `apiKey` | 简单集成 | `in: header/cookie/query` |
| `oauth2` | 第三方授权 | `flows: { authorizationCode, clientCredentials }` |
| `openIdConnect` | OIDC / SSO | `openIdConnectUrl` |

## 四、错误码设计（双层模型）

```
HTTP Status Code → 传输层语义
Business Error Code → 业务层语义
Trace ID → 可观测性

业务错误码格式：{大类}{子类}{序号}
- USER_ERROR (U1xxx-U4xxx)
- SYSTEM_ERROR (S1xxx-S4xxx)
- EXTERNAL_ERROR (E1xxx-E3xxx)
```

## 五、业界最佳实践对标

| 维度 | Stripe | GitHub | Twilio | Shopify | 本 Skill |
|---|---|---|---|---|---|
| 资源命名（复数） | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cursor 分页 | ✓ | — | — | — | ✓（双策略） |
| Page 分页 | — | — | ✓ | — | ✓（双策略） |
| Idempotency-Key | ✓ | — | — | — | ✓（可选） |
| 机器可读错误码 | ✓ | ✓ | ✓ | ✓ | ✓ |
| traceId / request_id | ✓ | ✓ | ✓ | ✓ | ✓ |
| RFC 9457 Problem | — | — | — | — | ✓ |
| Webhook | ✓ | ✓ | ✓ | ✓ | ✓ |

## 六、生成 Prompt 模板

```text
你是 OpenAPI 契约生成器。基于输入（plan.md 或 Page Detail），生成 OpenAPI 3.1.2 YAML。

核心规则：
1. 资源命名：复数名词，从 pageId 推导
2. HTTP 方法决策：
   - 数据展示 → GET /resources, GET /resources/{id}
   - 表单创建 → POST /resources
   - 表单编辑全量 → PUT /resources/{id}
   - 局部更新 → PATCH /resources/{id}
   - 删除 → DELETE /resources/{id}
   - 业务动作 → POST /resources/{id}/{action}
3. Schema 推导：
   - text/email/url → string (format)
   - number → number / integer
   - date → string (format: date)
   - select/radio → enum
   - checkbox → boolean
   - file → string (format: binary), multipart/form-data
4. 错误响应：每个 operation 必含 400/401/403/404/422/500，统一引用 Problem schema
5. 双向锚点：每个 operation 必含 x-page-id 和 x-button-id 扩展
6. i18n：description 用 zh-CN + en 双语

校验清单：
- 所有 $ref 解析通过
- 错误响应覆盖 4xx/5xx
- 必填字段在 required 数组
- 每个 operation 有 operationId（camelCase）
- 包含 traceId、Problem+JSON schema
```

## 七、Spectral 校验规则

```yaml
# .spectral.yaml
extends: spectral:oas
rules:
  operation-operationId: error
  operation-description: warn
  oas3-api-servers: error
  oas3-operations-tags: error
  oas3-schema-default-nullable: error
  contact-properties: off

  # 自定义规则
  operation-must-have-x-page-id: error
  operation-must-have-x-button-id: warn
  schema-must-have-trace-id: warn
  responses-must-include-problem: error
```

## 八、Mock 与客户端生成

```bash
# 启动 Mock Server
npx @stoplight/prism-cli mock contracts/openapi.yaml --port 4010

# 生成 TypeScript 客户端
npx openapi-typescript contracts/openapi.yaml -o src/api/schema.ts

# 生成 React Query hooks
npx orval --input contracts/openapi.yaml --output src/api/hooks

# 生成 Python 客户端
npx openapi-generator-cli generate -i contracts/openapi.yaml -g python -o clients/python
```

## 九、与上下游的契约

```
输入：
- specs/001-feature/plan.md（来自 spec-bootstrap）
- docs/design/001-feature/pages/*.md（来自 spec-userstory-to-design）

输出：
- contracts/openapi.yaml（最终契约，作为单一真相）

下游：
- 后端：实现 contracts/openapi.yaml 中的 endpoints
- 前端：使用 contracts/openapi.yaml 生成客户端
- 测试：使用 contracts/openapi.yaml 验证契约
```

## 十、失败回退

| 失败点 | 恢复动作 |
|---|---|
| Spectral lint 失败 | 列出错误项 → 自动修复或人工介入 |
| 双向锚点缺失 | 警告 + 列出 operation |
| Problem schema 未引用 | 警告 + 自动补全 |
| 合并冲突 | 启动三方合并（保留两端） |

## 十一、依赖

- OpenAPI 3.1+
- Spectral CLI
- OpenAPI TypeScript / Orval
- Prism CLI（Mock）

## 十二、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `spec-bootstrap`, `spec-userstory-to-design`
- 下游: 前后端实现、契约测试

## 十三、许可

MIT