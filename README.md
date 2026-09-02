# CheckinHub - 通用自动化签到框架

基于 Node.js 与 Playwright 构建的**通用插件化自动化签到框架**。支持多站点插件扩展、独立会话隔离、统一调度、自动失败截屏与日志记录。

---

## 📌 核心特性

- **🧩 插件化架构**：核心引擎与业务逻辑解耦，新增一个站点的打卡仅需编写几十行纯业务代码。
- **🔐 独立会话持久化**：支持每个站点独立的浏览器 Profile 隔离（`.browser-data/<plugin_id>`），会话持久保存，无需重复登录。
- **⚡ 高性能与健壮性**：内置智能弹窗自动消除、OAuth 弹窗自动化处理、失败自动截屏与全生命周期资源安全释放。
- **📊 统一调度与汇总**：支持单插件运行、批量运行（`--all`）、交互式登录引导（`--setup`）及调试模式（`--debug`）。
- **🔒 敏感信息隔离**：支持 `.env` 环境变量配置敏感账号密码，防止密钥泄露。

---

## 🛠️ 项目结构

```text
checkin-hub/
├── core/                  # 核心框架模块
│   ├── base-plugin.js     # 插件基类（接口契约与默认实现）
│   ├── browser-manager.js # 浏览器上下文生命周期、Profile 隔离与截屏管理
│   ├── env.js             # 环境变量 (.env) 自动加载器
│   ├── helper.js          # 页面操作工具箱（弹窗清除、OAuth、Cookie 清理等）
│   └── plugin-loader.js   # 动态插件扫描与加载器
├── plugins/               # 插件目录（新增插件直接在此创建）
│   ├── agentrouter.js     # AgentRouter 签到插件
│   ├── hcnsec.js          # HCNSEC 签到插件
│   └── example.js         # 插件模版示例
├── screenshots/           # 运行异常现场自动截图目录
├── .browser-data/         # 浏览器上下文持久化目录（已忽略）
├── .env                   # 账号密码配置文件（已忽略）
├── index.js               # 框架统一 CLI 入口
└── package.json
```

---

## 🚀 快速上手

### 1. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 2. 常用命令清单

| 命令 | 说明 | 示例 |
| :--- | :--- | :--- |
| `node index.js --list` | **列出所有插件**及其状态 | `node index.js --list` 或 `npm run list` |
| `node index.js <plugin_id>` | **仅运行单个指定插件** | `node index.js hcnsec`<br>`node index.js agentrouter` |
| `node index.js --all` | **批量运行所有已启用插件**并生成汇总报表 | `node index.js --all` 或 `npm run checkin:all` |
| `node index.js --setup <plugin_id>` | **交互式登录指定插件**（弹出浏览器完成首次登录并持久化 Session） | `node index.js --setup agentrouter` |
| `node index.js <plugin_id> --debug` | **调试模式**（有头模式运行，方便排查页面交互问题） | `node index.js agentrouter --debug` |
| `node index.js --help` | 查看完整的 CLI 参数帮助信息 | `node index.js --help` |

#### 命令使用示例：

```bash
# 1. 查看所有可用的打卡插件
node index.js --list

# 2. 仅执行 HCNSEC 单独打卡
node index.js hcnsec

# 3. 仅执行 AgentRouter 单独打卡
node index.js agentrouter

# 4. 批量执行所有启用的插件（日常推荐）
node index.js --all

# 5. 为某个插件初始化登录凭据
node index.js --setup agentrouter
```

---

## 💡 如何开发一个新插件？

只需在 `plugins/` 目录下新建一个 `.js` 文件，继承 `BasePlugin` 并实现 `onCheckin` 方法即可：

```javascript
// plugins/my-site.js
const { BasePlugin } = require('../core/base-plugin');

class MySitePlugin extends BasePlugin {
  constructor() {
    super({
      id: 'mysite',                  // 唯一英文 ID
      name: '我的站点',               // 插件名称
      description: '某平台每日打卡',   // 描述
      url: 'https://example.com/dashboard',
      loginUrl: 'https://example.com/login',
      enabled: true,                 // 是否启用
    });
  }

  async onCheckin({ page, browser, log, helper }) {
    // 1. 打开页面并消除弹窗公告
    await page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await helper.dismissModals(page);

    // 2. 点击签到按钮
    const btn = page.locator('button:has-text("签到")').first();
    if (await btn.isVisible()) {
      await btn.click();
      log('已点击签到按钮');
    }

    // 3. 返回规范结果
    return {
      success: true,
      message: '打卡成功',
      balance: '100 积分',
    };
  }
}

module.exports = MySitePlugin;
```

---

## ⏰ 定时任务配置示例 (Crontab)

```cron
# 每天上午 08:30 自动执行所有启用的插件
30 8 * * * cd /Users/jeffreyguan/Documents/scripts/checkin-hub && /usr/local/bin/node index.js --all >> checkin.log 2>&1
```

---

## 🤖 AI Agent 集成与调用指南

如果你使用 AI Agent（如 Antigravity、Claude Code、Cursor、Cline 等）进行日常巡检或开发插件，可直接使用以下标准 Prompt：

### 1. 每日打卡巡检 Prompt
```text
请执行每日打卡任务：
NO_COLOR=1 TERM=dumb cd /Users/jeffreyguan/Documents/scripts/checkin-hub && node index.js --all

判断规则：
1. 若命令退出码为 0 且输出包含 "✅ 成功"，提取各个站点的签到结果与余额向我汇总汇报。
2. 若退出码为非 0 或输出包含 "❌ 失败"，报告具体错误信息，并检查对应生成的现场截图（路径在日志中会打印在 screenshots/ 目录下）。

汇报要求：
1. 请直接使用标准 Markdown 表格向我汇总汇报（包含：站点、状态、说明、余额）。
2. 请将【站点】列显示为可点击跳转的 Markdown 超链接（如 `[AgentRouter](https://agentrouter.org/console)`、`[HCNSEC](https://api.hcnsec.cn)`）。
3. 请直接输出纯文本内容，不要包含终端 ANSI 颜色转义字符或代码行号。
```

### 2. 初始化/登录指定插件 Prompt
```text
请帮我初始化并登录插件 [插件ID，如 agentrouter]：
cd /Users/jeffreyguan/Documents/scripts/checkin-hub && node index.js --setup [插件ID]

在控制台输出提示登录后，提醒我完成浏览器手动登录。
```

### 3. 让 Agent 开发新插件 Prompt
```text
请为本项目添加一个名为 [目标站点名称] 的签到插件：
1. 在 plugins/ 目录下新建 [站点英文名].js 文件，继承 core/base-plugin.js 中的 BasePlugin。
2. 设定站点主页 url 和登录页 loginUrl。
3. 利用 context.helper 中的 dismissModals、handleOAuth 或 page.locator 编写 onCheckin 签到流程。
4. 完成后运行 node index.js --list 验证插件加载是否正常。
```

---

## ⚠️ 安全说明

- **`.browser-data/`** 包含本地持久化登录态与 Cookie，**请勿上传至公开仓库**。
- 项目已在 `.gitignore` 中默认排除了持久化数据目录及截图。
