# Changelog

## 0.1.0 — 2026-10-16 (experimental preview)

- 新增 X Articles 草稿 Skill，默认浏览器工作流，可选官方 API。
- 解析标准 Markdown、reference-style 图片及 Obsidian WikiLink 附件，保留正文图片位置。
- 提供首次配置、网站入口、OAuth 2.0 PKCE 授权和令牌续期。
- 新增 API 重复提交记录、提交结果不明时停止重试、账号间隔离和执行锁。
- 提供富文本剪贴板辅助程序，以及中英文安装说明、问题反馈与贡献入口。
- 19 项本地/模拟测试通过；GitHub Actions 覆盖 Node.js 22/24 与 Windows/macOS/Linux。

尚未完成真实 X 账号端到端投递验收。浏览器控制由宿主提供；macOS/Linux 剪贴板尚未实机验收。此版本不自动公开发布，也不更新已有 API 草稿。
