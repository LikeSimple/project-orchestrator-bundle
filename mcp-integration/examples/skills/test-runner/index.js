/**
 * test-runner Skill - 完整实现
 *
 * 测试执行 + 覆盖率 + 契约验证 + 报告生成 + 配置初始化。
 * 跨框架支持（vitest / jest / mocha / cypress / playwright / karma / pytest / cargo / go / mvn）。
 *
 * 对应 MCP Tool: run_tests / coverage / report / init / list / contract
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');
const recast = require('recast');

const execAsync = promisify(exec);

// ============================================================
// 常量定义
// ============================================================

const TEST_TIMEOUT_MS = 30_000; // 30 秒超时保护

// 支持的 Node.js 测试框架
const NODE_FRAMEWORKS = {
  vitest: {
    name: 'vitest',
    configFiles: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs'],
    depNames: ['vitest'],
    scriptPatterns: ['vitest', 'vitest run'],
    runCommand: 'npx vitest run',
    watchCommand: 'npx vitest',
    coverageCommand: 'npx vitest run --coverage',
    coverageReportPath: 'coverage/coverage-summary.json',
    jsonReportFlag: '--reporter=json --outputFile=.test-results.json',
  },
  jest: {
    name: 'jest',
    configFiles: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'],
    depNames: ['jest', 'jest-cli'],
    scriptPatterns: ['jest', 'npm test'],
    runCommand: 'npx jest',
    watchCommand: 'npx jest --watch',
    coverageCommand: 'npx jest --coverage',
    coverageReportPath: 'coverage/coverage-summary.json',
    jsonReportFlag: '--json --outputFile=.test-results.json',
  },
  mocha: {
    name: 'mocha',
    configFiles: ['.mocharc.js', '.mocharc.json', '.mocharc.yml', '.mocharc.yaml', 'mocharc.js', 'mocharc.json'],
    depNames: ['mocha'],
    scriptPatterns: ['mocha', 'npm test'],
    runCommand: 'npx mocha',
    watchCommand: 'npx mocha --watch',
    coverageCommand: 'npx nyc mocha',
    coverageReportPath: 'coverage/coverage-summary.json',
    jsonReportFlag: '--reporter json > .test-results.json',
  },
  cypress: {
    name: 'cypress',
    configFiles: ['cypress.config.ts', 'cypress.config.js', 'cypress.json'],
    depNames: ['cypress'],
    scriptPatterns: ['cypress', 'cypress run', 'cypress open'],
    runCommand: 'npx cypress run',
    watchCommand: 'npx cypress open',
    coverageCommand: 'npx cypress run --env coverage=true',
    coverageReportPath: 'coverage/coverage-summary.json',
    jsonReportFlag: '--reporter json --reporter-options output=.test-results.json',
  },
  playwright: {
    name: 'playwright',
    configFiles: ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'],
    depNames: ['@playwright/test', 'playwright'],
    scriptPatterns: ['playwright', 'playwright test', 'npx playwright test'],
    runCommand: 'npx playwright test',
    watchCommand: 'npx playwright test --ui',
    coverageCommand: 'npx playwright test --coverage',
    coverageReportPath: 'coverage/coverage-summary.json',
    jsonReportFlag: '--reporter=json --output=.test-results.json',
  },
  karma: {
    name: 'karma',
    configFiles: ['karma.conf.js', 'karma.conf.ts', 'karma.conf.coffee'],
    depNames: ['karma'],
    scriptPatterns: ['karma', 'karma start', 'npm test'],
    runCommand: 'npx karma start --single-run',
    watchCommand: 'npx karma start',
    coverageCommand: 'npx karma start --single-run --reporters coverage',
    coverageReportPath: 'coverage/coverage-summary.json',
    jsonReportFlag: '--reporters json',
  },
};

// 非 Node.js 框架
const OTHER_FRAMEWORKS = {
  pytest: {
    name: 'pytest',
    ecosystem: 'python',
    configFiles: ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini'],
    depCheckFiles: ['pyproject.toml', 'requirements.txt', 'setup.py'],
    runCommand: 'pytest',
    coverageCommand: 'pytest --cov --cov-report=json --cov-report=html',
    coverageReportPath: 'coverage/coverage-summary.json',
  },
  cargo: {
    name: 'cargo',
    ecosystem: 'rust',
    configFiles: ['Cargo.toml'],
    runCommand: 'cargo test',
    coverageCommand: 'cargo tarpaulin --out Json',
    coverageReportPath: 'tarpaulin-report.json',
  },
  go: {
    name: 'go',
    ecosystem: 'go',
    configFiles: ['go.mod'],
    runCommand: 'go test ./...',
    coverageCommand: 'go test -coverprofile=coverage.out ./...',
    coverageReportPath: 'coverage.out',
  },
  maven: {
    name: 'maven',
    ecosystem: 'java',
    configFiles: ['pom.xml'],
    runCommand: 'mvn test',
    coverageCommand: 'mvn test jacoco:report',
    coverageReportPath: 'target/site/jacoco/jacoco.csv',
  },
};

// 测试文件命名模式
const TEST_FILE_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.test\.(py)$/,
  /_test\.(py)$/,
  /\.spec\.(py)$/,
  /test_.*\.py$/,
  /Test.*\.java$/,
  /.*\.test\.go$/,
  /.*_test\.go$/,
];

// 测试目录模式
const TEST_DIR_PATTERNS = [
  /__tests__$/,
  /^tests?$/,
  /^test$/,
  /^e2e$/,
  /^integration$/,
  /^unit$/,
];

// 跳过的目录
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
  'coverage', '.next', '.nuxt', '.cache', '.turbo',
  'target', '__pycache__', '.pytest_cache', '.venv', 'venv',
  '.idea', '.vscode',
]);

// ============================================================
// 工具函数
// ============================================================

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readJson(p) {
  try {
    const content = await fs.readFile(p, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// 安全执行命令，带超时和错误处理
async function safeExec(cmd, options = {}) {
  const { cwd, timeout = TEST_TIMEOUT_MS, maxBuffer = 50 * 1024 * 1024 } = options;
  try {
    const result = await execAsync(cmd, { cwd, timeout, maxBuffer });
    return {
      ok: true,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: 0,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.code || 1,
      error: err.message,
      timedOut: err.killed && err.signal === 'SIGTERM',
    };
  }
}

// ============================================================
// 多框架自动检测
// ============================================================

/**
 * 检测项目中所有可用的测试框架
 * @param {string} projectRoot
 * @returns {Promise<{ frameworks: Array, primary: Object|null, ecosystem: string }>}
 */
async function detectAllFrameworks(projectRoot) {
  const cwd = projectRoot || process.cwd();
  const detected = [];

  // --- Node.js 框架检测 ---
  let packageJson = null;
  try {
    packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
  } catch { /* 忽略 */ }

  if (packageJson) {
    const allDeps = {
      ...(packageJson.devDependencies || {}),
      ...(packageJson.dependencies || {}),
    };
    const scripts = packageJson.scripts || {};

    for (const [key, fw] of Object.entries(NODE_FRAMEWORKS)) {
      let hasDep = false;
      let hasConfig = false;
      let hasScript = false;
      let scriptName = null;

      // 检查依赖
      for (const dep of fw.depNames) {
        if (allDeps[dep]) {
          hasDep = true;
          break;
        }
      }

      // 检查配置文件
      for (const configFile of fw.configFiles) {
        if (await fileExists(path.join(cwd, configFile))) {
          hasConfig = true;
          break;
        }
      }

      // 检查 scripts
      for (const [name, cmd] of Object.entries(scripts)) {
        for (const pattern of fw.scriptPatterns) {
          if (cmd.includes(pattern)) {
            hasScript = true;
            scriptName = name;
            break;
          }
        }
        if (hasScript) break;
      }

      if (hasDep || hasConfig || hasScript) {
        detected.push({
          framework: key,
          name: fw.name,
          ecosystem: 'node',
          hasDep,
          hasConfig,
          hasScript,
          scriptName,
          runCommand: hasScript && scripts[scriptName] ? `npm run ${scriptName}` : fw.runCommand,
          watchCommand: fw.watchCommand,
          coverageCommand: fw.coverageCommand,
          confidence: (hasDep ? 3 : 0) + (hasConfig ? 2 : 0) + (hasScript ? 1 : 0),
        });
      }
    }
  }

  // --- 非 Node.js 框架检测 ---
  for (const [key, fw] of Object.entries(OTHER_FRAMEWORKS)) {
    let hasConfig = false;
    for (const configFile of fw.configFiles) {
      if (await fileExists(path.join(cwd, configFile))) {
        hasConfig = true;
        break;
      }
    }

    if (hasConfig) {
      detected.push({
        framework: key,
        name: fw.name,
        ecosystem: fw.ecosystem,
        hasDep: true,
        hasConfig: true,
        hasScript: false,
        scriptName: null,
        runCommand: fw.runCommand,
        watchCommand: null,
        coverageCommand: fw.coverageCommand,
        confidence: 5,
      });
    }
  }

  // 按置信度排序
  detected.sort((a, b) => b.confidence - a.confidence);

  const primary = detected.length > 0 ? detected[0] : null;
  const ecosystem = primary ? primary.ecosystem : 'unknown';

  return {
    frameworks: detected,
    primary,
    ecosystem,
    frameworkNames: detected.map(d => d.framework),
  };
}

// 兼容旧版：返回单个首选框架信息
async function detectFramework(projectRoot) {
  const result = await detectAllFrameworks(projectRoot);
  if (!result.primary) return null;
  return {
    framework: result.primary.framework,
    ecosystem: result.primary.ecosystem,
    command: result.primary.runCommand,
  };
}

// ============================================================
// 语言检测
// ============================================================

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
  };
  return langMap[ext] || 'typescript';
}

// ============================================================
// 测试文件扫描
// ============================================================

/**
 * 判断是否为测试文件
 */
function isTestFile(filePath) {
  const baseName = path.basename(filePath);
  for (const pattern of TEST_FILE_PATTERNS) {
    if (pattern.test(baseName)) return true;
  }
  return false;
}

/**
 * 判断测试文件类型
 */
function classifyTestFile(filePath, projectRoot) {
  const relativePath = path.relative(projectRoot || process.cwd(), filePath).replace(/\\/g, '/');
  const dirName = path.dirname(relativePath);
  const baseName = path.basename(filePath).toLowerCase();

  // E2E 测试
  if (/e2e/.test(relativePath) || /\.e2e\./.test(baseName) || /playwright/.test(relativePath) || /cypress/.test(relativePath)) {
    return 'e2e';
  }

  // 集成测试
  if (/integration/.test(relativePath) || /\.integration\./.test(baseName) || /intg?\./.test(baseName)) {
    return 'integration';
  }

  // 快照测试
  if (/snapshot/.test(baseName) || /\.snap\./.test(baseName)) {
    return 'snapshot';
  }

  // 契约测试
  if (/contract/.test(relativePath) || /\.contract\./.test(baseName)) {
    return 'contract';
  }

  // 默认为单元测试
  return 'unit';
}

/**
 * AST 增强：从 JS/TS 测试代码中提取测试用例信息
 * 使用 recast AST 检测 describe/it/test 函数调用
 * @returns {describeCalls: number, itCalls: number, testCalls: number, total: number, frameworkImports: string[], emptyCatches: Array, consoleLogs: Array} | null
 */
function analyzeTestFileAST(content) {
  const parsed = ast.parseJS(content);
  if (!parsed) return null;

  const describeNames = new Set(['describe', 'suite', 'context']);
  const itNames = new Set(['it', 'test', 'specify']);

  let describeCalls = 0;
  let itCalls = 0;
  let testCalls = 0;

  try {
    recast.visit(parsed, {
      visitCallExpression(path) {
        const callee = path.node.callee;
        let callName = null;

        if (callee?.type === 'Identifier') {
          callName = callee.name;
        } else if (callee?.type === 'MemberExpression' && callee.property?.name) {
          // 处理 describe.skip / it.only 等
          callName = callee.object?.name;
        }

        if (callName && describeNames.has(callName)) {
          describeCalls++;
        } else if (callName && itNames.has(callName)) {
          itCalls++;
          testCalls++;
        }

        this.traverse(path);
      },
    });
  } catch {
    return null;
  }

  // 检测测试框架 import
  const imports = ast.extractImports(content);
  const frameworkImports = [];
  const testFrameworks = ['vitest', 'jest', 'mocha', 'chai', '@playwright/test', 'cypress'];
  for (const imp of imports) {
    for (const fw of testFrameworks) {
      if (imp.source === fw || imp.source.includes(fw)) {
        frameworkImports.push(fw);
        break;
      }
    }
  }

  // 检测空 catch
  const emptyCatches = ast.detectEmptyCatches(content);

  // 检测 console 残留
  const consoleLogs = ast.detectConsoleLogs(content);

  return {
    describeCalls,
    itCalls,
    testCalls,
    total: testCalls,
    frameworkImports,
    emptyCatches,
    consoleLogs,
  };
}

/**
 * 统计测试文件中的用例数量
 * 优先使用 AST 解析，解析失败时回退到正则表达式
 */
function countTestCases(content) {
  // ---- AST 增强路径 ----
  const astResult = analyzeTestFileAST(content);
  if (astResult) {
    return {
      describes: astResult.describeCalls,
      its: astResult.testCalls,
      total: astResult.testCalls,
      astEnhanced: true,
      frameworkImports: astResult.frameworkImports,
      emptyCatches: astResult.emptyCatches,
      consoleLogs: astResult.consoleLogs,
    };
  }

  // ---- Fallback：正则表达式 ----
  let describeCount = 0;
  let itCount = 0;
  let testCount = 0;

  // 匹配 describe/suite 块
  const describeRegex = /\b(describe|suite|context)\s*\(/g;
  const describeMatch = content.match(describeRegex);
  if (describeMatch) describeCount = describeMatch.length;

  // 匹配 it/test 用例
  const itRegex = /\b(it|test|specify)\s*\(/g;
  const itMatch = content.match(itRegex);
  if (itMatch) itCount = itMatch.length;

  // Python: def test_
  const pyTestRegex = /def\s+test_\w+/g;
  const pyTestMatch = content.match(pyTestRegex);
  if (pyTestMatch) testCount += pyTestMatch.length;

  // Go: func Test
  const goTestRegex = /func\s+Test\w+/g;
  const goTestMatch = content.match(goTestRegex);
  if (goTestMatch) testCount += goTestMatch.length;

  return {
    describes: describeCount,
    its: itCount + testCount,
    total: itCount + testCount,
    astEnhanced: false,
  };
}

/**
 * 递归扫描目录查找测试文件
 */
async function scanTestFiles(projectRoot, dir = null, results = []) {
  const cwd = projectRoot || process.cwd();
  const currentDir = dir || cwd;

  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      await scanTestFiles(cwd, fullPath, results);
    } else if (entry.isFile()) {
      if (isTestFile(entry.name)) {
        let content = '';
        let caseCount = { describes: 0, its: 0, total: 0 };
        try {
          content = await fs.readFile(fullPath, 'utf-8');
          caseCount = countTestCases(content);
        } catch { /* 忽略读取错误 */ }

        results.push({
          path: path.relative(cwd, fullPath).replace(/\\/g, '/'),
          absolutePath: fullPath,
          fileName: entry.name,
          type: classifyTestFile(fullPath, cwd),
          size: content.length,
          caseCount,
        });
      }
    }
  }

  return results;
}

/**
 * 扫描源文件，找出没有对应测试的文件
 */
async function findUntestedSourceFiles(projectRoot, testFiles) {
  const cwd = projectRoot || process.cwd();
  const testFilePaths = new Set(testFiles.map(t => t.path));
  const untested = [];

  // 简化实现：检查 src/ 目录下的源文件
  const srcDir = path.join(cwd, 'src');
  if (!(await fileExists(srcDir))) return untested;

  async function scanDir(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        if (entry.name === '__tests__') continue;
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!['.ts', '.tsx', '.js', '.jsx', '.py'].includes(ext)) continue;

        // 跳过测试文件本身
        if (isTestFile(entry.name)) continue;

        const relativePath = path.relative(cwd, fullPath).replace(/\\/g, '/');

        // 检查是否有对应的测试文件
        const baseName = entry.name.replace(ext, '');
        const dirPath = path.relative(cwd, path.dirname(fullPath)).replace(/\\/g, '/');

        let hasTest = false;
        for (const testFile of testFilePaths) {
          if (testFile.includes(baseName) && testFile.match(/\.(test|spec)\./)) {
            hasTest = true;
            break;
          }
        }

        if (!hasTest) {
          untested.push({
            path: relativePath,
            fileName: entry.name,
            ext,
          });
        }
      }
    }
  }

  await scanDir(srcDir);
  return untested;
}

// ============================================================
// 测试输出解析
// ============================================================

function parseTestOutput(stdout, stderr, framework) {
  const result = { passed: 0, failed: 0, skipped: 0, total: 0, duration: 0 };
  const output = stdout + '\n' + stderr;

  // --- Node.js 框架 ---
  if (framework === 'vitest' || framework === 'jest') {
    // 匹配 "Tests  X passed (Y)" / "Test Files  X passed"
    const passedMatch = output.match(/(\d+)\s+passed/i);
    const failedMatch = output.match(/(\d+)\s+failed/i);
    const skippedMatch = output.match(/(\d+)\s+skipped/i);
    const totalMatch = output.match(/Tests\s+(\d+)\s*\(/i) || output.match(/Total.*?(\d+)/i);

    if (passedMatch) result.passed = parseInt(passedMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    if (skippedMatch) result.skipped = parseInt(skippedMatch[1]);
    if (totalMatch) result.total = parseInt(totalMatch[1]);
    else result.total = result.passed + result.failed + result.skipped;

    // 匹配耗时
    const timeMatch = output.match(/Time\s*[:：]\s*(\d+\.?\d*)\s*(ms|s)/i);
    if (timeMatch) {
      const value = parseFloat(timeMatch[1]);
      result.duration = timeMatch[2].toLowerCase() === 's' ? value * 1000 : value;
    }
  } else if (framework === 'mocha') {
    const passedMatch = output.match(/(\d+)\s+passing/i);
    const failedMatch = output.match(/(\d+)\s+failing/i);
    const pendingMatch = output.match(/(\d+)\s+pending/i);
    if (passedMatch) result.passed = parseInt(passedMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    if (pendingMatch) result.skipped = parseInt(pendingMatch[1]);
    result.total = result.passed + result.failed + result.skipped;

    const timeMatch = output.match(/(\d+\.?\d*)\s*(ms|s)/i);
    if (timeMatch) {
      const value = parseFloat(timeMatch[1]);
      result.duration = timeMatch[2].toLowerCase() === 's' ? value * 1000 : value;
    }
  } else if (framework === 'cypress') {
    const passedMatch = output.match(/(\d+)\s+passing/i);
    const failedMatch = output.match(/(\d+)\s+failing/i);
    const pendingMatch = output.match(/(\d+)\s+pending/i);
    if (passedMatch) result.passed = parseInt(passedMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    if (pendingMatch) result.skipped = parseInt(pendingMatch[1]);
    result.total = result.passed + result.failed + result.skipped;
  } else if (framework === 'playwright') {
    const passedMatch = output.match(/(\d+)\s+passed/i);
    const failedMatch = output.match(/(\d+)\s+failed/i);
    const skippedMatch = output.match(/(\d+)\s+skipped/i);
    if (passedMatch) result.passed = parseInt(passedMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    if (skippedMatch) result.skipped = parseInt(skippedMatch[1]);
    result.total = result.passed + result.failed + result.skipped;
  } else if (framework === 'karma') {
    const successMatch = output.match(/SUCCESS.*?(\d+)/i) || output.match(/(\d+)\s+success/i);
    const failedMatch = output.match(/FAILED.*?(\d+)/i) || output.match(/(\d+)\s+failed/i);
    if (successMatch) result.passed = parseInt(successMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    result.total = result.passed + result.failed;
  }
  // --- 非 Node.js 框架 ---
  else if (framework === 'pytest') {
    const passedMatch = output.match(/(\d+) passed/i);
    const failedMatch = output.match(/(\d+) failed/i);
    const skippedMatch = output.match(/(\d+) skipped/i);
    if (passedMatch) result.passed = parseInt(passedMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    if (skippedMatch) result.skipped = parseInt(skippedMatch[1]);
    result.total = result.passed + result.failed + result.skipped;
  } else if (framework === 'cargo') {
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);
    const ignoredMatch = output.match(/(\d+) ignored/);
    if (passedMatch) result.passed = parseInt(passedMatch[1]);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);
    if (ignoredMatch) result.skipped = parseInt(ignoredMatch[1]);
    result.total = result.passed + result.failed + result.skipped;
  } else if (framework === 'go') {
    if (/PASS/.test(output)) result.passed = (output.match(/\bPASS\b/g) || []).length;
    if (/FAIL/.test(output)) result.failed = (output.match(/\bFAIL\b/g) || []).length;
    if (/SKIP/.test(output)) result.skipped = (output.match(/\bSKIP\b/g) || []).length;
    result.total = result.passed + result.failed + result.skipped;
  } else if (framework === 'maven') {
    const runMatch = output.match(/Tests run:\s*(\d+)/i);
    const failMatch = output.match(/Failures:\s*(\d+)/i);
    const errorMatch = output.match(/Errors:\s*(\d+)/i);
    const skipMatch = output.match(/Skipped:\s*(\d+)/i);
    if (runMatch) result.total = parseInt(runMatch[1]);
    let fails = 0;
    if (failMatch) fails += parseInt(failMatch[1]);
    if (errorMatch) fails += parseInt(errorMatch[1]);
    result.failed = fails;
    if (skipMatch) result.skipped = parseInt(skipMatch[1]);
    result.passed = result.total - result.failed - result.skipped;
  }

  return result;
}

/**
 * 从 JSON 报告文件解析测试结果（更准确）
 */
async function parseJsonReport(projectRoot, framework) {
  const cwd = projectRoot || process.cwd();
  const reportPath = path.join(cwd, '.test-results.json');

  if (!(await fileExists(reportPath))) return null;

  try {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));

    // Vitest / Jest 格式
    if (report.testResults || report.numTotalTests !== undefined) {
      return {
        passed: report.numPassedTests || 0,
        failed: report.numFailedTests || 0,
        skipped: report.numPendingTests || 0,
        total: report.numTotalTests || 0,
        suites: {
          total: report.numTotalTestSuites || 0,
          passed: report.numPassedTestSuites || 0,
          failed: report.numFailedTestSuites || 0,
        },
        testResults: (report.testResults || []).map(tr => ({
          file: tr.name,
          status: tr.status,
          message: tr.failureMessage || '',
          tests: (tr.assertionResults || []).map(a => ({
            name: a.fullName || a.title,
            status: a.status,
            duration: a.duration || 0,
            failureMessages: a.failureMessages || [],
          })),
        })),
        duration: report.startTime ? Date.now() - report.startTime : 0,
      };
    }

    // Mocha 格式
    if (report.stats) {
      return {
        passed: report.stats.passes || 0,
        failed: report.stats.failures || 0,
        skipped: report.stats.pending || 0,
        total: report.stats.tests || 0,
        duration: report.stats.duration || 0,
        failures: (report.failures || []).map(f => ({
          title: f.title,
          fullTitle: f.fullTitle,
          err: f.err?.message || '',
          stack: f.err?.stack || '',
        })),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 覆盖率解析
// ============================================================

async function parseCoverageReport(projectRoot, framework) {
  const cwd = projectRoot || process.cwd();
  const fw = NODE_FRAMEWORKS[framework] || OTHER_FRAMEWORKS[framework];

  if (!fw) return null;

  const reportPath = path.join(cwd, fw.coverageReportPath || 'coverage/coverage-summary.json');

  if (!(await fileExists(reportPath))) return null;

  try {
    // Istanbul / c8 格式 (coverage-summary.json)
    if (reportPath.endsWith('.json')) {
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));

      if (report.total) {
        const total = report.total;
        return {
          total: {
            lines: total.lines?.pct || 0,
            statements: total.statements?.pct || 0,
            functions: total.functions?.pct || 0,
            branches: total.branches?.pct || 0,
          },
          byFile: Object.entries(report)
            .filter(([key]) => key !== 'total')
            .map(([file, data]) => ({
              file: path.relative(cwd, file).replace(/\\/g, '/'),
              lines: data.lines?.pct || 0,
              statements: data.statements?.pct || 0,
              functions: data.functions?.pct || 0,
              branches: data.branches?.pct || 0,
            })),
          format: 'istanbul',
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 失败分类
// ============================================================

function classifyFailure(errorMessage) {
  if (!errorMessage) return 'unknown';

  const msg = errorMessage.toLowerCase();

  if (msg.includes('assertionerror') || msg.includes('expect(') || msg.includes('expected') || msg.includes('received')) {
    return 'logic-error';
  }
  if (msg.includes('typeerror') || msg.includes('is not a function') || msg.includes('cannot read property')) {
    return 'type-error';
  }
  if (msg.includes('networkerror') || msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('fetch failed')) {
    return 'integration-error';
  }
  if (msg.includes('timeouterror') || msg.includes('exceeded timeout') || msg.includes('async callback was not invoked')) {
    return 'performance-issue';
  }
  if (msg.includes('cannot find module') || msg.includes('module not found') || msg.includes("cannot resolve")) {
    return 'missing-dependency';
  }
  if (msg.includes('syntaxerror') || msg.includes('unexpected token')) {
    return 'syntax-error';
  }
  if (msg.includes('referenceerror') || msg.includes('is not defined')) {
    return 'reference-error';
  }

  return 'unknown';
}

const FAILURE_SUGGESTIONS = {
  'logic-error': '检查业务逻辑、边界条件、空值处理、特殊输入',
  'type-error': '检查 TypeScript 类型定义、函数参数、返回值类型',
  'integration-error': '检查 API 调用、mock 数据、网络连接、环境配置',
  'performance-issue': '检查 N+1 查询、循环复杂度、超时配置、异步操作',
  'missing-dependency': '检查 package.json / requirements.txt，运行安装命令',
  'syntax-error': '检查语法错误、拼写错误、缺少括号或分号',
  'reference-error': '检查变量是否定义、导入路径是否正确',
  'unknown': '调用 debug-helper 进一步分析或查看完整堆栈',
};

// ============================================================
// 命令实现：run（增强版）
// ============================================================

async function run({ projectRoot, framework, scope = 'all', watch = false, failOnCoverageBelow = 80, updateBaseline = false, testPath = null }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检测框架
  let detectedInfo;
  if (framework) {
    // 用户指定了框架
    const fw = NODE_FRAMEWORKS[framework] || OTHER_FRAMEWORKS[framework];
    if (!fw) {
      return {
        ok: false,
        error: `Unsupported framework: ${framework}. Supported: ${Object.keys({ ...NODE_FRAMEWORKS, ...OTHER_FRAMEWORKS }).join(', ')}`,
        warnings: [],
        nextActions: [],
      };
    }
    detectedInfo = {
      framework,
      name: fw.name,
      ecosystem: fw.ecosystem || 'node',
      runCommand: fw.runCommand,
      watchCommand: fw.watchCommand,
      coverageCommand: fw.coverageCommand,
    };
  } else {
    const allFrameworks = await detectAllFrameworks(cwd);
    if (!allFrameworks.primary) {
      return {
        ok: false,
        error: `No recognized test framework found. Supported: ${Object.keys({ ...NODE_FRAMEWORKS, ...OTHER_FRAMEWORKS }).join(', ')}`,
        data: {
          llmEnhanced: false,
          llmProvider: llm.getProviderName(),
        },
        warnings: [],
        nextActions: [],
      };
    }
    detectedInfo = allFrameworks.primary;
  }

  // 2. 构建命令
  let cmd = watch && detectedInfo.watchCommand
    ? detectedInfo.watchCommand
    : detectedInfo.runCommand;

  // 范围过滤
  if (scope && scope !== 'all') {
    const scopeFilters = {
      unit: detectedInfo.framework === 'vitest' || detectedInfo.framework === 'jest'
        ? '--testPathPattern="src/(?!.*e2e|.*integration)"'
        : '',
      e2e: detectedInfo.framework === 'playwright' ? '' :
          detectedInfo.framework === 'cypress' ? '' :
          '--testPathPattern="e2e"',
      integration: '--testPathPattern="integration"',
      changed: '--onlyChanged',
    };
    const filter = scopeFilters[scope];
    if (filter) cmd += ` ${filter}`;
  }

  // 指定测试文件
  if (testPath) {
    cmd += ` ${testPath}`;
  }

  // watch 模式直接返回命令信息（不实际执行，因为是长驻进程）
  if (watch) {
    return {
      ok: true,
      data: {
        summary: `👁 Watch mode ready: ${cmd}`,
        framework: detectedInfo.framework,
        ecosystem: detectedInfo.ecosystem,
        command: cmd,
        watch: true,
        scope,
        llmEnhanced: false,
        llmProvider: llm.getProviderName(),
      },
      warnings: ['Watch mode is long-running. Start it manually in a terminal.'],
      nextActions: [`Run: ${cmd}`],
    };
  }

  // 3. 执行测试
  const startTime = Date.now();
  const execResult = await safeExec(cmd, { cwd, timeout: 240_000 }); // 测试运行允许更长时间
  const duration = Date.now() - startTime;

  // 4. 尝试解析 JSON 报告（更准确）
  let detailedResult = null;
  try {
    detailedResult = await parseJsonReport(cwd, detectedInfo.framework);
  } catch { /* 忽略 */ }

  // 5. 解析文本输出（作为 fallback）
  const parsedResult = parseTestOutput(execResult.stdout, execResult.stderr, detectedInfo.framework);

  // 6. 合并结果
  const result = detailedResult || parsedResult;
  const passed = result.passed || 0;
  const failed = result.failed || 0;
  const skipped = result.skipped || 0;
  const total = result.total || passed + failed + skipped;

  // 7. 失败分类
  const failedTests = [];
  if (execResult.exitCode !== 0) {
    const output = execResult.stdout + '\n' + execResult.stderr;
    const failureRegex = /[✗✕✘]?\s*(.+?)\n\s*(?:Error|AssertionError|TypeError|ReferenceError|SyntaxError)[:\s]+(.+)/g;
    let match;
    while ((match = failureRegex.exec(output)) !== null && failedTests.length < 10) {
      const testName = match[1].trim();
      const errorMsg = match[2].trim();
      failedTests.push({
        testName,
        error: errorMsg.slice(0, 200),
        category: classifyFailure(errorMsg),
        suggestion: FAILURE_SUGGESTIONS[classifyFailure(errorMsg)],
      });
    }
  }

  // 8. LLM 失败分析
  let failureAnalysis = null;
  if (execResult.exitCode !== 0 && llm.isAvailable()) {
    try {
      const analysisResult = await llm.callLLM({
        system: `你是一个资深测试工程师。分析测试失败的原因，并给出具体的修复建议。

输出格式要求（JSON）：
{
  "rootCause": "根本原因简述",
  "failedTests": [
    {"testName": "测试名称", "error": "错误信息摘要", "cause": "失败原因分析", "category": "logic-error|type-error|integration-error|performance-issue|missing-dependency|unknown"}
  ],
  "fixSuggestions": [
    {"priority": "high|medium|low", "description": "修复建议描述", "action": "具体操作步骤"}
  ],
  "summary": "一句话总结"
}`,
        messages: [{
          role: 'user',
          content: `测试执行失败，请分析失败原因并给出修复建议。

## 测试框架
${detectedInfo.framework}

## 测试命令
${cmd}

## 测试输出（stdout）
\`\`\`
${execResult.stdout.slice(-4000)}
\`\`\`

## 错误输出（stderr）
\`\`\`
${execResult.stderr.slice(-4000)}
\`\`\`

## 失败统计
通过: ${passed}, 失败: ${failed}, 跳过: ${skipped}, 总计: ${total}

请以 JSON 格式输出分析结果：`,
        }],
        temperature: 0.2,
        maxTokens: 4096,
      });

      if (analysisResult.ok) {
        try {
          const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
          failureAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisResult.content);
        } catch {
          failureAnalysis = {
            summary: 'Failed to parse LLM analysis as JSON',
            raw: analysisResult.content.slice(0, 1000),
          };
        }
      }
    } catch {
      // 静默回退
    }
  }

  // 9. 构建返回结果
  const allPassed = execResult.exitCode === 0 && failed === 0;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    ok: allPassed,
    data: {
      summary: allPassed
        ? `✅ ${passed}/${total} tests passed (${passRate}%)`
        : `❌ ${failed}/${total} tests failed (${passRate}% pass rate)`,
      framework: detectedInfo.framework,
      ecosystem: detectedInfo.ecosystem,
      command: cmd,
      exitCode: execResult.exitCode,
      duration: duration > 0 ? duration : result.duration || 0,
      passed,
      failed,
      skipped,
      total,
      passRate,
      scope,
      failedTests: failedTests.length > 0 ? failedTests : undefined,
      failureAnalysis,
      timedOut: execResult.timedOut,
      llmEnhanced: !!failureAnalysis,
      llmProvider: llm.getProviderName(),
    },
    warnings: [
      ...(execResult.timedOut ? ['Test execution timed out'] : []),
      ...(total === 0 ? ['No tests found'] : []),
    ],
    nextActions: !allPassed
      ? (failureAnalysis
          ? ['Review failure analysis', 'Apply suggested fixes', 'Re-run tests']
          : ['Fix failing tests, then re-run'])
      : ['Review coverage report', 'Check code patterns compliance'],
  };
}

// ============================================================
// 命令实现：coverage
// ============================================================

async function coverage({ projectRoot, framework, threshold = 80, diff = null, scope = 'all' }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检测框架
  let detectedInfo;
  if (framework) {
    const fw = NODE_FRAMEWORKS[framework] || OTHER_FRAMEWORKS[framework];
    if (!fw) {
      return {
        ok: false,
        error: `Unsupported framework: ${framework}`,
        data: { llmEnhanced: false, llmProvider: llm.getProviderName() },
        warnings: [],
        nextActions: [],
      };
    }
    detectedInfo = {
      framework,
      ecosystem: fw.ecosystem || 'node',
      coverageCommand: fw.coverageCommand,
    };
  } else {
    const allFrameworks = await detectAllFrameworks(cwd);
    if (!allFrameworks.primary) {
      return {
        ok: false,
        error: 'No recognized test framework found.',
        data: { llmEnhanced: false, llmProvider: llm.getProviderName() },
        warnings: [],
        nextActions: [],
      };
    }
    detectedInfo = allFrameworks.primary;
  }

  // 2. 执行覆盖率命令
  const startTime = Date.now();
  const execResult = await safeExec(detectedInfo.coverageCommand, { cwd, timeout: 240_000 });
  const duration = Date.now() - startTime;

  // 3. 解析覆盖率报告
  const coverageReport = await parseCoverageReport(cwd, detectedInfo.framework);

  // 4. 阈值检查
  let coverageOk = false;
  let totalCoverage = 0;
  let lowCoverageFiles = [];

  if (coverageReport) {
    totalCoverage = coverageReport.total.lines;
    coverageOk = totalCoverage >= threshold;

    // 找出覆盖率低的文件
    if (coverageReport.byFile) {
      lowCoverageFiles = coverageReport.byFile
        .filter(f => f.lines < threshold)
        .sort((a, b) => a.lines - b.lines)
        .slice(0, 20);
    }
  } else {
    // 启发式：从输出中提取覆盖率
    const output = execResult.stdout + '\n' + execResult.stderr;
    const covMatch = output.match(/(?:Lines|Coverage).*?(\d+\.?\d*)%/i);
    if (covMatch) {
      totalCoverage = parseFloat(covMatch[1]);
      coverageOk = totalCoverage >= threshold;
    }
  }

  // 5. LLM 覆盖率分析
  let coverageAnalysis = null;
  if (llm.isAvailable() && lowCoverageFiles.length > 0) {
    try {
      const analysisResult = await llm.callLLM({
        system: `你是一个资深测试工程师。分析代码覆盖率缺口，给出补充测试的具体建议。

输出格式要求（JSON）：
{
  "overallAssessment": "覆盖率整体评估",
  "gapAnalysis": [
    {"file": "文件名", "coverage": "当前覆盖率", "reason": "覆盖率低的原因分析", "suggestion": "补测试建议"}
  ],
  "priorityFiles": ["优先补测试的文件列表"],
  "testStrategies": [
    {"type": "unit|integration|e2e", "description": "策略描述", "impact": "预期提升百分比"}
  ],
  "summary": "一句话总结"
}`,
        messages: [{
          role: 'user',
          content: `请分析以下覆盖率数据，给出补充测试的建议：

## 测试框架
${detectedInfo.framework}

## 总体覆盖率
${totalCoverage}% (阈值: ${threshold}%)

## 覆盖率最低的文件（前 ${Math.min(lowCoverageFiles.length, 10)} 个）
${lowCoverageFiles.slice(0, 10).map(f => `- ${f.file}: ${f.lines}% lines, ${f.functions}% functions, ${f.branches}% branches`).join('\n')}

请以 JSON 格式输出分析结果：`,
        }],
        temperature: 0.2,
        maxTokens: 4096,
      });

      if (analysisResult.ok) {
        try {
          const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
          coverageAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisResult.content);
        } catch {
          coverageAnalysis = { summary: 'Failed to parse LLM coverage analysis', raw: analysisResult.content.slice(0, 500) };
        }
      }
    } catch {
      // 静默回退
    }
  }

  // 6. 返回结果
  return {
    ok: coverageOk,
    data: {
      summary: coverageOk
        ? `✅ Coverage ${totalCoverage}% >= ${threshold}% threshold`
        : `⚠️ Coverage ${totalCoverage}% < ${threshold}% threshold`,
      framework: detectedInfo.framework,
      ecosystem: detectedInfo.ecosystem,
      threshold,
      total: {
        lines: coverageReport?.total?.lines ?? totalCoverage,
        statements: coverageReport?.total?.statements ?? 0,
        functions: coverageReport?.total?.functions ?? 0,
        branches: coverageReport?.total?.branches ?? 0,
      },
      coverageOk,
      lowCoverageFiles,
      totalFiles: coverageReport?.byFile?.length || 0,
      duration,
      exitCode: execResult.exitCode,
      coverageAnalysis,
      llmEnhanced: !!coverageAnalysis,
      llmProvider: llm.getProviderName(),
    },
    warnings: [
      ...(!coverageReport ? ['Could not parse detailed coverage report, using heuristic estimate'] : []),
      ...(!coverageOk ? [`Coverage below threshold (${totalCoverage}% < ${threshold}%)`] : []),
    ],
    nextActions: !coverageOk
      ? (coverageAnalysis
          ? ['Review coverage analysis', 'Add tests for low-coverage files', 'Re-run coverage check']
          : ['Add tests for low-coverage files', 'Re-run coverage check'])
      : ['Maintain coverage level', 'Review edge case coverage'],
  };
}

// ============================================================
// 命令实现：report
// ============================================================

async function report({ projectRoot, framework, format = 'summary', includeSlowTests = true, slowThresholdMs = 1000 }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检测框架
  let detectedInfo;
  if (framework) {
    const fw = NODE_FRAMEWORKS[framework] || OTHER_FRAMEWORKS[framework];
    if (!fw) {
      return { ok: false, error: `Unsupported framework: ${framework}`, data: { llmEnhanced: false, llmProvider: llm.getProviderName() }, warnings: [], nextActions: [] };
    }
    detectedInfo = { framework, ecosystem: fw.ecosystem || 'node' };
  } else {
    const allFrameworks = await detectAllFrameworks(cwd);
    if (!allFrameworks.primary) {
      return { ok: false, error: 'No recognized test framework found.', data: { llmEnhanced: false, llmProvider: llm.getProviderName() }, warnings: [], nextActions: [] };
    }
    detectedInfo = allFrameworks.primary;
  }

  // 2. 扫描测试文件
  const testFiles = await scanTestFiles(cwd);

  // 3. 统计
  const byType = {};
  let totalCases = 0;
  let totalDescribes = 0;

  for (const tf of testFiles) {
    if (!byType[tf.type]) byType[tf.type] = { count: 0, cases: 0 };
    byType[tf.type].count++;
    byType[tf.type].cases += tf.caseCount.total;
    totalCases += tf.caseCount.total;
    totalDescribes += tf.caseCount.describes;
  }

  // 4. 尝试读取最近的测试结果
  let testResults = null;
  try {
    testResults = await parseJsonReport(cwd, detectedInfo.framework);
  } catch { /* 忽略 */ }

  // 5. 查找未测试的源文件
  const untestedSources = await findUntestedSourceFiles(cwd, testFiles);

  // 6. LLM 测试质量分析
  let qualityAnalysis = null;
  if (llm.isAvailable() && testFiles.length > 0) {
    try {
      const analysisResult = await llm.callLLM({
        system: `你是一个资深测试架构师。分析测试套件的质量，给出改进建议。

输出格式要求（JSON）：
{
  "qualityScore": 0-100,
  "strengths": ["测试做得好的方面"],
  "weaknesses": ["测试薄弱的方面"],
  "recommendations": [
    {"priority": "high|medium|low", "area": "领域", "description": "改进建议", "expectedBenefit": "预期收益"}
  ],
  "testTypesBalance": {
    "unit": "合理/过多/不足",
    "integration": "合理/过多/不足",
    "e2e": "合理/过多/不足"
  },
  "summary": "一句话总结"
}`,
        messages: [{
          role: 'user',
          content: `请分析以下测试套件的质量：

## 测试框架
${detectedInfo.framework}

## 测试文件统计
- 总测试文件数: ${testFiles.length}
- 总测试用例数: ~${totalCases}
- 按类型分布:
${Object.entries(byType).map(([type, data]) => `  - ${type}: ${data.count} files, ~${data.cases} cases`).join('\n')}

## 最近测试结果
${testResults ? `通过: ${testResults.passed}, 失败: ${testResults.failed}, 跳过: ${testResults.skipped}` : '暂无'}

## 未覆盖的源文件数量
${untestedSources.length} 个

请以 JSON 格式输出分析结果：`,
        }],
        temperature: 0.2,
        maxTokens: 4096,
      });

      if (analysisResult.ok) {
        try {
          const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
          qualityAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisResult.content);
        } catch {
          qualityAnalysis = { summary: 'Failed to parse LLM quality analysis', raw: analysisResult.content.slice(0, 500) };
        }
      }
    } catch {
      // 静默回退
    }
  }

  // 7. 构建报告
  const passRate = testResults && testResults.total > 0
    ? Math.round((testResults.passed / testResults.total) * 100)
    : null;

  return {
    ok: true,
    data: {
      summary: `📊 Test Report: ${testFiles.length} files, ~${totalCases} cases${passRate !== null ? `, ${passRate}% pass rate` : ''}`,
      framework: detectedInfo.framework,
      ecosystem: detectedInfo.ecosystem,
      testFiles: {
        total: testFiles.length,
        byType,
        totalCases,
        totalDescribes,
        files: format === 'detailed' ? testFiles.map(tf => ({
          path: tf.path,
          type: tf.type,
          cases: tf.caseCount.total,
        })) : undefined,
      },
      lastRun: testResults ? {
        passed: testResults.passed,
        failed: testResults.failed,
        skipped: testResults.skipped,
        total: testResults.total,
        passRate,
      } : null,
      untestedSources: {
        count: untestedSources.length,
        files: format === 'detailed' ? untestedSources.slice(0, 50) : undefined,
      },
      qualityAnalysis,
      llmEnhanced: !!qualityAnalysis,
      llmProvider: llm.getProviderName(),
    },
    warnings: [
      ...(untestedSources.length > 10 ? [`${untestedSources.length} source files have no tests`] : []),
      ...(testResults === null ? ['No recent test results found. Run tests first.'] : []),
    ],
    nextActions: [
      qualityAnalysis ? 'Review quality analysis and apply recommendations' : 'Review test coverage gaps',
      'Add tests for untested source files',
      'Run tests to verify current status',
    ],
  };
}

// ============================================================
// 命令实现：list
// ============================================================

async function list({ projectRoot, type = 'all', pattern = null, limit = 100 }) {
  const cwd = projectRoot || process.cwd();

  // 扫描测试文件
  const testFiles = await scanTestFiles(cwd);

  // 按类型过滤
  let filtered = testFiles;
  if (type && type !== 'all') {
    filtered = testFiles.filter(tf => tf.type === type);
  }

  // 按文件名模式过滤
  if (pattern) {
    const regex = new RegExp(pattern, 'i');
    filtered = filtered.filter(tf => regex.test(tf.path));
  }

  // 限制数量
  const limited = filtered.slice(0, limit);

  // 统计
  const byType = {};
  let totalCases = 0;
  for (const tf of filtered) {
    if (!byType[tf.type]) byType[tf.type] = { count: 0, cases: 0 };
    byType[tf.type].count++;
    byType[tf.type].cases += tf.caseCount.total;
    totalCases += tf.caseCount.total;
  }

  return {
    ok: true,
    data: {
      summary: `📋 Found ${filtered.length} test files (~${totalCases} cases)`,
      total: filtered.length,
      totalCases,
      byType,
      files: limited.map(tf => ({
        path: tf.path,
        fileName: tf.fileName,
        type: tf.type,
        caseCount: tf.caseCount.total,
        describeCount: tf.caseCount.describes,
      })),
      truncated: filtered.length > limit,
      limit,
      llmEnhanced: false,
      llmProvider: llm.getProviderName(),
    },
    warnings: filtered.length > limit ? [`Showing first ${limit} of ${filtered.length} files`] : [],
    nextActions: [
      'Run tests with test-runner.run',
      'Generate coverage report with test-runner.coverage',
    ],
  };
}

// ============================================================
// 命令实现：init
// ============================================================

async function init({ projectRoot, framework = null, testType = 'unit', projectType = null }) {
  const cwd = projectRoot || process.cwd();

  // 1. 检测项目类型
  let detectedFramework = framework;
  let detectedProjectType = projectType;
  let packageJson = null;

  try {
    packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'));
  } catch { /* 忽略 */ }

  if (packageJson && !detectedProjectType) {
    const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    if (deps.react || deps['react-dom']) detectedProjectType = 'react';
    else if (deps.vue) detectedProjectType = 'vue';
    else if (deps.next) detectedProjectType = 'nextjs';
    else if (deps['@angular/core']) detectedProjectType = 'angular';
    else if (deps.svelte) detectedProjectType = 'svelte';
    else if (deps.typescript) detectedProjectType = 'typescript';
    else detectedProjectType = 'node';
  }

  if (!detectedProjectType) {
    if (await fileExists(path.join(cwd, 'pyproject.toml'))) detectedProjectType = 'python';
    else if (await fileExists(path.join(cwd, 'go.mod'))) detectedProjectType = 'go';
    else if (await fileExists(path.join(cwd, 'Cargo.toml'))) detectedProjectType = 'rust';
    else if (await fileExists(path.join(cwd, 'pom.xml'))) detectedProjectType = 'java';
    else detectedProjectType = 'node';
  }

  // 2. 确定推荐框架
  if (!detectedFramework) {
    const recommendations = {
      react: 'vitest',
      vue: 'vitest',
      nextjs: 'vitest',
      angular: 'karma',
      svelte: 'vitest',
      typescript: 'vitest',
      node: 'jest',
      python: 'pytest',
      go: 'go',
      rust: 'cargo',
      java: 'maven',
    };
    detectedFramework = recommendations[detectedProjectType] || 'vitest';
  }

  // 3. 生成配置建议
  const configTemplates = generateConfigTemplate(detectedFramework, detectedProjectType, testType);

  // 4. 依赖安装建议
  const depsToInstall = getDependenciesToInstall(detectedFramework, detectedProjectType, testType);

  // 5. LLM 配置推荐
  let llmRecommendation = null;
  if (llm.isAvailable()) {
    try {
      const recResult = await llm.callLLM({
        system: `你是一个资深测试架构师。根据项目类型推荐最佳测试配置方案。

输出格式要求（JSON）：
{
  "recommendedFramework": "推荐的框架",
  "recommendedTools": ["推荐的工具列表"],
  "folderStructure": "推荐的目录结构",
  "configurationTips": ["配置建议列表"],
  "bestPractices": ["最佳实践列表"],
  "installCommand": "安装命令",
  "summary": "一句话总结"
}`,
        messages: [{
          role: 'user',
          content: `请为以下项目推荐最佳测试配置：

## 项目类型
${detectedProjectType}

## 目标框架
${detectedFramework}

## 测试类型
${testType}

${packageJson ? `## package.json 依赖\n\`\`\`json\n${JSON.stringify(packageJson.dependencies || {}, null, 2)}\n\`\`\`` : ''}

请以 JSON 格式输出推荐方案：`,
        }],
        temperature: 0.2,
        maxTokens: 4096,
      });

      if (recResult.ok) {
        try {
          const jsonMatch = recResult.content.match(/\{[\s\S]*\}/);
          llmRecommendation = JSON.parse(jsonMatch ? jsonMatch[0] : recResult.content);
        } catch {
          llmRecommendation = { summary: 'Failed to parse LLM recommendation', raw: recResult.content.slice(0, 500) };
        }
      }
    } catch {
      // 静默回退
    }
  }

  // 6. 检查是否已经有配置
  const existingConfigs = [];
  const fw = NODE_FRAMEWORKS[detectedFramework];
  if (fw) {
    for (const configFile of fw.configFiles) {
      if (await fileExists(path.join(cwd, configFile))) {
        existingConfigs.push(configFile);
      }
    }
  }

  return {
    ok: true,
    data: {
      summary: `🚀 Test setup ready for ${detectedFramework} (${detectedProjectType})`,
      projectType: detectedProjectType,
      framework: detectedFramework,
      testType,
      configTemplate: configTemplates,
      dependencies: depsToInstall,
      existingConfigs,
      llmRecommendation,
      llmEnhanced: !!llmRecommendation,
      llmProvider: llm.getProviderName(),
    },
    warnings: [
      ...(existingConfigs.length > 0 ? [`Config already exists: ${existingConfigs.join(', ')}`] : []),
    ],
    nextActions: [
      `Install dependencies: ${depsToInstall.installCommand}`,
      'Create test configuration file',
      'Create tests directory structure',
      'Write your first test',
    ],
  };
}

// 生成配置模板
function generateConfigTemplate(framework, projectType, testType) {
  const templates = {
    vitest: {
      fileName: 'vitest.config.ts',
      content: `import { defineConfig } from 'vitest/config';${projectType === 'react' ? `\nimport react from '@vitejs/plugin-react';` : ''}
${projectType === 'vue' ? `\nimport vue from '@vitejs/plugin-vue';` : ''}

export default defineConfig({
  plugins: [${projectType === 'react' ? 'react()' : projectType === 'vue' ? 'vue()' : ''}],
  test: {
    globals: true,
    environment: '${projectType === 'react' || projectType === 'vue' || projectType === 'nextjs' ? 'jsdom' : 'node'}',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.types.ts',
        'src/**/index.ts',
        'src/main.tsx',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
`,
    },
    jest: {
      fileName: 'jest.config.js',
      content: `/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: '${projectType === 'react' || projectType === 'vue' ? 'jsdom' : 'node'}',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx,js,jsx}',
    '<rootDir>/src/**/*.{test,spec}.{ts,tsx,js,jsx}',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx,js,jsx}',
    '!src/**/*.d.ts',
    '!src/**/*.types.ts',
    '!src/main.tsx',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
  transform: {
    '^.+\\\\.(ts|tsx)$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
`,
    },
    mocha: {
      fileName: '.mocharc.json',
      content: JSON.stringify({
        require: ['ts-node/register', 'source-map-support/register'],
        spec: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
        recursive: true,
        timeout: 5000,
        reporter: 'spec',
      }, null, 2),
    },
    playwright: {
      fileName: 'playwright.config.ts',
      content: `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
`,
    },
    cypress: {
      fileName: 'cypress.config.js',
      content: `const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.js',
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
  component: {
    devServer: {
      framework: '${projectType === 'react' ? 'react' : projectType === 'vue' ? 'vue' : 'react'}',
      bundler: 'vite',
    },
  },
});
`,
    },
    karma: {
      fileName: 'karma.conf.js',
      content: `module.exports = function(config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '${projectType === 'angular' ? '@angular-devkit/build-angular' : 'typescript'}'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-coverage'),
      require('karma-jasmine-html-reporter'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    jasmineHtmlReporter: {
      suppressAll: true,
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage'),
      subdir: '.',
      reporters: [
        { type: 'html' },
        { type: 'text-summary' },
      ],
    },
    reporters: ['progress', 'kjhtml'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    singleRun: false,
    restartOnFileChange: true,
  });
};
`,
    },
    pytest: {
      fileName: 'pytest.ini',
      content: `[pytest]
testpaths = tests
python_files = test_*.py *_test.py
python_classes = Test*
python_functions = test_*
addopts =
    --strict-markers
    --cov=src
    --cov-report=term-missing
    --cov-report=html
    --cov-report=json
    -v
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
    e2e: marks tests as end-to-end tests
`,
    },
  };

  return templates[framework] || null;
}

// 获取需要安装的依赖
function getDependenciesToInstall(framework, projectType, testType) {
  const depMap = {
    vitest: {
      devDependencies: ['vitest', '@vitest/coverage-v8'],
      optional: [
        projectType === 'react' && '@vitejs/plugin-react',
        projectType === 'vue' && '@vitejs/plugin-vue',
        (projectType === 'react' || projectType === 'vue') && 'jsdom',
        '@testing-library/jest-dom',
        projectType === 'react' && '@testing-library/react',
        projectType === 'vue' && '@testing-library/vue',
        'msw',
      ].filter(Boolean),
    },
    jest: {
      devDependencies: ['jest', 'ts-jest', '@types/jest', 'jest-environment-jsdom'],
      optional: [
        '@testing-library/jest-dom',
        projectType === 'react' && '@testing-library/react',
        projectType === 'vue' && '@testing-library/vue',
        'msw',
      ].filter(Boolean),
    },
    mocha: {
      devDependencies: ['mocha', 'ts-node', 'chai', '@types/mocha', '@types/chai', 'nyc'],
      optional: ['sinon', '@types/sinon', 'supertest'],
    },
    playwright: {
      devDependencies: ['@playwright/test'],
      optional: [],
    },
    cypress: {
      devDependencies: ['cypress'],
      optional: ['@cypress/code-coverage', '@testing-library/cypress'],
    },
    karma: {
      devDependencies: ['karma', 'karma-jasmine', 'karma-chrome-launcher', 'karma-coverage', 'karma-jasmine-html-reporter'],
      optional: [],
    },
    pytest: {
      devDependencies: ['pytest', 'pytest-cov'],
      optional: ['pytest-mock', 'pytest-asyncio', 'httpx', 'pytest-xdist'],
    },
  };

  const deps = depMap[framework] || { devDependencies: [], optional: [] };

  const installCommands = {
    vitest: `npm install -D ${deps.devDependencies.join(' ')}`,
    jest: `npm install -D ${deps.devDependencies.join(' ')}`,
    mocha: `npm install -D ${deps.devDependencies.join(' ')}`,
    playwright: `npm install -D ${deps.devDependencies.join(' ')} && npx playwright install`,
    cypress: `npm install -D ${deps.devDependencies.join(' ')}`,
    karma: `npm install -D ${deps.devDependencies.join(' ')}`,
    pytest: `pip install pytest pytest-cov`,
  };

  return {
    devDependencies: deps.devDependencies,
    optionalDependencies: deps.optional,
    installCommand: installCommands[framework] || '',
    scripts: {
      test: framework === 'vitest' ? 'vitest run' :
            framework === 'jest' ? 'jest' :
            framework === 'mocha' ? 'mocha' :
            framework === 'playwright' ? 'playwright test' :
            framework === 'cypress' ? 'cypress run' :
            framework === 'karma' ? 'karma start --single-run' :
            'pytest',
      'test:watch': framework === 'vitest' ? 'vitest' :
                    framework === 'jest' ? 'jest --watch' :
                    framework === 'mocha' ? 'mocha --watch' :
                    framework === 'karma' ? 'karma start' :
                    'pytest -f',
      'test:coverage': framework === 'vitest' ? 'vitest run --coverage' :
                       framework === 'jest' ? 'jest --coverage' :
                       framework === 'mocha' ? 'nyc mocha' :
                       framework === 'playwright' ? 'playwright test --coverage' :
                       framework === 'cypress' ? 'cypress run --env coverage=true' :
                       'pytest --cov',
    },
  };
}

// ============================================================
// 命令实现：generate（保留，向后兼容）
// ============================================================

async function generate({ projectRoot, sourceFile, framework, outputFile }) {
  const cwd = projectRoot || process.cwd();
  const sourcePath = path.resolve(cwd, sourceFile);

  // 1. 读取源文件
  let sourceCode;
  try {
    sourceCode = await fs.readFile(sourcePath, 'utf-8');
  } catch (e) {
    return {
      ok: false,
      error: `Failed to read source file: ${e.message}`,
      warnings: [],
      nextActions: [],
    };
  }

  // 2. 检测测试框架
  let testFramework = framework;
  let detected = null;
  if (!testFramework) {
    detected = await detectFramework(cwd);
    if (!detected) {
      return {
        ok: false,
        error: 'No test framework detected. Specify framework or ensure project has a supported test framework.',
        warnings: [],
        nextActions: [],
      };
    }
    testFramework = detected.framework;
  }

  // 检测语言
  const language = detectLanguage(sourcePath);

  // 确定输出文件路径
  let targetOutputFile = outputFile;
  if (!targetOutputFile) {
    const ext = path.extname(sourcePath);
    const base = sourcePath.slice(0, -ext.length);
    const testExt = testFramework === 'pytest' ? `_test${ext}` : `.test${ext}`;
    targetOutputFile = `${base}${testExt}`;
  } else {
    targetOutputFile = path.resolve(cwd, targetOutputFile);
  }

  // 3. 调用 llm.generateTests() 生成测试代码
  if (!llm.isAvailable()) {
    return {
      ok: false,
      error: 'LLM is not available. Cannot generate tests without an LLM provider.',
      warnings: [],
      nextActions: [],
    };
  }

  let generatedCode;
  try {
    const result = await llm.generateTests({
      sourceCode,
      testFramework,
      targetFile: targetOutputFile,
      language,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: `LLM test generation failed: ${result.error}`,
        warnings: [],
        nextActions: [],
      };
    }
    generatedCode = result.code;
  } catch (e) {
    return {
      ok: false,
      error: `LLM test generation error: ${e.message}`,
      warnings: [],
      nextActions: [],
    };
  }

  // 4. 写入测试文件
  try {
    const outputDir = path.dirname(targetOutputFile);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(targetOutputFile, generatedCode, 'utf-8');
  } catch (e) {
    return {
      ok: false,
      error: `Failed to write test file: ${e.message}`,
      warnings: [],
      nextActions: [],
    };
  }

  // 5. 返回结果
  return {
    ok: true,
    data: {
      summary: `✅ Test file generated: ${path.relative(cwd, targetOutputFile)}`,
      sourceFile: path.relative(cwd, sourcePath),
      outputFile: path.relative(cwd, targetOutputFile),
      framework: testFramework,
      language,
      llmEnhanced: true,
      llmProvider: llm.getProviderName(),
    },
    warnings: [],
    nextActions: ['Review generated tests', 'Run tests to verify'],
  };
}

// ============================================================
// 命令实现：contract（保留，向后兼容）
// ============================================================

async function contract({ projectRoot, fromFiles }) {
  const cwd = projectRoot || process.cwd();

  if (!fromFiles || !Array.isArray(fromFiles) || fromFiles.length === 0) {
    return { ok: false, error: 'fromFiles is required', warnings: [], nextActions: [] };
  }

  // 检查每个文件存在
  const existing = [];
  const missing = [];
  for (const f of fromFiles) {
    if (await fileExists(path.resolve(cwd, f))) {
      existing.push(f);
    } else {
      missing.push(f);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing contract files: ${missing.join(', ')}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [`Existing: ${existing.length}`],
      nextActions: [],
    };
  }

  // 简单契约校验（每个 YAML 必须是合法 JSON）
  const issues = [];
  const fileContents = [];
  for (const f of existing) {
    try {
      const content = await fs.readFile(path.resolve(cwd, f), 'utf-8');
      fileContents.push({ file: f, content });
      JSON.parse(content); // 简单校验：必须是合法 JSON
    } catch (e) {
      issues.push({ file: f, error: e.message });
    }
  }

  // LLM 契约一致性分析
  let llmFindings = null;
  if (llm.isAvailable() && fileContents.length > 0) {
    try {
      const allContent = fileContents
        .map(({ file, content }) => `## 文件: ${file}\n\`\`\`json\n${content.slice(0, 6000)}\n\`\`\``)
        .join('\n\n');

      const analysisResult = await llm.callLLM({
        system: `你是一个资深 API 契约审查工程师。分析 OpenAPI/REST 契约文件的一致性和质量。

输出格式要求（JSON）：
{
  "consistencyScore": 0-100,
  "findings": [
    {"severity": "critical|major|minor|info", "category": "consistency|security|completeness|documentation", "file": "文件名", "description": "问题描述", "suggestion": "改进建议"}
  ],
  "summary": "一句话总结"
}

重点检查：
- 多个契约文件之间的一致性（相同模型定义是否一致）
- 请求/响应结构的完整性
- 错误处理定义
- 安全相关定义（认证、权限）
- 文档完整性`,
        messages: [{
          role: 'user',
          content: `请分析以下契约文件的一致性和质量：

${allContent}

请以 JSON 格式输出分析结果：`,
        }],
        temperature: 0.1,
        maxTokens: 4096,
      });

      if (analysisResult.ok) {
        try {
          const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
          llmFindings = JSON.parse(jsonMatch ? jsonMatch[0] : analysisResult.content);
        } catch {
          llmFindings = {
            summary: 'Failed to parse LLM contract analysis as JSON',
            raw: analysisResult.content,
          };
        }
      }
    } catch {
      // 静默回退：LLM 分析失败不影响主流程
    }
  }

  return {
    ok: issues.length === 0,
    data: {
      summary: issues.length === 0
        ? `✅ All ${existing.length} contract files valid`
        : `❌ ${issues.length} files invalid`,
      filesValidated: existing.length,
      issues,
      llmFindings,
      llmEnhanced: !!llmFindings,
      llmProvider: llm.getProviderName(),
    },
    warnings: missing.length > 0 ? [`Skipped ${missing.length} missing files`] : [],
    nextActions: issues.length === 0
      ? ['Run /implement-executor to start coding']
      : ['Fix contract file issues'],
  };
}

// ============================================================
// 命令实现：detect（框架检测工具命令）
// ============================================================

async function detect({ projectRoot }) {
  const result = await detectAllFrameworks(projectRoot);

  return {
    ok: true,
    data: {
      summary: result.frameworks.length > 0
        ? `🔍 Detected ${result.frameworks.length} test framework(s): ${result.frameworkNames.join(', ')}`
        : '⚠️ No test framework detected',
      frameworks: result.frameworks.map(f => ({
        framework: f.framework,
        name: f.name,
        ecosystem: f.ecosystem,
        confidence: f.confidence,
        hasDep: f.hasDep,
        hasConfig: f.hasConfig,
        hasScript: f.hasScript,
        runCommand: f.runCommand,
        watchCommand: f.watchCommand,
        coverageCommand: f.coverageCommand,
      })),
      primaryFramework: result.primary?.name || null,
      ecosystem: result.ecosystem,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: result.frameworks.length === 0
      ? ['No test framework detected. Run /test.init to set up testing.']
      : [],
    nextActions: result.frameworks.length === 0
      ? ['Run /test.init to initialize test setup']
      : [`Run tests with ${result.primary?.name}`],
  };
}

// ============================================================
// 导出所有命令 + 别名
// ============================================================

module.exports = {
  // 主要命令
  run,
  coverage,
  report,
  list,
  init,
  generate,
  contract,
  detect,

  // 别名：test-runner.testRun 等
  testRun: run,
  testCoverage: coverage,
  testReport: report,
  testList: list,
  testInit: init,
  testGenerate: generate,
  testContract: contract,
  testDetect: detect,

  // 兼容旧版别名
  watch: run, // watch 模式通过 run({ watch: true }) 调用
  debug: detect,
  e2e: generate,

  // 内部工具函数导出（供其他 skill 调用）
  detectFramework,
  detectAllFrameworks,
  scanTestFiles,
  parseTestOutput,
  classifyFailure,
  FAILURE_SUGGESTIONS,
  countTestCases,
  analyzeTestFileAST,
};
