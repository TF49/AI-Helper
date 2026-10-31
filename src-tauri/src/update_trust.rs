//! 更新包信任根：签名清单、平台绑定、防重放与安装前字节验签。
//! SHA-256 只做完整性辅助，不能替代 minisign 来源认证。

use base64::Engine;
use chrono::{Duration as ChronoDuration, Utc};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 与 `tauri.conf.json` plugins.updater.pubkey 保持一致。
pub const TAURI_UPDATER_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIyM0Q0OUM2QzJFRDA4NTUKUldSVkNPM0N4a2s5SW5OMUd4MlNIYmJ0SXI1aEx4a0JSSlQvd01UVmNUYkxPZzJJQ2VZb0JYRHoK";
pub const PRODUCT_ID: &str = "ai-helper";
pub const RELEASE_CHANNEL: &str = "stable";
const TRUST_STATE_VERSION: u32 = 1;
const MAX_FUTURE_SKEW_HOURS: i64 = 48;
const MAX_MANIFEST_AGE_DAYS: i64 = 730;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustError {
    MissingSignature,
    MissingManifest,
    MissingPlatformEntry(String),
    InvalidSignature,
    InvalidPubkey,
    ProductMismatch,
    ChannelMismatch,
    WrongPlatform { expected: String, actual: String },
    ReplayOrDowngrade,
    SameVersionDifferentContent,
    ExpiredMetadata,
    ClockAnomaly,
    HashMismatch,
    ReadFailed(String),
    InvalidManifest(String),
}

impl std::fmt::Display for TrustError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TrustError::MissingSignature => write!(f, "更新清单或安装包缺少签名，已停止安装"),
            TrustError::MissingManifest => write!(f, "更新清单缺失或无法读取，已停止安装"),
            TrustError::MissingPlatformEntry(p) => {
                write!(f, "更新清单缺少当前平台条目 {}，已停止安装", p)
            }
            TrustError::InvalidSignature => write!(f, "更新签名验证失败，已停止安装"),
            TrustError::InvalidPubkey => write!(f, "内置更新公钥无效"),
            TrustError::ProductMismatch => write!(f, "更新清单产品身份不匹配"),
            TrustError::ChannelMismatch => write!(f, "更新清单发布渠道不匹配"),
            TrustError::WrongPlatform { expected, actual } => {
                write!(f, "安装包平台不匹配（期望 {}，实际 {}）", expected, actual)
            }
            TrustError::ReplayOrDowngrade => {
                write!(f, "拒绝重放或降级安装包")
            }
            TrustError::SameVersionDifferentContent => {
                write!(f, "同版本安装包内容与已接受记录不一致")
            }
            TrustError::ExpiredMetadata => write!(f, "更新元数据已过期"),
            TrustError::ClockAnomaly => write!(f, "更新元数据时间异常（时钟偏差过大）"),
            TrustError::HashMismatch => write!(f, "安装包 SHA-256 与清单不一致"),
            TrustError::ReadFailed(e) => write!(f, "读取更新文件失败: {}", e),
            TrustError::InvalidManifest(e) => write!(f, "更新清单无效: {}", e),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformArtifact {
    pub signature: String,
    pub url: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateManifest {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_product")]
    pub product: String,
    #[serde(default = "default_channel")]
    pub channel: String,
    pub version: String,
    #[serde(default)]
    pub release_seq: u64,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub platforms: HashMap<String, PlatformArtifact>,
}

fn default_schema_version() -> u32 {
    1
}
fn default_product() -> String {
    PRODUCT_ID.to_string()
}
fn default_channel() -> String {
    RELEASE_CHANNEL.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrustState {
    pub version: u32,
    #[serde(default)]
    pub last_accepted_version: Option<String>,
    #[serde(default)]
    pub last_accepted_seq: u64,
    #[serde(default)]
    pub last_accepted_sha256: Option<String>,
    pub min_security_version: String,
}

impl TrustState {
    pub fn initial(current_version: &str) -> Self {
        Self {
            version: TRUST_STATE_VERSION,
            last_accepted_version: Some(normalize_version(current_version)),
            last_accepted_seq: version_to_seq(current_version),
            last_accepted_sha256: None,
            min_security_version: normalize_version(current_version),
        }
    }
}

#[derive(Debug, Clone)]
pub struct VerifiedManifest {
    pub manifest: UpdateManifest,
    pub platform_key: String,
}

#[derive(Debug, Clone)]
pub struct UntrustedVersionClaim {
    pub source: String,
    pub version: String,
    pub verified: Option<VerifiedManifest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateSelection {
    NoUpdate {
        latest_version: String,
    },
    Update {
        version: String,
        platform_key: String,
    },
}

pub fn normalize_version(version: &str) -> String {
    version.trim().trim_start_matches('v').to_string()
}

pub fn version_cmp(left: &str, right: &str) -> Ordering {
    let parse = |v: &str| -> Vec<u32> {
        normalize_version(v)
            .split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };
    let a = parse(left);
    let b = parse(right);
    let len = a.len().max(b.len());
    for i in 0..len {
        let av = a.get(i).copied().unwrap_or(0);
        let bv = b.get(i).copied().unwrap_or(0);
        match av.cmp(&bv) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    Ordering::Equal
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    version_cmp(latest, current) == Ordering::Greater
}

pub fn version_to_seq(version: &str) -> u64 {
    let parts: Vec<u64> = normalize_version(version)
        .split('.')
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
    let major = parts.first().copied().unwrap_or(0);
    let minor = parts.get(1).copied().unwrap_or(0);
    let patch = parts.get(2).copied().unwrap_or(0);
    major * 1_000_000 + minor * 1_000 + patch
}

pub fn current_platform_key() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-x86_64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-aarch64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-x86_64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x86_64"
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64")
    )))]
    {
        "unsupported"
    }
}

pub fn decode_embedded_pubkey(b64: &str) -> Result<PublicKey, TrustError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|_| TrustError::InvalidPubkey)?;
    let text = String::from_utf8(bytes).map_err(|_| TrustError::InvalidPubkey)?;
    PublicKey::decode(&text).map_err(|_| TrustError::InvalidPubkey)
}

pub fn verify_minisign(data: &[u8], signature: &str, pubkey_b64: &str) -> Result<(), TrustError> {
    if signature.trim().is_empty() {
        return Err(TrustError::MissingSignature);
    }
    let pk = decode_embedded_pubkey(pubkey_b64)?;
    // Tauri updater stores the complete minisign text as an outer Base64 value.
    // Decode that envelope before handing the four-line payload to minisign-verify.
    // Accepting the raw four-line form would make the release format ambiguous.
    let encoded = signature.trim();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| TrustError::InvalidSignature)?;
    let signature_text = String::from_utf8(decoded).map_err(|_| TrustError::InvalidSignature)?;
    let sig = Signature::decode(&signature_text).map_err(|_| TrustError::InvalidSignature)?;
    pk.verify(data, &sig, false)
        .map_err(|_| TrustError::InvalidSignature)
}

pub fn parse_manifest(json: &[u8]) -> Result<UpdateManifest, TrustError> {
    if json.is_empty() {
        return Err(TrustError::MissingManifest);
    }
    serde_json::from_slice(json).map_err(|e| TrustError::InvalidManifest(e.to_string()))
}

pub fn verify_signed_manifest(
    json: &[u8],
    signature: Option<&str>,
    pubkey_b64: &str,
    expected_platform: &str,
    now: chrono::DateTime<Utc>,
) -> Result<VerifiedManifest, TrustError> {
    let sig = signature.ok_or(TrustError::MissingSignature)?;
    verify_minisign(json, sig, pubkey_b64)?;
    let manifest = parse_manifest(json)?;
    validate_manifest(&manifest, expected_platform, now)?;
    Ok(VerifiedManifest {
        manifest,
        platform_key: expected_platform.to_string(),
    })
}

pub fn validate_manifest(
    manifest: &UpdateManifest,
    expected_platform: &str,
    now: chrono::DateTime<Utc>,
) -> Result<(), TrustError> {
    if manifest.product != PRODUCT_ID {
        return Err(TrustError::ProductMismatch);
    }
    if manifest.channel != RELEASE_CHANNEL {
        return Err(TrustError::ChannelMismatch);
    }
    if manifest.version.trim().is_empty() {
        return Err(TrustError::InvalidManifest("version 为空".into()));
    }
    let entry = manifest
        .platforms
        .get(expected_platform)
        .ok_or_else(|| TrustError::MissingPlatformEntry(expected_platform.to_string()))?;
    if entry.signature.trim().is_empty() {
        return Err(TrustError::MissingSignature);
    }
    let pub_date = manifest
        .pub_date
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| TrustError::InvalidManifest("签名清单缺少必填发布日期 pub_date".into()))?;

    let parsed = chrono::DateTime::parse_from_rfc3339(pub_date)
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(pub_date, "%Y-%m-%dT%H:%M:%SZ")
                .map(|ndt| ndt.and_utc().fixed_offset())
        })
        .map_err(|_| TrustError::InvalidManifest("pub_date 无法解析".into()))?;
    let parsed_utc = parsed.with_timezone(&Utc);
    if parsed_utc > now + ChronoDuration::hours(MAX_FUTURE_SKEW_HOURS) {
        return Err(TrustError::ClockAnomaly);
    }
    if now - parsed_utc > ChronoDuration::days(MAX_MANIFEST_AGE_DAYS) {
        return Err(TrustError::ExpiredMetadata);
    }
    Ok(())
}

pub fn assert_artifact_allowed(
    verified: &VerifiedManifest,
    current_version: &str,
    state: &TrustState,
    expected_platform: &str,
) -> Result<(), TrustError> {
    if verified.platform_key != expected_platform {
        return Err(TrustError::WrongPlatform {
            expected: expected_platform.to_string(),
            actual: verified.platform_key.clone(),
        });
    }
    let version = normalize_version(&verified.manifest.version);
    if version_cmp(&version, &state.min_security_version) == Ordering::Less {
        return Err(TrustError::ReplayOrDowngrade);
    }
    if version_cmp(&version, current_version) == Ordering::Less {
        return Err(TrustError::ReplayOrDowngrade);
    }
    let seq = if verified.manifest.release_seq > 0 {
        verified.manifest.release_seq
    } else {
        version_to_seq(&version)
    };
    if seq < state.last_accepted_seq {
        return Err(TrustError::ReplayOrDowngrade);
    }
    if let Some(prev) = &state.last_accepted_version {
        if version_cmp(&version, prev) == Ordering::Equal {
            if let (Some(expected), Some(actual)) = (
                state.last_accepted_sha256.as_ref(),
                verified
                    .manifest
                    .platforms
                    .get(expected_platform)
                    .and_then(|p| p.sha256.as_ref()),
            ) {
                if !expected.eq_ignore_ascii_case(actual) {
                    return Err(TrustError::SameVersionDifferentContent);
                }
            }
        }
        if version_cmp(&version, prev) == Ordering::Less {
            return Err(TrustError::ReplayOrDowngrade);
        }
    }
    Ok(())
}

/// 官方已验证「无更新」时，未认证镜像的更高版本声明一律丢弃；
/// 但若镜像具有经公钥验签的可信清单（且满足防回滚/同平台校验），则允许采用更新的可信版本。
pub fn select_trusted_update(
    current_version: &str,
    official: Option<Result<VerifiedManifest, TrustError>>,
    claims: &[UntrustedVersionClaim],
    state: &TrustState,
    expected_platform: &str,
) -> Result<UpdateSelection, TrustError> {
    let current = normalize_version(current_version);

    match official {
        Some(Ok(official_manifest)) => {
            assert_artifact_allowed(&official_manifest, &current, state, expected_platform)?;
            let official_ver = normalize_version(&official_manifest.manifest.version);

            // 从官方和已验签镜像源中选取最高可信版本
            let mut best_manifest = official_manifest;
            let mut best_ver = official_ver.clone();

            for claim in claims {
                if let Some(verified) = &claim.verified {
                    let claim_ver = normalize_version(&verified.manifest.version);
                    if is_newer(&claim_ver, &best_ver)
                        && assert_artifact_allowed(verified, &current, state, expected_platform)
                            .is_ok()
                    {
                        best_ver = claim_ver;
                        best_manifest = verified.clone();
                    }
                } else if is_newer(&claim.version, &official_ver) {
                    log::warn!(
                        "忽略未认证镜像 {} 的版本声明 {}",
                        claim.source,
                        claim.version
                    );
                }
            }

            if is_newer(&best_ver, &current) {
                return Ok(UpdateSelection::Update {
                    version: best_ver,
                    platform_key: best_manifest.platform_key,
                });
            } else {
                return Ok(UpdateSelection::NoUpdate {
                    latest_version: best_ver,
                });
            }
        }
        Some(Err(ref err))
            if matches!(
                err,
                TrustError::MissingSignature
                    | TrustError::InvalidSignature
                    | TrustError::MissingManifest
                    | TrustError::MissingPlatformEntry(_)
            ) =>
        {
            let has_verified_mirror = claims.iter().any(|c| c.verified.is_some());
            if !has_verified_mirror {
                return Err(err.clone());
            }
        }
        Some(Err(_)) | None => {}
    }

    let mut best: Option<VerifiedManifest> = None;
    for claim in claims {
        if let Some(verified) = &claim.verified {
            let take = match &best {
                None => true,
                Some(current_best) => {
                    is_newer(&verified.manifest.version, &current_best.manifest.version)
                }
            };
            if take {
                best = Some(verified.clone());
            }
        }
    }

    let Some(best) = best else {
        // 若官方源已通过签名验证且官方确定无更新，则属于可信无更新
        if let Some(Ok(ref official_manifest)) = official {
            return Ok(UpdateSelection::NoUpdate {
                latest_version: normalize_version(&official_manifest.manifest.version),
            });
        }
        // 关键安全加固：若官方与镜像均验证失败/网络不可达，绝不能伪装为“可信无更新”
        return Err(TrustError::ReadFailed(
            "所有更新源清单验证均失败或网络不可达，无法确认更新状态".to_string(),
        ));
    };
    assert_artifact_allowed(&best, &current, state, expected_platform)?;
    let latest = normalize_version(&best.manifest.version);
    if is_newer(&latest, &current) {
        Ok(UpdateSelection::Update {
            version: latest,
            platform_key: best.platform_key,
        })
    } else {
        Ok(UpdateSelection::NoUpdate {
            latest_version: latest,
        })
    }
}

pub fn verify_installer_bytes(
    bytes: &[u8],
    artifact: &PlatformArtifact,
    pubkey_b64: &str,
) -> Result<String, TrustError> {
    verify_minisign(bytes, &artifact.signature, pubkey_b64)?;
    let digest = sha256_hex(bytes);
    if let Some(expected) = &artifact.sha256 {
        if !expected.eq_ignore_ascii_case(&digest) {
            return Err(TrustError::HashMismatch);
        }
    }
    Ok(digest)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn sha256_file(path: &Path) -> Result<String, TrustError> {
    let mut file = std::fs::File::open(path).map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| TrustError::ReadFailed(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn verify_installer_file(
    path: &Path,
    artifact: &PlatformArtifact,
    pubkey_b64: &str,
) -> Result<String, TrustError> {
    let bytes = std::fs::read(path).map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    verify_installer_bytes(&bytes, artifact, pubkey_b64)
}

pub fn trust_state_path(app_dir: &Path) -> PathBuf {
    app_dir.join("update_trust.json")
}

pub fn load_trust_state(app_dir: &Path, current_version: &str) -> Result<TrustState, TrustError> {
    let path = trust_state_path(app_dir);
    if !path.exists() {
        return Ok(TrustState::initial(current_version));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| {
        TrustError::InvalidManifest(format!(
            "更新防重放状态文件已损坏，已停止更新以防降低安全下限: {}",
            e
        ))
    })
}

pub fn save_trust_state(app_dir: &Path, state: &TrustState) -> Result<(), TrustError> {
    std::fs::create_dir_all(app_dir).map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    let path = trust_state_path(app_dir);
    let tmp = app_dir.join(format!("update_trust.{}.tmp", std::process::id()));
    let json =
        serde_json::to_vec_pretty(state).map_err(|e| TrustError::InvalidManifest(e.to_string()))?;
    std::fs::write(&tmp, json).map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    std::fs::rename(&tmp, &path).map_err(|e| TrustError::ReadFailed(e.to_string()))?;
    Ok(())
}

pub fn record_accepted_install(state: &mut TrustState, version: &str, seq: u64, sha256: &str) {
    let version = normalize_version(version);
    if version_cmp(&version, &state.min_security_version) == Ordering::Greater {
        state.min_security_version = version.clone();
    }
    state.last_accepted_version = Some(version);
    state.last_accepted_seq = seq.max(state.last_accepted_seq);
    state.last_accepted_sha256 = Some(sha256.to_lowercase());
}

pub fn create_secure_update_staging_dir() -> Result<tempfile::TempDir, TrustError> {
    tempfile::Builder::new()
        .prefix("ai-helper-update-")
        .tempdir()
        .map_err(|e| TrustError::ReadFailed(e.to_string()))
}

pub fn staging_payload_path(dir: &Path, platform_key: &str) -> PathBuf {
    let name = match platform_key {
        "windows-x86_64" => "payload.exe",
        key if key.starts_with("darwin-") => "payload.dmg",
        _ => "payload.bin",
    };
    dir.join(name)
}

pub fn is_executable_staging_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("payload."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    // Generated with the pinned Tauri CLI 2.8.1 using a disposable test key.
    // Only the public key, signed bytes, and Base64 signatures are retained.
    const SIGNED_PAYLOAD: &[u8] = include_bytes!("../tests/fixtures/update-signature/payload.txt");
    const PAYLOAD_SIGNATURE: &str =
        include_str!("../tests/fixtures/update-signature/payload.txt.sig");
    const SIGNED_MANIFEST: &[u8] =
        include_bytes!("../tests/fixtures/update-signature/manifest.json");
    const MANIFEST_SIGNATURE: &str =
        include_str!("../tests/fixtures/update-signature/manifest.json.sig");
    const FIXTURE_PUBKEY: &str = include_str!("../tests/fixtures/update-signature/pubkey.txt");

    fn now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap()
    }

    fn manifest(version: &str, platform: &str, sha: Option<&str>) -> UpdateManifest {
        let mut platforms = HashMap::new();
        platforms.insert(
            platform.to_string(),
            PlatformArtifact {
                signature: "placeholder-sig".into(),
                url: "https://helper.bob-api.com/downloads/setup.exe".into(),
                sha256: sha.map(|s| s.to_string()),
            },
        );
        UpdateManifest {
            schema_version: 1,
            product: PRODUCT_ID.into(),
            channel: RELEASE_CHANNEL.into(),
            version: version.into(),
            release_seq: version_to_seq(version),
            notes: Some("test".into()),
            pub_date: Some("2026-10-18T00:00:00Z".into()),
            platforms,
        }
    }

    fn verified(version: &str, platform: &str, sha: Option<&str>) -> VerifiedManifest {
        VerifiedManifest {
            manifest: manifest(version, platform, sha),
            platform_key: platform.into(),
        }
    }

    #[test]
    fn version_compare_orders_semver() {
        assert!(is_newer("1.0.33", "1.0.32"));
        assert!(!is_newer("1.0.32", "1.0.32"));
        assert!(!is_newer("1.0.31", "1.0.32"));
    }

    #[test]
    fn official_no_update_rejects_unverified_mirror_high_version() {
        let official = verified("1.0.70", "windows-x86_64", None);
        let claims = [UntrustedVersionClaim {
            source: "ghfast".into(),
            version: "9.9.9".into(),
            verified: None,
        }];
        let state = TrustState::initial("1.0.70");
        let decision = select_trusted_update(
            "1.0.70",
            Some(Ok(official)),
            &claims,
            &state,
            "windows-x86_64",
        )
        .unwrap();
        assert_eq!(
            decision,
            UpdateSelection::NoUpdate {
                latest_version: "1.0.70".into()
            }
        );
    }

    #[test]
    fn official_no_update_accepts_verified_mirror_high_version() {
        let official = verified("1.0.70", "windows-x86_64", None);
        let mirror_verified = verified("1.0.71", "windows-x86_64", None);
        let claims = [UntrustedVersionClaim {
            source: "ghfast".into(),
            version: "1.0.71".into(),
            verified: Some(mirror_verified),
        }];
        let state = TrustState::initial("1.0.70");
        let decision = select_trusted_update(
            "1.0.70",
            Some(Ok(official)),
            &claims,
            &state,
            "windows-x86_64",
        )
        .unwrap();
        assert_eq!(
            decision,
            UpdateSelection::Update {
                version: "1.0.71".into(),
                platform_key: "windows-x86_64".into(),
            }
        );
    }

    #[test]
    fn official_no_update_without_forged_mirror_stays_idle() {
        let official = verified("1.0.70", "windows-x86_64", None);
        let state = TrustState::initial("1.0.70");
        let decision =
            select_trusted_update("1.0.70", Some(Ok(official)), &[], &state, "windows-x86_64")
                .unwrap();
        assert_eq!(
            decision,
            UpdateSelection::NoUpdate {
                latest_version: "1.0.70".into()
            }
        );
    }

    #[test]
    fn missing_signature_is_hard_failure() {
        let err = verify_signed_manifest(
            b"{}",
            None,
            TAURI_UPDATER_PUBKEY_B64,
            "windows-x86_64",
            now(),
        )
        .unwrap_err();
        assert_eq!(err, TrustError::MissingSignature);
    }

    #[test]
    fn missing_platform_entry_is_hard_failure() {
        let m = manifest("1.0.71", "darwin-aarch64", None);
        let err = validate_manifest(&m, "windows-x86_64", now()).unwrap_err();
        assert!(matches!(err, TrustError::MissingPlatformEntry(_)));
    }

    #[test]
    fn expired_metadata_is_rejected() {
        let mut m = manifest("1.0.71", "windows-x86_64", None);
        m.pub_date = Some("2018-01-01T00:00:00Z".into());
        let err = validate_manifest(&m, "windows-x86_64", now()).unwrap_err();
        assert_eq!(err, TrustError::ExpiredMetadata);
    }

    #[test]
    fn future_clock_anomaly_is_rejected() {
        let mut m = manifest("1.0.71", "windows-x86_64", None);
        m.pub_date = Some("2026-12-01T00:00:00Z".into());
        let err = validate_manifest(&m, "windows-x86_64", now()).unwrap_err();
        assert_eq!(err, TrustError::ClockAnomaly);
    }

    #[test]
    fn replay_of_older_seq_is_rejected() {
        let older = verified("1.0.69", "windows-x86_64", None);
        let mut state = TrustState::initial("1.0.70");
        state.last_accepted_seq = version_to_seq("1.0.70");
        let err = assert_artifact_allowed(&older, "1.0.70", &state, "windows-x86_64").unwrap_err();
        assert_eq!(err, TrustError::ReplayOrDowngrade);
    }

    #[test]
    fn same_version_different_hash_is_rejected() {
        let next = verified("1.0.70", "windows-x86_64", Some("bbbb"));
        let mut state = TrustState::initial("1.0.70");
        state.last_accepted_sha256 = Some("aaaa".into());
        let err = assert_artifact_allowed(&next, "1.0.70", &state, "windows-x86_64").unwrap_err();
        assert_eq!(err, TrustError::SameVersionDifferentContent);
    }

    #[test]
    fn wrong_platform_is_rejected() {
        let m = verified("1.0.71", "linux-x86_64", None);
        let state = TrustState::initial("1.0.70");
        let err = assert_artifact_allowed(&m, "1.0.70", &state, "windows-x86_64").unwrap_err();
        assert!(matches!(err, TrustError::WrongPlatform { .. }));
    }

    #[test]
    fn below_min_security_version_is_rejected() {
        let m = verified("1.0.65", "windows-x86_64", None);
        let mut state = TrustState::initial("1.0.70");
        state.min_security_version = "1.0.70".into();
        let err = assert_artifact_allowed(&m, "1.0.64", &state, "windows-x86_64").unwrap_err();
        assert_eq!(err, TrustError::ReplayOrDowngrade);
    }

    #[test]
    fn unsigned_installer_bytes_are_rejected() {
        let artifact = PlatformArtifact {
            signature: String::new(),
            url: "https://example.invalid/a.exe".into(),
            sha256: None,
        };
        let err =
            verify_installer_bytes(b"installer", &artifact, TAURI_UPDATER_PUBKEY_B64).unwrap_err();
        assert_eq!(err, TrustError::MissingSignature);
    }

    #[test]
    fn garbage_signature_is_rejected() {
        let artifact = PlatformArtifact {
            signature: "not-a-real-signature".into(),
            url: "https://example.invalid/a.exe".into(),
            sha256: None,
        };
        let err =
            verify_installer_bytes(b"installer", &artifact, TAURI_UPDATER_PUBKEY_B64).unwrap_err();
        assert_eq!(err, TrustError::InvalidSignature);
    }

    #[test]
    fn tauri_signed_installer_verifies_actual_bytes() {
        let artifact = PlatformArtifact {
            signature: PAYLOAD_SIGNATURE.trim().into(),
            url: "https://example.invalid/a.exe".into(),
            sha256: Some(sha256_hex(SIGNED_PAYLOAD)),
        };
        let digest = verify_installer_bytes(SIGNED_PAYLOAD, &artifact, FIXTURE_PUBKEY).unwrap();
        assert_eq!(digest, sha256_hex(SIGNED_PAYLOAD));
    }

    #[test]
    fn tauri_signed_manifest_verifies_and_binds_platform() {
        let verified = verify_signed_manifest(
            SIGNED_MANIFEST,
            Some(MANIFEST_SIGNATURE),
            FIXTURE_PUBKEY,
            "windows-x86_64",
            now(),
        )
        .unwrap();
        assert_eq!(verified.manifest.version, "1.0.71");
        assert_eq!(verified.platform_key, "windows-x86_64");
        assert_eq!(
            verify_signed_manifest(
                SIGNED_MANIFEST,
                Some(MANIFEST_SIGNATURE),
                FIXTURE_PUBKEY,
                "darwin-aarch64",
                now(),
            )
            .unwrap_err(),
            TrustError::MissingPlatformEntry("darwin-aarch64".into())
        );
    }

    #[test]
    fn tauri_signature_rejects_tampered_bytes_and_wrong_key() {
        assert_eq!(
            verify_minisign(b"tampered", PAYLOAD_SIGNATURE, FIXTURE_PUBKEY),
            Err(TrustError::InvalidSignature)
        );
        assert_eq!(
            verify_minisign(SIGNED_PAYLOAD, PAYLOAD_SIGNATURE, TAURI_UPDATER_PUBKEY_B64),
            Err(TrustError::InvalidSignature)
        );
    }

    #[test]
    fn hash_mismatch_is_rejected_after_valid_tauri_signature() {
        let artifact = PlatformArtifact {
            signature: PAYLOAD_SIGNATURE.trim().into(),
            url: "https://example.invalid/a.exe".into(),
            sha256: Some("deadbeef".into()),
        };
        let err = verify_installer_bytes(SIGNED_PAYLOAD, &artifact, FIXTURE_PUBKEY).unwrap_err();
        assert_eq!(err, TrustError::HashMismatch);
    }

    #[test]
    fn sha256_helper_is_stable() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn staging_paths_are_random_dir_and_fixed_payload_name() {
        let dir = create_secure_update_staging_dir().unwrap();
        let path = staging_payload_path(dir.path(), "windows-x86_64");
        assert!(path.starts_with(dir.path()));
        assert_eq!(path.file_name().unwrap(), "payload.exe");
        assert!(is_executable_staging_path(&path));
        assert!(!is_executable_staging_path(Path::new(
            "C:/Temp/AI-Helper-v9.9.9-Windows-x64-Setup.exe"
        )));
    }

    #[test]
    fn trust_state_roundtrip_and_record() {
        let tmp = tempfile::tempdir().unwrap();
        let mut state = TrustState::initial("1.0.70");
        record_accepted_install(&mut state, "1.0.71", version_to_seq("1.0.71"), "abcd");
        save_trust_state(tmp.path(), &state).unwrap();
        let loaded = load_trust_state(tmp.path(), "1.0.70").unwrap();
        assert_eq!(loaded.last_accepted_version.as_deref(), Some("1.0.71"));
        assert_eq!(loaded.min_security_version, "1.0.71");
        assert_eq!(loaded.last_accepted_sha256.as_deref(), Some("abcd"));
    }

    #[test]
    fn corrupted_trust_state_returns_error() {
        let tmp = tempfile::tempdir().unwrap();
        let path = trust_state_path(tmp.path());
        std::fs::write(&path, b"invalid json").unwrap();
        let err = load_trust_state(tmp.path(), "1.0.70").unwrap_err();
        assert!(matches!(err, TrustError::InvalidManifest(_)));
    }

    #[test]
    fn missing_pub_date_is_rejected() {
        let mut m = manifest("1.0.71", "windows-x86_64", None);
        m.pub_date = None;
        let err = validate_manifest(&m, "windows-x86_64", now()).unwrap_err();
        assert!(matches!(err, TrustError::InvalidManifest(_)));
    }

    #[test]
    fn all_sources_failed_returns_error() {
        let state = TrustState::initial("1.0.70");
        let decision = select_trusted_update("1.0.70", None, &[], &state, "windows-x86_64");
        assert!(decision.is_err());
    }

    #[test]
    fn embedded_pubkey_decodes() {
        decode_embedded_pubkey(TAURI_UPDATER_PUBKEY_B64).unwrap();
    }
}
