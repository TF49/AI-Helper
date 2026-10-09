#!/usr/bin/env bash
# =============================================================================
# scripts/sync-mirror.sh
# 从 GitHub Release 拉取安装包、ZIP 和 .sig 签名文件，
# 生成带真实签名的 latest.json，写入本站 downloads 目录。
#
# 用法（服务器上执行）：
#   bash /path/to/sync-mirror.sh [VERSION]
#   例：bash sync-mirror.sh 1.0.50
#   不传 VERSION 时自动从 GitHub API 获取最新版本号
#
# 建议配合 cron 自动化（每 10 分钟检查一次，避开整点）：
#   3-59/10 * * * * /bin/bash /root/AI-Helper/scripts/sync-mirror.sh >> /var/log/ai-helper-mirror-sync.log 2>&1
#
# 每次运行都会只保留最新版本的安装包与 zip，旧版本自动删除。
# =============================================================================

set -euo pipefail

# ── 配置区（按实际环境修改）─────────────────────────────────────────────────
GITHUB_REPO="TF49/AI-Helper"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-/var/www/ai-helper/downloads}"
# Tauri updater 公钥（与 tauri.conf.json pubkey 对应的私钥签出的 .sig 文件即为合法签名）
# latest.json 中的 signature 字段直接取自 GitHub Release 附件里的 .sig 文件内容
# ── 配置区结束 ───────────────────────────────────────────────────────────────

GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# 清理旧版本安装包：只保留当前 TAG 的 Setup.exe 和 Standalone.zip
cleanup_old_versions() {
    find "${DOWNLOAD_DIR}" -maxdepth 1 -type f -name 'AI-Helper-v*-Windows-x64-*' ! -name "AI-Helper-${TAG}-*" -print -delete \
        | while read -r removed; do log "已删除旧版本: ${removed}"; done
}

# 生成 downloads/version.json 供前端网站读取
write_site_version() {
    local ver="${1:-${VERSION}}"
    local tag="v${ver#v}"
    local setup="AI-Helper-${tag}-Windows-x64-Setup.exe"
    local zip="AI-Helper-${tag}-Windows-x64-Standalone.zip"
    local rel_date
    rel_date=$(date '+%Y-%m-%d')

    mkdir -p "${DOWNLOAD_DIR}"
    cat > "${DOWNLOAD_DIR}/version.json" <<EOF
{
  "version": "${ver#v}",
  "tag": "${tag}",
  "releaseDate": "${rel_date}",
  "setupFileName": "${setup}",
  "zipFileName": "${zip}",
  "setupDownloadUrl": "https://helper.bob-api.com/downloads/${setup}",
  "zipDownloadUrl": "https://helper.bob-api.com/downloads/${zip}",
  "fastSetupDownloadUrl": "https://ghfast.top/https://github.com/${GITHUB_REPO}/releases/download/${tag}/${setup}",
  "fastZipDownloadUrl": "https://ghfast.top/https://github.com/${GITHUB_REPO}/releases/download/${tag}/${zip}",
  "githubSetupDownloadUrl": "https://github.com/${GITHUB_REPO}/releases/download/${tag}/${setup}",
  "githubZipDownloadUrl": "https://github.com/${GITHUB_REPO}/releases/download/${tag}/${zip}",
  "releasePageUrl": "https://github.com/${GITHUB_REPO}/releases/tag/${tag}"
}
EOF
    log "Generated ${DOWNLOAD_DIR}/version.json for ${tag}"
}

# ── 1. 确定版本号 ─────────────────────────────────────────────────────────────
if [[ "${1:-}" != "" ]]; then
    VERSION="$1"
    log "Using specified version: v${VERSION}"
else
    log "Fetching latest version from GitHub API..."
    RELEASE_JSON=$(curl -fsSL --retry 3 "${GITHUB_API}")
    VERSION=$(echo "${RELEASE_JSON}" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"v\?\([^"]*\)".*/\1/')
    log "Latest version on GitHub: v${VERSION}"
fi

TAG="v${VERSION}"
SETUP_FILE="AI-Helper-${TAG}-Windows-x64-Setup.exe"
ZIP_FILE="AI-Helper-${TAG}-Windows-x64-Standalone.zip"
SIG_FILE="${SETUP_FILE}.sig"

GITHUB_BASE="https://github.com/${GITHUB_REPO}/releases/download/${TAG}"

# ── 2. 检查是否已同步当前版本（幂等）────────────────────────────────────────
LATEST_JSON="${DOWNLOAD_DIR}/latest.json"
if [[ -f "${LATEST_JSON}" ]]; then
    SYNCED_VER=$(grep '"version"' "${LATEST_JSON}" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' | tr -d 'v')
    if [[ "${SYNCED_VER}" == "${VERSION}" ]]; then
        log "Already up to date (v${VERSION}). Nothing to do."
        write_site_version "${VERSION}"
        cleanup_old_versions
        exit 0
    fi
fi

# ── 3. 创建下载目录 ───────────────────────────────────────────────────────────
mkdir -p "${DOWNLOAD_DIR}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

# ── 4. 下载安装包、ZIP、签名文件 ─────────────────────────────────────────────
download_file() {
    local url="$1"
    local dest="$2"
    log "Downloading: ${url}"
    curl -fsSL --retry 3 --retry-delay 5 -o "${dest}" "${url}"
}

download_file "${GITHUB_BASE}/${SETUP_FILE}" "${TMP_DIR}/${SETUP_FILE}"
download_file "${GITHUB_BASE}/${ZIP_FILE}"   "${TMP_DIR}/${ZIP_FILE}"
download_file "${GITHUB_BASE}/${SIG_FILE}"   "${TMP_DIR}/${SIG_FILE}"

# ── 5. 读取真实签名（来自 GitHub Release 的 .sig 文件）──────────────────────
SIGNATURE=$(cat "${TMP_DIR}/${SIG_FILE}")
log "Signature loaded (${#SIGNATURE} chars)"

# ── 6. 获取发布日期 ───────────────────────────────────────────────────────────
PUB_DATE=$(echo "${RELEASE_JSON:-$(curl -fsSL --retry 3 "${GITHUB_API}")}" \
    | grep '"published_at"' | head -1 \
    | sed 's/.*"published_at": *"\([^"]*\)".*/\1/')
[[ -z "${PUB_DATE}" ]] && PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 7. 生成 latest.json（Tauri updater 格式）─────────────────────────────────
# Tauri updater 要求的字段：version, notes, pub_date, platforms
NOTES="AI Helper ${TAG} 已就绪，详情见 https://github.com/${GITHUB_REPO}/releases/tag/${TAG}"

cat > "${TMP_DIR}/latest.json" <<EOF
{
  "version": "${VERSION}",
  "notes": "${NOTES}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "windows-x86_64": {
      "signature": "${SIGNATURE}",
      "url": "https://helper.bob-api.com/downloads/${SETUP_FILE}"
    }
  }
}
EOF

log "Generated latest.json for v${VERSION}"

# ── 8. 原子替换：先写入临时文件，再 mv 到目标路径 ────────────────────────────
mv "${TMP_DIR}/${SETUP_FILE}" "${DOWNLOAD_DIR}/${SETUP_FILE}"
mv "${TMP_DIR}/${ZIP_FILE}"   "${DOWNLOAD_DIR}/${ZIP_FILE}"
mv "${TMP_DIR}/latest.json"  "${DOWNLOAD_DIR}/latest.json"

write_site_version "${VERSION}"
cleanup_old_versions

log "Sync complete: ${DOWNLOAD_DIR}/"
log "  ${SETUP_FILE}"
log "  ${ZIP_FILE}"
log "  latest.json (v${VERSION})"
