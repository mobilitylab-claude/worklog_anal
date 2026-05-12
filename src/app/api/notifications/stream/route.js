import { sseClients, addClient } from '@/lib/sseClients';

export const dynamic = 'force-dynamic';

export async function GET() {
  let controller;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      addClient(c);
      
      const encoder = new TextEncoder();
      // 연결 성공 시 초기 메시지 전송
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', message: 'Jira 웹앱 서버 연결 성공' })}\n\n`));
    },
    cancel() {
      sseClients.delete(controller);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*', // 클라이언트 앱에서의 연결 허용
    }
  });
}
