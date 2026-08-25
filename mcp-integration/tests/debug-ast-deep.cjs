/**
 * 深度调试 - 检查 extractEndpoints 的内部行为
 */

const path = require('path');
const recast = require('recast');
const babelParser = require('@babel/parser');

const code = `
const express = require('express');
const router = express.Router();

router.get('/users', handler);
router.post('/users', handler);
`;

function parseJS(code) {
  try {
    return recast.parse(code, {
      parser: {
        parse: (source) => babelParser.parse(source, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx', 'decorators'],
        }),
      },
    });
  } catch (e) {
    console.error('Parse error:', e.message);
    return null;
  }
}

const ast = parseJS(code);
console.log('AST 解析成功:', !!ast);

const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
let callCount = 0;
let memberCallCount = 0;

recast.visit(ast, {
  visitCallExpression(path) {
    callCount++;
    const callee = path.node.callee;
    console.log(`\nCall #${callCount}:`);
    console.log(`  callee.type: ${callee.type}`);
    
    if (callee.type === 'MemberExpression') {
      memberCallCount++;
      const obj = callee.object;
      const prop = callee.property;
      
      console.log(`  object.type: ${obj.type}`);
      console.log(`  object.name: ${obj.name || '(N/A)'}`);
      console.log(`  property.type: ${prop.type}`);
      console.log(`  property.name: ${prop.name || '(N/A)'}`);
      
      const method = prop.name || '';
      console.log(`  method name: "${method}"`);
      console.log(`  is HTTP method: ${httpMethods.includes(method.toLowerCase())}`);
      
      const args = path.node.arguments || [];
      console.log(`  args.length: ${args.length}`);
      
      if (args.length > 0) {
        console.log(`  args[0].type: ${args[0].type}`);
        if (args[0].type === 'Literal' || args[0].type === 'StringLiteral') {
          console.log(`  args[0].value: "${args[0].value}"`);
        }
      }
    }
    
    this.traverse(path);
  },
});

console.log(`\n=== 统计 ===`);
console.log(`总 CallExpression: ${callCount}`);
console.log(`MemberExpression 调用: ${memberCallCount}`);
