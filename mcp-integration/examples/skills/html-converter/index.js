/**
 * html-converter Skill - AST 驱动实现
 *
 * HTML 原型 → Vue 3 SFC / React TSX 组件代码。
 * 使用 parse5 (HTML AST) / css-tree (CSS AST) / recast (JS/TS AST) 替代正则解析。
 * 支持：convert（完整转换）/ split（仅拆分）/ types（仅生成类型）
 *
 * 对应 MCP Tool: html_converter_convert
 */

const fs = require('fs').promises;
const path = require('path');
const ast = require('../../lib/ast-parser');
const llm = require('../../lib/llm-client');

// ============================================================
// 工具函数
// ============================================================

function toPascalCase(s) {
  return s.replace(/[-_\s]+(\w)/g, (_, c) => c.toUpperCase())
    .replace(/^(\w)/, (_, c) => c.toUpperCase());
}

function toKebabCase(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function extractComponentName(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return toPascalCase(base);
}

// ============================================================
// HTML 解析（基于 parse5 AST）
// ============================================================

/**
 * 提取 body 内容 — 使用 parse5 AST 替代正则
 */
function extractBody(html) {
  return ast.extractBodyHTML(html);
}

/**
 * 提取所有 class 名称 — 使用 parse5 AST 遍历
 */
function extractAllClasses(html) {
  const doc = ast.parseHTML(html);
  return ast.extractAllClasses(doc);
}

/**
 * 提取表单字段 — 使用 parse5 AST 精确定位 input/textarea/select
 */
function extractFormFields(html) {
  const doc = ast.parseHTML(html);
  const fields = ast.extractFormFields(doc);
  // 移除内部的 node 引用（外部不需要）
  return fields.map(f => {
    const { node, ...rest } = f;
    return rest;
  });
}

/**
 * 识别重复结构 — 使用 parse5 AST 遍历替代正则
 */
function detectRepeatingStructures(html, threshold = 3) {
  const doc = ast.parseHTML(html);
  const structures = ast.detectRepeatingStructures(doc, threshold);

  // 清理内部 node 引用
  return structures.map(s => {
    if (s.fields) {
      s.fields = s.fields.map(f => {
        const { node, ...rest } = f;
        return rest;
      });
    }
    return s;
  });
}

// ============================================================
// React TSX 生成（AST 驱动）
// ============================================================

function generateReactComponent(componentName, html, fields, subComponents) {
  const doc = ast.parseHTML(html);
  const bodyNode = ast.extractBodyNodes(doc);

  // AST 级属性名转换：class→className, onclick→onClick 等
  const reactBody = ast.convertToReactHTML(bodyNode);
  const bodyHTML = ast.serializeHTML(reactBody);

  const hasForm = fields.length > 0;
  const propsInterface = generateReactProps(componentName, fields);
  const subImports = subComponents.map(sc =>
    `import { ${sc.name} } from './${sc.name}'`
  ).join('\n');

  return `import { FC ${hasForm ? ', useState, FormEvent' : ''} } from 'react';

${subImports}

${propsInterface}

export const ${componentName}: FC<${componentName}Props> = ({
  ${generatePropsDestructuring(fields)}
}) => {
${hasForm ? `  const [formData, setFormData] = useState<Partial<${componentName}FormData>>({});

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
  };
` : ''}
  return (
    <div className="${toKebabCase(componentName)}">
${bodyHTML.split('\n').map(line => '      ' + line).join('\n').slice(0, 2000)}
    </div>
  );
};

export default ${componentName};
`;
}

function generateReactProps(componentName, fields) {
  if (fields.length === 0) {
    return `interface ${componentName}Props {
  children?: React.ReactNode;
}`;
  }

  const props = fields.map(f => {
    const optional = f.required ? '' : '?';
    return `  ${f.name}${optional}: ${f.type === 'enum' && f.options
      ? f.options.map(o => `'${o.value}'`).join(' | ')
      : f.type};`;
  }).join('\n');

  return `interface ${componentName}Props {
${props}
  children?: React.ReactNode;
}

interface ${componentName}FormData {
${fields.filter(f => f.source === 'input' || f.source === 'textarea' || f.source === 'select').map(f => {
    const type = f.type === 'enum' && f.options
      ? f.options.map(o => `'${o.value}'`).join(' | ')
      : f.type;
    return `  ${f.name}?: ${type};`;
  }).join('\n')}
}`;
}

function generatePropsDestructuring(fields) {
  if (fields.length === 0) return 'children';
  return fields.slice(0, 5).map(f => f.name).join(', ') + ', children';
}

// ============================================================
// Vue 3 SFC 生成（AST 驱动）
// ============================================================

function generateVueComponent(componentName, html, fields, subComponents) {
  const doc = ast.parseHTML(html);
  const bodyNode = ast.extractBodyNodes(doc);

  // AST 级事件绑定转换：onclick→@click 等
  const vueBody = ast.convertToVueHTML(bodyNode);
  const bodyHTML = ast.serializeHTML(vueBody);
  const tagName = toKebabCase(componentName);

  const propsInterface = generateVueProps(fields);
  const subImports = subComponents.map(sc =>
    `import ${sc.name} from './${sc.name}.vue'`
  ).join('\n');

  return `<template>
  <div class="${tagName}">
${bodyHTML.split('\n').map(line => '    ' + line).join('\n').slice(0, 2000)}
  </div>
</template>

<script setup lang="ts">
${subImports}
${propsInterface}
</script>

<style scoped>
.${tagName} {
  /* Component styles - inherited from prototype */
}
</style>
`;
}

function generateVueProps(fields) {
  if (fields.length === 0) {
    return `interface Props {
  // Define props here
}

defineProps<Props>();`;
  }

  const props = fields.map(f => {
    const optional = f.required ? '' : '?';
    const type = f.type === 'enum' && f.options
      ? f.options.map(o => `'${o.value}'`).join(' | ')
      : f.type;
    return `  ${f.name}${optional}: ${type};`;
  }).join('\n');

  return `interface Props {
${props}
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update', value: unknown): void;
}>();`;
}

// ============================================================
// TypeScript 类型生成（recast 验证）
// ============================================================

function generateTypesFile(fields, interfaceName = 'FormData') {
  const fieldDefs = fields.map(f => {
    const optional = f.required ? '' : '?';
    let type = f.type;

    if (f.type === 'enum' && f.options) {
      type = f.options.map(o => `'${o.value}'`).join(' | ');
    }

    const comment = f.placeholder ? `  /** ${f.placeholder} */\n` : '';
    return `${comment}  ${f.name}${optional}: ${type};`;
  }).join('\n\n');

  const code = `/**
 * Auto-generated TypeScript interfaces from HTML prototype
 * Generated by html-converter
 */

export interface ${interfaceName} {
${fieldDefs}
}

// Utility type: make all fields optional
export type ${interfaceName}Partial = Partial<${interfaceName}>;

// Utility type: pick required fields
export type ${interfaceName}Required = Pick<${interfaceName}, ${fields.filter(f => f.required).map(f => `'${f.name}'`).join(' | ') || 'never'}>;
`;

  // 使用 recast 验证生成的 TS 代码语法正确性
  const validation = ast.validateTSInterface(code);
  if (!validation.valid) {
    // 语法错误时记录但不阻塞（降级返回未验证的代码）
    console.error(`[html-converter] TS validation warning: ${validation.error?.slice(0, 200)}`);
  }

  return code;
}

// ============================================================
// LLM 增强函数
// ============================================================

async function convertWithLLM(htmlContent, framework, componentName, typescript) {
  if (!llm.isAvailable()) return null;

  try {
    const frameworkLabel = framework === 'vue3' ? 'Vue 3 SFC (Composition API + <script setup>)' : 'React Function Component';
    const langLabel = typescript ? 'TypeScript' : 'JavaScript';

    const result = await llm.callLLM({
      system: `你是资深前端架构师，精通 ${frameworkLabel} 和 ${langLabel}。
你的任务是将 HTML 原型转换为高质量、生产级别的组件代码。

转换原则：
1. 保持原有的视觉设计和布局结构，保留所有 Tailwind class
2. 合理拆分组件，遵循单一职责原则
3. 使用语义化的 prop 命名和类型定义
4. 提取可复用的逻辑和样式
5. 遵循最佳实践和设计模式
6. 代码整洁、注释清晰

输出要求：
1. 只输出完整的组件代码，不要解释，不要 markdown 代码块标记
2. 代码必须完整、可直接使用
3. 包含必要的类型定义、props 接口、事件定义
4. 样式使用 scoped CSS（Vue）或 className（React）
5. 合理使用组合式 API / Hooks`,
      messages: [{
        role: 'user',
        content: `## 组件名称
${componentName}

## 目标框架
${frameworkLabel} + ${langLabel}

## 原始 HTML
\`\`\`html
${htmlContent.slice(0, 8000)}
\`\`\`

## 转换要求
${framework === 'vue3' ? `- 使用 Vue 3 Composition API + <script setup> 语法
- 使用 TypeScript 类型定义 props 和 emits
- 样式使用 <style scoped>
- 保留所有 class 名称
- 合理提取 props，使组件可配置` : `- 使用 React Function Component
- 使用 TypeScript 接口定义 props
- class → className 转换
- 保留所有样式类名
- 合理提取 props，使组件可配置`}

请直接输出完整的组件代码文件内容：`,
      }],
      temperature: 0.3,
      maxTokens: 8192,
    });

    if (result.ok) {
      let code = result.content.trim();
      const fenceMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
      if (fenceMatch) code = fenceMatch[1].trim();
      if (code.length >= 50) {
        return { code, provider: result.provider };
      }
    }
  } catch { /* 静默回退 */ }
  return null;
}

async function splitWithLLM(htmlContent, framework) {
  if (!llm.isAvailable()) return null;

  try {
    const result = await llm.callLLM({
      system: `你是 React/Vue 组件拆分专家。基于 HTML 结构，识别重复模式和可独立的 UI 模块。

输出严格的 JSON 格式：
{
  "components": [
    {
      "name": "组件名（PascalCase）",
      "type": "stateless | container | form | layout",
      "props": ["propName: type"],
      "reason": "拆分理由",
      "selector": "对应的 CSS 选择器或 class"
    }
  ]
}

要求：
1. 识别出现 ≥ 3 次的重复结构
2. 识别可独立的 UI 模块（卡片、模态框、表单项等）
3. 识别表单字段组
4. 组件名使用 PascalCase
5. 只输出 JSON，不要解释，不要 markdown 代码块`,
      messages: [{
        role: 'user',
        content: `## HTML 结构
\`\`\`html
${extractBody(htmlContent).slice(0, 6000)}
\`\`\`

请分析以上 HTML，给出组件拆分方案。`,
      }],
      temperature: 0.2,
      maxTokens: 4096,
    });

    if (result.ok) {
      let content = result.content.trim();
      const fenceMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) content = fenceMatch[1].trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.components && Array.isArray(parsed.components)) {
          return { components: parsed.components, provider: result.provider };
        }
      }
    }
  } catch { /* 静默回退 */ }
  return null;
}

async function typesWithLLM(htmlContent) {
  if (!llm.isAvailable()) return null;

  try {
    const result = await llm.callLLM({
      system: `你是 TypeScript 专家，从 HTML 中识别表单字段和数据展示字段，生成完整的 TypeScript interface。

要求：
1. 识别所有 input、select、textarea 等表单元素
2. 识别数据展示字段（卡片中的信息）
3. 推断合理的类型（string, number, boolean, enum 等）
4. 标记必填/可选
5. 添加 JSDoc 注释
6. 只输出 TypeScript 代码，不要解释，不要 markdown 代码块标记`,
      messages: [{
        role: 'user',
        content: `## HTML 原型
\`\`\`html
${extractBody(htmlContent).slice(0, 6000)}
\`\`\`

请生成完整的 TypeScript interface 文件，包含：
1. 表单数据接口（FormData）
2. 数据展示接口（如果有）
3. 相关的枚举类型
4. 工具类型（Partial, Required 等）`,
      }],
      temperature: 0.2,
      maxTokens: 4096,
    });

    if (result.ok) {
      let code = result.content.trim();
      const fenceMatch = code.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) code = fenceMatch[1].trim();
      if (code.length >= 50 && code.includes('interface')) {
        // 验证 LLM 生成的 TS 代码语法
        const validation = ast.validateTSInterface(code);
        if (validation.valid) {
          return { code, provider: result.provider };
        }
        // 语法无效时仍返回，但标记为未验证
        return { code, provider: result.provider, unvalidated: true };
      }
    }
  } catch { /* 静默回退 */ }
  return null;
}

async function beautifyWithLLM(htmlContent, designLevel = 'professional') {
  if (!llm.isAvailable()) return null;

  try {
    const designDesc = {
      basic: '基础美化，保持现有结构，优化代码格式',
      professional: '专业美化，优化视觉设计、间距、配色、排版',
      premium: '高级美化，完整的设计系统、动效、微交互',
    }[designLevel] || '专业美化';

    const result = await llm.callLLM({
      system: `你是资深前端工程师和 UI 设计师，擅长 HTML/CSS 美化。

美化原则：
1. 保持原有内容和功能不变
2. 优化视觉设计：配色、排版、间距、层次
3. 提升代码质量：语义化标签、合理的 class 命名
4. 增强可访问性：ARIA 属性、键盘导航、语义化
5. 优化响应式布局：适配不同屏幕尺寸
6. 使用现代 CSS 技术：Flexbox、Grid、CSS 变量

输出要求：
1. 只输出完整的 HTML 文件内容，不要解释，不要 markdown 代码块标记
2. 内联所有 CSS（使用 <style> 标签）
3. 确保 HTML 结构完整有效
4. 保留原有的所有内容和功能`,
      messages: [{
        role: 'user',
        content: `## 美化级别
${designDesc}

## 原始 HTML
\`\`\`html
${htmlContent.slice(0, 10000)}
\`\`\`

请直接输出美化后的完整 HTML 文件内容：`,
      }],
      temperature: 0.5,
      maxTokens: 8192,
    });

    if (result.ok) {
      let html = result.content.trim();
      const fenceMatch = html.match(/```(?:html)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) html = fenceMatch[1].trim();
      if (html.toLowerCase().includes('<html') || html.toLowerCase().includes('<!doctype')) {
        return { html, provider: result.provider };
      }
    }
  } catch { /* 静默回退 */ }
  return null;
}

// ============================================================
// 主命令：convert
// ============================================================

async function convert({ htmlFile, framework = 'react', target, typescript = true, splitThreshold = 3, outputDir = 'src/components', out, projectRoot, tailwind = true }) {
  const cwd = projectRoot || process.cwd();
  const targetFramework = target || framework;

  if (!htmlFile) {
    return { ok: false, error: 'htmlFile is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const htmlPath = path.resolve(cwd, htmlFile);
  let htmlContent;
  try {
    htmlContent = await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot read htmlFile: ${htmlPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  try {
    // 使用 parse5 AST 解析字段和结构
    const fields = extractFormFields(htmlContent);
    const repeatingStructures = detectRepeatingStructures(htmlContent, splitThreshold);
    const componentName = extractComponentName(htmlFile);

    const heuristicSubComponents = repeatingStructures.slice(0, 5).map(s => ({
      name: s.name,
      type: s.type,
      count: s.count,
    }));

    // LLM 增强转换
    let componentContent = null;
    let subComponents = heuristicSubComponents;
    let llmEnhanced = false;
    let llmProvider = null;

    const llmResult = await convertWithLLM(htmlContent, targetFramework, componentName, typescript);
    if (llmResult) {
      componentContent = llmResult.code;
      llmEnhanced = true;
      llmProvider = llmResult.provider;

      const splitResult = await splitWithLLM(htmlContent, targetFramework);
      if (splitResult) {
        subComponents = splitResult.components;
      }
    }

    // 回退：AST 驱动的启发式生成
    if (!componentContent) {
      componentContent = targetFramework === 'vue3'
        ? generateVueComponent(componentName, htmlContent, fields, heuristicSubComponents)
        : generateReactComponent(componentName, htmlContent, fields, heuristicSubComponents);
    }

    // 写文件
    const outDir = path.resolve(cwd, out || outputDir);
    await fs.mkdir(outDir, { recursive: true });

    const ext = targetFramework === 'vue3' ? 'vue' : (typescript ? 'tsx' : 'jsx');
    const mainFile = path.join(outDir, `${componentName}.${ext}`);
    await fs.writeFile(mainFile, componentContent, 'utf-8');

    // 生成子组件骨架文件
    const subComponentFiles = [];
    if (!llmEnhanced && subComponents.length > 0) {
      for (const sc of subComponents.slice(0, 3)) {
        const scContent = targetFramework === 'vue3'
          ? `<template>
  <div class="${toKebabCase(sc.name)}">
    <!-- ${sc.type || 'sub-component'} -->
    <slot />
  </div>
</template>

<script setup lang="ts">
interface Props {
  // define props
}

defineProps<Props>();
</script>

<style scoped>
.${toKebabCase(sc.name)} {
  /* styles */
}
</style>
`
          : `import { FC } from 'react';

interface ${sc.name}Props {
  children?: React.ReactNode;
}

export const ${sc.name}: FC<${sc.name}Props> = ({ children }) => {
  return (
    <div className="${toKebabCase(sc.name)}">
      {children}
    </div>
  );
};

export default ${sc.name};
`;
        const scFile = path.join(outDir, `${sc.name}.${ext}`);
        await fs.writeFile(scFile, scContent, 'utf-8');
        subComponentFiles.push(scFile);
      }
    }

    // 生成类型文件（recast 验证）
    let typeFile = null;
    if (typescript && fields.length > 0) {
      const typesDir = path.resolve(cwd, 'src/types');
      await fs.mkdir(typesDir, { recursive: true });
      const typeContent = generateTypesFile(fields, `${componentName}FormData`);
      typeFile = path.join(typesDir, `${toKebabCase(componentName)}.types.ts`);
      await fs.writeFile(typeFile, typeContent, 'utf-8');
    }

    const allFiles = [mainFile, ...subComponentFiles];
    if (typeFile) allFiles.push(typeFile);

    return {
      ok: true,
      data: {
        summary: `✅ Converted to ${targetFramework}${llmEnhanced ? ' (LLM-enhanced)' : ' (AST-driven)'} `,
        mainComponent: mainFile,
        framework: targetFramework,
        typescript,
        fieldsCount: fields.length,
        subComponents: subComponents.map(s => s.name),
        subComponentFiles,
        typeFile,
        files: allFiles,
        llmEnhanced,
        llmProvider: llmEnhanced ? llmProvider : null,
        parser: 'parse5+csstree+recast',
      },
      warnings: llmEnhanced
        ? []
        : ['LLM not available, using AST-driven heuristic conversion'],
      nextActions: [
        `Review ${componentName}.${ext}`,
        subComponents.length > 0 ? `Review ${subComponents.length} sub-components` : null,
        typeFile ? 'Review generated types' : null,
        'Run linter to fix formatting',
      ].filter(Boolean),
    };
  } catch (err) {
    return { ok: false, error: `Conversion failed: ${err.message}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }
}

// ============================================================
// 命令：split（仅拆分组件）
// ============================================================

async function split({ htmlFile, framework = 'react', splitThreshold = 3, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!htmlFile) {
    return { ok: false, error: 'htmlFile is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const htmlPath = path.resolve(cwd, htmlFile);
  let htmlContent;
  try {
    htmlContent = await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot read htmlFile: ${htmlPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let components = [];
  let llmEnhanced = false;
  let llmProvider = null;

  // 尝试 LLM 智能拆分
  const llmResult = await splitWithLLM(htmlContent, framework);
  if (llmResult) {
    components = llmResult.components;
    llmEnhanced = true;
    llmProvider = llmResult.provider;
  } else {
    // parse5 AST 驱动的启发式拆分
    const structures = detectRepeatingStructures(htmlContent, splitThreshold);
    components = structures.map(s => ({
      name: s.name,
      type: s.type,
      count: s.count,
      reason: `${s.count} occurrences detected`,
      selector: s.classes || s.tag,
    }));
  }

  return {
    ok: true,
    data: {
      summary: `Identified ${components.length} component(s) to split${llmEnhanced ? ' (LLM-enhanced)' : ' (AST-driven)'} `,
      htmlFile,
      framework,
      components,
      componentCount: components.length,
      llmEnhanced,
      llmProvider: llmEnhanced ? llmProvider : null,
      parser: 'parse5',
    },
    warnings: llmEnhanced ? [] : ['LLM not available, using AST-driven detection'],
    nextActions: components.length > 0
      ? [
        `Run /html-converter.convert to generate full code`,
        ...components.slice(0, 3).map(c => `Component: ${c.name} (${c.type})`),
      ]
      : ['No split candidates found'],
  };
}

// ============================================================
// 命令：types（仅生成类型）
// ============================================================

async function types({ htmlFile, outputFile, interfaceName, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!htmlFile) {
    return { ok: false, error: 'htmlFile is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const htmlPath = path.resolve(cwd, htmlFile);
  let htmlContent;
  try {
    htmlContent = await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot read htmlFile: ${htmlPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let typeContent = '';
  let llmEnhanced = false;
  let llmProvider = null;

  // parse5 AST 驱动的字段提取
  const fields = extractFormFields(htmlContent);
  const defaultName = interfaceName || extractComponentName(htmlFile) + 'FormData';

  // 尝试 LLM 增强
  const llmResult = await typesWithLLM(htmlContent);
  if (llmResult) {
    typeContent = llmResult.code;
    llmEnhanced = true;
    llmProvider = llmResult.provider;
  } else {
    typeContent = generateTypesFile(fields, defaultName);
  }

  // 写文件
  const outPath = outputFile
    ? path.resolve(cwd, outputFile)
    : path.resolve(cwd, 'src/types', `${toKebabCase(extractComponentName(htmlFile))}.types.ts`);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, typeContent, 'utf-8');

  return {
    ok: true,
    data: {
      summary: `Generated TypeScript types${llmEnhanced ? ' (LLM-enhanced)' : ' (AST-driven)'} `,
      outputFile: outPath,
      fieldsCount: fields.length,
      interfaceName: defaultName,
      llmEnhanced,
      llmProvider: llmEnhanced ? llmProvider : null,
      parser: 'parse5+recast',
    },
    warnings: llmEnhanced ? [] : ['LLM not available, using AST-driven extraction'],
    nextActions: [
      `Review ${path.basename(outPath)}`,
      fields.length === 0 ? 'Add form fields to HTML for better type extraction' : 'Import types into your components',
    ],
  };
}

// ============================================================
// 命令：beautify（美化 HTML）
// ============================================================

async function beautify({ htmlFile, outputFile, designLevel = 'professional', projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!htmlFile) {
    return { ok: false, error: 'htmlFile is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const htmlPath = path.resolve(cwd, htmlFile);
  let htmlContent;
  try {
    htmlContent = await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return { ok: false, error: `Cannot read htmlFile: ${htmlPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let beautifiedHTML = null;
  let llmEnhanced = false;
  let llmProvider = null;

  const llmResult = await beautifyWithLLM(htmlContent, designLevel);
  if (llmResult) {
    beautifiedHTML = llmResult.html;
    llmEnhanced = true;
    llmProvider = llmResult.provider;
  } else {
    // LLM 不可用时，使用 parse5 做格式化序列化
    try {
      const doc = ast.parseHTML(htmlContent);
      beautifiedHTML = ast.serializeHTML(doc);
    } catch {
      beautifiedHTML = htmlContent;
    }
  }

  const outPath = outputFile
    ? path.resolve(cwd, outputFile)
    : htmlPath;

  await fs.writeFile(outPath, beautifiedHTML, 'utf-8');

  return {
    ok: true,
    data: {
      summary: llmEnhanced ? `HTML beautified (${designLevel}, LLM-enhanced)` : 'HTML reformatted (parse5)',
      inputFile: htmlFile,
      outputFile: path.relative(cwd, outPath),
      designLevel,
      llmEnhanced,
      llmProvider: llmEnhanced ? llmProvider : null,
      parser: 'parse5',
    },
    warnings: llmEnhanced ? [] : ['LLM not available, using parse5 serialization'],
    nextActions: llmEnhanced
      ? ['Open the file to review changes']
      : ['Configure LLM to enable advanced HTML beautification'],
  };
}

module.exports = { convert, split, types, beautify };
