# Skill CLI 接口契约

> orchestrator-tools MCP Server 与 15 个 Skill 之间的统一调用规范

---

## 一、CLI 协议概览

每个 Skill 提供一个**统一的 Node.js CLI 入口**（`skill-cli.js`），通过子进程调用，实现与 MCP Server 的解耦：

```
┌─────────────────────┐         ┌──────────────────────┐
│  orchestrator-tools  │ ──exec──>│   skill-cli.js       │
│  (MCP Server)        │   JSON   │   (Skill Router)     │
│  TypeScript          │ <──JSON──│                      │
└─────────────────────┘         └──────┬───────────────┘
                                        │ require
                                        ▼
                              ┌──────────────────────┐
                              │ skills/<skill-name>/  │
                              │   index.js            │
                              │   (具体业务逻辑)      │
                              └──────────────────────┘
```

## 二、调用方式

### 2.1 命令格式

```bash
node skill-cli.js <skill-name> <command> \
  --input '<json>' \
  --project-root <path>
```

| 参数 | 必填 | 描述 |
|---|---|---|
| `<skill-name>` | ✅ | Skill 标识（kebab-case，如 `scaffold-runner`）|
| `<command>` | ✅ | Skill 内具体命令（如 `run`、`commit`、`pr`）|
| `--input` | ✅ | JSON 字符串，包含所有参数 |
| `--project-root` | ✅ | 项目根目录路径 |

### 2.2 输入格式（input JSON）

```json
{
  "param1": "value1",
  "param2": "value2",
  "projectRoot": "/path/to/project"
}
```

`projectRoot` 由 skill-cli.js **自动注入**（基于 --project-root 参数），Skill 不必重复解析。

### 2.3 输出格式（stdout JSON）

```json
{
  "ok": true,
  "command": "scaffold-runner.run",
  "data": {
 "summary": "✅ Scaffolded react-vite project",
    "outputDir": "/path/to/project",
    "files": ["package.json", "src/main.tsx", ...]
  },
  "warnings": [],
  "nextActions": [
    "cd /path/to/project",
    "pnpm install",
    "pnpm run dev"
  ],
  "duration": 12345
}
```

| 字段 | 类型 | 必填 | 描述 |
|---|---|---|---|
| `ok` | boolean | ✅ | 命令是否成功 |
| `command` | string | ✅ | 执行的完整命令标识 |
| `data` | object | ⚠️ | 成功时的结构化数据 |
| `error` | string | ⚠️ | 失败时的错误信息 |
| `warnings` | string[] | ❌ | 非阻塞性警告 |
| `nextActions` | string[] | ❌ | 建议的后续步骤 |
| `duration` | number | ❌ | 执行耗时（ms，CLI自动添加）|

### 2.4 Exit Code

| Exit Code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 失败（错误信息在 stdout JSON.error 中）|
| 124 | 超时（来自 `timeout` 命令）|

### 2.5 stderr 用途

```bash
# stderr 用于日志（不影响 stdout 解析）
node skill-cli.js scaffold-runner run --input '{}'
# stdout: {"ok":true,"data":{...}}
# stderr: [skill-cli] Executing scaffold-runner.run...
#         [scaffold-runner] Running pnpm create vite...
```

## 三、15 个 Skill 的完整命令清单

| Skill | 命令 | 输入 | 输出（data 摘要）|
|---|---|---|---|
| **spec-bootstrap** | constitution | { principles } | { constitutionPath } |
| | specify | { description } | { specPath } |
| | clarify | { specFile } | { clarifiedSpecPath } |
| | plan | { specFile } | { planPath } |
| | tasks | { planFile } | { tasksPath } |
| | checklist | { specFile } | { checklistPath } |
| | analyze | { feature } | { analysisReport } |
| | implement | { phase, taskId } | { codeFiles, testFiles } |
| **code-patterns** | inject | { section, asFormat } | { injectionText } |
| | init | { scanExisting } | { yamlPath } |
| **scaffold-runner** | run | { stack, packageManager, projectName } | { outputDir, files } |
| | addDep | { packageName, version } | { package, version } |
| **ui-design** | adjust | { instruction, filePath, autoApply } | { diff, beforeAfter } |
| | generate | { featureName, pageCount } | { htmlFiles } |
| **spec-userstory-to-design** | generate | { featureName, specFile, format } | { pageFlowFile, pageDetails, openApiDraft } |
| **api-contract** | generate | { fromFiles, outputPath, authType } | { openapiPath } |
| **html-converter** | convert | { htmlFile, framework, typescript } | { components } |
| **openspec-workflow** | propose | { changeName, intent } | { proposalPath, branchName } |
| **implement-executor** | implement | { taskId, featureId, dryRun } | { filesChanged, testResult } |
| **test-runner** | run | { phase, scope, failOnCoverageBelow } | { passed, failed, coverage } |
| | contract | { fromFiles } | { contractTestPath } |
| **git-workflow** | commit | { files, message, taskId } | { commitHash, commitType, scope } |
| | pr | { feature, base, reviewers, draft } | { prUrl, branch } |
| | changelog | { from, to } | { changelogPath } |
| **debug-helper** | analyze | { errorMessage, stackTrace } | { rootCause, fix } |
| | bisect | { bad, good, test } | { badCommit, author } |
| **review-checklist** | review | { prNumber, strictMode, categories } | { verdict, items, summary } |
| **dependency-auditor** | audit | { addPackage, ecosystem, failOnLicense } | { verdict, vulnerabilities, licenses } |
| **environment-manager** | inject | { env, keys, backend } | { injectedKeys } |
| | rotate | { env, key } | { oldKey, newKey, rotatedAt } |

## 四、典型调用示例

### 4.1 成功调用

```bash
$ node skill-cli.js scaffold-runner run \
    --input '{"stack":"react-vite","packageManager":"pnpm"}' \
    --project-root /Users/me/myapp

{"ok":true,"command":"scaffold-runner.run","data":{"summary":"✅ Scaffolded react-vite project at /Users/me/myapp","outputDir":"/Users/me/myapp","stack":"react-vite","packageManager":"pnpm"},"warnings":[],"nextActions":["cd .","pnpm install","pnpm run dev"]}
```

### 4.2 失败调用

```bash
$ node skill-cli.js git-workflow pr \
    --input '{"feature":"001-init"}' \
    --project-root /Users/me/myapp

{"ok":false,"command":"git-workflow.pr","error":"gh CLI not installed. Install from https://cli.github.com/","warnings":[]}
```

### 4.3 带警告的成功

```bash
$ node skill-cli.js audit_dependencies \
    --input '{"addPackage":"left-pad"}' \
    --project-root /Users/me/myapp

{"ok":true,"command":"dependency-auditor.audit","data":{"summary":"⚠️ left-pad has warnings","verdict":"WARN"},"warnings":["Package last updated 2+ years ago","No active maintainer"],"nextActions":["Use alternative: pad-left"]}
```

## 五、Skill 实现模板

每个 Skill 都遵循同一模板（参考 `template.js`）：

```javascript
const fs = require('fs').promises;
const path = require('path');

module.exports = {
  async myCommand({ param1, projectRoot }) {
    // 1. 参数校验
    if (!param1) return { ok: false, error: 'param1 required' };

    try {
      // 2. 业务逻辑
      const result = await doSomething(param1, projectRoot);

      // 3. 成功返回
      return {
        ok: true,
        data: { summary: 'Did X', result },
        warnings: [],
        nextActions: ['What to do next'],
      };
    } catch (err) {
      // 4. 异常处理（不 throw）
      return {
        ok: false,
        error: err.message?.slice(0, 300),
      };
    }
  },
};
```

**核心约定**：

1. ✅ **CommonJS**（与 skill-cli.js 一致）
2. ✅ **每个 command 导出为函数**，接收 input 对象，返回 SkillResult
3. ✅ **input 始终包含 projectRoot**（由 skill-cli 注入）
4. ✅ **错误返回对象而非 throw**
5. ✅ **日志用 console.error**（写 stderr）
6. ✅ **文件操作使用绝对路径**（基于 projectRoot）
7. ✅ **result.summary 必填**（用于 UI 展示）

## 六、orchestrator-tools 调用流程

```typescript
// orchestrator-tools.ts 内的实现
async function callSkill(skill, command, input, options) {
  const cmd = `node "${SKILL_CLI_BIN}" ${skill} ${command} ` +
              `--input '${JSON.stringify(input)}' ` +
              `--project-root "${cwd}"`;

  try {
    const { stdout } = await execAsync(cmd, { timeout });
    return JSON.parse(stdout);  // SkillResult
  } catch (err) {
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch {}
    }
    return { ok: false, command: `${skill}.${command}`, error: err.message };
  }
}
```

## 七、当前已实现的 Skill（3 个真实 + 12 个 stub）

### 完整实现 ✅

- `scaffold-runner/index.js` — 调用 13+ 官方脚手架工具
- `code-patterns/index.js` — 注入 + 初始化团队约定
- `git-workflow/index.js` — 智能 commit + PR + changelog### Stub 实现 ��

- `spec-bootstrap`, `ui-design`, `api-contract`, `spec-userstory-to-design`
- `html-converter`, `openspec-workflow`, `implement-executor`
- `test-runner`, `debug-helper`, `review-checklist`
- `dependency-auditor`, `environment-manager`

每个 stub 都遵循同一接口契约，可以**逐个填充实际逻辑**而不影响 MCP Server。

## 八、构建与运行

### 8.1 构建 Skill CLI

```bash
cd mcp-integration/examples

# 方式 A：使用 Babel/SWC 转译（如果用 TS）
pnpm add -D @babel/cli @babel/preset-env
npx babel skill-cli.js --presets=@babel/preset-env -o dist/skill-cli.js

# 方式 B：保持纯 JS（推荐，无需构建）
# 直接用 skill-cli.js
```

### 8.2 注册到 .trae/mcp.json

```json
{
  "mcpServers": {
    "orchestrator-tools": {
      "command": "npx",
      "args": ["tsx", "/path/to/orchestrator-tools.ts"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}",
        "SKILL_CLI_BIN": "/path/to/examples/skill-cli.js"
      }
    }
  }
}
```

### 8.3 测试单个 Tool

```bash
# 直接测试 Skill CLI
node examples/skill-cli.js scaffold-runner run \
  --input '{"stack":"react-vite"}' \
  --project-root /tmp/test
```

## 九、扩展指南

### 9.1 新增 Skill

```bash
mkdir -p examples/skills/my-new-skill
cp examples/template.js examples/skills/my-new-skill/index.js
# 修改 index.js 实现业务逻辑
# 在 skill-cli.js 的 handlers 中注册
# 在 orchestrator-tools.ts 的 ListTools 中添加 Tool
```

### 9.2 新增 Command

```javascript
// 在 skills/<skill>/index.js 中添加
module.exports = {
  // 已有 commands...
  myNewCommand({ input1, projectRoot }) {
    return { ok: true, data: { ... } };
  },
};
```

```typescript
// 在 orchestrator-tools.ts 中添加工具
case 'my_new_command':
  return await callSkill('my-skill', 'myNewCommand', args);
```

## 十、版本

- v1.0.0 (2026-08-24) — 初版，统一 CLI 契约 + 3 个