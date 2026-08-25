# Environment Setup

## 快速开始

```bash
# 1. 复制示例
cp .env.example .env.local

# 2. 编辑 .env.local，填入真实值（不会入 git）

# 3. 注入到运行时
npx environment-manager.inject --env=dev
```

## 环境列表

- `dev`：本地开发
- `staging`：预发布
- `production`：生产（独立密钥）

## 安全约束

- ❌ 禁止把 .env 提交到 git
- ❌ 禁止在代码中硬编码密钥
- ✅ 必须用 environment-manager.inject 读取
- ✅ 必须 90 天轮换一次 Secrets
