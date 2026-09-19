#!/usr/bin/env node

/**
 * mcp-server.js
 *
 * Native Model Context Protocol (MCP) Server for Checkin-Hub.
 * Implements JSON-RPC 2.0 over standard I/O (stdio) with zero external dependencies.
 * Enables any AI Agent (Claude Desktop, Claude Code, Antigravity, Cursor, Windsurf, etc.)
 * to inspect, configure, and execute daily check-ins natively.
 */

require('./core/env');
const readline = require('readline');
const { PluginLoader } = require('./core/plugin-loader');
const { BrowserManager } = require('./core/browser-manager');

const SERVER_NAME = 'checkin-hub';
const SERVER_VERSION = '2.0.0';
const PROTOCOL_VERSION = '2024-11-05';

class McpServer {
  constructor(options = {}) {
    this.loader = new PluginLoader();
    this.debug = !!options.debug;
    // Redirect browser and plugin logs to stderr to keep stdout pure for JSON-RPC
    this.logger = (msg) => console.error(msg);
  }

  getToolDefinitions() {
    return [
      {
        name: 'checkin_list_plugins',
        description:
          '列出 Checkin-Hub 中所有已注册的每日签到插件，包含插件 ID、站点名称、站点 URL、启用状态与功能描述。',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'checkin_run_all',
        description:
          '批量执行所有已启用的站点每日签到与打卡任务。自动模拟拟人化随机等待防 WAF 拦截，并返回包含站点名称、状态、最新余额与现场截图的 Markdown 汇总表格。',
        inputSchema: {
          type: 'object',
          properties: {
            debug: {
              type: 'boolean',
              description:
                '是否以有头(Headed)模式打开浏览器以便实时可视化观察，默认 false (静默无头运行)',
            },
          },
        },
      },
      {
        name: 'checkin_run_single',
        description:
          '执行指定单个站点的每日打卡与额度查询操作。支持传入站点 pluginId（例如 agentrouter, kktoken, hcnsec, justdowork, anyrouter, columbina 等）。',
        inputSchema: {
          type: 'object',
          properties: {
            pluginId: {
              type: 'string',
              description: '要执行打卡的插件 ID (可通过 checkin_list_plugins 获取)',
            },
            debug: {
              type: 'boolean',
              description: '是否以有头(Headed)模式打开浏览器，默认 false',
            },
          },
          required: ['pluginId'],
        },
      },
    ];
  }

  async handleListPlugins() {
    const plugins = this.loader.loadAll();
    const rows = [];
    const listData = [];

    for (const [id, plugin] of plugins.entries()) {
      const status = plugin.enabled ? '✅ 启用' : '⏸ 禁用';
      rows.push(
        `| [${plugin.name}](${plugin.url}) | \`${id}\` | ${status} | ${plugin.description || '-'} |`
      );
      listData.push({
        id,
        name: plugin.name,
        url: plugin.url,
        enabled: plugin.enabled,
        description: plugin.description || '',
      });
    }

    const markdown = [
      '### 📋 Checkin-Hub 已注册插件清单',
      '',
      '| 站点名称 | 插件 ID | 状态 | 说明 |',
      '| :--- | :--- | :--- | :--- |',
      ...rows,
      '',
      `*共加载 ${plugins.size} 个打卡插件。*`,
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text: markdown,
        },
      ],
      metadata: {
        total: plugins.size,
        plugins: listData,
      },
    };
  }

  async handleRunSingle(args = {}) {
    const { pluginId, debug } = args;
    if (!pluginId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: '❌ 必须提供有效的 pluginId 参数！可以通过 `checkin_list_plugins` 查询可用插件 ID。',
          },
        ],
      };
    }

    const plugin = this.loader.loadPlugin(pluginId);
    if (!plugin) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ 未找到 ID 为 "${pluginId}" 的插件！请通过 \`checkin_list_plugins\` 核对插件列表。`,
          },
        ],
      };
    }

    const browserManager = new BrowserManager({
      debug: debug ?? this.debug,
      logger: this.logger,
    });

    const result = await browserManager.execute(plugin, 'checkin');
    const statusIcon = result.success ? '✅ 成功' : '❌ 失败';
    const balanceInfo = result.balance ? ` | **当前余额**: ${result.balance}` : '';
    const screenshotInfo =
      !result.success && result.screenshotPath
        ? `\n\n> 📷 **现场自动取证截图**: \`${result.screenshotPath}\``
        : '';

    const text = [
      `### ${statusIcon} [${plugin.name}](${plugin.url}) 打卡完成`,
      `- **状态**: ${result.success ? '成功' : '失败'}`,
      `- **执行说明**: ${result.message || '-'}${balanceInfo}`,
      screenshotInfo,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      isError: !result.success,
      content: [
        {
          type: 'text',
          text,
        },
      ],
      resultData: {
        pluginId,
        name: plugin.name,
        url: plugin.url,
        ...result,
      },
    };
  }

  async handleRunAll(args = {}) {
    const { debug } = args;
    const plugins = this.loader.loadAll();
    const browserManager = new BrowserManager({
      debug: debug ?? this.debug,
      logger: this.logger,
    });

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const [id, plugin] of plugins.entries()) {
      if (!plugin.enabled) {
        skipCount++;
        continue;
      }

      if (results.length > 0) {
        // 批量执行时增加随机 1.5~3.5 秒延迟，防频控规避 WAF 机械指纹
        const jitterMs = Math.floor(Math.random() * 2000) + 1500;
        await new Promise((resolve) => setTimeout(resolve, jitterMs)); // ok: sleep
      }

      this.logger(`[MCP] 正在执行站点签到: ${plugin.name} (${id})...`);
      const res = await browserManager.execute(plugin, 'checkin');
      if (res.success) {
        successCount++;
      } else {
        failCount++;
      }
      results.push({ id, name: plugin.name, url: plugin.url, ...res });
    }

    const tableRows = results.map((r) => {
      const statusIcon = r.success ? '✅ 成功' : '❌ 失败';
      const balanceStr = r.balance || '-';
      const errNote = !r.success && r.screenshotPath ? ` (截图: \`${r.screenshotPath}\`)` : '';
      return `| [${r.name}](${r.url}) | ${statusIcon} | ${r.message || '-'}${errNote} | ${balanceStr} |`;
    });

    const text = [
      '### 📊 Checkin-Hub 批量签到汇报',
      '',
      `> 统计: 成功 **${successCount}** 站，失败 **${failCount}** 站，跳过 **${skipCount}** 站`,
      '',
      '| 站点名称 | 签到状态 | 执行说明 | 当前余额 |',
      '| :--- | :--- | :--- | :--- |',
      ...tableRows,
    ].join('\n');

    return {
      isError: failCount > 0,
      content: [
        {
          type: 'text',
          text,
        },
      ],
      summary: {
        total: plugins.size,
        successCount,
        failCount,
        skipCount,
        results,
      },
    };
  }

  async processRequest(request) {
    const { id, method, params } = request;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        },
      };
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.getToolDefinitions(),
        },
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      try {
        let toolResult;
        if (toolName === 'checkin_list_plugins') {
          toolResult = await this.handleListPlugins(toolArgs);
        } else if (toolName === 'checkin_run_single') {
          toolResult = await this.handleRunSingle(toolArgs);
        } else if (toolName === 'checkin_run_all') {
          toolResult = await this.handleRunAll(toolArgs);
        } else {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Tool not found: ${toolName}`,
            },
          };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: toolResult,
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: `Tool execution failed: ${err.message}`,
          },
        };
      }
    }

    // Default: Method not found
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  startStdioServer() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${e.message}`,
          },
        };
        process.stdout.write(`${JSON.stringify(errorResponse)}\n`);
        return;
      }

      // Notifications (no 'id' present) do not require response
      if (parsed.id === undefined || parsed.id === null) {
        if (parsed.method === 'notifications/initialized' || parsed.method === 'initialized') {
          this.logger('[MCP] Client initialization completed.');
        }
        return;
      }

      const response = await this.processRequest(parsed);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    });

    process.on('SIGINT', () => {
      process.exit(0);
    });

    this.logger(`[MCP] CheckinHub MCP Server v${SERVER_VERSION} started on stdio.`);
  }
}

if (require.main === module) {
  const server = new McpServer();
  server.startStdioServer();
}

module.exports = {
  McpServer,
  startStdioServer: () => {
    const server = new McpServer();
    server.startStdioServer();
  },
};
