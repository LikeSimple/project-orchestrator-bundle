---
name: html-converter
description: |
 把 ui-design 输出的单文件 HTML 原型转换为 Vue 3 SFC 或 React TSX 组件代码。
 复用 Tailwind 类、设计令牌；自动拆分为子组件；支持 TypeScript 类型生成。
 集成 html-react-parser（React 事实标准）+ LLM 后处理。
version: 1.0.0
tags:
  - html-to-react
  - html-to-vue
  - component-generation
  - tailwind
  - typescript
entry-points:
  - convert
  - split
  - types
requires:
  - node: ">=18"
  - html-react-parser: ">=5.0"
binds: []
parent: project-orchestrator
phase: 1.9
position: bootstrap-after-design
---

# html-converter

> HTML 原型 → Vue/React 组件代码。填补 Vue 生态的市场空白（React 有 html-react-parser，Vue 没有等价物）。

## 一、能力范围

### 1.1 `/convert` 主命令

```bash
/html-converter.convert \
  --from=prototype/index.html \
  --target=react      # 或 vue3 \
  --out=src/components \
  --typescript
# 输出：
#   src/components/FeaturePage.tsx（或 .vue）
#   src/components/FeaturePage/SubComponent1.tsx
#   src/components/FeaturePage/SubComponent2.tsx
#   src/types/feature.ts（TypeScript 类型）
```

### 1.2 `/split` 仅拆分组件

```bash
/html-converter.split --from=prototype/index.html --target=react
# 只识别重复结构 → 拆为子组件，不生成完整代码
```

### 1.3 `/types` 仅生成 TypeScript 类型

```bash
/html-converter.types --from=prototype/index.html
# 从 HTML 中识别表单字段、展示字段 → 生成 interface
```

## 二、核心算法

### 2.1 React 路径（基于 html-react-parser）

```typescript
import parse, { domToReact, attributesToProps } from 'html-react-parser';

const html = `
  <div class="flex items-center gap-4 p-6 bg-white rounded-xl shadow-md">
    <img src="/avatar.jpg" class="w-12 h-12 rounded-full" />
    <div>
      <h3 class="text-lg font-semibold text-gray-900">张三</h3>
      <p class="text-sm text-gray-500">产品经理</p>
    </div>
  </div>
`;

// 方案 A：直接渲染（class 原样保留）
function ProfileCard() {
  return <div>{parse(html)}</div>;
}

// 方案 B：用 replace 钩子将 <img> 替换为 Next.js Image
function ProfileCard() {
  const options = {
    replace(domNode) {
      if (domNode.name === 'img' && domNode.attribs) {
        const props = attributesToProps(domNode.attribs);
        return <Image {...props} alt={domNode.attribs.alt || ''} />;
      }
    }
  };
  return <div>{parse(html, options)}</div>;
}
```

### 2.2 Vue 3 路径（基于自研 + LLM 后处理）

```typescript
import * as cheerio from 'cheerio';
import * as llm from './llm-client';

// Vue 生态没有 html-react-parser 等价物，需要 LLM 智能处理
async function htmlToVue(html: string, options: ConvertOptions) {
  // 1. 本地预处理：parse5 清洗、补全语义标签
  const cleaned = preprocessHtml(html);

  // 2. 局部走 cheerio 提取结构
  const ast = parse5.parse(cleaned);
  const structure = extractStructure(ast);

  // 3. LLM 调用：智能拆组件 + 类型 + Vue 输出
  const result = await llm.generate({
    system: `你是 Vue 3 专家，根据 HTML 输出 .vue SFC。
             - 识别重复结构拆为子组件
             - 自动加 TypeScript interface
             - 保持所有 Tailwind 类不变
             - 优先用语义化 token（bg-primary 而非 bg-blue-500）`,
    input: { html: cleaned, structure },
    responseFormat: 'vue-sfc'
  });

  // 4. 后处理：ESLint、Prettier、写文件
  return formatAndSave(result, options.targetDir);
}
```

## 三、自动拆组件规则

| 检测到 | 拆为 |
|---|---|
| 重复结构 ≥ 3 次 | 子组件 + `v-for` 循环 |
| 独立 UI 模块（如卡片、模态框） | 子组件 |
| 表单字段组 | 独立表单组件 |
| 复杂状态逻辑（按钮状态机） | 独立状态组件（Composable / Hook） |

### 3.1 拆分算法 Prompt

```text
你是 React/Vue 组件拆分专家。基于以下 HTML 结构：

1. 识别重复模式（出现 ≥3 次的结构）
2. 识别可独立 UI 模块
3. 识别表单字段组
4. 识别需要独立状态管理的复杂组件

输出拆分方案 JSON：
{
  "components": [
    {
      "name": "UserCard",
      "type": "stateless",
      "props": ["user: User"],
      "source": "<div class='card'>...</div>"
    },
    {
      "name": "UserList",
      "type": "container",
      "props": ["users: User[]"],
      "children": ["UserCard"]
    }
  ]
}
```

## 四、TypeScript 类型生成

```typescript
// 自动从表单字段、显示字段生成 interface
interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'viewer';
  tags: string[];
  avatar?: string;
  bio?: string;
  createdAt: string; // ISO date
  status: 'active' | 'inactive';
}
```

### 4.1 字段类型推断规则

| HTML 类型 | TypeScript 类型 |
|---|---|
| `<input type="text">` | `string` |
| `<input type="email">` | `string`（含 email 验证） |
| `<input type="number">` | `number` |
| `<input type="date">` | `string`（ISO date） |
| `<input type="checkbox">` | `boolean` |
| `<select>` | enum |
| `<textarea>` | `string` |
| `<input type="file">` | `File \| null` |

## 五、设计令牌保留

转换时优先使用语义化令牌：

```tsx
// ❌ 转换前（硬编码）
<button className="bg-blue-500 hover:bg-blue-700">

// ✅ 转换后（语义化令牌）
<button className="bg-primary hover:bg-primary-hover">
```

### 5.1 令牌映射表

| 硬编码类 | 语义令牌 |
|---|---|
| `bg-blue-500` | `bg-primary` |
| `text-gray-900` | `text-fg-default` |
| `border-gray-200` | `border-default` |
| `p-6` | `p-spacing-lg` |
| `rounded-md` | `rounded-md`（保留） |

## 六、命令清单

### 6.1 React + TypeScript + Tailwind

```bash
/html-converter.convert \
  --from=prototype/index.html \
  --target=react \
  --typescript \
  --tailwind \
  --out=src/components/FeaturePage
```

### 6.2 Vue 3 + TypeScript + Tailwind + shadcn-vue

```bash
/html-converter.convert \
  --from=prototype/index.html \
  --target=vue3 \
  --typescript \
  --tailwind \
  --component-lib=shadcn-vue \
  --out=src/components/FeaturePage.vue
```

### 6.3 仅生成类型

```bash
/html-converter.types \
  --from=prototype/index.html \
  --out=src/types/feature.ts
```

## 七、与 ui-design 的衔接

```
ui-design 产出 prototype/index.html
                │
                ▼
html-converter 读取 HTML
                │
                ▼
保留所有 Tailwind 类 + design token
                │
                ▼
智能拆分为子组件
                │
                ▼
生成 .tsx / .vue + .ts 类型
                │
                ▼
写入 src/components/
```

## 八、限制与边界

| 能做 | 不能做 |
|---|---|
| 保留 HTML 结构和 class | 自动理解复杂 JS 交互 |
| 拆分重复结构 | 自动决定状态管理方案 |
| 生成 TypeScript 类型 | 自动写业务逻辑 |
| 替换 `<img>` 为 `<Image>`（Next.js） | 自动实现数据获取 |
| 集成设计令牌 | 自动配置路由 |

## 九、失败回退

| 失败点 | 恢复动作 |
|---|---|
| HTML 解析失败 | 提示用户检查 HTML 格式 |
| 重复结构识别不准 | 列出识别结果，让用户确认 |
| 类型推断错误 | 提示用户手动调整 |
| 组件库映射失败 | 回退到纯 className 输出 |

## 十、依赖

- html-react-parser v5+
- cheerio v1+
- parse5 v8+
- Vue 3 / React 18+
- TypeScript 5+

## 十一、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `ui-design`（提供 HTML 原型）
- 下游: 前端开发继续迭代

## 十二、许可

MIT