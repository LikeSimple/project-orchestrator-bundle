/**
 * LLM Client - 统一 LLM 调用层（方案B：MCP Sampling 优先 + 直连 Provider 降级）
 *
 * LLM 来源优先级：
 *   1. MCP Sampling（当 Skill 由 MCP Server fork 出来时，通过 IPC 向 TRAE Agent 请求 LLM）
 *   2. 直连 Provider（按 API key 自动检测）：
 *      a. anthropic  (ANTHROPIC_API_KEY)
 *      b. openai     (OPENAI_API_KEY)
 *      c. deepseek   (DEEPSEEK_API_KEY)
 *      d. qwen       (DASHSCOPE_API_KEY) - 通义千问
 *      e. moonshot   (MOONSHOT_API_KEY) - 月之暗面
 *      f. custom     (LLM_BASE_URL + LLM_API_KEY + LLM_MODEL)
 *
 * 没有任何 LLM 来源时：fallback 到模板生成模式（不报错，生成占位代码）
 *
 * 用法：
 *   const llm = require('./lib/llm-client');
 *   const result = await llm.generateCode({ task: '...', context: '...' });
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============================================================
// MCP Sampling：通过 IPC 向 MCP Server 转发 LLM 请求到 TRAE Agent
// ============================================================

let _llmRequestId = 0;
const _pendingLLMRequests = new Map();

function isMCPSamplingAvailable() {
  return process.env.MCP_SAMPLING_ENABLED === '1' && typeof process.send === 'function';
}

if (typeof process.send === 'function') {
  process.on('message', (msg) => {
    if (msg && msg.type === 'llm:response' && _pendingLLMRequests.has(msg.id)) {
      const pending = _pendingLLMRequests.get(msg.id);
      _pendingLLMRequests.delete(msg.id);
      if (msg.ok) {
        pending.resolve({ content: msg.content || '', model: msg.model || 'trae-agent' });
      } else {
        pending.reject(new Error(msg.error || 'MCP sampling failed'));
      }
    }
  });
}

async function callViaMCPSampling({
  system = '',
  messages = [],
  maxTokens = 4096,
  temperature = 0.2,
} = {}) {
  if (!isMCPSamplingAvailable()) {
    return { ok: false, error: 'MCP sampling not available' };
  }

  const id = ++_llmRequestId;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingLLMRequests.delete(id);
      reject(new Error('MCP sampling timeout after 120s'));
    }, 120000);

    _pendingLLMRequests.set(id, {
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });

    process.send({
      type: 'llm:request',
      id,
      system: system || undefined,
      messages,
      maxTokens: maxTokens || 4096,
      temperature,
    });
  });
}

// ============================================================
// Provider 配置
// ============================================================

const PROVIDERS = [
  {
    name: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-sonnet-20241022',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }),
    formatBody: (system, messages, model, maxTokens, temperature) => ({
      model,
      system,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    extractContent: (data) => {
      // Anthropic: content[0].text
      if (data.content && data.content[0]?.text) return data.content[0].text;
      if (data.error) throw new Error(`Anthropic API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error('Unexpected Anthropic response format');
    },
    extractUsage: (data) => ({
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    }),
  },
  {
    name: 'openai-compatible',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    }),
    formatBody: (system, messages, model, maxTokens, temperature) => ({
      model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: maxTokens,
      temperature,
    }),
    extractContent: (data) => {
      // OpenAI-compatible: choices[0].message.content
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      if (data.error) throw new Error(`OpenAI API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error('Unexpected OpenAI response format');
    },
    extractUsage: (data) => ({
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    }),
  },
  {
    name: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    }),
    formatBody: (system, messages, model, maxTokens, temperature) => ({
      model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: maxTokens,
      temperature,
    }),
    extractContent: (data) => {
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      if (data.error) throw new Error(`DeepSeek API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error('Unexpected DeepSeek response format');
    },
    extractUsage: (data) => ({
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    }),
  },
  {
    name: 'qwen',
    envKey: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    }),
    formatBody: (system, messages, model, maxTokens, temperature) => ({
      model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: maxTokens,
      temperature,
    }),
    extractContent: (data) => {
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      if (data.code) throw new Error(`Qwen API error: ${data.message || data.code}`);
      throw new Error('Unexpected Qwen response format');
    },
    extractUsage: (data) => ({
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    }),
  },
  {
    name: 'moonshot',
    envKey: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    }),
    formatBody: (system, messages, model, maxTokens, temperature) => ({
      model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: maxTokens,
      temperature,
    }),
    extractContent: (data) => {
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      if (data.error) throw new Error(`Moonshot API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error('Unexpected Moonshot response format');
    },
    extractUsage: (data) => ({
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    }),
  },
  {
    name: 'custom',
    envKey: 'LLM_API_KEY',
    baseUrlEnv: 'LLM_BASE_URL',
    modelEnv: 'LLM_MODEL',
    defaultModel: 'gpt-4o-mini',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    }),
    formatBody: (system, messages, model, maxTokens, temperature) => ({
      model,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      max_tokens: maxTokens,
      temperature,
    }),
    extractContent: (data) => {
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      if (data.error) throw new Error(`LLM API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error('Unexpected LLM response format');
    },
    extractUsage: (data) => ({
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    }),
  },
];

// ============================================================
// 自动检测可用 Provider
// ============================================================

function detectProvider() {
  // 优先使用显式指定的 provider
  const explicit = process.env.LLM_PROVIDER;
  if (explicit) {
    const provider = PROVIDERS.find(p => p.name === explicit);
    if (provider) {
      const apiKey = process.env[provider.envKey];
      if (apiKey) return { provider, apiKey };
    }
  }

  // 自动检测
  for (const provider of PROVIDERS) {
    const apiKey = process.env[provider.envKey];
    if (apiKey) {
      return { provider, apiKey };
    }
  }

  return null; // 没有可用的 provider
}

// ============================================================
// HTTP 请求工具
// ============================================================

function postJson(urlStr, headers, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === 'https:' ? https : http;

    const data = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: timeoutMs,
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 500)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${e.message}. Body: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    req.write(data);
    req.end();
  });
}

// ============================================================
// 核心：调用 LLM
// ============================================================

async function callLLM({
  system = '',
  messages = [],
  model = null,
  maxTokens = 4096,
  temperature = 0.2,
  timeoutMs = 120000,
} = {}) {
  // 方案B：优先使用 MCP sampling（通过 TRAE Agent 框架的 LLM）
  if (isMCPSamplingAvailable()) {
    try {
      const result = await callViaMCPSampling({
        system,
        messages,
        maxTokens,
        temperature,
      });
      return {
        ok: true,
        content: result.content,
        provider: 'mcp-sampling',
        model: result.model || 'trae-agent',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    } catch (err) {
      // MCP sampling 失败，fallback 到直连 provider
    }
  }

  const detected = detectProvider();

  if (!detected) {
    // 没有 API key，返回 null 让调用方自己 fallback
    return {
      ok: false,
      error: 'No LLM provider configured. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, DASHSCOPE_API_KEY, MOONSHOT_API_KEY, or LLM_BASE_URL + LLM_API_KEY.',
      provider: null,
    };
  }

  const { provider, apiKey } = detected;

  // 确定 baseUrl
  let baseUrl = provider.baseUrl;
  if (provider.baseUrlEnv && process.env[provider.baseUrlEnv]) {
    baseUrl = process.env[provider.baseUrlEnv];
  }

  // 确定 model
  const modelName = model || process.env[provider.modelEnv || 'LLM_MODEL'] || provider.defaultModel;

  try {
    const headers = provider.headers(apiKey);
    const body = provider.formatBody(system, messages, modelName, maxTokens, temperature);

    const data = await postJson(baseUrl, headers, body, timeoutMs);
    const content = provider.extractContent(data);
    const usage = provider.extractUsage(data);

    return {
      ok: true,
      content,
      provider: provider.name,
      model: modelName,
      usage,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      provider: provider.name,
    };
  }
}

// ============================================================
// 便捷方法：生成代码
// ============================================================

async function generateCode({
  taskDescription,
  codePatterns = '',
  existingCode = '',
  targetFile = '',
  language = 'typescript',
  additionalContext = '',
} = {}) {
  const system = `你是一个资深软件工程师，负责编写高质量的生产级代码。

输出要求：
1. 只输出代码，不要解释，不要 markdown 代码块标记，不要前后缀说明
2. 代码必须完整、可直接运行
3. 遵循用户提供的代码规范和最佳实践
4. 包含必要的错误处理、类型定义和注释
5. 严格遵循代码规范中的命名约定、文件结构和设计模式`;

  let userMsg = `请实现以下任务的代码：

## 任务描述
${taskDescription}

## 目标文件
${targetFile || '(未指定)'}

## 编程语言
${language}
`;

  if (codePatterns) {
    userMsg += `
## 代码规范（必须严格遵守）
\`\`\`
${codePatterns}
\`\`\`
`;
  }

  if (existingCode) {
    userMsg += `
## 现有代码（基于此修改，不要重写整个文件）
\`\`\`${language}
${existingCode}
\`\`\`
`;
  }

  if (additionalContext) {
    userMsg += `
## 额外上下文
${additionalContext}
`;
  }

  userMsg += `
现在请直接输出完整的代码文件内容：`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.2,
    maxTokens: 8192,
  });

  if (!result.ok) {
    return result; // 让调用方处理 fallback
  }

  // 清理：去掉可能的 markdown 代码块标记
  let code = result.content.trim();
  const fenceMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    code = fenceMatch[1].trim();
  }

  return {
    ...result,
    code,
  };
}

// ============================================================
// 便捷方法：生成测试用例
// ============================================================

async function generateTests({
  sourceCode,
  testFramework = 'vitest',
  targetFile = '',
  language = 'typescript',
} = {}) {
  const system = `你是一个资深测试工程师。为给定的源代码生成完整的单元测试。

要求：
1. 只输出测试代码，不要解释
2. 覆盖主要路径和边界条件
3. 使用 ${testFramework} 框架
4. 包含 positive / negative 测试用例
5. 测试描述清晰、语义化`;

  const userMsg = `请为以下源代码生成单元测试：

## 目标测试文件
${targetFile}

## 源代码
\`\`\`${language}
${sourceCode}
\`\`\`

## 测试框架
${testFramework}

请直接输出完整的测试代码：`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.3,
    maxTokens: 4096,
  });

  if (!result.ok) return result;

  let code = result.content.trim();
  const fenceMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) code = fenceMatch[1].trim();

  return { ...result, code };
}

// ============================================================
// 便捷方法：代码审查
// ============================================================

async function reviewCode({
  code,
  codePatterns = '',
  language = 'typescript',
  checklist = [],
} = {}) {
  const system = `你是一个资深代码审查工程师。对给定代码进行严格审查，输出结构化的评审意见。

输出格式要求（JSON）：
{
  "score": 0-100,
  "issues": [
    {"severity": "critical|major|minor|info", "category": "security|performance|readability|maintainability|consistency", "line": "行号或范围", "description": "问题描述", "suggestion": "修复建议"}
  ],
  "summary": "一句话总结"
}`;

  let userMsg = `请审查以下代码：

## 代码
\`\`\`${language}
${code}
\`\`\`
`;

  if (codePatterns) {
    userMsg += `
## 代码规范
\`\`\`
${codePatterns}
\`\`\`
`;
  }

  if (checklist.length > 0) {
    userMsg += `
## 重点检查项
${checklist.map(c => `- ${c}`).join('\n')}
`;
  }

  userMsg += `
请以 JSON 格式输出审查结果：`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 4096,
  });

  if (!result.ok) return result;

  // 尝试解析 JSON
  let review;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    review = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    review = {
      score: 50,
      issues: [],
      summary: 'Failed to parse review result as JSON',
      raw: result.content,
    };
  }

  return { ...result, review };
}

// ============================================================
// 便捷方法：生成提交信息
// ============================================================

async function generateCommitMessage({
  diff = '',
  stagedFiles = [],
  convention = 'conventional',
  language = 'en',
} = {}) {
  const system = `You are an expert software engineer who writes concise, meaningful git commit messages.

Rules:
1. Follow ${convention} commit convention (type(scope): subject)
2. Subject line max 72 characters
3. Body explains WHAT and WHY, not HOW
4. Use imperative mood ("add", "fix", "refactor")
5. Language: ${language}
6. Output ONLY the commit message, no explanation`;

  let userMsg = `Generate a commit message for the following changes:

## Staged Files
${stagedFiles.length > 0 ? stagedFiles.map(f => `- ${f}`).join('\n') : '(see diff)'}

## Diff (truncated to 3000 chars)
\`\`\`diff
${diff.slice(0, 3000)}
\`\`\`

Output the commit message:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 512,
  });

  if (!result.ok) return result;

  let message = result.content.trim();
  const fenceMatch = message.match(/```[a-z]*\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) message = fenceMatch[1].trim();

  return { ...result, message };
}

// ============================================================
// 便捷方法：分析代码模式
// ============================================================

async function analyzeCodePatterns({
  code = '',
  filePath = '',
  framework = '',
  existingPatterns = [],
} = {}) {
  const system = `You are a software architect specializing in design pattern identification.

Analyze the given code and identify which design patterns are used or could be applied.

Output format (JSON):
{
  "detected": [
    {"pattern": "PatternName", "location": "line or function", "confidence": 0.0-1.0, "evidence": "why"}
  ],
  "suggested": [
    {"pattern": "PatternName", "reason": "why it fits", "benefit": "what improves", "priority": "high|medium|low"}
  ],
  "summary": "one-line code structure assessment"
}`;

  let userMsg = `Analyze this code for design patterns:

## File
${filePath || '(unnamed)'}

## Framework
${framework || '(unspecified)'}

## Existing Patterns Applied
${existingPatterns.length > 0 ? existingPatterns.map(p => `- ${p}`).join('\n') : '(none)'}

## Code
\`\`\`
${code.slice(0, 4000)}
\`\`\`

Output JSON:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 2048,
  });

  if (!result.ok) return result;

  let analysis;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    analysis = {
      detected: [],
      suggested: [],
      summary: 'Failed to parse LLM response as JSON',
      raw: result.content,
    };
  }

  return { ...result, analysis };
}

// ============================================================
// 便捷方法：安全审计分析
// ============================================================

async function analyzeSecurity({
  code = '',
  filePath = '',
  fileType = 'javascript',
  astFindings = [],
  checklist = [],
} = {}) {
  const system = `You are a senior security engineer performing code-level security audits.

Focus areas: OWASP Top 10, hardcoded secrets, injection risks, XSS, auth bypass, insecure deserialization.

Output format (JSON):
{
  "score": 0-100,
  "findings": [
    {"severity": "critical|high|medium|low|info", "type": "CWE-xxx or category", "line": "line number or range", "description": "what's wrong", "remediation": "how to fix", "confidence": 0.0-1.0}
  ],
  "summary": "one-line security assessment"
}`;

  let userMsg = `Perform a security audit on this code:

## File
${filePath || '(unnamed)'} (${fileType})

## AST-Based Findings (pre-detected)
${astFindings.length > 0 ? astFindings.map(f => `- [${f.type || 'issue'}] Line ${f.line || '?'}: ${f.description || f.message || JSON.stringify(f)}`).join('\n') : '(none)'}

## Security Checklist
${checklist.length > 0 ? checklist.map(c => `- ${c}`).join('\n') : '(standard OWASP checks)'}

## Code
\`\`\`${fileType}
${code.slice(0, 4000)}
\`\`\`

Output JSON:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 2048,
  });

  if (!result.ok) return result;

  let audit;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    audit = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    audit = {
      score: 50,
      findings: [],
      summary: 'Failed to parse LLM response as JSON',
      raw: result.content,
    };
  }

  return { ...result, audit };
}

// ============================================================
// 便捷方法：依赖风险评估
// ============================================================

async function analyzeDependencyRisk({
  dependencies = [],
  devDependencies = [],
  auditData = null,
  outdated = [],
  projectType = '',
} = {}) {
  const system = `You are a dependency management expert and supply chain security analyst.

Analyze project dependencies for: security risks, license issues, maintenance status, version risks, unnecessary deps.

Output format (JSON):
{
  "healthScore": 0-100,
  "risks": [
    {"package": "name", "severity": "critical|high|medium|low", "category": "security|license|maintenance|version|bloat", "description": "what's risky", "recommendation": "action to take"}
  ],
  "recommendations": ["prioritized action items"],
  "summary": "one-line dependency health assessment"
}`;

  let userMsg = `Analyze the dependency health of this project:

## Project Type
${projectType || '(unspecified)'}

## Dependencies (${dependencies.length})
${dependencies.map(d => `- ${d.name || d}@${d.version || '?'}`).join('\n')}

## Dev Dependencies (${devDependencies.length})
${devDependencies.map(d => `- ${d.name || d}@${d.version || '?'}`).join('\n')}

## npm audit Results
${auditData ? JSON.stringify(auditData, null, 2).slice(0, 2000) : '(not available)'}

## Outdated Packages
${outdated.length > 0 ? outdated.map(o => `- ${o.name || o}: ${o.current || '?'} -> ${o.latest || '?'}`).join('\n') : '(none)'}

Output JSON:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 2048,
  });

  if (!result.ok) return result;

  let analysis;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    analysis = {
      healthScore: 50,
      risks: [],
      recommendations: [],
      summary: 'Failed to parse LLM response as JSON',
      raw: result.content,
    };
  }

  return { ...result, analysis };
}

// ============================================================
// 便捷方法：生成文档
// ============================================================

async function generateDocument({
  type = 'readme',
  projectName = '',
  description = '',
  techStack = [],
  features = [],
  apiEndpoints = [],
  additionalContext = '',
  language = 'en',
} = {}) {
  const docTypes = {
    readme: 'README.md',
    contributing: 'CONTRIBUTING.md',
    changelog: 'CHANGELOG.md',
    architecture: 'ARCHITECTURE.md',
  };

  const system = `You are a technical writer creating professional ${docTypes[type] || type} documentation.

Rules:
1. Write in ${language}
2. Use clear Markdown formatting with headers, lists, code blocks
3. Be concise but complete
4. Include practical examples where relevant
5. Output ONLY the document content, no meta-commentary`;

  let userMsg = `Generate a ${docTypes[type] || type} for this project:

## Project Name
${projectName || '(unnamed)'}

## Description
${description || '(no description provided)'}

## Tech Stack
${techStack.length > 0 ? techStack.map(t => `- ${t}`).join('\n') : '(unspecified)'}

## Features
${features.length > 0 ? features.map(f => `- ${f}`).join('\n') : '(none listed)'}

## API Endpoints
${apiEndpoints.length > 0 ? apiEndpoints.map(e => `- ${e.method || 'GET'} ${e.path || e} - ${e.description || ''}`).join('\n') : '(none)'}

${additionalContext ? `## Additional Context\n${additionalContext}` : ''}

Output the document:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.3,
    maxTokens: 4096,
  });

  if (!result.ok) return result;

  let content = result.content.trim();
  const fenceMatch = content.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) content = fenceMatch[1].trim();

  return { ...result, document: content };
}

// ============================================================
// 便捷方法：环境配置安全分析
// ============================================================

async function analyzeEnvSecurity({
  envVars = {},
  sensitiveKeys = [],
  fileContents = '',
  astFindings = [],
  env = 'dev',
} = {}) {
  const system = `You are a DevSecOps engineer specializing in environment configuration security.

Analyze for: hardcoded secrets, missing encryption, insecure defaults, permission issues, secret rotation needs.

Output format (JSON):
{
  "score": 0-100,
  "issues": [
    {"severity": "critical|high|medium|low", "type": "hardcoded-secret|insecure-default|permission|rotation|missing", "key": "env var name", "description": "what's wrong", "remediation": "how to fix"}
  ],
  "recommendations": ["prioritized action items"],
  "summary": "one-line env security assessment"
}`;

  const maskedVars = Object.entries(envVars).reduce((acc, [k, v]) => {
    acc[k] = sensitiveKeys.includes(k) ? '***MASKED***' : v;
    return acc;
  }, {});

  let userMsg = `Analyze environment configuration security:

## Environment
${env}

## Environment Variables (sensitive values masked)
${Object.entries(maskedVars).map(([k, v]) => `- ${k}=${v}`).join('\n') || '(none)'}

## AST-Based Findings
${astFindings.length > 0 ? astFindings.map(f => `- [${f.type}] ${f.key || ''}: ${f.description || f.message || ''}`).join('\n') : '(none)'}

## .env File Content (sensitive values masked)
\`\`\`
${fileContents.slice(0, 2000)}
\`\`\`

Output JSON:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 2048,
  });

  if (!result.ok) return result;

  let analysis;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    analysis = {
      score: 50,
      issues: [],
      recommendations: [],
      summary: 'Failed to parse LLM response as JSON',
      raw: result.content,
    };
  }

  return { ...result, analysis };
}

// ============================================================
// 便捷方法：错误分析
// ============================================================

async function analyzeError({
  error = '',
  stackTrace = '',
  codeContext = '',
  filePath = '',
  language = 'javascript',
  logContext = '',
} = {}) {
  const system = `You are a senior debug engineer specializing in root cause analysis of software errors.

Analyze the error, stack trace, and code context to determine root cause and provide fix suggestions.

Output format (JSON):
{
  "rootCause": "one-line description of the root cause",
  "errorType": "TypeError|ReferenceError|SyntaxError|RuntimeError|LogicError|Other",
  "severity": "critical|high|medium|low",
  "category": "null-reference|type-mismatch|missing-import|async-issue|boundary|security|config|other",
  "fixSteps": [
    {"step": 1, "action": "specific fix action", "code": "code snippet if applicable"}
  ],
  "prevention": ["how to prevent this class of error"],
  "confidence": 0.0-1.0,
  "summary": "one-line diagnosis"
}`;

  let userMsg = `Analyze this error:

## Error
\`\`\`
${error.slice(0, 1000)}
\`\`\`

## Stack Trace
\`\`\`
${(stackTrace || '(none provided)').slice(0, 2000)}
\`\`\`

## File
${filePath || '(unnamed)'} (${language})`;

  if (codeContext) {
    userMsg += `

## Code Context
\`\`\`${language}
${codeContext.slice(0, 3000)}
\`\`\``;
  }

  if (logContext) {
    userMsg += `

## Log Context
\`\`\`
${logContext.slice(0, 2000)}
\`\`\``;
  }

  userMsg += `

Output JSON:`;

  const result = await callLLM({
    system,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.1,
    maxTokens: 2048,
  });

  if (!result.ok) return result;

  let analysis;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    analysis = {
      rootCause: 'Failed to parse LLM response',
      errorType: 'Unknown',
      severity: 'medium',
      category: 'other',
      fixSteps: [],
      prevention: [],
      confidence: 0,
      summary: 'LLM analysis failed to parse',
      raw: result.content,
    };
  }

  return { ...result, analysis };
}

// ============================================================
// 工具：检查是否有可用的 LLM
// ============================================================

function isAvailable() {
  return isMCPSamplingAvailable() || detectProvider() !== null;
}

function getProviderName() {
  if (isMCPSamplingAvailable()) return 'mcp-sampling';
  const detected = detectProvider();
  return detected ? detected.provider.name : null;
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  callLLM,
  generateCode,
  generateTests,
  reviewCode,
  generateCommitMessage,
  analyzeCodePatterns,
  analyzeSecurity,
  analyzeDependencyRisk,
  generateDocument,
  analyzeEnvSecurity,
  analyzeError,
  isAvailable,
  getProviderName,
  detectProvider,
  isMCPSamplingAvailable,
  callViaMCPSampling,
};
