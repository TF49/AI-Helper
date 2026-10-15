use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const COMPILE_TIME_APP_ID: Option<&str> = option_env!("FEISHU_APP_ID");
pub const COMPILE_TIME_APP_SECRET: Option<&str> = option_env!("FEISHU_APP_SECRET");
pub const COMPILE_TIME_CHAT_ID: Option<&str> = option_env!("FEISHU_CHAT_ID");
pub const COMPILE_TIME_WEBHOOK_URL: Option<&str> = option_env!("FEISHU_WEBHOOK_URL");

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FeishuFeedbackPayload {
    pub feedback_type: String, // "bug" | "feature" | "other"
    pub content: String,
    pub email: String,
    pub app_version: String,
    pub os_info: String,
    pub active_target: String,
    pub network_status: String,
    pub logged_in_user: Option<String>,
    pub webhook_url: Option<String>,
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    pub chat_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FeedbackSubmitResult {
    pub success: bool,
    pub message: String,
}

/// 解析环境变量与编译期注入的凭据 (优先级: 参数传参 -> 运行期环境变量 -> 编译期环境变量)
fn resolve_credential(
    payload_val: Option<&str>,
    runtime_env_key: &str,
    compile_time_val: Option<&str>,
) -> Option<String> {
    payload_val
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var(runtime_env_key)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            compile_time_val
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
}

/// 获取当前系统的详细操作系统信息 (e.g. "Windows 11 Pro (x86_64)")
#[tauri::command]
pub fn get_system_diagnostic_info() -> String {
    let os_name = sysinfo::System::long_os_version()
        .or_else(sysinfo::System::name)
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let arch = std::env::consts::ARCH;
    format!("{} ({})", os_name, arch)
}

/// 组装通用的飞书消息卡片结构
fn build_feishu_card(payload: &FeishuFeedbackPayload) -> serde_json::Value {
    let (template_color, type_title, type_badge) = match payload.feedback_type.as_str() {
        "bug" => ("carmine", "【BUG反馈】", "🐞 BUG反馈"),
        "feature" => ("turquoise", "【功能建议】", "💡 功能建议"),
        _ => ("grey", "【其他反馈】", "❓ 其他反馈"),
    };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let logged_in_info = payload.logged_in_user.as_deref().unwrap_or("未登录");

    serde_json::json!({
        "config": {
            "wide_screen_mode": true
        },
        "header": {
            "template": template_color,
            "title": {
                "tag": "plain_text",
                "content": format!("{} AI Helper 客户端", type_title)
            }
        },
        "elements": [
            {
                "tag": "div",
                "fields": [
                    {
                        "is_short": true,
                        "text": {
                            "tag": "lark_md",
                            "content": format!("**反馈类型：**\n{}", type_badge)
                        }
                    },
                    {
                        "is_short": true,
                        "text": {
                            "tag": "lark_md",
                            "content": format!("**联系邮箱：**\n{}", payload.email)
                        }
                    },
                    {
                        "is_short": true,
                        "text": {
                            "tag": "lark_md",
                            "content": format!("**客户端版本：**\nv{}", payload.app_version)
                        }
                    },
                    {
                        "is_short": true,
                        "text": {
                            "tag": "lark_md",
                            "content": format!("**系统环境：**\n{}", payload.os_info)
                        }
                    },
                    {
                        "is_short": true,
                        "text": {
                            "tag": "lark_md",
                            "content": format!("**当前配置目标：**\n{}", payload.active_target)
                        }
                    },
                    {
                        "is_short": true,
                        "text": {
                            "tag": "lark_md",
                            "content": format!("**登录用户：**\n{}", logged_in_info)
                        }
                    }
                ]
            },
            {
                "tag": "hr"
            },
            {
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": format!("**反馈详细内容：**\n{}", payload.content)
                }
            },
            {
                "tag": "note",
                "elements": [
                    {
                        "tag": "plain_text",
                        "content": format!("提交时间: {} · 官方网络状态: {}", now, payload.network_status)
                    }
                ]
            }
        ]
    })
}

/// 向飞书提交意见反馈（优先采用环境变量配置的自建应用机器人与 Webhook 机器人）
#[tauri::command]
pub async fn submit_feishu_feedback(
    payload: FeishuFeedbackPayload,
) -> Result<FeedbackSubmitResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let card_obj = build_feishu_card(&payload);

    let app_id = resolve_credential(
        payload.app_id.as_deref(),
        "FEISHU_APP_ID",
        COMPILE_TIME_APP_ID,
    );
    let app_secret = resolve_credential(
        payload.app_secret.as_deref(),
        "FEISHU_APP_SECRET",
        COMPILE_TIME_APP_SECRET,
    );
    let chat_id = resolve_credential(
        payload.chat_id.as_deref(),
        "FEISHU_CHAT_ID",
        COMPILE_TIME_CHAT_ID,
    );

    // 模式 1：飞书开放平台自建应用机器人 (App ID + App Secret + Chat ID)
    if let (Some(valid_app_id), Some(valid_secret), Some(valid_chat)) =
        (app_id, app_secret, chat_id)
    {
        // 1. 获取 tenant_access_token
        let token_resp = client
            .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
            .json(&serde_json::json!({
                "app_id": valid_app_id,
                "app_secret": valid_secret,
            }))
            .send()
            .await
            .map_err(|e| format!("请求飞书开放平台 Token 失败: {}", e))?;

        let token_status = token_resp.status();
        let token_body: serde_json::Value = token_resp
            .json()
            .await
            .map_err(|e| format!("解析飞书 Token 响应异常: {}", e))?;

        if !token_status.is_success() || token_body.get("code").and_then(|v| v.as_i64()) != Some(0)
        {
            let msg = token_body
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("未知凭证错误");
            return Ok(FeedbackSubmitResult {
                success: false,
                message: format!(
                    "飞书开放平台认证失败 ({}): 请检查环境变量中的 App ID 与 App Secret 是否匹配",
                    msg
                ),
            });
        }

        let access_token = token_body
            .get("tenant_access_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "未能从飞书响应中获取 tenant_access_token".to_string())?;

        // 2. 发送互动卡片到指定会话
        let card_content_str =
            serde_json::to_string(&card_obj).map_err(|e| format!("序列化卡片内容失败: {}", e))?;

        let send_resp = client
            .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id")
            .header("Authorization", format!("Bearer {}", access_token))
            .json(&serde_json::json!({
                "receive_id": valid_chat,
                "msg_type": "interactive",
                "content": card_content_str,
            }))
            .send()
            .await
            .map_err(|e| format!("向飞书群推送消息失败: {}", e))?;

        let send_status = send_resp.status();
        let send_body: serde_json::Value = send_resp
            .json()
            .await
            .map_err(|e| format!("解析飞书发送响应异常: {}", e))?;

        if send_status.is_success() && send_body.get("code").and_then(|v| v.as_i64()) == Some(0) {
            return Ok(FeedbackSubmitResult {
                success: true,
                message: "感谢您的反馈！内容已成功推送到开发团队飞书群。".to_string(),
            });
        }

        let err_code = send_body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        let err_msg = send_body
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("推送失败");
        return Ok(FeedbackSubmitResult {
            success: false,
            message: format!(
                "飞书消息推送失败 (代码 {}): {} (请确认机器人已加入该群且开通发消息权限)",
                err_code, err_msg
            ),
        });
    }

    // 模式 2：群自定义机器人 Webhook
    let webhook_url = resolve_credential(
        payload.webhook_url.as_deref(),
        "FEISHU_WEBHOOK_URL",
        COMPILE_TIME_WEBHOOK_URL,
    );

    if let Some(valid_webhook) = webhook_url {
        if valid_webhook.starts_with("http://") || valid_webhook.starts_with("https://") {
            let webhook_payload = serde_json::json!({
                "msg_type": "interactive",
                "card": card_obj,
            });

            let response = client
                .post(&valid_webhook)
                .json(&webhook_payload)
                .send()
                .await
                .map_err(|e| format!("向飞书 Webhook 发送请求失败: {}", e))?;

            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "<读取响应体失败>".to_string());

            if !status.is_success() {
                return Ok(FeedbackSubmitResult {
                    success: false,
                    message: format!(
                        "飞书 Webhook 返回 HTTP 状态异常 ({}): {}",
                        status, body_text
                    ),
                });
            }

            if let Ok(res_json) = serde_json::from_str::<serde_json::Value>(&body_text) {
                let code = res_json
                    .get("code")
                    .and_then(|v| v.as_i64())
                    .or_else(|| res_json.get("StatusCode").and_then(|v| v.as_i64()))
                    .unwrap_or(0);

                if code != 0 {
                    let msg = res_json
                        .get("msg")
                        .and_then(|v| v.as_str())
                        .or_else(|| res_json.get("StatusMessage").and_then(|v| v.as_str()))
                        .unwrap_or("未知错误");
                    return Ok(FeedbackSubmitResult {
                        success: false,
                        message: format!("飞书机器人返回错误 (代码 {}): {}", code, msg),
                    });
                }
            }

            return Ok(FeedbackSubmitResult {
                success: true,
                message: "感谢您的反馈！内容已成功推送到开发团队飞书群。".to_string(),
            });
        }
    }

    Ok(FeedbackSubmitResult {
        success: false,
        message: "未检测到飞书机器人环境变量 (FEISHU_APP_ID / FEISHU_WEBHOOK_URL)，已为您将反馈文本复制到剪贴板。".to_string(),
    })
}
