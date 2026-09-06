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
   * Defaults to `.browser-data/<plugin.id>`.
   * @param {import('./base-plugin').BasePlugin} plugin
   * @returns {string}
   */
  resolveUserDataDir(plugin) {
    if (plugin.userDataDir) {
      return plugin.userDataDir;
    }

    const pluginProfile = path.join(this.rootDir, '.browser-data', plugin.id);
    const legacyRootProfile = path.join(this.rootDir, '.browser-data');
    const legacyDefaultDir = path.join(legacyRootProfile, 'Default');
    const legacyLocalState = path.join(legacyRootProfile, 'Local State');

    if (!fs.existsSync(pluginProfile)) {
      fs.mkdirSync(pluginProfile, { recursive: true });
    }

    // Profile isolation: seed isolated profile with authenticated session if available
    const pluginDefaultDir = path.join(pluginProfile, 'Default');
    const pluginLocalState = path.join(pluginProfile, 'Local State');

    if (fs.existsSync(legacyDefaultDir) && fs.existsSync(legacyLocalState)) {
      if (!fs.existsSync(pluginLocalState) || !fs.existsSync(pluginDefaultDir)) {
        try {
          if (!fs.existsSync(pluginLocalState)) {
            fs.copyFileSync(legacyLocalState, pluginLocalState);
          }
          if (!fs.existsSync(pluginDefaultDir)) {
            fs.cpSync(legacyDefaultDir, pluginDefaultDir, { recursive: true });
          }
        } catch (e) {
          // Ignore copy errors
        }
      }
    }

    return pluginProfile;
  }

  /**
   * Resolve platform-specific metadata for browser fingerprint masking.
   */
  resolveStealthMeta() {
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    const platformName = isMac ? 'macOS' : isWin ? 'Windows' : 'Linux';
    const platformVersion = isMac ? '15.4.0' : isWin ? '10.0.0' : '6.5.0';
    const architecture = process.arch === 'arm64' ? 'arm' : 'x86';

    const osString = isMac
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : isWin
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';

    const gpuVendor = isMac ? 'Apple Inc.' : isWin ? 'Google Inc. (NVIDIA)' : 'Intel Inc.';
    const gpuRenderer = isMac
      ? 'Apple M4'
      : isWin
        ? 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'
        : 'Intel(R) Iris(R) Xe Graphics';

    const userAgent = `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36`;

    return {
      platformName,
      platformVersion,
      architecture,
      osString,
      gpuVendor,
      gpuRenderer,
      userAgent,
    };
  }

  /**
   * Build client-side stealth script covering WebDriver, Client Hints, WebGL, and Window geometry.
   */
  buildStealthScript(meta) {
    return `
      (() => {
        try {
          // 1. 隐藏 navigator.webdriver
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

          // 2. 补全 window.chrome 对象与运行时
          if (!window.chrome) {
            window.chrome = { runtime: {} };
          } else if (!window.chrome.runtime) {
            window.chrome.runtime = {};
          }

          // 3. 补全真实浏览器插件列表
          if (!navigator.plugins || navigator.plugins.length === 0) {
            Object.defineProperty(navigator, 'plugins', {
              get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }],
            });
          }

          // 4. 动态同步 navigator.userAgentData (Client Hints) 与 User-Agent 一致
          if (!navigator.userAgentData) {
            const ua = navigator.userAgent || '';
            const match = ua.match(/Chrome\\/(\\d+(\\.\\d+)*)/);
            const fullVersion = match ? match[1] : '133.0.0.0';
            const majorVersion = fullVersion.split('.')[0];
            const brands = [
              { brand: 'Chromium', version: majorVersion },
              { brand: 'Google Chrome', version: majorVersion },
              { brand: 'Not(A:Brand', version: '99' },
            ];
            Object.defineProperty(navigator, 'userAgentData', {
              get: () => ({
                brands,
                mobile: false,
                platform: '${meta.platformName}',
                getHighEntropyValues: async (hints) => {
                  const res = {
                    brands,
                    mobile: false,
                    platform: '${meta.platformName}',
                    platformVersion: '${meta.platformVersion}',
                    architecture: '${meta.architecture}',
                    bitness: '64',
                    model: '',
                    uaFullVersion: fullVersion,
                  };
                  const out = {};
                  for (const h of hints) {
                    if (res[h] !== undefined) out[h] = res[h];
                  }
                  return out;
                },
              }),
            });
          }

          // 5. 伪装 WebGL 显卡指纹，掩盖 SwiftShader / llvmpipe 软件渲染特征
          const hookGL = (proto) => {
            if (!proto) return;
            const origGetParam = proto.getParameter;
            proto.getParameter = function (param) {
              if (param === 37445) return '${meta.gpuVendor}'; // UNMASKED_VENDOR_WEBGL
              if (param === 37446) return '${meta.gpuRenderer}'; // UNMASKED_RENDERER_WEBGL
              return origGetParam.apply(this, arguments);
            };
          };
          if (typeof WebGLRenderingContext !== 'undefined') hookGL(WebGLRenderingContext.prototype);
          if (typeof WebGL2RenderingContext !== 'undefined') hookGL(WebGL2RenderingContext.prototype);

          // 6. 修正桌面浏览器窗口外边框高度差
          try {
            Object.defineProperty(window, 'outerHeight', {
              get: () => (window.innerHeight ? window.innerHeight + 85 : 885),
            });
            Object.defineProperty(window, 'outerWidth', {
              get: () => window.innerWidth || 1280,
            });
          } catch (e) {}
        } catch (e) {}
      })();
    `;
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
    const stealthMeta = this.resolveStealthMeta();

    this.log(
      `[${plugin.name}] 正在启动浏览器 (Profile: ${path.basename(userDataDir)}, Headless: ${headless})...`
    );

    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
      userAgent: stealthMeta.userAgent,
    });

    // 注入高级隐身脚本，抹除自动化与无头特征
    const stealthScript = this.buildStealthScript(stealthMeta);
    await browser.addInitScript(stealthScript);

    const page = browser.pages()[0] || (await browser.newPage());
    await page.addInitScript(stealthScript);
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
        this.log(
          `[${plugin.name}] 执行完成: ${result.message || 'OK'}${result.balance ? ` (余额: ${result.balance})` : ''}`
        );
        return result;
      }
    } catch (err) {
      this.log(`[${plugin.name}] 错误: ${err.message}`);
      const screenshotPath = path.join(
        this.screenshotsDir,
        `${plugin.id || 'error'}-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      this.log(`[${plugin.name}] 错误截图已保存至: ${screenshotPath}`);
      return { success: false, message: err.message, error: err };
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { BrowserManager };
