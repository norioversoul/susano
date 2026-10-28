// SEEDHUNTER v2.51 by foxydits, as exported from its UI (workflows/seedhunter/). Susano only sets the widgets a user
// would set; Tsukuyomi and Influencer share these helpers so both run it the same way.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Job } from "@comfyorg/sdk";

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const WORKFLOWS = path.join(process.cwd(), "workflows", "seedhunter");
/** SEEDHUNTER's final (single-pass) video, with sound. */
export const FINAL_NODE = "34";

/** Gen Mode Normal (from pictures) or Seamless Video Continuation (the film so far goes back in). */
export async function loadSeedhunter(kind: "normal" | "cont"): Promise<Graph> {
  return JSON.parse(await fs.readFile(path.join(WORKFLOWS, `${kind}.api.json`), "utf8")) as Graph;
}

/** The widgets a user sets: seed, the H3 Prompt IDE text, the video length, the frame and the output names. */
export function setWidgets(graph: Graph, o: { seed: number; prompt: string; seconds: number; prefix: string; aspect?: string }): void {
  graph["16"].inputs.seed = o.seed;
  graph["365"].inputs.prompt = o.prompt;
  graph["22:23"].inputs.value = o.seconds;
  if (o.aspect) graph["22:9"].inputs.aspect_ratio = o.aspect;
  // The author saved the LoRA as "MINIMAX\..." on Windows; on a Linux worker the Pixaroma loader would skip it.
  const loras = JSON.parse(String(graph["554"].inputs.LoraLoaderState)) as { loras: { name: string }[] };
  for (const l of loras.loras) l.name = l.name.replace(/\\/g, "/");
  graph["554"].inputs.LoraLoaderState = JSON.stringify(loras);
  for (const [k, name] of Object.entries({ "18": "take1", "134": "take2", "144": "take3", [FINAL_NODE]: "final" })) {
    graph[k].inputs.filename_prefix = `${o.prefix}_${name}`;
  }
}

/** A file for SEEDHUNTER's Media Loader (node 416). `node` is the PrimitiveString that receives its uploaded asset. */
export type MediaItem = { node: string; kind: "picture" | "video"; width: number; height: number };

/**
 * The Media Loader's state as its own UI saves it, with each file handed over as an uploaded asset: one PrimitiveString
 * per file (fill it with wf.setInput(node, "value", asset)) and a StringReplace chain that writes the names into the JSON.
 * Pictures come out of the Reference Splitter (node 417) as <Picture 1>, <Picture 2>, ... in this order.
 */
export function setMedia(graph: Graph, items: MediaItem[]): void {
  const mark = (node: string) => `__${node.toUpperCase()}__`;
  const state = items.map(({ node, kind, width, height }) => {
    const name = mark(node);
    return kind === "picture"
      ? { kind, file: name, name, duration: null, width, height, has_audio: false, audio_mode: "off" }
      : { kind, file: name, name, duration: null, width, height, has_audio: true, audio_mode: "paired" };
  });
  let last: unknown = JSON.stringify(state);
  for (const { node } of items) {
    graph[node] = { class_type: "PrimitiveString", inputs: { value: "" } };
    graph[`${node}_state`] = { class_type: "StringReplace", inputs: { string: last, find: mark(node), replace: [node, 0] } };
    last = [`${node}_state`, 0];
  }
  graph["416"].inputs.media_state = last;
}

/**
 * RefMods (Luisacaotica): Create H3 RefMod Master turns the given Media Loader pictures (0-based) into one identity, built
 * per job, and Apply H3 RefMod sits in SEEDHUNTER's own (bypassed) RefMods slot, between its conditioning switch
 * (node 471) and the samplers' guiders.
 */
export function addRefMod(graph: Graph, name: string, pictures: number[]): void {
  const refs = Object.fromEntries(pictures.map((p, i) => [`refs_image.ref_image_${i}`, ["417", p]]));
  graph.zz_identity = {
    class_type: "MiniMaxH3RefModMasterExtract",
    inputs: {
      name, mode: "Full Reference", concept_type: "identity", background_retention: 0.0,
      ref_resolution: 1024, pool_h: 16, pool_w: 16, latent_frames: 16, identity: 0, merge: false, motion_only: false,
      multiplier: 1, max_tokens: 5120, description: "", save: false, audio_max_seconds: 30.0, audio_max_tokens: 5120,
      audio_budget_policy: "error", audio_concept_type: "voice", max_total_tokens: 0, vae: ["171:2", 0],
      extraction_preset: "identity_encode", ...refs,
    },
  };
  graph.zz_refmod = {
    class_type: "MiniMaxH3RefModApply",
    inputs: { conditioning: ["471", 0], mods: ["zz_identity", 0], override: false, retention: 1.0, curve_direction: "constant", scramble_seed: -1, curve_shape: "linear", curve_value: 1.0 },
  };
  for (const [id, node] of Object.entries(graph)) {
    if (id === "zz_refmod") continue;
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v[0] === "471" && v[1] === 0) node.inputs[k] = ["zz_refmod", 0];
    }
  }
}

/** The finished video of a SEEDHUNTER job, preferring the file with sound. */
export function finalVideo(job: Job) {
  const outs = job.getOutputs(FINAL_NODE).filter((o) => o.type === "video" || /\.(mp4|webm|mov)$/i.test(o.name));
  return outs.find((o) => /-audio\.mp4$/i.test(o.name)) ?? outs[0];
}
