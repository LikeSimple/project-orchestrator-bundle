# Compound Components (复合组件)

## 概述

复合组件是一种将多个组件组合在一起工作，共同完成一个完整功能的模式。它们通过共享隐式状态来实现组件间的协作。

## 适用场景

- 需要创建一组协同工作的组件（如 Tabs、Dropdown、Menu）
- 需要灵活的组件 API，用户可以自由组合子组件
- 需要在父子组件间隐式共享状态
- 需要提供声明式的组件使用方式

## 优点

- API 优雅：使用声明式语法，可读性好
- 灵活性高：用户可以自由组合子组件
- 状态共享：通过 Context 隐式共享状态，无需手动传递 props
- 可扩展性：可以方便地添加新的子组件类型

## 缺点

- 实现相对复杂
- 需要使用 Context 或其他状态共享机制
- 对于简单场景可能过度设计
- 子组件之间的依赖关系不明显

## 代码示例

### TypeScript

```typescript
// 复合组件的 TypeScript 类型定义
interface TabsContextType {
  activeKey: string;
  onChange: (key: string) => void;
}

interface TabProps {
  tabKey: string;
  label: React.ReactNode;
  children: React.ReactNode;
}

interface TabsProps {
  defaultActiveKey?: string;
  activeKey?: string;
  onChange?: (key: string) => void;
  children: React.ReactNode;
}
```

### React

```tsx
import React, { useState, createContext, useContext, useMemo } from 'react';

// Tabs 复合组件
interface TabsContextType { activeKey: string; onChange: (key: string) => void; }
const TabsContext = createContext<TabsContextType | null>(null);

const useTabs = () => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab 必须在 Tabs 内使用');
  return ctx;
};

const Tabs: React.FC<any> & { Tab: React.FC<any>; TabList: React.FC<any>; TabPanels: React.FC<any>; TabPanel: React.FC<any> } = ({ defaultActiveKey, activeKey: controlledKey, onChange, children }) => {
  const [internalKey, setInternalKey] = useState(defaultActiveKey || '');
  const isControlled = controlledKey !== undefined;
  const activeKey = isControlled ? controlledKey : internalKey;

  const handleChange = (key: string) => {
    if (!isControlled) setInternalKey(key);
    onChange?.(key);
  };

  const contextValue = useMemo(() => ({ activeKey, onChange: handleChange }), [activeKey]);
  return <TabsContext.Provider value={contextValue}><div className="tabs">{children}</div></TabsContext.Provider>;
};

Tabs.TabList = ({ children }) => {
  const { activeKey, onChange } = useTabs();
  return (
    <div style={{ display: 'flex', borderBottom: '2px solid #d9d9d9', marginBottom: '16px' }}>
      {React.Children.map(children, child => {
        if (!React.isValidElement(child)) return null;
        const key = child.props.tabKey;
        return React.cloneElement(child as React.ReactElement<any>, {
          active: activeKey === key,
          onClick: () => onChange(key),
        });
      })}
    </div>
  );
};

Tabs.Tab = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 'bold' : 'normal', color: active ? '#1890ff' : '#333', borderBottom: active ? '2px solid #1890ff' : 'none', marginBottom: '-2px' }}>{label}</button>
);

Tabs.TabPanels = ({ children }) => {
  const { activeKey } = useTabs();
  const activeChild = React.Children.toArray(children).find(child => React.isValidElement(child) && child.props.tabKey === activeKey);
  return <div>{activeChild}</div>;
};

Tabs.TabPanel = ({ children }) => <div style={{ padding: '16px 0' }}>{children}</div>;

const CompoundDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
    <h3>复合组件模式 - Tabs</h3>
    <Tabs defaultActiveKey="tab1">
      <Tabs.TabList>
        <Tabs.Tab tabKey="tab1" label="首页" />
        <Tabs.Tab tabKey="tab2" label="产品" />
        <Tabs.Tab tabKey="tab3" label="关于" />
      </Tabs.TabList>
      <Tabs.TabPanels>
        <Tabs.TabPanel tabKey="tab1"><h4>欢迎来到首页</h4><p>这是首页的内容。</p></Tabs.TabPanel>
        <Tabs.TabPanel tabKey="tab2"><h4>产品列表</h4><p>这里展示我们的产品。</p></Tabs.TabPanel>
        <Tabs.TabPanel tabKey="tab3"><h4>关于我们</h4><p>了解更多关于我们的信息。</p></Tabs.TabPanel>
      </Tabs.TabPanels>
    </Tabs>
  </div>
);

export default CompoundDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>复合组件模式 - Tabs</h3>
    <Tabs default-active-key="tab1">
      <template #tabs>
        <Tab tab-key="tab1" label="首页" />
        <Tab tab-key="tab2" label="产品" />
        <Tab tab-key="tab3" label="关于" />
      </template>
      <TabPanel tab-key="tab1">
        <h4>欢迎来到首页</h4>
        <p>这是首页的内容。</p>
      </TabPanel>
      <TabPanel tab-key="tab2">
        <h4>产品列表</h4>
        <p>这里展示我们的产品。</p>
      </TabPanel>
      <TabPanel tab-key="tab3">
        <h4>关于我们</h4>
        <p>了解更多关于我们的信息。</p>
      </TabPanel>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, inject, defineComponent, h, computed } from 'vue';

const TabsContextKey = Symbol('tabs');

const Tabs = defineComponent({
  name: 'Tabs',
  props: { defaultActiveKey: String },
  setup(props, { slots }) {
    const activeKey = ref(props.defaultActiveKey || '');
    const changeTab = (key: string) => { activeKey.value = key; };
    provide(TabsContextKey, { activeKey, changeTab });
    return () => {
      const tabs = slots.tabs?.();
      const panels = slots.default?.();
      return h('div', [
        h('div', { style: { display: 'flex', borderBottom: '2px solid #d9d9d9', marginBottom: '16px' } }, tabs),
        h('div', panels),
      ]);
    };
  },
});

const Tab = defineComponent({
  name: 'Tab',
  props: { tabKey: String, label: String },
  setup(props) {
    const ctx = inject<any>(TabsContextKey);
    const isActive = computed(() => ctx.activeKey.value === props.tabKey);
    const onClick = () => { ctx.changeTab(props.tabKey); };
    return () =>
      h('button', {
        onClick,
        style: {
          padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontWeight: isActive.value ? 'bold' : 'normal',
          color: isActive.value ? '#1890ff' : '#333',
          borderBottom: isActive.value ? '2px solid #1890ff' : 'none',
          marginBottom: '-2px',
        },
      }, props.label);
  },
});

const TabPanel = defineComponent({
  name: 'TabPanel',
  props: { tabKey: String },
  setup(props, { slots }) {
    const ctx = inject<any>(TabsContextKey);
    const isActive = computed(() => ctx.activeKey.value === props.tabKey);
    return () => isActive.value ? h('div', { style: { padding: '16px 0' } }, slots.default?.()) : null;
  },
});
</script>
```

### Node.js

```javascript
// Node.js 中类似复合组件的建造者模式
class QueryBuilder {
  private table = '';
  private selectFields: string[] = [];
  private whereConditions: string[] = [];
  private orderByField = '';
  private limitCount = 0;
  private offsetCount = 0;

  from(table: string): this { this.table = table; return this; }
  select(...fields: string[]): this { this.selectFields = fields; return this; }
  where(condition: string): this { this.whereConditions.push(condition); return this; }
  orderBy(field: string): this { this.orderByField = field; return this; }
  limit(count: number): this { this.limitCount = count; return this; }
  offset(count: number): this { this.offsetCount = count; return this; }

  build(): string {
    const fields = this.selectFields.length ? this.selectFields.join(', ') : '*';
    let sql = `SELECT ${fields} FROM ${this.table}`;
    if (this.whereConditions.length) sql += ' WHERE ' + this.whereConditions.join(' AND ');
    if (this.orderByField) sql += ' ORDER BY ' + this.orderByField;
    if (this.limitCount) sql += ' LIMIT ' + this.limitCount;
    if (this.offsetCount) sql += ' OFFSET ' + this.offsetCount;
    return sql + ';';
  }

  execute(): any[] {
    const sql = this.build();
    console.log('执行 SQL:', sql);
    return [{ id: 1, name: '示例数据' }];
  }
}

// 使用建造者模式（类似复合组件的链式调用）
const query = new QueryBuilder()
  .select('id', 'name', 'email')
  .from('users')
  .where('age > 18')
  .where('status = "active"')
  .orderBy('created_at')
  .limit(10)
  .offset(20);

const sql = query.build();
console.log('生成的 SQL:', sql);
const results = query.execute();
console.log('结果:', results);
```


