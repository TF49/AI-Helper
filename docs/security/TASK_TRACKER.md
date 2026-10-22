# 安全整改任务跟踪

更新日期：2026-10-21。本轮基线：`491cc3fb`。用户已明确：外部 Bob API 服务端事项保留 TODO，由开发同事实现。

当前实现及存储清单见[收尾记录](SECURITY_CLOSURE_2026-10-21.md)，总体结论见[安全审计修改结论](../安全审计修改结论.md)。历史报告不作为当前平台实现或测试数量的说明。

| 任务 | 当前实现 / 待验收内容 |
| --- | --- |
| SEC-01 更新信任 | 签名、摘要、防重放、平台绑定与 DMG 版本/架构检查；TODO：旧版升级、macOS 两架构真实安装 |
| SEC-02 凭据出口 | Managed/External/Unknown、显式确认、精确 origin、Managed 优先和坏库阻断；官方转发固定 HTTPS origin |
| SEC-03 分组修改 | 客户端 group-only PATCH，无完整 PUT 回退；TODO（服务端）：接口契约、对象授权、并发字段保护 |
| SEC-04 配置保留 | Claude/Codex 同锁恢复与读改写；Codex URL 与环境变量原子更新及失败回滚；WorkBuddy 多位置事务日志、失败回滚及崩溃恢复 |
| SEC-05 Bridge 鉴权 | 实例凭据、读取 body 前鉴权、失败不冒用其他端口；TODO：Accio 受支持版本实机矩阵 |
| SEC-06 付费请求 | 已发送或结果未知不跨供应商补单；未决占用持久化，生成与取图分离；TODO：服务端操作 ID、幂等与查询契约 |
| SEC-07 预算 | 本地次数预留落盘后放行、跨进程锁、异常不清零、默认关闭；TODO（服务端）：可信金额上界及账户全局硬限 |
| SEC-08 费率 | 两入口共用有效期、正数有限倍率和高倍率确认；无权威转换时展示原始额度；TODO（服务端）：版本化报价及额度/货币单位契约 |
| SEC-09 凭据存储 | Windows 用户 DPAPI / macOS Keychain / Linux Secret Service；暂存及正式写入读回验证后激活；不可用不降级明文；旧 Unix 自制密文要求重登；TODO：macOS/Linux 原生凭据服务实机联调 |
| SEC-10 退出及账号隔离 | 同锁 marker、会话 generation 与磁盘 revision；密码/2FA/刷新旧响应不能复活已退出或覆盖新账号；TODO（服务端）：主动撤销与重放拒绝 |
| SEC-11 服务端认证授权 | TODO，交开发同事：对象授权、Token 最小权限、会话撤销、group-only 接口与隔离验收 |
| SEC-12 服务端额度记账 | TODO，交开发同事：并发硬限、预留/结算幂等、重复回调与异常恢复、全工具账户额度约束 |
| SEC-13 图片下载 | HTTPS、私网拒绝、DNS 绑定连接、大小/类型限制；TODO：部署环境与上游真实返回验证 |
| SEC-14 安装与 IPC | 逐跳目标检查、Authenticode、下载记录、固定操作 ID；TODO：成品安装验证 |
| SEC-15 发布与秘密 | Actions 固定 SHA、资产不覆盖、最终签名与哈希、三平台编译检查（Windows 完整测试）；TODO：生产签名/公证及运维撤销记录 |
| SEC-16 敏感状态 | 关闭/换账号使秘密请求失效，复制不缓存明文，剪贴板条件清理；不保证擦除系统历史 |
| SEC-17 验收 | 本机回归、Unix 隔离测试和远端 CI 分别记录实际结果；不以 mock 代替原生服务、安装或服务端验收 |

## 服务端交接 TODO

1. 提供 Bob API 服务端源码及隔离环境；当前仓库 server 仅为遥测服务。
2. 在服务端完成用户/Token 对象级授权，禁止跨用户读取、修改、删除或揭示 Key，禁用/过期立即生效。
3. group-only PATCH 仅改授权字段，与当前报价/可用分组原子校验，不能信任客户端确认布尔值。
4. 主动退出撤销 refresh/session，提供轮换、重放检测和客户端撤销接口契约。
5. 请求前原子预留额度，未知结果保留占用；请求、结算和供应商回调按唯一操作标识幂等处理。
6. 提供版本化价格、平台额度单位与币值换算配置；缺少或过期时保持原始额度显示。
7. 在假账号/余额和模拟供应商下交付权限、并发、超时、重复回调及重启恢复测试结果。

## 回归入口

### 本地完整检查

```powershell
# 前端检查
pnpm typecheck
pnpm test:security
pnpm build:renderer

# 后端检查（Windows）
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib

# 发布资产验证
./scripts/test-release-artifacts.ps1
```

### CI 检查范围

- **前端**: Ubuntu runner - TypeScript 检查、构建验证
- **后端 (Windows)**: Windows runner - 格式、全目标 Clippy、库测试（214 项）
- **后端 (Unix)**: macOS / Ubuntu runners - 编译检查、全目标 Clippy、Unix 文件系统测试 (`unix_filesystem_tests`)

### 原生凭据测试（需显式运行）

```bash
# Windows DPAPI（合成值，不读取个人凭据）
cargo test native_dpapi -- --ignored --nocapture

# macOS Keychain（需实机 Keychain 访问）
cargo test native_keychain -- --ignored --nocapture

# Linux Secret Service（需 gnome-keyring 或 KWallet）
cargo test native_secret_service -- --ignored --nocapture
```

### 测试说明

- 单元测试使用临时目录与隔离凭据后端（MemoryBackend）
- 前端行为回归执行真实源码的转译与模拟 hooks/IPC
- 发布回归使用模拟资产，不等同实机签名/公证
- 原生 DPAPI 使用合成值验证，不连接个人会话或注册表
- Keychain/Secret Service 不能凭内存后端测试认定实机通过，需显式运行标记为 `#[ignore]` 的原生测试
