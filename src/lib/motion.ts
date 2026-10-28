// Openjutsu motion transfer, one Comfy Cloud job, core nodes only (tested 2026-10-24):
// 1. Qwen-Image-Edit 2511 (Lightning 4-step) puts the photos' people into the first frame of the move,
//    restyled and re-staged as the prompt says ("hero frame").
// 2. SCAIL-2 in animation mode drives that hero frame with the poses of the move (SAM3 colour masks).
import { MOTION_MAX_SECONDS, placeLabel, type Quality, type Style } from "./openjutsu";

export type MotionRequest = {
  videoName: string; // the move, already at 16 fps
  photos: string[]; // at most 2 (Qwen-Image-Edit takes image2 and image3)
  prompt?: string;
  style?: Style;
  width: number;
  height: number;
  seconds: number;
  quality: Quality;
  seed: number;
};

export const MOTION_FPS = 16;

/** SCAIL-2 runs 512p or 704p, sides divisible by 32. */
export function motionSize(width: number, height: number, quality: Quality) {
  const short = quality === "high" ? 704 : 512;
  const r = width / height;
  const round = (v: number) => Math.max(32, Math.floor(v / 32) * 32);
  return r >= 1 ? { width: round(short * r), height: short } : { width: short, height: round(short / r) };
}

/** Frames for one SCAIL-2 segment: 4n+1, at most 81. */
export function motionFrames(seconds: number): number {
  const n = Math.min(81, Math.floor(Math.min(seconds, MOTION_MAX_SECONDS) * MOTION_FPS));
  return Math.max(5, n - ((n - 1) % 4));
}

export function heroPrompt(req: MotionRequest): string {
  const n = req.photos.length;
  const swaps = req.photos.map((_, i) => `${placeLabel(i, n)} in image 1 with the person from image ${i + 2}`);
  const lines = [
    n ? `Replace ${swaps.join(", and ")}.` : "Restage image 1.",
    "Keep every pose, hand position and the camera framing of image 1 exactly.",
  ];
  if (req.prompt?.trim()) lines.push(req.prompt.trim());
  lines.push(req.style ? `Render the whole image as ${req.style.look}.` : "Photorealistic.");
  return lines.join(" ");
}

export function videoPrompt(req: MotionRequest): string {
  const scene = req.prompt?.trim() || "The people perform the same movements with natural, fluid motion.";
  return `${scene} ${req.style ? `In ${req.style.look}.` : "Photorealistic, natural light."}`;
}

export const MOTION_SAVE_NODE = "save";

export function buildMotionWorkflow(req: MotionRequest) {
  const size = motionSize(req.width, req.height, req.quality);
  const frames = motionFrames(req.seconds);
  const photos: Record<string, unknown> = {};
  const editImages: Record<string, unknown> = {};
  req.photos.forEach((image, i) => {
    photos[`ref${i + 1}`] = { class_type: "LoadImage", inputs: { image } };
    editImages[`image${i + 2}`] = [`ref${i + 1}`, 0];
  });
  const resize = (input: [string, number]) => ({
    class_type: "ResizeImageMaskNode",
    inputs: {
      input, resize_type: "scale dimensions", "resize_type.width": size.width,
      "resize_type.height": size.height, "resize_type.crop": "center", scale_method: "area",
    },
  });
  const edit = heroPrompt(req);
  const nodes: Record<string, unknown> = {
    video: { class_type: "LoadVideo", inputs: { file: req.videoName } },
    parts: { class_type: "GetVideoComponents", inputs: { video: ["video", 0] } },
    clip: { class_type: "ImageFromBatch", inputs: { image: ["parts", 0], batch_index: 0, length: frames } },
    resized: resize(["clip", 0]),
    first: { class_type: "ImageFromBatch", inputs: { image: ["resized", 0], batch_index: 0, length: 1 } },
    size: { class_type: "GetImageSize", inputs: { image: ["resized", 0] } },
    ...photos,

    // stage 1: hero frame
    q_unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_fp8mixed.safetensors", weight_dtype: "default" } },
    q_aura: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["q_unet", 0], shift: 3.1 } },
    q_norm: { class_type: "CFGNorm", inputs: { model: ["q_aura", 0], strength: 1.0 } },
    q_light: { class_type: "LoraLoaderModelOnly", inputs: { model: ["q_norm", 0], lora_name: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", strength_model: 1.0 } },
    q_clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image", device: "default" } },
    q_vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
    q_scale: { class_type: "FluxKontextImageScale", inputs: { image: ["first", 0] } },
    q_pos: { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["q_clip", 0], vae: ["q_vae", 0], prompt: edit, image1: ["q_scale", 0], ...editImages } },
    q_neg: { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["q_clip", 0], vae: ["q_vae", 0], prompt: "", image1: ["q_scale", 0], ...editImages } },
    q_pos_m: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["q_pos", 0], reference_latents_method: "index_timestep_zero" } },
    q_neg_m: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["q_neg", 0], reference_latents_method: "index_timestep_zero" } },
    q_latent: { class_type: "VAEEncode", inputs: { pixels: ["q_scale", 0], vae: ["q_vae", 0] } },
    q_sample: {
      class_type: "KSampler",
      inputs: {
        model: ["q_light", 0], positive: ["q_pos_m", 0], negative: ["q_neg_m", 0], latent_image: ["q_latent", 0],
        seed: req.seed, steps: 4, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0,
      },
    },
    q_decode: { class_type: "VAEDecode", inputs: { samples: ["q_sample", 0], vae: ["q_vae", 0] } },
    hero: resize(["q_decode", 0]),
    save_hero: { class_type: "SaveImage", inputs: { images: ["hero", 0], filename_prefix: "susano_hero" } },

    // stage 2: SCAIL-2 animation mode
    sam: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sam3.1_multiplex_fp16.safetensors" } },
    human: { class_type: "CLIPTextEncode", inputs: { clip: ["sam", 1], text: "human" } },
    track_video: { class_type: "SAM3_VideoTrack", inputs: { images: ["resized", 0], model: ["sam", 0], conditioning: ["human", 0], detection_threshold: 0.5, max_objects: 4, detect_interval: 1 } },
    track_hero: { class_type: "SAM3_VideoTrack", inputs: { images: ["hero", 0], model: ["sam", 0], conditioning: ["human", 0], detection_threshold: 0.5, max_objects: 4, detect_interval: 1 } },
    masks: { class_type: "SCAIL2ColoredMask", inputs: { driving_track_data: ["track_video", 0], ref_track_data: ["track_hero", 0], object_indices: "", sort_by: "left_to_right", replacement_mode: false } },
    unet: { class_type: "UNETLoader", inputs: { unet_name: "wan2.1_14B_SCAIL_2_fp16.safetensors", weight_dtype: "default" } },
    dpo: { class_type: "LoraLoaderModelOnly", inputs: { model: ["unet", 0], lora_name: "wan2.1_SCAIL_2_DPO_lora_bf16.safetensors", strength_model: 1.0 } },
    distill: { class_type: "LoraLoaderModelOnly", inputs: { model: ["dpo", 0], lora_name: "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors", strength_model: 0.8 } },
    shift: { class_type: "ModelSamplingSD3", inputs: { model: ["distill", 0], shift: 5.0 } },
    te: { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "default" } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["te", 0], text: videoPrompt(req) } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["te", 0], text: "" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "Wan2_1_VAE_bf16.safetensors" } },
    cv: { class_type: "CLIPVisionLoader", inputs: { clip_name: "clip_vision_h.safetensors" } },
    cv_enc: { class_type: "CLIPVisionEncode", inputs: { clip_vision: ["cv", 0], image: ["hero", 0], crop: "none" } },
    scail: {
      class_type: "WanSCAILToVideo",
      inputs: {
        positive: ["pos", 0], negative: ["neg", 0], vae: ["vae", 0],
        width: ["size", 0], height: ["size", 1], length: ["size", 2], batch_size: 1,
        pose_strength: 1.0, pose_start: 0.0, pose_end: 1.0, video_frame_offset: 0, previous_frame_count: 5,
        pose_video: ["resized", 0], pose_video_mask: ["masks", 0], replacement_mode: false,
        reference_image: ["hero", 0], reference_image_mask: ["masks", 1], clip_vision_output: ["cv_enc", 0],
      },
    },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sigmas: { class_type: "BasicScheduler", inputs: { model: ["distill", 0], scheduler: "simple", steps: 6, denoise: 1.0 } },
    sample: {
      class_type: "SamplerCustom",
      inputs: {
        model: ["shift", 0], add_noise: true, noise_seed: req.seed, cfg: 1.0,
        positive: ["scail", 0], negative: ["scail", 1], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["scail", 2],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 1], vae: ["vae", 0] } },
    out: { class_type: "CreateVideo", inputs: { images: ["decode", 0], audio: ["parts", 1], fps: MOTION_FPS } },
    [MOTION_SAVE_NODE]: { class_type: "SaveVideo", inputs: { video: ["out", 0], filename_prefix: "video/susano_motion", format: "auto", codec: "auto" } },
  };
  return { prompt: nodes, text: `${edit}\n\n${videoPrompt(req)}`, size, frames };
}
