# Skill 正则解析代码分析与 AST 迁移评估报告

## 概述

本报告分析了 `project-orchestrator-bundle/mcp-integration/examples/skills` 目录下全部 15 个 Skill 的源码，识别哪些使用正则表达式解析 HTML/CSS/JS/TS 代码，并评估迁移到 `ast-parser.js`（基于 parse5 / css-tree / recast + @babel/parser）的可行性。

---

## 已迁移（2 个）

### 1. html-converter

| 项目 | 内容 |
|------|------|
| **主要功能** | HTML 与 React/Vue 组件互转、组件提取、重复结构检测、表单字段提取 |
| **是否使用正则解析代码** | 否（已迁移至 AST） |
| **解析的目标** | HTML |
| **迁移状态** | 已完成 |
| **使用的 ast-parser.js API** | `parseHTML()`、`serializeHTML()`、`walkNode()`、`findElementsByTagName()`、`getAttr()`、`setAttr()`、`extractAllClasses()`、`extractFormFields()`、`detectRepeatingStructures()`、`convertToReactHTML()`、`convertToVueHTML()`、`extractBodyHTML()` |

---

### 2. ui-design

| 项目 | 内容 |
|------|------|
| **主要功能** | UI 设计令牌提取、颜色/字体/间距分析、设计规范校验、组件样式审查 |
| **是否使用正则解析代码** | 否（已迁移至 AST） |
| **解析的目标** | HTML + CSS |
| **迁移状态** | 已完成 |
| **使用的 ast-parser.js API** | `parseHTML()`、`parseCSS()`、`extractDesignTokens()`、`extractAllCSS()`、`extractAllColors()`、`findElementsByClass()`、`walkNode()` |

---

## 高优先级迁移（1 个）

### 3. review-checklist ⭐ 最高优先级

| 项目 | 内容 |
|------|------|
| **主要功能** | 代码审查检查清单：PR/diff 静态分析，覆盖业务正确性、契约一致性、安全性、性能、可维护性、测试、代码规范 7 大类共 60+ 条规则 |
| **是否使用正则解析代码** | **是（大量）** |
| **解析的目标** | JS/TS（diff 文本中的代码模式匹配） |
| **迁移到 AST 的可行性** | **高** |
| **推荐使用的 ast-parser.js API** | `parseJS()`、基于 recast 的自定义 AST 访问器 |

#### 关键正则代码解析模式（部分）：

```javascript
// BIZ-004: 空 catch 块检测
const emptyCatch = (diff.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || []).length;

// BIZ-003: TODO/FIXME 注释检测
const todoCount = (diff.match(/\+\s*(\/\/|#)\s*(TODO|FIXME|HACK)/g) || []).length;

// SEC-001: 硬编码密钥检测
const secretPatterns = [
  /(api[_-]?key|secret|password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{10,}['"]/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /sk-[a-zA-Z0-9]{20,}/,
  // ...
];

// SEC-002: SQL 注入检测
const sqlInjectionPatterns = [
  /["']\s*\+\s*\w+\s*\+\s*["'][^"]*(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|WHERE)/i,
  /`.*\$\{.*\}.*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i,
  // ...
];

// SEC-004: eval / Function 构造器检测
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(diff)) { ... }

// SEC-003: XSS 风险检测
if (/dangerouslySetInnerHTML|innerHTML\s*=|document\.write\(/.test(diff)) { ... }

// 函数提取（基于行的正则解析）
function extractFunctions(content) {
  const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
  const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
  // 基于花括号计数的函数边界检测
}
```

#### 迁移价值说明：
- **准确性提升**：当前基于 diff 文本的正则匹配容易产生误报（如注释中的代码、字符串中的关键字），AST 解析可以准确识别语法结构
- **规则深度**：AST 可以实现更复杂的语义分析（如调用链追踪、类型推断、作用域分析）
- **可维护性**：AST 规则比复杂正则更容易理解和维护
- **规则数量**：60+ 条规则中约 40% 直接涉及 JS/TS 代码结构分析

#### 建议迁移的规则子集（第一阶段）：
1. `extractFunctions()` → 用 AST 遍历 `FunctionDeclaration` / `ArrowFunctionExpression`
2. 空 catch 块检测 → 遍历 `CatchClause` 检查 body 是否为空
3. eval/new Function 检测 → 查找 `CallExpression(callee.name='eval')` / `NewExpression(callee.name='Function')`
4. XSS 风险检测 → 查找 `MemberExpression(object, property='innerHTML')` 赋值
5. 同步 I/O 检测 → 查找 `CallExpression` 匹配 `fs.readFileSync` 等

---

## 中优先级迁移（1 个）

### 4. code-patterns

| 项目 | 内容 |
|------|------|
| **主要功能** | 代码模式库（设计模式/架构模式/UI 模式共 50+）、模式检测、LLM 辅助重构、框架识别 |
| **是否使用正则解析代码** | 是（少量） |
| **解析的目标** | JS/TS（框架检测 + 代码块清理） |
| **迁移到 AST 的可行性** | **中** |
| **推荐使用的 ast-parser.js API** | `parseJS()`、`validateTSInterface()`、`extractInterfaceNames()` |

#### 当前正则使用情况：
```javascript
// 框架检测（基于文件扩展名）
function detectFramework(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.tsx' || basename.includes('react')) return 'react';
  if (ext === '.vue' || basename.includes('vue')) return 'vue';
  // ...
}

// LLM 输出清理（去除 markdown 代码围栏）
refactoredCode = refactoredCode.replace(/^```[\w]*\n/, '').replace(/\n```$/, '');

// 模式示例中包含大量正则字符串（示例代码，非运行时解析）
```

#### 迁移价值说明：
- 当前正则使用量不大，主要在 `detectFramework()` 和代码块清理
- 但 Skill 内置了 50+ 种代码模式，如果增加"模式自动检测"功能，AST 将是核心基础设施
- 可利用 AST 实现：代码异味检测、模式匹配、重构建议自动生成
- `validateTSInterface()` 和 `extractInterfaceNames()` 可直接用于 TypeScript 模式验证

---

## 低优先级迁移（11 个）

### 5. scaffold-runner

| 项目 | 内容 |
|------|------|
| **主要功能** | 项目脚手架生成器：模板引擎（{{#if}}/{{#each}}/{{variable}}）、参数校验、多框架模板（React/Vue/Node.js 等） |
| **是否使用正则解析代码** | 是（但解析自定义模板语法，非 HTML/CSS/JS 结构） |
| **解析的目标** | 自定义模板语言（Handlebars-like） |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不直接适用；可考虑 `parseHTML()` 用于渲染后 HTML 校验 |

#### 说明：
正则用于解析 `{{#if}}`、`{{#each}}`、`{{variable}}` 等模板语法，这是一种自定义的轻量级模板语言，不是 HTML/CSS/JS 的结构解析。迁移到 AST 的价值有限，因为：
1. 模板语法简单，当前正则实现已足够稳定
2. 模板内容是多语言混合（JSON/HTML/JS/TS），单一 AST 解析器不适用
3. 如要升级，更适合引入成熟模板引擎（Handlebars/Mustache）而非 AST

---

### 6. api-contract

| 项目 | 内容 |
|------|------|
| **主要功能** | 从 plan.md 生成 OpenAPI 3.1.2 YAML 契约、契约校验、文档增强、变更 diff |
| **是否使用正则解析代码** | 是（解析 YAML/Markdown，非代码结构） |
| **解析的目标** | YAML / Markdown / URL 路径 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 从 plan.md 提取 API 路径（`/\/(api|v\d+)\/[\w\-\/{}]+/g`）
- 解析 markdown 代码围栏（```` ```yaml ````）
- 统计 endpoint 数量（匹配 `get|post|put|delete` 等 YAML 键）
- OpenAPI 结构校验（检查 `info:`、`paths:`、`components:` 等是否存在）

这些都是 YAML/Markdown 文本处理，不是 HTML/CSS/JS/TS 代码结构解析，不适合迁移到 ast-parser.js。

---

### 7. test-runner

| 项目 | 内容 |
|------|------|
| **主要功能** | 多框架测试执行（vitest/jest/mocha/cypress/playwright/pytest 等）、覆盖率报告、契约测试、测试文件扫描 |
| **是否使用正则解析代码** | 是（文件路径匹配，非代码结构） |
| **解析的目标** | 文件路径 / 测试输出文本 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 测试文件命名模式匹配（`/\.test\.(ts|tsx|js|jsx)$/` 等）
- 测试目录模式匹配（`/__tests__$/` 等）
- 测试报告 JSON 解析（使用 JSON.parse，非正则）

路径匹配用正则是合理的，不需要 AST。

---

### 8. debug-helper

| 项目 | 内容 |
|------|------|
| **主要功能** | 错误分析（stack trace 解析 + 根因定位 + 修复建议）、git bisect 自动定位 bug、日志分析 |
| **是否使用正则解析代码** | 是（错误消息分类，非代码结构） |
| **解析的目标** | 错误消息 / 堆栈跟踪文本 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 错误分类（SyntaxError / TypeError / AssertionError 等）
- 从错误消息中提取属性名（`Cannot read propert(?:y|ies) ['"]?(\w+)['"]?`）
- 日志文件中过滤 ERROR 行

这些是文本分类和信息提取，不是代码结构解析。

---

### 9. implement-executor

| 项目 | 内容 |
|------|------|
| **主要功能** | Agent 驱动的代码实现执行器：解析 tasks.md、读取上下文、LLM 生成代码、跑测试、标记完成 |
| **是否使用正则解析代码** | 是（解析 Markdown 任务列表，非代码结构） |
| **解析的目标** | Markdown 任务格式 / 文件路径 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 解析 tasks.md 中的任务行（`/-\s*\[([ xX])\]\s*(T\d+)\s*(\[P\])?\s*(\[US\d+\])?\s*(.+?)(?:\s+([\w\-\/\.]+\.\w+))?$/gm`）
- 从任务描述中提取文件路径
- 解析 Phase 标题（`## Phase N: 名称`）

这些是 Markdown 文本解析，不涉及代码结构。

---

### 10. dependency-auditor

| 项目 | 内容 |
|------|------|
| **主要功能** | 依赖审计：漏洞扫描（npm audit）、License 合规、过期依赖检测、维护活跃度分析 |
| **是否使用正则解析代码** | 否（极少） |
| **解析的目标** | package.json（JSON.parse） / npm 命令输出 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
主要通过执行 npm 命令和读取 JSON 文件获取依赖信息，正则使用极少（可能用于 License 名称匹配）。

---

### 11. environment-manager

| 项目 | 内容 |
|------|------|
| **主要功能** | 4 环境管理（dev/test/staging/prod）、Secrets 注入、环境变量校验、diff 对比 |
| **是否使用正则解析代码** | 是（环境变量名模式匹配，非代码结构） |
| **解析的目标** | 环境变量名 / 配置值 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 敏感字段检测（`/PASSWORD$/i`、`/SECRET$/i` 等 20+ 种模式）
- 占位符检测（`<CHANGE_ME>`、`<PLACEHOLDER>` 等）
- 类型推断（`/PORT$/` → number, `/^ENABLE/` → boolean, `/URL$/` → url 等）

这些是配置验证，不是代码结构解析。

---

### 12. git-workflow

| 项目 | 内容 |
|------|------|
| **主要功能** | 智能 commit（Conventional Commits + changelog）、PR 创建、版本发布、冲突解析 |
| **是否使用正则解析代码** | 是（commit message / diff 元数据，非代码结构） |
| **解析的目标** | Git commit 消息 / 冲突标记 / 版本号 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 解析 Conventional Commits 格式（`type(scope): subject`）
- 解析 git 冲突标记（`<<<<<<<`、`=======`、`>>>>>>>`）
- 版本号匹配（semver 格式）

这些是 git 相关的文本处理，不涉及代码结构解析。

---

### 13. openspec-workflow

| 项目 | 内容 |
|------|------|
| **主要功能** | OpenSpec 提案驱动变更管理：propose → delta → tasks → apply → archive |
| **是否使用正则解析代码** | 是（文本关键词提取，非代码结构） |
| **解析的目标** | 中文/英文提案文本 / Markdown |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 从提案中提取关键词（`/新增\s*[「""]?([^「""\n，。、]{2,20})/g` 等）
- slugify 字符串处理

这些是自然语言文本处理，与代码解析无关。

---

### 14. spec-bootstrap

| 项目 | 内容 |
|------|------|
| **主要功能** | Spec Kit 8 命令：constitution/specify/clarify/plan/tasks/checklist/analyze/implement |
| **是否使用正则解析代码** | 是（模板变量替换，非代码结构） |
| **解析的目标** | Markdown 模板 / 文档结构 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
主要是模板生成和文档处理，正则用于模板占位符替换和 Markdown 结构解析，不涉及代码结构。

---

### 15. spec-userstory-to-design

| 项目 | 内容 |
|------|------|
| **主要功能** | 从 User Story 生成 Page Flow（Mermaid）+ Page Detail + OpenAPI 契约 |
| **是否使用正则解析代码** | 是（解析 Markdown User Story 格式，非代码结构） |
| **解析的目标** | Markdown / User Story 文本 |
| **迁移到 AST 的可行性** | **低** |
| **推荐使用的 ast-parser.js API** | 不适用 |

#### 说明：
正则用于：
- 从 spec.md 提取 User Story（标题、优先级、Acceptance Scenarios）
- 解析 Given/When/Then 格式
- slugify / camelCase 字符串处理

这些是需求文档解析，与代码解析无关。

---

## 迁移优先级总览

| 优先级 | Skill 名称 | 解析目标 | 迁移可行性 | 主要价值 |
|--------|-----------|----------|-----------|---------|
| ⭐ 已完成 | html-converter | HTML | 已完成 | 组件提取、结构转换 |
| ⭐ 已完成 | ui-design | HTML + CSS | 已完成 | 设计令牌提取、样式分析 |
| 🔴 高 | **review-checklist** | JS/TS | 高 | 60+ 条代码审查规则的准确性提升 |
| 🟡 中 | **code-patterns** | JS/TS | 中 | 模式自动检测、代码异味分析 |
| 🟢 低 | scaffold-runner | 模板语言 | 低 | 自定义模板语法，AST 不直接适用 |
| 🟢 低 | api-contract | YAML/Markdown | 低 | 非代码结构解析 |
| 🟢 低 | test-runner | 文件路径 | 低 | 路径匹配用正则合理 |
| 🟢 低 | debug-helper | 错误文本 | 低 | 错误分类，非代码解析 |
| 🟢 低 | implement-executor | Markdown | 低 | 任务列表解析 |
| 🟢 低 | dependency-auditor | JSON/命令输出 | 低 | JSON.parse 为主 |
| 🟢 低 | environment-manager | 配置值 | 低 | 变量校验，非代码解析 |
| 🟢 低 | git-workflow | Git 文本 | 低 | commit/conflict 解析 |
| 🟢 低 | openspec-workflow | 自然语言 | 低 | 关键词提取 |
| 🟢 低 | spec-bootstrap | Markdown 模板 | 低 | 文档生成 |
| 🟢 低 | spec-userstory-to-design | Markdown | 低 | 需求文档解析 |

---

## 建议

### 下一步行动

1. **优先迁移 review-checklist**（高价值）
   - 从 JS/TS 代码结构相关的规则开始（约 25 条）
   - 第一阶段迁移：空 catch、eval、XSS、同步 I/O、函数提取等 5-8 条核心规则
   - 保持正则作为 fallback（处理 diff 格式而非完整文件）
   - 预期收益：误报率降低 30-50%，支持更复杂的语义分析

2. **扩展 code-patterns 的 AST 能力**（中价值）
   - 增加"代码异味自动检测"功能
   - 利用 AST 实现模式自动识别（当前模式是静态展示，无自动检测）
   - 可与 review-checklist 共享规则库

3. **其他 Skill 暂不迁移**
   - 大部分 Skill 的正则用于文本处理（Markdown/YAML/配置/Git），不属于代码结构解析范畴
   - scaffold-runner 的模板引擎是自定义语法，AST 不直接适用，如需升级建议引入成熟模板引擎

### ast-parser.js 扩展建议

为支持 review-checklist 迁移，建议在 ast-parser.js 中新增以下 API：

```javascript
// 代码质量检测
function detectEmptyCatches(ast) { ... }
function detectEvalUsage(ast) { ... }
function detectXSSPatterns(ast) { ... }
function detectHardcodedSecrets(ast) { ... }
function detectSQLInjection(ast) { ... }

// 结构分析
function extractFunctions(ast) { ... }  // 替代正则版 extractFunctions
function extractImports(ast) { ... }
function extractExports(ast) { ... }
function calculateComplexity(ast) { ... }

// 通用 AST 遍历
function walkJS(ast, visitors) { ... }  // 封装 recast.visit
```
