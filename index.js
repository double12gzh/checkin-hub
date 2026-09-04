#!/usr/bin/env node

require('./core/env');
const { PluginLoader } = require('./core/plugin-loader');
const { BrowserManager } = require('./core/browser-manager');

function printHelp() {
  console.log(`
CheckinHub - 通用签到自动化框架
=====================================
用法:
  node index.js [plugin_id] [options]

命令与参数:
  node index.js <plugin_id>       执行指定插件打卡 (如 node index.js agentrouter)
  node index.js --all             执行所有已启用的插件
  node index.js --setup [plugin]  交互式登录模式 (打开浏览器以便手动登录保存 Session)
  node index.js --list            列出所有已注册的插件
  node index.js --debug           调试模式 (显示浏览器界面)
  node index.js --help            查看帮助信息

示例:
  node index.js agentrouter
  node index.js --setup agentrouter
  node index.js --all
`);
}

async function main() {
  const args = process.argv.slice(2);
  const isHelp = args.includes('--help') || args.includes('-h');
  const isList = args.includes('--list') || args.includes('-l');
  const isSetup = args.includes('--setup');
  const isAll = args.includes('--all');
  const isDebug = args.includes('--debug');

  if (isHelp) {
    printHelp();
    return;
  }

  const loader = new PluginLoader();
  const plugins = loader.loadAll();

  if (isList) {
    console.log('\n已注册的插件列表:');
    console.log('----------------------------------------------------');
    for (const [id, plugin] of plugins.entries()) {
      const status = plugin.enabled ? '✓ 已启用' : '✗ 已禁用';
      console.log(`- [${id}] ${plugin.name} (${status}) - ${plugin.description || '无描述'}`);
    }
    console.log('----------------------------------------------------\n');
    return;
  }

  // Determine target plugin(s)
  const nonFlagArgs = args.filter((arg) => !arg.startsWith('--') && !arg.startsWith('-'));
  let targetPluginId = nonFlagArgs[0];

  // If running --setup without specifying plugin id, default to agentrouter if available
  if (isSetup && !targetPluginId) {
    targetPluginId = 'agentrouter';
  }

  // If no plugin specified and not --all, default to agentrouter
  if (!targetPluginId && !isAll) {
    targetPluginId = 'agentrouter';
  }

  const browserManager = new BrowserManager({ debug: isDebug });

  if (isAll) {
    console.log('\n🚀 开始批量执行所有已启用的打卡插件...\n');
    const results = [];
    for (const [id, plugin] of plugins.entries()) {
      if (!plugin.enabled) {
        console.log(`[跳过] 插件 [${id}] ${plugin.name} 当前处于禁用状态。`);
        continue;
      }
      console.log(`\n================== [${plugin.name}] ==================`);
      const res = await browserManager.execute(plugin, 'checkin');
      results.push({ id, name: plugin.name, url: plugin.url, ...res });
    }

    console.log('\n================== 📊 运行结果汇总 ==================');
    let hasFailure = false;
    for (const r of results) {
      const statusIcon = r.success ? '✅ 成功' : '❌ 失败';
      const balanceInfo = r.balance ? ` | 余额: ${r.balance}` : '';
      const linkName = r.url ? `[${r.name}](${r.url})` : `[${r.name}]`;
      console.log(`${statusIcon} ${linkName} ${r.message}${balanceInfo}`);
      if (!r.success) hasFailure = true;
    }
    console.log('====================================================\n');

    if (hasFailure) {
      process.exitCode = 1;
    }
    return;
  }

  // Single plugin execution
  const plugin = plugins.get(targetPluginId);
  if (!plugin) {
    console.error(
      `❌ 未找到 ID 为 "${targetPluginId}" 的插件！请通过 "node index.js --list" 查看可用插件。`
    );
    process.exitCode = 1;
    return;
  }

  const action = isSetup ? 'setup' : 'checkin';
  const result = await browserManager.execute(plugin, action);

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
