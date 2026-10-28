// Tiny file-backed job store (v1 is single-user). Media lives next to it under var/.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Mode, Quality } from "./openjutsu";

export const VAR_DIR = path.join(process.cwd(), "var");
const FILE = path.join(VAR_DIR, "jobs.json");

export type JobStatus = "queued" | "running" | "completed" | "failed";

/** Which Comfy Cloud job is (or was last) running for this Openjutsu job. */
export type Stage = "describe" | "swap" | "motion" | "style"; // "describe": jobs from before the v1.1 workflow

/** Everything needed to (re)submit the Cloud jobs; names are Comfy Cloud input files. */
export type JobRequest = {
  mode: Mode;
  videoName: string; // 24 fps
  video16Name?: string; // 16 fps copy for motion transfer
  frameName?: string; // first web version (Qwen3-VL describe step)
  photos: string[];
  prompt?: string;
  style?: string;
  width: number;
  height: number;
  seconds: number;
  quality: Quality;
  seed: number;
};

export type CloudFileRef = { filename: string; subfolder: string; type: string };

export type Job = {
  id: string;
  createdAt: number;
  status: JobStatus;
  mode?: Mode; // missing on jobs from the first version (all swaps)
  stage?: Stage;
  promptId: string;
  request?: JobRequest;
  slots?: string[]; // jobs from before the v1.1 workflow
  title: string;
  /** The template while describing, then what the models were told. */
  prompt: string;
  style?: string;
  refs?: number;
  quality: Quality;
  seconds: number;
  size: { width: number; height: number };
  estimate: { gpuSeconds: number; credits: number; usd: number };
  /** Set when a job was started with Rerun. */
  rerunOf?: string;
  startedAt?: number;
  finishedAt?: number;
  gpuSeconds?: number;
  error?: string;
  result?: CloudFileRef;
  /** First version only. */
  characters?: { target: string; file: string }[];
};

export function mediaDir(id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad job id");
  return path.join(VAR_DIR, "media", id);
}

let lock: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.catch(() => undefined);
  return next;
}

/** One JSON file of records under var/ (Openjutsu jobs, Tsukuyomi dreams, ...). All files share one lock. */
export function fileStore<T extends { id: string; createdAt: number }>(name: string) {
  const file = name === "jobs" ? FILE : path.join(VAR_DIR, `${name}.json`);

  async function readAll(): Promise<T[]> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T[];
    } catch {
      return [];
    }
  }

  async function writeAll(items: T[]): Promise<void> {
    await fs.mkdir(VAR_DIR, { recursive: true });
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(items, null, 1));
    await fs.rename(tmp, file);
  }

  return {
    list: () => serial(async () => (await readAll()).sort((a, b) => b.createdAt - a.createdAt)),
    get: (id: string) => serial(async () => (await readAll()).find((j) => j.id === id)),
    add: (item: T) => serial(async () => writeAll([...(await readAll()), item])),
    remove: (id: string) => serial(async () => writeAll((await readAll()).filter((j) => j.id !== id))),
    update: (id: string, patch: Partial<T>) =>
      serial(async () => {
        const all = await readAll();
        const i = all.findIndex((j) => j.id === id);
        if (i < 0) return undefined;
        all[i] = { ...all[i], ...patch };
        await writeAll(all);
        return all[i];
      }),
  };
}

export const jobs = fileStore<Job>("jobs");
