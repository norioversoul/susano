// Normalise uploaded media before it goes to the models: fixed fps, rotation applied, trimmed, sane size.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import type { Crop } from "./openjutsu";

const run = promisify(execFile);

export const H3_FPS = 24;

export type VideoInfo = { width: number; height: number; duration: number; hasAudio: boolean };

/** Display size (rotation applied) and duration. */
export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await run(ffprobe.path, [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
  ], { maxBuffer: 1 << 24 });
  const d = JSON.parse(stdout) as {
    streams: { codec_type: string; width: number; height: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
    format: { duration: string };
  };
  const s = d.streams.find((x) => x.codec_type === "video");
  if (!s) throw new Error("No video track found.");
  // Older ffprobe builds report rotation as a tag, newer ones as display-matrix side data.
  const raw = s.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? Number(s.tags?.rotate ?? 0);
  const rot = Math.abs(raw) % 180;
  const [width, height] = rot === 90 ? [s.height, s.width] : [s.width, s.height];
  return { width, height, duration: parseFloat(d.format.duration), hasAudio: d.streams.some((x) => x.codec_type === "audio") };
}

/** ffmpeg crop expression for a centred crop to the given aspect ratio. */
function cropFilter(crop: Crop): string | null {
  if (crop === "original") return null;
  const [w, h] = crop.split(":").map(Number);
  const a = w / h;
  return `crop='trunc(min(iw,ih*${a})/2)*2':'trunc(min(ih,iw/${a})/2)*2'`;
}

/** Re-encode the chosen part (start, seconds) to H.264 + AAC at `fps`, rotation baked in, optional crop, short edge <= 1080. */
export async function normaliseVideo(
  input: string, output: string,
  opts: { start: number; seconds: number; crop: Crop; fps?: number; hasAudio: boolean; size?: { width: number; height: number } },
): Promise<void> {
  // `size` crops to exactly that frame (centred) and scales to it, e.g. SEEDHUNTER's 960x544 for a Tsukuyomi clip.
  const { size } = opts;
  const frame = size
    ? [`crop='trunc(min(iw,ih*${size.width}/${size.height})/2)*2':'trunc(min(ih,iw*${size.height}/${size.width})/2)*2'`, `scale=${size.width}:${size.height}`, "setsar=1"]
    : [cropFilter(opts.crop), "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'"];
  const filters = [`fps=${opts.fps ?? H3_FPS}`, ...frame];
  // H3 conditions on the soundtrack too, so silent clips get a silent track.
  const silence = opts.hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", "-ss", opts.start.toFixed(3), "-i", input, ...silence, "-t", opts.seconds.toFixed(3), "-shortest",
    "-map", "0:v:0", "-map", opts.hasAudio ? "0:a:0" : "1:a:0",
    "-vf", filters.filter(Boolean).join(","),
    "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", output,
  ], { maxBuffer: 1 << 24 });
}

/** One still from the (already normalised) video, a third of the way in, as PNG. */
export async function extractFrame(input: string, output: string, seconds: number): Promise<void> {
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", "-ss", (seconds / 3).toFixed(3), "-i", input, "-frames:v", "1", output,
  ]);
}

/** The very last frame of a video, as PNG (who a continued Tsukuyomi dream is about, when no picture was added). */
export async function extractLastFrame(input: string, output: string): Promise<void> {
  await run(ffmpegPath as unknown as string, [
    // Decode the last second and keep overwriting the still, so it ends on the true last frame even if audio runs longer.
    "-v", "error", "-y", "-sseof", "-1", "-i", input, "-an", "-update", "1", output,
  ]);
}

/** The last `seconds` of a video, re-encoded (the director watches only the end of the film so far). */
export async function extractTail(input: string, output: string, seconds: number): Promise<void> {
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", "-sseof", `-${seconds.toFixed(3)}`, "-i", input,
    "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", output,
  ]);
}

/** A rectangle of an image as PNG, e.g. one panel of an Influencer character sheet. */
export async function cropImage(input: string, output: string, r: { x: number; y: number; width: number; height: number }): Promise<void> {
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", "-i", input, "-vf", `crop=${r.width}:${r.height}:${r.x}:${r.y}`, "-frames:v", "1", output,
  ]);
}

/** Pixel size of an image file. */
export async function probeImage(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run(ffprobe.path, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file]);
  const s = (JSON.parse(stdout) as { streams: { width: number; height: number }[] }).streams[0];
  if (!s) throw new Error("This picture can't be read.");
  return { width: s.width, height: s.height };
}

/** Re-encode a reference photo to PNG with EXIF rotation applied, long edge <= 2048. */
export async function normaliseImage(input: string, output: string): Promise<void> {
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", "-i", input,
    "-vf", "scale='if(gt(iw,ih),min(2048,iw),-2)':'if(gt(iw,ih),-2,min(2048,ih))'",
    "-frames:v", "1", output,
  ]);
}

/** One frame at `at` seconds, as PNG. */
export async function frameAt(input: string, output: string, at: number): Promise<void> {
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", "-ss", Math.max(0, at).toFixed(3), "-i", input, "-frames:v", "1", output,
  ]);
}

/** Up to nine pictures in a grid of 384 px squares, as PNG: everything Safe mode checks, in one picture. */
export async function contactSheet(images: string[], output: string): Promise<void> {
  const files = images.slice(0, 9);
  if (!files.length) throw new Error("Nothing to check.");
  const tile = 384;
  const scaled = files.map((_, i) =>
    `[${i}:v]scale=${tile}:${tile}:force_original_aspect_ratio=decrease,pad=${tile}:${tile}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=rgb24[s${i}]`);
  const layout = files.map((_, i) => `${(i % 3) * tile}_${Math.floor(i / 3) * tile}`).join("|");
  const grid = files.length === 1
    ? "[s0]null[out]"
    : `${files.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`;
  await run(ffmpegPath as unknown as string, [
    "-v", "error", "-y", ...files.flatMap((f) => ["-i", f]),
    "-filter_complex", [...scaled, grid].join(";"), "-map", "[out]", "-frames:v", "1", output,
  ]);
}
