import { NextResponse } from "next/server";

export async function GET() {
  const JIRA_DOMAIN = process.env.JIRA_HOST || process.env.JIRA_DOMAIN;
  const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
  const JIRA_EMAIL = process.env.JIRA_EMAIL;
  
  const debugInfo = {
    step1_envLoaded: true,
    step2_variables: {
      domainLength: JIRA_DOMAIN?.length,
      tokenLength: JIRA_API_TOKEN?.length
    },
    step3_jiraNetwork: "waiting..."
  };

  if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
    debugInfo.step3_jiraNetwork = "Skip: Missing ENV vars";
    return NextResponse.json(debugInfo);
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const cleanDomain = JIRA_DOMAIN.replace(/\/$/, "");
  
  // 회사 토큰(PAT)일 경우 Bearer, 혹시 몰라 Basic도 검사할 수 있지만 일단 Bearer 시도
  const authHeader = `Bearer ${JIRA_API_TOKEN}`;
  const url = `${cleanDomain}/rest/api/2/search`;

  debugInfo.step3_jiraNetwork = `Requesting: ${url} with Bearer Auth`;

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        jql: "assignee = currentUser()",
        maxResults: 2,
        fields: ["summary"]
      }),
      // fetch timeout doesn't exist natively in node, but we'll see if it hangs
    });
    const duration = Date.now() - startTime;

    debugInfo.step4_jiraResponse = {
      status: response.status,
      statusText: response.statusText,
      durationMs: duration
    };

    const textText = await response.text();
    debugInfo.step5_jiraBody = textText.substring(0, 500); // 짤라서 보여주기
    
    try {
      const parsed = JSON.parse(textText);
      debugInfo.step6_parsedJson = {
         totalIssues: parsed.total,
         errorMessages: parsed.errorMessages,
      };
    } catch(e) {
      debugInfo.step6_parsedJson = "Body is not valid JSON. (Maybe HTML login page?)";
    }

  } catch (error) {
    debugInfo.step4_jiraResponse = "Network Error (Hanging or Firewall Blocked?)";
    debugInfo.step5_jiraBody = error.message;
  }

  return NextResponse.json(debugInfo);
}
