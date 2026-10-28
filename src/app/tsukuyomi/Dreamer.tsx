"use client";
import { useCallback, useEffect, useState } from "react";
import { CastPicker, castFace, useCast, type CastMember } from "@/components/CastPicker";
import { CREDITS, LENGTHS, creditsFor, estimate, filmSeconds, type Length } from "@/lib/tsukuyomi";

export type Tab = "dreams" | "how";
const TABS: { key: Tab; label: string }[] = [
  { key: "dreams", label: "Dreams" },
  { key: "how", label: "How it works" },
];

type DreamView = {
  id: string;
  createdAt: number;
  status: "queued" | "running" | "completed" | "failed";
  story: string;
  length: Length;
  wanted: number;
  phase: "direct" | "render";
  segments: { beat: string; sound: string; gpuSeconds: number }[];
  next?: { beat: string };
  waiting?: number;
  wake?: boolean;
  gpuSeconds: number;
  error?: string;
  /** Set when the dream continues an uploaded video. */
  clipSeconds?: number;
  /** The Influencer character it stars. */
  cast?: { id: string; name: string };
};

type Source = "picture" | "video";
const SOURCES: { key: Source; label: string }[] = [
  { key: "picture", label: "Start from a picture" },
  { key: "video", label: "Continue a video" },
];

const media = (id: string, kind: string) => `/api/tsukuyomi/${id}/media/${kind}`;
const BARS = 24;
const open = (d: DreamView) => d.status === "queued" || d.status === "running";

function Progress({ dream }: { dream: DreamView }) {
  const n = dream.segments.length + 1;
  const total = dream.wake ? n : dream.wanted;
  const done = (dream.segments.length + (dream.phase === "render" ? 0.5 : 0.1)) / total;
  const on = Math.round(done * BARS);
  const step = dream.waiting ? "Waking up the GPU" : dream.phase === "direct" ? "Writing what happens next" : "Dreaming it";
  return (
    <>
      <div className="bars" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
        {Array.from({ length: BARS }, (_, i) => <span key={i} className={`${i < on ? "on" : ""} ${i === on - 1 ? "live" : ""}`} />)}
      </div>
      <span className="progress-label">
        {dream.length === "endless" && !dream.wake ? `Part ${n}` : `Part ${n} of ${total}`} · {step}
      </span>
    </>
  );
}

function DreamItem({ dream, focus, onWake }: { dream: DreamView; focus: boolean; onWake: (id: string) => void }) {
  const parts = dream.segments.length;
  const seconds = Math.round(filmSeconds(parts, dream.clipSeconds));
  // A continued video has a film from the start: the uploaded clip.
  const hasFilm = parts > 0 || !!dream.clipSeconds;
  return (
    <article id={`dream-${dream.id}`} className={`item ${focus ? "focus" : ""}`}>
      {hasFilm ? (
        <div className="media">
          {/* The film grows with every part; the query makes the browser load the longer one. */}
          <video key={parts} src={`${media(dream.id, "film")}?parts=${parts}`} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          {open(dream) && <span className="chip live-chip">Still dreaming…</span>}
        </div>
      ) : dream.status === "failed" ? (
        <div className="media wait"><b>This dream didn&apos;t start.</b><span className="lbl">Details are under How it was made.</span></div>
      ) : (
        <div className="media wait">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media(dream.id, "photo")} alt="" aria-hidden="true" className="blurred" />
          <Progress dream={dream} />
          <span className="lbl" style={{ position: "relative" }}>The first part takes 2 to 3 minutes.</span>
        </div>
      )}
      <div className="card meta">
        <div className="row"><span className="chip solid">Tsukuyomi · {LENGTHS.find((l) => l.key === dream.length)?.label}</span></div>
        <p>{dream.story}</p>
        <div className="thumbs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media(dream.id, "photo")} alt="Picture" />
        </div>
        {hasFilm && open(dream) && <Progress dream={dream} />}
        {dream.status === "failed" && parts > 0 && <span className="error">Stopped after part {parts}: {dream.error}</span>}
        <div className="row">
          {dream.cast && <span className="chip">Starring {dream.cast.name}</span>}
          <span className="chip">{parts} {parts === 1 ? "part" : "parts"}</span>
          <span className="chip">{seconds} s</span>
          <span className="chip">{creditsFor(dream.gpuSeconds)} credits</span>
        </div>
        <div className="row actions">
          {open(dream) && !dream.wake && <button type="button" className="chip" onClick={() => onWake(dream.id)}>Wake up</button>}
          {open(dream) && dream.wake && <span className="chip">Waking after this part</span>}
          {hasFilm && <a className="chip solid" href={`${media(dream.id, "film")}?download`} style={{ textDecoration: "none" }}>Save</a>}
        </div>
        <details>
          <summary>How it was made</summary>
          <p className="lbl" style={{ margin: "8px 0 0" }}>
            Each part: the Qwen3.5 director writes the next beat, then SEEDHUNTER v2.51 by foxydits renders it on MiniMax H3, continuing from the film so far.
            {dream.cast ? ` RefMods holds ${dream.cast.name}'s face and outfit from their character sheet in every part.` : ""}
          </p>
          <pre>
            {dream.error ? `Error: ${dream.error}\n\n` : ""}
            {dream.segments.map((s, i) => `Part ${i + 1}: ${s.beat}\nSound: ${s.sound}`).join("\n\n")}
            {dream.next ? `\n\nNow: ${dream.next.beat}` : ""}
          </pre>
        </details>
      </div>
    </article>
  );
}

export function Dreamer({ initialTab, focus }: { initialTab: Tab; focus: string | null }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [source, setSource] = useState<Source>("picture");
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
  const [star, setStar] = useState<CastMember | null>(null);
  const cast = useCast();
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const [story, setStory] = useState("");
  const [length, setLength] = useState<Length>("15");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<DreamView[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(focus);

  const load = useCallback(async () => {
    try {
      const all: DreamView[] = await (await fetch("/api/tsukuyomi", { cache: "no-store" })).json();
      // The server moves open dreams along when they are polled.
      const fresh = await Promise.all(all.filter(open).map((d) => fetch(`/api/tsukuyomi/${d.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => d)));
      const byId = new Map(fresh.map((d: DreamView) => [d.id, d]));
      setList(all.map((d) => byId.get(d.id) ?? d));
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
    if (focusId && tab === "dreams") document.getElementById(`dream-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, tab, list?.length]);

  const segments = LENGTHS.find((l) => l.key === length)!.segments;
  const cost = estimate(length === "endless" ? 3 : segments);
  const continuing = source === "video";
  const blocker = continuing
    ? !clip ? "Add a video" : story.trim().length < 10 ? "Write what happens next" : null
    : !picture && !star ? "Add a picture" : story.trim().length < 10 ? "Write how it starts" : null;

  async function dream() {
    if (blocker) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    if (continuing && clip) fd.append("video", clip.file);
    // With a video the picture is optional: without one, the clip's last frame shows who it is about.
    if (star) fd.append("character", star.id);
    else if (picture) fd.append("picture", picture.file);
    fd.append("story", story.trim());
    fd.append("length", length);
    try {
      const res = await fetch("/api/tsukuyomi", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start.");
      setFocusId(data.id);
      setTab("dreams");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function wake(id: string) {
    await fetch(`/api/tsukuyomi/${id}`, { method: "POST" });
    await load();
  }

  return (
    <main className="work">
      <aside className="panel glass" aria-label="Create">
        <div className="app-title"><b>Tsukuyomi</b><span>An infinite dream</span></div>

        <div className="seg" role="group" aria-label="Start from" style={{ display: "flex" }}>
          {SOURCES.map((o) => (
            <button key={o.key} type="button" aria-pressed={source === o.key} onClick={() => setSource(o.key)} style={{ flex: 1 }}>{o.label}</button>
          ))}
        </div>

        {continuing && (clip ? (
          <div className="card videocard">
            <div className="thumb">
              <video src={`${clip.url}#t=0.5`} muted playsInline preload="metadata" />
            </div>
            <div className="info">
              <b>Your video</b>
              <span className="lbl">{clip.file.name}</span>
            </div>
            <div className="actions">
              <span className="link">Replace<input type="file" accept="video/*" aria-label="Replace video" onChange={(e) => { const f = e.target.files?.[0]; if (f) setClip({ file: f, url: URL.createObjectURL(f) }); }} /></span>
            </div>
          </div>
        ) : (
          <label className="card drop">
            <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setClip({ file: f, url: URL.createObjectURL(f) }); }} />
            <span className="icon">▶</span>
            <b>Add a video</b>
            <span className="lbl">The dream picks up where it ends. Longer clips keep their last 15 seconds, framed 16:9.</span>
          </label>
        ))}

        {star ? (
          <div className="card videocard">
            <div className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={castFace(star.id)} alt={star.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div className="info">
              <b>Starring {star.name}</b>
              <span className="lbl">Same face and outfit in every part.</span>
            </div>
            <div className="actions">
              <button type="button" className="link" onClick={() => setStar(null)}>Change</button>
            </div>
          </div>
        ) : picture ? (
          <div className="card videocard">
            <div className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picture.url} alt="Picture" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div className="info">
              <b>Who it&apos;s about</b>
              <span className="lbl">{picture.file.name}</span>
            </div>
            <div className="actions">
              <span className="link">Replace<input type="file" accept="image/*" aria-label="Replace picture" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPicture({ file: f, url: URL.createObjectURL(f) }); }} /></span>
              <button type="button" className="link" onClick={() => setPicture(null)}>Remove</button>
            </div>
          </div>
        ) : (
          <div className="card refs">
            <label className="drop" style={{ padding: 0 }}>
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPicture({ file: f, url: URL.createObjectURL(f) }); }} />
              <span className="icon">☾</span>
              <b>{continuing ? "Add a picture (optional)" : "Add a picture"}</b>
              <span className="lbl">{continuing ? "Who it's about. Without one, the last frame of your video is used." : "Who the dream is about. A person, a character, a scene."}</span>
            </label>
            <CastPicker cast={cast} onPick={setStar} label="Or star one of your characters" />
          </div>
        )}

        <div className="card promptbox">
          <span>{continuing ? "What happens next" : "The start"}</span>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            placeholder={continuing ? "e.g. She gets back up and the duel carries on down the temple steps." : "e.g. Two rivals meet on a temple courtyard at sunset and the duel begins."}
            maxLength={600}
          />
        </div>

        <div className="card quality">
          <span className="lbl" style={{ fontSize: 13 }}>{continuing ? "Add" : "Length"}</span>
          <div className="seg" role="group" aria-label="Length">
            {LENGTHS.map((l) => (
              <button key={l.key} type="button" aria-pressed={length === l.key} onClick={() => setLength(l.key)}>{l.label}</button>
            ))}
          </div>
        </div>

        <div className="generate">
          {error && <span className="error" role="alert">{error}</span>}
          <button type="button" className="cta" disabled={!!blocker || busy} onClick={dream}>
            {busy ? "Starting…" : blocker ?? "Dream"}
          </button>
          <span className="lbl" style={{ textAlign: "center" }}>
            {length === "endless"
              ? `About ${cost.credits} credits per 15 s · it keeps going until you wake it`
              : `About ${cost.credits} credits · ${Math.max(1, Math.round(cost.gpuSeconds / 60))} min on the GPU`}
          </span>
        </div>
      </aside>

      <section className="stage glass">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === "dreams" && list && (list.length ? (
          <div className="history">
            {list.map((d) => <DreamItem key={d.id} dream={d} focus={focusId === d.id} onWake={wake} />)}
          </div>
        ) : (
          <div className="empty">
            <b style={{ color: "var(--text)", fontSize: 16 }}>No dreams yet</b>
            <span>Add a picture, write how it starts and press Dream. The film grows here, part by part.</span>
          </div>
        ))}

        {tab === "how" && (
          <>
            <div className="hero">
              <div>
                <h1>Write the start, it never ends</h1>
                <p>Tsukuyomi turns one picture and a sentence into a film that keeps going: about five seconds at a time, each part picking up exactly where the last one stopped.</p>
              </div>
            </div>
            <div className="steps">
              {[
                ["Add a picture or a video", "Who the dream is about, a character you made in Influencer, or a clip to continue. Faces, hair and clothes stay the same in every part."],
                ["Write how it starts", "A sentence or two: the place, the mood, what is about to happen. For a video, what happens next."],
                ["Dream", "A director writes each next beat after watching the end of the film so far. Wake it up whenever you like."],
              ].map(([t, d], i) => (
                <div key={t} className="card step"><span className="k">Step {i + 1}</span><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
            <div className="card credits">
              <b>Credits</b>
              <span className="lbl">Tsukuyomi renders every part with foxydits&apos; SEEDHUNTER workflow on a Comfy deployment, unchanged apart from RefMods when one of your characters stars.</span>
              <ul>
                {CREDITS.map((c) => (
                  <li key={c.what}><a href={c.url} target="_blank" rel="noreferrer">{c.what}</a> by {c.by}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
