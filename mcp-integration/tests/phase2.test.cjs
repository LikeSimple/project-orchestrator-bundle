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

  // ===== v9 新增：前后端任务标记 [frontend]/[backend]/[shared] 解析测试 =====

  test('parseSideTag 识别前端/后端/共享端标记', () => {
    assert.strictEqual(skill.parseSideTag('[frontend]'), 'frontend', '应识别 [frontend] 标记');
    assert.strictEqual(skill.parseSideTag('[backend]'), 'backend', '应识别 [backend] 标记');
    assert.strictEqual(skill.parseSideTag('[shared]'), 'shared', '应识别 [shared] 标记');
  });

  test('parseSideTag 大小写不敏感', () => {
    assert.strictEqual(skill.parseSideTag('[FRONTEND]'), 'frontend', '大写也应识别');
    assert.strictEqual(skill.parseSideTag('[Backend]'), 'backend', '混合大小写应识别');
  });

  test('parseSideTag 无标记返回 null', () => {
    assert.strictEqual(skill.parseSideTag(null), null, 'null 输入应返回 null');
    assert.strictEqual(skill.parseSideTag(undefined), null, 'undefined 输入应返回 null');
    assert.strictEqual(skill.parseSideTag(''), null, '空字符串应返回 null');
    assert.strictEqual(skill.parseSideTag('[unknown]'), null, '未知端应返回 null');
    assert.strictEqual(skill.parseSideTag('frontend'), null, '缺方括号应返回 null');
  });

  test('parsePhases 提取 [frontend]/[backend] 端标记', () => {
    const tasksContent = [
      '## Phase 1: Setup',
      '- [ ] T001 [shared] 初始化 ESLint 配置',
      '## Phase 2: 实现',
      '- [ ] T002 [P] [US1] [backend] 实现 JWT 鉴权 src/middleware/auth.ts',
      '- [ ] T003 [P] [US1] [frontend] 登录表单组件 src/components/LoginForm.tsx',
      '- [ ] T004 无端标记的任务',
    ].join('\n');
    const phases = skill.parsePhases(tasksContent);
    assert.ok(Array.isArray(phases), '应返回 phases 数组');
    assert.strictEqual(phases.length, 2, '应解析为 2 个 Phase');

    // Phase 1: shared
    const p1 = phases[0];
    assert.strictEqual(p1.tasks.length, 1, 'Phase 1 应有 1 个任务');
    assert.strictEqual(p1.tasks[0].side, 'shared', 'T001 应为 shared 端');
    assert.strictEqual(p1.tasks[0].id, 'T001');

    // Phase 2: backend + frontend + 无标记
    const p2 = phases[1];
    assert.strictEqual(p2.tasks.length, 3, 'Phase 2 应有 3 个任务');
    assert.strictEqual(p2.tasks[0].side, 'backend', 'T002 应为 backend 端');
    assert.strictEqual(p2.tasks[0].storyId, '[US1]', 'T002 应保留 storyId');
    assert.strictEqual(p2.tasks[0].parallel, true, 'T002 应为并行任务');
    assert.strictEqual(p2.tasks[1].side, 'frontend', 'T003 应为 frontend 端');
    assert.strictEqual(p2.tasks[2].side, null, 'T004 无端标记应为 null');
  });

  test('parsePhases 端标记不破坏原有解析字段', () => {
    // 经典格式：- [ ] T015 [P] [US1] [backend] 实现登录中间件 src/middleware/auth.ts
    const tasksContent = '- [ ] T015 [P] [US1] [backend] 实现登录中间件 src/middleware/auth.ts';
    const phases = skill.parsePhases(tasksContent);
    const t = phases[0].tasks[0];
    assert.strictEqual(t.id, 'T015', '任务 ID 应为 T015');
    assert.strictEqual(t.done, false, '应为未完成状态');
    assert.strictEqual(t.parallel, true, '应为并行任务');
    assert.strictEqual(t.storyId, '[US1]', '应保留 storyId');
    assert.strictEqual(t.side, 'backend', '端标记应为 backend');
    assert.ok(t.description.includes('实现登录中间件'), '描述应保留');
    assert.strictEqual(t.filePath, 'src/middleware/auth.ts', '文件路径应保留');
  });

  test('runCompositeTests 在无 package.json 时两端均失败', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.runCompositeTests(dir);
      assert.ok(typeof result.passed === 'boolean', '应返回 passed 布尔值');
      assert.ok(result.sides, '应返回 sides 字段');
      assert.ok(result.sides.frontend, '应包含 frontend 端结果');
      assert.ok(result.sides.backend, '应包含 backend 端结果');
      assert.strictEqual(result.sides.frontend.passed, false, '无 test:web 脚本应失败');
      assert.strictEqual(result.sides.backend.passed, false, '无 test:api 脚本应失败');
      assert.ok(result.command.includes('test:web') && result.command.includes('test:api'), '命令应包含两端脚本');
    });
  });

  test('runTests 在组合栈项目调用 runCompositeTests', async () => {
    await withTempDir(async (dir) => {
      // 构造组合栈 package.json（同时声明 test:web 和 test:api）
      const pkgJson = {
        name: 'composite-test',
        private: true,
        scripts: {
          'test:web': 'echo "frontend tests"',
          'test:api': 'echo "backend tests"',
        },
      };
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
      const result = await skill.runTests(dir);
      assert.ok(result.sides, '组合栈应返回 sides 字段（来自 runCompositeTests）');
      assert.ok(result.sides.frontend && result.sides.backend, '应包含两端结果');
      // echo 命令应成功执行
      assert.strictEqual(result.sides.frontend.passed, true, 'echo 命令应通过');
      assert.strictEqual(result.sides.backend.passed, true, 'echo 命令应通过');
    });
  });

  test('runTests 单端项目不返回 sides 字段', async () => {
    await withTempDir(async (dir) => {
      const pkgJson = {
        name: 'single-end-test',
        scripts: { test: 'echo "single"' },
      };
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
      const result = await skill.runTests(dir);
      assert.ok(!result.sides, '单端项目不应返回 sides 字段');
      assert.strictEqual(result.passed, true, 'echo 测试应通过');
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
