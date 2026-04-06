import { NextResponse } from "next/server";

/** ms 단위 sleep */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Rate Limit(429) 대응 fetch (route.js와 동일 로직)
 */
async function fetchWithRetry(url, options, maxRetry=5, minDelay=2000, maxDelay=30000) {
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
    await sleep(wait);
  }
  return lastRes;
}

export async function POST(request) {
  try {
    const { issueKey, started, timeSpentSeconds, comment } = await request.json();

    const JIRA_DOMAIN    = process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
    const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

    if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
      throw new Error("환경변수(.env) 미설정 (JIRA_DOMAIN, JIRA_API_TOKEN)");
    }

    if (!issueKey || !started || !timeSpentSeconds) {
      throw new Error("필수 데이터 누락 (issueKey, started, timeSpentSeconds)");
    }

    const cleanDomain = JIRA_DOMAIN.replace(/\/$/, "");
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const headers = {
      "Authorization": `Bearer ${JIRA_API_TOKEN}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    };

    const url = `${cleanDomain}/rest/api/2/issue/${issueKey}/worklog`;
    
    // Jira Server Worklog 추가 페이로드
    // started: "2019-02-22T04:22:20.910+0000" 형식 권장
    const body = {
      started,
      timeSpentSeconds,
      comment,
    };

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.errorMessages ? data.errorMessages.join(", ") : "Jira 등록 실패";
      return NextResponse.json({ error: errMsg, details: data }, { status: res.status });
    }

    return NextResponse.json({ success: true, worklog: data });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
