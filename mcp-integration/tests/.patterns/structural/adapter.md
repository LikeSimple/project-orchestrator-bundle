# Adapter (适配器)

## 概述

将一个类的接口转换成客户希望的另外一个接口。适配器模式使得原本由于接口不兼容而不能一起工作的那些类可以一起工作。

## 适用场景

- 你想使用一个已经存在的类，而它的接口不符合你的需求
- 你想创建一个可以复用的类，该类可以与其他不相关的类或不可预见的类协同工作
- 你需要使用一些现存的子类，但是对每一个都进行子类化以匹配它们的接口是不现实的

## 优点

- 单一职责原则：可以将接口或数据转换代码从程序主要业务逻辑中分离
- 开闭原则：只要客户端代码通过客户端接口与适配器进行交互，就能在不修改现有客户端代码的情况下在程序中添加新类型的适配器

## 缺点

- 代码整体复杂度增加，因为需要新增一系列接口和类
- 有时直接更改服务类使其与其他代码兼容会更简单

## 代码示例

### TypeScript

```typescript
// 目标接口
interface MediaPlayer { play(audioType: string, filename: string): void; }

// 被适配者
interface AdvancedMediaPlayer {
  playVlc(filename: string): void;
  playMp4(filename: string): void;
}

class VlcPlayer implements AdvancedMediaPlayer {
  playVlc(filename: string): void { console.log('Playing vlc:', filename); }
  playMp4(filename: string): void {}
}

class Mp4Player implements AdvancedMediaPlayer {
  playVlc(filename: string): void {}
  playMp4(filename: string): void { console.log('Playing mp4:', filename); }
}

// 适配器
class MediaAdapter implements MediaPlayer {
  private player: AdvancedMediaPlayer;
  constructor(audioType: string) {
    if (audioType === 'vlc') this.player = new VlcPlayer();
    else if (audioType === 'mp4') this.player = new Mp4Player();
    else throw new Error('Unsupported type');
  }
  play(audioType: string, filename: string): void {
    if (audioType === 'vlc') this.player.playVlc(filename);
    else if (audioType === 'mp4') this.player.playMp4(filename);
  }
}

// 客户端
class AudioPlayer implements MediaPlayer {
  private adapter: MediaAdapter | null = null;
  play(audioType: string, filename: string): void {
    if (audioType === 'mp3') console.log('Playing mp3:', filename);
    else if (audioType === 'vlc' || audioType === 'mp4') {
      this.adapter = new MediaAdapter(audioType);
      this.adapter.play(audioType, filename);
    } else console.log('Invalid format');
  }
}

const player = new AudioPlayer();
player.play('mp3', 'song.mp3');
player.play('mp4', 'video.mp4');
player.play('vlc', 'movie.vlc');
```

### React

```tsx
import React from 'react';

// 旧组件（被适配者）
const OldButton: React.FC<any> = ({ label, onClickHandler }) => (
  <button onClick={onClickHandler} style={{ padding: '10px 20px', background: '#eee', border: '1px solid #ccc', cursor: 'pointer' }}>
    {label}
  </button>
);

// 适配器组件（新接口）
interface ButtonProps {
  text: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}

const ButtonAdapter: React.FC<ButtonProps> = ({ text, onPress, variant = 'primary' }) => {
  const styledLabel = variant === 'primary' ? `[Primary] ${text}` : `[Secondary] ${text}`;
  return <OldButton label={styledLabel} onClickHandler={onPress} />;
};

// 使用
const AdapterDemo: React.FC = () => (
  <div style={{ display: 'flex', gap: 10 }}>
    <ButtonAdapter text="点击我" onPress={() => alert('Primary')} variant="primary" />
    <ButtonAdapter text="取消" onPress={() => alert('Secondary')} variant="secondary" />
  </div>
);

export default AdapterDemo;
```

### Vue 3

```tsx
<template>
  <div style="display: flex; gap: 10px;">
    <ButtonAdapter text="点击我" :on-press="handlePrimary" variant="primary" />
    <ButtonAdapter text="取消" :on-press="handleSecondary" variant="secondary" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue';

const OldButton = defineComponent({
  name: 'OldButton',
  props: { label: String, onClickHandler: Function },
  setup(props) {
    return () => h('button', {
      onClick: props.onClickHandler,
      style: { padding: '10px 20px', background: '#eee', border: '1px solid #ccc', cursor: 'pointer' },
    }, props.label);
  },
});

const ButtonAdapter = defineComponent({
  name: 'ButtonAdapter',
  props: { text: String, onPress: Function, variant: { type: String, default: 'primary' } },
  setup(props) {
    const label = computed(() =>
      props.variant === 'primary' ? `[Primary] ${props.text}` : `[Secondary] ${props.text}`
    );
    return () => h(OldButton, { label: label.value, onClickHandler: props.onPress });
  },
});

const handlePrimary = () => alert('Primary');
const handleSecondary = () => alert('Secondary');
</script>
```

### Node.js

```javascript
// 目标接口
interface PaymentProcessor {
  pay(amount: number): void;
  refund(txId: string, amount: number): void;
}

// 被适配者（第三方SDK）
class ThirdPartyPayment {
  makePayment(amount: number, currency: string): string {
    console.log(`ThirdParty: Pay ${amount} ${currency}`);
    return 'txn_' + Date.now();
  }
  makeRefund(txId: string, amount: number): boolean {
    console.log(`ThirdParty: Refund ${amount}, tx: ${txId}`);
    return true;
  }
}

// 适配器
class PaymentAdapter implements PaymentProcessor {
  private thirdParty: ThirdPartyPayment;
  private currency: string;
  constructor(currency = 'CNY') {
    this.thirdParty = new ThirdPartyPayment();
    this.currency = currency;
  }
  pay(amount: number): void {
    const txId = this.thirdParty.makePayment(amount, this.currency);
    console.log('支付成功，交易号:', txId);
  }
  refund(txId: string, amount: number): void {
    const success = this.thirdParty.makeRefund(txId, amount);
    console.log('退款结果:', success ? '成功' : '失败');
  }
}

const payment: PaymentProcessor = new PaymentAdapter('CNY');
payment.pay(100);
payment.refund('txn_123', 50);
```


