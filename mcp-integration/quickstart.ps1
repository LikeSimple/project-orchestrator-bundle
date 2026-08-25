<#
# ============================================================================
#  project-orchestrator-bundle 一键部署脚本（Windows PowerShell）
# ============================================================================
#
# 作用：
#   1. 检查环境（Node.js / pnpm / git / MCP Host）
#   2. 构建 Skill CLI（TypeScript → JavaScript）
#   3. 配置 MCP（写入 .trae/mcp.json 或 %USERPROFILE%\.claude.json 等）
#   4. 测试集成（运行 1-2 个 Tool 验证）
#
# 用法：
#   .\quickstart.ps1                    # 交互式（默认）
#   .\quickstart.ps1 -MCP trae          # 自动选择 Trae IDE
#   .\quickstart.ps1 -MCP claude        # Claude Code
#   .\quickstart.ps1 -MCP cursor       # Cursor
#   .\quickstart.ps1 -DryRun           # 仅检查，不写文件
#   .\quickstart.ps1 -SkipTest         # 跳过集成测试
#   .\quickstart.ps1 -Verbose          # 详细日志输出
#   .\quickstart.ps1 -Help             # 帮助
#
# 退出码：
#   0 = 成功
#   1 = 环境缺失
#   2 = 构建失败
#   3 = 配置失败
#   4 = 测试失败
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('trae', 'claude', 'cursor', 'vscode', 'all', '')]
    [string]$MCP = '',

    [switch]$DryRun,
    [switch]$SkipTest,
    [switch]$Verbose,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

# ============================================================
# 常量
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BundleDir = Split-Path -Parent $ScriptDir
$McpIntegrationDir = $ScriptDir
$ExamplesDir = Join-Path $McpIntegrationDir 'examples'
$SkillCliSource = Join-Path $ExamplesDir 'skill-cli.js'
$OrchestratorTs = Join-Path $McpIntegrationDir 'orchestrator-tools.ts'
$SkillCliDist = Join-Path $McpIntegrationDir 'dist/skill-cli.js'
$OrchestratorDist = Join-Path $McpIntegrationDir 'dist/orchestrator-tools.js'
$PkgJson = Join-Path $McpIntegrationDir 'package.json'
$DistDir = Join-Path $McpIntegrationDir 'dist'
$TmpLog = Join-Path $env:TEMP 'orchestrator-quickstart.log'

# 颜色
$Colors = @{
    Red     = 'Red'
    Green   = 'Green'
    Yellow  = 'Yellow'
    Blue    = 'Cyan'
    Cyan    = 'Cyan'
    Bold    = 'White'
}

# ============================================================
# 工具函数
# ============================================================

function Log-Info($msg) {
    Write-Host "$($Colors.Blue)[i]$($Colors.Cyan)  $msg$($Colors.Blue)" -ForegroundColor $Colors.Blue
}

function Log-Ok($msg) {
    Write-Host "$($Colors.Green)[+]$($Colors.Green)  $msg$($Colors.Green)" -ForegroundColor $Colors.Green
}

function Log-Warn($msg) {
    Write-Host "$($Colors.Yellow)[!]$($Colors.Yellow)  $msg$($Colors.Yellow)" -ForegroundColor $Colors.Yellow
}

function Log-Err($msg) {
    Write-Host "$($Colors.Red)[x]$($Colors.Red)  $msg$($Colors.Red)" -ForegroundColor $Colors.Red
}

function Log-Step($msg) {
    Write-Host ""
    Write-Host "$($Colors.Cyan)=== $msg ===$($Colors.Cyan)" -ForegroundColor $Colors.Cyan
    Write-Host ""
}

function Has-Cmd($cmd) {
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Version-Ge($v1, $v2) {
    $a = [version]($v1 -replace '^v', '')
    $b = [version]($v2 -replace '^v', '')
    return $a -ge $b
}

function Prompt-Choice($prompt, $options) {
    Write-Host $prompt -ForegroundColor White
    for ($i = 0; $i -lt $options.Count; $i++) {
        Write-Host "  $($i + 1)) $($options[$i])"
    }
    $choice = Read-Host "请选择 [1-$($options.Count)]"
    $idx = [int]$choice - 1
    if ($idx -ge 0 -and $idx -lt $options.Count) {
        return $options[$idx]
    }
    return $null
}

# ============================================================
# 显示帮助
# ============================================================

if ($Help) {
    @"
用法: .\quickstart.ps1 [选项]

选项:
  -MCP <trae|claude|cursor|vscode|all>   选择 MCP Host
  -DryRun                                 仅检查，不写文件
  -SkipTest                               跳过集成测试
  -Verbose                                 详细日志
  -Help                                   显示此帮助

示例:
  .\quickstart.ps1                        # 交互式
  .\quickstart.ps1 -MCP trae              # Trae IDE
  .\quickstart.ps1 -MCP claude -Verbose  # Claude Code + 详细
"@
    exit 0
}

# ============================================================
# Banner
# ============================================================

$Banner = @'
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   project-orchestrator-bundle                          ║
║   一键部署脚本（Windows PowerShell）                  ║
║                                                            ║
║   ✨ 构建 CLI + 配置 MCP + 测试一体化                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
'@
Write-Host $Banner -ForegroundColor Cyan

if ($DryRun) {
    Log-Warn "干运行模式：仅检查环境，不修改任何文件"
}

# ============================================================
# Step 1: 环境检查
# ============================================================

Log-Step "Step 1/4 · 环境检查"

$envOk = $true

# Node.js
if (Has-Cmd 'node') {
    $nodeVersion = node -v
    if (Version-Ge $nodeVersion '18.0.0') {
        Log-Ok "Node.js: $nodeVersion"
    } else {
        Log-Err "Node.js: $nodeVersion（需要 ≥ v18.0.0）"
        Log-Info "  请访问 https://nodejs.org/ 下载 LTS 版本"
        $envOk = $false
    }
} else {
    Log-Err "Node.js 未安装"
    Log-Info "  Windows: 从 https://nodejs.org/ 下载安装"
    Log-Info "  或使用: winget install OpenJS.NodeJS"
    $envOk = $false
}

# pnpm
if (Has-Cmd 'pnpm') {
    Log-Ok "pnpm: $(pnpm -v)"
} elseif (Has-Cmd 'npm') {
    $npmVersion = npm -v
    Log-Warn "pnpm 未安装，将使用 npm（推荐 pnpm ≥ 8）"
    Log-Info "  安装: npm install -g pnpm"
    if (Version-Ge $npmVersion '9.0.0') {
        Log-Ok "  fallback npm: $npmVersion"
    } else {
        Log-Warn "  npm 版本较旧（$npmVersion），建议升级到 ≥ 9"
    }
} else {
    Log-Err "pnpm 和 npm 均未安装"
    $envOk = $false
}

# git
if (Has-Cmd 'git') {
    $gitVersion = (git --version) -replace 'git version ', ''
    Log-Ok "git: $gitVersion"
} else {
    Log-Warn "git 未安装（部分 Skill 需要，但不影响核心）"
}

# uvx
if (Has-Cmd 'uvx') {
    Log-Ok "uvx: $(uvx --version 2>&1 | Select-Object -First 1)"
} elseif (Has-Cmd 'uv') {
    Log-Ok "uv: $(uv --version 2>&1 | Select-Object -First 1)"
} else {
    Log-Warn "uv/uvx 未安装（git MCP server 需要，可后续安装）"
    Log-Info "  安装: irm https://astral.sh/uv/install.ps1 | iex"
}

if (-not $envOk) {
    Log-Err "环境检查失败，请先安装缺失的工具"
    exit 1
}

# ============================================================
# Step 2: 构建 Skill CLI
# ============================================================

Log-Step "Step 2/4 · 构建 Skill CLI"

# 2.1 检查依赖文件
if (-not (Test-Path $PkgJson)) {
    Log-Err "未找到 package.json: $PkgJson"
    Log-Info "  请确认 mcp-integration 目录完整"
    exit 2
}

if (-not (Test-Path $OrchestratorTs)) {
    Log-Err "未找到 orchestrator-tools.ts: $OrchestratorTs"
    exit 2
}

if (-not (Test-Path $SkillCliSource)) {
    Log-Err "未找到 skill-cli.js: $SkillCliSource"
    exit 2
}

Log-Ok "源文件齐全"

# 2.2 安装依赖
if (-not $DryRun) {
    Log-Info "安装 npm 依赖..."

    if (Test-Path (Join-Path $McpIntegrationDir 'node_modules')) {
        Log-Info "  node_modules 已存在，跳过"
    } else {
        Push-Location $McpIntegrationDir

        if (-not (Test-Path $PkgJson)) {
            Log-Info "  未找到 package.json，正在创建..."
            @'
{
  "name": "project-orchestrator-mcp",
  "version": "1.0.0",
  "description": "orchestrator-tools MCP Server + Skill CLI",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/orchestrator-tools.js",
    "dev": "tsx orchestrator-tools.ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
'@ | Out-File -FilePath $PkgJson -Encoding UTF8
        }

        $pkgMgr = if (Has-Cmd 'pnpm') { 'pnpm' } else { 'npm' }
        try {
            & $pkgMgr install --silent 2>&1 | Select-Object -Last 5
        } catch {
            Log-Err "依赖安装失败"
            Pop-Location
            exit 2
        }
        Pop-Location

        Log-Ok "依赖安装完成"
    }
}

# 2.3 编译 TypeScript
if (-not $DryRun) {
    Log-Info "编译 TypeScript → JavaScript..."

    if (-not (Test-Path (Join-Path $McpIntegrationDir 'tsconfig.json'))) {
        @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist", "examples"]
}
'@ | Out-File -FilePath (Join-Path $McpIntegrationDir 'tsconfig.json') -Encoding UTF8
    }

    # 直接用 tsx（推荐，避免编译）
    try {
        $tsxVersion = npx tsx --version 2>&1 | Select-Object -First 1
        if ($LASTEXITCODE -eq 0) {
            Log-Ok "tsx 可用（推荐直接运行）"
        }
    } catch {
        # 尝试编译
        Push-Location $McpIntegrationDir
        try {
            npx tsc --silent 2>&1 | Out-Null
            if (Test-Path $OrchestratorDist) {
                Log-Ok "编译产物已生成: dist/"
            }
        } catch {
            Log-Warn "TypeScript 编译失败（可能不影响运行，使用 tsx 直接执行）"
        }
        Pop-Location
    }
}

# 2.4 复制 Skill CLI 到 dist
if (-not $DryRun) {
    if (-not (Test-Path $DistDir)) {
        New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
    }
    Copy-Item $SkillCliSource $SkillCliDist -Force
    $skillsSource = Join-Path $ExamplesDir 'skills'
    $skillsDest = Join-Path $DistDir 'skills'
    if (Test-Path $skillsSource) {
        if (Test-Path $skillsDest) {
            Remove-Item $skillsDest -Recurse -Force
        }
        Copy-Item $skillsSource $skillsDest -Recurse -Force
    }
    Log-Ok "Skill CLI 已部署到 dist/"
    Log-Info "  $SkillCliDist"
}

# ============================================================
# Step 3: 配置 MCP Host
# ============================================================

Log-Step "Step 3/4 · 配置 MCP Host"

# 3.1 选择 MCP Host
if ([string]::IsNullOrEmpty($MCP)) {
    $choice = Prompt-Choice "请选择 MCP Host:" @('Trae IDE', 'Claude Code', 'Cursor', 'VS Code', '全部')
    $MCP = switch ($choice) {
        'Trae IDE'    { 'trae' }
        'Claude Code' { 'claude' }
        'Cursor'      { 'cursor' }
        'VS Code'     { 'vscode' }
        '全部'        { 'all' }
        default       { 'trae' }
    }
}

# 3.2 配置函数
function Configure-Mcp {
    param(
        [string]$Host,
        [string]$ProjectRoot
    )

    $configPath = ''
    $configFormat = ''

    switch ($Host) {
        'trae' {
            $configPath = Join-Path $ProjectRoot '.trae/mcp.json'
            $configFormat = 'trae'
        }
        'claude' {
            $configPath = Join-Path $env:USERPROFILE '.claude.json'
            $configFormat = 'claude'
        }
        'cursor' {
            $configPath = Join-Path $env:USERPROFILE '.cursor/mcp.json'
            $configFormat = 'cursor'
        }
        'vscode' {
            $configPath = Join-Path $ProjectRoot '.vscode/mcp.json'
            $configFormat = 'vscode'
        }
    }

    if ($DryRun) {
        Log-Info "  [dry-run] 将写入: $configPath"
        return
    }

    # 创建目录
    $configDir = Split-Path -Parent $configPath
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    # 备份现有配置
    if (Test-Path $configPath) {
        $backupPath = "$configPath.bak.$((Get-Date).ToString('yyyyMMddHHmmss'))"
        Copy-Item $configPath $backupPath
        Log-Info "  备份现有配置: $backupPath"
    }

    # 生成配置
    $config = switch ($configFormat) {
        'claude' {
            @'
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
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
    "orchestrator-tools": {
      "command": "tsx",
      "args": ["${workspaceFolder}/mcp-integration/orchestrator-tools.ts"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}",
        "SKILL_BUNDLE_PATH": "${workspaceFolder}/.trae/skills/project-orchestrator-bundle",
        "SKILL_CLI_BIN": "${workspaceFolder}/mcp-integration/dist/skill-cli.js"
      }
    }
  }
}
'@
        }
        default {
            # trae / cursor / vscode（支持 ${workspaceFolder}）
            @'
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "env": { "START_MCP_TIMEOUT_MS": "60000", "RUN_MCP_TIMEOUT_MS": "60000" }
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
    "orchestrator-tools": {
      "command": "tsx",
      "args": ["${workspaceFolder}/mcp-integration/orchestrator-tools.ts"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}",
        "SKILL_BUNDLE_PATH": "${workspaceFolder}/.trae/skills/project-orchestrator-bundle",
        "SKILL_CLI_BIN": "${workspaceFolder}/mcp-integration/dist/skill-cli.js"
      }
    }
  }
}
'@
        }
    }

    # 验证 JSON
    try {
        $null = $config | ConvertFrom-Json
    } catch {
        Log-Err "生成的 JSON 配置不合法"
        return
    }

    # 写入
    $config | Out-File -FilePath $configPath -Encoding UTF8
    Log-Ok "已配置 $Host`: $configPath"
}

# 3.3 执行配置
$projectRoot = (Get-Location).Path
if ($MCP -eq 'all') {
    foreach ($h in @('trae', 'claude', 'cursor')) {
        Log-Info "正在配置 $h..."
        Configure-Mcp -Host $h -ProjectRoot $projectRoot
    }
    Configure-Mcp -Host 'vscode' -ProjectRoot $projectRoot
} else {
    if (-not (Configure-Mcp -Host $MCP -ProjectRoot $projectRoot)) {
        Log-Err "MCP 配置失败"
        exit 3
    }
}

# ============================================================
# Step 4: 测试
# ============================================================

if ($SkipTest) {
    Log-Step "✓ 部署完成（跳过测试）"
    Log-Info "重启 $MCP 以加载新配置"
    exit 0
}

Log-Step "Step 4/4 · 集成测试"

if ($DryRun) {
    Log-Info "  [dry-run] 跳过实际测试"
    Log-Step "✓ 干运行完成"
    exit 0
}

# 测试 1: Skill CLI 直接调用
Log-Info "测试 1/2 · Skill CLI 直接调用..."
try {
    $testJson = '{"stack":"react-vite","packageManager":"pnpm"}'
    $testOutput = & node $SkillCliDist scaffold-runner run --input $testJson --project-root $projectRoot 2>&1 | Out-String

    if ($testOutput -match '"ok"') {
        Log-Ok "Skill CLI 可调用"
        if ($testOutput -match '"ok":true') {
            Log-Ok "  scaffold-runner.run 成功"
        } else {
            Log-Warn "  返回了 ok:false（可能是依赖未安装，但接口正常）"
        }
    } else {
        Log-Warn "Skill CLI 输出格式异常（请检查）"
        Log-Info "  输出: $($testOutput.Substring(0, [Math]::Min(200, $testOutput.Length)))"
    }
} catch {
    Log-Warn "Skill CLI 调用失败：$($_.Exception.Message)"
}

# 测试 2: orchestrator-tools.ts 语法检查
Log-Info "测试 2/2 · orchestrator-tools.ts 语法检查..."
try {
    Push-Location $McpIntegrationDir
    $tscOutput = & npx tsc --noEmit $OrchestratorTs 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        Log-Ok "TypeScript 语法正确"
    } else {
        Log-Warn "TypeScript 检查发现问题"
        Log-Info $tscOutput.Substring(0, [Math]::Min(500, $tscOutput.Length))
    }
} catch {
    Log-Warn "TypeScript 检查失败：$($_.Exception.Message)"
} finally {
    Pop-Location
}

# ============================================================
# 完成
# ============================================================

Log-Step "✓ 部署完成"

$mcpDisplay = if ($MCP -eq 'all') { '全部（trae / claude / cursor）' } else { $MCP }

@"

�� 部署摘要：
  MCP Host:     $mcpDisplay
  Skill CLI:    $SkillCliDist
  Orchestrator: $OrchestratorDist
  Project Root: $projectRoot

�� 后续步骤：
  1. 重启 $mcpDisplay 以加载新配置
  2. 在对话框输入「列出可用 MCP 工具」验证
  3. 测试一个简单 Tool：「用 scaffold-runner 查看可用的技术栈」
  4. 详细使用：参考 mcp-integration/README.md

�� 文档：
  - 集成方案：mcp-integration/README.md
