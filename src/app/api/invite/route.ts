import { NextResponse } from "next/server";
import { INVITE_COOKIE, inviteCodes, inviteToken } from "@/lib/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const valid = inviteCodes().map((c) => c.toLowerCase());
  // A short pause makes guessing codes slow.
  await new Promise((r) => setTimeout(r, 600));
  if (!code || !valid.includes(code)) return NextResponse.json({ error: "That code doesn't work. Check it and try again." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(INVITE_COOKIE, await inviteToken(code), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
