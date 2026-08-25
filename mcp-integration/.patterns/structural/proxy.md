# Proxy (代理)

## 概述

为其他对象提供一种代理以控制对这个对象的访问。

## 适用场景

- 远程代理：为一个对象在不同的地址空间提供局部代表
- 虚拟代理：根据需要创建开销很大的对象
- 保护代理：控制对原始对象的访问，用于对象有不同的访问权限时
- 智能指引：取代了简单的指针，它在访问对象时执行一些附加操作

## 优点

- 可以在客户端毫无察觉的情况下控制服务对象
- 如果客户端对服务对象的生命周期没有特殊要求，可以对生命周期进行管理
- 即使服务对象还未准备好或不存在，代理也可以正常工作
- 开闭原则：可以在不对服务或客户端做出修改的情况下创建新代理

## 缺点

- 代码可能会变得复杂，因为需要新建许多类
- 服务响应可能会延迟

## 代码示例

### TypeScript

```typescript
interface Image { display(): void; }

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
img2.display();
```

### React

```tsx
import React, { useState, useEffect, useRef } from 'react';

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

export default ProxyDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
interface ExpensiveService { process(data: string): string; }

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

console.log('\n=== 保护代理 ===');
const prot = new ProtectedProxy(lazy, 'valid-key-123');
try {
  const r3 = prot.process('data3');
  console.log('结果:', r3);
} catch (e: any) {
  console.log('错误:', e.message);
}
```


