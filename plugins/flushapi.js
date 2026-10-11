const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const AUTH_DOMAINS = ['flushapi.fun'];
const GITHUB_CLIENT_ID = 'Ov23li3WpJvZg1RmcPcl';

class FlushApiPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'flushapi',
      name: 'FlushAPI',
      description: 'FlushAPI 每日签到与额度查询',
      url: 'https://flushapi.fun/profile',
      loginUrl: 'https://flushapi.fun/login',
      enabled: true,
    });
  }

  /**
   * 确保登录页面的 GitHub OAuth 状态与条款复选框就绪
   */
  async prepareLoginPage(page) {
    // 注入 status 配置，保证即使在网络较慢时 GitHub OAuth 按钮也能正常渲染
    await page
      .evaluate((clientId) => {
        try {
          const status = JSON.parse(localStorage.getItem('status') || '{}');
          if (!status.github_client_id) {
            status.github_oauth = true;
            status.github_client_id = clientId;
            localStorage.setItem('status', JSON.stringify(status));
          }
        } catch (e) {}
      }, GITHUB_CLIENT_ID)
      .catch(() => {});

    // 勾选用户服务协议与隐私政策条款（未勾选时 Continue with GitHub 按钮为 disabled）
    const visualCheckbox = page.locator('[data-slot="checkbox"], span[role="checkbox"]').first();
    await visualCheckbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await visualCheckbox.isVisible().catch(() => false)) {
      const isChecked =
        (await visualCheckbox.getAttribute('aria-checked').catch(() => 'false')) === 'true';
      if (!isChecked) {
        await visualCheckbox.click().catch(() => {});
      }
    }

    const hiddenInput = page.locator('#legal-consent').first();
    if ((await hiddenInput.count().catch(() => 0)) > 0) {
      await hiddenInput.setChecked(true, { force: true }).catch(() => {});
    }
  }

  /**
   * 交互式 Setup 模式，支持自动勾选协议并触发 GitHub 登录
   */
  async onSetup(context) {
    const { page, log } = context;
    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成 GitHub 登录...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.prepareLoginPage(page);

    const ghBtn = page
      .locator(
        'button:has-text("使用 GitHub 继续"), button:has-text("Continue with GitHub"), button:has-text("GitHub")'
      )
      .first();
    await ghBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await ghBtn.isVisible().catch(() => false)) {
      log(`[${this.name}] 正在尝试自动点击 GitHub 登录按钮...`);
      await ghBtn.click().catch(() => {});
    }

    log(`[${this.name}] 等待登录完成并跳转至个人中心 (${this.url})...`);
    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        if (p.includes('/login')) return false;
        return (
          url.href.startsWith(this.url) ||
          p.includes('/profile') ||
          p.includes('/dashboard') ||
          p.includes('/console')
        );
      },
      {
        timeout: 300000,
        waitUntil: 'domcontentloaded',
      }
    );
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * 在当前页面上下文中通过 API 获取用户信息与签到状态
   */
  async fetchUserData(page, monthStr) {
    return await page.evaluate(async (month) => {
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

      let checkinData = null;
      try {
        const rCheckin = await fetch(`/api/user/checkin?month=${encodeURIComponent(month)}`, {
          credentials: 'include',
          headers,
        });
        checkinData = await rCheckin.json();
      } catch (e) {}

      return { tokenFound: !!token, selfData, checkinData };
    }, monthStr);
  }

  /**
   * 在当前页面上下文触发签到 API
   */
  async executeCheckin(page) {
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

      try {
        const r = await fetch('/api/user/checkin', {
          method: 'POST',
          credentials: 'include',
          headers,
        });
        return await r.json();
      } catch (e) {
        return { success: false, message: e.message };
      }
    });
  }

  /**
   * 检查是否今日已签到
   */
  findTodayCheckin(checkinData, todayISO) {
    if (!checkinData?.data?.stats) return null;
    const stats = checkinData.data.stats;
    if (stats.checked_in_today) {
      const records = Array.isArray(stats.records) ? stats.records : [];
      const record = records.find((r) => r.checkin_date === todayISO);
      return record || { checkin_date: todayISO, quota_awarded: 0, checked_in_today: true };
    }
    return null;
  }

  /**
   * 计算美元余额
   */
  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * 自动打卡主流程：支持快速预检、API 签到、DOM 按钮回退与 GitHub OAuth 认证
   */
  async onCheckin({ page, browser, log, helper }) {
    const todayISO = helper.getCSTISODateString
      ? helper.getCSTISODateString()
      : helper.getCSTDateString().replace(/\//g, '-');
    const monthStr = todayISO.slice(0, 7);

    // 🚀 Fast-Path: 先尝试快速预检（若当前已有有效会话且今日已签到，直接返回，耗时 1~2s）
    log('正在检查当前会话与今日签到状态...');
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await helper.dismissModals(page);

    let checkResult = await this.fetchUserData(page, monthStr);
    let todayCheckin = this.findTodayCheckin(checkResult.checkinData, todayISO);

    if (todayCheckin) {
      const balance = this.calculateBalance(checkResult.selfData);
      const user =
        checkResult.selfData?.data?.display_name || checkResult.selfData?.data?.username || '用户';
      const awardText = todayCheckin.quota_awarded
        ? ` (今日奖励: +$${(todayCheckin.quota_awarded / QUOTA_PER_USD).toFixed(4)})`
        : '';
      log(`⚡ 预检发现今日已完成签到 (用户: ${user})，无需重复打卡`);
      return {
        success: true,
        message: `今日已完成签到${awardText}`,
        balance,
      };
    }

    // 若会话有效但今日尚未签到，直接在当前页面执行签到动作
    if (checkResult.selfData?.success && checkResult.selfData?.data?.username) {
      log(`当前会话有效 (用户: ${checkResult.selfData.data.username})，正在执行今日签到...`);
      const checkinRes = await this.executeCheckin(page);
      if (checkinRes?.success) {
        log(`API 签到成功: ${checkinRes.message || 'ok'}`);
      } else {
        // UI 按钮回退
        const checkinBtn = page
          .locator(
            'button:has-text("Check in now"), button:has-text("立即签到"), button:has-text("Check in")'
          )
          .first();
        if (await checkinBtn.isVisible().catch(() => false)) {
          log('尝试点击页面签到按钮...');
          await checkinBtn.click().catch(() => {});
        }
      }

      // 重新获取确认
      checkResult = await this.fetchUserData(page, monthStr);
      todayCheckin = this.findTodayCheckin(checkResult.checkinData, todayISO);
      const balance = this.calculateBalance(checkResult.selfData);

      if (todayCheckin || checkinRes?.success) {
        const award = checkinRes?.data?.quota_awarded || todayCheckin?.quota_awarded;
        const awardText = award ? ` (获得: +$${(award / QUOTA_PER_USD).toFixed(4)})` : '';
        return {
          success: true,
          message: `签到成功${awardText}`,
          balance,
        };
      }
    }

    // 🔄 完整流程：当前未登录或会话已失效，执行 GitHub OAuth 登录
    log('当前未登录或会话已失效，开始通过 GitHub OAuth 登录...');
    await helper.clearSiteStorage(page);
    await helper.clearCookies(browser, AUTH_DOMAINS);

    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await helper.dismissModals(page);
    await this.prepareLoginPage(page);

    log('触发 GitHub OAuth 登录流程...');
    await helper.handleOAuth({
      page,
      triggerSelector:
        'button:has-text("使用 GitHub 继续"), button:has-text("Continue with GitHub"), button:has-text("GitHub")',
      popupMatch: (url) => {
        const p = url.pathname || url.toString();
        return p.includes('/profile') || p.includes('/dashboard') || p.includes('/console');
      },
      targetUrl: this.url,
      timeout: 30000,
    });

    await helper.dismissModals(page);

    // 登录完成后，执行签到与查询
    log('登录完成，正在执行签到与额度查询...');
    const postRes = await this.executeCheckin(page);
    if (!postRes?.success) {
      const checkinBtn = page
        .locator(
          'button:has-text("Check in now"), button:has-text("立即签到"), button:has-text("Check in")'
        )
        .first();
      if (await checkinBtn.isVisible().catch(() => false)) {
        await checkinBtn.click().catch(() => {});
      }
    }

    checkResult = await this.fetchUserData(page, monthStr);
    todayCheckin = this.findTodayCheckin(checkResult.checkinData, todayISO);
    const balance = this.calculateBalance(checkResult.selfData);

    if (todayCheckin || postRes?.success) {
      const award = postRes?.data?.quota_awarded || todayCheckin?.quota_awarded;
      const awardText = award ? ` (获得: +$${(award / QUOTA_PER_USD).toFixed(4)})` : '';
      return {
        success: true,
        message: `签到成功${awardText}`,
        balance,
      };
    }

    if (balance) {
      return {
        success: true,
        message: '登录完成，当前余额正常',
        balance,
      };
    }

    throw new Error('FlushAPI 签到失败：未能获取到有效用户信息或完成签到！');
  }
}

module.exports = FlushApiPlugin;
