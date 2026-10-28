import path from "node:path";
import { dreams } from "@/lib/dream";
import { serveFile } from "@/lib/serve";
import { mediaDir } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES: Record<string, { name: string; type: string }> = {
  photo: { name: "photo.png", type: "image/png" },
  film: { name: "film.mp4", type: "video/mp4" },
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const spec = FILES[kind];
  if (!spec || !(await dreams.get(id))) return new Response("Not found", { status: 404 });
  return serveFile(req, path.join(mediaDir(id), spec.name), spec.type, `tsukuyomi-${id.slice(0, 8)}.mp4`);
}
