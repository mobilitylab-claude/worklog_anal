import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const type = searchParams.get('type'); // 'daily' or 'monthly'
    
    let whereClause = "";
    const params = [];
    
    if (type) {
      whereClause = ` WHERE report_type = ?`;
      params.push(type);
    }
    
    // Total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM worklog_results${whereClause}`;
    const totalCount = db.prepare(countQuery).get(...params).total;

    // Paginated results
    const query = `SELECT id, target_date, report_type, total_hours, created_at, report_data_json 
                   FROM worklog_results 
                   ${whereClause} 
                   ORDER BY created_at DESC 
                   LIMIT ? OFFSET ?`;
    
    const results = db.prepare(query).all(...params, limit, offset);
    
    return NextResponse.json({ results, total: totalCount });
  } catch (error) {
    console.error("[API Error] worklog-results GET:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    }
    
    const stmt = db.prepare("DELETE FROM worklog_results WHERE id = ?");
    const result = stmt.run(id);
    
    if (result.changes === 0) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API Error] worklog-results DELETE:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
