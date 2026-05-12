import { broadcastNotification, sseClients } from '@/lib/sseClients';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || '0';
  
  let payload = {};

  if (type === '1') {
    payload = {
      notiType: 'USER_WORKLOG',
      title: '홍길동(DT123456)',
      accumulatedHours: 5.5,
      message: '작업기록이 업데이트 되었습니다.'
    };
  } else if (type === '2') {
    payload = {
      notiType: 'INVALID_PROJECT',
      title: '미등록 프로젝트 코드 기록',
      message: '완료되었거나 등록되지 않은 프로젝트(UNKNOWN_PRJ)에 공수가 기록되었습니다.',
      issueKey: 'WEB-123',
      url: 'https://jira.yourcompany.com/browse/WEB-123',
      author: '김철수',
      time: '2026-05-12 10:30'
    };
  } else if (type === '3') {
    payload = {
      notiType: 'INVALID_TASK_TYPE',
      title: '미정의 작업유형 기록',
      message: '정의되지 않은 작업유형(디자인/기타)으로 공수가 기록되었습니다.',
      issueKey: 'WEB-124',
      url: 'https://jira.yourcompany.com/browse/WEB-124',
      author: '이영희',
      time: '2026-05-12 10:35'
    };
  } else if (type === '4') {
    payload = {
      notiType: 'TIME_EXCEEDED',
      title: '예상 시간 초과',
      message: '누적 작업시간(10h)이 예상시간(8h)을 초과하였습니다.',
      issueKey: 'WEB-125',
      url: 'https://jira.yourcompany.com/browse/WEB-125',
      author: '박지성',
      time: '2026-05-12 10:40'
    };
  } else {
    payload = {
      notiType: 'GENERAL',
      title: searchParams.get('title') || '일반 알림',
      message: searchParams.get('message') || '기본 알림 테스트입니다.'
    };
  }

  broadcastNotification({
    type: 'notification',
    ...payload
  });

  return Response.json({ 
    success: true, 
    broadcastedTo: sseClients.size,
    payload
  });
}
