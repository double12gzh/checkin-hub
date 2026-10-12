const test = require('node:test');
const assert = require('node:assert/strict');
const AnyRouterPlugin = require('../plugins/anyrouter');
const { BasePlugin } = require('../core/base-plugin');
const { PageHelper } = require('../core/helper');

test('AnyRouterPlugin - Direct API Contract & Unit Tests', async (t) => {
  const plugin = new AnyRouterPlugin();

  await t.test('initializes with correct contract properties', () => {
    assert.equal(plugin.id, 'anyrouter');
    assert.equal(plugin.name, 'AnyRouter');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://anyrouter.top/console');
    assert.equal(plugin.loginUrl, 'https://anyrouter.top/login');
  });

  await t.test('implements own onDirectApiCheckin method', () => {
    assert.equal(typeof plugin.onDirectApiCheckin, 'function');
    assert.notEqual(plugin.onDirectApiCheckin, BasePlugin.prototype.onDirectApiCheckin);
  });

  await t.test('returns null when session is missing or empty', async () => {
    const res1 = await plugin.onDirectApiCheckin({
      log: () => {},
      session: null,
      helper: PageHelper,
    });
    assert.equal(res1, null);

    const res2 = await plugin.onDirectApiCheckin({
      log: () => {},
      session: {},
      helper: PageHelper,
    });
    assert.equal(res2, null);

    const res3 = await plugin.onDirectApiCheckin({
      log: () => {},
      session: { cookies: '' },
      helper: PageHelper,
    });
    assert.equal(res3, null);
  });

  await t.test('returns null when session is expired (401/403 response)', async () => {
    const origFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('/api/log/self')) {
        return {
          status: 401,
          json: async () => ({ error: 'unauthorized' }),
        };
      }
      return { status: 404 };
    };

    try {
      const res = await plugin.onDirectApiCheckin({
        log: () => {},
        session: { cookies: 'session=invalid', headers: {} },
        helper: PageHelper,
      });
      assert.equal(res, null);
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('returns null when today checkin is not found in log items', async () => {
    const origFetch = global.fetch;
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;
    global.fetch = async (url) => {
      if (url.includes('/api/log/self')) {
        return {
          status: 200,
          json: async () => ({
            data: {
              items: [
                {
                  id: 101,
                  created_at: Math.floor(yesterdayMs / 1000),
                  content: '每日签到奖励',
                },
              ],
            },
          }),
        };
      }
      return { status: 404 };
    };

    try {
      const res = await plugin.onDirectApiCheckin({
        log: () => {},
        session: { cookies: 'session=valid', headers: {} },
        helper: PageHelper,
      });
      assert.equal(res, null);
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('returns checkin result and balance when today checkin exists', async () => {
    const origFetch = global.fetch;
    const nowMs = Date.now();
    global.fetch = async (url) => {
      if (url.includes('/api/log/self')) {
        return {
          status: 200,
          json: async () => ({
            data: {
              items: [
                {
                  id: 202,
                  created_at: Math.floor(nowMs / 1000),
                  content: '每日签到赠送 1000000 额度',
                },
              ],
            },
          }),
        };
      }
      if (url.includes('/api/user/self')) {
        return {
          status: 200,
          json: async () => ({
            data: {
              quota: 10000000,
            },
          }),
        };
      }
      return { status: 404 };
    };

    try {
      const res = await plugin.onDirectApiCheckin({
        log: () => {},
        session: { cookies: 'session=valid', headers: { 'New-Api-User': '123' } },
        helper: PageHelper,
      });
      assert.ok(res);
      assert.equal(res.success, true);
      assert.match(res.message, /签到已确认/);
      assert.match(res.message, /每日签到赠送 1000000 额度/);
      assert.equal(res.balance, '$20.00');
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('returns null when network throws an error', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Network error');
    };

    try {
      const res = await plugin.onDirectApiCheckin({
        log: () => {},
        session: { cookies: 'session=valid', headers: {} },
        helper: PageHelper,
      });
      assert.equal(res, null);
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('calculateBalance parses quota correctly', () => {
    assert.equal(plugin.calculateBalance({ data: { quota: 500000 } }), '$1.00');
    assert.equal(plugin.calculateBalance({ data: { quota: 2500000 } }), '$5.00');
    assert.equal(plugin.calculateBalance(null), null);
    assert.equal(plugin.calculateBalance({}), null);
  });

  await t.test('findTodayCheckin matches today checkin and ignores others', () => {
    const nowMs = Date.now();
    const todayStr = PageHelper.getCSTDateString(nowMs);
    const yesterdayMs = nowMs - 24 * 60 * 60 * 1000;

    const mockLogs = [
      {
        id: 1,
        created_at: Math.floor(nowMs / 1000),
        content: '每日签到奖励',
      },
      {
        id: 2,
        created_at: Math.floor(yesterdayMs / 1000),
        content: '每日签到奖励',
      },
      {
        id: 3,
        created_at: Math.floor(nowMs / 1000),
        content: '调用模型消耗额度',
      },
    ];

    const match = plugin.findTodayCheckin(mockLogs, todayStr, PageHelper);
    assert.ok(match);
    assert.equal(match.id, 1);

    const noMatch = plugin.findTodayCheckin(mockLogs, '1999/1/1', PageHelper);
    assert.equal(noMatch, null);
  });
});
