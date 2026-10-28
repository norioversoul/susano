// Influencer product rules shared by the browser and the server (no secrets, no Node APIs).
// A character is made once as a two-panel sheet (face close-up | full body, white background), from traits or from the
// user's own reference photos. Photos of the character then use that sheet as FLUX.2 [dev]'s reference.

type Option = { id: string; label: string; prompt: string };
export type TraitGroup = { key: string; label: string; max: number; options: Option[] };

const opts = (pairs: [string, string, string?][]): Option[] => pairs.map(([id, label, prompt]) => ({ id, label, prompt: prompt ?? label.toLowerCase() }));

/** Adults only: the youngest choice is someone in their twenties. */
export const TRAITS: TraitGroup[] = [
  { key: "gender", label: "Gender", max: 1, options: opts([["woman", "Woman"], ["man", "Man"], ["nonbinary", "Non-binary", "androgynous non-binary person"]]) },
  { key: "age", label: "Age", max: 1, options: opts([["20s", "20s", "in their twenties"], ["30s", "30s", "in their thirties"], ["40s", "40s", "in their forties"], ["60s", "60+", "in their sixties"]]) },
  { key: "build", label: "Build", max: 1, options: opts([["slim", "Slim", "slim build"], ["athletic", "Athletic", "athletic build"], ["muscular", "Muscular", "muscular build"], ["curvy", "Curvy", "curvy build"], ["heavy", "Heavy", "heavy-set build"]]) },
  { key: "hair", label: "Hair", max: 1, options: opts([["long", "Long", "long hair"], ["short", "Short", "short hair"], ["bob", "Bob", "bob haircut"], ["curly", "Curly", "curly hair"], ["braids", "Braids", "braided hair"], ["afro", "Afro", "afro hair"], ["ponytail", "Ponytail", "hair in a ponytail"], ["mullet", "Mullet", "mullet haircut"], ["buzz", "Buzz cut", "buzz cut"], ["bald", "Bald", "shaved bald head"]]) },
  { key: "hairColour", label: "Hair colour", max: 1, options: opts([["black", "Black", "jet black"], ["darkbrown", "Dark brown"], ["chestnut", "Chestnut"], ["blonde", "Blonde"], ["platinum", "Platinum", "platinum blonde"], ["ginger", "Ginger"], ["red", "Red", "bright red"], ["grey", "Grey"], ["pink", "Pastel pink"], ["blue", "Blue"], ["green", "Green"]]) },
  { key: "skin", label: "Skin", max: 1, options: opts([["porcelain", "Porcelain", "porcelain skin"], ["fair", "Fair", "fair skin"], ["light", "Light", "light skin"], ["olive", "Olive", "olive skin"], ["tan", "Tan", "tan skin"], ["brown", "Brown", "brown skin"], ["deep", "Deep brown", "deep brown skin"]]) },
  { key: "eyes", label: "Eyes", max: 1, options: opts([["brown", "Brown", "brown eyes"], ["hazel", "Hazel", "hazel eyes"], ["green", "Green", "green eyes"], ["blue", "Blue", "blue eyes"], ["grey", "Grey", "grey eyes"], ["amber", "Amber", "amber eyes"]]) },
  { key: "style", label: "Style", max: 1, options: opts([["street", "Streetwear", "contemporary streetwear outfit"], ["casual", "Casual", "casual everyday outfit"], ["sporty", "Sporty", "sporty athleisure outfit"], ["suits", "Suits", "tailored suit"], ["y2k", "Y2K", "Y2K-style outfit"], ["goth", "Goth", "goth outfit"], ["retro", "Retro", "retro vintage outfit"], ["runway", "Runway", "avant-garde runway outfit"]]) },
  { key: "facialHair", label: "Facial hair", max: 1, options: opts([["none", "Clean", "clean-shaven"], ["stubble", "Stubble"], ["beard", "Full beard", "full beard"], ["moustache", "Moustache"], ["goatee", "Goatee"]]) },
  { key: "features", label: "Features", max: 4, options: opts([["freckles", "Freckles"], ["dimples", "Dimples"], ["cheekbones", "High cheekbones"], ["brows", "Thick brows", "thick eyebrows"], ["mole", "Beauty mark"], ["lips", "Full lips"], ["gap", "Gap teeth", "a small gap between the front teeth"], ["jaw", "Strong jaw", "a strong jawline"]]) },
  { key: "distinctive", label: "Distinctive", max: 2, options: opts([["tattoo", "Face tattoo", "a small face tattoo"], ["septum", "Septum piercing"], ["ears", "Ear piercings"], ["grill", "Gold grill", "a gold teeth grill"], ["braces", "Braces", "metal braces"], ["scar", "Brow scar", "a scar through one eyebrow"], ["odd", "Odd eyes", "heterochromia, one eye a different colour"], ["gems", "Face gems"]]) },
  { key: "accessories", label: "Accessories", max: 3, options: opts([["glasses", "Glasses"], ["sunglasses", "Sunglasses"], ["headphones", "Headphones"], ["jewelry", "Jewelry", "layered jewelry"], ["cap", "Cap", "a baseball cap"], ["hat", "Hat", "a hat"], ["bag", "Bag", "a shoulder bag"]]) },
];

export type Traits = Record<string, string[]>;

/** Keep only known options, at most `max` per group. */
export function cleanTraits(value: unknown): Traits {
  const out: Traits = {};
  if (!value || typeof value !== "object") return out;
  for (const g of TRAITS) {
    const picked = (value as Record<string, unknown>)[g.key];
    if (!Array.isArray(picked)) continue;
    const ok = picked.filter((id): id is string => typeof id === "string" && g.options.some((o) => o.id === id)).slice(0, g.max);
    if (ok.length) out[g.key] = ok;
  }
  return out;
}

/** One pick per single-choice group, a couple of extras: the "Surprise me" button. */
export function randomTraits(rand: () => number = Math.random): Traits {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const out: Traits = {};
  for (const g of TRAITS) {
    if (g.max === 1) {
      if (g.key === "facialHair" && out.gender?.[0] === "woman") continue;
      out[g.key] = [pick(g.options).id];
    } else {
      const n = Math.floor(rand() * Math.min(3, g.max));
      const ids = [...g.options].sort(() => rand() - 0.5).slice(0, n).map((o) => o.id);
      if (ids.length) out[g.key] = ids;
    }
  }
  return out;
}

const label = (key: string, id: string) => TRAITS.find((g) => g.key === key)?.options.find((o) => o.id === id);

/** The traits as one description of the person, for the image model. */
export function describe(traits: Traits): string {
  const p = (key: string) => (traits[key] ?? []).map((id) => label(key, id)?.prompt).filter(Boolean) as string[];
  const who = [p("gender")[0] ?? "person", p("age")[0]].filter(Boolean).join(" ");
  const hair = [p("hairColour")[0], p("hair")[0]].filter(Boolean).join(" ");
  const parts = [p("build")[0], hair, p("skin")[0], p("eyes")[0], p("facialHair")[0], ...p("features"), ...p("distinctive")].filter(Boolean);
  const wearing = [p("style")[0], ...p("accessories")].filter(Boolean);
  return [`A ${who}`, parts.length ? `with ${parts.join(", ")}` : "", wearing.length ? `wearing a ${wearing.join(" and ")}` : ""].filter(Boolean).join(" ") + ".";
}

/** The character sheet prompt. With reference photos, the person comes from them and the traits only change things. */
export function sheetPrompt(traits: Traits, extra: string, fromImage: boolean): string {
  const person = fromImage
    ? `The person is exactly the person in the reference image: keep their face, identity, skin tone and features.${Object.keys(traits).length ? ` Changes: ${describe(traits)}` : ""}`
    : describe(traits);
  return [
    "Character sheet photograph with two panels side by side on a pure white seamless background, bright soft studio light.",
    "Left panel: a tight frontal close-up portrait with the entire head and hair in frame.",
    "Right panel: a full-body standing shot of the same person in the same outfit, front-facing, arms relaxed at the sides.",
    "Neutral, calm expression.",
    person,
    extra.trim(),
    "Hyper-realistic photo, natural skin texture, sharp focus, 85mm lens.",
  ].filter(Boolean).join(" ");
}

/** A photo of a saved character in a scene, with the sheet as reference. */
export function photoPrompt(scene: string): string {
  return `${scene.trim()} The person is the character from the reference character sheet: the same face, hair, body and outfit unless the scene says otherwise. A natural, candid social media photo, realistic light, sharp focus.`;
}

/** The sheet: 16:9 at about 1.3 megapixels, two portrait-ish panels. */
export const SHEET_SIZE = { width: 1536, height: 864 };

export type Aspect = "9:16" | "4:5" | "1:1" | "16:9";
export const ASPECTS: { key: Aspect; label: string; width: number; height: number }[] = [
  { key: "9:16", label: "9:16", width: 768, height: 1344 },
  { key: "4:5", label: "4:5", width: 896, height: 1120 },
  { key: "1:1", label: "1:1", width: 1024, height: 1024 },
  { key: "16:9", label: "16:9", width: 1344, height: 768 },
];

export type VideoAspect = "9:16" | "1:1" | "16:9";
/** SEEDHUNTER's own frame choices (ComfyUI's ResolutionSelector), always at its 0.5 MP. */
export const VIDEO_ASPECTS: { key: VideoAspect; selector: string }[] = [
  { key: "9:16", selector: "9:16 (Portrait Widescreen)" },
  { key: "1:1", selector: "1:1 (Square)" },
  { key: "16:9", selector: "16:9 (Widescreen)" },
];

/** A 5 s video of a character: the scene, with the character held by RefMods from both halves of the sheet. */
export function videoPrompt(scene: string): string {
  return `subject_definitions:
<Subject 1> is the person shown in <Picture 1> (face) and <Picture 2> (full body); their face, hair, body and outfit stay the same.

summary:
[reference generation] ${scene}

retention_analysis:
N/A
detailed_description:
${scene}

[Shot 1]: ${scene} One continuous shot, no cuts.

overall_soundscape:
the natural sound of the scene

non_diegetic_music:
N/A`;
}

/** Deployment GPU for one 5 s SEEDHUNTER clip (measured with Tsukuyomi: about 80 s), at the deployment's $3.49/h. */
export const VIDEO_GPU_SECONDS = 80;
export function videoCredits(gpuSeconds: number): number {
  return Math.round((gpuSeconds / 3600) * 3.49 * CREDITS_PER_USD);
}

const RATE_USD_PER_HOUR = 4.54; // Comfy Cloud
const CREDITS_PER_USD = 211;

/** GPU seconds per image on Comfy Cloud, measured 2026-10-28: a 1536x864 sheet 46 s (61 s from one reference photo),
 *  a 4:5 photo with the sheet as reference 34 s. */
export const GPU_SECONDS = { sheet: 46, sheetFromImage: 61, photo: 34 };

export function creditsFor(gpuSeconds: number): number {
  return Math.round((gpuSeconds / 3600) * RATE_USD_PER_HOUR * CREDITS_PER_USD);
}

export const MAX_REFS = 3;

export const CREDITS: { what: string; by: string; url: string }[] = [
  { what: "FLUX.2 [dev] (sheets and photos)", by: "Black Forest Labs", url: "https://huggingface.co/black-forest-labs/FLUX.2-dev" },
  { what: "RefMods for MiniMax H3 (keeps the face in videos)", by: "Luisacaotica", url: "https://github.com/Luisacaotica/ComfyUI-MiniMaxH3Mod" },
  { what: "SEEDHUNTER v2.51 workflow (renders the videos, unchanged)", by: "foxydits", url: "https://civitai.com/user/foxydits" },
  { what: "MiniMax H3", by: "MiniMax", url: "https://huggingface.co/Comfy-Org/MiniMax-H3" },
  { what: "ComfyUI and Comfy Cloud", by: "Comfy Org", url: "https://comfy.org" },
];
