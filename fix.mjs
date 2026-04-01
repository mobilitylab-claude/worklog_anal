import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'jira_filters.db');
const db = new Database(dbPath);

console.log("Fixing DB: Swapping 'part' and 'email' columns...");

try {
  // SQLite multiple update doesn't support swapping easily in one statement without temp, but:
  // UPDATE users SET part = email, email = part;
  // SQLite executes row by row? No, it should be atomic per statement.
  // Actually in SQLite, `UPDATE users SET a=b, b=a;` works correctly as a swap!
  const info = db.prepare(`
    UPDATE users SET 
      part = email, 
      email = part
  `).run();
  
  console.log(`Success! Fixed ${info.changes} rows.`);
} catch (e) {
  console.error("Error fixing DB:", e);
} finally {
  db.close();
}
