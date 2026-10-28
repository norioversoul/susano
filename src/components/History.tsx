"use client";
import { useEffect, useState } from "react";
import { CompareSlider } from "./CompareSlider";
import { styleByKey, type Mode } from "@/lib/openjutsu";

export type JobView = {
  id: string;
  createdAt: number;
  status: "queued" | "running" | "completed" | "failed";
  mode?: Mode;
  stage?: string;
  title: string;
  prompt: string;
  style?: string;
  refs?: number;
  quality: string;
  seconds: number;
  size: { width: number; height: number };
  estimate: { gpuSeconds: number; credits: number; usd: number };
  gpuSeconds?: number;
  error?: string;
  request?: { prompt?: string; photos: string[] };
  characters?: unknown[];
};

const BARS = 24;

/** Jobs from the first version have German titles and no mode; they were all object swaps. */
export const titleOf = (j: JobView) => {
  const n = j.refs ?? j.characters?.length ?? 1;
  return j.mode === "swap" || !j.mode ? `Openjutsu · ${n} ${n === 1 ? "person" : "people"}` : j.title;
};
const media = (id: string, kind: string) => `/api/jobs/${id}/media/${kind}`;

function credits(gpuSeconds: number) {
  const usd = (gpuSeconds / 3600) * 4.54;
  return `${Math.round(usd * 211)} credits`;
}

/** Progress is time-based: the estimate plus about a minute of GPU queue per Cloud job. */
function progress(job: JobView, now: number) {
  const stages = job.mode === "swap" || !job.mode ? (job.style ? 3 : 2) : 1;
  const total = (job.estimate.gpuSeconds + 45 * stages) * 1000;
  const done = Math.min(0.95, (now - job.createdAt) / total);
  const left = Math.max(0, total - (now - job.createdAt));
  const label = left < 45_000 ? "Almost there." : left < 90_000 ? "About a minute to go." : `About ${Math.round(left / 60_000)} minutes to go.`;
  return { done, label };
}

function Waiting({ job }: { job: JobView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const { done, label } = progress(job, now);
  const on = Math.round(done * BARS);
  return (
    <div className="media wait">
      <video src={media(job.id, "source")} muted playsInline preload="metadata" aria-hidden="true" />
      <div className="bars" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} className={`${i < on ? "on" : ""} ${i === on - 1 ? "live" : ""}`} />
        ))}
      </div>
      <span className="progress-label">{label}</span>
    </div>
  );
}

export function History({ jobs, focus, onRerun }: { jobs: JobView[]; focus?: string | null; onRerun: (id: string) => void }) {
  if (!jobs.length) {
    return (
      <div className="empty">
        <b style={{ color: "var(--text)", fontSize: 16 }}>Nothing here yet</b>
        <span>Add a video and a photo on the left, then press Generate. Your videos show up here.</span>
      </div>
    );
  }
  return (
    <div className="history">
      {jobs.map((job) => {
        const look = styleByKey(job.style);
        const userPrompt = job.request?.prompt;
        const photos = job.refs ?? job.characters?.length ?? 0;
        const mode = job.mode === "motion" ? "Motion transfer" : job.refs === 0 ? "Style" : "Openjutsu";
        return (
          <article key={job.id} id={`job-${job.id}`} className={`item ${focus === job.id ? "focus" : ""}`}>
            {job.status === "completed" ? (
              <div className="media"><CompareSlider before={media(job.id, "source")} after={media(job.id, "result")} /></div>
            ) : job.status === "failed" ? (
              <div className="media wait">
                <b>This one didn&apos;t work.</b>
                <span className="lbl">{job.request ? "Rerun to try again. Details are under How it was made." : "Details are under How it was made."}</span>
              </div>
            ) : (
              <Waiting job={job} />
            )}
            <div className="card meta">
              <div className="row">
                <span className="chip solid">{mode}{look ? ` · ${look.name}` : ""}</span>
              </div>
              <p>{userPrompt || titleOf(job)}</p>
              {photos > 0 && (
                <div className="thumbs">
                  {Array.from({ length: photos }, (_, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={media(job.id, `photo_${i + 1}`)} alt={`Photo ${i + 1}`} />
                  ))}
                </div>
              )}
              <div className="row">
                <span className="chip">{job.size.height}p</span>
                <span className="chip">{job.seconds} s</span>
                {job.gpuSeconds ? <span className="chip">{credits(job.gpuSeconds)}</span> : <span className="chip">~{job.estimate.credits} credits</span>}
              </div>
              <div className="row actions">
                {job.request && job.status !== "queued" && job.status !== "running" && (
                  <button type="button" className="chip solid" onClick={() => onRerun(job.id)}>↻ Rerun</button>
                )}
                {job.status === "completed" && (
                  <a className="chip solid" href={`${media(job.id, "result")}?download`} style={{ textDecoration: "none" }}>Save</a>
                )}
              </div>
              <details>
                <summary>How it was made</summary>
                {job.mode === "swap" && job.request && (
                  <p className="lbl" style={{ margin: "8px 0 0" }}>
                    Character Swap LoRA v1.1 by{" "}
                    <a href="https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI" target="_blank" rel="noreferrer">Alissonerdx</a>, on MiniMax H3.
                  </p>
                )}
                <pre>{job.error ? `Error: ${job.error}\n\n` : ""}{job.prompt}</pre>
              </details>
            </div>
          </article>
        );
      })}
    </div>
  );
}
