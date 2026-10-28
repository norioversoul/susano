"use client";
import { useEffect, useState } from "react";

type Safety = { safeMode: boolean; locked: boolean };

/** Safe mode switch in the top bar. On a public instance it is locked on and only shows its state. */
export function SafeModeToggle() {
  const [s, setS] = useState<Safety | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  }, []);

  async function flip() {
    if (!s || s.locked || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ safeMode: !s.safeMode }) });
      if (r.ok) setS(await r.json());
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const on = s.safeMode;
  const title = s.locked
    ? "Safe mode is always on here: uploads and prompts are checked before anything is generated."
    : on
      ? "Safe mode is on: uploads and prompts are checked before anything is generated. Click to turn it off."
      : "Safe mode is off. Click to turn it on.";
  return (
    <button type="button" className={`safe-toggle${on ? " on" : ""}`} onClick={flip} disabled={s.locked || busy} title={title} aria-pressed={on}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
        {on && <path d="M9 12l2 2 4-4" />}
      </svg>
      <span>Safe mode{s.locked ? "" : on ? " on" : " off"}</span>
    </button>
  );
}
