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
    const checkinRes = await this.onCheckin({
      page: null,
      browser: null,
      log,
      helper,
    });

    log(`🎉 签到验证完成: ${checkinRes.message} | 账户余额: ${checkinRes.balance}`);
    return checkinRes;
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

    log(`[${this.name}] 💡 请在弹出的浏览器中点击【请验证您是真人】复选框完成人机验证...`);
    log(
      `[${this.name}] --------------------------------------------------------------------------------`
    );
    log(`[${this.name}] 📌 遇到 Cloudflare 提示【验证失败 故障排除】时：`);
    log(`[${this.name}] 👉 推荐使用极速通道（自动唤起日常默认浏览器并一键保存 Token）：`);
    log(`[${this.name}]    node index.js --setup hcnsec --system`);
    log(
      `[${this.name}] --------------------------------------------------------------------------------`
    );
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

    try {
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
    } catch (err) {
      log(`[${this.name}] 浏览器登录未完成或已关闭。`);
      log(`[${this.name}] 💡 提示：若受 Cloudflare 拦截，推荐直接使用 Token 方式：`);
      log(`[${this.name}]    在普通浏览器登录后按 F12 控制台运行：`);
      log(
        `[${this.name}]    fetch('/api/user/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.json()).then(res => console.log('HCNSEC_TOKEN=' + res.data?.access_token));`
      );
      log(`[${this.name}]    并将得到的 HCNSEC_TOKEN=... 写入 .env 文件即可！`);
      throw err;
    }
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

  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * Direct API 极速通道：通过已持久化的 Cookie/Token 直接完成签到与额度查询
   */
  async onDirectApiCheckin({ log, session, helper }) {
    const envToken = process.env.HCNSEC_TOKEN || process.env.HCNSEC_ACCESS_TOKEN;
    const envCookie = process.env.HCNSEC_COOKIE;

    let authHeaders = null;
    if (envToken || envCookie) {
      authHeaders = {
        'Content-Type': 'application/json',
        ...(envToken ? { Authorization: `Bearer ${envToken}` } : {}),
        ...(envCookie ? { Cookie: envCookie } : {}),
      };
    } else if (session) {
      authHeaders = {
        'Content-Type': 'application/json',
        ...(session.cookies ? { Cookie: session.cookies } : {}),
        ...session.headers,
      };
    }

    if (!authHeaders) return null;

    const todayStr = helper.getCSTDateString();
    const baseUrl = new URL(this.url).origin;

    try {
      if (log) log(`[${this.name}] 正在通过 Direct API 检查打卡状态...`);
      const rSelf = await fetch(`${baseUrl}/api/user/self`, { headers: authHeaders });
      if (rSelf.status === 401 || rSelf.status === 403) {
        return null;
      }
      const selfData = await rSelf.json().catch(() => null);
      if (!selfData?.success) return null;

      // 尝试签到
      const rCheckin = await fetch(`${baseUrl}/api/user/checkin`, {
        method: 'POST',
        headers: authHeaders,
      });
      const checkinData = await rCheckin.json().catch(() => null);

      let logItems = [];
      try {
        const rLog = await fetch(`${baseUrl}/api/log/self?p=1&page_size=10&type=4`, {
          headers: authHeaders,
        });
        const logData = await rLog.json().catch(() => null);
        if (logData?.data?.items && Array.isArray(logData.data.items)) {
          logItems = logData.data.items;
        }
      } catch (_) {}

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
          return null;
        }
      }

      return { success: true, message, balance };
    } catch (_) {
      return null;
    }
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
      await helper.resolveTurnstileToken(page, { timeoutMs: 15000 }).catch(() => null);

      const turnstileToken = await page.evaluate(() => {
        const input = globalThis.document?.querySelector('input[name="cf-turnstile-response"]');
        return input && input.value ? input.value : null;
      });

      const submitBtn = page.locator('form button[type="submit"]').first();
      await submitBtn.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

      if (turnstileToken && (await submitBtn.isEnabled().catch(() => false))) {
        log(`[${this.name}] 验证通过，点击登录提交按钮...`);
        await submitBtn.click().catch(() => {});
      } else if (await submitBtn.isEnabled().catch(() => false)) {
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
        'HCNSEC 登录失败（未通过 Cloudflare Turnstile 人机验证或 Token 已失效）。请运行 "node index.js --setup hcnsec" 在弹出的浏览器中完成登录，或运行 "node index.js --setup hcnsec --system" 唤起日常默认浏览器一键更新 Token 至 .env！'
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
