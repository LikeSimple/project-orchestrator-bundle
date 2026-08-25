# Factory Method (工厂方法)

## 概述

定义一个创建对象的接口，让子类决定实例化哪个类。工厂方法使一个类的实例化延迟到其子类。

## 适用场景

- 当一个类不知道它所必须创建的对象的类的时候
- 当一个类希望由它的子类来指定它所创建的对象的时候
- 当类将创建对象的职责委托给多个帮助子类中的某一个，并且你希望将哪一个帮助子类是代理者这一信息局部化的时候

## 优点

- 避免创建者和具体产品之间的紧密耦合
- 单一职责原则：可以将产品创建代码放在程序的单一位置
- 开闭原则：无需更改现有客户端代码，就可以在程序中引入新的产品类型

## 缺点

- 代码可能会变得复杂，因为需要引入许多新的子类来实现该模式
- 增加了系统的抽象性和理解难度

## 代码示例

### TypeScript

```typescript
// 产品接口
interface Button {
  render(): string;
  onClick(): void;
}

// 具体产品
class WindowsButton implements Button {
  render(): string { return '[Windows Button]'; }
  onClick(): void { console.log('Windows button clicked'); }
}

class HTMLButton implements Button {
  render(): string { return '<button>HTML Button</button>'; }
  onClick(): void { console.log('HTML button clicked'); }
}

// 工厂抽象类
abstract class Dialog {
  abstract createButton(): Button;
  renderWindow(): void {
    const button = this.createButton();
    console.log('Rendering:', button.render());
    button.onClick();
  }
}

// 具体工厂
class WindowsDialog extends Dialog {
  createButton(): Button { return new WindowsButton(); }
}

class WebDialog extends Dialog {
  createButton(): Button { return new HTMLButton(); }
}

// 使用
function clientCode(creator: Dialog) {
  creator.renderWindow();
}

clientCode(new WindowsDialog());
clientCode(new WebDialog());
```

### React

```tsx
import React from 'react';

// 产品接口
interface ButtonProps {
  label: string;
  onClick: () => void;
}

// 具体产品
const PrimaryButton: React.FC<ButtonProps> = ({ label, onClick }) => (
  <button onClick={onClick} style={{
    padding: '8px 16px', backgroundColor: '#1890ff',
    color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer',
  }}>{label}</button>
);

const SecondaryButton: React.FC<ButtonProps> = ({ label, onClick }) => (
  <button onClick={onClick} style={{
    padding: '8px 16px', backgroundColor: 'white',
    color: '#1890ff', border: '1px solid #1890ff', borderRadius: '4px', cursor: 'pointer',
  }}>{label}</button>
);

// 工厂函数
type ButtonType = 'primary' | 'secondary';

function createButton(type: ButtonType): React.FC<ButtonProps> {
  switch (type) {
    case 'primary': return PrimaryButton;
    case 'secondary': return SecondaryButton;
    default: return PrimaryButton;
  }
}

// 使用
const ButtonFactoryDemo: React.FC = () => {
  const PrimaryBtn = createButton('primary');
  const SecondaryBtn = createButton('secondary');
  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <PrimaryBtn label="Primary" onClick={() => alert('Primary')} />
      <SecondaryBtn label="Secondary" onClick={() => alert('Secondary')} />
    </div>
  );
};

export default ButtonFactoryDemo;
```

### Vue 3

```tsx
<template>
  <div style="display: flex; gap: 10px;">
    <component :is="buttonComponent" :label="label" @click="handleClick" />
    <button @click="toggleType">切换类型</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineComponent, h } from 'vue';

// 具体产品
const PrimaryButton = defineComponent({
  name: 'PrimaryButton',
  props: ['label'],
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      onClick: () => emit('click'),
      style: { padding: '8px 16px', background: '#1890ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' },
    }, props.label);
  },
});

const SecondaryButton = defineComponent({
  name: 'SecondaryButton',
  props: ['label'],
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      onClick: () => emit('click'),
      style: { padding: '8px 16px', background: 'white', color: '#1890ff', border: '1px solid #1890ff', borderRadius: '4px', cursor: 'pointer' },
    }, props.label);
  },
});

// 工厂函数
function createButton(type: 'primary' | 'secondary') {
  return type === 'primary' ? PrimaryButton : SecondaryButton;
}

const buttonType = ref<'primary' | 'secondary'>('primary');
const label = ref('Click Me');
const buttonComponent = computed(() => createButton(buttonType.value));
const handleClick = () => console.log('clicked:', buttonType.value);
const toggleType = () => { buttonType.value = buttonType.value === 'primary' ? 'secondary' : 'primary'; };
</script>
```

### Node.js

```javascript
// 产品接口
class Logger { log(message) { throw new Error('Not implemented'); } }

// 具体产品
class ConsoleLogger extends Logger {
  log(message) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [INFO] ${message}`);
  }
}

class FileLogger extends Logger {
  constructor(filename) {
    super();
    this.filename = filename;
    this.fs = require('fs');
  }
  log(message) {
    const ts = new Date().toISOString();
    this.fs.appendFileSync(this.filename, `[${ts}] [INFO] ${message}\n`);
  }
}

// 工厂
class LoggerFactory {
  static createLogger(type, options = {}) {
    switch (type) {
      case 'console': return new ConsoleLogger();
      case 'file': return new FileLogger(options.filename || 'app.log');
      default: return new ConsoleLogger();
    }
  }
}

// 使用
const logger = LoggerFactory.createLogger(
  process.env.LOG_TYPE || 'console',
  { filename: 'app.log' }
);
logger.log('Application started');
logger.log('Processing data...');
logger.log('Application finished');
```


