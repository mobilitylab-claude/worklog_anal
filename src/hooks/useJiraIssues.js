"use client";
import { useState, useCallback } from "react";

// Business Logic Layer: 화면(View)에서 분리된 상태 관리 및 데이터 페칭 로직
export function useJiraIssues(initialJql = "assignee = currentUser() ORDER BY updated DESC") {
  const [jql, setJql] = useState(initialJql);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [debugText, setDebugText] = useState("");
  const [stepLogs, setStepLogs] = useState([]);

  const addLog = useCallback((msg) => {
    setStepLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);
    console.log(`[UI 로직] ${msg}`);
  }, []);

  const clearLogs = useCallback(() => setStepLogs([]), []);

  const searchIssues = useCallback(async (customJql) => {
    const targetJql = customJql || jql;
    clearLogs();
    addLog("1. 검색 동작 호출 (JQL: " + targetJql + ")");
    setLoading(true);
    setError("");
    
    try {
      addLog("2. Next.js 백엔드 API(/api/jira) 요청 시작");
      const res = await fetch("/api/jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jql: targetJql }),
      });
      addLog(`3. 통신 응답 수신완료 (Status: ${res.status})`);

      const rawText = await res.text();
      addLog(`4. 응답 데이터 추출 (길이: ${rawText.length} bytes)`);
      setDebugText(rawText);

      let errJson = {};
      try { 
        errJson = JSON.parse(rawText); 
        addLog("5. API JSON 규격 일치 성공");
      } catch(e) {
        throw new Error("서버 응답이 JSON이 아닙니다.");
      }

      if (!res.ok) {
         addLog("6. API 자체에서 에러 플래그 반환");
         throw new Error(errJson.error || "알 수 없는 백엔드 네트워크 에러");
      }
      
      if (errJson.error) {
         throw new Error(errJson.error);
      }

      const issuesArr = errJson.issues || [];
      addLog(`7. 정상 이슈 파싱 성공! (검색된 개수: ${issuesArr.length}개)`);
      setIssues(issuesArr);
    } catch (err) {
      addLog(`🚨 예외 상황 포착: ${err.message}`);
      setError(err.message);
      alert(`[오류 방어 로직 작동]\n${err.message}`);
    } finally {
      addLog("8. 검색 기능 프로세스 종료");
      setLoading(false);
    }
  }, [jql, addLog, clearLogs]);

  return { jql, setJql, issues, loading, error, debugText, stepLogs, searchIssues };
}
