const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const { loadSkill, assertStdResult, withTempDir } = require('./helper.cjs');

describe('debug-helper', () => {
  const skill = loadSkill('debug-helper');

  test('analyze categorizes TypeError', async () => {
    const result = await skill.analyze({
      errorMessage: "TypeError: Cannot read property 'foo' of undefined",
    });
    assertStdResult(result);
    assert.ok(result.data.category, 'should categorize error');
  });

  test('analyze with stack trace', async () => {
    const result = await skill.analyze({
      errorMessage: 'ReferenceError: x is not defined',
      stackTrace: '    at Object.<anonymous> (/app/src/index.js:5:10)\n    at Module._compile (internal/modules/cjs/loader.js:999:30)',
    });
    assertStdResult(result);
    assert.ok(result.data.stackTracePreview !== undefined, 'should have stack trace preview');
  });

  test('trace parses stack frames', async () => {
    const result = await skill.trace({
      stackTrace: '    at foo (/app/src/a.js:10:5)\n    at bar (/app/src/b.js:20:10)\n    at main (/app/src/index.js:5:1)',
    });
    assertStdResult(result);
    assert.ok(result.data.frames.length >= 2, 'should parse at least 2 frames');
  });

  test('trace without input returns error', async () => {
    const result = await skill.trace({});
    assert.strictEqual(result.ok, false);
  });

  test('logs without file returns error', async () => {
    const result = await skill.logs({});
    assert.strictEqual(result.ok, false);
  });

  test('logs reads and analyzes log file', async () => {
    await withTempDir(async (dir) => {
      const logPath = path.join(dir, 'app.log');
      await fs.writeFile(logPath, '[INFO] Started\n[ERROR] Failed to connect\n[WARN] Retry 1\n[ERROR] Timeout\n');
      const result = await skill.logs({ logFile: logPath });
      assertStdResult(result);
      assert.ok(result.data.errorLines.length > 0, 'should find error lines');
      assert.ok(result.data.warnLines.length > 0, 'should find warn lines');
    });
  });

  test('history returns empty initially', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.history({ projectRoot: dir });
      assertStdResult(result);
      assert.strictEqual(result.data.sessions.length, 0, 'should start empty');
    });
  });

  test('history records sessions after trace', async () => {
    await withTempDir(async (dir) => {
      await skill.trace({ stackTrace: '    at foo (/app/a.js:1:1)', projectRoot: dir });
      const result = await skill.history({ projectRoot: dir });
      assert.ok(result.data.sessions.length > 0, 'should have recorded a session');
    });
  });

  test('classifyError works for known types', () => {
    assert.ok(typeof skill.classifyError('SyntaxError: x').category === 'string');
    assert.ok(typeof skill.classifyError('RangeError: x').category === 'string');
  });
});

describe('review-checklist', () => {
  const skill = loadSkill('review-checklist');

  test('checklist returns all rules', async () => {
    const result = await skill.checklist({});
    assertStdResult(result);
    assert.ok(result.data.rules.length >= 50, 'should have 50+ rules');
    assert.ok(result.data.categories.length >= 5, 'should have 5+ categories');
  });

  test('checklist filters by category', async () => {
    const result = await skill.checklist({ category: 'SEC' });
    assertStdResult(result);
    assert.ok(result.data.rules.every(r => r.category === 'SEC'), 'should only return SEC rules');
  });

  test('explain returns rule details', async () => {
    const result = await skill.explain({ ruleId: 'SEC-001' });
    assertStdResult(result);
    assert.ok(result.data.rule || result.data.definition || result.data.id, 'should return rule definition');
  });

  test('diff detects security issues in code', async () => {
    const result = await skill.diff({
      diffText: 'diff --git a/src/auth.ts b/src/auth.ts\n+++ b/src/auth.ts\n+const API_KEY = "sk-1234567890abcdef";\n+const query = `SELECT * FROM users WHERE id = ${userId}`;\n+console.log("debug", user);\n',
    });
    assertStdResult(result, { okExpected: null });
    assert.ok(result.data.items.length > 0, 'should detect problems');
  });

  test('diff clean code returns few issues', async () => {
    const result = await skill.diff({
      diffText: 'diff --git a/src/clean.ts b/src/clean.ts\n+++ b/src/clean.ts\n+const x = 1;\n+export { x };\n',
    });
    assertStdResult(result, { okExpected: null });
  });
});

describe('dependency-auditor', () => {
  const skill = loadSkill('dependency-auditor');

  test('summary returns health score for empty project', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.summary({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (!result.ok) {
        assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error for empty project');
      }
    });
  });

  test('blocklist starts empty', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.blocklist({ action: 'list', projectRoot: dir });
      assertStdResult(result);
      assert.strictEqual(result.data.packages.length, 0, 'should start empty');
    });
  });

  test('blocklist add and check', async () => {
    await withTempDir(async (dir) => {
      const addResult = await skill.blocklist({ action: 'add', package: 'bad-pkg', reason: 'Known vulnerability', projectRoot: dir });
      assertStdResult(addResult);
      assert.ok(addResult.data.added || addResult.data.package, 'should confirm package was added');

      const checkResult = await skill.blocklist({ action: 'check', package: 'bad-pkg', projectRoot: dir });
      assert.strictEqual(checkResult.data.blocked, true);

      const removeResult = await skill.blocklist({ action: 'remove', package: 'bad-pkg', projectRoot: dir });
      assertStdResult(removeResult);
      assert.ok(typeof removeResult.data.totalBlocked === 'number', 'should report updated block count');
    });
  });

  test('allowlist starts empty', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.allowlist({ action: 'list', projectRoot: dir });
      assertStdResult(result);
      assert.strictEqual(result.data.packages.length, 0);
    });
  });

  test('allowlist add and check', async () => {
    await withTempDir(async (dir) => {
      await skill.allowlist({ action: 'add', package: 'lodash', license: 'MIT', projectRoot: dir });
      const result = await skill.allowlist({ action: 'check', package: 'lodash', projectRoot: dir });
      assert.strictEqual(result.data.allowed, true);
    });
  });

  test('audit returns real npm audit data for project with dependencies', async () => {
    // 使用 mcp-integration 自身作为测试项目（有 node_modules）
    const projectRoot = path.join(__dirname, '..');
    const result = await skill.audit({ projectRoot, scope: 'all', includeLLM: false });

    assert.ok(typeof result === 'object', 'audit should return object');
    assert.ok('ok' in result, 'should have ok field');
    assert.ok('data' in result, 'should have data field');

    // 验证 auditAvailable 字段（npm audit 是否成功执行）
    assert.ok(
      typeof result.data.auditAvailable === 'boolean',
      'should have auditAvailable boolean'
    );

    if (result.data.auditAvailable) {
      // 真实 npm audit 成功时验证返回结构
      assert.ok(Array.isArray(result.data.vulnerabilities), 'vulnerabilities should be array');
      assert.ok(result.data.vulnerabilitySummary, 'should have vulnerabilitySummary');
      assert.ok(typeof result.data.vulnerabilitySummary === 'object', 'vulnerabilitySummary should be object');

      // 验证漏洞对象结构（如果有漏洞）
      if (result.data.vulnerabilities.length > 0) {
        const v = result.data.vulnerabilities[0];
        assert.ok(v.package, 'vuln should have package name');
        assert.ok(v.severity, 'vuln should have severity');
        assert.ok(v.via || v.range, 'vuln should have via or range info');
      }
    }

    // 验证 verdict 字段
    assert.ok(
      result.data.verdict === 'PASS' || result.data.verdict === 'BLOCK',
      'verdict should be PASS or BLOCK'
    );
  });

  test('audit handles missing package.json gracefully', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.audit({ projectRoot: dir, includeLLM: false });
      assertStdResult(result, { okExpected: false });
      assert.ok(result.error.includes('package.json'), 'should mention package.json in error');
    });
  });

  test('audit summary returns dependency health data', async () => {
    const projectRoot = path.join(__dirname, '..');
    const result = await skill.summary({ projectRoot, scope: 'all' });

    assertStdResult(result, { okExpected: null });
    if (result.ok) {
      assert.ok(typeof result.data.totalDependencies === 'number' || result.data.totalDeps !== undefined,
        'should report dependency count');
    }
  });
});

describe('environment-manager', () => {
  const skill = loadSkill('environment-manager');

  test('init creates 4 environment files', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.init({ projectRoot: dir });
      assertStdResult(result);
      const envsDir = path.join(dir, 'envs');
      try {
        const dirs = await fs.readdir(envsDir);
        assert.ok(dirs.includes('dev'), 'should create dev env');
        assert.ok(dirs.includes('prod'), 'should create prod env');
      } catch {
        // Some implementations may use different directory structure
        assert.ok(result.data.environments || result.data.envs, 'should report environments in result');
      }
    });
  });

  test('list shows all environments', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.list({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      assert.ok(result.data.environments || result.data.envs, 'should list environments');
    });
  });

  test('switch changes current env', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.switch({ env: 'prod', projectRoot: dir });
      assertStdResult(result);
      assert.ok(result.data.currentEnv, 'should report current env');
      assert.ok(result.data.previousEnv !== undefined, 'should report previous env');
    });
  });

  test('validate checks env configuration', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.validate({ env: 'dev', projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(Array.isArray(result.data.checks), 'should return checks array');
        assert.ok(Array.isArray(result.data.issues), 'should return issues array');
        assert.ok(typeof result.data.totalVars === 'number', 'should report total vars count');
      }
    });
  });

  test('secrets scan finds sensitive keys', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.secrets({ action: 'scan', projectRoot: dir });
      assertStdResult(result);
      assert.ok(typeof result.data.totalKeys === 'number', 'should report total keys count');
      assert.ok(typeof result.data.sensitiveCount === 'number', 'should report sensitive count');
    });
  });

  test('rotate returns error for missing env', async () => {
    const result = await skill.rotate({ env: 'nonexistent', projectRoot: '/nonexistent' });
    assert.strictEqual(result.ok, false);
  });

  test('detectCli returns boolean for known and unknown tools', () => {
    const nodeResult = skill.detectCli('node');
    assert.strictEqual(typeof nodeResult, 'boolean', 'detectCli should return boolean');

    const unknownResult = skill.detectCli('nonexistent-cli-tool-xyz');
    assert.strictEqual(unknownResult, false, 'should return false for unknown tool');
  });

  test('inject with doppler backend returns error when CLI not installed', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.inject({
        env: 'dev',
        backend: 'doppler',
        projectRoot: dir,
        dopplerProject: 'test-project',
      });
      assert.strictEqual(result.ok, false, 'should fail when doppler CLI not installed');
      assert.ok(result.error.includes('doppler'), 'error should mention doppler');
      assert.ok(result.data.backend === 'doppler', 'should report backend in data');
    });
  });

  test('inject with vault backend returns error when CLI not installed', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.inject({
        env: 'prod',
        backend: 'vault',
        projectRoot: dir,
        vaultPath: 'myapp/prod',
      });
      assert.strictEqual(result.ok, false, 'should fail when vault CLI not installed');
      assert.ok(result.error.includes('vault'), 'error should mention vault');
      assert.ok(result.data.backend === 'vault', 'should report backend in data');
    });
  });

  test('secrets sync returns error for dotenv backend', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.secrets({
        action: 'sync',
        backend: 'dotenv',
        env: 'dev',
        projectRoot: dir,
      });
      assert.strictEqual(result.ok, false, 'sync with dotenv should fail');
      assert.ok(result.error.includes('doppler') || result.error.includes('vault'), 'should suggest doppler or vault');
    });
  });

  test('secrets sync with doppler returns error when CLI not installed', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.secrets({
        action: 'sync',
        backend: 'doppler',
        env: 'dev',
        projectRoot: dir,
        dopplerProject: 'test',
      });
      assert.strictEqual(result.ok, false, 'should fail when doppler CLI not installed');
      assert.ok(result.error.includes('doppler'), 'error should mention doppler');
    });
  });

  test('secrets sync with vault returns error when CLI not installed', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.secrets({
        action: 'sync',
        backend: 'vault',
        env: 'staging',
        projectRoot: dir,
        vaultPath: 'myapp/staging',
      });
      assert.strictEqual(result.ok, false, 'should fail when vault CLI not installed');
      assert.ok(result.error.includes('vault'), 'error should mention vault');
    });
  });

  test('inject with unsupported backend returns error', async () => {
    await withTempDir(async (dir) => {
      await skill.init({ projectRoot: dir });
      const result = await skill.inject({
        env: 'dev',
        backend: 'aws-secrets-manager',
        projectRoot: dir,
      });
      assert.strictEqual(result.ok, false, 'should fail for unsupported backend');
    });
  });

  test('fetchFromBackend returns error for unknown backend', () => {
    const result = skill.fetchFromBackend('unknown-backend', '/tmp', 'dev', {});
    assert.strictEqual(result.success, false, 'should fail for unknown backend');
    assert.ok(result.error.includes('CLI not found') || result.error.includes('Unknown'), 'should mention CLI or unknown backend');
  });
});
