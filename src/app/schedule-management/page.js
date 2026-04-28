"use client";

import { useState, useEffect } from "react";

export default function ScheduleManagement() {
  const [projectSchedules, setProjectSchedules] = useState([]);
  const [worklogSchedules, setWorklogSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="page-container">
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
    </div>
  );
}
