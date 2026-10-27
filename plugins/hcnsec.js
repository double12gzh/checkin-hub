const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const DEFAULT_TURNSTILE_SITEKEY = '0x4AAAAAAFIovBqwE9xMkrm_';

class HcnsecPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'hcnsec',
      name: 'HCNSEC',
      description: 'HCNSEC API 每日自动签到与余额查询',
      url: 'https://api.hcnsec.cn/console',
      loginUrl: 'https://api.hcnsec.cn/sign-in',
      enabled: true,
      turnstileStealth: true,
    });
    this.profileUrl = 'https://api.hcnsec.cn/profile';
  }

  /**
   * 自动填充登录表单（账号、密码与协议勾选）
   */
  async fillLoginForm(page, log) {
    const username = process.env.HCNSEC_USERNAME;
    const password = process.env.HCNSEC_PASSWORD;

    const usernameInput = page.locator('input[name="username"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    if (username && (await usernameInput.isVisible().catch(() => false))) {
      await usernameInput.fill(username).catch(() => {});
    }

    const passwordInput = page.locator('input[name="password"]').first();
    if (password && (await passwordInput.isVisible().catch(() => false))) {
      await passwordInput.fill(password).catch(() => {});
    }

    // 自动勾选服务条款复选框
    const agreeCheckbox = page.locator('[role="checkbox"]').first();
    if (await agreeCheckbox.isVisible().catch(() => false)) {
      const isChecked = (await agreeCheckbox.getAttribute('aria-checked')) === 'true';
      if (!isChecked) {
        await agreeCheckbox.click().catch(() => {});
      }
    }

    if (username && password) {
      log('👉 账号、密码及服务条款已自动预填完成！');
    }
  }

  /**
   * 极简系统原生浏览器模式：自动唤起日常默认浏览器并在终端接收 Token 写入 .env
   */
  async onSystemSetup({ log, helper }) {
    const readline = require('readline');
    const { updateEnv } = require('../core/env');

    log('🚀 正在通过系统原生命令唤起你的默认日常浏览器...');
    await helper.openSystemBrowser(this.loginUrl);
    log(`✅ 已在系统默认浏览器中打开登录页: ${this.loginUrl}`);

    console.log(
      '\n================================================================================'
    );
    console.log('💡 操作指南 (在刚才弹出的日常浏览器中)：');
    console.log(
      '1. 正常输入账号密码并点击【请验证您是真人】（原生浏览器绝不会报验证失败）并登录；'
    );
    console.log('2. 登录进入控制台后，按键盘 F12（或右键“检查”）打开 DevTools -> Console 控制台；');
    console.log('3. 复制运行以下单行代码回车：\n');
    console.log(
      "   fetch('/api/user/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.json()).then(res => console.log('HCNSEC_TOKEN=' + res.data?.access_token));\n"
    );
    console.log(
      '================================================================================\n'
    );

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const tokenInput = await new Promise((resolve) => {
      rl.question('👉 请在此粘贴控制台输出的 Token 或整行内容 (按回车确认): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!tokenInput) {
      throw new Error('未输入 Token，操作已取消。');
    }

    let token = tokenInput;
    if (token.startsWith('HCNSEC_TOKEN=')) {
      token = token.slice(13).trim();
    } else if (token.startsWith('TOKEN=')) {
      token = token.slice(6).trim();
    }

    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1).trim();
    }

    if (!token) {
      throw new Error('无效的 Token 内容！');
    }

    log('正在将 HCNSEC_TOKEN 保存至项目根目录的 .env 文件...');
    updateEnv('HCNSEC_TOKEN', token);
    log('✅ Token 已成功保存至 .env！');

    log('正在验证 Token 有效性并执行首次签到打卡...');
    const directRes = await this.onDirectApiCheckin({
      log,
      session: null,
      helper,
    });
    if (directRes) {
      log(`🎉 签到验证完成: ${directRes.message} | 账户余额: ${directRes.balance}`);
      return directRes;
    }
    throw new Error(
      '直连 Token 仅有效期 15 分钟且签到接口需 Turnstile 验证，推荐运行 "node index.js --setup hcnsec" 保存持久会话。'
    );
  }

  /**
   * 交互式 Setup 模式：支持在弹出的浏览器中完成登录与 Turnstile 人机验证
   */
  async onSetup(context) {
    const { page, log, helper } = context;
    log(`[${this.name}] Setup 模式：正在启动浏览器...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await helper.dismissModals(page);

    log(
      `[${this.name}] ⏳ 正在等待或自动完成 Cloudflare Turnstile 验证（也可手动点击复选框并登录）...`
    );

    const autoLoginTask = (async () => {
      try {
        const tsToken = await helper
          .resolveTurnstileToken(page, { timeoutMs: 40000 })
          .catch(() => null);
        await this.fillLoginForm(page, log);
        const submitBtn = page.locator('form button[type="submit"]').first();
        if (tsToken && (await submitBtn.isEnabled().catch(() => false))) {
          log(`[${this.name}] 检测到 Turnstile 验证已完成，自动点击【登录】提交...`);
          await submitBtn.click().catch(() => {});
        }
      } catch (_) {}
    })();

    try {
      const predicate = (url) => {
        const p = url.pathname;
        if (
          p.includes('/login') ||
          p.includes('/sign-in') ||
          p.includes('/oauth') ||
          url.hostname?.includes('github.com')
        ) {
          return false;
        }
        return (
          url.href.startsWith(this.url) ||
          p.includes('/console') ||
          p.includes('/dashboard') ||
          p.includes('/token') ||
          p.includes('/profile') ||
          p === '/'
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
      await autoLoginTask.catch(() => {});
      const todayISO = helper.getCSTISODateString
        ? helper.getCSTISODateString()
        : helper.getCSTDateString().replace(/\//g, '-');
      await this.fetchSessionStatus(page, todayISO.slice(0, 7)).catch(() => {});
      log(`[${this.name}] 登录成功！持久化 Refresh 会话已自动保存至 Profile。`);
    } catch (err) {
      log(`[${this.name}] 浏览器登录未完成或已关闭。`);
      throw err;
    }
  }

  /**
   * 在浏览器上下文内刷新短期 Access Token 并获取当前用户信息与月度签到状态
   * （注意：必须在浏览器内调用 /api/user/auth/refresh，确保 Set-Cookie 轮换的 new_api_refresh 写回浏览器 Cookie 库）
   */
  async fetchSessionStatus(page, monthStr) {
    return await page.evaluate(async (mStr) => {
      let token = null;
      try {
        const refreshRes = await fetch('/api/user/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        const refreshJson = await refreshRes.json().catch(() => null);
        token = refreshJson?.data?.access_token || null;
        if (token) {
          localStorage.setItem('token', token);
        }
      } catch (_) {}

      let userObj = {};
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          userObj = JSON.parse(userStr);
          if (!token) {
            token = userObj.token || userObj.access_token || localStorage.getItem('token') || null;
          }
        }
      } catch (_) {}

      const buildHeaders = () => ({
        'Content-Type': 'application/json',
        ...(userObj?.id ? { 'New-Api-User': String(userObj.id) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      });

      let selfData = null;
      try {
        const rSelf = await fetch('/api/user/self', {
          credentials: 'include',
          headers: buildHeaders(),
        });
        selfData = await rSelf.json().catch(() => null);
        if (selfData?.success && selfData?.data?.id) {
          userObj = selfData.data;
          try {
            localStorage.setItem('user', JSON.stringify(selfData.data));
          } catch (_) {}
        }
      } catch (_) {}

      let checkinStatus = null;
      let logItems = [];
      if (selfData?.success) {
        try {
          const rStatus = await fetch(`/api/user/checkin?month=${encodeURIComponent(mStr || '')}`, {
            credentials: 'include',
            headers: buildHeaders(),
          });
          checkinStatus = await rStatus.json().catch(() => null);
        } catch (_) {}

        try {
          const rLog = await fetch('/api/log/self?p=1&page_size=10&type=4', {
            credentials: 'include',
            headers: buildHeaders(),
          });
          const logData = await rLog.json().catch(() => null);
          if (logData?.data?.items && Array.isArray(logData.data.items)) {
            logItems = logData.data.items;
          }
        } catch (_) {}
      }

      return { selfData, checkinStatus, logItems, tokenFound: !!token };
    }, monthStr);
  }

  /**
   * 在浏览器页面内执行 POST /api/user/checkin；若要求 Turnstile 则动态挂载组件并完成验证后提交
   */
  async performBrowserCheckin(page, log, helper) {
    // 1. 先尝试无 Turnstile 直接请求（兼容站点关闭签到验证码的情况）
    const directAttempt = await page.evaluate(async () => {
      let userObj = {};
      try {
        userObj = JSON.parse(localStorage.getItem('user') || '{}');
      } catch (_) {}
      const token = localStorage.getItem('token') || userObj.token || userObj.access_token || null;
      const headers = {
        'Content-Type': 'application/json',
        ...(userObj?.id ? { 'New-Api-User': String(userObj.id) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      try {
        const res = await fetch('/api/user/checkin', {
          method: 'POST',
          credentials: 'include',
          headers,
        });
        return await res.json().catch(() => null);
      } catch (e) {
        return { success: false, message: e.message };
      }
    });

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

    // 2. 若后端要求 Turnstile 验证，则在当前页挂载显式 Turnstile 组件并过盾
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
        callback: (token) => {
          globalThis.__checkinTurnstileToken = token;
        },
      });
      return { ok: true, sitekey };
    }, DEFAULT_TURNSTILE_SITEKEY);

    if (!renderResult?.ok) {
      throw new Error(`HCNSEC 签到验证组件初始化失败: ${renderResult?.error || '未知错误'}`);
    }

    const turnstileToken = await helper.resolveTurnstileToken(page, { timeoutMs: 35000 });
    log(`[${this.name}] 签到 Turnstile 验证通过，正在提交打卡请求...`);

    const checkinResult = await page.evaluate(async (tsToken) => {
      const container = globalThis.document?.getElementById('__checkin-turnstile-box');
      if (container) container.remove();

      let userObj = {};
      try {
        userObj = JSON.parse(localStorage.getItem('user') || '{}');
      } catch (_) {}
      const token = localStorage.getItem('token') || userObj.token || userObj.access_token || null;
      const headers = {
        'Content-Type': 'application/json',
        ...(userObj?.id ? { 'New-Api-User': String(userObj.id) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const res = await fetch(`/api/user/checkin?turnstile=${encodeURIComponent(tsToken)}`, {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      return await res.json().catch(() => null);
    }, turnstileToken);

    return checkinResult;
  }

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
            itemDateISO === todayISO ||
            normalizedItem === normalizedToday) &&
          (item.content?.includes('签到') || item.content?.includes('每日'))
        ) {
          return item;
        }
      }
    }
    return null;
  }

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

  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * Direct API 极速通道：当短期 Token 仍在有效期内且今日已签到（或免验证签到成功）时极速返回；
   * 若 Token 满 15 分钟过期或签到需 Turnstile 验证，则返回 null 交由浏览器通道无缝完成。
   */
  async onDirectApiCheckin({ log, session, helper }) {
    const envToken = process.env.HCNSEC_TOKEN || process.env.HCNSEC_ACCESS_TOKEN;
    const envCookie = process.env.HCNSEC_COOKIE;

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
        if (rSelf.status === 401 || rSelf.status === 403) {
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
          balance: this.calculateBalance(selfData),
        };
      }

      // 尝试直接 POST 签到
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

      const balance = this.calculateBalance(selfData);
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
        // 需要 Turnstile 验证码时返回 null，交由 Playwright 浏览器通道自动过盾打卡
        return null;
      }

      return { success: true, message: '今日已签到', balance };
    } catch (_) {
      return null;
    }
  }

  /**
   * 核心签到逻辑：通过浏览器持久化 Refresh Cookie 续期会话，并在需要时自动完成登录与签到双端 Turnstile 验证
   */
  async onCheckin({ page, log, helper }) {
    const todayStr = helper.getCSTDateString();
    const todayISO = helper.getCSTISODateString
      ? helper.getCSTISODateString()
      : todayStr.replace(/\//g, '-');
    const monthStr = todayISO.slice(0, 7);

    // 1. 优先打开个人中心页并尝试通过持久化 HttpOnly Refresh Cookie 刷新 Access Token
    log(`[${this.name}] 正在检查当前持久化会话与签到状态...`);
    await page
      .goto(this.profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => {});
    await helper.dismissModals(page);

    let sessionStatus = await this.fetchSessionStatus(page, monthStr);

    // 2. 若 Refresh Cookie 已失效或未登录，则使用 .env 中的账号密码配合原生无痕 Chrome 自动过 Turnstile 登录
    if (!sessionStatus?.selfData?.success) {
      log(`[${this.name}] 当前会话未登录或已过期，正在通过账号密码登录...`);
      const username = process.env.HCNSEC_USERNAME;
      const password = process.env.HCNSEC_PASSWORD;

      if (!username || !password) {
        throw new Error(
          'HCNSEC 会话失效且未在 .env 中配置账号密码！请配置 HCNSEC_USERNAME / HCNSEC_PASSWORD，或运行 "node index.js --setup hcnsec" 完成登录。'
        );
      }

      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await helper.dismissModals(page);

      log(`[${this.name}] 等待登录页 Cloudflare Turnstile 验证就绪并自动完成点击...`);
      const loginTurnstileToken = await helper
        .resolveTurnstileToken(page, { timeoutMs: 35000 })
        .catch(() => null);

      await this.fillLoginForm(page, log);

      const submitBtn = page.locator('form button[type="submit"]').first();
      await submitBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

      if (loginTurnstileToken && (await submitBtn.isEnabled().catch(() => false))) {
        log(`[${this.name}] 登录页 Turnstile 验证通过，点击登录提交按钮...`);
        await submitBtn.click().catch(() => {});
      } else if (await submitBtn.isEnabled().catch(() => false)) {
        log(`[${this.name}] 点击登录提交按钮...`);
        await submitBtn.click().catch(() => {});
      }

      const loginSucceeded = await page
        .waitForURL(
          (url) => {
            const p = url.pathname;
            return !p.includes('/login') && !p.includes('/sign-in');
          },
          { timeout: 20000, waitUntil: 'domcontentloaded' }
        )
        .catch(() => false);

      if (loginSucceeded) {
        log(`[${this.name}] 登录跳转成功，正在同步个人中心与签到数据...`);
        await page
          .goto(this.profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
          .catch(() => {});
        await helper.dismissModals(page);
      }

      sessionStatus = await this.fetchSessionStatus(page, monthStr);
    }

    if (!sessionStatus?.selfData?.success) {
      throw new Error(
        'HCNSEC 登录失败（未通过 Cloudflare Turnstile 人机验证或账号凭据有误）。请运行 "node index.js --setup hcnsec" 在弹出的浏览器中完成登录。'
      );
    }

    // 3. 检查今日是否已经签到
    const existingStatsMsg = this.formatCheckinStatsMessage(sessionStatus.checkinStatus, todayISO);
    const existingLogCheckin = this.findTodayCheckin(sessionStatus.logItems, todayStr, helper);

    if (existingStatsMsg) {
      return {
        success: true,
        message: existingStatsMsg,
        balance: this.calculateBalance(sessionStatus.selfData),
      };
    }

    if (existingLogCheckin) {
      const checkinTime = helper.getCSTDateTimeString(existingLogCheckin.created_at * 1000);
      return {
        success: true,
        message: `签到已确认: ${existingLogCheckin.content} (${checkinTime})`,
        balance: this.calculateBalance(sessionStatus.selfData),
      };
    }

    // 4. 今日尚未签到：执行签到（自动处理签到接口的 Turnstile 验证）
    const checkinData = await this.performBrowserCheckin(page, log, helper);

    // 签到完成后重新拉取最新余额与签到状态
    const updatedStatus = await this.fetchSessionStatus(page, monthStr);
    const finalSelfData = updatedStatus?.selfData?.success
      ? updatedStatus.selfData
      : sessionStatus.selfData;
    const balance = this.calculateBalance(finalSelfData);

    if (checkinData?.success) {
      const quotaAwarded = checkinData?.data?.quota_awarded;
      const rewardSuffix = quotaAwarded
        ? ` (获得 $${(quotaAwarded / QUOTA_PER_USD).toFixed(2)} 额度)`
        : '';
      return {
        success: true,
        message: `${checkinData.message || '签到成功'}${rewardSuffix}`,
        balance,
      };
    }

    const updatedStatsMsg = this.formatCheckinStatsMessage(updatedStatus?.checkinStatus, todayISO);
    if (updatedStatsMsg) {
      return {
        success: true,
        message: updatedStatsMsg,
        balance,
      };
    }

    const updatedLogCheckin = this.findTodayCheckin(
      updatedStatus?.logItems || [],
      todayStr,
      helper
    );
    if (updatedLogCheckin) {
      const checkinTime = helper.getCSTDateTimeString(updatedLogCheckin.created_at * 1000);
      return {
        success: true,
        message: `签到已确认: ${updatedLogCheckin.content} (${checkinTime})`,
        balance,
      };
    }

    const errMsg = checkinData?.message || '未知错误';
    if (
      errMsg.includes('已签到') ||
      errMsg.includes('重复') ||
      errMsg.includes('already') ||
      errMsg.includes('已经签到')
    ) {
      return {
        success: true,
        message: errMsg,
        balance,
      };
    }

    throw new Error(`HCNSEC 签到失败: ${errMsg}`);
  }
}

module.exports = HcnsecPlugin;
