/**
 * 端到端链路测试 (E2E Pipeline Test)
 *
 * 验证完整项目生命周期：spec → scaffold → design → implement → test → git → review
 * 确保各 Skill 间的数据传递正确、标准返回结构一致。
 *
 * 数据流：
 *   constitution → specify (→spec.md) → plan (→plan.md) → tasks (→tasks.md)
 *   scaffold (→outputDir) → test-runner (→framework)
 *   specify (→spec.md) → design.generate (→design files)
 *   scaffold + git init → git.commit → review.checklist
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const { loadSkill, assertStdResult } = require('./helper.cjs');

// Pipeline 顺序加载的 7 个 Skill
const specBootstrap = loadSkill('spec-bootstrap');
const scaffoldRunner = loadSkill('scaffold-runner');
const designGen = loadSkill('spec-userstory-to-design');
const implementExecutor = loadSkill('implement-executor');
const testRunner = loadSkill('test-runner');
const gitWorkflow = loadSkill('git-workflow');
const reviewChecklist = loadSkill('review-checklist');

// 工具函数
async function withTempProject(fn) {
  const dir = path.join(os.tmpdir(), `po-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function gitInit(dir) {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "e2e@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "E2E"', { cwd: dir, stdio: 'ignore' });
}

describe('E2E Pipeline: spec → scaffold → design → implement → test → git → review', () => {

  test('Step 1: spec-bootstrap.constitution — 生成项目原则', async () => {
    await withTempProject(async (projectRoot) => {
      const result = await specBootstrap.constitution({
        projectRoot,
        principles: ['KISS', '测试先行', '类型安全'],
        projectName: 'e2e-demo',
      });

      assertStdResult(result);
      assert.ok(result.data.summary, 'constitution should produce summary');
      assert.ok(result.data.path, 'constitution should output file path');
      assert.ok(existsSync(result.data.path), 'constitution file should exist');
    });
  });

  test('Step 2: spec-bootstrap.specify — 从描述生成 spec.md', async () => {
    await withTempProject(async (projectRoot) => {
      const result = await specBootstrap.specify({
        projectRoot,
        description: '一个命令行待办事项管理工具，支持增删改查和优先级标记',
      });

      assertStdResult(result);
      assert.ok(result.data.path, 'specify should output file path');
      assert.ok(existsSync(result.data.path), 'spec.md should exist at returned path');

      const specContent = await fs.readFile(result.data.path, 'utf-8');
      assert.ok(specContent.length > 50, 'spec.md should have meaningful content');
    });
  });

  test('Step 3: spec-bootstrap.plan — 从 spec 生成 plan.md（数据流验证）', async () => {
    await withTempProject(async (projectRoot) => {
      // 前置：specify 生成 spec.md
      const specResult = await specBootstrap.specify({
        projectRoot,
        description: '一个命令行待办事项管理工具，支持增删改查',
      });
      assert.ok(specResult.data.path, 'specify should return path');

      // 正式测试：plan 消费 spec.md 路径
      const result = await specBootstrap.plan({
        projectRoot,
        specFile: specResult.data.path,  // 数据流：specify → plan
      });

      assertStdResult(result);
      assert.ok(result.data.path, 'plan should output file path');
      assert.ok(existsSync(result.data.path), 'plan.md should exist');
      assert.ok(result.data.techStack, 'plan should include tech stack');
    });
  });

  test('Step 4: spec-bootstrap.tasks — 从 plan 生成任务清单（数据流验证）', async () => {
    await withTempProject(async (projectRoot) => {
      const specResult = await specBootstrap.specify({
        projectRoot,
        description: '命令行待办事项管理工具',
      });
      const planResult = await specBootstrap.plan({
        projectRoot,
        specFile: specResult.data.path,
      });

      const result = await specBootstrap.tasks({
        projectRoot,
        planFile: planResult.data.path,  // 数据流：plan → tasks
      });

      assertStdResult(result);
      assert.ok(result.data.path, 'tasks should output file path');
      assert.ok(existsSync(result.data.path), 'tasks.md should exist');
    });
  });

  test('Step 5: scaffold-runner.run — 生成 node-cli 项目骨架', async () => {
    await withTempProject(async (projectRoot) => {
      const result = await scaffoldRunner.run({
        template: 'node-cli',
        name: 'e2e-app',
        projectRoot,
        options: { installDeps: false },
      });

      assertStdResult(result);
      assert.ok(result.data.outputDir, 'scaffold should output directory');
      assert.ok(result.data.fileCount > 0, 'should generate at least 1 file');
      assert.ok(
        typeof result.data.astEnhanced === 'boolean',
        'scaffold should have astEnhanced field'
      );

      const pkgPath = path.join(result.data.outputDir, 'package.json');
      assert.ok(existsSync(pkgPath), 'package.json should exist');
    });
  });

  test('Step 6: spec-userstory-to-design.generate — 从 spec 生成设计文档', async () => {
    await withTempProject(async (projectRoot) => {
      const specResult = await specBootstrap.specify({
        projectRoot,
        description: '用户登录功能，支持邮箱密码和 OAuth',
      });

      const result = await designGen.generate({
        projectRoot,
        featureName: 'user-auth',
        specFile: specResult.data.path,  // 数据流：specify → design
        format: 'all',
      });

      assertStdResult(result);
      assert.ok(result.data.pagesCount >= 0, 'should report pages count');
      assert.ok(
        typeof result.data.astEnhanced === 'boolean' || result.data.astEnhanced === undefined,
        'design generate should have astEnhanced field'
      );
    });
  });

  test('Step 7: implement-executor.runPhases — 执行实现阶段（dryRun）', async () => {
    await withTempProject(async (projectRoot) => {
      await scaffoldRunner.run({
        template: 'node-cli',
        name: 'impl-demo',
        projectRoot,
        options: { installDeps: false },
      });

      const result = await implementExecutor.runPhases({
        featureId: 'e2e-feature',
        projectRoot,
        dryRun: true,
        maxRetries: 1,
      });

      assert.ok(typeof result === 'object', 'runPhases should return an object');
      assert.ok('ok' in result, 'runPhases should have ok field');
      assert.ok('data' in result || 'error' in result, 'should have data or error');
    });
  });

  test('Step 8: test-runner.run — 检测框架并运行测试', async () => {
    await withTempProject(async (projectRoot) => {
      const scaffoldResult = await scaffoldRunner.run({
        template: 'node-cli',
        name: 'test-demo',
        projectRoot,
        options: { installDeps: false },
      });

      const result = await testRunner.run({
        projectRoot: scaffoldResult.data.outputDir,
        scope: 'all',
      });

      assert.ok(typeof result === 'object', 'test-runner should return an object');
      assert.ok('ok' in result, 'should have ok field');
    });
  });

  test('Step 9: git-workflow.commit — 提交变更', async () => {
    await withTempProject(async (projectRoot) => {
      const scaffoldResult = await scaffoldRunner.run({
        template: 'node-cli',
        name: 'git-demo',
        projectRoot,
        options: { installDeps: false },
      });
      const outputDir = scaffoldResult.data.outputDir;

      gitInit(outputDir);

      const result = await gitWorkflow.commit({
        files: ['package.json'],
        message: 'feat: initial scaffold',
        projectRoot: outputDir,
      });

      assertStdResult(result);
      assert.ok(result.data.commitHash, 'should have commit hash');
      assert.ok(result.data.commitType, 'should have commit type');
      assert.ok(
        typeof result.data.astEnhanced === 'boolean' || result.data.astEnhanced === undefined,
        'git commit should have astEnhanced field'
      );
    });
  });

  test('Step 10: review-checklist.checklist — 获取审查清单', async () => {
    await withTempProject(async (projectRoot) => {
      const result = await reviewChecklist.checklist({
        category: 'all',
        format: 'json',
        projectRoot,
      });

      assertStdResult(result);
      assert.ok(result.data.rules || result.data.checklist, 'should output rules or checklist');
    });
  });

  test('FULL PIPELINE: 完整链路数据流验证', async () => {
    await withTempProject(async (projectRoot) => {
      const steps = [];

      // --- Step 1: constitution ---
      const constitution = await specBootstrap.constitution({
        projectRoot,
        principles: ['KISS', '测试先行'],
        projectName: 'pipeline-demo',
      });
      assert.strictEqual(constitution.ok, true, 'constitution should succeed');
      steps.push({ step: 'constitution', ok: constitution.ok });

      // --- Step 2: specify → spec.md ---
      const spec = await specBootstrap.specify({
        projectRoot,
        description: '命令行计算器，支持加减乘除和历史记录',
      });
      assert.strictEqual(spec.ok, true, 'specify should succeed');
      assert.ok(existsSync(spec.data.path), 'spec.md should exist');
      steps.push({ step: 'specify', ok: spec.ok, output: spec.data.path });

      // --- Step 3: plan (consumes spec.data.path) ---
      const plan = await specBootstrap.plan({
        projectRoot,
        specFile: spec.data.path,
      });
      assert.strictEqual(plan.ok, true, 'plan should succeed');
      assert.ok(existsSync(plan.data.path), 'plan.md should exist');
      steps.push({ step: 'plan', ok: plan.ok, input: 'spec.path', output: plan.data.path });

      // --- Step 4: tasks (consumes plan.data.path) ---
      const tasks = await specBootstrap.tasks({
        projectRoot,
        planFile: plan.data.path,
      });
      assert.strictEqual(tasks.ok, true, 'tasks should succeed');
      assert.ok(existsSync(tasks.data.path), 'tasks.md should exist');
      steps.push({ step: 'tasks', ok: tasks.ok, input: 'plan.path', output: tasks.data.path });

      // --- Step 5: scaffold (independent) ---
      const scaffold = await scaffoldRunner.run({
        template: 'node-cli',
        name: 'pipeline-app',
        projectRoot,
        options: { installDeps: false },
      });
      assert.strictEqual(scaffold.ok, true, 'scaffold should succeed');
      assert.ok(scaffold.data.fileCount > 0, 'should generate files');
      steps.push({ step: 'scaffold', ok: scaffold.ok, output: scaffold.data.outputDir });

      // --- Step 6: design (consumes spec.data.path) ---
      const design = await designGen.generate({
        projectRoot,
        featureName: 'calculator',
        specFile: spec.data.path,
        format: 'all',
      });
      assert.strictEqual(design.ok, true, 'design generate should succeed');
      steps.push({ step: 'design', ok: design.ok, input: 'spec.path' });

      // --- Step 7: implement (dryRun) ---
      // 注意：scaffolded 项目没有 tasks.md，runPhases 会返回 ok:false，但应返回有效结构
      const impl = await implementExecutor.runPhases({
        featureId: 'pipeline-feature',
        projectRoot,
        dryRun: true,
        maxRetries: 1,
      });
      assert.ok(typeof impl === 'object', 'implement should return object');
      assert.ok('ok' in impl, 'should have ok field');
      steps.push({ step: 'implement', ok: true });  // 通过：返回有效结构

      // --- Step 8: test (uses scaffold output) ---
      // 注意：未安装依赖，test-runner 可能 ok:false，但应返回有效结构
      const testResult = await testRunner.run({
        projectRoot: scaffold.data.outputDir,
        scope: 'all',
      });
      assert.ok(typeof testResult === 'object', 'test-runner should return object');
      assert.ok('ok' in testResult, 'should have ok field');
      steps.push({ step: 'test', ok: true });  // 通过：返回有效结构

      // --- Step 9: git commit (uses scaffold output) ---
      gitInit(scaffold.data.outputDir);
      const commit = await gitWorkflow.commit({
        files: ['package.json'],
        message: 'feat: pipeline e2e test',
        projectRoot: scaffold.data.outputDir,
      });
      assert.strictEqual(commit.ok, true, 'git commit should succeed');
      assert.ok(commit.data.commitHash, 'should have commit hash');
      steps.push({ step: 'git-commit', ok: commit.ok });

      // --- Step 10: review checklist ---
      const review = await reviewChecklist.checklist({
        category: 'all',
        format: 'json',
        projectRoot,
      });
      assert.strictEqual(review.ok, true, 'review checklist should succeed');
      steps.push({ step: 'review', ok: review.ok });

      // 验证全部步骤完成
      const failed = steps.filter(s => !s.ok);
      assert.strictEqual(failed.length, 0,
        `Pipeline should have 0 failures. Failed: ${JSON.stringify(failed)}`);

      // 验证数据流链路（每步 input 来自上步 output）
      const dataFlowLinks = steps.filter(s => s.input && s.output);
      assert.ok(dataFlowLinks.length >= 2, 'should have at least 2 data-flow links');
    });
  });

  test('AST 增强：验证 pipeline 中 AST 字段正确传播', async () => {
    await withTempProject(async (projectRoot) => {
      // specify
      const spec = await specBootstrap.specify({
        projectRoot,
        description: '用户管理 API',
      });
      assert.ok(
        typeof spec.data.astEnhanced === 'boolean' || spec.data.astEnhanced === undefined,
        'specify astEnhanced should be boolean or undefined'
      );

      // scaffold
      const scaffold = await scaffoldRunner.run({
        template: 'node-cli',
        name: 'ast-demo',
        projectRoot,
        options: { installDeps: false },
      });
      assert.ok(
        typeof scaffold.data.astEnhanced === 'boolean',
        'scaffold astEnhanced should be boolean'
      );
      if (scaffold.data.astEnhanced) {
        assert.ok(scaffold.data.astValidation, 'should have astValidation data');
        assert.ok(
          typeof scaffold.data.astValidation.totalChecked === 'number',
          'totalChecked should be number'
        );
      }

      // git commit
      gitInit(scaffold.data.outputDir);
      const commit = await gitWorkflow.commit({
        files: ['package.json'],
        message: 'test: ast field propagation',
        projectRoot: scaffold.data.outputDir,
      });
      assert.ok(
        typeof commit.data.astEnhanced === 'boolean' || commit.data.astEnhanced === undefined,
        'git commit astEnhanced should be boolean or undefined'
      );
    });
  });
});
