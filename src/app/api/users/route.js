import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare('SELECT * FROM users ORDER BY part ASC, name ASC');
    const users = stmt.all();
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    // 1. 배열 형태의 데이터가 들어온 경우 (엑셀 대량 복붙 일괄 삽입 모드)
    if (Array.isArray(body)) {
      const insertStmt = db.prepare('INSERT INTO users (part, name, dt_account, email) VALUES (?, ?, ?, ?)');
      
      // 트랜잭션을 사용하여 수백 건의 데이터도 한 방에 삽입하여 성능 극대화 (better-sqlite3)
      const insertMany = db.transaction((usersToInsert) => {
        let count = 0;
        for (const u of usersToInsert) {
          // 이름이나 DT계정이 없으면 행 건너뜀 (빈 줄 방지)
          if (!u.name || !u.dt_account) continue;
          insertStmt.run(u.part || "미소속", u.name, u.dt_account, u.email || `${u.dt_account}@mobis.co.kr`);
          count++;
        }
        return count;
      });
      
      const insertedCount = insertMany(body);
      return NextResponse.json({ success: true, count: insertedCount });
    } 
    // 2. 단일 객체 데이터가 들어온 경우 (개별 폼 등록 모드)
    else {
      const { part, name, dt_account, email } = body;
      if (!name || !dt_account || !email) {
        return NextResponse.json({ error: "이름, DT계정, 이메일은 필수입니다." }, { status: 400 });
      }

      const stmt = db.prepare('INSERT INTO users (part, name, dt_account, email) VALUES (?, ?, ?, ?)');
      const info = stmt.run(part || "미소속", name, dt_account, email);

    return NextResponse.json({ success: true, id: info.lastInsertRowid });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { id, part, name, dt_account, email } = await request.json();
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const stmt = db.prepare('UPDATE users SET part = ?, name = ?, dt_account = ?, email = ? WHERE id = ?');
    stmt.run(part, name, dt_account, email, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    stmt.run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
