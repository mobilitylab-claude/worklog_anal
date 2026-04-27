"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

export default function WorklogInput() {
  const router = useRouter();

  // ── DB 데이터 ────────────────────────────────────────────────
  const [projectCodes, setProjectCodes] = useState([]);
  const [workTypes,    setWorkTypes]    = useState([]);
  const [dbLoading,    setDbLoading]    = useState(true);

  // ── 폼 상태 ──────────────────────────────────────────────────
  const [issueKey,     setIssueKey]     = useState("");
  const [projectCode,  setProjectCode]  = useState("");
  const [selectedType, setSelectedType] = useState(null); // 선택된 작업 유형 객체
  const [selectedKw,   setSelectedKw]   = useState("");   // 선택된 분류 키워드
  const [workDate,     setWorkDate]     = useState(new Date().toISOString().split("T")[0]);
  const [actualHours,  setActualHours]  = useState(4);
  const [isScaleUp,    setIsScaleUp]    = useState(true);
  const [comment,      setComment]      = useState("");

  // ── 데이터 로드 ───────────────────────────────────────────────
  const fetchDbData = async () => {
    try {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/standards/projects"),
        fetch("/api/standards/work-types")
      ]);
      const pData = await pRes.json();
      const tData = await tRes.json();
      
      const projs = pData.projects || [];
      const types = tData.types || [];
      
      setProjectCodes(projs);
      setWorkTypes(types);
      
      if (projs.length > 0) setProjectCode(projs[0].code);
      if (types.length > 0) {
        setSelectedType(types[0]);
        if (types[0].keywords?.length > 0) setSelectedKw(types[0].keywords[0]);
      }
    } catch (e) {
      console.error("기준 정보 로드 실패:", e);
    } finally {
      setDbLoading(false);
    }
  };

  useEffect(() => {
    fetchDbData();
  }, []);

  // 유형 변경 시 키워드 자동 초기화
  const handleTypeChange = (typeId) => {
    const type = workTypes.find(t => t.id === parseInt(typeId));
    setSelectedType(type);
    if (type?.keywords?.length > 0) {
      setSelectedKw(type.keywords[0]);
    } else {
      setSelectedKw("");
    }
  };

  // ── Jira 연동 상태 ──────────────────────────────────────────
  const [loading,     setLoading]     = useState(false);
  const [searchKey,    setSearchKey]    = useState("");
  const [recentIssues, setRecentIssues] = useState([]); // [{ key, summary, totalHours }]
  const [todayTotal,   setTodayTotal]   = useState(0);    // 오늘 전체 등록 공수(h)
  const [searching,     setSearching]     = useState(false);

  // ── 권장 시간 계산 (1.25배 Scale-up) ───────────────────────────
  const recommendedHours = useMemo(() => {
    const val = parseFloat(actualHours) || 0;
    return isScaleUp ? (val * 1.25).toFixed(1) : val.toString();
  }, [actualHours, isScaleUp]);

  // ── 최종 포맷 미리보기 ─────────────────────────────────────────
  // 형식: 계약과제 코드 / 분류 키워드 / 작업 내용 (대괄호 및 이슈번호 제외)
  const finalComment = useMemo(() => {
    const prefix = `${projectCode} / ${selectedKw || "키워드"} / `;
    return `${prefix}${comment}`;
  }, [projectCode, selectedKw, comment]);

  // ── 최근 이슈 로드 (분석 기능을 통해 간접적으로 가져옴) ──────────
  const loadRecentIssues = async () => {
    setSearching(true);
    try {
      const todayStr = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0], // 최근 30일
          endDate: todayStr,
          targetType: "me",
        }),
      });
      const data = await res.json();
      if (data.worklogs) {
        const logs = data.worklogs;
        
        // 1. 오늘 총 시간 계산
        const todayLogs = logs.filter(l => l.started.startsWith(todayStr));
        const todayHrs = todayLogs.reduce((sum, l) => sum + (l.timeSpentSeconds || 0), 0) / 3600;
        setTodayTotal(todayHrs);

        // 2. 최근 이슈별 요약 및 누적 시간 계산
        const issueMap = {};
        logs.forEach(l => {
          if (!issueMap[l.issueKey]) {
            issueMap[l.issueKey] = { 
              key: l.issueKey, 
              summary: l.issueSummary, 
              totalSeconds: 0 
            };
          }
          issueMap[l.issueKey].totalSeconds += (l.timeSpentSeconds || 0);
        });

        // 최근 작업 순으로 정렬 (가장 최근 로그가 있는 이슈가 위로)
        const sortedKeys = Array.from(new Set(logs.map(l => l.issueKey))).slice(0, 10);
        const processedIssues = sortedKeys.map(key => ({
          ...issueMap[key],
          totalHours: (issueMap[key].totalSeconds / 3600).toFixed(1)
        }));

        setRecentIssues(processedIssues);
      }
    } catch (e) {
      console.error("이슈 조회 실패:", e);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => { loadRecentIssues(); }, []);

  // ── 등록 실행 ────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!issueKey) { alert("이슈 번호를 입력하거나 선택해주세요."); return; }
    if (!comment.trim()) { alert("작업 내용을 문장 형태로 입력해주세요."); return; }

    const timeInSec = Math.round(parseFloat(recommendedHours) * 3600);
    if (timeInSec <= 0) { alert("시간을 입력해주세요."); return; }

    setLoading(true);
    try {
      // Jira API는 ISO 형식을 기대 (로컬 시간 기준)
      const started = `${workDate}T09:00:00.000+0900`;

      const res = await fetch("/api/worklogs/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueKey,
          started,
          timeSpentSeconds: timeInSec,
          comment: finalComment,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "등록 실패");

      alert("✅ Jira에 공수 등록 완료!");
      // 폼 초기화 혹은 분석 페이지로 이동
      setComment("");
      router.push("/worklog");
    } catch (err) {
      alert("❌ 등록 실패: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: "2rem" }}>
        <h1>표준 공수 입력 (MOBIS)</h1>
        <p>Confluence 가이드라인에 따른 표준 프로젝트 정보와 작업 유형을 조합하여 공수를 등록합니다.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "2rem" }}>
        {/* 입력 카드 */}
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1.5rem" }}>✏️ 작업 기록 작성</h2>

          {/* 1. 이슈 선택 (최근 작업 내역 기반) */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>
              01. 대상 이슈 선택 (최근 30일 이내 작업한 이슈목록)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", padding: "1rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid #222" }}>
              {recentIssues.length === 0 && !searching && (
                <span style={{ fontSize: "0.8rem", color: "#555" }}>최근 작업한 이슈가 없습니다.</span>
              )}
              {searching && (
                <span style={{ fontSize: "0.8rem", color: "#555" }}>조회 중...</span>
              )}
              {recentIssues.map(issue => (
                <button key={issue.key} 
                  onClick={() => setIssueKey(issue.key)}
                  style={{ 
                    cursor: "pointer", fontSize: "0.75rem", padding: "4px 10px", 
                    background: issueKey === issue.key ? "var(--accent-color)" : "#1a1a2e", 
                    border: `1px solid ${issueKey === issue.key ? "var(--accent-color)" : "#333"}`, 
                    borderRadius: "6px", color: issueKey === issue.key ? "white" : "#ccc",
                    transition: "all 0.2s"
                  }}>
                  {issue.key}
                </button>
              ))}
            </div>
            {issueKey && (() => {
              const selected = recentIssues.find(i => i.key === issueKey);
              return (
                <div style={{ marginTop: "0.75rem", padding: "0.8rem", background: "rgba(59,130,246,0.08)", borderRadius: "8px", borderLeft: "4px solid var(--accent-color)" }}>
                  <div style={{ fontSize: "0.85rem", color: "white", fontWeight: "bold", marginBottom: "0.2rem" }}>
                    {selected ? selected.summary : "이슈 상세 정보를 불러올 수 없습니다."}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {selected && `🕒 최근 30일 누적 공수: ${selected.totalHours}h`}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 2. 과제 및 유형 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>02. 계약과제 코드</label>
              <select value={projectCode} onChange={e => setProjectCode(e.target.value)}
                style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }}>
                {projectCodes.map(p => <option key={p.id} value={p.code}>{p.code} ({p.name})</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>03. 작업 유형</label>
              <select value={selectedType?.id || ""} onChange={e => handleTypeChange(e.target.value)}
                style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }}>
                {workTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {/* 2.1 분류 키워드 선택 (추가됨) */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--accent-color)" }}>03-1. 분류 키워드 선택 (실제 입력값)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {(selectedType?.keywords || []).map(kw => (
                <button key={kw} 
                  onClick={() => setSelectedKw(kw)}
                  style={{ 
                    padding: "4px 12px", borderRadius: "16px", fontSize: "0.8rem", cursor: "pointer",
                    background: selectedKw === kw ? "var(--accent-color)" : "#222",
                    color: selectedKw === kw ? "white" : "#888",
                    border: `1px solid ${selectedKw === kw ? "var(--accent-color)" : "#444"}`
                  }}>
                  {kw}
                </button>
              ))}
              {(selectedType?.keywords || []).length === 0 && (
                <span style={{ fontSize: "0.8rem", color: "#555" }}>등록된 분류 키워드가 없습니다.</span>
              )}
            </div>
            {selectedType?.content && (
              <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#666" }}>💡 가이드: {selectedType.content}</p>
            )}
          </div>

          {/* 3. 시간 및 날짜 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>04. 날짜</label>
              <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)}
                style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>05. 실제 시간(h)</label>
              <input type="number" step="0.5" value={actualHours} onChange={e => setActualHours(e.target.value)}
                style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>06. 등록 시간(h)</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: 1 }}>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--accent-color)" }}>{recommendedHours}h</span>
                <label style={{ fontSize: "0.75rem", color: "#666", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <input type="checkbox" checked={isScaleUp} onChange={e => setIsScaleUp(e.target.checked)} /> 1.25x UP
                </label>
              </div>
              <div style={{ fontSize: "0.7rem", color: todayTotal >= 8 ? "#10b981" : "#f97316", marginTop: "2px" }}>
                🎯 오늘 총 등록: {todayTotal.toFixed(1)}h / 8h
              </div>
            </div>
          </div>

          {/* 4. 작업 내용 */}
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#888" }}>07. 작업 상세 내용 (최소 1문장 이상)</label>
            <textarea 
              value={comment} 
              onChange={e => setComment(e.target.value)}
              placeholder="구체적인 작업 영용을 입력하세요 (예: ccNC 음성인식 엔진 로그 분석 및 이슈 대응)"
              style={{ width: "100%", height: "100px", padding: "0.8rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white", outline: "none" }}
            />
          </div>

          <button onClick={handleSubmit} disabled={loading} className="btn-primary" 
            style={{ width: "100%", padding: "1rem", fontSize: "1rem", fontWeight: "bold", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Jira에 등록 중..." : "🚀 공수 등록 (Jira 공식 전송)"}
          </button>
        </div>

        {/* 안내 카드 */}
        <div>
          <div className="card" style={{ marginBottom: "1.5rem", background: "rgba(59,130,246,0.05)" }}>
            <h3 style={{ fontSize: "0.9rem", color: "var(--accent-color)", marginBottom: "1rem" }}>📋 실시간 포맷 검수</h3>
            <div style={{ fontSize: "0.82rem", background: "#050508", padding: "1rem", borderRadius: "8px", border: "1px dashed #2a2a3a", color: "#aaa", fontFamily: "monospace", wordBreak: "break-all" }}>
              <div style={{ marginBottom: "0.4rem", color: "#555" }}>Jira 공수 로그 코멘트:</div>
              <span style={{ color: "#34d399" }}>{finalComment}</span>
            </div>
          </div>

          <div className="card" style={{ fontSize: "0.85rem", color: "#888" }}>
            <h3 style={{ fontSize: "0.9rem", color: "white", marginBottom: "0.75rem" }}>💡 입력 가이드</h3>
            <ul style={{ paddingLeft: "1.25rem", lineHeight: "1.6" }}>
              <li><strong>포맷준수:</strong> 계약과제 / 분류키워드 / 작업내용</li>
              <li><strong>표준유형:</strong> <code>pr</code>(개발), <code>meeting</code>(회의), <code>review</code>(분석) 등</li>
              <li><strong>공수원칙:</strong> 실제 시간 대비 약 1.25배 scale-up (일일 총 8~11h 권장)</li>
              <li><strong>Daily 원칙:</strong> 그날 작업은 그날 바로 등록하세요.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
