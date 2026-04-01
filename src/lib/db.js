import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'jira_filters.db');
const db = new Database(dbPath);

// 앱 구동 시 로컬 sqlite db 초기화 (필터 테이블 생성)
db.exec(`
  CREATE TABLE IF NOT EXISTS filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    jql TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// JIRA 사용자 관리용 테이블 확장
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part TEXT NOT NULL,
    name TEXT NOT NULL,
    dt_account TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 대시보드 설정 저장용 테이블 (예: 모니터링 대상 그룹 등)
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// 기본 설정 초기화 (최초 1회)
const insertConfig = db.prepare("INSERT OR IGNORE INTO dashboard_config (key, value) VALUES (?, ?)");
insertConfig.run("monitor_groups", "VRHMI, VRMW");

export default db;
