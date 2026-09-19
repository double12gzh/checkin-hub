const test = require('node:test');
const assert = require('node:assert/strict');
const { BasePlugin } = require('../core/base-plugin');

test('BasePlugin Contract & Default Behaviors', async (t) => {
  await t.test('initializes with default values when options are empty', () => {
    const plugin = new BasePlugin();
    assert.equal(plugin.id, '');
    assert.equal(plugin.name, '');
    assert.equal(plugin.description, '');
    assert.equal(plugin.url, '');
    assert.equal(plugin.loginUrl, '');
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.userDataDir, null);
  });

  await t.test('initializes correctly with provided options', () => {
    const plugin = new BasePlugin({
      id: 'testsite',
      name: 'Test Site',
      description: 'Test Description',
      url: 'https://testsite.com/dashboard',
      loginUrl: 'https://testsite.com/login',
      enabled: false,
    });

    assert.equal(plugin.id, 'testsite');
    assert.equal(plugin.name, 'Test Site');
    assert.equal(plugin.description, 'Test Description');
    assert.equal(plugin.url, 'https://testsite.com/dashboard');
    assert.equal(plugin.loginUrl, 'https://testsite.com/login');
    assert.equal(plugin.enabled, false);
  });

  await t.test('onCheckin throws error if not overridden by subclass', async () => {
    const plugin = new BasePlugin({ id: 'dummy', name: 'Dummy' });
    await assert.rejects(
      async () => {
        await plugin.onCheckin({});
      },
      {
        name: 'Error',
        message: /Plugin \[Dummy\] must implement the onCheckin\(context\) method/,
      }
    );
  });
});
