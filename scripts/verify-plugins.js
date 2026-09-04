#!/usr/bin/env node

/**
 * scripts/verify-plugins.js
 *
 * Automated verification script enforcing Checkin-Hub architecture contracts,
 * plugin interface standards, and static anti-pattern prevention for AI agents
 * and human developers.
 */

const fs = require('fs');
const path = require('path');
const { BasePlugin } = require('../core/base-plugin');
const { PluginLoader } = require('../core/plugin-loader');

const ROOT_DIR = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins');

let hasError = false;

function logPass(msg) {
  console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
}

function logFail(msg) {
  console.error(`  \x1b[31m✖\x1b[0m ${msg}`);
  hasError = true;
}

function logWarn(msg) {
  console.warn(`  \x1b[33m⚠\x1b[0m ${msg}`);
}

console.log('\n🔍 [1/3] Validating Plugin Interface Contracts...');

const pluginFiles = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.js'));
if (pluginFiles.length === 0) {
  logFail('No plugin files found in plugins/');
}

for (const file of pluginFiles) {
  const filePath = path.join(PLUGINS_DIR, file);
  const relPath = path.relative(ROOT_DIR, filePath);
  console.log(`\n• Checking ${relPath}:`);

  let PluginClass;
  try {
    PluginClass = require(filePath);
  } catch (err) {
    logFail(`Failed to require plugin: ${err.message}`);
    continue;
  }

  // Contract: Export function/class
  if (typeof PluginClass !== 'function') {
    logFail(`Plugin must export a Class or constructor function (got ${typeof PluginClass})`);
    continue;
  }

  // Contract: Subclass of BasePlugin
  if (!(PluginClass.prototype instanceof BasePlugin)) {
    logFail(`Plugin class must inherit from BasePlugin (core/base-plugin.js)`);
    continue;
  }

  // Contract: Instantiation
  let instance;
  try {
    instance = new PluginClass();
  } catch (err) {
    logFail(`Failed to instantiate plugin class: ${err.message}`);
    continue;
  }

  // Contract: Required fields
  if (!instance.id || typeof instance.id !== 'string') {
    logFail(`Plugin instance missing valid "id" string (got ${instance.id})`);
  } else if (!/^[a-z0-9_-]+$/.test(instance.id)) {
    logFail(`Plugin id "${instance.id}" should be lowercase alphanumeric with hyphens/underscores`);
  } else {
    logPass(`Valid id: "${instance.id}"`);
  }

  if (!instance.name || typeof instance.name !== 'string') {
    logFail(`Plugin instance missing valid "name" string`);
  } else {
    logPass(`Valid name: "${instance.name}"`);
  }

  if (!instance.url || !/^https?:\/\//.test(instance.url)) {
    logFail(`Plugin instance "url" must be a valid HTTP/HTTPS URL (got "${instance.url}")`);
  } else {
    logPass(`Valid url: "${instance.url}"`);
  }

  // Contract: Must implement onCheckin
  if (instance.onCheckin === BasePlugin.prototype.onCheckin) {
    logFail(`Plugin must implement its own onCheckin(context) method`);
  } else {
    logPass(`Implements onCheckin() hook`);
  }
}

console.log('\n🔍 [2/3] Scanning for Code Patterns and Anti-Patterns...');

const scanTargets = [
  ...pluginFiles.map((f) => path.join(PLUGINS_DIR, f)),
  ...fs
    .readdirSync(path.join(ROOT_DIR, 'core'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(ROOT_DIR, 'core', f)),
  path.join(ROOT_DIR, 'index.js'),
];

for (const target of scanTargets) {
  const relPath = path.relative(ROOT_DIR, target);
  const content = fs.readFileSync(target, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Check 1: Hardcoded user home paths
    if (/\/Users\/[a-zA-Z0-9_-]+|\/home\/[a-zA-Z0-9_-]+|[A-Z]:\\[Uu]sers/.test(line)) {
      logFail(
        `${relPath}:${lineNum} - Hardcoded workstation user path detected. Use portable paths or config.`
      );
    }

    // Check 2: waitUntil: 'commit' in setup or checkin
    if (/waitUntil\s*:\s*['"]commit['"]/.test(line)) {
      logFail(
        `${relPath}:${lineNum} - Anti-pattern: waitUntil: 'commit' causes premature context close. Use 'domcontentloaded' or selector wait.`
      );
    }

    // Check 3: Arbitrary sleep/wait timeout
    if (
      /(?:page\.waitForTimeout|setTimeout)\s*\(/.test(line) &&
      !/\/\/\s*ok:\s*sleep/i.test(line)
    ) {
      logWarn(
        `${relPath}:${lineNum} - Potential arbitrary sleep detected. Prefer locator/URL predicates over fixed delays.`
      );
    }
  });
}

console.log('\n🔍 [3/3] Validating PluginLoader Discovery...');

try {
  const loader = new PluginLoader();
  const loadedMap = loader.loadAll();
  logPass(`PluginLoader discovered and initialized ${loadedMap.size} plugin(s) successfully.`);
} catch (err) {
  logFail(`PluginLoader discovery failed: ${err.message}`);
}

console.log('\n----------------------------------------------------');
if (hasError) {
  console.error(
    '❌ Plugin contract and pattern verification FAILED. Please resolve errors above.\n'
  );
  process.exit(1);
} else {
  console.log('✅ All plugin contracts, anti-pattern checks, and loader tests PASSED!\n');
  process.exit(0);
}
