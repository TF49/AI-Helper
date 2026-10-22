你现在是一位资深的 Rust + Tauri + React 全栈架构师与系统安全专家（Staff/Principal Engineer）。
我们当前的项目是一个基于 Tauri 的跨平台 AI 辅助桌面客户端。
本轮代码进行了一次重点针对【Codex 凭据架构演进、跨平台凭据与文件系统极端测试、以及前端安全提示对齐】的重构。

请针对本轮修改的目标与具体实现代码，进行一次深度、苛刻的【目标导向代码审查】（Goal-Oriented Review）。

---

### 一、 本轮改动背景与要达成的核心目的：
1. **【目的 A - Codex 凭据存储重构（SEC-04）】**：
   - 弃用 TOML 中的 `experimental_bearer_token`，全面切到官方推荐的 `[model_providers.custom]` 下 `env_key = "CUSTOM_OPENAI_API_KEY"`。
   - 实现“TOML 文件更新”与“系统环境变量写入（Windows 注册表 + 进程内环境）”的事务原子性：任一方校验或写入失败，必须自动执行回滚（Rollback），防止网关与 Key 状态错配。
   - 保持向后兼容：既能平滑识别旧配置中的 legacy key，又要在切换或清空时干净注销环境与文件。
2. **【目的 B - 跨平台凭据与 Unix 文件系统健壮性（SEC-15）】**：
   - `secret_storage.rs` 区分 macOS Keychain、Linux Secret Service、Windows Credential Manager 的错误引导文案，并提供原生实机集成测试（标记为 `#[ignore]`）。
   - `workbuddy.rs` 补充 Unix 文件系统场景测试（如指向只读目录的符号链接、断损软链自愈、嵌套符号链接、多线程并发文件锁写入）。
3. **【目的 C - 前端界面与安全边界认知对齐（SEC-07, SEC-12）】**：
   - 将 UI 中对 Codex Key 存储位置的描述从 `config.toml` 准确变更为 `环境变量 (CUSTOM_OPENAI_API_KEY)`。
   - 前端明确透传“本地次数预算仅为客户端拦截，不能替代服务端硬限”的安全边界（AccioWorkPanel）。
   - 额度无权威汇率时严格展示服务端原始数据，避免推测币值误导用户（AccountBalanceCard, App.tsx）。
4. **【目的 D - 迁移指引与测试闭环】**：
   - 提供 `USER_MIGRATION_GUIDE.md` 与验证脚本，确保升级无破坏性中断。

---

### 二、 本次修改涉及的核心文件：
- 后端：`src-tauri/src/codex.rs`, `src-tauri/src/secret_storage.rs`, `src-tauri/src/workbuddy.rs`
- 前端：`src/components/ChatGPTPanel.tsx`, `src/components/InitializationModal.tsx`, `src/components/TerminalTestModal.tsx`, `src/components/AccioWorkPanel.tsx`, `src/components/AccountBalanceCard.tsx`, `src/App.tsx`
- 文档与测试：`docs/security/SECURITY_CLOSURE_2026-10-21.md`, `docs/security/TASK_TRACKER.md`, `docs/USER_MIGRATION_GUIDE.md`, `scripts/verify-improvements.ps1`

---

### 三、 请重点审查以下致命与关键场景（Review Checkpoints）：

1. **Codex 事务更新与回滚逻辑（`codex.rs`）**：
   - 审查 `set_codex_config` 的更新流程：环境变量写入、TOML 写入、写后读取验证、异常触发回滚的顺序是否严密？
   - 是否存在死锁、并发竞争条件（Race Condition）？文件锁 `with_file_lock` 的粒度是否覆盖了环境变量的改动？
   - 回滚逻辑中：若原环境变量原本为空，回滚是执行 `delete_registry_env`；若原环境变量有值，是否能精确还原旧值？如果回滚过程自身抛错，系统状态是否会被静默破坏？
   - 跨平台兼容性：在 macOS/Linux 上调用 `read_registry_env` / `write_registry_env` 的行为是否正确降级或兼容？（是否依赖平台 cfg？）
   - 解析与向下兼容：`parse_codex_content` 和 `legacy_key_for_content` 对旧 TOML（含 bearer_token 或缺少 env_key）的读取逻辑是否无缝兼容？是否存在可能导致空密钥或旧密钥泄漏的判定漏洞？

2. **凭据安全与跨平台实机测试（`secret_storage.rs` & `workbuddy.rs`）**：
   - macOS 和 Linux 的 `#[ignore]` 原生实机测试是否具备幂等性和自清理能力？测试失败时是否会在用户的钥匙串/Secret Service 中遗留垃圾条目？
   - 错误提示区分是否精准？是否可能向前端抛出未格式化的内部系统敏感堆栈？
   - `workbuddy.rs` 的 Unix 测试是否真实模拟了 POSIX 文件系统权限与符号链接行为？并发测试的 `thread::sleep` 是否存在假通过（Flaky Test）风险？

3. **前后端接口与契约一致性**：
   - 前端组件（`ChatGPTPanel`、`InitializationModal`）中的属性变更（例如将 `storageLocation`/`configKey` 改为 `envVarName="CUSTOM_OPENAI_API_KEY"`）是否与底层 `ApiKeyInput` 组件的 Props 定义完全匹配？是否存在未传递或类型不兼容？
   - 前端测试弹窗（`TerminalTestModal`）与 UI 提示的文案是否与后端的真实行为严格一致？

4. **安全与用户迁移文档合规性**：
   - `USER_MIGRATION_GUIDE.md` 中的终端导出命令、排错指南是否存在误导（例如 macOS/Linux 独立终端无法继承 GUI 应用进程内环境变量的问题是否有清晰交代）？
   - 安全报告中的断言是否与代码实际实现严格相符？

---

### 四、 输出格式要求：

#### 1. 目标达成度评估（Goal Achievement Verdict）
- 本轮修改是否 100% 达成了预设的核心目标？
- 结论评级：[✅ 完美达成 / ⚠️ 达成但有中低风险瑕疵 / ❌ 未能达成或引入新回归]

#### 2. 缺陷与风险清单（按 P0 > P1 > P2 排序，无废话）
- **[P0 阻断性缺陷]**：必然引发 Panic、事务不一致、密钥错配、状态污染或严重安全隐患的问题。
- **[P1 重要缺陷]**：边界条件缺失、跨平台行为不一致、并发死锁风险、降级失效。
- **[P2 次要建议]**：代码坏味道、测试健壮性建议、文案不精准。
*(每个问题必须列出：所在文件及函数、触发场景与严重后果、具体的修复代码 Diff)*

#### 3. 必须补充的验收与边缘测试（Verification Checklist）
- 列出 3~5 个在合入主分支前必须由人工或实机验证的边缘场景。

---

### 五、 本轮修改的完整 Git Diff：

`diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 32fad76c..5b28c437 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -122,7 +122,46 @@ jobs:
         run: cargo fmt --check --manifest-path src-tauri/Cargo.toml
 
       - name: Clippy
-        run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
+        run: cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
 
       - name: Run backend tests
         run: cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
+
+  backend-unix:
+    name: Backend Checks (${{ matrix.os }})
+    needs: changes
+    if: github.event_name != 'pull_request' || needs.changes.outputs.backend == 'true'
+    strategy:
+      matrix:
+        os: [ubuntu-latest, macos-latest]
+    runs-on: ${{ matrix.os }}
+    steps:
+      - name: Checkout
+        uses: actions/checkout@v7
+
+      - name: Setup Rust
+        uses: dtolnay/rust-toolchain@stable
+        with:
+          components: clippy
+
+      - name: Cache Cargo registry and build
+        uses: actions/cache@v5
+        with:
+          path: |
+            ~/.cargo/registry
+            ~/.cargo/git
+            src-tauri/target
+          key: ${{ runner.os }}-cargo-${{ hashFiles('src-tauri/Cargo.lock') }}
+          restore-keys: ${{ runner.os }}-cargo-
+
+      - name: Create frontend dist placeholder
+        run: mkdir -p dist
+
+      - name: Check compilation
+        run: cargo check --manifest-path src-tauri/Cargo.toml --locked --lib
+
+      - name: Clippy
+        run: cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
+
+      - name: Run Unix filesystem tests
+        run: cargo test --manifest-path src-tauri/Cargo.toml --locked --lib unix_filesystem_tests
diff --git a/docs/security/SECURITY_CLOSURE_2026-10-21.md b/docs/security/SECURITY_CLOSURE_2026-10-21.md
index d2fe28f3..96554993 100644
--- a/docs/security/SECURITY_CLOSURE_2026-10-21.md
+++ b/docs/security/SECURITY_CLOSURE_2026-10-21.md
@@ -14,12 +14,12 @@
 | 迁移尚未成功就启用 Cookie | 新保护存储暂存、读取验证、正式提交并再验证后才激活；失败持久阻止自动恢复，界面报告重新登录原因 |
 | 退出标记被刷新或迟到的登录清除 | session 与 marker 共用跨进程锁；普通保存不能清除 marker；显式登录提交比较请求发出前的磁盘 revision；marker 每次退出均产生新 revision |
 | 登录/刷新返回的 Cookie 污染当前账号 | 使用请求专用 CookieJar，提交前核对账号、代次和磁盘状态；退出先清本地状态，再执行远端撤销 |
-| Codex 新 Key 与旧网关在不同存储位置短暂错配 | URL 与 CLI 支持的 bearer 配置写入同一个私有 TOML 并原子替换；不再写入新全局环境变量或向启动进程额外注入 Key |
+| Codex 新 Key 与网关存储一致性 | URL 写入私有 TOML 并原子校验 env_key 绑定；Key 写入系统环境变量 CUSTOM_OPENAI_API_KEY，更新失败自动执行环境变量与文件回滚 |
 | 官方透明转发可发送业务认证到任意自定义地址 | 保存及两条实际发送路径均验证已知 HTTPS 官方 origin；防泄露开关在发送前生效 |
 | 钱包/日志硬编码货币换算 | 无已确认平台换算契约时显示原始平台额度及“换算不可用”，不把未知价格、余额或汇率当作确定金额 |
 | CI 未覆盖 macOS/Linux 原生凭据代码 | 后端检查扩展到 Windows/macOS/Linux；显式生产代码检查、全目标 Clippy、隔离库测试；测试不默认连接个人凭据库 |
 
-Codex 的直接 bearer 配置方式已核对 [OpenAI 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。该接口受到 CLI 支持，但官方通常建议使用环境变量；本项目选择私有配置内的单次原子提交，以绑定网关和凭据。第三方 CLI 需要读取的配置仍是受限权限明文，不能宣称这些配置由系统凭据库加密。
+Codex 的环境密钥配置已核对 [OpenAI 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。Codex 全面仅保留环境变量方式：通过 `~/.codex/config.toml` 中 `[model_providers.custom]` 的 `env_key = "CUSTOM_OPENAI_API_KEY"` 引用系统环境变量，应用在更新配置时原子同步 TOML 与环境变量并自动清理历史 bearer 字段，并在任何一方失败时自动触发回滚。不再支持或保留任何直接写入 TOML 的 bearer 模式。
 
 ## 凭据存储清单
 
@@ -31,7 +31,7 @@ Codex 的直接 bearer 配置方式已核对 [OpenAI 配置参考](https://learn
 | Claude / Codex / WorkBuddy 配置与 `.bak` | 第三方 CLI 必需的可读配置；创建即限制权限，安全替换和备份；只改本应用管理的字段，不删除用户其他配置 |
 | WorkBuddy 事务日志 | 恢复所需的前后配置快照，可能含 CLI Key；创建即私有；成功提交/回滚恢复后删除；故障保留用于恢复 |
 | Accio 配置与模型缓存 | 自定义 API Key 仅用于目标网关；模型缓存来源为不可逆摘要，禁止缓存指纹内拼接原始 Key |
-| 旧 Codex 全局环境项 | 仅为读取旧配置兼容而保留，不新增或更新；不自动删除其他启动方式依赖的旧项；用户可在完成迁移并确认旧终端停用后自行清理/轮换 |
+| Codex 用户环境变量 (`CUSTOM_OPENAI_API_KEY`) | 由 Codex CLI 读取的密钥环境变量；Windows 写入用户环境变量（注册表）并同步当前进程，清空保存时自动删除 |
 
 删除本地引用不等同服务端撤销，不承诺清除操作系统、SSD、备份或剪贴板历史。旧 Unix 自制凭据无法安全自动迁移，升级后应显式重新登录。
 
@@ -39,9 +39,15 @@ Codex 的直接 bearer 配置方式已核对 [OpenAI 配置参考](https://learn
 
 上轮 `002e312c` 的 [CI 失败记录](https://github.com/TF49/AI-Helper/actions/runs/39551138541)中，三个 Windows ACL 测试把内置管理员 SID 的 SDDL 别名 `LA` 错判成其他用户。`519adaef` 已修正断言，同时仍要求当前进程 SID 的唯一完整访问 ACE；`491cc3fb` 的 [基线 CI 已成功](https://github.com/TF49/AI-Helper/actions/runs/39559046204)。这不代表本轮新增代码已经通过远端检查。
 
-本轮扩展三平台后，远端原生凭据编译均通过，并发现此前仅 Windows 检查未覆盖的 Unix Clippy 问题：Windows 专属常量/监控函数未限定平台，Linux 不支持的启动分支声明了未使用变量，macOS 分支末尾多余 return。已按实际调用平台限定代码并修正分支表达式，保留 `-D warnings` 严格检查。
+本轮扩展三平台编译检查后，远端原生凭据编译均通过，并发现此前仅 Windows 检查未覆盖的 Unix Clippy 问题：Windows 专属常量/监控函数未限定平台，Linux 不支持的启动分支声明了未使用变量，macOS 分支末尾多余 return。已按实际调用平台限定代码并修正分支表达式，保留 `-D warnings` 严格检查。
 
-平台凭据单元测试使用隔离内存后端，不能替代原生 Keychain/Secret Service 联调。Windows 原生 DPAPI 回归以显式命令运行，使用合成值，不读取个人会话或注册表；CI 的 Windows job 也显式运行这两项。
+**CI 检查范围说明**：
+
+- Windows runner: 完整后端测试（格式、全目标 Clippy、214 项库测试）
+- macOS/Linux runner: 平台特定代码编译检查、全目标 Clippy 及 Unix 文件系统测试 (`unix_filesystem_tests`)
+- 原因：原生凭据测试需要实际系统服务（Keychain/Secret Service），CI 环境使用隔离内存后端；Unix 文件系统测试已纳入 CI 矩阵自动化运行
+
+平台凭据单元测试使用隔离内存后端，不能替代原生 Keychain/Secret Service 联调。Windows 原生 DPAPI 回归以显式命令运行，使用合成值，不读取个人会话或注册表；CI 的 Windows job 也显式运行这两项。macOS/Linux 原生凭据测试需要在实机环境显式运行（标记为 `#[ignore]`）。
 
 ## 验证记录
 
diff --git a/docs/security/TASK_TRACKER.md b/docs/security/TASK_TRACKER.md
index 9ccf7866..7a6534af 100644
--- a/docs/security/TASK_TRACKER.md
+++ b/docs/security/TASK_TRACKER.md
@@ -9,7 +9,7 @@
 | SEC-01 更新信任 | 签名、摘要、防重放、平台绑定与 DMG 版本/架构检查；TODO：旧版升级、macOS 两架构真实安装 |
 | SEC-02 凭据出口 | Managed/External/Unknown、显式确认、精确 origin、Managed 优先和坏库阻断；官方转发固定 HTTPS origin |
 | SEC-03 分组修改 | 客户端 group-only PATCH，无完整 PUT 回退；TODO（服务端）：接口契约、对象授权、并发字段保护 |
-| SEC-04 配置保留 | Claude/Codex 同锁恢复与读改写；Codex URL/Key 同文件原子提交；WorkBuddy 多位置事务日志、失败回滚及崩溃恢复 |
+| SEC-04 配置保留 | Claude/Codex 同锁恢复与读改写；Codex URL 与环境变量原子更新及失败回滚；WorkBuddy 多位置事务日志、失败回滚及崩溃恢复 |
 | SEC-05 Bridge 鉴权 | 实例凭据、读取 body 前鉴权、失败不冒用其他端口；TODO：Accio 受支持版本实机矩阵 |
 | SEC-06 付费请求 | 已发送或结果未知不跨供应商补单；未决占用持久化，生成与取图分离；TODO：服务端操作 ID、幂等与查询契约 |
 | SEC-07 预算 | 本地次数预留落盘后放行、跨进程锁、异常不清零、默认关闭；TODO（服务端）：可信金额上界及账户全局硬限 |
@@ -20,7 +20,7 @@
 | SEC-12 服务端额度记账 | TODO，交开发同事：并发硬限、预留/结算幂等、重复回调与异常恢复、全工具账户额度约束 |
 | SEC-13 图片下载 | HTTPS、私网拒绝、DNS 绑定连接、大小/类型限制；TODO：部署环境与上游真实返回验证 |
 | SEC-14 安装与 IPC | 逐跳目标检查、Authenticode、下载记录、固定操作 ID；TODO：成品安装验证 |
-| SEC-15 发布与秘密 | Actions 固定 SHA、资产不覆盖、最终签名与哈希、三平台后端检查；TODO：生产签名/公证及运维撤销记录 |
+| SEC-15 发布与秘密 | Actions 固定 SHA、资产不覆盖、最终签名与哈希、三平台编译检查（Windows 完整测试）；TODO：生产签名/公证及运维撤销记录 |
 | SEC-16 敏感状态 | 关闭/换账号使秘密请求失效，复制不缓存明文，剪贴板条件清理；不保证擦除系统历史 |
 | SEC-17 验收 | 本机回归、Unix 隔离测试和远端 CI 分别记录实际结果；不以 mock 代替原生服务、安装或服务端验收 |
 
@@ -36,15 +36,47 @@
 
 ## 回归入口
 
+### 本地完整检查
+
 ```powershell
+# 前端检查
 pnpm typecheck
 pnpm test:security
 pnpm build:renderer
+
+# 后端检查（Windows）
 cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
 cargo check --manifest-path src-tauri/Cargo.toml --locked --lib
 cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
 cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
+
+# 发布资产验证
 ./scripts/test-release-artifacts.ps1
 ```
 
-单元测试使用临时目录与隔离凭据后端；前端行为回归执行真实源码的转译与模拟 hooks/IPC，发布回归使用模拟资产。原生 DPAPI 另以合成值验证；Keychain/Secret Service 不能凭内存后端测试认定实机通过。
+### CI 检查范围
+
+- **前端**: Ubuntu runner - TypeScript 检查、构建验证
+- **后端 (Windows)**: Windows runner - 格式、全目标 Clippy、库测试（214 项）
+- **后端 (Unix)**: macOS / Ubuntu runners - 编译检查、全目标 Clippy、Unix 文件系统测试 (`unix_filesystem_tests`)
+
+### 原生凭据测试（需显式运行）
+
+```bash
+# Windows DPAPI（合成值，不读取个人凭据）
+cargo test native_dpapi -- --ignored --nocapture
+
+# macOS Keychain（需实机 Keychain 访问）
+cargo test native_keychain -- --ignored --nocapture
+
+# Linux Secret Service（需 gnome-keyring 或 KWallet）
+cargo test native_secret_service -- --ignored --nocapture
+```
+
+### 测试说明
+
+- 单元测试使用临时目录与隔离凭据后端（MemoryBackend）
+- 前端行为回归执行真实源码的转译与模拟 hooks/IPC
+- 发布回归使用模拟资产，不等同实机签名/公证
+- 原生 DPAPI 使用合成值验证，不连接个人会话或注册表
+- Keychain/Secret Service 不能凭内存后端测试认定实机通过，需显式运行标记为 `#[ignore]` 的原生测试
diff --git a/src-tauri/src/codex.rs b/src-tauri/src/codex.rs
index bb6c23fb..b207841b 100644
--- a/src-tauri/src/codex.rs
+++ b/src-tauri/src/codex.rs
@@ -116,8 +116,8 @@ fn align_active_managed_profile(
 fn needs_legacy_environment(doc: &DocumentMut) -> bool {
     selected_provider(doc).is_ok_and(|provider| provider == MANAGED_PROVIDER)
         && custom_provider(doc).is_some_and(|provider| {
-            provider.get("experimental_bearer_token").is_none()
-                && provider.get("env_key").and_then(Item::as_str) == Some(LEGACY_ENV_KEY)
+            provider.get("env_key").and_then(Item::as_str) == Some(LEGACY_ENV_KEY)
+                || provider.get("env_key").is_none()
         })
 }
 
@@ -131,39 +131,47 @@ fn parse_codex_content(
 ) -> CodexConfig {
     let mut base_url = String::new();
     let mut model = String::new();
-    let mut api_key = String::new();
+    let mut api_key = if content.trim().is_empty() {
+        legacy_api_key.clone()
+    } else {
+        String::new()
+    };
     if config_exists {
-        if let Ok(doc) = content.trim().parse::<DocumentMut>() {
-            model = active_profile(&doc)
-                .ok()
-                .flatten()
-                .and_then(|profile| profile.get("model"))
-                .or_else(|| doc.get("model"))
-                .and_then(Item::as_str)
-                .or_else(|| {
-                    doc.get("profiles")?
-                        .get("thirdparty")?
-                        .get("model")?
-                        .as_str()
-                })
-                .unwrap_or_default()
-                .to_string();
-            if let Some(custom) = custom_provider(&doc).filter(|_| {
-                selected_provider(&doc).is_ok_and(|provider| provider == MANAGED_PROVIDER)
-            }) {
-                if let Some(url) = custom.get("base_url").and_then(Item::as_str) {
-                    let trimmed = url.trim_end_matches('/');
-                    let stripped = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
-                    if !stripped.is_empty() {
-                        base_url = format!("{stripped}/");
+        let trimmed = content.trim();
+        if !trimmed.is_empty() {
+            if let Ok(doc) = trimmed.parse::<DocumentMut>() {
+                model = active_profile(&doc)
+                    .ok()
+                    .flatten()
+                    .and_then(|profile| profile.get("model"))
+                    .or_else(|| doc.get("model"))
+                    .and_then(Item::as_str)
+                    .or_else(|| {
+                        doc.get("profiles")?
+                            .get("thirdparty")?
+                            .get("model")?
+                            .as_str()
+                    })
+                    .unwrap_or_default()
+                    .to_string();
+                if let Some(custom) = custom_provider(&doc).filter(|_| {
+                    selected_provider(&doc).is_ok_and(|provider| provider == MANAGED_PROVIDER)
+                }) {
+                    if let Some(url) = custom.get("base_url").and_then(Item::as_str) {
+                        let trimmed = url.trim_end_matches('/');
+                        let stripped = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
+                        if !stripped.is_empty() {
+                            base_url = format!("{stripped}/");
+                        }
                     }
-                }
-                if let Some(token) = custom.get("experimental_bearer_token") {
-                    // Presence, including an explicit empty token, prevents a
-                    // stale global credential from being paired with this URL.
-                    api_key = token.as_str().unwrap_or_default().to_string();
-                } else if needs_legacy_environment(&doc) {
-                    api_key = legacy_api_key;
+                    if custom.get("env_key").and_then(Item::as_str) == Some(LEGACY_ENV_KEY)
+                        || custom.get("env_key").is_none()
+                    {
+                        api_key = legacy_api_key.clone();
+                    }
+                } else if selected_provider(&doc).is_ok_and(|provider| provider != MANAGED_PROVIDER)
+                {
+                    api_key = String::new();
                 }
             }
         }
@@ -183,6 +191,9 @@ fn legacy_key_for_content(
     content: &str,
     read: impl FnOnce(&str) -> Result<String, AppError>,
 ) -> Result<String, AppError> {
+    if content.trim().is_empty() {
+        return read(LEGACY_ENV_KEY);
+    }
     if content
         .parse::<DocumentMut>()
         .ok()
@@ -242,13 +253,9 @@ pub fn get_codex_config() -> Result<CodexConfig, AppError> {
 }
 
 #[cfg_attr(not(test), allow(dead_code))]
-pub fn prepare_codex_doc(
-    base_url: &str,
-    api_key: &str,
-    model: Option<&str>,
-) -> Result<DocumentMut, AppError> {
+pub fn prepare_codex_doc(base_url: &str, model: Option<&str>) -> Result<DocumentMut, AppError> {
     let mut doc = DocumentMut::new();
-    merge_codex_managed_fields(&mut doc, base_url, api_key, model)?;
+    merge_codex_managed_fields(&mut doc, base_url, model)?;
     Ok(doc)
 }
 
@@ -344,7 +351,6 @@ fn clean_query_parameters(
 pub fn merge_codex_managed_fields(
     doc: &mut DocumentMut,
     base_url: &str,
-    api_key: &str,
     model: Option<&str>,
 ) -> Result<(), AppError> {
     align_active_managed_profile(doc, model)?;
@@ -380,9 +386,9 @@ pub fn merge_codex_managed_fields(
         .map(ToOwned::to_owned);
     clean_query_parameters(custom, previous_url.as_deref(), base_url)?;
     custom.insert("base_url", toml_edit::value(base_url));
-    custom.insert("experimental_bearer_token", toml_edit::value(api_key));
+    custom.insert("env_key", toml_edit::value(LEGACY_ENV_KEY));
     for name in [
-        "env_key",
+        "experimental_bearer_token",
         "env_key_instructions",
         "auth",
         "requires_openai_auth",
@@ -403,7 +409,6 @@ pub fn merge_codex_managed_fields(
 fn edited_codex_contents(
     previous: Option<&[u8]>,
     base_url: &str,
-    api_key: &str,
     model: Option<&str>,
 ) -> Result<Vec<u8>, AppError> {
     let raw = std::str::from_utf8(previous.unwrap_or_default())
@@ -414,7 +419,7 @@ fn edited_codex_contents(
         raw.parse::<DocumentMut>()
             .map_err(|_| AppError::Toml("现有 Codex 配置损坏，已停止写入以免丢失安全规则".into()))?
     };
-    merge_codex_managed_fields(&mut doc, base_url, api_key, model)?;
+    merge_codex_managed_fields(&mut doc, base_url, model)?;
     let text = doc.to_string();
     let check = text
         .parse::<DocumentMut>()
@@ -423,31 +428,130 @@ fn edited_codex_contents(
         .ok_or_else(|| AppError::Toml("Codex custom provider 缺失".into()))?;
     if check.get("model_provider").and_then(Item::as_str) != Some(MANAGED_PROVIDER)
         || custom.get("base_url").and_then(Item::as_str) != Some(base_url)
-        || custom
-            .get("experimental_bearer_token")
-            .and_then(Item::as_str)
-            != Some(api_key)
+        || custom.get("env_key").and_then(Item::as_str) != Some(LEGACY_ENV_KEY)
     {
         return Err(AppError::Toml(
-            "Codex URL 与密钥未能在同一配置中绑定，已停止保存".into(),
+            "Codex URL 与环境变量引用未能在同一配置中绑定，已停止保存".into(),
         ));
     }
     Ok(text.into_bytes())
 }
 
-fn write_codex_config_at(
-    path: &Path,
-    base_url: &str,
-    api_key: &str,
-    model: Option<&str>,
-) -> Result<(), AppError> {
-    // URL and bearer token commit as one private file. There is no global
-    // environment or registry staging/rollback window, including on failures.
+#[cfg_attr(not(test), allow(dead_code))]
+fn write_codex_config_at(path: &Path, base_url: &str, model: Option<&str>) -> Result<(), AppError> {
     crate::safe_fs::update_file(path, |previous| {
-        edited_codex_contents(previous, base_url, api_key, model)
+        edited_codex_contents(previous, base_url, model)
     })
 }
 
+#[derive(Debug, Clone)]
+struct EnvironmentSnapshot {
+    #[cfg(target_os = "windows")]
+    registry_value: Option<String>,
+    process_value: Option<std::ffi::OsString>,
+}
+
+impl EnvironmentSnapshot {
+    fn capture(name: &str) -> Result<Self, AppError> {
+        #[cfg(target_os = "windows")]
+        {
+            use winreg::{enums::HKEY_CURRENT_USER, RegKey};
+            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
+            let registry_value = match hkcu.open_subkey("Environment") {
+                Ok(env) => match env.get_value::<String, _>(name) {
+                    Ok(val) => Some(val),
+                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
+                    Err(err) => return Err(AppError::Registry(err.to_string())),
+                },
+                Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
+                Err(err) => return Err(AppError::Registry(err.to_string())),
+            };
+            let process_value = std::env::var_os(name);
+            Ok(Self {
+                registry_value,
+                process_value,
+            })
+        }
+        #[cfg(not(target_os = "windows"))]
+        {
+            let process_value = std::env::var_os(name);
+            Ok(Self { process_value })
+        }
+    }
+
+    fn restore(self, name: &str) -> Result<(), AppError> {
+        #[cfg(target_os = "windows")]
+        {
+            use winreg::{enums::HKEY_CURRENT_USER, RegKey};
+            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
+            if let Some(ref reg_val) = self.registry_value {
+                let (env, _) = hkcu
+                    .create_subkey("Environment")
+                    .map_err(|e| AppError::Registry(e.to_string()))?;
+                env.set_value(name, reg_val)
+                    .map_err(|e| AppError::Registry(e.to_string()))?;
+            } else {
+                match hkcu.open_subkey_with_flags("Environment", winreg::enums::KEY_SET_VALUE) {
+                    Ok(env) => {
+                        if let Err(error) = env.delete_value(name) {
+                            if error.kind() != std::io::ErrorKind::NotFound {
+                                return Err(AppError::Registry(error.to_string()));
+                            }
+                        }
+                    }
+                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
+                    Err(error) => return Err(AppError::Registry(error.to_string())),
+                }
+            }
+            if let Some(proc_val) = self.process_value {
+                std::env::set_var(name, proc_val);
+            } else {
+                std::env::remove_var(name);
+            }
+            Ok(())
+        }
+        #[cfg(not(target_os = "windows"))]
+        {
+            if let Some(proc_val) = self.process_value {
+                std::env::set_var(name, proc_val);
+            } else {
+                std::env::remove_var(name);
+            }
+            Ok(())
+        }
+    }
+}
+
+fn write_codex_environment(name: &str, key: &str) -> Result<(), AppError> {
+    if key.is_empty() {
+        delete_registry_env(name)
+    } else {
+        write_registry_env(name, key)
+    }
+}
+
+fn combine_transaction_errors(
+    primary: AppError,
+    file_rollback: Result<(), AppError>,
+    env_rollback: Result<(), AppError>,
+) -> AppError {
+    let mut details = Vec::new();
+    if let Err(e) = file_rollback {
+        details.push(format!("文件回滚失败: {e}"));
+    }
+    if let Err(e) = env_rollback {
+        details.push(format!("环境变量回滚失败: {e}"));
+    }
+    if details.is_empty() {
+        primary
+    } else {
+        AppError::Other(format!(
+            "{primary}；且回滚过程中发生错误（{}）",
+            details.join("，")
+        ))
+    }
+}
+
 pub fn set_codex_config(
     url: String,
     api_key: String,
@@ -467,12 +571,39 @@ pub fn set_codex_config(
     } else {
         format!("{normalized}/v1")
     };
-    write_codex_config_at(
-        &codex_config_path()?,
-        &base_url,
-        api_key.trim(),
-        model.as_deref(),
-    )
+    let path = codex_config_path()?;
+
+    crate::safe_fs::with_file_lock(&path, || {
+        let previous_file = crate::safe_fs::read_optional_locked(&path)?;
+        let previous_env = EnvironmentSnapshot::capture(LEGACY_ENV_KEY)?;
+        let expected =
+            edited_codex_contents(previous_file.as_deref(), &base_url, model.as_deref())?;
+
+        let result = (|| {
+            write_codex_environment(LEGACY_ENV_KEY, api_key.trim())?;
+            crate::safe_fs::replace_with_backup_locked(&path, previous_file.as_deref(), &expected)?;
+
+            let persisted = crate::safe_fs::read_optional_locked(&path)?;
+            if persisted.as_deref() != Some(expected.as_slice())
+                || read_registry_env(LEGACY_ENV_KEY)? != api_key.trim()
+            {
+                return Err(AppError::Other("Codex 配置写后验证失败".into()));
+            }
+            Ok(())
+        })();
+
+        if let Err(primary) = result {
+            let file_rollback =
+                crate::safe_fs::restore_optional_locked(&path, previous_file.as_deref());
+            let env_rollback = previous_env.restore(LEGACY_ENV_KEY);
+            return Err(combine_transaction_errors(
+                primary,
+                file_rollback,
+                env_rollback,
+            ));
+        }
+        Ok(())
+    })
 }
 
 #[cfg(any(target_os = "windows", test))]
@@ -485,7 +616,7 @@ fn checked_environment_read(value: std::io::Result<String>) -> Result<String, Ap
 }
 
 #[cfg(target_os = "windows")]
-fn read_registry_env(name: &str) -> Result<String, AppError> {
+pub fn read_registry_env(name: &str) -> Result<String, AppError> {
     use winreg::{enums::HKEY_CURRENT_USER, RegKey};
     let hkcu = RegKey::predef(HKEY_CURRENT_USER);
     let env = match hkcu.open_subkey("Environment") {
@@ -497,7 +628,7 @@ fn read_registry_env(name: &str) -> Result<String, AppError> {
 }
 
 #[cfg(not(target_os = "windows"))]
-fn read_registry_env(name: &str) -> Result<String, AppError> {
+pub fn read_registry_env(name: &str) -> Result<String, AppError> {
     match std::env::var(name) {
         Ok(value) => Ok(value),
         Err(std::env::VarError::NotPresent) => Ok(String::new()),
@@ -507,6 +638,50 @@ fn read_registry_env(name: &str) -> Result<String, AppError> {
     }
 }
 
+#[cfg(target_os = "windows")]
+pub fn write_registry_env(name: &str, value: &str) -> Result<(), AppError> {
+    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
+    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
+    let (env, _) = hkcu
+        .create_subkey("Environment")
+        .map_err(|e| AppError::Registry(e.to_string()))?;
+    env.set_value(name, &value.to_string())
+        .map_err(|e| AppError::Registry(e.to_string()))?;
+    std::env::set_var(name, value);
+    Ok(())
+}
+
+#[cfg(not(target_os = "windows"))]
+pub fn write_registry_env(name: &str, value: &str) -> Result<(), AppError> {
+    std::env::set_var(name, value);
+    Ok(())
+}
+
+#[cfg(target_os = "windows")]
+pub fn delete_registry_env(name: &str) -> Result<(), AppError> {
+    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
+    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
+    match hkcu.open_subkey_with_flags("Environment", winreg::enums::KEY_SET_VALUE) {
+        Ok(env) => {
+            if let Err(error) = env.delete_value(name) {
+                if error.kind() != std::io::ErrorKind::NotFound {
+                    return Err(AppError::Registry(error.to_string()));
+                }
+            }
+        }
+        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
+        Err(error) => return Err(AppError::Registry(error.to_string())),
+    }
+    std::env::remove_var(name);
+    Ok(())
+}
+
+#[cfg(not(target_os = "windows"))]
+pub fn delete_registry_env(name: &str) -> Result<(), AppError> {
+    std::env::remove_var(name);
+    Ok(())
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
@@ -526,20 +701,14 @@ model_provider = "custom"
 model = "team-model"
 [model_providers.custom]
 base_url = "https://old.example/v1"
-experimental_bearer_token = "fake-old-key"
+env_key = "CUSTOM_OPENAI_API_KEY"
 unknown_policy = { keep = true }
 [model_providers.other]
 base_url = "https://other.example/v1"
 env_key = "OTHER_PROVIDER_KEY"
 "#;
         std::fs::write(&path, previous).unwrap();
-        write_codex_config_at(
-            &path,
-            "https://new.example/v1",
-            "fake-new-key",
-            Some("new-model"),
-        )
-        .unwrap();
+        write_codex_config_at(&path, "https://new.example/v1", Some("new-model")).unwrap();
         let current = std::fs::read_to_string(&path).unwrap();
         let doc = current.parse::<DocumentMut>().unwrap();
         let provider = custom_provider(&doc).unwrap();
@@ -548,11 +717,10 @@ env_key = "OTHER_PROVIDER_KEY"
             Some("https://new.example/v1")
         );
         assert_eq!(
-            provider
-                .get("experimental_bearer_token")
-                .and_then(Item::as_str),
-            Some("fake-new-key")
+            provider.get("env_key").and_then(Item::as_str),
+            Some(LEGACY_ENV_KEY)
         );
+        assert!(provider.get("experimental_bearer_token").is_none());
         assert_eq!(doc["profile"].as_str(), Some("team"));
         assert_eq!(
             doc["profiles"]["team"]["model_provider"].as_str(),
@@ -589,24 +757,22 @@ env_key = "OTHER_PROVIDER_KEY"
     fn failed_atomic_update_keeps_the_previous_url_and_key_pair() {
         let directory = tempfile::tempdir().unwrap();
         let path = directory.path().join("config.toml");
-        let previous = b"model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nexperimental_bearer_token='fake-old-key'\n";
+        let previous = b"model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nenv_key='CUSTOM_OPENAI_API_KEY'\n";
         std::fs::write(&path, previous).unwrap();
         // Force the real backup write to fail before replacing the target.
         std::fs::create_dir(path.with_extension("toml.bak")).unwrap();
-        assert!(
-            write_codex_config_at(&path, "https://new.example/v1", "fake-new-key", None).is_err()
-        );
+        assert!(write_codex_config_at(&path, "https://new.example/v1", None).is_err());
         assert_eq!(std::fs::read(&path).unwrap(), previous);
         let parsed = parse_codex_content(
             std::str::from_utf8(previous).unwrap(),
             "",
             true,
-            "unrelated-legacy-key".into(),
+            "test-env-key".into(),
             false,
             None,
         );
         assert_eq!(parsed.base_url, "https://old.example/");
-        assert_eq!(parsed.api_key, "fake-old-key");
+        assert_eq!(parsed.api_key, "test-env-key");
     }
 
     #[test]
@@ -618,6 +784,7 @@ base_url = "https://old.example/v1"
 env_key = "CUSTOM_OPENAI_API_KEY"
 env_key_instructions = "obsolete setup"
 requires_openai_auth = true
+experimental_bearer_token = "fake-token"
 auth = { command = "fake-command", args = ["unchanged elsewhere"] }
 http_headers = { Authorization = "fake-old-key", aUtHoRiZaTiOn = "fake-second-key", X-Trace = "keep" }
 env_http_headers = { AUTHORIZATION = "OLD_ENV", X-Meta = "KEEP_ENV" }
@@ -628,21 +795,16 @@ requires_openai_auth = true
 http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
 "#;
         let original = previous.parse::<DocumentMut>().unwrap();
-        let token = "fake-token-with-\"quotes\"-and-\\slashes";
-        let bytes = edited_codex_contents(
-            Some(previous.as_bytes()),
-            "https://new.example/v1",
-            token,
-            None,
-        )
-        .unwrap();
+        let bytes =
+            edited_codex_contents(Some(previous.as_bytes()), "https://new.example/v1", None)
+                .unwrap();
         let doc = std::str::from_utf8(&bytes)
             .unwrap()
             .parse::<DocumentMut>()
             .unwrap();
         let custom = custom_provider(&doc).unwrap();
         for name in [
-            "env_key",
+            "experimental_bearer_token",
             "env_key_instructions",
             "auth",
             "requires_openai_auth",
@@ -650,10 +812,8 @@ http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
             assert!(custom.get(name).is_none());
         }
         assert_eq!(
-            custom
-                .get("experimental_bearer_token")
-                .and_then(Item::as_str),
-            Some(token)
+            custom.get("env_key").and_then(Item::as_str),
+            Some(LEGACY_ENV_KEY)
         );
         for field in ["http_headers", "env_http_headers"] {
             assert!(!custom
@@ -684,13 +844,9 @@ http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
             r#"model_providers = { custom = { base_url = "https://old.example/v1", env_key = "OLD", requires_openai_auth = true, auth = { command = "fake" }, http_headers = { Authorization = "old", X-Keep = "yes" } }, other = { env_key = "OTHER" } }"#,
             r#"model_providers = { other = { env_key = "OTHER" } }"#,
         ] {
-            let bytes = edited_codex_contents(
-                Some(previous.as_bytes()),
-                "https://new.example/v1",
-                "fake-new-key",
-                None,
-            )
-            .unwrap();
+            let bytes =
+                edited_codex_contents(Some(previous.as_bytes()), "https://new.example/v1", None)
+                    .unwrap();
             let doc = std::str::from_utf8(&bytes)
                 .unwrap()
                 .parse::<DocumentMut>()
@@ -700,10 +856,12 @@ http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
                 Some("OTHER")
             );
             assert_eq!(
-                doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
-                Some("fake-new-key")
+                doc["model_providers"]["custom"]["env_key"].as_str(),
+                Some(LEGACY_ENV_KEY)
             );
-            assert!(doc["model_providers"]["custom"].get("env_key").is_none());
+            assert!(doc["model_providers"]["custom"]
+                .get("experimental_bearer_token")
+                .is_none());
             if previous.contains("X-Keep") {
                 assert_eq!(
                     doc["model_providers"]["custom"]["http_headers"]["X-Keep"].as_str(),
@@ -734,13 +892,8 @@ http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
             } else {
                 format!("[model_providers.custom]\nbase_url='https://old.example/v1'\n[model_providers.custom.http_headers]\n{}\n[model_providers.custom.env_http_headers]\n{}\n[model_providers.other.http_headers]\nCookie='fake-other-cookie'\n", assignments.join("\n"), assignments.join("\n"))
             };
-            let bytes = edited_codex_contents(
-                Some(raw.as_bytes()),
-                "https://new.example/v1",
-                "fake-new-key",
-                None,
-            )
-            .unwrap();
+            let bytes = edited_codex_contents(Some(raw.as_bytes()), "https://new.example/v1", None)
+                .unwrap();
             let doc = std::str::from_utf8(&bytes)
                 .unwrap()
                 .parse::<DocumentMut>()
@@ -769,13 +922,8 @@ http_headers = { Authorization = "fake-other-key", X-Other = "keep-other" }
 base_url = "https://new.example:443/v1"
 query_params = { api_key = "fake-old", key = "fake-old", token = "fake-old", access_token = "fake-old", auth = "fake-old", signature = "fake-old", region = "keep" }
 "#;
-        let bytes = edited_codex_contents(
-            Some(raw.as_bytes()),
-            "https://new.example/v1",
-            "fake-new-key",
-            None,
-        )
-        .unwrap();
+        let bytes =
+            edited_codex_contents(Some(raw.as_bytes()), "https://new.example/v1", None).unwrap();
         let doc = std::str::from_utf8(&bytes)
             .unwrap()
             .parse::<DocumentMut>()
@@ -797,17 +945,15 @@ query_params = { api_key = "fake-old", key = "fake-old", token = "fake-old", acc
     fn origin_change_requires_review_of_remaining_custom_query_parameters() {
         let directory = tempfile::tempdir().unwrap();
         let path = directory.path().join("config.toml");
-        let raw = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nexperimental_bearer_token='fake-old-key'\nquery_params={region='keep',api_key='fake-old-query-key'}";
+        let raw = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nenv_key='CUSTOM_OPENAI_API_KEY'\nquery_params={region='keep',api_key='fake-old-query-key'}";
         std::fs::write(&path, raw).unwrap();
-        let error = write_codex_config_at(&path, "https://new.example/v1", "fake-new-key", None)
-            .unwrap_err();
+        let error = write_codex_config_at(&path, "https://new.example/v1", None).unwrap_err();
         assert!(error.to_string().contains("query_params"));
         assert_eq!(std::fs::read_to_string(path).unwrap(), raw);
         let credential_only = "[model_providers.custom]\nbase_url='https://old.example/v1'\nquery_params={api_key='fake-old-query-key'}";
         let bytes = edited_codex_contents(
             Some(credential_only.as_bytes()),
             "https://new.example/v1",
-            "fake-new-key",
             None,
         )
         .unwrap();
@@ -836,10 +982,7 @@ query_params = { api_key = "fake-old", key = "fake-old", token = "fake-old", acc
             let directory = tempfile::tempdir().unwrap();
             let path = directory.path().join("config.toml");
             std::fs::write(&path, previous).unwrap();
-            assert!(
-                write_codex_config_at(&path, "https://new.example/v1", "fake-new-key", None)
-                    .is_err()
-            );
+            assert!(write_codex_config_at(&path, "https://new.example/v1", None).is_err());
             assert_eq!(std::fs::read_to_string(path).unwrap(), previous);
         }
     }
@@ -857,22 +1000,24 @@ query_params = { api_key = "fake-old", key = "fake-old", token = "fake-old", acc
         for content in [
             "[model_providers.other]\nenv_key='CUSTOM_OPENAI_API_KEY'",
             "[model_providers.custom]\nenv_key='AN_UNRELATED_SECRET'",
-            "[model_providers.custom]\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token=''",
-            "[model_providers.custom]\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token=42",
             "[invalid toml",
-            "",
         ] {
-            assert_eq!(legacy_key_for_content(content, |_| panic!("must not read an unrelated environment credential")).unwrap(), "");
+            assert_eq!(
+                legacy_key_for_content(content, |_| panic!(
+                    "must not read an unrelated environment credential"
+                ))
+                .unwrap(),
+                ""
+            );
         }
     }
 
     #[test]
-    fn explicit_empty_bearer_never_falls_back_to_old_global_key() {
-        let content = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://new.example/v1'\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token=''";
-        let parsed =
-            parse_codex_content(content, "", true, "fake-old-global-key".into(), false, None);
-        assert_eq!(parsed.base_url, "https://new.example/");
-        assert_eq!(parsed.api_key, "");
+    fn codex_only_uses_environment_variable_and_ignores_bearer_token() {
+        let content = "model_provider='custom'\n[model_providers.custom]\nbase_url='https://old.example/v1'\nenv_key='CUSTOM_OPENAI_API_KEY'\nexperimental_bearer_token='obsolete-bearer'";
+        let parsed = parse_codex_content(content, "", true, "valid-env-key".into(), false, None);
+        assert_eq!(parsed.base_url, "https://old.example/");
+        assert_eq!(parsed.api_key, "valid-env-key");
     }
 
     #[test]
@@ -897,19 +1042,14 @@ model_provider = "other"
 model = "other-model"
 [model_providers.custom]
 base_url = "https://old.example/v1"
-experimental_bearer_token = "fake-old-key"
+env_key = "CUSTOM_OPENAI_API_KEY"
 [model_providers.other]
 base_url = "https://other.example/v1"
 env_key = "OTHER_KEY"
 "#;
         std::fs::write(&path, previous).unwrap();
-        let error = write_codex_config_at(
-            &path,
-            "https://new.example/v1",
-            "fake-new-key",
-            Some("new-model"),
-        )
-        .unwrap_err();
+        let error =
+            write_codex_config_at(&path, "https://new.example/v1", Some("new-model")).unwrap_err();
         assert!(error.to_string().contains("profile"));
         assert_eq!(std::fs::read_to_string(&path).unwrap(), previous);
         assert_eq!(
@@ -938,7 +1078,6 @@ model = "unrelated-model"
         let bytes = edited_codex_contents(
             Some(previous.as_bytes()),
             "https://new.example/v1",
-            "fake-new-key",
             Some("new-model"),
         )
         .unwrap();
@@ -983,7 +1122,6 @@ model = "unrelated-model"
             assert!(edited_codex_contents(
                 Some(previous.as_bytes()),
                 "https://new.example/v1",
-                "fake-new-key",
                 Some("new-model")
             )
             .is_err());
@@ -991,9 +1129,10 @@ model = "unrelated-model"
     }
 
     #[test]
-    fn actual_set_codex_config_writes_one_private_pair_without_an_env_reference() {
-        let key = "fake-managed-codex-atomic-pair-key";
+    fn actual_set_codex_config_writes_env_key_and_updates_environment() {
+        let key = "fake-managed-codex-env-key";
         crate::credential_policy::register_managed_key(key);
+        let previous = read_registry_env(LEGACY_ENV_KEY).unwrap_or_default();
         set_codex_config(
             "https://bob-api.com/v1/".into(),
             key.into(),
@@ -1007,10 +1146,20 @@ model = "unrelated-model"
             Some("https://bob-api.com/v1")
         );
         assert_eq!(
-            doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
-            Some(key)
+            doc["model_providers"]["custom"]["env_key"].as_str(),
+            Some(LEGACY_ENV_KEY)
         );
-        assert!(doc["model_providers"]["custom"].get("env_key").is_none());
+        assert!(doc["model_providers"]["custom"]
+            .get("experimental_bearer_token")
+            .is_none());
+        assert_eq!(read_registry_env(LEGACY_ENV_KEY).unwrap(), key);
+
+        // Clean up
+        if previous.is_empty() {
+            let _ = delete_registry_env(LEGACY_ENV_KEY);
+        } else {
+            let _ = write_registry_env(LEGACY_ENV_KEY, &previous);
+        }
     }
 
     #[test]
@@ -1044,7 +1193,7 @@ model = "unrelated-model"
         assert!(cfg.config_exists);
         assert!(cfg.is_installed);
         assert_eq!(cfg.base_url, "");
-        assert_eq!(cfg.api_key, "");
+        assert_eq!(cfg.api_key, "test-key");
         assert_eq!(cfg.model, "");
     }
 
@@ -1107,8 +1256,7 @@ base_url = "https://api.openai.com/v1"
 
     #[test]
     fn test_prepare_codex_doc_with_model() {
-        let doc =
-            prepare_codex_doc("https://api.example.com/v1", "fake-direct-key", Some("o1")).unwrap();
+        let doc = prepare_codex_doc("https://api.example.com/v1", Some("o1")).unwrap();
         assert_eq!(doc["model"].as_str(), Some("o1"));
         assert_eq!(doc["model_provider"].as_str(), Some("custom"));
         assert_eq!(
@@ -1120,20 +1268,27 @@ base_url = "https://api.openai.com/v1"
             Some("openai-responses")
         );
         assert_eq!(
-            doc["model_providers"]["custom"]["experimental_bearer_token"].as_str(),
-            Some("fake-direct-key")
+            doc["model_providers"]["custom"]["env_key"].as_str(),
+            Some("CUSTOM_OPENAI_API_KEY")
         );
+        assert!(doc["model_providers"]["custom"]
+            .get("experimental_bearer_token")
+            .is_none());
     }
 
     #[test]
     fn test_prepare_codex_doc_without_model() {
-        let doc = prepare_codex_doc("https://api.example.com/v1", "fake-direct-key", None).unwrap();
+        let doc = prepare_codex_doc("https://api.example.com/v1", None).unwrap();
         assert!(doc.get("model").is_none());
         assert_eq!(doc["model_provider"].as_str(), Some("custom"));
         assert_eq!(
             doc["model_providers"]["custom"]["base_url"].as_str(),
             Some("https://api.example.com/v1")
         );
+        assert_eq!(
+            doc["model_providers"]["custom"]["env_key"].as_str(),
+            Some("CUSTOM_OPENAI_API_KEY")
+        );
     }
 
     #[test]
@@ -1152,13 +1307,7 @@ extra_flag = true
 "#
         .parse()
         .unwrap();
-        merge_codex_managed_fields(
-            &mut doc,
-            "https://bob-api.com/v1",
-            "fake-direct-key",
-            Some("new-model"),
-        )
-        .unwrap();
+        merge_codex_managed_fields(&mut doc, "https://bob-api.com/v1", Some("new-model")).unwrap();
         assert_eq!(doc["approval_policy"].as_str(), Some("untrusted"));
         assert_eq!(
             doc["model_providers"]["openai"]["name"].as_str(),
@@ -1168,6 +1317,10 @@ extra_flag = true
             doc["model_providers"]["custom"]["base_url"].as_str(),
             Some("https://bob-api.com/v1")
         );
+        assert_eq!(
+            doc["model_providers"]["custom"]["env_key"].as_str(),
+            Some("CUSTOM_OPENAI_API_KEY")
+        );
         assert_eq!(
             doc["model_providers"]["custom"]["extra_flag"].as_bool(),
             Some(true)
@@ -1183,17 +1336,15 @@ custom = { name = "Old", base_url = "https://old.example/v1", api = "openai-resp
 "#
         .parse()
         .unwrap();
-        merge_codex_managed_fields(
-            &mut doc,
-            "https://bob-api.com/v1",
-            "fake-direct-key",
-            Some("gpt-4o"),
-        )
-        .unwrap();
+        merge_codex_managed_fields(&mut doc, "https://bob-api.com/v1", Some("gpt-4o")).unwrap();
         assert_eq!(
             doc["model_providers"]["custom"]["base_url"].as_str(),
             Some("https://bob-api.com/v1")
         );
+        assert_eq!(
+            doc["model_providers"]["custom"]["env_key"].as_str(),
+            Some("CUSTOM_OPENAI_API_KEY")
+        );
         let parsed = parse_codex_content(&doc.to_string(), "", true, String::new(), false, None);
         assert_eq!(parsed.base_url, "https://bob-api.com/");
     }
diff --git a/src-tauri/src/safe_fs.rs b/src-tauri/src/safe_fs.rs
index 0b584601..c8b4132b 100644
--- a/src-tauri/src/safe_fs.rs
+++ b/src-tauri/src/safe_fs.rs
@@ -165,6 +165,33 @@ pub(crate) fn remove_file_locked(path: &Path) -> Result<(), AppError> {
     }
 }
 
+pub(crate) fn read_optional_locked(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
+    recover_missing_file_locked(path)?;
+    read_optional(path)
+}
+
+pub(crate) fn restore_optional_locked(
+    path: &Path,
+    previous: Option<&[u8]>,
+) -> Result<(), AppError> {
+    if let Some(contents) = previous {
+        atomic_write_locked(path, contents)
+    } else {
+        remove_file_locked(path)
+    }
+}
+
+pub(crate) fn replace_with_backup_locked(
+    path: &Path,
+    previous: Option<&[u8]>,
+    contents: &[u8],
+) -> Result<(), AppError> {
+    if let Some(previous) = previous {
+        atomic_write_locked(&backup_path(path), previous)?;
+    }
+    atomic_write_locked(path, contents)
+}
+
 pub fn atomic_write(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), AppError> {
     with_file_lock(path, || {
         recover_missing_file_locked(path)?;
diff --git a/src-tauri/src/secret_storage.rs b/src-tauri/src/secret_storage.rs
index 2557980f..8644a39a 100644
--- a/src-tauri/src/secret_storage.rs
+++ b/src-tauri/src/secret_storage.rs
@@ -175,11 +175,20 @@ fn invalid_credential() -> AppError {
 }
 
 fn unavailable() -> AppError {
-    AppError::Other("系统凭据保护服务不可用或拒绝访问；请解锁系统凭据库后重试".into())
+    #[cfg(target_os = "macos")]
+    let hint =
+        "系统钥匙串不可用或拒绝访问。请在系统设置-隐私与安全性中允许访问，或解锁钥匙串后重试";
+    #[cfg(target_os = "linux")]
+    let hint = "Secret Service 不可用或拒绝访问。请确认 gnome-keyring 或 KWallet 正在运行，或检查系统权限设置";
+    #[cfg(target_os = "windows")]
+    let hint = "系统凭据保护服务不可用或拒绝访问；请检查 Windows 凭据管理器状态";
+    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
+    let hint = "系统凭据保护服务不可用或拒绝访问；请重试";
+    AppError::Other(hint.into())
 }
 
-#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
-mod platform {
+#[cfg(any(target_os = "macos", target_os = "linux"))]
+mod native_keyring {
     use super::*;
     use std::sync::Mutex;
 
@@ -242,6 +251,9 @@ mod platform {
     }
 }
 
+#[cfg(all(not(test), any(target_os = "macos", target_os = "linux")))]
+use native_keyring as platform;
+
 #[cfg(all(target_os = "windows", not(test)))]
 use native_windows as platform;
 
@@ -772,3 +784,107 @@ mod tests {
         assert!(is_encrypted("enc:v1:historical"));
     }
 }
+
+#[cfg(any(target_os = "macos", target_os = "linux"))]
+struct NativeCleanup {
+    purpose: CredentialPurpose,
+    reference: String,
+}
+
+#[cfg(any(target_os = "macos", target_os = "linux"))]
+impl NativeCleanup {
+    fn new(purpose: CredentialPurpose, reference: String) -> Self {
+        Self { purpose, reference }
+    }
+}
+
+#[cfg(any(target_os = "macos", target_os = "linux"))]
+impl Drop for NativeCleanup {
+    fn drop(&mut self) {
+        let _ = native_keyring::delete(self.purpose, &self.reference);
+    }
+}
+
+// macOS Keychain 实机集成测试（需要显式运行）
+#[cfg(target_os = "macos")]
+#[test]
+#[ignore = "requires actual macOS Keychain access; run with: cargo test native_keychain -- --ignored --nocapture"]
+fn native_keychain_roundtrip_and_cleanup() {
+    use std::process::Command;
+
+    let reference = format!("{:064x}", std::process::id());
+    let payload = b"native-keychain-test-secret";
+    let _cleanup = NativeCleanup::new(CredentialPurpose::SessionId, reference.clone());
+    let _ = native_keyring::delete(CredentialPurpose::SessionId, &reference);
+
+    let token = native_keyring::protect(CredentialPurpose::SessionId, &reference, payload).unwrap();
+    assert_eq!(token, reference);
+
+    let service = format!(
+        "com.ai-helper.credentials.v2.{}",
+        CredentialPurpose::SessionId.label()
+    );
+    let verify = Command::new("security")
+        .args([
+            "find-generic-password",
+            "-s",
+            &service,
+            "-a",
+            &reference,
+            "-w",
+        ])
+        .output()
+        .expect("security command failed");
+    assert!(verify.status.success(), "Keychain entry not found");
+
+    let read_back = native_keyring::unprotect(CredentialPurpose::SessionId, &reference).unwrap();
+    assert_eq!(read_back, payload);
+
+    assert!(native_keyring::unprotect(CredentialPurpose::RefreshCookie, &reference).is_err());
+    drop(_cleanup);
+
+    let deleted = Command::new("security")
+        .args(["find-generic-password", "-s", &service, "-a", &reference])
+        .output()
+        .unwrap();
+    assert!(
+        !deleted.status.success(),
+        "Keychain entry should be deleted"
+    );
+
+    println!("✅ macOS Keychain integration test passed");
+}
+
+// Linux Secret Service 实机集成测试（需要显式运行）
+#[cfg(target_os = "linux")]
+#[test]
+#[ignore = "requires actual Secret Service; run with: cargo test native_secret_service -- --ignored --nocapture"]
+fn native_secret_service_roundtrip_and_cleanup() {
+    use std::process::Command;
+
+    let reference = format!("{:064x}", std::process::id());
+    let payload = b"native-secret-service-test";
+    let _cleanup = NativeCleanup::new(CredentialPurpose::SessionId, reference.clone());
+    let _ = native_keyring::delete(CredentialPurpose::SessionId, &reference);
+
+    let token = native_keyring::protect(CredentialPurpose::SessionId, &reference, payload).unwrap();
+    assert_eq!(token, reference);
+
+    let service = format!(
+        "com.ai-helper.credentials.v2.{}",
+        CredentialPurpose::SessionId.label()
+    );
+    let verify = Command::new("secret-tool")
+        .args(["lookup", "service", &service, "account", &reference])
+        .output()
+        .expect("secret-tool command failed");
+    assert!(verify.status.success(), "Secret Service entry not found");
+
+    let read_back = native_keyring::unprotect(CredentialPurpose::SessionId, &reference).unwrap();
+    assert_eq!(read_back, payload);
+
+    assert!(native_keyring::unprotect(CredentialPurpose::RefreshCookie, &reference).is_err());
+    drop(_cleanup);
+
+    println!("✅ Linux Secret Service integration test passed");
+}
diff --git a/src-tauri/src/workbuddy.rs b/src-tauri/src/workbuddy.rs
index 3f2fd37b..68858637 100644
--- a/src-tauri/src/workbuddy.rs
+++ b/src-tauri/src/workbuddy.rs
@@ -400,6 +400,21 @@ fn recover_transaction(
     Ok(())
 }
 
+fn remove_broken_symlink_locked(path: &std::path::Path) -> Result<(), AppError> {
+    let metadata = match std::fs::symlink_metadata(path) {
+        Ok(metadata) => metadata,
+        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
+        Err(error) => return Err(error.into()),
+    };
+    if metadata.file_type().is_symlink()
+        && matches!(std::fs::metadata(path), Err(ref e)
+            if e.kind() == std::io::ErrorKind::NotFound)
+    {
+        std::fs::remove_file(path)?;
+    }
+    Ok(())
+}
+
 fn with_workbuddy_transaction<T>(
     paths: &WorkbuddyPaths,
     operation: impl FnOnce(&[PathBuf]) -> Result<T, AppError>,
@@ -434,6 +449,7 @@ fn with_workbuddy_transaction<T>(
             }
             // Recovery must precede the read/merge snapshot, not the final write.
             for path in &active {
+                remove_broken_symlink_locked(path)?;
                 crate::safe_fs::recover_missing_file_locked(path)?;
             }
             operation(&active)
@@ -1600,3 +1616,136 @@ mod tests {
         }
     }
 }
+
+#[cfg(all(test, not(target_os = "windows")))]
+mod unix_filesystem_tests {
+    use super::*;
+    use std::os::unix::fs::PermissionsExt;
+
+    #[test]
+    fn symlink_to_readonly_mount_fails_gracefully() {
+        let directory = tempfile::tempdir().unwrap();
+        let readonly_target = directory.path().join("readonly_target");
+        let readonly_models = readonly_target.join("models.json");
+        std::fs::create_dir_all(&readonly_target).unwrap();
+        std::fs::write(&readonly_models, b"[]").unwrap();
+
+        // 模拟只读：设置文件和目录为只读
+        let mut perms = std::fs::metadata(&readonly_target).unwrap().permissions();
+        perms.set_mode(0o555); // r-xr-xr-x
+        std::fs::set_permissions(&readonly_target, perms).unwrap();
+
+        let symlink_dir = directory.path().join(".workbuddy");
+        std::fs::create_dir_all(&symlink_dir).unwrap();
+        let symlink_path = symlink_dir.join("models.json");
+        std::os::unix::fs::symlink(&readonly_models, &symlink_path).unwrap();
+
+        in_profile(directory.path(), || {
+            // 尝试写入应该失败并提供清晰错误（拒绝符号链接或只读权限错误）
+            let result = set_workbuddy_config(payload("test-readonly"));
+            assert!(result.is_err());
+            let error_msg = result.unwrap_err().to_string();
+            assert!(
+                error_msg.contains("符号链接")
+                    || error_msg.contains("Permission denied")
+                    || error_msg.contains("只读"),
+                "错误信息应说明符号链接或权限问题: {}",
+                error_msg
+            );
+        });
+
+        // 清理：恢复可写权限以便删除
+        let mut perms = std::fs::metadata(&readonly_target).unwrap().permissions();
+        perms.set_mode(0o755);
+        std::fs::set_permissions(&readonly_target, perms).unwrap();
+    }
+
+    #[test]
+    fn broken_symlink_is_treated_as_nonexistent() {
+        let directory = tempfile::tempdir().unwrap();
+        let config_dir = directory.path().join(".workbuddy");
+        std::fs::create_dir_all(&config_dir).unwrap();
+
+        let broken_symlink = config_dir.join("models.json");
+        let nonexistent_target = directory.path().join("deleted/models.json");
+        std::os::unix::fs::symlink(&nonexistent_target, &broken_symlink).unwrap();
+
+        in_profile(directory.path(), || {
+            // 损坏的符号链接应被自愈移除并视为不存在，允许创建新文件
+            let result = set_workbuddy_config(payload("test-new"));
+            assert!(result.is_ok(), "应该能创建新配置: {:?}", result);
+
+            // 验证实际创建了普通文件（而非符号链接）
+            let metadata = std::fs::symlink_metadata(&broken_symlink).unwrap();
+            assert!(
+                !metadata.file_type().is_symlink(),
+                "应创建普通文件而非符号链接"
+            );
+        });
+    }
+
+    #[test]
+    fn nested_symlink_parent_directories_follow_correctly() {
+        let directory = tempfile::tempdir().unwrap();
+        let actual_config = directory.path().join("actual_config");
+        std::fs::create_dir_all(&actual_config).unwrap();
+
+        let link_parent = directory.path().join(".workbuddy");
+        std::os::unix::fs::symlink(&actual_config, &link_parent).unwrap();
+
+        in_profile(directory.path(), || {
+            set_workbuddy_config(payload("test-symlink-parent")).unwrap();
+
+            // 验证文件实际写入到符号链接目录目标
+            let actual_file = actual_config.join("models.json");
+            assert!(actual_file.exists(), "应写入符号链接目标位置");
+
+            let content = std::fs::read_to_string(&actual_file).unwrap();
+            assert!(content.contains("test-symlink-parent"));
+        });
+    }
+
+    #[test]
+    fn concurrent_writers_with_file_locks_prevent_corruption() {
+        let directory = tempfile::tempdir().unwrap();
+        fixture(directory.path());
+        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
+
+        let handles: Vec<_> = (0..4)
+            .map(|index| {
+                let dir = directory.path().to_owned();
+                let b = barrier.clone();
+                std::thread::spawn(move || {
+                    b.wait();
+                    in_profile(&dir, || {
+                        let model_id = format!("concurrent-{}", index);
+                        set_workbuddy_config(payload(&model_id)).unwrap();
+                        let entries = read_all_workbuddy_entries().unwrap().0;
+                        assert!(
+                            entries.iter().any(|e| e.id == model_id),
+                            "写入的模型应可读取"
+                        );
+                    });
+                })
+            })
+            .collect();
+
+        for handle in handles {
+            handle.join().unwrap();
+        }
+
+        // 验证最终状态包含所有并发写入
+        in_profile(directory.path(), || {
+            let entries = read_all_workbuddy_entries().unwrap().0;
+            let ids: Vec<_> = entries.iter().map(|e| &e.id).collect();
+            for index in 0..4 {
+                let expected = format!("concurrent-{}", index);
+                assert!(
+                    ids.iter().any(|id| id.as_str() == expected),
+                    "并发写入的模型 {} 应存在于最终结果",
+                    expected
+                );
+            }
+        });
+    }
+}
diff --git a/src/App.tsx b/src/App.tsx
index 185a32f0..7422bccc 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -883,7 +883,7 @@ function AppContent() {
                     className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-white/10 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer relative shadow-2xs"
                     title={
                       wallet
-                        ? `账号原始平台额度: ${formatPlatformQuota(wallet.quota)} · 换算不可用 - 点击前往个人中心`
+                        ? `账号原始平台额度: ${formatPlatformQuota(wallet.quota)}\n换算不可用 - 展示服务端原始数据，不推测币值\n点击前往个人中心`
                         : "账号额度未知 - 点击前往个人中心刷新"
                     }
                   >
diff --git a/src/components/AccioWorkPanel.tsx b/src/components/AccioWorkPanel.tsx
index 129dfdc1..feccb551 100644
--- a/src/components/AccioWorkPanel.tsx
+++ b/src/components/AccioWorkPanel.tsx
@@ -433,9 +433,24 @@ export function AccioWorkPanel() {
                   placeholder="例如 dall-e-3"
                   className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-black dark:border-white/10 dark:bg-white/5 dark:text-white"
                 />
-                <p className="text-[11px] text-slate-500 dark:text-gray-400">
-                  生图还需要有效的次数预算；预算不可用时保持关闭。清空模型并保存即可关闭生图。
-                </p>
+                <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
+                  <div className="flex items-start gap-2">
+                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
+                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
+                    </svg>
+                    <div className="space-y-1">
+                      <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
+                        重要说明：本地预算限制
+                      </p>
+                      <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
+                        生图需要有效的<strong>本地次数预算</strong>。注意：本地预算仅限制请求次数，不能替代服务端账户额度硬限。服务端扣费仍以实际使用量为准。预算不可用时自动禁用生图功能。
+                      </p>
+                      <p className="text-[10px] text-amber-600 dark:text-amber-500">
+                        清空模型并保存即可关闭生图功能。
+                      </p>
+                    </div>
+                  </div>
+                </div>
               </div>
             </SpotlightCard>
 
diff --git a/src/components/AccountBalanceCard.tsx b/src/components/AccountBalanceCard.tsx
index ca2e185b..601f10d1 100644
--- a/src/components/AccountBalanceCard.tsx
+++ b/src/components/AccountBalanceCard.tsx
@@ -120,6 +120,9 @@ export const AccountBalanceCard: React.FC<AccountBalanceCardProps> = ({
           <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400 mt-1">
             平台额度 · {QUOTA_CONVERSION_UNAVAILABLE}
           </div>
+          <div className="text-[10px] text-slate-400 dark:text-gray-500 mt-1 leading-relaxed">
+            💡 无权威转换契约时显示原始额度，避免推测币值误导
+          </div>
           {walletError && <div className="text-[10px] text-amber-600 mt-1">余额未确认，请重试刷新</div>}
         </div>
 
diff --git a/src/components/ApiKeyInput.tsx b/src/components/ApiKeyInput.tsx
index 3089dad0..ce7b20ca 100644
--- a/src/components/ApiKeyInput.tsx
+++ b/src/components/ApiKeyInput.tsx
@@ -674,13 +674,13 @@ export function ApiKeyInput({
                 </span>
               ) : envVarName ? (
                 <span>
-                  写入当前用户系统环境变量{" "}
+                  Codex 将通过环境变量{" "}
                   <code
                     className="px-1 py-0.5 rounded font-mono text-[11px] font-medium bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-neutral-200/80 dark:border-neutral-800"
                   >
                     {envVarName}
                   </code>
-                  ，本地直连专线通信。
+                  {" "}读取，本地直连专线通信。
                 </span>
               ) : hintText ? (
                 <span>{hintText}</span>
diff --git a/src/components/ChatGPTPanel.tsx b/src/components/ChatGPTPanel.tsx
index 245cd439..f63bbe31 100644
--- a/src/components/ChatGPTPanel.tsx
+++ b/src/components/ChatGPTPanel.tsx
@@ -400,13 +400,12 @@ export function ChatGPTPanel() {
                 >
                   <ApiKeyInput
                     title="OpenAI API Key"
-                    badgeText="config.toml"
+                    badgeText="环境变量"
                     value={apiKey}
                     destinationUrl={url}
                     onChange={setApiKey}
                     placeholder="sk-... (填入 BobAPI 密钥)"
-                    storageLocation="~/.codex/config.toml"
-                    configKey="model_providers.custom.experimental_bearer_token"
+                    envVarName="CUSTOM_OPENAI_API_KEY"
                     toolName="ChatGPT (Codex)"
                     toolId="chatgpt"
                     onBoundTokenChange={onBoundTokenChange}
diff --git a/src/components/InitializationModal.tsx b/src/components/InitializationModal.tsx
index a03400e1..26b2c50b 100644
--- a/src/components/InitializationModal.tsx
+++ b/src/components/InitializationModal.tsx
@@ -2455,7 +2455,7 @@ export function InitializationModal({
                                     ? "models.json"
                                     : editTab === "acciowork"
                                       ? "accio_config.json"
-                                      : "config.toml"
+                                      : "环境变量"
                               }
                               value={editApiKey}
                               destinationUrl={editUrl}
@@ -2472,14 +2472,17 @@ export function InitializationModal({
                                       : "~/.workbuddy/models.json")
                                     : editTab === "acciowork"
                                       ? "~/.ai-helper/accio_config.json"
-                                      : "~/.codex/config.toml"
+                                      : undefined
                               }
                               configKey={
                                 editTab === "claude"
                                   ? "env.ANTHROPIC_AUTH_TOKEN"
-                                  : editTab === "chatgpt"
-                                    ? "model_providers.custom.experimental_bearer_token"
-                                    : undefined
+                                  : undefined
+                              }
+                              envVarName={
+                                editTab === "chatgpt"
+                                  ? "CUSTOM_OPENAI_API_KEY"
+                                  : undefined
                               }
                               accentColor={
                                 editTab === "claude"
diff --git a/src/components/TerminalTestModal.tsx b/src/components/TerminalTestModal.tsx
index 26fe38a4..bad7e1de 100644
--- a/src/components/TerminalTestModal.tsx
+++ b/src/components/TerminalTestModal.tsx
@@ -288,10 +288,10 @@ export function TerminalTestModal({
       if (testSuccess) {
         // 保存配置
         if (type === "codex") {
-          addLog(`💾 正在备份并更新 ~/.codex/config.toml 中的网关与对应密钥...`, "info");
+          addLog(`💾 正在备份并更新 ~/.codex/config.toml 与环境变量...`, "info");
           await setCodexConfig(url, apiKey.trim(), model.trim());
-          addLog(`✓ 网关与密钥已一起保存到私有配置文件 (旧配置已备份至 .bak)`, "success");
-          addLog(`✓ 已保留其他 provider、profile 与安全设置`, "success");
+          addLog(`✓ 配置文件 ~/.codex/config.toml 已更新 (旧配置已备份至 .bak)`, "success");
+          addLog(`✓ CUSTOM_OPENAI_API_KEY 已更新；独立终端的持久化方式取决于操作系统`, "success");
         } else if (type === "workbuddy") {
           addLog(
             `💾 正在将配置保存至本地 models.json (多模型拼接保存)...`,

`
