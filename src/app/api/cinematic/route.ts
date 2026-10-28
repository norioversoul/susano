import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cinematicPrompt, isDirection } from "@/lib/cinematic";
import { screen, Unsafe } from "@/lib/safety";
import { startStill, stills } from "@/lib/still";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await stills.list());
}

export async function POST(request: Request) {
  let body: { scene?: unknown; direction?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON request." }, { status: 400 });
  }
  if (typeof body.scene !== "string" || body.scene.trim().length < 3 || body.scene.length > 900) {
    return NextResponse.json({ error: "Describe the scene in 3–900 characters." }, { status: 400 });
  }
  if (!isDirection(body.direction)) {
    return NextResponse.json({ error: "Choose a supported shot, camera, light and look." }, { status: 400 });
  }
  const prompt = cinematicPrompt(body.scene, body.direction);
  const seed = Math.floor(Math.random() * 2 ** 31);
  try {
    await screen({ text: [body.scene] });
    const id = randomUUID();
    await stills.add({
      id, createdAt: Date.now(), status: "queued", scene: body.scene.trim(), direction: body.direction, prompt, seed,
      promptId: await startStill(prompt, seed),
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Unsafe) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: `Could not start: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
