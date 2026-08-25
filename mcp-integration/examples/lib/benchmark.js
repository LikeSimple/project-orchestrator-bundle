/**
 * Performance Benchmark Utility
 *
 * Measures execution time, memory usage, and throughput for:
 *   1. Module load time (require) for each Skill and lib
 *   2. AST parsing throughput (parse5 / css-tree / recast / @babel/parser)
 *   3. LLM client availability check and latency
 *   4. Key Skill operations (parsePhases, extractBody, analyzeCodeWithAST, etc.)
 *   5. Memory footprint
 *
 * Output: structured JSON for baseline comparison
 *
 * 用法：
 *   const bench = require('./lib/benchmark');
 *   const result = await bench.runAll({ cwd, iterations });
 *   // or
 *   const result = await bench.runAll({ cwd, iterations, skill: 'implement-executor' });
 */

const path = require('path');
const os = require('os');

// ============================================================
// 计时辅助
// ============================================================

function measureSync(fn, iterations = 10) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1e6); // ms
  }
  return summarize(times);
}

async function measureAsync(fn, iterations = 3) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1e6);
  }
  return summarize(times);
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
    avg: Math.round((sum / times.length) * 100) / 100,
    median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
    samples: times.length,
  };
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
  };
}

// ============================================================
// 样本数据
// ============================================================

const SAMPLES = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>
  <style>
    .container { display: flex; max-width: 1200px; margin: 0 auto; }
    .sidebar { width: 250px; background: #f5f5f5; padding: 20px; }
    .main { flex: 1; padding: 20px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .btn { padding: 8px 16px; border-radius: 4px; cursor: pointer; }
    .btn-primary { background: #007bff; color: white; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { padding: 8px; border-bottom: 1px solid #ddd; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; margin-bottom: 4px; }
    .form-group input, .form-group select {
      width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;
    }
    .alert { padding: 12px; border-radius: 4px; margin-bottom: 12px; }
    .alert-danger { background: #f8d7da; color: #721c24; }
    .alert-success { background: #d4edda; color: #155724; }
    .nav { display: flex; gap: 16px; padding: 12px; background: #333; color: white; }
    .nav a { color: white; text-decoration: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; padding: 24px; border-radius: 8px; max-width: 500px; }
    .spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="#dashboard">Dashboard</a>
    <a href="#users">Users</a>
    <a href="#settings">Settings</a>
    <a href="#reports">Reports</a>
  </nav>
  <div class="container">
    <aside class="sidebar">
      <div class="card">
        <h3>Menu</h3>
        <ul>
          <li><a href="#overview">Overview</a></li>
          <li><a href="#analytics">Analytics</a></li>
          <li><a href="#audit">Audit Log</a></li>
        </ul>
      </div>
      <div class="card">
        <h3>Quick Actions</h3>
        <button class="btn btn-primary" onclick="addUser()">Add User</button>
        <button class="btn" onclick="exportData()">Export</button>
      </div>
    </aside>
    <main class="main">
      <div class="grid">
        <div class="card">
          <h4>Total Users</h4>
          <p class="badge">1,234</p>
        </div>
        <div class="card">
          <h4>Active Sessions</h4>
          <p class="badge">42</p>
        </div>
        <div class="card">
          <h4>Pending Tasks</h4>
          <p class="badge">7</p>
        </div>
      </div>
      <div class="card">
        <h3>User List</h3>
        <table class="table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>Alice</td><td>alice@example.com</td><td>Admin</td><td>Active</td></tr>
            <tr><td>2</td><td>Bob</td><td>bob@example.com</td><td>User</td><td>Inactive</td></tr>
            <tr><td>3</td><td>Charlie</td><td>charlie@example.com</td><td>Editor</td><td>Active</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Add User</h3>
        <form id="userForm">
          <div class="form-group">
            <label>Name</label>
            <input type="text" name="name" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" required>
          </div>
          <div class="form-group">
            <label>Role</label>
            <select name="role">
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>
    </main>
  </div>
</body>
</html>`,

  css: `.container { display: flex; max-width: 1200px; margin: 0 auto; padding: 20px; }
.sidebar { width: 250px; background: #f5f5f5; padding: 20px; border-right: 1px solid #ddd; }
.main { flex: 1; padding: 20px; }
.card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.btn { padding: 8px 16px; border-radius: 4px; cursor: pointer; border: none; font-size: 14px; }
.btn-primary { background: #007bff; color: white; }
.btn-primary:hover { background: #0056b3; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { padding: 8px; border-bottom: 1px solid #ddd; text-align: left; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; margin-bottom: 4px; font-weight: 600; }
.form-group input, .form-group select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
.alert { padding: 12px; border-radius: 4px; margin-bottom: 12px; }
.alert-danger { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
.alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
.nav { display: flex; gap: 16px; padding: 12px 20px; background: #333; color: white; align-items: center; }
.nav a { color: white; text-decoration: none; font-size: 14px; }
.nav a:hover { text-decoration: underline; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; background: #e9ecef; color: #495057; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: white; padding: 24px; border-radius: 8px; max-width: 500px; width: 90%; }
.spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@media (max-width: 768px) { .container { flex-direction: column; } .sidebar { width: 100%; } .grid { grid-template-columns: 1fr; } }`,

  js: `const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/users', authenticateToken, async (req, res) => {
  const result = await pool.query('SELECT id, name, email, role, status FROM users ORDER BY created_at DESC');
  res.json({ users: result.rows });
});

app.post('/api/users', authenticateToken, async (req, res) => {
  const { name, email, role } = req.body;
  const hashedPassword = await bcrypt.hash(req.body.password, 10);
  const result = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
    [name, email, hashedPassword, role]
  );
  res.status(201).json({ user: result.rows[0] });
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, status } = req.body;
  const result = await pool.query(
    'UPDATE users SET name = $1, email = $2, role = $3, status = $4 WHERE id = $5 RETURNING *',
    [name, email, role, status, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ user: result.rows[0] });
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.status(204).send();
});

app.listen(3000, () => console.log('Server running on port 3000'));`,

  tasksMd: `## Phase 1: Setup

- [ ] T001 [P] [US1] Initialize project structure src/index.ts
- [ ] T002 [P] [US1] Configure TypeScript tsconfig.json
- [ ] T003 Setup database connection src/db/connection.ts
- [ ] T004 Create migration system src/db/migrate.ts

## Phase 2: API

- [ ] T005 [US2] Implement login endpoint src/api/auth.ts
- [ ] T006 [US2] Implement JWT middleware src/middleware/auth.ts
- [ ] T007 [US3] Implement user CRUD src/api/users.ts
- [ ] T008 [P] [US3] Add input validation src/middleware/validate.ts
- [x] T009 [US4] Implement role-based access src/middleware/rbac.ts

## Phase 3: Frontend

- [ ] T010 [US5] Create dashboard layout src/components/Layout.tsx
- [ ] T011 [US5] Build user list component src/components/UserList.tsx
- [ ] T012 [P] [US5] Build user form src/components/UserForm.tsx
- [ ] T013 [US6] Add navigation component src/components/Nav.tsx

## Phase 4: Testing

- [ ] T014 Write unit tests for auth src/tests/auth.test.ts
- [ ] T015 [P] Write integration tests src/tests/api.test.ts
- [ ] T016 Write E2E tests src/tests/e2e.test.ts`,
};

// ============================================================
// 基准测试套件
// ============================================================

/**
 * 测量模块加载时间
 */
function benchmarkModuleLoad(modules, baseDir) {
  const results = {};
  for (const { name, requirePath } of modules) {
    const fullPath = path.resolve(baseDir, requirePath);
    const times = [];
    // 清除缓存后测量（仅第一次真正加载）
    try {
      delete require.cache[fullPath];
    } catch { /* may not be cached */ }
    const start = process.hrtime.bigint();
    require(fullPath);
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1e6);
    results[name] = summarize(times);
  }
  return results;
}

/**
 * 测量 AST 解析性能
 */
function benchmarkAST(baseDir) {
  const ast = require(path.resolve(baseDir, 'lib/ast-parser.js'));
  const results = {};

  // parse5 HTML 解析
  results.parseHTML = measureSync(() => {
    ast.parseHTML(SAMPLES.html);
  }, 50);

  // css-tree CSS 解析
  results.parseCSS = measureSync(() => {
    ast.parseCSS ? ast.parseCSS(SAMPLES.css) : require('css-tree').parse(SAMPLES.css);
  }, 50);

  // recast JS 解析
  results.parseJS = measureSync(() => {
    try {
      ast.parseJS ? ast.parseJS(SAMPLES.js) : require('recast').parse(SAMPLES.js);
    } catch { /* fallback */ }
  }, 30);

  // @babel/parser TS 解析
  results.parseTS = measureSync(() => {
    try {
      require('@babel/parser').parse(SAMPLES.js, { sourceType: 'module', plugins: ['typescript'] });
    } catch { /* skip */ }
  }, 30);

  // HTML body 提取
  results.extractBodyHTML = measureSync(() => {
    ast.extractBodyHTML(SAMPLES.html);
  }, 50);

  // HTML class 提取
  results.extractAllClasses = measureSync(() => {
    const doc = ast.parseHTML(SAMPLES.html);
    ast.extractAllClasses(doc);
  }, 50);

  // 表单字段提取
  results.extractFormFields = measureSync(() => {
    const doc = ast.parseHTML(SAMPLES.html);
    ast.extractFormFields(doc);
  }, 50);

  return results;
}

/**
 * 测量 LLM 客户端性能
 */
async function benchmarkLLM(baseDir) {
  const llm = require(path.resolve(baseDir, 'lib/llm-client.js'));
  const results = {};

  // LLM 可用性检查
  results.isAvailable = measureSync(() => {
    llm.isAvailable();
  }, 100);

  // Provider 名称获取
  results.getProviderName = measureSync(() => {
    llm.getProviderName();
  }, 100);

  // LLM 可用性状态
  results.available = llm.isAvailable();
  results.provider = llm.getProviderName();

  return results;
}

/**
 * 测量 Skill 操作性能
 */
async function benchmarkSkillOperations(baseDir) {
  const results = {};

  // implement-executor: parsePhases
  const implExec = require(path.resolve(baseDir, 'skills/implement-executor/index.js'));
  results.parsePhases = measureSync(() => {
    implExec.parsePhases(SAMPLES.tasksMd);
  }, 100);

  // implement-executor: validateCodeSyntax
  results.validateCodeSyntax = measureSync(() => {
    implExec.validateCodeSyntax(SAMPLES.js);
  }, 50);

  // implement-executor: cleanGeneratedCode
  results.cleanGeneratedCode = measureSync(() => {
    implExec.cleanGeneratedCode('```javascript\nconst x = 1;\n```');
  }, 50);

  // html-converter: extractBody + extractAllClasses + extractFormFields (via AST)
  const ast = require(path.resolve(baseDir, 'lib/ast-parser.js'));
  results.htmlConvert_extractBody = measureSync(() => {
    ast.extractBodyHTML(SAMPLES.html);
  }, 50);
  results.htmlConvert_extractClasses = measureSync(() => {
    const doc = ast.parseHTML(SAMPLES.html);
    ast.extractAllClasses(doc);
  }, 50);
  results.htmlConvert_extractFormFields = measureSync(() => {
    const doc = ast.parseHTML(SAMPLES.html);
    ast.extractFormFields(doc);
  }, 50);

  return results;
}

/**
 * 测量内存占用
 */
function benchmarkMemory(baseDir) {
  const before = getMemoryUsage();

  // 加载所有 15 个 Skill
  const skillNames = [
    'api-contract', 'code-patterns', 'debug-helper', 'dependency-auditor',
    'environment-manager', 'git-workflow', 'html-converter', 'implement-executor',
    'openspec-workflow', 'review-checklist', 'scaffold-runner', 'spec-bootstrap',
    'spec-userstory-to-design', 'test-runner', 'ui-design',
  ];

  for (const name of skillNames) {
    try {
      require(path.resolve(baseDir, `skills/${name}/index.js`));
    } catch (e) {
      // 某些 Skill 可能依赖外部模块，加载失败不影响基准
    }
  }

  const after = getMemoryUsage();
  return {
    before,
    after,
    delta: {
      heapUsedMB: Math.round((after.heapUsedMB - before.heapUsedMB) * 100) / 100,
      heapTotalMB: Math.round((after.heapTotalMB - before.heapTotalMB) * 100) / 100,
      rssMB: Math.round((after.rssMB - before.rssMB) * 100) / 100,
    },
    loadedSkills: skillNames.length,
  };
}

// ============================================================
// 主入口
// ============================================================

async function runAll({ cwd, iterations = 10, skill = null } = {}) {
  const baseDir = cwd || path.resolve(__dirname, '..');
  const startedAt = new Date().toISOString();
  const nodeVersion = process.version;
  const platform = `${os.type()} ${os.release()} ${os.arch()}`;
  const cpuModel = os.cpus()[0]?.model || 'unknown';
  const cpuCores = os.cpus().length;
  const totalMemGB = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100;

  // 1. 模块加载时间
  const moduleLoad = benchmarkModuleLoad([
    { name: 'ast-parser', requirePath: 'lib/ast-parser.js' },
    { name: 'llm-client', requirePath: 'lib/llm-client.js' },
    { name: 'implement-executor', requirePath: 'skills/implement-executor/index.js' },
    { name: 'html-converter', requirePath: 'skills/html-converter/index.js' },
    { name: 'test-runner', requirePath: 'skills/test-runner/index.js' },
    { name: 'spec-bootstrap', requirePath: 'skills/spec-bootstrap/index.js' },
    { name: 'code-patterns', requirePath: 'skills/code-patterns/index.js' },
    { name: 'debug-helper', requirePath: 'skills/debug-helper/index.js' },
  ], baseDir);

  // 2. AST 解析性能
  const astBenchmark = benchmarkAST(baseDir);

  // 3. LLM 客户端性能
  const llmBenchmark = await benchmarkLLM(baseDir);

  // 4. Skill 操作性能
  const skillOperations = await benchmarkSkillOperations(baseDir);

  // 5. 内存占用
  const memory = benchmarkMemory(baseDir);

  const completedAt = new Date().toISOString();
  const totalTimeMs = Date.now() - new Date(startedAt).getTime();

  return {
    metadata: {
      version: 'v1.0',
      startedAt,
      completedAt,
      totalTimeMs,
      nodeVersion,
      platform,
      cpuModel,
      cpuCores,
      totalMemGB,
      iterations,
    },
    moduleLoad,
    astBenchmark,
    llmBenchmark,
    skillOperations,
    memory,
    summary: {
      fastestAST: Object.entries(astBenchmark).sort((a, b) => a[1].avg - b[1].avg)[0]?.[0],
      slowestAST: Object.entries(astBenchmark).sort((a, b) => b[1].avg - a[1].avg)[0]?.[0],
      llmAvailable: llmBenchmark.available,
      llmProvider: llmBenchmark.provider,
      memoryDeltaMB: memory.delta.heapUsedMB,
      totalSkillsLoaded: memory.loadedSkills,
    },
  };
}

module.exports = {
  runAll,
  measureSync,
  measureAsync,
  getMemoryUsage,
  benchmarkModuleLoad,
  benchmarkAST,
  benchmarkLLM,
  benchmarkSkillOperations,
  benchmarkMemory,
  SAMPLES,
};
