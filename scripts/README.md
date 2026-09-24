# AI Helper - 发布脚本使用指南

## 📋 脚本列表

### 1. `bump-version.ps1` - 版本升级主脚本

**功能**: 自动化版本升级流程

**参数**:
- `-BumpType` (必需): 版本类型
  - `major`: 主版本号 (1.0.0 → 2.0.0) - 重大更新
  - `minor`: 次版本号 (1.0.0 → 1.1.0) - 新功能
  - `patch`: 修订号 (1.0.0 → 1.0.1) - Bug 修复
- `-Message` (可选): 版本更新说明

**使用示例**:
```powershell
# Bug 修复 (推荐使用 release-patch.ps1)
.\scripts\bump-version.ps1 -BumpType patch -Message "修复网络检测误报问题"

# 新增功能
.\scripts\bump-version.ps1 -BumpType minor -Message "新增模型自动同步功能"

# 重大更新
.\scripts\bump-version.ps1 -BumpType major -Message "全新 UI 设计"
```

### 2. `release-patch.ps1` - 快速发布 Patch 版本

**功能**: 快速发布 bug 修复版本（自动递增 patch 版本号）

**参数**:
- `-Message` (可选): 更新说明，默认为 "Bug fixes and improvements"

**使用示例**:
```powershell
# 最简单的方式 - 使用默认说明
.\scripts\release-patch.ps1

# 自定义说明
.\scripts\release-patch.ps1 -Message "修复网络检测和配置保存问题"
```

### 3. `package-release.ps1` - 打包发布文件

**功能**: 打包构建产物为发布文件

**参数**:
- `-Tag` (可选): 版本标签，默认使用 package.json 中的版本

**使用示例**:
```powershell
# 使用当前版本
.\scripts\package-release.ps1

# 指定版本
.\scripts\package-release.ps1 -Tag v1.0.1
```

**注意**: 此脚本通常由 GitHub Actions 自动调用，本地使用较少。

---

## 🔄 完整发布流程

### 场景 1: 修复 Bug（最常见）

```powershell
# 1. 修改代码，修复 bug
# 2. 测试验证修复有效

# 3. 快速发布 patch 版本
.\scripts\release-patch.ps1 -Message "修复网络检测VPN误报问题"

# 4. 脚本会自动：
#    - 递增版本号（例如 1.0.0 → 1.0.1）
#    - 创建 release notes 模板
#    - 提交代码和 tag
#    - 提示是否推送到 GitHub

# 5. 确认推送后，GitHub Actions 将自动构建和发布
```

### 场景 2: 新增功能

```powershell
# 1. 开发新功能
# 2. 测试功能正常工作

# 3. 升级 minor 版本
.\scripts\bump-version.ps1 -BumpType minor -Message "新增快速配置导入导出功能"

# 4. 编辑生成的 release notes（scripts/docs/releases/vX.X.X.md）
# 5. 确认并推送到 GitHub
```

### 场景 3: 重大更新

```powershell
# 1. 完成重大改版
# 2. 全面测试

# 3. 升级 major 版本
.\scripts\bump-version.ps1 -BumpType major -Message "全新界面设计和架构重构"

# 4. 编辑 release notes
# 5. 推送到 GitHub
```

---

## 📝 Release Notes 指南

每次版本升级时，脚本会在 `docs/releases/` 目录创建对应的 markdown 文件。

**模板结构**:
```markdown
# AI Helper vX.X.X

**发布日期**: YYYY-MM-DD

## 🎯 本次更新

### 新增功能
- 列出新增的功能

### 🐛 Bug 修复
- 列出修复的 bug

### 🔧 改进
- 列出改进的地方

## 📦 下载
## ✅ 校验和
## 🔄 升级说明
```

**编辑建议**:
1. 使用清晰的描述语言
2. 突出用户可感知的变化
3. 包含已知问题和限制（如果有）
4. 添加截图或 GIF（可选）

---

## 🤖 GitHub Actions 自动化

当你推送带有 `v*.*.*` 格式的 tag 到 GitHub 时，`.github/workflows/release.yml` 将自动：

1. ✅ 检出代码
2. ✅ 安装依赖
3. ✅ 运行类型检查
4. ✅ 运行后端测试
5. ✅ 构建 Windows 安装程序和便携版
6. ✅ 打包发布文件
7. ✅ 创建 GitHub Release（草稿）
8. ✅ 上传安装包和校验和文件
9. ✅ 发布 release

**查看构建状态**: 
https://github.com/YOUR_USERNAME/YOUR_REPO/actions

---

## ⚠️ 注意事项

1. **版本号必须一致**: `package.json`、`Cargo.toml`、`tauri.conf.json` 的版本号会被自动同步

2. **Release Notes 必需**: 推送 tag 前必须创建对应的 release notes 文件，否则 GitHub Actions 会失败

3. **工作目录要干净**: 建议在干净的工作目录运行版本升级脚本，或者确认所有未提交的更改都应该包含在新版本中

4. **Tag 不可覆盖**: GitHub Actions 不会覆盖已存在的 tag/release，如需重新发布需手动删除旧的 tag 和 release

5. **测试充分**: 发布前确保本地测试通过，因为发布后无法撤回

---

## 💡 快速参考

```powershell
# 最常用：修复 bug 后快速发布
.\scripts\release-patch.ps1 -Message "修复XXX问题"

# 新增功能发布
.\scripts\bump-version.ps1 -BumpType minor -Message "新增XXX功能"

# 查看当前版本
Get-Content package.json | ConvertFrom-Json | Select-Object -ExpandProperty version

# 查看最近的 tag
git tag --sort=-v:refname | Select-Object -First 5

# 查看未推送的 tag
git log --oneline --decorate origin/main..main

# 撤销最后一次版本升级（未推送的情况下）
git reset --hard HEAD~1
git tag -d $(git describe --tags --abbrev=0)
```

---

## 🆘 常见问题

### Q: 版本号搞错了怎么办？
A: 如果还没推送，可以运行：
```powershell
git reset --hard HEAD~1
git tag -d vX.X.X
```
然后重新运行版本升级脚本。

### Q: Release Notes 写错了怎么办？
A: 修改 `docs/releases/vX.X.X.md` 文件后：
```powershell
git add docs/releases/vX.X.X.md
git commit --amend --no-edit
git tag -f vX.X.X
```

### Q: GitHub Actions 构建失败怎么办？
A: 
1. 查看 Actions 日志找到错误原因
2. 删除远程 tag: `git push --delete origin vX.X.X`
3. 修复问题后重新运行版本升级脚本

### Q: 如何跳过自动推送？
A: 运行脚本后，当提示"是否现在推送到 GitHub?"时，输入 `n` 即可。稍后可以手动推送：
```powershell
git push && git push --tags
```

---

**祝发布顺利！** 🎉
