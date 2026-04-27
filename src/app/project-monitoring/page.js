"use client";

import { useEffect, useState, useMemo, useRef } from "react";

const AVAILABLE_COLUMNS = [
  { id: "started",     label: "작업 일시",      width: "11%" },
  { id: "issueKey",    label: "이슈 번호",      width: "8%"  },
  { id: "issueType",   label: "이슈 유형",      width: "7%"  },
  { id: "issueSummary",label: "이슈 요약",      width: "20%" },
  { id: "author",      label: "작업자",         width: "9%"  },
  { id: "timeSpent",   label: "소요시간",       width: "7%"  },
  { id: "taskType",    label: "작업 유형",      width: "10%" },
  { id: "comment",     label: "작업 내용",      width: "28%" },
];

export default function ProjectMonitoring() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [parentKey, setParentKey] = useState("");
  const [projectCode, setProjectCode] = useState("");

  const [includeKeyword, setIncludeKeyword] = useState("");
  const [excludeKeyword, setExcludeKeyword] = useState("");

  const [dbUsers,        setDbUsers]        = useState([]);
  const [targetMode,     setTargetMode]     = useState("all"); 
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectedUsers,  setSelectedUsers]  = useState([]);

  const [worklogs,      setWorklogs]      = useState([]);
  const [jiraHost,      setJiraHost]      = useState("");
  const [usedJql,       setUsedJql]       = useState("");
  const [debugLog,      setDebugLog]      = useState([]);
  const [totalIssues,   setTotalIssues]   = useState(0);
  const [showDebug,     setShowDebug]     = useState(false);

  const [filterType,   setFilterType]   = useState(null);
  const [filterMonth,  setFilterMonth]  = useState(null);
  const [filterAuthor, setFilterAuthor] = useState(null);

  const [loading,        setLoading]        = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [statusMsg,      setStatusMsg]      = useState("");
  const progressTimerRef = useRef(null);

  useEffect(() => {
    fetch("/api/standards/projects").then(r => r.json()).then(d => setProjects(d.projects || []));
    fetch("/api/users").then(r => r.json()).then(d => setDbUsers(d.users || []));
  }, []);

  const handleProjectChange = (id) => {
    setSelectedProjectId(id);
    const p = projects.find(proj => proj.id === parseInt(id));
    if (p) {
      setStartDate(p.start_date || "");
      setEndDate(p.end_date || "");
      setParentKey(p.parent_key || "");
      setProjectCode(p.code || "");
    }
  };

  const partsList = useMemo(() => Array.from(new Set(dbUsers.map(u => u.part))).filter(Boolean), [dbUsers]);

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
    setSelectedUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const startProgress = () => {
    setSearchProgress(0);
    setStatusMsg("데이터를 분석하는 중입니다...");
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      setSearchProgress(prev => (prev >= 90 ? prev : prev + (prev < 40 ? 8 : 2)));
    }, 300);
  };

  const finishProgress = (msg = "완료") => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    setSearchProgress(100); setStatusMsg(msg);
    setTimeout(() => setLoading(false), 600);
  };

  const handleSearch = async () => {
    if (!startDate || !endDate) { alert("기간을 설정해 주세요."); return; }
    setLoading(true); setWorklogs([]); setDebugLog([]);
    setFilterType(null); setFilterMonth(null); setFilterAuthor(null);
    startProgress();

    try {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      const endDateNext = endDateObj.toISOString().split("T")[0];

      let dateJql = `worklogDate >= "${startDate}" AND worklogDate < "${endDateNext}"`;
      let orFilters = [];
      if (parentKey) orFilters.push(`parent = "${parentKey}"`);
      
      let targetUsersData = [];
      if (targetMode !== "all" && selectedUsers.length > 0) {
        targetUsersData = dbUsers.filter(u => selectedUsers.includes(u.id));
        const accounts = [...new Set(targetUsersData.map(u => u.dt_account).filter(Boolean))];
        if (accounts.length > 0) {
          orFilters.push(`worklogAuthor in (${accounts.map(a => `"${a}"`).join(", ")})`);
        }
      }

      let finalJql = dateJql;
      if (orFilters.length > 0) {
        finalJql += ` AND (${orFilters.join(" OR ")})`;
      }

      const res = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          startDate, 
          endDate, 
          includeKeyword,
          excludeKeyword,
          targetType: targetMode === "all" ? "all" : "custom", 
          targetUsers: targetUsersData, 
          overrideJql: finalJql 
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "조회 실패");

      const mappedLogs = (data.worklogs || []).map(w => {
        const text = (w.comment || "").trim();
        let parts = [];
        let current = "";
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '/' && text.substring(i - 6, i) !== 'https:' && text.substring(i - 5, i) !== 'http:') {
            parts.push(current.trim());
            current = "";
          } else {
            current += text[i];
          }
        }
        parts.push(current.trim());

        let pCode = "";
        let taskType = "미분류";
        
        if (parts.length >= 2 && parts[0].length < 30) {
          pCode = parts[0];
          taskType = parts[1];
        }

        return { ...w, pCode, taskType };
      });

      const filtered = projectCode 
        ? mappedLogs.filter(w => {
            if (!w.pCode) return true; // 포맷이 없는 작업기록(내용만 있는 경우)은 포함
            const validCodes = projectCode.split(",").map(c => c.trim().toLowerCase());
            return validCodes.includes(w.pCode.toLowerCase());
          })
        : mappedLogs;

      setWorklogs(filtered);
      setJiraHost(data.jiraHost || "");
      setUsedJql(data.usedJql || "");
      setDebugLog(data.debugLog || []);
      setTotalIssues(data.totalIssues || 0);
      finishProgress(`✅ ${filtered.length}건 분석 완료`);
    } catch (err) {
      finishProgress(`❌ 오류: ${err.message}`);
      alert("분석 중 오류 발생: " + err.message);
    }
  };

  const calculateMM = (hrs) => (hrs / 8 / 20.5).toFixed(3);

  const statsByType = useMemo(() => {
    const map = {};
    worklogs.forEach(w => { const t = w.taskType; map[t] = (map[t] || 0) + (w.timeSpentSeconds || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, v]) => {
      const hours = v / 3600;
      return { label, hours: hours.toFixed(1), mm: calculateMM(hours), seconds: v };
    });
  }, [worklogs]);

  const statsByMonth = useMemo(() => {
    const map = {};
    worklogs.forEach(w => { 
      const m = (w.started || "").substring(0, 7); 
      if(m) map[m] = (map[m] || 0) + (w.timeSpentSeconds || 0); 
    });
    return Object.entries(map).sort().map(([label, v]) => {
      const hours = v / 3600;
      return { label, hours: hours.toFixed(1), mm: calculateMM(hours) };
    });
  }, [worklogs]);

  const statsByUser = useMemo(() => {
    const map = {};
    worklogs.forEach(w => { map[w.author] = (map[w.author] || 0) + (w.timeSpentSeconds || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, v]) => {
      const hours = v / 3600;
      return { label, hours: hours.toFixed(1), mm: calculateMM(hours) };
    });
  }, [worklogs]);

  const filteredWorklogs = useMemo(() => {
    return worklogs.filter(w => {
      const month = w.started.substring(0, 7);
      if (filterType && w.taskType !== filterType) return false;
      if (filterMonth && month !== filterMonth) return false;
      if (filterAuthor && w.author !== filterAuthor) return false;
      return true;
    });
  }, [worklogs, filterType, filterMonth, filterAuthor]);

  const totalHrs = useMemo(() => (worklogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0) / 3600).toFixed(1), [worklogs]);
  const totalMM = useMemo(() => calculateMM(parseFloat(totalHrs)), [totalHrs]);
  const fTotalHrs = useMemo(() => (filteredWorklogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0) / 3600).toFixed(1), [filteredWorklogs]);
  const fTotalMM = useMemo(() => calculateMM(parseFloat(fTotalHrs)), [fTotalHrs]);

  const handleExport = async () => {
    if (filteredWorklogs.length === 0) return;
    try {
      const xlsx = await import("xlsx");
      const wb = xlsx.utils.book_new();
      const detail = filteredWorklogs.map(w => ({ "날짜": new Date(w.started).toLocaleDateString(), "이슈": w.issueKey, "요약": w.issueSummary, "작업자": w.author, "시간(h)": w.timeSpent, "MM": calculateMM(w.timeSpentSeconds/3600), "유형": w.taskType, "내용": w.comment }));
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(detail), "작업상세");
      xlsx.writeFile(wb, `Project_Monitoring_${projectCode || "Export"}.xlsx`);
    } catch (e) { alert("엑셀 저장 실패: " + e.message); }
  };

  return (
    <div style={{ position: "relative" }}>
      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div style={{ background: "#11111e", border: "1px solid #334", borderRadius: "20px", padding: "3rem", textAlign: "center", width: "400px" }}>
            <h3 style={{ color: "white", marginBottom: "1rem" }}>{statusMsg}</h3>
            <div style={{ width: "100%", height: "10px", background: "#222", borderRadius: "5px", overflow: "hidden" }}>
              <div style={{ width: `${searchProgress}%`, height: "100%", background: "#6366f1", transition: "width 0.3s" }} />
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>📈 프로젝트 입체 모니터링</h1>
        <p>프로젝트 통계와 MM(Man-Month) 분석을 제공합니다.</p>
      </div>

      {/* ── 조건 설정 ── */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1.5rem", borderBottom: "1px solid #2a2a3a", paddingBottom: "1.5rem" }}>
          <div style={{ flex: 2, minWidth: "200px" }}>
            <label style={{ fontSize: "0.8rem", color: "#888" }}>프로젝트</label>
            <select value={selectedProjectId} onChange={e => handleProjectChange(e.target.value)} style={{ width: "100%", padding: "0.6rem", background: "#000", border: "1px solid #333", color: "white", borderRadius: "8px" }}>
              <option value="">-- 선택 --</option>
              {projects.map(p => {
                const isEnded = p.end_date && p.end_date < new Date().toISOString().split("T")[0];
                return (
                  <option key={p.id} value={p.id} disabled={isEnded}>
                    {isEnded ? `[종료] ${p.name}` : p.name} ({p.code})
                  </option>
                );
              })}
            </select>
          </div>
          <div style={{ flex: 1 }}><label style={{ fontSize: "0.8rem", color: "#888" }}>시작</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: "100%", padding: "0.6rem", background: "#000", border: "1px solid #333", color: "white", borderRadius: "8px" }} /></div>
          <div style={{ flex: 1 }}><label style={{ fontSize: "0.8rem", color: "#888" }}>종료</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: "100%", padding: "0.6rem", background: "#000", border: "1px solid #333", color: "white", borderRadius: "8px" }} /></div>
          <div style={{ flex: 1 }}><label style={{ fontSize: "0.8rem", color: "#888" }}>부모키</label><input type="text" value={parentKey} onChange={e => setParentKey(e.target.value)} style={{ width: "100%", padding: "0.6rem", background: "#000", border: "1px solid #333", color: "white", borderRadius: "8px" }} placeholder="부모이슈" /></div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.9rem", color: "#aaa" }}>👥 참여자 필터</span>
            <select value={targetMode} onChange={e => setTargetMode(e.target.value)} style={{ background: "#000", border: "1px solid #333", color: "#aaa", padding: "0.3rem", borderRadius: "6px" }}>
              <option value="all">전체</option><option value="group">그룹</option><option value="individual">개별</option>
            </select>
          </div>
          {targetMode !== "all" && (
            <div style={{ padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "10px", border: "1px solid #222" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
                {partsList.map(p => ( <button key={p} onClick={() => handleGroupToggle(p)} style={{ padding: "4px 10px", borderRadius: "15px", border: `1px solid ${selectedGroups.includes(p) ? "#6366f1" : "#444"}`, background: selectedGroups.includes(p) ? "rgba(99,102,241,0.2)" : "transparent", color: "white", fontSize: "0.75rem", cursor: "pointer" }}>{p}</button> ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", maxHeight: "100px", overflowY: "auto", padding: "0.5rem", background: "#000", borderRadius: "8px" }}>
                {(targetMode === "group" ? dbUsers.filter(u => selectedGroups.includes(u.part)) : dbUsers).map(u => ( <button key={u.id} onClick={() => handleUserToggle(u.id)} style={{ padding: "2px 8px", borderRadius: "4px", border: `1px solid ${selectedUsers.includes(u.id) ? "#10b981" : "transparent"}`, background: selectedUsers.includes(u.id) ? "rgba(16,185,129,0.2)" : "#111", color: "#ccc", fontSize: "0.7rem", cursor: "pointer" }}>{u.name}</button> ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "#888", marginBottom: "0.5rem" }}>포함 키워드 (쉼표로 구분)</label>
              <input type="text" value={includeKeyword} onChange={e => setIncludeKeyword(e.target.value)} style={{ width: "100%", padding: "0.6rem", background: "#000", border: "1px solid #333", color: "white", borderRadius: "8px" }} placeholder="예: 개발, 회의 (하나라도 포함되면 수집)" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "#888", marginBottom: "0.5rem" }}>제외 키워드 (쉼표로 구분)</label>
              <input type="text" value={excludeKeyword} onChange={e => setExcludeKeyword(e.target.value)} style={{ width: "100%", padding: "0.6rem", background: "#000", border: "1px solid #333", color: "white", borderRadius: "8px" }} placeholder="예: 휴가, 연차 (포함되어 있으면 수집 제외)" />
            </div>
          </div>
        </div>

        <div style={{ textAlign: "right" }}><button onClick={handleSearch} disabled={loading} className="btn-primary" style={{ padding: "0.7rem 3rem", fontWeight: "bold" }}>분석 실행</button></div>
      </div>

      {worklogs.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
            <div>
              <h2 style={{ marginBottom: "0.3rem" }}>📊 분석 결과</h2>
              <p style={{ fontSize: "0.85rem", color: "#666" }}>총 시간: <b style={{ color: "#10b981" }}>{totalHrs}h</b> | 총 인력: <b style={{ color: "#6366f1" }}>{totalMM} MM</b></p>
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              {(filterType || filterMonth || filterAuthor) && <button onClick={() => {setFilterType(null); setFilterMonth(null); setFilterAuthor(null);}} style={{ background: "none", border: "1px solid #ef4444", color: "#ef4444", padding: "0.4rem 1rem", borderRadius: "8px", cursor: "pointer" }}>초기화</button>}
              <button onClick={handleExport} className="btn-success" style={{ padding: "0.4rem 1.5rem" }}>엑셀 저장</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
            <div className="card">
              <h3 style={{ fontSize: "0.9rem", color: "#888", marginBottom: "1.5rem" }}>작업 유형별</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                {statsByType.map(s => {
                  const active = filterType === s.label;
                  const pct = ((s.seconds / (parseFloat(totalHrs) * 3600)) * 100).toFixed(1);
                  return (
                    <div key={s.label} onClick={() => setFilterType(active ? null : s.label)} style={{ cursor: "pointer", opacity: filterType && !active ? 0.3 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                        <span style={{ color: active ? "#6366f1" : "#ccc", fontWeight: active ? "bold" : "normal" }}>{s.label}</span>
                        <span style={{ color: "#10b981" }}>{s.hours}h ({s.mm} MM)</span>
                      </div>
                      <div style={{ height: "8px", background: "#0a0a0a", borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ height: "100%", background: active ? "#6366f1" : "linear-gradient(90deg, #6366f1, #10b981)", width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── 월별 추이 (그래프 가시성 개선) ── */}
            <div className="card">
              <h3 style={{ fontSize: "0.9rem", color: "#888", marginBottom: "1.5rem" }}>월별 추이 (MM)</h3>
              <div style={{ 
                height: "180px", 
                display: "flex", 
                alignItems: "flex-end", 
                justifyContent: "space-around",
                gap: "10px", 
                padding: "0 10px",
                borderBottom: "1px solid #2a2a3a"
              }}>
                {statsByMonth.map(s => {
                  const active = filterMonth === s.label;
                  const maxH = Math.max(...statsByMonth.map(x => parseFloat(x.hours) || 0), 1);
                  const val = parseFloat(s.hours) || 0;
                  const hPct = Math.round((val / maxH) * 100);
                  
                  return (
                    <div key={s.label} onClick={() => setFilterMonth(active ? null : s.label)} 
                      style={{ 
                        flex: 1, 
                        display: "flex", 
                        flexDirection: "column", 
                        alignItems: "center", 
                        cursor: "pointer", 
                        height: "100%",
                        justifyContent: "flex-end",
                        position: "relative"
                      }}>
                      {/* 수치 표시 (막대 위에 고정) */}
                      <div style={{ 
                        marginBottom: "8px",
                        fontSize: "0.75rem", 
                        color: "#10b981", 
                        fontWeight: "bold",
                        textAlign: "center"
                      }}>
                        {s.mm}
                      </div>
                      
                      {/* 실제 막대 그래프 */}
                      <div style={{ 
                        width: "36px", 
                        height: `${Math.max(hPct, 10)}%`, 
                        background: active ? "#6366f1" : "#3b82f6", 
                        borderRadius: "4px 4px 0 0",
                        boxShadow: "0 0 10px rgba(59, 130, 246, 0.4)",
                        transition: "background 0.3s"
                      }} />
                      
                      {/* 하단 라벨 */}
                      <div style={{ 
                        position: "absolute",
                        bottom: "-25px",
                        fontSize: "0.75rem", 
                        color: active ? "white" : "#666", 
                        fontWeight: active ? "bold" : "normal",
                        whiteSpace: "nowrap"
                      }}>
                        {s.label.split("-")[1]}월
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: "25px" }} /> {/* 라벨 공간 확보 */}
            </div>
          </div>

          <div className="card" style={{ marginBottom: "2rem" }}>
            <h3 style={{ fontSize: "0.9rem", color: "#888", marginBottom: "1.5rem" }}>작업자별 기여도 (월 1MM 기준)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
              {statsByUser.map(s => {
                const active = filterAuthor === s.label;
                const mmVal = parseFloat(s.mm) || 0;
                const pct = Math.min(mmVal * 100, 100);
                const isOver = mmVal > 1;
                return (
                  <div key={s.label} onClick={() => setFilterAuthor(active ? null : s.label)} style={{ padding: "1.2rem", borderRadius: "14px", background: active ? "rgba(99,102,241,0.15)" : "#0c0c0c", border: `1px solid ${active ? "#6366f1" : "#1a1a1a"}`, cursor: "pointer", opacity: filterAuthor && !active ? 0.3 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                      <span style={{ fontSize: "0.85rem", color: "#ccc", fontWeight: "bold" }}>{s.label}</span>
                      <span style={{ fontSize: "0.85rem", color: "#10b981", fontWeight: "bold" }}>{s.hours}h</span>
                    </div>
                    <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "white", marginBottom: "0.5rem" }}>
                      {s.mm} <span style={{fontSize:"0.75rem", color:"#888"}}>MM</span>
                    </div>
                    <div style={{ height: "6px", background: "#222", borderRadius: "3px", overflow: "hidden", display: "flex" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: isOver ? "linear-gradient(90deg, #6366f1, #ef4444)" : "linear-gradient(90deg, #3b82f6, #6366f1)", transition: "width 0.5s" }} />
                    </div>
                    <div style={{ textAlign: "right", fontSize: "0.7rem", color: "#666", marginTop: "4px" }}>
                      {(mmVal * 100).toFixed(1)}% 달성
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3>📋 상세 내역 ({filteredWorklogs.length}건 / {fTotalHrs}h / {fTotalMM} MM)</h3>
            <div className="table-wrapper">
              <table>
                <thead><tr>{AVAILABLE_COLUMNS.map(c => <th key={c.id} style={{ width: c.width }}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {filteredWorklogs.map((w, idx) => (
                    <tr key={idx}>
                      <td>{new Date(w.started).toLocaleDateString()}</td>
                      <td><a href={`${jiraHost}/browse/${w.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", fontWeight: "bold" }}>{w.issueKey}</a></td>
                      <td>{w.issueType}</td>
                      <td style={{ fontSize: "0.8rem", color: "#888" }}>{w.issueSummary}</td>
                      <td>{w.author}</td>
                      <td style={{ fontWeight: "bold", color: "#10b981" }}>{w.timeSpent}</td>
                      <td><span style={{ color: "#fbbf24", fontSize: "0.75rem", fontWeight: "bold" }}>{w.taskType}</span></td>
                      <td>{w.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
