const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const AUTH_DOMAINS = ['kktoken.cc'];

class KKTokenPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'kktoken',
      name: 'KKtoken',
      description: 'KKtoken AI 每日登录与额度查询',
      url: 'https://kktoken.cc/dashboard/overview',
      loginUrl: 'https://kktoken.cc/sign-in',
    });
  }

  /**
   * 交互式 Setup 模式，支持自动触发或手动完成 GitHub 登录
   */
  async onSetup(context) {
    const { page, log } = context;
    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成 GitHub 登录...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const ghBtn = page
      .locator('button:has-text("Continue with GitHub"), button:has-text("GitHub")')
      .first();
    await ghBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await ghBtn.isVisible().catch(() => false)) {
      log(`[${this.name}] 正在尝试自动点击 GitHub 登录按钮...`);
      await ghBtn.click().catch(() => {});
    }

    log(`[${this.name}] 等待登录完成并跳转至控制台 (${this.url})...`);
    await page.waitForURL((url) => url.pathname.includes('/dashboard'), {
      timeout: 300000,
      waitUntil: 'domcontentloaded',
    });
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * Helper to query user quota and recent logs via browser API context.
   */
  async fetchUserData(page) {
    return await page.evaluate(async () => {
      let token = null;
      try {
        const refreshRes = await fetch('/api/user/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        const refreshJson = await refreshRes.json();
        token = refreshJson?.data?.access_token;
      } catch (e) {}

      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      let selfData = null;
      try {
        const rSelf = await fetch('/api/user/self', { credentials: 'include', headers });
        selfData = await rSelf.json();
      } catch (e) {}

      let logItems = [];
      try {
        const rLog = await fetch('/api/log/self?p=1&page_size=10', {
          credentials: 'include',
          headers,
        });
        const logData = await rLog.json();
        if (logData?.data?.items && Array.isArray(logData.data.items)) {
          logItems = logData.data.items;
        }
      } catch (e) {}

      return { tokenFound: !!token, selfData, logItems };
    });
  }

  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * Core check-in / daily login routine.
   */
  async onCheckin({ page, browser, log, helper }) {
    // 🚀 Fast-Path: 先尝试快速预检（若当前已有有效会话，直接获取额度返回）
    log('正在检查当前会话与登录状态...');
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await helper.dismissModals(page);

    let checkResult = await this.fetchUserData(page);
    if (checkResult.selfData?.success && checkResult.selfData?.data?.username) {
      const balance = this.calculateBalance(checkResult.selfData);
      const user = checkResult.selfData.data.display_name || checkResult.selfData.data.username;
      log(`⚡ 预检发现当前会话有效 (用户: ${user})，无需重新认证`);
      return {
        success: true,
        message: `登录成功 (用户: ${checkResult.selfData.data.username})`,
        balance,
      };
    }

    // 🔄 完整流程：当前未登录或会话失效，执行登录流程
    log('当前未登录或会话已失效，开始通过 GitHub OAuth 登录...');
    await helper.clearCookies(browser, AUTH_DOMAINS);
    await helper.clearSiteStorage(page, null);

    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await helper.dismissModals(page);

    log('触发 GitHub OAuth 登录流程...');
    await helper.handleOAuth({
      page,
      triggerSelector: 'button:has-text("Continue with GitHub"), button:has-text("GitHub")',
      popupMatch: '**/dashboard**',
      targetUrl: this.url,
      timeout: 25000,
    });
    // 重新获取用户信息与余额
    checkResult = await this.fetchUserData(page);
    if (checkResult.selfData?.success && checkResult.selfData?.data?.username) {
      const balance = this.calculateBalance(checkResult.selfData);
      const user = checkResult.selfData.data.display_name || checkResult.selfData.data.username;
      log(`GitHub 认证成功 (用户: ${user})`);
      return {
        success: true,
        message: `登录成功 (用户: ${checkResult.selfData.data.username})`,
        balance,
      };
    }

    throw new Error('KKtoken 登录失败，未能获取到有效用户信息！');
  }
}

module.exports = KKTokenPlugin;
