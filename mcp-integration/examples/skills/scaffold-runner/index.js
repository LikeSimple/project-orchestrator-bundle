/**
 * scaffold-runner Skill - 实际 CLI 实现
 *
 * 调用官方脚手架工具或内置模板生成可运行工程。
 * 对应 MCP Tool: scaffold_run
 *
 * LLM 增强：
 *   - run: LLM 根据项目描述推荐最佳模板和配置，生成后优化入口文件
 *   - list: 无 LLM 增强
 *   - inspect: LLM 分析模板适用场景和最佳实践
 *   - custom: LLM 生成自定义模板内容 / 从目录读取模板并变量替换
 *   - enhance: 用 LLM 优化现有项目中的指定文件
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

// LLM 客户端（不可用时静默降级）
let llm = null;
try {
  llm = require('../../lib/llm-client');
} catch {
  llm = null;
}

// AST 解析器（用于生成代码的语法验证）
const ast = require('../../lib/ast-parser');

// ============================================================
// 第一部分：模板引擎 (Template Engine)
// ============================================================

/**
 * 简单模板引擎
 * 支持：
 *   - {{variable}}          变量替换
 *   - {{#if condition}}     条件块开始
 *     ...
 *     {{#else}}             可选 else
 *     ...
 *     {{/if}}               条件块结束
 *   - {{#each items}}       列表渲染开始
 *     {{this}} 或 {{item}} 当前项
 *     {{@index}}            索引
 *     ...
 *     {{/each}}             列表渲染结束
 *   - 内置变量：projectName, author, date, version, year 等
 */

const TemplateEngine = {
  /**
   * 渲染模板字符串
   * @param {string} template - 模板内容
   * @param {Object} vars - 变量对象
   * @returns {string} 渲染后的字符串
   */
  render(template, vars) {
    if (typeof template !== 'string') return String(template);
    let result = template;

    // 1. 处理 {{#each}} 块
    result = this._renderEach(result, vars);

    // 2. 处理 {{#if}} 块
    result = this._renderIf(result, vars);

    // 3. 处理变量替换 {{variable}}
    result = this._renderVariables(result, vars);

    return result;
  },

  /**
   * 渲染 {{#each}} 列表块
   */
  _renderEach(template, vars) {
    const eachRegex = /{{#each\s+(\w+)}}([\s\S]*?){{\/each}}/g;
    return template.replace(eachRegex, (match, listName, innerTemplate) => {
      const list = vars[listName];
      if (!Array.isArray(list)) return '';

      return list.map((item, index) => {
        const itemVars = {
          ...vars,
          this: item,
          item: item,
          '@index': index,
          '@first': index === 0,
          '@last': index === list.length - 1,
        };
        // 如果 item 是对象，展开其属性
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          Object.assign(itemVars, item);
        }
        // 递归渲染内部
        let rendered = innerTemplate;
        rendered = this._renderIf(rendered, itemVars);
        rendered = this._renderVariables(rendered, itemVars);
        return rendered;
      }).join('');
    });
  },

  /**
   * 渲染 {{#if}} 条件块
   */
  _renderIf(template, vars) {
    // 支持嵌套 if - 从最内层开始处理
    let result = template;
    const ifRegex = /{{#if\s+([^}]+)}}((?:(?!{{#if\s+)[\s\S])*?){{\/if}}/g;

    let prev;
    do {
      prev = result;
      result = result.replace(ifRegex, (match, condition, body) => {
        // 检查是否有 else
        const elseMatch = body.match(/^(.*?){{#else}}([\s\S]*)$/);
        const trueBody = elseMatch ? elseMatch[1] : body;
        const falseBody = elseMatch ? elseMatch[2] : '';

        const condValue = this._evaluateCondition(condition.trim(), vars);
        return condValue ? trueBody : falseBody;
      });
    } while (result !== prev);

    return result;
  },

  /**
   * 评估条件表达式
   * 支持：变量名（truthy/falsy）、==、!=、&&、||、!
   */
  _evaluateCondition(condition, vars) {
    // 简单的条件解析
    // 处理 OR
    if (condition.includes('||')) {
      return condition.split('||').some(part => this._evaluateCondition(part.trim(), vars));
    }
    // 处理 AND
    if (condition.includes('&&')) {
      return condition.split('&&').every(part => this._evaluateCondition(part.trim(), vars));
    }
    // 处理 NOT
    if (condition.startsWith('!')) {
      return !this._evaluateCondition(condition.slice(1).trim(), vars);
    }
    // 处理 == 比较
    const eqMatch = condition.match(/^(\w+)\s*==\s*(.+)$/);
    if (eqMatch) {
      const left = vars[eqMatch[1]];
      const rightRaw = eqMatch[2].trim();
      const right = rightRaw.startsWith('"') && rightRaw.endsWith('"')
        ? rightRaw.slice(1, -1)
        : rightRaw === 'true' ? true : rightRaw === 'false' ? false : vars[rightRaw];
      return left == right;
    }
    // 处理 != 比较
    const neqMatch = condition.match(/^(\w+)\s*!=\s*(.+)$/);
    if (neqMatch) {
      const left = vars[neqMatch[1]];
      const rightRaw = neqMatch[2].trim();
      const right = rightRaw.startsWith('"') && rightRaw.endsWith('"')
        ? rightRaw.slice(1, -1)
        : rightRaw === 'true' ? true : rightRaw === 'false' ? false : vars[rightRaw];
      return left != right;
    }
    // 简单变量真值判断
    return !!vars[condition];
  },

  /**
   * 渲染变量替换 {{variable}}
   */
  _renderVariables(template, vars) {
    return template.replace(/{{\s*([@\w.]+)\s*}}/g, (match, varName) => {
      // 支持点路径访问，如 user.name
      const parts = varName.split('.');
      let value = vars;
      for (const part of parts) {
        if (value == null) return '';
        value = value[part];
      }
      if (value === undefined || value === null) return '';
      return String(value);
    });
  },
};

// ============================================================
// 第二部分：参数校验系统
// ============================================================

const Validators = {
  /**
   * 校验项目名称
   * @param {string} name - 项目名称
   * @param {object} opts - { allowUpperCase: boolean } 非 npm 项目（.NET/Java/Flutter）允许大写
   */
  validateProjectName(name, opts = {}) {
    if (!name || name.trim() === '') {
      return { valid: false, error: '项目名称不能为空', suggestion: '请提供一个有效的项目名称，如 my-app' };
    }
    if (name === '.') return { valid: true };

    if (name.length > 214) {
      return { valid: false, error: '项目名称过长（不能超过 214 个字符）', suggestion: '缩短项目名称' };
    }

    if (opts.allowUpperCase) {
      // .NET / Java / Flutter 等允许 PascalCase 和 camelCase
      if (!/^[a-zA-Z0-9-][a-zA-Z0-9._-]*$/.test(name)) {
        return { valid: false, error: '项目名称格式不合法', suggestion: '只能包含字母、数字、连字符、点和下划线' };
      }
    } else {
      // npm 包名规则：仅小写
      if (name !== name.toLowerCase()) {
        return { valid: false, error: '项目名称不能包含大写字母', suggestion: '使用小写字母，如 my-app' };
      }
      if (!/^[a-z0-9-][a-z0-9._-]*$/.test(name)) {
        return { valid: false, error: '项目名称格式不合法', suggestion: '只能包含小写字母、数字、连字符、点和下划线，且不能以特殊字符开头' };
      }
    }
    if (/^[._-]/.test(name)) {
      return { valid: false, error: '项目名称不能以 . _ - 开头', suggestion: '使用字母或数字开头' };
    }
    return { valid: true };
  },

  /**
   * 校验模板是否存在
   */
  validateTemplate(name, templates) {
    if (!name) {
      return { valid: false, error: '模板名称不能为空', suggestion: `可用模板：${Object.keys(templates).join(', ')}` };
    }
    if (!templates[name]) {
      return { valid: false, error: `模板不存在：${name}`, suggestion: `可用模板：${Object.keys(templates).join(', ')}` };
    }
    return { valid: true };
  },

  /**
   * 校验目标目录
   */
  async validateTargetDir(dir, force = false) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) {
        const files = await fs.readdir(dir);
        if (files.length > 0 && !force) {
          return {
            valid: false,
            error: '目标目录不为空',
            suggestion: '使用 --force 选项覆盖，或选择一个空目录/新目录名',
          };
        }
      }
      return { valid: true };
    } catch {
      // 目录不存在，没问题
      return { valid: true };
    }
  },

  /**
   * 校验包管理器
   */
  validatePackageManager(pm) {
    const valid = ['npm', 'pnpm', 'yarn', 'bun'];
    if (!pm) return { valid: true }; // 可选，有默认值
    if (!valid.includes(pm)) {
      return { valid: false, error: `不支持的包管理器：${pm}`, suggestion: `可选值：${valid.join(', ')}` };
    }
    return { valid: true };
  },

  /**
   * 必填字段检查
   */
  validateRequired(params, requiredFields) {
    const missing = [];
    for (const field of requiredFields) {
      if (params[field] === undefined || params[field] === null || params[field] === '') {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      return { valid: false, error: `缺少必填字段：${missing.join(', ')}`, suggestion: '请补充上述必填参数' };
    }
    return { valid: true };
  },
};

// ============================================================
// 第三部分：内置模板库
// ============================================================

/**
 * 每个模板定义：
 *   name: 模板标识
 *   category: 分类（frontend/fullstack/library/testing）
 *   description: 描述
 *   params: 可配置参数 [{name, description, default, required}]
 *   files: 文件定义数组 [{path, content}]
 *   installCommand: 安装命令（可选）
 *   devCommand: 开发命令（可选）
 */

const TEMPLATES = {
  // ---------- 前端框架 ----------
  'react-vite': {
    name: 'react-vite',
    category: 'frontend',
    description: 'React + Vite + TypeScript 项目模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-react-app', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A React + Vite project', required: false },
      { name: 'router', description: '是否包含 React Router', default: true, required: false },
      { name: 'state', description: '状态管理（none/zustand/redux）', default: 'zustand', required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "description": "{{description}}",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"{{#if router}},
    "react-router-dom": "^6.26.0"{{/if}}{{#if state == "zustand"}},
    "zustand": "^4.5.4"{{/if}}{{#if state == "redux"}},
    "@reduxjs/toolkit": "^2.2.7",
    "react-redux": "^9.1.2"{{/if}}
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.0",
    "eslint": "^8.57.0"
  }
}
`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
})
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
`,
      },
      {
        path: 'tsconfig.node.json',
        content: `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{projectName}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.tsx',
        content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
{{#if router}}
import { BrowserRouter } from 'react-router-dom'
{{/if}}
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
{{#if router}}
    <BrowserRouter>
      <App />
    </BrowserRouter>
{{/if}}
{{#if !router}}
    <App />
{{/if}}
  </StrictMode>,
)
`,
      },
      {
        path: 'src/App.tsx',
        content: `{{#if router}}
import { Routes, Route, Link } from 'react-router-dom'
import Home from './pages/Home'
import About from './pages/About'

function App() {
  return (
    <div className="app">
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </div>
  )
}
{{/if}}
{{#if !router}}
import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <h1>{{projectName}}</h1>
      <button onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
      <p>Edit <code>src/App.tsx</code> and save to test HMR</p>
    </div>
  )
}
{{/if}}

export default App
`,
      },
      {
        path: 'src/index.css',
        content: `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

#root {
  width: 100%;
  margin: 0 auto;
  text-align: center;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}

button:hover {
  border-color: #646cff;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`,
      },
      {
        path: 'src/vite-env.d.ts',
        content: `/// <reference types="vite/client" />
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
dist-ssr
*.local
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`,
      },
      {
        path: 'src/pages/Home.tsx',
        content: `export default function Home() {
  return (
    <div>
      <h1>Home Page</h1>
      <p>Welcome to {{projectName}}</p>
    </div>
  )
}
`,
      },
      {
        path: 'src/pages/About.tsx',
        content: `export default function About() {
  return (
    <div>
      <h1>About Page</h1>
      <p>About {{projectName}}</p>
    </div>
  )
}
`,
      },
    ],
    installCommand: 'pnpm install',
    devCommand: 'pnpm dev',
  },

  'vue3-vite': {
    name: 'vue3-vite',
    category: 'frontend',
    description: 'Vue 3 + Vite + TypeScript 项目模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-vue-app', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A Vue 3 + Vite project', required: false },
      { name: 'router', description: '是否包含 Vue Router', default: true, required: false },
      { name: 'pinia', description: '是否包含 Pinia 状态管理', default: true, required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "description": "{{description}}",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.37"{{#if router}},
    "vue-router": "^4.4.3"{{/if}}{{#if pinia}},
    "pinia": "^2.2.1"{{/if}}
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.2",
    "typescript": "^5.5.3",
    "vite": "^5.4.0",
    "vue-tsc": "^2.0.29"
  }
}
`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
})
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
`,
      },
      {
        path: 'tsconfig.node.json',
        content: `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{projectName}}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.ts',
        content: `import { createApp } from 'vue'
{{#if pinia}}
import { createPinia } from 'pinia'
{{/if}}
{{#if router}}
import router from './router'
{{/if}}
import App from './App.vue'
import './style.css'

const app = createApp(App)

{{#if pinia}}
app.use(createPinia())
{{/if}}
{{#if router}}
app.use(router)
{{/if}}

app.mount('#app')
`,
      },
      {
        path: 'src/App.vue',
        content: `<template>
  <div class="app">
{{#if router}}
    <nav>
      <RouterLink to="/">Home</RouterLink>
      <RouterLink to="/about">About</RouterLink>
    </nav>
    <RouterView />
{{/if}}
{{#if !router}}
    <h1>{{ projectName }}</h1>
    <p>Welcome to your Vue 3 app</p>
{{/if}}
  </div>
</template>

<script setup lang="ts">
// App component
</script>

<style scoped>
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}
</style>
`,
      },
      {
        path: 'src/style.css',
        content: `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

#app {
  width: 100%;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
}
`,
      },
      {
        path: 'src/vite-env.d.ts',
        content: `/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
dist-ssr
*.local
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`,
      },
    ],
    installCommand: 'pnpm install',
    devCommand: 'pnpm dev',
  },

  'next-app': {
    name: 'next-app',
    category: 'frontend',
    description: 'Next.js App Router + TypeScript 项目模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-next-app', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A Next.js project', required: false },
      { name: 'tailwind', description: '是否包含 Tailwind CSS', default: true, required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "private": true,
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "description": "{{description}}",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "@types/node": "^20.14.14",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.5"{{#if tailwind}},
    "tailwindcss": "^3.4.8",
    "postcss": "^8.4.41",
    "autoprefixer": "^10.4.20"{{/if}}
  }
}
`,
      },
      {
        path: 'next.config.mjs',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

export default nextConfig
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`,
      },
      {
        path: 'next-env.d.ts',
        content: `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`,
      },
      {
        path: 'src/app/layout.tsx',
        content: `import type { Metadata } from 'next'
{{#if tailwind}}
import './globals.css'
{{/if}}
{{#if !tailwind}}
import './globals.css'
{{/if}}

export const metadata: Metadata = {
  title: '{{projectName}}',
  description: '{{description}}',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
      },
      {
        path: 'src/app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">{{projectName}}</h1>
      <p className="mt-4 text-lg text-gray-600">{{description}}</p>
      <p className="mt-8">Get started by editing <code className="font-mono">src/app/page.tsx</code></p>
    </main>
  )
}
`,
      },
      {
        path: 'src/app/globals.css',
        content: `{{#if tailwind}}
@tailwind base;
@tailwind components;
@tailwind utilities;
{{/if}}
{{#if !tailwind}}
:root {
  --max-width: 1100px;
  --border-radius: 12px;
  --font-mono: ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono',
    'Roboto Mono', 'Oxygen Mono', 'Ubuntu Monospace', 'Fira Mono',
    'Droid Sans Mono', 'Courier New', monospace;
}

* {
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

html,
body {
  max-width: 100vw;
  overflow-x: hidden;
}

body {
  color: rgb(var(--foreground-rgb));
  background: #fff;
}

a {
  color: inherit;
  text-decoration: none;
}
{{/if}}
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
.next
out
build
dist
.env*.local
*.log
.DS_Store
*.pem
.vscode
.idea
`,
      },
    ],
    installCommand: 'pnpm install',
    devCommand: 'pnpm dev',
  },

  'nuxt-app': {
    name: 'nuxt-app',
    category: 'frontend',
    description: 'Nuxt 3 + TypeScript 项目模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-nuxt-app', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A Nuxt 3 project', required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "private": true,
  "type": "module",
  "version": "0.0.1",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "description": "{{description}}",
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {},
  "devDependencies": {
    "nuxt": "^3.12.4",
    "vue": "^3.4.37",
    "vue-router": "^4.4.3",
    "typescript": "^5.5.4"
  }
}
`,
      },
      {
        path: 'nuxt.config.ts',
        content: `// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  typescript: {
    strict: true,
  },
  app: {
    head: {
      title: '{{projectName}}',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '{{description}}' },
      ],
    },
  },
})
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "extends": "./.nuxt/tsconfig.json"
}
`,
      },
      {
        path: 'app.vue',
        content: `<template>
  <div>
    <NuxtWelcome />
  </div>
</template>

<script setup lang="ts">
// Root component
</script>
`,
      },
      {
        path: 'pages/index.vue',
        content: `<template>
  <div class="container">
    <h1>Welcome to {{ projectName }}</h1>
    <p>{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
const projectName = '{{projectName}}'
const description = '{{description}}'
</script>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}
</style>
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
.nuxt
.output
.nitro
.cache
dist
.env
.env.*
!.env.example
*.log
.DS_Store
.vscode
.idea
`,
      },
    ],
    installCommand: 'pnpm install',
    devCommand: 'pnpm dev',
  },

  // ---------- 全栈框架 ----------
  'express-api': {
    name: 'express-api',
    category: 'fullstack',
    description: 'Express + TypeScript REST API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-express-api', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'An Express REST API', required: false },
      { name: 'port', description: '服务端口', default: 3000, required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/morgan": "^1.9.9",
    "@types/node": "^20.14.14",
    "typescript": "^5.5.4",
    "tsx": "^4.17.0"
  }
}
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
      },
      {
        path: 'src/index.ts',
        content: `import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || {{port}};

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.get('/api', (_req, res) => {
  res.json({
    message: 'Welcome to {{projectName}} API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      users: 'GET /api/users',
    },
  });
});

// Users example route
app.get('/api/users', (_req, res) => {
  res.json([
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ]);
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(\`🚀 Server running on http://localhost:\${PORT}\`);
  console.log(\`📊 Health check: http://localhost:\${PORT}/health\`);
});

export default app;
`,
      },
      {
        path: '.env.example',
        content: `PORT={{port}}
NODE_ENV=development
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
.env
.env.local
*.log
.DS_Store
.vscode
.idea
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
\`\`\`

## Environment Variables

Copy \`.env.example\` to \`.env\` and modify as needed.

## API Endpoints

- \`GET /health\` - Health check
- \`GET /api\` - API info
- \`GET /api/users\` - List users (example)
`,
      },
    ],
    installCommand: 'npm install',
    devCommand: 'npm run dev',
  },

  'nestjs-api': {
    name: 'nestjs-api',
    category: 'fullstack',
    description: 'NestJS + TypeScript API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-nest-api', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A NestJS API project', required: false },
      { name: 'port', description: '服务端口', default: 3000, required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "0.0.1",
  "description": "{{description}}",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "private": true,
  "license": "MIT",
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "nest start",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "test": "jest",
    "test:cov": "jest --coverage"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.2",
    "@nestjs/schematics": "^10.1.3",
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.14",
    "jest": "^29.7.0",
    "source-map-support": "^0.5.21",
    "ts-jest": "^29.2.4",
    "ts-loader": "^9.5.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.4"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\\\.spec\\\\.ts$",
    "transform": { "^.+\\\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}
`,
      },
      {
        path: 'nest-cli.json',
        content: `{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const port = process.env.PORT || {{port}};
  await app.listen(port);
  console.log(\`🚀 {{projectName}} API running on http://localhost:\${port}\`);
}

bootstrap();
`,
      },
      {
        path: 'src/app.module.ts',
        content: `import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`,
      },
      {
        path: 'src/app.controller.ts',
        content: `import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
`,
      },
      {
        path: 'src/app.service.ts',
        content: `import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello from {{projectName}}!';
  }
}
`,
      },
      {
        path: 'src/users/users.module.ts',
        content: `import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
`,
      },
      {
        path: 'src/users/users.controller.ts',
        content: `import { Controller, Get, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }
}
`,
      },
      {
        path: 'src/users/users.service.ts',
        content: `import { Injectable } from '@nestjs/common';

interface User {
  id: number;
  name: string;
  email: string;
}

@Injectable()
export class UsersService {
  private users: User[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];

  findAll() {
    return this.users;
  }

  findOne(id: number) {
    return this.users.find(u => u.id === id);
  }
}
`,
      },
      {
        path: '.env.example',
        content: `PORT={{port}}
NODE_ENV=development
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
coverage
.env
.env.local
*.log
.DS_Store
.vscode
.idea
`,
      },
    ],
    installCommand: 'npm install',
    devCommand: 'npm run dev',
  },

  'koa-api': {
    name: 'koa-api',
    category: 'fullstack',
    description: 'Koa + TypeScript API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-koa-api', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A Koa REST API', required: false },
      { name: 'port', description: '服务端口', default: 3000, required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "koa": "^2.15.3",
    "@koa/router": "^12.0.1",
    "koa-bodyparser": "^4.4.1",
    "koa-cors": "^0.0.16",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/koa": "^2.15.0",
    "@types/koa__router": "^12.0.4",
    "@types/koa-bodyparser": "^4.3.12",
    "@types/node": "^20.14.14",
    "typescript": "^5.5.4",
    "tsx": "^4.17.0"
  }
}
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
      },
      {
        path: 'src/index.ts',
        content: `import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import dotenv from 'dotenv';

dotenv.config();

const app = new Koa();
const router = new Router();
const PORT = process.env.PORT || {{port}};

// Middleware
app.use(bodyParser());

// Error handling
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err: any) {
    ctx.status = err.status || 500;
    ctx.body = { error: err.message || 'Internal Server Error' };
    ctx.app.emit('error', err, ctx);
  }
});

// Health check
router.get('/health', (ctx) => {
  ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
});

// API info
router.get('/api', (ctx) => {
  ctx.body = {
    message: 'Welcome to {{projectName}} API',
    version: '1.0.0',
  };
});

// Users example
router.get('/api/users', (ctx) => {
  ctx.body = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];
});

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  console.log(\`🚀 Server running on http://localhost:\${PORT}\`);
});
`,
      },
      {
        path: '.env.example',
        content: `PORT={{port}}
NODE_ENV=development
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
.env
.env.local
*.log
.DS_Store
`,
      },
    ],
    installCommand: 'npm install',
    devCommand: 'npm run dev',
  },

  // ---------- 工具库 ----------
  'ts-lib': {
    name: 'ts-lib',
    category: 'library',
    description: 'TypeScript 库项目模板（发布 npm 包）',
    params: [
      { name: 'projectName', description: '项目/包名称', default: 'my-ts-lib', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A TypeScript library', required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src --ext .ts",
    "prepublishOnly": "npm run build"
  },
  "keywords": [],
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^20.14.14"
  }
}
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
`,
      },
      {
        path: 'src/index.ts',
        content: `/**
 * {{projectName}} - {{description}}
 * @module
 */

export * from './greeting';
`,
      },
      {
        path: 'src/greeting.ts',
        content: `/**
 * Generate a greeting message
 * @param name - The name to greet
 * @returns A greeting string
 */
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

/**
 * Generate a farewell message
 * @param name - The name to say goodbye to
 * @returns A farewell string
 */
export function farewell(name: string): string {
  return \`Goodbye, \${name}!\`;
}
`,
      },
      {
        path: 'src/greeting.test.ts',
        content: `import { describe, it, expect } from 'vitest';
import { greet, farewell } from './greeting';

describe('greet', () => {
  it('should return a greeting with the name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });
});

describe('farewell', () => {
  it('should return a farewell with the name', () => {
    expect(farewell('World')).toBe('Goodbye, World!');
  });
});
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

> {{description}}

## Installation

\`\`\`bash
npm install {{projectName}}
\`\`\`

## Usage

\`\`\`ts
import { greet } from '{{projectName}}';

console.log(greet('World')); // Hello, World!
\`\`\`

## Development

\`\`\`bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
\`\`\`

## License

MIT
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
coverage
*.log
.DS_Store
.vscode
.idea
`,
      },
    ],
    installCommand: 'npm install',
    devCommand: 'npm run dev',
  },

  'node-cli': {
    name: 'node-cli',
    category: 'library',
    description: 'Node.js CLI 工具模板',
    params: [
      { name: 'projectName', description: 'CLI 工具名称', default: 'my-cli', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A Node.js CLI tool', required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "bin": {
    "{{projectName}}": "dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "lint": "eslint src --ext .ts",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["cli"],
  "license": "MIT",
  "dependencies": {
    "commander": "^12.1.0",
    "chalk": "^4.1.2"
  },
  "devDependencies": {
    "@types/node": "^20.14.14",
    "typescript": "^5.5.4",
    "tsx": "^4.17.0",
    "vitest": "^2.0.5"
  }
}
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
`,
      },
      {
        path: 'src/index.ts',
        content: `#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { version } from '../package.json';

const program = new Command();

program
  .name('{{projectName}}')
  .description('{{description}}')
  .version(version);

program
  .command('greet <name>')
  .description('Greet someone')
  .option('-c, --caps', 'Display in uppercase')
  .action((name: string, options: { caps?: boolean }) => {
    let message = \`Hello, \${name}!\`;
    if (options.caps) {
      message = message.toUpperCase();
    }
    console.log(chalk.green(message));
  });

program
  .command('info')
  .description('Show information about {{projectName}}')
  .action(() => {
    console.log(chalk.blue('{{projectName}}') + chalk.gray(\` v\${version}\`));
    console.log('{{description}}');
  });

program.parse();
`,
      },
      {
        path: 'src/utils.test.ts',
        content: `import { describe, it, expect } from 'vitest';

// Example test
describe('basic test', () => {
  it('should work', () => {
    expect(1 + 1).toBe(2);
  });
});
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

> {{description}}

## Installation

\`\`\`bash
npm install -g {{projectName}}
\`\`\`

## Usage

\`\`\`bash
# Greet someone
{{projectName}} greet World

# Greet in uppercase
{{projectName}} greet World --caps

# Show info
{{projectName}} info
\`\`\`

## Development

\`\`\`bash
# Install dependencies
npm install

# Run locally
npm run dev -- greet World

# Build
npm run build
\`\`\`

## License

MIT
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
coverage
*.log
.DS_Store
`,
      },
    ],
    installCommand: 'npm install',
    devCommand: 'npm run dev',
  },

  // ---------- 测试 ----------
  'vitest-starter': {
    name: 'vitest-starter',
    category: 'testing',
    description: 'Vitest 测试项目模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-tests', required: true },
      { name: 'author', description: '作者', default: '', required: false },
      { name: 'description', description: '项目描述', default: 'A Vitest testing project', required: false },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  {{#if author}}
  "author": "{{author}}",
  {{/if}}
  "type": "module",
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  },
  "devDependencies": {
    "vitest": "^2.0.5",
    "@vitest/coverage-v8": "^2.0.5",
    "typescript": "^5.5.4",
    "@types/node": "^20.14.14"
  }
}
`,
      },
      {
        path: 'vitest.config.ts',
        content: `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,js}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
  },
});
`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"],
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
`,
      },
      {
        path: 'src/math.ts',
        content: `export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Cannot divide by zero');
  }
  return a / b;
}
`,
      },
      {
        path: 'src/math.test.ts',
        content: `import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from './math';

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
    expect(add(-1, 1)).toBe(0);
  });
});

describe('subtract', () => {
  it('subtracts two numbers', () => {
    expect(subtract(5, 3)).toBe(2);
    expect(subtract(1, 1)).toBe(0);
  });
});

describe('multiply', () => {
  it('multiplies two numbers', () => {
    expect(multiply(3, 4)).toBe(12);
    expect(multiply(0, 5)).toBe(0);
  });
});

describe('divide', () => {
  it('divides two numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('throws when dividing by zero', () => {
    expect(() => divide(10, 0)).toThrow('Cannot divide by zero');
  });
});
`,
      },
      {
        path: 'src/string-utils.ts',
        content: `export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function reverse(str: string): string {
  return str.split('').reverse().join('');
}

export function isPalindrome(str: string): boolean {
  const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === reverse(cleaned);
}
`,
      },
      {
        path: 'src/string-utils.test.ts',
        content: `import { describe, it, expect } from 'vitest';
import { capitalize, reverse, isPalindrome } from './string-utils';

describe('capitalize', () => {
  it('capitalizes the first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('returns empty string for empty input', () => {
    expect(capitalize('')).toBe('');
  });
});

describe('reverse', () => {
  it('reverses a string', () => {
    expect(reverse('hello')).toBe('olleh');
  });
});

describe('isPalindrome', () => {
  it('returns true for palindromes', () => {
    expect(isPalindrome('racecar')).toBe(true);
    expect(isPalindrome('A man a plan a canal Panama')).toBe(true);
  });

  it('returns false for non-palindromes', () => {
    expect(isPalindrome('hello')).toBe(false);
  });
});
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
coverage
dist
*.log
.DS_Store
.vscode
`,
      },
    ],
    installCommand: 'npm install',
    devCommand: 'npm test',
  },

  // ============================================================
  // 非前端模板（Java / Python / Go / Rust / Flutter / .NET）
  // ============================================================

  'spring-boot': {
    name: 'spring-boot',
    category: 'fullstack',
    description: 'Spring Boot 3 + Java 17 REST API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-spring-app', required: true },
      { name: 'groupName', description: 'Maven groupId', default: 'com.example', required: false },
      { name: 'description', description: '项目描述', default: 'A Spring Boot REST API', required: false },
      { name: 'port', description: '服务端口', default: 8080, required: false },
      { name: 'javaVersion', description: 'Java 版本', default: 17, required: false },
    ],
    files: [
      {
        path: 'pom.xml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.4</version>
        <relativePath/>
    </parent>
    <groupId>{{groupName}}</groupId>
    <artifactId>{{projectName}}</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>{{projectName}}</name>
    <description>{{description}}</description>
    <properties>
        <java.version>{{javaVersion}}</java.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
`,
      },
      {
        path: 'src/main/java/Application.java',
        content: `package {{groupName}}.{{projectName}};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`,
      },
      {
        path: 'src/main/java/controller/HealthController.java',
        content: `package {{groupName}}.{{projectName}}.controller;

import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
            "status", "ok",
            "timestamp", System.currentTimeMillis()
        );
    }

    @GetMapping("/info")
    public Map<String, Object> info() {
        return Map.of(
            "name", "{{projectName}}",
            "version", "0.0.1",
            "description", "{{description}}"
        );
    }
}
`,
      },
      {
        path: 'src/main/java/controller/UserController.java',
        content: `package {{groupName}}.{{projectName}}.controller;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping
    public List<Map<String, Object>> list() {
        return List.of(
            Map.of("id", 1, "name", "Alice", "email", "alice@example.com"),
            Map.of("id", 2, "name", "Bob", "email", "bob@example.com")
        );
    }

    @GetMapping("/{id}")
    public Map<String, Object> getById(@PathVariable Long id) {
        return Map.of("id", id, "name", "User " + id, "email", "user" + id + "@example.com");
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        return Map.of("id", 3, "name", body.get("name"), "email", body.get("email"));
    }
}
`,
      },
      {
        path: 'src/main/resources/application.yml',
        content: `server:
  port: {{port}}

spring:
  application:
    name: {{projectName}}

management:
  endpoints:
    web:
      exposure:
        include: health,info
`,
      },
      {
        path: 'src/test/java/ApplicationTests.java',
        content: `package {{groupName}}.{{projectName}};

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class ApplicationTests {
    @Test
    void contextLoads() {
    }
}
`,
      },
      {
        path: '.gitignore',
        content: `target/
!.mvn/wrapper/maven-wrapper.jar
!**/src/main/**/target/
!**/src/test/**/target/

### IntelliJ IDEA ###
.idea
*.iws
*.iml
*.ipr

### VS Code ###
.vscode/

### Mac ###
.DS_Store
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Run with Maven
./mvnw spring-boot:run

# Build
./mvnw clean package

# Run JAR
java -jar target/{{projectName}}-0.0.1-SNAPSHOT.jar
\`\`\`

## API Endpoints

- \`GET /api/health\` - Health check
- \`GET /api/info\` - Application info
- \`GET /api/users\` - List users
- \`GET /api/users/{id}\` - Get user by ID
- \`POST /api/users\` - Create user

## Configuration

Edit \`src/main/resources/application.yml\` to change port and settings.
`,
      },
    ],
    installCommand: './mvnw clean install -DskipTests',
    devCommand: './mvnw spring-boot:run',
  },

  'fastapi': {
    name: 'fastapi',
    category: 'fullstack',
    description: 'FastAPI + Python 3.12 REST API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-fastapi', required: true },
      { name: 'description', description: '项目描述', default: 'A FastAPI REST API', required: false },
      { name: 'port', description: '服务端口', default: 8000, required: false },
      { name: 'pythonVersion', description: 'Python 版本', default: '3.12', required: false },
    ],
    files: [
      {
        path: 'pyproject.toml',
        content: `[project]
name = "{{projectName}}"
version = "0.1.0"
description = "{{description}}"
requires-python = ">={{pythonVersion}}"
dependencies = [
    "fastapi[standard]>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.8.0",
    "python-dotenv>=1.0.1",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.27.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
`,
      },
      {
        path: 'src/main.py',
        content: `from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI(
    title="{{projectName}}",
    description="{{description}}",
    version="0.1.0",
)


class UserCreate(BaseModel):
    name: str
    email: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: str


# In-memory store
users_db: dict[int, UserResponse] = {
    1: UserResponse(id=1, name="Alice", email="alice@example.com"),
    2: UserResponse(id=2, name="Bob", email="bob@example.com"),
}


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": os.path.get_terminal_var("TIMESTAMP", "")}


@app.get("/api")
async def root():
    return {
        "message": "Welcome to {{projectName}} API",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/api/users", response_model=list[UserResponse])
async def list_users():
    return list(users_db.values())


@app.get("/api/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int):
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    return users_db[user_id]


@app.post("/api/users", response_model=UserResponse, status_code=201)
async def create_user(user: UserCreate):
    new_id = max(users_db.keys()) + 1
    new_user = UserResponse(id=new_id, name=user.name, email=user.email)
    users_db[new_id] = new_user
    return new_user


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", {{port}})))
`,
      },
      {
        path: 'tests/test_main.py',
        content: `import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_list_users(client):
    response = await client.get("/api/users")
    assert response.status_code == 200
    assert len(response.json()) >= 2


@pytest.mark.asyncio
async def test_create_user(client):
    response = await client.post("/api/users", json={"name": "Charlie", "email": "charlie@example.com"})
    assert response.status_code == 201
    assert response.json()["name"] == "Charlie"
`,
      },
      {
        path: '.env.example',
        content: `PORT={{port}}
DEBUG=true
`,
      },
      {
        path: '.gitignore',
        content: `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
.venv/
*.egg-info/
dist/
build/
.pytest_cache/
.env
.DS_Store
.vscode/
.idea/
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# or .venv\\Scripts\\activate  # Windows

# Install dependencies
pip install -e ".[dev]"

# Run development server
uvicorn src.main:app --reload --port {{port}}

# Run tests
pytest
\`\`\`

## API Endpoints

- \`GET /health\` - Health check
- \`GET /docs\` - Swagger UI (auto-generated)
- \`GET /api/users\` - List users
- \`GET /api/users/{id}\` - Get user by ID
- \`POST /api/users\` - Create user
`,
      },
    ],
    installCommand: 'pip install -e ".[dev]"',
    devCommand: 'uvicorn src.main:app --reload --port 8000',
  },

  'go-api': {
    name: 'go-api',
    category: 'fullstack',
    description: 'Go + Gin REST API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-go-api', required: true },
      { name: 'moduleName', description: 'Go module 名称', default: 'github.com/example/my-go-api', required: false },
      { name: 'description', description: '项目描述', default: 'A Go REST API with Gin', required: false },
      { name: 'port', description: '服务端口', default: 8080, required: false },
    ],
    files: [
      {
        path: 'go.mod',
        content: `module {{moduleName}}

go 1.22

require (
\tgithub.com/gin-gonic/gin v1.10.0
\tgithub.com/google/uuid v1.6.0
)
`,
      },
      {
        path: 'main.go',
        content: `package main

import (
\t"net/http"
\t"os"
\t"strconv"

\t"github.com/gin-gonic/gin"
)

type User struct {
\tID    int    \`json:"id"\`
\tName  string \`json:"name"\`
\tEmail string \`json:"email"\`
}

var users = []User{
\t{ID: 1, Name: "Alice", Email: "alice@example.com"},
\t{ID: 2, Name: "Bob", Email: "bob@example.com"},
}

func main() {
\tr := gin.Default()

\t// Health check
\tr.GET("/health", func(c *gin.Context) {
\t\tc.JSON(http.StatusOK, gin.H{
\t\t\t"status":    "ok",
\t\t\t"timestamp": "now",
\t\t})
\t})

\t// API group
\tapi := r.Group("/api")
\t{
\t\tapi.GET("", func(c *gin.Context) {
\t\t\tc.JSON(http.StatusOK, gin.H{
\t\t\t\t"message": "Welcome to {{projectName}} API",
\t\t\t\t"version": "0.1.0",
\t\t\t})
\t\t})

\t\tapi.GET("/users", func(c *gin.Context) {
\t\t\tc.JSON(http.StatusOK, users)
\t\t})

\t\tapi.GET("/users/:id", func(c *gin.Context) {
\t\t\tid, err := strconv.Atoi(c.Param("id"))
\t\t\tif err != nil {
\t\t\t\tc.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
\t\t\t\treturn
\t\t\t}
\t\t\tfor _, u := range users {
\t\t\t\tif u.ID == id {
\t\t\t\t\tc.JSON(http.StatusOK, u)
\t\t\t\t\treturn
\t\t\t\t}
\t\t\t}
\t\t\tc.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
\t\t})

\t\tapi.POST("/users", func(c *gin.Context) {
\t\t\tvar newUser User
\t\t\tif err := c.ShouldBindJSON(&newUser); err != nil {
\t\t\t\tc.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
\t\t\t\treturn
\t\t\t}
\t\t\tnewUser.ID = len(users) + 1
\t\t\tusers = append(users, newUser)
\t\t\tc.JSON(http.StatusCreated, newUser)
\t\t})
\t}

\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "{{port}}"
\t}
\tr.Run(":" + port)
}
`,
      },
      {
        path: 'main_test.go',
        content: `package main

import (
\t"net/http"
\t"net/http/httptest"
\t"testing"

\t"github.com/gin-gonic/gin"
)

func TestHealthEndpoint(t *testing.T) {
\tgin.SetMode(gin.TestMode)
\tr := gin.Default()
\tr.GET("/health", func(c *gin.Context) {
\t\tc.JSON(http.StatusOK, gin.H{"status": "ok"})
\t})

\treq := httptest.NewRequest("GET", "/health", nil)
\tw := httptest.NewRecorder()
\tr.ServeHTTP(w, req)

\tif w.Code != http.StatusOK {
\t\tt.Errorf("Expected status 200, got %d", w.Code)
\t}
}
`,
      },
      {
        path: '.gitignore',
        content: `# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib
{{projectName}}

# Test binary
*.test

# Output
*.out

# Dependency directories
vendor/

# Environment
.env
*.log

# IDE
.vscode/
.idea/
.DS_Store
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Download dependencies
go mod download

# Run development server
go run main.go

# Build
go build -o {{projectName}}

# Run tests
go test ./...
\`\`\`

## API Endpoints

- \`GET /health\` - Health check
- \`GET /api\` - API info
- \`GET /api/users\` - List users
- \`GET /api/users/:id\` - Get user by ID
- \`POST /api/users\` - Create user
`,
      },
    ],
    installCommand: 'go mod download',
    devCommand: 'go run main.go',
  },

  'rust-api': {
    name: 'rust-api',
    category: 'fullstack',
    description: 'Rust + Axum REST API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my-rust-api', required: true },
      { name: 'description', description: '项目描述', default: 'A Rust REST API with Axum', required: false },
      { name: 'port', description: '服务端口', default: 3000, required: false },
    ],
    files: [
      {
        path: 'Cargo.toml',
        content: `[package]
name = "{{projectName}}"
version = "0.1.0"
edition = "2021"
description = "{{description}}"

[dependencies]
axum = "0.7"
tokio = { version = "1.40", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tower = "0.5"
tower-http = { version = "0.6", features = ["cors", "trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
dotenv = "0.15"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
`,
      },
      {
        path: 'src/main.rs',
        content: `use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::env;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[derive(Serialize, Deserialize, Clone)]
struct User {
    id: u32,
    name: String,
    email: String,
}

#[derive(Deserialize)]
struct CreateUserRequest {
    name: String,
    email: String,
}

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let port: u16 = env::getenv("PORT", "{{port}}".to_string())
        .parse()
        .unwrap_or({{port}});

    let counter = Arc::new(AtomicU32::new(2));
    let users = Arc::new(vec![
        User { id: 1, name: "Alice".to_string(), email: "alice@example.com".to_string() },
        User { id: 2, name: "Bob".to_string(), email: "bob@example.com".to_string() },
    ]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api", get(api_info))
        .route("/api/users", get(list_users).post(create_user))
        .route("/api/users/:id", get(get_user))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(AppState { users, counter });

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!("🚀 Server running on http://localhost:{}", port);
    axum::serve(listener, app).await.unwrap();
}

#[derive(Clone)]
struct AppState {
    users: Arc<Vec<User>>,
    counter: Arc<AtomicU32>,
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

async fn api_info() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "message": "Welcome to {{projectName}} API",
        "version": "0.1.0",
    }))
}

async fn list_users(state: axum::extract::State<AppState>) -> Json<Vec<User>> {
    Json(state.users.as_ref().clone())
}

async fn get_user(
    axum::extract::Path(id): axum::extract::Path<u32>,
    state: axum::extract::State<AppState>,
) -> Result<Json<User>, (axum::http::StatusCode, String)> {
    state
        .users
        .iter()
        .find(|u| u.id == id)
        .cloned()
        .map(Json)
        .ok_or((
            axum::http::StatusCode::NOT_FOUND,
            "User not found".to_string(),
        ))
}

async fn create_user(
    axum::extract::State(mut state): axum::extract::State<AppState>,
    Json(req): Json<CreateUserRequest>,
) -> (axum::http::StatusCode, Json<User>) {
    let id = state.counter.fetch_add(1, Ordering::SeqCst) + 1;
    let user = User {
        id,
        name: req.name,
        email: req.email,
    };
    (axum::http::StatusCode::CREATED, Json(user))
}
`,
      },
      {
        path: '.gitignore',
        content: `/target
Cargo.lock

# IDE
.vscode/
.idea/
*.iml

# OS
.DS_Store
.env
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Build and run
cargo run

# Build release
cargo build --release

# Run tests
cargo test

# Check without building
cargo check
\`\`\`

## API Endpoints

- \`GET /health\` - Health check
- \`GET /api\` - API info
- \`GET /api/users\` - List users
- \`GET /api/users/:id\` - Get user by ID
- \`POST /api/users\` - Create user
`,
      },
    ],
    installCommand: 'cargo build',
    devCommand: 'cargo run',
  },

  'flutter-app': {
    name: 'flutter-app',
    category: 'frontend',
    description: 'Flutter 3 + Dart 3 跨平台应用模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my_flutter_app', required: true },
      { name: 'description', description: '项目描述', default: 'A Flutter cross-platform app', required: false },
      { name: 'orgName', description: '组织名', default: 'com.example', required: false },
    ],
    files: [
      {
        path: 'pubspec.yaml',
        content: `name: {{projectName}}
description: "{{description}}"
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ^3.5.0

dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.2
  provider: ^6.1.2
  shared_preferences: ^2.3.2
  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/
`,
      },
      {
        path: 'lib/main.dart',
        content: `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/app_state.dart';
import 'screens/home_screen.dart';
import 'screens/detail_screen.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (context) => AppState(),
      child: const {{projectName_pascal}}App(),
    ),
  );
}

class {{projectName_pascal}}App extends StatelessWidget {
  const {{projectName_pascal}}App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '{{projectName}}',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      initialRoute: '/',
      routes: {
        '/': (context) => const HomeScreen(),
        '/detail': (context) => const DetailScreen(),
      },
    );
  }
}
`,
      },
      {
        path: 'lib/providers/app_state.dart',
        content: `import 'package:flutter/material.dart';

class AppState extends ChangeNotifier {
  int _counter = 0;
  List<Map<String, dynamic>> _items = [];

  int get counter => _counter;
  List<Map<String, dynamic>> get items => _items;

  void incrementCounter() {
    _counter++;
    notifyListeners();
  }

  void loadItems() {
    _items = [
      {'id': 1, 'title': 'Item 1', 'subtitle': 'Description 1'},
      {'id': 2, 'title': 'Item 2', 'subtitle': 'Description 2'},
      {'id': 3, 'title': 'Item 3', 'subtitle': 'Description 3'},
    ];
    notifyListeners();
  }
}
`,
      },
      {
        path: 'lib/screens/home_screen.dart',
        content: `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AppState>().loadItems();
    });
  }

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('{{projectName}}'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: ListView.builder(
        itemCount: appState.items.length,
        itemBuilder: (context, index) {
          final item = appState.items[index];
          return ListTile(
            title: Text(item['title']),
            subtitle: Text(item['subtitle']),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.pushNamed(context, '/detail'),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: appState.incrementCounter,
        tooltip: 'Increment',
        child: const Icon(Icons.add),
      ),
    );
  }
}
`,
      },
      {
        path: 'lib/screens/detail_screen.dart',
        content: `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';

class DetailScreen extends StatelessWidget {
  const DetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final appState = context.watch<AppState>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Detail'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Counter value:'),
            Text(
              '\${appState.counter}',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          ],
        ),
      ),
    );
  }
}
`,
      },
      {
        path: 'test/widget_test.dart',
        content: `import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:{{projectName}}/main.dart';
import 'package:{{projectName}}/providers/app_state.dart';

void main() {
  testWidgets('HomeScreen renders items', (WidgetTester tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AppState()..loadItems(),
        child: const MaterialApp(home: HomeScreen()),
      ),
    );

    expect(find.text('Item 1'), findsOneWidget);
    expect(find.text('Item 2'), findsOneWidget);
    expect(find.text('Item 3'), findsOneWidget);
  });
}
`,
      },
      {
        path: '.gitignore',
        content: `# Flutter
build/
.dart_tool/
.packages
.flutter-plugins
.flutter-plugins-dependencies
*.iml
.idea/
.vscode/
.pub-cache/
.pub/
ios/Pods/
ios/Flutter/Flutter.framework
android/.gradle/
android/local.properties

# OS
.DS_Store
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Install dependencies
flutter pub get

# Run (debug mode)
flutter run

# Run tests
flutter test

# Build APK
flutter build apk

# Build iOS
flutter build ios
\`\`\`

## Project Structure

- \`lib/main.dart\` - App entry point
- \`lib/providers/\` - State management (Provider pattern)
- \`lib/screens/\` - Screen widgets
- \`test/\` - Widget tests
`,
      },
    ],
    installCommand: 'flutter pub get',
    devCommand: 'flutter run',
  },

  'dotnet-api': {
    name: 'dotnet-api',
    category: 'fullstack',
    description: '.NET 8 + ASP.NET Core Minimal API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'MyDotNetApi', required: true },
      { name: 'description', description: '项目描述', default: 'A .NET 8 Minimal API', required: false },
      { name: 'port', description: '服务端口', default: 5000, required: false },
    ],
    files: [
      {
        path: '{{projectName}}.csproj',
        content: `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>{{projectName}}</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Swashbuckle.AspNetCore" Version="6.7.3" />
  </ItemGroup>

</Project>
`,
      },
      {
        path: 'Program.cs',
        content: `using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Health check
app.MapGet("/health", () => new { status = "ok", timestamp = DateTime.UtcNow })
   .WithTags("System");

// API info
app.MapGet("/api", () => new
{
    message = "Welcome to {{projectName}} API",
    version = "0.1.0",
})
.WithTags("System");

// Users endpoints
var users = new List<User>
{
    new(1, "Alice", "alice@example.com"),
    new(2, "Bob", "bob@example.com"),
};

app.MapGet("/api/users", () => users)
   .WithTags("Users");

app.MapGet("/api/users/{id}", Results<Ok<User>, NotFound> (int id) =>
{
    var user = users.FirstOrDefault(u => u.Id == id);
    return user is not null ? TypedResults.Ok(user) : TypedResults.NotFound();
})
.WithTags("Users");

app.MapPost("/api/users", (User user) =>
{
    user = user with { Id = users.Count + 1 };
    users.Add(user);
    return TypedResults.Created($"/api/users/{user.Id}", user);
})
.WithTags("Users");

app.Run();

record User(int Id, string Name, string Email);
`,
      },
      {
        path: 'appsettings.json',
        content: `{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
`,
      },
      {
        path: 'appsettings.Development.json',
        content: `{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "Microsoft.AspNetCore": "Information"
    }
  }
}
`,
      },
      {
        path: '.gitignore',
        content: `## .NET
bin/
obj/
*.user
*.suo
*.userosscache
*.sln.docstates

## Build results
[Dd]ebug/
[Rr]elease/
*.dll
*.pdb

## Visual Studio
.vs/
*.vspscc
*.vssscc

## JetBrains
.idea/

## OS
.DS_Store
Thumbs.db
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Restore packages
dotnet restore

# Run development server
dotnet run

# Build
dotnet build

# Run tests
dotnet test

# Publish
dotnet publish -c Release -o ./publish
\`\`\`

## API Endpoints

- \`GET /health\` - Health check
- \`GET /api\` - API info
- \`GET /api/users\` - List users
- \`GET /api/users/{id}\` - Get user by ID
- \`POST /api/users\` - Create user
- \`GET /swagger\` - Swagger UI (dev only)
`,
      },
    ],
    installCommand: 'dotnet restore',
    devCommand: 'dotnet run',
  },

  'django-api': {
    name: 'django-api',
    category: 'fullstack',
    description: 'Django 5 + DRF REST API 模板',
    params: [
      { name: 'projectName', description: '项目名称', default: 'my_django', required: true },
      { name: 'description', description: '项目描述', default: 'A Django REST API', required: false },
      { name: 'port', description: '服务端口', default: 8000, required: false },
    ],
    files: [
      {
        path: 'pyproject.toml',
        content: `[project]
name = "{{projectName}}"
version = "0.1.0"
description = "{{description}}"
requires-python = ">=3.12"
dependencies = [
    "django>=5.0",
    "djangorestframework>=3.15",
    "django-cors-headers>=4.4",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-django>=4.8",
]

[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "{{projectName}}.settings"
python_files = ["test_*.py"]
`,
      },
      {
        path: 'manage.py',
        content: `#!/usr/bin/env python
import os
import sys

def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', '{{projectName}}.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError("Couldn't import Django.") from exc
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()
`,
      },
      {
        path: '{{projectName}}/settings.py',
        content: `from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.getenv('SECRET_KEY', 'dev-insecure-key-change-in-production')
DEBUG = os.getenv('DEBUG', 'True') == 'True'
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'rest_framework',
    'corsheaders',
    '{{projectName}}.api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = '{{projectName}}.urls'
WSGI_APPLICATION = '{{projectName}}.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

REST_FRAMEWORK = {
    'DEFAULT_PAGINATION': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}

CORS_ALLOW_ALL_ORIGINS = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
`,
      },
      {
        path: '{{projectName}}/urls.py',
        content: `from django.urls import path, include
from django.http import JsonResponse

urlpatterns = [
    path('health/', lambda r: JsonResponse({'status': 'ok'})),
    path('api/', include('{{projectName}}.api.urls')),
]
`,
      },
      {
        path: '{{projectName}}/api/models.py',
        content: `from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
`,
      },
      {
        path: '{{projectName}}/api/serializers.py',
        content: `from rest_framework import serializers
from .models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = '__all__'
`,
      },
      {
        path: '{{projectName}}/api/views.py',
        content: `from rest_framework import viewsets
from .models import User
from .serializers import UserSerializer

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
`,
      },
      {
        path: '{{projectName}}/api/urls.py',
        content: `from rest_framework.routers import DefaultRouter
from .views import UserViewSet

router = DefaultRouter()
router.register(r'users', UserViewSet)

urlpatterns = router.urls
`,
      },
      {
        path: '{{projectName}}/wsgi.py',
        content: `import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', '{{projectName}}.settings')
application = get_wsgi_application()
`,
      },
      {
        path: '.env.example',
        content: `SECRET_KEY=dev-insecure-key-change-in-production
DEBUG=True
PORT={{port}}
`,
      },
      {
        path: '.gitignore',
        content: `__pycache__/
*.py[cod]
*.egg-info/
db.sqlite3
.venv/
.env
.vscode/
.idea/
.DS_Store
`,
      },
      {
        path: 'README.md',
        content: `# {{projectName}}

{{description}}

## Getting Started

\`\`\`bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Run development server
python manage.py runserver {{port}}

# Run tests
pytest
\`\`\`

## API Endpoints

- \`GET /health/\` - Health check
- \`GET /api/users/\` - List users
- \`POST /api/users/\` - Create user
- \`GET /api/users/{id}/\` - Get user by ID
- \`PUT /api/users/{id}/\` - Update user
- \`DELETE /api/users/{id}/\` - Delete user
`,
      },
    ],
    installCommand: 'pip install -e ".[dev]"',
    devCommand: 'python manage.py runserver',
  },
};

// ============================================================
// 第四部分：内部工具函数
// ============================================================

/**
 * 安全调用 LLM 生成代码，失败时静默返回 null
 */
async function safeGenerateCode(opts) {
  if (!llm || !llm.isAvailable()) return null;
  try {
    const result = await llm.generateCode(opts);
    if (result.ok && result.code) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取 LLM provider 名称
 */
function getLlmProvider() {
  if (!llm || !llm.isAvailable()) return null;
  try {
    return llm.getProvider?.() || llm.provider || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 递归读取目录下所有文件，返回相对路径列表
 */
async function readDirRecursive(dir, baseDir = dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const subFiles = await readDirRecursive(fullPath, baseDir);
      results.push(...subFiles);
    } else {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * 确保目录存在
 */
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * 生成内置变量
 */
function buildBuiltinVars(customVars = {}) {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    year: now.getFullYear(),
    time: now.toISOString(),
    version: '1.0.0',
    platform: process.platform,
    nodeVersion: process.version,
    ...customVars,
  };
}

/**
 * 构造统一返回结构
 */
function makeResult(
  ok,
  data = null,
  error = null,
  warnings = [],
  llmEnhanced = false,
  nextActions = []
) {
  const provider = llmEnhanced ? getLlmProvider() : null;
  const result = {
    ok,
    error: ok ? null : error,
    data: {
      ...(data || {}),
      llmEnhanced,
      llmProvider: provider,
    },
    warnings,
    nextActions,
  };
  return result;
}

// ============================================================
// 第五部分：list - 列出可用模板
// ============================================================

/**
 * 列出所有可用模板，按类别分组
 */
// ============================================================
// AST 增强分析：生成代码语法验证
// ============================================================

/**
 * 使用 AST 验证生成的代码文件语法是否正确
 * @param {string} outputDir - 生成项目的输出目录
 * @param {string[]} generatedFiles - 已生成的文件列表
 * @returns {{astEnhanced: boolean, validFiles: number, invalidFiles: Array, totalChecked: number}}
 */
async function validateGeneratedFilesAST(outputDir, generatedFiles) {
  let validFiles = 0;
  const invalidFiles = [];
  let totalChecked = 0;

  for (const relPath of generatedFiles) {
    // 只检查 JS/TS/HTML/CSS 文件
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|html|css|scss)$/.test(relPath)) continue;

    const fullPath = path.join(outputDir, relPath);
    let content;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    totalChecked++;

    // 根据扩展名确定语言
    let lang = 'auto';
    if (/\.(html?)$/.test(relPath)) lang = 'html';
    else if (/\.css$/.test(relPath)) lang = 'css';
    else lang = 'js';

    const result = ast.validateCodeSyntax(content, lang);
    if (result.valid) {
      validFiles++;
    } else {
      invalidFiles.push({
        file: relPath,
        language: result.language,
        error: result.error ? result.error.slice(0, 200) : 'unknown error',
      });
    }
  }

  return {
    astEnhanced: totalChecked > 0,
    validFiles,
    invalidFiles,
    totalChecked,
  };
}

async function list(options = {}) {
  const templates = Object.values(TEMPLATES);
  const category = options.category;

  const categories = {};
  for (const t of templates) {
    if (category && t.category !== category) continue;
    if (!categories[t.category]) {
      categories[t.category] = [];
    }
    categories[t.category].push(t);
  }

  const categoryLabels = {
    frontend: '前端框架',
    fullstack: '全栈框架',
    library: '工具库',
    testing: '测试',
  };

  const templateList = Object.entries(categories).map(([cat, items]) => ({
    category: cat,
    categoryLabel: categoryLabels[cat] || cat,
    templates: items.map(t => ({
      name: t.name,
      description: t.description,
      params: t.params.map(p => ({
        name: p.name,
        description: p.description,
        default: p.default,
        required: p.required,
      })),
    })),
  }));

  return makeResult(
    true,
    {
      summary: `找到 ${templates.length} 个模板${category ? `（${categoryLabels[category] || category}分类）` : ''}`,
      total: templates.length,
      categories: templateList,
    },
    null,
    [],
    false,
    ['使用 scaffold inspect <template> 查看模板详情', '使用 scaffold run <template> 生成项目']
  );
}

// ============================================================
// 第六部分：inspect - 查看模板详情
// ============================================================

/**
 * 查看模板详情：文件结构、参数、适用场景
 */
async function inspect({ name, template, options = {} }) {
  const templateName = name || template;
  const validation = Validators.validateTemplate(templateName, TEMPLATES);
  if (!validation.valid) {
    return makeResult(false, null, validation.error, [validation.suggestion || '']);
  }

  const tpl = TEMPLATES[templateName];
  const allFiles = tpl.files || [];
  const fileTree = buildFileTree(allFiles.map(f => f.path));

  // LLM 增强：分析模板适用场景和最佳实践
  let llmEnhanced = false;
  let llmAnalysis = null;

  if (options.llmEnhance !== false) {
    const llmResult = await safeGenerateCode({
      taskDescription: `分析以下脚手架模板的适用场景和最佳实践：

模板名称：${tpl.name}
分类：${tpl.category}
描述：${tpl.description}
文件数量：${allFiles.length}
主要文件：${allFiles.slice(0, 10).map(f => f.path).join(', ')}

请用 Markdown 格式输出：
1. 适用场景（什么时候应该使用这个模板）
2. 不适用场景（什么时候不应该使用）
3. 最佳实践建议（使用这个模板时的最佳实践）
4. 扩展建议（如何在模板基础上扩展功能）`,
      language: 'markdown',
      targetFile: 'template-analysis.md',
    });
    if (llmResult && llmResult.code) {
      llmEnhanced = true;
      llmAnalysis = llmResult.code;
    }
  }

  return makeResult(
    true,
    {
      summary: `模板 ${tpl.name} 详情（${allFiles.length} 个文件）`,
      name: tpl.name,
      category: tpl.category,
      description: tpl.description,
      params: tpl.params,
      fileCount: allFiles.length,
      files: allFiles.map(f => ({
        path: f.path,
        size: f.content?.length || 0,
      })),
      fileTree,
      installCommand: tpl.installCommand || null,
      devCommand: tpl.devCommand || null,
      llmAnalysis,
    },
    null,
    [],
    llmEnhanced,
    [`使用 scaffold run ${tpl.name} 生成项目`]
  );
}

/**
 * 构建文件树结构
 */
function buildFileTree(paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = i === parts.length - 1 ? null : {};
      }
      if (i < parts.length - 1) {
        current = current[part];
      }
    }
  }
  return treeObjectToArray(root);
}

function treeObjectToArray(obj) {
  return Object.entries(obj)
    .sort(([a], [b]) => {
      // 目录排在前面
      const aIsDir = obj[a] !== null;
      const bIsDir = obj[b] !== null;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    })
    .map(([name, children]) => ({
      name,
      type: children === null ? 'file' : 'directory',
      children: children ? treeObjectToArray(children) : undefined,
    }));
}

// ============================================================
// 第七部分：run - 运行脚手架（增强版）
// ============================================================

// 保留原有的官方脚手架命令映射
const SCAFFOLD_COMMANDS = {
  'react-vite':    (pm) => `${pm} create vite@latest {dir} -- --template react-ts`,
  'vue-vite':      (pm) => `${pm} create vue@latest {dir} -- --typescript --router --pinia --vitest`,
  'nextjs':        (pm) => `${pm} create next-app@latest {dir} --typescript --eslint --app --src-dir --import-alias "@/*" --no-tailwind`,
  'nuxt':          (pm) => `npx nuxi@latest init {dir}`,
  'nest':          (pm) => `npx @nestjs/cli@latest new {dir} --package-manager ${pm}`,
  'spring-boot':   (pm, dir) => `curl -G https://start.spring.io/starter.zip -d type=maven-project -d language=java -d bootVersion=3.4.0 -d baseDir=. -d groupId=com.example -d artifactId=${path.basename(dir)} -o ${dir}.zip && unzip -o ${dir}.zip && rm ${dir}.zip`,
  'fastapi':       (pm, dir) => `pip install fastapi[standard] && mkdir -p ${dir}`,
  'dotnet-webapi': (pm, dir) => `dotnet new webapi -n ${path.basename(dir)} --framework net9.0`,
  'rust':          (pm, dir) => `cargo init --bin --name ${path.basename(dir)} ${dir}`,
  'flutter':       (pm, dir) => `flutter create ${dir} --org com.example --platforms=android,ios`,
  'expo':          (pm, dir) => `${pm} create expo-app@latest ${dir} --template tabs`,
  'python-lib':    (pm, dir) => `pip install cookiecutter && cookiecutter gh:audreyr/cookiecutter-pypackage --no-input project_name=${path.basename(dir)}`,
};

// 各技术栈在脚手架生成后，LLM 需要优化的关键入口文件
const STACK_ENTRY_FILES = {
  'react-vite': ['src/App.tsx', 'src/main.tsx', 'src/index.css'],
  'vue-vite': ['src/App.vue', 'src/main.ts', 'src/style.css'],
  'nextjs': ['src/app/page.tsx', 'src/app/layout.tsx', 'src/app/globals.css'],
  'nuxt': ['app.vue', 'layouts/default.vue'],
  'nest': ['src/main.ts', 'src/app.controller.ts', 'src/app.service.ts', 'src/app.module.ts'],
  'spring-boot': ['src/main/java/com/example/DemoApplication.java'],
  'fastapi': ['main.py'],
  'rust': ['src/main.rs'],
};

const STACK_LANGUAGE = {
  'react-vite': 'typescript',
  'vue-vite': 'typescript',
  'nextjs': 'typescript',
  'nuxt': 'typescript',
  'nest': 'typescript',
  'spring-boot': 'java',
  'fastapi': 'python',
  'dotnet-webapi': 'csharp',
  'rust': 'rust',
  'flutter': 'dart',
  'expo': 'typescript',
  'python-lib': 'python',
};

/**
 * run 命令 - 运行脚手架（增强版）
 *
 * 支持两种模式：
 * 1. 内置模板模式：stack/template 是 TEMPLATES 中的模板名
 * 2. 官方脚手架模式：stack 是 SCAFFOLD_COMMANDS 中的脚手架名
 *
 * 优先使用内置模板（不依赖外部 CLI，速度更快）
 */
async function run(params) {
  const {
    stack,
    template,
    name,
    packageManager = 'pnpm',
    projectName: pn,
    projectRoot,
    options = {},
  } = params;

  // 兼容 stack 和 template 参数名
  const templateName = template || stack;
  const projectName = name || pn || '.';

  // 参数校验
  if (!templateName) {
    return makeResult(false, null, '缺少必填字段：stack 或 template', ['请指定技术栈或模板名称，如 --stack=react-vite']);
  }

  const pmValidation = Validators.validatePackageManager(packageManager);
  if (!pmValidation.valid) {
    return makeResult(false, null, pmValidation.error, [pmValidation.suggestion || '']);
  }

  const allowUpperCase = ['spring-boot', 'dotnet-api', 'flutter-app', 'django-api'].includes(templateName);
  const nameValidation = Validators.validateProjectName(
    projectName === '.' ? 'current-dir' : projectName,
    { allowUpperCase }
  );
  if (!nameValidation.valid && projectName !== '.') {
    return makeResult(false, null, nameValidation.error, [nameValidation.suggestion || '']);
  }

  const cwd = projectRoot || process.cwd();
  const outputDir = projectName === '.' ? cwd : path.join(cwd, projectName);

  // 目标目录检查
  const dirValidation = await Validators.validateTargetDir(outputDir, options.force);
  if (!dirValidation.valid) {
    return makeResult(false, null, dirValidation.error, [dirValidation.suggestion || '']);
  }

  // 判断使用内置模板还是官方脚手架
  const isBuiltin = !!TEMPLATES[templateName];
  const isOfficial = !!SCAFFOLD_COMMANDS[templateName];

  if (!isBuiltin && !isOfficial) {
    const available = [...new Set([...Object.keys(TEMPLATES), ...Object.keys(SCAFFOLD_COMMANDS)])].sort();
    return makeResult(
      false,
      null,
      `不支持的模板/技术栈：${templateName}`,
      [`可用模板：${available.join(', ')}`, '使用 scaffold list 查看所有可用模板']
    );
  }

  // LLM 推荐增强（如果提供了项目描述）
  let llmEnhanced = false;
  let llmWarnings = [];

  if (options.description && options.llmEnhance !== false) {
    const recResult = await safeGenerateCode({
      taskDescription: `根据以下项目描述，判断选择的模板 ${templateName} 是否合适，并给出配置建议。

项目描述：${options.description}
选择的模板：${templateName}

请输出 JSON 格式：
{
  "recommended": true/false,
  "reason": "推荐/不推荐的原因",
  "configSuggestions": { "参数名": "建议值" },
  "alternativeTemplates": ["备选模板1", "备选模板2"]
}

只输出 JSON，不要其他文字。`,
      language: 'json',
      targetFile: 'recommendation.json',
    });
    if (recResult && recResult.code) {
      try {
        const recJson = JSON.parse(recResult.code.match(/\{[\s\S]*\}/)?.[0] || recResult.code);
        if (recJson.recommended === false) {
          llmWarnings.push(`LLM 建议：${recJson.reason}`);
          if (recJson.alternativeTemplates?.length) {
            llmWarnings.push(`备选模板：${recJson.alternativeTemplates.join(', ')}`);
          }
        }
        llmEnhanced = true;
      } catch {
        // 解析失败忽略
      }
    }
  }

  let generatedFiles = [];
  let stdout = '';
  let stderr = '';

  if (isBuiltin) {
    // ---- 内置模板模式 ----
    const tpl = TEMPLATES[templateName];

    // 构建模板变量
    const templateVars = {};
    for (const p of tpl.params) {
      templateVars[p.name] = options[p.name] !== undefined ? options[p.name] : p.default;
    }
    // 覆盖 projectName
    if (projectName !== '.') {
      templateVars.projectName = projectName;
    } else {
      templateVars.projectName = path.basename(cwd);
    }

    const vars = buildBuiltinVars(templateVars);

    try {
      // 确保输出目录存在
      await ensureDir(outputDir);

      // 渲染并写入所有文件
      for (const fileDef of tpl.files) {
        const rendered = TemplateEngine.render(fileDef.content, vars);
        const filePath = path.join(outputDir, fileDef.path);
        await ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, rendered, 'utf-8');
        generatedFiles.push(fileDef.path);
      }

      // 初始化 git
      if (options.git) {
        try {
          await execAsync('git init', { cwd: outputDir });
          generatedFiles.push('.git/');
        } catch (e) {
          llmWarnings.push(`Git 初始化失败：${e.message?.slice(0, 100)}`);
        }
      }

      // 自动安装依赖
      if (options.installDeps && tpl.installCommand) {
        try {
          const installCmd = tpl.installCommand.replace('pnpm', packageManager).replace('npm', packageManager);
          const { stdout: instStdout, stderr: instStderr } = await execAsync(installCmd, {
            cwd: outputDir,
            timeout: 180_000,
            env: { ...process.env, CI: 'true' },
          });
          stdout = instStdout;
          stderr = instStderr;
        } catch (e) {
          llmWarnings.push(`依赖安装失败：${e.message?.slice(0, 200)}`);
        }
      }
    } catch (err) {
      return makeResult(
        false,
        null,
        `脚手架生成失败：${err.message?.slice(0, 300) || '未知错误'}`,
        [...llmWarnings, '请检查目标目录权限和磁盘空间'],
        false
      );
    }
  } else {
    // ---- 官方脚手架模式（保留原有逻辑）----
    const cmdFn = SCAFFOLD_COMMANDS[templateName];
    let cmd = cmdFn(packageManager, outputDir);
    cmd = cmd.replace('{dir}', projectName);

    try {
      const { stdout: execStdout, stderr: execStderr } = await execAsync(cmd, {
        cwd,
        timeout: 180_000,
        env: { ...process.env, CI: 'true' },
      });
      stdout = execStdout;
      stderr = execStderr || '';

      // 扫描生成的文件
      try {
        generatedFiles = await readDirRecursive(outputDir);
      } catch {
        generatedFiles = [];
      }

      // LLM 入口文件优化
      if (options.llmEnhance !== false) {
        const entryFiles = STACK_ENTRY_FILES[templateName] || [];
        const language = STACK_LANGUAGE[templateName] || 'typescript';

        for (const relPath of entryFiles) {
          const filePath = path.join(outputDir, relPath);
          let originalCode = null;
          try {
            originalCode = await fs.readFile(filePath, 'utf-8');
          } catch {
            continue;
          }

          const llmResult = await safeGenerateCode({
            taskDescription: `优化以下 ${templateName} 项目的 ${relPath} 入口文件，使其更符合生产级项目规范：
- 添加更好的错误处理和边界情况处理
- 改进代码结构和可读性
- 添加必要的类型定义和注释
- 遵循现代 ${templateName} 最佳实践
- 保持原有功能不变，只做质量提升
- 如果是样式文件，优化 CSS 结构，添加响应式设计基础`,
            existingCode: originalCode,
            targetFile: relPath,
            language,
            additionalContext: `项目技术栈: ${templateName}
包管理器: ${packageManager}
项目名称: ${projectName === '.' ? path.basename(cwd) : projectName}`,
          });

          if (llmResult && llmResult.code) {
            try {
              await fs.writeFile(filePath, llmResult.code, 'utf-8');
              llmEnhanced = true;
            } catch {
              llmWarnings.push(`Failed to write enhanced ${relPath}`);
            }
          }
        }
      }

      // 初始化 git
      if (options.git) {
        try {
          await execAsync('git init', { cwd: outputDir });
        } catch (e) {
          llmWarnings.push(`Git 初始化失败：${e.message?.slice(0, 100)}`);
        }
      }
    } catch (err) {
      return makeResult(
        false,
        null,
        `脚手架命令执行失败：${err.message?.slice(0, 300) || '未知错误'}`,
        [
          stderr ? `stderr: ${stderr.slice(0, 500)}` : '',
          `请确保 ${packageManager} 已安装且 ${templateName} 受支持`,
        ].filter(Boolean),
        false
      );
    }
  }

  // 构建 nextActions
  const nextActions = [];
  if (projectName !== '.') {
    nextActions.push(`cd ${projectName}`);
  }
  const tpl = TEMPLATES[templateName];
  if (!options.installDeps) {
    nextActions.push(`${packageManager} install`);
  }
  if (tpl?.devCommand) {
    nextActions.push(tpl.devCommand.replace('pnpm', packageManager).replace('npm', packageManager));
  } else if (templateName.startsWith('react') || templateName.startsWith('vue') || templateName === 'nextjs' || templateName === 'nuxt') {
    nextActions.push(`${packageManager} run dev`);
  }

  // AST 验证生成代码语法
  const astValidation = await validateGeneratedFilesAST(outputDir, generatedFiles);
  if (astValidation.invalidFiles.length > 0) {
    llmWarnings.push(`AST 检测到 ${astValidation.invalidFiles.length} 个文件语法错误`);
  }

  return makeResult(
    true,
    {
      summary: `✅ 已生成 ${templateName} 项目${isBuiltin ? '（内置模板）' : '（官方脚手架）'}，位置：${outputDir}${llmEnhanced ? ' (LLM 增强)' : ''}`,
      outputDir,
      template: templateName,
      stack: templateName,
      mode: isBuiltin ? 'builtin' : 'official',
      packageManager,
      fileCount: generatedFiles.length,
      generatedFiles: generatedFiles.slice(0, 50),
      stdout: stdout.slice(-1000),
      stderr: stderr ? stderr.slice(-500) : '',
      astEnhanced: astValidation.astEnhanced,
      astValidation: astValidation.astEnhanced
        ? {
            totalChecked: astValidation.totalChecked,
            validFiles: astValidation.validFiles,
            invalidFiles: astValidation.invalidFiles.slice(0, 10),
          }
        : undefined,
      llmEnhanced,
      llmProvider: llmEnhanced ? getLlmProvider() : null,
    },
    null,
    llmWarnings,
    llmEnhanced,
    nextActions
  );
}

// ============================================================
// 第八部分：custom - 从自定义模板生成
// ============================================================

/**
 * custom 命令 - 从自定义模板目录生成项目
 *
 * 两种模式：
 * 1. 目录模式：从 templateDir 读取模板文件，变量替换后输出到 outputDir
 * 2. LLM 模式：根据 description 用 LLM 生成模板（原有逻辑）
 */
async function custom(params) {
  const {
    templateDir,
    outputDir,
    projectName = 'custom-project',
    description,
    stack = 'react-vite',
    packageManager = 'pnpm',
    projectRoot,
    options = {},
    vars = {},
  } = params;

  const cwd = projectRoot || process.cwd();

  // ---- 模式1：从目录读取模板 ----
  if (templateDir) {
    const srcDir = path.isAbsolute(templateDir) ? templateDir : path.join(cwd, templateDir);
    const destDir = outputDir
      ? (path.isAbsolute(outputDir) ? outputDir : path.join(cwd, outputDir))
      : path.join(cwd, projectName);

    // 校验源目录存在
    try {
      const stat = await fs.stat(srcDir);
      if (!stat.isDirectory()) {
        return makeResult(false, null, `模板路径不是目录：${templateDir}`, ['请指定一个有效的模板目录']);
      }
    } catch {
      return makeResult(false, null, `模板目录不存在：${templateDir}`, ['请检查路径是否正确']);
    }

    // 目标目录检查
    const dirValidation = await Validators.validateTargetDir(destDir, options.force);
    if (!dirValidation.valid) {
      return makeResult(false, null, dirValidation.error, [dirValidation.suggestion || '']);
    }

    // 构建变量
    const templateVars = buildBuiltinVars({
      projectName: projectName,
      ...vars,
    });

    try {
      // 读取所有文件
      const files = await readDirRecursive(srcDir);
      const generatedFiles = [];
      const skippedFiles = [];

      await ensureDir(destDir);

      for (const relPath of files) {
        const srcPath = path.join(srcDir, relPath);
        // 渲染文件路径（支持路径中的变量）
        const renderedRelPath = TemplateEngine.render(relPath, templateVars);
        const destPath = path.join(destDir, renderedRelPath);

        await ensureDir(path.dirname(destPath));

        try {
          // 判断是否为文本文件
          const ext = path.extname(relPath).toLowerCase();
          const textExts = ['.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.html', '.css', '.scss', '.less', '.vue', '.yaml', '.yml', '.toml', '.ini', '.env', '.txt'];

          if (textExts.includes(ext) || ext === '' && relPath.startsWith('.') || !ext) {
            // 文本文件：读取并渲染
            let content;
            try {
              content = await fs.readFile(srcPath, 'utf-8');
            } catch {
              skippedFiles.push(relPath);
              continue;
            }
            const rendered = TemplateEngine.render(content, templateVars);
            await fs.writeFile(destPath, rendered, 'utf-8');
          } else {
            // 二进制文件：直接复制
            await fs.copyFile(srcPath, destPath);
          }
          generatedFiles.push(renderedRelPath);
        } catch (e) {
          skippedFiles.push(`${relPath} (${e.message?.slice(0, 50)})`);
        }
      }

      // LLM 增强：对生成的项目进行优化
      let llmEnhanced = false;
      if (options.llmEnhance !== false && llm && llm.isAvailable()) {
        const language = STACK_LANGUAGE[stack] || 'typescript';
        const keyFiles = generatedFiles.filter(f =>
          f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.vue')
        ).slice(0, 3);

        for (const relPath of keyFiles) {
          const filePath = path.join(destDir, relPath);
          let originalCode;
          try {
            originalCode = await fs.readFile(filePath, 'utf-8');
          } catch {
            continue;
          }

          const llmResult = await safeGenerateCode({
            taskDescription: `优化以下自定义模板生成的 ${relPath} 文件：
- 改进代码结构和可读性
- 添加必要的类型定义和注释
- 添加错误处理
- 遵循最佳实践
- 保持原有功能不变`,
            existingCode: originalCode,
            targetFile: relPath,
            language,
            additionalContext: `项目名称: ${projectName}\n技术栈: ${stack}`,
          });

          if (llmResult && llmResult.code) {
            try {
              await fs.writeFile(filePath, llmResult.code, 'utf-8');
              llmEnhanced = true;
            } catch {
              // 忽略写入失败
            }
          }
        }
      }

      const nextActions = [];
      if (destDir !== cwd) {
        nextActions.push(`cd ${path.relative(cwd, destDir) || '.'}`);
      }
      nextActions.push(`${packageManager} install`);

      return makeResult(
        true,
        {
          summary: `✅ 从自定义模板生成项目：${destDir}（${generatedFiles.length} 个文件）`,
          outputDir: destDir,
          templateDir: srcDir,
          generatedFiles: generatedFiles.slice(0, 50),
          skippedFiles: skippedFiles.slice(0, 20),
          fileCount: generatedFiles.length,
        },
        null,
        skippedFiles.length > 0 ? [`跳过 ${skippedFiles.length} 个文件`] : [],
        llmEnhanced,
        nextActions
      );
    } catch (err) {
      return makeResult(
        false,
        null,
        `自定义模板生成失败：${err.message?.slice(0, 300) || '未知错误'}`,
        [],
        false
      );
    }
  }

  // ---- 模式2：LLM 生成自定义模板 ----
  if (!llm || !llm.isAvailable()) {
    return makeResult(
      false,
      null,
      'LLM 不可用，无法生成自定义模板',
      ['设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY 等环境变量', '或者使用 --template-dir 参数从本地模板目录生成'],
      false
    );
  }

  if (!description) {
    return makeResult(false, null, '缺少项目描述', ['请提供 description 参数描述项目需求']);
  }

  const language = STACK_LANGUAGE[stack] || 'typescript';
  const dir = path.join(cwd, projectName);

  try {
    // 第一步：生成项目结构
    const structureResult = await safeGenerateCode({
      taskDescription: `根据以下项目描述，设计一个完整的项目文件结构。

## 项目描述
${description}

## 技术栈
${stack}

请输出一个 JSON 数组，每个元素包含：
- path: 文件相对路径
- description: 文件功能描述
- priority: 优先级（1=核心入口，2=重要模块，3=辅助文件）

只输出 JSON，不要其他文字。`,
      language: 'json',
      targetFile: 'project-structure.json',
    });

    if (!structureResult) {
      return makeResult(false, null, 'LLM 生成项目结构失败', ['请重试']);
    }

    let fileStructure;
    try {
      const jsonMatch = structureResult.code.match(/\[[\s\S]*\]/);
      fileStructure = JSON.parse(jsonMatch ? jsonMatch[0] : structureResult.code);
    } catch {
      fileStructure = [
        { path: 'src/App.tsx', description: '主应用组件', priority: 1 },
        { path: 'src/main.tsx', description: '应用入口', priority: 1 },
        { path: 'package.json', description: '项目配置', priority: 1 },
      ];
    }

    fileStructure.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    const filesToGenerate = fileStructure.slice(0, options.maxFiles || 12);
    const generatedFiles = [];
    const skippedFiles = [];

    await ensureDir(dir);

    // 第二步：逐个生成文件
    for (const fileInfo of filesToGenerate) {
      const filePath = path.join(dir, fileInfo.path);
      await ensureDir(path.dirname(filePath));

      let existingCode = '';
      try {
        existingCode = await fs.readFile(filePath, 'utf-8');
      } catch { /* 忽略 */ }

      const fileResult = await safeGenerateCode({
        taskDescription: `为项目生成 ${fileInfo.path} 文件。

## 文件功能
${fileInfo.description}

## 项目描述
${description}

## 技术栈
${stack}

请生成完整、可运行的代码。`,
        existingCode,
        targetFile: fileInfo.path,
        language,
      });

      if (fileResult && fileResult.code) {
        try {
          await fs.writeFile(filePath, fileResult.code, 'utf-8');
          generatedFiles.push(fileInfo.path);
        } catch {
          skippedFiles.push(fileInfo.path);
        }
      } else {
        skippedFiles.push(fileInfo.path);
      }
    }

    if (generatedFiles.length === 0) {
      return makeResult(false, null, 'LLM 未能生成任何项目文件', ['请重试或提供更详细的项目描述'], false);
    }

    return makeResult(
      true,
      {
        summary: `✅ 已生成自定义 ${stack} 项目：${dir}（${generatedFiles.length} 个文件）`,
        outputDir: dir,
        stack,
        packageManager,
        generatedFiles,
        skippedFiles,
        description,
      },
      null,
      skippedFiles.length > 0 ? [`跳过 ${skippedFiles.length} 个文件`] : [],
      true,
      [
        `cd ${projectName}`,
        `${packageManager} install`,
        `${packageManager} run dev`,
      ]
    );
  } catch (err) {
    return makeResult(
      false,
      null,
      `自定义模板生成失败：${err.message?.slice(0, 300) || '未知错误'}`,
      [],
      true
    );
  }
}

// ============================================================
// 第九部分：addDep - 添加依赖（保留原有功能）
// ============================================================

async function addDep(params) {
  const { packageName, version, packageManager = 'pnpm', projectRoot } = params;
  const cwd = projectRoot || process.cwd();
  const pkgSpec = version ? `${packageName}@${version}` : packageName;

  if (!packageName) {
    return makeResult(false, null, '缺少 packageName 参数', ['请指定要添加的依赖包名']);
  }

  try {
    const cmd = packageManager === 'npm' ? `npm install ${pkgSpec}` :
                packageManager === 'yarn' ? `yarn add ${pkgSpec}` :
                `pnpm add ${pkgSpec}`;

    const { stdout } = await execAsync(cmd, { cwd, timeout: 120_000 });

    const pkgPath = path.join(cwd, 'package.json');
    let depVersion = version || 'latest';
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      depVersion = pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName] || version || 'latest';
    } catch { /* 忽略 */ }

    return makeResult(
      true,
      {
        summary: `✅ 已添加 ${pkgSpec}`,
        package: packageName,
        version: depVersion,
        packageManager,
      },
      null,
      [],
      false,
      [`在 package.json 中验证 ${packageName}`]
    );
  } catch (err) {
    return makeResult(
      false,
      null,
      `添加依赖失败：${err.message?.slice(0, 300)}`,
      [`检查 ${packageName}${version ? '@' + version : ''} 是否存在于 npm 仓库`],
      false
    );
  }
}

// ============================================================
// 第十部分：enhance - LLM 优化文件（保留原有功能）
// ============================================================

async function enhance(params) {
  const { files = [], stack = '', instruction = '', projectRoot, options = {} } = params;
  const cwd = projectRoot || process.cwd();

  if (!llm || !llm.isAvailable()) {
    return makeResult(false, null, 'LLM 不可用，无法进行代码优化', ['设置 API Key 环境变量以启用 LLM 功能']);
  }

  if (!Array.isArray(files) || files.length === 0) {
    return makeResult(false, null, '未指定要优化的文件', ['files 参数必须是非空数组']);
  }

  const language = stack ? (STACK_LANGUAGE[stack] || 'typescript') : 'typescript';
  const enhancedFiles = [];
  const skippedFiles = [];
  const errors = [];

  const defaultInstruction = instruction || '优化代码质量：改进结构、添加错误处理、完善类型定义、增加注释、遵循最佳实践';

  for (const relPath of files) {
    const filePath = path.join(cwd, relPath);
    let originalCode = null;
    try {
      originalCode = await fs.readFile(filePath, 'utf-8');
    } catch {
      skippedFiles.push(relPath);
      errors.push(`文件不存在：${relPath}`);
      continue;
    }

    // 根据扩展名推断语言
    let fileLanguage = language;
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.ts' || ext === '.tsx') fileLanguage = 'typescript';
    else if (ext === '.js' || ext === '.jsx') fileLanguage = 'javascript';
    else if (ext === '.py') fileLanguage = 'python';
    else if (ext === '.java') fileLanguage = 'java';
    else if (ext === '.rs') fileLanguage = 'rust';
    else if (ext === '.go') fileLanguage = 'go';
    else if (ext === '.css' || ext === '.scss') fileLanguage = 'css';
    else if (ext === '.vue') fileLanguage = 'vue';
    else if (ext === '.md') fileLanguage = 'markdown';

    const llmResult = await safeGenerateCode({
      taskDescription: `优化以下文件：${relPath}

## 优化指令
${defaultInstruction}

## 优化原则
1. 保持原有功能和接口不变
2. 改进代码质量和可维护性
3. 添加适当的错误处理
4. 完善类型定义（如果适用）
5. 增加有意义的注释
6. 遵循现代最佳实践`,
      existingCode: originalCode,
      targetFile: relPath,
      language: fileLanguage,
    });

    if (llmResult && llmResult.code) {
      // 备份原文件
      try {
        await fs.copyFile(filePath, filePath + '.bak');
      } catch { /* 忽略备份失败 */ }

      try {
        await fs.writeFile(filePath, llmResult.code, 'utf-8');
        enhancedFiles.push({
          file: relPath,
          originalSize: originalCode.length,
          enhancedSize: llmResult.code.length,
        });
      } catch {
        skippedFiles.push(relPath);
        errors.push(`写入优化文件失败：${relPath}`);
      }
    } else {
      skippedFiles.push(relPath);
      errors.push(`LLM 优化失败：${relPath}`);
    }
  }

  if (enhancedFiles.length === 0) {
    return makeResult(false, null, '没有文件被成功优化', errors, true);
  }

  return makeResult(
    true,
    {
      summary: `✅ 已优化 ${enhancedFiles.length} 个文件${skippedFiles.length > 0 ? `（跳过 ${skippedFiles.length} 个）` : ''}`,
      enhancedFiles: enhancedFiles.map(f => f.file),
      skippedFiles,
      details: enhancedFiles,
      instruction: defaultInstruction,
    },
    null,
    errors.slice(0, 5),
    true,
    ['检查优化后的文件是否正确', '运行测试验证功能', '如果满意可删除 .bak 备份文件']
  );
}

// ============================================================
// 第十一部分：导出
// ============================================================

module.exports = {
  // 主命令
  run,
  list,
  inspect,
  custom,
  addDep,
  enhance,

  // 设计 entry-point 别名
  scaffold: run,
  'add-dep': addDep,

  // 别名（scaffold 前缀）
  scaffoldRun: run,
  scaffoldList: list,
  scaffoldInspect: inspect,
  scaffoldCustom: custom,
  scaffoldAddDep: addDep,
  scaffoldEnhance: enhance,

  // 内部导出（供测试或扩展使用）
  _templateEngine: TemplateEngine,
  _validators: Validators,
  _templates: TEMPLATES,
};
