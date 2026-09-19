const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const AUTH_DOMAINS = ['api.justwoker.icu'];
const GITHUB_CLIENT_ID = 'Ov23liBGecTYSePKpXQC';

class JustDoWorkPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'justdowork',
      name: 'JustDoWork',
      description: 'JustDoWork 每日自动签到与额度查询',
      url: 'https://api.justwoker.icu/dashboard/overview',
      loginUrl: 'https://api.justwoker.icu/login',
      enabled: true,
    });
    this.logsUrl = 'https://api.justwoker.icu/usage-logs/common';
  }

  /**
   * 交互式 Setup 模式，支持用户在弹出的浏览器中手动完成首次登录
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
        if (p.includes('/login')) return false;
        return (
          url.href.startsWith(this.url) ||
          p.includes('/dashboard') ||
          p.includes('/usage-logs') ||
          p.includes('/console')
        );
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * 在页面已认证的上下文内调用站点内部 API 查询用户额度与近期日志
   */
  async fetchUserData(page) {
    return await page.evaluate(async () => {
      const userStr = localStorage.getItem('user');
      const userObj = userStr ? JSON.parse(userStr) : {};
      const headers = userObj.id ? { 'New-Api-User': String(userObj.id) } : {};

      let selfData = null;
      try {
        const rSelf = await fetch('/api/user/self', { credentials: 'include', headers });
        selfData = await rSelf.json();
      } catch (e) {}

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

      return { selfData, logItems };
    });
  }

  /**
   * 在页面上下文尝试调用签到接口
   */
  async triggerApiCheckin(page) {
    return await page.evaluate(async () => {
      const userStr = localStorage.getItem('user');
      const userObj = userStr ? JSON.parse(userStr) : {};
      const headers = userObj.id ? { 'New-Api-User': String(userObj.id) } : {};

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
    });
  }

  /**
   * 检查日志列表中是否存在今日（东八区 CST）的签到记录
   */
  findTodayCheckin(logItems, todayStr, helper) {
    if (!logItems || logItems.length === 0) return null;
    const todayISO = helper.getCSTISODateString ? helper.getCSTISODateString() : todayStr;
    for (const item of logItems) {
      if (item.created_at) {
        const itemDate = helper.getCSTDateString(item.created_at * 1000);
        const itemDateISO = helper.getCSTISODateString
          ? helper.getCSTISODateString(item.created_at * 1000)
          : itemDate;
        if (
          (itemDate === todayStr || itemDateISO === todayISO) &&
          (item.content?.includes('签到') || item.content?.includes('每日'))
        ) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * 计算格式化余额
   */
  calculateBalance(selfData) {
    if (selfData?.data?.quota !== undefined) {
      return `$${(selfData.data.quota / QUOTA_PER_USD).toFixed(2)}`;
    }
    return null;
  }

  /**
   * 自动打卡主入口
   */
  async onCheckin({ page, browser, log, helper }) {
    const todayStr = helper.getCSTDateString();

    // 1. Fast-Path 快速预检：尝试利用持久化 Profile 直接查询
    log(`[${this.name}] 正在检查当前会话与今日签到状态...`);
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await helper.dismissModals(page);

    let checkResult = await this.fetchUserData(page);
    let todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);

    if (todayCheckin) {
      const balance = this.calculateBalance(checkResult.selfData);
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      log(`[${this.name}] ⚡ 预检发现今日已完成签到，跳过登录重连流程`);
      return {
        success: true,
        message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
        balance,
      };
    }

    // 2. 若会话有效但尚未签到，尝试调用直接签到接口
    if (checkResult?.selfData?.success) {
      log(`[${this.name}] 会话有效，尝试直接调用签到接口...`);
      const apiCheckinRes = await this.triggerApiCheckin(page);
      if (apiCheckinRes?.success) {
        log(`[${this.name}] API 签到成功: ${apiCheckinRes.message || '已成功获取额度'}`);
        // 重新拉取最新余额与日志
        checkResult = await this.fetchUserData(page);
        const balance = this.calculateBalance(checkResult.selfData);
        return {
          success: true,
          message: apiCheckinRes.message || '签到成功',
          balance,
        };
      }
    }

    // 3. 完整流程：未检测到签到记录或会话失效，执行登录流程触发每日登录签到
    log(`[${this.name}] 今日未签到或会话已过期，开始重新认证触发签到...`);
    await helper.clearSiteStorage(page);
    await helper.clearCookies(browser, AUTH_DOMAINS);

    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
        return u.includes('/dashboard') || u.includes('/usage-logs') || u.includes('/console');
      },
      targetUrl: this.url,
      timeout: 30000,
    });

    // 4. 重新获取签到结果与余额
    log(`[${this.name}] 登录完成，正在查询签到日志与账户额度...`);
    checkResult = await this.fetchUserData(page);
    todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);
    const balance = this.calculateBalance(checkResult.selfData);

    if (todayCheckin) {
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      return {
        success: true,
        message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
        balance,
      };
    }

    // 5. DOM Fallback 兜底检查
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
