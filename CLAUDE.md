# CLAUDE.md - Checkin-Hub 指令与规范

本文档是针对 **Claude Code** 与 **Claude Desktop** 的专用指令规范。
完整系统架构与开发细节请同步参考 [AGENTS.md](file:///Users/jeffreyguan/Documents/scripts/checkin-hub/AGENTS.md)。

---

## 🛠️ 常用开发与巡检命令

```bash
# 代码静态校验、单元测试与契约测试（提交或交付前必跑）
npm run check

# 运行自动化单元测试
npm test

# 列出所有已加载的插件
node index.js --list

# 运行所有插件每日打卡
node index.js --all

# 交互式初始化登录指定插件（弹出浏览器）
node index.js --setup <plugin_id>

# 运行调试单个插件
node index.js <plugin_id>
```

---

## ⚡ 核心架构与自动化铁律 (The Iron Rules)

1. **核心与业务严格隔离**：`core/` 仅提供浏览器、环境与通用 DOM 工具，禁止存放站点专属选择器。所有业务插件必须位于 `plugins/<plugin_id>.js` 并继承 `core/base-plugin.js`。
2. **严禁固定休眠**：严禁无理由使用 `page.waitForTimeout()` 或 `setTimeout()`，必须基于语义状态等待（如 `locator.waitFor()`、`page.waitForURL()`）。
3. **严禁 `waitUntil: 'commit'`**：页面导航等待必须使用 `'domcontentloaded'`。
4. **严格 Predicate URL 等待**：跳转判断必须使用函数明确排除登录路由，禁止粗暴的根路径通配符。
5. **防御性 UI 操作**：可选弹窗、通知或同意按钮点击必须带有 `.catch(() => {})`。
6. **时区统一**：日期比对必须统一使用中国标准时间 CST (UTC+8)，通过 `helper.getCSTDateString()` 获取。

---

## 💻 Shell 执行规范

- **严禁裸用 `cat` 命令**：用户本地终端已将 `cat` 别名为 `bat`，直接使用 `cat` 会输出行号和 `STDIN ─────────` 装饰框，导致脚本或提交信息被脏字符污染。
- 在命令中生成多行文本时，**必须使用多重 `-m` 参数**、`printf "%s\n" "..."`，或使用 `\cat` 绕过别名。

---

## 🔀 Git 身份归属与 AI 协同署名规范（架构 2：人类主权 + AI 审计）

在本项目中，所有代码提交必须严格遵守“人类主权 + AI 审计”准则：

- **背景与权责划分**：
  - 代码的最终责任人与主所有者永远是当前操作的人类开发者，保障代码终身追溯、Git Blame 精准定位与人类贡献统计（GitHub 绿格子）。
  - Claude 作为结对编程助手（Pair Programmer），其协同贡献通过业界标准的 `Co-Authored-By` 进行审计追踪。
- **强制规则**：
  - **Author & Committer 归属人类**：执行 `git commit` 时，必须直接继承并使用当前操作者本地配置的个人身份（`user.name` 与 `user.email`），严禁篡改或抹除人类主责任人。
  - **AI 协同署名（强制附加）**：Claude 提交代码时，提交信息末尾**必须显式附加** `Co-Authored-By: Claude <noreply@anthropic.com>` 尾注。
  - **模型名称规范**：仅使用简明的大类模型名字 `Claude`，**严禁携带版本号与冗余细节**（严禁使用 `Claude 3.7`、`Claude 3.7 Sonnet` 等）。
  - **邮箱格式规范**：必须使用官方域名 `noreply@anthropic.com`。
  - **命令执行标准模板**：

    ```bash
    git commit -m "<type>(<scope>): <subject>" \
      -m "- <变更点 1>
    - <变更点 2>" \
      -m "Co-Authored-By: Claude <noreply@anthropic.com>"
    ```

---

## ✅ 任务交付自检清单

在报告任务完成前，必须确保以下两项命令在控制台退出码为 0：

1. `npm run check`
2. `node index.js --list`
