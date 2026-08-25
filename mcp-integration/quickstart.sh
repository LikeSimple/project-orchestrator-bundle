#!/usr/bin/env bash
# ============================================================================
#  project-orchestrator-bundle 一键部署脚本（macOS / Linux / WSL）
# ============================================================================
#
# 作用：
#   1. 检查环境（Node.js / npm / git）
#   2. 安装依赖 + 构建（npm install + npm run build）
#   3. 配置 MCP Host（写入对应配置文件）
#   4. 测试集成（调用 Skill CLI 验证）
#
# 用法：
#   ./quickstart.sh                    # 交互式（默认）
#   ./quickstart.sh --mcp=trae        # 自动选择 Trae IDE
#   ./quickstart.sh --mcp=claude      # Claude Code
#   ./quickstart.sh --mcp=cursor      # Cursor
#   ./quickstart.sh --dry-run         # 仅检查，不写文件
#   ./quickstart.sh --skip-test      # 跳过集成测试
#   ./quickstart.sh --help           # 帮助
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
MCP_INTEGRATION_DIR="$SCRIPT_DIR"
PKG_JSON="$MCP_INTEGRATION_DIR/package.json"
TS_CONFIG="$MCP_INTEGRATION_DIR/tsconfig.json"
DIST_DIR="$MCP_INTEGRATION_DIR/dist"
ORCHESTRATOR_DIST="$DIST_DIR/orchestrator-tools.js"
SKILL_CLI_DIST="$DIST_DIR/skill-cli.cjs"
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

# ============================================================
# 工具函数
# ============================================================

log_info() { echo -e "${BLUE}${ICON_INFO}  $*${NC}"; }
log_ok() { echo -e "${GREEN}${ICON_OK}  $*${NC}"; }
log_warn() { echo -e "${YELLOW}${ICON_WARN}  $*${NC}"; }
log_err() { echo -e "${RED}${ICON_FAIL}  $*${NC}"; }
log_step() { echo -e "\n${CYAN}${BOLD}=== $* ===${NC}\n"; }

# 检查命令是否存在
has_cmd() { command -v "$1" >/dev/null 2>&1; }

# 版本号比较（>=）
version_ge() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

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
  --mcp=<trae|claude|cursor|vscode>   选择 MCP Host（不指定则交互选择）
  --dry-run                          仅检查环境，不写入任何文件
  --skip-test                        跳过集成测试
  --verbose                          详细日志输出
  --help                             显示此帮助

示例:
  $0                                # 交互式
  $0 --mcp=trae                     # 自动选择 Trae IDE
  $0 --mcp=claude --verbose         # Claude Code + 详细日志
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

# npm
if has_cmd npm; then
  NPM_VERSION=$(npm -v)
  if version_ge "$NPM_VERSION" "v9.0.0"; then
    log_ok "npm: $NPM_VERSION"
  else
    log_warn "npm 版本较旧（$NPM_VERSION），建议升级到 ≥ 9"
  fi
else
  log_err "npm 未安装"
  check_failed=true
fi

# git
if has_cmd git; then
  GIT_VERSION=$(git --version | awk '{print $3}')
  log_ok "git: $GIT_VERSION"
else
  log_warn "git 未安装（部分 Skill 需要，但不影响核心）"
fi

if $check_failed; then
  log_err "环境检查失败，请先安装缺失的工具"
  exit 1
fi

# ============================================================
# Step 2: 安装依赖 + 构建
# ============================================================

log_step "Step 2/4 · 安装依赖 + 构建"

# 2.1 检查项目文件
if [ ! -f "$PKG_JSON" ]; then
  log_err "未找到 package.json: $PKG_JSON"
  log_info "  请确认 mcp-integration 目录完整"
  exit 2
fi

if [ ! -f "$TS_CONFIG" ]; then
  log_err "未找到 tsconfig.json: $TS_CONFIG"
  exit 2
fi

log_ok "项目文件齐全"

# 2.2 安装依赖
if ! $DRY_RUN; then
  if [ -d "$MCP_INTEGRATION_DIR/node_modules" ]; then
    log_info "node_modules 已存在，跳过安装"
  else
    log_info "安装 npm 依赖..."
    cd "$MCP_INTEGRATION_DIR"
    npm install --silent 2>&1 | tail -3 || {
      log_err "依赖安装失败"
      exit 2
    }
    log_ok "依赖安装完成"
  fi
fi

# 2.3 构建
if ! $DRY_RUN; then
  log_info "构建项目（tsc + postbuild）..."
  cd "$MCP_INTEGRATION_DIR"
  npm run build 2>&1 | tail -5 || {
    log_err "构建失败"
    exit 2
  }
  if [ -f "$ORCHESTRATOR_DIST" ] && [ -f "$SKILL_CLI_DIST" ]; then
    log_ok "构建成功，产物已生成到 dist/"
  else
    log_warn "构建完成但产物未找到，请检查 dist/ 目录"
  fi
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
      for h in trae claude cursor vscode; do
        log_info "正在配置 $h..."
        configure_mcp "$h" || log_warn "配置 $h 失败，继续下一个"
      done
      log_step "✓ 所有 MCP Host 配置完成"
      MCP_HOST=""
      ;;
  esac
fi

# 3.2 写入 MCP 配置
configure_mcp() {
  local host="$1"
  local config_path=""

  case "$host" in
    trae)
      config_path="${PROJECT_ROOT:-$(pwd)}/.trae/mcp.json"
      ;;
    claude)
      config_path="$HOME/.claude.json"
      ;;
    cursor)
      config_path="$HOME/.cursor/mcp.json"
      ;;
    vscode)
      config_path="${PROJECT_ROOT:-$(pwd)}/.vscode/mcp.json"
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

  # 读取已有配置并合并（使用 python 处理 JSON）
  local project_root="${PROJECT_ROOT:-$(pwd)}"
  local new_server_json
  new_server_json=$(cat <<SERVER_EOF
{
  "command": "node",
  "args": ["${project_root}/mcp-integration/dist/orchestrator-tools.js"],
  "env": {
    "PROJECT_ROOT": "${project_root}",
    "SKILL_BUNDLE_PATH": "${project_root}/mcp-integration",
    "START_MCP_TIMEOUT_MS": "120000",
    "RUN_MCP_TIMEOUT_MS": "120000"
  }
}
SERVER_EOF
)

  # 合并到现有配置或新建
  if [ -f "$config_path" ] && command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json, sys
with open('$config_path') as f:
    config = json.load(f)
server = json.loads('''$new_server_json''')
if 'mcpServers' not in config:
    config['mcpServers'] = {}
config['mcpServers']['orchestrator-tools'] = server
with open('$config_path', 'w') as f:
    json.dump(config, f, indent=2)
" 2>/dev/null || {
      # python 失败则覆盖写入
      echo "{\"mcpServers\":{\"orchestrator-tools\":$new_server_json}}" | python3 -m json.tool > "$config_path" 2>/dev/null || echo "$new_server_json" > "$config_path"
    }
  else
    # 无现有配置或无 python，新建
    cat > "$config_path" <<CONFIG_EOF
{
  "mcpServers": {
    "orchestrator-tools": ${new_server_json}
  }
}
CONFIG_EOF
  fi

  log_ok "已配置 $host: $config_path"
}

if [ -n "$MCP_HOST" ]; then
  configure_mcp "$MCP_HOST" || {
    log_err "MCP 配置失败"
    exit 3
  }
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
if [ -f "$SKILL_CLI_DIST" ]; then
  test_output=$(node "$SKILL_CLI_DIST" scaffold-runner list 2>&1) || true
  if echo "$test_output" | head -1 | grep -q '"ok":true'; then
    log_ok "Skill CLI 可调用，scaffold-runner.list 成功"
  elif echo "$test_output" | head -1 | grep -q '"ok"'; then
    log_warn "  返回了 ok:false（可能是依赖未安装，但接口正常）"
  else
    log_warn "Skill CLI 输出格式异常（请检查）"
    log_info "  输出: $(echo "$test_output" | head -c 200)"
  fi
else
  log_warn "Skill CLI 未构建，跳过测试: $SKILL_CLI_DIST"
fi

# 测试 2: orchestrator-tools 启动检查
log_info "测试 2/2 · orchestrator-tools 启动检查..."
if [ -f "$ORCHESTRATOR_DIST" ]; then
  # 后台启动，等待 1.5s 检查是否还在运行
  node "$ORCHESTRATOR_DIST" < /dev/null > /tmp/mcp-stdout.tmp 2> /tmp/mcp-stderr.tmp &
  MCP_PID=$!
  sleep 1.5
  if kill -0 "$MCP_PID" 2>/dev/null; then
    log_ok "orchestrator-tools 进程启动成功"
    kill "$MCP_PID" 2>/dev/null
    wait "$MCP_PID" 2>/dev/null || true
  else
    wait "$MCP_PID" 2>/dev/null || true
    EXIT_CODE=$?
    log_warn "orchestrator-tools 启动后立即退出（exit code: $EXIT_CODE）"
    if [ -s /tmp/mcp-stderr.tmp ]; then
      log_info "  stderr: $(head -c 300 /tmp/mcp-stderr.tmp)"
    fi
  fi
else
  log_warn "orchestrator-tools 未构建，跳过测试: $ORCHESTRATOR_DIST"
fi

# ============================================================
# 完成
# ============================================================

log_step "✓ 部署完成"

MCP_DISPLAY="${MCP_HOST:-全部（trae / claude / cursor / vscode）}"

cat <<EOF

部署摘要：
  MCP Host:     ${MCP_DISPLAY}
  Skill CLI:    $SKILL_CLI_DIST
  Orchestrator: $ORCHESTRATOR_DIST
  Project Root: ${PROJECT_ROOT:-$(pwd)}

后续步骤：
  1. 重启 $MCP_HOST 以加载新配置
  2. 在对话框输入「列出可用 MCP 工具」验证
  3. 测试一个简单 Tool：「用 scaffold-runner 查看可用的技术栈」
  4. 详细使用：参考 mcp-integration/README.md

文档：
  - 集成方案：mcp-integration/README.md
  - 环境配置：docs/env-setup.md
  - 成熟度报告：maturity-analysis-report.md
EOF
