// Reshoot: Comfy Org's Reshoot app (github.com/Comfy-Org/comfy-reshoot, MIT), ported 1:1 onto Susano's server.
// Its two workflows (workflows/reshoot/) run on the Reshoot deployment: "analyze" estimates depth with MoGe and returns
// a .cvgeo file for the browser's camera preview; "generate" warps the clip to the new camera with CrossView Warp and
// lets MiniMax H3 with Cseti's CrossView LoRA fill in what the original camera never saw.
// It shares the Tsukuyomi deployment. One change to Comfy's generate workflow: its video VAE is loaded from
// vae/comfy-org/, because that Build also carries Kijai's different file under the same name in vae/.
import "server-only";
import { join } from "node:path";
import type { Job } from "@comfyorg/sdk";
import { deployment } from "./deploy";

export type JobOutput = { id: string; name: string; type: string; url: string };
export type PublicJob = { id: string; status: string; outputs: JobOutput[]; error: unknown };

export type ReshootSettings = { aspect: string; megapixels: number; azimuth: number; elevation: number; distance: number; prompt: string };

function publicJob(job: Job): PublicJob {
  return {
    id: job.id,
    status: job.status,
    outputs: job.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      type: output.type,
      url: `/api/reshoot/${job.id}/outputs/${output.id}`,
    })),
    error: job.error,
  };
}

export async function submitWorkflow(video: File, step: "analyze" | "generate", settings: ReshootSettings) {
  const comfy = deployment("reshoot");
  const workflow = await comfy.workflows.fromFile(join(process.cwd(), "workflows", "reshoot", `${step}.api.json`));
  const asset = comfy.assets.fromBytes(new Uint8Array(await video.arrayBuffer()), {
    filename: video.name,
    contentType: video.type || "video/mp4",
  });
  workflow.setInput("1", "file", asset);
  workflow.setInput("2", "duration", 15);
  workflow.setInput("2", "aspect_ratio", settings.aspect);
  workflow.setInput("2", "megapixels", settings.megapixels);

  if (step === "generate") {
    workflow.setInput("5", "azimuth", settings.azimuth);
    workflow.setInput("5", "elevation", settings.elevation);
    workflow.setInput("5", "distance", settings.distance);
    workflow.setInput("20", "prompt", settings.prompt.trim() ? `crossview. ${settings.prompt.trim()}` : "crossview.");
  }

  return publicJob(await comfy.submit(workflow, { metadata: { app: "reshoot", step } }));
}

export async function getJob(id: string) {
  return publicJob(await deployment("reshoot").jobs.get(id));
}

export async function getOutput(jobId: string, outputId: string) {
  const job = await deployment("reshoot").jobs.get(jobId);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  if (!output) throw new Error("Output not found on this job.");
  const { url } = await output.getDownloadUrl();
  return fetch(url);
}

/** A readable reason for a failed job; a missing node means the deployment's Build lacks the CrossView pack. */
export function jobErrorMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
        ? (Reflect.get(error, "message") as string)
        : "";
  const missingNode = message.match(/Node ['"]([^'"]+)['"] not found/i)?.[1];
  if (missingNode) {
    return `The Reshoot deployment is missing the “${missingNode}” node. Add the CrossView node pack to its Build, publish a release and redeploy.`;
  }
  return message || "Comfy could not run this workflow. Check the deployment logs and try again.";
}
