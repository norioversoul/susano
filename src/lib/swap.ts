// Openjutsu object swap = Alissonerdx's Character Swap v1.1 native workflow, one Comfy Cloud job:
// https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI (workflows/minimax_h3_character_swap_workflow_native_nodes_v1.1.json)
//
// MiniMax H3 ref2va int8 -> SigmaShift 12/3 -> DMD ref2va 8-step turbo LoRA (drbaph) -> Character Swap v1.1 LoRA,
// CFG 1, euler / simple / 8 steps. The source video goes in as guide latents (MiniMaxH3AddGuide, frame 0) with its
// soundtrack; each photo has its background removed (BiRefNet, grey) and is scaled to 0.5 MP as <Picture N>.
// Qwen3.5-9B (core TextGenerate) describes each photo head to toe, and the description fills {details} of his
// body_swap template. With one photo the prompt is his template word for word; with several, the same template
// names one subject per photo, matched left to right (tested 2026-10-25 with two people).
import { placeLabel, type Quality } from "./openjutsu";

export type SwapRequest = {
  videoName: string; // Comfy input name, 24 fps
  /** Comfy input names of the photos; photo i replaces the i-th person from the left. */
  photos: string[];
  instruction?: string;
  width: number; // source display size, used for aspect only
  height: number;
  seconds: number;
  quality: Quality;
  seed: number;
};

/** Largest 17k+5 frame count the clip actually has (H3's frame grid at 24 fps). */
export function h3Frames(seconds: number): number {
  const n = Math.max(5, Math.floor(seconds * 24));
  return n - ((n - 5) % 17);
}

/** Generation size: keep aspect, short edge 544 (fast) or 768 (high), multiples of 32. */
export function h3Size(width: number, height: number, quality: Quality): { width: number; height: number } {
  const short = quality === "high" ? 768 : 544;
  const r = width / height;
  const round = (v: number) => Math.max(32, Math.round(v / 32) * 32);
  return r >= 1 ? { width: round(short * r), height: short } : { width: short, height: round(short / r) };
}

export const MODELS = {
  unet: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors",
  describer: "qwen3.5_9b_bf16.safetensors",
  // Imported into the Comfy Cloud account from Hugging Face; set your own names if yours differ.
  turbo: process.env.SUSANO_TURBO_LORA ?? "drbaph__MiniMax-H3-Turbo-Lora-ComfyUI__minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors",
  swapLora: process.env.SUSANO_SWAP_LORA ?? "Alissonerdx__Minimax-H3-ComfyUI__minimax_h3_character_swap_v1.1_ref2va_fro.safetensors",
};

export const SAVE_NODE = "save";
/** PreviewAny node whose text is the prompt H3 received. */
export const PROMPT_NODE = "final_prompt";

// Alissonerdx's describe instruction (docs/character-swap.md, "Describe instruction for the Shot Planner").
const DESCRIBE =
  "Describe the character in this reference picture as one comma-separated English attribute list, from head to toe, in this order: " +
  "gender, apparent height, body type, physique, shoulders, waist and proportions; head and face shape, jawline, skin tone, eye color, " +
  "distinctive facial features; hair color, style, length, texture and facial hair; upper-body clothing (garments, exact colors, fit, fabric, " +
  "collars, sleeves, buttons, zippers, pockets, logos, patterns, layers); lower-body clothing (garments, colors, materials, fit, details); " +
  "footwear (type, colors, materials, style); visible accessories (hats, glasses, earrings, necklaces, chains, watches, bracelets, rings, belts, " +
  "bags, scarves, piercings); tattoos, scars, wrinkles, makeup. Only what is clearly visible; skip what cannot be seen. Never the background, " +
  'camera, lighting or pose. Start with the gender ("Male, ..." or "Female, ..."), no article, no full stop. Only the list.';

const slot = (i: number) => `{${String.fromCharCode(97 + i)}}`;

/** His v1.1 body_swap template; {a}, {b}, ... are the photo descriptions. */
export function bodySwapTemplate(count: number): string {
  if (count === 1) {
    return (
      "body_swap: subject_definitions: <Subject 1> is the {a} shown in <Picture 1>, whose identity, face, head, hair or fur, skin, body shape, " +
      "proportions and clothing define the character in the target video. The guide video provides the scene and the performance: its background, " +
      "environment, lighting, camera, framing, body pose, hand and arm movement, head rotation, gaze direction, lip movement and facial expression, " +
      "frame by frame; only the main subject of the guide video is replaced: its face, hair, body and clothing become <Subject 1>.  summary: " +
      "[video generation + reference] Replace the guide subject with <Subject 1>, keeping the scene, camera and the complete motion and performance " +
      "of the guide video.  detailed_description: [Shot 1] <Subject 1> takes the exact place of the guide subject and moves with the same timing, " +
      "body pose, gestures, head motion, gaze, speech and facial expressions, while keeping the complete identity from <Picture 1>: facial structure, " +
      "hair or fur, skin, body shape and clothing stay stable in every frame. The background, lighting, colors and camera of the guide video are " +
      "preserved. Prevent identity drift, clothing changes, texture crawling and flicker."
    );
  }
  const idx = Array.from({ length: count }, (_, i) => i);
  const list = (xs: string[]) => `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const where = (i: number) => placeLabel(i, count);
  return (
    `body_swap: subject_definitions: ${idx.map((i) => `<Subject ${i + 1}> is the ${slot(i)} shown in <Picture ${i + 1}>`).join(", and ")}; ` +
    "their identity, face, head, hair, skin, body shape, proportions and clothing define the characters in the target video. The guide video " +
    "provides the scene and the performance: its background, environment, lighting, camera, framing, body pose, hand and arm movement, head rotation, " +
    "gaze direction, lip movement and facial expression, frame by frame; " +
    idx.map((i) => `${where(i)} of the guide video is replaced by <Subject ${i + 1}>`).join(", ") +
    `: their faces, hair, bodies and clothing become ${list(idx.map((i) => `<Subject ${i + 1}>`))}.  summary: [video generation + reference] ` +
    idx.map((i) => `Replace ${where(i)} with <Subject ${i + 1}>`).join(", ") +
    ", keeping the scene, camera and the complete motion and performance of the guide video.  detailed_description: [Shot 1] " +
    idx.map((i) => `<Subject ${i + 1}> takes the exact place of ${where(i)}`).join(", ") +
    "; all move with the same timing, body pose, gestures, head motion, gaze, speech and facial expressions, while keeping the complete identity " +
    `from ${list(idx.map((i) => `<Picture ${i + 1}>`))}: facial structure, hair, skin, body shape and clothing stay stable in every frame. ` +
    "The background, lighting, colors and camera of the guide video are preserved. Prevent identity drift, clothing changes, texture crawling and flicker."
  );
}

export function buildSwapWorkflow(req: SwapRequest): { prompt: Record<string, unknown>; text: string; frames: number; size: { width: number; height: number } } {
  const size = h3Size(req.width, req.height, req.quality);
  const frames = h3Frames(req.seconds);
  // The user's optional prompt goes after the template; doubled braces keep StringFormat from reading it as a slot.
  const extra = req.instruction?.trim() ? ` ${req.instruction.trim().replace(/[{}]/g, (b) => b + b)}` : "";
  const text = bodySwapTemplate(req.photos.length) + extra;

  const nodes: Record<string, unknown> = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    shift: { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["unet", 0], shift_video: 12.0, shift_audio: 3.0 } },
    turbo: { class_type: "LoraLoaderModelOnly", inputs: { model: ["shift", 0], lora_name: MODELS.turbo, strength_model: 1.0 } },
    swap: { class_type: "LoraLoaderModelOnly", inputs: { model: ["turbo", 0], lora_name: MODELS.swapLora, strength_model: 1.0 } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "minimax", device: "default" } },
    vlm: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.describer, type: "minimax", device: "default" } },
    video_vae: { class_type: "VAELoader", inputs: { vae_name: MODELS.videoVae } },
    audio_vae: { class_type: "VAELoader", inputs: { vae_name: MODELS.audioVae } },
    source: { class_type: "LoadVideo", inputs: { file: req.videoName } },
    parts: { class_type: "GetVideoComponents", inputs: { video: ["source", 0] } },
    clip_frames: { class_type: "ImageFromBatch", inputs: { image: ["parts", 0], batch_index: 0, length: frames } },
    frames: {
      class_type: "ResizeImageMaskNode",
      inputs: {
        input: ["clip_frames", 0], resize_type: "scale dimensions", "resize_type.width": size.width,
        "resize_type.height": size.height, "resize_type.crop": "center", scale_method: "area",
      },
    },
  };
  const values: Record<string, unknown> = {};
  const refs: Record<string, unknown> = {};
  req.photos.forEach((image, i) => {
    const n = i + 1;
    nodes[`photo_${n}`] = { class_type: "LoadImage", inputs: { image } };
    nodes[`rmbg_${n}`] = {
      class_type: "BiRefNetRMBG",
      inputs: {
        image: [`photo_${n}`, 0], model: "BiRefNet-general", mask_blur: 0, mask_offset: 0, invert_output: false,
        refine_foreground: false, background: "Color", background_color: "#808080",
      },
    };
    nodes[`ref_${n}`] = {
      class_type: "ResizeImageMaskNode",
      inputs: { input: [`rmbg_${n}`, 0], resize_type: "scale total pixels", "resize_type.megapixels": 0.5, scale_method: "lanczos" },
    };
    nodes[`details_${n}`] = {
      class_type: "TextGenerate",
      inputs: { clip: ["vlm", 0], image: [`ref_${n}`, 0], prompt: DESCRIBE, max_length: 400, sampling_mode: "off", thinking: false, use_default_template: true },
    };
    values[`values.${String.fromCharCode(96 + n)}`] = [`details_${n}`, 0];
    refs[`ref_images.ref_image_${i}`] = [`ref_${n}`, 0];
  });
  Object.assign(nodes, {
    prompt_text: { class_type: "StringFormat", inputs: { f_string: text, ...values } },
    [PROMPT_NODE]: { class_type: "PreviewAny", inputs: { source: ["prompt_text", 0] } },
    r2v: {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["clip", 0], vae: ["video_vae", 0], audio_vae: ["audio_vae", 0], prompt: ["prompt_text", 0],
        width: size.width, height: size.height, length: frames, ref_image_size: "match", ...refs,
      },
    },
    guide: {
      class_type: "MiniMaxH3AddGuide",
      inputs: {
        positive: ["r2v", 0], latent: ["r2v", 1], frame_idx: 0, vae: ["video_vae", 0],
        audio_vae: ["audio_vae", 0], image: ["frames", 0], audio: ["parts", 1],
      },
    },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: req.seed } },
    guider: { class_type: "CFGGuider", inputs: { model: ["swap", 0], positive: ["guide", 0], negative: ["guide", 0], cfg: 1.0 } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sigmas: { class_type: "BasicScheduler", inputs: { model: ["swap", 0], scheduler: "simple", steps: 8, denoise: 1.0 } },
    sample: {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["r2v", 1] },
    },
    split: { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["sample", 0] } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["split", 0], vae: ["video_vae", 0] } },
    video: { class_type: "CreateVideo", inputs: { images: ["decode", 0], audio: ["parts", 1], fps: 24 } },
    [SAVE_NODE]: { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: "video/susano_swap", format: "auto", codec: "auto" } },
  });
  return { prompt: nodes, text, frames, size };
}
