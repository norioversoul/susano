"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

/** A finished Influencer character, as the other apps cast it. */
export type CastMember = { id: string; name: string };

export const castFace = (id: string) => `/api/influencer/characters/${id}?panel=face`;

/** The Influencer library's finished characters; null until loaded. */
export function useCast(): CastMember[] | null {
  const [cast, setCast] = useState<CastMember[] | null>(null);
  useEffect(() => {
    fetch("/api/influencer/characters", { cache: "no-store" })
      .then((r) => r.json())
      .then((all: (CastMember & { status: string })[]) => setCast(all.filter((c) => c.status === "completed").map(({ id, name }) => ({ id, name }))))
      .catch(() => setCast([]));
  }, []);
  return cast;
}

/** Pick one of your Influencer characters. Shows a way to make one when the library is empty. */
export function CastPicker({ cast, chosen, onPick, label = "Your characters" }: {
  cast: CastMember[] | null;
  chosen?: string[];
  onPick: (c: CastMember) => void;
  label?: string;
}) {
  if (!cast) return null;
  return (
    <div className="cast">
      <span className="lbl">{label}</span>
      {cast.length ? (
        <div className="picker" role="group" aria-label="Characters">
          {cast.map((c) => (
            <button key={c.id} type="button" aria-pressed={!!chosen?.includes(c.id)} onClick={() => onPick(c)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={castFace(c.id)} alt="" />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <span className="lbl">
          <Link href="/influencer">Create a character in Influencer</Link> and cast them here.
        </span>
      )}
    </div>
  );
}
