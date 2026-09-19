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
});
