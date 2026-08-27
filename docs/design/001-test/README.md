# P2-修复-编排推进 - 设计文档

> 生成日期：2026-08-27
> 生成工具：spec-userstory-to-design
> LLM 增强：❌ 未启用（启发式生成）

## 概览

| 指标 | 数量 |
|---|---|
| User Story 数 | 1 |
| 页面数 | 2 |
| API 接口数 | 6（预估） |
| 错误码 | 6+ |

## 文档清单

### 📄 页面流程
- [page-flow.md](./page-flow.md) - 页面流程图（含 Mermaid）
- [page-flow.mmd](./page-flow.mmd) - Mermaid 源文件

### 📄 页面详情
- [P-001TEST-01 - P2-修复-编排推进列表页](./pages/P-001TEST-01.md) - list
- [P-001TEST-02 - P2-修复-编排推进详情页](./pages/P-001TEST-02.md) - detail

### 📄 API 契约
- [openapi.yaml](./openapi.yaml) - OpenAPI 3.1.2 规范

### 📄 辅助文件
- [errors.json](./errors.json) - 错误码目录
- [coverage-report.md](./coverage-report.md) - 覆盖度校验报告

## User Story 列表

| ID | 标题 | 优先级 | 关联页面 |
|---|---|---|---|
| US-01 | US-01 - 完成 P2 修复并验证编排状态机推进（Priority: P1） | P1 | P-001TEST-01, P-001TEST-02 |

## 快速开始

```bash
# 查看页面流程图（用 Mermaid 渲染）
# VS Code: 安装 "Markdown Preview Mermaid Support" 插件

# 校验 OpenAPI 规范
npx spectral lint openapi.yaml

# 渲染 Mermaid 图为 SVG
npx mmdc -i page-flow.mmd -o page-flow.svg
```

---

*本文档由 spec-userstory-to-design 自动生成*
