import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { advanceCharacter, characterPanels, characters, sheetFile } from "@/lib/character";
import { serveFile } from "@/lib/serve";
import { mediaDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The character's state, polled until its sheet is done. With ?image, the sheet itself; ?panel=face|body, one half. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let c = await characters.get(id);
  if (!c) return NextResponse.json({ error: "Character not found." }, { status: 404 });
  const panel = new URL(req.url).searchParams.get("panel");
  if (panel === "face" || panel === "body") {
    if (c.status !== "completed") return new Response("Not ready", { status: 409 });
    return serveFile(req, (await characterPanels(id))[panel], "image/png");
  }
  if (new URL(req.url).searchParams.has("image")) {
    if (c.status !== "completed") return new Response("Not ready", { status: 409 });
    return serveFile(req, sheetFile(id), "image/png", `${c.name.replace(/[^\w-]+/g, "_")}-sheet.png`);
  }
  if (c.status === "queued" || c.status === "running") {
    try {
      c = (await characters.update(id, await advanceCharacter(c))) ?? c;
    } catch (e) {
      return NextResponse.json({ ...c, warning: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json(c);
}

/** Remove a character from the library (its photos stay). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await characters.get(id))) return NextResponse.json({ error: "Character not found." }, { status: 404 });
  await characters.remove(id);
  await fs.rm(mediaDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
