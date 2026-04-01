import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
  try {
    const config = db.prepare("SELECT * FROM dashboard_config").all();
    const configMap = {};
    config.forEach(c => { configMap[c.key] = c.value; });
    return NextResponse.json(configMap);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { key, value } = await request.json();
    if (!key) return NextResponse.json({ error: "Key is required" }, { status: 400 });
    
    db.prepare("INSERT OR REPLACE INTO dashboard_config (key, value) VALUES (?, ?)").run(key, value);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
