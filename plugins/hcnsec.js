const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;

class HcnsecPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'hcnsec',
      name: 'HCNSEC',
      description: 'HCNSEC API 每日自动签到与余额查询',
      url: 'https://api.hcnsec.cn/console',
      loginUrl: 'https://api.hcnsec.cn/sign-in',
      enabled: true,
    });
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
   * 交互式 Setup 模式：支持在弹出的浏览器中完成登录与 Turnstile 人机验证
   */
  async onSetup(context) {
    const { page, log } = context;
    log(`[${this.name}] Setup 模式：正在启动浏览器...`);
    log(`[${this.name}] 正在导航至登录页: ${this.loginUrl}`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 自动填入账号密码并勾选协议
    await this.fillLoginForm(page, log);

    log(`[${this.name}] 💡 请在浏览器中点击【请验证您是真人】复选框完成人机验证...`);
    log(`[${this.name}] 等待登录完成并跳转至控制台或主页 (${this.url})...`);

    // 监听 Turnstile 验证通过后自动点击提交
    const submitBtn = page.locator('form button[type="submit"]').first();
    const tryAutoSubmit = async () => {
      try {
        await page.waitForFunction(
          () => {
            const input = globalThis.document?.querySelector('input[name="cf-turnstile-response"]');
            return !!(input && input.value && input.value.length > 0);
          },
          { timeout: 60000 }
        );
        if (await submitBtn.isEnabled().catch(() => false)) {
          log(`[${this.name}] 检测到 Turnstile 验证已完成，自动点击【登录】提交...`);
          await submitBtn.click().catch(() => {});
        }
      } catch (e) {
        // 用户可能手动点击登录，忽略自动提交超时
      }
    };
    tryAutoSubmit();

    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        if (p.includes('/login') || p.includes('/sign-in')) return false;
        return (
          url.href.startsWith(this.url) ||
          p.includes('/console') ||
          p.includes('/dashboard') ||
          p.includes('/token') ||
          p.includes('/profile') ||
          p === '/'
        );
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录成功！会话已自动保存至 Profile。`);
  }

  /**
   * 在已认证的浏览器会话中执行用户数据与签到 API
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
        token = refreshJson?.data?.access_token || null;
      } catch (e) {}

      let userObj = {};
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          userObj = JSON.parse(userStr);
          if (!token) {
            token = userObj.token || userObj.access_token || null;
          }
        }
      } catch (e) {}

      const headers = {
        'Content-Type': 'application/json',
        ...(userObj.id ? { 'New-Api-User': String(userObj.id) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      let selfData = null;
      try {
        const rSelf = await fetch('/api/user/self', { credentials: 'include', headers });
        selfData = await rSelf.json();
      } catch (e) {}

      let checkinData = null;
      if (selfData?.success) {
        try {
          const rCheckin = await fetch('/api/user/checkin', {
            method: 'POST',
            credentials: 'include',
            headers,
          });
          checkinData = await rCheckin.json();
        } catch (e) {}
      }

      let logItems = [];
      try {
        const rLog = await fetch('/api/log/self?p=1&page_size=10&type=4', {
          credentials: 'include',
          headers,
        });
        const logData = await rLog.json();
        if (logData?.data?.items && Array.isArray(logData.data.items)) {
          logItems = logData.data.items;
        }
      } catch (e) {}

      return { selfData, checkinData, logItems, tokenFound: !!token };
    });
  }

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
          (item.content?.includes('签到') || item.content?.includes('每日'))
        ) {
          return item;
        }
      }
    }
    return null;
  }

  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * 核心签到逻辑：支持 Fast-Path 会话复用与降级表单登录
   */
  async onCheckin({ page, log, helper }) {
    const todayStr = helper.getCSTDateString();

    // 0. Super Fast-Path: 若 .env 中配置了 HCNSEC_TOKEN 或 HCNSEC_COOKIE，直接无缝免浏览器打卡
    const envToken = process.env.HCNSEC_TOKEN || process.env.HCNSEC_ACCESS_TOKEN;
    const envCookie = process.env.HCNSEC_COOKIE;

    if (envToken || envCookie) {
      log(`[${this.name}] 检测到 .env 中已配置 Token/Cookie，尝试通过直连凭据签到...`);
      try {
        const authHeaders = {
          'Content-Type': 'application/json',
          ...(envToken ? { Authorization: `Bearer ${envToken}` } : {}),
          ...(envCookie ? { Cookie: envCookie } : {}),
        };

        const rSelf = await fetch('https://api.hcnsec.cn/api/user/self', { headers: authHeaders });
        const selfData = await rSelf.json().catch(() => null);

        if (selfData?.success) {
          const rCheckin = await fetch('https://api.hcnsec.cn/api/user/checkin', {
            method: 'POST',
            headers: authHeaders,
          });
          const checkinData = await rCheckin.json().catch(() => null);

          let logItems = [];
          try {
            const rLog = await fetch('https://api.hcnsec.cn/api/log/self?p=1&page_size=10&type=4', {
              headers: authHeaders,
            });
            const logData = await rLog.json().catch(() => null);
            if (logData?.data?.items && Array.isArray(logData.data.items)) {
              logItems = logData.data.items;
            }
          } catch (e) {}

          const balance = this.calculateBalance(selfData);
          let message = '今日已签到';
          const todayCheckin = this.findTodayCheckin(logItems, todayStr, helper);

          if (checkinData?.success) {
            message = checkinData.message || '签到成功';
          } else if (todayCheckin) {
            const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
            message = `签到已确认: ${todayCheckin.content} (${checkinTime})`;
          } else if (checkinData?.message) {
            const msg = checkinData.message;
            if (
              msg.includes('已签到') ||
              msg.includes('重复') ||
              msg.includes('already') ||
              msg.includes('已经签到')
            ) {
              message = msg;
            } else {
              throw new Error(`HCNSEC 签到失败: ${msg}`);
            }
          }

          return { success: true, message, balance };
        }
      } catch (err) {
        log(`[${this.name}] 直连凭据验证失败: ${err.message}，回退至浏览器会话流程...`);
      }
    }

    // 1. Fast-Path: 优先检查当前持久化会话是否有效
    log(`[${this.name}] 正在检查当前会话与登录状态...`);
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await helper.dismissModals(page);

    let apiResult = await this.executeUserApi(page);

    // 2. 若会话失效或未登录，尝试在浏览器中自动登录
    if (!apiResult?.selfData?.success) {
      log(`[${this.name}] 当前会话未登录或已过期，尝试通过账号密码登录...`);
      const username = process.env.HCNSEC_USERNAME;
      const password = process.env.HCNSEC_PASSWORD;

      if (!username || !password) {
        throw new Error(
          'HCNSEC 会话失效且未在 .env 中配置账号密码！请配置 HCNSEC_USERNAME / HCNSEC_PASSWORD，或运行 "node index.js --setup hcnsec" 完成登录。'
        );
      }

      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await helper.dismissModals(page);

      await this.fillLoginForm(page, log);

      log(`[${this.name}] 等待 Cloudflare Turnstile 验证就绪...`);
      await page
        .waitForFunction(
          () => {
            const input = globalThis.document?.querySelector('input[name="cf-turnstile-response"]');
            return !!(input && input.value && input.value.length > 0);
          },
          { timeout: 10000 }
        )
        .catch(() => false);

      const submitBtn = page.locator('form button[type="submit"]').first();
      await submitBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

      if (await submitBtn.isEnabled().catch(() => false)) {
        log(`[${this.name}] 点击登录提交按钮...`);
        await submitBtn.click().catch(() => {});
      }

      // 等待离开登录页面
      const loginSucceeded = await page
        .waitForURL(
          (url) => {
            const p = url.pathname;
            return !p.includes('/login') && !p.includes('/sign-in');
          },
          { timeout: 15000, waitUntil: 'domcontentloaded' }
        )
        .catch(() => false);

      if (loginSucceeded) {
        log(`[${this.name}] 登录跳转成功，进入控制台...`);
        if (!page.url().includes('/console')) {
          await page
            .goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            .catch(() => {});
        }
        await helper.dismissModals(page);
      }

      // 重新执行 API 获取登录后数据
      apiResult = await this.executeUserApi(page);
    }

    if (!apiResult?.selfData?.success) {
      throw new Error(
        'HCNSEC 登录失败（Cloudflare Turnstile 人机验证拦截）。请运行 "node index.js --setup hcnsec" 在弹出的浏览器中完成首次人机验证与登录！'
      );
    }

    const balance = this.calculateBalance(apiResult.selfData);
    let message = '今日已签到';
    const checkinData = apiResult.checkinData;
    const todayCheckin = this.findTodayCheckin(apiResult.logItems, todayStr, helper);

    if (checkinData?.success) {
      message = checkinData.message || '签到成功';
    } else if (todayCheckin) {
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      message = `签到已确认: ${todayCheckin.content} (${checkinTime})`;
    } else if (checkinData?.message) {
      const msg = checkinData.message;
      if (
        msg.includes('已签到') ||
        msg.includes('重复') ||
        msg.includes('already') ||
        msg.includes('已经签到')
      ) {
        message = msg;
      } else {
        throw new Error(`HCNSEC 签到失败: ${msg}`);
      }
    } else if (balance) {
      message = '已处于登录状态，账户额度正常';
    }

    return {
      success: true,
      message,
      balance,
    };
  }
}

module.exports = HcnsecPlugin;
