# Bridge (桥接)

## 概述

将抽象部分与它的实现部分分离，使它们都可以独立地变化。

## 适用场景

- 你不希望在抽象和它的实现部分之间有一个固定的绑定关系
- 类的抽象以及它的实现都应该可以通过生成子类的方法加以扩充
- 对一个抽象的实现部分的修改应对客户不产生影响
- 你想对客户完全隐藏抽象的实现部分

## 优点

- 可以创建与平台无关的类和程序
- 客户端代码仅与高层抽象部分进行互动，不会接触到平台的详细信息
- 开闭原则：可以新增抽象部分和实现部分，且它们之间不会相互影响
- 单一职责原则：抽象部分专注于高层逻辑，实现部分处理平台细节

## 缺点

- 对高内聚的类使用该模式可能会让代码更加复杂
- 需要正确识别系统中两个独立变化的维度

## 代码示例

### TypeScript

```typescript
// 实现层接口
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
radioRemote.volumeUp();
```

### React

```tsx
import React, { useState } from 'react';

// 实现层：主题
interface Theme { bgColor: string; textColor: string; accentColor: string; borderColor: string; }

const lightTheme: Theme = { bgColor: '#ffffff', textColor: '#333', accentColor: '#1890ff', borderColor: '#d9d9d9' };
const darkTheme: Theme = { bgColor: '#1f1f1f', textColor: '#fff', accentColor: '#40a9ff', borderColor: '#434343' };

// 抽象层组件
const ThemedButton: React.FC<any> = ({ theme, label, onClick }) => (
  <button onClick={onClick} style={{ padding: '8px 16px', backgroundColor: theme.accentColor, color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{label}</button>
);

const ThemedCard: React.FC<any> = ({ theme, title, children }) => (
  <div style={{ padding: '16px', backgroundColor: theme.bgColor, color: theme.textColor, border: `1px solid ${theme.borderColor}`, borderRadius: '8px' }}>
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

export default BridgeDemo;
```

### Vue 3

```tsx
<template>
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
</script>
```

### Node.js

```javascript
// 实现层
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
console.log('清缓存后:', repo.getUser('1')?.name);
```


