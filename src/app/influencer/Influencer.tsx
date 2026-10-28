"use client";
import { useCallback, useEffect, useState } from "react";
import { ASPECTS, CREDITS, GPU_SECONDS, MAX_REFS, TRAITS, VIDEO_ASPECTS, VIDEO_GPU_SECONDS, creditsFor, randomTraits, videoCredits, type Aspect, type Traits, type VideoAspect } from "@/lib/influencer";

export type Tab = "characters" | "photos" | "videos" | "how";
const TABS: { key: Tab; label: string }[] = [
  { key: "characters", label: "Characters" },
  { key: "photos", label: "Photos" },
  { key: "videos", label: "Videos" },
  { key: "how", label: "How it works" },
];

type Status = "queued" | "running" | "completed" | "failed";
type CharacterView = { id: string; createdAt: number; status: Status; name: string; source: "traits" | "image"; extra: string; gpuSeconds?: number; error?: string };
type PhotoView = { id: string; createdAt: number; status: Status; characterId: string; scene: string; aspect: Aspect; gpuSeconds?: number; error?: string };
type VideoView = { id: string; createdAt: number; status: Status; characterId: string; scene: string; aspect: VideoAspect; waiting?: number; gpuSeconds?: number; error?: string };

type Mode = "create" | "photo" | "video";
type Source = "traits" | "image";

const sheet = (id: string) => `/api/influencer/characters/${id}?image`;
const photo = (id: string) => `/api/influencer/photos/${id}?image`;
const clip = (id: string) => `/api/influencer/videos/${id}?file`;
const busy = (s: Status) => s === "queued" || s === "running";

function Pending({ label }: { label: string }) {
  return (
    <div className="media wait">
      <div className="bars" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} className={i < 6 ? "on live" : ""} />)}</div>
      <span className="progress-label">{label}</span>
    </div>
  );
}

export function Influencer({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mode, setMode] = useState<Mode>("create");
  const [source, setSource] = useState<Source>("traits");
  const [traits, setTraits] = useState<Traits>({});
  const [refs, setRefs] = useState<{ file: File; url: string }[]>([]);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [scene, setScene] = useState("");
  const [aspect, setAspect] = useState<Aspect>("4:5");
  const [videoAspect, setVideoAspect] = useState<VideoAspect>("9:16");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cast, setCast] = useState<CharacterView[] | null>(null);
  const [shots, setShots] = useState<PhotoView[] | null>(null);
  const [films, setFilms] = useState<VideoView[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [cs, ps, vs]: [CharacterView[], PhotoView[], VideoView[]] = await Promise.all([
        fetch("/api/influencer/characters", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/influencer/photos", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/influencer/videos", { cache: "no-store" }).then((r) => r.json()),
      ]);
      // Open jobs move along when they are polled.
      const fresh = <T extends { id: string; status: Status }>(xs: T[], base: string) =>
        Promise.all(xs.map((x) => (busy(x.status) ? fetch(`${base}/${x.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => x) : x)));
      setCast(await fresh(cs, "/api/influencer/characters"));
      setShots(await fresh(ps, "/api/influencer/photos"));
      setFilms(await fresh(vs, "/api/influencer/videos"));
    } catch {
      /* next tick retries */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const ready = (cast ?? []).filter((c) => c.status === "completed");
  const chosen = ready.find((c) => c.id === characterId) ?? ready[0];
  const nameOf = (id: string) => cast?.find((c) => c.id === id)?.name ?? "Character";

  function toggle(key: string, id: string, max: number) {
    setTraits((t) => {
      const cur = t[key] ?? [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : max === 1 ? [id] : [...cur, id].slice(-max);
      const out = { ...t, [key]: next };
      if (!next.length) delete out[key];
      return out;
    });
  }

  function addRefs(files: FileList | null) {
    if (!files) return;
    setRefs((r) => [...r, ...Array.from(files).map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_REFS));
  }

  const fromImage = source === "image";
  const createBlocker = fromImage
    ? !refs.length ? "Add a photo" : !consent ? "Confirm permission" : null
    : !Object.keys(traits).length ? "Pick a few traits" : null;
  const photoBlocker = !chosen ? "Create a character first" : scene.trim().length < 3 ? "Describe the scene" : null;
  const blocker = mode === "create" ? createBlocker : photoBlocker;
  const cost = mode === "video" ? videoCredits(VIDEO_GPU_SECONDS) : creditsFor(mode === "photo" ? GPU_SECONDS.photo : fromImage ? GPU_SECONDS.sheetFromImage : GPU_SECONDS.sheet);

  async function go() {
    if (blocker) return;
    setSending(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "create") {
        const fd = new FormData();
        fd.append("name", name.trim());
        fd.append("traits", JSON.stringify(traits));
        fd.append("extra", extra.trim());
        if (fromImage) {
          for (const r of refs) fd.append("refs", r.file);
          fd.append("consent", consent ? "yes" : "no");
        }
        res = await fetch("/api/influencer/characters", { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/influencer/${mode === "video" ? "videos" : "photos"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: chosen?.id, scene: scene.trim(), aspect: mode === "video" ? videoAspect : aspect }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start.");
      setTab(mode === "create" ? "characters" : mode === "video" ? "videos" : "photos");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/influencer/characters/${id}`, { method: "DELETE" });
    await load();
  }

  function use(id: string) {
    setCharacterId(id);
    setMode("photo");
  }

  return (
    <main className="work">
      <aside className="panel glass" aria-label="Create">
        <div className="app-title"><b>Influencer</b><span>Your own AI influencer</span></div>

        <div className="seg" role="group" aria-label="What to make" style={{ display: "flex" }}>
          <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")} style={{ flex: 1 }}>New character</button>
          <button type="button" aria-pressed={mode === "photo"} onClick={() => setMode("photo")} style={{ flex: 1 }}>Photo</button>
          <button type="button" aria-pressed={mode === "video"} onClick={() => setMode("video")} style={{ flex: 1 }}>Video</button>
        </div>

        {mode === "create" && (
          <>
            <div className="seg" role="group" aria-label="Start from" style={{ display: "flex" }}>
              <button type="button" aria-pressed={!fromImage} onClick={() => setSource("traits")} style={{ flex: 1 }}>From traits</button>
              <button type="button" aria-pressed={fromImage} onClick={() => setSource("image")} style={{ flex: 1 }}>From a photo</button>
            </div>

            {fromImage && (
              <div className="card refs">
                <div className="between"><b style={{ fontWeight: 600 }}>Reference photos</b><span className="lbl">{refs.length} / {MAX_REFS}</span></div>
                <div className="grid">
                  {refs.map((r, i) => (
                    <div key={r.url} className="ref">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.url} alt={`Reference ${i + 1}`} />
                      <button type="button" className="rm" aria-label={`Remove reference ${i + 1}`} onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  {refs.length < MAX_REFS && (
                    <label className="ref add" aria-label="Add a reference photo">+<input type="file" accept="image/*" multiple onChange={(e) => addRefs(e.target.files)} /></label>
                  )}
                </div>
                <span className="lbl">One clear photo is enough. Two or three angles hold the face better.</span>
                <label className="between" style={{ justifyContent: "flex-start", gap: 10, fontSize: 13 }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                  This is me, or I have this person&apos;s permission.
                </label>
              </div>
            )}

            <div className="card promptbox">
              <div className="between">
                <span>{fromImage ? "Change anything (optional)" : "Traits"}</span>
                {!fromImage && <button type="button" className="link" onClick={() => setTraits(randomTraits())}>Surprise me</button>}
              </div>
              <div className="traits">
                {TRAITS.map((g) => (
                  <fieldset key={g.key} className="trait-group">
                    <legend>{g.label}{g.max > 1 ? <span className="lbl"> · up to {g.max}</span> : null}</legend>
                    <div className="toggles">
                      {g.options.map((o) => (
                        <button key={o.id} type="button" className="toggle" aria-pressed={(traits[g.key] ?? []).includes(o.id)} onClick={() => toggle(g.key, o.id, g.max)}>{o.label}</button>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>

            <div className="card promptbox">
              <span>Anything else</span>
              <textarea value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={400} placeholder="e.g. Oversized olive bomber jacket, white tank top, wide-leg cargo trousers." />
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Mara" className="field" />
              </label>
            </div>
          </>
        )}

        {mode !== "create" && (
          <>
            <div className="card promptbox">
              <span>Who</span>
              {ready.length ? (
                <div className="picker" role="group" aria-label="Character">
                  {ready.map((c) => (
                    <button key={c.id} type="button" aria-pressed={chosen?.id === c.id} onClick={() => setCharacterId(c.id)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sheet(c.id)} alt="" />
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="lbl">Create a character first. It shows up here when its sheet is ready.</span>
              )}
            </div>
            <div className="card promptbox">
              <span>The scene</span>
              <textarea value={scene} onChange={(e) => setScene(e.target.value)} maxLength={600} placeholder={mode === "video" ? "e.g. Walking through a Lisbon street market, turning to the camera and waving, warm morning light." : "e.g. At a café in Lisbon, morning sun, laughing with an espresso."} />
            </div>
            <div className="card quality">
              <span className="lbl" style={{ fontSize: 13 }}>Format</span>
              <div className="seg" role="group" aria-label="Format">
                {mode === "video"
                  ? VIDEO_ASPECTS.map((a) => <button key={a.key} type="button" aria-pressed={videoAspect === a.key} onClick={() => setVideoAspect(a.key)}>{a.key}</button>)
                  : ASPECTS.map((a) => <button key={a.key} type="button" aria-pressed={aspect === a.key} onClick={() => setAspect(a.key)}>{a.label}</button>)}
              </div>
            </div>
          </>
        )}

        <div className="generate">
          {error && <span className="error" role="alert">{error}</span>}
          <button type="button" className="cta" disabled={!!blocker || sending} onClick={go}>
            {sending ? "Starting…" : blocker ?? (mode === "create" ? "Create character" : mode === "video" ? "Make video" : "Make photo")}
          </button>
          <span className="lbl" style={{ textAlign: "center" }}>
            {mode === "video" ? `About ${cost} credits for 5 s · SEEDHUNTER with RefMods, plus a few minutes if the GPU is asleep` : `About ${cost} credits · FLUX.2 [dev] on Comfy Cloud`}
          </span>
        </div>
      </aside>

      <section className="stage glass">
        <div className="tabs" role="tablist">
          {TABS.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>

        {tab === "characters" && cast && (cast.length ? (
          <div className="gallery">
            {cast.map((c) => (
              <figure key={c.id} className="card still">
                {c.status === "completed" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sheet(c.id)} alt={`${c.name}: character sheet`} />
                ) : c.status === "failed" ? (
                  <div className="media wait"><b>This sheet didn&apos;t work.</b><span className="lbl">{c.error}</span></div>
                ) : (
                  <Pending label="Drawing the character sheet" />
                )}
                <figcaption>
                  <div className="between"><b>{c.name}</b><span className="chip">{c.source === "image" ? "From a photo" : "From traits"}</span></div>
                  {c.extra && <p className="lbl" style={{ margin: 0 }}>{c.extra}</p>}
                  <div className="row">
                    {c.status === "completed" && <button type="button" className="chip solid" onClick={() => use(c.id)}>Make a photo</button>}
                    {c.status === "completed" && <a className="chip" href={`${sheet(c.id)}&download`} style={{ textDecoration: "none" }}>Save sheet</a>}
                    {c.gpuSeconds ? <span className="chip">{creditsFor(c.gpuSeconds)} credits</span> : null}
                    {!busy(c.status) && <button type="button" className="chip" onClick={() => remove(c.id)}>Remove</button>}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b style={{ color: "var(--text)", fontSize: 16 }}>No characters yet</b>
            <span>Pick a few traits or add a photo, then press Create character. Their sheet shows up here.</span>
          </div>
        ))}

        {tab === "photos" && shots && (shots.length ? (
          <div className="gallery">
            {shots.map((p) => (
              <figure key={p.id} className="card still">
                {p.status === "completed" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo(p.id)} alt={p.scene} style={{ aspectRatio: p.aspect.replace(":", " / ") }} />
                ) : p.status === "failed" ? (
                  <div className="media wait"><b>This photo didn&apos;t work.</b><span className="lbl">{p.error}</span></div>
                ) : (
                  <Pending label="Taking the photo" />
                )}
                <figcaption>
                  <b>{nameOf(p.characterId)}</b>
                  <p>{p.scene}</p>
                  <div className="row">
                    {p.status === "completed" && <a className="chip solid" href={`${photo(p.id)}&download`} style={{ textDecoration: "none" }}>Save</a>}
                    <span className="chip">{p.aspect}</span>
                    {p.gpuSeconds ? <span className="chip">{creditsFor(p.gpuSeconds)} credits</span> : null}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b style={{ color: "var(--text)", fontSize: 16 }}>No photos yet</b>
            <span>Pick a character, describe a scene and press Make photo.</span>
          </div>
        ))}

        {tab === "videos" && films && (films.length ? (
          <div className="gallery">
            {films.map((v) => (
              <figure key={v.id} className="card still">
                {v.status === "completed" ? (
                  <video src={clip(v.id)} controls playsInline preload="metadata" style={{ width: "100%", display: "block", aspectRatio: v.aspect.replace(":", " / "), background: "#000" }} />
                ) : v.status === "failed" ? (
                  <div className="media wait"><b>This video didn&apos;t work.</b><span className="lbl">{v.error}</span></div>
                ) : (
                  <Pending label={v.waiting ? "Waking up the GPU" : "Filming it"} />
                )}
                <figcaption>
                  <b>{nameOf(v.characterId)}</b>
                  <p>{v.scene}</p>
                  <div className="row">
                    {v.status === "completed" && <a className="chip solid" href={`${clip(v.id)}&download`} style={{ textDecoration: "none" }}>Save</a>}
                    <span className="chip">{v.aspect}</span>
                    {v.gpuSeconds ? <span className="chip">{videoCredits(v.gpuSeconds)} credits</span> : null}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b style={{ color: "var(--text)", fontSize: 16 }}>No videos yet</b>
            <span>Pick a character, describe a scene and press Make video. It takes a few minutes.</span>
          </div>
        ))}

        {tab === "how" && (
          <>
            <div className="hero">
              <div>
                <h1>One face, every post</h1>
                <p>Make a character once, from traits or from a photo. Susano draws a character sheet, a close-up and a full-body shot, and every photo after that uses it as the reference, so the face, hair and outfit stay the same.</p>
              </div>
            </div>
            <div className="steps">
              {[
                ["Create the character", "Pick traits, or add one to three photos of yourself or someone who agreed. You get a two-panel sheet."],
                ["Keep it", "Every sheet you keep is a character in your library, ready to use."],
                ["Make photos and videos", "Write the scene and pick a format. Photos use the sheet as reference; in videos RefMods turns both halves of the sheet into one identity."],
              ].map(([t, d], i) => (
                <div key={t} className="card step"><span className="k">Step {i + 1}</span><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
            <div className="card credits">
              <b>Credits</b>
              <span className="lbl">Photos of real people need their permission. Famous people and anyone who hasn&apos;t agreed are off limits.</span>
              <ul>
                {CREDITS.map((c) => <li key={c.what}><a href={c.url} target="_blank" rel="noreferrer">{c.what}</a> by {c.by}</li>)}
              </ul>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
