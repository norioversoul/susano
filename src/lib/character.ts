// Influencer characters and their photos: FLUX.2 [dev] jobs on Comfy Cloud. A sheet is text to image, or image to image
// from the user's reference photos; a photo uses the finished sheet as its reference (ReferenceLatent, as in ComfyUI's
// own FLUX.2 image edit template).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchFile, getJob, jobError, nodeFiles, submitPrompt, uploadInput, type CloudFile } from "./comfy";
import { SHEET_SIZE, type Aspect, type Traits } from "./influencer";
import { cropImage } from "./media";
import { fileStore, mediaDir } from "./store";

type Status = "queued" | "running" | "completed" | "failed";

export type Character = {
  id: string;
  createdAt: number;
  status: Status;
  name: string;
  source: "traits" | "image";
  traits: Traits;
  extra: string;
  prompt: string;
  seed: number;
  promptId: string;
  /** Reference photos as uploaded to Comfy Cloud (source "image"). */
  refNames: string[];
  /** The finished sheet, uploaded back to Comfy Cloud as an input so photos can load it. */
  sheetName?: string;
  gpuSeconds?: number;
  error?: string;
};

export type Photo = {
  id: string;
  createdAt: number;
  status: Status;
  characterId: string;
  scene: string;
  aspect: Aspect;
  prompt: string;
  seed: number;
  promptId: string;
  gpuSeconds?: number;
  error?: string;
};

export const characters = fileStore<Character>("characters");
export const photos = fileStore<Photo>("photos");

const SAVE = "save";

/** FLUX.2 [dev] with zero or more reference images, each chained in through ReferenceLatent. */
export function fluxWorkflow(o: { prompt: string; seed: number; width: number; height: number; refs: string[]; prefix: string }) {
  const g: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "flux2_dev_fp8mixed.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "mistral_3_small_flux2_fp8.safetensors", type: "flux2", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
    text: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: o.prompt } },
  };
  let cond: [string, number] = ["text", 0];
  o.refs.forEach((name, i) => {
    g[`ref${i}`] = { class_type: "LoadImage", inputs: { image: name } };
    g[`ref${i}_scaled`] = { class_type: "ImageScaleToTotalPixels", inputs: { image: [`ref${i}`, 0], upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 1 } };
    g[`ref${i}_latent`] = { class_type: "VAEEncode", inputs: { pixels: [`ref${i}_scaled`, 0], vae: ["vae", 0] } };
    g[`ref${i}_cond`] = { class_type: "ReferenceLatent", inputs: { conditioning: cond, latent: [`ref${i}_latent`, 0] } };
    cond = [`ref${i}_cond`, 0];
  });
  Object.assign(g, {
    guidance: { class_type: "FluxGuidance", inputs: { conditioning: cond, guidance: 4.0 } },
    guider: { class_type: "BasicGuider", inputs: { model: ["unet", 0], conditioning: ["guidance", 0] } },
    latent: { class_type: "EmptyFlux2LatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    sigmas: { class_type: "Flux2Scheduler", inputs: { steps: 28, width: o.width, height: o.height } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: o.seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sample: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["latent", 0] } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    [SAVE]: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: o.prefix } },
  });
  return g;
}

export const startFlux = (o: Parameters<typeof fluxWorkflow>[0]) => submitPrompt(fluxWorkflow(o));

/** Poll one Comfy Cloud image job. When it is done, the image is saved locally as `file`. */
async function advanceImage(promptId: string, file: string): Promise<{ status: Status; gpuSeconds?: number; error?: string; result?: CloudFile }> {
  const cloud = await getJob(promptId);
  if (["failed", "error", "cancelled", "canceled"].includes(cloud.status)) return { status: "failed", error: jobError(cloud) ?? `Comfy Cloud: ${cloud.status}` };
  if (cloud.status !== "completed" && cloud.status !== "success") return { status: cloud.status === "in_progress" || cloud.status === "running" ? "running" : "queued" };
  const image = nodeFiles(cloud, SAVE)[0];
  if (!image) return { status: "failed", error: "Finished, but without an image." };
  const res = await fetchFile(image);
  if (!res.ok) throw new Error("Comfy Cloud download failed");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  const gpuSeconds = cloud.execution_end_time && cloud.execution_start_time ? Math.round((cloud.execution_end_time - cloud.execution_start_time) / 1000) : undefined;
  return { status: "completed", gpuSeconds, result: image };
}

export const sheetFile = (id: string) => path.join(mediaDir(id), "sheet.png");
export const photoFile = (id: string) => path.join(mediaDir(id), "photo.png");

/** One half of the sheet: the face on the left, the full body on the right. */
export const PANEL = { width: SHEET_SIZE.width / 2, height: SHEET_SIZE.height };

/** The sheet's face and full-body halves, cut once per character. Every app that casts the character uses these. */
export async function characterPanels(id: string): Promise<{ face: string; body: string }> {
  const face = path.join(mediaDir(id), "face.png");
  const body = path.join(mediaDir(id), "body.png");
  try {
    await fs.access(body);
  } catch {
    await cropImage(sheetFile(id), face, { x: 0, y: 0, ...PANEL });
    await cropImage(sheetFile(id), body, { x: PANEL.width, y: 0, ...PANEL });
  }
  return { face, body };
}

/** A finished character, or the reason it can't be cast. */
export async function castable(id: string): Promise<Character> {
  const c = await characters.get(id);
  if (!c) throw new Error("That character was removed.");
  if (c.status !== "completed") throw new Error(`${c.name} isn't ready yet.`);
  return c;
}

export async function advanceCharacter(c: Character): Promise<Partial<Character>> {
  const r = await advanceImage(c.promptId, sheetFile(c.id));
  if (r.status !== "completed") return { status: r.status, error: r.error };
  // Photos load the sheet as an input image.
  const sheetName = await uploadInput(await fs.readFile(sheetFile(c.id)), `${c.id}_sheet.png`, "image/png");
  return { status: "completed", gpuSeconds: r.gpuSeconds, sheetName };
}

export async function advancePhoto(p: Photo): Promise<Partial<Photo>> {
  const r = await advanceImage(p.promptId, photoFile(p.id));
  return { status: r.status, error: r.error, gpuSeconds: r.gpuSeconds };
}
