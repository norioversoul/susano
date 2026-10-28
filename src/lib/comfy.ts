// Minimal Comfy Cloud client. Server-only: the API key never reaches the browser.
import "server-only";

const BASE = process.env.COMFY_CLOUD_URL ?? "https://cloud.comfy.org";

function key(): string {
  const k = process.env.COMFY_CLOUD_API_KEY;
  if (!k) throw new Error("COMFY_CLOUD_API_KEY is not set (see .env.local.example)");
  return k;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "X-API-Key": key(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  return res;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await call(path, init);
  const text = await res.text();
  if (!res.ok) throw new ComfyError(res.status, text.slice(0, 500));
  return JSON.parse(text) as T;
}

export class ComfyError extends Error {
  constructor(public status: number, public body: string) {
    super(`Comfy Cloud ${status}: ${body}`);
  }
}

/** Upload an input file (image or video). Returns the name to use in LoadImage / LoadVideo. */
export async function uploadInput(data: Buffer, filename: string, contentType: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(data)], { type: contentType }), filename);
  form.append("type", "input");
  form.append("overwrite", "true");
  const r = await json<{ name: string }>("/api/upload/image", { method: "POST", body: form });
  return r.name;
}

export async function submitPrompt(prompt: Record<string, unknown>): Promise<string> {
  const r = await json<{ prompt_id: string; node_errors?: Record<string, unknown> }>("/api/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (r.node_errors && Object.keys(r.node_errors).length) {
    throw new ComfyError(400, JSON.stringify(r.node_errors).slice(0, 500));
  }
  return r.prompt_id;
}

export type CloudFile = { filename: string; subfolder: string; type: string };

export type CloudJob = {
  status: string; // pending | in_progress | completed | failed | ...
  create_time?: number;
  execution_start_time?: number;
  execution_end_time?: number;
  outputs?: Record<string, Record<string, unknown>>;
  execution_status?: { messages?: [string, Record<string, unknown>][] };
  /** Set when the prompt failed before running, e.g. validation. */
  execution_error?: { node_type?: string; exception_message?: string };
};

export async function getJob(promptId: string): Promise<CloudJob> {
  return json<CloudJob>(`/api/jobs/${encodeURIComponent(promptId)}`);
}

/** Video/image files saved by a node, e.g. the SaveVideo node's "images" list. */
export function nodeFiles(job: CloudJob, nodeId: string): CloudFile[] {
  const out = job.outputs?.[nodeId];
  if (!out) return [];
  const files: CloudFile[] = [];
  for (const v of Object.values(out)) {
    if (Array.isArray(v)) for (const f of v) if (f && typeof f === "object" && "filename" in f) files.push(f as CloudFile);
  }
  return files;
}

export function jobError(job: CloudJob): string | undefined {
  const m = job.execution_status?.messages?.find(([kind]) => kind === "execution_error");
  const d = (m?.[1] ?? job.execution_error) as { node_type?: string; exception_message?: string } | undefined;
  if (!d) return undefined;
  return [d.node_type, d.exception_message].filter(Boolean).join(": ").slice(0, 400);
}

export async function fetchFile(f: CloudFile): Promise<Response> {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output" });
  return call(`/api/view?${q}`);
}
