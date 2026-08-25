# Provider Pattern (提供者模式)

## 概述

Provider 模式通过 Context API 将状态和方法传递给需要它们的子组件，避免了 props 逐层传递的问题。它是 React 生态中最核心的模式之一。

## 适用场景

- 需要在多层嵌套的组件间共享全局状态（如主题、用户信息、语言）
- 需要避免 props drilling（属性逐层传递）
- 需要提供应用级别的配置或服务
- 需要实现依赖注入

## 优点

- 避免 props drilling：数据可以直接被需要的组件访问
- 全局状态管理：方便管理应用级别的状态
- 声明式：使用 Provider 包裹组件树，声明清晰
- 易于测试：可以通过不同的 Provider 提供不同的状态

## 缺点

- 过度使用可能导致组件复用困难
- Context 变化会导致所有消费者重新渲染
- 调试困难：数据来源不直观
- 可能导致组件与 Context 耦合

## 代码示例

### TypeScript

```typescript
// Provider 模式的 TypeScript 类型定义
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
}
```

### React

```tsx
import React, { useState, useMemo, createContext, useContext } from 'react';

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

export default ProviderDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
// Node.js 中的依赖注入（类似 Provider 模式）
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
logger.log('应用启动完成');
```


