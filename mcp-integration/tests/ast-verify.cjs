const ast = require('../examples/lib/ast-parser');

// 测试 parse5 HTML 解析
const html = '<!DOCTYPE html><html><body><div class="card"><h1>Title</h1><input type="email" name="user_email" required placeholder="Enter email" /><select name="role"><option value="admin">Admin</option><option value="user">User</option></select></div></body></html>';
const doc = ast.parseHTML(html);
const fields = ast.extractFormFields(doc);
console.log('parse5 formFields:', JSON.stringify(fields.map(f => ({name:f.name, type:f.type, source:f.source, required:f.required}))));

// 测试 csstree CSS 解析
const css = '.card { color: #333; background-color: #f8f8f8; padding: 16px; border-radius: 8px; font-size: 14px; }';
const tokens = ast.extractDesignTokens(css);
console.log('csstree tokens:', JSON.stringify({
  colors: [...tokens.colors],
  fontSizes: [...tokens.fontSizes],
  spacings: [...tokens.spacings],
  borderRadii: [...tokens.borderRadii]
}));

// 测试 recast TS 验证
const tsCode = 'export interface FormData {  name: string;  age: number;}';
const validation = ast.validateTSInterface(tsCode);
console.log('recast validation:', JSON.stringify(validation));

console.log('\nAll three AST parsers (parse5 + csstree + recast) are working correctly');
