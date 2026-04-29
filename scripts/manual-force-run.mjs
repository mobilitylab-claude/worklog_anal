import { fileURLToPath } from 'url';
import path from 'path';
import { runWorklogReports } from '../src/lib/cronService.js';

// CWD 설정
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const forceDate = process.argv[2];
const forceType = process.argv[3];

if (!forceDate) {
  console.error("Usage: node manual-force-run.mjs <YYYY-MM-DD> [daily|monthly]");
  process.exit(1);
}

async function run() {
  console.log(`[Manual Force Run] Date: ${forceDate}, Type: ${forceType || 'All'}`);
  try {
    const result = await runWorklogReports({ forceDate, forceType });
    result.logs.forEach(log => console.log(log));
    console.log(`생성된 리포트: ${result.generatedCount}개`);
  } catch (err) {
    console.error("실행 중 오류 발생:", err);
  }
}

run();
