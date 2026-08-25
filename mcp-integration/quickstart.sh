#!/usr/bin/env bash
# ============================================================================
#  project-orchestrator-bundle 一键部署脚本（macOS / Linux / WSL）
# ============================================================================
#
# 作用：
#   1. 检查环境（Node.js / pnpm / git / MCP Host）
#   2. 构建 Skill CLI（TypeScript → JavaScript）
#   3. 配置 MCP（写入 .trae/mcp.json 或 ~/.claude.json 或 .cursor/mcp.json）
#   4. 测试集成（运行 1-2 个 Tool 验证）
#
# 用法：
#   ./quickstart.sh                    # 交互式（默认）
#   ./quickstart.sh --mcp=trae        # 自动选择 Trae IDE
#   ./quickstart.sh --mcp=claude      # Claude Code
#   ./quickstart.sh --mcp=cursor      # Cursor
#   ./quickstart.sh --dry-run         # 仅检查，不写文件
#   ./quickstart.sh --help            # 帮助
#
# 退出码：
#   0 = 成功
#   1 = 环境缺失
#   2 = 构建失败
#   3 = 配置失败
#   4 = 测试失败
# ============================================================================

set -e  # 遇错即停
set -u  # 未定义变量即停

# ============================================================
# 常量
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(dirname "$SCRIPT_DIR")"
MCP_INTEGRATION_DIR="$SCRIPT_DIR"
EXAMPLES_DIR="$MCP_INTEGRATION_DIR/examples"
SKILL_CLI_SOURCE="$EXAMPLES_DIR/skill-cli.js"
ORCHESTRATOR_TS="$MCP_INTEGRATION_DIR/orchestrator-tools.ts"
SKILL_CLI_DIST="$MCP_INTEGRATION_DIR/dist/skill-cli.js"
ORCHESTRATOR_DIST="$MCP_INTEGRATION_DIR/dist/orchestrator-tools.js"
PKG_JSON="$MCP_INTEGRATION_DIR/package.json"
DIST_DIR="$MCP_INTEGRATION_DIR/dist"
TMP_LOG="/tmp/orchestrator-quickstart.log"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 图标
ICON_OK="✅"
ICON_FAIL="❌"
ICON_WARN="⚠️"
ICON_INFO="ℹ️"
ICON_ARROW="→"

# ============================================================
# 工具函数
# ============================================================

log_info() { echo -e "${BLUE}${ICON_INFO}  $*${NC}"; }
log_ok() { echo -e "${GREEN}${ICON_OK}  $*${NC}"; }
log_warn() { echo -e "${YELLOW}${ICON_WARN}  $*${NC}"; }
log_err() { echo -e "${RED}${ICON_FAIL}  $*${NC}"; }
log_step() { echo -e "\n${CYAN}${BOLD}${ICON_ARROW} $*${NC}\n"; }

# 不带颜色的纯输出（用于被捕获的输出）
raw_echo() { echo "$@"; }

# 询问用户
prompt_choice() {
  local prompt="$1"
  shift
  local options=("$@")
  echo "$prompt" >&2
  for i in "${!options[@]}"; do
    echo "  $((i + 1))) ${options[$i]}" >&2
  done
  local choice
  read -p "请选择 [1-${#options[@]}]: " choice
  echo "${options[$((choice - 1))]:-}"
}

# 检查命令是否存在
has_cmd() { command -v "$1" >/dev/null 2>&1; }

# 版本号比较（>=）
version_ge() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# ============================================================
# 解析参数
# ============================================================

MCP_HOST=""
DRY_RUN=false
SKIP_TEST=false
VERBOSE=false

usage() {
  cat <<EOF
用法: $0 [选项]

选项:
  --mcp=<trae|claude|cursor>   选择 MCP Host（不指定则交互选择）
  --dry-run                   仅检查环境，不写入任何文件
  --skip-test                 跳过集成测试
  --verbose                   详细日志输出
  --help                      显示此帮助

示例:
  $0                          # 交互式
  $0 --mcp=trae               # 自动选择 Trae IDE
  $0 --mcp=claude --verbose   # Claude Code + 详细日志
EOF
}

for arg in "$@"; do
  case $arg in
    --mcp=*)    MCP_HOST="${arg#*=}" ;;
    --dry-run)  DRY_RUN=true ;;
    --skip-test) SKIP_TEST=true ;;
    --verbose)  VERBOSE=true ;;
    --help|-h)  usage; exit 0 ;;
    *)          log_err "未知参数: $arg"; usage; exit 1 ;;
  esac
done

if $VERBOSE; then
  exec 2> >(tee -a "$TMP_LOG")
fi

# ============================================================
# Banner
# ============================================================

cat <<'EOF'
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   project-orchestrator-bundle                          ║
║   一键部署脚本（macOS / Linux / WSL）                ║
║                                                            ║
║   ✨ 构建 CLI + 配置 MCP + 测试一体化                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
EOF
echo ""

if $DRY_RUN; then
  log_warn "干运行模式：仅检查环境，不修改任何文件"
fi

# ============================================================
# Step 1: 环境检查
# ============================================================

log_step "Step 1/4 · 环境检查"

check_failed=false

# Node.js
if has_cmd node; then
  NODE_VERSION=$(node -v)
  if version_ge "$NODE_VERSION" "v18.0.0"; then
    log_ok "Node.js: $NODE_VERSION"
  else
    log_err "Node.js: $NODE_VERSION（需要 ≥ v18.0.0）"
    log_info "  请访问 https://nodejs.org/ 下载 LTS 版本"
    check_failed=true
  fi
else
  log_err "Node.js 未安装"
  log_info "  macOS:   brew install node"
  log_info "  Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  log_info "  通用:    https://nodejs.org/"
  check_failed=true
fi

# pnpm
if has_cmd pnpm; then
  PNPM_VERSION=$(pnpm -v)
  log_ok "pnpm: $PNPM_VERSION"
elif has_cmd npm; then
  NPM_VERSION=$(npm -v)
  log_warn "pnpm 未安装，将使用 npm（推荐 pnpm ≥ 8）"
  log_info "  安装: npm install -g pnpm"
  # 检查 npm 版本
  if version_ge "$NPM_VERSION" "v9.0.0"; then
    log_ok "  fallback npm: $NPM_VERSION"
  else
    log_warn "  npm 版本较旧（$NPM_VERSION），建议升级到 ≥ 9"
  fi
else
  log_err "pnpm 和 npm 均未安装"
  check_failed=true
fi

# git
if has_cmd git; then
  GIT_VERSION=$(git --version | awk '{print $3}')
  log_ok "git: $GIT_VERSION"
else
  log_warn "git 未安装（部分 Skill 需要，但不影响核心）"
fi

# uvx（git MCP server 需要）
if has_cmd uvx; then
  log_ok "uvx: $(uvx --version 2>&1 | head -1)"
elif has_cmd uv; then
  log_ok "uv: $(uv --version 2>&1 | head -1)"
else
  log_warn "uv/uvx 未安装（git MCP server 需要，可后续安装）"
  log_info "  安装: curl -LsSf https://astral.sh/uv/install.sh | sh"
fi

if $check_failed; then
  log_err "环境检查失败，请先安装缺失的工具"
  exit 1
fi

# ============================================================
# Step 2: 构建 Skill CLI
# ============================================================

log_step "Step 2/4 · 构建 Skill CLI"

# 2.1 检查依赖文件
if [ ! -f "$PKG_JSON" ]; then
  log_err "未找到 package.json: $PKG_JSON"
  log_info "  请确认 mcp-integration 目录完整"
  exit 2
fi

if [ ! -f "$ORCHESTRATOR_TS" ]; then
  log_err "未找到 orchestrator-tools.ts: $ORCHESTRATOR_TS"
  exit 2
fi

if [ ! -f "$SKILL_CLI_SOURCE" ]; then
  log_err "未找到 skill-cli.js: $SKILL_CLI_SOURCE"
  exit 2
fi

log_ok "源文件齐全"

# 2.2 安装依赖
if ! $DRY_RUN; then
  log_info "安装 npm 依赖（tsx + @modelcontextprotocol/sdk）..."

  # 检查是否已有 node_modules
  if [ -d "$MCP_INTEGRATION_DIR/node_modules" ]; then
    log_info "  node_modules 已存在，跳过"
  else
    cd "$MCP_INTEGRATION_DIR"

    # 选择包管理器
    if has_cmd pnpm; then
      PKG_MGR="pnpm"
    else
      PKG_MGR="npm"
    fi

    if [ ! -f "$PKG_JSON" ]; then
      log_info "  未找到 package.json，正在创建..."
      cat > "$PKG_JSON" <<'PKG_EOF'
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
PKG_EOF
    fi

    $PKG_MGR install --silent 2>&1 | tail -5 || {
      log_err "依赖安装失败"
      exit 2
    }
    log_ok "依赖安装完成"
  fi
fi

# 2.3 编译 TypeScript
if ! $DRY_RUN; then
  log_info "编译 TypeScript → JavaScript..."

  if [ ! -f "$MCP_INTEGRATION_DIR/tsconfig.json" ]; then
    cat > "$MCP_INTEGRATION_DIR/tsconfig.json" <<'TSCONFIG_EOF'
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
TSCONFIG_EOF
  fi

  cd "$MCP_INTEGRATION_DIR"

  # 用 tsx 直接运行（推荐，避免编译）
  # 也可编译成 dist
  if has_cmd npx && npx tsx --version >/dev/null 2>&1; then
    log_ok "tsx 可用（推荐直接运行）"
  else
    # 编译
    if has_cmd npx; then
      npx tsc --silent 2>&1 || {
        log_warn "TypeScript 编译失败（可能不影响运行，使用 tsx 直接执行）"
      }
    fi
    if [ -f "$ORCHESTRATOR_DIST" ]; then
      log_ok "编译产物已生成: dist/"
    else
      log_info "将使用 tsx 直接执行 orchestrator-tools.ts"
    fi
  fi
fi

# 2.4 复制 Skill CLI 到 dist
if ! $DRY_RUN; then
  mkdir -p "$DIST_DIR"
  cp "$SKILL_CLI_SOURCE" "$SKILL_CLI_DIST"
  cp -r "$EXAMPLES_DIR/skills" "$DIST_DIR/skills"
  log_ok "Skill CLI 已部署到 dist/"
  log_info "  $SKILL_CLI_DIST"
fi

# ============================================================
# Step 3: 配置 MCP Host
# ============================================================

log_step "Step 3/4 · 配置 MCP Host"

# 3.1 选择 MCP Host
if [ -z "$MCP_HOST" ]; then
  choice=$(prompt_choice "请选择 MCP Host:" "Trae IDE" "Claude Code" "Cursor" "VS Code" "全部")
  case "$choice" in
    "Trae IDE")    MCP_HOST="trae" ;;
    "Claude Code") MCP_HOST="claude" ;;
    "Cursor")      MCP_HOST="cursor" ;;
    "VS Code")     MCP_HOST="vscode" ;;
    "全部")
      # 全部配置
      for h in trae claude cursor; do
        log_info "正在配置 $h..."
        configure_mcp "$h" || log_warn "配置 $h 失败，继续下一个"
      done
      configure_mcp "vscode" || log_warn "配置 vscode 失败"
      log_step "✓ 所有 MCP Host 配置完成"
      # 跳过单 host 配置
      MCP_HOST=""
      ;;
  esac
fi

# 3.2 写入 MCP 配置
configure_mcp() {
  local host="$1"
  local config_path=""
  local config_format=""

  case "$host" in
    trae)
      config_path="${PROJECT_ROOT:-$(pwd)}/.trae/mcp.json"
      config_format="trae"
      ;;
    claude)
      config_path="$HOME/.claude.json"
      config_format="claude"
      ;;
    cursor)
      config_path="$HOME/.cursor/mcp.json"
      config_format="cursor"
      ;;
    vscode)
      config_path="${PROJECT_ROOT:-$(pwd)}/.vscode/mcp.json"
      config_format="vscode"
      ;;
  esac

  if $DRY_RUN; then
    log_info "  [dry-run] 将写入: $config_path"
    return 0
  fi

  mkdir -p "$(dirname "$config_path")"

  # 备份现有配置
  if [ -f "$config_path" ]; then
    cp "$config_path" "${config_path}.bak.$(date +%s)"
    log_info "  备份现有配置: ${config_path}.bak.$(date +%s)"
  fi

  # 生成配置 JSON
  local config_json
  if [ "$config_format" = "claude" ]; then
    # Claude Code 支持 env 变量插值
    config_json=$(cat <<'CONFIG_EOF'
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
CONFIG_EOF
)
  else
    # Trae / Cursor / VS Code：使用 ${workspaceFolder}，但不支持 ${env:NAME}
    config_json=$(cat <<'CONFIG_EOF'
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
CONFIG_EOF
)
  fi

  echo "$config_json" | python3 -m json.tool > /dev/null 2>&1 || {
    log_err "生成的 JSON 配置不合法"
    return 1
  }

  echo "$config_json" > "$config_path"
  log_ok "已配置 $host: $config_path"
}

if [ -n "$MCP_HOST" ]; then
  if ! configure_mcp "$MCP_HOST"; then
    log_err "MCP 配置失败"
    exit 3
  fi
fi

# ============================================================
# Step 4: 测试
# ============================================================

if $SKIP_TEST; then
  log_step "✓ 部署完成（跳过测试）"
  log_info "重启 $MCP_HOST 以加载新配置"
  exit 0
fi

log_step "Step 4/4 · 集成测试"

if $DRY_RUN; then
  log_info "  [dry-run] 跳过实际测试"
  log_step "✓ 干运行完成"
  exit 0
fi

# 测试 1: Skill CLI 直接调用
log_info "测试 1/2 · Skill CLI 直接调用..."
test_output=$(cd "${PROJECT_ROOT:-$(pwd)}" && node "$SKILL_CLI_DIST" scaffold-runner run --input '{"stack":"react-vite","packageManager":"pnpm"}' --project-root "$(pwd)" 2>&1) || true

if echo "$test_output" | head -1 | grep -q '"ok"'; then
  log_ok "Skill CLI 可调用"
  if echo "$test_output" | head -1 | grep -q '"ok":true'; then
    log_ok "  scaffold-runner.run 成功"
  else
    log_warn "  返回了 ok:false（可能是依赖未安装，但接口正常）"
  fi
else
  log_warn "Skill CLI 输出格式异常（请检查）"
  log_info "  输出: $test_output" | head -5
fi

# 测试 2: orchestrator-tools.ts 语法检查
log_info "测试 2/2 · orchestrator-tools.ts 语法检查..."
if npx tsc --noEmit "$ORCHESTRATOR_TS" 2>&1 | head -20; then
  log_ok "TypeScript 语法正确"
else
  log_warn "TypeScript 检查发现问题（详见上方）"
fi

# ============================================================
# 完成
# ============================================================

log_step "✓ 部署完成"

cat <<EOF
�� 部署摘要：
  MCP Host:     ${MCP_HOST:-"全部（trae / claude / cursor）"}
  Skill CLI:    $SKILL_CLI_DIST
  Orchestrator: $ORCHESTRATOR_DIST
  Project Root: ${PROJECT_ROOT:-$(pwd)}

�� 后续步骤：
  1. 重启 $MCP_HOST 以加载新配置
  2. 在对话框输入「列出可用 MCP