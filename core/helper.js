/* global window, document */

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
   * Format timestamp into ISO CST date string (YYYY-MM-DD).
   */
  static getCSTISODateString(timestampMs = Date.now()) {
    const date = new Date(timestampMs);
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
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
      '[data-testid="notice-dialog-close"]',
      '[data-testid="notice-dialog-close-today"]',
      '[data-slot="dialog-close"]',
      'button:has-text("今日不再显示")',
      'button:has-text("Don\'t show again today")',
      'button:has-text("今日关闭")',
      'button:has-text("关闭公告")',
      'button:has-text("关闭")',
      'button:has-text("Close")',
      '.semi-modal-close',
      'button[aria-label="Close"]',
    ];

    const overlaySelectors = [
      '[data-slot="dialog-overlay"]',
      '[data-slot="dialog-portal"]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.semi-modal-wrap',
      '.modal-backdrop',
      '.overlay',
    ];

    const combined = [...customSelectors, ...defaultSelectors].join(', ');
    try {
      const modalBtn = page.locator(combined).first();
      if (await modalBtn.isVisible().catch(() => false)) {
        await modalBtn.click().catch(() => {});
      }

      const overlay = page.locator(overlaySelectors.join(', ')).first();
      if (await overlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await overlay.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
      }
    } catch (e) {
      // Ignore modal dismissal failures
    }
  }

  /**
   * Synchronize fresh GitHub OAuth session cookies from sibling profiles in .browser-data
   * when the current isolated profile's GitHub user_session cookie is missing or expired.
   * @param {import('playwright').BrowserContext} [browser]
   */
  static async syncGitHubSessionCookies(browser) {
    if (
      !browser ||
      typeof browser.cookies !== 'function' ||
      typeof browser.addCookies !== 'function'
    ) {
      return false;
    }
    try {
      const nowSec = Date.now() / 1000;
      const existing = await browser.cookies('https://github.com').catch(() => []);
      const hasValidSession = existing.some(
        (c) => c.name === 'user_session' && c.value && (!c.expires || c.expires > nowSec + 300)
      );
      if (hasValidSession) {
        return true;
      }

      const fs = require('fs');
      const path = require('path');
      const browserDataDir = path.resolve(__dirname, '..', '.browser-data');
      if (!fs.existsSync(browserDataDir)) return false;

      let bestCookies = null;
      let bestExpiry = 0;

      for (const entry of fs.readdirSync(browserDataDir)) {
        const statePath = path.join(browserDataDir, entry, 'state.json');
        if (!fs.existsSync(statePath)) continue;
        try {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          const ghCookies = (state.cookies || []).filter(
            (c) => c && c.domain && c.domain.includes('github.com')
          );
          const userSession = ghCookies.find(
            (c) => c.name === 'user_session' && c.value && c.expires > nowSec + 300
          );
          if (userSession && userSession.expires > bestExpiry) {
            bestExpiry = userSession.expires;
            bestCookies = ghCookies;
          }
        } catch (_) {}
      }

      if (!bestCookies || bestCookies.length === 0) return false;

      const normalized = bestCookies.map((c) => {
        if (c.name.startsWith('__Host-')) {
          return {
            name: c.name,
            value: c.value,
            url: 'https://github.com',
            secure: true,
            httpOnly: Boolean(c.httpOnly),
            sameSite: c.sameSite || 'Strict',
            ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
          };
        }
        return {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: Boolean(c.secure),
          httpOnly: Boolean(c.httpOnly),
          sameSite: c.sameSite || 'Lax',
          ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
        };
      });

      await browser.addCookies(normalized);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Handle OAuth flow (supports both popup mode and direct redirection).
   * @param {Object} params
   * @param {import('playwright').Page} params.page
   * @param {string} params.triggerSelector
   * @param {string} [params.popupMatch]
   * @param {string} [params.targetUrl]
   * @param {number} [params.timeout=20000]
   */
  static async handleOAuth({ page, triggerSelector, popupMatch, targetUrl, timeout = 25000 }) {
    if (typeof page.context === 'function') {
      await this.syncGitHubSessionCookies(page.context()).catch(() => {});
    }

    await this.dismissModals(page);

    const triggerBtn = page.locator(triggerSelector).first();
    await triggerBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await this.dismissModals(page);

    const isVisible = await triggerBtn.isVisible().catch(() => false);
    if (!isVisible) {
      throw new Error(
        `OAuth 触发按钮未找到: "${triggerSelector}". 请检查选择器或重新运行 --setup 进行登录。`
      );
    }
    const cleanTarget = targetUrl ? targetUrl.replace(/^\*+/, '').replace(/\*+$/, '') : '';
    const cleanPopupMatch =
      typeof popupMatch === 'string' ? popupMatch.replace(/^\*+/, '').replace(/\*+$/, '') : null;

    const initialUrl = typeof page.url === 'function' ? page.url() : '';

    const clickTrigger = async () => {
      try {
        await triggerBtn.click({ timeout: 8000 });
      } catch (err) {
        if (
          err.message &&
          (err.message.includes('intercepts pointer events') || err.message.includes('Timeout'))
        ) {
          await this.dismissModals(page);
          await page.keyboard.press('Escape');
          await triggerBtn.click({ timeout: 10000 });
        } else {
          throw err;
        }
      }
    };

    const popupOrRedirect = Promise.race([
      page.waitForEvent('popup', { timeout: 10000 }).catch(() => null),
      typeof page.waitForURL === 'function' && initialUrl
        ? page
            .waitForURL((u) => (u.href || u.toString()) !== initialUrl, {
              timeout: 10000,
              waitUntil: 'domcontentloaded',
            })
            .then(() => null)
            .catch(() => null)
        : new Promise((r) => setTimeout(() => r(null), 10000)), // ok: sleep
    ]);

    const [popup] = await Promise.all([popupOrRedirect, clickTrigger()]);

    if (popup) {
      const isTargetUrl = (url) => {
        let urlObj;
        try {
          urlObj = typeof url === 'string' ? new URL(url) : url;
        } catch (_) {
          urlObj = { href: String(url), pathname: String(url), toString: () => String(url) };
        }
        const u = urlObj.href || urlObj.toString();
        // 排除中间授权/登录阶段
        if (
          u.includes('/oauth/github') ||
          u.includes('/api/oauth') ||
          u.includes('/login') ||
          u.includes('github.com/login')
        ) {
          return false;
        }
        if (typeof popupMatch === 'function') {
          return popupMatch(urlObj);
        }
        if (cleanPopupMatch && u.includes(cleanPopupMatch)) {
          return true;
        }
        return (
          u.includes('/dashboard') ||
          u.includes('/console') ||
          (cleanTarget && u.includes(cleanTarget))
        );
      };

      if (!popup.isClosed() && !isTargetUrl(popup.url())) {
        const authBtn = popup
          .locator(
            'button:has-text("Authorize"), button[name="authorize"], input[value="Authorize"]'
          )
          .first();

        await Promise.race([
          authBtn
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(async () => {
              await authBtn.click().catch(() => {});
            })
            .catch(() => {}),
          popup.waitForURL(isTargetUrl, { timeout, waitUntil: 'domcontentloaded' }).catch(() => {}),
          popup.waitForEvent('close', { timeout }).catch(() => {}),
        ]).catch(() => {});

        if (!popup.isClosed() && !isTargetUrl(popup.url())) {
          await Promise.race([
            popup
              .waitForURL(isTargetUrl, { timeout, waitUntil: 'domcontentloaded' })
              .catch(() => {}),
            popup.waitForEvent('close', { timeout }).catch(() => {}),
          ]).catch(() => {});
        }
      }

      if (!popup.isClosed()) {
        await popup.waitForLoadState('networkidle').catch(() => {});
        await popup.close().catch(() => {});
      }

      if (targetUrl) {
        let dest;
        try {
          dest = cleanTarget.startsWith('http')
            ? cleanTarget
            : new URL(cleanTarget, page.url()).href;
        } catch (_) {
          dest = cleanTarget;
        }
        if (dest.startsWith('http')) {
          await page.goto(dest, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
        }
      }
    } else {
      // Direct redirect mode in the current page
      const isDirectTargetUrl = (url) => {
        const u = (url && (url.href || url.toString())) || '';
        if (
          u.includes('/oauth/github') ||
          u.includes('/api/oauth') ||
          u.includes('/login') ||
          u.includes('/sign-in') ||
          u.includes('github.com')
        ) {
          return false;
        }
        return (
          u.includes('/dashboard') ||
          u.includes('/console') ||
          (targetUrl && u.includes(targetUrl)) ||
          (cleanTarget && u.includes(cleanTarget))
        );
      };

      // 1. Wait for either the GitHub authorization consent screen or final destination
      const authBtnSelector =
        'button:has-text("Authorize"), input[value="Authorize"], button[name="authorize"]';
      if (!isDirectTargetUrl(page.url())) {
        await Promise.race([
          page
            .waitForSelector(authBtnSelector, { timeout: 8000 })
            .then(async (btn) => {
              if (btn && (await btn.isVisible().catch(() => false))) {
                await btn.click().catch(() => {});
              }
            })
            .catch(() => {}),
          page
            .waitForURL(isDirectTargetUrl, { timeout, waitUntil: 'domcontentloaded' })
            .catch(() => {}),
        ]);
      }

      // 2. Wait until redirection completes to the target or dashboard (ignoring intermediate /oauth callback)
      if (!isDirectTargetUrl(page.url()) && !page.url().includes('github.com/login')) {
        await page
          .waitForURL(isDirectTargetUrl, { timeout, waitUntil: 'domcontentloaded' })
          .catch(() => {});
      }

      // 3. Ensure we are on target page if OAuth succeeded
      const currentUrl = page.url();
      const isStuckOnAuth =
        currentUrl.includes('github.com/login') ||
        currentUrl.includes('/sign-in') ||
        currentUrl.includes('/login');
      if (targetUrl && !isStuckOnAuth && !isDirectTargetUrl(currentUrl)) {
        let dest;
        try {
          dest = cleanTarget.startsWith('http')
            ? cleanTarget
            : new URL(cleanTarget, currentUrl).href;
        } catch (_) {
          dest = cleanTarget;
        }
        if (dest.startsWith('http') && !currentUrl.includes(dest)) {
          await page.goto(dest, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
        }
      }
    }

    await this.dismissModals(page);
  }

  /**
   * Clear cookies for specified domains while preserving Cloudflare and WAF security clearance cookies.
   * @param {import('playwright').BrowserContext} browser
   * @param {string[]} domains
   * @param {boolean} [preserveSecurityCookies=true]
   */
  static async clearCookies(browser, domains = [], preserveSecurityCookies = true) {
    const WAF_SECURITY_COOKIES = ['__cf_bm', 'cf_clearance', '_cfuvid', 'acw_tc', 'acw_sc'];
    try {
      const cookies = await browser.cookies();
      for (const c of cookies) {
        // 保留 WAF 与安全凭证，避免破坏站点信誉机制
        if (preserveSecurityCookies && WAF_SECURITY_COOKIES.some((sec) => c.name.startsWith(sec))) {
          continue;
        }
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
    await page
      .evaluate(async (apiPath) => {
        if (apiPath) {
          try {
            await fetch(apiPath, { method: 'POST', credentials: 'include' });
          } catch (e) {}
        }
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {}
      }, logoutApiUrl)
      .catch(() => {});
  }

  /**
   * Open a URL in the user's native system default browser.
   * Cross-platform support for macOS (open), Windows (start), and Linux (xdg-open).
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  static async openSystemBrowser(url) {
    const { exec } = require('child_process');
    let cmd = '';
    if (process.platform === 'darwin') {
      cmd = `open "${url}"`;
    } else if (process.platform === 'win32') {
      cmd = `start "" "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }
    return new Promise((resolve) => {
      exec(cmd, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Score-based Cloudflare challenge detection.
   * Evaluates strong (+3), medium (+2), and weak (+1) markers in page context.
   * @param {import('playwright').Page} page
   * @returns {Promise<{ isChallenge: boolean, score: number, strong: string[], medium: string[], weak: string[] }>}
   */
  static async detectCloudflareChallenge(page) {
    try {
      return await page.evaluate((win) => {
        const w = win || window;
        const d = w.document || document;
        let score = 0;
        const strong = [];
        const medium = [];
        const weak = [];

        // Strong markers (+3)
        if (typeof w._cf_chl_opt !== 'undefined') {
          score += 3;
          strong.push('_cf_chl_opt');
        }
        const scripts = Array.from(d.querySelectorAll('script[src]') || []);
        if (scripts.some((s) => s.src && s.src.includes('challenge-platform'))) {
          score += 3;
          strong.push('challenge-platform');
        }
        if (scripts.some((s) => s.src && s.src.includes('trace-jsch'))) {
          score += 3;
          strong.push('trace-jsch');
        }
        if (d.querySelector('form#challenge-form, form[action*="challenge"]')) {
          score += 3;
          strong.push('challenge-form');
        }

        // Medium markers (+2)
        if (d.querySelector('#cf-content')) {
          score += 2;
          medium.push('cf-content');
        }
        if (d.querySelector('#cf-wrapper')) {
          score += 2;
          medium.push('cf-wrapper');
        }
        const bodyText = d.body?.innerText || '';
        if (bodyText.includes('Error 1020') || bodyText.includes('Access denied')) {
          score += 2;
          medium.push('cf-error-text');
        }
        const href = w.location?.href || '';
        if (href.includes('/cdn-cgi/')) {
          score += 2;
          medium.push('cdn-cgi-url');
        }

        // Weak markers (+1)
        const title = (d.title || '').toLowerCase();
        if (
          title.includes('just a moment') ||
          title.includes('please wait') ||
          title.includes('attention required')
        ) {
          score += 1;
          weak.push('cf-title');
        }
        if (d.querySelector('iframe[src*="turnstile"], .cf-turnstile')) {
          score += 1;
          weak.push('turnstile');
        }

        const isChallenge =
          strong.length > 0 || (score >= 3 && (medium.length > 0 || weak.length > 0));
        return { isChallenge, score, strong, medium, weak };
      });
    } catch (e) {
      return { isChallenge: false, score: 0, strong: [], medium: [], weak: [] };
    }
  }

  /**
   * Wait for Cloudflare challenge bypass.
   * Returns immediately if no challenge detected.
   * @param {import('playwright').Page} page
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=30000]
   * @param {number} [options.pollIntervalMs=500]
   * @returns {Promise<boolean>}
   */
  static async waitForCloudflareBypass(page, options = {}) {
    const timeoutMs = options.timeoutMs || 30000;
    const pollIntervalMs = options.pollIntervalMs || 500;

    const initial = await this.detectCloudflareChallenge(page);
    if (!initial.isChallenge) {
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs)); // ok: sleep
      try {
        const check = await this.detectCloudflareChallenge(page);
        if (!check.isChallenge) {
          return true;
        }
      } catch (_) {
        // Page navigating, retry next tick
      }
    }
    return false;
  }

  /**
   * Stimulate and extract Cloudflare Turnstile token.
   * Supports pre-trigger clicks and user-like Pointer/Mouse events.
   * @param {import('playwright').Page} page
   * @param {Object} [options]
   * @param {string} [options.preTriggerSelector]
   * @param {number} [options.timeoutMs=25000]
   * @param {number} [options.pollIntervalMs=300]
   * @returns {Promise<string>}
   */
  static async resolveTurnstileToken(page, options = {}) {
    const timeoutMs = options.timeoutMs || 35000;
    const pollIntervalMs = options.pollIntervalMs || 500;
    const initialWaitMs = options.initialWaitMs ?? 8500;
    const retryClickIntervalMs = options.retryClickIntervalMs || 8500;

    if (options.preTriggerSelector) {
      try {
        const trigger = page.locator(options.preTriggerSelector).first();
        if (await trigger.isVisible().catch(() => false)) {
          await trigger.click().catch(() => {});
        }
      } catch (_) {}
    }

    const readToken = async () => {
      return await page.evaluate((docParam) => {
        if (
          typeof window !== 'undefined' &&
          typeof window.__checkinTurnstileToken === 'string' &&
          window.__checkinTurnstileToken.trim().length > 0
        ) {
          return window.__checkinTurnstileToken.trim();
        }
        const d = docParam || document;
        const field = d.querySelector('[name="cf-turnstile-response"]');
        if (field && typeof field.value === 'string' && field.value.trim().length > 0) {
          return field.value.trim();
        }
        return null;
      });
    };

    let token = await readToken().catch(() => null);
    if (token) return token;

    const start = Date.now();
    let frameFirstSeenAt = 0;
    let lastClickAt = 0;

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs)); // ok: sleep
      token = await readToken().catch(() => null);
      if (token) return token;

      // Wait for Turnstile iframe spinner to finish rendering checkbox before clicking
      try {
        if (typeof page.frames === 'function') {
          const turnstileFrame = page
            .frames()
            .find(
              (f) =>
                f.url &&
                (f.url().includes('challenges.cloudflare.com') || f.url().includes('turnstile'))
            );
          if (turnstileFrame && typeof turnstileFrame.frameElement === 'function') {
            const frameEl = await turnstileFrame.frameElement().catch(() => null);
            if (frameEl) {
              const box = await frameEl.boundingBox().catch(() => null);
              if (box && box.width > 0 && box.height > 0) {
                const now = Date.now();
                if (!frameFirstSeenAt) {
                  frameFirstSeenAt = now;
                }
                if (
                  now - frameFirstSeenAt >= initialWaitMs &&
                  now - lastClickAt >= retryClickIntervalMs
                ) {
                  lastClickAt = now;
                  const clickX = box.x + Math.min(28, box.width / 2);
                  const clickY = box.y + box.height / 2;
                  if (page.mouse && typeof page.mouse.click === 'function') {
                    await page.mouse.move(clickX, clickY, { steps: 6 }).catch(() => {});
                    await page.mouse.click(clickX, clickY, { delay: 65 }).catch(() => {});
                  } else {
                    await frameEl
                      .click({ position: { x: Math.min(28, box.width / 2), y: box.height / 2 } })
                      .catch(() => {});
                  }
                }
              }
            }
          }
        }
      } catch (_) {}
    }

    throw new Error(
      'Turnstile 验证码未在限定时间内完成，可能受限于当前网络 IP 信誉，请运行 node index.js --setup <id> 进行一次交互式人工验证。'
    );
  }

  /**
   * Save browser persistent storage state (cookies + localStorage) to JSON.
   * @param {import('playwright').BrowserContext} browser
   * @param {string} statePath
   * @returns {Promise<boolean>}
   */
  static async saveStorageState(browser, statePath) {
    if (!browser || typeof browser.storageState !== 'function' || !statePath) {
      return false;
    }
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await browser.storageState({ path: statePath });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Load and parse storage state JSON into headers and cookie string for fetch.
   * @param {string} statePath
   * @returns {{ cookies: string, headers: Record<string, string>, rawState: Object } | null}
   */
  static loadSessionFromState(statePath) {
    if (!statePath) return null;
    const fs = require('fs');
    if (!fs.existsSync(statePath)) return null;

    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      const rawState = JSON.parse(content);
      const cookiesList = Array.isArray(rawState.cookies) ? rawState.cookies : [];

      const cookieHeader = cookiesList
        .filter((c) => c && c.name && typeof c.value !== 'undefined')
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

      const headers = {};
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      const origins = Array.isArray(rawState.origins) ? rawState.origins : [];
      for (const org of origins) {
        const items = Array.isArray(org.localStorage) ? org.localStorage : [];
        for (const item of items) {
          if (!item || !item.name || !item.value) continue;
          if (item.name === 'user') {
            try {
              const userObj = JSON.parse(item.value);
              if (userObj.id) {
                headers['New-Api-User'] = String(userObj.id);
              }
              if (userObj.token && !headers['Authorization']) {
                headers['Authorization'] = `Bearer ${userObj.token}`;
              }
            } catch (_) {}
          }
          if (
            (item.name === 'token' || item.name === 'access_token') &&
            !headers['Authorization']
          ) {
            headers['Authorization'] = `Bearer ${item.value.replace(/^Bearer\s+/i, '')}`;
          }
        }
      }

      return {
        cookies: cookieHeader,
        headers,
        rawState,
      };
    } catch (_) {
      return null;
    }
  }
}

module.exports = { PageHelper };
