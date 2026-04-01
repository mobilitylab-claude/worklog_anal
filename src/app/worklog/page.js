"use client";

import { useEffect, useState, useMemo } from "react";

const AVAILABLE_COLUMNS = [
  { id: "started", label: "완료 일시", width: "12%" },
  { id: "issueKey", label: "이슈 번호", width: "8%" },
  { id: "issueType", label: "이슈 유형", width: "8%" },
  { id: "issueSummary", label: "소속 이슈 요약", width: "20%" },
  { id: "issueStatus", label: "이슈 상태", width: "8%" },
  { id: "author", label: "작업자", width: "10%" },
  { id: "timeSpent", label: "걸린시간", width: "7%" },
  { id: "comment", label: "✔️ 필터링된 실제 작업 내용 (Worklog)", width: "27%" }
];

export default function WorklogAnalyzer() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1); // 어제 날짜
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1); // 어제 날짜
    return d.toISOString().split('T')[0];
  });
  
  const [worklogs, setWorklogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [jiraHost, setJiraHost] = useState("");
  const [usedJql, setUsedJql] = useState("");

  const [includeKeyword, setIncludeKeyword] = useState("");
  const [excludeKeyword, setExcludeKeyword] = useState("");
  
  const [dbUsers, setDbUsers] = useState([]);
  const [targetMode, setTargetMode] = useState("me"); 
  const [selectedGroups, setSelectedGroups] = useState([]); // 선택된 파트(그룹) 리스트
  const [selectedUsers, setSelectedUsers] = useState([]); // 개별 선택된 user IDs

  const [visibleColumns, setVisibleColumns] = useState(AVAILABLE_COLUMNS.map(c => c.id));
  const [showColumnConfig, setShowColumnConfig] = useState(false);

  // 시각화/필터링 State
  const [showCharts, setShowCharts] = useState(true);
  const [filterAuthor, setFilterAuthor] = useState(null);

  useEffect(() => {
    fetch("/api/users").then(res => res.json()).then(data => {
      setDbUsers(data.users || []);
    }).catch(e => console.error("사용자 정보 조회 실패:", e));
  }, []);

  // 파트 중복 제거 리스트 생성
  const partsList = useMemo(() => Array.from(new Set(dbUsers.map(u => u.part))).filter(Boolean), [dbUsers]);

  // [기능 추가] 파트(그룹) 토글 핸들러
  const handleGroupToggle = (partName) => {
    const isAdding = !selectedGroups.includes(partName);
    const partMembers = dbUsers.filter(u => u.part === partName).map(u => u.id);
    
    if (isAdding) {
      setSelectedGroups([...selectedGroups, partName]);
      setSelectedUsers(prev => Array.from(new Set([...prev, ...partMembers])));
    } else {
      setSelectedGroups(selectedGroups.filter(g => g !== partName));
      setSelectedUsers(prev => prev.filter(uid => !partMembers.includes(uid)));
    }
  };

  // [기능 추가] 개별 유저 토글 핸들러
  const handleUserToggle = (userId) => {
    setSelectedUsers(prev => {
      const isSelected = prev.includes(userId);
      const next = isSelected ? prev.filter(id => id !== userId) : [...prev, userId];
      
      // 개별 선택 변경 시 소속 그룹의 전체 체크 상태 등은 필요 시 연동 가능하지만,
      // 여기서는 독립적으로 동작하게 두어 더 세밀한 컨트롤을 보장합니다.
      return next;
    });
  };

  const handleSearch = async () => {
    if (!startDate || !endDate) {
      alert("날짜를 입력해주세요.");
      return;
    }
    setLoading(true);
    setFilterAuthor(null);
    try {
      let targetUsers = [];
      if (targetMode !== "me") {
        targetUsers = dbUsers.filter(u => selectedUsers.includes(u.id));
      }

      const res = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          startDate, endDate, includeKeyword, excludeKeyword,
          targetType: targetMode === "me" ? "me" : "custom",
          targetUsers
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWorklogs(data.worklogs || []);
      setJiraHost(data.jiraHost || "");
      setUsedJql(data.usedJql || "");
    } catch(err) {
      alert("조회 실패: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (worklogs.length === 0) return;
    try {
      const xlsx = await import("xlsx");
      const workbook = xlsx.utils.book_new();

      // 1. 작업 내역 상세 (현재 필터링된 결과)
      const exportData = filteredWorklogs.map(w => {
        const row = {};
        if (visibleColumns.includes("started")) row["작업 일시"] = new Date(w.started).toLocaleString("ko-KR");
        if (visibleColumns.includes("issueKey")) row["이슈 키"] = w.issueKey;
        if (visibleColumns.includes("issueType")) row["이슈 유형"] = w.issueType;
        if (visibleColumns.includes("issueSummary")) row["이슈 요약"] = w.issueSummary;
        if (visibleColumns.includes("issueStatus")) row["이슈 상태"] = w.issueStatus;
        if (visibleColumns.includes("author")) row["작업자"] = w.author;
        if (visibleColumns.includes("timeSpent")) row["소요 시간"] = w.timeSpent;
        if (visibleColumns.includes("comment")) row["작성 상세 내용"] = w.comment;
        return row;
      });
      const wsDetail = xlsx.utils.json_to_sheet(exportData);
      
      // 컬럼 너비 조정 (상세 내역)
      wsDetail['!cols'] = [
        { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 80 }
      ];
      xlsx.utils.book_append_sheet(workbook, wsDetail, "1. 작업 내역 상세");

      // 2. 월별 통계 리포트
      const wsMonth = xlsx.utils.json_to_sheet(statsByMonth.map(s => ({
        "작업 연월": s.label,
        "총 소요 시간 (H)": parseFloat(s.value)
      })));
      wsMonth['!cols'] = [{ wch: 15 }, { wch: 20 }];
      xlsx.utils.book_append_sheet(workbook, wsMonth, "2. 월별 통계 리포트");

      // 3. 작업자별 통계 리포트
      const wsUser = xlsx.utils.json_to_sheet(statsByUser.map(s => ({
        "작무 담당자": s.label,
        "전체 누적 시간 (H)": parseFloat(s.value)
      })));
      wsUser['!cols'] = [{ wch: 20 }, { wch: 20 }];
      xlsx.utils.book_append_sheet(workbook, wsUser, "3. 작업자별 통계 리포트");

      // 파일 생성 및 다운로드 (타임스탬프 기반 작명)
      const fileName = `Jira_Worklog_Analysis_${startDate}_to_${endDate}.xlsx`;
      xlsx.writeFile(workbook, fileName);
    } catch (e) {
      alert("엑셀 통합 리포트 추출 중 오류 발생: " + e.message);
    }
  };

  const toggleColumn = (colId) => {
    setVisibleColumns(prev => 
      prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId]
    );
  };

  const totalSeconds = worklogs.reduce((acc, curr) => acc + (curr.timeSpentSeconds || 0), 0);
  const totalHours = (totalSeconds / 3600).toFixed(1);

  const statsByMonth = useMemo(() => {
    const monthsMap = {};
    worklogs.forEach(w => {
      const month = w.started.substring(0, 7);
      monthsMap[month] = (monthsMap[month] || 0) + (w.timeSpentSeconds || 0);
    });
    return Object.entries(monthsMap).sort().map(([k, v]) => ({ label: k, value: (v/3600).toFixed(1) }));
  }, [worklogs]);

  const statsByUser = useMemo(() => {
    const usersMap = {};
    worklogs.forEach(w => {
      usersMap[w.author] = (usersMap[w.author] || 0) + (w.timeSpentSeconds || 0);
    });
    return Object.entries(usersMap).sort((a,b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v/3600).toFixed(1) }));
  }, [worklogs]);

  const filteredWorklogs = useMemo(() => {
    if (!filterAuthor) return worklogs;
    return worklogs.filter(w => w.author === filterAuthor);
  }, [worklogs, filterAuthor]);

  const filteredTotalHours = useMemo(() => {
    const totalSec = filteredWorklogs.reduce((acc, curr) => acc + (curr.timeSpentSeconds || 0), 0);
    return (totalSec / 3600).toFixed(1);
  }, [filteredWorklogs]);

  return (
    <div>
      <div className="page-header">
        <h1>워크로그 분석기</h1>
        <p>프로젝트 멤버들의 작업 시간을 심층 분석하고 시각화합니다.</p>
      </div>

      <div className="card" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap", borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>시작일</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>종료일</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>조회 대상</label>
            <select value={targetMode} onChange={e => setTargetMode(e.target.value)} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }}>
              <option value="me">나의 워크로그</option>
              <option value="group">파트/그룹별 조회</option>
              <option value="individual">개별 인원 선택</option>
            </select>
          </div>
        </div>

        {(targetMode !== "me") && (
          <div style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
            
            {/* 파트(그룹) 선택 영역 */}
            <div style={{ marginBottom: "1rem" }}>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: "600" }}>📁 분석 대상 그룹 선택 (중복 가능)</label>
               <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                 {partsList.map(p => (
                   <label key={p} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", padding: "4px 10px", borderRadius: "16px", border: "1px solid", borderColor: selectedGroups.includes(p) ? "var(--accent-color)" : "#444", background: selectedGroups.includes(p) ? "rgba(59, 130, 246, 0.1)" : "transparent", cursor: "pointer", transition: "all 0.2s" }}>
                      <input type="checkbox" checked={selectedGroups.includes(p)} onChange={() => handleGroupToggle(p)} style={{ cursor: "pointer" }} />
                      <span style={{ color: selectedGroups.includes(p) ? "white" : "gray" }}>{p}</span>
                   </label>
                 ))}
               </div>
            </div>

            {/* 개별 인원 세부 선택 영역 */}
            <div>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>👤 세부 인원 조정 ({selectedUsers.length}명 선택됨)</label>
               <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", maxHeight: "150px", overflowY: "auto", padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
                 {(targetMode === "group" 
                    ? dbUsers.filter(u => selectedGroups.includes(u.part)) 
                    : dbUsers 
                 ).map(u => (
                   <label key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", background: selectedUsers.includes(u.id) ? "rgba(16, 185, 129, 0.1)" : "transparent", border: "1px solid", borderColor: selectedUsers.includes(u.id) ? "#10b981" : "transparent", padding: "2px 8px", borderRadius: "4px", cursor: "pointer" }}>
                     <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => handleUserToggle(u.id)} style={{ cursor: "pointer" }} />
                     <span style={{ color: selectedUsers.includes(u.id) ? "#34d399" : "var(--text-secondary)" }}>{u.name} ({u.part})</span>
                   </label>
                 ))}
                 {targetMode === "group" && selectedGroups.length === 0 && <span style={{ fontSize: "0.8rem", color: "gray", padding: "0.5rem" }}>분석할 그룹을 먼저 체크해주세요.</span>}
               </div>
            </div>

          </div>
        )}

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <input type="text" placeholder="포함 키워드" value={includeKeyword} onChange={e => setIncludeKeyword(e.target.value)} style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
          <input type="text" placeholder="제외 키워드" value={excludeKeyword} onChange={e => setExcludeKeyword(e.target.value)} style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
          <button onClick={handleSearch} disabled={loading} className="btn-primary" style={{ padding: "0 1.5rem" }}>{loading ? "조회 중..." : "데이터 조회"}</button>
          <button onClick={handleExport} disabled={worklogs.length === 0} className="btn-success" style={{ padding: "0 1.5rem" }}>엑셀 저장</button>
        </div>
      </div>

      {worklogs.length > 0 && (
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <h2>📊 분석 리포트 (클릭 시 필터 적용)</h2>
            <button onClick={() => setShowCharts(!showCharts)} style={{ fontSize: "0.8rem" }}>{showCharts ? "차트 숨기기" : "차트 보기"}</button>
          </div>
          {showCharts && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
               <div>
                 <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "1rem" }}>월별 실적</h3>
                 {statsByMonth.map(s => (
                   <div key={s.label} style={{ marginBottom: "0.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>{s.label}</span><span>{s.value}h</span></div>
                      <div style={{ height: "4px", background: "#222", borderRadius: "2px" }}><div style={{ width: `${(s.value / Math.max(...statsByMonth.map(x => x.value))) * 100}%`, height: "100%", background: "var(--accent-color)" }}></div></div>
                   </div>
                 ))}
               </div>
               <div>
                 <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "1rem" }}>작업자별 실적 (이름 클릭)</h3>
                 <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                   {statsByUser.map(s => (
                     <div key={s.label} onClick={() => setFilterAuthor(filterAuthor === s.label ? null : s.label)} style={{ marginBottom: "0.5rem", cursor: "pointer", padding: "4px", borderRadius: "4px", background: filterAuthor === s.label ? "rgba(59, 130, 246, 0.1)" : "transparent" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}><span>{filterAuthor === s.label ? "✅ " : ""}{s.label}</span><span>{s.value}h</span></div>
                        <div style={{ height: "4px", background: "#222", borderRadius: "2px" }}><div style={{ width: `${(s.value / Math.max(...statsByUser.map(x => x.value))) * 100}%`, height: "100%", background: "#10b981" }}></div></div>
                     </div>
                   ))}
                 </div>
               </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>📋 필터링된 작업 내역 상세</h2>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
               <div style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid var(--accent-color)", padding: "4px 12px", borderRadius: "16px", fontSize: "0.85rem", fontWeight: "bold", color: "var(--accent-color)" }}>
                  총 {filteredWorklogs.length}건
               </div>
               <div style={{ background: "rgba(16, 185, 129, 0.15)", border: "1px solid #10b981", padding: "4px 12px", borderRadius: "16px", fontSize: "0.85rem", fontWeight: "bold", color: "#10b981" }}>
                  작업시간 총합계: {filteredTotalHours} 시간
               </div>
               {filterAuthor && (
                 <span style={{ color: "#fbbf24", fontSize: "0.85rem", fontWeight: "bold" }}>
                   (🔍 {filterAuthor} 대상 필터링 중) 
                   <button onClick={() => setFilterAuthor(null)} style={{ border: "none", background: "transparent", color: "gray", fontSize: "0.75rem", marginLeft: "0.3rem", cursor: "pointer", textDecoration: "underline" }}>해제</button>
                 </span>
               )}
            </div>
          </div>
          <button onClick={() => setShowColumnConfig(!showColumnConfig)} className="btn" style={{ padding: "0.4rem 1rem", fontSize: "0.85rem", background: "rgba(255,255,255,0.05)" }}>🛠️ 열 표시 설정</button>
        </div>

        {showColumnConfig && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem", padding: "1rem", background: "#000", border: "1px dashed #333" }}>
            {AVAILABLE_COLUMNS.map(c => (
              <label key={c.id} style={{ fontSize: "0.85rem" }}><input type="checkbox" checked={visibleColumns.includes(c.id)} onChange={() => toggleColumn(c.id)} /> {c.label}</label>
            ))}
          </div>
        )}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {AVAILABLE_COLUMNS.filter(c => visibleColumns.includes(c.id)).map(c => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredWorklogs.map(w => (
                <tr key={w.id}>
                  {visibleColumns.includes("started") && <td>{new Date(w.started).toLocaleDateString()}</td>}
                  {visibleColumns.includes("issueKey") && <td>{w.issueKey}</td>}
                  {visibleColumns.includes("issueType") && <td>{w.issueType}</td>}
                  {visibleColumns.includes("issueSummary") && <td style={{ fontSize: "0.8rem" }}>{w.issueSummary}</td>}
                  {visibleColumns.includes("issueStatus") && <td>{w.issueStatus}</td>}
                  {visibleColumns.includes("author") && <td style={{ fontWeight: "bold" }}>{w.author}</td>}
                  {visibleColumns.includes("timeSpent") && <td style={{ color: "#10b981" }}>{w.timeSpent}</td>}
                  {visibleColumns.includes("comment") && <td style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{w.comment}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
