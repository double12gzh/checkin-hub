const test = require('node:test');
const assert = require('node:assert/strict');
const JustDoWorkPlugin = require('../plugins/justdowork');
const { PageHelper } = require('../core/helper');

test('JustDoWorkPlugin Contract & Unit Tests', async (t) => {
  const plugin = new JustDoWorkPlugin();

  await t.test('initializes with correct contract properties', () => {
    assert.equal(plugin.id, 'justdowork');
    assert.equal(plugin.name, 'JustDoWork');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://api.justwoker.icu/dashboard/overview');
    assert.equal(plugin.loginUrl, 'https://api.justwoker.icu/sign-in');
    assert.equal(plugin.logsUrl, 'https://api.justwoker.icu/usage-logs/common');
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
});
