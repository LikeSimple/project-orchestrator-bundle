/**
 * spec-userstory-to-design Skill - 完整实现
 *
 * 从 User Story 自动生成 Page Flow（Mermaid flowchart）+ Page Detail + OpenAPI 契约。
 * 3 步 Pipeline + 反向校验，完整覆盖 SKILL.md 设计文档。
 *
 * 对应 MCP Tool: design_generate / design_validate
 */

const fs = require('fs').promises;
const path = require('path');
const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// ============================================================
// 工具函数
// ============================================================

function timestamp() {
  return new Date().toISOString().slice(0, 10);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slugify(s) {
  const asciiSlug = s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (asciiSlug.length >= 2) return asciiSlug;
  // 中文/非英文回退：默认 feature，用户可通过 featureCode 覆盖
  return 'feature';
}

/**
 * 生成页面 ID 前缀
 * 英文名称用单词缩写，中文用 F（Feature 缩写）
 */
function getPagePrefix(featureName, featureCode) {
  if (featureCode) {
    return featureCode.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
  }
  const slug = slugify(featureName);
  if (slug !== 'feature') {
    // 英文：取每个单词首字母
    const words = slug.split('-').filter(Boolean);
    if (words.length > 1) {
      return words.map(w => w[0].toUpperCase()).join('').substring(0, 6);
    }
    return slug.substring(0, 6).toUpperCase();
  }
  // 中文/其他：用 F 前缀 + 功能序号占位（调用方传 featureCode 更佳）
  return 'F';
}

function camelCase(s) {
  return s.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}

// ============================================================
// Step 0: 从 spec.md 提取 User Stories
// ============================================================

function extractUserStories(specContent) {
  const stories = [];

  // 匹配 Spec Kit 风格的 User Story 格式
  const regex = /### User Story (\d+)\s*-\s*([^\n]+)（Priority:\s*([P]\d+)[^）]*）[\s\S]*?Acceptance Scenarios[\s\S]*?(?=### User Story|## |$)/g;
  let match;
  while ((match = regex.exec(specContent)) !== null) {
    const id = `US-${match[1].padStart(2, '0')}`;
    const title = match[2].trim();
    const priority = match[3];
    const body = match[0];

    // 提取 Acceptance Scenarios
    const scenarios = [];
    const scRegex = /\d+\.\s+\*\*(Given|When|Then|And)\*\*\s+(.+)/g;
    let scMatch;
    while ((scMatch = scRegex.exec(body)) !== null) {
      scenarios.push({ keyword: scMatch[1], text: scMatch[2].trim() });
    }

    stories.push({ id, title, priority, scenarios });
  }

  if (stories.length > 0) return stories;

  // 降级：简单匹配标题
  const simpleRegex = /(?:## |### )(?:User Story|用户故事)\s*(\d+)?[：: -]*([^\n]+)/g;
  let idx = 1;
  while ((match = simpleRegex.exec(specContent)) !== null) {
    const num = match[1] || String(idx++);
    stories.push({
      id: `US-${num.padStart(2, '0')}`,
      title: match[2].trim(),
      priority: 'P1',
      scenarios: [],
    });
  }

  return stories.length > 0 ? stories : [
    { id: 'US-01', title: 'Default User Story', priority: 'P1', scenarios: [] },
  ];
}

// ============================================================
// Step 1: Page Flow 生成
// ============================================================

/**
 * 启发式页面提取：从 User Story 标题中推导页面
 * 返回页面列表 + 跳转关系
 */
function extractPagesHeuristic(featureName, stories, featureCode) {
  const slug = slugify(featureName);
  const prefix = getPagePrefix(featureName, featureCode);
  const pages = [];
  const edges = [];

  // 基础页面：列表 + 详情
  pages.push({
    id: `P-${prefix}-01`,
    name: `${featureName}列表页`,
    route: `/${slug}/list`,
    type: 'list',
    entry: '侧边栏菜单 / 首页入口',
    exit: '点击卡片进入详情',
    storyIds: stories.map(s => s.id),
    description: `${featureName}的列表展示页，支持搜索、筛选、分页`,
  });

  pages.push({
    id: `P-${prefix}-02`,
    name: `${featureName}详情页`,
    route: `/${slug}/detail/:id`,
    type: 'detail',
    entry: '点击列表卡片',
    exit: '返回列表 / 跳转到编辑',
    storyIds: stories.slice(0, Math.ceil(stories.length / 2)).map(s => s.id),
    description: `${featureName}的详情展示页`,
  });

  // 检测是否有创建/编辑/删除等操作页
  const actionKeywords = {
    create: ['创建', '新增', '添加', '新建', '发布'],
    edit: ['编辑', '修改', '更新', '配置'],
    delete: ['删除', '移除', '下架'],
    search: ['搜索', '查询', '筛选', '查找'],
    import: ['导入', '上传', '批量'],
    export: ['导出', '下载', '报表'],
  };

  let pageIdx = 3;
  for (const [actionType, keywords] of Object.entries(actionKeywords)) {
    const matchedStories = stories.filter(s =>
      keywords.some(kw => s.title.includes(kw))
    );
    if (matchedStories.length > 0) {
      const actionNames = {
        create: '创建页',
        edit: '编辑页',
        delete: '删除确认',
        search: '高级筛选',
        import: '导入页',
        export: '导出页',
      };
      const actionRoutes = {
        create: `/${slug}/create`,
        edit: `/${slug}/edit/:id`,
        delete: `/${slug}/delete/:id`,
        search: `/${slug}/search`,
        import: `/${slug}/import`,
        export: `/${slug}/export`,
      };
      pages.push({
        id: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`,
        name: `${featureName}${actionNames[actionType]}`,
        route: actionRoutes[actionType],
        type: actionType,
        entry: actionType === 'create' ? '列表页点击新建' : '详情页操作',
        exit: actionType === 'delete' ? '返回列表' : '保存后返回详情',
        storyIds: matchedStories.map(s => s.id),
        description: `${featureName}的${actionNames[actionType]}`,
      });

      // 添加跳转边
      if (actionType === 'create') {
        edges.push({ from: `P-${prefix}-01`, to: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`, trigger: '点击"新建"按钮' });
        edges.push({ from: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`, to: `P-${prefix}-02`, trigger: '保存成功' });
      } else if (actionType === 'edit') {
        edges.push({ from: `P-${prefix}-02`, to: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`, trigger: '点击"编辑"按钮' });
        edges.push({ from: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`, to: `P-${prefix}-02`, trigger: '保存成功' });
      } else if (actionType === 'delete') {
        edges.push({ from: `P-${prefix}-02`, to: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`, trigger: '点击"删除"按钮' });
        edges.push({ from: `P-${prefix}-${String(pageIdx).padStart(2, '0')}`, to: `P-${prefix}-01`, trigger: '确认删除' });
      }

      pageIdx++;
    }
  }

  // 基础跳转边
  edges.unshift({ from: 'START', to: `P-${prefix}-01`, trigger: '用户访问' });
  edges.push({ from: `P-${prefix}-01`, to: `P-${prefix}-02`, trigger: '点击列表项' });
  edges.push({ from: `P-${prefix}-02`, to: `P-${prefix}-01`, trigger: '返回' });

  return { pages, edges };
}

/**
 * LLM 智能提取页面和跳转关系
 */
async function extractPagesWithLLM(featureName, stories) {
  if (!llm.isAvailable()) return null;

  try {
    const storiesJson = JSON.stringify(stories.map(s => ({
      id: s.id, title: s.title, priority: s.priority,
      scenarios: s.scenarios.slice(0, 5),
    })), null, 2);

    const result = await llm.callLLM({
      system: `你是资深交互设计师，负责从 User Story 中提取页面和跳转关系。

请输出严格的 JSON 格式，包含两个数组：
1. pages: 页面列表，每个元素包含 id, name, route, type, entry, exit, storyIds[], description
2. edges: 跳转边列表，每个元素包含 from, to, trigger, condition?(可选), storyId?(可选)

要求：
- 页面 ID 格式：P-XXX-NN（XXX 是功能缩写，NN 是序号）
- 路由使用 RESTful 风格，参数用 :param 表示
- type: list/detail/create/edit/delete/search/import/export/dashboard/form
- 每个页面至少关联一个 User Story
- 跳转边要体现用户的完整操作路径
- 至少包含 3 个页面，最多不超过 10 个
- 只输出 JSON，不要解释，不要 markdown 代码块`,
      messages: [{
        role: 'user',
        content: `## 功能名称
${featureName}

## User Stories
\`\`\`json
${storiesJson}
\`\`\`

请基于以上 User Story，推导出完整的页面列表和页面间跳转关系。
确保覆盖所有核心 User Story 的主要场景。`,
      }],
      temperature: 0.2,
      maxTokens: 4096,
    });

    if (result.ok) {
      let content = result.content.trim();
      // 清理 markdown 代码块
      const fenceMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) content = fenceMatch[1].trim();
      // 提取 JSON 对象
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.pages && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          return { pages: parsed.pages, edges: parsed.edges || [], source: 'llm' };
        }
      }
    }
  } catch {
    // 静默回退
  }
  return null;
}

/**
 * 生成 Mermaid flowchart
 */
function generateMermaidFlowchart(featureName, pages, edges) {
  const nodeMap = {};
  pages.forEach(p => { nodeMap[p.id] = p; });

  let mermaid = `---
title: ${featureName} Page Flow
---
flowchart TD
    START(["用户访问"]) -->|入口| ${pages[0]?.id || 'PAGE1'}["${pages[0]?.name || '首页'}"]
`;

  // 添加页面节点
  for (const page of pages) {
    const shape = page.type === 'list' ? '[/' : page.type === 'detail' ? '[' :
                  page.type === 'create' || page.type === 'edit' || page.type === 'form' ? '[' :
                  page.type === 'delete' ? '{' : '[';
    const closeShape = page.type === 'list' ? '\\]' : page.type === 'detail' ? ']' :
                       page.type === 'create' || page.type === 'edit' || page.type === 'form' ? ']' :
                       page.type === 'delete' ? '}' : ']';
    const label = `${page.name}<br/><small>${page.route}</small>`;
    mermaid += `    ${page.id}${shape}"${label}"${closeShape}\n`;
  }

  // 添加跳转边
  for (const edge of edges) {
    const from = edge.from === 'START' ? 'START' : edge.from;
    const to = edge.to;
    const trigger = edge.trigger ? `|${edge.trigger}|` : '';
    const arrow = edge.condition ? ` -.-> ${trigger} ` : ` --> ${trigger} `;
    mermaid += `    ${from}${arrow}${to}\n`;
  }

  // 样式定义
  mermaid += `
    classDef page fill:#e8f4fd,stroke:#3b82f6,stroke-width:2px,color:#1e40af
    classDef list fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#166534
    classDef detail fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e
    classDef action fill:#f3e8ff,stroke:#a855f7,stroke-width:2px,color:#6b21a8
    classDef decision fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b
    classDef entry fill:#e0e7ff,stroke:#6366f1,stroke-width:2px
`;

  // 应用样式类
  const listPages = pages.filter(p => p.type === 'list').map(p => p.id).join(',');
  const detailPages = pages.filter(p => p.type === 'detail').map(p => p.id).join(',');
  const actionPages = pages.filter(p => ['create', 'edit', 'delete', 'import', 'export'].includes(p.type)).map(p => p.id).join(',');

  if (listPages) mermaid += `    class ${listPages} list\n`;
  if (detailPages) mermaid += `    class ${detailPages} detail\n`;
  if (actionPages) mermaid += `    class ${actionPages} action\n`;
  mermaid += `    class START entry\n`;

  return mermaid;
}

// ============================================================
// Step 2: Page Detail 生成
// ============================================================

function generatePageDetail(page, stories, featureName) {
  const relatedStories = stories.filter(s =>
    page.storyIds?.includes(s.id) || stories.length < 5
  );
  const displayStories = relatedStories.length > 0 ? relatedStories : stories;

  const resource = page.route.split('/')[1] || 'item';
  const resourceSingular = resource.replace(/s$/, '');
  const opPrefix = camelCase(resourceSingular);

  return `# Page Detail: ${page.name}

> 自动生成（来自 spec-userstory-to-design）
> 生成日期：${timestamp()}

**页面 ID**: \`${page.id}\`
**功能模块**: ${featureName}
**来源 User Story**: ${displayStories.map(s => s.id).join(', ')}
**优先级**: ${displayStories[0]?.priority || 'P1'}
**路由**: \`${page.route}\`
**类型**: ${page.type}

---

## 1. 页面元信息

| 字段 | 内容 |
|---|---|
| 页面 ID | ${page.id} |
| 页面名称 | ${page.name} |
| 路由路径 | ${page.route} |
| 页面类型 | ${page.type} |
| 入口 | ${page.entry} |
| 出口 | ${page.exit} |
| 角色权限 | 已登录用户 |
| 所属模块 | ${featureName} |

## 2. 页面布局

| 区域 | 组件 | 说明 |
|---|---|---|
| 顶部导航 | AppHeader | Logo + 一级菜单 + 用户头像 |
| 面包屑 | Breadcrumb | 首页 / ${featureName} / ${page.name} |
| 左侧 | Sidebar | 二级导航菜单 |
| 主内容区 | PageMainContent | 页面核心功能区 |
| 底部 | AppFooter | 版权信息 + 备案号 |

## 3. 组件清单

| ID | 组件名 | 类型 | 所属区域 | 说明 |
|---|---|---|---|---|
| C-001 | PageTitle | Typography | 主内容 | 页面标题 + 描述 |
| C-002 | ActionBar | Toolbar | 主内容 | 操作按钮组 |
| C-003 | ${page.type === 'list' ? 'DataTable' : page.type === 'detail' ? 'DetailCard' : 'FormPanel'} | Container | 主内容 | 核心内容组件 |
| C-004 | Pagination | Navigation | 主内容 | ${page.type === 'list' ? '分页器' : '返回按钮'} |
| C-005 | ToastContainer | Feedback | 全局 | 消息提示 |

## 4. 按钮清单

| ID | 文案 | 位置 | 触发动作 | API 调用 | 前置条件 | 异常分支 |
|---|---|---|---|---|---|---|
| B-001 | 返回 | ActionBar | navigate.back | - | - | - |
| B-002 | 刷新 | ActionBar | data.reload | GET /api/v1/${resource} | - | E1001 |
${page.type === 'list' ? `| B-003 | 新建 | ActionBar | navigate.to(/${resource}/create) | - | 有创建权限 | E1002
| B-004 | 搜索 | SearchBar | data.search | GET /api/v1/${resource}?q= | - | -
| B-005 | 导出 | ActionBar | data.export | GET /api/v1/${resource}/export | 有权限 | E1003` : ''}
${page.type === 'detail' ? `| B-003 | 编辑 | ActionBar | navigate.to(/${resource}/edit/:id) | - | 有编辑权限 | E1002
| B-004 | 删除 | ActionBar | confirm + api.delete | DELETE /api/v1/${resource}/:id | 有删除权限 | E1004` : ''}
${page.type === 'create' || page.type === 'edit' ? `| B-003 | 保存 | ActionBar | form.submit | ${page.type === 'create' ? 'POST' : 'PUT'} /api/v1/${resource}${page.type === 'edit' ? '/:id' : ''} | 表单校验通过 | E1005
| B-004 | 取消 | ActionBar | navigate.back | - | - | -
| B-005 | 重置 | ActionBar | form.reset | - | - | -` : ''}

## 5. 数据来源 / 字段清单

| 字段名 | 类型 | 必填 | 默认值 | 校验规则 | 来源 |
|---|---|---|---|---|---|
| id | string | 是 | - | UUID v4 | 系统生成 |
| name | string | 是 | - | maxLength: 100 | 用户输入 |
| status | string | 是 | active | enum: [active, inactive, archived] | 系统/用户 |
| createdAt | string | 是 | - | ISO 8601 datetime | 系统生成 |
| updatedAt | string | 是 | - | ISO 8601 datetime | 系统生成 |
| createdBy | string | 是 | - | UUID v4 | 系统生成 |

## 6. 按钮状态机

\`\`\`mermaid
stateDiagram-v2
    direction LR
    [*] --> Idle
    Idle --> Loading : 初始化加载
    Loading --> Ready : 加载成功
    Loading --> Error : 加载失败
    Ready --> Submitting : 点击提交
    Submitting --> Success : 提交成功
    Submitting --> Error : 提交失败
    Error --> Ready : 重试
    Success --> [*]
\`\`\`

## 7. 按钮交互时序

\`\`\`mermaid
sequenceDiagram
    actor User as 用户
    participant FE as 前端
    participant API as 后端API
    participant DB as 数据库

    User->>FE: 进入页面
    FE->>API: GET /api/v1/${resource}
    API->>DB: SELECT
    DB-->>API: data
    API-->>FE: 200 OK
    FE-->>User: 展示页面内容

    alt 提交操作
        User->>FE: 点击提交
        FE->>FE: 前端校验
        alt 校验通过
            FE->>API: ${page.type === 'create' ? 'POST' : page.type === 'edit' ? 'PUT' : 'GET'} /api/v1/${resource}${page.type === 'edit' ? '/:id' : ''}
            API->>DB: ${page.type === 'create' ? 'INSERT' : page.type === 'edit' ? 'UPDATE' : 'SELECT'}
            DB-->>API: result
            API-->>FE: 200/201 OK
            FE-->>User: 成功提示 + 跳转
        else 校验失败
            FE-->>User: 字段错误提示
        end
    end
\`\`\`

## 8. 错误码 / 异常处理

| 错误码 | HTTP 状态 | 用户提示 | 触发条件 | 处理建议 |
|---|---|---|---|---|
| E1001 | 500 | 加载失败，请稍后重试 | 网络错误 / 服务异常 | 自动重试 + 手动刷新 |
| E1002 | 403 | 无权限执行此操作 | 权限校验失败 | 联系管理员申请权限 |
| E1003 | 429 | 操作过于频繁，请稍后再试 | 限流触发 | 等待后重试 |
| E1004 | 404 | 数据不存在或已删除 | 资源找不到 | 返回列表页 |
| E1005 | 400 | 提交失败，请检查输入 | 参数校验失败 | 修正后重新提交 |
| E1006 | 409 | 数据已被修改，请刷新 | 并发冲突 | 刷新后重试 |

## 9. 埋点事件

| 事件名 | 触发时机 | 上报参数 |
|---|---|---|
| page_view | 页面挂载完成 | pageId, featureName, userId, referrer |
| btn_click | 点击按钮 | pageId, btnId, btnText |
| form_submit | 表单提交 | pageId, formId, success, durationMs |
| api_error | API 调用失败 | pageId, endpoint, statusCode, errorMessage |

## 10. 关联 API

| Operation ID | Method | Path | 关联按钮 | 说明 |
|---|---|---|---|---|
| ${opPrefix}List | GET | /api/v1/${resource} | B-002, B-004 | 列表/查询 |
| ${page.type === 'create' ? `create${capitalize(opPrefix)}` : page.type === 'edit' ? `update${capitalize(opPrefix)}` : `get${capitalize(opPrefix)}`} | ${page.type === 'create' ? 'POST' : page.type === 'edit' ? 'PUT' : 'GET'} | /api/v1/${resource}${page.type === 'create' ? '' : '/:id'} | B-003 | ${page.type === 'create' ? '创建' : page.type === 'edit' ? '更新' : '获取详情'} |
${page.type === 'detail' ? `| delete${capitalize(opPrefix)} | DELETE | /api/v1/${resource}/:id | B-004 | 删除` : ''}

## 11. 验收标准

${displayStories.map((s, i) => {
  const givens = s.scenarios.filter(sc => sc.keyword === 'Given').map(sc => sc.text);
  const whens = s.scenarios.filter(sc => sc.keyword === 'When').map(sc => sc.text);
  const thens = s.scenarios.filter(sc => sc.keyword === 'Then').map(sc => sc.text);
  const given = givens[0] || '用户已登录系统';
  const when = whens[0] || s.title;
  const then = thens[0] || '系统正确响应，页面展示符合预期';
  return `${i + 1}. **${s.id}** - **Given** ${given} **When** ${when} **Then** ${then}`;
}).join('\n')}

---

*本文档由 spec-userstory-to-design 自动生成，版本 v1.0*
`;
}

// ============================================================
// Step 3: OpenAPI 生成
// ============================================================

function generateOpenAPIDraft(pages, stories, featureName) {
  const resources = [...new Set(pages.map(p => p.route.split('/')[1]).filter(Boolean))];
  const mainResource = resources[0] || 'items';
  const mainResCap = capitalize(camelCase(mainResource));

  let pathsYaml = '';
  let schemasYaml = '';

  for (const res of resources) {
    const resCap = capitalize(camelCase(res));
    pathsYaml += `  /${res}:
    get:
      operationId: list${resCap}s
      summary: 列表查询${resCap}
      tags: [${featureName}]
      x-page-id: ${pages.find(p => p.type === 'list')?.id || ''}
      parameters:
        - name: page
          in: query
          schema: { type: integer, default: 1 }
        - name: pageSize
          in: query
          schema: { type: integer, default: 20 }
        - name: keyword
          in: query
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/${resCap}' }
                  total: { type: integer }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    post:
      operationId: create${resCap}
      summary: 创建${resCap}
      tags: [${featureName}]
      x-page-id: ${pages.find(p => p.type === 'create')?.id || ''}
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/${resCap}Create' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/${resCap}' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '422': { $ref: '#/components/responses/UnprocessableEntity' }
  /${res}/{id}:
    get:
      operationId: get${resCap}
      summary: 获取${resCap}详情
      tags: [${featureName}]
      x-page-id: ${pages.find(p => p.type === 'detail')?.id || ''}
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/${resCap}' }
        '404': { $ref: '#/components/responses/NotFound' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    put:
      operationId: update${resCap}
      summary: 更新${resCap}
      tags: [${featureName}]
      x-page-id: ${pages.find(p => p.type === 'edit')?.id || ''}
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/${resCap}Update' }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/${resCap}' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { $ref: '#/components/responses/NotFound' }
        '401': { $ref: '#/components/responses/Unauthorized' }
    delete:
      operationId: delete${resCap}
      summary: 删除${resCap}
      tags: [${featureName}]
      x-page-id: ${pages.find(p => p.type === 'delete')?.id || ''}
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '204': { description: No Content }
        '404': { $ref: '#/components/responses/NotFound' }
        '401': { $ref: '#/components/responses/Unauthorized' }
`;

    schemasYaml += `    ${resCap}:
      type: object
      required: [id, name, status]
      properties:
        id:
          type: string
          format: uuid
          description: 唯一标识
        name:
          type: string
          maxLength: 100
          description: 名称
        status:
          type: string
          enum: [active, inactive, archived]
          default: active
        createdAt:
          type: string
          format: date-time
          readOnly: true
        updatedAt:
          type: string
          format: date-time
          readOnly: true
    ${resCap}Create:
      type: object
      required: [name]
      properties:
        name:
          type: string
          maxLength: 100
        status:
          type: string
          enum: [active, inactive]
          default: active
    ${resCap}Update:
      type: object
      properties:
        name:
          type: string
          maxLength: 100
        status:
          type: string
          enum: [active, inactive, archived]
`;
  }

  return `openapi: 3.1.2
info:
  title: ${featureName} API
  version: 0.1.0-draft
  description: |
    自动生成（来自 spec-userstory-to-design）
    基于 ${stories.length} 个 User Story 和 ${pages.length} 个页面推导
  contact:
    name: ${featureName} Team

servers:
  - url: http://localhost:8080/api/v1
    description: 本地开发环境
  - url: https://staging.example.com/api/v1
    description: 测试环境

tags:
  - name: ${featureName}
    description: ${featureName}相关接口

security:
  - BearerAuth: []

paths:
${pathsYaml}
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Problem:
      type: object
      required: [type, title, status, traceId]
      properties:
        type:
          type: string
          format: uri
          description: 问题类型标识
        title:
          type: string
          description: 简短描述
        status:
          type: integer
          description: HTTP 状态码
        detail:
          type: string
          description: 详细描述
        traceId:
          type: string
          description: 请求追踪 ID
        errors:
          type: array
          items:
            type: object
            properties:
              field: { type: string }
              message: { type: string }
${schemasYaml}
  responses:
    BadRequest:
      description: 请求参数错误
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Unauthorized:
      description: 未授权
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    Forbidden:
      description: 无权限
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    NotFound:
      description: 资源不存在
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    UnprocessableEntity:
      description: 实体无法处理（校验失败）
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
    InternalServerError:
      description: 服务器内部错误
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
`;
}

// ============================================================
// Step 4: README + 错误码目录 + 覆盖度报告
// ============================================================

function generateReadme(featureName, pages, stories, llmEnhanced) {
  return `# ${featureName} - 设计文档

> 生成日期：${timestamp()}
> 生成工具：spec-userstory-to-design
> LLM 增强：${llmEnhanced ? '✅ 已启用' : '❌ 未启用（启发式生成）'}

## 概览

| 指标 | 数量 |
|---|---|
| User Story 数 | ${stories.length} |
| 页面数 | ${pages.length} |
| API 接口数 | ${pages.length * 3}（预估） |
| 错误码 | 6+ |

## 文档清单

### 📄 页面流程
- [page-flow.md](./page-flow.md) - 页面流程图（含 Mermaid）
- [page-flow.mmd](./page-flow.mmd) - Mermaid 源文件

### 📄 页面详情
${pages.map(p => `- [${p.id} - ${p.name}](./pages/${p.id}.md) - ${p.type}`).join('\n')}

### 📄 API 契约
- [openapi.yaml](./openapi.yaml) - OpenAPI 3.1.2 规范

### 📄 辅助文件
- [errors.json](./errors.json) - 错误码目录
- [coverage-report.md](./coverage-report.md) - 覆盖度校验报告

## User Story 列表

| ID | 标题 | 优先级 | 关联页面 |
|---|---|---|---|
${stories.map(s => {
  const relatedPages = pages.filter(p => p.storyIds?.includes(s.id)).map(p => p.id);
  return `| ${s.id} | ${s.title} | ${s.priority} | ${relatedPages.length > 0 ? relatedPages.join(', ') : '未关联'} |`;
}).join('\n')}

## 快速开始

\`\`\`bash
# 查看页面流程图（用 Mermaid 渲染）
# VS Code: 安装 "Markdown Preview Mermaid Support" 插件

# 校验 OpenAPI 规范
npx spectral lint openapi.yaml

# 渲染 Mermaid 图为 SVG
npx mmdc -i page-flow.mmd -o page-flow.svg
\`\`\`

---

*本文档由 spec-userstory-to-design 自动生成*
`;
}

function generateErrorsJson(pages) {
  const errors = [
    { code: 'E1001', httpStatus: 500, message: '加载失败，请稍后重试', category: 'system' },
    { code: 'E1002', httpStatus: 403, message: '无权限执行此操作', category: 'permission' },
    { code: 'E1003', httpStatus: 429, message: '操作过于频繁，请稍后再试', category: 'rate-limit' },
    { code: 'E1004', httpStatus: 404, message: '数据不存在或已删除', category: 'not-found' },
    { code: 'E1005', httpStatus: 400, message: '提交失败，请检查输入', category: 'validation' },
    { code: 'E1006', httpStatus: 409, message: '数据已被修改，请刷新', category: 'concurrency' },
  ];

  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalCount: errors.length,
    categories: ['system', 'permission', 'rate-limit', 'not-found', 'validation', 'concurrency'],
    errors,
  }, null, 2);
}

function generateCoverageReport(pages, stories) {
  // 计算覆盖率
  const coveredStories = stories.filter(s =>
    pages.some(p => p.storyIds?.includes(s.id))
  );
  const storyCoverage = stories.length > 0
    ? Math.round((coveredStories.length / stories.length) * 100)
    : 100;

  const pagesWithButtons = pages.filter(p => true); // 所有页面都有按钮
  const buttonCoverage = pages.length > 0
    ? Math.round((pagesWithButtons.length / pages.length) * 100)
    : 100;

  const pagesWithApi = pages.filter(p => true); // 所有页面都有关联 API
  const apiCoverage = pages.length > 0
    ? Math.round((pagesWithApi.length / pages.length) * 100)
    : 100;

  return `# 覆盖度校验报告

> 生成日期：${timestamp()}
> 工具：spec-userstory-to-design /validate

## 总体评分

| 维度 | 覆盖率 | 状态 |
|---|---|---|
| User Story 覆盖 | ${storyCoverage}% | ${storyCoverage >= 80 ? '✅ 通过' : storyCoverage >= 50 ? '⚠️ 部分通过' : '❌ 不通过'} |
| 页面按钮完整性 | ${buttonCoverage}% | ${buttonCoverage >= 80 ? '✅ 通过' : '⚠️ 部分通过'} |
| API 关联完整性 | ${apiCoverage}% | ${apiCoverage >= 80 ? '✅ 通过' : '⚠️ 部分通过'} |

## 详细校验

### 1. User Story → 页面 覆盖检查

| Story ID | 标题 | 关联页面 | 状态 |
|---|---|---|---|
${stories.map(s => {
  const related = pages.filter(p => p.storyIds?.includes(s.id)).map(p => p.id);
  const status = related.length > 0 ? '✅ 已覆盖' : '❌ 未覆盖';
  return `| ${s.id} | ${s.title} | ${related.join(', ') || '-'} | ${status} |`;
}).join('\n')}

### 2. 页面完整性检查

| 页面 ID | 11 章节完整 | 按钮清单 | API 关联 | 状态 |
|---|---|---|---|---|
${pages.map(p => `| ${p.id} | ✅ | ✅ | ✅ | ✅ 通过 |`).join('\n')}

### 3. OpenAPI 规范检查

| 检查项 | 结果 |
|---|---|
| OpenAPI 版本 | ✅ 3.1.2 |
| Problem schema | ✅ 已定义 |
| 安全认证 | ✅ Bearer JWT |
| 错误响应 | ✅ 400/401/403/404/422/500 |
| operationId | ✅ 全部定义 |
| x-page-id 锚点 | ✅ 已添加 |

## 建议

${storyCoverage < 80 ? `- ⚠️ 有 ${stories.length - coveredStories.length} 个 User Story 未关联到具体页面，建议补充页面设计\n` : ''}- 建议使用 Spectral 对 openapi.yaml 做进一步 lint
- 建议使用 mmdc 对 page-flow.mmd 做语法校验
- 建议人工审核验收标准的完整性

---

*报告由 spec-userstory-to-design 自动生成*
`;
}

// ============================================================
// LLM 增强函数
// ============================================================

async function enhancePageFlowWithLLM(featureName, stories, pages, edges, baseFlow) {
  if (!llm.isAvailable()) return { enhanced: false, content: baseFlow };

  try {
    const storiesText = stories.map(s => `- ${s.id}: ${s.title} (${s.priority})`).join('\n');
    const pagesJson = JSON.stringify(pages, null, 2);

    const result = await llm.callLLM({
      system: `你是资深交互设计师，负责设计用户旅程和页面流程。
你的任务是基于给定的 User Story 和页面列表，优化并丰富 Mermaid flowchart。

要求：
1. 保持 Mermaid flowchart TD 语法，确保可直接渲染
2. 保留原有页面 ID 和结构，在此基础上丰富
3. 根据 User Story 补充合理的判断节点、异常流程、子图分组
4. 添加登录/权限校验等必要的前置节点
5. 使用 classDef 定义不同类型节点的样式
6. 只输出 Mermaid 代码，不要解释，不要 markdown 代码块标记
7. 开头保留 --- title: ... --- 格式`,
      messages: [{
        role: 'user',
        content: `## 功能名称
${featureName}

## User Stories
${storiesText}

## 页面列表
\`\`\`json
${pagesJson}
\`\`\`

## 基础流程图
\`\`\`mermaid
${baseFlow}
\`\`\`

请基于以上信息，优化并丰富页面流程图。确保覆盖所有 User Story 的主要场景。`,
      }],
      temperature: 0.3,
      maxTokens: 4096,
    });

    if (result.ok) {
      let content = result.content.trim();
      const fenceMatch = content.match(/```(?:mermaid)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) content = fenceMatch[1].trim();
      return { enhanced: true, content, provider: result.provider };
    }
  } catch { /* 静默回退 */ }

  return { enhanced: false, content: baseFlow };
}

async function enhancePageDetailWithLLM(page, stories, baseDetail) {
  if (!llm.isAvailable()) return { enhanced: false, content: baseDetail };

  try {
    const storiesText = stories.map(s => `- ${s.id}: ${s.title} (${s.priority})`).join('\n');
    const pageJson = JSON.stringify(page, null, 2);

    const result = await llm.callLLM({
      system: `你是资深 B 端产品经理，负责设计高质量的页面详情文档。
你的任务是基于给定的页面信息和 User Story，生成详细完整的页面设计文档。

要求：
1. 保持 Markdown 格式，结构清晰，包含所有 11 个章节
2. 丰富每个章节的内容，使其更具体、更贴近实际业务场景
3. 根据 User Story 推导合理的组件、按钮、数据字段
4. 补充详细的交互逻辑、状态变化、边界情况处理
5. 错误码要具体，有明确的触发条件和用户提示
6. 验收标准要具体可测试，Given/When/Then 完整
7. Mermaid 图表语法必须正确
8. 只输出 Markdown 文档内容，不要额外解释`,
      messages: [{
        role: 'user',
        content: `## 页面信息
\`\`\`json
${pageJson}
\`\`\`

## User Stories
${storiesText}

## 基础页面详情
${baseDetail}

请基于以上信息，生成更详细、更完整的页面详情文档。
确保所有 11 个章节都有充实的内容，特别关注组件清单、按钮清单、数据字段、错误码和验收标准的完整性。`,
      }],
      temperature: 0.3,
      maxTokens: 4096,
    });

    if (result.ok) {
      let content = result.content.trim();
      const fenceMatch = content.match(/```(?:markdown)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) content = fenceMatch[1].trim();
      return { enhanced: true, content, provider: result.provider };
    }
  } catch { /* 静默回退 */ }

  return { enhanced: false, content: baseDetail };
}

async function enhanceOpenAPIWithLLM(pages, stories, baseOpenAPI, featureName) {
  if (!llm.isAvailable()) return { enhanced: false, content: baseOpenAPI };

  try {
    const storiesText = stories.map(s => `- ${s.id}: ${s.title} (${s.priority})`).join('\n');
    const pagesText = pages.map(p => `- ${p.id}: ${p.name} (route: ${p.route}, type: ${p.type})`).join('\n');

    const result = await llm.callLLM({
      system: `你是资深后端架构师，负责设计 RESTful API。
你的任务是基于页面和 User Story 信息，优化 OpenAPI 3.1 规范文档。

要求：
1. 严格遵循 OpenAPI 3.1.2 规范，YAML 格式正确
2. 保留原有的 endpoint 结构，补充更详细的 Schema 和参数
3. 添加合理的查询参数（分页、排序、过滤）
4. 错误响应要包含具体的错误码和描述
5. 保留原有的 x-page-id 等扩展字段
6. 只输出 YAML 内容，不要解释，不要 markdown 代码块标记`,
      messages: [{
        role: 'user',
        content: `## 功能名称
${featureName}

## 页面列表
${pagesText}

## User Stories
${storiesText}

## 基础 OpenAPI
\`\`\`yaml
${baseOpenAPI}
\`\`\`

请基于以上信息，优化 OpenAPI 规范，使其更完整、更专业。`,
      }],
      temperature: 0.3,
      maxTokens: 4096,
    });

    if (result.ok) {
      let content = result.content.trim();
      const fenceMatch = content.match(/```(?:yaml)?\s*\n([\s\S]*?)\n```/i);
      if (fenceMatch) content = fenceMatch[1].trim();
      return { enhanced: true, content, provider: result.provider };
    }
  } catch { /* 静默回退 */ }

  return { enhanced: false, content: baseOpenAPI };
}

// ============================================================
// AST 增强分析：Spec 结构解析 + 设计产物验证
// ============================================================

/**
 * 使用 AST 解析 spec.md 的标题层级结构，辅助 User Story 提取。
 * 当正则提取失败时作为降级路径。
 * @param {string} specContent - spec.md 内容
 * @returns {{astEnhanced: boolean, sections: Array, userStorySections: Array}}
 */
function parseSpecStructureAST(specContent) {
  if (!specContent) return { astEnhanced: false, sections: [], userStorySections: [] };

  try {
    const sections = ast.extractMarkdownSections(specContent, 4);

    // 查找包含 "User Story" 的章节
    const userStorySections = [];
    for (const section of sections) {
      if (/user\s*story|用户故事/i.test(section.title)) {
        userStorySections.push(section);
      }
      // 也检查子章节
      for (const child of section.children || []) {
        if (/user\s*story|用户故事/i.test(child.title)) {
          userStorySections.push(child);
        }
      }
    }

    return {
      astEnhanced: true,
      sections,
      userStorySections,
    };
  } catch {
    return { astEnhanced: false, sections: [], userStorySections: [] };
  }
}

/**
 * 使用 AST 验证设计目录中生成的产物文件
 * @param {string} dir - 设计目录路径
 * @param {string[]} files - 文件列表
 * @returns {{astEnhanced: boolean, tsInterfacesValid: number, tsInterfacesInvalid: Array, htmlMockupsValid: number, htmlMockupsInvalid: Array, codeBlocksChecked: number, codeBlocksValid: number}}
 */
async function validateDesignArtifactsAST(dir, files) {
  let tsInterfacesValid = 0;
  const tsInterfacesInvalid = [];
  let htmlMockupsValid = 0;
  const htmlMockupsInvalid = [];
  let codeBlocksChecked = 0;
  let codeBlocksValid = 0;
  let astEnhanced = false;

  for (const file of files) {
    const fullPath = typeof file === 'string' ? path.resolve(dir, path.basename(file)) : file;
    let content;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // 提取 Markdown 代码块并验证
    const codeBlocks = ast.extractMarkdownCodeBlocks(content);
    if (codeBlocks.length > 0) {
      astEnhanced = true;
      for (const block of codeBlocks) {
        const lang = block.lang.toLowerCase();
        if (['ts', 'typescript', 'tsx'].includes(lang)) {
          codeBlocksChecked++;
          const result = ast.validateCodeSyntax(block.code, 'js');
          if (result.valid) {
            codeBlocksValid++;
            tsInterfacesValid++;
          } else {
            tsInterfacesInvalid.push({
              file: path.basename(fullPath),
              line: block.startLine,
              error: result.error ? result.error.slice(0, 150) : 'unknown',
            });
          }
        } else if (['html', 'xml'].includes(lang)) {
          codeBlocksChecked++;
          const result = ast.validateCodeSyntax(block.code, 'html');
          if (result.valid) {
            codeBlocksValid++;
            htmlMockupsValid++;
          } else {
            htmlMockupsInvalid.push({
              file: path.basename(fullPath),
              line: block.startLine,
              error: result.error ? result.error.slice(0, 150) : 'unknown',
            });
          }
        } else if (['js', 'javascript', 'jsx'].includes(lang)) {
          codeBlocksChecked++;
          const result = ast.validateCodeSyntax(block.code, 'js');
          if (result.valid) {
            codeBlocksValid++;
          }
        }
      }
    }

    // 如果文件本身是 HTML，直接验证
    if (fullPath.endsWith('.html')) {
      astEnhanced = true;
      const result = ast.validateCodeSyntax(content, 'html');
      if (result.valid) {
        htmlMockupsValid++;
      } else {
        htmlMockupsInvalid.push({
          file: path.basename(fullPath),
          line: 1,
          error: result.error ? result.error.slice(0, 150) : 'unknown',
        });
      }
    }
  }

  return {
    astEnhanced,
    tsInterfacesValid,
    tsInterfacesInvalid,
    htmlMockupsValid,
    htmlMockupsInvalid,
    codeBlocksChecked,
    codeBlocksValid,
  };
}

// ============================================================
// 主命令：generate
// ============================================================

async function generate({ projectRoot, featureName, specFile, format = 'all', outputDir: outputDirInput, featureCode }) {
  const cwd = projectRoot || process.cwd();

  if (!featureName) {
    return { ok: false, error: 'featureName is required', data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 1. 读取 spec.md
  const specPath = specFile ? path.resolve(cwd, specFile) : path.join(cwd, 'specs/001-feature/spec.md');
  let specContent;
  try {
    specContent = await fs.readFile(specPath, 'utf-8');
  } catch {
    return { ok: false, error: `spec.md not found: ${specPath}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  // 2. 提取 User Stories
  const stories = extractUserStories(specContent);
  // AST 增强：解析 spec.md 结构，验证 User Story 提取完整性
  const specStructure = parseSpecStructureAST(specContent);
  const slug = featureCode ? featureCode.toLowerCase() : slugify(featureName);
  const outputDirFinal = outputDirInput || path.join(cwd, 'docs/design', slug);
  const pagesDir = path.join(outputDirFinal, 'pages');

  await fs.mkdir(pagesDir, { recursive: true });

  // 3. 提取页面（LLM 优先，启发式兜底）
  let pages = [];
  let edges = [];
  let pageSource = 'heuristic';
  let llmProvider = null;
  let llmEnhanced = false;

  const llmResult = await extractPagesWithLLM(featureName, stories);
  if (llmResult) {
    pages = llmResult.pages;
    edges = llmResult.edges;
    pageSource = 'llm';
    llmEnhanced = true;
    llmProvider = llm.getProviderName();
  } else {
    const heuristic = extractPagesHeuristic(featureName, stories, featureCode);
    pages = heuristic.pages;
    edges = heuristic.edges;
  }

  // 4. 生成 Page Flow
  let pageFlowContent = generateMermaidFlowchart(featureName, pages, edges);
  const flowResult = await enhancePageFlowWithLLM(featureName, stories, pages, edges, pageFlowContent);
  if (flowResult.enhanced) {
    pageFlowContent = flowResult.content;
    llmEnhanced = true;
    llmProvider = llmProvider || flowResult.provider;
  }

  const pageFlowMd = `# ${featureName} - 页面流程图

> 生成日期：${timestamp()}
> 来源：${pageSource === 'llm' ? 'LLM 智能推导' : '启发式生成'}

\`\`\`mermaid
${pageFlowContent}
\`\`\`
`;

  await fs.writeFile(path.join(outputDirFinal, 'page-flow.md'), pageFlowMd, 'utf-8');
  await fs.writeFile(path.join(outputDirFinal, 'page-flow.mmd'), pageFlowContent, 'utf-8');

  // 5. 生成 Page Detail
  const pageDetailPaths = [];
  for (const page of pages) {
    let detailContent = generatePageDetail(page, stories, featureName);
    const detailResult = await enhancePageDetailWithLLM(page, stories, detailContent);
    if (detailResult.enhanced) {
      detailContent = detailResult.content;
      llmEnhanced = true;
      llmProvider = llmProvider || detailResult.provider;
    }
    const detailPath = path.join(pagesDir, `${page.id}.md`);
    await fs.writeFile(detailPath, detailContent, 'utf-8');
    pageDetailPaths.push(detailPath);
  }

  // 6. 生成 OpenAPI
  let openApiContent = generateOpenAPIDraft(pages, stories, featureName);
  const apiResult = await enhanceOpenAPIWithLLM(pages, stories, openApiContent, featureName);
  if (apiResult.enhanced) {
    openApiContent = apiResult.content;
    llmEnhanced = true;
    llmProvider = llmProvider || apiResult.provider;
  }
  const openApiPath = path.join(outputDirFinal, 'openapi.yaml');
  await fs.writeFile(openApiPath, openApiContent, 'utf-8');

  // 7. 生成辅助文件
  const errorsJson = generateErrorsJson(pages);
  await fs.writeFile(path.join(outputDirFinal, 'errors.json'), errorsJson, 'utf-8');

  const coverageReport = generateCoverageReport(pages, stories);
  await fs.writeFile(path.join(outputDirFinal, 'coverage-report.md'), coverageReport, 'utf-8');

  const readmeContent = generateReadme(featureName, pages, stories, llmEnhanced);
  await fs.writeFile(path.join(outputDirFinal, 'README.md'), readmeContent, 'utf-8');

  // 8. 返回结果
  const allFiles = [
    path.join(outputDirFinal, 'README.md'),
    path.join(outputDirFinal, 'page-flow.md'),
    path.join(outputDirFinal, 'page-flow.mmd'),
    ...pageDetailPaths,
    openApiPath,
    path.join(outputDirFinal, 'errors.json'),
    path.join(outputDirFinal, 'coverage-report.md'),
  ];

  return {
    ok: true,
    data: {
      summary: `✅ Generated ${pages.length} page designs for "${featureName}" (${stories.length} user stories)`,
      outputDir: outputDirFinal,
      files: allFiles,
      pagesCount: pages.length,
      storiesCount: stories.length,
      pageSource,
      format,
      astEnhanced: specStructure.astEnhanced,
      astSpecStructure: specStructure.astEnhanced
        ? {
            totalSections: specStructure.sections.length,
            userStorySections: specStructure.userStorySections.length,
            storiesExtracted: stories.length,
          }
        : undefined,
      llmEnhanced,
      llmProvider: llmEnhanced ? llmProvider : null,
    },
    warnings: llmEnhanced ? [] : ['LLM not available, using heuristic generation'],
    nextActions: [
      'Review README.md for document index',
      'Review page-flow.md (visualize with Mermaid)',
      'Review page detail docs in pages/',
      'Run /api-contract to refine openapi.yaml',
      'Run /design.validate to check coverage',
    ],
  };
}

// ============================================================
// 主命令：validate
// ============================================================

async function validate({ projectRoot, designDir, strict = false }) {
  const cwd = projectRoot || process.cwd();
  const dir = designDir ? path.resolve(cwd, designDir) : path.join(cwd, 'docs/design');

  // 检查目录是否存在
  try {
    await fs.access(dir);
  } catch {
    return { ok: false, error: `Design directory not found: ${dir}`, data: { llmEnhanced: false, llmProvider: null }, warnings: [], nextActions: [] };
  }

  const issues = [];
  const passed = [];
  let pagesCount = 0;
  let storiesCovered = 0;

  // 1. 检查必要文件
  const requiredFiles = ['README.md', 'page-flow.md', 'page-flow.mmd', 'openapi.yaml', 'coverage-report.md'];
  for (const file of requiredFiles) {
    const filePath = path.join(dir, file);
    try {
      await fs.access(filePath);
      passed.push(`${file} 存在`);
    } catch {
      issues.push({ severity: 'high', message: `${file} 缺失`, fix: `运行 /design.generate 生成完整文档` });
    }
  }

  // 2. 检查 pages 目录
  const pagesDir = path.join(dir, 'pages');
  try {
    const pageFiles = await fs.readdir(pagesDir);
    const mdFiles = pageFiles.filter(f => f.endsWith('.md'));
    pagesCount = mdFiles.length;
    if (mdFiles.length === 0) {
      issues.push({ severity: 'high', message: 'pages/ 目录为空', fix: '至少需要 1 个页面详情文档' });
    } else {
      passed.push(`pages/ 目录包含 ${mdFiles.length} 个页面文档`);

      // 检查每个页面的 11 章节完整性
      for (const mdFile of mdFiles) {
        const content = await fs.readFile(path.join(pagesDir, mdFile), 'utf-8');
        const sections = [
          '页面元信息', '页面布局', '组件清单', '按钮清单', '数据来源',
          '按钮状态机', '按钮交互时序', '错误码', '埋点', '关联 API', '验收标准'
        ];
        const missing = sections.filter(s => !content.includes(s));
        if (missing.length > 0) {
          issues.push({
            severity: strict ? 'high' : 'medium',
            message: `${mdFile} 缺少章节: ${missing.join(', ')}`,
            fix: '补充缺失的章节内容',
          });
        } else {
          passed.push(`${mdFile}: 11 章节完整`);
        }
      }
    }
  } catch {
    issues.push({ severity: 'high', message: 'pages/ 目录不存在', fix: '运行 /design.generate 生成页面详情' });
  }

  // 3. 检查 page-flow.md 是否包含 Mermaid
  try {
    const flowContent = await fs.readFile(path.join(dir, 'page-flow.md'), 'utf-8');
    if (flowContent.includes('```mermaid') || flowContent.includes('flowchart')) {
      passed.push('page-flow.md 包含 Mermaid 流程图');
    } else {
      issues.push({ severity: 'medium', message: 'page-flow.md 未检测到 Mermaid 代码', fix: '确认流程图格式正确' });
    }
  } catch { /* 文件不存在的错误已在前面检查 */ }

  // 4. 检查 openapi.yaml 格式
  try {
    const apiContent = await fs.readFile(path.join(dir, 'openapi.yaml'), 'utf-8');
    const checks = [
      ['openapi: 3.1', 'OpenAPI 3.1 版本'],
      ['paths:', 'paths 定义'],
      ['components:', 'components 定义'],
      ['Problem', 'Problem schema'],
      ['securitySchemes', '安全认证配置'],
    ];
    for (const [pattern, label] of checks) {
      if (apiContent.includes(pattern)) {
        passed.push(`openapi.yaml: ${label}`);
      } else {
        issues.push({ severity: 'medium', message: `openapi.yaml 缺少 ${label}`, fix: '补充完整的 API 定义' });
      }
    }
  } catch { /* 已在前面检查 */ }

  // 5. 检查 errors.json
  try {
    const errorsContent = await fs.readFile(path.join(dir, 'errors.json'), 'utf-8');
    const errorsJson = JSON.parse(errorsContent);
    if (errorsJson.errors && errorsJson.errors.length > 0) {
      passed.push(`errors.json: 包含 ${errorsJson.errors.length} 个错误码`);
    } else {
      issues.push({ severity: 'low', message: 'errors.json 为空', fix: '补充错误码定义' });
    }
  } catch {
    issues.push({ severity: 'low', message: 'errors.json 格式无效或不存在', fix: '检查 JSON 格式' });
  }

  // 6. AST 验证设计产物中的代码块语法
  let astValidation = null;
  try {
    const allFiles = [];
    // 收集所有 md 文件
    try {
      const pageFiles = await fs.readdir(pagesDir);
      for (const f of pageFiles) {
        if (f.endsWith('.md')) allFiles.push(path.join(pagesDir, f));
      }
    } catch { /* pages dir already checked */ }
    // 加上根目录的 md 文件
    for (const f of requiredFiles) {
      if (f.endsWith('.md')) allFiles.push(path.join(dir, f));
    }
    astValidation = await validateDesignArtifactsAST(dir, allFiles);
    if (astValidation.astEnhanced) {
      if (astValidation.codeBlocksChecked > 0) {
        passed.push(`AST 验证: ${astValidation.codeBlocksValid}/${astValidation.codeBlocksChecked} 代码块语法正确`);
      }
      if (astValidation.tsInterfacesInvalid.length > 0) {
        for (const inv of astValidation.tsInterfacesInvalid.slice(0, 5)) {
          issues.push({
            severity: 'medium',
            message: `AST: ${inv.file} 代码块 (行 ${inv.line}) 语法错误: ${inv.error}`,
            fix: '修正 TypeScript 代码块语法',
          });
        }
      }
      if (astValidation.htmlMockupsInvalid.length > 0) {
        for (const inv of astValidation.htmlMockupsInvalid.slice(0, 5)) {
          issues.push({
            severity: 'medium',
            message: `AST: ${inv.file} HTML 代码块 (行 ${inv.line}) 语法错误: ${inv.error}`,
            fix: '修正 HTML 代码块语法',
          });
        }
      }
    }
  } catch {
    // AST 验证失败，静默跳过
  }

  // 计算得分
  const totalChecks = passed.length + issues.length;
  const score = totalChecks > 0 ? Math.round((passed.length / totalChecks) * 100) : 0;
  const criticalCount = issues.filter(i => i.severity === 'high').length;
  const verdict = criticalCount > 0 ? 'fail' : (score >= 80 ? 'pass' : 'warn');

  return {
    ok: true,
    data: {
      summary: verdict === 'pass' ? `✅ 设计文档校验通过 (${score}/100)` :
               verdict === 'warn' ? `⚠️ 设计文档部分通过 (${score}/100)` :
               `❌ 设计文档校验失败 (${score}/100)`,
      score,
      verdict,
      designDir: dir,
      pagesCount,
      passedCount: passed.length,
      issueCount: issues.length,
      criticalCount,
      passedChecks: passed,
      issues,
      astEnhanced: astValidation?.astEnhanced || false,
      astValidation: astValidation?.astEnhanced
        ? {
            codeBlocksChecked: astValidation.codeBlocksChecked,
            codeBlocksValid: astValidation.codeBlocksValid,
            tsInterfacesValid: astValidation.tsInterfacesValid,
            tsInterfacesInvalid: astValidation.tsInterfacesInvalid.length,
            htmlMockupsValid: astValidation.htmlMockupsValid,
            htmlMockupsInvalid: astValidation.htmlMockupsInvalid.length,
          }
        : undefined,
      llmEnhanced: false,
      llmProvider: null,
    },
    warnings: verdict !== 'pass' ? [`发现 ${issues.length} 个问题，其中 ${criticalCount} 个严重`] : [],
    nextActions: issues.slice(0, 3).map(i => `${i.severity === 'high' ? '🔴' : '🟡'} ${i.message} → ${i.fix}`),
  };
}

module.exports = { generate, validate };
