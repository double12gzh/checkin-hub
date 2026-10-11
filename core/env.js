const fs = require('fs');
const path = require('path');

/**
 * Load environment variables from .env file into process.env if not already set.
 */
function loadEnv(envPath) {
  const target = envPath || path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(target)) return;

  try {
    const content = fs.readFileSync(target, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    // Ignore env loading failure
  }
}

/**
 * Set or update an environment variable in .env file and process.env.
 * Preserves comments and other variable lines.
 * @param {string} key
 * @param {string} val
 * @param {string} [envPath]
 */
function updateEnv(key, val, envPath) {
  const target = envPath || path.resolve(__dirname, '..', '.env');
  let content = '';
  if (fs.existsSync(target)) {
    content = fs.readFileSync(target, 'utf-8');
  }

  const lines = content ? content.split('\n') : [];
  let replaced = false;
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${val}`;
    }
    return line;
  });

  if (!replaced) {
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
      newLines.push('');
    }
    newLines.push(`${key}=${val}`);
  }

  fs.writeFileSync(target, newLines.join('\n'), 'utf-8');
  process.env[key] = val;
}

// Auto-load on require
loadEnv();

module.exports = { loadEnv, updateEnv };
