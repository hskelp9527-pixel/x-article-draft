# Changelog

## 0.2.0 — 2026-10-16 (experimental plugin preview)

- 新增独立 Obsidian 桌面插件：侧栏按钮、命令、首次引导、设置页、进度与结果提示。
- 浏览器默认路线由插件自己控制专用 Chrome，无需 Agent、API Key 或额外 Node.js 安装；首次用户登录后复用专用会话。
- 可选官方 API，在设置页完成 OAuth 2.0 PKCE 授权，复用既有客户端与令牌续期。
- 图片优先使用 Obsidian 的实际链接解析；读取当前编辑器未落盘的文字，不改原稿或附件。
- 浏览器图片按占位符原位置逐张上传，重新打开核验正文与图片；已保存草稿复用，内容变化先确认新建，结果不明时停止自动重试。
- 新增插件编译、加载入口及独立 Chrome 本地仿真编辑器测试，现有测试共 23 项。保留 Skill 与 CLI 入口。

真实 X 页面和账号的端到端投递仍待验收；尚未上架 Obsidian 官方社区市场。仅保存草稿，不自动公开发布。

## 0.1.0 — 2026-10-16 (experimental preview)

- 新增 X Articles 草稿 Skill，默认浏览器工作流，可选官方 API。
- 解析标准 Markdown、reference-style 图片及 Obsidian WikiLink 附件，保留正文图片位置。
- 提供首次配置、网站入口、OAuth 2.0 PKCE 授权和令牌续期。
- 新增 API 重复提交记录、提交结果不明时停止重试、账号间隔离和执行锁。
- 提供富文本剪贴板辅助程序，以及中英文安装说明、问题反馈与贡献入口。
- 19 项本地/模拟测试通过；GitHub Actions 覆盖 Node.js 22/24 与 Windows/macOS/Linux。

尚未完成真实 X 账号端到端投递验收。浏览器控制由宿主提供；macOS/Linux 剪贴板尚未实机验收。此版本不自动公开发布，也不更新已有 API 草稿。
