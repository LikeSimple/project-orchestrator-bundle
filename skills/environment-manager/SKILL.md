---
name: environment-manager
description: |
 多环境配置管理 + Secrets 安全 + 环境变量注入 + 配置校验。
 支持 dev / staging / production / preview 四级环境，
 整合 Doppler / Vault / AWS Secrets Manager / 1Password。
 阻止 .env 误提交 + 强制 Secrets 不入代码库。
version: 1.0.0
tags:
  - configuration
  - secrets
  - environment-variables
  - multi-env
  - doppler
  - vault
entry-points:
  - init
  - set
  - get
  - diff
  - validate
  - rotate
  - inject
requires:
  - node: ">=18"
binds:
  - scaffold-runner
  - implement-executor
  - code-patterns
  - git-workflow
  - review-checklist
  - dependency-auditor
parent: project-orchestrator
phase: 2.7
position: environment-foundation
---

# environment-manager

> 让 Agent 安全地使用环境变量 + Secrets，杜绝"凭据进代码库"事故。

## 一、定位与价值

现代应用至少需要 dev / staging / production 三个环境，每个环境有不同的：
- 数据库连接
- API 密钥（Stripe / GitHub / AWS）
- 第三方服务凭证

直接用 `.env` 文件的问题：
- ❌ 容易误提交到 git（凭据泄露事故 80% 来源）
- ❌ 多环境切换靠手动复制，**人就会犯错**
- ❌ Secrets 轮换困难（涉及多处代码）
- ❌ 团队成员离职后 Secrets 不会自动回收

`environment-manager` 把这些问题系统化：
- ✅ Secrets 永远不入代码库
- ✅ 多环境一键切换
- ✅ Secrets 轮换一行命令完成
- ✅ 环境校验防止"staging 误连 production"

## 二、能力范围

### 2.1 `/init` 初始化

```bash
/environment-manager.init
# 内部自动：
# 1. 检测项目类型
# 2. 选择 Secrets 后端（默认 Doppler，可选 Vault / AWS / 1Password）
# 3. 创建 4 个环境：dev / staging / production / preview
# 4. 生成 .env.example 模板（不含真实值）
# 5. 配置 pre-commit hook 检测 .env 提交
# 6. 创建 README 文档（开发者入门指南）
```

### 2.2 `/set` 设置环境变量

```bash
# 普通变量（明文存储在 Doppler）
/environment-manager.set --env=dev --key=DATABASE_URL --value="postgres://localhost:5432/myapp_dev"

/environment-manager.set --env=production --key=DATABASE_URL --value="postgres://prod-server:5432/myapp"

# Secrets（加密存储）
/environment-manager.set --env=production --key=STRIPE_SECRET_KEY --secret --value="sk_live_..."
```

### 2.3 `/get` 读取

```bash
/environment-manager.get --env=dev --key=DATABASE_URL
# 输出：postgres://localhost:5432/myapp_dev

# 注入到运行时
/environment-manager.inject --env=dev --into=.env.local
# 生成 .env.local（加入 .gitignore）
```

### 2.4 `/diff` 对比环境

```bash
/environment-manager.diff --from=staging --to=production
# 输出：
#   DATABASE_URL:     same
#   REDIS_URL:        different (staging: redis-st; prod: redis-prod)
#   STRIPE_SECRET_KEY: different (secret, masked)
#   NEW_VARIABLE:     only in production
```

### 2.5 `/validate` 校验环境

```bash
/environment-manager.validate --env=production
# 检查：
#   - 所有必需变量已设置
#   - Secrets 不为空
#   - URL / Email 格式合法
#   - 端口在合理范围
#   - 没有误用 dev URL 在 production
```

### 2.6 `/rotate` 轮换 Secrets

```bash
/environment-manager.rotate --env=production --key=STRIPE_SECRET_KEY
# 1. 生成新 secret
# 2. 通知 Stripe API 创建新 key
# 3. 同步到 Doppler
# 4. 触发应用重新部署
# 5. 等待 24h 观察期
# 6. 撤销旧 key
```

### 2.7 `/inject` 运行时注入

```bash
# 本地开发：自动注入到进程环境
/environment-manager.inject --env=dev --prefix="APP_"
# 启动应用
npm run dev

# CI/CD：注入到构建环境
/environment-manager.inject --env=staging --into=/tmp/build.env --format=dotenv
```

## 三、4 个环境设计

### 3.1 环境分层

```
┌─────────────────────────────────────────────────┐
│ preview（PR 临时环境）              │
│ - 每次 PR 自动创建                  │
│ - 短生命周期（PR 关闭即销毁）          │
│ - 用 staging 的相同 schema + 独立数据 │
└─────────────────────────────────────────────────┘
↑
┌─────────────────────────────────────────────────┐
│ production（生产环境）            │
│ - 真实用户流量                     │
│ - 最高安全等级                     │
│ - 7×24 SLA                       │
└─────────────────────────────────────────────────┘
↑
┌─────────────────────────────────────────────────┐
│ staging（预生产环境）              │
│ - production 的镜像               │
│ - 真实数据脱敏                     │
│ - 部署前最后验证                   │
└─────────────────────────────────────────────────┘
↑
┌─────────────────────────────────────────────────┐
│ dev（本地开发）                    │
│ - 开发者本地 + 共享 dev 服务器       │
│ - 频繁重置数据                     │
│ - 最低安全等级                     │
└─────────────────────────────────────────────────┘
```

### 3.2 环境配置约定

```yaml
# .env.example（提交到 git）
DATABASE_URL=postgres://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379
JWT_SECRET=<CHANGE_ME>
STRIPE_SECRET_KEY=<CHANGE_ME>
STRIPE_WEBHOOK_SECRET=<CHANGE_ME>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<CHANGE_ME>
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<CHANGE_ME>
AWS_SECRET_ACCESS_KEY=<CHANGE_ME>

# 注释说明：
# DATABASE_URL: 数据库连接
# JWT_SECRET: 32+ 字符随机字符串
# STRIPE_*: Stripe 支付，从 dashboard 获取
# AWS_*: IAM 用户，仅给 S3 读写权限
```

## 四、Secrets 后端选型

| 后端 | 适用场景 | 优点 | 缺点 |
|---|---|---|---|
| **Doppler** | 团队 < 100 人 | 易用、集成多、CLI 友好 | 商业（免费层够用）|
| **HashiCorp Vault** | 企业 / 自托管 | 开源、功能强、可审计 | 运维复杂 |
| **AWS Secrets Manager** | AWS 全栈 | 与 AWS 深度集成 | 锁定 AWS |
| **Azure Key Vault** | Azure 全栈 | 与 Azure 深度集成 | 锁定 Azure |
| **1Password CLI** | 小团队 / 个人 | 易用、UI 友好 | 不适合 CI/CD |
| **Bitwarden Secrets** | 中小团队 | 开源、可自托管 | 生态较小 |
| **本地 .env + git-crypt** | 极小项目 / 开源 | 零成本 | 不安全、易泄露 |

### 4.1 推荐：Doppler（中小团队默认）

```yaml
# 选择 Doppler 的理由：
# 1. CLI 极简：doppler secrets set KEY=VALUE --project myapp --config dev
# 2. 自动同步：git push → Doppler 自动更新对应环境
# 3. 审计日志：谁在什么时候改了什么 Secret
# 4. 集成：Kubernetes / Vercel / Netlify / GitHub Actions 一键
# 5. 免费层：3 个项目 + 5 个成员够用
```

## 五、与上游下游的衔接

### 5.1 上游调用

| 来自 | 何时 |
|---|---|
| **scaffold-runner** | 项目初始化时 `/init` |
| **implement-executor** | 写涉及外部 API 调用的代码时 |
| **git-workflow** | pre-commit hook 检测 `.env` |
| **review-checklist** | PR 评审时（SEC-011/012）|

### 5.2 下游通知

| 触发 | 何时 |
|---|---|
| Secrets 轮换完成 | 通知 Slack |
| 新环境变量定义 | 同步到 .env.example |
| 环境校验失败 | 阻止部署 |

### 5.3 在主流程中的位置

```
scaffold-runner (生成项目)
    ↓
environment-manager.init  (初始化环境)
    ↓
implement-executor (写代码)
    ↓ 需要 API key 等
environment-manager.inject  (注入环境变量到进程)
    ↓
应用启动成功
```

## 六、安全约束

### 6.1 .env 文件管理

```yaml
# .gitignore（强制包含）
.env
.env.local
.env.*.local
.env.development
.env.production
.staging-secrets/
*.pem
*.key
*.p12
secrets.json
```

### 6.2 pre-commit Hook（自动）

```bash
#!/bin/bash
# .git/hooks/pre-commit

# 检测 .env 文件
if git diff --cached --name-only | grep -E "\.env(\.|$)|\.env\.local$|\.env\.development$"; then
  echo "❌ 检测到 .env 文件，提交被阻止"
  echo "请使用 environment-manager 管理环境变量"
  exit 1
fi

# 检测硬编码密钥（即使在代码内）
if git diff --cached | grep -E "(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"]{16,}['\"]"; then
  echo "❌ 检测到可能的硬编码密钥"
  echo "请使用 environment-manager.get 注入"
  exit 1
fi
```

### 6.3 强制约束（写入 constitution）

| 禁止 | 必须 |
|---|---|
| 直接提交 .env | 必须使用 environment-manager |
| 代码中硬编码密钥 | 必须从 environment-manager 读取 |
| 多个环境共用同一密钥 | 至少 prod 必须独立 |
| 长期不轮换 Secrets | 必须 90 天轮换一次 |
| 跨环境混用配置 | 部署前必须 environment-manager.validate |

## 七、`/validate` 检查清单

```yaml
# 默认校验项
required_keys:
  # 4 个环境都必须有
  - DATABASE_URL
  - REDIS_URL
  - JWT_SECRET
  - STRIPE_SECRET_KEY

format_checks:
  DATABASE_URL: regex('^postgres://.+')
  REDIS_URL: regex('^redis://.+')
  EMAIL: regex('^[^@]+@[^@]+$')
  PORT: range(1, 65535)

production_only:
  - DATABASE_URL must NOT contain 'localhost'
  - DATABASE_URL must NOT contain 'dev'
  - JWT_SECRET must be >= 32 chars
  - STRIPE_SECRET_KEY must start with 'sk_live_'
  - HTTPS must be true for all external URLs

secret_strength:
  JWT_SECRET: min_length(32)
  API_KEY: min_length(32)
  PASSWORD: min_length(12)
```

## 八、`/rotate` 详细流程

```
用户: /environment-manager.rotate --env=production --key=STRIPE_SECRET_KEY

Step 1: 检测当前 key
  - 从 Doppler 获取当前值
  - 检查年龄（> 90 天提示）

Step 2: 生成新 key
  - 调用 Stripe API 创建新 restricted key
  - 验证新 key 可用（test request）

Step 3: 双写阶段（24h）
  - Doppler 同时存储 old + new
  - 应用通过 STRIPE_SECRET_KEY_NEW 使用新 key
  - 旧 key 仍可作 fallback

Step 4: 切换阶段
  - 确认无错误后，切换 STRIPE_SECRET_KEY → new
  - 删除 _NEW 后缀
  - 触发应用重新部署

Step 5: 撤销旧 key
  - 等待 24h 观察期
  - 调用 Stripe API 撤销 old key
  - Doppler 删除 old value
  - 记录到审计日志

Step 6: 通知
  - Slack 通知安全团队
  - 更新 audit log
```

## 九、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| .env.example | 项目根 | 模板（无真实值），提交到 git |
| .gitignore | 项目根 | 排除所有 .env 文件 |
| pre-commit hook | `.git/hooks/pre-commit` | 阻止 .env 提交 |
| 环境校验报告 | `docs/security/env-validation.md` | 每次部署前生成 |
| 审计日志 | Doppler / Vault 内置 | 谁改了什么 Secret |
| README | `docs/env-setup.md` | 开发者入门指南 |

## 十、强制约束

| 禁止 | 必须 |
|---|---|
| 直接编辑 .env 文件 | 使用 environment-manager 命令 |
| 共享 dev / staging / prod 密钥 | 每个环境独立 |
| 提交 .env 到 git | 必须 .gitignore + pre-commit |
| 代码中明文密钥 | 用 process.env.VAR_NAME 读取 |
| 长期不轮换 | 90 天轮换一次（自动提醒） |
| 跨环境配置不一致 | validate 必过才能 release |

## 十二、失败回退

| 失败点 | 恢复动作 |
|---|---|
| Doppler API 不可用 | 临时降级到本地 .env（警告）|
| 旧 key 撤销后应用报错 | 紧急回滚（保留 old key 24h）|
| 密钥泄露 | 立即轮换 + 通知安全 + audit log |
| 校验失败阻止部署 | 列出缺失项 + 修复 |

## 十三、依赖

- Node.js 18+
- Doppler CLI（推荐）/ Vault CLI / AWS CLI
- Git（pre-commit hook）
- 外部服务（Stripe / AWS / 等）的 API

## 十四、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `scaffold-runner`, `implement-executor`, `code-patterns`
- 配套: `git-workflow`（pre-commit）、`review-checklist`（SEC-011/012）
- 同类工具: Doppler / Vault / AWS Secrets Manager / 1Password CLI

## 十五、许可

MIT