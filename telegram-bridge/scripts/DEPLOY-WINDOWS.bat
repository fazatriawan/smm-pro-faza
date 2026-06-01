@echo off
REM === DEPLOY telegram-bridge ke VPS ===
REM Jalankan di WINDOWS (double-click), BUKAN di SSH Linux!
echo.
echo [1/2] Upload src/ ke VPS 187.77.118.131 ...
scp -r "%~dp0..\src" root@187.77.118.131:/opt/telegram-bridge/
if errorlevel 1 (
  echo GAGAL upload. Pastikan password root VPS benar.
  pause
  exit /b 1
)

echo.
echo [2/2] Restart PM2 ...
ssh root@187.77.118.131 "cd /opt/telegram-bridge && pm2 restart smm-telegram-bridge && pm2 save && grep -c pick src/services/bot.js"
if errorlevel 1 (
  echo GAGAL ssh. Coba lagi.
  pause
  exit /b 1
)

echo.
echo SELESAI. Tes di Telegram: /ping  /akun ig  /stop ig ya
pause
