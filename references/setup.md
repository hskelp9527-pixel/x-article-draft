# 首次配置：一次准备，之后复用

## 先选路线

| | 浏览器（默认） | 官方 API（可选） |
|---|---|---|
| 需要开发者账号/API Key | 不需要 | 需要自己的开发者应用与用户 OAuth 授权 |
| 需要 Chrome 登录 | 需要，复用宿主支持的 Chrome 会话 | 首次授权时需要，日常提交无需浏览器自动化 |
| 需要宿主浏览器控制能力 | 需要 | 不需要 |
| 文章能力 | 账号必须能打开 Articles 编辑器 | 账号和应用必须有实际调用权限 |
| 费用 | 工具本身不收费；账号订阅、Agent 使用费用由用户承担 | X API 按控制台实际计费，另需账号资格 |

宿主指 Codex、Claude Code 等运行 Skill 的应用。Skill 不自带云服务，不收集大家的 API Key。浏览器方式的一键是“Agent 接到一次指令后执行完整流程”；不是一个无需 Agent 的独立 Obsidian 按钮。

## 共同准备

1. 安装 Node.js 22 或更新 LTS：https://nodejs.org/en/download 。已有合格版本就跳过。
2. 将完整 `x-article-draft` 文件夹放到宿主的 Skills 目录。Codex 通常为 `$CODEX_HOME/skills/`（未配置时 `~/.codex/skills/`）；Claude Code 可放 `~/.claude/skills/`。其他宿主遵守各自 Skill 加载方式。
3. 在这个文件夹执行 `npm ci`。没有 Bun、Python 或 Obsidian 插件依赖。
4. 告诉 Agent：“用 x-article-draft，把 `<笔记路径>` 存到 X 草稿。”Agent 自动检查配置，缺什么就引导什么。
5. 官方 Articles 条件以 https://help.x.com/en/using-x/articles 为准；先确认自己的账号能使用。工具不会替用户购买订阅。

## 路线 A：浏览器，无需申请 API

1. 让 Agent 检查本宿主是否提供真实 Chrome 控制能力。优先使用用户已经选择的浏览器工具，不默默切换其他浏览器或账号。若未提供，应明确说明需要接入浏览器工具，或改用 API；仅安装本 Skill 不会给宿主增加浏览器控制能力。
2. 执行 `node scripts/cli.mjs setup --method browser`。
3. 在该工具控制的 Chrome 会话打开 https://x.com/compose/articles 。用户本人登录，核对头像/账号，并确认能点“Write/撰写”。不要把密码、Cookie 发到聊天或项目文件。
4. 如宿主需要扩展或文件上传权限，按该宿主官方的浏览器工具文档配置；不要让用户启用与实际工具无关的扩展。登录应复用该工具支持的持久会话，失效时才重新登录。
5. Agent 用用户指定的第一篇真实文章上传，回到草稿列表重新打开核验正文与图片。只有核验成功才算路线 A 完成。

以后正常调用无需重复以上引导。Chrome 会话过期、换账号、Articles 权限改变时，明确指出需要恢复的步骤。

## 路线 B：X 官方 API

截至 2026-10-16 已核实官方提供 `POST /2/articles/draft`。不是普通发帖接口，也不是网页内部 GraphQL。

1. 打开 https://developer.x.com/ ，登录目标 X 账号，进入 Developer Console。按页面提示申请开发者访问并创建/选择 App。审核、权限和计费由 X 决定；不要承诺所有账号都可立即免费调用。
2. 在 App 的 **User authentication settings / 用户身份验证设置** 开启 **OAuth 2.0**。选择可作为 **Public client 的 Native App（原生应用）**；本工具首版不实现需要 Client Secret 的 confidential Web App。若页面要求网站 URL，填写自己的真实项目/网站地址。
3. 将 Callback URI / Redirect URL 精确登记为 `http://127.0.0.1:8765/callback`。不能换成 localhost 或增删末尾斜线；如本地端口被占用，统一改为其他端口并给 auth 传 `--port`。回调服务只绑定本机回环地址。
4. 选择允许写入的权限（若控制台提供 Read/Write 选项，选 Read and Write），保存设置。在 App 的 Keys and Tokens 页面找到 **OAuth 2.0 Client ID**。这不是 API Key、App-only Bearer Token 或 Client Secret。本工具只需要 Client ID 作为配置，用户访问令牌由下一步授权自动获取。
5. 本地执行：

   ```text
   node scripts/cli.mjs setup --method api
   node scripts/cli.mjs auth --client-id <OAuth-2.0-Client-ID>
   ```

6. 打开命令显示的 `https://x.com/i/oauth2/authorize?...` 链接，核对目标账号并授权。请求范围为 `tweet.read tweet.write users.read media.write offline.access`。最后一项用于续期，media.write 用于图片上传。不要把回调 URL、授权 code 或令牌复制到聊天。
7. 浏览器回到本机回调页，脚本交换令牌并请求 `/2/users/me`，显示实际授权账号。配置和令牌保存到 `~/.x-article-draft/`。Windows 依赖个人用户目录的文件权限；macOS/Linux 状态文件权限设为 0600。它们属于本机私密配置，不是保险库加密存储。
8. 先在 Developer Console 查看自己的计费/余额和访问条件。授权成功只证明身份读取成功，不证明 Articles 草稿权限。用户已选择并授权这条付费路线后，用指定的第一篇文章执行 `save --method api`，返回草稿 ID 才证明创建成功；遇到 402/403 则按错误提示回控制台核查，不自动充值、不换账号、不重复请求。

以后脚本使用已有访问令牌，临近过期时用刷新令牌续期。用户撤销授权、刷新令牌过期或 App 设置改变时，重新执行 auth。工具支持一套当前 API 账号；换号要重新授权，按用户 ID 隔离重复提交记录。

官方入口与依据：

- Articles API：https://docs.x.com/x-api/articles/introduction
- 草稿字段：https://docs.x.com/x-api/articles/create-draft-article
- 图片上传：https://docs.x.com/x-api/media/upload-media
- OAuth 2.0 PKCE：https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code

控制台的具体菜单可能调整。Agent 应按实际页面引导，遇到差异读取最新官方说明，而不是让用户反复寻找旧菜单。
