import { sseClients } from '@/lib/sseClients';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

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

  return Response.json({
    connectedClients: sseClients.size,
    rules
  });
}

export async function POST(request) {
  const data = await request.json();
  const { ruleKey, isActive, target } = data;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO dashboard_config (key, value) 
      VALUES (?, ?) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    
    if (isActive !== undefined) {
      stmt.run(`noti_rule_${ruleKey}`, isActive ? 'true' : 'false');
    }
    if (target !== undefined) {
      stmt.run(`noti_target_${ruleKey}`, target);
    }
    
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
