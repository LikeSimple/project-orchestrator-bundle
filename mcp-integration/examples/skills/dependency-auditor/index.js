/**
 * dependency-auditor Skill - 完整实现
 *
 * 依赖审计：漏洞扫描 + License 合规 + 过期依赖检测 + 维护活跃度。
 * 集成 npm audit / npm outdated / 本地 License 扫描。
 *
 * 对应 MCP Tool: audit_dependencies
 *
 * 命令清单：
 *   audit     - 完整安全审计（真实 npm audit + License + 已知风险）
 *   outdated  - 检测过期/废弃依赖（npm outdated + deprecated 检测）
 *   licenses  - License 合规检查（扫描所有依赖的 License）
 *   report    - 生成完整审计报告（audit + outdated + licenses 汇总）
 *   summary   - 快速概览（精简版审计摘要）
 *   check     - 加包前单包检查（兼容现有接口）
 *   advisory  - LLM 增强：针对特定依赖的安全/维护建议
 *   migrate   - LLM 增强：依赖升级/迁移指南
 *   explain   - LLM 增强：解释依赖的作用和风险
 */

const fs = require('fs').promises;
const path = require('path');
const { exec, spawnSync } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ============================================================
// 配置常量
// ============================================================

const NPM_COMMAND_TIMEOUT = 30_000; // 30 秒超时

const ALLOWED_LICENSES = [
  'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC',
  'Unlicense', 'CC0-1.0', 'LGPL-2.1', 'MPL-2.0', 'EPL-2.0',
];

const FORBIDDEN_LICENSES = [
  'GPL-2.0', 'GPL-3.0', 'AGPL-1.0', 'AGPL-3.0',
  'SSPL-1.0', 'BUSL-1.1', 'Commons-Clause',
];

// 已知高风险包（维护中断 + 已知问题）
const KNOWN_BAD_PACKAGES = {
  'left-pad': { reason: '作者弃坑', alternatives: ['pad-left', 'leftpad-modern'] },
  'event-stream': { reason: '已知供应链攻击', alternatives: ['使用原生 EventEmitter'] },
  'node-ipc': { reason: '2022 供应链攻击事件', alternatives: ['netcat', 'socket.io'] },
  'colors': { reason: '2022 故意破坏事件', alternatives: ['picocolors', 'kleur'] },
  'node-uuid': { reason: '已废弃', alternatives: ['uuid', 'nanoid'] },
};

// ============================================================
// LLM 客户端（可选增强）
// ============================================================

let llm = null;
try {
  llm = require('../../lib/llm-client');
} catch {
  llm = null;
}

// AST 解析器（用于源码级依赖使用分析）
const ast = require('../../lib/ast-parser');

function llmIsAvailable() {
  return llm && typeof llm.isAvailable === 'function' && llm.isAvailable();
}

function getLLMProvider() {
  if (!llmIsAvailable()) return null;
  return (llm.getProvider && llm.getProvider()) || 'unknown';
}

async function safeLLMCall({ system, messages, temperature = 0.2, maxTokens = 2048 }) {
  if (!llmIsAvailable()) return null;
  try {
    const result = await llm.callLLM({ system, messages, temperature, maxTokens });
    if (result.ok) return result;
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 工具函数 - npm 命令执行
// ============================================================

/**
 * 安全执行 npm 命令（带超时和错误捕获）
 * Windows 下 execAsync 的 stdout pipe 不可靠，使用 spawnSync + shell:true 替代
 * @param {string} cmd - npm 命令及参数
 * @param {string} cwd - 工作目录
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {{ stdout: string, stderr: string, success: boolean, error?: string }}
 */
async function runNpmCommand(cmd, cwd, timeout = NPM_COMMAND_TIMEOUT) {
  if (process.platform === 'win32') {
    const r = runNpmCommandSync(cmd, cwd, timeout);
    return { stdout: r.stdout, stderr: r.stderr || '', success: r.success, partial: r.partial, error: r.error };
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, success: true };
  } catch (err) {
    if (err.stdout) {
      return { stdout: err.stdout, stderr: err.stderr || '', success: true, partial: true };
    }
    return { stdout: '', stderr: err.message || String(err), success: false, error: err.message || String(err) };
  }
}

/**
 * 同步执行 npm 命令（带超时）
 * 使用 spawnSync + shell:true 避免 Windows stdout pipe 问题
 * @param {string} cmd
 * @param {string} cwd
 * @param {number} timeout
 * @returns {{ stdout: string, stderr: string, success: boolean, partial?: boolean, error?: string }}
 */
function runNpmCommandSync(cmd, cwd, timeout = NPM_COMMAND_TIMEOUT) {
  const r = spawnSync(cmd, {
    cwd,
    timeout,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    shell: true,
  });
  if (r.error || (r.status !== 0 && !r.stdout)) {
    return { stdout: '', stderr: r.stderr || '', success: false, error: r.error?.message || `Command failed: ${cmd}` };
  }
  return {
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    success: true,
    partial: r.status !== 0,
  };
}

// ============================================================
// 工具函数 - 文件读取
// ============================================================

async function readLocalPackageJson(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readLocalPackageJsonSync(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  try {
    const content = require('fs').readFileSync(pkgPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 获取所有依赖（合并 dependencies 和 devDependencies）
 */
function getAllDeps(pkg, scope = 'all') {
  const deps = {};
  if (scope === 'all' || scope === 'production') {
    Object.assign(deps, pkg.dependencies || {});
  }
  if (scope === 'all' || scope === 'development') {
    Object.assign(deps, pkg.devDependencies || {});
  }
  return deps;
}

// ============================================================
// AST 增强分析：源码级依赖使用检测
// ============================================================

/**
 * 扫描项目源码中的 import/require，与 package.json 依赖对比，
 * 找出可能未被使用的依赖。
 * @param {string} cwd - 项目根目录
 * @param {Object} allDeps - package.json 中的依赖 { name: version }
 * @returns {{unusedDeps: string[], usedDeps: string[], astEnhanced: boolean, sourcesScanned: number}}
 */
async function analyzeDependencyUsageAST(cwd, allDeps) {
  const depNames = Object.keys(allDeps);
  if (depNames.length === 0) return { unusedDeps: [], usedDeps: [], astEnhanced: false, sourcesScanned: 0 };

  const usedSet = new Set();
  let sourcesScanned = 0;

  // 递归收集 JS/TS 源文件（排除 node_modules / dist / build）
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

        // ES Module imports
        const imports = ast.extractImports(content);
        for (const imp of imports) {
          const src = imp.source;
          // 只关心外部包（非相对路径 / 绝对路径）
          if (src && !src.startsWith('.') && !src.startsWith('/')) {
            // 取包名（支持 @scope/pkg 和 pkg）
            const pkgName = src.startsWith('@')
              ? src.split('/').slice(0, 2).join('/')
              : src.split('/')[0];
            usedSet.add(pkgName);
          }
        }

        // CommonJS require()
        const requires = ast.extractRequireCalls(content);
        for (const req of requires) {
          const src = req.source;
          if (src && !src.startsWith('.') && !src.startsWith('/')) {
            const pkgName = src.startsWith('@')
              ? src.split('/').slice(0, 2).join('/')
              : src.split('/')[0];
            usedSet.add(pkgName);
          }
        }
      } catch {
        // 文件读取失败，跳过
      }
    }
  } catch {
    // 目录读取失败，静默回退
    return { unusedDeps: [], usedDeps: depNames, astEnhanced: false, sourcesScanned: 0 };
  }

  const unusedDeps = depNames.filter(name => !usedSet.has(name));
  const usedDeps = depNames.filter(name => usedSet.has(name));

  return {
    unusedDeps,
    usedDeps,
    astEnhanced: true,
    sourcesScanned,
  };
}

// ============================================================
// 工具函数 - License 分类
// ============================================================

function classifyLicense(license) {
  if (!license) return { category: 'unknown', level: 'unknown' };

  const normalized = (typeof license === 'object' ? license.type : license)
    .toString()
    .toUpperCase()
    .trim();

  // Copyleft / 禁止类
  if (FORBIDDEN_LICENSES.some(f => normalized.includes(f.toUpperCase().replace(/-/g, '')) ||
    normalized.includes(f.toUpperCase()))) {
    return { category: 'copyleft', level: 'high' };
  }

  // 宽松许可证
  if (ALLOWED_LICENSES.some(a => normalized.includes(a.toUpperCase()) ||
    normalized.includes(a.toUpperCase().replace(/-/g, '')))) {
    return { category: 'permissive', level: 'low' };
  }

  // 常见宽松许可证的简写
  if (normalized.includes('BSD')) return { category: 'permissive', level: 'low' };
  if (normalized.includes('MIT')) return { category: 'permissive', level: 'low' };
  if (normalized.includes('APACHE')) return { category: 'permissive', level: 'low' };
  if (normalized.includes('ISC')) return { category: 'permissive', level: 'low' };

  // 常见 Copyleft
  if (normalized.includes('GPL')) return { category: 'copyleft', level: 'high' };
  if (normalized.includes('AGPL')) return { category: 'copyleft', level: 'critical' };

  // 商业/专有
  if (normalized.includes('PROPRIETARY') || normalized.includes('COMMERCIAL')) {
    return { category: 'proprietary', level: 'medium' };
  }

  // 公共领域
  if (normalized.includes('PUBLIC DOMAIN') || normalized.includes('UNLICENSE') || normalized.includes('CC0')) {
    return { category: 'permissive', level: 'low' };
  }

  return { category: 'unknown', level: 'medium' };
}

// ============================================================
// 工具函数 - 版本比较
// ============================================================

/**
 * 比较两个语义化版本，判断升级类型
 * @param {string} current - 当前版本
 * @param {string} latest - 最新版本
 * @returns {'major'|'minor'|'patch'|'prerelease'|'unknown'}
 */
function getUpgradeType(current, latest) {
  if (!current || !latest) return 'unknown';

  const parseVer = (v) => {
    // 移除 ^ ~ 等前缀
    const clean = v.replace(/^[\^~>=<]+/, '').split('-')[0];
    const parts = clean.split('.').map(Number);
    return {
      major: isNaN(parts[0]) ? 0 : parts[0],
      minor: isNaN(parts[1]) ? 0 : parts[1],
      patch: isNaN(parts[2]) ? 0 : parts[2],
    };
  };

  const c = parseVer(current);
  const l = parseVer(latest);

  if (l.major > c.major) return 'major';
  if (l.minor > c.minor) return 'minor';
  if (l.patch > c.patch) return 'patch';
  if (latest.includes('-') && !current.includes('-')) return 'prerelease';
  return 'unknown';
}

/**
 * 从版本字符串中提取干净版本号
 */
function cleanVersion(ver) {
  if (!ver) return '';
  return ver.replace(/^[\^~>=<]+/, '').split(' ')[0];
}

// ============================================================
// 工具函数 - 时间辅助
// ============================================================

function daysBetween(dateStr, now = new Date()) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const diffMs = now - date;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ============================================================
// 核心扫描器 1: npm audit 漏洞扫描
// ============================================================

/**
 * 执行 npm audit 并解析结果
 * @param {string} cwd - 项目根目录
 * @param {Object} options - { scope: 'all'|'production', level: 'low'|'moderate'|'high'|'critical' }
 * @returns {Promise<Object>} 漏洞扫描结果
 */
async function runNpmAudit(cwd, options = {}) {
  const { scope = 'all', level = 'low' } = options;

  const scopeFlag = scope === 'production' ? ' --production' : '';
  const cmd = `npm audit --json --audit-level=${level}${scopeFlag}`;

  const result = await runNpmCommand(cmd, cwd);

  if (!result.success && !result.partial) {
    return {
      available: false,
      error: result.error || 'npm audit failed',
      vulnerabilities: [],
      summary: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      metadata: null,
    };
  }

  try {
    const auditData = JSON.parse(result.stdout);

    // 解析 vulnerabilities（npm 7+ 格式）
    const vulnerabilities = [];
    const vulnObj = auditData.vulnerabilities || {};

    for (const [pkgName, vulnInfo] of Object.entries(vulnObj)) {
      if (pkgName === '') continue;

      const severity = vulnInfo.severity || 'unknown';
      const viaList = Array.isArray(vulnInfo.via) ? vulnInfo.via : [];
      const cves = viaList
        .filter(v => typeof v === 'object' && v.source)
        .map(v => ({
          title: v.title || 'Unknown',
          url: v.url || '',
          cwe: v.cwe || [],
          severity: v.severity || severity,
          range: v.range || '',
        }));

      const fixAvailable = vulnInfo.fixAvailable
        ? (typeof vulnInfo.fixAvailable === 'object'
          ? { name: vulnInfo.fixAvailable.name, version: vulnInfo.fixAvailable.version, isSemVerMajor: vulnInfo.fixAvailable.isSemVerMajor }
          : { available: true })
        : { available: false };

      vulnerabilities.push({
        package: pkgName,
        severity,
        isDirect: vulnInfo.isDirect || false,
        range: vulnInfo.range || '',
        nodes: vulnInfo.nodes || [],
        via: cves.length > 0 ? cves : [{ title: typeof viaList[0] === 'string' ? viaList[0] : 'Unknown vulnerability' }],
        fixAvailable,
        fixRecommendation: fixAvailable.available
          ? (fixAvailable.name ? `Upgrade ${fixAvailable.name} to ${fixAvailable.version}` : 'Run npm audit fix')
          : 'No direct fix available',
      });
    }

    // 统计摘要
    const summary = {
      critical: vulnerabilities.filter(v => v.severity === 'critical').length,
      high: vulnerabilities.filter(v => v.severity === 'high').length,
      moderate: vulnerabilities.filter(v => v.severity === 'moderate').length,
      low: vulnerabilities.filter(v => v.severity === 'low').length,
      info: vulnerabilities.filter(v => v.severity === 'info').length,
    };

    return {
      available: true,
      vulnerabilities,
      summary,
      total: vulnerabilities.length,
      metadata: auditData.metadata || null,
      error: null,
    };
  } catch (parseErr) {
    return {
      available: false,
      error: `Failed to parse npm audit output: ${parseErr.message}`,
      vulnerabilities: [],
      summary: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 },
      metadata: null,
    };
  }
}

// ============================================================
// 核心扫描器 2: License 检查
// ============================================================

/**
 * 扫描 node_modules 中所有依赖的 License
 * @param {string} cwd - 项目根目录
 * @param {Object} options - { scope: 'all'|'production' }
 * @returns {Promise<Object>} License 扫描结果
 */
async function scanLicenses(cwd, options = {}) {
  const { scope = 'all' } = options;
  const pkg = await readLocalPackageJson(cwd);

  if (!pkg) {
    return {
      available: false,
      error: 'package.json not found',
      licenses: [],
      summary: { permissive: 0, copyleft: 0, proprietary: 0, unknown: 0 },
    };
  }

  const allDeps = getAllDeps(pkg, scope);
  const depNames = Object.keys(allDeps);
  const licenses = [];
  const errors = [];

  for (const name of depNames) {
    try {
      // 处理 scoped package
      const depPkgPath = path.join(cwd, 'node_modules', name, 'package.json');
      const depPkgContent = await fs.readFile(depPkgPath, 'utf-8');
      const depPkg = JSON.parse(depPkgContent);

      const licenseRaw = depPkg.license || (depPkg.licenses && depPkg.licenses[0]) || 'UNKNOWN';
      const licenseStr = typeof licenseRaw === 'object' ? licenseRaw.type : String(licenseRaw);
      const classification = classifyLicense(licenseStr);

      licenses.push({
        package: name,
        version: depPkg.version || allDeps[name] || 'unknown',
        license: licenseStr,
        category: classification.category,
        riskLevel: classification.level,
        repository: depPkg.repository?.url || depPkg.repository || '',
        homepage: depPkg.homepage || '',
        deprecated: !!depPkg.deprecated,
      });
    } catch (err) {
      errors.push({ package: name, error: err.message });
      // 未找到 node_modules 中的包，标记为 unknown
      licenses.push({
        package: name,
        version: allDeps[name] || 'unknown',
        license: 'UNKNOWN',
        category: 'unknown',
        riskLevel: 'medium',
        notInstalled: true,
      });
    }
  }

  const summary = {
    permissive: licenses.filter(l => l.category === 'permissive').length,
    copyleft: licenses.filter(l => l.category === 'copyleft').length,
    proprietary: licenses.filter(l => l.category === 'proprietary').length,
    unknown: licenses.filter(l => l.category === 'unknown').length,
    total: licenses.length,
  };

  const highRisk = licenses.filter(l => l.riskLevel === 'high' || l.riskLevel === 'critical');

  return {
    available: true,
    licenses,
    summary,
    highRiskCount: highRisk.length,
    highRiskLicenses: highRisk,
    errors,
    notInstalledCount: licenses.filter(l => l.notInstalled).length,
  };
}

// ============================================================
// 核心扫描器 3: 过期依赖检测 (npm outdated)
// ============================================================

/**
 * 执行 npm outdated 获取过期依赖信息
 * @param {string} cwd - 项目根目录
 * @param {Object} options - { scope: 'all'|'production', long: boolean }
 * @returns {Promise<Object>} 过期依赖结果
 */
async function runNpmOutdated(cwd, options = {}) {
  const { scope = 'all', long = false } = options;

  const scopeFlag = scope === 'production' ? ' --production' : '';
  const longFlag = long ? ' --long' : '';
  const cmd = `npm outdated --json${scopeFlag}${longFlag}`;

  const result = await runNpmCommand(cmd, cwd);

  if (!result.success && !result.partial) {
    return {
      available: false,
      error: result.error || 'npm outdated failed',
      outdated: [],
      summary: { major: 0, minor: 0, patch: 0 },
    };
  }

  try {
    // npm outdated 在没有过期包时 stdout 为空且退出码 0
    if (!result.stdout || result.stdout.trim() === '') {
      return {
        available: true,
        outdated: [],
        summary: { major: 0, minor: 0, patch: 0, total: 0 },
        allUpToDate: true,
      };
    }

    const outdatedData = JSON.parse(result.stdout);
    const outdated = [];

    for (const [pkgName, info] of Object.entries(outdatedData)) {
      const current = info.current || '';
      const wanted = info.wanted || '';
      const latest = info.latest || '';
      const upgradeType = getUpgradeType(current, latest);

      outdated.push({
        package: pkgName,
        current,
        wanted,
        latest,
        upgradeType,
        type: info.depType || info.type || 'unknown',
        homepage: info.homepage || '',
        urgent: upgradeType === 'major',
      });
    }

    const summary = {
      major: outdated.filter(o => o.upgradeType === 'major').length,
      minor: outdated.filter(o => o.upgradeType === 'minor').length,
      patch: outdated.filter(o => o.upgradeType === 'patch').length,
      total: outdated.length,
    };

    return {
      available: true,
      outdated,
      summary,
      allUpToDate: outdated.length === 0,
    };
  } catch (parseErr) {
    return {
      available: false,
      error: `Failed to parse npm outdated output: ${parseErr.message}`,
      outdated: [],
      summary: { major: 0, minor: 0, patch: 0, total: 0 },
    };
  }
}

// ============================================================
// 核心扫描器 4: 废弃包检测
// ============================================================

/**
 * 检测已废弃的依赖包
 * @param {string} cwd - 项目根目录
 * @param {Object} options - { scope: 'all'|'production' }
 * @returns {Promise<Object>} 废弃包检测结果
 */
async function detectDeprecated(cwd, options = {}) {
  const { scope = 'all' } = options;
  const pkg = await readLocalPackageJson(cwd);

  if (!pkg) {
    return {
      available: false,
      error: 'package.json not found',
      deprecated: [],
    };
  }

  const allDeps = getAllDeps(pkg, scope);
  const deprecated = [];

  for (const name of Object.keys(allDeps)) {
    try {
      const depPkgPath = path.join(cwd, 'node_modules', name, 'package.json');
      const depPkgContent = await fs.readFile(depPkgPath, 'utf-8');
      const depPkg = JSON.parse(depPkgContent);

      if (depPkg.deprecated) {
        deprecated.push({
          package: name,
          version: depPkg.version || allDeps[name],
          message: typeof depPkg.deprecated === 'string' ? depPkg.deprecated : 'This package has been deprecated',
        });
      }
    } catch {
      // 包未安装，跳过
    }
  }

  return {
    available: true,
    deprecated,
    count: deprecated.length,
  };
}

// ============================================================
// 核心扫描器 5: 长时间未更新检测
// ============================================================

/**
 * 检测超过指定天数未更新的包（基于本地 node_modules 的 time 信息）
 * @param {string} cwd
 * @param {Object} options - { scope: 'all'|'production', daysThreshold: 365 }
 * @returns {Promise<Object>}
 */
async function detectStalePackages(cwd, options = {}) {
  const { scope = 'all', daysThreshold = 365 } = options;
  const pkg = await readLocalPackageJson(cwd);

  if (!pkg) {
    return {
      available: false,
      error: 'package.json not found',
      stale: [],
    };
  }

  const allDeps = getAllDeps(pkg, scope);
  const stale = [];
  const now = new Date();

  for (const name of Object.keys(allDeps)) {
    try {
      const depPkgPath = path.join(cwd, 'node_modules', name, 'package.json');
      const depPkgContent = await fs.readFile(depPkgPath, 'utf-8');
      const depPkg = JSON.parse(depPkgContent);

      // 从 package.json 的 _fields 或时间戳推断
      // 本地包没有发布时间，我们用 node_modules 文件夹的 mtime 近似
      const stat = await fs.stat(path.join(cwd, 'node_modules', name));
      const daysSinceInstall = daysBetween(stat.mtime, now);

      // 如果有 npm 缓存的 time 信息更好，但这里用本地信息
      // 标记为可能过期，需要结合 outdated 结果综合判断
      if (daysSinceInstall !== null && daysSinceInstall > daysThreshold) {
        stale.push({
          package: name,
          version: depPkg.version || allDeps[name],
          daysSinceInstall,
          note: '本地安装时间超过阈值，可能已过期，建议运行 npm outdated 确认',
        });
      }
    } catch {
      // 包未安装，跳过
    }
  }

  return {
    available: true,
    stale,
    count: stale.length,
    daysThreshold,
  };
}

// ============================================================
// 命令 1: audit - 完整安全审计
// ============================================================

async function audit({ projectRoot, addPackage, ecosystem = 'npm', scope = 'all', failOnLicense = [], includeLLM = true }) {
  const cwd = projectRoot || process.cwd();

  // 单包审计
  if (addPackage) {
    return await auditSinglePackage(addPackage, failOnLicense);
  }

  if (ecosystem !== 'npm') {
    return {
      ok: false,
      error: `Ecosystem ${ecosystem} not yet implemented (only npm)`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  const pkg = await readLocalPackageJson(cwd);
  if (!pkg) {
    return {
      ok: false,
      error: `package.json not found at ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  const allDeps = getAllDeps(pkg, scope);

  // 1. 真实 npm audit 扫描
  const auditResult = await runNpmAudit(cwd, { scope });

  // 2. License 检查
  const licenseResult = await scanLicenses(cwd, { scope });

  // 3. 已知恶意包检查
  const knownBadIssues = [];
  for (const [name, version] of Object.entries(allDeps)) {
    if (KNOWN_BAD_PACKAGES[name]) {
      knownBadIssues.push({
        package: name,
        version,
        reason: KNOWN_BAD_PACKAGES[name].reason,
        alternatives: KNOWN_BAD_PACKAGES[name].alternatives,
        severity: 'critical',
      });
    }
  }

  // 4. 漏洞统计
  const vulnerabilities = auditResult.available ? auditResult.vulnerabilities : [];
  const vulnSummary = auditResult.available ? auditResult.summary : { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };

  // 5. License 问题
  const licenseIssues = licenseResult.available
    ? licenseResult.highRiskLicenses.map(l => ({
      package: l.package,
      version: l.version,
      license: l.license,
      category: l.category,
      severity: l.riskLevel,
    }))
    : [];

  // 6. 总评
  const criticalCount = vulnSummary.critical + knownBadIssues.filter(k => k.severity === 'critical').length;
  const highCount = vulnSummary.high + licenseIssues.filter(l => l.severity === 'high' || l.severity === 'critical').length;
  const moderateCount = vulnSummary.moderate;
  const lowCount = vulnSummary.low;

  const hasBlockers = criticalCount > 0 || highCount > 0 || knownBadIssues.length > 0;
  const verdict = hasBlockers ? 'BLOCK' : 'PASS';

  // 7. LLM 增强分析
  let llmEnhanced = false;
  let llmProvider = null;
  let llmAnalysis = null;
  let llmRecommendations = [];

  if (includeLLM && llmIsAvailable()) {
    llmProvider = getLLMProvider();
    const llmResult = await safeLLMCall({
      system: '你是资深安全工程师和依赖管理专家，精通 npm 生态系统的安全性、许可证合规性和维护状态评估。请以 JSON 格式输出分析结果。',
      messages: [{
        role: 'user',
        content: `请对以下项目依赖进行深度风险分析：

## 项目依赖 (${Object.keys(allDeps).length} 个)
${JSON.stringify(allDeps, null, 2)}

## 已发现的漏洞 (${vulnerabilities.length} 个)
${JSON.stringify(vulnerabilities.slice(0, 20), null, 2)}

## 已知风险包
${JSON.stringify(knownBadIssues, null, 2)}

## License 问题
${JSON.stringify(licenseIssues, null, 2)}

请输出以下 JSON 格式的分析结果（不要输出 markdown 代码块）：
{
  "overallRisk": "low|medium|high|critical",
  "riskSummary": "一句话风险总结",
  "vulnerabilityPriority": [
    {"package": "包名", "priority": "critical|high|medium|low", "action": "修复建议"}
  ],
  "licenseRisks": [
    {"package": "包名", "risk": "许可证风险描述", "severity": "low|medium|high"}
  ],
  "recommendations": [
    {"priority": "high|medium|low", "action": "具体建议", "package": "相关包名"}
  ],
  "alternatives": [
    {"package": "原包名", "alternatives": ["替代包1", "替代包2"], "reason": "替换理由"}
  ],
  "remediationRoadmap": {
    "immediate": ["立即修复项"],
    "shortTerm": ["短期修复项"],
    "longTerm": ["长期优化项"]
  }
}`
      }],
      temperature: 0.2,
      maxTokens: 3072,
    });

    if (llmResult) {
      llmEnhanced = true;
      try {
        const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
        llmAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        if (llmAnalysis.recommendations) {
          llmRecommendations = llmAnalysis.recommendations.map(r => r.action);
        }
      } catch {
        llmAnalysis = { raw: llmResult.content };
      }
    }
  }

  const baseActions = verdict === 'PASS'
    ? ['All dependencies OK']
    : [
      ...(vulnerabilities.length > 0 ? ['Run `npm audit fix` to address vulnerabilities'] : []),
      ...(knownBadIssues.length > 0 ? ['Replace known bad packages with alternatives'] : []),
      ...(licenseIssues.length > 0 ? ['Review copyleft license compliance'] : []),
    ];

  const allNextActions = [
    ...baseActions,
    ...llmRecommendations.slice(0, 5),
  ];

  const allWarnings = [
    ...vulnerabilities.filter(v => v.severity === 'moderate' || v.severity === 'low').map(v => `${v.package}: ${v.severity} vulnerability`),
    ...licenseIssues.filter(l => l.severity === 'medium').map(l => `${l.package}: ${l.license} license`),
  ];

  return {
    ok: verdict === 'PASS',
    data: {
      llmEnhanced,
      llmProvider,
      summary: verdict === 'PASS'
        ? `Audit passed (${vulnerabilities.length} vulnerabilities, ${licenseIssues.length} license issues)`
        : `Audit blocked (${criticalCount} critical, ${highCount} high)`,
      verdict,
      ecosystem,
      scope,
      packagesAudited: Object.keys(allDeps).length,
      vulnerabilities,
      vulnerabilitySummary: vulnSummary,
      licenseIssues,
      licenseSummary: licenseResult.available ? licenseResult.summary : null,
      knownBadIssues,
      auditAvailable: auditResult.available,
      auditError: auditResult.error || null,
      llmAnalysis,
    },
    warnings: allWarnings,
    nextActions: allNextActions,
  };
}

// ============================================================
// 命令 2: outdated - 过期依赖检测
// ============================================================

async function outdated({ projectRoot, scope = 'all', includeDeprecated = true, includeLLM = true }) {
  const cwd = projectRoot || process.cwd();

  const pkg = await readLocalPackageJson(cwd);
  if (!pkg) {
    return {
      ok: false,
      error: `package.json not found at ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  // 1. npm outdated 真实扫描
  const outdatedResult = await runNpmOutdated(cwd, { scope });

  // 2. 废弃包检测
  let deprecatedResult = { available: false, deprecated: [], count: 0 };
  if (includeDeprecated) {
    deprecatedResult = await detectDeprecated(cwd, { scope });
  }

  // 3. 已知风险包交叉
  const allDeps = getAllDeps(pkg, scope);
  const knownBadInDeps = Object.keys(allDeps)
    .filter(name => KNOWN_BAD_PACKAGES[name])
    .map(name => ({
      package: name,
      version: allDeps[name],
      reason: KNOWN_BAD_PACKAGES[name].reason,
      alternatives: KNOWN_BAD_PACKAGES[name].alternatives,
    }));

  // 4. LLM 增强分析
  let llmEnhanced = false;
  let llmProvider = null;
  let llmAnalysis = null;
  let llmUpgradePlan = [];

  if (includeLLM && llmIsAvailable() && outdatedResult.outdated.length > 0) {
    llmProvider = getLLMProvider();
    const llmResult = await safeLLMCall({
      system: '你是资深依赖管理专家，精通 npm 生态的版本管理和升级策略。请以 JSON 格式输出分析结果。',
      messages: [{
        role: 'user',
        content: `请分析以下过期依赖并制定升级计划：

## 过期依赖 (${outdatedResult.outdated.length} 个)
${JSON.stringify(outdatedResult.outdated.slice(0, 30), null, 2)}

## 已废弃包 (${deprecatedResult.count} 个)
${JSON.stringify(deprecatedResult.deprecated, null, 2)}

## 已知风险包
${JSON.stringify(knownBadInDeps, null, 2)}

请输出以下 JSON 格式的分析结果（不要输出 markdown 代码块）：
{
  "upgradePrioritySummary": "一句话升级优先级总结",
  "majorUpgrades": [
    {"package": "包名", "risk": "升级风险评估", "breakingChanges": "破坏性变更说明", "recommendation": "建议"}
  ],
  "upgradePlan": [
    {"package": "包名", "current": "当前版本", "target": "目标版本", "type": "major|minor|patch", "priority": "high|medium|low", "effort": "low|medium|high", "notes": "升级注意事项"}
  ],
  "quickWins": ["可快速安全升级的包列表"],
  "riskyUpgrades": ["需要谨慎评估的 major 升级"],
  "deprecatedActions": [
    {"package": "包名", "action": "建议动作", "alternatives": ["替代方案"]}
  ]
}`
      }],
      temperature: 0.2,
      maxTokens: 3072,
    });

    if (llmResult) {
      llmEnhanced = true;
      try {
        const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
        llmAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        if (llmAnalysis.upgradePlan) {
          llmUpgradePlan = llmAnalysis.upgradePlan;
        }
      } catch {
        llmAnalysis = { raw: llmResult.content };
      }
    }
  }

  const outdatedList = outdatedResult.available ? outdatedResult.outdated : [];
  const summary = outdatedResult.available ? outdatedResult.summary : { major: 0, minor: 0, patch: 0, total: 0 };

  const nextActions = [
    ...(summary.major > 0 ? [`${summary.major} major updates available (review carefully)`] : []),
    ...(summary.minor > 0 ? [`${summary.minor} minor updates available`] : []),
    ...(summary.patch > 0 ? [`${summary.patch} patch updates available`] : []),
    ...(deprecatedResult.count > 0 ? [`${deprecatedResult.count} deprecated packages found`] : []),
    ...(summary.total === 0 && deprecatedResult.count === 0 ? ['All dependencies up to date'] : []),
    ...(outdatedResult.available && outdatedList.length > 0 ? ['Run `npm update` for minor/patch updates'] : []),
  ];

  return {
    ok: true,
    data: {
      llmEnhanced,
      llmProvider,
      summary: outdatedResult.available
        ? (summary.total === 0
          ? 'All dependencies up to date'
          : `${summary.total} outdated: ${summary.major} major, ${summary.minor} minor, ${summary.patch} patch`)
        : 'npm outdated not available',
      outdated: outdatedList,
      outdatedSummary: summary,
      deprecated: deprecatedResult.deprecated,
      deprecatedCount: deprecatedResult.count,
      knownBad: knownBadInDeps,
      outdatedAvailable: outdatedResult.available,
      outdatedError: outdatedResult.error || null,
      llmAnalysis,
    },
    warnings: [
      ...outdatedList.filter(o => o.upgradeType === 'major').map(o => `${o.package}: major update (${o.current} -> ${o.latest})`),
      ...deprecatedResult.deprecated.map(d => `${d.package}: deprecated`),
    ],
    nextActions,
  };
}

// ============================================================
// 命令 3: licenses - License 合规检查
// ============================================================

async function licenses({ projectRoot, scope = 'all', failOn = [], includeLLM = true }) {
  const cwd = projectRoot || process.cwd();

  const pkg = await readLocalPackageJson(cwd);
  if (!pkg) {
    return {
      ok: false,
      error: `package.json not found at ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  // 1. 真实 License 扫描
  const licenseResult = await scanLicenses(cwd, { scope });

  if (!licenseResult.available) {
    return {
      ok: false,
      error: licenseResult.error || 'License scan failed',
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  // 2. 分类汇总
  const permissive = licenseResult.licenses.filter(l => l.category === 'permissive');
  const copyleft = licenseResult.licenses.filter(l => l.category === 'copyleft');
  const proprietary = licenseResult.licenses.filter(l => l.category === 'proprietary');
  const unknown = licenseResult.licenses.filter(l => l.category === 'unknown');

  // 3. 检查 failOn 列表
  const failOnIssues = licenseResult.licenses.filter(l =>
    failOn.length > 0 && failOn.some(f => l.license.toUpperCase().includes(f.toUpperCase()))
  );

  const highRiskCount = copyleft.length + failOnIssues.length;
  const compliant = highRiskCount === 0;

  // 4. LLM 增强分析
  let llmEnhanced = false;
  let llmProvider = null;
  let llmAnalysis = null;

  if (includeLLM && llmIsAvailable() && (copyleft.length > 0 || unknown.length > 0)) {
    llmProvider = getLLMProvider();
    const llmResult = await safeLLMCall({
      system: '你是资深开源法务专家，精通各种开源许可证的法律含义和合规要求。请以 JSON 格式输出分析结果。',
      messages: [{
        role: 'user',
        content: `请分析以下项目依赖的许可证合规风险：

## Copyleft 许可证（高风险） (${copyleft.length} 个)
${JSON.stringify(copyleft.slice(0, 20), null, 2)}

## 未知许可证（需评估） (${unknown.length} 个)
${JSON.stringify(unknown.slice(0, 20), null, 2)}

## 专有/商业许可证 (${proprietary.length} 个)
${JSON.stringify(proprietary, null, 2)}

请输出以下 JSON 格式的分析结果（不要输出 markdown 代码块）：
{
  "complianceRisk": "low|medium|high|critical",
  "riskSummary": "一句话合规风险总结",
  "copyleftAnalysis": [
    {"package": "包名", "license": "许可证", "risk": "风险分析", "mitigation": "缓解措施"}
  ],
  "unknownLicenses": [
    {"package": "包名", "recommendation": "建议动作"}
  ],
  "complianceRecommendations": ["合规建议1", "合规建议2"],
  "actionItems": [
    {"priority": "high|medium|low", "action": "具体动作", "package": "相关包名"}
  ]
}`
      }],
      temperature: 0.2,
      maxTokens: 3072,
    });

    if (llmResult) {
      llmEnhanced = true;
      try {
        const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
        llmAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
      } catch {
        llmAnalysis = { raw: llmResult.content };
      }
    }
  }

  const nextActions = [
    ...(copyleft.length > 0 ? [`Review ${copyleft.length} copyleft license(s) for compliance`] : []),
    ...(unknown.length > 0 ? [`Verify ${unknown.length} unknown license(s)`] : []),
    ...(failOnIssues.length > 0 ? [`${failOnIssues.length} package(s) violate failOn license rules`] : []),
    ...(compliant ? ['All licenses compliant'] : []),
  ];

  return {
    ok: compliant,
    data: {
      llmEnhanced,
      llmProvider,
      summary: compliant
        ? `All ${licenseResult.summary.total} licenses compliant`
        : `${highRiskCount} high-risk license(s) found (${copyleft.length} copyleft, ${failOnIssues.length} policy violations)`,
      total: licenseResult.summary.total,
      licenses: licenseResult.licenses,
      breakdown: {
        permissive: permissive.length,
        copyleft: copyleft.length,
        proprietary: proprietary.length,
        unknown: unknown.length,
      },
      permissiveLicenses: permissive.map(l => ({ package: l.package, license: l.license, version: l.version })),
      copyleftLicenses: copyleft,
      proprietaryLicenses: proprietary,
      unknownLicenses: unknown,
      failOnIssues,
      notInstalledCount: licenseResult.notInstalledCount,
      llmAnalysis,
    },
    warnings: [
      ...copyleft.map(l => `${l.package}: ${l.license} (copyleft risk)`),
      ...unknown.map(l => `${l.package}: unknown license`),
    ],
    nextActions,
  };
}

// ============================================================
// 命令 4: report - 生成完整审计报告
// ============================================================

async function report({ projectRoot, scope = 'all', format = 'json', includeLLM = true }) {
  const cwd = projectRoot || process.cwd();

  const pkg = await readLocalPackageJson(cwd);
  if (!pkg) {
    return {
      ok: false,
      error: `package.json not found at ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  // 并行执行所有扫描
  const [auditResult, outdatedResult, licenseResult, deprecatedResult] = await Promise.all([
    audit({ projectRoot: cwd, scope, includeLLM: false }),
    outdated({ projectRoot: cwd, scope, includeDeprecated: true, includeLLM: false }),
    licenses({ projectRoot: cwd, scope, includeLLM: false }),
    detectDeprecated(cwd, { scope }),
  ]);

  const allDeps = getAllDeps(pkg, scope);
  const depCount = Object.keys(allDeps).length;

  // 综合风险评分
  const vulnScore = (auditResult.data?.vulnerabilitySummary?.critical || 0) * 100
    + (auditResult.data?.vulnerabilitySummary?.high || 0) * 50
    + (auditResult.data?.vulnerabilitySummary?.moderate || 0) * 10
    + (auditResult.data?.vulnerabilitySummary?.low || 0) * 1;

  const licenseScore = (licenseResult.data?.breakdown?.copyleft || 0) * 50
    + (licenseResult.data?.breakdown?.unknown || 0) * 10;

  const outdatedScore = (outdatedResult.data?.outdatedSummary?.major || 0) * 20
    + (outdatedResult.data?.outdatedSummary?.minor || 0) * 5
    + (outdatedResult.data?.outdatedSummary?.patch || 0) * 1;

  const deprecatedScore = (deprecatedResult.count || 0) * 30;
  const knownBadScore = (auditResult.data?.knownBadIssues?.length || 0) * 100;

  const totalRiskScore = vulnScore + licenseScore + outdatedScore + deprecatedScore + knownBadScore;

  let riskLevel = 'low';
  if (totalRiskScore >= 200) riskLevel = 'critical';
  else if (totalRiskScore >= 100) riskLevel = 'high';
  else if (totalRiskScore >= 30) riskLevel = 'medium';

  // LLM 增强：生成审计建议和升级路线图
  let llmEnhanced = false;
  let llmProvider = null;
  let llmAnalysis = null;

  if (includeLLM && llmIsAvailable()) {
    llmProvider = getLLMProvider();
    const llmResult = await safeLLMCall({
      system: '你是资深安全架构师和依赖管理专家，能够生成全面的依赖审计报告和升级路线图。',
      messages: [{
        role: 'user',
        content: `请基于以下扫描结果生成完整的依赖审计建议和升级路线图：

## 项目概况
- 总依赖数: ${depCount}
- 综合风险评分: ${totalRiskScore} (${riskLevel})

## 漏洞扫描
- Critical: ${auditResult.data?.vulnerabilitySummary?.critical || 0}
- High: ${auditResult.data?.vulnerabilitySummary?.high || 0}
- Moderate: ${auditResult.data?.vulnerabilitySummary?.moderate || 0}
- Low: ${auditResult.data?.vulnerabilitySummary?.low || 0}

## License 合规
- Permissive: ${licenseResult.data?.breakdown?.permissive || 0}
- Copyleft: ${licenseResult.data?.breakdown?.copyleft || 0}
- Unknown: ${licenseResult.data?.breakdown?.unknown || 0}

## 过期依赖
- Major: ${outdatedResult.data?.outdatedSummary?.major || 0}
- Minor: ${outdatedResult.data?.outdatedSummary?.minor || 0}
- Patch: ${outdatedResult.data?.outdatedSummary?.patch || 0}

## 废弃包: ${deprecatedResult.count || 0} 个
## 已知风险包: ${auditResult.data?.knownBadIssues?.length || 0} 个

请用 markdown 格式生成：
1. 执行摘要（一段话总结整体健康度）
2. 关键发现（按优先级排序的前 5 个最重要问题）
3. 升级路线图（立即 / 短期 / 长期 三个阶段）
4. 风险最高的 5 个依赖及处理建议
5. 快速获胜（可以立即修复的低风险升级）`,
      }],
      temperature: 0.2,
      maxTokens: 4096,
    });

    if (llmResult) {
      llmEnhanced = true;
      llmAnalysis = { report: llmResult.content };
    }
  }

  // 生成 markdown 报告
  const markdownReport = generateMarkdownReport({
    projectName: pkg.name || 'Unknown',
    projectVersion: pkg.version || '0.0.0',
    depCount,
    riskLevel,
    totalRiskScore,
    auditResult: auditResult.data,
    outdatedResult: outdatedResult.data,
    licenseResult: licenseResult.data,
    deprecatedCount: deprecatedResult.count || 0,
    llmReport: llmAnalysis?.report || null,
  });

  return {
    ok: true,
    data: {
      llmEnhanced,
      llmProvider,
      summary: `Full audit complete: ${depCount} deps, risk level ${riskLevel} (score: ${totalRiskScore})`,
      projectName: pkg.name,
      projectVersion: pkg.version,
      totalDependencies: depCount,
      riskLevel,
      riskScore: totalRiskScore,
      scope,
      audit: auditResult.data,
      outdated: outdatedResult.data,
      licenses: licenseResult.data,
      deprecated: deprecatedResult.deprecated || [],
      deprecatedCount: deprecatedResult.count || 0,
      llmReport: llmAnalysis?.report || null,
      markdownReport,
      generatedAt: new Date().toISOString(),
    },
    warnings: [
      ...(auditResult.warnings || []),
      ...(outdatedResult.warnings || []),
      ...(licenseResult.warnings || []),
    ].slice(0, 50),
    nextActions: [
      ...(riskLevel === 'critical' || riskLevel === 'high'
        ? ['Address high/critical vulnerabilities immediately']
        : []),
      ...(deprecatedResult.count > 0 ? ['Replace deprecated packages'] : []),
      ...(licenseResult.data?.breakdown?.copyleft > 0 ? ['Review copyleft license compliance'] : []),
      'Schedule regular dependency audits',
    ],
  };
}

/**
 * 生成 Markdown 格式的审计报告
 */
function generateMarkdownReport({
  projectName, projectVersion, depCount, riskLevel, totalRiskScore,
  auditResult, outdatedResult, licenseResult, deprecatedCount, llmReport,
}) {
  const vulnSum = auditResult?.vulnerabilitySummary || { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  const licSum = licenseResult?.breakdown || { permissive: 0, copyleft: 0, proprietary: 0, unknown: 0 };
  const outSum = outdatedResult?.outdatedSummary || { major: 0, minor: 0, patch: 0, total: 0 };

  const riskEmoji = { low: '✅', medium: '⚠️', high: '🔴', critical: '💥' }[riskLevel] || '❓';

  let md = `# Dependency Audit Report\n\n`;
  md += `**Project:** ${projectName}@${projectVersion}  \n`;
  md += `**Generated:** ${new Date().toISOString()}  \n`;
  md += `**Total Dependencies:** ${depCount}  \n`;
  md += `**Risk Level:** ${riskEmoji} ${riskLevel.toUpperCase()} (score: ${totalRiskScore})  \n\n`;

  md += `---\n\n`;

  // 漏洞扫描
  md += `## 1. Vulnerability Scan\n\n`;
  const totalVulns = vulnSum.critical + vulnSum.high + vulnSum.moderate + vulnSum.low + vulnSum.info;
  md += `- **Total Vulnerabilities:** ${totalVulns}\n`;
  md += `- Critical: ${vulnSum.critical}\n`;
  md += `- High: ${vulnSum.high}\n`;
  md += `- Moderate: ${vulnSum.moderate}\n`;
  md += `- Low: ${vulnSum.low}\n`;
  md += `- Info: ${vulnSum.info}\n\n`;

  if (auditResult?.knownBadIssues?.length > 0) {
    md += `### Known Bad Packages\n\n`;
    auditResult.knownBadIssues.forEach(k => {
      md += `- **${k.package}**: ${k.reason}\n`;
      md += `  - Alternatives: ${k.alternatives?.join(', ') || 'N/A'}\n`;
    });
    md += `\n`;
  }

  // License 合规
  md += `## 2. License Compliance\n\n`;
  md += `- **Total:** ${licenseResult?.total || 0}\n`;
  md += `- Permissive: ${licSum.permissive}\n`;
  md += `- Copyleft: ${licSum.copyleft}\n`;
  md += `- Proprietary: ${licSum.proprietary}\n`;
  md += `- Unknown: ${licSum.unknown}\n\n`;

  if (licenseResult?.copyleftLicenses?.length > 0) {
    md += `### High Risk (Copyleft)\n\n`;
    licenseResult.copyleftLicenses.forEach(l => {
      md += `- **${l.package}@${l.version}**: ${l.license}\n`;
    });
    md += `\n`;
  }

  // 过期依赖
  md += `## 3. Outdated Dependencies\n\n`;
  md += `- **Total Outdated:** ${outSum.total || 0}\n`;
  md += `- Major: ${outSum.major || 0}\n`;
  md += `- Minor: ${outSum.minor || 0}\n`;
  md += `- Patch: ${outSum.patch || 0}\n\n`;

  if (outdatedResult?.outdated?.length > 0) {
    md += `| Package | Current | Latest | Type |\n`;
    md += `|---------|---------|--------|------|\n`;
    outdatedResult.outdated.slice(0, 20).forEach(o => {
      md += `| ${o.package} | ${o.current} | ${o.latest} | ${o.upgradeType} |\n`;
    });
    if (outdatedResult.outdated.length > 20) {
      md += `\n... and ${outdatedResult.outdated.length - 20} more\n`;
    }
    md += `\n`;
  }

  // 废弃包
  md += `## 4. Deprecated Packages\n\n`;
  md += `- **Deprecated:** ${deprecatedCount}\n\n`;

  // LLM 报告
  if (llmReport) {
    md += `---\n\n`;
    md += `## 5. AI Analysis & Recommendations\n\n`;
    md += llmReport + `\n\n`;
  }

  return md;
}

// ============================================================
// 命令 5: summary - 快速概览
// ============================================================

async function summary({ projectRoot, scope = 'all' }) {
  const cwd = projectRoot || process.cwd();

  const pkg = await readLocalPackageJson(cwd);
  if (!pkg) {
    return {
      ok: false,
      error: `package.json not found at ${cwd}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  const allDeps = getAllDeps(pkg, scope);
  const depCount = Object.keys(allDeps).length;

  // 快速并行扫描（不使用 LLM，保持快速）
  // AST 依赖使用分析也并行执行
  const [auditResult, outdatedResult, licenseResult, depUsage] = await Promise.all([
    runNpmAudit(cwd, { scope }),
    runNpmOutdated(cwd, { scope }),
    scanLicenses(cwd, { scope }),
    analyzeDependencyUsageAST(cwd, allDeps),
  ]);

  const vulnSummary = auditResult.available
    ? auditResult.summary
    : { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };

  const outSummary = outdatedResult.available
    ? outdatedResult.summary
    : { major: 0, minor: 0, patch: 0, total: 0 };

  const licSummary = licenseResult.available
    ? licenseResult.summary
    : { permissive: 0, copyleft: 0, proprietary: 0, unknown: 0, total: 0 };

  // 已知风险包
  const knownBadCount = Object.keys(allDeps).filter(n => KNOWN_BAD_PACKAGES[n]).length;

  // 健康度评分
  let score = 100;
  score -= vulnSummary.critical * 20;
  score -= vulnSummary.high * 10;
  score -= vulnSummary.moderate * 3;
  score -= licSummary.copyleft * 10;
  score -= outSummary.major * 5;
  score -= knownBadCount * 20;
  score = Math.max(0, Math.min(100, score));

  let health = 'excellent';
  if (score < 40) health = 'critical';
  else if (score < 60) health = 'poor';
  else if (score < 80) health = 'fair';
  else if (score < 90) health = 'good';

  const totalIssues = vulnSummary.critical + vulnSummary.high + licSummary.copyleft + knownBadCount;

  return {
    ok: true,
    data: {
      llmEnhanced: false,
      llmProvider: null,
      summary: `Health: ${health} (${score}/100) — ${depCount} deps, ${vulnSummary.critical + vulnSummary.high} vulns, ${licSummary.copyleft} copyleft, ${outSummary.total} outdated`,
      projectName: pkg.name,
      projectVersion: pkg.version,
      totalDependencies: depCount,
      healthScore: score,
      healthLevel: health,
      scope,
      vulnerabilities: {
        total: vulnSummary.critical + vulnSummary.high + vulnSummary.moderate + vulnSummary.low,
        ...vulnSummary,
        available: auditResult.available,
      },
      licenses: {
        ...licSummary,
        available: licenseResult.available,
      },
      outdated: {
        ...outSummary,
        available: outdatedResult.available,
      },
      knownBadPackages: knownBadCount,
      totalIssues,
      astEnhanced: depUsage.astEnhanced,
      dependencyUsage: depUsage.astEnhanced
        ? {
            sourcesScanned: depUsage.sourcesScanned,
            usedCount: depUsage.usedDeps.length,
            potentiallyUnused: depUsage.unusedDeps,
            unusedCount: depUsage.unusedDeps.length,
          }
        : undefined,
    },
    warnings: [
      ...(totalIssues > 0 ? [`${totalIssues} issue(s) require attention`] : []),
      ...(depUsage.astEnhanced && depUsage.unusedDeps.length > 0
        ? [`${depUsage.unusedDeps.length} potentially unused dependency(ies): ${depUsage.unusedDeps.slice(0, 5).join(', ')}${depUsage.unusedDeps.length > 5 ? '...' : ''}`]
        : []),
    ],
    nextActions: [
      score < 60 ? 'Immediate action required' :
        score < 80 ? 'Schedule dependency review' :
          'Dependencies look healthy',
      'Run full report for details: dependency-auditor.report',
      ...(depUsage.astEnhanced && depUsage.unusedDeps.length > 0
        ? [`Review potentially unused deps: ${depUsage.unusedDeps.slice(0, 3).join(', ')}`]
        : []),
    ],
  };
}

// ============================================================
// 命令 6: check - 加包前单包检查
// ============================================================

async function check({ add, projectRoot, failOnLicense = [] }) {
  if (!add) {
    return {
      ok: false,
      error: 'add parameter is required (e.g., --add="axios@1.7")',
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }
  return auditSinglePackage(add, failOnLicense);
}

// ============================================================
// 单包审计（保留并增强）
// ============================================================

async function auditSinglePackage(pkgSpec, failOnLicense = []) {
  const [name, version] = pkgSpec.split('@').filter(Boolean);
  const pkgName = name;
  const pkgVersion = version || 'latest';

  // 已知恶意包
  const knownBad = KNOWN_BAD_PACKAGES[pkgName];

  // 尝试获取包的真实信息（npm view）
  let realLicense = null;
  let realVersion = null;
  let deprecated = false;
  let npmInfoAvailable = false;

  try {
    const result = await runNpmCommand(
      `npm view ${pkgName}@${pkgVersion} license version deprecated --json`,
      process.cwd(),
      15_000
    );
    if (result.success && result.stdout) {
      const info = JSON.parse(result.stdout);
      realLicense = info.license || null;
      realVersion = info.version || null;
      deprecated = !!info.deprecated;
      npmInfoAvailable = true;
    }
  } catch {
    // npm view 失败，使用本地启发式
  }

  // License 判断
  const license = realLicense || 'unknown';
  const classification = classifyLicense(license);
  const blockedLicense = classification.level === 'high' || classification.level === 'critical'
    || (failOnLicense.length > 0 && failOnLicense.some(l => license.toUpperCase().includes(l.toUpperCase())));

  const blocked = blockedLicense || !!knownBad || deprecated;
  const verdict = blocked ? 'BLOCK' : 'ALLOW';

  // LLM 增强
  let llmEnhanced = false;
  let llmProvider = null;
  let llmAnalysis = null;
  let llmWarnings = [];
  let llmNextActions = [];

  if (llmIsAvailable()) {
    llmProvider = getLLMProvider();
    const llmResult = await safeLLMCall({
      system: '你是资深安全工程师和依赖管理专家，精通 npm 生态系统的安全性评估。请以 JSON 格式输出分析结果。',
      messages: [{
        role: 'user',
        content: `请对 npm 包 "${pkgName}" (版本: ${pkgVersion}) 进行安全和风险分析。

已知信息：
- License: ${license}
- 分类: ${classification.category} (风险: ${classification.level})
- 已废弃: ${deprecated ? '是' : '否'}
- 已知风险: ${knownBad ? knownBad.reason : '无记录'}
- 已知替代方案: ${knownBad ? knownBad.alternatives.join(', ') : '无记录'}
- 数据来源: ${npmInfoAvailable ? 'npm registry' : '本地启发式'}

请输出以下 JSON 格式的分析结果（不要输出 markdown 代码块）：
{
  "riskLevel": "low|medium|high|critical",
  "riskSummary": "一句话风险总结",
  "securityRisks": [
    {"title": "风险标题", "description": "详细描述", "severity": "low|medium|high|critical"}
  ],
  "maintenanceStatus": {
    "activity": "active|moderate|low|abandoned",
    "concerns": ["担忧点1", "担忧点2"]
  },
  "licenseAnalysis": {
    "compatibility": "safe|caution|risky",
    "notes": "许可证兼容性说明"
  },
  "alternatives": [
    {"name": "替代包名", "advantage": "优势说明", "license": "许可证"}
  ],
  "recommendations": ["建议1", "建议2"]
}`
      }],
      temperature: 0.2,
      maxTokens: 2560,
    });

    if (llmResult) {
      llmEnhanced = true;
      try {
        const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
        llmAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
        if (llmAnalysis.securityRisks) {
          llmWarnings = llmAnalysis.securityRisks.map(r => `${r.title}: ${r.description}`);
        }
        if (llmAnalysis.recommendations) {
          llmNextActions = llmAnalysis.recommendations;
        }
      } catch {
        llmAnalysis = { raw: llmResult.content };
      }
    }
  }

  const baseWarnings = [
    ...(knownBad ? [`Known security incident: ${knownBad.reason}`] : []),
    ...(deprecated ? ['Package is deprecated'] : []),
    ...(blockedLicense ? [`License risk: ${license} (${classification.category})`] : []),
  ];
  const allWarnings = [...baseWarnings, ...llmWarnings];

  const baseNextActions = blocked
    ? [
      ...(knownBad ? [`Consider: ${knownBad.alternatives.join(', ')}`] : []),
      ...(blockedLicense ? ['Review license compliance or find alternative'] : []),
      ...(deprecated ? ['Find actively maintained alternative'] : []),
    ]
    : [`Run \`npm install ${pkgSpec}\` (after review)`];
  const allNextActions = [...baseNextActions, ...llmNextActions.slice(0, 3)];

  return {
    ok: !blocked,
    data: {
      llmEnhanced,
      llmProvider,
      summary: blocked ? `${pkgSpec} BLOCKED` : `${pkgSpec} ALLOWED`,
      verdict,
      package: pkgName,
      version: realVersion || pkgVersion,
      license,
      licenseCategory: classification.category,
      licenseRisk: classification.level,
      deprecated,
      knownBad: knownBad || null,
      npmInfoAvailable,
      llmAnalysis,
    },
    warnings: allWarnings,
    nextActions: allNextActions,
  };
}

// ============================================================
// LLM 增强功能：advisory / migrate / explain
// ============================================================

/**
 * advisory - 针对特定依赖生成安全/维护建议
 */
async function advisory({ pkg, focus = 'all' }) {
  if (!pkg) {
    return { ok: false, error: 'Package name is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const [name, version] = pkg.split('@').filter(Boolean);
  const pkgName = name;
  const pkgVersion = version || 'latest';
  const knownBad = KNOWN_BAD_PACKAGES[pkgName];

  // 尝试获取真实包信息
  let npmInfo = null;
  try {
    const result = await runNpmCommand(
      `npm view ${pkgName}@${pkgVersion} license version description homepage repository.url --json`,
      process.cwd(),
      15_000
    );
    if (result.success && result.stdout) {
      npmInfo = JSON.parse(result.stdout);
    }
  } catch {
    // 忽略错误
  }

  if (!llmIsAvailable()) {
    return {
      ok: true,
      data: {
        llmEnhanced: false,
        llmProvider: null,
        package: pkgName,
        version: npmInfo?.version || pkgVersion,
        license: npmInfo?.license || 'unknown',
        advisory: knownBad
          ? `已知风险: ${knownBad.reason}。建议替代方案: ${knownBad.alternatives.join(', ')}`
          : '暂无已知风险记录。建议定期运行 npm audit 检查漏洞。',
        knownBad: knownBad || null,
        npmInfo: npmInfo || null,
      },
      warnings: [],
      nextActions: knownBad
        ? [`考虑替换为: ${knownBad.alternatives.join(', ')}`]
        : ['定期运行 npm audit'],
    };
  }

  const provider = getLLMProvider();
  const focusDesc = {
    all: '全面分析（安全、维护、许可证、供应链）',
    security: '仅安全风险',
    maintenance: '仅维护状态',
    license: '仅许可证合规',
    supplychain: '仅供应链风险',
  }[focus] || '全面分析';

  const llmResult = await safeLLMCall({
    system: '你是资深安全工程师和依赖管理专家，提供专业、可执行的依赖管理建议。',
    messages: [{
      role: 'user',
      content: `请针对 npm 包 "${pkgName}" (版本: ${pkgVersion}) 提供专业的安全和维护建议。

重点关注: ${focusDesc}

已知信息:
- License: ${npmInfo?.license || '未知'}
- Description: ${npmInfo?.description || '未知'}
- Homepage: ${npmInfo?.homepage || '未知'}
- 已知风险记录: ${knownBad ? knownBad.reason : '无'}
- 已知替代方案: ${knownBad ? knownBad.alternatives.join(', ') : '无'}

请提供以下内容（使用 markdown 格式，结构清晰）：
1. 风险概览（一句话总结）
2. 安全评估 - 已知漏洞、历史安全事件、潜在风险
3. 维护状态评估 - 活跃度、更新频率、社区健康度
4. 许可证合规性分析
5. 供应链风险评估
6. 具体建议（按优先级排序）
7. 推荐的替代方案（如果适用）`,
    }],
    temperature: 0.3,
    maxTokens: 2560,
  });

  if (llmResult) {
    return {
      ok: true,
      data: {
        llmEnhanced: true,
        llmProvider: provider,
        package: pkgName,
        version: npmInfo?.version || pkgVersion,
        license: npmInfo?.license || 'unknown',
        advisory: llmResult.content,
        knownBad: knownBad || null,
        npmInfo: npmInfo || null,
        provider,
      },
      warnings: [],
      nextActions: ['参考上述建议进行依赖管理'],
    };
  }

  return {
    ok: true,
    data: {
      llmEnhanced: false,
      llmProvider: null,
      package: pkgName,
      version: npmInfo?.version || pkgVersion,
      license: npmInfo?.license || 'unknown',
      advisory: knownBad
        ? `已知风险: ${knownBad.reason}。建议替代方案: ${knownBad.alternatives.join(', ')}`
        : '暂无已知风险记录。建议定期运行 npm audit 检查漏洞。',
      knownBad: knownBad || null,
      npmInfo: npmInfo || null,
    },
    warnings: [],
    nextActions: knownBad
      ? [`考虑替换为: ${knownBad.alternatives.join(', ')}`]
      : ['定期运行 npm audit'],
  };
}

/**
 * migrate - 生成依赖升级/迁移指南
 */
async function migrate({ fromPkg, toPkg = '' }) {
  if (!fromPkg) {
    return { ok: false, error: 'fromPkg is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const [fromName, fromVersion] = fromPkg.split('@').filter(Boolean);

  if (!llmIsAvailable()) {
    return {
      ok: true,
      data: {
        llmEnhanced: false,
        llmProvider: null,
        from: fromName,
        fromVersion: fromVersion || 'latest',
        to: toPkg || '(未指定)',
        guide: toPkg
          ? `请参考 ${toPkg} 官方文档进行迁移。`
          : '请指定目标依赖包名以获取迁移指南。',
      },
      warnings: [],
      nextActions: ['查阅目标包的官方迁移文档'],
    };
  }

  const provider = getLLMProvider();
  const llmResult = await safeLLMCall({
    system: '你是资深前端架构师和依赖迁移专家，熟悉 npm 生态中各种包的迁移路径和最佳实践。',
    messages: [{
      role: 'user',
      content: `请生成从 "${fromName}"${fromVersion ? ` (版本 ${fromVersion})` : ''} 迁移到 ${toPkg ? `"${toPkg}"` : '更现代的替代方案'} 的详细迁移指南。

请提供以下内容（使用 markdown 格式）：
1. 迁移概述 - 为什么迁移、收益和风险
2. API 差异对比 - 主要 API 的变化对照表
3. 分步迁移指南 - 详细的迁移步骤
4. 代码示例 - 迁移前后的代码对比（至少 3 个常见用例）
5. 常见问题和注意事项
6. 回滚方案
7. 相关资源链接`,
    }],
    temperature: 0.3,
    maxTokens: 3584,
  });

  if (llmResult) {
    return {
      ok: true,
      data: {
        llmEnhanced: true,
        llmProvider: provider,
        from: fromName,
        fromVersion: fromVersion || 'latest',
        to: toPkg || '(LLM 推荐方案)',
        guide: llmResult.content,
        provider,
      },
      warnings: [],
      nextActions: ['按照迁移指南逐步执行', '充分测试后再部署'],
    };
  }

  return {
    ok: true,
    data: {
      llmEnhanced: false,
      llmProvider: null,
      from: fromName,
      fromVersion: fromVersion || 'latest',
      to: toPkg || '(未指定)',
      guide: toPkg
        ? `请参考 ${toPkg} 官方文档进行迁移。`
        : '请指定目标依赖包名以获取迁移指南。',
    },
    warnings: [],
    nextActions: ['查阅目标包的官方迁移文档'],
  };
}

/**
 * explain - 解释某个依赖的作用和风险
 */
async function explain({ pkg }) {
  if (!pkg) {
    return { ok: false, error: 'Package name is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const [name, version] = pkg.split('@').filter(Boolean);
  const pkgName = name;
  const pkgVersion = version || 'latest';
  const knownBad = KNOWN_BAD_PACKAGES[pkgName];

  // 尝试获取真实包信息
  let npmInfo = null;
  try {
    const result = await runNpmCommand(
      `npm view ${pkgName}@${pkgVersion} license version description homepage --json`,
      process.cwd(),
      15_000
    );
    if (result.success && result.stdout) {
      npmInfo = JSON.parse(result.stdout);
    }
  } catch {
    // 忽略错误
  }

  if (!llmIsAvailable()) {
    return {
      ok: true,
      data: {
        llmEnhanced: false,
        llmProvider: null,
        package: pkgName,
        version: npmInfo?.version || pkgVersion,
        license: npmInfo?.license || 'unknown',
        description: npmInfo?.description || '',
        explanation: knownBad
          ? `${pkgName} 是一个 npm 包。已知风险: ${knownBad.reason}。建议使用替代方案: ${knownBad.alternatives.join(', ')}`
          : `${pkgName} 是一个 npm 包。${npmInfo?.description || '暂无详细信息'}，请查阅 npm 官网或 GitHub 仓库了解更多。`,
        knownBad: knownBad || null,
        npmInfo: npmInfo || null,
      },
      warnings: [],
      nextActions: [`访问 https://www.npmjs.com/package/${pkgName} 了解详情`],
    };
  }

  const provider = getLLMProvider();
  const llmResult = await safeLLMCall({
    system: '你是资深 npm 生态专家，能够清晰解释各种依赖包的用途、工作原理和潜在风险。',
    messages: [{
      role: 'user',
      content: `请用通俗易懂的方式解释 npm 包 "${pkgName}"${version ? ` (版本 ${version})` : ''}。

包基本信息:
- Description: ${npmInfo?.description || '未知'}
- License: ${npmInfo?.license || '未知'}
- Homepage: ${npmInfo?.homepage || '未知'}

请涵盖以下内容（使用 markdown 格式）：
1. 这个包是做什么的？（一句话总结 + 详细说明）
2. 典型使用场景和常见用法
3. 它的工作原理（核心实现思路）
4. 为什么开发者会选择它？（相比同类方案的优势）
5. 潜在风险和注意事项（安全、性能、维护等方面）
6. 依赖关系概览（它依赖什么、谁依赖它）
7. 常见的替代方案对比

已知风险提示: ${knownBad ? knownBad.reason : '暂无记录'}`,
    }],
    temperature: 0.3,
    maxTokens: 2560,
  });

  if (llmResult) {
    return {
      ok: true,
      data: {
        llmEnhanced: true,
        llmProvider: provider,
        package: pkgName,
        version: npmInfo?.version || pkgVersion,
        license: npmInfo?.license || 'unknown',
        description: npmInfo?.description || '',
        explanation: llmResult.content,
        knownBad: knownBad || null,
        npmInfo: npmInfo || null,
        provider,
      },
      warnings: [],
      nextActions: ['根据上述评估决定是否使用该依赖'],
    };
  }

  return {
    ok: true,
    data: {
      llmEnhanced: false,
      llmProvider: null,
      package: pkgName,
      version: npmInfo?.version || pkgVersion,
      license: npmInfo?.license || 'unknown',
      description: npmInfo?.description || '',
      explanation: knownBad
        ? `${pkgName} 是一个 npm 包。已知风险: ${knownBad.reason}。建议使用替代方案: ${knownBad.alternatives.join(', ')}`
        : `${pkgName} 是一个 npm 包。${npmInfo?.description || '暂无详细信息'}，请查阅 npm 官网或 GitHub 仓库了解更多。`,
      knownBad: knownBad || null,
      npmInfo: npmInfo || null,
    },
    warnings: [],
    nextActions: [`访问 https://www.npmjs.com/package/${pkgName} 了解详情`],
  };
}

// ============================================================
// 黑白名单管理：blocklist / allowlist
// ============================================================

const BLOCKLIST_FILE = '.dependency-blocklist.json';
const ALLOWLIST_FILE = '.dependency-allowlist.json';

async function loadList(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { packages: [], rules: [] };
  }
}

async function saveList(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function blocklist({ action, package: pkgName, version, reason, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const listPath = path.join(cwd, BLOCKLIST_FILE);
  const list = await loadList(listPath);

  if (!action || action === 'list') {
    return {
      ok: true,
      data: {
        summary: `${list.packages.length} blocked packages`,
        packages: list.packages,
        file: BLOCKLIST_FILE,
        llmEnhanced: false,
        llmProvider: null,
      },
      warnings: [],
      nextActions: list.packages.length === 0 ? ['Add packages with: blocklist --action=add --package=name'] : [],
    };
  }

  if (action === 'add') {
    if (!pkgName) {
      return { ok: false, error: 'package name is required for add action', data: null, warnings: [], nextActions: [] };
    }
    const existing = list.packages.find(p => p.name === pkgName);
    if (existing) {
      existing.version = version || existing.version;
      existing.reason = reason || existing.reason;
      existing.updatedAt = new Date().toISOString();
    } else {
      list.packages.push({ name: pkgName, version: version || '*', reason: reason || 'manual block', addedAt: new Date().toISOString() });
    }
    await saveList(listPath, list);
    return {
      ok: true,
      data: { summary: `Added ${pkgName} to blocklist`, package: pkgName, totalBlocked: list.packages.length, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [`Blocklist saved to ${BLOCKLIST_FILE}`],
    };
  }

  if (action === 'remove') {
    if (!pkgName) {
      return { ok: false, error: 'package name is required for remove action', data: null, warnings: [], nextActions: [] };
    }
    list.packages = list.packages.filter(p => p.name !== pkgName);
    await saveList(listPath, list);
    return {
      ok: true,
      data: { summary: `Removed ${pkgName} from blocklist`, totalBlocked: list.packages.length, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  if (action === 'check') {
    if (!pkgName) {
      return { ok: false, error: 'package name is required for check action', data: null, warnings: [], nextActions: [] };
    }
    const blocked = list.packages.find(p => p.name === pkgName);
    return {
      ok: !blocked,
      data: { summary: blocked ? `${pkgName} is blocked` : `${pkgName} is not in blocklist`, blocked: !!blocked, reason: blocked?.reason || null, llmEnhanced: false, llmProvider: null },
      warnings: blocked ? [`${pkgName} is blocked: ${blocked.reason}`] : [],
      nextActions: [],
    };
  }

  return { ok: false, error: `Unknown action: ${action}. Use: list, add, remove, check`, data: null, warnings: [], nextActions: [] };
}

async function allowlist({ action, package: pkgName, license, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const listPath = path.join(cwd, ALLOWLIST_FILE);
  const list = await loadList(listPath);

  if (!action || action === 'list') {
    return {
      ok: true,
      data: {
        summary: `${list.packages.length} allowed packages`,
        packages: list.packages,
        file: ALLOWLIST_FILE,
        llmEnhanced: false,
        llmProvider: null,
      },
      warnings: [],
      nextActions: list.packages.length === 0 ? ['Add packages with: allowlist --action=add --package=name'] : [],
    };
  }

  if (action === 'add') {
    if (!pkgName) {
      return { ok: false, error: 'package name is required for add action', data: null, warnings: [], nextActions: [] };
    }
    const existing = list.packages.find(p => p.name === pkgName);
    if (!existing) {
      list.packages.push({ name: pkgName, license: license || null, addedAt: new Date().toISOString() });
      await saveList(listPath, list);
    }
    return {
      ok: true,
      data: { summary: `Added ${pkgName} to allowlist`, totalAllowed: list.packages.length, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [`Allowlist saved to ${ALLOWLIST_FILE}`],
    };
  }

  if (action === 'remove') {
    list.packages = list.packages.filter(p => p.name !== pkgName);
    await saveList(listPath, list);
    return {
      ok: true,
      data: { summary: `Removed ${pkgName} from allowlist`, totalAllowed: list.packages.length, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  if (action === 'check') {
    if (!pkgName) {
      return { ok: false, error: 'package name is required for check action', data: null, warnings: [], nextActions: [] };
    }
    const allowed = list.packages.find(p => p.name === pkgName);
    return {
      ok: true,
      data: { summary: allowed ? `${pkgName} is allowlisted` : `${pkgName} is not in allowlist`, allowed: !!allowed, llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  return { ok: false, error: `Unknown action: ${action}. Use: list, add, remove, check`, data: null, warnings: [], nextActions: [] };
}

// ============================================================
// 导出模块
// ============================================================

module.exports = {
  // 核心命令
  audit,
  outdated,
  licenses,
  report,
  summary,
  check,

  // 黑白名单管理
  blocklist,
  allowlist,

  // LLM 增强命令
  advisory,
  migrate,
  explain,

  // 单包审计（内部）
  auditSinglePackage,

  // === 别名 (aliases) ===
  // audit 别名
  depAudit: audit,
  dep_audit: audit,
  auditDependencies: audit,
  audit_dependencies: audit,

  // outdated 别名
  depOutdated: outdated,
  dep_outdated: outdated,
  checkOutdated: outdated,
  check_outdated: outdated,

  // licenses 别名
  depLicenses: licenses,
  dep_licenses: licenses,
  checkLicenses: licenses,
  check_licenses: licenses,
  licenseCheck: licenses,
  license_check: licenses,

  // report 别名
  depReport: report,
  dep_report: report,
  auditReport: report,
  audit_report: report,
  fullReport: report,
  full_report: report,

  // summary 别名
  depSummary: summary,
  dep_summary: summary,
  quickSummary: summary,
  quick_summary: summary,
  overview: summary,

  // check 别名
  depCheck: check,
  dep_check: check,
  checkPackage: check,
  check_package: check,
  preInstallCheck: check,
  pre_install_check: check,
};
