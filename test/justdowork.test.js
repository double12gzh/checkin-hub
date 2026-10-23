const test = require('node:test');
const assert = require('node:assert/strict');
const JustDoWorkPlugin = require('../plugins/justdowork');
const { BasePlugin } = require('../core/base-plugin');
const { PageHelper } = require('../core/helper');

test('JustDoWorkPlugin Contract & Unit Tests', async (t) => {
  const plugin = new JustDoWorkPlugin();

  await t.test('initializes with correct contract properties and turnstileStealth enabled', () => {
    assert.equal(plugin.id, 'justdowork');
    assert.equal(plugin.name, 'JustDoWork');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://api.justwoker.icu/dashboard/overview');
    assert.equal(plugin.loginUrl, 'https://api.justwoker.icu/sign-in');
    assert.equal(plugin.logsUrl, 'https://api.justwoker.icu/usage-logs/common');
    assert.equal(plugin.turnstileStealth, true);
  });

  await t.test('implements own onDirectApiCheckin method', () => {
    assert.equal(typeof plugin.onDirectApiCheckin, 'function');
    assert.notEqual(plugin.onDirectApiCheckin, BasePlugin.prototype.onDirectApiCheckin);
  });

  await t.test('calculateBalance parses quota from selfData or refreshData', () => {
    // 500,000 quota = $1.00
    const selfData = { data: { quota: 2500000 } };
    assert.equal(plugin.calculateBalance(selfData, null), '$5.00');

    // fallback to refreshData.data.user.quota
    const refreshData = { data: { user: { quota: 70084852 } } };
    assert.equal(plugin.calculateBalance(null, refreshData), '$140.17');

    // returns null when quota is not present
    assert.equal(plugin.calculateBalance(null, null), null);
    assert.equal(plugin.calculateBalance({}, {}), null);
  });

  await t.test('findTodayCheckin identifies today CST checkin records', () => {
    const nowMs = Date.now();
    const todayStr = PageHelper.getCSTDateString(nowMs);
    const yesterdayMs = nowMs - 24 * 60 * 60 * 1000;

    const mockLogs = [
      {
        id: 1,
        created_at: Math.floor(nowMs / 1000),
        content: '用户签到，获得额度 ＄21.794562 额度',
      },
      {
        id: 2,
        created_at: Math.floor(yesterdayMs / 1000),
        content: '用户签到，获得额度 ＄22.211966 额度',
      },
    ];

    const match = plugin.findTodayCheckin(mockLogs, todayStr, PageHelper);
    assert.ok(match);
    assert.equal(match.id, 1);

    // Negative case: no match for tomorrow
    const noMatch = plugin.findTodayCheckin(mockLogs, '2099/1/1', PageHelper);
    assert.equal(noMatch, null);
  });

  await t.test('formatCheckinStatsMessage formats monthly checkin stats', () => {
    const todayISO = '2026-10-23';
    const checkinStatus = {
      data: {
        stats: {
          checked_in_today: true,
          records: [{ checkin_date: '2026-10-23', quota_awarded: 12500000 }],
        },
      },
    };
    assert.equal(
      plugin.formatCheckinStatsMessage(checkinStatus, todayISO),
      '今日已签到 (获得 $25.00 额度)'
    );
    assert.equal(
      plugin.formatCheckinStatsMessage({ data: { stats: { checked_in_today: false } } }, todayISO),
      null
    );
  });

  await t.test(
    'onDirectApiCheckin returns null to escalate to browser when Turnstile is required',
    async () => {
      const origFetch = global.fetch;
      global.fetch = async (url, opts) => {
        if (url.includes('/api/user/self')) {
          return {
            status: 200,
            json: async () => ({
              success: true,
              data: { quota: 5000000 },
            }),
          };
        }
        if (url.includes('/api/user/checkin?month=')) {
          return {
            status: 200,
            json: async () => ({
              success: true,
              data: { stats: { checked_in_today: false, records: [] } },
            }),
          };
        }
        if (url.includes('/api/user/checkin') && opts?.method === 'POST') {
          return {
            status: 200,
            json: async () => ({
              success: false,
              message: 'Turnstile token 为空',
            }),
          };
        }
        if (url.includes('/api/log/self')) {
          return {
            status: 200,
            json: async () => ({ data: { items: [] } }),
          };
        }
        return { status: 404 };
      };

      try {
        const res = await plugin.onDirectApiCheckin({
          log: () => {},
          session: { cookies: 'new_api_refresh=valid', headers: { Authorization: 'Bearer tok' } },
          helper: PageHelper,
        });
        assert.equal(res, null);
      } finally {
        global.fetch = origFetch;
      }
    }
  );

  await t.test('performBrowserCheckin dynamically solves Turnstile when required', async () => {
    let evaluateCall = 0;
    const fakePage = {
      evaluate: async () => {
        evaluateCall += 1;
        if (evaluateCall === 1) {
          // triggerApiCheckin initial attempt
          return { success: false, message: 'Turnstile 校验失败，请刷新重试！' };
        }
        if (evaluateCall === 2) {
          // renderResult
          return { ok: true, sitekey: '0x4AAAAAAEQ0v37GMr9cC_Kw' };
        }
        // final checkin with turnstile token
        return {
          success: true,
          message: '签到成功',
          data: { quota_awarded: 10000000 },
        };
      },
    };

    const fakeHelper = {
      ...PageHelper,
      resolveTurnstileToken: async () => 'mock-turnstile-token',
    };

    const res = await plugin.performBrowserCheckin(fakePage, () => {}, fakeHelper, 'mock-jwt');
    assert.ok(res);
    assert.equal(res.success, true);
    assert.equal(res.data.quota_awarded, 10000000);
  });
});
