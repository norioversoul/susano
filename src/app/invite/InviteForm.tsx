"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

export function InviteForm() {
  const next = useSearchParams().get("next");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (!r.ok) {
        setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work. Try again.");
        return;
      }
      // Only paths on this site, never another host.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="invite-form">
      <label htmlFor="code" className="sr-only">Invite code</label>
      <input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus />
      <button type="submit" className="cta" disabled={!code.trim() || busy}>{busy ? "Checking…" : "Enter"}</button>
      {error && <p className="invite-error" role="alert">{error}</p>}
    </form>
  );
}
