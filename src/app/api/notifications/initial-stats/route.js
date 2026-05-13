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
    const details = {};
    targets.forEach(t => { 
      stats[t] = 0; 
      details[t] = [];
    });

    // 한글 이름 -> DT 계정 매핑 조회 (JQL 최적화용)
    const dtAccounts = [];
    const dtToName = {};
    
    for (const name of targets) {
      const userRow = db.prepare('SELECT dt_account FROM users WHERE name = ?').get(name);
      if (userRow && userRow.dt_account) {
        dtAccounts.push(userRow.dt_account);
        dtToName[userRow.dt_account] = name;
      } else {
        // DB에 없으면 이름 그대로 사용 (폴백)
        dtAccounts.push(name);
        dtToName[name] = name;
      }
    }

    const loadingLogs = [];
    const step1 = `[1/4] 모니터링 대상자 확인: ${targets.join(', ')}`;
    loadingLogs.push(step1);
    console.log(`[Initial Stats] ${step1}`);

    // 한국 시간 기준으로 오늘 및 내일 날짜 추출 (YYYY-MM-DD)
    const today = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
    const todayStr = today.toISOString().split('T')[0];
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // 사용자가 제안한 대로 worklogAuthor in () 을 활용하여 쿼리 최적화 (DT 계정 기반)
    const jql = `worklogDate >= "${todayStr}" AND worklogDate < "${tomorrowStr}" AND worklogAuthor in (${dtAccounts.map(id => `"${id}"`).join(', ')})`;
    const step2 = `[2/4] JQL 실행: ${jql}`;
    loadingLogs.push(step2);
    console.log(`[Initial Stats] ${step2}`);
    
    const issues = await fetchJiraSearch(jql, ['summary']);
    const step3 = `[3/4] 이슈 검색 완료: ${issues.length}개의 이슈 발견`;
    loadingLogs.push(step3);
    console.log(`[Initial Stats] ${step3}`);

    const JIRA_DOMAIN = (process.env.JIRA_DOMAIN || process.env.JIRA_HOST || "").replace(/\/$/, "");
    const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
    const authHeader = `Bearer ${JIRA_API_TOKEN}`;

    const results = [];
    const chunkSize = 5;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < issues.length; i += chunkSize) {
      const chunk = issues.slice(i, i + chunkSize);
      console.log(`[Initial Stats] Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(issues.length / chunkSize)}...`);
      
      const chunkResults = await Promise.all(chunk.map(async (iss) => {
        const issueKey = iss.key;
        let wls = [];
        let startAt = 0;
        let total = 1;
        
        try {
          while (wls.length < total) {
            const url = `${JIRA_DOMAIN}/rest/api/2/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=1000`;
            let res;
            let retries = 0;
            const maxRetries = 5;
            
            while (retries < maxRetries) {
              res = await fetch(url, {
                method: "GET",
                headers: { "Authorization": authHeader }
              });
              
              if (res.status === 429) {
                console.log(`[Initial Stats] 429 hit for ${issueKey}. Waiting 3s (retry ${retries + 1}/${maxRetries})...`);
                await sleep(3000);
                retries++;
              } else {
                break;
              }
            }
            
            if (res.ok) {
              const data = await res.json();
              const logs = data.worklogs || [];
              wls = wls.concat(logs);
              total = data.total ?? 0;
              if (logs.length === 0) break;
              startAt += logs.length;
            } else {
              console.error(`Failed to fetch worklogs for ${issueKey}: HTTP ${res.status}`);
              loadingLogs.push(`⚠️ [경고] ${issueKey} 작업기록 조회 실패: HTTP ${res.status}`);
              break;
            }
          }
          return { issueKey, wls, summary: iss.fields?.summary || '' };
        } catch (e) {
          console.error(`Failed to fetch worklogs for ${issueKey}:`, e.message);
          loadingLogs.push(`⚠️ [에러] ${issueKey} 작업기록 조회 실패: ${e.message}`);
          return { issueKey, wls: [], summary: iss.fields?.summary || '' };
        }
      }));
      
      results.push(...chunkResults);
      
      // 429 방지를 위해 청크 사이에 200ms 대기
      if (i + chunkSize < issues.length) {
        await sleep(200);
      }
    }

    let totalWorklogsFetched = 0;
    let totalWorklogsMatchedUser = 0;
    let totalWorklogsMatchedDate = 0;

    for (const result of results) {
      const { issueKey, wls, summary } = result;
      totalWorklogsFetched += wls.length;
      
      for (const w of wls) {
        const wlAuthorId = w.author?.name || "";
        const wlAuthorName = w.author?.displayName || "";
        
        // DT 계정으로 먼저 매핑 시도, 없으면 표시이름으로 시도
        const matchedTarget = dtToName[wlAuthorId] || targets.find(t => wlAuthorName.toLowerCase().includes(t.toLowerCase()));
        
        if (matchedTarget) {
          totalWorklogsMatchedUser++;
          
          // 한국 시간 기준으로 날짜 비교
          if (w.started) {
            const wlDate = new Date(w.started);
            const wlKstDateStr = new Date(wlDate.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            if (wlKstDateStr === todayStr) {
              totalWorklogsMatchedDate++;
              const hours = (w.timeSpentSeconds || 0) / 3600;
              stats[matchedTarget] += hours;
              details[matchedTarget].push({
                issueKey: issueKey,
                summary: summary,
                hours: parseFloat(hours.toFixed(1)),
                comment: w.comment || '',
                time: w.started
              });
            }
          }
        }
      }
    }

    console.log(`[Initial Stats] Total Issues: ${issues.length}`);
    console.log(`[Initial Stats] Total Worklogs Fetched: ${totalWorklogsFetched}`);
    console.log(`[Initial Stats] Worklogs Matched User: ${totalWorklogsMatchedUser}`);
    console.log(`[Initial Stats] Worklogs Matched Date (Today): ${totalWorklogsMatchedDate}`);

    const step3_5 = `[3.5/4] 분석 결과: 작업기록 총 ${totalWorklogsFetched}개 중 대상자 매칭 ${totalWorklogsMatchedUser}개, 오늘 날짜 매칭 ${totalWorklogsMatchedDate}개`;
    loadingLogs.push(step3_5);

    // 포맷팅 (소수점 1자리)
    const formattedStats = {};
    for (const [name, val] of Object.entries(stats)) {
      formattedStats[name] = parseFloat(val.toFixed(1));
    }

    const step4 = `[4/4] 작업기록 분석 완료 (대상자: ${Object.keys(formattedStats).length}명)`;
    loadingLogs.push(step4);
    console.log(`[Initial Stats] ${step4}`);

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };

    console.log(`[Initial Stats] Returning stats for ${Object.keys(formattedStats).length} users. Details keys: ${Object.keys(details).length}`);
    return Response.json({ success: true, stats: formattedStats, details, loadingLogs }, { headers });
  } catch (e) {
    console.error("Initial stats error:", e);
    return Response.json({ success: false, error: e.message }, { 
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
