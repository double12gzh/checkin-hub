#!/usr/bin/env node

/**
 * scripts/verify-commit-msg.js
 *
 * Git commit-msg hook validator for AI Co-Authored-By specification.
 * Enforces "Human Sovereignty + AI Audit" rules across all AI agents and human developers.
 */

const fs = require('fs');

const msgFile = process.argv[2];
if (!msgFile || !fs.existsSync(msgFile)) {
  // If not run via git commit-msg hook, exit cleanly
  process.exit(0);
}

const rawContent = fs.readFileSync(msgFile, 'utf8');
// Remove comment lines (starting with #)
const lines = rawContent
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => !l.startsWith('#') && l.length > 0);

const coAuthorLines = lines.filter((l) => /^co-authored-by:/i.test(l));

if (coAuthorLines.length === 0) {
  // Pure human commit, no AI co-author tag to validate
  process.exit(0);
}

let hasError = false;

// Regex matching: Co-Authored-By: <Name> <<Email>>
const coAuthorRegex = /^co-authored-by:\s+([^<]+?)\s+<([^>]+)>$/i;

// Forbidden model patterns: digits, version numbers, or specific model sub-brands/tiers
const forbiddenDetailPattern =
  /(\d|\b(?:sonnet|haiku|opus|flash|pro|ultra|mini|turbo|thinking|preview|instruct)\b)/i;

// Approved standard broad model names (case-insensitive)
const allowedModels = [
  'gemini',
  'claude',
  'gpt',
  'deepseek',
  'qwen',
  'llama',
  'grok',
  'mistral',
  'copilot',
];

for (const line of coAuthorLines) {
  const match = line.match(coAuthorRegex);
  if (!match) {
    console.error('\n\x1b[31m✖ Git Commit 规范错误：Co-Authored-By 格式不符合要求\x1b[0m');
    console.error(`  当前内容: "${line}"`);
    console.error('  标准格式: Co-Authored-By: <Model> <noreply@...>\n');
    hasError = true;
    continue;
  }

  const [, modelName, email] = match;
  const trimmedModel = modelName.trim();
  const trimmedEmail = email.trim().toLowerCase();

  // 1. Check for forbidden version details
  if (forbiddenDetailPattern.test(trimmedModel)) {
    console.error('\n\x1b[31m✖ Git Commit 规范错误：AI 模型名称严禁携带版本号或冗余细节！\x1b[0m');
    console.error(`  当前填写: "${trimmedModel}"`);
    console.error(
      '  规范要求: 仅使用简明大类名称，如 Gemini、Claude、GPT、DeepSeek 等（严禁携带 3.7、3.8、Sonnet、Flash 等版本后缀）。\n'
    );
    hasError = true;
  }

  // 2. Check if model name belongs to allowed broad categories
  if (!allowedModels.includes(trimmedModel.toLowerCase())) {
    console.warn(
      `\x1b[33m⚠ 提示: 未知或非标准模型大类名称 "${trimmedModel}"，推荐使用: ${allowedModels.join(', ')}\x1b[0m`
    );
  }

  // 3. Check email format: must be noreply@...
  if (!trimmedEmail.startsWith('noreply@')) {
    console.error(
      '\n\x1b[31m✖ Git Commit 规范错误：AI 协同署名邮箱必须使用官方 noreply 邮箱！\x1b[0m'
    );
    console.error(`  当前邮箱: "${trimmedEmail}"`);
    console.error('  推荐官方域名:');
    console.error('    - Claude: noreply@anthropic.com');
    console.error('    - Gemini: noreply@google.com');
    console.error('    - GPT:    noreply@openai.com');
    console.error('    - DeepSeek: noreply@deepseek.com\n');
    hasError = true;
  }
}

if (hasError) {
  console.error('\x1b[33m💡 标准提交模板示例：\x1b[0m');
  console.error(
    'git commit -m "<type>(<scope>): <subject>" \\\n' +
      '  -m "- <变更点 1>\n- <变更点 2>" \\\n' +
      '  -m "Co-Authored-By: Claude <noreply@anthropic.com>"\n'
  );
  process.exit(1);
}

process.exit(0);
