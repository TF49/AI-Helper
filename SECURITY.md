# Security Policy / 安全策略

## Supported versions / 支持的版本

Only the latest release of Bob AI Helper receives security fixes. Please update to the [latest release](https://github.com/TF49/AI-Helper/releases/latest) before reporting.

只有最新发布版会收到安全修复。报告前请先升级到[最新版本](https://github.com/TF49/AI-Helper/releases/latest)。

## Reporting a vulnerability / 报告漏洞

**Please do not open a public issue for security problems.** Report them privately through GitHub's form:
[Report a vulnerability](https://github.com/TF49/AI-Helper/security/advisories/new)

**请不要用公开 Issue 报告安全问题。** 请通过 GitHub 的私密表单提交：
[Report a vulnerability](https://github.com/TF49/AI-Helper/security/advisories/new)

Please include / 请尽量提供：

- affected version and OS (Windows / macOS, architecture) / 受影响的版本与系统
- steps to reproduce or a proof of concept / 复现步骤或 PoC
- impact as you understand it / 你判断的影响范围

We aim to acknowledge reports within 7 days and will credit reporters in the release notes unless asked not to.

我们会尽量在 7 天内确认收到，并在发布说明中致谢报告者（除非你希望匿名）。

## Scope / 范围

In scope / 范围内：

- the desktop app (`src/`, `src-tauri/`), including the local Cursor bridge (`127.0.0.1:8969`) and Accio Work bridge (`127.0.0.1:8787`)
- credential storage (DPAPI on Windows, Keychain on macOS) and the config files AI Helper writes
- the update chain (signed manifests, minisign signatures, SHA-256 checks, rollback protection)
- the website at `helper.bob-api.com` and the code in `website/`

Out of scope / 范围外：third-party AI clients themselves (Cursor, Claude Code, Codex CLI, etc.) and the Bob API service itself (report those to Bob API directly).

## Design notes and past reviews / 设计说明与历史审查

Security design notes and review records are kept in [`docs/security/`](./docs/security/), for example:

- [SEC-01 first secure update path](./docs/security/SEC-01-FIRST-SECURE-UPDATE.md)
- [SEC-05 Accio bridge instance authentication](./docs/security/SEC-05-ACCIO-COMPAT.md)
- [Security review 2026-10-22](./docs/security/SECURITY_REVIEW_2026-10-22.md)
