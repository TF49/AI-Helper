#!/usr/bin/env node
/**
 * scripts/download-server.cjs
 * 
 * 后端下载配置分发服务（轻量级原生 Node.js 实现，零外部依赖）：
 * 1. 提供 GET /api/download 接口，根据 channel 参数从配置文件中动态读取下载地址并返回给前端；
 * 2. 避免前端硬编码任何外部下载链接，实现动静分离与配置热更新；
 * 3. 配置文件路径默认读取 website/download-config.json（兜底读取 website/version.json）。
 * 
 * 启动方式：
 *   node scripts/download-server.cjs [PORT]
 *   默认端口：3001
 * 
 * 接口说明：
 *   GET /api/download?channel=oss
 *   返回：{ "code": 200, "success": true, "channel": "oss", "name": "...", "downloadUrl": "..." }
 * 
 *   支持 302 直接重定向模式（可选）：
 *   GET /api/download?channel=oss&redirect=true
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = parseInt(process.env.PORT || process.argv[2] || "3001", 10);
const WEBSITE_DIR = path.resolve(__dirname, "../website");
const CONFIG_FILE = path.join(WEBSITE_DIR, "download-config.json");
const VERSION_FILE = path.join(WEBSITE_DIR, "version.json");

/**
 * 从配置文件中安全读取下载通道信息
 */
function getDownloadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[DownloadServer] 读取 download-config.json 异常:", err.message);
  }

  // 兜底读取 version.json
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const content = fs.readFileSync(VERSION_FILE, "utf-8");
      const verData = JSON.parse(content);
      return {
        version: verData.version,
        channels: {
          oss: {
            name: "阿里云 OSS 高速镜像",
            downloadUrl: verData.ossSetupDownloadUrl || "",
            enabled: true
          },
          direct: {
            name: "本站直链下载",
            downloadUrl: verData.setupDownloadUrl || "",
            enabled: true
          },
          mirror: {
            name: "国内加速镜像",
            downloadUrl: verData.fastSetupDownloadUrl || "",
            enabled: true
          }
        }
      };
    }
  } catch (err) {
    console.error("[DownloadServer] 读取 version.json 异常:", err.message);
  }

  return null;
}

const server = http.createServer((req, res) => {
  // CORS 响应头允许跨域
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 兼容 WHATWG URL 解析
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // 核心后端接口：/api/download
  if (pathname === "/api/download" || pathname === "/api/get-download-url") {
    const channelKey = (parsedUrl.searchParams.get("channel") || "oss").toLowerCase();
    const shouldRedirect = parsedUrl.searchParams.get("redirect") === "true" || parsedUrl.searchParams.get("redirect") === "1";

    const config = getDownloadConfig();
    if (!config || !config.channels) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        code: 500,
        success: false,
        message: "服务端未找到下载配置文件"
      }));
      return;
    }

    const channelData = config.channels[channelKey];
    if (!channelData || !channelData.downloadUrl) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        code: 404,
        success: false,
        message: `指定的通道 [${channelKey}] 不存在或未配置下载地址`,
        availableChannels: Object.keys(config.channels)
      }));
      return;
    }

    // 若请求携带 redirect=true，则直接 302 重定向到 OSS/目标地址
    if (shouldRedirect) {
      res.writeHead(302, { Location: channelData.downloadUrl });
      res.end();
      return;
    }

    // 默认返回 JSON 格式元数据
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate"
    });
    res.end(JSON.stringify({
      code: 200,
      success: true,
      channel: channelKey,
      name: channelData.name || channelKey,
      downloadUrl: channelData.downloadUrl,
      version: config.version || ""
    }));
    return;
  }

  // 健康检查 / 状态
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ code: 404, message: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`[DownloadServer] 下载后端 API 服务已启动: http://127.0.0.1:${PORT}`);
  console.log(`[DownloadServer] 测试接口: http://127.0.0.1:${PORT}/api/download?channel=oss`);
});
