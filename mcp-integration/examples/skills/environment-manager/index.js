/**
 * environment-manager Skill - 完整实现
 *
 * 4 环境管理 + Secrets 注入 + 环境变量校验。
 * 支持 dev / test / staging / prod 四个环境。
 *
 * 命令：init / switch / list / validate / secrets / diff / set / get / inject / suggest
 *
 * 对应 MCP Tool: inject_secrets
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// ============================================================
// 常量定义
// ============================================================

const SUPPORTED_ENVS = ['dev', 'test', 'staging', 'prod'];

const ENV_DESCRIPTIONS = {
  dev: '本地开发环境 - 最低安全等级，频繁重置数据',
  test: '测试环境 - 自动化测试 / QA 验证',
  staging: '预生产环境 - production 镜像，部署前最后验证',
  prod: '生产环境 - 真实用户流量，最高安全等级',
};

const SUPPORTED_BACKENDS = ['dotenv', 'doppler', 'vault'];

// 敏感字段检测模式（用于 secrets scan）
const SENSITIVE_KEY_PATTERNS = [
  /PASSWORD$/i,
  /SECRET$/i,
  /SECRET_KEY$/i,
  /API_KEY$/i,
  /TOKEN$/i,
  /ACCESS_KEY$/i,
  /PRIVATE_KEY$/i,
  /CERTIFICATE$/i,
  /CREDENTIAL$/i,
  /AUTH$/i,
  /SIGNATURE$/i,
  /PASSPHRASE$/i,
  /ENCRYPTION/i,
  /JWT/i,
  /STRIPE/i,
  /AWS_SECRET/i,
  /GITHUB.*TOKEN/i,
  /SLACK.*TOKEN/i,
  /WEBHOOK.*SECRET/i,
  /SMTP.*PASSWORD/i,
  /DATABASE_URL/i,
  /REDIS_URL/i,
  /MONGO_URL/i,
];

// 占位符模式（检测未替换的占位符）
const PLACEHOLDER_PATTERNS = [
  /<CHANGE_ME>/i,
  /<PLACEHOLDER>/i,
  /your_/i,
  /example/i,
  /xxx$/i,
  /TODO/i,
  /FIXME/i,
];

// ============================================================
// 校验规则定义
// ============================================================

const VALIDATION_RULES = {
  // 类型校验：根据 key 模式自动推断
  typePatterns: {
    number: [/PORT$/, /TIMEOUT/, /MAX_/, /MIN_/, /LIMIT$/, /SIZE$/, /COUNT$/],
    boolean: [/^ENABLE/, /^DISABLE/, /^IS_/, /^HAS_/, /DEBUG$/, /VERBOSE$/, /SSL$/],
    url: [/URL$/, /URI$/, /ENDPOINT$/, /HOST$/],
    email: [/EMAIL$/, /MAIL$/],
    port: [/PORT$/],
    path: [/PATH$/, /DIR$/, /FILE$/],
  },

  // 枚举校验
  enumRules: {
    NODE_ENV: ['development', 'test', 'production', 'staging'],
    LOG_LEVEL: ['debug', 'info', 'warn', 'error', 'fatal', 'trace'],
    NODE_ENVIRONMENT: ['development', 'test', 'production', 'staging'],
  },

  // 范围校验
  rangeRules: {
    APP_PORT: { min: 1, max: 65535 },
    PORT: { min: 1, max: 65535 },
    JWT_EXPIRES_IN: { min: 60, unit: 'seconds' }, // 最少 60 秒
  },

  // 格式正则校验
  formatRules: {
    DATABASE_URL: /^postgresql?:\/\/.+/i,
    REDIS_URL: /^redis:\/\//i,
    MONGO_URL: /^mongodb(\+srv)?:\/\//i,
    JWT_SECRET: /^.{32,}$/,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    APP_URL: /^https?:\/\/.+/i,
    API_URL: /^https?:\/\/.+/i,
  },

  // 生产环境特殊校验
  productionRules: {
    noLocalhost: ['DATABASE_URL', 'REDIS_URL', 'APP_URL', 'API_URL', 'MONGO_URL'],
    noTestKeys: [
      { key: 'STRIPE_SECRET_KEY', pattern: /^sk_test_/i, expected: 'sk_live_' },
      { key: 'STRIPE_PUBLISHABLE_KEY', pattern: /^pk_test_/i, expected: 'pk_live_' },
    ],
    noPlaceholders: true,
    minSecretLength: {
      JWT_SECRET: 32,
      API_KEY: 32,
      PASSWORD: 12,
      STRIPE_SECRET_KEY: 20,
    },
  },
};

// ============================================================
// 安全工具函数
// ============================================================

function maskSecret(value) {
  if (!value || value.length < 8) return '***';
  return value.slice(0, 4) + '***' + value.slice(-4);
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
}

function detectPlaceholders(value) {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(value));
}

// ============================================================
// .env 解析工具
// ============================================================

function parseEnv(content) {
  const result = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

function stringifyEnv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
}

async function readEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseEnv(content);
  } catch {
    return null;
  }
}

async function writeEnvFile(filePath, obj, mode = 0o600) {
  const content = stringifyEnv(obj);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { mode });
}

// ============================================================
// 当前环境管理（通过 .env 文件或 .current-env 文件）
// ============================================================

const CURRENT_ENV_FILE = '.current-env';

async function getCurrentEnv(projectRoot) {
  const cwd = projectRoot || process.cwd();
  const envFilePath = path.join(cwd, CURRENT_ENV_FILE);
  try {
    const content = await fs.readFile(envFilePath, 'utf-8');
    const env = content.trim();
    if (SUPPORTED_ENVS.includes(env)) return env;
  } catch {
    // 文件不存在
  }
  return null;
}

async function setCurrentEnv(projectRoot, env) {
  const cwd = projectRoot || process.cwd();
  const envFilePath = path.join(cwd, CURRENT_ENV_FILE);
  await fs.writeFile(envFilePath, env + '\n', 'utf-8');

  // 同时更新 .env 符号链接/拷贝（兼容 dotenv 工具链）
  const targetEnvFile = path.join(cwd, `.env.${env}`);
  const dotEnvFile = path.join(cwd, '.env');
  try {
    const targetContent = await fs.readFile(targetEnvFile, 'utf-8');
    await fs.writeFile(dotEnvFile, targetContent, { mode: 0o600 });
  } catch {
    // 目标环境文件不存在，创建空的
    await fs.writeFile(dotEnvFile, `# Active environment: ${env}\n`, { mode: 0o600 });
  }
}

// ============================================================
// .gitignore 管理
// ============================================================

async function checkGitignore(gitignorePath) {
  return fs.readFile(gitignorePath, 'utf-8')
    .then(content => content.includes('.env'))
    .catch(() => false);
}

async function ensureGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const hasEnv = await checkGitignore(gitignorePath);

  if (!hasEnv) {
    const addition = `
# Environment & Secrets
.env
.env.local
.env.*.local
.env.dev
.env.test
.env.staging
.env.prod
.current-env
.secrets
*.pem
*.key
*.p12
secrets.json
`;
    await fs.appendFile(gitignorePath, addition, 'utf-8');
    return true;
  }
  return false;
}

// ============================================================
// .env.example 模板
// ============================================================

const ENV_EXAMPLE_TEMPLATE = `# ============================================================
# Environment Configuration Template
# 复制为 .env.{env} 并填入真实值
# ============================================================

# ---- Application ----
NODE_ENV=development
APP_PORT=3000
APP_URL=http://localhost:3000
APP_NAME=myapp
LOG_LEVEL=info
DEBUG=false

# ---- Database ----
DATABASE_URL=postgresql://user:pass@localhost:5432/myapp
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# ---- Cache ----
REDIS_URL=redis://localhost:6379
REDIS_DB=0

# ---- Authentication ----
JWT_SECRET=<CHANGE_ME: 32+ random chars>
JWT_EXPIRES_IN=86400
JWT_REFRESH_SECRET=<CHANGE_ME: 32+ random chars>

# ---- Third-party APIs (DO NOT commit real values) ----
STRIPE_SECRET_KEY=<sk_test_xxx>
STRIPE_PUBLISHABLE_KEY=<pk_test_xxx>
STRIPE_WEBHOOK_SECRET=<whsec_xxx>

# ---- AWS ----
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<CHANGE_ME>
AWS_SECRET_ACCESS_KEY=<CHANGE_ME>
AWS_S3_BUCKET=myapp-assets

# ---- Email / SMTP ----
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<CHANGE_ME>
SMTP_FROM=noreply@example.com

# ---- Monitoring (optional) ----
SENTRY_DSN=<https://xxx@sentry.io/xxx>
DATADOG_API_KEY=<CHANGE_ME>

# ---- Feature Flags ----
ENABLE_NEW_FEATURE=false
ENABLE_ANALYTICS=true
`;

const SECRETS_EXAMPLE_TEMPLATE = `# ============================================================
# Secrets Template
# 以下字段应通过 Secrets Manager 注入，不要硬编码在 .env 中
# ============================================================

# ---- Database Credentials ----
DATABASE_URL=postgresql://user:password@host:5432/dbname

# ---- Authentication Secrets ----
JWT_SECRET=your-jwt-secret-key-here-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-key-here-min-32-chars

# ---- API Keys ----
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_ACCESS_KEY_ID=xxx

# ---- SMTP ----
SMTP_PASSWORD=xxx

# ---- Monitoring ----
SENTRY_DSN=https://xxx@sentry.io/xxx
DATADOG_API_KEY=xxx

# ---- Encryption ----
ENCRYPTION_KEY=xxx
`;

// ============================================================
// 统一返回结构辅助
// ============================================================

function buildResult(base = {}) {
  return {
    ok: true,
    data: {
      llmEnhanced: false,
      llmProvider: null,
      ...(base.data || {}),
    },
    warnings: base.warnings || [],
    nextActions: base.nextActions || [],
  };
}

function buildError(error, extra = {}) {
  return {
    ok: false,
    error,
    data: {
      llmEnhanced: false,
      llmProvider: null,
      ...(extra.data || {}),
    },
    warnings: extra.warnings || [],
    nextActions: extra.nextActions || [],
  };
}

// ============================================================
// AST 增强分析：源码级环境变量使用检测
// ============================================================

/**
 * 扫描项目源码中的 process.env.XXX 引用，
 * 找出 .env 中声明但源码中未使用的变量，以及源码中使用但 .env 中缺失的变量。
 * @param {string} cwd - 项目根目录
 * @param {Object} envVars - .env 文件中解析出的变量
 * @returns {{astEnhanced: boolean, usedInSource: string[], declaredNotUsed: string[], usedNotDeclared: string[], hardcodedSecrets: Array, sourcesScanned: number}}
 */
async function scanSourceForEnvUsageAST(cwd, envVars) {
  const declaredKeys = new Set(Object.keys(envVars));
  const usedInSourceSet = new Set();
  const hardcodedSecrets = [];
  let sourcesScanned = 0;

  async function collectSourceFiles(dir, maxFiles = 50) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(entry.name)) continue;
        files.push(...await collectSourceFiles(fullPath, maxFiles - files.length));
      } else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  try {
    const sourceFiles = await collectSourceFiles(cwd);
    sourcesScanned = sourceFiles.length;

    for (const filePath of sourceFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');

        // 提取 process.env.XXX 引用
        const envAccesses = ast.extractProcessEnvAccesses(content);
        for (const access of envAccesses) {
          usedInSourceSet.add(access.key);
        }

        // 检测源码中硬编码的密钥
        const secrets = ast.detectHardcodedSecrets(content);
        for (const s of secrets) {
          hardcodedSecrets.push({
            file: path.relative(cwd, filePath),
            line: s.line,
            key: s.key,
          });
        }
      } catch {
        // 文件读取或 AST 解析失败，跳过
      }
    }
  } catch {
    return {
      astEnhanced: false,
      usedInSource: [],
      declaredNotUsed: [],
      usedNotDeclared: [],
      hardcodedSecrets: [],
      sourcesScanned: 0,
    };
  }

  const usedInSource = [...usedInSourceSet];
  const declaredNotUsed = [...declaredKeys].filter(k => !usedInSourceSet.has(k));
  const usedNotDeclared = usedInSource.filter(k => !declaredKeys.has(k));

  return {
    astEnhanced: true,
    usedInSource,
    declaredNotUsed,
    usedNotDeclared,
    hardcodedSecrets,
    sourcesScanned,
  };
}

// ============================================================
// init - 初始化环境配置
// ============================================================

async function init({ projectRoot, env = 'dev', force = false, projectType = 'node' }) {
  const cwd = projectRoot || process.cwd();

  if (!SUPPORTED_ENVS.includes(env)) {
    return buildError(`Unsupported env: ${env}. Allowed: ${SUPPORTED_ENVS.join(', ')}`);
  }

  const actions = [];

  // 1. 确保 .gitignore
  const gitignoreUpdated = await ensureGitignore(cwd);
  if (gitignoreUpdated) actions.push('.gitignore 已更新');

  // 2. 写 .env.example（不含真实值）
  const examplePath = path.join(cwd, '.env.example');
  let exampleContent = ENV_EXAMPLE_TEMPLATE;

  // LLM 增强：生成更智能的模板
  let llmEnhanced = false;
  let llmProvider = null;

  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.callLLM({
        system: `你是一名资深 DevOps 工程师，擅长为项目设计完整的环境变量配置方案。

请根据项目类型生成一个完整的 .env.example 模板，要求：
1. 覆盖应用、数据库、缓存、认证、第三方 API、监控等常见领域
2. 每个变量都要有注释说明
3. 敏感变量使用 <CHANGE_ME> 占位符
4. 合理的默认值
5. 使用 UPPER_SNAKE_CASE 命名
6. 按类别分组

只输出 .env 文件内容，不要任何解释或 markdown 代码块标记。`,
        messages: [
          {
            role: 'user',
            content: `项目类型: ${projectType || 'node'}

请生成一个完整的 .env.example 模板文件内容。`,
          },
        ],
        temperature: 0.3,
        maxTokens: 2048,
      });

      if (llmResult.ok) {
        exampleContent = llmResult.content.trim();
        llmEnhanced = true;
        llmProvider = llmResult.provider;
        actions.push('LLM 生成环境变量模板');
      }
    } catch {
      // 静默回退
    }
  }

  await fs.writeFile(examplePath, exampleContent, 'utf-8');
  actions.push('.env.example 已创建');

  // 3. 写 .secrets.example
  const secretsExamplePath = path.join(cwd, '.secrets.example');
  await fs.writeFile(secretsExamplePath, SECRETS_EXAMPLE_TEMPLATE, 'utf-8');
  actions.push('.secrets.example 已创建');

  // 4. 为 4 个环境创建 .env.{env} 文件（基于 .env.example）
  const envVars = parseEnv(exampleContent);
  const createdEnvs = [];

  for (const e of SUPPORTED_ENVS) {
    const envFile = path.join(cwd, `.env.${e}`);
    try {
      // 检查文件是否已存在
      await fs.access(envFile);
      if (!force) {
        actions.push(`.env.${e} 已存在，跳过`);
        continue;
      }
    } catch {
      // 文件不存在，继续创建
    }

    // 根据环境调整默认值
    const envSpecificVars = { ...envVars };

    // NODE_ENV 设置
    const nodeEnvMap = {
      dev: 'development',
      test: 'test',
      staging: 'staging',
      prod: 'production',
    };
    envSpecificVars.NODE_ENV = nodeEnvMap[e];

    // 端口调整
    const portMap = { dev: 3000, test: 3001, staging: 3002, prod: 3000 };
    if (envSpecificVars.APP_PORT) envSpecificVars.APP_PORT = portMap[e];

    // 数据库名后缀
    if (envSpecificVars.DATABASE_URL) {
      envSpecificVars.DATABASE_URL = envSpecificVars.DATABASE_URL.replace(
        /\/myapp(\?|$)/,
        `/myapp_${e}$1`
      );
    }

    // 生产环境清空敏感字段
    if (e === 'prod') {
      for (const key of Object.keys(envSpecificVars)) {
        if (isSensitiveKey(key)) {
          envSpecificVars[key] = '<CHANGE_ME>';
        }
      }
    }

    await writeEnvFile(envFile, envSpecificVars);
    createdEnvs.push(e);
    actions.push(`.env.${e} 已创建`);
  }

  // 5. 设置当前环境
  await setCurrentEnv(cwd, env);
  actions.push(`当前环境已设为 ${env}`);

  // 6. 创建 README 文档
  const readmePath = path.join(cwd, 'docs/env-setup.md');
  await fs.mkdir(path.dirname(readmePath), { recursive: true });
  await fs.writeFile(readmePath, `# Environment Setup

## 快速开始

\`\`\`bash
# 1. 查看环境列表
npx environment-manager.list

# 2. 切换环境
npx environment-manager.switch --env=dev

# 3. 编辑对应环境文件
# 编辑 .env.dev，填入真实值（不会入 git）

# 4. 校验环境配置
npx environment-manager.validate --env=dev

# 5. 注入到运行时
npx environment-manager.inject --env=dev
\`\`\`

## 4 个环境

| 环境 | 文件 | 说明 |
|------|------|------|
| dev | \`.env.dev\` | 本地开发环境 |
| test | \`.env.test\` | 测试环境（自动化测试 / QA） |
| staging | \`.env.staging\` | 预生产环境（生产镜像） |
| prod | \`.env.prod\` | 生产环境（最高安全等级） |

## 安全约束

- ❌ 禁止把 .env 文件提交到 git
- ❌ 禁止在代码中硬编码密钥
- ✅ 必须用 environment-manager 管理环境变量
- ✅ 必须 90 天轮换一次 Secrets
- ✅ 部署前必须执行 validate 校验

## 常用命令

\`\`\`bash
# 初始化
environment-manager.init

# 切换环境
environment-manager.switch --env=staging

# 列出所有环境
environment-manager.list

# 校验环境变量
environment-manager.validate --env=prod

# 管理 secrets
environment-manager.secrets --action=scan
environment-manager.secrets --action=template

# 对比环境差异
environment-manager.diff --from=staging --to=prod

# 设置变量
environment-manager.set --env=dev --key=KEY --value=val

# 注入环境变量
environment-manager.inject --env=dev
\`\`\`
`, 'utf-8');
  actions.push('docs/env-setup.md 已创建');

  return buildResult({
    data: {
      summary: `✅ Environment initialized with 4 environments (current: ${env})`,
      currentEnv: env,
      environments: SUPPORTED_ENVS,
      createdEnvs,
      envExamplePath: examplePath,
      secretsExamplePath,
      readmePath,
      gitignoreUpdated,
      actions,
      llmEnhanced,
      llmProvider,
    },
    nextActions: [
      `Edit .env.${env} and fill in real values`,
      `Run 'validate --env=${env}' to check configuration`,
    ],
  });
}

// ============================================================
// switch - 切换当前环境
// ============================================================

async function switchEnv({ projectRoot, env }) {
  const cwd = projectRoot || process.cwd();

  if (!env) {
    return buildError('env is required');
  }

  if (!SUPPORTED_ENVS.includes(env)) {
    return buildError(`Unsupported env: ${env}. Allowed: ${SUPPORTED_ENVS.join(', ')}`);
  }

  const previousEnv = await getCurrentEnv(cwd);

  // 检查目标环境文件是否存在
  const envFile = path.join(cwd, `.env.${env}`);
  try {
    await fs.access(envFile);
  } catch {
    return buildError(`.env.${env} not found. Run 'init' first or create the file.`, {
      data: { previousEnv },
      nextActions: [`Run 'init' to create environment files`, `Create .env.${env} manually`],
    });
  }

  await setCurrentEnv(cwd, env);

  return buildResult({
    data: {
      summary: `✅ Switched to ${env} environment`,
      currentEnv: env,
      previousEnv,
      envFile,
      description: ENV_DESCRIPTIONS[env],
    },
    nextActions: [
      `Run 'validate --env=${env}' to verify configuration`,
    ],
  });
}

// ============================================================
// list - 列出所有环境及状态
// ============================================================

async function listEnv({ projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const currentEnv = await getCurrentEnv(cwd);

  const environments = [];
  for (const env of SUPPORTED_ENVS) {
    const envFile = path.join(cwd, `.env.${env}`);
    let exists = false;
    let varCount = 0;
    let sensitiveCount = 0;

    try {
      const content = await fs.readFile(envFile, 'utf-8');
      exists = true;
      const vars = parseEnv(content);
      varCount = Object.keys(vars).length;
      sensitiveCount = Object.keys(vars).filter(k => isSensitiveKey(k)).length;
    } catch {
      // 文件不存在
    }

    environments.push({
      name: env,
      active: currentEnv === env,
      exists,
      varCount,
      sensitiveCount,
      description: ENV_DESCRIPTIONS[env],
      file: envFile,
    });
  }

  const activeCount = environments.filter(e => e.exists).length;

  return buildResult({
    data: {
      summary: `📋 ${activeCount}/${SUPPORTED_ENVS.length} environments configured (current: ${currentEnv || 'none'})`,
      currentEnv,
      environments,
      totalEnvs: SUPPORTED_ENVS.length,
      configuredCount: activeCount,
    },
    nextActions: currentEnv
      ? [`Run 'validate --env=${currentEnv}' to check current environment`]
      : [`Run 'init' to initialize environment configuration`],
  });
}

// ============================================================
// validate - 校验环境变量完整性（增强版）
// ============================================================

async function validate({ env, projectRoot, strict = false }) {
  const cwd = projectRoot || process.cwd();
  const targetEnv = env || (await getCurrentEnv(cwd)) || 'dev';

  if (!SUPPORTED_ENVS.includes(targetEnv)) {
    return buildError(`Unsupported env: ${targetEnv}`);
  }

  const issues = [];
  const checks = [];

  // 检查 .env.{env} 文件
  const envFile = path.join(cwd, `.env.${targetEnv}`);
  let content = '';
  let envVars = {};
  try {
    content = await fs.readFile(envFile, 'utf-8');
    envVars = parseEnv(content);
  } catch {
    issues.push({
      severity: 'error',
      category: 'file',
      message: `.env.${targetEnv} not found`,
    });
    return buildError(`.env.${targetEnv} not found`, {
      data: { env: targetEnv, issues, checks },
    });
  }

  // 1. 必填字段检查（基于 .env.example）
  const exampleFile = path.join(cwd, '.env.example');
  let requiredKeys = [];
  try {
    const exampleContent = await fs.readFile(exampleFile, 'utf-8');
    const exampleVars = parseEnv(exampleContent);
    requiredKeys = Object.keys(exampleVars);

    for (const key of requiredKeys) {
      const present = key in envVars && envVars[key] !== '';
      checks.push({ key, present, type: 'required' });
      if (!present) {
        issues.push({
          severity: 'error',
          category: 'required',
          key,
          message: `Required key '${key}' is missing or empty`,
        });
      }
    }
  } catch {
    // .env.example 不存在，使用默认必填列表
    requiredKeys = ['NODE_ENV', 'DATABASE_URL', 'JWT_SECRET'];
    for (const key of requiredKeys) {
      const present = key in envVars && envVars[key] !== '';
      checks.push({ key, present, type: 'required' });
      if (!present) {
        issues.push({
          severity: 'error',
          category: 'required',
          key,
          message: `Required key '${key}' is missing or empty`,
        });
      }
    }
  }

  // 2. 类型校验
  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;

    // 数字类型校验
    const isNumberKey = VALIDATION_RULES.typePatterns.number.some(p => p.test(key));
    if (isNumberKey && !detectPlaceholders(value)) {
      const num = Number(value);
      if (isNaN(num)) {
        issues.push({
          severity: 'warn',
          category: 'type',
          key,
          message: `'${key}' should be a number, got '${value}'`,
        });
        checks.push({ key, type: 'type_number', passed: false });
      } else {
        checks.push({ key, type: 'type_number', passed: true });
      }
    }

    // 布尔类型校验
    const isBooleanKey = VALIDATION_RULES.typePatterns.boolean.some(p => p.test(key));
    if (isBooleanKey && !detectPlaceholders(value)) {
      const isBool = ['true', 'false', '1', '0', 'yes', 'no'].includes(value.toLowerCase());
      if (!isBool) {
        issues.push({
          severity: 'warn',
          category: 'type',
          key,
          message: `'${key}' should be a boolean (true/false), got '${value}'`,
        });
        checks.push({ key, type: 'type_boolean', passed: false });
      } else {
        checks.push({ key, type: 'type_boolean', passed: true });
      }
    }

    // URL 类型校验
    const isUrlKey = VALIDATION_RULES.typePatterns.url.some(p => p.test(key));
    if (isUrlKey && !detectPlaceholders(value)) {
      try {
        new URL(value);
        checks.push({ key, type: 'type_url', passed: true });
      } catch {
        issues.push({
          severity: 'warn',
          category: 'type',
          key,
          message: `'${key}' is not a valid URL: '${value}'`,
        });
        checks.push({ key, type: 'type_url', passed: false });
      }
    }

    // 端口范围校验
    const isPortKey = VALIDATION_RULES.typePatterns.port.some(p => p.test(key));
    if (isPortKey && !detectPlaceholders(value)) {
      const port = Number(value);
      if (!isNaN(port) && (port < 1 || port > 65535)) {
        issues.push({
          severity: 'error',
          category: 'range',
          key,
          message: `'${key}' port ${port} is out of valid range (1-65535)`,
        });
        checks.push({ key, type: 'range_port', passed: false });
      } else {
        checks.push({ key, type: 'range_port', passed: !isNaN(port) });
      }
    }

    // 邮箱格式校验
    const isEmailKey = VALIDATION_RULES.typePatterns.email.some(p => p.test(key));
    if (isEmailKey && !detectPlaceholders(value)) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        issues.push({
          severity: 'warn',
          category: 'format',
          key,
          message: `'${key}' is not a valid email: '${value}'`,
        });
        checks.push({ key, type: 'format_email', passed: false });
      } else {
        checks.push({ key, type: 'format_email', passed: true });
      }
    }
  }

  // 3. 枚举校验
  for (const [key, allowedValues] of Object.entries(VALIDATION_RULES.enumRules)) {
    if (key in envVars && envVars[key] && !detectPlaceholders(envVars[key])) {
      const valid = allowedValues.includes(envVars[key]);
      checks.push({ key, type: 'enum', passed: valid });
      if (!valid) {
        issues.push({
          severity: 'error',
          category: 'enum',
          key,
          message: `'${key}' value '${envVars[key]}' is not valid. Allowed: ${allowedValues.join(', ')}`,
        });
      }
    }
  }

  // 4. 格式正则校验
  for (const [key, pattern] of Object.entries(VALIDATION_RULES.formatRules)) {
    if (key in envVars && envVars[key] && !detectPlaceholders(envVars[key])) {
      const passed = pattern.test(envVars[key]);
      checks.push({ key, type: 'format', passed });
      if (!passed) {
        issues.push({
          severity: 'warn',
          category: 'format',
          key,
          message: `'${key}' does not match expected format`,
        });
      }
    }
  }

  // 5. 范围校验
  for (const [key, range] of Object.entries(VALIDATION_RULES.rangeRules)) {
    if (key in envVars && envVars[key] && !detectPlaceholders(envVars[key])) {
      const num = Number(envVars[key]);
      if (!isNaN(num)) {
        const passed = num >= range.min && (range.max === undefined || num <= range.max);
        checks.push({ key, type: 'range', passed });
        if (!passed) {
          issues.push({
            severity: 'warn',
            category: 'range',
            key,
            message: `'${key}' value ${num} is out of range (${range.min}${range.max ? '-' + range.max : '+'})`,
          });
        }
      }
    }
  }

  // 6. 生产环境特殊校验
  if (targetEnv === 'prod' || envVars.NODE_ENV === 'production') {
    const prodRules = VALIDATION_RULES.productionRules;

    // 不允许 localhost
    for (const key of prodRules.noLocalhost) {
      if (key in envVars && envVars[key]) {
        const hasLocalhost = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(envVars[key]);
        checks.push({ key, type: 'prod_no_localhost', passed: !hasLocalhost });
        if (hasLocalhost) {
          issues.push({
            severity: 'error',
            category: 'production',
            key,
            message: `Production env '${key}' contains localhost/127.0.0.1 (use real domain)`,
          });
        }
      }
    }

    // 不允许测试密钥
    for (const { key, pattern, expected } of prodRules.noTestKeys) {
      if (key in envVars && envVars[key] && !detectPlaceholders(envVars[key])) {
        const isTestKey = pattern.test(envVars[key]);
        checks.push({ key, type: 'prod_no_test_keys', passed: !isTestKey });
        if (isTestKey) {
          issues.push({
            severity: 'error',
            category: 'production',
            key,
            message: `Production env '${key}' uses TEST key (should be ${expected})`,
          });
        }
      }
    }

    // 密钥强度检查
    for (const [key, minLen] of Object.entries(prodRules.minSecretLength)) {
      if (key in envVars && envVars[key] && !detectPlaceholders(envVars[key])) {
        const strong = envVars[key].length >= minLen;
        checks.push({ key, type: 'prod_secret_strength', passed: strong });
        if (!strong) {
          issues.push({
            severity: 'warn',
            category: 'security',
            key,
            message: `'${key}' is too short (${envVars[key].length} < ${minLen} chars) for production`,
          });
        }
      }
    }

    // 不允许 dev 关键字
    for (const key of prodRules.noLocalhost) {
      if (key in envVars && envVars[key]) {
        const hasDev = /_dev|dev_|dev\./i.test(envVars[key]);
        if (hasDev) {
          issues.push({
            severity: 'error',
            category: 'production',
            key,
            message: `Production env '${key}' appears to use dev resources`,
          });
        }
      }
    }
  }

  // 7. 占位符检测
  for (const [key, value] of Object.entries(envVars)) {
    if (value && detectPlaceholders(value)) {
      issues.push({
        severity: 'warn',
        category: 'placeholder',
        key,
        message: `'${key}' still has placeholder value: ${maskSecret(value)}`,
      });
      checks.push({ key, type: 'placeholder', passed: false });
    }
  }

  // 8. AST 源码级环境变量使用分析
  const astUsage = await scanSourceForEnvUsageAST(cwd, envVars);
  if (astUsage.astEnhanced) {
    // 声明但未使用的变量
    for (const key of astUsage.declaredNotUsed) {
      issues.push({
        severity: 'warn',
        category: 'unused',
        key,
        message: `'${key}' is declared in .env but not referenced in source code (may be unused)`,
      });
      checks.push({ key, type: 'ast_unused', passed: false });
    }
    // 源码中使用但 .env 中未声明
    for (const key of astUsage.usedNotDeclared) {
      issues.push({
        severity: 'warn',
        category: 'missing',
        key,
        message: `'${key}' is used in source code but not declared in .env.${targetEnv}`,
      });
      checks.push({ key, type: 'ast_missing', passed: false });
    }
    // 源码中硬编码的密钥
    for (const hs of astUsage.hardcodedSecrets) {
      issues.push({
        severity: 'error',
        category: 'hardcoded_secret',
        key: hs.key,
        message: `Hardcoded secret '${hs.key}' found in ${hs.file}:${hs.line}`,
      });
    }
  }

  // 统计
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warn');
  const passed = errors.length === 0 && (!strict || warnings.length === 0);

  const result = {
    ok: passed,
    data: {
      summary: passed
        ? `✅ All checks passed (${errors.length} errors, ${warnings.length} warnings)`
        : `❌ ${errors.length} errors, ${warnings.length} warnings`,
      env: targetEnv,
      totalVars: Object.keys(envVars).length,
      checks,
      issues,
      errorCount: errors.length,
      warningCount: warnings.length,
      astEnhanced: astUsage.astEnhanced,
      astUsage: astUsage.astEnhanced
        ? {
            sourcesScanned: astUsage.sourcesScanned,
            usedInSource: astUsage.usedInSource,
            declaredNotUsed: astUsage.declaredNotUsed,
            usedNotDeclared: astUsage.usedNotDeclared,
            hardcodedSecretsFound: astUsage.hardcodedSecrets.length,
          }
        : undefined,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: warnings.map(w => w.message),
    nextActions: passed
      ? [`Run 'inject --env=${targetEnv}' to load variables`]
      : ['Resolve errors first, then re-run validate'],
  };

  // 8. LLM 增强：深度分析配置合理性
  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.callLLM({
        system: `你是一名资深 DevOps 安全工程师，擅长环境配置审计和安全最佳实践。

请分析给定的环境变量配置，输出结构化的 JSON 结果，包含以下字段：
{
  "securityRisks": [
    {"severity": "critical|high|medium|low", "key": "变量名", "description": "风险描述", "suggestion": "修复建议"}
  ],
  "bestPractices": [
    {"key": "变量名", "recommendation": "建议内容", "reason": "原因"}
  ],
  "commonMistakes": [
    {"key": "变量名", "description": "常见配置错误描述", "fix": "修正方式"}
  ],
  "overallScore": 0-100,
  "summary": "一句话总结"
}

重点检查：
1. 硬编码的 IP 地址、localhost、测试密钥
2. 弱密钥、占位符
3. 生产环境使用开发配置
4. 缺少必要的安全变量
5. 变量命名不规范
6. 敏感信息可能泄露的风险
7. 跨环境配置混用

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `环境：${targetEnv}

.env.${targetEnv} 配置内容（已脱敏）：
\`\`\`
${Object.entries(envVars).map(([key, value]) =>
  `${key}=${isSensitiveKey(key) ? maskSecret(value) : value}`
).join('\n')}
\`\`\`

请基于以上配置进行安全审计和最佳实践分析。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 2048,
      });

      if (llmResult.ok) {
        let analysis;
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        } catch {
          analysis = {
            securityRisks: [],
            bestPractices: [],
            commonMistakes: [],
            overallScore: null,
            summary: 'LLM 分析结果解析失败',
          };
        }

        result.data.llmEnhanced = true;
        result.data.llmProvider = llmResult.provider;
        result.data.llmAnalysis = analysis;

        // 将 LLM 识别的高危风险加入 issues
        if (analysis.securityRisks && Array.isArray(analysis.securityRisks)) {
          for (const risk of analysis.securityRisks) {
            if (risk.severity === 'critical' || risk.severity === 'high') {
              result.data.issues.push({
                severity: 'warn',
                category: 'llm_security',
                key: risk.key,
                message: `[LLM] ${risk.key || 'security'}: ${risk.description} — ${risk.suggestion}`,
                source: 'llm',
              });
            }
          }
        }

        // 将 LLM 建议加入 warnings
        if (analysis.bestPractices && Array.isArray(analysis.bestPractices)) {
          const practiceWarnings = analysis.bestPractices
            .slice(0, 3)
            .map(p => `[LLM 建议] ${p.key ? p.key + ': ' : ''}${p.recommendation}`);
          result.warnings = [...result.warnings, ...practiceWarnings];
        }

        if (analysis.summary) {
          result.data.summary += ` | LLM 评分: ${analysis.overallScore ?? 'N/A'}/100`;
        }
      }
    } catch {
      // 静默回退
      result.data.llmEnhanced = false;
    }
  }

  return result;
}

// ============================================================
// secrets - 管理密钥/敏感配置
// ============================================================

async function secrets({ action = 'scan', env, projectRoot, key, value, backend = 'dotenv', ...syncOptions }) {
  const cwd = projectRoot || process.cwd();
  const targetEnv = env || (await getCurrentEnv(cwd)) || 'dev';

  if (!SUPPORTED_ENVS.includes(targetEnv)) {
    return buildError(`Unsupported env: ${targetEnv}`);
  }

  const envFile = path.join(cwd, `.env.${targetEnv}`);
  let envVars = {};
  try {
    const content = await fs.readFile(envFile, 'utf-8');
    envVars = parseEnv(content);
  } catch {
    if (action !== 'sync') {
      return buildError(`.env.${targetEnv} not found. Run 'init' first.`);
    }
  }

  switch (action) {
    case 'scan':
      return secretsScan(envVars, targetEnv, envFile, cwd);
    case 'template':
      return secretsTemplate(envVars, targetEnv, cwd);
    case 'inject':
      return secretsInject({ env: targetEnv, cwd, key, value });
    case 'list':
      return secretsList(envVars, targetEnv);
    case 'sync':
      return await secretsSync({ env: targetEnv, cwd, backend, projectRoot, ...syncOptions });
    default:
      return buildError(`Unknown action: ${action}. Allowed: scan, template, inject, list, sync`);
  }
}

async function secretsScan(envVars, env, envFile, cwd) {
  const sensitiveKeys = [];
  const placeholderKeys = [];
  const weakSecrets = [];

  for (const [key, value] of Object.entries(envVars)) {
    if (isSensitiveKey(key)) {
      sensitiveKeys.push({
        key,
        isSecret: true,
        hasValue: value && !detectPlaceholders(value),
        maskedValue: value ? maskSecret(value) : null,
      });

      // 检查占位符
      if (!value || detectPlaceholders(value)) {
        placeholderKeys.push(key);
      } else if (value.length < 16) {
        // 弱密钥检测
        weakSecrets.push({ key, length: value.length });
      }
    }
  }

  // LLM 增强：识别潜在的敏感字段
  let llmEnhanced = false;
  let llmProvider = null;
  let llmIdentified = [];

  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.callLLM({
        system: `你是一名安全审计专家，擅长识别环境变量中的敏感信息。

请分析给定的环境变量列表，识别哪些可能包含敏感信息但命名不明显。
输出 JSON 格式：
{
  "identifiedSensitive": [
    {"key": "变量名", "reason": "为什么认为它敏感", "riskLevel": "high|medium|low"}
  ],
  "hardcodedSecrets": [
    {"key": "变量名", "evidence": "硬编码密钥的特征"}
  ],
  "summary": "一句话总结"
}

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `环境：${env}

环境变量列表（不含值，只看变量名）：
${Object.keys(envVars).join('\n')}

请分析哪些变量名可能包含敏感信息但未被常规模式（PASSWORD/SECRET/KEY/TOKEN等）识别。`,
          },
        ],
        temperature: 0.2,
        maxTokens: 1024,
      });

      if (llmResult.ok) {
        llmEnhanced = true;
        llmProvider = llmResult.provider;
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          llmIdentified = analysis.identifiedSensitive || [];
        } catch {
          // 解析失败
        }
      }
    } catch {
      // 静默回退
    }
  }

  return buildResult({
    data: {
      summary: `🔐 Found ${sensitiveKeys.length} sensitive keys in ${env} environment` +
        (placeholderKeys.length > 0 ? `, ${placeholderKeys.length} with placeholders` : ''),
      env,
      totalKeys: Object.keys(envVars).length,
      sensitiveCount: sensitiveKeys.length,
      sensitiveKeys,
      placeholderKeys,
      weakSecrets,
      llmIdentifiedSecrets: llmIdentified,
      llmEnhanced,
      llmProvider,
    },
    warnings: placeholderKeys.length > 0
      ? [`${placeholderKeys.length} keys still have placeholder values`]
      : [],
    nextActions: [
      placeholderKeys.length > 0 ? 'Fill in placeholder values' : 'All sensitive keys have values',
      `Run 'secrets --action=template' to generate secrets template`,
      `Run 'validate --env=${env}' for full validation`,
    ],
  });
}

async function secretsTemplate(envVars, env, cwd) {
  const sensitiveKeys = Object.keys(envVars).filter(k => isSensitiveKey(k));

  // 生成 .secrets.example 内容
  let content = '# ============================================================\n';
  content += '# Secrets Template\n';
  content += `# Generated from .env.${env}\n`;
  content += '# These fields should be injected via Secrets Manager\n';
  content += '# ============================================================\n\n';

  // 按类别分组
  const categories = {
    'Database': [],
    'Authentication': [],
    'API Keys': [],
    'Cloud Services': [],
    'Email': [],
    'Other Secrets': [],
  };

  for (const key of sensitiveKeys) {
    let category = 'Other Secrets';
    if (/DATABASE|MONGO|REDIS|POSTGRES|MYSQL/i.test(key)) category = 'Database';
    else if (/JWT|TOKEN|SECRET|AUTH|PASSWORD/i.test(key) && !/API/i.test(key)) category = 'Authentication';
    else if (/API_KEY|STRIPE|GITHUB|SLACK|WEBHOOK/i.test(key)) category = 'API Keys';
    else if (/AWS|AZURE|GCP|GOOGLE|S3/i.test(key)) category = 'Cloud Services';
    else if (/SMTP|EMAIL|MAIL/i.test(key)) category = 'Email';

    categories[category].push(key);
  }

  for (const [cat, keys] of Object.entries(categories)) {
    if (keys.length === 0) continue;
    content += `# ---- ${cat} ----\n`;
    for (const key of keys) {
      content += `${key}=<CHANGE_ME>\n`;
    }
    content += '\n';
  }

  const templatePath = path.join(cwd, '.secrets.example');
  await fs.writeFile(templatePath, content, 'utf-8');

  return buildResult({
    data: {
      summary: `📝 Secrets template generated with ${sensitiveKeys.length} entries`,
      env,
      sensitiveCount: sensitiveKeys.length,
      sensitiveKeys,
      templatePath,
    },
    nextActions: [
      'Review .secrets.example',
      'Use your Secrets Manager to inject these values',
    ],
  });
}

async function secretsInject({ env, cwd, key, value }) {
  if (!key || value === undefined) {
    return buildError('key and value are required for inject action');
  }

  const envFile = path.join(cwd, `.env.${env}`);
  let content = '';
  try {
    content = await fs.readFile(envFile, 'utf-8');
  } catch {
    content = '';
  }

  const line = `${key}="${value}"\n`;
  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    content = content.replace(regex, line.trimEnd());
  } else {
    content += line;
  }

  await fs.writeFile(envFile, content, { mode: 0o600 });

  return buildResult({
    data: {
      summary: `🔐 Secret '${key}' injected into .env.${env}`,
      key,
      env,
      file: envFile,
      maskedValue: maskSecret(value),
    },
    warnings: ['Stored as secret, masked in logs'],
    nextActions: [`Run 'validate --env=${env}' to verify`],
  });
}

async function secretsList(envVars, env) {
  const sensitiveKeys = Object.keys(envVars)
    .filter(k => isSensitiveKey(k))
    .map(key => ({
      key,
      isSecret: true,
      hasValue: envVars[key] && !detectPlaceholders(envVars[key]),
      maskedValue: envVars[key] ? maskSecret(envVars[key]) : null,
      length: envVars[key] ? envVars[key].length : 0,
    }));

  return buildResult({
    data: {
      summary: `🔐 ${sensitiveKeys.length} secrets found in ${env} environment`,
      env,
      secrets: sensitiveKeys,
      count: sensitiveKeys.length,
    },
  });
}

/**
 * secretsSync - 从外部后端（Doppler/Vault）同步密钥到本地 .env 文件
 */
async function secretsSync({ env, cwd, backend = 'dotenv', projectRoot, ...options }) {
  const targetEnv = env || 'dev';
  const workDir = cwd || projectRoot || process.cwd();

  if (backend === 'dotenv') {
    return buildError('Sync requires backend=doppler or backend=vault. Use backend=dotenv for local files only.', {
      data: { backend, env: targetEnv },
    });
  }

  if (!SUPPORTED_BACKENDS.includes(backend)) {
    return buildError(`Unsupported backend: ${backend}. Supported: ${SUPPORTED_BACKENDS.join(', ')}`);
  }

  const result = fetchFromBackend(backend, workDir, targetEnv, options);
  if (!result.success) {
    return buildError(result.error, {
      data: { backend, env: targetEnv },
      nextActions: [`Install ${backend} CLI`, `Run 'secrets --action=scan' to check existing local secrets`],
    });
  }

  const envFile = path.join(workDir, `.env.${targetEnv}`);
  await writeEnvFile(envFile, result.envVars);

  const keyCount = Object.keys(result.envVars).length;
  return buildResult({
    data: {
      summary: `Synced ${keyCount} secrets from ${backend} to .env.${targetEnv}`,
      env: targetEnv,
      backend: result.source,
      syncedCount: keyCount,
      syncedKeys: Object.keys(result.envVars),
      localFile: envFile,
    },
    nextActions: [`Run 'validate --env=${targetEnv}' to verify`, `Run 'secrets --action=scan --env=${targetEnv}' to check for issues`],
  });
}

// ============================================================
// diff - 对比两个环境的差异
// ============================================================

async function diff({ from, to, projectRoot, showValues = false }) {
  const cwd = projectRoot || process.cwd();

  if (!from || !to) {
    return buildError('Both --from and --to are required');
  }

  if (!SUPPORTED_ENVS.includes(from)) {
    return buildError(`Unsupported env 'from': ${from}`);
  }

  if (!SUPPORTED_ENVS.includes(to)) {
    return buildError(`Unsupported env 'to': ${to}`);
  }

  const fromFile = path.join(cwd, `.env.${from}`);
  const toFile = path.join(cwd, `.env.${to}`);

  let fromVars = {};
  let toVars = {};

  try {
    const fromContent = await fs.readFile(fromFile, 'utf-8');
    fromVars = parseEnv(fromContent);
  } catch {
    return buildError(`.env.${from} not found`);
  }

  try {
    const toContent = await fs.readFile(toFile, 'utf-8');
    toVars = parseEnv(toContent);
  } catch {
    return buildError(`.env.${to} not found`);
  }

  const allKeys = new Set([...Object.keys(fromVars), ...Object.keys(toVars)]);
  const differences = [];
  let sameCount = 0;

  for (const key of allKeys) {
    const inFrom = key in fromVars;
    const inTo = key in toVars;

    if (inFrom && inTo) {
      if (fromVars[key] === toVars[key]) {
        sameCount++;
        differences.push({
          key,
          status: 'same',
          isSensitive: isSensitiveKey(key),
        });
      } else {
        differences.push({
          key,
          status: 'different',
          isSensitive: isSensitiveKey(key),
          fromValue: showValues ? fromVars[key] : maskSecret(fromVars[key]),
          toValue: showValues ? toVars[key] : maskSecret(toVars[key]),
        });
      }
    } else if (inFrom && !inTo) {
      differences.push({
        key,
        status: 'only_in_from',
        isSensitive: isSensitiveKey(key),
        fromValue: showValues ? fromVars[key] : maskSecret(fromVars[key]),
      });
    } else if (!inFrom && inTo) {
      differences.push({
        key,
        status: 'only_in_to',
        isSensitive: isSensitiveKey(key),
        toValue: showValues ? toVars[key] : maskSecret(toVars[key]),
      });
    }
  }

  const differentCount = differences.filter(d => d.status === 'different').length;
  const onlyFromCount = differences.filter(d => d.status === 'only_in_from').length;
  const onlyToCount = differences.filter(d => d.status === 'only_in_to').length;

  return buildResult({
    data: {
      summary: `📊 Diff ${from} → ${to}: ${differentCount} different, ${onlyFromCount} only in ${from}, ${onlyToCount} only in ${to}, ${sameCount} same`,
      from,
      to,
      totalKeys: allKeys.size,
      sameCount,
      differentCount,
      onlyFromCount,
      onlyToCount,
      differences,
      showValues,
    },
    warnings: differentCount > 0
      ? [`${differentCount} keys have different values between ${from} and ${to}`]
      : [],
    nextActions: [
      differentCount > 0 ? 'Review differences and ensure consistency' : 'Environments are in sync',
      `Run 'validate --env=${to}' to check target environment`,
    ],
  });
}

// ============================================================
// set - 设置环境变量
// ============================================================

async function set({ env, key, secret = false, value, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const targetEnv = env || (await getCurrentEnv(cwd)) || 'dev';

  if (!key || value === undefined) {
    return buildError('key and value are required');
  }

  if (!SUPPORTED_ENVS.includes(targetEnv)) {
    return buildError(`Unsupported env: ${targetEnv}`);
  }

  const envFile = path.join(cwd, `.env.${targetEnv}`);
  let content = '';
  try {
    content = await fs.readFile(envFile, 'utf-8');
  } catch {
    // 文件不存在，新建
  }

  const isSecret = secret || isSensitiveKey(key);
  const line = `${key}=${isSecret ? '"' + value + '"' : value}\n`;

  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, line.trimEnd());
  } else {
    if (!content.endsWith('\n') && content.length > 0) content += '\n';
    content += line;
  }

  await fs.mkdir(path.dirname(envFile), { recursive: true });
  await fs.writeFile(envFile, content, { mode: 0o600 });

  return buildResult({
    data: {
      summary: `✅ ${key} set in .env.${targetEnv}`,
      key,
      env: targetEnv,
      file: envFile,
      secret: isSecret,
      value: isSecret ? maskSecret(value) : value,
    },
    warnings: isSecret ? ['Stored as secret, masked in logs'] : [],
    nextActions: [`Run 'validate --env=${targetEnv}' to verify`],
  });
}

// ============================================================
// get - 读取环境变量
// ============================================================

async function get({ env, key, projectRoot, masked = false }) {
  const cwd = projectRoot || process.cwd();
  const targetEnv = env || (await getCurrentEnv(cwd)) || 'dev';

  if (!key) {
    return buildError('key is required');
  }

  const envFile = path.join(cwd, `.env.${targetEnv}`);
  try {
    const content = await fs.readFile(envFile, 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));

    if (match) {
      const value = match[1].replace(/^["']|["']$/g, '');
      const isSecret = isSensitiveKey(key);
      return buildResult({
        data: {
          key,
          value: (masked || isSecret) ? maskSecret(value) : value,
          env: targetEnv,
          source: envFile,
          isSecret,
        },
      });
    }
  } catch {
    // 文件不存在
  }

  return buildError(`Key '${key}' not found in .env.${targetEnv}`);
}

// ============================================================
// External Backend CLI 检测与密钥拉取（Doppler / Vault）
// ============================================================

/**
 * 检测 CLI 工具是否安装
 */
function detectCli(toolName) {
  const r = spawnSync(toolName, ['--version'], {
    encoding: 'utf-8',
    timeout: 5000,
    shell: true,
  });
  return Boolean(r.status === 0 || (r.stdout && r.stdout.length > 0));
}

/**
 * 从 Doppler 拉取密钥
 * 使用 `doppler secrets download --json` 获取
 */
function fetchFromDoppler(cwd, options = {}) {
  const { project, config } = options;
  const args = ['secrets', 'download', '--json', '--no-file'];
  if (project) args.push('--project', project);
  if (config) args.push('--config', config);

  const r = spawnSync('doppler', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 15000,
    shell: true,
  });

  if (r.error || !r.stdout) {
    return { success: false, error: r.error?.message || 'Doppler CLI command failed' };
  }

  try {
    const data = JSON.parse(r.stdout);
    const secrets = data.secrets || data;
    const envVars = {};
    for (const [key, entry] of Object.entries(secrets)) {
      envVars[key] = typeof entry === 'object' ? (entry.computed || entry.raw || '') : entry;
    }
    return { success: true, envVars, source: 'doppler' };
  } catch (e) {
    return { success: false, error: `Failed to parse Doppler output: ${e.message}` };
  }
}

/**
 * 从 HashiCorp Vault 拉取密钥
 * 使用 `vault kv get -format=json <path>` 获取
 */
function fetchFromVault(cwd, options = {}) {
  const { mount = 'secret', path: secretPath = '', format = 'kv2' } = options;
  if (!secretPath) {
    return { success: false, error: 'Vault secret path is required (e.g., myapp/prod)' };
  }

  const fullPath = format === 'kv2'
    ? `${mount}/data/${secretPath}`
    : `${mount}/${secretPath}`;

  const r = spawnSync('vault', ['kv', 'get', '-format=json', fullPath], {
    cwd,
    encoding: 'utf-8',
    timeout: 15000,
    shell: true,
  });

  if (r.error || !r.stdout) {
    return { success: false, error: r.error?.message || 'Vault CLI command failed' };
  }

  try {
    const data = JSON.parse(r.stdout);
    const secrets = data?.data?.data || data?.data || {};
    const envVars = {};
    for (const [key, value] of Object.entries(secrets)) {
      envVars[key] = String(value);
    }
    return { success: true, envVars, source: 'vault' };
  } catch (e) {
    return { success: false, error: `Failed to parse Vault output: ${e.message}` };
  }
}

/**
 * 根据后端类型拉取密钥
 */
function fetchFromBackend(backend, cwd, env, options = {}) {
  if (!detectCli(backend)) {
    return {
      success: false,
      error: `${backend} CLI not found. Install: ${backend === 'doppler' ? 'https://docs.doppler.com/docs/install-cli' : 'https://developer.hashicorp.com/vault/install}'}`,
    };
  }

  if (backend === 'doppler') {
    const opts = {
      project: options.dopplerProject,
      config: options.dopplerConfig || env,
    };
    return fetchFromDoppler(cwd, opts);
  }

  if (backend === 'vault') {
    const opts = {
      mount: options.vaultMount || 'secret',
      path: options.vaultPath || `${options.projectName || 'app'}/${env}`,
      format: options.vaultFormat || 'kv2',
    };
    return fetchFromVault(cwd, opts);
  }

  return { success: false, error: `Unknown backend: ${backend}` };
}

// ============================================================
// inject - 运行时注入
// ============================================================

async function inject({ env, keys, target = 'process', backend = 'dotenv', projectRoot, prefix = '', ...options }) {
  const cwd = projectRoot || process.cwd();
  const targetEnv = env || (await getCurrentEnv(cwd)) || 'dev';

  if (!SUPPORTED_ENVS.includes(targetEnv)) {
    return buildError(`Unsupported env: ${targetEnv}`);
  }

  if (!SUPPORTED_BACKENDS.includes(backend)) {
    return buildError(`Unsupported backend: ${backend}`);
  }

  // 从后端获取密钥
  let envVars = {};
  let backendSource = backend;

  if (backend === 'dotenv') {
    const envFile = path.join(cwd, `.env.${targetEnv}`);
    let content = '';
    try {
      content = await fs.readFile(envFile, 'utf-8');
    } catch {
      return buildError(`.env.${targetEnv} not found. Run 'init' or 'set' first.`);
    }
    envVars = parseEnv(content);
  } else if (backend === 'doppler' || backend === 'vault') {
    const fetchOpts = {};
    if (backend === 'doppler') {
      if (options?.dopplerProject) fetchOpts.dopplerProject = options.dopplerProject;
      if (options?.dopplerConfig) fetchOpts.dopplerConfig = options.dopplerConfig;
    } else {
      if (options?.vaultMount) fetchOpts.vaultMount = options.vaultMount;
      if (options?.vaultPath) fetchOpts.vaultPath = options.vaultPath;
      if (options?.vaultFormat) fetchOpts.vaultFormat = options.vaultFormat;
      if (options?.projectName) fetchOpts.projectName = options.projectName;
    }
    const result = fetchFromBackend(backend, cwd, targetEnv, fetchOpts);
    if (!result.success) {
      return buildError(result.error, {
        data: { backend, env: targetEnv },
        warnings: ['Falling back to dotenv backend'],
        nextActions: [`Install ${backend} CLI or use backend=dotenv`],
      });
    }
    envVars = result.envVars;
    backendSource = result.source;
  } else {
    return buildError(`Unsupported backend: ${backend}. Supported: ${SUPPORTED_BACKENDS.join(', ')}`);
  }

  // 应用前缀过滤
  let injectedKeys = Object.keys(envVars);
  if (prefix) {
    injectedKeys = injectedKeys.filter(k => k.startsWith(prefix));
  }

  // 过滤指定 keys
  if (keys && Array.isArray(keys) && keys.length > 0) {
    injectedKeys = injectedKeys.filter(k => keys.includes(k));
  }

  // 注入到目标
  if (target === 'process') {
    for (const k of injectedKeys) {
      process.env[k] = envVars[k];
    }
  } else if (target === '.env.local') {
    const localFile = path.join(cwd, '.env.local');
    const filteredVars = {};
    injectedKeys.forEach(k => filteredVars[k] = envVars[k]);
    await writeEnvFile(localFile, filteredVars);
  }

  return buildResult({
    data: {
      summary: `✅ Injected ${injectedKeys.length} env vars into ${target}`,
      env: targetEnv,
      backend: backendSource,
      target,
      injectedCount: injectedKeys.length,
      injectedKeys,
      maskedPreview: Object.fromEntries(
        injectedKeys.map(k => [k, isSensitiveKey(k) ? maskSecret(envVars[k]) : envVars[k]])
      ),
    },
    nextActions: [`Run 'validate --env=${targetEnv}' to verify`],
  });
}

// ============================================================
// suggest - 根据项目类型推荐环境变量（LLM 增强）
// ============================================================

const BASE_SUGGESTIONS = {
  node: [
    { key: 'NODE_ENV', description: '运行环境 (development/test/production)', required: true, category: 'application' },
    { key: 'APP_PORT', description: '服务端口', required: false, default: 3000, category: 'application' },
    { key: 'DATABASE_URL', description: '数据库连接字符串', required: true, category: 'database' },
    { key: 'JWT_SECRET', description: 'JWT 签名密钥', required: true, category: 'auth' },
    { key: 'REDIS_URL', description: 'Redis 连接地址（缓存/会话）', required: false, category: 'cache' },
    { key: 'LOG_LEVEL', description: '日志级别', required: false, default: 'info', category: 'monitoring' },
  ],
  python: [
    { key: 'PYTHON_ENV', description: '运行环境 (development/production)', required: true, category: 'application' },
    { key: 'DATABASE_URL', description: '数据库连接字符串', required: true, category: 'database' },
    { key: 'SECRET_KEY', description: '应用密钥（Flask/Django）', required: true, category: 'auth' },
    { key: 'REDIS_URL', description: 'Redis 连接地址（缓存/任务队列）', required: false, category: 'cache' },
    { key: 'CELERY_BROKER_URL', description: 'Celery broker 地址', required: false, category: 'cache' },
  ],
  go: [
    { key: 'GO_ENV', description: '运行环境 (development/production)', required: true, category: 'application' },
    { key: 'APP_PORT', description: '服务端口', required: false, default: 8080, category: 'application' },
    { key: 'DATABASE_URL', description: '数据库连接字符串', required: true, category: 'database' },
    { key: 'JWT_SECRET', description: 'JWT 签名密钥', required: true, category: 'auth' },
    { key: 'REDIS_ADDR', description: 'Redis 地址', required: false, category: 'cache' },
  ],
};

async function suggest({ projectType = 'node', projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const type = (projectType || 'node').toLowerCase();

  const baseSuggestions = BASE_SUGGESTIONS[type] || BASE_SUGGESTIONS.node;

  const result = {
    ok: true,
    data: {
      projectType: type,
      suggestions: baseSuggestions,
      summary: `📋 推荐 ${baseSuggestions.length} 个环境变量（基础推荐）`,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: [],
    nextActions: [
      `Run 'init' to create environment files`,
      `Run 'set --key=KEY --value=VAL' to add values`,
    ],
  };

  // LLM 增强
  if (llm.isAvailable()) {
    try {
      let projectContext = '';
      try {
        const pkgPath = path.join(cwd, 'package.json');
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);
        projectContext += `项目名称: ${pkg.name || 'unknown'}\n`;
        projectContext += `项目描述: ${pkg.description || 'N/A'}\n`;
        if (pkg.dependencies) {
          projectContext += `主要依赖: ${Object.keys(pkg.dependencies).slice(0, 10).join(', ')}\n`;
        }
      } catch {
        // 没有 package.json
      }

      const llmResult = await llm.callLLM({
        system: `你是一名资深 DevOps 工程师，擅长为不同类型的项目设计环境变量配置方案。

请根据项目类型和上下文，输出推荐的环境变量列表（JSON 格式）：
{
  "suggestions": [
    {"key": "变量名", "description": "用途说明", "required": true/false, "default": "默认值（可选）", "category": "分类，如 database/auth/cache/monitoring"}
  ],
  "summary": "一句话总结推荐理由"
}

要求：
1. 推荐 8-15 个最核心的环境变量
2. 覆盖数据库、认证、缓存、日志、监控等常见领域
3. 遵循各语言/框架的社区惯例
4. 标注必填项和可选项
5. 变量命名遵循 UPPER_SNAKE_CASE 规范

只输出 JSON，不要任何解释或 markdown 标记。`,
        messages: [
          {
            role: 'user',
            content: `项目类型: ${type}

${projectContext ? '项目上下文：\n' + projectContext : ''}

请为该项目推荐合适的环境变量配置。`,
          },
        ],
        temperature: 0.3,
        maxTokens: 2048,
      });

      if (llmResult.ok) {
        let llmSuggestions;
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          llmSuggestions = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        } catch {
          llmSuggestions = null;
        }

        if (llmSuggestions && Array.isArray(llmSuggestions.suggestions)) {
          result.data.llmEnhanced = true;
          result.data.llmProvider = llmResult.provider;
          result.data.suggestions = llmSuggestions.suggestions;
          result.data.summary = `📋 推荐 ${llmSuggestions.suggestions.length} 个环境变量（LLM 智能推荐）`;
          if (llmSuggestions.summary) {
            result.data.summary += ` — ${llmSuggestions.summary}`;
          }
        }
      }
    } catch {
      // 静默回退
      result.data.llmEnhanced = false;
    }
  }

  return result;
}

// ============================================================
// 导出（主命令 + 别名）
// ============================================================

module.exports = {
  // 核心命令
  init,
  switch: switchEnv,
  switchEnv,
  list: listEnv,
  listEnv,
  validate,
  secrets,
  diff,

  // 外部后端集成
  detectCli,
  fetchFromDoppler,
  fetchFromVault,
  fetchFromBackend,
  secretsSync,

  // 原有命令（保持兼容）
  set,
  get,
  inject,
  suggest,

  // 密钥轮换
  rotate: async function rotate({ env, keys, projectRoot }) {
    const cwd = projectRoot || process.cwd();
    const targetEnv = env || 'prod';
    const envPath = path.join(cwd, 'envs', targetEnv, '.env');

    let envContent;
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch {
      return { ok: false, error: `Environment ${targetEnv} not found. Run init first.`, data: null, warnings: [], nextActions: [] };
    }

    const lines = envContent.split('\n');
    const sensitiveKeys = lines
      .map(l => l.match(/^([A-Z_][A-Z0-9_]*)=/))
      .filter(Boolean)
      .map(m => m[1])
      .filter(k => SENSITIVE_PATTERNS.some(p => p.test(k)));

    const targetKeys = keys ? keys.split(',').map(k => k.trim()) : sensitiveKeys;

    if (targetKeys.length === 0) {
      return {
        ok: true,
        data: { summary: `No sensitive keys found in ${targetEnv} to rotate`, env: targetEnv, rotatedKeys: [], llmEnhanced: false, llmProvider: null },
        warnings: [],
        nextActions: [],
      };
    }

    const rotated = [];
    for (const key of targetKeys) {
      const placeholder = `<ROTATED_${Date.now()}_${key.slice(-4)}>`;
      const regex = new RegExp(`^(${key}=).*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `$1${placeholder}`);
        rotated.push({ key, placeholder, status: 'placeholder_set' });
      }
    }

    await fs.writeFile(envPath, envContent, 'utf-8');

    let llmEnhanced = false;
    let llmProvider = null;
    let plan = null;

    if (llm.isAvailable()) {
      try {
        const result = await llm.callLLM({
          system: '你是密钥管理专家。根据需要轮换的密钥列表，生成轮换计划。',
          messages: [{ role: 'user', content: `需要轮换的密钥: ${targetKeys.join(', ')}\n环境: ${targetEnv}\n\n输出 JSON: {"steps": [...], "services": [...], "rollbackPlan": "..."}` }],
          temperature: 0.2,
          maxTokens: 1024,
        });
        if (result.ok) {
          const m = result.content.match(/\{[\s\S]*\}/);
          if (m) { plan = JSON.parse(m[0]); llmEnhanced = true; llmProvider = llm.getProviderName(); }
        }
      } catch { /* graceful */ }
    }

    return {
      ok: true,
      data: {
        summary: `Rotated ${rotated.length} keys in ${targetEnv}`,
        env: targetEnv,
        rotatedKeys: rotated,
        rotationPlan: plan,
        llmEnhanced,
        llmProvider,
      },
      warnings: [`Placeholders set in ${envPath}. Replace <ROTATED_...> with real values before deploying.`],
      nextActions: [`Replace all <ROTATED_...> placeholders in ${envPath}`, 'Restart services that depend on these keys'],
    };
  },

  // 别名
  envInit: init,
  envSwitch: switchEnv,
  envList: listEnv,
  envValidate: validate,
  envSecrets: secrets,
  envDiff: diff,
  envSet: set,
  envGet: get,
  envInject: inject,
  envSuggest: suggest,

  // 常量（方便测试/外部引用）
  SUPPORTED_ENVS,
  ENV_DESCRIPTIONS,
};
