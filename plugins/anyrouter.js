const { BasePlugin } = require('../core/base-plugin');

const QUOTA_PER_USD = 500_000;
const AUTH_DOMAINS = ['anyrouter.top', 'c.cspok.cn'];
const AFF_CODE = 'ZZ16';

class AnyRouterPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'anyrouter',
      name: 'AnyRouter',
      description: 'AnyRouter 每日登录与签到奖励领取',
      url: 'https://anyrouter.top/console',
      loginUrl: 'https://anyrouter.top/login',
    });
    this.registerUrl = `https://anyrouter.top/register?aff=${AFF_CODE}`;
  }

  /**
   * 交互式 Setup 模式，支持自动带入邀请码
   */
  async onSetup(context) {
    const { page, log } = context;
    log(`[${this.name}] Setup 模式：请在弹出的浏览器中完成登录...`);
    log(`[${this.name}] 正在导航至注册/登录页并绑定邀请码: ${this.registerUrl}`);
    await page.goto(this.registerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 确保 localStorage 中存有邀请码与 OAuth 状态
    await page
      .evaluate((aff) => {
        try {
          localStorage.setItem('aff', aff);
        } catch (e) {}
      }, AFF_CODE)
      .catch(() => {});

    log(`[${this.name}] 等待登录完成并跳转至控制台 (${this.url})...`);
    await page.waitForURL('**/console**', { timeout: 300000 });
    log(`[${this.name}] 登录成功！会话已自动保存。`);
  }

  /**
   * 通过站点内部 API 查询用户额度与近期签到日志
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
   * 自动打卡主流程：支持快速预检与 GitHub OAuth 流程
   */
  async onCheckin({ page, browser, log, helper }) {
    const todayStr = helper.getCSTDateString();

    // 🚀 Fast-Path 1: 先尝试快速预检（若当前已有有效会话且今日已签到，直接返回，耗时 1~2s）
    log('正在检查当前会话与今日签到状态...');
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await helper.dismissModals(page);

    let checkResult = await this.fetchUserData(page);
    let todayCheckin = this.findTodayCheckin(checkResult.logItems, todayStr, helper);

    if (todayCheckin) {
      const balance = this.calculateBalance(checkResult.selfData);
      const checkinTime = helper.getCSTDateTimeString(todayCheckin.created_at * 1000);
      log('⚡ 预检发现今日已完成签到，跳过 OAuth 认证');
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

    // 访问登录页，预置 aff 与 status 配置，确保渲染 GitHub OAuth 按钮
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page
      .evaluate((aff) => {
        try {
          if (!localStorage.getItem('aff')) localStorage.setItem('aff', aff);
          if (!localStorage.getItem('status')) {
            localStorage.setItem(
              'status',
              JSON.stringify({
                github_oauth: true,
                github_client_id: 'Ov23liOwlnIiYoF3bUqw',
              })
            );
          }
        } catch (e) {}
      }, AFF_CODE)
      .catch(() => {});

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await helper.dismissModals(page, [
      'button:has-text("Close Notice")',
      'button:has-text("Close Today")',
      'button:has-text("关闭公告")',
      'button:has-text("今日关闭")',
    ]);

    // 如果界面显示的是用户名密码表单且有“其他登录选项”，点击展开第三方登录
    const otherLoginBtn = page
      .locator('button:has-text("其他登录选项"), button:has-text("Other login options")')
      .first();
    const ghBtnSelector =
      'button:has-text("使用 GitHub 继续"), button:has-text("Continue with GitHub"), button:has-text("GitHub")';

    if (await otherLoginBtn.isVisible().catch(() => false)) {
      const isGhVisible = await page
        .locator(ghBtnSelector)
        .first()
        .isVisible()
        .catch(() => false);
      if (!isGhVisible) {
        log('点击「其他登录选项」展开 GitHub 登录...');
        await otherLoginBtn.click().catch(() => {});
        await page
          .locator(ghBtnSelector)
          .first()
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => {});
      }
    }

    log('触发 GitHub OAuth 登录流程（复用已缓存 GitHub 账号）...');

    await helper.handleOAuth({
      page,
      triggerSelector: ghBtnSelector,
      popupMatch: '**/console**',
      targetUrl: this.url,
      timeout: 25000,
    });

    // 重新获取签到结果与余额
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

    // DOM 检查 fallback
    log(`接口未检测到今日（${todayStr}）记录，尝试 DOM 回退检查...`);
    await page
      .goto(`${this.url}/log`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      .catch(() => {});
    await helper.dismissModals(page);

    const pageText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    if ((pageText.includes('签到') || pageText.includes('充值')) && pageText.includes(todayStr)) {
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
        message: `登录完成，当前余额正常`,
        balance,
      };
    }

    throw new Error(`签到未生效，未检测到今日（${todayStr}）的签到成功日志！`);
  }
}

module.exports = AnyRouterPlugin;
