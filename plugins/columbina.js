const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;

class ColumbinaPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'columbina',
      name: 'Columbina',
      description: 'Columbina New API 每日自动签到与额度查询',
      url: 'https://newapi.columbina.eu.org/profile',
      loginUrl: 'https://newapi.columbina.eu.org/sign-in',
      enabled: true,
    });
  }

  /**
   * Interactive setup mode for manual login.
   */
  async onSetup(context) {
    const { page, log } = context;
    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成登录...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    log(`[${this.name}] 等待登录完成并跳转至主页或控制台...`);
    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        return !p.includes('/sign-in') && !p.includes('/login');
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * Helper to execute API requests within the authenticated browser context.
   */
  async executeUserApi(page) {
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

      let checkinData = null;
      try {
        const checkinRes = await fetch('/api/user/checkin', {
          method: 'POST',
          credentials: 'include',
          headers,
        });
        checkinData = await checkinRes.json();
      } catch (e) {}

      let selfData = null;
      try {
        const selfRes = await fetch('/api/user/self', {
          credentials: 'include',
          headers,
        });
        selfData = await selfRes.json();
      } catch (e) {}

      return { tokenFound: !!token, checkinData, selfData };
    });
  }

  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * Perform automatic check-in.
   */
  async onCheckin({ page, log, helper }) {
    const username = process.env.COLUMBINA_USERNAME;
    const password = process.env.COLUMBINA_PASSWORD;

    // 1. Fast-Path: Check if current persisted browser profile already has valid session
    log(`[${this.name}] 检查已保存的会话状态...`);
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await helper.dismissModals(page);

    let apiResult = await this.executeUserApi(page);

    // 2. If session expired or not logged in, perform form login
    if (!apiResult?.selfData?.success) {
      log(`[${this.name}] 会话未登录或已过期，执行账号密码登录...`);
      if (!username || !password) {
        throw new Error(
          '缺少 Columbina 账号密码！请在 .env 文件中配置 COLUMBINA_USERNAME 和 COLUMBINA_PASSWORD。'
        );
      }

      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await helper.dismissModals(page);

      const usernameInput = page.locator('input[name="username"]').first();
      await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
      await usernameInput.fill(username);

      const passwordInput = page.locator('input[name="password"]').first();
      await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
      await passwordInput.fill(password);

      const submitBtn = page.locator('button:has-text("Sign in"), button[type="submit"]').first();
      await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
      await submitBtn.click();

      await page.waitForURL(
        (url) => {
          const p = url.pathname;
          return !p.includes('/sign-in') && !p.includes('/login');
        },
        { timeout: 30000, waitUntil: 'domcontentloaded' }
      );

      log(`[${this.name}] 登录成功，正在进入个人中心...`);
      if (!page.url().includes('/profile')) {
        await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      await helper.dismissModals(page);

      apiResult = await this.executeUserApi(page);
    }

    if (!apiResult?.selfData?.success) {
      throw new Error('未能获取有效的 Columbina 用户数据，登录可能未生效。');
    }

    const balance = this.calculateBalance(apiResult.selfData);
    let message = '今日已签到';

    if (apiResult.checkinData?.success) {
      message = apiResult.checkinData.message || '签到成功';
    } else if (apiResult.checkinData?.message) {
      message = apiResult.checkinData.message;
    }

    return {
      success: true,
      message,
      balance,
    };
  }
}

module.exports = ColumbinaPlugin;
