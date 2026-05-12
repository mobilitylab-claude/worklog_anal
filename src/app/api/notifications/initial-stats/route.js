import { fetchJiraSearch } from '@/lib/jiraClient';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const row = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get('noti_target_USER_WORKLOG');
    const targetStr = row ? row.value : '';
    
    // 대상자가 명시적으로 없으면 빈 객체 반환 (전체 사용자를 미리 로드하기엔 부담됨)
    if (!targetStr) {
      return Response.json({ success: true, stats: {} });
    }

    const targets = targetStr.split(',').map(s => s.trim()).filter(s => s);
    if (targets.length === 0) {
      return Response.json({ success: true, stats: {} });
    }

    // 기본적으로 모두 0으로 초기화
    const stats = {};
    targets.forEach(t => { stats[t] = 0; });

    // JQL을 이용해 대상자들의 오늘자 워크로그 검색
    // JQL IN 구문은 따옴표로 감싸진 값의 리스트를 받습니다.
    const authorListStr = targets.map(t => `"${t}"`).join(', ');
    const jql = `worklogAuthor IN (${authorListStr}) AND worklogDate >= startOfDay() AND worklogDate <= endOfDay()`;
    
    const issues = await fetchJiraSearch(jql, ['worklog']);
    
    // 한국 시간 기준으로 오늘 날짜 추출 (YYYY-MM-DD)
    const todayStr = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const iss of issues) {
      const wls = iss.fields?.worklog?.worklogs || [];
      for (const w of wls) {
        const wlAuthor = w.author?.name || w.author?.displayName;
        if (targets.includes(wlAuthor)) {
          // 오늘 날짜인지 한 번 더 확인 (JQL은 서버시간 기준일 수 있으므로)
          if (w.started && w.started.startsWith(todayStr)) {
            stats[wlAuthor] += (w.timeSpentSeconds || 0) / 3600;
          }
        }
      }
    }

    // 포맷팅 (소수점 1자리)
    const formattedStats = {};
    for (const [name, val] of Object.entries(stats)) {
      formattedStats[name] = parseFloat(val.toFixed(1));
    }

    return Response.json({ success: true, stats: formattedStats });
  } catch (e) {
    console.error("Initial stats error:", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
