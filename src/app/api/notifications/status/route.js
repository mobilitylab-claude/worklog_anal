import { sseClients, updatePollingInterval, getMonitorInterval } from '@/lib/sseClients';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET() {
  const getConfig = (key, defaultVal) => {
    try {
      const row = db.prepare('SELECT value FROM dashboard_config WHERE key = ?').get(key);
      return row ? row.value : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  };

  const getRuleData = (key) => {
    const isActive = getConfig(`noti_rule_${key}`, 'true') === 'true';
    const target = getConfig(`noti_target_${key}`, '');
    return { isActive, target };
  };

  const rules = {
    USER_WORKLOG: getRuleData('USER_WORKLOG'),
    INVALID_PROJECT: getRuleData('INVALID_PROJECT'),
    INVALID_TASK_TYPE: getRuleData('INVALID_TASK_TYPE'),
    TIME_EXCEEDED: getRuleData('TIME_EXCEEDED')
  };

  const monitorInterval = getMonitorInterval();

  return Response.json({
    connectedClients: sseClients.size,
    monitorInterval,
    rules
  }, {
    headers: corsHeaders
  });
}

export async function POST(request) {
  try {
    const data = await request.json();
    const { ruleKey, isActive, target, monitorInterval } = data;
    
    const stmt = db.prepare(`
      INSERT INTO dashboard_config (key, value) 
      VALUES (?, ?) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    if (ruleKey) {
      if (isActive !== undefined) {
        stmt.run(`noti_rule_${ruleKey}`, isActive ? 'true' : 'false');
      }
      if (target !== undefined) {
        stmt.run(`noti_target_${ruleKey}`, target);
      }
    }

    if (monitorInterval !== undefined) {
      const intervalVal = parseInt(monitorInterval, 10);
      const safeInterval = isNaN(intervalVal) ? 10 : Math.max(0, intervalVal);
      stmt.run('monitor_interval_minutes', String(safeInterval));
      updatePollingInterval(safeInterval);
    }
    
    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("status POST error:", err);
    return Response.json({ success: false, error: err.message }, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
