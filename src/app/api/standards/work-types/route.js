import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare('SELECT * FROM work_types ORDER BY id ASC');
    const types = stmt.all();
    return NextResponse.json({ 
      types: types.map(t => ({
        ...t,
        keywords: JSON.parse(t.keywords_json || '[]')
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { name, content, keywords, remarks } = await request.json();
    if (!name) return NextResponse.json({ error: "명칭은 필수입니다." }, { status: 400 });
    
    const stmt = db.prepare('INSERT INTO work_types (name, content, keywords_json, remarks) VALUES (?, ?, ?, ?)');
    const info = stmt.run(name, content || "", JSON.stringify(keywords || []), remarks || "");
    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { id, name, content, keywords, remarks } = await request.json();
    const stmt = db.prepare('UPDATE work_types SET name = ?, content = ?, keywords_json = ?, remarks = ? WHERE id = ?');
    stmt.run(name, content, JSON.stringify(keywords || []), remarks, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const stmt = db.prepare('DELETE FROM work_types WHERE id = ?');
    stmt.run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
