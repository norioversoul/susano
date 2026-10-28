// Safe mode: before any GPU job, an open vision model (Qwen3.5-9B on Comfy Cloud, the same one that writes prompts)
// looks at what the user sent, photos and frames of videos in one grid plus their text, and answers SAFE or UNSAFE.
// On by default. SUSANO_SAFE_MODE=locked keeps it on and hides the switch (for a public instance).
// Every generation passes through screen(), so it also enforces SUSANO_DAILY_LIMIT (generations per day, per instance).
import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getJob, jobError, submitPrompt, uploadInput } from "./comfy";
import { contactSheet, frameAt, probeVideo } from "./media";
import { VAR_DIR } from "./store";

export type Safety = { safeMode: boolean; locked: boolean };

const SETTINGS = path.join(VAR_DIR, "settings.json");
const locked = () => process.env.SUSANO_SAFE_MODE?.trim() === "locked";

export async function safety(): Promise<Safety> {
  if (locked()) return { safeMode: true, locked: true };
  try {
    const s = JSON.parse(await fs.readFile(SETTINGS, "utf8")) as { safeMode?: boolean };
    return { safeMode: s.safeMode !== false, locked: false };
  } catch {
    return { safeMode: true, locked: false };
  }
}

export async function setSafeMode(on: boolean): Promise<Safety> {
  if (locked()) return safety();
  await fs.mkdir(VAR_DIR, { recursive: true });
  await fs.writeFile(SETTINGS, JSON.stringify({ safeMode: on }, null, 1));
  return safety();
}

/** What Safe mode (or the daily limit) turned down; the message is shown to the user as is. */
export class Unsafe extends Error {}

const USAGE = path.join(VAR_DIR, "usage.json");
const today = () => new Date().toISOString().slice(0, 10);

async function usedToday(): Promise<number> {
  try {
    const u = JSON.parse(await fs.readFile(USAGE, "utf8")) as { day?: string; count?: number };
    return u.day === today() ? u.count ?? 0 : 0;
  } catch {
    return 0;
  }
}

async function checkLimit(): Promise<void> {
  const limit = Number(process.env.SUSANO_DAILY_LIMIT) || 0;
  if (limit && (await usedToday()) >= limit) throw new Unsafe("Today's preview budget is used up. Try again tomorrow.");
}

async function countGeneration(): Promise<void> {
  await fs.mkdir(VAR_DIR, { recursive: true });
  await fs.writeFile(USAGE, JSON.stringify({ day: today(), count: (await usedToday()) + 1 }));
}

// Obvious cases never reach the GPU.
const BLOCKED = /\b(nsfw|nudes?|nudity|naked|topless|bottomless|porn\w*|hentai|xxx|sex|sexual|sexy|erotic\w*|fetish\w*|lingerie|undress\w*|genitals?|nipples?|beheading)\b/i;

const CHECK = `You are the content check of a creative video app that must stay safe for work.
The image is a grid of everything the user uploaded: photos, and frames from their videos. The user's text is below.

Unsafe means any of:
- nudity, sexual acts, sexual poses or a sexual focus on the body, also in drawings and anime
- anything sexual or suggestive involving someone who looks under 18
- graphic gore or real injuries
- hate symbols or extremist propaganda
Ordinary clothing, swimwear on a beach, sportswear, kissing, cartoon fights and action-film violence are fine.

The user's text: "{text}"

Answer with exactly one line: SAFE, or UNSAFE: followed by a short reason in plain English.`;

const POLL_MS = 2500;
const TIMEOUT_MS = 4 * 60_000;

/**
 * Throws Unsafe when Safe mode is on and the inputs aren't safe for work. Pictures and videos are local files;
 * a video is checked at four points. Fails closed: if the check itself can't run, nothing is generated.
 */
export async function screen(input: { text?: string[]; pictures?: string[]; videos?: string[] }): Promise<void> {
  await checkLimit();
  if (!(await safety()).safeMode) return countGeneration();
  const text = (input.text ?? []).map((t) => t.trim()).filter(Boolean).join(" · ").slice(0, 1500);
  if (BLOCKED.test(text)) throw new Unsafe("Safe mode is on: the text asks for something that isn't safe for work.");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "susano-safety-"));
  try {
    const images = [...(input.pictures ?? [])];
    for (const [v, video] of (input.videos ?? []).entries()) {
      const { duration } = await probeVideo(video);
      for (const [i, at] of [0.1, 0.4, 0.7, 0.95].entries()) {
        const frame = path.join(dir, `v${v}_${i}.png`);
        await frameAt(video, frame, duration * at);
        images.push(frame);
      }
    }
    // Text alone (Cinematic, Influencer from traits) is checked with a blank picture.
    const grid = path.join(dir, "grid.png");
    if (images.length) await contactSheet(images, grid);
    else await fs.copyFile(path.join(process.cwd(), "public", "safety-blank.png"), grid);

    const name = await uploadInput(await fs.readFile(grid), `safety_${randomUUID()}.png`, "image/png");
    const id = await submitPrompt({
      vlm: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3.5_9b_bf16.safetensors", type: "minimax", device: "default" } },
      grid: { class_type: "LoadImage", inputs: { image: name } },
      check: {
        class_type: "TextGenerate",
        inputs: {
          clip: ["vlm", 0], image: ["grid", 0], prompt: CHECK.replace("{text}", text.replace(/"/g, "'") || "(none)"),
          max_length: 60, sampling_mode: "off", thinking: false, use_default_template: true,
        },
      },
      show: { class_type: "PreviewAny", inputs: { source: ["check", 0] } },
    });
    const answer = await waitForText(id);
    if (/^\W*UNSAFE/i.test(answer)) {
      const why = answer.replace(/^\W*UNSAFE\W*/i, "").split("\n")[0].trim();
      throw new Unsafe(`Safe mode is on and this isn't safe for work${why ? `: ${why.replace(/\.$/, "")}` : ""}.`);
    }
    if (!/^\W*SAFE/i.test(answer)) throw new Error(`unexpected answer "${answer.slice(0, 80)}"`);
    await countGeneration();
  } catch (e) {
    if (e instanceof Unsafe) throw e;
    throw new Unsafe(`Safe mode couldn't check this, so nothing was generated. Try again in a moment. (${e instanceof Error ? e.message : String(e)})`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function waitForText(id: string): Promise<string> {
  const until = Date.now() + TIMEOUT_MS;
  while (Date.now() < until) {
    const job = await getJob(id);
    if (["failed", "error", "cancelled", "canceled"].includes(job.status)) throw new Error(jobError(job) ?? job.status);
    if (job.status === "completed" || job.status === "success") {
      return ((job.outputs?.show as { text?: string[] } | undefined)?.text?.[0] ?? "").trim();
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error("the check took too long");
}
