// Openjutsu job pipelines on Comfy Cloud. One Openjutsu job = one or more Cloud jobs (stages):
//   Object swap:      swap (Alissonerdx Character Swap v1.1 workflow) [-> style (H3 style LoRA) if a style is picked]
//   Motion transfer:  motion (Qwen-Image-Edit hero frame + SCAIL-2); a style goes into its prompts
//   Style only:       style (H3 style LoRA), when there are no photos
import "server-only";
import { fetchFile, jobError, nodeFiles, submitPrompt, uploadInput, type CloudJob } from "./comfy";
import { buildMotionWorkflow, motionSize } from "./motion";
import { styleByKey } from "./openjutsu";
import type { Job, JobRequest, Stage } from "./store";
import { buildStyleWorkflow } from "./style";
import { PROMPT_NODE, SAVE_NODE, buildSwapWorkflow, h3Size } from "./swap";

type Started = Pick<Job, "stage" | "promptId" | "prompt" | "size">;

/** Submit the first Cloud job of a pipeline. */
export async function startJob(req: JobRequest): Promise<Started> {
  const style = styleByKey(req.style);
  if (req.mode === "swap" && req.photos.length) {
    const w = buildSwapWorkflow({ ...req, instruction: req.prompt });
    return { stage: "swap", promptId: await submitPrompt(w.prompt), prompt: w.text, size: w.size };
  }
  if (req.mode === "motion" && (req.photos.length || req.prompt?.trim() || !style)) {
    const m = buildMotionWorkflow({ ...req, videoName: req.video16Name ?? req.videoName, style });
    return { stage: "motion", promptId: await submitPrompt(m.prompt), prompt: m.text, size: m.size };
  }
  if (!style) throw new Error("Nothing to do: add a photo, a prompt or a style.");
  const s = buildStyleWorkflow({ ...req, style });
  return { stage: "style", promptId: await submitPrompt(s.prompt), prompt: s.text, size: s.size };
}

function gpu(cloud: CloudJob): number {
  return cloud.execution_end_time && cloud.execution_start_time
    ? Math.round((cloud.execution_end_time - cloud.execution_start_time) / 1000)
    : 0;
}

const video = (cloud: CloudJob) => nodeFiles(cloud, SAVE_NODE).find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));

/**
 * The current stage's Cloud job has finished (successfully or not). Returns the job update: the next
 * stage's submission, the final result, or the failure.
 */
export async function advance(job: Job, cloud: CloudJob, ok: boolean): Promise<Partial<Job>> {
  const req = job.request!;
  const gpuSeconds = (job.gpuSeconds ?? 0) + gpu(cloud);
  const next = (stage: Stage, promptId: string, extra: Partial<Job> = {}): Partial<Job> => ({
    stage, promptId, status: "queued", gpuSeconds, ...extra,
  });

  if (!ok) return { status: "failed", finishedAt: Date.now(), gpuSeconds, error: jobError(cloud) ?? `Comfy Cloud: ${cloud.status}` };
  const file = video(cloud);
  if (!file) return { status: "failed", finishedAt: Date.now(), gpuSeconds, error: "Finished, but without a video." };

  // Keep the prompt H3 actually got (the template with Qwen's descriptions filled in).
  const filled = (cloud.outputs?.[PROMPT_NODE] as { text?: string[] } | undefined)?.text?.[0];
  const prompt = job.stage === "swap" && filled ? filled : job.prompt;

  const style = styleByKey(req.style);
  if (job.stage === "swap" && style) {
    // Restyle the swapped clip: it has to go back to Cloud as an input file first.
    const res = await fetchFile(file);
    if (!res.ok) throw new Error(`Could not fetch the swap result (${res.status})`);
    const name = await uploadInput(Buffer.from(await res.arrayBuffer()), `${job.id}_swapped.mp4`, "video/mp4");
    const s = buildStyleWorkflow({ ...req, videoName: name, style });
    return next("style", await submitPrompt(s.prompt), { prompt: `${prompt}\n\n${s.text}` });
  }
  return { status: "completed", finishedAt: cloud.execution_end_time ?? Date.now(), gpuSeconds, result: file, prompt };
}

/** Output size shown in the History list. */
export function outputSize(req: JobRequest) {
  return req.mode === "motion" && req.photos.length ? motionSize(req.width, req.height, req.quality) : h3Size(req.width, req.height, req.quality);
}
