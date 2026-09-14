@echo off
chcp 65001 > nul
title Jira Worklog Studio 보안 터널 런처

echo =======================================================
echo   Jira Worklog Studio - 보안 SSH 터널 자동 연결 런처
echo =======================================================
echo.

:: 우분투 서버 IP 설정 (필요 시 수정)
set UBUNTU_IP=192.168.105.10
set UBUNTU_PORT=3000

echo [1/2] 우분투 서버(%UBUNTU_IP%)와 3000번 로컬 보안 터널 연결 확인 중...
netstat -ano | findstr "127.0.0.1:%UBUNTU_PORT%" > nul
if %errorlevel% equ 0 (
    echo ✅ 이미 로컬 3000번 포트 터널이 연결되어 있습니다.
) else (
    echo 🔄 백그라운드 SSH 터널을 생성합니다...
    echo (우분투 계정으로 접속을 시도합니다. 비밀번호를 요구할 수 있습니다)
    start /min "Jira-SSH-Tunnel" ssh -N -L 3000:127.0.0.1:3000 %USERNAME%@%UBUNTU_IP%
    timeout /t 2 > nul
)

echo.
echo [2/2] Jira Worklog Studio 데스크톱 앱을 실행합니다...
cd /d "%~dp0"
if exist "src-tauri\target\release\app.exe" (
    start "" "src-tauri\target\release\app.exe"
) else if exist "src-tauri\target\release\win-client.exe" (
    start "" "src-tauri\target\release\win-client.exe"
) else (
    echo ⚠️ 릴리즈 빌드 파일을 찾을 수 없어 개발 모드로 실행합니다...
    npm run tauri dev
)

echo.
echo 작업이 완료되었습니다. 창을 닫아도 됩니다.
timeout /t 2 > nul
exit
