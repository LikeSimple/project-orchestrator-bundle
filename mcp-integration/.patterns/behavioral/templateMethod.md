# Template Method (模板方法)

## 概述

定义一个操作中的算法的骨架，而将一些步骤延迟到子类中。模板方法使得子类可以不改变一个算法的结构即可重定义该算法的某些特定步骤。

## 适用场景

- 一次性实现一个算法的不变的部分，并将可变的行为留给子类来实现
- 各子类中公共的行为应被提取出来并集中到一个公共父类中以避免代码重复
- 控制子类扩展，只允许在特定点进行扩展

## 优点

- 你可以只让客户端重写大型算法中的某些部分，减少算法中其他部分被修改带来的影响
- 你可以将重复代码提取到一个超类中

## 缺点

- 通过继承来实现代码复用，可能会限制算法的灵活性
- 算法骨架的改变可能需要修改所有子类
- 子类可能会受到超类中方法数量和复杂度的影响

## 代码示例

### TypeScript

```typescript
abstract class DataProcessor {
  process(filename: string): void {
    const data = this.readData(filename);
    const parsed = this.parseData(data);
    const result = this.processData(parsed);
    this.saveResult(result);
    if (this.shouldLog()) this.logResult(result);
  }
  protected abstract readData(filename: string): string;
  protected abstract parseData(data: string): any;
  protected abstract processData(data: any): any;
  protected abstract saveResult(result: any): void;
  protected shouldLog(): boolean { return false; }
  protected logResult(result: any): void { console.log('结果:', JSON.stringify(result)); }
}

class CSVProcessor extends DataProcessor {
  protected readData(filename: string): string { console.log('读取 CSV 文件:', filename); return 'name,age\nAlice,30\nBob,25'; }
  protected parseData(data: string): any[] {
    const lines = data.split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(l => {
      const vals = l.split(',');
      const obj: any = {};
      headers.forEach((h, i) => obj[h] = vals[i]);
      return obj;
    });
  }
  protected processData(data: any[]): any {
    console.log('处理 CSV 数据，共', data.length, '条');
    return { count: data.length, averageAge: data.reduce((s, d) => s + Number(d.age), 0) / data.length };
  }
  protected saveResult(result: any): void { console.log('保存 CSV 结果到文件:', JSON.stringify(result)); }
  protected shouldLog(): boolean { return true; }
}

class JSONProcessor extends DataProcessor {
  protected readData(filename: string): string { console.log('读取 JSON 文件:', filename); return '{"users":[{"name":"Alice","age":30},{"name":"Bob","age":25}]}'; }
  protected parseData(data: string): any { return JSON.parse(data); }
  protected processData(data: any): any {
    console.log('处理 JSON 数据，共', data.users.length, '条');
    return { count: data.users.length, users: data.users.map((u: any) => u.name) };
  }
  protected saveResult(result: any): void { console.log('保存 JSON 结果到数据库:', JSON.stringify(result)); }
}

console.log('=== CSV 处理 ===');
const csv = new CSVProcessor();
csv.process('data.csv');

console.log('\n=== JSON 处理 ===');
const json = new JSONProcessor();
json.process('data.json');
```

### React

```tsx
import React from 'react';

// 模板方法：表单验证流程
abstract class FormValidator<T> {
  validate(formData: T): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    this.checkRequired(formData, errors);
    this.checkFormat(formData, errors);
    this.checkBusinessRules(formData, errors);
    return { valid: errors.length === 0, errors };
  }
  protected abstract checkRequired(data: T, errors: string[]): void;
  protected abstract checkFormat(data: T, errors: string[]): void;
  protected checkBusinessRules(data: T, errors: string[]): void { /* 默认无业务规则 */ }
}

interface LoginForm { username: string; password: string; }

class LoginValidator extends FormValidator<LoginForm> {
  protected checkRequired(data: LoginForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
  }
  protected checkFormat(data: LoginForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
  }
}

interface RegisterForm { username: string; password: string; confirmPassword: string; email: string; }

class RegisterValidator extends FormValidator<RegisterForm> {
  protected checkRequired(data: RegisterForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
    if (!data.confirmPassword) errors.push('确认密码不能为空');
    if (!data.email) errors.push('邮箱不能为空');
  }
  protected checkFormat(data: RegisterForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('邮箱格式不正确');
  }
  protected checkBusinessRules(data: RegisterForm, errors: string[]): void {
    if (data.password && data.confirmPassword && data.password !== data.confirmPassword)
      errors.push('两次密码输入不一致');
  }
}

const TemplateDemo: React.FC = () => {
  const loginValidator = new LoginValidator();
  const loginResult = loginValidator.validate({ username: 'ab', password: '123' });

  const regValidator = new RegisterValidator();
  const regResult = regValidator.validate({ username: 'alice', password: '123456', confirmPassword: '123456', email: 'invalid' });

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>模板方法模式 - 表单验证</h3>
      <div style={{ marginBottom: '16px' }}>
        <h4>登录表单验证 (用户名=ab, 密码=123):</h4>
        <p>结果: {loginResult.valid ? '✅ 有效' : '❌ 无效'}</p>
        <ul>{loginResult.errors.map((e, i) => <li key={i} style={{ color: '#ff4d4f' }}>{e}</li>)}</ul>
      </div>
      <div>
        <h4>注册表单验证:</h4>
        <p>结果: {regResult.valid ? '✅ 有效' : '❌ 无效'}</p>
        <ul>{regResult.errors.map((e, i) => <li key={i} style={{ color: '#ff4d4f' }}>{e}</li>)}</ul>
      </div>
    </div>
  );
};

export default TemplateDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>模板方法模式 - 表单验证</h3>
    <div style="margin-bottom: 16px;">
      <h4>登录表单验证 (用户名=ab, 密码=123):</h4>
      <p>结果: {{ loginResult.valid ? '✅ 有效' : '❌ 无效' }}</p>
      <ul><li v-for="(e, i) in loginResult.errors" :key="i" style="color: #ff4d4f;">{{ e }}</li></ul>
    </div>
    <div>
      <h4>注册表单验证:</h4>
      <p>结果: {{ regResult.valid ? '✅ 有效' : '❌ 无效' }}</p>
      <ul><li v-for="(e, i) in regResult.errors" :key="i" style="color: #ff4d4f;">{{ e }}</li></ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';

abstract class FormValidator<T> {
  validate(formData: T): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    this.checkRequired(formData, errors);
    this.checkFormat(formData, errors);
    this.checkBusinessRules(formData, errors);
    return { valid: errors.length === 0, errors };
  }
  protected abstract checkRequired(data: T, errors: string[]): void;
  protected abstract checkFormat(data: T, errors: string[]): void;
  protected checkBusinessRules(data: T, errors: string[]): void {}
}

interface LoginForm { username: string; password: string; }

class LoginValidator extends FormValidator<LoginForm> {
  protected checkRequired(data: LoginForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
  }
  protected checkFormat(data: LoginForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
  }
}

interface RegisterForm { username: string; password: string; confirmPassword: string; email: string; }

class RegisterValidator extends FormValidator<RegisterForm> {
  protected checkRequired(data: RegisterForm, errors: string[]): void {
    if (!data.username) errors.push('用户名不能为空');
    if (!data.password) errors.push('密码不能为空');
    if (!data.confirmPassword) errors.push('确认密码不能为空');
    if (!data.email) errors.push('邮箱不能为空');
  }
  protected checkFormat(data: RegisterForm, errors: string[]): void {
    if (data.username && data.username.length < 3) errors.push('用户名至少3个字符');
    if (data.password && data.password.length < 6) errors.push('密码至少6个字符');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('邮箱格式不正确');
  }
  protected checkBusinessRules(data: RegisterForm, errors: string[]): void {
    if (data.password && data.confirmPassword && data.password !== data.confirmPassword)
      errors.push('两次密码输入不一致');
  }
}

const loginValidator = new LoginValidator();
const loginResult = reactive(loginValidator.validate({ username: 'ab', password: '123' }));

const regValidator = new RegisterValidator();
const regResult = reactive(regValidator.validate({ username: 'alice', password: '123456', confirmPassword: '123456', email: 'invalid' }));
</script>
```

### Node.js

```javascript
abstract class Beverage {
  prepare(): void {
    this.boilWater();
    this.brew();
    this.pourInCup();
    if (this.wantsCondiments()) this.addCondiments();
  }
  private boilWater(): void { console.log('1. 烧开水'); }
  private pourInCup(): void { console.log('3. 倒入杯中'); }
  protected abstract brew(): void;
  protected abstract addCondiments(): void;
  protected wantsCondiments(): boolean { return true; }
}

class Coffee extends Beverage {
  protected brew(): void { console.log('2. 冲泡咖啡粉'); }
  protected addCondiments(): void { console.log('4. 添加糖和奶'); }
}

class Tea extends Beverage {
  protected brew(): void { console.log('2. 浸泡茶叶'); }
  protected addCondiments(): void { console.log('4. 添加柠檬'); }
  protected wantsCondiments(): boolean { return false; }
}

class HotChocolate extends Beverage {
  protected brew(): void { console.log('2. 搅拌可可粉'); }
  protected addCondiments(): void { console.log('4. 添加棉花糖'); }
}

console.log('=== 制作咖啡 ===');
const coffee = new Coffee();
coffee.prepare();

console.log('\n=== 制作茶 ===');
const tea = new Tea();
tea.prepare();

console.log('\n=== 制作热巧克力 ===');
const choc = new HotChocolate();
choc.prepare();
```


