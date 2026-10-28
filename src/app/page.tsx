import Link from "next/link";
import { Recent } from "@/components/Recent";

/** Each card shows a frame Susano made with that app. */
const APPS: { href?: string; name: string; desc: string; image: string; alt: string; tag: string }[] = [
  { href: "/openjutsu", name: "Openjutsu", desc: "Star in any video. Add a clip and a photo, keep everything else.", image: "/apps/openjutsu.jpg", alt: "Two friends in a park recast as two invented characters", tag: "Video" },
  { href: "/tsukuyomi", name: "Tsukuyomi", desc: "An infinite dream. Write the start, it never ends.", image: "/apps/tsukuyomi.jpg", alt: "An anime duel at a temple gate at sunset", tag: "New" },
  { href: "/cinematic", name: "Cinematic", desc: "Direct a single frame: shot, camera, light and look.", image: "/apps/cinematic.jpg", alt: "A samurai in a rainy neon alley", tag: "Image" },
  { href: "/influencer", name: "Influencer", desc: "Your own AI influencer, from traits or a photo. Same face in every post.", image: "/apps/influencer.jpg", alt: "An invented influencer laughing at a café in Lisbon", tag: "New" },
];

export default function Studio() {
  return (
    <main className="studio glass">
      <h1>What will you<br />create today?</h1>
      <section className="apps" aria-label="Apps">
        {APPS.map((a) => {
          const body = (
            <>
              <div className="art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.image} alt={a.alt} />
                <span className="chip">{a.tag}</span>
              </div>
              <div><div className="name">{a.name}</div><div className="desc">{a.desc}</div></div>
            </>
          );
          return a.href ? (
            <Link key={a.name} href={a.href} className="app card">{body}</Link>
          ) : (
            <div key={a.name} className="app card soon" aria-disabled="true">{body}</div>
          );
        })}
      </section>
      <Recent />
      <p className="footer">
        Built on open models on Comfy Cloud and Comfy deployments. Openjutsu uses the{" "}
        <a href="https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI" target="_blank" rel="noreferrer">Character Swap LoRA v1.1 by Alissonerdx</a>,
        Tsukuyomi renders with <a href="https://civitai.com/user/foxydits" target="_blank" rel="noreferrer">SEEDHUNTER by foxydits</a>,
        Cinematic is <a href="https://github.com/Comfy-Org" target="_blank" rel="noreferrer">Comfy Org&apos;s app</a>, and Influencer draws with FLUX.2 [dev].{" "}
        Credits in each app&apos;s How it works.
      </p>
    </main>
  );
}
