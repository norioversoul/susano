import { NextResponse } from "next/server";
import { characters } from "@/lib/character";
import { advanceVideo, videoFile, videos } from "@/lib/influencerVideo";
import { serveFile } from "@/lib/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const advancing = new Set<string>();

/** The video's state, polled until it is done. With ?file, the video itself. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let v = await videos.get(id);
  if (!v) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  if (new URL(req.url).searchParams.has("file")) {
    if (v.status !== "completed") return new Response("Not ready", { status: 409 });
    return serveFile(req, videoFile(id), "video/mp4", `influencer-${id.slice(0, 8)}.mp4`);
  }
  // One advance at a time per video, so two polls never submit the same job twice.
  if ((v.status === "queued" || v.status === "running") && !advancing.has(id)) {
    advancing.add(id);
    try {
      v = (await videos.update(id, await advanceVideo(v, await characters.get(v.characterId)))) ?? v;
    } catch (e) {
      return NextResponse.json({ ...v, warning: e instanceof Error ? e.message : String(e) });
    } finally {
      advancing.delete(id);
    }
  }
  return NextResponse.json(v);
}
