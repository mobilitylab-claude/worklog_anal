import db from '@/lib/db';
import { normalizeAuthorName } from '@/lib/nameUtils';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 한국 시간 기준 기본 날짜 계산 (최근 30일)
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const defaultEnd = nowKst.toISOString().split('T')[0];
    
    const past30Kst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 29 * 24 * 60 * 60 * 1000);
    const defaultStart = past30Kst.toISOString().split('T')[0];

    const startDate = searchParams.get('startDate') || defaultStart;
    const endDate = searchParams.get('endDate') || defaultEnd;
    const rawTargetAuthor = searchParams.get('author');
    const targetAuthor = rawTargetAuthor ? normalizeAuthorName(rawTargetAuthor) : null;
    const targetType = searchParams.get('type');

    // 기존 notification_logs 테이블의 author에 붙어있던 접미사 1회 자동 정제
    try {
      const rawRows = db.prepare("SELECT DISTINCT author FROM notification_logs WHERE author LIKE '%기타모비스온사용자%' OR author LIKE '%협력사%'").all();
      for (const r of rawRows) {
        const clean = normalizeAuthorName(r.author);
        if (clean && clean !== r.author) {
          db.prepare("UPDATE notification_logs SET author = ? WHERE author = ?").run(clean, r.author);
        }
      }
    } catch (cleanErr) {}

    // 1. 기본 WHERE 조건 구성
    let whereClause = `WHERE (worklog_date BETWEEN ? AND ?)`;
    const params = [startDate, endDate];

    if (targetAuthor && targetAuthor.trim()) {
      whereClause += ` AND author = ?`;
      params.push(targetAuthor.trim());
    }

    if (targetType && targetType.trim()) {
      whereClause += ` AND noti_type = ?`;
      params.push(targetType.trim());
    }

    // 2. 전체 요약 통계
    const summaryRow = db.prepare(`
      SELECT 
        COUNT(*) as totalAlerts,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openAlerts,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedAlerts
      FROM notification_logs
      ${whereClause}
    `).get(...params);

    const totalAlerts = summaryRow?.totalAlerts || 0;
    const openAlerts = summaryRow?.openAlerts || 0;
    const resolvedAlerts = summaryRow?.resolvedAlerts || 0;
    const resolutionRate = totalAlerts > 0 ? parseFloat(((resolvedAlerts / totalAlerts) * 100).toFixed(1)) : 100;

    // 3. 사용자 정보 맵 (파트 정보 조회용 - 정규화된 이름 매핑)
    const usersMap = {};
    try {
      const userRows = db.prepare('SELECT name, part FROM users').all();
      userRows.forEach(u => {
        const cleanName = normalizeAuthorName(u.name);
        if (cleanName) usersMap[cleanName] = u.part || '미지정';
      });
    } catch (e) {}

    // 4. 개인별 통계 집계
    const rawUserRows = db.prepare(`
      SELECT 
        author,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openCount,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedCount,
        SUM(CASE WHEN noti_type = 'INVALID_PROJECT' THEN 1 ELSE 0 END) as invalidProjectCount,
        SUM(CASE WHEN noti_type = 'INVALID_TASK_TYPE' THEN 1 ELSE 0 END) as invalidTaskTypeCount,
        SUM(CASE WHEN noti_type = 'TIME_EXCEEDED' THEN 1 ELSE 0 END) as timeExceededCount,
        MAX(worklog_date) as latestDate
      FROM notification_logs
      ${whereClause}
      GROUP BY author
      ORDER BY total DESC, openCount DESC
    `).all(...params);

    // 접미사("기타모비스온사용자", "R&D 협력사" 등) 정규화하여 사용자별로 완벽 병합
    const userStatsMap = {};
    for (const u of rawUserRows) {
      const cleanName = normalizeAuthorName(u.author);
      if (!cleanName) continue;

      if (!userStatsMap[cleanName]) {
        userStatsMap[cleanName] = {
          author: cleanName,
          part: usersMap[cleanName] || '미지정',
          total: 0,
          openCount: 0,
          resolvedCount: 0,
          byType: {
            INVALID_PROJECT: 0,
            INVALID_TASK_TYPE: 0,
            TIME_EXCEEDED: 0,
          },
          latestDate: ''
        };
      }

      userStatsMap[cleanName].total += u.total;
      userStatsMap[cleanName].openCount += u.openCount;
      userStatsMap[cleanName].resolvedCount += u.resolvedCount;
      userStatsMap[cleanName].byType.INVALID_PROJECT += u.invalidProjectCount;
      userStatsMap[cleanName].byType.INVALID_TASK_TYPE += u.invalidTaskTypeCount;
      userStatsMap[cleanName].byType.TIME_EXCEEDED += u.timeExceededCount;
      if (!userStatsMap[cleanName].latestDate || u.latestDate > userStatsMap[cleanName].latestDate) {
        userStatsMap[cleanName].latestDate = u.latestDate;
      }
    }

    const userStats = Object.values(userStatsMap).map(u => ({
      ...u,
      resolutionRate: u.total > 0 ? parseFloat(((u.resolvedCount / u.total) * 100).toFixed(1)) : 100
    })).sort((a, b) => b.total - a.total);

    const userRows = userStats;

    // 5. 일자별 발생 추이 (Daily Trends)
    const trendRows = db.prepare(`
      SELECT 
        worklog_date as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openCount,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolvedCount
      FROM notification_logs
      ${whereClause}
      GROUP BY worklog_date
      ORDER BY worklog_date ASC
    `).all(...params);

    // 6. 오류 유형별 분포 (Type Distribution)
    const typeRows = db.prepare(`
      SELECT 
        noti_type as type,
        COUNT(*) as count
      FROM notification_logs
      ${whereClause}
      GROUP BY noti_type
      ORDER BY count DESC
    `).all(...params);

    const typeDistribution = typeRows.map(t => ({
      type: t.type,
      label: t.type === 'INVALID_PROJECT' ? '프로젝트 코드 오류' 
           : t.type === 'INVALID_TASK_TYPE' ? '작업유형 포맷 오류' 
           : t.type === 'TIME_EXCEEDED' ? '예상시간 초과' : t.type,
      count: t.count,
      percentage: totalAlerts > 0 ? parseFloat(((t.count / totalAlerts) * 100).toFixed(1)) : 0
    }));

    // 7. 최근 알림 상세 내역 (최대 200건)
    const recentLogs = db.prepare(`
      SELECT 
        id,
        alert_key,
        noti_type,
        author,
        issue_key,
        summary,
        worklog_id,
        worklog_date,
        title,
        message,
        comment,
        status,
        resolved_at,
        created_at
      FROM notification_logs
      ${whereClause}
      ORDER BY worklog_date DESC, created_at DESC
      LIMIT 200
    `).all(...params);

    // ══════════════════════════════════════════════════════════
    // 🚀 인사평가 특화 데이터 분석 (1번, 3번, 4번 지표)
    // ══════════════════════════════════════════════════════════

    // 1번 지표: 오류 해결 소요시간(MTTR) & 당일 해결률
    const mttrRows = db.prepare(`
      SELECT 
        author,
        COUNT(*) as resolvedTotal,
        AVG((julianday(resolved_at) - julianday(created_at)) * 24) as avgHours,
        SUM(CASE WHEN (julianday(resolved_at) - julianday(created_at)) * 24 <= 24 THEN 1 ELSE 0 END) as sameDayCount,
        SUM(CASE WHEN (julianday(resolved_at) - julianday(created_at)) * 24 <= 2 THEN 1 ELSE 0 END) as fastCount
      FROM notification_logs
      ${whereClause} AND status = 'resolved' AND resolved_at IS NOT NULL
      GROUP BY author
    `).all(...params);

    const mttrMap = {};
    mttrRows.forEach(r => {
      const cleanAuthor = normalizeAuthorName(r.author);
      const avgH = Math.max(0.1, r.avgHours || 0);
      if (!mttrMap[cleanAuthor]) {
        mttrMap[cleanAuthor] = {
          resolvedTotal: 0,
          totalAvgHoursTimesCount: 0,
          sameDayCount: 0,
          fastCount: 0
        };
      }
      mttrMap[cleanAuthor].resolvedTotal += r.resolvedTotal;
      mttrMap[cleanAuthor].totalAvgHoursTimesCount += (avgH * r.resolvedTotal);
      mttrMap[cleanAuthor].sameDayCount += r.sameDayCount;
      mttrMap[cleanAuthor].fastCount += r.fastCount;
    });

    // mttrMap 요약 필드 계산
    const normalizedMttrMap = {};
    for (const [authKey, data] of Object.entries(mttrMap)) {
      const avgH = data.resolvedTotal > 0 ? (data.totalAvgHoursTimesCount / data.resolvedTotal) : 0.1;
      normalizedMttrMap[authKey] = {
        avgHours: parseFloat(avgH.toFixed(1)),
        avgTimeFormatted: avgH < 1 ? `${Math.round(avgH * 60)}분` : `${avgH.toFixed(1)}시간`,
        sameDayCount: data.sameDayCount,
        sameDayRate: data.resolvedTotal > 0 ? parseFloat(((data.sameDayCount / data.resolvedTotal) * 100).toFixed(1)) : 100,
        fastRate: data.resolvedTotal > 0 ? parseFloat(((data.fastCount / data.resolvedTotal) * 100).toFixed(1)) : 0
      };
    }

    // 3번 지표 (계약과제별 기여도) & 4번 지표 (업무 집중도 및 멀티태스킹 지수)
    let worklogRows = [];
    try {
      worklogRows = db.prepare(`
        SELECT target_date, report_data_json 
        FROM worklog_results 
        WHERE report_type = 'daily' 
          AND target_date BETWEEN ? AND ?
      `).all(startDate, endDate);
    } catch (e) {}

    const userEffort = {};
    const projectTotalHours = {};

    for (const row of worklogRows) {
      try {
        const logs = JSON.parse(row.report_data_json || '[]');
        for (const item of logs) {
          const auth = normalizeAuthorName(item.author || '미지정');
          if (targetAuthor && auth !== targetAuthor) continue;

          const prj = item.projectCode || item.projectKey || '기타';
          const hrs = (item.timeSpentSeconds || 0) / 3600;
          const dt = row.target_date;
          const issue = item.issueKey || '';

          if (!userEffort[auth]) {
            userEffort[auth] = {
              totalHours: 0,
              dailyMap: {},
              projects: {}
            };
          }
          userEffort[auth].totalHours += hrs;
          userEffort[auth].projects[prj] = (userEffort[auth].projects[prj] || 0) + hrs;

          if (!userEffort[auth].dailyMap[dt]) {
            userEffort[auth].dailyMap[dt] = {
              hours: 0,
              issues: new Set(),
              projects: new Set()
            };
          }
          userEffort[auth].dailyMap[dt].hours += hrs;
          if (issue) userEffort[auth].dailyMap[dt].issues.add(issue);
          if (prj) userEffort[auth].dailyMap[dt].projects.add(prj);

          projectTotalHours[prj] = (projectTotalHours[prj] || 0) + hrs;
        }
      } catch (parseErr) {}
    }

    // 인사평가 지표 종합 산출
    const allEvalUsers = Array.from(new Set([...Object.keys(usersMap), ...Object.keys(userEffort), ...userRows.map(u => u.author)]));
    const hrEvaluation = [];

    for (const auth of allEvalUsers) {
      if (targetAuthor && auth !== targetAuthor) continue;

      const part = usersMap[auth] || '미지정';
      const uAlert = userRows.find(u => u.author === auth) || { total: 0, openCount: 0, resolvedCount: 0 };
      const uMttr = normalizedMttrMap[auth] || { avgHours: 0, avgTimeFormatted: '0시간', sameDayRate: 100, fastRate: 0 };
      const effort = userEffort[auth] || { totalHours: 0, dailyMap: {}, projects: {} };

      // 1번: 피드백 신속도 및 오류 조치도 (HR_FEEDBACK)
      const alertPenalty = Math.min(30, uAlert.total * 3);
      const openPenalty = uAlert.openCount * 15;
      const feedbackScore = Math.max(20, Math.min(100, Math.round(100 - alertPenalty - openPenalty + (uMttr.sameDayRate * 0.1))));

      // 3번: 계약과제 기여도 및 주력 과제 집중도 (HR_CONTRIBUTION)
      const userPrjs = Object.entries(effort.projects).map(([code, hrs]) => ({
        code,
        hours: parseFloat(hrs.toFixed(1)),
        mm: parseFloat((hrs / 160).toFixed(2)),
        projectShare: projectTotalHours[code] > 0 ? parseFloat(((hrs / projectTotalHours[code]) * 100).toFixed(1)) : 100
      })).sort((a, b) => b.hours - a.hours);

      const primaryProject = userPrjs[0] || { code: '없음', hours: 0, mm: 0, projectShare: 0 };
      const totalHrs = parseFloat(effort.totalHours.toFixed(1));
      const primaryRatio = totalHrs > 0 ? parseFloat(((primaryProject.hours / totalHrs) * 100).toFixed(1)) : 0;
      
      const contributionScore = Math.min(100, Math.max(30, Math.round((Math.min(totalHrs, 160) / 160 * 60) + (primaryRatio * 0.4))));

      // 4번: 업무 집중도 및 멀티태스킹 지수 (HR_WORKLOAD_BALANCE)
      const workDays = Object.keys(effort.dailyMap).length;
      let totalDayIssues = 0;
      let totalDayPrjs = 0;
      let overworkDays = 0;
      let underworkDays = 0;
      let regularDays = 0;

      for (const d of Object.values(effort.dailyMap)) {
        totalDayIssues += d.issues.size;
        totalDayPrjs += d.projects.size;
        if (d.hours >= 9.0) overworkDays++;
        else if (d.hours < 5.0) underworkDays++;
        else regularDays++;
      }

      const avgIssuesPerDay = workDays > 0 ? parseFloat((totalDayIssues / workDays).toFixed(1)) : 0;
      const avgProjectsPerDay = workDays > 0 ? parseFloat((totalDayPrjs / workDays).toFixed(1)) : 0;

      // CSI = 이슈수*0.6 + 프로젝트수*1.5
      const csi = parseFloat(((avgIssuesPerDay * 0.6) + (avgProjectsPerDay * 1.5)).toFixed(1));

      let workStyle = '균형형 (Balanced)';
      let workStyleDesc = '안정적으로 핵심 과제와 이슈를 분담하여 수행합니다.';
      if (csi < 2.5 && workDays > 0) {
        workStyle = '단일 집중형 (Deep Work)';
        workStyleDesc = '핵심 개발 및 연구 과제에 고도로 몰입하여 작업합니다.';
      } else if (csi > 4.5) {
        workStyle = '고도 분산형 (Multi-tasker)';
        workStyleDesc = '여러 프로젝트와 다수의 이슈를 동시 지원/대응하고 있습니다.';
      }

      const regularityRate = workDays > 0 ? (regularDays / workDays) : 1;
      const balanceScore = Math.min(100, Math.max(30, Math.round((regularityRate * 70) + (csi <= 4.0 ? 30 : 15))));

      // 종합 인사평가 등급
      const totalScore = Math.round((feedbackScore * 0.35) + (contributionScore * 0.35) + (balanceScore * 0.30));
      let grade = 'B';
      if (totalScore >= 92) grade = 'S';
      else if (totalScore >= 83) grade = 'A';
      else if (totalScore >= 72) grade = 'B';
      else if (totalScore >= 60) grade = 'C';
      else grade = 'D';

      hrEvaluation.push({
        author: auth,
        part,
        totalScore,
        grade,
        
        // 1번 지표: MTTR & 당일 해결률
        indicator1: {
          title: '오류 수정 신속도 (MTTR)',
          score: feedbackScore,
          avgHours: uMttr.avgHours,
          avgTimeFormatted: uMttr.avgTimeFormatted,
          sameDayRate: uMttr.sameDayRate,
          fastRate: uMttr.fastRate,
          totalAlerts: uAlert.total,
          openAlerts: uAlert.openCount,
          resolvedAlerts: uAlert.resolvedCount,
          resolutionRate: uAlert.total > 0 ? parseFloat(((uAlert.resolvedCount / uAlert.total) * 100).toFixed(1)) : 100
        },

        // 3번 지표: 계약과제 기여도 & 주력 집중도
        indicator3: {
          title: '계약과제 기여도 및 주력 집중도',
          score: contributionScore,
          totalHours: totalHrs,
          totalMM: parseFloat((totalHrs / 160).toFixed(2)),
          primaryProjectCode: primaryProject.code,
          primaryProjectHours: primaryProject.hours,
          primaryProjectShare: primaryProject.projectShare,
          primaryRatio,
          projectList: userPrjs
        },

        // 4번 지표: 멀티태스킹 지수 & 워크로드 안정성
        indicator4: {
          title: '업무 집중도 및 멀티태스킹 지수 (CSI)',
          score: balanceScore,
          workingDays: workDays,
          avgIssuesPerDay,
          avgProjectsPerDay,
          csi,
          workStyle,
          workStyleDesc,
          overworkDays,
          underworkDays,
          regularDays
        }
      });
    }

    hrEvaluation.sort((a, b) => b.totalScore - a.totalScore);

    return Response.json({
      success: true,
      period: { startDate, endDate },
      summary: {
        totalAlerts,
        openAlerts,
        resolvedAlerts,
        resolutionRate
      },
      userStats,
      dailyTrends: trendRows,
      typeDistribution,
      recentLogs,
      hrEvaluation
    }, { headers: corsHeaders });
  } catch (err) {
    console.error("Notification statistics error:", err);
    return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, alertKey, status, allForUser, author } = body;
    const targetStatus = status === 'open' ? 'open' : 'resolved';

    if (allForUser && author) {
      const cleanAuthor = normalizeAuthorName(author);
      if (targetStatus === 'resolved') {
        db.prepare("UPDATE notification_logs SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE (author = ? OR author LIKE ?) AND status = 'open'").run(cleanAuthor, `%${cleanAuthor}%`);
      } else {
        db.prepare("UPDATE notification_logs SET status = 'open', resolved_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE (author = ? OR author LIKE ?)").run(cleanAuthor, `%${cleanAuthor}%`);
      }
      return Response.json({ success: true, message: `${cleanAuthor} 사용자의 모든 알림이 ${targetStatus} 상태로 변경되었습니다.` }, { headers: corsHeaders });
    }

    if (id) {
      if (targetStatus === 'resolved') {
        db.prepare("UPDATE notification_logs SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      } else {
        db.prepare("UPDATE notification_logs SET status = 'open', resolved_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      }
      return Response.json({ success: true, id, status: targetStatus }, { headers: corsHeaders });
    }

    if (alertKey) {
      if (targetStatus === 'resolved') {
        db.prepare("UPDATE notification_logs SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE alert_key = ?").run(alertKey);
      } else {
        db.prepare("UPDATE notification_logs SET status = 'open', resolved_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE alert_key = ?").run(alertKey);
      }
      return Response.json({ success: true, alertKey, status: targetStatus }, { headers: corsHeaders });
    }

    return Response.json({ success: false, error: "id 또는 alertKey가 필요합니다." }, { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error("Failed to update notification log status:", err);
    return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
  }
}

