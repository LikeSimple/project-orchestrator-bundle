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
  isAvailable,
  getProviderName,
  detectProvider,
  isMCPSamplingAvailable,
  callViaMCPSampling,
};
