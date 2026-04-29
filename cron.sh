#!/bin/bash

# 1. 경로 설정 (표준 POSIX 방식으로 수정)
STR_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$STR_DIR"

# 2. 독립형 스케줄러 스크립트 실행
# Node 20+의 내장 환경변수 로드 기능 사용
node --env-file=.env scripts/cron-run.mjs >> cron_log.txt 2>&1

echo "[$(date)] 스케줄러 실행 완료. 상세 내용은 cron_log.txt를 확인하세요."
