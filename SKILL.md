---
name: x-article-draft
description: Save an Obsidian or Markdown long-form article with existing local images into X Articles drafts. Resolves pasted-image WikiLinks across the vault and guides first-run browser login or optional official API authorization. Use for 存到X草稿、Obsidian转X长文章; does not publish posts or generate new illustrations.
---

# X Article Draft

Accept a Markdown note path. Preserve the author's text and image order. Output an X **Article draft**, not a regular Post or a thread. Do not call any publish endpoint or click Publish.

`{baseDir}` is this skill's folder. Requires Node.js 22+; install the package's locked dependencies with `npm ci --prefix "{baseDir}"` on first use if missing. Installation changes only this package's node_modules. A host with browser-control tools is needed for browser mode; API mode runs without browser automation after authorization.

## First use

1. Run `node "{baseDir}/scripts/cli.mjs" doctor`.
2. If unconfigured, read [references/setup.md](references/setup.md). Default to **browser**, using the user's existing Chrome session through the host's supported browser tool. Do not require users to register API credentials for this mode. If browser control is absent, explain that requirement and offer API mode; do not install persistent browser tooling without authorization.
3. Run `setup --method browser` or `setup --method api`. This saves a preference, **not proof of login or permission**. Follow the selected route's steps. Only the user can complete login, account authorization, subscriptions, or billing choices. Keep tokens out of conversation, notes, and the package.
4. Continue the already requested first draft when preparation is complete. Do not create a dummy remote article to test permissions.

## Every draft

Resolve the requested file, using the current vault/workspace context if needed. If it is ambiguous, ask for the note. Do not scan unrelated vaults. Run:

```text
node "{baseDir}/scripts/cli.mjs" prepare "<note.md>" --vault "<vault-root>"
```

The manifest lists the exact local file, SHA-256, and placeholder for each image. Image resolution covers standard Markdown, reference-style Markdown images, and `![[name.png|640]]`; it uses the note directory, vault path, Obsidian attachment setting, then a vault-only suffix search. Missing/ambiguous images stop before any upload. No source notes or original attachments are modified. Images over 5MB, remote URLs, unsupported formats, and files outside the vault require an explicit local correction; don't silently drop them.

Show material conversion warnings. X text styles are semantic; custom Obsidian CSS is not carried over. Do not rewrite text, search for replacement images, or generate illustrations as part of this skill.

- **Browser (default):** read [references/browser.md](references/browser.md) and use the prepared manifest and HTML. The script's `browser_action_required` status is a handoff to the host Agent, not a successful upload. Continue through save verification in this invocation.
- **API:** read [references/api.md](references/api.md), then run `node "{baseDir}/scripts/cli.mjs" save "<note.md>" --vault "<vault-root>" --method api`. Reuse the account's saved authorization; the script refreshes it when possible. Don't ask for credentials on every run.

Report the actual account, title, body image count, cover status, and draft ID/observed editor URL. Distinguish API-confirmed creation from a reopened visual inspection. Never invent a draft URL from an unverified pattern. If a write times out, inspect the drafts before retrying. A rerun must not silently create a second copy; API saves deduplicate identical content per authorized account, and browser saves inspect existing drafts. Changed content creates a new API draft; updating an existing draft is not implemented.

Prepared temporary files contain private article text and absolute local paths. Remove only the generated files/folder after upload verification; preserve them when needed to resume a failed upload. Never include them in an open-source release.
