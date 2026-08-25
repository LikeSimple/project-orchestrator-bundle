# State (状态)

## 概述

允许一个对象在其内部状态改变时改变它的行为。对象看起来似乎修改了它的类。

## 适用场景

- 一个对象的行为取决于它的状态，并且它必须在运行时刻根据状态改变它的行为
- 一个操作中含有庞大的多分支的条件语句，且这些分支依赖于该对象的状态
- 状态转换逻辑复杂，需要将状态和行为封装在一起

## 优点

- 单一职责原则：将与特定状态相关的代码放到单独的类中
- 开闭原则：无需修改已有状态类和上下文就能引入新状态
- 通过消除臃肿的状态机条件语句简化上下文代码
- 状态转换是显式的，更安全

## 缺点

- 如果状态类很少，使用此模式可能会过度设计
- 状态模式的结构可能会比较复杂
- 需要创建许多状态类

## 代码示例

### TypeScript

```typescript
interface OrderState {
        getName(): string;
        pay(order: Order): void;
        cancel(order: Order): void;
        ship(order: Order): void;
        deliver(order: Order): void;
      }

      class Order {
        private state: OrderState;
        constructor(public orderId: string) { this.state = new PendingState(); }
        setState(state: OrderState): void { this.state = state; console.log('订单状态变更为:', state.getName()); }
        getStateName(): string { return this.state.getName(); }
        pay(): void { this.state.pay(this); }
        cancel(): void { this.state.cancel(this); }
        ship(): void { this.state.ship(this); }
        deliver(): void { this.state.deliver(this); }
      }

      class PendingState implements OrderState {
        getName(): string { return '待支付'; }
        pay(order: Order): void { console.log('支付成功'); order.setState(new PaidState()); }
        cancel(order: Order): void { console.log('取消订单'); order.setState(new CancelledState()); }
        ship(): void { console.log('错误：未支付不能发货'); }
        deliver(): void { console.log('错误：未支付不能收货'); }
      }

      class PaidState implements OrderState {
        getName(): string { return '已支付'; }
        pay(): void { console.log('错误：已支付，无需重复支付'); }
        cancel(order: Order): void { console.log('申请退款，订单取消'); order.setState(new CancelledState()); }
        ship(order: Order): void { console.log('商品已发货'); order.setState(new ShippedState()); }
        deliver(): void { console.log('错误：未发货不能收货'); }
      }

      class ShippedState implements OrderState {
        getName(): string { return '已发货'; }
        pay(): void { console.log('错误：已支付'); }
        cancel(): void { console.log('错误：已发货不能取消，请拒收'); }
        ship(): void { console.log('错误：已发货'); }
        deliver(order: Order): void { console.log('确认收货'); order.setState(new DeliveredState()); }
      }

      class DeliveredState implements OrderState {
        getName(): string { return '已完成'; }
        pay(): void { console.log('错误：订单已完成'); }
        cancel(): void { console.log('错误：已完成订单不能取消'); }
        ship(): void { console.log('错误：订单已完成'); }
        deliver(): void { console.log('错误：订单已完成'); }
      }

      class CancelledState implements OrderState {
        getName(): string { return '已取消'; }
        pay(): void { console.log('错误：订单已取消'); }
        cancel(): void { console.log('错误：订单已取消'); }
        ship(): void { console.log('错误：订单已取消'); }
        deliver(): void { console.log('错误：订单已取消'); }
      }

      const order = new Order('ORD-001');
      console.log('初始状态:', order.getStateName());
      order.pay();
      order.ship();
      order.deliver();
      console.log('---');
      const order2 = new Order('ORD-002');
      order2.cancel();
      order2.pay();
```

### React

```tsx
import React, { useState, useCallback } from 'react';

interface TrafficState { name: string; color: string; next(): TrafficState; duration: number; }

const greenState: TrafficState = {
  name: '绿灯', color: '#52c41a', duration: 5,
  next: () => yellowState,
};

const yellowState: TrafficState = {
  name: '黄灯', color: '#faad14', duration: 2,
  next: () => redState,
};

const redState: TrafficState = {
  name: '红灯', color: '#ff4d4f', duration: 5,
  next: () => greenState,
};

const StateDemo: React.FC = () => {
  const [state, setState] = useState<TrafficState>(redState);
  const [countdown, setCountdown] = useState(redState.duration);

  const nextState = useCallback(() => {
    const next = state.next();
    setState(next);
    setCountdown(next.duration);
  }, [state]);

  React.useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    } else {
      nextState();
    }
  }, [countdown, nextState]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', textAlign: 'center' }}>
      <h3>状态模式 - 交通灯</h3>
      <div style={{ display: 'inline-block', padding: '20px', backgroundColor: '#333', borderRadius: '50px' }}>
        {[redState, yellowState, greenState].map(s => (
          <div key={s.name} style={{
            width: '60px', height: '60px', borderRadius: '50%', margin: '10px',
            backgroundColor: state.name === s.name ? s.color : '#555',
            boxShadow: state.name === s.name ? `0 0 20px ${s.color}` : 'none',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>
      <div style={{ marginTop: '16px', fontSize: '24px', fontWeight: 'bold', color: state.color }}>
        {state.name} - {countdown}s
      </div>
      <button onClick={nextState} style={{ marginTop: '16px', padding: '8px 24px' }}>手动切换</button>
    </div>
  );
};

export default StateDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px; text-align: center;">
    <h3>状态模式 - 交通灯</h3>
    <div style="display: inline-block; padding: 20px; background: #333; border-radius: 50px;">
      <div v-for="s in states" :key="s.name" :style="{
        width: '60px', height: '60px', borderRadius: '50%', margin: '10px',
        backgroundColor: state.name === s.name ? s.color : '#555',
        boxShadow: state.name === s.name ? '0 0 20px ' + s.color : 'none',
        transition: 'all 0.3s',
      }"></div>
    </div>
    <div style="margin-top: 16px; font-size: 24px; font-weight: bold;" :style="{ color: state.color }">
      {{ state.name }} - {{ countdown }}s
    </div>
    <button @click="nextState" style="margin-top: 16px; padding: 8px 24px;">手动切换</button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';

interface TrafficState { name: string; color: string; duration: number; next(): TrafficState; }

const greenState: TrafficState = { name: '绿灯', color: '#52c41a', duration: 5, next: () => yellowState };
const yellowState: TrafficState = { name: '黄灯', color: '#faad14', duration: 2, next: () => redState };
const redState: TrafficState = { name: '红灯', color: '#ff4d4f', duration: 5, next: () => greenState };

const states = [redState, yellowState, greenState];
const state = ref<TrafficState>(redState);
const countdown = ref(redState.duration);
let timer: any = null;

const nextState = () => {
  const next = state.value.next();
  state.value = next;
  countdown.value = next.duration;
};

onMounted(() => {
  timer = setInterval(() => {
    if (countdown.value > 0) countdown.value--;
    else nextState();
  }, 1000);
});

onUnmounted(() => { if (timer) clearInterval(timer); });
</script>
```

### Node.js

```javascript
interface MediaState { getName(): string; play(player: MediaPlayer): void; pause(player: MediaPlayer): void; stop(player: MediaPlayer): void; }

class MediaPlayer {
  private state: MediaState;
  constructor(public track: string) { this.state = new StoppedState(); }
  setState(s: MediaState): void { this.state = s; console.log('状态:', s.getName()); }
  getStateName(): string { return this.state.getName(); }
  play(): void { this.state.play(this); }
  pause(): void { this.state.pause(this); }
  stop(): void { this.state.stop(this); }
}

class StoppedState implements MediaState {
  getName(): string { return '停止'; }
  play(p: MediaPlayer): void { console.log('开始播放:', p.track); p.setState(new PlayingState()); }
  pause(): void { console.log('错误：已停止，无法暂停'); }
  stop(): void { console.log('已经是停止状态'); }
}

class PlayingState implements MediaState {
  getName(): string { return '播放中'; }
  play(): void { console.log('已经在播放了'); }
  pause(p: MediaPlayer): void { console.log('暂停播放'); p.setState(new PausedState()); }
  stop(p: MediaPlayer): void { console.log('停止播放'); p.setState(new StoppedState()); }
}

class PausedState implements MediaState {
  getName(): string { return '已暂停'; }
  play(p: MediaPlayer): void { console.log('继续播放'); p.setState(new PlayingState()); }
  pause(): void { console.log('已经是暂停状态'); }
  stop(p: MediaPlayer): void { console.log('停止播放'); p.setState(new StoppedState()); }
}

const player = new MediaPlayer('Song - Artist');
console.log('初始状态:', player.getStateName());

console.log('\n尝试暂停（停止状态）:');
player.pause();

console.log('\n播放:');
player.play();

console.log('\n暂停:');
player.pause();

console.log('\n继续播放:');
player.play();

console.log('\n停止:');
player.stop();
```


