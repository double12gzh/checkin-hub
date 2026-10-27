const test = require('node:test');
const assert = require('node:assert/strict');
const { PageHelper } = require('../core/helper');

test('PageHelper - CST Date Formatting', async (t) => {
  await t.test('getCSTISODateString returns YYYY-MM-DD format in Asia/Shanghai', () => {
    // 2026-09-18 16:30:00 UTC -> 2026-09-19 00:30:00 CST (UTC+8)
    const timestamp = Date.parse('2026-09-18T16:30:00.000Z');
    const isoDate = PageHelper.getCSTISODateString(timestamp);
    assert.equal(isoDate, '2026-09-19');
  });

  await t.test('getCSTISODateString pads single digits correctly', () => {
    // 2026-01-05 02:00:00 UTC -> 2026-01-05 10:00:00 CST
    const timestamp = Date.parse('2026-01-05T02:00:00.000Z');
    const isoDate = PageHelper.getCSTISODateString(timestamp);
    assert.equal(isoDate, '2026-01-05');
  });

  await t.test('getCSTDateString returns non-empty formatted string', () => {
    const str = PageHelper.getCSTDateString();
    assert.ok(typeof str === 'string' && str.length > 0);
  });

  await t.test('getCSTDateTimeString formats into localized CST date time', () => {
    const timestamp = Date.parse('2026-09-19T02:30:00.000Z');
    const str = PageHelper.getCSTDateTimeString(timestamp);
    assert.ok(str.includes('2026'));
  });
});

test('PageHelper - DOM and UI utilities with mock page', async (t) => {
  await t.test('dismissModals executes without crashing when elements not found', async () => {
    const mockPage = {
      locator: () => ({
        first: () => ({
          isVisible: async () => false,
          click: async () => {},
        }),
      }),
    };

    // Should not throw
    await assert.doesNotReject(async () => {
      await PageHelper.dismissModals(mockPage);
    });
  });

  await t.test('clearCookies handles empty or valid domains on mock context', async () => {
    let clearedCookies = false;
    const mockContext = {
      cookies: async () => [{ name: 'session', domain: '.example.com', path: '/' }],
      clearCookies: async () => {
        clearedCookies = true;
      },
    };

    await PageHelper.clearCookies(mockContext, ['example.com']);
    assert.equal(clearedCookies, true);
  });

  await t.test('openSystemBrowser is a callable function returning a promise', () => {
    assert.equal(typeof PageHelper.openSystemBrowser, 'function');
  });
});

test('PageHelper - Cloudflare Challenge Detection', async (t) => {
  await t.test(
    'detectCloudflareChallenge detects strong marker and marks isChallenge true',
    async () => {
      const mockPage = {
        evaluate: async (fn) => {
          // Mock evaluate executing against browser window
          const mockWindow = {
            _cf_chl_opt: {},
            location: { href: 'https://example.com' },
            document: {
              title: 'Please Wait',
              querySelectorAll: () => [],
              querySelector: () => null,
              body: { innerText: '' },
            },
          };
          // Evaluate the inner function with mock DOM
          return fn(mockWindow);
        },
      };

      const res = await PageHelper.detectCloudflareChallenge(mockPage);
      assert.equal(res.isChallenge, true);
      assert.ok(res.score >= 3);
      assert.ok(res.strong.includes('_cf_chl_opt'));
    }
  );

  await t.test('detectCloudflareChallenge returns isChallenge false on normal page', async () => {
    const mockPage = {
      evaluate: async (fn) => {
        const mockWindow = {
          location: { href: 'https://example.com/console' },
          document: {
            title: 'User Console',
            querySelectorAll: () => [],
            querySelector: () => null,
            body: { innerText: 'Welcome back' },
          },
        };
        return fn(mockWindow);
      },
    };

    const res = await PageHelper.detectCloudflareChallenge(mockPage);
    assert.equal(res.isChallenge, false);
    assert.equal(res.score, 0);
  });

  await t.test('waitForCloudflareBypass returns true immediately if not challenged', async () => {
    const mockPage = {
      evaluate: async () => ({ isChallenge: false, score: 0, strong: [], medium: [], weak: [] }),
    };
    const passed = await PageHelper.waitForCloudflareBypass(mockPage, {
      timeoutMs: 1000,
      pollIntervalMs: 50,
    });
    assert.equal(passed, true);
  });
});

test('PageHelper - Turnstile Token Resolution', async (t) => {
  await t.test(
    'resolveTurnstileToken extracts token when present in cf-turnstile-response',
    async () => {
      const mockPage = {
        locator: (_sel) => ({
          first: () => ({
            isVisible: async () => true,
            click: async () => {},
          }),
        }),
        evaluate: async (fn) => {
          const mockDoc = {
            querySelector: (sel) => {
              if (sel === '[name="cf-turnstile-response"]') {
                return { value: 'test-turnstile-token-12345' };
              }
              if (sel === '.cf-turnstile' || sel.includes('iframe')) {
                return {
                  dispatchEvent: () => true,
                  click: () => {},
                };
              }
              return null;
            },
          };
          return fn(mockDoc);
        },
        waitForFunction: async () => true,
      };

      const token = await PageHelper.resolveTurnstileToken(mockPage, {
        timeoutMs: 2000,
        pollIntervalMs: 50,
      });
      assert.equal(token, 'test-turnstile-token-12345');
    }
  );
});

test('PageHelper - StorageState & Session Management', async (t) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-state-test-'));
  const testStatePath = path.join(tmpDir, 'state.json');

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('loadSessionFromState returns null when file does not exist', () => {
    const session = PageHelper.loadSessionFromState(path.join(tmpDir, 'nonexistent.json'));
    assert.equal(session, null);
  });

  await t.test(
    'saveStorageState and loadSessionFromState work seamlessly with mock browser',
    async () => {
      const mockStorage = {
        cookies: [
          { name: 'session', value: 'sess-abc-123', domain: 'example.com', path: '/' },
          { name: '_token', value: 'tok-xyz-789', domain: 'example.com', path: '/' },
        ],
        origins: [
          {
            origin: 'https://example.com',
            localStorage: [
              { name: 'user', value: JSON.stringify({ id: 42, username: 'testuser' }) },
              { name: 'token', value: 'bearer-jwt-token' },
            ],
          },
        ],
      };

      const mockBrowser = {
        storageState: async ({ path: savePath }) => {
          fs.writeFileSync(savePath, JSON.stringify(mockStorage, null, 2));
        },
      };

      const saved = await PageHelper.saveStorageState(mockBrowser, testStatePath);
      assert.equal(saved, true);
      assert.ok(fs.existsSync(testStatePath));

      const session = PageHelper.loadSessionFromState(testStatePath);
      assert.ok(session !== null);
      assert.equal(session.cookies, 'session=sess-abc-123; _token=tok-xyz-789');
      assert.equal(session.headers['New-Api-User'], '42');
      assert.equal(session.headers['Authorization'], 'Bearer bearer-jwt-token');
    }
  );

  await t.test(
    'syncGitHubSessionCookies returns true immediately when valid user_session exists',
    async () => {
      const mockBrowser = {
        cookies: async () => [
          {
            name: 'user_session',
            value: 'gh-sess-123',
            domain: 'github.com',
            expires: Math.floor(Date.now() / 1000) + 86400,
          },
        ],
        addCookies: async () => {},
      };
      const synced = await PageHelper.syncGitHubSessionCookies(mockBrowser);
      assert.equal(synced, true);
    }
  );

  await t.test(
    'waitForNavigationAcrossPages resolves when login completes in a second popup tab',
    async () => {
      let navigatedToUrl = null;
      let popupClosed = false;

      const tab1 = {
        url: () => 'https://agentrouter.org/login',
        isClosed: () => false,
        goto: async (targetUrl) => {
          navigatedToUrl = targetUrl;
        },
        waitForURL: () => new Promise(() => {}), // Tab 1 never navigates on its own
      };

      const tab2 = {
        url: () => 'https://agentrouter.org/console/token',
        isClosed: () => popupClosed,
        close: async () => {
          popupClosed = true;
        },
        waitForLoadState: async () => {},
        waitForFunction: async () => true,
      };

      const mockContext = {
        pages: () => [tab1, tab2],
        on: () => {},
        off: () => {},
      };

      await PageHelper.waitForNavigationAcrossPages(
        tab1,
        (url) => !url.pathname.includes('/oauth') && url.pathname.includes('/console'),
        { timeout: 5000, browser: mockContext }
      );

      assert.equal(navigatedToUrl, 'https://agentrouter.org/console/token');
      assert.equal(popupClosed, true);
    }
  );
});
