const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const GITHUB_CLIENT_ID = 'Ov23liBGecTYSePKpXQC';
const DEFAULT_TURNSTILE_SITEKEY = '0x4AAAAAAEQ0v37GMr9cC_Kw';

class JustDoWorkPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'justdowork',
      name: 'JustDoWork',
      description: 'JustDoWork 每日自动签到与额度查询',
      url: 'https://api.justwoker.icu/dashboard/overview',
      loginUrl: 'https://api.justwoker.icu/sign-in',
      enabled: true,
      turnstileStealth: true,
    });
    this.logsUrl = 'https://api.justwoker.icu/usage-logs/common';
    this.walletUrl = 'https://api.justwoker.icu/wallet';
    this.profileUrl = 'https://api.justwoker.icu/profile';
  }

  /**
   * 挂载网络监听与路由保护：
   * 1. 拦截登录页触发 GitHub OAuth 前置的 /api/user/auth/logout，防止消耗频控配额或因 429 阻断跳转
   * 2. 自动捕获前端自身发起的 /api/user/auth/refresh、/api/oauth/*、/api/user/login 响应中的短期 Token 与用户信息，
   *    同步落盘至 localStorage，避免重复请求触发 429 频控
   */
  async attachSessionCapture(page) {
    if (!page || typeof page !== 'object') {
      return {
        token: null,
        user: null,
        refreshData: null,
        rateLimited: false,
        unauthorized: false,
      };
    }

    if (page.__justdoworkCaptureAttached && page.__justdoworkCapturedState) {
      return page.__justdoworkCapturedState;
    }

    const captured = {
      token: null,
      user: null,
      refreshData: null,
      rateLimited: false,
      unauthorized: false,
    };
    page.__justdoworkCaptureAttached = true;
    page.__justdoworkCapturedState = captured;

    if (typeof page.route === 'function') {
      await page
        .route('**/api/user/auth/logout', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, message: '' }),
          });
        })
        .catch(() => {});
    }

    if (typeof page.on === 'function') {
      page.on('response', async (res) => {
        try {
          const url = res.url();
          const status = res.status();
          if (
            url.includes('/api/user/auth/refresh') ||
            url.includes('/api/oauth/') ||
            url.includes('/api/user/login')
          ) {
            if (status === 429) {
              captured.rateLimited = true;
              return;
            }
            if (status === 401 && url.includes('/api/user/auth/refresh')) {
              captured.unauthorized = true;
              return;
            }
            if (status === 200 && !url.includes('/api/oauth/state')) {
              const json = await res.json().catch(() => null);
              const bundle = json?.data;
              if (json?.success && bundle?.access_token) {
                captured.token = bundle.access_token;
                captured.user = bundle.user || captured.user;
                captured.refreshData = json;
                captured.unauthorized = false;
                await page
                  .evaluate(
                    ({ token, user }) => {
                      try {
                        if (token) localStorage.setItem('token', token);
                        if (user) localStorage.setItem('user', JSON.stringify(user));
                      } catch (_) {}
                    },
                    { token: captured.token, user: captured.user }
                  )
                  .catch(() => {});
              }
            }
          }
        } catch (_) {}
      });
    }

    return captured;
  }

  /**
   * 预置今日公告已读状态并清理弹窗遮罩
   */
  async suppressAndDismissModals(page, helper) {
    await page
      .evaluate(() => {
        try {
          const todayDateStr = new Date().toDateString();
          const raw = JSON.parse(localStorage.getItem('notification-storage') || '{}');
          const state = raw.state || {};
          state.closedUntilDate = todayDateStr;
          localStorage.setItem(
            'notification-storage',
            JSON.stringify({ state, version: raw.version ?? 0 })
          );
        } catch (_) {}
      })
      .catch(() => {});
    await helper.dismissModals(page);
  }

  /**
   * 交互式 Setup 模式：使用原生 Chrome 隐身通道，支持手动或自动点击 GitHub OAuth / Turnstile 完成登录
   */
  async onSetup(context) {
    const { page, log, helper } = context;
    await this.attachSessionCapture(page);

    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成登录...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const ghBtn = page
      .locator('button:has-text("使用 GitHub 继续"), button:has-text("Continue with GitHub")')
      .first();
    await ghBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await this.suppressAndDismissModals(page, helper);

    log(
      `[${this.name}] ⏳ 已自动清理公告弹窗，请点击【使用 GitHub 继续】完成登录（若出现 Turnstile 也可自动/手动点击）...`
    );

    const autoTurnstileTask = helper
      .resolveTurnstileToken(page, { timeoutMs: 35000 })
      .catch(() => null);

    try {
      const predicate = (url) => {
        const p = url.pathname;
        if (
          p.includes('/login') ||
          p.includes('/sign-in') ||
          p.includes('/oauth') ||
          url.hostname.includes('github.com')
        ) {
          return false;
        }
        return (
          url.href.startsWith(this.url) ||
          p.includes('/dashboard') ||
          p.includes('/usage-logs') ||
          p.includes('/wallet') ||
          p.includes('/profile') ||
          p.includes('/console')
        );
      };
      if (helper && typeof helper.waitForNavigationAcrossPages === 'function') {
        await helper.waitForNavigationAcrossPages(page, predicate, {
          timeout: 300000,
          waitUntil: 'domcontentloaded',
          browser: context.browser,
        });
      } else {
        await page.waitForURL(predicate, { timeout: 300000, waitUntil: 'domcontentloaded' });
      }
      await autoTurnstileTask.catch(() => {});
      const todayISO = helper.getCSTISODateString
        ? helper.getCSTISODateString()
        : helper.getCSTDateString().replace(/\//g, '-');
      const captured = page.__justdoworkCapturedState || {};
      await this.fetchUserData(page, captured.token, todayISO.slice(0, 7)).catch(() => {});
      log(`[${this.name}] 登录成功！持久化会话已自动保存至 Profile。`);
    } catch (err) {
      log(`[${this.name}] 浏览器登录未完成或已关闭。`);
      throw err;
    }
  }

  /**
   * 在页面已认证的上下文内查询用户额度、月度签到状态与近期日志
   * 优先复用已捕获的 token，避免重复发起 /api/user/auth/refresh 触发 429 频控
   */
  async fetchUserData(page, existingToken = null, monthStr = '') {
    const captured = page?.__justdoworkCapturedState || {};
    const passedToken = existingToken || captured.token || null;
    const skipRefresh = Boolean(passedToken || captured.unauthorized || captured.rateLimited);

    const evalResult = await page.evaluate(
      async (arg) => {
        const isLegacyStringArg = typeof arg === 'string' || arg === null;
        let token = isLegacyStringArg ? arg : arg?.passedToken || null;
        const shouldSkipRefresh = isLegacyStringArg ? Boolean(arg) : Boolean(arg?.skipRefresh);
        const mStr = isLegacyStringArg ? '' : arg?.monthStr || '';

        let refreshData = null;
        let rateLimited = false;

        if (!token && !shouldSkipRefresh) {
          try {
            const refreshRes = await fetch('/api/user/auth/refresh', {
              method: 'POST',
              credentials: 'include',
            });
            if (refreshRes.status === 429) {
              rateLimited = true;
            } else if (refreshRes.status === 200) {
              refreshData = await refreshRes.json().catch(() => null);
              token = refreshData?.data?.access_token || null;
              if (token) {
                try {
                  localStorage.setItem('token', token);
                } catch (_) {}
              }
              if (refreshData?.data?.user) {
                try {
                  localStorage.setItem('user', JSON.stringify(refreshData.data.user));
                } catch (_) {}
              }
            }
          } catch (_) {}
        }

        let userObj = {};
        try {
          const userStr = localStorage.getItem('user');
          if (userStr) userObj = JSON.parse(userStr);
          if (!token) {
            token = localStorage.getItem('token') || userObj.token || userObj.access_token || null;
          }
        } catch (_) {}

        const headers = {
          ...(userObj?.id ? { 'New-Api-User': String(userObj.id) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        let selfData = null;
        try {
          const rSelf = await fetch('/api/user/self', { credentials: 'include', headers });
          if (rSelf.status === 429) rateLimited = true;
          selfData = await rSelf.json().catch(() => null);
          if (selfData?.success && selfData?.data?.id) {
            userObj = selfData.data;
            headers['New-Api-User'] = String(userObj.id);
            try {
              localStorage.setItem('user', JSON.stringify(selfData.data));
            } catch (_) {}
          }
        } catch (_) {}

        let checkinStatus = null;
        if (mStr && (token || selfData?.success)) {
          try {
            const rStatus = await fetch(`/api/user/checkin?month=${encodeURIComponent(mStr)}`, {
              credentials: 'include',
              headers,
            });
            if (rStatus.status === 429) rateLimited = true;
            checkinStatus = await rStatus.json().catch(() => null);
          } catch (_) {}
        }

        let logItems = [];
        try {
          const rLog = await fetch('/api/log/self?p=1&page_size=10&type=4', {
            credentials: 'include',
            headers,
          });
          if (rLog.status === 429) rateLimited = true;
          const logData = await rLog.json().catch(() => null);
          if (logData?.data?.items && Array.isArray(logData.data.items)) {
            logItems = logData.data.items;
          }
        } catch (_) {}

        return {
          token,
          tokenFound: !!token,
          rateLimited,
          refreshData,
          selfData,
          checkinStatus,
          logItems,
          hasLocalUser: !!userObj?.id,
        };
      },
      monthStr ? { passedToken, skipRefresh, monthStr } : passedToken
    );

    if (evalResult && captured.refreshData && !evalResult.refreshData) {
      evalResult.refreshData = captured.refreshData;
    }
    if (evalResult && captured.rateLimited) {
      evalResult.rateLimited = true;
    }
    if (evalResult?.token && !captured.token) {
      captured.token = evalResult.token;
    }
    return evalResult;
  }

  /**
   * 在页面上下文尝试调用签到接口，复用传入的 token 避免 429 频控
   */
  async triggerApiCheckin(page, token = null) {
    return await page.evaluate(async (passedToken) => {
      let currentToken = passedToken || null;
      if (!currentToken) {
        try {
          currentToken = localStorage.getItem('token') || null;
        } catch (_) {}
      }
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
        } catch (_) {}
      }

      let userObj = {};
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) userObj = JSON.parse(userStr);
      } catch (_) {}

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
      } catch (_) {
        return null;
      }
    }, token);
  }

  /**
   * 在浏览器页面内执行签到；若后端要求 Turnstile 验证，则动态挂载显式 Turnstile 组件自动过盾后提交
   */
  async performBrowserCheckin(page, log, helper, token = null) {
    const directAttempt = await this.triggerApiCheckin(page, token);
    const msg = directAttempt?.message || '';
    if (
      directAttempt?.success ||
      msg.includes('已签到') ||
      msg.includes('重复') ||
      msg.includes('already') ||
      msg.includes('已经签到')
    ) {
      return directAttempt;
    }

    log(
      `[${this.name}] 签到接口需要 Turnstile 人机验证 (${msg || 'Turnstile'})，正在加载验证组件...`
    );

    const renderResult = await page.evaluate(async (defaultSiteKey) => {
      const doc = globalThis.document;
      globalThis.__checkinTurnstileToken = null;
      let sitekey = defaultSiteKey;
      try {
        const statusRes = await fetch('/api/status', { credentials: 'include' });
        const statusJson = await statusRes.json().catch(() => null);
        if (statusJson?.data?.turnstile_site_key) {
          sitekey = statusJson.data.turnstile_site_key;
        }
      } catch (_) {}

      const existingInputs = doc.querySelectorAll('[name="cf-turnstile-response"]');
      existingInputs.forEach((el) => {
        el.value = '';
      });

      let container = doc.getElementById('__checkin-turnstile-box');
      if (container) container.remove();
      container = doc.createElement('div');
      container.id = '__checkin-turnstile-box';
      container.style.cssText =
        'position:fixed;top:16px;left:16px;z-index:2147483647;background:#fff;padding:12px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      doc.body.appendChild(container);

      if (!globalThis.turnstile) {
        await new Promise((resolve, reject) => {
          const script = doc.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          script.onload = resolve;
          script.onerror = reject;
          doc.head.appendChild(script);
        });
      }

      if (!globalThis.turnstile || typeof globalThis.turnstile.render !== 'function') {
        return { ok: false, error: 'Turnstile 脚本加载失败' };
      }

      globalThis.turnstile.render('#__checkin-turnstile-box', {
        sitekey,
        theme: 'light',
        callback: (tsToken) => {
          globalThis.__checkinTurnstileToken = tsToken;
        },
      });
      return { ok: true, sitekey };
    }, DEFAULT_TURNSTILE_SITEKEY);

    if (!renderResult?.ok) {
      throw new Error(`JustDoWork 签到验证组件初始化失败: ${renderResult?.error || '未知错误'}`);
    }

    const turnstileToken = await helper.resolveTurnstileToken(page, { timeoutMs: 35000 });
    log(`[${this.name}] 签到 Turnstile 验证通过，正在提交打卡请求...`);

    return await page.evaluate(
      async ({ tsToken, passedToken }) => {
        const container = globalThis.document?.getElementById('__checkin-turnstile-box');
        if (container) container.remove();

        let userObj = {};
        try {
          userObj = JSON.parse(localStorage.getItem('user') || '{}');
        } catch (_) {}
        const authToken =
          passedToken ||
          localStorage.getItem('token') ||
          userObj.token ||
          userObj.access_token ||
          null;
        const headers = {
          'Content-Type': 'application/json',
          ...(userObj?.id ? { 'New-Api-User': String(userObj.id) } : {}),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        };

        const res = await fetch(`/api/user/checkin?turnstile=${encodeURIComponent(tsToken)}`, {
          method: 'POST',
          credentials: 'include',
          headers,
        });
        return await res.json().catch(() => null);
      },
      { tsToken: turnstileToken, passedToken: token }
    );
  }

  /**
   * 检查日志列表中是否存在今日（东八区 CST）的签到记录
   */
  findTodayCheckin(logItems, todayStr, helper) {
    if (!logItems || logItems.length === 0) return null;
    const targetTimestamp =
      todayStr && !Number.isNaN(Date.parse(todayStr)) ? new Date(todayStr).getTime() : undefined;
    const todayISO = helper.getCSTISODateString
      ? helper.getCSTISODateString(targetTimestamp)
      : todayStr;
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
            itemDateISO === todayISO ||
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
   * 解析月度签到统计中的今日签到描述
   */
  formatCheckinStatsMessage(checkinStatus, todayISO) {
    const stats = checkinStatus?.data?.stats;
    if (!stats?.checked_in_today) return null;
    const records = Array.isArray(stats.records) ? stats.records : [];
    const todayRecord = records.find((r) => r.checkin_date === todayISO);
    if (todayRecord?.quota_awarded) {
      const usd = (todayRecord.quota_awarded / QUOTA_PER_USD).toFixed(2);
      return `今日已签到 (获得 $${usd} 额度)`;
    }
    return '今日已签到';
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
    } catch (_) {
      return null;
    }
  }

  /**
   * Direct API 极速通道：当缓存的短期 Token 仍在有效期内且今日已签到（或免验证签到成功）时极速返回；
   * 若 Token 过期或需 Turnstile 验证，则返回 null 交由 Playwright 浏览器通道处理。
   */
  async onDirectApiCheckin({ log, session, helper }) {
    const envToken = process.env.JUSTDOWORK_TOKEN || process.env.JUSTDOWORK_ACCESS_TOKEN;
    const envCookie = process.env.JUSTDOWORK_COOKIE;

    const candidateHeaders = [];
    if (session && (session.cookies || Object.keys(session.headers || {}).length > 0)) {
      candidateHeaders.push({
        'Content-Type': 'application/json',
        ...(session.cookies ? { Cookie: session.cookies } : {}),
        ...session.headers,
      });
    }
    if (envToken || envCookie) {
      candidateHeaders.push({
        'Content-Type': 'application/json',
        ...(envToken ? { Authorization: `Bearer ${envToken}` } : {}),
        ...(envCookie ? { Cookie: envCookie } : {}),
      });
    }

    if (candidateHeaders.length === 0) return null;

    const todayStr = helper.getCSTDateString();
    const todayISO = helper.getCSTISODateString
      ? helper.getCSTISODateString()
      : todayStr.replace(/\//g, '-');
    const monthStr = todayISO.slice(0, 7);
    const baseUrl = new URL(this.url).origin;

    try {
      if (log) log(`[${this.name}] 正在通过 Direct API 检查打卡状态...`);
      let authHeaders = null;
      let selfData = null;

      for (const headers of candidateHeaders) {
        const rSelf = await fetch(`${baseUrl}/api/user/self`, { headers });
        if (rSelf.status === 401 || rSelf.status === 403 || rSelf.status === 429) {
          continue;
        }
        const data = await rSelf.json?.().catch(() => null);
        if (data?.success) {
          authHeaders = headers;
          selfData = data;
          break;
        }
      }

      if (!selfData?.success || !authHeaders) return null;

      let checkinStatus = null;
      try {
        const rStatus = await fetch(
          `${baseUrl}/api/user/checkin?month=${encodeURIComponent(monthStr)}`,
          { headers: authHeaders }
        );
        if (rStatus && typeof rStatus.json === 'function') {
          checkinStatus = await rStatus.json().catch(() => null);
        }
      } catch (_) {}

      const statsMsg = this.formatCheckinStatsMessage(checkinStatus, todayISO);
      if (statsMsg) {
        return {
          success: true,
          message: statsMsg,
          balance: this.calculateBalance(selfData, null),
        };
      }

      const rCheckin = await fetch(`${baseUrl}/api/user/checkin`, {
        method: 'POST',
        headers: authHeaders,
      });
      const checkinData = await rCheckin.json?.().catch(() => null);

      let logItems = [];
      try {
        const rLog = await fetch(`${baseUrl}/api/log/self?p=1&page_size=10&type=4`, {
          headers: authHeaders,
        });
        if (rLog && typeof rLog.json === 'function') {
          const logData = await rLog.json().catch(() => null);
          if (logData?.data?.items && Array.isArray(logData.data.items)) {
            logItems = logData.data.items;
          }
        }
      } catch (_) {}

      const balance = this.calculateBalance(selfData, null);
      const todayCheckin = this.findTodayCheckin(logItems, todayStr, helper);

      if (checkinData?.success) {
        return {
          success: true,
          message: checkinData.message || '签到成功',
          balance,
        };
      }

      if (todayCheckin) {
        const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
        return {
          success: true,
          message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
          balance,
        };
      }

      if (checkinData?.message) {
        const msg = checkinData.message;
        if (
          msg.includes('已签到') ||
          msg.includes('重复') ||
          msg.includes('already') ||
          msg.includes('已经签到')
        ) {
          return { success: true, message: msg, balance };
        }
        return null;
      }

      return { success: true, message: '今日已签到', balance };
    } catch (_) {
      return null;
    }
  }

  /**
   * 自动打卡主入口
   */
  async onCheckin({ page, browser: _browser, log, helper }) {
    const todayStr = helper.getCSTDateString();
    const todayISO = helper.getCSTISODateString
      ? helper.getCSTISODateString()
      : todayStr.replace(/\//g, '-');
    const monthStr = todayISO.slice(0, 7);

    const captured = await this.attachSessionCapture(page);

    // 1. 打开控制台并复用页面自身发起的首次 /api/user/auth/refresh 响应，严防重复请求触发 429
    log(`[${this.name}] 正在检查当前会话与今日签到状态...`);
    const initialRefreshWait =
      typeof page.waitForResponse === 'function'
        ? page
            .waitForResponse((res) => res.url().includes('/api/user/auth/refresh'), {
              timeout: 8000,
            })
            .catch(() => null)
        : Promise.resolve(null);

    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await initialRefreshWait;
    await this.suppressAndDismissModals(page, helper);

    const isRedirectedToLogin = page.url().includes('/login') || page.url().includes('/sign-in');

    let checkResult = {
      token: captured.token,
      tokenFound: !!captured.token,
      rateLimited: captured.rateLimited,
      refreshData: captured.refreshData,
      selfData: null,
      checkinStatus: null,
      logItems: [],
      hasLocalUser: !!captured.user?.id,
    };

    if (!isRedirectedToLogin && !captured.unauthorized) {
      checkResult = await this.fetchUserData(page, captured.token, monthStr);
    }

    if (checkResult.rateLimited) {
      log(`[${this.name}] 提示：站点认证接口处于频控冷却期 (HTTP 429)，尝试复用已有会话`);
    }

    const existingStatsMsg = this.formatCheckinStatsMessage(checkResult.checkinStatus, todayISO);
    let todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);

    if (existingStatsMsg || todayCheckin) {
      let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
      if (!balance) {
        balance = await this.extractBalanceFromDom(page);
      }
      if (todayCheckin) {
        const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
        log(`[${this.name}] ⚡ 预检发现今日已完成签到，跳过登录重连流程`);
        return {
          success: true,
          message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
          balance,
        };
      }
      log(`[${this.name}] ⚡ 预检发现今日已完成签到，跳过登录重连流程`);
      return {
        success: true,
        message: existingStatsMsg,
        balance,
      };
    }

    const isSessionValid =
      !isRedirectedToLogin &&
      !captured.unauthorized &&
      (checkResult?.tokenFound ||
        checkResult?.selfData?.success ||
        checkResult?.hasLocalUser ||
        checkResult?.rateLimited);

    // 2. 若会话有效但今日尚未签到，执行签到（支持自动完成签到 Turnstile 验证）
    if (isSessionValid) {
      log(`[${this.name}] 会话有效，正在执行每日签到...`);
      const apiCheckinRes = await this.performBrowserCheckin(
        page,
        log,
        helper,
        checkResult.token || captured.token
      );
      if (apiCheckinRes?.success) {
        log(`[${this.name}] 签到成功: ${apiCheckinRes.message || '已成功获取额度'}`);
        checkResult = await this.fetchUserData(page, checkResult.token || captured.token, monthStr);
        let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
        if (!balance) {
          balance = await this.extractBalanceFromDom(page);
        }
        const quotaAwarded = apiCheckinRes?.data?.quota_awarded;
        const rewardSuffix = quotaAwarded
          ? ` (获得 $${(quotaAwarded / QUOTA_PER_USD).toFixed(2)} 额度)`
          : '';
        return {
          success: true,
          message: `${apiCheckinRes.message || '签到成功'}${rewardSuffix}`,
          balance,
        };
      }

      const checkinErrMsg = apiCheckinRes?.message || '';
      if (
        checkinErrMsg.includes('已签到') ||
        checkinErrMsg.includes('重复') ||
        checkinErrMsg.includes('already') ||
        checkinErrMsg.includes('已经签到')
      ) {
        let balance = this.calculateBalance(checkResult.selfData, checkResult.refreshData);
        if (!balance) {
          balance = await this.extractBalanceFromDom(page);
        }
        return {
          success: true,
          message: checkinErrMsg,
          balance,
        };
      }
    }

    // 3. 完整登录流程：当 Refresh Cookie 过期失效时，通过 GitHub OAuth 自动重连
    // 注意：若当前已在 /sign-in 页，严禁重复 goto 或 reload，以免浪费 /api/user/auth/* 频控配额
    if (!page.url().includes('/sign-in') && !page.url().includes('/login')) {
      log(`[${this.name}] 会话未激活或需重新认证，正在导航至登录页...`);
      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      log(`[${this.name}] 当前已位于登录页，准备触发 GitHub OAuth 重连...`);
    }

    // 确保 status 中包含 github_client_id
    await page
      .evaluate((clientId) => {
        try {
          const status = JSON.parse(localStorage.getItem('status') || '{}');
          if (!status.github_client_id) {
            status.github_oauth = true;
            status.github_client_id = clientId;
            localStorage.setItem('status', JSON.stringify(status));
          }
        } catch (_) {}
      }, GITHUB_CLIENT_ID)
      .catch(() => {});

    const ghBtnSelector =
      'button:has-text("Continue with GitHub"), button:has-text("使用 GitHub 继续"), button:has-text("GitHub")';
    const ghBtn = page.locator(ghBtnSelector).first();
    await ghBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    // 在按钮渲染完成后清理异步弹出的「📢 公告」弹窗，防止遮挡点击
    await this.suppressAndDismissModals(page, helper);

    log(`[${this.name}] 触发 GitHub OAuth 登录流程...`);
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
      targetUrl: 'https://api.justwoker.icu/dashboard',
      timeout: 30000,
    });

    await this.suppressAndDismissModals(page, helper);

    if (
      page.url().includes('/sign-in') ||
      page.url().includes('/login') ||
      page.url().includes('github.com/login')
    ) {
      if (captured.rateLimited) {
        throw new Error(
          'JustDoWork 站点认证接口当前处于 HTTP 429 频控冷却期（约 6 分钟后自动恢复），请稍后再试！'
        );
      }
      throw new Error(
        'JustDoWork GitHub OAuth 自动登录未完成（可能需要确认授权或重新登录 GitHub）。请运行 "node index.js --setup justdowork" 在弹出的原生浏览器中完成一次登录！'
      );
    }

    // 4. 登录完成后查询签到状态；若今日尚未签到则立即执行签到
    log(`[${this.name}] 登录完成，正在查询签到状态与账户额度...`);
    captured.unauthorized = false;
    checkResult = await this.fetchUserData(page, captured.token, monthStr);
    todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);
    const postLoginStatsMsg = this.formatCheckinStatsMessage(checkResult.checkinStatus, todayISO);

    if (
      !todayCheckin &&
      !postLoginStatsMsg &&
      (checkResult.tokenFound || checkResult.selfData?.success)
    ) {
      log(`[${this.name}] 今日尚未签到，正在执行签到请求...`);
      const postLoginCheckin = await this.performBrowserCheckin(
        page,
        log,
        helper,
        checkResult.token || captured.token
      );
      checkResult = await this.fetchUserData(page, checkResult.token || captured.token, monthStr);
      todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);
      const balance =
        this.calculateBalance(checkResult.selfData, checkResult.refreshData) ||
        (await this.extractBalanceFromDom(page));

      if (postLoginCheckin?.success) {
        const quotaAwarded = postLoginCheckin?.data?.quota_awarded;
        const rewardSuffix = quotaAwarded
          ? ` (获得 $${(quotaAwarded / QUOTA_PER_USD).toFixed(2)} 额度)`
          : '';
        return {
          success: true,
          message: `${postLoginCheckin.message || '签到成功'}${rewardSuffix}`,
          balance,
        };
      }

      const updatedStatsMsg = this.formatCheckinStatsMessage(checkResult.checkinStatus, todayISO);
      if (updatedStatsMsg) {
        return {
          success: true,
          message: updatedStatsMsg,
          balance,
        };
      }
    }

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

    if (postLoginStatsMsg) {
      return {
        success: true,
        message: postLoginStatsMsg,
        balance,
      };
    }

    // 5. DOM 回退检查
    log(`[${this.name}] 接口未检测到今日（${todayStr}）记录，尝试 DOM 回退检查...`);
    await page
      .goto(this.logsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => {});
    await this.suppressAndDismissModals(page, helper);

    const tableRow = page.locator('table tr, .semi-table-row').first();
    await tableRow.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    const pageText = await page
      .locator('body')
      .innerText()
      .catch(() => '');

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
