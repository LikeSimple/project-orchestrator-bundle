# Render Props (渲染属性)

## 概述

Render Props 是指一种在 React 组件之间使用一个值为函数的 prop 共享代码的简单技术。组件接收一个返回 React 元素的函数，并在渲染时调用这个函数。

## 适用场景

- 需要在多个组件间共享状态或行为，但不希望使用 HOC
- 需要动态决定渲染内容
- 需要将组件的内部状态暴露给使用者
- 需要更灵活的组件复用方式

## 优点

- 灵活性高：可以精确控制渲染内容
- 命名空间清晰：不会像 HOC 那样产生 props 命名冲突
- 数据来源明确：容易追踪数据来源
- 组合性强：可以与其他模式结合使用

## 缺点

- 嵌套层级可能较深（类似回调地狱）
- 性能问题：每次渲染都会创建新的函数
- 对于简单场景可能过于复杂
- 代码可读性可能不如 Hook 直观

## 代码示例

### TypeScript

```typescript
// Render Props 的 TypeScript 类型定义
interface RenderPropsChildren<T> {
  children: (data: T) => React.ReactNode;
}

interface MousePosition { x: number; y: number; }

interface MouseTrackerProps {
  children: (position: MousePosition) => React.ReactNode;
}
```

### React

```tsx
import React, { useState, useEffect, useCallback } from 'react';

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

export default RenderPropsDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
// Node.js 中类似 render props 的回调模式
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
      (attempt, error) => console.log(`第 ${attempt} 次重试: ${error.message}`)
    );
    console.log('最终结果:', result);
  } catch (e: any) {
    console.log('失败:', e.message);
  }
}

main();
```


