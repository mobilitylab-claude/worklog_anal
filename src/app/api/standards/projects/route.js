import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare('SELECT * FROM projects ORDER BY code ASC');
    const projects = stmt.all();
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { code, name, startDate, endDate, parentKey, reprProjectCode } = await request.json();
    if (!code || !name) return NextResponse.json({ error: "코드와 과제명은 필수입니다." }, { status: 400 });

    if (reprProjectCode) {
      if (reprProjectCode === code) {
        return NextResponse.json({ error: "대표 프로젝트 코드는 자기 자신일 수 없습니다." }, { status: 400 });
      }
      const existCheck = db.prepare('SELECT count(*) as count FROM projects WHERE code = ?').get(reprProjectCode);
      if (existCheck.count === 0) {
        return NextResponse.json({ error: "대표 프로젝트 코드는 기존에 등록된 과제 코드 중 하나여야 합니다." }, { status: 400 });
      }
    }

    const stmt = db.prepare('INSERT INTO projects (code, name, start_date, end_date, parent_key, repr_project_code) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(code, name, startDate || null, endDate || null, parentKey || null, reprProjectCode || null);
    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { id, code, name, startDate, endDate, parentKey, reprProjectCode } = await request.json();

    if (reprProjectCode) {
      if (reprProjectCode === code) {
        return NextResponse.json({ error: "대표 프로젝트 코드는 자기 자신일 수 없습니다." }, { status: 400 });
      }
      const existCheck = db.prepare('SELECT count(*) as count FROM projects WHERE code = ? AND id != ?').get(reprProjectCode, id);
      if (existCheck.count === 0) {
        return NextResponse.json({ error: "대표 프로젝트 코드는 기존에 등록된 과제 코드 중 하나여야 합니다." }, { status: 400 });
      }
    }

    const stmt = db.prepare('UPDATE projects SET code = ?, name = ?, start_date = ?, end_date = ?, parent_key = ?, repr_project_code = ? WHERE id = ?');
    stmt.run(code, name, startDate, endDate, parentKey || null, reprProjectCode || null, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
