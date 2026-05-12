export const sseClients = new Set();

export function broadcastNotification(payload) {
  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  const encoder = new TextEncoder();
  
  sseClients.forEach(client => {
    try {
      client.enqueue(encoder.encode(dataString));
    } catch (e) {
      console.error("SSE 전송 에러, 클라이언트 삭제");
      sseClients.delete(client);
    }
  });
}
