import { fetchJiraSearch } from "./jiraClient.js";

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options, debugLog, maxRetry = 10, minDelay = 3000, maxDelay = 60000) {
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
    if (debugLog) debugLog.push(`[Rate Limit] 429 → ${(wait / 1000).toFixed(1)}s 대기 (${attempt}/${maxRetry}): ${url.split("?")[0].split("/").slice(-3).join("/")}`);
    await sleep(wait);
  }
  return lastRes;
}

async function fetchAllWorklogsForIssue(cleanDomain, headers, issueKey, debugLog) {
  const allWorklogs = [];
  const seenIds = new Set();
  let startAt = 0;
  let loopCount = 0;
  const MAX_LOOPS = 200;

  while (loopCount < MAX_LOOPS) {
    loopCount++;
    const url = `${cleanDomain}/rest/api/2/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=1000`;
    const res = await fetchWithRetry(url, { method: "GET", headers }, debugLog);
    if (!res.ok) break;
    const data = await res.json();
    const total = data.total ?? 0;
    const logs = data.worklogs || [];
    for (const log of logs) {
      if (!seenIds.has(log.id)) {
        seenIds.add(log.id);
        allWorklogs.push(log);
      }
    }
    if (logs.length === 0 || allWorklogs.length >= total) break;
    startAt += logs.length;
    // JIRA 서버 보호를 위한 슬립 격리 배치 (개별 API 순회 조회 시에만 작동)
    await sleep(300);
  }
  return allWorklogs;
}

export async function getWorklogs({
  startDate, endDate,
  includeKeyword, excludeKeyword,
  targetType, targetUsers = [],
  overrideJql, project,
  domain, apiToken,
  debugLog = []
}) {
  const JIRA_DOMAIN = domain || process.env.JIRA_DOMAIN || process.env.JIRA_HOST;
  const JIRA_API_TOKEN = apiToken || process.env.JIRA_API_TOKEN;

  if (!JIRA_DOMAIN || !JIRA_API_TOKEN) {
    throw new Error("Jira 설정이 누락되었습니다 (Domain/Token)");
  }

  const cleanDomain = JIRA_DOMAIN.replace(/\/$/, "");
  // jiraClient.js와 동일하게 Bearer 우선 사용 (JIRA_API_TOKEN이 PAT인 경우)
  const authHeader = `Bearer ${JIRA_API_TOKEN}`;
  const headers = {
    "Authorization": authHeader,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };

  // ── 1. JQL 결정 및 사용자 정보 조회 ────────────────────────
  const endDateObj = new Date(endDate);
  endDateObj.setDate(endDateObj.getDate() + 1);
  const endDateNext = endDateObj.toISOString().split("T")[0];

  let projectClause = "project in (AVNSTDG6, AVNG6HKMC, AVNG6YOC)";
  if (project && project.trim()) {
    const p = project.trim();
    projectClause = (p.includes(' ') || p.includes(',')) ? `project in (${p})` : `project = "${p}"`;
  } else if (process.env.JIRA_PROJECT) {
    projectClause = process.env.JIRA_PROJECT;
  }

  let appliedJql = "";
  let validDtAccounts = [];
  let validNames = [];
  let isCustomTarget = false;

  if (overrideJql && overrideJql.trim()) {
    let cleaned = overrideJql.trim();
    if (!cleaned.toLowerCase().includes('project')) {
      appliedJql = `${projectClause} AND (${cleaned})`;
    } else {
      appliedJql = cleaned;
    }
    if (targetUsers.length > 0) {
      validDtAccounts = [...new Set(targetUsers.map(u => u.dt_account).filter(Boolean))];
      validNames = [...new Set(targetUsers.map(u => u.name).filter(Boolean))];
      isCustomTarget = true;
      
      // JQL에 worklogAuthor 조건이 없고 유효한 계정이 존재한다면 JQL 조건에 추가하여 데이터 대폭 축소
      if (!appliedJql.toLowerCase().includes("worklogauthor") && validDtAccounts.length > 0) {
        const authorList = validDtAccounts.map(a => `${a}`).join(", ");
        appliedJql = `${appliedJql} AND worklogAuthor in (${authorList})`;
      }
    }
  } else if (targetType === "custom" && targetUsers.length > 0) {
    validDtAccounts = [...new Set(targetUsers.map(u => u.dt_account).filter(Boolean))];
    validNames = [...new Set(targetUsers.map(u => u.name).filter(Boolean))];
    isCustomTarget = true;
    const authorList = validDtAccounts.length > 0 ? validDtAccounts.map(a => `${a}`).join(", ") : "";
    const authorCond = authorList ? ` AND worklogAuthor in (${authorList})` : "";
    const dateCond = (startDate && endDate) ? `worklogDate >= ${startDate} AND worklogDate < ${endDateNext}` : `worklogDate >= ${startDate}`;
    appliedJql = `${projectClause}${authorCond} AND ${dateCond}`;
  } else if (targetType === "me") {
    const dateCond = (startDate && endDate) ? `worklogDate >= ${startDate} AND worklogDate < ${endDateNext}` : `worklogDate >= ${startDate}`;
    appliedJql = `${projectClause} AND worklogAuthor in (currentUser()) AND ${dateCond}`;
    
    // me 타겟인 경우 타인 워크로그가 섞여서 다운로드되지 않도록 현재 사용자 정보 조회 및 필터 지정
    try {
      const myselfUrl = `${cleanDomain}/rest/api/2/myself`;
      const myselfRes = await fetchWithRetry(myselfUrl, { method: "GET", headers }, debugLog);
      if (myselfRes.ok) {
        const myself = await myselfRes.json();
        const myName = (myself.name || "").trim();
        const myAccountId = (myself.accountId || "").trim();
        const myDisplayName = (myself.displayName || "").trim();
        
        validDtAccounts = [myName, myAccountId].filter(Boolean);
        validNames = [myDisplayName].filter(Boolean);
        isCustomTarget = true;
        
        debugLog.push(`[Service] currentUser 검증 설정 완료: ${myDisplayName} (${myName})`);
      }
    } catch (e) {
      debugLog.push(`[Service] currentUser 검증 설정 실패: ${e.message}`);
    }
  } else {
    const dateCond = (startDate && endDate) ? `worklogDate >= ${startDate} AND worklogDate < ${endDateNext}` : `worklogDate >= ${startDate}`;
    appliedJql = `${projectClause} AND ${dateCond}`;
  }

  debugLog.push(`[Service] JQL: ${appliedJql}`);

  const allIssues = await fetchJiraSearch(appliedJql, ["summary", "issuetype", "status", "project", "timetracking", "duedate", "created", "worklog", "assignee"], { domain: cleanDomain, apiToken: JIRA_API_TOKEN });
  debugLog.push(`[Service] 이슈 수집 완료: ${allIssues.length}건`);
  debugLog.push(`[Service] JQL="${appliedJql}" -> 검색된 이슈 수: ${allIssues.length}`);
  if (allIssues.length > 0) {
    debugLog.push(`[Service] Sample issue: key=${allIssues[0].key}, hasWorklog=${!!allIssues[0].fields?.worklog}, logsLen=${allIssues[0].fields?.worklog?.worklogs?.length}`);
  }
  
  const allWorklogs = [];
  const seenWorklogIds = new Set();
  const applyDateFilter = !(overrideJql && overrideJql.trim() && !isCustomTarget);

  let statTotal = 0;
  let statDateFiltered = 0;
  let statAuthorFiltered = 0;

  for (const issue of allIssues) {
    const embWl = issue.fields?.worklog;
    let logs = [];
    if (embWl && Array.isArray(embWl.worklogs) && embWl.worklogs.length > 0 && (typeof embWl.total === 'undefined' || embWl.total <= embWl.worklogs.length)) {
      logs = embWl.worklogs;
    } else {
      logs = await fetchAllWorklogsForIssue(cleanDomain, headers, issue.key, debugLog);
    }
    
    // 콘솔 로그 도배를 지우고 내부 디버그 데이터 분석에 사용
    if (logs.length > 0) {
      debugLog.push(`[Service] Issue ${issue.key}: raw logs count = ${logs.length}`);
    }

    for (const w of logs) {
      statTotal++;
      if (seenWorklogIds.has(w.id)) continue;
      seenWorklogIds.add(w.id);

      // 날짜 필터
      if (applyDateFilter) {
        const sd = (w.started || "").split("T")[0];
        if (!sd || sd < startDate || sd > endDate) {
          statDateFiltered++;
          continue;
        }
      }

      // 작성자 필터
      if (isCustomTarget) {
        const wu = (w.author?.name || "").trim().toLowerCase();
        const wa = (w.author?.accountId || "").trim().toLowerCase();
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
          statAuthorFiltered++;
          continue;
        }
      }

      // 코멘트 및 파싱
      let commentText = "";
      if (typeof w.comment === "string") {
        commentText = w.comment;
      } else if (w.comment && typeof w.comment === "object") {
        commentText = extractTextFromADF(w.comment);
      }

      let parsedProjectCode = "";
      let parsedWorkType = "";
      const cleanComment = (commentText || "").trim();
      const slashMatch = cleanComment.match(/^([^/]+)\s*\/\s*([^/]+)(?:\s*\/[\s\S]*)?$/);
      const bracketMatch = cleanComment.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]/);
      if (slashMatch) {
        parsedProjectCode = slashMatch[1].trim();
        parsedWorkType = slashMatch[2].trim();
      } else if (bracketMatch) {
        parsedProjectCode = bracketMatch[1].trim();
        parsedWorkType = bracketMatch[2].trim();
      } else {
        const singleBracket = cleanComment.match(/^\[([^\]]+)\]/);
        if (singleBracket) {
          parsedProjectCode = singleBracket[1].trim();
          parsedWorkType = "기타";
        }
      }

      // 키워드 필터
      const includes = (includeKeyword || "").split(",").map(s => s.trim()).filter(Boolean);
      const excludes = (excludeKeyword || "").split(",").map(s => s.trim()).filter(Boolean);
      if (includes.length > 0 && !includes.some(kw => commentText.includes(kw))) continue;
      if (excludes.length > 0 && excludes.some(kw => commentText.includes(kw))) continue;

      const secs = w.timeSpentSeconds || 0;
      const hrs = secs / 3600;

      let issueStartDate = issue.fields.created ? issue.fields.created.split("T")[0] : "-";

      allWorklogs.push({
        id: w.id,
        issueKey: issue.key,
        issueSummary: issue.fields.summary,
        issueType: issue.fields.issuetype?.name || "-",
        issueStatus: issue.fields.status?.name || "-",
        projectKey: issue.fields.project?.key || "-",
        projectName: issue.fields.project?.name || "-",
        projectCode: parsedProjectCode || "",
        workType: parsedWorkType || "",
        author: w.author?.displayName || w.author?.name || "",
        started: w.started,
        timeSpentSeconds: secs,
        timeSpent: Number.isInteger(hrs) ? `${hrs}h` : `${parseFloat(hrs.toFixed(2))}h`,
        comment: commentText || "(작업 내용 미기재)",
        assignee: issue.fields.assignee?.displayName || issue.fields.assignee?.name || "-",
        originalEstimate: issue.fields.timetracking?.originalEstimate || "-",
        remainingEstimate: issue.fields.timetracking?.remainingEstimate || "-",
        issueTimeSpent:  issue.fields.timetracking?.timeSpent || "-",
        originalEstimateSeconds: issue.fields.timetracking?.originalEstimateSeconds || 0,
        remainingEstimateSeconds: issue.fields.timetracking?.remainingEstimateSeconds || 0,
        issueTimeSpentSeconds: issue.fields.timetracking?.timeSpentSeconds || 0,
        issueStartDate:  issueStartDate,
        dueDate:         issue.fields.duedate || "-",
      });
    }
  }

  debugLog.push(`[Service] 필터 결과: 총 ${statTotal}건 중 날짜필터 ${statDateFiltered}건 제외, 작성자필터 ${statAuthorFiltered}건 제외 → 최종 ${allWorklogs.length}건`);

  return allWorklogs;
}
