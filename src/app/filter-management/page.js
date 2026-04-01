"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function FilterManagement() {
  const [filters, setFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchFilters = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/filters");
      if (res.ok) {
        const data = await res.json();
        setFilters(data.filters || []);
      }
    } catch(e) {
      console.error("필터 조회 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilters();
  }, []);

  const handleApplyFilter = (jql) => {
    // 쿼리 스트링으로 JQL을 넘기며 Filter Generation 페이지로 이동
    // 라우터를 통해 이동하면 해당 페이지 마운트 시 URL을 파싱하여 자동 조회를 실행함.
    router.push(`/filter-generation?jql=${encodeURIComponent(jql)}`);
  };

  const handleDeleteFilter = async (id, name) => {
    if (!confirm(`'${name}' 필터를 정말 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch(`/api/filters/${id}`, { method: "DELETE" });
      if (res.ok) {
        alert("성공적으로 삭제되었습니다.");
        fetchFilters();
      } else {
        const data = await res.json();
        alert("삭제 실패: " + data.error);
      }
    } catch(err) {
      alert("오류 발생: " + err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>저장된 필터 관리</h1>
        <p>기존에 저장한 맞춤형 JQL 필터들을 손쉽게 관리하고, 클릭 한 번으로 적용 화면(Filter Generation)으로 이동하세요.</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">필터 목록을 불러오는 중입니다...</div>
        ) : filters.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>필터명 (메모)</th>
                  <th style={{ width: "50%" }}>JQL 쿼리</th>
                  <th style={{ width: "15%" }}>생성일</th>
                  <th style={{ width: "15%", textAlign: "right" }}>관리 작업</th>
                </tr>
              </thead>
              <tbody>
                {filters.map((f) => (
                  <tr key={f.id}>
                    <td style={{ color: "var(--text-primary)", fontWeight: "600", fontSize: "1.05rem" }}>{f.name}</td>
                    <td style={{ maxWidth: "400px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <code style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "4px", color: "var(--accent-color)" }}>
                        {f.jql}
                      </code>
                    </td>
                    <td style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                      {new Date(f.created_at).toLocaleString("ko-KR")}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "0.5rem" }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", height: "auto" }}
                          onClick={() => handleApplyFilter(f.jql)}
                        >
                          불러와서 조회
                        </button>
                        <button 
                          className="btn" 
                          style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem", height: "auto", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.3)" }}
                          onClick={() => handleDeleteFilter(f.id, f.name)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="loading" style={{ padding: "4rem 0" }}>
            저장된 필터가 없습니다. 'Filter Generation' 메뉴에서 새 필터를 설계하고 💾 저장해 보세요!
          </div>
        )}
      </div>
    </div>
  );
}
