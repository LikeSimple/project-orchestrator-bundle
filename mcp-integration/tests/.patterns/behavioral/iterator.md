# Iterator (迭代器)

## 概述

提供一种方法顺序访问一个聚合对象中各个元素，而又不需暴露该对象的内部表示。

## 适用场景

- 访问一个聚合对象的内容而无需暴露它的内部表示
- 支持对聚合对象的多种遍历
- 为遍历不同的聚合结构提供一个统一的接口
- 需要在遍历过程中对集合进行操作而不暴露底层结构

## 优点

- 单一职责原则：可以将笨重的遍历算法抽取到独立的类中
- 开闭原则：可以实现新的集合和迭代器并将其传递给现有代码，无需修改代码
- 可以并行遍历同一集合，因为每个迭代器对象都包含其自身的遍历状态
- 可以暂停遍历并在需要时继续

## 缺点

- 对于简单的遍历，使用迭代器可能有些矫枉过正
- 比起直接遍历集合的元素，使用迭代器的效率可能会低一些

## 代码示例

### TypeScript

```typescript
interface Iterator<T> { next(): T | null; hasNext(): boolean; }
interface IterableCollection<T> { createIterator(): Iterator<T>; }

class Book { constructor(public title: string, public author: string) {} }

class BookShelf implements IterableCollection<Book> {
  private books: Book[] = [];
  addBook(book: Book): void { this.books.push(book); }
  getCount(): number { return this.books.length; }
  getBookAt(index: number): Book { return this.books[index]; }
  createIterator(): Iterator<Book> { return new BookIterator(this); }
  createReverseIterator(): Iterator<Book> { return new ReverseBookIterator(this); }
}

class BookIterator implements Iterator<Book> {
  private index = 0;
  constructor(private shelf: BookShelf) {}
  next(): Book | null {
    if (this.hasNext()) return this.shelf.getBookAt(this.index++);
    return null;
  }
  hasNext(): boolean { return this.index < this.shelf.getCount(); }
}

class ReverseBookIterator implements Iterator<Book> {
  private index: number;
  constructor(private shelf: BookShelf) { this.index = shelf.getCount() - 1; }
  next(): Book | null {
    if (this.hasNext()) return this.shelf.getBookAt(this.index--);
    return null;
  }
  hasNext(): boolean { return this.index >= 0; }
}

const shelf = new BookShelf();
shelf.addBook(new Book('设计模式', 'GoF'));
shelf.addBook(new Book('重构', 'Martin Fowler'));
shelf.addBook(new Book('代码整洁之道', 'Robert C. Martin'));

console.log('=== 正序遍历 ===');
const it = shelf.createIterator();
while (it.hasNext()) {
  const b = it.next();
  if (b) console.log(b.title, '-', b.author);
}

console.log('\n=== 逆序遍历 ===');
const rit = shelf.createReverseIterator();
while (rit.hasNext()) {
  const b = rit.next();
  if (b) console.log(b.title, '-', b.author);
}
```

### React

```tsx
import React, { useState } from 'react';

interface Iterator<T> { next(): T | null; hasNext(): boolean; reset(): void; }

// 分页迭代器
class PagedIterator<T> implements Iterator<T> {
  private index = 0;
  constructor(private items: T[], private pageSize: number) {}
  next(): T | null {
    if (this.hasNext()) return this.items[this.index++];
    return null;
  }
  hasNext(): boolean { return this.index < this.items.length; }
  reset(): void { this.index = 0; }
  getPage(page: number): T[] {
    const start = (page - 1) * this.pageSize;
    return this.items.slice(start, start + this.pageSize);
  }
  getTotalPages(): number { return Math.ceil(this.items.length / this.pageSize); }
  getCurrentIndex(): number { return this.index; }
}

const users = [
  { id: 1, name: 'Alice', role: 'Admin' },
  { id: 2, name: 'Bob', role: 'User' },
  { id: 3, name: 'Charlie', role: 'User' },
  { id: 4, name: 'David', role: 'Editor' },
  { id: 5, name: 'Eve', role: 'User' },
  { id: 6, name: 'Frank', role: 'Admin' },
  { id: 7, name: 'Grace', role: 'User' },
];

const IteratorDemo: React.FC = () => {
  const [page, setPage] = useState(1);
  const pageSize = 3;
  const iterator = new PagedIterator(users, pageSize);
  const totalPages = iterator.getTotalPages();
  const currentPage = iterator.getPage(page);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>迭代器模式 - 分页</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ padding: '8px', border: '1px solid #d9d9d9', textAlign: 'left' }}>ID</th>
            <th style={{ padding: '8px', border: '1px solid #d9d9d9', textAlign: 'left' }}>姓名</th>
            <th style={{ padding: '8px', border: '1px solid #d9d9d9', textAlign: 'left' }}>角色</th>
          </tr>
        </thead>
        <tbody>
          {currentPage.map(u => (
            <tr key={u.id}>
              <td style={{ padding: '8px', border: '1px solid #d9d9d9' }}>{u.id}</td>
              <td style={{ padding: '8px', border: '1px solid #d9d9d9' }}>{u.name}</td>
              <td style={{ padding: '8px', border: '1px solid #d9d9d9' }}>{u.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} style={{ padding: '4px 12px' }}>上一页</button>
        <span style={{ padding: '4px 12px' }}>第 {page} / {totalPages} 页</span>
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} style={{ padding: '4px 12px' }}>下一页</button>
      </div>
    </div>
  );
};

export default IteratorDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>迭代器模式 - 分页</h3>
    <table style="border-collapse: collapse; width: 100%;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="padding: 8px; border: 1px solid #d9d9d9; text-align: left;">ID</th>
          <th style="padding: 8px; border: 1px solid #d9d9d9; text-align: left;">姓名</th>
          <th style="padding: 8px; border: 1px solid #d9d9d9; text-align: left;">角色</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in currentPage" :key="u.id">
          <td style="padding: 8px; border: 1px solid #d9d9d9;">{{ u.id }}</td>
          <td style="padding: 8px; border: 1px solid #d9d9d9;">{{ u.name }}</td>
          <td style="padding: 8px; border: 1px solid #d9d9d9;">{{ u.role }}</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top: 12px; display: flex; gap: 8px;">
      <button @click="page = Math.max(1, page - 1)" :disabled="page === 1" style="padding: 4px 12px;">上一页</button>
      <span style="padding: 4px 12px;">第 {{ page }} / {{ totalPages }} 页</span>
      <button @click="page = Math.min(totalPages, page + 1)" :disabled="page === totalPages" style="padding: 4px 12px;">下一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const users = [
  { id: 1, name: 'Alice', role: 'Admin' },
  { id: 2, name: 'Bob', role: 'User' },
  { id: 3, name: 'Charlie', role: 'User' },
  { id: 4, name: 'David', role: 'Editor' },
  { id: 5, name: 'Eve', role: 'User' },
  { id: 6, name: 'Frank', role: 'Admin' },
  { id: 7, name: 'Grace', role: 'User' },
];

const page = ref(1);
const pageSize = 3;
const totalPages = computed(() => Math.ceil(users.length / pageSize));
const currentPage = computed(() => {
  const start = (page.value - 1) * pageSize;
  return users.slice(start, start + pageSize);
});
</script>
```

### Node.js

```javascript
// 树形结构迭代器
class TreeNode {
  constructor(public value: string, public children: TreeNode[] = []) {}
  add(child: TreeNode): void { this.children.push(child); }
}

// 深度优先迭代器
class DfsIterator {
  private stack: TreeNode[] = [];
  constructor(root: TreeNode) { this.stack.push(root); }
  next(): TreeNode | null {
    if (!this.hasNext()) return null;
    const node = this.stack.pop()!;
    for (let i = node.children.length - 1; i >= 0; i--) {
      this.stack.push(node.children[i]);
    }
    return node;
  }
  hasNext(): boolean { return this.stack.length > 0; }
}

// 广度优先迭代器
class BfsIterator {
  private queue: TreeNode[] = [];
  constructor(root: TreeNode) { this.queue.push(root); }
  next(): TreeNode | null {
    if (!this.hasNext()) return null;
    const node = this.queue.shift()!;
    this.queue.push(...node.children);
    return node;
  }
  hasNext(): boolean { return this.queue.length > 0; }
}

const root = new TreeNode('root');
const a = new TreeNode('A');
const b = new TreeNode('B');
const c = new TreeNode('C');
a.add(new TreeNode('A1'));
a.add(new TreeNode('A2'));
b.add(new TreeNode('B1'));
b.add(new TreeNode('B2'));
c.add(new TreeNode('C1'));
root.add(a); root.add(b); root.add(c);

console.log('=== 深度优先遍历 ===');
const dfs = new DfsIterator(root);
while (dfs.hasNext()) {
  const n = dfs.next();
  if (n) console.log(n.value);
}

console.log('\n=== 广度优先遍历 ===');
const bfs = new BfsIterator(root);
while (bfs.hasNext()) {
  const n = bfs.next();
  if (n) console.log(n.value);
}
```


