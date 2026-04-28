"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

export default function Dashboard() {
  const [issues, setIssues] = useState([]);
  const [stats, setStats] = useState({ totalUsers: 0, partStats: [] });
  const [weekWorklogs, setWeekWorklogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // 그룹 모니터링 관리 필드들
  const [monitorGroups, setMonitorGroups] = useState("VRHMI, VRMW");
  const [monitorLogs, setMonitorLogs] = useState([]);
  const [monitorMemberCount, setMonitorMemberCount] = useState(0);
  const [newGroupsText, setNewGroupsText] = useState("");
  const [users, setUsers] = useState([]);

  // 현재 주의 시작(월요일)과 끝(오늘) 구하기
  const { start, end, yesterday } = useMemo(() => {
    const rawNow = new Date();
    const now = new Date(rawNow);

    const yestDate = new Date(rawNow);
    yestDate.setDate(yestDate.getDate() - 1);
    const yStr = yestDate.toISOString().split('T')[0];

    const day = now.getDay(); // 0(Sun) - 6(Sat)
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    return {
      start: monday.toISOString().split('T')[0],
      end: rawNow.toISOString().split('T')[0],
      yesterday: yStr
    };
  }, []);

  useEffect(() => {
    async function fetchDashboardData() {
      setLoading(true);
      try {
        // 1. 내 할당 이슈 (최근)
        const issueRes = await fetch("/api/jira", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" })
        });
        const issueData = await issueRes.json();
        setIssues((issueData.issues || []).slice(0, 5));

        // 2. 사용자 관리 데이터 & 설정
        const statsRes = await fetch("/api/stats");
        const statsData = await statsRes.json();
        setStats(statsData);

        const usersRes = await fetch("/api/users");
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setUsers(usersData.users || []);
        }

        const configRes = await fetch("/api/config");
        const configData = await configRes.json();
        const savedGroups = configData.monitor_groups || "VRHMI, VRMW";
        setMonitorGroups(savedGroups);

        // 3. 이번 주 내 워크로그 (나 "me" 기준)
        const worklogRes = await fetch("/api/worklogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: start, endDate: end, targetType: "me" })
        });
        const worklogData = await worklogRes.json();
        setWeekWorklogs(worklogData.worklogs || []);

        // 4. 자동 수집된 어제자 워크로그 리포트 (worklog_results 테이블에서 최신 daily 결과)
        const reportRes = await fetch("/api/worklog-results?type=daily&limit=1");
        if (reportRes.ok) {
          const reportData = await reportRes.json();
          if (reportData.results && reportData.results.length > 0) {
            const latest = reportData.results[0];
            let parsedLogs = [];
            try { parsedLogs = JSON.parse(latest.report_data_json || "[]"); } catch(e) {}
            setMonitorLogs(parsedLogs);
            
            // 고유 작업자 수 확인
            const uniqueAuthors = new Set(parsedLogs.map(l => l.author));
            setMonitorMemberCount(uniqueAuthors.size);
          }
        }
      } catch (e) {
        console.error("대시보드 로딩 실패:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchDashboardData();
  }, [start, end]);

  const getStatusColor = (colorName) => {
    if (!colorName) return "default";
    if (["blue-gray", "medium-gray"].includes(colorName)) return "blue";
    if (colorName === "green") return "green";
    if (colorName === "yellow") return "yellow";
    return "default";
  };

  const totalWeeklySeconds = weekWorklogs.reduce((acc, curr) => acc + (curr.timeSpentSeconds || 0), 0);
  const totalWeeklyHours = (totalWeeklySeconds / 3600).toFixed(1);

  const monitorActualSeconds = monitorLogs.reduce((acc, curr) => acc + (curr.timeSpentSeconds || 0), 0);
  const monitorActualHours = (monitorActualSeconds / 3600).toFixed(1);
  const monitorBaseHours = monitorMemberCount * 8;
  const monitorAchieveRate = monitorBaseHours > 0 ? Math.min(100, (monitorActualHours / monitorBaseHours) * 100).toFixed(0) : 0;

  // 그룹별, 프로젝트별, 개인별 작업기록 현황을 위한 데이터 집계
  const statsSummary = useMemo(() => {
    if (!monitorLogs || monitorLogs.length === 0) return { groupStats: [], userStats: [], projectStats: [], projectCodeStats: [], workTypeStats: [] };
    
    const userMapDb = {};
    users.forEach(u => {
      userMapDb[u.name] = u.part || "미지정";
      userMapDb[u.dt_account] = u.part || "미지정";
    });

    const userMap = {};
    const groupMap = {};
    const projectMap = {};
    const projectCodeMap = {};
    const workTypeMap = {};

    monitorLogs.forEach(log => {
      const sec = log.timeSpentSeconds || 0;
      const hours = sec / 3600;
      
      const part = userMapDb[log.author] || "미지정";

      if (!userMap[log.author]) {
        userMap[log.author] = { author: log.author, part, totalHours: 0 };
      }
      userMap[log.author].totalHours += hours;

      if (!groupMap[part]) {
        groupMap[part] = { part, totalHours: 0 };
      }
      groupMap[part].totalHours += hours;

      // 1. 프로젝트 ID별 그룹화 (Jira Project Name 사용)
      const proj = log.projectName || log.projectKey || "기타";
      if (!projectMap[proj]) {
        projectMap[proj] = { project: proj, totalHours: 0 };
      }
      projectMap[proj].totalHours += hours;

      // 2. 프로젝트 코드 & 작업 유형 (파싱 시도)
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

      if (!projectCodeMap[pc]) projectCodeMap[pc] = { code: pc, totalHours: 0 };
      projectCodeMap[pc].totalHours += hours;

      if (!workTypeMap[wt]) workTypeMap[wt] = { type: wt, totalHours: 0 };
      workTypeMap[wt].totalHours += hours;
    });

    const userStats = Object.values(userMap).sort((a, b) => b.totalHours - a.totalHours);
    const groupStats = Object.values(groupMap).sort((a, b) => b.totalHours - a.totalHours);
    const projectStats = Object.values(projectMap).sort((a, b) => b.totalHours - a.totalHours);
    const projectCodeStats = Object.values(projectCodeMap).sort((a, b) => b.totalHours - a.totalHours);
    const workTypeStats = Object.values(workTypeMap).sort((a, b) => b.totalHours - a.totalHours);

    return { userStats, groupStats, projectStats, projectCodeStats, workTypeStats };
  }, [monitorLogs, users]);

  const chartColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#a855f7"];

  const renderDonutChart = (data, valueKey, labelKey) => {
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
        <div style={{ 
          width: "120px", height: "120px", borderRadius: "50%", 
          background: `conic-gradient(${segments})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 10px rgba(0,0,0,0.2)"
        }}>
          <div style={{ width: "80px", height: "80px", background: "var(--surface-color)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: "bold", color: "var(--text-secondary)" }}>{total.toFixed(0)}H</span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.4rem 0.8rem", fontSize: "0.7rem" }}>
          {data.slice(0, 5).map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "2px", background: chartColors[i % chartColors.length] }}></div>
              <span style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{item[labelKey]}</span>
              <span style={{ fontWeight: "bold" }}>{((item[valueKey] / total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>📊 종합 대시보드</h1>
        <p>프로젝트와 나의 업무 현황을 한눈에 보며 하루를 시작하세요.</p>
      </div>

      <div className="widget-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))" }}>
        
        {/* Widget 1: 내 할당 이슈 (최근) */}
        <div className="widget card">
          <div className="widget-header">
            <h2>🔥 내 할당 이슈 (최근)</h2>
            <Link href="/filter-generation?jql=assignee=currentUser() AND statusCategory!=Done" className="widget-link">전체 보기 &rarr;</Link>
          </div>
          <div className="widget-content">
            {loading ? (
              <div className="loading">데이터 로딩 중...</div>
            ) : issues.length > 0 ? (
              <ul className="issue-list-mini">
                {issues.map(iss => {
                  const statusColor = getStatusColor(iss.fields?.status?.statusCategory?.colorName);
                  return (
                    <li key={iss.key}>
                      <div className="iss-meta">
                        <span className="iss-key">{iss.key}</span>
                        <span className={`iss-status status-${statusColor}`}>
                          {iss.fields?.status?.name}
                        </span>
                      </div>
                      <div className="iss-summary" style={{ fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {iss.fields?.summary}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div style={{ textAlign: "center", color: "var(--text-secondary)", padding: "1.5rem" }}>
                진행 중인 할당 이슈가 없습니다. 🎉
              </div>
            )}
          </div>
        </div>

        {/* Widget 3: 사용자 통계 */}
        <div className="widget card">
          <div className="widget-header">
            <h2>👥 사용자 관리 현황</h2>
            <Link href="/user-management" className="widget-link" style={{ fontSize: "0.8rem" }}>관리 가기 &rarr;</Link>
          </div>
          <div className="widget-content">
            <div style={{ marginBottom: "1rem", textAlign: "center" }}>
              <span style={{ fontSize: "1.8rem", fontWeight: "bold", color: "var(--accent-color)" }}>{stats.totalUsers}</span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginLeft: "0.5rem" }}>명 등록됨</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {stats.partStats.slice(0, 3).map(p => {
                const percentage = Math.max(10, (p.count / stats.totalUsers) * 100);
                return (
                  <div key={p.part} style={{ fontSize: "0.85rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.15rem" }}>
                      <span>{p.part || "미지정"}</span>
                      <span>{p.count}명</span>
                    </div>
                    <div style={{ width: "100%", height: "6px", background: "rgba(255,255,255,0.05)", borderRadius: "4px" }}>
                      <div style={{ width: `${percentage}%`, height: "100%", background: "var(--accent-color)", borderRadius: "4px" }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Widget 4: 이번 주 워크로그 요약 */}
        <div className="widget card">
          <div className="widget-header">
            <h2>⏱️ 주간 워크로그 요약</h2>
            <Link href="/worklog" className="widget-link" style={{ fontSize: "0.8rem" }}>분석기 가기 &rarr;</Link>
          </div>
          <div className="widget-content" style={{ textAlign: "center", minHeight: "130px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "12px", padding: "1rem 2rem" }}>
               <div style={{ fontSize: "2rem", fontWeight: "bold", color: "#10b981" }}>{totalWeeklyHours} H</div>
               <p style={{ fontSize: "0.8rem", color: "#10b981" }}>이번 주 누적 작업량</p>
            </div>
          </div>
        </div>

        {/* Widget 2: 어제자 그룹 실적 모니터링 (파이 그래프 & 리스트) */}
        <div className="widget card" style={{ gridColumn: "1 / -1" }}>
          <div className="widget-header">
            <div>
              <h2 style={{ display: "inline-block", marginRight: "1rem" }}>🤖 일일 작업 리포트 (자동)</h2>
              <Link href="/cron-history" className="widget-link" style={{ fontSize: "0.8rem", padding: "4px 8px", background: "var(--surface-color)", borderRadius: "4px" }}>과거 리포트 조회 &rarr;</Link>
            </div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{yesterday} 실적</span>
          </div>
          <div className="widget-content" style={{ maxHeight: "1000px", overflowY: "auto" }}>
            <p style={{ fontSize: "0.75rem", marginBottom: "0.75rem", color: "var(--text-secondary)" }}>
               📌 모니터링 대상: <b>{monitorMemberCount > 0 ? `${monitorMemberCount}명 참여` : "데이터 없음"}</b>
            </p>

            {loading ? (
               <div className="loading" style={{ fontSize: "0.85rem" }}>데이터 분석 중...</div>
            ) : monitorLogs.length > 0 ? (
               <div style={{ display: "grid", gridTemplateColumns: "minmax(250px, 1fr) 2fr", gap: "2rem", alignItems: "start" }}>
                 {/* 왼쪽: 통계 그래프 */}
                 <div style={{ position: "sticky", top: 0, display: "flex", flexDirection: "column", alignItems: "center", padding: "2rem 1.5rem", background: "rgba(255,255,255,0.02)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ 
                      width: "160px", 
                      height: "160px", 
                      borderRadius: "50%", 
                      background: `conic-gradient(var(--accent-color) 0% ${monitorAchieveRate}%, rgba(255,255,255,0.05) ${monitorAchieveRate}% 100%)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                      boxShadow: "0 0 20px rgba(0,0,0,0.3)"
                    }}>
                      <div style={{ width: "120px", height: "120px", background: "var(--surface-color)", borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                         <span style={{ fontSize: "1.5rem", fontWeight: "bold", color: "var(--text-primary)" }}>{monitorAchieveRate}%</span>
                         <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>달성률</span>
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", gap: "2rem", marginTop: "2rem", width: "100%", justifyContent: "center" }}>
                      <div style={{ textAlign: "center" }}>
                          <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>기준 시간</p>
                          <p style={{ fontSize: "1.2rem", fontWeight: "600" }}>{monitorBaseHours} H</p>
                      </div>
                      <div style={{ textAlign: "center" }}>
                          <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>실제 기록</p>
                          <p style={{ fontSize: "1.2rem", fontWeight: "600", color: "var(--accent-color)" }}>{monitorActualHours} H</p>
                      </div>
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "1.5rem", fontStyle: "italic", textAlign: "center" }}>
                       ※ 인당 8시간 기준 총합 대비 달성 현황입니다.
                    </p>
                 </div>

                 {/* 오른쪽: 프로젝트/코드/유형 요약 리스트 */}
                 <div style={{ overflow: "visible" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
                      {/* 프로젝트 ID별 요약 */}
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1.25rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <h3 style={{ fontSize: "0.85rem", color: "var(--text-secondary)", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.5rem", marginBottom: "1rem", textAlign: "center" }}>🚀 프로젝트 ID별</h3>
                        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                          {statsSummary.projectStats.slice(0, 5).map((p, i) => (
                            <li key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: "0.5rem" }} title={p.project}>{p.project}</span>
                              <span style={{ fontWeight: "600", flexShrink: 0 }}>{p.totalHours.toFixed(1)}H</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                      {/* 프로젝트 코드별 요약 (도넛 차트) */}
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1.25rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <h3 style={{ fontSize: "0.85rem", color: "var(--text-secondary)", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.5rem", marginBottom: "1.25rem", textAlign: "center" }}>🏷️ 프로젝트 코드별</h3>
                        {renderDonutChart(statsSummary.projectCodeStats, "totalHours", "code")}
                      </div>

                      {/* 작업 유형별 요약 (도넛 차트) */}
                      <div style={{ background: "rgba(255,255,255,0.02)", padding: "1.25rem", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <h3 style={{ fontSize: "0.85rem", color: "var(--text-secondary)", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.5rem", marginBottom: "1.25rem", textAlign: "center" }}>🛠️ 작업 유형별</h3>
                        {renderDonutChart(statsSummary.workTypeStats, "totalHours", "type")}
                      </div>
                    </div>

                    {/* 개인별 요약 (파트별 카드 + 도넛 그래프) */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.5rem" }}>
                       <h3 style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>🧑‍💻 파트원별 실적 (8H 기준)</h3>
                       <div style={{ display: "flex", gap: "0.6rem", fontSize: "0.6rem" }}>
                         <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444" }}></div> 매우부족</div>
                         <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#f59e0b" }}></div> 부족</div>
                         <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }}></div> 보통</div>
                         <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#3b82f6" }}></div> 많음</div>
                         <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#8b5cf6" }}></div> 매우많음</div>
                       </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                       {Object.entries(
                         statsSummary.userStats.reduce((acc, u) => {
                           if (!acc[u.part]) acc[u.part] = [];
                           acc[u.part].push(u);
                           return acc;
                         }, {})
                       ).map(([part, users]) => (
                         <div key={part}>
                           <h4 style={{ fontSize: "0.85rem", color: "var(--accent-color)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                             <span style={{ width: "6px", height: "6px", background: "var(--accent-color)", borderRadius: "50%" }}></span>
                             {part}
                           </h4>
                           <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem" }}>
                             {users.map((u, idx) => {
                               const rawPercent = (u.totalHours / 8) * 100;
                               const userPercent = Math.min(100, rawPercent);
                               
                               // 5단계 색상 로직
                               let color = "#10b981";
                               let level = "보통";
                               if (rawPercent < 50) { color = "#ef4444"; level = "매우부족"; }
                               else if (rawPercent < 80) { color = "#f59e0b"; level = "부족"; }
                               else if (rawPercent <= 105) { color = "#10b981"; level = "보통"; }
                               else if (rawPercent <= 130) { color = "#3b82f6"; level = "많음"; }
                               else { color = "#8b5cf6"; level = "매우많음"; }
                               
                               return (
                                 <div key={idx} style={{ 
                                   background: "rgba(255,255,255,0.02)", 
                                   border: "1px solid rgba(255,255,255,0.05)", 
                                   borderRadius: "8px", 
                                   padding: "0.75rem", 
                                   display: "flex", 
                                   alignItems: "center", 
                                   gap: "0.75rem"
                                 }}>
                                   <div style={{ 
                                     width: "36px", 
                                     height: "36px", 
                                     borderRadius: "50%", 
                                     background: `conic-gradient(${color} 0% ${userPercent}%, rgba(255,255,255,0.05) ${userPercent}% 100%)`,
                                     display: "flex",
                                     alignItems: "center",
                                     justifyContent: "center",
                                     flexShrink: 0
                                   }}>
                                     <div style={{ width: "28px", height: "28px", background: "var(--surface-color)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        <span style={{ fontSize: "0.55rem", fontWeight: "bold", color: "var(--text-primary)" }}>{rawPercent.toFixed(0)}%</span>
                                     </div>
                                   </div>
 
                                   <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                     <span style={{ fontSize: "0.8rem", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.author}</span>
                                     <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                                        <span style={{ fontSize: "0.75rem", color: color, fontWeight: "700" }}>{u.totalHours.toFixed(1)} H</span>
                                        <span style={{ fontSize: "0.55rem", color: color, background: `${color}11`, padding: "0 2px", borderRadius: "2px" }}>{level}</span>
                                     </div>
                                   </div>
                                 </div>
                               );
                             })}
                           </div>
                         </div>
                       ))}
                    </div>
                 </div>
               </div>
            ) : (
               <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                 워크로그 내역이 없습니다.
               </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
