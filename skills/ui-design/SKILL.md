---
name: ui-design
description: |
 单文件 HTML 原型生成 + 聊天交互调整。
 支持意图识别（7 类）+ AST 定位（parse5 + csstree + recast）+ 设计令牌（DTCG 2025.10）。
 产出自包含 HTML（零外部 CDN），支持 "把 X 改成 Y" 风格的聊天微调。
version: 1.0.0
tags:
  - ui-design
  - design-tokens
  - dtcg
  - tailwind
  - chat-driven-development
entry-points:
  - generate
  - adjust
  - audit
requires:
  - node: ">=18"
  - parse5: ">=8.0.0"
  - csstree: ">=3.2.0"
  - recast: ">=0.23.0"
binds: []
parent: project-orchestrator
phase: 1.6
position: bootstrap-after-scaffold
---

# ui-design

> 单文件 HTML 原型 + 聊天交互调整。AI Agent 协作场景下的 UI 设计工具。

## 一、能力范围

### 1.1 `/generate` 生成原型

从 spec.md 中的 User Story 生成自包含单文件 HTML 原型。

```bash
/ui-design.generate --from=spec.md --pages="登录,看板,周报"
# 输出：
#   prototype/index.html         ← 单文件 HTML
#   prototype/_shared/tokens.css ← 设计令牌（可选）
#   prototype/_shared/components.css ← 通用组件样式（可选）
```

### 1.2 `/adjust` 聊天式调整

启动聊天模式，支持 "把 X 改成 Y" 风格的微调。

```bash
/ui-design.adjust
# 进入交互模式
```

用户: `把首页的卡片从 3 列改成 2 列，配色换成莫兰迪`

Skill 内部流程:
```
① Intent Classifier    → {intents: [layout.adjust, theme.change]}
② Clarifier（如需）     → 歧义 < 0.8 才触发
③ Code Locator         → AST + Embedding + Reranker 三路召回
④ Edit Planner         → unified diff 草案
⑤ Edit Applier         → parse5 + csstree + recast
⑥ Visual Verifier      → Playwright 截图 + happy-dom getComputedStyle
⑦ Commit / PR          → git diff + Apply/Revert/Adjust
```

### 1.3 `/audit` 设计健康度审计

检查项目设计令牌覆盖率、组件复用率、设计系统一致性。

```bash
/ui-design.audit
# 输出：
#   - 设计令牌覆盖率: 78% (32/41 组件使用 var(--color-primary))
#   - 硬编码色值: 13 处（应替换为 token）
#   - 不一致用法: .bg-blue-500 出现 23 次 vs .bg-primary 出现 5 次
```

## 二、意图分类（7 大类）

| Intent ID | 含义 | Pipeline |
|---|---|---|
| `theme.change` | 主题/配色/风格切换 | 改 tokens 文件 |
| `layout.adjust` | 布局调整（列数/对齐/主轴） | 改 className |
| `spacing.adjust` | 间距/圆角调整 | 改 CSS 变量/Tailwind 类 |
| `typography.adjust` | 字号/字重/字族调整 | 改 className |
| `element.create` | 新增组件/区块 | LLM 生成 + AST 插入 |
| `element.delete` | 删除组件/区块 | AST 删除节点 |
| `content.update` | 文案/图片/数据修改 | 文本/属性替换 |

## 三、10 套预置主题（DTCG 2025.10 格式）

| Theme | Primary | Background | 特点 |
|---|---|---|---|
| morandi | `#9CAF88` | `#F2EFE4` | 莫兰迪色系，低饱和灰调 |
| macaron | `#F16D7A` | `#FFF8F3` | 马卡龙，柔和粉嫩 |
| memphis | `#FF5FA2` | `#FFF8E7` | 孟菲斯，高对比几何 |
| minimal | `#000000` | `#FFFFFF` | 极简，黑白+一种强调 |
| neon | `#39FF14` | `#0A0A14` | 霓虹，深底荧光 |
| cyberpunk | `#FF006E` | `#080810` | 赛博朋克，紫黑霓虹 |
| warm | `#FF8000` | `#FFF8F0` | 暖色系 |
| cool | `#1F4BB8` | `#F0F8FF` | 冷色系 |
| japanese | `#90A28D` | `#F4F2EE` | 日系 MUJI |
| guochao | `#FF4C00`（朱红） | `#F3F9F1`（茶白） | 国潮，中国传统色 |

### 3.1 主题 token JSON 示例（morandi）

```json
{
  "color": {
    "morandi": {
      "primary":            { "$type: "color", "$value": "#9CAF88" },
      "primary-foreground": { "$type: "color", "$value": "#3B4A35" },
      "secondary":          { "$type: "color", "$value": "#6E7F9C" },
      "accent":             { "$type: "color", "$value": "#D4B0B5" },
      "bg-default":         { "$type: "color", "$value": "#F2EFE4" },
      "bg-elevated":        { "$type: "color", "$value": "#FFFFFF" },
      "fg-default":         { "$type: "color", "$value": "#42433C" },
      "border":             { "$type: "color", "$value": "#D1C7B7" }
    }
  }
}
```

### 3.2 与 Tailwind v4 @theme 桥接

```css
@import "tailwindcss";
@theme {
  --color-primary: var(--color-primary);
  --color-bg: var(--color-bg-default);
  --color-fg: var(--color-fg-default);
  --radius-md: 0.5rem;
}

[data-theme="morandi"] {
  --color-primary: #9CAF88;
  --color-bg-default: #F2EFE4;
  --color-fg-default: #42433C;
}
```

## 四、技术栈

| 层 | 工具 |
|---|---|
| HTML 解析 | parse5 v8+（AST 是纯 JSON，LLM 友好） |
| CSS 解析 | csstree v3.2+（AST 拆到叶子） |
| JS/JSX 解析 | recast v0.23+（保留源码格式） |
| Embedding 检索 | bge-small + BM25 |
| Reranker | bge-reranker-v2-m3 或 LLM |
| 设计令牌 | DTCG 2025.10 + Style Dictionary v4 |
| 主题切换 | `data-theme` 属性 + OKLCH |
| 预览验证 | Playwright + happy-dom |

## 五、聊天交互调整的 Prompt 解析器

### 5.1 意图分类 Prompt（严格 JSON 输出）

```markdown
你是 UI 调整意图分类器。把用户的自然语言指令转化为结构化 JSON。

意图标签（7 类，严格枚举）：
- theme.change / layout.adjust / spacing.adjust / typography.adjust
- element.create / element.delete / content.update

输出格式（严格 JSON，禁止自然语言）：
{
  "intents": [
    {
      "intent": "<intent_id>",
      "target": "<选择器或组件名>",
      "params": { ... },
      "confidence": <0-1>,
      "needs_clarification": [<可选的歧义点>]
    }
  ]
}
```

### 5.2 澄清触发条件

仅在以下情况触发：
1. Intent 识别 confidence < 0.8
2. params 中有 needs_clarification 字段
3. Code Locator 返回多个高置信度候选

### 5.3 典型澄清问题

| 用户原话 | 澄清问题 |
|---|---|
| "配色换成莫兰迪" | "选择哪种莫兰迪？A. 偏暖 B. 偏冷 C. 经典中性" |
| "字号大一点" | "字号增大多少？A. +25% B. +50% C. +100%" |
| "间距缩小" | "应用到？A. 全局 B. 仅首页 C. 仅卡片内边距" |
| "漂亮点" | "具体改什么？A. 配色 B. 圆角 C. 阴影 D. 全部" |

## 六、代码定位（AST 三路召回）

```
① AST 精确匹配 (parse5 + csstree)
   - 在 index.html 中找 class="card-grid"
   - 在 styles.css 中找 .card-grid 选择器
② Embedding 语义召回 (bge-small)
   - "card grid" → 检索 top-5 候选文件
③ Graph 跨文件追踪 (LocAgent 风格，可选)
   - 节点：file/class/component
   - 边：import/invoke/inherit
④ Reranker (bge-reranker / LLM)
   - 输出 file:line + AST 节点路径
```

## 七、修改应用（保留源码格式）

```typescript
import * as parse5 from 'parse5';
import * as csstree from 'css-tree';
import * as recast from 'recast';

// HTML 修改：parse5 + 源位置切片
function applyHtmlDiff(source, operations) {
  let doc = parse5.parse(source);
  for (const op of operations) {
    if (op.type === 'replace_class') {
      const element = querySelector(doc, op.target);
      if (element) {
        const classAttr = element.attrs.find(a => a.name === 'class');
        if (classAttr) classAttr.value = op.newValue;
      }
    }
  }
  return parse5.serialize(doc);
}

// CSS 修改：csstree
function applyCssDiff(source, operations) {
  const ast = csstree.parse(source);
  for (const op of operations) {
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration' && node.property === op.target) {
        node.value = csstree.parse(op.newValue, { context: 'value' });
      }
    });
  }
  return csstree.generate(ast);
}

// JSX 修改：recast（保留其他代码原样）
function applyJsxDiff(source, operations) {
  const ast = recast.parse(source);
  recast.visit(ast, {
    visitJSXAttribute(path) {
      if (path.node.name.name === 'className') {
        // 应用 operations
      }
    }
  });
  return recast.print(ast).code;
}
```

## 八、视觉验证

```typescript
interface VerificationReport {
  syntaxValid: boolean;
  computedStyleValid: boolean;
  visualDiffRatio: number;
  brokenReferences: string[];
  warnings: string[];
  recommendation: 'apply' | 'review' | 'revert';
}
```

## 九、安全约束

| 约束 | 实现 |
|---|---|
| 禁止直接编辑 _shared/ 外的 HTML | Skill 内部强制所有修改走 AST |
| 配色/主题指令只改 token 文件 | 强制改 tokens/*.css，不改组件代码 |
| 每次修改前必须预览 | Playwright before/after 双图 |
| 保留源码格式 | recast .original 机制 |
| git diff + 一键 revert | 每个修改都有 rollbackPlan |

## 十、失败回退

| 失败点 | 恢复动作 |
|---|---|
| 改错位置（撤销率 > 30%） | 强制预览门 + 意图解释必读 |
| 破坏组件库设计系统 | 组件库白名单 + Token 优先 |
| 澄清循环（>3 轮） | 强制采用 LLM 推荐方案 |
| Token 改了但没生效 | 强制 grep 验证引用链路 |
| AST 解析失败 | 回退到字符串替换 + 警告 |

## 十一、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `spec-bootstrap`
- 下游: `spec-userstory-to-design`, `html-converter`
- 相关: DTCG 标准, Tailwind v4 @theme

## 十二、许可

MIT