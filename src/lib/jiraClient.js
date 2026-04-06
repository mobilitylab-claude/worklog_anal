import { NextResponse } from "next/server";

/** ms 단위 sleep */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Rate Limit(429)를 고려한 fetch 래퍼 — 지수 백오프(Exponential Backoff)
 */
async function fetchWithRetry(url, options, maxRetry = 10, minDelay = 3000, maxDelay = 60000) {
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
    console.log(`[Jira Rate Limit] 429 발생 → ${(wait / 1000).toFixed(1)}s 대기 (${attempt}/${maxRetry})`);
    await sleep(wait);
  }
  return lastRes;
}

// Data Access Layer: 서버 측에서 Jira API와 직접 통신하는 책임을 집니다.
export async function fetchJiraSearch(jql, fields = ["summary", "status", "assignee", "reporter", "priority", "created", "updated", "resolution", "duedate", "issuetype", "components"]) {
  const JIRA_DOMAIN = (process.env.JIRA_DOMAIN || process.env.JIRA_HOST || "").replace(/\/$/, "");
  const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

  if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
    throw new Error("환경변수(JIRA_HOST 패턴)가 설정되지 않았습니다.");
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const authHeader = `Bearer ${JIRA_API_TOKEN}`;
  const url = `${JIRA_DOMAIN}/rest/api/2/search`;

  let allIssues = [];
  let startAt = 0;
  const maxResultsPerPage = 1000; // 서버 허용 최대치 시도
  let total = 0;

  try {
    do {
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          jql: jql || "assignee = currentUser()",
          maxResults: maxResultsPerPage,
          fields,
          startAt,
        }),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error("Jira API 응답이 올바른 형식이 아닙니다 (VPN, 방화벽 등 HTML 반환 의심).");
      }

      if (!response.ok) {
        let msg = (data.errorMessages && data.errorMessages.join(", ")) || "알 수 없는 에러";
        throw new Error(`[Jira Server 응답 거부 - ${response.status}] ${msg}`);
      }

      const issues = data.issues || [];
      allIssues = [...allIssues, ...issues];
      total = data.total || 0;
      startAt += issues.length;

      // 더 이상 가져올 이슈가 없거나 루프 안전 장치 (만단위 이상은 가급적 방지)
      if (issues.length === 0 || allIssues.length >= total) break;
      if (allIssues.length >= 20000) {
        console.warn("Too many issues (>20,000), stopping fetch to prevent timeout.");
        break;
      }

    } while (startAt < total);

    return allIssues;
  } catch (error) {
    throw error;
  }
}
