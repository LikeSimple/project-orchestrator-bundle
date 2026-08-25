/**
 * AST Parser - 基于 parse5 / css-tree / recast 的 AST 解析工具
 *
 * 提供 HTML / CSS / JS 的 AST 级解析与操作，替代正则表达式。
 * 被 html-converter / ui-design / code-patterns 等 Skill 共享使用。
 */

const parse5 = require('parse5');
const cssTree = require('css-tree');
const recast = require('recast');
const babelParser = require('@babel/parser');

// ============================================================
// HTML AST (parse5)
// ============================================================

/**
 * 将 HTML 字符串解析为 parse5 AST
 */
function parseHTML(html) {
  return parse5.parse(html, { sourceCodeLocationInfo: true });
}

/**
 * 将 parse5 AST 序列化回 HTML 字符串
 */
function serializeHTML(node) {
  return parse5.serialize(node);
}

/**
 * 遍历 AST 节点，回调返回 false 时停止该分支遍历
 */
function walkNode(node, callback, parent = null, index = -1) {
  if (!node || typeof node !== 'object') return;
  const result = callback(node, parent, index);
  if (result === false) return;

  if (node.childNodes) {
    for (let i = 0; i < node.childNodes.length; i++) {
      walkNode(node.childNodes[i], callback, node, i);
    }
  }
}

/**
 * 查找所有指定标签名的元素
 */
function findElementsByTagName(root, tagNames) {
  const tags = Array.isArray(tagNames) ? tagNames.map(t => t.toLowerCase()) : [tagNames.toLowerCase()];
  const results = [];
  walkNode(root, (node) => {
    if (node.nodeName && tags.includes(node.nodeName)) {
      results.push(node);
    }
  });
  return results;
}

/**
 * 获取元素的属性值
 */
function getAttr(node, name) {
  if (!node.attrs) return null;
  for (const attr of node.attrs) {
    if (attr.name === name) return attr.value;
  }
  return null;
}

/**
 * 检查元素是否有某属性
 */
function hasAttr(node, name) {
  if (!node.attrs) return false;
  return node.attrs.some(a => a.name === name);
}

/**
 * 设置元素的属性值
 */
function setAttr(node, name, value) {
  if (!node.attrs) node.attrs = [];
  const existing = node.attrs.find(a => a.name === name);
  if (existing) {
    existing.value = value;
  } else {
    node.attrs.push({ name, value });
  }
}

/**
 * 删除元素的属性
 */
function removeAttr(node, name) {
  if (!node.attrs) return;
  node.attrs = node.attrs.filter(a => a.name !== name);
}

/**
 * 提取所有 class 名称集合
 */
function extractAllClasses(root) {
  const classes = new Set();
  walkNode(root, (node) => {
    const cls = getAttr(node, 'class');
    if (cls) {
      cls.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    }
  });
  return [...classes];
}

/**
 * 提取 <body> 子节点（如果没有 body 则返回根节点的子节点）
 */
function extractBodyNodes(document) {
  const html = findElementsByTagName(document, 'html')[0];
  if (html) {
    const body = html.childNodes.find(n => n.nodeName === 'body');
    if (body) return body;
  }
  const body = findElementsByTagName(document, 'body')[0];
  return body || document;
}

/**
 * 提取 <body> 内的 HTML 字符串
 */
function extractBodyHTML(htmlString) {
  const doc = parseHTML(htmlString);
  const body = extractBodyNodes(doc);
  return serializeHTML(body).trim();
}

/**
 * 提取 <style> 标签内的 CSS 文本
 */
function extractStyleTags(root) {
  const styleNodes = findElementsByTagName(root, 'style');
  return styleNodes.map(node => {
    const textNode = node.childNodes && node.childNodes[0];
    return textNode ? textNode.value : '';
  }).join('\n');
}

/**
 * 查找具有指定 class 的元素
 */
function findElementsByClass(root, className) {
  const results = [];
  walkNode(root, (node) => {
    const cls = getAttr(node, 'class');
    if (cls) {
      const classList = cls.split(/\s+/);
      if (classList.includes(className)) {
        results.push(node);
      }
    }
  });
  return results;
}

/**
 * 查找表单字段（input / textarea / select）
 */
function extractFormFields(root) {
  const inputs = findElementsByTagName(root, ['input', 'textarea', 'select']);
  const fields = [];

  for (const node of inputs) {
    const tag = node.nodeName;
    const name = getAttr(node, 'name') || getAttr(node, 'id') || `field${fields.length + 1}`;
    const required = hasAttr(node, 'required');
    const placeholder = getAttr(node, 'placeholder');

    if (tag === 'input') {
      const type = (getAttr(node, 'type') || 'text').toLowerCase();
      fields.push({
        name,
        type: mapInputType(type),
        required,
        placeholder,
        source: 'input',
        node,
      });
    } else if (tag === 'textarea') {
      fields.push({
        name,
        type: 'string',
        required,
        placeholder,
        source: 'textarea',
        node,
      });
    } else if (tag === 'select') {
      const options = [];
      const optionNodes = (node.childNodes || []).filter(n => n.nodeName === 'option');
      for (const opt of optionNodes) {
        const value = getAttr(opt, 'value');
        const textNode = opt.childNodes && opt.childNodes[0];
        const label = textNode ? textNode.value.trim() : '';
        options.push({ value: value !== null ? value : label, label });
      }
      fields.push({
        name,
        type: options.length > 0 ? 'enum' : 'string',
        required,
        options: options.length > 0 ? options : undefined,
        source: 'select',
        node,
      });
    }
  }

  return fields;
}

function mapInputType(htmlType) {
  const map = {
    text: 'string', email: 'string', password: 'string',
    number: 'number', date: 'string', 'datetime-local': 'string',
    time: 'string', checkbox: 'boolean', radio: 'string',
    file: 'File | null', url: 'string', tel: 'string',
    search: 'string', range: 'number', color: 'string', hidden: 'string',
  };
  return map[htmlType] || 'string';
}

/**
 * 检测重复结构（基于 class 组合的频率）
 */
function detectRepeatingStructures(root, threshold = 3) {
  const classPatterns = {};
  const containerTags = ['div', 'section', 'article', 'li', 'card'];

  walkNode(root, (node) => {
    if (!containerTags.includes(node.nodeName)) return;
    const cls = getAttr(node, 'class');
    if (!cls || cls.length < 5) return;

    const sortedClass = cls.split(/\s+/).sort().join(' ');
    if (!classPatterns[sortedClass]) {
      classPatterns[sortedClass] = { count: 0, tag: node.nodeName, classes: cls };
    }
    classPatterns[sortedClass].count++;
  });

  const structures = [];
  for (const [, info] of Object.entries(classPatterns)) {
    if (info.count >= threshold) {
      structures.push({
        type: 'by-class',
        count: info.count,
        tag: info.tag,
        classes: info.classes,
        name: deriveComponentName(info.classes),
      });
    }
  }

  // 表单字段组检测
  const formFields = extractFormFields(root);
  if (formFields.length >= 3) {
    structures.push({
      type: 'form-group',
      count: formFields.length,
      tag: 'form',
      fields: formFields,
      name: 'FormFields',
    });
  }

  return structures.sort((a, b) => b.count - a.count);
}

function deriveComponentName(classes) {
  const keywords = classes.split(/\s+/).filter(c =>
    !c.match(/^(bg-|text-|p-|m-|w-|h-|flex|grid|gap|rounded|shadow|border|font|leading|tracking|opacity|transition|cursor|hover|focus|active|btn|button|container|wrapper|inner|outer)$/)
    && c.length > 2
  );
  if (keywords.length > 0) {
    const name = keywords.slice(0, 2).join('-');
    return name.replace(/[-_\s]+(\w)/g, (_, c) => c.toUpperCase())
      .replace(/^(\w)/, (_, c) => c.toUpperCase());
  }
  return 'ReusableItem';
}

/**
 * 将 HTML 转换为 React 兼容格式（在 AST 级修改属性名）
 */
function convertToReactHTML(root) {
  const replacements = {
    class: 'className', for: 'htmlFor', tabindex: 'tabIndex',
    maxlength: 'maxLength', minlength: 'minLength', readonly: 'readOnly',
    autocomplete: 'autoComplete', onclick: 'onClick', onchange: 'onChange',
    onsubmit: 'onSubmit', oninput: 'onInput', onfocus: 'onFocus', onblur: 'onBlur',
  };

  walkNode(root, (node) => {
    if (!node.attrs) return;
    const newAttrs = [];
    for (const attr of node.attrs) {
      const newName = replacements[attr.name] || attr.name;
      newAttrs.push({ name: newName, value: attr.value });
    }
    node.attrs = newAttrs;

    // 自闭合标签处理
    if (['br', 'hr', 'img', 'input'].includes(node.nodeName)) {
      // parse5 已处理自闭合，React 序列化时需确保正确
    }
  });

  return root;
}

/**
 * 将 HTML 转换为 Vue 兼容格式（在 AST 级修改事件绑定）
 */
function convertToVueHTML(root) {
  const eventReplacements = {
    onclick: '@click', onchange: '@change', onsubmit: '@submit',
    oninput: '@input', onfocus: '@focus', onblur: '@blur',
  };

  walkNode(root, (node) => {
    if (!node.attrs) return;
    const newAttrs = [];
    for (const attr of node.attrs) {
      const newName = eventReplacements[attr.name] || attr.name;
      newAttrs.push({ name: newName, value: attr.value });
    }
    node.attrs = newAttrs;
  });

  return root;
}

// ============================================================
// CSS AST (css-tree)
// ============================================================

/**
 * 解析 CSS 字符串为 css-tree AST
 */
function parseCSS(cssText) {
  try {
    return cssTree.parse(cssText, { parseValue: true, parseAtrulePrelude: true });
  } catch {
    return null;
  }
}

/**
 * 从 CSS AST 中提取设计令牌
 */
function extractDesignTokens(cssText) {
  const ast = parseCSS(cssText);
  if (!ast) return { colors: new Set(), fontSizes: new Set(), spacings: new Set(), borderRadii: new Set() };

  const colors = new Set();
  const fontSizes = new Set();
  const spacings = new Set();
  const borderRadii = new Set();

  cssTree.walk(ast, (node) => {
    if (!node || node.type !== 'Declaration') return;
    const prop = node.property ? node.property.toLowerCase() : '';
    const valueNode = node.value;

    if (isColorProperty(prop)) {
      extractColorValues(valueNode).forEach(c => colors.add(c));
    }
    if (isSpacingProperty(prop)) {
      extractLengthValues(valueNode).forEach(s => spacings.add(s));
    }
    if (prop === 'font-size') {
      extractLengthValues(valueNode).forEach(s => fontSizes.add(s));
    }
    if (prop === 'border-radius') {
      extractLengthValues(valueNode).forEach(s => borderRadii.add(s));
    }
  });

  return { colors, fontSizes, spacings, borderRadii };
}

function walkCSS(root, callback) {
  if (!root) return;
  cssTree.walk(root, callback);
}

function isColorProperty(prop) {
  return /^(color|background-color|background|border-color|fill|stroke|border-top-color|border-right-color|border-bottom-color|border-left-color)$/.test(prop);
}

function isSpacingProperty(prop) {
  return /^(margin|padding|gap|top|left|right|bottom|margin-top|margin-right|margin-bottom|margin-left|padding-top|padding-right|padding-bottom|padding-left)$/.test(prop);
}

function extractColorValues(valueNode) {
  const colors = [];
  if (!valueNode) return colors;

  cssTree.walk(valueNode, (node) => {
    if (node.type === 'Identifier' && ['transparent', 'currentColor'].includes(node.name)) {
      colors.push(node.name);
    } else if (node.type === 'Hash' && node.value) {
      colors.push('#' + node.value);
    } else if (node.type === 'Function') {
      const name = node.name.toLowerCase();
      if (['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'color'].includes(name)) {
        colors.push(cssTree.generate(node));
      }
    }
  });

  return colors;
}

function extractLengthValues(valueNode) {
  const values = [];
  if (!valueNode) return values;

  cssTree.walk(valueNode, (node) => {
    if (node.type === 'Dimension' && node.value && node.unit) {
      values.push(node.value + node.unit);
    } else if (node.type === 'Identifier' && ['auto', 'inherit', 'unset'].includes(node.name)) {
      // skip
    }
  });

  return values;
}

/**
 * 从 HTML 文档中提取所有 CSS（内联 + <style> 标签 + style 属性）
 */
function extractAllCSS(htmlString) {
  const doc = parseHTML(htmlString);
  let cssText = '';

  // <style> 标签
  const styleTags = findElementsByTagName(doc, 'style');
  for (const tag of styleTags) {
    const textNode = tag.childNodes && tag.childNodes[0];
    if (textNode) cssText += '\n' + textNode.value;
  }

  // style 属性
  walkNode(doc, (node) => {
    const style = getAttr(node, 'style');
    if (style) cssText += '\n* { ' + style + ' }';
  });

  return cssText;
}

/**
 * 从 HTML 文档中提取所有 hex 颜色（包括 CSS 和 HTML 属性）
 */
function extractAllColors(htmlString) {
  const css = extractAllCSS(htmlString);
  const tokens = extractDesignTokens(css);
  return [...tokens.colors];
}

// ============================================================
// JS/TS AST (recast + @babel/parser)
// ============================================================

/**
 * 解析 JS/TS 代码为 AST
 */
function parseJS(code, options = {}) {
  try {
    return recast.parse(code, {
      parser: {
        parse: (source) => babelParser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx', 'decorators'],
          ...options,
        }),
      },
    });
  } catch {
    return null;
  }
}

/**
 * 将 AST 序列化回代码字符串
 */
function printJS(ast) {
  try {
    return recast.print(ast).code;
  } catch {
    return '';
  }
}

/**
 * 向已有文件添加 import 声明
 */
function addImport(code, importPath, namedImports, defaultImport) {
  const ast = parseJS(code);
  if (!ast) return code;

  const importDecl = babelParser.parse(`import { ${namedImports.join(', ')} } from '${importPath}'`, {
    sourceType: 'module',
  }).program.body[0];

  ast.program.body.unshift(importDecl);
  return printJS(ast);
}

/**
 * 验证 TS interface 定义是否语法正确
 */
function validateTSInterface(code) {
  try {
    babelParser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript'],
    });
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * 从 TS 代码中提取所有 interface 名称
 */
function extractInterfaceNames(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const names = [];
  recast.visit(ast, {
    visitTSInterfaceDeclaration(path) {
      if (path.node.id && path.node.id.name) {
        names.push(path.node.id.name);
      }
      this.traverse(path);
    },
  });

  return names;
}

// ============================================================
// JS/TS 代码分析（基于 recast AST）
// ============================================================

/**
 * 提取所有函数定义（函数声明 + 函数表达式 + 箭头函数 + 方法）
 * @returns {Array<{name: string, line: number, async: boolean, params: string[]}>}
 */
function extractFunctions(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const fns = [];

  recast.visit(ast, {
    visitFunctionDeclaration(path) {
      const node = path.node;
      fns.push({
        name: node.id?.name || '(anonymous)',
        line: node.loc?.start?.line ?? -1,
        async: !!node.async,
        params: node.params.map(p => p.name || p.left?.name || '(destructured)'),
      });
      this.traverse(path);
    },
    visitFunctionExpression(path) {
      const node = path.node;
      // 只在方法定义或赋值时才有名字
      let name = '(anonymous)';
      if (path.parentPath?.node?.id?.name) name = path.parentPath.node.id.name;
      if (path.parentPath?.node?.key?.name) name = path.parentPath.node.key.name;
      fns.push({
        name,
        line: node.loc?.start?.line ?? -1,
        async: !!node.async,
        params: node.params.map(p => p.name || p.left?.name || '(destructured)'),
      });
      this.traverse(path);
    },
    visitArrowFunctionExpression(path) {
      const node = path.node;
      let name = '(arrow)';
      if (path.parentPath?.node?.id?.name) name = path.parentPath.node.id.name;
      if (path.parentPath?.node?.key?.name) name = path.parentPath.node.key.name;
      fns.push({
        name,
        line: node.loc?.start?.line ?? -1,
        async: !!node.async,
        params: node.params.map(p => p.name || p.left?.name || '(destructured)'),
      });
      this.traverse(path);
    },
  });

  return fns;
}

/**
 * 检测空 catch 块（吞掉异常不处理）
 * @returns {Array<{line: number}>}
 */
function detectEmptyCatches(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  recast.visit(ast, {
    visitCatchClause(path) {
      const body = path.node.body;
      const isEmpty = !body?.body || body.body.length === 0;
      if (isEmpty) {
        results.push({ line: path.node.loc?.start?.line ?? -1 });
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 检测 eval() 调用（代码注入风险）
 * @returns {Array<{line: number, arg: string}>}
 */
function detectEvalUsage(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee;
      if (callee?.type === 'Identifier' && callee.name === 'eval') {
        const arg = path.node.arguments?.[0];
        const isLiteral = arg && (arg.type === 'Literal' || arg.type === 'StringLiteral' || arg.type === 'NumericLiteral');
        results.push({
          line: path.node.loc?.start?.line ?? -1,
          arg: isLiteral ? String(arg.value) : '(dynamic)',
        });
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 检测 console 调用（调试代码残留）
 * @returns {Array<{line: number, method: string}>}
 */
function detectConsoleLogs(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee;
      if (callee?.type === 'MemberExpression' &&
          callee.object?.name === 'console' &&
          callee.property?.name) {
        results.push({
          line: path.node.loc?.start?.line ?? -1,
          method: callee.property.name,
        });
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 检测潜在硬编码密钥（API key / token / password）
 * @returns {Array<{line: number, key: string}>}
 */
function detectHardcodedSecrets(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  const secretPatterns = [
    /api[_-]?key/i,
    /secret/i,
    /password/i,
    /token/i,
    /credential/i,
    /private[_-]?key/i,
  ];

  recast.visit(ast, {
    visitVariableDeclarator(path) {
      const name = path.node.id?.name || '';
      const init = path.node.init;
      // 字符串字面量赋值给疑似密钥变量名
      const isStringLiteral = init && (init.type === 'Literal' || init.type === 'StringLiteral') && typeof init.value === 'string';
      if (isStringLiteral && init.value.length > 8) {
        if (secretPatterns.some(p => p.test(name))) {
          results.push({
            line: path.node.loc?.start?.line ?? -1,
            key: name,
          });
        }
      }
      this.traverse(path);
    },
    visitProperty(path) {
      const key = path.node.key?.name || path.node.key?.value || '';
      const value = path.node.value;
      const isStrLiteral = value && (value.type === 'Literal' || value.type === 'StringLiteral') && typeof value.value === 'string';
      if (isStrLiteral && value.value.length > 8) {
        if (secretPatterns.some(p => p.test(key))) {
          results.push({
            line: path.node.loc?.start?.line ?? -1,
            key: String(key),
          });
        }
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 检测 XSS 风险（innerHTML / document.write / outerHTML）
 * @returns {Array<{line: number, property: string}>}
 */
function detectXSSRisks(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  const dangerousProps = ['innerHTML', 'outerHTML', 'document', 'insertAdjacentHTML'];

  recast.visit(ast, {
    visitAssignmentExpression(path) {
      const left = path.node.left;
      if (left?.type === 'MemberExpression' && left.property?.name) {
        const prop = left.property.name;
        if (dangerousProps.includes(prop) || /innerHTML|outerHTML|insertAdjacentHTML/i.test(prop)) {
          results.push({
            line: path.node.loc?.start?.line ?? -1,
            property: prop,
          });
        }
      }
      this.traverse(path);
    },
    visitCallExpression(path) {
      const callee = path.node.callee;
      if (callee?.type === 'MemberExpression') {
        const objName = callee.object?.name;
        const propName = callee.property?.name;
        if (objName === 'document' && propName === 'write') {
          results.push({
            line: path.node.loc?.start?.line ?? -1,
            property: 'document.write',
          });
        }
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 检测同步 I/O 调用（阻塞主线程）
 * @returns {Array<{line: number, method: string}>}
 */
function detectSyncIO(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];

  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee;
      if (callee?.type === 'MemberExpression') {
        const prop = callee.property?.name || '';
        // fs.readFileSync / fs.writeFileSync / fs.existsSync 等
        if (/Sync$/.test(prop)) {
          results.push({
            line: path.node.loc?.start?.line ?? -1,
            method: prop,
          });
        }
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 提取所有 import 语句
 * @returns {Array<{source: string, specifiers: string[], default: string|null, line: number}>}
 */
function extractImports(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  recast.visit(ast, {
    visitImportDeclaration(path) {
      const node = path.node;
      const specifiers = [];
      let defaultImport = null;

      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportDefaultSpecifier') {
          defaultImport = spec.local?.name || null;
        } else if (spec.type === 'ImportSpecifier') {
          specifiers.push(spec.imported?.name || spec.local?.name);
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          specifiers.push('* as ' + (spec.local?.name || 'ns'));
        }
      }

      results.push({
        source: node.source?.value || '',
        specifiers,
        default: defaultImport,
        line: node.loc?.start?.line ?? -1,
      });
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 提取所有 export 语句
 * @returns {Array<{type: string, name: string, line: number}>}
 */
function extractExports(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  recast.visit(ast, {
    visitExportDefaultDeclaration(path) {
      const decl = path.node.declaration;
      let name = 'default';
      if (decl?.id?.name) name = decl.id.name;
      if (decl?.name) name = decl.name;
      results.push({ type: 'default', name, line: path.node.loc?.start?.line ?? -1 });
      this.traverse(path);
    },
    visitExportNamedDeclaration(path) {
      const decl = path.node.declaration;
      if (decl?.id?.name) {
        results.push({ type: 'named', name: decl.id.name, line: path.node.loc?.start?.line ?? -1 });
      }
      if (decl?.declarations) {
        for (const d of decl.declarations) {
          if (d.id?.name) {
            results.push({ type: 'named', name: d.id.name, line: path.node.loc?.start?.line ?? -1 });
          }
        }
      }
      for (const spec of path.node.specifiers || []) {
        results.push({
          type: 'named',
          name: spec.exported?.name || spec.local?.name || '',
          line: path.node.loc?.start?.line ?? -1,
        });
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 从 Express/Fastify/Koa 路由代码中提取 endpoint
 * @returns {Array<{method: string, path: string, line: number}>}
 */
function extractEndpoints(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee;
      if (callee?.type === 'MemberExpression') {
        const method = callee.property?.name || '';
        const args = path.node.arguments || [];

        // app.get('/path', handler) / router.post('/path', handler)
        if (httpMethods.includes(method.toLowerCase()) && args.length >= 1) {
          const firstArg = args[0];
          if (firstArg && (firstArg.type === 'Literal' || firstArg.type === 'StringLiteral') && typeof firstArg.value === 'string') {
            results.push({
              method: method.toUpperCase(),
              path: firstArg.value,
              line: path.node.loc?.start?.line ?? -1,
            });
          }
        }

        // app.use('/path', router) - 路由挂载
        if (method === 'use' && args.length >= 1) {
          const firstArg = args[0];
          if (firstArg && (firstArg.type === 'Literal' || firstArg.type === 'StringLiteral') && typeof firstArg.value === 'string') {
            results.push({
              method: 'USE',
              path: firstArg.value,
              line: path.node.loc?.start?.line ?? -1,
            });
          }
        }
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 检测未使用的 import（潜在死代码）
 * @returns {Array<{name: string, line: number}>}
 */
function detectUnusedImports(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  // 收集所有 import
  const imports = [];
  recast.visit(ast, {
    visitImportDeclaration(path) {
      for (const spec of path.node.specifiers || []) {
        const name = spec.local?.name;
        if (name) {
          imports.push({ name, line: spec.loc?.start?.line ?? -1 });
        }
      }
      this.traverse(path);
    },
  });

  if (imports.length === 0) return [];

  // 收集所有标识符引用
  const usedNames = new Set();
  recast.visit(ast, {
    visitIdentifier(path) {
      usedNames.add(path.node.name);
      this.traverse(path);
    },
  });

  return imports.filter(imp => !usedNames.has(imp.name));
}

// ============================================================
// 扩展分析 API（用于 dependency-auditor / environment-manager /
// git-workflow / scaffold-runner / spec-bootstrap / spec-userstory-to-design）
// ============================================================

/**
 * 提取 CommonJS require() 调用
 * @returns {Array<{source: string, line: number}>}
 */
function extractRequireCalls(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];
  recast.visit(ast, {
    visitCallExpression(path) {
      const callee = path.node.callee;
      if (callee?.type === 'Identifier' && callee.name === 'require') {
        const arg = path.node.arguments?.[0];
        if (arg && (arg.type === 'Literal' || arg.type === 'StringLiteral') && typeof arg.value === 'string') {
          results.push({
            source: arg.value,
            line: path.node.loc?.start?.line ?? -1,
          });
        }
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 提取所有 process.env.XXX 引用
 * @returns {Array<{key: string, line: number}>}
 */
function extractProcessEnvAccesses(code) {
  const ast = parseJS(code);
  if (!ast) return [];

  const results = [];

  recast.visit(ast, {
    visitMemberExpression(path) {
      const node = path.node;
      // process.env.KEY or process.env['KEY']
      if (node.object?.type === 'MemberExpression' &&
          node.object.object?.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property?.name === 'env') {
        // Direct property: process.env.KEY
        if (node.property?.type === 'Identifier' && node.property.name) {
          results.push({
            key: node.property.name,
            line: node.loc?.start?.line ?? -1,
          });
        }
        // Computed: process.env['KEY']
        if (node.computed && node.property?.type === 'StringLiteral' && node.property.value) {
          results.push({
            key: node.property.value,
            line: node.loc?.start?.line ?? -1,
          });
        }
      }
      this.traverse(path);
    },
  });

  return results;
}

/**
 * 分析 git diff hunks，提取变更行范围
 * @param {string} diffContent - git diff 输出
 * @returns {Array<{file: string, hunks: Array<{startLine: number, lineCount: number, additions: number, deletions: number}>}>}
 */
function analyzeDiffHunks(diffContent) {
  if (!diffContent || typeof diffContent !== 'string') return [];

  const results = [];
  let currentFile = null;
  let currentEntry = null;

  const lines = diffContent.split('\n');
  for (const line of lines) {
    // diff --git a/file b/file
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (fileMatch) {
      if (currentEntry) results.push(currentEntry);
      currentFile = fileMatch[2];
      currentEntry = { file: currentFile, hunks: [] };
      continue;
    }

    // +++ b/file (fallback for unified diff)
    if (line.startsWith('+++ ') && !currentFile) {
      const f = line.replace(/^\+\+\+ b\//, '').replace(/^\/dev\/null$/, '/dev/null');
      if (f !== '/dev/null') {
        if (currentEntry) results.push(currentEntry);
        currentFile = f;
        currentEntry = { file: currentFile, hunks: [] };
      }
      continue;
    }

    // @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1]);
      const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2]) : 1;
      const newStart = parseInt(hunkMatch[3]);
      const newCount = hunkMatch[4] ? parseInt(hunkMatch[4]) : 1;
      if (currentEntry) {
        currentEntry.hunks.push({
          startLine: newStart,
          lineCount: newCount,
          additions: 0,
          deletions: 0,
          _oldStart: oldStart,
          _oldCount: oldCount,
        });
      }
      continue;
    }

    // Count additions/deletions within hunk
    if (currentEntry && currentEntry.hunks.length > 0) {
      const hunk = currentEntry.hunks[currentEntry.hunks.length - 1];
      if (line.startsWith('+') && !line.startsWith('+++')) {
        hunk.additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        hunk.deletions++;
      }
    }
  }

  if (currentEntry) results.push(currentEntry);
  return results;
}

/**
 * 通用代码语法验证
 * @returns {{valid: boolean, error?: string, language: string}}
 */
function validateCodeSyntax(code, lang = 'auto') {
  if (!code || typeof code !== 'string') return { valid: false, error: 'empty input', language: lang };

  // 自动检测语言
  if (lang === 'auto') {
    if (code.trim().startsWith('<') && code.includes('</')) {
      lang = 'html';
    } else if (code.includes('{') && code.includes('}') && /function|const|let|var|import|export|require/.test(code)) {
      lang = 'js';
    } else if (code.includes('{') && code.includes(':') && code.includes(';')) {
      lang = 'css';
    } else {
      lang = 'js';
    }
  }

  try {
    if (lang === 'html') {
      parse5.parse(code, { sourceCodeLocationInfo: true });
      return { valid: true, language: 'html' };
    } else if (lang === 'css') {
      cssTree.parse(code, { parseValue: true });
      return { valid: true, language: 'css' };
    } else {
      // js / ts / jsx
      babelParser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators'],
      });
      return { valid: true, language: 'js' };
    }
  } catch (err) {
    return { valid: false, error: err.message, language: lang };
  }
}

/**
 * 从 Markdown 文本中提取代码块
 * @param {string} markdown - Markdown 文本
 * @returns {Array<{lang: string, code: string, startLine: number}>}
 */
function extractMarkdownCodeBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split('\n');
  const blocks = [];
  let inBlock = false;
  let currentLang = '';
  let currentCode = [];
  let blockStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^```(\w*)/);

    if (fenceMatch && !inBlock) {
      inBlock = true;
      currentLang = fenceMatch[1] || 'text';
      currentCode = [];
      blockStartLine = i + 1;
      continue;
    }

    if (line.trim() === '```' && inBlock) {
      blocks.push({
        lang: currentLang,
        code: currentCode.join('\n'),
        startLine: blockStartLine,
      });
      inBlock = false;
      currentLang = '';
      currentCode = [];
      continue;
    }

    if (inBlock) {
      currentCode.push(line);
    }
  }

  return blocks;
}

/**
 * 从 Markdown 文本中提取标题层级结构
 * @param {string} markdown - Markdown 文本
 * @param {number} maxDepth - 最大深度（1-6），默认 6
 * @returns {Array<{level: number, title: string, line: number, children: Array}>}
 */
function extractMarkdownSections(markdown, maxDepth = 6) {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split('\n');
  const headers = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      if (level <= maxDepth) {
        headers.push({
          level,
          title: match[2].trim(),
          line: i + 1,
          children: [],
        });
      }
    }
  }

  // 构建树形结构
  const root = { children: [] };
  const stack = [root];

  for (const header of headers) {
    while (stack.length > 1 && stack[stack.length - 1].level >= header.level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(header);
    stack.push(header);
  }

  return root.children;
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  // HTML (parse5)
  parseHTML,
  serializeHTML,
  walkNode,
  findElementsByTagName,
  getAttr,
  hasAttr,
  setAttr,
  removeAttr,
  extractAllClasses,
  extractBodyNodes,
  extractBodyHTML,
  extractStyleTags,
  findElementsByClass,
  extractFormFields,
  detectRepeatingStructures,
  convertToReactHTML,
  convertToVueHTML,

  // CSS (css-tree)
  parseCSS,
  extractDesignTokens,
  extractAllCSS,
  extractAllColors,

  // JS/TS (recast + babel)
  parseJS,
  printJS,
  addImport,
  validateTSInterface,
  extractInterfaceNames,

  // JS/TS 代码分析
  extractFunctions,
  detectEmptyCatches,
  detectEvalUsage,
  detectConsoleLogs,
  detectHardcodedSecrets,
  detectXSSRisks,
  detectSyncIO,
  extractImports,
  extractExports,
  extractEndpoints,
  detectUnusedImports,

  // 扩展分析 API
  extractRequireCalls,
  extractProcessEnvAccesses,
  analyzeDiffHunks,
  validateCodeSyntax,
  extractMarkdownCodeBlocks,
  extractMarkdownSections,
};
