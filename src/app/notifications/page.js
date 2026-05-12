"use client";

import { useState, useEffect } from "react";

export default function NotificationsPage() {
  const [webhookUrl, setWebhookUrl] = useState("http://<your-linux-ip>:3000/api/cron/jira-monitor");
  const [status, setStatus] = useState(null);
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
              placeholder="전체 대상" 
              value={target}
              readOnly
              style={{ 
                flex: 1, 
                padding: "6px 10px", 
                borderRadius: "4px", 
                border: "1px solid #444", 
                background: "#111", 
                color: "#fff",
                fontSize: "0.85rem",
                opacity: isActive ? 1 : 0.5,
                cursor: "default"
              }}
            />
            <button 
              onClick={() => openModal(ruleKey, target)}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                background: "var(--accent-color)",
                color: "#fff",
                border: "none",
                fontSize: "0.8rem",
                cursor: isActive ? "pointer" : "not-allowed",
                fontWeight: "bold",
                opacity: isActive ? 1 : 0.5
              }}
              disabled={!isActive}
            >
              대상 편집
            </button>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#777" }}>비워두면 전체 대상입니다. (⚠️ 규칙이 [활성] 상태여야만 모니터링이 동작합니다)</div>
        </td>
        <td style={{ padding: "1rem", borderBottom: "1px solid #222", textAlign: "center" }}>
          <button 
            onClick={() => toggleRule(ruleKey, isActive)}
            style={{ 
              padding: "6px 12px", 
              borderRadius: "4px", 
              border: "none", 
              cursor: "pointer",
              background: isActive ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
              color: isActive ? "#34d399" : "#f87171",
              fontWeight: "bold"
            }}>
            {isActive ? "활성 (ON)" : "비활성 (OFF)"}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="page-container" style={{ position: "relative" }}>
      {modalOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: "var(--card-bg, #1a1a2e)", border: "1px solid #334", borderRadius: "16px",
            padding: "2rem", width: "90%", maxWidth: "600px", maxHeight: "90vh", overflowY: "auto"
          }}>
            <h2 style={{ marginBottom: "1rem", borderBottom: "1px solid #333", paddingBottom: "0.5rem" }}>👥 알림 대상 선택</h2>
            
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: 600 }}>📁 부서(파트) 단위 일괄 추가</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {partsList.map(p => (
                  <label key={p} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", padding: "4px 10px", borderRadius: "16px", border: `1px solid ${selectedGroups.includes(p) ? "var(--accent-color)" : "#444"}`, background: selectedGroups.includes(p) ? "rgba(59,130,246,0.1)" : "transparent", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedGroups.includes(p)} onChange={() => handleGroupToggle(p)} />
                    <span style={{ color: selectedGroups.includes(p) ? "white" : "gray" }}>{p}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>👤 세별 인원 직접 선택</label>
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
        <h1>🔔 JIRA 알림 규칙 관리</h1>
        <p>Jira 이벤트 모니터링 규칙을 설정하고, Windows PC 클라이언트로 전송할 알림 항목을 실시간으로 제어합니다.</p>
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
          <button style={{ padding: "0.8rem 1.5rem", borderRadius: "8px", background: "var(--accent-color)", color: "white", border: "none", cursor: "pointer", fontWeight: "bold" }}>
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
