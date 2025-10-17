import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export async function POST(req: NextRequest){
  const body = await req.json();
  const r = await fetch(`${API_BASE}/gpt/salon-analysis`, {
    method:"POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
