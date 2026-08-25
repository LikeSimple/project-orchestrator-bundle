# Chain of Responsibility (责任链)

## 概述

使多个对象都有机会处理请求，从而避免请求的发送者和接收者之间的耦合关系。将这些对象连成一条链，并沿着这条链传递该请求，直到有一个对象处理它为止。

## 适用场景

- 有多个的对象可以处理一个请求，哪个对象处理该请求运行时刻自动确定
- 你想在不明确指定接收者的情况下，向多个对象中的一个提交一个请求
- 可处理一个请求的对象集合应被动态指定
- 需要按顺序执行多个处理逻辑

## 优点

- 可以控制请求处理的顺序
- 单一职责原则：可以对发起操作和执行操作的类进行解耦
- 开闭原则：可以在不更改现有代码的情况下在程序中新增处理者
- 可以灵活地增加或修改处理者

## 缺点

- 部分请求可能未被处理
- 请求的处理可能不太直观，调试困难
- 如果链太长，可能会影响性能

## 代码示例

### TypeScript

```typescript
interface Handler { setNext(handler: Handler): Handler; handle(request: string): string | null; }

abstract class AbstractHandler implements Handler {
  private next: Handler | null = null;
  setNext(handler: Handler): Handler { this.next = handler; return handler; }
  handle(request: string): string | null {
    if (this.next) return this.next.handle(request);
    return null;
  }
}

class AuthHandler extends AbstractHandler {
  handle(request: string): string | null {
    if (request.includes('token=valid')) {
      console.log('[Auth] 认证通过');
      return super.handle(request);
    }
    console.log('[Auth] 认证失败');
    return '401 Unauthorized';
  }
}

class RateLimitHandler extends AbstractHandler {
  private count = 0;
  private limit = 3;
  handle(request: string): string | null {
    if (this.count < this.limit) {
      this.count++;
      console.log(`[RateLimit] 请求 ${this.count}/${this.limit}`);
      return super.handle(request);
    }
    console.log('[RateLimit] 超出限流');
    return '429 Too Many Requests';
  }
}

class LogHandler extends AbstractHandler {
  handle(request: string): string | null {
    console.log(`[Log] 记录请求: ${request.slice(0, 30)}...`);
    return super.handle(request);
  }
}

class BusinessHandler extends AbstractHandler {
  handle(request: string): string | null {
    console.log('[Business] 处理业务逻辑');
    return '200 OK - Success';
  }
}

const auth = new AuthHandler();
const rateLimit = new RateLimitHandler();
const log = new LogHandler();
const business = new BusinessHandler();

auth.setNext(rateLimit).setNext(log).setNext(business);

console.log('=== 请求 1（无 token）===');
console.log('结果:', auth.handle('GET /api/data?token=invalid'));

console.log('\n=== 请求 2（有效 token）===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=1'));

console.log('\n=== 请求 3 ===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=2'));

console.log('\n=== 请求 4 ===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=3'));

console.log('\n=== 请求 5（超出限流）===');
console.log('结果:', auth.handle('GET /api/data?token=valid&id=4'));
```

### React

```tsx
import React, { useState } from 'react';

interface ValidationRule {
  setNext(rule: ValidationRule): ValidationRule;
  validate(value: string): string | null;
}

abstract class BaseRule implements ValidationRule {
  private next: ValidationRule | null = null;
  setNext(rule: ValidationRule): ValidationRule { this.next = rule; return rule; }
  validate(value: string): string | null {
    if (this.next) return this.next.validate(value);
    return null;
  }
}

class RequiredRule extends BaseRule {
  validate(value: string): string | null {
    if (!value || !value.trim()) return '此字段为必填项';
    return super.validate(value);
  }
}

class MinLengthRule extends BaseRule {
  constructor(private min: number) { super(); }
  validate(value: string): string | null {
    if (value.length < this.min) return '最少 ' + this.min + ' 个字符';
    return super.validate(value);
  }
}

class MaxLengthRule extends BaseRule {
  constructor(private max: number) { super(); }
  validate(value: string): string | null {
    if (value.length > this.max) return '最多 ' + this.max + ' 个字符';
    return super.validate(value);
  }
}

class EmailRule extends BaseRule {
  validate(value: string): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '邮箱格式不正确';
    return super.validate(value);
  }
}

const ChainDemo: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const buildChain = (): ValidationRule => {
    const required = new RequiredRule();
    const min = new MinLengthRule(3);
    const max = new MaxLengthRule(50);
    const emailRule = new EmailRule();
    required.setNext(min).setNext(max).setNext(emailRule);
    return required;
  };

  const handleValidate = () => {
    const chain = buildChain();
    const err = chain.validate(email);
    setError(err);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>责任链模式 - 表单验证</h3>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>邮箱:</label>
        <input type="text" value={email} onChange={e => setEmail(e.target.value)}
          style={{ padding: '6px', width: '250px', border: error ? '1px solid #ff4d4f' : '1px solid #d9d9d9', borderRadius: '4px' }} />
      </div>
      <button onClick={handleValidate} style={{ padding: '6px 20px' }}>验证</button>
      {error && <div style={{ marginTop: '8px', color: '#ff4d4f' }}>❌ {error}</div>}
      {!error && email && <div style={{ marginTop: '8px', color: '#52c41a' }}>✅ 验证通过</div>}
    </div>
  );
};

export default ChainDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>责任链模式 - 表单验证</h3>
    <div style="margin-bottom: 12px;">
      <label style="display: block; margin-bottom: 4px;">邮箱:</label>
      <input type="text" v-model="email"
        :style="{ padding: '6px', width: '250px', border: error ? '1px solid #ff4d4f' : '1px solid #d9d9d9', borderRadius: '4px' }" />
    </div>
    <button @click="handleValidate" style="padding: 6px 20px;">验证</button>
    <div v-if="error" style="margin-top: 8px; color: #ff4d4f;">❌ {{ error }}</div>
    <div v-else-if="email && validated" style="margin-top: 8px; color: #52c41a;">✅ 验证通过</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface ValidationRule {
  setNext(rule: ValidationRule): ValidationRule;
  validate(value: string): string | null;
}

abstract class BaseRule implements ValidationRule {
  private next: ValidationRule | null = null;
  setNext(rule: ValidationRule): ValidationRule { this.next = rule; return rule; }
  validate(value: string): string | null {
    if (this.next) return this.next.validate(value);
    return null;
  }
}

class RequiredRule extends BaseRule {
  validate(value: string): string | null {
    if (!value || !value.trim()) return '此字段为必填项';
    return super.validate(value);
  }
}

class MinLengthRule extends BaseRule {
  constructor(private min: number) { super(); }
  validate(value: string): string | null {
    if (value.length < this.min) return '最少 ' + this.min + ' 个字符';
    return super.validate(value);
  }
}

class EmailRule extends BaseRule {
  validate(value: string): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '邮箱格式不正确';
    return super.validate(value);
  }
}

const email = ref('');
const error = ref<string | null>(null);
const validated = ref(false);

const buildChain = (): ValidationRule => {
  const required = new RequiredRule();
  const min = new MinLengthRule(3);
  const emailRule = new EmailRule();
  required.setNext(min).setNext(emailRule);
  return required;
};

const handleValidate = () => {
  const chain = buildChain();
  error.value = chain.validate(email.value);
  validated.value = !error.value;
};
</script>
```

### Node.js

```javascript
// 日志级别责任链
enum LogLevel { DEBUG = 1, INFO = 2, WARNING = 3, ERROR = 4 }

abstract class Logger {
  protected level: LogLevel;
  protected next: Logger | null = null;
  constructor(level: LogLevel) { this.level = level; }
  setNext(logger: Logger): Logger { this.next = logger; return logger; }
  log(level: LogLevel, message: string): void {
    if (level >= this.level) this.write(message);
    if (this.next) this.next.log(level, message);
  }
  protected abstract write(message: string): void;
}

class ConsoleLogger extends Logger {
  constructor(level: LogLevel) { super(level); }
  protected write(message: string): void { console.log('[Console]', message); }
}

class FileLogger extends Logger {
  constructor(level: LogLevel) { super(level); }
  protected write(message: string): void { console.log('[File] 写入日志文件:', message); }
}

class EmailLogger extends Logger {
  constructor(level: LogLevel) { super(level); }
  protected write(message: string): void { console.log('[Email] 发送告警邮件:', message); }
}

const consoleLogger = new ConsoleLogger(LogLevel.DEBUG);
const fileLogger = new FileLogger(LogLevel.INFO);
const emailLogger = new EmailLogger(LogLevel.ERROR);

consoleLogger.setNext(fileLogger).setNext(emailLogger);

console.log('=== DEBUG 级别 ===');
consoleLogger.log(LogLevel.DEBUG, '调试信息：变量值为 42');

console.log('\n=== INFO 级别 ===');
consoleLogger.log(LogLevel.INFO, '系统启动完成');

console.log('\n=== WARNING 级别 ===');
consoleLogger.log(LogLevel.WARNING, '内存使用率达到 80%');

console.log('\n=== ERROR 级别 ===');
consoleLogger.log(LogLevel.ERROR, '数据库连接失败！');
```


