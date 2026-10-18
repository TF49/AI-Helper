/**
 * src/lib/clientTelemetry.ts
 * AI-Helper 客户端全量遥测与故障诊断 SDK (Desktop Client Telemetry)
 *
 * 负责在用户使用 AI-Helper 桌面客户端时：
 * 1. 启动时自动上报真实设备硬件配置 (OS, CPU, 内存, 客户端版本)
 * 2. 捕获未处理的客户端运行时异常与崩溃堆栈并静默上报
 * 3. 统计使用频次与活跃心跳
 */

import { getSystemDiagnosticInfo, isTauri } from './api';
import { getVersion } from '@tauri-apps/api/app';

const STORAGE_KEYS = {
  DEVICE_ID: 'ai_helper_telemetry_device_id',
  SESSION_ID: 'ai_helper_telemetry_session_id',
  SERVER_URL: 'ai_helper_telemetry_server_url',
};

// 默认服务器上报地址 (您的公网服务器)
const DEFAULT_SERVER_URL =
  (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEYS.SERVER_URL)) ||
  'http://64.118.130.216:3001/api/telemetry/report';

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
    if (!id) {
      id = `dev_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString(36)}`;
      localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
    }
    return id;
  } catch {
    return `dev_fallback_${Date.now()}`;
  }
}

function getOrCreateSessionId(): string {
  try {
    let sid = sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
    if (!sid) {
      sid = `sess_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
      sessionStorage.setItem(STORAGE_KEYS.SESSION_ID, sid);
    }
    return sid;
  } catch {
    return `sess_fallback_${Date.now()}`;
  }
}

export interface ClientTelemetryOptions {
  appVersion?: string;
  serverUrl?: string;
  enableAutoReportErrors?: boolean;
}

class ClientTelemetry {
  private deviceId: string;
  private sessionId: string;
  private appVersion: string = '1.0.69';
  private serverUrl: string;
  private sessionStartTime: number;
  private isInitialized = false;

  constructor() {
    this.deviceId = getOrCreateDeviceId();
    this.sessionId = getOrCreateSessionId();
    this.serverUrl = DEFAULT_SERVER_URL;
    this.sessionStartTime = Date.now();
  }

  public async init(options?: ClientTelemetryOptions) {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (options?.appVersion) {
      this.appVersion = options.appVersion;
    } else if (isTauri) {
      try {
        this.appVersion = await getVersion();
      } catch {}
    }
    if (options?.serverUrl) this.serverUrl = options.serverUrl;

    // 1. 发送应用启动上报
    await this.reportAppLaunch();

    // 2. 挂载全局异常监听
    if (options?.enableAutoReportErrors !== false) {
      this.setupErrorListeners();
    }

    // 3. 活跃心跳 (每 3 分钟)
    setInterval(() => {
      void this.sendHeartbeat();
    }, 180000);
  }

  /** 获取设备硬件与环境信息 */
  private async gatherMachineInfo() {
    let osInfo = 'Windows';
    try {
      if (isTauri) {
        osInfo = (await getSystemDiagnosticInfo()) || navigator.userAgent;
      } else {
        osInfo = navigator.userAgent;
      }
    } catch {
      osInfo = navigator.userAgent;
    }

    const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
    const scr = typeof window !== 'undefined' ? window.screen : ({} as Screen);

    return {
      osName: osInfo,
      arch: /arm64|aarch64/i.test(osInfo) ? 'arm64' : 'x86_64',
      cpuCores: nav.hardwareConcurrency || 4,
      deviceMemoryGb: (nav as { deviceMemory?: number }).deviceMemory
        ? `>= ${(nav as { deviceMemory?: number }).deviceMemory} GB`
        : 'Unknown',
      screenResolution: `${scr.width || 1920} × ${scr.height || 1080} (DPR: ${window.devicePixelRatio || 1})`,
      gpuRenderer: this.detectGpuRenderer(),
      language: nav.language || 'zh-CN',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    };
  }

  private detectGpuRenderer(): string {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          return (
            (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ||
            'Generic WebGL'
          );
        }
      }
    } catch {}
    return 'Generic GPU';
  }

  /** 上报客户端启动事件 */
  public async reportAppLaunch() {
    try {
      const machineInfo = await this.gatherMachineInfo();
      const payload = {
        report_meta: {
          device_id: this.deviceId,
          session_id: this.sessionId,
          app_version: this.appVersion,
          session_duration_sec: 0,
          custom_note: 'App Launched',
        },
        machine_info: machineInfo,
        usage_frequency: {
          total_invocations: 1,
        },
      };

      await this.sendToServer(payload);
    } catch (e) {
      console.warn('[Telemetry] 启动上报异常 (静默忽略):', e);
    }
  }

  /** 发送会话活跃心跳 */
  public async sendHeartbeat() {
    try {
      const durationSec = Math.round((Date.now() - this.sessionStartTime) / 1000);
      const payload = {
        report_meta: {
          device_id: this.deviceId,
          session_id: this.sessionId,
          app_version: this.appVersion,
          session_duration_sec: durationSec,
          custom_note: 'Client Heartbeat',
        },
      };
      await this.sendToServer(payload);
    } catch {}
  }

  /** 上报致命或运行时报错 */
  public async reportError(error: { type: string; message: string; stack?: string; source?: string }) {
    try {
      const machineInfo = await this.gatherMachineInfo();
      const payload = {
        report_meta: {
          device_id: this.deviceId,
          session_id: this.sessionId,
          app_version: this.appVersion,
          session_duration_sec: Math.round((Date.now() - this.sessionStartTime) / 1000),
          custom_note: `Client Error: ${error.type}`,
        },
        machine_info: machineInfo,
        error_details: {
          errorType: error.type,
          message: error.message,
          stack: error.stack || '',
          source_file: error.source || '',
        },
      };

      await this.sendToServer(payload);
    } catch (e) {
      console.warn('[Telemetry] 错误上报异常:', e);
    }
  }

  /** 记录用户操作或业务功能打点 */
  public async recordAction(actionName: string, durationSec?: number) {
    try {
      const payload = {
        report_meta: {
          device_id: this.deviceId,
          session_id: this.sessionId,
          app_version: this.appVersion,
          session_duration_sec: durationSec ?? Math.round((Date.now() - this.sessionStartTime) / 1000),
          custom_note: actionName,
        },
      };
      await this.sendToServer(payload);
    } catch {}
  }


  /** 挂载全局未捕获异常 */
  private setupErrorListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
      void this.reportError({
        type: 'JsRuntimeError',
        message: event.message || 'Unknown runtime error',
        stack: event.error?.stack || '',
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '',
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      void this.reportError({
        type: 'UnhandledPromiseRejection',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : '',
      });
    });
  }

  /** 发送请求至监控中心后端 */
  private async sendToServer(payload: unknown): Promise<void> {
    const url = this.serverUrl;
    if (!url) return;

    const bodyStr = JSON.stringify(payload);

    // 优先尝试 sendBeacon (页面退出或切换时不阻塞)
    if (typeof navigator.sendBeacon === 'function' && bodyStr.length < 65000) {
      const blob = new Blob([bodyStr], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }

    // 回退为 fetch (并支持自动迁移至新配置的域名地址)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        keepalive: true,
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.new_server_url && typeof data.new_server_url === 'string' && data.new_server_url.startsWith('http')) {
          if (data.new_server_url !== this.serverUrl) {
            this.serverUrl = data.new_server_url;
            try {
              localStorage.setItem(STORAGE_KEYS.SERVER_URL, data.new_server_url);
            } catch {}
          }
        }
      }
    } catch {}
  }
}

export const clientTelemetry = new ClientTelemetry();
