"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CastPicker, castFace, useCast, type CastMember } from "@/components/CastPicker";
import { History, type JobView } from "@/components/History";
import { TrimSheet, type Trim } from "@/components/TrimSheet";
import { CREDITS, MAX_REFS, MAX_SECONDS, MIN_SECONDS, QUALITIES, estimate, type Quality } from "@/lib/openjutsu";

export type Tab = "history" | "how";
const TABS: { key: Tab; label: string }[] = [
  { key: "history", label: "History" },
  { key: "how", label: "How it works" },
];

type Clip = { file: File; url: string; duration: number; trim: Trim };
/** Who should appear: a photo, or an Influencer character (the full-body half of their sheet goes in). */
type Photo = { url: string } & ({ file: File; cast?: undefined } | { cast: CastMember; file?: undefined });

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const maxPhotos = MAX_REFS.swap;

export function Workspace({ initialTab, focus }: { initialTab: Tab; focus: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [clip, setClip] = useState<Clip | null>(null);
  const [trimOpen, setTrimOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [promptOn, setPromptOn] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<Quality>("fast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobView[] | null>(null); // null until the first load
  const [focusId, setFocusId] = useState<string | null>(focus);
  const cast = useCast();

  const seconds = clip ? Math.min(clip.trim.end - clip.trim.start, MAX_SECONDS) : 0;

  // ---- history polling ----
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      const list: JobView[] = await res.json();
      // Ask the server to advance unfinished jobs (it polls Comfy Cloud on GET /api/jobs/:id).
      const open = list.filter((j) => j.status === "queued" || j.status === "running");
      const fresh = await Promise.all(open.map((j) => fetch(`/api/jobs/${j.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => j)));
      const byId = new Map(fresh.map((j: JobView) => [j.id, j]));
      setJobs(list.map((j) => byId.get(j.id) ?? j));
    } catch {
      /* next tick retries */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (focusId && tab === "history") document.getElementById(`job-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, tab, jobs?.length]);

  // ---- inputs ----
  function pickVideo(file: File) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => {
      const duration = v.duration;
      if (duration < MIN_SECONDS) {
        setError(`The video needs at least ${MIN_SECONDS} seconds.`);
        URL.revokeObjectURL(url);
        return;
      }
      if (clip) URL.revokeObjectURL(clip.url);
      setClip({ file, url, duration, trim: { start: 0, end: Math.min(duration, MAX_SECONDS), crop: "original" } });
      setError(null);
      if (duration > MAX_SECONDS) setTrimOpen(true);
    };
    v.onerror = () => setError("This video can't be read. Try an MP4 or MOV file.");
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = maxPhotos - photos.length;
    const next = Array.from(files).slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos([...photos, ...next]);
  }

  function toggleCast(c: CastMember) {
    if (photos.some((p) => p.cast?.id === c.id)) setPhotos(photos.filter((p) => p.cast?.id !== c.id));
    else if (photos.length < maxPhotos) setPhotos([...photos, { cast: c, url: castFace(c.id) }]);
  }

  const blocker = useMemo(() => {
    if (!clip) return "Add a video";
    if (!photos.length) return "Add who should appear";
    return null;
  }, [clip, photos.length]);

  const cost = clip && photos.length ? estimate("swap", seconds, quality, photos.length, false) : null;

  async function generate() {
    if (!clip || blocker) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("video", clip.file);
    fd.append("trim_start", String(clip.trim.start));
    fd.append("trim_end", String(Math.min(clip.trim.end, clip.trim.start + MAX_SECONDS)));
    fd.append("crop", clip.trim.crop);
    photos.forEach((p, i) => (p.cast ? fd.append(`cast_${i + 1}`, p.cast.id) : fd.append(`photo_${i + 1}`, p.file)));
    if (promptOn && prompt.trim()) fd.append("prompt", prompt.trim());
    fd.append("quality", quality);
    try {
      const res = await fetch("/api/jobs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start.");
      setFocusId(data.id);
      setTab("history");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rerun(id: string) {
    const res = await fetch(`/api/jobs/${id}/rerun`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setFocusId(data.id);
      await load();
    } else setError(data.error ?? "Could not rerun.");
  }

  return (
    <main className="work">
      <aside className="panel glass" aria-label="Create">
        <div className="app-title"><b>Openjutsu</b><span>Star in any video</span></div>

        {clip ? (
          <div className="card videocard">
            <div className="thumb">
              <video src={`${clip.url}#t=${clip.trim.start + 0.1}`} muted playsInline preload="metadata" />
              <span className="chip">{fmt(seconds)}</span>
            </div>
            <div className="info">
              <b>Your video</b>
              <span className="lbl">{clip.file.name}</span>
              <span className="lbl">{fmt(clip.trim.start)}–{fmt(clip.trim.start + seconds)}{clip.trim.crop !== "original" ? ` · ${clip.trim.crop}` : ""}</span>
            </div>
            <div className="actions">
              <button type="button" className="link" onClick={() => setTrimOpen(true)}>Trim</button>
              <span className="link">Replace<input type="file" accept="video/*" aria-label="Replace video" onChange={(e) => e.target.files?.[0] && pickVideo(e.target.files[0])} /></span>
            </div>
          </div>
        ) : (
          <label className="card drop">
            <input type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && pickVideo(e.target.files[0])} />
            <span className="icon">▶</span>
            <b>Add a video</b>
            <span className="lbl">{MIN_SECONDS} to {MAX_SECONDS} seconds</span>
          </label>
        )}

        <div className="card refs">
          <div className="between">
            <span>Who should appear</span>
            <span className="lbl">{photos.length} / {maxPhotos}</span>
          </div>
          <div className="grid">
            {photos.map((p, i) => (
              <div key={p.url} className="ref">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.cast ? p.cast.name : `Photo ${i + 1}`} title={p.cast?.name} />
                {photos.length > 1 && <span className="n">{i + 1}</span>}
                <button type="button" className="rm" aria-label={`Remove ${p.cast ? p.cast.name : `photo ${i + 1}`}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {photos.length < maxPhotos && (
              <label className="ref add" aria-label="Add photos">
                +<input type="file" accept="image/*" multiple onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <span className="lbl">
            {photos.length > 1
              ? "Photo 1 replaces the person on the left, photo 2 the next one, and so on."
              : photos[0]?.cast
                ? `${photos[0].cast.name}'s face, hair and outfit come from their character sheet.`
                : "Face, hair and clothes come from the photo. A clear full-body photo works best."}
          </span>
          <CastPicker cast={cast} chosen={photos.flatMap((p) => (p.cast ? [p.cast.id] : []))} onPick={toggleCast} label="Or cast one of your characters" />
        </div>

        <div className="card promptbox">
          <div className="between">
            <span>Prompt <span className="lbl">· optional</span></span>
            <button type="button" role="switch" aria-checked={promptOn} aria-label="Prompt" className="switch" onClick={() => setPromptOn(!promptOn)} />
          </div>
          {promptOn && (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. the man on the right also wears a gold chain"
              maxLength={1500}
            />
          )}
        </div>

        <div className="card quality">
          <span className="lbl" style={{ fontSize: 13 }}>Quality</span>
          <div className="seg" role="group" aria-label="Quality">
            {QUALITIES.map((q) => (
              <button key={q.key} type="button" aria-pressed={quality === q.key} title={q.hint} onClick={() => setQuality(q.key)}>{q.label}</button>
            ))}
          </div>
        </div>

        <div className="generate">
          {error && <span className="error" role="alert">{error}</span>}
          <button type="button" className="cta" disabled={!!blocker || busy} onClick={generate}>
            {busy ? "Starting…" : blocker ?? "Generate"}
          </button>
          <span className="lbl" style={{ textAlign: "center" }}>
            {cost ? `About ${cost.credits} credits · ${Math.max(1, Math.round(cost.gpuSeconds / 60))} min on the GPU` : "Open models on Comfy Cloud"}
          </span>
        </div>
      </aside>

      <section className="stage glass">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === "history" && jobs && <History jobs={jobs} focus={focusId} onRerun={rerun} />}

        {tab === "how" && (
          <>
            <div className="hero">
              <div>
                <h1>Change who&apos;s in it, keep the rest</h1>
                <p>Openjutsu replaces the people you add and leaves everything else in the shot as it was filmed.</p>
              </div>
            </div>
            <div className="steps">
              {[
                ["Add your video", "The shot you want to keep. Background, camera, light and motion stay as filmed."],
                ["Add who should appear", "A photo, or a character you made in Influencer. Photo 1 replaces the person on the left, photo 2 the next one. Face, hair and clothes come from the photo."],
                ["Generate", "The new people take over the roles and play them exactly like the original."],
              ].map(([t, d], i) => (
                <div key={t} className="card step"><span className="k">Step {i + 1}</span><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
            <div className="card credits">
              <b>Credits</b>
              <span className="lbl">Susano is built on open models and the work of the community. Thank you.</span>
              <ul>
                {CREDITS.map((c) => (
                  <li key={c.what}>
                    <a href={c.url} target="_blank" rel="noreferrer">{c.what}</a> by {c.by}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {trimOpen && clip && (
        <TrimSheet
          url={clip.url}
          duration={clip.duration}
          limit={MAX_SECONDS}
          value={clip.trim}
          onClose={() => setTrimOpen(false)}
          onDone={(trim) => { setClip({ ...clip, trim }); setTrimOpen(false); }}
        />
      )}
    </main>
  );
}
