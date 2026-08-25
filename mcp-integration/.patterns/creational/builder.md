# Builder (建造者)

## 概述

将一个复杂对象的构建与它的表示分离，使得同样的构建过程可以创建不同的表示。

## 适用场景

- 当创建复杂对象的算法应该独立于该对象的组成部分以及它们的装配方式时
- 当构造过程必须允许被构造的对象有不同的表示时
- 需要创建具有许多可选参数的对象时

## 优点

- 可以分步创建对象，暂缓创建步骤或递归运行创建步骤
- 生成不同形式的产品时，可以复用相同的制造代码
- 单一职责原则：可以将复杂构造代码从产品的业务逻辑中分离出来

## 缺点

- 由于该模式需要新增多个类，因此代码整体复杂程度会有所增加
- 产品必须有共同点，范围有限制

## 代码示例

### TypeScript

```typescript
// 产品
interface Computer {
  cpu: string;
  ram: string;
  storage: string;
  gpu?: string;
  os: string;
}

// 建造者
class ComputerBuilder {
  private computer: Partial<Computer> = {};

  setCPU(cpu: string): ComputerBuilder { this.computer.cpu = cpu; return this; }
  setRAM(ram: string): ComputerBuilder { this.computer.ram = ram; return this; }
  setStorage(storage: string): ComputerBuilder { this.computer.storage = storage; return this; }
  setGPU(gpu: string): ComputerBuilder { this.computer.gpu = gpu; return this; }
  setOS(os: string): ComputerBuilder { this.computer.os = os; return this; }

  build(): Computer {
    if (!this.computer.cpu || !this.computer.ram || !this.computer.storage) {
      throw new Error('CPU, RAM, Storage are required');
    }
    return this.computer as Computer;
  }
}

// 主管
class ComputerDirector {
  static buildGamingPC(): Computer {
    return new ComputerBuilder()
      .setCPU('Intel i9').setRAM('32GB').setStorage('2TB NVMe')
      .setGPU('RTX 4090').setOS('Windows 11').build();
  }

  static buildOfficePC(): Computer {
    return new ComputerBuilder()
      .setCPU('Intel i5').setRAM('16GB').setStorage('512GB SSD')
      .setOS('Windows 10').build();
  }
}

// 使用
const custom = new ComputerBuilder()
  .setCPU('AMD Ryzen 7').setRAM('16GB').setStorage('1TB SSD')
  .setGPU('RTX 3060').setOS('Ubuntu 22.04').build();
console.log('Custom:', JSON.stringify(custom));

const gaming = ComputerDirector.buildGamingPC();
console.log('Gaming:', JSON.stringify(gaming));

const office = ComputerDirector.buildOfficePC();
console.log('Office:', JSON.stringify(office));
```

### React

```tsx
import React, { useState } from 'react';

// 建造者
class FormBuilder {
  private config = { fields: [], submitText: '提交', layout: 'vertical' as const };

  setTitle(title: string): FormBuilder { (this.config as any).title = title; return this; }
  setSubmitText(text: string): FormBuilder { this.config.submitText = text; return this; }
  addField(field: any): FormBuilder { this.config.fields.push(field); return this; }
  build() { return { ...this.config, fields: [...this.config.fields] }; }
}

// 动态表单组件
const DynamicForm: React.FC<any> = ({ config, onSubmit }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    config.fields.forEach((f: any) => {
      if (f.required && !values[f.name]) newErrors[f.name] = f.label + '必填';
    });
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: '400px' }}>
      {config.title && <h3 style={{ marginTop: 0 }}>{config.title}</h3>}
      {config.fields.map((field: any) => (
        <div key={field.name} style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>
            {field.label}
            {field.required && <span style={{ color: 'red' }}>*</span>}
          </label>
          <input
            type={field.type || 'text'}
            value={values[field.name] || ''}
            onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
            style={{ padding: '6px', width: '100%' }}
          />
          {errors[field.name] && <p style={{ color: 'red', fontSize: '12px', margin: '4px 0 0' }}>{errors[field.name]}</p>}
        </div>
      ))}
      <button type="submit" style={{ padding: '8px 16px', cursor: 'pointer' }}>{config.submitText}</button>
    </form>
  );
};

const BuilderDemo: React.FC = () => {
  const loginForm = new FormBuilder().setTitle('登录').setSubmitText('登录')
    .addField({ name: 'username', label: '用户名', type: 'text', required: true })
    .addField({ name: 'password', label: '密码', type: 'password', required: true })
    .build();

  return (
    <div>
      <h3>建造者模式 - 动态表单</h3>
      <DynamicForm config={loginForm} onSubmit={(v: any) => alert(JSON.stringify(v))} />
    </div>
  );
};

export default BuilderDemo;
```

### Vue 3

```tsx
<template>
  <div>
    <h3>建造者模式 - 动态表单</h3>
    <DynamicForm :config="loginForm" @submit="handleSubmit" />
  </div>
</template>

<script setup lang="ts">
import { reactive, defineComponent, h } from 'vue';

// 建造者
class FormBuilder {
  private config: any = { fields: [], submitText: '提交' };
  setTitle(t: string): FormBuilder { this.config.title = t; return this; }
  setSubmitText(t: string): FormBuilder { this.config.submitText = t; return this; }
  addField(f: any): FormBuilder { this.config.fields.push(f); return this; }
  build() { return JSON.parse(JSON.stringify(this.config)); }
}

const DynamicForm = defineComponent({
  name: 'DynamicForm',
  props: { config: Object },
  emits: ['submit'],
  setup(props, { emit }) {
    const values = reactive<Record<string, string>>({});
    const errors = reactive<Record<string, string>>({});

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      let valid = true;
      props.config.fields.forEach((f: any) => {
        if (f.required && !values[f.name]) { errors[f.name] = f.label + '必填'; valid = false; }
      });
      if (valid) emit('submit', { ...values });
    };

    return () => h('form', { onSubmit: handleSubmit, style: { maxWidth: '400px' } }, [
      props.config.title ? h('h3', { style: { marginTop: 0 } }, props.config.title) : null,
      ...props.config.fields.map((field: any) => h('div', { key: field.name, style: { marginBottom: '12px' } }, [
        h('label', { style: { display: 'block', marginBottom: '4px' } }, [
          field.label,
          field.required ? h('span', { style: { color: 'red' } }, '*') : null,
        ]),
        h('input', {
          type: field.type || 'text',
          value: values[field.name] || '',
          onInput: (e: any) => { values[field.name] = e.target.value; },
          style: { padding: '6px', width: '100%' },
        }),
        errors[field.name] ? h('p', { style: { color: 'red', fontSize: '12px', margin: '4px 0 0' } }, errors[field.name]) : null,
      ])),
      h('button', { type: 'submit', style: { padding: '8px 16px', cursor: 'pointer' } }, props.config.submitText),
    ]);
  },
});

const loginForm = new FormBuilder().setTitle('登录').setSubmitText('登录')
  .addField({ name: 'username', label: '用户名', type: 'text', required: true })
  .addField({ name: 'password', label: '密码', type: 'password', required: true })
  .build();

const handleSubmit = (v: any) => alert(JSON.stringify(v));
</script>
```

### Node.js

```javascript
// 产品
interface RequestConfig {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  timeout?: number;
  retries?: number;
}

// 建造者
class RequestBuilder {
  private config: any = { headers: {} };

  get(url: string): RequestBuilder { this.config.method = 'GET'; this.config.url = url; return this; }
  post(url: string): RequestBuilder { this.config.method = 'POST'; this.config.url = url; return this; }
  put(url: string): RequestBuilder { this.config.method = 'PUT'; this.config.url = url; return this; }
  delete(url: string): RequestBuilder { this.config.method = 'DELETE'; this.config.url = url; return this; }
  addHeader(key: string, value: string): RequestBuilder { this.config.headers[key] = value; return this; }
  setBody(body: any): RequestBuilder { this.config.body = body; return this; }
  setTimeout(ms: number): RequestBuilder { this.config.timeout = ms; return this; }
  setRetries(n: number): RequestBuilder { this.config.retries = n; return this; }

  build(): RequestConfig {
    if (!this.config.method || !this.config.url) throw new Error('Method and URL required');
    return this.config;
  }

  async execute(): Promise<any> {
    const config = this.build();
    console.log(`Request: ${config.method} ${config.url}`);
    console.log('Headers:', JSON.stringify(config.headers));
    if (config.body) console.log('Body:', JSON.stringify(config.body));
    return new Promise(resolve => setTimeout(() => resolve({ status: 200, data: { ok: true } }), 100));
  }
}

// 使用
async function main() {
  console.log('=== GET ===');
  const getResult = await new RequestBuilder()
    .get('https://api.example.com/users')
    .addHeader('Authorization', 'Bearer token123')
    .setTimeout(5000)
    .setRetries(3)
    .execute();
  console.log('Response:', JSON.stringify(getResult));

  console.log('\n=== POST ===');
  const postResult = await new RequestBuilder()
    .post('https://api.example.com/users')
    .addHeader('Authorization', 'Bearer token123')
    .setBody({ name: 'Alice', email: 'alice@example.com' })
    .execute();
  console.log('Response:', JSON.stringify(postResult));
}

main();
```


