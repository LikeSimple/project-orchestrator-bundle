# Prototype (原型)

## 概述

用原型实例指定创建对象的种类，并且通过拷贝这些原型创建新的对象。

## 适用场景

- 当要实例化的类是在运行时刻指定时，例如通过动态装载
- 为了避免创建一个与产品类层次平行的工厂类层次时
- 当一个类的实例只能有几个不同状态组合中的一种时，建立相应数目的原型并克隆它们可能更方便

## 优点

- 可以克隆对象，而无需与它们所属的具体类相耦合
- 可以克隆预生成原型，避免反复运行初始化代码
- 可以更方便地生成复杂对象
- 可以用继承以外的方式来处理复杂对象的不同配置

## 缺点

- 克隆包含循环引用的复杂对象可能会非常麻烦
- 需要为每个类实现克隆方法，深浅拷贝需要注意

## 代码示例

### TypeScript

```typescript
interface Prototype { clone(): Prototype; }

class Shape implements Prototype {
  x: number; y: number; color: string;
  constructor(x: number, y: number, color: string) { this.x = x; this.y = y; this.color = color; }
  clone(): Shape { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
  getInfo(): string { return `Shape at (${this.x}, ${this.y}), color: ${this.color}`; }
}

class Circle extends Shape {
  radius: number;
  constructor(x: number, y: number, color: string, radius: number) { super(x, y, color); this.radius = radius; }
  clone(): Circle { const c = super.clone() as Circle; c.radius = this.radius; return c; }
  getInfo(): string { return `Circle at (${this.x}, ${this.y}), r=${this.radius}, color: ${this.color}`; }
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
console.log('Same object?', c1 === c2); // false
```

### React

```tsx
import React, { useState } from 'react';

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

export default PrototypeDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
class UserConfig {
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
  getInfo(): string { return `User: ${this.username}, Theme: ${this.theme}, Plugins: ${this.plugins.length}`; }
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

console.log('Same object?', user1 === user2); // false
```


