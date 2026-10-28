"use client";
import { useRef, useState } from "react";

/** Before/after: two synced videos, the "after" one clipped from the left at the slider position. */
export function CompareSlider({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(50);
  const [playing, setPlaying] = useState(false);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);

  function toggle() {
    const va = a.current, vb = b.current;
    if (!va || !vb) return;
    if (vb.paused) {
      va.currentTime = vb.currentTime;
      void vb.play();
      void va.play();
      setPlaying(true);
    } else {
      vb.pause();
      va.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="compare" style={{ ["--split" as string]: `${split}%` }}>
      <video ref={a} src={before} muted playsInline loop preload="metadata" aria-label="Before" />
      <video
        ref={b}
        className="after"
        src={after}
        playsInline
        loop
        preload="metadata"
        aria-label="After"
        onTimeUpdate={() => {
          const va = a.current, vb = b.current;
          if (va && vb && Math.abs(va.currentTime - vb.currentTime) > 0.15) va.currentTime = vb.currentTime;
        }}
        onEnded={() => setPlaying(false)}
      />
      <span className="tag" style={{ left: 10 }}>Before</span>
      <span className="tag" style={{ right: 10 }}>After</span>
      <div className="line" />
      <div className="knob" aria-hidden="true">‹ ›</div>
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label="Compare before and after"
      />
      <button type="button" className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
    </div>
  );
}
