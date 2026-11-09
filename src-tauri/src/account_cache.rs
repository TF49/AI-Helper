//! Bob API 账号数据的本地持久缓存。
//!
//! 目的：减少对 bob-api.com 的重复请求（尤其是会进入审计的明文读取
//! `POST /api/token/:id/key`）。登录有效期间，令牌列表、明文 Key、价格表都从本地读取，
//! 重启应用也不必重新拉取。
//!
//! 生命周期与登录状态绑定：
//! - 显式登录成功、退出登录、会话失效（refresh 过期/账号不符）、本地会话无法恢复时整份删除；
//! - 读取时再核对用户 ID，任何不一致都视为失效并删除。
//!
//! 安全：令牌列表只保存元数据与打码 Key；明文 Key 经 `secret_storage`
//! （Windows DPAPI / 系统钥匙串）加密后才写入文件，删除缓存时同步删除钥匙串条目。

use crate::auth::{PricingResponse, TokenItem};
use crate::secret_storage::{self, CredentialPurpose};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const CACHE_VERSION: u32 = 1;
/// 列表与价格表每天回源校验一次，以同步在网页端所做的改动。
pub const DAILY_REVALIDATE_SECS: i64 = 24 * 60 * 60;

#[derive(Clone, Serialize, Deserialize)]
struct Timed<T> {
    fetched_at: i64,
    value: T,
}

#[derive(Default, Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    user_id: i64,
    #[serde(default)]
    token_lists: HashMap<String, Timed<Vec<TokenItem>>>,
    /// token_id -> 加密后的明文 Key
    #[serde(default)]
    token_keys: HashMap<i64, String>,
    #[serde(default)]
    pricing: Option<Timed<PricingResponse>>,
}

pub struct AccountCache {
    path: PathBuf,
    loaded: bool,
    data: Option<CacheFile>,
    /// 每次失效/清空递增；回源请求只在期间没有失效时才写回，避免旧响应覆盖新状态。
    revision: u64,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn list_slot(all: bool) -> &'static str {
    if all {
        "all"
    } else {
        "default"
    }
}

fn is_fresh(fetched_at: i64, max_age_secs: i64) -> bool {
    let age = now_secs() - fetched_at;
    (0..max_age_secs).contains(&age)
}

/// 列表接口通常返回打码 Key；若服务端返回了明文，绝不以明文落盘。
fn is_masked_or_empty(key: &str) -> bool {
    key.is_empty() || key.contains('*')
}

impl AccountCache {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            loaded: false,
            data: None,
            revision: 0,
        }
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn load(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let Ok(bytes) = std::fs::read(&self.path) else {
            return;
        };
        match serde_json::from_slice::<CacheFile>(&bytes) {
            Ok(file) if file.version == CACHE_VERSION => self.data = Some(file),
            _ => {
                log::warn!("本地账号缓存格式无效，已丢弃");
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }

    /// 返回属于 `user_id` 的缓存；账号不符时整份删除。
    fn data_for(&mut self, user_id: i64) -> Option<&mut CacheFile> {
        self.load();
        if self
            .data
            .as_ref()
            .is_some_and(|data| data.user_id != user_id)
        {
            self.clear();
            return None;
        }
        self.data.as_mut()
    }

    fn data_for_write(&mut self, user_id: i64) -> &mut CacheFile {
        self.load();
        if self
            .data
            .as_ref()
            .is_some_and(|data| data.user_id != user_id)
        {
            self.clear();
        }
        self.loaded = true;
        self.data.get_or_insert_with(|| CacheFile {
            version: CACHE_VERSION,
            user_id,
            ..CacheFile::default()
        })
    }

    fn save(&self) {
        let Some(data) = &self.data else {
            return;
        };
        let result = serde_json::to_vec(data)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                if let Some(parent) = self.path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                crate::safe_fs::atomic_write(&self.path, &bytes).map_err(|error| error.to_string())
            });
        if let Err(error) = result {
            log::warn!("写入本地账号缓存失败: {error}");
        }
    }

    /// 登录状态清除时调用：删除缓存文件及其加密条目。
    pub fn clear(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.load();
        if let Some(data) = self.data.take() {
            for protected in data.token_keys.values() {
                let _ = secret_storage::delete_secret_for(CredentialPurpose::Generic, protected);
            }
        }
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => log::warn!("删除本地账号缓存失败: {error}"),
        }
        self.loaded = true;
    }

    pub fn token_list(
        &mut self,
        user_id: i64,
        all: bool,
        max_age_secs: i64,
    ) -> Option<Vec<TokenItem>> {
        let data = self.data_for(user_id)?;
        data.token_lists
            .get(list_slot(all))
            .filter(|cached| is_fresh(cached.fetched_at, max_age_secs))
            .map(|cached| cached.value.clone())
    }

    pub fn store_token_list(
        &mut self,
        user_id: i64,
        all: bool,
        items: &[TokenItem],
        revision: u64,
    ) {
        if revision != self.revision {
            return;
        }
        let mut plaintext = Vec::new();
        let sanitized: Vec<TokenItem> = items
            .iter()
            .map(|item| {
                let mut item = item.clone();
                if !is_masked_or_empty(&item.key) {
                    plaintext.push((item.id, std::mem::take(&mut item.key)));
                }
                item
            })
            .collect();
        let data = self.data_for_write(user_id);
        data.token_lists.insert(
            list_slot(all).to_owned(),
            Timed {
                fetched_at: now_secs(),
                value: sanitized,
            },
        );
        for (token_id, key) in plaintext {
            self.put_token_key(user_id, token_id, &key);
        }
        self.save();
    }

    /// 令牌元数据可能已变化（改分组/状态、新建、删除、或读取失败）：下次读取时回源。
    pub fn invalidate_token_lists(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.load();
        if let Some(data) = self.data.as_mut() {
            if !data.token_lists.is_empty() {
                data.token_lists.clear();
                self.save();
            }
        }
    }

    pub fn token_key(&mut self, user_id: i64, token_id: i64) -> Option<String> {
        let protected = self.data_for(user_id)?.token_keys.get(&token_id)?.clone();
        match secret_storage::unprotect_secret_for(CredentialPurpose::Generic, &protected) {
            Ok((key, false)) if !key.is_empty() => Some(key),
            _ => {
                // 无法解密或不是加密值：丢弃该条目，回源重新读取。
                self.remove_token_key(token_id);
                None
            }
        }
    }

    fn put_token_key(&mut self, user_id: i64, token_id: i64, key: &str) {
        let protected = match secret_storage::protect_secret_for(CredentialPurpose::Generic, key) {
            Ok(protected) if !protected.is_empty() => protected,
            Ok(_) => return,
            Err(error) => {
                log::warn!("加密缓存明文 Key 失败，本次不落盘: {error}");
                return;
            }
        };
        let data = self.data_for_write(user_id);
        if let Some(old) = data.token_keys.insert(token_id, protected) {
            let _ = secret_storage::delete_secret_for(CredentialPurpose::Generic, &old);
        }
    }

    pub fn store_token_key(&mut self, user_id: i64, token_id: i64, key: &str) {
        self.put_token_key(user_id, token_id, key);
        self.save();
    }

    pub fn remove_token_key(&mut self, token_id: i64) {
        self.load();
        if let Some(data) = self.data.as_mut() {
            if let Some(old) = data.token_keys.remove(&token_id) {
                let _ = secret_storage::delete_secret_for(CredentialPurpose::Generic, &old);
                self.save();
            }
        }
    }

    pub fn pricing(&mut self, user_id: i64, max_age_secs: i64) -> Option<PricingResponse> {
        let data = self.data_for(user_id)?;
        data.pricing
            .as_ref()
            .filter(|cached| is_fresh(cached.fetched_at, max_age_secs))
            .map(|cached| cached.value.clone())
    }

    pub fn store_pricing(&mut self, user_id: i64, pricing: &PricingResponse, revision: u64) {
        if revision != self.revision {
            return;
        }
        self.data_for_write(user_id).pricing = Some(Timed {
            fetched_at: now_secs(),
            value: pricing.clone(),
        });
        self.save();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(id: i64, key: &str) -> TokenItem {
        serde_json::from_value(
            serde_json::json!({ "id": id, "name": format!("t{id}"), "key": key }),
        )
        .unwrap()
    }

    fn cache() -> (tempfile::TempDir, AccountCache) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("account_cache.json");
        (dir, AccountCache::new(path))
    }

    #[test]
    fn token_list_survives_restart_and_is_scoped_to_user() {
        let (dir, mut first) = cache();
        first.store_token_list(7, false, &[token(1, "abcd****wxyz")], first.revision());
        let mut restarted = AccountCache::new(dir.path().join("account_cache.json"));
        let items = restarted
            .token_list(7, false, DAILY_REVALIDATE_SECS)
            .unwrap();
        assert_eq!(items[0].key, "abcd****wxyz");
        assert!(restarted
            .token_list(7, true, DAILY_REVALIDATE_SECS)
            .is_none());
        // 另一个账号读取时整份失效并删除
        assert!(restarted
            .token_list(8, false, DAILY_REVALIDATE_SECS)
            .is_none());
        assert!(!dir.path().join("account_cache.json").exists());
    }

    #[test]
    fn plaintext_list_keys_are_never_written_in_clear() {
        let (dir, mut cache) = cache();
        cache.store_token_list(
            7,
            true,
            &[token(1, "sk-plain-secret-value")],
            cache.revision(),
        );
        let raw = std::fs::read_to_string(dir.path().join("account_cache.json")).unwrap();
        assert!(!raw.contains("plain-secret-value"));
        let items = cache.token_list(7, true, DAILY_REVALIDATE_SECS).unwrap();
        assert!(items[0].key.is_empty());
        assert_eq!(
            cache.token_key(7, 1).as_deref(),
            Some("sk-plain-secret-value")
        );
    }

    #[test]
    fn token_key_is_encrypted_and_cleared_with_login_state() {
        let (dir, mut cache) = cache();
        cache.store_token_key(7, 1, "sk-secret-token-key");
        let raw = std::fs::read_to_string(dir.path().join("account_cache.json")).unwrap();
        assert!(!raw.contains("secret-token-key"));
        let mut restarted = AccountCache::new(dir.path().join("account_cache.json"));
        assert_eq!(
            restarted.token_key(7, 1).as_deref(),
            Some("sk-secret-token-key")
        );
        restarted.clear();
        assert!(!dir.path().join("account_cache.json").exists());
        assert!(restarted.token_key(7, 1).is_none());
    }

    #[test]
    fn stale_fetch_does_not_overwrite_after_invalidation() {
        let (_dir, mut cache) = cache();
        let before = cache.revision();
        cache.invalidate_token_lists();
        cache.store_token_list(7, false, &[token(1, "abcd****wxyz")], before);
        assert!(cache.token_list(7, false, DAILY_REVALIDATE_SECS).is_none());
    }

    #[test]
    fn invalidation_keeps_plaintext_keys_but_drops_lists() {
        let (_dir, mut cache) = cache();
        cache.store_token_list(7, false, &[token(1, "abcd****wxyz")], cache.revision());
        cache.store_token_key(7, 1, "sk-secret-token-key");
        cache.invalidate_token_lists();
        assert!(cache.token_list(7, false, DAILY_REVALIDATE_SECS).is_none());
        assert_eq!(
            cache.token_key(7, 1).as_deref(),
            Some("sk-secret-token-key")
        );
    }

    #[test]
    fn expired_entries_are_not_served() {
        let (_dir, mut cache) = cache();
        cache.store_token_list(7, false, &[token(1, "abcd****wxyz")], cache.revision());
        cache
            .data
            .as_mut()
            .unwrap()
            .token_lists
            .get_mut("default")
            .unwrap()
            .fetched_at -= DAILY_REVALIDATE_SECS + 1;
        assert!(cache.token_list(7, false, DAILY_REVALIDATE_SECS).is_none());
    }
}
