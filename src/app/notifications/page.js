"use client";

import { useState } from "react";

export default function NotificationsPage() {
  const [webhookUrl, setWebhookUrl] = useState("http://<your-linux-ip>:<port>/api/webhook/jira");

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: "2rem" }}>
        <h1>🔔 JIRA 알림 관리</h1>
        <p>Jira 이벤트 모니터링 규칙을 설정하고, PC 클라이언트로 전송할 알림 항목을 관리합니다.</p>
      </div>

      <div className="card" style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>알림 서버 설정 (Webhook)</h2>
        <p style={{ color: "#aaa", fontSize: "0.9rem", marginBottom: "1rem" }}>
          Jira 시스템 설정(Webhook)에서 아래 URL로 이벤트를 전송하도록 구성해야 합니다.<br/>
          * 사내망 방화벽 허용 여부에 따라 백그라운드 Polling 방식으로 대체될 수 있습니다.
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
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>활성화된 알림 규칙</h2>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#222", textAlign: "left" }}>
              <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>규칙 이름</th>
              <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>트리거 조건</th>
              <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>대상 프로젝트</th>
              <th style={{ padding: "1rem", borderBottom: "1px solid #333" }}>상태</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>관리필요 이슈 발생 알림</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>상태 변경 (Status changes to '지연/위험')</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>전체</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}><span style={{ background: "rgba(16,185,129,0.2)", color: "#34d399", padding: "4px 8px", borderRadius: "4px" }}>활성</span></td>
            </tr>
            <tr>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>새로운 버그 등록 알림</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>이슈 생성 (IssueType = 'Bug')</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>WEB_APP</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}><span style={{ background: "rgba(16,185,129,0.2)", color: "#34d399", padding: "4px 8px", borderRadius: "4px" }}>활성</span></td>
            </tr>
            <tr>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>워크로그 미기재 경고</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>매일 오후 5시 체크 (스케줄)</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}>전체</td>
              <td style={{ padding: "1rem", borderBottom: "1px solid #222" }}><span style={{ background: "rgba(255,255,255,0.1)", color: "#aaa", padding: "4px 8px", borderRadius: "4px" }}>준비중</span></td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: "1rem", textAlign: "right" }}>
          <button style={{ padding: "0.6rem 1.2rem", borderRadius: "8px", background: "#333", color: "white", border: "1px solid #444", cursor: "pointer" }}>+ 새 알림 규칙 추가</button>
        </div>
      </div>
      
      <div className="card" style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>접속된 PC 클라이언트 현황 (Tauri 앱)</h2>
        <div style={{ padding: "1rem", background: "rgba(59,130,246,0.1)", borderRadius: "8px", border: "1px solid rgba(59,130,246,0.2)" }}>
           <p style={{ color: "#60a5fa", marginBottom: "0.5rem" }}>ℹ️ 현재 Server-Sent Events(SSE)로 연결된 PC 목록입니다.</p>
           <ul style={{ color: "#ccc", paddingLeft: "1.5rem" }}>
             <li>현재 접속된 클라이언트가 없습니다. (Windows 앱을 실행해 주세요)</li>
           </ul>
        </div>
      </div>
    </div>
  );
}
