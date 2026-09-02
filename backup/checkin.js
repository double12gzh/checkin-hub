const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const AGENTROUTER_URL = 'https://agentrouter.org';
const USER_DATA_DIR = path.join(__dirname, '.browser-data');
const LOG_FILE = path.join(__dirname, 'checkin.log');

function log(msg) {
  const ts = new Date().toISOString();
  const line = '[' + ts + '] ' + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function getCSTDateString(timestampMs = Date.now()) {
  return new Date(timestampMs).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function getCSTDateTimeString(timestampMs = Date.now()) {
  return new Date(timestampMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

async function dismissModals(page) {
  for (const text of ['今日关闭', '关闭公告', '关闭', 'Close']) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(300);
      log('Dismissed modal: ' + text);
    }
  }
  const overlay = page.locator('.semi-modal-wrap');
  if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function main() {
  const isSetup = process.argv.includes('--setup');

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: !isSetup,
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  });

  const page = browser.pages()[0] || await browser.newPage();

  try {
    if (isSetup) {
      log('Setup mode: please login GitHub + AgentRouter in browser');
      await page.goto(AGENTROUTER_URL + '/login');
      log('Waiting for manual GitHub OAuth login...');
      await page.waitForURL('**/console*', { timeout: 300000 });
      log('Login successful! Session saved to .browser-data/');

    } else {
      log('Starting daily checkin...');
      const todayStr = getCSTDateString();

      // 1. Visit console
      await page.goto(AGENTROUTER_URL + '/console', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await dismissModals(page);

      // 2. Logout: clear API session, localStorage/sessionStorage, and cookies on agentrouter domain
      log('Logging out current session on AgentRouter...');
      await page.evaluate(async () => {
        try {
          await fetch('/api/user/logout', { method: 'POST', credentials: 'include' });
        } catch (e) {}
        localStorage.clear();
        sessionStorage.clear();
      }).catch(() => {});

      const cookies = await browser.cookies();
      for (const c of cookies) {
        if (c.domain.includes('agentrouter.org') || c.domain.includes('air-outer.com')) {
          await browser.clearCookies({ name: c.name, domain: c.domain });
        }
      }
      await page.waitForTimeout(500);

      // 3. Go to login page
      await page.goto(AGENTROUTER_URL + '/login', { waitUntil: 'networkidle', timeout: 30000 });
      await dismissModals(page);

      // 4. Trigger GitHub OAuth (which opens a popup window)
      log('Triggering GitHub OAuth login...');
      const githubBtn = page.locator('button:has-text("Continue with GitHub"), button:has-text("GitHub")').first();
      if (!await githubBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        log('ERROR: GitHub login button not found on /login. Please run --setup to initialize login session.');
        process.exit(1);
      }

      // Handle popup
      const [popup] = await Promise.all([
        page.waitForEvent('popup', { timeout: 15000 }).catch(() => null),
        githubBtn.click()
      ]);

      if (popup) {
        log('OAuth popup opened, waiting for GitHub authentication...');
        await popup.waitForURL('**agentrouter.org/**', { timeout: 30000 }).catch(() => {});
        await popup.waitForTimeout(2000);
      }

      // Wait for navigation to /console or manually redirect
      await page.waitForURL('**/console*', { timeout: 15000 }).catch(async () => {
        log('Main page did not auto redirect, manually navigating to /console...');
        await page.goto(AGENTROUTER_URL + '/console', { waitUntil: 'networkidle', timeout: 30000 });
      });
      await dismissModals(page);
      await page.waitForTimeout(1000);

      // 5. Query user profile and checkin logs
      const checkResult = await page.evaluate(async () => {
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
          const rLog = await fetch('/api/log/self?p=1&page_size=10&type=4', { credentials: 'include', headers });
          const logData = await rLog.json();
          if (logData && logData.data && Array.isArray(logData.data.items)) {
            logItems = logData.data.items;
          }
        } catch (e) {}

        return { selfData, logItems };
      });

      // 6. Verify checkin for TODAY (China Standard Time)
      let todayCheckin = null;
      if (checkResult.logItems && checkResult.logItems.length > 0) {
        for (const item of checkResult.logItems) {
          if (item.created_at) {
            const itemDate = getCSTDateString(item.created_at * 1000);
            if (itemDate === todayStr && item.content && item.content.includes('签到成功')) {
              todayCheckin = item;
              break;
            }
          }
        }
      }

      // Calculate balance
      let balance = null;
      if (checkResult.selfData && checkResult.selfData.data && checkResult.selfData.data.quota !== undefined) {
        balance = (checkResult.selfData.data.quota / 500000).toFixed(2);
      }

      if (todayCheckin) {
        const checkinTime = getCSTDateTimeString(todayCheckin.created_at * 1000);
        log(`Checkin verified: ${todayCheckin.content} (签到时间: ${checkinTime})`);
      } else {
        log(`WARNING: 未找到今日（${todayStr}）的签到记录！`);
        // Fallback: check log page DOM
        await page.goto(AGENTROUTER_URL + '/console/log', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await dismissModals(page);
        await page.waitForTimeout(2000);
        const pageText = await page.locator('body').innerText();
        if (pageText.includes('签到成功') && pageText.includes(todayStr)) {
          log('Checkin verified via DOM on log page for today');
        } else {
          log('ERROR: 签到未生效，今日签到日志未生成！');
          process.exit(1);
        }
      }

      if (balance !== null) {
        log('Balance info: $' + balance);
      } else {
        const pageText = await page.locator('body').innerText();
        const balanceMatch = pageText.match(/\$([\d.]+)/);
        if (balanceMatch) {
          log('Balance info: $' + balanceMatch[1]);
        }
      }
      log('Checkin process completed successfully.');
    }

  } catch (err) {
    log('ERROR: ' + err.message);
    const sp = path.join(__dirname, 'error-screenshot.png');
    await page.screenshot({ path: sp }).catch(() => {});
    log('Screenshot saved: ' + sp);
    process.exit(1);

  } finally {
    await browser.close();
  }
}

main();
