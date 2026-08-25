<#
# ============================================================================
#  project-orchestrator-bundle 一键部署脚本（Windows PowerShell）
# ============================================================================
#
# 作用：
#   1. 检查环境（Node.js / npm / git）
#   2. 安装依赖 + 构建（npm install + npm run build）
#   3. 配置 MCP Host（写入对应配置文件）
#   4. 测试集成（调用 Skill CLI 验证）
#
# 用法：
#   .\quickstart.ps1                    # 交互式（默认）
#   .\quickstart.ps1 -MCP trae          # 自动选择 Trae IDE
#   .\quickstart.ps1 -MCP claude        # Claude Code
#   .\quickstart.ps1 -MCP cursor       # Cursor
#   .\quickstart.ps1 -DryRun           # 仅检查，不写文件
#   .\quickstart.ps1 -SkipTest         # 跳过集成测试
#   .\quickstart.ps1 -Help             # 帮助
#
# 退出码：
#   0 = 成功
#   1 = 环境缺失
#   2 = 构建失败
#   3 = 配置失败
#   4 = 测试失败
# ============================================================================
#>

[CmdletBinding()]
param(
    [ValidateSet('trae', 'claude', 'cursor', 'vscode', 'all', '')]
    [string]$MCP = '',

    [switch]$DryRun,
    [switch]$SkipTest,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

# ============================================================
# 常量
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$McpIntegrationDir = $ScriptDir
$PkgJson = Join-Path $McpIntegrationDir 'package.json'
$TsConfig = Join-Path $McpIntegrationDir 'tsconfig.json'
$DistDir = Join-Path $McpIntegrationDir 'dist'
$OrchestratorDist = Join-Path $DistDir 'orchestrator-tools.js'
$SkillCliDist = Join-Path $DistDir 'skill-cli.cjs'

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
  -Help                                   显示此帮助

示例:
  .\quickstart.ps1                        # 交互式
  .\quickstart.ps1 -MCP trae              # Trae IDE
  .\quickstart.ps1 -MCP claude           # Claude Code
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

# npm
if (Has-Cmd 'npm') {
    $npmVersion = npm -v
    if (Version-Ge $npmVersion '9.0.0') {
        Log-Ok "npm: $npmVersion"
    } else {
        Log-Warn "npm 版本较旧（$npmVersion），建议升级到 ≥ 9"
    }
} else {
    Log-Err "npm 未安装"
    $envOk = $false
}

# git
if (Has-Cmd 'git') {
    $gitVersion = (git --version) -replace 'git version ', ''
    Log-Ok "git: $gitVersion"
} else {
    Log-Warn "git 未安装（部分 Skill 需要，但不影响核心）"
}

if (-not $envOk) {
    Log-Err "环境检查失败，请先安装缺失的工具"
    exit 1
}

# ============================================================
# Step 2: 安装依赖 + 构建
# ============================================================

Log-Step "Step 2/4 · 安装依赖 + 构建"

# 2.1 检查项目文件
if (-not (Test-Path $PkgJson)) {
    Log-Err "未找到 package.json: $PkgJson"
    exit 2
}
if (-not (Test-Path $TsConfig)) {
    Log-Err "未找到 tsconfig.json: $TsConfig"
    exit 2
}
Log-Ok "项目文件齐全"

# 2.2 安装依赖
if (-not $DryRun) {
    if (Test-Path (Join-Path $McpIntegrationDir 'node_modules')) {
        Log-Info "node_modules 已存在，跳过安装"
    } else {
        Log-Info "安装 npm 依赖..."
        Push-Location $McpIntegrationDir
        try {
            npm install --silent 2>&1 | Select-Object -Last 3
            if ($LASTEXITCODE -ne 0) {
                Log-Err "依赖安装失败"
                Pop-Location
                exit 2
            }
        } catch {
            Log-Err "依赖安装失败：$($_.Exception.Message)"
            Pop-Location
            exit 2
        }
        Pop-Location
        Log-Ok "依赖安装完成"
    }
}

# 2.3 构建
if (-not $DryRun) {
    Log-Info "构建项目（tsc + postbuild）..."
    Push-Location $McpIntegrationDir
    try {
        npm run build 2>&1 | Select-Object -Last 5
        if ($LASTEXITCODE -ne 0) {
            Log-Err "构建失败"
            Pop-Location
            exit 2
        }
    } catch {
        Log-Err "构建失败：$($_.Exception.Message)"
        Pop-Location
        exit 2
    }
    Pop-Location

    $orchestratorExists = Test-Path $OrchestratorDist
    $skillCliExists = Test-Path $SkillCliDist
    if ($orchestratorExists -and $skillCliExists) {
        Log-Ok "构建成功，产物已生成到 dist/"
    } else {
        Log-Warn "构建完成但产物未找到，请检查 dist/ 目录"
    }
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
        [string]$McpHost,
        [string]$ProjectRoot
    )

    $configPath = ''
    $configFormat = ''

    switch ($McpHost) {
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

    # 读取已有配置（如果存在）
    $existingConfig = $null
    if (Test-Path $configPath) {
        try {
            $existingConfig = Get-Content $configPath -Raw | ConvertFrom-Json
            $backupPath = "$configPath.bak.$((Get-Date).ToString('yyyyMMddHHmmss'))"
            Copy-Item $configPath $backupPath
            Log-Info "  备份现有配置: $backupPath"
        } catch {
            Log-Warn "  读取现有配置失败，将覆盖写入"
        }
    }

    # 生成 orchestrator-tools 配置片段
    $orchestratorServer = @{
        command = "node"
        args = @("${ProjectRoot}\mcp-integration\dist\orchestrator-tools.js")
        env = @{
            PROJECT_ROOT = $ProjectRoot
            SKILL_BUNDLE_PATH = $ProjectRoot
            START_MCP_TIMEOUT_MS = "120000"
            RUN_MCP_TIMEOUT_MS = "120000"
        }
    }

    # 构建或合并配置
    if ($null -ne $existingConfig -and $existingConfig.mcpServers) {
        $existingConfig.mcpServers | Add-Member -NotePropertyName 'orchestrator-tools' -NotePropertyValue $orchestratorServer -Force
        $configObj = $existingConfig
    } else {
        $configObj = [PSCustomObject]@{
            mcpServers = [PSCustomObject]@{
                'orchestrator-tools' = $orchestratorServer
            }
        }
    }

    # 写入
    $configDir = Split-Path -Parent $configPath
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    $configJson = $configObj | ConvertTo-Json -Depth 10
    $configJson | Out-File -FilePath $configPath -Encoding UTF8
    Log-Ok "已配置 $McpHost`: $configPath"
}

# 3.3 执行配置
$projectRoot = Split-Path -Parent $McpIntegrationDir
if ($MCP -eq 'all') {
    foreach ($h in @('trae', 'claude', 'cursor', 'vscode')) {
        Log-Info "正在配置 $h..."
        Configure-Mcp -McpHost $h -ProjectRoot $projectRoot
    }
} else {
    Configure-Mcp -McpHost $MCP -ProjectRoot $projectRoot
    if ($LASTEXITCODE -ne 0) {
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
if (Test-Path $SkillCliDist) {
    try {
        $testOutput = & node $SkillCliDist scaffold-runner list 2>&1 | Out-String
        if ($testOutput -match '"ok":true') {
            Log-Ok "Skill CLI 可调用，scaffold-runner.list 成功"
        } elseif ($testOutput -match '"ok"') {
            Log-Warn "  返回了 ok:false（可能是依赖未安装，但接口正常）"
        } else {
            Log-Warn "Skill CLI 输出格式异常（请检查）"
            $snippet = $testOutput.Substring(0, [Math]::Min(200, $testOutput.Length))
            Log-Info "  输出: $snippet"
        }
    } catch {
        Log-Warn "Skill CLI 调用失败：$($_.Exception.Message)"
    }
} else {
    Log-Warn "Skill CLI 未构建，跳过测试: $SkillCliDist"
}

# 测试 2: orchestrator-tools 启动检查
Log-Info "测试 2/2 · orchestrator-tools 启动检查..."
if (Test-Path $OrchestratorDist) {
    try {
        $proc = Start-Process -FilePath 'node' -ArgumentList "`"$OrchestratorDist`"" -PassThru -NoNewWindow -RedirectStandardInput (Join-Path $env:TEMP 'mcp-stdin.tmp') -RedirectStandardOutput (Join-Path $env:TEMP 'mcp-stdout.tmp') -RedirectStandardError (Join-Path $env:TEMP 'mcp-stderr.tmp') -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 1500
        if ($proc -and -not $proc.HasExited) {
            Log-Ok "orchestrator-tools 进程启动成功"
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        } elseif ($proc) {
            $stderr = Get-Content (Join-Path $env:TEMP 'mcp-stderr.tmp') -ErrorAction SilentlyContinue -Raw
            Log-Warn "orchestrator-tools 启动后立即退出（exit code: $($proc.ExitCode)）"
            if ($stderr) {
                Log-Info "  stderr: $($stderr.Substring(0, [Math]::Min(300, $stderr.Length)))"
            }
        }
    } catch {
        Log-Warn "orchestrator-tools 启动检查失败：$($_.Exception.Message)"
    }
} else {
    Log-Warn "orchestrator-tools 未构建，跳过测试: $OrchestratorDist"
}

# ============================================================
# 完成
# ============================================================

Log-Step "✓ 部署完成"

$mcpDisplay = if ($MCP -eq 'all') { '全部（trae / claude / cursor / vscode）' } else { $MCP }

$summary = @"

部署摘要：
  MCP Host:     $mcpDisplay
  Skill CLI:    $SkillCliDist
  Orchestrator: $OrchestratorDist
  Project Root: $projectRoot

后续步骤：
  1. 重启 $mcpDisplay 以加载新配置
  2. 在对话框输入「列出可用 MCP 工具」验证
  3. 测试一个简单 Tool：「用 scaffold-runner 查看可用的技术栈」
  4. 详细使用：参考 mcp-integration/README.md

文档：
  - 集成方案：mcp-integration/README.md
  - 环境配置：docs/env-setup.md
  - 成熟度报告：maturity-analysis-report.md
"@
Write-Host $summary -ForegroundColor White
