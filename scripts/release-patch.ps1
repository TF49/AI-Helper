param(
    [Parameter(Mandatory=$false)]
    [string]$Message = "Bug fixes and improvements"
)

$ErrorActionPreference = 'Stop'

Write-Host @"
╔═══════════════════════════════════════════════════════════╗
║       🚀 AI Helper - Patch Version Release                ║
╚═══════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host "`n📝 更新说明: $Message`n" -ForegroundColor White

# 调用主版本升级脚本
& "$PSScriptRoot\bump-version.ps1" -BumpType patch -Message $Message
