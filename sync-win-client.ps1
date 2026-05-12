# 이 스크립트는 Z:\workspace\worklog_anal\win-client의 내용을 D:\works\win-client로 동기화합니다.
# node_modules와 target 폴더는 무거운 빌드 산출물이므로 제외합니다.

robocopy .\win-client D:\works\win-client /mir /xd node_modules target src-tauri\target .next
if ($LASTEXITCODE -lt 8) {
    Write-Host "동기화 완료!"
    exit 0
} else {
    Write-Host "동기화 중 오류 발생"
    exit 1
}
