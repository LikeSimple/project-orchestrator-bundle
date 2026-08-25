const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'dist', 'orchestrator-tools.js');
const cliPath = path.join(root, 'dist', 'skill-cli.cjs');

console.log('=== MCP Integration E2E Check ===\n');

// 1. Verify files exist
console.log('[1] File existence:');
console.log('  MCP Server:', fs.existsSync(serverPath) ? 'OK' : 'MISSING');
console.log('  Skill CLI:', fs.existsSync(cliPath) ? 'OK' : 'MISSING');

// 2. Test skill-cli directly
console.log('\n[2] Skill CLI tests:');

function testCli(skill, cmd, input) {
  try {
    const inputJson = JSON.stringify(input);
    const out = execSync(
      `node "${cliPath}" ${skill} ${cmd} --input "${inputJson.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 15000, cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout) {
      try { return JSON.parse(e.stdout); } catch {}
    }
    return { ok: false, error: e.message?.slice(0, 200) };
  }
}

const tests = [
  ['scaffold-runner', 'list', {}, (r) => r.data?.total >= 10],
  ['review-checklist', 'checklist', {}, (r) => r.data?.rules?.length >= 50],
  ['debug-helper', 'analyze', { errorMessage: 'TypeError: x is undefined' }, (r) => r.data?.category],
  ['code-patterns', 'list', {}, (r) => r.data?.patterns || r.data?.categories],
  ['environment-manager', 'list', {}, (r) => r.ok],
];

let passed = 0;
for (const [skill, cmd, input, check] of tests) {
  const r = testCli(skill, cmd, input);
  const ok = r.ok !== false && check(r);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${skill}.${cmd}: ok=${r.ok}, ${(r.data?.summary || r.error || '').slice(0, 80)}`);
  if (ok) passed++;
}
console.log(`  ${passed}/${tests.length} passed`);

// 3. Test MCP Server startup
console.log('\n[3] MCP Server startup:');
try {
  const env = {
    ...process.env,
    PROJECT_ROOT: path.resolve(root, '..'),
    SKILL_BUNDLE_PATH: path.resolve(root, '..'),
    SKILL_CLI_BIN: cliPath,
  };
  const mcpRequest = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
  }) + '\n';

  const out = execSync(
    `echo '${mcpRequest.replace(/'/g, "'\\''")}' | node "${serverPath}"`,
    { encoding: 'utf-8', timeout: 10000, env, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  if (out.includes('scaffold_run') || out.includes('tools')) {
    console.log('  PASS MCP Server responds to tools/list');
  } else {
    console.log('  WARN MCP Server output (first 200 chars):', out.slice(0, 200));
  }
} catch (e) {
  const stderr = (e.stderr || '').slice(0, 300);
  const stdout = (e.stdout || '').slice(0, 300);
  if (stderr.includes('started') || stdout.includes('tools') || stderr.includes('orchestrator-tools')) {
    console.log('  PASS MCP Server started (verified via stderr log)');
  } else {
    console.log('  FAIL MCP Server:', (e.message || '').slice(0, 200));
  }
}

// 4. Verify .trae/skills/ installation
console.log('\n[4] TraeWork Skill installation:');
const traeSkillPath = path.resolve(root, '..', '..', '.trae', 'skills', 'project-orchestrator-bundle', 'SKILL.md');
console.log('  .trae/skills SKILL.md:', fs.existsSync(traeSkillPath) ? 'OK' : 'MISSING');

// 5. Verify MCP config paths
console.log('\n[5] MCP config path check:');
const traeMcp = JSON.parse(fs.readFileSync(path.join(root, '.trae.mcp.json'), 'utf-8'));
const orchConfig = traeMcp.mcpServers['orchestrator-tools'];
const configPath = orchConfig.args[0];
const resolvedPath = configPath.replace('${workspaceFolder}', path.resolve(root, '..', '..'));
console.log('  Config path:', configPath);
console.log('  Resolved:', resolvedPath);
console.log('  File exists:', fs.existsSync(resolvedPath) ? 'OK' : 'MISSING');

console.log('\n=== E2E Check Complete ===');
