---
name: git-workflow
description: |
 Git 协作流程自动化。基于 Conventional Commits + GitHub Flow + 自动化质量门禁。
 整合分支策略、提交规范、PR 模板、变更日志自动生成、冲突解决助手。
 为 implement-executor 提供"提交代码"能力，为团队提供"可审计的版本历史"。
version: 1.0.0
tags:
  - git
  - conventional-commits
  - github-flow
  - pull-request
  - changelog
entry-points:
  - commit
  - branch
  - pr
  - merge
  - changelog
  - conflict
  - tag
  - release
requires:
  - git: ">=2.30"
  - gh-cli: ">=2.40"（可选，PR 操作）
binds:
  - implement-executor
  - test-runner
  - openspec-workflow
parent: project-orchestrator
phase: 2.3
position: collaboration-flow
---

# git-workflow

> 让 Agent 提交的代码天然符合团队规范 + 可审计 + 可回滚。

## 一、定位与价值

`implement-executor` 每个任务完成后会调用 `git-workflow.commit`。`git-workflow` 自动处理：
- 智能分支管理（基于 task ID 自动创建/切换/合并）
- Conventional Commits 格式（type / scope / subject 自动推断）
- PR 模板自动填充（链接 spec.md / 关联 issues）
- 冲突自动检测 + 智能合并助手
- 变更日志自动生成

**核心价值**：
- ✅ Agent 提交即规范，零人工 review 风格问题
- ✅ 完全可审计（每个 commit 关联任务 ID / spec ID）
- ✅ 智能冲突解决（不只是 `git pull --rebase`）
- ✅ 自动 changelog（团队 / 用户都能看）

## 二、命令清单

### 2.1 `/commit` 主命令

```bash
/git-workflow.commit --task=T015 --message="实现 JWT 登录中间件"
# 内部自动：
# 1. 检查当前分支是否正确（feature/001-init-t015-jwt-middleware）
# 2. git add 相关文件（仅 task 涉及的文件）
# 3. 推断 type/scope（从文件路径）
# 4. 生成 commit message（Conventional Commits）
# 5. git commit（带 task ID trailer）
# 6. 验证 commit message 格式
# 7. 输出 commit hash
```

### 2.2 `/branch` 分支管理

```bash
/git-workflow.branch --task=T015 --feature=001-init
# 自动：
# 1. 创建分支：feature/001-init-t015-jwt-middleware
# 2. 切换分支
# 3. 推送到 origin
```

### 2.3 `/pr` 创建 PR

```bash
/git-workflow.pr --feature=001-init --base=main
# 自动：
# 1. 检查所有任务已完成 + 测试通过
# 2. 填充 PR 模板（标题 / 描述 / 任务清单）
# 3. 调用 gh CLI 创建 PR
# 4. 添加 labels（feature, area:auth）
# 5. 请求 review（按 code-patterns 配置的 reviewer 列表）
```

### 2.4 `/merge` 合并 PR

```bash
/git-workflow.merge --pr=42
# 自动：
# 1. 检查 CI 全绿
# 2. 检查 reviewer approve 数 ≥ 1
# 3. Squash merge（保留所有 commit 信息）
# 4. 删除 feature 分支
# 5. 触发 deploy（如果配置）
```

### 2.5 `/changelog` 变更日志

```bash
/git-workflow.changelog --from=v1.0.0 --to=HEAD --output=CHANGELOG.md
# 自动从 commit history 提取 Conventional Commits
# 按 type 分类（Features / Bug Fixes / etc）
# 输出标准 Keep a Changelog 格式
```

### 2.6 `/conflict` 冲突解决

```bash
/git-workflow.conflict
# 检测冲突 → 分类（trivial / structural / semantic）
# trivial：自动 ours/theirs 选择
# structural：标记 + 列出冲突文件
# semantic：调用 debug-helper + 报告人类
```

### 2.7 `/tag` 打标签

```bash
/git-workflow.tag --version=v1.2.0 --message="新增工时统计功能"
# 创建 git tag + 自动 changelog + 自动 GitHub Release
```

### 2.8 `/release` 发布

```bash
/git-workflow.release --version=v1.2.0
# 1. 自动生成 CHANGELOG
# 2. 更新 version（package.json / pom.xml 等）
# 3. 创建 git tag + push
# 4. 创建 GitHub Release
# 5. 触发 CI/CD deploy
```

## 三、分支策略

### 3.1 GitHub Flow（默认）

```
main                                    生产分支（受保护）
  │
  ├── feature/001-init-t015-jwt         Phase 3 任务 1
  ├── feature/001-init-t016-user        Phase 3 任务 2
  ├── feature/001-init-t020-board       Phase 3 任务 5
  │
  └── feature/002-add-timesheet          Phase 2 变更
```

### 3.2 分支命名规则

```
格式：<type>/<feature-id>-<task-id>-<short-desc>

示例：
  feature/001-init-t015-jwt-middleware
  feature/001-init-t020-board-page
  bugfix/PROD-123-fix-login-crash
  hotfix/PROD-456-urgent-patch
  release/v1.2.0
```

### 3.3 分支保护规则

```yaml
# 在 GitHub / GitLab 中配置
main:
  required_status_checks:
    - ci/test
    - ci/lint
    - ci/contract-test
  required_reviews: 1
  required_signatures: true
  restrict_pushes: true

# Agent 不能直接 push 到 main
# 必须通过 PR + reviewer approve
```

## 四、Conventional Commits 自动化

### 4.1 格式规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 4.2 自动推断逻辑

```javascript
function inferCommitType(fileChanges) {
  const changedFiles = fileChanges.map(c => c.path);

  // 1. 新文件 → feat
  if (changedFiles.every(f => !f.includes('test'))) return 'feat';

  // 2. 测试文件 → test
  if (changedFiles.every(f => f.includes('test') || f.includes('spec'))) return 'test';

  // 3. 文档 → docs
  if (changedFiles.every(f => f.match(/\.(md|txt|rst)$/))) return 'docs';

  // 4. 配置文件 → chore
  if (changedFiles.every(f => f.match(/(package\.json|pom\.xml|Cargo\.toml|tsconfig)/))) return 'chore';

  // 5. Bug fix
  if (commitMessage.includes('fix') || commitMessage.includes('bug')) return 'fix';

  // 6. 默认
  return 'feat';
}

function inferScope(fileChanges, task) {
  // 优先从 task 的 [Story] 推断
  if (task.story) return task.story.toLowerCase(); // us1, us2

  // 否则从文件路径推断
  const paths = fileChanges.map(c => c.path);
  if (paths.some(p => p.includes('/auth/'))) return 'auth';
  if (paths.some(p => p.includes('/api/'))) return 'api';
  if (paths.some(p => p.includes('/components/'))) return 'ui';
  return 'core';
}
```

### 4.3 自动生成的 commit message 示例

```bash
# Task T015: 实现 JWT 登录中间件
# 文件: src/middleware/auth.ts, src/middleware/auth.test.ts
# Story: US-01

feat(auth): implement JWT login middleware

- Add JWT token generation with 2h expiry
- Add token verification on protected routes
- Add rate limiting (5 attempts / 10 min)
- Update auth tests to cover happy + error paths

Refs: SPEC-001/US-01
Task: T015
Test: ✓ 12/12 passing
Coverage: +18% (auth module 45% → 95%)
```

### 4.4 多 commit vs Squash

| 场景 | 策略 |
|---|---|
| 单任务（默认）| 1 task = 1 commit（保持任务粒度）|
| 大任务（> 5 文件 / > 300 行）| 拆为多个 commit（WIP / feat / test / docs）|
| PR merge 时 | Squash merge（合并为 1 个 commit） |
| Hotfix | 单个 commit（cherry-pick 友好）|

## 五、PR 模板自动生成

### 5.1 PR 标题格式

```
<type>(<scope>): <feature-description>

示例：
feat(auth): implement user login & JWT middleware
fix(board): resolve drag-and-drop crash on Safari
docs(api): add OpenAPI 3.1.2 reference docs
```

### 5.2 PR 描述模板

```markdown
## 📋 概述
<!-- 自动填充：从 spec.md 提取的功能描述 -->

实现 **US-01: 用户登录 + JWT 鉴权**（来自 SPEC-001）
- 添加登录页 UI（含表单校验 + 错误提示）
- 实现 JWT 中间件（生成 + 验证 + 过期）
- 添加 rate limiting（防爆破）
- 添加完整测试覆盖（happy + negative + 边界）

## 🔗 关联
- **Spec**: [SPEC-001/spec.md](docs/specs/001-init/spec.md)
- **OpenAPI**: [contracts/openapi.yaml](contracts/openapi.yaml)
- **Page Detail**: [P-LOGIN-001](docs/design/001-init/pages/P-LOGIN-001.md)
- **Tasks**: T010 → T015（6 个任务完成）
- **Issue**: Closes #42

## ✅ 完成情况
- [x] 6/6 任务完成（详见 .implement-logs/001-init.log）
- [x] 12/12 测试通过
- [x] 覆盖率 95%（auth 模块）
- [x] 契约测试 100%（POST /auth/login）
- [x] ESLint 零错误
- [x] TypeScript 类型检查零错误

## 📸 截图
<!-- 自动从 E2E 测试截图插入 -->
![登录页成功](docs/e2e/2026-08-24/us-01-login-pass.png)

## 🧪 测试
- [x] 单元测试
- [x] 集成测试
- [x] 契约测试
- [x] E2E 测试

## ⚠️ 风险与注意事项
<!-- 自动分析 + Agent 补充 -->
- 涉及鉴权变更，prod 部署需先在 staging 验证
- JWT 密钥通过 env 注入，部署前确认 .env 已配置

---

🤖 Generated by project-orchestrator-bundle / implement-executor
Co-authored-by: AI Agent <agent@project-orchestrator.local>
```

## 六、变更日志自动生成

### 6.1 Keep a Changelog 格式

```markdown
# Changelog

## [1.2.0] - 2026-08-24

### ✨ Features
- **auth**: 实现 JWT 登录中间件 (#42)
- **ui**: 新增看板页面，支持拖拽 (#45)
- **api**: 新增工时统计端点 (#48)

### 🐛 Bug Fixes
- **board**: 修复 Safari 上拖拽崩溃 (#44)
- **auth**: 修复 5xx 错误返回 200 的 bug (#46)

### 📚 Documentation
- **api**: 添加 OpenAPI 3.1.2 参考文档 (#47)

### 🧪 Tests
- **auth**: 完整测试覆盖（95%）

### 🔧 Chores
- 升级 dependencies
- 修复 CI 配置

### 📊 Statistics
- 3 features, 2 bug fixes, 1 docs, 1 tests, 2 chores
- 6 PRs merged, 18 commits
- +1,247 lines, -234 lines
```

### 6.2 自动生成流程

```bash
# 自动执行
git log v1.1.0..HEAD --pretty=format:"%h %s" | \
  grep -E "^[a-f0-9]+ (feat|fix|docs|style|refactor|test|chore|perf|build|ci)(\(.+\))?:" | \
  awk '{ ... 解析 ... }' | \
  分类输出 > CHANGELOG.md
```

## 七、冲突解决助手

### 7.1 冲突分类

| 类型 | 描述 | 自动处理 |
|---|---|---|
| **trivial** | 同一行不同内容，简单的 accept ours/theirs | ✅ 自动 |
| **structural** | 文件结构变化（如重命名 + 修改）| ⚠️ 半自动 + 报告 |
| **semantic** | 业务逻辑冲突（如两人改同一函数）| ❌ 必须人工 |

### 7.2 冲突解决 prompt（Agent 调用）

```text
# git-workflow.conflict 输出示例

## ⚠️ 冲突检测

文件：src/middleware/auth.ts
冲突类型：semantic
冲突原因：
- main 分支（你）：refactor JWT verify with new error class
- feature/002 分支：add 2FA middleware

冲突块：
```typescript
// main 分支版本
export async function verifyJWT(token: string): Promise<JWTPayload> {
  // your changes
}

// feature/002 分支版本
export async function verifyJWT(token: string): Promise<JWTPayload> {
  // their changes
}
```

## 建议
1. 优先保留 main 分支的 refactor（向后兼容）
2. 在 verifyJWT 后调用新增的 2FA middleware
3. 添加集成测试覆盖合并后的逻辑

## 调用 debug-helper
[自动跳转...]
```

## 八、安全约束

| 禁止 | 必须 |
|---|---|
| 直接 push 到 main | 必须通过 PR |
| 跳过 reviewer approve | 必须 1+ reviewer |
| Force push 到共享分支 | 禁止（仅允许 feature 分支 force push）|
| 提交敏感信息（API key / 密码）| 必须用 git-secrets 预检查 |
| 用 git commit --no-verify | 仅在紧急情况 + 必须记录原因 |
| 大文件（> 5MB）进入 git | 必须用 Git LFS |

### 敏感信息扫描

```yaml
# .git-secrets-config.yml（自动生成）
patterns:
  - pattern: '(api[_-]?key|secret|token|password)\s*[:=]\s*["\'][^"\']{8,}'
  - pattern: '-----BEGIN [A-Z]+ PRIVATE KEY-----'
  - pattern: 'AKIA[0-9A-Z]{16}'  # AWS access key
  - pattern: 'ghp_[0-9a-zA-Z]{36}'  # GitHub PAT
forbidden_files:
  - '.env'
  - '.env.local'
  - '**/secrets.json'
```

## 九、与下游的衔接

### 9.1 上游

| 来自 | 何时调用 |
|---|---|
| **implement-executor** | 每个任务完成后 `/commit` |
| **openspec-workflow** | 变更提案 `/branch` + `/pr` |

### 9.2 下游

| 触发 | 何时 |
|---|---|
| **review-checklist**（未来）| PR 创建后自动触发 review |
| **CI/CD** | PR 合并后自动 deploy |
| **changelog 自动更新** | release 命令时自动 |

## 十、产出物

| 文件 | 路径 | 说明 |
|---|---|---|
| Commit 历史 | `git log` | 完整可审计 |
| PR 模板 | `.github/PULL_REQUEST_TEMPLATE.md` | 自动生成 |
| Git hooks | `.git/hooks/pre-commit` `pre-push` | 自动检查 |
| 变更日志 | `CHANGELOG.md` | 每次 release 自动更新 |
| Release Notes | GitHub Releases | 自动发布 |

## 十一、强制约束（写入 constitution）

| 禁止 | 必须 |
|---|---|
| 直接 push main | 必须 PR |
| 提交 .env / secrets | 必须用 secret 管理工具 |
| 大文件（> 5MB）commit | 必须用 Git LFS |
| 跳过 reviewer | 必须 1+ approve |
| 用 `git commit -m "fix"` | 必须 Conventional Commits |
| 用 `git push --force` 共享分支 | 仅 feature 分支允许 |
| 合并有 conflict 的 PR | 必须先解决 |

## 十二、失败回退

| 失败点 | 恢复动作 |
|---|---|
| Commit message 格式错误 | 提示用户 + 自动修正建议 |
| 分支冲突 | 调用 /conflict 助手 |
| Reviewer 未响应 | 自动 @ 团队 + Slack 通知 |
| CI 失败 | 阻止 merge + 列出失败项 |
| Force push 误用 | 检测到 + 提示 + 阻止 |
| 敏感信息扫描命中 | 阻止 commit + 提示 + 启动密钥轮换流程 |

## 十三、依赖

- Git 2.30+
- gh CLI（可选，PR 操作）
- git-secrets（敏感信息扫描）
- Git LFS（大文件）
- pre-commit hooks

## 十四、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `implement-executor`, `openspec-workflow`
- 下游: `review-checklist`（未来）, CI/CD
- 同类工具: Husky, lint-staged, commitlint

## 十五、许可

MIT