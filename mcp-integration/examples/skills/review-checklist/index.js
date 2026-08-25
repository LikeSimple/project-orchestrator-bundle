/**
 * review-checklist Skill - 完整代码审查引擎
 *
 * 7 大类 73 条静态规则 + LLM 辅助审查 + code-patterns 一致性校验
 *
 * 命令：
 *   pr        - 审查 PR / git diff
 *   file      - 审查单个文件
 *   files     - 审查多个文件（文件路径列表）
 *   diff      - 审查 diff 文本
 *   summary   - 生成审查摘要报告
 *   checklist - 列出所有规则（支持按类别过滤、json/markdown 格式）
 *   explain   - 解释单条规则的详细信息（标题/为什么/怎么修/正反例）
 *
 * 对应 MCP Tools: review_pr, review_file, review_files, review_summary, review_checklist, review_explain
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

const execAsync = promisify(exec);

// ============================================================
// 规则类别定义
// ============================================================

const RULE_CATEGORIES = {
  BIZ:      { name: 'Business Correctness', label: '业务正确性', icon: '📋' },
  CONTRACT: { name: 'Contract Consistency', label: '契约一致性', icon: '📜' },
  SEC:      { name: 'Security', label: '安全', icon: '🔒' },
  PERF:     { name: 'Performance', label: '性能', icon: '⚡' },
  MAINT:    { name: 'Maintainability', label: '可维护性', icon: '🔧' },
  TEST:     { name: 'Testing', label: '测试', icon: '🧪' },
  PATTERN:  { name: 'Code Patterns', label: '代码规范一致性', icon: '🎨' },
};

// ============================================================
// 规则元数据定义
// ============================================================

const RULE_DEFS = {
  // ---- BIZ: 业务正确性 (8 条) ----
  'BIZ-001': {
    category: 'BIZ',
    title: '业务代码变更应同步更新 spec.md',
    description: '当新增或修改较多业务代码时，应同步更新 spec.md 或相关文档，确保设计文档与代码一致。',
    severity: 'warn',
    automation: 'auto',
    why: '业务代码与文档不同步会导致后续维护困难，新人无法理解设计意图，技术债务持续累积。',
    fix: '如果涉及业务逻辑变更，请同步更新 spec.md 或相关设计文档中的 Acceptance Scenarios 部分。',
    examples: {
      bad: '新增了 100+ 行业务代码但没有任何文档更新',
      good: '代码变更同时更新了 spec.md 中的 Acceptance Scenarios 和业务流程图'
    },
  },
  'BIZ-002': {
    category: 'BIZ',
    title: '新增源文件应有对应测试',
    description: '新增业务源文件时应同步添加单元测试文件，确保代码质量基线。',
    severity: 'error',
    automation: 'auto',
    why: '缺少测试的代码难以安全重构，bug 发现晚，修复成本高。',
    fix: '为每个新模块添加单元测试，命名为 *.test.ts 或 *.spec.ts，放在同目录或 __tests__ 目录下。',
    examples: {
      bad: '新增 src/services/payment.ts 但没有 payment.test.ts',
      good: '新增 src/services/payment.ts 同时新增 src/services/__tests__/payment.test.ts'
    },
  },
  'BIZ-003': {
    category: 'BIZ',
    title: 'TODO/FIXME 不应大量留到生产',
    description: '代码中不应包含大量未解决的 TODO/FIXME/HACK 注释，应在合并前清理或创建 issue 跟踪。',
    severity: 'warn',
    automation: 'auto',
    why: '大量临时注释说明代码未完工，长期积累会变成技术债务黑洞，没人知道哪些已解决。',
    fix: '在合并前清理临时注释，或将每个 TODO 关联到 issue 跟踪系统并标注 issue 编号。',
    examples: {
      bad: '代码中散布 10 个 TODO: fix later 注释',
      good: 'TODO(#1234): 等 v2 API 上线后重构此处（关联 issue）'
    },
  },
  'BIZ-004': {
    category: 'BIZ',
    title: '错误处理不应吞掉异常',
    description: '空 catch 块会静默吞掉异常，导致问题难以排查，违反 fail-fast 原则。',
    severity: 'error',
    automation: 'auto',
    why: '静默失败会隐藏 bug，导致数据不一致或更严重的连锁故障，且极难定位根因。',
    fix: '至少记录错误日志，或重新抛出更有语义的异常，不要让错误悄无声息。',
    examples: {
      bad: 'try { parse() } catch (e) {}',
      good: 'try { parse() } catch (e) { logger.error("parse failed", e); throw new ParseError("invalid data", e); }'
    },
  },
  'BIZ-005': {
    category: 'BIZ',
    title: '关键路径应有审计日志',
    description: '涉及认证、支付、交易等关键业务路径应添加审计日志，便于追溯和安全审计。',
    severity: 'warn',
    automation: 'auto',
    why: '关键操作没有日志记录，出问题时无法追溯，安全审计无法进行，责任无法界定。',
    fix: '在认证、支付、权限变更等关键操作路径添加结构化审计日志，包含操作人、操作类型、关键参数。',
    examples: {
      bad: 'login 函数只返回结果不记录任何日志',
      good: 'login 成功/失败都记录审计日志，包含 userId、ip、userAgent'
    },
  },
  'BIZ-006': {
    category: 'BIZ',
    title: '用户输入应有验证',
    description: '处理用户输入（params/body/query）的函数应进行输入验证，避免脏数据进入业务逻辑。',
    severity: 'warn',
    automation: 'auto',
    why: '未验证的输入可能导致数据异常、安全漏洞或业务逻辑错误，是 bug 的主要来源之一。',
    fix: '使用 zod/yup/joi 等库验证输入参数，在函数入口处进行 schema 校验。',
    examples: {
      bad: 'function createUser(body) { await db.insert(body); }',
      good: 'function createUser(body) { const data = userSchema.parse(body); await db.insert(data); }'
    },
  },
  'BIZ-007': {
    category: 'BIZ',
    title: '大量删除代码应确认无引用',
    description: '删除大量代码时应全局搜索确认没有其他地方引用被删除的函数/变量。',
    severity: 'warn',
    automation: 'auto',
    why: '误删仍在使用的代码会导致运行时错误，特别是动态引用或反射调用的场景更难发现。',
    fix: '全局搜索被删除的函数/变量名，确认无引用后再删除，使用 IDE 的 Find Usages 功能辅助检查。',
    examples: {
      bad: '直接删除 200 行工具函数文件，没有检查是否有其他模块引用',
      good: '先将函数标记为 deprecated，确认无引用后再彻底删除'
    },
  },
  'BIZ-008': {
    category: 'BIZ',
    title: '数据模型变更应有 migration',
    description: '修改数据模型/schema 时必须同步创建数据库 migration 文件，保证数据库结构与代码一致。',
    severity: 'error',
    automation: 'auto',
    why: '数据模型与数据库不同步会导致生产环境部署失败、数据丢失或应用崩溃。',
    fix: '创建对应的 migration 文件来同步数据库 schema，遵循版本化管理原则。',
    examples: {
      bad: '修改了 User model 添加了 email 字段，但没有 migration',
      good: '同时提交 model 变更和 migration: ALTER TABLE users ADD COLUMN email VARCHAR(255)'
    },
  },

  // ---- CONTRACT: 契约一致性 (10 条) ----
  'CONTRACT-001': {
    category: 'CONTRACT',
    title: 'API 变更应同步更新 OpenAPI 文档',
    description: '修改 API 路由或响应格式时，应同步更新 OpenAPI/Swagger 文档，保持接口契约一致。',
    severity: 'warn',
    automation: 'auto',
    why: 'API 文档与实现不同步会导致前端/客户端调用出错，增加沟通成本和集成风险。',
    fix: '同步更新 contracts/openapi.yaml 或相应的 API 文档，确保请求/响应格式与代码一致。',
    examples: {
      bad: '添加了 GET /api/v2/users 路由但 OpenAPI 文档还是 v1',
      good: '代码变更同时更新了 OpenAPI 文档，新增路径定义和响应 schema'
    },
  },
  'CONTRACT-002': {
    category: 'CONTRACT',
    title: 'API 响应格式应统一',
    description: '同一项目中的 API 响应格式应保持一致，使用统一的响应包装结构。',
    severity: 'warn',
    automation: 'auto',
    why: '响应格式不统一导致前端/客户端需要为每个接口写单独的解析逻辑，增加维护成本。',
    fix: '使用统一的响应格式，如 { code, data, message } 或 { success, data, error }。',
    examples: {
      bad: '有的接口返回 res.json(result)，有的返回 res.json({ data: result })',
      good: '所有接口统一使用 Result.success(data) 或 Result.error(message, code)'
    },
  },
  'CONTRACT-003': {
    category: 'CONTRACT',
    title: '错误响应建议使用 RFC 9457 Problem+JSON 格式',
    description: 'HTTP 错误响应建议遵循 RFC 9457 (Problem Details for HTTP APIs) 规范。',
    severity: 'warn',
    automation: 'auto',
    why: '标准化的错误格式便于客户端统一处理错误，提高 API 的可理解性和一致性。',
    fix: '错误响应包含 type/title/detail/status/instance 字段，遵循 RFC 9457 规范。',
    examples: {
      bad: 'res.status(404).json("not found")',
      good: 'res.status(404).json({ type: "/errors/not-found", title: "Not Found", detail: "User 123 not found", status: 404 })'
    },
  },
  'CONTRACT-004': {
    category: 'CONTRACT',
    title: '响应中建议包含 traceId',
    description: 'API 响应建议包含 traceId/requestId，便于分布式链路追踪和问题排查。',
    severity: 'info',
    automation: 'auto',
    why: '微服务架构下，没有 traceId 难以在多个服务间串联请求日志，排查问题效率极低。',
    fix: '在响应头（X-Trace-Id）或响应体中添加 traceId，贯穿整个调用链路。',
    examples: {
      bad: '响应中没有任何追踪标识',
      good: '响应头包含 X-Trace-Id: abc123，响应体中也包含 traceId 字段'
    },
  },
  'CONTRACT-005': {
    category: 'CONTRACT',
    title: '分页接口参数应完整',
    description: '分页接口应同时包含页码和每页数量参数，保持参数命名一致。',
    severity: 'warn',
    automation: 'auto',
    why: '分页参数不完整或命名不一致会导致前端分页组件难以复用，增加集成复杂度。',
    fix: '分页接口应同时包含页码（page/pageNum）和每页数量（pageSize/limit），命名保持项目统一。',
    examples: {
      bad: '接口只有 ?page=1 没有每页数量参数',
      good: '接口统一使用 ?page=1&pageSize=20 参数'
    },
  },
  'CONTRACT-006': {
    category: 'CONTRACT',
    title: 'API 路径建议使用版本号前缀',
    description: 'API 路径建议使用版本号前缀（如 /api/v1/），便于后续版本演进和向后兼容。',
    severity: 'info',
    automation: 'auto',
    why: '没有版本号的 API 在需要不兼容变更时无法平滑过渡，可能破坏现有客户端。',
    fix: '使用 /api/v1/xxx 格式，后续不兼容变更通过 v2、v3 版本号演进。',
    examples: {
      bad: 'app.use("/api/users", userRouter)',
      good: 'app.use("/api/v1/users", userRouter)'
    },
  },
  'CONTRACT-007': {
    category: 'CONTRACT',
    title: '日期时间格式应使用带时区的 ISO 8601',
    description: 'API 中的日期时间应使用完整的 ISO 8601 格式并包含时区信息（如 Z 或 +08:00）。',
    severity: 'warn',
    automation: 'auto',
    why: '不带时区的时间戳在不同时区的系统间传递时会产生歧义，导致时间计算错误。',
    fix: '使用带 Z（UTC）或 +08:00（东八区）的完整 ISO 8601 格式，如 2024-01-15T08:30:00Z。',
    examples: {
      bad: '"createdAt": "2024-01-15 08:30:00"',
      good: '"createdAt": "2024-01-15T08:30:00Z"'
    },
  },
  'CONTRACT-008': {
    category: 'CONTRACT',
    title: '关键写操作建议支持幂等性',
    description: '涉及订单、支付、转账等关键写操作的接口建议支持幂等性，防止重复提交。',
    severity: 'warn',
    automation: 'auto',
    why: '网络不稳定时客户端可能重试，没有幂等性会导致重复扣款、重复下单等严重业务问题。',
    fix: '添加 Idempotency-Key 请求头或 requestId 参数，服务端基于幂等键去重。',
    examples: {
      bad: 'POST /payment 每次调用都会创建新支付订单',
      good: 'POST /payment 携带 Idempotency-Key 头，相同 key 的请求只处理一次'
    },
  },
  'CONTRACT-009': {
    category: 'CONTRACT',
    title: '枚举/状态值建议使用字符串而非数字',
    description: 'API 中的枚举值、状态码建议使用字符串而非数字，提高可读性和可调试性。',
    severity: 'warn',
    automation: 'auto',
    why: '数字枚举值可读性差，需要查阅文档才能理解含义，前后端联调容易出错。',
    fix: '使用语义化的字符串枚举值，如 "PENDING"、"ACTIVE"、"CANCELLED" 而非 0、1、2。',
    examples: {
      bad: '{ "status": 1 }',
      good: '{ "status": "ACTIVE" }'
    },
  },
  'CONTRACT-010': {
    category: 'CONTRACT',
    title: '返回全量列表的接口建议支持分页',
    description: '可能返回大量数据的列表接口应支持分页，避免一次性返回全部数据。',
    severity: 'warn',
    automation: 'auto',
    why: '全量列表在数据量大时会导致响应慢、内存占用高、带宽浪费，甚至超时失败。',
    fix: '添加分页参数（page/pageSize 或 cursor/limit），限制单次返回的数据量。',
    examples: {
      bad: 'GET /users 返回全部用户列表',
      good: 'GET /users?page=1&pageSize=20 分页返回用户列表'
    },
  },

  // ---- SEC: 安全 (15 条) ----
  'SEC-001': {
    category: 'SEC',
    title: '禁止硬编码密钥/凭证',
    description: '代码中不应包含硬编码的 API Key、密码、私钥等敏感凭证信息。',
    severity: 'critical',
    automation: 'auto',
    why: '硬编码的密钥会被提交到版本控制系统，任何有代码访问权限的人都能获取，导致安全漏洞。',
    fix: '立即移除硬编码密钥，使用环境变量或密钥管理服务（如 AWS KMS、HashiCorp Vault）管理凭证。',
    examples: {
      bad: 'const apiKey = "sk-abc123def456";',
      good: 'const apiKey = process.env.OPENAI_API_KEY;'
    },
  },
  'SEC-002': {
    category: 'SEC',
    title: 'SQL 字符串拼接存在注入风险',
    description: '使用字符串拼接构造 SQL 查询语句存在 SQL 注入风险，可能导致数据泄露或篡改。',
    severity: 'critical',
    automation: 'auto',
    why: 'SQL 注入是最严重的安全漏洞之一，攻击者可通过构造恶意输入获取全部数据或删除表。',
    fix: '使用参数化查询（Prepared Statements）或 ORM 库，不要直接拼接 SQL 字符串。',
    examples: {
      bad: `db.query("SELECT * FROM users WHERE id = " + userId)`,
      good: `db.query("SELECT * FROM users WHERE id = ?", [userId])`
    },
  },
  'SEC-003': {
    category: 'SEC',
    title: '危险的 HTML 注入操作存在 XSS 风险',
    description: '直接设置 innerHTML 或使用 dangerouslySetInnerHTML 等操作存在 XSS 攻击风险。',
    severity: 'error',
    automation: 'auto',
    why: 'XSS 攻击允许攻击者注入恶意脚本，窃取用户 Cookie、会话令牌，或执行钓鱼攻击。',
    fix: '使用安全的文本渲染方式（如 textContent），或对输入进行严格的 HTML 转义/净化（DOMPurify）。',
    examples: {
      bad: 'div.innerHTML = userInput;',
      good: 'div.textContent = userInput;'
    },
  },
  'SEC-004': {
    category: 'SEC',
    title: '禁止使用 eval 和 new Function',
    description: '使用 eval() 或 new Function() 执行动态代码存在代码注入风险。',
    severity: 'critical',
    automation: 'auto',
    why: '如果动态执行的代码包含用户可控内容，攻击者可注入任意代码，完全控制程序执行。',
    fix: '避免使用 eval，改用更安全的替代方案，如对象映射、策略模式等。',
    examples: {
      bad: 'const result = eval(userInput + " + 1");',
      good: '使用策略模式或函数映射代替动态代码执行'
    },
  },
  'SEC-005': {
    category: 'SEC',
    title: 'CORS 不应配置为通配符 *',
    description: 'CORS 配置为通配符 * 允许任意域访问，存在安全风险。',
    severity: 'error',
    automation: 'auto',
    why: '通配符 CORS 配合携带凭证的请求可能导致 CSRF 攻击，让恶意网站获取用户数据。',
    fix: '明确指定允许的 origin 白名单，不要使用通配符 *，特别是涉及认证的接口。',
    examples: {
      bad: "cors({ origin: '*' })",
      good: "cors({ origin: ['https://app.example.com', 'https://admin.example.com'] })"
    },
  },
  'SEC-006': {
    category: 'SEC',
    title: '密码应使用安全哈希算法',
    description: '处理用户密码时必须使用 bcrypt/argon2/scrypt 等安全哈希算法，禁止明文存储。',
    severity: 'error',
    automation: 'auto',
    why: '明文或弱哈希存储的密码一旦泄露，用户账户将被直接盗用，造成严重的安全事故。',
    fix: '使用 bcrypt/argon2/scrypt 等安全算法对密码进行哈希，盐值自动生成且唯一。',
    examples: {
      bad: 'user.password = password;',
      good: 'user.passwordHash = await bcrypt.hash(password, 12);'
    },
  },
  'SEC-007': {
    category: 'SEC',
    title: '文件路径操作可能存在路径遍历风险',
    description: '使用用户输入构造文件路径时，如未正确验证可能导致路径遍历（Path Traversal）攻击。',
    severity: 'error',
    automation: 'auto',
    why: '攻击者可通过 ../../../ 等路径穿越访问系统敏感文件，如 /etc/passwd、配置文件等。',
    fix: '对用户输入的路径进行验证和净化，使用 path.resolve 后检查路径前缀是否在允许的目录内。',
    examples: {
      bad: 'fs.readFile("/uploads/" + filename)',
      good: 'const safePath = path.resolve(UPLOAD_DIR, filename); if (!safePath.startsWith(UPLOAD_DIR)) throw error;'
    },
  },
  'SEC-008': {
    category: 'SEC',
    title: '表单提交/状态变更建议添加 CSRF 防护',
    description: '涉及状态变更的 POST/PUT/DELETE 操作建议添加 CSRF 防护机制。',
    severity: 'warn',
    automation: 'auto',
    why: 'CSRF 攻击可诱导已登录用户在不知情的情况下执行操作，如修改密码、转账等。',
    fix: '使用 CSRF token 验证、SameSite Cookie 属性或自定义请求头验证来防护 CSRF 攻击。',
    examples: {
      bad: 'POST 表单没有任何 CSRF 防护',
      good: '表单包含 csrfToken 隐藏字段，服务端验证 token 有效性'
    },
  },
  'SEC-009': {
    category: 'SEC',
    title: '日志中不应输出敏感信息',
    description: '日志中不应包含密码、token、密钥等敏感信息，避免日志泄露导致安全问题。',
    severity: 'error',
    automation: 'auto',
    why: '日志系统通常权限较低，敏感信息写入日志后可能被未授权人员获取，造成凭证泄露。',
    fix: '记录日志前对敏感字段进行脱敏处理，使用日志中间件自动过滤敏感字段。',
    examples: {
      bad: 'console.log("login attempt:", { password: req.body.password })',
      good: 'logger.info("login attempt:", { userId: req.body.userId, ip: req.ip })'
    },
  },
  'SEC-010': {
    category: 'SEC',
    title: '安全敏感的随机值不应使用 Math.random',
    description: '生成 token、密码、密钥等安全敏感的随机值时不应使用 Math.random()。',
    severity: 'warn',
    automation: 'auto',
    why: 'Math.random() 是伪随机数生成器，输出可预测，不能用于安全敏感场景。',
    fix: '使用 crypto.randomBytes() 或 crypto.getRandomValues() 等加密安全的随机数生成器。',
    examples: {
      bad: 'const token = Math.random().toString(36).slice(2);',
      good: 'const token = crypto.randomBytes(32).toString("hex");'
    },
  },
  'SEC-011': {
    category: 'SEC',
    title: '正则表达式可能存在 ReDoS 风险',
    description: '包含嵌套量词或回溯结构的正则表达式可能被利用进行正则表达式拒绝服务攻击。',
    severity: 'warn',
    automation: 'auto',
    why: '攻击者可构造特定输入触发正则表达式的指数级回溯，导致 CPU 占满、服务不可用。',
    fix: '避免嵌套量词和回溯，使用更严格的匹配模式，或设置正则匹配超时。',
    examples: {
      bad: '/(a+)+$/.test("aaaaaaaaaaaaaaaaaaaaaaaa!")',
      good: '使用更精确的匹配模式，避免 .* 嵌套和回溯'
    },
  },
  'SEC-012': {
    category: 'SEC',
    title: '不安全的 HTTP 头配置',
    description: '应配置安全相关的 HTTP 响应头，如 X-Frame-Options、X-Content-Type-Options 等。',
    severity: 'info',
    automation: 'manual',
    why: '缺少安全头可能导致点击劫持、MIME 类型嗅探等安全问题。',
    fix: '使用 helmet 等中间件配置安全响应头，包括 X-Frame-Options、X-Content-Type-Options、HSTS 等。',
    examples: {
      bad: '应用没有设置任何安全相关的响应头',
      good: '使用 helmet() 中间件配置完整的安全响应头'
    },
  },
  'SEC-013': {
    category: 'SEC',
    title: '重定向 URL 来自用户输入且未验证',
    description: '重定向目标 URL 来自用户输入且未验证白名单，存在开放重定向风险。',
    severity: 'error',
    automation: 'auto',
    why: '开放重定向可被用于钓鱼攻击，诱导用户跳转到恶意网站，窃取凭证。',
    fix: '验证重定向 URL 在白名单内，或限制为相对路径，禁止跳转到外部域名。',
    examples: {
      bad: 'res.redirect(req.query.next)',
      good: 'if (isValidRedirectUrl(req.query.next)) res.redirect(req.query.next);'
    },
  },
  'SEC-014': {
    category: 'SEC',
    title: '反序列化不受信任的数据',
    description: '反序列化来自不受信任源的数据可能导致安全问题，应进行验证和限制。',
    severity: 'warn',
    automation: 'auto',
    why: '不安全的反序列化可能导致远程代码执行或数据篡改，特别是针对复杂的序列化格式。',
    fix: '对反序列化的输入进行 schema 验证和大小限制，避免反序列化不受信任的数据。',
    examples: {
      bad: 'const obj = JSON.parse(base64Decode(userInput));',
      good: 'const obj = safeSchema.parse(JSON.parse(userInput)); // 带 schema 验证'
    },
  },
  'SEC-015': {
    category: 'SEC',
    title: '新增依赖建议进行安全审计',
    description: '新增项目依赖时建议运行安全审计，检查是否存在已知漏洞。',
    severity: 'info',
    automation: 'auto',
    why: '依赖链中可能存在已知安全漏洞，引入有漏洞的依赖会导致应用受到攻击。',
    fix: '运行 npm audit 或使用 snyk/dependabot 扫描依赖安全，及时修复高危漏洞。',
    examples: {
      bad: '直接添加新依赖不做安全检查',
      good: '添加依赖后运行 npm audit，确认无高危漏洞'
    },
  },

  // ---- PERF: 性能 (10 条) ----
  'PERF-001': {
    category: 'PERF',
    title: '请求处理路径中不应使用同步 I/O',
    description: '在请求处理函数中使用同步 I/O 会阻塞事件循环，降低并发处理能力。',
    severity: 'warn',
    automation: 'auto',
    why: 'Node.js 是单线程事件循环模型，同步 I/O 会阻塞所有请求处理，吞吐量急剧下降。',
    fix: '使用异步 I/O（fs.promises、异步 API）避免阻塞事件循环，同步操作只在启动阶段使用。',
    examples: {
      bad: 'app.get("/data", (req, res) => { const data = fs.readFileSync("file.json"); res.json(data); })',
      good: 'app.get("/data", async (req, res) => { const data = await fs.readFile("file.json"); res.json(data); })'
    },
  },
  'PERF-002': {
    category: 'PERF',
    title: '返回全量列表且没有分页限制',
    description: '列表查询接口没有分页限制，可能返回大量数据导致性能问题。',
    severity: 'warn',
    automation: 'auto',
    why: '全量列表在数据量大时响应慢、内存占用高，可能导致 OOM 或网络超时。',
    fix: '添加分页参数（page/pageSize 或 cursor/limit），设置合理的默认值和最大值限制。',
    examples: {
      bad: 'async function getAllUsers() { return db.query("SELECT * FROM users"); }',
      good: 'async function getUsers(page, pageSize) { return db.query("SELECT * FROM users LIMIT ? OFFSET ?", [pageSize, (page-1)*pageSize]); }'
    },
  },
  'PERF-003': {
    category: 'PERF',
    title: '循环中执行数据库查询存在 N+1 问题',
    description: '在循环中执行数据库查询是典型的 N+1 问题，应使用批量查询代替。',
    severity: 'warn',
    automation: 'auto',
    why: 'N+1 查询会导致数据库访问次数随数据量线性增长，严重影响性能和数据库负载。',
    fix: '使用批量查询（IN 查询）或 JOIN 代替循环中的逐个查询，利用 ORM 的 eager loading 功能。',
    examples: {
      bad: 'for (const user of users) { user.orders = await Order.findByUserId(user.id); }',
      good: 'const orders = await Order.findByUserIds(users.map(u => u.id)); // 一次查询'
    },
  },
  'PERF-004': {
    category: 'PERF',
    title: '高频读接口建议考虑添加缓存',
    description: '高频访问的读接口建议添加缓存，减少数据库压力，提高响应速度。',
    severity: 'info',
    automation: 'ai',
    why: '热点数据频繁从数据库读取会增加数据库压力，响应速度受限于数据库查询时间。',
    fix: '对热点数据使用 Redis/LRU 缓存，设置合理的过期时间和缓存更新策略。',
    examples: {
      bad: '每次请求都从数据库查询用户信息',
      good: '先查 Redis 缓存，未命中再查数据库并回写缓存'
    },
  },
  'PERF-005': {
    category: 'PERF',
    title: '不必要的深拷贝可能影响性能',
    description: '使用 JSON.parse(JSON.stringify()) 或类似方法进行深拷贝可能造成性能问题。',
    severity: 'warn',
    automation: 'auto',
    why: '深拷贝在大数据量时非常耗时，JSON 序列化/反序列化还会丢失函数、Date、undefined 等信息。',
    fix: '评估是否真的需要深拷贝，浅层拷贝（{...obj}、Object.assign）通常更快且足够。',
    examples: {
      bad: 'const copy = JSON.parse(JSON.stringify(bigObject));',
      good: 'const copy = { ...bigObject, nested: { ...bigObject.nested } }; // 按需浅拷贝'
    },
  },
  'PERF-006': {
    category: 'PERF',
    title: '文件上传没有大小限制',
    description: '文件上传功能没有大小限制，可能导致内存溢出或磁盘空间耗尽。',
    severity: 'warn',
    automation: 'auto',
    why: '无限制的文件上传可能被恶意利用，通过上传超大文件导致服务器内存溢出或磁盘占满。',
    fix: '设置合理的文件大小上限，使用流式上传避免内存中缓存整个文件。',
    examples: {
      bad: 'multer() 没有设置 limits',
      good: 'multer({ limits: { fileSize: 10 * 1024 * 1024 } }) // 限制 10MB'
    },
  },
  'PERF-007': {
    category: 'PERF',
    title: '大量贪婪匹配正则注意性能',
    description: '使用多个 .* 贪婪匹配的正则表达式可能影响性能，尤其是在处理长文本时。',
    severity: 'info',
    automation: 'auto',
    why: '贪婪匹配会导致大量回溯，在处理长文本时性能急剧下降，甚至触发 ReDoS。',
    fix: '尽量使用更具体的匹配模式代替 .*，使用非贪婪匹配或字符类缩小匹配范围。',
    examples: {
      bad: '/<div>.*<\\/div>/.test(longHtml)',
      good: '/<div>[^<]*<\\/div>/.test(longHtml) // 使用字符类代替 .*'
    },
  },
  'PERF-008': {
    category: 'PERF',
    title: '新增图片文件建议优化',
    description: '新增的图片文件应进行优化压缩，使用合适的格式减少加载时间。',
    severity: 'info',
    automation: 'auto',
    why: '未优化的大图会显著增加页面加载时间，影响用户体验和带宽成本。',
    fix: '使用 WebP/AVIF 等现代格式，压缩图片大小，考虑使用 CDN 和响应式图片。',
    examples: {
      bad: '直接使用 5MB 的 PNG 原图',
      good: '使用压缩后的 WebP 格式，提供多种尺寸的响应式图片'
    },
  },
  'PERF-009': {
    category: 'PERF',
    title: '大数据量 JSON 序列化注意性能',
    description: '对大量数据进行 JSON.stringify 序列化可能影响性能和响应时间。',
    severity: 'info',
    automation: 'auto',
    why: 'JSON.stringify 在处理大数组或大对象时耗时显著，且会占用大量内存。',
    fix: '考虑分页或流式响应，对不需要的字段进行裁剪，避免序列化整个大对象。',
    examples: {
      bad: 'res.json(thousandsOfRecords)',
      good: '使用分页返回，或使用流式 JSON 序列化'
    },
  },
  'PERF-010': {
    category: 'PERF',
    title: '事件监听器未清理可能导致内存泄漏',
    description: '组件/类中注册了事件监听器但没有在销毁时清理，可能导致内存泄漏。',
    severity: 'warn',
    automation: 'auto',
    why: '未清理的事件监听器会持有对象引用，阻止垃圾回收，长期运行会导致内存持续增长。',
    fix: '在组件卸载/对象销毁时移除事件监听器，清除定时器和订阅，使用 useEffect 的清理函数。',
    examples: {
      bad: 'useEffect(() => { window.addEventListener("resize", handler); }, [])',
      good: 'useEffect(() => { window.addEventListener("resize", handler); return () => window.removeEventListener("resize", handler); }, [])'
    },
  },

  // ---- MAINT: 可维护性 (12 条) ----
  'MAINT-001': {
    category: 'MAINT',
    title: '函数不应超过 80 行',
    description: '过长的函数难以理解和维护，应拆分为更小的、职责单一的函数。',
    severity: 'warn',
    automation: 'auto',
    why: '长函数通常承担多个职责，逻辑复杂，难以测试和修改，是 bug 的高发区域。',
    fix: '将长函数按职责拆分为多个小函数，每个函数只做一件事，使用语义化的函数名。',
    examples: {
      bad: '一个 200 行的函数同时处理数据获取、转换、验证和存储',
      good: '拆分为 fetchData → transformData → validateData → saveData 四个函数'
    },
  },
  'MAINT-002': {
    category: 'MAINT',
    title: '代码嵌套层级不应过深',
    description: '嵌套层级过深（超过 3 层）的代码难以阅读和理解，应降低嵌套深度。',
    severity: 'warn',
    automation: 'auto',
    why: '深层嵌套增加了代码的认知复杂度，开发者需要在脑中维护多层上下文，容易出错。',
    fix: '使用早返回（guard clause）、提取函数、策略模式等方式降低嵌套深度。',
    examples: {
      bad: '5 层 if-else 嵌套，需要滚动才能看到完整逻辑',
      good: '使用 guard clause 提前返回无效情况，主逻辑保持扁平'
    },
  },
  'MAINT-003': {
    category: 'MAINT',
    title: '避免使用魔法数字',
    description: '代码中不应出现未命名的数字常量，应提取为有意义的命名常量。',
    severity: 'warn',
    automation: 'auto',
    why: '魔法数字缺乏上下文含义，其他开发者无法理解其意义，修改时容易遗漏。',
    fix: '将数字提取为命名常量，使用大写和描述性名称，提高代码可读性和可维护性。',
    examples: {
      bad: 'if (age >= 18) { ... }',
      good: 'const ADULT_AGE = 18; if (age >= ADULT_AGE) { ... }'
    },
  },
  'MAINT-004': {
    category: 'MAINT',
    title: '生产代码中不应有 console.log',
    description: '生产代码中不应包含用于调试的 console.log 语句，应使用适当的日志库。',
    severity: 'error',
    automation: 'auto',
    why: 'console.log 输出不受日志级别控制，可能泄露敏感信息，且影响性能和日志整洁性。',
    fix: '使用适当的日志库（winston/pino 等），按级别输出日志，或在提交前移除调试日志。',
    examples: {
      bad: 'console.log("debug:", user);',
      good: 'logger.debug("user login attempt", { userId: user.id });'
    },
  },
  'MAINT-005': {
    category: 'MAINT',
    title: '检测到重复代码',
    description: '代码中存在多处重复的逻辑块，应提取为公共函数或组件。',
    severity: 'warn',
    automation: 'auto',
    why: '重复代码意味着修改时需要同步修改多处，容易遗漏导致不一致 bug，维护成本翻倍。',
    fix: '提取公共逻辑为函数或组件，遵循 DRY 原则，一处修改处处生效。',
    examples: {
      bad: '三个文件中都有几乎相同的日期格式化代码',
      good: '提取 formatDate() 工具函数，所有地方统一调用'
    },
  },
  'MAINT-006': {
    category: 'MAINT',
    title: '单文件行数过多',
    description: '单个文件行数超过 300 行建议拆分，按职责划分为多个模块。',
    severity: 'warn',
    automation: 'auto',
    why: '过大的文件难以导航和理解，通常意味着承担了过多职责，修改时容易产生冲突。',
    fix: '按职责拆分为多个模块/组件，每个文件专注于一个功能领域，保持文件大小在合理范围。',
    examples: {
      bad: '一个 800 行的文件包含组件、工具函数、常量定义',
      good: '拆分为 Component.tsx + utils.ts + constants.ts 三个文件'
    },
  },
  'MAINT-007': {
    category: 'MAINT',
    title: '函数参数过多',
    description: '函数参数超过 5 个时建议使用配置对象（options object）代替。',
    severity: 'warn',
    automation: 'auto',
    why: '多个参数的调用可读性差，参数顺序容易搞错，新增参数时需要修改所有调用方。',
    fix: '使用配置对象代替位置参数，调用时通过命名参数传递，提高可读性和可扩展性。',
    examples: {
      bad: 'createUser(name, email, age, address, phone, role)',
      good: 'createUser({ name, email, age, address, phone, role })'
    },
  },
  'MAINT-008': {
    category: 'MAINT',
    title: '可能存在循环依赖',
    description: '检测到模块间可能存在循环依赖（互相 import），应检查并解耦。',
    severity: 'warn',
    automation: 'auto',
    why: '循环依赖会导致模块加载顺序问题、难以测试、重构困难，是代码耦合的典型信号。',
    fix: '提取公共依赖到第三个模块，或使用依赖注入、事件驱动等方式解耦模块关系。',
    examples: {
      bad: 'A 导入 B，B 又导入 A',
      good: '提取公共逻辑到 C，A 和 B 都导入 C'
    },
  },
  'MAINT-009': {
    category: 'MAINT',
    title: '存在大段注释掉的代码',
    description: '代码中包含大段被注释掉的代码，应删除而不是注释掉。',
    severity: 'warn',
    automation: 'auto',
    why: '注释掉的代码干扰阅读，没人敢删，长期堆积变成垃圾代码，增加维护负担。',
    fix: '删除注释掉的代码，版本控制系统（Git）会保留历史记录，需要时可以找回。',
    examples: {
      bad: '文件中有 50 行被 /* */ 注释掉的旧代码',
      good: '删除不需要的代码，通过 Git 历史记录管理代码版本'
    },
  },
  'MAINT-010': {
    category: 'MAINT',
    title: 'import 语句顺序不规范',
    description: 'import 语句应按约定的顺序组织，提高代码可读性和一致性。',
    severity: 'info',
    automation: 'auto',
    why: '混乱的 import 顺序影响代码整洁度，不同开发者的习惯不同会导致频繁的格式变更。',
    fix: '按 第三方库 → 内部模块 → 相对路径 的顺序组织 import，使用 ESLint import/order 规则自动校验。',
    examples: {
      bad: '第三方库和本地相对路径 import 混排交错',
      good: '先 import 第三方库，再 import 内部绝对路径模块，最后 import 相对路径模块'
    },
  },
  'MAINT-011': {
    category: 'MAINT',
    title: '导出的函数/变量可能未使用',
    description: '导出了较多的函数或变量，建议确认是否都被外部使用，避免导出冗余。',
    severity: 'info',
    automation: 'ai',
    why: '未使用的导出增加了模块的公共表面积，使重构更困难，也误导使用者。',
    fix: '删除未使用的 export，只导出真正需要被外部使用的 API，内部使用的保持私有。',
    examples: {
      bad: '模块导出了 10 个函数，但实际只有 2 个被外部使用',
      good: '只导出公共 API，内部辅助函数不导出'
    },
  },
  'MAINT-012': {
    category: 'MAINT',
    title: 'TypeScript 类型断言滥用',
    description: '代码中使用了过多的 as 类型断言，可能绕过类型检查，降低类型安全性。',
    severity: 'warn',
    automation: 'auto',
    why: '滥用类型断言相当于告诉编译器"别检查了，我知道得更多"，会隐藏真正的类型错误。',
    fix: '优先使用类型守卫（type guard）、泛型、正确的类型定义，避免频繁使用 as 断言。',
    examples: {
      bad: 'const user = data as User; // 不确定 data 是否真的是 User 类型',
      good: 'const user = userSchema.parse(data); // 使用 zod 运行时验证并推断类型'
    },
  },

  // ---- TEST: 测试 (10 条) ----
  'TEST-001': {
    category: 'TEST',
    title: '新文件没有对应测试文件',
    description: '新增源文件时应同步添加对应的测试文件，确保代码有测试覆盖。',
    severity: 'warn',
    automation: 'auto',
    why: '没有测试的代码无法保证正确性，后续重构风险高，bug 发现晚。',
    fix: '为新代码添加单元测试，测试文件命名为 *.test.ts 或 *.spec.ts，放在同目录或 __tests__ 目录。',
    examples: {
      bad: '新增 src/utils/format.ts 但没有 format.test.ts',
      good: '新增 src/utils/format.ts 同时新增 src/utils/__tests__/format.test.ts'
    },
  },
  'TEST-002': {
    category: 'TEST',
    title: '测试文件中没有实际的测试用例',
    description: '测试文件存在但没有包含 it/test 测试用例，相当于空测试。',
    severity: 'warn',
    automation: 'auto',
    why: '空测试文件给人一种"有测试覆盖"的错觉，实际上没有任何验证作用。',
    fix: '添加真正的测试用例，每个测试验证一个具体的行为或场景。',
    examples: {
      bad: '测试文件只有 describe 块，里面没有 it/test 用例',
      good: '测试文件包含多个 it/test 用例，每个都有明确的断言'
    },
  },
  'TEST-003': {
    category: 'TEST',
    title: '测试主要覆盖 happy path，缺少异常场景',
    description: '测试用例主要覆盖正常路径，缺少错误处理、边界条件等异常场景的测试。',
    severity: 'warn',
    automation: 'auto',
    why: '只测试正常路径会导致异常情况没有被验证，生产环境中遇到异常时容易出 bug。',
    fix: '添加错误处理、边界条件、非法输入等场景的测试用例，确保异常情况也能正确处理。',
    examples: {
      bad: '只测试了输入有效数据的情况',
      good: '同时测试了正常输入、空输入、非法输入、边界值等多种场景'
    },
  },
  'TEST-004': {
    category: 'TEST',
    title: '测试用例命名不规范',
    description: '测试用例的 describe/it 描述应清晰表达测试意图，使用规范的命名方式。',
    severity: 'warn',
    automation: 'auto',
    why: '模糊的测试名称在测试失败时无法快速理解问题所在，增加调试时间。',
    fix: '使用描述性的测试名称，遵循 "should + 行为 + 条件" 的格式，如 "should return 404 when user not found"。',
    examples: {
      bad: "it('test1', () => { ... })",
      good: "it('should throw error when input is empty string', () => { ... })"
    },
  },
  'TEST-005': {
    category: 'TEST',
    title: '测试中使用了 .only 或 .skip',
    description: '测试代码中不应提交 .only 或 .skip，这会跳过或只运行特定测试。',
    severity: 'error',
    automation: 'auto',
    why: '.only 会导致其他测试都不运行，给人全绿的假象；.skip 会永久跳过测试，掩盖问题。',
    fix: '删除 .only 和 .skip，确保所有测试都正常运行。如果测试暂时不可用，创建 issue 跟踪。',
    examples: {
      bad: "it.only('should work', () => { ... }) // 只运行这一个测试",
      good: "it('should work', () => { ... }) // 所有测试正常运行"
    },
  },
  'TEST-006': {
    category: 'TEST',
    title: '测试用 console.log 而非断言',
    description: '测试中使用 console.log 输出结果来人工判断，而不是用断言自动验证。',
    severity: 'warn',
    automation: 'auto',
    why: '靠人眼查看 console.log 输出不是自动化测试，无法在 CI 中自动验证，容易漏过问题。',
    fix: '使用 expect/assert 等断言函数进行自动化验证，确保测试可以自动判断通过与否。',
    examples: {
      bad: "it('test', () => { console.log(add(1, 2)); }) // 靠人眼看输出",
      good: "it('should add two numbers', () => { expect(add(1, 2)).toBe(3); })"
    },
  },
  'TEST-007': {
    category: 'TEST',
    title: '快照测试过大',
    description: '快照测试的快照文件过大（超过 100 行），建议拆分为更小的快照或避免快照。',
    severity: 'warn',
    automation: 'auto',
    why: '大快照难以审查，微小的改动就会导致快照更新失败，失去了快照测试的意义。',
    fix: '拆分为更小的组件快照，或改用针对性的断言代替大快照测试。',
    examples: {
      bad: '一个快照有 500 行输出，审查时根本看不过来',
      good: '对关键部分使用断言，快照只测试小而稳定的输出'
    },
  },
  'TEST-008': {
    category: 'TEST',
    title: '缺少错误分支测试',
    description: '代码中有错误处理逻辑但缺少对应的测试用例，错误路径未被验证。',
    severity: 'warn',
    automation: 'ai',
    why: '错误处理路径是 bug 高发区域，没有测试验证的话，错误处理本身可能就是错的。',
    fix: '为每个错误处理分支添加测试，验证错误被正确抛出、正确格式、正确消息。',
    examples: {
      bad: '函数有 try-catch 但只测试了正常情况',
      good: '测试了正常返回、抛出错误类型、错误消息内容等'
    },
  },
  'TEST-009': {
    category: 'TEST',
    title: '测试文件和源文件不在对应目录',
    description: '测试文件应与源文件放在对应的目录结构中，便于查找和维护。',
    severity: 'info',
    automation: 'auto',
    why: '测试文件乱放会导致难以找到对应的测试，新增功能时不知道测试该放哪里。',
    fix: '保持测试文件与源文件同目录（或 __tests__ 子目录），目录结构一一对应。',
    examples: {
      bad: 'src/utils/format.ts 的测试放在 test/format.test.ts（根目录测试文件夹）',
      good: 'src/utils/format.ts 的测试放在 src/utils/__tests__/format.test.ts'
    },
  },
  'TEST-010': {
    category: 'TEST',
    title: '集成测试缺少 mock',
    description: '集成/API 测试中直接调用了外部服务但没有 mock，测试不稳定且慢。',
    severity: 'error',
    automation: 'auto',
    why: '依赖真实外部服务的测试会受网络、第三方服务状态影响，不稳定且速度慢。',
    fix: '使用 mock 代替真实 API 调用，测试只验证业务逻辑，提高测试速度和稳定性。',
    examples: {
      bad: '测试中直接调用真实的第三方支付 API',
      good: '使用 jest.mock 或 MSW mock 掉外部 API 调用'
    },
  },

  // ---- PATTERN: 代码规范一致性 (8 条) ----
  'PATTERN-001': {
    category: 'PATTERN',
    title: '命名不符合约定',
    description: '变量、函数、常量、类等命名应遵循约定的规范（驼峰、帕斯卡、全大写等）。',
    severity: 'warn',
    automation: 'auto',
    why: '命名不统一降低代码可读性，不同风格混用让人困惑，增加理解成本。',
    fix: '遵循项目命名规范：类/组件用 PascalCase，函数/变量用 camelCase，常量用 UPPER_SNAKE_CASE。',
    examples: {
      bad: 'const user_name = "Tom"; // 蛇形命名混用',
      good: 'const userName = "Tom"; // 统一驼峰命名'
    },
  },
  'PATTERN-002': {
    category: 'PATTERN',
    title: '应使用 let/const 而非 var',
    description: '现代 JavaScript/TypeScript 代码应使用 let 和 const 代替 var，避免变量提升问题。',
    severity: 'warn',
    automation: 'auto',
    why: 'var 存在变量提升、函数级作用域等问题，容易产生意外的 bug，已被现代 JS 弃用。',
    fix: '使用 const（默认）和 let（需要重新赋值时）代替 var，利用块级作用域减少错误。',
    examples: {
      bad: 'var count = 0;',
      good: 'const count = 0;'
    },
  },
  'PATTERN-003': {
    category: 'PATTERN',
    title: '避免嵌套三元表达式',
    description: '嵌套的三元表达式（ternary）难以阅读，应使用 if-else 或提取为函数。',
    severity: 'warn',
    automation: 'auto',
    why: '嵌套三元表达式可读性差，容易出错，特别是条件复杂时几乎无法理解。',
    fix: '使用 if-else 语句或提取为命名函数，让逻辑更清晰。',
    examples: {
      bad: 'const result = a ? b ? c : d : e ? f : g;',
      good: '使用 if-else 或提取为 getResult() 函数，明确各分支逻辑'
    },
  },
  'PATTERN-004': {
    category: 'PATTERN',
    title: '避免空 catch 块',
    description: '空的 catch 块会静默吞掉异常，应至少记录日志或重新抛出。',
    severity: 'error',
    automation: 'auto',
    why: '空 catch 隐藏了错误，使问题难以排查，违反 fail-fast 原则，可能导致更严重的后果。',
    fix: '至少在 catch 中记录错误日志，或重新抛出更有语义的异常，不要让错误悄无声息。',
    examples: {
      bad: 'try { ... } catch (e) {}',
      good: 'try { ... } catch (e) { logger.error("operation failed", e); throw e; }'
    },
  },
  'PATTERN-005': {
    category: 'PATTERN',
    title: '使用提前返回代替不必要的 else',
    description: 'if 块中已有 return/throw 时，后续代码不需要 else 包裹，减少嵌套。',
    severity: 'info',
    automation: 'auto',
    why: '不必要的 else 增加了嵌套层级，使代码变长，可读性降低。',
    fix: '使用 guard clause（守卫子句）提前返回，主逻辑保持扁平，减少 else 嵌套。',
    examples: {
      bad: 'if (!user) { return null; } else { return user.name; }',
      good: 'if (!user) return null; return user.name;'
    },
  },
  'PATTERN-006': {
    category: 'PATTERN',
    title: 'if 条件过长（多个 && / ||）',
    description: 'if 语句的条件表达式包含过多的逻辑运算符，应提取为命名变量或函数。',
    severity: 'warn',
    automation: 'auto',
    why: '长条件表达式难以阅读和理解，容易漏掉某个条件，修改时容易出错。',
    fix: '将复杂条件提取为语义化的布尔变量或函数，提高可读性。',
    examples: {
      bad: 'if (user && user.isActive && user.role === "admin" && hasPermission && !isSuspended) { ... }',
      good: 'const canAccess = user?.isActive && user?.role === "admin" && hasPermission && !isSuspended; if (canAccess) { ... }'
    },
  },
  'PATTERN-007': {
    category: 'PATTERN',
    title: '避免魔法数字',
    description: '代码中直接使用未命名的数字（除 0/1/-1 等通用值外），应提取为常量。',
    severity: 'warn',
    automation: 'auto',
    why: '魔法数字没有语义，其他开发者不知道数字代表什么含义，修改时容易遗漏。',
    fix: '将有业务含义的数字提取为命名常量，使用描述性名称。',
    examples: {
      bad: 'if (status === 2) { ... }',
      good: 'const STATUS_COMPLETED = 2; if (status === STATUS_COMPLETED) { ... }'
    },
  },
  'PATTERN-008': {
    category: 'PATTERN',
    title: '函数副作用不明显（修改参数）',
    description: '函数直接修改传入的参数对象，产生不明显的副作用，容易导致意外的 bug。',
    severity: 'warn',
    automation: 'auto',
    why: '修改参数的副作用是隐蔽的，调用方可能没有意识到对象被改变，导致难以追踪的 bug。',
    fix: '避免修改参数对象，返回新的对象或值。如果确实需要修改，在函数名中明确体现。',
    examples: {
      bad: 'function updateUser(user) { user.name = "new"; } // 直接修改参数',
      good: 'function updateUser(user) { return { ...user, name: "new" }; } // 返回新对象'
    },
  },
};

// ============================================================
// 规则引擎核心
// ============================================================

/**
 * 执行规则检查
 * @param {Object} ctx - 上下文 { diff, files, fileContents, projectRoot, patterns }
 * @param {string[]} categories - 要检查的类别
 * @returns {Promise<Array>} 问题列表
 */
// ============================================================
// AST 分析层（基于 parse5/csstree/recast）
// 对 JS/TS 文件提供比正则更精确的代码结构分析
// ============================================================

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function isJSFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return JS_EXTENSIONS.has(ext);
}

/**
 * 基于 AST 的代码审查分析
 * 比正则更精确，误报率更低
 */
async function runASTAnalysis(ctx) {
  const { files = [], fileContents = {} } = ctx;
  const issues = [];

  for (const filePath of files) {
    if (!isJSFile(filePath)) continue;

    const content = fileContents[filePath];
    if (!content) continue;

    // 解析失败时静默跳过（回退到正则检查）
    const parsed = ast.parseJS(content);
    if (!parsed) continue;

    // ---- SEC-001: 硬编码密钥/密码（AST 精确检测）----
    const secrets = ast.detectHardcodedSecrets(content);
    for (const s of secrets) {
      issues.push(issue('SEC-001', 'critical',
        `检测到硬编码密钥/凭证: ${s.key}`,
        '立即移除硬编码密钥，使用环境变量或密钥管理服务',
        filePath, s.line));
    }

    // ---- SEC-003: XSS 风险（AST 精确检测 innerHTML 赋值）----
    const xssRisks = ast.detectXSSRisks(content);
    for (const x of xssRisks) {
      issues.push(issue('SEC-003', 'error',
        `检测到危险的 HTML 注入操作: ${x.property}，存在 XSS 风险`,
        '使用安全的文本渲染方式，或对输入进行严格的 HTML 转义/净化',
        filePath, x.line));
    }

    // ---- SEC-004: eval / Function 构造器（AST 精确检测）----
    const evalUsages = ast.detectEvalUsage(content);
    for (const e of evalUsages) {
      issues.push(issue('SEC-004', 'critical',
        `使用 eval() 存在代码注入风险 (arg: ${e.arg.slice(0, 30)})`,
        '避免使用 eval，改用更安全的替代方案',
        filePath, e.line));
    }

    // ---- PERF-001: 阻塞同步 I/O（AST 精确检测）----
    const syncIo = ast.detectSyncIO(content);
    if (syncIo.length > 0) {
      // 检查是否在请求处理函数中
      const fns = ast.extractFunctions(content);
      const inHandler = fns.some(f => /handler|controller|middleware|route/i.test(f.name));
      if (inHandler || syncIo.length >= 3) {
        issues.push(issue('PERF-001', 'warn',
          `使用了 ${syncIo.length} 个同步 I/O 调用: ${syncIo.slice(0, 3).map(s => s.method).join(', ')}${syncIo.length > 3 ? '...' : ''}`,
          '使用异步 I/O 避免阻塞事件循环',
          filePath, syncIo[0].line));
      }
    }

    // ---- PATTERN-004: 空 catch 块（AST 精确检测）----
    const emptyCatches = ast.detectEmptyCatches(content);
    for (const c of emptyCatches) {
      issues.push(issue('PATTERN-004', 'error',
        '空 catch 块会吞掉异常，难以排查问题',
        '至少添加日志记录或错误处理逻辑',
        filePath, c.line));
    }

    // ---- MAINT 补充: console.log 残留（AST 精确检测）----
    const consoleLogs = ast.detectConsoleLogs(content);
    // 只在超过 3 个 console 且没有 logger 模式时告警
    if (consoleLogs.length >= 3 && !/winston|pino|bunyan|logger/i.test(content)) {
      issues.push(issue('MAINT-005', 'warn',
        `代码中存在 ${consoleLogs.length} 处 console 调用，建议使用结构化日志库`,
        '使用 winston/pino/bunyan 等日志库替代 console',
        filePath, consoleLogs[0].line));
    }

    // ---- TEST 补充: 未使用的 import（AST 精确检测）----
    const unusedImports = ast.detectUnusedImports(content);
    if (unusedImports.length > 0 && unusedImports.length <= 5) {
      issues.push(issue('TEST-008', 'info',
        `检测到 ${unusedImports.length} 个未使用的 import: ${unusedImports.map(i => i.name).join(', ')}`,
        '清理未使用的导入，保持代码整洁',
        filePath, unusedImports[0].line));
    }
  }

  // 去重：同文件同规则只保留第一个（正则可能也会检出相同问题）
  const seen = new Set();
  return issues.filter(i => {
    const key = `${i.file}:${i.id}:${i.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runRules(ctx, categories) {
  const issues = [];

  const checks = {
    BIZ:      checkBusinessRules,
    CONTRACT: checkContractRules,
    SEC:      checkSecurityRules,
    PERF:     checkPerformanceRules,
    MAINT:    checkMaintainabilityRules,
    TEST:     checkTestingRules,
    PATTERN:  checkPatternRules,
  };

  for (const cat of categories) {
    if (checks[cat]) {
      const catIssues = await checks[cat](ctx);
      issues.push(...catIssues.map(i => ({ ...i, category: cat })));
    }
  }

  // AST 增强分析（对 JS/TS 文件提供更精确的检测）
  const astIssues = await runASTAnalysis(ctx);
  for (const ai of astIssues) {
    const cat = RULE_DEFS[ai.id]?.category || 'MAINT';
    if (categories.includes(cat)) {
      issues.push({ ...ai, category: cat });
    }
  }

  return issues;
}

function issue(id, severity, message, suggestion = '', file = '', line = null) {
  return { id, severity, message, suggestion, file, line };
}

// ============================================================
// BIZ - 业务正确性（8 条）
// ============================================================

async function checkBusinessRules(ctx) {
  const { diff, files, fileContents = {} } = ctx;
  const issues = [];
  const addedLines = getAddedLines(diff);
  const sourceFiles = files.filter(f => /\.(ts|tsx|js|jsx|py|go|java)$/.test(f) && !/\.(test|spec)\./.test(f));
  const testFiles = files.filter(f => /\.(test|spec)\./.test(f));

  // BIZ-001: 新增/修改业务代码应有对应的 spec 更新
  const specFiles = files.filter(f => /spec\.md|README|docs\//i.test(f));
  if (sourceFiles.length > 0 && specFiles.length === 0 && addedLines.length > 20) {
    issues.push(issue('BIZ-001', 'warn',
      '新增/修改了较多业务代码但没有更新 spec.md 或文档',
      '如果涉及业务逻辑变更，请同步更新 spec.md 或相关文档'));
  }

  // BIZ-002: 新增源文件应有对应测试
  if (sourceFiles.length > 0 && testFiles.length === 0) {
    issues.push(issue('BIZ-002', 'error',
      `新增了 ${sourceFiles.length} 个源文件但没有对应的测试文件`,
      '为每个新模块添加单元测试，命名为 *.test.ts 或 *.spec.ts'));
  }

  // BIZ-003: TODO/FIXME 不应留到生产
  const todoCount = (diff.match(/\+\s*(\/\/|#)\s*(TODO|FIXME|HACK)/g) || []).length;
  if (todoCount > 3) {
    issues.push(issue('BIZ-003', 'warn',
      `新增了 ${todoCount} 个 TODO/FIXME/HACK 注释`,
      '在合并前清理临时注释，或创建 issue 跟踪'));
  }

  // BIZ-004: 错误处理不应吞掉异常
  const emptyCatch = (diff.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || []).length;
  if (emptyCatch > 0) {
    issues.push(issue('BIZ-004', 'error',
      `发现 ${emptyCatch} 个空的 catch 块（吞掉异常）`,
      '至少记录错误日志，不要静默失败'));
  }

  // BIZ-005: 关键路径应有日志
  const hasAuthOrPayment = /auth|login|payment|transaction|transfer/i.test(diff);
  const hasLogging = /logger|console\.(log|error|warn)|winston|pino/i.test(diff);
  if (hasAuthOrPayment && !hasLogging && /function|export|class/.test(diff)) {
    issues.push(issue('BIZ-005', 'warn',
      '涉及认证/支付等关键路径但缺少日志记录',
      '在关键操作路径添加审计日志'));
  }

  // BIZ-006: 输入验证
  const hasNewFunction = /\+\s*(export\s+)?(async\s+)?function|\+\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(diff);
  const hasValidation = /zod|yup|joi|validate|checkSchema|assert/.test(diff);
  if (hasNewFunction && !hasValidation && /params|input|body|query/.test(diff)) {
    issues.push(issue('BIZ-006', 'warn',
      '新函数处理用户输入但缺少输入验证',
      '使用 zod/yup/joi 等库验证输入参数'));
  }

  // BIZ-007: 删除代码应确认无引用
  const deletedLines = getDeletedLines(diff);
  if (deletedLines.length > 50 && sourceFiles.length > 0) {
    issues.push(issue('BIZ-007', 'warn',
      `删除了 ${deletedLines.length} 行代码，请确认没有其他地方引用`,
      '全局搜索被删除的函数/变量名，确认无引用后再删除'));
  }

  // BIZ-008: 数据库变更应有 migration
  const hasSchemaChange = /schema|model|entity|table|CREATE TABLE|ALTER TABLE/i.test(diff);
  const hasMigration = files.some(f => /migration|migrations/i.test(f));
  if (hasSchemaChange && !hasMigration) {
    issues.push(issue('BIZ-008', 'error',
      '数据模型变更但缺少数据库 migration 文件',
      '创建对应的 migration 文件来同步数据库 schema'));
  }

  return issues;
}

// ============================================================
// CONTRACT - 契约一致性（10 条）
// ============================================================

async function checkContractRules(ctx) {
  const { diff, files, projectRoot } = ctx;
  const issues = [];

  // CONTRACT-001: API 变更应有 OpenAPI 更新
  const hasApiCode = /router\.(get|post|put|delete|patch)|app\.(get|post)|@(Get|Post|Put|Delete|Patch)Mapping|fastify\.(get|post)/.test(diff);
  const hasOpenApi = files.some(f => /openapi|swagger|api\.yaml|api\.json/i.test(f));
  if (hasApiCode && !hasOpenApi) {
    issues.push(issue('CONTRACT-001', 'warn',
      'API 路由变更但没有更新 OpenAPI/Swagger 文档',
      '同步更新 contracts/openapi.yaml 或相应的 API 文档'));
  }

  // CONTRACT-002: 响应格式一致性
  const resJsonMatch = diff.match(/res\.json\(|\.send\(/g);
  if (resJsonMatch && resJsonMatch.length > 2) {
    const hasUnifiedFormat = /\{.*code.*data.*\}|ApiResponse|Result\.success|Result\.error/.test(diff);
    if (!hasUnifiedFormat) {
      issues.push(issue('CONTRACT-002', 'warn',
        '多个 API 响应但格式不统一',
        '使用统一的响应格式，如 { code, data, message }'));
    }
  }

  // CONTRACT-003: 错误响应使用 RFC 9457 Problem+JSON
  if (/res\.status\(\d+\)\.(json|send)\(/.test(diff)) {
    const errorStatus = diff.match(/res\.status\((4|5)\d{2}\)/g);
    if (errorStatus && !/type:|title:|detail:|status:|instance:/.test(diff)) {
      issues.push(issue('CONTRACT-003', 'warn',
        '错误响应建议使用 RFC 9457 Problem+JSON 格式',
        '错误响应包含 type/title/detail/status/instance 字段'));
    }
  }

  // CONTRACT-004: 所有响应包含 traceId
  if (/res\.(json|send)|ResponseEntity|@ResponseBody/.test(diff)) {
    if (!/traceId|requestId|x-trace-id/i.test(diff)) {
      issues.push(issue('CONTRACT-004', 'info',
        '建议在响应中包含 traceId 便于分布式追踪',
        '在响应头或响应体中添加 traceId'));
    }
  }

  // CONTRACT-005: 分页参数一致性
  if (/page|PageSize|limit|offset/i.test(diff)) {
    const hasBoth = /(page|PageSize)/i.test(diff) && /(limit|offset|pageSize|page_size)/i.test(diff);
    if (!hasBoth) {
      issues.push(issue('CONTRACT-005', 'warn',
        '分页接口参数不完整',
        '分页接口应同时包含页码（page）和每页数量（pageSize）'));
    }
  }

  // CONTRACT-006: API 版本号
  if (/router\.(get|post|put|delete)|app\.use\('/.test(diff) && !/\/api\/v\d+/.test(diff)) {
    const apiCount = (diff.match(/\/api\//g) || []).length;
    if (apiCount > 0) {
      issues.push(issue('CONTRACT-006', 'info',
        'API 路径建议使用版本号前缀',
        '使用 /api/v1/xxx 格式以便后续版本演进'));
    }
  }

  // CONTRACT-007: 日期时间格式
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(diff)) {
    if (!/Z$|\+\d{2}:\d{2}/.test(diff.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^\s"',}]*/g)?.[0] || '')) {
      issues.push(issue('CONTRACT-007', 'warn',
        '日期时间格式建议使用 ISO 8601 并带时区',
        '使用带 Z 或 +08:00 的完整 ISO 8601 格式'));
    }
  }

  // CONTRACT-008: 请求 ID 幂等性
  if (/post|create|POST/i.test(diff) && /order|payment|transaction/i.test(diff)) {
    if (!/idempotenc|requestId|request_id/i.test(diff)) {
      issues.push(issue('CONTRACT-008', 'warn',
        '涉及写操作的关键接口建议支持幂等性',
        '添加 Idempotency-Key 请求头或 requestId 参数'));
    }
  }

  // CONTRACT-009: 枚举值使用字符串而非数字
  if (/\benum\s+\w+\s*\{[^}]*\d+\s*=/.test(diff) || /\b(Status|Type|State)\s*[:=]\s*\d/.test(diff)) {
    issues.push(issue('CONTRACT-009', 'warn',
      '枚举/状态值建议使用字符串而非数字',
      '字符串值更具可读性，避免数字语义不明确的问题'));
  }

  // CONTRACT-010: 大响应支持分页
  const longListReturn = /return\s+(\w+\.)?(map|filter|find|list|all|query)/.test(diff);
  if (longListReturn && !/pagination|page|PageSize|limit|cursor/i.test(diff)) {
    // 启发式：如果返回列表且函数名包含 getAll/listAll 等
    if (/getAll|listAll|findAll|queryAll|searchAll/i.test(diff)) {
      issues.push(issue('CONTRACT-010', 'warn',
        '返回全量列表的接口建议支持分页',
        '添加分页参数，避免大数据量响应'));
    }
  }

  return issues;
}

// ============================================================
// SEC - 安全（15 条）
// ============================================================

async function checkSecurityRules(ctx) {
  const { diff, files } = ctx;
  const issues = [];

  // SEC-001: 硬编码密钥/密码
  const secretPatterns = [
    /(api[_-]?key|secret|password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{10,}['"]/gi,
    /(BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY)/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /sk-[a-zA-Z0-9]{20,}/,
    /ghp_[a-zA-Z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
  ];
  for (const pat of secretPatterns) {
    const m = diff.match(pat);
    if (m) {
      issues.push(issue('SEC-001', 'critical',
        `检测到硬编码密钥/凭证: ${m[0].slice(0, 30)}...`,
        '立即移除硬编码密钥，使用环境变量或密钥管理服务'));
      break;
    }
  }

  // SEC-002: SQL 注入风险
  const sqlInjectionPatterns = [
    /["']\s*\+\s*\w+\s*\+\s*["'][^"]*(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|WHERE)/i,
    /`.*\$\{.*\}.*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i,
    /execute\s*\(\s*["'][^"']*\s*\+/,
    /query\s*\(\s*`[^`]*\$\{/,
  ];
  for (const pat of sqlInjectionPatterns) {
    if (pat.test(diff)) {
      issues.push(issue('SEC-002', 'critical',
        '检测到 SQL 字符串拼接，存在 SQL 注入风险',
        '使用参数化查询（Prepared Statements）或 ORM'));
      break;
    }
  }

  // SEC-003: XSS 风险
  if (/dangerouslySetInnerHTML|innerHTML\s*=|document\.write\(/.test(diff)) {
    issues.push(issue('SEC-003', 'error',
      '检测到危险的 HTML 注入操作，存在 XSS 风险',
      '使用安全的文本渲染方式，或对输入进行严格的 HTML 转义/净化'));
  }

  // SEC-004: eval / Function 构造器
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(diff)) {
    issues.push(issue('SEC-004', 'critical',
      '使用 eval() 或 new Function() 存在代码注入风险',
      '避免使用 eval，改用更安全的替代方案'));
  }

  // SEC-005: 硬编码 CORS 通配符
  if (/origin:\s*['"]\*['"]|Access-Control-Allow-Origin.*\*/i.test(diff)) {
    issues.push(issue('SEC-005', 'error',
      'CORS 配置为通配符 *',
      '明确指定允许的 origin 列表，不要使用通配符'));
  }

  // SEC-006: 密码明文存储/传输
  if (/password.*\.(toString|toJSON|stringify)|password\s*:\s*\w+\s*,/.test(diff)) {
    if (!/bcrypt|scrypt|argon2|hash|sha256/i.test(diff)) {
      issues.push(issue('SEC-006', 'error',
        '密码处理缺少哈希加密',
        '使用 bcrypt/argon2/scrypt 等安全算法对密码进行哈希'));
    }
  }

  // SEC-007: 路径遍历
  if (/\.\.\/|path\.join.*req\.|fs\.(readFile|writeFile).*req\./.test(diff)) {
    if (!/normalize|resolve|sanitize/.test(diff)) {
      issues.push(issue('SEC-007', 'error',
        '文件路径操作可能存在路径遍历风险',
        '对用户输入的路径进行验证和净化，使用 path.resolve 后检查前缀'));
    }
  }

  // SEC-008: CSRF 防护
  if (/method.*post|method.*put|method.*delete/i.test(diff) && /form|cookie/i.test(diff)) {
    if (!/csrf|xsrf|token/i.test(diff)) {
      issues.push(issue('SEC-008', 'warn',
        '表单提交/状态变更操作建议添加 CSRF 防护',
        '使用 CSRF token 或 SameSite Cookie'));
    }
  }

  // SEC-009: 敏感信息日志泄露
  if (/console\.log.*password|logger\..*password|console\.log.*token|logger\..*secret/i.test(diff)) {
    issues.push(issue('SEC-009', 'error',
      '日志中可能输出了密码/token 等敏感信息',
      '记录日志前对敏感字段进行脱敏处理'));
  }

  // SEC-010: 不安全的随机数
  if (/Math\.random\(\)/.test(diff) && /token|password|secret|id|key/i.test(diff)) {
    issues.push(issue('SEC-010', 'warn',
      '使用 Math.random() 生成安全敏感的随机值',
      '使用 crypto.randomBytes() 或 crypto.getRandomValues()'));
  }

  // SEC-011: 正则表达式 DoS (ReDoS)
  const regexPatterns = diff.match(/new RegExp\(['"]([^'"]+)['"]|\/([^\/]+)\/[gimsuy]*\s*\.(test|match|exec)/g);
  if (regexPatterns && regexPatterns.length > 0) {
    for (const rp of regexPatterns) {
      if (/\.\*.*\.\*|\+.*\+|\(\w+\)\w+\1/.test(rp)) {
        issues.push(issue('SEC-011', 'warn',
          '正则表达式可能存在 ReDoS 风险',
          '避免嵌套量词和回溯，使用更严格的匹配模式'));
        break;
      }
    }
  }

  // SEC-012: 不安全的 HTTP 方法
  if (/app\.use\(.*methodOverride|app\.disable\('x-powered-by'\)/i.test(diff)) {
    // 正面模式，不告警
  }

  // SEC-013: 开放重定向
  if (/redirect\(|window\.location\.href\s*=/.test(diff) && /req\.(query|params|body)/.test(diff)) {
    if (!/validateUrl|isValidUrl|safeRedirect|whitelist/i.test(diff)) {
      issues.push(issue('SEC-013', 'error',
        '重定向 URL 来自用户输入且未验证，存在开放重定向风险',
        '验证重定向 URL 在白名单内，或限制为相对路径'));
    }
  }

  // SEC-014: 不安全的反序列化
  if (/JSON\.parse\(.*req\.|unserialize|deserialize/.test(diff) && /reviver/.test(diff) === false) {
    // JSON.parse 本身相对安全，但如果是不受信任的源需要注意
    if (/Buffer\.from|atob|base64.*json/i.test(diff)) {
      issues.push(issue('SEC-014', 'warn',
        '反序列化不受信任的数据可能导致安全问题',
        '对反序列化的输入进行验证和大小限制'));
    }
  }

  // SEC-015: 依赖安全
  if (files.some(f => f.endsWith('package.json') || f.endsWith('package-lock.json'))) {
    if (/dependencies/.test(diff) && !/npm audit|snyk|audit/i.test(diff)) {
      issues.push(issue('SEC-015', 'info',
        '新增了依赖，建议运行 npm audit 检查已知漏洞',
        '运行 npm audit 或使用 snyk 扫描依赖安全'));
    }
  }

  return issues;
}

// ============================================================
// PERF - 性能（10 条）
// ============================================================

async function checkPerformanceRules(ctx) {
  const { diff, files } = ctx;
  const issues = [];

  // PERF-001: 阻塞同步 I/O
  const syncIo = diff.match(/fs\.(readFileSync|writeFileSync|existsSync|statSync|readdirSync|mkdirSync)|child_process\.execSync/g);
  if (syncIo && syncIo.length > 0) {
    // 在模块顶层或构造函数中可以接受，但在请求处理函数中不行
    if (/router\.(get|post)|app\.(get|post)|handler|controller|async.*req/.test(diff)) {
      issues.push(issue('PERF-001', 'warn',
        `在请求处理路径中使用了 ${syncIo.length} 个同步 I/O 调用`,
        '使用异步 I/O 避免阻塞事件循环'));
    }
  }

  // PERF-002: 大列表无分页
  if (diff.match(/\.map\s*\(/) && /getAll|listAll|findAll|queryAll|search/i.test(diff)) {
    if (!/pagination|pageSize|limit|cursor|slice\(/i.test(diff)) {
      issues.push(issue('PERF-002', 'warn',
        '返回全量列表且没有分页限制',
        '添加分页参数，或使用游标分页'));
    }
  }

  // PERF-003: N+1 查询
  const loopDbCalls = (diff.match(/\.map\s*\(.*\=\>.*\.(find|findOne|query|get)\b/g) || []).length
    + (diff.match(/for(Each)?\s*\(.*\.(find|query|get)\b/g) || []).length;
  if (loopDbCalls > 0) {
    issues.push(issue('PERF-003', 'warn',
      `在循环中执行数据库查询，可能存在 N+1 问题`,
      '使用批量查询或 JOIN 代替循环查询'));
  }

  // PERF-004: 无缓存的热点数据
  if (/findById|getById|getUser|getProduct|fetchById/i.test(diff)) {
    if (!/cache|redis|memcached|lru|remember/i.test(diff)) {
      // 仅当看起来是高频访问的接口时告警
      if (/get|find|fetch/i.test(diff) && /router|controller|endpoint/i.test(diff)) {
        issues.push(issue('PERF-004', 'info',
          '高频读接口建议考虑添加缓存',
          '对热点数据使用 Redis/LRU 缓存'));
      }
    }
  }

  // PERF-005: 不必要的深拷贝
  if (/JSON\.parse\(JSON\.stringify|structuredClone|_.cloneDeep|lodash.*cloneDeep/.test(diff)) {
    issues.push(issue('PERF-005', 'warn',
      '使用了深拷贝，注意性能影响',
      '评估是否真的需要深拷贝，浅层拷贝通常更快'));
  }

  // PERF-006: 大文件上传无限制
  if (/upload|multer|file.*size|maxSize/i.test(diff)) {
    if (!/limit|maxSize|fileSize|file_size/i.test(diff)) {
      issues.push(issue('PERF-006', 'warn',
        '文件上传没有大小限制',
        '设置合理的文件大小上限，避免内存溢出'));
    }
  }

  // PERF-007: 正则表达式性能
  const greedyRegex = diff.match(/\/\.\*\+\/|\/\.\*\?\/[gimsuy]*\.(test|match|exec|replace)/g);
  if (greedyRegex && greedyRegex.length > 3) {
    issues.push(issue('PERF-007', 'info',
      '使用了多个贪婪匹配正则，注意性能',
      '尽量使用更具体的匹配模式代替 .*'));
  }

  // PERF-008: 图片未优化
  if (files.some(f => /\.(png|jpg|jpeg|gif)$/i.test(f))) {
    issues.push(issue('PERF-008', 'info',
      '新增了图片文件，建议优化',
      '使用 WebP 格式，压缩图片大小，考虑 CDN'));
  }

  // PERF-009: 大数据 JSON 序列化
  if (/JSON\.stringify/.test(diff) && /list|array|result.*map|items/i.test(diff)) {
    if (!/stream|pagination|limit/i.test(diff)) {
      issues.push(issue('PERF-009', 'info',
        '大数据量 JSON 序列化可能影响性能',
        '考虑分页或流式响应'));
    }
  }

  // PERF-010: 内存泄漏风险
  if (/addEventListener|on\s*\(|setInterval|setTimeout/.test(diff) &&
      !/removeEventListener|off\s*\(|clearInterval|clearTimeout/.test(diff)) {
    if (/component|useEffect|mount|created/i.test(diff)) {
      issues.push(issue('PERF-010', 'warn',
        '组件/类中注册了事件监听器但没有清理',
        '在销毁/卸载时移除事件监听器，避免内存泄漏'));
    }
  }

  return issues;
}

// ============================================================
// MAINT - 可维护性（12 条）
// ============================================================

async function checkMaintainabilityRules(ctx) {
  const { diff, fileContents = {}, files } = ctx;
  const issues = [];

  // MAINT-001: 超长函数
  for (const [file, content] of Object.entries(fileContents)) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const functions = extractFunctions(content);
    const longFns = functions.filter(f => f.lines > 80);
    if (longFns.length > 0) {
      issues.push(issue('MAINT-001', 'warn',
        `文件 ${path.basename(file)} 中有 ${longFns.length} 个函数超过 80 行`,
        '将长函数拆分为更小的、职责单一的函数',
        file));
    }
  }

  // MAINT-002: 嵌套过深
  const deepNesting = diff.match(/^\s*if\s*\([^)]*\)\s*\{[\s\S]{0,200}^\s*if\s*\([^)]*\)\s*\{[\s\S]{0,200}^\s*if\s*\(/m);
  if (deepNesting) {
    issues.push(issue('MAINT-002', 'warn',
      '代码嵌套层级过深（超过 3 层）',
      '使用早返回（guard clause）或提取函数降低嵌套深度'));
  }

  // MAINT-003: 魔法数字/字符串
  const magicNumberPatterns = diff.match(/[=(:]\s*\d{3,}(?!\s*\.)/g);
  if (magicNumberPatterns && magicNumberPatterns.length > 5) {
    issues.push(issue('MAINT-003', 'warn',
      '代码中存在多个魔法数字',
      '提取为命名常量，提高可读性和可维护性'));
  }

  // MAINT-004: console.log 留在生产代码
  const consoleLogs = (diff.match(/\+\s*console\.log\s*\(/g) || []).length;
  if (consoleLogs > 0) {
    issues.push(issue('MAINT-004', 'error',
      `新增了 ${consoleLogs} 个 console.log`,
      '使用适当的日志库（winston/pino等），或在提交前移除调试日志'));
  }

  // MAINT-005: 重复代码
  const addedLines = getAddedLines(diff);
  if (addedLines.length > 20) {
    const lineCounts = {};
    for (const line of addedLines) {
      const trimmed = line.trim();
      if (trimmed.length > 15 && !/^[{}();,[\]]+$/.test(trimmed)) {
        lineCounts[trimmed] = (lineCounts[trimmed] || 0) + 1;
      }
    }
    const duplicates = Object.entries(lineCounts).filter(([, count]) => count >= 3);
    if (duplicates.length >= 2) {
      issues.push(issue('MAINT-005', 'warn',
        `检测到 ${duplicates.length} 处重复代码（出现 3 次以上）`,
        '提取公共逻辑为函数或组件，减少重复'));
    }
  }

  // MAINT-006: 单文件行数 > 300 警告
  for (const [file, content] of Object.entries(fileContents)) {
    const lines = content.split('\n').length;
    if (lines > 300 && /\.(ts|tsx|js|jsx)$/.test(file)) {
      issues.push(issue('MAINT-006', 'warn',
        `文件 ${path.basename(file)} 有 ${lines} 行（超过 300 行），建议拆分`,
        '按职责拆分为多个模块/组件，每个文件专注于一个功能领域',
        file));
    }
  }

  // MAINT-007: 函数参数 > 5 个
  const paramCountPatterns = [
    /function\s+\w*\s*\(([^)]{60,})\)/g,
    /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(([^)]{60,})\)\s*=>/g,
  ];
  let manyParamsCount = 0;
  for (const pat of paramCountPatterns) {
    const matches = diff.matchAll(pat);
    for (const m of matches) {
      const params = m[1].split(',').filter(p => p.trim().length > 0);
      if (params.length > 5) {
        manyParamsCount++;
      }
    }
  }
  if (manyParamsCount > 0) {
    issues.push(issue('MAINT-007', 'warn',
      `有 ${manyParamsCount} 个函数参数超过 5 个`,
      '使用配置对象（options object）代替多个位置参数，提高可读性和可扩展性'));
  }

  // MAINT-008: 循环依赖检测（简单检测互相 import）
  if (files.length > 1 && Object.keys(fileContents).length > 1) {
    const fileImports = {};
    for (const [file, content] of Object.entries(fileContents)) {
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
      const importSources = [];
      const importMatches = content.matchAll(/import\s+(?:.+\s+from\s+)?['"]([^'"]+)['"]/g);
      for (const im of importMatches) {
        importSources.push(im[1]);
      }
      fileImports[file] = importSources;
    }

    // 简单检测：A 的文件名出现在 B 的 import 中，且 B 的文件名出现在 A 的 import 中
    const fileList = Object.keys(fileImports);
    let hasCircular = false;
    for (let i = 0; i < fileList.length; i++) {
      for (let j = i + 1; j < fileList.length; j++) {
        const fileA = fileList[i];
        const fileB = fileList[j];
        const nameA = path.basename(fileA, path.extname(fileA));
        const nameB = path.basename(fileB, path.extname(fileB));
        const aImportsB = fileImports[fileA].some(src =>
          src.includes(nameB) || src.endsWith(nameB) || src.endsWith(`/${nameB}`)
        );
        const bImportsA = fileImports[fileB].some(src =>
          src.includes(nameA) || src.endsWith(nameA) || src.endsWith(`/${nameA}`)
        );
        if (aImportsB && bImportsA) {
          hasCircular = true;
          break;
        }
      }
      if (hasCircular) break;
    }

    if (hasCircular) {
      issues.push(issue('MAINT-008', 'warn',
        '检测到模块间可能存在循环依赖（互相 import）',
        '提取公共依赖到第三个模块，或使用依赖注入、事件驱动等方式解耦模块关系'));
    }
  }

  // MAINT-009: 注释掉的代码（检测大段 // 或 /* */ 注释的代码）
  // 检测多行连续的 // 注释且看起来像代码
  const lines = diff.split('\n');
  let commentedCodeLines = 0;
  let maxCommentedCodeStreak = 0;
  let currentStreak = 0;
  for (const line of lines) {
    if (/^\+\s*\/\/\s*(const|let|var|function|return|if|for|while|switch|class|import|export|=|;)/.test(line)) {
      currentStreak++;
      commentedCodeLines++;
    } else if (/^\+\s*\/\*/.test(line) || /^\+\s*\*\//.test(line)) {
      // 块注释边界
    } else {
      if (currentStreak > maxCommentedCodeStreak) {
        maxCommentedCodeStreak = currentStreak;
      }
      currentStreak = 0;
    }
  }
  if (currentStreak > maxCommentedCodeStreak) {
    maxCommentedCodeStreak = currentStreak;
  }

  // 检测大段块注释中的代码
  const blockCommentMatches = diff.match(/\/\*[\s\S]*?\*\//g) || [];
  for (const block of blockCommentMatches) {
    const blockLines = block.split('\n').filter(l => /\b(const|let|var|function|return|if|for|while|import|export)\b/.test(l));
    if (blockLines.length > 5) {
      commentedCodeLines += blockLines.length;
      if (blockLines.length > maxCommentedCodeStreak) {
        maxCommentedCodeStreak = blockLines.length;
      }
    }
  }

  if (maxCommentedCodeStreak >= 5 || commentedCodeLines >= 10) {
    issues.push(issue('MAINT-009', 'warn',
      `检测到 ${commentedCodeLines} 行被注释掉的代码（最长连续 ${maxCommentedCodeStreak} 行）`,
      '删除注释掉的代码，版本控制系统（Git）会保留历史记录，需要时可以找回'));
  }

  // MAINT-010: import 顺序混乱（检测）
  const imports = diff.match(/^\+\s*import\s+.*from\s+['"].+['"]/gm) || [];
  if (imports.length > 3) {
    const hasThirdParty = imports.some(i => !/^\.\.?\//.test(i.match(/from\s+['"](.+)['"]/)?.[1] || ''));
    const hasLocal = imports.some(i => /^\.\.?\//.test(i.match(/from\s+['"](.+)['"]/)?.[1] || ''));
    if (hasThirdParty && hasLocal) {
      let foundLocal = false;
      let outOfOrder = false;
      for (const imp of imports) {
        const source = imp.match(/from\s+['"](.+)['"]/)?.[1] || '';
        if (/^\.\.?\//.test(source)) {
          foundLocal = true;
        } else if (foundLocal) {
          outOfOrder = true;
          break;
        }
      }
      if (outOfOrder) {
        issues.push(issue('MAINT-010', 'info',
          'import 语句顺序不规范（第三方库和相对路径混排）',
          '按 第三方库 → 内部模块 → 相对路径 的顺序组织 import'));
      }
    }
  }

  // MAINT-011: 导出的函数/变量未使用（简单检测）
  const exportMatches = diff.match(/^\+\s*export\s+(const|let|var|function|class|interface|type)\s+(\w+)/gm) || [];
  const exportedNames = exportMatches.map(m => m.match(/export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/)?.[1]).filter(Boolean);

  if (exportedNames.length >= 5) {
    // 启发式：导出很多但文件中使用的很少（只检查当前 diff）
    let usedExports = 0;
    for (const name of exportedNames) {
      const usageCount = (diff.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      // 减去定义本身
      if (usageCount > 1) usedExports++;
    }
    // 如果超过一半的导出在本文件中只出现了一次（即只有定义没有使用），给出提示
    const unusedExports = exportedNames.length - usedExports;
    if (unusedExports > exportedNames.length / 2) {
      issues.push(issue('MAINT-011', 'info',
        `导出了 ${exportedNames.length} 个名称，其中 ${unusedExports} 个可能未被使用`,
        '删除未使用的 export，只导出真正需要被外部使用的 API，内部使用的保持私有'));
    }
  }

  // MAINT-012: 类型断言滥用（TypeScript 的 as 关键字过多）
  const tsFiles = files.filter(f => /\.tsx?$/.test(f));
  if (tsFiles.length > 0) {
    const asAssertions = (diff.match(/\bas\s+(string|number|boolean|any|unknown|never|Array|Record|Map|Set|Promise|[A-Z]\w+)\b/g) || []).length;
    if (asAssertions >= 3) {
      issues.push(issue('MAINT-012', 'warn',
        `使用了 ${asAssertions} 次类型断言（as），可能绕过类型检查`,
        '优先使用类型守卫（type guard）、泛型、正确的类型定义，避免频繁使用 as 断言'));
    }
  }

  return issues;
}

// ============================================================
// TEST - 测试（10 条）
// ============================================================

async function checkTestingRules(ctx) {
  const { diff, files, fileContents = {} } = ctx;
  const issues = [];

  const sourceFiles = files.filter(f =>
    /\.(ts|tsx|js|jsx|py|go|java)$/.test(f) && !/\.(test|spec)\./.test(f) && !/node_modules/.test(f)
  );
  const testFiles = files.filter(f => /\.(test|spec)\./.test(f));

  // TEST-001: 新文件没有对应测试文件
  if (sourceFiles.length > 0 && testFiles.length === 0) {
    issues.push(issue('TEST-001', 'warn',
      `新增了 ${sourceFiles.length} 个源文件但没有对应的测试文件`,
      '为新代码添加单元测试，测试文件命名为 *.test.ts 或 *.spec.ts'));
  }

  // TEST-002: 测试文件中没有 it/test 用例
  if (testFiles.length > 0) {
    let hasEmptyTest = false;
    for (const file of testFiles) {
      const content = fileContents[file] || '';
      const hasDescribe = /describe\s*\(/.test(content);
      const hasTestCase = /\bit\s*\(|\btest\s*\(/.test(content);
      if (hasDescribe && !hasTestCase) {
        hasEmptyTest = true;
        break;
      }
    }
    if (hasEmptyTest) {
      issues.push(issue('TEST-002', 'warn',
        '测试文件存在但没有实际的测试用例（it/test）',
        '添加真正的测试用例，每个测试验证一个具体的行为或场景'));
    }
  }

  // TEST-003: 只有 happy path 没有 negative test
  if (testFiles.length > 0) {
    const happyPath = diff.match(/should (return|be|have|work|success|correct|properly)/gi) || [];
    const errorPath = diff.match(/should (throw|error|fail|reject|invalid|not found|4\d{2}|5\d{2}|empty|null|undefined)/gi) || [];
    if (happyPath.length > 3 && errorPath.length === 0) {
      issues.push(issue('TEST-003', 'warn',
        '测试主要覆盖 happy path，缺少异常/边界场景测试',
        '添加错误处理、边界条件、非法输入等场景的测试用例'));
    }
  }

  // TEST-004: 测试用 describe/it 命名不规范
  if (testFiles.length > 0) {
    const vagueTests = diff.match(/\bit\s*\(['"](test|check|verify|test\d+|case\d+|demo|example|1|2|3)['"]/gi);
    if (vagueTests && vagueTests.length > 0) {
      issues.push(issue('TEST-004', 'warn',
        `有 ${vagueTests.length} 个测试用例描述模糊（如 "test"、"check" 等）`,
        '使用描述性的测试名称，遵循 "should + 行为 + 条件" 格式'));
    }
  }

  // TEST-005: 测试中使用了 .only 或 .skip
  if (testFiles.length > 0) {
    const onlyCount = (diff.match(/\.only\s*\(/g) || []).length;
    const skipCount = (diff.match(/\.skip\s*\(/g) || []).length;
    if (onlyCount > 0 || skipCount > 0) {
      issues.push(issue('TEST-005', 'error',
        `测试代码中包含 ${onlyCount > 0 ? onlyCount + ' 个 .only' : ''}${onlyCount > 0 && skipCount > 0 ? ' 和 ' : ''}${skipCount > 0 ? skipCount + ' 个 .skip' : ''}`,
        '删除 .only 和 .skip，确保所有测试都正常运行。如果测试暂时不可用，创建 issue 跟踪'));
    }
  }

  // TEST-006: 测试用 console.log 而非断言
  if (testFiles.length > 0) {
    const consoleInTest = (diff.match(/\+\s*console\.(log|warn|error|info)\s*\(/g) || []).length;
    const assertions = (diff.match(/expect\(|assert\.|should\.|\.toBe|\.toEqual|\.toMatch|\.toThrow/g) || []).length;
    if (consoleInTest > 0 && assertions < 3) {
      issues.push(issue('TEST-006', 'warn',
        `测试中有 ${consoleInTest} 个 console.log 但断言较少`,
        '使用 expect/assert 等断言函数进行自动化验证，不要靠人眼查看 console 输出'));
    }
  }

  // TEST-007: 快照测试过大（>100 行）
  if (testFiles.length > 0) {
    const snapshotMatches = diff.match(/toMatchSnapshot|toMatchInlineSnapshot/g) || [];
    if (snapshotMatches.length > 0) {
      // 检查内联快照大小
      const inlineSnapshots = diff.match(/toMatchInlineSnapshot\s*\(`([^`]*)`\)/g) || [];
      for (const snap of inlineSnapshots) {
        const snapLines = snap.split('\n').length;
        if (snapLines > 100) {
          issues.push(issue('TEST-007', 'warn',
            `快照测试过大（${snapLines} 行），建议拆分`,
            '拆分为更小的组件快照，或改用针对性的断言代替大快照测试'));
          break;
        }
      }
    }
  }

  // TEST-008: 缺少错误分支测试
  if (testFiles.length > 0) {
    const hasThrowTest = /toThrow|toThrowError|should.*throw|expect.*rejects/.test(diff);
    const hasErrorHandling = /catch|try|throw|Error/.test(diff);
    if (hasErrorHandling && !hasThrowTest) {
      issues.push(issue('TEST-008', 'warn',
        '代码中有错误处理逻辑但缺少对应的错误分支测试',
        '为每个错误处理分支添加测试，验证错误被正确抛出、正确格式、正确消息'));
    }
  }

  // TEST-009: 测试文件和源文件不在对应目录
  if (sourceFiles.length > 0 && testFiles.length > 0) {
    // 简单检查：测试文件是否和源文件在同一目录结构下
    const sourceDirs = new Set(sourceFiles.map(f => path.dirname(f)));
    const testDirs = new Set(testFiles.map(f => {
      const dir = path.dirname(f);
      // 去掉 __tests__ 后缀
      return dir.replace(/[\\/]__tests__$/, '');
    }));

    // 如果源文件目录和测试文件目录完全不重叠，可能目录结构不对
    let mismatch = true;
    for (const sd of sourceDirs) {
      for (const td of testDirs) {
        if (sd === td || sd.endsWith(td) || td.endsWith(sd)) {
          mismatch = false;
          break;
        }
      }
      if (!mismatch) break;
    }

    if (mismatch && sourceFiles.length <= 5) {
      issues.push(issue('TEST-009', 'info',
        '测试文件和源文件可能不在对应的目录结构中',
        '保持测试文件与源文件同目录（或 __tests__ 子目录），目录结构一一对应'));
    }
  }

  // TEST-010: 集成测试缺少 mock
  if (testFiles.length > 0) {
    const hasExternalCall = /fetch\(|axios\.|http\.(get|post)|request\(|XMLHttpRequest/.test(diff);
    const hasMock = /jest\.mock|vi\.mock|mock|stub|spy|jest\.fn|vi\.fn|msw|MockProvider/.test(diff);
    if (hasExternalCall && !hasMock) {
      issues.push(issue('TEST-010', 'error',
        '测试中直接调用了外部服务但没有 mock',
        '使用 mock 代替真实 API 调用，测试只验证业务逻辑，提高测试速度和稳定性'));
    }
  }

  return issues;
}

// ============================================================
// PATTERN - 代码规范一致性（8 条）
// ============================================================

async function checkPatternRules(ctx) {
  const { diff, files, patterns, fileContents = {}, projectRoot } = ctx;
  const issues = [];

  // 如果有 code-patterns.yaml 内容，做更深入的检查
  const patternsContent = patterns || '';

  // PATTERN-001: 命名不符合约定（检测全大写常量、驼峰函数等）
  const namingViolations = [];
  for (const file of files) {
    const basename = path.basename(file);
    if (/\.(ts|tsx|js|jsx)$/.test(basename) && !/\.(test|spec)\./.test(basename)) {
      // React 组件应该 PascalCase
      if (/\.tsx$|\.jsx$/.test(basename) && /^[a-z]/.test(basename)) {
        namingViolations.push(basename);
      }
    }
  }

  // 检测变量命名：蛇形命名变量
  const snakeCaseVars = diff.match(/\b(?:const|let|var)\s+[a-z]+_[a-z_]+\s*=/g) || [];
  if (snakeCaseVars.length > 2) {
    namingViolations.push(`${snakeCaseVars.length} 个蛇形命名变量`);
  }

  if (namingViolations.length > 0) {
    issues.push(issue('PATTERN-001', 'warn',
      `命名不符合约定: ${namingViolations.slice(0, 3).join(', ')}${namingViolations.length > 3 ? ' 等' : ''}`,
      '遵循项目命名规范：类/组件用 PascalCase，函数/变量用 camelCase，常量用 UPPER_SNAKE_CASE'));
  }

  // PATTERN-002: 使用 var 而非 let/const
  const varCount = (diff.match(/\bvar\s+\w+/g) || []).length;
  if (varCount > 0) {
    issues.push(issue('PATTERN-002', 'warn',
      `使用了 ${varCount} 个 var 声明变量`,
      '使用 const（默认）和 let（需要重新赋值时）代替 var，利用块级作用域减少错误'));
  }

  // PATTERN-003: 嵌套三元表达式
  const nestedTernary = diff.match(/\?[^?\n]*\?[^?\n]*:/g) || [];
  if (nestedTernary.length > 0) {
    issues.push(issue('PATTERN-003', 'warn',
      `检测到 ${nestedTernary.length} 处嵌套三元表达式`,
      '嵌套的三元表达式难以阅读，应使用 if-else 语句或提取为命名函数'));
  }

  // PATTERN-004: 空 catch 块
  const emptyCatch = (diff.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || []).length;
  if (emptyCatch > 0) {
    issues.push(issue('PATTERN-004', 'error',
      `发现 ${emptyCatch} 个空的 catch 块（吞掉异常）`,
      '至少在 catch 中记录错误日志，或重新抛出更有语义的异常，不要让错误悄无声息'));
  }

  // PATTERN-005: 不必要的 else（提前返回）
  const unnecessaryElse = diff.match(/if\s*\([^)]*\)\s*\{\s*(?:return|throw)\s+[^}]+}\s*else\s*\{/g) || [];
  if (unnecessaryElse.length > 0) {
    issues.push(issue('PATTERN-005', 'info',
      `有 ${unnecessaryElse.length} 处不必要的 else（if 中已有 return/throw）`,
      '使用 guard clause（守卫子句）提前返回，主逻辑保持扁平，减少 else 嵌套'));
  }

  // PATTERN-006: 过长的 if 条件（>3 个 && ||）
  const longConditions = [];
  const ifMatches = diff.matchAll(/if\s*\(([^)]{50,})\)/g);
  for (const m of ifMatches) {
    const condition = m[1];
    const andOrCount = (condition.match(/&&|\|\|/g) || []).length;
    if (andOrCount >= 3) {
      longConditions.push(condition.slice(0, 60) + '...');
    }
  }
  if (longConditions.length > 0) {
    issues.push(issue('PATTERN-006', 'warn',
      `有 ${longConditions.length} 个 if 条件过长（包含 3+ 个逻辑运算符）`,
      '将复杂条件提取为语义化的布尔变量或函数，提高可读性'));
  }

  // PATTERN-007: 魔法数字（非 0/1/-1 的直接数字）
  const magicNumbers = new Set();
  const numMatches = diff.matchAll(/[=(:(,]\s*(-?\d{2,})(?!\d*\.\d)(?!\s*px)(?!\s*%)/g);
  for (const m of numMatches) {
    const num = m[1];
    // 排除 0/1/-1 和常见的无害数字
    if (['0', '1', '-1', '2', '10', '100', '1000', '200', '404', '500'].includes(num)) continue;
    // 排除年份
    if (/^19|20\d{2}$/.test(num)) continue;
    magicNumbers.add(num);
    if (magicNumbers.size >= 5) break;
  }
  if (magicNumbers.size >= 3) {
    issues.push(issue('PATTERN-007', 'warn',
      `检测到 ${magicNumbers.size} 个魔法数字: ${[...magicNumbers].slice(0, 3).join(', ')} 等`,
      '将有业务含义的数字提取为命名常量，使用描述性名称'));
  }

  // PATTERN-008: 函数副作用不明显（修改参数）
  // 检测函数内直接修改参数对象的属性
  const paramMutationPatterns = [
    /function\s+\w*\s*\((\w+)\)[^{]*\{[\s\S]*?\1\.\w+\s*=[^=]/g,
    /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\((\w+)\)\s*=>\s*\{[\s\S]*?\1\.\w+\s*=[^=]/g,
  ];
  let paramMutationCount = 0;
  for (const pat of paramMutationPatterns) {
    const matches = diff.matchAll(pat);
    for (const m of matches) {
      // 简单启发式：参数名后面跟 .属性 = 赋值
      paramMutationCount++;
    }
  }
  if (paramMutationCount > 0) {
    issues.push(issue('PATTERN-008', 'warn',
      `检测到 ${paramMutationCount} 处函数直接修改参数对象`,
      '避免修改参数对象，返回新的对象或值。如果确实需要修改，在函数名中明确体现'));
  }

  // 额外：与 code-patterns.yaml 一致性检查（保留原有功能）
  if (patternsContent) {
    const checks = [
      { pattern: /命名规范|PascalCase|camelCase|kebab-case/i, desc: '命名规范' },
      { pattern: /import.*顺序|import.*排序/i, desc: 'import 顺序' },
      { pattern: /函数长度|max-lines|复杂度/i, desc: '函数复杂度' },
      { pattern: /注释|JSDoc/i, desc: '注释规范' },
      { pattern: /错误处理|Error|exception/i, desc: '错误处理' },
    ];

    let matchedPatterns = 0;
    for (const check of checks) {
      if (check.pattern.test(patternsContent)) matchedPatterns++;
    }

    if (matchedPatterns > 0) {
      issues.push(issue('PATTERN-005', 'info',
        `项目有 ${matchedPatterns} 项代码规范，请确保符合 .code-patterns.yaml`,
        '查看 .code-patterns.yaml 了解完整的代码规范'));
    }
  }

  return issues;
}

// ============================================================
// LLM 辅助审查
// ============================================================

async function runLLMReview(ctx) {
  if (!llm.isAvailable()) {
    return { available: false, issues: [] };
  }

  const { diff, files, fileContents = {} } = ctx;

  // 只审查源文件（不审查测试和配置）
  const sourceFiles = files.filter(f =>
    /\.(ts|tsx|js|jsx|py|go)$/.test(f) && !/\.(test|spec)\./.test(f) && !/node_modules/.test(f)
  );

  if (sourceFiles.length === 0) {
    return { available: true, issues: [] };
  }

  // 选择前 3 个文件进行 LLM 审查（避免 token 过多）
  const filesToReview = sourceFiles.slice(0, 3);

  const llmIssues = [];

  for (const file of filesToReview) {
    const code = fileContents[file] || '';
    if (!code) continue;

    // 只发送前 300 行
    const codeSnippet = code.split('\n').slice(0, 300).join('\n');

    const result = await llm.reviewCode({
      code: codeSnippet,
      language: detectLang(file),
      checklist: [
        '检查潜在的 bug 和逻辑错误',
        '检查边界条件处理',
        '检查错误处理是否完善',
        '检查代码可读性和命名',
        '检查性能问题',
        '检查安全漏洞',
      ],
    });

    if (result.ok && result.review) {
      const review = result.review;
      if (review.issues && review.issues.length > 0) {
        for (const issue of review.issues.slice(0, 3)) {
          llmIssues.push({
            id: `LLM-${llmIssues.length + 1}`,
            severity: issue.severity === 'critical' ? 'critical' :
                      issue.severity === 'major' ? 'error' :
                      issue.severity === 'minor' ? 'warn' : 'info',
            category: 'LLM',
            message: `${path.basename(file)}: ${issue.description}`,
            suggestion: issue.suggestion || '',
            file,
            line: issue.line || null,
            source: 'llm',
          });
        }
      }
    }

    // 深度安全分析：将 AST 预检测结果传给 LLM 进行上下文增强
    const astFindingsForFile = (ctx._astIssues || []).filter(a => a.file === file);
    const secResult = await llm.analyzeSecurity({
      code: codeSnippet,
      filePath: file,
      fileType: detectLang(file),
      astFindings: astFindingsForFile.map(a => ({ type: a.id, line: a.line, description: a.message })),
      checklist: ['OWASP Top 10', 'hardcoded secrets', 'injection risks', 'XSS', 'auth bypass'],
    });

    if (secResult.ok && secResult.audit && secResult.audit.findings) {
      for (const finding of secResult.audit.findings.slice(0, 5)) {
        llmIssues.push({
          id: `SEC-${llmIssues.length + 1}`,
          severity: finding.severity === 'critical' ? 'critical' :
                    finding.severity === 'high' ? 'error' :
                    finding.severity === 'medium' ? 'warn' : 'info',
          category: 'SEC',
          message: `${path.basename(file)}: ${finding.description}`,
          suggestion: finding.remediation || '',
          file,
          line: finding.line || null,
          source: 'llm-security',
        });
      }
    }
  }

  return { available: true, issues: llmIssues };
}

// ============================================================
// 辅助函数
// ============================================================

function getAddedLines(diff) {
  return (diff.match(/^\+[^+].*$/gm) || []).map(l => l.slice(1));
}

function getDeletedLines(diff) {
  return (diff.match(/^-[^-].*$/gm) || []).map(l => l.slice(1));
}

function detectLang(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go',
    '.rs': 'rust', '.java': 'java',
  };
  return map[ext] || 'typescript';
}

function extractFunctions(content) {
  const functions = [];
  const lines = content.split('\n');
  let currentFn = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);

    if (fnMatch && !currentFn) {
      currentFn = { name: fnMatch[1], startLine: i + 1 };
      braceDepth = 0;
    } else if (arrowMatch && !currentFn) {
      currentFn = { name: arrowMatch[1], startLine: i + 1 };
      braceDepth = 0;
    }

    if (currentFn) {
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      if (braceDepth <= 0 && currentFn.startLine < i + 1 && /\}/.test(line)) {
        currentFn.lines = i + 1 - currentFn.startLine + 1;
        if (currentFn.lines > 10) { // 只记录超过 10 行的函数
          functions.push(currentFn);
        }
        currentFn = null;
      }
    }
  }

  return functions;
}

// ============================================================
// 命令 1: pr - 审查 PR / git diff
// ============================================================

async function reviewPR({ base = 'main', prNumber, strictMode = true, categories, useLLM = true, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  // 1. 获取 diff
  let diff;
  try {
    const cmd = prNumber
      ? `gh pr diff ${prNumber}`
      : `git diff ${base}...HEAD`;
    const result = await execAsync(cmd, { cwd, timeout: 30_000, maxBuffer: 50 * 1024 * 1024 });
    diff = result.stdout;
  } catch (err) {
    // 如果没有 git，尝试读取文件
    return { ok: false, error: `Failed to get diff: ${err.message?.slice(0, 200)}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 2. 解析变更文件
  const fileMatches = diff.match(/^\+\+\+\s+b\/(.+)$/gm) || [];
  const files = fileMatches.map(m => m.replace(/^\+\+\+\s+b\//, '')).filter(f => f !== '/dev/null');

  if (files.length === 0) {
    return { ok: true, data: { summary: 'ℹ️ No changed files detected', filesChanged: 0, items: [], llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 3. 读取变更文件内容
  const fileContents = {};
  for (const file of files) {
    try {
      const fullPath = path.resolve(cwd, file);
      fileContents[file] = await fs.readFile(fullPath, 'utf-8');
    } catch { /* 忽略无法读取的文件 */ }
  }

  // 4. 读取 code-patterns
  let patterns = '';
  try {
    patterns = await fs.readFile(path.join(cwd, '.code-patterns.yaml'), 'utf-8');
  } catch { /* 没有则跳过 */ }

  // 5. 运行静态规则
  const cats = categories || Object.keys(RULE_CATEGORIES);
  const ctx = { diff, files, fileContents, projectRoot: cwd, patterns };
  const staticIssues = await runRules(ctx, cats);

  // 5.5 运行 AST 分析并注入到 ctx，供 LLM 安全分析使用
  ctx._astIssues = await runASTAnalysis(ctx);

  // 6. LLM 辅助审查（可选，包含深度安全分析）
  let llmIssues = [];
  let llmEnhanced = false;
  if (useLLM && llm.isAvailable()) {
    llmEnhanced = true;
    const llmResult = await runLLMReview(ctx);
    llmIssues = llmResult.issues;
  }

  // 7. 汇总
  const allIssues = [...staticIssues, ...llmIssues];

  return formatReviewResult(allIssues, files, strictMode, cats, llmEnhanced);
}

// ============================================================
// 命令 2: file - 审查单个文件
// ============================================================

async function reviewFile({ filePath, categories, useLLM = true, projectRoot }) {
  const cwd = projectRoot || process.cwd();
  const fullPath = path.resolve(cwd, filePath);

  let content;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read file: ${err.message}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 构造伪 diff（全部为新增）
  const diffLines = content.split('\n').map(l => '+' + l).join('\n');
  const fakeDiff = `diff --git a/${filePath} b/${filePath}\n--- /dev/null\n+++ b/${filePath}\n${diffLines}`;

  const fileContents = { [filePath]: content };

  // 读取 code-patterns
  let patterns = '';
  try {
    patterns = await fs.readFile(path.join(cwd, '.code-patterns.yaml'), 'utf-8');
  } catch { /* 没有则跳过 */ }

  const cats = categories || Object.keys(RULE_CATEGORIES);
  const ctx = { diff: fakeDiff, files: [filePath], fileContents, projectRoot: cwd, patterns };
  const staticIssues = await runRules(ctx, cats);

  // LLM 审查
  let llmIssues = [];
  let llmEnhanced = false;
  if (useLLM && llm.isAvailable()) {
    llmEnhanced = true;
    const llmResult = await runLLMReview(ctx);
    llmIssues = llmResult.issues;
  }

  const allIssues = [...staticIssues, ...llmIssues];
  return formatReviewResult(allIssues, [filePath], true, cats, llmEnhanced);
}

// ============================================================
// 命令 3: files - 审查多个文件
// ============================================================

async function reviewFiles({ filePaths, categories, useLLM = true, projectRoot }) {
  const cwd = projectRoot || process.cwd();

  if (!filePaths || filePaths.length === 0) {
    return { ok: false, error: 'filePaths is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const allIssues = [];
  const validFiles = [];

  for (const fp of filePaths) {
    const result = await reviewFile({ filePath: fp, categories, useLLM: false, projectRoot: cwd });
    if (result.ok) {
      allIssues.push(...result.data.items);
      validFiles.push(fp);
    }
  }

  // 只对前 3 个文件做 LLM 审查
  let llmEnhanced = false;
  if (useLLM && llm.isAvailable() && validFiles.length > 0) {
    llmEnhanced = true;
    const fileContents = {};
    for (const fp of validFiles.slice(0, 3)) {
      try {
        fileContents[fp] = await fs.readFile(path.resolve(cwd, fp), 'utf-8');
      } catch { /* ignore */ }
    }
    const llmResult = await runLLMReview({ files: validFiles, fileContents, diff: '' });
    allIssues.push(...llmResult.issues);
  }

  return formatReviewResult(allIssues, validFiles, true, categories || Object.keys(RULE_CATEGORIES), llmEnhanced);
}

// ============================================================
// 命令 4: diff - 审查 diff 文本
// ============================================================

async function reviewDiff({ diffText, categories, useLLM = false, projectRoot }) {
  if (!diffText) {
    return { ok: false, error: 'diffText is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const fileMatches = diffText.match(/^\+\+\+\s+b\/(.+)$/gm) || [];
  const files = fileMatches.map(m => m.replace(/^\+\+\+\s+b\//, '')).filter(f => f !== '/dev/null');

  const cats = categories || Object.keys(RULE_CATEGORIES);
  const ctx = { diff: diffText, files, fileContents: {}, projectRoot, patterns: '' };
  const staticIssues = await runRules(ctx, cats);

  // diff 模式默认不启用 LLM（没有文件内容）
  const allIssues = staticIssues;
  return formatReviewResult(allIssues, files, true, cats, false);
}

// ============================================================
// 命令 5: summary - 生成审查摘要
// ============================================================

async function reviewSummary({ base = 'main', projectRoot }) {
  const result = await reviewPR({ base, strictMode: false, useLLM: false, projectRoot });

  if (!result.ok && !result.data) {
    return result;
  }

  const data = result.data;
  const items = data.items || [];

  // 按类别分组
  const byCategory = {};
  for (const item of items) {
    const cat = item.category || 'OTHER';
    if (!byCategory[cat]) byCategory[cat] = { critical: 0, error: 0, warn: 0, info: 0, items: [] };
    byCategory[cat][item.severity] = (byCategory[cat][item.severity] || 0) + 1;
    byCategory[cat].items.push(item);
  }

  return {
    ok: true,
    data: {
      summary: data.summary,
      verdict: data.verdict,
      filesChanged: data.filesChanged,
      errorsCount: data.errorsCount,
      warningsCount: data.warningsCount,
      llmEnhanced: data.llmEnhanced,
      llmProvider: data.llmProvider,
      byCategory,
      categories: Object.keys(byCategory),
      topIssues: items
        .filter(i => i.severity === 'critical' || i.severity === 'error')
        .slice(0, 10),
    },
    warnings: [],
    nextActions: result.nextActions,
  };
}

// ============================================================
// 格式化审查结果
// ============================================================

function formatReviewResult(issues, files, strictMode, categories, llmEnhanced) {
  const critical = issues.filter(i => i.severity === 'critical');
  const errors = issues.filter(i => i.severity === 'error');
  const warns = issues.filter(i => i.severity === 'warn');
  const infos = issues.filter(i => i.severity === 'info');

  let verdict;
  if (critical.length > 0) {
    verdict = 'BLOCK';
  } else if (errors.length > 0) {
    verdict = strictMode ? 'REQUEST_CHANGES' : 'COMMENT';
  } else if (warns.length > 0) {
    verdict = 'APPROVE_WITH_COMMENTS';
  } else {
    verdict = 'APPROVE';
  }

  const totalIssues = critical.length + errors.length + warns.length + infos.length;

  return {
    ok: critical.length === 0 && (strictMode ? errors.length === 0 : true),
    data: {
      summary: `${verdict} | 🔴${critical.length} ❌${errors.length} ⚠️${warns.length} ℹ️${infos.length} | ${files.length} files`,
      verdict,
      filesChanged: files.length,
      criticalCount: critical.length,
      errorsCount: errors.length,
      warningsCount: warns.length,
      infoCount: infos.length,
      totalIssues,
      items: issues,
      categories,
      llmEnhanced,
      llmProvider: llmEnhanced ? llm.getProviderName() : null,
    },
    warnings: warns.map(w => w.message),
    nextActions: buildNextActions(verdict, critical.length, errors.length, llmEnhanced),
  };
}

function buildNextActions(verdict, criticalCount, errorCount, llmEnhanced) {
  const actions = [];
  if (criticalCount > 0) {
    actions.push('立即修复严重安全问题');
  }
  if (errorCount > 0) {
    actions.push('修复所有错误级别的问题');
  }
  if (verdict === 'APPROVE_WITH_COMMENTS') {
    actions.push('审查警告项，酌情修复后合并');
  }
  if (verdict === 'APPROVE') {
    actions.push('代码审查通过，可以合并');
  }
  if (!llmEnhanced && !llm.isAvailable()) {
    actions.push('配置 LLM API key 以启用 AI 辅助审查');
  }
  return actions;
}

// ============================================================
// 命令 6: checklist - 列出所有规则
// ============================================================

async function checklist({ category, format = 'json', projectRoot }) {
  const llmAvailable = llm.isAvailable();
  const llmEnhanced = false; // checklist 是静态数据，不调用 LLM

  // 过滤规则
  let ruleIds = Object.keys(RULE_DEFS);
  if (category) {
    const cat = category.toUpperCase();
    ruleIds = ruleIds.filter(id => RULE_DEFS[id].category === cat);
  }

  const rules = ruleIds.map(id => {
    const def = RULE_DEFS[id];
    const catInfo = RULE_CATEGORIES[def.category] || {};
    return {
      id,
      category: def.category,
      categoryLabel: catInfo.label || def.category,
      categoryName: catInfo.name || def.category,
      title: def.title,
      description: def.description,
      severity: def.severity,
      automation: def.automation,
    };
  });

  let result;
  if (format === 'markdown') {
    // 按类别分组输出 markdown
    const byCategory = {};
    for (const rule of rules) {
      if (!byCategory[rule.category]) byCategory[rule.category] = [];
      byCategory[rule.category].push(rule);
    }

    let md = `# 代码审查规则清单\n\n`;
    md += `共 **${rules.length}** 条规则，分布在 **${Object.keys(byCategory).length}** 个类别中。\n\n`;

    for (const cat of Object.keys(byCategory)) {
      const catInfo = RULE_CATEGORIES[cat] || {};
      const catRules = byCategory[cat];
      md += `## ${catInfo.icon || ''} ${catInfo.label || cat} (${catRules.length} 条)\n\n`;
      for (const rule of catRules) {
        const severityIcon = {
          critical: '🔴',
          error: '❌',
          warn: '⚠️',
          info: 'ℹ️',
        }[rule.severity] || '•';
        const autoIcon = { auto: '⚙️', ai: '🤖', manual: '✋' }[rule.automation] || '';
        md += `- **${rule.id}** ${severityIcon} ${autoIcon} ${rule.title}\n`;
        md += `  - ${rule.description}\n`;
      }
      md += '\n';
    }

    result = {
      ok: true,
      data: {
        rules,
        totalCount: rules.length,
        categories: Object.keys(byCategory),
        markdown: md,
        llmEnhanced,
        llmProvider: llmAvailable ? llm.getProviderName() : null,
      },
      warnings: [],
      nextActions: [],
    };
  } else {
    // json 格式
    result = {
      ok: true,
      data: {
        rules,
        totalCount: rules.length,
        categories: [...new Set(rules.map(r => r.category))],
        llmEnhanced,
        llmProvider: llmAvailable ? llm.getProviderName() : null,
      },
      warnings: [],
      nextActions: [],
    };
  }

  return result;
}

// ============================================================
// 命令 7: explain - 解释单条规则
// ============================================================

async function explain({ ruleId, projectRoot }) {
  if (!ruleId) {
    return { ok: false, error: 'ruleId is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const def = RULE_DEFS[ruleId.toUpperCase()];
  if (!def) {
    return {
      ok: false,
      error: `Rule ${ruleId} not found. Available rules: ${Object.keys(RULE_DEFS).slice(0, 10).join(', ')}...`,
      data: { llmEnhanced: false, llmProvider: null },
      warnings: [],
      nextActions: [],
    };
  }

  const catInfo = RULE_CATEGORIES[def.category] || {};
  const llmAvailable = llm.isAvailable();
  let llmEnhanced = false;
  let llmExplanation = null;

  // 如果 LLM 可用，用 LLM 补充更详细的解释和案例
  if (llmAvailable) {
    try {
      const result = await llm.explainRule({
        ruleId: ruleId.toUpperCase(),
        ruleTitle: def.title,
        ruleDescription: def.description,
        ruleWhy: def.why,
        ruleFix: def.fix,
        examples: def.examples,
      });
      if (result.ok && result.explanation) {
        llmEnhanced = true;
        llmExplanation = result.explanation;
      }
    } catch (e) {
      // LLM 失败不影响基础信息返回
    }
  }

  const ruleDetail = {
    id: ruleId.toUpperCase(),
    category: def.category,
    categoryLabel: catInfo.label || def.category,
    categoryName: catInfo.name || def.category,
    categoryIcon: catInfo.icon || '',
    title: def.title,
    description: def.description,
    severity: def.severity,
    automation: def.automation,
    why: def.why,
    fix: def.fix,
    examples: def.examples,
    llmExplanation,
  };

  return {
    ok: true,
    data: {
      rule: ruleDetail,
      llmEnhanced,
      llmProvider: llmAvailable ? llm.getProviderName() : null,
    },
    warnings: [],
    nextActions: [],
  };
}

// ============================================================
// 审批命令：approve / requestChanges / block
// ============================================================

async function runReviewAndVerdict(prNumber, projectRoot, expectedVerdict, actionLabel) {
  const result = await reviewPR({ prNumber, projectRoot });
  if (!result.ok) return result;

  const verdict = result.data.verdict;
  const passed = verdict === expectedVerdict ||
    (expectedVerdict === 'APPROVE' && verdict === 'APPROVE_WITH_COMMENTS') ||
    (expectedVerdict === 'BLOCK' && verdict === 'BLOCK');

  return {
    ok: passed,
    data: {
      ...result.data,
      summary: `${actionLabel} | verdict=${verdict} | ${passed ? 'passed' : 'not applicable'}`,
      action: actionLabel,
      passed,
    },
    warnings: passed ? [] : [`Expected ${expectedVerdict} but got ${verdict}`],
    nextActions: passed ? [] : [`Review verdict is ${verdict}, not ${expectedVerdict}`],
  };
}

async function approve({ prNumber, projectRoot }) {
  return runReviewAndVerdict(prNumber, projectRoot, 'APPROVE', 'APPROVE');
}

async function requestChanges({ prNumber, projectRoot }) {
  return runReviewAndVerdict(prNumber, projectRoot, 'REQUEST_CHANGES', 'REQUEST_CHANGES');
}

async function block({ prNumber, projectRoot }) {
  return runReviewAndVerdict(prNumber, projectRoot, 'BLOCK', 'BLOCK');
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  pr: reviewPR,
  file: reviewFile,
  files: reviewFiles,
  diff: reviewDiff,
  summary: reviewSummary,
  checklist,
  explain,

  // 审批命令
  approve,
  requestChanges,
  'request-changes': requestChanges,
  block,

  // 别名兼容
  review: reviewPR,
  reviewPR,
  reviewFile,
  reviewFiles,
  reviewDiff,
  reviewSummary,
  reviewChecklist: checklist,
  reviewExplain: explain,
  // 导出规则引擎供测试
  _rules: { RULE_CATEGORIES, RULE_DEFS, runRules },
};
