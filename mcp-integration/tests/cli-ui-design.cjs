// CLI wrapper for ui-design Skill
// Usage: node cli-ui-design.cjs <projectRoot> [generate|adjust|audit]

const path = require('path');
const uiDesign = require('../examples/skills/ui-design/index.js');

const projectRoot = process.argv[2] || process.cwd();
const action = process.argv[3] || 'generate';

(async () => {
  try {
    let result;
    if (action === 'generate') {
      result = await uiDesign.generate({
        featureName: 'P2-修复-编排推进',
        pageCount: 1,
        projectRoot
      });
    } else if (action === 'adjust') {
      result = await uiDesign.adjust({
        instruction: 'Generate initial prototype',
        filePath: path.join(projectRoot, 'prototype', 'index.html'),
        autoApply: true,
        projectRoot
      });
    } else if (action === 'audit') {
      result = await uiDesign.audit({
        htmlFile: path.join(projectRoot, 'prototype', 'index.html'),
        projectRoot
      });
    } else {
      console.error('Unknown action:', action);
      console.error('Usage: node cli-ui-design.cjs <projectRoot> [generate|adjust|audit]');
      process.exit(1);
    }

    console.log('=== ui-design', action, 'result ===');
    console.log('ok:', result.ok);
    console.log('path:', result.path || 'N/A');
    console.log('warnings:', JSON.stringify(result.warnings || []));
    if (result.errors) console.log('errors:', JSON.stringify(result.errors));
    if (result.data) console.log('data keys:', Object.keys(result.data));
    if (result.nextActions) console.log('nextActions:', JSON.stringify(result.nextActions));
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
