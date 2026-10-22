# 当前待办与验收跟踪

更新日期：2026-10-22。本轮修复基线：`5522758f`。当前实现与证据见[本轮修复记录](SECURITY_FIXES_2026-10-22.md)，缺陷来源见[独立审查](SECURITY_REVIEW_2026-10-22.md)。旧日期快照不代表当前实现状态。

## 当前必须推动的事项

客户端侧整改已落地，但以下外部依赖尚未验收，不能据此宣称完整安全闭环：

| 优先级 | 事项 | 负责人 / 完成证据 |
| --- | --- | --- |
| P0 | Bob API 服务端：对象级授权、会话撤销、group-only 修改、报价契约、并发额度硬限和幂等记账 | 开发同事；提供服务端源码/隔离环境及权限、并发、重放和恢复测试证据 |
| P1 | macOS/Linux 原生凭据服务、受支持 Accio 版本兼容、macOS 两架构签名/公证/安装和旧版升级 | 对应平台实机验证记录；模拟测试不算通过 |
| P1 | 轮换并撤销已暴露的旧 Webhook/Key | 运维；提供轮换、撤销及验证记录 |

其余客户端实现与本机/CI 检查范围见下方 SEC-01 至 SEC-17 跟踪表；完成状态以对应提交和实际检查结果为准。

| 任务 | 当前实现 / 待验收内容 |
| --- | --- |
| SEC-01 更新信任 | 签名、摘要、防重放、平台绑定与 DMG 版本/架构检查；TODO：旧版升级、macOS 两架构真实安装 |
| SEC-02 凭据出口 | Managed/External/Unknown、显式确认、精确 origin、Managed 优先和坏库阻断；官方转发固定 HTTPS origin |
| SEC-03 分组修改 | 客户端 group-only PATCH，无完整 PUT 回退；TODO（服务端）：接口契约、对象授权、并发字段保护 |
| SEC-04 配置保留 | Claude/Codex 同锁恢复与读改写；Codex URL 与 Key 同一私有 TOML 原子替换；WorkBuddy 多位置事务、外部版本冲突保护，Committed 不覆盖后续修改 |
| SEC-05 Bridge 鉴权 | 实例凭据、读取 body 前鉴权、失败不冒用其他端口；TODO：Accio 受支持版本实机矩阵 |
| SEC-06 付费请求 | 已发送或结果未知不跨供应商补单；未决占用持久化，生成与取图分离；TODO：服务端操作 ID、幂等与查询契约 |
| SEC-07 预算 | 本地次数预留落盘后放行、跨进程锁、异常不清零、默认关闭；TODO（服务端）：可信金额上界及账户全局硬限 |
| SEC-08 费率 | 两入口共用有效期、正数有限倍率和高倍率确认；无权威转换时展示原始额度；TODO（服务端）：版本化报价及额度/货币单位契约 |
| SEC-09 凭据存储 | Windows 用户 DPAPI / macOS Keychain / Linux Secret Service；暂存及正式写入读回验证后激活；不可用不降级明文；旧 Unix 自制密文重登；原生隔离服务加入 CI；TODO：已签名安装成品的系统授权交互 |
| SEC-10 退出及账号隔离 | 同锁 marker、会话 generation 与磁盘 revision；密码/2FA/刷新旧响应不能复活已退出或覆盖新账号；TODO（服务端）：主动撤销与重放拒绝 |
| SEC-11 服务端认证授权 | TODO，交开发同事：对象授权、Token 最小权限、会话撤销、group-only 接口与隔离验收 |
| SEC-12 服务端额度记账 | TODO，交开发同事：并发硬限、预留/结算幂等、重复回调与异常恢复、全工具账户额度约束 |
| SEC-13 图片下载 | HTTPS、私网拒绝、DNS 绑定连接、大小/类型限制；TODO：部署环境与上游真实返回验证 |
| SEC-14 安装与 IPC | 逐跳目标检查、Authenticode、下载记录、固定操作 ID；TODO：成品安装验证 |
| SEC-15 发布与秘密 | Actions 固定 SHA，三平台完整回归，已有发布跳过，tag 与源码提交绑定，签名步骤注入密钥，双架构 DMG 汇总及最终哈希；TODO：生产签名/公证及运维撤销记录 |
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
pnpm test:workflows
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

- **前端**：类型、60 项行为回归、工作流结构及反例回归、生产构建。
- **后端三平台**：生产编译、格式、全目标 Clippy、完整库测试，不以位置过滤替代完整测试。
- **原生凭据**：Windows 显式 DPAPI；macOS 临时 Keychain、Linux 私有 D-Bus/Secret Service，使用专用随机条目。
- **发布**：Windows 模拟资产回归、macOS 真实双架构 DMG 与临时更新签名，生产 Rust 验签。

### 原生凭据测试（需显式运行）

```bash
# Windows DPAPI（合成值，不读取个人凭据）
cargo test native_dpapi -- --ignored --nocapture

# macOS/Linux 原生服务仅在一次性 CI runner 中显式运行
# 由 CI 设置 AI_HELPER_NATIVE_CREDENTIAL_TESTS=1 并调用：
bash scripts/test-native-credentials.sh
```

### 测试说明

- 单元测试使用临时目录与隔离凭据后端（MemoryBackend）
- 前端行为回归执行真实源码的转译与模拟 hooks/IPC
- 发布回归使用模拟资产，不等同实机签名/公证
- 原生 DPAPI 使用合成值验证，不连接个人会话或注册表
- Keychain/Secret Service 不能凭内存后端测试认定实机通过，需显式运行标记为 `#[ignore]` 的原生测试
