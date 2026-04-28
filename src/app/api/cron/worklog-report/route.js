import { NextResponse } from 'next/server';
import db from '@/lib/db';

const isLastDayOfMonth = (date) => {
  const d = new Date(date);
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate() + 1);
  return nextDay.getDate() === 1;
};

// KST 기준으로 날짜 문자열(YYYY-MM-DD) 반환
const getKstDateString = (dateObj) => {
  const kst = new Date(dateObj.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
};

export async function GET(request) {
  try {
    const schedules = db.prepare(`SELECT * FROM worklog_schedules`).all();
    
    const todayObj = new Date();
    const today = getKstDateString(todayObj);

    const yesterdayObj = new Date(todayObj);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterday = getKstDateString(yesterdayObj);
    
    let generatedCount = 0;
    const logs = [];

    for (const schedule of schedules) {
      const { schedule_type } = schedule;
      
      let isTargetDay = false;
      let rStartDate = "";
      let rEndDate = "";
      let targetDateKey = ""; // DB 중복 확인용 키

      if (schedule_type === 'daily') {
        isTargetDay = true;
        rStartDate = yesterday;
        rEndDate = yesterday;
        targetDateKey = yesterday; // "YYYY-MM-DD"
      } else if (schedule_type === 'monthly') {
        if (isLastDayOfMonth(todayObj)) {
          isTargetDay = true;
          const firstDayOfMonth = new Date(todayObj.getFullYear(), todayObj.getMonth(), 1);
          rStartDate = getKstDateString(firstDayOfMonth);
          rEndDate = today;
          targetDateKey = today.substring(0, 7); // "YYYY-MM"
        }
      }

      if (!isTargetDay) continue;

      // ── 중복 생성 방지 ──
      const existingReport = db.prepare(`
        SELECT count(*) as cnt 
        FROM worklog_results 
        WHERE schedule_id = ? AND target_date = ?
      `).get(schedule.id, targetDateKey);

      if (existingReport && existingReport.cnt > 0) {
        logs.push(`[Skip] Schedule ${schedule.id}: ${targetDateKey} 리포트가 이미 존재합니다.`);
        continue;
      }

      logs.push(`[Process] Schedule ${schedule.id}: ${rStartDate} ~ ${rEndDate} 데이터 수집 시작`);
      
      // JQL 조립
      const endDateNextObj = new Date(rEndDate);
      endDateNextObj.setDate(endDateNextObj.getDate() + 1);
      const endDateNext = getKstDateString(endDateNextObj);
      
      let dateJql = `worklogDate >= "${rStartDate}" AND worklogDate < "${endDateNext}"`;
      let orFilters = [];
      
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

      // /api/worklogs 호출
      const baseUrl = request.nextUrl ? `${request.nextUrl.protocol}//${request.nextUrl.host}` : "http://localhost:3000";
      const res = await fetch(`${baseUrl}/api/worklogs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: rStartDate,
          endDate: rEndDate,
          targetType: "custom",
          targetUsers: targetUsersData,
          overrideJql: finalJql
        })
      });

      if (!res.ok) {
        logs.push(`[Error] Schedule ${schedule.id}: api/worklogs 호출 실패 (${res.status})`);
        continue;
      }

      const data = await res.json();
      const rawLogs = data.worklogs || [];

      // 작업기록이 없으면 저장하지 않음 (유저 요청)
      if (rawLogs.length === 0) {
        logs.push(`[Skip] Schedule ${schedule.id}: ${targetDateKey} 작업기록이 없습니다. 저장 생략.`);
        continue;
      }

      // 계산
      const totalSeconds = rawLogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0);
      const totalHours = parseFloat((totalSeconds / 3600).toFixed(1));

      // DB 저장
      const stmt = db.prepare(`
        INSERT INTO worklog_results (schedule_id, report_type, target_date, total_hours, report_data_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(schedule.id, schedule_type, targetDateKey, totalHours, JSON.stringify(rawLogs));

      logs.push(`[Success] Schedule ${schedule.id}: 저장 완료 (${totalHours}h, ${rawLogs.length}건)`);
      generatedCount++;
    }

    return NextResponse.json({ success: true, generatedCount, logs });
  } catch (error) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
