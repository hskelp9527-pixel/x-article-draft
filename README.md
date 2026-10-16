# x-article-draft

[![Tests](https://github.com/hskelp9527-pixel/x-article-draft/actions/workflows/test.yml/badge.svg)](https://github.com/hskelp9527-pixel/x-article-draft/actions/workflows/test.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Release](https://img.shields.io/github/v/release/hskelp9527-pixel/x-article-draft?include_prereleases)](https://github.com/hskelp9527-pixel/x-article-draft/releases)

简体中文 · [English](README.en.md) · [下载](https://github.com/hskelp9527-pixel/x-article-draft/releases) · [反馈问题](https://github.com/hskelp9527-pixel/x-article-draft/issues/new/choose)

把 Obsidian / Markdown 长文和本地图片存入 **X Articles 草稿**。现在提供 **Obsidian 插件**和 **Agent Skill** 两个入口。

**当前版本 0.2.0，实验版。** 插件默认自己操作专用 Chrome，无需 AI Agent 或 API Key；也可选择官方 API。真实 X 账号投递尚未验收，不宣称所有账号即装即用。工具只存草稿。

## Obsidian 插件：打开文章，点一下

1. 从 [v0.2.0 Releases](https://github.com/hskelp9527-pixel/x-article-draft/releases/tag/v0.2.0) 下载 **x-article-draft-obsidian-0.2.0.zip**。
2. 解压，将 `x-article-draft` 文件夹放到知识库 `.obsidian/plugins/`，在 Obsidian 第三方插件中开启 **X Article Draft**。
3. 首次点左侧发送图标，按引导打开专用 Chrome 登录 X；之后打开文章，点 **存到 X 草稿** 即开始处理。

插件会读取当前编辑器、通过 Obsidian 实际链接定位图片、逐张上传，并重新打开草稿核验。状态栏显示进度。安装包已包含程序，日常使用无需装 Node.js、运行命令或打开 Agent。仅桌面端，电脑需要 Chrome，账号需要有 Articles 能力；当前尚未上架 Obsidian 社区市场。

完整步骤和 API 可选配置见 [插件使用指南](docs/obsidian-plugin.md)。

| 入口 | 默认保存方式 | 是否需要 Agent |
|---|---|---|
| Obsidian 插件 | 插件自己操作专用 Chrome；可选官方 API | 不需要 |
| Agent Skill | 宿主 Agent 操作 Chrome；可选官方 API | 需要 |

## Agent Skill：一句话调用

需要 [Node.js 22+](https://nodejs.org/en/download)。可以直接把下面这句话交给自己的 Agent：

> 从 https://github.com/hskelp9527-pixel/x-article-draft 安装 x-article-draft Skill。先检查 Node.js，再按仓库的首次配置指南帮我配置，默认用浏览器方式，配置完成后把我指定的文章和已有图片存进 X Articles 草稿，不公开发布。

也可以从 [Releases](https://github.com/hskelp9527-pixel/x-article-draft/releases) 下载 ZIP，解压出 `x-article-draft` 文件夹，放入宿主的 Skills 目录，然后在该文件夹运行：

```text
npm ci
node scripts/cli.mjs doctor
```

常见 Skills 目录：Codex 为 `$CODEX_HOME/skills/`（未配置时 `~/.codex/skills/`），Claude Code 为 `~/.claude/skills/`。装好后按宿主要求刷新或新开会话。熟悉 Git 的用户可直接克隆本仓库到上述目录。

对 Agent 说：

> 用 x-article-draft，把这篇笔记连同图片存到 X 草稿：/path/to/article.md

首次运行会引导选择浏览器或 API、检查 Articles 能力、完成登录或授权。之后复用本机配置。完整网站入口和每一步见 [首次配置](references/setup.md)。Codex、Claude Code 等宿主的浏览器工具和权限各不相同，浏览器模式要求宿主本身提供控制与文件上传能力。

## 可独立运行的 CLI

```text
node scripts/cli.mjs setup --method browser
node scripts/cli.mjs prepare /path/article.md --vault /path/vault

node scripts/cli.mjs setup --method api
node scripts/cli.mjs auth --client-id YOUR_PUBLIC_CLIENT_ID
node scripts/cli.mjs save /path/article.md --vault /path/vault --method api
```

`prepare` 完全本地执行，不上传。`save --method browser` 只输出供 Agent 继续操作的准备文件，**不是独立浏览器上传命令**。API 的 save 才会直接调用官方接口，可能产生 X API 费用。

## 图片与格式

- 支持标准 Markdown 图片（含 reference-style）与 Obsidian `![[Pasted image.png|640]]`。
- 从笔记目录、vault、`.obsidian/app.json` 配置的附件目录以及 vault 内定位图片。原文件不移动、不改写。
- 找不到或同名不明确则停止；拒绝 vault 外文件。默认只处理 PNG/JPEG/WebP/GIF，每张最大 5MB。外链先下载为本地附件，不自动跟随网络图片链接。
- 保留语义格式和图片原位置。X 不支持的自定义 CSS 不搬运；API 对行内代码、嵌套列表会提示转换差异。浏览器粘贴效果取决于编辑器，需实际核验。
- API 重复提交相同内容返回原 ID；内容变化新建，暂不更新旧稿。没有 publish 功能。

## 数据与开源

MIT。代码独立实现，浏览器流程参考 [JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) 的 X Article 工作流。依赖声明见 package.json 与锁文件。

令牌、账号、草稿记录保存在各用户 `~/.x-article-draft/`，不在包内。准备文件默认在系统临时目录，含正文与本机路径，成功后由 Agent 清理。开源发行只打包源码、锁文件、测试与说明，不含任何个人文章、图片、账号、node_modules 或登录态。

测试：`npm test` 会先编译插件，再运行单元测试和本地 Chrome 仿真编辑器测试（没有 Chrome 的环境跳过浏览器测试）。插件的独立浏览器流程已在本地仿真编辑器验证，不能等同于真实 X 页面验收。Skill 的 Windows CF_HTML 字节偏移有单元测试，macOS/Linux 的 CLI 剪贴板尚未实机验证。真实账号的首次登录/授权 → 带图长文 → 草稿重新打开 → 重复运行 → 过期恢复仍待验收。

## 反馈和参与

遇到安装、找图或保存草稿的问题，请使用 [问题模板](https://github.com/hskelp9527-pixel/x-article-draft/issues/new/choose)。介绍使用场景、分享试用结果或讨论功能，可到 [Discussions](https://github.com/hskelp9527-pixel/x-article-draft/discussions)。反馈前去掉令牌、Cookie、私人文章和本机敏感路径。

欢迎贡献，见 [CONTRIBUTING.md](CONTRIBUTING.md)；版本变化见 [CHANGELOG.md](CHANGELOG.md)。本项目与 X、Obsidian 均无隶属关系。
