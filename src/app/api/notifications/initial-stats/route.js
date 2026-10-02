import { fetchJiraSearch } from '@/lib/jiraClient';
import db from '@/lib/db';
import { getActiveJiraToken } from '@/lib/jiraAuthServer';
import { broadcastNotification } from '@/lib/sseClients';
import { getMonitoringRules, getValidationStandards, validateSingleWorklog } from '@/lib/worklogValidator';
import { normalizeAuthorName } from '@/lib/nameUtils';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUser = searchParams.get('targetUser') || searchParams.get('user');

    const xJiraToken = request?.headers?.get('x-jira-token');
    const JIRA_API_TOKEN = getActiveJiraToken(xJiraToken);

    let targets = [];

    // 기존 notification_logs 테이블의 author에 붙어있던 접미사 자동 정제 (동일인 일치율 보장)
    try {
      const rawRows = db.prepare("SELECT DISTINCT author FROM notification_logs WHERE author LIKE '%기타모비스온사용자%' OR author LIKE '%협력사%'").all();
      for (const r of rawRows) {
        const clean = normalizeAuthorName(r.author);
        if (clean && clean !== r.author) {
          db.prepare("UPDATE notification_logs SET author = ? WHERE author = ?").run(clean, r.author);
        }
      }
    } catch (cleanErr) {}

    // 개별 팀원 단독 갱신 요청인 경우
    if (targetUser && targetUser.trim()) {
      targets = [normalizeAuthorName(targetUser.trim())];
    } else {
      // 전체 팀원 갱신/초기 로딩인 경우
      const row = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get('noti_target_USER_WORKLOG');
      const targetStr = row ? row.value : '';

      // 대상자가 명시적으로 없으면 빈 객체 반환 (전체 사용자를 미리 로드하기엔 부담됨)
      if (!targetStr) {
        return Response.json({ success: true, stats: {} });
      }

      const rawTargets = targetStr.split(',').map(s => s.trim()).filter(s => s);
      const seenNames = new Set();

      for (const raw of rawTargets) {
        // "탄보련 기타모비스온사용자" -> "탄보련", "아라 R&D 협력사" -> "아라" 로 정규화
        const name = normalizeAuthorName(raw);
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          targets.push(name);
        }
      }

      if (targets.length === 0) {
        return Response.json({ success: true, stats: {} });
      }
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
      const normName = normalizeAuthorName(name);
      const userRow = db.prepare('SELECT dt_account FROM users WHERE name = ?').get(normName);
      if (userRow && userRow.dt_account) {
        dtAccounts.push(userRow.dt_account);
        dtToName[userRow.dt_account] = normName;
      } else {
        // DB에 없으면 이름 그대로 사용 (폴백)
        dtAccounts.push(normName);
        dtToName[normName] = normName;
      }
    }

    const loadingLogs = [];
    const step1 = `[1/4] 모니터링 대상자 확인: ${targets.join(', ')}`;
    loadingLogs.push(step1);
    console.log(`[Initial Stats] ${step1}`);

    // 한국 시간 기준으로 오늘 날짜 추출 (YYYY-MM-DD)
    const today = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
    const todayStr = today.toISOString().split('T')[0];

    // 요청된 dates 파라미터 및 DB의 미해결(open) 알림들의 날짜를 수집하여 쿼리 대상 날짜 집합 생성
    const queryDatesSet = new Set([todayStr]);
    const datesParam = searchParams.get('dates');
    if (datesParam) {
      datesParam.split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) queryDatesSet.add(d);
      });
    }

    try {
      let openRows = [];
      if (targets.length === 1) {
        openRows = db.prepare("SELECT DISTINCT worklog_date FROM notification_logs WHERE status = 'open' AND author = ?").all(targets[0]);
      } else {
        openRows = db.prepare("SELECT DISTINCT worklog_date FROM notification_logs WHERE status = 'open'").all();
      }
      openRows.forEach(r => {
        if (r.worklog_date && /^\d{4}-\d{2}-\d{2}$/.test(r.worklog_date)) {
          queryDatesSet.add(r.worklog_date);
        }
      });
    } catch (dbErr) {
      console.warn("[Initial Stats] notification_logs open worklog_date query skipped:", dbErr.message);
    }

    const queryDates = Array.from(queryDatesSet).sort();
    const minDate = queryDates[0] || todayStr;

    // JQL을 이용해 대상자들의 조회 대상 날짜(minDate 이후) 워크로그 정밀 검색
    // JIRA_PROJECT 환경변수가 명시된 경우에만 해당 프로젝트 필터를 적용하고, 없으면 대상자의 모든 워크로그를 조회하여 타 프로젝트 오입력도 검출
    const projectClause = process.env.JIRA_PROJECT ? `${process.env.JIRA_PROJECT} AND ` : "";
    const authorCond = dtAccounts.length > 0 ? `worklogAuthor in (${dtAccounts.map(a => `${a}`).join(', ')}) AND ` : "";
    const jql = `${projectClause}${authorCond}worklogDate >= ${minDate}`;
    const step2 = `[2/4] JQL 실행 (검색 시작일: ${minDate}, 대상 날짜: ${queryDates.join(', ')}): ${jql}`;
    loadingLogs.push(step2);
    console.log(`[Initial Stats] ${step2}`);

    const issues = await fetchJiraSearch(jql, ['summary', 'worklog'], { apiToken: JIRA_API_TOKEN });
    const step3 = `[3/4] 이슈 검색 완료: ${issues.length}개의 이슈 발견`;
    loadingLogs.push(step3);
    console.log(`[Initial Stats] ${step3}`);
    if (issues.length > 0) {
      console.log(`[Initial Stats Debug] Sample issue: key=${issues[0].key}, hasWorklog=${!!issues[0].fields?.worklog}, embLogsLen=${issues[0].fields?.worklog?.worklogs?.length}`);
    }

    const JIRA_DOMAIN = (process.env.JIRA_DOMAIN || process.env.JIRA_HOST || "").replace(/\/$/, "");
    const authHeader = `Bearer ${JIRA_API_TOKEN}`;

    const results = [];
    const chunkSize = 15;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < issues.length; i += chunkSize) {
      const chunk = issues.slice(i, i + chunkSize);
      console.log(`[Initial Stats] Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(issues.length / chunkSize)}...`);

      const chunkResults = await Promise.all(chunk.map(async (iss) => {
        const issueKey = iss.key;
        const embWl = iss.fields?.worklog;
        if (embWl && Array.isArray(embWl.worklogs) && embWl.worklogs.length > 0 && (typeof embWl.total === 'undefined' || embWl.total <= embWl.worklogs.length)) {
          console.log(`[Initial Stats Debug] Using embedded worklogs for ${issueKey} (count=${embWl.worklogs.length})`);
          return { issueKey, wls: embWl.worklogs, summary: iss.fields?.summary || '' };
        }

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

    const rules = getMonitoringRules();
    const { validProjects, completedProjects, validTypes } = getValidationStandards();
    const alerts = [];
    const seenAlertIds = new Set();
    const JIRA_HOST = process.env.JIRA_HOST || JIRA_DOMAIN;

    for (const result of results) {
      const { issueKey, wls, summary } = result;
      totalWorklogsFetched += wls.length;

      for (const w of wls) {
        const wlAuthorId = w.author?.name || "";
        const wlAuthorName = w.author?.displayName || w.author?.name || "";
        // DT 계정으로 먼저 매핑 시도, 없으면 표시이름(접미사 제거 후)으로 시도
        const cleanWlAuthor = normalizeAuthorName(wlAuthorName);
        const matchedTarget = dtToName[wlAuthorId] || targets.find(t => {
          const normT = normalizeAuthorName(t);
          return cleanWlAuthor === normT || cleanWlAuthor.includes(normT) || normT.includes(cleanWlAuthor);
        });

        if (matchedTarget) {
          totalWorklogsMatchedUser++;

          // 한국 시간 기준으로 날짜 비교
          if (w.started) {
            const wlDate = new Date(w.started);
            const wlKstDateStr = new Date(wlDate.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

            // 조회 대상 날짜에 포함되는 경우 처리
            if (queryDatesSet.has(wlKstDateStr)) {
              const hours = (w.timeSpentSeconds || 0) / 3600;

              // 당일(todayStr) 작업시간만 당일 통계에 합산
              if (wlKstDateStr === todayStr) {
                totalWorklogsMatchedDate++;
                stats[matchedTarget] += hours;
                details[matchedTarget].push({
                  worklogId: w.id || '',
                  issueKey: issueKey,
                  summary: summary,
                  hours: parseFloat(hours.toFixed(1)),
                  comment: typeof w.comment === 'string' ? w.comment : (w.comment?.version ? '' : (w.comment || '')),
                  time: w.started,
                  created: w.created || '',
                  updated: w.updated || '',
                  isEdited: !!(w.updated && w.created && w.updated !== w.created)
                });
              }

              // ── 실시간 포맷/프로젝트코드/작업유형 검증 수행 (과거 미해결 날짜 포함) ──
              const anomalyAlerts = validateSingleWorklog({
                wl: w,
                issueKey,
                summary,
                author: matchedTarget,
                authorId: wlAuthorId,
                validProjects,
                completedProjects,
                validTypes,
                rules,
                jiraHost: JIRA_HOST
              });

              if (Array.isArray(anomalyAlerts) && anomalyAlerts.length > 0) {
                anomalyAlerts.forEach(anomalyAlert => {
                  anomalyAlert.worklogDate = wlKstDateStr;
                  anomalyAlert.targetDate = wlKstDateStr;
                  if (!seenAlertIds.has(anomalyAlert.id)) {
                    seenAlertIds.add(anomalyAlert.id);
                    alerts.push(anomalyAlert);
                    console.log(`[Initial Stats] Anomaly detected: [${anomalyAlert.notiType}] ${anomalyAlert.title} - ${anomalyAlert.message} (Issue: ${issueKey}, Author: ${matchedTarget}, Date: ${wlKstDateStr})`);
                    // 실시간 접속된 클라이언트들에게 SSE 전송
                    try {
                      broadcastNotification(anomalyAlert);
                    } catch (bErr) {
                      console.error("broadcastNotification error in initial-stats:", bErr);
                    }
                  }
                });
              }
            }
          }
        }
      }
    }

    // ── 알림 DB (notification_logs) 동기화 및 해결 여부 정밀 판정 ──
    const resolvedAlerts = [];
    try {
      const upsertStmt = db.prepare(`
        INSERT INTO notification_logs (
          alert_key, noti_type, author, author_id, issue_key, summary, worklog_id, worklog_date, title, message, comment, status, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP
        )
        ON CONFLICT(alert_key) DO UPDATE SET
          summary = excluded.summary,
          title = excluded.title,
          message = excluded.message,
          comment = excluded.comment,
          status = 'open',
          updated_at = CURRENT_TIMESTAMP
      `);

      // 1. 이번에 검출된 이상 알림 DB 저장
      const insertMany = db.transaction((alertsToSave) => {
        for (const a of alertsToSave) {
          upsertStmt.run(
            a.id,
            a.notiType || 'UNKNOWN',
            normalizeAuthorName(a.author),
            a.authorId || '',
            a.issueKey,
            a.summary || '',
            String(a.worklogId || ''),
            a.worklogDate || todayStr,
            a.title,
            a.message,
            a.comment || ''
          );
        }
      });
      insertMany(alerts);

      // 2. 이번에 검사한 대상자에 대해, 기존 'open' 알림들을 검사하여 오류가 해결된 건 해결(resolved) 처리!
      const normTargets = targets.map(t => normalizeAuthorName(t)).filter(Boolean);
      const placeholdersTargets = normTargets.map(() => '?').join(',');
      const openDbRows = normTargets.length > 0 ? db.prepare(`
        SELECT * FROM notification_logs 
        WHERE status = 'open' 
          AND author IN (${placeholdersTargets})
      `).all(...normTargets) : [];

      const resolveStmt = db.prepare(`
        UPDATE notification_logs 
        SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);

      for (const row of openDbRows) {
        // 이번에 Jira 조회를 수행한 대상 날짜에 포함되거나, minDate 이상인 경우 해결 여부 판정
        const isDateChecked = queryDatesSet.has(row.worklog_date) || (row.worklog_date && row.worklog_date >= minDate);
        if (isDateChecked && !seenAlertIds.has(row.alert_key)) {
          resolveStmt.run(row.id);
          resolvedAlerts.push({
            id: `resolved-noti-${row.alert_key}-${Date.now()}`,
            originalAlertKey: row.alert_key,
            worklogId: row.worklog_id,
            worklogDate: row.worklog_date,
            author: row.author,
            issueKey: row.issue_key,
            notiType: 'WORKLOG_RESOLVED',
            title: `✨ [수정 완료] ${row.author} 작업기록 정상 반영`,
            message: `[${row.issue_key}] (${row.worklog_date}) ${row.title} 항목이 올바르게 수정되어 오류가 해결되었습니다.`,
            resolved: true,
            resolvedAt: new Date().toLocaleTimeString()
          });
        }
      }
    } catch (dbSyncErr) {
      console.error("[Initial Stats] notification_logs DB sync error:", dbSyncErr);
    }

    console.log(`[Initial Stats] Total Issues: ${issues.length}`);
    console.log(`[Initial Stats] Total Worklogs Fetched: ${totalWorklogsFetched}`);
    console.log(`[Initial Stats] Worklogs Matched User: ${totalWorklogsMatchedUser}`);
    console.log(`[Initial Stats] Worklogs Matched Date (Today): ${totalWorklogsMatchedDate}`);
    console.log(`[Initial Stats] Anomalies/Alerts Found: ${alerts.length}, Resolved: ${resolvedAlerts.length}`);

    const step3_5 = `[3.5/4] 분석 결과: 작업기록 총 ${totalWorklogsFetched}개 중 대상자 매칭 ${totalWorklogsMatchedUser}개, 당일 매칭 ${totalWorklogsMatchedDate}개 (이상: ${alerts.length}건, 해결됨: ${resolvedAlerts.length}건)`;
    loadingLogs.push(step3_5);

    if (alerts.length > 0) {
      loadingLogs.push(`⚠️ [이상 기록 감지] 작업기록 중 포맷 오류 및 미등록 코드/유형 ${alerts.length}건이 발견되었습니다.`);
    }
    if (resolvedAlerts.length > 0) {
      loadingLogs.push(`✨ [오류 해결 확인] 정상 수정된 작업기록 ${resolvedAlerts.length}건이 확인되어 해결 처리되었습니다.`);
    }

    // 포맷팅 (소수점 1자리)
    const formattedStats = {};
    for (const [name, val] of Object.entries(stats)) {
      formattedStats[name] = parseFloat(val.toFixed(1));
    }

    const step4 = `[4/4] 작업기록 분석 완료 (대상자: ${Object.keys(formattedStats).length}명, 이상 항목: ${alerts.length}건, 해결: ${resolvedAlerts.length}건)`;
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

    console.log(`[Initial Stats] Returning stats for ${Object.keys(formattedStats).length} users. Alerts: ${alerts.length}, Resolved: ${resolvedAlerts.length}, Checked Dates: ${queryDates.join(',')}`);
    return Response.json({ 
      success: true, 
      stats: formattedStats, 
      details, 
      alerts, 
      resolvedAlerts,
      checkedDates: queryDates, 
      loadingLogs 
    }, { headers });
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
