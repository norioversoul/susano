// Openjutsu styles: MiniMax H3 + Alissonerdx Style Transfer LoRA (imported into the Comfy Cloud account),
// source video anchored with MiniMaxH3AddGuide so motion, framing and timing stay (tested 2026-10-24).
import type { Quality, Style } from "./openjutsu";
import { MODELS, h3Size } from "./swap";

export type StyleRequest = {
  videoName: string; // 24 fps
  style: Style;
  width: number;
  height: number;
  seconds: number;
  quality: Quality;
  seed: number;
};

export const STYLE_LORA =
  process.env.SUSANO_STYLE_LORA ?? "Alissonerdx__Minimax-H3-ComfyUI__minimax_h3_style_transfer_v1.0_r64.safetensors";
export const STYLE_SAVE_NODE = "save";

/** Largest 17k+5 frame count that the clip actually has (AddGuide crops to that grid anyway). */
function guideFrames(seconds: number): number {
  const n = Math.max(5, Math.floor(seconds * 24));
  return n - ((n - 5) % 17);
}

export function stylePrompt(style: Style): string {
  return `style_transfer: Transform this video into ${style.look}.`;
}

export function buildStyleWorkflow(req: StyleRequest) {
  const size = h3Size(req.width, req.height, req.quality);
  const frames = guideFrames(req.seconds);
  const text = stylePrompt(req.style);
  const nodes: Record<string, unknown> = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: MODELS.unet, weight_dtype: "default" } },
    shift: { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["unet", 0], shift_video: 12.0, shift_audio: 3.0 } },
    turbo: { class_type: "LoraLoaderModelOnly", inputs: { model: ["shift", 0], lora_name: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors", strength_model: 1.0 } },
    style: { class_type: "LoraLoaderModelOnly", inputs: { model: ["turbo", 0], lora_name: STYLE_LORA, strength_model: 1.0 } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "minimax", device: "default" } },
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
    r2v: {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["clip", 0], vae: ["video_vae", 0], audio_vae: ["audio_vae", 0], prompt: text,
        width: size.width, height: size.height, length: frames, ref_image_size: "match",
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
    guider: { class_type: "BasicGuider", inputs: { model: ["style", 0], conditioning: ["guide", 0] } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sigmas: { class_type: "BasicScheduler", inputs: { model: ["style", 0], scheduler: "simple", steps: 8, denoise: 1.0 } },
    sample: {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["r2v", 1] },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["video_vae", 0] } },
    decode_audio: { class_type: "VAEDecodeAudio", inputs: { samples: ["sample", 0], vae: ["audio_vae", 0] } },
    video: { class_type: "CreateVideo", inputs: { images: ["decode", 0], audio: ["decode_audio", 0], fps: 24 } },
    [STYLE_SAVE_NODE]: { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: "video/susano_style", format: "auto", codec: "auto" } },
  };
  return { prompt: nodes, text, size, frames };
}
