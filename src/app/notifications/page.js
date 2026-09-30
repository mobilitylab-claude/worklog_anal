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

  useEffect(() => {
    fetchStatus();
    fetchUsers();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, []);

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
        <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>
          <strong style={{ color: isActive ? "#fff" : "#777" }}>{label}</strong><br/>
          <span style={{ fontSize: "0.85rem", color: "#888" }}>{desc}</span>
        </td>
        <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <input 
              type="text" 
              value={target} 
              readOnly 
              placeholder="전체 대상 (비어있음)" 
              style={{ width: "240px", padding: "0.4rem 0.6rem", borderRadius: "4px", background: "#111", border: "1px solid #444", color: "#ccc", fontSize: "0.85rem" }} 
            />
            <button 
              onClick={() => openModal(ruleKey, target)}
              style={{ padding: "0.4rem 0.8rem", borderRadius: "4px", background: "#333", border: "1px solid #555", color: "white", fontSize: "0.8rem", cursor: "pointer" }}
            >
              대상 설정
            </button>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#777" }}>비워두면 전체 대상입니다. (⚠️ 규칙이 [활성] 상태여야만 모니터링이 동작합니다)</div>
        </td>
        <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>
          <button 
            onClick={() => toggleRule(ruleKey, isActive)}
            style={{ 
              padding: "0.4rem 1rem", 
              borderRadius: "20px", 
              border: "none", 
              cursor: "pointer",
              background: isActive ? "#10b981" : "#4b5563",
              color: "white",
              fontWeight: "bold",
              fontSize: "0.85rem",
              transition: "all 0.2s"
            }}
          >
            {isActive ? "활성" : "비활성"}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="container" style={{ padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
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
      <div className="page-header" style={{ marginBottom: "2rem" }}>
        <h1>🔔 JIRA 알림 및 모니터링 설정</h1>
        <p>Jira 이벤트 모니터링 규칙을 설정하고, Windows PC 클라이언트로 전송할 알림 항목 및 자동 업데이트 주기를 실시간으로 제어합니다.</p>
      </div>

      {/* ── ⏱️ 신규 기능: 자동 업데이트 주기 설정 카드 ── */}
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
      
      <div className="card" style={{ marginTop: "2rem" }}>
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
    </div>
  );
}
