const db = require('better-sqlite3')('jira_filters.db');
const schedules = db.prepare('SELECT id, schedule_name, schedule_type FROM worklog_schedules;').all();
console.log('Schedules:', schedules);
const results = db.prepare('SELECT id, schedule_id, target_date, created_at, report_type, total_hours FROM worklog_results ORDER BY created_at DESC LIMIT 10;').all();
console.log('Recent Results:', results);
