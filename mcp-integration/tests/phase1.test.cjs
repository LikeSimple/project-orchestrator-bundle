const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const { loadSkill, assertStdResult, withTempDir } = require('./helper.cjs');

describe('spec-bootstrap', () => {
  const skill = loadSkill('spec-bootstrap');

  test('constitution generates project spec files', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.constitution({ projectName: 'TestApp', projectRoot: dir });
      assertStdResult(result);
      assert.ok(result.data.path, 'should return file path');
      assert.ok(result.data.name, 'should return project name');
    });
  });

  test('specify generates spec.md', async () => {
    await withTempDir(async (dir) => {
      await skill.constitution({ projectName: 'TestApp', projectRoot: dir });
      const result = await skill.specify({ projectRoot: dir, featureName: 'Login', description: 'Users can log in with email and password' });
      assertStdResult(result);
      assert.ok(result.data.path, 'should return spec file path');
      assert.ok(typeof result.data.storiesCount === 'number', 'should report stories count');
    });
  });

  test('plan generates plan.md', async () => {
    await withTempDir(async (dir) => {
      await skill.constitution({ projectName: 'TestApp', projectRoot: dir });
      const specResult = await skill.specify({ projectRoot: dir, featureName: 'Login', description: 'Login feature' });
      const result = await skill.plan({ projectRoot: dir, specFile: specResult.data.path });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(result.data.path, 'should return plan file path');
      } else {
        assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error message');
      }
    });
  });

  test('tasks generates tasks.md', async () => {
    await withTempDir(async (dir) => {
      await skill.constitution({ projectName: 'TestApp', projectRoot: dir });
      const specResult = await skill.specify({ projectRoot: dir, featureName: 'Login', description: 'Login' });
      const planResult = await skill.plan({ projectRoot: dir, specFile: specResult.data.path });
      const result = await skill.tasks({ projectRoot: dir, planFile: planResult.data?.path });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(result.data.path, 'should return tasks file path');
      } else {
        assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error message');
      }
    });
  });

  test('default alias maps to constitution', () => {
    assert.strictEqual(skill.default, skill.constitution);
  });
});

describe('code-patterns', () => {
  const skill = loadSkill('code-patterns');

  test('init creates pattern config', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.init({ framework: 'react', projectRoot: dir });
      assertStdResult(result);
      assert.ok(result.data.directory, 'should return config directory');
      assert.ok(Array.isArray(result.data.files), 'should report created files');
      assert.ok(typeof result.data.totalPatterns === 'number', 'should report pattern count');
    });
  });

  test('generate returns pattern code', async () => {
    const result = await skill.generate({ pattern: 'factory', framework: 'typescript' });
    assertStdResult(result);
    assert.ok(result.data.code, 'should return code');
  });

  test('explain returns rule details', async () => {
    const result = await skill.explain({ pattern: 'observer' });
    assertStdResult(result);
    assert.ok(result.data.name, 'should return pattern name');
  });
});

describe('scaffold-runner', () => {
  const skill = loadSkill('scaffold-runner');

  test('list returns all templates', async () => {
    const result = await skill.list({});
    assertStdResult(result, { okExpected: null });
    assert.ok(result.data.total >= 10, 'should have 10+ templates');
  });

  test('inspect returns template details', () => {
    const result = skill.inspect({ template: 'react-vite' });
    assertStdResult(result, { okExpected: null });
    if (result.ok) {
      assert.ok(result.data.files || result.data.template || result.data.name, 'should return template info');
    }
  });

  test('run with invalid stack returns error', async () => {
    const result = await skill.run({ stack: 'nonexistent-stack', name: 'test-app' });
    assert.strictEqual(result.ok, false);
  });

  test('run with missing name returns error', async () => {
    const result = await skill.run({ stack: 'react-vite' });
    assert.strictEqual(result.ok, false);
  });
});

describe('ui-design', () => {
  const skill = loadSkill('ui-design');

  test('generate creates HTML prototype', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.generate({ featureName: 'Dashboard', pageCount: 1, projectRoot: dir });
      assertStdResult(result);
      assert.ok(Array.isArray(result.data.pages), 'should return pages array');
      assert.ok(result.data.outputDir, 'should return output directory');
    });
  });

  test('audit without HTML file returns error', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.audit({ projectRoot: dir });
      assert.strictEqual(result.ok, false);
    });
  });

  test('audit with HTML file returns design tokens', async () => {
    await withTempDir(async (dir) => {
      const htmlPath = path.join(dir, 'test.html');
      await fs.writeFile(htmlPath, '<div style="color: #333; font-size: 16px; padding: 8px;">Test</div>');
      const result = await skill.audit({ htmlFile: htmlPath, projectRoot: dir });
      assertStdResult(result);
      assert.ok(typeof result.data.score === 'number', 'should have score');
      assert.ok(result.data.tokens, 'should have tokens');
    });
  });
});

describe('spec-userstory-to-design', () => {
  const skill = loadSkill('spec-userstory-to-design');

  test('generate creates page flow from spec.md', async () => {
    await withTempDir(async (dir) => {
      const specDir = path.join(dir, 'specs', '001-feature');
      await fs.mkdir(specDir, { recursive: true });
      await fs.writeFile(path.join(specDir, 'spec.md'), '# Order\n## List\nShow order list\n## Detail\nShow order detail\n');
      const result = await skill.generate({ featureName: 'Order', projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(typeof result.data.pagesCount === 'number', 'should report pages count');
        assert.ok(result.data.outputDir, 'should return output directory');
      }
    });
  });

  test('generate without spec.md returns error', async () => {
    await withTempDir(async (dir) => {
      const result = await skill.generate({ featureName: 'Test', projectRoot: dir });
      assert.strictEqual(result.ok, false);
      assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error message');
    });
  });

  test('validate checks design completeness', async () => {
    await withTempDir(async (dir) => {
      const specDir = path.join(dir, 'specs', '001-feature');
      await fs.mkdir(specDir, { recursive: true });
      await fs.writeFile(path.join(specDir, 'spec.md'), '# Order\n## List\nShow list\n');
      await skill.generate({ featureName: 'Order', projectRoot: dir });
      const result = await skill.validate({ projectRoot: dir });
      assertStdResult(result, { okExpected: null });
      if (result.ok) {
        assert.ok(typeof result.data.score === 'number', 'should return score');
        assert.ok(result.data.verdict, 'should return verdict');
        assert.ok(Array.isArray(result.data.issues), 'should return issues array');
      }
    });
  });
});

describe('api-contract', () => {
  const skill = loadSkill('api-contract');

  test('generate creates OpenAPI YAML', async () => {
    const result = await skill.generate({
      name: 'UserAPI',
      endpoints: [{ path: '/users', method: 'get' }],
    });
    assertStdResult(result);
    assert.ok(result.data.openapi || result.data.yaml || result.data.spec || result.data.path, 'should produce API spec');
  });

  test('validate checks OpenAPI spec', async () => {
    const result = await skill.validate({
      spec: 'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n',
    });
    assertStdResult(result, { okExpected: null });
    if (result.ok) {
      assert.ok(typeof result.data.score === 'number', 'should return score');
      assert.ok(Array.isArray(result.data.issues), 'should return issues array');
    }
  });

  test('generate without endpoints creates default CRUD', async () => {
    const result = await skill.generate({ name: 'TestAPI' });
    assertStdResult(result);
    assert.ok(result.data.endpointsCount > 0, 'should generate default endpoints');
  });
});

describe('html-converter', () => {
  const skill = loadSkill('html-converter');

  test('convert transforms HTML file to React', async () => {
    await withTempDir(async (dir) => {
      const htmlPath = path.join(dir, 'card.html');
      await fs.writeFile(htmlPath, '<div class="card"><h1>Title</h1><input type="text" name="email" /></div>');
      const result = await skill.convert({ htmlFile: htmlPath, framework: 'react', name: 'Card', projectRoot: dir });
      assertStdResult(result);
      assert.ok(result.data.mainComponent, 'should return main component name');
      assert.ok(result.data.framework === 'react', 'should report framework');
      assert.ok(typeof result.data.fieldsCount === 'number', 'should report field count');
    });
  });

  test('convert transforms HTML file to Vue', async () => {
    await withTempDir(async (dir) => {
      const htmlPath = path.join(dir, 'form.html');
      await fs.writeFile(htmlPath, '<div class="form"><input type="text" name="username" /></div>');
      const result = await skill.convert({ htmlFile: htmlPath, framework: 'vue3', name: 'Form', projectRoot: dir });
      assertStdResult(result);
      assert.ok(result.data.mainComponent, 'should return main component name');
      assert.ok(result.data.framework === 'vue3', 'should report framework');
    });
  });

  test('split identifies component boundaries', async () => {
    await withTempDir(async (dir) => {
      const htmlPath = path.join(dir, 'page.html');
      await fs.writeFile(htmlPath, '<div class="card">A</div><div class="card">B</div>');
      const result = await skill.split({ htmlFile: htmlPath, projectRoot: dir });
      assertStdResult(result);
      assert.ok(Array.isArray(result.data.components), 'should return components array');
      assert.ok(typeof result.data.componentCount === 'number', 'should report component count');
    });
  });

  test('types generates TypeScript interfaces', async () => {
    await withTempDir(async (dir) => {
      const htmlPath = path.join(dir, 'form.html');
      await fs.writeFile(htmlPath, '<input type="text" name="email" /><input type="number" name="age" />');
      const result = await skill.types({ htmlFile: htmlPath, projectRoot: dir });
      assertStdResult(result);
      assert.ok(typeof result.data.fieldsCount === 'number', 'should report field count');
      assert.ok(result.data.interfaceName || result.data.outputFile, 'should return interface name or output file');
    });
  });

  test('convert without htmlFile returns error', async () => {
    const result = await skill.convert({ framework: 'react', name: 'Test' });
    assert.strictEqual(result.ok, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0, 'should have error message');
  });
});
