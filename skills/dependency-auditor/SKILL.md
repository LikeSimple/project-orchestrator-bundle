---
name: dependency-auditor
description: |
 第三方依赖审计 + 漏洞扫描 + License 合规 + 维护活跃度 + Bundle Size 分析。
 在 scaffold-runner / implement-executor 加包前自动调用，
 阻止引入高风险依赖。整合 npm audit / pip-audit / Snyk / Socket / OSV.dev。
version: 1.0.0
tags:
  - security
  - supply-chain
  - license-compliance
  - vulnerability-scan
  - bundle-size
entry-points:
  - audit
  - check
  - blocklist
  - allowlist
  - report
requires:
  - node: ">=18"
  - python: ">=3.10"
binds:
  - scaffold-runner
  - implement-executor
  - code-patterns
  - git-workflow
  - review-checklist
parent: project-orchestrator
phase: 2.6
position: supply-chain-gate
---

# dependency-auditor

> 让"加包"这个动作变得安全——每一个依赖都被审查后才进入项目。

## 一、定位与价值

`scaffold-runner` 和 `implement-executor` 在添加新依赖时会自动调用 `dependency-auditor.check`。本 Skill 解决现代软件开发最大的"看不见的威胁"：

- **供应链攻击**：2024 年平均每个项目 80% 的代码来自第三方，但 0% 的审查
- **License 陷阱**：GPL/AGPL 传染可能让商业产品被迫开源
- **维护中断**：作者弃坑 → 安全漏洞 0 补丁
- **Bundle 膨胀**：不知不觉 bundle size 翻倍

**核心价值**：
- ✅ 加包前自动审计（漏洞 + License + 维护 + Bundle）
- ✅ 阻止"危险包"进入项目（高危漏洞 / 不兼容 License）
- ✅ 持续监控（CI / 定时任务发现新漏洞）
- ✅ License 合规报告（法务 / 客户审计用）

## 二、能力范围

### 2.1 `/audit` 完整审计

```bash
/dependency-auditor.audit
# 内部自动：
# 1. 检测包管理工具（npm / yarn / pnpm / pip / cargo / go mod）
# 2. 跑漏洞扫描（npm audit / pip-audit / cargo audit）
# 3. 跑 License 检查（license-checker / pip-licenses）
# 4. 跑维护活跃度（GitHub API / npm registry）
# 5. 跑 Bundle Size 分析（cost-of-modules / bundlephobia）
# 6. 输出一站式报告
```

### 2.2 `/check` 加包前检查（核心）

```bash
# scaffold-runner 加包前自动调用
/dependency-auditor.check --add="axios@1.7"

# implement-executor 添加新依赖时调用
/dependency-auditor.check --add="lodash@^4.17"

# 输出：
#   ✅ vulnerabilities: 0 (CVE-free)
#   ✅ license: MIT (compatible)
#   ⚠️ maintenance: last publish 2 years ago (warning)
#   ✅ bundle size: 12 KB (gzipped)
#   Recommendation: ALLOW (with warning) / BLOCK
```

### 2.3 `/blocklist` 管理黑名单

```bash
/dependency-auditor.blocklist --add="left-pad" --reason="作者弃坑 + 已知问题"
/dependency-auditor.blocklist --remove="left-pad"
/dependency-auditor.blocklist --list
```

### 2.4 `/allowlist` 白名单

```bash
/dependency-auditor.allowlist --add="internal-ui-kit@*"
# 内部包豁免外部审计（已知是安全的）
```

### 2.5 `/report` 生成审计报告

```bash
/dependency-auditor.report --output=docs/security/dependency-audit.md
# 用于：法务审计 / 客户交付 / 安全认证（ISO 27001 / SOC 2）
```

## 三、5 大审计维度

### 3.1 维度 1：漏洞扫描（Vulnerability）

| 数据源 | 覆盖范围 | 优先级 |
|---|---|---|
| npm audit (内置) | npm 生态 CVE | 🔴 最高 |
| pip-audit (PyPI) | Python 生态 CVE | 🔴 最高 |
| cargo audit | Rust 生态 CVE | 🔴 最高 |
| OSV.dev（开源）| 多生态 | 🟡 备选 |
| GitHub Advisory DB | npm + pip + others | 🟡 备选 |
| Snyk（商业）| 全生态 + 私有漏洞 | 🟡 增强 |
| Socket（商业）| 主动威胁检测 | 🟢 可选 |

### 3.2 维度 2：License 合规

**License 白名单（默认）**：

```yaml
allowed_licenses:
  # 强宽松
  - MIT
  - BSD-2-Clause
  - BSD-3-Clause
  - Apache-2.0
  - ISC
  - Unlicense
  - CC0-1.0
  
  # 弱宽松（需评估）
  - LGPL-2.1     # 动态链接可，静态链接需谨慎
  - MPL-2.0       # 文件级 Copyleft
  - EPL-2.0        # 文件级 Copyleft
  
  # 默认禁止（需明确豁免）
  forbidden_licenses:
    - GPL-2.0      # 强 Copyleft，传染整个项目
    - GPL-3.0      # 同上
    - AGPL-3.0     # 网络服务也传染，最危险
    - SSPL-1.0     # MongoDB 的服务条款型 Copyleft
    - BUSL-1.1     # 商业源码许可
    - AGPL-1.0
    - SSPL
    - Commons-Clause
```

### 3.3 维度 3：维护活跃度

| 指标 | 健康 | 警告 | 危险 |
|---|---|---|---|
| 最后发布时间 | < 6 个月 | 6-12 个月 | > 12 个月 |
| 维护者数量 | ≥ 3 | 1-2 | 0（无活跃维护者）|
| 周下载量 | > 10k | 1k-10k | < 1k |
| Issue 响应时间 | < 7 天 | 7-30 天 | > 30 天 |
| 是否有 funded | yes | - | no |
| OpenSSF Scorecard | A / B | C | D / F |

### 3.4 维度 4：Bundle Size

```
┌──────────────┬─────────┬─────────┐
│ 体积范围      │ 评价   │ 建议    │
├──────────────┼─────────┼─────────┤
│ < 10 KB     │ 优秀   │ 推荐使用 │
│ 10-50 KB    │ 良好   │ 推荐使用 │
│ 50-200 KB   │ 中等   │ 谨慎评估 │
│ 200-500 KB  │ 较大   │ 寻找替代 │
│ > 500 KB    │ 过大   │ 必须替换 │
└──────────────┴─────────┴─────────┘
```

### 3.5 维度 5：供应链风险（高级）

| 信号 | 检测方式 | 风险等级 |
|---|---|---|
| 包作者突然变更 | git commit history | 🔴 高 |
| install script 异常 | package.json scripts | 🔴 高 |
| 包含加密混淆代码 | static analysis | 🔴 高 |
| 域名过期被接管 | typosquatting 检测 | 🔴 高 |
| typosquatting（如 `react-dom-`）| npm registry 对比 | 🟡 中 |
| 维护者邮箱异常 | OSINT | 🟡 中 |
| 多个包共享可疑代码 | fingerprinting | 🟡 中 |

## 四、`/check` 输出格式

```
═══════════════════════════════════════════════════════════
 依赖审计：axios@1.7.2
═══════════════════════════════════════════════════════════

📦 包信息
  名称: axios
  版本: 1.7.2
  最新: 1.7.7（建议升级）
  下载量: 51,234,567 / 周
  维护者: 12 个
  最后发布: 2026-08-15（9 天前）✅ 健康

🔒 漏洞扫描
  CVE 数量: 0 ✅
  已知漏洞: 无
  NVD 评分: N/A

📜 License 检查
  License: MIT ✅ 兼容
  SPDX ID: MIT
  Copyleft: false
  Compatible: true

🛡 维护活跃度
  最后发布: 9 天前 ✅
  周下载量: 51M ✅ 健康
  Open Issues: 87（响应时间 < 3 天）✅
  维护者: 12 个 ✅
  OpenSSF Scorecard: A+ ✅
  Funded: 是（GitHub Sponsors）✅

📦 Bundle Size（仅前端）
  ESM (gzip): 12.4 KB ✅ 优秀
  ESM (raw): 45 KB
  CJS (gzip): 13.1 KB
  Tree-shakeable: 是

🔍 供应链风险
  Typosquatting: 否 ✅
  Install scripts: 仅 prepare ✅ 安全
  Maintainer change: 30 天内无变更 ✅
  Domain trust: 正常
  风险评分: 低 (15/100)

═══════════════════════════════════════════════════════════
 ✅ 推荐：ALLOW
═══════════════════════════════════════════════════════════
```

### 4.1 BLOCK 情况示例

```
❌ 推荐：BLOCK

原因：
  1. 🔴 漏洞：CVE-2024-12345（CVS 9.8 RCE 漏洞）
     → 升级到 2.0.0 可修复
  2. 🔴 License: GPL-3.0（强 Copyleft，与商业产品不兼容）
     → 法务风险
  3. ⚠️ 维护中断：最后发布 14 个月前，无活跃维护者
     → 安全漏洞 0 补丁

建议：
  - 更换替代包: request (MIT, 活跃维护)
  - 或升级到 patched version: left-pad@2.0.0
  - 或申请法务豁免（需 Lead 审批 + 备注）
```

## 五、与上游下游的衔接

### 5.1 上游调用方（自动触发）

| 来自 | 何时 | 阻塞？|
|---|---|---|
| **scaffold-runner** | `add-dep` 前 | 🔴 必 |
| **implement-executor** | Agent 引入新 import 时 | 🔴 必 |
| **git-workflow** | pre-commit hook | 🟡 警告 |
| **review-checklist** | PR 评审时（SEC 类规则）| 🔴 必 |
| **code-patterns** | `add-dep` 命令内部 | 🔴 必 |

### 5.2 下游（审计后）

| 触发 | 何时 |
|---|---|
| 自动 commit License 报告 | 每次 audit |
| 自动创建漏洞 issue | 发现新 CVE |
| 通知 Slack / 钉钉 | 发现 BLOCK |
| 更新 SBOM（软件物料清单）| 每月 |

## 六、`scaffold-runner` 集成示例

```typescript
// scaffold-runner.add-dep 内部伪代码
async function addDep(packageName: string, version: string) {
  // 1. 先审计
  const audit = await dependencyAuditor.check({ add: `${packageName}@${version}` });

  if (audit.verdict === 'BLOCK') {
    throw new Error(
      `Dependency ${packageName}@${version} blocked by dependency-auditor:\n` +
      audit.reasons.map(r => `  - ${r}`).join('\n')
    );
  }

  // 2. 警告仍允许，但要求用户确认
  if (audit.verdict === 'WARN') {
    const confirmed = await promptUser(
      `⚠️ ${packageName}@${version} has warnings:\n` +
      audit.warnings.map(w => `  - ${w}`).join('\n') +
      `\nContinue? (y/N)`
    );
    if (!confirmed) throw new Error('User aborted');
  }

  // 3. 通过审计，真正安装
  await exec(`npm install ${packageName}@${version}`);
}
```

## 七、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| 审计报告 | `docs/security/dependency-audit.md` | 人类可读 |
| JSON 结果 | `.dependency-audit.json` | CI 用 |
| SBOM | `docs/security/sbom.spdx.json` | SPDX 标准格式 |
| 漏洞列表 | `docs/security/cves.csv` | 持续跟踪 |
| 黑/白名单 | `.dependency-rules.yaml` | 项目级配置 |

## 八、强制约束（写入 constitution）

| 禁止 | 必须 |
|---|---|
| 加包不审计 | 任何 `add-dep` 必须先通过 `/check` |
| 使用黑名单包 | 必须有 Lead 审批 + git 历史留痕 |
| 使用强 Copyleft License | 必须法务豁免（每年 review）|
| 提交 .env / secrets | 必须用 secrets 管理 |
| 安装时跑 postinstall | 必须审计（`npm config set ignore-scripts true`）|

## 九、失败回退

| 失败点 | 恢复动作 |
|---|---|
| 漏洞数据库不可达 | 使用离线 CVE 库 + 警告用户 |
| License 解析失败 | 人工 review + 加入黑名单待评估 |
| Bundle 太大 | 推荐替代包列表 |
| 供应链可疑 | 自动 block + 通知安全团队 |
| API rate limit（GitHub）| 切换到本地 cache |

## 十、依赖

- Node.js 18+
- Python 3.10+（pip-audit 用）
- 可选：Snyk API（深度扫描）
- 可选：Socket API（主动威胁）

## 十一、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `scaffold-runner`, `implement-executor`, `code-patterns`, `git-workflow`, `review-checklist`
- 同类工具: Snyk, Socket, Dependabot, Renovate, OSV-Scanner

## 十二、许可

MIT