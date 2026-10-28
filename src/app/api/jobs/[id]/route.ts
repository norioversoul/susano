import { NextResponse } from "next/server";
import { getJob, jobError, nodeFiles } from "@/lib/comfy";
import { advance } from "@/lib/pipeline";
import { jobs, type Job } from "@/lib/store";
import { SAVE_NODE } from "@/lib/swap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["completed", "failed"]);
const DONE = new Set(["completed", "success"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);

// Jobs whose next stage is being submitted, so overlapping polls never submit it twice.
const advancing = new Set<string>();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job = await jobs.get(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (TERMINAL.has(job.status) || advancing.has(id)) return NextResponse.json(job);

  try {
    const cloud = await getJob(job.promptId);
    const s = cloud.status;
    let patch: Partial<Job> = {};
    if (cloud.execution_start_time && !job.startedAt) patch.startedAt = cloud.execution_start_time;

    if (DONE.has(s) || FAILED.has(s)) {
      if (job.request) {
        advancing.add(id);
        try {
          patch = { ...patch, ...(await advance(job, cloud, DONE.has(s))) };
        } finally {
          advancing.delete(id);
        }
      } else {
        // Jobs from the first version: a single H3 swap job.
        const file = nodeFiles(cloud, SAVE_NODE).find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
        patch = file && DONE.has(s)
          ? { status: "completed", result: file, finishedAt: cloud.execution_end_time ?? Date.now() }
          : { status: "failed", finishedAt: Date.now(), error: jobError(cloud) ?? `Comfy Cloud: ${s}` };
      }
    } else {
      patch.status = s === "in_progress" || s === "running" ? "running" : "queued";
    }
    job = (await jobs.update(id, patch)) ?? job;
  } catch (e) {
    // Network hiccups must not mark the job failed; the next poll retries.
    return NextResponse.json({ ...job, warning: e instanceof Error ? e.message : String(e) });
  }
  return NextResponse.json(job);
}
