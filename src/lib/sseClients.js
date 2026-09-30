import db from '@/lib/db';

export const sseClients = new Set();
let pollingInterval = null;

// DB에서 현재 설정된 자동 업데이트 주기(분) 조회 (기본값: 10, 0은 사용 안 함)
export function getMonitorInterval() {
  try {
    const row = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get('monitor_interval_minutes');
    if (row && row.value !== undefined && row.value !== null) {
      const parsed = parseInt(row.value, 10);
      return isNaN(parsed) ? 10 : parsed;
    }
    return 10;
  } catch (e) {
    return 10;
  }
}

const runPoll = async () => {
  if (sseClients.size === 0) return;
  try {
    await fetch("http://127.0.0.1:3000/api/cron/jira-monitor").catch(() => 
      fetch("http://192.168.105.10:3000/api/cron/jira-monitor")
    );
  } catch (e) {
    console.error("Cron polling failed", e.message);
  }
};

const startPolling = () => {
  if (pollingInterval) return;

  const intervalMins = getMonitorInterval();
  if (intervalMins <= 0) {
    // 자동 업데이트 사용 안 함 (수동 갱신 모드)
    return;
  }

  // 지정된 분 간격으로 폴링 시작
  pollingInterval = setInterval(runPoll, intervalMins * 60 * 1000);
};

const stopPolling = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

// 동적으로 폴링 주기 업데이트 및 실행 중인 타이머 재설정
export function updatePollingInterval(newIntervalMinutes) {
  stopPolling();

  const intervalMins = parseInt(newIntervalMinutes, 10);
  const safeInterval = isNaN(intervalMins) ? 10 : intervalMins;

  if (safeInterval > 0 && sseClients.size > 0) {
    pollingInterval = setInterval(runPoll, safeInterval * 60 * 1000);
  }

  // 연결된 모든 클라이언트에게 설정 변경 알림 브로드캐스트
  broadcastNotification({
    notiType: 'CONFIG_CHANGED',
    monitorInterval: safeInterval,
    time: new Date().toLocaleTimeString()
  });
}

export function broadcastNotification(payload) {
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  const encoder = new TextEncoder();
  
  sseClients.forEach(client => {
    try {
      client.enqueue(encoder.encode(dataString));
    } catch (e) {
      console.error("SSE 전송 에러, 클라이언트 삭제");
      sseClients.delete(client);
      if (sseClients.size === 0) stopPolling();
    }
  });
}

export function addClient(client) {
  sseClients.add(client);
  startPolling();
  
  // 신규 클라이언트 접속 시 즉시 데이터 갱신을 위해 1회 조회
  fetch("http://127.0.0.1:3000/api/cron/jira-monitor").catch(() => 
    fetch("http://192.168.105.10:3000/api/cron/jira-monitor")
  ).catch(e => console.error("Immediate poll failed", e.message));
}
