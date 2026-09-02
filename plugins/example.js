const { BasePlugin } = require('../core/base-plugin');

/**
 * ExamplePlugin 演示如何快速开发一个新站点的打卡插件。
 */
class ExamplePlugin extends BasePlugin {
  constructor() {
    super({
      id: 'example',
      name: '示例站点打卡',
      description: '演示通用打卡插件结构模版',
      url: 'https://example.com/dashboard',
      loginUrl: 'https://example.com/login',
      enabled: false, // 默认不启用示例插件
    });
  }

  /**
   * 打卡逻辑实现
   * @param {Object} context
   * @param {import('playwright').Page} context.page
   * @param {import('playwright').BrowserContext} context.browser
   * @param {Function} context.log
   * @param {import('../core/helper').PageHelper} context.helper
   */
  async onCheckin({ page, log, helper }) {
    log('正在打开目标页面...');
    await page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await helper.dismissModals(page);

    // 查找并点击签到按钮
    const checkinBtn = page.locator('button:has-text("签到"), button:has-text("Check In")').first();
    if (await checkinBtn.isVisible().catch(() => false)) {
      await checkinBtn.click();
      log('已点击签到按钮');
    }

    return {
      success: true,
      message: '打卡完成',
      balance: '100 积分',
    };
  }
}

module.exports = ExamplePlugin;
