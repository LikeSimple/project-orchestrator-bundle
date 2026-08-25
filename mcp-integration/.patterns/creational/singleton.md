# Singleton (单例)

## 概述

保证一个类仅有一个实例，并提供一个访问它的全局访问点。

## 适用场景

- 当类只能有一个实例而且客户可以从一个众所周知的访问点访问它时
- 当这个唯一实例应该是通过子类化可扩展的，并且客户应该无需更改代码就能使用一个扩展的实例时
- 配置管理、日志记录、连接池等场景

## 优点

- 保证一个类只有一个实例
- 获得了一个指向该实例的全局访问节点
- 仅在首次请求单例对象时对其进行初始化

## 缺点

- 违反了单一职责原则（同时解决了两个问题）
- 多线程环境下需要特殊处理
- 单元测试困难，难以 mock

## 代码示例

### TypeScript

```typescript
class AppConfig {
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
console.log('Env from c1:', c1.get('env')); // production
```

### React

```tsx
import React, { createContext, useContext, useState, useCallback } from 'react';

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

export default UserProfile;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
class DatabaseConnection {
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
db1.releaseConnection(conn);
```


