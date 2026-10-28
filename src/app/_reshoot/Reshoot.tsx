"use client";
// The flow and the camera preview are Comfy Org's Reshoot app (github.com/Comfy-Org/comfy-reshoot, MIT), restyled.
import { useEffect, useMemo, useRef, useState } from "react";
import { estimatePivot, focalPx, invertPose, orbitPose, sourceAim } from "@/lib/crossview/camera";
import { readGeometry, type Geometry } from "@/lib/crossview/cvgeo";
import { WarpRenderer } from "@/lib/crossview/warp-renderer";

type Output = { id: string; name: string; type: string; url: string };
type Job = { id: string; status: string; outputs: Output[]; error?: { message?: string } | string | null };
type Tab = "studio" | "how";

const CREDITS = [
  { what: "Reshoot (app, workflows and camera preview)", by: "Comfy Org", url: "https://github.com/Comfy-Org/comfy-reshoot" },
  { what: "CrossView Warp nodes", by: "comfyrob", url: "https://github.com/comfyrob/ComfyUI-CrossViewWarp" },
  { what: "CrossView Warp LoRA for MiniMax H3", by: "Cseti", url: "https://huggingface.co/Cseti/MiniMax-H3_Ref2VA-LoRA-CrossView-Warp_v1" },
  { what: "MoGe-2 depth", by: "Microsoft Research", url: "https://huggingface.co/Comfy-Org/MoGe" },
  { what: "MiniMax H3 and its 8-step turbo LoRA", by: "MiniMax, lightx2v", url: "https://huggingface.co/Comfy-Org/MiniMax-H3" },
];

function errorText(error: unknown): string {
  const message = typeof error === "string" ? error : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string" ? (Reflect.get(error, "message") as string) : "";
  const missingNode = message.match(/Node ['"]([^'"]+)['"] not found/i)?.[1];
  if (missingNode) return `The Reshoot deployment is missing the “${missingNode}” node.`;
  return message || "Comfy could not run this workflow.";
}

export function Reshoot() {
  const [tab, setTab] = useState<Tab>("studio");
  const [video, setVideo] = useState<File | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [pollRetry, setPollRetry] = useState(0);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "ready" | "generating">("idle");
  const [message, setMessage] = useState("Add a 5 to 15 second MP4 clip.");
  const [error, setError] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [elevation, setElevation] = useState(0);
  const [distance, setDistance] = useState(1);
  const [aspect, setAspect] = useState("16:9");
  const [megapixels, setMegapixels] = useState(0.4);
  const [prompt, setPrompt] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const objectUrl = useMemo(() => (video ? URL.createObjectURL(video) : undefined), [video]);

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  // Live camera preview: the first frame, warped by its depth to the chosen camera.
  useEffect(() => {
    if (!geometry || !canvas.current) return;
    let disposed = false;
    const renderer = new WarpRenderer(canvas.current, geometry.width, geometry.height);
    createImageBitmap(geometry.jpegs[0]).then((image) => {
      if (disposed) { image.close(); return; }
      renderer.setFrame(image, geometry.depthHalf[0], geometry.depth[0]);
      const fx = focalPx(geometry.width, 50);
      const pivot = estimatePivot(geometry.depth[0], geometry.width, geometry.height, fx);
      renderer.render({
        inverseTarget: invertPose(orbitPose(azimuth, elevation, distance, pivot, sourceAim(pivot))),
        fx,
        sourceFx: fx,
        cx: geometry.width / 2,
        cy: geometry.height / 2,
      });
      image.close();
    }).catch((cause: unknown) => {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Could not draw the camera preview.");
    });
    return () => { disposed = true; renderer.dispose(); };
  }, [geometry, azimuth, elevation, distance]);

  useEffect(() => {
    if (!job || !["queued", "running", "pending"].includes(job.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/reshoot/${job.id}`);
        const next = (await response.json()) as Job & { error?: string };
        if (!response.ok) throw new Error(typeof next.error === "string" ? next.error : "Could not check the job.");
        setJob(next);
        setPollRetry(0);
        setMessage(next.status === "queued" ? "Waiting for a GPU… the first run can take a few minutes." : "Working on it…");
      } catch (cause) {
        setError(true);
        setMessage(cause instanceof Error ? cause.message : "Could not check the job.");
        setPollRetry((retry) => retry + 1);
      }
    }, pollRetry ? 5000 : 2000);
    return () => window.clearTimeout(timer);
  }, [job, pollRetry]);

  useEffect(() => {
    if (!job || !["succeeded", "failed", "canceled", "expired"].includes(job.status)) return;
    if (phase === "analyzing" && job.status === "succeeded") {
      const file = job.outputs.find((output) => output.name.endsWith(".cvgeo"));
      if (!file) {
        setPhase("idle"); setJob(null); setError(true);
        setMessage("The depth analysis finished without a depth file. Try again.");
        return;
      }
      fetch(file.url).then((response) => {
        if (!response.ok) throw new Error("Could not download the depth preview.");
        return response.arrayBuffer();
      }).then(readGeometry).then((value) => {
        setGeometry(value);
        // Done with the analyze job; keeping it would read as a finished generation on the next render.
        setJob(null);
        setPhase("ready");
        setError(false);
        setMessage("Depth is ready. Move the camera, then generate.");
      }).catch((cause: unknown) => {
        setPhase("idle"); setJob(null); setError(true);
        setMessage(cause instanceof Error ? cause.message : "Could not read the depth preview.");
      });
    } else if (job.status === "succeeded") {
      setPhase("ready"); setError(false); setMessage("Done. Watch or save the new shot below.");
    } else {
      setPhase(geometry ? "ready" : "idle"); setError(true);
      setMessage(`${errorText(job.error)} (job ${job.id})`);
    }
  }, [job, phase, geometry]);

  async function submit(step: "analyze" | "generate") {
    if (!video || phase === "analyzing" || phase === "generating") return;
    setError(false); setJob(null); setPhase(step === "analyze" ? "analyzing" : "generating");
    setMessage(step === "analyze" ? "Uploading the clip and reading its depth…" : "Uploading the clip and filming the new view…");
    const form = new FormData();
    form.set("video", video);
    form.set("step", step);
    form.set("aspect", aspect);
    form.set("megapixels", String(megapixels));
    form.set("azimuth", String(azimuth));
    form.set("elevation", String(elevation));
    form.set("distance", String(distance));
    form.set("prompt", prompt);
    try {
      const response = await fetch("/api/reshoot", { method: "POST", body: form });
      const next = (await response.json()) as Job & { error?: string };
      if (!response.ok) throw new Error(next.error || "Could not start.");
      setJob(next); setMessage("Sent to the GPU.");
    } catch (cause) {
      setPhase(geometry ? "ready" : "idle"); setError(true);
      setMessage(cause instanceof Error ? cause.message : "Could not start.");
    }
  }

  function chooseVideo(file: File | undefined) {
    setError(false);
    setVideo(null); setGeometry(null); setJob(null); setPhase("idle");
    if (!file) { setMessage("Add a 5 to 15 second MP4 clip."); return; }
    if (file.type !== "video/mp4") { setError(true); setMessage("Choose an MP4 clip."); return; }
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (probe.duration < 5 || probe.duration > 15) { setError(true); setMessage("Reshoot takes clips between 5 and 15 seconds."); return; }
      setVideo(file); setError(false); setMessage("Clip ready. Read its depth to start.");
    };
    probe.onerror = () => { URL.revokeObjectURL(url); setError(true); setMessage("This video can't be read."); };
    probe.src = url;
  }

  /** The 5 s room clip that ships with Comfy's Reshoot app. */
  async function trySample() {
    const blob = await (await fetch("/samples/sunlit-room-test.mp4")).blob();
    chooseVideo(new File([blob], "sunlit-room-test.mp4", { type: "video/mp4" }));
  }

  const results = job?.status === "succeeded" && phase === "ready" ? job.outputs.filter((output) => /result|original-audio|warp/i.test(output.name)) : [];
  const busy = phase === "analyzing" || phase === "generating";
  const settingsChanged = () => { setGeometry(null); setJob(null); setPhase("idle"); setMessage("Settings changed. Read the depth again."); setError(false); };
  const label = (name: string) => (/warp/i.test(name) ? "Warp guide" : /original-audio/i.test(name) ? "New view, original sound" : "New view");

  return (
    <main className="work">
      <aside className="panel glass" aria-label="Create">
        <div className="banner" style={{ background: "linear-gradient(120deg,#2a8a7a,#1a4a50 60%,#0e1a1c)" }}>
          <div><b>Reshoot</b><span style={{ color: "#cfeae4" }}>Move the camera after the shot</span></div>
        </div>

        <label className={`card ${video ? "quality" : "drop"}`} style={video ? { position: "relative" } : undefined}>
          <input type="file" accept="video/mp4" disabled={busy} onChange={(e) => chooseVideo(e.target.files?.[0])} style={video ? { position: "absolute", inset: 0, opacity: 0, cursor: "pointer" } : undefined} />
          {video ? (
            <><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{video.name}</span><span className="link">Replace</span></>
          ) : (
            <><span className="icon">▶</span><b>Add a video</b><span className="lbl">MP4, 5 to 15 seconds</span></>
          )}
        </label>
        {!video && (
          <button type="button" className="link" style={{ alignSelf: "center" }} disabled={busy} onClick={() => void trySample()}>
            or try Comfy&apos;s sample clip
          </button>
        )}

        <div className="card quality">
          <span className="lbl" style={{ fontSize: 13 }}>Shape</span>
          <div className="seg" role="group" aria-label="Aspect ratio">
            {["16:9", "9:16", "1:1", "4:3"].map((a) => (
              <button key={a} type="button" disabled={busy} aria-pressed={aspect === a} onClick={() => { setAspect(a); settingsChanged(); }}>{a}</button>
            ))}
          </div>
        </div>
        <div className="card quality">
          <span className="lbl" style={{ fontSize: 13 }}>Quality</span>
          <div className="seg" role="group" aria-label="Quality">
            {[[0.4, "480p"], [1, "768p"]].map(([mp, l]) => (
              <button key={l} type="button" disabled={busy} aria-pressed={megapixels === mp} onClick={() => { setMegapixels(Number(mp)); settingsChanged(); }}>{l}</button>
            ))}
          </div>
        </div>

        <button type="button" className="btn" style={{ justifyContent: "center" }} disabled={!video || busy} onClick={() => void submit("analyze")}>
          {phase === "analyzing" ? "Reading depth…" : "1 · Read depth"}
        </button>

        <fieldset className="card sliders" disabled={!geometry || phase === "generating"}>
          <legend className="lbl">2 · Aim the camera</legend>
          <label><span>Orbit · {azimuth}°</span><input type="range" min="-45" max="45" value={azimuth} onChange={(e) => setAzimuth(Number(e.target.value))} /></label>
          <label><span>Height · {elevation}°</span><input type="range" min="-30" max="30" value={elevation} onChange={(e) => setElevation(Number(e.target.value))} /></label>
          <label><span>Distance · {distance.toFixed(2)}×</span><input type="range" min="0.5" max="2" step="0.05" value={distance} onChange={(e) => setDistance(Number(e.target.value))} /></label>
        </fieldset>

        <div className="card promptbox">
          <span>What is beyond the frame? <span className="lbl">· optional</span></span>
          <textarea value={prompt} maxLength={500} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what the new view should reveal." />
        </div>

        <div className="generate">
          <span className={error ? "error" : "lbl"} role="status" style={{ textAlign: "center" }}>{message}</span>
          <button type="button" className="cta" disabled={!video || !geometry || busy} onClick={() => void submit("generate")}>
            {phase === "generating" ? "Filming…" : "3 · Film the new view"}
          </button>
          <span className="lbl" style={{ textAlign: "center" }}>MoGe, CrossView Warp and MiniMax H3 on a Comfy deployment</span>
        </div>
      </aside>

      <section className="stage glass">
        <div className="tabs" role="tablist">
          {(["studio", "how"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === "studio" ? "Camera" : "How it works"}</button>
          ))}
        </div>

        {tab === "studio" && (
          <>
            <div className="media reshoot-preview">
              {geometry ? <canvas ref={canvas} /> : objectUrl ? <video src={objectUrl} controls muted playsInline /> : (
                <div className="empty" style={{ border: 0 }}><span>Add a clip and read its depth to aim a new camera here.</span></div>
              )}
            </div>
            {geometry && <span className="lbl">Magenta shows what the original camera never saw; the model fills it in.</span>}
            {results.length > 0 && (
              <div className="stills">
                {results.map((output) => (
                  <figure key={output.id} className="card still">
                    <video controls playsInline src={output.url} style={{ width: "100%", display: "block", background: "#000" }} />
                    <figcaption>
                      <p>{label(output.name)}</p>
                      <div className="row"><a className="chip solid" href={output.url} download={output.name} style={{ textDecoration: "none" }}>Save</a></div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "how" && (
          <>
            <div className="hero">
              <div>
                <h1>Move the camera after the shot</h1>
                <p>Reshoot reads the depth of your clip, lets you place a new camera around it, then films the same moment from there and fills in what the original camera never saw.</p>
              </div>
            </div>
            <div className="card credits">
              <b>Credits</b>
              <span className="lbl">Reshoot is Comfy&apos;s Reshoot app and workflows, unchanged, running on a Comfy deployment.</span>
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
