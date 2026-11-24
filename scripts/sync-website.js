#!/usr/bin/env node

/**
 * scripts/sync-website.js
 * 
 * 保证 website/ 下的所有文件版本信息 100% 同步且无缓存隐患：
 * 1. website/index.html 中的所有版本文字、资源版本后缀(?v=...)、下载链接、校验文件名、防缓存meta
 * 2. website/assets/script.js 中的 CURRENT_VERSION 常量
 * 3. website/version.json 中的版本号、发布日期与各分流下载地址
 * 4. GEO 页面（llms.txt、en/、guides/、404.html）中的版本号、下载链接与「最后更新」日期
 * 5. website/sitemap.xml 中的 lastmod（首页与英文页取发版日期，其余页面取最后一次非发版提交的日期）
 * 
 * 用法：
 *   node scripts/sync-website.js [新版本号，如 1.0.52，不传则自动读取 package.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
// 以北京时间（发布者所在时区）计算日期，避免 UTC 跨日导致 lastmod / releaseDate 偏差一天
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const repoName = 'TF49/AI-Helper';
const mirrorBase = 'https://helper.bob-api.com/downloads';
const ghfastPrefix = 'https://ghfast.top/';

console.log(`[sync-website] 正在全量同步官网版本信息 -> ${targetVersion} (${tag})`);

const websiteDir = path.join(repoRoot, 'website');

/**
 * 页面「内容」的最后修改日期，用于 sitemap lastmod、JSON-LD dateModified 与页面上的「最后更新」。
 *
 * 只把真正的内容改动算作修改：比较时先用 normalizeForDate 抹掉本脚本会自动改写的部分
 * （版本号、下载链接、docs.css 防缓存后缀、各类日期）。这样：
 * - 发版只替换版本号时不会刷新日期（否则所有页面每次都是同一天，搜索引擎会学着忽略 lastmod）；
 * - release.ps1 会先经 bump-version.ps1 跑一次本脚本、再跑一次，第二次看到的「未提交改动」
 *   只有版本号，同样不会误判为内容更新；
 * - 内容改动即使混在发版提交里，也能按那次提交的日期识别出来。
 *
 * 判断顺序：工作区与 HEAD 内容不同 → 今天（这次会一起提交）；否则沿 git 历史往回找
 * 最近一次内容有变化的提交，取其日期。git 不可用时回退为今天。
 */
const DATE_PLACEHOLDER = '0000-00-00';
function normalizeForDate(text) {
  return syncSecondaryPage(text.replace(/\r\n/g, '\n'), DATE_PLACEHOLDER)
    .replace(/<lastmod>[^<]*<\/lastmod>/g, '')
    // 只改 docs.css 防缓存后缀不算内容更新
    .replace(/assets\/docs\.css\?v=[^"'\s>]+/g, 'assets/docs.css')
    .trim();
}

function contentDate(file) {
  const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
  const git = (args) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const show = (rev) => {
    try {
      return git(['show', `${rev}:${rel}`]);
    } catch {
      return null; // 该提交里不存在这个文件（新建或已删除）
    }
  };
  try {
    const head = show('HEAD');
    if (head === null || normalizeForDate(fs.readFileSync(file, 'utf8')) !== normalizeForDate(head)) {
      return today;
    }
    const commits = git(['log', '-n', '100', '--date=short', '--format=%H %cd', '--', rel])
      .split('\n')
      .map((line) => line.trim().split(' '))
      .filter(([hash, date]) => hash && /^\d{4}-\d{2}-\d{2}$/.test(date || ''));
    for (const [hash, date] of commits) {
      const current = show(hash);
      if (current === null) continue;
      const parent = show(`${hash}^`);
      if (parent === null || normalizeForDate(current) !== normalizeForDate(parent)) return date;
    }
    return commits.length ? commits[commits.length - 1][1] : today;
  } catch {
    return today;
  }
}

/**
 * 每次发版都会实际变化的页面（版本号、下载区是页面主体内容），日期固定取今天；
 * 其余页面（教程、关于页、llms.txt 以外的 GEO 页）按 contentDate 计算。
 */
const releaseDrivenPages = new Set([
  path.join(websiteDir, 'index.html'),
  path.join(websiteDir, 'en', 'index.html'),
  path.join(websiteDir, 'llms.txt'),
]);
const pageDates = new Map();
function pageDate(file) {
  if (releaseDrivenPages.has(file)) return today;
  if (!pageDates.has(file)) pageDates.set(file, contentDate(file));
  return pageDates.get(file);
}

/** 静态资源防缓存后缀：版本号一致时保留 -<后缀>，否则回到纯版本号 */
function sameVersionAsset(current) {
  return current.startsWith(`${targetVersion}-`) ? current : targetVersion;
}

/** 同步 JSON-LD dateModified 与 <time class="last-updated"> 的日期 */
function syncGeoDates(text, date = today) {
  return text
    .replace(/"dateModified":\s*"[^"]*"/g, `"dateModified": "${date}"`)
    .replace(
      /(<time\s+class="last-updated"\s+datetime=")[^"]*(">)[^<]*(<\/time>)/g,
      `$1${date}$2${date}$3`
    );
}

/** 同步教程页 / 英文页 / 404 页 / 关于页 / llms.txt 中的版本号、下载链接、资源版本后缀与日期 */
function syncSecondaryPage(text, date) {
  return syncGeoDates(
    text
      .replace(
        /(<[a-zA-Z0-9]+\b[^>]*class="[^"]*\bcurrent-version-tag\b[^"]*"[^>]*>)\s*v?[0-9.]+\s*(<\/[a-zA-Z0-9]+>)/g,
        `$1${tag}$2`
      )
      .replace(/AI-Helper-v\d+\.\d+\.\d+/g, `AI-Helper-${tag}`)
      .replace(/releases\/download\/v\d+\.\d+\.\d+/g, `releases/download/${tag}`)
      .replace(/releases\/tag\/v\d+\.\d+\.\d+/g, `releases/tag/${tag}`)
      .replace(/"softwareVersion":\s*"[^"]*"/g, `"softwareVersion": "${targetVersion}"`)
      // 与首页 style.css 相同：同版本内保留 ?v=<版本>-<后缀>（用于强制刷新 7 天缓存），发新版时回到纯版本号
      .replace(/assets\/docs\.css\?v=([^"'\s>]+)/g, (_, v) => `assets/docs.css?v=${sameVersionAsset(v)}`)
      // llms.txt 中的纯文本版本行
      .replace(/^- Current version: v[0-9.]+ \(last updated: [0-9-]+\)$/m, `- Current version: ${tag} (last updated: ${today})`),
    date
  );
}

// 在写入任何文件之前，先算好所有 GEO 页面与 sitemap 页面的内容日期
const geoFiles = [
  path.join(websiteDir, 'llms.txt'),
  path.join(websiteDir, '404.html'),
  path.join(websiteDir, 'about.html'),
  path.join(websiteDir, 'en', 'index.html'),
];
for (const guidesDir of [path.join(websiteDir, 'guides'), path.join(websiteDir, 'en', 'guides')]) {
  if (!fs.existsSync(guidesDir)) continue;
  for (const name of fs.readdirSync(guidesDir)) {
    if (name.endsWith('.html')) geoFiles.push(path.join(guidesDir, name));
  }
}
for (const file of geoFiles) {
  if (fs.existsSync(file)) pageDate(file);
}

// 写入任何文件之前先校验所有页面的 JSON-LD：结构化数据损坏时直接中止，
// 避免发版时改了一半文件、最后在生成 llms-full.txt 时才失败
for (const file of [path.join(websiteDir, 'index.html'), ...geoFiles.filter((f) => f.endsWith('.html'))]) {
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      console.error(`[sync-website] ${path.relative(repoRoot, file)} 的 JSON-LD 无法解析：${error.message}`);
      process.exit(1);
    }
  }
}

/** sitemap 中的 <loc> 映射到 website/ 下的文件 */
function sitemapLocToFile(loc) {
  const urlPath = new URL(loc).pathname;
  const rel = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath;
  return path.join(websiteDir, ...rel.split('/').filter(Boolean));
}
const sitemapPath = path.join(websiteDir, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  const locs = fs.readFileSync(sitemapPath, 'utf8').match(/<loc>[^<]+<\/loc>/g) || [];
  for (const loc of locs) {
    const file = sitemapLocToFile(loc.slice(5, -6));
    if (fs.existsSync(file)) pageDate(file);
  }
}

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
  // 静态资源在线上缓存 7 天（immutable）。同一版本内更新官网时，可手动改成 ?v=<版本>-<后缀>
  // 强制刷新缓存：版本号一致时保留后缀，发新版时统一回到纯版本号。
  const assetVersion = (current) =>
    current.startsWith(`${targetVersion}-`) ? current : targetVersion;
  html = html.replace(/assets\/style\.css\?v=([^"'\s>]+)/g, (_, v) => `assets/style.css?v=${assetVersion(v)}`);
  html = html.replace(/assets\/script\.js\?v=([^"'\s>]+)/g, (_, v) => `assets/script.js?v=${assetVersion(v)}`);

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

  // 1.8 结构化数据 Schema.org 软件版本号
  html = html.replace(/"softwareVersion":\s*"[^"]*"/g, `"softwareVersion": "${targetVersion}"`);

  // 1.9 GEO：结构化数据 dateModified 与页面可见的「最后更新」日期
  html = syncGeoDates(html);

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
// 2.1 同步 website/assets/diagnostics-core.js 与 website/diagnostics.html
// ─────────────────────────────────────────────────────────────────────────────
const diagJsPath = path.join(repoRoot, 'website', 'assets', 'diagnostics-core.js');
if (fs.existsSync(diagJsPath)) {
  let js = fs.readFileSync(diagJsPath, 'utf8');
  js = js.replace(/this\.version\s*=\s*['"][^'"]*['"];/, `this.version = '${targetVersion}';`);
  fs.writeFileSync(diagJsPath, js, 'utf8');
  console.log(`[sync-website] ✓ website/assets/diagnostics-core.js 已同步 (version: ${targetVersion})`);
}

const diagHtmlPath = path.join(repoRoot, 'website', 'diagnostics.html');
if (fs.existsSync(diagHtmlPath)) {
  let html = fs.readFileSync(diagHtmlPath, 'utf8');
  html = html.replace(/diagnostics-core\.js(\?v=[^"'\s>]+)?/g, `diagnostics-core.js?v=${targetVersion}`);
  fs.writeFileSync(diagHtmlPath, html, 'utf8');
  console.log(`[sync-website] ✓ website/diagnostics.html 已同步 (防缓存版本: ${targetVersion})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 同步 website/version.json
// ─────────────────────────────────────────────────────────────────────────────
const versionJsonPath = path.join(repoRoot, 'website', 'version.json');
// 同一版本重复同步（例如 pre-commit hook 在每次提交时运行）不改发布日期，只有换新版本时才取今天
let releaseDate = today;
try {
  const existing = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  if (existing.version === targetVersion && /^\d{4}-\d{2}-\d{2}$/.test(existing.releaseDate || '')) {
    releaseDate = existing.releaseDate;
  }
} catch {
  // 文件不存在或损坏时按新版本处理
}
const versionData = {
  version: targetVersion,
  tag: tag,
  releaseDate,
  setupFileName: `AI-Helper-${tag}-Windows-x64-Setup.exe`,
  zipFileName: `AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  macArm64FileName: `AI-Helper-${tag}-macOS-aarch64.dmg`,
  macX64FileName: `AI-Helper-${tag}-macOS-x64.dmg`,
  setupDownloadUrl: `${mirrorBase}/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  ossSetupDownloadUrl: `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  zipDownloadUrl: `${mirrorBase}/AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  macArm64DownloadUrl: `${mirrorBase}/AI-Helper-${tag}-macOS-aarch64.dmg`,
  ossMacArm64DownloadUrl: `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-macOS-aarch64.dmg`,
  macX64DownloadUrl: `${mirrorBase}/AI-Helper-${tag}-macOS-x64.dmg`,
  ossMacX64DownloadUrl: `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-macOS-x64.dmg`,
  fastSetupDownloadUrl: `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  fastZipDownloadUrl: `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  fastMacArm64DownloadUrl: `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-aarch64.dmg`,
  fastMacX64DownloadUrl: `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-x64.dmg`,
  githubSetupDownloadUrl: `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Setup.exe`,
  githubZipDownloadUrl: `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-Windows-x64-Standalone.zip`,
  githubMacArm64DownloadUrl: `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-aarch64.dmg`,
  githubMacX64DownloadUrl: `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-x64.dmg`,
  releasePageUrl: `https://github.com/${repoName}/releases/tag/${tag}`
};

fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');
console.log(`[sync-website] ✓ website/version.json 已生成 (发布日期: ${releaseDate})`);

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
    if (cfg.macosChannels) {
      if (cfg.macosChannels.arm64) {
        cfg.macosChannels.arm64.fileName = `AI-Helper-${tag}-macOS-aarch64.dmg`;
        cfg.macosChannels.arm64.direct = `${mirrorBase}/AI-Helper-${tag}-macOS-aarch64.dmg`;
        cfg.macosChannels.arm64.oss = `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-macOS-aarch64.dmg`;
        cfg.macosChannels.arm64.mirror = `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-aarch64.dmg`;
        cfg.macosChannels.arm64.github = `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-aarch64.dmg`;
      }
      if (cfg.macosChannels.x64) {
        cfg.macosChannels.x64.fileName = `AI-Helper-${tag}-macOS-x64.dmg`;
        cfg.macosChannels.x64.direct = `${mirrorBase}/AI-Helper-${tag}-macOS-x64.dmg`;
        cfg.macosChannels.x64.oss = `https://bobdong.oss-cn-beijing.aliyuncs.com/desktop/AI-Helper-${tag}-macOS-x64.dmg`;
        cfg.macosChannels.x64.mirror = `${ghfastPrefix}https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-x64.dmg`;
        cfg.macosChannels.x64.github = `https://github.com/${repoName}/releases/download/${tag}/AI-Helper-${tag}-macOS-x64.dmg`;
      }
    }
    fs.writeFileSync(downloadConfigPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(`[sync-website] ✓ website/download-config.json 已同步 (版本: ${targetVersion})`);
  } catch (err) {
    console.warn(`[sync-website] 同步 download-config.json 警告:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.1 同步 GEO 相关页面：llms.txt、英文页、教程页、关于页、404 页
// ─────────────────────────────────────────────────────────────────────────────
for (const file of geoFiles) {
  if (!fs.existsSync(file)) continue;
  const date = pageDate(file);
  const before = fs.readFileSync(file, 'utf8');
  const after = syncSecondaryPage(before, date);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(`[sync-website] ✓ ${path.relative(repoRoot, file).replace(/\\/g, '/')} 已同步 (内容日期: ${date})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 同步 website/sitemap.xml 中的 <lastmod>（每页取各自的内容日期）
// ─────────────────────────────────────────────────────────────────────────────
if (fs.existsSync(sitemapPath)) {
  let sitemap = fs.readFileSync(sitemapPath, 'utf8');
  sitemap = sitemap.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = block.match(/<loc>([^<]+)<\/loc>/);
    if (!loc) return block;
    const file = sitemapLocToFile(loc[1]);
    const date = fs.existsSync(file) ? pageDate(file) : today;
    return block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${date}</lastmod>`);
  });
  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
  console.log(`[sync-website] ✓ website/sitemap.xml 已同步 (lastmod 按页面内容日期)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 由已同步的 llms.txt 与各页面重新生成 website/llms-full.txt
// ─────────────────────────────────────────────────────────────────────────────
execFileSync(process.execPath, [path.join(__dirname, 'build-llms-full.js')], { stdio: 'inherit' });

console.log(`[sync-website] 全部官网文件同步完成！`);
