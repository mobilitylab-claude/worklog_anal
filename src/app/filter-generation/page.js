"use client";

import { useEffect, useState, useRef } from "react";
import { useJiraIssues } from "@/hooks/useJiraIssues";
import { exportIssuesToExcel } from "@/utils/exportExcel";

const AVAILABLE_COLUMNS = [
  { id: "key",        label: "이슈 키"   },
  { id: "issuetype",  label: "유형"      },
  { id: "summary",    label: "요약"      },
  { id: "status",     label: "상태"      },
  { id: "priority",   label: "우선순위"  },
  { id: "assignee",   label: "담당자"    },
  { id: "reporter",   label: "보고자"    },
  { id: "created",    label: "생성일"    },
  { id: "updated",    label: "수정일"    },
  { id: "duedate",    label: "기한(Due)" },
  { id: "resolution", label: "해결결과"  },
];

export default function FilterGeneration() {
  const { jql, setJql, issues, loading, error, searchIssues } = useJiraIssues();
  const [filterName,       setFilterName]       = useState("");
  const [isSaving,         setIsSaving]         = useState(false);
  const [isInitialized,    setIsInitialized]    = useState(false);

  // ── 저장된 필터 불러오기 ──────────────────────────────────────
  const [savedFilters,     setSavedFilters]     = useState([]);
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const [filterLoading,    setFilterLoading]    = useState(false);
  const pickerRef = useRef(null);

  // ── 컬럼 표시/숨김 설정 — localStorage로 영구 유지 ───────────
  const DEFAULT_COLUMNS = ["key", "summary", "status", "assignee", "updated"];
  const STORAGE_KEY = "fg_visibleColumns";

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed   = JSON.parse(saved);
        const validIds = new Set(AVAILABLE_COLUMNS.map(c => c.id));
        const filtered = parsed.filter(id => validIds.has(id));
        if (filtered.length > 0) return filtered;
      }
    } catch (_) {}
    return DEFAULT_COLUMNS;
  });
  const [showColumnConfig, setShowColumnConfig] = useState(false);

  // ── 마운트: URL JQL 파라미터 자동 적용 ───────────────────────
  useEffect(() => {
    if (isInitialized) return;
    const urlParams = new URLSearchParams(window.location.search);
    const jqlParam  = urlParams.get("jql");
    if (jqlParam) { setJql(jqlParam); searchIssues(jqlParam); }
    else           { searchIssues(); }
    setIsInitialized(true);
  }, [searchIssues, setJql, isInitialized]);

  // ── 드롭다운 외부 클릭 시 닫기 ───────────────────────────────
  useEffect(() => {
    const onOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowFilterPicker(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  // ── 저장된 필터 목록 조회 (버튼 클릭 시) ────────────────────
  const loadSavedFilters = async () => {
    if (filterLoading) return;
    setFilterLoading(true);
    try {
      const res  = await fetch("/api/filters");
      const data = await res.json();
      setSavedFilters(data.filters || []);
      setShowFilterPicker(true);
    } catch (e) {
      alert("필터 목록 조회 실패: " + e.message);
    } finally {
      setFilterLoading(false);
    }
  };

  // ── 필터 선택 → JQL 적용 + 즉시 조회 ────────────────────────
  const handlePickFilter = (filter) => {
    setJql(filter.jql);
    setShowFilterPicker(false);
    searchIssues(filter.jql);
  };

  const handleApplyFilterClick = () => searchIssues();

  const handleSaveFilter = async () => {
    if (!filterName.trim() || !jql.trim()) {
      alert("필터 이름(조건 메모)과 JQL을 모두 입력해주세요!");
      return;
    }
    setIsSaving(true);
    try {
      const res  = await fetch("/api/filters", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: filterName, jql }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`'${filterName}' 필터가 성공적으로 저장되었습니다!\n좌측의 '저장된 필터 관리' 메뉴에서 확인하실 수 있습니다.`);
      setFilterName("");
    } catch (err) {
      alert("필터 저장 실패: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportClick = async () => {
    try {
      await exportIssuesToExcel(issues, "jira_custom_filter_export.xlsx", visibleColumns, AVAILABLE_COLUMNS);
    } catch (err) {
      alert("엑셀 추출 오류: " + err.message);
    }
  };

  const toggleColumn = (colId) => {
    setVisibleColumns(prev => {
      let next;
      if (prev.includes(colId)) {
        if (prev.length === 1) return prev;
        next = prev.filter(c => c !== colId);
      } else {
        const nextSet = new Set([...prev, colId]);
        next = AVAILABLE_COLUMNS.filter(c => nextSet.has(c.id)).map(c => c.id);
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const renderCellContent = (issue, colId) => {
    const f = issue.fields || {};
    switch (colId) {
      case "key":
        return (
          <a
            href={issue.self ? `${new URL(issue.self).origin}/browse/${issue.key}` : "#"}
            target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--accent-color)", textDecoration: "none", fontWeight: 600 }}
            onMouseOver={e => e.target.style.textDecoration = "underline"}
            onMouseOut={e  => e.target.style.textDecoration = "none"}
            title={`클릭하면 Jira의 ${issue.key} 페이지로 이동합니다.`}
          >{issue.key} ↗</a>
        );
      case "issuetype":  return f.issuetype?.name        || "-";
      case "summary":    return f.summary                || "";
      case "status":     return <span className="iss-status">{f.status?.name || "-"}</span>;
      case "priority":   return f.priority?.name         || "-";
      case "assignee":   return f.assignee?.displayName  || "-";
      case "reporter":   return f.reporter?.displayName  || "-";
      case "created":    return f.created  ? new Date(f.created).toLocaleDateString("ko-KR")  : "-";
      case "updated":    return f.updated  ? new Date(f.updated).toLocaleDateString("ko-KR")  : "-";
      case "duedate":    return f.duedate  || "-";
      case "resolution": return f.resolution?.name || "-";
      default:           return "";
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

          {/* ── JQL 입력 영역 ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>

            {/* 레이블 행: JQL 제목 + 불러오기 버튼 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label htmlFor="jqlInput" style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--accent-color)" }}>
                🔍 맞춤형 JQL 쿼리
              </label>

              {/* 저장된 JQL 불러오기 드롭다운 */}
              <div style={{ position: "relative" }} ref={pickerRef}>
                <button
                  onClick={loadSavedFilters}
                  disabled={filterLoading}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.4rem",
                    background: "rgba(59,130,246,0.12)",
                    border: "1px solid rgba(59,130,246,0.4)",
                    color: "#60a5fa", padding: "0.3rem 0.85rem",
                    borderRadius: "6px", fontSize: "0.82rem",
                    cursor: "pointer", transition: "all 0.2s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.22)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(59,130,246,0.12)"}
                >
                  📂 {filterLoading ? "불러오는 중..." : "저장된 JQL 불러오기"}
                </button>

                {showFilterPicker && (
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)",
                    background: "#13131f", border: "1px solid #2a2a3a",
                    borderRadius: "10px", width: "380px", maxHeight: "320px",
                    overflowY: "auto", zIndex: 200,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  }}>
                    <div style={{
                      padding: "0.6rem 1rem", borderBottom: "1px solid #2a2a3a",
                      fontSize: "0.78rem", color: "#555", position: "sticky", top: 0,
                      background: "#13131f",
                    }}>
                      저장된 필터 {savedFilters.length}개 — 선택 시 JQL 적용 후 즉시 조회
                    </div>
                    {savedFilters.length === 0 ? (
                      <div style={{ padding: "2rem", textAlign: "center", color: "#444", fontSize: "0.85rem" }}>
                        저장된 필터가 없습니다.
                      </div>
                    ) : (
                      savedFilters.map(f => (
                        <div
                          key={f.id}
                          onClick={() => handlePickFilter(f)}
                          style={{
                            padding: "0.75rem 1rem", cursor: "pointer",
                            borderBottom: "1px solid #1a1a2e",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(59,130,246,0.1)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#e2e8f0", marginBottom: "0.3rem" }}>
                            📌 {f.name}
                          </div>
                          <div style={{
                            fontSize: "0.75rem", color: "#60a5fa", fontFamily: "monospace",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {f.jql}
                          </div>
                          {f.created_at && (
                            <div style={{ fontSize: "0.7rem", color: "#3a3a5a", marginTop: "0.2rem" }}>
                              {new Date(f.created_at).toLocaleString("ko-KR")}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* textarea + 버튼 */}
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
              <textarea
                id="jqlInput"
                value={jql}
                onChange={e => setJql(e.target.value)}
                placeholder={"예: assignee = currentUser() AND status = 'In Progress'\n      AND project = 'MYPROJ' ORDER BY updated DESC"}
                rows={3}
                style={{
                  flex: 1,
                  padding: "0.7rem 1rem",
                  borderRadius: "8px",
                  background: "var(--bg-color)",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                  fontFamily: "monospace",
                  fontSize: "0.88rem",
                  lineHeight: 1.6,
                  resize: "vertical",
                  outline: "none",
                  transition: "border-color 0.2s",
                  boxSizing: "border-box",
                }}
                onFocus={e => e.target.style.borderColor = "var(--accent-color)"}
                onBlur={e  => e.target.style.borderColor = "var(--border-color)"}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleApplyFilterClick();
                  }
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <button
                  className="btn btn-primary"
                  onClick={handleApplyFilterClick}
                  disabled={loading}
                  title="Ctrl+Enter로도 조회 가능"
                  style={{ padding: "0.55rem 1.25rem", whiteSpace: "nowrap" }}
                >
                  {loading ? "조회 중..." : "🔍 바로 조회"}
                </button>
                <button
                  className="btn btn-success"
                  onClick={handleExportClick}
                  disabled={issues.length === 0 || loading}
                  style={{ padding: "0.55rem 1.25rem", whiteSpace: "nowrap" }}
                >
                  엑셀 내보내기 📥
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.75rem", color: "#3a3a5a", margin: 0 }}>
              💡{" "}
              <kbd style={{ background: "#1a1a2e", border: "1px solid #333", padding: "0 4px", borderRadius: "3px", fontSize: "0.72rem" }}>Ctrl</kbd>
              {" + "}
              <kbd style={{ background: "#1a1a2e", border: "1px solid #333", padding: "0 4px", borderRadius: "3px", fontSize: "0.72rem" }}>Enter</kbd>
              {" 로 빠르게 조회할 수 있습니다."}
            </p>
          </div>

          {/* ── JQL 저장 행 ── */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            borderTop: "1px solid var(--border-color)", paddingTop: "1rem",
          }}>
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              조회 결과가 유용하다면 언제든 불러올 수 있도록 필터를 보관해 보세요.
            </span>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                placeholder="새 필터 이름 입력..."
                value={filterName}
                onChange={e => setFilterName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveFilter()}
                style={{
                  padding: "0.45rem 1rem", borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  background: "rgba(255,255,255,0.02)", color: "white",
                  width: "220px", fontSize: "0.85rem",
                }}
              />
              <button
                className="btn"
                style={{ background: "#475569", color: "white", fontSize: "0.85rem", padding: "0.45rem 1rem", height: "auto" }}
                onClick={handleSaveFilter}
                disabled={isSaving}
              >
                {isSaving ? "저장 중..." : "💾 JQL 저장하기"}
              </button>
            </div>
          </div>

        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ position: "relative" }}>
        {/* 상단 툴바 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>조회 결과 ({issues.length}건)</h2>
          <button
            onClick={() => setShowColumnConfig(!showColumnConfig)}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)",
              padding: "0.4rem 0.8rem", borderRadius: "4px",
              color: "var(--text-primary)", cursor: "pointer", fontSize: "0.85rem",
            }}
          >
            ⚙️ 화면 열(Column) 표시 설정
          </button>
        </div>

        {/* 컬럼 설정 패널 */}
        {showColumnConfig && (
          <div style={{
            padding: "1rem", background: "var(--bg-color)",
            borderRadius: "8px", marginBottom: "1.5rem",
            border: "1px dashed var(--border-color)",
          }}>
            <p style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--text-secondary)" }}>
              체크박스를 클릭하여 보고 싶은 열을 자유롭게 켜고 끄시면 즉시 화면에 반영됩니다.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              {AVAILABLE_COLUMNS.map(col => (
                <label key={col.id} style={{
                  display: "flex", alignItems: "center", gap: "0.4rem",
                  cursor: "pointer", fontSize: "0.9rem",
                  color: visibleColumns.includes(col.id) ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
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

        {loading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <div style={{ color: "var(--accent-color)", fontWeight: "bold", fontSize: "1.2rem", marginTop: "1rem" }}>
              Jira 이슈를 불러오는 중...
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.5rem" }}>
              대량의 데이터를 페이지네이션으로 수집 중입니다. (100개 제한 없음)
            </p>
          </div>
        )}

        {issues.length > 0 ? (
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
                {issues.map(issue => (
                  <tr key={issue.id}>
                    {AVAILABLE_COLUMNS.filter(c => visibleColumns.includes(c.id)).map(col => (
                      <td key={`${issue.id}-${col.id}`}>{renderCellContent(issue, col.id)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && (
          <div className="loading" style={{ padding: "4rem 0" }}>
            조회된 이슈가 없습니다. 상단의 JQL 쿼리를 다시 작성해 보세요! 🚀
          </div>
        )}
      </div>
    </div>
  );
}
