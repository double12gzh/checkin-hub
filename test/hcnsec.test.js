const test = require('node:test');
const assert = require('node:assert/strict');
const HcnsecPlugin = require('../plugins/hcnsec');
const { PageHelper } = require('../core/helper');

test('HcnsecPlugin Contract & Unit Tests', async (t) => {
  const plugin = new HcnsecPlugin();

  await t.test('initializes with correct contract properties', () => {
    assert.equal(plugin.id, 'hcnsec');
    assert.equal(plugin.name, 'HCNSEC');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://api.hcnsec.cn/console');
    assert.equal(plugin.loginUrl, 'https://api.hcnsec.cn/sign-in');
  });

  await t.test('calculateBalance parses quota correctly from selfData', () => {
    // 500,000 quota = $1.00
    const selfData = { data: { quota: 2500000 } };
    assert.equal(plugin.calculateBalance(selfData), '$5.00');

    const selfData2 = { data: { quota: 50000000 } };
    assert.equal(plugin.calculateBalance(selfData2), '$100.00');

    // returns null when quota is not present
    assert.equal(plugin.calculateBalance(null), null);
    assert.equal(plugin.calculateBalance({}), null);
  });

  await t.test('findTodayCheckin identifies today CST checkin records', () => {
    const nowMs = Date.now();
    const todayStr = PageHelper.getCSTDateString(nowMs);
    const yesterdayMs = nowMs - 24 * 60 * 60 * 1000;

    const mockLogs = [
      {
        id: 1,
        created_at: Math.floor(nowMs / 1000),
        content: '每日签到获得额度 100000',
      },
      {
        id: 2,
        created_at: Math.floor(yesterdayMs / 1000),
        content: '每日签到获得额度 100000',
      },
    ];

    const match = plugin.findTodayCheckin(mockLogs, todayStr, PageHelper);
    assert.ok(match);
    assert.equal(match.id, 1);

    // Negative case: no match for different date
    const noMatch = plugin.findTodayCheckin(mockLogs, '2099/1/1', PageHelper);
    assert.equal(noMatch, null);
  });

  await t.test('implements onSystemSetup method', () => {
    assert.equal(typeof plugin.onSystemSetup, 'function');
  });
});
