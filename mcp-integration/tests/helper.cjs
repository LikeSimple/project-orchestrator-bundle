const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

const SKILLS_DIR = path.join(__dirname, '..', 'examples', 'skills');

function loadSkill(name) {
  return require(path.join(SKILLS_DIR, name, 'index.js'));
}

function assertStdResult(result, { okExpected = true } = {}) {
  assert.strictEqual(typeof result, 'object', 'result should be an object');
  if (okExpected !== null && typeof result.ok !== 'undefined') {
    assert.strictEqual(result.ok, okExpected, `result.ok should be ${okExpected}`);
  }
  assert.ok(result.error === null || result.error === undefined || typeof result.error === 'string', 'result.error should be string, null, or undefined');
  assert.ok(result.data === null || result.data === undefined || typeof result.data === 'object', 'result.data should be object, null, or undefined');
  if (result.warnings !== undefined) assert.ok(Array.isArray(result.warnings), 'result.warnings should be array');
  if (result.nextActions !== undefined) assert.ok(Array.isArray(result.nextActions), 'result.nextActions should be array');
  if (result.data && typeof result.data === 'object') {
    if (result.data.llmEnhanced !== undefined) {
      assert.strictEqual(typeof result.data.llmEnhanced, 'boolean', 'data.llmEnhanced should be boolean');
    }
    if (result.data.llmProvider !== undefined) {
      assert.ok(result.data.llmProvider === null || typeof result.data.llmProvider === 'string', 'data.llmProvider should be string or null');
    }
  }
}

async function withTempDir(fn) {
  const dir = path.join(os.tmpdir(), `po-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { loadSkill, assertStdResult, withTempDir, SKILLS_DIR };
