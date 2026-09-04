# AGENTS.md - AI Agent 运行与开发全景规范

本文档是 **Checkin-Hub** 项目的权威架构蓝图与 AI Agent（Antigravity、Claude Code、Cursor、Windsurf、Cline、Roo-Code 等）行为准则。
所有协助开发、审查或巡检此项目的 AI Agent 均**必须严格遵循**本规范所定义的契约、架构边界及代码质量要求。

---

## 📌 1. 项目概况与架构蓝图

Checkin-Hub 是一个基于 Node.js 与 Playwright 构建的通用插件化每日签到自动化框架。

### 1.1 目录结构与职责边界

```text
checkin-hub/
├── core/                  # 框架核心基础设施（严禁存放特定业务逻辑）
│   ├── base-plugin.js     # 插件基类（接口契约定义与默认生命周期实现）
│   ├── browser-manager.js # Playwright 浏览器上下文管理、Profile 隔离与异常自动截图
│   ├── env.js             # 便携式环境变量 (.env) 自动加载器
│   ├── helper.js          # 通用 DOM/页面工具箱（弹窗清除、OAuth、Cookie 清理、CST 时间转换）
│   └── plugin-loader.js   # 动态插件扫描与实例化加载器
├── plugins/               # 业务签到插件目录（新增站点打卡必须单独存放在此）
│   ├── agentrouter.js     # AgentRouter 签到插件
│   ├── anyrouter.js       # AnyRouter 签到插件
│   ├── hcnsec.js          # HCNSEC 签到插件
│   ├── kktoken.js         # KKToken 签到插件
│   └── example.js         # 插件标准模版示例
├── scripts/               # 架构契约校验脚本与工程工具
│   └── verify-plugins.js  # 自动化插件接口契约与反模式静态扫描工具
├── screenshots/           # 运行异常现场自动截图目录（由 BrowserManager 自动管理，已忽略）
├── .browser-data/         # 浏览器上下文持久化目录（按插件隔离，已忽略）
├── .cursor/rules/         # Cursor Modern Agent 规则配置
├── .husky/                # Git Pre-commit 自动化检查钩子
├── .cursorrules           # Legacy Cursor / Windsurf 统一规则
├── .clinerules            # Cline / Roo-Code 统一规则
├── eslint.config.js       # ESLint 10+ 扁平化代码规范配置
├── .prettierrc.json       # Prettier 统一格式化标准配置
├── index.js               # 框架统一 CLI 入口
└── package.json           # 依赖与 npm 脚本配置
```

### 1.2 核心设计原则

1. **核心与业务严格解耦**：`core/` 仅提供通用的浏览器、网络、调度与 DOM 工具，**严禁将特定站点的业务选择器或逻辑侵入 `core/`**。
2. **Profile 严格隔离**：各插件的持久化浏览器状态（Cookies、LocalStorage、IndexedDB）完全隔离存储在 `.browser-data/<plugin.id>/` 下，互不污染。
3. **失败现场自动取证**：插件在检测到签到失败或异常时，直接抛出带有上下文的 `new Error('原因')`。框架核心会在统一捕获后自动截取现场屏幕并保存至 `screenshots/<plugin_id>-<timestamp>.png`。
4. **便携性与零硬编码**：禁止硬编码任何开发者个人工作目录（如 `/Users/...`、`/home/...`）或账号密钥。所有敏感配置必须通过 `.env` 管理。

---

## 🛠️ 2. AI Agent 操作指令指南

AI Agent 在协助用户日常巡检、排错或初始化时，请使用以下标准指令：

### 2.1 每日签到巡检

```bash
node index.js --all
# 或
npm run checkin:all
```

**Agent 输出解析规范**：

- **退出码 0**：解析 stdout 中各插件的输出信息（格式：`✅ 成功 [插件名](站点URL) <说明> | 余额: <金额>`），向用户输出 Markdown 汇总表格。表格中**站点名称必须带可点击的超链接**。
- **退出码 1**：报告发生失败的插件及详细错误信息，并提取输出中的 `screenshots/<plugin_id>-<timestamp>.png` 截图路径提示用户。

### 2.2 交互式登录初始化

```bash
node index.js --setup <plugin_id>
```

**Agent 协同规则**：

- 执行后将启动有头（Headed）浏览器窗口。
- 当控制台输出 `Setup 模式：请在弹出的浏览器中完成登录...` 时，Agent 应主动提示用户：“请在弹出的浏览器窗口中完成手动登录，完成后程序会自动检测跳转、保存会话并退出”。

### 2.3 查看已注册插件

```bash
node index.js --list
# 或
npm run list
```

### 2.4 单插件独立调试

```bash
node index.js <plugin_id>
```

---

## 💡 3. 插件开发规范与标准契约

当用户要求新增或重构签到插件时，AI Agent 必须严格遵循以下标准：

### 3.1 基础契约清单

| 检查项        | 规范要求                                                            | 错误示范                                          |
| :------------ | :------------------------------------------------------------------ | :------------------------------------------------ |
| **文件位置**  | 必须位于 `plugins/<plugin_id>.js`                                   | 存放在根目录或子文件夹                            |
| **基类继承**  | 必须继承 `core/base-plugin.js` 中的 `BasePlugin`                    | 独立写 class 或导出一个纯函数                     |
| **构造方法**  | 传入 `{ id, name, description, url, loginUrl, enabled }`            | 遗漏 `id` 或 `url`                                |
| **插件 ID**   | 小写英文字母、数字、短横线或下划线 (`^[a-z0-9_-]+$`)                | 驼峰命名如 `mySite` 或含中文                      |
| **必选 Hook** | 必须实现 `async onCheckin({ page, browser, log, helper, options })` | 未覆盖基类默认方法                                |
| **成功返回**  | `{ success: true, message: '说明', balance?: '余额' }`              | 返回布尔值或 `{ code: 200 }`                      |
| **失败处理**  | 直接 `throw new Error('失败详细原因')`                              | `return { success: false }`（会导致无法触发截图） |

### 3.2 标准插件模版代码

```javascript
const { BasePlugin } = require('../core/base-plugin');

class MySitePlugin extends BasePlugin {
  constructor() {
    super({
      id: 'mysite',
      name: 'MySite',
      description: 'MySite 每日签到与额度查询',
      url: 'https://mysite.com/dashboard',
      loginUrl: 'https://mysite.com/login', // 可选，不填默认同 url
      enabled: true,
    });
  }

  /**
   * 核心签到执行逻辑（必须实现）
   */
  async onCheckin({ page, browser, log, helper }) {
    // 1. 导航至目标控制台或主页
    log(`[${this.name}] 正在打开控制台: ${this.url}`);
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 2. 清除遮罩/通知弹窗
    await helper.dismissModals(page);

    // 3. 登录状态判定（若未登录，可引导或使用 helper.handleOAuth 自动完成认证）
    if (page.url().includes('/login')) {
      log(`[${this.name}] 检测到会话过期，尝试通过 OAuth 自动重连...`);
      await helper.handleOAuth({
        page,
        triggerSelector: 'button:has-text("GitHub")',
        targetUrl: this.url,
        timeout: 25000,
      });
    }

    // 4. 执行业务签到动作
    const checkinBtn = page.locator('button:has-text("签到"), button:has-text("Check in")').first();
    await checkinBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    if (await checkinBtn.isVisible().catch(() => false)) {
      log(`[${this.name}] 点击签到按钮...`);
      await checkinBtn.click();
      await page.waitForTimeout(2000); // 仅在等待接口反馈的必要位置使用
    }

    // 5. 查询余额或状态确认
    let balance = '未知';
    const balanceElem = page
      .locator('.balance-value, span:has-text("¥"), span:has-text("$")')
      .first();
    if (await balanceElem.isVisible().catch(() => false)) {
      balance = (await balanceElem.innerText()).trim();
    }

    // 6. 返回成功结果
    return {
      success: true,
      message: '签到成功或今日已签到',
      balance,
    };
  }

  /**
   * 交互式登录 Setup 模式（可选重写，默认已有通用等待实现）
   */
  async onSetup({ page, log }) {
    log(`[${this.name}] Setup 模式：请在浏览器中登录...`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 严格使用 Predicate 等待跳转离开登录页，严禁使用粗暴 glob
    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        if (p.includes('/login')) return false;
        return url.href.startsWith(this.url) || p.includes('/dashboard');
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录完成！`);
  }
}

module.exports = MySitePlugin;
```

---

## ⚡ 4. Playwright 自动化“八项铁律” (The Iron Rules)

为杜绝自动化脚本偶发超时、上下文竞争与脆弱断言，AI Agent 编写代码时必须严格遵守以下规则：

1. **严禁无意义的固定休眠 (No Arbitrary Sleep)**：
   - 严禁滥用 `page.waitForTimeout(5000)` 或 `setTimeout` 等待页面加载。
   - **正确做法**：必须等待状态，例如 `locator.waitFor({ state: 'visible' })`、`page.waitForURL(...)` 或 `page.waitForResponse(...)`。
2. **严禁使用 `waitUntil: 'commit'`**：
   - `'commit'` 仅表示服务端发送了首字节响应头，此时 DOM 和 LocalStorage 尚未注水，过早返回会导致后续上下文关闭后状态丢失。
   - **正确做法**：导航等待必须使用 `'domcontentloaded'` 或显式选择器等待。
3. **URL 转换等待严禁使用根路径 Glob**：
   - 严禁使用 `'**/'` 或 `'**' + new URL(url).pathname + '*'`，当目标为根路径 `'/'` 时会导致登录页直接瞬时匹配成功。
   - **正确做法**：使用 Predicate 函数，显式检查 `!currentPath.includes(loginPath)`。
4. **选择器严禁假定唯一 (Strict Mode 防护)**：
   - Playwright 默认开启严格模式，当选择器命中多个元素时会抛出异常。
   - **正确做法**：使用 `.first()` 约束，例如 `page.locator('button:has-text("签到")').first()`。
5. **可选交互必须防御性兜底**：
   - 弹窗关闭按钮、遮罩、第三方授权同意按钮等可能不出现。
   - **正确做法**：调用时必须附带 `.catch(() => {})` 或配合 `isVisible().catch(() => false)`，严禁因可选元素未出现抛出未捕获异常。
6. **OAuth 必须使用框架封装**：
   - 直接使用 `helper.handleOAuth(...)`。该工具已内置了弹窗自闭竞态、直接重定向 Authorization 按钮竞态与目标 URL 清理逻辑。
7. **时间与时区统一使用 CST (UTC+8)**：
   - 签到比对必须考虑时区问题，严禁直接使用客户端本地时间的 `new Date().toISOString()` 对比服务器日期。
   - **正确做法**：统一使用 `helper.getCSTDateString()` 或 `helper.getCSTDateTimeString()`。
8. **凭证隔离与安全防泄露**：
   - 严禁在插件代码中硬编码任何真实密码、Token 或 API Key。账号密码必须通过 `core/env.js` 从 `.env` 读取。

---

## 🔒 5. 代码质量与 Pre-commit 自动化保障

项目集成了自动化代码质量保障工具链，任何代码修改必须通过验证后才能交付。

### 5.1 工具链组成

- **ESLint 10+** (`eslint.config.js`)：静态代码质量校验，拦截未定义变量、无用声明及逻辑缺陷。
- **Prettier** (`.prettierrc.json`)：统一格式化标准（2空格缩进、单引号、分号、es5 尾随逗号、行宽 100）。
- **Plugin Contract Linter** (`scripts/verify-plugins.js`)：框架专用契约检查器，自动扫描全部插件的基类继承、必须字段、反模式代码（如 `waitForTimeout`、`commit` 等）。
- **Husky & lint-staged**：在每次 `git commit` 时自动触发 `lint-staged` 与 `verify-plugins.js`，不符合规范的代码将被拦截禁止提交。

### 5.2 Agent 交付前自检清单

AI Agent 在完成任何代码编写后，**必须在同一会话中运行并确认以下命令通过**：

```bash
# 1. 运行全套静态校验与插件契约扫描
npm run check

# 2. 验证插件动态发现与无报错加载
node index.js --list
```

- 若命令返回非 0 状态码，Agent **必须自行排查并修复**，直至命令返回 0。

---

## 📋 6. 标准 Prompt 模版库

用户可直接复制以下 Prompt 指示 AI Agent 执行相应任务：

### 6.1 每日巡检与汇总汇报 Prompt

```text
请执行每日打卡巡检：
NO_COLOR=1 TERM=dumb node index.js --all

判断与汇报要求：
1. 若退出码为 0：提取各插件的签到结果与余额，以标准 Markdown 表格汇总汇报（包含列：站点名称、状态、执行说明、当前余额）。
2. 【站点名称】列必须显示为可点击跳转的 Markdown 超链接。
3. 若退出码为非 0：报告失败的插件详情，并指出其现场截图路径（screenshots/ 目录下）。
```

### 6.2 开发新插件 Prompt

```text
请为站点 [站点名称，例如 NewSite] 开发一个新的签到插件：
- 站点主页/控制台：[URL]
- 登录地址：[Login URL]
- 认证方式：[如 GitHub OAuth / 账密 / Session]

开发要求：
1. 遵循 AGENTS.md 规范，在 plugins/[site_id].js 中创建插件并继承 BasePlugin。
2. 严禁使用 page.waitForTimeout，使用状态等待与严格 URL Predicate。
3. 遵循 CST (UTC+8) 日期比对。
4. 开发完成后运行 npm run check 与 node index.js --list 确保无任何语法与契约报错。
```

### 6.3 修复插件反模式与规范 Prompt

```text
请按照 AGENTS.md 规范审查并重构现有插件 [插件ID]：
1. 消除所有 page.waitForTimeout 任意睡眠，改用 locator.waitFor 或 URL predicate。
2. 消除任何 waitUntil: 'commit'，改用 'domcontentloaded'。
3. 确保所有可选 DOM 操作均有防御性 catch 处理。
4. 运行 npm run check 验证完全符合架构契约。
```
