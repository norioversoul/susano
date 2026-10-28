// Cinematic Studio product rules shared by the browser and the server (no secrets, no Node APIs).
// The directions and the prompt are Comfy Org's Cinematic Studio (github.com/Comfy-Org/comfy-cinematic-studio, MIT),
// unchanged. Comfy's app sends the prompt to FLUX.2 [pro] through Comfy Router, a closed model; Susano is open weights
// only, so the same prompt goes to FLUX.2 [dev] on Comfy Cloud instead.

export const choices = {
  shot: ["Wide establishing shot", "Medium shot", "Close-up portrait", "Low-angle shot", "Overhead shot"],
  camera: ["35mm lens, shallow depth of field", "Wide-angle lens, deep focus", "85mm portrait lens, soft background", "Handheld documentary camera"],
  light: ["Soft window light", "Golden-hour backlight", "Hard noon sunlight", "Blue-hour practical lights"],
  look: ["Warm cinematic film", "Cool science-fiction film", "Natural documentary color", "High-contrast noir"],
} as const;

export type Direction = { [K in keyof typeof choices]: (typeof choices)[K][number] };

export const DEFAULT_DIRECTION: Direction = {
  shot: "Wide establishing shot",
  camera: "35mm lens, shallow depth of field",
  light: "Soft window light",
  look: "Warm cinematic film",
};

export function cinematicPrompt(scene: string, direction: Direction) {
  return [direction.shot, scene.trim(), direction.camera, direction.light, direction.look]
    .filter(Boolean)
    .join(". ");
}

export function isDirection(value: unknown): value is Direction {
  if (!value || typeof value !== "object") return false;
  const direction = value as Record<string, unknown>;
  return (Object.keys(choices) as (keyof typeof choices)[]).every((key) =>
    choices[key].includes(direction[key] as never),
  );
}

/** Output size: 16:9 at about one megapixel. */
export const STILL_SIZE = { width: 1344, height: 768 };

/** 40 s on Comfy Cloud for 28 FLUX.2 [dev] steps at 1344x768 (measured 2026-10-27). */
export function estimate() {
  const gpuSeconds = 40;
  const usd = (gpuSeconds / 3600) * 4.54;
  return { gpuSeconds, credits: Math.round(usd * 211), usd: Math.round(usd * 100) / 100 };
}

export const CREDITS: { what: string; by: string; url: string }[] = [
  { what: "Cinematic Studio (directions and prompt)", by: "Comfy Org", url: "https://github.com/Comfy-Org/comfy-cinematic-studio" },
  { what: "FLUX.2 [dev]", by: "Black Forest Labs", url: "https://huggingface.co/black-forest-labs/FLUX.2-dev" },
  { what: "ComfyUI and Comfy Cloud", by: "Comfy Org", url: "https://comfy.org" },
];
