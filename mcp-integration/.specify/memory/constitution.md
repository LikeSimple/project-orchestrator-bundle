# Test Constitution

> 由 project-orchestrator-bundle / spec-bootstrap 自动生成
> 生成时间：2026-08-25

## Core Principles

### 1. Library-First
每个能力优先作为独立库实现，便于复用与测试。

### 2. Test-Driven Development
先写测试，再写实现。覆盖率 ≥ 80%。

### 3. API-First Design
所有接口优先以 OpenAPI 3.1.2 形式定义，前后端并行开发。

### 4. Contract Consistency
服务端实现必须严格匹配 OpenAPI 契约，CI 自动校验。

### 5. Observable by Default
所有外部交互必须有日志 + traceId + metrics。

## Quality Gates

- ✅ 测试覆盖率 ≥ 80%
- ✅ ESLint 0 错
- ✅ TypeScript 0 类型错
- ✅ 契约测试 100% 通过
- ✅ 1 个 reviewer approve

## Tech Stack（待填充）

- 前端：[未指定]
- 后端：[未指定]
- 数据库：[未指定]
- 部署：[未指定]

## Governance

本文档为项目宪法，修改需全团队 Review。

**Version**: 1.0
**Ratified**: 2026-08-25
**Last Amended**: 2026-08-25
