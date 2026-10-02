"use client";

import { useState, useEffect } from "react";

const INTERVAL_OPTIONS = [
  { value: 0, label: "🚫 사용 안 함 (수동 전용)", desc: "자동 폴링을 끄고, 필요 시 수동 갱신만 수행합니다." },
  { value: 3, label: "⚡ 3분", desc: "매우 빠른 주기 (테스트 및 빠른 피드백)" },
  { value: 5, label: "⏱️ 5분", desc: "빠른 주기 (활발한 업무 시간대 권장)" },
  { value: 10, label: "🔄 10분 (기본 권장)", desc: "안정적인 표준 주기 (Jira 부하 최소화)" },
  { value: 15, label: "🕒 15분", desc: "여유로운 주기" },
  { value: 30, label: "⏳ 30분", desc: "긴 주기 (서버 리소스 절약)" },
  { value: 60, label: "🕐 60분 (1시간)", desc: "시간 단위 주기" },
];

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState("rules"); // "rules" | "stats" | "hr"
  
  // ── 설정 탭 상태 ──
  const [webhookUrl, setWebhookUrl] = useState("http://<your-linux-ip>:3000/api/cron/jira-monitor");
  const [status, setStatus] = useState(null);
  const [monitorInterval, setMonitorInterval] = useState(10);
  const [isSavingInterval, setIsSavingInterval] = useState(false);
  const [intervalSuccessMsg, setIntervalSuccessMsg] = useState("");
  const [users, setUsers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [tempTarget, setTempTarget] = useState("");
  const [selectedGroups, setSelectedGroups] = useState([]);

  // ── 통계 및 인사평가 공통 상태 ──
  const [statsPeriod, setStatsPeriod] = useState("30days"); // "7days" | "30days" | "thisMonth" | "quarter" | "custom"
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - 29 * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [selectedAuthor, setSelectedAuthor] = useState("");
  const [statisticsData, setStatisticsData] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [logFilterStatus, setLogFilterStatus] = useState("all"); // "all" | "open" | "resolved"

  // ── 인사평가 탭 전용 상태 ──
  const [selectedHrUser, setSelectedHrUser] = useState(null);
  const [copySuccessMsg, setCopySuccessMsg] = useState("");
  const [isSyncingJira, setIsSyncingJira] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState("");

  const handleSyncJiraAndRefresh = async () => {
    setIsSyncingJira(true);
    setSyncStatusMsg("Jira에서 최신 작업기록을 조회하고 오류 해결 여부를 검증하는 중...");
    try {
      const res = await fetch(`/api/notifications/initial-stats${selectedAuthor ? `?user=${encodeURIComponent(selectedAuthor)}` : ''}`);
      const data = await res.json();
      if (data.success) {
        const resolvedCount = data.resolvedAlerts ? data.resolvedAlerts.length : 0;
        setSyncStatusMsg(`✓ 동기화 완료! ${resolvedCount > 0 ? `${resolvedCount}건의 오류가 해결 완료 처리되었습니다.` : '모든 작업기록이 최신 검증되었습니다.'}`);
      } else {
        setSyncStatusMsg(`⚠️ 동기화 실패: ${data.error || '알 수 없는 오류'}`);
      }
      await fetchStatistics();
    } catch (e) {
      setSyncStatusMsg(`❌ 동기화 중 오류: ${e.message}`);
    } finally {
      setIsSyncingJira(false);
      setTimeout(() => setSyncStatusMsg(""), 5000);
    }
  };

  const handleUpdateLogStatus = async (id, alertKey, newStatus) => {
    try {
      const res = await fetch('/api/notifications/statistics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, alertKey, status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        await fetchStatistics();
      } else {
        alert(`상태 변경 실패: ${data.error}`);
      }
    } catch (e) {
      alert(`상태 변경 중 오류: ${e.message}`);
    }
  };

  const partsList = Array.from(new Set(users.map(u => u.part))).filter(Boolean);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/notifications/status");
      const data = await res.json();
      setStatus(data);
      if (data.monitorInterval !== undefined) {
        setMonitorInterval(data.monitorInterval);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchStatistics = async () => {
    setIsLoadingStats(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate
      });
      if (selectedAuthor) {
        params.append('author', selectedAuthor);
      }
      const res = await fetch(`/api/notifications/statistics?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setStatisticsData(data);
      }
    } catch (err) {
      console.error("통계 조회 실패:", err);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchUsers();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === "stats" || activeTab === "hr") {
      fetchStatistics();
    }
  }, [activeTab, startDate, endDate, selectedAuthor]);

  const handleQuickPeriod = (type) => {
    setStatsPeriod(type);
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split('T')[0];

    if (type === "7days") {
      const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (type === "30days") {
      const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (type === "thisMonth") {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      setStartDate(`${year}-${month}-01`);
      setEndDate(todayStr);
    } else if (type === "quarter") {
      const year = now.getFullYear();
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const qStartMonth = String(currentQuarter * 3 + 1).padStart(2, '0');
      setStartDate(`${year}-${qStartMonth}-01`);
      setEndDate(todayStr);
    }
  };

  const handleIntervalChange = async (newVal) => {
    const val = parseInt(newVal, 10);
    setMonitorInterval(val);
    setIsSavingInterval(true);
    setIntervalSuccessMsg("");

    try {
      const res = await fetch("/api/notifications/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitorInterval: val })
      });
      const resData = await res.json();
      if (resData.success) {
        setIntervalSuccessMsg(val === 0 
          ? "✅ 자동 업데이트가 비활성화되었습니다. (수동 갱신 전용)" 
          : `✅ 자동 업데이트 주기가 ${val}분으로 변경되었습니다.`
        );
        fetchStatus();
        setTimeout(() => setIntervalSuccessMsg(""), 4000);
      } else {
        alert("주기 변경 실패: " + (resData.error || "오류"));
      }
    } catch (e) {
      console.error("주기 변경 중 오류:", e);
      alert("주기 변경 중 오류가 발생했습니다.");
    } finally {
      setIsSavingInterval(false);
    }
  };

  const toggleRule = async (ruleKey, currentVal) => {
    const isActive = !currentVal;
    try {
      await fetch("/api/notifications/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleKey, isActive })
      });
      fetchStatus();
    } catch (e) {
      alert("규칙 변경 실패");
    }
  };

  const updateTarget = async (ruleKey, targetValue) => {
    try {
      await fetch("/api/notifications/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleKey, target: targetValue })
      });
      fetchStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const openModal = (ruleKey, currentTarget) => {
    setEditingRule(ruleKey);
    setTempTarget(currentTarget);
    setSelectedGroups([]);
    setModalOpen(true);
  };

  const saveModal = () => {
    updateTarget(editingRule, tempTarget);
    setModalOpen(false);
  };

  const handleGroupToggle = (part) => {
    const isSelected = selectedGroups.includes(part);
    const newGroups = isSelected ? selectedGroups.filter(g => g !== part) : [...selectedGroups, part];
    setSelectedGroups(newGroups);

    const members = users.filter(u => u.part === part && u.is_active).map(u => u.name);
    let targets = tempTarget.split(',').map(s => s.trim()).filter(s => s);
    
    if (isSelected) {
      targets = targets.filter(t => !members.includes(t));
    } else {
      targets = Array.from(new Set([...targets, ...members]));
    }
    setTempTarget(targets.join(', '));
  };

  const handleUserToggle = (userName) => {
    let targets = tempTarget.split(',').map(s => s.trim()).filter(s => s);
    if (targets.includes(userName)) {
      targets = targets.filter(t => t !== userName);
    } else {
      targets.push(userName);
    }
    setTempTarget(targets.join(', '));
  };

  const renderToggle = (ruleKey, label, desc) => {
    const isActive = status?.rules?.[ruleKey]?.isActive ?? true;
    const target = status?.rules?.[ruleKey]?.target ?? '';

    return (
      <tr key={ruleKey}>
        <td style={{ padding: "1rem", borderBottom: "1px solid #333" }}>
          <strong style={{ fontSize: "1rem", color: "white" }}>{label}</strong>
          <p style={{ margin: "4px 0 0 0", color: "#888", fontSize: "0.85rem" }}>{desc}</p>
        </td>
        <td style={{ padding: "1rem", borderBottom: "1px solid #333" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: target ? "#60a5fa" : "#888", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {target || "전체 대상"}
            </span>
            <button 
              onClick={() => openModal(ruleKey, target)}
              style={{ padding: "4px 8px", fontSize: "0.75rem", borderRadius: "4px", background: "#333", border: "1px solid #555", color: "#ccc", cursor: "pointer" }}
            >
              설정
            </button>
          </div>
        </td>
        <td style={{ padding: "1rem", borderBottom: "1px solid #333" }}>
          <button 
            onClick={() => toggleRule(ruleKey, isActive)}
            style={{
              padding: "6px 16px",
              borderRadius: "20px",
              border: "none",
              cursor: "pointer",
              fontWeight: "bold",
              background: isActive ? "var(--accent-color)" : "#444",
              color: "white",
              transition: "0.2s"
            }}
          >
            {isActive ? "ON" : "OFF"}
          </button>
        </td>
      </tr>
    );
  };

  const filteredLogs = (statisticsData?.recentLogs || []).filter(log => {
    if (logFilterStatus === "open") return log.status === "open";
    if (logFilterStatus === "resolved") return log.status === "resolved";
    return true;
  });

  // 인사평가 표 엑셀/클립보드 복사
  const handleCopyHrTable = () => {
    if (!statisticsData?.hrEvaluation || statisticsData.hrEvaluation.length === 0) return;
    
    const headers = [
      "순위", "성명", "파트", "종합등급", "종합점수",
      "[1]MTTR(평균수정시간)", "[1]당일해결률(%)", "[1]미해결건수",
      "[3]총투입시간(h)", "[3]총투입공수(MM)", "[3]주력과제명", "[3]주력과제집중도(%)", "[3]팀내과제기여율(%)",
      "[4]멀티태스킹지수(CSI)", "[4]업무스타일", "[4]일평균이슈수", "[4]일평균과제수", "[4]과다근무일수(9h+)"
    ];

    const rows = statisticsData.hrEvaluation.map((h, i) => [
      i + 1, h.author, h.part, h.grade, h.totalScore,
      h.indicator1.avgTimeFormatted, `${h.indicator1.sameDayRate}%`, h.indicator1.openAlerts,
      h.indicator3.totalHours, h.indicator3.totalMM, h.indicator3.primaryProjectCode, `${h.indicator3.primaryRatio}%`, `${h.indicator3.primaryProjectShare}%`,
      h.indicator4.csi, h.indicator4.workStyle, h.indicator4.avgIssuesPerDay, h.indicator4.avgProjectsPerDay, h.indicator4.overworkDays
    ]);

    const tsvContent = [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
    navigator.clipboard?.writeText(tsvContent);
    setCopySuccessMsg("📋 인사평가 데이터가 엑셀 호환(TSV) 형식으로 클립보드에 복사되었습니다!");
    setTimeout(() => setCopySuccessMsg(""), 3500);
  };

  return (
    <div className="container" style={{ padding: "2rem", maxWidth: "1250px", margin: "0 auto" }}>
      {/* 대상 선택 모달 */}
      {modalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "#222", padding: "2rem", borderRadius: "12px", width: "550px", border: "1px solid #444", maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ marginTop: 0, marginBottom: "1rem" }}>알림 대상 설정</h3>
            <p style={{ fontSize: "0.85rem", color: "#aaa", marginBottom: "1.5rem" }}>
              모니터링 알림을 수신할 특정 그룹(파트)이나 담당자를 선택하세요.
            </p>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>🏢 파트(그룹) 일괄 선택</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {partsList.map(part => {
                  const isSelected = selectedGroups.includes(part);
                  return (
                    <button 
                      key={part} 
                      onClick={() => handleGroupToggle(part)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "15px",
                        fontSize: "0.8rem",
                        cursor: "pointer",
                        border: isSelected ? "1px solid #3b82f6" : "1px solid #444",
                        background: isSelected ? "rgba(59, 130, 246, 0.2)" : "#333",
                        color: isSelected ? "#60a5fa" : "#ccc"
                      }}
                    >
                      {isSelected ? "✓ " : "+ "}{part}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>👤 개별 인원 직접 선택</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", maxHeight: "200px", overflowY: "auto", padding: "1rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid #333" }}>
                {users.filter(u => u.is_active).map(u => {
                  const isChecked = tempTarget.split(',').map(s => s.trim()).includes(u.name);
                  return (
                    <label key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", background: isChecked ? "rgba(16,185,129,0.1)" : "transparent", border: `1px solid ${isChecked ? "#10b981" : "#444"}`, padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}>
                      <input type="checkbox" checked={isChecked} onChange={() => handleUserToggle(u.name)} />
                      <span style={{ color: isChecked ? "#34d399" : "var(--text-secondary)" }}>{u.name} ({u.part})</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>직접 입력 (이슈 키워드 등)</label>
               <input 
                 type="text" 
                 value={tempTarget} 
                 onChange={e => setTempTarget(e.target.value)} 
                 style={{ width: "100%", padding: "0.8rem", borderRadius: "8px", background: "#111", border: "1px solid #444", color: "white" }} 
               />
               <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "4px" }}>쉼표(,)로 대상을 구분합니다. 모두 지우면 '전체 대상'이 됩니다.</div>
            </div>

            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "2rem" }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: "0.8rem 1.5rem", borderRadius: "8px", background: "transparent", border: "1px solid #555", color: "#ccc", cursor: "pointer" }}>취소</button>
              <button onClick={saveModal} style={{ padding: "0.8rem 1.5rem", borderRadius: "8px", background: "var(--accent-color)", border: "none", color: "white", fontWeight: "bold", cursor: "pointer" }}>적용하기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 페이지 상단 헤더 ── */}
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <h1>🔔 JIRA 모니터링 및 인사평가 센터</h1>
        <p>실시간 모니터링 규칙을 설정하고, 개인별 작업기록 위반 알람 및 인사평가 3대 핵심 지표(MTTR 피드백 속도, 계약과제 기여도, 업무 집중도·멀티태스킹 지수)를 입체적으로 분석합니다.</p>
      </div>

      {/* ── 대메뉴 탭 네비게이션 (3개 탭) ── */}
      <div style={{ 
        display: "flex", 
        gap: "10px", 
        borderBottom: "1px solid #334155", 
        marginBottom: "2rem",
        paddingBottom: "2px"
      }}>
        <button
          onClick={() => setActiveTab("rules")}
          style={{
            padding: "10px 20px",
            fontSize: "0.95rem",
            fontWeight: activeTab === "rules" ? 700 : 500,
            color: activeTab === "rules" ? "#38bdf8" : "#94a3b8",
            background: activeTab === "rules" ? "rgba(56, 189, 248, 0.12)" : "transparent",
            border: "none",
            borderBottom: activeTab === "rules" ? "3px solid #38bdf8" : "3px solid transparent",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <span>⚙️</span> 알림 규칙 및 주기 설정
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          style={{
            padding: "10px 20px",
            fontSize: "0.95rem",
            fontWeight: activeTab === "stats" ? 700 : 500,
            color: activeTab === "stats" ? "#38bdf8" : "#94a3b8",
            background: activeTab === "stats" ? "rgba(56, 189, 248, 0.12)" : "transparent",
            border: "none",
            borderBottom: activeTab === "stats" ? "3px solid #38bdf8" : "3px solid transparent",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <span>📊</span> 알람 통계 및 발생 추이
          {statisticsData?.summary?.openAlerts > 0 && (
            <span style={{
              background: "#ef4444",
              color: "white",
              fontSize: "0.7rem",
              fontWeight: 800,
              padding: "1px 6px",
              borderRadius: "9999px"
            }}>
              {statisticsData.summary.openAlerts}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("hr")}
          style={{
            padding: "10px 20px",
            fontSize: "0.95rem",
            fontWeight: activeTab === "hr" ? 700 : 500,
            color: activeTab === "hr" ? "#38bdf8" : "#94a3b8",
            background: activeTab === "hr" ? "rgba(56, 189, 248, 0.12)" : "transparent",
            border: "none",
            borderBottom: activeTab === "hr" ? "3px solid #38bdf8" : "3px solid transparent",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <span>📋</span> 인사평가 데이터 분석 (1·3·4번 지표)
          <span style={{
            background: "linear-gradient(135deg, #10b981 0%, #3b82f6 100%)",
            color: "white",
            fontSize: "0.68rem",
            fontWeight: 800,
            padding: "1px 6px",
            borderRadius: "4px"
          }}>
            HR Scorecard
          </span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          탭 1: 알림 규칙 및 주기 설정
      ══════════════════════════════════════════════════════════ */}
      {activeTab === "rules" && (
        <>
          <div className="card" style={{ marginBottom: "2rem", border: "1px solid #334155", background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ fontSize: "1.2rem", margin: "0 0 0.4rem 0", display: "flex", alignItems: "center", gap: "8px", color: "#f8fafc" }}>
                  <span>⏱️</span> 실시간 모니터링 자동 업데이트 주기
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "0.88rem", margin: 0 }}>
                  PC 클라이언트가 켜져 있을 때 백그라운드에서 사내 Jira를 자동 조회하는 간격입니다. <br/>
                  <b>'사용 안 함'</b>을 선택하면 자동 주기 폴링이 즉시 중지되며, 데스크톱 앱에서 [수동 갱신] 버튼을 누를 때만 데이터를 가져옵니다.
                </p>
              </div>
              <div style={{
                padding: "6px 14px",
                borderRadius: "20px",
                fontSize: "0.82rem",
                fontWeight: 700,
                background: monitorInterval === 0 ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)",
                border: monitorInterval === 0 ? "1px solid #ef4444" : "1px solid #10b981",
                color: monitorInterval === 0 ? "#fca5a5" : "#6ee7b7",
                whiteSpace: "nowrap"
              }}>
                {monitorInterval === 0 ? "🛑 자동 업데이트 꺼짐 (수동 갱신 모드)" : `🟢 ${monitorInterval}분 간격 자동 갱신`}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.2rem" }}>
              {INTERVAL_OPTIONS.map(opt => {
                const isSelected = monitorInterval === opt.value;
                return (
                  <button
                    key={opt.value}
                    disabled={isSavingInterval}
                    onClick={() => handleIntervalChange(opt.value)}
                    style={{
                      flex: "1 1 calc(25% - 0.75rem)",
                      minWidth: "150px",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      cursor: isSavingInterval ? "wait" : "pointer",
                      textAlign: "left",
                      border: isSelected ? "2px solid #3b82f6" : "1px solid #334155",
                      background: isSelected ? "rgba(59, 130, 246, 0.25)" : "#1e293b",
                      color: isSelected ? "#ffffff" : "#cbd5e1",
                      transition: "all 0.15s ease",
                      boxShadow: isSelected ? "0 0 12px rgba(59, 130, 246, 0.3)" : "none"
                    }}
                  >
                    <div style={{ fontWeight: isSelected ? 800 : 600, fontSize: "0.92rem", marginBottom: "3px", color: isSelected ? "#93c5fd" : "#e2e8f0" }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: "0.74rem", color: isSelected ? "#cbd5e1" : "#64748b", lineHeight: 1.3 }}>
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            {intervalSuccessMsg && (
              <div style={{ marginTop: "1rem", padding: "8px 12px", background: "rgba(16, 185, 129, 0.15)", border: "1px solid #10b981", borderRadius: "6px", color: "#34d399", fontSize: "0.85rem" }}>
                {intervalSuccessMsg}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>모니터링 알림 규칙 설정</h2>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#222", textAlign: "left" }}>
                  <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>규칙 이름 및 조건</th>
                  <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>대상</th>
                  <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {renderToggle('USER_WORKLOG', '사용자 작업기록 실시간 현황', '작업기록 누적시간 변화 시 그래프 알림')}
                {renderToggle('INVALID_PROJECT', '미등록/완료 프로젝트 기록 경고', '등록되지 않거나 종료된 프로젝트 코드에 입력 시')}
                {renderToggle('INVALID_TASK_TYPE', '미정의 작업유형 경고', '표준 가이드에 없는 작업유형(디자인/기타) 사용 시')}
                {renderToggle('TIME_EXCEEDED', '예상시간 초과 알림', '이슈의 누적 작업시간이 예상시간(Original Estimate) 초과 시')}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>알림 스케줄러 (Cron/Webhook)</h2>
            <p style={{ color: "#aaa", fontSize: "0.9rem", marginBottom: "1rem" }}>
              Linux 서버의 Crontab이나 스케줄러에서 5~10분 주기로 아래 엔드포인트를 호출하면, JIRA를 조회하여 위반사항을 찾아냅니다.
            </p>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <input 
                type="text" 
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                style={{ flex: 1, padding: "0.8rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} 
                readOnly
              />
              <button 
                onClick={() => {
                  navigator.clipboard?.writeText(webhookUrl);
                  alert("URL이 클립보드에 복사되었습니다.");
                }}
                style={{ padding: "0.8rem 1.5rem", borderRadius: "8px", background: "var(--accent-color)", color: "white", border: "none", cursor: "pointer", fontWeight: "bold" }}
              >
                URL 복사
              </button>
            </div>
          </div>
          
          <div className="card">
            <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>접속된 PC 클라이언트 현황 (Tauri 앱)</h2>
            <div style={{ padding: "1.5rem", background: status?.connectedClients > 0 ? "rgba(16,185,129,0.1)" : "rgba(59,130,246,0.1)", borderRadius: "8px", border: `1px solid ${status?.connectedClients > 0 ? "rgba(16,185,129,0.3)" : "rgba(59,130,246,0.2)"}` }}>
               <p style={{ color: status?.connectedClients > 0 ? "#34d399" : "#60a5fa", marginBottom: "0.5rem", fontWeight: "bold" }}>
                 ℹ️ 현재 Server-Sent Events(SSE) 실시간 연결 풀 상태
               </p>
               <ul style={{ color: "#ccc", paddingLeft: "1.5rem", marginTop: "1rem", fontSize: "1.1rem" }}>
                 {status === null ? (
                   <li>상태를 불러오는 중입니다...</li>
                 ) : status.connectedClients > 0 ? (
                   <li>🟢 현재 <strong>{status.connectedClients}</strong>대의 Windows PC 앱이 알림 수신 대기 중입니다!</li>
                 ) : (
                   <li>🔴 현재 접속된 클라이언트가 없습니다. (Windows 앱을 실행해 주세요)</li>
                 )}
               </ul>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          탭 2: 알람 통계 및 발생 추이
      ══════════════════════════════════════════════════════════ */}
      {activeTab === "stats" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* 기간 필터 바 */}
          <div className="card" style={{ padding: "16px 20px", background: "#1e293b", border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "0.85rem", color: "#94a3b8", fontWeight: 600, marginRight: "4px" }}>기간 선택:</span>
                {[
                  { id: "7days", label: "최근 7일" },
                  { id: "30days", label: "최근 30일" },
                  { id: "thisMonth", label: "이번 달" },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleQuickPeriod(p.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: statsPeriod === p.id ? "1px solid #38bdf8" : "1px solid #475569",
                      background: statsPeriod === p.id ? "rgba(56, 189, 248, 0.2)" : "#0f172a",
                      color: statsPeriod === p.id ? "#38bdf8" : "#cbd5e1",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setStatsPeriod("custom");
                    }}
                    style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: "6px", padding: "5px 8px", color: "#f8fafc", fontSize: "0.82rem" }}
                  />
                  <span style={{ color: "#94a3b8" }}>~</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setStatsPeriod("custom");
                    }}
                    style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: "6px", padding: "5px 8px", color: "#f8fafc", fontSize: "0.82rem" }}
                  />
                </div>

                <select
                  value={selectedAuthor}
                  onChange={(e) => setSelectedAuthor(e.target.value)}
                  style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: "6px", padding: "5px 10px", color: "#f8fafc", fontSize: "0.82rem" }}
                >
                  <option value="">👤 전체 팀원</option>
                  {users.filter(u => u.is_active).map(u => (
                    <option key={u.id} value={u.name}>{u.name} ({u.part})</option>
                  ))}
                </select>

                <button
                  onClick={fetchStatistics}
                  disabled={isLoadingStats || isSyncingJira}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    background: "#334155",
                    border: "1px solid #475569",
                    color: "white",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    cursor: (isLoadingStats || isSyncingJira) ? "wait" : "pointer"
                  }}
                >
                  {isLoadingStats ? "조회 중..." : "🔄 통계 새로고침"}
                </button>

                <button
                  onClick={handleSyncJiraAndRefresh}
                  disabled={isLoadingStats || isSyncingJira}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                    border: "1px solid #3b82f6",
                    color: "white",
                    fontWeight: 700,
                    fontSize: "0.82rem",
                    cursor: (isLoadingStats || isSyncingJira) ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                  title="Jira에서 최신 작업기록을 재조회하여, 수정 완료된 알람을 자동으로 해결 처리합니다"
                >
                  {isSyncingJira ? "⚡ Jira 동기화 검증 중..." : "⚡ Jira 동기화 & 해결 갱신"}
                </button>
              </div>
            </div>

            {syncStatusMsg && (
              <div style={{
                marginTop: "12px",
                padding: "10px 14px",
                borderRadius: "6px",
                background: syncStatusMsg.startsWith("❌") ? "rgba(239, 68, 68, 0.2)" : syncStatusMsg.startsWith("⚠️") ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.2)",
                border: `1px solid ${syncStatusMsg.startsWith("❌") ? "#ef4444" : syncStatusMsg.startsWith("⚠️") ? "#f59e0b" : "#10b981"}`,
                color: syncStatusMsg.startsWith("❌") ? "#fca5a5" : syncStatusMsg.startsWith("⚠️") ? "#fcd34d" : "#6ee7b7",
                fontSize: "0.82rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                <span>ℹ️</span> {syncStatusMsg}
              </div>
            )}
          </div>

          {/* 핵심 요약 지표 카드 4종 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", border: "1px solid #334155" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.82rem", fontWeight: 600, marginBottom: "6px" }}>총 감지된 위반 알람</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#f8fafc" }}>
                {statisticsData?.summary?.totalAlerts ?? 0}
                <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "#94a3b8", marginLeft: "4px" }}>건</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "4px" }}>
                선택 기간 내 발생한 전체 알람
              </div>
            </div>

            <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(135deg, rgba(239,68,68,0.15) 0%, #0f172a 100%)", border: "1px solid rgba(239,68,68,0.4)" }}>
              <div style={{ color: "#fca5a5", fontSize: "0.82rem", fontWeight: 600, marginBottom: "6px" }}>🚨 현재 미해결 오류</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#ef4444" }}>
                {statisticsData?.summary?.openAlerts ?? 0}
                <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "#fca5a5", marginLeft: "4px" }}>건</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#f87171", marginTop: "4px" }}>
                아직 Jira에서 수정되지 않은 항목
              </div>
            </div>

            <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(135deg, rgba(16,185,129,0.15) 0%, #0f172a 100%)", border: "1px solid rgba(16,185,129,0.4)" }}>
              <div style={{ color: "#6ee7b7", fontSize: "0.82rem", fontWeight: 600, marginBottom: "6px" }}>✨ 정상 수정 완료</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#10b981" }}>
                {statisticsData?.summary?.resolvedAlerts ?? 0}
                <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "#6ee7b7", marginLeft: "4px" }}>건</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#34d399", marginTop: "4px" }}>
                알림 후 정상 포맷으로 재입력 완료
              </div>
            </div>

            <div className="card" style={{ padding: "16px 20px", background: "linear-gradient(135deg, rgba(56,189,248,0.15) 0%, #0f172a 100%)", border: "1px solid rgba(56,189,248,0.4)" }}>
              <div style={{ color: "#7dd3fc", fontSize: "0.82rem", fontWeight: 600, marginBottom: "6px" }}>📈 오류 해결 준수율</div>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#38bdf8" }}>
                {statisticsData?.summary?.resolutionRate ?? 100}%
              </div>
              <div style={{ fontSize: "0.75rem", color: "#38bdf8", marginTop: "4px" }}>
                전체 오류 건 대비 조치 완료율
              </div>
            </div>
          </div>

          {/* 개인별 알람 통계 테이블 */}
          <div className="card" style={{ border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ fontSize: "1.15rem", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>👥</span> 팀원별 작업기록 알람 카운트 및 해결률
              </h2>
              <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                총 {statisticsData?.userStats?.length || 0}명의 작업자 집계됨
              </span>
            </div>

            {(!statisticsData?.userStats || statisticsData.userStats.length === 0) ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                {isLoadingStats ? "통계 데이터를 불러오는 중입니다..." : "선택한 기간 동안 발생한 작업기록 알람이 없습니다. (아주 양호합니다! 🎉)"}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <thead>
                    <tr style={{ background: "#1e293b", textAlign: "left", color: "#cbd5e1" }}>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155", width: "60px" }}>순위</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155" }}>담당자 (파트)</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155", textAlign: "center" }}>총 알람</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155" }}>미등록 프로젝트</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155" }}>작업유형 포맷오류</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155", textAlign: "center" }}>미해결</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155", textAlign: "center" }}>해결됨</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155", width: "180px" }}>조치율</th>
                      <th style={{ padding: "10px 14px", borderBottom: "1px solid #334155", textAlign: "center" }}>필터</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statisticsData.userStats.map((u, idx) => (
                      <tr 
                        key={u.author}
                        style={{ 
                          borderBottom: "1px solid #1e293b",
                          background: selectedAuthor === u.author ? "rgba(56, 189, 248, 0.1)" : "transparent"
                        }}
                      >
                        <td style={{ padding: "12px 14px", color: idx < 3 ? "#fbbf24" : "#94a3b8", fontWeight: 700 }}>
                          #{idx + 1}
                        </td>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: "#f8fafc" }}>
                          {u.author} <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontWeight: 400 }}>({u.part})</span>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 700, color: u.total > 0 ? "#f8fafc" : "#64748b" }}>
                          {u.total}건
                        </td>
                        <td style={{ padding: "12px 14px", color: u.byType.INVALID_PROJECT > 0 ? "#fca5a5" : "#64748b" }}>
                          {u.byType.INVALID_PROJECT > 0 ? `🚨 ${u.byType.INVALID_PROJECT}건` : "-"}
                        </td>
                        <td style={{ padding: "12px 14px", color: u.byType.INVALID_TASK_TYPE > 0 ? "#fdba74" : "#64748b" }}>
                          {u.byType.INVALID_TASK_TYPE > 0 ? `⚠️ ${u.byType.INVALID_TASK_TYPE}건` : "-"}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          {u.openCount > 0 ? (
                            <span style={{ background: "#ef4444", color: "white", padding: "2px 8px", borderRadius: "10px", fontSize: "0.75rem", fontWeight: 800 }}>
                              {u.openCount}건
                            </span>
                          ) : (
                            <span style={{ color: "#64748b", fontSize: "0.8rem" }}>0</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center", color: "#34d399", fontWeight: 600 }}>
                          {u.resolvedCount}건
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ flex: 1, height: "6px", background: "#334155", borderRadius: "3px", overflow: "hidden" }}>
                              <div style={{ width: `${u.resolutionRate}%`, height: "100%", background: u.resolutionRate >= 80 ? "#10b981" : u.resolutionRate >= 50 ? "#f59e0b" : "#ef4444" }} />
                            </div>
                            <span style={{ fontSize: "0.78rem", color: "#cbd5e1", minWidth: "40px" }}>{u.resolutionRate}%</span>
                          </div>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <button
                            onClick={() => setSelectedAuthor(selectedAuthor === u.author ? "" : u.author)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "4px",
                              border: selectedAuthor === u.author ? "1px solid #38bdf8" : "1px solid #475569",
                              background: selectedAuthor === u.author ? "rgba(56, 189, 248, 0.2)" : "#1e293b",
                              color: selectedAuthor === u.author ? "#38bdf8" : "#94a3b8",
                              fontSize: "0.75rem",
                              cursor: "pointer"
                            }}
                          >
                            {selectedAuthor === u.author ? "선택해제" : "내역보기"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 오류 유형별 분포 및 일자별 발생 추이 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "16px" }}>
            <div className="card" style={{ border: "1px solid #334155" }}>
              <h3 style={{ fontSize: "1rem", marginTop: 0, marginBottom: "1rem", color: "#f8fafc" }}>
                🏷️ 오류 유형별 점유율
              </h3>
              {(!statisticsData?.typeDistribution || statisticsData.typeDistribution.length === 0) ? (
                <div style={{ color: "#64748b", padding: "20px 0", textAlign: "center" }}>데이터가 없습니다.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {statisticsData.typeDistribution.map(t => (
                    <div key={t.type}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "4px" }}>
                        <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{t.label}</span>
                        <span style={{ color: "#94a3b8" }}>{t.count}건 ({t.percentage}%)</span>
                      </div>
                      <div style={{ height: "8px", background: "#334155", borderRadius: "4px", overflow: "hidden" }}>
                        <div 
                          style={{ 
                            width: `${t.percentage}%`, 
                            height: "100%", 
                            background: t.type === 'INVALID_PROJECT' ? '#ef4444' : t.type === 'INVALID_TASK_TYPE' ? '#f59e0b' : '#3b82f6' 
                          }} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ border: "1px solid #334155" }}>
              <h3 style={{ fontSize: "1rem", marginTop: 0, marginBottom: "1rem", color: "#f8fafc" }}>
                📅 일자별 알람 발생 추이
              </h3>
              {(!statisticsData?.dailyTrends || statisticsData.dailyTrends.length === 0) ? (
                <div style={{ color: "#64748b", padding: "20px 0", textAlign: "center" }}>데이터가 없습니다.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px", overflowY: "auto", paddingRight: "4px" }}>
                  {statisticsData.dailyTrends.map(d => (
                    <div key={d.date} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.82rem", padding: "6px 10px", background: "#0f172a", borderRadius: "4px" }}>
                      <span style={{ color: "#cbd5e1", fontWeight: 500 }}>{d.date}</span>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        {d.openCount > 0 && (
                          <span style={{ color: "#f87171", fontSize: "0.75rem", background: "rgba(239,68,68,0.2)", padding: "2px 6px", borderRadius: "4px" }}>
                            🚨 미해결 {d.openCount}
                          </span>
                        )}
                        <span style={{ color: "#34d399", fontSize: "0.75rem", background: "rgba(16,185,129,0.2)", padding: "2px 6px", borderRadius: "4px" }}>
                          ✓ 해결 {d.resolvedCount}
                        </span>
                        <span style={{ fontWeight: 700, color: "#f8fafc", minWidth: "30px", textAlign: "right" }}>
                          {d.total}건
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 상세 알람 로그 테이블 */}
          <div className="card" style={{ border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "8px" }}>
              <h2 style={{ fontSize: "1.15rem", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📜</span> 상세 알람 내역 이력
                {selectedAuthor && (
                  <span style={{ fontSize: "0.85rem", color: "#38bdf8", fontWeight: 500 }}>
                    ({selectedAuthor} 님 필터링 중)
                  </span>
                )}
              </h2>

              <div style={{ display: "flex", gap: "6px" }}>
                {[
                  { id: "all", label: "전체" },
                  { id: "open", label: "🚨 미해결만" },
                  { id: "resolved", label: "✨ 해결완료만" },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setLogFilterStatus(f.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "4px",
                      border: logFilterStatus === f.id ? "1px solid #38bdf8" : "1px solid #475569",
                      background: logFilterStatus === f.id ? "rgba(56, 189, 248, 0.2)" : "#1e293b",
                      color: logFilterStatus === f.id ? "#38bdf8" : "#cbd5e1",
                      fontSize: "0.78rem",
                      cursor: "pointer"
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                해당 조건의 알람 기록이 없습니다.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#1e293b", textAlign: "left", color: "#cbd5e1" }}>
                      <th style={{ padding: "10px", borderBottom: "1px solid #334155", width: "95px" }}>작업일자</th>
                      <th style={{ padding: "10px", borderBottom: "1px solid #334155", width: "80px" }}>작성자</th>
                      <th style={{ padding: "10px", borderBottom: "1px solid #334155", width: "110px" }}>이슈키</th>
                      <th style={{ padding: "10px", borderBottom: "1px solid #334155" }}>오류 제목 및 내용</th>
                      <th style={{ padding: "10px", borderBottom: "1px solid #334155", width: "135px", textAlign: "center" }}>상태 / 조치</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <tr key={log.id} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "10px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                          {log.worklog_date}
                        </td>
                        <td style={{ padding: "10px", fontWeight: 600, color: "#f8fafc" }}>
                          {log.author}
                        </td>
                        <td style={{ padding: "10px", color: "#60a5fa", fontWeight: 600 }}>
                          {log.issue_key}
                        </td>
                        <td style={{ padding: "10px" }}>
                          <div style={{ fontWeight: 600, color: log.status === 'open' ? '#fca5a5' : '#e2e8f0', marginBottom: "2px" }}>
                            {log.title}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                            {log.message}
                          </div>
                          {log.comment && (
                            <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "#cbd5e1", background: "rgba(0,0,0,0.3)", padding: "4px 8px", borderRadius: "4px", fontStyle: "italic" }}>
                              코멘트: "{log.comment}"
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                            {log.status === 'open' ? (
                              <>
                                <span style={{ background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", border: "1px solid #ef4444", padding: "3px 8px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}>
                                  🚨 미해결
                                </span>
                                <button
                                  onClick={() => handleUpdateLogStatus(log.id, log.alert_key, 'resolved')}
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "4px",
                                    background: "rgba(16, 185, 129, 0.2)",
                                    border: "1px solid #10b981",
                                    color: "#34d399",
                                    fontSize: "0.72rem",
                                    fontWeight: 600,
                                    cursor: "pointer"
                                  }}
                                  title="Jira에서 수정을 완료한 경우 클릭하여 해결 완료 상태로 수동 변경합니다"
                                >
                                  ✓ 해결 완료 처리
                                </button>
                              </>
                            ) : (
                              <>
                                <span style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399", border: "1px solid #10b981", padding: "3px 8px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }} title={log.resolved_at ? `해결시각: ${log.resolved_at}` : ''}>
                                  ✨ 해결완료
                                </span>
                                <button
                                  onClick={() => handleUpdateLogStatus(log.id, log.alert_key, 'open')}
                                  style={{
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "transparent",
                                    border: "1px solid #475569",
                                    color: "#94a3b8",
                                    fontSize: "0.70rem",
                                    cursor: "pointer"
                                  }}
                                  title="다시 미해결 상태로 변경합니다"
                                >
                                  ↺ 미해결로 복원
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          탭 3: 📋 인사평가 데이터 분석 (1·3·4번 지표 특화)
      ══════════════════════════════════════════════════════════ */}
      {activeTab === "hr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* 인사평가 기준 안내 배너 */}
          <div className="card" style={{ 
            background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", 
            border: "1px solid #334155",
            padding: "20px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
              <div>
                <h2 style={{ fontSize: "1.25rem", margin: "0 0 6px 0", color: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🎯</span> 인사평가(HR) 3대 핵심 분석 지표 가이드
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "0.88rem", margin: 0, lineHeight: 1.5 }}>
                  구성원의 업무 성실도, 프로젝트 성과 기여도, 업무 밸런스를 객관적인 데이터로 다면 평가하기 위한 전용 스코어카드입니다.
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={handleCopyHrTable}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    background: "rgba(16, 185, 129, 0.2)",
                    border: "1px solid #10b981",
                    color: "#34d399",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                  title="전체 인사평가 표를 엑셀에 바로 붙여넣을 수 있는 형태로 복사합니다"
                >
                  📋 엑셀 양식 클립보드 복사
                </button>
              </div>
            </div>

            {copySuccessMsg && (
              <div style={{ padding: "8px 14px", background: "rgba(16, 185, 129, 0.25)", border: "1px solid #10b981", borderRadius: "6px", color: "#a7f3d0", fontSize: "0.85rem", marginBottom: "12px" }}>
                {copySuccessMsg}
              </div>
            )}

            {/* 3대 지표 설명 카드 3열 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px", marginTop: "10px" }}>
              <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "8px", padding: "14px" }}>
                <div style={{ color: "#60a5fa", fontWeight: 700, fontSize: "0.92rem", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⚡</span> [지표 1] 피드백 수용도 및 MTTR
                </div>
                <div style={{ fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.4 }}>
                  오류 알림 발생 후 Jira 코멘트를 정상 수정할 때까지 걸린 <b>평균 소요 시간(MTTR)</b> 및 <b>당일(24h) 내 해결률</b>을 측정하여 업무 피드백 수용성과 책임감을 평가합니다.
                </div>
              </div>

              <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "8px", padding: "14px" }}>
                <div style={{ color: "#34d399", fontWeight: 700, fontSize: "0.92rem", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🏆</span> [지표 3] 계약과제 성과 기여도
                </div>
                <div style={{ fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.4 }}>
                  실제 투입된 공수(M/M)를 바탕으로 <b>핵심 주력 계약과제 집중도</b>와 <b>팀 전체 과제 공수 중 개인 기여율(%)</b>을 평가하여 실질적 성과 창출 기여도를 산출합니다.
                </div>
              </div>

              <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: "8px", padding: "14px" }}>
                <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.92rem", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⚖️</span> [지표 4] 업무 집중도 & 멀티태스킹 (CSI)
                </div>
                <div style={{ fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.4 }}>
                  일평균 다룬 이슈/과제 수를 기반으로 <b>컨텍스트 스위칭 지수(CSI)</b>와 <b>업무 스타일(단일집중형 vs 균형형 vs 다과제지원형)</b> 및 과다 근무(9h+) 일수를 분석합니다.
                </div>
              </div>
            </div>
          </div>

          {/* 평가 기간 및 필터 바 */}
          <div className="card" style={{ padding: "14px 20px", background: "#1e293b", border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "0.85rem", color: "#94a3b8", fontWeight: 600, marginRight: "4px" }}>평가 대상 기간:</span>
                {[
                  { id: "30days", label: "최근 30일" },
                  { id: "thisMonth", label: "이번 달" },
                  { id: "quarter", label: "이번 분기(Quarter)" },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleQuickPeriod(p.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: statsPeriod === p.id ? "1px solid #38bdf8" : "1px solid #475569",
                      background: statsPeriod === p.id ? "rgba(56, 189, 248, 0.2)" : "#0f172a",
                      color: statsPeriod === p.id ? "#38bdf8" : "#cbd5e1",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setStatsPeriod("custom");
                    }}
                    style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: "6px", padding: "5px 8px", color: "#f8fafc", fontSize: "0.82rem" }}
                  />
                  <span style={{ color: "#94a3b8" }}>~</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setStatsPeriod("custom");
                    }}
                    style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: "6px", padding: "5px 8px", color: "#f8fafc", fontSize: "0.82rem" }}
                  />
                </div>

                <select
                  value={selectedAuthor}
                  onChange={(e) => setSelectedAuthor(e.target.value)}
                  style={{ background: "#0f172a", border: "1px solid #475569", borderRadius: "6px", padding: "5px 10px", color: "#f8fafc", fontSize: "0.82rem" }}
                >
                  <option value="">👤 전체 팀원</option>
                  {users.filter(u => u.is_active).map(u => (
                    <option key={u.id} value={u.name}>{u.name} ({u.part})</option>
                  ))}
                </select>

                <button
                  onClick={fetchStatistics}
                  disabled={isLoadingStats}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    background: "#2563eb",
                    border: "none",
                    color: "white",
                    fontWeight: 600,
                    fontSize: "0.82rem",
                    cursor: isLoadingStats ? "wait" : "pointer"
                  }}
                >
                  {isLoadingStats ? "분석 중..." : "🔄 재분석"}
                </button>
              </div>
            </div>
          </div>

          {/* 인사평가 종합 스코어카드 테이블 */}
          <div className="card" style={{ border: "1px solid #334155" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ fontSize: "1.15rem", margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>📊</span> 팀원별 인사평가 데이터 종합 스코어카드
                </h2>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#94a3b8" }}>
                  종합점수 = 피드백신속도(35%) + 과제성과기여도(35%) + 업무밸런스(30%)
                </p>
              </div>
              <span style={{ fontSize: "0.82rem", color: "#38bdf8", fontWeight: 600 }}>
                평가 인원: {statisticsData?.hrEvaluation?.length || 0}명
              </span>
            </div>

            {(!statisticsData?.hrEvaluation || statisticsData.hrEvaluation.length === 0) ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                {isLoadingStats ? "인사평가 데이터를 집계 및 분석 중입니다..." : "선택한 기간 동안 평가 대상 데이터가 없습니다."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                  <thead>
                    <tr style={{ background: "#1e293b", textAlign: "left", color: "#cbd5e1" }}>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", width: "50px", textAlign: "center" }}>순위</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", width: "65px", textAlign: "center" }}>등급</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", width: "120px" }}>성명 (파트)</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", width: "75px", textAlign: "center" }}>종합점수</th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", background: "rgba(59, 130, 246, 0.08)" }}>
                        [1] MTTR / 당일조치율
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", background: "rgba(16, 185, 129, 0.08)" }}>
                        [3] 주력과제 / 공수(MM) / 기여율
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", background: "rgba(245, 158, 11, 0.08)" }}>
                        [4] CSI 지수 / 업무 스타일
                      </th>
                      <th style={{ padding: "10px 12px", borderBottom: "1px solid #334155", textAlign: "center", width: "80px" }}>
                        상세리포트
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {statisticsData.hrEvaluation.map((h, idx) => {
                      const gradeBg = h.grade === 'S' ? 'linear-gradient(135deg, #10b981, #059669)'
                                    : h.grade === 'A' ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                                    : h.grade === 'B' ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                    : '#64748b';

                      return (
                        <tr 
                          key={h.author}
                          style={{ 
                            borderBottom: "1px solid #1e293b",
                            background: selectedHrUser?.author === h.author ? "rgba(56, 189, 248, 0.12)" : "transparent"
                          }}
                        >
                          <td style={{ padding: "12px", textAlign: "center", color: idx < 3 ? "#fbbf24" : "#94a3b8", fontWeight: 700 }}>
                            #{idx + 1}
                          </td>
                          <td style={{ padding: "12px", textAlign: "center" }}>
                            <span style={{ 
                              background: gradeBg, 
                              color: "white", 
                              fontWeight: 800, 
                              fontSize: "0.78rem", 
                              padding: "3px 8px", 
                              borderRadius: "4px",
                              display: "inline-block",
                              minWidth: "22px"
                            }}>
                              {h.grade}
                            </span>
                          </td>
                          <td style={{ padding: "12px", fontWeight: 600, color: "#f8fafc" }}>
                            {h.author}
                            <div style={{ fontSize: "0.74rem", color: "#94a3b8", fontWeight: 400 }}>{h.part}</div>
                          </td>
                          <td style={{ padding: "12px", textAlign: "center", fontWeight: 800, fontSize: "1rem", color: h.totalScore >= 80 ? "#34d399" : "#f8fafc" }}>
                            {h.totalScore}
                            <span style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 400 }}>점</span>
                          </td>

                          {/* 1번 지표 셀 */}
                          <td style={{ padding: "12px", background: "rgba(59, 130, 246, 0.03)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontWeight: 600, color: "#93c5fd" }}>
                                ⏱️ {h.indicator1.avgTimeFormatted}
                              </span>
                              <span style={{ fontSize: "0.78rem", color: "#cbd5e1" }}>
                                (당일해결: {h.indicator1.sameDayRate}%)
                              </span>
                            </div>
                            <div style={{ fontSize: "0.74rem", color: h.indicator1.openAlerts > 0 ? "#f87171" : "#6ee7b7", marginTop: "2px" }}>
                              {h.indicator1.openAlerts > 0 ? `🚨 미해결 ${h.indicator1.openAlerts}건 방치` : "✓ 미해결 0건 (모두 해결됨)"}
                            </div>
                          </td>

                          {/* 3번 지표 셀 */}
                          <td style={{ padding: "12px", background: "rgba(16, 185, 129, 0.03)" }}>
                            <div style={{ fontWeight: 600, color: "#6ee7b7", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span>{h.indicator3.primaryProjectCode}</span>
                              <span style={{ fontSize: "0.78rem", color: "#34d399", background: "rgba(16,185,129,0.15)", padding: "1px 6px", borderRadius: "3px" }}>
                                {h.indicator3.primaryRatio}% 집중
                              </span>
                            </div>
                            <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: "2px" }}>
                              총 {h.indicator3.totalHours}h ({h.indicator3.totalMM} MM) · 팀내기여율: {h.indicator3.primaryProjectShare}%
                            </div>
                          </td>

                          {/* 4번 지표 셀 */}
                          <td style={{ padding: "12px", background: "rgba(245, 158, 11, 0.03)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontWeight: 700, color: "#fcd34d" }}>
                                CSI {h.indicator4.csi}
                              </span>
                              <span style={{ fontSize: "0.75rem", color: "#f8fafc", background: "rgba(245,158,11,0.2)", padding: "1px 6px", borderRadius: "3px" }}>
                                {h.indicator4.workStyle}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: "2px" }}>
                              일평균 이슈 {h.indicator4.avgIssuesPerDay}개 · 과제 {h.indicator4.avgProjectsPerDay}개 {h.indicator4.overworkDays > 0 ? `(과다근무 ${h.indicator4.overworkDays}일)` : ''}
                            </div>
                          </td>

                          {/* 상세 버튼 */}
                          <td style={{ padding: "12px", textAlign: "center" }}>
                            <button
                              onClick={() => setSelectedHrUser(selectedHrUser?.author === h.author ? null : h)}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "4px",
                                border: selectedHrUser?.author === h.author ? "1px solid #38bdf8" : "1px solid #475569",
                                background: selectedHrUser?.author === h.author ? "#38bdf8" : "#1e293b",
                                color: selectedHrUser?.author === h.author ? "#0f172a" : "#cbd5e1",
                                fontWeight: 700,
                                fontSize: "0.76rem",
                                cursor: "pointer"
                              }}
                            >
                              {selectedHrUser?.author === h.author ? "닫기" : "심층분석"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 선택된 팀원 3대 지표 심층 인사평가 리포트 패널 */}
          {selectedHrUser && (
            <div className="card" style={{ 
              background: "linear-gradient(180deg, #182235 0%, #0f172a 100%)", 
              border: "1.5px solid #38bdf8", 
              borderRadius: "10px",
              padding: "24px",
              boxShadow: "0 8px 24px rgba(56, 189, 248, 0.15)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", borderBottom: "1px solid #334155", paddingBottom: "14px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h3 style={{ margin: 0, fontSize: "1.3rem", color: "#f8fafc" }}>
                      👤 {selectedHrUser.author} 님의 인사평가 종합 프로필
                    </h3>
                    <span style={{ 
                      background: selectedHrUser.grade === 'S' ? '#10b981' : selectedHrUser.grade === 'A' ? '#3b82f6' : '#f59e0b',
                      color: "white", 
                      fontWeight: 800, 
                      padding: "2px 10px", 
                      borderRadius: "4px",
                      fontSize: "0.85rem"
                    }}>
                      등급: {selectedHrUser.grade} ({selectedHrUser.totalScore}점)
                    </span>
                    <span style={{ color: "#94a3b8", fontSize: "0.88rem" }}>
                      소속: {selectedHrUser.part}
                    </span>
                  </div>
                  <p style={{ margin: "6px 0 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>
                    평가 기간: {startDate} ~ {endDate} ({selectedHrUser.indicator4.workingDays}일 근무 데이터 분석됨)
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedHrUser(null)}
                  style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "1.2rem", padding: "4px 8px" }}
                >
                  ✕
                </button>
              </div>

              {/* 3대 지표 심층 비교 카드 3열 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                {/* 1번 지표 카드 */}
                <div style={{ background: "#1e293b", border: "1px solid rgba(59, 130, 246, 0.4)", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 700, color: "#60a5fa", fontSize: "0.95rem" }}>
                      ⚡ [지표 1] 피드백 속도 & MTTR
                    </span>
                    <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#38bdf8" }}>
                      {selectedHrUser.indicator1.score}점
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.85rem", color: "#cbd5e1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>평균 오류 수정 시간 (MTTR):</span>
                      <strong style={{ color: "#f8fafc" }}>{selectedHrUser.indicator1.avgTimeFormatted}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>당일(24h) 내 해결률:</span>
                      <strong style={{ color: selectedHrUser.indicator1.sameDayRate >= 80 ? "#34d399" : "#f87171" }}>
                        {selectedHrUser.indicator1.sameDayRate}%
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>총 위반 알림 건수:</span>
                      <span>{selectedHrUser.indicator1.totalAlerts}건 (해결: {selectedHrUser.indicator1.resolvedAlerts}건)</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>현재 미해결 방치 건수:</span>
                      <strong style={{ color: selectedHrUser.indicator1.openAlerts > 0 ? "#ef4444" : "#34d399" }}>
                        {selectedHrUser.indicator1.openAlerts}건
                      </strong>
                    </div>
                  </div>
                  <div style={{ marginTop: "12px", padding: "8px 10px", background: "rgba(59,130,246,0.1)", borderRadius: "6px", fontSize: "0.78rem", color: "#93c5fd" }}>
                    💡 <b>평가 가이드</b>: {selectedHrUser.indicator1.openAlerts === 0 ? "오류 발생 시 즉각적으로 코멘트를 수정하여 매우 우수한 피드백 태도를 보입니다." : "미해결 방치 건이 존재하여 규칙 준수 및 신속한 조치 지도가 권장됩니다."}
                  </div>
                </div>

                {/* 3번 지표 카드 */}
                <div style={{ background: "#1e293b", border: "1px solid rgba(16, 185, 129, 0.4)", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 700, color: "#34d399", fontSize: "0.95rem" }}>
                      🏆 [지표 3] 계약과제 성과 기여도
                    </span>
                    <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#10b981" }}>
                      {selectedHrUser.indicator3.score}점
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.85rem", color: "#cbd5e1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>총 실투입 공수:</span>
                      <strong style={{ color: "#f8fafc" }}>{selectedHrUser.indicator3.totalHours}시간 ({selectedHrUser.indicator3.totalMM} MM)</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>핵심 주력 계약과제:</span>
                      <strong style={{ color: "#6ee7b7" }}>{selectedHrUser.indicator3.primaryProjectCode}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>주력 과제 집중도:</span>
                      <strong style={{ color: "#34d399" }}>{selectedHrUser.indicator3.primaryRatio}%</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>해당 과제 내 개인 기여율:</span>
                      <strong style={{ color: "#38bdf8" }}>{selectedHrUser.indicator3.primaryProjectShare}%</strong>
                    </div>
                  </div>
                  <div style={{ marginTop: "12px", padding: "8px 10px", background: "rgba(16,185,129,0.1)", borderRadius: "6px", fontSize: "0.78rem", color: "#a7f3d0" }}>
                    💡 <b>평가 가이드</b>: {selectedHrUser.indicator3.primaryRatio >= 60 ? `[${selectedHrUser.indicator3.primaryProjectCode}] 핵심 과제 전담 주력 인력으로 프로젝트 공수에 크게 기여함.` : "다수의 과제를 폭넓게 지원하는 멀티 프로젝트 기여 성향을 보임."}
                  </div>
                </div>

                {/* 4번 지표 카드 */}
                <div style={{ background: "#1e293b", border: "1px solid rgba(245, 158, 11, 0.4)", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 700, color: "#fbbf24", fontSize: "0.95rem" }}>
                      ⚖️ [지표 4] 업무 스타일 & CSI
                    </span>
                    <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f59e0b" }}>
                      {selectedHrUser.indicator4.score}점
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.85rem", color: "#cbd5e1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>멀티태스킹 지수(CSI):</span>
                      <strong style={{ color: "#fcd34d" }}>{selectedHrUser.indicator4.csi}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>업무 스타일 분류:</span>
                      <strong style={{ color: "#f8fafc" }}>{selectedHrUser.indicator4.workStyle}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>일평균 다룬 이슈/과제 수:</span>
                      <span>이슈 {selectedHrUser.indicator4.avgIssuesPerDay}개 / 과제 {selectedHrUser.indicator4.avgProjectsPerDay}개</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>근무 패턴 (적정 vs 과다):</span>
                      <span>적정(7~9h) {selectedHrUser.indicator4.regularDays}일 / 초과(9h+) {selectedHrUser.indicator4.overworkDays}일</span>
                    </div>
                  </div>
                  <div style={{ marginTop: "12px", padding: "8px 10px", background: "rgba(245,158,11,0.1)", borderRadius: "6px", fontSize: "0.78rem", color: "#fde68a" }}>
                    💡 <b>평가 가이드</b>: {selectedHrUser.indicator4.workStyleDesc}
                  </div>
                </div>
              </div>

              {/* 과제별 세부 투입 현황 목록 */}
              {selectedHrUser.indicator3.projectList.length > 0 && (
                <div style={{ background: "#0f172a", borderRadius: "8px", padding: "14px", border: "1px solid #1e293b" }}>
                  <h4 style={{ margin: "0 0 10px 0", color: "#f8fafc", fontSize: "0.9rem" }}>
                    📁 과제별 투입 시간 및 기여 비중
                  </h4>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {selectedHrUser.indicator3.projectList.map(p => (
                      <div key={p.code} style={{ background: "#1e293b", padding: "6px 12px", borderRadius: "6px", border: "1px solid #334155", fontSize: "0.8rem" }}>
                        <span style={{ color: "#93c5fd", fontWeight: 600 }}>{p.code}</span>: {p.hours}h ({p.mm} MM)
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
