"use client";

import { useEffect, useState } from "react";
import { useJiraIssues } from "@/hooks/useJiraIssues";
import { exportIssuesToExcel } from "@/utils/exportExcel";

const AVAILABLE_COLUMNS = [
  { id: "key", label: "이슈 키" },
  { id: "issuetype", label: "유형" },
  { id: "summary", label: "요약" },
  { id: "status", label: "상태" },
  { id: "priority", label: "우선순위" },
  { id: "assignee", label: "담당자" },
  { id: "reporter", label: "보고자" },
  { id: "created", label: "생성일" },
  { id: "updated", label: "수정일" },
  { id: "duedate", label: "기한(Due)" },
  { id: "resolution", label: "해결결과" }
];

export default function FilterGeneration() {
  const { jql, setJql, issues, loading, error, searchIssues } = useJiraIssues();
  const [filterName, setFilterName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // 컬럼 표시/숨김 설정 상태
  const [visibleColumns, setVisibleColumns] = useState(["key", "summary", "status", "assignee", "updated"]);
  const [showColumnConfig, setShowColumnConfig] = useState(false);

  // 마운트 시 데이터 조회 (URL jql 파라미터가 비동기적으로 넘어올 때 자동 적용)
  useEffect(() => {
    if (isInitialized) return;
    const urlParams = new URLSearchParams(window.location.search);
    const jqlParam = urlParams.get('jql');
    
    if (jqlParam) {
      setJql(jqlParam);
      searchIssues(jqlParam);
    } else {
      searchIssues();
    }
    setIsInitialized(true);
  }, [searchIssues, setJql, isInitialized]);

  const handleApplyFilterClick = () => {
    searchIssues();
  };

  const handleSaveFilter = async () => {
    if (!filterName.trim() || !jql.trim()) {
      alert("필터 이름(조건 메모)과 JQL을 모두 입력해주세요!");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: filterName, jql }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      alert(`'${filterName}' 필터가 성공적으로 저장되었습니다!\n좌측의 '저장된 필터 관리' 메뉴에서 확인하실 수 있습니다.`);
      setFilterName(""); 
    } catch(err) {
      alert("필터 저장 실패: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportClick = async () => {
    try {
      // 엑셀 내보내기도 내가 선택한 컬럼 순서 및 구성 그대로 반영!
      await exportIssuesToExcel(issues, "jira_custom_filter_export.xlsx", visibleColumns, AVAILABLE_COLUMNS);
    } catch(err) {
      alert("엑셀 추출 오류: " + err.message);
    }
  };

  const toggleColumn = (colId) => {
    setVisibleColumns(prev => {
      if (prev.includes(colId)) {
        // 제거 시 최소 1개는 남겨둠
        if (prev.length === 1) return prev;
        return prev.filter(c => c !== colId);
      } else {
        // 추가 시: 원래 AVAILABLE_COLUMNS에 선언된 순서대로 정렬 삽입 (UX 향상)
        const nextSet = new Set([...prev, colId]);
        return AVAILABLE_COLUMNS.filter(c => nextSet.has(c.id)).map(c => c.id);
      }
    });
  };

  // 테이블 내 각 셀 데이터 추출 로직
  const renderCellContent = (issue, colId) => {
    const f = issue.fields || {};
    switch (colId) {
      case "key":
        return (
          <a 
            href={issue.self ? `${new URL(issue.self).origin}/browse/${issue.key}` : `#`} 
            target="_blank" 
            rel="noopener noreferrer" 
            style={{ color: "var(--accent-color)", textDecoration: "none", fontWeight: 600 }}
            onMouseOver={(e) => e.target.style.textDecoration = "underline"}
            onMouseOut={(e) => e.target.style.textDecoration = "none"}
            title={`클릭하면 Jira의 ${issue.key} 페이지로 이동합니다.`}
          >
            {issue.key} ↗
          </a>
        );
      case "issuetype":
        return f.issuetype?.name || "-";
      case "summary":
        return f.summary || "";
      case "status":
        return <span className="iss-status">{f.status?.name || "-"}</span>;
      case "priority":
        return f.priority?.name || "-";
      case "assignee":
        return f.assignee?.displayName || "-";
      case "reporter":
        return f.reporter?.displayName || "-";
      case "created":
        return f.created ? new Date(f.created).toLocaleDateString("ko-KR") : "-";
      case "updated":
        return f.updated ? new Date(f.updated).toLocaleDateString("ko-KR") : "-";
      case "duedate":
        return f.duedate || "-";
      case "resolution":
        return f.resolution?.name || "-";
      default:
        return "";
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Filter Generation</h1>
        <p>복잡한 JQL 필터를 설계하여 실시간으로 확인하고, 유용한 조합을 별도로 저장하여 관리해 보세요.</p>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          
          <div style={{ display: "flex", gap: "0.75rem", width: "100%", alignItems: "flex-end" }}>
            <div className="search-input" style={{ flex: 1, padding: 0, gap: "0.4rem" }}>
              <label htmlFor="jqlInput" style={{ display: "block" }}>맞춤형 JQL 쿼리</label>
              <input
                type="text"
                id="jqlInput"
                value={jql}
                onChange={(e) => setJql(e.target.value)}
                placeholder="예: assignee = currentUser() AND status = 'In Progress'"
                style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "8px", background: "var(--bg-color)", border: "1px solid var(--border-color)", color: "var(--text-primary)", fontFamily: "monospace", fontSize: "0.9rem" }}
              />
            </div>
            
            <button className="btn btn-primary" onClick={handleApplyFilterClick} disabled={loading} style={{ height: "42px", padding: "0 1.25rem" }}>
              {loading ? "조회 중..." : "🔍 바로 조회"}
            </button>
            <button className="btn btn-success" onClick={handleExportClick} disabled={issues.length === 0 || loading} style={{ height: "42px", padding: "0 1.25rem" }}>
              엑셀 내보내기 📥
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-color)", paddingTop: "1rem", marginTop: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              조회 결과가 유용하다면 언제든 불러올 수 있도록 필터를 보관해 보세요.
            </span>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input 
                type="text" 
                placeholder="새 필터 이름 입력..." 
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                style={{ padding: "0.45rem 1rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.02)", color: "white", width: "220px", fontSize: "0.85rem" }}
              />
              <button className="btn" style={{ background: "#475569", color: "white", fontSize: "0.85rem", padding: "0.45rem 1rem", height: "auto" }} onClick={handleSaveFilter} disabled={isSaving}>
                {isSaving ? "저장 중..." : "💾 JQL 저장하기"}
              </button>
            </div>
          </div>

        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {/* 상단 툴바: 결과 개수 및 동적 컬럼 설정 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
           <h2 style={{ fontSize: "1.1rem" }}>조회 결과 ({issues.length}건)</h2>
           <button 
             onClick={() => setShowColumnConfig(!showColumnConfig)}
             style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", padding: "0.4rem 0.8rem", borderRadius: "4px", color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem" }}
           >
             ⚙️ 화면 열(Column) 표시 설정
           </button>
        </div>

        {/* 컬럼 설정 드롭다운/패널 UI */}
        {showColumnConfig && (
          <div style={{ padding: "1rem", background: "var(--bg-color)", borderRadius: "8px", marginBottom: "1.5rem", border: "1px dashed var(--border-color)" }}>
            <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--text-secondary)" }}>체크박스를 클릭하여 보고 싶은 열을 자유롭게 켜고 끄시면 즉시 화면에 반영됩니다.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              {AVAILABLE_COLUMNS.map(col => (
                <label key={col.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.9rem", color: visibleColumns.includes(col.id) ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  <input 
                    type="checkbox" 
                    checked={visibleColumns.includes(col.id)} 
                    onChange={() => toggleColumn(col.id)} 
                    style={{ cursor: "pointer" }}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading">데이터를 불러오는 중입니다...</div>
        ) : issues.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {AVAILABLE_COLUMNS.filter(c => visibleColumns.includes(c.id)).map(col => (
                    <th key={col.id}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    {AVAILABLE_COLUMNS.filter(c => visibleColumns.includes(c.id)).map(col => (
                       <td key={`${issue.id}-${col.id}`}>
                         {renderCellContent(issue, col.id)}
                       </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="loading" style={{ padding: "4rem 0" }}>
            조회된 이슈가 없습니다. 상단의 JQL 쿼리를 다시 작성해 보세요! 🚀
          </div>
        )}
      </div>
    </div>
  );
}
