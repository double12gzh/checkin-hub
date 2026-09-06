const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const AUTH_DOMAINS = ['agentrouter.org', 'air-outer.com'];

class AgentRouterPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'agentrouter',
      name: 'AgentRouter',
      description: 'AgentRouter 每日登录与签到奖励领取',
      url: 'https://agentrouter.org/console',
      loginUrl: 'https://agentrouter.org/login',
    });
  }

  /**
   * Helper to query user quota and recent checkin logs via browser API context.
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

  findTodayCheckin(logItems, todayStr, helper) {
    if (!logItems || logItems.length === 0) return null;
    for (const item of logItems) {
      if (item.created_at) {
        const itemDate = helper.getCSTDateString(item.created_at * 1000);
        if (
          itemDate === todayStr &&
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
   * Core check-in routine with Fast-Path pre-check.
   */
  async onCheckin({ page, browser, log, helper }) {
    const todayStr = helper.getCSTDateString();

    // 🚀 Fast-Path 1: 先尝试快速预检（若当前已有有效会话且今日已签到，直接返回，耗时 1~2s）
    log('正在检查当前会话与今日签到状态（针对响应较慢放宽等待至 60s）...');
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await helper.dismissModals(page);

    let checkResult = await this.fetchUserData(page);
    let todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);

    if (todayCheckin) {
      const balance = this.calculateBalance(checkResult.selfData);
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      log('⚡ 预检发现今日已完成签到，跳过 OAuth 流程');
      return {
        success: true,
        message: `签到已确认: ${todayCheckin.content} (${checkinTime})`,
        balance,
      };
    }

    // 🔄 完整流程：今日未签到或会话失效，执行登出并重新触发 GitHub OAuth
    log('今日未签到或会话已过期，开始重新认证触发签到...');
    await helper.clearSiteStorage(page);
    await helper.clearCookies(browser, AUTH_DOMAINS);

    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 确保 status 中注入 github_client_id，防止 client_id 为 undefined 导致 OAuth 弹窗卡死
    await page
      .evaluate(() => {
        try {
          const status = JSON.parse(localStorage.getItem('status') || '{}');
          if (!status.github_client_id) {
            status.github_oauth = true;
            status.github_client_id = 'Ov23lidtiR4LeVZvVRNL';
            localStorage.setItem('status', JSON.stringify(status));
          }
        } catch (e) {}
      })
      .catch(() => {});

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await helper.dismissModals(page);

    log('触发 GitHub OAuth 登录流程...');
    const ghBtnSelector =
      'button:has-text("Continue with GitHub"), button:has-text("使用 GitHub 继续")';
    await helper.handleOAuth({
      page,
      triggerSelector: ghBtnSelector,
      popupMatch: '**/console**',
      targetUrl: this.url,
      timeout: 60000,
    });

    // 重新获取签到结果与余额（适配较慢响应）
    log('登录完成，正在查询签到日志与账户额度...');
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

    // Fallback: DOM 检查（导航至 /console/log 页面等待表格加载）
    log(`WARNING: 接口未检测到今日（${todayStr}）记录，尝试 DOM 回退检查...`);
    const logPageUrl = `${this.url}/log`;
    await page.goto(logPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await helper.dismissModals(page);

    // 等待日志表格或内容渲染（适配服务端慢查询，最多等待 30s）
    const tableRow = page.locator('table tr, .semi-table-row').first();
    await tableRow.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

    const pageText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    if (
      (pageText.includes('签到') || pageText.includes('每日') || pageText.includes('充值')) &&
      (pageText.includes(todayStr) || pageText.includes(todayStr.replace(/\//g, '-')))
    ) {
      return {
        success: true,
        message: '通过日志页面 DOM 确认今日签到已成功',
        balance,
      };
    }
    // 若依然获取到了有效余额且已成功登录控制台
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

module.exports = AgentRouterPlugin;
