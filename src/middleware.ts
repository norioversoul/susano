import { NextResponse, type NextRequest } from "next/server";
import { INVITE_COOKIE, inviteCodes, validToken } from "@/lib/invite";

// Everything except the invite page itself sits behind the invite code, when one is configured.
const OPEN = ["/invite", "/api/invite", "/_next/", "/favicon.ico", "/backdrops/"];

export async function middleware(req: NextRequest) {
  if (!inviteCodes().length) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (await validToken(req.cookies.get(INVITE_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Enter your invite code first." }, { status: 401 });
  // A relative Location: behind a reverse proxy, req.nextUrl carries the server's own address (localhost:3300).
  const to = pathname === "/" ? "/invite" : `/invite?next=${encodeURIComponent(pathname + search)}`;
  return new NextResponse(null, { status: 307, headers: { Location: to } });
}

export const config = { matcher: "/((?!_next/static|_next/image).*)" };
