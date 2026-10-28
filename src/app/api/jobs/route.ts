import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { castable, characterPanels } from "@/lib/character";
import { uploadInput } from "@/lib/comfy";
import { normaliseImage, normaliseVideo, probeVideo } from "@/lib/media";
import {
  CROPS, MAX_REFS, MAX_SECONDS, MIN_SECONDS, estimate, titleFor,
  type Crop, type Mode, type Quality,
} from "@/lib/openjutsu";
import { startJob } from "@/lib/pipeline";
import { jobs, mediaDir, type Job, type JobRequest } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD = 300 * 1024 * 1024;

export async function GET() {
  return NextResponse.json(await jobs.list());
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const form = await req.formData();
  // Openjutsu is object swap only for now (2026-10-25). Motion transfer and styles are switched off;
  // their pipelines stay in lib/motion.ts and lib/style.ts.
  const mode: Mode = "swap";
  const video = form.get("video");
  if (!(video instanceof File) || video.size === 0) return bad("Add a video first.");
  if (video.size > MAX_UPLOAD) return bad("The video is larger than 300 MB.");

  // Each slot is a photo (photo_N) or an Influencer character (cast_N), whose full-body half of the sheet is the photo.
  const slots: ({ file: File } | { cast: string })[] = [];
  for (let n = 1; n <= 4; n++) {
    const f = form.get(`photo_${n}`);
    const cast = String(form.get(`cast_${n}`) ?? "");
    if (f instanceof File && f.size > 0) slots.push({ file: f });
    else if (cast) slots.push({ cast });
  }
  if (slots.length > MAX_REFS.swap) return bad(`Openjutsu takes up to ${MAX_REFS.swap} people.`);

  const prompt = String(form.get("prompt") ?? "").trim().slice(0, 1500) || undefined;
  if (!slots.length) return bad("Add a photo or a character.");

  const quality: Quality = form.get("quality") === "high" ? "high" : "fast";
  const crop = (CROPS as string[]).includes(String(form.get("crop"))) ? (String(form.get("crop")) as Crop) : "original";
  const dryRun = form.get("dry_run") === "1";

  const id = randomUUID();
  const dir = mediaDir(id);
  await fs.mkdir(dir, { recursive: true });

  try {
    const rawVideo = path.join(dir, "upload" + (path.extname(video.name) || ".mp4"));
    await fs.writeFile(rawVideo, Buffer.from(await video.arrayBuffer()));
    const info = await probeVideo(rawVideo);

    // The part the user picked in the trim sheet (default: from the start).
    const start = Math.min(Math.max(0, Number(form.get("trim_start")) || 0), Math.max(0, info.duration - MIN_SECONDS));
    const end = Math.min(info.duration, Number(form.get("trim_end")) || info.duration);
    const seconds = Math.min(end - start, MAX_SECONDS);
    if (seconds < MIN_SECONDS) throw new Error(`Pick at least ${MIN_SECONDS} seconds.`);

    const sourcePath = path.join(dir, "source.mp4");
    await normaliseVideo(rawVideo, sourcePath, { start, seconds, crop, hasAudio: info.hasAudio });
    await fs.rm(rawVideo);
    const out = await probeVideo(sourcePath); // size after crop/scale

    const photoPaths: string[] = [];
    for (const [i, slot] of slots.entries()) {
      const p = path.join(dir, `photo_${i + 1}.png`);
      if ("cast" in slot) {
        const c = await castable(slot.cast);
        await normaliseImage((await characterPanels(c.id)).body, p);
      } else {
        const raw = path.join(dir, `upload_photo_${i + 1}` + (path.extname(slot.file.name) || ".png"));
        await fs.writeFile(raw, Buffer.from(await slot.file.arrayBuffer()));
        await normaliseImage(raw, p);
        await fs.rm(raw);
      }
      photoPaths.push(p);
    }

    const upload = async (file: string, type: string) =>
      dryRun ? path.basename(file) : uploadInput(await fs.readFile(file), `${id}_${path.basename(file)}`, type);
    const request: JobRequest = {
      mode,
      videoName: await upload(sourcePath, "video/mp4"),
      photos: [],
      prompt,
      width: out.width,
      height: out.height,
      seconds,
      quality,
      seed: Math.floor(Math.random() * 2 ** 31),
    };
    for (const p of photoPaths) request.photos.push(await upload(p, "image/png"));
    if (dryRun) {
      await fs.rm(dir, { recursive: true, force: true });
      return NextResponse.json({ dryRun: true, info, out, start, seconds, request });
    }

    const started = await startJob(request);
    const job: Job = {
      id,
      createdAt: Date.now(),
      status: "queued",
      mode,
      ...started,
      request,
      title: titleFor(mode, slots.length),
      refs: slots.length,
      quality,
      seconds: Math.round(seconds * 10) / 10,
      estimate: estimate(mode, seconds, quality, slots.length, false),
    };
    await jobs.add(job);
    return NextResponse.json({ id });
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    const msg = e instanceof Error ? e.message : String(e);
    return bad(`Could not start: ${msg}`, 502);
  }
}
