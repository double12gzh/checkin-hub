const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const scriptPath = path.resolve(__dirname, '../scripts/verify-commit-msg.js');

function runValidator(content) {
  const tmpFile = path.join(
    os.tmpdir(),
    `test-commit-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );
  fs.writeFileSync(tmpFile, content);

  try {
    cp.execSync(`node "${scriptPath}" "${tmpFile}"`, { stdio: 'pipe' });
    return { exitCode: 0 };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stderr: err.stderr ? err.stderr.toString() : '',
      stdout: err.stdout ? err.stdout.toString() : '',
    };
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}

test('verify-commit-msg.js Audit Harness', async (t) => {
  await t.test('passes pure human commits without Co-Authored-By', () => {
    const res = runValidator('feat(core): add new feature\n\n- change 1\n- change 2');
    assert.equal(res.exitCode, 0);
  });

  await t.test('passes valid broad-model AI Co-Authored-By commits', () => {
    const validSamples = [
      'fix(core): fix issue\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      'docs: update guide\n\nCo-Authored-By: Gemini <noreply@google.com>',
      'refactor: clean code\n\nCo-Authored-By: GPT <noreply@openai.com>',
      'style: format files\n\nCo-Authored-By: DeepSeek <noreply@deepseek.com>',
      'feat: new stuff\n\nCo-Authored-By: Qwen <noreply@aliyun.com>',
    ];

    for (const msg of validSamples) {
      const res = runValidator(msg);
      assert.equal(res.exitCode, 0, `Failed for valid msg: ${msg}`);
    }
  });

  await t.test('rejects commits with model version numbers or sub-brands', () => {
    const invalidSamples = [
      'fix: test\n\nCo-Authored-By: Claude 3.7 Sonnet <noreply@anthropic.com>',
      'fix: test\n\nCo-Authored-By: Claude 3.5 Haiku <noreply@anthropic.com>',
      'fix: test\n\nCo-Authored-By: Gemini 3.8 Flash <noreply@google.com>',
      'fix: test\n\nCo-Authored-By: GPT-4o <noreply@openai.com>',
      'fix: test\n\nCo-Authored-By: DeepSeek-V3 <noreply@deepseek.com>',
    ];

    for (const msg of invalidSamples) {
      const res = runValidator(msg);
      assert.equal(res.exitCode, 1, `Expected rejection for: ${msg}`);
      assert.match(res.stderr, /严禁携带版本号或冗余细节/);
    }
  });

  await t.test('rejects non-noreply email addresses', () => {
    const res = runValidator('fix: test\n\nCo-Authored-By: Claude <claude@anthropic.com>');
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /必须使用官方 noreply 邮箱/);
  });
});
