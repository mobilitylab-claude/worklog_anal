import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { encryptText, decryptText, maskToken } from '@/lib/crypto';

// GET: DB에 저장된 Jira 계정 목록 및 활성 계정 조회
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeRaw = searchParams.get('includeRaw') === 'true';

    const rows = db.prepare('SELECT id, name, encrypted_token, is_active, created_at, updated_at FROM jira_accounts ORDER BY created_at ASC').all();
    
    let activeId = null;
    const accounts = rows.map(r => {
      const rawToken = decryptText(r.encrypted_token);
      if (r.is_active === 1) {
        activeId = r.id;
      }
      return {
        id: r.id,
        name: r.name,
        maskedToken: maskToken(rawToken),
        // 클라이언트 사이드 Jira 통신 호환을 위해 raw 토큰 포함
        token: includeRaw ? rawToken : undefined,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at
      };
    });

    return NextResponse.json({
      success: true,
      accounts,
      activeId: activeId || (accounts.length > 0 ? accounts[0].id : null)
    });
  } catch (err) {
    console.error('Jira accounts GET error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST: 새 Jira 계정 등록 또는 일괄 동기화 (암호화 저장)
export async function POST(request) {
  try {
    const body = await request.json();

    // 1. 다중 계정 일괄 마이그레이션(동기화) 모드
    if (Array.isArray(body.accounts)) {
      const activeId = body.activeId;
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO jira_accounts (id, name, encrypted_token, is_active, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      const tx = db.transaction((accs) => {
        for (const acc of accs) {
          if (!acc.id || !acc.name || !acc.token) continue;
          const enc = encryptText(acc.token);
          const isActive = (acc.id === activeId) ? 1 : 0;
          insertStmt.run(acc.id, acc.name, enc, isActive);
        }
      });
      tx(body.accounts);

      return NextResponse.json({ success: true, message: '계정 일괄 저장 완료' });
    }

    // 2. 단일 계정 추가 모드
    const { name, token, id } = body;
    if (!name || !token) {
      return NextResponse.json({ success: false, error: '이름과 토큰은 필수입니다.' }, { status: 400 });
    }

    const accId = id || Date.now().toString();
    const enc = encryptText(token);

    // 기존 계정이 하나도 없으면 자동으로 활성(is_active=1) 처리
    const count = db.prepare('SELECT count(*) as c FROM jira_accounts').get().c;
    const isActive = count === 0 ? 1 : 0;

    db.prepare(`
      INSERT INTO jira_accounts (id, name, encrypted_token, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(accId, name, enc, isActive);

    return NextResponse.json({
      success: true,
      account: {
        id: accId,
        name,
        maskedToken: maskToken(token),
        isActive: Boolean(isActive)
      }
    });
  } catch (err) {
    console.error('Jira accounts POST error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PUT: 활성 계정 변경 또는 토큰 수정
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, action, token, name } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: '계정 ID가 필요합니다.' }, { status: 400 });
    }

    if (action === 'setActive') {
      // 모든 계정의 is_active를 0으로 만들고 해당 계정만 1로 설정
      const tx = db.transaction((targetId) => {
        db.prepare('UPDATE jira_accounts SET is_active = 0').run();
        db.prepare('UPDATE jira_accounts SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetId);
      });
      tx(id);
      return NextResponse.json({ success: true, activeId: id });
    }

    if (action === 'updateToken') {
      if (!token) {
        return NextResponse.json({ success: false, error: '토큰이 필요합니다.' }, { status: 400 });
      }
      const enc = encryptText(token);
      db.prepare('UPDATE jira_accounts SET encrypted_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(enc, id);
      return NextResponse.json({ success: true });
    }

    if (name) {
      db.prepare('UPDATE jira_accounts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: '유효하지 않은 요청입니다.' }, { status: 400 });
  } catch (err) {
    console.error('Jira accounts PUT error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE: 계정 삭제
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '계정 ID가 필요합니다.' }, { status: 400 });
    }

    const row = db.prepare('SELECT is_active FROM jira_accounts WHERE id = ?').get(id);
    db.prepare('DELETE FROM jira_accounts WHERE id = ?').run(id);

    // 삭제된 계정이 활성 계정이었다면 남은 계정 중 하나를 활성화
    if (row && row.is_active === 1) {
      const nextRow = db.prepare('SELECT id FROM jira_accounts ORDER BY created_at ASC LIMIT 1').get();
      if (nextRow) {
        db.prepare('UPDATE jira_accounts SET is_active = 1 WHERE id = ?').run(nextRow.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Jira accounts DELETE error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
