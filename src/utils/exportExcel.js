"use client";

// Utility Layer: 엑셀 파일 생성 등의 독립 기능
export async function exportIssuesToExcel(issues, filename = "my_assigned_issues.xlsx", visibleColumns = [], AVAILABLE_COLUMNS = []) {
  if (!issues || issues.length === 0) return;

  // Next.js (Client) 에서의 xlsx 초기 로드 시 터지는 에러 방지용 (동적 로드)
  const xlsx = await import("xlsx");

  // Helper to extract nested values reliably
  const extractFieldValue = (issue, colId) => {
    if (colId === "key") return issue.key;
    const f = issue.fields || {};
    switch (colId) {
      case "summary": return f.summary || "";
      case "status": return f.status?.name || "";
      case "assignee": return f.assignee?.displayName || "미할당";
      case "reporter": return f.reporter?.displayName || "미할당";
      case "issuetype": return f.issuetype?.name || "";
      case "priority": return f.priority?.name || "";
      case "resolution": return f.resolution?.name || "미해결";
      case "created": return f.created ? new Date(f.created).toLocaleString("ko-KR") : "";
      case "updated": return f.updated ? new Date(f.updated).toLocaleString("ko-KR") : "";
      case "duedate": return f.duedate || "";
      default: return "";
    }
  };

  const exportData = issues.map((issue) => {
    const row = {};
    if (visibleColumns && visibleColumns.length > 0 && AVAILABLE_COLUMNS.length > 0) {
      // 선택된 동적 컬럼만 출력 (표 화면과 100% 동일하게 엑셀 출력)
      visibleColumns.forEach(colId => {
        const colDef = AVAILABLE_COLUMNS.find(c => c.id === colId);
        if (colDef) {
          row[colDef.label] = extractFieldValue(issue, colId);
        }
      });
    } else {
      // 대시보드 등의 기존 로직을 위한 하위 호환 구조
      row["이슈 키"] = issue.key;
      row["요약 (Summary)"] = issue.fields?.summary || "";
      row["상태 (Status)"] = issue.fields?.status?.name || "";
      row["담당자 (Assignee)"] = issue.fields?.assignee?.displayName || "미할당";
      row["생성일 (Created)"] = issue.fields?.created ? new Date(issue.fields.created).toLocaleString("ko-KR") : "";
    }
    return row;
  });

  const worksheet = xlsx.utils.json_to_sheet(exportData);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Issues");
  xlsx.writeFile(workbook, filename);
}
