const { PageHelper } = require('./helper');

/**
 * BasePlugin defines the standard interface and default lifecycle hooks for all check-in plugins.
 */
class BasePlugin {
  constructor(options = {}) {
    this.id = options.id || '';
    this.name = options.name || this.id;
    this.description = options.description || '';
    this.url = options.url || '';
    this.loginUrl = options.loginUrl || this.url;
    this.enabled = options.enabled !== undefined ? options.enabled : true;

    // Custom user data directory for browser profile isolation.
    // If not specified, BrowserManager will resolve to .browser-data/<plugin-id>
    this.userDataDir = options.userDataDir || null;

    // Optional native Chrome stealth mode for strict Cloudflare Turnstile OOPIF verification
    this.turnstileStealth = Boolean(options.turnstileStealth);
  }

  /**
   * Setup hook: interactive mode for the user to log in for the first time.
   * @param {Object} context - { page, browser, log, helper, options }
   */
  async onSetup(context) {
    const { page, browser, log, helper = PageHelper } = context;
    const targetLoginUrl = this.loginUrl || this.url;
    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成登录...`);
    log(`[${this.name}] 正在导航至: ${targetLoginUrl}`);
    await page.goto(targetLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    log(`[${this.name}] 等待登录完成，跳转至控制台或主页 (${this.url})...`);
    const loginPath = this.loginUrl ? new URL(this.loginUrl).pathname : null;
    const targetPath = this.url ? new URL(this.url).pathname : '/';
    const waitNav =
      helper && typeof helper.waitForNavigationAcrossPages === 'function'
        ? (pred, opts) => helper.waitForNavigationAcrossPages(page, pred, { ...opts, browser })
        : (pred, opts) => page.waitForURL(pred, opts);

    await waitNav(
      (url) => {
        const currentPath = url.pathname;
        if (
          url.hostname?.includes('github.com') ||
          currentPath.includes('/login') ||
          currentPath.includes('/sign-in') ||
          currentPath.includes('/register') ||
          currentPath.includes('/oauth')
        ) {
          return false;
        }
        // Must not be still on the login page if loginPath is defined and distinct
        if (
          loginPath &&
          loginPath !== '/' &&
          loginPath !== targetPath &&
          currentPath.includes(loginPath)
        ) {
          return false;
        }
        return this.url
          ? url.href.startsWith(this.url) ||
              (targetPath !== '/' && currentPath.includes(targetPath))
          : true;
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * [Optional] Direct API check-in fast-path.
   * When implemented and valid cached session exists, BrowserManager runs this first.
   * Return { success: true, message, balance? } on success, or null/throw on failure.
   * @param {Object} _context
   * @param {Function} _context.log
   * @param {typeof import('./helper').PageHelper} _context.helper
   * @param {{ cookies: string, headers: Record<string, string>, rawState: Object }} _context.session
   * @returns {Promise<{ success: boolean, message: string, balance?: string } | null>}
   */
  async onDirectApiCheckin(_context) {
    return null;
  }

  /**
   * Core check-in execution hook (must be implemented by subclasses).
   * @param {Object} context - { page, browser, log, helper, options }
   * @returns {Promise<{ success: boolean, message: string, balance?: string, extra?: any }>}
   */
  async onCheckin(_context) {
    throw new Error(
      `Plugin [${this.name || this.id}] must implement the onCheckin(context) method.`
    );
  }
}

module.exports = { BasePlugin };
