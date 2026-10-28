"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { titleOf, type JobView } from "./History";

const WHEN = new Intl.DateTimeFormat("en", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** The five latest Openjutsu videos on the Studio page. */
export function Recent() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  useEffect(() => {
    fetch("/api/jobs", { cache: "no-store" }).then((r) => r.json()).then(setJobs).catch(() => setJobs([]));
  }, []);
  if (!jobs?.length) return null;
  return (
    <section aria-label="Recent" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="section-head">
        <h2>Recent</h2>
        <Link href="/openjutsu?tab=history" className="lbl" style={{ fontSize: 14, textDecoration: "none" }}>See all</Link>
      </div>
      <div className="recent">
        {jobs.slice(0, 5).map((j) => (
          <Link key={j.id} href={`/openjutsu?job=${j.id}`} className="card">
            <div className="thumb">
              {j.status === "completed" && <video src={`/api/jobs/${j.id}/media/result#t=0.5`} muted playsInline preload="metadata" />}
            </div>
            <div className="meta">
              <div>{titleOf(j)}</div>
              <div className="lbl">
                {j.status === "completed" ? WHEN.format(j.createdAt) : j.status === "failed" ? "Didn't work" : "In progress"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
