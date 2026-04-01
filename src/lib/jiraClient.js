// Data Access Layer: 서버 측에서 Jira API와 직접 통신하는 책임을 집니다.
export async function fetchJiraSearch(jql, maxResults = 100) {
  const JIRA_DOMAIN = process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
  const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

  if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
    throw new Error("환경변수(JIRA_HOST 패턴)가 설정되지 않았습니다.");
  }

  // VPN/사내 인증서 무시 (보안상 운영환경에서는 주의 필요)
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const cleanDomain = JIRA_DOMAIN.replace(/\/$/, "");
  
  // Jira Server PAT(Personal Access Token)는 무조건 Bearer 처리
  const authHeader = `Bearer ${JIRA_API_TOKEN}`;
  const url = `${cleanDomain}/rest/api/2/search`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      jql: jql || "assignee = currentUser()",
      maxResults,
      fields: ["summary", "status", "assignee", "reporter", "priority", "created", "updated", "resolution", "duedate", "issuetype", "components"],
      startAt: 0,
    }),
  });

  const textText = await response.text();
  let data;
  try {
    data = JSON.parse(textText);
  } catch (e) {
    console.error("JSON 파싱 에러:", textText.substring(0, 500));
    throw new Error("Jira API 응답이 올바른 형식이 아닙니다 (VPN, 방화벽 등 HTML 반환 의심).");
  }

  if (!response.ok) {
    let parsedMsg = "알 수 없는 에러 발생";
    if (data.errorMessages && data.errorMessages.length > 0) {
      parsedMsg = data.errorMessages.join(", ");
    }
    throw new Error(`[Jira Server 응답 거부 - ${response.status}] ${parsedMsg}`);
  }

  return data.issues || [];
}
