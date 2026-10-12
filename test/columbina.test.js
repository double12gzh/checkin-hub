const test = require('node:test');
const assert = require('node:assert/strict');
const ColumbinaPlugin = require('../plugins/columbina');

test('ColumbinaPlugin - Contract & Unit Tests', async (t) => {
  const plugin = new ColumbinaPlugin();

  await t.test('initializes with correct default contract properties', () => {
    assert.equal(plugin.id, 'columbina');
    assert.equal(plugin.name, 'Columbina');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.url, 'https://newapi.columbina.eu.org/profile');
    assert.equal(plugin.loginUrl, 'https://newapi.columbina.eu.org/sign-in');
  });

  await t.test('respects COLUMBINA_URL environment variable', () => {
    process.env.COLUMBINA_URL = 'https://custom.columbina.com';
    try {
      const customPlugin = new ColumbinaPlugin();
      assert.equal(customPlugin.url, 'https://custom.columbina.com/profile');
      assert.equal(customPlugin.loginUrl, 'https://custom.columbina.com/sign-in');
    } finally {
      delete process.env.COLUMBINA_URL;
    }
  });

  await t.test('respects COLUMBINA_ENABLED environment variable', () => {
    process.env.COLUMBINA_ENABLED = 'false';
    try {
      const disabledPlugin = new ColumbinaPlugin();
      assert.equal(disabledPlugin.enabled, false);
    } finally {
      delete process.env.COLUMBINA_ENABLED;
    }
  });

  await t.test('calculateBalance parses quota correctly', () => {
    assert.equal(plugin.calculateBalance({ data: { quota: 500000 } }), '$1.00');
    assert.equal(plugin.calculateBalance({ data: { quota: 2500000 } }), '$5.00');
    assert.equal(plugin.calculateBalance(null), null);
    assert.equal(plugin.calculateBalance({}), null);
  });
});
