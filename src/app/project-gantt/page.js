"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { getJiraAuthHeaders } from "@/lib/jiraAuthClient";

// 2026 한국 주요 공휴일 (월-일 형태)
const KOR_HOLIDAYS = [
  "01-01", "02-16", "02-17", "02-18", "03-01", "05-05", "05-24", "06-06",
  "08-15", "09-24", "09-25", "09-26", "10-03", "10-09", "12-25"
];

const KOR_HOLIDAYS_2025 = [
  "01-01", "01-28", "01-29", "01-30", "03-01", "03-03", "05-05", "05-06", "06-06",
  "08-15", "10-03", "10-06", "10-09", "12-25"
];

// Helper to check if a date string is holiday
const isHolidayStr = (dateStr) => {
  const mmdd = dateStr.substring(5, 10);
  const yyyy = dateStr.substring(0, 4);
  if (yyyy === "2026") return KOR_HOLIDAYS.includes(mmdd);
  if (yyyy === "2025") return KOR_HOLIDAYS_2025.includes(mmdd);
  return KOR_HOLIDAYS.includes(mmdd); // fallback
};

const styles = {
  container: { display: "flex", flexDirection: "column", height: "100%", padding: "1rem" },
  headerControls: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" },
  selectBox: { padding: "0.6rem", borderRadius: "8px", background: "#111", border: "1px solid #333", color: "white", minWidth: "250px" },
  viewSwitcher: { display: "flex", gap: "0.5rem" },
  viewBtn: (active) => ({ padding: "0.5rem 1rem", borderRadius: "8px", border: active ? "1px solid var(--accent-color)" : "1px solid #333", background: active ? "var(--accent-color)" : "#111", color: "white", cursor: "pointer" }),
  ganttWrapper: { flex: 1, overflow: "auto", background: "#0a0a12", borderRadius: "12px", border: "1px solid #222", position: "relative" },
  gridContainer: { display: "flex", minWidth: "max-content" },
  yAxis: { position: "sticky", left: 0, minWidth: "400px", maxWidth: "400px", borderRight: "1px solid #333", background: "#111", zIndex: 10, display: "flex", flexDirection: "column" },
  yAxisHeader: { height: "60px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", fontWeight: "bold", color: "#ccc", position: "sticky", top: 0, background: "#111", zIndex: 12 },
  issueRow: { height: "50px", borderBottom: "1px solid #222", display: "flex", alignItems: "center", background: "#111" },
  xAxisContainer: { flex: 1, display: "flex", flexDirection: "column" },
  xHeaderRow: { display: "flex", height: "60px", borderBottom: "1px solid #333", position: "sticky", top: 0, background: "#111", zIndex: 5 },
  xHeaderCellDay: (isOff, isToday) => ({ minWidth: "40px", flex: "0 0 40px", borderRight: "1px solid #222", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", background: isToday ? "rgba(234, 179, 8, 0.15)" : (isOff ? "rgba(239, 68, 68, 0.05)" : "transparent"), color: isToday ? "#eab308" : (isOff ? "#ef4444" : "#888"), fontWeight: isToday ? "bold" : "normal" }),
  xHeaderCellWeek: (isToday) => ({ minWidth: "120px", flex: "0 0 120px", borderRight: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", background: isToday ? "rgba(234, 179, 8, 0.15)" : "transparent", color: isToday ? "#eab308" : "#ccc", fontWeight: isToday ? "bold" : "normal" }),
  xHeaderCellMonth: (isToday) => ({ minWidth: "150px", flex: "0 0 150px", borderRight: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", background: isToday ? "rgba(234, 179, 8, 0.15)" : "transparent", color: isToday ? "#eab308" : "#ccc", fontWeight: "bold" }),
  chartRow: { display: "flex", height: "50px", borderBottom: "1px solid #222", position: "relative" },
  cellDay: (isOff, isToday) => ({ minWidth: "40px", flex: "0 0 40px", borderRight: "1px solid #222", background: isToday ? "rgba(234, 179, 8, 0.05)" : (isOff ? "rgba(239, 68, 68, 0.03)" : "transparent") }),
  cellWeek: (isToday) => ({ minWidth: "120px", flex: "0 0 120px", borderRight: "1px solid #222", background: isToday ? "rgba(234, 179, 8, 0.05)" : "transparent" }),
  cellMonth: (isToday) => ({ minWidth: "150px", flex: "0 0 150px", borderRight: "1px solid #222", background: isToday ? "rgba(234, 179, 8, 0.05)" : "transparent" }),
  ganttBar: (isResolved, isOverdue) => ({ position: "absolute", top: "10px", height: "30px", borderRadius: "15px", background: isResolved ? "#444" : (isOverdue ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.3)"), border: isResolved ? "1px solid #555" : (isOverdue ? "1px solid #ef4444" : "1px solid #3b82f6"), display: "flex", alignItems: "center", padding: "0 10px", color: isResolved ? "#aaa" : (isOverdue ? "#fca5a5" : "white"), fontSize: "0.75rem", overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer", transition: "0.2s", zIndex: 1 }),
  timeBadge: (isResolved, isOverEstimate) => ({ background: isResolved ? "rgba(255,255,255,0.1)" : (isOverEstimate ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"), color: isResolved ? "#888" : (isOverEstimate ? "#fca5a5" : "#34d399"), border: isResolved ? "1px solid #555" : (isOverEstimate ? "1px solid #ef4444" : "1px solid #10b981"), padding: "2px 6px", borderRadius: "10px", fontWeight: "bold", marginLeft: "auto", fontSize: "0.7rem", whiteSpace: "nowrap" })
};

export default function ProjectGantt() {
  // ... [React component code remains largely the same, I will use a separate replacement for the JSX]
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [viewMode, setViewMode] = useState("week"); // day, week, month
  const [loading, setLoading] = useState(false);
  const [issuesData, setIssuesData] = useState([]); // Array of issue objects
  const [timeline, setTimeline] = useState([]); // Array of time units
  const [selectedIssueWorklogs, setSelectedIssueWorklogs] = useState(null);
  const [selectedAuthor, setSelectedAuthor] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const ganttWrapperRef = useRef(null);

  // Auto-scroll to "today" when timeline renders
  useEffect(() => {
    if (ganttWrapperRef.current && timeline.length > 0 && !loading) {
      setTimeout(() => {
        const todayCell = ganttWrapperRef.current.querySelector('.gantt-today-col');
        if (todayCell) {
          const wrapper = ganttWrapperRef.current;
          wrapper.scrollTo({
            left: todayCell.offsetLeft - wrapper.clientWidth / 2 + todayCell.clientWidth / 2,
            behavior: "smooth"
          });
        }
      }, 100);
    }
  }, [timeline, loading, viewMode]);

  // Fetch Projects List
  useEffect(() => {
    fetch("/api/standards/projects")
      .then(r => r.json())
      .then(d => {
        const projs = d.projects || [];
        setProjects(projs);
        if (projs.length > 0) {
          const lastProj = localStorage.getItem("gantt_last_selected_project");
          if (lastProj && projs.find(p => p.code === lastProj)) {
            setSelectedProject(lastProj);
          } else {
            setSelectedProject(projs[0].code);
          }
        }
      });

    const savedViewMode = localStorage.getItem("gantt_view_mode");
    if (savedViewMode) {
      setViewMode(savedViewMode);
    }
  }, []);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem("gantt_view_mode", mode);
  };

  // Fetch Worklogs and Issues when Project or View changes
  useEffect(() => {
    if (!selectedProject) return;
    loadProjectData();
  }, [selectedProject, viewMode]);

  const CACHE_TTL = 60 * 60 * 1000; // 1 시간

  const loadProjectData = async () => {
    setLoading(true);
    try {
      const proj = projects.find(p => p.code === selectedProject);
      if (!proj) return;

      const start = proj.start_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
      const end = proj.end_date || new Date().toISOString().split("T")[0];

      // Generate Timeline X-Axis based on viewMode
      const tl = generateTimeline(start, end, viewMode);
      setTimeline(tl);

      // Fetch Worklogs using JQL filtering by project code
      // We search for worklogComment containing the project code OR issue project matching if applicable
      // To be safe, we just use the date range and targetType: all
      const todayStr = new Date().toISOString().split("T")[0];
      const queryEnd = end > todayStr ? todayStr : end;

      if (start > queryEnd) {
        setIssuesData([]);
        setLoading(false);
        return;
      }

      // Jira JQL에서 worklogComment ~ "..." 가 일부 버전에서 에러를 유발할 수 있습니다.
      // 텍스트 전체 검색(text ~)으로 프로젝트 코드가 포함된 이슈를 빠르게 찾도록 변경합니다.
      const projCodes = proj.code.split(",").map(c => c.trim()).filter(Boolean);
      const textJql = projCodes.map(code => `text ~ "${code}"`).join(" OR ");
      const jql = textJql ? `updated >= "${start}" AND (${textJql})` : `updated >= "${start}"`;

      // 1시간 세션 캐시 확인 (Jira API 호출 최소화)
      const cacheKey = `gantt_cache_v2_${proj.code}`;
      const cachedStr = sessionStorage.getItem(cacheKey);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          console.log("Using cached worklog data for", proj.code);
          setIssuesData(cached.issuesData);
          setLoading(false);
          return;
        }
      }

      const res = await fetch("/api/worklogs", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getJiraAuthHeaders() },
        body: JSON.stringify({
          startDate: start,
          endDate: queryEnd,
          overrideJql: jql,
        })
      });
      const data = await res.json();

      if (data.error) {
        console.error("API Error:", data.error, data.debugLog);
        alert("이슈 조회 중 오류가 발생했습니다: " + data.error);
        setIssuesData([]);
        setLoading(false);
        return;
      }

      const logs = data.worklogs || [];

      // Process logs into Unique Issues
      const issueMap = {};
      const todayStrForOverdue = new Date().toISOString().split("T")[0];
      const isResolvedCheck = (status) => ["resolved", "closed", "done", "완료", "해결됨"].includes((status || "").toLowerCase());

      logs.forEach(log => {
        // 서버에서 파싱해 준 프로젝트 코드와 계약 과제(proj.code) 목록 대조
        const logProjCode = (log.projectCode || "").trim().toLowerCase();
        const projCodes = proj.code.split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
        if (!logProjCode || !projCodes.includes(logProjCode)) return;

        const comment = log.comment || "";

        if (!issueMap[log.issueKey]) {
          const actualDueDate = log.dueDate && log.dueDate !== "-" ? log.dueDate : null;
          issueMap[log.issueKey] = {
            key: log.issueKey,
            summary: log.issueSummary,
            status: log.issueStatus,
            assignee: log.assignee,
            isResolved: isResolvedCheck(log.issueStatus),
            actualDueDate,
            startDate: log.issueStartDate && log.issueStartDate !== "-" ? log.issueStartDate : start,
            dueDate: actualDueDate || log.started.split("T")[0],
            totalSeconds: 0,
            estimateSeconds: log.originalEstimateSeconds || 0,
            worklogs: [],
            link: data.jiraHost ? `${data.jiraHost}/browse/${log.issueKey}` : ""
          };
        }
        issueMap[log.issueKey].totalSeconds += (log.timeSpentSeconds || 0);
        issueMap[log.issueKey].worklogs.push({
          id: log.id,
          author: log.author || log.authorUsername,
          date: log.started.split("T")[0],
          comment: comment,
          timeSpent: log.timeSpent || (log.timeSpentSeconds / 3600).toFixed(1) + "h"
        });

        // Expand due date if logs are after due date
        const logDate = log.started.split("T")[0];
        if (logDate > issueMap[log.issueKey].dueDate) {
          issueMap[log.issueKey].dueDate = logDate;
        }
        if (logDate < issueMap[log.issueKey].startDate) {
          issueMap[log.issueKey].startDate = logDate;
        }
      });

      const getIssueNum = (key) => parseInt((key.match(/\d+/) || [0])[0], 10) || 0;

      const processedIssues = Object.values(issueMap).map(i => {
        const totalHoursNum = i.totalSeconds / 3600;
        const estimateHoursNum = i.estimateSeconds / 3600;
        const totalHours = totalHoursNum.toFixed(1);
        const estimateHours = estimateHoursNum > 0 ? estimateHoursNum.toFixed(1) : "-";
        return {
          ...i,
          totalHours,
          estimateHours,
          isOverEstimate: estimateHoursNum > 0 && totalHoursNum > estimateHoursNum,
          isOverdue: !i.isResolved && i.actualDueDate && i.actualDueDate < todayStrForOverdue
        };
      }).sort((a, b) => {
        if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
        return getIssueNum(a.key) - getIssueNum(b.key);
      });

      setIssuesData(processedIssues);

      // 캐시 저장
      sessionStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        issuesData: processedIssues
      }));

    } catch (e) {
      console.error("데이터 로드 실패:", e);
    } finally {
      setLoading(false);
    }
  };

  const generateTimeline = (start, end, mode) => {
    const sDate = new Date(start);
    const eDate = new Date(end);
    const result = [];
    const todayStr = new Date().toISOString().split("T")[0];

    if (mode === "day") {
      let curr = new Date(sDate);
      while (curr <= eDate) {
        const dStr = curr.toISOString().split("T")[0];
        const dayOfWeek = curr.getDay();
        const isOff = dayOfWeek === 0 || dayOfWeek === 6 || isHolidayStr(dStr);
        result.push({ id: dStr, label: curr.getDate(), subLabel: ["일", "월", "화", "수", "목", "금", "토"][dayOfWeek], isOff, isToday: dStr === todayStr, start: dStr, end: dStr });
        curr.setDate(curr.getDate() + 1);
      }
    } else if (mode === "week") {
      // Find Monday of start date
      let curr = new Date(sDate);
      curr.setDate(curr.getDate() - (curr.getDay() === 0 ? 6 : curr.getDay() - 1));

      while (curr <= eDate) {
        const weekStart = curr.toISOString().split("T")[0];
        const weekEndObj = new Date(curr);
        weekEndObj.setDate(weekEndObj.getDate() + 6);
        const weekEnd = weekEndObj.toISOString().split("T")[0];

        result.push({ id: weekStart, label: `${curr.getMonth() + 1}월 ${Math.ceil(curr.getDate() / 7)}주차`, subLabel: `${weekStart.substring(5)} ~ ${weekEnd.substring(5)}`, isToday: todayStr >= weekStart && todayStr <= weekEnd, start: weekStart, end: weekEnd });
        curr.setDate(curr.getDate() + 7);
      }
    } else if (mode === "month") {
      let curr = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
      while (curr <= eDate) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, "0");
        const monthStart = `${y}-${m}-01`;
        const lastDay = new Date(y, curr.getMonth() + 1, 0);
        const monthEnd = lastDay.toISOString().split("T")[0];

        result.push({ id: monthStart, label: `${y}년 ${m}월`, subLabel: "", isToday: todayStr >= monthStart && todayStr <= monthEnd, start: monthStart, end: monthEnd });
        curr.setMonth(curr.getMonth() + 1);
      }
    }
    return result;
  };

  // Calculate Bar Position and Width based on Timeline
  const getBarStyles = (issueStart, issueEnd) => {
    if (timeline.length === 0) return { display: "none" };

    const timelineStart = new Date(timeline[0].start);
    const timelineEnd = new Date(timeline[timeline.length - 1].end);

    let start = new Date(issueStart);
    let end = new Date(issueEnd);

    if (end < timelineStart || start > timelineEnd) return { display: "none" };

    if (start < timelineStart) start = timelineStart;
    if (end > timelineEnd) end = timelineEnd;

    // Unit width depends on mode
    const unitWidth = viewMode === "day" ? 40 : (viewMode === "week" ? 120 : 150);
    const msPerUnit = viewMode === "day" ? 86400000 : (viewMode === "week" ? 86400000 * 7 : -1);
    // for month it's variable, need index calculation

    let startIndex = 0;
    let widthUnits = 0;

    if (viewMode === "month") {
      startIndex = timeline.findIndex(t => start.toISOString().split("T")[0].startsWith(t.id.substring(0, 7)));
      const endIndex = timeline.findIndex(t => end.toISOString().split("T")[0].startsWith(t.id.substring(0, 7)));
      if (startIndex !== -1 && endIndex !== -1) {
        widthUnits = (endIndex - startIndex) + 1;
      }
    } else {
      // Find exact or closest index
      startIndex = timeline.findIndex(t => t.start <= issueStart && t.end >= issueStart);
      if (startIndex === -1) startIndex = 0; // fallback if start is before timeline

      const endIndex = timeline.findIndex(t => t.start <= issueEnd && t.end >= issueEnd);

      if (startIndex !== -1 && endIndex !== -1) {
        widthUnits = (endIndex - startIndex) + 1;
      }
    }

    if (startIndex === -1 || widthUnits <= 0) return { display: "none" };

    return {
      left: `${startIndex * unitWidth + 5}px`,
      width: `${widthUnits * unitWidth - 10}px`,
    };
  };

  const projectAuthors = useMemo(() => {
    const authors = new Set();
    issuesData.forEach(issue => {
      issue.worklogs.forEach(wl => {
        if (wl.author) authors.add(wl.author);
      });
    });
    return Array.from(authors).sort();
  }, [issuesData]);

  const authorFilteredIssuesData = useMemo(() => {
    if (selectedAuthor === "all") return issuesData;
    return issuesData.filter(issue => issue.worklogs.some(wl => wl.author === selectedAuthor));
  }, [issuesData, selectedAuthor]);

  const filteredIssuesData = useMemo(() => {
    if (selectedStatus === "all") return authorFilteredIssuesData;
    if (selectedStatus === "active") return authorFilteredIssuesData.filter(i => !i.isResolved && !i.isOverdue);
    if (selectedStatus === "resolved") return authorFilteredIssuesData.filter(i => i.isResolved);
    if (selectedStatus === "overdue") return authorFilteredIssuesData.filter(i => i.isOverdue);
    if (selectedStatus === "no-estimate") return authorFilteredIssuesData.filter(i => i.estimateSeconds === 0);
    return authorFilteredIssuesData;
  }, [authorFilteredIssuesData, selectedStatus]);

  const totalProjectHours = authorFilteredIssuesData.reduce((acc, i) => acc + parseFloat(i.totalHours || 0), 0);
  const totalProjectMM = (totalProjectHours / 160).toFixed(2);
  const activeIssues = authorFilteredIssuesData.filter(i => !i.isResolved && !i.isOverdue).length;
  const resolvedIssues = authorFilteredIssuesData.filter(i => i.isResolved).length;
  const attentionIssues = authorFilteredIssuesData.filter(i => i.isOverdue).length;
  const noEstimateIssues = authorFilteredIssuesData.filter(i => i.estimateSeconds === 0).length;

  const toggleStatusFilter = (status) => {
    setSelectedStatus(prev => prev === status ? "all" : status);
  };

  const handleProjectSelect = (e) => {
    const code = e.target.value;
    setSelectedProject(code);
    localStorage.setItem("gantt_last_selected_project", code);
  };

  const todayStrForGrouping = new Date().toISOString().split("T")[0];
  const ongoingProjects = projects.filter(p => !p.end_date || p.end_date >= todayStrForGrouping);
  const completedProjects = projects.filter(p => p.end_date && p.end_date < todayStrForGrouping);

  return (
    <div style={styles.container}>
      <div style={styles.headerControls}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.2rem", display: "flex", alignItems: "center" }}>
            프로젝트 간트 차트
            {authorFilteredIssuesData.length > 0 && (
              <span style={{ fontSize: "0.9rem", color: "var(--accent-color)", marginLeft: "1rem", background: "rgba(59,130,246,0.1)", padding: "0.2rem 0.6rem", borderRadius: "8px", border: "1px solid rgba(59,130,246,0.3)" }}>
                총 누적: {totalProjectHours.toFixed(1)}h ({totalProjectMM} MM)
              </span>
            )}
          </h1>
          <p style={{ color: "#888", fontSize: "0.9rem" }}>선택한 계약 과제의 전체 기간 이슈별 워크로그 진행 현황</p>
          {authorFilteredIssuesData.length > 0 && (
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.8rem", userSelect: "none", flexWrap: "wrap" }}>
              <span
                onClick={() => toggleStatusFilter("active")}
                style={{ cursor: "pointer", fontSize: "0.85rem", background: selectedStatus === "active" ? "rgba(59,130,246,0.3)" : "rgba(59,130,246,0.1)", color: "#60a5fa", padding: "0.3rem 0.6rem", borderRadius: "6px", border: selectedStatus === "active" ? "1px solid #60a5fa" : "1px solid rgba(59,130,246,0.3)", transition: "0.2s" }}
              >
                활성화: {activeIssues}건
              </span>
              <span
                onClick={() => toggleStatusFilter("resolved")}
                style={{ cursor: "pointer", fontSize: "0.85rem", background: selectedStatus === "resolved" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)", color: "#aaa", padding: "0.3rem 0.6rem", borderRadius: "6px", border: selectedStatus === "resolved" ? "1px solid #aaa" : "1px solid #444", transition: "0.2s" }}
              >
                완료: {resolvedIssues}건
              </span>
              <span
                onClick={() => toggleStatusFilter("overdue")}
                style={{ cursor: "pointer", fontSize: "0.85rem", background: selectedStatus === "overdue" ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.1)", color: "#f87171", padding: "0.3rem 0.6rem", borderRadius: "6px", border: selectedStatus === "overdue" ? "1px solid #f87171" : "1px solid rgba(239,68,68,0.3)", transition: "0.2s" }}
              >
                due-date 지남: {attentionIssues}건
              </span>
              <span
                onClick={() => toggleStatusFilter("no-estimate")}
                style={{ cursor: "pointer", fontSize: "0.85rem", background: selectedStatus === "no-estimate" ? "rgba(234,179,8,0.3)" : "rgba(234,179,8,0.1)", color: "#eab308", padding: "0.3rem 0.6rem", borderRadius: "6px", border: selectedStatus === "no-estimate" ? "1px solid #eab308" : "1px solid rgba(234,179,8,0.3)", transition: "0.2s" }}
              >
                예상시간 미기입: {noEstimateIssues}건
              </span>
              {selectedStatus !== "all" && (
                <span
                  onClick={() => setSelectedStatus("all")}
                  style={{ cursor: "pointer", fontSize: "0.85rem", color: "#ccc", padding: "0.3rem 0.6rem", textDecoration: "underline" }}
                >
                  필터 해제
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <select value={selectedProject} onChange={handleProjectSelect} style={styles.selectBox}>
            <option value="" disabled>계약 과제를 선택하세요</option>
            {ongoingProjects.length > 0 && (
              <optgroup label="▶ 진행 중인 과제" style={{ background: "#222", color: "#60a5fa" }}>
                {ongoingProjects.map(p => <option key={p.code} value={p.code} style={{ color: "white" }}>[{p.code}] {p.name}</option>)}
              </optgroup>
            )}
            {completedProjects.length > 0 && (
              <optgroup label="✓ 완료된 과제" style={{ background: "#111", color: "#888" }}>
                {completedProjects.map(p => <option key={p.code} value={p.code} style={{ color: "#aaa" }}>[{p.code}] {p.name}</option>)}
              </optgroup>
            )}
          </select>

          {projectAuthors.length > 0 && (
            <select value={selectedAuthor} onChange={e => setSelectedAuthor(e.target.value)} style={{ ...styles.selectBox, minWidth: "150px" }}>
              <option value="all">모든 작업자 (전체)</option>
              {projectAuthors.map(author => <option key={author} value={author}>{author}</option>)}
            </select>
          )}

          <div style={styles.viewSwitcher}>
            <button style={styles.viewBtn(viewMode === "day")} onClick={() => handleViewModeChange("day")}>일별</button>
            <button style={styles.viewBtn(viewMode === "week")} onClick={() => handleViewModeChange("week")}>주별</button>
            <button style={styles.viewBtn(viewMode === "month")} onClick={() => handleViewModeChange("month")}>월별</button>
          </div>
        </div>
      </div>

      <div style={styles.ganttWrapper} ref={ganttWrapperRef}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(2px)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: "bold", color: "var(--accent-color)" }}>
            <span style={{ background: "#111", padding: "1rem 2rem", borderRadius: "12px", border: "1px solid #333", boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
              ⏳ 백그라운드 데이터 수집 중...
            </span>
          </div>
        )}

        <div style={styles.gridContainer}>
          {/* Y Axis: Issues */}
          <div style={styles.yAxis}>
            <div style={styles.yAxisHeader}>
              <div style={{ flex: 1, padding: "0 1rem", alignItems: "center", justifyContent: "center" }}>이슈 목록 (다중 사용자 병합)</div>
              <div style={{ width: "90px", padding: "0 0.5rem", borderLeft: "1px solid #333", textAlign: "left", height: "100%", display: "flex", alignItems: "center" }}>담당자</div>
            </div>
            <div>
              {filteredIssuesData.length === 0 && !loading && (
                <div style={{ padding: "2rem 1rem", color: "#666", textAlign: "center" }}>기록된 이슈가 없습니다.</div>
              )}
              {filteredIssuesData.map(issue => (
                <div key={issue.key} style={{ ...styles.issueRow, opacity: issue.isResolved ? 0.5 : 1 }}>
                  <div style={{ flex: 1, padding: "0 1rem", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden", minWidth: 0 }}>
                    <div style={{ fontSize: "0.8rem", color: issue.isResolved ? "#888" : "var(--accent-color)", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <a href={issue.link} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{issue.key} 🔗</a>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: issue.isResolved ? "#888" : "white", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={issue.summary}>
                      {issue.isOverdue && <span style={{ marginRight: "4px" }}>⚠️</span>}
                      {issue.summary}
                    </div>
                  </div>
                  <div style={{ width: "90px", padding: "0 0.5rem", borderLeft: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "flex-start", height: "100%", overflow: "hidden" }}>
                    <span style={{ fontSize: "0.8rem", color: "#aaa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }} title={issue.assignee || "Unassigned"}>
                      {issue.assignee || "Unassigned"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* X Axis: Timeline and Bars */}
          <div style={styles.xAxisContainer}>
            <div style={styles.xHeaderRow}>
              {timeline.map(t => {
                const todayClass = t.isToday ? "gantt-today-col" : "";
                if (viewMode === "day") return <div key={t.id} className={todayClass} style={styles.xHeaderCellDay(t.isOff, t.isToday)}><span>{t.label}</span><span>{t.subLabel}</span></div>;
                if (viewMode === "week") return <div key={t.id} className={todayClass} style={styles.xHeaderCellWeek(t.isToday)}><span>{t.label}</span></div>;
                return <div key={t.id} className={todayClass} style={styles.xHeaderCellMonth(t.isToday)}><span>{t.label}</span></div>;
              })}
            </div>

            <div>
              {filteredIssuesData.map(issue => (
                <div key={issue.key} style={styles.chartRow}>
                  {/* Background Grid Cells */}
                  {timeline.map(t => {
                    if (viewMode === "day") return <div key={t.id} style={styles.cellDay(t.isOff, t.isToday)} />;
                    if (viewMode === "week") return <div key={t.id} style={styles.cellWeek(t.isToday)} />;
                    return <div key={t.id} style={styles.cellMonth(t.isToday)} />;
                  })}

                  {/* Gantt Bar */}
                  <div
                    onClick={() => setSelectedIssueWorklogs(issue)}
                    style={{
                      ...styles.ganttBar(issue.isResolved, issue.isOverdue),
                      ...getBarStyles(issue.startDate, issue.dueDate)
                    }}
                    title={`[${issue.key}] ${issue.summary}\n상태: ${issue.status}\n시작: ${issue.startDate} ~ 완료(예정): ${issue.actualDueDate || "미정"}\n누적 공수: ${issue.totalHours}h`}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {issue.isOverdue && "⚠️ "}
                      {issue.summary}
                    </span>
                    <span style={styles.timeBadge(issue.isResolved, issue.isOverEstimate)}>
                      {issue.totalHours}h {issue.estimateHours !== "-" ? `/ ${issue.estimateHours}h` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Worklogs Modal Popup */}
      {selectedIssueWorklogs && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSelectedIssueWorklogs(null)}>
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: "12px", width: "50vw", minWidth: "600px", maxWidth: "1200px", maxHeight: "80vh", display: "flex", flexDirection: "column", padding: "1.5rem", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>
                <a href={selectedIssueWorklogs.link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-color)", textDecoration: "none", marginRight: "10px", fontWeight: "bold" }}>{selectedIssueWorklogs.key} 🔗</a>
                워크로그 내역
              </span>
              <span style={{ fontSize: "0.9rem", color: selectedIssueWorklogs.isOverEstimate ? "#fca5a5" : "var(--accent-color)", background: selectedIssueWorklogs.isOverEstimate ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.1)", padding: "0.3rem 0.6rem", borderRadius: "8px", border: selectedIssueWorklogs.isOverEstimate ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(59,130,246,0.3)" }}>
                누적: {selectedIssueWorklogs.totalHours}h / 예상: {selectedIssueWorklogs.estimateHours !== "-" ? `${selectedIssueWorklogs.estimateHours}h` : "미정"}
              </span>
            </h2>
            <p style={{ color: "#eee", fontSize: "1rem", marginBottom: "1rem", fontWeight: "bold" }}>{selectedIssueWorklogs.summary}</p>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem", borderBottom: "1px solid #333", paddingBottom: "1rem", fontSize: "0.85rem", color: "#aaa" }}>
              <span style={{ background: "#222", padding: "4px 8px", borderRadius: "6px", border: "1px solid #444" }}>상태: <strong style={{ color: "white" }}>{selectedIssueWorklogs.status}</strong></span>
              <span style={{ background: "#222", padding: "4px 8px", borderRadius: "6px", border: "1px solid #444" }}>시작일: <strong style={{ color: "white" }}>{selectedIssueWorklogs.startDate}</strong></span>
              <span style={{ background: "#222", padding: "4px 8px", borderRadius: "6px", border: "1px solid #444" }}>완료(예정)일: <strong style={{ color: selectedIssueWorklogs.isOverdue ? "#f87171" : "white" }}>{selectedIssueWorklogs.actualDueDate || "미정"}</strong></span>
            </div>

            <div style={{ overflowY: "auto", flex: 1, paddingRight: "10px" }}>
              {(selectedIssueWorklogs.worklogs || []).map(wl => (
                <div key={wl.id} style={{ background: "#222", padding: "1rem", borderRadius: "8px", marginBottom: "0.5rem", borderLeft: "3px solid var(--accent-color)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.8rem", color: "#888" }}>{wl.date}</span>
                    <span style={{ fontWeight: "bold", color: "#34d399", fontSize: "0.8rem", background: "rgba(16,185,129,0.1)", padding: "2px 6px", borderRadius: "4px" }}>{wl.timeSpent}</span>
                  </div>
                  <div style={{ color: "white", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{wl.comment}</div>
                  <div style={{ marginTop: "0.5rem", textAlign: "right", fontSize: "0.75rem", color: "#888" }}>작성자: {wl.author}</div>
                </div>
              ))}
              {(!selectedIssueWorklogs.worklogs || selectedIssueWorklogs.worklogs.length === 0) && <div style={{ color: "#666", textAlign: "center", padding: "2rem" }}>워크로그 내역이 없습니다. (새로고침을 통해 데이터를 최신화해 주세요.)</div>}
            </div>

            <div style={{ textAlign: "right", marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #333" }}>
              <button onClick={() => setSelectedIssueWorklogs(null)} style={{ background: "#333", color: "white", border: "none", padding: "0.6rem 1.2rem", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
