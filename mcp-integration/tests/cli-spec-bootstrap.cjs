// CLI: 调用 spec-bootstrap clarify() / plan() / checklist() 并验证 findFeatureDir 生效
// 用法：node cli-spec-bootstrap.cjs <projectRoot> [action=clarify|plan|checklist|tasks]

const path = require('path');
const mod = require('../examples/skills/spec-bootstrap');

(async () => {
  const projectRoot = process.argv[2] || process.cwd();
  const action = process.argv[3] || 'clarify';
  console.log('cli-spec-bootstrap: projectRoot=', projectRoot, 'action=', action);

  const ctx = { projectRoot };
  let result;
  switch (action) {
    case 'clarify':
      result = await mod.clarify(ctx);
      break;
    case 'plan':
      result = await mod.plan(ctx);
      break;
    case 'checklist':
      result = await mod.checklist(ctx);
      break;
    case 'tasks':
      result = await mod.tasks(ctx);
      break;
    default:
      console.error('Unknown action:', action);
      process.exit(2);
  }
  console.log('\n---', action, 'summary: ok=', result.ok, '---');
  if (!result.ok) {
    console.log('ERROR:', result.error);
    process.exit(1);
  }
  if (result.specPath) console.log('specPath:', result.specPath);
  if (result.warnings && result.warnings.length) {
    console.log('warnings:');
    result.warnings.forEach(w => console.log('  -', w));
  }
  if (result.ambiguities) {
    console.log('ambiguities (%d items):', result.ambiguities.length);
    result.ambiguities.forEach((a, i) => {
      const line = typeof a === 'string' ? a : `L${a.line}: ${a.text} [${a.kind}]`;
      console.log(`  A${i+1}. ${line}`);
    });
  }
  if (result.nextActions && result.nextActions.length) {
    console.log('nextActions:');
    result.nextActions.forEach(n => console.log('  -', n));
  }
  // 非 clarify 可能返回 path 字段
  if (result.path) console.log('path:', result.path);
  console.log('\n✅ PASS');
})().catch(e => {
  console.error('FAIL:', e.message, e.stack);
  process.exit(99);
});
