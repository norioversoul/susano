// Cinematic Studio stills: one FLUX.2 [dev] job on Comfy Cloud per image.
import "server-only";
import { getJob, jobError, nodeFiles, submitPrompt, type CloudFile } from "./comfy";
import { STILL_SIZE, type Direction } from "./cinematic";
import { fileStore } from "./store";

export type Still = {
  id: string;
  createdAt: number;
  status: "queued" | "running" | "completed" | "failed";
  scene: string;
  direction: Direction;
  prompt: string;
  seed: number;
  promptId: string;
  result?: CloudFile;
  gpuSeconds?: number;
  error?: string;
};

export const stills = fileStore<Still>("stills");

const SAVE = "save";

/** FLUX.2 [dev] text to image, as in ComfyUI's own FLUX.2 template. */
export function stillWorkflow(prompt: string, seed: number): Record<string, unknown> {
  const { width, height } = STILL_SIZE;
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "flux2_dev_fp8mixed.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "mistral_3_small_flux2_fp8.safetensors", type: "flux2", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
    text: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: prompt } },
    guidance: { class_type: "FluxGuidance", inputs: { conditioning: ["text", 0], guidance: 4.0 } },
    guider: { class_type: "BasicGuider", inputs: { model: ["unet", 0], conditioning: ["guidance", 0] } },
    latent: { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } },
    sigmas: { class_type: "Flux2Scheduler", inputs: { steps: 28, width, height } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sample: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["latent", 0] } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    [SAVE]: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "cinematic/still" } },
  };
}

export async function startStill(prompt: string, seed: number): Promise<string> {
  return submitPrompt(stillWorkflow(prompt, seed));
}

/** Poll Comfy Cloud once; returns the patch to store. */
export async function advanceStill(still: Still): Promise<Partial<Still>> {
  const cloud = await getJob(still.promptId);
  if (["failed", "error", "cancelled", "canceled"].includes(cloud.status)) {
    return { status: "failed", error: jobError(cloud) ?? `Comfy Cloud: ${cloud.status}` };
  }
  if (cloud.status !== "completed" && cloud.status !== "success") {
    return { status: cloud.status === "in_progress" || cloud.status === "running" ? "running" : "queued" };
  }
  const image = nodeFiles(cloud, SAVE)[0];
  if (!image) return { status: "failed", error: "Finished, but without an image." };
  const gpuSeconds = cloud.execution_end_time && cloud.execution_start_time
    ? Math.round((cloud.execution_end_time - cloud.execution_start_time) / 1000) : undefined;
  return { status: "completed", result: image, gpuSeconds };
}
