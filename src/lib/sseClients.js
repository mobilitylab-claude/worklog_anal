export const sseClients = new Set();
let pollingInterval = null;

const startPolling = () => {
  if (pollingInterval) return;
  
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

  runPoll(); // 최초 즉시 실행
  pollingInterval = setInterval(runPoll, 10 * 60 * 1000); // 이후 10분마다
};

const stopPolling = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

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
