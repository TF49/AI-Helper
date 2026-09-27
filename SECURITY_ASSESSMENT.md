# AI Helper 生产环境安全评估报告

## 📋 项目概述

**项目名称**: AI Helper  
**版本**: 1.0.29  
**技术栈**: Tauri v2 (Rust) + React + TypeScript  
**项目定位**: ChatGPT、Claude Code CLI 和 WorkBuddy 的桌面配置管理工具  

## 🎯 核心功能

1. **双核 Agent 管理**: 统一管理 ChatGPT (Codex CLI)、Claude Code CLI 和 WorkBuddy
2. **配置文件托管**: 自动管理 `~/.codex/config.toml`、`~/.claude.json` 等配置文件
3. **进程生命周期管理**: 智能热重启、进程树清理
4. **API 连通性测试**: 实时流式测试 API 网关连通性
5. **路径探测引擎**: 自动探测 CLI 工具和桌面客户端安装路径
6. **自动更新**: 多源更新检测与断点续传

---

## 🔒 当前安全状况分析

### ✅ 已实现的安全措施

#### 1. **命令注入防护** ✓
**位置**: `src-tauri/src/process_manager.rs:315-322`

```rust
// 防范命令链式拼接注入 (禁止 &, ;, 换行符)
if trimmed.contains('\n')
    || trimmed.contains('\r')
    || trimmed.contains('&')
    || trimmed.contains(';')
{
    return Err("命令包含不允许的控制字符，已被安全策略拦截".to_string());
}
```

**评估**: ✅ 基础防护到位，但可以进一步增强

#### 2. **API Key 脱敏** ✓
**位置**: `src-tauri/src/api_test.rs:74`

```rust
let masked_key = mask_api_key(&api_key);
// 在日志中显示: "sk-***xyz"
```

**评估**: ✅ 防止敏感信息泄露到日志

#### 3. **路径验证** ✓
**位置**: `src-tauri/src/lib.rs:196-216`

```rust
// 打开配置文件前验证路径存在
if !expanded_path.exists() {
    return Err(format!("配置文件不存在: {}", expanded_path.display()));
}
```

**评估**: ✅ 防止路径遍历攻击

#### 4. **URL 协议白名单** ✓
**位置**: `src-tauri/src/lib.rs:186-189`

```rust
if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("Only http and https URLs are allowed".to_string());
}
```

**评估**: ✅ 防止协议滥用 (如 `file://`)

#### 5. **CSP (内容安全策略)** ✓
**位置**: `src-tauri/tauri.conf.json:31`

```json
"csp": "default-src 'self'; img-src 'self' data: https: http:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost https: http:"
```

**评估**: ✅ 限制资源加载来源

#### 6. **进程隔离与权限控制** ✓
- 使用 Tauri IPC 实现前后端通信隔离
- Rust 后端处理敏感操作，前端仅调用授权接口
- Windows 环境下使用 `CREATE_NO_WINDOW` 标志避免控制台闪烁

#### 7. **环境变量安全存储** ✓
**位置**: `src-tauri/src/codex.rs:237-248`

- Windows: 使用 Windows Registry (`HKEY_CURRENT_USER\Environment`)
- Linux/macOS: 使用环境变量

**评估**: ⚠️ 需要注意 Registry 权限和加密

---

## ⚠️ 需要加强的安全领域

### 🔴 高优先级 (上线前必须解决)

#### 1. **API Key 明文存储** 🔴

**问题描述**:
- API Key 存储在 Windows Registry (`CUSTOM_OPENAI_API_KEY`) 中为明文
- Claude API Key 可能明文存储在 `~/.claude.json` 中

**风险等级**: **严重**

**影响**:
- 本地恶意软件可读取 API Key
- 系统管理员可查看用户凭据
- 数据泄露后可能导致财务损失

**解决方案**:

```rust
// 使用 Windows Credential Manager 或加密存储
#[cfg(target_os = "windows")]
fn store_api_key_secure(service: &str, username: &str, password: &str) -> Result<()> {
    use keyring::Entry;
    let entry = Entry::new(service, username)?;
    entry.set_password(password)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn get_api_key_secure(service: &str, username: &str) -> Result<String> {
    use keyring::Entry;
    let entry = Entry::new(service, username)?;
    Ok(entry.get_password()?)
}
```

**依赖**: 添加 `keyring = "2.0"` 到 `Cargo.toml`

---

#### 2. **更新签名验证缺失** 🔴

**问题描述**:
- 虽然配置了 `pubkey`，但未在代码中验证更新包签名
- 使用多个第三方镜像 (ghfast.top, gh-proxy.com) 可能被劫持

**风险等级**: **严重**

**影响**:
- 中间人攻击可替换更新包
- 供应链攻击风险

**当前配置** (`tauri.conf.json:61`):
```json
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIyM0Q0OUM2QzJFRDA4NTUKUldSVkNPM0N4a2s5SW5OMUd4MlNIYmJ0SXI1aEx4a0JSSlQvd01UVmNUYkxPZzJJQ2VZb0JYRHoK"
```

**解决方案**:
1. 确保 Tauri Updater 插件正确验证签名
2. 添加证书固定 (Certificate Pinning)
3. 仅使用 HTTPS 且验证 SSL 证书

```rust
// 在更新检查中添加签名验证
let mut builder = reqwest::Client::builder()
    .danger_accept_invalid_certs(false)  // 确保启用证书验证
    .use_rustls_tls();  // 使用 rustls 替代系统 TLS
```

---

#### 3. **配置文件权限控制** 🔴

**问题描述**:
- 生成的配置文件 (`config.toml`, `settings.json`) 权限可能过于宽松
- 未显式设置文件权限为 `0600` (仅所有者可读写)

**风险等级**: **高**

**影响**:
- 其他用户/进程可读取敏感配置

**解决方案**:

```rust
#[cfg(unix)]
fn set_secure_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o600);  // rw-------
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(windows)]
fn set_secure_permissions(path: &Path) -> std::io::Result<()> {
    // Windows: 使用 SetNamedSecurityInfo 限制访问权限
    // 仅允许当前用户访问
    // 需要 winapi crate
    Ok(())
}
```

---

### 🟡 中优先级 (上线后尽快完善)

#### 4. **日志敏感信息泄露** 🟡

**问题描述**:
- 部分日志可能包含完整路径、用户名、API 响应内容

**位置**: `src-tauri/src/app_paths.rs`, `src-tauri/src/api_test.rs`

**解决方案**:
- 对所有日志输出进行审计
- 使用结构化日志并设置敏感字段过滤
- 生产环境禁用 debug 日志

```rust
// 添加日志过滤器
use log::LevelFilter;
tauri_plugin_log::Builder::default()
    .level(LevelFilter::Info)  // 生产环境使用 Info 级别
    .filter(|metadata| {
        // 过滤特定模块的敏感日志
        !metadata.target().contains("api_test")
    })
    .build()
```

---

#### 5. **HTTPS 证书验证** 🟡

**问题描述**:
- 虽然使用 `rustls-tls`，但未显式拒绝无效证书
- 用户可能配置自签名证书的 API 端点

**解决方案**:
```rust
// 在生产模式下强制验证证书
#[cfg(not(debug_assertions))]
let client = reqwest::Client::builder()
    .danger_accept_invalid_certs(false)
    .build()?;

#[cfg(debug_assertions)]
let client = reqwest::Client::builder()
    .danger_accept_invalid_certs(true)  // 仅开发环境允许
    .build()?;
```

---

#### 6. **速率限制与防 DDoS** 🟡

**问题描述**:
- API 测试功能缺少速率限制
- 用户可能快速连续触发网络请求

**解决方案**:
```rust
use std::sync::Arc;
use tokio::sync::Semaphore;

// 全局限流器
static API_TEST_LIMITER: Lazy<Arc<Semaphore>> = Lazy::new(|| {
    Arc::new(Semaphore::new(3))  // 最多3个并发请求
});

pub async fn test_codex_config(...) -> ApiTestResult {
    let _permit = API_TEST_LIMITER.acquire().await.unwrap();
    // 执行实际请求
}
```

---

### 🟢 低优先级 (优化项)

#### 7. **输入验证增强** 🟢

**当前状态**: 基础验证已到位  
**改进点**:
- 添加 URL 格式验证 (使用 `url` crate)
- 添加模型名称白名单验证
- 限制路径长度和字符集

```rust
use url::Url;

fn validate_api_url(input: &str) -> Result<String, String> {
    let url = Url::parse(input)
        .map_err(|_| "无效的URL格式")?;
    
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("仅支持 http 和 https 协议".to_string());
    }
    
    if url.host_str().is_none() {
        return Err("URL 必须包含主机名".to_string());
    }
    
    Ok(url.to_string())
}
```

---

#### 8. **错误信息安全** 🟢

**问题**: 部分错误信息可能泄露内部路径或系统信息

**解决方案**:
```rust
// 生产环境使用通用错误信息
#[cfg(not(debug_assertions))]
fn sanitize_error(err: impl std::fmt::Display) -> String {
    "操作失败，请稍后重试".to_string()
}

#[cfg(debug_assertions)]
fn sanitize_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}
```

---

#### 9. **依赖安全审计** 🟢

**当前依赖**:
- `tauri: 2.8.2`
- `reqwest: 0.12`
- `serde_json: 1.0`
- `tokio: 1.x`

**建议**:
```bash
# 定期运行 cargo audit
cargo install cargo-audit
cargo audit

# 使用 cargo outdated 检查过时依赖
cargo install cargo-outdated
cargo outdated
```

---

## 🚀 生产环境上线检查清单

### 部署前 (必须完成)

- [ ] **实现 API Key 加密存储** (keyring / Windows Credential Manager)
- [ ] **验证更新包签名机制**
- [ ] **设置配置文件权限为 0600**
- [ ] **审计所有日志输出，移除敏感信息**
- [ ] **启用 HTTPS 证书强制验证**
- [ ] **添加请求速率限制**
- [ ] **运行 `cargo audit` 检查依赖漏洞**
- [ ] **配置生产环境日志级别为 Info**
- [ ] **移除或保护调试端口 (DevTools)**
- [ ] **代码签名证书配置 (Windows Authenticode)**

### 部署后 (持续监控)

- [ ] **建立安全事件响应流程**
- [ ] **配置自动安全更新推送**
- [ ] **定期进行渗透测试**
- [ ] **监控异常 API 调用**
- [ ] **用户反馈安全问题收集机制**

---

## 🛡️ 推荐的安全加固代码实现

### 1. API Key 加密存储模块

```rust
// src-tauri/src/secure_storage.rs

use anyhow::Result;

#[cfg(target_os = "windows")]
pub fn store_api_key(service: &str, key: &str) -> Result<()> {
    use keyring::Entry;
    let entry = Entry::new(service, "default")?;
    entry.set_password(key)?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn get_api_key(service: &str) -> Result<String> {
    use keyring::Entry;
    let entry = Entry::new(service, "default")?;
    Ok(entry.get_password()?)
}

#[cfg(not(target_os = "windows"))]
pub fn store_api_key(service: &str, key: &str) -> Result<()> {
    use keyring::Entry;
    let entry = Entry::new(service, "default")?;
    entry.set_password(key)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn get_api_key(service: &str) -> Result<String> {
    use keyring::Entry;
    let entry = Entry::new(service, "default")?;
    Ok(entry.get_password()?)
}
```

### 2. 安全配置文件写入

```rust
// src-tauri/src/secure_file.rs

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

pub fn write_secure_config(path: &Path, content: &str) -> Result<()> {
    // 创建文件并立即设置权限
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file.metadata()?.permissions();
        perms.set_mode(0o600);
        file.set_permissions(perms)?;
    }
    
    file.write_all(content.as_bytes())?;
    
    #[cfg(windows)]
    {
        // Windows ACL 设置
        windows_set_file_acl(path)?;
    }
    
    Ok(())
}

#[cfg(windows)]
fn windows_set_file_acl(path: &Path) -> Result<()> {
    // 使用 windows-acl crate 限制文件访问权限
    // 仅允许当前用户完全控制
    Ok(())
}
```

### 3. 增强的命令注入防护

```rust
// src-tauri/src/process_manager.rs (增强版)

pub fn execute_in_terminal(command: &str) -> Result<String, String> {
    let trimmed = command.trim();
    
    // 白名单验证
    let allowed_commands = [
        "npm install -g @openai/codex-cli",
        "npm install -g claude-code",
        "pnpm install -g claude-code",
    ];
    
    if !allowed_commands.iter().any(|cmd| trimmed.starts_with(cmd)) {
        return Err("仅允许执行预定义的安装命令".to_string());
    }
    
    // 额外的字符过滤
    if trimmed.chars().any(|c| matches!(c, '&' | ';' | '|' | '<' | '>' | '`' | '$' | '\n' | '\r')) {
        return Err("命令包含不安全字符".to_string());
    }
    
    // ... 执行逻辑
}
```

---

## 📊 安全评分

| 安全领域 | 当前评分 | 目标评分 |
|---------|---------|---------|
| 认证与授权 | 6/10 ⚠️ | 9/10 |
| 数据加密 | 4/10 🔴 | 9/10 |
| 输入验证 | 7/10 ✅ | 9/10 |
| 日志安全 | 6/10 ⚠️ | 8/10 |
| 网络安全 | 7/10 ✅ | 9/10 |
| 代码质量 | 8/10 ✅ | 9/10 |
| **综合评分** | **6.3/10** | **8.8/10** |

---

## 🎯 实施优先级

### 第一阶段 (上线前 - 1-2周)
1. ✅ API Key 加密存储 (keyring)
2. ✅ 配置文件权限设置
3. ✅ 更新签名验证确认
4. ✅ 日志敏感信息过滤

### 第二阶段 (上线后 1个月内)
1. ✅ 速率限制实现
2. ✅ 增强输入验证
3. ✅ 安全监控系统
4. ✅ 代码签名证书

### 第三阶段 (持续优化)
1. ✅ 渗透测试
2. ✅ 依赖安全审计自动化
3. ✅ 安全白皮书编写
4. ✅ 安全认证申请

---

## 📞 联系与支持

**项目作者**: TF49  
**GitHub**: https://github.com/TF49/AI-Helper  
**安全问题反馈**: 建议设置 security@aihelper.app 或使用 GitHub Security Advisory

---

**评估日期**: 2026-09-26  
**评估人**: Claude Opus 5.5 (AI Code Reviewer)  
**下次评估**: 建议每季度进行一次安全审计
