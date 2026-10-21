# 安全整改任务跟踪

更新日期：2026-10-21。基线：`docs/FINANCIAL_SECURITY_REMEDIATION_PLAN.md`。当前结论与验证见 [`../安全审计修改结论.md`](../安全审计修改结论.md)。历史复核发现保留在相应日期报告中。

**第二轮 S01–S10 的客户端修复及本机回归已完成；完整安全结项仍有客户端存储、服务端及实机验证依赖。**

| 任务 | 当前状态 | 实现及剩余内容 |
| --- | --- | --- |
| SEC-01 更新信任 | 实现已修 / 实机待验证 | 签名解码、真实 signer fixture、缺失/篡改拒绝、防重放；显式签署 DMG 并统一平台产物；首版升级、macOS 真实安装待证据 |
| SEC-02 凭据出口 | 本轮修复通过 | Managed/External/Unknown；显式目标确认 UI；External 精确 origin；Managed 不能降级；跨进程刷新及事务；旧配置需确认，坏库明确阻断 |
| SEC-03 分组修改 | 客户端已修 / 服务端待验证 | group-only PATCH，无完整 GET→PUT 回退；需真实服务契约、对象授权及并发证据 |
| SEC-04 配置保留 | 本轮修复通过 | Claude/Codex/WorkBuddy 同锁恢复/读取/合并；创建即私有、OS 锁、私有备份；WorkBuddy 双路径同锁读写 |
| SEC-05 Bridge 鉴权 | 实现已加固 / Accio 实机待验证 | 实例凭据、读取 body 前鉴权、失败不回退假端口；真实版本支持矩阵待验证 |
| SEC-06 付费请求 | 实现已加固 / 上游契约待验证 | 禁跨供应商自动补单；计费未知保留 pending；生成与取图分离 |
| SEC-07 预算 | 次数限制回归通过 / 金额和账户硬限未完成 | 落盘后放行、异常不清零、OS 事务锁；两进程争最后额度、重启及坏账本回归；预算异常不拖垮文本 Bridge |
| SEC-08 费率 | 两入口行为回归通过 / 权威换算待完成 | 共用 5 分钟正数有限费率和高倍率确认；刷新失败失效；既有汇率硬编码仍待契约 |
| SEC-09 凭据存储 | 本轮修复通过 | Windows DPAPI / Unix HMAC-SHA256 AEAD 平台加密已落位；旧版明文 session.json 自动识别与加密迁移已验证；私有 ACL、原子替换、防篡改校验通过 |
| SEC-10 退出和账号隔离 | 本轮行为回归通过 / 服务端撤销待验证 | 认证/钱包及前端窗口按会话和请求代次失效；旧错误和 finally 不写新账号 |
| SEC-11 服务端认证授权 | 阻塞（外部服务端） | 对象授权、会话撤销、group-only 接口需实现及证据 |
| SEC-12 服务端额度记账 | 阻塞（外部服务端） | 并发硬限、幂等结算/回调和全账户约束需实现及证据 |
| SEC-13 图片下载 | 实现已加固 / 实际环境待验证 | HTTPS、禁私网、DNS 绑定实际连接、限流式大小、图片类型检查 |
| SEC-14 安装与 IPC | 实现已加固 / 成品待验证 | 下载逐跳目标校验、Authenticode、下载记录和固定操作 ID |
| SEC-15 发布与秘密 | 本轮发布回归通过 / 运维待验证 | Actions 固定 SHA，发布物不覆盖，签名环境兼容，三平台强制产物，最终 SHA256SUMS；旧 Webhook 撤销待运维证据 |
| SEC-16 敏感状态 | 本轮行为回归通过 | 关闭/换账号使秘密请求失效，复制不缓存明文，剪贴板清理；不承诺擦除系统历史副本 |
| SEC-17 验收 | 本机检查通过 / 完整验收未完成 | Windows Rust 160 通过、2 个子进程 helper ignored；Unix 文件模块独立 7 项通过；前端 55 项通过；格式、Clippy、类型、构建、发布回归通过；macOS/服务端实机验收仍待执行 |

## 新增回归入口

```powershell
pnpm typecheck
pnpm test:security
pnpm build:renderer
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
./scripts/test-release-artifacts.ps1
```

本机 Rust 检查使用 Windows x64 / Rust 1.99.1，前端使用 Node 22.16.0 / pnpm 10.12.3。前端与发布回归已加入 CI。离线缓存就绪时本机 Cargo 使用 `--offline`；不要求首次安装离线执行。

前端脚本使用真实源码转译及模拟 hooks/IPC，不是浏览器或完整 React DOM 验证；发布脚本使用假资产，真实 signer 产物另由 Rust 公开 fixtures 验证。真实凭据、生产付费及个人 HOME 未用于回归。

最新独立复核的反例与修正见 [本轮代码自检](SECURITY_SELF_REVIEW_2026-10-21.md)。其中 Unix 同步失败的提交状态、默认改错 Key、真实 Hook 跨会话请求及旧授权 offer 均已纳入回归；DMG 现在验证实际应用元数据并不再依赖无关 tar 产物。

## 独立复核与剩余验收记录（2026-10-21 接手复核）

接手对基线 `5eb886f6` 到当前工作区（commits `002e312c`、`519adaef`）的独立复核与行为验证结论：

1. **已验证核心行为（含新增独立验证反例与多进程执行）：**
   - **Windows 私有 ACL**：通过 `safe_fs::platform::tests::replacement_and_backup_remove_old_explicit_everyone_access` 及文件替换行为测试，验证原文件存在 `Everyone` 权限时，替换后正式文件与备份文件均彻底剥离 `Everyone`，仅保留当前进程 SID，创建即私有。
   - **OS 崩溃锁自动释放**：通过独立隔离子进程（PID 37956 持锁，PID 39512 等待），强制终止持锁进程，等待进程立即解除阻塞并安全获取锁；锁文件安全保留在磁盘上以供后续写者复用，无死锁或句柄悬挂。
   - **预算并发原子预留**：两独立进程针对 `cap=1` 的账本同时争抢预留，严格保证 1 进程成功（退出码 0）、1 进程因额度耗尽被阻断（退出码 23），未发生超额预留，落盘状态持久化为 `pending=1`。
   - **凭据出口策略与降级防护**：受管 Key 拒绝发往未授权目标；试图确认受管 Key 为外部节点被拒绝；自带 Key 仅允许绑定精确 origin；旧快照不会覆盖 Managed 分类；坏来源库阻断修改。
   - **生图配置与 Bridge 弹性**：显式清空 `image_model` 成功关闭生图；预算账本异常或损坏仅关闭生图功能，文本与嵌入服务正常启动不受影响。
   - **改组费率统一与当前 Key 优先匹配**：两个改组入口统一使用 `getGroupSwitchError` 校验 5 分钟有效期、正数有限值和高倍率确认；改组弹窗优先校验当前工具真实 Key，无匹配时不默认使用无关 Key，强制要求明确选择。
   - **账号切换与生命周期隔离**：Token 弹窗、钱包、认证 Hook 及绑定 Hook 均校验会话代次与请求序号；A 换 B 或同一账号重登后，在途的旧请求（揭示、复制、列表、费率、钱包）成功/错误/finally 均被丢弃，旧授权按钮无法确认新输入。
   - **Unix 提交状态与 Codex 回滚**：区分未提交与已提交未确认状态，主文件提交后发生持久化错误不再错误回滚 Key；Codex 环境变量写入与回读一致性核验通过。
   - **macOS DMG 产物与发布哈希**：精确定位版本与架构 DMG，挂载校验 Info.plist 版本/标识与 Mach-O 实际架构；最终签名后重新扫描并生成全资产 `SHA256SUMS.txt`；发布 tag 与触发 tag 严格校验一致。
   - **OS 级敏感凭据存储与旧会话迁移（SEC-09）**：实现 Windows Win32 DPAPI (`CryptProtectData` / `CryptUnprotectData`) 与 Unix HMAC-SHA256 CTR + Authenticated Tag 的凭据加解密封包；`auth_session.json` 落盘前强制加密 `refresh_cookie` 与 `session_sid`；加载时自动识别旧版明文并在内存中解密，随后以加密封包原子回写完成旧会话平滑迁移，磁盘不再保留明文字符串；篡改或错用户凭据拒绝加载。
   - **WorkBuddy 跨位置事务锁收敛（SEC-04）**：在 `safe_fs::with_file_lock` 同一事务锁内完成多位置模型的读取、合并/删除、主路径写入及候选路径双向同步，避免并发读写造成状态覆盖。

2. **验证命令重跑结果：**
   - `pnpm typecheck`：通过（0 errors）。
   - `pnpm test:security`：55/55 通过。
   - `pnpm build:renderer`：构建成功。
   - `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：通过。
   - `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`：通过（0 warnings）。
   - `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`：160 passed，0 failed，2 ignored（子进程辅助入口按设计由父测试调用）。
   - `./scripts/test-release-artifacts.ps1`：通过（DMG-only、元数据校验、三平台清单、最终哈希重算全部通过）。

3. **剩余未决项（完整验收前禁止标记为“全部安全闭环”）：**
   - **macOS 两架构实机验收**：目前发布回归使用 mock 工具链，仍需在真实 macOS aarch64 / x86_64 物理机上完成真实构建、挂载、应用签名、公证、安装及从旧版升级验收。
   - **外部服务端契约与记账证据（SEC-11 / SEC-12）**：外部服务端真实的 group-only PATCH 接口支持、对象级权限校验、会话主动撤销、并发额度硬限拦截与结算幂等性证据仍待联调与提供。
   - **生图预算权威契约与换算硬编码**：本地生图预算仅作为客户端次数限制，权威价格模型、额度契约及现存汇率硬编码的动态契约仍待完成。
   - **Codex 环境变量跨位置事务边界**：Codex 注册表/环境变量与本地配置文件的跨位置提交受操作系统原语限制，无法提供硬件级单事务，需在后续上游协议支持纯配置时彻底演进。
