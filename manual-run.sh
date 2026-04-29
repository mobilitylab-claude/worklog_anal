#!/bin/bash

# 1. 경로 설정 (표준 POSIX 방식으로 수정)
STR_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$STR_DIR"

# 2. 사용자 입력 받기
echo "------------------------------------------------"
echo "  Jira 워크로그 수동 리포트 생성기"
echo "------------------------------------------------"
read -p "대상 날짜를 입력하세요 (예: 2026-04-28 또는 2026-04): " TARGET_DATE
read -p "스케줄 타입을 선택하세요 (daily / monthly / enter=둘다): " TARGET_TYPE

if [ -z "$TARGET_DATE" ]; then
    echo "날짜를 입력해야 합니다. 종료합니다."
    exit 1
fi

echo "[$(date)] 수동 실행 시작: 날짜=$TARGET_DATE, 타입=$TARGET_TYPE"

# 3. 스크립트 실행 (Node 20+의 내장 환경변수 로드 기능 사용)
node --env-file=.env scripts/manual-force-run.mjs "$TARGET_DATE" "$TARGET_TYPE"

echo "------------------------------------------------"
echo "작업이 완료되었습니다. cron_log.txt를 확인하세요."
