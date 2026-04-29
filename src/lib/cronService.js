import db from './db.js';
import { getWorklogs } from './worklogService.js';

export const isLastDayOfMonth = (date) => {
  const d = new Date(date);
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate() + 1);
  return nextDay.getDate() === 1;
};

export const getKstDateString = (dateObj) => {
  const kst = new Date(dateObj.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
};

/**
 * 스케줄링 리포트 실행 핵심 로직
 */
export async function runWorklogReports({ forceDate = null, forceType = null } = {}) {
  const schedules = db.prepare(`SELECT * FROM worklog_schedules`).all();
  
  const todayObj = new Date();
  const today = getKstDateString(todayObj);

  const yesterdayObj = new Date(todayObj);
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterday = getKstDateString(yesterdayObj);
  
  let generatedCount = 0;
  const logs = [];

  for (const schedule of schedules) {
    const { id, schedule_type, target_users_json } = schedule;
    
    let isTargetDay = false;
    let rStartDate = "";
    let rEndDate = "";
    let targetDateKey = "";

    // 1. 수동 실행 여부 판단
    if (forceDate && (!forceType || forceType === schedule_type)) {
      isTargetDay = true;
      rStartDate = forceDate;
      rEndDate = forceDate;
      targetDateKey = forceDate;
      
      if (schedule_type === 'monthly') {
        if (forceDate.length === 7) { // YYYY-MM
          const [y, m] = forceDate.split('-').map(Number);
          const firstDay = new Date(y, m - 1, 1);
          const lastDay = new Date(y, m, 0);
          rStartDate = getKstDateString(firstDay);
          rEndDate = getKstDateString(lastDay);
          targetDateKey = forceDate;
        } else {
          const firstDay = new Date(new Date(forceDate).getFullYear(), new Date(forceDate).getMonth(), 1);
          rStartDate = getKstDateString(firstDay);
          rEndDate = forceDate;
          targetDateKey = forceDate.substring(0, 7);
        }
      }
    } 
    // 2. 자동 스케줄 판단
    else if (!forceDate) {
      if (schedule_type === 'daily') {
        isTargetDay = true;
        rStartDate = yesterday;
        rEndDate = yesterday;
        targetDateKey = yesterday;
      } else if (schedule_type === 'monthly') {
        if (isLastDayOfMonth(todayObj)) {
          isTargetDay = true;
          const firstDayOfMonth = new Date(todayObj.getFullYear(), todayObj.getMonth(), 1);
          rStartDate = getKstDateString(firstDayOfMonth);
          rEndDate = today;
          targetDateKey = today.substring(0, 7);
        }
      }
    }

    if (!isTargetDay) continue;

    // 중복 생성 방지 (수동 실행 시 제외)
    if (!forceDate) {
      const existing = db.prepare(`
        SELECT count(*) as cnt FROM worklog_results WHERE schedule_id = ? AND target_date = ?
      `).get(id, targetDateKey);

      if (existing.cnt > 0) {
        logs.push(`[Skip] Schedule ${id}: ${targetDateKey} 리포트가 이미 존재합니다.`);
        continue;
      }
    }

    logs.push(`[Process] Schedule ${id}: ${rStartDate} ~ ${rEndDate} 수집 시작`);
    
    let targetUsersData = [];
    try { targetUsersData = JSON.parse(target_users_json || "[]"); } catch(e) {}
    
    const accounts = [...new Set(targetUsersData.map(u => u.dt_account).filter(Boolean))];
    const endDateNextObj = new Date(rEndDate);
    endDateNextObj.setDate(endDateNextObj.getDate() + 1);
    const endDateNext = getKstDateString(endDateNextObj);
    
    let finalJql = `worklogDate >= "${rStartDate}" AND worklogDate < "${endDateNext}"`;
    if (accounts.length > 0) {
      finalJql += ` AND (worklogAuthor in (${accounts.map(a => `"${a}"`).join(", ")}))`;
    }

    try {
      const debugLog = [];
      const rawLogs = await getWorklogs({
        startDate: rStartDate,
        endDate: rEndDate,
        targetType: "custom",
        targetUsers: targetUsersData,
        overrideJql: finalJql,
        debugLog
      });

      debugLog.forEach(d => logs.push(d));

      if (rawLogs.length === 0) {
        logs.push(`[Skip] Schedule ${id}: 작업기록이 없습니다.`);
        continue;
      }

      const totalSeconds = rawLogs.reduce((a, c) => a + (c.timeSpentSeconds || 0), 0);
      const totalHours = parseFloat((totalSeconds / 3600).toFixed(1));

      db.prepare(`
        INSERT INTO worklog_results (schedule_id, report_type, target_date, total_hours, report_data_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, schedule_type, targetDateKey, totalHours, JSON.stringify(rawLogs));

      logs.push(`[Success] Schedule ${id}: 저장 완료 (${totalHours}h, ${rawLogs.length}건)`);
      generatedCount++;
    } catch (err) {
      logs.push(`[Error] Schedule ${id}: ${err.message}`);
    }
  }

  return { generatedCount, logs };
}
