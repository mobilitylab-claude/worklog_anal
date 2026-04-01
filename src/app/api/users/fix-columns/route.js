import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST() {
  try {
    // 소속파트와 이메일을 서로 맞바꾸는 쿼리
    // SQLite에서 한 번에 맞바꾸려면 임시 컬럼을 쓰거나 다음과 같이 처리 가능
    db.exec(`
      UPDATE users SET 
        part = email, 
        email = part
    `);
    
    return NextResponse.json({ success: true, message: "기존 데이터의 파트와 이메일을 스왑 완료했습니다." });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
