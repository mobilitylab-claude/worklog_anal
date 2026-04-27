import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare(`
      SELECT r.*, p.name as project_name, p.code as project_code 
      FROM report_results r
      JOIN projects p ON r.project_id = p.id
      ORDER BY r.created_at DESC
    `);
    const reports = stmt.all();
    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const stmt = db.prepare('DELETE FROM report_results WHERE id = ?');
    stmt.run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
