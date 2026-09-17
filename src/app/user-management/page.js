"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { generateSecurePassword, checkPasswordComplexity } from "@/lib/passwordGenerator";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  // ── 필터링 State ──
  const [filterPart, setFilterPart] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL"); // ALL, 1(투입중), 0(미투입)
  const [searchKeyword, setSearchKeyword] = useState("");

  // ── 신규 등록 모달 State ──
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [form, setForm] = useState({ part: "", name: "", dt_account: "", email: "", password: "" });
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // ── 테이블 행별 비밀번호 보기 토글 State (userId -> boolean) ──
  const [visiblePasswords, setVisiblePasswords] = useState({});

  // ── 토스트 알림 State ──
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  // ── 패스워드 생성기 모달 State ──
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState("add");
  const [modalKeyword, setModalKeyword] = useState("");
  const [modalLength, setModalLength] = useState(14);
  const [modalPlacement, setModalPlacement] = useState("prefix");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [showModalPassword, setShowModalPassword] = useState(true);

  // 파트 고유 목록 추출
  const partList = useMemo(() => {
    const parts = new Set(users.map(u => u.part).filter(Boolean));
    return Array.from(parts).sort();
  }, [users]);

  // 필터링된 사용자 목록
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (filterPart !== "ALL" && u.part !== filterPart) return false;
      if (filterStatus !== "ALL") {
        const isActive = u.is_active !== 0;
        if (filterStatus === "1" && !isActive) return false;
        if (filterStatus === "0" && isActive) return false;
      }
      if (searchKeyword.trim()) {
        const q = searchKeyword.trim().toLowerCase();
        const matchName = (u.name || "").toLowerCase().includes(q);
        const matchDt = (u.dt_account || "").toLowerCase().includes(q);
        const matchEmail = (u.email || "").toLowerCase().includes(q);
        const matchPart = (u.part || "").toLowerCase().includes(q);
        if (!matchName && !matchDt && !matchEmail && !matchPart) return false;
      }
      return true;
    });
  }, [users, filterPart, filterStatus, searchKeyword]);

  const resetFilters = () => {
    setFilterPart("ALL");
    setFilterStatus("ALL");
    setSearchKeyword("");
  };

  const openPasswordModal = (target, defaultKeyword = "") => {
    setModalTarget(target);
    const initialKeyword = defaultKeyword || (
      target === "add" ? (form.dt_account || form.name || "") :
      target === "edit" ? (editForm.dt_account || editForm.name || "") :
      (target?.user?.dt_account || target?.user?.name || "")
    );
    setModalKeyword(initialKeyword);
    const initialPwd = generateSecurePassword({
      keyword: initialKeyword,
      targetLength: modalLength,
      keywordPlacement: modalPlacement
    });
    setGeneratedPassword(initialPwd);
    setShowModalPassword(true);
    setIsPasswordModalOpen(true);
  };

  const handleRegenerate = (customKeyword = modalKeyword, customLength = modalLength, customPlacement = modalPlacement) => {
    const pwd = generateSecurePassword({
      keyword: customKeyword,
      targetLength: customLength,
      keywordPlacement: customPlacement
    });
    setGeneratedPassword(pwd);
  };

  const handleApplyPassword = async () => {
    if (!generatedPassword) return;
    if (modalTarget === "add") {
      setForm(prev => ({ ...prev, password: generatedPassword }));
      showToast("등록 폼에 패스워드가 적용되었습니다.");
      setIsPasswordModalOpen(false);
    } else if (modalTarget === "edit") {
      setEditForm(prev => ({ ...prev, password: generatedPassword }));
      showToast("수정 폼에 패스워드가 적용되었습니다.");
      setIsPasswordModalOpen(false);
    } else if (modalTarget?.type === "row" && modalTarget.user) {
      const targetUser = modalTarget.user;
      try {
        setIsSaving(true);
        const res = await fetch("/api/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetUser.id,
            part: targetUser.part,
            name: targetUser.name,
            dt_account: targetUser.dt_account,
            email: targetUser.email,
            is_active: targetUser.is_active,
            password: generatedPassword
          })
        });
        if (!res.ok) throw new Error("패스워드 저장 실패");
        showToast(`'${targetUser.name}' 님의 패스워드가 저장되었습니다.`);
        setIsPasswordModalOpen(false);
        fetchUsers();
      } catch (err) {
        alert("패스워드 업데이트 오류: " + err.message);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const copyToClipboard = async (text, label = "패스워드") => {
    if (!text) return;

    // 1. iframe 환경일 경우 부모 윈도우(Tauri 앱 등)에 복사 위임 요청 전송
    try {
      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'TAURI_COPY_CLIPBOARD', text, label }, '*');
      }
    } catch (e) {
      console.warn("부모 창 메시지 전송 실패:", e);
    }

    // 2. navigator.clipboard.writeText 시도
    let copied = false;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (err) {
        console.warn("navigator.clipboard 실패, execCommand fallback 시도:", err);
      }
    }

    // 3. Fallback: document.execCommand('copy')
    if (!copied && typeof document !== "undefined") {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        textArea.setAttribute("readonly", "");
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999);
        copied = document.execCommand("copy");
        document.body.removeChild(textArea);
      } catch (err) {
        console.error("execCommand fallback 실패:", err);
      }
    }

    if (copied) {
      showToast(`${label}가 클립보드에 복사되었습니다! 📋`);
    } else {
      // iframe 및 브라우저 정책상 실패했더라도 부모 창(Tauri)으로 메시지가 전달되었으므로 안내
      showToast(`${label} 복사를 요청했습니다! 📋`);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch(e) {
      console.error("사용자 조회 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // [단일 사용자 등록]
  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!form.name || !form.dt_account || !form.email) {
      alert("이름, DT계정, 이메일은 필수 입력 사항입니다.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("사용자가 성공적으로 등록되었습니다! 🎉");
      setForm({ part: "", name: "", dt_account: "", email: "", password: "" });
      setIsRegisterModalOpen(false);
      fetchUsers();
    } catch(err) {
      alert("등록 실패: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // [엑셀 파일 임포트]
  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (jsonData.length < 1) {
          alert("파일에 데이터가 없습니다.");
          return;
        }
        const usersToInsert = [];
        const startIndex = (jsonData[0].join("").includes("이름") || jsonData[0].join("").includes("계정")) ? 1 : 0;
        for (let i = startIndex; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;
          let part = "미소속", name = "", dt = "", email = "", password = "";
          if (row.length >= 5) {
            [email, name, dt, part, password] = row.map(v => String(v || "").trim());
          } else if (row.length === 4) {
            [email, name, dt, part] = row.map(v => String(v || "").trim());
          } else if (row.length === 3) {
            [email, name, dt] = row.map(v => String(v || "").trim());
          } else if (row.length === 2) {
            [name, dt] = row.map(v => String(v || "").trim());
            email = `${dt}@mobis.co.kr`;
          }
          if (name && dt) {
            usersToInsert.push({ part, name, dt_account: dt, email, password: password || null });
          }
        }
        if (usersToInsert.length === 0) {
          alert("유효한 데이터를 찾지 못했습니다. 형식을 확인해주세요.");
          return;
        }
        if (confirm(`총 ${usersToInsert.length}명의 사용자를 임포트하시겠습니까?`)) {
          setIsSaving(true);
          const res = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(usersToInsert)
          });
          if (!res.ok) throw new Error("임포트 중 서버 에러 발생");
          const result = await res.json();
          alert(`성공적으로 ${result.count}명의 사용자가 등록되었습니다.`);
          setIsRegisterModalOpen(false);
          fetchUsers();
        }
      } catch (err) {
        console.error("Excel parsing error:", err);
        alert("파일을 읽는 중 오류가 발생했습니다: " + err.message);
      } finally {
        setIsSaving(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  // [텍스트 일괄 등록]
  const handleBulkInsert = async () => {
    if (!bulkText.trim()) {
      alert("입력된 데이터가 없습니다. 엑셀에서 데이터를 복사하여 붙여넣어 주세요.");
      return;
    }
    const rows = bulkText.split("\n").map(r => r.trim()).filter(Boolean);
    const usersToInsert = [];
    for (const row of rows) {
      const cols = row.split(/\t|,/).map(c => c.trim()).filter(Boolean);
      if (cols.join("").includes("이름") || cols.join("").includes("DT계정")) continue;
      if (cols.length >= 2) {
        let part = "미소속", name = "", dt = "", email = "", password = "";
        if (cols.length >= 5) {
          [email, name, dt, part, password] = cols;
        } else if (cols.length === 4) {
          [email, name, dt, part] = cols;
        } else if (cols.length === 3) {
          [email, name, dt] = cols;
        } else if (cols.length === 2) {
          [name, dt] = cols;
          email = `${dt}@mobis.co.kr`;
        }
        usersToInsert.push({ part, name, dt_account: dt, email, password: password || null });
      }
    }
    if (usersToInsert.length === 0) {
      alert("유효한 데이터 형식이 아닙니다.\n각 줄에 '이메일\t이름\tDT계정\t파트[\t패스워드]' 순서로 입력되어 있는지 확인해 주세요.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(usersToInsert)
      });
      if (!res.ok) throw new Error("일괄 등록 내부 에러");
      const data = await res.json();
      alert(`총 ${data.count}명의 사용자가 일괄 등록되었습니다! 🚀`);
      setBulkText("");
      setIsRegisterModalOpen(false);
      fetchUsers();
    } catch(err) {
      alert("일괄 등록 실패: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async (id, name) => {
    if (!confirm(`'${name}' 사용자를 데이터베이스에서 영구 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("성공적으로 삭제되었습니다.");
        fetchUsers();
      } else {
        const data = await res.json();
        alert("삭제 실패: " + data.error);
      }
    } catch(err) {
      alert("오류 발생: " + err.message);
    }
  };

  // ── 수정 모드 State ──
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ part: "", name: "", dt_account: "", email: "", password: "", is_active: 1 });
  const [showEditPassword, setShowEditPassword] = useState(false);

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditForm({
      part: user.part,
      name: user.name,
      dt_account: user.dt_account,
      email: user.email,
      password: user.password || "",
      is_active: user.is_active
    });
    setShowEditPassword(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ part: "", name: "", dt_account: "", email: "", password: "", is_active: 1 });
  };

  const toggleUserActive = async (user) => {
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type" : "application/json" },
        body: JSON.stringify({
          id: user.id,
          part: user.part,
          name: user.name,
          dt_account: user.dt_account,
          email: user.email,
          password: user.password,
          is_active: user.is_active === 0 ? 1 : 0
        })
      });
      if (res.ok) {
        fetchUsers();
        showToast(`'${user.name}' 상태가 ${user.is_active === 0 ? "투입중" : "미투입"}으로 변경되었습니다.`);
      }
    } catch(e) {
      console.error(e);
    }
  };

  const handleSaveEdit = async (id) => {
    if (!editForm.name || !editForm.dt_account || !editForm.email) {
      alert("이름, DT계정, 이메일은 필수 입력 사항입니다.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type" : "application/json" },
        body: JSON.stringify({ id, ...editForm })
      });
      if (!res.ok) throw new Error("수정 실패");
      showToast("사용자 정보가 성공적으로 수정되었습니다.");
      setEditingId(null);
      fetchUsers();
    } catch(err) {
      alert("수정 중 오류 발생: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleRowPassword = (id) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const complexity = checkPasswordComplexity(generatedPassword);

  return (
    <div>
      {/* ── 토스트 알림 메시지 ── */}
      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: "2rem",
          right: "2rem",
          zIndex: 99999,
          background: "#1e293b",
          color: "#f8fafc",
          padding: "0.85rem 1.4rem",
          borderRadius: "10px",
          border: "1px solid #3b82f6",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(59, 130, 246, 0.2)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.9rem",
          fontWeight: "500",
          animation: "fadeIn 0.2s ease-out"
        }}>
          <span>✨</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── 1. 신규 사용자 등록 모달 ── */}
      {isRegisterModalOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(5px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9000,
          padding: "1rem"
        }}>
          <div style={{
            background: "#151a28",
            border: "1px solid #2a3143",
            borderRadius: "16px",
            width: "100%",
            maxWidth: "680px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}>
            {/* 모달 상단 헤더 */}
            <div style={{
              padding: "1.25rem 1.5rem",
              borderBottom: "1px solid #2a3143",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "linear-gradient(90deg, rgba(59, 130, 246, 0.1), transparent)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "1.4rem" }}>➕</span>
                <div>
                  <h3 style={{ fontSize: "1.15rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>
                    신규 팀원 / 사용자 등록
                  </h3>
                  <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>
                    개별 또는 엑셀 일괄 등록으로 모니터링 대상자를 시스템에 추가합니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "1.2rem", cursor: "pointer", padding: "0.3rem" }}
              >
                ✕
              </button>
            </div>

            {/* 등록 모드 탭 */}
            <div style={{ display: "flex", borderBottom: "1px solid #2a3143", background: "rgba(0,0,0,0.2)" }}>
              <button
                onClick={() => setBulkMode(false)}
                style={{
                  flex: 1,
                  padding: "0.85rem",
                  background: !bulkMode ? "rgba(59, 130, 246, 0.15)" : "transparent",
                  color: !bulkMode ? "#60a5fa" : "#94a3b8",
                  border: "none",
                  borderBottom: !bulkMode ? "2px solid #3b82f6" : "2px solid transparent",
                  fontWeight: "600",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                👤 개별 직접 등록
              </button>
              <button
                onClick={() => setBulkMode(true)}
                style={{
                  flex: 1,
                  padding: "0.85rem",
                  background: bulkMode ? "rgba(16, 185, 129, 0.15)" : "transparent",
                  color: bulkMode ? "#34d399" : "#94a3b8",
                  border: "none",
                  borderBottom: bulkMode ? "2px solid #10b981" : "2px solid transparent",
                  fontWeight: "600",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                ⚡ 일괄 등록 (엑셀/복사붙여넣기)
              </button>
            </div>

            {/* 모달 본문 */}
            <div style={{ padding: "1.5rem", maxHeight: "70vh", overflowY: "auto" }}>
              {!bulkMode ? (
                <form onSubmit={handleAddUser} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>파트/소속</label>
                      <input type="text" placeholder="예: 플랫폼개발팀" value={form.part} onChange={e => setForm({...form, part: e.target.value})} style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>직원 이름 <span style={{color:"#ef4444"}}>*</span></label>
                      <input type="text" placeholder="예: 홍길동 책임" value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>DT계정 <span style={{color:"#ef4444"}}>*</span></label>
                      <input type="text" placeholder="예: DT00123" value={form.dt_account} onChange={e => setForm({...form, dt_account: e.target.value})} style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "0.4rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>이메일 <span style={{color:"#ef4444"}}>*</span></label>
                      <input type="email" placeholder="hong@mobis.co.kr" value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ width: "100%", padding: "0.6rem 0.8rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>패스워드 (선택)</label>
                      <button
                        type="button"
                        onClick={() => openPasswordModal("add")}
                        style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.4)", color: "#60a5fa", padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                      >
                        🎲 안전 패스워드 생성기
                      </button>
                    </div>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showFormPassword ? "text" : "password"}
                        placeholder="직접 입력하거나 [🎲 안전 패스워드 생성기]로 생성"
                        value={form.password}
                        onChange={e => setForm({...form, password: e.target.value})}
                        style={{ width: "100%", padding: "0.6rem 2.5rem 0.6rem 0.8rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white", fontFamily: showFormPassword ? "monospace" : "inherit" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowFormPassword(!showFormPassword)}
                        style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.95rem" }}
                      >
                        {showFormPassword ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
                    <button
                      type="button"
                      onClick={() => setIsRegisterModalOpen(false)}
                      className="btn"
                      style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "0.6rem 1.2rem" }}
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="btn btn-primary"
                      style={{ padding: "0.6rem 1.8rem", fontWeight: "600" }}
                    >
                      {isSaving ? "등록 중..." : "➕ 사용자 추가 완료"}
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                  <div style={{ padding: "1.2rem", background: "rgba(16, 185, 129, 0.05)", borderRadius: "12px", border: "1px dashed #10b981" }}>
                    <h4 style={{ fontSize: "0.95rem", marginBottom: "0.5rem", color: "#34d399", display: "flex", alignItems: "center", gap: "0.5rem" }}>📁 엑셀 파일(.xlsx, .csv) 직접 업로드</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.8rem" }}>
                      열 순서: <b>이메일 | 이름 | DT계정 | 파트 [| 패스워드]</b> (헤더 행 포함 가능)
                    </p>
                    <input type="file" accept=".xlsx, .xls, .csv" onChange={handleExcelImport} ref={fileInputRef} style={{ display: "none" }} />
                    <button onClick={() => fileInputRef.current.click()} className="btn" disabled={isSaving} style={{ width: "100%", background: "#10b981", color: "white", fontSize: "0.85rem", padding: "0.6rem" }}>
                      {isSaving ? "처리 중..." : "엑셀 파일 선택하기"}
                    </button>
                  </div>

                  <div style={{ padding: "1.2rem", background: "rgba(59, 130, 246, 0.05)", borderRadius: "12px", border: "1px dashed #3b82f6" }}>
                    <h4 style={{ fontSize: "0.95rem", marginBottom: "0.5rem", color: "#60a5fa", display: "flex", alignItems: "center", gap: "0.5rem" }}>⌨️ 텍스트 복사하여 붙여넣기</h4>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
                      엑셀에서 영역을 복사(Ctrl+C)한 뒤 아래에 붙여넣으세요.
                    </p>
                    <textarea
                      value={bulkText}
                      onChange={e => setBulkText(e.target.value)}
                      placeholder={`hong@mobis.co.kr\thong gildong\tDT00001\t플랫폼개발팀\tP@ssw0rd123!\n...`}
                      style={{ width: "100%", minHeight: "90px", padding: "0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.3)", color: "white", fontFamily: "monospace", fontSize: "0.8rem", marginBottom: "0.6rem" }}
                    />
                    <button onClick={handleBulkInsert} className="btn" disabled={isSaving || !bulkText.trim()} style={{ width: "100%", background: "#3b82f6", color: "white", fontSize: "0.85rem", padding: "0.6rem" }}>
                      텍스트 데이터 파싱 및 등록
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 2. 안전 패스워드 생성기 모달 (z-index 최상위) ── */}
      {isPasswordModalOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
          padding: "1rem"
        }}>
          <div style={{
            background: "#151a28",
            border: "1px solid #3b82f6",
            borderRadius: "16px",
            width: "100%",
            maxWidth: "520px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
            overflow: "hidden"
          }}>
            <div style={{
              padding: "1.25rem 1.5rem",
              borderBottom: "1px solid #2a3143",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "linear-gradient(90deg, rgba(59, 130, 246, 0.15), transparent)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "1.4rem" }}>🎲</span>
                <div>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>
                    랜덤 안전 패스워드 생성기
                  </h3>
                  <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>
                    키워드를 포함하며 대/소문자, 숫자, 특수문자를 모두 충족합니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPasswordModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "1.2rem", cursor: "pointer", padding: "0.3rem" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={{ background: "#0b0f19", border: "1px solid #3b82f6", borderRadius: "12px", padding: "1rem 1.2rem", boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "#3b82f6", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    생성된 패스워드 (길이: {generatedPassword.length}자)
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => setShowModalPassword(!showModalPassword)}
                      style={{ background: "rgba(255, 255, 255, 0.08)", border: "none", borderRadius: "6px", padding: "2px 8px", color: "#94a3b8", fontSize: "0.75rem", cursor: "pointer" }}
                    >
                      {showModalPassword ? "숨기기 🙈" : "보기 👁️"}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(generatedPassword)}
                      style={{ background: "rgba(59, 130, 246, 0.2)", border: "1px solid rgba(59, 130, 246, 0.4)", borderRadius: "6px", padding: "2px 8px", color: "#60a5fa", fontSize: "0.75rem", cursor: "pointer" }}
                    >
                      복사 📋
                    </button>
                  </div>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "1.25rem", fontWeight: "600", color: "#f8fafc", wordBreak: "break-all", letterSpacing: "1px", minHeight: "32px", display: "flex", alignItems: "center" }}>
                  {showModalPassword ? generatedPassword : "•".repeat(generatedPassword.length)}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.75rem", padding: "3px 8px", borderRadius: "6px", background: complexity.hasUpper ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.1)", color: complexity.hasUpper ? "#34d399" : "#64748b", border: `1px solid ${complexity.hasUpper ? "rgba(16, 185, 129, 0.4)" : "#334155"}` }}>
                  {complexity.hasUpper ? "✓" : "✗"} 대문자 (A-Z)
                </span>
                <span style={{ fontSize: "0.75rem", padding: "3px 8px", borderRadius: "6px", background: complexity.hasLower ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.1)", color: complexity.hasLower ? "#34d399" : "#64748b", border: `1px solid ${complexity.hasLower ? "rgba(16, 185, 129, 0.4)" : "#334155"}` }}>
                  {complexity.hasLower ? "✓" : "✗"} 소문자 (a-z)
                </span>
                <span style={{ fontSize: "0.75rem", padding: "3px 8px", borderRadius: "6px", background: complexity.hasNumber ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.1)", color: complexity.hasNumber ? "#34d399" : "#64748b", border: `1px solid ${complexity.hasNumber ? "rgba(16, 185, 129, 0.4)" : "#334155"}` }}>
                  {complexity.hasNumber ? "✓" : "✗"} 숫자 (0-9)
                </span>
                <span style={{ fontSize: "0.75rem", padding: "3px 8px", borderRadius: "6px", background: complexity.hasSpecial ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.1)", color: complexity.hasSpecial ? "#34d399" : "#64748b", border: `1px solid ${complexity.hasSpecial ? "rgba(16, 185, 129, 0.4)" : "#334155"}` }}>
                  {complexity.hasSpecial ? "✓" : "✗"} 특수문자 (!@#...)
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.4rem" }}>
                  포함할 키워드 (선택)
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder="예: DT계정, 부서명, 회사명 (빈칸 시 완전 난수 생성)"
                    value={modalKeyword}
                    onChange={(e) => {
                      const newKw = e.target.value;
                      setModalKeyword(newKw);
                      handleRegenerate(newKw, modalLength, modalPlacement);
                    }}
                    style={{ flex: 1, padding: "0.6rem 0.8rem", background: "#0b0f19", border: "1px solid #2a3143", borderRadius: "8px", color: "white", fontSize: "0.85rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRegenerate()}
                    className="btn"
                    style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid #3b82f6", color: "#60a5fa", padding: "0 0.9rem", fontSize: "0.85rem", borderRadius: "8px", whiteSpace: "nowrap" }}
                  >
                    🔄 재생성
                  </button>
                </div>

                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", color: "#64748b", alignSelf: "center" }}>추천 칩:</span>
                  {(modalTarget === "add" ? form.dt_account : modalTarget === "edit" ? editForm.dt_account : modalTarget?.user?.dt_account) && (
                    <button
                      type="button"
                      onClick={() => {
                        const kw = modalTarget === "add" ? form.dt_account : modalTarget === "edit" ? editForm.dt_account : modalTarget?.user?.dt_account;
                        setModalKeyword(kw);
                        handleRegenerate(kw, modalLength, modalPlacement);
                      }}
                      style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", cursor: "pointer" }}
                    >
                      DT계정
                    </button>
                  )}
                  {(modalTarget === "add" ? form.name : modalTarget === "edit" ? editForm.name : modalTarget?.user?.name) && (
                    <button
                      type="button"
                      onClick={() => {
                        const kw = modalTarget === "add" ? form.name : modalTarget === "edit" ? editForm.name : modalTarget?.user?.name;
                        setModalKeyword(kw);
                        handleRegenerate(kw, modalLength, modalPlacement);
                      }}
                      style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", cursor: "pointer" }}
                    >
                      이름
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setModalKeyword("Mobis");
                      handleRegenerate("Mobis", modalLength, modalPlacement);
                    }}
                    style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", cursor: "pointer" }}
                  >
                    Mobis
                  </button>
                  {modalKeyword && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalKeyword("");
                        handleRegenerate("", modalLength, modalPlacement);
                      }}
                      style={{ background: "#1e293b", border: "1px solid #ef4444", color: "#ef4444", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", cursor: "pointer" }}
                    >
                      지우기 ✕
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                    <label style={{ fontSize: "0.85rem", color: "#94a3b8" }}>목표 길이</label>
                    <span style={{ fontSize: "0.85rem", color: "#3b82f6", fontWeight: "600" }}>{modalLength}자</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={24}
                    value={modalLength}
                    onChange={(e) => {
                      const len = parseInt(e.target.value);
                      setModalLength(len);
                      handleRegenerate(modalKeyword, len, modalPlacement);
                    }}
                    style={{ width: "100%", accentColor: "#3b82f6", cursor: "pointer" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.4rem" }}>
                    키워드 배치 위치
                  </label>
                  <select
                    value={modalPlacement}
                    onChange={(e) => {
                      const place = e.target.value;
                      setModalPlacement(place);
                      handleRegenerate(modalKeyword, modalLength, place);
                    }}
                    style={{ width: "100%", padding: "0.55rem 0.8rem", background: "#0b0f19", border: "1px solid #2a3143", borderRadius: "8px", color: "white", fontSize: "0.85rem" }}
                  >
                    <option value="prefix">앞쪽 (키워드 + 난수)</option>
                    <option value="suffix">뒤쪽 (난수 + 키워드)</option>
                    <option value="middle">가운데 (난수 + 키워드 + 난수)</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ padding: "1.2rem 1.5rem", background: "rgba(0, 0, 0, 0.2)", borderTop: "1px solid #2a3143", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="btn"
                style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "0.6rem 1.2rem" }}
              >
                닫기
              </button>
              <button
                type="button"
                onClick={handleApplyPassword}
                disabled={isSaving}
                className="btn btn-primary"
                style={{ background: "#10b981", border: "none", color: "white", padding: "0.6rem 1.5rem", fontWeight: "600", display: "flex", alignItems: "center", gap: "0.4rem" }}
              >
                {isSaving ? "저장 중..." : "✨ 이 패스워드 적용하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 페이지 상단 헤더 ── */}
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <h1>👥 JIRA 사용자 통계 및 팀원 관리</h1>
        <p>팀원들의 워크로그를 분석하거나 태스크를 모니터링하기 위해 대상자 목록과 계정 정보(패스워드)를 시스템에 안전하게 등록/관리합니다.</p>
      </div>

      {/* ── 팀원 목록 및 필터 툴바 카드 ── */}
      <div className="card">
        {/* 1. 상단 바: 타이틀, 통계 배지, [➕ 신규 팀원 등록] 버튼 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1.2rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              📋 등록된 팀원 목록
            </h2>
            <span style={{
              background: "rgba(59, 130, 246, 0.15)",
              color: "#60a5fa",
              padding: "3px 10px",
              borderRadius: "14px",
              fontSize: "0.8rem",
              fontWeight: "600",
              border: "1px solid rgba(59, 130, 246, 0.3)"
            }}>
              총 {users.length}명 {filteredUsers.length !== users.length && `(검색됨: ${filteredUsers.length}명)`}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsRegisterModalOpen(true)}
            className="btn btn-primary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.6rem 1.3rem",
              fontSize: "0.9rem",
              fontWeight: "600",
              boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)",
              borderRadius: "10px"
            }}
          >
            ➕ 신규 팀원 등록
          </button>
        </div>

        {/* 2. 다중 필터링 툴바 (소속 파트, 투입 상태, 검색창, 초기화) */}
        <div style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          padding: "0.9rem 1.1rem",
          background: "rgba(255, 255, 255, 0.02)",
          borderRadius: "10px",
          border: "1px solid var(--border-color)",
          marginBottom: "1.5rem",
          flexWrap: "wrap"
        }}>
          {/* 소속 파트 필터 */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>🏢 파트:</span>
            <select
              value={filterPart}
              onChange={e => setFilterPart(e.target.value)}
              style={{
                background: "#0b0f19",
                color: "white",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "0.45rem 0.75rem",
                fontSize: "0.85rem",
                cursor: "pointer"
              }}
            >
              <option value="ALL">전체 파트 ({partList.length}개)</option>
              {partList.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* 투입 상태 필터 */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>⚡ 상태:</span>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{
                background: "#0b0f19",
                color: "white",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "0.45rem 0.75rem",
                fontSize: "0.85rem",
                cursor: "pointer"
              }}
            >
              <option value="ALL">전체 상태</option>
              <option value="1">투입중</option>
              <option value="0">미투입</option>
            </select>
          </div>

          {/* 검색 입력 필드 */}
          <div style={{ flex: 1, minWidth: "220px", position: "relative" }}>
            <input
              type="text"
              placeholder="이름, DT계정, 이메일 검색..."
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              style={{
                width: "100%",
                background: "#0b0f19",
                color: "white",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "0.45rem 2rem 0.45rem 0.75rem",
                fontSize: "0.85rem"
              }}
            />
            {searchKeyword && (
              <button
                onClick={() => setSearchKeyword("")}
                style={{
                  position: "absolute",
                  right: "6px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "0.85rem"
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* 필터 초기화 버튼 */}
          {(filterPart !== "ALL" || filterStatus !== "ALL" || searchKeyword.trim() !== "") && (
            <button
              type="button"
              onClick={resetFilters}
              style={{
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                padding: "0.45rem 0.8rem",
                borderRadius: "6px",
                fontSize: "0.8rem",
                cursor: "pointer",
                whiteSpace: "nowrap"
              }}
            >
              ↺ 필터 초기화
            </button>
          )}
        </div>

        {/* 3. 사용자 목록 테이블 */}
        {loading ? (
          <div className="loading">사용자 목록을 불러오는 중입니다...</div>
        ) : filteredUsers.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "12%" }}>소속 파트</th>
                  <th style={{ width: "14%" }}>이름</th>
                  <th style={{ width: "12%" }}>DT계정</th>
                  <th style={{ width: "18%" }}>이메일</th>
                  <th style={{ width: "18%" }}>패스워드</th>
                  <th style={{ width: "8%" }}>투입 상태</th>
                  <th style={{ width: "18%", textAlign: "right" }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} style={{ background: editingId === u.id ? "rgba(59, 130, 246, 0.05)" : "transparent" }}>
                    {editingId === u.id ? (
                      <>
                        <td><input type="text" value={editForm.part} onChange={e => setEditForm({...editForm, part: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td><input type="text" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td><input type="text" value={editForm.dt_account} onChange={e => setEditForm({...editForm, dt_account: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td><input type="email" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td>
                          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <input
                              type={showEditPassword ? "text" : "password"}
                              value={editForm.password}
                              onChange={e => setEditForm({...editForm, password: e.target.value})}
                              placeholder="패스워드"
                              style={{ flex: 1, minWidth: "90px", padding: "4px 6px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px", fontSize: "0.8rem", fontFamily: showEditPassword ? "monospace" : "inherit" }}
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditPassword(!showEditPassword)}
                              style={{ background: "#222", border: "1px solid #444", borderRadius: "4px", color: "#aaa", padding: "3px 6px", fontSize: "0.75rem", cursor: "pointer" }}
                            >
                              {showEditPassword ? "🙈" : "👁️"}
                            </button>
                            <button
                              type="button"
                              onClick={() => openPasswordModal("edit")}
                              title="패스워드 생성"
                              style={{ background: "rgba(59,130,246,0.2)", border: "1px solid #3b82f6", borderRadius: "4px", color: "#60a5fa", padding: "3px 6px", fontSize: "0.75rem", cursor: "pointer" }}
                            >
                              🎲
                            </button>
                          </div>
                        </td>
                        <td>
                          <select value={editForm.is_active} onChange={e => setEditForm({...editForm, is_active: parseInt(e.target.value)})} style={{ background: "#000", color: "white", border: "1px solid var(--accent-color)", borderRadius: "4px", padding: "4px" }}>
                            <option value={1}>투입</option>
                            <option value={0}>미투입</option>
                          </select>
                        </td>
                        <td style={{ textAlign: "right", display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                          <button onClick={() => handleSaveEdit(u.id)} className="btn" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", background: "#10b981", color: "white" }}>저장</button>
                          <button onClick={cancelEdit} className="btn" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", background: "#444", color: "white" }}>취소</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ color: "var(--text-secondary)", opacity: u.is_active === 0 ? 0.5 : 1 }}>{u.part}</td>
                        <td style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "1.05rem", opacity: u.is_active === 0 ? 0.5 : 1 }}>{u.is_active === 0 && <span style={{color:"#ef4444", fontSize:"0.8rem", marginRight:"4px"}}>[미투입]</span>}{u.name}</td>
                        <td style={{ opacity: u.is_active === 0 ? 0.5 : 1 }}><code style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "4px", color: "var(--accent-color)" }}>{u.dt_account}</code></td>
                        <td style={{ color: "var(--text-secondary)", opacity: u.is_active === 0 ? 0.5 : 1 }}>{u.email}</td>
                        <td style={{ opacity: u.is_active === 0 ? 0.5 : 1 }}>
                          {u.password ? (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: visiblePasswords[u.id] ? "#38bdf8" : "#94a3b8" }}>
                                {visiblePasswords[u.id] ? u.password : "••••••••"}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleRowPassword(u.id)}
                                title={visiblePasswords[u.id] ? "패스워드 숨기기" : "패스워드 확인"}
                                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem", padding: "0 2px" }}
                              >
                                {visiblePasswords[u.id] ? "🙈" : "👁️"}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(u.password, `'${u.name}' 패스워드`)}
                                title="클립보드에 복사"
                                style={{ background: "transparent", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: "0.85rem", padding: "0 2px" }}
                              >
                                📋
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ color: "#64748b", fontSize: "0.75rem" }}>미설정</span>
                              <button
                                type="button"
                                onClick={() => openPasswordModal({ type: "row", user: u }, u.dt_account)}
                                style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.3)", color: "#60a5fa", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", cursor: "pointer" }}
                              >
                                🎲 생성/설정
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <button onClick={() => toggleUserActive(u)} style={{ background: u.is_active !== 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", border: `1px solid ${u.is_active !== 0 ? "#10b981" : "#ef4444"}`, color: u.is_active !== 0 ? "#10b981" : "#ef4444", padding: "3px 8px", borderRadius: "12px", fontSize: "0.75rem", cursor: "pointer" }}>
                            {u.is_active !== 0 ? "투입중" : "미투입"}
                          </button>
                        </td>
                        <td style={{ textAlign: "right", display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                          <button
                             className="btn"
                             style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", background: "rgba(255, 255, 255, 0.05)", color: "white", border: "1px solid var(--border-color)" }}
                             onClick={() => startEdit(u)}
                           >
                            수정
                          </button>
                          <button
                             className="btn"
                             style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.3)" }}
                             onClick={() => handleDeleteUser(u.id, u.name)}
                           >
                             삭제
                           </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="loading" style={{ padding: "3rem 0", textAlign: "center" }}>
            {users.length === 0
              ? "등록된 팀원이 아무도 없습니다. 우측 상단의 [➕ 신규 팀원 등록] 버튼을 통해 추가해 보세요! 👥"
              : "선택한 필터 조건에 일치하는 팀원이 없습니다. 필터 조건을 변경하거나 [초기화]를 눌러보세요. 🔍"}
          </div>
        )}
      </div>
    </div>
  );
}