# Susano

An open-weights creative studio on ComfyUI. Four apps, one cast of characters, no closed APIs anywhere, prompt writing included.

| App | What it does | Runs on |
|---|---|---|
| **Openjutsu** | Star in any video. Add a clip and photos (or your characters); motion, camera, background and sound stay. | Comfy Cloud |
| **Tsukuyomi** | An infinite dream. Write the start, or continue a video you upload; a director model writes each next beat and the film keeps going, part after part. | Comfy Cloud (director) + a Comfy deployment (renderer) |
| **Cinematic** | Direct a single frame: shot, camera, light and look. | Comfy Cloud |
| **Influencer** | Invent a character from traits or 1–3 photos, then make photos and videos of them. Same face in every post. | Comfy Cloud (sheets, photos) + the Comfy deployment (videos) |

Susano's Openjutsu is not Comfy Org's [comfy-openjutsu](https://github.com/Comfy-Org/comfy-openjutsu), which shares the name and idea. Susano's version runs on open weights only (Alissonerdx's Character Swap recipe on Comfy Cloud, no closed first-frame anchor), swaps several people at once, and can cast your Influencer characters.

**Cast across apps.** A character made in Influencer can be cast in Openjutsu or star in a Tsukuyomi dream. Their two-panel character sheet (face and full body) goes in as references, and in video apps RefMods turns it into one identity that is applied in every part.

## Models (all open weights)

- **MiniMax H3** for every video: Character Swap v1.1 LoRA by Alissonerdx, the 8-step DMD turbo LoRA by drbaph, and SEEDHUNTER v2.51 by foxydits on the Singularity ref2va checkpoint with Kijai's DMAD 4-step LoRA.
- **RefMods** (ComfyUI-MiniMaxH3Mod by Luisacaotica) for character identity in video.
- **Qwen3.5-9B** (TextGenerate) writes prompts and directs Tsukuyomi; **BiRefNet** cuts out reference photos.
- **FLUX.2 [dev]** draws Influencer sheets and photos and Cinematic frames. Cinematic uses Comfy Org's Cinematic Studio prompt unchanged, with FLUX.2 [dev] in place of FLUX.2 [pro].

Check each model's licence before commercial use. FLUX.2 [dev] in particular is released under a non-commercial licence.

## Safe mode

On by default, with a switch in the top bar. Before anything is generated, Qwen3.5-9B on Comfy Cloud looks at what the user sent: their photos, four frames of each video (in one grid) and their text. It answers SAFE or UNSAFE with a reason. It turns down nudity and sexual content (drawings and anime included), anything suggestive involving someone who looks under 18, graphic gore and hate symbols. Obvious words are blocked before any GPU work. If the check itself can't run, nothing is generated. The Tsukuyomi director is also told to keep every shot safe for work.

A check takes about 20–40 s on Comfy Cloud. Characters cast from Influencer were checked when they were made. Generated outputs are not checked again.

## How it works

```
Browser ── Next.js (this repo) ──┬── Comfy Cloud /api/prompt   Openjutsu, Cinematic, Influencer sheets/photos,
                                 │                             the Tsukuyomi director (Qwen3.5)
                                 └── Comfy deployment          SEEDHUNTER (+ RefMods): Tsukuyomi parts,
                                     (@comfyorg/sdk)           Influencer videos
```

- Workflows are API-format graphs built in `src/lib/*.ts` (Comfy Cloud) or loaded from `workflows/seedhunter/` and patched per job (deployment). Uploaded files go in as assets.
- A Tsukuyomi part is two jobs: the director watches the end of the film so far and writes the next beat, then SEEDHUNTER renders it in Seamless Continuation mode. The app repeats this until the chosen length or until you wake it.
- Jobs and media are stored on disk in `var/` (git-ignored). There is no database and no login: this is a single-user studio you run yourself.

## Setup

Requirements: Node.js 20+, a Comfy account with an API key, and comfy-cli for the deployment (`pip install -U comfy-cli`).

```bash
git clone <this repo> susano && cd susano
npm install
cp .env.example .env.local   # add COMFY_CLOUD_API_KEY
npm run dev                  # http://localhost:3000
```

ffmpeg and ffprobe come from npm (`ffmpeg-static`, `ffprobe-static`); nothing else to install.

### Comfy Cloud models

Openjutsu loads two community LoRAs by name. Import them into your Comfy Cloud models from Hugging Face (`Alissonerdx/Minimax-H3-ComfyUI`: character swap v1.1; `drbaph/MiniMax-H3-Turbo-Lora-ComfyUI`: 8-step turbo). If your imported names differ, set `SUSANO_SWAP_LORA` and `SUSANO_TURBO_LORA`. Everything else is in Comfy Cloud's model library.

### The Tsukuyomi deployment

Tsukuyomi parts and Influencer videos need custom node packs that Comfy Cloud doesn't have, so they run on a Comfy deployment built from `deploy/tsukuyomi/comfy-build.yaml` (12 packs pinned by commit, 5 models fetched from Hugging Face by hash).

```bash
comfy cloud login
comfy build push deploy/tsukuyomi
comfy build release create deploy/tsukuyomi --target linux/nvidia --watch
comfy deploy up deploy/tsukuyomi --gpu rtx-pro-6000-server --region anywhere --min 0 --max 1
comfy deploy ls deploy/tsukuyomi   # copy endpointUrl into SUSANO_TSUKUYOMI_URL
```

A deployment bills while it is up. With `--min 0` it scales to zero between jobs; `comfy deploy stop deploy/tsukuyomi` stops it completely. The app waits for a waking deployment for up to 20 minutes.

### Run it online

For a shared instance (like susano.studio), set these as well:

| Variable | Does |
|---|---|
| `SUSANO_INVITE_CODES` | Comma-separated codes. Every page and API then sits behind an invite page. |
| `SUSANO_SAFE_MODE=locked` | Safe mode always on; the switch only shows its state. |
| `SUSANO_DAILY_LIMIT` | Generations allowed per day for the whole instance. |
| `SUSANO_MAX_DREAM_PARTS` | Longest Tsukuyomi dream, in 5 s parts. |

Susano keeps jobs and media on disk in `var/` and runs ffmpeg, so it needs an always-on Node server with a persistent disk, not serverless. On Railway: create a project from this repo, add a volume mounted at `/app/var`, set the variables above plus `COMFY_CLOUD_API_KEY` and `SUSANO_TSUKUYOMI_URL`, and add your domain. Railway builds with `npm run build` and starts with `npm start`. Everyone with a code shares one history.

## Costs (measured)

Comfy Cloud and an RTX PRO 6000 deployment, October 2026:

| Job | GPU time |
|---|---|
| Openjutsu, 4.5 s clip, two people, 544p | 89 s |
| Influencer character sheet / photo | 46 s / 34 s |
| Influencer video, 5 s, 9:16 | 88 s |
| Tsukuyomi part, 5 s (director + render) | about 150 s |

A cold deployment adds a few minutes of wake-up time, which is billed.

## Credits

- [Character Swap LoRA](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI) by Alissonerdx
- [SEEDHUNTER v2.5.1](https://civitai.com/models/2881362) by foxydits, included in `workflows/seedhunter/` and run unchanged apart from RefMods (see `THIRD_PARTY_NOTICES/SEEDHUNTER-NOTICE.md`)
- [ComfyUI-MiniMaxH3Mod](https://github.com/Luisacaotica/ComfyUI-MiniMaxH3Mod) (RefMods) by Luisacaotica
- [Cinematic Studio](https://github.com/Comfy-Org/comfy-cinematic-studio) by Comfy Org (MIT)
- The custom node packs listed in `deploy/tsukuyomi/comfy-build.yaml`, and the notices in `THIRD_PARTY_NOTICES/`

## Licence

Code: MIT (see `LICENSE`). Models, LoRAs and third-party workflows keep their own licences.
