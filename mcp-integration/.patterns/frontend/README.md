# 前端特有模式

本目录包含 5 种前端特有设计模式。

## 模式列表

| 模式 | 说明 |
|------|------|
| [HOC (高阶组件)](./hoc.md) | 高阶组件是参数为组件，返回值为新组件的函数。HOC 是 React 生态系统中常见的模式，用于复用组... |
| [Custom Hook (自定义 Hook)](./customHook.md) | 自定义 Hook 是一个函数，其名称以 "use" 开头，函数内部可以调用其他的 Hook。它让你能... |
| [Render Props (渲染属性)](./renderProps.md) | Render Props 是指一种在 React 组件之间使用一个值为函数的 prop 共享代码的简... |
| [Compound Components (复合组件)](./compoundComponents.md) | 复合组件是一种将多个组件组合在一起工作，共同完成一个完整功能的模式。它们通过共享隐式状态来实现组件间... |
| [Provider Pattern (提供者模式)](./provider.md) | Provider 模式通过 Context API 将状态和方法传递给需要它们的子组件，避免了 pr... |

## 使用说明

每个模式文件包含：
- 模式的详细说明
- 适用场景
- 优缺点分析
- 多框架代码示例（TypeScript、React、Vue 3、Node.js）
