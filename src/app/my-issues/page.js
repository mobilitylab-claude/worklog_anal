"use client";

import { useEffect } from "react";
// 비즈니스 로직과 데이터를 뷰(View) 밖으로 분리하여 의존성을 해소!
import { useJiraIssues } from "@/hooks/useJiraIssues";
import { exportIssuesToExcel } from "@/utils/exportExcel";

// View Layer: 화면 렌더링에만 집중하는 리액트 컨테이너입니다.
export default function MyIssues() {
  const { jql, setJql, issues, loading, error, debugText, stepLogs, searchIssues } = useJiraIssues();

  // 버튼 클릭 시의 동작 핸들러
  const handleApplyFilterClick = () => {
    // onClick 이벤트 동작 테스트용 얼럿
    console.log("필터 적용 버튼 명시적 클릭됨");
    searchIssues();
  };

  const handleExportClick = async () => {
    try {
      await exportIssuesToExcel(issues, "jira_worklog_export.xlsx");
    } catch(err) {
      alert("엑셀 추출 컴포넌트 오류: " + err.message);
    }
  };

  // 마운트 시 최초 데이터 가져오기
  useEffect(() => {
    console.log("MyIssues 컴포넌트 뷰 렌더링 완료. 최초 조회 실시.");
    searchIssues();
  }, [searchIssues]);

  return (
    <div>
      <div className="page-header">
        <h1>내 할당 이슈</h1>
        <p>나에게 할당된 이슈를 집중적으로 필터링하고 분석하여 엑셀로 추출합니다.</p>
      </div>

      <div className="card" style={{ marginBottom: "2rem" }}>
        <div className="action-bar">
          <div className="search-input">
            <label htmlFor="jqlInput">맞춤형 JQL 검색</label>
            <textarea
              id="jqlInput"
              value={jql}
              onChange={(e) => setJql(e.target.value)}
              placeholder="예: assignee = currentUser() AND status = 'In Progress'"
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignSelf: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleApplyFilterClick} disabled={loading}>
              {loading ? "조회 중..." : "필터 적용"}
            </button>
            <button className="btn btn-success" onClick={handleExportClick} disabled={issues.length === 0 || loading}>
              엑셀로 내보내기 📥
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading">데이터를 불러오는 중입니다...</div>
        ) : issues.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>이슈 키</th>
                  <th>요약</th>
                  <th>상태</th>
                  <th>담당자</th>
                  <th>업데이트일</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <td style={{ color: 'var(--accent-color)', fontWeight: 600 }}>{issue.key}</td>
                    <td>{issue.fields?.summary}</td>
                    <td>
                      <span className="iss-status">
                        {issue.fields?.status?.name}
                      </span>
                    </td>
                    <td>{issue.fields?.assignee?.displayName || "-"}</td>
                    <td>{new Date(issue.fields?.updated || issue.fields?.created).toLocaleDateString("ko-KR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="loading" style={{ padding: "4rem 0" }}>
            조회된 이슈가 없습니다. 모든 업무를 완료하셨나요? 🚀
          </div>
        )}
      </div>
    </div>
  );
}
