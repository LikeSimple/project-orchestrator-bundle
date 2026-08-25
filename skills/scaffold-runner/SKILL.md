---
name: scaffold-runner
description: |
 技术栈脚手架生成。封装 10+ 主流技术栈的官方脚手架工具
 （Spring Initializr / Vite / create-vue / Nuxt / Nest / Cookiecutter / dotnet new / cargo init / flutter create / create-expo-app）。
 严格禁止手写依赖文件。
version: 1.0.0
tags:
  - scaffolding
  - spring-boot
  - vite
  - vue
  - react
  - nuxt
  - nest
  - dotnet
  - cargo
  - flutter
  - expo
entry-points:
  - scaffold
  - add-dep
requires:
  - node: ">=18"
  - python: ">=3.10"
binds: []
parent: project-orchestrator
phase: 1.5
position: bootstrap-after-spec
---

# scaffold-runner

> 严格使用对应技术栈的官方脚手架工具，禁止手写依赖文件。

## 一、命令清单

### 1.1 `/scaffold` 主命令

```bash
/scaffold --stack=<stack> [--options]

支持的 --stack 值：
  spring-boot   生成 Spring Boot 工程（REST API 调用 start.spring.io）
  react-vite    生成 React + Vite + TypeScript 工程
  vue-vite      生成 Vue 3 + Vite 工程
  nextjs        生成 Next.js 工程
  nuxt          生成 Nuxt 3 工程
  nest          生成 NestJS 工程
  fastapi       生成 FastAPI 工程（Cookiecutter）
  python        生成 Python 库（Cookiecutter）
  go-cli        生成 Go CLI 工程（Cobra）
  flutter       生成 Flutter 工程
  expo          生成 Expo (React Native) 工程
  dotnet-webapi 生成 .NET WebAPI 工程
  rust          生成 Rust 二进制工程
```

### 1.2 `/add-dep` 添加依赖

```bash
/add-dep --stack=<stack> <package[@version]>

# 示例
/add-dep --stack=react-vite axios@1.7
/add-dep --stack=spring-boot spring-boot-starter-data-jpa
/add-dep --stack=rust serde --features derive
```

## 二、各技术栈底层调用映射

| 技术栈 | 底层工具 | 调用示例 |
|---|---|---|
| Spring Boot | Spring Initializr REST API | `curl -G https://start.spring.io/starter.zip -d type=maven-project -d language=java -d bootVersion=3.4.0 -d baseDir=. -d groupId=com.example -d artifactId=app -d dependencies=web,data-jpa,postgresql -o app.zip && unzip app.zip -d app` |
| React + Vite | `npm create vite@latest` | `npm create vite@latest . -- --template react-ts` |
| Vue 3 + Vite | `npm create vue@latest` | `npm create vue@latest . -- --typescript --router --pinia --vitest --eslint` |
| Next.js | `create-next-app` | `npx create-next-app@latest . --typescript --eslint --app --src-dir --import-alias "@/*"` |
| Nuxt | `nuxi init` | `npx nuxi@latest init .` |
| NestJS | `nest new` | `npx @nestjs/cli@latest new . --package-manager pnpm --strict` |
| Python 库 | Cookiecutter | `cookiecutter gh:audreyr/cookiecutter-pypackage --no-input --config-file cfg.yaml` |
| FastAPI | Cookiecutter-FastAPI | `cookiecutter https://github.com/tiangolo/full-stack-fastapi-template --no-input` |
| Go CLI | Cobra Generator | `cobra-cli init <name> --author "ACME" --license apache` |
| Flutter | `flutter create` | `flutter create . --org com.example --platforms=android,ios,web --description "My App"` |
| Expo | `create-expo-app` | `npx create-expo-app@latest . --template tabs` |
| .NET WebAPI | `dotnet new` | `dotnet new webapi -n MyApi --framework net9.0 --use-controllers` |
| Rust | `cargo init` | `cargo init . --bin --name myapp --vcs git` |

## 三、强制约束（写入 Constitution）

| 禁止 | 必须 |
|---|---|
| 手写 `package.json` 的 dependencies / devDependencies 段 | 通过 `npm install <pkg>` 或 `scaffold-runner add-dep` |
| 手写 `pom.xml` / `build.gradle` 的 dependencies 段 | 通过脚手架或 `add-dep` 添加 |
| 手写 `Cargo.toml` 的 dependencies 段 | 通过 `cargo add` 或 `add-dep` |
| 手写 `pyproject.toml` 的 dependencies 段 | 通过 `pip install` 或 `poetry add` 或 `add-dep` |
| 手写 `go.mod` 的 require 段 | 通过 `go get` 或 `add-dep` |

## 四、检测与验证

```bash
# 安装完成后自动运行：
- npm run lint（前端）
- mvn compile（Spring Boot）
- cargo build（Rust）
- go build（Go）
- pytest（Python）
- dotnet build（.NET）
- flutter analyze（Flutter）
```

## 五、使用示例

### 5.1 完整示例：React + Vite + TypeScript

```bash
/scaffold --stack=react-vite --package-manager=pnpm
# 等价于：
#   npm create vite@latest . -- --template react-ts
#   pnpm install
#   pnpm add -D @types/node eslint prettier
# 输出：完整的 src/、package.json、tsconfig.json、vite.config.ts

/add-dep --stack=react-vite axios@1.7 react-router-dom@6 zustand@4
# 等价于：pnpm add axios@1.7 react-router-dom@6 zustand@4
```

### 5.2 完整示例：Spring Boot + PostgreSQL + JPA

```bash
/scaffold --stack=spring-boot --java-version=21 --dependencies=web,data-jpa,postgresql,security,lombok
# 等价于：
#   curl https://start.spring.io/starter.zip?...&dependencies=web,data-jpa,postgresql,security,lombok
# 输出：完整的 Maven 工程，包含 Spring Boot 3.4.0
```

## 六、失败回退

| 失败点 | 恢复动作 |
|---|---|
| 脚手架下载失败 | 检查网络、版本；重试 1 次后报错 |
| 工具未安装（如 flutter） | 提示用户安装对应 SDK |
| 目录非空 | 提示用户确认是否继续（--force） |
| 版本不兼容 | 列出可用版本，让用户选择 |

## 七、技术栈选型建议矩阵

| 场景 | 推荐栈 | 理由 |
|---|---|---|
| SaaS Web App | react-vite 或 vue-vite | 快速迭代、生态丰富 |
| SSR/SEO 站点 | nextjs 或 nuxt | 内置 SSR |
| 企业后端 API | spring-boot | 生态成熟、企业首选 |
| 高性能 Node.js API | nest | TypeScript + 强约束 |
| 数据科学 / ML 后端 | fastapi | 异步、自动 OpenAPI |
| 跨平台移动端 | expo（先）或 flutter | Expo 适合 web 团队；Flutter 适合重度原生 |
| Windows 桌面 | dotnet | 微软生态 |
| 高性能 CLI | rust 或 go-cli | 二进制分发 |

## 八、相关链接

- 父 Skill: `project-orchestrator`
- 上游: `spec-bootstrap`（提供 spec.md）
- 下游: `ui-design`, `spec-userstory-to-design`, `html-converter`

## 九、许可

MIT