---
name: author-checkin-plugin
description: 指导 AI Agent 在 Checkin-Hub 中开发、重构、调试与交付高质量站点签到打卡插件，严格遵循八项铁律与接口契约
---

# Author Checkin Plugin 技能指南

本技能指导 AI Agent 在 **Checkin-Hub** 项目中开发全新的签到打卡插件或重构现有插件。

---

## 🎯 触发场景

当用户提出以下需求时激活此技能：

- “为 [站点名] 开发一个新的签到插件”
- “重构/修复 [插件ID] 插件”
- “添加某某站点的自动打卡功能”

---

## 🏗️ 插件核心接口契约 (Contract)

所有签到插件必须满足以下规范，否则将被自动化静态契约测试 (`scripts/verify-plugins.js`) 拦截：

1. **文件位置**：`plugins/<plugin_id>.js`（严禁放在子目录或根目录）。
2. **类继承**：必须使用 CommonJS 继承 `core/base-plugin.js` 中的 `BasePlugin`。
3. **构造函数传参**：
   - `id`: 必须满足 `^[a-z0-9_-]+$`（全小写英文、数字、短横线或下划线）。
   - `name`: 插件中文或英文展示名。
   - `url`: 目标控制台或个人主页（必须以 `http://` 或 `https://` 开头）。
   - `loginUrl`: 登录页 URL（可选，默认同 `url`）。
   - `enabled`: 布尔值，是否默认启用。
4. **必须实现的钩子方法**：
   - `async onCheckin({ page, browser, log, helper, options })`：打卡核心逻辑。
   - `async onSetup({ page, log })`：（可选重写，默认已有通用跳转等待逻辑）。
5. **返回值契约**：
   - 成功必须返回：`{ success: true, message: '说明', balance?: '最新余额' }`。
   - 失败**严禁**返回 `{ success: false }`，必须直接抛出异常 `throw new Error('失败原因')`（框架核心会在统一捕获后自动截屏至 `screenshots/<plugin_id>-<timestamp>.png`）。

---

## ⚡ Playwright 自动化“八项铁律” (The Iron Rules)

编写插件代码时**绝对禁止**触犯以下规则：

1. **严禁无意义的固定休眠 (No Arbitrary Sleep)**：
   - 严禁滥用 `page.waitForTimeout(...)` 或 `setTimeout` 等待页面加载。
   - 必须等待状态，例如 `locator.waitFor({ state: 'visible' })`、`page.waitForURL(...)` 或 `page.waitForResponse(...)`。
2. **严禁使用 `waitUntil: 'commit'`**：
   - `'commit'` 仅表示服务端发送了首字节响应头，此时 DOM 和 LocalStorage 尚未注水，过早返回会导致后续上下文关闭后状态丢失。
   - 导航等待统一使用 `'domcontentloaded'` 或显式选择器等待。
3. **URL 转换等待严禁使用根路径 Glob**：
   - 严禁使用 `'**/'` 或 `'**' + new URL(url).pathname + '*'`。
   - 必须使用 Predicate 函数，显式检查 `!currentPath.includes(loginPath)`。
4. **选择器严禁假定唯一 (Strict Mode 防护)**：
   - Playwright 默认开启严格模式，当选择器命中多个元素时会抛出异常。
   - 必须使用 `.first()` 约束，例如 `page.locator('button:has-text("签到")').first()`。
5. **可选交互必须防御性兜底**：
   - 弹窗关闭按钮、遮罩、第三方授权同意按钮等可能不出现。
   - 调用时必须附带 `.catch(() => {})` 或配合 `isVisible().catch(() => false)`，严禁因可选元素未出现抛出未捕获异常。
6. **OAuth 必须使用框架封装**：
   - 直接使用 `helper.handleOAuth(...)`。该工具已内置了弹窗自闭竞态、直接重定向 Authorization 按钮竞态与目标 URL 清理逻辑。
7. **时间与时区统一使用 CST (UTC+8)**：
   - 签到比对必须考虑时区问题，严禁直接使用客户端本地时间的 `new Date().toISOString()` 对比服务器日期。
   - 统一使用 `helper.getCSTDateString()` 或 `helper.getCSTDateTimeString()`。
8. **凭证隔离与安全防泄露**：
   - 严禁在插件代码中硬编码任何真实密码、Token 或个人工作目录。敏感信息必须通过 `core/env.js` 从 `.env` 读取。

---

## 📋 标准插件代码模板

```javascript
const { BasePlugin } = require('../core/base-plugin');

class MySitePlugin extends BasePlugin {
  constructor() {
    super({
      id: 'mysite',
      name: 'MySite',
      description: 'MySite 每日签到与额度查询',
      url: 'https://mysite.example.com/dashboard',
      loginUrl: 'https://mysite.example.com/login',
      enabled: true,
    });
  }

  /**
   * 核心签到执行逻辑（必须实现）
   */
  async onCheckin({ page, browser, log, helper }) {
    log(`[${this.name}] 正在打开站点: ${this.url}`);
    await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 1. 清理可能的遮罩与通告弹窗
    await helper.dismissModals(page);

    // 2. 登录状态判定与 OAuth 重连
    if (page.url().includes('/login')) {
      log(`[${this.name}] 检测到会话过期，尝试通过 OAuth 自动重连...`);
      await helper.handleOAuth({
        page,
        triggerSelector: 'button:has-text("GitHub"), a:has-text("GitHub")',
        targetUrl: this.url,
        timeout: 25000,
      });
    }

    // 3. 检查今日是否已签到或点击签到按钮
    const checkinBtn = page.locator('button:has-text("签到"), button:has-text("打卡")').first();
    await checkinBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    if (await checkinBtn.isVisible().catch(() => false)) {
      const btnText = (await checkinBtn.innerText()).trim();
      if (btnText.includes('已签到')) {
        log(`[${this.name}] 今日已完成签到。`);
      } else {
        log(`[${this.name}] 点击签到按钮...`);
        await checkinBtn.click();
      }
    }

    // 4. 抓取最新余额
    let balance = '未知';
    const balanceElem = page
      .locator('.balance-value, span:has-text("¥"), span:has-text("$")')
      .first();
    if (await balanceElem.isVisible().catch(() => false)) {
      balance = (await balanceElem.innerText()).trim();
    }

    // 5. 返回成功结果
    return {
      success: true,
      message: '签到成功或今日已签到',
      balance,
    };
  }

  /**
   * 交互式登录 Setup 模式
   */
  async onSetup({ page, log }) {
    log(`[${this.name}] Setup 模式：请在浏览器窗口中完成手动登录...`);
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForURL(
      (url) => {
        const p = url.pathname;
        if (p.includes('/login')) return false;
        return url.href.startsWith(this.url) || p.includes('/dashboard');
      },
      { timeout: 300000, waitUntil: 'domcontentloaded' }
    );
    log(`[${this.name}] 登录会话捕获完成！`);
  }
}

module.exports = MySitePlugin;
```

---

## 🛠️ 开发与交付流水线 (SOP)

1. **编写插件**：在 `plugins/<plugin_id>.js` 遵循模板创建。
2. **独立单测**：
   ```bash
   node index.js <plugin_id>
   ```
3. **架构契约与语法质检**：
   ```bash
   npm run check
   ```
4. **插件动态注册验证**：
   ```bash
   node index.js --list
   ```
5. **Git 提交交付**：
   - 严格继承本地人类开发者身份，末尾附加去版本化的模型协同署名：
   ```bash
   git commit -m "feat(plugins): add <plugin_id> checkin plugin" \
     -m "- Implement automated checkin for <SiteName>
   - Add balance query support
   - Pass all verify-plugins static contracts" \
     -m "Co-Authored-By: <Model> <noreply@...>"
   ```
