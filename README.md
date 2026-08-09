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
- **Runs on static hosts with zero build step** — pure ES modules with no bare imports; Three.js is vendored in `vendor/` (MIT, see `vendor/THREE.LICENSE`)

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

## Deploying to GitHub Pages

No build step needed — the repo *is* the site (browsers load the ES modules directly; `node_modules` and Vite are only used for local dev).

1. Push your code to GitHub.
2. Repo **Settings → Pages → Source: "Deploy from a branch"**.
3. Branch: the branch you pushed to, folder: `/` (root), Save.
4. Live at `https://<user>.github.io/<repo>/` — every push auto-updates the site.

(Previously the game referenced `import 'three'` — a Node package — which GitHub Pages can't resolve, so the HTML loaded but the game never started. That's fixed by vendoring Three.js into `vendor/` and using relative imports.)

## Tests

```bash
npm test
```

37 headless checks: Minecraft movement speeds (walk 4.317 / sprint 5.612 / sneak 1.295), jump height ~1.25 blocks, fast-fall landing, world generation, mesher face counts, and face-table UV/winding validation.

## What's next

Block breaking/placing, world generation (noise terrain), chunked rendering, more blocks, sounds.
