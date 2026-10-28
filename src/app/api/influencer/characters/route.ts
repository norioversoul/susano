import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { characters, startFlux } from "@/lib/character";
import { uploadInput } from "@/lib/comfy";
import { MAX_REFS, SHEET_SIZE, cleanTraits, sheetPrompt } from "@/lib/influencer";
import { normaliseImage } from "@/lib/media";
import { screen, Unsafe } from "@/lib/safety";
import { mediaDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD = 30 * 1024 * 1024;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  return NextResponse.json(await characters.list());
}

export async function POST(req: Request) {
  const form = await req.formData();
  let traits;
  try {
    traits = cleanTraits(JSON.parse(String(form.get("traits") ?? "{}")));
  } catch {
    return bad("The traits could not be read.");
  }
  const refs = form.getAll("refs").filter((f): f is File => f instanceof File && f.size > 0);
  if (refs.length > MAX_REFS) return bad(`Add at most ${MAX_REFS} reference photos.`);
  if (refs.some((f) => f.size > MAX_UPLOAD)) return bad("A photo is larger than 30 MB.");
  // A character made from photos of a real person needs that person's consent.
  if (refs.length && form.get("consent") !== "yes") return bad("Confirm that this is you, or that you have this person's permission.");
  if (!refs.length && !Object.keys(traits).length) return bad("Pick a few traits or add a photo.");
  const extra = String(form.get("extra") ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "Untitled";

  const id = randomUUID();
  const dir = mediaDir(id);
  await fs.mkdir(dir, { recursive: true });
  try {
    const refNames: string[] = [];
    for (const [i, f] of refs.entries()) {
      const raw = path.join(dir, `ref${i}_upload${path.extname(f.name) || ".png"}`);
      await fs.writeFile(raw, Buffer.from(await f.arrayBuffer()));
      const png = path.join(dir, `ref${i}.png`);
      await normaliseImage(raw, png);
      await fs.rm(raw);
      refNames.push(await uploadInput(await fs.readFile(png), `${id}_ref${i}.png`, "image/png"));
    }
    await screen({ text: [name, extra], pictures: refs.map((_, i) => path.join(dir, `ref${i}.png`)) });
    const prompt = sheetPrompt(traits, extra, refNames.length > 0);
    const seed = Math.floor(Math.random() * 2 ** 31);
    await characters.add({
      id, createdAt: Date.now(), status: "queued", name, source: refNames.length ? "image" : "traits", traits, extra, prompt, seed, refNames,
      promptId: await startFlux({ prompt, seed, ...SHEET_SIZE, refs: refNames, prefix: "influencer/sheet" }),
    });
    return NextResponse.json({ id });
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    if (e instanceof Unsafe) return bad(e.message, 422);
    return bad(`Could not start: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
