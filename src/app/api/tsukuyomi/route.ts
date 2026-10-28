import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { castable, characterPanels } from "@/lib/character";
import { uploadInput } from "@/lib/comfy";
import { dreams, startDream } from "@/lib/dream";
import { extractLastFrame, normaliseImage, normaliseVideo, probeImage, probeVideo } from "@/lib/media";
import { mediaDir } from "@/lib/store";
import { CLIP, LENGTHS, type Length } from "@/lib/tsukuyomi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD = 30 * 1024 * 1024;
const MAX_VIDEO = 300 * 1024 * 1024;

export async function GET() {
  return NextResponse.json(await dreams.list());
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const file = (v: FormDataEntryValue | null) => (v instanceof File && v.size > 0 ? v : null);

export async function POST(req: Request) {
  const form = await req.formData();
  // A dream starts from a picture or an Influencer character, or continues a video (who it is about is then optional).
  const video = file(form.get("video"));
  const castId = String(form.get("character") ?? "") || null;
  const picture = castId ? null : file(form.get("picture"));
  if (!video && !picture && !castId) return bad("Add a picture of who the dream is about.");
  if (picture && picture.size > MAX_UPLOAD) return bad("The picture is larger than 30 MB.");
  if (video && video.size > MAX_VIDEO) return bad("The video is larger than 300 MB.");
  const story = String(form.get("story") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (story.length < 10) return bad(video ? "Write what happens next, in a sentence or two." : "Write how it starts, in a sentence or two.");
  const length = LENGTHS.find((l) => l.key === form.get("length")) ?? LENGTHS[0];

  let cast: { id: string; name: string } | undefined;
  if (castId) {
    try {
      const c = await castable(castId);
      cast = { id: c.id, name: c.name };
    } catch (e) {
      return bad(e instanceof Error ? e.message : String(e));
    }
  }

  const id = randomUUID();
  const dir = mediaDir(id);
  await fs.mkdir(dir, { recursive: true });
  try {
    const photo = path.join(dir, "photo.png");
    let clipSeconds: number | undefined;
    if (video) {
      const raw = path.join(dir, "upload" + (path.extname(video.name) || ".mp4"));
      await fs.writeFile(raw, Buffer.from(await video.arrayBuffer()));
      const info = await probeVideo(raw);
      if (!(info.duration >= CLIP.minSeconds)) {
        await fs.rm(dir, { recursive: true, force: true });
        return bad(`The video needs at least ${CLIP.minSeconds} seconds to continue from.`);
      }
      // Only the end matters for what comes next, so longer clips keep their last 15 s.
      clipSeconds = Math.min(info.duration, CLIP.maxSeconds);
      await normaliseVideo(raw, path.join(dir, "film.mp4"), {
        start: info.duration - clipSeconds, seconds: clipSeconds, crop: "original", hasAudio: info.hasAudio,
        size: { width: CLIP.width, height: CLIP.height },
      });
      clipSeconds = (await probeVideo(path.join(dir, "film.mp4"))).duration;
      await fs.rm(raw);
      if (!picture && !cast) await extractLastFrame(path.join(dir, "film.mp4"), photo);
    }
    if (cast) {
      // The dream keeps its own copy, so it still runs if the character is removed later. The full body is its picture.
      const { face, body } = await characterPanels(cast.id);
      await fs.copyFile(face, path.join(dir, "face.png"));
      await fs.copyFile(body, path.join(dir, "body.png"));
      await fs.copyFile(body, photo);
    }
    if (picture) {
      const raw = path.join(dir, "picture" + (path.extname(picture.name) || ".png"));
      await fs.writeFile(raw, Buffer.from(await picture.arrayBuffer()));
      await normaliseImage(raw, photo);
      await fs.rm(raw);
    }

    const dream = await startDream({
      id,
      createdAt: Date.now(),
      status: "queued",
      story,
      length: length.key as Length,
      wanted: length.segments,
      photoName: await uploadInput(await fs.readFile(photo), `${id}_photo.png`, "image/png"),
      photoSize: await probeImage(photo),
      clipSeconds,
      cast,
      seed: Math.floor(Math.random() * 2 ** 30),
      segments: [],
      gpuSeconds: 0,
    });
    await dreams.add(dream);
    return NextResponse.json({ id });
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    return bad(`Could not start: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
