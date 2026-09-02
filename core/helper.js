/**
 * PageHelper provides a rich toolkit for common browser automation operations.
 */
class PageHelper {
  /**
   * Format timestamp into CST date string (YYYY/M/D or localized).
   */
  static getCSTDateString(timestampMs = Date.now()) {
    return new Date(timestampMs).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  /**
   * Format timestamp into CST date time string.
   */
  static getCSTDateTimeString(timestampMs = Date.now()) {
    return new Date(timestampMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  /**
   * Dismiss common popups, announcement modals, and overlays instantly.
   * Uses a single combined selector to avoid serial timeout penalties.
   * @param {import('playwright').Page} page
   * @param {string[]} [customSelectors]
   */
  static async dismissModals(page, customSelectors = []) {
    const defaultSelectors = [
      'button:has-text("今日关闭")',
      'button:has-text("关闭公告")',
      'button:has-text("关闭")',
      'button:has-text("Close")',
      '.semi-modal-close',
      'button[aria-label="Close"]',
    ];

    const combined = [...customSelectors, ...defaultSelectors].join(', ');
    try {
      const modalBtn = page.locator(combined).first();
      if (await modalBtn.isVisible().catch(() => false)) {
        await modalBtn.click().catch(() => {});
      }

      const overlay = page.locator('.semi-modal-wrap, .modal-backdrop, .overlay');
      if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
      }
    } catch (e) {
      // Ignore modal dismissal failures
    }
  }

  /**
   * Handle OAuth popup flow without waiting for non-existent auto-redirects.
   * @param {Object} params
   * @param {import('playwright').Page} params.page
   * @param {string} params.triggerSelector
   * @param {string} [params.popupMatch]
   * @param {string} [params.targetUrl]
   * @param {number} [params.timeout=20000]
   */
  static async handleOAuth({ page, triggerSelector, popupMatch, targetUrl, timeout = 20000 }) {
    const triggerBtn = page.locator(triggerSelector).first();
    const isVisible = await triggerBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isVisible) {
      throw new Error(`OAuth 触发按钮未找到: "${triggerSelector}". 请检查选择器或重新运行 --setup 进行登录。`);
    }

    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 10000 }).catch(() => null),
      triggerBtn.click(),
    ]);

    if (popup) {
      if (popupMatch) {
        await Promise.race([
          popup.waitForURL(popupMatch, { timeout }),
          popup.waitForEvent('close', { timeout }),
        ]).catch(() => {});
      }
      await popup.close().catch(() => {});
    }

    // Directly navigate main page to destination to avoid waiting 15s timeout
    if (targetUrl) {
      const cleanTarget = targetUrl.replace(/^\*+/, '').replace(/\*+$/, '');
      let dest = cleanTarget;
      try {
        dest = cleanTarget.startsWith('http') ? cleanTarget : new URL(cleanTarget, page.url()).href;
      } catch (e) {
        dest = cleanTarget;
      }
      if (dest.startsWith('http')) {
        await page.goto(dest, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
      }
    }

    await this.dismissModals(page);
  }

  /**
   * Clear cookies for specified domains.
   * @param {import('playwright').BrowserContext} browser
   * @param {string[]} domains
   */
  static async clearCookies(browser, domains = []) {
    try {
      const cookies = await browser.cookies();
      for (const c of cookies) {
        if (domains.some((d) => c.domain.includes(d))) {
          await browser.clearCookies({ name: c.name, domain: c.domain });
        }
      }
    } catch (e) {
      // Ignore cookie clear errors
    }
  }

  /**
   * Clear site localStorage & sessionStorage.
   * @param {import('playwright').Page} page
   * @param {string} [logoutApiUrl]
   */
  static async clearSiteStorage(page, logoutApiUrl = '/api/user/logout') {
    await page.evaluate(async (apiPath) => {
      if (apiPath) {
        try {
          await fetch(apiPath, { method: 'POST', credentials: 'include' });
        } catch (e) {}
      }
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
    }, logoutApiUrl).catch(() => {});
  }
}

module.exports = { PageHelper };
