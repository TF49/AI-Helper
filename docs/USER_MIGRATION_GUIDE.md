# AI Helper 用户迁移指南

本文档说明升级到最新版本时可能需要的手动操作。

---

## Codex 环境变量配置说明

### 配置机制
Codex 继续通过系统环境变量 `CUSTOM_OPENAI_API_KEY` 管理认证密钥，配合 `~/.codex/config.toml` 中 `[model_providers.custom]` 的 `env_key = "CUSTOM_OPENAI_API_KEY"` 实现：

- **Windows 用户**：在 AI Helper 中配置并保存后，应用会自动写入 Windows 用户环境变量（注册表 `HKCU\Environment`）、保持进程环境同步，并通过系统广播（`WM_SETTINGCHANGE`，尽力通知）通知系统刷新；从 Explorer 等新拉起的终端或外部进程均可自动读取（若部分终端此前已处于打开状态，仍需重启终端以加载最新环境）。
- **macOS / Linux 用户**：AI Helper 进程内会同步设置该环境变量；若在独立终端外部启动 Codex CLI，建议确保 shell 配置文件（如 `~/.zshrc` 或 `~/.bashrc`）中已导出：
  ```bash
  export CUSTOM_OPENAI_API_KEY="sk-..."
  ```

### 故障排查
1. **Windows 环境变量未生效**：
   - 检查用户环境变量中是否存在 `CUSTOM_OPENAI_API_KEY`。
   - 若终端已打开，需重启终端以加载最新环境变量。
2. **清除密钥**：
   - 在 AI Helper 中清空密钥并保存，应用会自动清理注册表与环境中的对应项。

---

## macOS Keychain 首次访问

### 症状
首次登录时看到：
```
系统钥匙串不可用或拒绝访问。请在"系统设置 > 隐私与安全性"中允许访问，或解锁钥匙串后重试
```

### 解决方法
1. 打开"钥匙串访问"应用
2. 确认"登录"钥匙串已解锁（左上角无锁图标）
3. 如果提示"AI Helper 想要访问钥匙串"，点击"始终允许"
4. 返回 AI Helper 重新登录

### 常见问题
**Q: 每次启动都要授权？**  
A: 点击"始终允许"而非"允许"，系统会记住选择。

**Q: 删除条目后如何恢复？**  
A: 在 AI Helper 中重新登录即可自动创建新条目。

---

## Linux Secret Service 配置

### 症状
登录失败并提示：
```
Secret Service 不可用或拒绝访问。请确认 gnome-keyring 或 KWallet 正在运行
```

### 检查方法
```bash
# 检查 Secret Service 是否运行
systemctl --user status gnome-keyring-daemon

# 或检查 KWallet (KDE 用户)
ps aux | grep kwalletd
```

### 解决方法

#### Ubuntu/Debian 用户
```bash
# 安装 gnome-keyring
sudo apt install gnome-keyring

# 设置自动启动
systemctl --user enable gnome-keyring-daemon
systemctl --user start gnome-keyring-daemon
```

#### Arch Linux 用户
```bash
# 安装 gnome-keyring
sudo pacman -S gnome-keyring

# 配置自动解锁（可选）
# 编辑 /etc/pam.d/login 添加：
# auth       optional     pam_gnome_keyring.so
# session    optional     pam_gnome_keyring.so auto_start
```

#### KDE 用户
KWallet 应该已预装。如果未运行：
```bash
kwalletd5 &
```

### 验证
```bash
# 使用 secret-tool 测试
secret-tool store --label='Test' service test account test
secret-tool lookup service test account test
secret-tool clear service test account test
```

---

## WorkBuddy 配置恢复失败

### 症状
看到错误提示：
```
WorkBuddy 配置恢复未完成，已停止读写，保留事务供下次恢复
```

### 原因
- 配置文件或兼容位置的权限问题
- 磁盘空间不足
- 符号链接指向只读文件系统

### 排查步骤
1. 检查事务日志是否存在：
   ```bash
   ls -la ~/.ai-helper/workbuddy-transaction.json
   ```

2. 查看日志内容（包含恢复信息）：
   ```bash
   cat ~/.ai-helper/workbuddy-transaction.json
   ```

3. 检查目标路径权限：
   ```bash
   ls -la ~/.workbuddy/
   ls -la ~/.workbuddy-ai/
   ```

### 解决方法

#### 方法 1: 修复权限
```bash
# 确保目录与文件具备私有读写权限
chmod 700 ~/.workbuddy ~/.workbuddy-ai 2>/dev/null || true
chmod 600 ~/.workbuddy/models.json ~/.workbuddy-ai/models.json 2>/dev/null || true

# 检查符号链接目标
ls -la ~/.workbuddy/models.json
```

#### 方法 2: 移除只读挂载点
如果配置在只读文件系统上：
```bash
# 取消指向只读挂载点的符号链接
rm ~/.workbuddy/models.json
# 重新创建为普通文件
touch ~/.workbuddy/models.json
chmod 600 ~/.workbuddy/models.json
```

#### 方法 3: 自动崩溃恢复（推荐）
⚠️ **切勿直接删除事务日志**！该日志包含未完成事务恢复所需的关键 before/after 快照：
```bash
# 1. 备份当前目录状态
cp -a ~/.workbuddy ~/.workbuddy.backup 2>/dev/null || true
cp -a ~/.workbuddy-ai ~/.workbuddy-ai.backup 2>/dev/null || true

# 2. 修复目标目录/文件权限后重启应用
# 应用在下次启动或访问配置时会自动从事务快照完成原子恢复。
```

### 联系支持
如需帮助，请保留以下信息：
- `~/.ai-helper/workbuddy-transaction.json` 内容
- `ls -la ~/.workbuddy/ ~/.workbuddy-ai/` 输出
- 错误发生时的操作步骤

⚠️ **注意**：事务日志可能包含 API Key，请勿上传到公开位置。

⚠️ **注意**：事务日志可能包含 API Key，请勿上传到公开位置。

---

## 旧 Unix 会话升级

### 症状
升级后首次启动要求重新登录，提示：
```
凭据格式、用途或完整性校验失败，请重新登录
```

### 原因
旧版本（v1.0.69 及之前）使用自制加密方案存储会话凭据。新版本改用系统凭据服务，无法自动迁移旧格式。

### 解决方法
1. 点击"重新登录"
2. 输入账号密码完成登录
3. 新会话将自动使用安全的系统凭据存储

### 安全说明
- ✅ 新版本使用 macOS Keychain / Linux Secret Service 保护凭据
- ✅ 旧会话文件在成功登录后自动清理
- ⚠️ 如果无法登录，请检查 Keychain/Secret Service 是否可用（见上文）

---

## 账号额度显示"换算不可用"

### 背景
新版本不再推测货币转换，而是展示服务端返回的原始平台额度。

### 显示内容
- **原始平台额度**：例如 `1,234,567`（整数）
- **说明**：`平台额度 · 换算不可用`

### 为什么这样设计
- 避免使用未经确认的汇率造成误导
- 等待服务端提供权威的额度单位和货币转换契约
- 确保用户看到的是真实的后端数据

### 如何查看人民币金额
1. 访问 [bob-api.com/wallet](https://bob-api.com/wallet)
2. 查看官方网页显示的余额和充值信息

---

## 本地图片预算说明

### 当前行为
- 本地预算限制**请求次数**，不限制金额
- 默认状态：**关闭**
- 启用后：达到次数限制前阻止新请求

### 重要提示
⚠️ **本地预算不能替代服务端账户额度硬限**
- 服务端仍以实际使用量扣费
- 本地限制可以被绕过（例如直接调用 API）
- 仅作为客户端辅助功能使用

### 推荐使用方式
1. 在 AI Helper 设置中启用"图片生成预算"
2. 设置合理的每日/每周次数限制
3. 同时在服务端账户设置中配置真正的金额上限（如可用）

### 未来计划
- 等待服务端支持可信金额硬限 API
- 改进预算为基于真实费用而非次数

---

## 需要帮助？

如果以上指南无法解决你的问题：

1. **查看日志**：
   - Windows: `%APPDATA%\com.ai-helper.app\logs\`
   - macOS: `~/Library/Logs/com.ai-helper.app/`
   - Linux: `~/.local/share/com.ai-helper.app/logs/`

2. **提交 Issue**：
   - 访问 [GitHub Issues](https://github.com/your-org/ai-helper/issues)
   - 附上相关日志（移除敏感信息）
   - 说明操作系统和版本

3. **社区支持**：
   - Discord 社区: [链接]
   - 官方文档: [链接]

---

**最后更新**: 2026-10-21  
**适用版本**: v1.0.70+
