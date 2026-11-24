#!/usr/bin/env node

/**
 * scripts/build-llms-full.js
 *
 * 生成 website/llms-full.txt：把 llms.txt（核心事实）、首页 FAQ（中英）与全部教程正文
 * 转成一份纯 Markdown，方便 AI 搜索 / 大模型一次抓取完整上下文。
 *
 * 内容完全来自网页本身，不要手动编辑 llms-full.txt —— 改网页后重新运行：
 *   node scripts/build-llms-full.js
 * sync-website.js 在每次同步结束时会自动调用本脚本。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, '..', 'website');
const SITE = 'https://helper.bob-api.com';

const read = (rel) => fs.readFileSync(path.join(websiteDir, rel), 'utf8').replace(/\r\n/g, '\n');

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rarr;/g, '→')
    .replace(/&larr;/g, '←')
    .replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

const absUrl = (href) => (href.startsWith('/') ? SITE + href : href);

/** 行内元素 → Markdown */
function inline(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => '`' + c.replace(/<[^>]+>/g, '') + '`')
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
        const label = text.replace(/<[^>]+>/g, '').trim();
        return href.startsWith('#') ? label : `[${label}](${absUrl(href)})`;
      })
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t\n]+/g, ' ')
    .trim();
}

function table(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inline(c[1]).replace(/\|/g, '\\|'))
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => '| ' + Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ') + ' |';
  return [line(rows[0]), '| ' + Array(width).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
}

function list(html, ordered) {
  let n = 0;
  return [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => (ordered ? `${++n}. ` : '- ') + inline(m[1]))
    .join('\n');
}

/** 文章块级结构 → Markdown（只处理教程页实际用到的标签） */
function articleToMarkdown(html) {
  const blocks = [];
  const re =
    /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>|<pre[^>]*>([\s\S]*?)<\/pre>|<table[^>]*>([\s\S]*?)<\/table>|<(ul|ol)[^>]*>([\s\S]*?)<\/\5>|<p[^>]*>([\s\S]*?)<\/p>|<div class="note"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) blocks.push('#'.repeat(Number(m[1][1]) + 1) + ' ' + inline(m[2]));
    else if (m[3] !== undefined) blocks.push('```\n' + decodeEntities(m[3].replace(/<[^>]+>/g, '')).trim() + '\n```');
    else if (m[4] !== undefined) blocks.push(table(m[4]));
    else if (m[5]) blocks.push(list(m[6], m[5] === 'ol'));
    else if (m[7] !== undefined) {
      const text = inline(m[7]);
      if (text) blocks.push(text);
    } else if (m[8] !== undefined) blocks.push('> ' + inline(m[8]));
  }
  return blocks.filter(Boolean).join('\n\n');
}

/** 一篇教程 → 「## 标题 + Source 行 + 正文」，标题取 <h1>，正文不含 <h1> */
function guide(rel) {
  const html = read(rel);
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (!article) return '';
  const h1 = article[1].match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? inline(h1[1]) : rel;
  // 去掉 h1 本身，以及 CTA 与页尾导航类段落，保留正文
  const body = articleToMarkdown(article[1].replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, ''))
    .split('\n\n')
    .filter((b) => !/^\[(下载 AI Helper|Download AI Helper)\]/.test(b))
    .join('\n\n');
  return `## ${title}\n\nSource: ${SITE}/${rel}\n\n${body}`;
}

/** 从页面的 FAQPage JSON-LD 取问答（与页面可见 FAQ 一致） */
function faqFromJsonLd(rel) {
  const html = read(rel);
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch (error) {
      throw new Error(`[build-llms-full] website/${rel} 的 JSON-LD 无法解析：${error.message}`);
    }
    const nodes = data['@graph'] || [data];
    for (const node of nodes) {
      const types = [].concat(node['@type']);
      if (!types.includes('FAQPage')) continue;
      for (const q of node.mainEntity || []) out.push(`### ${q.name}\n\n${q.acceptedAnswer?.text ?? ''}`);
    }
  }
  return out.join('\n\n');
}

const listGuides = (dir) =>
  fs.existsSync(path.join(websiteDir, dir))
    ? fs
        .readdirSync(path.join(websiteDir, dir))
        .filter((n) => n.endsWith('.html') && n !== 'index.html')
        .sort()
        .map((n) => `${dir}/${n}`)
    : [];

const llms = read('llms.txt').trim();
const sections = [
  llms.replace(/^# .*\n/, '# Bob AI Helper — full context (llms-full.txt)\n'),
  `> This file concatenates ${SITE}/llms.txt, the homepage FAQ and every guide on ${SITE} as plain Markdown. It is generated from the web pages by scripts/build-llms-full.js; the web pages are the source of truth.`,
  '## Homepage FAQ (English)\n\n' + faqFromJsonLd('en/index.html'),
  '## 首页常见问题（中文）\n\n' + faqFromJsonLd('index.html'),
  ...listGuides('en/guides').map((rel) => '---\n\n' + guide(rel)),
  ...listGuides('guides').map((rel) => '---\n\n' + guide(rel)),
];

// 只压缩代码块之外的多余空行，代码块（```）原样保留
const output =
  sections
    .join('\n\n')
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\n{3,}/g, '\n\n')))
    .join('') + '\n';
fs.writeFileSync(path.join(websiteDir, 'llms-full.txt'), output, 'utf8');
console.log(`[build-llms-full] ✓ website/llms-full.txt (${(output.length / 1024).toFixed(1)} KB)`);
