# Environment Setup

## 快速开始

```bash
# 1. 复制示例
cp .env.example .env.local

# 2. 编辑 .env.local，填入真实值（不会入 git）

# 3. 注入到运行时
npx environment-manager.inject --env=dev
```

## 环境变量说明

`.env.example` 是开发环境模板，复制为 `.env.local` 后填入真实值。所有变量均可选——不配置 LLM API Key 时自动降级到模板生成模式（`data.llmEnhanced: false`）。

| 变量 | 说明 | 必须？ |
|---|---|---|
| `NODE_ENV` | 运行环境（development / test / staging / production） | ✅ |
| `APP_PORT` | 应用端口 | ✅ |
| `APP_URL` | 应用访问地址 | ✅ |
| `DATABASE_URL` | 数据库连接字符串 | ⚠️ 按需 |
| `JWT_SECRET` | JWT 签名密钥（32+ 随机字符） | ⚠️ 按需 |
| `JWT_EXPIRES_IN` | JWT 过期时间（如 2h） | ⚠️ 按需 |
| `STRIPE_SECRET_KEY` | Stripe 支付密钥 | ⚠️ 按需 |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 签名密钥 | ⚠️ 按需 |
| `AWS_REGION` | AWS 区域 | ⚠️ 按需 |
| `AWS_ACCESS_KEY_ID` | AWS 访问密钥 ID | ⚠️ 按需 |
| `AWS_SECRET_ACCESS_KEY` | AWS 访问密钥 | ⚠️ 按需 |
| `SENTRY_DSN` | Sentry 错误监控数据源 | ⚠️ 可选 |

### LLM 相关变量（可选）

以下变量用于启用 LLM 增强，全部可选。优先级：MCP Sampling > 直连 Provider > 模板降级。

| 变量 | 说明 |
|---|---|
| `MCP_SAMPLING_ENABLED` | 设为 `1` 启用 MCP Sampling（首选，零配置） |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key |
| `OPENAI_API_KEY` | OpenAI API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DASHSCOPE_API_KEY` | 通义千问 API Key |
| `MOONSHOT_API_KEY` | 月之暗面 API Key |
| `LLM_PROVIDER` | 显式指定 Provider（anthropic / openai / deepseek / qwen / moonshot / custom） |
| `LLM_API_KEY` + `LLM_BASE_URL` | 自定义 OpenAI 兼容端点（Provider 为 `custom` 时使用） |
| `LLM_MODEL` | 自定义模型名称（配合 `LLM_API_KEY` + `LLM_BASE_URL` 使用） |

## 环境列表

environment-manager 支持 4 个环境，通过 `NODE_ENV` 或 `--env` 参数切换：

| 环境 | 标识 | 用途 | 密钥来源 |
|---|---|---|---|
| `dev` | development | 本地开发 | `.env.local`（dotenv） |
| `test` | test | 自动化测试 | `.env.test`（dotenv） |
| `staging` | staging | 预发布验证 | Doppler / Vault |
| `prod` | production | 生产 | Doppler / Vault（独立密钥） |

### 多环境配置

```bash
# 切换环境
npx environment-manager.switch --env=staging

# 从 Doppler / Vault 拉取密钥到本地
npx environment-manager.secrets sync --env=prod --backend=doppler
npx environment-manager.secrets sync --env=prod --backend=vault

# 校验当前环境配置
npx environment-manager.validate --env=staging
```

> dev / test 使用 dotenv 本地文件；staging / prod 推荐使用 Doppler 或 Vault 集中管理密钥。未配置 Doppler/Vault CLI 时自动降级到 dotenv。

## 安全约束

- ❌ 禁止把 `.env` / `.env.local` 提交到 git（已由 `.gitignore` 排除）
- ❌ 禁止在代码中硬编码密钥
- ✅ 必须用 `environment-manager.inject` 读取
- ✅ 必须 90 天轮换一次 Secrets
- ✅ environment-manager 自动检测 20+ 敏感字段（PASSWORD / SECRET / KEY / TOKEN 等）
- ✅ 通过 `analyzeEnvSecurity` 发送给 LLM 前自动脱敏（值替换为 `***MASKED***`）
