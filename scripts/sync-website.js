#!/usr/bin/env node

/**
 * scripts/sync-website.js
 * 
 * 保证 website/ 下的所有文件版本信息 100% 同步且无缓存隐患：
 * 1. website/index.html 中的所有版本文字、资源版本后缀(?v=...)、下载链接、校验文件名、防缓存meta
 * 2. website/assets/script.js 中的 CURRENT_VERSION 常量
 * 3. website/version.json 中的版本号、发布日期与各分流下载地址
 * 
 * 用法：
 *   node scripts/sync-website.js [新版本号，如 1.0.52，不传则自动读取 package.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const pkgPath = path.join(repoRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

let targetVersion = process.argv[2] ? process.argv[2].trim().replace(/^v/, '') : pkg.version;
if (!targetVersion) {
  console.error('[sync-website] 无法获取目标版本号');
  process.exit(1);
}

const tag = `v${targetVersion}`;
const today = new Date().toISOString().split('T')[0];
const repoName = 'TF49/AI-Helper';
const mirrorBase = 'https://helper.bob-api.com/downloads';
const ghfastPrefix = 'https://ghfast.top/';

console.log(`[sync-website] 正在全量同步官网版本信息 -> ${targetVersion} (${tag})`);

// ─────────────────────────────────────────────────────────────────────────────
// 1. 同步 website/index.html
// ─────────────────────────────────────────────────────────────────────────────
const indexHtmlPath = path.join(repoRoot, 'website', 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  let html = fs.readFileSync(indexHtmlPath, 'utf8');

  // 1.1 注入 / 确保包含 HTTP 强缓存禁用 meta 标签（防止浏览器缓存旧 HTML）
  const cacheMeta = `  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n  <meta http-equiv="Pragma" content="no-cache">\n  <meta http-equiv="Expires" content="0">`;
  if (!html.includes('http-equiv="Cache-Control"')) {
    html = html.replace(/(<meta\s+name="viewport"[^>]*>)/i, `$1\n${cacheMeta}`);
  }

  // 1.2 资源防缓存版本后缀（Cache-busting query strings）
  html = html.replace(/assets\/style\.css\?v=[^"'\s>]+/g, `assets/style.css?v=${targetVersion}`);
  html = html.replace(/assets\/script\.js\?v=[^"'\s>]+/g, `assets/script.js?v=${targetVersion}`);

  // 1.3 替换所有带有 current-version-tag class 的标签内容（如 span, strong, small 等）
  html = html.replace(
    /(<[a-zA-Z0-9]+\b[^>]*class="[^"]*\bcurrent-version-tag\b[^"]*"[^>]*>)\s*v?[0-9.]+\s*(<\/[a-zA-Z0-9]+>)/g,
    `$1${tag}$2`
  );

  // 1.4 Hero 下载按钮文本（确保 UTF-8 中文不乱码）
  html = html.replace(
    /(<span\s+id="hero-btn-text">)[^<]*(<\/span>)/g,
    `$1立即下载 Windows 安装包 (${tag})$2`
  );

  // 1.5 替换所有通用的安装包和压缩包文件名中的版本号
  html = html.replace(/AI-Helper-v\d+\.\d+\.\d+/g, `AI-Helper-${tag}`);

  // 1.6 替换所有 GitHub Release 路径中的版本号
  html = html.replace(/releases\/download\/v\d+\.\d+\.\d+/g, `releases/download/${tag}`);
  html = html.replace(/releases\/tag\/v\d+\.\d+\.\d+/g, `releases/tag/${tag}`);

  // 1.7 校验和文件名
  html = html.replace(
    /(<code\s+id="checksum-setup-filename">)[^<]*(<\/code>)/g,
    `$1AI-Helper-${tag}-Windows-x64-Setup.exe$2`
  );

  fs.writeFileSync(indexHtmlPath, html, 'utf8');
  console.log(`[sync-website] ✓ website/index.html 已同步 (版本: ${tag})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 同步 website/assets/script.js
// ─────────────────────────────────────────────────────────────────────────────
const scriptJsPath = path.join(repoRoot, 'website', 'assets', 'script.js');
if (fs.existsSync(scriptJsPath)) {
  let js = fs.readFileSync(scriptJsPath, 'utf8');
  js = js.replace(/const CURRENT_VERSION = "v[^"]*";/, `const CURRENT_VERSION = "${tag}";`);
  fs.writeFileSync(scriptJsPath, js, 'utf8');
  console.log(`[sync-website] ✓ website/assets/script.js 已同步 (CURRENT_VERSION = "${tag}")`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 同步 website/version.json
// ─────────────────────────────────────────────────────────────────────────────
const versionJsonPath = path.join(repoRoot, 'website', 'version.json');
const versionData = {
  version: targetVersion,
  tag: tag,
  releaseDate: today,
  setupFileName: `AI-Helper-${tag}-Windows-x64-Setup.exe`,
  zipFileName: `AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  setupDownloadUrl: `${mirrorBase}/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  ossSetupDownloadUrl: `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  zipDownloadUrl: `${mirrorBase}/AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  fastSetupDownloadUrl: `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  fastZipDownloadUrl: `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  githubSetupDownloadUrl: `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  githubZipDownloadUrl: `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  releasePageUrl: `https://github.com/${repoName}/releases/tag/${tag}`
};

fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');
console.log(`[sync-website] ✓ website/version.json 已生成 (日期: ${today})`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. 同步 website/download-config.json（如果存在）
// ─────────────────────────────────────────────────────────────────────────────
const downloadConfigPath = path.join(repoRoot, 'website', 'download-config.json');
if (fs.existsSync(downloadConfigPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(downloadConfigPath, 'utf8'));
    cfg.version = targetVersion;
    if (cfg.channels) {
      if (cfg.channels.oss) {
        cfg.channels.oss.downloadUrl = `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-Windows-x64-Setup.exe`;
      }
      if (cfg.channels.direct) {
        cfg.channels.direct.downloadUrl = `${mirrorBase}/AI-Helper-${tag}-Windows-x64-Setup.exe`;
      }
      if (cfg.channels.mirror) {
        cfg.channels.mirror.downloadUrl = `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Setup.exe`;
      }
    }
    fs.writeFileSync(downloadConfigPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(`[sync-website] ✓ website/download-config.json 已同步 (版本: ${targetVersion})`);
  } catch (err) {
    console.warn(`[sync-website] 同步 download-config.json 警告:`, err.message);
  }
}

console.log(`[sync-website] 全部官网文件同步完成！`);
