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
  const [isEditingGroups, setIsEditingGroups] = useState(false);
  const [newGroupsText, setNewGroupsText] = useState("");
  const [monitorViewMode, setMonitorViewMode] = useState("chart"); // "chart" | "list"

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

        // 4. 어제자 그룹 모니터링 워크로그 (설정된 그룹 기준)
        const usersRes = await fetch("/api/users");
        const usersData = await usersRes.json();
        const allDbUsers = usersData.users || [];
        
        const groupArray = savedGroups.split(",").map(s => s.trim()).filter(Boolean);
        const groupTargetUsers = allDbUsers.filter(u => groupArray.includes(u.part));
        setMonitorMemberCount(groupTargetUsers.length);

        if (groupTargetUsers.length > 0) {
          const monitorRes = await fetch("/api/worklogs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
               startDate: yesterday, 
               endDate: yesterday, 
               targetType: "custom", 
               targetUsers: groupTargetUsers 
            })
          });
          const monitorData = await monitorRes.json();
          setMonitorLogs(monitorData.worklogs || []);
        }

      } catch (e) {
        console.error("대시보드 로딩 실패:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchDashboardData();
  }, [start, end, yesterday]);

  const handleUpdateGroups = async () => {
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type" : "application/json" },
        body: JSON.stringify({ key: "monitor_groups", value: newGroupsText })
      });
      alert("모니터링 그룹이 저장되어 익일부터 대시보드에 반영됩니다.");
      setMonitorGroups(newGroupsText);
      setIsEditingGroups(false);
      window.location.reload(); // 데이터 재계산을 위해 페이지 리로드
    } catch (e) {
       alert("설정 저장에 실패했습니다.");
    }
  };

  const getStatusColor = (colorName) => {
    if (!colorName) return "default";
    if (["blue-gray", "medium-gray"].includes(colorName)) return "blue";
    if (colorName === "green") return "green";
    if (colorName === "yellow") return "yellow";
    return "default";
  };

  const totalWeeklySeconds = weekWorklogs.reduce((acc, curr) => acc + (curr.timeSpentSeconds || 0), 0);
  const totalWeeklyHours = (totalWeeklySeconds / 3600).toFixed(1);

  // 모니터링 그룹의 어제 실적 합산
  const monitorActualSeconds = monitorLogs.reduce((acc, curr) => acc + (curr.timeSpentSeconds || 0), 0);
  const monitorActualHours = (monitorActualSeconds / 3600).toFixed(1);
  const monitorBaseHours = monitorMemberCount * 8;
  const monitorAchieveRate = monitorBaseHours > 0 ? Math.min(100, (monitorActualHours / monitorBaseHours) * 100) : 0;

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

        {/* Widget 2: 어제자 그룹 실적 모니터링 (파이 그래프 & 리스트) */}
        <div className="widget card" style={{ gridRow: "span 2" }}>
          <div className="widget-header">
            <div>
              <h2 style={{ display: "inline-block", marginRight: "0.5rem" }}>📋 어제자 실적 모니터링</h2>
              <button 
                onClick={() => { setIsEditingGroups(true); setNewGroupsText(monitorGroups); }} 
                style={{ background: "transparent", border: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", cursor: "pointer", marginRight: "0.5rem" }}
              >
                그룹 설정
              </button>
              <button 
                onClick={() => setMonitorViewMode(monitorViewMode === "chart" ? "list" : "chart")}
                style={{ background: "var(--accent-color)", border: "none", color: "white", fontSize: "0.7rem", padding: "3px 8px", borderRadius: "4px", cursor: "pointer" }}
              >
                {monitorViewMode === "chart" ? "📄 리스트로 보기" : "📊 그래프로 보기"}
              </button>
            </div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{yesterday} 실적</span>
          </div>
          <div className="widget-content" style={{ maxHeight: "400px", overflowY: "auto" }}>
            {isEditingGroups && (
              <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.5rem" }}>모니터링할 그룹명 (콤마로 구분)</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input type="text" value={newGroupsText} onChange={e => setNewGroupsText(e.target.value)} style={{ flex: 1, padding: "0.3rem 0.5rem", borderRadius: "4px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white", fontSize: "0.85rem" }} />
                  <button onClick={handleUpdateGroups} className="btn-primary" style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem", height: "auto" }}>저장</button>
                  <button onClick={() => setIsEditingGroups(false)} style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem", height: "auto", background: "#444", color: "white", border: "none", borderRadius: "4px" }}>취소</button>
                </div>
              </div>
            )}
            
            <p style={{ fontSize: "0.75rem", marginBottom: "0.75rem", color: "var(--text-secondary)" }}>
               📌 모니터링: <b>{monitorGroups} ({monitorMemberCount}명)</b>
            </p>

            {loading ? (
               <div className="loading" style={{ fontSize: "0.85rem" }}>데이터 분석 중...</div>
            ) : monitorViewMode === "chart" ? (
               <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1.5rem 0" }}>
                  {/* CSS Pie Chart */}
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
                  
                  <div style={{ display: "flex", gap: "2rem", marginTop: "1.25rem", width: "100%", justifyContent: "center" }}>
                    <div style={{ textAlign: "center" }}>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>기준 시간</p>
                        <p style={{ fontSize: "1.1rem", fontWeight: "600" }}>{monitorBaseHours} H</p>
                    </div>
                    <div style={{ textAlign: "center" }}>
                        <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>실제 기록</p>
                        <p style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--accent-color)" }}>{monitorActualHours} H</p>
                    </div>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "1rem", fontStyle: "italic" }}>
                     ※ 인당 8시간 기준 총합 대비 달성 현황입니다.
                  </p>
               </div>
            ) : monitorLogs.length > 0 ? (
               <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {monitorLogs.map(log => (
                    <li key={log.id} style={{ borderLeft: "3px solid var(--accent-color)", paddingLeft: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                         <span style={{ fontWeight: "600", fontSize: "0.85rem" }}>{log.author}</span>
                         <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>{log.timeSpent} ({log.issueKey})</span>
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", whiteSpace: "pre-wrap", opacity: 0.9 }}>
                        {log.comment.length > 80 ? log.comment.substring(0, 80) + "..." : log.comment}
                      </div>
                    </li>
                  ))}
               </ul>
            ) : (
               <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                 워크로그 내역이 없습니다.
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

      </div>
    </div>
  );
}
