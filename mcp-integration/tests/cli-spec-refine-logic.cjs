// CLI wrapper for spec-userstory-to-design / refineLogic (S10)
// 交互式细化接口内部逻辑
//
// Usage:
//   node cli-spec-refine-logic.cjs <projectRoot> <operationId> [featureCode] [flags...]
//
// Flags:
//   --longTx            启用长事务补偿场景
//   --no-stateful       不生成状态机图
//   --no-multiParty     不生成时序图
//   --no-branching      不生成决策表
//   --feature <name>    覆盖 featureName 显示名
//
// Example:
//   node cli-spec-refine-logic.cjs . createP2 001-test --longTx
//   node cli-spec-refine-logic.cjs . updateP2 001-test --no-stateful

const path = require('path');
const design = require('../examples/skills/spec-userstory-to-design/index.js');

function parseArgs(argv) {
  const projectRoot = argv[2] || process.cwd();
  const operationId = argv[3];
  const featureCode = argv[4] && !argv[4].startsWith('--') ? argv[4] : '001-test';
  const flagStart = argv[4] && argv[4].startsWith('--') ? 4 : 5;

  const complexity = {
    stateful: true,
    multiParty: true,
    branching: true,
    longTx: false,
  };
  let featureName;

  for (let i = flagStart; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--longTx') complexity.longTx = true;
    else if (a === '--no-stateful') complexity.stateful = false;
    else if (a === '--no-multiParty') complexity.multiParty = false;
    else if (a === '--no-branching') complexity.branching = false;
    else if (a === '--feature') featureName = argv[++i];
  }

  return { projectRoot, operationId, featureCode, complexity, featureName };
}

(async () => {
  const args = parseArgs(process.argv);

  if (!args.operationId) {
    console.error('Usage: node cli-spec-refine-logic.cjs <projectRoot> <operationId> [featureCode] [flags]');
    console.error('Flags: --longTx | --no-stateful | --no-multiParty | --no-branching | --feature <name>');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log(' spec-userstory-to-design / refineLogic (S10)');
  console.log('   projectRoot  =', args.projectRoot);
  console.log('   operationId  =', args.operationId);
  console.log('   featureCode  =', args.featureCode);
  console.log('   complexity   =', JSON.stringify(args.complexity));
  if (args.featureName) console.log('   featureName  =', args.featureName);
  console.log('═══════════════════════════════════════════════════════');

  try {
    const result = await design.refineLogic({
      projectRoot: args.projectRoot,
      featureCode: args.featureCode,
      operationId: args.operationId,
      featureName: args.featureName,
      complexity: args.complexity,
    });

    console.log('\n=== refineLogic result ===');
    console.log('ok:', result.ok);
    if (result.error) {
      console.log('error:', result.error);
      process.exit(1);
    }
    console.log('summary:', result.data.summary);
    console.log('outputDir:', result.data.outputDir);
    console.log('file:', result.data.file);
    console.log('scenariosCount:', result.data.scenariosCount);
    console.log('diagrams:', JSON.stringify(result.data.diagrams));
    console.log('warnings:', JSON.stringify(result.warnings || []));
    console.log('nextActions:');
    (result.nextActions || []).forEach(a => console.log('  -', a));
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
