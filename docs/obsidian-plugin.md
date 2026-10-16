# Obsidian 插件：点一下，存到 X 草稿

插件可以独立运行。日常不需要打开 Agent、不需要输入命令，也不需要另外安装 Node.js。首次完成登录或授权后，打开文章，点击 Obsidian 左侧的发送图标 **“存到 X 草稿”**。

当前是 **0.2.0 实验版，桌面端**。已验证插件编译、加载入口，以及独立 Chrome 对本地仿真编辑器填正文、插入图片、重新打开核验的流程。真实 X 页面可能变化；真实账号的端到端投递尚未验收，失败会停止并保留现场，不能把本地测试当作真实账号投递成功。

## 安装

1. 在 [Releases](https://github.com/hskelp9527-pixel/x-article-draft/releases) 下载 `x-article-draft-obsidian-0.2.0.zip`。这是插件安装包；不要误下载 Skill 源码包。
2. 解压，将 `x-article-draft` 文件夹放到知识库 `.obsidian/plugins/` 下。最终应该能看到 `.obsidian/plugins/x-article-draft/main.js`、`manifest.json` 和 `styles.css`。
3. 在 Obsidian 的 **设置 → 第三方插件** 开启 `X Article Draft`。如果暂时没有出现，重启 Obsidian 后再看。当前尚未上架官方社区市场，不能承诺在市场搜索安装。
4. 点击左侧发送图标，首次会出现配置引导。插件设置也有相同入口。

仓库根目录 Release 的 `main.js`、`manifest.json`、`styles.css` 也是标准安装文件，供熟悉手动安装或 BRAT 的用户使用。用户安装 Release 文件无需 npm；开发者改源码才运行 `npm ci && npm run build`。

## 默认：Chrome 浏览器

1. 电脑已安装 Google Chrome；插件设置中点击 **打开 Chrome 登录**。
2. 插件自动打开专用 Chrome 窗口。用户本人登录 X，核对账号，并确认可以进入 Articles 撰写界面。登录资料保存在本机个人目录，日常 Chrome 的资料不会被复制。专用窗口首次需要单独登录一次。
3. 回到 Obsidian，打开要保存的文章，点左侧 **存到 X 草稿**。
4. 插件读取当前编辑器里的文字（包括还没保存到磁盘的修改），通过 Obsidian 链接解析寻找附件，填写 X 长文章，逐张上传正文图片。状态栏显示当前进度。
5. 上传结束后等待自动保存，再重新打开同一草稿，核对标题、全文和图片数量。确认成功才显示完成。

无需开发者账号或 API Key，也无需 AI Agent。你的 X 账号仍须有 Articles 使用资格。X 要求重新登录或出现账号校验时，用户在专用 Chrome 处理，再继续。自动化期间不要操作同一编辑器；完成后可在 Chrome 手动检查与发布。

专用 Chrome 通过仅绑定本机的调试连接接受插件操作。关闭专用 Chrome 即关闭该连接；插件不会自动关闭日常浏览器。插件使用系统富文本剪贴板放入正文，这一步会替换当前剪贴板内容。

如果自动找不到 Chrome，在插件设置的 **Chrome 路径** 填完整可执行文件路径。macOS 填 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，Windows 常见为 `C:\Program Files\Google\Chrome\Application\chrome.exe`。

## 官方 API（可选）

希望不用浏览器执行日常上传时，在插件设置把保存方式改为 **官方 API**。费用与访问条件以 X 控制台为准。

1. 打开 https://developer.x.com/ ，申请开发者访问，创建或选择自己的 App。
2. 进入该 App 的 **User authentication settings**，开启 OAuth 2.0，类型选择 **Public client / Native App**。若要求网站 URL，填写自己的真实项目地址。首版不支持需要 Client Secret 的 Web App。
3. Callback URI 精确填写 `http://127.0.0.1:8765/callback`；不要写 localhost，也不要多加斜线。若控制台提供 Read/Write 权限选项，选择 Read and Write。
4. 在 **Keys and Tokens** 找到 **OAuth 2.0 Client ID**，填入插件设置。它不是 API Key、App-only Bearer Token 或 Client Secret。
5. 点击 **连接 X 账号**。插件打开 X 的官方授权页面，在浏览器确认账号并授权。回调后自动取得令牌并显示账号，无需复制令牌。
6. 查看开发者控制台的 API 费用、余额与权限。之后点左侧 **存到 X 草稿** 即可按所选 API 路线上传。授权成功不代表 Articles 接口权限一定可用，首篇草稿返回 ID 才确认创建成功。

授权请求 `tweet.read tweet.write users.read media.write offline.access`，支持本机令牌续期；过期或撤销时重新点连接。该 API 配置与 Skill 的 API 方式共用当前本机账号。插件目前不提供多账号管理。

官方依据：[Articles](https://docs.x.com/x-api/articles/introduction)、[草稿字段](https://docs.x.com/x-api/articles/create-draft-article)、[媒体上传](https://docs.x.com/x-api/media/upload-media)、[OAuth 2.0 PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)。

## 图片、重复点击与失败恢复

- 图片可以放在任意知识库内文件夹。`![[截图.png|640]]`、普通 Markdown 图片、reference-style 图片均支持。优先使用 Obsidian 实际链接解析结果，最终检查文件确实位于该知识库内。
- 每张上限 5MB，支持 PNG/JPEG/WebP/GIF；外链、SVG、视频或超限图片需先处理。缺图或找不到文件会在上传前停止，不自动生成替代图，不修改原稿。
- 浏览器方式保留网页支持的语义排版；自定义 CSS 不搬运。API 对嵌套列表、行内代码等会提示转换差异，确认后继续。
- 正在上传时重复点击不会启动第二个任务。相同笔记和内容会尝试打开/复用之前的草稿；原文已修改时，浏览器方式会询问是否新建，原草稿保留。API 不支持更新已有草稿，修改后会新建。
- 失败或超时后先检查专用 Chrome / X 草稿箱。结果不明的任务不会自动重试；确实需要重新新建时，到插件设置 **检查后清除记录**。清除前请确认已有内容，避免副本。
- 账号校验、X 页面改版、网络故障、文本或图片核验失败会停止，显示尚未完成，并保留浏览器现场。请用 [问题模板](https://github.com/hskelp9527-pixel/x-article-draft/issues/new/choose) 反馈当前步骤，勿提交私密正文、Cookie 或令牌。

## 本机数据

插件 `data.json` 仅保存方式、Chrome 路径、公开 Client ID 和是否已走过引导，不保存访问令牌。账号授权、专用 Chrome 登录资料和提交记录放在用户目录的 `~/.x-article-draft/`（或用户自设的 `X_ARTICLE_DRAFT_HOME`）。它们不应放进知识库或开源包；目前是个人目录文件存储，不宣称加密保险库。

本插件不提供任何自动公开发布按钮，也不会让 Agent 在后台写作或找新图。
