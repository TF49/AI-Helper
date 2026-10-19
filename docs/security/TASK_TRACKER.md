# 资金安全整改任务跟踪

基线：`docs/FINANCIAL_SECURITY_REMEDIATION_PLAN.md`。状态仅表示本仓库当前实现进度，不是最终结项放行证明（需服务端证据）。

| 任务 | 状态 | 本仓库变更 |
| --- | --- | --- |
| SEC-01 | 客户端已加固 / 待回归 | `update_trust.rs` 防重放状态损坏拦截、强制 `pub_date`、严格区分未更新与错误；安装前/执行前 Authenticode 签名核验与 Subject 白名单关键词过滤 (`TRUSTED_PUBLISHER_KEYWORDS`)；`sync-mirror.sh` 镜像签名清单 |
| SEC-02 | 客户端已加固 | `credential_policy.rs` 持久化受管 Key 摘要并改用 `safe_fs` 安全写入与告警；`claude.rs`、`accio/config.rs`、`workbuddy.rs`、`codex.rs`、`model_fetch.rs`、`api_test.rs` 统一限制受管 Key 官方目标 |
| SEC-03 | 客户端已加固 / 待服务端 | 切组移除列表重建降级；仅更新 group 字段；前端动态拉取权威倍率并要求高倍率显式确认；服务端 group-only 条件更新见 SEC-11 |
| SEC-04 | 客户端已加固 | Claude/Codex/Workbuddy 局部合并；Codex inline table 兼容与二次目标校验；Workbuddy 损坏配置停止覆盖；`safe_fs` .bak 原子替换与 Windows ACL 用户权限锁定 (`icacls`)；批量同步仅提交成功工具 |
| SEC-05 | 客户端已加固 / 待 Accio 实机 | 实例令牌先鉴权、监听失败不启动、不回退假端口；见 `SEC-05-ACCIO-COMPAT.md` |
| SEC-06 | 客户端已加固 | 禁止跨供应商回退；剔除 500 内部端点回退；生图 10 MiB 流式上限；取图失败保留原图 URL 元数据 |
| SEC-07 | 客户端已加固 / 待服务端硬限 | 空 `image_model` 禁用生图；本地整数生图预算与未决账本跨进程重启原子持久化 (`image_budget_ledger.json`)，持久化失败严格输出 `error` 日志拒斥静默吞异常；账户全局硬限见 SEC-12 |
| SEC-08 | 客户端已加固 | 改组弹窗移除硬编码，动态对接 `getPricingData()` / `getUserAvailableGroups()`；>= 2.0x 高倍率分组强制勾选知悉后方可提交 |
| SEC-09 | 客户端已加固 | 模型缓存指纹改为不含原文的 SHA-256 摘要；`safe_fs` 可靠原子写入与 Windows 文件 ACL 隔离保护 |
| SEC-10 | 客户端已加固 | 登出阻断自动刷新、重建 CookieJar；在途钱包响应绑定用户 ID 与会话代次 (`epoch`)；登录/刷新持久化错误向上传播；`LoginModal` 异常或进入 2FA 流程时即时清空密码明文与预存载荷 |
| SEC-11 | 阻塞（服务端） | 服务端对象级权限、会话主动吊销、Token group-only 独立更新接口证据；见 `SEC-11-12-SERVER-CONSTRAINTS.md` |
| SEC-12 | 阻塞（服务端） | 服务端并发额度硬限、负向上游额度记账、支付/回调幂等证据；见 `SEC-11-12-SERVER-CONSTRAINTS.md` |
| SEC-13 | 客户端已加固 | HTTPS 取图、禁私网、DNS 解析检查、10 MiB 流式上限、魔数校验 |
| SEC-14 | 客户端已加固 | 下载逐跳 RedirectPolicy 白名单校验、Windows Authenticode 权威数字签名有效性与 Subject 发布者白名单核验、固定终端/URI 操作 ID、锁定规范化执行路径 |
| SEC-15 | 客户端已加固 / 运维待确认 | 二进制彻底移除编译期 Webhook 环境变量注入 (`COMPILE_TIME_WEBHOOK_URL = None`)；飞书 Webhook 换用新 URL 并由 `.env` 隔离注入（待运维后台停用旧 hook）；`release.yml`、`update-release.yml`、`ci.yml` 全面将第三方 Actions 固定为 Commit SHA；update-release 禁止 clobber 覆盖已发布资产 |
| SEC-16 | 客户端已加固 | 弹窗关闭与账号变更即时清空前端明文 Key 缓存 (`revealedKeys`)；`LoginModal` 失败即清密码明文；Key 复制后定时清理剪贴板；Unicode 安全截断不 panic |
| SEC-17 | 客户端已通过 / 待整体验收 | 127 项 Rust 单元测试全部通过；`pnpm typecheck` 与 `build:renderer` 通过；待服务端完成联调后执行最终多平台实机回归 |
