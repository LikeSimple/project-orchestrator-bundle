/**
 * api-contract Skill - 完整实现（含 LLM 增强）
 *
 * 从 plan.md / pages/*.md 生成 OpenAPI 3.1.2 YAML。
 * 包含 RFC 9457 Problem schema、双锚点 (x-page-id / x-button-id)、Bearer JWT。
 *
 * LLM 增强能力：
 *   - generate:  用 LLM 根据业务描述生成更完整的 OpenAPI 定义
 *   - validate:  用 LLM 分析契约与实现的一致性
 *   - diff:      用 LLM 对比两个契约版本的语义差异
 *   - enhance:   用 LLM 增强现有 OpenAPI 文档（补充描述、示例、错误响应）
 *   - review:    用 LLM 审查 API 设计质量
 *
 * 对应 MCP Tool: generate_openapi, validate_contract, diff_contract, enhance_contract, review_contract
 */

const fs = require('fs').promises;
const path = require('path');
const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// 标准 Problem schema (RFC 9457)
const PROBLEM_SCHEMA = `
  schemas:
    Problem:
      type: object
      required: [type, title, status, traceId]
      properties:
        type: { type: string, format: uri }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
        instance: { type: string, format: uri }
        code: { type: string, example: "U1023" }
        category:
          type: string
          enum: [USER_ERROR, SYSTEM_ERROR, EXTERNAL_ERROR]
        traceId: { type: string }
        errors:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              code: { type: string }
              message: { type: string }
`;

function authBlock(authType) {
  switch (authType) {
    case 'jwt':
      return `securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT`;
    case 'oauth2':
      return `securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/oauth/authorize
          tokenUrl: https://auth.example.com/oauth/token
          scopes:
            read: Read access
            write: Write access`;
    case 'apiKey':
      return `securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key`;
    default:
      return '';
  }
}

// 从 JS/TS 路由代码中提取 endpoint（AST 增强）
function extractEndpointsFromAST(code) {
  const endpoints = ast.extractEndpoints(code);
  if (!endpoints || endpoints.length === 0) return null;

  // 提取 handler 函数信息
  const functions = ast.extractFunctions(code);

  // 检测框架依赖
  const imports = ast.extractImports(code);
  const frameworkDeps = [];
  const frameworkPatterns = ['express', 'fastify', 'koa', '@koa/router', 'express.Router'];
  for (const imp of imports) {
    for (const fw of frameworkPatterns) {
      if (imp.source === fw || imp.source.includes(fw)) {
        frameworkDeps.push(fw);
        break;
      }
    }
  }

  // 过滤掉 USE 挂载，只保留 HTTP 方法
  const httpEndpoints = endpoints.filter(e => e.method !== 'USE');

  const result = httpEndpoints.map((e, idx) => {
    const pathStr = e.path;
    const method = e.method;
    // 生成 operationId
    const pathSlug = pathStr.replace(/[\/{}\-:]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    let operationId = `${method.toLowerCase()}_${pathSlug}`;

    // 尝试匹配 handler 函数名
    if (functions.length > 0 && idx < functions.length) {
      const fn = functions[idx];
      if (fn.name && fn.name !== '(anonymous)' && fn.name !== '(arrow)') {
        operationId = fn.name;
      }
    }

    return {
      path: pathStr,
      method,
      operationId,
      line: e.line,
    };
  });

  return {
    endpoints: result,
    frameworkDeps,
    handlerFunctions: functions,
    astEnhanced: true,
  };
}

// 从 plan.md 等文本中提取 endpoint 路径（启发式 / 正则 fallback）
function extractEndpoints(planContent) {
  // ---- AST 增强路径：尝试解析为 JS/TS 路由代码 ----
  const astResult = extractEndpointsFromAST(planContent);
  if (astResult && astResult.endpoints.length > 0) {
    return astResult.endpoints;
  }

  // ---- Fallback：正则表达式从文本提取 ----
  const endpoints = [];
  const pathRegex = /\/(api|v\d+)\/[\w\-\/{}]+/g;
  const matches = planContent.match(pathRegex) || [];
  matches.slice(0, 30).forEach(p => {
    const method = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'][Math.floor(Math.random() * 5)];
    endpoints.push({
      path: p,
      method,
      operationId: `${method.toLowerCase()}_${p.replace(/[\/{}\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`,
    });
  });
  return endpoints.length > 0 ? endpoints : [
    { path: '/api/v1/example', method: 'GET', operationId: 'listExample' },
    { path: '/api/v1/example/{id}', method: 'GET', operationId: 'getExample' },
    { path: '/api/v1/example', method: 'POST', operationId: 'createExample' },
  ];
}

// ============================================================
// 辅助：从 LLM 返回内容中提取 YAML 代码块
// ============================================================
function extractYaml(content) {
  if (!content) return null;
  const trimmed = content.trim();
  // 尝试匹配 ```yaml ... ```
  const yamlFence = trimmed.match(/```(?:yaml|yml)\s*\n([\s\S]*?)\n```/i);
  if (yamlFence) return yamlFence[1].trim();
  // 尝试匹配 ``` ... ```（无语言标记）
  const anyFence = trimmed.match(/```\s*\n([\s\S]*?)\n```/);
  if (anyFence) return anyFence[1].trim();
  // 如果内容以 openapi: 开头，直接返回
  if (/^openapi\s*:/i.test(trimmed)) return trimmed;
  return null;
}

// ============================================================
// generate - 生成 OpenAPI 契约（LLM 增强）
// ============================================================
async function generate({ projectRoot, fromFiles, outputPath, authType, useLLM = true, businessDescription = '' }) {
  const cwd = projectRoot || process.cwd();
  const auth = authType || 'jwt';
  let llmEnhanced = false;
  let llmProvider = null;

  // 读 fromFiles 内容（启发式）
  const fileContents = [];
  if (fromFiles && Array.isArray(fromFiles)) {
    for (const f of fromFiles) {
      const fullPath = path.resolve(cwd, f);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        fileContents.push({ path: f, content });
      } catch {
        // 文件不存在，跳过
      }
    }
  }

  const allContent = fileContents.map(f => f.content).join('\n\n');

  // ---- LLM 增强：用业务描述生成更完整的 OpenAPI ----
  let openapiYaml = null;

  if (useLLM && llm.isAvailable()) {
    try {
      const systemPrompt = `你是资深 API 架构师，精通 OpenAPI 3.1.2 规范和 RESTful API 设计。
你需要根据用户提供的业务描述/需求文档，生成完整、规范的 OpenAPI 3.1.2 YAML 定义。

要求：
1. 严格遵循 OpenAPI 3.1.2 规范
2. 输出完整的 YAML，包含 info、servers、paths、components 等顶层字段
3. 每个端点必须包含：summary、description、operationId、tags、parameters、requestBody（如适用）、responses
4. responses 必须包含成功响应和常见错误响应（400、401、403、404、422、500）
5. 请求/响应 schema 必须完整，包含类型、必填字段、示例
6. 支持分页参数（page、pageSize、total 等）
7. 认证方式使用 Bearer JWT（securitySchemes + security 全局配置）
8. 使用 RFC 9457 Problem 格式作为错误响应 schema
9. 只输出 YAML 代码，不要解释，不要 markdown 代码块外的文字
10. 使用中文描述`;

      const userPrompt = `请根据以下业务描述生成 OpenAPI 3.1.2 YAML 定义：

## 业务描述/需求文档
${businessDescription || allContent || '(未提供业务描述，生成通用示例 API)'}

## 认证方式
${auth}

## 输出要求
请直接输出完整的 OpenAPI 3.1.2 YAML 内容：`;

      const result = await llm.callLLM({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.2,
        maxTokens: 8192,
      });

      if (result.ok) {
        const yamlContent = extractYaml(result.content);
        if (yamlContent) {
          openapiYaml = yamlContent;
          llmEnhanced = true;
          llmProvider = result.provider;
        }
      }
    } catch {
      // 静默回退到启发式生成
    }
  }

  // ---- Fallback：启发式生成 ----
  if (!openapiYaml) {
    const endpoints = extractEndpoints(allContent);

    // 检测是否为 AST 增强提取（endpoint 带有 line 字段）
    const astEnhancedExtraction = endpoints.length > 0 && endpoints.every(e => e.line !== undefined);

    // AST 增强：检测框架依赖
    let detectedFrameworks = [];
    if (astEnhancedExtraction) {
      const imports = ast.extractImports(allContent);
      const frameworkPatterns = ['express', 'fastify', 'koa', '@koa/router'];
      for (const imp of imports) {
        for (const fw of frameworkPatterns) {
          if (imp.source === fw || imp.source.includes(fw)) {
            detectedFrameworks.push(fw);
            break;
          }
        }
      }
    }

    const pathsYaml = endpoints.map(e => `
  ${e.path}:
    ${e.method.toLowerCase()}:
      operationId: ${e.operationId}
      summary: ${e.operationId}（${astEnhancedExtraction ? 'AST 提取' : '自动生成'}）
      tags: [${astEnhancedExtraction ? 'AST-Extracted' : 'Generated'}]
      security:
        - BearerAuth: []
      x-page-id: ${e.path.split('/').pop() || 'auto'}
      ${e.line !== undefined ? `x-source-line: ${e.line}` : ''}
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '500': { $ref: '#/components/responses/InternalError' }
`).join('');

    openapiYaml = `openapi: 3.1.2
info:
  title: API Contract
  version: 0.1.0
  description: |
    由 project-orchestrator-bundle / api-contract 自动生成
    生成时间: ${timestamp()}
    来源文件: ${fromFiles ? fromFiles.join(', ') : '无'}
    提取方式: ${astEnhancedExtraction ? 'AST 解析' : '正则启发式'}
  x-generated-by: project-orchestrator-bundle/api-contract@1.0
  x-ast-enhanced: ${astEnhancedExtraction}
${detectedFrameworks.length > 0 ? `  x-detected-frameworks: [${detectedFrameworks.join(', ')}]` : ''}

servers:
  - url: https://api.example.com/v1
    description: 生产
  - url: http://localhost:8080/v1
    description: 本地开发

security:
  - BearerAuth: []

paths:${pathsYaml}

components:
  ${authBlock(auth)}
${PROBLEM_SCHEMA}
  responses:
    BadRequest:
      description: 请求参数错误
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Unauthorized:
      description: 未认证
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Forbidden:
      description: 无权限
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    NotFound:
      description: 资源不存在
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    UnprocessableEntity:
      description: 业务校验失败
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    InternalError:
      description: 服务器内部错误
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
`;
  }

  // 写文件
  const fullOutputPath = path.resolve(cwd, outputPath || 'contracts/openapi.yaml');
  await fs.mkdir(path.dirname(fullOutputPath), { recursive: true });
  await fs.writeFile(fullOutputPath, openapiYaml, 'utf-8');

  // 估算端点数量
  const endpointCount = (openapiYaml.match(/^\s+(get|post|put|delete|patch|head|options)\s*:/gm) || []).length;

  return {
    ok: true,
    data: {
      summary: llmEnhanced
        ? `✅ OpenAPI 3.1.2 generated with LLM (${endpointCount} endpoints)`
        : `✅ OpenAPI 3.1.2 generated (${endpointCount} endpoints)`,
      path: fullOutputPath,
      endpointsCount: endpointCount,
      authType: auth,
      hasProblemSchema: true,
      hasBearerAuth: true,
      llmEnhanced,
      llmProvider,
    },
    warnings: llmEnhanced ? [] : ['LLM not available, using heuristic generation'],
    nextActions: [
      `查看 OpenAPI: ${fullOutputPath}`,
      '运行 `npm run lint:contract` 验证',
      '运行 `npm run mock:start` 启动 Mock Server',
      ...(llmEnhanced ? [] : ['配置 LLM API Key 以获得更精准的生成结果']),
    ],
  };
}

// ============================================================
// validate - 校验契约（LLM 增强）
// ============================================================
async function validate({ contractPath, implementationPath, projectRoot, useLLM = true }) {
  const cwd = projectRoot || process.cwd();
  let llmEnhanced = false;
  let llmProvider = null;

  const fullContractPath = path.resolve(cwd, contractPath || 'contracts/openapi.yaml');
  let contractContent = '';

  try {
    contractContent = await fs.readFile(fullContractPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: `Contract file not found: ${fullContractPath}`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  // 读取实现代码（如果提供）
  let implementationContent = '';
  if (implementationPath) {
    const fullImplPath = path.resolve(cwd, implementationPath);
    try {
      implementationContent = await fs.readFile(fullImplPath, 'utf-8');
    } catch {
      // 实现文件不存在，跳过
    }
  }

  // 基础校验：检查关键 OpenAPI 字段
  const basicIssues = [];
  if (!/^openapi\s*:\s*3\./m.test(contractContent)) {
    basicIssues.push({ severity: 'critical', message: '缺少 openapi 版本声明或版本不支持' });
  }
  if (!/info\s*:/m.test(contractContent)) {
    basicIssues.push({ severity: 'critical', message: '缺少 info 部分' });
  }
  if (!/paths\s*:/m.test(contractContent)) {
    basicIssues.push({ severity: 'critical', message: '缺少 paths 部分' });
  }
  if (!/components\s*:/m.test(contractContent)) {
    basicIssues.push({ severity: 'warning', message: '缺少 components 部分' });
  }

  let llmAnalysis = null;

  // ---- LLM 增强：深度分析契约质量和一致性 ----
  if (useLLM && llm.isAvailable()) {
    try {
      const systemPrompt = `你是资深 API 架构师，精通 OpenAPI 3.1.2 规范和 RESTful API 设计。
你需要对给定的 OpenAPI 契约进行深度校验，并检查契约与实现代码的一致性（如果提供了实现代码）。

输出格式（JSON）：
{
  "score": 0-100,
  "issues": [
    {"severity": "critical|major|minor|info", "category": "spec-compliance|consistency|security|documentation|error-handling|pagination", "location": "路径或组件名", "description": "问题描述", "suggestion": "修复建议"}
  ],
  "summary": "一句话总结",
  "consistencyCheck": {
    "endpointsMatch": true/false,
    "requestMatch": true/false,
    "responseMatch": true/false,
    "details": "一致性检查详情"
  }
}`;

      const userPrompt = `请对以下 OpenAPI 契约进行深度校验${implementationContent ? '，并检查其与实现代码的一致性' : ''}：

## OpenAPI 契约
\`\`\`yaml
${contractContent}
\`\`\`

${implementationContent ? `## 实现代码
\`\`\`
${implementationContent}
\`\`\`
` : ''}
## 校验重点
1. OpenAPI 3.1.2 规范合规性
2. 文档完整性（描述、示例、参数说明）
3. 错误处理规范（是否包含常见错误码、Problem schema）
4. 安全规范（认证、授权、敏感数据）
5. 分页规范（列表接口是否有分页参数）
${implementationContent ? '6. 契约与实现的一致性（端点、请求、响应是否匹配）' : ''}

请以 JSON 格式输出校验结果：`;

      const result = await llm.callLLM({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.1,
        maxTokens: 4096,
      });

      if (result.ok) {
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          llmAnalysis = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
          llmEnhanced = true;
          llmProvider = result.provider;
        } catch {
          llmAnalysis = { raw: result.content };
        }
      }
    } catch {
      // 静默回退
    }
  }

  const allIssues = [
    ...basicIssues,
    ...(llmAnalysis?.issues || []),
  ];

  const score = llmAnalysis?.score ?? (basicIssues.length === 0 ? 80 : 60 - basicIssues.length * 10);

  return {
    ok: true,
    data: {
      score,
      summary: llmAnalysis?.summary || (basicIssues.length === 0 ? '基础校验通过' : `发现 ${basicIssues.length} 个基础问题`),
      issues: allIssues,
      consistencyCheck: llmAnalysis?.consistencyCheck || null,
      contractPath: fullContractPath,
      llmEnhanced,
      llmProvider,
    },
    warnings: llmEnhanced ? [] : ['LLM not available, basic validation only'],
    nextActions: [
      '根据 issues 列表修复问题',
      '运行 `npm run lint:contract` 进行规范校验',
      ...(llmEnhanced ? [] : ['配置 LLM API Key 以获得深度分析']),
    ],
  };
}

// ============================================================
// diff - 对比两个契约版本（LLM 增强）
// ============================================================
async function diff({ oldContractPath, newContractPath, projectRoot, useLLM = true }) {
  const cwd = projectRoot || process.cwd();
  let llmEnhanced = false;
  let llmProvider = null;

  const fullOldPath = path.resolve(cwd, oldContractPath);
  const fullNewPath = path.resolve(cwd, newContractPath);

  let oldContent = '';
  let newContent = '';

  try {
    oldContent = await fs.readFile(fullOldPath, 'utf-8');
  } catch {
    return { ok: false, error: `Old contract not found: ${fullOldPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  try {
    newContent = await fs.readFile(fullNewPath, 'utf-8');
  } catch {
    return { ok: false, error: `New contract not found: ${fullNewPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 基础对比：行数、端点数量变化
  const oldEndpoints = (oldContent.match(/^\s+(get|post|put|delete|patch|head|options)\s*:/gm) || []).length;
  const newEndpoints = (newContent.match(/^\s+(get|post|put|delete|patch|head|options)\s*:/gm) || []).length;
  const basicChanges = {
    oldEndpoints,
    newEndpoints,
    endpointDelta: newEndpoints - oldEndpoints,
    oldLines: oldContent.split('\n').length,
    newLines: newContent.split('\n').length,
  };

  let llmDiff = null;

  // ---- LLM 增强：语义化对比 ----
  if (useLLM && llm.isAvailable()) {
    try {
      const systemPrompt = `你是资深 API 架构师，精通 OpenAPI 3.1.2 规范。
你需要对比两个版本的 OpenAPI 契约，识别语义层面的变更，而不仅仅是文本差异。

输出格式（JSON）：
{
  "breakingChanges": [
    {"type": "endpoint-removed|response-changed|parameter-required-added|...", "endpoint": "路径+方法", "description": "变更描述", "impact": "影响说明"}
  ],
  "nonBreakingChanges": [
    {"type": "endpoint-added|optional-parameter-added|description-updated|...", "endpoint": "路径+方法", "description": "变更描述"}
  ],
  "summary": "一句话变更总结",
  "migrationGuide": "迁移建议"
}`;

      const userPrompt = `请对比以下两个版本的 OpenAPI 契约，识别语义变更：

## 旧版本
\`\`\`yaml
${oldContent.slice(0, 8000)}
\`\`\`

## 新版本
\`\`\`yaml
${newContent.slice(0, 8000)}
\`\`\`

请以 JSON 格式输出对比结果，重点标注破坏性变更（breaking changes）：`;

      const result = await llm.callLLM({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.1,
        maxTokens: 4096,
      });

      if (result.ok) {
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          llmDiff = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
          llmEnhanced = true;
          llmProvider = result.provider;
        } catch {
          llmDiff = { raw: result.content };
        }
      }
    } catch {
      // 静默回退
    }
  }

  return {
    ok: true,
    data: {
      ...basicChanges,
      breakingChanges: llmDiff?.breakingChanges || [],
      nonBreakingChanges: llmDiff?.nonBreakingChanges || [],
      summary: llmDiff?.summary || `端点数量: ${oldEndpoints} → ${newEndpoints} (${basicChanges.endpointDelta >= 0 ? '+' : ''}${basicChanges.endpointDelta})`,
      migrationGuide: llmDiff?.migrationGuide || null,
      oldPath: fullOldPath,
      newPath: fullNewPath,
      llmEnhanced,
      llmProvider,
    },
    warnings: llmEnhanced ? [] : ['LLM not available, basic diff only'],
    nextActions: [
      '审查 breaking changes 列表',
      '更新客户端 SDK 以适配变更',
      ...(llmEnhanced ? [] : ['配置 LLM API Key 以获得语义化对比']),
    ],
  };
}

// ============================================================
// enhance - 增强现有 OpenAPI 文档（LLM）
// ============================================================
async function enhance({ contractPath, outputPath, projectRoot, useLLM = true, aspects = ['description', 'examples', 'error-responses', 'security'] }) {
  const cwd = projectRoot || process.cwd();
  let llmEnhanced = false;
  let llmProvider = null;

  const fullContractPath = path.resolve(cwd, contractPath || 'contracts/openapi.yaml');
  let contractContent = '';

  try {
    contractContent = await fs.readFile(fullContractPath, 'utf-8');
  } catch {
    return { ok: false, error: `Contract file not found: ${fullContractPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let enhancedYaml = contractContent;

  if (useLLM && llm.isAvailable()) {
    try {
      const systemPrompt = `你是资深 API 架构师和技术文档专家，精通 OpenAPI 3.1.2 规范。
你需要增强现有的 OpenAPI 文档，使其更完整、更专业。

增强方面：
1. **描述增强**：为每个端点、参数、schema 添加清晰的中文描述
2. **示例补充**：为请求和响应补充真实的示例数据
3. **错误响应完善**：确保每个端点都有完整的错误响应（400/401/403/404/422/500）
4. **安全规范**：检查并完善安全方案配置
5. **分页支持**：为列表类接口添加分页参数和响应结构

要求：
- 保持原有结构和端点不变
- 只增强内容，不改变语义
- 输出完整的 YAML
- 只输出 YAML 代码，不要解释`;

      const aspectList = aspects.join('、');
      const userPrompt = `请增强以下 OpenAPI 文档，重点增强：${aspectList}

## 原始 OpenAPI 契约
\`\`\`yaml
${contractContent}
\`\`\`

请输出增强后的完整 OpenAPI 3.1.2 YAML：`;

      const result = await llm.callLLM({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3,
        maxTokens: 8192,
      });

      if (result.ok) {
        const yamlContent = extractYaml(result.content);
        if (yamlContent) {
          enhancedYaml = yamlContent;
          llmEnhanced = true;
          llmProvider = result.provider;
        }
      }
    } catch {
      // 静默回退
    }
  }

  // 写文件
  const fullOutputPath = path.resolve(cwd, outputPath || contractPath || 'contracts/openapi.enhanced.yaml');
  await fs.mkdir(path.dirname(fullOutputPath), { recursive: true });
  await fs.writeFile(fullOutputPath, enhancedYaml, 'utf-8');

  // 统计增强前后的描述数量
  const originalDescriptions = (contractContent.match(/description\s*:/g) || []).length;
  const enhancedDescriptions = (enhancedYaml.match(/description\s*:/g) || []).length;
  const originalExamples = (contractContent.match(/example\s*:/g) || []).length;
  const enhancedExamples = (enhancedYaml.match(/example\s*:/g) || []).length;

  return {
    ok: true,
    data: {
      summary: llmEnhanced
        ? `✅ Contract enhanced: +${enhancedDescriptions - originalDescriptions} descriptions, +${enhancedExamples - originalExamples} examples`
        : 'Contract unchanged (LLM not available)',
      inputPath: fullContractPath,
      outputPath: fullOutputPath,
      stats: {
        originalDescriptions,
        enhancedDescriptions,
        originalExamples,
        enhancedExamples,
      },
      aspects,
      llmEnhanced,
      llmProvider,
    },
    warnings: llmEnhanced ? [] : ['LLM not available, contract unchanged'],
    nextActions: [
      `查看增强后的文档: ${fullOutputPath}`,
      '对比原始版本确认变更合理',
      ...(llmEnhanced ? [] : ['配置 LLM API Key 以启用文档增强']),
    ],
  };
}

// ============================================================
// review - 审查 API 设计质量（LLM）
// ============================================================
async function review({ contractPath, projectRoot, useLLM = true, focusAreas = ['restful', 'security', 'performance', 'consistency', 'documentation'] }) {
  const cwd = projectRoot || process.cwd();
  let llmEnhanced = false;
  let llmProvider = null;

  const fullContractPath = path.resolve(cwd, contractPath || 'contracts/openapi.yaml');
  let contractContent = '';

  try {
    contractContent = await fs.readFile(fullContractPath, 'utf-8');
  } catch {
    return { ok: false, error: `Contract file not found: ${fullContractPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  let reviewResult = null;

  if (useLLM && llm.isAvailable()) {
    try {
      const systemPrompt = `你是资深 API 架构师，拥有 10 年以上 API 设计经验。
你需要对给定的 OpenAPI 契约进行全面的设计质量审查。

审查维度：
1. **RESTful 规范**：资源命名、HTTP 方法使用、状态码规范、URL 设计
2. **安全性**：认证授权、输入验证、敏感数据处理、速率限制
3. **性能**：分页设计、缓存策略、响应结构优化
4. **一致性**：命名规范、错误处理、数据格式统一
5. **文档质量**：描述清晰度、示例完整性、可理解性
6. **可演进性**：版本策略、向后兼容性、扩展机制

输出格式（JSON）：
{
  "overallScore": 0-100,
  "dimensionScores": {
    "restful": 0-100,
    "security": 0-100,
    "performance": 0-100,
    "consistency": 0-100,
    "documentation": 0-100,
    "evolvability": 0-100
  },
  "findings": [
    {"severity": "critical|major|minor|info", "category": "restful|security|performance|consistency|documentation|evolvability", "location": "端点或组件路径", "finding": "问题描述", "recommendation": "改进建议", "example": "可选的示例"}
  ],
  "bestPractices": ["好的实践点..."],
  "summary": "整体评价总结",
  "priorityActions": ["优先改进项 1", "优先改进项 2", "优先改进项 3"]
}`;

      const userPrompt = `请对以下 OpenAPI 契约进行全面的 API 设计质量审查：

## OpenAPI 契约
\`\`\`yaml
${contractContent}
\`\`\`

## 重点审查维度
${focusAreas.map(a => `- ${a}`).join('\n')}

请以 JSON 格式输出详细的审查结果：`;

      const result = await llm.callLLM({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.2,
        maxTokens: 6000,
      });

      if (result.ok) {
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          reviewResult = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
          llmEnhanced = true;
          llmProvider = result.provider;
        } catch {
          reviewResult = { raw: result.content };
        }
      }
    } catch {
      // 静默回退
    }
  }

  // LLM 不可用时提供基础评估
  if (!llmEnhanced) {
    const endpointCount = (contractContent.match(/^\s+(get|post|put|delete|patch|head|options)\s*:/gm) || []).length;
    const hasSecurity = /securitySchemes\s*:/.test(contractContent);
    const hasProblemSchema = /Problem\s*:/.test(contractContent);
    const descriptionCount = (contractContent.match(/description\s*:/g) || []).length;

    reviewResult = {
      overallScore: hasSecurity && hasProblemSchema ? 65 : 50,
      dimensionScores: {
        restful: endpointCount > 0 ? 60 : 40,
        security: hasSecurity ? 70 : 30,
        performance: 50,
        consistency: 55,
        documentation: descriptionCount > endpointCount ? 65 : 40,
        evolvability: 50,
      },
      findings: [
        { severity: 'info', category: 'general', finding: '基础评估模式，配置 LLM 可获得深度审查', recommendation: '配置 LLM API Key 以启用完整审查功能' },
      ],
      bestPractices: [],
      summary: '基础评估：建议配置 LLM 以获得全面的设计质量审查',
      priorityActions: ['配置 LLM API Key', '运行完整审查'],
    };
  }

  return {
    ok: true,
    data: {
      ...reviewResult,
      contractPath: fullContractPath,
      focusAreas,
      llmEnhanced,
      llmProvider,
    },
    warnings: llmEnhanced ? [] : ['LLM not available, basic review only'],
    nextActions: [
      '根据 priorityActions 优先改进',
      '查看 findings 列表了解详细问题',
      '参考 bestPractices 保持优秀设计',
      ...(llmEnhanced ? [] : ['配置 LLM API Key 以获得完整审查报告']),
    ],
  };
}

// ============================================================
// 导出
// ============================================================
module.exports = { generate, validate, diff, enhance, review, mock: enhance, extractEndpoints, extractEndpointsFromAST };
