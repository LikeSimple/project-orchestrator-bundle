// CLI 直连 orchestrator-state-machine，输出当前项目编排状态
// 用法：node cli-orchestrator-status.cjs [projectRoot] [action=status|next|recompute]

const path = require('path');
const sm = require('../examples/lib/orchestrator-state-machine');
const hm = require('../examples/lib/health-monitor');

(async () => {
  const projectRoot = process.argv[2] || process.cwd();
  const action = process.argv[3] || 'status';

  console.log('═══════════════════════════════════════════════════════');
  console.log(' project-orchestrator  ·  CLI 编排查询');
  console.log('   projectRoot =', projectRoot);
  console.log('   action      =', action);
  console.log('═══════════════════════════════════════════════════════');

  await sm.init({ projectRoot });

  if (action === 'recompute') {
    const t = await sm.transition({ action: 'recompute' });
    console.log('\n✦ transition.recompute:', t.message);
  }

  const st = await sm.status();

  console.log('\n── 当前编排状态 ──');
  console.log('  当前 Phase  :', st.currentPhase ? `Phase ${st.currentPhase}` : '未启动');
  const allSteps = sm._getStepDefinitions();
  const requiredTotal = allSteps.filter(s => !s.optional).length;
  console.log('  已完成步骤数:', st.completedSteps.length, '/', requiredTotal, '步（必需，不含 optional）');
  const total = { done: 0, total: 0 };
  for (const p of [1,2,3]) {
    const progress = st.phaseProgress[p];
    if (!progress) continue;
    total.done += progress.done; total.total += progress.total;
    const flag = st.phaseDone[p] ? '  ✅ COMPLETED' : '';
    console.log(`  Phase ${p}   : ${progress.done}/${progress.total}  (${progress.pct}%)${flag}`);
  }
  const pct = total.total ? Math.round(total.done * 100 / total.total) : 0;
  console.log('  总体进度    :', pct + '%');

  if (st.completedSteps.length > 0) {
    console.log('\n── 已完成步骤 ──');
    const steps = allSteps;
    st.completedSteps.forEach((id, i) => {
      const s = steps.find(x => x.id === id);
      console.log(`  ${String(i+1).padStart(2,' ')}. ${id}  ${s ? s.label : ''}  [Phase ${s?.phase}]`);
    });
  }

  console.log('\n── 下一步候选 (nextCandidates) ──');
  if (st.nextCandidates.length === 0) {
    console.log('  ✅ 全部步骤已完成，或后续步骤前置不满足');
  } else {
    st.nextCandidates.forEach((c, i) => {
      const prefix = i === 0 ? '🔹 推荐' : '  ·备选';
      console.log(`  ${prefix} ${c.step} ${c.label}${c.optional ? ' (按需)' : ''}`);
      console.log(`         MCP Tool → ${c.tool}`);
      console.log(`         原因: ${c.reason}`);
    });
  }

  const nx = await sm.next();
  console.log('\n── next() 综合推荐 ──');
  console.log('  Recommended   :', nx.recommended ? `${nx.recommended.step} → ${nx.recommended.tool}` : '(无)');
  if (nx.missingPreconditions && nx.missingPreconditions.length) {
    console.log('  缺失前置条件  :');
    nx.missingPreconditions.forEach(m => console.log('    -', m));
  } else {
    console.log('  缺失前置条件  : 无（推荐步骤可直接执行）');
  }
  if (nx.nextActions && nx.nextActions.length) {
    console.log('  nextActions:');
    nx.nextActions.forEach(a => console.log('    -', a));
  }

  // 附带健康度快速检查（scanNpm=false，避免耗时）
  console.log('\n── 健康度概览 (scanNpm=false) ──');
  await hm.init({ projectRoot });
  const hc = await hm.checkThresholds({ scanNpm: false });
  console.log('  状态     :', hc.healthy ? '✅ 健康' : `⚠️  ${hc.count} 条告警`);
  console.log('  指标     :', JSON.stringify(hc.metricsSummary));
  if (hc.alerts.length > 0) {
    hc.alerts.forEach(a => console.log(`    [${a.level.toUpperCase()}] ${a.code}: ${a.message}`));
  }
  console.log('  (完整仪表盘请调用 health_monitor_dashboard，或传入 scanNpm=true 扫描 npm outdated)');
})().catch(e => {
  console.error('FAIL:', e.message, '\n', e.stack);
  process.exit(1);
});
