import { GET } from './src/app/api/cron/worklog-report/route.js';

async function test() {
  const req = {
    nextUrl: { protocol: 'http:', host: 'localhost:3000' }
  };
  try {
    const res = await GET(req);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}

test();
