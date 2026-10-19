# 首个安全版本升级路径（SEC-01）

本文件说明旧客户端如何进入带强制验签的第一版，以及该版本之后如何继续更新。自动更新链本身不能给旧客户端补上它缺少的验签能力。

## 信任根

- 客户端内置 Tauri updater 公钥（`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`，与 `update_trust::TAURI_UPDATER_PUBKEY_B64` 一致）。
- 镜像只负责传输。清单必须带 `latest.json.sig`，安装包必须带 minisign 签名；SHA-256 只做完整性辅助。
- 不得把镜像提供的新公钥当作信任根。

## 旧版 → 首个修复版

旧客户端可能仍会根据未签名的 `package.json` / 镜像 `latest.json` 下载安装包。不能依赖这条链传播首个安全版本。

1. 从官方渠道取得安装包：
   - GitHub Releases：`https://github.com/TF49/AI-Helper/releases`
   - 本站：`https://helper.bob-api.com/downloads/`
2. 独立核验：
   - Windows：核对发布者/Authenticode（若已配置）以及附带的 `.sig` 与内置公钥。
   - 使用发布页 `SHA256SUMS.txt` 核对文件哈希。
3. 手动安装首个修复版，不要执行来路不明的临时目录旧包。

## 首个修复版 → 后续版

修复版只接受：

- 签名清单（产品 `ai-helper`、渠道 `stable`、当前平台条目）
- 安装包字节的 minisign 验签
- 发布序号/最小安全版本防重放，拒绝错平台、过期元数据和同版本不同内容

官方已验证“无更新”后，未认证镜像的更高版本声明不会触发安装。

## 验证记录

发布首个修复版时，在 `docs/security/` 保存：

- 版本号、`release_seq`、平台、安装包 SHA-256
- `latest.json` / `latest.json.sig` 是否同时发布
- 旧版手动安装与修复版自动更新各一次的结果
