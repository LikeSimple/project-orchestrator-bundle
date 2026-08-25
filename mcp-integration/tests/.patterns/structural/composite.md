# Composite (组合)

## 概述

将对象组合成树形结构以表示"部分-整体"的层次结构。组合模式使得用户对单个对象和组合对象的使用具有一致性。

## 适用场景

- 你想表示对象的部分-整体层次结构
- 你希望用户忽略组合对象与单个对象的不同，用户将统一地使用组合结构中的所有对象
- 文件系统、菜单、UI 组件树等场景

## 优点

- 可以利用多态和递归机制更方便地使用复杂树结构
- 开闭原则：无需更改现有代码，就可以在应用中添加新元素
- 简化客户端代码，客户端无需关心处理的是单个对象还是组合对象

## 缺点

- 对于功能差异较大的类，提供公共接口可能会很困难
- 在某些情况下，组件的接口可能会过于一般化

## 代码示例

### TypeScript

```typescript
interface FileSystemNode {
  getName(): string;
  getSize(): number;
  print(indent?: string): void;
}

class FileNode implements FileSystemNode {
  constructor(private name: string, private size: number) {}
  getName(): string { return this.name; }
  getSize(): number { return this.size; }
  print(indent = ''): void { console.log(`${indent}- [File] ${this.name} (${this.size}KB)`); }
}

class DirectoryNode implements FileSystemNode {
  private children: FileSystemNode[] = [];
  constructor(private name: string) {}
  add(child: FileSystemNode): void { this.children.push(child); }
  remove(child: FileSystemNode): void {
    const i = this.children.indexOf(child);
    if (i > -1) this.children.splice(i, 1);
  }
  getName(): string { return this.name; }
  getSize(): number { return this.children.reduce((t, c) => t + c.getSize(), 0); }
  print(indent = ''): void {
    console.log(`${indent}+ [Dir] ${this.name} (${this.getSize()}KB)`);
    this.children.forEach(c => c.print(indent + '  '));
  }
}

const root = new DirectoryNode('root');
const docs = new DirectoryNode('documents');
docs.add(new FileNode('report.pdf', 2048));
docs.add(new FileNode('notes.txt', 50));
const images = new DirectoryNode('images');
images.add(new FileNode('photo1.jpg', 5120));
images.add(new FileNode('photo2.jpg', 4096));
root.add(docs);
root.add(images);
root.add(new FileNode('readme.md', 100));
root.print();
console.log('Total size:', root.getSize(), 'KB');
```

### React

```tsx
import React, { useState } from 'react';

const LeafNode: React.FC<any> = ({ label, icon = '📄' }) => (
  <div style={{ paddingLeft: '20px', lineHeight: '24px' }}>{icon} {label}</div>
);

const CompositeNode: React.FC<any> = ({ label, icon = '📁', defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div>
      <div onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer', lineHeight: '24px' }}>
        <span style={{ marginRight: 4 }}>{isOpen ? '▼' : '▶'}</span>{icon} {label}
      </div>
      {isOpen && <div style={{ paddingLeft: '20px' }}>{children}</div>}
    </div>
  );
};

const CompositeDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif', fontSize: '14px' }}>
    <h3>组合模式 - 文件树</h3>
    <CompositeNode label="root" defaultOpen>
      <CompositeNode label="documents">
        <LeafNode label="report.pdf" icon="📕" />
        <LeafNode label="notes.txt" icon="📝" />
      </CompositeNode>
      <CompositeNode label="images">
        <LeafNode label="photo1.jpg" icon="🖼️" />
        <LeafNode label="photo2.jpg" icon="🖼️" />
      </CompositeNode>
      <LeafNode label="readme.md" icon="📋" />
    </CompositeNode>
  </div>
);

export default CompositeDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; font-size: 14px;">
    <h3>组合模式 - 文件树</h3>
    <CompositeNode label="root" :default-open="true">
      <CompositeNode label="documents">
        <LeafNode label="report.pdf" icon="📕" />
        <LeafNode label="notes.txt" icon="📝" />
      </CompositeNode>
      <CompositeNode label="images">
        <LeafNode label="photo1.jpg" icon="🖼️" />
      </CompositeNode>
      <LeafNode label="readme.md" icon="📋" />
    </CompositeNode>
  </div>
</template>

<script setup lang="ts">
import { ref, defineComponent, h } from 'vue';

const LeafNode = defineComponent({
  name: 'LeafNode',
  props: { label: String, icon: { type: String, default: '📄' } },
  setup(props) {
    return () => h('div', { style: { paddingLeft: '20px', lineHeight: '24px' } }, props.icon + ' ' + props.label);
  },
});

const CompositeNode = defineComponent({
  name: 'CompositeNode',
  props: { label: String, icon: { type: String, default: '📁' }, defaultOpen: { type: Boolean, default: true } },
  setup(props, { slots }) {
    const isOpen = ref(props.defaultOpen);
    const toggle = () => { isOpen.value = !isOpen.value; };
    return () => h('div', [
      h('div', { onClick: toggle, style: { cursor: 'pointer', lineHeight: '24px' } },
        (isOpen.value ? '▼ ' : '▶ ') + props.icon + ' ' + props.label
      ),
      isOpen.value ? h('div', { style: { paddingLeft: '20px' } }, slots.default?.()) : null,
    ]);
  },
});
</script>
```

### Node.js

```javascript
interface MenuComponent {
  getName(): string;
  getPrice(): number;
  print(indent?: string): void;
}

class MenuItem implements MenuComponent {
  constructor(private name: string, private price: number, private veg: boolean = false) {}
  getName(): string { return this.name; }
  getPrice(): number { return this.price; }
  print(indent = ''): void {
    const tag = this.veg ? ' [V]' : '';
    console.log(`${indent}- ${this.name} - ¥${this.price}${tag}`);
  }
}

class Menu implements MenuComponent {
  private items: MenuComponent[] = [];
  constructor(private name: string, private desc: string) {}
  add(item: MenuComponent): void { this.items.push(item); }
  remove(item: MenuComponent): void {
    const i = this.items.indexOf(item);
    if (i > -1) this.items.splice(i, 1);
  }
  getName(): string { return this.name; }
  getPrice(): number { return this.items.reduce((s, i) => s + i.getPrice(), 0); }
  print(indent = ''): void {
    console.log(`${indent}===== ${this.name} =====`);
    console.log(`${indent}  ${this.desc}`);
    this.items.forEach(i => i.print(indent + '  '));
  }
}

const all = new Menu('全部菜单', '餐厅所有菜品');
const breakfast = new Menu('早餐', '晨间美味');
breakfast.add(new MenuItem('煎饼果子', 8, false));
breakfast.add(new MenuItem('豆浆', 3, true));
const lunch = new Menu('午餐', '午间套餐');
lunch.add(new MenuItem('红烧肉', 38, false));
lunch.add(new MenuItem('清炒时蔬', 18, true));
lunch.add(new MenuItem('米饭', 2, true));
all.add(breakfast);
all.add(lunch);
all.print();
console.log('\n总价:', all.getPrice(), '元');
```


