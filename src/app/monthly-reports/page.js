"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";

export default function MonthlyReportsArchive() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);
  
  // 페이징 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const offset = (currentPage - 1) * pageSize;
      const res = await fetch(`/api/monthly-reports?limit=${pageSize}&offset=${offset}`, { cache: 'no-store' });
      const data = await res.json();
      setReports(data.reports || []);
      setTotalCount(data.total || 0);
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [currentPage, pageSize]);

  const handleRowClick = (item) => {
    try {
      const parsedData = typeof item.report_data_json === "string" 
        ? JSON.parse(item.report_data_json) 
        : item.report_data_json;
      setSelectedItem({ ...item, data: parsedData });
      setActiveFilter(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error(e);
      alert("데이터 파싱 오류");
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm("정말 이 리포트를 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/monthly-reports?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedItem?.id === id) setSelectedItem(null);
        fetchReports();
      } else {
        const data = await res.json();
        alert("삭제 실패: " + (data.error || "알 수 없는 오류"));
      }
    } catch (e) {
      console.error(e);
      alert("삭제 중 오류 발생");
    }
  };

  const handleExport = (report) => {
    try {
      const data = typeof report.report_data_json === "string" 
        ? JSON.parse(report.report_data_json) 
        : report.report_data_json;
      
      const logs = Array.isArray(data) ? data : (data.monitorLogs || []);
      
      if (logs.length === 0) {
        alert("출력할 작업기록 데이터가 없습니다."); return;
      }

      const calculateMM = (hrs) => (hrs / 8 / 20.5).toFixed(3);

      const wb = XLSX.utils.book_new();
      const detail = logs.map(w => ({
        "날짜": new Date(w.started || w.created).toLocaleDateString(),
        "이슈": w.issueKey,
        "요약": w.issueSummary || w.summary,
        "작업자": w.author,
        "시간(h)": w.timeSpent || (w.timeSpentSeconds / 3600).toFixed(1),
        "MM": calculateMM(w.timeSpentSeconds/3600),
        "유형": w.workType || w.taskType || "기타",
        "내용": w.comment
      }));

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "작업상세");
      XLSX.writeFile(wb, `Monthly_Report_${report.project_code}_${report.report_month}.xlsx`);
    } catch (e) {
      alert("엑셀 저장 실패: " + e.message);
    }
  };

  // 상세 통계 계산
  const stats = useMemo(() => {
    if (!selectedItem || !selectedItem.data) return null;
    
    const rawLogs = Array.isArray(selectedItem.data) 
      ? selectedItem.data 
      : (selectedItem.data.monitorLogs || []);

    if (rawLogs.length === 0) return null;

    const logs = rawLogs.map(log => {
      let pc = log.projectCode;
      let wt = log.workType || log.taskType;
      
      if (!pc || !wt) {
        const clean = (log.comment || "").trim();
        const sm = clean.match(/^([^/]+)\s*\/\s*([^/]+)(?:\s*\/[\s\S]*)?$/);
        const bm = clean.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]/);
        if (sm) { pc = pc || sm[1].trim(); wt = wt || sm[2].trim(); }
        else if (bm) { pc = pc || bm[1].trim(); wt = wt || bm[2].trim(); }
        else {
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

    const filteredLogs = activeFilter ? logs.filter(log => {
      if (activeFilter.type === 'projectCode') return (log.projectCode || "미지정") === activeFilter.value;
      if (activeFilter.type === 'workType') return (log.workType || "기타") === activeFilter.value;
      if (activeFilter.type === 'author') return log.author === activeFilter.value;
      return true;
    }) : logs;

    logs.forEach(log => {
      const s = log.timeSpentSeconds || 0;
      totalSec += s;
      const hours = s / 3600;
      const pc = log.projectCode;
      const wt = log.workType;
      const au = log.author || "Unknown";

      if (!pCodeMap[pc]) pCodeMap[pc] = { name: pc, totalHours: 0 };
      pCodeMap[pc].totalHours += hours;

      if (!wTypeMap[wt]) wTypeMap[wt] = { name: wt, totalHours: 0 };
      wTypeMap[wt].totalHours += hours;

      if (!userMap[au]) userMap[au] = { name: au, totalHours: 0 };
      userMap[au].totalHours += hours;
    });

    const userStats = Object.keys(userMap).map(name => {
      const userLogs = filteredLogs.filter(l => l.author === name);
      const userHours = userLogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0) / 3600;
      return { name, totalHours: userMap[name].totalHours, filteredHours: userHours, logs: userLogs };
    }).sort((a, b) => b.totalHours - a.totalHours);

    const issueStatusAnalysis = { overdueEstimate: [], overdueDeadline: [] };
    const todayStr = new Date().toISOString().split("T")[0];
    const uniqueIssuesMap = {};

    filteredLogs.forEach(w => {
      if (!uniqueIssuesMap[w.issueKey]) {
        uniqueIssuesMap[w.issueKey] = {
          issueKey: w.issueKey,
          issueSummary: w.issueSummary,
          issueStatus: w.issueStatus || "Unknown",
          author: w.author,
          originalEstimateSeconds: w.originalEstimateSeconds || 0,
          issueTimeSpentSeconds: w.issueTimeSpentSeconds || 0,
          originalEstimateStr: w.originalEstimateStr || "-",
          issueTimeSpentStr: w.issueTimeSpentStr || "-",
          dueDate: w.dueDate || "-"
        };
      } else {
        uniqueIssuesMap[w.issueKey].issueTimeSpentSeconds = Math.max(uniqueIssuesMap[w.issueKey].issueTimeSpentSeconds, w.issueTimeSpentSeconds || 0);
      }
    });

    Object.values(uniqueIssuesMap).forEach(issue => {
      const isDone = ["Done", "완료", "Resolved", "Closed", "종료"].includes(issue.issueStatus);
      if (!isDone) {
        if (issue.originalEstimateSeconds > 0 && issue.issueTimeSpentSeconds > issue.originalEstimateSeconds) {
          issueStatusAnalysis.overdueEstimate.push(issue);
        }
        if (issue.dueDate !== "-" && issue.dueDate < todayStr) {
          issueStatusAnalysis.overdueDeadline.push(issue);
        }
      }
    });

    return {
      totalHours: totalSec / 3600,
      projectCodeStats: Object.values(pCodeMap).sort((a, b) => b.totalHours - a.totalHours),
      workTypeStats: Object.values(wTypeMap).sort((a, b) => b.totalHours - a.totalHours),
      userStats,
      filteredLogs,
      issueStatusAnalysis
    };
  }, [selectedItem, activeFilter]);

  const chartColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#a855f7"];

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

  const linkify = (text) => {
    if (!text) return "";
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const issueRegex = /([A-Z0-9]+-\d+)/g;
    let parts = text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) return <a key={`url-${i}`} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color)" }}>{part}</a>;
      return part;
    });
    return parts.map(part => {
      if (typeof part !== "string") return part;
      const subparts = part.split(issueRegex);
      return subparts.map((sub, j) => {
        if (sub.match(issueRegex)) return <span key={`issue-${j}`} style={{ color: "var(--accent-color)", fontWeight: "bold" }}>{sub}</span>;
        return sub;
      });
    });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    } catch (e) {
      return dateStr;
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="dashboard" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <div className="page-header">
         <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Link href="/" style={{ fontSize: "1.2rem", textDecoration: "none", color: "var(--text-secondary)" }}>&larr;</Link>
            <h1>📑 월간 리포트 보관함</h1>
         </div>
        <p>프로젝트별로 생성된 월간 분석 리포트를 확인하고 다운로드합니다.</p>
      </div>

      <div className="history-grid">
        
        {/* 왼쪽: 목록 */}
        <div className="card list-card" style={{ padding: "1.2rem", display: "flex", flexDirection: "column", gap: "1rem", minHeight: "500px" }}>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
             <h2 style={{ fontSize: "1.1rem", color: "var(--text-primary)" }}>📜 리포트 목록</h2>
             <select 
               value={pageSize} 
               onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
               style={{ background: "var(--bg-color)", border: "1px solid var(--border-color)", color: "var(--text-primary)", fontSize: "0.75rem", padding: "2px 4px", borderRadius: "4px" }}
             >
               <option value={10}>10개씩</option>
               <option value={20}>20개씩</option>
               <option value={30}>30개씩</option>
               <option value={50}>50개씩</option>
             </select>
           </div>

           <div style={{ flex: 1, overflowX: "auto" }}>
             {loading ? (
               <div className="loading">데이터 로딩 중...</div>
             ) : reports.length > 0 ? (
               <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: "300px" }}>
                 <thead>
                   <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                     <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>프로젝트 / 월</th>
                     <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>시간</th>
                     <th style={{ padding: "0.5rem", width: "30px" }}></th>
                   </tr>
                 </thead>
                 <tbody>
                   {reports.map(row => (
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
                       <td style={{ padding: "0.75rem" }}>
                         <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>{row.project_name}</div>
                         <div style={{ fontSize: "0.7rem", color: "var(--accent-color)" }}>{row.report_month}</div>
                       </td>
                       <td style={{ padding: "0.75rem" }}>
                         <div style={{ fontWeight: "bold", color: "var(--text-primary)" }}>{row.total_hours}H</div>
                         <div style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>{row.total_mm}MM</div>
                       </td>
                       <td style={{ padding: "0.75rem", textAlign: "right" }}>
                         <button 
                          onClick={(e) => handleDelete(e, row.id)}
                          style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "1rem", opacity: 0.6 }}
                         >
                           🗑️
                         </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             ) : (
               <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)" }}>리포트 없음</div>
             )}
           </div>

           {/* 페이징 컨트롤 */}
           {totalPages > 1 && (
             <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: "4px 8px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: currentPage === 1 ? "default" : "pointer", opacity: currentPage === 1 ? 0.3 : 1 }}>&larr;</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setCurrentPage(p)} style={{ padding: "4px 8px", background: currentPage === p ? "var(--accent-color)" : "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: currentPage === p ? "white" : "var(--text-primary)", borderRadius: "4px", cursor: "pointer" }}>{p}</button>
                )).slice(Math.max(0, currentPage - 3), Math.min(totalPages, currentPage + 2))}
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: "4px 8px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: currentPage === totalPages ? "default" : "pointer", opacity: currentPage === totalPages ? 0.3 : 1 }}>&rarr;</button>
             </div>
           )}
        </div>

        {/* 오른쪽: 상세 보고서 */}
        <div className="detail-container">
          {selectedItem ? (
            <div className="card detail-card" style={{ padding: "2rem", background: "var(--surface-color)", border: "1px solid var(--accent-color)", minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid rgba(255,255,255,0.1)", paddingBottom: "1.5rem", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h2 style={{ fontSize: "1.5rem", color: "var(--accent-color)", marginBottom: "0.5rem" }}>
                    📊 {selectedItem.project_name} ({selectedItem.report_month})
                  </h2>
                  <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                    생성일시: {new Date(selectedItem.created_at).toLocaleString()} | 대상기간: {selectedItem.target_period}
                  </p>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <span style={{ fontSize: "2rem", fontWeight: "bold", color: "var(--text-primary)" }}>{selectedItem.total_hours}</span>
                    <span style={{ fontSize: "1rem", color: "var(--text-secondary)", marginLeft: "0.3rem" }}>H</span>
                    <span style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#fbbf24", marginLeft: "1rem" }}>{selectedItem.total_mm}</span>
                    <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginLeft: "0.2rem" }}>MM</span>
                  </div>
                  <button onClick={() => handleExport(selectedItem)} className="btn-success" style={{ padding: "6px 12px", fontSize: "0.85rem" }}>Excel 다운로드</button>
                </div>
              </div>

              {/* 통계 섹션 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem", marginBottom: "1.5rem" }}>
                 <div className="summary-item">
                    <h3 style={{ fontSize: "1rem", marginBottom: "1.5rem", color: "var(--text-primary)", textAlign: "center", fontWeight: "600" }}>🏷️ 프로젝트 코드별</h3>
                    {renderDonutChart(stats?.projectCodeStats, "totalHours", "name", "projectCode")}
                 </div>
                 <div className="summary-item">
                    <h3 style={{ fontSize: "1rem", marginBottom: "1.5rem", color: "var(--text-primary)", textAlign: "center", fontWeight: "600" }}>🛠️ 작업 유형별</h3>
                    {renderDonutChart(stats?.workTypeStats, "totalHours", "name", "workType")}
                 </div>
              </div>

              {/* 개인별 합계 */}
              <div className="summary-item" style={{ marginBottom: "3.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem", flexWrap: "wrap", gap: "1rem" }}>
                    <h3 style={{ fontSize: "1rem", color: "var(--text-primary)", fontWeight: "600" }}>🧑‍💻 개인별 실적 (MM 기준)</h3>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "1rem" }}>
                    {stats?.userStats.map((s, i) => {
                      const isActive = activeFilter?.type === 'author' && activeFilter?.value === s.name;
                      const mmValue = s.totalHours / 8 / 20.5;
                      const userPercent = Math.min(100, (s.totalHours / (8 * 20.5)) * 100);

                      return (
                        <div key={i} onClick={() => setActiveFilter(isActive ? null : { type: 'author', value: s.name })}
                          style={{ background: isActive ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)", border: isActive ? `2px solid var(--accent-color)` : "1px solid rgba(255,255,255,0.05)", borderRadius: "12px", padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem", cursor: "pointer", position: "relative", overflow: "hidden" }}>
                          <div style={{ position: "absolute", top: 0, right: 0, width: "30%", height: "100%", background: `linear-gradient(90deg, transparent, var(--accent-color)11)`, zIndex: 0 }}></div>
                          <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: `conic-gradient(var(--accent-color) 0% ${userPercent}%, rgba(255,255,255,0.05) ${userPercent}% 100%)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>
                            <div style={{ width: "30px", height: "30px", background: "var(--surface-color)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                               <span style={{ fontSize: "0.6rem", fontWeight: "bold", color: "var(--text-primary)" }}>{mmValue.toFixed(2)}</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, zIndex: 1 }}>
                            <span style={{ fontSize: "0.85rem", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-primary)" }}>{s.name}</span>
                            <span style={{ fontSize: "0.8rem", color: "var(--accent-color)", fontWeight: "800" }}>{mmValue.toFixed(3)} MM</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
              </div>

              {/* ── 예상 시간 및 기한 초과 이슈 ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem", marginBottom: "3.5rem" }}>
                {/* 예상 시간 초과 */}
                <div className="summary-item" style={{ marginBottom: 0 }}>
                  <h3 style={{ fontSize: "1rem", color: "var(--text-primary)", fontWeight: "600", marginBottom: "1rem" }}>⏳ 예상 시간 초과 이슈 <span style={{ fontSize: "0.75rem", color: "#f87171" }}>(누적시간 &gt; 예상시간)</span></h3>
                  <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", padding: "1rem", maxHeight: "250px", overflowY: "auto" }}>
                    {stats?.issueStatusAnalysis?.overdueEstimate?.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#e5e7eb", fontSize: "0.8rem" }}>
                        {stats.issueStatusAnalysis.overdueEstimate.map((i, idx) => (
                          <li key={idx} style={{ marginBottom: "0.5rem" }}>
                            <span style={{ color: "#60a5fa", fontWeight: "bold" }}>{i.issueKey}</span>
                            <span style={{ color: "#9ca3af", marginLeft: "0.3rem" }}>{i.issueSummary} ({i.author})</span>
                            <div style={{ color: "#f87171", fontSize: "0.75rem", marginTop: "0.2rem" }}>
                              예상: {i.originalEstimateStr} → 기록: {i.issueTimeSpentStr}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: "0.8rem", color: "#666", textAlign: "center", padding: "1rem" }}>예상 시간을 초과한 미완료 이슈가 없습니다.</div>
                    )}
                  </div>
                </div>

                {/* 기한 초과 */}
                <div className="summary-item" style={{ marginBottom: 0 }}>
                  <h3 style={{ fontSize: "1rem", color: "var(--text-primary)", fontWeight: "600", marginBottom: "1rem" }}>🚨 기한 초과 이슈 <span style={{ fontSize: "0.75rem", color: "#f87171" }}>(기한 &lt; 오늘)</span></h3>
                  <div style={{ background: "rgba(249, 115, 22, 0.05)", border: "1px solid rgba(249, 115, 22, 0.2)", borderRadius: "8px", padding: "1rem", maxHeight: "250px", overflowY: "auto" }}>
                    {stats?.issueStatusAnalysis?.overdueDeadline?.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#e5e7eb", fontSize: "0.8rem" }}>
                        {stats.issueStatusAnalysis.overdueDeadline.map((i, idx) => (
                          <li key={idx} style={{ marginBottom: "0.5rem" }}>
                            <span style={{ color: "#60a5fa", fontWeight: "bold" }}>{i.issueKey}</span>
                            <span style={{ color: "#9ca3af", marginLeft: "0.3rem" }}>{i.issueSummary} ({i.author})</span>
                            <div style={{ color: "#fb923c", fontSize: "0.75rem", marginTop: "0.2rem" }}>
                              기한: {i.dueDate} (상태: {i.issueStatus})
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: "0.8rem", color: "#666", textAlign: "center", padding: "1rem" }}>기한이 초과된 미완료 이슈가 없습니다.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* 상세 목록 섹션 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
                <h3 style={{ fontSize: "1.1rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  📝 상세 작업 내역 목록 {activeFilter && <span style={{ fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: "normal" }}>(필터링 됨: {activeFilter.value})</span>}
                </h3>
                {activeFilter && (
                  <button onClick={() => setActiveFilter(null)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-secondary)", padding: "4px 12px", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer" }}>필터 해제</button>
                )}
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                {stats?.userStats.filter(u => u.logs.length > 0).map((u, i) => (
                  <div key={i} style={{ borderLeft: "4px solid var(--accent-color)", paddingLeft: "1.5rem", minWidth: 0 }}>
                    <h4 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--text-primary)" }}>
                      {u.name} <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: "normal" }}>({u.totalHours.toFixed(1)} H)</span>
                    </h4>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: "500px" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "130px" }}>이슈키</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "250px" }}>이슈제목</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "80px" }}>시작일</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "80px" }}>기한</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "120px" }}>Est./Rem./Log.</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "150px" }}>작성일시</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)", width: "60px" }}>시간</th>
                            <th style={{ padding: "0.5rem", color: "var(--text-secondary)" }}>작업 내용</th>
                          </tr>
                        </thead>
                        <tbody>
                          {u.logs.map((log, li) => (
                            <tr key={li} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontWeight: "bold", color: "var(--accent-color)", fontSize: "0.8rem" }}>
                                {log.issueKey}
                              </td>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                                {log.issueSummary}
                              </td>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                                {log.issueStartDate || "-"}
                              </td>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                                {log.dueDate || "-"}
                              </td>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontSize: "0.7rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                E: {log.originalEstimate || "-"}<br/>
                                R: {log.remainingEstimate || "-"}<br/>
                                L: {log.issueTimeSpent || "-"}
                              </td>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                                {formatDateTime(log.started)}
                              </td>
                              <td style={{ padding: "0.75rem", verticalAlign: "top", fontWeight: "bold" }}>{log.timeSpent || (log.timeSpentSeconds/3600).toFixed(1) + "h"}</td>
                              <td style={{ padding: "1rem 0.75rem", lineHeight: "1.6", color: "var(--text-secondary)", whiteSpace: "pre-wrap", verticalAlign: "top", wordBreak: "break-word", fontSize: "0.8rem" }}>
                                {linkify(log.comment)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "4rem", textAlign: "center", color: "var(--text-secondary)", background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.1)" }}>
               <span style={{ fontSize: "3rem" }}>👈</span>
               <h3 style={{ marginTop: "1rem" }}>왼쪽 목록에서 리포트를 선택해 주세요.</h3>
               <p>선택 시 프로젝트별 월간 통계와 상세 내역이 표시됩니다.</p>
            </div>
          )}
        </div>

      </div>

      <style jsx>{`
        .history-grid {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 1.5rem;
          align-items: start;
        }
        @media (max-width: 1024px) {
          .history-grid {
            grid-template-columns: 1fr;
          }
          .list-card {
            max-height: none !important;
          }
        }
        .history-row:hover {
          background: rgba(255,255,255,0.03) !important;
        }
        .history-row:hover button {
          opacity: 1 !important;
        }
        .detail-container {
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
