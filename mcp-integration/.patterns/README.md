# 设计模式库

共包含 22 种设计模式，支持 TypeScript、React、Vue 3、Node.js 四种框架。

## 分类

- [创建型 (5种)](./creational/) - 处理对象创建机制
- [结构型 (5种)](./structural/) - 处理类和对象的组合
- [行为型 (7种)](./behavioral/) - 处理对象之间的通信
- [前端特有 (5种)](./frontend/) - 前端开发常用模式

## 支持框架

- TypeScript - 原生 TypeScript 实现
- React - React Function Component + Hooks
- Vue 3 - Vue 3 Composition API
- Node.js - Node.js / 纯 JavaScript

## 命令

```bash
# 列出所有模式
code-patterns list

# 查看模式详情
code-patterns explain <pattern-id>

# 生成模式代码
code-patterns generate <pattern-id> --framework react

# 初始化模式目录
code-patterns init
```
