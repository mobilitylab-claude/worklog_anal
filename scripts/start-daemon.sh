#!/bin/bash
# ==============================================================================
# 우분투 리눅스 로컬 전용 백엔드 데몬 관리 스크립트
# - 127.0.0.1:3000에만 바인딩되어 외부 포트 스캔/보안 점검에서 완전히 은닉됩니다.
# - 윈도우 win-client 앱에서 SSH 터널(포트 22)을 통해 안전하게 통신합니다.
# ==============================================================================

PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$PROJECT_DIR"

PID_FILE="$PROJECT_DIR/.backend.pid"
LOG_FILE="$PROJECT_DIR/backend_daemon.log"

case "$1" in
  start)
    # 3000번 포트를 점유하고 있는 기존 프로세스 및 next start 프로세스 확인 및 정리
    fuser -k -9 3000/tcp 2>/dev/null
    OLD_PID=$(lsof -ti:3000 2>/dev/null)
    if [ -n "$OLD_PID" ]; then
      echo "⚠️ 3000번 포트를 점유 중인 기존 프로세스(PID: $OLD_PID)를 종료합니다..."
      kill -9 $OLD_PID 2>/dev/null
      sleep 1
    fi
    pkill -9 -f "next start" 2>/dev/null

    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "⚠️ 기존 백엔드 데몬 종료 중 (PID: $(cat $PID_FILE))..."
      kill -9 $(cat "$PID_FILE") 2>/dev/null
      rm -f "$PID_FILE"
      sleep 1
    fi

    echo "🚀 Next.js 백엔드 데몬 시작 중 (포트 3000)..."
    nohup npm start >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3

    if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "✅ 백엔드 데몬이 정상 구동되었습니다. (PID: $(cat $PID_FILE))"
      echo "로그 확인: tail -n 20 $LOG_FILE"
    else
      echo "❌ 백엔드 데몬 구동 실패. 로그 확인:"
      tail -n 15 "$LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    echo "🛑 백엔드 데몬 종료 중..."
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      kill -9 "$PID" 2>/dev/null
      rm -f "$PID_FILE"
    fi
    fuser -k -9 3000/tcp 2>/dev/null
    OLD_PID=$(lsof -ti:3000 2>/dev/null)
    if [ -n "$OLD_PID" ]; then
      kill -9 $OLD_PID 2>/dev/null
    fi
    pkill -9 -f "next start" 2>/dev/null
    sleep 1
    echo "✅ 종료 완료."
    ;;

  status)
    LISTEN_PID=$(lsof -ti:3000 2>/dev/null || fuser 3000/tcp 2>/dev/null | awk '{print $1}')
    if [ -n "$LISTEN_PID" ]; then
      echo "🟢 백엔드 데몬 정상 동작 중 (포트 3000 리슨 PID: $LISTEN_PID)"
    elif [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "🟢 백엔드 데몬 프로세스 동작 중 (PID: $(cat $PID_FILE))"
    else
      echo "🔴 백엔드 데몬 정지 상태"
    fi
    ;;

  restart)
    $0 stop
    sleep 1
    $0 start
    ;;

  rebuild)
    echo "📦 Next.js 최신 소스코드 빌드 중..."
    node ./node_modules/next/dist/bin/next build
    if [ $? -eq 0 ]; then
      echo "✅ 빌드 완료! 백엔드 데몬을 재시작합니다..."
      $0 restart
    else
      echo "❌ 빌드 실패. 에러 로그를 확인하세요."
      exit 1
    fi
    ;;

  *)
    echo "사용법: $0 {start|stop|restart|rebuild|status}"
    exit 1
    ;;
esac
