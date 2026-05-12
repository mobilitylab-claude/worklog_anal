import { broadcastNotification, sseClients } from '@/lib/sseClients';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title') || '🚨 관리필요 이슈 알림';
  const message = searchParams.get('message') || 'WEB-1234 이슈가 지연 상태로 변경되었습니다.';

  // 현재 연결된 클라이언트들에게 모두 전송
  broadcastNotification({
    type: 'notification',
    title,
    message
  });

  return Response.json({ 
    success: true, 
    broadcastedTo: sseClients.size,
    message: '테스트 알림이 전송되었습니다.'
  });
}
