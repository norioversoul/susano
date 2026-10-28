import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { characters, photos, startFlux } from "@/lib/character";
import { ASPECTS, photoPrompt } from "@/lib/influencer";
import { screen, Unsafe } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await photos.list());
}

export async function POST(req: Request) {
  let body: { characterId?: unknown; scene?: unknown; aspect?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON request." }, { status: 400 });
  }
  const character = typeof body.characterId === "string" ? await characters.get(body.characterId) : undefined;
  if (!character?.sheetName) return NextResponse.json({ error: "Pick a finished character." }, { status: 400 });
  if (typeof body.scene !== "string" || body.scene.trim().length < 3 || body.scene.length > 600) {
    return NextResponse.json({ error: "Describe the scene in 3–600 characters." }, { status: 400 });
  }
  const aspect = ASPECTS.find((a) => a.key === body.aspect) ?? ASPECTS[0];
  const scene = body.scene.replace(/\s+/g, " ").trim();
  const prompt = photoPrompt(scene);
  const seed = Math.floor(Math.random() * 2 ** 31);
  try {
    await screen({ text: [scene] });
    const id = randomUUID();
    await photos.add({
      id, createdAt: Date.now(), status: "queued", characterId: character.id, scene, aspect: aspect.key, prompt, seed,
      promptId: await startFlux({ prompt, seed, width: aspect.width, height: aspect.height, refs: [character.sheetName], prefix: "influencer/photo" }),
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Unsafe) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: `Could not start: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
