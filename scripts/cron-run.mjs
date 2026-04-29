import { fileURLToPath } from 'url';
import path from 'path';
import { runWorklogReports } from '../src/lib/cronService.js';

// CWD 설정
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

async function run() {
  console.log(`[${new Date().toLocaleString()}] 자동 스케줄 시작...`);
  try {
    const result = await runWorklogReports();
    result.logs.forEach(log => console.log(log));
    console.log(`생성된 리포트: ${result.generatedCount}개`);
  } catch (err) {
    console.error("실행 중 오류 발생:", err);
  }
}

run();
