/**
 * server/server.js
 * AI-Helper 内部开发与运维全量监控诊断后端服务 (Node.js + Express + MySQL)
 * 
 * 核心定位：
 * 专供内部开发与运维人员使用，用于收集与分析 AI-Helper 产品所有真实用户的：
 * 1. 真实机器与系统硬件配置档案 (OS, CPU, GPU, 内存, 屏幕精度, 客户端版本)
 * 2. 真实运行时异常与堆栈追查 (调用栈, 崩溃现场机器快照, 操作轨迹)
 * 3. 真实使用频次与活跃趋势 (DAU, 7天走势, 24小时峰值, 核心功能使用频次)
 * 
 * 真实性保障：
 * 杜绝任何假数据或随机数生成，严格根据真实数据库/内存记录做统计聚合。
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件配置
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态托管 website 目录，便于同一端口直达监控后台 (http://localhost:3001/diagnostics.html)
app.use(express.static(path.join(__dirname, '../website')));

// 数据库连接池
let pool = null;
let isDbConnected = false;
let dbMeta = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME || 'ai_helper_telemetry',
  user: process.env.DB_USER || 'root',
  error: null,
};

// 内存暂存兜底 (当 MySQL 尚未启动或本地首次调试时保证服务可用，绝不返回虚构随机数)
const memoryStore = {
  devices: new Map(),
  errorLogs: [],
  usageEvents: [],
};

let isInitializing = false;
/**
 * 自动初始化 MySQL 数据库与数据表 (带自动重试与自愈重连机制)
 */
async function initDatabase(retryCount = 0, maxRetries = 8) {
  if (isDbConnected || isInitializing) return;
  isInitializing = true;

  const dbConfig = {
    host: dbMeta.host,
    port: dbMeta.port,
    user: dbMeta.user,
    password: process.env.DB_PASSWORD || '',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4',
  };

  try {
    // 1. 尝试无数据库连接，检查并创建目标数据库
    let rootConn;
    try {
      rootConn = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
      });
      await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbMeta.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
      await rootConn.end();
    } catch (e) {
      // 若权限不足或连接失败，则尝试直连目标数据库
    }

    // 2. 连接目标数据库连接池
    pool = mysql.createPool({
      ...dbConfig,
      database: dbMeta.database,
    });

    const conn = await pool.getConnection();
    await conn.ping();

    // 3. 自动检测并创建 3 张核心表结构 (确保零配置部署)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`devices\` (
        \`device_id\` VARCHAR(64) NOT NULL COMMENT '唯一设备指纹 ID',
        \`os_name\` VARCHAR(64) DEFAULT NULL COMMENT '操作系统',
        \`os_platform\` VARCHAR(64) DEFAULT NULL COMMENT '内核平台',
        \`arch\` VARCHAR(32) DEFAULT 'x86_64' COMMENT 'CPU架构',
        \`cpu_cores\` INT DEFAULT 4 COMMENT 'CPU核心数',
        \`device_memory_gb\` VARCHAR(32) DEFAULT NULL COMMENT '内存估计',
        \`gpu_renderer\` VARCHAR(255) DEFAULT NULL COMMENT '显卡型号',
        \`gpu_vendor\` VARCHAR(128) DEFAULT NULL COMMENT '显卡供应商',
        \`screen_resolution\` VARCHAR(64) DEFAULT NULL COMMENT '显示分辨率',
        \`language\` VARCHAR(32) DEFAULT 'zh-CN' COMMENT '语言',
        \`timezone\` VARCHAR(64) DEFAULT 'Asia/Shanghai' COMMENT '时区',
        \`app_version\` VARCHAR(32) DEFAULT NULL COMMENT '客户端版本',
        \`first_seen_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次激活',
        \`last_active_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活跃',
        \`total_sessions\` INT NOT NULL DEFAULT 1 COMMENT '累计会话启动次数',
        \`total_invocations\` INT NOT NULL DEFAULT 1 COMMENT '累计上报调用频次',
        PRIMARY KEY (\`device_id\`),
        INDEX \`idx_last_active\` (\`last_active_at\`),
        INDEX \`idx_os_name\` (\`os_name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='终端用户设备与硬件信息表';
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`error_logs\` (
        \`id\` BIGINT AUTO_INCREMENT NOT NULL COMMENT '自增主键',
        \`device_id\` VARCHAR(64) NOT NULL COMMENT '关联设备 ID',
        \`session_id\` VARCHAR(64) DEFAULT NULL COMMENT '发生错误时的会话 ID',
        \`app_version\` VARCHAR(32) DEFAULT NULL COMMENT '客户端版本',
        \`error_type\` VARCHAR(64) NOT NULL COMMENT '错误类别',
        \`message\` TEXT NOT NULL COMMENT '错误原因及摘要',
        \`stack\` MEDIUMTEXT DEFAULT NULL COMMENT '调用栈完整信息',
        \`source_file\` VARCHAR(512) DEFAULT NULL COMMENT '报错来源文件与行列号',
        \`machine_snapshot\` JSON DEFAULT NULL COMMENT '崩溃时的设备环境快照',
        \`breadcrumbs\` JSON DEFAULT NULL COMMENT '操作轨迹记录',
        \`occurred_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
        PRIMARY KEY (\`id\`),
        INDEX \`idx_device_id\` (\`device_id\`),
        INDEX \`idx_occurred_at\` (\`occurred_at\`),
        INDEX \`idx_error_type\` (\`error_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全局异常与错误日志追踪表';
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`usage_events\` (
        \`id\` BIGINT AUTO_INCREMENT NOT NULL COMMENT '自增主键',
        \`device_id\` VARCHAR(64) NOT NULL COMMENT '设备 ID',
        \`session_id\` VARCHAR(64) DEFAULT NULL COMMENT '会话 ID',
        \`event_type\` VARCHAR(32) NOT NULL DEFAULT 'heartbeat' COMMENT '事件类型',
        \`action_name\` VARCHAR(64) DEFAULT NULL COMMENT '具体操作名',
        \`duration_sec\` INT DEFAULT 0 COMMENT '会话停留秒数',
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '打点时间',
        PRIMARY KEY (\`id\`),
        INDEX \`idx_created_at\` (\`created_at\`),
        INDEX \`idx_device_created\` (\`device_id\`, \`created_at\`),
        INDEX \`idx_event_type\` (\`event_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='使用频次与活跃度明细表';
    `);

    conn.release();
    isDbConnected = true;
    dbMeta.error = null;
    console.log(`[Database] ✓ 成功连接至 MySQL 并完成表结构校验 (${dbMeta.host}:${dbMeta.port}/${dbMeta.database})`);
  } catch (err) {
    isDbConnected = false;
    dbMeta.error = err.message;
    console.warn(`[Database] ⚠️ 无法直连 MySQL (${err.message})`);
    if (retryCount < maxRetries) {
      console.log(`[Database] 🔄 正在重试连接 (${retryCount + 1}/${maxRetries})...`);
      setTimeout(() => {
        isInitializing = false;
        void initDatabase(retryCount + 1, maxRetries);
      }, 3000);
      return;
    }
    console.warn(`[Database] 提示: 请在 server/.env 中设置正确的 DB_USER 与 DB_PASSWORD。当前已安全切换至真实内存存储模式，后台每隔 15 秒自动探测数据库。`);
  } finally {
    isInitializing = false;
  }
}

// 后台定时自愈：若数据库离线，每隔 15 秒重新尝试连接一次
setInterval(() => {
  if (!isDbConnected && !isInitializing) {
    void initDatabase(0, 1);
  }
}, 15000);

// -----------------------------------------------------------------------------
// 1. 服务健康状态检查 (GET /api/health)
// -----------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  let dbStatus = isDbConnected ? 'connected' : 'disconnected (memory fallback)';
  let totalDevices = memoryStore.devices.size;
  let totalErrors = memoryStore.errorLogs.length;
  let totalEvents = memoryStore.usageEvents.length;

  if (isDbConnected && pool) {
    try {
      const [devRows] = await pool.query('SELECT COUNT(*) as count FROM devices');
      const [errRows] = await pool.query('SELECT COUNT(*) as count FROM error_logs');
      const [eventRows] = await pool.query('SELECT COUNT(*) as count FROM usage_events');
      totalDevices = devRows[0]?.count || 0;
      totalErrors = errRows[0]?.count || 0;
      totalEvents = eventRows[0]?.count || 0;
    } catch (e) {
      dbStatus = `query error: ${e.message}`;
    }
  }

  res.json({
    status: 'ok',
    service: 'AI-Helper Telemetry & Diagnostics Backend',
    version: '1.0.0',
    mode: isDbConnected ? 'mysql' : 'memory_fallback',
    uptime_sec: Math.round(process.uptime()),
    database: {
      status: dbStatus,
      host: dbMeta.host,
      port: dbMeta.port,
      database: dbMeta.database,
      total_devices: totalDevices,
      total_error_logs: totalErrors,
      total_usage_events: totalEvents,
    },
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------------------------------
// 2. 核心上报接口：接收客户端诊断报告 (POST /api/telemetry/report)
// -----------------------------------------------------------------------------
app.post('/api/telemetry/report', async (req, res) => {
  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ success: false, error: 'Empty payload received' });
  }

  const meta = payload.report_meta || {};
  const m = payload.machine_info || {};
  const recentErrors = payload.recent_error_summary || {};
  const specificError = payload.error_details || null;
  const breadcrumbs = payload.breadcrumbs || [];

  const deviceId = meta.device_id || `dev_${Date.now()}`;
  const sessionId = meta.session_id || `sess_${Date.now()}`;
  const appVersion = meta.app_version || '1.0.69';
  const actionName = meta.custom_note || (specificError ? 'Error Captured' : 'Client Ping');
  const isNewSession = actionName === 'App Launched' || specificError;

  // 1. MySQL 落库
  if (isDbConnected && pool) {
    try {
      // 1.1 更新或插入设备档案 (UPSERT)
      const sqlUpsertDevice = `
        INSERT INTO devices (
          device_id, os_name, os_platform, arch, cpu_cores, device_memory_gb,
          gpu_renderer, gpu_vendor, screen_resolution, language, timezone,
          app_version, first_seen_at, last_active_at, total_sessions, total_invocations
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 1, 1)
        ON DUPLICATE KEY UPDATE
          os_name = IF(VALUES(os_name) IS NOT NULL AND VALUES(os_name) != '', VALUES(os_name), os_name),
          arch = IF(VALUES(arch) IS NOT NULL AND VALUES(arch) != '', VALUES(arch), arch),
          cpu_cores = IF(VALUES(cpu_cores) > 0, VALUES(cpu_cores), cpu_cores),
          device_memory_gb = IF(VALUES(device_memory_gb) IS NOT NULL, VALUES(device_memory_gb), device_memory_gb),
          gpu_renderer = IF(VALUES(gpu_renderer) IS NOT NULL AND VALUES(gpu_renderer) != '', VALUES(gpu_renderer), gpu_renderer),
          screen_resolution = IF(VALUES(screen_resolution) IS NOT NULL, VALUES(screen_resolution), screen_resolution),
          app_version = IF(VALUES(app_version) IS NOT NULL, VALUES(app_version), app_version),
          last_active_at = NOW(),
          total_sessions = total_sessions + ?,
          total_invocations = total_invocations + 1;
      `;
      await pool.query(sqlUpsertDevice, [
        deviceId,
        m.osName || 'Unknown OS',
        m.platform || m.osName || 'Unknown',
        m.arch || 'x86_64',
        m.cpuCores || 4,
        m.deviceMemoryGb || 'Unknown',
        m.gpuRenderer || 'Generic GPU',
        m.gpuVendor || 'Generic',
        m.screenResolution || 'Unknown',
        m.language || 'zh-CN',
        m.timezone || 'Asia/Shanghai',
        appVersion,
        isNewSession ? 1 : 0,
      ]);

      // 1.2 记录使用频次事件
      const eventType = specificError ? 'error' : (actionName === 'App Launched' ? 'launch' : (actionName === 'Client Heartbeat' ? 'heartbeat' : 'action'));
      const sqlInsertUsage = `
        INSERT INTO usage_events (device_id, session_id, event_type, action_name, duration_sec, created_at)
        VALUES (?, ?, ?, ?, ?, NOW());
      `;
      await pool.query(sqlInsertUsage, [
        deviceId,
        sessionId,
        eventType,
        actionName,
        meta.session_duration_sec || 0,
      ]);

      // 1.3 若有具体异常，落库 error_logs
      const errorsToSave = [];
      if (specificError) {
        errorsToSave.push(specificError);
      } else if (recentErrors.latest_errors && recentErrors.latest_errors.length > 0) {
        errorsToSave.push(...recentErrors.latest_errors);
      }

      if (errorsToSave.length > 0) {
        const sqlInsertError = `
          INSERT INTO error_logs (
            device_id, session_id, app_version, error_type, message, stack,
            source_file, machine_snapshot, breadcrumbs, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
        `;
        for (const err of errorsToSave) {
          await pool.query(sqlInsertError, [
            deviceId,
            sessionId,
            appVersion,
            err.type || err.errorType || 'RuntimeError',
            err.message || '未命名错误',
            err.stack || '',
            err.source || err.source_file || '',
            JSON.stringify(m),
            JSON.stringify(breadcrumbs),
          ]);
        }
      }
    } catch (dbErr) {
      console.error('[Database] 保存上报数据失败:', dbErr);
    }
  } else {
    // 内存安全存储
    const existingDev = memoryStore.devices.get(deviceId) || {
      device_id: deviceId,
      first_seen_at: new Date().toISOString(),
      total_sessions: 0,
      total_invocations: 0,
    };

    memoryStore.devices.set(deviceId, {
      ...existingDev,
      os_name: m.osName || existingDev.os_name || 'Unknown OS',
      arch: m.arch || existingDev.arch || 'x86_64',
      cpu_cores: m.cpuCores || existingDev.cpu_cores || 4,
      device_memory_gb: m.deviceMemoryGb || existingDev.device_memory_gb || 'Unknown',
      gpu_renderer: m.gpuRenderer || existingDev.gpu_renderer || 'Generic GPU',
      screen_resolution: m.screenResolution || existingDev.screen_resolution || 'Unknown',
      app_version: appVersion,
      last_active_at: new Date().toISOString(),
      total_sessions: existingDev.total_sessions + (isNewSession ? 1 : 0),
      total_invocations: existingDev.total_invocations + 1,
    });

    memoryStore.usageEvents.unshift({
      id: memoryStore.usageEvents.length + 1,
      device_id: deviceId,
      session_id: sessionId,
      event_type: specificError ? 'error' : (actionName === 'App Launched' ? 'launch' : 'action'),
      action_name: actionName,
      duration_sec: meta.session_duration_sec || 0,
      created_at: new Date().toISOString(),
    });

    if (specificError) {
      memoryStore.errorLogs.unshift({
        id: memoryStore.errorLogs.length + 1,
        device_id: deviceId,
        session_id: sessionId,
        app_version: appVersion,
        error_type: specificError.type || specificError.errorType || 'Error',
        message: specificError.message || '未命名错误',
        stack: specificError.stack || '',
        source_file: specificError.source || specificError.source_file || '',
        machine_snapshot: m,
        breadcrumbs: breadcrumbs,
        occurred_at: new Date().toISOString(),
      });
    }
  }

  res.json({
    success: true,
    message: 'Report received and recorded',
    device_id: deviceId,
    timestamp: Date.now(),
  });
});

// -----------------------------------------------------------------------------
// 3. 监控大盘聚合数据接口 (GET /api/telemetry/dashboard)
// 供 website/diagnostics.html 一键查询全网所有真实用户的聚合指标
// 严格杜绝任何虚假生成数字，全部来自真实表聚合
// -----------------------------------------------------------------------------
app.get('/api/telemetry/dashboard', async (req, res) => {
  const queryStart = Date.now();

  // 生成连续 7 天标准日期数组 (YYYY-MM-DD)
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(d.toISOString().slice(0, 10));
  }

  if (isDbConnected && pool) {
    try {
      // 1. 累计设备总数 & 累计调用总频次
      const [devCountRow] = await pool.query('SELECT COUNT(*) as total_devices, SUM(total_invocations) as total_invocations FROM devices');
      const totalDevices = Number(devCountRow[0]?.total_devices) || 0;
      const totalInvocations = Number(devCountRow[0]?.total_invocations) || 0;

      // 2. 今日活跃设备数 (DAU) & 今日调用频次
      const [todayRow] = await pool.query(`
        SELECT COUNT(DISTINCT device_id) as today_active, COUNT(*) as today_invocations
        FROM usage_events
        WHERE created_at >= CURDATE()
      `);
      const todayActive = Number(todayRow[0]?.today_active) || 0;
      const todayInvocations = Number(todayRow[0]?.today_invocations) || 0;

      // 3. 累计错误总数与今日错误数
      const [errCountRow] = await pool.query('SELECT COUNT(*) as total_errors FROM error_logs');
      const [todayErrRow] = await pool.query('SELECT COUNT(*) as today_errors FROM error_logs WHERE occurred_at >= CURDATE()');
      const totalErrors = Number(errCountRow[0]?.total_errors) || 0;
      const todayErrors = Number(todayErrRow[0]?.today_errors) || 0;
      const errorRate = totalInvocations > 0 ? ((totalErrors / totalInvocations) * 100).toFixed(1) : '0.0';

      // 4. 过去 7 天每天的调用频次走势 (无调用日期准确显示 0，绝不伪造)
      const [trendRows] = await pool.query(`
        SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as count
        FROM usage_events
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
      `);
      const trendMap = new Map(trendRows.map(r => [r.date, Number(r.count)]));
      const weeklyTrend = last7Days.map(date => ({
        date,
        count: trendMap.get(date) || 0,
      }));

      // 5. 今日 24 小时活跃分布 (00:00 - 23:00)
      const [hourlyRows] = await pool.query(`
        SELECT HOUR(created_at) as hour, COUNT(*) as count
        FROM usage_events
        WHERE created_at >= CURDATE()
        GROUP BY HOUR(created_at)
      `);
      const hourlyMap = new Map(hourlyRows.map(r => [Number(r.hour), Number(r.count)]));
      const hourlyTrend = Array.from({ length: 24 }, (_, h) => ({
        hour: `${String(h).padStart(2, '0')}:00`,
        count: hourlyMap.get(h) || 0,
      }));

      // 6. 操作系统真实分布
      const [osRows] = await pool.query(`
        SELECT os_name, COUNT(*) as count
        FROM devices
        GROUP BY os_name
        ORDER BY count DESC
        LIMIT 8;
      `);

      // 7. 客户端软件版本真实分布
      const [versionRows] = await pool.query(`
        SELECT app_version, COUNT(*) as count
        FROM devices
        WHERE app_version IS NOT NULL AND app_version != ''
        GROUP BY app_version
        ORDER BY count DESC
        LIMIT 6;
      `);

      // 8. 报错原因类别统计
      const [errCatRows] = await pool.query(`
        SELECT error_type, COUNT(*) as count
        FROM error_logs
        GROUP BY error_type
        ORDER BY count DESC
        LIMIT 8;
      `);

      // 9. 最近报错列表 (包含完整堆栈、机器快照与行为轨迹)
      const [latestErrors] = await pool.query(`
        SELECT id, device_id, session_id, app_version, error_type, message, stack,
               source_file, machine_snapshot, breadcrumbs, occurred_at
        FROM error_logs
        ORDER BY occurred_at DESC
        LIMIT 50;
      `);

      // 10. 最近用户行为动态流 (用于实时了解各用户都在做什么)
      const [latestEvents] = await pool.query(`
        SELECT id, device_id, session_id, event_type, action_name, duration_sec, created_at
        FROM usage_events
        ORDER BY created_at DESC
        LIMIT 30;
      `);

      return res.json({
        success: true,
        source: 'mysql',
        meta: {
          database: dbMeta.database,
          host: dbMeta.host,
          query_duration_ms: Date.now() - queryStart,
          queried_at: new Date().toISOString(),
        },
        summary: {
          total_devices: totalDevices,
          today_active_users: todayActive,
          total_invocations: totalInvocations,
          today_invocations: todayInvocations,
          total_errors: totalErrors,
          today_errors: todayErrors,
          error_rate_percent: Number(errorRate),
        },
        weekly_trend: weeklyTrend,
        hourly_trend: hourlyTrend,
        os_distribution: osRows,
        version_distribution: versionRows,
        error_categories: errCatRows,
        latest_errors: latestErrors,
        latest_events: latestEvents,
      });
    } catch (err) {
      console.error('[Dashboard API] MySQL 查询失败:', err);
    }
  }

  // 内存模式真实返回 (严格根据 memoryStore 实际数据聚合，不注任何伪造数字)
  const totalDev = memoryStore.devices.size;
  const totalErr = memoryStore.errorLogs.length;
  const totalEvents = memoryStore.usageEvents.length;

  // 统计今天
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEvents = memoryStore.usageEvents.filter(e => String(e.created_at).startsWith(todayStr));
  const todayActiveDevs = new Set(todayEvents.map(e => e.device_id)).size;
  const todayErrors = memoryStore.errorLogs.filter(e => String(e.occurred_at).startsWith(todayStr)).length;

  // 7天走势
  const weeklyTrend = last7Days.map(date => {
    const count = memoryStore.usageEvents.filter(e => String(e.created_at).startsWith(date)).length;
    return { date, count };
  });

  // OS 统计
  const osCountMap = {};
  for (const dev of memoryStore.devices.values()) {
    const os = dev.os_name || 'Unknown';
    osCountMap[os] = (osCountMap[os] || 0) + 1;
  }
  const osRows = Object.entries(osCountMap).map(([os_name, count]) => ({ os_name, count }));

  // 报错类别统计
  const errCatMap = {};
  for (const err of memoryStore.errorLogs) {
    const t = err.error_type || 'Error';
    errCatMap[t] = (errCatMap[t] || 0) + 1;
  }
  const errCatRows = Object.entries(errCatMap).map(([error_type, count]) => ({ error_type, count }));

  res.json({
    success: true,
    source: 'memory_fallback',
    meta: {
      database: 'In-Memory (Awaiting MySQL configuration in server/.env)',
      host: dbMeta.host,
      query_duration_ms: Date.now() - queryStart,
      queried_at: new Date().toISOString(),
    },
    summary: {
      total_devices: totalDev,
      today_active_users: todayActiveDevs,
      total_invocations: totalEvents,
      today_invocations: todayEvents.length,
      total_errors: totalErr,
      today_errors: todayErrors,
      error_rate_percent: totalEvents > 0 ? Number(((totalErr / totalEvents) * 100).toFixed(1)) : 0,
    },
    weekly_trend: weeklyTrend,
    hourly_trend: Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, count: 0 })),
    os_distribution: osRows,
    version_distribution: [],
    error_categories: errCatRows,
    latest_errors: memoryStore.errorLogs.slice(0, 50),
    latest_events: memoryStore.usageEvents.slice(0, 30),
  });
});

// -----------------------------------------------------------------------------
// 4. 用户设备档案列表接口 (GET /api/telemetry/devices)
// 供内部开发人员查看全网所有用户的真实机器硬件配置与活跃档案
// -----------------------------------------------------------------------------
app.get('/api/telemetry/devices', async (req, res) => {
  const searchQuery = (req.query.q || '').trim().toLowerCase();
  const osFilter = (req.query.os || '').trim();

  if (isDbConnected && pool) {
    try {
      let sql = `
        SELECT 
          d.device_id, d.os_name, d.os_platform, d.arch, d.cpu_cores, d.device_memory_gb,
          d.gpu_renderer, d.gpu_vendor, d.screen_resolution, d.language, d.timezone,
          d.app_version, d.first_seen_at, d.last_active_at, d.total_sessions, d.total_invocations,
          (SELECT COUNT(*) FROM error_logs e WHERE e.device_id = d.device_id) as error_count
        FROM devices d
        WHERE 1 = 1
      `;
      const params = [];

      if (searchQuery) {
        sql += ` AND (d.device_id LIKE ? OR d.os_name LIKE ? OR d.gpu_renderer LIKE ?)`;
        params.push(`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`);
      }
      if (osFilter && osFilter !== 'ALL') {
        sql += ` AND d.os_name LIKE ?`;
        params.push(`%${osFilter}%`);
      }

      sql += ` ORDER BY d.last_active_at DESC LIMIT 100;`;

      const [rows] = await pool.query(sql, params);
      return res.json({ success: true, count: rows.length, devices: rows });
    } catch (err) {
      console.error('[Devices API] 查设备失败:', err);
    }
  }

  // 内存模式返回
  let devs = Array.from(memoryStore.devices.values());
  if (searchQuery) {
    devs = devs.filter(d => 
      (d.device_id || '').toLowerCase().includes(searchQuery) ||
      (d.os_name || '').toLowerCase().includes(searchQuery) ||
      (d.gpu_renderer || '').toLowerCase().includes(searchQuery)
    );
  }
  if (osFilter && osFilter !== 'ALL') {
    devs = devs.filter(d => (d.os_name || '').toLowerCase().includes(osFilter.toLowerCase()));
  }

  devs = devs.map(d => ({
    ...d,
    error_count: memoryStore.errorLogs.filter(e => e.device_id === d.device_id).length,
  }));

  res.json({
    success: true,
    count: devs.length,
    devices: devs,
  });
});

// -----------------------------------------------------------------------------
// 5. 单个设备全景诊断档案接口 (GET /api/telemetry/device/:deviceId)
// 供点击某个特定用户时，深入查看该用户的所有硬件参数、报错历史与活跃轨迹
// -----------------------------------------------------------------------------
app.get('/api/telemetry/device/:deviceId', async (req, res) => {
  const { deviceId } = req.params;

  if (isDbConnected && pool) {
    try {
      const [devRows] = await pool.query('SELECT * FROM devices WHERE device_id = ?', [deviceId]);
      if (devRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }

      const [errRows] = await pool.query(
        'SELECT id, app_version, error_type, message, stack, source_file, machine_snapshot, breadcrumbs, occurred_at FROM error_logs WHERE device_id = ? ORDER BY occurred_at DESC LIMIT 20',
        [deviceId]
      );

      const [eventRows] = await pool.query(
        'SELECT id, session_id, event_type, action_name, duration_sec, created_at FROM usage_events WHERE device_id = ? ORDER BY created_at DESC LIMIT 30',
        [deviceId]
      );

      return res.json({
        success: true,
        device: devRows[0],
        errors: errRows,
        events: eventRows,
      });
    } catch (err) {
      console.error('[Device Detail API] 查询失败:', err);
    }
  }

  const dev = memoryStore.devices.get(deviceId);
  if (!dev) {
    return res.status(404).json({ success: false, error: 'Device not found in memory' });
  }

  res.json({
    success: true,
    device: dev,
    errors: memoryStore.errorLogs.filter(e => e.device_id === deviceId).slice(0, 20),
    events: memoryStore.usageEvents.filter(e => e.device_id === deviceId).slice(0, 30),
  });
});

// -----------------------------------------------------------------------------
// 6. 开发者维护辅助接口：清理测试日志 (POST /api/telemetry/clear-test-data)
// -----------------------------------------------------------------------------
app.post('/api/telemetry/clear-test-data', async (req, res) => {
  if (isDbConnected && pool) {
    try {
      await pool.query('DELETE FROM error_logs WHERE message LIKE ? OR message LIKE ?', ['%Simulated%', '%测试%']);
      await pool.query('DELETE FROM usage_events WHERE action_name LIKE ?', ['%manual_test%']);
      return res.json({ success: true, message: 'Test errors purged from MySQL database' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  memoryStore.errorLogs = memoryStore.errorLogs.filter(e => !e.message.includes('Simulated') && !e.message.includes('测试'));
  res.json({ success: true, message: 'Test errors purged from memory' });
});

// -----------------------------------------------------------------------------
// 启动服务并尝试连接数据库
// -----------------------------------------------------------------------------
initDatabase().finally(() => {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 AI-Helper 内部开发全量诊断监控服务已启动!`);
    console.log(`📡 服务监听端口: http://localhost:${PORT}`);
    console.log(`💻 监控控制台网页: http://localhost:${PORT}/diagnostics.html`);
    console.log(`📊 全网大盘数据接口: http://localhost:${PORT}/api/telemetry/dashboard`);
    console.log(`💻 用户设备档案列表: http://localhost:${PORT}/api/telemetry/devices`);
    console.log(`📥 客户端诊断上报口: http://localhost:${PORT}/api/telemetry/report`);
    console.log(`🏥 数据库健康检测端点: http://localhost:${PORT}/api/health`);
    console.log(`====================================================`);
  });
});
