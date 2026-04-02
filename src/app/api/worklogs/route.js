import { NextResponse } from "next/server";

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

/** ms 단위 sleep */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Rate Limit(429)를 고려한 fetch 래퍼 — 지수 백오프(Exponential Backoff)
 * - Retry-After:0 버그 수정, 최소 3초 보장, 최대 10회 재시도
 */
async function fetchWithRetry(url, options, debugLog, maxRetry=10, minDelay=3000, maxDelay=60000) {
  let lastRes;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    lastRes = res;
    const raw = res.headers.get("Retry-After");
    const sec = raw ? parseInt(raw, 10) : NaN;
    let wait = (!isNaN(sec) && sec > 0)
      ? Math.min(sec * 1000, maxDelay)
      : Math.min(minDelay * Math.pow(2, attempt - 1), maxDelay);
    wait = Math.max(wait, minDelay);
    if (debugLog) debugLog.push(`[Rate Limit] 429 → ${(wait/1000).toFixed(1)}s 대기 (${attempt}/${maxRetry}): ${url.split("?")[0].split("/").slice(-3).join("/")}`);
    await sleep(wait);
  }
  if (debugLog) debugLog.push(`[Rate Limit 실패] ${maxRetry}회 소진: ${url.split("?")[0].split("/").slice(-3).join("/")}`);
  return lastRes;
}

/**
 * 이슈 하나의 전체 워크로그를 완전 수집 (Jira total 기반 페이지네이션)
 * - Jira Server는 기본 20건 반환, total로 전체 건수를 알 수 있음
 * - maxResults=5000 요청해도 서버마다 실제 반환 건수가 다르므로 반드시 루프 필요
 */
async function fetchAllWorklogsForIssue(cleanDomain, headers, issueKey, debugLog) {
  const allWorklogs = [];
  const seenIds = new Set();
  let startAt = 0;
  let loopCount = 0;
  const MAX_LOOPS = 200;

  while (loopCount < MAX_LOOPS) {
    loopCount++;
    const url = `${cleanDomain}/rest/api/2/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=1000`;
    // fetchWithRetry: 429 발생 시 자동 재시도
    const res = await fetchWithRetry(url, { method: "GET", headers }, debugLog);

    if (!res.ok) {
      debugLog.push(`[워크로그 오류] ${issueKey} startAt=${startAt}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    const total = data.total ?? 0;
    const logs  = data.worklogs || [];

    let added = 0;
    for (const log of logs) {
      if (!seenIds.has(log.id)) {
        seenIds.add(log.id);
        allWorklogs.push(log);
        added++;
      }
    }

    if (logs.length === 0 || allWorklogs.length >= total) break;
    startAt += logs.length;
  }

  if (loopCount >= MAX_LOOPS) {
    debugLog.push(`[경고] ${issueKey}: MAX_LOOPS 도달`);
  }

  return allWorklogs;
}

export async function POST(request) {
  const debugLog = [];

  try {
    const {
      startDate, endDate,
      includeKeyword, excludeKeyword,
      targetType, targetUsers,
      overrideJql,
    } = await request.json();

    const JIRA_DOMAIN    = process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
    const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
    const JIRA_EMAIL     = process.env.JIRA_EMAIL || "";

    if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
      throw new Error("환경변수(.env) 미설정 (JIRA_DOMAIN, JIRA_API_TOKEN)");
    }

    const cleanDomain = JIRA_DOMAIN.replace(/\/$/, "");
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const headers = {
      "Authorization": `Bearer ${JIRA_API_TOKEN}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    };

    // ── 1. JQL 결정 + 필터 대상 계정 추출 ────────────────────────
    // ★ worklogDate <= endDate 는 00:00 경계 문제로 당일 누락 가능
    //   → worklogDate < (endDate+1) 방식으로 당일 포함 보장
    const endDateObj  = new Date(endDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endDateNext = endDateObj.toISOString().split("T")[0];

    let appliedJql      = `worklogDate >= "${startDate}" AND worklogDate < "${endDateNext}" AND worklogAuthor = currentUser()`;
    let validDtAccounts = [];
    let validNames      = [];
    let isCustomTarget  = false;

    // /myself API로 currentUser 정확 조회 (JIRA_EMAIL != Jira username 문제 해결)
    let myselfName = "", myselfAccountId = "";
    try {
      const mr = await fetch(`${cleanDomain}/rest/api/2/myself`, { method: "GET", headers });
      if (mr.ok) {
        const m = await mr.json();
        myselfName      = (m.name      || "").trim();
        myselfAccountId = (m.accountId || "").trim();
        debugLog.push(`[currentUser] name="${myselfName}" accountId="${myselfAccountId}" display="${m.displayName}"`);
      } else debugLog.push(`[currentUser] /myself HTTP ${mr.status}`);
    } catch(e) { debugLog.push(`[currentUser] err: ${e.message}`); }

    if (overrideJql && overrideJql.trim()) {
      appliedJql = overrideJql.trim();
      if (targetUsers && targetUsers.length > 0) {
        validDtAccounts = [...new Set(targetUsers.map(u => u.dt_account).filter(Boolean))];
        validNames      = [...new Set(targetUsers.map(u => u.name).filter(Boolean))];
        isCustomTarget  = true;
        debugLog.push(`[JQL] 수동 입력 + 작성자 필터 적용 (${validDtAccounts.length}명)`);
      } else {
        debugLog.push(`[JQL] 수동 입력, 작성자 필터 없음 → 전체 포함`);
      }
    } else if (targetType === "custom" && targetUsers && targetUsers.length > 0) {
      validDtAccounts = [...new Set(targetUsers.map(u => u.dt_account).filter(Boolean))];
      validNames      = [...new Set(targetUsers.map(u => u.name).filter(Boolean))];
      isCustomTarget  = true;
      const inList    = validDtAccounts.map(id => `"${id}"`).join(", ");
      appliedJql      = `worklogDate >= "${startDate}" AND worklogDate < "${endDateNext}" AND worklogAuthor in (${inList})`;
      debugLog.push(`[JQL] 자동 생성 — 대상 username: [${validDtAccounts.join(", ")}]`);
    } else {
      debugLog.push(`[JQL] 자동 생성 — 나의 워크로그`);
    }

    debugLog.push(`[실행 JQL] ${appliedJql}`);
    debugLog.push(`[날짜 범위] ${startDate} ~ ${endDate}  (JQL: >= ${startDate} AND < ${endDateNext})`);

    // ── 2. 이슈 전체 페이지네이션 수집 ───────────────────────────
    const allIssues   = [];
    let issueStartAt  = 0;
    let issueFetchLoop = 0;

    while (issueFetchLoop < 200) {
      issueFetchLoop++;
      const searchRes = await fetchWithRetry(
        `${cleanDomain}/rest/api/2/search`,
        {
          method:  "POST",
          headers,
          body: JSON.stringify({
            jql:        appliedJql,
            startAt:    issueStartAt,
            maxResults: 1000,
            fields:     ["summary", "issuetype", "status"],
          }),
        },
        debugLog
      );

      if (!searchRes.ok) {
        const errBody = await searchRes.text();
        throw new Error(`이슈 검색 실패 (${searchRes.status}): ${errBody.slice(0, 300)}`);
      }

      const sd      = await searchRes.json();
      const issues  = sd.issues || [];
      const total   = sd.total  ?? 0;
      allIssues.push(...issues);

      debugLog.push(`[이슈 수집] startAt=${issueStartAt}, 이번=${issues.length}건, 누계=${allIssues.length}/${total}`);

      if (issues.length === 0 || allIssues.length >= total) break;
      issueStartAt += issues.length;
    }

    debugLog.push(`[이슈 총계] ${allIssues.length}개 이슈`);

    // ── 3. 이슈별 워크로그 순차 수집 + 2차 필터 ─────────────────
    const allWorklogs    = [];
    const seenWorklogIds = new Set();
    const excludedAuthors = new Set();
    let statTotal=0, statDropDup=0, statDropDate=0, statDropAuthor=0;

    // 수동 JQL 단독(targetUsers 없음): 2차 날짜 필터 미적용 → JQL 날짜 조건 신뢰
    // 자동 JQL / 수동 JQL+targetUsers: UI startDate~endDate로 2차 필터 적용
    const applyDateFilter = !(overrideJql && overrideJql.trim() && !isCustomTarget);
    debugLog.push(`[2차 날짜 필터] ${applyDateFilter ? `적용 (${startDate}~${endDate})` : "미적용 — 수동 JQL 신뢰"}`);

    for (const issue of allIssues) {
      const logs = await fetchAllWorklogsForIssue(cleanDomain, headers, issue.key, debugLog);
      await sleep(100);
      let keptInIssue = 0;

      for (const w of logs) {
        statTotal++;
        if (seenWorklogIds.has(w.id)) { statDropDup++; continue; }
        seenWorklogIds.add(w.id);

        // ── 날짜 2차 필터 ──
        if (applyDateFilter) {
          const sd = (w.started || "").split("T")[0];
          if (!sd || sd < startDate || sd > endDate) { statDropDate++; continue; }
        }

        // ── 작성자 2차 필터 ──
        if (isCustomTarget) {
          // 자동 JQL(isCustomTarget && !overrideJql): JQL이 이미 worklogAuthor 제한함
          // → 이슈 내 다른 사람 워크로그 제거를 위해 2차 필터 적용
          const wu = (w.author?.name        || "").trim().toLowerCase();
          const wa = (w.author?.accountId   || "").trim().toLowerCase();
          const wd = (w.author?.displayName || "").trim();
          const mAcc = wu.length > 0 && validDtAccounts.some(a =>
            a.trim().toLowerCase() === wu ||
            (wa.length > 0 && a.trim().toLowerCase() === wa)
          );
          const mDn = wd.length > 0 && validNames.some(n => {
            const d = n.trim(); if (!d) return false;
            return d === wd || wd.startsWith(d) || d.startsWith(wd);
          });
          if (!mAcc && !mDn) {
            statDropAuthor++;
            const key = `${wd}(${w.author?.name || "?"})`;
            if (!excludedAuthors.has(key) && excludedAuthors.size < 30) excludedAuthors.add(key);
            continue;
          }
        } else if (!overrideJql && !isCustomTarget) {
          // "me" 자동 모드 — /myself로 얻은 name/accountId로 비교
          if (myselfName || myselfAccountId) {
            const wu = (w.author?.name      || "").trim();
            const wa = (w.author?.accountId || "").trim();
            if (!(myselfName && wu === myselfName) && !(myselfAccountId && wa === myselfAccountId)) {
              statDropAuthor++; continue;
            }
          }
        }
        // overrideJql 단독(targetUsers 없음): 필터 없이 전체 포함

        // ── 코멘트 추출 ──
        let commentText = "";
        if (typeof w.comment === "string") {
          commentText = w.comment;
        } else if (w.comment && typeof w.comment === "object") {
          commentText = extractTextFromADF(w.comment);
          if (!commentText) commentText = JSON.stringify(w.comment);
        }

        // ── 키워드 필터 ──
        const includes = (includeKeyword || "").split(",").map(s => s.trim()).filter(Boolean);
        const excludes = (excludeKeyword || "").split(",").map(s => s.trim()).filter(Boolean);
        const txt = commentText || "";
        if (includes.length > 0 && !includes.some(kw => txt.includes(kw))) continue;
        if (excludes.length > 0 &&  excludes.some(kw => txt.includes(kw))) continue;

        // ── 시간 변환 (timeSpentSeconds 기준, Jira 기본: 1d=8h, 1w=40h) ──
        const secs      = w.timeSpentSeconds || 0;
        const hrs       = secs / 3600;
        const timeSpentH = Number.isInteger(hrs) ? `${hrs}h` : `${parseFloat(hrs.toFixed(2))}h`;

        allWorklogs.push({
          id:              w.id,
          issueKey:        issue.key,
          issueSummary:    issue.fields.summary,
          issueType:       issue.fields.issuetype?.name || "-",
          issueStatus:     issue.fields.status?.name    || "-",
          author:          w.author?.displayName || w.author?.name || "",
          authorUsername:  w.author?.name        || "",
          started:         w.started,
          timeSpent:       timeSpentH,
          timeSpentRaw:    w.timeSpent,
          timeSpentSeconds: secs,
          comment:         commentText || "(작업 내용 미기재)",
        });
        keptInIssue++;
      }

      if (keptInIssue > 0) {
        debugLog.push(`[${issue.key}] 전체=${logs.length}건 → 조건 충족=${keptInIssue}건`);
      }
    }

    allWorklogs.sort((a, b) => new Date(b.started) - new Date(a.started));

    // 디버그 통계 요약
    debugLog.push(`[필터 통계] 전체=${statTotal} | 중복=${statDropDup} | 날짜제외=${statDropDate} | 작성자제외=${statDropAuthor} | 최종=${allWorklogs.length}`);
    const authorSample = [...new Set(allWorklogs.map(w => `${w.author}(${w.authorUsername})`))].slice(0, 30);
    if (excludedAuthors.size > 0) debugLog.push(`[⚠️ 제외된 작성자] ${[...excludedAuthors].join(" | ")}`);
    debugLog.push(`[수집된 작성자] ${authorSample.join(" | ")}`);

    return NextResponse.json({
      worklogs:    allWorklogs,
      jiraHost:    cleanDomain,
      usedJql:     appliedJql,
      debugLog,
      totalIssues: allIssues.length,
      excludedAuthors: [...excludedAuthors],
    });

  } catch (error) {
    debugLog.push(`[오류] ${error.message}`);
    return NextResponse.json({ error: error.message, debugLog }, { status: 500 });
  }
}
