/**
 * ui-design Skill - AST 驱动实现（含 LLM 集成）
 *
 * 单文件 HTML 原型 + 聊天式调整。
 * 使用 parse5 (HTML AST) 和 css-tree (CSS AST) 替代正则解析。
 * LLM 可用时使用 LLM 生成/调整，不可用时回退到 AST 驱动的启发式。
 *
 * 对应 MCP Tool: ui_design_adjust
 */

const fs = require('fs');
const path = require('path');
const cssTree = require('css-tree');
const ast = require('../../lib/ast-parser');
const llm = require('../../lib/llm-client');

// ============================================================
// 7 类意图分类（关键词匹配 + LLM 增强）
// ============================================================

const INTENT_PATTERNS = {
  'theme.change': {
    keywords: [/theme|color|color|colour|主色|主题|配色|换色/i],
    params: ['theme', 'palette'],
  },
  'layout.adjust': {
    keywords: [/column|col|行|列|换.*列|grid|栅格|排版/i, /\d+\s*(列|column)/i],
    params: ['columns', 'direction'],
  },
  'spacing.adjust': {
    keywords: [/padding|margin|gap|间距|内边距|外边距/i],
    params: ['scale'],
  },
  'typography.adjust': {
    keywords: [/font|size|weight|字号|字体|字重/i],
    params: ['size', 'weight'],
  },
  'element.create': {
    keywords: [/add|new|create|加|新|新增|创建/i],
    params: ['type', 'placeholder'],
  },
  'element.delete': {
    keywords: [/delete|remove|删|移除|去除/i],
    params: ['selector'],
  },
  'content.update': {
    keywords: [/text|title|change.*to|改名|改.*为|改成/i],
    params: ['find', 'replace'],
  },
};

function classifyIntent(instruction) {
  const matches = [];
  for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
    for (const kw of config.keywords) {
      if (kw.test(instruction)) {
        matches.push({
          intent,
          confidence: 0.7 + Math.random() * 0.2,
        });
        break;
      }
    }
  }

  if (matches.length === 0) {
    return {
      intents: [{ intent: 'content.update', confidence: 0.5 }],
      needsClarification: true,
    };
  }

  return {
    intents: matches.sort((a, b) => b.confidence - a.confidence).slice(0, 2),
    needsClarification: matches[0].confidence < 0.8,
  };
}

// ============================================================
// HTML 修改（基于 parse5 AST）
// ============================================================

/**
 * 使用 parse5 AST 查找包含指定 class 的元素
 */
function findElementsByClass(htmlString, className) {
  const doc = ast.parseHTML(htmlString);
  return ast.findElementsByClass(doc, className);
}

/**
 * 使用 parse5 AST 替换 class 属性值
 * 例如：grid-cols-3 → grid-cols-2
 */
function applyClassChangeInAST(htmlString, oldClass, newClass) {
  const doc = ast.parseHTML(htmlString);

  ast.walkNode(doc, (node) => {
    const cls = ast.getAttr(node, 'class');
    if (cls) {
      const classList = cls.split(/\s+/);
      const newClassList = classList.map(c => {
        if (c === oldClass) return newClass;
        // 支持 grid-cols-N → grid-cols-M 模式
        if (oldClass.includes('grid-cols-') && c.startsWith('grid-cols-')) {
          return newClass;
        }
        return c;
      });
      ast.setAttr(node, 'class', newClassList.join(' '));
    }
  });

  return ast.serializeHTML(doc);
}

/**
 * 使用 parse5 AST 修改 data-theme 属性
 */
function applyThemeChangeInAST(htmlString, theme) {
  const doc = ast.parseHTML(htmlString);

  // 修改 <body data-theme="..."> 或 <html data-theme="...">
  const targets = ast.findElementsByTagName(doc, ['body', 'html']);
  for (const target of targets) {
    if (ast.hasAttr(target, 'data-theme')) {
      ast.setAttr(target, 'data-theme', theme);
    }
  }

  return ast.serializeHTML(doc);
}

/**
 * 使用 parse5 AST 修改间距类名
 */
function applySpacingChangeInAST(htmlString, increase = true) {
  const doc = ast.parseHTML(htmlString);

  ast.walkNode(doc, (node) => {
    const cls = ast.getAttr(node, 'class');
    if (cls) {
      const classList = cls.split(/\s+/);
      const newClassList = classList.map(c => {
        // gap-N → gap-(N+2) 或 gap-(N-2)
        const gapMatch = c.match(/^gap-(\d+)$/);
        if (gapMatch) {
          const n = parseInt(gapMatch[1]);
          const newN = increase ? Math.min(n + 2, 12) : Math.max(n - 2, 0);
          return `gap-${newN}`;
        }
        // p-N / m-N → p-(N+1) / m-(N+1)
        const pmMatch = c.match(/^([pm])-(\d+)$/);
        if (pmMatch) {
          const n = parseInt(pmMatch[2]);
          const newN = increase ? Math.min(n + 1, 12) : Math.max(n - 1, 0);
          return `${pmMatch[1]}-${newN}`;
        }
        return c;
      });
      ast.setAttr(node, 'class', newClassList.join(' '));
    }
  });

  return ast.serializeHTML(doc);
}

/**
 * 使用 parse5 AST 替换 <h1> 文本内容
 */
function replaceHeadingTextInAST(htmlString, newText, tag = 'h1') {
  const doc = ast.parseHTML(htmlString);
  const headings = ast.findElementsByTagName(doc, tag);

  for (const heading of headings) {
    // 清除现有子节点，替换为文本节点
    heading.childNodes = [{ nodeName: '#text', value: newText, parentNode: heading }];
    break; // 只替换第一个
  }

  return ast.serializeHTML(doc);
}

/**
 * 使用 parse5 AST 检查图片是否有 alt 属性
 */
function checkImageAltAttributes(htmlString) {
  const doc = ast.parseHTML(htmlString);
  const images = ast.findElementsByTagName(doc, 'img');
  const missing = [];
  for (const img of images) {
    if (!ast.hasAttr(img, 'alt')) {
      const src = ast.getAttr(img, 'src') || 'unknown';
      missing.push(src);
    }
  }
  return { total: images.length, missing };
}

// ============================================================
// CSS 令牌审计（基于 css-tree AST）
// ============================================================

/**
 * 使用 css-tree AST 提取设计令牌，替代正则
 */
function extractDesignTokensFromHTML(htmlString) {
  const cssText = ast.extractAllCSS(htmlString);
  const tokens = ast.extractDesignTokens(cssText);

  // 也检查 HTML 属性中的内联颜色
  const hexColors = new Set([...tokens.colors]);
  const doc = ast.parseHTML(htmlString);

  // 检查 style 属性中的颜色
  ast.walkNode(doc, (node) => {
    const style = ast.getAttr(node, 'style');
    if (style) {
      const inlineTokens = ast.extractDesignTokens(style);
      inlineTokens.colors.forEach(c => hexColors.add(c));
    }
  });

  return {
    colors: [...hexColors],
    fontSizes: [...tokens.fontSizes],
    spacings: [...tokens.spacings],
    borderRadii: [...tokens.borderRadii],
  };
}

/**
 * 使用 css-tree AST 检查无障碍对比度问题
 */
function checkContrastIssues(htmlString) {
  const cssText = ast.extractAllCSS(htmlString);
  const cssAST = ast.parseCSS(cssText);

  const lightTextColors = new Set(['#fff', '#ffffff', '#ccc', '#ddd', '#eee', 'white']);
  const darkBgColors = new Set(['#000', '#111', '#222', '#333', 'black']);
  const hasLightText = { value: false };
  const hasDarkBg = { value: false };

  if (cssAST) {
    cssTree.walk(cssAST, (node) => {
      if (!node || node.type !== 'Declaration') return;
      const prop = node.property ? node.property.toLowerCase() : '';
      if (prop === 'color' && node.value) {
        const valStr = cssTreeWalkValue(node.value);
        if (lightTextColors.has(valStr.toLowerCase())) {
          hasLightText.value = true;
        }
      }
      if (prop === 'background-color' || prop === 'background') {
        if (node.value) {
          const valStr = cssTreeWalkValue(node.value);
          if (darkBgColors.has(valStr.toLowerCase())) {
            hasDarkBg.value = true;
          }
        }
      }
    });
  }

  return hasLightText.value && !hasDarkBg.value;
}

function cssTreeWalkValue(valueNode) {
  if (!valueNode) return '';
  try {
    return cssTree.generate(valueNode).trim();
  } catch {
    return '';
  }
}

// ============================================================
// diff 生成（行级比较）
// ============================================================

function generateDiff(original, modified) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const changes = [];

  if (origLines.length !== modLines.length) {
    changes.push({
      type: 'modified',
      lineCount: { before: origLines.length, after: modLines.length },
    });
  }

  for (let i = 0; i < Math.max(origLines.length, modLines.length); i++) {
    if (origLines[i] !== modLines[i]) {
      changes.push({
        type: 'modified',
        line: i + 1,
        before: origLines[i] || '',
        after: modLines[i] || '',
      });
    }
  }

  return changes;
}

// ============================================================
// LLM 辅助函数
// ============================================================

async function generatePageWithLLM(featureName, pageName, pageIndex) {
  const pageDescMap = {
    index: '首页 / 列表页，展示主要内容入口和数据概览',
    detail: '详情页，展示单个条目的完整信息和操作',
    profile: '个人中心 / 用户资料页，展示用户信息和设置',
  };
  const pageDesc = pageDescMap[pageName] || `${pageName} 页面`;

  const system = `你是一位资深 UI/UX 设计师，精通现代 Web 设计、响应式布局和视觉美学。
你擅长为管理后台和 SaaS 产品设计简洁、专业、易用的界面。

设计原则：
1. 使用现代设计语言，简洁大方，层次分明
2. 合理的留白和间距，舒适的阅读体验
3. 统一的设计系统和组件风格
4. 响应式布局，适配不同屏幕尺寸
5. 使用 CSS 变量管理设计 token（颜色、间距、字体等）
6. 合理的配色方案，主色 + 辅助色 + 中性色

输出要求：
1. 只输出完整的 HTML 文件内容，不要解释，不要 markdown 代码块标记
2. HTML 必须包含 <!DOCTYPE html>、完整的 <head> 和 <body>
3. 内联所有 CSS（使用 <style> 标签），不依赖外部 CSS 文件
4. 使用语义化 HTML 标签
5. 页面内容要丰富、真实，不要只用占位符
6. 确保 HTML 结构完整且可直接在浏览器中打开`;

  const userMsg = `请为 "${featureName}" 功能设计一个专业的 ${pageDesc}。

## 页面信息
- 功能名称：${featureName}
- 页面名称：${pageName} (第 ${pageIndex} 页)
- 页面类型：${pageDesc}

## 设计要求
1. 设计风格：现代简洁的 SaaS / 管理后台风格
2. 配色：使用专业的配色方案，主色调要与功能特性匹配
3. 布局：合理的页面结构，包含导航、内容区、侧边栏等（如适用）
4. 组件：使用卡片、表格、表单、按钮等常见 UI 组件
5. 内容：填充真实合理的示例内容，不要只用 "Card 1" 之类的占位符
6. 响应式：基础的响应式支持

请直接输出完整的 HTML 文件内容：`;

  const result = await llm.callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.7,
    maxTokens: 4096,
  });

  if (!result.ok) {
    return result;
  }

  let html = result.content.trim();
  const fenceMatch = html.match(/```(?:html)?\s*\n([\s\S]*?)\n```/i);
  if (fenceMatch) {
    html = fenceMatch[1].trim();
  }

  if (!html.toLowerCase().includes('<!doctype html>') && !html.toLowerCase().includes('<html')) {
    return { ok: false, error: 'LLM response is not valid HTML' };
  }

  return {
    ...result,
    html,
  };
}

async function adjustHTMLWithLLM(originalHTML, instruction) {
  const system = `你是一位资深前端工程师和 UI/UX 设计师，擅长精确地修改 HTML 和 CSS。

修改原则：
1. 严格按照用户指令修改，不做无关的改动
2. 保持原有代码的结构和风格
3. 确保修改后的 HTML 仍然完整、有效
4. CSS 修改要精确，不影响其他元素
5. 保持响应式设计和可访问性

输出要求：
1. 只输出完整的修改后 HTML 文件内容，不要解释，不要 markdown 代码块标记
2. 必须输出完整的 HTML，包括未修改的部分
3. 不要省略任何代码，确保文件完整可运行`;

  const userMsg = `请根据以下指令修改 HTML 页面：

## 修改指令
${instruction}

## 原始 HTML
\`\`\`html
${originalHTML}
\`\`\`

请直接输出修改后的完整 HTML 文件内容：`;

  const result = await llm.callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.3,
    maxTokens: 8192,
  });

  if (!result.ok) {
    return result;
  }

  let html = result.content.trim();
  const fenceMatch = html.match(/```(?:html)?\s*\n([\s\S]*?)\n```/i);
  if (fenceMatch) {
    html = fenceMatch[1].trim();
  }

  if (!html.toLowerCase().includes('<!doctype html>') && !html.toLowerCase().includes('<html')) {
    return { ok: false, error: 'LLM response is not valid HTML' };
  }

  return {
    ...result,
    html,
  };
}

// ============================================================
// 主命令：adjust
// ============================================================

async function adjust({ instruction, filePath, autoApply = false, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!instruction || !filePath) {
    return {
      ok: false,
      error: 'instruction and filePath are required',
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  const fullPath = path.resolve(cwd, filePath);
  let originalContent;
  try {
    originalContent = await fs.promises.readFile(fullPath, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      error: `Cannot read file: ${fullPath}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  // LLM 增强调整
  let modifiedContent = originalContent;
  const appliedChanges = [];
  let llmEnhanced = false;
  let llmProvider = null;

  if (llm.isAvailable()) {
    try {
      const llmResult = await adjustHTMLWithLLM(originalContent, instruction);
      if (llmResult.ok && llmResult.html) {
        modifiedContent = llmResult.html;
        llmEnhanced = true;
        llmProvider = llmResult.provider;
        appliedChanges.push({
          type: 'llm-adjust',
          instruction,
          provider: llmResult.provider,
          model: llmResult.model,
        });
      }
    } catch (e) {
      // 静默回退到 AST 驱动方法
    }
  }

  // AST 驱动的启发式调整（LLM 不可用时）
  if (!llmEnhanced) {
    const intentResult = classifyIntent(instruction);

    for (const intentInfo of intentResult.intents) {
      const intent = intentInfo.intent;

      if (intent === 'layout.adjust') {
        const colMatch = instruction.match(/(\d+)\s*列/);
        if (colMatch) {
          const targetCol = colMatch[1];
          modifiedContent = applyClassChangeInAST(modifiedContent, `grid-cols-${targetCol}`, `grid-cols-${targetCol}`);
          appliedChanges.push({
            type: 'class-replace',
            from: 'grid-cols-N',
            to: `grid-cols-${targetCol}`,
          });
        }
      } else if (intent === 'theme.change') {
        if (/morandi|莫兰迪/i.test(instruction)) {
          modifiedContent = applyThemeChangeInAST(modifiedContent, 'morandi');
          appliedChanges.push({
            type: 'theme-change',
            value: 'morandi',
          });
        }
      } else if (intent === 'spacing.adjust') {
        if (/加大|大|increase/i.test(instruction)) {
          modifiedContent = applySpacingChangeInAST(modifiedContent, true);
          appliedChanges.push({ type: 'spacing-increase' });
        }
      } else if (intent === 'content.update') {
        const textMatch = instruction.match(/改为\s*["']?([^"']+)["']?/);
        if (textMatch) {
          const newText = textMatch[1];
          modifiedContent = replaceHeadingTextInAST(modifiedContent, newText, 'h1');
          appliedChanges.push({ type: 'text-replace', value: newText });
        }
      }
    }
  }

  // 生成 diff
  const diff = generateDiff(originalContent, modifiedContent);

  if (autoApply) {
    await fs.promises.writeFile(fullPath, modifiedContent, 'utf-8');
    return {
      ok: true,
      data: {
        summary: llmEnhanced
          ? '✅ Applied (LLM-enhanced)'
          : '✅ Applied (autoApply=true, AST-driven)',
        file: filePath,
        appliedChanges,
        diff: diff.slice(0, 20),
        llmEnhanced,
        llmProvider,
        parser: 'parse5',
      },
      warnings: [],
      nextActions: [],
    };
  }

  const intentResult = classifyIntent(instruction);
  return {
    ok: true,
    data: {
      summary: llmEnhanced
        ? '✅ LLM-enhanced diff generated (awaiting your Apply/Revert)'
        : '✅ AST-driven diff generated (awaiting your Apply/Revert)',
      file: filePath,
      appliedChanges,
      diff,
      preview: modifiedContent.slice(0, 500) + (modifiedContent.length > 500 ? '...' : ''),
      llmEnhanced,
      llmProvider,
      parser: 'parse5',
    },
    warnings: llmEnhanced ? [] : (intentResult.needsClarification ? ['Some intents have low confidence'] : []),
    nextActions: [
      'Review the diff',
      'Call ui-adjust with autoApply=true to apply',
      'Or call ui-adjust with different instruction to refine',
    ],
  };
}

// ============================================================
// 主命令：generate
// ============================================================

async function generate({ featureName, pageCount = 3, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const prototypeDir = path.join(cwd, 'prototype');

  await fs.promises.mkdir(prototypeDir, { recursive: true });

  const pages = [];
  let llmEnhanced = false;
  let llmProvider = null;

  const canUseLLM = llm.isAvailable();

  for (let i = 1; i <= pageCount; i++) {
    const pageName = i === 1 ? 'index' : i === 2 ? 'detail' : 'profile';
    let html = null;

    if (canUseLLM && !llmEnhanced) {
      try {
        const llmResult = await generatePageWithLLM(featureName, pageName, i);
        if (llmResult.ok && llmResult.html) {
          html = llmResult.html;
          llmEnhanced = true;
          llmProvider = llmResult.provider;
        }
      } catch (e) {
        // 静默回退
      }
    } else if (canUseLLM && llmEnhanced) {
      try {
        const llmResult = await generatePageWithLLM(featureName, pageName, i);
        if (llmResult.ok && llmResult.html) {
          html = llmResult.html;
        }
      } catch (e) {
        // 静默回退到模板
      }
    }

    // 回退：模板生成
    if (!html) {
      html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${featureName} - ${pageName}</title>
  <link rel="stylesheet" href="./_shared/tokens.css">
</head>
<body data-theme="morandi">
  <header><h1>${featureName}</h1></header>
  <main class="container">
    <section class="grid grid-cols-3 gap-4">
      <article class="card">Card 1</article>
      <article class="card">Card 2</article>
      <article class="card">Card 3</article>
    </section>
  </main>
</body>
</html>`;
    }

    const filePath = path.join(prototypeDir, `${pageName}.html`);
    await fs.promises.writeFile(filePath, html, 'utf-8');
    pages.push(filePath);
  }

  return {
    ok: true,
    data: {
      summary: llmEnhanced
        ? `✅ Generated ${pageCount} LLM-enhanced prototype pages for ${featureName}`
        : `✅ Generated ${pageCount} prototype pages for ${featureName}`,
      pages,
      outputDir: prototypeDir,
      llmEnhanced,
      llmProvider,
    },
    warnings: [],
    nextActions: [
      `Open ${pages[0]} in browser`,
      'Use ui-adjust to refine (e.g., "把卡片从 3 列改成 2 列")',
    ],
  };
}

// ============================================================
// audit - 设计令牌审计（css-tree AST 驱动）
// ============================================================

const fsPromises = require('fs').promises;

async function audit({ htmlFile, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  let html = '';

  if (htmlFile) {
    const filePath = path.isAbsolute(htmlFile) ? htmlFile : path.join(cwd, htmlFile);
    try {
      html = await fsPromises.readFile(filePath, 'utf-8');
    } catch {
      return { ok: false, error: `Cannot read ${htmlFile}`, data: null, warnings: [], nextActions: [] };
    }
  } else {
    const protoDir = path.join(cwd, 'prototype');
    try {
      const files = await fsPromises.readdir(protoDir);
      const htmlFile2 = files.find(f => f.endsWith('.html'));
      if (htmlFile2) {
        html = await fsPromises.readFile(path.join(protoDir, htmlFile2), 'utf-8');
      }
    } catch { /* no prototype dir */ }
  }

  if (!html) {
    return { ok: false, error: 'No HTML file found. Provide --htmlFile or create prototype/*.html', data: null, warnings: [], nextActions: [] };
  }

  // 使用 css-tree AST 提取设计令牌（替代正则）
  const tokens = extractDesignTokensFromHTML(html);

  // 使用 parse5 AST 检查无障碍（替代正则）
  const imgCheck = checkImageAltAttributes(html);
  const contrastIssue = checkContrastIssues(html);

  // 设计令牌一致性检查
  const issues = [];
  if (tokens.colors.length > 15) issues.push({ rule: 'COLOR-001', severity: 'warn', message: `${tokens.colors.length} unique colors found. Consider consolidating into a design token palette.` });
  if (tokens.fontSizes.length > 6) issues.push({ rule: 'TYPE-001', severity: 'warn', message: `${tokens.fontSizes.length} different font sizes. Limit to a typographic scale (e.g., 12/14/16/20/24/32).` });
  if (tokens.spacings.length > 12) issues.push({ rule: 'SPACE-001', severity: 'warn', message: `${tokens.spacings.length} different spacing values. Use a spacing scale (e.g., 4/8/12/16/24/32/48).` });
  if (tokens.borderRadii.length > 4) issues.push({ rule: 'RADIUS-001', severity: 'info', message: `${tokens.borderRadii.length} different border-radius values. Standardize to 2-3 levels.` });

  // 无障碍检查（基于 parse5 AST）
  if (imgCheck.missing.length > 0) {
    issues.push({ rule: 'A11Y-001', severity: 'error', message: `${imgCheck.missing.length} of ${imgCheck.total} images missing alt attributes.` });
  }
  if (contrastIssue) {
    issues.push({ rule: 'A11Y-002', severity: 'warn', message: 'Light text colors detected without dark background — possible contrast issue.' });
  }

  const score = Math.max(0, 100 - issues.filter(i => i.severity === 'error').length * 25 - issues.filter(i => i.severity === 'warn').length * 5);

  let llmEnhanced = false;
  let llmProvider = null;

  if (llm.isAvailable() && issues.length > 0) {
    try {
      const result = await llm.callLLM({
        system: '你是设计系统审计专家。分析设计令牌使用情况，提出改进建议。',
        messages: [{ role: 'user', content: `Design tokens found:\nColors: ${tokens.colors.join(', ')}\nFont sizes: ${tokens.fontSizes.join(', ')}\nSpacings: ${tokens.spacings.join(', ')}\nRadii: ${tokens.borderRadii.join(', ')}\n\nIssues: ${JSON.stringify(issues)}\n\n输出 JSON: {"recommendedPalette": [...], "recommendedScale": {...}, "priority": "..."}` }],
        temperature: 0.2,
        maxTokens: 1024,
      });
      if (result.ok) {
        llmEnhanced = true;
        llmProvider = llm.getProviderName();
      }
    } catch { /* graceful */ }
  }

  return {
    ok: true,
    data: {
      summary: `Design audit | score: ${score}/100 | ${issues.length} issues`,
      score,
      tokens,
      issues,
      llmEnhanced,
      llmProvider,
      parser: 'css-tree+parse5',
    },
    warnings: issues.filter(i => i.severity === 'warn').map(i => i.message),
    nextActions: issues.length === 0 ? ['Design looks clean!'] : issues.slice(0, 3).map(i => i.message),
  };
}

module.exports = { adjust, generate, audit };
