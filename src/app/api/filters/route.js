import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare('SELECT * FROM filters ORDER BY created_at DESC');
    const filters = stmt.all();
    return NextResponse.json({ filters });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { name, jql } = await request.json();
    if (!name || !jql) {
      return NextResponse.json({ error: "필터명과 JQL을 모두 입력해주세요." }, { status: 400 });
    }

    const stmt = db.prepare('INSERT INTO filters (name, jql) VALUES (?, ?)');
    const info = stmt.run(name, jql);

    return NextResponse.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
