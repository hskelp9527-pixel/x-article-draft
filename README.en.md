# x-article-draft

[![Tests](https://github.com/hskelp9527-pixel/x-article-draft/actions/workflows/test.yml/badge.svg)](https://github.com/hskelp9527-pixel/x-article-draft/actions/workflows/test.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[简体中文](README.md) · English · [Releases](https://github.com/hskelp9527-pixel/x-article-draft/releases) · [Report a problem](https://github.com/hskelp9527-pixel/x-article-draft/issues/new/choose)

Save an Obsidian or Markdown long-form article, including existing local images, as an **X Article draft**. An Agent Skill for hosts such as Codex and Claude Code. Nothing in this package publishes an Article publicly.

**v0.1.0 is an experimental preview.** Local conversion and the official API client have automated tests. Real-account end-to-end submission has not yet been verified. Browser mode requires browser-control tools in your Agent host; installing this Skill alone does not provide them.

## Why use it?

- Resolve pasted images such as `![[Pasted image.png|640]]`, even when attachments are in another vault folder.
- Keep existing text, semantic formatting, and body image order without moving source attachments.
- Start with a browser workflow that does not require your own API application, or choose the official OAuth-based API workflow.
- Follow first-run setup, then reuse the local configuration and login/authorization on later runs.
- Stop on missing or ambiguous images rather than silently omitting them.

## Install

Requires [Node.js 22+](https://nodejs.org/en/download). Ask your Agent:

> Install the x-article-draft Skill from https://github.com/hskelp9527-pixel/x-article-draft. Follow its first-run guide, use browser mode by default, and save my selected Markdown article and existing images as an X Article draft without publishing it.

Or download the ZIP from [Releases](https://github.com/hskelp9527-pixel/x-article-draft/releases), place the extracted `x-article-draft` folder in your host's Skills directory, and run inside it:

```sh
npm ci
node scripts/cli.mjs doctor
```

Typical directories: `$CODEX_HOME/skills/` or `~/.codex/skills/` for Codex; `~/.claude/skills/` for Claude Code. Follow your host's reload instructions.

## Use

> Use x-article-draft to save /path/to/article.md and its images to my X Articles drafts.

First use follows [the setup guide](references/setup.md) (currently in Chinese; the Agent can explain the steps in your language). Browser mode reuses the host's supported persistent Chrome session. API mode guides you through creating a public-client App in the X Developer Console and authorizing your account with OAuth 2.0 PKCE. API access and Articles eligibility depend on your X account, application permissions, and billing.

```sh
# Local only: parse the article and locate images
node scripts/cli.mjs prepare /path/article.md --vault /path/vault

# Optional official API route
node scripts/cli.mjs setup --method api
node scripts/cli.mjs auth --client-id YOUR_PUBLIC_CLIENT_ID
node scripts/cli.mjs save /path/article.md --vault /path/vault --method api
```

`save --method browser` prepares a manifest and HTML for the Agent to continue in your browser. It is **not a standalone browser uploader**. API save directly creates a remote draft and may incur X API charges.

## Limits and privacy

PNG/JPEG/WebP/GIF files up to 5MB each; files must be inside the selected vault. Download external images into the vault first. Custom CSS is not transferred. API mode flattens nested lists and converts inline code to plain text, with warnings. The API route reuses locally recorded identical drafts; changed content creates a new draft rather than updating the old one. The browser workflow must reopen the draft to verify persistence.

Credentials and submission records stay in each user's `~/.x-article-draft/`, outside the package. Prepared files contain article text and local paths and must not be shared. There is no project-hosted service or shared API key.

Run `npm test` for automated tests. Clipboard behavior and real-account saves still require platform-specific acceptance testing. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Questions: [Discussions](https://github.com/hskelp9527-pixel/x-article-draft/discussions). Sensitive reports: [SECURITY.md](SECURITY.md).

MIT licensed. Browser workflow inspired by [baoyu-post-to-x](https://github.com/JimLiu/baoyu-skills/tree/main/skills/baoyu-post-to-x); upstream scripts are not bundled. Not affiliated with X or Obsidian.
