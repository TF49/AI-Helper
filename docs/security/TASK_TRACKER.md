# 资金安全整改任务跟踪

基线：`docs/FINANCIAL_SECURITY_REMEDIATION_PLAN.md`。状态仅表示本仓库当前实现进度，不是最终结项放行证明（需服务端证据）。

> **本文档最后更新**：2026-10-20（含代码复核 `docs/security/SECURITY_REMEDIATION_REVIEW_2026-10-20.md` R01–R12 修复）

## 任务状态

| 任务 | 状态 | 本仓库变更 |
| --- | --- | --- |
| SEC-01 | 客户端已加固 / 待回归 | `update_trust.rs`：防重放状态损坏拦截、强制 `pub_date`、严格区分未更新与错误；**[复核修复 R01/R02/R03]** `verify_minisign()` 先 Base64 解码再解析；CI 注入签名私钥；`package-macos.sh` 改为检查 `.app.tar.gz.sig`；新增 `finalize-update-manifest.ps1` 汇总多平台清单后整体签署 |
| SEC-02 | 客户端已加固 | **[复核修复 R04]** `credential_policy.rs` 新增 `KeyStore` 区分 Managed/External/Unknown 三种来源；旧格式自动迁移；`validate_key_destination()` 统一凭据出口策略；Bridge LLM/embedding/image 发送前均调用目标校验；DNS 预检绑定实际连接消除 TOCTOU |
| SEC-03 | 客户端已加固 / 待服务端 | **[复核修复 R08/R09]** `auth.rs` 切组改为 `PATCH /api/token/{id}/group` group-only 接口；`TokenSelectModal.tsx` 费率加载中/缺失/过期（5 min）/非有限数值时禁止提交；待服务端实现 PATCH 端点 |
| SEC-04 | 客户端已加固 | Claude/Codex/Workbuddy 局部合并；**[复核修复 R05]** Codex `env_key` 总是写为 `CUSTOM_OPENAI_API_KEY`，保存后联合校验凭据引用与实际写入；**[复核修复 R06]** `safe_fs`：`create_new` 后设权限再写内容；Windows `icacls` 检查退出码；备份也做权限收紧；`with_file_lock` 防多写者；`recover_missing_file` 从备份恢复 |
| SEC-05 | 客户端已加固 / 待 Accio 实机 | 实例令牌先鉴权、监听失败不启动、不回退假端口 |
| SEC-06 | 客户端已加固 | 禁止跨供应商回退；生图成功响应才 settle，失败保留 pending |
| SEC-07 | 客户端已加固 / 待服务端硬限 | **[复核修复 R07]** `paid_request.rs`：`load_ledger` 损坏报错（不重置零）；`save_ledger` 返回 `Result`；`reserve_image_unit` 先落盘后才返回成功；跨进程文件锁（100 次重试）；默认预算上限改为 0（关闭）；**注**：当前为次数约束，非金额硬限 |
| SEC-08 | 客户端已加固 | 改组弹窗移除硬编码，动态对接权威费率；>= 2.0x 高倍率强制确认 |
| SEC-09 | 部分完成 / 文件权限已加固 | 文件 ACL 保护 (`safe_fs`)；**[待实现]** Windows DPAPI / macOS Keychain / Linux libsecret；refresh cookie / sid 仍明文 JSON |
| SEC-10 | 客户端已加固 | **[复核修复 R10/R11/R12]** `get_user_wallet` 响应前核验 epoch + user_id；前端 wallet 请求代次校验；`secureClipboard.ts` generation 计数器修复清理逻辑；`LoginModal` 2FA 分支清除 `preparedLoginPayload` 和 ref；`ai_helper_auth_changed` 事件补充实际发送者和 userId；`image_model` UI 配置补齐 |
| SEC-11 | 阻塞（服务端） | 服务端对象级权限、会话主动吊销、Token group-only 独立更新接口 |
| SEC-12 | 阻塞（服务端） | 服务端并发额度硬限、负向上游额度记账、支付/回调幂等 |
| SEC-13 | 客户端已加固 | HTTPS 取图、禁私网、DNS 绑定实际连接（无 TOCTOU）、10 MiB 限制、魔数校验 |
| SEC-14 | 客户端已加固 | 下载逐跳 RedirectPolicy 白名单校验、Windows Authenticode 核验、锁定规范化执行路径 |
| SEC-15 | 客户端已加固 / 运维待确认 | 编译期 Webhook 移除；CI Actions 固定 SHA；update-release 禁止 clobber |
| SEC-16 | 客户端已加固 | 关闭弹窗/账号切换即清明文 Key 缓存；Key 复制定时清理剪贴板（generation 修复） |
| SEC-17 | 客户端已通过 | **127/127 Rust 测试通过；0 TypeScript 错误；0 Clippy 警告**（2026-10-20 运行结果）；待服务端联调后执行多平台实机回归 |

## 验证记录（2026-10-20）

| 检查 | 命令 | 结果 |
|------|------|------|
| Rust 单元测试 | `cargo test` | ✅ 127/127 通过 |
| Rust 静态检查 | `cargo clippy -- -D warnings` | ✅ 0 警告 |
| TypeScript 类型 | `node_modules\.bin\tsc --noEmit` | ✅ 0 错误 |
| Rust 编译 | `cargo check` | ✅ Finished |

## 已知剩余缺口（客户端）

- **SEC-09 DPAPI**：refresh cookie / sid 仍明文 JSON，仅有文件 ACL 保护；计划后续迭代引入 `windows-credentials` / `security-framework`
- **预算性质说明**：当前为次数约束（默认关闭），非金额硬限；界面和文档应明确说明
- **汇率硬编码**：`auth.rs` 中 `1¥=4$` 待服务端提供权威汇率接口后移除
- **R08 服务端依赖**：`PATCH /api/token/{id}/group` 客户端已发出，服务端需实现该端点

