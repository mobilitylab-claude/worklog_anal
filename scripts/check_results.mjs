import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '..', 'jira_filters.db');
const db = new Database(dbPath);

console.log("Checking worklog_results table...");
try {
  const count = db.prepare("SELECT count(*) as cnt FROM worklog_results").get();
  console.log(`Total rows: ${count.cnt}`);
  
  const samples = db.prepare("SELECT id, report_type, target_date, created_at FROM worklog_results ORDER BY created_at DESC LIMIT 5").all();
  console.log("Latest 5 entries:");
  console.log(JSON.stringify(samples, null, 2));
} catch (e) {
  console.error("Error:", e.message);
} finally {
  db.close();
}
