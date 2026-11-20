# 官网 nginx 配置：真 404 与 llms.txt

官网 `website/` 由服务器上的 nginx 托管，前面还有一层 Cloudflare。服务器路径：

| 项目 | 路径 |
| --- | --- |
| 仓库 | `/www/ai-helper/repo` |
| 站点根目录 | `/www/ai-helper/site` |
| 安装包目录 | `/www/ai-helper/site/downloads`（不随网站同步，由 `sync-mirror.sh` 维护） |
| nginx 配置 | `/etc/nginx/sites-available/ai-helper`（启用名 `sites-enabled/zz-ai-helper`） |

`website/` 由两个 cron 任务同步到站点根目录：`/www/ai-helper/sync-website.sh`（每 5 分钟，`website/` 有变化时 rsync 并 reload nginx）和 `scripts/sync-mirror.sh`（每 10 分钟，`DOWNLOAD_DIR=/www/ai-helper/site/downloads`）。nginx 配置不在仓库里，需要在服务器上手动修改。

## 为什么要改

2026-11-20 用 `curl -I` 检查线上站点：

| 请求 | 实际返回 | 应该返回 |
| --- | --- | --- |
| `/llms.txt` | `200 text/plain`，无 charset（部署前为首页 HTML） | `200 text/plain; charset=utf-8` |
| `/some-random-path-xyz` | `200 text/html`（首页 HTML） | `404` |

不存在的路径返回首页（"软 404"），通常是 `try_files $uri $uri/ /index.html;` 这种 SPA 兜底规则造成的。官网是纯静态多页面站点，不需要这个兜底。它的后果是：

- 新增的 `llms.txt`、`/guides/`、`/en/` 在部署前访问也会得到首页，看不出是否部署成功。
- 搜索引擎和 AI 爬虫会把任意无效 URL 当成首页的重复页面。

## 建议配置

编辑 `/etc/nginx/sites-available/ai-helper`，在 443 的 `server { ... }` 中**保留**现有的 `/downloads/`、`/webhook/sync`、静态资源缓存等 location，只改以下部分：

```nginx
root /www/ai-helper/site;
index index.html;

# html / txt / xml / js 统一带 charset=utf-8（覆盖 llms.txt、robots.txt、sitemap.xml）
charset utf-8;

# 不存在的路径返回真正的 404，并展示 website/404.html
error_page 404 /404.html;
location = /404.html {
    internal;
    add_header Cache-Control "no-cache";
}

# 静态页面：/guides/ → guides/index.html，/en/ → en/index.html
# 原来是 try_files $uri $uri/ /index.html;（SPA 兜底，导致软 404）
location / {
    try_files $uri $uri/ =404;
    add_header Cache-Control "no-cache";
}
```

修改步骤：

```bash
cp /etc/nginx/sites-available/ai-helper /etc/nginx/sites-available/ai-helper.bak.$(date +%F)
vim /etc/nginx/sites-available/ai-helper
nginx -t && systemctl reload nginx
```

> 注意：nginx 的 `add_header` 不会从 server 继承到已经有自己 `add_header` 的 location，所以 server 末尾的 X-Frame-Options 等安全头目前实际不会下发。如需生效，要在每个带 `add_header` 的 location 里重复写，或者抽成 snippet 再 `include`。

## 验证

```bash
curl -sI https://helper.bob-api.com/llms.txt                 | grep -iE "^HTTP|content-type"
# 期望：HTTP/1.1 200 与 content-type: text/plain; charset=utf-8

curl -sI https://helper.bob-api.com/some-random-path-xyz     | grep -iE "^HTTP"
# 期望：HTTP/1.1 404

curl -sI https://helper.bob-api.com/guides/                  | grep -iE "^HTTP"
curl -sI https://helper.bob-api.com/en/                      | grep -iE "^HTTP"
# 期望：HTTP/1.1 200
```

如果 Cloudflare 仍返回旧结果，在 Cloudflare 控制台对 `/llms.txt` 和随机路径执行一次 Purge Cache。

## 部署后

1. 在 Google Search Console 和 Bing Webmaster Tools 重新提交 `https://helper.bob-api.com/sitemap.xml`（现在包含首页、英文页和 5 个教程页）。
2. 用 [Rich Results Test](https://search.google.com/test/rich-results) 或 [Schema Markup Validator](https://validator.schema.org/) 检查首页和教程页的结构化数据。
