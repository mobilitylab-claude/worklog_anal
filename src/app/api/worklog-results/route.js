import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || 10;
    const type = searchParams.get('type'); // 'daily' or 'monthly'
    
    let query = `SELECT * FROM worklog_results`;
    const params = [];
    
    if (type) {
      query += ` WHERE report_type = ?`;
      params.push(type);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(query);
    const results = stmt.all(...params);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
