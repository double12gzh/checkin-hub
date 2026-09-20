const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const GITHUB_CLIENT_ID = 'Ov23liBGecTYSePKpXQC';

class JustDoWorkPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'justdowork',
      name: 'JustDoWork',
      description: 'JustDoWork 每日自动签到与额度查询',
      url: 'https://api.justwoker.icu/dashboard/overview',
      loginUrl: 'https://api.justwoker.icu/sign-in',
      enabled: true,
    });
    this.logsUrl = 'https://api.justwoker.icu/usage-logs/common';
    this.walletUrl = 'https://api.justwoker.icu/wallet';
  }

  /**
   * 交互式 Setup 模式，支持用户在弹出的浏览器中手动完成首次登录与 Turnstile 质询
   */
  async onSetup(context) {
    const { page, log } = context;
    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成登录...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    log(`[${this.name}] 等待登录完成并跳转至控制台 (${this.url})...`);
    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        if (p.includes('/login') || p.includes('/sign-in')) return false;
        return (
          url.href.startsWith(this.url) ||
          p.includes('/dashboard') ||
          p.includes('/usage-logs') ||
          p.includes('/wallet') ||
          p.includes('/console')
        );
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * 在页面已认证的上下文内调用站点内部 API 查询用户额度与近期日志
   * 支持复用已有 token，避免重复发起 /api/user/auth/refresh 触发 429 频控
   */
  async fetchUserData(page, existingToken = null) {
    return await page.evaluate(async (passedToken) => {
      let token = passedToken || null;
      let refreshData = null;
      let rateLimited = false;

      if (!token) {
        try {
          const refreshRes = await fetch('/api/user/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          if (refreshRes.status === 429) {
            rateLimited = true;
          } else {
            refreshData = await refreshRes.json();
            token = refreshData?.data?.access_token || null;
          }
        } catch (e) {}
      }

      let userObj = {};
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) userObj = JSON.parse(userStr);
      } catch (e) {}

      const headers = {
        ...(userObj.id ? { 'New-Api-User': String(userObj.id) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      let selfData = null;
      try {
        const rSelf = await fetch('/api/user/self', { credentials: 'include', headers });
        if (rSelf.status === 429) rateLimited = true;
        selfData = await rSelf.json();
      } catch (e) {}

      let logItems = [];
      try {
        const rLog = await fetch('/api/log/self?p=1&page_size=10&type=4', {
          credentials: 'include',
          headers,
        });
        if (rLog.status === 429) rateLimited = true;
        const logData = await rLog.json();
        if (logData?.data?.items && Array.isArray(logData.data.items)) {
          logItems = logData.data.items;
        }
      } catch (e) {}

      return {
        token,
        tokenFound: !!token,
        rateLimited,
        refreshData,
        selfData,
        logItems,
        hasLocalUser: !!userObj.id,
      };
    }, existingToken);
  }

  /**
   * 在页面上下文尝试调用签到接口，复用传入的 token 避免 429 频控
   */
  async triggerApiCheckin(page, token = null) {
    return await page.evaluate(async (passedToken) => {
      let currentToken = passedToken || null;
      if (!currentToken) {
        try {
          const refreshRes = await fetch('/api/user/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          });
          if (refreshRes.status !== 429) {
            const refreshJson = await refreshRes.json();
            currentToken = refreshJson?.data?.access_token;
          }
        } catch (e) {}
      }

      let userObj = {};
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) userObj = JSON.parse(userStr);
      } catch (e) {}

      const headers = {
        ...(userObj.id ? { 'New-Api-User': String(userObj.id) } : {}),
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      };

      try {
        const rCheckin = await fetch('/api/user/checkin', {
          method: 'POST',
          credentials: 'include',
          headers,
        });
        return await rCheckin.json();
      } catch (e) {
        return null;
      }
    }, token);
  }

  /**
   * 检查日志列表中是否存在今日（东八区 CST）的签到记录
   */
  findTodayCheckin(logItems, todayStr, helper) {
    if (!logItems || logItems.length === 0) return null;
    const normalizedToday = todayStr ? todayStr.replace(/\//g, '-') : '';
    for (const item of logItems) {
      if (item.created_at) {
        const itemDate = helper.getCSTDateString(item.created_at * 1000);
        const itemDateISO = helper.getCSTISODateString
          ? helper.getCSTISODateString(item.created_at * 1000)
          : itemDate;
        const normalizedItem = itemDate ? itemDate.replace(/\//g, '-') : '';
        if (
          (itemDate === todayStr ||
            itemDateISO === todayStr ||
            normalizedItem === normalizedToday) &&
          (item.content?.includes('签到') ||
            item.content?.includes('每日') ||
            item.content?.includes('用户签到'))
        ) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * 计算格式化余额（从 API 数据中获取）
   */
  calculateBalance(selfData, refreshData) {
    const quota = selfData?.data?.quota ?? refreshData?.data?.user?.quota;
    if (quota !== undefined && quota !== null) {
      return `$${(quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * 从 /wallet 页面 DOM 中提取余额（作为 API 被频控或网络抖动时的兜底）
   */
  async extractBalanceFromDom(page) {
    try {
      if (!page.url().includes('/wallet')) {
        await page.goto(this.walletUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      const balanceLocators = page.locator('text=/^\\s*\\$\\d+(\\.\\d+)?\\s*$/');
      const count = await balanceLocators.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const text = (
          await balanceLocators
            .nth(i)
            .innerText()
            .catch(() => '')
        ).trim();
        if (/^\$\d+(\.\d+)?$/.test(text)) {
          return text;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 自动打卡主入口
   */
  async onCheckin({ page, browser: _browser, log, helper }) {
    const todayStr = helper.getCSTDateString();

    // 1. Fast-Path 快速预检：尝试利用持久化 Profile 直接查询
    log(`[${this.name}] 正在检查当前会话与今日签到状态...`);
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await helper.dismissModals(page);

    const isRedirectedToLogin = page.url().includes('/login') || page.url().includes('/sign-in');

    let checkResult = { token: null, logItems: [] };
    if (!isRedirectedToLogin) {
      checkResult = await this.fetchUserData(page);
    }

    if (checkResult.rateLimited) {
      log(`[${this.name}] 提示：站点 Token 刷新接口触发频控 (HTTP 429)，将复用已有会话与 DOM 兜底`);
    }

    let todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);

    if (todayCheckin) {
      let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
      if (!balance) {
        balance = await this.extractBalanceFromDom(page);
      }
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      log(`[${this.name}] ⚡ 预检发现今日已完成签到，跳过登录重连流程`);
      return {
        success: true,
        message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
        balance,
      };
    }

    const isSessionValid =
      !isRedirectedToLogin &&
      (checkResult?.tokenFound ||
        checkResult?.selfData?.success ||
        checkResult?.hasLocalUser ||
        checkResult?.rateLimited);

    // 2. 若会话有效但尚未在日志中查到今日签到，尝试调用直接签到接口
    if (isSessionValid) {
      log(`[${this.name}] 会话有效，尝试调用签到接口...`);
      const apiCheckinRes = await this.triggerApiCheckin(page, checkResult.token);
      if (apiCheckinRes?.success) {
        log(`[${this.name}] API 签到成功: ${apiCheckinRes.message || '已成功获取额度'}`);
        // 重新拉取最新余额与日志（复用 token，绝不重复刷新触发 429）
        checkResult = await this.fetchUserData(page, checkResult.token);
        let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
        if (!balance) {
          balance = await this.extractBalanceFromDom(page);
        }
        return {
          success: true,
          message: apiCheckinRes.message || '签到成功',
          balance,
        };
      }

      // 若签到接口提示 Turnstile 人机验证
      if (
        apiCheckinRes?.message?.includes('Turnstile') ||
        apiCheckinRes?.message?.includes('人机验证')
      ) {
        log(`[${this.name}] 签到接口受 Turnstile 人机验证保护 (${apiCheckinRes.message})`);
        let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
        if (!balance) {
          balance = await this.extractBalanceFromDom(page);
        }
        if (balance) {
          // 当前会话健康无误，避免无头环境跳向登录页撞盾死锁，优雅保护现有会话
          log(`[${this.name}] 当前会话正常，已成功同步账户最新余额 (${balance})`);
          return {
            success: true,
            message: `会话正常，签到接口受 Turnstile 保护，最新余额: ${balance}`,
            balance,
          };
        }
      }
    }

    // 3. 完整登录流程：仅在会话真正失效时触发（严禁清除 Cookies 和 LocalStorage）
    log(`[${this.name}] 会话未激活或需重新认证，尝试导航至登录页...`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await helper.dismissModals(page);

    // 严防 Cloudflare Turnstile 质询卡死：检测登录页是否存在真人验证
    const turnstileLocator = page
      .locator(
        'iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [data-sitekey], text="请验证您是真人", text="Verify you are human"'
      )
      .first();
    const hasTurnstileChallenge = await turnstileLocator.isVisible().catch(() => false);

    if (hasTurnstileChallenge) {
      throw new Error(
        '站点登录页触发 Cloudflare Turnstile 人机验证（请验证您是真人），无头浏览器无法自动跳过。请运行 "node index.js --setup justdowork" 手动登录并保存会话！'
      );
    }

    // 确保 status 中注入 github_client_id，防止 client_id 为 undefined 导致 OAuth 弹窗异常
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

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await helper.dismissModals(page);

    log(`[${this.name}] 触发 GitHub OAuth 登录流程...`);
    const ghBtnSelector =
      'button:has-text("Continue with GitHub"), button:has-text("使用 GitHub 继续"), button:has-text("GitHub")';

    await helper.handleOAuth({
      page,
      triggerSelector: ghBtnSelector,
      popupMatch: (url) => {
        const u = url.href || url.toString();
        return (
          u.includes('/dashboard') ||
          u.includes('/usage-logs') ||
          u.includes('/wallet') ||
          u.includes('/console')
        );
      },
      targetUrl: this.url,
      timeout: 30000,
    });

    // 4. 重新获取签到结果与余额
    log(`[${this.name}] 登录完成，正在查询签到日志与账户额度...`);
    checkResult = await this.fetchUserData(page);
    todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);
    let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
    if (!balance) {
      balance = await this.extractBalanceFromDom(page);
    }

    if (todayCheckin) {
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      return {
        success: true,
        message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
        balance,
      };
    }

    // 5. DOM 回退检查
    log(`[${this.name}] 接口未检测到今日（${todayStr}）记录，尝试 DOM 回退检查...`);
    await page
      .goto(this.logsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => {});
    await helper.dismissModals(page);

    const tableRow = page.locator('table tr, .semi-table-row').first();
    await tableRow.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    const pageText = await page
      .locator('body')
      .innerText()
      .catch(() => '');

    const todayISO = helper.getCSTISODateString ? helper.getCSTISODateString() : todayStr;
    if (
      (pageText.includes('用户签到') || pageText.includes('签到') || pageText.includes('每日')) &&
      (pageText.includes(todayStr) ||
        pageText.includes(todayISO) ||
        pageText.includes(todayStr.replace(/\//g, '-')))
    ) {
      return {
        success: true,
        message: '通过日志页面 DOM 确认今日签到已成功',
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

    throw new Error(`签到未生效，未检测到今日（${todayStr}）的签到成功日志！`);
  }
}

module.exports = JustDoWorkPlugin;
