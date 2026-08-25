/**
 * openspec-workflow Skill - 基础实现版
 *
 * 实现 OpenSpec 提案驱动变更管理的完整流程：
 *   propose → delta → tasks → apply → archive
 *
 * 基础版本定位：
 *   - 所有产物都是"模板 + 启发式填充"级别
 *   - 不依赖 LLM，纯文件操作 + 启发式推断
 *   - 确保 Phase 2 流程可以完整跑通
 *
 * 对应 MCP Tools:
 *   - openspec_propose
 *   - openspec_delta
 *   - openspec_tasks
 *   - openspec_apply
 *   - openspec_archive
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// ============================================================
// 工具函数
// ============================================================

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function timestamp() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function gitAvailable() {
  try {
    await execAsync('git --version');
    return true;
  } catch {
    return false;
  }
}

async function gitIsRepo(cwd) {
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
    return true;
  } catch {
    return false;
  }
}

async function getCurrentBranch(cwd) {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * 查找项目中的 spec.md 文件
 * 优先顺序：specs/spec.md → spec.md → docs/spec.md
 */
async function findSpecFile(cwd) {
  const candidates = [
    path.join(cwd, 'specs', 'spec.md'),
    path.join(cwd, 'spec.md'),
    path.join(cwd, 'docs', 'spec.md'),
  ];
  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }
  return null;
}

/**
 * 启发式：从 proposal.md 中提取关键词，用于生成 delta 和 tasks
 */
function extractKeywords(proposalContent) {
  const keywords = [];
  // 提取中文/英文的"新增/修改/删除"后面的名词
  const patterns = [
    /新增\s*[「""]?([^「""\n，。、]{2,20})/g,
    /添加\s*[「""]?([^「""\n，。、]{2,20})/g,
    /修改\s*[「""]?([^「""\n，。、]{2,20})/g,
    /删除\s*[「""]?([^「""\n，。、]{2,20})/g,
    /add\s+(\w+)/gi,
    /create\s+(\w+)/gi,
    /update\s+(\w+)/gi,
    /delete\s+(\w+)/gi,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(proposalContent)) !== null) {
      const kw = m[1].trim();
      if (kw.length >= 2 && !keywords.includes(kw)) {
        keywords.push(kw);
      }
    }
  }
  return keywords.slice(0, 5); // 最多取 5 个
}

// ============================================================
// AST 增强分析（基于 recast + @babel/parser）
// ============================================================

/**
 * 扫描项目中的 JS/TS 源文件
 */
async function scanSourceFiles(cwd) {
  const results = [];
  const srcDirs = ['src', 'lib', 'app', 'server', 'client'];

  async function walkDir(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          await walkDir(fullPath);
        } else if (/\.(js|ts|jsx|tsx)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  for (const dir of srcDirs) {
    const fullDir = path.join(cwd, dir);
    try {
      const stat = await fs.stat(fullDir);
      if (stat.isDirectory()) {
        await walkDir(fullDir);
      }
    } catch { /* dir doesn't exist */ }
  }

  return results;
}

/**
 * 使用 AST 分析变更对代码库的影响
 * - extractFunctions(): 分析变更涉及的函数
 * - extractExports(): 检测变更对导出 API 的影响
 * - extractImports(): 分析依赖变更影响
 * 
 * 解析成功时返回增强数据，失败时返回 null（静默回退）
 */
async function analyzeChangeImpactWithAST(keywords, projectRoot) {
  const cwd = projectRoot || process.cwd();

  try {
    const sourceFiles = await scanSourceFiles(cwd);
    if (sourceFiles.length === 0) return null;

    const kwLower = (keywords || []).map(k => k.toLowerCase());
    const affectedFiles = [];
    let allAffectedFunctions = [];
    let allAffectedExports = [];
    let allAffectedImports = [];

    for (const filePath of sourceFiles) {
      try {
        const code = await fs.readFile(filePath, 'utf-8');
        const relPath = path.relative(cwd, filePath);

        // 快速过滤：文件名或代码中是否有关键词
        const fileLower = relPath.toLowerCase();
        const codeLower = code.toLowerCase();
        const hasKeyword = kwLower.some(kw =>
          fileLower.includes(kw) || codeLower.includes(kw)
        );
        if (!hasKeyword && kwLower.length > 0) continue;

        const fileImpact = { file: relPath };

        // 1. 提取函数（分析变更涉及的函数）
        const functions = ast.extractFunctions(code);
        if (functions.length > 0) {
          // 找出与关键词相关的函数
          const relevantFns = functions.filter(fn =>
            kwLower.some(kw => fn.name.toLowerCase().includes(kw))
          );
          if (relevantFns.length > 0) {
            fileImpact.functions = relevantFns;
            allAffectedFunctions = allAffectedFunctions.concat(
              relevantFns.map(f => ({ file: relPath, ...f }))
            );
          }
          fileImpact.totalFunctions = functions.length;
        }

        // 2. 提取导出（检测变更对导出 API 的影响）
        const exports = ast.extractExports(code);
        if (exports.length > 0) {
          const relevantExports = exports.filter(exp =>
            kwLower.some(kw => exp.name.toLowerCase().includes(kw))
          );
          if (relevantExports.length > 0) {
            fileImpact.exports = relevantExports;
            allAffectedExports = allAffectedExports.concat(
              relevantExports.map(e => ({ file: relPath, ...e }))
            );
          }
          fileImpact.totalExports = exports.length;
        }

        // 3. 提取导入（分析依赖变更影响）
        const imports = ast.extractImports(code);
        if (imports.length > 0) {
          const relevantImports = imports.filter(imp =>
            kwLower.some(kw =>
              imp.source.toLowerCase().includes(kw) ||
              imp.specifiers.some(s => s.toLowerCase().includes(kw)) ||
              (imp.default && imp.default.toLowerCase().includes(kw))
            )
          );
          if (relevantImports.length > 0) {
            fileImpact.imports = relevantImports;
            allAffectedImports = allAffectedImports.concat(
              relevantImports.map(i => ({ file: relPath, ...i }))
            );
          }
          fileImpact.totalImports = imports.length;
        }

        // 只有当文件有相关分析结果时才加入
        if (fileImpact.functions || fileImpact.exports || fileImpact.imports) {
          affectedFiles.push(fileImpact);
        }
      } catch {
        // 单个文件解析失败，跳过
      }
    }

    if (affectedFiles.length === 0) return null;

    return {
      astEnhanced: true,
      filesScanned: sourceFiles.length,
      affectedFiles: affectedFiles.length,
      fileImpacts: affectedFiles.slice(0, 20), // 最多 20 个文件
      affectedFunctions: allAffectedFunctions.slice(0, 30), // 最多 30 个函数
      affectedExports: allAffectedExports,
      affectedImports: allAffectedImports.slice(0, 20),
      impactSummary: {
        functionCount: allAffectedFunctions.length,
        exportCount: allAffectedExports.length,
        importCount: allAffectedImports.length,
        // 导出 API 变更意味着 breaking change 风险
        breakingChangeRisk: allAffectedExports.length > 0,
      },
    };
  } catch {
    // AST 解析失败，静默回退到启发式路径
    return null;
  }
}

// ============================================================
// 1. propose - 发起变更（已有，微调）
// ============================================================

async function propose({ changeName, intent, baseFeature, slug: slugOverride, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!changeName || !intent) {
    return { ok: false, error: 'changeName and intent are required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const hasGit = await gitAvailable();
  const isRepo = hasGit && (await gitIsRepo(cwd));

  const slug = slugOverride || slugify(changeName);
  const branchName = 'openspec/changes/' + slug;

  // 1. 创建分支（如果有 git）
  if (isRepo) {
    try {
      await execAsync('git checkout -b ' + branchName, { cwd });
    } catch (err) {
      // 分支已存在则切换过去
      try {
        await execAsync('git checkout ' + branchName, { cwd });
      } catch (e2) {
        return { ok: false, error: 'Failed to create/checkout branch: ' + e2.message, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
      }
    }
  }

  // 2. 创建变更目录 + PROPOSAL.md
  const changesDir = path.join(cwd, 'openspec', 'changes', slug);
  await ensureDir(changesDir);

  const proposalPath = path.join(changesDir, 'proposal.md');
  const proposalContent = generateProposal(changeName, intent, baseFeature);
  await fs.writeFile(proposalPath, proposalContent, 'utf-8');

  // 3. 初始化其他文件占位
  await fs.writeFile(path.join(changesDir, 'spec-delta.md'), '# SPEC Delta: ' + changeName + '\n\n_待生成，运行 `openspec delta` 生成_\n', 'utf-8');
  await fs.writeFile(path.join(changesDir, 'tasks.md'), '# TASKS: ' + changeName + '\n\n_待生成，运行 `openspec tasks` 生成_\n', 'utf-8');
  await fs.writeFile(path.join(changesDir, 'changelog.md'), '# Changelog: ' + changeName + '\n\n## ' + timestamp() + '\n\n- Initial proposal created\n', 'utf-8');

  const warnings = [];
  if (!isRepo) {
    warnings.push('Not a git repository — branch creation skipped. Changes will be made directly to files.');
  }

  return {
    ok: true,
    data: {
      summary: '✅ Change proposal created',
      slug,
      branch: branchName,
      changeName,
      status: 'PROPOSAL',
      files: [
        proposalPath,
        path.join(changesDir, 'spec-delta.md'),
        path.join(changesDir, 'tasks.md'),
        path.join(changesDir, 'changelog.md'),
      ],
      baseFeature: baseFeature || 'main',
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings,
    nextActions: [
      'Edit proposal.md to fill in details',
      'Run `openspec delta` to generate SPEC delta',
      'Run `openspec tasks` to generate TASKS.md',
    ],
  };
}

function generateProposal(changeName, intent, baseFeature) {
  return `# Change Proposal: ${changeName}

> 由 project-orchestrator-bundle / openspec-workflow 自动生成
> 生成时间: ${timestamp()}
> 基于 Feature: ${baseFeature || 'main'}
> **Status**: Draft

## Why

${intent}

## What Changes

[待补充] 本变更将：

- 新增 / 修改 / 删除 [待人工补充]

## Impact

| 维度 | 影响 |
|---|---|
| 受影响的 Spec 章节 | [待识别] |
| 受影响的 API endpoints | [待识别] |
| 受影响的 UI 页面 | [待识别] |
| 数据库迁移 | [是/否] |
| Breaking Change | [是/否] |
| 回滚方案 | git revert commit |

## Success Criteria

- [ ] SC-1：[可度量指标]
- [ ] SC-2：[可度量指标]

## Workflow

- [x] 1. PROPOSAL.md（本文件）
- [ ] 2. SPEC delta（与 baseline spec 做 diff）
- [ ] 3. TASKS.md（拆解为可执行任务）
- [ ] 4. 执行 + 测试
- [ ] 5. ARCHIVE.md（归档 + 决策记录）

---

Generated by project-orchestrator-bundle / openspec-workflow
`;
}

// ============================================================
// 2. delta - 生成 SPEC delta（新增）
// ============================================================

async function delta({ slug, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!slug) {
    return { ok: false, error: 'slug is required (e.g. "add-timesheet")', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const changesDir = path.join(cwd, 'openspec', 'changes', slug);
  const proposalPath = path.join(changesDir, 'proposal.md');

  if (!(await fileExists(proposalPath))) {
    return { ok: false, error: `Proposal not found at ${proposalPath}. Run \`openspec propose\` first.`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const proposalContent = await fs.readFile(proposalPath, 'utf-8');
  const keywords = extractKeywords(proposalContent);
  const specFile = await findSpecFile(cwd);

  // AST 增强：分析变更对现有代码库的影响
  let astAnalysis = null;
  let astEnhanced = false;
  try {
    const astResult = await analyzeChangeImpactWithAST(keywords, projectRoot);
    if (astResult) {
      astAnalysis = astResult;
      astEnhanced = true;
    }
  } catch {
    // AST 分析失败，静默回退，不影响现有功能
  }

  // LLM 增强：智能分析 proposal 生成更准确的 SPEC delta
  let llmEnhanced = false;
  let llmAnalysis = null;
  if (llm.isAvailable()) {
    try {
      const result = await llm.callLLM({
        system: `你是一位资深的软件需求分析师，擅长从变更提案中提取结构化的规格变更信息。

任务：分析用户提供的 Change Proposal，输出结构化的 SPEC delta 分析结果。

输出要求（严格 JSON 格式，不要 markdown 代码块）：
{
  "added": [
    {"id": "A001", "title": "需求标题", "description": "详细描述", "scenarios": ["场景1描述", "场景2描述"]}
  ],
  "modified": [
    {"id": "M001", "title": "需求标题", "originalContent": "原内容摘要", "newContent": "新内容摘要", "reason": "修改原因"}
  ],
  "removed": [
    {"id": "R001", "title": "需求标题", "reason": "删除原因，被什么替代"}
  ],
  "keywords": ["核心关键词1", "核心关键词2"],
  "affectedModules": ["受影响模块1", "受影响模块2"],
  "impactScope": {
    "apiEndpoints": ["受影响的 API 列表"],
    "uiPages": ["受影响的 UI 页面"],
    "databaseMigration": true/false,
    "breakingChange": true/false,
    "severity": "low|medium|high|critical"
  }
}

要求：
1. 仔细阅读 proposal 内容，准确识别新增、修改、删除的需求
2. 如果某类变更为空，返回空数组 []
3. keywords 提取 3-8 个最核心的需求关键词
4. affectedModules 识别受影响的系统模块（如 auth、user、order、payment 等）
5. impactScope 评估变更影响范围
6. 只输出 JSON，不要任何额外解释或 markdown 标记`,
        messages: [{ role: 'user', content: `请分析以下 Change Proposal 并输出 SPEC delta 分析结果：

## Change Proposal
${proposalContent}

${specFile ? `## Baseline Spec 文件位置：${specFile}` : '## 注意：当前项目没有找到现有的 spec.md（全新项目）'}

请输出 JSON 格式的分析结果。` }],
        temperature: 0.3,
        maxTokens: 4096,
      });
      if (result.ok) {
        try {
          // 尝试解析 JSON，兼容可能的 markdown 包裹
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          llmAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
          llmEnhanced = true;
        } catch {
          // JSON 解析失败，静默回退到启发式
          llmAnalysis = null;
        }
      }
    } catch {
      // 静默回退到启发式逻辑
    }
  }

  // 生成 SPEC delta
  const deltaPath = path.join(changesDir, 'spec-delta.md');
  const deltaContent = llmEnhanced && llmAnalysis
    ? generateLLMSpecDelta(slug, proposalContent, llmAnalysis, specFile)
    : generateSpecDelta(slug, proposalContent, keywords, specFile);
  await fs.writeFile(deltaPath, deltaContent, 'utf-8');

  // 更新 proposal.md 中的 workflow 状态
  let updatedProposal = proposalContent.replace(
    '- [ ] 2. SPEC delta',
    '- [x] 2. SPEC delta'
  );
  await fs.writeFile(proposalPath, updatedProposal, 'utf-8');

  const warnings = [];
  if (keywords.length === 0) {
    warnings.push('Could not extract keywords from proposal. SPEC delta is template-only — please fill in manually.');
  }
  if (!specFile) {
    warnings.push('No existing spec.md found. SPEC delta is generated from proposal keywords only.');
  }
  // AST 分析警告
  if (astEnhanced && astAnalysis?.impactSummary?.breakingChangeRisk) {
    warnings.push(`Breaking change risk detected: ${astAnalysis.impactSummary.exportCount} exported API(s) may be affected`);
  }

  const summaryParts = ['SPEC delta generated'];
  if (astEnhanced) summaryParts.push('AST enhanced');
  if (llmEnhanced) summaryParts.push('LLM enhanced');

  return {
    ok: true,
    data: {
      summary: summaryParts.join(' | '),
      slug,
      status: 'SPEC_DELTA',
      keywordsExtracted: llmEnhanced && llmAnalysis ? llmAnalysis.keywords || [] : keywords,
      astAnalysis,
      astEnhanced,
      llmEnhanced,
      llmProvider: llmEnhanced ? llm.getProviderName() : null,
      affectedModules: llmAnalysis?.affectedModules || [],
      impactScope: llmAnalysis?.impactScope || null,
      codeImpact: astAnalysis ? {
        filesScanned: astAnalysis.filesScanned,
        affectedFiles: astAnalysis.affectedFiles,
        affectedFunctions: astAnalysis.impactSummary.functionCount,
        affectedExports: astAnalysis.impactSummary.exportCount,
        affectedImports: astAnalysis.impactSummary.importCount,
        breakingChangeRisk: astAnalysis.impactSummary.breakingChangeRisk,
      } : null,
      files: [deltaPath],
    },
    warnings,
    nextActions: [
      'Review and edit spec-delta.md',
      'Run `openspec tasks` to generate TASKS.md',
    ],
  };
}

function generateSpecDelta(slug, proposalContent, keywords, specFile) {
  const kwSection = keywords.length > 0
    ? keywords.map(k => `### Requirement: ${k}\n系统 SHALL 提供 ${k} 相关功能。\n\n#### Scenario: 基础场景\n- WHEN 用户操作 ${k}\n- THEN 系统 SHALL 正确响应\n`).join('\n')
    : `### Requirement: [功能名称]\n系统 SHALL [功能描述]。\n\n#### Scenario: [场景名]\n- WHEN [触发条件]\n- THEN 系统 SHALL [预期结果]\n`;

  const baselineInfo = specFile
    ? `\n> Baseline: ${specFile}\n`
    : `\n> Baseline: 未找到现有 spec.md（全新项目）\n`;

  return `# SPEC Delta: ${slug}
${baselineInfo}
> Generated: ${timestamp()}
> Status: Draft

## ADDED Requirements

${kwSection}

## MODIFIED Requirements

### Requirement: [修改的需求名称]（修改）

**原内容**:
> [原始需求描述]

**新内容**:
> [修改后的需求描述]

**修改原因**:
> [为什么要改]

## REMOVED Requirements

### Requirement: [删除的需求名称]

**删除原因**:
> [为什么删除，被什么替代]

---

Generated by project-orchestrator-bundle / openspec-workflow
`;
}

/**
 * LLM 增强版：基于 LLM 分析结果生成高质量的 SPEC delta
 */
function generateLLMSpecDelta(slug, proposalContent, analysis, specFile) {
  const { added = [], modified = [], removed = [], keywords = [], affectedModules = [], impactScope = {} } = analysis;

  const formatAdded = (items) => {
    if (items.length === 0) return `_（本次变更无新增需求）_\n`;
    return items.map(item => {
      const scenarios = (item.scenarios || []).map((s, i) =>
        `#### Scenario: ${s.slice(0, 50)}\n- WHEN [触发条件]\n- THEN ${s}\n`
      ).join('\n');
      return `### Requirement: ${item.title} (${item.id || 'A001'})

${item.description || ''}

${scenarios || '#### Scenario: 基础场景\n- WHEN 用户操作\n- THEN 系统正确响应\n'}`;
    }).join('\n');
  };

  const formatModified = (items) => {
    if (items.length === 0) return `_（本次变更无修改需求）_\n`;
    return items.map(item => `### Requirement: ${item.title} (${item.id || 'M001'})

**原内容**:
> ${item.originalContent || '[原始需求描述]'}

**新内容**:
> ${item.newContent || '[修改后的需求描述]'}

**修改原因**:
> ${item.reason || '[为什么要改]'}`).join('\n\n');
  };

  const formatRemoved = (items) => {
    if (items.length === 0) return `_（本次变更无删除需求）_\n`;
    return items.map(item => `### Requirement: ${item.title} (${item.id || 'R001'})

**删除原因**:
> ${item.reason || '[为什么删除，被什么替代]'}`).join('\n\n');
  };

  const baselineInfo = specFile
    ? `\n> Baseline: ${specFile}\n`
    : `\n> Baseline: 未找到现有 spec.md（全新项目）\n`;

  const keywordsSection = keywords.length > 0
    ? `\n## 核心关键词\n\n${keywords.map(k => `- ${k}`).join('\n')}\n`
    : '';

  const modulesSection = affectedModules.length > 0
    ? `\n## 受影响模块\n\n${affectedModules.map(m => `- ${m}`).join('\n')}\n`
    : '';

  const impactSection = impactScope && Object.keys(impactScope).length > 0
    ? `
## 影响范围评估

| 维度 | 评估 |
|---|---|
| 影响严重程度 | ${impactScope.severity || '待评估'} |
| 受影响的 API endpoints | ${(impactScope.apiEndpoints || []).length > 0 ? impactScope.apiEndpoints.join(', ') : '待识别'} |
| 受影响的 UI 页面 | ${(impactScope.uiPages || []).length > 0 ? impactScope.uiPages.join(', ') : '待识别'} |
| 数据库迁移 | ${impactScope.databaseMigration === true ? '是' : (impactScope.databaseMigration === false ? '否' : '待确认')} |
| Breaking Change | ${impactScope.breakingChange === true ? '是' : (impactScope.breakingChange === false ? '否' : '待确认')} |
`
    : '';

  return `# SPEC Delta: ${slug}
${baselineInfo}
> Generated: ${timestamp()}
> Status: Draft
> LLM Enhanced: ✅ Yes

## ADDED Requirements

${formatAdded(added)}

## MODIFIED Requirements

${formatModified(modified)}

## REMOVED Requirements

${formatRemoved(removed)}
${keywordsSection}
${modulesSection}
${impactSection}
---

Generated by project-orchestrator-bundle / openspec-workflow (LLM-enhanced)
`;
}

// ============================================================
// 3. tasks - 生成 TASKS.md（新增）
// ============================================================

async function tasks({ slug, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!slug) {
    return { ok: false, error: 'slug is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const changesDir = path.join(cwd, 'openspec', 'changes', slug);
  const deltaPath = path.join(changesDir, 'spec-delta.md');

  if (!(await fileExists(deltaPath))) {
    return { ok: false, error: `SPEC delta not found at ${deltaPath}. Run \`openspec delta\` first.`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const deltaContent = await fs.readFile(deltaPath, 'utf-8');
  const keywords = extractKeywords(deltaContent);

  // AST 增强：分析代码影响，为任务拆解提供参考
  let astAnalysis = null;
  let astEnhanced = false;
  try {
    const astResult = await analyzeChangeImpactWithAST(keywords, projectRoot);
    if (astResult) {
      astAnalysis = astResult;
      astEnhanced = true;
    }
  } catch {
    // AST 分析失败，静默回退
  }

  // LLM 增强：基于 SPEC delta 生成更专业的任务拆解
  let llmEnhanced = false;
  let llmTaskPlan = null;
  if (llm.isAvailable()) {
    try {
      // 同时读取 proposal 以获取更多上下文
      const proposalPathForLLM = path.join(changesDir, 'proposal.md');
      let proposalForLLM = '';
      if (await fileExists(proposalPathForLLM)) {
        proposalForLLM = await fs.readFile(proposalPathForLLM, 'utf-8');
      }

      const result = await llm.callLLM({
        system: `你是一位资深的技术项目经理和架构师，擅长将需求规格变更拆解为可执行的开发任务。

任务：根据 SPEC Delta 和 Change Proposal，输出结构化的任务拆解计划。

输出要求（严格 JSON 格式，不要 markdown 代码块）：
{
  "phases": [
    {
      "name": "Phase 名称",
      "description": "阶段描述",
      "tasks": [
        {
          "id": "T001",
          "title": "任务标题",
          "description": "详细的任务描述",
          "priority": "P0|P1|P2",
          "estimatedHours": 4,
          "filePaths": ["src/models/user.ts", "src/schema/user.sql"],
          "dependencies": ["T000"],
          "parallelizable": true
        }
      ]
    }
  ],
  "totalTasks": 10,
  "totalEstimatedHours": 40,
  "criticalPath": ["T001", "T002", "T005"],
  "parallelizableGroups": [["T003", "T004"]],
  "dependencies": [
    {"from": "T001", "to": "T002"}
  ]
}

要求：
1. 合理划分 Phase，通常包括：Schema & Data Model、API Layer、Service Layer、UI Layer、Testing & Quality 等
2. 每个任务要有明确的标题、描述、优先级、预估工时
3. 准确识别任务依赖关系和可并行的任务
4. filePaths 尽量给出合理的文件路径（基于常见的项目结构）
5. 识别关键路径（critical path）
6. 任务粒度适中，单个任务 0.5-8 小时为宜
7. 只输出 JSON，不要任何额外解释或 markdown 标记`,
        messages: [{ role: 'user', content: `请根据以下 SPEC Delta 和 Change Proposal，生成详细的任务拆解计划：

## SPEC Delta
${deltaContent}

${proposalForLLM ? `## Change Proposal（参考上下文）\n${proposalForLLM}` : ''}

请输出 JSON 格式的任务拆解计划。` }],
        temperature: 0.3,
        maxTokens: 4096,
      });
      if (result.ok) {
        try {
          // 尝试解析 JSON，兼容可能的 markdown 包裹
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          llmTaskPlan = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
          llmEnhanced = true;
        } catch {
          // JSON 解析失败，静默回退到模板生成
          llmTaskPlan = null;
        }
      }
    } catch {
      // 静默回退到模板生成逻辑
    }
  }

  // 生成 TASKS.md
  const tasksPath = path.join(changesDir, 'tasks.md');
  const tasksContent = llmEnhanced && llmTaskPlan
    ? generateLLMTasks(slug, llmTaskPlan)
    : generateTasks(slug, keywords);
  await fs.writeFile(tasksPath, tasksContent, 'utf-8');

  // 更新 proposal.md workflow 状态
  const proposalPath = path.join(changesDir, 'proposal.md');
  if (await fileExists(proposalPath)) {
    let p = await fs.readFile(proposalPath, 'utf-8');
    p = p.replace('- [ ] 3. TASKS.md', '- [x] 3. TASKS.md');
    await fs.writeFile(proposalPath, p, 'utf-8');
  }

  const summaryParts = ['TASKS.md generated'];
  if (astEnhanced) summaryParts.push('AST enhanced');
  if (llmEnhanced) summaryParts.push('LLM enhanced');

  const warnings = [];
  if (!llmEnhanced && keywords.length === 0) {
    warnings.push('No keywords extracted from SPEC delta. TASKS.md is template-only.');
  }
  if (astEnhanced && astAnalysis?.impactSummary?.breakingChangeRisk) {
    warnings.push(`Breaking change risk: ${astAnalysis.impactSummary.exportCount} exported API(s) affected`);
  }

  return {
    ok: true,
    data: {
      summary: summaryParts.join(' | '),
      slug,
      status: 'TASKS',
      taskCount: llmEnhanced && llmTaskPlan ? (llmTaskPlan.totalTasks || 0) : 8,
      astAnalysis,
      astEnhanced,
      llmEnhanced,
      llmProvider: llmEnhanced ? llm.getProviderName() : null,
      totalEstimatedHours: llmTaskPlan?.totalEstimatedHours || null,
      criticalPath: llmTaskPlan?.criticalPath || [],
      codeImpact: astAnalysis ? {
        filesScanned: astAnalysis.filesScanned,
        affectedFiles: astAnalysis.affectedFiles,
        affectedFunctions: astAnalysis.impactSummary.functionCount,
        affectedExports: astAnalysis.impactSummary.exportCount,
        affectedImports: astAnalysis.impactSummary.importCount,
      } : null,
      files: [tasksPath],
    },
    warnings,
    nextActions: [
      'Review and edit tasks.md (add details, estimates, assignees)',
      'Run `implement-executor` to execute tasks',
      'After implementation: run `openspec apply` to apply and archive',
    ],
  };
}

function generateTasks(slug, keywords) {
  const featureName = keywords[0] || 'feature';

  return `# TASKS: ${slug}

> Generated: ${timestamp()}
> Status: Pending

## Phase 1: Schema & Data Model

- [ ] T001 [P] 创建 ${featureName} 相关的数据表 / schema
- [ ] T002 [P] 创建 ${featureName} 的数据模型 / Entity

## Phase 2: API Layer

- [ ] T003 [P] 定义 OpenAPI: POST /api/v1/${featureName}
- [ ] T004 [P] 定义 OpenAPI: GET /api/v1/${featureName}
- [ ] T005 实现 ${featureName} service / business logic
- [ ] T006 实现 ${featureName} controller / API handler

## Phase 3: UI Layer（如适用）

- [ ] T010 [P] 创建 /${featureName}/list 页面
- [ ] T011 实现 ${featureName} 录入表单
- [ ] T012 实现 ${featureName} 详情/统计展示

## Phase 4: Testing & Quality

- [ ] T020 单元测试（覆盖率 ≥ 80%）
- [ ] T021 集成测试
- [ ] T022 Code Review（review-checklist）

## Checkpoints

⚠️ **Phase 1** 必须通过测试才能进入 Phase 2
⚠️ **Phase 2** 必须通过 API 契约测试才能进入 Phase 3
⚠️ **所有 Phase** 完成后必须通过完整回归测试

---

Generated by project-orchestrator-bundle / openspec-workflow
`;
}

/**
 * LLM 增强版：基于 LLM 任务计划生成高质量的 TASKS.md
 */
function generateLLMTasks(slug, taskPlan) {
  const { phases = [], totalTasks = 0, totalEstimatedHours = 0, criticalPath = [], parallelizableGroups = [], dependencies = [] } = taskPlan;

  const formatPhases = () => {
    if (phases.length === 0) {
      return `## Phase 1: Implementation

- [ ] T001 [P1] 实现核心功能
`;
    }
    return phases.map((phase, phaseIdx) => {
      const phaseName = phase.name || `Phase ${phaseIdx + 1}`;
      const phaseDesc = phase.description ? `\n> ${phase.description}\n` : '';
      const tasks = (phase.tasks || []).map(task => {
        const priority = task.priority ? `[${task.priority}]` : '';
        const estimate = task.estimatedHours ? `⏱️ ${task.estimatedHours}h` : '';
        const deps = task.dependencies && task.dependencies.length > 0
          ? ` _depends on: ${task.dependencies.join(', ')}_`
          : '';
        const parallel = task.parallelizable ? ' 🔀 可并行' : '';
        const files = task.filePaths && task.filePaths.length > 0
          ? `\n  - 文件: ${task.filePaths.join(', ')}`
          : '';
        const desc = task.description ? `\n  - 描述: ${task.description}` : '';

        return `- [ ] ${task.id || 'T000'} ${priority} ${task.title || '未命名任务'} ${estimate}${parallel}${deps}${desc}${files}`;
      }).join('\n\n');

      return `## ${phaseName}${phaseDesc}\n${tasks}\n`;
    }).join('\n');
  };

  const summarySection = `
## 任务概览

| 指标 | 值 |
|---|---|
| 总任务数 | ${totalTasks} |
| 预估总工时 | ${totalEstimatedHours > 0 ? totalEstimatedHours + ' 小时' : '待评估'} |
| 阶段数 | ${phases.length} |
| 关键路径任务 | ${criticalPath.length > 0 ? criticalPath.join(' → ') : '待识别'} |
`;

  const criticalPathSection = criticalPath.length > 0
    ? `
## 关键路径 (Critical Path)

${criticalPath.map(id => `- ${id}`).join('\n')}
`
    : '';

  const parallelGroupsSection = parallelizableGroups && parallelizableGroups.length > 0
    ? `
## 可并行任务组

${parallelizableGroups.map((group, i) => `- 组 ${i + 1}: ${group.join(', ')}`).join('\n')}
`
    : '';

  const depsSection = dependencies && dependencies.length > 0
    ? `
## 任务依赖关系

| 前置任务 | 后续任务 |
|---|---|
${dependencies.map(d => `| ${d.from || ''} | ${d.to || ''} |`).join('\n')}
`
    : '';

  const checkpoints = phases.length > 0
    ? `
## Checkpoints

${phases.slice(0, -1).map((p, i) => `⚠️ **${p.name}** 完成后必须通过评审才能进入下一阶段`).join('\n')}
⚠️ **所有 Phase** 完成后必须通过完整回归测试
`
    : `
## Checkpoints

⚠️ **Phase 1** 必须通过测试才能进入 Phase 2
⚠️ **所有 Phase** 完成后必须通过完整回归测试
`;

  return `# TASKS: ${slug}

> Generated: ${timestamp()}
> Status: Pending
> LLM Enhanced: ✅ Yes
${summarySection}
${formatPhases()}
${criticalPathSection}
${parallelGroupsSection}
${depsSection}
${checkpoints}
---

Generated by project-orchestrator-bundle / openspec-workflow (LLM-enhanced)
`;
}

// ============================================================
// 4. apply - 应用变更（新增）
// ============================================================

async function apply({ slug, projectRoot, mergeBranch }) {
  const cwd = projectRoot || process.cwd();

  if (!slug) {
    return { ok: false, error: 'slug is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const changesDir = path.join(cwd, 'openspec', 'changes', slug);
  const proposalPath = path.join(changesDir, 'proposal.md');

  if (!(await fileExists(proposalPath))) {
    return { ok: false, error: `Proposal not found: ${slug}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 1. 生成 ARCHIVE.md
  const archivePath = path.join(changesDir, 'archive.md');
  const proposalContent = await fs.readFile(proposalPath, 'utf-8');
  const archiveContent = generateArchive(slug, proposalContent);
  await fs.writeFile(archivePath, archiveContent, 'utf-8');

  // 2. 更新 proposal.md 状态
  let updatedProposal = proposalContent
    .replace('**Status**: Draft', '**Status**: Applied')
    .replace('- [ ] 4. 执行 + 测试', '- [x] 4. 执行 + 测试')
    .replace('- [ ] 5. ARCHIVE.md', '- [x] 5. ARCHIVE.md');
  await fs.writeFile(proposalPath, updatedProposal, 'utf-8');

  // 3. 如果有 git，切回主分支并合并
  const hasGit = await gitAvailable() && (await gitIsRepo(cwd));
  let mergeResult = null;
  if (hasGit && mergeBranch !== false) {
    const branchName = 'openspec/changes/' + slug;
    const currentBranch = await getCurrentBranch(cwd);
    const targetBranch = mergeBranch || 'main';
    try {
      // 切到目标分支
      await execAsync(`git checkout ${targetBranch}`, { cwd });
      // 合并
      await execAsync(`git merge --no-ff ${branchName} -m "Apply openspec change: ${slug}"`, { cwd });
      mergeResult = { targetBranch, merged: true };
    } catch (err) {
      // 合并失败则切回原分支
      try {
        await execAsync(`git checkout ${currentBranch}`, { cwd });
      } catch { /* ignore */ }
      return {
        ok: false,
        error: `Git merge failed: ${err.message}. Archive was generated but branch was not merged.`,
        data: {
          slug,
          files: [archivePath],
          mergeAttempted: true,
          llmEnhanced: false,
          llmProvider: null,
        },
        warnings: [],
        nextActions: [],
      };
    }
  }

  return {
    ok: true,
    data: {
      summary: '✅ Change applied and archived',
      slug,
      status: 'APPLIED',
      files: [archivePath],
      mergeResult,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: !hasGit ? ['Git not available — merge skipped. Archive was generated in place.'] : [],
    nextActions: [
      'Verify the applied changes work correctly',
      'Run `review-checklist` for code review',
      'Deploy to staging environment',
    ],
  };
}

function generateArchive(slug, proposalContent) {
  // 从 proposal 中提取标题
  const titleMatch = proposalContent.match(/# Change Proposal:\s*(.+)/);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  return `# Archive: ${slug}

## Metadata

| Field | Value |
|---|---|
| **Change ID** | ${slug} |
| **Title** | ${title} |
| **Applied** | ${timestamp()} |
| **Author** | [待填写] |
| **Reviewers** | [待填写] |

## Summary

[1-2 段最终实施总结 — 待填写]

## Spec Changes

### ADDED
- [列出新增的需求，来自 spec-delta.md]

### MODIFIED
- [列出修改的需求，来自 spec-delta.md]

### REMOVED
- [列出删除的需求，来自 spec-delta.md]

## Decisions

| Decision | Rationale | Alternatives Considered |
|---|---|---|
| [决策 1] | [原因] | [备选方案] |
| [决策 2] | [原因] | [备选方案] |

## Files Changed

- [列出主要变更的文件列表]

## Test Results

- 单元测试: [通过 / 失败，覆盖率 X%]
- 集成测试: [通过 / 失败]
- E2E 测试: [通过 / 失败]

---

Generated by project-orchestrator-bundle / openspec-workflow
`;
}

// ============================================================
// 5. archive - 仅归档（不应用）（新增）
// ============================================================

async function archive({ slug, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!slug) {
    return { ok: false, error: 'slug is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const changesDir = path.join(cwd, 'openspec', 'changes', slug);
  const proposalPath = path.join(changesDir, 'proposal.md');

  if (!(await fileExists(proposalPath))) {
    return { ok: false, error: `Proposal not found: ${slug}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 创建 archive 目录
  const archiveDir = path.join(cwd, 'openspec', 'archive', slug);
  await ensureDir(archiveDir);

  // 复制所有文件
  const files = await fs.readdir(changesDir);
  const copied = [];
  for (const f of files) {
    const src = path.join(changesDir, f);
    const dest = path.join(archiveDir, f);
    const stat = await fs.stat(src);
    if (stat.isFile()) {
      await fs.copyFile(src, dest);
      copied.push(f);
    }
  }

  // 更新 proposal 状态为 Archived
  let p = await fs.readFile(proposalPath, 'utf-8');
  p = p.replace('**Status**: Draft', '**Status**: Archived');
  await fs.writeFile(proposalPath, p, 'utf-8');

  return {
    ok: true,
    data: {
      summary: '✅ Change archived (not applied)',
      slug,
      status: 'ARCHIVED',
      archivePath: archiveDir,
      files: copied,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: [],
    nextActions: [
      'Archived changes are kept for reference',
      'To apply a change later: use `openspec apply`',
    ],
  };
}

// ============================================================
// 6. list - 列出所有变更（新增辅助命令）
// ============================================================

async function list({ projectRoot, status }) {
  const cwd = projectRoot || process.cwd();
  const changesDir = path.join(cwd, 'openspec', 'changes');

  if (!(await fileExists(changesDir))) {
    return {
      ok: true,
      data: { changes: [], count: 0, summary: 'No changes found. Get started with `openspec propose`.', llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  const changes = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const proposalPath = path.join(changesDir, slug, 'proposal.md');
    if (!(await fileExists(proposalPath))) continue;

    const content = await fs.readFile(proposalPath, 'utf-8');
    const titleMatch = content.match(/# Change Proposal:\s*(.+)/);
    const statusMatch = content.match(/\*\*Status\*\*:\s*(\w+)/);

    changes.push({
      slug,
      title: titleMatch ? titleMatch[1].trim() : slug,
      status: statusMatch ? statusMatch[1].trim() : 'Draft',
    });
  }

  // 按状态过滤
  const filtered = status
    ? changes.filter(c => c.status.toLowerCase() === status.toLowerCase())
    : changes;

  return {
    ok: true,
    data: {
      changes: filtered,
      count: filtered.length,
      total: changes.length,
      summary: `${filtered.length} change(s) found${status ? ` (status: ${status})` : ''}`,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: [],
    nextActions: [],
  };
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  propose,
  delta,
  tasks,
  apply,
  archive,
  list,
};
