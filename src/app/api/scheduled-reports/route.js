import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare(`
      SELECT s.*, p.name as project_name, p.code as project_code 
      FROM scheduled_reports s
      JOIN projects p ON s.project_id = p.id
      ORDER BY s.created_at DESC
    `);
    const reports = stmt.all();
    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { project_id, parent_key, include_keyword, exclude_keyword, target_mode, target_users } = await request.json();
    
    if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

    const stmt = db.prepare(`
      INSERT INTO scheduled_reports (project_id, parent_key, include_keyword, exclude_keyword, target_mode, target_users_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const info = stmt.run(
      project_id, 
      parent_key || "", 
      include_keyword || "", 
      exclude_keyword || "", 
      target_mode || "all", 
      JSON.stringify(target_users || [])
    );

    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const stmt = db.prepare('DELETE FROM scheduled_reports WHERE id = ?');
    stmt.run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
