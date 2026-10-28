"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CREDITS, DEFAULT_DIRECTION, choices, cinematicPrompt, estimate, type Direction } from "@/lib/cinematic";

type Tab = "images" | "how";
const TABS: { key: Tab; label: string }[] = [
  { key: "images", label: "Images" },
  { key: "how", label: "How it works" },
];
const LABELS: Record<keyof Direction, string> = { shot: "Shot", camera: "Camera", light: "Light", look: "Look" };

type StillView = {
  id: string;
  createdAt: number;
  status: "queued" | "running" | "completed" | "failed";
  scene: string;
  prompt: string;
  gpuSeconds?: number;
  error?: string;
};

const open = (s: StillView) => s.status === "queued" || s.status === "running";
const image = (id: string) => `/api/cinematic/${id}?image`;

export function Cinematic() {
  const [tab, setTab] = useState<Tab>("images");
  const [scene, setScene] = useState("");
  const [direction, setDirection] = useState<Direction>(DEFAULT_DIRECTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<StillView[] | null>(null);
  const prompt = useMemo(() => cinematicPrompt(scene, direction), [scene, direction]);

  const load = useCallback(async () => {
    try {
      const all: StillView[] = await (await fetch("/api/cinematic", { cache: "no-store" })).json();
      const fresh = await Promise.all(all.filter(open).map((s) => fetch(`/api/cinematic/${s.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => s)));
      const byId = new Map(fresh.map((s: StillView) => [s.id, s]));
      setList(all.map((s) => byId.get(s.id) ?? s));
    } catch {
      /* next tick retries */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function generate() {
    if (scene.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cinematic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene, direction }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start.");
      setTab("images");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const cost = estimate();
  return (
    <main className="work">
      <aside className="panel glass" aria-label="Create">
        <div className="app-title"><b>Cinematic</b><span>Direct a single frame</span></div>

        <div className="card promptbox">
          <span>Scene</span>
          <textarea value={scene} maxLength={900} onChange={(e) => setScene(e.target.value)} placeholder="A lone astronaut finds a field of flowers on Mars…" />
        </div>

        {(Object.keys(choices) as (keyof Direction)[]).map((key) => (
          <label key={key} className="card quality">
            <span className="lbl" style={{ fontSize: 13 }}>{LABELS[key]}</span>
            <select className="pick" value={direction[key]} onChange={(e) => setDirection({ ...direction, [key]: e.target.value } as Direction)}>
              {choices[key].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        ))}

        <div className="generate">
          {error && <span className="error" role="alert">{error}</span>}
          <button type="button" className="cta" disabled={scene.trim().length < 3 || busy} onClick={generate}>
            {busy ? "Starting…" : scene.trim().length < 3 ? "Describe a scene" : "Generate image"}
          </button>
          <span className="lbl" style={{ textAlign: "center" }}>About {cost.credits} credits · FLUX.2 [dev] on Comfy Cloud</span>
        </div>
        <details className="lbl" style={{ padding: "0 4px" }}>
          <summary>See the prompt sent to the model</summary>
          <p style={{ margin: "6px 0 0", color: "var(--soft)" }}>{prompt || "Your directions will be combined with the scene."}</p>
        </details>
      </aside>

      <section className="stage glass">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === "images" && list && (list.length ? (
          <div className="stills">
            {list.map((s) => (
              <figure key={s.id} className="card still">
                {s.status === "completed" ? (
                  <a href={image(s.id)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image(s.id)} alt={s.scene} />
                  </a>
                ) : (
                  <div className="media wait">
                    {s.status === "failed" ? <b>This one didn&apos;t work.</b> : <><div className="bars"><span className="on live" /><span className="on live" /><span className="live" /></div><span className="lbl">Developing… about a minute.</span></>}
                  </div>
                )}
                <figcaption>
                  <p>{s.scene}</p>
                  <div className="row">
                    {s.status === "completed" && <a className="chip solid" href={`${image(s.id)}&download`} style={{ textDecoration: "none" }}>Save</a>}
                    {s.gpuSeconds ? <span className="chip">{Math.round((s.gpuSeconds / 3600) * 4.54 * 211)} credits</span> : null}
                  </div>
                  <details>
                    <summary>Prompt</summary>
                    <pre>{s.error ? `Error: ${s.error}\n\n` : ""}{s.prompt}</pre>
                  </details>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b style={{ color: "var(--text)", fontSize: 16 }}>No images yet</b>
            <span>Describe a scene, pick the shot, camera, light and look, then press Generate.</span>
          </div>
        ))}

        {tab === "how" && (
          <>
            <div className="hero">
              <div>
                <h1>Direct the frame</h1>
                <p>Describe the scene, then choose the shot, the camera, the light and the look, like a director of photography would.</p>
              </div>
            </div>
            <div className="card credits">
              <b>Credits</b>
              <span className="lbl">
                The directions and the prompt are Comfy&apos;s Cinematic Studio, unchanged. Comfy&apos;s version renders with FLUX.2 [pro]
                through Comfy Router; Susano uses only open weights, so the same prompt goes to FLUX.2 [dev] on Comfy Cloud. The camera
                choices add words to the prompt; the model does not simulate a real lens.
              </span>
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
