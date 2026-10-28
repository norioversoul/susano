"use client";
import { useEffect, useRef, useState } from "react";
import { CROPS, MIN_SECONDS, type Crop } from "@/lib/openjutsu";

export type Trim = { start: number; end: number; crop: Crop };

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Pick up to `limit` seconds of the video and an optional crop. */
export function TrimSheet({
  url, duration, limit, value, onDone, onClose,
}: {
  url: string;
  duration: number;
  limit: number;
  value: Trim;
  onDone: (t: Trim) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(Math.min(value.end, value.start + limit));
  const [crop, setCrop] = useState<Crop>(value.crop);
  const [now, setNow] = useState(value.start);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep the window between MIN_SECONDS and the limit; moving one edge past the limit drags the other.
  function moveStart(v: number) {
    const s = Math.min(v, duration - MIN_SECONDS);
    setStart(s);
    if (end - s > limit) setEnd(s + limit);
    if (end - s < MIN_SECONDS) setEnd(Math.min(duration, s + MIN_SECONDS));
    seek(s);
  }
  function moveEnd(v: number) {
    const e = Math.max(v, MIN_SECONDS);
    setEnd(e);
    if (e - start > limit) setStart(e - limit);
    if (e - start < MIN_SECONDS) setStart(Math.max(0, e - MIN_SECONDS));
    seek(Math.max(0, e - 1));
  }
  function seek(t: number) {
    if (video.current) video.current.currentTime = t;
  }

  // Crop frame drawn over the preview, centred, in the chosen aspect.
  let cropStyle: React.CSSProperties | undefined;
  if (crop !== "original" && box.w && box.h) {
    const [cw, ch] = crop.split(":").map(Number);
    const a = cw / ch;
    const w = Math.min(box.w, box.h * a);
    const h = w / a;
    cropStyle = { width: w, height: h, left: (box.w - w) / 2, top: (box.h - h) / 2 };
  }

  const pct = (t: number) => `${(t / duration) * 100}%`;
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Trim video">
        <div className="between" style={{ alignItems: "flex-start" }}>
          <div>
            <h2>Pick up to {limit} seconds</h2>
            <div className="lbl" style={{ fontSize: 14, marginTop: 4 }}>
              Your video is {fmt(duration)}. Openjutsu works with {MIN_SECONDS} to {limit} seconds.
            </div>
          </div>
          <button type="button" className="chip" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="preview">
          <div className="frame">
            <video
              ref={video}
              src={url}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = start;
                setBox({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight });
              }}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setNow(t);
                if (t >= end) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = start;
                }
              }}
            />
            {cropStyle && <div className="cropbox" style={cropStyle} />}
          </div>
          <div className="crops" role="group" aria-label="Crop">
            {CROPS.map((c) => (
              <button key={c} type="button" aria-pressed={crop === c} onClick={() => setCrop(c)}>
                {c === "original" ? "Original" : c}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="chip solid"
            style={{ width: 44, height: 44, justifyContent: "center", flex: "0 0 auto" }}
            aria-label="Play selection"
            onClick={() => {
              const v = video.current;
              if (!v) return;
              if (v.paused) {
                if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
                void v.play();
              } else v.pause();
            }}
          >
            ▶
          </button>
          <div className="track">
            <div className="window" style={{ left: pct(start), width: `calc(${pct(end - start)})` }} />
            <div className="head" style={{ left: pct(now) }} />
            <input type="range" min={0} max={duration} step={0.1} value={start} onChange={(e) => moveStart(Number(e.target.value))} aria-label="Start" />
            <input type="range" min={0} max={duration} step={0.1} value={end} onChange={(e) => moveEnd(Number(e.target.value))} aria-label="End" />
          </div>
        </div>

        <div className="foot">
          <span className="chip solid">{fmt(start)} – {fmt(end)}</span>
          <span className="chip">{(end - start).toFixed(1)} s selected</span>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => onDone({ start: 0, end: Math.min(duration, limit), crop })}>
            Use first {limit} s
          </button>
          <button type="button" className="btn primary" onClick={() => onDone({ start, end, crop })}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
