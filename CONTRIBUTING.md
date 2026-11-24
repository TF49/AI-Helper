# Contributing to Bob AI Helper / 贡献指南

Thanks for helping improve Bob AI Helper. Bug reports, client-compatibility reports, docs fixes and pull requests are all welcome.

感谢你参与改进 Bob AI Helper。欢迎提交 Bug、客户端兼容性反馈、文档修正和 Pull Request。

- Questions and bugs / 提问与 Bug：[GitHub Issues](https://github.com/TF49/AI-Helper/issues)（请使用对应的 Issue 模板）
- Security problems / 安全问题：see [SECURITY.md](./SECURITY.md) — do not open a public issue / 不要公开提交
- Code of conduct / 行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## Requirements / 环境要求

- Node.js 18+
- pnpm 9+ (the repo pins pnpm 10 via `packageManager`)
- Rust stable toolchain (see `rust-toolchain.toml`)
- Windows: Visual Studio C++ Build Tools and WebView2
- macOS: Xcode Command Line Tools

## Run locally / 本地运行

```bash
git clone https://github.com/TF49/AI-Helper.git
cd AI-Helper
pnpm install
pnpm dev            # desktop app (Tauri) / 桌面端
pnpm dev:renderer   # front end only, in the browser / 仅前端
```

Website preview / 官网预览：

```bash
pnpm serve:web      # http://localhost:3000
```

## Checks before a pull request / 提交 PR 前的检查

```bash
pnpm typecheck
pnpm test:security
pnpm test:workflows
pnpm lint:rs
cargo test --manifest-path src-tauri/Cargo.toml
```

## Building / 构建

```bash
pnpm build
```

Release builds must go through the Tauri CLI. Do not ship a bare `cargo build --release` binary — it does not build and embed the production front end.

正式桌面产物必须通过 Tauri CLI 构建。不要把裸 `cargo build --release` 的可执行文件当作发布包，它不会构建和嵌入前端生产资源。

## Project layout / 目录结构

| Path | Contents |
| --- | --- |
| `src/` | React + TypeScript UI |
| `src-tauri/` | Rust core: client config writers, Cursor / Accio Work bridges, updater, credential storage |
| `website/` | Static site, guides, `llms.txt` |
| `scripts/` | Build, release and version-sync scripts |
| `docs/` | Release notes, security reviews, deployment notes |

## Pull request guidelines / PR 约定

- Keep changes focused; one topic per PR. / 每个 PR 只做一件事。
- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages, e.g. `fix(cursor): ...`, `feat(website): ...`.
- When a client writer changes, preserve fields AI Helper does not own — existing user settings must survive byte-for-byte where possible. / 修改客户端配置写入逻辑时，必须保留非 AI Helper 管理的字段。
- Don't commit build output (`output/`, `release/`, installers) or signing keys. / 不要提交构建产物、安装包或签名密钥。
- Website version strings and dates are managed by `pnpm sync:web`; don't hand-edit them. / 官网版本号与日期由 `pnpm sync:web` 管理，不要手动修改。

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE).

提交贡献即表示你同意以 [MIT 许可证](./LICENSE) 授权你的贡献。
