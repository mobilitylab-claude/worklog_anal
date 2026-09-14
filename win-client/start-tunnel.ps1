# ========================================================
# Jira Worklog Studio - PowerShell SSH Tunnel Launcher
# ========================================================

$UbuntuIp = "192.168.105.10"
$AppDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Jira Worklog Studio - 보안 터널 및 앱 런처" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 3000번 포트 터널 확인
Write-Host "[1/2] 로컬 3000번 포트 터널 상태 확인 중..." -ForegroundColor Yellow
$active = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue

if ($active) {
    Write-Host "✅ 이미 3000번 포트 터널이 정상 동작 중입니다." -ForegroundColor Green
} else {
    Write-Host "🔄 백그라운드 SSH 터널을 연결합니다 ($UbuntuIp)..." -ForegroundColor Yellow
    Write-Host "(우분투 비밀번호 입력을 요구할 수 있습니다)" -ForegroundColor DarkGray
    Start-Process -FilePath "ssh" -ArgumentList "-N -L 3000:127.0.0.1:3000 $($env:USERNAME)@$UbuntuIp" -WindowStyle Minimized
    Start-Sleep -Seconds 2
}

# 2. 데스크톱 앱 실행
Write-Host ""
Write-Host "[2/2] Jira Worklog Studio 앱 실행 중..." -ForegroundColor Yellow

$releaseApp = Join-Path $AppDir "src-tauri\target\release\app.exe"
$releaseWinClient = Join-Path $AppDir "src-tauri\target\release\win-client.exe"

if (Test-Path $releaseApp) {
    Start-Process -FilePath $releaseApp
    Write-Host "✅ 앱이 정상 실행되었습니다." -ForegroundColor Green
} elseif (Test-Path $releaseWinClient) {
    Start-Process -FilePath $releaseWinClient
    Write-Host "✅ 앱이 정상 실행되었습니다." -ForegroundColor Green
} else {
    Write-Host "⚠️ 릴리즈 빌드가 없어 개발 모드로 시작합니다..." -ForegroundColor Yellow
    Set-Location $AppDir
    npm run tauri dev
}
