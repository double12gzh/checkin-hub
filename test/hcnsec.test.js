const test = require('node:test');
const assert = require('node:assert/strict');
const HcnsecPlugin = require('../plugins/hcnsec');
const { BasePlugin } = require('../core/base-plugin');
const { PageHelper } = require('../core/helper');

test('HcnsecPlugin - Direct API Contract & Unit Tests', async (t) => {
  const plugin = new HcnsecPlugin();

  await t.test('initializes with correct contract properties', () => {
    assert.equal(plugin.id, 'hcnsec');
    assert.equal(plugin.name, 'HCNSEC');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://api.hcnsec.cn/console');
    assert.equal(plugin.loginUrl, 'https://api.hcnsec.cn/sign-in');
  });

  await t.test('implements own onDirectApiCheckin method', () => {
    assert.equal(typeof plugin.onDirectApiCheckin, 'function');
    assert.notEqual(plugin.onDirectApiCheckin, BasePlugin.prototype.onDirectApiCheckin);
  });

  await t.test('returns null when session and env are missing', async () => {
    const origToken = process.env.HCNSEC_TOKEN;
    const origCookie = process.env.HCNSEC_COOKIE;
    delete process.env.HCNSEC_TOKEN;
    delete process.env.HCNSEC_COOKIE;

    try {
      const res = await plugin.onDirectApiCheckin({
        log: () => {},
        session: null,
        helper: PageHelper,
      });
      assert.equal(res, null);
    } finally {
      if (origToken) process.env.HCNSEC_TOKEN = origToken;
      if (origCookie) process.env.HCNSEC_COOKIE = origCookie;
    }
  });

  await t.test('returns null when session is expired (401 response)', async () => {
    const origFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('/api/user/self')) {
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

  await t.test('returns checkin result when direct checkin succeeds', async () => {
    const origFetch = global.fetch;
    const nowMs = Date.now();
    global.fetch = async (url, opts) => {
      if (url.includes('/api/user/self')) {
        return {
          status: 200,
          json: async () => ({
            success: true,
            data: { quota: 2500000 },
          }),
        };
      }
      if (url.includes('/api/user/checkin') && opts?.method === 'POST') {
        return {
          status: 200,
          json: async () => ({
            success: true,
            message: '打卡成功，奖励 500000 额度',
          }),
        };
      }
      if (url.includes('/api/log/self')) {
        return {
          status: 200,
          json: async () => ({
            data: {
              items: [
                {
                  id: 1,
                  created_at: Math.floor(nowMs / 1000),
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
        session: { cookies: 'session=valid', headers: { Authorization: 'Bearer test' } },
        helper: PageHelper,
      });
      assert.ok(res);
      assert.equal(res.success, true);
      assert.equal(res.message, '打卡成功，奖励 500000 额度');
      assert.equal(res.balance, '$5.00');
    } finally {
      global.fetch = origFetch;
    }
  });

  await t.test('calculateBalance parses quota correctly', () => {
    assert.equal(plugin.calculateBalance({ data: { quota: 500000 } }), '$1.00');
    assert.equal(plugin.calculateBalance({ data: { quota: 5000000 } }), '$10.00');
    assert.equal(plugin.calculateBalance(null), null);
    assert.equal(plugin.calculateBalance({}), null);
  });
});
