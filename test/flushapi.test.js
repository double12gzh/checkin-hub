const test = require('node:test');
const assert = require('node:assert/strict');
const FlushApiPlugin = require('../plugins/flushapi');

test('FlushApiPlugin Contract & Unit Tests', async (t) => {
  const plugin = new FlushApiPlugin();

  await t.test('initializes with correct contract properties', () => {
    assert.equal(plugin.id, 'flushapi');
    assert.equal(plugin.name, 'FlushAPI');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://flushapi.fun/profile');
    assert.equal(plugin.loginUrl, 'https://flushapi.fun/login');
  });

  await t.test('calculateBalance parses quota into USD string', () => {
    // 500,000 quota = $1.00
    const selfData1 = { data: { quota: 500000 } };
    assert.equal(plugin.calculateBalance(selfData1), '$1.00');

    const selfData2 = { data: { quota: 2500000 } };
    assert.equal(plugin.calculateBalance(selfData2), '$5.00');

    assert.equal(plugin.calculateBalance(null), null);
    assert.equal(plugin.calculateBalance({}), null);
    assert.equal(plugin.calculateBalance({ data: {} }), null);
  });

  await t.test('findTodayCheckin identifies checked in status and records', () => {
    const todayISO = '2026-10-11';
    const mockCheckinData = {
      data: {
        stats: {
          checked_in_today: true,
          total_checkins: 5,
          records: [
            {
              checkin_date: '2026-10-11',
              quota_awarded: 50000,
            },
            {
              checkin_date: '2026-10-10',
              quota_awarded: 60000,
            },
          ],
        },
      },
    };

    const match = plugin.findTodayCheckin(mockCheckinData, todayISO);
    assert.ok(match);
    assert.equal(match.checkin_date, '2026-10-11');
    assert.equal(match.quota_awarded, 50000);

    // Negative case: checked_in_today is false
    const notCheckedIn = {
      data: {
        stats: {
          checked_in_today: false,
          records: [],
        },
      },
    };
    assert.equal(plugin.findTodayCheckin(notCheckedIn, todayISO), null);

    // Empty or malformed
    assert.equal(plugin.findTodayCheckin(null, todayISO), null);
    assert.equal(plugin.findTodayCheckin({}, todayISO), null);
  });
});
