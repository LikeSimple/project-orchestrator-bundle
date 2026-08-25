# HOC (高阶组件)

## 概述

高阶组件是参数为组件，返回值为新组件的函数。HOC 是 React 生态系统中常见的模式，用于复用组件逻辑。

## 适用场景

- 需要在多个组件间共享通用逻辑（如鉴权、日志、数据获取）
- 需要增强现有组件的功能而不修改其源码
- 需要横切关注点的分离（如错误边界、加载状态）
- 需要对组件进行包装以添加额外的 props 或行为

## 优点

- 逻辑复用：可以在多个组件间共享相同的逻辑
- 组合性：可以将多个 HOC 组合使用
- 关注点分离：将横切逻辑从业务组件中抽离
- 不修改原组件，符合开闭原则

## 缺点

- 命名冲突：多个 HOC 可能传递同名的 props
- 调试困难：组件被多层包装后，难以追踪来源
- Ref 传递问题：需要使用 forwardRef 来传递 ref
- 可能导致 Wrapper Hell（多层嵌套）

## 代码示例

### TypeScript

```typescript
// HOC 在 TypeScript 中的类型定义
type HOC<P = {}, EP = {}> = (Component: React.ComponentType<P>) => React.ComponentType<Omit<P, keyof EP> & Partial<EP>>;

// 示例：withLoading HOC
interface WithLoadingProps { loading?: boolean; }

function withLoading<P extends object>(WrappedComponent: React.ComponentType<P>) {
  return ({ loading, ...props }: WithLoadingProps & Omit<P, keyof WithLoadingProps>) => {
    if (loading) return <div>加载中...</div>;
    return <WrappedComponent {...(props as P)} />;
  };
}
```

### React

```tsx
import React, { useState, useEffect } from 'react';

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
  WithUser.displayName = `WithUser(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;
  return WithUser;
}

// HOC: 添加日志
function withLogger<P extends object>(WrappedComponent: React.ComponentType<P>) {
  const WithLogger = (props: P) => {
    useEffect(() => { console.log('组件挂载'); return () => console.log('组件卸载'); }, []);
    useEffect(() => { console.log('Props 变化:', props); }, [props]);
    return <WrappedComponent {...props} />;
  };
  WithLogger.displayName = `WithLogger(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;
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

export default HocDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
// Node.js 中类似 HOC 的函数装饰器模式
function withLogging(fn: Function) {
  return function(...args: any[]) {
    console.log(`[LOG] 调用 ${fn.name}, 参数:`, args);
    const start = Date.now();
    const result = fn(...args);
    console.log(`[LOG] ${fn.name} 执行耗时: ${Date.now() - start}ms`);
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

console.log('\n=== withCache + withLogging 组合 ===');
console.log('第一次调用:');
console.log('fib(30) =', cachedFib(30));
console.log('第二次调用（缓存）:');
console.log('fib(30) =', cachedFib(30));
```


