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

export async function POST(request) {
  try {
    const { startDate, endDate, includeKeyword, excludeKeyword, targetType, targetUsers } = await request.json();
    
    const JIRA_DOMAIN = process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
    const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
    const JIRA_EMAIL = process.env.JIRA_EMAIL || "";
    
    if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
      throw new Error("환경변수(.env) 토큰 미설정");
    }

    const cleanDomain = JIRA_DOMAIN.replace(/\/$/, "");
    const authHeader = `Bearer ${JIRA_API_TOKEN}`;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const fetchConfig = {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "Accept": "application/json",
      }
    };

    // 1. 타겟 유저 조합 기반 JQL 쿼리 동적 생성 (그룹 또는 개별 선택 시)
    let appliedJql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor = currentUser()`;
    let validDtAccounts = [];

    if (targetType === "custom" && targetUsers && targetUsers.length > 0) {
      validDtAccounts = targetUsers.map(u => u.dt_account).filter(Boolean);
      
      const authorListStr = [...new Set(validDtAccounts)].map(id => `"${id}"`).join(", ");
      appliedJql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor in (${authorListStr})`;
    }

    const searchRes = await fetch(`${cleanDomain}/rest/api/2/search`, {
      ...fetchConfig,
      body: JSON.stringify({
        jql: appliedJql,
        maxResults: 100, // 최대 100건의 관련 '이슈' 로드
        fields: ["summary", "issuetype", "status"]
      })
    });
    
    if (!searchRes.ok) throw new Error("Jira 이슈 검색에 실패했습니다.");
    const searchData = await searchRes.json();
    const issues = searchData.issues || [];

    // 2. 검색된 이슈들을 순회하며 상세 워크로그 API 호출 및 철저한 필터링 실시
    const worklogPromises = issues.map(async (issue) => {
      const wRes = await fetch(`${cleanDomain}/rest/api/2/issue/${issue.key}/worklog`, {
        method: "GET",
        headers: fetchConfig.headers
      });
      
      if (!wRes.ok) return [];
      const wData = await wRes.json();
      const worklogs = wData.worklogs || [];
      
      return worklogs.filter(w => {
         const startedDate = w.started.split('T')[0];
         const dateMatch = startedDate >= startDate && startedDate <= endDate;
         
         // JQL이 전체를 잡아왔더라도, 이 워크로그 작성자가 대상 직원인지 정확히 2차 검증
         let authorMatch = false;
         if (targetType === "custom") {
            const authorName = w.author?.name || ""; // 보통 dt_account 등 username
            authorMatch = validDtAccounts.includes(authorName);
         } else {
            // "me" 기반 내 워크로그만 필터링
            authorMatch = JIRA_EMAIL ? ((w.author?.emailAddress || "") === JIRA_EMAIL || (w.author?.name || "") === JIRA_EMAIL) : true;
         }

         return dateMatch && authorMatch;
      }).map(w => {
         let commentText = "";
         if (typeof w.comment === "string") {
            commentText = w.comment;
         } else if (w.comment && typeof w.comment === "object") {
            commentText = extractTextFromADF(w.comment);
            if(!commentText) commentText = JSON.stringify(w.comment);
         }

         return {
           id: w.id,
           issueKey: issue.key,
           issueSummary: issue.fields.summary,
           issueType: issue.fields.issuetype?.name || "-",
           issueStatus: issue.fields.status?.name || "-",
           author: w.author?.displayName || JIRA_EMAIL,
           started: w.started,
           timeSpent: w.timeSpent,
           timeSpentSeconds: w.timeSpentSeconds,
           comment: commentText || "(작업 내용 미기재)", 
         };
      }).filter(w => {
         // 키워드 내용(Comment) 필터링
         const includes = (includeKeyword || "").split(',').map(s => s.trim()).filter(Boolean);
         const excludes = (excludeKeyword || "").split(',').map(s => s.trim()).filter(Boolean);

         let keywordMatch = true;
         const textTarget = w.comment || "";
         
         // 하나라도 포함된 키워드가 있으면 통과 (OR)
         if (includes.length > 0) {
            keywordMatch = includes.some(kw => textTarget.includes(kw)); 
         }
         // 제외할 키워드가 포함되어 있다면 가차없이 드랍
         if (keywordMatch && excludes.length > 0) {
            const hasExclude = excludes.some(kw => textTarget.includes(kw));
            if (hasExclude) keywordMatch = false; 
         }

         return keywordMatch;
      });
    });

    const nestedWorklogs = await Promise.all(worklogPromises);
    const flattenedWorklogs = nestedWorklogs.flat().sort((a,b) => new Date(b.started) - new Date(a.started));

    return NextResponse.json({ worklogs: flattenedWorklogs, jiraHost: cleanDomain, usedJql: appliedJql });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
