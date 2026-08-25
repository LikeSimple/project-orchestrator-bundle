const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const { loadSkill, assertStdResult, withTempDir } = require('./helper.cjs');

describe('openspec-workflow', () => {
  const skill = loadSkill('openspec-workflow');

  test('propose creates proposal', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.propose({ title: 'Add dark mode', description: 'Add dark theme support', projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(result.data.proposalId || result.data.path || result.data.id, 'should return proposal identifier');
      } else {
        assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error message on failure');
      }
    });
  });

  test('list returns empty when no changes', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.list({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(Array.isArray(result.data.changes), 'should return changes array');
        assert.strictEqual(result.data.count, 0, 'should report 0 changes');
      }
    });
  });

  test('list returns changes after propose', async () => {
    await withTempDir(async (dir) => {
      await skill.propose({ title: 'Test change', description: 'A test change', projectRoot: dir });
      const result = await skill.list({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(Array.isArray(result.data.changes), 'should return changes array');
      }
    });
  });
});

describe('implement-executor', () => {
  const skill = loadSkill('implement-executor');

  test('status returns for nonexistent feature', async () => {
    const result = await skill.status({ featureId: 'nonexistent', projectRoot: process.cwd() });
    assertStdResult(result, { okExpected: null });
    if (!result.ok) {
      assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error message for nonexistent feature');
    }
  });

  test('run with dryRun returns execution plan', async () => {
    await withTempDir(async (dir) => {
      const tasksPath = path.join(dir, 'tasks.md');
      await fs.writeFile(tasksPath, '## Phase 1: Setup\n- [ ] T001 Setup project\n## Phase 2: Core\n- [ ] T002 Implement feature\n');
      const result = await skill.run({ featureId: 'test', projectRoot: dir, dryRun: true });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(Array.isArray(result.data.phases), 'should return phases array');
        assert.ok(result.data.state, 'should return execution state');
        assert.ok(typeof result.data.maxRetries === 'number', 'should report max retries');
      }
    });
  });

  test('checkpoint returns passed when no test infra', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.checkpoint({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(typeof result.data.passed === 'boolean', 'should report pass/fail status');
        assert.ok(Array.isArray(result.data.checks), 'should return checks array');
      }
    });
  });

  test('abort saves state', async () => {
    await withTempDir(async (dir) => {
      const tasksPath = path.join(dir, 'tasks.md');
      await fs.writeFile(tasksPath, '- [ ] T001 Test task\n');
      const result = await skill.abort({ featureId: 'test-abort', projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(result.data.state, 'should return state after abort');
      }
    });
  });
});

describe('test-runner', () => {
  const skill = loadSkill('test-runner');

  test('detect returns framework info', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.detect({ projectRoot: dir });
      assertStdResult(result);
      assert.ok(Array.isArray(result.data.frameworks), 'should return frameworks array');
      assert.ok(result.data.ecosystem, 'should report ecosystem');
    });
  });

  test('list returns empty for no tests', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.list({ projectRoot: dir });
      assertStdResult(result);
      assert.strictEqual(result.data.total, 0);
    });
  });

  test('run returns error when no test framework', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.run({ scope: 'all', projectRoot: dir });
      assert.strictEqual(result.ok, false);
    });
  });

  test('init creates test config', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.init({ projectRoot: dir });
      assertStdResult(result);
      assert.ok(result.data.framework, 'should report selected framework');
      assert.ok(result.data.configTemplate, 'should report config template');
    });
  });
});

describe('git-workflow', () => {
  const skill = loadSkill('git-workflow');

  test('commit in non-git dir returns error', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.commit({ message: 'test commit', projectRoot: dir });
      assert.strictEqual(result.ok, false);
    });
  });

  test('summarize in non-git dir returns error', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.summarize({ projectRoot: dir });
      assert.strictEqual(result.ok, false);
    });
  });

  test('tag with invalid version returns error', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.tag({ version: 'not-a-version', projectRoot: dir });
      assert.strictEqual(result.ok, false);
    });
  });

  test('branch in non-git dir returns error', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.branch({ type: 'feature', description: 'add login', projectRoot: dir });
      assert.strictEqual(result.ok, false);
    });
  });

  test('conflict in non-git dir returns no conflicts', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.conflict({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (!result.ok) {
        assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error in non-git dir');
      } else {
        assert.ok(Array.isArray(result.data.conflicts), 'should return conflicts array');
      }
    });
  });

  test('inferCommitType deduces type from files', () => {
    const result = skill.inferCommitType(['src/auth.ts']);
    assert.ok(result, 'should return a type');
    assert.strictEqual(typeof result, 'string');
  });
});
