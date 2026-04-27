"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

export default function MonthlyReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReports = async () => {
    try {
      const res = await fetch("/api/monthly-reports");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleDelete = async (id) => {
    if (!confirm("이 리포트를 삭제하시겠습니까?")) return;
    try {
      await fetch(`/api/monthly-reports?id=${id}`, { method: "DELETE" });
      fetchReports();
    } catch(e) {
      alert("삭제 실패");
    }
  };

  const calculateMM = (hrs) => (hrs / 8 / 20.5).toFixed(3);

  const handleExport = (report) => {
    try {
      let parsedData = [];
      try {
        parsedData = JSON.parse(report.report_data_json || "[]");
      } catch (e) {
        alert("데이터 파싱 오류"); return;
      }
      
      if (parsedData.length === 0) {
        alert("출력할 작업기록 데이터가 없습니다."); return;
      }

      const wb = XLSX.utils.book_new();
      const detail = parsedData.map(w => ({
        "날짜": new Date(w.started).toLocaleDateString(),
        "이슈": w.issueKey,
        "요약": w.issueSummary,
        "작업자": w.author,
        "시간(h)": w.timeSpent,
        "MM": calculateMM(w.timeSpentSeconds/3600),
        "유형": w.taskType,
        "내용": w.comment
      }));

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "작업상세");
      XLSX.writeFile(wb, `Monthly_Report_${report.project_code}_${report.report_month}.xlsx`);
    } catch (e) {
      alert("엑셀 저장 실패: " + e.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>📑 월간 리포트 보관함</h1>
        <p>자동으로 생성된 프로젝트별 월간 리포트를 확인하고 다운로드할 수 있습니다.</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">데이터를 불러오는 중입니다...</div>
        ) : reports.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "#888" }}>
            생성된 리포트가 없습니다. <br />
            프로젝트 모니터링 메뉴에서 자동 생성을 등록해 보세요.
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>대상 월</th>
                  <th>수집 기간</th>
                  <th>총 시간</th>
                  <th>총 MM</th>
                  <th>생성 일시</th>
                  <th style={{ textAlign: "right" }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: "bold", color: "white" }}>{r.project_name} <span style={{ fontSize: "0.8rem", color: "#6366f1" }}>({r.project_code})</span></td>
                    <td style={{ fontWeight: "bold", color: "#10b981" }}>{r.report_month}</td>
                    <td style={{ fontSize: "0.85rem", color: "#aaa" }}>{r.target_period}</td>
                    <td style={{ fontWeight: "bold" }}>{r.total_hours}h</td>
                    <td style={{ fontWeight: "bold", color: "#fbbf24" }}>{r.total_mm} MM</td>
                    <td style={{ fontSize: "0.85rem", color: "#777" }}>{new Date(r.created_at).toLocaleString("ko-KR")}</td>
                    <td style={{ textAlign: "right" }}>
                      <button onClick={() => handleExport(r)} className="btn-success" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", marginRight: "0.5rem" }}>엑셀 다운로드</button>
                      <button onClick={() => handleDelete(r.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
