import { NextResponse } from 'next/server';
import { runWorklogReports } from '@/lib/cronService';

export async function GET(request) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const forceDate = searchParams.get('forceDate');
    const forceType = searchParams.get('forceType');

    const result = await runWorklogReports({ forceDate, forceType });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
