// 冒烟测试：health-monitor + orchestrator-state-machine
// 执行：node smoke-p2.cjs <tmpRoot>
// 退出码：0 = OK

const fs = require('fs');
const path = require('path');

(async () => {
  let exitCode = 0;
  const tmpRoot = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'orch-p2-'));
  if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true });
  console.log('[p2-smoke] tmpRoot =', tmpRoot);

  // ---------- health-monitor ----------
  try {
    console.log('\n=== [1/2] health-monitor ===');
    const hm = require('../examples/lib/health-monitor');
    await hm.init({ projectRoot: tmpRoot });

    const tasks = 12;
    for (let i = 1; i <= tasks; i++) await hm.recordEvent('task.start', { taskId: 'T'+String(i).padStart(3,'0') });
    for (let i = 1; i <= 4; i++) await hm.recordEvent('rollback.exec', { taskId: 'T00'+i, reason: '实现有误' });
    for (let i = 1; i <= 40; i++) await hm.recordEvent('clarify.issue', { taskId: 'T001' });
    for (let i = 1; i <= 12; i++) await hm.recordEvent('complaint.effect', { taskId: 'T00'+((i%4)+1), description: 'bug-'+i });

    const r = await hm.checkThresholds({ scanNpm: false });
    console.log('  check: healthy=%s count=%d', r.healthy, r.count);
    console.log('  summary:', JSON.stringify(r.metricsSummary));
    r.alerts.forEach(a => console.log('  - [%s] %s: %s', a.level, a.code, a.message));
    // 预期：撤销率 4/12≈33% >25%, 澄清比 40/12≈3.3>2.5, 投诉 12>10
    const expectations = [
      ['rollbackRate >0.25', r.metricsSummary.rollbackRate > 0.25],
      ['clarifyPerTask >2.5', r.metricsSummary.clarifyPerTask > 2.5],
      ['complaintPerWeek >=12', r.metricsSummary.complaintPerWeek >= 12],
      ['至少 3 条告警', r.count >= 3],
    ];
    expectations.forEach(([k, ok]) => {
      console.log('   ASSERT %s -> %s', k, ok ? 'PASS' : 'FAIL');
      if (!ok) exitCode = 1;
    });
    const md = await hm.generateDashboard({ format: 'markdown' });
    const html = await hm.generateDashboard({ format: 'html', includePackages: false });
    const json = await hm.generateDashboard({ format: 'json' });
    const weekly = await hm.getWeeklyReport();
    console.log('  md=%d html=%d json=%d weekly=%d', md.length, html.length, json.length, weekly.length);
    console.log('  md.hasTable:', md.includes('| 指标 |'));
    console.log('  weekly.hasRollbackRate:', weekly.includes('撤销率'));
    console.log('  html.has<!DOCTYPE>:', html.startsWith('<!DOCTYPE html>'));

    // stats 辅助
    const s = await hm.stats();
    console.log('  stats totalEvents=%d types=%j', s.totalEvents, s.typeCounts);
  } catch (e) {
    console.error('[HM FAIL]', e.message, e.stack);
    exitCode = 1;
  }

  // ---------- orchestrator-state-machine (空项目) ----------
  try {
    console.log('\n=== [2/2] orchestrator-state-machine (空项目) ===');
    const sm = require('../examples/lib/orchestrator-state-machine');
    await sm.init({ projectRoot: tmpRoot });
    const st0 = await sm.status();
    console.log('  init phase=%s done=%d candidates=%d', st0.currentPhase, st0.completedSteps.length, st0.nextCandidates.length);
    console.log('  phaseProgress:', JSON.stringify(st0.phaseProgress));
    const first = st0.nextCandidates[0];
    console.log('  first candidate: step=%s tool=%s', first ? first.step : null, first ? first.tool : null);
    // 空项目，第一个候选必须是 S01 constitution
    if (!first || first.step !== 'S01') {
      console.log('   FAIL: expected first = S01 constitution');
      exitCode = 1;
    } else {
      console.log('   PASS: first = S01 constitution');
    }
    const nx = await sm.next();
    console.log('  next.recommended:', nx.recommended ? nx.recommended.tool : null);
    console.log('  next.missingPreconditions.length:', nx.missingPreconditions.length);
    // reset
    const tr = await sm.transition({ action: 'reset' });
    console.log('  transition.reset OK:', tr.ok);
    // mark_phase_done 非法 phase 参数 -> 期望报错
    try {
      await sm.transition({ action: 'mark_phase_done' });
      console.log('   FAIL: mark_phase_done 无 phase 应报错');
      exitCode = 1;
    } catch {
      console.log('   PASS: mark_phase_done 无 phase 正常报错');
    }
    // rollback_phase
    const rb = await sm.transition({ action: 'rollback_phase', phase: 2 });
    console.log('  rollback_phase P2 OK:', /回退/.test(rb.message));
  } catch (e) {
    console.error('[SM FAIL]', e.message, e.stack);
    exitCode = 1;
  }

  console.log('\n[p2-smoke] exitCode =', exitCode);
  process.exit(exitCode);
})().catch(e => {
  console.error('[FATAL]', e.message, e.stack);
  process.exit(99);
});
