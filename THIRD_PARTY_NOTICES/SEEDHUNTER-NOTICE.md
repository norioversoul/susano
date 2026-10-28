# SEEDHUNTER v2.5.1 by foxydits

`workflows/seedhunter/normal.api.json` and `workflows/seedhunter/cont.api.json` are API-format exports of
foxydits' MiniMax H3 SEEDHUNTER workflow, version 2.5.1 (Civitai model 2881362), in its Normal and Seamless
Video Continuation modes. They are not Susano's work and are not covered by Susano's MIT licence.

Susano runs them unchanged. Per job it only sets the widgets a user would set (seed, prompt, length, aspect,
LoRA path, output names), fills the Media Loader with the job's pictures and video, and, when a character
stars, inserts two RefMods nodes (ComfyUI-MiniMaxH3Mod) between the conditioning switch and the guiders.

No licence was stated for the workflow. It is included with credit so the app runs as published. If you are
the author and want it removed or credited differently, open an issue and it will be done.

- Author: foxydits (https://civitai.com/user/foxydits)
- Workflow: https://civitai.com/models/2881362
