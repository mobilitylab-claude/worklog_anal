"use client";

import { useState, useEffect } from "react";

export default function ScheduleManagement() {
  const [projectSchedules, setProjectSchedules] = useState([]);
  const [worklogSchedules, setWorklogSchedules] = useState([]);
  const [dbUsers, setDbUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // 수정 모달 관련 상태
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [editTargetMode, setEditTargetMode] = useState("all");
  const [editSelectedGroups, setEditSelectedGroups] = useState([]);
  const [editSelectedUsers, setEditSelectedUsers] = useState([]);

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const [pRes, wRes] = await Promise.all([
        fetch("/api/scheduled-reports"),
        fetch("/api/worklog-schedules")
      ]);
      const pData = await pRes.json();
      const wData = await wRes.json();
      
      setProjectSchedules(pData.reports || []);
      setWorklogSchedules(wData.schedules || []);
    } catch (e) {
      console.error("스케줄 목록 조회 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
    fetch("/api/users")
      .then(r => r.json())
      .then(d => setDbUsers((d.users || []).filter(u => u.is_active !== 0)))
      .catch(e => console.error("사용자 조회 실패:", e));
  }, []);

  const handleDeleteProjectSchedule = async (id) => {
    if (!confirm("해당 프로젝트 모니터링 스케줄을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/scheduled-reports?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        alert("삭제 완료");
        fetchSchedules();
      } else {
        alert("삭제 실패");
      }
    } catch (e) {
      alert("오류: " + e.message);
    }
  };

  const handleDeleteWorklogSchedule = async (id) => {
    if (!confirm("해당 워크로그 분석 스케줄을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`/api/worklog-schedules?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        alert("삭제 완료");
        fetchSchedules();
      } else {
        alert("삭제 실패");
      }
    } catch (e) {
      alert("오류: " + e.message);
    }
  };

  // 수정 버튼 클릭 핸들러
  const handleEditClick = (schedule) => {
    setEditingSchedule(schedule);
    setEditTargetMode(schedule.target_mode || "all");
    
    let parsedUsers = [];
    try {
      if (schedule.target_users_json) {
        parsedUsers = JSON.parse(schedule.target_users_json);
      }
    } catch (e) {
      console.error("대상자 파싱 실패:", e);
    }
    
    const userIds = parsedUsers.map(u => u.id);
    setEditSelectedUsers(userIds);
    
    // 선택된 유저들의 고유 파트 목록 추출 및 설정
    const activeParts = Array.from(new Set(parsedUsers.map(u => u.part).filter(Boolean)));
    setEditSelectedGroups(activeParts);
    
    setIsEditModalOpen(true);
  };

  // 파트 리스트
  const partsList = Array.from(new Set(dbUsers.map(u => u.part))).filter(Boolean);

  const handleGroupToggle = (part) => {
    const members = dbUsers.filter(u => u.part === part).map(u => u.id);
    if (editSelectedGroups.includes(part)) {
      setEditSelectedGroups(prev => prev.filter(g => g !== part));
      setEditSelectedUsers(prev => prev.filter(id => !members.includes(id)));
    } else {
      setEditSelectedGroups(prev => [...prev, part]);
      setEditSelectedUsers(prev => Array.from(new Set([...prev, ...members])));
    }
  };

  const handleUserToggle = (userId) => {
    setEditSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // 스케줄 설정 변경 저장 실행
  const handleSaveEdit = async () => {
    if (!editingSchedule) return;

    let targetUsers = [];
    if (editTargetMode === "group") {
      targetUsers = dbUsers.filter(u => editSelectedGroups.includes(u.part));
    } else if (editTargetMode === "individual") {
      targetUsers = dbUsers.filter(u => editSelectedUsers.includes(u.id));
    } else {
      targetUsers = [...dbUsers];
    }

    try {
      const res = await fetch("/api/worklog-schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingSchedule.id,
          target_mode: editTargetMode,
          target_users: targetUsers
        })
      });

      if (res.ok) {
        alert("✅ 스케줄 설정이 성공적으로 수정되었습니다.");
        setIsEditModalOpen(false);
        setEditingSchedule(null);
        fetchSchedules();
      } else {
        const data = await res.json();
        alert("수정 실패: " + (data.error || "알 수 없는 오류"));
      }
    } catch (e) {
      alert("수정 중 오류 발생: " + e.message);
    }
  };

  return (
    <div className="page-container" style={{ position: "relative" }}>
      <div className="page-header" style={{ marginBottom: "2rem" }}>
        <h1>자동 리포트 스케줄 관리</h1>
        <p>프로젝트 모니터링 및 워크로그 분석기에서 등록된 자동 스케줄(크론잡 대상) 목록을 조회하고 관리합니다.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
        {/* 프로젝트 스케줄 */}
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--accent-color)" }}>
            📈 프로젝트 모니터링 스케줄 ({projectSchedules.length})
          </h2>
          {loading ? <p>로딩 중...</p> : (
            <div className="table-wrapper">
              <table style={{ fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>과제명 (코드)</th>
                    <th>필터 조건</th>
                    <th>등록일</th>
                    <th style={{ textAlign: "right" }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSchedules.length === 0 ? (
                    <tr><td colSpan="5" style={{ textAlign: "center", padding: "2rem" }}>등록된 스케줄이 없습니다.</td></tr>
                  ) : projectSchedules.map(s => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td style={{ fontWeight: "bold" }}>{s.project_name} <br/><span style={{ color: "#888", fontSize: "0.75rem" }}>({s.project_code})</span></td>
                      <td>
                        <div style={{ color: "#aab2ff", fontSize: "0.75rem" }}>부모키: {s.parent_key || "-"}</div>
                        <div style={{ color: "#a7f3d0", fontSize: "0.75rem" }}>포함: {s.include_keyword || "-"}</div>
                        <div style={{ color: "#fecaca", fontSize: "0.75rem" }}>제외: {s.exclude_keyword || "-"}</div>
                        <div style={{ color: "#888", fontSize: "0.75rem" }}>타겟: {s.target_mode}</div>
                      </td>
                      <td style={{ color: "#888" }}>{new Date(s.created_at).toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>
                        <button onClick={() => handleDeleteProjectSchedule(s.id)} className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto" }}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 워크로그 스케줄 */}
        <div className="card">
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--accent-color)" }}>
            ⏱️ 워크로그 분석 스케줄 ({worklogSchedules.length})
          </h2>
          {loading ? <p>로딩 중...</p> : (
            <div className="table-wrapper">
              <table style={{ fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>주기 (Type)</th>
                    <th>대상 모드</th>
                    <th>대상자 수</th>
                    <th>등록일</th>
                    <th style={{ textAlign: "right" }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {worklogSchedules.length === 0 ? (
                    <tr><td colSpan="6" style={{ textAlign: "center", padding: "2rem" }}>등록된 스케줄이 없습니다.</td></tr>
                  ) : worklogSchedules.map(s => {
                    let targetUsersCount = 0;
                    try {
                      if (s.target_users_json) {
                        const parsed = JSON.parse(s.target_users_json);
                        targetUsersCount = parsed.length;
                      }
                    } catch(e) {}
                    
                    return (
                      <tr key={s.id}>
                        <td>{s.id}</td>
                        <td style={{ fontWeight: "bold", color: s.schedule_type === "daily" ? "#60a5fa" : "#34d399" }}>
                          {s.schedule_type === "daily" ? "일간 (전날)" : "월간 (해당월)"}
                        </td>
                        <td>{s.target_mode === "all" ? "전체 인원" : s.target_mode === "group" ? "특정 그룹" : "개별 인원"}</td>
                        <td>{targetUsersCount}명</td>
                        <td style={{ color: "#888" }}>{new Date(s.created_at).toLocaleString()}</td>
                        <td style={{ textAlign: "right" }}>
                          <button onClick={() => handleEditClick(s)} className="btn btn-secondary" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto", marginRight: "0.4rem" }}>
                            수정
                          </button>
                          <button onClick={() => handleDeleteWorklogSchedule(s.id)} className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", height: "auto" }}>
                            삭제
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
      </div>

      {/* ── 스케줄 정보 수정 모달 (Overlay) ── */}
      {isEditModalOpen && editingSchedule && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)",
          zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(6px)",
        }}>
          <div style={{
            background: "var(--card-bg, #12121f)",
            border: "1px solid var(--accent-color, #3b82f6)",
            borderRadius: "16px",
            padding: "2rem",
            maxWidth: "600px",
            width: "90%",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column"
          }}>
            <div style={{ borderBottom: "1px solid #2a2a3f", paddingBottom: "1rem", marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "1.25rem", color: "white", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                ⚙️ 워크로그 분석 스케줄 수정 (ID: {editingSchedule.id})
              </h3>
              <p style={{ fontSize: "0.8rem", color: "#888", marginTop: "0.3rem" }}>
                크론잡 대상이 되는 워크로그 분석 스케줄의 수집 범위와 참여 대상자를 갱신합니다.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: "auto", paddingRight: "0.5rem" }}>
              {/* 스케줄 주기 정보 */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#aaa", marginBottom: "0.4rem", fontWeight: "bold" }}>
                  ⏰ 수집 주기 (유형)
                </label>
                <input
                  type="text"
                  value={editingSchedule.schedule_type === "daily" ? "일간 자동 리포트 (매일 전날 수집)" : "월간 자동 리포트 (매월 말일 수집)"}
                  disabled
                  style={{
                    width: "100%", padding: "0.6rem", borderRadius: "8px",
                    background: "rgba(255,255,255,0.03)", border: "1px solid #333", color: "#888",
                    fontSize: "0.85rem", boxSizing: "border-box"
                  }}
                />
              </div>

              {/* 대상 모드 변경 */}
              <div style={{ marginBottom: "1.5rem" }}>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#aaa", marginBottom: "0.4rem", fontWeight: "bold" }}>
                  📁 분석 대상 모드
                </label>
                <select
                  value={editTargetMode}
                  onChange={e => setEditTargetMode(e.target.value)}
                  style={{
                    width: "100%", padding: "0.6rem", borderRadius: "8px",
                    background: "#0c0c16", border: "1px solid #445", color: "white",
                    fontSize: "0.85rem", boxSizing: "border-box", outline: "none"
                  }}
                >
                  <option value="all">전체 인원 분석</option>
                  <option value="group">파트/그룹별 조회</option>
                  <option value="individual">개별 인원 선택</option>
                </select>
              </div>

              {/* 그룹/인원 디테일 토글 */}
              {editTargetMode !== "all" && (
                <div style={{
                  marginBottom: "1.5rem", padding: "1.25rem",
                  background: "rgba(255,255,255,0.02)", borderRadius: "12px", border: "1px solid #2a2a3f"
                }}>
                  {/* 그룹 토글 */}
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.82rem", color: "var(--accent-color, #60a5fa)", fontWeight: 600 }}>
                      📁 대상 파트/그룹 선택
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                      {partsList.map(p => (
                        <label key={p} style={{
                          display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem",
                          padding: "4px 10px", borderRadius: "16px",
                          border: `1px solid ${editSelectedGroups.includes(p) ? "var(--accent-color, #3b82f6)" : "#444"}`,
                          background: editSelectedGroups.includes(p) ? "rgba(59,130,246,0.15)" : "transparent",
                          cursor: "pointer", transition: "all 0.2s"
                        }}>
                          <input type="checkbox" checked={editSelectedGroups.includes(p)} onChange={() => handleGroupToggle(p)} />
                          <span style={{ color: editSelectedGroups.includes(p) ? "white" : "#aaa" }}>{p}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 세부 인원 토글 */}
                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.82rem", color: "#aaa", fontWeight: 600 }}>
                      👤 세부 대상자 선택 ({editSelectedUsers.length}명 선택됨)
                    </label>
                    <div style={{
                      display: "flex", flexWrap: "wrap", gap: "0.5rem", maxHeight: "160px",
                      overflowY: "auto", padding: "0.6rem", background: "rgba(0,0,0,0.3)",
                      borderRadius: "8px", border: "1px solid #1a1a2f"
                    }}>
                      {(editTargetMode === "group" ? dbUsers.filter(u => editSelectedGroups.includes(u.part)) : dbUsers).map(u => (
                        <label key={u.id} style={{
                          display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem",
                          background: editSelectedUsers.includes(u.id) ? "rgba(16,185,129,0.12)" : "transparent",
                          border: `1px solid ${editSelectedUsers.includes(u.id) ? "#10b981" : "transparent"}`,
                          padding: "3px 8px", borderRadius: "4px", cursor: "pointer", transition: "all 0.2s"
                        }}>
                          <input type="checkbox" checked={editSelectedUsers.includes(u.id)} onChange={() => handleUserToggle(u.id)} />
                          <span style={{ color: editSelectedUsers.includes(u.id) ? "#34d399" : "#888" }}>
                            {u.name} ({u.part})
                          </span>
                        </label>
                      ))}
                      {editTargetMode === "group" && editSelectedGroups.length === 0 && (
                        <span style={{ fontSize: "0.78rem", color: "gray", padding: "0.5rem" }}>
                          분석 대상 그룹을 위에서 먼저 선택해 주세요.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 작업 제어 영역 */}
            <div style={{ borderTop: "1px solid #2a2a3f", paddingTop: "1.25rem", marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                onClick={() => { setIsEditModalOpen(false); setEditingSchedule(null); }}
                style={{
                  background: "transparent", border: "1px solid #444", color: "#ccc",
                  padding: "0.5rem 1.25rem", borderRadius: "8px", fontSize: "0.85rem", cursor: "pointer"
                }}
              >
                취소
              </button>
              <button
                onClick={handleSaveEdit}
                style={{
                  background: "var(--accent-color, #3b82f6)", border: "none", color: "white",
                  padding: "0.5rem 1.5rem", borderRadius: "8px", fontSize: "0.85rem", cursor: "pointer",
                  fontWeight: "bold"
                }}
              >
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
