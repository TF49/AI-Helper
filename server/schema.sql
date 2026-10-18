-- =============================================================================
-- AI-Helper 诊断与监控服务 MySQL 数据库建表脚本 (schema.sql)
-- 适用版本: MySQL 5.7+ / 8.0+ / MariaDB 10.3+
-- 字符集: utf8mb4 (支持各种系统语言、异常堆栈与 Emoji)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `ai_helper_telemetry` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ai_helper_telemetry`;

-- -----------------------------------------------------------------------------
-- 1. 设备与终端硬件信息表 (devices)
-- 记录每一个独立用户的机器配置全景与活跃时间
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `devices` (
  `device_id` VARCHAR(64) NOT NULL COMMENT '唯一设备指纹 ID',
  `os_name` VARCHAR(64) DEFAULT NULL COMMENT '操作系统 (如 Windows 11, macOS Apple Silicon)',
  `os_platform` VARCHAR(64) DEFAULT NULL COMMENT '操作系统内核平台',
  `arch` VARCHAR(32) DEFAULT 'x86_64' COMMENT 'CPU架构 (x86_64 / arm64)',
  `cpu_cores` INT DEFAULT 4 COMMENT 'CPU逻辑处理器核心数',
  `device_memory_gb` VARCHAR(32) DEFAULT NULL COMMENT '设备估计运行内存 (如 >= 16 GB)',
  `gpu_renderer` VARCHAR(255) DEFAULT NULL COMMENT 'WebGL 显卡渲染器硬件型号',
  `gpu_vendor` VARCHAR(128) DEFAULT NULL COMMENT '显卡芯片供应商 (NVIDIA, Apple, Intel, AMD)',
  `screen_resolution` VARCHAR(64) DEFAULT NULL COMMENT '显示屏物理分辨率及 DPR',
  `language` VARCHAR(32) DEFAULT 'zh-CN' COMMENT '系统默认语言',
  `timezone` VARCHAR(64) DEFAULT 'Asia/Shanghai' COMMENT '系统时区',
  `app_version` VARCHAR(32) DEFAULT NULL COMMENT '当前客户端软件版本号',
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次上线/激活时间',
  `last_active_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活跃心跳时间',
  `total_sessions` INT NOT NULL DEFAULT 1 COMMENT '累计启动/会话次数',
  `total_invocations` INT NOT NULL DEFAULT 1 COMMENT '累计调用频次',
  PRIMARY KEY (`device_id`),
  INDEX `idx_last_active` (`last_active_at`),
  INDEX `idx_os_name` (`os_name`),
  INDEX `idx_arch` (`arch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='终端用户设备与硬件信息表';

-- -----------------------------------------------------------------------------
-- 2. 运行时异常与报错日志表 (error_logs)
-- 记录所有用户在使用过程中发生的 JS 报错、Promise 拒绝与 API 异常
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `error_logs` (
  `id` BIGINT AUTO_INCREMENT NOT NULL COMMENT '自增主键',
  `device_id` VARCHAR(64) NOT NULL COMMENT '关联的设备 ID',
  `session_id` VARCHAR(64) DEFAULT NULL COMMENT '发生错误时的会话 ID',
  `app_version` VARCHAR(32) DEFAULT NULL COMMENT '客户端版本号',
  `error_type` VARCHAR(64) NOT NULL COMMENT '错误类型 (JsRuntimeError, UnhandledPromise, ApiTimeout 等)',
  `message` TEXT NOT NULL COMMENT '错误原因及摘要信息',
  `stack` MEDIUMTEXT DEFAULT NULL COMMENT '完整调用堆栈 (Stack Trace)',
  `source_file` VARCHAR(512) DEFAULT NULL COMMENT '报错文件及行列号',
  `machine_snapshot` JSON DEFAULT NULL COMMENT '崩溃发生时的设备快照 JSON',
  `breadcrumbs` JSON DEFAULT NULL COMMENT '崩溃前的用户操作面包屑轨迹',
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`id`),
  INDEX `idx_device_id` (`device_id`),
  INDEX `idx_occurred_at` (`occurred_at`),
  INDEX `idx_error_type` (`error_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全局用户异常与报错追踪日志表';

-- -----------------------------------------------------------------------------
-- 3. 使用频率与行为埋点表 (usage_events)
-- 用于大盘汇总全网 DAU、每日/每小时调用走势、活跃时长
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `usage_events` (
  `id` BIGINT AUTO_INCREMENT NOT NULL COMMENT '自增主键',
  `device_id` VARCHAR(64) NOT NULL COMMENT '设备 ID',
  `session_id` VARCHAR(64) DEFAULT NULL COMMENT '会话 ID',
  `event_type` VARCHAR(32) NOT NULL DEFAULT 'heartbeat' COMMENT '事件类型 (launch, heartbeat, action, error)',
  `action_name` VARCHAR(64) DEFAULT NULL COMMENT '具体操作名 (如 switch_model, test_channel)',
  `duration_sec` INT DEFAULT 0 COMMENT '本次会话已停留秒数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '打点时间',
  PRIMARY KEY (`id`),
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_device_created` (`device_id`, `created_at`),
  INDEX `idx_event_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='使用频次与活跃度明细表';
