import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare(`SELECT * FROM worklog_schedules ORDER BY created_at DESC`);
    const schedules = stmt.all();
    return NextResponse.json({ schedules });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { schedule_type, target_mode, target_users } = await request.json();
    
    if (!schedule_type) return NextResponse.json({ error: "schedule_type is required" }, { status: 400 });

    const stmt = db.prepare(`
      INSERT INTO worklog_schedules (schedule_type, target_mode, target_users_json)
      VALUES (?, ?, ?)
    `);
    
    const info = stmt.run(
      schedule_type,
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

    const stmt = db.prepare('DELETE FROM worklog_schedules WHERE id = ?');
    stmt.run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { id, target_mode, target_users } = await request.json();
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const stmt = db.prepare(`
      UPDATE worklog_schedules
      SET target_mode = ?, target_users_json = ?
      WHERE id = ?
    `);
    
    stmt.run(
      target_mode || "all",
      JSON.stringify(target_users || []),
      id
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
