"use client";

import { useEffect, useState } from "react";

export default function StandardManagement() {
  const [activeTab, setActiveTab] = useState("projects");
  const [loading, setLoading] = useState(true);

  // ── Project State ────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [projForm, setProjForm] = useState({ code: "", name: "", startDate: "", endDate: "" });
  const [editingProjId, setEditingProjId] = useState(null);

  // ── WorkType State ───────────────────────────────────────────
  const [workTypes, setWorkTypes] = useState([]);
  const [typeForm, setTypeForm] = useState({ name: "", content: "", keywords: [], remarks: "" });
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [newKeyword, setNewKeyword] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/standards/projects"),
        fetch("/api/standards/work-types")
      ]);
      const pData = await pRes.json();
      const tData = await tRes.json();
      setProjects(pData.projects || []);
      setWorkTypes(tData.types || []);
    } catch (e) {
      console.error("데이터 로드 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // ── Project CRUD ─────────────────────────────────────────────
  const handleSaveProj = async (e) => {
    e.preventDefault();
    const method = editingProjId ? "PUT" : "POST";
    const body = editingProjId ? { id: editingProjId, ...projForm } : projForm;
    
    try {
      const res = await fetch("/api/standards/projects", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "처리 실패");

      alert("📂 과제 정보가 성공적으로 저장되었습니다!");
      setProjForm({ code: "", name: "", startDate: "", endDate: "" });
      setEditingProjId(null);
      fetchData();
    } catch (err) {
      alert("❌ 저장 실패: " + err.message);
    }
  };

  const handleDeleteProj = async (id) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/standards/projects?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제 실패");
      fetchData();
    } catch (err) {
      alert("❌ 삭제 오류: " + err.message);
    }
  };

  // ── WorkType CRUD ────────────────────────────────────────────
  const handleSaveType = async (e) => {
    e.preventDefault();
    const method = editingTypeId ? "PUT" : "POST";
    const body = editingTypeId ? { id: editingTypeId, ...typeForm } : typeForm;

    try {
      const res = await fetch("/api/standards/work-types", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "처리 실패");

      alert("✏️ 작업 유형 기준이 성공적으로 저장되었습니다!");
      setTypeForm({ name: "", content: "", keywords: [], remarks: "" });
      setEditingTypeId(null);
      fetchData();
    } catch (err) {
      alert("❌ 저장 실패: " + err.message);
    }
  };

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    if (typeForm.keywords.includes(newKeyword.trim())) return;
    setTypeForm({ ...typeForm, keywords: [...typeForm.keywords, newKeyword.trim()] });
    setNewKeyword("");
  };

  const removeKeyword = (kw) => {
    setTypeForm({ ...typeForm, keywords: typeForm.keywords.filter(k => k !== kw) });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>⚙️ 표준 및 기준 관리</h1>
        <p>MOBIS 공수 입력 가이드라인에 따른 계약과제 정보와 작업 유형별 입력 기준을 관리합니다.</p>
      </div>

      {/* 탭 메뉴 */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid #333", paddingBottom: "0.5rem" }}>
        <button onClick={() => setActiveTab("projects")} 
          style={{ padding: "0.5rem 1.5rem", background: "none", border: "none", color: activeTab === "projects" ? "var(--accent-color)" : "#666", fontWeight: "bold", borderBottom: activeTab === "projects" ? "2px solid var(--accent-color)" : "none", cursor: "pointer" }}>
          📂 계약과제 정보
        </button>
        <button onClick={() => setActiveTab("workTypes")} 
          style={{ padding: "0.5rem 1.5rem", background: "none", border: "none", color: activeTab === "workTypes" ? "var(--accent-color)" : "#666", fontWeight: "bold", borderBottom: activeTab === "workTypes" ? "2px solid var(--accent-color)" : "none", cursor: "pointer" }}>
          ✏️ 작업 유형 기준
        </button>
      </div>

      {activeTab === "projects" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem" }}>
          {/* 등록 폼 */}
          <div className="card">
            <h3>{editingProjId ? "과제 수정" : "과제 신규 등록"}</h3>
            <form onSubmit={handleSaveProj} style={{ marginTop: "1rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.85rem", color: "#888" }}>과제 코드 (Unique)</label>
                <input type="text" value={projForm.code} onChange={e => setProjForm({...projForm, code: e.target.value})} required 
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.85rem", color: "#888" }}>과제명 (Project Name)</label>
                <input type="text" value={projForm.name} onChange={e => setProjForm({...projForm, name: e.target.value})} required 
                   style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} />
              </div>
              <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.85rem", color: "#888" }}>시작일</label>
                  <input type="date" value={projForm.startDate} onChange={e => setProjForm({...projForm, startDate: e.target.value})}
                    style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.85rem", color: "#888" }}>종료일</label>
                  <input type="date" value={projForm.endDate} onChange={e => setProjForm({...projForm, endDate: e.target.value})}
                    style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} />
                </div>
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%", padding: "0.75rem" }}>
                {editingProjId ? "수정 완료" : "등록 하기"}
              </button>
              {editingProjId && <button onClick={() => { setEditingProjId(null); setProjForm({code:"",name:"",startDate:"",endDate:""}); }} style={{ width: "100%", marginTop: "0.5rem", background: "none", border: "none", color: "#666", cursor: "pointer" }}>취소</button>}
            </form>
          </div>
          {/* 목록 */}
          <div className="card">
            <h3 style={{ marginBottom: "1rem" }}>과제 목록 ({projects.length})</h3>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>코드</th>
                    <th>과제명</th>
                    <th>기간</th>
                    <th style={{ textAlign: "right" }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: "bold", color: "var(--accent-color)" }}>{p.code}</td>
                      <td>{p.name}</td>
                      <td style={{ fontSize: "0.82rem", color: "#777" }}>{p.start_date || "-"} ~ {p.end_date || "-"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button onClick={() => { setEditingProjId(p.id); setProjForm({code:p.code, name:p.name, startDate:p.start_date||"", endDate:p.end_date||""}) }} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", marginRight: "0.5rem" }}>수정</button>
                        <button onClick={() => handleDeleteProj(p.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem" }}>
          {/* 유형 폼 */}
          <div className="card">
            <h3>{editingTypeId ? "유형 수정" : "유형 신규 등록"}</h3>
            <form onSubmit={handleSaveType} style={{ marginTop: "1rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.85rem", color: "#888" }}>유형 명칭 (Work Type Title)</label>
                <input type="text" value={typeForm.name} onChange={e => setTypeForm({...typeForm, name: e.target.value})} required 
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.85rem", color: "#888" }}>포함 내용 가이드</label>
                <input type="text" value={typeForm.content} onChange={e => setTypeForm({...typeForm, content: e.target.value})}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} placeholder="예: 상세 개발 내용 주석 기술" />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.85rem", color: "#888" }}>분류 키워드 (실제 작업기록에 사용될 키워드들)</label>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "4px", marginBottom: "6px" }}>
                  <input type="text" value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addKeyword())}
                    style={{ flex: 1, padding: "0.5rem", borderRadius: "6px", background: "#000", border: "1px solid #444", color: "white" }} placeholder="엔터로 추가 (예: pr, dev)" />
                  <button type="button" onClick={addKeyword} style={{ background: "#333", color: "white", border: "none", padding: "0 1rem", borderRadius: "6px", cursor: "pointer" }}>추가</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {typeForm.keywords.map(kw => (
                    <span key={kw} style={{ background: "rgba(16,185,129,0.1)", border: "1px solid #10b981", color: "#10b981", fontSize: "0.75rem", padding: "1px 6px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      {kw} <button type="button" onClick={() => removeKeyword(kw)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: "1.5rem" }}>
                <label style={{ fontSize: "0.85rem", color: "#888" }}>비고</label>
                <input type="text" value={typeForm.remarks} onChange={e => setTypeForm({...typeForm, remarks: e.target.value})}
                  style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", background: "#111", border: "1px solid #333", color: "white", marginTop: "4px" }} />
              </div>
              <button type="submit" className="btn-primary" style={{ width: "100%", padding: "0.75rem" }}>
                {editingTypeId ? "수정 완료" : "등록 하기"}
              </button>
              {editingTypeId && <button onClick={() => { setEditingTypeId(null); setTypeForm({name:"",content:"",keywords:[],remarks:""}); }} style={{ width: "100%", marginTop: "0.5rem", background: "none", border: "none", color: "#666", cursor: "pointer" }}>취소</button>}
            </form>
          </div>
          {/* 목록 */}
          <div className="card">
            <h3 style={{ marginBottom: "1rem" }}>유형 목록 ({workTypes.length})</h3>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>명칭</th>
                    <th>분류 키워드</th>
                    <th>가이드</th>
                    <th style={{ textAlign: "right" }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {workTypes.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: "bold" }}>{t.name}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                          {(t.keywords || []).map(kw => <code key={kw} style={{ fontSize: "0.75rem", color: "#fbbf24" }}>{kw}</code>)}
                        </div>
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "#777" }}>{t.content}</td>
                      <td style={{ textAlign: "right" }}>
                        <button onClick={() => { setEditingTypeId(t.id); setTypeForm({name:t.name, content:t.content, keywords:t.keywords, remarks:t.remarks}) }} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", marginRight: "0.5rem" }}>수정</button>
                        <button onClick={async () => { if(confirm("삭제하시겠습니까?")) { await fetch(`/api/standards/work-types?id=${t.id}`, {method:"DELETE"}); fetchData(); } }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
