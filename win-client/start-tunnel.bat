@echo off
setlocal enabledelayedexpansion

title Jira Worklog Studio Tunnel Launcher

set "UBUNTU_IP=192.168.105.10"
set "TARGET_DIR=%~dp0"
cd /d "%TARGET_DIR%."

echo ========================================================
echo   Jira Worklog Studio - SSH Tunnel Launcher
echo ========================================================
echo.

echo [1/2] Checking port 3000 tunnel...
netstat -ano | findstr "127.0.0.1:3000" > nul
if %errorlevel% equ 0 goto tunnel_ok

echo Starting background SSH tunnel to %UBUNTU_IP%...
start /min "Jira-SSH-Tunnel" ssh -N -L 3000:127.0.0.1:3000 %USERNAME%@%UBUNTU_IP%
timeout /t 2 > nul
goto run_app

:tunnel_ok
echo Port 3000 tunnel is already active.

:run_app
echo.
echo [2/2] Launching Jira Worklog Studio...
if exist "src-tauri\target\release\app.exe" (
    start "" "src-tauri\target\release\app.exe"
    goto finish
)
if exist "src-tauri\target\release\win-client.exe" (
    start "" "src-tauri\target\release\win-client.exe"
    goto finish
)

echo Release build not found. Running dev mode...
npm run tauri dev

:finish
echo Done.
timeout /t 2 > nul
exit
