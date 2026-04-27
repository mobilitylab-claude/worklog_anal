import { NextResponse } from 'next/server';
import db from '@/lib/db';

const isLastDayOfMonth = (date) => {
  const d = new Date(date);
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate() + 1);
  return nextDay.getDate() === 1;
};

const formatDate = (date) => date.toISOString().split("T")[0];

export async function GET(request) {
  try {
    // 1. 모든 스케줄된 리포트 설정 가져오기
    const schedules = db.prepare(`
      SELECT s.*, p.code as project_code, p.start_date, p.end_date 
      FROM scheduled_reports s
      JOIN projects p ON s.project_id = p.id
    `).all();

    const todayObj = new Date();
    // 로컬 시간 기준으로 날짜 셋팅 (서버의 로컬 타임존)
    // 9시간 더해서 KST로 맞춰서 yyyy-mm-dd 추출하는 방법도 있지만
    // 크론은 시스템 타임존 기준이므로 그대로 사용합니다.
    const today = formatDate(todayObj);
    
    let generatedCount = 0;
    const logs = [];

    for (const schedule of schedules) {
      const { start_date, end_date, project_code } = schedule;
      
      // 시작일 전이면 무시
      if (start_date && start_date > today) {
        logs.push(`[Skip] ${project_code}: 시작일(${start_date}) 이전`);
        continue;
      }
      
      // 이미 완전히 끝난(종료일이 지난) 프로젝트면 무시
      if (end_date && end_date < today) {
        logs.push(`[Skip] ${project_code}: 종료일(${end_date})이 이미 지났음`);
        continue;
      }

      let isTargetDay = false;
      let rStartDate = "";
      let rEndDate = today;

      // 이번 달의 1일
      const firstDayOfMonth = new Date(todayObj.getFullYear(), todayObj.getMonth(), 1);
      
      // B안 조건 확인: 오늘이 프로젝트 종료일인가?
      if (end_date && end_date === today) {
        isTargetDay = true;
        rStartDate = formatDate(firstDayOfMonth) > start_date ? formatDate(firstDayOfMonth) : start_date;
        rEndDate = end_date;
        logs.push(`[Target] ${project_code}: 오늘이 프로젝트 종료일`);
      } 
      // 오늘이 월의 마지막 날인가?
      else if (isLastDayOfMonth(todayObj)) {
        isTargetDay = true;
        rStartDate = formatDate(firstDayOfMonth) > start_date ? formatDate(firstDayOfMonth) : start_date;
        rEndDate = today;
        logs.push(`[Target] ${project_code}: 오늘이 월의 마지막 날`);
      }

      if (!isTargetDay) continue;

      // ── 리포트 데이터 생성 ──
      logs.push(`[Process] ${project_code}: ${rStartDate} ~ ${rEndDate} 데이터 수집 시작`);
      
      // JQL 조립
      const endDateNextObj = new Date(rEndDate);
      endDateNextObj.setDate(endDateNextObj.getDate() + 1);
      const endDateNext = formatDate(endDateNextObj);
      
      let dateJql = `worklogDate >= "${rStartDate}" AND worklogDate < "${endDateNext}"`;
      let orFilters = [];
      if (schedule.parent_key) orFilters.push(`parent = "${schedule.parent_key}"`);
      
      let targetUsersData = [];
      try { targetUsersData = JSON.parse(schedule.target_users_json || "[]"); } catch(e) {}
      
      const accounts = [...new Set(targetUsersData.map(u => u.dt_account).filter(Boolean))];
      if (accounts.length > 0) {
        orFilters.push(`worklogAuthor in (${accounts.map(a => `"${a}"`).join(", ")})`);
      }

      let finalJql = dateJql;
      if (orFilters.length > 0) {
        finalJql += ` AND (${orFilters.join(" OR ")})`;
      }

      // /api/worklogs 호출 (동일 서버 내)
      const baseUrl = request.nextUrl ? `${request.nextUrl.protocol}//${request.nextUrl.host}` : "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/worklogs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: rStartDate,
          endDate: rEndDate,
          includeKeyword: schedule.include_keyword,
          excludeKeyword: schedule.exclude_keyword,
          targetType: "custom",
          targetUsers: targetUsersData,
          overrideJql: finalJql
        })
      });

      if (!res.ok) {
        logs.push(`[Error] ${project_code}: api/worklogs 호출 실패 (${res.status})`);
        continue;
      }

      const data = await res.json();
      const rawLogs = data.worklogs || [];

      // Frontend와 동일하게 프로젝트 코드 검증 (포맷 파싱) 및 포함/제외 필터링은 api/worklogs에서 이미 했음.
      // 프로젝트 코드 포맷 체크
      const validCodes = (project_code || "").split(",").map(c => c.trim().toLowerCase());
      
      const filteredLogs = rawLogs.map(w => {
        const text = (w.comment || "").trim();
        let parts = [];
        let current = "";
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '/' && text.substring(i - 6, i) !== 'https:' && text.substring(i - 5, i) !== 'http:') {
            parts.push(current.trim());
            current = "";
          } else {
            current += text[i];
          }
        }
        parts.push(current.trim());
        let pCode = "";
        let taskType = "미분류";
        if (parts.length >= 2 && parts[0].length < 30) {
          pCode = parts[0];
          taskType = parts[1];
        }
        return { ...w, pCode, taskType };
      }).filter(w => {
        if (!w.pCode) return true; // 포맷이 없으면 무조건 포함
        return validCodes.includes(w.pCode.toLowerCase());
      });

      // 계산
      const totalSeconds = filteredLogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0);
      const totalHours = parseFloat((totalSeconds / 3600).toFixed(1));
      const totalMM = parseFloat((totalHours / 8 / 20.5).toFixed(3));

      const reportMonth = rEndDate.substring(0, 7); // "YYYY-MM"
      const targetPeriod = `${rStartDate} ~ ${rEndDate}`;

      // DB 저장
      const stmt = db.prepare(`
        INSERT INTO report_results (scheduled_report_id, project_id, report_month, target_period, total_hours, total_mm, report_data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(schedule.id, schedule.project_id, reportMonth, targetPeriod, totalHours, totalMM, JSON.stringify(filteredLogs));

      logs.push(`[Success] ${project_code}: 저장 완료 (${totalHours}h, ${totalMM}MM)`);
      generatedCount++;
    }

    return NextResponse.json({ success: true, generatedCount, logs });
  } catch (error) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
