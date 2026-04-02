"use client";

import { useEffect, useState, useMemo, useRef } from "react";

const AVAILABLE_COLUMNS = [
  { id: "started",     label: "작업 일시",      width: "11%" },
  { id: "issueKey",    label: "이슈 번호",      width: "8%"  },
  { id: "issueType",   label: "이슈 유형",      width: "7%"  },
  { id: "issueSummary",label: "이슈 요약",      width: "20%" },
  { id: "issueStatus", label: "이슈 상태",      width: "8%"  },
  { id: "author",      label: "작업자",         width: "9%"  },
  { id: "timeSpent",   label: "소요시간",       width: "7%"  },
  { id: "comment",     label: "작업 내용",      width: "30%" },
];

export default function WorklogAnalyzer() {
  // ── 날짜 기본값: 어제 ──────────────────────────────────────────
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  })();

  const [startDate, setStartDate] = useState(yesterday);
  const [endDate,   setEndDate]   = useState(yesterday);

  // ── 검색 조건 ──────────────────────────────────────────────────
  const [includeKeyword, setIncludeKeyword] = useState("");
  const [excludeKeyword, setExcludeKeyword] = useState("");
  const [targetMode,     setTargetMode]     = useState("me");
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectedUsers,  setSelectedUsers]  = useState([]);

  // ── 사용자 목록 (DB) ───────────────────────────────────────────
  const [dbUsers, setDbUsers] = useState([]);

  // ── JQL 관리 ──────────────────────────────────────────────────
  const [jqlValue,    setJqlValue]    = useState("");
  const [isManualJql, setIsManualJql] = useState(false);

  // ── 결과 / 상태 ────────────────────────────────────────────────
  const [worklogs,      setWorklogs]      = useState([]);
  const [usedJql,       setUsedJql]       = useState("");
  const [debugLog,      setDebugLog]      = useState([]);
  const [totalIssues,   setTotalIssues]   = useState(0);
  const [showDebug,     setShowDebug]     = useState(false);

  // ── 로딩 / 진행 ────────────────────────────────────────────────
  const [loading,        setLoading]        = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [statusMsg,      setStatusMsg]      = useState("");
  const progressTimerRef = useRef(null);

  // ── UI 제어 ────────────────────────────────────────────────────
  const [filterAuthor,     setFilterAuthor]     = useState(null);
  const [showCharts,       setShowCharts]       = useState(true);
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [visibleColumns,   setVisibleColumns]   = useState(AVAILABLE_COLUMNS.map(c => c.id));

  // ── 초기 사용자 목록 로드 ──────────────────────────────────────
  useEffect(() => {
    fetch("/api/users")
      .then(r => r.json())
      .then(d => setDbUsers(d.users || []))
      .catch(e => console.error("사용자 조회 실패:", e));
  }, []);

  // ── 자동 JQL 생성 ─────────────────────────────────────────────
  useEffect(() => {
    if (isManualJql) return;

    let jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor = currentUser()`;

    if (targetMode !== "me" && selectedUsers.length > 0) {
      const accounts = [...new Set(
        dbUsers.filter(u => selectedUsers.includes(u.id)).map(u => u.dt_account).filter(Boolean)
      )];
      if (accounts.length > 0) {
        const list = accounts.map(a => `"${a}"`).join(", ");
        jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor in (${list})`;
      }
    }
    setJqlValue(jql);
  }, [startDate, endDate, targetMode, selectedUsers, dbUsers, isManualJql]);

  // ── 파트 목록 ──────────────────────────────────────────────────
  const partsList = useMemo(
    () => Array.from(new Set(dbUsers.map(u => u.part))).filter(Boolean),
    [dbUsers]
  );

  // ── 그룹 토글 ──────────────────────────────────────────────────
  const handleGroupToggle = (part) => {
    const members = dbUsers.filter(u => u.part === part).map(u => u.id);
    if (selectedGroups.includes(part)) {
      setSelectedGroups(prev => prev.filter(g => g !== part));
      setSelectedUsers(prev => prev.filter(id => !members.includes(id)));
    } else {
      setSelectedGroups(prev => [...prev, part]);
      setSelectedUsers(prev => Array.from(new Set([...prev, ...members])));
    }
  };

  const handleUserToggle = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // ── 시작일 변경 → 종료일 자동 +1일 ───────────────────────────
  const handleStartDateChange = (val) => {
    setStartDate(val);
    const d = new Date(val);
    d.setDate(d.getDate() + 1);
    setEndDate(d.toISOString().split("T")[0]);
  };

  // ── 진행바 시작/정리 ──────────────────────────────────────────
  const startProgress = () => {
    setSearchProgress(0);
    setStatusMsg("Jira 이슈 목록 수집 중...");
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      setSearchProgress(prev => {
        if (prev >= 90) return prev;
        return prev + (prev < 40 ? 6 : prev < 70 ? 3 : 1);
      });
    }, 300);
  };

  const finishProgress = (msg = "완료") => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setSearchProgress(100);
    setStatusMsg(msg);
    setTimeout(() => setLoading(false), 600);
  };

  // ── 검색 실행 ─────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!startDate || !endDate) { alert("날짜를 입력해주세요."); return; }

    setLoading(true);
    setWorklogs([]);
    setDebugLog([]);
    setFilterAuthor(null);
    startProgress();

    try {
      let targetUsers = [];
      if (targetMode !== "me") {
        targetUsers = dbUsers.filter(u => selectedUsers.includes(u.id));
      }

      setStatusMsg("Jira API 호출 중 (이슈 스캔)...");

      const res = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          includeKeyword,
          excludeKeyword,
          targetType: targetMode === "me" ? "me" : "custom",
          targetUsers,
          overrideJql: isManualJql ? jqlValue : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "조회 실패");

      setStatusMsg(`워크로그 ${data.worklogs?.length ?? 0}건 수집 완료`);
      setWorklogs(data.worklogs || []);
      setUsedJql(data.usedJql || "");
      setDebugLog(data.debugLog || []);
      setTotalIssues(data.totalIssues || 0);
      finishProgress(`✅ ${data.worklogs?.length ?? 0}건 수집 완료`);
    } catch (err) {
      finishProgress(`❌ 오류: ${err.message}`);
      setLoading(false);
      alert("조회 실패: " + err.message);
    }
  };

  // ── 엑셀 내보내기 ─────────────────────────────────────────────
  const handleExport = async () => {
    if (worklogs.length === 0) return;
    try {
      const xlsx = await import("xlsx");
      const wb = xlsx.utils.book_new();

      // 시트1: 상세 내역
      const detail = filteredWorklogs.map(w => {
        const row = {};
        if (visibleColumns.includes("started"))      row["작업 일시"]  = new Date(w.started).toLocaleString("ko-KR");
        if (visibleColumns.includes("issueKey"))     row["이슈 키"]    = w.issueKey;
        if (visibleColumns.includes("issueType"))    row["이슈 유형"]  = w.issueType;
        if (visibleColumns.includes("issueSummary")) row["이슈 요약"]  = w.issueSummary;
        if (visibleColumns.includes("issueStatus"))  row["이슈 상태"]  = w.issueStatus;
        if (visibleColumns.includes("author"))       row["작업자"]     = w.author;
        if (visibleColumns.includes("timeSpent"))    row["소요 시간(h)"]  = w.timeSpent;
        if (visibleColumns.includes("timeSpent"))    row["원본 시간"]     = w.timeSpentRaw || w.timeSpent;
        if (visibleColumns.includes("comment"))      row["작업 내용"]  = w.comment;
        return row;
      });
      const ws1 = xlsx.utils.json_to_sheet(detail);
      ws1["!cols"] = [{ wch:18 },{ wch:12 },{ wch:12 },{ wch:40 },{ wch:12 },{ wch:15 },{ wch:12 },{ wch:80 }];
      xlsx.utils.book_append_sheet(wb, ws1, "1. 작업 내역 상세");

      // 시트2: 월별
      const ws2 = xlsx.utils.json_to_sheet(statsByMonth.map(s => ({ "연월": s.label, "총 시간(H)": parseFloat(s.value) })));
      ws2["!cols"] = [{ wch: 15 }, { wch: 15 }];
      xlsx.utils.book_append_sheet(wb, ws2, "2. 월별 통계");

      // 시트3: 작업자별
      const ws3 = xlsx.utils.json_to_sheet(statsByUser.map(s => ({ "작업자": s.label, "누적 시간(H)": parseFloat(s.value) })));
      ws3["!cols"] = [{ wch: 20 }, { wch: 15 }];
      xlsx.utils.book_append_sheet(wb, ws3, "3. 작업자별 통계");

      xlsx.writeFile(wb, `Jira_Worklog_${startDate}_to_${endDate}.xlsx`);
    } catch (e) {
      alert("엑셀 오류: " + e.message);
    }
  };

  const toggleColumn = (id) =>
    setVisibleColumns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

  // ── 통계 계산 ─────────────────────────────────────────────────
  const statsByMonth = useMemo(() => {
    const map = {};
    worklogs.forEach(w => {
      const m = w.started.substring(0, 7);
      map[m] = (map[m] || 0) + (w.timeSpentSeconds || 0);
    });
    return Object.entries(map).sort().map(([k, v]) => ({ label: k, value: (v / 3600).toFixed(1) }));
  }, [worklogs]);

  const statsByUser = useMemo(() => {
    const map = {};
    worklogs.forEach(w => { map[w.author] = (map[w.author] || 0) + (w.timeSpentSeconds || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / 3600).toFixed(1) }));
  }, [worklogs]);

  const filteredWorklogs = useMemo(() =>
    filterAuthor ? worklogs.filter(w => w.author === filterAuthor) : worklogs,
    [worklogs, filterAuthor]
  );

  const filteredTotalHours = useMemo(() =>
    (filteredWorklogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0) / 3600).toFixed(1),
    [filteredWorklogs]
  );

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>

      {/* ── 전체화면 로딩 오버레이 ── */}
      {loading && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)",
          zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "var(--card-bg, #1a1a2e)",
            border: "1px solid #334",
            borderRadius: "16px",
            padding: "2.5rem 3rem",
            maxWidth: "520px",
            width: "90%",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚡</div>
            <h3 style={{ marginBottom: "0.5rem", color: "white" }}>Jira 정밀 스캔 중</h3>
            <p style={{ fontSize: "0.85rem", color: "#888", marginBottom: "1.5rem" }}>{statusMsg}</p>

            {/* 진행바 */}
            <div style={{ width: "100%", height: "10px", background: "#222", borderRadius: "5px", overflow: "hidden", marginBottom: "0.75rem" }}>
              <div style={{
                width: `${searchProgress}%`,
                height: "100%",
                background: "linear-gradient(90deg, #3b82f6 0%, #10b981 100%)",
                borderRadius: "5px",
                transition: "width 0.35s ease-out",
              }} />
            </div>
            <div style={{ fontWeight: "bold", fontSize: "1.1rem", color: "#10b981" }}>{searchProgress}%</div>
            <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#555" }}>
              이슈 전체 페이지네이션 + 워크로그 순차 수집 중.<br/>데이터량에 따라 수 분이 소요될 수 있습니다.
            </p>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>워크로그 분석기</h1>
        <p>프로젝트 멤버들의 작업 시간을 심층 분석하고 시각화합니다.</p>
      </div>

      {/* ── 검색 조건 카드 ── */}
      <div className="card" style={{ marginBottom: "2rem" }}>

        {/* 날짜 + 대상 */}
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap", borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>시작일</label>
            <input type="date" value={startDate} onChange={e => handleStartDateChange(e.target.value)}
              style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>종료일</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>조회 대상</label>
            <select value={targetMode} onChange={e => setTargetMode(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }}>
              <option value="me">나의 워크로그</option>
              <option value="group">파트/그룹별 조회</option>
              <option value="individual">개별 인원 선택</option>
            </select>
          </div>
        </div>

        {/* 그룹/인원 선택 */}
        {targetMode !== "me" && (
          <div style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: 600 }}>📁 분석 대상 그룹 선택</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                {partsList.map(p => (
                  <label key={p} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", padding: "4px 10px", borderRadius: "16px", border: `1px solid ${selectedGroups.includes(p) ? "var(--accent-color)" : "#444"}`, background: selectedGroups.includes(p) ? "rgba(59,130,246,0.1)" : "transparent", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedGroups.includes(p)} onChange={() => handleGroupToggle(p)} />
                    <span style={{ color: selectedGroups.includes(p) ? "white" : "gray" }}>{p}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>👤 세부 인원 ({selectedUsers.length}명 선택)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", maxHeight: "150px", overflowY: "auto", padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
                {(targetMode === "group" ? dbUsers.filter(u => selectedGroups.includes(u.part)) : dbUsers).map(u => (
                  <label key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", background: selectedUsers.includes(u.id) ? "rgba(16,185,129,0.1)" : "transparent", border: `1px solid ${selectedUsers.includes(u.id) ? "#10b981" : "transparent"}`, padding: "2px 8px", borderRadius: "4px", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => handleUserToggle(u.id)} />
                    <span style={{ color: selectedUsers.includes(u.id) ? "#34d399" : "var(--text-secondary)" }}>{u.name} ({u.part})</span>
                  </label>
                ))}
                {targetMode === "group" && selectedGroups.length === 0 && (
                  <span style={{ fontSize: "0.8rem", color: "gray", padding: "0.5rem" }}>분석할 그룹을 먼저 체크해주세요.</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* JQL 관리 패널 */}
        <div style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "#050508", borderRadius: "12px", border: `1px solid ${isManualJql ? "var(--accent-color)" : "#2a2a3a"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: "bold" }}>
              🔍 JQL 쿼리 {isManualJql ? "(수동 편집 모드)" : "(자동 생성 모드)"}
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => setIsManualJql(v => !v)}
                style={{ background: isManualJql ? "var(--accent-color)" : "transparent", border: "1px solid var(--accent-color)", color: isManualJql ? "white" : "var(--accent-color)", padding: "0.2rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer" }}>
                {isManualJql ? "🔓 수동 편집 중" : "🔒 자동 생성 모드"}
              </button>
              {isManualJql && (
                <button onClick={() => setIsManualJql(false)}
                  style={{ background: "transparent", border: "1px solid #555", color: "#aaa", padding: "0.2rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer" }}>
                  자동으로 복구 ↩
                </button>
              )}
            </div>
          </div>
          <textarea
            value={jqlValue}
            onChange={e => isManualJql && setJqlValue(e.target.value)}
            readOnly={!isManualJql}
            style={{ width: "100%", height: "64px", background: isManualJql ? "rgba(59,130,246,0.08)" : "transparent", border: `1px solid ${isManualJql ? "var(--accent-color)" : "#2a2a3a"}`, borderRadius: "8px", color: isManualJql ? "white" : "#60a5fa", padding: "0.75rem", fontSize: "0.82rem", fontFamily: "monospace", outline: "none", resize: "vertical", boxSizing: "border-box" }}
          />
          <p style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "#555" }}>
            {isManualJql
              ? "⚠️ 수동 모드: UI 조건 무시, 작성된 JQL 그대로 실행됩니다."
              : "💡 자동 모드: 날짜·인원 선택이 바뀌면 JQL이 실시간 갱신됩니다."}
          </p>
        </div>

        {/* 키워드 + 실행 버튼 */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <input type="text" placeholder="포함 키워드 (쉼표 구분)" value={includeKeyword}
            onChange={e => setIncludeKeyword(e.target.value)}
            style={{ flex: 1, minWidth: "180px", padding: "0.55rem 0.75rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
          <input type="text" placeholder="제외 키워드 (쉼표 구분)" value={excludeKeyword}
            onChange={e => setExcludeKeyword(e.target.value)}
            style={{ flex: 1, minWidth: "180px", padding: "0.55rem 0.75rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
          <button onClick={handleSearch} disabled={loading} className="btn-primary"
            style={{ padding: "0.55rem 2rem", fontWeight: "bold", opacity: loading ? 0.6 : 1 }}>
            📊 쿼리 실행
          </button>
          <button onClick={handleExport} disabled={worklogs.length === 0} className="btn-success"
            style={{ padding: "0.55rem 1.25rem" }}>
            📥 엑셀 저장
          </button>
        </div>
      </div>

      {/* ── 실행 결과 디버그 패널 ── */}
      {debugLog.length > 0 && (
        <div style={{ marginBottom: "1.5rem", background: "#050508", border: "1px solid #2a2a3a", borderRadius: "12px", overflow: "hidden" }}>
          <div
            onClick={() => setShowDebug(v => !v)}
            style={{ padding: "0.75rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: showDebug ? "1px solid #2a2a3a" : "none" }}>
            <span style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: "bold" }}>
              🐛 디버그 정보 — 이슈 {totalIssues}건 스캔 → 워크로그 {worklogs.length}건 수집
            </span>
            <span style={{ color: "#555", fontSize: "0.8rem" }}>{showDebug ? "▲ 접기" : "▼ 펼치기"}</span>
          </div>
          {showDebug && (
            <div style={{ padding: "1rem 1.25rem", overflowX: "auto" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#888", marginBottom: "0.75rem", background: "#0a0a12", padding: "0.75rem", borderRadius: "6px", border: "1px solid #2a2a3a", wordBreak: "break-all" }}>
                <strong style={{ color: "#60a5fa" }}>실행된 JQL:</strong><br />{usedJql}
              </div>
              <div style={{ maxHeight: "240px", overflowY: "auto" }}>
                {debugLog.map((line, i) => (
                  <div key={i} style={{ fontSize: "0.78rem", fontFamily: "monospace", color: line.startsWith("[오류]") ? "#f87171" : line.startsWith("[최종]") ? "#34d399" : "#666", padding: "1px 0" }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 분석 차트 ── */}
      {worklogs.length > 0 && (
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <h2>📊 분석 리포트 <span style={{ fontSize: "0.8rem", color: "#555", fontWeight: "normal" }}>(작업자 클릭 시 필터)</span></h2>
            <button onClick={() => setShowCharts(v => !v)} style={{ fontSize: "0.8rem", background: "transparent", border: "1px solid #333", color: "#888", padding: "0.2rem 0.8rem", borderRadius: "6px", cursor: "pointer" }}>
              {showCharts ? "숨기기" : "차트 보기"}
            </button>
          </div>
          {showCharts && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
              <div>
                <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "1rem" }}>월별 실적</h3>
                {statsByMonth.map(s => {
                  const pct = (parseFloat(s.value) / Math.max(...statsByMonth.map(x => parseFloat(x.value)))) * 100;
                  return (
                    <div key={s.label} style={{ marginBottom: "0.6rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "2px" }}>
                        <span>{s.label}</span><span style={{ color: "#60a5fa" }}>{s.value}h</span>
                      </div>
                      <div style={{ height: "5px", background: "#1a1a2e", borderRadius: "3px" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent-color)", borderRadius: "3px", transition: "width 0.6s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "1rem" }}>작업자별 실적</h3>
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  {statsByUser.map(s => {
                    const active = filterAuthor === s.label;
                    const pct = (parseFloat(s.value) / Math.max(...statsByUser.map(x => parseFloat(x.value)))) * 100;
                    return (
                      <div key={s.label}
                        onClick={() => setFilterAuthor(active ? null : s.label)}
                        style={{ marginBottom: "0.6rem", cursor: "pointer", padding: "4px 8px", borderRadius: "6px", background: active ? "rgba(59,130,246,0.12)" : "transparent", border: `1px solid ${active ? "var(--accent-color)" : "transparent"}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "2px" }}>
                          <span>{active ? "✅ " : ""}{s.label}</span><span style={{ color: "#10b981" }}>{s.value}h</span>
                        </div>
                        <div style={{ height: "5px", background: "#1a1a2e", borderRadius: "3px" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#10b981", borderRadius: "3px" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 작업 내역 테이블 ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", marginBottom: "0.4rem" }}>📋 필터링된 작업 내역</h2>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ background: "rgba(59,130,246,0.15)", border: "1px solid var(--accent-color)", padding: "2px 10px", borderRadius: "14px", fontSize: "0.82rem", fontWeight: "bold", color: "var(--accent-color)" }}>
                총 {filteredWorklogs.length}건
              </span>
              <span style={{ background: "rgba(16,185,129,0.12)", border: "1px solid #10b981", padding: "2px 10px", borderRadius: "14px", fontSize: "0.82rem", fontWeight: "bold", color: "#10b981" }}>
                {filteredTotalHours}h
              </span>
              {filterAuthor && (
                <span style={{ color: "#fbbf24", fontSize: "0.82rem" }}>
                  🔍 {filterAuthor}
                  <button onClick={() => setFilterAuthor(null)} style={{ marginLeft: "0.4rem", background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline" }}>해제</button>
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowColumnConfig(v => !v)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #333", color: "#aaa", padding: "0.35rem 0.9rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.82rem" }}>
            🛠️ 열 설정
          </button>
        </div>

        {showColumnConfig && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", padding: "0.75rem", background: "#050508", borderRadius: "8px", border: "1px dashed #333" }}>
            {AVAILABLE_COLUMNS.map(c => (
              <label key={c.id} style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
                <input type="checkbox" checked={visibleColumns.includes(c.id)} onChange={() => toggleColumn(c.id)} /> {c.label}
              </label>
            ))}
          </div>
        )}

        {filteredWorklogs.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {AVAILABLE_COLUMNS.filter(c => visibleColumns.includes(c.id)).map(c => <th key={c.id}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {filteredWorklogs.map(w => (
                  <tr key={`${w.id}-${w.issueKey}`}>
                    {visibleColumns.includes("started")      && <td style={{ whiteSpace: "nowrap" }}>{new Date(w.started).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</td>}
                    {visibleColumns.includes("issueKey")     && <td>{w.issueKey}</td>}
                    {visibleColumns.includes("issueType")    && <td>{w.issueType}</td>}
                    {visibleColumns.includes("issueSummary") && <td style={{ fontSize: "0.8rem" }}>{w.issueSummary}</td>}
                    {visibleColumns.includes("issueStatus")  && <td>{w.issueStatus}</td>}
                    {visibleColumns.includes("author")       && <td style={{ fontWeight: "bold" }}>{w.author}</td>}
                    {visibleColumns.includes("timeSpent")    && <td style={{ color: "#10b981", whiteSpace: "nowrap", fontWeight: "bold" }}>
                      {w.timeSpent}
                      {w.timeSpentRaw && w.timeSpentRaw !== w.timeSpent && (
                        <span style={{ color: "#555", fontSize: "0.75rem", marginLeft: "0.3rem" }}>({w.timeSpentRaw})</span>
                      )}
                    </td>}
                    {visibleColumns.includes("comment")      && <td style={{ fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>{w.comment}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "4rem 0", textAlign: "center", color: "#444" }}>
            {loading ? "" : "조건에 부합하는 워크로그가 없습니다."}
          </div>
        )}
      </div>
    </div>
  );
}
