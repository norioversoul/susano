import { NextResponse } from "next/server";
import { advancePhoto, photoFile, photos } from "@/lib/character";
import { serveFile } from "@/lib/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The photo's state, polled until it is done. With ?image, the photo itself. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let p = await photos.get(id);
  if (!p) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  if (new URL(req.url).searchParams.has("image")) {
    if (p.status !== "completed") return new Response("Not ready", { status: 409 });
    return serveFile(req, photoFile(id), "image/png", `influencer-${id.slice(0, 8)}.png`);
  }
  if (p.status === "queued" || p.status === "running") {
    try {
      p = (await photos.update(id, await advancePhoto(p))) ?? p;
    } catch (e) {
      return NextResponse.json({ ...p, warning: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json(p);
}
