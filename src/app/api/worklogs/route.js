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
 * Rate Limit(429)를 고려한 fetch 래퍼
 * - 429 수신 시 Retry-After(초) 또는 기본 대기 후 최대 maxRetry번 재시도
 */
async function fetchWithRetry(url, options, debugLog, maxRetry = 5, baseDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;   // 정상 응답

    // 429: Retry-After 헤더(초) 읽기, 없으면 지수 백오프
    const retryAfter = res.headers.get("Retry-After");
    const waitMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : baseDelay * attempt;             // 2s, 4s, 6s, 8s, 10s

    if (debugLog) debugLog.push(`[Rate Limit] 429 수신 → ${waitMs}ms 대기 후 재시도 (${attempt}/${maxRetry}): ${url.split("?")[0].split("/").slice(-3).join("/")}`);
    await sleep(waitMs);
  }
  // 모든 재시도 소진 — 마지막 응답 반환
  return fetch(url, options);
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
    let appliedJql      = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor = currentUser()`;
    let validDtAccounts = [];   // Jira username (dt_account)
    let validNames      = [];   // 한국 이름 (displayName 매칭용)
    let isCustomTarget  = false;

    if (overrideJql && overrideJql.trim()) {
      // 수동 JQL: 쿼리 자체는 사용자 입력 사용
      appliedJql = overrideJql.trim();
      // ★ 수동 JQL 이라도 targetUsers가 있으면 작성자 필터에 사용
      if (targetUsers && targetUsers.length > 0) {
        validDtAccounts = [...new Set(targetUsers.map(u => u.dt_account).filter(Boolean))];
        validNames      = [...new Set(targetUsers.map(u => u.name).filter(Boolean))];
        isCustomTarget  = true;
        debugLog.push(`[JQL] 수동 입력 + 작성자 필터 적용 (${validDtAccounts.length}명)`);
      } else {
        debugLog.push(`[JQL] 수동 입력, 작성자 필터 없음`);
      }
    } else if (targetType === "custom" && targetUsers && targetUsers.length > 0) {
      validDtAccounts = [...new Set(targetUsers.map(u => u.dt_account).filter(Boolean))];
      validNames      = [...new Set(targetUsers.map(u => u.name).filter(Boolean))];
      isCustomTarget  = true;
      const inList    = validDtAccounts.map(id => `"${id}"`).join(", ");
      appliedJql      = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor in (${inList})`;
      debugLog.push(`[JQL] 자동 생성 — 대상 username: [${validDtAccounts.join(", ")}]`);
    } else {
      debugLog.push(`[JQL] 자동 생성 — 나의 워크로그`);
    }

    debugLog.push(`[실행 JQL] ${appliedJql}`);
    debugLog.push(`[날짜 범위] ${startDate} ~ ${endDate}`);

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

    // ── 3. 이슈별 워크로그 순차 수집 ─────────────────────────────
    // 순차 처리로 race condition 방지 + 안정적 페이지네이션
    const allWorklogs    = [];
    const seenWorklogIds = new Set();

    // 디버그용: 제외된 작성자 샘플 수집 (최대 30건)
    const excludedAuthors = new Set();

    for (const issue of allIssues) {
      const logs = await fetchAllWorklogsForIssue(cleanDomain, headers, issue.key, debugLog);
      // 이슈 간 최소 딜레이: Rate Limit 예방 (100ms)
      await sleep(100);
      let keptInIssue = 0;

      for (const w of logs) {
        // 전역 중복 제거
        if (seenWorklogIds.has(w.id)) continue;
        seenWorklogIds.add(w.id);

        // ── 날짜 필터 (항상 적용) ──
        const startedDate = w.started.split("T")[0];
        if (startedDate < startDate || startedDate > endDate) continue;

        // ── 작성자 2차 필터 ──
        // [핵심 변경] 자동 JQL 모드(isCustomTarget && !overrideJql)에서는
        // JQL 자체에 worklogAuthor 조건이 있으므로 2차 필터 불필요.
        // 수동 JQL(overrideJql) + targetUsers가 있을 때만 2차 필터 적용.
        const needAuthorFilter = overrideJql && overrideJql.trim() && isCustomTarget;

        if (needAuthorFilter) {
          const wUsername    = (w.author?.name        || "").trim().toLowerCase();
          const wDisplayName = (w.author?.displayName || "").trim();
          const matchUsername = validDtAccounts.some(a => a.trim().toLowerCase() === wUsername);
          const matchName     = validNames.some(n => n.trim() === wDisplayName);
          if (!matchUsername && !matchName) {
            const key = `${wDisplayName}(${w.author?.name})`;
            if (!excludedAuthors.has(key) && excludedAuthors.size < 30) {
              excludedAuthors.add(key);
            }
            continue;
          }
        } else if (!overrideJql && !isCustomTarget) {
          // "me" 자동 모드 — username(dt_account)으로만 비교
          if (JIRA_EMAIL) {
            const wUsername = (w.author?.name || "").trim();
            if (wUsername !== JIRA_EMAIL.trim()) continue;
          }
        }
        // 자동 JQL + custom: JQL의 worklogAuthor 조건을 신뢰 → 2차 필터 없음

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
    debugLog.push(`[최종] 이슈 ${allIssues.length}개 스캔 → 워크로그 ${allWorklogs.length}건 수집`);

    // 수집된 워크로그에서 실제 작성자 목록 (샘플, 디버그용)
    const collectedAuthorSample = [...new Set(allWorklogs.map(w => `${w.author}(${w.authorUsername})`))].slice(0, 30);
    if (excludedAuthors.size > 0) {
      debugLog.push(`[⚠️ 제외된 작성자 (최대30)] ${[...excludedAuthors].join(" | ")}`);
    }
    debugLog.push(`[수집된 작성자 샘플] ${collectedAuthorSample.join(" | ")}`);
    debugLog.push(`[참고] 위 '제외된 작성자'의 username/displayName 값과 DB dt_account/name 비교 필요`);

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
