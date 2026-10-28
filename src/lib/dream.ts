// Tsukuyomi: an endless film, one ~5 s segment at a time. Each segment is two jobs:
//   1. direct  the Qwen3.5 director on Comfy Cloud looks at the picture (first segment) or the end of the film so far
//              and writes the next beat and its sound.
//   2. render  SEEDHUNTER v2.51 by foxydits on the Tsukuyomi deployment, run as exported from its UI: Gen Mode
//              Normal for the first segment, Seamless Video Continuation (the film so far goes back in) after that.
// The only changes to SEEDHUNTER are the widgets a user sets (seed, prompt, length) and a file handoff: PrimitiveString
// nodes carry the picture and the film as uploaded assets, and StringReplace writes their names into the Media Loader's
// media_state, the JSON its own UI would have saved. A dream that stars an Influencer character gets both halves of
// its sheet as <Picture 1> and <Picture 2>, and RefMods holds that identity in every part.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getJob, jobError, submitPrompt, uploadInput, type CloudJob } from "./comfy";
import { PANEL } from "./character";
import { DEPLOY_DONE, DEPLOY_FAILED, deployError, deployment } from "./deploy";
import { extractTail } from "./media";
import { addRefMod, finalVideo, loadSeedhunter, setMedia, setWidgets, type MediaItem } from "./seedhunter";
import { fileStore, mediaDir } from "./store";
import { CLIP, SEGMENT_SECONDS, type Length } from "./tsukuyomi";

export type DreamStatus = "queued" | "running" | "completed" | "failed";
export type Segment = { beat: string; sound: string; gpuSeconds: number };

export type Dream = {
  id: string;
  createdAt: number;
  status: DreamStatus;
  /** "The start" as the user wrote it. */
  story: string;
  length: Length;
  /** Segments to make; the user can wake the dream earlier. */
  wanted: number;
  phase: "direct" | "render";
  /** Comfy Cloud prompt id of the director job, or deployment job id of the render. */
  jobId: string;
  photoName: string; // on Comfy Cloud
  photoSize: { width: number; height: number };
  /** Set when the dream continues an uploaded video: its length in seconds. film.mp4 starts as that clip. */
  clipSeconds?: number;
  /** The Influencer character it stars. Its sheet halves are copied into the dream as face.png and body.png. */
  cast?: { id: string; name: string };
  seed: number;
  segments: Segment[];
  /** The beat being rendered right now. */
  next?: { beat: string; sound: string; gpuSeconds: number };
  /** Since when the beat waits for the deployment's GPU to come up. */
  waiting?: number;
  wake?: boolean;
  gpuSeconds: number;
  error?: string;
  finishedAt?: number;
};

export const dreams = fileStore<Dream>("dreams");

/** Seconds of the film's end the director watches. */
const TAIL_SECONDS = 2;

const DIRECTOR = `You are the director of an endless film told in continuous 5-second shots.
{premise}
Beats so far: {beats}
{look}
Write the NEXT 5-second beat for a video model, as exactly two lines:
BEAT: one paragraph, present tense, 50 to 80 words. What <Subject 1> (and anyone else in the scene) does, how the camera
moves and what changes around them. It continues directly from the last frame: same place, same lighting, same clothing,
no cut, no time jump, one continuous camera. Move the story forward a little; do not repeat earlier beats.
SOUND: the sounds of this beat, under 15 words.
Keep every shot safe for work: no nudity, sexual content or gore.
Write in English only. Output only these two lines.`;

/** SEEDHUNTER's H3 Prompt IDE text. */
const PROMPT = `subject_definitions:
{subject}

summary:
[reference generation] {story}

retention_analysis:
N/A
detailed_description:
{story}

[Shot 1]: {beat} One continuous shot, no cuts.

overall_soundscape:
{sound}

non_diegetic_music:
N/A`;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

/** Who <Subject 1> is, for the H3 Prompt IDE. */
function subject(dream: Dream): string {
  return dream.cast
    ? `<Subject 1> is ${dream.cast.name}, shown in <Picture 1> (face) and <Picture 2> (full body); their face, hair, body and outfit stay the same.`
    : "<Subject 1> is the main character shown in <Picture 1>; their face, hair and clothing stay the same. Anyone else shown in <Picture 1> keeps their look too.";
}

/** The director job for segment `n` (1-based). From segment 2 on it watches `tailName`, the end of the film so far. */
function directorGraph(dream: Dream, n: number, tailName?: string): Record<string, unknown> {
  const beats = [...dream.segments.map((s) => s.beat)];
  const look = tailName ? "The attached video is the end of the previous shot." : "This is the opening shot. The attached image shows <Subject 1>.";
  // A continued video was filmed (or made) elsewhere; the user's text says where it should go from there.
  const premise = dream.clipSeconds ? `The film so far is the user's own video. What should happen next: ${dream.story}` : `The start: ${dream.story}`;
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    vlm: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3.5_9b_bf16.safetensors", type: "minimax", device: "default" } },
    beat: {
      class_type: "TextGenerate",
      inputs: {
        clip: ["vlm", 0], prompt: fill(DIRECTOR, { premise, beats: beats.join(" | ") || "none yet", look }), max_length: 320,
        sampling_mode: "on", "sampling_mode.temperature": 0.8, "sampling_mode.top_k": 64, "sampling_mode.top_p": 0.95,
        "sampling_mode.min_p": 0.05, "sampling_mode.repetition_penalty": 1.05, "sampling_mode.seed": dream.seed + n,
        thinking: false, use_default_template: true,
      },
    },
    show: { class_type: "PreviewAny", inputs: { source: ["beat", 0] } },
  };
  if (tailName) {
    g.tail = { class_type: "LoadVideo", inputs: { file: tailName } };
    g.tail_parts = { class_type: "GetVideoComponents", inputs: { video: ["tail", 0] } };
    g.beat.inputs.video = ["tail_parts", 0];
  } else {
    g.photo = { class_type: "LoadImage", inputs: { image: dream.photoName } };
    g.ref = { class_type: "ResizeImageMaskNode", inputs: { input: ["photo", 0], resize_type: "scale total pixels", "resize_type.megapixels": 0.5, scale_method: "lanczos" } };
    g.beat.inputs.image = ["ref", 0];
  }
  return g;
}

/** "BEAT: ... SOUND: ..." from the director, with <Subject N> tags as H3 expects them. */
export function parseBeat(text: string): { beat: string; sound: string } {
  const tag = (s: string) => s.replace(/<?Subject (\d)>?/g, "<Subject $1>").replace(/\s+/g, " ").trim();
  const m = text.match(/BEAT:\s*([\s\S]*?)(?:\n?\s*SOUND:\s*([\s\S]*))?$/i);
  const beat = tag(m?.[1] ?? text);
  const sound = tag(m?.[2] ?? "") || "natural ambience of the scene";
  return { beat, sound };
}

/** Submit SEEDHUNTER for segment `n` on the deployment. */
async function submitRender(dream: Dream, n: number, beat: { beat: string; sound: string }): Promise<string> {
  const dir = mediaDir(dream.id);
  // A continued video renders every part, the first included, as a Seamless Video Continuation of film.mp4.
  const cont = n > 1 || !!dream.clipSeconds;
  const graph = await loadSeedhunter(cont ? "cont" : "normal");
  setWidgets(graph, {
    seed: dream.seed + n,
    prompt: fill(PROMPT, { subject: subject(dream), story: dream.story, beat: beat.beat, sound: beat.sound }),
    seconds: cont ? SEGMENT_SECONDS.next : SEGMENT_SECONDS.first,
    prefix: `tsukuyomi/${dream.id.slice(0, 8)}_seg${n}`,
  });

  const pictures: { item: MediaItem; file: string }[] = dream.cast
    ? [
        { item: { node: "zz_face", kind: "picture", ...PANEL }, file: "face.png" },
        { item: { node: "zz_body", kind: "picture", ...PANEL }, file: "body.png" },
      ]
    : [{ item: { node: "zz_photo", kind: "picture", ...dream.photoSize }, file: "photo.png" }];
  const film: MediaItem = { node: "zz_film", kind: "video", width: CLIP.width, height: CLIP.height };
  setMedia(graph, [...pictures.map((p) => p.item), ...(cont ? [film] : [])]);
  if (dream.cast) addRefMod(graph, `tsukuyomi_${dream.cast.id.slice(0, 8)}`, [0, 1]);

  const client = deployment("tsukuyomi");
  const wf = client.workflows.fromJson(graph);
  for (const p of pictures) {
    wf.setInput(p.item.node, "value", client.assets.fromBytes(await fs.readFile(path.join(dir, p.file)), { filename: `tsukuyomi_${p.file}`, contentType: "image/png" }));
  }
  if (cont) {
    wf.setInput("zz_film", "value", client.assets.fromBytes(await fs.readFile(path.join(dir, "film.mp4")), { filename: `film${n - 1}.mp4`, contentType: "video/mp4" }));
  }
  const job = await client.submit(wf, { metadata: { app: "tsukuyomi", dream: dream.id, segment: String(n) } });
  return job.id;
}

/** Start the director for segment `n`. */
async function direct(dream: Dream, n: number): Promise<string> {
  let tailName: string | undefined;
  if (n > 1 || dream.clipSeconds) {
    const dir = mediaDir(dream.id);
    const tail = path.join(dir, "tail.mp4");
    await extractTail(path.join(dir, "film.mp4"), tail, TAIL_SECONDS);
    tailName = await uploadInput(await fs.readFile(tail), `${dream.id}_tail${n - 1}.mp4`, "video/mp4");
  }
  return submitPrompt(directorGraph(dream, n, tailName));
}

export async function startDream(dream: Omit<Dream, "phase" | "jobId">): Promise<Dream> {
  const full: Dream = { ...dream, phase: "direct", jobId: "" };
  full.jobId = await direct(full, 1);
  return full;
}

const cloudGpu = (c: CloudJob) =>
  c.execution_end_time && c.execution_start_time ? Math.round((c.execution_end_time - c.execution_start_time) / 1000) : 0;

/** Move a dream along: called on every poll while it is open. Returns the patch to store. */
export async function advanceDream(dream: Dream): Promise<Partial<Dream>> {
  const n = dream.segments.length + 1;
  const failed = (error: string): Partial<Dream> => ({ status: "failed", error, finishedAt: Date.now() });

  if (dream.phase === "direct") {
    // The beat may already be written while the deployment was still waking up; then only the render is retried.
    let next = dream.next;
    if (!next) {
      const cloud = await getJob(dream.jobId);
      if (["failed", "error", "cancelled", "canceled"].includes(cloud.status)) return failed(jobError(cloud) ?? "The director did not answer.");
      if (cloud.status !== "completed" && cloud.status !== "success") return { status: dream.segments.length || cloud.status === "in_progress" ? "running" : "queued" };
      const text = (cloud.outputs?.show as { text?: string[] } | undefined)?.text?.[0] ?? "";
      if (!text.trim()) return failed("The director wrote nothing.");
      next = { ...parseBeat(text), gpuSeconds: cloudGpu(cloud) };
    }
    try {
      return { status: "running", phase: "render", jobId: await submitRender(dream, n, next), next, waiting: undefined };
    } catch (e) {
      const reason = deployError(e);
      // A deployment that is starting (or scaled to zero and waking) is not a failure: wait for it, up to 20 minutes.
      const since = dream.waiting ?? Date.now();
      if (/not ready|starting|provisioning|queued|429|503/i.test(reason) && Date.now() - since < 20 * 60_000) {
        return { status: "running", next, waiting: since };
      }
      return failed(reason);
    }
  }

  const client = deployment("tsukuyomi");
  const job = await client.jobs.get(dream.jobId);
  if (DEPLOY_FAILED.has(job.status)) return failed(job.error ? JSON.stringify(job.error).slice(0, 400) : `SEEDHUNTER: ${job.status}`);
  if (!DEPLOY_DONE.has(job.status)) return { status: "running" };

  const out = finalVideo(job);
  if (!out) return failed("SEEDHUNTER finished without a video.");
  const dir = mediaDir(dream.id);
  await out.toFile(path.join(dir, `film_${n}.mp4`));
  await fs.copyFile(path.join(dir, `film_${n}.mp4`), path.join(dir, "film.mp4"));

  const renderGpu = job.startedAt && job.completedAt ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000) : 0;
  const segment: Segment = { beat: dream.next?.beat ?? "", sound: dream.next?.sound ?? "", gpuSeconds: (dream.next?.gpuSeconds ?? 0) + renderGpu };
  const segments = [...dream.segments, segment];
  const gpuSeconds = dream.gpuSeconds + segment.gpuSeconds;
  if (segments.length >= dream.wanted || dream.wake) {
    return { status: "completed", segments, gpuSeconds, next: undefined, finishedAt: Date.now() };
  }
  // The next segment: the director watches the end of the film so far.
  const latest = { ...dream, segments };
  return { status: "running", phase: "direct", segments, gpuSeconds, next: undefined, jobId: await direct(latest, segments.length + 1) };
}
