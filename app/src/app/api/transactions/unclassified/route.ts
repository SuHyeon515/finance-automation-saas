import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const url = `${API_BASE}/transactions/unclassified${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, { cache: "no-store" });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
