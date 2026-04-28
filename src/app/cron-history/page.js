"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

export default function CronHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null); // { type: 'projectCode'|'workType'|'author', value: string }

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/worklog-results?limit=50");
        const data = await res.json();
        setHistory(data.results || []);
      } catch(e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleRowClick = (item) => {
    try {
      const parsedData = typeof item.report_data_json === "string" 
        ? JSON.parse(item.report_data_json) 
        : item.report_data_json;
      setSelectedItem({ ...item, data: parsedData });
      setActiveFilter(null); // 리포트 변경 시 필터 초기화
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error(e);
      alert("데이터 파싱 오류");
    }
  };

  // 상세 통계 계산
  const stats = useMemo(() => {
    if (!selectedItem || !selectedItem.data) return null;
    
    const rawLogs = Array.isArray(selectedItem.data) 
      ? selectedItem.data 
      : (selectedItem.data.monitorLogs || []);

    if (rawLogs.length === 0) return null;

    // 로그 전처리 (파싱 적용)
    const logs = rawLogs.map(log => {
      let pc = log.projectCode;
      let wt = log.workType;
      
      if (!pc || !wt) {
        const clean = (log.comment || "").trim();
        const sm = clean.match(/^([^/]+)\s*\/\s*([^/]+)(?:\s*\/[\s\S]*)?$/);
        const bm = clean.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]/);
        if (sm) { 
          pc = pc || sm[1].trim(); 
          wt = wt || sm[2].trim(); 
        } else if (bm) { 
          pc = pc || bm[1].trim(); 
          wt = wt || bm[2].trim(); 
        } else {
          const single = clean.match(/^\[([^\]]+)\]/);
          pc = pc || (single ? single[1].trim() : "미지정");
          wt = wt || "기타";
        }
      }
      return { ...log, projectCode: pc, workType: wt };
    });
    
    const pCodeMap = {};
    const wTypeMap = {};
    const userMap = {};
    let totalSec = 0;

    // 필터가 적용된 경우의 로그 필터링
    const filteredLogs = activeFilter ? logs.filter(log => {
      if (activeFilter.type === 'projectCode') {
        return (log.projectCode || "미지정") === activeFilter.value;
      }
      if (activeFilter.type === 'workType') {
        return (log.workType || "기타") === activeFilter.value;
      }
      if (activeFilter.type === 'author') {
        return log.author === activeFilter.value;
      }
      return true;
    }) : logs;

    logs.forEach(log => {
      const s = log.timeSpentSeconds || 0;
      totalSec += s;
      const hours = s / 3600;
      const pc = log.projectCode;
      const wt = log.workType;

      if (!pCodeMap[pc]) pCodeMap[pc] = { name: pc, totalHours: 0 };
      pCodeMap[pc].totalHours += hours;

      if (!wTypeMap[wt]) wTypeMap[wt] = { name: wt, totalHours: 0 };
      wTypeMap[wt].totalHours += hours;

      const au = log.author || "Unknown";
      if (!userMap[au]) userMap[au] = { name: au, totalHours: 0 };
      userMap[au].totalHours += hours;
    });

    // 렌더링용 사용자 통계
    const userStats = Object.keys(userMap).map(name => {
      const userLogs = filteredLogs.filter(l => l.author === name);
      const userHours = userLogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0) / 3600;
      return { name, totalHours: userMap[name].totalHours, filteredHours: userHours, logs: userLogs };
    }).sort((a, b) => b.totalHours - a.totalHours);

    const totalHours = totalSec / 3600;

    return {
      totalHours,
      projectCodeStats: Object.values(pCodeMap).sort((a, b) => b.totalHours - a.totalHours),
      workTypeStats: Object.values(wTypeMap).sort((a, b) => b.totalHours - a.totalHours),
      userStats,
      filteredLogs
    };
  }, [selectedItem, activeFilter]);

  const chartColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#a855f7"];

  // 도넛 차트 생성기
  const renderDonutChart = (data, valueKey, labelKey, type) => {
    if (!data || data.length === 0) return null;
    const total = data.reduce((acc, curr) => acc + curr[valueKey], 0);
    let currentPercent = 0;
    
    const segments = data.map((item, i) => {
      const start = currentPercent;
      const percent = (item[valueKey] / total) * 100;
      currentPercent += percent;
      return `${chartColors[i % chartColors.length]} ${start}% ${currentPercent}%`;
    }).join(", ");

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
        <div style={{ 
          width: "140px", height: "140px", borderRadius: "50%", 
          background: `conic-gradient(${segments})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
        }}>
          <div style={{ width: "90px", height: "90px", background: "var(--surface-color)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: "var(--text-secondary)" }}>{total.toFixed(0)}H</span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.5rem 1rem", fontSize: "0.75rem" }}>
          {data.map((item, i) => {
            const isActive = activeFilter?.type === type && activeFilter?.value === item[labelKey];
            return (
              <div 
                key={i} 
                onClick={() => setActiveFilter(isActive ? null : { type, value: item[labelKey] })}
                style={{ 
                  display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer",
                  padding: "4px 8px", borderRadius: "4px",
                  background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                  border: isActive ? `1px solid ${chartColors[i % chartColors.length]}` : "1px solid transparent"
                }}
              >
                <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: chartColors[i % chartColors.length] }}></div>
                <span style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>{item[labelKey]}</span>
                <span style={{ fontWeight: "bold" }}>{((item[valueKey] / total) * 100).toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 링크 변환 헬퍼 (이슈 키 및 URL)
  const linkify = (text) => {
    if (!text) return "";
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const issueRegex = /([A-Z0-9]+-\d+)/g;
    
    let parts = text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) {
        return <a key={`url-${i}`} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color)" }}>{part}</a>;
      }
      return part;
    });

    return parts.map(part => {
      if (typeof part !== "string") return part;
      const subparts = part.split(issueRegex);
      return subparts.map((sub, j) => {
        if (sub.match(issueRegex)) {
           // Jira Base URL은 동적으로 알 수 없으므로 우선 텍스트 강조만 하거나 검색 링크로 대체
           return <span key={`issue-${j}`} style={{ color: "var(--accent-color)", fontWeight: "bold" }}>{sub}</span>;
        }
        return sub;
      });
    });
  };

  return (
    <div className="dashboard">
      <div className="page-header">
         <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Link href="/" style={{ fontSize: "1.2rem", textDecoration: "none", color: "var(--text-secondary)" }}>&larr;</Link>
            <h1>🕰️ 스케줄 결과 히스토리</h1>
         </div>
        <p>크론 스케줄에 의해 자동 수집된 과거 리포트 내역을 확인합니다.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selectedItem ? "350px 1fr" : "1fr", gap: "1.5rem", alignItems: "start" }}>
        
        {/* 왼쪽: 목록 */}
        <div className="card" style={{ padding: "1.2rem", overflowX: "auto" }}>
           <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--text-primary)" }}>📜 리포트 목록</h2>
           {loading ? (
             <div className="loading">데이터 로딩 중...</div>
           ) : history.length > 0 ? (
             <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
               <thead>
                 <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                   <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>대상 일자</th>
                   <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>유형</th>
                   <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>시간</th>
                 </tr>
               </thead>
               <tbody>
                 {history.map(row => (
                   <tr 
                    key={row.id} 
                    onClick={() => handleRowClick(row)}
                    style={{ 
                      borderBottom: "1px solid rgba(255,255,255,0.05)", 
                      cursor: "pointer",
                      background: selectedItem?.id === row.id ? "rgba(255,255,255,0.05)" : "transparent"
                    }}
                    className="history-row"
                   >
                     <td style={{ padding: "0.75rem", fontWeight: "600" }}>{row.target_date}</td>
                     <td style={{ padding: "0.75rem" }}>
                       <span style={{ 
                          background: row.report_type === 'daily' ? "rgba(16, 185, 129, 0.15)" : "rgba(59, 130, 246, 0.15)", 
                          color: row.report_type === 'daily' ? "#10b981" : "#3b82f6",
                          padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem"
                       }}>
                          {row.report_type}
                       </span>
                     </td>
                     <td style={{ padding: "0.75rem", color: "var(--accent-color)", fontWeight: "bold" }}>{row.total_hours}H</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           ) : (
             <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)" }}>리포트 없음</div>
           )}
        </div>

        {/* 오른쪽: 상세 보고서 */}
        {selectedItem ? (
          <div className="card" style={{ padding: "2rem", background: "var(--surface-color)", border: "1px solid var(--accent-color)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid rgba(255,255,255,0.1)", paddingBottom: "1.5rem", marginBottom: "2rem" }}>
              <div>
                <h2 style={{ fontSize: "1.5rem", color: "var(--accent-color)", marginBottom: "0.5rem" }}>
                  📊 {selectedItem.target_date} 작업 리포트
                </h2>
                <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                  생성일시: {new Date(selectedItem.created_at).toLocaleString()} | 유형: {selectedItem.report_type.toUpperCase()}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: "2rem", fontWeight: "bold", color: "var(--text-primary)" }}>{selectedItem.total_hours}</span>
                <span style={{ fontSize: "1rem", color: "var(--text-secondary)", marginLeft: "0.3rem" }}>Total Hours</span>
              </div>
            </div>

            {/* 통계 섹션 (시각화 차트) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
               {/* 프로젝트 코드별 (도넛) */}
               <div style={{ background: "rgba(255,255,255,0.02)", padding: "1.5rem", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <h3 style={{ fontSize: "1rem", marginBottom: "1.5rem", color: "var(--text-primary)", textAlign: "center", fontWeight: "600" }}>🏷️ 프로젝트 코드별</h3>
                  {renderDonutChart(stats?.projectCodeStats, "totalHours", "name", "projectCode")}
               </div>

               {/* 작업 유형별 (도넛) */}
               <div style={{ background: "rgba(255,255,255,0.02)", padding: "1.5rem", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <h3 style={{ fontSize: "1rem", marginBottom: "1.5rem", color: "var(--text-primary)", textAlign: "center", fontWeight: "600" }}>🛠️ 작업 유형별</h3>
                  {renderDonutChart(stats?.workTypeStats, "totalHours", "name", "workType")}
               </div>
            </div>

            {/* 개인별 합계 (카드 그리드) */}
            <div style={{ background: "rgba(255,255,255,0.02)", padding: "1.5rem", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.05)", marginBottom: "3.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
                  <h3 style={{ fontSize: "1rem", color: "var(--text-primary)", fontWeight: "600" }}>🧑‍💻 개인별 실적 (8H 기준)</h3>
                  {/* 범례 추가 */}
                  <div style={{ display: "flex", gap: "0.8rem", fontSize: "0.7rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }}></div> 매우부족</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b" }}></div> 부족</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981" }}></div> 보통</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#3b82f6" }}></div> 많음</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#8b5cf6" }}></div> 매우많음</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem" }}>
                  {stats?.userStats.map((s, i) => {
                    const rawPercent = (s.totalHours / 8) * 100;
                    const userPercent = Math.min(100, rawPercent);
                    const isActive = activeFilter?.type === 'author' && activeFilter?.value === s.name;
                    
                    // 5단계 색상 및 라벨 로직
                    let color = "#10b981"; // 보통 (기본)
                    let level = "보통";
                    if (rawPercent < 50) { color = "#ef4444"; level = "매우부족"; }
                    else if (rawPercent < 80) { color = "#f59e0b"; level = "부족"; }
                    else if (rawPercent <= 105) { color = "#10b981"; level = "보통"; }
                    else if (rawPercent <= 130) { color = "#3b82f6"; level = "많음"; }
                    else { color = "#8b5cf6"; level = "매우많음"; }

                    return (
                      <div 
                        key={i} 
                        onClick={() => setActiveFilter(isActive ? null : { type: 'author', value: s.name })}
                        style={{ 
                          background: isActive ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)", 
                          border: isActive ? `2px solid ${color}` : "1px solid rgba(255,255,255,0.05)", 
                          borderRadius: "12px", 
                          padding: "1rem", 
                          display: "flex", 
                          alignItems: "center", 
                          gap: "1rem",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          position: "relative",
                          overflow: "hidden"
                        }}
                      >
                        {/* 배경에 살짝 색상 기운 */}
                        <div style={{ position: "absolute", top: 0, right: 0, width: "30%", height: "100%", background: `linear-gradient(90deg, transparent, ${color}11)`, zIndex: 0 }}></div>

                        <div style={{ 
                          width: "44px", 
                          height: "44px", 
                          borderRadius: "50%", 
                          background: `conic-gradient(${color} 0% ${userPercent}%, rgba(255,255,255,0.05) ${userPercent}% 100%)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          zIndex: 1
                        }}>
                          <div style={{ width: "34px", height: "34px", background: "var(--surface-color)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                             <span style={{ fontSize: "0.65rem", fontWeight: "bold", color: "var(--text-primary)" }}>{rawPercent.toFixed(0)}%</span>
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, zIndex: 1 }}>
                          <span style={{ fontSize: "0.9rem", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>{s.name}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                             <span style={{ fontSize: "0.85rem", color: color, fontWeight: "800" }}>{s.totalHours.toFixed(1)} H</span>
                             <span style={{ fontSize: "0.6rem", padding: "1px 4px", borderRadius: "3px", background: `${color}22`, color: color, fontWeight: "600" }}>{level}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
            </div>

            {/* 상세 목록 섹션 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                📝 상세 작업 내역 목록 {activeFilter && <span style={{ fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: "normal" }}>(필터링 됨: {activeFilter.value})</span>}
              </h3>
              {activeFilter && (
                <button 
                  onClick={() => setActiveFilter(null)}
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-secondary)", padding: "4px 12px", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer" }}
                >
                  필터 해제
                </button>
              )}
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              {stats?.userStats.filter(u => u.logs.length > 0).map((u, i) => (
                <div key={i} style={{ borderLeft: "4px solid var(--accent-color)", paddingLeft: "1.5rem" }}>
                  <h4 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--text-primary)" }}>
                    {u.name} <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: "normal" }}>({activeFilter ? `${u.filteredHours.toFixed(1)} / ` : ""}{u.totalHours.toFixed(1)} H)</span>
                  </h4>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                        <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "120px" }}>이슈 키</th>
                        <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "80px" }}>시간</th>
                        <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>작업 내용 (Comment)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {u.logs.map((log, li) => (
                        <tr key={li} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "0.75rem", fontWeight: "bold" }}>{log.issueKey}</td>
                          <td style={{ padding: "0.75rem" }}>{log.timeSpent}</td>
                          <td style={{ padding: "1rem 0.75rem", lineHeight: "1.6", color: "var(--text-secondary)", whiteSpace: "pre-wrap", verticalAlign: "top" }}>
                            {linkify(log.comment)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {stats?.userStats.filter(u => u.logs.length > 0).length === 0 && (
                <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-secondary)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: "12px" }}>
                  필터 조건에 맞는 데이터가 없습니다.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: "4rem", textAlign: "center", color: "var(--text-secondary)", background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.1)" }}>
             <span style={{ fontSize: "3rem" }}>👈</span>
             <h3 style={{ marginTop: "1rem" }}>왼쪽 목록에서 리포트를 선택해 주세요.</h3>
             <p>선택 시 프로젝트별, 유형별 통계와 상세 내역이 표시됩니다.</p>
          </div>
        )}

      </div>

      <style jsx>{`
        .history-row:hover {
          background: rgba(255,255,255,0.03) !important;
        }
      `}</style>
    </div>
  );
}
