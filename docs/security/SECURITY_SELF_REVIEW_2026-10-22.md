# 2026-10-22 修复后独立复核记录

复核基线：`63016846`，代码修复提交：`c81c1315`。本记录描述该提交之后的客户端、事务恢复和工作流修复。此前问题及外部待办分别见 [上一轮修复记录](SECURITY_FIXES_2026-10-22.md) 和 [任务跟踪](TASK_TRACKER.md)。验证记录于 2026-10-23 补充。

本轮交叉审查发现了可复现的问题并修复，不能仅凭上一轮绿色 CI 认定交付完成。复核和复现使用合成凭据、隔离配置及本机 loopback 服务；未操作个人凭据库、生产签名密钥或线上发布资产。

## 发现与修复

| 事项 | 触发与影响 | 本轮处理及审核重点 |
| --- | --- | --- |
| Codex 未知请求头跨 origin 携带旧凭据 | 切换 custom provider 的目标时，已知认证头会清理，但未知静态头或环境变量请求头仍可能保留。真实官方 CLI 配合隔离配置和 loopback 服务，已复现合成旧值被新目标收到 | `http_headers`、`env_http_headers` 与查询参数共用 origin 绑定：协议、主机、有效端口相同才保留未知项；跨 origin 或旧 URL 无法确认时拒绝保存，保留原文件和备份。已知认证项仍清理，其他 provider/profile 和安全设置保留。检查正常同源路径调整和拒绝分支均有回归 |
| Codex 损坏 TOML 被读作空配置 | 非空但解析失败的文件原先返回空 Key，界面可能误判为尚未配置 | getter 链先验证 TOML，解析失败返回固定、脱敏错误，不读取旧环境凭据；空白文件仍可作为未配置处理。保存继续拒绝损坏文件，原文及已有备份不变 |
| WorkBuddy 未写入的合并源未被校验 | 某个源文件参与合并但自身无需替换时，不在写集内；外部程序轮换 Key 或删除模型后，事务可能继续传播旧快照 | 所有读取输入加入校验：暂存完成后、每次替换前、全部替换后且写入 Committed 前。未写入源按原始字节校验；检测冲突后保留文件和 journal，后续恢复后重新读取、合并 |
| WorkBuddy 恢复可能用旧备份复活被删除的源文件 | 未写入源在中断后整文件被外部删除，普通缺失文件恢复可能从旧 backup 重建凭据 | 新 journal 为 v2，`read_dependencies` 仅记录未写入源的路径，不记录用于回放的旧内容。恢复先检查源仍为可读普通文件；缺失、不可读或被链接替换时停止，保留现场，不先从 backup 复活源。v1 对可识别的未写入活动源补充保守检查；仅接受 v1/v2，未来版本拒绝操作 |
| Windows CI 子进程等待超时 | main CI 的两个 WorkBuddy 测试触发 15 秒等待上限，导致完整库失败 | helper 保留有限超时，Windows 120 秒、Unix 30 秒，并增加 PID、耗时等诊断。完整库改为 `-- --test-threads=1`，测试内部并发线程和子进程仍运行；CI 该步骤上限 15 分钟。本地完整检查入口同步串行执行 |
| 工作流测试契约可被零测试命令误判 | `cargo test … -- --list`、`--exact nonexistent` 或位置过滤原先可能被识别为完整库测试 | harness 参数改为白名单：只接受正整数线程参数及必要输出参数，拒绝列表、精确匹配、位置过滤、skip/ignored 等；新增危险 YAML 变异和合法选项反例 |
| 发布附带 Standalone 目录内容 | Windows 上传 `release/tag/*` 会递归带入 `standalone/`，后续汇总又将原始 EXE 和说明文件平铺为额外 Release 资产 | 上传收窄为顶层 Windows EXE、SIG、ZIP、JSON、SHA256SUMS，以及 macOS DMG、DMG.SIG。安装器、Standalone ZIP、平台签名仍齐全，最终多平台清单与校验和仍由汇总步骤重新生成 |

实现入口：[codex.rs](../../src-tauri/src/codex.rs)、[workbuddy.rs](../../src-tauri/src/workbuddy.rs)、[CI](../../.github/workflows/ci.yml)、[发布工作流](../../.github/workflows/release.yml)、[工作流回归](../../scripts/test-workflow-security.mjs)。

WorkBuddy 新增回归覆盖正常同步、未写入源的 Key 轮换和模型删除、各提交检查点、整文件删除且存在旧备份、Prepared/Committed 残留、v1 正常兼容与缺失源阻断、未来 journal 版本拒绝。恢复审核应同时确认：外部新内容保留、被删源不重建、冲突时 journal 不删除。

## 已取得的证据与待补验收

| 证据 | 本轮状态 |
| --- | --- |
| 真实 Codex CLI 跨 origin 请求头复现 | 已用合成 Key、隔离配置和本机 loopback 服务复现；不涉及真实上游或计费 |
| 工作流契约及发布预检 | 本地实际执行通过：164 项结构检查、28 个危险变异、40 个发布预检场景及 80 个隔离 HTTP 响应；这些 HTTP 响应为测试夹具 |
| main CI `39801184231` | [Windows job `119902074500`](https://github.com/TF49/AI-Helper/actions/runs/39801184231/job/119902074500) 完整库结果为 227 通过、2 失败、5 ignored，耗时 219.50 秒。失败为 `external_edits_during_staging_or_commit_preserve_every_file_and_journal` 等待检查点超时，以及 `independent_writers_keep_both_committed_updates` 等待子进程超时 |
| 超时根因 | 同提交此前分支 Windows 完整库 229 项通过、耗时 10.33 秒；main 运行中其他磁盘及 junction 测试也显著变慢。证据表明存在超时稳定性问题，尚不足以断言慢 I/O 是唯一根因或认定生产死锁 |
| 最新修复本机完整验证 | 主审已实际运行 `./scripts/verify-improvements.ps1` 全部通过：Windows 库 239 passed、5 ignored；DPAPI 单独 2 项；前端安全行为 60 项；上述工作流检查；Rust fmt、生产 check、全目标 Clippy（`-D warnings`）、TypeScript、renderer build 及 Windows 发布资产回归通过 |
| WorkBuddy 专项 | 最终定向回归 35 passed、1 个子进程 helper ignored；独立 v1/v2 journal 场景 5/5 通过。定向验证不替代完整库或 CI |
| 修复提交 CI | `c81c13156766f4368052436af319d90d85bdbbf1` 的 [CI `39809963053`](https://github.com/TF49/AI-Helper/actions/runs/39809963053) 最终 completed/success，六个 job 均 success。Windows 完整库 239 passed/5 ignored/0 filtered（27.41 秒），原生 DPAPI 2 项；macOS、Linux 完整库各 245 passed/5 ignored/0 filtered，实际 Keychain、Secret Service 及 SessionStore 各 2 项通过；macOS 真实双架构 DMG/临时签名/生产验签、前端 60 项、工作流 164/28/40/80、发布资产回归均通过。两个原先超时的 Windows 用例本次均通过 |
| main 验证规则 | 合入时再次检查 main 自身 CI，结果以 GitHub 对应 main 提交的运行记录为准；上述分支记录不能代替 main 的实际运行 |

上一轮分支 [CI `39799137128`](https://github.com/TF49/AI-Helper/actions/runs/39799137128) 绿色，不等于随后 main CI 绿色，也不能证明本轮新增修复已经通过。原生凭据服务、实际 DMG 挂载、更新签名和生产 Rust 验签的既有证据保留各自执行范围；最新结论必须绑定最新修复提交。

## 交付边界

- 本记录覆盖仓库客户端与工作流修复。Bob API 对象授权、会话撤销、group-only 契约、报价、并发额度硬限及幂等记账，继续按用户指定保留服务端 TODO，需服务端源码或隔离环境另行验收。
- 原生 Keychain/Secret Service 与真实 DMG、一次性更新密钥测试，不代表成品 Apple 签名、公证、系统授权、安装和旧版升级已验收；受支持 Accio 版本的真机协议兼容同样待验收。
- 已暴露旧 Webhook/Key 的生产轮换、撤销及验证属于运维待办；本地修复或删除不能替代服务端撤销。
- 普通文件系统不提供跨文件原子提交，也不能强制外部写者遵守锁。快照检查仍有检查与替换之间的竞争窗；本轮保证检测到的冲突停止操作并保留证据，不宣称消除所有外部并发竞争。
