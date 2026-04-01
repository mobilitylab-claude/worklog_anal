"use client";

import { useEffect, useState, useRef } from "react";
import * as XLSX from "xlsx";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  // 개별 등록 Form State
  const [form, setForm] = useState({ part: "", name: "", dt_account: "", email: "" });
  
  // 일괄 등록(엑셀 복붙) State
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  
  const [isSaving, setIsSaving] = useState(false);

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

  // [단일 등록]
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

      alert("사용자가 성공적으로 등록되었습니다!");
      setForm({ part: "", name: "", dt_account: "", email: "" });
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
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // JSON으로 변환 (헤더 포함)
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        if (jsonData.length < 1) {
          alert("파일에 데이터가 없습니다.");
          return;
        }

        const usersToInsert = [];
        // 첫 번째 줄이 헤더인지 확인하고 데이터 추출
        const startIndex = (jsonData[0].join("").includes("이름") || jsonData[0].join("").includes("계정")) ? 1 : 0;

        for (let i = startIndex; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          // 데이터 맵핑 (파트, 이름, DT계정, 이메일 순서 기대)
          let part = "미소속", name = "", dt = "", email = "";
          
          if (row.length >= 4) {
            [email, name, dt, part] = row.map(v => String(v || "").trim());
          } else if (row.length === 3) {
            [email, name, dt] = row.map(v => String(v || "").trim());
          } else if (row.length === 2) {
            [name, dt] = row.map(v => String(v || "").trim());
            email = `${dt}@mobis.co.kr`;
          }

          if (name && dt) {
            usersToInsert.push({ part, name, dt_account: dt, email });
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
          fetchUsers();
          setBulkMode(false);
        }
      } catch (err) {
        console.error("Excel parsing error:", err);
        alert("파일을 읽는 중 오류가 발생했습니다: " + err.message);
      } finally {
        setIsSaving(false);
        // 파일 input 초기화 (같은 파일 다시 올릴 수 있게)
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

    // 엑셀에서 복사해온 텍스트(탭 분리형)를 파싱
    const rows = bulkText.split('\n').map(r => r.trim()).filter(Boolean);
    const usersToInsert = [];

    for (const row of rows) {
      // 엑셀은 열을 탭(\t)으로 구분하며, 콤마(,) 구분도 호환되도록 처리
      const cols = row.split(/\t|,/).map(c => c.trim()).filter(Boolean);
      
      // 첫 째줄이 헤더(이름, 소속 등 표기줄)이면 무시
      if (cols.join("").includes("이름") || cols.join("").includes("DT계정")) continue;

      if (cols.length >= 2) { // 이름, DT는 필수
        let part = "미소속", name = "", dt = "", email = "";
        
        if (cols.length >= 4) {
          [email, name, dt, part] = cols;
        } else if (cols.length === 3) {
          [email, name, dt] = cols;
        } else if (cols.length === 2) {
          [name, dt] = cols;
          email = `${dt}@mobis.co.kr`;
        }
        
        usersToInsert.push({ part, name, dt_account: dt, email });
      }
    }

    if (usersToInsert.length === 0) {
      alert("유효한 데이터 형식이 아닙니다.\n각 줄에 '파트 - 이름 - DT계정 - 이메일' 순서로 입력되어 있는지 확인해 주세요.");
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
      setBulkMode(false);
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
        alert("성공적으로 삭제되었습니다.");
        fetchUsers();
      } else {
        const data = await res.json();
        alert("삭제 실패: " + data.error);
      }
    } catch(err) {
      alert("오류 발생: " + err.message);
    }
  };

  // [수정 모드] State
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ part: "", name: "", dt_account: "", email: "" });

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditForm({ part: user.part, name: user.name, dt_account: user.dt_account, email: user.email });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ part: "", name: "", dt_account: "", email: "" });
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
      
      alert("사용자 정보가 수정되었습니다.");
      setEditingId(null);
      fetchUsers();
    } catch(err) {
      alert("수정 중 오류 발생: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>👥 JIRA 사용자 통계 및 팀원 관리</h1>
        <p>팀원들의 워크로그를 분석하거나 태스크를 모니터링하기 위해 대상자 목록을 시스템에 등록하여 인물/부서별 데이터 쿼리를 활성화합니다.</p>
      </div>

      <div className="card" style={{ marginBottom: "2rem", padding: "1.5rem" }}>
         <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
           <h2 style={{ fontSize: "1.1rem" }}>신규 팀원 / 사용자 등록</h2>
           
           {/* 등록 모드 전환 탭 */}
           <div style={{ display: "flex", gap: "0.5rem" }}>
             <button 
               onClick={() => setBulkMode(false)} 
               style={{ background: !bulkMode ? "#3b82f6" : "transparent", color: !bulkMode ? "white" : "gray", border: "1px solid #3b82f6", padding: "0.4rem 1.2rem", borderRadius: "16px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600", transition: "all 0.2s" }}
             >
               개별 등록
             </button>
             <button 
               onClick={() => setBulkMode(true)} 
               style={{ background: bulkMode ? "#10b981" : "transparent", color: bulkMode ? "white" : "gray", border: "1px solid #10b981", padding: "0.4rem 1.2rem", borderRadius: "16px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600", transition: "all 0.2s" }}
             >
               일괄 등록 (엑셀/파일) ⚡
             </button>
           </div>
         </div>

         {!bulkMode ? (
           <form onSubmit={handleAddUser} style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
             <div style={{ flex: 1, minWidth: "150px" }}>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>파트/소속</label>
               <input type="text" placeholder="예: 플랫폼개발팀" value={form.part} onChange={e => setForm({...form, part: e.target.value})} style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
             </div>
             <div style={{ flex: 1, minWidth: "150px" }}>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>직원 이름 <span style={{color:"#ef4444"}}>*</span></label>
               <input type="text" placeholder="예: 홍길동 책임" value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
             </div>
             <div style={{ flex: 1, minWidth: "150px" }}>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>DT계정 (Username) <span style={{color:"#ef4444"}}>*</span></label>
               <input type="text" placeholder="예: DT00123" value={form.dt_account} onChange={e => setForm({...form, dt_account: e.target.value})} style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
             </div>
             <div style={{ flex: 1, minWidth: "200px" }}>
               <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>이메일 <span style={{color:"#ef4444"}}>*</span></label>
               <input type="email" placeholder="hong@mobis.co.kr" value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={{ width: "100%", padding: "0.6rem 1rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
             </div>
             <button type="submit" className="btn btn-primary" disabled={isSaving} style={{ height: "42px", padding: "0 1.5rem", whiteSpace: "nowrap" }}>
               {isSaving ? "등록 중..." : "➕ 사용자 추가 완료"}
             </button>
           </form>
         ) : (
           <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
             <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                {/* 엑셀 파일 업로드 섹션 */}
                <div style={{ padding: "1.5rem", background: "rgba(16, 185, 129, 0.05)", borderRadius: "12px", border: "1px dashed #10b981" }}>
                   <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#34d399", display: "flex", alignItems: "center", gap: "0.5rem" }}>📁 엑셀 파일(.xlsx, .csv) 직접 업로드</h3>
                   <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                      엑셀 파일을 선택하여 한 번에 등록하세요.<br/>
                      형식: <b>이메일 | 이름 | DT계정 | 파트</b> 순서 (헤더 포함 가능)
                   </p>
                   <input 
                     type="file" 
                     accept=".xlsx, .xls, .csv" 
                     onChange={handleExcelImport}
                     ref={fileInputRef}
                     style={{ display: "none" }}
                   />
                   <button 
                     onClick={() => fileInputRef.current.click()}
                     className="btn" 
                     disabled={isSaving}
                     style={{ width: "100%", background: "#10b981", color: "white", fontSize: "0.9rem" }}
                   >
                     {isSaving ? "처리 중..." : "엑셀 파일 선택하기"}
                   </button>
                </div>

                {/* 텍스트 복붙 섹션 */}
                <div style={{ padding: "1.5rem", background: "rgba(59, 130, 246, 0.05)", borderRadius: "12px", border: "1px dashed #3b82f6" }}>
                   <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#60a5fa", display: "flex", alignItems: "center", gap: "0.5rem" }}>⌨️ 텍스트 복사하여 붙여넣기</h3>
                   <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                      엑셀에서 영역을 드래그 복사(Ctrl+C)한 뒤 아래 칸에 붙여넣으세요.
                   </p>
                   <textarea 
                      value={bulkText} 
                      onChange={e => setBulkText(e.target.value)} 
                      placeholder={`hong@mobis.co.kr\t홍길동\tDT00001\t플랫폼개발팀\n...`}
                      style={{ width: "100%", minHeight: "80px", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", color: "white", fontFamily: "monospace", fontSize: "0.8rem", marginBottom: "0.5rem" }}
                   />
                   <button onClick={handleBulkInsert} className="btn" disabled={isSaving || !bulkText.trim()} style={{ width: "100%", background: "#3b82f6", color: "white", fontSize: "0.9rem" }}>
                      텍스트 데이터 파싱 및 등록
                   </button>
                </div>
             </div>
           </div>
         )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
           <h2 style={{ fontSize: "1.1rem" }}>등록된 팀원 목록 ({users.length}명)</h2>
           <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              * DT계정이 올바르면 JQL을 통해 해당 인원의 워크로그를 정확히 추적할 수 있습니다.
           </div>
        </div>
        
        {loading ? (
          <div className="loading">사용자 목록을 불러오는 중입니다...</div>
        ) : users.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "15%" }}>소속 파트</th>
                  <th style={{ width: "20%" }}>이름</th>
                  <th style={{ width: "15%" }}>DT계정</th>
                  <th style={{ width: "25%" }}>이메일</th>
                  <th style={{ width: "13%" }}>추가된 날짜</th>
                  <th style={{ width: "12%", textAlign: "right" }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ background: editingId === u.id ? "rgba(59, 130, 246, 0.05)" : "transparent" }}>
                    {editingId === u.id ? (
                      <>
                        <td><input type="text" value={editForm.part} onChange={e => setEditForm({...editForm, part: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td><input type="text" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td><input type="text" value={editForm.dt_account} onChange={e => setEditForm({...editForm, dt_account: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td><input type="email" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} style={{ width: "100%", padding: "4px 8px", background: "#000", border: "1px solid var(--accent-color)", color: "white", borderRadius: "4px" }} /></td>
                        <td style={{ fontSize: "0.85rem", color: "gray" }}>-</td>
                        <td style={{ textAlign: "right", display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                          <button onClick={() => handleSaveEdit(u.id)} className="btn" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", background: "#10b981", color: "white" }}>저장</button>
                          <button onClick={cancelEdit} className="btn" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", background: "#444", color: "white" }}>취소</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ color: "var(--text-secondary)" }}>{u.part}</td>
                        <td style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "1.05rem" }}>{u.name}</td>
                        <td><code style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "4px", color: "var(--accent-color)" }}>{u.dt_account}</code></td>
                        <td style={{ color: "var(--text-secondary)" }}>{u.email}</td>
                        <td style={{ fontSize: "0.85rem", color: "gray" }}>{new Date(u.created_at).toLocaleDateString("ko-KR")}</td>
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
          <div className="loading" style={{ padding: "3rem 0" }}>
            등록된 팀원이 아무도 없습니다. 위 양식을 통해 관리할 대상자들의 메일과 이름 등을 추가해 보세요! 👥
          </div>
        )}
      </div>
    </div>
  );
}
