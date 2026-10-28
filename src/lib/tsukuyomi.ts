// Tsukuyomi product rules shared by the browser and the server (no secrets, no Node APIs).

/** How long a dream runs. Each segment adds about 5 s; "endless" keeps going until you wake it, up to MAX_SEGMENTS. */
export type Length = "15" | "30" | "60" | "endless";
export const LENGTHS: { key: Length; label: string; segments: number }[] = [
  { key: "15", label: "15 s", segments: 3 },
  { key: "30", label: "30 s", segments: 6 },
  { key: "60", label: "1 min", segments: 12 },
  { key: "endless", label: "Endless", segments: 24 },
];
export const MAX_SEGMENTS = 24;

/** SEEDHUNTER's Video Length widget: the first segment is 124 frames, each continuation 141 (22 of them re-drawn). */
export const SEGMENT_SECONDS = { first: 5.17, next: 5.875 };
export const OVERLAP_SECONDS = 22 / 24;

/** Seconds of film after `n` segments. A continued video starts as the clip, and every part is a continuation. */
export function filmSeconds(n: number, clipSeconds?: number): number {
  if (clipSeconds) return clipSeconds + n * (SEGMENT_SECONDS.next - OVERLAP_SECONDS);
  return n <= 0 ? 0 : SEGMENT_SECONDS.first + (n - 1) * (SEGMENT_SECONDS.next - OVERLAP_SECONDS);
}

/** A video to continue: SEEDHUNTER's 16:9 frame at 0.5 MP, and only the end of longer clips goes in. */
export const CLIP = { width: 960, height: 544, minSeconds: 2, maxSeconds: 15 };

const RATE_USD_PER_HOUR = 4.54; // RTX PRO 6000, Comfy Cloud and deployments
const CREDITS_PER_USD = 211;

/**
 * GPU time per segment measured through the app on 2026-10-27 (15 s anime fight, 286 s for 3 parts): the Qwen3.5
 * director on Comfy Cloud plus SEEDHUNTER on the deployment, about 95 s together. A cold deployment adds its start-up.
 */
export function estimate(segments: number) {
  const gpuSeconds = Math.round(segments * 95);
  const usd = (gpuSeconds / 3600) * RATE_USD_PER_HOUR;
  return { gpuSeconds, credits: Math.round(usd * CREDITS_PER_USD), usd: Math.round(usd * 100) / 100 };
}

export function creditsFor(gpuSeconds: number): number {
  return Math.round((gpuSeconds / 3600) * RATE_USD_PER_HOUR * CREDITS_PER_USD);
}

/** Open models and community work Tsukuyomi is built on; shown in the app. */
export const CREDITS: { what: string; by: string; url: string }[] = [
  { what: "SEEDHUNTER v2.51 workflow (renders every segment, unchanged)", by: "foxydits", url: "https://civitai.com/user/foxydits" },
  { what: "MiniMax H3", by: "MiniMax", url: "https://huggingface.co/Comfy-Org/MiniMax-H3" },
  { what: "Singularity ref2va v1.3", by: "WarmBloodAban", url: "https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity" },
  { what: "DMAD 4-step LoRA", by: "Kijai", url: "https://huggingface.co/Kijai/MiniMax-H3-experimental" },
  { what: "Qwen3.5 (the director)", by: "Qwen team, Alibaba", url: "https://huggingface.co/Qwen" },
  { what: "ComfyUI, Comfy Cloud and the Developer Platform", by: "Comfy Org", url: "https://comfy.org" },
];
