const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const { BrowserManager } = require('../core/browser-manager');
const { BasePlugin } = require('../core/base-plugin');

test('BrowserManager - Dual-Layer Execution Engine', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-bm-test-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test(
    'executes onDirectApiCheckin fast-path when credentials exist and succeeds without launching browser',
    async () => {
      let browserLaunched = false;
      const bm = new BrowserManager({ logger: () => {} });
      bm.resolveUserDataDir = () => tmpDir;

      // Create mock state.json
      fs.writeFileSync(
        path.join(tmpDir, 'state.json'),
        JSON.stringify({ cookies: [{ name: 's', value: '1' }], origins: [] })
      );

      class FastPlugin extends BasePlugin {
        constructor() {
          super({ id: 'fast', name: 'FastPlugin', url: 'https://example.com' });
        }
        async onDirectApiCheckin({ session }) {
          assert.ok(session !== null);
          return { success: true, message: 'Fast checked in', balance: '$10.00' };
        }
        async onCheckin() {
          browserLaunched = true;
          return { success: true, message: 'Browser checked in' };
        }
      }

      const plugin = new FastPlugin();
      const result = await bm.execute(plugin, 'checkin');

      assert.equal(result.success, true);
      assert.equal(result.message, 'Fast checked in');
      assert.equal(result.balance, '$10.00');
      assert.equal(browserLaunched, false);
    }
  );

  await t.test(
    'falls back to Playwright and saves storageState when Direct API throws',
    async () => {
      const originalLaunch = chromium.launchPersistentContext;
      let browserLaunched = false;
      let storageSaved = false;

      const mockPage = {
        addInitScript: async () => {},
        screenshot: async () => {},
      };
      const mockBrowser = {
        addInitScript: async () => {},
        pages: () => [mockPage],
        newPage: async () => mockPage,
        storageState: async ({ path: p }) => {
          storageSaved = true;
          fs.writeFileSync(p, JSON.stringify({ cookies: [{ name: 'saved', value: 'yes' }] }));
        },
        close: async () => {},
      };

      chromium.launchPersistentContext = async () => {
        browserLaunched = true;
        return mockBrowser;
      };

      try {
        const bm = new BrowserManager({ logger: () => {} });
        bm.resolveUserDataDir = () => tmpDir;

        class FallbackPlugin extends BasePlugin {
          constructor() {
            super({ id: 'fallback', name: 'FallbackPlugin', url: 'https://example.com' });
          }
          async onDirectApiCheckin() {
            throw new Error('Direct API 401 Unauthorized');
          }
          async onCheckin() {
            return { success: true, message: 'Browser fallback checked in' };
          }
        }

        const plugin = new FallbackPlugin();
        const result = await bm.execute(plugin, 'checkin');

        assert.equal(result.success, true);
        assert.equal(result.message, 'Browser fallback checked in');
        assert.equal(browserLaunched, true);
        assert.equal(storageSaved, true);
      } finally {
        chromium.launchPersistentContext = originalLaunch;
      }
    }
  );

  await t.test('bypasses Direct API if runtimeOptions.forceBrowser is true', async () => {
    const originalLaunch = chromium.launchPersistentContext;
    let directCalled = false;
    let browserLaunched = false;

    const mockPage = {
      addInitScript: async () => {},
      screenshot: async () => {},
    };
    const mockBrowser = {
      addInitScript: async () => {},
      pages: () => [mockPage],
      newPage: async () => mockPage,
      storageState: async () => {},
      close: async () => {},
    };

    chromium.launchPersistentContext = async () => {
      browserLaunched = true;
      return mockBrowser;
    };

    try {
      const bm = new BrowserManager({ logger: () => {} });
      bm.resolveUserDataDir = () => tmpDir;

      class ForceBrowserPlugin extends BasePlugin {
        constructor() {
          super({ id: 'force', name: 'ForcePlugin', url: 'https://example.com' });
        }
        async onDirectApiCheckin() {
          directCalled = true;
          return { success: true };
        }
        async onCheckin() {
          return { success: true, message: 'Forced browser checked in' };
        }
      }

      const plugin = new ForceBrowserPlugin();
      const result = await bm.execute(plugin, 'checkin', { forceBrowser: true });

      assert.equal(result.success, true);
      assert.equal(result.message, 'Forced browser checked in');
      assert.equal(directCalled, false);
      assert.equal(browserLaunched, true);
    } finally {
      chromium.launchPersistentContext = originalLaunch;
    }
  });
});
