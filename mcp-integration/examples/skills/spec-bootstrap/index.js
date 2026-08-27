/**
 * spec-bootstrap Skill - 完整实现
 *
 * 实现 Spec Kit 8 命令：
 *   constitution / specify / clarify / plan / tasks / checklist / analyze / implement
 *
 * 工作流程：
 *   1. 读 .specify/memory/constitution.md（如不存在则用模板生成）
 *   2. 自然语言 → spec.md（基于模板 + 启发式拆分）
 *   3. spec.md → plan.md（基于约定的技术栈推断）
 *   4. plan.md → tasks.md（按 Phase 分层）
 *   5. 一致性分析（spec ↔ plan ↔ tasks）
 *
 * 对应 MCP Tool: design_generate（由 spec-userstory-to-design 调用作为前置）
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// ============================================================
// 模板定义
// ============================================================

const CONSTITUTION_TEMPLATE = `# [PROJECT_NAME] Constitution

> 由 project-orchestrator-bundle / spec-bootstrap 自动生成
> 生成时间：[DATE]

## Core Principles

### 1. Library-First
每个能力优先作为独立库实现，便于复用与测试。

### 2. Test-Driven Development
先写测试，再写实现。覆盖率 ≥ 80%。

### 3. API-First Design
所有接口优先以 OpenAPI 3.1.2 形式定义，前后端并行开发。

### 4. Contract Consistency
服务端实现必须严格匹配 OpenAPI 契约，CI 自动校验。

### 5. Observable by Default
所有外部交互必须有日志 + traceId + metrics。

## Quality Gates

- ✅ 测试覆盖率 ≥ 80%
- ✅ ESLint 0 错
- ✅ TypeScript 0 类型错
- ✅ 契约测试 100% 通过
- ✅ 1 个 reviewer approve

## Tech Stack（待填充）

- 前端：[未指定]
- 后端：[未指定]
- 数据库：[未指定]
- 部署：[未指定]

## Governance

本文档为项目宪法，修改需全团队 Review。

**Version**: 1.0
**Ratified**: [DATE]
**Last Amended**: [DATE]
`;

const SPEC_TEMPLATE = `# Feature Specification: [FEATURE_NAME]

**Feature Branch**: \`001-[FEATURE_SLUG]\`
**Status**: Draft
**Input**: User description: "[DESCRIPTION]"

## User Scenarios & Testing

### User Story 1 - [TITLE]（Priority: P1）

[详细描述]

**Why this priority**: [理由]

**Independent Test**: [如何独立验证]

**Acceptance Scenarios**:
1. **Given** [前置] **When** [动作] **Then** [结果]
2. ...

### User Story 2 - [TITLE]（Priority: P2）
...

## Requirements

### Functional Requirements
- **FR-001**: System MUST [功能描述]
- **FR-002**: System MUST [功能描述]

### Key Entities
- **[Entity1]**: [描述]

## Success Criteria

- **SC-001**: [可度量指标]
- **SC-002**: [可度量指标]
`;

const PLAN_TEMPLATE = `# Implementation Plan: [FEATURE]

**Branch**: \`001-[FEATURE_SLUG]\` | **Date**: [DATE]
**Spec**: [spec.md link]

## Summary

[从 spec.md 提取]

## Technical Context

**Language/Version**: [推断]
**Primary Dependencies**: [推断]
**Storage**: [推断]
**Testing**: [推断]
**Target Platform**: [推断]

## Constitution Check

✅ Library-First
✅ Test-Driven Development  (≥80% coverage)
✅ API-First Design
✅ Contract Consistency

## Project Structure

\`\`\`
[自动生成]
\`\`\`

## Complexity Tracking

[无复杂依赖]
`;

const TASKS_TEMPLATE = `# Tasks: [FEATURE]

> 由 spec-bootstrap 自动生成（基于 plan.md）
> 严格按 Phase 顺序执行

## Phase 1: Setup（Shared Infrastructure）
- [ ] T001 [P] 使用官方脚手架创建工程
- [ ] T002 [P] 安装 ESLint + Prettier 配置

## Phase 2: Foundational（Blocking Prerequisites）
- [ ] T003 [P] [US1] 实现 [核心模块]

## Phase 3: User Story 1 - [TITLE]（Priority: P1）MVP
- [ ] T010 [P] [US1] 添加 [任务]
- [ ] T011 [US1] 实现 [任务]

## Phase N: Polish & Cross-Cutting Concerns
- [ ] T040 [P] 文档
- [ ] T041 [P] 性能优化

## Dependencies & Execution Order

Phase 1 → Phase 2 → (US1 ‖ US2) → Phase N
`;

// ============================================================
// 辅助函数
// ============================================================

function timestamp() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ============================================================
// 辅助函数
// ============================================================

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 在 <projectRoot>/specs/ 下寻找第一个包含 spec.md 的子目录，
 * 返回 feature 目录名（如 "001-test"）或 null。
 *
 * 说明：spec-bootstrap 的 specify() 会根据用户输入 slug 生成
 *       `specs/001-${slug}/spec.md`，因此目录名是不确定的。
 *       之前硬编码 `specs/001-feature/` 兜底路径会导致 clarify/plan/...
 *       在使用非 "feature" slug 时找不到 spec.md。
 */
function findFirstFeatureDir(cwd) {
  const specsDir = path.join(cwd, 'specs');
  try {
    const entries = fsSync.readdirSync(specsDir, { withFileTypes: true });
    // 按名字字典序，优先 001-*
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const dir of entries) {
      if (!dir.isDirectory()) continue;
      const specFile = path.join(specsDir, dir.name, 'spec.md');
      if (fsSync.existsSync(specFile)) return dir.name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析 spec.md 的绝对路径：
 *   - 传了 specFile（相对或绝对）→ 直接用
 *   - 否则 findFirstFeatureDir() 找第一个含 spec.md 的目录
 *   - 最后兜底：specs/001-feature/spec.md（向后兼容）
 */
function resolveSpecPath(cwd, specFile) {
  if (specFile) return path.resolve(cwd, specFile);
  const dir = findFirstFeatureDir(cwd);
  if (dir) return path.join(cwd, 'specs', dir, 'spec.md');
  return path.join(cwd, 'specs', '001-feature', 'spec.md');
}

async function writeFileSafe(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}

// 简单的需求提取启发式（基于关键字）
function extractUserStories(description) {
  const stories = [];
  const lines = description.split(/[。\n]/).filter(l => l.trim());
  let storyId = 1;

  for (const line of lines) {
    const lower = line.toLowerCase();
    // 启发式：包含 "用户"、"管理员"、"管理员能" 等关键词的视为 User Story
    if (lower.match(/用户|管理员|运营|商家|user|admin|customer/)) {
      stories.push({
        id: `US-${String(storyId++).padStart(2, '0')}`,
        title: line.trim().slice(0, 50),
        priority: stories.length === 0 ? 'P1' : `P${Math.min(stories.length + 1, 3)}`,
      });
    }
  }

  // 如果没提取到，至少创建 1 个 US
  if (stories.length === 0) {
    stories.push({
      id: 'US-01',
      title: description.trim().slice(0, 50),
      priority: 'P1',
    });
  }

  return stories;
}

function generateAcceptanceScenarios(storyTitle) {
  return [
    `**Given** [前置条件] **When** ${storyTitle.slice(0, 20)} **Then** [期望结果]`,
    `**Given** [无效输入] **When** [异常操作] **Then** [返回错误]`,
  ];
}

// ============================================================
// AST 增强分析：Markdown 代码块语法验证
// ============================================================

/**
 * 从 Markdown 文件中提取代码块并验证语法
 * @param {string} markdownContent - Markdown 文件内容
 * @param {string} fileName - 文件名（用于报告）
 * @returns {{astEnhanced: boolean, totalBlocks: number, validBlocks: number, invalidBlocks: Array}}
 */
function validateMarkdownCodeBlocksAST(markdownContent, fileName) {
  if (!markdownContent) return { astEnhanced: false, totalBlocks: 0, validBlocks: 0, invalidBlocks: [] };

  const codeBlocks = ast.extractMarkdownCodeBlocks(markdownContent);
  if (codeBlocks.length === 0) {
    return { astEnhanced: false, totalBlocks: 0, validBlocks: 0, invalidBlocks: [] };
  }

  let validBlocks = 0;
  const invalidBlocks = [];

  for (const block of codeBlocks) {
    // 跳过非代码语言块
    const lang = block.lang.toLowerCase();
    if (!lang || lang === 'text' || lang === 'plaintext' || lang === 'markdown') continue;

    // 映射语言到 AST 验证器
    let validateLang = 'auto';
    if (['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx'].includes(lang)) {
      validateLang = 'js';
    } else if (['html', 'xml', 'svg'].includes(lang)) {
      validateLang = 'html';
    } else if (['css', 'scss', 'less'].includes(lang)) {
      validateLang = 'css';
    } else {
      continue; // 跳过不支持的语言
    }

    const result = ast.validateCodeSyntax(block.code, validateLang);
    if (result.valid) {
      validBlocks++;
    } else {
      invalidBlocks.push({
        file: fileName,
        lang: block.lang,
        startLine: block.startLine,
        error: result.error ? result.error.slice(0, 200) : 'unknown',
      });
    }
  }

  return {
    astEnhanced: true,
    totalBlocks: codeBlocks.length,
    validBlocks,
    invalidBlocks,
  };
}

// ============================================================
// 8 个命令实现
// ============================================================

async function constitution({ projectRoot, principles, projectName }) {
  const cwd = projectRoot || process.cwd();
  const constitutionDir = path.join(cwd, '.specify/memory');
  const constitutionPath = path.join(constitutionDir, 'constitution.md');

  let content = CONSTITUTION_TEMPLATE;
  content = content.replace(/\[PROJECT_NAME\]/g, projectName || 'NewProject');
  content = content.replace(/\[DATE\]/g, timestamp());

  // 应用传入的 principles（覆盖默认）
  if (principles && Array.isArray(principles)) {
    const principlesSection = principles
      .map((p, i) => `### ${i + 1}. ${p.name}\n${p.description || ''}`)
      .join('\n\n');
    content = content.replace(
      /## Core Principles[\s\S]*?(?=## Quality Gates)/,
      `## Core Principles\n\n${principlesSection}\n\n`
    );
  }

  await writeFileSafe(constitutionPath, content);

  return {
    ok: true,
    data: {
      summary: `✅ Constitution created`,
      path: constitutionPath,
      name: projectName || 'NewProject',
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: [],
    nextActions: ['Run /spec-bootstrap.specify to generate spec.md'],
  };
}

async function specify({ projectRoot, description }) {
  const cwd = projectRoot || process.cwd();
  if (!description) {
    return { ok: false, error: 'description is required', warnings: [], nextActions: [] };
  }

  const slug = slugify(description);
  const featureDir = path.join(cwd, 'specs', `001-${slug}`);
  const specPath = path.join(featureDir, 'spec.md');

  // 提取 User Stories
  const stories = extractUserStories(description);

  // 生成 spec.md 内容
  let content = SPEC_TEMPLATE;
  content = content.replace(/\[FEATURE_NAME\]/g, description.slice(0, 50));
  content = content.replace(/\[FEATURE_SLUG\]/g, slug);
  content = content.replace(/\[DESCRIPTION\]/g, description);
  content = content.replace(/\[DATE\]/g, timestamp());

  // 注入 User Stories
  const storiesSection = stories.map(s => {
    return `### User Story ${s.id} - ${s.title}（Priority: ${s.priority}）

[基于描述自动生成的 User Story]

**Why this priority**: ${s.priority === 'P1' ? 'MVP 核心需求' : '次要功能'}

**Independent Test**: 可通过 [具体操作] 独立验证

**Acceptance Scenarios**:
${generateAcceptanceScenarios(s.title).map(a => `1. ${a}`).join('\n')}
`;
  }).join('\n');

  content = content.replace(
    /### User Story 1[\s\S]*?(?=## Requirements)/,
    storiesSection
  );

  // 结构化 LLM 增强：使用 generateDocument 生成 spec.md
  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.generateDocument({
        type: 'specification',
        customSystem: `你是一位资深产品经理，负责编写高质量的产品规格文档（spec.md）。

你的任务是基于用户提供的功能描述，生成一份专业、完整、可执行的产品规格文档。

输出要求：
1. 严格遵循以下 Markdown 结构（不要添加或删除一级/二级标题）：
   - # Feature Specification: [功能名称]
   - ## User Scenarios & Testing
     - ### User Story X - [标题]（Priority: P1/P2/P3）
   - ## Requirements
     - ### Functional Requirements
     - ### Non-Functional Requirements
     - ### Key Entities
   - ## Success Criteria

2. 每个 User Story 必须包含：
   - 详细的故事描述（作为...我希望...以便...）
   - **Why this priority**: 优先级理由
   - **Independent Test**: 如何独立验证该故事
   - **Acceptance Scenarios**: 至少 3 条 Given/When/Then 场景（包含正常流程、边界条件、异常情况）

3. Functional Requirements 编号为 FR-001、FR-002...，每条以 "System MUST" 开头

4. Non-Functional Requirements 包含性能、安全、可用性、可维护性等维度，编号为 NFR-001、NFR-002...

5. Key Entities 列出核心数据实体及其属性描述

6. Success Criteria 必须是可度量的指标，编号为 SC-001、SC-002...

7. 只输出 Markdown 文档内容，不要任何解释性文字`,
        projectName: projectName || 'NewProject',
        description: description.slice(0, 500),
        additionalContext: `## 当前模板生成的草稿（供参考，可大幅优化）\n${content}\n\n请输出优化后的完整 spec.md 内容：`,
        language: 'zh',
      });
      if (llmResult.ok && llmResult.document) {
        content = llmResult.document;
      }
    } catch {
      // LLM 失败时静默回退到模板
    }

    // 结构化 LLM 增强：使用 generateDocument 生成配套 README
    const docResult = await llm.generateDocument({
      type: 'readme',
      projectName: projectName || 'NewProject',
      description: description.slice(0, 500),
      techStack: [],
      features: stories.map(s => s.title || s.id),
      additionalContext: content.slice(0, 2000),
    });
    if (docResult.ok && docResult.document) {
      const readmePath = path.join(path.dirname(specPath), 'README.md');
      await writeFileSafe(readmePath, docResult.document);
    }
  }

  await writeFileSafe(specPath, content);

  return {
    ok: true,
    data: {
      summary: `✅ spec.md generated (${stories.length} User Stories extracted)`,
      path: specPath,
      storiesCount: stories.length,
      stories: stories.map(s => s.id),
      llmEnhanced: llm.isAvailable(),
      llmProvider: llm.getProviderName(),
    },
    warnings: description.length < 30 ? ['Description too short, may produce incomplete spec'] : [],
    nextActions: [
      'Run /spec-bootstrap.clarify to resolve ambiguities',
      'Or skip to /spec-bootstrap.plan if spec is clear',
    ],
  };
}

async function clarify({ projectRoot, specFile }) {
  const cwd = projectRoot || process.cwd();
  const specPath = resolveSpecPath(cwd, specFile);

  const content = await readIfExists(specPath);
  if (!content) {
    return { ok: false, error: `spec.md not found: ${specPath}`, warnings: [], nextActions: [] };
  }

  // 启发式：找出模糊点（包含 "可能"、"也许"、"TODO"、"?" 等）
  let ambiguities = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (line.match(/可能|也许|TODO|\?不清楚|待定/i)) {
      ambiguities.push({ line: i + 1, text: line.trim() });
    }
  });

  // LLM 增强：深度分析 spec 中的模糊点，生成更有深度的澄清问题
  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.callLLM({
        system: `你是一位资深产品分析师，擅长从产品规格文档中识别模糊不清、需要澄清的问题。

你的任务是仔细阅读 spec.md，找出其中描述模糊、定义不明确、缺少关键信息的地方，并生成需要用户澄清的问题。

输出要求：
1. 只输出 JSON 格式，不要任何解释性文字
2. JSON 结构：
{
  "ambiguities": [
    {
      "category": "功能需求|非功能需求|用户故事|验收标准|实体定义|成功指标|范围边界|技术约束",
      "severity": "high|medium|low",
      "question": "具体的澄清问题",
      "context": "引用原文中相关的句子或段落",
      "whyItMatters": "为什么这个问题需要澄清，不澄清会有什么影响"
    }
  ]
}
3. 重点关注：
   - 缺少量化指标的需求（如"快速响应"但无具体时间）
   - 边界条件不明确的功能
   - 用户角色定义模糊
   - 验收标准不可验证
   - 数据实体缺少关键字段定义
   - 性能、安全等非功能性需求缺失
   - 功能范围不清晰（做什么/不做什么）
4. 至少找出 5 个澄清问题，按严重程度排序`,
        messages: [{
          role: 'user',
          content: `请分析以下 spec.md，找出需要澄清的问题：

\`\`\`
${content}
\`\`\`

请以 JSON 格式输出澄清问题列表：`
        }],
        temperature: 0.3,
        maxTokens: 2048,
      });
      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          if (parsed.ambiguities && Array.isArray(parsed.ambiguities)) {
            // 合并启发式结果和 LLM 结果，优先使用 LLM 的深度分析
            ambiguities = parsed.ambiguities.map((a, i) => ({
              line: 'N/A',
              text: `[${a.category || '分析'}] ${a.question}`,
              severity: a.severity || 'medium',
              context: a.context || '',
              whyItMatters: a.whyItMatters || '',
            }));
          }
        } catch {
          // JSON 解析失败，保持原有启发式结果
        }
      }
    } catch {
      // LLM 失败时静默回退到模板
    }
  }

  // 标记需澄清点
  let updated = content;
  if (ambiguities.length > 0) {
    updated += '\n\n## Clarifications\n\n';
    updated += '> 以下问题需要用户确认：\n\n';
    ambiguities.forEach((a, i) => {
      updated += `${i + 1}. ${a.text}\n`;
      if (a.context) updated += `   - 上下文：${a.context}\n`;
      if (a.whyItMatters) updated += `   - 为什么重要：${a.whyItMatters}\n`;
    });
  }

  await writeFileSafe(specPath, updated);

  // 写 .clarified 标记文件，让 orchestrator-state-machine 的 S3 检测能通过文件存在性直接命中
  // （作为 spec.md 中 "已澄清/Clarifications" 字符串检测的双保险）
  try {
    const marker = path.join(path.dirname(specPath), '.clarified');
    await fs.writeFile(marker, JSON.stringify({
      clarifiedAt: new Date().toISOString(),
      ambiguitiesCount: ambiguities.length,
    }, null, 2), 'utf-8');
  } catch { /* 写标记失败不影响主结果（标记是辅助信息） */ }

  return {
    ok: true,
    data: {
      summary: ambiguities.length > 0
        ? `⚠️ Found ${ambiguities.length} ambiguities, please review`
        : '✅ Spec is clear, no ambiguities',
      ambiguitiesCount: ambiguities.length,
      ambiguities: ambiguities.slice(0, 5), // 最多返回 5 个
      llmEnhanced: llm.isAvailable(),
      llmProvider: llm.getProviderName(),
    },
    specPath,
    warnings: ambiguities.length > 0 ? [`${ambiguities.length} clarifications needed`] : [],
    nextActions: ambiguities.length > 0
      ? ['Resolve clarifications, then run /spec-bootstrap.plan']
      : ['Run /spec-bootstrap.plan'],
  };
}

async function plan({ projectRoot, specFile }) {
  const cwd = projectRoot || process.cwd();
  const specPath = resolveSpecPath(cwd, specFile);

  const specContent = await readIfExists(specPath);
  if (!specContent) {
    return { ok: false, error: `spec.md not found: ${specPath}`, warnings: [], nextActions: [] };
  }

  // 推断技术栈（基于 spec.md 内容关键字）
  let techStack = {
    frontend: '[未指定]',
    backend: '[未指定]',
    storage: '[未指定]',
    testing: 'vitest',
    platform: '[未指定]',
  };

  if (specContent.match(/react|vue|前端|ui|页面/i)) {
    techStack.frontend = 'React + Vite + TypeScript';
  }
  if (specContent.match(/api|后端|server|后端/i)) {
    techStack.backend = 'NestJS + TypeScript';
  }
  if (specContent.match(/数据库|database|存储|db/i)) {
    techStack.storage = 'PostgreSQL';
  }
  if (specContent.match(/移动端|mobile|ios|android/i)) {
    techStack.platform = 'React Native (Expo)';
  }

  // 生成 plan.md
  const slug = path.basename(path.dirname(specPath));
  const featureDir = path.dirname(specPath);
  const planPath = path.join(featureDir, 'plan.md');

  let content = PLAN_TEMPLATE;
  content = content.replace(/\[FEATURE\]/g, slug);
  content = content.replace(/\[DATE\]/g, timestamp());
  content = content.replace(/\[推断\]/g, techStack.frontend);
  // 替换 Technical Context 段
  content = content.replace(
    /## Technical Context[\s\S]*?(?=## Constitution Check)/,
    `## Technical Context

**Language/Version**: ${techStack.frontend}
**Primary Dependencies**: ${techStack.frontend}, ${techStack.backend}
**Storage**: ${techStack.storage}
**Testing**: ${techStack.testing}
**Target Platform**: ${techStack.platform}
`
  );

  // 结构化 LLM 增强：使用 generateDocument 生成 plan.md
  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.generateDocument({
        type: 'implementation plan',
        customSystem: `你是一位资深架构师，负责基于产品规格文档（spec.md）生成详细的技术实现方案（plan.md）。

你的任务是分析 spec.md 中的需求，设计合理的技术架构，并给出详细的实现计划。

输出要求：
1. 严格遵循以下 Markdown 结构（不要添加或删除一级/二级标题）：
   - # Implementation Plan: [功能名]
   - ## Summary
   - ## Technical Context
   - ## Architecture Design（新增 - 架构设计）
   - ## Tech Stack Rationale（新增 - 技术选型理由）
   - ## Constitution Check
   - ## Project Structure
   - ## Complexity Tracking
   - ## Risks & Mitigations（新增 - 风险与应对）

2. Architecture Design 部分：
   - 描述整体架构分层
   - 核心模块划分及职责
   - 模块间交互方式
   - 关键数据流

3. Tech Stack Rationale 部分：
   - 说明每项技术选型的理由
   - 对比可选方案
   - 适用场景和局限性

4. Project Structure 部分：
   - 生成完整的目录结构（使用代码块）
   - 每个目录/文件的用途说明
   - 遵循 Library-First 原则

5. Risks & Mitigations 部分：
   - 识别技术风险、依赖风险
   - 每个风险的缓解措施

6. 只输出 Markdown 文档内容，不要任何解释性文字`,
        projectName: projectName || 'NewProject',
        description: `spec.md 摘要: ${specContent.slice(0, 500)}`,
        additionalContext: `## 当前模板生成的草稿（供参考，可大幅优化和扩展）\n${content}\n\n请输出优化后的完整 plan.md 内容：`,
        language: 'zh',
      });
      if (llmResult.ok && llmResult.document) {
        content = llmResult.document;
      }
    } catch {
      // LLM 失败时静默回退到模板
    }
  }

  await writeFileSafe(planPath, content);

  return {
    ok: true,
    data: {
      summary: `✅ plan.md generated with inferred tech stack`,
      path: planPath,
      techStack,
      llmEnhanced: llm.isAvailable(),
      llmProvider: llm.getProviderName(),
    },
    warnings: techStack.frontend === '[未指定]'
      ? ['No frontend hints in spec.md, please specify tech stack manually']
      : [],
    nextActions: ['Review plan.md, then run /spec-bootstrap.tasks'],
  };
}

async function tasks({ projectRoot, planFile }) {
  const cwd = projectRoot || process.cwd();
  let planPath;
  if (planFile) {
    planPath = path.resolve(cwd, planFile);
  } else {
    const dir = findFirstFeatureDir(cwd);
    planPath = dir
      ? path.join(cwd, 'specs', dir, 'plan.md')
      : path.join(cwd, 'specs', '001-feature', 'plan.md');
  }

  const planContent = await readIfExists(planPath);
  if (!planContent) {
    return { ok: false, error: `plan.md not found: ${planPath}`, warnings: [], nextActions: [] };
  }

  const slug = path.basename(path.dirname(planPath));
  const featureDir = path.dirname(planPath);
  const tasksPath = path.join(featureDir, 'tasks.md');

  // 从 plan.md 提取涉及的模块（启发式）
  const moduleMatches = planContent.match(/src\/(\w+)/g) || [];
  const modules = [...new Set(moduleMatches.map(m => m.replace('src/', '')))];

  // 生成 tasks.md
  let content = TASKS_TEMPLATE;
  content = content.replace(/\[FEATURE\]/g, slug);
  content = content.replace(/\[DATE\]/g, timestamp());

  // 补充具体的 Setup Tasks
  if (modules.length > 0) {
    const setupTasks = modules.map((m, i) =>
      `- [ ] T00${i + 1} [P] 实现 ${m} 模块的目录结构和接口定义`
    ).join('\n');
    content = content.replace(
      /## Phase 1: Setup[\s\S]*?(?=## Phase 2)/,
      `## Phase 1: Setup（Shared Infrastructure）\n${setupTasks}\n\n`
    );
  }

  // 结构化 LLM 增强：使用 generateDocument 生成 tasks.md
  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.generateDocument({
        type: 'task list',
        customSystem: `你是一位资深技术项目经理，擅长将技术实现计划拆解为细粒度、可执行的开发任务。

你的任务是基于 plan.md 和 spec.md 的内容，生成一份按 Phase 组织的详细任务列表（tasks.md）。

输出要求：
1. 严格遵循以下 Markdown 结构（不要添加或删除一级/二级标题）：
   - # Tasks: [功能名]
   - ## Phase 1: Setup（Shared Infrastructure）
   - ## Phase 2: Foundational（Blocking Prerequisites）
   - ## Phase 3: User Story 1 - [标题]（Priority: P1）MVP
   - ## Phase 4: User Story 2 - [标题]（Priority: P2）
   - ...（根据 User Story 数量添加 Phase）
   - ## Phase N: Polish & Cross-Cutting Concerns
   - ## Dependencies & Execution Order

2. 任务格式：
   - 每行一个任务，格式：- [ ] T### [P] [US#] 任务描述
   - T### 为任务编号（T001, T002...）
   - [P] 标记表示优先级任务（P1 故事的核心任务）
   - [US#] 标记关联的 User Story（如 [US1]、[US2]）

3. Phase 1: Setup - 基础设施搭建
   - 项目脚手架初始化
   - 代码规范配置（ESLint、Prettier）
   - CI/CD 配置
   - 测试框架配置

4. Phase 2: Foundational - 核心基础模块
   - 数据模型定义
   - API 接口契约
   - 核心库/工具函数
   - 共享组件

5. Phase 3..N: 每个 User Story 一个 Phase
   - 按依赖顺序排列
   - 每个 Story 拆分为 3-8 个细粒度任务
   - 包含：接口定义、数据层、业务逻辑、UI 层、测试

6. Phase N: Polish - 收尾工作
   - 文档编写
   - 性能优化
   - 安全审计
   - 集成测试

7. Dependencies & Execution Order 部分说明各 Phase 之间的依赖关系

8. 只输出 Markdown 文档内容，不要任何解释性文字`,
        projectName: projectName || 'NewProject',
        description: `plan.md 摘要: ${planContent.slice(0, 500)}`,
        additionalContext: `## 当前模板生成的草稿（供参考，可大幅优化和扩展）\n${content}\n\n请输出优化后的完整 tasks.md 内容：`,
        language: 'zh',
      });
      if (llmResult.ok && llmResult.document) {
        content = llmResult.document;
      }
    } catch {
      // LLM 失败时静默回退到模板
    }
  }

  await writeFileSafe(tasksPath, content);

  return {
    ok: true,
    data: {
      summary: `✅ tasks.md generated (${modules.length} modules detected)`,
      path: tasksPath,
      modulesDetected: modules,
      llmEnhanced: llm.isAvailable(),
      llmProvider: llm.getProviderName(),
    },
    warnings: modules.length === 0
      ? ['No modules detected in plan.md, please customize tasks.md manually']
      : [],
    nextActions: [
      'Review tasks.md',
      'Run /implement-executor.implement to start coding',
    ],
  };
}

async function checklist({ projectRoot, specFile }) {
  const cwd = projectRoot || process.cwd();
  const specPath = resolveSpecPath(cwd, specFile);

  const specContent = await readIfExists(specPath);
  if (!specContent) {
    return { ok: false, error: `spec.md not found: ${specPath}`, warnings: [], nextActions: [] };
  }

  // 生成质量检查清单
  const featureDir = path.dirname(specPath);
  const checklistDir = path.join(featureDir, 'checklists');
  await ensureDir(checklistDir);

  const checklistPath = path.join(checklistDir, 'spec-quality.md');
  let checklistContent = `# Spec Quality Checklist

> 自动生成（来自 spec-bootstrap / checklist）

## 需求完备性
- [ ] CHK001 - 所有FR都有对应的User Story
- [ ] CHK002 - 所有P1 Story有Independent Test
- [ ] CHK003 - 所有SC都是可度量指标

## 一致性
- [ ] CHK004 - spec.md与plan.md无冲突
- [ ] CHK005 - data-model.md与plan.md一致

## 可执行性
- [ ] CHK006 - 至少1个P1 Story可作为MVP独立交付
`;

  // 结构化 LLM 增强：使用 generateDocument 生成 checklist
  if (llm.isAvailable()) {
    try {
      const llmResult = await llm.generateDocument({
        type: 'quality checklist',
        customSystem: `你是一位资深 QA 工程师，擅长为产品规格文档生成全面的质量验收检查清单。

你的任务是基于 spec.md 的内容，生成一份结构化的、可执行的质量检查清单（checklist）。

输出要求：
1. 严格遵循以下 Markdown 结构：
   - # Spec Quality Checklist
   - ## 需求完备性（Requirement Completeness）
   - ## 一致性（Consistency）
   - ## 可测试性（Testability）
   - ## 非功能需求（Non-Functional Requirements）
   - ## 边界与异常（Edge Cases & Exceptions）
   - ## 安全与合规（Security & Compliance）
   - ## 可执行性（Executability）

2. 每个检查项格式：
   - - [ ] CHK### - 检查项描述
   - CHK### 为编号（CHK001, CHK002...）

3. 检查项要求：
   - 具体、可验证、无歧义
   - 覆盖 spec.md 中的所有 User Story 和 FR
   - 包含正向和反向检查
   - 包含边界条件和异常情况
   - 包含性能、安全、可用性等非功能性检查

4. 至少生成 20 个检查项，按类别分组

5. 只输出 Markdown 文档内容，不要任何解释性文字`,
        projectName: projectName || 'NewProject',
        description: `spec.md 摘要: ${specContent.slice(0, 500)}`,
        additionalContext: `请基于以上 spec.md 生成全面的质量验收检查清单。\n\n请输出完整的 checklist 内容：`,
        language: 'zh',
      });
      if (llmResult.ok && llmResult.document) {
        checklistContent = llmResult.document;
      }
    } catch {
      // LLM 失败时静默回退到模板
    }
  }

  await writeFileSafe(checklistPath, checklistContent);

  const itemCount = (checklistContent.match(/- \[ \] CHK/g) || []).length;

  return {
    ok: true,
    data: {
      summary: '✅ Checklist generated',
      path: checklistPath,
      itemsCount: itemCount || 7,
      llmEnhanced: llm.isAvailable(),
      llmProvider: llm.getProviderName(),
    },
    warnings: [],
    nextActions: ['Review checklist before implementation'],
  };
}

async function analyze({ projectRoot, feature }) {
  const cwd = projectRoot || process.cwd();
  const featureDir = path.join(cwd, 'specs', feature);
  const specPath = path.join(featureDir, 'spec.md');
  const planPath = path.join(featureDir, 'plan.md');
  const tasksPath = path.join(featureDir, 'tasks.md');

  const [spec, plan, tasks] = await Promise.all([
    readIfExists(specPath),
    readIfExists(planPath),
    readIfExists(tasksPath),
  ]);

  const issues = [];
  const checks = [];

  // 简单一致性检查
  checks.push({
    name: 'spec.md exists',
    ok: !!spec,
    path: specPath,
  });
  checks.push({
    name: 'plan.md exists',
    ok: !!plan,
    path: planPath,
  });
  checks.push({
    name: 'tasks.md exists',
    ok: !!tasks,
    path: tasksPath,
  });

  if (spec && plan) {
    // 检查 plan.md 是否引用了 spec.md
    if (!plan.includes('spec.md')) {
      issues.push({
        severity: 'warn',
        message: 'plan.md does not reference spec.md',
      });
    }
  }

  if (spec && tasks) {
    // 检查 tasks.md 是否覆盖了所有 User Stories
    const storyMatches = spec.match(/US-\d+/g) || [];
    const taskStoryRefs = tasks.match(/\[US\d+\]/g) || [];
    storyMatches.forEach(story => {
      const storyNum = story.replace('US-', '');
      if (!tasks.includes(`[US${storyNum}]`)) {
        issues.push({
          severity: 'warn',
          message: `${story} not referenced in tasks.md`,
        });
      }
    });
  }

  // AST 增强：验证 spec/plan/tasks 中的代码块语法
  const astValidations = {};
  let astEnhanced = false;
  if (spec) {
    astValidations.spec = validateMarkdownCodeBlocksAST(spec, 'spec.md');
    if (astValidations.spec.astEnhanced) astEnhanced = true;
    for (const ib of astValidations.spec.invalidBlocks) {
      issues.push({
        severity: 'warn',
        category: 'code_syntax',
        message: `spec.md code block (line ${ib.startLine}, ${ib.lang}): ${ib.error}`,
      });
    }
  }
  if (plan) {
    astValidations.plan = validateMarkdownCodeBlocksAST(plan, 'plan.md');
    if (astValidations.plan.astEnhanced) astEnhanced = true;
    for (const ib of astValidations.plan.invalidBlocks) {
      issues.push({
        severity: 'warn',
        category: 'code_syntax',
        message: `plan.md code block (line ${ib.startLine}, ${ib.lang}): ${ib.error}`,
      });
    }
  }
  if (tasks) {
    astValidations.tasks = validateMarkdownCodeBlocksAST(tasks, 'tasks.md');
    if (astValidations.tasks.astEnhanced) astEnhanced = true;
    for (const ib of astValidations.tasks.invalidBlocks) {
      issues.push({
        severity: 'warn',
        category: 'code_syntax',
        message: `tasks.md code block (line ${ib.startLine}, ${ib.lang}): ${ib.error}`,
      });
    }
  }

  // LLM 增强：深度分析 spec/plan/tasks 之间的一致性
  if (llm.isAvailable() && spec && plan && tasks) {
    try {
      const llmResult = await llm.callLLM({
        system: `你是一位资深技术审计师，负责分析产品规格文档（spec.md）、技术实现计划（plan.md）和任务列表（tasks.md）之间的一致性。

你的任务是深入对比三份文档，找出不一致、遗漏、矛盾的地方，并给出结构化的分析结果。

输出要求：
1. 只输出 JSON 格式，不要任何解释性文字
2. JSON 结构：
{
  "overallScore": 0-100,
  "issues": [
    {
      "severity": "error|warn|info",
      "category": "需求覆盖|技术匹配|任务遗漏|范围蔓延|依赖缺失|优先级不一致",
      "message": "问题描述",
      "location": "涉及的文档（spec/plan/tasks）",
      "suggestion": "修复建议"
    }
  ],
  "summary": "一句话总结整体一致性状况",
  "strengths": ["做得好的方面1", "做得好的方面2"]
}

3. 重点检查维度：
   - spec 中的每个功能需求是否都在 plan 中有对应的技术方案
   - plan 中的每个模块是否都在 tasks 中有对应的任务
   - tasks 中的任务是否都能追溯到 spec 中的需求
   - 优先级是否一致（P1 需求是否对应 P 级任务）
   - 是否存在计划中出现但 spec 未定义的功能（范围蔓延）
   - 是否存在 spec 定义但 plan/tasks 遗漏的需求
   - 技术选型是否满足 spec 中的非功能性需求
   - 任务粒度是否合理，是否有过大或过小的任务

4. issues 按严重程度排序（error > warn > info）`,
        messages: [{
          role: 'user',
          content: `请分析以下三份文档的一致性：

## spec.md
\`\`\`
${spec}
\`\`\`

## plan.md
\`\`\`
${plan}
\`\`\`

## tasks.md
\`\`\`
${tasks}
\`\`\`

请以 JSON 格式输出一致性分析结果：`
        }],
        temperature: 0.2,
        maxTokens: 3072,
      });
      if (llmResult.ok) {
        try {
          const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : llmResult.content);
          if (parsed.issues && Array.isArray(parsed.issues)) {
            // 将 LLM 发现的问题合并到 issues 列表中
            parsed.issues.forEach(issue => {
              issues.push({
                severity: issue.severity || 'warn',
                message: `[${issue.category || '分析'}] ${issue.message}`,
                location: issue.location || '',
                suggestion: issue.suggestion || '',
              });
            });
          }
        } catch {
          // JSON 解析失败，保持原有启发式结果
        }
      }
    } catch {
      // LLM 失败时静默回退到模板
    }
  }

  const allOk = issues.filter(i => i.severity === 'error').length === 0
    && checks.every(c => c.ok);

  return {
    ok: allOk,
    data: {
      summary: allOk ? '✅ Cross-artifact analysis passed' : '⚠️ Issues found',
      checks,
      issues,
      astEnhanced,
      astValidations: astEnhanced
        ? {
            spec: astValidations.spec ? { totalBlocks: astValidations.spec.totalBlocks, validBlocks: astValidations.spec.validBlocks, invalidCount: astValidations.spec.invalidBlocks.length } : undefined,
            plan: astValidations.plan ? { totalBlocks: astValidations.plan.totalBlocks, validBlocks: astValidations.plan.validBlocks, invalidCount: astValidations.plan.invalidBlocks.length } : undefined,
            tasks: astValidations.tasks ? { totalBlocks: astValidations.tasks.totalBlocks, validBlocks: astValidations.tasks.validBlocks, invalidCount: astValidations.tasks.invalidBlocks.length } : undefined,
          }
        : undefined,
      llmEnhanced: llm.isAvailable(),
      llmProvider: llm.getProviderName(),
    },
    warnings: issues.length > 0 ? [`${issues.length} issues found`] : [],
    nextActions: allOk ? ['Proceed to /implement-executor'] : ['Resolve issues first'],
  };
}

async function implement({ projectRoot, phase, taskId }) {
  // 占位：实际执行由 implement-executor 处理
  return {
    ok: true,
    data: {
      summary: `✅ Task ${taskId} implementation queued (handled by implement-executor)`,
      phase,
      taskId,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: ['This is a dispatcher. Use implement-executor for actual code writing.'],
    nextActions: [
      `Call implement-executor.implement with taskId=${taskId}`,
    ],
  };
}

module.exports = {
  constitution, specify, clarify, plan,
  tasks, checklist, analyze, implement,
  // 命令别名
  default: constitution,
};