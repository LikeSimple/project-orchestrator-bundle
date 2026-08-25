# Command (命令)

## 概述

将一个请求封装为一个对象，从而使你可用不同的请求对客户进行参数化；对请求排队或记录请求日志，以及支持可撤消的操作。

## 适用场景

- 需要将操作参数化，根据不同的操作来参数化对象
- 需要将操作排队、在不同的时间执行，或者远程执行
- 需要支持撤销操作
- 需要支持事务（操作的原子性）

## 优点

- 单一职责原则：可以解耦触发操作的对象和执行操作的对象
- 开闭原则：可以在不修改现有客户端代码的情况下引入新命令
- 可以实现撤销/重做功能
- 可以将简单命令组合成复杂命令

## 缺点

- 代码可能会变得复杂，因为需要引入许多新的类
- 每一个命令都需要一个具体类，可能导致类爆炸

## 代码示例

### TypeScript

```typescript
interface Command { execute(): void; undo(): void; getName(): string; }

class Light {
  private on = false;
  turnOn(): void { this.on = true; console.log('灯已打开'); }
  turnOff(): void { this.on = false; console.log('灯已关闭'); }
  isOn(): boolean { return this.on; }
}

class LightOnCommand implements Command {
  constructor(private light: Light) {}
  execute(): void { this.light.turnOn(); }
  undo(): void { this.light.turnOff(); }
  getName(): string { return '开灯'; }
}

class LightOffCommand implements Command {
  constructor(private light: Light) {}
  execute(): void { this.light.turnOff(); }
  undo(): void { this.light.turnOn(); }
  getName(): string { return '关灯'; }
}

class RemoteControl {
  private history: Command[] = [];
  press(command: Command): void {
    command.execute();
    this.history.push(command);
  }
  undo(): void {
    const cmd = this.history.pop();
    if (cmd) { console.log('撤销:', cmd.getName()); cmd.undo(); }
    else console.log('无可撤销操作');
  }
  getHistory(): string[] { return this.history.map(c => c.getName()); }
}

const light = new Light();
const remote = new RemoteControl();

const onCmd = new LightOnCommand(light);
const offCmd = new LightOffCommand(light);

remote.press(onCmd);
remote.press(offCmd);
remote.undo();
remote.undo();
remote.undo();
```

### React

```tsx
import React, { useState, useCallback, useRef } from 'react';

interface Command { execute(): void; undo(): void; name: string; }

const useUndoRedo = () => {
  const history = useRef<Command[]>([]);
  const future = useRef<Command[]>([]);
  const [, forceUpdate] = useState(0);

  const execute = useCallback((cmd: Command) => {
    cmd.execute();
    history.current.push(cmd);
    future.current = [];
    forceUpdate(n => n + 1);
  }, []);

  const undo = useCallback(() => {
    const cmd = history.current.pop();
    if (cmd) { cmd.undo(); future.current.push(cmd); forceUpdate(n => n + 1); }
  }, []);

  const redo = useCallback(() => {
    const cmd = future.current.pop();
    if (cmd) { cmd.execute(); history.current.push(cmd); forceUpdate(n => n + 1); }
  }, []);

  return { execute, undo, redo, canUndo: history.current.length > 0, canRedo: future.current.length > 0, history: history.current };
};

const CommandDemo: React.FC = () => {
  const [text, setText] = useState('');
  const { execute, undo, redo, canUndo, canRedo, history } = useUndoRedo();

  const appendText = (str: string) => {
    const prev = text;
    execute({
      name: '追加: ' + str,
      execute: () => setText(prev + str),
      undo: () => setText(prev),
    });
  };

  const clearText = () => {
    const prev = text;
    execute({
      name: '清空',
      execute: () => setText(''),
      undo: () => setText(prev),
    });
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px' }}>
      <h3>命令模式 - 撤销/重做</h3>
      <div style={{ marginBottom: '12px' }}>
        <button onClick={() => appendText('Hello ')} style={{ marginRight: '8px', padding: '4px 12px' }}>追加 Hello</button>
        <button onClick={() => appendText('World! ')} style={{ marginRight: '8px', padding: '4px 12px' }}>追加 World</button>
        <button onClick={clearText} style={{ marginRight: '8px', padding: '4px 12px' }}>清空</button>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <button onClick={undo} disabled={!canUndo} style={{ padding: '4px 12px', marginRight: '8px' }}>撤销</button>
        <button onClick={redo} disabled={!canRedo} style={{ padding: '4px 12px' }}>重做</button>
      </div>
      <div style={{ padding: '12px', border: '1px solid #d9d9d9', borderRadius: '4px', minHeight: '60px', background: '#fafafa' }}>{text || '(空)'}</div>
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>历史: {history.map(h => h.name).join(' → ') || '无'}</div>
    </div>
  );
};

export default CommandDemo;
```

### Vue 3

```tsx
<template>
  <div style="font-family: sans-serif; padding: 20px;">
    <h3>命令模式 - 撤销/重做</h3>
    <div style="margin-bottom: 12px;">
      <button @click="appendText('Hello ')" style="margin-right: 8px; padding: 4px 12px;">追加 Hello</button>
      <button @click="appendText('World! ')" style="margin-right: 8px; padding: 4px 12px;">追加 World</button>
      <button @click="clearText" style="margin-right: 8px; padding: 4px 12px;">清空</button>
    </div>
    <div style="margin-bottom: 12px;">
      <button @click="undo" :disabled="!canUndo" style="padding: 4px 12px; margin-right: 8px;">撤销</button>
      <button @click="redo" :disabled="!canRedo" style="padding: 4px 12px;">重做</button>
    </div>
    <div style="padding: 12px; border: 1px solid #d9d9d9; border-radius: 4px; min-height: 60px; background: #fafafa;">{{ text || '(空)' }}</div>
    <div style="margin-top: 8px; font-size: 12px; color: #666;">历史: {{ historyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface Command { execute(): void; undo(): void; name: string; }

const text = ref('');
const history = ref<Command[]>([]);
const future = ref<Command[]>([]);

const execute = (cmd: Command) => {
  cmd.execute();
  history.value.push(cmd);
  future.value = [];
};

const undo = () => {
  const cmd = history.value.pop();
  if (cmd) { cmd.undo(); future.value.push(cmd); }
};

const redo = () => {
  const cmd = future.value.pop();
  if (cmd) { cmd.execute(); history.value.push(cmd); }
};

const canUndo = computed(() => history.value.length > 0);
const canRedo = computed(() => future.value.length > 0);
const historyText = computed(() => history.value.map(h => h.name).join(' → ') || '无');

const appendText = (str: string) => {
  const prev = text.value;
  execute({ name: '追加: ' + str, execute: () => { text.value = prev + str; }, undo: () => { text.value = prev; } });
};

const clearText = () => {
  const prev = text.value;
  execute({ name: '清空', execute: () => { text.value = ''; }, undo: () => { text.value = prev; } });
};
</script>
```

### Node.js

```javascript
interface Command { execute(): void; undo(): void; getName(): string; }

class TextEditor {
  private content = '';
  getContent(): string { return this.content; }
  setContent(c: string): void { this.content = c; }
  append(text: string): void { this.content += text; }
  delete(count: number): void { this.content = this.content.slice(0, -count); }
}

class AppendCommand implements Command {
  private appended = '';
  constructor(private editor: TextEditor, private text: string) {}
  execute(): void { this.editor.append(this.text); this.appended = this.text; }
  undo(): void { this.editor.delete(this.appended.length); }
  getName(): string { return '追加: ' + this.text; }
}

class DeleteCommand implements Command {
  private deleted = '';
  constructor(private editor: TextEditor, private count: number) {}
  execute(): void {
    const c = this.editor.getContent();
    this.deleted = c.slice(-this.count);
    this.editor.delete(this.count);
  }
  undo(): void { this.editor.append(this.deleted); }
  getName(): string { return '删除 ' + this.count + ' 字符'; }
}

class CommandManager {
  private history: Command[] = [];
  private redoStack: Command[] = [];
  execute(cmd: Command): void { cmd.execute(); this.history.push(cmd); this.redoStack = []; }
  undo(): boolean {
    const cmd = this.history.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }
  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.history.push(cmd);
    return true;
  }
  printHistory(): void { console.log('历史:', this.history.map(c => c.getName()).join(' → ') || '无'); }
}

const editor = new TextEditor();
const manager = new CommandManager();

manager.execute(new AppendCommand(editor, 'Hello'));
manager.execute(new AppendCommand(editor, ' World'));
console.log('内容:', editor.getContent());
manager.printHistory();

manager.undo();
console.log('撤销后:', editor.getContent());

manager.redo();
console.log('重做后:', editor.getContent());

manager.execute(new DeleteCommand(editor, 5));
console.log('删除后:', editor.getContent());
manager.printHistory();
```


