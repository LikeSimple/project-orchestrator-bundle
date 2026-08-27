// CLI wrapper for spec-userstory-to-design Skill (S09)
// Usage: node cli-spec-userstory-to-design.cjs <projectRoot> [generate|validate]

const path = require('path');
const design = require('../examples/skills/spec-userstory-to-design/index.js');

const projectRoot = process.argv[2] || process.cwd();
const action = process.argv[3] || 'generate';

(async () => {
  try {
    let result;
    if (action === 'generate') {
      result = await design.generate({
        projectRoot,
        featureName: 'P2-修复-编排推进',
        featureCode: '001-test',
        specFile: path.join('specs', '001-test', 'spec.md'),
        prototypeFile: path.join('prototype', 'index.html'),
        format: 'all'
      });
    } else if (action === 'validate') {
      result = await design.validate({
        projectRoot,
        designDir: path.join('docs', 'design', '001-test'),
        strict: false
      });
    } else {
      console.error('Unknown action:', action);
      console.error('Usage: node cli-spec-userstory-to-design.cjs <projectRoot> [generate|validate]');
      process.exit(1);
    }

    console.log('=== spec-userstory-to-design', action, 'result ===');
    console.log('ok:', result.ok);
    if (result.error) console.log('error:', result.error);
    if (result.data) {
      console.log('data.summary:', result.data.summary);
      console.log('data.outputDir:', result.data.outputDir);
      console.log('data.pagesCount:', result.data.pagesCount);
      console.log('data.storiesCount:', result.data.storiesCount);
      console.log('data.pageSource:', result.data.pageSource);
      console.log('data.llmEnhanced:', result.data.llmEnhanced);
      console.log('data.prototypeUsed:', result.data.prototypeUsed);
      console.log('data.files:');
      (result.data.files || []).forEach(f => console.log('  -', f));
    }
    console.log('warnings:', JSON.stringify(result.warnings || []));
    if (result.nextActions) {
      console.log('nextActions:');
      result.nextActions.forEach(a => console.log('  -', a));
    }
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
