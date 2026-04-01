import { NextResponse } from "next/server";
import { fetchJiraSearch } from "@/lib/jiraClient";

// Controller Layer: 요청을 라우팅하고 응답 포맷을 맞춥니다.
export async function POST(request) {
  try {
    const { jql } = await request.json();
    
    // Data Access Layer 호출 (실제 로직 분리)
    const issues = await fetchJiraSearch(jql);

    return NextResponse.json({ issues });
  } catch (error) {
    // 공통 에러 핸들링
    return NextResponse.json({ error: error.message || "서버/네트워크 연결 에러" }, { status: 500 });
  }
}
