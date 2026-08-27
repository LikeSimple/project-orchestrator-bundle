# Project Orchestrator Bundle 成熟度分析报告（v10 · 重编号 + refineLogic + 多维度评估）

> 分析日期：2026-08-27（第十一轮评估，v10：step id 统一 S01-S19 + S10 refine-logic 新增 + 10 维度评估）
> 上次评估：2026-08-27（v9 完整体检）
> 分析范围：project-orchestrator-bundle 全量内容（编排状态机 / 健康度监控 / 32 MCP Tools / 15 Skills / 5 CLI / 文档链 / 测试）
> 分析维度：**编排状态机 / 健康度监控 / 工具链覆盖 / 文档完整性 / 测试覆盖 / 代码质量 / 可维护性 / 扩展性 / 用户体验 / 契约一致性**（10 维度，由 v9 的 5 维度扩展）
> 评估方法：recompute 状态机 + smoke-p2 + 文件系统扫描 + id 引用统计 + MCP Tools 清点

---

## v10 · 一、总体结论

**总分 93.4%**（10 维度均值） · 较 v10 (90.4%) ↑ +3.0，P1 3/3 + P2 3/3 + P3 2/2 全部完成，代码质量/可维护性/契约一致性/扩展性四维度提升

**核心成就**：
- 编排状态机 19 步完整落地（含 S10 refine-logic 按需细化）
- id 体系统一（S01-S19，2 位无小数）
- CLI 动态分母修复（requiredTotal=15）
- Phase 1 100% 完成 / 总体进度 67%
- 32 MCP Tools + 15 Skills + 5 CLI 直跑脚本

## v10 · 二、10 维度详细评分

| # | 维度 | 评分 | 关键依据 | 主要差距 |
|---|---|---|---|---|
| 1 | 编排状态机成熟度 | 95% | 19 步覆盖 3 Phase / 4 optional 设计合理 / 动态分母 15 / Phase 1 10/10 100% | Phase 2/3 未实战验证（S13-S19 检测逻辑未跑过真实数据） |
| 2 | 健康度监控 | 90% | 4 指标 + 4 仪表盘格式 + 7 天滑窗 / smoke-p2 验证 rollbackRate=33.3% 精准触发 | npm outdated 真实扫描未实战；events.ndjson 为空 |
| 3 | 工具链覆盖 | 98% | 32 MCP Tools + 15 Skills + 5 CLI 直跑脚本 / CLI 绕过 MCP Server 不可用问题 / **32 工具已动态验证可见（NDJSON 握手 + tools/list）** | dist 产物在 MCP Host 重启后的实际加载仍需人工确认（脚本已验证协议层） |
| 4 | 文档完整性 | 95% | spec/plan/checklist/tasks/design(8 文件)/logic(2 文件)/prototype 全链齐全 / **openapi 派生关系明确(S09 草案→S11 正式)** / **SKILL.md §8.5 新增 Skill 注册流程文档** | contracts/ 与 docs/design/ 的 feature 级组织（contracts/<feature>/openapi.yaml）尚未在示例落地 |
| 5 | 测试覆盖 | 95% | smoke-p2 PASS / **phase1 26/26 + phase2 25/25 + phase3 36/36 + e2e-pipeline 18/18 全通过（共 105 测试 0 失败）** / esm-import 7 个测试文件 | phase1-3 + e2e 已全量验证通过；mocha 套件与 node --test 行为差异未对比 |
| 6 | 代码质量 | 92% | ESM 兼容（异步 import） / UTF-8 统一（187 文件 0 TSD） / id 体系 S01-S19 一致 / **9 个历史 fix-*.cjs 脚本已清理** / **dist/skills 历史残留已清理** | — |
| 7 | 可维护性 | 90% | 动态分母（CLI 自动算 requiredTotal） / 文档同步（specs+README 163 处 id 替换） / migrate 脚本可复现 / **fix-*.cjs 噪声清理 + Skill 注册流程文档化降低上手成本** | state.json 依赖 recompute 重填（id 变更需手动跑一次） |
| 8 | 扩展性 | 95% | optional 步骤设计（S10/S12/S17/S19） / complexity 信号驱动（4 维） / refineLogic 交互式细化 + **LLM 增强路径** / **新 Skill 注册三件套流程文档化** | refineLogic LLM 增强路径未在真实 LLM 环境实测（当前回退启发式） |
| 9 | 用户体验 | 89% | CLI 输出清晰（编排状态/健康度/nextActions 引导） / nextActions 可执行建议 / **.trae/mcp.json BOM 问题已修复（UTF-8 无 BOM）** | MCP Server 重启依赖未自动化（配置变更后需手动重启 Host） |
| 10 | 契约一致性 | 95% | spec ↔ plan ↔ checklist ↔ tasks ↔ design ↔ logic 链条完整 / id 引用全部对齐 / **page-detail operationId 与 openapi 统一(listP2s)** / **openapi S09 草案→S11 正式派生关系明确** | openapi 生成器对复数资源名（如 items）的 operationId 可能出现双 s（listItemss），仅 singular 资源名验证通过 |

## v10 · 三、关键改进项（按优先级）

### P1（应做）— 3/3 ✅ 全部完成（2026-08-27 验证）

1. ✅ 跑 `phase1.test.cjs / phase2.test.cjs / phase3.test.cjs` 验证 Phase 1/2/3 流程
   - 结果：**phase1 26/26、phase2 25/25、phase3 36/36 全部通过，0 失败**（共 87 测试）
   - 耗时：phase1 ~1s、phase2 ~7.6s、phase3 ~17.4s
2. ✅ 验证 32 个 MCP Tools 在 MCP Host 中可见（重启 MCP Server 后用 `orchestrator_status` 调用）
   - 静态验证：`dist/orchestrator-tools.js` 中 `name + description` 模式匹配 = 32 个工具定义
   - 动态验证：用 **NDJSON 协议**（SDK 0.6.x stdio 传输格式）完成 `initialize` 握手 + `tools/list` 请求，运行时返回 **32 个工具**，与静态清单完全一致
   - 附带修复：`.trae/mcp.json` 存在 **UTF-8 BOM**（`efbbbf`），导致 Node `JSON.parse` 失败、MCP Server 无法加载配置；已重写为无 BOM 的 UTF-8 JSON，保留 3 个现有 server（orchestrator-tools / codegraph / code-review-graph）
3. ✅ 跑 `e2e-pipeline.test.cjs` 验证端到端编排链
   - 结果：**18/18 全部通过，0 失败**，耗时 13.3s
   - 覆盖链路：constitution → specify → plan → tasks → scaffold（含前后端组合栈 react-vite+spring-boot）→ ui-design(prototype) → design.generate → api-contract → html-converter → implement → test-runner → git.commit → review.checklist + 完整数据流验证 + AST 字段传播验证

> **P1 关键发现**：MCP SDK `@modelcontextprotocol/sdk` 0.6.x 的 stdio 传输使用 **NDJSON（每行一个 JSON，`\n` 分隔）**，**不是** LSP 风格的 `Content-Length` 框架。用 Content-Length 框架发送消息会被 server 静默丢弃（无响应）。验证脚本须用 `JSON.stringify(msg) + '\n'` 格式。

### P2（可做）— 3/3 ✅ 全部完成（2026-08-27 验证）

4. ✅ 清理历史 `fix-*.cjs` 脚本（TSD 修复完成，一次性脚本无用途）
   - 确认 9 个 fix-*.cjs 脚本未被任何代码/文档引用后删除（原报告称 11 个，实际 9 个）
5. ✅ 去重 `contracts/openapi.yaml` 与 `docs/design/001-test/openapi.yaml`（明确 S09 草案 → S11 正式的派生关系）
   - 在两份 openapi.yaml 头部 description 补充定位说明：contracts/ 为 S11 正式契约，docs/design/ 为 S09 草案；明确消费链 spec.md + prototype → S09 草案 → S11 正式 → implement
6. ✅ 统一 page-detail 接口命名（`p2List` → operationId `listP2s`）
   - 源码修复：spec-userstory-to-design 生成器第 507 行 `${opPrefix}List` → `list${capitalize(opPrefix)}s`（examples + dist 两份，与 openapi 的 `list${resCap}s` 对齐）
   - 文档修复：手动更新已生成的 P-001TEST-01.md / P-001TEST-02.md 关联 API 表，加注 Path 与 openapi server base 的关系
   - 重新生成验证：operationId=listP2s 与 openapi 草案完全一致

### P3（可选）— 2/2 ✅ 全部完成（2026-08-27 验证）

7. ✅ 文档化新 Skill 注册流程（stateDef + CLI + SKILL.md 三件套）
   - 在 SKILL.md §8.5 追加《扩展：注册新 Skill（三件套）》章节，含 5 步流程：stateDef（状态机 step 定义）+ index.js（Skill 实现，返回结构硬约束）+ SKILL.md（文档）+ 可选 MCP Tool 注册 + 可选 CLI 脚本，附字段约束与验证清单
8. ✅ 给 `refineLogic` 增加 LLM 增强路径（原纯启发式）
   - 新增 `generateScenariosViaLLM` 辅助函数：调用 llm-client.callLLM 生成覆盖更全面的场景列表（JSON 结构化输出，含 happy/error/edge 类型）
   - refineLogic 场景生成逻辑改为三级优先：用户提供 scenarios > LLM 增强 > 启发式兜底；LLM 失败自动回退
   - 返回值 `llmEnhanced/llmProvider` 反映实际来源；未启用 LLM 时 warnings 提示"建议人工补充业务特定场景"
   - 验证：3 场景（无 LLM 回退 / 用户提供 scenarios / 缺参报错）通过；phase1 26/26 + e2e 18/18 未破坏

## v10 · 四、v9 → v10 变更轨迹

| 变更项 | v9 状态 | v10 状态 |
|---|---|---|
| step id 体系 | S1-S19（混乱，含小数 S9.5） | S01-S19（统一 2 位，无小数） |
| CLI 分母 | 写死 "19" | 动态 requiredTotal=15 |
| 接口逻辑细化 | 无工具 | S10 refineLogic（5 场景+3 图表） |
| 评估维度数 | 5 | 10 |
| Phase 1 完成度 | - | 10/10 (100%) ✅ |
| 总体进度 | - | 67% |
| MCP Tools | - | 32 |
| Skills | - | 15 |
| CLI 脚本 | - | 5 |

---

## v9 历史评估（保留作为参考）

> 以下为 v9 完整体检内容，保留作为历史参考。v10 评估见上方。

---

## v9 · 一、总体结论

本轮体检跳出 v8 的 LLM 集成视角，从**工程可用性**和**前后端协同逻辑完备性**重新审视项目，发现 v8 未覆盖的 7 个关键问题。**v9 修复后 P0/P1 共 6 个问题全部清零**，仅剩 P2 优化项。

| 维度 | v8 评分 | v9 初始评分 | P1 修复后评分 | **v9 最终评分** | 变化（v9 初始→最终） | 一句话评价 |
|---|---|---|---|---|---|---|
| **可用性** | —（未评） | 90% | 95% | **95%** | ↑ +5 | quickstart/配置/产物/文档齐全，三套命名已映射；仍缺多平台手动验证 |
| **逻辑完备性（前后端协同）** | —（未评） | 78% | 78% | **94%** | ↑ +16 | 契约先行 + 组合栈 scaffold + 前后端任务标记 + 完整 E2E 链路（P0 已修复） |
| **MCP 集成质量** | 98% | 88% | 96% | **96%** | ↑ +8 | 实现健壮 + 三套命名体系映射表已补全（问题 6 已修复） |
| **接口契约一致性** | —（未评） | 75% | 90% | **93%** | ↑ +18 | spec-bootstrap 依赖矛盾消除 + 卖点承诺已写实 + 前后端标记契约化（P0-3 已修复） |
| **测试覆盖** | 91 测试 | 82% | 82% | **89%** | ↑ +7 | 105 测试 + 18 E2E step，前后端协同关键链路全覆盖（P0 已修复） |
| **LLM 集成深度（v8 维度）** | 96% | 96% | 96% | **96%** | → 保持 | 15/15 Skill 全量结构化，v8 结论成立 |
| **整体成熟度（v9 综合）** | 96% | 84% | 90% | **94%** | ↑ +10 | P0/P1 共 6 个问题全部修复；仅剩 P2 优化项 |

**v8 vs v9 定位差异**：v8 的 96% 反映 **LLM 集成维度**，结论成立；v9 修复后达 **94%**，反映 **工程可用性与前后端协同维度**已大幅提升。综合整体成熟度建议取 **94-96% 区间**。距 Phase 4（生产就绪）的主要差距从"前后端协同链路实测验证 + 文档与实现一致性"收敛为"多平台手动验证 + 健康度监控落地"。

---

## v9 · 二、体检发现的关键问题

### 🔴 P0 高优先级（阻塞前后端协同开发）— 3/3 ✅ 已修复

#### 问题 1：E2E 测试未覆盖前后端协同关键链路（prototype → design 断裂）— ✅ 已修复

**原证据**：
- [e2e-pipeline.test.cjs#L50-L64](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/tests/e2e-pipeline.test.cjs#L50-L64) — E2E 10 步链路：constitution→specify→plan→tasks→scaffold→**design.generate（消费 spec.data.path）**→implement→test→git→review
- [e2e-pipeline.test.cjs#L7-L12](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/tests/e2e-pipeline.test.cjs#L7-L12) — 数据流注释明确：`specify (→spec.md) → design.generate (→design files)`，**design 消费的是 spec.md，不是 prototype**
- [SKILL.md#L288-L290](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/SKILL.md#L288-L290) — 契约声明：`spec-userstory-to-design requires: specs/001-feature/spec.md, prototype/index.html`

**原矛盾**：契约声明需要 prototype/index.html，但 E2E 10 步中**完全没有 ui-design 步骤**，prototype → design 链路未验证。

**修复内容**：
- E2E 测试新增 **Step 5.5: ui-design.generate**（生成 prototype HTML 原型）
- E2E 测试 Step 6（spec-userstory-to-design.generate）改为**消费 spec + prototype**，验证 prototype → design 链路打通
- E2E 测试新增 **Step 6.5: api-contract.generate**（消费 design 产出的 openapi.yaml）
- E2E 测试新增 **Step 6.6: html-converter.convert**（消费 prototype 生成组件）
- E2E 步骤从 10 步扩展为 **18 步完整链路**（含 AST 传播验证）

**效果**：prototype → design → openapi → html-converter 前后端协同关键链路全部由 E2E 测试覆盖。前后端协同的"UI 原型驱动设计文档"核心价值得到实测验证。

#### 问题 2：scaffold-runner 无前后端组合模板 — ✅ 已修复

**原证据**：
- [scaffold-runner/SKILL.md#L43-L57](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/scaffold-runner/SKILL.md#L43-L57) — 13 个 `--stack` 值全是单端

**原缺失**：没有 `react-vite+spring-boot` 或 `vue-vite+nest` 这样的"前后端分离组合"模板。

**修复内容**：
- 新增 `COMPOSITE_TEMPLATES` 映射表，预定义 `react-vite+spring-boot` 等组合栈
- 实现 `runComposite` 函数：解析 `stack1+stack2` 语法 → 分别生成前端/后端子工程 → 生成 monorepo 根文件
- monorepo 结构：`apps/web`（前端）+ `apps/api`（后端）+ 根 `package.json` 声明 workspaces + `pnpm-workspace.yaml`
- 根 package.json 提供 `dev:web`/`dev:api`/`dev`（concurrently 并行）/`test:web`/`test:api`/`test` 脚本
- 支持自定义组合栈（未预定义的 `frontend+backend` 也能工作，使用默认 `apps/web`/`apps/api` 目录）
- E2E 测试新增 Step 5b/5c/5d 验证组合栈生成（react-vite+spring-boot / react-vite+express-api / 无效组合）

**效果**：全栈项目可一次性 scaffold，monorepo 结构 + pnpm workspace + 协同脚本一应俱全。前后端协同的工程基础完备。

#### 问题 3：implement-executor 无前后端任务区分机制 — ✅ 已修复

**原证据**：
- [implement-executor/SKILL.md#L114-L126](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/implement-executor/SKILL.md#L114-L126) — tasks.md 映射表只有 `Phase / [P]并行 / [US1]Story / T001 ID / file_path / 描述` 标记，**无 [frontend]/[backend] 标记**
- [implement-executor/SKILL.md#L184-L204](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/implement-executor/SKILL.md#L184-L204) — Checkpoint 检查清单只跑 `npm test / mvn test / pytest / cargo test` 单一命令，未区分前后端测试

**原缺失**：Agent 如何识别任务属于前端还是后端？同 Phase 内前后端能否并行？是否分别跑 vitest + pytest？

**修复内容**：
- tasks.md 新增 `[frontend]`/`[backend]`/`[shared]` 标记，正则 `\[(?:frontend|backend|shared)\]` 捕获端标记
- 新增 `parseSideTag(raw)` 函数：解析 `[frontend]` → `frontend`，大小写不敏感，无标记返回 null
- `parseTaskFromTasksMd` / `extractAllTasks` / `parsePhases` 全部增加 side 字段
- SKILL.md 第 3.2/3.3 节新增端标记说明表 + 跨端并行执行策略表
- 新增 `runCompositeTests(cwd)` 函数：组合栈项目分别跑 `test:web` + `test:api`，任一端失败即整体失败，返回 `sides` 字段标识两端结果
- `runTests(cwd)` 自动检测组合栈（package.json 同时声明 `test:web` 和 `test:api`）→ 调用 `runCompositeTests`
- phase2 测试新增 8 个用例：parseSideTag 识别/大小写/无效输入、parsePhases 端标记提取/字段保留、runCompositeTests 无 package.json、runTests 组合栈/单端项目

**效果**：Agent 可识别任务所属端，组合栈项目 Checkpoint 分别跑前后端测试，前后端协同执行语义明确。

### 🟡 P1 中优先级（文档与实现不一致）— 3/3 ✅ 已修复

#### 问题 4：spec-bootstrap "自研 vs 依赖 specify-cli" 矛盾 — ✅ 已修复

**原证据**：
- [spec-bootstrap/SKILL.md#L4-L5](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/spec-bootstrap/SKILL.md#L4-L5) — frontmatter 声明："兼容 SpecKit 工作流设计（**自研实现，不依赖 SpecKit CLI**）"
- 原 2.1 节要求：`uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.16.3`

**修复内容**：
- 删除 2.1 节 specify-cli 安装要求与 `specify init` 流程，改为声明"无外部 CLI 依赖，唯一硬依赖为 Node.js >= 18.0.0"。
- 命令表从 `/speckit.*`（暗示 Spec Kit 原生）统一改为实际 MCP Tool 名（`spec_bootstrap_constitution` / `specify` / ...），设计来源列标注"兼容 Spec Kit 工作流"。
- 在能力范围表后新增醒目提示块，再次强调"不依赖 specify-cli 或任何外部 CLI"。
- 修正内部流程 Step 0 从"specify-cli 版本校验"改为"Node.js 版本 + MCP 连通性校验"。
- 保留第五章依赖声明与相关链接（作为设计参考文档），无冲突。

**效果**：frontmatter、命令表、环境准备、使用示例、依赖章节五处一致——自研实现，仅兼容工作流设计理念，不依赖任何外部 CLI。

#### 问题 5：SKILL.md 行数严重超标，违背"薄编排层"卖点 — ✅ 已修复

**原证据**（实测行数，12/15 超标）：git-workflow 396、api-contract 388、debug-helper 371、environment-manager 344、test-runner 334、review-checklist 330、code-patterns 320、dependency-auditor 291、implement-executor 288、spec-userstory-to-design 280、ui-design 254、html-converter 252。

- 原 [SKILL.md#L99-L100](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/SKILL.md#L99-L100) 声称"单 Skill（巨石）SKILL.md > 500 行；Skill Bundle 每个 SKILL.md < 200 行"

**修复内容**：
- 将主 SKILL.md 对比表维度从"复杂度（行数绝对值）"改为**"复杂度管理（拆分策略 + 职责定位）"**。
- 单 Skill（巨石）一侧：明确痛点为"单一 SKILL.md > 500 行，**无分阶段拆分**，定位与维护困难"。
- Skill Bundle（本方案）一侧：写实为"按阶段 + 职责拆分 15 个独立子 SKILL.md；父 Skill 只做分发不承载实现，核心薄编排逻辑 < 100 行；子 Skill 平均 ~300 行（含模板/示例/回退表），**单职责定位显著优于巨石**"。
- 对比表其他维度（可复用性/权限隔离/故障隔离）保留，因不受行数影响。

**效果**：卖点不再依赖虚假的行数阈值承诺，而是落到真正的架构优势上——15 个子 Skill 按阶段单职责拆分 + 父 Skill 纯分发无实现负担。行数超标事实不再与卖点矛盾。

#### 问题 6：MCP Tool 命名与 entry-points 三套体系不透明 — ✅ 已修复

**原证据**：
- [orchestrator-tools.ts#L301-L688](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/src/orchestrator-tools.ts#L301-L688) — 注册 **26 个 MCP Tool**（蛇形命名）
- 主 SKILL.md frontmatter — 声明 **14 个 entry-points**（点号命名：bootstrap / change / ui.adjust / ...）
- 原 SKILL.md 第三节 — 文档示例使用 **slash 命令**（`/project-orchestrator.bootstrap` 等）
- 三套命名无映射表，用户/Agent 无法直观对应。

**修复内容**：
- 在主 SKILL.md 新增**3.6 节：三套命名体系映射表**，共 16 行映射（含 spec-bootstrap 8 子命令与 code-patterns 的独立映射行），覆盖：
  - `bootstrap` 复合入口 → 串联 11 个 MCP Tool（spec-bootstrap 7 + scaffold + ui-design + design + contract）
  - `change` 复合入口 → 串联 4 个 MCP Tool（openspec + implement + test + commit）
  - 其余 12 个单入口 → 一对一或一对多映射到 26 Tool 全集
- 表后追加"使用提示"，明确区分：Agent 自动化调用推荐用 MCP Tool 名；用户快速上手推荐用 Slash 或 Entry-point。

**效果**：26 个 MCP Tool 与 14 个 Entry-point 与 Slash 命令形成完整、可追溯的对应关系，调用时无需猜测，可用性显著提升。

### 🟢 P2 低优先级（优化项）

#### 问题 7：健康度监控仅文档声明无实现

**证据**：
- [SKILL.md#L619-L627](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/SKILL.md#L619-L627) — 监控表（撤销率 >25% / 澄清次数 >2.5 / 改了没生效 >10/周 / npm outdated >3）

**缺失**：无对应采集代码、仪表盘、告警实现。

**影响**：P2，运营可观测性缺失，不影响功能。

---

## v9 · 三、各维度详细评分

### 9.1 可用性 90%

**✅ 达标项**：
- [quickstart.ps1#L30-L38](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/quickstart.ps1#L30-L38) — 参数完备（MCP/DryRun/SkipTest/Help）、4 步流程（环境检查→install→build→MCP 配置）、错误处理
- [quickstart.sh#L93-L129](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/quickstart.sh#L93-L129) — macOS/Linux 参数解析完备（--mcp/--dry-run/--skip-test/--verbose/--help）
- [mcp.json#L60-L70](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/mcp.json#L60-L70) — MCP 配置 command/args/env 完整
- [README.md#L46-L59](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/README.md#L46-L59) — 前置条件表（8 依赖，标注必须/可选）
- [README.md#L61-L100](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/README.md#L61-L100) — 快速开始步骤可复制粘贴
- [docs/env-setup.md](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/docs/env-setup.md) — 环境配置指南存在
- dist 产物存在（orchestrator-tools.js + skill-cli.cjs）

**❌ 差距**：
- macOS/Linux 真实手动验证未做（v8 也提到）
- MCP 配置导入在 TRAE sandbox 受限（环境问题，非项目缺陷）
- 三套命令命名无映射表（见问题 6）

### 9.2 逻辑完备性（前后端协同）94%（P0 修复后 ↑ +16）

**✅ 设计意图清晰（亮点）**：
- [api-contract/SKILL.md#L411-L425](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/api-contract/SKILL.md#L411-L425) — **契约先行**：OpenAPI 作为单一真相，驱动前端客户端（openapi-typescript/orval）+ 后端实现 + 契约测试
- [spec-userstory-to-design/SKILL.md#L152-L182](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/spec-userstory-to-design/SKILL.md#L152-L182) — Step 3 产出 openapi.yaml 带双向锚点（x-page-id/x-button-id）
- [api-contract/SKILL.md#L70-L75](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/api-contract/SKILL.md#L70-L75) — 支持 Prism Mock Server 驱动前端联调
- [html-converter/SKILL.md#L33-L46](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/html-converter/SKILL.md#L33-L46) — 消费 prototype 生成 React/Vue 组件 + TypeScript 类型
- [SKILL.md#L504-L523](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/SKILL.md#L504-L523) — 失败回退表覆盖 15 个 Skill

**✅ 实现已补齐（P0 修复）**：
- ~~E2E 未验证 prototype → design 链路~~ → ✅ E2E 补全 Step 5.5 (ui-design) + Step 6 (design 消费 prototype) + Step 6.5 (api-contract) + Step 6.6 (html-converter)，共 18 步完整链路（见问题 1）
- ~~scaffold 无前后端组合模板~~ → ✅ 新增 COMPOSITE_TEMPLATES + runComposite 函数，支持 `react-vite+spring-boot` 等组合栈，生成 monorepo 结构（apps/web + apps/api + workspaces + 协同脚本）（见问题 2）
- ~~implement-executor 无前后端任务区分~~ → ✅ tasks.md 新增 `[frontend]/[backend]/[shared]` 标记 + parseSideTag 函数 + runCompositeTests 组合栈测试机制（见问题 3）

**❌ 剩余差距**：
- 跨端并行执行策略（同 Phase 内 frontend/backend 任务的真正并行 sub-loop）目前通过 Checkpoint 分别跑 test:web/test:api 体现，任务级真正并行执行为后续优化项

### 9.3 MCP 集成质量 88%

**✅ 达标项**：
- [orchestrator-tools.ts#L284-L294](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/src/orchestrator-tools.ts#L284-L294) — 26 个 MCP Tool 注册，覆盖 15 子 Skill 全部命令；sampling capability 声明
- [orchestrator-tools.ts#L88-L157](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/src/orchestrator-tools.ts#L88-L157) — handleLLMRequest 转发完整（延迟检测 client sampling + sampling/createMessage + IPC 回传 + 超时）
- [orchestrator-tools.ts#L163-L278](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/src/orchestrator-tools.ts#L163-L278) — fork+IPC 健壮（SIGTERM/SIGKILL、超时、输出解析容错）
- [llm-client.js#L32-L82](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/examples/lib/llm-client.js#L32-L82) — callViaMCPSampling + 120s 超时
- [llm-client.js#L326-L399](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/examples/lib/llm-client.js#L326-L399) — 三级降级（MCP Sampling → 直连 Provider → 模板）
- [ast-parser.js#L8-L11](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/examples/lib/ast-parser.js#L8-L11) — 真实使用 parse5+csstree+recast+@babel/parser

**❌ 差距**：
- 26 Tool vs 14 entry-points vs slash 命令，三套命名无映射表（见问题 6）

### 9.4 接口契约一致性 93%（P0+P1 修复后 ↑ +18）

**✅ 达标项**：
- 15 个 SKILL.md frontmatter 完整（name/description/version/entry-points/requires/binds/parent/phase/position）
- [bundles/](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/bundles/) 4 个 yaml 完整（full-stack/frontend-only/api-only/design-only）
- **105 个测试用例 + 18 个 E2E step**（实测一致）
- [implement-executor/SKILL.md#L73-L96](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/implement-executor/SKILL.md#L73-L96) — resume/rollback/abort 断点恢复 + .implement-state.json
- [implement-executor/SKILL.md#L114-L142](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/implement-executor/SKILL.md#L114-L142) — tasks.md 契约新增 `[frontend]/[backend]/[shared]` 端标记 + 跨端并行策略表（P0-3 修复）
- [scaffold-runner/SKILL.md](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/skills/scaffold-runner/SKILL.md) — 组合栈契约 `stack1+stack2` + monorepo 结构约定（P0-2 修复）

**❌ 剩余差距**：
- 12/15 SKILL.md 超 200 行（问题 5 已修订卖点维度为"复杂度管理"，行数事实不再矛盾，但文件长度客观存在）
- 健康度监控无实现（见问题 7）

### 9.5 测试覆盖 89%（P0 修复后 ↑ +7）

**✅ 达标项**：
- 9 个测试文件（ast-verify/debug-ast-deep/debug-endpoints/e2e-check/e2e-pipeline/helper/phase1/phase2/phase3）
- **105 个 test() 用例**（v9 修复后新增 14 个：8 个 phase2 端标记测试 + 4 个 E2E 组合栈测试 + 2 个其他）
- [e2e-pipeline.test.cjs](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/tests/e2e-pipeline.test.cjs) — **18 步全链路**（constitution→specify→plan→tasks→scaffold→**ui-design→design→api-contract→html-converter→**implement→test→git→review + 组合栈 + AST 传播验证）
- [phase2.test.cjs](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/mcp-integration/tests/phase2.test.cjs) — 新增 8 个 implement-executor 端标记测试（parseSideTag/parsePhases 端标记/runCompositeTests/runTests 组合栈）
- [SKILL.md#L504-L523](file:///d:/TraeWork/88-Project/project-orchestrator-bundle/SKILL.md#L504-L523) — 失败回退表覆盖 15 个 Skill

**❌ 剩余差距**：
- 弱断言比例 ~10%（v8 已知，未变）
- 无 Prism Mock + 前端组件 + 后端 endpoint 的真实联调测试（E2E 已覆盖链路数据流，但未做端到端运行时联调）

---

## v9 · 四、与 v8 的关系

| 项 | v8 视角 | v9 视角（修复后） |
|---|---|---|
| 评估重点 | LLM 集成深度（15/15 Skill 结构化） | 工程可用性 + 前后端协同逻辑 |
| 评分 | 96% | **94%** |
| 主要发现 | v2 的 18 个关键问题全修复，三层架构落地 | 7 个新问题（3 P0 + 3 P1 已全修复 + 1 P2 待优化） |
| 关键差距 | 真实 macOS/Linux 验证 | 多平台手动验证 + 健康度监控落地 |
| 结论 | Phase 3 Beta 后期稳定 | **Phase 3 Beta 后期，接近 Phase 4（生产就绪）** |

**两者关系**：v8 的 96% 是 LLM 维度的真实成绩；v9 修复后达 **94%**，反映工程可用性与前后端协同维度已大幅提升。综合整体成熟度建议取 **94-96% 区间**。距离 Phase 4（生产就绪）的主要差距已从"前后端协同链路实测验证 + 文档与实现一致性"收敛为"多平台手动验证 + 健康度监控落地"。

---

## v9 · 五、优先级路线图

### P0（阻塞前后端协同）— 3/3 ✅ 已修复

| # | 任务 | 预期效果 | 关联问题 | 状态 |
|---|---|---|---|---|
| 1 | **E2E 补全前后端协同全链路测试** | 新增 ui-design 步骤，验证 prototype→design→openapi→html-converter→前端组件 + 后端 endpoint 契约对齐 | 问题 1 | ✅ 已完成 |
| 2 | **scaffold-runner 新增前后端组合模板** | 支持 `react-vite+spring-boot` 等组合，定义 monorepo/子目录组织方式 | 问题 2 | ✅ 已完成 |
| 3 | **implement-executor 增加前后端任务标记** | tasks.md 新增 `[frontend]/[backend]` 标记 + 同 Phase 跨端并行策略 + 分别跑前后端测试 | 问题 3 | ✅ 已完成 |

### P1（文档与实现一致性）— 3/3 ✅ 已修复

| # | 任务 | 预期效果 | 关联问题 | 状态 |
|---|---|---|---|---|
| 4 | **spec-bootstrap 厘清自研 vs 依赖** | 删除 specify-cli 安装要求，五处文档统一为"自研实现不依赖外部 CLI" | 问题 4 | ✅ 已完成 |
| 5 | **修订 SKILL.md 行数卖点承诺** | 对比表改为"复杂度管理（拆分策略+职责定位）"维度，写实父 Skill 核心 < 100 行 / 子 Skill 平均 ~300 行含模板示例 | 问题 5 | ✅ 已完成 |
| 6 | **新增命名映射表** | 主 SKILL.md 新增 3.6 节，26 MCP Tool ↔ 14 entry-points ↔ Slash 命令完整对应（16 行映射） | 问题 6 | ✅ 已完成 |

### P2（优化项）

| # | 任务 | 预期效果 | 关联问题 |
|---|---|---|---|
| 7 | **健康度监控落地** | 撤销率/澄清次数/npm outdated 指标采集 + 仪表盘 | 问题 7 |
| 8 | 真实 macOS/Linux 手动验证 | v8 遗留，多平台 CI 之外验证 | — |
| 9 | 编排状态机（主 Skill 自动串联 Phase 1→2→3） | v8 路线图遗留 | — |

---

## v9 · 六、总结

`project-orchestrator-bundle` 在 v8 完成 LLM 全量深度集成后，本次 v9 完整体检从**可用性 + 前后端协同逻辑**维度发现了 7 个 v8 未覆盖的问题。**P0 + P1 共 6 个问题已全部修复**，仅剩 P2 优化项。

**核心成就（保持）**：
- LLM 集成 96%（v8 结论成立）
- 契约先行设计清晰（api-contract 单一真相驱动前后端）
- 三层分析架构（AST → 代码模式 → LLM 深度）
- ~~91 测试 + 10 E2E step + 失败回退 15 Skill 覆盖~~ → **105 测试 + 18 E2E step + 失败回退 15 Skill 覆盖**（P0 修复后新增 14 测试 + 8 E2E step）

**核心差距（修复后状态）**：
- ~~前后端协同链路实测断裂（E2E 缺 ui-design、scaffold 无组合模板、implement 无前后端区分）~~ — 3 个 P0 ✅ **已修复**（E2E 补全 18 步链路、scaffold 新增组合栈 + monorepo、implement 新增 [frontend]/[backend] 标记 + 组合栈测试）
- ~~文档与实现不一致（spec-bootstrap 自研矛盾、SKILL.md 行数超标、三套命名无映射）~~ — 3 个 P1 ✅ **已修复**
- 健康度监控无实现 — 1 个 P2（待优化）

**最大的优势**：契约先行设计。api-contract 将 OpenAPI 作为单一真相，同时驱动前端客户端生成、后端实现、契约测试，并支持 Prism Mock Server 联调。这是前后端协同的理论最优解。

**最大的挑战（已克服）**：~~理论与实测的鸿沟。契约声明 spec-userstory-to-design 需要 prototype/index.html，但 E2E 测试 design.generate 消费的是 spec.md，prototype → design 链路未验证。scaffold 无前后端组合模板、implement-executor 无前后端任务区分，使协同设计在执行层断裂。~~ ✅ **已修复**：E2E 补全 ui-design 步骤并让 design 消费 prototype，scaffold-runner 新增组合栈模板（monorepo 结构），implement-executor 新增 [frontend]/[backend] 标记 + 组合栈测试机制。前后端协同从设计层到执行层全链路打通。

**阶段判定**：**Phase 3（Beta 可用 · 后期，P0/P1 共 6 个问题全部清零）**。综合整体成熟度 **94%（P0+P1 修复后）**；距 Phase 4（生产就绪）的剩余差距为 P2 优化项（健康度监控落地 + 多平台手动验证 + 编排状态机）。建议对外成熟度表述取 94%，工程可用性内部评估取 94-96% 区间。

---

# 附录：v8 历史评估（LLM 集成维度，保留作为参考）

> 以下为 2026-08-25 第九轮评估（v8）内容，侧重 LLM 集成深度，保留作为历史参考。
> v9 完整体检见上方章节。

---

## v8 · 一、总体结论

| 维度 | v7 评分 | v8 评分 | 变化 | 一句话评价 |
|---|---|---|---|---|
| **设计文档完整度** | **96%** | **96%** | → | 保持不变 |
| **实际代码实现度** | **88%** | **93%** | ↑ +5 | 剩余 7 个 Skill 全部迁移到结构化 LLM 方法，新增 `analyzeError` 方法 |
| **MCP 集成方案** | **97%** | **98%** | ↑ +1 | `analyzeError` 新增，结构化方法达 10 个 |
| **Bundle 配置** | **95%** | **95%** | → | 保持不变 |
| **架构设计合理性** | **96%** | **98%** | ↑ +2 | 三层架构（AST 预检测 → 代码模式分析 → LLM 深度分析）在 openspec-workflow 落地 |
| **整体成熟度** | **92%** | **96%** | ↑ +4 | **15/15 Skill 全量深度集成 LLM**，LLM 集成深度从 75% → 95% |

---

## 二、v7→v8 变更——做了什么

### ✅ v7→v8 新增（5 项）

| # | 变更 | 影响 | 说明 |
|---|---|---|---|
| 1 | **新增 `analyzeError` 结构化方法** | MCP 集成 +1% | llm-client.js 新增第 10 个结构化方法：错误根因分析，输出 JSON（rootCause/errorType/severity/category/fixSteps/prevention/confidence）。自动接收 error + stackTrace + codeContext + logContext |
| 2 | **`generateDocument` 和 `generateCode` 新增 `customSystem` 参数** | 代码实现 +1% | 允许 Skill 保留定制提示词的同时使用结构化方法的标准输出解析（Markdown 代码块清理、JSON 解析容错、错误降级），解决了"定制 prompt vs 结构化方法"的矛盾 |
| 3 | **7 个 Skill 全量迁移到结构化 LLM 方法** | 代码实现 +4% | spec-bootstrap→`generateDocument`、scaffold-runner→`reviewCode`、api-contract→`reviewCode`、html-converter→`reviewCode`+`generateCode`、openspec-workflow→`analyzeCodePatterns`、test-runner→`analyzeError`+`reviewCode`、debug-helper→`analyzeError` |
| 4 | **二次清理：6 个 callLLM → 结构化方法** | 代码实现 +1% | spec-bootstrap 4 个（specify/plan/tasks/checklist→`generateDocument`）+ html-converter 2 个（convertWithLLM/typesWithLLM→`generateCode`），callLLM 总数从 20→14 |
| 5 | **三层分析架构在 openspec-workflow 落地** | 架构 +2% | AST 影响分析（函数/导出/导入）→ `analyzeCodePatterns` 设计模式检测 → LLM SPEC delta 深度分析，形成"AST 预检测 → 代码模式分析 → LLM 深度分析"三层管线 |

### v2 关键问题 #13（LLM 集成深度）进展

| 指标 | v7 | v8 | 变化 |
|---|---|---|---|
| 深度集成 LLM 的 Skill 数 | 8/15 | **15/15** | ↑ +7 |
| 有 LLM 调用但未结构化的 Skill 数 | 7/15 | **0/15** | ↓ -7 |
| 结构化 LLM 便捷方法数 | 9 | **10** | ↑ +1 |
| LLM 集成深度评分 | 75% | **95%** | ↑ +20% |

**15/15 全量深度集成的 Skill**：
- `implement-executor` — MCP Sampling + AST 语法验证 + 代码清理
- `review-checklist` — `analyzeSecurity` + AST 安全预检测
- `dependency-auditor` — `analyzeDependencyRisk` + 真实 npm audit
- `code-patterns` — `analyzeCodePatterns` + AST 代码结构分析
- `environment-manager` — `analyzeEnvSecurity` + AST 环境变量扫描
- `git-workflow` — `generateCommitMessage` 降级 + AST diff 分析
- `ui-design` — csstree AST + LLM 设计生成
- `spec-userstory-to-design` — AST spec 解析 + LLM 设计转换
- `spec-bootstrap` — `generateDocument` 生成 spec/plan/tasks/checklist/README（v8 新增，customSystem 保留定制 prompt）
- `scaffold-runner` — `reviewCode` 验证生成代码质量（v8 新增）
- `api-contract` — `reviewCode` 审查 OpenAPI YAML（v8 新增）
- `html-converter` — `reviewCode` 验证组件代码 + `generateCode` 生成组件/类型（v8 新增）
- `openspec-workflow` — `analyzeCodePatterns` 三层分析架构（v8 新增）
- `test-runner` — `analyzeError`+`reviewCode` 双方法集成（v8 新增）
- `debug-helper` — `analyzeError` 根因分析（v8 新增）

### ✅ v2 关键问题全量修复状态（18/18）

| # | v2 问题 | v6 | v7 | v8 | 最终状态 |
|---|---|---|---|---|---|
| 1 | AST 解析依赖缺失 | 完整 | 完整 | 完整 | ✅ parse5+csstree+recast，43 API |
| 2 | html-converter 无 AST | 70% | 70% | 70% | ✅ parse5 AST |
| 3 | ui-design 无 AST | 75% | 75% | 75% | ✅ csstree AST |
| 4 | MCP Sampling 未实现 | 完整 | 完整 | 完整 | ✅ IPC+延迟检测+三级降级 |
| 5 | sampling 检测时机错误 | 保持 | 保持 | 保持 | ✅ 延迟检测 |
| 6-12 | YAML/构建/Tool名/CLI 参数 | 保持 | 保持 | 保持 | ✅ 全部保持 |
| 13 | LLM 集成深度不足 | 62% | 75% | **95%** | ✅ **15/15 全量深度集成，0 个未结构化** |
| 14 | 测试弱断言比例高 | 90% | 90% | 90% | ✅ ~10% 拋留 |
| 15 | AST 解析覆盖不全 | 100% | 100% | 100% | ✅ 15/15 Skill 100% 迁移 |
| 16 | dependency-auditor 无 npm audit | 已修复 | 保持 | 保持 | ✅ 真实 npm audit --json |
| 17 | environment-manager 无 Doppler/Vault | 已修复 | 保持 | 保持 | ✅ 三后端 + secrets sync |
| 18 | 缺少端到端链路测试 | 已修复 | 保持 | 保持 | ✅ 12 步全链路 + AST 传播 |

**v2 的 18 个关键问题：全部完全修复，#13 LLM 集成深度从 62% → 95%**

---

## 三、15 个子 Skill 逐项评分（v8 最新）

### Phase 1 · 项目初始化（7 个）

| # | Skill 名称 | v7 | v8 | 变化 | LLM 深度集成 | 一句话评价 |
|---|---|---|---|---|---|---|
| 1 | **spec-bootstrap** | 75% | **78%** | ↑ +3 | ✅ `generateDocument`（v8） | AST 验证 + LLM 自动生成 README |
| 2 | **code-patterns** | 82% | 82% | → | ✅ `analyzeCodePatterns`（v7） | AST 结构分析 → LLM 模式识别增强 |
| 3 | **scaffold-runner** | 90% | **92%** | ↑ +2 | ✅ `reviewCode`（v8） | 17 种技术栈 + LLM 代码质量审查 |
| 4 | **ui-design** | 78% | 78% | → | ✅ 已有深度集成 | csstree AST + LLM 设计生成 |
| 5 | **spec-userstory-to-design** | 65% | 65% | → | ✅ 已有深度集成 | AST spec 解析 + LLM 设计转换 |
| 6 | **api-contract** | 80% | **83%** | ↑ +3 | ✅ `reviewCode`（v8） | AST 端点提取 + LLM 契约审查 |
| 7 | **html-converter** | 75% | **78%** | ↑ +3 | ✅ `reviewCode`（v8） | parse5 AST + LLM 组件代码审查 |

**Phase 1 平均：80%（v7: 78%，↑ +2）**

### Phase 2 · 功能变更与实现（4 个）

| # | Skill 名称 | v7 | v8 | 变化 | LLM 深度集成 | 一句话评价 |
|---|---|---|---|---|---|---|
| 8 | **openspec-workflow** | 65% | **72%** | ↑ +7 | ✅ `analyzeCodePatterns`（v8） | **三层架构：AST影响→模式检测→LLM深度分析** |
| 9 | **implement-executor** | 78% | **85%** | ↑ +7 | ✅ 已有深度集成 | AST + MCP Sampling + 语法验证 + **断点恢复（resume/rollback/abort）** |
| 10 | **test-runner** | 72% | **78%** | ↑ +6 | ✅ `analyzeError`+`reviewCode`（v8） | **双方法：失败分析+契约审查** |
| 11 | **git-workflow** | 92% | 92% | → | ✅ `generateCommitMessage`（v7） | AST diff + LLM commit message + 降级方案 |

**Phase 2 平均：82%（v7: 77%，↑ +5）**

### Phase 3 · 质量保障（4 个）

| # | Skill 名称 | v7 | v8 | 变化 | LLM 深度集成 | 一句话评价 |
|---|---|---|---|---|---|---|
| 12 | **debug-helper** | 75% | **80%** | ↑ +5 | ✅ `analyzeError`（v8） | **AST错误分析 → LLM根因定位**，analyze/trace/logs 三函数全迁移 |
| 13 | **review-checklist** | 80% | 80% | → | ✅ `analyzeSecurity`（v7） | AST 安全预检测 → LLM 深度安全审计 |
| 14 | **dependency-auditor** | 80% | 80% | → | ✅ `analyzeDependencyRisk`（v7） | npm audit → LLM 健康评分 + 风险分析 |
| 15 | **environment-manager** | 82% | 82% | → | ✅ `analyzeEnvSecurity`（v7） | AST 环境变量 → LLM 安全评分 |

**Phase 3 平均：80%（v7: 79%，↑ +1）**

---

## 四、三大阶段整体完成度

| 阶段 | v7 平均 | v8 平均 | 变化 | 核心变化 |
|---|---|---|---|---|
| **Phase 1 · 项目初始化** | 78% | 80% | ↑ +2 | spec-bootstrap/scaffold-runner/api-contract/html-converter 4 个 Skill 新增结构化 LLM |
| **Phase 2 · 功能变更与实现** | 77% | 82% | ↑ +5 | openspec-workflow 三层架构 + test-runner 双方法 + implement-executor 断点恢复 |
| **Phase 3 · 质量保障** | 79% | 80% | ↑ +1 | debug-helper 全函数迁移到 analyzeError |

---

## 五、LLM 集成深度专题分析（v8 更新）

### 5.1 LLM 集成架构演进

| 阶段 | 特征 | 状态 |
|---|---|---|
| **Level 0：无 LLM** | 纯模板/正则 | ❌ 已超越 |
| **Level 1：通道可用** | MCP Sampling 打通，但 Skill 不调用 | ❌ 已超越 |
| **Level 2：有 LLM 调用** | Skill 有 callLLM 但 prompt 通用，结果解析粗糙 | ❌ **0/15**（v8 全量迁移完毕，残留 14 个 callLLM 均为特定 JSON 格式 + 正确解析） |
| **Level 3：结构化 LLM** | 使用专用便捷方法，prompt 有角色/格式/上下文，JSON 解析 | **8/15** Skill 处于此级 |
| **Level 4：深度优化** | AST 预检测 → LLM 深度分析 + `customSystem` 保留定制 prompt + 多方法组合 | **7/15** Skill 处于此级 |

### 5.2 "AST 预检测 → 代码模式分析 → LLM 深度分析" 三层架构

v7 引入 **双层分析架构**，v8 升级为 **三层分析架构**（openspec-workflow 落地）：

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  AST 预检测层    │ ──→ │  代码模式分析层      │ ──→ │  LLM 深度分析层      │
│  (精确事实)      │     │  (结构化识别)        │     │  (上下文增强推理)    │
│                 │     │                     │     │                     │
│ • 硬编码密钥    │     │ • 函数/导入/导出    │     │ • OWASP 安全审计     │
│ • XSS 风险      │     │ • 设计模式检测       │     │ • 严重性重排         │
│ • eval 使用     │     │ • 影响范围分析       │     │ • 修复建议           │
│ • 空 catch      │     │ • 代码质量评估       │     │ • 评分               │
│ • 依赖使用      │     │ • SPEC delta 检测    │     │ • 健康评估           │
│ • 环境变量      │     │ • 端点/表单提取      │     │ • 风险优先级         │
└─────────────────┘     └─────────────────────┘     └─────────────────────┘
      ↑ recast               ↑ analyzeCodePatterns        ↑ MCP Sampling
      ↑ parse5               ↑ reviewCode                ↑ 专用便捷方法
      ↑ csstree               ↑ generateDocument          ↑ JSON 结构化输出
```

**已落地此架构的 Skill**：

| Skill | AST 预检测内容 | LLM 深度分析 | 三层效果 |
|---|---|---|---|
| review-checklist | 硬编码密钥/XSS/eval/同步IO/空catch | `analyzeSecurity` OWASP 审计 | AST 精确定位 + LLM 上下文修复建议 |
| dependency-auditor | 依赖 import/require 使用分析 | `analyzeDependencyRisk` 健康评分 | 真实 npm audit + LLM 风险优先级 |
| code-patterns | 函数/导入/导出/模式检测 | `analyzeCodePatterns` 模式识别 | AST 结构事实 + LLM 建议模式 |
| environment-manager | env 变量使用/硬编码密钥扫描 | `analyzeEnvSecurity` 安全评分 | AST 精确发现 + LLM 修复路线 |
| git-workflow | diff hunks 变更范围分析 | `generateCommitMessage` 降级 | AST 推断 type/scope + LLM 生成 |
| debug-helper (v8) | stack trace 帧解析/空catch/eval/console | `analyzeError` 根因分析 | AST 代码风险检测 + LLM 根因定位 |
| openspec-workflow (v8) | 函数/导出/导入影响分析 | `analyzeCodePatterns`+LLM delta | **三层管线：AST影响→模式检测→LLM深度分析** |
| scaffold-runner (v8) | AST 文件语法验证 | `reviewCode` 代码质量审查 | AST 生成 + LLM 质量验证 |
| api-contract (v8) | AST 端点提取 | `reviewCode` 契约审查 | AST 接口发现 + LLM 设计审查 |
| html-converter (v8) | parse5 表单字段/重复结构 | `reviewCode` 组件审查 | AST 结构提取 + LLM 代码质量验证 |
| test-runner (v8) | AST 测试用例提取 | `analyzeError`+`reviewCode` | AST 测试分析 + LLM 失败诊断+契约审查 |
| spec-bootstrap (v8) | AST Markdown 代码块验证 | `generateDocument`（customSystem）生成 spec/plan/tasks/checklist/README | AST 验证 + LLM 文档自动生成（5 个命令全迁移） |

### 5.3 llm-client.js 方法体系

| 方法 | 输入 | 输出 | 使用的 Skill |
|---|---|---|---|
| `callLLM` | system + messages | { ok, content, provider } | 所有 Skill（底层方法） |
| `generateCode` | taskDescription + codePatterns + **customSystem** | { ok, code } | implement-executor, html-converter(v8: convertWithLLM/typesWithLLM) |
| `generateTests` | sourceCode + testFramework | { ok, code } | test-runner |
| `reviewCode` | code + checklist | { ok, review: { score, issues } } | review-checklist, scaffold-runner(v8), api-contract(v8), html-converter(v8), test-runner(v8) |
| `generateCommitMessage` (v7) | diff + stagedFiles + convention | { ok, message } | git-workflow |
| `analyzeCodePatterns` (v7) | code + framework + existingPatterns | { ok, analysis: { detected, suggested } } | code-patterns, openspec-workflow(v8) |
| `analyzeSecurity` (v7) | code + astFindings + checklist | { ok, audit: { score, findings } } | review-checklist |
| `analyzeDependencyRisk` (v7) | deps + auditData + outdated | { ok, analysis: { healthScore, risks } } | dependency-auditor |
| `generateDocument` (v7) | type + projectName + techStack + **customSystem** | { ok, document } | spec-bootstrap(v8: specify/plan/tasks/checklist/README) |
| `analyzeEnvSecurity` (v7) | envVars + astFindings + env | { ok, analysis: { score, issues } } | environment-manager |
| `analyzeError` (v8) | error + stackTrace + codeContext + logContext | { ok, analysis: { rootCause, fixSteps, prevention } } | debug-helper(v8), test-runner(v8) |

### 5.4 安全设计

- **敏感数据脱敏**：`analyzeEnvSecurity` 自动将 `PASSWORD`/`SECRET`/`KEY`/`TOKEN` 等变量值替换为 `***MASKED***` 后再发给 LLM
- **优雅降级**：所有方法在 LLM 不可用时返回 `{ ok: false }`，调用方走原有模板逻辑
- **JSON 解析容错**：正则提取 JSON → `JSON.parse` → 失败时返回默认结构（不报错）
- **Markdown 代码块清理**：自动去除 LLM 返回的 ` ``` ` 标记

---

## 六、各维度详细分析

### 6.1 文档质量

**v7: 96% → v8: 96%（不变）**

v6 已完成全量同步，v7/v8 无文档变更。

### 6.2 实际代码实现程度

**v7: 88% → v8: 93%（↑ +5）**

**v8 新增**：
- llm-client.js 新增 `analyzeError` 方法（第 10 个结构化方法）
- `generateDocument` 和 `generateCode` 新增 `customSystem` 参数，支持保留 Skill 定制提示词
- 7 个 Skill 从 raw `callLLM` 迁移到结构化方法（共修改 12 处 LLM 调用）
- 二次清理：spec-bootstrap 4 个 callLLM → `generateDocument`，html-converter 2 个 callLLM → `generateCode`
- openspec-workflow 落地三层分析架构（AST → codePatterns → LLM delta）
- test-runner 双方法集成（analyzeError + reviewCode）

**callLLM 残留统计（v8 最终）**：

| Skill | 残留 callLLM 数 | 原因 |
|---|---|---|
| spec-bootstrap | 2 | clarify（Q&A JSON）、analyze（一致性 JSON） |
| html-converter | 2 | splitWithLLM（组件拆分 JSON）、beautifyWithLLM（HTML 美化） |
| test-runner | 3 | coverage/report/config（特定 JSON 格式） |
| openspec-workflow | 2 | delta（SPEC delta JSON）、tasks（任务计划 JSON） |
| api-contract | 5 | validate/diff/enhance/review + 1（特定 JSON 格式） |
| debug-helper | 0 | 全部迁移到 `analyzeError` |
| scaffold-runner | 0 | 已使用 `reviewCode` |
| **合计** | **14** | 全部为特定 JSON 格式 + 正则解析 + 错误处理 + try/catch 降级 |

**残留差距**：
1. ~~7/15 Skill 有 LLM 调用但未使用结构化方法~~ ✅ v8 全量迁移完毕（0/15）
2. ~~缺少 pipeline 断点恢复~~ ✅ v8 实现 resume/rollback/abort + 重试预算 + 状态验证 + 跳过失败任务
3. ~~无性能基线数据~~ ✅ v8 创建 benchmark.js + run-benchmark.js，已生成 docs/benchmarks/baseline.json

**性能基线数据（v8 首次采集）**：

| 指标 | 值 | 说明 |
|---|---|---|
| AST HTML 解析 | 0.88 ms | parse5，50 次采样 |
| AST CSS 解析 | 0.37 ms | css-tree，50 次采样 |
| AST JS 解析 | 2.64 ms | recast，30 次采样 |
| AST TS 解析 | 0.75 ms | @babel/parser，30 次采样 |
| HTML body 提取 | 0.41 ms | parse5 AST 遍历 |
| HTML class 提取 | 0.22 ms | parse5 AST 遍历 |
| 表单字段提取 | 0.19 ms | parse5 AST 定位 |
| parsePhases | 0.01 ms | tasks.md 解析 |
| validateCodeSyntax | 0.86 ms | recast 语法验证 |
| cleanGeneratedCode | 0.05 ms | Markdown 代码块清理 |
| 模块加载（Skill） | 6-10 ms | 8 个 Skill 首次 require |
| 模块加载（ast-parser） | 1142 ms | parse5+csstree+recast 依赖 |
| LLM 可用性检查 | 0.01 ms | isAvailable() |
| 15 Skill 内存占用 | +1.96 MB | heap delta |
| 全量基准测试耗时 | 1555 ms | 含 5 大类 15+ 指标 |

### 6.3 MCP 集成方案

**v7: 97% → v8: 98%（↑ +1）**

新增 `analyzeError` 结构化方法（第 10 个），MCP Sampling 利用率进一步提升。当 MCP Sampling 可用时，所有 10 个结构化方法自动通过 TRAE Agent LLM 处理，覆盖文档生成/代码生成/代码审查/安全审计/依赖分析/模式识别/环境扫描/提交生成/错误分析全场景。

### 6.4 架构设计合理性

**v7: 96% → v8: 98%（↑ +2）**

**v8 新增的架构优势**：
- **三层分析架构**在 openspec-workflow 落地：AST 影响分析 → 代码模式检测 → LLM 深度分析，从双层升级为三层管线
- **`customSystem` 参数**：解决"定制 prompt vs 结构化方法"矛盾，Skill 可保留领域专属提示词的同时享受结构化输出的标准解析（Markdown 清理、JSON 容错、错误降级）
- **全量结构化覆盖**：15/15 Skill 全部使用结构化 LLM 方法，残留 14 个 callLLM 均为特定 JSON 格式 + 正确解析 + try/catch 降级

**v7 架构优势保持**：
- "AST 预检测 → LLM 深度分析" 双层架构：结合 AST 的精确性和 LLM 的推理能力
- 结构化 LLM 响应：所有方法要求 JSON 输出 + 容错解析 + 默认降级
- 敏感数据安全：环境变量自动脱敏后再发给 LLM

### 6.5 Bundle 配置文件

**v7: 95% → v8: 95%（不变）**

---

## 七、主要差距与风险（v8 更新）

### 🔴 高风险 / 关键差距

| # | 差距 | v7 状态 | v8 状态 | 影响 | 优先级 |
|---|---|---|---|---|---|
| 1 | ~~AST 迁移率低~~ | 100% ✅ | 100% ✅ | — | ~~P0~~ 已解决 |
| 2 | ~~**LLM 集成深度不足**~~ | 75%（8/15 深度集成） | **95%**（15/15 深度集成） | ~~7/15 Skill 有 LLM 但未结构化~~ → ✅ 全量迁移 | ~~P1~~ ✅ v8 已解决 |

### 🟡 中风险 / 重要差距

| # | 差距 | v7 状态 | v8 状态 | 影响 | 优先级 |
|---|---|---|---|---|---|
| 3-7 | ~~npm audit / Doppler/Vault / 弱断言 / schema / E2E~~ | 保持 | 保持 | — | ~~P1~~ 已解决 |
| 8 | ~~**缺少 pipeline 断点恢复**~~ | 保持 | ✅ **已解决** | ~~implement 阶段失败后需从头重来~~ → 实现 resume/rollback/abort + 重试预算 + 状态验证 + 跳过失败任务 | ~~P2~~ ✅ v8 已解决 |
| 9 | ~~**7/15 Skill LLM 未结构化**~~ | ~~新发现~~ | ✅ **已解决** | ~~有 callLLM 但 prompt 通用~~ → 15/15 Skill 使用结构化方法，残留 14 个 callLLM 均为特定 JSON 格式 + 正确解析 + 错误处理 | ~~P2~~ ✅ v8 已解决 |

### 🟢 低风险 / 优化项

| # | 差距 | v7 状态 | v8 状态 | 影响 | 优先级 |
|---|---|---|---|---|---|
| 10-14 | MCP 配置/skillMap/Windows/CI-CD | 保持 | 保持 | — | P3 |
| 15 | ~~性能基线数据~~ | 无 | ✅ **已解决** | ~~无性能基线~~ → benchmark.js + baseline.json，15+ 指标首次采集 | ~~P3~~ ✅ v8 已解决 |

---

## 八、成熟度阶段判定

| 阶段 | v7 状态 | v8 状态 |
|---|---|---|
| **Phase 3：Beta 可用** | ✅ 后期 | ✅ **后期（稳定）** |
| **Phase 4：生产就绪** | ❌ 未达到（接近） | ❌ 未达到（接近） |

**当前阶段：Phase 3（Beta 可用 · 后期，稳定）**

v7→v8 的核心进步：

1. **LLM 集成深度从 75% 到 95%** — 15/15 Skill 全量深度集成，0 个未结构化
2. **"AST 预检测 → LLM 深度分析" 双层架构升级为三层** — openspec-workflow 落地 AST 影响分析 → 代码模式检测 → LLM 深度分析
3. **llm-client.js 方法体系从 9 到 10** — 新增 `analyzeError`，`customSystem` 参数解决定制 prompt 与结构化方法的矛盾
4. **高风险 #2 和中风险 #9 全量解决** — 所有 LLM 相关风险清零

**距离 Phase 4（生产就绪）的主要差距**：
1. ~~LLM 深度集成~~ → ✅ 15/15 全量深度集成（v8 完成）
2. ~~7/15 Skill LLM 未结构化~~ → ✅ 0/15，残留 14 个 callLLM 均有正确解析（v8 完成）
3. ~~pipeline 断点恢复机制~~ → ✅ resume/rollback/abort + 重试预算 + 状态验证（v8 完成）
4. ~~性能基线数据~~ → ✅ benchmark.js + baseline.json，15+ 指标首次采集（v8 完成）
5. 真实 macOS/Linux 手动验证

---

## 九、建议的优先级路线图（v8）

### 短期（已完成）

| # | 任务 | 状态 |
|---|---|---|
| 1 | ~~批量迁移 Skill 到 AST~~ | ✅ 100% |
| 2 | ~~强化测试断言~~ | ✅ ~10% 弱断言 |
| 3 | ~~端到端链路测试~~ | ✅ 12 步 |
| 4 | ~~npm audit 集成~~ | ✅ |
| 5 | ~~文档全量同步~~ | ✅ |
| 6 | ~~CI/CD 流水线~~ | ✅ |
| 7 | ~~LLM 深度集成~~ | ✅ 15/15 Skill 全量深度集成（v8 完成） |

### 中期（2-4 周）：接近生产就绪

| # | 任务 | 预期效果 | 优先级 |
|---|---|---|---|
| 8 | ~~**7 个 Skill LLM 结构化**~~ | ~~spec-bootstrap/scaffold-runner/api-contract/html-converter/openspec/test-runner/debug-helper 使用专用方法~~ | ~~P2~~ ✅ v8 完成 |
| 9 | ~~**pipeline 断点恢复**~~ | ~~implement-executor 增 `resume` 命令~~ | ~~P2~~ ✅ v8 完成 |
| 10 | ~~**性能基线测试**~~ | ~~测量各 Skill 执行时间/LLM 延迟~~ | ~~P3~~ ✅ v8 完成 |
| 11 | **编排状态机** | 主 Skill 自动串联 Phase 1→2→3 | P3 |

### 长期（1-3 月）：生产就绪

| # | 任务 | 说明 |
|---|---|---|
| 12 | 真实 macOS/Linux 手动验证 | CI 之外的多平台测试 |
| 13 | Marketplace 上架 | 文档、示例、视频教程 |
| 14 | 性能优化 | 大型项目响应时间 |
| 15 | 多语言/i18n 支持 | Skill 输出多语言 |

---

## 十、总结

`project-orchestrator-bundle` 在 v7→v8 期间完成了 **LLM 集成从"深度集成"到"全量结构化"的最终跃迁**：

### 核心成就

- **LLM 全量深度集成**：15/15 Skill 具备结构化 LLM 分析（v7: 8/15），0 个未结构化 Skill
- **三层架构**：从"AST 预检测 → LLM 深度分析"双层升级为三层（AST 影响分析 → 代码模式检测 → LLM 深度分析），openspec-workflow 落地
- **llm-client.js 方法体系**：从 9 个扩展到 10 个结构化方法，新增 `analyzeError`，`customSystem` 参数解决定制 prompt 与结构化方法的矛盾
- **v2 问题 #13 最终修复**：LLM 集成深度从 75% → 95%，从 P2 降为 ✅ 已解决
- **中风险 #8 解决**：pipeline 断点恢复机制 — resume/rollback/abort + 重试预算 + 状态验证 + 跳过失败任务
- **中风险 #9 解决**：7/15 Skill LLM 未结构化 → 0/15，残留 14 个 callLLM 均为特定 JSON 格式 + 正确解析 + 错误处理
- **低风险 #15 解决**：性能基线数据 — benchmark.js + baseline.json，15+ 指标首次采集（AST 解析 < 3ms，15 Skill 内存 +1.96MB）

### 数字对比

| 指标 | v3 | v6 | v7 | v8 | v3→v8 变化 |
|---|---|---|---|---|---|
| AST 迁移率 | 13% | 100% | 100% | 100% | ↑ +87% |
| LLM 深度集成 Skill 数 | 0/15 | 2/15 | 8/15 | **15/15** | ↑ +15 |
| 结构化 LLM 方法数 | 3 | 3 | 9 | **10** | ↑ +7 |
| callLLM 残留数 | — | — | ~20 | **14**（均为特定 JSON） | ↓ -6 |
| 测试数 | 73 | 91 | 91 | **91** | ↑ +18 |
| Skill 平均分 | 70% | 76% | 78% | **80%** | ↑ +10% |
| 整体成熟度 | 75% | 90% | 92% | **96%** | ↑ +21% |
| 已修复关键问题 | 5/18 | 16/18 | 17/18 | **18/18** | ↑ +13 |

### 最大的突破

v2 的 18 个关键问题已 **全部完全修复**。v8 的核心突破是完成 LLM 集成的最后一步：将剩余 7 个未结构化的 Skill 全量迁移到结构化方法，同时引入 `customSystem` 参数解决了"定制 prompt vs 结构化方法"的矛盾，使所有 Skill 既能保留领域专属提示词，又能享受结构化输出的标准解析。15/15 Skill 全量深度集成 LLM，"AST 预检测 → 代码模式分析 → LLM 深度分析" 三层架构成为核心设计创新。

### 最大的挑战

~~7/15 Skill 有 LLM 调用但未使用结构化方法（spec-bootstrap/scaffold-runner/api-contract/html-converter/openspec/test-runner/debug-helper）。这些 Skill 的 prompt 通用、结果解析粗糙，需要逐个接入专用便捷方法。完成后 LLM 集成深度可达 90%+，接近生产就绪。~~ ✅ v8 已完成：15/15 Skill 全量迁移到结构化方法，LLM 集成深度达 95%。pipeline 断点恢复已实现（resume/rollback/abort），性能基线数据已采集（benchmark.js + baseline.json）。剩余挑战为真实 macOS/Linux 多平台手动验证。

### 最大的优势

"AST 预检测 → 代码模式分析 → LLM 深度分析" 三层架构是 v8 的核心设计创新。它结合了 AST 的精确性（事实发现）、代码模式的结构化识别和 LLM 的推理能力（上下文增强），既保证检测准确性又提升分析深度。v8 已将此模式推广到 15/15 Skill 全量覆盖，是达到 Phase 4（生产就绪）的核心基础。