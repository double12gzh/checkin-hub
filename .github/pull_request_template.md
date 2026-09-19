## 📋 PR 概述

<!-- 简要描述此 PR 解决的问题、新增的功能或改进的内容 -->

### 🏷️ 变更类型 (Type)

- [ ] `feat(plugins)`: 新增站点签到插件
- [ ] `fix(plugins)`: 修复或适配现有插件
- [ ] `feat(core)`: 框架核心能力、浏览器引擎或 MCP 工具更新
- [ ] `fix(core)`: 框架核心 Bug 修复
- [ ] `refactor`: 代码重构（无功能/逻辑变动）
- [ ] `test`: 新增或更新单元测试
- [ ] `docs`: 文档或规范更新
- [ ] `chore`: 依赖或工程构建配置调整

---

## 🔗 关联 Issue

<!-- 请关联对应的 Issue，例如: Closes #12, Fixes #34 -->

- Closes #

---

## 📝 核心变更点

<!-- 列出具体的变更细节 -->

-
-

---

## 🛡️ 架构契约与质量自检清单 (Pre-merge Checklist)

在提交 PR 前，请确保已严格遵循 [AGENTS.md](https://github.com/double12gzh/checkin-hub/blob/master/AGENTS.md) 架构规范并勾选以下自检项：

### 1. 插件契约与自动化铁律（若涉及插件）

- [ ] **接口规范**：位于 `plugins/<id>.js`，继承自 `core/base-plugin.js` 中的 `BasePlugin`，已实现 `onCheckin` 钩子。
- [ ] **异常即截图**：签到失败时直接抛出 `throw new Error('原因')` 以便核心自动捕获现场截图，未返回伪成功的 `{ success: false }`。
- [ ] **无固定休眠**：杜绝滥用 `page.waitForTimeout`，完全使用状态等待或显式选择器（必须使用的少量拟人防盾已标注 `// ok: sleep`）。
- [ ] **严禁 commit**：导航与加载统一使用 `'domcontentloaded'`，未引入 `'commit'` 反模式。
- [ ] **时区规约**：日期比对统一使用 `helper.getCSTDateString()` 确保 CST (UTC+8) 一致性。
- [ ] **防信息泄露**：未硬编码任何个人工作目录（`/Users/...`）或真实账号密码，敏感凭据通过 `.env` 隔离。

### 2. 本地测试与质量门禁验证

- [ ] **全套门禁通过**：本地执行 `npm run check` 退出码为 `0`（包含 ESLint 10+、Prettier、26+ 单元测试与插件静态契约扫描）。
- [ ] **动态注册验证**：本地运行 `node index.js --list`，插件能被动态发现且无语法报错。
- [ ] **单插件调试通过**：本地针对所修改的插件执行 `node index.js <plugin_id>` 验证打卡流程顺畅。

### 3. Git 规范与 AI 协同审计

- [ ] **规范提交信息**：遵循 Conventional Commits 格式（`<type>(<scope>): <subject>`）。
- [ ] **开发者主权与协同署名**：Author/Committer 保持真实人类身份；若使用了 AI Agent 结对编程，提交末尾已显式附加规范且去版本化的 `Co-Authored-By: <Model> <noreply@...>` 审计署名。
