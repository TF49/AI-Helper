//! 图片下载：独立无凭据 client、HTTPS、阻止私网/SSRF、解压后字节上限。

use reqwest::Url;
use std::net::{IpAddr, ToSocketAddrs};

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageFetchError {
    InvalidUrl,
    HttpForbidden,
    BlockedAddress,
    TooLarge,
    NotImage,
}

impl std::fmt::Display for ImageFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImageFetchError::InvalidUrl => write!(f, "图片地址无效"),
            ImageFetchError::HttpForbidden => write!(f, "仅允许 HTTPS 图片源"),
            ImageFetchError::BlockedAddress => write!(f, "拒绝访问内网或本机图片地址"),
            ImageFetchError::TooLarge => write!(f, "图片超过大小上限"),
            ImageFetchError::NotImage => write!(f, "响应不是允许的图片格式"),
        }
    }
}

pub fn validate_image_url(raw: &str) -> Result<Url, ImageFetchError> {
    let url = Url::parse(raw.trim()).map_err(|_| ImageFetchError::InvalidUrl)?;
    if url.scheme() != "https" {
        return Err(ImageFetchError::HttpForbidden);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ImageFetchError::InvalidUrl);
    }
    let host = url.host_str().ok_or(ImageFetchError::InvalidUrl)?;
    if looks_like_blocked_host(host) {
        return Err(ImageFetchError::BlockedAddress);
    }
    Ok(url)
}

pub fn resolve_and_check_host(url: &Url) -> Result<(), ImageFetchError> {
    let host = url.host_str().ok_or(ImageFetchError::InvalidUrl)?;
    if looks_like_blocked_host(host) {
        return Err(ImageFetchError::BlockedAddress);
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|_| ImageFetchError::BlockedAddress)?;
    let mut saw_addr = false;
    for addr in addrs {
        saw_addr = true;
        if is_blocked_ip(addr.ip()) {
            return Err(ImageFetchError::BlockedAddress);
        }
    }
    if !saw_addr {
        return Err(ImageFetchError::BlockedAddress);
    }
    Ok(())
}

pub fn looks_like_blocked_host(host: &str) -> bool {
    let host = host.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    if matches!(host.as_str(), "localhost" | "localhost.localdomain") {
        return true;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_blocked_ip(ip);
    }
    false
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.octets()[0] == 0
                || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0b1100_0000) == 0b0100_0000)
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(mapped));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unicast_link_local()
                || v6.is_unique_local()
                || v6.is_multicast()
        }
    }
}

pub fn detect_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    }
}

pub fn enforce_image_size(len: usize) -> Result<(), ImageFetchError> {
    if len > MAX_IMAGE_BYTES {
        Err(ImageFetchError::TooLarge)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_loopback_and_private_literal_ips() {
        assert!(looks_like_blocked_host("127.0.0.1"));
        assert!(looks_like_blocked_host("10.0.0.1"));
        assert!(looks_like_blocked_host("192.168.1.1"));
        assert!(looks_like_blocked_host("169.254.1.1"));
        assert!(looks_like_blocked_host("::1"));
        assert!(looks_like_blocked_host("localhost"));
    }

    #[test]
    fn rejects_http_and_userinfo() {
        assert!(validate_image_url("http://cdn.example.com/a.png").is_err());
        assert!(validate_image_url("https://user:pass@cdn.example.com/a.png").is_err());
    }

    #[test]
    fn accepts_public_https_hostnames() {
        assert!(validate_image_url("https://cdn.example.com/a.png").is_ok());
        assert!(looks_like_blocked_host("127.0.0.1"));
        assert!(is_blocked_ip("10.1.2.3".parse().unwrap()));
    }

    #[test]
    fn image_magic_and_size_limits() {
        assert_eq!(
            detect_image_mime(&[0x89, b'P', b'N', b'G', 0, 0, 0, 0]),
            Some("image/png")
        );
        assert!(detect_image_mime(b"<html>").is_none());
        assert!(enforce_image_size(MAX_IMAGE_BYTES).is_ok());
        assert!(enforce_image_size(MAX_IMAGE_BYTES + 1).is_err());
    }
}
