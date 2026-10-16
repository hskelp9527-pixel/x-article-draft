# 官方 API 路线

首次准备按 [setup.md](setup.md)。当前实现使用 Public client 的 OAuth 2.0 PKCE；不是把 App-only Bearer Token 当作用户令牌。

```text
node scripts/cli.mjs save /path/note.md --vault /path/vault --method api
```

脚本按顺序执行：

1. 解析完整文章并检查全部图片；缺图时没有远程写入。
2. 读取当前账号授权，必要时刷新用户令牌。
3. 按账号＋文章内容指纹检查提交记录；已保存的完全相同内容返回原草稿 ID。
4. 用 `/2/media/upload` 上传本篇图片；同一文件内容只上传一次，正文多处引用仍保留。首版每张上限 5MB，不自动压缩或改变原图。GIF 如返回异步处理状态会停止，不创建缺图草稿。
5. 将图片 media_id 写入 DraftJS content_state 的 image entities，将封面写入 cover_media。正文支持标题、段落、加粗、斜体、删除线、引用、列表、链接、分隔线、图片；表格/代码作为官方 markdown entity。嵌套列表会展开并提示，行内代码会退为普通文本并提示。自定义 CSS 不适用。
6. 写入 pending 记录后，只执行一次 `POST /2/articles/draft`。返回 ID 后记 saved，显示当前账号和图片数量。程序里没有 publish 接口。

## 重复与失败恢复

没有官方已核实的更新草稿端点，因此**不承诺自动更新原草稿**。相同内容复用本地已保存记录（没有远程重新读取核验）；内容变化创建新草稿。用户在 X 删除过旧草稿时，明确要求重新创建才能用 `--new`。

创建请求超时或返回不确定结果会保留 pending，禁止自动重试。先在 X Articles 草稿列表检查是否已经创建；确认需要新建后再执行 `--new`。这可能创建副本，Agent 应先说明本次是新建。

图片上传失败可能已经产生临时媒体，但未创建草稿；不自动无限重试。402 查余额/费用，403 查 Articles/应用权限，401 重新授权，429 稍后手动继续。不要打印完整 X 响应、请求头、令牌、回调 code。

网络请求固定使用 X 官方 HTTPS 域名。测试通过依赖注入使用 mock，不支持把真实令牌发送到任意 API base URL。

## 本机状态

默认 `~/.x-article-draft/`，可用 `X_ARTICLE_DRAFT_HOME` 指定其他个人私密目录。包含 config.json、auth.json、journal.json、执行中的 api.lock。不得放进笔记库或 Git。API 单进程互斥；崩溃残留 lock 时，先确认没有运行任务再手动移除。

授权验证 `/2/users/me` 不等于 Articles 创建权限验证。首版目前只有本地与模拟 API 测试；必须用真实账号完成一次图片长文草稿验收后，才能宣称该账号端到端可用。
