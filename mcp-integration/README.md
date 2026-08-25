# MCP 工具链集成方案

> project-orchestrator-bundle（15 个子 Skill）的 Model Context Protocol 完整集成设计

---

## 一、概述

**MCP（Model Context Protocol）** 是由 Anthropic 于 2024 年 11 月发布的开放标准，被誉为「AI 应用的 USB-C 接口」[1]。本方案说明如何让 project-orchestrator-bundle 的 15 个子 Skill 通过 MCP 与外部工具（文件系统、Git、GitHub、数据库、浏览器等）无缝协作。

### 1.1 目标

- ✅ 让 Agent 能调用任意 Skill 所需的工具
- ✅ 按 Skill 角色**最小化权限**（每个 Skill 只看到自己需要的工具）
- ✅ 跨平台兼容（Trae / Claude Code / Cursor / VS Code）
- ✅ 跟随 MCP 2026-07-28 最新规范（无状态核心 + Streamable HTTP）
- ✅ **MCP Sampling**：Skill 直接复用 Agent 框架的 LLM，零 API key 配置
- ✅ **AST 解析 100% 覆盖**：15/15 Skill 使用 parse5 + csstree + recast + @babel/parser（43 个 API）
- ✅ **端到端链路测试**：12 步全流程 spec→scaffold→design→implement→test→git→review
- ✅ **真实 npm audit**：dependency-auditor 调用 `npm audit --json` 获取真实 CVE 数据
- ✅ **Doppler/Vault 集成**：environment-manager 支持三后端 Secrets 管理
- ✅ 支持团队级标准化与可移植

### 1.2 当前 MCP 生态关键信息

| 项目 | 当前状态 |
|---|---|
| **最新规范** | 2026-07-28（无状态核心、MRTR、Header 路由） |
| **主流采纳** | Anthropic、OpenAI、Google、Microsoft、AWS、Cloudflare |
| **Tier 1 SDK 月下载量** | 接近 5 亿次（TS/Python/Go/C#）|
| **官方 Server 数量** | 7 个官方 + 20+ 社区归档 |
| **Bundle 中 Skill 数量** | 15 个（全部可对接 MCP）|

---

## 二、MCP Server 选型矩阵

### 2.1 P0 必须安装（6 个）

| Server | 包名 | 能力 | 适用 Skill |
|---|---|---|---|
| **filesystem** | `@modelcontextprotocol/server-filesystem` | 文件读写、可配置路径白名单 | 全部 15 个 |
| **memory** | `@modelcontextprotocol/server-memory` | 跨 Skill 共享 context（知识图谱）| spec-bootstrap / openspec-workflow 等 |
| **sequential-thinking** | `@modelcontextprotocol/server-sequential-thinking` | 动态多步推理 | implement-executor / debug-helper |
| **fetch** | `@modelcontextprotocol/server-fetch` | 网页抓取与转换 | spec-bootstrap / api-contract（拉外部规范）|
| **git** | `mcp-server-git` (Python) | git log/diff/blame/branch/commit | git-workflow / review-checklist |
| **github** | `@modelcontextprotocol/server-github` | PR 创建/merge/Issue | git-workflow / review-checklist / changelog |

### 2.2 P1 强烈推荐（1 个）

| Server | 包名 | 能力 | 适用 Skill |
|---|---|---|---|
| **puppeteer** | `@modelcontextprotocol/server-puppeteer` | 浏览器自动化 + 截图 | ui-design（聊天调整后的视觉验证）|

### 2.3 P2 可选（按需）

| Server | 适用场景 |
|---|---|
| **postgres** / **sqlite** | test-runner 数据库契约断言 |
| **sentry** | debug-helper 生产错误拉取 |
| **slack** | 团队通知（PR 创建 / 测试失败） |
| **redis** | 缓存验证 |

### 2.4 P0 自定义（1 个 · 关键差异化）

| Server | 描述 |
|---|---|
| **`orchestrator-tools`** | 把 15 个 Skill 的核心入口封装为 MCP Tool，并提供 **sampling capability** 让 Skill 复用 Agent 框架的 LLM。详见 §六。 |

---

## 三、Skill Bundle × MCP 工具需求矩阵

| # | Skill | 必需 MCP Server | 关键 Tool 调用 | 备注 |
|---|---|---|---|---|
| 1 | **spec-bootstrap** | filesystem + fetch + memory | `read_file`, `write_file`, `fetch`, `memory/store` | 拉 Spec Kit 文档、生成 spec.md |
| 2 | **code-patterns** | filesystem | `read_file`, `write_file`, `search_files` | 扫描已有代码 + 写规则 |
| 3 | **scaffold-runner** | filesystem + orchestrator-tools | `create_directory`, `write_file`, `scaffold_run` | 调官方脚手架工具 |
| 4 | **ui-design** | filesystem + puppeteer + orchestrator-tools | `write_file`, `browser_screenshot`, `ui_adjust` | 聊天调整 + 截图验证 |
| 5 | **spec-userstory-to-design** | filesystem + memory + orchestrator-tools | `read_file`, `write_file`, `memory/retrieve`, `design_generate` | 跨 Skill context 共享 |
| 6 | **api-contract** | filesystem + orchestrator-tools | `read_file`, `write_file`, `generate_openapi` | 生成 OpenAPI 3.1.2 |
| 7 | **html-converter** | filesystem | `read_file`, `write_file`, `search_files` | HTML → Vue/React |
| 8 | **openspec-workflow** | filesystem + memory + git + sequential-thinking | `git/status`, `git/diff`, `memory/store` | 提案 + 变更管理 |
| 9 | **implement-executor** | filesystem + git + sequential-thinking + orchestrator-tools | `write_file`, `git/commit`, `git/diff`, `implement_task` | Agent 写代码 |
| 10 | **test-runner** | filesystem + orchestrator-tools | `run_command`, `read_file`, `run_tests`, `coverage_check` | 测试 + 覆盖率 |
| 11 | **git-workflow** | filesystem + git + github + orchestrator-tools | `git/*`, `github/create_pr`, `commit_with_changelog` | PR + changelog |
| 12 | **debug-helper** | filesystem + sequential-thinking + sentry (可选) | `read_file`, `run_command`, `analyze_error` | 根因定位 |
| 13 | **review-checklist** | filesystem + github | `git/diff`, `github/list_prs`, `read_file` | PR 评审 |
| 14 | **dependency-auditor** | filesystem + orchestrator-tools | `read_file`, `audit_deps` | 漏洞 + License |
| 15 | **environment-manager** | filesystem + orchestrator-tools | `read_file`, `inject_secrets`, `validate_env` | 4 环境 + dotenv/Doppler/Vault 三后端 + `secrets sync` 外部拉取 |

> **共性**：每个 Skill 都需要 **filesystem**（读写项目文件），大多数需要 **orchestrator-tools**（项目专属工具）。

---

## 四、整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                   MCP Host（AI 应用层）                            │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐          │
│   │  Trae IDE    │   │ Claude Code  │   │   Cursor     │          │
│   │ (.trae/mcp)  │   │ (~/.claude)  │   │(.cursor/mcp) │          │
│   └──────────────┘   └──────────────┘   └──────────────┘          │
└────────────────────────────┬────────────────────────────────────┘
                             │ MCP Client (1:1 per Server)
                             │ stdio / Streamable HTTP
                             │ 协议：2026-07-28（无状态）
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MCP Servers 层                              │
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │ filesystem  │ │    memory   │ │sequential-  │ │    fetch   │ │
│  │   (P0)      │ │    (P0)     │ │ thinking(P0)│ │   (P0)    │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────────┐  │
│  │    git      │ │   github    │ │   orchestrator-tools    │  │
│  │   (P0)      │ │   (P0)      │ │        (P0 自定义)        │  │
│  └─────────────┘ └─────────────┘ └──────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐                                │
│  │  puppeteer  │ │   sentry    │                                │
│  │   (P1)      │ │   (P2)      │                                │
│  └─────────────┘ └─────────────┘                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       外部资源层                                  │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────┐ │
│   │文件系统   │ │   Git    │ │ GitHub  │ │  网页   │ │ DB   │ │
│   │  项目   │ │  仓库   │ │   PR   │ │        │ │      │ │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────┘ │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐                      │
│   │ 浏览器   │ │  监控   │ │  Slack  │                      │
│   │  截图   │ │  错误   │ │  通知  │                      │
│   └──────────┘ └──────────┘ └──────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、配置文件模板

### 5.1 Trae IDE（项目级配置）— `.trae/mcp.json`

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "env": {
        "START_MCP_TIMEOUT_MS": "60000",
        "RUN_MCP_TIMEOUT_MS": "60000"
      }
    },

    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },

    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },

    "fetch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    },

    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "${workspaceFolder}"]
    },

    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },

    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    },

    "orchestrator-tools": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-integration/dist/orchestrator-tools.js"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}",
        "SKILL_BUNDLE_PATH": "${workspaceFolder}/mcp-integration",
        "START_MCP_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

> **Trae 特别说明**：Trae 仅支持 `${workspaceFolder}` 变量，不支持 `${env:NAME}`。如需环境变量注入，可通过 OS 级 `GITHUB_TOKEN` 直接读取。

### 5.2 Claude Code（项目级 + 全局）— `.mcp.json` 或 `~/.claude.json`

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
    },
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "${workspaceFolder}"]
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${env:GITHUB_TOKEN}"
      }
    },
    "orchestrator-tools": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-integration/dist/orchestrator-tools.js"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}",
        "SKILL_BUNDLE_PATH": "${workspaceFolder}/mcp-integration"
      }
    }
  }
}
```

> Claude Code 同时支持 `${workspaceFolder}` 和 `${env:NAME}` 变量插值。

### 5.3 Cursor — `~/.cursor/mcp.json` 或 `.cursor/mcp.json`

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
    },
    "orchestrator-tools": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-integration/dist/orchestrator-tools.js"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### 5.4 Windows 特别说明

Windows 下 `npx` 需要 `cmd /c` 包装：

```jsonc
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
}
```

> **Windows 兼容性修复（v5）**：Bundle 内部使用 `spawnSync` + `shell: true` 替代 `execAsync`，修复了 git-workflow、dependency-auditor、environment-manager 在 Windows 下 stdout pipe 不可靠的问题。无需额外配置。

---

## 六、自定义 MCP Server：orchestrator-tools

### 6.1 为什么需要

官方 MCP Server 只提供"通用工具"（filesystem、git 等），但 Bundle 中的 Skill 需要一些**项目专属操作**：

- `scaffold_run` — 调用 scaffold-runner 内部脚手架
- `design_generate` — 调用 spec-userstory-to-design 生成 Page Detail
- `generate_openapi` — 调用 api-contract 生成 OpenAPI YAML
- `commit_with_changelog` — 调用 git-workflow 带 changelog 的智能 commit
- `run_tests` — 调用 test-runner 跑测试 + 覆盖率
- `inject_secrets` — 调用 environment-manager 注入 Secrets
- `audit_deps` — 调用 dependency-auditor 审计依赖

把这些封装为 MCP Tool 后，Skill 可以被任何 MCP Host（Trae / Claude Code / Cursor）调用，**实现"一次开发，多处运行"**。

### 6.2 推荐的 14 个核心 Tool

| Tool 名称 | 调用方 Skill | 输入 | 输出 |
|---|---|---|---|
| `scaffold_run` | scaffold-runner | {stack, options} | {outputDir, files[]} |
| `code_patterns_inject` | code-patterns | {task} | {patternsYaml} |
| `ui_adjust` | ui-design | {instruction, file} | {diff, beforeAfter} |
| `design_generate` | spec-userstory-to-design | {featureName, specMd} | {pageFlow, pageDetail, openapi} |
| `generate_openapi` | api-contract | {planMd, pageDetail} | {openapiYaml} |
| `html_to_component` | html-converter | {htmlFile, framework} | {componentFile} |
| `openspec_propose` | openspec-workflow | {changeName, intent} | {proposalMd} |
| `implement_task` | implement-executor | {taskId, phase} | {filesChanged, testResult} |
| `run_tests` | test-runner | {phase, scope} | {pass, fail, coverage} |
| `commit_with_changelog` | git-workflow | {files, message} | {commitHash, branchName} |
| `create_pull_request` | git-workflow | {feature, base} | {prUrl, prNumber} |
| `analyze_error` | debug-helper | {stackTrace} | {rootCause, fix} |
| `review_pull_request` | review-checklist | {prNumber} | {verdict, items[]} |
| `audit_dependencies` | dependency-auditor | {addPackage?} | {verdict, reasons[]} |
| `inject_secrets` | environment-manager | {env, keys[]} | {injectedKeys} |

### 6.3 实现模板（TypeScript + @modelcontextprotocol/sdk）

```typescript
// mcp-integration/src/orchestrator-tools.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
const SKILL_BUNDLE_PATH = process.env.SKILL_BUNDLE_PATH || '';

const server = new Server(
  {
    name: 'orchestrator-tools',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============ 列出所有 Tool ============
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scaffold_run',
      description: 'Run official scaffolding tool for a tech stack',
      inputSchema: {
        type: 'object',
        properties: {
          stack: {
            type: 'string',
            enum: ['react-vite', 'vue-vite', 'nextjs', 'nuxt', 'nest', 'spring-boot', 'fastapi', 'dotnet-webapi', 'rust', 'flutter', 'expo'],
          },
          packageManager: { type: 'string', enum: ['npm', 'pnpm', 'yarn'], default: 'pnpm' },
          options: { type: 'object', additionalProperties: true },
        },
        required: ['stack'],
      },
    },
    // ... 其他 13 个 Tool 的 schema
  ],
}));

// ============ 执行 Tool ============
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'scaffold_run':
      return await runScaffold(args);
    case 'code_patterns_inject':
      return await injectPatterns(args);
    case 'ui_adjust':
      return await adjustUI(args);
    case 'design_generate':
      return await generateDesign(args);
    case 'generate_openapi':
      return await generateOpenAPI(args);
    case 'html_to_component':
      return await convertHtml(args);
    case 'openspec_propose':
      return await createProposal(args);
    case 'implement_task':
      return await implementTask(args);
    case 'run_tests':
      return await runTests(args);
    case 'commit_with_changelog':
      return await smartCommit(args);
    case 'create_pull_request':
      return await createPR(args);
    case 'analyze_error':
      return await analyzeError(args);
    case 'review_pull_request':
      return await reviewPR(args);
    case 'audit_dependencies':
      return await auditDeps(args);
    case 'inject_secrets':
      return await injectSecrets(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ============ 各 Tool 实现 ============
async function runScaffold(args: any) {
  // 调用 scaffold-runner 的实现
  const { stack, packageManager = 'pnpm', options = {} } = args;
  const cmd = getScaffoldCommand(stack, packageManager, options);
  const result = await execInProject(cmd);
  return {
    content: [
      { type: 'text', text: `Scaffolded ${stack} successfully\n${result}` }
    ],
  };
}

async function generateOpenAPI(args: any) {
  // 调用 api-contract
  // ... 读 plan.md / page-detail/*.md → 生成 openapi.yaml
  return {
    content: [{ type: 'text', text: 'OpenAPI generated at contracts/openapi.yaml' }],
  };
}

// ... 其他 Tool 实现

// ============ 启动 ============
const transport = new StdioServerTransport();
await server.connect(transport);

// ❗️ 重要：stdio server 永远不要写 stdout（会破坏 JSON-RPC）
// 所有日志必须写到 stderr
console.error('orchestrator-tools MCP server started');
```

### 6.4 部署步骤

```bash
# 方式一：一键启动（推荐）
# Windows
.\quickstart.ps1

# macOS / Linux
./quickstart.sh

# 方式二：手动步骤
# 1. 进入 MCP 集成目录
cd mcp-integration

# 2. 安装依赖
npm install

# 3. 构建（TypeScript 编译 + 资产复制）
npm run build

# 4. 在 .trae/mcp.json 中注册（已包含在 §5.1）

# 5. 重启 Trae → 工具自动加载
```

### 6.5 LLM Sampling：Skill 复用 Agent 框架的 LLM（方案B）

orchestrator-tools Server 除了提供 Tool 能力外，还注册了 **sampling capability**，让所有子 Skill 可以直接复用 Agent 框架的 LLM，无需配置独立 API key。

#### 6.5.1 架构

```
┌──────────────────────────────────────────────────────────┐
│  MCP Host（TRAE Agent）                                    │
│  ┌───────────────┐    ┌──────────────────────────────┐  │
│  │  LLM（内置）   │    │  MCP Client                   │  │
│  └───────┬───────┘    │  • sampling/createMessage    │  │
│          │            └───────────────┬──────────────┘  │
│          │ sampling/createMessage     │ stdio            │
└──────────┼────────────────────────────┼──────────────────┘
           │                            │
┌──────────┼────────────────────────────┼──────────────────┐
│  ┌───────┴────────────────────────────▼──────────────┐   │
│  │  orchestrator-tools MCP Server                    │   │
│  │  • capabilities: { tools: {}, sampling: {} }      │   │
│  │  • fork() 启动 skill-cli.cjs（带 IPC 通道）         │   │
│  │  • handleLLMRequest() 转发 LLM 请求                │   │
│  └───────────────┬───────────────────────────────────┘   │
│                  │ IPC (process.send / child.on)         │
│  ┌───────────────┴───────────────────────────────────┐   │
│  │  skill-cli.cjs (forked child)                      │   │
│  │  • MCP_SAMPLING_ENABLED=1                          │   │
│  └───────────────┬───────────────────────────────────┘   │
│                  │ require()                              │
│  ┌───────────────┴───────────────────────────────────┐   │
│  │  llm-client.js → 各 Skill 模块                       │   │
│  │  1. 优先：callViaMCPSampling() → IPC → Server      │   │
│  │  2. 降级：直连 Provider（Anthropic/OpenAI/...）    │   │
│  └───────────────────────────────────────────────────┘   │
│         dist/ (orchestrator-tools 进程内)                │
└──────────────────────────────────────────────────────────┘
```

#### 6.5.2 数据流

1. **连接阶段**：MCP Client 连接 Server → Server 声明 `{ capabilities: { tools: {}, sampling: {} } }` → Server 检测 Client 是否支持 sampling
2. **Tool 调用**：Client 调用 Tool → Server `fork()` 启动 skill-cli.cjs，设置 `MCP_SAMPLING_ENABLED=1` 并建立 IPC 通道
3. **LLM 请求**：Skill 代码调用 `llm.callLLM()` → llm-client 检测到 MCP Sampling 可用 → 通过 `process.send()` 发送 `llm:request`
4. **转发到 Agent**：Server 收到 IPC 消息 → 调用 `sampling/createMessage` 向 Client 请求 LLM 推理
5. **结果回传**：Client 使用 Agent 框架 LLM 完成推理 → 返回结果 → Server 通过 `child.send()` 将 `llm:response` 回传给 Skill
6. **Skill 完成**：Skill 使用 LLM 结果完成处理 → 返回最终 Tool 结果

#### 6.5.3 核心代码要点

Server 端（orchestrator-tools.ts）：

```typescript
// 注册 sampling capability
const server = new Server(
  { name: 'orchestrator-tools', version: '1.0.0' },
  { capabilities: { tools: {}, sampling: {} } }
);

// 连接后检测 Client 是否支持 sampling
await server.connect(transport);
const clientCapabilities = (server as any).getClientCapabilities?.() || {};
samplingEnabled = !!clientCapabilities?.sampling;

// fork() 子进程 + IPC
const child = fork(SKILL_CLI_BIN, args, {
  env: { ...process.env, MCP_SAMPLING_ENABLED: samplingEnabled ? '1' : '0' },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
});

// 处理 Skill 发来的 LLM 请求
child.on('message', async (msg: any) => {
  if (msg.type === 'llm:request') {
    const result = await server.request(
      {
        method: 'sampling/createMessage',
        params: {
          messages: msg.messages.map(m => ({
            role: m.role,
            content: { type: 'text', text: m.content },
          })),
          systemPrompt: msg.system,
          temperature: msg.temperature,
          maxTokens: msg.maxTokens || 4096,
        },
      },
      CreateMessageRequestSchema as any,
    );
    child.send({
      type: 'llm:response',
      id: msg.id,
      ok: true,
      content: (result as any)?.content?.text || '',
      model: (result as any)?.model,
    });
  }
});
```

Skill 端（llm-client.js）：

```javascript
// 检测 MCP Sampling 是否可用
function isMCPSamplingAvailable() {
  return process.env.MCP_SAMPLING_ENABLED === '1' && typeof process.send === 'function';
}

// 通过 IPC 发送 LLM 请求
async function callViaMCPSampling({ system, messages, maxTokens, temperature }) {
  const id = ++_llmRequestId;
  return new Promise((resolve, reject) => {
    _pendingLLMRequests.set(id, { resolve, reject });
    process.send({ type: 'llm:request', id, system, messages, maxTokens, temperature });
  });
}

// 接收 LLM 响应
process.on('message', (msg) => {
  if (msg.type === 'llm:response' && _pendingLLMRequests.has(msg.id)) {
    const pending = _pendingLLMRequests.get(msg.id);
    _pendingLLMRequests.delete(msg.id);
    msg.ok ? pending.resolve({ content: msg.content, model: msg.model })
           : pending.reject(new Error(msg.error));
  }
});
```

#### 6.5.4 降级策略

| 场景 | 行为 |
|---|---|
| Client 支持 sampling | Skill 走 MCP Sampling（零配置，使用 Agent LLM）|
| Client 不支持 sampling | 自动降级到直连 Provider（需设置 API key）|
| 独立运行 skill-cli | MCP Sampling 不可用 → 走直连 Provider / 模板模式 |
| MCP Sampling 调用失败 | 自动降级到直连 Provider |

---

## 七、权限隔离与安全

### 7.1 三层权限模型

```
┌──────────────────────────────────────────────────┐
│ Layer 1：路径白名单（Filesystem MCP）            │
│ - 通过 --allowed-dir 限定每个 Server 的访问路径 │
│ - 禁止访问 ~/.ssh、~/.aws 等敏感目录              │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Layer 2：Tool 白名单（IDE 级别）                  │
│ - Trae/Cursor 支持 enable/disable 单个 tool       │
│ - 按 Skill 角色挂载不同 MCP Server 子集           │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Layer 3：用户审批（默认）                        │
│ - 敏感操作（git push、PR merge）需用户手动确认    │
│ - Skills 默认开启 confirmation_required 标志     │
└──────────────────────────────────────────────────┘
```

### 7.2 Skill 级别权限矩阵

| Skill | Filesystem 路径 | 禁写路径 | 网络访问 |
|---|---|---|---|
| spec-bootstrap | `${workspaceFolder}/specs/**` | `.env*`, `secrets/**` | ✅ fetch |
| code-patterns | `${workspaceFolder}/.code-patterns.yaml` | — | ❌ |
| scaffold-runner | `${workspaceFolder}/src/**`, `${workspaceFolder}/tests/**` | — | ❌ |
| ui-design | `${workspaceFolder}/prototype/**` | — | ⚠️ puppeteer（受限）|
| spec-userstory-to-design | `${workspaceFolder}/docs/design/**` | — | ❌ |
| api-contract | `${workspaceFolder}/contracts/**` | — | ❌ |
| html-converter | `${workspaceFolder}/components/**` | — | ❌ |
| openspec-workflow | `${workspaceFolder}/openspec/**` | — | ❌ |
| implement-executor | `${workspaceFolder}/**`（除禁止外）| `.env*`, `secrets/**`, `node_modules/**` | ⚠️ shell（受限）|
| test-runner | `${workspaceFolder}/tests/**`, `${workspaceFolder}/coverage/**` | — | ⚠️ shell（受限）|
| git-workflow | — | — | ⚠️ github |
| debug-helper | `${workspaceFolder}/**` | — | ⚠️ sentry（可选）|
| review-checklist | `${workspaceFolder}/**` | — | ⚠️ github |
| dependency-auditor | `${workspaceFolder}/**` | — | ⚠️ fetch（npm registry）|
| environment-manager | `${workspaceFolder}/.env*` | `secrets/**`（read-only）| ⚠️ Doppler/Vault |

### 7.3 环境变量注入

```bash
# .env（项目级，不入 git）
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
DOPPLER_TOKEN=dp.xxxxxxxxxxxx
SENTRY_DSN=https://xxx@sentry.io/xxx
TEST_API_BASE=http://localhost:8080/v1
```

```jsonc
// .trae/mcp.json（注入到 MCP Server 环境）
{
  "github": {
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
    }
  }
}
```

> **安全提示**：MCP Server 进程能看到这些环境变量。**绝不在 mcp.json 中硬编码 token**，只用 `${env:NAME}` 引用。

---

## 八、错误处理与 Fallback

### 8.1 常见故障与处理

| 故障 | 检测信号 | Fallback 策略 |
|---|---|---|
| **MCP Server 启动失败** | stdio 无响应、HTTP 5xx | 切换到备用 server；或直接用 Bash 命令代替 |
| **Tool 超时** | `RUN_MCP_TIMEOUT_MS` 触发 | 重试 3 次 → 降级为本地命令 |
| **协议版本不匹配** | initialize 失败 | 自动降级到 `2025-06-18` |
| **用户拒绝授权** | permission denied | 提示用户手动操作或跳过该步骤 |
| **远程 server 断开** | Streamable HTTP 中断 | 2026-07-28 无状态设计支持重连 |
| **filesystem 路径无权限** | EACCES 错误 | 提示用户调整 `--allowed-dir` |

### 8.2 Skill 级错误处理约定

每个 Skill 在 SKILL.md 中应明确：

```markdown
## MCP 工具故障处理

- filesystem.read_file 失败 → 降级为 cat 命令
- git.commit 失败 → 跳过 commit，提示用户手动执行
- 测试超时 → 终止测试，输出部分报告
- network failure → 重试 3 次后提示离线模式
```

### 8.3 stdio server 黄金法则

```
✅ DO:
- 所有日志写 stderr（console.error()）
- 错误用 isError: true 标识
- 输入用 JSON Schema 严格校验
- 工具返回值使用 isError 标志

❌ DON'T:
- 写 stdout（会破坏 JSON-RPC）
- 在工具内启动长时间阻塞操作（用异步 + 进度通知）
- 直接调用未经用户授权的破坏性操作
```

---

## 九、部署到不同 MCP Host 的步骤

### 9.1 Trae IDE

```bash
# 1. 在项目根目录创建 .trae/mcp.json
# （粘贴 §5.1 的配置）

# 2. Trae → 设置 → MCP → 启用项目级 MCP

# 3. 重启 Trae（或自动加载）

# 4. 在对话框输入「列出可用 MCP 工具」验证
```

### 9.2 Claude Code

```bash
# 1. 全局配置（影响所有项目）
cat > ~/.claude.json << 'EOF'
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"] },
    "orchestrator-tools": { "command": "node", "args": ["${workspaceFolder}/mcp-integration/dist/orchestrator-tools.js"] }
  }
}
EOF

# 2. 项目级配置（推荐）
cat > .mcp.json << 'EOF'
{ 同上结构 }
EOF

# 3. 启动 claude
claude
```

### 9.3 Cursor

```bash
# 项目级
cat > .cursor/mcp.json << 'EOF'
{ 同上 }
EOF

# Cursor → Settings → MCP → Add new global MCP server
```

---

## 十、升级路径（跟随 MCP 2026-07-28）

### 10.1 当前 Bundle 的兼容性

| 特性 | 当前支持 | 备注 |
|---|---|---|
| stdio 传输 | ✅ | 本地所有 server |
| Streamable HTTP | ✅ | 推荐远程 server |
| Legacy SSE | ⚠️ | 已弃用，避免使用 |
| 无状态协议核心 | ✅（2026-07-28） | Skill 代码无需修改 |
| Header 路由 | ✅ | 网关可直接按 Mcp-Method 路由 |
| List 可缓存 | ✅ | 适合 CDN 加速 |
| RFC 9207 issuer 校验 | ✅ | OAuth 远程 server 必用 |
| Tasks 扩展 | ⏳ | 可选，用于长任务 |

### 10.2 未来部署选项

- **AWS Bedrock AgentCore**：day-zero 支持 2026-07-28，Bundle 可直接迁移
- **Cloudflare Workers**：day-zero 支持
- **Microsoft Foundry**：Toolbox 统一治理 + 身份 + 可观测
- **Google Cloud**：全生态支持

迁移路径：
```
本地 Trae / Claude Code / Cursor（stdio）
        ↓
远程部署（Streamable HTTP + OAuth）
        ↓
托管平台（AWS / Cloudflare / Azure）
```

---

## 十一、验证清单

部署完成后，用以下清单逐项验证：

- [ ] `.trae/mcp.json` 或 `.mcp.json` 已创建
- [ ] 6 个 P0 server 全部启动成功（查看 IDE 日志）
- [ ] 在对话框输入「列出可用工具」返回 ≥ 30 个 tool
- [ ] filesystem.read_file 能读到项目根目录的 README.md
- [ ] memory.store 能保存 + memory.retrieve 能读取
- [ ] git.git_status 能识别当前分支
- [ ] 在 spec-bootstrap 调用时能拉 Spec Kit 文档
- [ ] orchestrator-tools.scaffold_run 能创建 Vue 工程
- [ ] 所有 Skill 的 SKILL.md 顶部声明了所需的 MCP 工具
- [ ] 权限矩阵已写入项目 README

---

## 十二、相关链接

- [MCP 官方文档](https://modelcontextprotocol.io/docs)
- [MCP 2026-07-28 规范公告](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP Server 列表（GitHub）](https://github.com/modelcontextprotocol/servers)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [Trae IDE MCP 文档](https://docs.trae.ai/ide/add-mcp-servers)
- [Cursor MCP 文档](https://cursor.com/docs/context/mcp)
- [Claude Code MCP 配置](https://github.com/anthropics/claude-code/issues/6888)
- [@modelcontextprotocol/sdk（TypeScript SDK）](https://github.com/modelcontextprotocol/typescript-sdk)
- [project-orchestrator-bundle SKILL.md](../SKILL.md)

---

## 十三、版本

- v1.0.0 (2026-08-24) — 初版，遵循 MCP 2026-07-28 规范
- v1.1.0 (2026-08-25) — v5 更新：
  - AST 解析 100% 覆盖（15/15 Skill，43 个 API）
  - 端到端链路测试（12 步全流程，91 个测试）
  - dependency-auditor 真实 npm audit（`npm audit --json` + CVE 解析）
  - environment-manager Doppler/Vault 集成（三后端 Secrets 管理 + `secrets sync`）
  - 测试断言加固（30 个弱断言升级为深度数据字段断言）
  - Windows 兼容性（`spawnSync` + `shell: true` 修复 stdout pipe）
  - MCP Sampling 全链路（IPC 转发 + 延迟检测 + 三级降级）
- v1.2.0 (2026-08-25) — v6 更新：
  - AST 解析器补齐 @babel/parser（TypeScript 接口语法校验）
  - 15/15 Skill 100% 迁移到 AST 解析，无正则表达式解析
  - 文档全量同步 + CI/CD 流水线
- v1.3.0 (2026-08-25) — v7 更新：
  - LLM 深度集成 8/15 Skill（结构化 prompt + JSON 解析容错）
  - llm-client.js 新增 6 个结构化方法（共 9 个：generateCode/reviewCode/generateCommitMessage/analyzeCodePatterns/analyzeSecurity/analyzeDependencyRisk/generateDocument/analyzeEnvSecurity + callLLM）
  - "AST 预检测 → LLM 深度分析" 双层架构落地
- v1.4.0 (2026-08-25) — v8 更新（当前）：
  - **LLM 全量深度集成 15/15 Skill**，0 个未结构化（从 8/15 → 15/15）
  - 新增 `analyzeError` 结构化方法（共 10 个），`customSystem` 参数支持定制 prompt
  - **三层分析架构**落地（AST 预检测 → 代码模式分析 → LLM 深度分析）
  - pipeline 断点恢复机制（resume / rollback / abort + 重试预算 + 状态验证）
  - 性能基线数据（benchmark.js + baseline.json，AST 解析 < 3ms）
  - 整体成熟度 96%（Phase 3 · Beta 后期稳定）
- 由 `project-orchestrator-bundle / mcp-integration` 团队编写