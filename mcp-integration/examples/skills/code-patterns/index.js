/**
 * code-patterns Skill - 实际 CLI 实现
 *
 * 功能：
 * 1. 团队编码约定注入（原有功能）：读取/生成团队编码约定，注入到 Agent system prompt
 * 2. 设计模式库（新增功能）：20+ 设计模式、多框架支持、代码生成、LLM 驱动的模式应用
 *
 * 对应 MCP Tool: code_patterns_inject
 */

const fs = require('fs');
const path = require('path');
const llm = require('../../lib/llm-client');
const ast = require('../../lib/ast-parser');

// ============================================================
// 默认规则（当 .code-patterns.yaml 不存在时使用）
// ============================================================

const DEFAULT_PATTERNS = {
  naming: {
    variables: 'camelCase',
    functions: 'camelCase + 动词开头',
    classes: 'PascalCase',
    constants: 'UPPER_SNAKE_CASE',
    files: {
      components: 'PascalCase.tsx',
      utilities: 'kebab-case.ts',
      types: '*.types.ts',
    },
  },
  error_handling: {
    style: 'typed exceptions + Result types',
    forbidden: ['吞错', '返回 -1 表示错误', '空 catch 块'],
  },
  logging: {
    library: 'pino (backend) / consola (frontend)',
    forbidden: ['console.log 在生产代码中'],
    required_fields: ['timestamp', 'level', 'message', 'traceId'],
  },
  testing: {
    framework: 'vitest',
    coverage_threshold: 80,
    naming: '{describe}.{it}.test.ts',
  },
  git: {
    commit_message: 'Conventional Commits',
    types: ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'],
  },
  imports: {
    order: ['Node 内置', '第三方', '绝对路径', '相对路径'],
    forbidden: ['循环依赖', '跨层级引用'],
  },
};

// ============================================================
// 常量定义
// ============================================================

const FRAMEWORK_ALIASES = {
  'vue3': 'vue',
  'vue-3': 'vue',
  'react-ts': 'react',
  'reactjs': 'react',
  'ts': 'typescript',
  'node': 'nodejs',
  'node.js': 'nodejs',
  'js': 'nodejs',
};

function normalizeFramework(fw) {
  if (!fw) return 'typescript';
  const lower = fw.toLowerCase().trim();
  return FRAMEWORK_ALIASES[lower] || lower;
}

const SUPPORTED_FRAMEWORKS = ['react', 'vue', 'typescript', 'nodejs'];

const SUPPORTED_FRAMEWORK_NAMES = {
  react: 'React',
  vue: 'Vue 3',
  typescript: 'TypeScript',
  nodejs: 'Node.js',
};

const CATEGORY_NAMES = {
  creational: '创建型',
  structural: '结构型',
  behavioral: '行为型',
  frontend: '前端特有',
};

// ============================================================
// 设计模式库 PATTERN_LIBRARY
// ============================================================
// 分类：creational(创建型) | structural(结构型) | behavioral(行为型) | frontend(前端特有)
// 框架：react | vue | typescript | nodejs

const PATTERN_LIBRARY = {
  // ==================== 创建型 Creational ====================

  factory: {
    id: 'factory',
    name: 'Factory Method (工厂方法)',
    category: 'creational',
    description: '定义一个创建对象的接口，让子类决定实例化哪个类。工厂方法使一个类的实例化延迟到其子类。',
    useCases: [
      '当一个类不知道它所必须创建的对象的类的时候',
      '当一个类希望由它的子类来指定它所创建的对象的时候',
      '当类将创建对象的职责委托给多个帮助子类中的某一个，并且你希望将哪一个帮助子类是代理者这一信息局部化的时候',
    ],
    pros: [
      '避免创建者和具体产品之间的紧密耦合',
      '单一职责原则：可以将产品创建代码放在程序的单一位置',
      '开闭原则：无需更改现有客户端代码，就可以在程序中引入新的产品类型',
    ],
    cons: [
      '代码可能会变得复杂，因为需要引入许多新的子类来实现该模式',
      '增加了系统的抽象性和理解难度',
    ],
    codeExamples: {
      typescript: `// 产品接口
interface Button {
  render(): string;
  onClick(): void;
}

// 具体产品
class WindowsButton implements Button {
  render(): string { return '[Windows Button]'; }
  onClick(): void { console.log('Windows button clicked'); }
}

class HTMLButton implements Button {
  render(): string { return '<button>HTML Button</button>'; }
  onClick(): void { console.log('HTML button clicked'); }
}

// 工厂抽象类
abstract class Dialog {
  abstract createButton(): Button;
  renderWindow(): void {
    const button = this.createButton();
    console.log('Rendering:', button.render());
    button.onClick();
  }
}

// 具体工厂
class WindowsDialog extends Dialog {
  createButton(): Button { return new WindowsButton(); }
}

class WebDialog extends Dialog {
  createButton(): Button { return new HTMLButton(); }
}

// 使用
function clientCode(creator: Dialog) {
  creator.renderWindow();
}

clientCode(new WindowsDialog());
clientCode(new WebDialog());`,
      react: `import React from 'react';

// 产品接口
interface ButtonProps {
  label: string;
  onClick: () => void;
}

// 具体产品
const PrimaryButton: React.FC<ButtonProps> = ({ label, onClick }) => (
  <button onClick={onClick} style={{
    padding: '8px 16px', backgroundColor: '#1890ff',
    color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer',
  }}>{label}</button>
);

const SecondaryButton: React.FC<ButtonProps> = ({ label, onClick }) => (
  <button onClick={onClick} style={{
    padding: '8px 16px', backgroundColor: 'white',
    color: '#1890ff', border: '1px solid #1890ff', borderRadius: '4px', cursor: 'pointer',
  }}>{label}</button>
);

// 工厂函数
type ButtonType = 'primary' | 'secondary';

function createButton(type: ButtonType): React.FC<ButtonProps> {
  switch (type) {
    case 'primary': return PrimaryButton;
    case 'secondary': return SecondaryButton;
    default: return PrimaryButton;
  }
}

// 使用
const ButtonFactoryDemo: React.FC = () => {
  const PrimaryBtn = createButton('primary');
  const SecondaryBtn = createButton('secondary');
  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <PrimaryBtn label="Primary" onClick={() => alert('Primary')} />
      <SecondaryBtn label="Secondary" onClick={() => alert('Secondary')} />
    </div>
  );
};

export default ButtonFactoryDemo;`,
      vue: `<template>
  <div style="display: flex; gap: 10px;">
    <component :is="buttonComponent" :label="label" @click="handleClick" />
    <button @click="toggleType">切换类型</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, h } from 'vue';

// 具体产品
const PrimaryButton = defineComponent({
  name: 'PrimaryButton',
  props: ['label'],
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      onClick: () => emit('click'),
      style: { padding: '8px 16px', background: '#1890ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
    }, props.label);
  },
});

const SecondaryButton = defineComponent({
  name: 'SecondaryButton',
  props: ['label'],
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      onClick: () => emit('click'),
      style: { padding: '8px 16px', background: 'white', color: '#1890ff', border: '1px solid #1890ff', borderRadius: '4px', cursor: 'pointer' },
    }, props.label);
  },
});

// 工厂函数
function createButton(type: 'primary' | 'secondary') {
  return type === 'primary' ? PrimaryButton : SecondaryButton;
}

const buttonType = ref<'primary' | 'secondary'>('primary');
const label = ref('Click Me');
const buttonComponent = computed(() => createButton(buttonType.value));
const handleClick = () => console.log('clicked:', buttonType.value);
const toggleType = () => { buttonType.value = buttonType.value === 'primary' ? 'secondary' : 'primary'; };
</script>`,
      nodejs: `// 产品接口
class Logger { log(message) { throw new Error('Not implemented'); } }

// 具体产品
class ConsoleLogger extends Logger {
  log(message) {
    const ts = new Date().toISOString();
    console.log(\`[\${ts}] [INFO] \${message}\`);
  }
}

class FileLogger extends Logger {
  constructor(filename) {
    super();
    this.filename = filename;
    this.fs = require('fs');
  }
  log(message) {
    const ts = new Date().toISOString();
    this.fs.appendFileSync(this.filename, \`[\${ts}] [INFO] \${message}\\n\`);
  }
}

// 工厂
class LoggerFactory {
  static createLogger(type, options = {}) {
    switch (type) {
      case 'console': return new ConsoleLogger();
      case 'file': return new FileLogger(options.filename || 'app.log');
      default: return new ConsoleLogger();
    }
  }
}

// 使用
const logger = LoggerFactory.createLogger(
  process.env.LOG_TYPE || 'console',
  { filename: 'app.log' }
);
logger.log('Application started');
logger.log('Processing data...');
logger.log('Application finished');`,
    },
  },

  abstractFactory: {
    id: 'abstractFactory',
    name: 'Abstract Factory (抽象工厂)',
    category: 'creational',
    description: '提供一个创建一系列相关或相互依赖对象的接口，而无需指定它们具体的类。',
    useCases: [
      '系统需要独立于它的产品创建、组合和表示的时候',
      '系统需要配置多个产品系列中的一个的时候',
      '当你要强调一系列相关的产品对象的设计以便进行联合使用的时候',
    ],
    pros: [
      '可以确保同一工厂生成的产品相互匹配',
      '可以避免客户端和具体产品代码的耦合',
      '单一职责原则：可以将产品生成代码抽取到同一位置',
      '开闭原则：向应用程序中引入新产品变体时无需修改客户端代码',
    ],
    cons: [
      '由于采用该模式需要向应用中引入众多接口和类，代码可能会更加复杂',
      '产品族扩展困难，增加新产品需要修改抽象工厂接口',
    ],
    codeExamples: {
      typescript: `// 抽象产品
interface Button { paint(): string; }
interface Checkbox { paint(): string; }

// 具体产品：Windows
class WinButton implements Button { paint(): string { return '[Win Button]'; } }
class WinCheckbox implements Checkbox { paint(): string { return '[Win Checkbox]'; } }

// 具体产品：Mac
class MacButton implements Button { paint(): string { return '[Mac Button]'; } }
class MacCheckbox implements Checkbox { paint(): string { return '[Mac Checkbox]'; } }

// 抽象工厂
interface GUIFactory {
  createButton(): Button;
  createCheckbox(): Checkbox;
}

// 具体工厂
class WinFactory implements GUIFactory {
  createButton(): Button { return new WinButton(); }
  createCheckbox(): Checkbox { return new WinCheckbox(); }
}

class MacFactory implements GUIFactory {
  createButton(): Button { return new MacButton(); }
  createCheckbox(): Checkbox { return new MacCheckbox(); }
}

// 客户端
class Application {
  private button: Button;
  private checkbox: Checkbox;
  constructor(private factory: GUIFactory) {}
  createUI(): void {
    this.button = this.factory.createButton();
    this.checkbox = this.factory.createCheckbox();
  }
  paint(): void {
    console.log(this.button.paint());
    console.log(this.checkbox.paint());
  }
}

const factory = new WinFactory();
const app = new Application(factory);
app.createUI();
app.paint();`,
      react: `import React, { createContext, useContext, useState } from 'react';

// 抽象产品接口
interface ThemeComponents {
  Button: React.FC<{ children: React.ReactNode; onClick?: () => void }>;
  Card: React.FC<{ title: string; children: React.ReactNode }>;
}

// 浅色主题组件
const LightButton: React.FC<any> = ({ children, onClick }) => (
  <button onClick={onClick} style={{ padding: '8px 16px', background: '#1890ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
    {children}
  </button>
);

const LightCard: React.FC<any> = ({ title, children }) => (
  <div style={{ padding: '16px', background: 'white', border: '1px solid #e8e8e8', borderRadius: '8px' }}>
    <h3 style={{ marginTop: 0 }}>{title}</h3>
    {children}
  </div>
);

// 深色主题组件
const DarkButton: React.FC<any> = ({ children, onClick }) => (
  <button onClick={onClick} style={{ padding: '8px 16px', background: '#40a9ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
    {children}
  </button>
);

const DarkCard: React.FC<any> = ({ title, children }) => (
  <div style={{ padding: '16px', background: '#2d2d2d', color: 'white', border: '1px solid #444', borderRadius: '8px' }}>
    <h3 style={{ marginTop: 0 }}>{title}</h3>
    {children}
  </div>
);

// 工厂 Context
const ThemeFactoryContext = createContext<ThemeComponents | null>(null);

const ThemeProvider: React.FC<any> = ({ theme, children }) => {
  const components = theme === 'light'
    ? { Button: LightButton, Card: LightCard }
    : { Button: DarkButton, Card: DarkCard };
  return (
    <ThemeFactoryContext.Provider value={components}>
      <div style={{ background: theme === 'light' ? '#f5f5f5' : '#1a1a1a', padding: '20px', minHeight: '200px' }}>
        {children}
      </div>
    </ThemeFactoryContext.Provider>
  );
};

const AbstractFactoryDemo: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return (
    <ThemeProvider theme={theme}>
      <Inner theme={theme} setTheme={setTheme} />
    </ThemeProvider>
  );
};

const Inner: React.FC<any> = ({ theme, setTheme }) => {
  const components = useContext(ThemeFactoryContext);
  if (!components) return null;
  const { Button, Card } = components;
  return (
    <div>
      <h3 style={{ color: theme === 'light' ? '#333' : '#fff' }}>抽象工厂 - 主题</h3>
      <Button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>切换主题</Button>
      <Card title="卡片"><p>内容</p></Card>
    </div>
  );
};

export default AbstractFactoryDemo;`,
      vue: `<template>
  <div :style="{ background: theme === 'light' ? '#f5f5f5' : '#1a1a1a', padding: '20px', minHeight: '200px' }">
    <h3 :style="{ color: theme === 'light' ? '#333' : '#fff' }">抽象工厂 - 主题</h3>
    <ThemeButton @click="toggleTheme">切换主题</ThemeButton>
    <ThemeCard title="卡片"><p>内容</p></ThemeCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, h } from 'vue';

const theme = ref<'light' | 'dark'>('light');
const toggleTheme = () => { theme.value = theme.value === 'light' ? 'dark' : 'light'; };

// 浅色组件
const LightButton = defineComponent({
  name: 'LightButton',
  setup(_, { emit, slots }) {
    return () => h('button', { onClick: () => emit('click'), style: { padding: '8px 16px', background: '#1890ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' } }, slots.default?.());
  },
});

const LightCard = defineComponent({
  name: 'LightCard',
  props: { title: String },
  setup(props, { slots }) {
    return () => h('div', { style: { padding: '16px', background: 'white', border: '1px solid #e8e8e8', borderRadius: '8px', marginTop: '16px' } }, [
      h('h3', { style: { marginTop: 0 } }, props.title),
      slots.default?.(),
    ]);
  },
});

// 深色组件
const DarkButton = defineComponent({
  name: 'DarkButton',
  setup(_, { emit, slots }) {
    return () => h('button', { onClick: () => emit('click'), style: { padding: '8px 16px', background: '#40a9ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' } }, slots.default?.());
  },
});

const DarkCard = defineComponent({
  name: 'DarkCard',
  props: { title: String },
  setup(props, { slots }) {
    return () => h('div', { style: { padding: '16px', background: '#2d2d2d', color: 'white', border: '1px solid #444', borderRadius: '8px', marginTop: '16px' } }, [
      h('h3', { style: { marginTop: 0 } }, props.title),
      slots.default?.(),
    ]);
  },
});

const ThemeButton = computed(() => theme.value === 'light' ? LightButton : DarkButton);
const ThemeCard = computed(() => theme.value === 'light' ? LightCard : DarkCard);
</script>`,
      nodejs: `// 抽象产品
interface Logger { log(msg: string): void; error(msg: string): void; }
interface Database { query(sql: string): any[]; connect(): void; }

// 开发环境产品
class ConsoleLogger implements Logger {
  log(msg: string): void { console.log(\`[LOG] \${msg}\`); }
  error(msg: string): void { console.error(\`[ERROR] \${msg}\`); }
}

class MemoryDB implements Database {
  connect(): void { console.log('Connected to in-memory DB'); }
  query(sql: string): any[] { console.log('Query:', sql); return [{ id: 1 }]; }
}

// 生产环境产品
class FileLogger implements Logger {
  private fs = require('fs');
  log(msg: string): void { this.fs.appendFileSync('app.log', \`[LOG] \${msg}\\n\`); console.log(\`[LOG] \${msg}\`); }
  error(msg: string): void { this.fs.appendFileSync('app.log', \`[ERROR] \${msg}\\n\`); console.error(\`[ERROR] \${msg}\`); }
}

class PostgresDB implements Database {
  connect(): void { console.log('Connected to PostgreSQL'); }
  query(sql: string): any[] { console.log('PG Query:', sql); return [{ id: 1 }]; }
}

// 抽象工厂
interface InfraFactory {
  createLogger(): Logger;
  createDatabase(): Database;
}

class DevFactory implements InfraFactory {
  createLogger(): Logger { return new ConsoleLogger(); }
  createDatabase(): Database { return new MemoryDB(); }
}

class ProdFactory implements InfraFactory {
  createLogger(): Logger { return new FileLogger(); }
  createDatabase(): Database { return new PostgresDB(); }
}

// 使用
const env = process.env.NODE_ENV || 'development';
const factory = env === 'production' ? new ProdFactory() : new DevFactory();
const logger = factory.createLogger();
const db = factory.createDatabase();
db.connect();
logger.log('App started');
db.query('SELECT * FROM users');
logger.log('App finished');`,
    },
  },

  builder: {
    id: 'builder',
    name: 'Builder (建造者)',
    category: 'creational',
    description: '将一个复杂对象的构建与它的表示分离，使得同样的构建过程可以创建不同的表示。',
    useCases: [
      '当创建复杂对象的算法应该独立于该对象的组成部分以及它们的装配方式时',
      '当构造过程必须允许被构造的对象有不同的表示时',
      '需要创建具有许多可选参数的对象时',
    ],
    pros: [
      '可以分步创建对象，暂缓创建步骤或递归运行创建步骤',
      '生成不同形式的产品时，可以复用相同的制造代码',
      '单一职责原则：可以将复杂构造代码从产品的业务逻辑中分离出来',
    ],
    cons: [
      '由于该模式需要新增多个类，因此代码整体复杂程度会有所增加',
      '产品必须有共同点，范围有限制',
    ],
    codeExamples: {
      typescript: `// 产品
interface Computer {
  cpu: string;
  ram: string;
  storage: string;
  gpu?: string;
  os: string;
}

// 建造者
class ComputerBuilder {
  private computer: Partial<Computer> = {};

  setCPU(cpu: string): ComputerBuilder { this.computer.cpu = cpu; return this; }
  setRAM(ram: string): ComputerBuilder { this.computer.ram = ram; return this; }
  setStorage(storage: string): ComputerBuilder { this.computer.storage = storage; return this; }
  setGPU(gpu: string): ComputerBuilder { this.computer.gpu = gpu; return this; }
  setOS(os: string): ComputerBuilder { this.computer.os = os; return this; }

  build(): Computer {
    if (!this.computer.cpu || !this.computer.ram || !this.computer.storage) {
      throw new Error('CPU, RAM, Storage are required');
    }
    return this.computer as Computer;
  }
}

// 主管
class ComputerDirector {
  static buildGamingPC(): Computer {
    return new ComputerBuilder()
      .setCPU('Intel i9').setRAM('32GB').setStorage('2TB NVMe')
      .setGPU('RTX 4090').setOS('Windows 11').build();
  }

  static buildOfficePC(): Computer {
    return new ComputerBuilder()
      .setCPU('Intel i5').setRAM('16GB').setStorage('512GB SSD')
      .setOS('Windows 10').build();
  }
}

// 使用
const custom = new ComputerBuilder()
  .setCPU('AMD Ryzen 7').setRAM('16GB').setStorage('1TB SSD')
  .setGPU('RTX 3060').setOS('Ubuntu 22.04').build();
console.log('Custom:', JSON.stringify(custom));

const gaming = ComputerDirector.buildGamingPC();
console.log('Gaming:', JSON.stringify(gaming));

const office = ComputerDirector.buildOfficePC();
console.log('Office:', JSON.stringify(office));`,
      react: `import React, { useState } from 'react';

// 建造者
class FormBuilder {
  private config = { fields: [], submitText: '提交', layout: 'vertical' as const };

  setTitle(title: string): FormBuilder { (this.config as any).title = title; return this; }
  setSubmitText(text: string): FormBuilder { this.config.submitText = text; return this; }
  addField(field: any): FormBuilder { this.config.fields.push(field); return this; }
  build() { return { ...this.config, fields: [...this.config.fields] }; }
}

// 动态表单组件
const DynamicForm: React.FC<any> = ({ config, onSubmit }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    config.fields.forEach((f: any) => {
      if (f.required && !values[f.name]) newErrors[f.name] = f.label + '必填';
    });
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: '400px' }}>
      {config.title && <h3 style={{ marginTop: 0 }}>{config.title}</h3>}
      {config.fields.map((field: any) => (
        <div key={field.name} style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>
            {field.label}
            {field.required && <span style={{ color: 'red' }}>*</span>}
          </label>
          <input
            type={field.type || 'text'}
            value={values[field.name] || ''}
            onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
            style={{ padding: '6px', width: '100%' }}
          />
          {errors[field.name] && <p style={{ color: 'red', fontSize: '12px', margin: '4px 0 0' }}>{errors[field.name]}</p>}
        </div>
      ))}
      <button type="submit" style={{ padding: '8px 16px', cursor: 'pointer' }}>{config.submitText}</button>
    </form>
  );
};

const BuilderDemo: React.FC = () => {
  const loginForm = new FormBuilder().setTitle('登录').setSubmitText('登录')
    .addField({ name: 'username', label: '用户名', type: 'text', required: true })
    .addField({ name: 'password', label: '密码', type: 'password', required: true })
    .build();

  return (
    <div>
      <h3>建造者模式 - 动态表单</h3>
      <DynamicForm config={loginForm} onSubmit={(v: any) => alert(JSON.stringify(v))} />
    </div>
  );
};

export default BuilderDemo;`,
      vue: `<template>
  <div>
    <h3>建造者模式 - 动态表单</h3>
    <DynamicForm :config="loginForm" @submit="handleSubmit" />
  </div>
</template>

<script setup lang="ts">
import { reactive, defineComponent, h } from 'vue';

// 建造者
class FormBuilder {
  private config: any = { fields: [], submitText: '提交' };
  setTitle(t: string): FormBuilder { this.config.title = t; return this; }
  setSubmitText(t: string): FormBuilder { this.config.submitText = t; return this; }
  addField(f: any): FormBuilder { this.config.fields.push(f); return this; }
  build() { return JSON.parse(JSON.stringify(this.config)); }
}

const DynamicForm = defineComponent({
  name: 'DynamicForm',
  props: { config: Object },
  emits: ['submit'],
  setup(props, { emit }) {
    const values = reactive<Record<string, string>>({});
    const errors = reactive<Record<string, string>>({});

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      let valid = true;
      props.config.fields.forEach((f: any) => {
        if (f.required && !values[f.name]) { errors[f.name] = f.label + '必填'; valid = false; }
      });
      if (valid) emit('submit', { ...values });
    };

    return () => h('form', { onSubmit: handleSubmit, style: { maxWidth: '400px' } }, [
      props.config.title ? h('h3', { style: { marginTop: 0 } }, props.config.title) : null,
      ...props.config.fields.map((field: any) => h('div', { key: field.name, style: { marginBottom: '12px' } }, [
        h('label', { style: { display: 'block', marginBottom: '4px' } }, [
          field.label,
          field.required ? h('span', { style: { color: 'red' } }, '*') : null,
        ]),
        h('input', {
          type: field.type || 'text',
          value: values[field.name] || '',
          onInput: (e: any) => { values[field.name] = e.target.value; },
          style: { padding: '6px', width: '100%' },
        }),
        errors[field.name] ? h('p', { style: { color: 'red', fontSize: '12px', margin: '4px 0 0' } }, errors[field.name]) : null,
      ])),
      h('button', { type: 'submit', style: { padding: '8px 16px', cursor: 'pointer' } }, props.config.submitText),
    ]);
  },
});

const loginForm = new FormBuilder().setTitle('登录').setSubmitText('登录')
  .addField({ name: 'username', label: '用户名', type: 'text', required: true })
  .addField({ name: 'password', label: '密码', type: 'password', required: true })
  .build();

const handleSubmit = (v: any) => alert(JSON.stringify(v));
</script>`,
      nodejs: `// 产品
interface RequestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  timeout?: number;
  retries?: number;
}

// 建造者
class RequestBuilder {
  private config: any = { headers: {} };

  get(url: string): RequestBuilder { this.config.method = 'GET'; this.config.url = url; return this; }
  post(url: string): RequestBuilder { this.config.method = 'POST'; this.config.url = url; return this; }
  put(url: string): RequestBuilder { this.config.method = 'PUT'; this.config.url = url; return this; }
  delete(url: string): RequestBuilder { this.config.method = 'DELETE'; this.config.url = url; return this; }
  addHeader(key: string, value: string): RequestBuilder { this.config.headers[key] = value; return this; }
  setBody(body: any): RequestBuilder { this.config.body = body; return this; }
  setTimeout(ms: number): RequestBuilder { this.config.timeout = ms; return this; }
  setRetries(n: number): RequestBuilder { this.config.retries = n; return this; }

  build(): RequestConfig {
    if (!this.config.method || !this.config.url) throw new Error('Method and URL required');
    return this.config;
  }

  async execute(): Promise<any> {
    const config = this.build();
    console.log(\`Request: \${config.method} \${config.url}\`);
    console.log('Headers:', JSON.stringify(config.headers));
    if (config.body) console.log('Body:', JSON.stringify(config.body));
    return new Promise(resolve => setTimeout(() => resolve({ status: 200, data: { ok: true } }), 100));
  }
}

// 使用
async function main() {
  console.log('=== GET ===');
  const getResult = await new RequestBuilder()
    .get('https://api.example.com/users')
    .addHeader('Authorization', 'Bearer token123')
    .setTimeout(5000)
    .setRetries(3)
    .execute();
  console.log('Response:', JSON.stringify(getResult));

  console.log('\\n=== POST ===');
  const postResult = await new RequestBuilder()
    .post('https://api.example.com/users')
    .addHeader('Authorization', 'Bearer token123')
    .setBody({ name: 'Alice', email: 'alice@example.com' })
    .execute();
  console.log('Response:', JSON.stringify(postResult));
}

main();`,
    },
  },

  singleton: {
    id: 'singleton',
    name: 'Singleton (单例)',
    category: 'creational',
    description: '保证一个类仅有一个实例，并提供一个访问它的全局访问点。',
    useCases: [
      '当类只能有一个实例而且客户可以从一个众所周知的访问点访问它时',
      '当这个唯一实例应该是通过子类化可扩展的，并且客户应该无需更改代码就能使用一个扩展的实例时',
      '配置管理、日志记录、连接池等场景',
    ],
    pros: [
      '保证一个类只有一个实例',
      '获得了一个指向该实例的全局访问节点',
      '仅在首次请求单例对象时对其进行初始化',
    ],
    cons: [
      '违反了单一职责原则（同时解决了两个问题）',
      '多线程环境下需要特殊处理',
      '单元测试困难，难以 mock',
    ],
    codeExamples: {
      typescript: `class AppConfig {
  private static instance: AppConfig;
  private config: Map<string, string>;

  private constructor() {
    this.config = new Map();
    this.config.set('appName', 'MyApp');
    this.config.set('version', '1.0.0');
    this.config.set('port', '3000');
  }

  public static getInstance(): AppConfig {
    if (!AppConfig.instance) {
      AppConfig.instance = new AppConfig();
    }
    return AppConfig.instance;
  }

  get(key: string): string | undefined { return this.config.get(key); }
  set(key: string, value: string): void { this.config.set(key, value); }
  getAll(): Record<string, string> { return Object.fromEntries(this.config); }
}

const c1 = AppConfig.getInstance();
const c2 = AppConfig.getInstance();
console.log('Same instance:', c1 === c2); // true
console.log('App name:', c1.get('appName'));
c2.set('env', 'production');
console.log('Env from c1:', c1.get('env')); // production`,
      react: `import React, { createContext, useContext, useState, useCallback } from 'react';

interface AppState {
  user: { id: string; name: string } | null;
  theme: 'light' | 'dark';
}

interface AppContextType extends AppState {
  setUser: (user: any) => void;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<any> = ({ children }) => {
  const [state, setState] = useState<AppState>({ user: null, theme: 'light' });

  const setUser = useCallback((user: any) => setState(s => ({ ...s, user })), []);
  const toggleTheme = useCallback(() => setState(s => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' })), []);

  return (
    <AppContext.Provider value={{ ...state, setUser, toggleTheme }}>
      {children}
    </AppContext.Provider>
  );
};

export function useAppState(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

// 使用
const UserProfile: React.FC = () => {
  const { user, setUser } = useAppState();
  if (!user) return <button onClick={() => setUser({ id: '1', name: 'Alice' })}>登录</button>;
  return <div>欢迎, {user.name}</div>;
};

export default UserProfile;`,
      vue: `<template>
  <div>
    <p>用户: {{ user?.name || '未登录' }}</p>
    <button @click="login">登录</button>
  </div>
</template>

<script setup lang="ts">
import { reactive, readonly, provide, inject } from 'vue';

interface AppState {
  user: { id: string; name: string } | null;
  theme: 'light' | 'dark';
}

const state = reactive<AppState>({ user: null, theme: 'light' });

function login() { state.user = { id: '1', name: 'Alice' }; }
function toggleTheme() { state.theme = state.theme === 'light' ? 'dark' : 'light'; }

export function provideAppState() {
  provide('appState', readonly(state));
  provide('appActions', { login, toggleTheme });
}

const user = inject('appState') as any;
</script>`,
      nodejs: `class DatabaseConnection {
  private static instance: DatabaseConnection | null = null;
  private pool: any[];
  private config: object;

  private constructor(config: object) {
    this.config = config;
    this.pool = [];
    this.initializePool();
  }

  static getInstance(config?: object): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      if (!config) throw new Error('Config required for first init');
      DatabaseConnection.instance = new DatabaseConnection(config);
    }
    return DatabaseConnection.instance;
  }

  private initializePool(): void {
    console.log('Initializing connection pool...');
    for (let i = 0; i < 5; i++) this.pool.push({ id: i, busy: false });
  }

  getConnection(): any {
    const conn = this.pool.find((c: any) => !c.busy);
    if (!conn) throw new Error('No available connections');
    conn.busy = true;
    return conn;
  }

  releaseConnection(conn: any): void {
    const c = this.pool.find((x: any) => x.id === conn.id);
    if (c) c.busy = false;
  }

  getPoolSize(): number { return this.pool.length; }
}

const db1 = DatabaseConnection.getInstance({ host: 'localhost', port: 5432 });
const db2 = DatabaseConnection.getInstance();
console.log('Same instance:', db1 === db2); // true
console.log('Pool size:', db1.getPoolSize()); // 5
const conn = db1.getConnection();
console.log('Got connection:', conn.id);
db1.releaseConnection(conn);`,
    },
  },

  prototype: {
    id: 'prototype',
    name: 'Prototype (原型)',
    category: 'creational',
    description: '用原型实例指定创建对象的种类，并且通过拷贝这些原型创建新的对象。',
    useCases: [
      '当要实例化的类是在运行时刻指定时，例如通过动态装载',
      '为了避免创建一个与产品类层次平行的工厂类层次时',
      '当一个类的实例只能有几个不同状态组合中的一种时，建立相应数目的原型并克隆它们可能更方便',
    ],
    pros: [
      '可以克隆对象，而无需与它们所属的具体类相耦合',
      '可以克隆预生成原型，避免反复运行初始化代码',
      '可以更方便地生成复杂对象',
      '可以用继承以外的方式来处理复杂对象的不同配置',
    ],
    cons: [
      '克隆包含循环引用的复杂对象可能会非常麻烦',
      '需要为每个类实现克隆方法，深浅拷贝需要注意',
    ],
    codeExamples: {
      typescript: `interface Prototype { clone(): Prototype; }

class Shape implements Prototype {
  x: number; y: number; color: string;
  constructor(x: number, y: number, color: string) { this.x = x; this.y = y; this.color = color; }
  clone(): Shape { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
  getInfo(): string { return \`Shape at (\${this.x}, \${this.y}), color: \${this.color}\`; }
}

class Circle extends Shape {
  radius: number;
  constructor(x: number, y: number, color: string, radius: number) { super(x, y, color); this.radius = radius; }
  clone(): Circle { const c = super.clone() as Circle; c.radius = this.radius; return c; }
  getInfo(): string { return \`Circle at (\${this.x}, \${this.y}), r=\${this.radius}, color: \${this.color}\`; }
}

// 原型注册表
class ShapeCache {
  private cache = new Map<string, Shape>();
  register(key: string, shape: Shape): void { this.cache.set(key, shape); }
  get(key: string): Shape | undefined { const s = this.cache.get(key); return s ? s.clone() : undefined; }
}

const cache = new ShapeCache();
cache.register('redCircle', new Circle(0, 0, 'red', 10));
cache.register('blueCircle', new Circle(10, 10, 'blue', 20));

const c1 = cache.get('redCircle');
const c2 = cache.get('redCircle');
console.log(c1?.getInfo());
console.log(c2?.getInfo());
console.log('Same object?', c1 === c2); // false`,
      react: `import React, { useState } from 'react';

interface ComponentConfig {
  type: string;
  label: string;
  style: React.CSSProperties;
}

class ComponentPrototype {
  private prototypes = new Map<string, ComponentConfig>();
  register(name: string, config: ComponentConfig): void {
    this.prototypes.set(name, JSON.parse(JSON.stringify(config)));
  }
  clone(name: string): ComponentConfig | null {
    const p = this.prototypes.get(name);
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }
  getKeys(): string[] { return Array.from(this.prototypes.keys()); }
}

const registry = new ComponentPrototype();
registry.register('primaryBtn', { type: 'button', label: 'Primary', style: { padding: '8px 16px', background: '#1890ff', color: 'white', borderRadius: 4 } });
registry.register('dangerBtn', { type: 'button', label: 'Danger', style: { padding: '8px 16px', background: '#ff4d4f', color: 'white', borderRadius: 4 } });

const PrototypeDemo: React.FC = () => {
  const [instances, setInstances] = useState<ComponentConfig[]>([]);
  const clone = (name: string) => {
    const config = registry.clone(name);
    if (config) setInstances((prev) => [...prev, config]);
  };
  return (
    <div>
      <h3>原型模式 - 组件克隆</h3>
      <div style={{ marginBottom: 16 }}>
        {registry.getKeys().map(k => (
          <button key={k} onClick={() => clone(k)} style={{ marginRight: 8 }}>克隆 {k}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {instances.map((c, i) =>
          React.createElement(c.type, { key: i, style: c.style }, c.label)
        )}
      </div>
    </div>
  );
};

export default PrototypeDemo;`,
      vue: `<template>
  <div>
    <h3>原型模式 - 组件克隆</h3>
    <div style="margin-bottom: 16px;">
      <button v-for="proto in prototypes" :key="proto.name" @click="clone(proto.name)" style="margin-right: 8px;">
        克隆 {{ proto.name }}
      </button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div v-for="(config, idx) in instances" :key="idx" :style="config.style">
        {{ config.label }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';

interface Config { name: string; label: string; style: Record<string, string>; }

class ComponentPrototype {
  private prototypes = new Map<string, Config>();
  register(name: string, config: Omit<Config, 'name'>): void {
    this.prototypes.set(name, { name, ...JSON.parse(JSON.stringify(config)) });
  }
  clone(name: string): Config | null {
    const p = this.prototypes.get(name);
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }
  getAll(): Config[] { return Array.from(this.prototypes.values()); }
}

const registry = new ComponentPrototype();
registry.register('primaryBtn', { label: 'Primary', style: { padding: '8px 16px', background: '#1890ff', color: 'white', borderRadius: '4px', cursor: 'pointer' } });
registry.register('dangerBtn', { label: 'Danger', style: { padding: '8px 16px', background: '#ff4d4f', color: 'white', borderRadius: '4px', cursor: 'pointer' } });

const prototypes = registry.getAll();
const instances = reactive<Config[]>([]);
function clone(name: string) {
  const c = registry.clone(name);
  if (c) instances.push(c);
}
</script>`,
      nodejs: `class UserConfig {
  username: string;
  theme: string;
  notifications: any;
  plugins: string[];

  constructor(username: string, theme: string, notifications: any, plugins: string[]) {
    this.username = username;
    this.theme = theme;
    this.notifications = notifications;
    this.plugins = plugins;
  }

  clone(): UserConfig { return JSON.parse(JSON.stringify(this)); }
  getInfo(): string { return \`User: \${this.username}, Theme: \${this.theme}, Plugins: \${this.plugins.length}\`; }
}

class ConfigManager {
  private prototypes = new Map<string, UserConfig>();
  register(name: string, proto: UserConfig): void { this.prototypes.set(name, proto); }
  get(name: string): UserConfig | null { const p = this.prototypes.get(name); return p ? p.clone() : null; }
}

const manager = new ConfigManager();
manager.register('basic', new UserConfig('default', 'light', { email: true }, ['core']));
manager.register('pro', new UserConfig('default', 'dark', { email: true, push: true }, ['core', 'analytics', 'security']));

const user1 = manager.get('basic')!;
user1.username = 'alice';
console.log(user1.getInfo());

const user2 = manager.get('pro')!;
user2.username = 'bob';
user2.plugins.push('custom');
console.log(user2.getInfo());

console.log('Same object?', user1 === user2); // false`,
    },
  },

  // ==================== 结构型 Structural ====================

  adapter: {
    id: 'adapter',
    name: 'Adapter (适配器)',
    category: 'structural',
    description: '将一个类的接口转换成客户希望的另外一个接口。适配器模式使得原本由于接口不兼容而不能一起工作的那些类可以一起工作。',
    useCases: [
      '你想使用一个已经存在的类，而它的接口不符合你的需求',
      '你想创建一个可以复用的类，该类可以与其他不相关的类或不可预见的类协同工作',
      '你需要使用一些现存的子类，但是对每一个都进行子类化以匹配它们的接口是不现实的',
    ],
    pros: [
      '单一职责原则：可以将接口或数据转换代码从程序主要业务逻辑中分离',
      '开闭原则：只要客户端代码通过客户端接口与适配器进行交互，就能在不修改现有客户端代码的情况下在程序中添加新类型的适配器',
    ],
    cons: [
      '代码整体复杂度增加，因为需要新增一系列接口和类',
      '有时直接更改服务类使其与其他代码兼容会更简单',
    ],
    codeExamples: {
      typescript: `// 目标接口
interface MediaPlayer { play(audioType: string, filename: string): void; }

// 被适配者
interface AdvancedMediaPlayer {
  playVlc(filename: string): void;
  playMp4(filename: string): void;
}

class VlcPlayer implements AdvancedMediaPlayer {
  playVlc(filename: string): void { console.log('Playing vlc:', filename); }
  playMp4(filename: string): void {}
}

class Mp4Player implements AdvancedMediaPlayer {
  playVlc(filename: string): void {}
  playMp4(filename: string): void { console.log('Playing mp4:', filename); }
}

// 适配器
class MediaAdapter implements MediaPlayer {
  private player: AdvancedMediaPlayer;
  constructor(audioType: string) {
    if (audioType === 'vlc') this.player = new VlcPlayer();
    else if (audioType === 'mp4') this.player = new Mp4Player();
    else throw new Error('Unsupported type');
  }
  play(audioType: string, filename: string): void {
    if (audioType === 'vlc') this.player.playVlc(filename);
    else if (audioType === 'mp4') this.player.playMp4(filename);
  }
}

// 客户端
class AudioPlayer implements MediaPlayer {
  private adapter: MediaAdapter | null = null;
  play(audioType: string, filename: string): void {
    if (audioType === 'mp3') console.log('Playing mp3:', filename);
    else if (audioType === 'vlc' || audioType === 'mp4') {
      this.adapter = new MediaAdapter(audioType);
      this.adapter.play(audioType, filename);
    } else console.log('Invalid format');
  }
}

const player = new AudioPlayer();
player.play('mp3', 'song.mp3');
player.play('mp4', 'video.mp4');
player.play('vlc', 'movie.vlc');`,
      react: `import React from 'react';

// 旧组件（被适配者）
const OldButton: React.FC<any> = ({ label, onClickHandler }) => (
  <button onClick={onClickHandler} style={{ padding: '10px 20px', background: '#eee', border: '1px solid #ccc', cursor: 'pointer' }}>
    {label}
  </button>
);

// 适配器组件（新接口）
interface ButtonProps {
  text: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}

const ButtonAdapter: React.FC<ButtonProps> = ({ text, onPress, variant = 'primary' }) => {
  const styledLabel = variant === 'primary' ? \`[Primary] \${text}\` : \`[Secondary] \${text}\`;
  return <OldButton label={styledLabel} onClickHandler={onPress} />;
};

// 使用
const AdapterDemo: React.FC = () => (
  <div style={{ display: 'flex', gap: 10 }}>
    <ButtonAdapter text="点击我" onPress={() => alert('Primary')} variant="primary" />
    <ButtonAdapter text="取消" onPress={() => alert('Secondary')} variant="secondary" />
  </div>
);

export default AdapterDemo;`,
      vue: `<template>
  <div style="display: flex; gap: 10px;">
    <ButtonAdapter text="点击我" :on-press="handlePrimary" variant="primary" />
    <ButtonAdapter text="取消" :on-press="handleSecondary" variant="secondary" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue';

const OldButton = defineComponent({
  name: 'OldButton',
  props: { label: String, onClickHandler: Function },
  setup(props) {
    return () => h('button', {
      onClick: props.onClickHandler,
      style: { padding: '10px 20px', background: '#eee', border: '1px solid #ccc', cursor: 'pointer' },
    }, props.label);
  },
});

const ButtonAdapter = defineComponent({
  name: 'ButtonAdapter',
  props: { text: String, onPress: Function, variant: { type: String, default: 'primary' } },
  setup(props) {
    const label = computed(() =>
      props.variant === 'primary' ? \`[Primary] \${props.text}\` : \`[Secondary] \${props.text}\`
    );
    return () => h(OldButton, { label: label.value, onClickHandler: props.onPress });
  },
});

const handlePrimary = () => alert('Primary');
const handleSecondary = () => alert('Secondary');
</script>`,
      nodejs: `// 目标接口
interface PaymentProcessor {
  pay(amount: number): void;
  refund(txId: string, amount: number): void;
}

// 被适配者（第三方SDK）
class ThirdPartyPayment {
  makePayment(amount: number, currency: string): string {
    console.log(\`ThirdParty: Pay \${amount} \${currency}\`);
    return 'txn_' + Date.now();
  }
  makeRefund(txId: string, amount: number): boolean {
    console.log(\`ThirdParty: Refund \${amount}, tx: \${txId}\`);
    return true;
  }
}

// 适配器
class PaymentAdapter implements PaymentProcessor {
  private thirdParty: ThirdPartyPayment;
  private currency: string;
  constructor(currency = 'CNY') {
    this.thirdParty = new ThirdPartyPayment();
    this.currency = currency;
  }
  pay(amount: number): void {
    const txId = this.thirdParty.makePayment(amount, this.currency);
    console.log('支付成功，交易号:', txId);
  }
  refund(txId: string, amount: number): void {
    const success = this.thirdParty.makeRefund(txId, amount);
    console.log('退款结果:', success ? '成功' : '失败');
  }
}

const payment: PaymentProcessor = new PaymentAdapter('CNY');
payment.pay(100);
payment.refund('txn_123', 50);`,
    },
  },

  decorator: {
    id: 'decorator',
    name: 'Decorator (装饰器)',
    category: 'structural',
    description: '动态地给一个对象添加一些额外的职责。就增加功能来说，装饰器模式相比生成子类更为灵活。',
    useCases: [
      '在不影响其他对象的情况下，以动态、透明的方式给单个对象添加职责',
      '处理那些可以撤消的职责',
      '当不能采用生成子类的方法进行扩充时',
    ],
    pros: [
      '无需创建新子类即可扩展对象的行为',
      '可以在运行时添加或删除对象的功能',
      '可以用多个装饰器组合多种行为',
      '单一职责原则：可以将实现了许多不同行为的一个大类拆分为多个较小的类',
    ],
    cons: [
      '在装饰器栈中删除特定装饰器比较困难',
      '实现行为不受装饰器栈顺序影响的装饰器比较困难',
      '代码的总体复杂度可能会增加',
    ],
    codeExamples: {
      typescript: `interface Coffee { cost(): number; description(): string; }

class SimpleCoffee implements Coffee {
  cost(): number { return 10; }
  description(): string { return 'Simple coffee'; }
}

abstract class CoffeeDecorator implements Coffee {
  protected coffee: Coffee;
  constructor(coffee: Coffee) { this.coffee = coffee; }
  cost(): number { return this.coffee.cost(); }
  description(): string { return this.coffee.description(); }
}

class MilkDecorator extends CoffeeDecorator {
  cost(): number { return super.cost() + 3; }
  description(): string { return super.description() + ', with milk'; }
}

class SugarDecorator extends CoffeeDecorator {
  cost(): number { return super.cost() + 1; }
  description(): string { return super.description() + ', with sugar'; }
}

class WhipDecorator extends CoffeeDecorator {
  cost(): number { return super.cost() + 5; }
  description(): string { return super.description() + ', with whip'; }
}

let coffee: Coffee = new SimpleCoffee();
console.log(coffee.description(), '-', coffee.cost());
coffee = new MilkDecorator(coffee);
coffee = new SugarDecorator(coffee);
coffee = new WhipDecorator(coffee);
console.log(coffee.description(), '-', coffee.cost());`,
      react: `import React, { useState } from 'react';

// HOC 装饰器：加载状态
function withLoading<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return ({ loading, loadingText = '加载中...', ...props }: any) => {
    if (loading) return <button disabled style={{ padding: '8px 16px', opacity: 0.6, cursor: 'not-allowed' }}>{loadingText}</button>;
    return <WrappedComponent {...(props as P)} />;
  };
}

// HOC 装饰器：日志
function withLogger<P extends { onClick?: () => void }>(WrappedComponent: React.ComponentType<P>) {
  return (props: P) => {
    const enhancedOnClick = () => {
      console.log('Clicked at:', new Date().toISOString());
      props.onClick?.();
    };
    return <WrappedComponent {...props} onClick={enhancedOnClick} />;
  };
}

const SimpleButton: React.FC<any> = ({ label, onClick }) => (
  <button onClick={onClick} style={{ padding: '8px 16px', cursor: 'pointer' }}>{label}</button>
);

const EnhancedButton = withLoading(withLogger(SimpleButton));

const DecoratorDemo: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const handleClick = () => { setLoading(true); setTimeout(() => setLoading(false), 1500); };
  return (
    <div>
      <h3>装饰器模式 - HOC</h3>
      <EnhancedButton label="提交" onClick={handleClick} loading={loading} loadingText="提交中..." />
    </div>
  );
};

export default DecoratorDemo;`,
      vue: `<template>
  <div>
    <h3>装饰器模式</h3>
    <EnhancedButton label="提交" :on-click="handleClick" :loading="loading" loading-text="提交中..." />
  </div>
</template>

<script setup lang="ts">
import { ref, defineComponent, h } from 'vue';

const SimpleButton = defineComponent({
  name: 'SimpleButton',
  props: { label: String, onClick: Function },
  setup(props) {
    return () => h('button', { onClick: props.onClick, style: { padding: '8px 16px', cursor: 'pointer' } }, props.label);
  },
});

function withLoading(Wrapped: any) {
  return defineComponent({
    name: 'WithLoading',
    props: { loading: Boolean, loadingText: { type: String, default: '加载中...' } },
    setup(props, { attrs }) {
      return () => {
        if (props.loading) return h('button', { disabled: true, style: { padding: '8px 16px', opacity: 0.6, cursor: 'not-allowed' } }, props.loadingText);
        return h(Wrapped, attrs);
      };
    },
  });
}

const EnhancedButton = withLoading(SimpleButton);
const loading = ref(false);
const handleClick = () => { loading.value = true; setTimeout(() => { loading.value = false; }, 1500); };
</script>`,
      nodejs: `interface DataService { fetchData(id: string): Promise<any>; }

class ApiService implements DataService {
  async fetchData(id: string): Promise<any> {
    console.log('Fetching data for id:', id);
    return new Promise(r => setTimeout(() => r({ id, data: 'some data' }), 100));
  }
}

class ServiceDecorator implements DataService {
  protected service: DataService;
  constructor(service: DataService) { this.service = service; }
  async fetchData(id: string): Promise<any> { return this.service.fetchData(id); }
}

class CacheDecorator extends ServiceDecorator {
  private cache = new Map<string, any>();
  async fetchData(id: string): Promise<any> {
    if (this.cache.has(id)) { console.log('Cache hit:', id); return this.cache.get(id); }
    const data = await super.fetchData(id);
    this.cache.set(id, data);
    return data;
  }
}

class LogDecorator extends ServiceDecorator {
  async fetchData(id: string): Promise<any> {
    console.log(\`[LOG] Fetch start: \${id}\`);
    const start = Date.now();
    const result = await super.fetchData(id);
    console.log(\`[LOG] Fetch done: \${id}, time: \${Date.now() - start}ms\`);
    return result;
  }
}

async function main() {
  let service: DataService = new ApiService();
  service = new LogDecorator(service);
  service = new CacheDecorator(service);

  const d1 = await service.fetchData('user-1');
  console.log('Result 1:', d1);
  const d2 = await service.fetchData('user-1'); // cache hit
  console.log('Result 2:', d2);
}

main();`,
    },
  },

  proxy: {
    id: 'proxy',
    name: 'Proxy (代理)',
    category: 'structural',
    description: '为其他对象提供一种代理以控制对这个对象的访问。',
    useCases: [
      '远程代理：为一个对象在不同的地址空间提供局部代表',
      '虚拟代理：根据需要创建开销很大的对象',
      '保护代理：控制对原始对象的访问，用于对象有不同的访问权限时',
      '智能指引：取代了简单的指针，它在访问对象时执行一些附加操作',
    ],
    pros: [
      '可以在客户端毫无察觉的情况下控制服务对象',
      '如果客户端对服务对象的生命周期没有特殊要求，可以对生命周期进行管理',
      '即使服务对象还未准备好或不存在，代理也可以正常工作',
      '开闭原则：可以在不对服务或客户端做出修改的情况下创建新代理',
    ],
    cons: [
      '代码可能会变得复杂，因为需要新建许多类',
      '服务响应可能会延迟',
    ],
    codeExamples: {
      typescript: `interface Image { display(): void; }

class RealImage implements Image {
  private filename: string;
  constructor(filename: string) { this.filename = filename; this.loadFromDisk(); }
  private loadFromDisk(): void { console.log('Loading:', this.filename); }
  display(): void { console.log('Displaying:', this.filename); }
}

class ProxyImage implements Image {
  private realImage: RealImage | null = null;
  private filename: string;
  constructor(filename: string) { this.filename = filename; }
  display(): void {
    if (!this.realImage) this.realImage = new RealImage(this.filename);
    this.realImage.display();
  }
}

const img1: Image = new ProxyImage('photo1.jpg');
const img2: Image = new ProxyImage('photo2.jpg');
console.log('First call to img1:');
img1.display(); // loads + displays
console.log('Second call to img1:');
img1.display(); // displays only
console.log('First call to img2:');
img2.display();`,
      react: `import React, { useState, useEffect, useRef } from 'react';

// 虚拟代理：懒加载图片
const LazyImage: React.FC<any> = ({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect(); }
    }, { threshold: 0.1 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', minHeight: '200px', background: '#f0f0f0' }}>
      {inView ? (
        <>
          {!loaded && <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>加载中...</div>}
          <img src={src} alt={alt} onLoad={() => setLoaded(true)}
            style={{ width: '100%', height: 'auto', display: loaded ? 'block' : 'none' }} />
        </>
      ) : <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>滚动加载</div>}
    </div>
  );
};

const ProxyDemo: React.FC = () => (
  <div>
    <h3>代理模式 - 图片懒加载</h3>
    <div style={{ height: '500px', background: '#fafafa' }}><p>向下滚动...</p></div>
    <LazyImage src="https://picsum.photos/800/400?random=1" alt="示例" />
  </div>
);

export default ProxyDemo;`,
      vue: `<template>
  <div>
    <h3>代理模式 - 图片懒加载</h3>
    <div style="height: 500px; background: #fafafa;"><p>向下滚动...</p></div>
    <LazyImage src="https://picsum.photos/800/400?random=1" alt="示例" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, defineComponent, h } from 'vue';

const LazyImage = defineComponent({
  name: 'LazyImage',
  props: { src: String, alt: String },
  setup(props) {
    const loaded = ref(false);
    const inView = ref(false);
    const containerRef = ref<HTMLElement | null>(null);
    let observer: IntersectionObserver | null = null;

    onMounted(() => {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { inView.value = true; observer?.disconnect(); }
      }, { threshold: 0.1 });
      if (containerRef.value) observer.observe(containerRef.value);
    });
    onUnmounted(() => observer?.disconnect());

    return () =>
      h('div', { ref: containerRef, style: { width: '100%', minHeight: '200px', background: '#f0f0f0' } }, [
        inView.value
          ? h('img', {
              src: props.src, alt: props.alt,
              onLoad: () => { loaded.value = true; },
              style: { width: '100%', height: 'auto' },
            })
          : h('div', { style: { padding: '20px', textAlign: 'center', color: '#999' } }, '滚动加载'),
      ]);
  },
});
</script>`,
      nodejs: `interface ExpensiveService { process(data: string): string; }

class RealService implements ExpensiveService {
  constructor() {
    console.log('RealService: 初始化（耗时操作）...');
    this.heavyInit();
    console.log('RealService: 初始化完成');
  }
  private heavyInit(): void { for (let i = 0; i < 1000000; i++) {} }
  process(data: string): string {
    console.log('RealService: 处理:', data);
    return 'processed_' + data;
  }
}

// 虚拟代理（延迟初始化）
class LazyProxy implements ExpensiveService {
  private real: RealService | null = null;
  private getReal(): RealService {
    if (!this.real) { console.log('LazyProxy: 首次调用，初始化...'); this.real = new RealService(); }
    return this.real;
  }
  process(data: string): string { return this.getReal().process(data); }
}

// 保护代理（权限控制）
class ProtectedProxy implements ExpensiveService {
  private real: ExpensiveService;
  private apiKey: string;
  constructor(real: ExpensiveService, apiKey: string) { this.real = real; this.apiKey = apiKey; }
  process(data: string): string {
    if (this.apiKey !== 'valid-key-123') throw new Error('Permission denied');
    console.log('ProtectedProxy: 权限验证通过');
    return this.real.process(data);
  }
}

console.log('=== 虚拟代理 ===');
const lazy = new LazyProxy();
console.log('代理已创建，真实服务尚未初始化');
console.log('第一次调用:');
const r1 = lazy.process('data1');
console.log('结果:', r1);
console.log('第二次调用:');
const r2 = lazy.process('data2');
console.log('结果:', r2);

console.log('\\n=== 保护代理 ===');
const prot = new ProtectedProxy(lazy, 'valid-key-123');
try {
  const r3 = prot.process('data3');
  console.log('结果:', r3);
} catch (e: any) {
  console.log('错误:', e.message);
}`,
    },
  },

  composite: {
    id: 'composite',
    name: 'Composite (组合)',
    category: 'structural',
    description: '将对象组合成树形结构以表示"部分-整体"的层次结构。组合模式使得用户对单个对象和组合对象的使用具有一致性。',
    useCases: [
      '你想表示对象的部分-整体层次结构',
      '你希望用户忽略组合对象与单个对象的不同，用户将统一地使用组合结构中的所有对象',
      '文件系统、菜单、UI 组件树等场景',
    ],
    pros: [
      '可以利用多态和递归机制更方便地使用复杂树结构',
      '开闭原则：无需更改现有代码，就可以在应用中添加新元素',
      '简化客户端代码，客户端无需关心处理的是单个对象还是组合对象',
    ],
    cons: [
      '对于功能差异较大的类，提供公共接口可能会很困难',
      '在某些情况下，组件的接口可能会过于一般化',
    ],
    codeExamples: {
      typescript: `interface FileSystemNode {
  getName(): string;
  getSize(): number;
  print(indent?: string): void;
}

class FileNode implements FileSystemNode {
  constructor(private name: string, private size: number) {}
  getName(): string { return this.name; }
  getSize(): number { return this.size; }
  print(indent = ''): void { console.log(\`\${indent}- [File] \${this.name} (\${this.size}KB)\`); }
}

class DirectoryNode implements FileSystemNode {
  private children: FileSystemNode[] = [];
  constructor(private name: string) {}
  add(child: FileSystemNode): void { this.children.push(child); }
  remove(child: FileSystemNode): void {
    const i = this.children.indexOf(child);
    if (i > -1) this.children.splice(i, 1);
  }
  getName(): string { return this.name; }
  getSize(): number { return this.children.reduce((t, c) => t + c.getSize(), 0); }
  print(indent = ''): void {
    console.log(\`\${indent}+ [Dir] \${this.name} (\${this.getSize()}KB)\`);
    this.children.forEach(c => c.print(indent + '  '));
  }
}

const root = new DirectoryNode('root');
const docs = new DirectoryNode('documents');
docs.add(new FileNode('report.pdf', 2048));
docs.add(new FileNode('notes.txt', 50));
const images = new DirectoryNode('images');
images.add(new FileNode('photo1.jpg', 5120));
images.add(new FileNode('photo2.jpg', 4096));
root.add(docs);
root.add(images);
root.add(new FileNode('readme.md', 100));
root.print();
console.log('Total size:', root.getSize(), 'KB');`,
      react: `import React, { useState } from 'react';

const LeafNode: React.FC<any> = ({ label, icon = '📄' }) => (
  <div style={{ paddingLeft: '20px', lineHeight: '24px' }}>{icon} {label}</div>
);

const CompositeNode: React.FC<any> = ({ label, icon = '📁', defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div>
      <div onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer', lineHeight: '24px' }}>
        <span style={{ marginRight: 4 }}>{isOpen ? '▼' : '▶'}</span>{icon} {label}
      </div>
      {isOpen && <div style={{ paddingLeft: '20px' }}>{children}</div>}
    </div>
  );
};

const CompositeDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif', fontSize: '14px' }}>
    <h3>组合模式 - 文件树</h3>
    <CompositeNode label="root" defaultOpen>
      <CompositeNode label="documents">
        <LeafNode label="report.pdf" icon="📕" />
        <LeafNode label="notes.txt" icon="📝" />
      </CompositeNode>
      <CompositeNode label="images">
        <LeafNode label="photo1.jpg" icon="🖼️" />
        <LeafNode label="photo2.jpg" icon="🖼️" />
      </CompositeNode>
      <LeafNode label="readme.md" icon="📋" />
    </CompositeNode>
  </div>
);

export default CompositeDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; font-size: 14px;">
    <h3>组合模式 - 文件树</h3>
    <CompositeNode label="root" :default-open="true">
      <CompositeNode label="documents">
        <LeafNode label="report.pdf" icon="📕" />
        <LeafNode label="notes.txt" icon="📝" />
      </CompositeNode>
      <CompositeNode label="images">
        <LeafNode label="photo1.jpg" icon="🖼️" />
      </CompositeNode>
      <LeafNode label="readme.md" icon="📋" />
    </CompositeNode>
  </div>
</template>

<script setup lang="ts">
import { ref, defineComponent, h } from 'vue';

const LeafNode = defineComponent({
  name: 'LeafNode',
  props: { label: String, icon: { type: String, default: '📄' } },
  setup(props) {
    return () => h('div', { style: { paddingLeft: '20px', lineHeight: '24px' } }, props.icon + ' ' + props.label);
  },
});

const CompositeNode = defineComponent({
  name: 'CompositeNode',
  props: { label: String, icon: { type: String, default: '📁' }, defaultOpen: { type: Boolean, default: true } },
  setup(props, { slots }) {
    const isOpen = ref(props.defaultOpen);
    const toggle = () => { isOpen.value = !isOpen.value; };
    return () => h('div', [
      h('div', { onClick: toggle, style: { cursor: 'pointer', lineHeight: '24px' } },
        (isOpen.value ? '▼ ' : '▶ ') + props.icon + ' ' + props.label
      ),
      isOpen.value ? h('div', { style: { paddingLeft: '20px' } }, slots.default?.()) : null,
    ]);
  },
});
</script>`,
      nodejs: `interface MenuComponent {
  getName(): string;
  getPrice(): number;
  print(indent?: string): void;
}

class MenuItem implements MenuComponent {
  constructor(private name: string, private price: number, private veg: boolean = false) {}
  getName(): string { return this.name; }
  getPrice(): number { return this.price; }
  print(indent = ''): void {
    const tag = this.veg ? ' [V]' : '';
    console.log(\`\${indent}- \${this.name} - ¥\${this.price}\${tag}\`);
  }
}

class Menu implements MenuComponent {
  private items: MenuComponent[] = [];
  constructor(private name: string, private desc: string) {}
  add(item: MenuComponent): void { this.items.push(item); }
  remove(item: MenuComponent): void {
    const i = this.items.indexOf(item);
    if (i > -1) this.items.splice(i, 1);
  }
  getName(): string { return this.name; }
  getPrice(): number { return this.items.reduce((s, i) => s + i.getPrice(), 0); }
  print(indent = ''): void {
    console.log(\`\${indent}===== \${this.name} =====\`);
    console.log(\`\${indent}  \${this.desc}\`);
    this.items.forEach(i => i.print(indent + '  '));
  }
}

const all = new Menu('全部菜单', '餐厅所有菜品');
const breakfast = new Menu('早餐', '晨间美味');
breakfast.add(new MenuItem('煎饼果子', 8, false));
breakfast.add(new MenuItem('豆浆', 3, true));
const lunch = new Menu('午餐', '午间套餐');
lunch.add(new MenuItem('红烧肉', 38, false));
lunch.add(new MenuItem('清炒时蔬', 18, true));
lunch.add(new MenuItem('米饭', 2, true));
all.add(breakfast);
all.add(lunch);
all.print();
console.log('\\n总价:', all.getPrice(), '元');`,
    },
  },

  bridge: {
    id: 'bridge',
    name: 'Bridge (桥接)',
    category: 'structural',
    description: '将抽象部分与它的实现部分分离，使它们都可以独立地变化。',
    useCases: [
      '你不希望在抽象和它的实现部分之间有一个固定的绑定关系',
      '类的抽象以及它的实现都应该可以通过生成子类的方法加以扩充',
      '对一个抽象的实现部分的修改应对客户不产生影响',
      '你想对客户完全隐藏抽象的实现部分',
    ],
    pros: [
      '可以创建与平台无关的类和程序',
      '客户端代码仅与高层抽象部分进行互动，不会接触到平台的详细信息',
      '开闭原则：可以新增抽象部分和实现部分，且它们之间不会相互影响',
      '单一职责原则：抽象部分专注于高层逻辑，实现部分处理平台细节',
    ],
    cons: [
      '对高内聚的类使用该模式可能会让代码更加复杂',
      '需要正确识别系统中两个独立变化的维度',
    ],
    codeExamples: {
      typescript: `// 实现层接口
interface Device {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  getVolume(): number;
  setVolume(percent: number): void;
  getChannel(): number;
  setChannel(channel: number): void;
}

// 抽象层
class RemoteControl {
  protected device: Device;
  constructor(device: Device) { this.device = device; }
  togglePower(): void {
    if (this.device.isEnabled()) this.device.disable();
    else this.device.enable();
    console.log('电源:', this.device.isEnabled() ? '开' : '关');
  }
  volumeDown(): void { this.device.setVolume(this.device.getVolume() - 10); console.log('音量:', this.device.getVolume()); }
  volumeUp(): void { this.device.setVolume(this.device.getVolume() + 10); console.log('音量:', this.device.getVolume()); }
  channelUp(): void { this.device.setChannel(this.device.getChannel() + 1); console.log('频道:', this.device.getChannel()); }
  channelDown(): void { this.device.setChannel(this.device.getChannel() - 1); console.log('频道:', this.device.getChannel()); }
}

// 扩展抽象
class AdvancedRemote extends RemoteControl {
  mute(): void { this.device.setVolume(0); console.log('静音'); }
}

// 具体实现
class TV implements Device {
  private on = false;
  private volume = 50;
  private channel = 1;
  isEnabled(): boolean { return this.on; }
  enable(): void { this.on = true; }
  disable(): void { this.on = false; }
  getVolume(): number { return this.volume; }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(100, v)); }
  getChannel(): number { return this.channel; }
  setChannel(c: number): void { this.channel = c; }
}

class Radio implements Device {
  private on = false;
  private volume = 30;
  private channel = 88;
  isEnabled(): boolean { return this.on; }
  enable(): void { this.on = true; }
  disable(): void { this.on = false; }
  getVolume(): number { return this.volume; }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(100, v)); }
  getChannel(): number { return this.channel; }
  setChannel(c: number): void { this.channel = c; }
}

const tv = new TV();
const tvRemote = new AdvancedRemote(tv);
tvRemote.togglePower();
tvRemote.volumeUp();
tvRemote.mute();

const radio = new Radio();
const radioRemote = new RemoteControl(radio);
radioRemote.togglePower();
radioRemote.volumeUp();`,
      react: `import React, { useState } from 'react';

// 实现层：主题
interface Theme { bgColor: string; textColor: string; accentColor: string; borderColor: string; }

const lightTheme: Theme = { bgColor: '#ffffff', textColor: '#333', accentColor: '#1890ff', borderColor: '#d9d9d9' };
const darkTheme: Theme = { bgColor: '#1f1f1f', textColor: '#fff', accentColor: '#40a9ff', borderColor: '#434343' };

// 抽象层组件
const ThemedButton: React.FC<any> = ({ theme, label, onClick }) => (
  <button onClick={onClick} style={{ padding: '8px 16px', backgroundColor: theme.accentColor, color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{label}</button>
);

const ThemedCard: React.FC<any> = ({ theme, title, children }) => (
  <div style={{ padding: '16px', backgroundColor: theme.bgColor, color: theme.textColor, border: \`1px solid \${theme.borderColor}\`, borderRadius: '8px' }}>
    <h3 style={{ marginTop: 0 }}>{title}</h3>{children}
  </div>
);

const BridgeDemo: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(lightTheme);
  const toggle = () => setTheme(theme === lightTheme ? darkTheme : lightTheme);

  return (
    <div style={{ padding: '20px', backgroundColor: theme.bgColor, minHeight: '200px' }}>
      <h3 style={{ color: theme.textColor }}>桥接模式 - 主题</h3>
      <ThemedCard theme={theme} title="卡片">
        <p>当前主题: {theme === lightTheme ? '浅色' : '深色'}</p>
        <ThemedButton theme={theme} label="切换主题" onClick={toggle} />
      </ThemedCard>
    </div>
  );
};

export default BridgeDemo;`,
      vue: `<template>
  <div :style="{ padding: '20px', backgroundColor: theme.bgColor, minHeight: '200px' }">
    <h3 :style="{ color: theme.textColor }">桥接模式 - 主题</h3>
    <ThemedCard :theme="theme" title="卡片">
      <p :style="{ color: theme.textColor }">当前主题: {{ themeName }}</p>
      <ThemedButton :theme="theme" label="切换主题" @click="toggle" />
    </ThemedCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, h } from 'vue';

interface Theme { bgColor: string; textColor: string; accentColor: string; borderColor: string; }

const lightTheme: Theme = { bgColor: '#ffffff', textColor: '#333', accentColor: '#1890ff', borderColor: '#d9d9d9' };
const darkTheme: Theme = { bgColor: '#1f1f1f', textColor: '#fff', accentColor: '#40a9ff', borderColor: '#434343' };

const isDark = ref(false);
const theme = computed(() => isDark.value ? darkTheme : lightTheme);
const themeName = computed(() => isDark.value ? '深色' : '浅色');
const toggle = () => { isDark.value = !isDark.value; };

const ThemedButton = defineComponent({
  name: 'ThemedButton',
  props: { theme: Object, label: String },
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      onClick: () => emit('click'),
      style: { padding: '8px 16px', backgroundColor: props.theme.accentColor, color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
    }, props.label);
  },
});

const ThemedCard = defineComponent({
  name: 'ThemedCard',
  props: { theme: Object, title: String },
  setup(props, { slots }) {
    return () => h('div', {
      style: { padding: '16px', backgroundColor: props.theme.bgColor, color: props.theme.textColor, border: '1px solid ' + props.theme.borderColor, borderRadius: '8px' },
    }, [h('h3', { style: { marginTop: 0 } }, props.title), slots.default?.()]);
  },
});
</script>`,
      nodejs: `// 实现层
interface DataStorage {
  save(key: string, data: any): void;
  load(key: string): any;
  delete(key: string): boolean;
  exists(key: string): boolean;
}

class MemoryStorage implements DataStorage {
  private store = new Map<string, any>();
  save(key: string, data: any): void { this.store.set(key, JSON.parse(JSON.stringify(data))); }
  load(key: string): any { const d = this.store.get(key); return d ? JSON.parse(JSON.stringify(d)) : null; }
  delete(key: string): boolean { return this.store.delete(key); }
  exists(key: string): boolean { return this.store.has(key); }
}

class FileStorage implements DataStorage {
  private dir: string;
  private fs = require('fs');
  private path = require('path');
  constructor(dir: string) {
    this.dir = dir;
    if (!this.fs.existsSync(dir)) this.fs.mkdirSync(dir, { recursive: true });
  }
  private p(key: string): string { return this.path.join(this.dir, key + '.json'); }
  save(key: string, data: any): void { this.fs.writeFileSync(this.p(key), JSON.stringify(data, null, 2)); }
  load(key: string): any {
    const p = this.p(key);
    if (!this.fs.existsSync(p)) return null;
    return JSON.parse(this.fs.readFileSync(p, 'utf8'));
  }
  delete(key: string): boolean {
    const p = this.p(key);
    if (this.fs.existsSync(p)) { this.fs.unlinkSync(p); return true; }
    return false;
  }
  exists(key: string): boolean { return this.fs.existsSync(this.p(key)); }
}

// 抽象层
class UserRepository {
  protected storage: DataStorage;
  constructor(storage: DataStorage) { this.storage = storage; }
  saveUser(user: any): void { this.storage.save('user:' + user.id, user); console.log('用户已保存:', user.name); }
  getUser(id: string): any { return this.storage.load('user:' + id); }
  deleteUser(id: string): boolean { return this.storage.delete('user:' + id); }
}

// 扩展抽象
class CachedUserRepo extends UserRepository {
  private cache = new Map<string, any>();
  constructor(storage: DataStorage) { super(storage); }
  getUser(id: string): any {
    const key = 'user:' + id;
    if (this.cache.has(key)) { console.log('缓存命中:', id); return this.cache.get(key); }
    const user = this.storage.load(key);
    if (user) this.cache.set(key, user);
    return user;
  }
  saveUser(user: any): void { super.saveUser(user); this.cache.set('user:' + user.id, user); }
  clearCache(): void { this.cache.clear(); console.log('缓存已清空'); }
}

const repo = new CachedUserRepo(new MemoryStorage());
repo.saveUser({ id: '1', name: 'Alice', email: 'alice@example.com' });
console.log('第一次获取:', repo.getUser('1')?.name);
console.log('第二次获取（缓存）:', repo.getUser('1')?.name);
repo.clearCache();
console.log('清缓存后:', repo.getUser('1')?.name);`,
    },
  },

  // ==================== 行为型 Behavioral ====================

  observer: {
    id: 'observer',
    name: 'Observer (观察者)',
    category: 'behavioral',
    description: '定义对象间的一种一对多的依赖关系，当一个对象的状态发生改变时，所有依赖于它的对象都得到通知并被自动更新。',
    useCases: [
      '当一个抽象模型有两个方面，其中一个方面依赖于另一个方面',
      '当对一个对象的改变需要同时改变其它对象，而不知道具体有多少对象有待改变',
      '当一个对象必须通知其它对象，而它又不能假定其它对象是谁',
      '事件驱动系统、订阅发布模式',
    ],
    pros: [
      '开闭原则：无需修改发布者代码就能引入新的订阅者类',
      '可以在运行时建立对象之间的联系',
      '支持广播通信，发布者无需知道订阅者的具体信息',
      '降低了目标与观察者之间的耦合关系',
    ],
    cons: [
      '订阅者的通知顺序是随机的',
      '如果观察者过多，通知可能会耗时',
      '如果观察者和被观察者之间存在循环依赖，可能导致系统崩溃',
    ],
    codeExamples: {
      typescript: `interface Observer<T> { update(data: T): void; }

interface Subject<T> {
  attach(observer: Observer<T>): void;
  detach(observer: Observer<T>): void;
  notify(data: T): void;
}

class NewsPublisher implements Subject<string> {
  private observers: Observer<string>[] = [];
  attach(obs: Observer<string>): void { this.observers.push(obs); }
  detach(obs: Observer<string>): void {
    const i = this.observers.indexOf(obs);
    if (i > -1) this.observers.splice(i, 1);
  }
  notify(news: string): void {
    console.log('发布新闻:', news);
    this.observers.forEach(o => o.update(news));
  }
  publishNews(news: string): void { this.notify(news); }
}

class EmailSubscriber implements Observer<string> {
  constructor(private email: string) {}
  update(news: string): void { console.log(\`[Email] \${this.email} 收到新闻: \${news}\`); }
}

class SMSSubscriber implements Observer<string> {
  constructor(private phone: string) {}
  update(news: string): void { console.log(\`[SMS] \${this.phone} 收到新闻: \${news}\`); }
}

class AppSubscriber implements Observer<string> {
  constructor(private appId: string) {}
  update(news: string): void { console.log(\`[APP] \${this.appId} 收到推送: \${news}\`); }
}

const publisher = new NewsPublisher();
const emailObs = new EmailSubscriber('user@example.com');
const smsObs = new SMSSubscriber('13800138000');
const appObs = new AppSubscriber('app-001');

publisher.attach(emailObs);
publisher.attach(smsObs);
publisher.attach(appObs);

publisher.publishNews('重大消息：TypeScript 5.0 发布！');
console.log('---');
publisher.detach(smsObs);
publisher.publishNews('快讯：新版本发布');`,
      react: `import React, { useState, useEffect, useCallback } from 'react';

// 简单的事件总线
type EventCallback = (data: any) => void;

class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  on(event: string, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }
  off(event: string, cb: EventCallback): void { this.listeners.get(event)?.delete(cb); }
  emit(event: string, data: any): void { this.listeners.get(event)?.forEach(cb => cb(data)); }
}

const bus = new EventBus();

const useEvent = (event: string, cb: EventCallback) => {
  useEffect(() => bus.on(event, cb), [event, cb]);
};

const Sender: React.FC = () => {
  const [msg, setMsg] = useState('');
  const send = () => { if (msg.trim()) { bus.emit('message', msg); setMsg(''); } };
  return (
    <div>
      <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="输入消息" style={{ padding: '4px', width: '200px' }} />
      <button onClick={send} style={{ marginLeft: '8px', padding: '4px 12px' }}>发送</button>
    </div>
  );
};

const Receiver: React.FC<any> = ({ name, color }) => {
  const [msgs, setMsgs] = useState<string[]>([]);
  const handleMsg = useCallback((data: any) => {
    setMsgs(prev => [...prev.slice(-4), data]);
  }, []);
  useEvent('message', handleMsg);
  return (
    <div style={{ marginTop: '12px', padding: '8px', border: \`2px solid \${color}\`, borderRadius: '4px', minHeight: '80px' }}>
      <div style={{ fontWeight: 'bold', color }}>{name}</div>
      {msgs.map((m, i) => <div key={i} style={{ fontSize: '12px', color: '#666' }}>{m}</div>)}
    </div>
  );
};

const ObserverDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif' }}>
    <h3>观察者模式 - 事件总线</h3>
    <Sender />
    <div style={{ display: 'flex', gap: '16px' }}>
      <Receiver name="组件 A" color="#1890ff" />
      <Receiver name="组件 B" color="#52c41a" />
      <Receiver name="组件 C" color="#fa8c16" />
    </div>
  </div>
);

export default ObserverDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif;">
    <h3>观察者模式 - 事件总线</h3>
    <div>
      <input v-model="msg" placeholder="输入消息" style="padding: 4px; width: 200px;" />
      <button @click="send" style="margin-left: 8px; padding: 4px 12px;">发送</button>
    </div>
    <div style="display: flex; gap: 16px; margin-top: 12px;">
      <Receiver name="组件 A" color="#1890ff" />
      <Receiver name="组件 B" color="#52c41a" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, defineComponent, h } from 'vue';

type EventCallback = (data: any) => void;

class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  on(event: string, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }
  off(event: string, cb: EventCallback): void { this.listeners.get(event)?.delete(cb); }
  emit(event: string, data: any): void { this.listeners.get(event)?.forEach(cb => cb(data)); }
}

const bus = new EventBus();

const msg = ref('');
const send = () => { if (msg.value.trim()) { bus.emit('message', msg.value); msg.value = ''; } };

const Receiver = defineComponent({
  name: 'Receiver',
  props: { name: String, color: String },
  setup(props) {
    const msgs = ref<string[]>([]);
    const handleMsg = (data: any) => { msgs.value = [...msgs.value.slice(-4), data]; };
    let unbind: (() => void) | null = null;
    onMounted(() => { unbind = bus.on('message', handleMsg); });
    onUnmounted(() => unbind?.());
    return () =>
      h('div', { style: { padding: '8px', border: '2px solid ' + props.color, borderRadius: '4px', minWidth: '120px', minHeight: '80px' } }, [
        h('div', { style: { fontWeight: 'bold', color: props.color } }, props.name),
        ...msgs.value.map((m, i) => h('div', { key: i, style: { fontSize: '12px', color: '#666' } }, m)),
      ]);
  },
});
</script>`,
      nodejs: `const EventEmitter = require('events');

class WeatherStation extends EventEmitter {
  private temperature = 25;
  private humidity = 60;
  getTemperature(): number { return this.temperature; }
  getHumidity(): number { return this.humidity; }
  setData(temp: number, hum: number): void {
    this.temperature = temp;
    this.humidity = hum;
    console.log(\`[气象站] 数据更新: 温度\${temp}°C, 湿度\${hum}%\`);
    this.emit('dataChanged', { temperature: temp, humidity: hum });
  }
}

class DisplayDevice {
  constructor(private name: string, private station: WeatherStation) {
    station.on('dataChanged', (data: any) => this.update(data));
  }
  update(data: any): void {
    console.log(\`[\${this.name}] 温度: \${data.temperature}°C, 湿度: \${data.humidity}%\`);
  }
}

class AlertSystem {
  constructor(private station: WeatherStation) {
    station.on('dataChanged', (data: any) => this.check(data));
  }
  check(data: any): void {
    if (data.temperature > 35) console.log('[告警] 高温预警！');
    if (data.humidity > 80) console.log('[告警] 高湿预警！');
  }
}

const station = new WeatherStation();
const display1 = new DisplayDevice('客厅显示屏', station);
const display2 = new DisplayDevice('卧室显示屏', station);
const alert = new AlertSystem(station);

console.log('=== 第一次数据更新 ===');
station.setData(28, 65);
console.log('\\n=== 第二次数据更新 ===');
station.setData(37, 85);`,
    },
  },

  strategy: {
    id: 'strategy',
    name: 'Strategy (策略)',
    category: 'behavioral',
    description: '定义一系列的算法，把它们一个个封装起来，并且使它们可相互替换。本模式使得算法可独立于使用它的客户而变化。',
    useCases: [
      '许多相关的类仅仅是行为有异',
      '需要使用一个算法的不同变体',
      '算法使用客户不应该知道的数据',
      '一个类定义了多种行为，并且这些行为在这个类的操作中以多个条件语句的形式出现',
    ],
    pros: [
      '你可以在运行时切换算法',
      '你可以将算法的实现和使用算法的代码隔离开来',
      '你可以用组合来代替继承',
      '开闭原则：无需修改上下文就可以引入新的策略',
    ],
    cons: [
      '如果算法极少发生改变，那么使用该模式可能会增加复杂度',
      '客户端必须知道所有的策略类，并自行决定使用哪一个',
      '很多现代编程语言支持函数式编程，可以直接传递函数来实现相同的效果',
    ],
    codeExamples: {
      typescript: `interface SortStrategy { sort<T>(data: T[]): T[]; }

class BubbleSort implements SortStrategy {
  sort<T>(data: T[]): T[] {
    const arr = [...data];
    const n = arr.length;
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < n - i - 1; j++)
        if (arr[j] > arr[j + 1]) [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    console.log('使用冒泡排序');
    return arr;
  }
}

class QuickSort implements SortStrategy {
  sort<T>(data: T[]): T[] {
    const arr = [...data];
    const qs = (a: T[], l: number, r: number): void => {
      if (l >= r) return;
      const pivot = a[r];
      let i = l - 1;
      for (let j = l; j < r; j++) if (a[j] < pivot) { i++; [a[i], a[j]] = [a[j], a[i]]; }
      [a[i + 1], a[r]] = [a[r], a[i + 1]];
      qs(a, l, i); qs(a, i + 2, r);
    };
    qs(arr, 0, arr.length - 1);
    console.log('使用快速排序');
    return arr;
  }
}

class Sorter {
  private strategy: SortStrategy;
  constructor(strategy: SortStrategy) { this.strategy = strategy; }
  setStrategy(strategy: SortStrategy): void { this.strategy = strategy; }
  sort<T>(data: T[]): T[] { return this.strategy.sort(data); }
}

const smallData = [5, 2, 8, 1, 9];
const largeData = Array.from({ length: 100 }, () => Math.floor(Math.random() * 1000));

const sorter = new Sorter(new BubbleSort());
console.log('小数据量:', sorter.sort(smallData));

sorter.setStrategy(new QuickSort());
const result = sorter.sort(largeData);
console.log('大数据量 (前5个):', result.slice(0, 5));`,
      react: `import React, { useState } from 'react';

interface PaymentStrategy {
  pay(amount: number): { success: boolean; message: string };
  name: string;
}

const alipayStrategy: PaymentStrategy = {
  name: '支付宝',
  pay(amount) {
    if (amount <= 0) return { success: false, message: '金额无效' };
    return { success: true, message: \`支付宝支付 ¥\${amount} 成功\` };
  },
};

const wechatStrategy: PaymentStrategy = {
  name: '微信支付',
  pay(amount) {
    if (amount <= 0) return { success: false, message: '金额无效' };
    return { success: true, message: \`微信支付 ¥\${amount} 成功\` };
  },
};

const bankStrategy: PaymentStrategy = {
  name: '银行卡',
  pay(amount) {
    if (amount > 5000) return { success: false, message: '超出单笔限额' };
    return { success: true, message: \`银行卡支付 ¥\${amount} 成功\` };
  },
};

const StrategyDemo: React.FC = () => {
  const [amount, setAmount] = useState(100);
  const [strategy, setStrategy] = useState<PaymentStrategy>(alipayStrategy);
  const [result, setResult] = useState('');
  const strategies = [alipayStrategy, wechatStrategy, bankStrategy];

  const handlePay = () => {
    const r = strategy.pay(amount);
    setResult(r.success ? '✅ ' + r.message : '❌ ' + r.message);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>策略模式 - 支付方式</h3>
      <div style={{ marginBottom: '12px' }}>
        金额: <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} style={{ padding: '4px', width: '100px' }} /> 元
      </div>
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
        {strategies.map(s => (
          <button key={s.name} onClick={() => setStrategy(s)}
            style={{ padding: '8px 16px', border: strategy.name === s.name ? '2px solid #1890ff' : '1px solid #d9d9d9', borderRadius: '4px', cursor: 'pointer' }}>{s.name}</button>
        ))}
      </div>
      <button onClick={handlePay} style={{ padding: '8px 24px', backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>支付</button>
      {result && <div style={{ marginTop: '12px', padding: '8px', background: '#f5f5f5', borderRadius: '4px' }}>{result}</div>}
    </div>
  );
};

export default StrategyDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>策略模式 - 支付方式</h3>
    <div style="margin-bottom: 12px;">
      金额: <input type="number" v-model.number="amount" style="padding: 4px; width: 100px;" /> 元
    </div>
    <div style="margin-bottom: 12px; display: flex; gap: 8px;">
      <button v-for="s in strategies" :key="s.name" @click="setStrategy(s)"
        :style="{ padding: '8px 16px', border: strategy.name === s.name ? '2px solid #1890ff' : '1px solid #d9d9d9', borderRadius: '4px', cursor: 'pointer' }">{{ s.name }}</button>
    </div>
    <button @click="handlePay" style="padding: 8px 24px; background: #1890ff; color: #fff; border: none; border-radius: 4px; cursor: pointer;">支付</button>
    <div v-if="result" style="margin-top: 12px; padding: 8px; background: #f5f5f5; border-radius: 4px;">{{ result }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';

interface PaymentStrategy {
  pay(amount: number): { success: boolean; message: string };
  name: string;
}

const alipayStrategy: PaymentStrategy = {
  name: '支付宝',
  pay(amount) { return amount > 0 ? { success: true, message: '支付宝支付 ¥' + amount + ' 成功' } : { success: false, message: '金额无效' }; },
};
const wechatStrategy: PaymentStrategy = {
  name: '微信支付',
  pay(amount) { return amount > 0 ? { success: true, message: '微信支付 ¥' + amount + ' 成功' } : { success: false, message: '金额无效' }; },
};
const bankStrategy: PaymentStrategy = {
  name: '银行卡',
  pay(amount) { return amount <= 5000 ? { success: true, message: '银行卡支付 ¥' + amount + ' 成功' } : { success: false, message: '超出单笔限额' }; },
};

const amount = ref(100);
const strategy = ref<PaymentStrategy>(alipayStrategy);
const result = ref('');
const strategies = [alipayStrategy, wechatStrategy, bankStrategy];
const setStrategy = (s: PaymentStrategy) => { strategy.value = s; };
const handlePay = () => {
  const r = strategy.value.pay(amount.value);
  result.value = r.success ? '✅ ' + r.message : '❌ ' + r.message;
};
</script>`,
      nodejs: `interface CompressionStrategy { compress(file: string): string; decompress(file: string): string; name: string; }

class ZipStrategy implements CompressionStrategy {
  name = 'ZIP';
  compress(file: string): string { console.log('使用 ZIP 压缩:', file); return file + '.zip'; }
  decompress(file: string): string { console.log('使用 ZIP 解压:', file); return file.replace('.zip', ''); }
}

class GzipStrategy implements CompressionStrategy {
  name = 'GZIP';
  compress(file: string): string { console.log('使用 GZIP 压缩:', file); return file + '.gz'; }
  decompress(file: string): string { console.log('使用 GZIP 解压:', file); return file.replace('.gz', ''); }
}

class TarStrategy implements CompressionStrategy {
  name = 'TAR';
  compress(file: string): string { console.log('使用 TAR 打包:', file); return file + '.tar'; }
  decompress(file: string): string { console.log('使用 TAR 解包:', file); return file.replace('.tar', ''); }
}

class Compressor {
  private strategy: CompressionStrategy;
  constructor(strategy: CompressionStrategy) { this.strategy = strategy; }
  setStrategy(strategy: CompressionStrategy): void { this.strategy = strategy; }
  compress(file: string): string { return this.strategy.compress(file); }
  decompress(file: string): string { return this.strategy.decompress(file); }
}

const compressor = new Compressor(new ZipStrategy());
console.log('当前策略:', compressor['strategy'].name);
let f = compressor.compress('document.txt');
console.log('压缩后:', f);

compressor.setStrategy(new GzipStrategy());
console.log('\\n切换策略:', compressor['strategy'].name);
f = compressor.compress('data.json');
console.log('压缩后:', f);

compressor.setStrategy(new TarStrategy());
console.log('\\n切换策略:', compressor['strategy'].name);
f = compressor.compress('photos');
console.log('打包后:', f);`,
    },
  },

  command: {
    id: 'command',
    name: 'Command (命令)',
    category: 'behavioral',
    description: '将一个请求封装为一个对象，从而使你可用不同的请求对客户进行参数化；对请求排队或记录请求日志，以及支持可撤消的操作。',
    useCases: [
      '需要将操作参数化，根据不同的操作来参数化对象',
      '需要将操作排队、在不同的时间执行，或者远程执行',
      '需要支持撤销操作',
      '需要支持事务（操作的原子性）',
    ],
    pros: [
      '单一职责原则：可以解耦触发操作的对象和执行操作的对象',
      '开闭原则：可以在不修改现有客户端代码的情况下引入新命令',
      '可以实现撤销/重做功能',
      '可以将简单命令组合成复杂命令',
    ],
    cons: [
      '代码可能会变得复杂，因为需要引入许多新的类',
      '每一个命令都需要一个具体类，可能导致类爆炸',
    ],
    codeExamples: {
      typescript: `interface Command { execute(): void; undo(): void; getName(): string; }

class Light {
  private on = false;
  turnOn(): void { this.on = true; console.log('灯已打开'); }
  turnOff(): void { this.on = false; console.log('灯已关闭'); }
  isOn(): boolean { return this.on; }
}

class LightOnCommand implements Command {
  constructor(private light: Light) {}
  execute(): void { this.light.turnOn(); }
  undo(): void { this.light.turnOff(); }
  getName(): string { return '开灯'; }
}

class LightOffCommand implements Command {
  constructor(private light: Light) {}
  execute(): void { this.light.turnOff(); }
  undo(): void { this.light.turnOn(); }
  getName(): string { return '关灯'; }
}

class RemoteControl {
  private history: Command[] = [];
  press(command: Command): void {
    command.execute();
    this.history.push(command);
  }
  undo(): void {
    const cmd = this.history.pop();
    if (cmd) { console.log('撤销:', cmd.getName()); cmd.undo(); }
    else console.log('无可撤销操作');
  }
  getHistory(): string[] { return this.history.map(c => c.getName()); }
}

const light = new Light();
const remote = new RemoteControl();

const onCmd = new LightOnCommand(light);
const offCmd = new LightOffCommand(light);

remote.press(onCmd);
remote.press(offCmd);
remote.undo();
remote.undo();
remote.undo();`,
      react: `import React, { useState, useCallback, useRef } from 'react';

interface Command { execute(): void; undo(): void; name: string; }

const useUndoRedo = () => {
  const history = useRef<Command[]>([]);
  const future = useRef<Command[]>([]);
  const [, forceUpdate] = useState(0);

  const execute = useCallback((cmd: Command) => {
    cmd.execute();
    history.current.push(cmd);
    future.current = [];
    forceUpdate(n => n + 1);
  }, []);

  const undo = useCallback(() => {
    const cmd = history.current.pop();
    if (cmd) { cmd.undo(); future.current.push(cmd); forceUpdate(n => n + 1); }
  }, []);

  const redo = useCallback(() => {
    const cmd = future.current.pop();
    if (cmd) { cmd.execute(); history.current.push(cmd); forceUpdate(n => n + 1); }
  }, []);

  return { execute, undo, redo, canUndo: history.current.length > 0, canRedo: future.current.length > 0, history: history.current };
};

const CommandDemo: React.FC = () => {
  const [text, setText] = useState('');
  const { execute, undo, redo, canUndo, canRedo, history } = useUndoRedo();

  const appendText = (str: string) => {
    const prev = text;
    execute({
      name: '追加: ' + str,
      execute: () => setText(prev + str),
      undo: () => setText(prev),
    });
  };

  const clearText = () => {
    const prev = text;
    execute({
      name: '清空',
      execute: () => setText(''),
      undo: () => setText(prev),
    });
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>命令模式 - 撤销/重做</h3>
      <div style={{ marginBottom: '12px' }}>
        <button onClick={() => appendText('Hello ')} style={{ marginRight: '8px', padding: '4px 12px' }}>追加 Hello</button>
        <button onClick={() => appendText('World! ')} style={{ marginRight: '8px', padding: '4px 12px' }}>追加 World</button>
        <button onClick={clearText} style={{ marginRight: '8px', padding: '4px 12px' }}>清空</button>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <button onClick={undo} disabled={!canUndo} style={{ padding: '4px 12px', marginRight: '8px' }}>撤销</button>
        <button onClick={redo} disabled={!canRedo} style={{ padding: '4px 12px' }}>重做</button>
      </div>
      <div style={{ padding: '12px', border: '1px solid #d9d9d9', borderRadius: '4px', minHeight: '60px', background: '#fafafa' }}>{text || '(空)'}</div>
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>历史: {history.map(h => h.name).join(' → ') || '无'}</div>
    </div>
  );
};

export default CommandDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>命令模式 - 撤销/重做</h3>
    <div style="margin-bottom: 12px;">
      <button @click="appendText('Hello ')" style="margin-right: 8px; padding: 4px 12px;">追加 Hello</button>
      <button @click="appendText('World! ')" style="margin-right: 8px; padding: 4px 12px;">追加 World</button>
      <button @click="clearText" style="margin-right: 8px; padding: 4px 12px;">清空</button>
    </div>
    <div style="margin-bottom: 12px;">
      <button @click="undo" :disabled="!canUndo" style="padding: 4px 12px; margin-right: 8px;">撤销</button>
      <button @click="redo" :disabled="!canRedo" style="padding: 4px 12px;">重做</button>
    </div>
    <div style="padding: 12px; border: 1px solid #d9d9d9; border-radius: 4px; min-height: 60px; background: #fafafa;">{{ text || '(空)' }}</div>
    <div style="margin-top: 8px; font-size: 12px; color: #666;">历史: {{ historyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface Command { execute(): void; undo(): void; name: string; }

const text = ref('');
const history = ref<Command[]>([]);
const future = ref<Command[]>([]);

const execute = (cmd: Command) => {
  cmd.execute();
  history.value.push(cmd);
  future.value = [];
};

const undo = () => {
  const cmd = history.value.pop();
  if (cmd) { cmd.undo(); future.value.push(cmd); }
};

const redo = () => {
  const cmd = future.value.pop();
  if (cmd) { cmd.execute(); history.value.push(cmd); }
};

const canUndo = computed(() => history.value.length > 0);
const canRedo = computed(() => future.value.length > 0);
const historyText = computed(() => history.value.map(h => h.name).join(' → ') || '无');

const appendText = (str: string) => {
  const prev = text.value;
  execute({ name: '追加: ' + str, execute: () => { text.value = prev + str; }, undo: () => { text.value = prev; } });
};

const clearText = () => {
  const prev = text.value;
  execute({ name: '清空', execute: () => { text.value = ''; }, undo: () => { text.value = prev; } });
};
</script>`,
      nodejs: `interface Command { execute(): void; undo(): void; getName(): string; }

class TextEditor {
  private content = '';
  getContent(): string { return this.content; }
  setContent(c: string): void { this.content = c; }
  append(text: string): void { this.content += text; }
  delete(count: number): void { this.content = this.content.slice(0, -count); }
}

class AppendCommand implements Command {
  private appended = '';
  constructor(private editor: TextEditor, private text: string) {}
  execute(): void { this.editor.append(this.text); this.appended = this.text; }
  undo(): void { this.editor.delete(this.appended.length); }
  getName(): string { return '追加: ' + this.text; }
}

class DeleteCommand implements Command {
  private deleted = '';
  constructor(private editor: TextEditor, private count: number) {}
  execute(): void {
    const c = this.editor.getContent();
    this.deleted = c.slice(-this.count);
    this.editor.delete(this.count);
  }
  undo(): void { this.editor.append(this.deleted); }
  getName(): string { return '删除 ' + this.count + ' 字符'; }
}

class CommandManager {
  private history: Command[] = [];
  private redoStack: Command[] = [];
  execute(cmd: Command): void { cmd.execute(); this.history.push(cmd); this.redoStack = []; }
  undo(): boolean {
    const cmd = this.history.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }
  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.history.push(cmd);
    return true;
  }
  printHistory(): void { console.log('历史:', this.history.map(c => c.getName()).join(' → ') || '无'); }
}

const editor = new TextEditor();
const manager = new CommandManager();

manager.execute(new AppendCommand(editor, 'Hello'));
manager.execute(new AppendCommand(editor, ' World'));
console.log('内容:', editor.getContent());
manager.printHistory();

manager.undo();
console.log('撤销后:', editor.getContent());

manager.redo();
console.log('重做后:', editor.getContent());

manager.execute(new DeleteCommand(editor, 5));
console.log('删除后:', editor.getContent());
manager.printHistory();`,
    },
  },

  templateMethod: {
    id: 'templateMethod',
    name: 'Template Method (模板方法)',
    category: 'behavioral',
    description: '定义一个操作中的算法的骨架，而将一些步骤延迟到子类中。模板方法使得子类可以不改变一个算法的结构即可重定义该算法的某些特定步骤。',
    useCases: [
      '一次性实现一个算法的不变的部分，并将可变的行为留给子类来实现',
      '各子类中公共的行为应被提取出来并集中到一个公共父类中以避免代码重复',
      '控制子类扩展，只允许在特定点进行扩展',
    ],
    pros: [
      '你可以只让客户端重写大型算法中的某些部分，减少算法中其他部分被修改带来的影响',
      '你可以将重复代码提取到一个超类中',
    ],
    cons: [
      '通过继承来实现代码复用，可能会限制算法的灵活性',
      '算法骨架的改变可能需要修改所有子类',
      '子类可能会受到超类中方法数量和复杂度的影响',
    ],
    codeExamples: {
      typescript: `abstract class DataProcessor {
  process(filename: string): void {
    const data = this.readData(filename);
    const parsed = this.parseData(data);
    const result = this.processData(parsed);
    this.saveResult(result);
    if (this.shouldLog()) this.logResult(result);
  }
  protected abstract readData(filename: string): string;
  protected abstract parseData(data: string): any;
  protected abstract processData(data: any): any;
  protected abstract saveResult(result: any): void;
  protected shouldLog(): boolean { return false; }
  protected logResult(result: any): void { console.log('结果:', JSON.stringify(result)); }
}

class CSVProcessor extends DataProcessor {
  protected readData(filename: string): string { console.log('读取 CSV 文件:', filename); return 'name,age\\nAlice,30\\nBob,25'; }
  protected parseData(data: string): any[] {
    const lines = data.split('\\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(l => {
      const vals = l.split(',');
      const obj: any = {};
      headers.forEach((h, i) => obj[h] = vals[i]);
      return obj;
    });
  }
  protected processData(data: any[]): any {
    console.log('处理 CSV 数据，共', data.length, '条');
    return { count: data.length, averageAge: data.reduce((s, d) => s + Number(d.age), 0) / data.length };
  }
  protected saveResult(result: any): void { console.log('保存 CSV 结果到文件:', JSON.stringify(result)); }
  protected shouldLog(): boolean { return true; }
}

class JSONProcessor extends DataProcessor {
  protected readData(filename: string): string { console.log('读取 JSON 文件:', filename); return '{"users":[{"name":"Alice","age":30},{"name":"Bob","age":25}]}'; }
  protected parseData(data: string): any { return JSON.parse(data); }
  protected processData(data: any): any {
    console.log('处理 JSON 数据，共', data.users.length, '条');
    return { count: data.users.length, users: data.users.map((u: any) => u.name) };
  }
  protected saveResult(result: any): void { console.log('保存 JSON 结果到数据库:', JSON.stringify(result)); }
}

console.log('=== CSV 处理 ===');
const csv = new CSVProcessor();
csv.process('data.csv');

console.log('\\n=== JSON 处理 ===');
const json = new JSONProcessor();
json.process('data.json');`,
      react: `import React from 'react';

// 模板方法：表单验证流程
abstract class FormValidator<T> {
  validate(formData: T): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    this.checkRequired(formData, errors);
    this.checkFormat(formData, errors);
    this.checkBusinessRules(formData, errors);
    return { valid: errors.length === 0, errors };
  }
  protected abstract checkRequired(data: T, errors: string[]): void;
  protected abstract checkFormat(data: T, errors: string[]): void;
  protected checkBusinessRules(data: T, errors: string[]): void { /* 默认无业务规则 */ }
}

interface LoginForm { username: string; password: string; }

class LoginValidator extends FormValidator<LoginForm> {
  protected checkRequired(data: LoginForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
  }
  protected checkFormat(data: LoginForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
  }
}

interface RegisterForm { username: string; password: string; confirmPassword: string; email: string; }

class RegisterValidator extends FormValidator<RegisterForm> {
  protected checkRequired(data: RegisterForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
    if (!data.confirmPassword) errors.push('确认密码不能为空');
    if (!data.email) errors.push('邮箱不能为空');
  }
  protected checkFormat(data: RegisterForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
    if (data.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email)) errors.push('邮箱格式不正确');
  }
  protected checkBusinessRules(data: RegisterForm, errors: string[]): void {
    if (data.password && data.confirmPassword && data.password !== data.confirmPassword)
      errors.push('两次密码输入不一致');
  }
}

const TemplateDemo: React.FC = () => {
  const loginValidator = new LoginValidator();
  const loginResult = loginValidator.validate({ username: 'ab', password: '123' });

  const regValidator = new RegisterValidator();
  const regResult = regValidator.validate({ username: 'alice', password: '123456', confirmPassword: '123456', email: 'invalid' });

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>模板方法模式 - 表单验证</h3>
      <div style={{ marginBottom: '16px' }}>
        <h4>登录表单验证 (用户名=ab, 密码=123):</h4>
        <p>结果: {loginResult.valid ? '✅ 有效' : '❌ 无效'}</p>
        <ul>{loginResult.errors.map((e, i) => <li key={i} style={{ color: '#ff4d4f' }}>{e}</li>)}</ul>
      </div>
      <div>
        <h4>注册表单验证:</h4>
        <p>结果: {regResult.valid ? '✅ 有效' : '❌ 无效'}</p>
        <ul>{regResult.errors.map((e, i) => <li key={i} style={{ color: '#ff4d4f' }}>{e}</li>)}</ul>
      </div>
    </div>
  );
};

export default TemplateDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>模板方法模式 - 表单验证</h3>
    <div style="margin-bottom: 16px;">
      <h4>登录表单验证 (用户名=ab, 密码=123):</h4>
      <p>结果: {{ loginResult.valid ? '✅ 有效' : '❌ 无效' }}</p>
      <ul><li v-for="(e, i) in loginResult.errors" :key="i" style="color: #ff4d4f;">{{ e }}</li></ul>
    </div>
    <div>
      <h4>注册表单验证:</h4>
      <p>结果: {{ regResult.valid ? '✅ 有效' : '❌ 无效' }}</p>
      <ul><li v-for="(e, i) in regResult.errors" :key="i" style="color: #ff4d4f;">{{ e }}</li></ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';

abstract class FormValidator<T> {
  validate(formData: T): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    this.checkRequired(formData, errors);
    this.checkFormat(formData, errors);
    this.checkBusinessRules(formData, errors);
    return { valid: errors.length === 0, errors };
  }
  protected abstract checkRequired(data: T, errors: string[]): void;
  protected abstract checkFormat(data: T, errors: string[]): void;
  protected checkBusinessRules(data: T, errors: string[]): void {}
}

interface LoginForm { username: string; password: string; }

class LoginValidator extends FormValidator<LoginForm> {
  protected checkRequired(data: LoginForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
  }
  protected checkFormat(data: LoginForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
  }
}

interface RegisterForm { username: string; password: string; confirmPassword: string; email: string; }

class RegisterValidator extends FormValidator<RegisterForm> {
  protected checkRequired(data: RegisterForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
    if (!data.confirmPassword) errors.push('确认密码不能为空');
    if (!data.email) errors.push('邮箱不能为空');
  }
  protected checkFormat(data: RegisterForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
    if (data.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email)) errors.push('邮箱格式不正确');
  }
  protected checkBusinessRules(data: RegisterForm, errors: string[]): void {
    if (data.password && data.confirmPassword && data.password !== data.confirmPassword)
      errors.push('两次密码输入不一致');
  }
}

const loginValidator = new LoginValidator();
const loginResult = reactive(loginValidator.validate({ username: 'ab', password: '123' }));

const regValidator = new RegisterValidator();
const regResult = reactive(regValidator.validate({ username: 'alice', password: '123456', confirmPassword: '123456', email: 'invalid' }));
</script>`,
      nodejs: `abstract class Beverage {
  prepare(): void {
    this.boilWater();
    this.brew();
    this.pourInCup();
    if (this.wantsCondiments()) this.addCondiments();
  }
  private boilWater(): void { console.log('1. 烧开水'); }
  private pourInCup(): void { console.log('3. 倒入杯中'); }
  protected abstract brew(): void;
  protected abstract addCondiments(): void;
  protected wantsCondiments(): boolean { return true; }
}

class Coffee extends Beverage {
  protected brew(): void { console.log('2. 冲泡咖啡粉'); }
  protected addCondiments(): void { console.log('4. 添加糖和奶'); }
}

class Tea extends Beverage {
  protected brew(): void { console.log('2. 浸泡茶叶'); }
  protected addCondiments(): void { console.log('4. 添加柠檬'); }
  protected wantsCondiments(): boolean { return false; }
}

class HotChocolate extends Beverage {
  protected brew(): void { console.log('2. 搅拌可可粉'); }
  protected addCondiments(): void { console.log('4. 添加棉花糖'); }
}

console.log('=== 制作咖啡 ===');
const coffee = new Coffee();
coffee.prepare();

console.log('\\n=== 制作茶 ===');
const tea = new Tea();
tea.prepare();

console.log('\\n=== 制作热巧克力 ===');
const choc = new HotChocolate();
choc.prepare();`,
    },
  },

  state: {
    id: 'state',
    name: 'State (状态)',
    category: 'behavioral',
    description: '允许一个对象在其内部状态改变时改变它的行为。对象看起来似乎修改了它的类。',
    useCases: [
      '一个对象的行为取决于它的状态，并且它必须在运行时刻根据状态改变它的行为',
      '一个操作中含有庞大的多分支的条件语句，且这些分支依赖于该对象的状态',
      '状态转换逻辑复杂，需要将状态和行为封装在一起',
    ],
    pros: [
      '单一职责原则：将与特定状态相关的代码放到单独的类中',
      '开闭原则：无需修改已有状态类和上下文就能引入新状态',
      '通过消除臃肿的状态机条件语句简化上下文代码',
      '状态转换是显式的，更安全',
    ],
    cons: [
      '如果状态类很少，使用此模式可能会过度设计',
      '状态模式的结构可能会比较复杂',
      '需要创建许多状态类',
    ],
    codeExamples: {
      typescript: `interface OrderState {
        getName(): string;
        pay(order: Order): void;
        cancel(order: Order): void;
        ship(order: Order): void;
        deliver(order: Order): void;
      }

      class Order {
        private state: OrderState;
        constructor(public orderId: string) { this.state = new PendingState(); }
        setState(state: OrderState): void { this.state = state; console.log('订单状态变更为:', state.getName()); }
        getStateName(): string { return this.state.getName(); }
        pay(): void { this.state.pay(this); }
        cancel(): void { this.state.cancel(this); }
        ship(): void { this.state.ship(this); }
        deliver(): void { this.state.deliver(this); }
      }

      class PendingState implements OrderState {
        getName(): string { return '待支付'; }
        pay(order: Order): void { console.log('支付成功'); order.setState(new PaidState()); }
        cancel(order: Order): void { console.log('取消订单'); order.setState(new CancelledState()); }
        ship(): void { console.log('错误：未支付不能发货'); }
        deliver(): void { console.log('错误：未支付不能收货'); }
      }

      class PaidState implements OrderState {
        getName(): string { return '已支付'; }
        pay(): void { console.log('错误：已支付，无需重复支付'); }
        cancel(order: Order): void { console.log('申请退款，订单取消'); order.setState(new CancelledState()); }
        ship(order: Order): void { console.log('商品已发货'); order.setState(new ShippedState()); }
        deliver(): void { console.log('错误：未发货不能收货'); }
      }

      class ShippedState implements OrderState {
        getName(): string { return '已发货'; }
        pay(): void { console.log('错误：已支付'); }
        cancel(): void { console.log('错误：已发货不能取消，请拒收'); }
        ship(): void { console.log('错误：已发货'); }
        deliver(order: Order): void { console.log('确认收货'); order.setState(new DeliveredState()); }
      }

      class DeliveredState implements OrderState {
        getName(): string { return '已完成'; }
        pay(): void { console.log('错误：订单已完成'); }
        cancel(): void { console.log('错误：已完成订单不能取消'); }
        ship(): void { console.log('错误：订单已完成'); }
        deliver(): void { console.log('错误：订单已完成'); }
      }

      class CancelledState implements OrderState {
        getName(): string { return '已取消'; }
        pay(): void { console.log('错误：订单已取消'); }
        cancel(): void { console.log('错误：订单已取消'); }
        ship(): void { console.log('错误：订单已取消'); }
        deliver(): void { console.log('错误：订单已取消'); }
      }

      const order = new Order('ORD-001');
      console.log('初始状态:', order.getStateName());
      order.pay();
      order.ship();
      order.deliver();
      console.log('---');
      const order2 = new Order('ORD-002');
      order2.cancel();
      order2.pay();`,
      react: `import React, { useState, useCallback } from 'react';

interface TrafficState { name: string; color: string; next(): TrafficState; duration: number; }

const greenState: TrafficState = {
  name: '绿灯', color: '#52c41a', duration: 5,
  next: () => yellowState,
};

const yellowState: TrafficState = {
  name: '黄灯', color: '#faad14', duration: 2,
  next: () => redState,
};

const redState: TrafficState = {
  name: '红灯', color: '#ff4d4f', duration: 5,
  next: () => greenState,
};

const StateDemo: React.FC = () => {
  const [state, setState] = useState<TrafficState>(redState);
  const [countdown, setCountdown] = useState(redState.duration);

  const nextState = useCallback(() => {
    const next = state.next();
    setState(next);
    setCountdown(next.duration);
  }, [state]);

  React.useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    } else {
      nextState();
    }
  }, [countdown, nextState]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', textAlign: 'center' }}>
      <h3>状态模式 - 交通灯</h3>
      <div style={{ display: 'inline-block', padding: '20px', backgroundColor: '#333', borderRadius: '50px' }}>
        {[redState, yellowState, greenState].map(s => (
          <div key={s.name} style={{
            width: '60px', height: '60px', borderRadius: '50%', margin: '10px',
            backgroundColor: state.name === s.name ? s.color : '#555',
            boxShadow: state.name === s.name ? \`0 0 20px \${s.color}\` : 'none',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>
      <div style={{ marginTop: '16px', fontSize: '24px', fontWeight: 'bold', color: state.color }}>
        {state.name} - {countdown}s
      </div>
      <button onClick={nextState} style={{ marginTop: '16px', padding: '8px 24px' }}>手动切换</button>
    </div>
  );
};

export default StateDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px; text-align: center;">
    <h3>状态模式 - 交通灯</h3>
    <div style="display: inline-block; padding: 20px; background: #333; border-radius: 50px;">
      <div v-for="s in states" :key="s.name" :style="{
        width: '60px', height: '60px', borderRadius: '50%', margin: '10px',
        backgroundColor: state.name === s.name ? s.color : '#555',
        boxShadow: state.name === s.name ? '0 0 20px ' + s.color : 'none',
        transition: 'all 0.3s',
      }"></div>
    </div>
    <div style="margin-top: 16px; font-size: 24px; font-weight: bold;" :style="{ color: state.color }">
      {{ state.name }} - {{ countdown }}s
    </div>
    <button @click="nextState" style="margin-top: 16px; padding: 8px 24px;">手动切换</button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';

interface TrafficState { name: string; color: string; duration: number; next(): TrafficState; }

const greenState: TrafficState = { name: '绿灯', color: '#52c41a', duration: 5, next: () => yellowState };
const yellowState: TrafficState = { name: '黄灯', color: '#faad14', duration: 2, next: () => redState };
const redState: TrafficState = { name: '红灯', color: '#ff4d4f', duration: 5, next: () => greenState };

const states = [redState, yellowState, greenState];
const state = ref<TrafficState>(redState);
const countdown = ref(redState.duration);
let timer: any = null;

const nextState = () => {
  const next = state.value.next();
  state.value = next;
  countdown.value = next.duration;
};

onMounted(() => {
  timer = setInterval(() => {
    if (countdown.value > 0) countdown.value--;
    else nextState();
  }, 1000);
});

onUnmounted(() => { if (timer) clearInterval(timer); });
</script>`,
      nodejs: `interface MediaState { getName(): string; play(player: MediaPlayer): void; pause(player: MediaPlayer): void; stop(player: MediaPlayer): void; }

class MediaPlayer {
  private state: MediaState;
  constructor(public track: string) { this.state = new StoppedState(); }
  setState(s: MediaState): void { this.state = s; console.log('状态:', s.getName()); }
  getStateName(): string { return this.state.getName(); }
  play(): void { this.state.play(this); }
  pause(): void { this.state.pause(this); }
  stop(): void { this.state.stop(this); }
}

class StoppedState implements MediaState {
  getName(): string { return '停止'; }
  play(p: MediaPlayer): void { console.log('开始播放:', p.track); p.setState(new PlayingState()); }
  pause(): void { console.log('错误：已停止，无法暂停'); }
  stop(): void { console.log('已经是停止状态'); }
}

class PlayingState implements MediaState {
  getName(): string { return '播放中'; }
  play(): void { console.log('已经在播放了'); }
  pause(p: MediaPlayer): void { console.log('暂停播放'); p.setState(new PausedState()); }
  stop(p: MediaPlayer): void { console.log('停止播放'); p.setState(new StoppedState()); }
}

class PausedState implements MediaState {
  getName(): string { return '已暂停'; }
  play(p: MediaPlayer): void { console.log('继续播放'); p.setState(new PlayingState()); }
  pause(): void { console.log('已经是暂停状态'); }
  stop(p: MediaPlayer): void { console.log('停止播放'); p.setState(new StoppedState()); }
}

const player = new MediaPlayer('Song - Artist');
console.log('初始状态:', player.getStateName());

console.log('\\n尝试暂停（停止状态）:');
player.pause();

console.log('\\n播放:');
player.play();

console.log('\\n暂停:');
player.pause();

console.log('\\n继续播放:');
player.play();

console.log('\\n停止:');
player.stop();`,
    },
  },

  iterator: {
    id: 'iterator',
    name: 'Iterator (迭代器)',
    category: 'behavioral',
    description: '提供一种方法顺序访问一个聚合对象中各个元素，而又不需暴露该对象的内部表示。',
    useCases: [
      '访问一个聚合对象的内容而无需暴露它的内部表示',
      '支持对聚合对象的多种遍历',
      '为遍历不同的聚合结构提供一个统一的接口',
      '需要在遍历过程中对集合进行操作而不暴露底层结构',
    ],
    pros: [
      '单一职责原则：可以将笨重的遍历算法抽取到独立的类中',
      '开闭原则：可以实现新的集合和迭代器并将其传递给现有代码，无需修改代码',
      '可以并行遍历同一集合，因为每个迭代器对象都包含其自身的遍历状态',
      '可以暂停遍历并在需要时继续',
    ],
    cons: [
      '对于简单的遍历，使用迭代器可能有些矫枉过正',
      '比起直接遍历集合的元素，使用迭代器的效率可能会低一些',
    ],
    codeExamples: {
      typescript: `interface Iterator<T> { next(): T | null; hasNext(): boolean; }
interface IterableCollection<T> { createIterator(): Iterator<T>; }

class Book { constructor(public title: string, public author: string) {} }

class BookShelf implements IterableCollection<Book> {
  private books: Book[] = [];
  addBook(book: Book): void { this.books.push(book); }
  getCount(): number { return this.books.length; }
  getBookAt(index: number): Book { return this.books[index]; }
  createIterator(): Iterator<Book> { return new BookIterator(this); }
  createReverseIterator(): Iterator<Book> { return new ReverseBookIterator(this); }
}

class BookIterator implements Iterator<Book> {
  private index = 0;
  constructor(private shelf: BookShelf) {}
  next(): Book | null {
    if (this.hasNext()) return this.shelf.getBookAt(this.index++);
    return null;
  }
  hasNext(): boolean { return this.index < this.shelf.getCount(); }
}

class ReverseBookIterator implements Iterator<Book> {
  private index: number;
  constructor(private shelf: BookShelf) { this.index = shelf.getCount() - 1; }
  next(): Book | null {
    if (this.hasNext()) return this.shelf.getBookAt(this.index--);
    return null;
  }
  hasNext(): boolean { return this.index >= 0; }
}

const shelf = new BookShelf();
shelf.addBook(new Book('设计模式', 'GoF'));
shelf.addBook(new Book('重构', 'Martin Fowler'));
shelf.addBook(new Book('代码整洁之道', 'Robert C. Martin'));

console.log('=== 正序遍历 ===');
const it = shelf.createIterator();
while (it.hasNext()) {
  const b = it.next();
  if (b) console.log(b.title, '-', b.author);
}

console.log('\\n=== 逆序遍历 ===');
const rit = shelf.createReverseIterator();
while (rit.hasNext()) {
  const b = rit.next();
  if (b) console.log(b.title, '-', b.author);
}`,
      react: `import React, { useState } from 'react';

interface Iterator<T> { next(): T | null; hasNext(): boolean; reset(): void; }

// 分页迭代器
class PagedIterator<T> implements Iterator<T> {
  private index = 0;
  constructor(private items: T[], private pageSize: number) {}
  next(): T | null {
    if (this.hasNext()) return this.items[this.index++];
    return null;
  }
  hasNext(): boolean { return this.index < this.items.length; }
  reset(): void { this.index = 0; }
  getPage(page: number): T[] {
    const start = (page - 1) * this.pageSize;
    return this.items.slice(start, start + this.pageSize);
  }
  getTotalPages(): number { return Math.ceil(this.items.length / this.pageSize); }
  getCurrentIndex(): number { return this.index; }
}

const users = [
  { id: 1, name: 'Alice', role: 'Admin' },
  { id: 2, name: 'Bob', role: 'User' },
  { id: 3, name: 'Charlie', role: 'User' },
  { id: 4, name: 'David', role: 'Editor' },
  { id: 5, name: 'Eve', role: 'User' },
  { id: 6, name: 'Frank', role: 'Admin' },
  { id: 7, name: 'Grace', role: 'User' },
];

const IteratorDemo: React.FC = () => {
  const [page, setPage] = useState(1);
  const pageSize = 3;
  const iterator = new PagedIterator(users, pageSize);
  const totalPages = iterator.getTotalPages();
  const currentPage = iterator.getPage(page);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>迭代器模式 - 分页</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ padding: '8px', border: '1px solid #d9d9d9', textAlign: 'left' }}>ID</th>
            <th style={{ padding: '8px', border: '1px solid #d9d9d9', textAlign: 'left' }}>姓名</th>
            <th style={{ padding: '8px', border: '1px solid #d9d9d9', textAlign: 'left' }}>角色</th>
          </tr>
        </thead>
        <tbody>
          {currentPage.map(u => (
            <tr key={u.id}>
              <td style={{ padding: '8px', border: '1px solid #d9d9d9' }}>{u.id}</td>
              <td style={{ padding: '8px', border: '1px solid #d9d9d9' }}>{u.name}</td>
              <td style={{ padding: '8px', border: '1px solid #d9d9d9' }}>{u.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} style={{ padding: '4px 12px' }}>上一页</button>
        <span style={{ padding: '4px 12px' }}>第 {page} / {totalPages} 页</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} style={{ padding: '4px 12px' }}>下一页</button>
      </div>
    </div>
  );
};

export default IteratorDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>迭代器模式 - 分页</h3>
    <table style="border-collapse: collapse; width: 100%;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="padding: 8px; border: 1px solid #d9d9d9; text-align: left;">ID</th>
          <th style="padding: 8px; border: 1px solid #d9d9d9; text-align: left;">姓名</th>
          <th style="padding: 8px; border: 1px solid #d9d9d9; text-align: left;">角色</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in currentPage" :key="u.id">
          <td style="padding: 8px; border: 1px solid #d9d9d9;">{{ u.id }}</td>
          <td style="padding: 8px; border: 1px solid #d9d9d9;">{{ u.name }}</td>
          <td style="padding: 8px; border: 1px solid #d9d9d9;">{{ u.role }}</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top: 12px; display: flex; gap: 8px;">
      <button @click="page = Math.max(1, page - 1)" :disabled="page === 1" style="padding: 4px 12px;">上一页</button>
      <span style="padding: 4px 12px;">第 {{ page }} / {{ totalPages }} 页</span>
      <button @click="page = Math.min(totalPages, page + 1)" :disabled="page === totalPages" style="padding: 4px 12px;">下一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const users = [
  { id: 1, name: 'Alice', role: 'Admin' },
  { id: 2, name: 'Bob', role: 'User' },
  { id: 3, name: 'Charlie', role: 'User' },
  { id: 4, name: 'David', role: 'Editor' },
  { id: 5, name: 'Eve', role: 'User' },
  { id: 6, name: 'Frank', role: 'Admin' },
  { id: 7, name: 'Grace', role: 'User' },
];

const page = ref(1);
const pageSize = 3;
const totalPages = computed(() => Math.ceil(users.length / pageSize));
const currentPage = computed(() => {
  const start = (page.value - 1) * pageSize;
  return users.slice(start, start + pageSize);
});
</script>`,
      nodejs: `// 树形结构迭代器
class TreeNode {
  constructor(public value: string, public children: TreeNode[] = []) {}
  add(child: TreeNode): void { this.children.push(child); }
}

// 深度优先迭代器
class DfsIterator {
  private stack: TreeNode[] = [];
  constructor(root: TreeNode) { this.stack.push(root); }
  next(): TreeNode | null {
    if (!this.hasNext()) return null;
    const node = this.stack.pop()!;
    for (let i = node.children.length - 1; i >= 0; i--) {
      this.stack.push(node.children[i]);
    }
    return node;
  }
  hasNext(): boolean { return this.stack.length > 0; }
}

// 广度优先迭代器
class BfsIterator {
  private queue: TreeNode[] = [];
  constructor(root: TreeNode) { this.queue.push(root); }
  next(): TreeNode | null {
    if (!this.hasNext()) return null;
    const node = this.queue.shift()!;
    this.queue.push(...node.children);
    return node;
  }
  hasNext(): boolean { return this.queue.length > 0; }
}

const root = new TreeNode('root');
const a = new TreeNode('A');
const b = new TreeNode('B');
const c = new TreeNode('C');
a.add(new TreeNode('A1'));
a.add(new TreeNode('A2'));
b.add(new TreeNode('B1'));
b.add(new TreeNode('B2'));
c.add(new TreeNode('C1'));
root.add(a); root.add(b); root.add(c);

console.log('=== 深度优先遍历 ===');
const dfs = new DfsIterator(root);
while (dfs.hasNext()) {
  const n = dfs.next();
  if (n) console.log(n.value);
}

console.log('\\n=== 广度优先遍历 ===');
const bfs = new BfsIterator(root);
while (bfs.hasNext()) {
  const n = bfs.next();
  if (n) console.log(n.value);
}`,
    },
  },

  chainOfResponsibility: {
    id: 'chainOfResponsibility',
    name: 'Chain of Responsibility (责任链)',
    category: 'behavioral',
    description: '使多个对象都有机会处理请求，从而避免请求的发送者和接收者之间的耦合关系。将这些对象连成一条链，并沿着这条链传递该请求，直到有一个对象处理它为止。',
    useCases: [
      '有多个的对象可以处理一个请求，哪个对象处理该请求运行时刻自动确定',
      '你想在不明确指定接收者的情况下，向多个对象中的一个提交一个请求',
      '可处理一个请求的对象集合应被动态指定',
      '需要按顺序执行多个处理逻辑',
    ],
    pros: [
      '可以控制请求处理的顺序',
      '单一职责原则：可以对发起操作和执行操作的类进行解耦',
      '开闭原则：可以在不更改现有代码的情况下在程序中新增处理者',
      '可以灵活地增加或修改处理者',
    ],
    cons: [
      '部分请求可能未被处理',
      '请求的处理可能不太直观，调试困难',
      '如果链太长，可能会影响性能',
    ],
    codeExamples: {
      typescript: `interface Handler { setNext(handler: Handler): Handler; handle(request: string): string | null; }

abstract class AbstractHandler implements Handler {
  private next: Handler | null = null;
  setNext(handler: Handler): Handler { this.next = handler; return handler; }
  handle(request: string): string | null {
    if (this.next) return this.next.handle(request);
    return null;
  }
}

class AuthHandler extends AbstractHandler {
  handle(request: string): string | null {
    if (request.includes('token=valid')) {
      console.log('[Auth] 认证通过');
      return super.handle(request);
    }
    console.log('[Auth] 认证失败');
    return '401 Unauthorized';
  }
}

class RateLimitHandler extends AbstractHandler {
  private count = 0;
  private limit = 3;
  handle(request: string): string | null {
    if (this.count < this.limit) {
      this.count++;
      console.log(\`[RateLimit] 请求 \${this.count}/\${this.limit}\`);
      return super.handle(request);
    }
    console.log('[RateLimit] 超出限流');
    return '429 Too Many Requests';
  }
}

class LogHandler extends AbstractHandler {
  handle(request: string): string | null {
    console.log(\`[Log] 记录请求: \${request.slice(0, 30)}...\`);
    return super.handle(request);
  }
}

class BusinessHandler extends AbstractHandler {
  handle(request: string): string | null {
    console.log('[Business] 处理业务逻辑');
    return '200 OK - Success';
  }
}

const auth = new AuthHandler();
const rateLimit = new RateLimitHandler();
const log = new LogHandler();
const business = new BusinessHandler();

auth.setNext(rateLimit).setNext(log).setNext(business);

console.log('=== 请求 1（无 token）===');
console.log('结果:', auth.handle('GET /api/data?token=invalid'));

console.log('\\n=== 请求 2（有效 token）===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=1'));

console.log('\\n=== 请求 3 ===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=2'));

console.log('\\n=== 请求 4 ===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=3'));

console.log('\\n=== 请求 5（超出限流）===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=4'));`,
      react: `import React, { useState } from 'react';

interface ValidationRule {
  setNext(rule: ValidationRule): ValidationRule;
  validate(value: string): string | null;
}

abstract class BaseRule implements ValidationRule {
  private next: ValidationRule | null = null;
  setNext(rule: ValidationRule): ValidationRule { this.next = rule; return rule; }
  validate(value: string): string | null {
    if (this.next) return this.next.validate(value);
    return null;
  }
}

class RequiredRule extends BaseRule {
  validate(value: string): string | null {
    if (!value || !value.trim()) return '此字段为必填项';
    return super.validate(value);
  }
}

class MinLengthRule extends BaseRule {
  constructor(private min: number) { super(); }
  validate(value: string): string | null {
    if (value.length < this.min) return '最少 ' + this.min + ' 个字符';
    return super.validate(value);
  }
}

class MaxLengthRule extends BaseRule {
  constructor(private max: number) { super(); }
  validate(value: string): string | null {
    if (value.length > this.max) return '最多 ' + this.max + ' 个字符';
    return super.validate(value);
  }
}

class EmailRule extends BaseRule {
  validate(value: string): string | null {
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)) return '邮箱格式不正确';
    return super.validate(value);
  }
}

const ChainDemo: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const buildChain = (): ValidationRule => {
    const required = new RequiredRule();
    const min = new MinLengthRule(3);
    const max = new MaxLengthRule(50);
    const emailRule = new EmailRule();
    required.setNext(min).setNext(max).setNext(emailRule);
    return required;
  };

  const handleValidate = () => {
    const chain = buildChain();
    const err = chain.validate(email);
    setError(err);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>责任链模式 - 表单验证</h3>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>邮箱:</label>
        <input type="text" value={email} onChange={e => setEmail(e.target.value)}
          style={{ padding: '6px', width: '250px', border: error ? '1px solid #ff4d4f' : '1px solid #d9d9d9', borderRadius: '4px' }} />
      </div>
      <button onClick={handleValidate} style={{ padding: '6px 20px' }}>验证</button>
      {error && <div style={{ marginTop: '8px', color: '#ff4d4f' }}>❌ {error}</div>}
      {!error && email && <div style={{ marginTop: '8px', color: '#52c41a' }}>✅ 验证通过</div>}
    </div>
  );
};

export default ChainDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>责任链模式 - 表单验证</h3>
    <div style="margin-bottom: 12px;">
      <label style="display: block; margin-bottom: 4px;">邮箱:</label>
      <input type="text" v-model="email"
        :style="{ padding: '6px', width: '250px', border: error ? '1px solid #ff4d4f' : '1px solid #d9d9d9', borderRadius: '4px' }" />
    </div>
    <button @click="handleValidate" style="padding: 6px 20px;">验证</button>
    <div v-if="error" style="margin-top: 8px; color: #ff4d4f;">❌ {{ error }}</div>
    <div v-else-if="email && validated" style="margin-top: 8px; color: #52c41a;">✅ 验证通过</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface ValidationRule {
  setNext(rule: ValidationRule): ValidationRule;
  validate(value: string): string | null;
}

abstract class BaseRule implements ValidationRule {
  private next: ValidationRule | null = null;
  setNext(rule: ValidationRule): ValidationRule { this.next = rule; return rule; }
  validate(value: string): string | null {
    if (this.next) return this.next.validate(value);
    return null;
  }
}

class RequiredRule extends BaseRule {
  validate(value: string): string | null {
    if (!value || !value.trim()) return '此字段为必填项';
    return super.validate(value);
  }
}

class MinLengthRule extends BaseRule {
  constructor(private min: number) { super(); }
  validate(value: string): string | null {
    if (value.length < this.min) return '最少 ' + this.min + ' 个字符';
    return super.validate(value);
  }
}

class EmailRule extends BaseRule {
  validate(value: string): string | null {
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)) return '邮箱格式不正确';
    return super.validate(value);
  }
}

const email = ref('');
const error = ref<string | null>(null);
const validated = ref(false);

const buildChain = (): ValidationRule => {
  const required = new RequiredRule();
  const min = new MinLengthRule(3);
  const emailRule = new EmailRule();
  required.setNext(min).setNext(emailRule);
  return required;
};

const handleValidate = () => {
  const chain = buildChain();
  error.value = chain.validate(email.value);
  validated.value = !error.value;
};
</script>`,
      nodejs: `// 日志级别责任链
enum LogLevel { DEBUG = 1, INFO = 2, WARNING = 3, ERROR = 4 }

abstract class Logger {
  protected level: LogLevel;
  protected next: Logger | null = null;
  constructor(level: LogLevel) { this.level = level; }
  setNext(logger: Logger): Logger { this.next = logger; return logger; }
  log(level: LogLevel, message: string): void {
    if (level >= this.level) this.write(message);
    if (this.next) this.next.log(level, message);
  }
  protected abstract write(message: string): void;
}

class ConsoleLogger extends Logger {
  constructor(level: LogLevel) { super(level); }
  protected write(message: string): void { console.log('[Console]', message); }
}

class FileLogger extends Logger {
  constructor(level: LogLevel) { super(level); }
  protected write(message: string): void { console.log('[File] 写入日志文件:', message); }
}

class EmailLogger extends Logger {
  constructor(level: LogLevel) { super(level); }
  protected write(message: string): void { console.log('[Email] 发送告警邮件:', message); }
}

const consoleLogger = new ConsoleLogger(LogLevel.DEBUG);
const fileLogger = new FileLogger(LogLevel.INFO);
const emailLogger = new EmailLogger(LogLevel.ERROR);

consoleLogger.setNext(fileLogger).setNext(emailLogger);

console.log('=== DEBUG 级别 ===');
consoleLogger.log(LogLevel.DEBUG, '调试信息：变量值为 42');

console.log('\\n=== INFO 级别 ===');
consoleLogger.log(LogLevel.INFO, '系统启动完成');

console.log('\\n=== WARNING 级别 ===');
consoleLogger.log(LogLevel.WARNING, '内存使用率达到 80%');

console.log('\\n=== ERROR 级别 ===');
consoleLogger.log(LogLevel.ERROR, '数据库连接失败！');`,
    },
  },

  // ==================== 前端特有 Frontend-specific ====================

  hoc: {
    id: 'hoc',
    name: 'HOC (高阶组件)',
    category: 'frontend',
    description: '高阶组件是参数为组件，返回值为新组件的函数。HOC 是 React 生态系统中常见的模式，用于复用组件逻辑。',
    useCases: [
      '需要在多个组件间共享通用逻辑（如鉴权、日志、数据获取）',
      '需要增强现有组件的功能而不修改其源码',
      '需要横切关注点的分离（如错误边界、加载状态）',
      '需要对组件进行包装以添加额外的 props 或行为',
    ],
    pros: [
      '逻辑复用：可以在多个组件间共享相同的逻辑',
      '组合性：可以将多个 HOC 组合使用',
      '关注点分离：将横切逻辑从业务组件中抽离',
      '不修改原组件，符合开闭原则',
    ],
    cons: [
      '命名冲突：多个 HOC 可能传递同名的 props',
      '调试困难：组件被多层包装后，难以追踪来源',
      'Ref 传递问题：需要使用 forwardRef 来传递 ref',
      '可能导致 Wrapper Hell（多层嵌套）',
    ],
    codeExamples: {
      typescript: `// HOC 在 TypeScript 中的类型定义
type HOC<P = {}, EP = {}> = (Component: React.ComponentType<P>) => React.ComponentType<Omit<P, keyof EP> & Partial<EP>>;

// 示例：withLoading HOC
interface WithLoadingProps { loading?: boolean; }

function withLoading<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return ({ loading, ...props }: WithLoadingProps & Omit<P, keyof WithLoadingProps>) => {
    if (loading) return <div>加载中...</div>;
    return <WrappedComponent {...(props as P)} />;
  };
}`,
      react: `import React, { useState, useEffect } from 'react';

// HOC: 添加用户信息
interface WithUserProps { user: { name: string; role: string } | null; }

function withUser<P extends object>(WrappedComponent: React.ComponentType<P>) {
  const WithUser = (props: Omit<P, keyof WithUserProps>) => {
    const [user, setUser] = useState<{ name: string; role: string } | null>(null);
    useEffect(() => {
      setTimeout(() => setUser({ name: 'Alice', role: 'admin' }), 500);
    }, []);
    return <WrappedComponent {...(props as P)} user={user} />;
  };
  WithUser.displayName = \`WithUser(\${WrappedComponent.displayName || WrappedComponent.name || 'Component'})\`;
  return WithUser;
}

// HOC: 添加日志
function withLogger<P extends object>(WrappedComponent: React.ComponentType<P>) {
  const WithLogger = (props: P) => {
    useEffect(() => { console.log('组件挂载'); return () => console.log('组件卸载'); }, []);
    useEffect(() => { console.log('Props 变化:', props); }, [props]);
    return <WrappedComponent {...props} />;
  };
  WithLogger.displayName = \`WithLogger(\${WrappedComponent.displayName || WrappedComponent.name || 'Component'})\`;
  return WithLogger;
}

// 普通组件
interface UserProfileProps { user: { name: string; role: string } | null; title?: string; }

const UserProfile: React.FC<UserProfileProps> = ({ user, title = '用户信息' }) => (
  <div style={{ padding: '16px', border: '1px solid #d9d9d9', borderRadius: '8px' }}>
    <h3>{title}</h3>
    {user ? (
      <div><p>姓名: {user.name}</p><p>角色: {user.role}</p></div>
    ) : <p>加载中...</p>}
  </div>
);

// 组合 HOC
const EnhancedProfile = withLogger(withUser(UserProfile));

const HocDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
    <h3>HOC 模式</h3>
    <EnhancedProfile title="用户资料" />
  </div>
);

export default HocDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>HOC 模式 (Vue 组合式函数替代)</h3>
    <EnhancedProfile title="用户资料" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, defineComponent, h, watch } from 'vue';

// Vue 中通常用组合式函数替代 HOC，但也可以实现类似 HOC 的包装器
function withUser(Wrapped: any) {
  return defineComponent({
    name: 'WithUser',
    props: Wrapped.props || {},
    setup(props, { attrs }) {
      const user = ref<{ name: string; role: string } | null>(null);
      onMounted(() => { setTimeout(() => { user.value = { name: 'Alice', role: 'admin' }; }, 500); });
      return () => h(Wrapped, { ...props, ...attrs, user: user.value });
    },
  });
}

function withLogger(Wrapped: any) {
  return defineComponent({
    name: 'WithLogger',
    props: Wrapped.props || {},
    setup(props, { attrs }) {
      onMounted(() => console.log('组件挂载'));
      onUnmounted(() => console.log('组件卸载'));
      watch(() => props, (newVal) => console.log('Props 变化:', newVal), { deep: true });
      return () => h(Wrapped, { ...props, ...attrs });
    },
  });
}

const UserProfile = defineComponent({
  name: 'UserProfile',
  props: { user: Object, title: { type: String, default: '用户信息' } },
  setup(props) {
    return () =>
      h('div', { style: { padding: '16px', border: '1px solid #d9d9d9', borderRadius: '8px' } }, [
        h('h3', props.title),
        props.user
          ? h('div', [h('p', '姓名: ' + props.user.name), h('p', '角色: ' + props.user.role)])
          : h('p', '加载中...'),
      ]);
  },
});

const EnhancedProfile = withLogger(withUser(UserProfile));
</script>`,
      nodejs: `// Node.js 中类似 HOC 的函数装饰器模式
function withLogging(fn: Function) {
  return function(...args: any[]) {
    console.log(\`[LOG] 调用 \${fn.name}, 参数:\`, args);
    const start = Date.now();
    const result = fn(...args);
    console.log(\`[LOG] \${fn.name} 执行耗时: \${Date.now() - start}ms\`);
    return result;
  };
}

function withCache(fn: Function) {
  const cache = new Map();
  return function(...args: any[]) {
    const key = JSON.stringify(args);
    if (cache.has(key)) { console.log('[CACHE] 命中:', key); return cache.get(key); }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function add(a: number, b: number): number { return a + b; }

const loggedAdd = withLogging(add);
const cachedFib = withCache(withLogging(fibonacci));

console.log('=== withLogging 示例 ===');
console.log('结果:', loggedAdd(3, 5));

console.log('\\n=== withCache + withLogging 组合 ===');
console.log('第一次调用:');
console.log('fib(30) =', cachedFib(30));
console.log('第二次调用（缓存）:');
console.log('fib(30) =', cachedFib(30));`,
    },
  },

  customHook: {
    id: 'customHook',
    name: 'Custom Hook (自定义 Hook)',
    category: 'frontend',
    description: '自定义 Hook 是一个函数，其名称以 "use" 开头，函数内部可以调用其他的 Hook。它让你能够在不编写类的情况下复用状态逻辑。',
    useCases: [
      '需要在多个组件间复用状态逻辑',
      '复杂组件中的逻辑需要拆分以提高可读性',
      '需要将副作用逻辑封装起来',
      '需要共享数据获取、订阅、DOM 操作等逻辑',
    ],
    pros: [
      '逻辑复用：可以在多个组件间共享状态逻辑',
      '更直观：相比 HOC，Hook 的数据流更清晰',
      '避免嵌套地狱：不会产生多层组件包装',
      '类型友好：TypeScript 类型推导更自然',
      '易于测试：可以单独测试自定义 Hook',
    ],
    cons: [
      '需要遵循 Hook 规则（只能在函数组件顶层调用）',
      '过度抽象可能导致代码难以理解',
      '自定义 Hook 之间共享状态需要额外处理',
    ],
    codeExamples: {
      typescript: `// 自定义 Hook 的 TypeScript 类型示例
import { useState, useEffect, useCallback } from 'react';

function useFetch<T>(url: string, options?: RequestInit) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      setData(json);
    } catch (e: any) { setError(e); }
    finally { setLoading(false); }
  }, [url, options]);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}`,
      react: `import React, { useState, useEffect, useCallback, useRef } from 'react';

// useCounter Hook
function useCounter(initial = 0, step = 1) {
  const [count, setCount] = useState(initial);
  const increment = useCallback(() => setCount(c => c + step), [step]);
  const decrement = useCallback(() => setCount(c => c - step), [step]);
  const reset = useCallback(() => setCount(initial), [initial]);
  return { count, increment, decrement, reset, setCount };
}

// useLocalStorage Hook
function useLocalStorage<T>(key: string, initial: T): [T, (val: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initial;
    } catch { return initial; }
  });
  const setStoredValue = useCallback((val: T) => {
    setValue(val);
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }, [key]);
  return [value, setStoredValue];
}

// useDebounce Hook
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const HookDemo: React.FC = () => {
  const counter = useCounter(0, 1);
  const [name, setName] = useLocalStorage('demo-name', 'Guest');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>自定义 Hook 模式</h3>
      <div style={{ marginBottom: '16px' }}>
        <h4>useCounter:</h4>
        <p>计数: {counter.count}</p>
        <button onClick={counter.increment} style={{ marginRight: '8px' }}>+1</button>
        <button onClick={counter.decrement} style={{ marginRight: '8px' }}>-1</button>
        <button onClick={counter.reset}>重置</button>
      </div>
      <div style={{ marginBottom: '16px' }}>
        <h4>useLocalStorage:</h4>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="输入名字" style={{ padding: '4px' }} />
        <p>保存的值: {name}</p>
      </div>
      <div>
        <h4>useDebounce:</h4>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索..." style={{ padding: '4px' }} />
        <p>防抖值（500ms）: {debouncedSearch}</p>
      </div>
    </div>
  );
};

export default HookDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>自定义 Hook 模式 (Vue 组合式函数)</h3>
    <div style="margin-bottom: 16px;">
      <h4>useCounter:</h4>
      <p>计数: {{ counter.count }}</p>
      <button @click="counter.increment" style="margin-right: 8px;">+1</button>
      <button @click="counter.decrement" style="margin-right: 8px;">-1</button>
      <button @click="counter.reset">重置</button>
    </div>
    <div>
      <h4>useDebounce:</h4>
      <input v-model="search" placeholder="搜索..." style="padding: 4px;" />
      <p>防抖值（500ms）: {{ debouncedSearch }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

// useCounter 组合式函数
function useCounter(initial = 0, step = 1) {
  const count = ref(initial);
  const increment = () => { count.value += step; };
  const decrement = () => { count.value -= step; };
  const reset = () => { count.value = initial; };
  return { count, increment, decrement, reset };
}

// useDebounce 组合式函数
function useDebounce<T>(value: () => T, delay: number) {
  const debounced = ref(value()) as any;
  let timer: any = null;
  watch(value, (newVal) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { debounced.value = newVal; }, delay);
  });
  return debounced;
}

const counter = useCounter(0, 1);
const search = ref('');
const debouncedSearch = useDebounce(() => search.value, 500);
</script>`,
      nodejs: `// Node.js 中类似 Hook 模式的函数式封装
const EventEmitter = require('events');

// useTimer - 类似 React useEffect 的定时器封装
function useInterval(callback: () => void, delay: number) {
  const timer = setInterval(callback, delay);
  return () => clearInterval(timer);
}

// useRetry - 带重试的异步操作
async function useRetry<T>(fn: () => Promise<T>, maxRetries = 3, delay = 1000): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastError = e;
      console.log(\`重试 \${i + 1}/\${maxRetries}: \${e.message}\`);
      if (i < maxRetries - 1) await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError!;
}

// useMemo - 计算结果缓存
function useMemo<T>(fn: () => T): () => T {
  let cached: T | undefined;
  let computed = false;
  return () => {
    if (!computed) { cached = fn(); computed = true; }
    return cached!;
  };
}

async function main() {
  console.log('=== useRetry 示例 ===');
  let count = 0;
  const unreliable = () => {
    count++;
    if (count < 3) return Promise.reject(new Error('临时故障'));
    return Promise.resolve('成功');
  };
  try {
    const result = await useRetry(unreliable, 5, 200);
    console.log('最终结果:', result);
  } catch (e: any) {
    console.log('失败:', e.message);
  }

  console.log('\\n=== useMemo 示例 ===');
  const expensive = useMemo(() => {
    console.log('计算中...');
    let sum = 0;
    for (let i = 0; i < 1000000; i++) sum += i;
    return sum;
  });
  console.log('第一次调用:', expensive());
  console.log('第二次调用（缓存）:', expensive());
}

main();`,
    },
  },

  renderProps: {
    id: 'renderProps',
    name: 'Render Props (渲染属性)',
    category: 'frontend',
    description: 'Render Props 是指一种在 React 组件之间使用一个值为函数的 prop 共享代码的简单技术。组件接收一个返回 React 元素的函数，并在渲染时调用这个函数。',
    useCases: [
      '需要在多个组件间共享状态或行为，但不希望使用 HOC',
      '需要动态决定渲染内容',
      '需要将组件的内部状态暴露给使用者',
      '需要更灵活的组件复用方式',
    ],
    pros: [
      '灵活性高：可以精确控制渲染内容',
      '命名空间清晰：不会像 HOC 那样产生 props 命名冲突',
      '数据来源明确：容易追踪数据来源',
      '组合性强：可以与其他模式结合使用',
    ],
    cons: [
      '嵌套层级可能较深（类似回调地狱）',
      '性能问题：每次渲染都会创建新的函数',
      '对于简单场景可能过于复杂',
      '代码可读性可能不如 Hook 直观',
    ],
    codeExamples: {
      typescript: `// Render Props 的 TypeScript 类型定义
interface RenderPropsChildren<T> {
  children: (data: T) => React.ReactNode;
}

interface MousePosition { x: number; y: number; }

interface MouseTrackerProps {
  children: (position: MousePosition) => React.ReactNode;
}`,
      react: `import React, { useState, useEffect, useCallback } from 'react';

// MouseTracker: 使用 render prop 共享鼠标位置
const MouseTracker: React.FC<any> = ({ children }) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);
  return <div onMouseMove={handleMouseMove} style={{ height: '200px', border: '1px solid #d9d9d9', borderRadius: '8px', position: 'relative', overflow: 'hidden' }}>{children(position)}</div>;
};

// Toggle: 使用 render prop 共享开关状态
const Toggle: React.FC<any> = ({ children, initial = false }) => {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn(o => !o), []);
  return children({ on, toggle, setOn });
};

// Counter: 使用 render prop 共享计数逻辑
const Counter: React.FC<any> = ({ children, initial = 0 }) => {
  const [count, setCount] = useState(initial);
  const increment = useCallback(() => setCount(c => c + 1), []);
  const decrement = useCallback(() => setCount(c => c - 1), []);
  const reset = useCallback(() => setCount(initial), [initial]);
  return children({ count, increment, decrement, reset, setCount });
};

const RenderPropsDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
    <h3>Render Props 模式</h3>

    <div style={{ marginBottom: '20px' }}>
      <h4>MouseTracker:</h4>
      <MouseTracker>
        {(pos: any) => (
          <div style={{ padding: '10px', background: '#f5f5f5', position: 'absolute', top: 10, left: 10 }}>
            鼠标位置: ({pos.x}, {pos.y})
          </div>
        )}
      </MouseTracker>
    </div>

    <div style={{ marginBottom: '20px' }}>
      <h4>Toggle:</h4>
      <Toggle initial={false}>
        {({ on, toggle }: any) => (
          <div>
            <button onClick={toggle} style={{ padding: '6px 16px' }}>{on ? '关闭' : '打开'}</button>
            <p style={{ marginTop: '8px' }}>状态: {on ? '✅ 开' : '❌ 关'}</p>
          </div>
        )}
      </Toggle>
    </div>

    <div>
      <h4>Counter:</h4>
      <Counter initial={10}>
        {({ count, increment, decrement, reset }: any) => (
          <div>
            <p>计数: <strong>{count}</strong></p>
            <button onClick={decrement} style={{ marginRight: '8px' }}>-</button>
            <button onClick={increment} style={{ marginRight: '8px' }}>+</button>
            <button onClick={reset}>重置</button>
          </div>
        )}
      </Counter>
    </div>
  </div>
);

export default RenderPropsDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>Render Props 模式 (Vue 作用域插槽)</h3>
    <div style="margin-bottom: 20px;">
      <h4>Toggle (作用域插槽):</h4>
      <Toggle :initial="false" v-slot="{ on, toggle }">
        <button @click="toggle" style="padding: 6px 16px;">{{ on ? '关闭' : '打开' }}</button>
        <p style="margin-top: 8px;">状态: {{ on ? '✅ 开' : '❌ 关' }}</p>
      </Toggle>
    </div>
    <div>
      <h4>Counter (作用域插槽):</h4>
      <Counter :initial="10" v-slot="{ count, increment, decrement, reset }">
        <p>计数: <strong>{{ count }}</strong></p>
        <button @click="decrement" style="margin-right: 8px;">-</button>
        <button @click="increment" style="margin-right: 8px;">+</button>
        <button @click="reset">重置</button>
      </Counter>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineComponent, h } from 'vue';

const Toggle = defineComponent({
  name: 'Toggle',
  props: { initial: { type: Boolean, default: false } },
  setup(props, { slots }) {
    const on = ref(props.initial);
    const toggle = () => { on.value = !on.value; };
    return () => slots.default?.({ on: on.value, toggle, setOn: (v: boolean) => { on.value = v; } });
  },
});

const Counter = defineComponent({
  name: 'Counter',
  props: { initial: { type: Number, default: 0 } },
  setup(props, { slots }) {
    const count = ref(props.initial);
    const increment = () => { count.value++; };
    const decrement = () => { count.value--; };
    const reset = () => { count.value = props.initial; };
    return () => slots.default?.({ count: count.value, increment, decrement, reset });
  },
});
</script>`,
      nodejs: `// Node.js 中类似 render props 的回调模式
function withTimer(duration: number, onTick: (remaining: number) => void, onComplete: () => void) {
  let remaining = duration;
  const timer = setInterval(() => {
    remaining--;
    onTick(remaining);
    if (remaining <= 0) { clearInterval(timer); onComplete(); }
  }, 1000);
  return () => clearInterval(timer);
}

function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  onRetry: (attempt: number, error: Error) => void
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    let lastError: Error | null = null;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        const result = await operation();
        resolve(result);
        return;
      } catch (e: any) {
        lastError = e;
        if (i < maxRetries) onRetry(i + 1, e);
      }
    }
    reject(lastError);
  });
}

async function main() {
  console.log('=== withRetry 回调模式 ===');
  let count = 0;
  const unreliable = async () => {
    count++;
    if (count < 3) throw new Error('临时故障 ' + count);
    return '成功结果';
  };

  try {
    const result = await withRetry(
      unreliable,
      3,
      (attempt, error) => console.log(\`第 \${attempt} 次重试: \${error.message}\`)
    );
    console.log('最终结果:', result);
  } catch (e: any) {
    console.log('失败:', e.message);
  }
}

main();`,
    },
  },

  compoundComponents: {
    id: 'compoundComponents',
    name: 'Compound Components (复合组件)',
    category: 'frontend',
    description: '复合组件是一种将多个组件组合在一起工作，共同完成一个完整功能的模式。它们通过共享隐式状态来实现组件间的协作。',
    useCases: [
      '需要创建一组协同工作的组件（如 Tabs、Dropdown、Menu）',
      '需要灵活的组件 API，用户可以自由组合子组件',
      '需要在父子组件间隐式共享状态',
      '需要提供声明式的组件使用方式',
    ],
    pros: [
      'API 优雅：使用声明式语法，可读性好',
      '灵活性高：用户可以自由组合子组件',
      '状态共享：通过 Context 隐式共享状态，无需手动传递 props',
      '可扩展性：可以方便地添加新的子组件类型',
    ],
    cons: [
      '实现相对复杂',
      '需要使用 Context 或其他状态共享机制',
      '对于简单场景可能过度设计',
      '子组件之间的依赖关系不明显',
    ],
    codeExamples: {
      typescript: `// 复合组件的 TypeScript 类型定义
interface TabsContextType {
  activeKey: string;
  onChange: (key: string) => void;
}

interface TabProps {
  tabKey: string;
  label: React.ReactNode;
  children: React.ReactNode;
}

interface TabsProps {
  defaultActiveKey?: string;
  activeKey?: string;
  onChange?: (key: string) => void;
  children: React.ReactNode;
}`,
      react: `import React, { useState, createContext, useContext, useMemo } from 'react';

// Tabs 复合组件
interface TabsContextType { activeKey: string; onChange: (key: string) => void; }
const TabsContext = createContext<TabsContextType | null>(null);

const useTabs = () => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab 必须在 Tabs 内使用');
  return ctx;
};

const Tabs: React.FC<any> & { Tab: React.FC<any>; TabList: React.FC<any>; TabPanels: React.FC<any>; TabPanel: React.FC<any> } = ({ defaultActiveKey, activeKey: controlledKey, onChange, children }) => {
  const [internalKey, setInternalKey] = useState(defaultActiveKey || '');
  const isControlled = controlledKey !== undefined;
  const activeKey = isControlled ? controlledKey : internalKey;

  const handleChange = (key: string) => {
    if (!isControlled) setInternalKey(key);
    onChange?.(key);
  };

  const contextValue = useMemo(() => ({ activeKey, onChange: handleChange }), [activeKey]);
  return <TabsContext.Provider value={contextValue}><div className="tabs">{children}</div></TabsContext.Provider>;
};

Tabs.TabList = ({ children }) => {
  const { activeKey, onChange } = useTabs();
  return (
    <div style={{ display: 'flex', borderBottom: '2px solid #d9d9d9', marginBottom: '16px' }}>
      {React.Children.map(children, child => {
        if (!React.isValidElement(child)) return null;
        const key = child.props.tabKey;
        return React.cloneElement(child as React.ReactElement<any>, {
          active: activeKey === key,
          onClick: () => onChange(key),
        });
      })}
    </div>
  );
};

Tabs.Tab = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 'bold' : 'normal', color: active ? '#1890ff' : '#333', borderBottom: active ? '2px solid #1890ff' : 'none', marginBottom: '-2px' }}>{label}</button>
);

Tabs.TabPanels = ({ children }) => {
  const { activeKey } = useTabs();
  const activeChild = React.Children.toArray(children).find(child => React.isValidElement(child) && child.props.tabKey === activeKey);
  return <div>{activeChild}</div>;
};

Tabs.TabPanel = ({ children }) => <div style={{ padding: '16px 0' }}>{children}</div>;

const CompoundDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
    <h3>复合组件模式 - Tabs</h3>
    <Tabs defaultActiveKey="tab1">
      <Tabs.TabList>
        <Tabs.Tab tabKey="tab1" label="首页" />
        <Tabs.Tab tabKey="tab2" label="产品" />
        <Tabs.Tab tabKey="tab3" label="关于" />
      </Tabs.TabList>
      <Tabs.TabPanels>
        <Tabs.TabPanel tabKey="tab1"><h4>欢迎来到首页</h4><p>这是首页的内容。</p></Tabs.TabPanel>
        <Tabs.TabPanel tabKey="tab2"><h4>产品列表</h4><p>这里展示我们的产品。</p></Tabs.TabPanel>
        <Tabs.TabPanel tabKey="tab3"><h4>关于我们</h4><p>了解更多关于我们的信息。</p></Tabs.TabPanel>
      </Tabs.TabPanels>
    </Tabs>
  </div>
);

export default CompoundDemo;`,
      vue: `<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>复合组件模式 - Tabs</h3>
    <Tabs default-active-key="tab1">
      <template #tabs>
        <Tab tab-key="tab1" label="首页" />
        <Tab tab-key="tab2" label="产品" />
        <Tab tab-key="tab3" label="关于" />
      </template>
      <TabPanel tab-key="tab1">
        <h4>欢迎来到首页</h4>
        <p>这是首页的内容。</p>
      </TabPanel>
      <TabPanel tab-key="tab2">
        <h4>产品列表</h4>
        <p>这里展示我们的产品。</p>
      </TabPanel>
      <TabPanel tab-key="tab3">
        <h4>关于我们</h4>
        <p>了解更多关于我们的信息。</p>
      </TabPanel>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, inject, defineComponent, h, computed } from 'vue';

const TabsContextKey = Symbol('tabs');

const Tabs = defineComponent({
  name: 'Tabs',
  props: { defaultActiveKey: String },
  setup(props, { slots }) {
    const activeKey = ref(props.defaultActiveKey || '');
    const changeTab = (key: string) => { activeKey.value = key; };
    provide(TabsContextKey, { activeKey, changeTab });
    return () => {
      const tabs = slots.tabs?.();
      const panels = slots.default?.();
      return h('div', [
        h('div', { style: { display: 'flex', borderBottom: '2px solid #d9d9d9', marginBottom: '16px' } }, tabs),
        h('div', panels),
      ]);
    };
  },
});

const Tab = defineComponent({
  name: 'Tab',
  props: { tabKey: String, label: String },
  setup(props) {
    const ctx = inject<any>(TabsContextKey);
    const isActive = computed(() => ctx.activeKey.value === props.tabKey);
    const onClick = () => { ctx.changeTab(props.tabKey); };
    return () =>
      h('button', {
        onClick,
        style: {
          padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontWeight: isActive.value ? 'bold' : 'normal',
          color: isActive.value ? '#1890ff' : '#333',
          borderBottom: isActive.value ? '2px solid #1890ff' : 'none',
          marginBottom: '-2px',
        },
      }, props.label);
  },
});

const TabPanel = defineComponent({
  name: 'TabPanel',
  props: { tabKey: String },
  setup(props, { slots }) {
    const ctx = inject<any>(TabsContextKey);
    const isActive = computed(() => ctx.activeKey.value === props.tabKey);
    return () => isActive.value ? h('div', { style: { padding: '16px 0' } }, slots.default?.()) : null;
  },
});
</script>`,
      nodejs: `// Node.js 中类似复合组件的建造者模式
class QueryBuilder {
  private table = '';
  private selectFields: string[] = [];
  private whereConditions: string[] = [];
  private orderByField = '';
  private limitCount = 0;
  private offsetCount = 0;

  from(table: string): this { this.table = table; return this; }
  select(...fields: string[]): this { this.selectFields = fields; return this; }
  where(condition: string): this { this.whereConditions.push(condition); return this; }
  orderBy(field: string): this { this.orderByField = field; return this; }
  limit(count: number): this { this.limitCount = count; return this; }
  offset(count: number): this { this.offsetCount = count; return this; }

  build(): string {
    const fields = this.selectFields.length ? this.selectFields.join(', ') : '*';
    let sql = \`SELECT \${fields} FROM \${this.table}\`;
    if (this.whereConditions.length) sql += ' WHERE ' + this.whereConditions.join(' AND ');
    if (this.orderByField) sql += ' ORDER BY ' + this.orderByField;
    if (this.limitCount) sql += ' LIMIT ' + this.limitCount;
    if (this.offsetCount) sql += ' OFFSET ' + this.offsetCount;
    return sql + ';';
  }

  execute(): any[] {
    const sql = this.build();
    console.log('执行 SQL:', sql);
    return [{ id: 1, name: '示例数据' }];
  }
}

// 使用建造者模式（类似复合组件的链式调用）
const query = new QueryBuilder()
  .select('id', 'name', 'email')
  .from('users')
  .where('age > 18')
  .where('status = "active"')
  .orderBy('created_at')
  .limit(10)
  .offset(20);

const sql = query.build();
console.log('生成的 SQL:', sql);
const results = query.execute();
console.log('结果:', results);`,
    },
  },

  provider: {
    id: 'provider',
    name: 'Provider Pattern (提供者模式)',
    category: 'frontend',
    description: 'Provider 模式通过 Context API 将状态和方法传递给需要它们的子组件，避免了 props 逐层传递的问题。它是 React 生态中最核心的模式之一。',
    useCases: [
      '需要在多层嵌套的组件间共享全局状态（如主题、用户信息、语言）',
      '需要避免 props drilling（属性逐层传递）',
      '需要提供应用级别的配置或服务',
      '需要实现依赖注入',
    ],
    pros: [
      '避免 props drilling：数据可以直接被需要的组件访问',
      '全局状态管理：方便管理应用级别的状态',
      '声明式：使用 Provider 包裹组件树，声明清晰',
      '易于测试：可以通过不同的 Provider 提供不同的状态',
    ],
    cons: [
      '过度使用可能导致组件复用困难',
      'Context 变化会导致所有消费者重新渲染',
      '调试困难：数据来源不直观',
      '可能导致组件与 Context 耦合',
    ],
    codeExamples: {
      typescript: `// Provider 模式的 TypeScript 类型定义
import { createContext, useContext } from 'react';

interface Theme { bgColor: string; textColor: string; primaryColor: string; }

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}`,
      react: `import React, { useState, useMemo, createContext, useContext } from 'react';

// Theme Context
interface Theme { bg: string; text: string; primary: string; cardBg: string; }
const lightTheme: Theme = { bg: '#fff', text: '#333', primary: '#1890ff', cardBg: '#fafafa' };
const darkTheme: Theme = { bg: '#1f1f1f', text: '#fff', primary: '#40a9ff', cardBg: '#2d2d2d' };

const ThemeContext = createContext<{ theme: Theme; toggle: () => void; isDark: boolean } | null>(null);
const useTheme = () => { const ctx = useContext(ThemeContext); if (!ctx) throw new Error('useTheme must be used in ThemeProvider'); return ctx; };

const ThemeProvider: React.FC<any> = ({ children }) => {
  const [isDark, setIsDark] = useState(false);
  const theme = isDark ? darkTheme : lightTheme;
  const toggle = () => setIsDark(d => !d);
  const value = useMemo(() => ({ theme, toggle, isDark }), [theme, toggle, isDark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// User Context
interface User { name: string; role: string; }
const UserContext = createContext<{ user: User | null; login: (name: string) => void; logout: () => void } | null>(null);
const useUser = () => { const ctx = useContext(UserContext); if (!ctx) throw new Error('useUser must be used in UserProvider'); return ctx; };

const UserProvider: React.FC<any> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const login = (name: string) => setUser({ name, role: 'user' });
  const logout = () => setUser(null);
  const value = useMemo(() => ({ user, login, logout }), [user]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

// 使用 Context 的组件
const ThemeToggle = () => {
  const { theme, toggle, isDark } = useTheme();
  return <button onClick={toggle} style={{ padding: '8px 16px', background: theme.primary, color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{isDark ? '☀️ 浅色' : '🌙 深色'}</button>;
};

const UserInfo = () => {
  const { user, login, logout } = useUser();
  const { theme } = useTheme();
  return (
    <div style={{ padding: '12px', background: theme.cardBg, color: theme.text, borderRadius: '8px' }}>
      {user ? (
        <div>
          <p>当前用户: <strong>{user.name}</strong></p>
          <button onClick={logout} style={{ padding: '4px 12px' }}>退出</button>
        </div>
      ) : (
        <div>
          <p>未登录</p>
          <button onClick={() => login('Alice')} style={{ padding: '4px 12px' }}>登录</button>
        </div>
      )}
    </div>
  );
};

const ProviderDemo: React.FC = () => (
  <ThemeProvider>
    <UserProvider>
      <div style={{ fontFamily: 'sans-serif', padding: '20px', background: useTheme().theme.bg, minHeight: '200px', transition: 'all 0.3s' }}>
        <h3 style={{ color: useTheme().theme.text }}>Provider 模式</h3>
        <div style={{ marginBottom: '16px' }}><ThemeToggle /></div>
        <UserInfo />
      </div>
    </UserProvider>
  </ThemeProvider>
);

export default ProviderDemo;`,
      vue: `<template>
  <div :style="{ fontFamily: 'sans-serif', padding: '20px', background: theme.bg, minHeight: '200px', transition: 'all 0.3s' }">
    <h3 :style="{ color: theme.text }">Provider 模式 (Vue Provide/Inject)</h3>
    <div style="margin-bottom: 16px;"><ThemeToggle /></div>
    <UserInfo />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, provide, inject, defineComponent, h } from 'vue';

interface Theme { bg: string; text: string; primary: string; cardBg: string; }
const lightTheme: Theme = { bg: '#fff', text: '#333', primary: '#1890ff', cardBg: '#fafafa' };
const darkTheme: Theme = { bg: '#1f1f1f', text: '#fff', primary: '#40a9ff', cardBg: '#2d2d2d' };

const ThemeKey = Symbol('theme');
const UserKey = Symbol('user');

const isDark = ref(false);
const theme = computed(() => isDark.value ? darkTheme : lightTheme);
const toggleTheme = () => { isDark.value = !isDark.value; };
provide(ThemeKey, { theme, toggleTheme, isDark });

const user = ref<{ name: string; role: string } | null>(null);
const login = (name: string) => { user.value = { name, role: 'user' }; };
const logout = () => { user.value = null; };
provide(UserKey, { user, login, logout });

const ThemeToggle = defineComponent({
  name: 'ThemeToggle',
  setup() {
    const { theme, toggleTheme, isDark } = inject<any>(ThemeKey);
    return () => h('button', {
      onClick: toggleTheme,
      style: { padding: '8px 16px', background: theme.value.primary, color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
    }, isDark.value ? '☀️ 浅色' : '🌙 深色');
  },
});

const UserInfo = defineComponent({
  name: 'UserInfo',
  setup() {
    const { user, login, logout } = inject<any>(UserKey);
    const { theme } = inject<any>(ThemeKey);
    return () =>
      h('div', { style: { padding: '12px', background: theme.value.cardBg, color: theme.value.text, borderRadius: '8px' } },
        user.value
          ? [h('p', '当前用户: '), h('strong', user.value.name), h('br'), h('button', { onClick: logout, style: { padding: '4px 12px' } }, '退出')]
          : [h('p', '未登录'), h('button', { onClick: () => login('Alice'), style: { padding: '4px 12px' } }, '登录')]
      );
  },
});
</script>`,
      nodejs: `// Node.js 中的依赖注入（类似 Provider 模式）
class Container {
  private services = new Map<string, () => any>();
  private instances = new Map<string, any>();

  register(name: string, factory: () => any): void { this.services.set(name, factory); }

  get<T = any>(name: string): T {
    if (this.instances.has(name)) return this.instances.get(name);
    const factory = this.services.get(name);
    if (!factory) throw new Error('Service not found: ' + name);
    const instance = factory();
    this.instances.set(name, instance);
    return instance;
  }
}

// 服务定义
class LoggerService { log(msg: string): void { console.log('[LOG]', msg); } }
class DatabaseService {
  constructor(private logger: LoggerService) {}
  query(sql: string): any[] { this.logger.log('执行查询: ' + sql); return [{ id: 1 }]; }
}
class UserService {
  constructor(private db: DatabaseService, private logger: LoggerService) {}
  getUser(id: string): any {
    this.logger.log('获取用户: ' + id);
    return this.db.query('SELECT * FROM users WHERE id=' + id)[0];
  }
}

// 注册服务（类似 Provider）
const container = new Container();
container.register('logger', () => new LoggerService());
container.register('database', () => new DatabaseService(container.get('logger')));
container.register('userService', () => new UserService(container.get('database'), container.get('logger')));

// 使用服务（类似 useContext）
const userService = container.get<UserService>('userService');
const user = userService.getUser('123');
console.log('用户:', user);

const logger = container.get<LoggerService>('logger');
logger.log('应用启动完成');`,
    },
  },

  // __PATTERN_LIBRARY_END__
};

// ============================================================
// 辅助函数
// ============================================================

function makeResult(data, llmEnhanced, llmProvider) {
  return {
    ok: true,
    data: {
      ...data,
      llmEnhanced: llmEnhanced || false,
      llmProvider: llmProvider || null,
    },
    warnings: [],
    nextActions: [],
  };
}

function makeError(message, code) {
  return {
    ok: false,
    error: message,
    errorCode: code || 'UNKNOWN_ERROR',
    data: { llmEnhanced: false, llmProvider: null },
    warnings: [],
    nextActions: [],
  };
}

function getPatternById(id) {
  return PATTERN_LIBRARY[id] || null;
}

function getPatternsByCategory(category) {
  return Object.values(PATTERN_LIBRARY).filter(p => p.category === category);
}

function searchPatterns(keyword) {
  const kw = keyword.toLowerCase();
  return Object.values(PATTERN_LIBRARY).filter(p =>
    p.id.toLowerCase().includes(kw) ||
    p.name.toLowerCase().includes(kw) ||
    p.description.toLowerCase().includes(kw)
  );
}

// ============================================================
// 命令实现
// ============================================================

// ============================================================
// 命令实现
// ============================================================

/**
 * init - 初始化模式目录
 * 创建 .patterns/ 目录，按分类生成模式模板文件
 */
async function init(options = {}) {
  const targetDir = options.outputDir || path.join(process.cwd(), '.patterns');
  const categories = ['creational', 'structural', 'behavioral', 'frontend'];
  const categoryNames = { creational: '创建型', structural: '结构型', behavioral: '行为型', frontend: '前端特有' };

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const created = [];

    for (const cat of categories) {
      const catDir = path.join(targetDir, cat);
      if (!fs.existsSync(catDir)) {
        fs.mkdirSync(catDir, { recursive: true });
      }

      const patterns = getPatternsByCategory(cat);
      for (const pattern of patterns) {
        const patternFile = path.join(catDir, pattern.id + '.md');
        if (!fs.existsSync(patternFile) || options.force) {
          const content = generatePatternDoc(pattern);
          fs.writeFileSync(patternFile, content, 'utf8');
          created.push(path.relative(targetDir, patternFile));
        }
      }

      const readmeFile = path.join(catDir, 'README.md');
      if (!fs.existsSync(readmeFile) || options.force) {
        const readme = generateCategoryReadme(cat, categoryNames[cat], patterns);
        fs.writeFileSync(readmeFile, readme, 'utf8');
        created.push(path.relative(targetDir, readmeFile));
      }
    }

    const rootReadme = path.join(targetDir, 'README.md');
    if (!fs.existsSync(rootReadme) || options.force) {
      const content = generateRootReadme();
      fs.writeFileSync(rootReadme, content, 'utf8');
      created.push('README.md');
    }

    return makeResult({
      directory: targetDir,
      created: created.length,
      files: created,
      categories: categories.length,
      totalPatterns: Object.keys(PATTERN_LIBRARY).length,
    }, false, null);
  } catch (e) {
    return makeError('初始化失败: ' + e.message, 'INIT_ERROR');
  }
}

function generatePatternDoc(pattern) {
  const examples = Object.entries(pattern.codeExamples || {});
  let examplesSection = '';
  for (const [framework, code] of examples) {
    const lang = framework === 'nodejs' ? 'javascript' : (framework === 'react' || framework === 'vue' ? 'tsx' : 'typescript');
    examplesSection += `### ${SUPPORTED_FRAMEWORK_NAMES[framework] || framework}\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  }

  return `# ${pattern.name}

## 概述

${pattern.description}

## 适用场景

${pattern.useCases.map(u => `- ${u}`).join('\n')}

## 优点

${pattern.pros.map(p => `- ${p}`).join('\n')}

## 缺点

${pattern.cons.map(c => `- ${c}`).join('\n')}

## 代码示例

${examplesSection}
`;
}

function generateCategoryReadme(category, categoryName, patterns) {
  return `# ${categoryName}模式

本目录包含 ${patterns.length} 种${categoryName}设计模式。

## 模式列表

| 模式 | 说明 |
|------|------|
${patterns.map(p => `| [${p.name}](./${p.id}.md) | ${p.description.slice(0, 50)}... |`).join('\n')}

## 使用说明

每个模式文件包含：
- 模式的详细说明
- 适用场景
- 优缺点分析
- 多框架代码示例（TypeScript、React、Vue 3、Node.js）
`;
}

function generateRootReadme() {
  const categories = [
    { key: 'creational', name: '创建型', desc: '处理对象创建机制' },
    { key: 'structural', name: '结构型', desc: '处理类和对象的组合' },
    { key: 'behavioral', name: '行为型', desc: '处理对象之间的通信' },
    { key: 'frontend', name: '前端特有', desc: '前端开发常用模式' },
  ];

  const total = Object.keys(PATTERN_LIBRARY).length;

  return `# 设计模式库

共包含 ${total} 种设计模式，支持 TypeScript、React、Vue 3、Node.js 四种框架。

## 分类

${categories.map(c => {
    const count = getPatternsByCategory(c.key).length;
    return `- [${c.name} (${count}种)](./${c.key}/) - ${c.desc}`;
  }).join('\n')}

## 支持框架

- TypeScript - 原生 TypeScript 实现
- React - React Function Component + Hooks
- Vue 3 - Vue 3 Composition API
- Node.js - Node.js / 纯 JavaScript

## 命令

\`\`\`bash
# 列出所有模式
code-patterns list

# 查看模式详情
code-patterns explain <pattern-id>

# 生成模式代码
code-patterns generate <pattern-id> --framework react

# 初始化模式目录
code-patterns init
\`\`\`
`;
}

/**
 * list - 列出所有模式
 * 按类别分组显示，支持搜索过滤
 */
async function list(options = {}) {
  let patterns = Object.values(PATTERN_LIBRARY);

  if (options.search) {
    patterns = searchPatterns(options.search);
  }

  if (options.category) {
    patterns = patterns.filter(p => p.category === options.category);
  }

  const grouped = {};
  for (const p of patterns) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push({
      id: p.id,
      name: p.name,
      description: p.description,
    });
  }

  return makeResult({
    total: patterns.length,
    categories: Object.keys(grouped).length,
    grouped: grouped,
    patterns: patterns.map(p => ({ id: p.id, name: p.name, category: p.category, description: p.description })),
  }, false, null);
}

/**
 * generate - 生成指定模式的代码
 * 根据模式名 + 框架 + 场景生成代码，输出到指定目录
 */
async function generate(options = {}) {
  const patternId = options.pattern || options.patternId;
  const rawFramework = options.framework || 'typescript';
  const framework = normalizeFramework(rawFramework);
  const { outputDir, scene } = options;

  if (!patternId) {
    return makeError('请指定模式名 (--pattern)', 'MISSING_PATTERN');
  }

  const pattern = getPatternById(patternId);
  if (!pattern) {
    return makeError('未找到模式: ' + patternId, 'PATTERN_NOT_FOUND');
  }

  if (!SUPPORTED_FRAMEWORKS.includes(framework)) {
    return makeError('不支持的框架: ' + framework + '，支持: ' + SUPPORTED_FRAMEWORKS.join(', '), 'UNSUPPORTED_FRAMEWORK');
  }

  let code = pattern.codeExamples[framework] || '';

  // 如果指定了场景且 LLM 可用，使用 LLM 定制代码
  let llmEnhanced = false;
  let llmProvider = null;

  if (scene && llm && llm.isAvailable()) {
    try {
      const prompt = `
请基于以下设计模式的代码模板，根据具体场景生成定制化的代码。

模式: ${pattern.name}
框架: ${framework}
场景描述: ${scene}

模板代码:
\`\`\`${framework === 'nodejs' ? 'javascript' : 'typescript'}
${code}
\`\`\`

请根据场景描述调整代码，使其更贴合实际使用场景。保持代码的完整性和可运行性。
只返回代码，不要返回其他解释文字。
`;
      const llmResult = await llm.callLLM({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });
      if (llmResult && llmResult.ok) {
        code = llmResult.content || code;
        llmEnhanced = true;
        llmProvider = llmResult.provider || null;
      }
    } catch (e) {
      // LLM 失败时回退到模板代码
      console.warn('LLM 生成失败，使用模板代码:', e.message);
    }
  }

  let outputPath = null;
  if (outputDir) {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const ext = framework === 'react' ? '.tsx' : (framework === 'vue' ? '.vue' : '.ts');
      outputPath = path.join(outputDir, patternId + ext);
      fs.writeFileSync(outputPath, code, 'utf8');
    } catch (e) {
      return makeError('写入文件失败: ' + e.message, 'WRITE_ERROR');
    }
  }

  return makeResult({
    pattern: pattern.id,
    patternName: pattern.name,
    framework: framework,
    code: code,
    outputPath: outputPath,
    scene: scene || null,
  }, llmEnhanced, llmProvider);
}

/**
 * apply - 应用模式到现有代码（LLM 驱动）
 * 读取源文件 + 指定模式，LLM 分析并重构代码应用模式
 */
async function apply(options = {}) {
  const { pattern: patternId, sourceFile, outputFile } = options;

  if (!patternId) {
    return makeError('请指定模式名 (--pattern)', 'MISSING_PATTERN');
  }

  if (!sourceFile) {
    return makeError('请指定源文件路径 (--source)', 'MISSING_SOURCE');
  }

  const pattern = getPatternById(patternId);
  if (!pattern) {
    return makeError('未找到模式: ' + patternId, 'PATTERN_NOT_FOUND');
  }

  if (!fs.existsSync(sourceFile)) {
    return makeError('源文件不存在: ' + sourceFile, 'FILE_NOT_FOUND');
  }

  const sourceCode = fs.readFileSync(sourceFile, 'utf8');

  // 检查 LLM 是否可用
  if (!llm || !llm.isAvailable()) {
    return makeError('LLM 不可用，apply 命令需要 LLM 支持', 'LLM_UNAVAILABLE');
  }

  try {
    const framework = detectFramework(sourceFile);
    const patternExample = pattern.codeExamples[framework] || pattern.codeExamples.typescript || '';

    const prompt = `
请将以下设计模式应用到给定的源代码中。

## 模式信息
模式名称: ${pattern.name}
模式描述: ${pattern.description}

## 模式示例代码（参考）
\`\`\`typescript
${patternExample}
\`\`\`

## 源代码
文件: ${path.basename(sourceFile)}
\`\`\`${framework === 'nodejs' ? 'javascript' : 'typescript'}
${sourceCode}
\`\`\`

## 要求
1. 分析源代码的结构和逻辑
2. 将 ${pattern.name} 模式合理地应用到代码中
3. 保持原有功能不变，只是重构代码结构以应用模式
4. 保持代码风格一致
5. 只返回重构后的完整代码，不要返回其他解释文字
`;

    const llmResult = await llm.callLLM({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    if (!llmResult || !llmResult.ok) {
      return makeError('LLM 生成失败: ' + (llmResult?.error || 'unknown'), 'LLM_ERROR');
    }

    let refactoredCode = llmResult.content || '';
    // 清理可能的代码块标记（保留正则方式，同时用 AST 验证代码有效性）
    refactoredCode = refactoredCode.replace(/^```[\w]*\n/, '').replace(/\n```$/, '');

    // AST 增强：分析重构前后的代码结构变化
    let astAnalysis = null;
    try {
      const originalStructure = analyzeCodeStructure(sourceCode, framework);
      const refactoredStructure = analyzeCodeStructure(refactoredCode, framework);
      const detectedPatterns = detectPatternsInCode(refactoredCode, framework);

      astAnalysis = {
        astAvailable: refactoredStructure.astAvailable,
        originalStructure: {
          functionCount: originalStructure.functions.length,
          importCount: originalStructure.imports.length,
          exportCount: originalStructure.exports.length,
        },
        refactoredStructure: {
          functionCount: refactoredStructure.functions.length,
          importCount: refactoredStructure.imports.length,
          exportCount: refactoredStructure.exports.length,
          functions: refactoredStructure.functions,
          unusedImports: refactoredStructure.unusedImports,
        },
        detectedPatterns,
        codeQuality: {
          consoleLogs: refactoredStructure.issues.consoleLogs.length,
          emptyCatches: refactoredStructure.issues.emptyCatches.length,
          hardcodedSecrets: refactoredStructure.issues.hardcodedSecrets.length,
        },
      };
    } catch (e) {
      // AST 分析失败不影响主流程
    }

    let outputPath = null;
    if (outputFile) {
      fs.writeFileSync(outputFile, refactoredCode, 'utf8');
      outputPath = outputFile;
    }

    return makeResult({
      pattern: pattern.id,
      patternName: pattern.name,
      sourceFile: sourceFile,
      outputFile: outputPath,
      originalCode: sourceCode,
      refactoredCode: refactoredCode,
      framework: framework,
      astAnalysis,
    }, true, llmResult.provider || null);
  } catch (e) {
    return makeError('应用模式失败: ' + e.message, 'APPLY_ERROR');
  }
}

function detectFramework(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (ext === '.tsx' || basename.includes('react')) return 'react';
  if (ext === '.vue' || basename.includes('vue')) return 'vue';
  if (ext === '.ts') return 'typescript';
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return 'nodejs';

  return 'typescript';
}

/**
 * explain - 解释模式
 * 返回模式的详细说明、适用场景、优缺点、正反例代码
 */
async function explain(options = {}) {
  const patternId = options.pattern || options.patternId;
  const { deep = false } = options;

  if (!patternId) {
    return makeError('请指定模式名 (--pattern)', 'MISSING_PATTERN');
  }

  const pattern = getPatternById(patternId);
  if (!pattern) {
    return makeError('未找到模式: ' + patternId, 'PATTERN_NOT_FOUND');
  }

  let llmEnhanced = false;
  let llmProvider = null;
  let deepExplanation = null;

  // 如果需要深入解释且 LLM 可用
  if (deep && llm && llm.isAvailable()) {
    try {
      const prompt = `
请深入解释以下设计模式，重点关注实际应用场景和注意事项。

模式: ${pattern.name}
描述: ${pattern.description}
适用场景: ${pattern.useCases.join('; ')}
优点: ${pattern.pros.join('; ')}
缺点: ${pattern.cons.join('; ')}

请提供：
1. 模式的实际应用场景分析（3-5个具体场景）
2. 使用该模式的注意事项和最佳实践
3. 容易踩的坑和反模式
4. 与其他相关模式的对比

请用中文回答，结构清晰。
`;
      const llmResult = await llm.callLLM({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });
      if (llmResult && llmResult.ok) {
        deepExplanation = llmResult.content;
        llmEnhanced = true;
        llmProvider = llmResult.provider || null;
      }
    } catch (e) {
      console.warn('LLM 深入解释失败:', e.message);
    }
  }

  return makeResult({
    id: pattern.id,
    name: pattern.name,
    category: pattern.category,
    categoryName: CATEGORY_NAMES[pattern.category] || pattern.category,
    description: pattern.description,
    useCases: pattern.useCases,
    pros: pattern.pros,
    cons: pattern.cons,
    codeExamples: pattern.codeExamples,
    supportedFrameworks: Object.keys(pattern.codeExamples || {}),
    deepExplanation: deepExplanation,
  }, llmEnhanced, llmProvider);
}

// ============================================================
// AST 增强：代码结构分析
// ============================================================

/**
 * 使用 AST 分析代码结构（函数、import、export、未使用 import 等）
 * 解析成功时使用 AST，失败时回退到正则基础分析
 * @param {string} code - 源代码
 * @param {string} framework - 框架类型
 * @returns {object} 代码结构分析结果
 */
function analyzeCodeStructure(code, framework) {
  const result = {
    astAvailable: false,
    functions: [],
    imports: [],
    exports: [],
    unusedImports: [],
    interfaceNames: [],
    endpoints: [],
    issues: {
      emptyCatches: [],
      evalUsage: [],
      consoleLogs: [],
      hardcodedSecrets: [],
      xssRisks: [],
      syncIO: [],
    },
    fallbackReason: null,
  };

  // 尝试 AST 解析
  const parsed = ast.parseJS(code);
  if (!parsed) {
    // AST 解析失败，回退到正则基础分析
    result.astAvailable = false;
    result.fallbackReason = 'AST parse failed, using regex fallback';
    result.functions = extractFunctionsRegex(code);
    result.imports = extractImportsRegex(code);
    result.exports = extractExportsRegex(code);
    return result;
  }

  result.astAvailable = true;

  try {
    // 提取函数
    result.functions = ast.extractFunctions(code) || [];
  } catch (e) {
    result.functions = extractFunctionsRegex(code);
  }

  try {
    // 提取 import
    result.imports = ast.extractImports(code) || [];
  } catch (e) {
    result.imports = extractImportsRegex(code);
  }

  try {
    // 提取 export
    result.exports = ast.extractExports(code) || [];
  } catch (e) {
    result.exports = extractExportsRegex(code);
  }

  try {
    // 检测未使用 import
    result.unusedImports = ast.detectUnusedImports(code) || [];
  } catch (e) {
    result.unusedImports = [];
  }

  try {
    // 提取 TS interface 名称
    result.interfaceNames = ast.extractInterfaceNames(code) || [];
  } catch (e) {
    result.interfaceNames = [];
  }

  try {
    // 提取 API endpoints
    result.endpoints = ast.extractEndpoints(code) || [];
  } catch (e) {
    result.endpoints = [];
  }

  try {
    // 代码质量检测
    result.issues.emptyCatches = ast.detectEmptyCatches(code) || [];
    result.issues.evalUsage = ast.detectEvalUsage(code) || [];
    result.issues.consoleLogs = ast.detectConsoleLogs(code) || [];
    result.issues.hardcodedSecrets = ast.detectHardcodedSecrets(code) || [];
    result.issues.xssRisks = ast.detectXSSRisks(code) || [];
    result.issues.syncIO = ast.detectSyncIO(code) || [];
  } catch (e) {
    // 忽略检测错误
  }

  return result;
}

/**
 * 正则 fallback：提取函数定义（基础版）
 */
function extractFunctionsRegex(code) {
  const fns = [];
  // 匹配 function name() {}
  const funcRegex = /function\s+(\w+)\s*\(/g;
  let match;
  while ((match = funcRegex.exec(code)) !== null) {
    fns.push({
      name: match[1],
      line: code.slice(0, match.index).split('\n').length,
      async: false,
      params: [],
    });
  }
  // 匹配 const name = () => {}
  const arrowRegex = /const\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
  while ((match = arrowRegex.exec(code)) !== null) {
    fns.push({
      name: match[1],
      line: code.slice(0, match.index).split('\n').length,
      async: false,
      params: [],
    });
  }
  return fns;
}

/**
 * 正则 fallback：提取 import 语句（基础版）
 */
function extractImportsRegex(code) {
  const imports = [];
  const regex = /import\s+(?:(.+?)\s+from\s+)?['"](.+?)['"]/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    imports.push({
      source: match[2],
      specifiers: match[1] ? match[1].replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean) : [],
      default: null,
      line: code.slice(0, match.index).split('\n').length,
    });
  }
  return imports;
}

/**
 * 正则 fallback：提取 export 语句（基础版）
 */
function extractExportsRegex(code) {
  const exports = [];
  // export function/class/const name
  const namedRegex = /export\s+(?:function|class|const|let|var)\s+(\w+)/g;
  let match;
  while ((match = namedRegex.exec(code)) !== null) {
    exports.push({
      type: 'named',
      name: match[1],
      line: code.slice(0, match.index).split('\n').length,
    });
  }
  // export default
  if (/export\s+default/.test(code)) {
    exports.push({ type: 'default', name: 'default', line: -1 });
  }
  return exports;
}

/**
 * 安全添加 import：优先使用 AST，失败回退到正则字符串拼接
 * @param {string} code - 源代码
 * @param {string} importPath - import 路径
 * @param {string[]} namedImports - 命名 import 列表
 * @param {string|null} defaultImport - 默认 import
 * @returns {string} 修改后的代码
 */
function safeAddImport(code, importPath, namedImports, defaultImport) {
  // 先尝试 AST 方式
  try {
    const parsed = ast.parseJS(code);
    if (parsed) {
      // 先检查是否已存在该 import
      const existingImports = ast.extractImports(code) || [];
      const exists = existingImports.some(imp => imp.source === importPath);
      if (exists) {
        return code; // 已存在，不重复添加
      }
      // 使用 ast.addImport 添加（注意：当前仅支持 named imports）
      if (namedImports && namedImports.length > 0) {
        const result = ast.addImport(code, importPath, namedImports, defaultImport);
        if (result) {
          return result;
        }
      }
    }
  } catch (e) {
    // AST 失败，回退到正则
  }

  // 正则 fallback：检查是否已存在该 import
  const importRegex = new RegExp(`from\\s+['"]${importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  if (importRegex.test(code)) {
    return code; // 已存在，不重复添加
  }

  // 字符串拼接方式添加 import
  const namedPart = namedImports && namedImports.length > 0
    ? `{ ${namedImports.join(', ')} }`
    : '';
  const defaultPart = defaultImport || '';
  const parts = [defaultPart, namedPart].filter(Boolean).join(', ');
  const importStmt = `import ${parts} from '${importPath}';\n`;

  return importStmt + code;
}

/**
 * 基于 AST 检测代码中的设计模式
 * 通过函数结构、类继承、组合关系等特征来识别模式
 * @param {string} code - 源代码
 * @param {string} framework - 框架类型
 * @returns {Array<{patternId: string, patternName: string, confidence: number, evidence: string[]}>}
 */
function detectPatternsInCode(code, framework) {
  const detected = [];
  const structure = analyzeCodeStructure(code, framework);

  // 如果 AST 不可用，返回空
  if (!structure.astAvailable) {
    return detected;
  }

  const fnNames = structure.functions.map(f => f.name.toLowerCase());
  const classNames = structure.interfaceNames;
  const hasClass = /class\s+\w+/.test(code);
  const hasExtends = /extends\s+\w+/.test(code);
  const hasImplements = /implements\s+\w+/.test(code);

  // 检测 Singleton - 有 static instance/getInstance 等特征
  if (/getInstance|instance\s*=|static\s+instance/.test(code) && hasClass) {
    detected.push({
      patternId: 'singleton',
      patternName: 'Singleton (单例)',
      confidence: 0.7,
      evidence: ['检测到 getInstance 或 static instance 模式'],
    });
  }

  // 检测 Factory - 有 create/make/build 等工厂方法命名
  const factoryKeywords = ['create', 'factory', 'build', 'make', 'produce'];
  const factoryMatches = fnNames.filter(n => factoryKeywords.some(kw => n.includes(kw)));
  if (factoryMatches.length >= 1 && hasClass) {
    detected.push({
      patternId: 'factory',
      patternName: 'Factory Method (工厂方法)',
      confidence: 0.6,
      evidence: [`检测到工厂方法命名: ${factoryMatches.slice(0, 3).join(', ')}`],
    });
  }

  // 检测 Observer - 有 subscribe/notify/emit/on 等特征
  const observerKeywords = ['subscribe', 'observe', 'notify', 'emit', 'on', 'off', 'addListener'];
  const observerMatches = fnNames.filter(n => observerKeywords.some(kw => n.includes(kw)));
  if (observerMatches.length >= 2) {
    detected.push({
      patternId: 'observer',
      patternName: 'Observer (观察者)',
      confidence: 0.65,
      evidence: [`检测到观察者模式方法: ${observerMatches.slice(0, 3).join(', ')}`],
    });
  }

  // 检测 Strategy - 有 strategy/strategy 类或多个可替换算法
  if (/strategy/i.test(code) && hasClass) {
    detected.push({
      patternId: 'strategy',
      patternName: 'Strategy (策略)',
      confidence: 0.6,
      evidence: ['检测到 Strategy 相关命名'],
    });
  }

  // 检测 Decorator/HOC - React 中有 withXxx 命名的高阶组件
  const decoratorKeywords = fnNames.filter(n => /^with/.test(n));
  if (decoratorKeywords.length >= 1 && framework === 'react') {
    detected.push({
      patternId: 'decorator',
      patternName: 'Decorator (装饰器) / HOC',
      confidence: 0.7,
      evidence: [`检测到 HOC 命名模式: ${decoratorKeywords.slice(0, 3).join(', ')}`],
    });
  }

  // 检测 Custom Hook - React 中有 useXxx 命名
  const hookKeywords = fnNames.filter(n => /^use/.test(n));
  if (hookKeywords.length >= 2 && framework === 'react') {
    detected.push({
      patternId: 'customHook',
      patternName: 'Custom Hook (自定义 Hook)',
      confidence: 0.75,
      evidence: [`检测到自定义 Hook: ${hookKeywords.slice(0, 3).join(', ')}`],
    });
  }

  // 检测 Provider - 有 Provider/Context 等特征
  if (/Provider|Context|provide|inject/i.test(code) && (framework === 'react' || framework === 'vue')) {
    detected.push({
      patternId: 'provider',
      patternName: 'Provider (提供者模式)',
      confidence: 0.6,
      evidence: ['检测到 Provider/Context 相关命名'],
    });
  }

  return detected.sort((a, b) => b.confidence - a.confidence);
}

// ============================================================
// 命令实现：analyze - AST 代码分析
// ============================================================

/**
 * analyze - 使用 AST 分析代码结构
 * 读取源文件，分析函数、import、export、代码质量问题等
 */
async function analyzeCode(options = {}) {
  const { sourceFile, code: inputCode, detectPatterns: detectPatternsFlag = true } = options;

  let sourceCode = inputCode;
  let fileName = null;

  if (sourceFile) {
    if (!fs.existsSync(sourceFile)) {
      return makeError('源文件不存在: ' + sourceFile, 'FILE_NOT_FOUND');
    }
    sourceCode = fs.readFileSync(sourceFile, 'utf8');
    fileName = path.basename(sourceFile);
  }

  if (!sourceCode) {
    return makeError('没有提供代码或源文件', 'MISSING_CODE');
  }

  const framework = sourceFile ? detectFramework(sourceFile) : 'typescript';
  const structure = analyzeCodeStructure(sourceCode, framework);

  // 模式检测
  let detectedPatterns = [];
  if (detectPatternsFlag) {
    detectedPatterns = detectPatternsInCode(sourceCode, framework);
  }

  return makeResult({
    fileName,
    framework,
    astAvailable: structure.astAvailable,
    fallbackReason: structure.fallbackReason,
    structure: {
      functionCount: structure.functions.length,
      functions: structure.functions,
      importCount: structure.imports.length,
      imports: structure.imports,
      exportCount: structure.exports.length,
      exports: structure.exports,
      unusedImports: structure.unusedImports,
      interfaceNames: structure.interfaceNames,
      endpoints: structure.endpoints,
    },
    codeQuality: {
      emptyCatches: structure.issues.emptyCatches,
      evalUsage: structure.issues.evalUsage,
      consoleLogs: structure.issues.consoleLogs,
      hardcodedSecrets: structure.issues.hardcodedSecrets,
      xssRisks: structure.issues.xssRisks,
      syncIO: structure.issues.syncIO,
      totalIssues: structure.issues.emptyCatches.length
        + structure.issues.evalUsage.length
        + structure.issues.consoleLogs.length
        + structure.issues.hardcodedSecrets.length
        + structure.issues.xssRisks.length
        + structure.issues.syncIO.length,
    },
    detectedPatterns,
  }, structure.astAvailable, null);
}

// ============================================================
// Module Exports
// ============================================================

// ============================================================
// Module Exports (CommonJS)
// ============================================================

module.exports = {
  // 常量
  PATTERN_LIBRARY,
  SUPPORTED_FRAMEWORKS,
  SUPPORTED_FRAMEWORK_NAMES,
  CATEGORY_NAMES,
  DEFAULT_PATTERNS,

  // 核心命令
  init,
  list,
  generate,
  apply,
  explain,
  analyze: analyzeCode,

  // 命令别名
  patternList: list,
  patternGenerate: generate,
  patternApply: apply,
  patternExplain: explain,
  patternInit: init,
  patternAnalyze: analyzeCode,

  // 设计规范命令别名（init/show/inject/update/validate）
  show: list,
  inject: generate,
  update: apply,
  validate: explain,

  // AST 增强函数
  analyzeCodeStructure,
  safeAddImport,
  detectPatternsInCode,

  // 辅助函数
  getPatternById,
  getPatternsByCategory,
  searchPatterns,
  makeResult,
  makeError,
  detectFramework,
};
