# Deploy telegram-bridge ke VPS — jalankan di PowerShell Windows (bisa minta password root)
$ErrorActionPreference = "Stop"
$Host_ = "187.77.118.131"
$User = "root"
$Remote = "/opt/telegram-bridge"
$Root = Split-Path $PSScriptRoot -Parent
$Key = Join-Path $env:USERPROFILE ".ssh\smm_vps_deploy"
$SshArgs = @("-o", "StrictHostKeyChecking=accept-new")
if (Test-Path $Key) { $SshArgs += @("-i", $Key) }

Write-Host ""
Write-Host "=== Deploy telegram-bridge -> ${User}@${Host_} ===" -ForegroundColor Cyan
Write-Host "Jika diminta password, masukkan password root VPS." -ForegroundColor Yellow
Write-Host ""

Write-Host "[1/3] Upload src/ ..."
& scp @SshArgs -r (Join-Path $Root "src") "${User}@${Host_}:${Remote}/"
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "GAGAL upload. Opsi:" -ForegroundColor Red
  Write-Host "  A) Pastikan password root benar, jalankan script ini lagi"
  Write-Host "  B) Pasang SSH key di VPS (sekali saja):"
  Write-Host "     ssh root@${Host_}"
  Write-Host "     echo '$(Get-Content "$Key.pub" -Raw)' >> ~/.ssh/authorized_keys"
  Read-Host "Tekan Enter untuk keluar"
  exit 1
}

Write-Host "[2/3] Restart PM2 ..."
$cmd = "cd ${Remote} && pm2 restart smm-telegram-bridge --update-env && pm2 save"
& ssh @SshArgs "${User}@${Host_}" $cmd
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[3/3] Verifikasi fitur baru ..."
$verify = @"
cd ${Remote} && \
grep -c 'stopsupport' src/services/bot.js && \
grep -c 'buildOutstandCancelSupportDraft' src/services/pendingControl.js && \
grep -c 'cancelOutstandPost' src/services/outstand.js && \
pm2 logs smm-telegram-bridge --lines 8 --nostream
"@
& ssh @SshArgs "${User}@${Host_}" $verify

Write-Host ""
Write-Host "SELESAI. Tes di Telegram:" -ForegroundColor Green
Write-Host "  /ping"
Write-Host "  /status ghy7x"
Write-Host "  /stopsupport ghy7x, O39Av"
Write-Host ""
Read-Host "Tekan Enter untuk menutup"
