@echo off
chcp 949 > nul
title Jira Worklog Studio ?°ì²˜

set "UBUNTU_IP=192.168.105.10"
cd /d "%~dp0."

echo ========================================================
echo   Jira Worklog Studio - ?í´ë¦??¤í–‰ ?°ì²˜
echo ========================================================
echo.

echo [1/2] 3000ë²??¬íŠ¸ ?íƒœ ?ê? ì¤?..
netstat -ano | findstr "127.0.0.1:3000" > nul
if %errorlevel% equ 0 (
    echo [?ˆë‚´] 3000ë²??¬íŠ¸ê°€ ?œì„±?”ë˜???ˆìŠµ?ˆë‹¤.
    goto run_app
)

echo [?ˆë‚´] ?°ë¶„???œë²„(%UBUNTU_IP%)ë¡?ì§ì ‘ ?°ê²°?©ë‹ˆ??

:run_app
echo.
echo [2/2] Jira Worklog Studio ?°ìŠ¤?¬í†± ???¤í–‰ ì¤?..
if exist "src-tauri\target\release\app.exe" (
    start "" "src-tauri\target\release\app.exe"
    goto finish
)
if exist "src-tauri\target\release\win-client.exe" (
    start "" "src-tauri\target\release\win-client.exe"
    goto finish
)

echo [ê²½ê³ ] ë¦´ë¦¬ì¦?ë¹Œë“œë¥?ì°¾ì„ ???†ì–´ ê°œë°œ ëª¨ë“œë¡??¤í–‰?©ë‹ˆ??..
npm run tauri dev

:finish
echo.
echo [?„ë£Œ] ?¤í–‰???„ë£Œ?˜ì—ˆ?µë‹ˆ?? 2ì´???ì°½ì´ ?ë™?¼ë¡œ ?«íž™?ˆë‹¤.
timeout /t 2 > nul
exit