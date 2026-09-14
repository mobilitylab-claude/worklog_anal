"use client";

import { useState, useEffect } from "react";

export default function Header() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // DB에서 계정 정보 불러오기 & 필요시 localStorage에서 자동 마이그레이션
  const loadAccounts = async () => {
    try {
      const res = await fetch("/api/jira-accounts?includeRaw=true");
      const data = await res.json();

      if (data.success && data.accounts && data.accounts.length > 0) {
        setAccounts(data.accounts);
        setActiveId(data.activeId);
        // localStorage에도 동기화 캐시
        localStorage.setItem("jiraAccounts", JSON.stringify(data.accounts));
        if (data.activeId) localStorage.setItem("jiraActiveId", data.activeId);
      } else {
        // DB가 비어있고 localStorage에 기존 계정이 남아있다면 자동 마이그레이션 실행
        const stored = localStorage.getItem("jiraAccounts");
        const localActive = localStorage.getItem("jiraActiveId");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) {
              await fetch("/api/jira-accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accounts: parsed, activeId: localActive })
              });
              // 마이그레이션 후 다시 조회
              const reRes = await fetch("/api/jira-accounts?includeRaw=true");
              const reData = await reRes.json();
              if (reData.success) {
                setAccounts(reData.accounts);
                setActiveId(reData.activeId);
              }
            }
          } catch (migrateErr) {
            console.error("로컬 계정 DB 마이그레이션 실패:", migrateErr);
          }
        }
      }
    } catch (err) {
      console.error("계정 목록 로드 실패:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleAddAccount = async () => {
    const name = prompt("사용자 이름(또는 별칭)을 입력하세요:");
    if (!name) return;
    const token = prompt(`${name}의 Jira Personal Access Token(PAT)을 입력하세요:`);
    if (!token) return;

    try {
      const res = await fetch("/api/jira-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), token: token.trim() })
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ 계정이 DB에 암호화되어 안전하게 등록되었습니다.");
        await loadAccounts();
      } else {
        alert("등록 실패: " + data.error);
      }
    } catch (e) {
      alert("오류: " + e.message);
    }
  };

  const handleEditToken = async (id, e) => {
    e.stopPropagation();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    const newToken = prompt(`${acc.name}의 새로운 Jira PAT를 입력하세요:`);
    if (!newToken) return;

    try {
      const res = await fetch("/api/jira-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "updateToken", token: newToken.trim() })
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ 토큰이 DB에 암호화되어 업데이트되었습니다.");
        await loadAccounts();
      } else {
        alert("수정 실패: " + data.error);
      }
    } catch (e) {
      alert("오류: " + e.message);
    }
  };

  const handleDeleteAccount = async (id, e) => {
    e.stopPropagation();
    if (!confirm("이 계정을 DB에서 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/jira-accounts?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        alert("✅ 계정이 삭제되었습니다.");
        await loadAccounts();
      } else {
        alert("삭제 실패: " + data.error);
      }
    } catch (e) {
      alert("오류: " + e.message);
    }
  };

  const handleSelectAccount = async (id) => {
    try {
      const res = await fetch("/api/jira-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "setActive" })
      });
      const data = await res.json();
      if (data.success) {
        setActiveId(id);
        localStorage.setItem("jiraActiveId", id);
        setShowDropdown(false);
        window.location.reload();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const activeAccount = accounts.find(a => a.id === activeId);

  return (
    <header className="header" style={{ position: "relative", zIndex: 1000 }}>
      <div className="header-search">
        <input type="text" placeholder="Jira 검색 (추후 연동)..." />
      </div>
      <div className="header-user" style={{ position: "relative" }}>
        <div 
          className="avatar" 
          onClick={() => setShowDropdown(!showDropdown)}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem", background: "rgba(59, 130, 246, 0.15)", borderRadius: "20px", border: "1px solid rgba(59, 130, 246, 0.5)", fontWeight: "bold", whiteSpace: "nowrap" }}
        >
          {activeAccount ? `👤 ${activeAccount.name}` : "⚠️ 사용자 미설정"}
        </div>

        {showDropdown && (
          <div style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "0.5rem",
            background: "#1e1e2d",
            border: "1px solid #333",
            borderRadius: "8px",
            width: "250px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            overflow: "hidden"
          }}>
            <div style={{ padding: "0.8rem", background: "#252538", borderBottom: "1px solid #333", fontSize: "0.9rem", color: "#aaa" }}>
              Jira 사용자 전환
            </div>
            {accounts.length === 0 ? (
              <div style={{ padding: "1rem", fontSize: "0.85rem", color: "#666", textAlign: "center" }}>등록된 계정이 없습니다.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {accounts.map(acc => (
                  <li 
                    key={acc.id} 
                    onClick={() => handleSelectAccount(acc.id)}
                    style={{ 
                      padding: "0.8rem 1rem", 
                      cursor: "pointer", 
                      display: "flex", 
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: activeId === acc.id ? "rgba(59, 130, 246, 0.2)" : "transparent",
                      borderBottom: "1px solid #2a2a3a",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => { if(activeId !== acc.id) e.currentTarget.style.background = "#2a2a3a"; }}
                    onMouseLeave={(e) => { if(activeId !== acc.id) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div>
                      <span style={{ fontSize: "0.9rem", color: "white" }}>{acc.name}</span>
                      {activeId === acc.id && <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "#3b82f6", background: "rgba(59,130,246,0.2)", padding: "2px 6px", borderRadius: "12px" }}>현재</span>}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button 
                        onClick={(e) => handleEditToken(acc.id, e)}
                        title="API 토큰 수정"
                        style={{ background: "transparent", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: "0.8rem", padding: "4px" }}
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={(e) => handleDeleteAccount(acc.id, e)}
                        title="계정 삭제"
                        style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.8rem", padding: "4px" }}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div 
              onClick={handleAddAccount}
              style={{ padding: "0.8rem", textAlign: "center", cursor: "pointer", background: "rgba(16, 185, 129, 0.1)", color: "#10b981", fontSize: "0.85rem", fontWeight: "bold" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(16, 185, 129, 0.2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(16, 185, 129, 0.1)"}
            >
              + 새 사용자 추가
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
