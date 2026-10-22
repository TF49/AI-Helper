# 最新 main 安全复核

> 此为 `5522758f` 的历史审查快照。用户随后授权修复；处理及验证见 [本轮修复记录](SECURITY_FIXES_2026-10-22.md)，当前待办见 [任务跟踪](TASK_TRACKER.md)。

日期：2026-10-22。已快进拉取 main 至 `5522758f7eeef515b7f10ef887ffd746b0ff050b`，对照上一轮 `45ca137b` 审查同事的新改动，同时验证配置恢复链路的剩余问题。

**结论：仍不能认定安全闭环。即使按用户约定将外部 Bob API 服务端事项保留 TODO，本轮客户端和发布流程仍有必须修复的回归；另复现一项上一轮遗留的 WorkBuddy 恢复覆盖问题。最新 CI 成功与这些确定问题同时存在。**

本次只增加审查记录，未修改业务代码、执行真实登录或计费、操作个人凭据库或发布资产。P1 表示应在本轮安全交付前解决；P2 表示正确性或验收加固问题，不是 CVSS 评级。

## 必须修复

### C01 · P1 · 上一版 Codex 文件密钥没有迁移，读取变为空或陈旧全局 Key

位置：[codex.rs:137](../../src-tauri/src/codex.rs)、[188–191](../../src-tauri/src/codex.rs)。

上一轮正常生成的 custom provider 使用 `experimental_bearer_token`，没有 `env_key`。当前 `needs_legacy_environment` 将缺少 env_key 解释为读取 `CUSTOM_OPENAI_API_KEY`，解析函数也完全忽略文件里的 bearer。

用抽取自新旧源码的真实解析函数和合成配置验证：

| 现有文件 | 合成全局值 | 45ca137b 读取结果 | 当前读取结果 |
| --- | --- | --- | --- |
| bearer=`fake-file-key`，无 env_key | 不存在 | `fake-file-key` | 空字符串 |
| 同上 | `fake-stale-global` | `fake-file-key` | `fake-stale-global` |
| bearer 显式为空，无 env_key | `fake-stale-global` | 空字符串 | `fake-stale-global` |

URL 始终保留原文件节点。编辑时又会删除旧 bearer，而没有完成它的迁移。因此升级后当前凭据丢失或另一把全局 Key 被错误关联到原节点。不能把“缺 env_key”直接等同旧环境方案。

建议：识别上一版真实存储格式，先读取和验证当前凭据及目标，迁移成功前保留唯一有效副本；显式空凭据不能回退陈旧全局 Key。

### C02 · P1 · URL 与 Key 再次拆开发布，文件锁和回滚无法保护外部 CLI

位置：[codex.rs:648–649](../../src-tauri/src/codex.rs)，Windows 写入和广播在 [710–722](../../src-tauri/src/codex.rs)。

当前先修改并广播全局环境 Key，再提交配置文件的新 URL。外部 Codex/终端不参与 AI-Helper 文件锁，能够在中间状态取得“新 Key＋旧 URL”；即使最终回滚，也不能撤回已经被外部进程读取或发送的 Key。

另一个正常使用触发不依赖短暂竞争：已打开的终端仍持有旧 Key 环境快照；AI-Helper 保存新节点后，它启动 Codex 读取新 URL，却继续使用旧 Key。进程内写后验证不能覆盖这些外部读取者。

建议：恢复目标与凭据的成对发布设计，或使用真正与节点绑定、经过独立终端兼容验证的凭据引用方案；不能宣称当前两处存储是原子同步。此项按调用顺序和外部环境生命周期确认，未使用真实 Key 做网络演示。

### C03 · P1 · 发布打包步骤丢失签名密钥环境，更新清单无法签署

位置：[release.yml:43–53](../../.github/workflows/release.yml)、[update-release.yml:55–66](../../.github/workflows/update-release.yml)、[package-release.ps1:89](../../scripts/package-release.ps1)。

两个 workflow 都只在 Build installer 步骤设置签名环境，随后 Package release 没有这些 env。打包脚本还必须调用 `sign-update-file.ps1` 签署 latest.json，前一步生成安装包签名不能替代清单签名。

在子进程中移除四个 Tauri 签名环境项，用仓库锁定的真实 CLI 对合成 JSON 执行 signer，结果为退出码 1、`Unable to find the private key`，没有签名文件。没有读取生产私钥。当前绿色普通 CI 未运行该真实发布路径；模拟 signer 的打包回归也不能发现 workflow 的密钥作用域错误。

建议：给每一个实际执行签名的步骤正确注入密钥，维持缺签名拒绝发布，并增加针对实际 workflow 调用环境的验证。

### C04 · P1 · 恢复删除和覆盖既有发布资产，并移除 macOS 产物汇总

位置：[update-release.yml:86–107](../../.github/workflows/update-release.yml)、[release.yml](../../.github/workflows/release.yml)、[package-release.ps1:75–82](../../scripts/package-release.ps1)。

存在同版本 Release 时，更新流程先删除全部旧资产，再使用 `--clobber` 上传。源码不是只有一条失败恢复路径，而是恢复了已经取消的“同 tag 替换发行物”行为；删除后上传失败会留下不完整发布，历史链接内容也不再稳定。

同时，两个发布 workflow 都已取消 macOS 两架构构建和 `finalize-update-manifest.ps1` 汇总，直接发布的 package-release 清单只含 `windows-x86_64`。一旦解决 C03 并运行发布，既有 macOS 资产可能被删除，新版清单又缺 Darwin 条目，macOS 安全更新链路被阻断。

建议：恢复发行物不可覆盖策略和三平台产物汇总，在全部预期资产及最终签名、哈希验证成功后发布新版本。没有执行任何线上删除或发布。

### C05 · P1 · WorkBuddy 崩溃恢复静默覆盖第三方后续配置（上一轮遗留）

位置：[workbuddy.rs:365–372](../../src-tauri/src/workbuddy.rs)、[393–396](../../src-tauri/src/workbuddy.rs)。此问题在基线中已经存在，不归因于本轮新增代码。

恢复逻辑只检查当前内容是否等于准备恢复的快照；只要不同，就用 before/after 覆盖，没有检测第三方在事务之后的新版本。外部 WorkBuddy 或编辑器不参与本应用的锁。

使用当前 HEAD 编译出的真实测试子进程和隔离配置，分别在 Prepared、Committed 两阶段暂停并终止，随后第三方改写两个 models.json，再调用真实读取触发恢复：

| 日志阶段 | 第三方新增字段保留 | 第三方 permissions.deny 保留 | 恢复结果 |
| --- | --- | --- | --- |
| Prepared | 两文件均否 | 两文件均回旧值 | 读取成功，日志删除 |
| Committed | 两文件均否 | 两文件均回旧值 | 读取成功，日志删除 |

这超出“多个文件不能瞬时一起可见”的边界，是后续用户修改实际丢失。建议按记录的版本或内容摘要检测冲突；遇到非本事务版本时保留数据和恢复记录，不能静默重放覆盖。

## 其他确定问题与验收缺口

| 事项 | 位置与影响 |
| --- | --- |
| P2：macOS/Linux Codex 保存未持久化 | `codex.rs:727–732` 仅设置 AI-Helper 进程环境，退出后不保留 Key；macOS 内置启动 `process_manager.rs:299–319` 通过 Terminal 执行脚本，没有传递该 Key。升级后“保存成功”不能证明实际 CLI 可用，需要修复并验证两种启动路径 |
| P2：CI 回归覆盖缩减 | `ci.yml` 移除前端 `test:security`、发布资产回归和显式 Windows DPAPI 测试；Unix 只运行 `unix_filesystem_tests` 六个用例，其他库测试只编译不执行。默认单元测试使用隔离内存后端，无需为避开真实凭据库而删除完整 Unix 测试 |
| P2：供应链固定 SHA 回退 | 多个 workflow 的 checkout、setup-node、cache、Rust 等 action 改回可变 tag；任务表仍声称固定 SHA，应恢复与修订声明 |
| P2：默认测试会修改真实 Windows 凭据环境 | `codex.rs:1214–1244` 的 actual_set 测试只隔离文件路径，仍写真实 HKCU Environment 并广播；断言失败/进程终止就不能恢复。正常恢复还吞掉失败。本次本地回归显式跳过这一项 |
| P2：Linux 原生验收测试属性错误 | `secret_storage.rs:891、903` 使用 `secret-tool ... account`，锁定 keyring 3.6.3 实际写入 `username` 属性，正常服务也会在 894 失败。已核对 crate SHA256 和原始源码，未连接个人 Secret Service |
| P2：原生测试条目隔离不足 | `secret_storage.rs:828–831、878–881` 用 PID 固定引用、写入前先删除同生产 service 既有条目，清理 guard 也在成功创建前建立。应使用随机新引用，确认归属后仅清理本次创建项 |
| P2：Windows 损坏目录链接自愈失败 | `workbuddy.rs:413` 用 remove_file 删除目录 junction/symlink，Windows 返回 OS 5；当前 HEAD 真实保存调用亦失败。新增用例只覆盖 Unix，此项是功能缺口，未发现凭据泄漏 |

现有封包用途/引用校验、系统后端显式选择、auth 提交契约、普通配置合并保留未知字段、锁顺序与不重入、活动 profile 拒绝、已知凭据头清理及跨 origin query 拒绝，未在本次复核发现额外确定问题。

## 实际验证及证据边界

| 检查 | 本次结果 |
| --- | --- |
| 拉取及工作分支 | main 已到 `5522758f` |
| 最新远端 CI | [39753842738 成功](https://github.com/TF49/AI-Helper/actions/runs/39753842738)，已核对实际 job/step，覆盖范围如上 |
| Windows 库测试 | 219 通过、0 失败、5 ignored、1 filtered；filtered 为上述真实注册表测试 |
| 原生 DPAPI | 显式运行 2 项通过，全部合成值 |
| 前端安全行为回归 | 60/60 通过 |
| Rust 格式与全目标 Clippy | 通过，`--locked --offline --all-targets -- -D warnings` |
| TypeScript / Vite | 通过；保留既有浏览器数据和体积提示 |
| 发布资产脚本回归 | 通过，使用模拟工具和资产；C03 真实 signer 缺密钥另行验证 |
| Codex 新旧真实解析/编辑函数 | 合成值对照复现 C01，同时确认 profile/header/query 保留策略 |
| WorkBuddy 当前 HEAD 子进程 | 复现 C05 两阶段覆盖及 Windows 坏目录 junction 保存失败 |
| macOS/Linux 原生凭据实机 | 本次未运行，不宣称通过 |

本次主要本地命令：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib -- --skip actual_set_codex_config_writes_env_key_and_updates_environment
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib secret_storage::native_windows_tests -- --ignored
node scripts/test-frontend-security.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
./scripts/test-release-artifacts.ps1
```

合成探针位于 gitignored `.tooling/codex-review-oct22/RESULTS.md`、`.tooling/transaction-review-oct22-RESULTS.md`、`.tooling/review_signer_oct22.py`，用于本机复核，不是已提交的项目回归测试。

## 闭环条件

先修复 C01–C05，并验证 Codex 实际启动及迁移、跨进程节点切换、WorkBuddy 外部修改冲突和真实发布环境；再恢复完整 CI 回归、纠正原生验收用例，更新文档为实际证据。新增测试函数或绿色编译不能替代这些调用路径的验收。

按用户此前约定，Bob API 对象授权、会话主动撤销、group-only 契约、权威价格单位、账户额度硬限与幂等记账继续交开发同事保留 TODO。macOS 成品签名/公证/升级、Accio 实际兼容及运维旧凭据撤销仍需独立证据。这些外部依赖与本报告客户端阻断项分别记录，不能用于掩盖已复现的客户端回归。
