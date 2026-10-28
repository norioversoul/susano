import { NextResponse } from "next/server";
import { safety, setSafeMode } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await safety());
}

/** { safeMode: boolean }. Refused when the instance locks Safe mode on. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { safeMode?: unknown };
  if (typeof body.safeMode !== "boolean") return NextResponse.json({ error: "Send { safeMode: true | false }." }, { status: 400 });
  if ((await safety()).locked) return NextResponse.json({ error: "Safe mode is always on here." }, { status: 403 });
  return NextResponse.json(await setSafeMode(body.safeMode));
}
