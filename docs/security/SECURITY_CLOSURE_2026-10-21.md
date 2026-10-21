# 安全修复收尾记录

日期：2026-10-21。审查及修复基线：`491cc3fb`。本记录描述该提交之后的实现；之前报告中的测试结果和平台实现属于历史状态。

## 修复范围

| 问题 | 当前处理 |
| --- | --- |
| WorkBuddy 嵌套获取同一文件锁，保存/删除/读取迁移可能挂起 | 单一协调事务、稳定顺序的文件锁；事务内部只调用已持锁的文件原语 |
| WorkBuddy 多兼容位置只完成部分提交 | 预写并同步所有目标后提交；受保护的 Prepared/Committed 日志支持失败回滚及进程异常后的恢复；恢复未完成时禁止继续修改 |
| 恢复晚于合并或覆盖未知模型属性 | 恢复后再读取/合并；保留 wrapper、安全设置和未知模型字段；坏配置不当成空配置 |
| Unix 自制加密与同目录磁盘主密钥 | 删除自制方案；macOS 使用用户 Keychain，Linux 使用 Secret Service，JSON 仅保存随机引用；Windows 使用用户范围 DPAPI |
| 凭据用途混用与格式降级 | v2 封包绑定用途及引用；未知版本拒绝；Windows 旧 DPAPI 可迁移，旧 Unix 自制密文要求重新登录 |
| 迁移尚未成功就启用 Cookie | 新保护存储暂存、读取验证、正式提交并再验证后才激活；失败持久阻止自动恢复，界面报告重新登录原因 |
| 退出标记被刷新或迟到的登录清除 | session 与 marker 共用跨进程锁；普通保存不能清除 marker；显式登录提交比较请求发出前的磁盘 revision；marker 每次退出均产生新 revision |
| 登录/刷新返回的 Cookie 污染当前账号 | 使用请求专用 CookieJar，提交前核对账号、代次和磁盘状态；退出先清本地状态，再执行远端撤销 |
| Codex 新 Key 与旧网关在不同存储位置短暂错配 | URL 与 CLI 支持的 bearer 配置写入同一个私有 TOML 并原子替换；不再写入新全局环境变量或向启动进程额外注入 Key |
| 官方透明转发可发送业务认证到任意自定义地址 | 保存及两条实际发送路径均验证已知 HTTPS 官方 origin；防泄露开关在发送前生效 |
| 钱包/日志硬编码货币换算 | 无已确认平台换算契约时显示原始平台额度及“换算不可用”，不把未知价格、余额或汇率当作确定金额 |
| CI 未覆盖 macOS/Linux 原生凭据代码 | 后端检查扩展到 Windows/macOS/Linux；显式生产代码检查、全目标 Clippy、隔离库测试；测试不默认连接个人凭据库 |

Codex 的直接 bearer 配置方式已核对 [OpenAI 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。该接口受到 CLI 支持，但官方通常建议使用环境变量；本项目选择私有配置内的单次原子提交，以绑定网关和凭据。第三方 CLI 需要读取的配置仍是受限权限明文，不能宣称这些配置由系统凭据库加密。

## 凭据存储清单

| 位置 | 内容、读取者与生命周期 |
| --- | --- |
| `~/.ai-helper/auth_session.json` | 用户资料、会话代次、DPAPI 密文或系统凭据随机引用；仅 AI-Helper 读取；退出清理并留下阻断旧恢复的标记 |
| macOS Keychain / Linux Secret Service | 按用途隔离的 session sid、refresh cookie；应用提交新引用后清理旧引用；服务不可用时不回退磁盘密钥或明文 |
| `auth_session.json.pending` / 旧 `.bak` | 新保护内容暂存验证；成功后删除暂存及旧备份；清理失败阻止激活；失败迁移保留旧副本且禁止自动使用 |
| Claude / Codex / WorkBuddy 配置与 `.bak` | 第三方 CLI 必需的可读配置；创建即限制权限，安全替换和备份；只改本应用管理的字段，不删除用户其他配置 |
| WorkBuddy 事务日志 | 恢复所需的前后配置快照，可能含 CLI Key；创建即私有；成功提交/回滚恢复后删除；故障保留用于恢复 |
| Accio 配置与模型缓存 | 自定义 API Key 仅用于目标网关；模型缓存来源为不可逆摘要，禁止缓存指纹内拼接原始 Key |
| 旧 Codex 全局环境项 | 仅为读取旧配置兼容而保留，不新增或更新；不自动删除其他启动方式依赖的旧项；用户可在完成迁移并确认旧终端停用后自行清理/轮换 |

删除本地引用不等同服务端撤销，不承诺清除操作系统、SSD、备份或剪贴板历史。旧 Unix 自制凭据无法安全自动迁移，升级后应显式重新登录。

## Actions 问题定位

上轮 `002e312c` 的 [CI 失败记录](https://github.com/TF49/AI-Helper/actions/runs/39551138541)中，三个 Windows ACL 测试把内置管理员 SID 的 SDDL 别名 `LA` 错判成其他用户。`519adaef` 已修正断言，同时仍要求当前进程 SID 的唯一完整访问 ACE；`491cc3fb` 的 [基线 CI 已成功](https://github.com/TF49/AI-Helper/actions/runs/39559046204)。这不代表本轮新增代码已经通过远端检查。

平台凭据单元测试使用隔离内存后端，不能替代原生 Keychain/Secret Service 联调。Windows 原生 DPAPI 回归以显式命令运行，使用合成值，不读取个人会话或注册表；CI 的 Windows job 也显式运行这两项。

## 验证记录

本机环境为 Windows x64 / Rust 1.99.1 / Node 22.16.0；远端 CI 保持仓库 Rust 1.95 工具链。

| 检查 | 结果 |
| --- | --- |
| Windows 完整 Rust 库 | 214 通过、0 失败；5 个 ignored 中 3 个是父测试调用的子进程 helper，另 2 个原生 DPAPI 用例已单独显式通过 |
| Rust 格式 / 全目标 Clippy | 通过，Clippy 使用 `--locked --offline --all-targets -- -D warnings` |
| 前端行为回归 | 60 项通过，含原始额度显示、未知金额、刷新失败和日志失败回归 |
| TypeScript / Vite 生产构建 | 通过；构建仍有既有体积和浏览器数据提示 |
| Windows 原生 DPAPI | 2 项通过，含用途隔离、篡改拒绝、旧 DPAPI 迁移及并发 |
| Unix 实际文件/WorkBuddy 源码隔离回归 | 29 通过、0 失败；2 个 helper 由父测试调用 |
| 发布资产回归 | 通过，覆盖 DMG-only、应用元数据、版本/架构/tag、签名失败及最终哈希 |
| 工作流静态检查 | YAML、平台矩阵、固定 action SHA、PowerShell AST 与 Linux shell 命令检查通过 |
| 新远端三平台 CI | 见 [PR #22 的实时检查结果](https://github.com/TF49/AI-Helper/pull/22/checks)，以对应提交的各 job 结论为准 |

本轮代码已推送到 `codex/security-closure-20261021` 并创建草稿 PR #22；未合并 main 或发布版本。Unix 结果来自 WSL 独立源码测试，不是完整 Linux Tauri 构建。发布回归使用模拟工具和资产，不等同 macOS 实机安装。

## 外部验收依赖

- 当前 `server` 目录是遥测服务，无法在这里实现或验证 Bob API 的对象级授权、会话主动撤销、group-only PATCH 契约、全账户额度硬限和幂等记账；需要其服务端源码及隔离测试环境。
- 生图本地预算是次数限制，默认关闭，不能替代服务端金额硬限；没有价格契约时不声明可计算可信金额上界。
- macOS 两架构成品的签名、公证、旧版升级安装和 Accio 实际客户端协议兼容，仍须在对应平台验收；模拟打包回归不等同实机成功。
- 已暴露的运维 Webhook/历史 Key 的服务端轮换与撤销，需要相应系统的执行及验证记录。

用户已明确外部服务端事项保留 TODO，由开发同事处理；具体交接项目见 [任务跟踪](TASK_TRACKER.md#服务端交接-todo)。这些依赖不能通过修改客户端文档标记为完成。
