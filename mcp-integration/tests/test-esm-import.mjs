// ESM 动态 import 烟雾测试：模拟 requireLib 逻辑加载两个 lib
// 运行：node test-esm-import.mjs <projectRoot>

import { resolve } from 'path';
import { existsSync } from 'fs';

const projectRoot = process.argv[2] || process.cwd();
const HEALTH_MONITOR_JS = resolve(projectRoot, 'mcp-integration/examples/lib/health-monitor.js');
const STATE_MACHINE_JS = resolve(projectRoot, 'mcp-integration/examples/lib/orchestrator-state-machine.js');

console.log('ESM import sanity check');
console.log('  HM exists:', existsSync(HEALTH_MONITOR_JS), HEALTH_MONITOR_JS);
console.log('  SM exists:', existsSync(STATE_MACHINE_JS), STATE_MACHINE_JS);

// 拷贝自 orchestrator-tools.ts 的 requireLib 实现
async function requireLib(absPath) {
  try {
    const fileUrl = 'file:///' + absPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const ns = await import(fileUrl);
    return ns && ns.default ? ns.default : ns;
  } catch (e) {
    throw new Error(`Failed to load ${absPath}: ${e.message}`);
  }
}

try {
  const hm = await requireLib(HEALTH_MONITOR_JS);
  console.log('  HM loaded OK. keys:', Object.keys(hm).filter(k => typeof hm[k] === 'function').join(', '));
  if (typeof hm.init !== 'function') throw new Error('HM missing init()');
  if (typeof hm.recordEvent !== 'function') throw new Error('HM missing recordEvent()');
  if (typeof hm.checkThresholds !== 'function') throw new Error('HM missing checkThresholds()');
  if (typeof hm.generateDashboard !== 'function') throw new Error('HM missing generateDashboard()');
  console.log('  HM: All 4 required functions present ✓');
} catch (e) {
  console.error('  HM FAIL:', e.message);
  process.exit(1);
}

try {
  const sm = await requireLib(STATE_MACHINE_JS);
  console.log('  SM loaded OK. keys:', Object.keys(sm).filter(k => typeof sm[k] === 'function').join(', '));
  if (typeof sm.init !== 'function') throw new Error('SM missing init()');
  if (typeof sm.status !== 'function') throw new Error('SM missing status()');
  if (typeof sm.next !== 'function') throw new Error('SM missing next()');
  if (typeof sm.transition !== 'function') throw new Error('SM missing transition()');
  console.log('  SM: All 4 required functions present ✓');
  console.log('\nESM dynamic import() compatibility: ALL PASSED ✓');
  process.exit(0);
} catch (e) {
  console.error('  SM FAIL:', e.message, e.stack);
  process.exit(2);
}
