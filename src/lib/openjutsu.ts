// Openjutsu product rules shared by the browser and the server (no secrets, no Node APIs).

export type Mode = "motion" | "swap";
export type Quality = "fast" | "high";
export type Crop = "original" | "9:16" | "16:9" | "1:1";

/** H3 handles up to ~15 s (362 frames at 24 fps). */
export const MAX_SECONDS = 15;
export const MIN_SECONDS = 2;
/** Motion transfer runs one SCAIL-2 segment (81 frames at 16 fps) for now. */
export const MOTION_MAX_SECONDS = 5;
/** Swap: photos are matched to people left to right. Motion: Qwen-Image-Edit takes two extra images. */
export const MAX_REFS: Record<Mode, number> = { swap: 4, motion: 2 };

export const QUALITIES: { key: Quality; label: string; hint: string }[] = [
  { key: "fast", label: "544p", hint: "Faster" },
  { key: "high", label: "768p", hint: "Sharper, about twice as long" },
];

export const CROPS: Crop[] = ["original", "9:16", "16:9", "1:1"];

export type Style = { key: string; name: string; look: string; swatch: string };

/** `look` completes "Transform this video into ..." for the H3 style LoRA and "Render it as ..." for motion. */
export const STYLES: Style[] = [
  { key: "anime", name: "Anime", look: "a hand-drawn 2D anime style: clean bold ink outlines, flat cel shading, vibrant saturated colours and a simple painted background", swatch: "linear-gradient(160deg,#f6c6d8,#9ec9f0)" },
  { key: "cel", name: "Hand-painted Cel", look: "hand-painted cel animation: soft painted backgrounds, clean ink lines and gentle shading", swatch: "linear-gradient(160deg,#4ad0b0,#f0d27a)" },
  { key: "clay", name: "Clay", look: "claymation stop motion: sculpted plasticine figures and sets with fingerprints in the clay and soft studio light", swatch: "linear-gradient(160deg,#d9a07a,#7a4a32)" },
  { key: "yarn", name: "Knitted Yarn", look: "a knitted yarn world: everything made of wool and knitted fabric with visible stitches", swatch: "repeating-linear-gradient(45deg,#c46a8a 0 6px,#a8506e 6px 12px)" },
  { key: "felt", name: "Felt Puppet", look: "felt puppet stop motion: fuzzy felt fabric puppets and handmade felt sets", swatch: "linear-gradient(160deg,#e0b080,#a0503a)" },
  { key: "toy", name: "Toy 3D", look: "rounded toy-like 3D animation: smooth glossy plastic shapes and soft global illumination", swatch: "linear-gradient(160deg,#6ad0c0,#2a5a8a)" },
  { key: "retro", name: "Retro Game", look: "a low-poly retro video game look with chunky pixels and flat colours", swatch: "linear-gradient(160deg,#5a3aa0,#1a1040)" },
  { key: "noir", name: "Film Noir", look: "black-and-white film noir: hard shadows, high contrast and film grain", swatch: "linear-gradient(160deg,#8a8a8a,#1a1a1a)" },
  { key: "watercolor", name: "Watercolour", look: "a loose watercolour painting with soft bleeding colours on paper texture", swatch: "linear-gradient(160deg,#c8e0f0,#e8c8d8)" },
];

export function styleByKey(key?: string | null): Style | undefined {
  return STYLES.find((s) => s.key === key);
}

/** History title for a job. */
export function titleFor(mode: Mode, photos: number, style?: string): string {
  const look = styleByKey(style)?.name;
  if (!photos) return look ? `${look} restyle` : "Restaged";
  const who = photos === 1 ? "1 person" : `${photos} people`;
  return `${mode === "motion" ? "Motion transfer" : "Openjutsu"} · ${who}${look ? ` · ${look}` : ""}`;
}

/** Where each photo goes, matched left to right. */
export function placeLabel(index: number, count: number): string {
  if (count === 1) return "the person";
  if (count === 2) return index === 0 ? "the person on the left" : "the person on the right";
  return `the ${["first", "second", "third", "fourth"][index]} person from the left`;
}

const RATE_USD_PER_HOUR = 4.54; // Comfy Cloud, RTX PRO 6000
const CREDITS_PER_USD = 211;

/**
 * Rough GPU time from our Comfy Cloud runs (2026-10-24/25):
 * Character Swap v1.1 workflow ~88 s for a 4.5 s two-person clip at 544p (incl. the Qwen3.5 descriptions),
 * SCAIL-2 motion ~82 s per 5 s segment (incl. the hero frame), H3 style ~16 s per clip second.
 */
export function estimate(mode: Mode, seconds: number, quality: Quality, refs: number, styled: boolean) {
  const q = quality === "high" ? 2 : 1;
  let gpuSeconds: number;
  if (mode === "swap" && refs > 0) gpuSeconds = 35 + 5 * refs + seconds * 12 * q;
  else if (mode === "motion" && refs > 0) gpuSeconds = 30 + 82 * q;
  else gpuSeconds = 15 + seconds * 16 * q;
  if (styled && mode === "swap" && refs > 0) gpuSeconds += 15 + seconds * 16 * q;
  gpuSeconds = Math.round(gpuSeconds);
  const usd = (gpuSeconds / 3600) * RATE_USD_PER_HOUR;
  return { gpuSeconds, credits: Math.round(usd * CREDITS_PER_USD), usd: Math.round(usd * 100) / 100 };
}

/** Open models and community work Openjutsu is built on; shown in the app. */
export const CREDITS: { what: string; by: string; url: string }[] = [
  { what: "Character Swap LoRA v1.1 and its workflow", by: "Alissonerdx", url: "https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI" },
  { what: "MiniMax H3", by: "MiniMax", url: "https://huggingface.co/Comfy-Org/MiniMax-H3" },
  { what: "DMD Ref2VA 8-step turbo LoRA", by: "drbaph", url: "https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI" },
  { what: "Qwen3.5", by: "Qwen team, Alibaba", url: "https://huggingface.co/Qwen" },
  { what: "BiRefNet", by: "ZhengPeng7", url: "https://github.com/ZhengPeng7/BiRefNet" },
  { what: "ComfyUI and Comfy Cloud", by: "Comfy Org", url: "https://comfy.org" },
];
