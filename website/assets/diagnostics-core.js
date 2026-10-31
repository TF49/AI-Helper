/**
 * website/assets/diagnostics-core.js
 * AI-Helper 诊断与监控核心引擎 (Telemetry & Diagnostics Core SDK)
 *
 * 功能：
 * 1. 深度探测机器与硬件环境信息 (OS, CPU, GPU, 内存, 屏幕, 浏览器内核, 时区, 网络)
 * 2. 运行时异常自动监听与错误堆栈捕获 (window.onerror, unhandledrejection, API 报错)
 * 3. 使用频率与行为埋点打点 (会话时长, 心跳, 每日/累计使用频次)
 * 4. 多通道上报调度器 (通用 REST API, 飞书 Webhook 告警卡片, 本地持久化模拟)
 */

(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    CONFIG: 'ai_helper_telemetry_config',
    LOGS: 'ai_helper_telemetry_logs',
    DAILY_STATS: 'ai_helper_telemetry_daily_stats',
    DEVICE_ID: 'ai_helper_telemetry_device_id',
    SESSION_ID: 'ai_helper_telemetry_session_id',
  };

  const defaultApiEndpoint = (typeof window !== 'undefined' && window.location.port === '3001')
    ? `${window.location.origin}/api/telemetry/report`
    : ((typeof window !== 'undefined' && localStorage.getItem('ai_helper_telemetry_server_base'))
        ? `${localStorage.getItem('ai_helper_telemetry_server_base').replace(/\/+$/, '')}/api/telemetry/report`
        : `${window.location.origin}/api/telemetry/report`);

  const DEFAULT_CONFIG = {
    enabled: true,
    autoReportErrors: true,
    heartbeatIntervalSec: 60,
    apiEndpoint: defaultApiEndpoint,
    feishuWebhookUrl: '',
    enableFeishuReport: false,
    enableApiReport: true,
    enableLocalPersistence: true,
    maxLocalLogs: 150,
  };

  /** 生成类似 UUID 的唯一随机 ID */
  function generateId(prefix = '') {
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    const uuid = `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
    return prefix ? `${prefix}_${uuid}` : uuid;
  }

  /** 获取或初始化持久化设备 ID */
  function getOrCreateDeviceId() {
    try {
      let id = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
      if (!id) {
        id = generateId('dev');
        localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
      }
      return id;
    } catch {
      return generateId('dev_temp');
    }
  }

  /** 获取或初始化单次会话 ID */
  function getOrCreateSessionId() {
    try {
      let sid = sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
      if (!sid) {
        sid = generateId('sess');
        sessionStorage.setItem(STORAGE_KEYS.SESSION_ID, sid);
      }
      return sid;
    } catch {
      return generateId('sess_temp');
    }
  }

  class DiagnosticsCore {
    constructor() {
      this.version = '1.0.74';
      this.deviceId = getOrCreateDeviceId();
      this.sessionId = getOrCreateSessionId();
      this.sessionStartTime = Date.now();
      this.breadcrumbs = [];
      this.listeners = new Set();
      this.heartbeatTimer = null;

      // 加载配置
      this.config = this.loadConfig();

      // 缓存的机器与环境信息
      this.machineInfo = null;

      // 初始化打点与异常捕获
      this.init();
    }

    /** 读取用户自定义配置 (混合默认配置) */
    loadConfig() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
        if (raw) {
          return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
        }
      } catch (err) {
        console.warn('[DiagnosticsCore] 读取配置失败，使用默认配置:', err);
      }
      return Object.assign({}, DEFAULT_CONFIG);
    }

    /** 更新并持久化配置 */
    saveConfig(newConfig) {
      this.config = Object.assign({}, this.config, newConfig);
      try {
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(this.config));
        this.emit('config-change', this.config);
      } catch (err) {
        console.error('[DiagnosticsCore] 保存配置失败:', err);
      }
    }

    /** 初始化核心组件 */
    init() {
      this.probeMachineInfo();
      this.recordDailyInvocation();
      this.setupGlobalErrorHandlers();
      this.setupHeartbeat();
      this.addBreadcrumb('system', '诊断与监控核心模块初始化完成');
    }

    /** 订阅内部事件 */
    on(event, callback) {
      this.listeners.add({ event, callback });
      return () => {
        this.listeners.forEach((item) => {
          if (item.event === event && item.callback === callback) {
            this.listeners.delete(item);
          }
        });
      };
    }

    /** 触发事件 */
    emit(event, data) {
      this.listeners.forEach((item) => {
        if (item.event === event || item.event === '*') {
          try {
            item.callback(data, event);
          } catch (e) {
            console.error('[DiagnosticsCore] 事件监听回调报错:', e);
          }
        }
      });
    }

    /** 记录用户面包屑轨迹 (便于报错时还原复现场景) */
    addBreadcrumb(category, message, data = null) {
      const crumb = {
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        category,
        message,
        data,
      };
      this.breadcrumbs.push(crumb);
      if (this.breadcrumbs.length > 25) {
        this.breadcrumbs.shift();
      }
    }

    /** 深度探测机器与硬件信息 */
    probeMachineInfo() {
      const nav = typeof navigator !== 'undefined' ? navigator : {};
      const win = typeof window !== 'undefined' ? window : {};
      const screen = win.screen || {};

      // 1. 探测操作系统
      const ua = nav.userAgent || '';
      let osName = 'Unknown OS';
      let arch = 'x86_64';

      if (/Win64|x64|WOW64/i.test(ua)) {
        arch = 'x86_64';
      } else if (/arm64|aarch64/i.test(ua)) {
        arch = 'arm64';
      }

      if (/Windows NT 10.0/i.test(ua)) {
        // Windows 11 与 Windows 10 NT 均为 10.0，若有 userAgentData 可做更精准判断
        osName = 'Windows 10 / 11';
      } else if (/Windows NT 6.3/i.test(ua)) {
        osName = 'Windows 8.1';
      } else if (/Windows NT 6.1/i.test(ua)) {
        osName = 'Windows 7';
      } else if (/Macintosh|Mac OS X/i.test(ua)) {
        const match = ua.match(/Mac OS X ([0-9_]+)/);
        const macVer = match ? match[1].replace(/_/g, '.') : '';
        // 探测 Apple Silicon (M1/M2/M3/M4)
        if (nav.maxTouchPoints > 2 || /arm/i.test(nav.platform || '')) {
          arch = 'Apple Silicon (arm64)';
          osName = macVer ? `macOS ${macVer} (Apple Silicon)` : 'macOS (Apple Silicon)';
        } else {
          osName = macVer ? `macOS ${macVer}` : 'macOS';
        }
      } else if (/Linux/i.test(ua)) {
        osName = 'Linux';
      } else if (/Android/i.test(ua)) {
        osName = 'Android';
      } else if (/iPhone|iPad|iPod/i.test(ua)) {
        osName = 'iOS';
      }

      // 2. 探测 GPU 显卡型号 (基于 WebGL 上下文调试信息)
      let gpuRenderer = 'Unspecified GPU';
      let gpuVendor = 'Generic';
      let webglSupported = false;
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          webglSupported = true;
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || gpuRenderer;
            gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || gpuVendor;
          } else {
            gpuRenderer = gl.getParameter(gl.RENDERER) || gpuRenderer;
            gpuVendor = gl.getParameter(gl.VENDOR) || gpuVendor;
          }
        }
      } catch (err) {
        gpuRenderer = `Detection restricted (${err.message || 'Error'})`;
      }

      // 3. 内存与核心数
      const cpuCores = nav.hardwareConcurrency || 4;
      const deviceMemoryGb = nav.deviceMemory ? `>= ${nav.deviceMemory} GB` : 'Unavailable (Privacy)';

      // 4. 屏幕与显示
      const screenResolution = `${screen.width || win.innerWidth} × ${screen.height || win.innerHeight}`;
      const colorDepth = screen.colorDepth ? `${screen.colorDepth}-bit` : '24-bit';
      const dpr = win.devicePixelRatio ? win.devicePixelRatio.toFixed(2) : '1.00';

      // 5. 语言与时区
      let timezone = 'UTC';
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {}

      const language = nav.language || 'zh-CN';

      // 6. 网络状态
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
      const networkType = conn ? conn.effectiveType || conn.type || 'wifi' : 'online';
      const isOnline = typeof nav.onLine === 'boolean' ? nav.onLine : true;

      this.machineInfo = {
        osName,
        arch,
        cpuCores,
        deviceMemoryGb,
        gpuRenderer,
        gpuVendor,
        webglSupported,
        screenResolution: `${screenResolution} (DPR: ${dpr}, ${colorDepth})`,
        screenWidth: screen.width || win.innerWidth,
        screenHeight: screen.height || win.innerHeight,
        dpr: Number(dpr),
        timezone,
        language,
        isOnline,
        networkType,
        userAgent: ua,
        detectedAt: new Date().toISOString(),
      };

      return this.machineInfo;
    }

    /** 异步测量到达 Bob-API 与镜像源的真实端到端网络延迟 */
    async pingNetworkLatency(endpointUrl = 'https://helper.bob-api.com/version.json') {
      const startTime = performance.now();
      try {
        const cacheBuster = `_t=${Date.now()}`;
        const finalUrl = endpointUrl.includes('?') ? `${endpointUrl}&${cacheBuster}` : `${endpointUrl}?${cacheBuster}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(finalUrl, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const elapsedMs = Math.round(performance.now() - startTime);
        if (this.machineInfo) {
          this.machineInfo.apiLatencyMs = elapsedMs;
        }
        return { reachable: true, latencyMs: elapsedMs, endpoint: endpointUrl };
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - startTime);
        const isTimeout = err.name === 'AbortError';
        return {
          reachable: false,
          latencyMs: elapsedMs,
          error: isTimeout ? '请求超时 (>6000ms)' : (err.message || '网络连接异常'),
          endpoint: endpointUrl,
        };
      }
    }

    /** 记录每日使用频次与活跃数据 */
    recordDailyInvocation() {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        let stats = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_STATS) || '{}');

        if (!stats.dates) stats.dates = {};
        if (!stats.dates[todayStr]) {
          stats.dates[todayStr] = { count: 0, errors: 0, sessions: 0 };
        }

        stats.dates[todayStr].count = (stats.dates[todayStr].count || 0) + 1;
        stats.totalInvocations = (stats.totalInvocations || 0) + 1;

        // 会话首次启动标记
        if (!sessionStorage.getItem('ai_helper_session_counted')) {
          stats.dates[todayStr].sessions = (stats.dates[todayStr].sessions || 0) + 1;
          sessionStorage.setItem('ai_helper_session_counted', '1');
        }

        localStorage.setItem(STORAGE_KEYS.DAILY_STATS, JSON.stringify(stats));
      } catch (e) {
        console.warn('[DiagnosticsCore] 更新调用统计失败:', e);
      }
    }

    /** 记录当天发生的错误数 */
    recordDailyErrorCount() {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        let stats = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_STATS) || '{}');
        if (!stats.dates) stats.dates = {};
        if (!stats.dates[todayStr]) {
          stats.dates[todayStr] = { count: 1, errors: 0, sessions: 1 };
        }
        stats.dates[todayStr].errors = (stats.dates[todayStr].errors || 0) + 1;
        stats.totalErrors = (stats.totalErrors || 0) + 1;
        localStorage.setItem(STORAGE_KEYS.DAILY_STATS, JSON.stringify(stats));
      } catch {}
    }

    /** 获取所有统计数据 (供大盘渲染图表) */
    getUsageStats() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.DAILY_STATS);
        if (raw) return JSON.parse(raw);
      } catch {}
      return { totalInvocations: 1, totalErrors: 0, dates: {} };
    }

    /** 挂载全局异常拦截器 */
    setupGlobalErrorHandlers() {
      // 1. 运行时 JS 未捕获异常
      window.addEventListener('error', (event) => {
        // 忽略纯静态资源加载报错以免日志被无害网络波动刷屏，但记录主要 JS 报错
        const isResourceError = event.target && (event.target.tagName === 'IMG' || event.target.tagName === 'SCRIPT');
        if (isResourceError && !event.message) return;

        this.handleCapturedError({
          errorType: 'JsRuntimeError',
          message: event.message || 'Unknown runtime error',
          filename: event.filename || 'inline',
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error && event.error.stack ? event.error.stack : 'No stack trace available',
        });
      });

      // 2. 未捕获的异步 Promise 拒绝
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        let message = 'Unhandled Promise Rejection';
        let stack = '';

        if (reason instanceof Error) {
          message = reason.message;
          stack = reason.stack || '';
        } else if (typeof reason === 'string') {
          message = reason;
        } else {
          try {
            message = JSON.stringify(reason);
          } catch {
            message = String(reason);
          }
        }

        this.handleCapturedError({
          errorType: 'UnhandledPromiseRejection',
          message,
          stack: stack || 'No stack trace available',
        });
      });
    }

    /** 统一处理并落库已捕获的错误 */
    handleCapturedError(errorDetail) {
      this.recordDailyErrorCount();

      const logItem = {
        id: generateId('err'),
        timestamp: Date.now(),
        timeFormatted: new Date().toLocaleTimeString(),
        dateFormatted: new Date().toLocaleDateString(),
        level: 'ERROR',
        errorType: errorDetail.errorType || 'Error',
        message: errorDetail.message || '未命名错误',
        stack: errorDetail.stack || '',
        source: errorDetail.filename ? `${errorDetail.filename}:${errorDetail.lineno || 0}:${errorDetail.colno || 0}` : 'Unknown source',
        breadcrumbs: [...this.breadcrumbs],
        machineSnapshot: Object.assign({}, this.machineInfo || this.probeMachineInfo()),
        sessionId: this.sessionId,
        deviceId: this.deviceId,
      };

      // 1. 本地存储落库
      this.saveLogToLocal(logItem);

      // 2. 触发事件让 UI 刷新
      this.emit('new-log', logItem);

      // 3. 若配置了自动上报，向目标通道派发
      if (this.config.autoReportErrors) {
        this.dispatchReport(logItem, 'error');
      }
    }

    /** 手动记录业务日志或自定义错误 */
    recordLog(level, category, message, extra = null) {
      const logItem = {
        id: generateId('log'),
        timestamp: Date.now(),
        timeFormatted: new Date().toLocaleTimeString(),
        dateFormatted: new Date().toLocaleDateString(),
        level: level.toUpperCase(), // 'INFO' | 'WARN' | 'ERROR'
        errorType: category,
        message,
        extra,
        breadcrumbs: [...this.breadcrumbs],
        machineSnapshot: Object.assign({}, this.machineInfo || this.probeMachineInfo()),
        sessionId: this.sessionId,
        deviceId: this.deviceId,
      };

      this.saveLogToLocal(logItem);
      this.emit('new-log', logItem);

      if (level === 'ERROR' && this.config.autoReportErrors) {
        this.dispatchReport(logItem, 'error');
      }

      return logItem;
    }

    /** 本地持久化保存日志列表 (最多保留 maxLocalLogs 条) */
    saveLogToLocal(logItem) {
      if (!this.config.enableLocalPersistence) return;
      try {
        let logs = this.getLocalLogs();
        logs.unshift(logItem);
        if (logs.length > (this.config.maxLocalLogs || 150)) {
          logs = logs.slice(0, this.config.maxLocalLogs || 150);
        }
        localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
      } catch (e) {
        console.warn('[DiagnosticsCore] 本地日志写入失败:', e);
      }
    }

    /** 读取所有本地存储的历史日志 */
    getLocalLogs() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.LOGS);
        if (raw) return JSON.parse(raw);
      } catch {}
      return [];
    }

    /** 清空本地诊断日志 */
    clearLocalLogs() {
      try {
        localStorage.removeItem(STORAGE_KEYS.LOGS);
        this.emit('logs-cleared', null);
      } catch {}
    }

    /** 定时心跳机制 (更新活跃时长与频率) */
    setupHeartbeat() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      const intervalMs = Math.max(15, this.config.heartbeatIntervalSec || 60) * 1000;

      this.heartbeatTimer = setInterval(() => {
        const durationSec = Math.round((Date.now() - this.sessionStartTime) / 1000);
        this.addBreadcrumb('heartbeat', `会话活跃心跳 - 停留时长: ${durationSec}s`);
        this.emit('heartbeat', { durationSec, timestamp: Date.now() });

        // 如果配置了启用 API 上报心跳
        if (this.config.enableApiReport && this.config.apiEndpoint) {
          this.dispatchReport(
            {
              type: 'heartbeat',
              durationSec,
              sessionId: this.sessionId,
              deviceId: this.deviceId,
              timestamp: Date.now(),
            },
            'heartbeat'
          );
        }
      }, intervalMs);
    }

    /** 生成完整的单机诊断分析报告对象 */
    generateFullDiagnosticPayload(customNote = '') {
      const stats = this.getUsageStats();
      const logs = this.getLocalLogs();
      const errorLogs = logs.filter((l) => l.level === 'ERROR');

      return {
        report_meta: {
          report_id: generateId('report'),
          generated_at: new Date().toISOString(),
          app_version: this.version,
          device_id: this.deviceId,
          session_id: this.sessionId,
          session_duration_sec: Math.round((Date.now() - this.sessionStartTime) / 1000),
          custom_note: customNote || 'User Diagnostic Submission',
        },
        machine_info: this.machineInfo || this.probeMachineInfo(),
        usage_frequency: {
          total_invocations: stats.totalInvocations || 0,
          total_errors: stats.totalErrors || 0,
          recent_days: stats.dates || {},
        },
        recent_error_summary: {
          total_captured_errors: errorLogs.length,
          latest_errors: errorLogs.slice(0, 5).map((e) => ({
            time: e.timeFormatted,
            type: e.errorType,
            message: e.message,
            stack: (e.stack || '').split('\n').slice(0, 4).join('\n'),
          })),
        },
        breadcrumbs: this.breadcrumbs,
      };
    }

    /** 核心调度：分发上报到各个通道 (REST API / 飞书 Webhook) */
    async dispatchReport(payload, triggerType = 'manual') {
      const fullPayload = this.generateFullDiagnosticPayload(
        typeof payload === 'object' && payload.message ? `[${payload.level || 'LOG'}] ${payload.message}` : ''
      );

      const results = {
        apiResult: null,
        feishuResult: null,
      };

      // 1. 发送至通用 REST API
      if (this.config.enableApiReport && this.config.apiEndpoint) {
        try {
          const bodyStr = JSON.stringify(fullPayload);
          // 优先尝试 navigator.sendBeacon (页面关闭时亦能稳定送达)
          let beaconSent = false;
          if (typeof navigator.sendBeacon === 'function' && bodyStr.length < 65000) {
            const blob = new Blob([bodyStr], { type: 'application/json' });
            beaconSent = navigator.sendBeacon(this.config.apiEndpoint, blob);
          }

          if (!beaconSent) {
            const res = await fetch(this.config.apiEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: bodyStr,
              keepalive: true,
            });
            results.apiResult = { success: res.ok, status: res.status };
          } else {
            results.apiResult = { success: true, via: 'sendBeacon' };
          }
        } catch (err) {
          results.apiResult = { success: false, error: err.message };
        }
      }

      // 2. 发送至飞书群机器人 Webhook (若开启)
      if (this.config.enableFeishuReport && this.config.feishuWebhookUrl) {
        try {
          const feishuCard = this.buildFeishuCard(fullPayload, payload, triggerType);
          const res = await fetch(this.config.feishuWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feishuCard),
          });
          const resData = await res.json().catch(() => ({}));
          results.feishuResult = { success: res.ok && resData.code === 0, response: resData };
        } catch (err) {
          results.feishuResult = { success: false, error: err.message };
        }
      }

      this.emit('report-dispatched', { results, payload: fullPayload, triggerType });
      return results;
    }

    /** 拼装高质量的飞书富文本告警卡片 */
    buildFeishuCard(fullPayload, specificPayload, triggerType) {
      const m = fullPayload.machine_info;
      const isError = triggerType === 'error' || (specificPayload && specificPayload.level === 'ERROR');

      const templateColor = isError ? 'carmine' : 'turquoise';
      const headerTitle = isError ? '🚨 AI-Helper 异常诊断告警' : '📊 AI-Helper 诊断上报报告';

      let errorContent = '无报错信息 (正常健康运行)';
      if (specificPayload && specificPayload.message) {
        errorContent = `**错误类型：** ${specificPayload.errorType || 'Error'}\n**详细信息：** ${specificPayload.message}\n` +
          (specificPayload.stack ? `**调用栈简要：**\n\`\`\`\n${specificPayload.stack.slice(0, 400)}\n\`\`\`` : '');
      }

      return {
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: {
            template: templateColor,
            title: { tag: 'plain_text', content: headerTitle },
          },
          elements: [
            {
              tag: 'div',
              fields: [
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**客户端/页面：**\nv${fullPayload.report_meta.app_version}` },
                },
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**操作系统：**\n${m.osName} (${m.arch})` },
                },
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**硬件核心：**\n${m.cpuCores} 核 CPU | ${m.deviceMemoryGb}` },
                },
                {
                  is_short: true,
                  text: { tag: 'lark_md', content: `**屏幕显示：**\n${m.screenResolution}` },
                },
                {
                  is_short: false,
                  text: { tag: 'lark_md', content: `**显卡渲染器 (GPU)：**\n${m.gpuRenderer}` },
                },
              ],
            },
            { tag: 'hr' },
            {
              tag: 'div',
              text: { tag: 'lark_md', content: `### 诊断事件与报错详情\n${errorContent}` },
            },
            {
              tag: 'note',
              elements: [
                {
                  tag: 'plain_text',
                  content: `上报设备: ${fullPayload.report_meta.device_id} | 会话: ${fullPayload.report_meta.session_id} | 时间: ${new Date().toLocaleString()}`,
                },
              ],
            },
          ],
        },
      };
    }
  }

  // 挂载至全局命名空间
  global.DiagnosticsCore = new DiagnosticsCore();

})(typeof window !== 'undefined' ? window : this);
