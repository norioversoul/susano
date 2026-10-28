import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fetchFile } from "@/lib/comfy";
import { jobs, mediaDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES: Record<string, { name: string; type: string; legacy?: string }> = {
  source: { name: "source.mp4", type: "video/mp4" },
  result: { name: "result.mp4", type: "video/mp4" },
  // Photos were called char_N.png in the first version.
  photo_1: { name: "photo_1.png", type: "image/png", legacy: "char_1.png" },
  photo_2: { name: "photo_2.png", type: "image/png", legacy: "char_2.png" },
  photo_3: { name: "photo_3.png", type: "image/png" },
  photo_4: { name: "photo_4.png", type: "image/png" },
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const spec = FILES[kind];
  const job = spec && (await jobs.get(id));
  if (!spec || !job) return new Response("Not found", { status: 404 });
  let file = path.join(mediaDir(id), spec.name);
  if (spec.legacy) {
    try {
      await fs.access(file);
    } catch {
      file = path.join(mediaDir(id), spec.legacy);
    }
  }

  // Cache the finished video locally on first request.
  if (kind === "result") {
    try {
      await fs.access(file);
    } catch {
      if (!job.result) return new Response("Not ready", { status: 409 });
      const res = await fetchFile(job.result);
      if (!res.ok) return new Response("Comfy Cloud download failed", { status: 502 });
      const tmp = file + ".part";
      await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      await fs.rename(tmp, file);
    }
  }

  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "Content-Type": spec.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="susano-${id.slice(0, 8)}-${spec.name}"`;

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? parseInt(range[1], 10) : 0;
    const end = range[2] ? Math.min(parseInt(range[2], 10), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
