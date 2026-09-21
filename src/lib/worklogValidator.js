let db = null;
try {
  const mod = await import('./db.js');
  db = mod.default || mod;
} catch (e) {
  // Win32 로컬 테스트 등 네이티브 모듈 로드 불가 환경 대응
}


export const extractTextFromADF = (node) => {
  if (typeof node === "string") return node;
  if (!node) return "";
  let text = "";
  if (node.text) text += node.text;
  if (node.content && Array.isArray(node.content)) {
    text += node.content.map(extractTextFromADF).join(" ");
  }
  return text;
};

/**
 * DB에서 모니터링 규칙 설정을 조회합니다.
 */
export function getMonitoringRules() {
  const getRuleData = (key) => {
    try {
      const rowVal = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get(`noti_rule_${key}`);
      const isActive = rowVal ? rowVal.value === 'true' : true; 
      const rowTarget = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get(`noti_target_${key}`);
      const target = rowTarget ? rowTarget.value.trim() : '';
      return { isActive, target };
    } catch (e) {
      return { isActive: true, target: '' };
    }
  };

  return {
    USER_WORKLOG: getRuleData('USER_WORKLOG'),
    INVALID_PROJECT: getRuleData('INVALID_PROJECT'),
    INVALID_TASK_TYPE: getRuleData('INVALID_TASK_TYPE'),
    TIME_EXCEEDED: getRuleData('TIME_EXCEEDED')
  };
}

/**
 * DB에서 등록된 프로젝트 코드 목록(유효/완료)과 표준 작업유형 목록을 조회합니다.
 */
export function getValidationStandards() {
  const todayStr = new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];

  const validProjectsRow = db.prepare('SELECT code, end_date FROM projects').all();
  const validProjects = [];
  const completedProjects = [];

  validProjectsRow.forEach(p => {
    if (p.code) {
      const isCompleted = p.end_date && p.end_date < todayStr;
      p.code.split(',').forEach(c => {
        const cleanCode = c.trim().toLowerCase();
        if (cleanCode) {
          if (isCompleted) completedProjects.push(cleanCode);
          else validProjects.push(cleanCode);
        }
      });
    }
  });

  const validTypesRow = db.prepare('SELECT name, keywords_json FROM work_types').all();
  const validTypes = [];
  validTypesRow.forEach(t => {
    if (t.name) validTypes.push(t.name.trim().toLowerCase());
    try {
      const keywords = JSON.parse(t.keywords_json || '[]');
      keywords.forEach(k => {
        const cleanK = k.trim().toLowerCase();
        if (cleanK) validTypes.push(cleanK);
      });
    } catch (e) {}
  });

  return {
    todayStr,
    validProjects,
    completedProjects,
    validTypes
  };
}

/**
 * 대상 필터링 함수: targetStr이 비어있으면 전체 대상, 설정되어 있으면 checkValues 중 포함 여부 검사
 */
export const isTargetMatched = (targetStr, checkValues) => {
  if (!targetStr) return true;
  const targets = targetStr.toLowerCase().split(',').map(s => s.trim()).filter(s => s);
  if (targets.length === 0) return true;

  return checkValues.some(val => {
    if (!val) return false;
    const lowerVal = String(val).toLowerCase();
    return targets.some(t => lowerVal.includes(t));
  });
};

/**
 * 단일 워크로그에 대해 포맷, 프로젝트 코드, 작업유형 유효성을 검사하고 이상 항목 목록(배열)을 반환합니다.
 */
export function validateSingleWorklog({
  wl,
  issueKey,
  summary,
  author,
  authorId,
  validProjects,
  completedProjects,
  validTypes,
  rules,
  jiraHost = ''
}) {
  const prjPrefix = (issueKey || '').split('-')[0].toLowerCase();
  const cleanHost = (jiraHost || process.env.JIRA_HOST || 'https://jira.yourcompany.com').replace(/\/$/, '');
  const url = `${cleanHost}/browse/${issueKey}`;

  let commentStr = '';
  if (wl.comment) {
    if (typeof wl.comment === 'string') commentStr = wl.comment;
    else if (wl.comment.version && wl.comment.type === 'doc') commentStr = extractTextFromADF(wl.comment);
  }

  const cleanComment = commentStr.trim();
  let parsedProjectCode = prjPrefix;
  let parsedWorkType = "";
  let isFormatMatched = false;

  // ── [1] 슬래시 포맷 최우선 파싱: {프로젝트코드} / {작업유형} / {작업기록 내용} ──
  // 작업기록 내용에 슬래시(URL, 경로 등)나 대괄호([UI], [HOTFIX] 등)가 포함되어도 오탐하지 않도록 첫 번째/두 번째 슬래시만 구분자로 사용
  const slashMatch = cleanComment.match(/^([^/]+?)\s*\/\s*([^/]+?)(?:\s*\/([\s\S]*))?$/);

  if (slashMatch) {
    parsedProjectCode = slashMatch[1].trim().replace(/^\[|\]$/g, '').trim().toLowerCase();
    parsedWorkType = slashMatch[2].trim().replace(/^\[|\]$/g, '').trim().toLowerCase();
    isFormatMatched = true;
  } else {
    // ── [2] 대괄호 포맷 (반드시 문자열 맨 처음에서 시작): ^[{프로젝트}] [{작업유형}] {내용} ──
    const bracketMatch = cleanComment.match(/^\[([^\]]+)\]\s*\[([^\]]+)\](?:\s*([\s\S]*))?$/);
    if (bracketMatch) {
      parsedProjectCode = bracketMatch[1].trim().toLowerCase();
      parsedWorkType = bracketMatch[2].trim().toLowerCase();
      isFormatMatched = true;
    } else {
      // ── [3] 단일 대괄호 포맷 (반드시 문자열 맨 처음에서 시작): ^[{프로젝트}] {내용} ──
      const singleBracketMatch = cleanComment.match(/^\[([^\]]+)\](?:\s*([\s\S]*))?$/);
      if (singleBracketMatch) {
        parsedProjectCode = singleBracketMatch[1].trim().toLowerCase();
        parsedWorkType = "";
        isFormatMatched = true; // 프로젝트 포맷은 시도했으나 작업유형이 누락됨
      } else {
        // ── [4] 구분 기호 없음 (일반 텍스트) ──
        parsedProjectCode = prjPrefix;
        parsedWorkType = "";
        isFormatMatched = false;
      }
    }
  }

  const checkTargets = [author, authorId, issueKey];
  const detectedAlerts = [];

  // 1. 미등록 프로젝트 또는 완료된 프로젝트 확인
  const isUnregistered = !validProjects.includes(parsedProjectCode) && !completedProjects.includes(parsedProjectCode);
  const isCompleted = completedProjects.includes(parsedProjectCode);

  if (rules.INVALID_PROJECT?.isActive && (isUnregistered || isCompleted)) {
    if (isTargetMatched(rules.INVALID_PROJECT.target, checkTargets)) {
      const problemType = isCompleted ? '완료된 프로젝트' : '미등록 프로젝트';
      detectedAlerts.push({
        id: `alert-proj-${wl.id || issueKey}-${parsedProjectCode}`,
        worklogId: wl.id || '',
        notiType: 'INVALID_PROJECT',
        title: problemType + ' 코드 사용',
        message: `${problemType}(${parsedProjectCode.toUpperCase()})에 작업기록이 등록되었습니다.`,
        comment: commentStr,
        parsedProjectCode,
        issueKey,
        summary: summary || '',
        url,
        author,
        time: new Date().toLocaleTimeString(),
        receiveTime: new Date().toLocaleTimeString(),
        isRead: false
      });
    }
  }

  // 2. 미정의 작업유형 및 포맷 불일치 확인 (프로젝트 코드 오류와 독립적으로 항상 검사)
  if (rules.INVALID_TASK_TYPE?.isActive) {
    const isInvalidType = !parsedWorkType || !validTypes.includes(parsedWorkType);
    if (!isFormatMatched || isInvalidType) {
      if (isTargetMatched(rules.INVALID_TASK_TYPE.target, checkTargets)) {
        let title = '미정의 작업유형';
        let message = '코멘트에 표준 작업유형(예: [개발])이 올바르게 명시되지 않았습니다.';

        if (!isFormatMatched && !cleanComment) {
          title = '작업기록 내용 없음';
          message = '작업기록 내용(코멘트)이 비어 있습니다. [프로젝트][작업유형] 또는 슬래시 포맷을 입력하세요.';
        } else if (!isFormatMatched) {
          title = '작업기록 포맷 오류';
          message = `코멘트 포맷이 올바르지 않습니다 (입력값: "${cleanComment.substring(0, 30)}..."). 예: [프로젝트][작업유형] 또는 프로젝트/작업유형/내용`;
        } else if (!parsedWorkType) {
          title = '작업유형 누락';
          message = '코멘트에 작업유형이 명시되지 않았습니다. [프로젝트][작업유형] 형식으로 입력하세요.';
        } else if (!validTypes.includes(parsedWorkType)) {
          title = '미정의 작업유형';
          message = `표준 작업유형 목록에 없는 [${parsedWorkType}]을(를) 사용하였습니다.`;
        }

        detectedAlerts.push({
          id: `alert-type-${wl.id || issueKey}-${parsedWorkType || 'invalid'}`,
          worklogId: wl.id || '',
          notiType: 'INVALID_TASK_TYPE',
          title,
          message,
          comment: commentStr,
          parsedWorkType: parsedWorkType || null,
          issueKey,
          summary: summary || '',
          url,
          author,
          time: new Date().toLocaleTimeString(),
          receiveTime: new Date().toLocaleTimeString(),
          isRead: false
        });
      }
    }
  }

  return detectedAlerts;
}
