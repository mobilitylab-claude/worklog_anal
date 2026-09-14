import { sseClients, addClient } from '@/lib/sseClients';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  let heartbeatTimer = null;
  let clientController = null;

  const stream = new ReadableStream({
    start(controller) {
      clientController = controller;
      addClient(controller);
      
      // 1. 연결 성공 즉시 알림 전송
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', message: 'Jira 웹앱 서버 연결 성공' })}\n\n`));
      } catch (e) {}

      // 2. 15초마다 Keep-Alive 핑 전송 (WebView2/브라우저 연결 끊김 방지)
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch (e) {
          clearInterval(heartbeatTimer);
          if (clientController) sseClients.delete(clientController);
        }
      }, 15000);
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (clientController) sseClients.delete(clientController);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 버퍼링 방지 필수
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}

