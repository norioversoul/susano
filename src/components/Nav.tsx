"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Studio" },
  { href: "/openjutsu", label: "Openjutsu" },
  { href: "/tsukuyomi", label: "Tsukuyomi" },
  { href: "/cinematic", label: "Cinematic" },
  { href: "/influencer", label: "Influencer" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
