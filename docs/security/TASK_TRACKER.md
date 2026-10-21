# 安全整改任务跟踪

更新日期：2026-10-21。基线：`docs/FINANCIAL_SECURITY_REMEDIATION_PLAN.md`。当前结论与验证见 [`../安全审计修改结论.md`](../安全审计修改结论.md)。历史复核发现保留在相应日期报告中。

**第二轮 S01–S10 的客户端修复及本机回归已完成；完整安全结项仍有客户端存储、服务端及实机验证依赖。**

| 任务 | 当前状态 | 实现及剩余内容 |
| --- | --- | --- |
| SEC-01 更新信任 | 实现已修 / 实机待验证 | 签名解码、真实 signer fixture、缺失/篡改拒绝、防重放；显式签署 DMG 并统一平台产物；首版升级、macOS 真实安装待证据 |
| SEC-02 凭据出口 | 本轮修复通过 | Managed/External/Unknown；显式目标确认 UI；External 精确 origin；Managed 不能降级；跨进程刷新及事务；旧配置需确认，坏库明确阻断 |
| SEC-03 分组修改 | 客户端已修 / 服务端待验证 | group-only PATCH，无完整 GET→PUT 回退；需真实服务契约、对象授权及并发证据 |
| SEC-04 配置保留 | 本轮修复通过 / 部分事务边界保留 | Claude/Codex 同锁恢复/读取/合并；创建即私有、OS 锁、私有备份；部分同步只关联成功工具；跨位置/多兼容文件事务边界未消除 |
| SEC-05 Bridge 鉴权 | 实现已加固 / Accio 实机待验证 | 实例凭据、读取 body 前鉴权、失败不回退假端口；真实版本支持矩阵待验证 |
| SEC-06 付费请求 | 实现已加固 / 上游契约待验证 | 禁跨供应商自动补单；计费未知保留 pending；生成与取图分离 |
| SEC-07 预算 | 次数限制回归通过 / 金额和账户硬限未完成 | 落盘后放行、异常不清零、OS 事务锁；两进程争最后额度、重启及坏账本回归；预算异常不拖垮文本 Bridge |
| SEC-08 费率 | 两入口行为回归通过 / 权威换算待完成 | 共用 5 分钟正数有限费率和高倍率确认；刷新失败失效；既有汇率硬编码仍待契约 |
| SEC-09 凭据存储 | 部分完成 | Windows 当前 SID ACL / Unix 0600、私有备份、原子替换已验证；DPAPI/Keychain/libsecret 与会话迁移未实现 |
| SEC-10 退出和账号隔离 | 本轮行为回归通过 / 服务端撤销待验证 | 认证/钱包及前端窗口按会话和请求代次失效；旧错误和 finally 不写新账号 |
| SEC-11 服务端认证授权 | 阻塞（外部服务端） | 对象授权、会话撤销、group-only 接口需实现及证据 |
| SEC-12 服务端额度记账 | 阻塞（外部服务端） | 并发硬限、幂等结算/回调和全账户约束需实现及证据 |
| SEC-13 图片下载 | 实现已加固 / 实际环境待验证 | HTTPS、禁私网、DNS 绑定实际连接、限流式大小、图片类型检查 |
| SEC-14 安装与 IPC | 实现已加固 / 成品待验证 | 下载逐跳目标校验、Authenticode、下载记录和固定操作 ID |
| SEC-15 发布与秘密 | 本轮发布回归通过 / 运维待验证 | Actions 固定 SHA，发布物不覆盖，签名环境兼容，三平台强制产物，最终 SHA256SUMS；旧 Webhook 撤销待运维证据 |
| SEC-16 敏感状态 | 本轮行为回归通过 | 关闭/换账号使秘密请求失效，复制不缓存明文，剪贴板清理；不承诺擦除系统历史副本 |
| SEC-17 验收 | 本机检查通过 / 完整验收未完成 | Windows Rust 155 通过、2 个子进程 helper ignored；Unix 文件模块独立 7 项通过；前端 55 项通过；格式、Clippy、类型、构建、发布回归通过；多平台/服务端验收仍待执行 |

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
