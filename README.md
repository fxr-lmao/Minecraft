# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (textures, sky, clouds) is procedurally generated.

## Status (alpha 0.2)

- **Flat world** — 128×128 superflat-style terrain (grass → dirt → dirt → bedrock)
- **Fast rendering** — face-culled voxel meshing: only faces exposed to air are drawn (~18k quads instead of ~393k), merged into 3 draw calls
- **Adaptive resolution** — render scale and shadow quality drop automatically when FPS is low and recover when there's headroom (great on iPads/phones)
- **Player movement** — WASD + mouse look (pointer lock), Minecraft-accurate physics: walk 4.317, sprint 5.612, sneak 1.295 blocks/s, gravity 32 blk/s², jump ≈1.25 blocks
- **Jumping / sprinting / sneaking** — Ctrl or double-tap W to sprint, Shift to sneak, hold Space to keep jumping
- **Keyboard-first start** — press any key (e.g. W) on the title screen to start, so Magic Keyboard / laptop users never need the mouse
- **Touch controls** — on iPad/phones: virtual joystick (left thumb), drag to look (right thumb), on-screen Jump / Sprint / Sneak buttons, tap the hotbar to select blocks
- **HUD** — crosshair, hotbar (block selector), F3 debug screen (position, speed, FPS, pixel scale)
- **Robust loading** — loading screen, friendly error screen if something goes wrong (no more silent black screens), WebGL2 detection

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump (hold to keep jumping) |
| `Ctrl` / double-tap `W` | Sprint |
| `Shift` | Sneak |
| `Mouse` | Look |
| `1–9` / scroll / tap | Select hotbar slot |
| `F3` / on-screen F3 button | Debug screen |
| `Esc` | Release mouse |
| Touch | Left thumb joystick, right thumb look, Jump/Sprint/Sneak buttons |

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Press any key or click the screen to start, then move around.

## Deploying to GitHub Pages (important — read this)

GitHub Pages serves **files from your repo**, it never runs a build. The raw source (with `import 'three'`) therefore can't run on Pages — the HTML loads but the game never starts. You must deploy the **built** site. The build outputs to `docs/` with relative asset paths, ready for Pages.

**Option A — Pages branch mode (simplest, no workflow).**

1. Make sure the built site is in the repo: `npm run build` (creates `docs/` — it is committed).
2. Repo **Settings → Pages → Source: "Deploy from a branch"**.
3. Branch: `main`, folder: `/docs`, Save.
4. Your game is live at `https://<user>.github.io/Minecraft/` and auto-rebuilds on every push to `main` (remember to `npm run build` before pushing changes).

**Option B — GitHub Actions workflow.** Add `.github/workflows/deploy.yml` to the repo (this token can't push workflow files, so create it on GitHub: repo → Add file → Create new file):

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: docs }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then set **Settings → Pages → Source: "GitHub Actions"**.

## Tests

```bash
npm test
```

37 headless checks: Minecraft movement speeds (walk 4.317 / sprint 5.612 / sneak 1.295), jump height ~1.25 blocks, fast-fall landing, world generation, mesher face counts, and face-table UV/winding validation.

## What's next

Block breaking/placing, world generation (noise terrain), chunked rendering, more blocks, sounds.
