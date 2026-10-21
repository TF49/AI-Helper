# 本轮修复的独立复核记录

日期：2026-10-21。对象：当前工作区相对 `5eb886f6` 的安全修复。复核时交换了原实现者的检查范围，并使用反例验证实际调用链。

**复核确实发现了初次修复遗漏，已继续修正。最终检查范围内未再发现确定的阻断问题；完整安全结项仍保留现有存储、服务端和实机依赖，不能把本记录理解为所有平台及场景均无缺陷的保证。**

## 发现并修复

| 问题 | 复现及影响 | 修复 |
| --- | --- | --- |
| 当前工具绑定被初始化清除 | 工具绑定 A、全局最近选择 B，首次挂载后改组默认选 B | 同身份挂载/StrictMode 保留绑定；按当前配置 Key 精确验证；无匹配时要求明确选择，不默选另一把 Key |
| 真实绑定 Hook 漏会话隔离 | A 的列表/明文请求在 B 登录后回填旧分组和绑定缓存；原组件 mock 未执行该 Hook | `useBoundTokenGroup` 校验账号、会话、输入和请求；事件先于重渲染也立即失效；新增真实 Hook 宿主回归 |
| 确认目标的旧按钮可授权新输入 | 保留 A 的确认回调，切到 B 且 B 状态已返回，再调用旧回调会给 B 授权 | 回调捕获并使用实际展示的授权快照；输入变化即拒绝旧回调，不能从最新 ref 偷换授权目标 |
| Unix 提交后失败被当成未提交 | rename 已成功，随后打开/同步目录失败；Codex 回滚旧 Key 却保留新 URL | 提前打开父目录；同步失败保留明确的“已提交但未确认耐久性”状态与精确目标路径；主文件已提交时不回滚 Key，预算仍接收失败结果并阻断请求 |
| 读取旧凭据失败被当成不存在 | Registry 读取拒绝或类型错误被 `.ok()` / 默认空串掩盖，可能无法正确回滚 | 仅 NotFound 视为缺值；读取错误阻止变更，删除与回滚错误显式上报 |
| 旧版/错误架构 DMG 可被重新标名签署 | 缺目标目录时回退到通用目录并取首个 DMG，可把旧 ARM 包签为新 x64 版本 | 取消回退与模糊筛选，精确定位版本/架构；复制后只读挂载实际 DMG，校验 Info.plist 产品/版本及真实 Mach-O 架构，再分发签名 |
| DMG-only 构建被错误要求提供 tar 包 | 锁定 CLI 的 `--bundles dmg` 路径不生成先前要求的 tar 更新产物 | 自定义更新流程统一仅使用 DMG 与签名，移除无关 tar 的强制要求和相同版本/架构的残留输出 |
| 触发 tag 未绑定实际版本 | workflow 从 package.json 重算 tag，错误推送另一个 tag 仍可能尝试发布包版本 | Windows/macOS 打包和最终清单在 tag 触发时严格比较 `GITHUB_REF_NAME`；手动分支构建仍按明确版本执行 |

DMG 命名和 DMG-only 行为已核对锁定的 [Tauri DMG 实现](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.8.0/crates/tauri-bundler/src/bundle/macos/dmg/mod.rs)及[构建调度/清理实现](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v2.8.0/crates/tauri-bundler/src/bundle.rs)。实际 macOS 挂载与安装仍需实机验证。

## 最终验证

| 范围 | 实际结果 |
| --- | --- |
| Windows Rust 库 | 155 通过、0 失败，2 个子进程辅助入口由父测试调用 |
| 真实 Unix 文件模块 | WSL Linux musl / Rust 1.99.1 独立测试 7 通过、0 失败，1 个辅助入口由父测试调用 |
| 前端源码及真实 Hook 隔离回归 | 55 项通过 |
| TypeScript | `tsc --noEmit` 通过 |
| 前端生产构建 | Vite 构建通过，保留既有体积/浏览器数据提示 |
| Rust 格式与 Clippy | 通过，Clippy 使用 `-D warnings` |
| 发布资产回归 | 通过，覆盖 DMG-only、实际应用元数据模拟、错误版本/架构/tag、挂载/卸载及签名失败、最终哈希 |
| 锁文件及差异检查 | Cargo.lock / pnpm-lock.yaml 未变，`git diff --check` 通过 |

Unix 验证直接编译当前 `error.rs`、`safe_fs.rs` 和实际 Claude 合并函数，使用独立的本机测试环境，不是 macOS 整个 Tauri 应用构建。目录权限顺序还在非特权 Linux UID 下独立确认：旧顺序可能提交后报错，新顺序会在 rename 前拒绝不可读父目录。

前端回归转译真实 TS/TSX，执行真实绑定 Hook，并模拟 hooks 调度、IPC、剪贴板和存储；包含挂载效果重建及新输入已渲染但 passive effect 尚未运行的场景，不等同真实 React DOM/浏览器验收。发布测试使用假 DMG 与模拟 hdiutil/plutil/lipo/签名器，没有挂载用户实际镜像、使用生产密钥或发布资产。

本次未发送真实登录/计费请求，未修改个人实际凭据或注册表，未自动 commit/push。当前未完成事项仍见 [整改结论](../安全审计修改结论.md) 和 [任务跟踪](TASK_TRACKER.md)，包括用户凭据库、外部服务端证据及 macOS 实机升级。
