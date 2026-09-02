# AGENTS.md - AI Agent 运行与开发规范

本文档为 AI Agent（Antigravity、Claude Code、Cursor、Cline 等）提供操作本项目的标准规范与提示词模版。

---

## 📌 项目概况
这是一个基于 Node.js 与 Playwright 构建的通用插件化每日签到框架。

- **框架核心**：`core/`（包含 `base-plugin.js`、`browser-manager.js`、`helper.js`、`plugin-loader.js`、`env.js`）
- **业务插件**：`plugins/`（如 `plugins/agentrouter.js`、`plugins/hcnsec.js`）
- **统一主入口**：`index.js`

---

## 🛠️ 常用 Agent 操作指令

### 1. 执行日常签到巡检
```bash
node index.js --all
```
**Agent 解析规则**：
- 退出码为 `0`：解析 stdout 中各插件的签到结果与余额（格式为 `✅ 成功 [插件名](站点URL) <说明> | 余额: <金额>`），向用户以 Markdown 表格汇总汇报，站点名称附带超链接。
- 退出码为 `1`：报告失败详情，并向用户提示现场截图路径（格式如 `screenshots/<plugin_id>-<timestamp>.png`）。

### 2. 交互式登录初始化
```bash
node index.js --setup <plugin_id>
```
**Agent 操作规则**：
- 执行后会弹出有头浏览器窗口。
- Agent 检测到控制台输出 `Setup 模式：请在弹出的浏览器中完成登录...` 后，提示用户在弹出的浏览器窗口中完成手动登录。
- 用户登录完成后，程序会自动保存 session 并正常退出。

### 3. 查看可用插件列表
```bash
node index.js --list
```

---

## 💡 开发新插件规范

当用户要求添加新站点签到时，请遵循以下规范：

1. **文件位置**：新建 `plugins/<site_id>.js`
2. **继承基类**：继承 `core/base-plugin.js` 中的 `BasePlugin`
3. **实现方法**：
   - 在 `constructor` 中传入 `{ id, name, description, url, loginUrl, enabled: true }`。
   - 实现 `async onCheckin({ page, browser, log, helper, options })`。
   - 充分利用 `helper.dismissModals(page)`、`helper.handleOAuth(...)` 等框架内置工具简化代码。
   - 成功时返回 `{ success: true, message: '...', balance?: '...' }`。
   - 失败时直接 `throw new Error('失败原因')`。
4. **验证**：运行 `node index.js --list` 确认加载成功，再运行 `node index.js <site_id>` 验证打卡。
