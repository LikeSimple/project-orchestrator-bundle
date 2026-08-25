# Custom Hook (自定义 Hook)

## 概述

自定义 Hook 是一个函数，其名称以 "use" 开头，函数内部可以调用其他的 Hook。它让你能够在不编写类的情况下复用状态逻辑。

## 适用场景

- 需要在多个组件间复用状态逻辑
- 复杂组件中的逻辑需要拆分以提高可读性
- 需要将副作用逻辑封装起来
- 需要共享数据获取、订阅、DOM 操作等逻辑

## 优点

- 逻辑复用：可以在多个组件间共享状态逻辑
- 更直观：相比 HOC，Hook 的数据流更清晰
- 避免嵌套地狱：不会产生多层组件包装
- 类型友好：TypeScript 类型推导更自然
- 易于测试：可以单独测试自定义 Hook

## 缺点

- 需要遵循 Hook 规则（只能在函数组件顶层调用）
- 过度抽象可能导致代码难以理解
- 自定义 Hook 之间共享状态需要额外处理

## 代码示例

### TypeScript

```typescript
// 自定义 Hook 的 TypeScript 类型示例
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
}
```

### React

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';

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

export default HookDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
// Node.js 中类似 Hook 模式的函数式封装
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
      console.log(`重试 ${i + 1}/${maxRetries}: ${e.message}`);
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

  console.log('\n=== useMemo 示例 ===');
  const expensive = useMemo(() => {
    console.log('计算中...');
    let sum = 0;
    for (let i = 0; i < 1000000; i++) sum += i;
    return sum;
  });
  console.log('第一次调用:', expensive());
  console.log('第二次调用（缓存）:', expensive());
}

main();
```


