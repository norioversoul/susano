"use client";
import { usePathname } from "next/navigation";

/** Which frame of Susano's own work sits blurred behind each app's glass, and whether it is tinted violet. */
const ROOMS: { prefix: string; image: string; violet?: boolean }[] = [
  { prefix: "/tsukuyomi", image: "/backdrops/tsukuyomi.jpg", violet: true },
  { prefix: "/openjutsu", image: "/backdrops/openjutsu.jpg" },
  { prefix: "/cinematic", image: "/backdrops/cinematic.jpg" },
  { prefix: "/influencer", image: "/backdrops/influencer.jpg" },
];

export function Backdrop() {
  const path = usePathname();
  const room = ROOMS.find((r) => path.startsWith(r.prefix));
  return (
    <div className={`backdrop ${room?.violet ? "violet" : ""}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={room?.image ?? "/backdrops/studio.jpg"} alt="" />
      <div className="veil" />
    </div>
  );
}
