"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { getJiraAuthHeaders } from "@/lib/jiraAuthClient";

const AVAILABLE_COLUMNS = [
  { id: "started", label: "작업 일시", width: "11%" },
  { id: "issueKey", label: "이슈 번호", width: "8%" },
  { id: "issueType", label: "이슈 유형", width: "7%" },
  { id: "issueSummary", label: "이슈 요약", width: "15%" },
  { id: "issueStatus", label: "이슈 상태", width: "6%" },
  { id: "issueStartDate", label: "시작일", width: "7%" },
  { id: "dueDate", label: "기한", width: "7%" },
  { id: "originalEstimate", label: "예상 시간", width: "6%" },
  { id: "remainingEstimate", label: "남은 시간", width: "6%" },
  { id: "issueTimeSpent", label: "기록된 시간", width: "6%" },
  { id: "author", label: "작업자", width: "8%" },
  { id: "timeSpent", label: "소요시간", width: "7%" },
  { id: "comment", label: "작업 내용", width: "20%" },
];

export default function WorklogAnalyzer() {
  // ── 날짜 기본값: 어제 ──────────────────────────────────────────
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  })();

  const [startDate, setStartDate] = useState(yesterday);
  const [endDate, setEndDate] = useState(yesterday);

  // ── 검색 조건 ──────────────────────────────────────────────────
  const [includeKeyword, setIncludeKeyword] = useState("");
  const [excludeKeyword, setExcludeKeyword] = useState("");
  const [targetMode, setTargetMode] = useState("me");
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);

  // ── 사용자 목록 (DB) ───────────────────────────────────────────
  const [dbUsers, setDbUsers] = useState([]);

  // ── JQL 관리 ──────────────────────────────────────────────────
  const [jqlValue, setJqlValue] = useState("");
  const [isManualJql, setIsManualJql] = useState(false);

  // ── 결과 / 상태 ────────────────────────────────────────────────
  const [worklogs, setWorklogs] = useState([]);
  const [jiraHost, setJiraHost] = useState("");
  const [usedJql, setUsedJql] = useState("");
  const [debugLog, setDebugLog] = useState([]);
  const [totalIssues, setTotalIssues] = useState(0);
  const [showDebug, setShowDebug] = useState(false);

  // ── 로딩 / 진행 ────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const progressTimerRef = useRef(null);

  // ── UI 제어 ────────────────────────────────────────────────────
  const [filterAuthor, setFilterAuthor] = useState(null);
  const [filterProjectCode, setFilterProjectCode] = useState(null);
  const [filterWorkType, setFilterWorkType] = useState(null);
  const [showCharts, setShowCharts] = useState(true);
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(AVAILABLE_COLUMNS.map(c => c.id));

  // ── 초기 사용자 목록 로드 ──────────────────────────────────────
  useEffect(() => {
    fetch("/api/users")
      .then(r => r.json())
      .then(d => setDbUsers((d.users || []).filter(u => u.is_active !== 0)))
      .catch(e => console.error("사용자 조회 실패:", e));
  }, []);

  // ── 자동 JQL 생성 (미리보기 표시용) ─────────────────────────
  // ※ 실제 실행 JQL도 백엔드에서 동일하게 worklogDate < endDate+1일 방식 사용
  useEffect(() => {
    if (isManualJql) return;

    const endDateObj = new Date(endDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endDateNext = endDateObj.toISOString().split("T")[0];

    let jql = `worklogDate >= "${startDate}" AND worklogDate < "${endDateNext}" AND worklogAuthor = currentUser()`;

    if (targetMode !== "me" && selectedUsers.length > 0) {
      const accounts = [...new Set(
        dbUsers.filter(u => selectedUsers.includes(u.id)).map(u => u.dt_account).filter(Boolean)
      )];
      if (accounts.length > 0) {
        const list = accounts.map(a => `"${a}"`).join(", ");
        jql = `worklogDate >= "${startDate}" AND worklogDate < "${endDateNext}" AND worklogAuthor in (${list})`;
      }
    }
    setJqlValue(jql);
  }, [startDate, endDate, targetMode, selectedUsers, dbUsers, isManualJql]);

  // ── 파트 목록 ──────────────────────────────────────────────────
  const partsList = useMemo(
    () => Array.from(new Set(dbUsers.map(u => u.part))).filter(Boolean),
    [dbUsers]
  );

  // ── 그룹 토글 ──────────────────────────────────────────────────
  const handleGroupToggle = (part) => {
    const members = dbUsers.filter(u => u.part === part).map(u => u.id);
    if (selectedGroups.includes(part)) {
      setSelectedGroups(prev => prev.filter(g => g !== part));
      setSelectedUsers(prev => prev.filter(id => !members.includes(id)));
    } else {
      setSelectedGroups(prev => [...prev, part]);
      setSelectedUsers(prev => Array.from(new Set([...prev, ...members])));
    }
  };

  const handleUserToggle = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // ── 시작일 변경 → endDate가 더 빠르면 startDate와 동일하게 조정 ──
  // ※ endDate +1일 처리는 백엔드(route.js)에서 자동 수행
  const handleStartDateChange = (val) => {
    setStartDate(val);
    if (endDate < val) setEndDate(val);
  };

  // ── 진행바 시작/정리 ──────────────────────────────────────────
  const startProgress = () => {
    setSearchProgress(0);
    setStatusMsg("Jira 이슈 목록 수집 중...");
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      setSearchProgress(prev => {
        if (prev >= 90) return prev;
        return prev + (prev < 40 ? 6 : prev < 70 ? 3 : 1);
      });
    }, 300);
  };

  const finishProgress = (msg = "완료") => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setSearchProgress(100);
    setStatusMsg(msg);
    setTimeout(() => setLoading(false), 600);
  };

  // ── 검색 실행 ─────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!startDate || !endDate) { alert("날짜를 입력해주세요."); return; }

    setLoading(true);
    setWorklogs([]);
    setDebugLog([]);
    setFilterAuthor(null);
    setFilterProjectCode(null);
    setFilterWorkType(null);
    startProgress();

    try {
      let targetUsers = [];
      if (targetMode !== "me") {
        targetUsers = dbUsers.filter(u => selectedUsers.includes(u.id));
      }

      setStatusMsg("Jira API 호출 중 (이슈 스캔)...");

      const res = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getJiraAuthHeaders() },
        body: JSON.stringify({
          startDate,
          endDate,
          includeKeyword,
          excludeKeyword,
          targetType: targetMode === "me" ? "me" : "custom",
          targetUsers,
          overrideJql: isManualJql ? jqlValue : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "조회 실패");

      setStatusMsg(`워크로그 ${data.worklogs?.length ?? 0}건 수집 완료`);
      setWorklogs(data.worklogs || []);
      setJiraHost(data.jiraHost || "");
      setUsedJql(data.usedJql || "");
      setDebugLog(data.debugLog || []);
      setTotalIssues(data.totalIssues || 0);
      finishProgress(`✅ ${data.worklogs?.length ?? 0}건 수집 완료`);
    } catch (err) {
      finishProgress(`❌ 오류: ${err.message}`);
      setLoading(false);
      alert("조회 실패: " + err.message);
    }
  };

  // ── 엑셀 내보내기 ─────────────────────────────────────────────
  const handleExport = async () => {
    if (worklogs.length === 0) return;
    try {
      const xlsx = await import("xlsx");
      const wb = xlsx.utils.book_new();

      // 시트1: 상세 내역
      const detail = filteredWorklogs.map(w => {
        const row = {};
        if (visibleColumns.includes("started")) row["작업 일시"] = new Date(w.started).toLocaleString("ko-KR");
        if (visibleColumns.includes("issueKey")) row["이슈 키"] = w.issueKey;
        if (visibleColumns.includes("issueType")) row["이슈 유형"] = w.issueType;
        if (visibleColumns.includes("issueSummary")) row["이슈 요약"] = w.issueSummary;
        if (visibleColumns.includes("issueStatus")) row["이슈 상태"] = w.issueStatus;
        if (visibleColumns.includes("issueStartDate")) row["시작일"] = w.issueStartDate;
        if (visibleColumns.includes("dueDate")) row["기한"] = w.dueDate;
        if (visibleColumns.includes("originalEstimate")) row["예상 시간"] = w.originalEstimate;
        if (visibleColumns.includes("remainingEstimate")) row["남은 시간"] = w.remainingEstimate;
        if (visibleColumns.includes("issueTimeSpent")) row["기록된 시간"] = w.issueTimeSpent;
        if (visibleColumns.includes("author")) row["작업자"] = w.author;
        if (visibleColumns.includes("timeSpent")) row["소요 시간(h)"] = w.timeSpent;
        if (visibleColumns.includes("timeSpent")) row["원본 시간"] = w.timeSpentRaw || w.timeSpent;
        if (visibleColumns.includes("comment")) row["작업 내용"] = w.comment;
        return row;
      });
      const ws1 = xlsx.utils.json_to_sheet(detail);
      ws1["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 80 }];
      xlsx.utils.book_append_sheet(wb, ws1, "1. 작업 내역 상세");

      // 시트2: 월별
      const ws2 = xlsx.utils.json_to_sheet(statsByMonth.map(s => ({
        "연월": s.label,
        "MM": parseFloat(s.value),
        "총 시간(H)": parseFloat(s.hours)
      })));
      ws2["!cols"] = [{ wch: 15 }, { wch: 12 }, { wch: 15 }];
      xlsx.utils.book_append_sheet(wb, ws2, "2. 월별 통계");

      // 시트3: 작업자별
      const allProjectCodes = Array.from(new Set(worklogs.map(w => w.projectCode || "미지정"))).sort();
      const userStatsRows = statsByUser.map(s => {
        const authorName = s.label;
        const totalHours = parseFloat(s.value);

        const dbUser = dbUsers.find(u =>
          authorName === u.name ||
          authorName.startsWith(u.name) ||
          u.name.startsWith(authorName)
        );
        const groupName = dbUser ? (dbUser.part || "미지정") : "미지정";

        const row = {
          "작업자": authorName,
          "분석대상 그룹": groupName,
          "누적 시간(H)": totalHours
        };

        allProjectCodes.forEach(pc => {
          const secondsForProject = worklogs
            .filter(w => {
              const isAuthorMatch = w.author === authorName ||
                w.author.startsWith(authorName) ||
                authorName.startsWith(w.author);
              const wPc = w.projectCode || "미지정";
              return isAuthorMatch && wPc === pc;
            })
            .reduce((sum, w) => sum + (w.timeSpentSeconds || 0), 0);

          row[pc] = parseFloat((secondsForProject / 3600).toFixed(1));
        });

        return row;
      });

      // 그룹별 분류 및 정렬
      const groupsMap = {};
      userStatsRows.forEach(row => {
        const g = row["분석대상 그룹"];
        if (!groupsMap[g]) groupsMap[g] = [];
        groupsMap[g].push(row);
      });

      const sortedGroupNames = Object.keys(groupsMap).sort((a, b) => {
        if (a === "미지정" && b !== "미지정") return 1;
        if (a !== "미지정" && b === "미지정") return -1;
        return a.localeCompare(b);
      });

      const finalRows = [];
      const totalProjectHours = {};
      allProjectCodes.forEach(pc => { totalProjectHours[pc] = 0; });
      let overallTotalHours = 0;

      sortedGroupNames.forEach(groupName => {
        const groupRows = groupsMap[groupName];

        // 그룹 내에서는 누적 시간(H) 내림차순 정렬
        groupRows.sort((a, b) => b["누적 시간(H)"] - a["누적 시간(H)"]);

        // 작업자 행 추가
        finalRows.push(...groupRows);

        // 소계 계산
        const subTotalHours = groupRows.reduce((sum, r) => sum + r["누적 시간(H)"], 0);
        const subTotalProjects = {};
        allProjectCodes.forEach(pc => {
          subTotalProjects[pc] = groupRows.reduce((sum, r) => sum + (r[pc] || 0), 0);
          totalProjectHours[pc] += subTotalProjects[pc];
        });
        overallTotalHours += subTotalHours;

        // 소계 행 추가
        const subTotalRow = {
          "작업자": `[소계] ${groupName} 누적계`,
          "분석대상 그룹": groupName,
          "누적 시간(H)": parseFloat(subTotalHours.toFixed(1))
        };
        allProjectCodes.forEach(pc => {
          subTotalRow[pc] = parseFloat(subTotalProjects[pc].toFixed(1));
        });

        finalRows.push(subTotalRow);
      });

      // 전체 총계 행 추가
      const totalRow = {
        "작업자": "[총계] 전체 합계",
        "분석대상 그룹": "-",
        "누적 시간(H)": parseFloat(overallTotalHours.toFixed(1))
      };
      allProjectCodes.forEach(pc => {
        totalRow[pc] = parseFloat(totalProjectHours[pc].toFixed(1));
      });
      finalRows.push(totalRow);

      const ws3 = xlsx.utils.json_to_sheet(finalRows);
      const colWidths = [
        { wch: 25 }, // 작업자
        { wch: 18 }, // 분석대상 그룹
        { wch: 15 }, // 누적 시간(H)
        ...allProjectCodes.map(() => ({ wch: 15 })) // 프로젝트 코드들
      ];
      ws3["!cols"] = colWidths;
      xlsx.utils.book_append_sheet(wb, ws3, "3. 작업자별 통계");

      xlsx.writeFile(wb, `Jira_Worklog_${startDate}_to_${endDate}.xlsx`);
    } catch (e) {
      alert("엑셀 오류: " + e.message);
    }
  };

  const toggleColumn = (id) =>
    setVisibleColumns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

  // ── URL 포함 텍스트 링크화 ──────────────────────────────────────
  const renderComment = (text) => {
    if (!text) return "(작업 내용 미기재)";
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>
          {part}
        </a>
      ) : (
        part
      )
    );
  };

  // ── 통계 계산 ─────────────────────────────────────────────────
  const statsByMonth = useMemo(() => {
    const map = {};
    worklogs.forEach(w => {
      const m = w.started.substring(0, 7);
      map[m] = (map[m] || 0) + (w.timeSpentSeconds || 0);
    });
    return Object.entries(map).sort().map(([k, v]) => {
      const hours = v / 3600;
      const mm = hours / 8 / 20.5;
      return {
        label: k,
        value: mm.toFixed(3), // MM은 정밀도를 위해 소수점 3자리
        hours: hours.toFixed(1)
      };
    });
  }, [worklogs]);

  const statsByUser = useMemo(() => {
    const map = {};
    worklogs.forEach(w => { map[w.author] = (map[w.author] || 0) + (w.timeSpentSeconds || 0); });

    // 선택된 사용자 중 워크로그가 없는 사람도 0h로 포함
    // ※ Jira displayName("장성민")과 DB name("장성민 기타협력사")처럼
    //   이름이 포함 관계인 경우 같은 사람으로 인식해 중복 추가 방지
    if (targetMode !== "me") {
      const worklogAuthors = Object.keys(map);
      dbUsers
        .filter(u => selectedUsers.includes(u.id))
        .forEach(u => {
          const hasWorklog = worklogAuthors.some(author =>
            author === u.name ||           // 정확히 일치
            author.startsWith(u.name) ||   // Jira명이 DB명으로 시작 ("장성민 (회사)" vs "장성민")
            u.name.startsWith(author)      // DB명이 Jira명으로 시작  ("장성민 기타협력사" vs "장성민")
          );
          if (!hasWorklog) map[u.name] = 0;
        });
    }

    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / 3600).toFixed(1) }));
  }, [worklogs, targetMode, selectedUsers, dbUsers]);

  const statsByProjectCode = useMemo(() => {
    const map = {};
    worklogs.forEach(w => {
      const pc = w.projectCode || "미지정";
      map[pc] = (map[pc] || 0) + (w.timeSpentSeconds || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / 3600).toFixed(1) }));
  }, [worklogs]);

  const statsByWorkType = useMemo(() => {
    const map = {};
    worklogs.forEach(w => {
      const wt = w.workType || "기타";
      map[wt] = (map[wt] || 0) + (w.timeSpentSeconds || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: (v / 3600).toFixed(1) }));
  }, [worklogs]);

  const issueStatusAnalysis = useMemo(() => {
    const issuesMap = {};
    worklogs.forEach(w => {
      if (!issuesMap[w.issueKey]) {
        issuesMap[w.issueKey] = {
          issueKey: w.issueKey,
          issueSummary: w.issueSummary,
          author: w.author,
          originalEstimate: w.originalEstimateSeconds || 0,
          remainingEstimate: w.remainingEstimateSeconds || 0,
          issueTimeSpent: w.issueTimeSpentSeconds || 0,
          originalEstimateStr: w.originalEstimate,
          issueTimeSpentStr: w.issueTimeSpent,
          dueDate: w.dueDate,
          issueStatus: w.issueStatus
        };
      }
    });

    const issues = Object.values(issuesMap);
    const now = new Date();
    // Exclude resolved issues for overdue checks
    const isDone = (status) => {
      if (!status) return false;
      const s = status.toLowerCase();
      return s.includes("완료") || s.includes("done") || s.includes("resolved") || s.includes("closed") || s.includes("종료");
    };

    const overdueDeadline = issues.filter(i => {
      if (!i.dueDate || i.dueDate === "-") return false;
      if (isDone(i.issueStatus)) return false;
      const dueDate = new Date(i.dueDate);
      // Compare without time
      now.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < now;
    });

    const overdueEstimate = issues.filter(i => {
      if (isDone(i.issueStatus)) return false;
      // originalEstimate must be set and issueTimeSpent > originalEstimate
      return i.originalEstimate > 0 && i.issueTimeSpent > i.originalEstimate;
    });

    return {
      overdueDeadline,
      overdueEstimate
    };
  }, [worklogs]);

  const filteredWorklogs = useMemo(() => {
    let result = worklogs;
    if (filterAuthor) result = result.filter(w => w.author === filterAuthor);
    if (filterProjectCode) result = result.filter(w => (w.projectCode || "미지정") === filterProjectCode);
    if (filterWorkType) result = result.filter(w => (w.workType || "기타") === filterWorkType);
    return result;
  }, [worklogs, filterAuthor, filterProjectCode, filterWorkType]);

  const filteredTotalHours = useMemo(() =>
    (filteredWorklogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0) / 3600).toFixed(1),
    [filteredWorklogs]
  );

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>

      {/* ── 전체화면 로딩 오버레이 ── */}
      {loading && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)",
          zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "var(--card-bg, #1a1a2e)",
            border: "1px solid #334",
            borderRadius: "16px",
            padding: "2.5rem 3rem",
            maxWidth: "520px",
            width: "90%",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚡</div>
            <h3 style={{ marginBottom: "0.5rem", color: "white" }}>Jira 정밀 스캔 중</h3>
            <p style={{ fontSize: "0.85rem", color: "#888", marginBottom: "1.5rem" }}>{statusMsg}</p>

            {/* 진행바 */}
            <div style={{ width: "100%", height: "10px", background: "#222", borderRadius: "5px", overflow: "hidden", marginBottom: "0.75rem" }}>
              <div style={{
                width: `${searchProgress}%`,
                height: "100%",
                background: "linear-gradient(90deg, #3b82f6 0%, #10b981 100%)",
                borderRadius: "5px",
                transition: "width 0.35s ease-out",
              }} />
            </div>
            <div style={{ fontWeight: "bold", fontSize: "1.1rem", color: "#10b981" }}>{searchProgress}%</div>
            <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#555" }}>
              이슈 전체 페이지네이션 + 워크로그 순차 수집 중.<br />데이터량에 따라 수 분이 소요될 수 있습니다.
            </p>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>워크로그 분석기</h1>
        <p>프로젝트 멤버들의 작업 시간을 심층 분석하고 시각화합니다.</p>
      </div>

      {/* ── 검색 조건 카드 ── */}
      <div className="card" style={{ marginBottom: "2rem" }}>

        {/* 날짜 + 대상 */}
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap", borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>시작일</label>
            <input type="date" value={startDate} onChange={e => handleStartDateChange(e.target.value)}
              style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>종료일</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>조회 대상</label>
            <select value={targetMode} onChange={e => setTargetMode(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "white" }}>
              <option value="me">나의 워크로그</option>
              <option value="group">파트/그룹별 조회</option>
              <option value="individual">개별 인원 선택</option>
            </select>
          </div>
        </div>

        {/* 그룹/인원 선택 */}
        {targetMode !== "me" && (
          <div style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: 600 }}>📁 분석 대상 그룹 선택</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                {partsList.map(p => (
                  <label key={p} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", padding: "4px 10px", borderRadius: "16px", border: `1px solid ${selectedGroups.includes(p) ? "var(--accent-color)" : "#444"}`, background: selectedGroups.includes(p) ? "rgba(59,130,246,0.1)" : "transparent", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedGroups.includes(p)} onChange={() => handleGroupToggle(p)} />
                    <span style={{ color: selectedGroups.includes(p) ? "white" : "gray" }}>{p}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>👤 세부 인원 ({selectedUsers.length}명 선택)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", maxHeight: "150px", overflowY: "auto", padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
                {(targetMode === "group" ? dbUsers.filter(u => selectedGroups.includes(u.part)) : dbUsers).map(u => (
                  <label key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", background: selectedUsers.includes(u.id) ? "rgba(16,185,129,0.1)" : "transparent", border: `1px solid ${selectedUsers.includes(u.id) ? "#10b981" : "transparent"}`, padding: "2px 8px", borderRadius: "4px", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => handleUserToggle(u.id)} />
                    <span style={{ color: selectedUsers.includes(u.id) ? "#34d399" : "var(--text-secondary)" }}>{u.name} ({u.part})</span>
                  </label>
                ))}
                {targetMode === "group" && selectedGroups.length === 0 && (
                  <span style={{ fontSize: "0.8rem", color: "gray", padding: "0.5rem" }}>분석할 그룹을 먼저 체크해주세요.</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* JQL 관리 패널 */}
        <div style={{ marginBottom: "1.5rem", padding: "1.25rem", background: "#050508", borderRadius: "12px", border: `1px solid ${isManualJql ? "var(--accent-color)" : "#2a2a3a"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--accent-color)", fontWeight: "bold" }}>
              🔍 JQL 쿼리 {isManualJql ? "(수동 편집 모드)" : "(자동 생성 모드)"}
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => setIsManualJql(v => !v)}
                style={{ background: isManualJql ? "var(--accent-color)" : "transparent", border: "1px solid var(--accent-color)", color: isManualJql ? "white" : "var(--accent-color)", padding: "0.2rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer" }}>
                {isManualJql ? "🔓 수동 편집 중" : "🔒 자동 생성 모드"}
              </button>
              {isManualJql && (
                <button onClick={() => setIsManualJql(false)}
                  style={{ background: "transparent", border: "1px solid #555", color: "#aaa", padding: "0.2rem 0.7rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer" }}>
                  자동으로 복구 ↩
                </button>
              )}
            </div>
          </div>
          <textarea
            value={jqlValue}
            onChange={e => isManualJql && setJqlValue(e.target.value)}
            readOnly={!isManualJql}
            style={{ width: "100%", height: "64px", background: isManualJql ? "rgba(59,130,246,0.08)" : "transparent", border: `1px solid ${isManualJql ? "var(--accent-color)" : "#2a2a3a"}`, borderRadius: "8px", color: isManualJql ? "white" : "#60a5fa", padding: "0.75rem", fontSize: "0.82rem", fontFamily: "monospace", outline: "none", resize: "vertical", boxSizing: "border-box" }}
          />
          <p style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "#555" }}>
            {isManualJql
              ? "⚠️ 수동 모드: UI 조건 무시, 작성된 JQL 그대로 실행됩니다."
              : "💡 자동 모드: 날짜·인원 선택이 바뀌면 JQL이 실시간 갱신됩니다."}
          </p>
        </div>

        {/* 키워드 + 실행 버튼 */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <input type="text" placeholder="포함 키워드 (쉼표 구분)" value={includeKeyword}
            onChange={e => setIncludeKeyword(e.target.value)}
            style={{ flex: 1, minWidth: "180px", padding: "0.55rem 0.75rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
          <input type="text" placeholder="제외 키워드 (쉼표 구분)" value={excludeKeyword}
            onChange={e => setExcludeKeyword(e.target.value)}
            style={{ flex: 1, minWidth: "180px", padding: "0.55rem 0.75rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white" }} />
          <button onClick={handleSearch} disabled={loading} className="btn btn-primary">
            📊 쿼리 실행
          </button>
          <button onClick={async () => {
            const type = prompt("자동 리포트 주기를 입력하세요 (daily 또는 monthly):", "daily");
            if (type !== "daily" && type !== "monthly") return;
            if (!confirm(`현재 참여자 필터 조건으로 '${type}' 자동 리포트를 등록하시겠습니까?\n(daily: 매일 전날 작업기록, monthly: 매월 말일 해당 월 작업기록)`)) return;

            let tData = [];
            if (targetMode === "group") tData = dbUsers.filter(u => selectedGroups.includes(u.part));
            else if (targetMode === "individual") tData = dbUsers.filter(u => selectedUsers.includes(u.id));
            else tData = [...dbUsers];

            try {
              const res = await fetch("/api/worklog-schedules", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  schedule_type: type,
                  target_mode: targetMode,
                  target_users: tData
                })
              });
              if (res.ok) alert("✅ 자동 리포트 생성이 등록되었습니다.");
              else alert("등록 실패");
            } catch (e) { alert("오류: " + e.message); }
          }} className="btn btn-success">
            ⏰ 스케줄 등록
          </button>
          <button onClick={handleExport} disabled={worklogs.length === 0} className="btn btn-secondary">
            📥 엑셀 저장
          </button>
        </div>
      </div>

      {/* ── 실행 결과 디버그 패널 ── */}
      {debugLog.length > 0 && (
        <div style={{ marginBottom: "1.5rem", background: "#050508", border: "1px solid #2a2a3a", borderRadius: "12px", overflow: "hidden" }}>
          <div
            onClick={() => setShowDebug(v => !v)}
            style={{ padding: "0.75rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: showDebug ? "1px solid #2a2a3a" : "none" }}>
            <span style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: "bold" }}>
              🐛 디버그 정보 — 이슈 {totalIssues}건 스캔 → 워크로그 {worklogs.length}건 수집
            </span>
            <span style={{ color: "#555", fontSize: "0.8rem" }}>{showDebug ? "▲ 접기" : "▼ 펼치기"}</span>
          </div>
          {showDebug && (
            <div style={{ padding: "1rem 1.25rem", overflowX: "auto" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#888", marginBottom: "0.75rem", background: "#0a0a12", padding: "0.75rem", borderRadius: "6px", border: "1px solid #2a2a3a", wordBreak: "break-all" }}>
                <strong style={{ color: "#60a5fa" }}>실행된 JQL:</strong><br />{usedJql}
              </div>
              <div style={{ maxHeight: "240px", overflowY: "auto" }}>
                {debugLog.map((line, i) => (
                  <div key={i} style={{ fontSize: "0.78rem", fontFamily: "monospace", color: line.startsWith("[오류]") ? "#f87171" : line.startsWith("[최종]") ? "#34d399" : "#666", padding: "1px 0" }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 분석 차트 ── */}
      {worklogs.length > 0 && (
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <h2>📊 분석 리포트 <span style={{ fontSize: "0.8rem", color: "#555", fontWeight: "normal" }}>(작업자 클릭 시 필터)</span></h2>
            <button onClick={() => setShowCharts(v => !v)} style={{ fontSize: "0.8rem", background: "transparent", border: "1px solid #333", color: "#888", padding: "0.2rem 0.8rem", borderRadius: "6px", cursor: "pointer" }}>
              {showCharts ? "숨기기" : "차트 보기"}
            </button>
          </div>
          {showCharts && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                {/* ── 월별 실적: 세로 막대 + 추이선 ── */}
                <div>
                  <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "1rem" }}>📅 월별 실적</h3>
                  {(() => {
                    const BAR_W = 44;
                    const GAP = 16;
                    const H = 200;
                    const PAD_L = 44;
                    const PAD_B = 36;
                    const PAD_T = 20;
                    const n = statsByMonth.length;
                    const W = PAD_L + n * BAR_W + (n - 1) * GAP + 24;
                    const maxVal = Math.max(...statsByMonth.map(x => parseFloat(x.value)), 1);
                    // 눈금선 개수
                    const gridLines = 4;

                    // 각 막대 x 중심
                    const barCx = (i) => PAD_L + i * (BAR_W + GAP) + BAR_W / 2;
                    const barH = (v) => ((v / maxVal) * (H - PAD_T - PAD_B));
                    const barY = (v) => H - PAD_B - barH(v);

                    // 추이선 포인트
                    const points = statsByMonth.map((s, i) =>
                      `${barCx(i)},${barY(parseFloat(s.value))}`
                    ).join(" ");

                    return (
                      <div style={{ width: "100%" }}>
                        <svg viewBox={`0 0 ${Math.max(W, 280)} ${H}`} width="100%" height={H} style={{ display: "block" }}>
                          {/* 눈금선 */}
                          {Array.from({ length: gridLines + 1 }, (_, gi) => {
                            const yVal = (maxVal / gridLines) * gi;
                            const yPos = H - PAD_B - (yVal / maxVal) * (H - PAD_T - PAD_B);
                            return (
                              <g key={gi}>
                                <line x1={PAD_L - 6} y1={yPos} x2={W} y2={yPos}
                                  stroke="#1e1e2e" strokeWidth="1" />
                                <text x={PAD_L - 8} y={yPos + 4} textAnchor="end"
                                  fontSize="10" fill="#555">
                                  {yVal.toFixed(2)}
                                </text>
                              </g>
                            );
                          })}

                          {/* Y축 라벨 */}
                          <text x={8} y={H / 2} textAnchor="middle" fontSize="10" fill="#555"
                            transform={`rotate(-90,8,${H / 2})`}>MM</text>

                          {/* 막대 */}
                          {statsByMonth.map((s, i) => {
                            const val = parseFloat(s.value);
                            const bh = barH(val);
                            const bx = PAD_L + i * (BAR_W + GAP);
                            const by = barY(val);
                            return (
                              <g key={s.label}>
                                {/* 막대 그라데이션 */}
                                <defs>
                                  <linearGradient id={`mg${i}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9" />
                                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.7" />
                                  </linearGradient>
                                </defs>
                                <rect x={bx} y={by} width={BAR_W} height={bh}
                                  fill={`url(#mg${i})`} rx="4" ry="4">
                                  <title>{s.label}: {val} MM ({s.hours}h)</title>
                                </rect>
                                {/* 막대 위 수치 */}
                                <text x={bx + BAR_W / 2} y={by - 4} textAnchor="middle"
                                  fontSize="10" fill="#60a5fa" fontWeight="bold">
                                  {val} MM
                                </text>
                                {/* X축 레이블 */}
                                <text x={bx + BAR_W / 2} y={H - PAD_B + 14} textAnchor="middle"
                                  fontSize="10" fill="#888">
                                  {s.label.substring(5)}월
                                </text>
                                <text x={bx + BAR_W / 2} y={H - PAD_B + 26} textAnchor="middle"
                                  fontSize="9" fill="#555">
                                  {s.label.substring(0, 4)}
                                </text>
                              </g>
                            );
                          })}

                          {/* 추이선 */}
                          {n >= 2 && (
                            <>
                              <defs>
                                <filter id="glow">
                                  <feGaussianBlur stdDeviation="2" result="blur" />
                                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                </filter>
                              </defs>
                              <polyline
                                points={points}
                                fill="none"
                                stroke="rgba(16,185,129,0.35)"
                                strokeWidth="2"
                                strokeDasharray="4 3"
                              />
                              <polyline
                                points={points}
                                fill="none"
                                stroke="#10b981"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                filter="url(#glow)"
                              />
                              {statsByMonth.map((s, i) => (
                                <circle key={s.label}
                                  cx={barCx(i)} cy={barY(parseFloat(s.value))} r="4"
                                  fill="#10b981" stroke="#0a0a12" strokeWidth="2" />
                              ))}
                            </>
                          )}
                        </svg>
                      </div>
                    );
                  })()}
                </div>

                {/* ── 작업자별 실적: 카드 그리드 ── */}
                <div>
                  <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "0.75rem" }}>
                    👤 작업자별 실적
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.75rem", color: "#555" }}>
                      (<span style={{ color: "#f97316" }}>●</span> 8h 미만)
                    </span>
                  </h3>
                  {(() => {
                    const maxVal = Math.max(...statsByUser.map(x => parseFloat(x.value)), 1);
                    const THRESHOLD = 8; // 8시간 기준
                    return (
                      <div style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.65rem",
                      }}>
                        {statsByUser.map(s => {
                          const val = parseFloat(s.value);
                          const active = filterAuthor === s.label;
                          const under = val < THRESHOLD;
                          const pct = (val / maxVal) * 100;

                          // 색상 팔레트
                          const barColor = under ? (val < 4 ? "#ef4444" : "#f97316") : "#10b981";
                          const glowColor = under ? (val < 4 ? "rgba(239,68,68,0.25)" : "rgba(249,115,22,0.25)") : "rgba(16,185,129,0.15)";
                          const textColor = under ? (val < 4 ? "#f87171" : "#fb923c") : "#34d399";
                          const borderClr = active
                            ? "var(--accent-color)"
                            : under
                              ? (val < 4 ? "rgba(239,68,68,0.5)" : "rgba(249,115,22,0.4)")
                              : "transparent";
                          const bgColor = active
                            ? "rgba(59,130,246,0.15)"
                            : under
                              ? (val < 4 ? "rgba(239,68,68,0.07)" : "rgba(249,115,22,0.07)")
                              : "rgba(255,255,255,0.03)";

                          return (
                            <div key={s.label}
                              onClick={() => setFilterAuthor(active ? null : s.label)}
                              title={`${s.label}: ${val}h${under ? " ⚠️ 8시간 미만" : ""}`}
                              style={{
                                cursor: "pointer",
                                flex: "1 1 140px", // 최소 140px, 공간 있으면 확장
                                maxWidth: "200px", // 너무 커지는 것 방지
                                padding: "0.65rem 0.75rem",
                                borderRadius: "10px",
                                border: `1px solid ${borderClr}`,
                                background: bgColor,
                                boxShadow: active ? `0 0 12px ${glowColor}` : under ? `0 0 8px ${glowColor}` : "none",
                                transition: "all 0.2s",
                              }}
                            >
                              {/* 이름 */}
                              <div style={{
                                fontSize: "0.78rem",
                                fontWeight: "bold",
                                color: active ? "white" : under ? textColor : "#ccc",
                                marginBottom: "0.35rem",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}>
                                {active ? "✅ " : under ? "⚠️ " : ""}{s.label}
                              </div>

                              {/* 시간 수치 */}
                              <div style={{
                                fontSize: "1.05rem",
                                fontWeight: "bold",
                                color: textColor,
                                marginBottom: "0.4rem",
                                lineHeight: 1,
                              }}>
                                {val}h
                              </div>

                              {/* 미니 바 */}
                              <div style={{ height: "4px", background: "#1a1a2e", borderRadius: "2px" }}>
                                <div style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  background: barColor,
                                  borderRadius: "2px",
                                  transition: "width 0.6s",
                                }} />
                              </div>

                              {/* 8h 기준 표시 */}
                              {under && (
                                <div style={{ fontSize: "0.68rem", color: textColor, marginTop: "0.3rem", opacity: 0.85 }}>
                                  {(THRESHOLD - val).toFixed(1)}h 부족
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginTop: "2rem" }}>
                {/* 프로젝트 코드별 */}
                <div>
                  <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "0.75rem" }}>🏷️ 프로젝트 코드별 실적</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {statsByProjectCode.map(s => {
                      const active = filterProjectCode === s.label;
                      return (
                        <div key={s.label}
                          onClick={() => setFilterProjectCode(active ? null : s.label)}
                          style={{
                            background: active ? "rgba(16, 185, 129, 0.15)" : "rgba(255,255,255,0.03)",
                            border: active ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.05)",
                            borderRadius: "8px", padding: "0.5rem 0.8rem", display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer",
                            boxShadow: active ? "0 0 8px rgba(16, 185, 129, 0.2)" : "none",
                            transition: "all 0.2s"
                          }}>
                          <span style={{ fontSize: "0.8rem", color: active ? "white" : "#ccc", fontWeight: active ? "bold" : "normal" }}>
                            {active ? "✅ " : ""}{s.label}
                          </span>
                          <span style={{ fontSize: "0.9rem", color: "#10b981", fontWeight: "bold" }}>{s.value}h</span>
                        </div>
                      )
                    })}
                    {statsByProjectCode.length === 0 && <div style={{ fontSize: "0.8rem", color: "#666" }}>데이터 없음</div>}
                  </div>
                </div>

                {/* 작업 유형별 */}
                <div>
                  <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "0.75rem" }}>🛠️ 작업 유형별 실적</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {statsByWorkType.map(s => {
                      const active = filterWorkType === s.label;
                      return (
                        <div key={s.label}
                          onClick={() => setFilterWorkType(active ? null : s.label)}
                          style={{
                            background: active ? "rgba(59, 130, 246, 0.15)" : "rgba(255,255,255,0.03)",
                            border: active ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.05)",
                            borderRadius: "8px", padding: "0.5rem 0.8rem", display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer",
                            boxShadow: active ? "0 0 8px rgba(59, 130, 246, 0.2)" : "none",
                            transition: "all 0.2s"
                          }}>
                          <span style={{ fontSize: "0.8rem", color: active ? "white" : "#ccc", fontWeight: active ? "bold" : "normal" }}>
                            {active ? "✅ " : ""}{s.label}
                          </span>
                          <span style={{ fontSize: "0.9rem", color: "#3b82f6", fontWeight: "bold" }}>{s.value}h</span>
                        </div>
                      )
                    })}
                    {statsByWorkType.length === 0 && <div style={{ fontSize: "0.8rem", color: "#666" }}>데이터 없음</div>}
                  </div>
                </div>
              </div>

              {/* ── 예상 시간 및 기한 초과 이슈 ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginTop: "2rem" }}>
                {/* 예상 시간 초과 */}
                <div>
                  <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "0.75rem" }}>⏳ 예상 시간 초과 이슈 <span style={{ fontSize: "0.75rem", color: "#f87171" }}>(누적시간 &gt; 예상시간)</span></h3>
                  <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", padding: "1rem", maxHeight: "250px", overflowY: "auto" }}>
                    {issueStatusAnalysis.overdueEstimate.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#e5e7eb", fontSize: "0.8rem" }}>
                        {issueStatusAnalysis.overdueEstimate.map((i, idx) => (
                          <li key={idx} style={{ marginBottom: "0.5rem" }}>
                            <a href={`${jiraHost}/browse/${i.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontWeight: "bold" }}>{i.issueKey}</a>
                            <span style={{ color: "#9ca3af", marginLeft: "0.3rem" }}>{i.issueSummary} ({i.author})</span>
                            <div style={{ color: "#f87171", fontSize: "0.75rem", marginTop: "0.2rem" }}>
                              예상: {i.originalEstimateStr} → 기록: {i.issueTimeSpentStr}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: "0.8rem", color: "#666", textAlign: "center", padding: "1rem" }}>예상 시간을 초과한 미완료 이슈가 없습니다.</div>
                    )}
                  </div>
                </div>

                {/* 기한 초과 */}
                <div>
                  <h3 style={{ fontSize: "0.9rem", color: "gray", marginBottom: "0.75rem" }}>🚨 기한 초과 이슈 <span style={{ fontSize: "0.75rem", color: "#f87171" }}>(기한 &lt; 오늘)</span></h3>
                  <div style={{ background: "rgba(249, 115, 22, 0.05)", border: "1px solid rgba(249, 115, 22, 0.2)", borderRadius: "8px", padding: "1rem", maxHeight: "250px", overflowY: "auto" }}>
                    {issueStatusAnalysis.overdueDeadline.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#e5e7eb", fontSize: "0.8rem" }}>
                        {issueStatusAnalysis.overdueDeadline.map((i, idx) => (
                          <li key={idx} style={{ marginBottom: "0.5rem" }}>
                            <a href={`${jiraHost}/browse/${i.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", fontWeight: "bold" }}>{i.issueKey}</a>
                            <span style={{ color: "#9ca3af", marginLeft: "0.3rem" }}>{i.issueSummary} ({i.author})</span>
                            <div style={{ color: "#fb923c", fontSize: "0.75rem", marginTop: "0.2rem" }}>
                              기한: {i.dueDate} (상태: {i.issueStatus})
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: "0.8rem", color: "#666", textAlign: "center", padding: "1rem" }}>기한이 초과된 미완료 이슈가 없습니다.</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 작업 내역 테이블 ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", marginBottom: "0.4rem" }}>📋 필터링된 작업 내역</h2>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ background: "rgba(59,130,246,0.15)", border: "1px solid var(--accent-color)", padding: "2px 10px", borderRadius: "14px", fontSize: "0.82rem", fontWeight: "bold", color: "var(--accent-color)" }}>
                총 {filteredWorklogs.length}건
              </span>
              <span style={{ background: "rgba(16,185,129,0.12)", border: "1px solid #10b981", padding: "2px 10px", borderRadius: "14px", fontSize: "0.82rem", fontWeight: "bold", color: "#10b981" }}>
                {filteredTotalHours}h
              </span>
              {(filterAuthor || filterProjectCode || filterWorkType) && (
                <span style={{ color: "#fbbf24", fontSize: "0.82rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  🔍 필터 적용됨: {[filterAuthor, filterProjectCode, filterWorkType].filter(Boolean).join(", ")}
                  <button onClick={() => { setFilterAuthor(null); setFilterProjectCode(null); setFilterWorkType(null); }} style={{ marginLeft: "0.4rem", background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline" }}>해제</button>
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowColumnConfig(v => !v)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #333", color: "#aaa", padding: "0.35rem 0.9rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.82rem" }}>
            🛠️ 열 설정
          </button>
        </div>

        {showColumnConfig && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", padding: "0.75rem", background: "#050508", borderRadius: "8px", border: "1px dashed #333" }}>
            {AVAILABLE_COLUMNS.map(c => (
              <label key={c.id} style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
                <input type="checkbox" checked={visibleColumns.includes(c.id)} onChange={() => toggleColumn(c.id)} /> {c.label}
              </label>
            ))}
          </div>
        )}

        {filteredWorklogs.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {AVAILABLE_COLUMNS.filter(c => visibleColumns.includes(c.id)).map(c => <th key={c.id}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {filteredWorklogs.map(w => (
                  <tr key={`${w.id}-${w.issueKey}`}>
                    {visibleColumns.includes("started") && <td style={{ whiteSpace: "nowrap" }}>{new Date(w.started).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</td>}
                    {visibleColumns.includes("issueKey") && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {jiraHost ? (
                          <a href={`${jiraHost}/browse/${w.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color)", fontWeight: "bold" }}>
                            {w.issueKey}
                          </a>
                        ) : w.issueKey}
                      </td>
                    )}
                    {visibleColumns.includes("issueType") && <td>{w.issueType}</td>}
                    {visibleColumns.includes("issueSummary") && <td style={{ fontSize: "0.8rem" }}>{w.issueSummary}</td>}
                    {visibleColumns.includes("issueStatus") && <td>{w.issueStatus}</td>}
                    {visibleColumns.includes("issueStartDate") && <td>{w.issueStartDate}</td>}
                    {visibleColumns.includes("dueDate") && <td>{w.dueDate}</td>}
                    {visibleColumns.includes("originalEstimate") && <td>{w.originalEstimate}</td>}
                    {visibleColumns.includes("remainingEstimate") && <td>{w.remainingEstimate}</td>}
                    {visibleColumns.includes("issueTimeSpent") && <td>{w.issueTimeSpent}</td>}
                    {visibleColumns.includes("author") && <td style={{ fontWeight: "bold" }}>{w.author}</td>}
                    {visibleColumns.includes("timeSpent") && <td style={{ color: "#10b981", whiteSpace: "nowrap", fontWeight: "bold" }}>
                      {w.timeSpent}
                      {w.timeSpentRaw && w.timeSpentRaw !== w.timeSpent && (
                        <span style={{ color: "#555", fontSize: "0.75rem", marginLeft: "0.3rem" }}>({w.timeSpentRaw})</span>
                      )}
                    </td>}
                    {visibleColumns.includes("comment") && (
                      <td style={{ fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>
                        {renderComment(w.comment)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "4rem 0", textAlign: "center", color: "#444" }}>
            {loading ? "" : "조건에 부합하는 워크로그가 없습니다."}
          </div>
        )}
      </div>
    </div>
  );
}
