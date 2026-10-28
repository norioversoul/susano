// Influencer videos: SEEDHUNTER (Gen Mode Normal) on the Tsukuyomi deployment, plus RefMods. The two halves of the
// character sheet go in as <Picture 1> (face) and <Picture 2> (full body); RefMods turns the same two pictures into
// one identity (see addRefMod in seedhunter.ts).
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PANEL, characterPanels, type Character } from "./character";
import { DEPLOY_DONE, DEPLOY_FAILED, deployError, deployment } from "./deploy";
import { VIDEO_ASPECTS, videoPrompt, type VideoAspect } from "./influencer";
import { addRefMod, finalVideo, loadSeedhunter, setMedia, setWidgets } from "./seedhunter";
import { fileStore, mediaDir } from "./store";
import { SEGMENT_SECONDS } from "./tsukuyomi";

export type Video = {
  id: string;
  createdAt: number;
  status: "queued" | "running" | "completed" | "failed";
  characterId: string;
  scene: string;
  aspect: VideoAspect;
  seed: number;
  /** Deployment job id; empty while the deployment's GPU is still waking up. */
  jobId: string;
  waiting?: number;
  gpuSeconds?: number;
  error?: string;
};

export const videos = fileStore<Video>("influencerVideos");
export const videoFile = (id: string) => path.join(mediaDir(id), "video.mp4");

async function submit(v: Video, c: Character): Promise<string> {
  const graph = await loadSeedhunter("normal");
  setWidgets(graph, {
    seed: v.seed,
    prompt: videoPrompt(v.scene),
    seconds: SEGMENT_SECONDS.first,
    prefix: `influencer/${v.id.slice(0, 8)}`,
    aspect: VIDEO_ASPECTS.find((a) => a.key === v.aspect)?.selector,
  });
  setMedia(graph, [{ node: "zz_face", kind: "picture", ...PANEL }, { node: "zz_body", kind: "picture", ...PANEL }]);
  addRefMod(graph, `influencer_${c.id.slice(0, 8)}`, [0, 1]);

  const { face, body } = await characterPanels(c.id);
  const client = deployment("tsukuyomi");
  const wf = client.workflows.fromJson(graph);
  wf.setInput("zz_face", "value", client.assets.fromBytes(await fs.readFile(face), { filename: `${c.id.slice(0, 8)}_face.png`, contentType: "image/png" }));
  wf.setInput("zz_body", "value", client.assets.fromBytes(await fs.readFile(body), { filename: `${c.id.slice(0, 8)}_body.png`, contentType: "image/png" }));
  const job = await client.submit(wf, { metadata: { app: "influencer", video: v.id, character: c.id } });
  return job.id;
}

/** Move a video along: submit once the GPU is up, then follow the job. Returns the patch to store. */
export async function advanceVideo(v: Video, c: Character | undefined): Promise<Partial<Video>> {
  const failed = (error: string): Partial<Video> => ({ status: "failed", error });
  if (!v.jobId) {
    if (!c) return failed("The character was removed.");
    try {
      return { status: "running", jobId: await submit(v, c), waiting: undefined };
    } catch (e) {
      const reason = deployError(e);
      // A deployment that is starting (or scaled to zero and waking) is not a failure: wait for it, up to 20 minutes.
      const since = v.waiting ?? Date.now();
      if (/not ready|starting|provisioning|queued|429|503/i.test(reason) && Date.now() - since < 20 * 60_000) return { status: "queued", waiting: since };
      return failed(reason);
    }
  }
  const job = await deployment("tsukuyomi").jobs.get(v.jobId);
  if (DEPLOY_FAILED.has(job.status)) return failed(job.error ? JSON.stringify(job.error).slice(0, 400) : `SEEDHUNTER: ${job.status}`);
  if (!DEPLOY_DONE.has(job.status)) return { status: "running" };
  const out = finalVideo(job);
  if (!out) return failed("SEEDHUNTER finished without a video.");
  await fs.mkdir(mediaDir(v.id), { recursive: true });
  await out.toFile(videoFile(v.id));
  const gpuSeconds = job.startedAt && job.completedAt ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000) : undefined;
  return { status: "completed", gpuSeconds };
}
