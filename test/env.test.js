const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadEnv } = require('../core/env');

test('EnvLoader (core/env.js)', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('loads key-value pairs and strips quotes', () => {
    const envFile = path.join(tmpDir, '.env');
    const content = [
      '# Comment line',
      'TEST_KEY_ONE="quoted_val"',
      "TEST_KEY_TWO='single_quoted'",
      'TEST_KEY_THREE=raw_val',
      '   TEST_KEY_FOUR  =   spaced_val   ',
      '',
    ].join('\n');
    fs.writeFileSync(envFile, content);

    loadEnv(envFile);

    assert.equal(process.env.TEST_KEY_ONE, 'quoted_val');
    assert.equal(process.env.TEST_KEY_TWO, 'single_quoted');
    assert.equal(process.env.TEST_KEY_THREE, 'raw_val');
    assert.equal(process.env.TEST_KEY_FOUR, 'spaced_val');
  });

  await t.test('does not overwrite already existing environment variables', () => {
    process.env.EXISTING_VAR = 'original_value';
    const envFile = path.join(tmpDir, '.env.override');
    fs.writeFileSync(envFile, 'EXISTING_VAR=new_value');

    loadEnv(envFile);

    assert.equal(process.env.EXISTING_VAR, 'original_value');
  });

  await t.test('gracefully handles missing env file without throwing', () => {
    assert.doesNotThrow(() => {
      loadEnv('/non/existent/path/.env.none');
    });
  });
});
