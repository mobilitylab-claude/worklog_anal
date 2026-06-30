import { NextResponse } from "next/server";
import { getWorklogs } from "@/lib/worklogService";

export async function POST(request) {
  const debugLog = [];

  try {
    const body = await request.json();
    const xJiraToken = request.headers.get("x-jira-token");
    const JIRA_DOMAIN = process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
    const JIRA_API_TOKEN = xJiraToken || process.env.JIRA_API_TOKEN;

    const cleanDomain = JIRA_DOMAIN ? JIRA_DOMAIN.replace(/\/$/, "") : "";

    // worklogService 모듈 함수를 호출하여 수집 및 필터링 일원화
    const worklogs = await getWorklogs({
      ...body,
      domain: cleanDomain,
      apiToken: JIRA_API_TOKEN,
      debugLog
    });

    // debugLog에 기록된 JQL을 추출하여 응답 정보 구성
    const jqlLogLine = debugLog.find(line => line.startsWith("[Service] JQL:"));
    const usedJql = jqlLogLine ? jqlLogLine.replace("[Service] JQL:", "").trim() : "";

    // 제외된 작성자 추출 (디버그 통계 파싱)
    const excludedLine = debugLog.find(line => line.startsWith("[⚠️ 제외된 작성자]"));
    const excludedAuthors = excludedLine 
      ? excludedLine.replace("[⚠️ 제외된 작성자]", "").split("|").map(s => s.trim()).filter(Boolean)
      : [];

    const totalIssuesLine = debugLog.find(line => line.startsWith("[Service] 이슈 수집 완료:"));
    const totalIssues = totalIssuesLine 
      ? parseInt(totalIssuesLine.match(/\d+/)?.[0] || "0", 10) 
      : 0;

    return NextResponse.json({
      worklogs,
      jiraHost: cleanDomain,
      usedJql,
      debugLog,
      totalIssues,
      excludedAuthors
    });

  } catch (error) {
    debugLog.push(`[라우터 오류] ${error.message}`);
    return NextResponse.json({ error: error.message, debugLog }, { status: 500 });
  }
}
