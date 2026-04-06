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

// ── 계약과제(프로젝트) 정보 테이블 ───────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ── 작업유형별 입력 기준 테이블 (기준키워드 삭제됨) ───────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS work_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT,
    keywords_json TEXT DEFAULT '[]',
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 🚀 [마이그레이션] 구 버전의 keyword(NOT NULL UNIQUE) 컬럼 제거 대응
try {
  const tableInfo = db.prepare("PRAGMA table_info(work_types)").all();
  const hasOldKeyword = tableInfo.some(c => c.name === 'keyword');
  if (hasOldKeyword) {
    console.log("Old schema detected in work_types. Migrating...");
    db.transaction(() => {
      // 1. 새 테이블 생성
      db.exec(`
        CREATE TABLE work_types_temp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          content TEXT,
          keywords_json TEXT DEFAULT '[]',
          remarks TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // 2. 데이터 이전 (keyword 빼고)
      db.exec(`
        INSERT INTO work_types_temp (id, name, content, keywords_json, remarks, created_at)
        SELECT id, name, content, keywords_json, remarks, created_at FROM work_types
      `);
      // 3. 기존 테이블 삭제 및 교체
      db.exec("DROP TABLE work_types");
      db.exec("ALTER TABLE work_types_temp RENAME TO work_types");
    })();
    console.log("Migration finished successfully.");
  }
} catch (err) {
  console.error("Migration during startup failed:", err);
}

// ── 대시보드 설정 저장용 테이블 ───────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// 초기 데이터 삽입 (최초 1회만)
const checkProj = db.prepare("SELECT count(*) as count FROM projects").get();
if (checkProj.count === 0) {
  const insertProj = db.prepare("INSERT INTO projects (code, name) VALUES (?, ?)");
  insertProj.run("ccNC_2601_VRHMI", "26년 ccNC 음성인식 APP SW 유지보수");
  insertProj.run("ccNC_2502_VRMW",  "25년 시스템 플랫폼 음성인식 미들웨어 유지보수");
}

const checkTypes = db.prepare("SELECT count(*) as count FROM work_types").get();
if (checkTypes.count === 0) {
  const insertType = db.prepare("INSERT INTO work_types (name, content, keywords_json) VALUES (?, ?, ?)");
  insertType.run("개발", "로직 개발 및 배포", JSON.stringify(["pr", "dev"]));
  insertType.run("회의", "프로젝트 정기 회의", JSON.stringify(["meeting", "review"]));
}

export default db;
