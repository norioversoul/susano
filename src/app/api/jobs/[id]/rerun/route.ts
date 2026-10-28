import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { startJob } from "@/lib/pipeline";
import { jobs, mediaDir, type Job } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same inputs, new seed: the uploaded files are still on Comfy Cloud, so nothing is re-uploaded. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const old = await jobs.get(id);
  if (!old?.request) return NextResponse.json({ error: "This job can't be rerun." }, { status: 404 });

  const newId = randomUUID();
  const request = { ...old.request, seed: Math.floor(Math.random() * 2 ** 31) };
  try {
    const started = await startJob(request);
    // Copy the local previews (source and photos) so History can show them.
    const from = mediaDir(id);
    const to = mediaDir(newId);
    await fs.mkdir(to, { recursive: true });
    for (const f of await fs.readdir(from)) {
      if (f === "source.mp4" || /^photo_\d\.png$/.test(f)) await fs.copyFile(path.join(from, f), path.join(to, f));
    }
    const job: Job = {
      ...old, ...started, id: newId, createdAt: Date.now(), status: "queued", request, rerunOf: id,
      result: undefined, error: undefined, gpuSeconds: undefined, startedAt: undefined, finishedAt: undefined,
    };
    await jobs.add(job);
    return NextResponse.json({ id: newId });
  } catch (e) {
    return NextResponse.json({ error: `Could not start: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
