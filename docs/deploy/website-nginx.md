# 官网 nginx 配置：真 404 与 llms.txt

官网 `website/` 由服务器上的 nginx 托管（`scripts/sync-mirror.sh` 会把仓库中的 `website/` 同步到站点根目录，默认 `/var/www/ai-helper`），前面还有一层 Cloudflare。nginx 配置不在仓库里，需要在服务器上手动修改。

## 为什么要改

2026-11-20 用 `curl -I` 检查线上站点：

| 请求 | 实际返回 | 应该返回 |
| --- | --- | --- |
| `/llms.txt` | `200 text/html`（首页 HTML） | `200 text/plain; charset=utf-8` |
| `/some-random-path-xyz` | `200 text/html`（首页 HTML） | `404` |

不存在的路径返回首页（"软 404"），通常是 `try_files $uri $uri/ /index.html;` 这种 SPA 兜底规则造成的。官网是纯静态多页面站点，不需要这个兜底。它的后果是：

- 新增的 `llms.txt`、`/guides/`、`/en/` 在部署前访问也会得到首页，看不出是否部署成功。
- 搜索引擎和 AI 爬虫会把任意无效 URL 当成首页的重复页面。

## 建议配置

在 `server { ... }` 中，**保留**现有的 `/downloads/`、`/webhook/`、`/api/` 等反向代理或特殊 location，只替换静态站点的兜底部分：

```nginx
root  /var/www/ai-helper;
index index.html;

# 不存在的路径返回真正的 404，并展示 website/404.html
error_page 404 /404.html;
location = /404.html {
    internal;
}

# llms.txt：纯文本 + UTF-8，避免中文乱码
location = /llms.txt {
    default_type text/plain;
    charset utf-8;
    add_header Cache-Control "public, max-age=3600";
}

# 静态页面：/guides/ → guides/index.html，/en/ → en/index.html
location / {
    try_files $uri $uri/ =404;
}
```

修改后执行 `nginx -t && nginx -s reload`。

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
