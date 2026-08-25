# Abstract Factory (抽象工厂)

## 概述

提供一个创建一系列相关或相互依赖对象的接口，而无需指定它们具体的类。

## 适用场景

- 系统需要独立于它的产品创建、组合和表示的时候
- 系统需要配置多个产品系列中的一个的时候
- 当你要强调一系列相关的产品对象的设计以便进行联合使用的时候

## 优点

- 可以确保同一工厂生成的产品相互匹配
- 可以避免客户端和具体产品代码的耦合
- 单一职责原则：可以将产品生成代码抽取到同一位置
- 开闭原则：向应用程序中引入新产品变体时无需修改客户端代码

## 缺点

- 由于采用该模式需要向应用中引入众多接口和类，代码可能会更加复杂
- 产品族扩展困难，增加新产品需要修改抽象工厂接口

## 代码示例

### TypeScript

```typescript
// 抽象产品
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
app.paint();
```

### React

```tsx
import React, { createContext, useContext, useState } from 'react';

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

export default AbstractFactoryDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
// 抽象产品
interface Logger { log(msg: string): void; error(msg: string): void; }
interface Database { query(sql: string): any[]; connect(): void; }

// 开发环境产品
class ConsoleLogger implements Logger {
  log(msg: string): void { console.log(`[LOG] ${msg}`); }
  error(msg: string): void { console.error(`[ERROR] ${msg}`); }
}

class MemoryDB implements Database {
  connect(): void { console.log('Connected to in-memory DB'); }
  query(sql: string): any[] { console.log('Query:', sql); return [{ id: 1 }]; }
}

// 生产环境产品
class FileLogger implements Logger {
  private fs = require('fs');
  log(msg: string): void { this.fs.appendFileSync('app.log', `[LOG] ${msg}\n`); console.log(`[LOG] ${msg}`); }
  error(msg: string): void { this.fs.appendFileSync('app.log', `[ERROR] ${msg}\n`); console.error(`[ERROR] ${msg}`); }
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
logger.log('App finished');
```


