# Deploy telegram-bridge ke VPS (upload src/ + restart PM2)
# Jalankan dari PowerShell:
#   cd C:\smm-pro-faza-main\telegram-bridge
#   .\scripts\deploy-vps.ps1
#
# Auth: pakai key C:\Users\User\.ssh\smm_vps_deploy jika sudah di authorized_keys VPS.
# Kalau belum, script minta password root (2×: scp + ssh).

$ErrorActionPreference = "Stop"
$Host_ = "187.77.118.131"
$User = "root"
$Remote = "/opt/telegram-bridge"
$Root = Split-Path $PSScriptRoot -Parent
$Key = Join-Path $env:USERPROFILE ".ssh\smm_vps_deploy"
$SshArgs = @("-o", "StrictHostKeyChecking=accept-new")
if (Test-Path $Key) {
  $SshArgs += @("-i", $Key)
}

Write-Host "==> Upload src/ -> ${User}@${Host_}:${Remote}/"
& scp @SshArgs -r (Join-Path $Root "src") "${User}@${Host_}:${Remote}/"

Write-Host "==> Restart PM2 + cek /pick di bot.js"
$RemoteCmd = @"
cd ${Remote} && pm2 restart smm-telegram-bridge && pm2 save && grep -c 'command.*pick' src/services/bot.js && pm2 logs smm-telegram-bridge --lines 12 --nostream
"@
& ssh @SshArgs "${User}@${Host_}" $RemoteCmd

Write-Host ""
Write-Host "Selesai. Tes di Telegram: /ping  /akun ig  /stop ig"
