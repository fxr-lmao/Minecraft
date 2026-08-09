# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (textures, sky, clouds) is procedurally generated.

## Status (alpha 0.2)

- **Flat world** — 128×128 superflat-style terrain (grass → dirt → dirt → bedrock)
- **Fast rendering** — face-culled voxel meshing: only faces exposed to air are drawn (~18k quads instead of ~393k), merged into 3 draw calls
- **Adaptive resolution** — render scale and shadow quality drop automatically when FPS is low and recover when there's headroom (great on iPads/phones)
- **Player movement** — WASD + mouse look (pointer lock), Minecraft-accurate physics: walk 4.317, sprint 5.612, sneak 1.295 blocks/s, gravity 32 blk/s², jump ≈1.25 blocks
- **Jumping / sprinting / sneaking** — Ctrl or double-tap W to sprint, Shift to sneak, hold Space to keep jumping
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

Click the screen to capture the mouse, then move around.

## GitHub Pages

The repo includes `.github/workflows/deploy.yml` which builds and deploys to Pages automatically.

1. Push to `main` (or run the workflow manually from the Actions tab).
2. In repo **Settings → Pages**, set Source to **GitHub Actions**.
3. Your game will be live at `https://<user>.github.io/Minecraft/`.

The build uses relative asset paths (`base: './'`), so it works from any subpath — this fixes the black screen that happens when assets are referenced with absolute paths on a project site.

## Tests

```bash
npm test
```

40+ headless checks: Minecraft movement speeds (walk 4.317 / sprint 5.612 / sneak 1.295), jump height ~1.25 blocks, fast-fall landing, world generation, mesher face counts, and face-table UV/winding validation.

## What's next

Block breaking/placing, world generation (noise terrain), chunked rendering, more blocks, sounds.
