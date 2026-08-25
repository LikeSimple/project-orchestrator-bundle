# Strategy (策略)

## 概述

定义一系列的算法，把它们一个个封装起来，并且使它们可相互替换。本模式使得算法可独立于使用它的客户而变化。

## 适用场景

- 许多相关的类仅仅是行为有异
- 需要使用一个算法的不同变体
- 算法使用客户不应该知道的数据
- 一个类定义了多种行为，并且这些行为在这个类的操作中以多个条件语句的形式出现

## 优点

- 你可以在运行时切换算法
- 你可以将算法的实现和使用算法的代码隔离开来
- 你可以用组合来代替继承
- 开闭原则：无需修改上下文就可以引入新的策略

## 缺点

- 如果算法极少发生改变，那么使用该模式可能会增加复杂度
- 客户端必须知道所有的策略类，并自行决定使用哪一个
- 很多现代编程语言支持函数式编程，可以直接传递函数来实现相同的效果

## 代码示例

### TypeScript

```typescript
interface SortStrategy { sort<T>(data: T[]): T[]; }

class BubbleSort implements SortStrategy {
  sort<T>(data: T[]): T[] {
    const arr = [...data];
    const n = arr.length;
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < n - i - 1; j++)
        if (arr[j] > arr[j + 1]) [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    console.log('使用冒泡排序');
    return arr;
  }
}

class QuickSort implements SortStrategy {
  sort<T>(data: T[]): T[] {
    const arr = [...data];
    const qs = (a: T[], l: number, r: number): void => {
      if (l >= r) return;
      const pivot = a[r];
      let i = l - 1;
      for (let j = l; j < r; j++) if (a[j] < pivot) { i++; [a[i], a[j]] = [a[j], a[i]]; }
      [a[i + 1], a[r]] = [a[r], a[i + 1]];
      qs(a, l, i); qs(a, i + 2, r);
    };
    qs(arr, 0, arr.length - 1);
    console.log('使用快速排序');
    return arr;
  }
}

class Sorter {
  private strategy: SortStrategy;
  constructor(strategy: SortStrategy) { this.strategy = strategy; }
  setStrategy(strategy: SortStrategy): void { this.strategy = strategy; }
  sort<T>(data: T[]): T[] { return this.strategy.sort(data); }
}

const smallData = [5, 2, 8, 1, 9];
const largeData = Array.from({ length: 100 }, () => Math.floor(Math.random() * 1000));

const sorter = new Sorter(new BubbleSort());
console.log('小数据量:', sorter.sort(smallData));

sorter.setStrategy(new QuickSort());
const result = sorter.sort(largeData);
console.log('大数据量 (前5个):', result.slice(0, 5));
```

### React

```tsx
import React, { useState } from 'react';

interface PaymentStrategy {
  pay(amount: number): { success: boolean; message: string };
  name: string;
}

const alipayStrategy: PaymentStrategy = {
  name: '支付宝',
  pay(amount) {
    if (amount <= 0) return { success: false, message: '金额无效' };
    return { success: true, message: `支付宝支付 ¥${amount} 成功` };
  },
};

const wechatStrategy: PaymentStrategy = {
  name: '微信支付',
  pay(amount) {
    if (amount <= 0) return { success: false, message: '金额无效' };
    return { success: true, message: `微信支付 ¥${amount} 成功` };
  },
};

const bankStrategy: PaymentStrategy = {
  name: '银行卡',
  pay(amount) {
    if (amount > 5000) return { success: false, message: '超出单笔限额' };
    return { success: true, message: `银行卡支付 ¥${amount} 成功` };
  },
};

const StrategyDemo: React.FC = () => {
  const [amount, setAmount] = useState(100);
  const [strategy, setStrategy] = useState<PaymentStrategy>(alipayStrategy);
  const [result, setResult] = useState('');
  const strategies = [alipayStrategy, wechatStrategy, bankStrategy];

  const handlePay = () => {
    const r = strategy.pay(amount);
    setResult(r.success ? '✅ ' + r.message : '❌ ' + r.message);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>策略模式 - 支付方式</h3>
      <div style={{ marginBottom: '12px' }}>
        金额: <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} style={{ padding: '4px', width: '100px' }} /> 元
      </div>
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
        {strategies.map(s => (
          <button key={s.name} onClick={() => setStrategy(s)}
            style={{ padding: '8px 16px', border: strategy.name === s.name ? '2px solid #1890ff' : '1px solid #d9d9d9', borderRadius: '4px', cursor: 'pointer' }}>{s.name}</button>
        ))}
      </div>
      <button onClick={handlePay} style={{ padding: '8px 24px', backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>支付</button>
      {result && <div style={{ marginTop: '12px', padding: '8px', background: '#f5f5f5', borderRadius: '4px' }}>{result}</div>}
    </div>
  );
};

export default StrategyDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>策略模式 - 支付方式</h3>
    <div style="margin-bottom: 12px;">
      金额: <input type="number" v-model.number="amount" style="padding: 4px; width: 100px;" /> 元
    </div>
    <div style="margin-bottom: 12px; display: flex; gap: 8px;">
      <button v-for="s in strategies" :key="s.name" @click="setStrategy(s)"
        :style="{ padding: '8px 16px', border: strategy.name === s.name ? '2px solid #1890ff' : '1px solid #d9d9d9', borderRadius: '4px', cursor: 'pointer' }">{{ s.name }}</button>
    </div>
    <button @click="handlePay" style="padding: 8px 24px; background: #1890ff; color: #fff; border: none; border-radius: 4px; cursor: pointer;">支付</button>
    <div v-if="result" style="margin-top: 12px; padding: 8px; background: #f5f5f5; border-radius: 4px;">{{ result }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';

interface PaymentStrategy {
  pay(amount: number): { success: boolean; message: string };
  name: string;
}

const alipayStrategy: PaymentStrategy = {
  name: '支付宝',
  pay(amount) { return amount > 0 ? { success: true, message: '支付宝支付 ¥' + amount + ' 成功' } : { success: false, message: '金额无效' }; },
};
const wechatStrategy: PaymentStrategy = {
  name: '微信支付',
  pay(amount) { return amount > 0 ? { success: true, message: '微信支付 ¥' + amount + ' 成功' } : { success: false, message: '金额无效' }; },
};
const bankStrategy: PaymentStrategy = {
  name: '银行卡',
  pay(amount) { return amount <= 5000 ? { success: true, message: '银行卡支付 ¥' + amount + ' 成功' } : { success: false, message: '超出单笔限额' }; },
};

const amount = ref(100);
const strategy = ref<PaymentStrategy>(alipayStrategy);
const result = ref('');
const strategies = [alipayStrategy, wechatStrategy, bankStrategy];
const setStrategy = (s: PaymentStrategy) => { strategy.value = s; };
const handlePay = () => {
  const r = strategy.value.pay(amount.value);
  result.value = r.success ? '✅ ' + r.message : '❌ ' + r.message;
};
</script>
```

### Node.js

```javascript
interface CompressionStrategy { compress(file: string): string; decompress(file: string): string; name: string; }

class ZipStrategy implements CompressionStrategy {
  name = 'ZIP';
  compress(file: string): string { console.log('使用 ZIP 压缩:', file); return file + '.zip'; }
  decompress(file: string): string { console.log('使用 ZIP 解压:', file); return file.replace('.zip', ''); }
}

class GzipStrategy implements CompressionStrategy {
  name = 'GZIP';
  compress(file: string): string { console.log('使用 GZIP 压缩:', file); return file + '.gz'; }
  decompress(file: string): string { console.log('使用 GZIP 解压:', file); return file.replace('.gz', ''); }
}

class TarStrategy implements CompressionStrategy {
  name = 'TAR';
  compress(file: string): string { console.log('使用 TAR 打包:', file); return file + '.tar'; }
  decompress(file: string): string { console.log('使用 TAR 解包:', file); return file.replace('.tar', ''); }
}

class Compressor {
  private strategy: CompressionStrategy;
  constructor(strategy: CompressionStrategy) { this.strategy = strategy; }
  setStrategy(strategy: CompressionStrategy): void { this.strategy = strategy; }
  compress(file: string): string { return this.strategy.compress(file); }
  decompress(file: string): string { return this.strategy.decompress(file); }
}

const compressor = new Compressor(new ZipStrategy());
console.log('当前策略:', compressor['strategy'].name);
let f = compressor.compress('document.txt');
console.log('压缩后:', f);

compressor.setStrategy(new GzipStrategy());
console.log('\n切换策略:', compressor['strategy'].name);
f = compressor.compress('data.json');
console.log('压缩后:', f);

compressor.setStrategy(new TarStrategy());
console.log('\n切换策略:', compressor['strategy'].name);
f = compressor.compress('photos');
console.log('打包后:', f);
```


