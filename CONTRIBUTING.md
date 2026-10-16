# 参与贡献 / Contributing

欢迎反馈使用问题、改进文档、补充宿主适配和修复代码。功能讨论可先开 Issue 或 Discussion，说明实际场景与期望结果。

## 本地开发

```sh
npm ci
npm test
```

使用 Node.js 22+。新图片解析规则需覆盖实际笔记语法，使用临时目录和合成数据。API 测试使用模拟请求，不需要凭证，不连接真实账号。涉及剪贴板的改动要注明实际测试过的操作系统，不能把算法测试等同于浏览器实机测试。

`npm test` 自动先执行插件编译；`npm run build` 可单独生成根目录 main.js 与第三方许可。插件源文件在 `plugin/`；编译产物不进 Git。浏览器集成测试只启动独立的临时 headless Chrome 和本机仿真编辑器，不连接 X，结束后关闭该测试进程并清理临时资料。没有 Chrome 时该项跳过。

PR 请说明问题、变化和验证方式。提交前不要包含 `.env`、访问令牌、Cookie、真实文章、私人图片、登录配置、prepare 生成文件或本机绝对路径。不要为了演示自动创建远程草稿。保持“只存草稿”的行为，不加入未经用户请求的公开发布动作。

支持的命令和行为变更须同步更新 README、SKILL.md 与对应 reference。完整用户引导只在首次需要时加载，不把所有配置说明塞进 Skill 入口。

## 发布维护

版本号在 package.json 与 package-lock.json 中保持一致，更新 CHANGELOG。推送后检查三平台测试，打 tag，使用 `git archive` 生成只含 Git 已跟踪源码的 ZIP，并上传 Release。没有真实账号端到端验收时必须标为 prerelease，不能宣称跨宿主安装即用。

## English

Use Node.js 22+, run `npm ci` and `npm test`, and open a focused PR explaining the problem and validation. Tests must use synthetic fixtures and mocked API calls. Do not commit credentials, cookies, personal content, generated manifests, or machine-specific paths. Preserve the draft-only workflow. State which platforms and Agent hosts you actually tested. Keep setup documentation and Skill instructions aligned with behavior.
