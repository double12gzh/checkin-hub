#!/usr/bin/env node

/**
 * scripts/install-agent-tools.js
 *
 * Automated configuration generator and installer for multi-host AI Agent tools:
 * - Claude Desktop
 * - Claude Code
 * - Google Antigravity
 * - Cursor
 * - Windsurf
 * - Global Shell CLI (`checkin-hub`)
 */

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const MCP_SERVER_PATH = path.join(ROOT_DIR, 'mcp-server.js');
const NODE_BIN = process.execPath;

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              CheckinHub - AI Agent 多宿主接入配置指南                ║
║                 (Form A: 原生 MCP Server & 全局 CLI)                 ║
╚══════════════════════════════════════════════════════════════════════╝
`);

console.log(`📌 当前项目根目录: ${ROOT_DIR}`);
console.log(`📌 MCP Server 绝对路径: ${MCP_SERVER_PATH}`);
console.log(`📌 Node 运行环境路径: ${NODE_BIN}\n`);

// 1. 全局 CLI 工具配置 (npm link)
console.log('────────────────────────────────────────────────────────────────────────');
console.log('1️⃣ 【全局 CLI 工具安装】(任意终端或 Agent 随时调用)');
console.log('────────────────────────────────────────────────────────────────────────');
console.log('只需在当前项目根目录下运行一次:');
console.log('  \x1b[36mnpm link\x1b[0m\n');
console.log('链接后可在系统任意路径直接执行:');
console.log('  checkin-hub --list            # 查看所有插件状态');
console.log('  checkin-hub --all             # 批量每日打卡');
console.log('  checkin-hub agentrouter       # 调试单个站点');
console.log('  checkin-hub --mcp             # 启动 stdio MCP Server\n');

// 2. Claude Code 命令行配置
console.log('────────────────────────────────────────────────────────────────────────');
console.log('2️⃣ 【Claude Code CLI 接入】');
console.log('────────────────────────────────────────────────────────────────────────');
console.log('在终端中执行以下命令，即可直接将 CheckinHub 挂载为 Claude Code 工具:');
console.log(`  \x1b[36mclaude mcp add checkin-hub "${NODE_BIN}" "${MCP_SERVER_PATH}"\x1b[0m\n`);

// 3. Claude Desktop 配置
const isMac = os.platform() === 'darwin';
const claudeDesktopConfigPath = isMac
  ? path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    )
  : path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');

const claudeDesktopSnippet = {
  mcpServers: {
    'checkin-hub': {
      command: NODE_BIN,
      args: [MCP_SERVER_PATH],
    },
  },
};

console.log('────────────────────────────────────────────────────────────────────────');
console.log('3️⃣ 【Claude Desktop 接入】');
console.log('────────────────────────────────────────────────────────────────────────');
console.log(`配置文件路径: \x1b[33m${claudeDesktopConfigPath}\x1b[0m`);
console.log('请在 mcpServers 中追加以下配置:');
console.log('\x1b[32m' + JSON.stringify(claudeDesktopSnippet, null, 2) + '\x1b[0m\n');

// 4. Cursor / Windsurf 配置
console.log('────────────────────────────────────────────────────────────────────────');
console.log('4️⃣ 【Cursor / Windsurf 接入】');
console.log('────────────────────────────────────────────────────────────────────────');
console.log('打开 Cursor Settings -> Features -> MCP，点击 "+ Add New MCP Server":');
console.log(`- Name: checkin-hub`);
console.log(`- Type: command`);
console.log(`- Command: ${NODE_BIN} ${MCP_SERVER_PATH}\n`);

// 5. Google Antigravity 配置
console.log('────────────────────────────────────────────────────────────────────────');
console.log('5️⃣ 【Google Antigravity 接入】');
console.log('────────────────────────────────────────────────────────────────────────');
console.log('在 Antigravity 全局或工作区 mcp_config.json 中追加:');
console.log(
  '\x1b[32m' +
    JSON.stringify(
      {
        mcpServers: {
          'checkin-hub': {
            command: NODE_BIN,
            args: [MCP_SERVER_PATH],
          },
        },
      },
      null,
      2
    ) +
    '\x1b[0m\n'
);

// 自动检测是否传入了 --link 参数
if (process.argv.includes('--link')) {
  console.log('🚀 检测到 --link 参数，正在执行 npm link...');
  try {
    execSync('npm link', { stdio: 'inherit', cwd: ROOT_DIR });
    console.log('✅ npm link 链接成功！现在可以在系统任意位置使用 `checkin-hub` 命令。');
  } catch (err) {
    console.error(`❌ npm link 失败: ${err.message}`);
  }
}
