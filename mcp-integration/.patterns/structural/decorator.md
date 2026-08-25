# Decorator (装饰器)

## 概述

动态地给一个对象添加一些额外的职责。就增加功能来说，装饰器模式相比生成子类更为灵活。

## 适用场景

- 在不影响其他对象的情况下，以动态、透明的方式给单个对象添加职责
- 处理那些可以撤消的职责
- 当不能采用生成子类的方法进行扩充时

## 优点

- 无需创建新子类即可扩展对象的行为
- 可以在运行时添加或删除对象的功能
- 可以用多个装饰器组合多种行为
- 单一职责原则：可以将实现了许多不同行为的一个大类拆分为多个较小的类

## 缺点

- 在装饰器栈中删除特定装饰器比较困难
- 实现行为不受装饰器栈顺序影响的装饰器比较困难
- 代码的总体复杂度可能会增加

## 代码示例

### TypeScript

```typescript
interface Coffee { cost(): number; description(): string; }

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
console.log(coffee.description(), '-', coffee.cost());
```

### React

```tsx
import React, { useState } from 'react';

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

export default DecoratorDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
interface DataService { fetchData(id: string): Promise<any>; }

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
    console.log(`[LOG] Fetch start: ${id}`);
    const start = Date.now();
    const result = await super.fetchData(id);
    console.log(`[LOG] Fetch done: ${id}, time: ${Date.now() - start}ms`);
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

main();
```


