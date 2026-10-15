use serde::{Deserialize, Serialize};
use std::time::Duration;

/// 官方内置默认飞书群 Webhook 地址（免用户配置，开箱即用直接推送至开发团队飞书群）
pub const DEFAULT_FEISHU_WEBHOOK_URL: &str =
    "https://open.feishu.cn/open-apis/bot/v2/hook/89f0dca7-8073-4dfc-be74-9379c3d08e1e";

/// 编译期通过 .env 或 CI 注入的环境变量（可选，若配置则优先覆盖默认地址）
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
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub app_secret: Option<String>,
    #[serde(default)]
    pub chat_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct FeedbackSubmitResult {
    pub success: bool,
    pub message: String,
}

/// 解析 Webhook 凭据 (优先级: 参数传参 -> 运行期环境变量 -> 编译期环境变量 -> 内置默认值)
fn resolve_webhook_url(
    payload_val: Option<&str>,
    runtime_env_key: &str,
    compile_time_val: Option<&str>,
    fallback_val: &str,
) -> String {
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
        .unwrap_or_else(|| fallback_val.to_string())
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

/// 向飞书 Webhook 提交意见反馈互动卡片（直接向开发团队飞书群推送，终端用户无需任何配置）
#[tauri::command]
pub async fn submit_feishu_feedback(
    payload: FeishuFeedbackPayload,
) -> Result<FeedbackSubmitResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let card_obj = build_feishu_card(&payload);

    let webhook_url = resolve_webhook_url(
        payload.webhook_url.as_deref(),
        "FEISHU_WEBHOOK_URL",
        COMPILE_TIME_WEBHOOK_URL,
        DEFAULT_FEISHU_WEBHOOK_URL,
    );

    if webhook_url.starts_with("http://") || webhook_url.starts_with("https://") {
        let webhook_payload = serde_json::json!({
            "msg_type": "interactive",
            "card": card_obj,
        });

        let response = client
            .post(&webhook_url)
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

    Ok(FeedbackSubmitResult {
        success: false,
        message: "飞书 Webhook 地址无效，已为您将反馈文本复制到剪贴板。".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_webhook_url_fallback() {
        let res = resolve_webhook_url(
            None,
            "NON_EXISTENT_VAR_XYZ",
            None,
            DEFAULT_FEISHU_WEBHOOK_URL,
        );
        assert_eq!(res, DEFAULT_FEISHU_WEBHOOK_URL);
    }

    #[test]
    fn test_resolve_webhook_url_payload_precedence() {
        let res = resolve_webhook_url(
            Some("https://custom.webhook.url"),
            "NON_EXISTENT_VAR_XYZ",
            Some("https://compile.url"),
            DEFAULT_FEISHU_WEBHOOK_URL,
        );
        assert_eq!(res, "https://custom.webhook.url");
    }

    #[test]
    fn test_build_feishu_card() {
        let payload = FeishuFeedbackPayload {
            feedback_type: "bug".to_string(),
            content: "测试Bug".to_string(),
            email: "test@example.com".to_string(),
            app_version: "1.0.64".to_string(),
            os_info: "Windows 11".to_string(),
            active_target: "Claude Code".to_string(),
            network_status: "正常".to_string(),
            logged_in_user: Some("test_user".to_string()),
            webhook_url: None,
            app_id: None,
            app_secret: None,
            chat_id: None,
        };

        let card = build_feishu_card(&payload);
        assert_eq!(card["header"]["template"], "carmine");
        assert!(card["elements"].as_array().unwrap().len() >= 3);
    }
}
