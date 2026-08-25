/**
 * 调试脚本 - 检查 ast.extractEndpoints 的行为
 */

const path = require('path');
const ast = require(path.join(__dirname, '..', 'examples', 'lib', 'ast-parser.js'));

const code1 = `
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/users', userController.listUsers);
router.get('/users/:id', userController.getUser);
router.post('/users', userController.createUser);
router.put('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);

module.exports = router;
`;

console.log('=== 测试 1: CommonJS Express Router ===');
const parsed1 = ast.parseJS(code1);
console.log('parseJS 结果:', parsed1 ? '成功' : '失败');
const endpoints1 = ast.extractEndpoints(code1);
console.log('提取到的 endpoints:', JSON.stringify(endpoints1, null, 2));
console.log('数量:', endpoints1.length);

const code2 = `
import express from 'express';
const app = express();

app.get('/api/v1/items', (req, res) => {
  res.json({ items: [] });
});

app.post('/api/v1/items', (req, res) => {
  res.status(201).json({ id: 1 });
});
`;

console.log('\n=== 测试 2: ES Module Express ===');
const parsed2 = ast.parseJS(code2);
console.log('parseJS 结果:', parsed2 ? '成功' : '失败');
const endpoints2 = ast.extractEndpoints(code2);
console.log('提取到的 endpoints:', JSON.stringify(endpoints2, null, 2));
console.log('数量:', endpoints2.length);
