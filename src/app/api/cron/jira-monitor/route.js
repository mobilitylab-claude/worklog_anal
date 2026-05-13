import { fetchJiraSearch } from '@/lib/jiraClient';
import { broadcastNotification, sseClients } from '@/lib/sseClients';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

// 실제 상용에서는 DB에 저장해야 하지만 현재는 메모리 캐시 사용
const notifiedCache = new Set();
let lastRunTime = 0;

const extractTextFromADF = (node) => {
  if (typeof node === "string") return node;
  if (!node) return "";
  let text = "";
  if (node.text) text += node.text;
  if (node.content && Array.isArray(node.content)) {
    text += node.content.map(extractTextFromADF).join(" ");
  }
  return text;
};

export async function GET() {
  if (sseClients.size === 0) {
    return Response.json({ success: true, message: '접속된 클라이언트가 없어 모니터링 생략' });
  }

  const now = Date.now();
  if (now - lastRunTime < 1 * 60 * 1000) {
    return Response.json({ success: true, message: '중복 실행 방지: 최근 1분 이내에 이미 실행되었습니다.' });
  }
  lastRunTime = now;

  const getRuleData = (key) => {
    try {
      const rowVal = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get(`noti_rule_${key}`);
      const isActive = rowVal ? rowVal.value === 'true' : true; 
      const rowTarget = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get(`noti_target_${key}`);
      const target = rowTarget ? rowTarget.value.trim() : '';
      return { isActive, target };
    } catch (e) { return { isActive: true, target: '' }; }
  };

  const rules = {
    USER_WORKLOG: getRuleData('USER_WORKLOG'),
    INVALID_PROJECT: getRuleData('INVALID_PROJECT'),
    INVALID_TASK_TYPE: getRuleData('INVALID_TASK_TYPE'),
    TIME_EXCEEDED: getRuleData('TIME_EXCEEDED')
  };

  if (!Object.values(rules).some(v => v.isActive)) {
    return Response.json({ success: true, message: '모든 규칙이 비활성화됨' });
  }

  // 대상 필터링 함수
  const isTargetMatched = (targetStr, checkValues) => {
    if (!targetStr) return true; // 빈 값이면 전체 대상
    const targets = targetStr.toLowerCase().split(',').map(s => s.trim()).filter(s => s);
    if (targets.length === 0) return true;
    
    // checkValues 배열 중 하나라도 targets 문자열을 포함하면 통과
    return checkValues.some(val => {
      const lowerVal = String(val).toLowerCase();
      return targets.some(t => lowerVal.includes(t));
    });
  };

  // 표준 DB 목록 가져오기
  const validProjectsRow = db.prepare('SELECT code, end_date FROM projects').all();
  const validProjects = [];
  const completedProjects = [];
  
  // 한국 시간 기준으로 오늘 날짜 추출 (YYYY-MM-DD)
  const todayStr = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

  validProjectsRow.forEach(p => {
    if (p.code) {
      const isCompleted = p.end_date && p.end_date < todayStr;
      p.code.split(',').forEach(c => {
        const cleanCode = c.trim().toLowerCase();
        if (isCompleted) completedProjects.push(cleanCode);
        else validProjects.push(cleanCode);
      });
    }
  });
  
  const validTypesRow = db.prepare('SELECT name, keywords_json FROM work_types').all();
  const validTypes = [];
  validTypesRow.forEach(t => {
    if (t.name) validTypes.push(t.name.trim().toLowerCase());
    try {
      const keywords = JSON.parse(t.keywords_json || '[]');
      keywords.forEach(k => validTypes.push(k.trim().toLowerCase()));
    } catch (e) {}
  });

  // 최근 20분 이내 업데이트된 이슈만 가볍게 조회
  const jql = `updated >= -20m`;
  let issues = [];
  try {
    issues = await fetchJiraSearch(jql, ['summary', 'timetracking', 'worklog', 'project']);
  } catch (err) {
    return Response.json({ success: false, error: err.message });
  }

  // 오늘 날짜 기준 유저별 누적 시간 캐시 (이번 Cron 실행 중에만 재사용)
  const userDailyHoursCache = {};
  const userDetailsCache = {};

  // 미리 모든 대상자의 오늘 누적 시간을 계산하여 캐시에 채워둠 (JQL 제약 및 페이지네이션 해결)
  try {
    if (rules.USER_WORKLOG.isActive && rules.USER_WORKLOG.target) {
      const targets = rules.USER_WORKLOG.target.split(',').map(s => s.trim()).filter(s => s);
      if (targets.length > 0) {
        const jqlAll = `worklogDate >= startOfDay() AND worklogDate <= endOfDay()`;
        const issuesAll = await fetchJiraSearch(jqlAll, ['summary']);
        
        const JIRA_DOMAIN_MON = (process.env.JIRA_DOMAIN || process.env.JIRA_HOST || "").replace(/\/$/, "");
        const JIRA_API_TOKEN_MON = process.env.JIRA_API_TOKEN;
        const authHeaderMon = `Bearer ${JIRA_API_TOKEN_MON}`;

        for (const iss of issuesAll) {
          const issueKey = iss.key;
          let wls = [];
          let startAt = 0;
          let total = 1;
          
          while (wls.length < total) {
            const url = `${JIRA_DOMAIN_MON}/rest/api/2/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=1000`;
            const res = await fetch(url, {
              method: "GET",
              headers: { "Authorization": authHeaderMon }
            });
            
            if (res.ok) {
              const data = await res.json();
              const logs = data.worklogs || [];
              wls = wls.concat(logs);
              total = data.total ?? 0;
              if (logs.length === 0) break;
              startAt += logs.length;
            } else {
              break;
            }
          }

          for (const w of wls) {
            const wlAuthor = w.author?.displayName || w.author?.name || "";
            const matchedTarget = targets.find(t => wlAuthor.toLowerCase().includes(t.toLowerCase()));
            if (matchedTarget) {
              if (w.started && w.started.startsWith(todayStr)) {
                const hours = (w.timeSpentSeconds || 0) / 3600;
                userDailyHoursCache[matchedTarget] = (userDailyHoursCache[matchedTarget] || 0) + hours;
                
                if (!userDetailsCache[matchedTarget]) userDetailsCache[matchedTarget] = [];
                userDetailsCache[matchedTarget].push({
                  issueKey: issueKey,
                  summary: iss.fields?.summary || '',
                  hours: parseFloat(hours.toFixed(1)),
                  comment: w.comment || '',
                  time: w.started
                });
              }
            }
          }
        }
        
        // 모든 대상자에 대해 기본값 0 설정 및 포맷팅
        targets.forEach(t => {
          if (userDailyHoursCache[t] === undefined) userDailyHoursCache[t] = 0;
          userDailyHoursCache[t] = parseFloat(userDailyHoursCache[t].toFixed(1));
          if (!userDetailsCache[t]) userDetailsCache[t] = [];
        });
      }
    }
  } catch (err) {
    console.error("Failed to pre-calculate user stats in cron:", err);
  }

  const getDailyAccumulatedHours = async (authorName) => {
    const targets = rules.USER_WORKLOG.target ? rules.USER_WORKLOG.target.split(',').map(s => s.trim()).filter(s => s) : [];
    const matchedTarget = targets.find(t => authorName.toLowerCase().includes(t.toLowerCase()));
    if (matchedTarget) {
      return userDailyHoursCache[matchedTarget] || 0;
    }
    return 0;
  };

  let notifiedCount = 0;
  const JIRA_HOST = process.env.JIRA_HOST || 'https://jira.yourcompany.com';
  const cleanHost = JIRA_HOST.replace(/\/$/, '');

  for (const issue of issues) {
    const issueKey = issue.key;
    const summary = issue.fields?.summary || '';
    const url = `${cleanHost}/browse/${issueKey}`;
    const prjPrefix = issueKey.split('-')[0].toLowerCase();
    
    // 4. 예상시간 초과 확인
    const originalEstimate = issue.fields?.timetracking?.originalEstimateSeconds || 0;
    const timeSpent = issue.fields?.timetracking?.timeSpentSeconds || 0;

    if (rules.TIME_EXCEEDED.isActive && originalEstimate > 0 && timeSpent > originalEstimate) {
      if (isTargetMatched(rules.TIME_EXCEEDED.target, [issueKey, issue.fields?.assignee?.displayName, issue.fields?.assignee?.name])) {
        const exceedKey = `EXCEED_${issueKey}`;
        if (!notifiedCache.has(exceedKey)) {
          notifiedCache.add(exceedKey);
          broadcastNotification({
            notiType: 'TIME_EXCEEDED',
            title: '예상 시간 초과 경고',
            message: `[${summary}] 누적 작업시간(${(timeSpent/3600).toFixed(1)}h)이 예상시간(${(originalEstimate/3600).toFixed(1)}h)을 초과하였습니다.`,
            issueKey,
            url,
            time: new Date().toLocaleTimeString(),
            author: issue.fields?.assignee?.displayName || 'System'
          });
          notifiedCount++;
        }
      }
    }

    // 워크로그 조회
    const worklogs = issue.fields?.worklog?.worklogs || [];
    for (const wl of worklogs) {
      const wlId = wl.id;
      if (notifiedCache.has(`WL_${wlId}`)) continue;

      // 워크로그 업데이트/생성 시점이 최근 20분(1200000ms) 이내인지 확인
      const wlCreated = new Date(wl.created || 0).getTime();
      const wlUpdated = new Date(wl.updated || 0).getTime();
      const nowMs = Date.now();
      if (nowMs - Math.max(wlCreated, wlUpdated) > 20 * 60 * 1000) {
        // 20분보다 오래된 워크로그는 (단순히 이슈가 수정되어 딸려온 과거 워크로그이므로) 무시
        notifiedCache.add(`WL_${wlId}`);
        continue;
      }

      const author = wl.author?.displayName || wl.author?.name || 'Unknown';
      const authorId = wl.author?.name || 'Unknown';
      let commentStr = '';
      if (wl.comment) {
        if (typeof wl.comment === 'string') commentStr = wl.comment;
        else if (wl.comment.version && wl.comment.type === 'doc') commentStr = extractTextFromADF(wl.comment);
      }
      
      const timeSpentHours = wl.timeSpentSeconds / 3600;
      let anomalyFound = false;

      // 코멘트에서 프로젝트 코드 및 작업 유형 추출 (Worklog Analyzer 파싱 로직 적용)
      let parsedProjectCode = prjPrefix;
      let parsedWorkType = "";
      const cleanComment = commentStr.trim();
      
      const slashMatch = cleanComment.match(/^([^/]+)\s*\/\s*([^/]+)(?:\s*\/[\s\S]*)?$/);
      const bracketMatch = cleanComment.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]/);
      
      if (slashMatch) {
        parsedProjectCode = slashMatch[1].trim().toLowerCase();
        parsedWorkType = slashMatch[2].trim().toLowerCase();
      } else if (bracketMatch) {
        parsedProjectCode = bracketMatch[1].trim().toLowerCase();
        parsedWorkType = bracketMatch[2].trim().toLowerCase();
      } else {
        const singleBracket = cleanComment.match(/^\[([^\]]+)\]/);
        if (singleBracket) {
          parsedProjectCode = singleBracket[1].trim().toLowerCase();
        }
      }

      // 2. 미등록 프로젝트 또는 완료된 프로젝트 확인
      const isUnregistered = !validProjects.includes(parsedProjectCode) && !completedProjects.includes(parsedProjectCode);
      const isCompleted = completedProjects.includes(parsedProjectCode);
      
      if (rules.INVALID_PROJECT.isActive && (isUnregistered || isCompleted)) {
        if (isTargetMatched(rules.INVALID_PROJECT.target, [author, issueKey])) {
          const problemType = isCompleted ? '완료된 프로젝트' : '미등록 프로젝트';
          broadcastNotification({
            notiType: 'INVALID_PROJECT',
            title: problemType + ' 코드 사용',
            message: `${problemType}(${parsedProjectCode.toUpperCase()})에 작업기록이 등록되었습니다.`,
            issueKey,
            url,
            author,
            time: new Date().toLocaleTimeString()
          });
          anomalyFound = true;
        }
      }

      // 3. 미정의 작업유형 (파싱된 작업유형이 표준 목록에 없거나 형식 오류인 경우)
      if (rules.INVALID_TASK_TYPE.isActive && !anomalyFound) {
        // 작업유형이 아예 없거나, 유효한 타입이 아닌 경우
        if (!parsedWorkType || !validTypes.includes(parsedWorkType)) {
          if (isTargetMatched(rules.INVALID_TASK_TYPE.target, [author, issueKey])) {
            broadcastNotification({
              notiType: 'INVALID_TASK_TYPE',
              title: '미정의 작업유형',
              message: `코멘트에 표준 작업유형(예: [개발])이 올바르게 명시되지 않았습니다.`,
              issueKey,
              url,
              author,
              time: new Date().toLocaleTimeString()
            });
            anomalyFound = true;
          }
        }
      }

      // 1. 일반 사용자 작업기록 업데이트 현황
      if (rules.USER_WORKLOG.isActive && !anomalyFound) {
        if (isTargetMatched(rules.USER_WORKLOG.target, [author, issueKey])) {
          const dailyTotalHours = await getDailyAccumulatedHours(authorId);
          broadcastNotification({
            notiType: 'USER_WORKLOG',
            title: `${author}`,
            accumulatedHours: dailyTotalHours.toFixed(1),
            message: `[${issueKey}] ${timeSpentHours}h 작업기록 등록`,
            time: new Date().toLocaleTimeString()
          });
        }
      }

      notifiedCache.add(`WL_${wlId}`);
      notifiedCount++;
    }
  }

  if (notifiedCache.size > 5000) notifiedCache.clear();

  // 매 크론 실행마다(10분 간격) 현재 시점의 전체 모니터링 대상자 누적 시간을 브로드캐스트
  try {
    if (rules.USER_WORKLOG.isActive && rules.USER_WORKLOG.target) {
      broadcastNotification({
        notiType: 'ALL_USER_STATS',
        stats: userDailyHoursCache,
        details: userDetailsCache,
        time: new Date().toLocaleTimeString()
      });
    }
  } catch (err) {
    console.error("Failed to broadcast ALL_USER_STATS:", err);
  }

  return Response.json({ 
    success: true, 
    checkedIssues: issues.length,
    notifiedCount
  });
}
