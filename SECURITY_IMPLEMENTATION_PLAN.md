# AI Helper 安全加固实施方案

## 📋 执行摘要

本文档提供了 AI Helper 项目上线到生产环境前必须完成的安全加固详细实施步骤。

---

## 🔴 关键安全修复 (上线前必须完成)

### 1️⃣ API Key 加密存储

#### 当前问题
```rust
// 当前: 明文存储在 Windows Registry
fn write_registry_env(name: &str, value: &str) -> Result<(), AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (env, _) = hkcu.create_subkey("Environment")?;
    env.set_value(name, &value.to_string())?;  // ❌ 明文存储
    Ok(())
}
```

#### 解决方案

**步骤 1**: 添加 keyring 依赖

```toml
# src-tauri/Cargo.toml
[dependencies]
keyring = "2.3"
```

**步骤 2**: 创建安全存储模块

```rust
// src-tauri/src/secure_storage.rs

use anyhow::{Result, Context};
use keyring::Entry;

const SERVICE_NAME_OPENAI: &str = "AI-Helper-OpenAI";
const SERVICE_NAME_ANTHROPIC: &str = "AI-Helper-Anthropic";
const SERVICE_NAME_WORKBUDDY: &str = "AI-Helper-Workbuddy";

pub fn store_openai_key(api_key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME_OPENAI, "api_key")
        .context("无法创建 keyring entry")?;
    entry.set_password(api_key)
        .context("无法保存 API Key 到系统密钥环")?;
    Ok(())
}

pub fn get_openai_key() -> Result<String> {
    let entry = Entry::new(SERVICE_NAME_OPENAI, "api_key")
        .context("无法访问 keyring entry")?;
    entry.get_password()
        .context("无法从系统密钥环读取 API Key")
}

pub fn delete_openai_key() -> Result<()> {
    let entry = Entry::new(SERVICE_NAME_OPENAI, "api_key")?;
    entry.delete_password()
        .context("无法删除 API Key")
}

pub fn store_anthropic_key(api_key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME_ANTHROPIC, "api_key")?;
    entry.set_password(api_key)?;
    Ok(())
}

pub fn get_anthropic_key() -> Result<String> {
    let entry = Entry::new(SERVICE_NAME_ANTHROPIC, "api_key")?;
    entry.get_password()
        .context("无法从系统密钥环读取 API Key")
}

pub fn delete_anthropic_key() -> Result<()> {
    let entry = Entry::new(SERVICE_NAME_ANTHROPIC, "api_key")?;
    entry.delete_password()?;
    Ok(())
}

pub fn store_workbuddy_key(api_key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME_WORKBUDDY, "api_key")?;
    entry.set_password(api_key)?;
    Ok(())
}

pub fn get_workbuddy_key() -> Result<String> {
    let entry = Entry::new(SERVICE_NAME_WORKBUDDY, "api_key")?;
    entry.get_password()
        .context("无法从系统密钥环读取 API Key")
}

pub fn delete_workbuddy_key() -> Result<()> {
    let entry = Entry::new(SERVICE_NAME_WORKBUDDY, "api_key")?;
    entry.delete_password()?;
    Ok(())
}

/// 数据迁移: 从旧的 Registry 存储迁移到 keyring
#[cfg(target_os = "windows")]
pub fn migrate_from_registry() -> Result<()> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(env) = hkcu.open_subkey("Environment") {
        // 迁移 OpenAI Key
        if let Ok(old_key) = env.get_value::<String, _>("CUSTOM_OPENAI_API_KEY") {
            if !old_key.is_empty() {
                store_openai_key(&old_key)?;
                // 迁移成功后删除旧的 Registry 值
                let _ = env.delete_value("CUSTOM_OPENAI_API_KEY");
                log::info!("已将 OpenAI API Key 从 Registry 迁移至系统密钥环");
            }
        }
    }
    Ok(())
}
```

**步骤 3**: 修改 `codex.rs` 使用安全存储

```rust
// src-tauri/src/codex.rs

use crate::secure_storage;

pub fn get_codex_config() -> Result<CodexConfig, AppError> {
    // ... 现有代码 ...
    
    // ✅ 从 keyring 读取而非 Registry
    let api_key = secure_storage::get_openai_key()
        .unwrap_or_default();
    
    Ok(parse_codex_content(
        &content,
        &config_path,
        config_exists,
        api_key,
        is_installed,
        app_path,
    ))
}

pub fn set_codex_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    let path = codex_config_path()?;
    let normalized = url.trim_end_matches('/');
    let base_url = format!("{}/v1", normalized);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let existing_content = if path.exists() {
        Some(std::fs::read_to_string(&path)?)
    } else {
        None
    };

    let doc = prepare_codex_doc(existing_content.as_deref(), &base_url, model.as_deref());

    std::fs::write(&path, doc.to_string())?;
    
    // ✅ 使用 keyring 存储而非 Registry
    secure_storage::store_openai_key(&api_key)
        .map_err(|e| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("无法保存 API Key: {}", e)
        )))?;
    
    Ok(())
}

// ❌ 移除这些不安全的函数
// fn read_registry_env(name: &str) -> Result<String, AppError>
// fn write_registry_env(name: &str, value: &str) -> Result<(), AppError>
```

**步骤 4**: 在应用启动时执行数据迁移

```rust
// src-tauri/src/lib.rs

pub fn run() {
    // ✅ 启动时自动迁移旧数据
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = crate::secure_storage::migrate_from_registry() {
            log::warn!("API Key 迁移失败 (可能已经迁移过): {}", e);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        // ... 其余代码 ...
}
```

**预计工作量**: 4-6 小时  
**测试重点**: Windows Credential Manager、macOS Keychain、Linux Secret Service

---

### 2️⃣ 配置文件权限加固

#### 解决方案

**步骤 1**: 创建安全文件写入模块

```rust
// src-tauri/src/secure_file.rs

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use anyhow::{Result, Context};

pub fn write_secure_config(path: &Path, content: &str) -> Result<()> {
    // 创建父目录
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .context("无法创建配置目录")?;
    }

    // 创建文件
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .context("无法创建配置文件")?;

    // Unix: 设置权限为 0600 (rw-------)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file.metadata()?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(path, perms)
            .context("无法设置文件权限")?;
    }

    // 写入内容
    file.write_all(content.as_bytes())
        .context("无法写入配置内容")?;

    // Windows: 使用 ACL 限制访问
    #[cfg(windows)]
    {
        set_windows_file_security(path)?;
    }

    Ok(())
}

#[cfg(windows)]
fn set_windows_file_security(path: &Path) -> Result<()> {
    use std::os::windows::io::AsRawHandle;
    use std::ptr;
    use winapi::um::aclapi::SetNamedSecurityInfoW;
    use winapi::um::winnt::{
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
        SE_FILE_OBJECT,
    };

    let path_wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    unsafe {
        // 设置文件 ACL: 仅当前用户可访问
        let result = SetNamedSecurityInfoW(
            path_wide.as_ptr() as *mut _,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
        );

        if result != 0 {
            log::warn!("无法设置 Windows 文件安全属性: {}", result);
        }
    }

    Ok(())
}

pub fn read_secure_config(path: &Path) -> Result<String> {
    // 验证文件权限
    verify_file_permissions(path)?;

    std::fs::read_to_string(path)
        .context("无法读取配置文件")
}

#[cfg(unix)]
fn verify_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    
    let metadata = std::fs::metadata(path)
        .context("无法读取文件元数据")?;
    let perms = metadata.permissions();
    let mode = perms.mode();

    // 检查权限是否安全 (应该是 0600 或 0400)
    if (mode & 0o077) != 0 {
        log::warn!(
            "配置文件权限不安全: {:o} (应为 0600), 路径: {}",
            mode,
            path.display()
        );
    }

    Ok(())
}

#[cfg(windows)]
fn verify_file_permissions(_path: &Path) -> Result<()> {
    // Windows ACL 验证较复杂，这里简化处理
    Ok(())
}
```

**步骤 2**: 修改配置写入函数

```rust
// src-tauri/src/codex.rs

use crate::secure_file;

pub fn set_codex_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    let path = codex_config_path()?;
    let normalized = url.trim_end_matches('/');
    let base_url = format!("{}/v1", normalized);

    let existing_content = if path.exists() {
        Some(secure_file::read_secure_config(&path)?)  // ✅ 使用安全读取
    } else {
        None
    };

    let doc = prepare_codex_doc(existing_content.as_deref(), &base_url, model.as_deref());

    // ✅ 使用安全写入 (自动设置权限)
    secure_file::write_secure_config(&path, &doc.to_string())
        .map_err(|e| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("写入配置失败: {}", e)
        )))?;
    
    secure_storage::store_openai_key(&api_key)
        .map_err(|e| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("保存 API Key 失败: {}", e)
        )))?;
    
    Ok(())
}
```

**步骤 3**: 添加 Windows 依赖

```toml
# src-tauri/Cargo.toml

[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"
winapi = { version = "0.3", features = ["aclapi", "winnt", "winerror"] }
```

**预计工作量**: 3-4 小时  
**测试重点**: 文件权限正确性、跨平台兼容性

---

### 3️⃣ 日志敏感信息过滤

#### 解决方案

**步骤 1**: 创建日志过滤器

```rust
// src-tauri/src/log_filter.rs

use regex::Regex;
use std::sync::LazyLock;

static API_KEY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(sk-[a-zA-Z0-9]{20,}|Bearer [a-zA-Z0-9_\-\.]+)").unwrap()
});

static PATH_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(C:\\Users\\[^\\]+\\|/home/[^/]+/|/Users/[^/]+/)").unwrap()
});

pub fn sanitize_log_message(msg: &str) -> String {
    let mut sanitized = msg.to_string();
    
    // 脱敏 API Key
    sanitized = API_KEY_REGEX
        .replace_all(&sanitized, |caps: &regex::Captures| {
            let matched = &caps[0];
            if matched.starts_with("sk-") {
                format!("sk-***{}", &matched[matched.len().saturating_sub(4)..])
            } else if matched.starts_with("Bearer ") {
                "Bearer ***".to_string()
            } else {
                "***".to_string()
            }
        })
        .to_string();
    
    // 脱敏用户路径
    sanitized = PATH_REGEX
        .replace_all(&sanitized, |_: &regex::Captures| "~/" )
        .to_string();
    
    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_api_key() {
        let input = "API Key: sk-1234567890abcdefghij";
        let output = sanitize_log_message(input);
        assert_eq!(output, "API Key: sk-***ghij");
    }

    #[test]
    fn test_sanitize_path() {
        let input = "Config at C:\\Users\\John\\config.toml";
        let output = sanitize_log_message(input);
        assert_eq!(output, "Config at ~/config.toml");
    }
}
```

**步骤 2**: 集成到日志系统

```rust
// src-tauri/src/lib.rs

mod log_filter;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info  // ✅ 生产环境仅 Info
                })
                .format(move |out, message, record| {
                    // ✅ 在写入前过滤敏感信息
                    let sanitized = log_filter::sanitize_log_message(
                        &message.to_string()
                    );
                    out.finish(format_args!(
                        "[{}][] {}",
                        record.level(),
                        record.target(),
                        sanitized
                    ))
                })
                .build()
        )
        // ... 其余代码 ...
}
```

**步骤 3**: 添加依赖

```toml
# src-tauri/Cargo.toml
[dependencies]
regex = "1.10"
```

**预计工作量**: 2-3 小时  
**测试重点**: API Key 脱敏、路径脱敏、性能影响

---

### 4️⃣ 更新包签名验证

#### 当前配置检查

```json
// src-tauri/tauri.conf.json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIyM0Q0OUM2QzJFRDA4NTUKUldSVkNPM0N4a2s5SW5OMUd4MlNIYmJ0SXI1aEx4a0JSSlQvd01UVmNUYkxPZzJJQ2VZb0JYRHoK",
      "endpoints": [...]
    }
  }
}
```

#### 验证步骤

**步骤 1**: 确认私钥安全存储

```bash
# 检查 updater.key 是否已加入 .gitignore
grep "updater.key" .gitignore

# 确保私钥仅存在于本地和 CI/CD Secrets 中
# GitHub Secrets: TAURI_PRIVATE_KEY
```

**步骤 2**: 验证 Tauri Updater 签名流程

```rust
// Tauri 2.x 已内置签名验证，确保配置正确
// 无需额外代码，但需要确保:
// 1. pubkey 正确配置
// 2. 发布时使用 tauri-cli 签名: tauri build --config src-tauri/tauri.conf.json
```

**步骤 3**: 增强 HTTPS 验证

```rust
// src-tauri/src/updater.rs

async fn create_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(format!("AI-Helper/{}", CURRENT_VERSION))
        .timeout(REQUEST_TIMEOUT);

    // ✅ 强制证书验证 (生产环境)
    #[cfg(not(debug_assertions))]
    {
        builder = builder
            .danger_accept_invalid_certs(false)  // 拒绝无效证书
            .use_rustls_tls();  // 使用 rustls 而非系统 TLS
    }

    #[cfg(debug_assertions)]
    {
        builder = builder.use_rustls_tls();
    }

    if let Some(proxy_url) = get_upstream_proxy_url() {
        log::info!("Update checker using upstream proxy: {}", proxy_url);
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}
```

**预计工作量**: 1-2 小时  
**测试重点**: 签名验证流程、中间人攻击防护

---

## 🟡 中优先级加固 (上线后一个月内)

### 5️⃣ API 请求速率限制

```rust
// src-tauri/src/rate_limiter.rs

use std::sync::Arc;
use tokio::sync::Semaphore;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct RateLimiter {
    semaphore: Arc<Semaphore>,
    last_request: Arc<Mutex<Instant>>,
    min_interval: Duration,
}

impl RateLimiter {
    pub fn new(max_concurrent: usize, min_interval_ms: u64) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            last_request: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10))),
            min_interval: Duration::from_millis(min_interval_ms),
        }
    }

    pub async fn acquire(&self) -> RateLimitGuard {
        let permit = self.semaphore.clone().acquire_owned().await.unwrap();
        
        let mut last = self.last_request.lock().await;
        let elapsed = last.elapsed();
        if elapsed < self.min_interval {
            let wait_time = self.min_interval - elapsed;
            tokio::time::sleep(wait_time).await;
        }
        *last = Instant::now();
        drop(last);

        RateLimitGuard { _permit: permit }
    }
}

pub struct RateLimitGuard {
    _permit: tokio::sync::OwnedSemaphorePermit,
}

// 全局限流器
use std::sync::LazyLock;

static API_TEST_LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| {
    RateLimiter::new(3, 500)  // 最多3并发,每次间隔500ms
});

// 在 api_test.rs 中使用
pub async fn test_codex_stream(...) -> ApiTestResult {
    let _guard = API_TEST_LIMITER.acquire().await;
    // 执行实际请求
    // ...
}
```

**预计工作量**: 2-3 小时

---

### 6️⃣ 输入验证增强

```rust
// src-tauri/src/input_validator.rs

use url::Url;
use anyhow::{Result, bail};

const MAX_URL_LENGTH: usize = 2048;
const MAX_API_KEY_LENGTH: usize = 512;
const MAX_MODEL_NAME_LENGTH: usize = 128;

pub fn validate_api_url(input: &str) -> Result<String> {
    let trimmed = input.trim();
    
    if trimmed.is_empty() {
        bail!("URL 不能为空");
    }
    
    if trimmed.len() > MAX_URL_LENGTH {
        bail!("URL 长度超出限制");
    }
    
    let url = Url::parse(trimmed)
        .map_err(|_| anyhow::anyhow!("无效的 URL 格式"))?;
    
    if url.scheme() != "http" && url.scheme() != "https" {
        bail!("仅支持 http 和 https 协议");
    }
    
    if url.host_str().is_none() {
        bail!("URL 必须包含主机名");
    }
    
    // 防止内网地址
    if let Some(host) = url.host_str() {
        if host == "localhost" 
            || host.starts_with("127.") 
            || host.starts_with("192.168.")
            || host.starts_with("10.")
            || host == "0.0.0.0" {
            bail!("不允许使用内网地址");
        }
    }
    
    Ok(url.to_string())
}

pub fn validate_api_key(key: &str) -> Result<()> {
    let trimmed = key.trim();
    
    if trimmed.is_empty() {
        bail!("API Key 不能为空");
    }
    
    if trimmed.len() > MAX_API_KEY_LENGTH {
        bail!("API Key 长度异常");
    }
    
    // 检查可疑字符
    if trimmed.contains('\0') || trimmed.contains('\n') || trimmed.contains('\r') {
        bail!("API Key 包含非法字符");
    }
    
    Ok(())
}

pub fn validate_model_name(model: &str) -> Result<()> {
    let trimmed = model.trim();
    
    if trimmed.is_empty() {
        bail!("模型名称不能为空");
    }
    
    if trimmed.len() > MAX_MODEL_NAME_LENGTH {
        bail!("模型名称过长");
    }
    
    // 仅允许字母、数字、连字符、点和下划线
    if !trimmed.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.' || c == '_') {
        bail!("模型名称包含非法字符");
    }
    
    Ok(())
}
```

**集成到现有代码**:

```rust
// src-tauri/src/codex.rs

use crate::input_validator;

pub fn set_codex_config(
    url: String,
    api_key: String,
    model: Option<String>,
) -> Result<(), AppError> {
    // ✅ 验证输入
    let validated_url = input_validator::validate_api_url(&url)
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    
    input_validator::validate_api_key(&api_key)
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    
    if let Some(ref m) = model {
        input_validator::validate_model_name(m)
            .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    }
    
    // 继续原有逻辑...
}
```

**预计工作量**: 3-4 小时

---

## 📦 必要的 Cargo 依赖更新

```toml
# src-tauri/Cargo.toml

[dependencies]
# 现有依赖...

# 安全加固新增依赖
keyring = "2.3"                    # API Key 加密存储
regex = "1.10"                     # 日志过滤
url = "2.5"                        # URL 验证
anyhow = "1.0"                     # 现有

[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"                    # 现有
winapi = { version = "0.3", features = ["aclapi", "winnt", "winerror"] }
```

---

## ✅ 测试计划

### 单元测试

```rust
// src-tauri/src/secure_storage.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve_key() {
        let test_key = "sk-test1234567890";
        store_openai_key(test_key).unwrap();
        let retrieved = get_openai_key().unwrap();
        assert_eq!(retrieved, test_key);
        delete_openai_key().unwrap();
    }
}
```

### 集成测试

1. **API Key 存储测试**
   - 存储 -> 读取 -> 验证
   - 删除 -> 确认不可读取
   - 跨平台测试 (Windows/macOS/Linux)

2. **文件权限测试**
   - 创建配置文件
   - 验证权限为 0600 (Unix)
   - 验证 ACL 正确性 (Windows)

3. **日志过滤测试**
   - 测试 API Key 脱敏
   - 测试路径脱敏
   - 性能压力测试

4. **更新签名测试**
   - 模拟签名有效的更新包
   - 模拟签名无效的更新包
   - 验证拒绝行为

---

## 📅 实施时间表

| 阶段 | 任务 | 工作量 | 负责人 | 截止日期 |
|-----|------|--------|--------|---------|
| 第一周 | API Key 加密存储 | 6h | 后端开发 | Day 3 |
| 第一周 | 配置文件权限加固 | 4h | 后端开发 | Day 4 |
| 第一周 | 日志敏感信息过滤 | 3h | 后端开发 | Day 5 |
| 第一周 | 更新签名验证确认 | 2h | DevOps | Day 5 |
| 第二周 | 单元测试编写 | 6h | 测试工程师 | Day 8 |
| 第二周 | 集成测试 | 8h | 测试工程师 | Day 10 |
| 第二周 | 跨平台测试 | 6h | QA | Day 12 |
| 第三周 | API 速率限制 | 3h | 后端开发 | Day 15 |
| 第三周 | 输入验证增强 | 4h | 后端开发 | Day 17 |
| 第三周 | 最终安全审计 | 4h | 安全工程师 | Day 19 |

**总计工作量**: ~46 小时  
**建议团队规模**: 2-3 人  
**上线目标**: 3 周后

---

## 🔍 上线前验收清单

### 代码审查
- [ ] 所有 `unwrap()` 已替换为安全的错误处理
- [ ] 无 `todo!()` 或 `unimplemented!()` 标记
- [ ] 所有日志输出已过滤敏感信息
- [ ] API Key 存储使用 keyring
- [ ] 配置文件权限正确设置

### 安全测试
- [ ] 运行 `cargo audit` 无高危漏洞
- [ ] 运行 `cargo clippy` 无安全警告
- [ ] SAST 扫描通过
- [ ] 依赖项无已知CVE

### 功能测试
- [ ] Windows 10/11 测试通过
- [ ] macOS 测试通过 (如支持)
- [ ] Linux 测试通过 (如支持)
- [ ] 旧数据迁移正常
- [ ] 更新功能正常

### 文档
- [ ] 安全白皮书完成
- [ ] 用户隐私政策更新
- [ ] 安全事件响应流程文档
- [ ] 部署文档更新

---

## 📞 联系与支持

**安全问题反馈**: security@aihelper.app  
**技术支持**: support@aihelper.app  
**紧急联系**: [待定]

---

**文档版本**: 1.0  
**创建日期**: 2026-09-26  
**下次审查**: 上线后 1 个月
