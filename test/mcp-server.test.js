const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const { McpServer } = require('../mcp-server');

describe('McpServer Class Unit Tests', () => {
  test('returns tool definitions with correct schema', () => {
    const server = new McpServer();
    const tools = server.getToolDefinitions();

    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 3);

    const toolNames = tools.map((t) => t.name);
    assert.ok(toolNames.includes('checkin_list_plugins'));
    assert.ok(toolNames.includes('checkin_run_all'));
    assert.ok(toolNames.includes('checkin_run_single'));

    const runSingleTool = tools.find((t) => t.name === 'checkin_run_single');
    assert.deepEqual(runSingleTool.inputSchema.required, ['pluginId']);
  });

  test('handleListPlugins returns markdown list and plugin metadata', async () => {
    const server = new McpServer();
    const res = await server.handleListPlugins();

    assert.ok(res.content && res.content[0]);
    assert.ok(res.content[0].text.includes('Checkin-Hub 已注册插件清单'));
    assert.ok(res.metadata.total >= 5);
    assert.ok(res.metadata.plugins.some((p) => p.id === 'agentrouter'));
  });

  test('handleRunSingle returns error for missing or invalid pluginId', async () => {
    const server = new McpServer();

    const missingRes = await server.handleRunSingle({});
    assert.equal(missingRes.isError, true);
    assert.ok(missingRes.content[0].text.includes('必须提供有效的 pluginId'));

    const nonExistRes = await server.handleRunSingle({ pluginId: 'non_existent_site_123' });
    assert.equal(nonExistRes.isError, true);
    assert.ok(nonExistRes.content[0].text.includes('未找到 ID 为 "non_existent_site_123"'));
  });

  test('processRequest handles initialize, ping, and unknown methods', async () => {
    const server = new McpServer();

    const initRes = await server.processRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'initialize',
      params: {},
    });
    assert.equal(initRes.id, 101);
    assert.equal(initRes.result.serverInfo.name, 'checkin-hub');

    const pingRes = await server.processRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'ping',
    });
    assert.equal(pingRes.id, 102);
    assert.deepEqual(pingRes.result, {});

    const unknownRes = await server.processRequest({
      jsonrpc: '2.0',
      id: 103,
      method: 'unknown/method',
    });
    assert.equal(unknownRes.id, 103);
    assert.equal(unknownRes.error.code, -32601);
  });
});

describe('McpServer Stdio End-to-End JSON-RPC Process Test', () => {
  test('handles stdio JSON-RPC lifecycle: initialize -> tools/list -> tools/call', async () => {
    const serverScript = path.resolve(__dirname, '..', 'mcp-server.js');
    const child = spawn(process.execPath, [serverScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    const responses = new Map();
    rl.on('line', (line) => {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed.id !== undefined) {
          responses.set(parsed.id, parsed);
        }
      } catch (e) {
        // ignore non-json line
      }
    });

    function waitForResponse(id, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (responses.has(id)) {
            return resolve(responses.get(id));
          }
          if (Date.now() - start > timeoutMs) {
            return reject(new Error(`Timeout waiting for response ID ${id}`));
          }
          setTimeout(check, 30); // ok: sleep
        };
        check();
      });
    }

    try {
      // 1. Send initialize
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }) + '\n'
      );

      const initMsg = await waitForResponse(1);
      assert.equal(initMsg.result.serverInfo.name, 'checkin-hub');
      assert.equal(initMsg.result.serverInfo.version, '2.0.0');

      // 2. Send tools/list
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }) + '\n'
      );

      const listMsg = await waitForResponse(2);
      assert.ok(Array.isArray(listMsg.result.tools));
      assert.equal(listMsg.result.tools.length, 3);

      // 3. Send tools/call (checkin_list_plugins)
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'checkin_list_plugins',
            arguments: {},
          },
        }) + '\n'
      );

      const callMsg = await waitForResponse(3);
      assert.ok(callMsg.result.content[0].text.includes('Checkin-Hub 已注册插件清单'));

      // 4. Send invalid method
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'invalid_method',
        }) + '\n'
      );

      const errorMsg = await waitForResponse(4);
      assert.equal(errorMsg.error.code, -32601);
    } finally {
      child.kill();
    }
  });
});
