import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
  try {
    
    // 1. 부서별 유저 수 통계
    const partStats = db.prepare(`
      SELECT part, COUNT(*) as count 
      FROM users 
      GROUP BY part 
      ORDER BY count DESC
    `).all();

    // 2. 전체 등록 유저 수
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

    return NextResponse.json({ 
      partStats, 
      totalUsers 
    });
  } catch (error) {
    console.error("Stats API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
