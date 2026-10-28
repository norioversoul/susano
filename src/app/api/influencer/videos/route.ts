import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { characters } from "@/lib/character";
import { VIDEO_ASPECTS } from "@/lib/influencer";
import { advanceVideo, videos } from "@/lib/influencerVideo";
import { screen, Unsafe } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await videos.list());
}

export async function POST(req: Request) {
  let body: { characterId?: unknown; scene?: unknown; aspect?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON request." }, { status: 400 });
  }
  const character = typeof body.characterId === "string" ? await characters.get(body.characterId) : undefined;
  if (character?.status !== "completed") return NextResponse.json({ error: "Pick a finished character." }, { status: 400 });
  if (typeof body.scene !== "string" || body.scene.trim().length < 3 || body.scene.length > 600) {
    return NextResponse.json({ error: "Describe the scene in 3–600 characters." }, { status: 400 });
  }
  try {
    await screen({ text: [body.scene] });
  } catch (e) {
    const unsafe = e instanceof Unsafe;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: unsafe ? 422 : 502 });
  }
  const aspect = VIDEO_ASPECTS.find((a) => a.key === body.aspect)?.key ?? "9:16";
  const video = {
    id: randomUUID(), createdAt: Date.now(), status: "queued" as const, characterId: character.id,
    scene: body.scene.replace(/\s+/g, " ").trim(), aspect, seed: Math.floor(Math.random() * 2 ** 30), jobId: "",
  };
  // Submit right away when the GPU is up; otherwise the video waits for it and polling submits it.
  await videos.add({ ...video, ...(await advanceVideo(video, character)) });
  const stored = await videos.get(video.id);
  if (stored?.status === "failed") return NextResponse.json({ error: stored.error ?? "Could not start." }, { status: 502 });
  return NextResponse.json({ id: video.id });
}
