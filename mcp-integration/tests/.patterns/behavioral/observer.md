# Observer (观察者)

## 概述

定义对象间的一种一对多的依赖关系，当一个对象的状态发生改变时，所有依赖于它的对象都得到通知并被自动更新。

## 适用场景

- 当一个抽象模型有两个方面，其中一个方面依赖于另一个方面
- 当对一个对象的改变需要同时改变其它对象，而不知道具体有多少对象有待改变
- 当一个对象必须通知其它对象，而它又不能假定其它对象是谁
- 事件驱动系统、订阅发布模式

## 优点

- 开闭原则：无需修改发布者代码就能引入新的订阅者类
- 可以在运行时建立对象之间的联系
- 支持广播通信，发布者无需知道订阅者的具体信息
- 降低了目标与观察者之间的耦合关系

## 缺点

- 订阅者的通知顺序是随机的
- 如果观察者过多，通知可能会耗时
- 如果观察者和被观察者之间存在循环依赖，可能导致系统崩溃

## 代码示例

### TypeScript

```typescript
interface Observer<T> { update(data: T): void; }

interface Subject<T> {
  attach(observer: Observer<T>): void;
  detach(observer: Observer<T>): void;
  notify(data: T): void;
}

class NewsPublisher implements Subject<string> {
  private observers: Observer<string>[] = [];
  attach(obs: Observer<string>): void { this.observers.push(obs); }
  detach(obs: Observer<string>): void {
    const i = this.observers.indexOf(obs);
    if (i > -1) this.observers.splice(i, 1);
  }
  notify(news: string): void {
    console.log('发布新闻:', news);
    this.observers.forEach(o => o.update(news));
  }
  publishNews(news: string): void { this.notify(news); }
}

class EmailSubscriber implements Observer<string> {
  constructor(private email: string) {}
  update(news: string): void { console.log(`[Email] ${this.email} 收到新闻: ${news}`); }
}

class SMSSubscriber implements Observer<string> {
  constructor(private phone: string) {}
  update(news: string): void { console.log(`[SMS] ${this.phone} 收到新闻: ${news}`); }
}

class AppSubscriber implements Observer<string> {
  constructor(private appId: string) {}
  update(news: string): void { console.log(`[APP] ${this.appId} 收到推送: ${news}`); }
}

const publisher = new NewsPublisher();
const emailObs = new EmailSubscriber('user@example.com');
const smsObs = new SMSSubscriber('13800138000');
const appObs = new AppSubscriber('app-001');

publisher.attach(emailObs);
publisher.attach(smsObs);
publisher.attach(appObs);

publisher.publishNews('重大消息：TypeScript 5.0 发布！');
console.log('---');
publisher.detach(smsObs);
publisher.publishNews('快讯：新版本发布');
```

### React

```tsx
import React, { useState, useEffect, useCallback } from 'react';

// 简单的事件总线
type EventCallback = (data: any) => void;

class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  on(event: string, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }
  off(event: string, cb: EventCallback): void { this.listeners.get(event)?.delete(cb); }
  emit(event: string, data: any): void { this.listeners.get(event)?.forEach(cb => cb(data)); }
}

const bus = new EventBus();

const useEvent = (event: string, cb: EventCallback) => {
  useEffect(() => bus.on(event, cb), [event, cb]);
};

const Sender: React.FC = () => {
  const [msg, setMsg] = useState('');
  const send = () => { if (msg.trim()) { bus.emit('message', msg); setMsg(''); } };
  return (
    <div>
      <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="输入消息" style={{ padding: '4px', width: '200px' }} />
      <button onClick={send} style={{ marginLeft: '8px', padding: '4px 12px' }}>发送</button>
    </div>
  );
};

const Receiver: React.FC<any> = ({ name, color }) => {
  const [msgs, setMsgs] = useState<string[]>([]);
  const handleMsg = useCallback((data: any) => {
    setMsgs(prev => [...prev.slice(-4), data]);
  }, []);
  useEvent('message', handleMsg);
  return (
    <div style={{ marginTop: '12px', padding: '8px', border: `2px solid ${color}`, borderRadius: '4px', minHeight: '80px' }}>
      <div style={{ fontWeight: 'bold', color }}>{name}</div>
      {msgs.map((m, i) => <div key={i} style={{ fontSize: '12px', color: '#666' }}>{m}</div>)}
    </div>
  );
};

const ObserverDemo: React.FC = () => (
  <div style={{ fontFamily: 'sans-serif' }}>
    <h3>观察者模式 - 事件总线</h3>
    <Sender />
    <div style={{ display: 'flex', gap: '16px' }}>
      <Receiver name="组件 A" color="#1890ff" />
      <Receiver name="组件 B" color="#52c41a" />
      <Receiver name="组件 C" color="#fa8c16" />
    </div>
  </div>
);

export default ObserverDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif;">
    <h3>观察者模式 - 事件总线</h3>
    <div>
      <input v-model="msg" placeholder="输入消息" style="padding: 4px; width: 200px;" />
      <button @click="send" style="margin-left: 8px; padding: 4px 12px;">发送</button>
    </div>
    <div style="display: flex; gap: 16px; margin-top: 12px;">
      <Receiver name="组件 A" color="#1890ff" />
      <Receiver name="组件 B" color="#52c41a" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, defineComponent, h } from 'vue';

type EventCallback = (data: any) => void;

class EventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  on(event: string, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }
  off(event: string, cb: EventCallback): void { this.listeners.get(event)?.delete(cb); }
  emit(event: string, data: any): void { this.listeners.get(event)?.forEach(cb => cb(data)); }
}

const bus = new EventBus();

const msg = ref('');
const send = () => { if (msg.value.trim()) { bus.emit('message', msg.value); msg.value = ''; } };

const Receiver = defineComponent({
  name: 'Receiver',
  props: { name: String, color: String },
  setup(props) {
    const msgs = ref<string[]>([]);
    const handleMsg = (data: any) => { msgs.value = [...msgs.value.slice(-4), data]; };
    let unbind: (() => void) | null = null;
    onMounted(() => { unbind = bus.on('message', handleMsg); });
    onUnmounted(() => unbind?.());
    return () =>
      h('div', { style: { padding: '8px', border: '2px solid ' + props.color, borderRadius: '4px', minWidth: '120px', minHeight: '80px' } }, [
        h('div', { style: { fontWeight: 'bold', color: props.color } }, props.name),
        ...msgs.value.map((m, i) => h('div', { key: i, style: { fontSize: '12px', color: '#666' } }, m)),
      ]);
  },
});
</script>
```

### Node.js

```javascript
const EventEmitter = require('events');

class WeatherStation extends EventEmitter {
  private temperature = 25;
  private humidity = 60;
  getTemperature(): number { return this.temperature; }
  getHumidity(): number { return this.humidity; }
  setData(temp: number, hum: number): void {
    this.temperature = temp;
    this.humidity = hum;
    console.log(`[气象站] 数据更新: 温度${temp}°C, 湿度${hum}%`);
    this.emit('dataChanged', { temperature: temp, humidity: hum });
  }
}

class DisplayDevice {
  constructor(private name: string, private station: WeatherStation) {
    station.on('dataChanged', (data: any) => this.update(data));
  }
  update(data: any): void {
    console.log(`[${this.name}] 温度: ${data.temperature}°C, 湿度: ${data.humidity}%`);
  }
}

class AlertSystem {
  constructor(private station: WeatherStation) {
    station.on('dataChanged', (data: any) => this.check(data));
  }
  check(data: any): void {
    if (data.temperature > 35) console.log('[告警] 高温预警！');
    if (data.humidity > 80) console.log('[告警] 高湿预警！');
  }
}

const station = new WeatherStation();
const display1 = new DisplayDevice('客厅显示屏', station);
const display2 = new DisplayDevice('卧室显示屏', station);
const alert = new AlertSystem(station);

console.log('=== 第一次数据更新 ===');
station.setData(28, 65);
console.log('\n=== 第二次数据更新 ===');
station.setData(37, 85);
```


