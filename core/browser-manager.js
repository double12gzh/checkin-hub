const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { PageHelper } = require('./helper');

class BrowserManager {
  constructor(options = {}) {
    this.rootDir = path.resolve(__dirname, '..');
    this.logFile = path.join(this.rootDir, 'checkin.log');
    this.screenshotsDir = path.join(this.rootDir, 'screenshots');
    this.debug = !!options.debug;

    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  log(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    try {
      fs.appendFileSync(this.logFile, `${line}\n`);
    } catch (e) {
      // Ignore file write errors
    }
  }

  /**
   * Resolve user data dir for a plugin.
   * For 'agentrouter', if legacy root `.browser-data` exists, reuse it to avoid re-login.
   */
  resolveUserDataDir(plugin) {
    if (plugin.userDataDir) {
      return plugin.userDataDir;
    }

    const legacyRootProfile = path.join(this.rootDir, '.browser-data');
    if (plugin.id === 'agentrouter' && fs.existsSync(legacyRootProfile)) {
      return legacyRootProfile;
    }

    const pluginProfile = path.join(this.rootDir, '.browser-data', plugin.id);
    if (!fs.existsSync(pluginProfile)) {
      fs.mkdirSync(pluginProfile, { recursive: true });
    }
    return pluginProfile;
  }

  /**
   * Execute a plugin lifecycle action (setup or checkin).
   * @param {import('./base-plugin').BasePlugin} plugin
   * @param {'setup'|'checkin'} action
   * @param {Object} [runtimeOptions]
   */
  async execute(plugin, action = 'checkin', runtimeOptions = {}) {
    const isSetup = action === 'setup';
    const headless = this.debug ? false : !isSetup;
    const userDataDir = this.resolveUserDataDir(plugin);

    this.log(`[${plugin.name}] 正在启动浏览器 (Profile: ${path.basename(userDataDir)}, Headless: ${headless})...`);

    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
    });

    const page = browser.pages()[0] || (await browser.newPage());

    const context = {
      page,
      browser,
      log: (msg) => this.log(`[${plugin.name}] ${msg}`),
      helper: PageHelper,
      options: runtimeOptions,
    };

    try {
      if (isSetup) {
        await plugin.onSetup(context);
        return { success: true, message: 'Setup completed successfully' };
      } else {
        const result = await plugin.onCheckin(context);
        this.log(`[${plugin.name}] 执行完成: ${result.message || 'OK'}${result.balance ? ` (余额: ${result.balance})` : ''}`);
        return result;
      }
    } catch (err) {
      this.log(`[${plugin.name}] 错误: ${err.message}`);
      const screenshotPath = path.join(this.screenshotsDir, `${plugin.id || 'error'}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      this.log(`[${plugin.name}] 错误截图已保存至: ${screenshotPath}`);
      return { success: false, message: err.message, error: err };
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { BrowserManager };
