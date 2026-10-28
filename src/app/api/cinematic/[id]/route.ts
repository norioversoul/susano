import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { fetchFile } from "@/lib/comfy";
import { serveFile } from "@/lib/serve";
import { advanceStill, stills } from "@/lib/still";
import { mediaDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The still's state, polled until it is done. With ?image, the finished image itself. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let still = await stills.get(id);
  if (!still) return NextResponse.json({ error: "Image not found." }, { status: 404 });

  if (new URL(req.url).searchParams.has("image")) {
    if (!still.result) return new Response("Not ready", { status: 409 });
    const file = path.join(mediaDir(id), "still.png");
    try {
      await fs.access(file);
    } catch {
      const res = await fetchFile(still.result);
      if (!res.ok) return new Response("Comfy Cloud download failed", { status: 502 });
      await fs.mkdir(mediaDir(id), { recursive: true });
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    return serveFile(req, file, "image/png", `cinematic-${id.slice(0, 8)}.png`);
  }

  if (still.status === "queued" || still.status === "running") {
    try {
      still = (await stills.update(id, await advanceStill(still))) ?? still;
    } catch (e) {
      return NextResponse.json({ ...still, warning: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json(still);
}
