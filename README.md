# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (block textures, the player skin, the sky and clouds) is procedurally generated. It runs on GitHub Pages with no build step.

## Status (alpha 0.3)

- **Flat world you can dig** — 128×128 superflat terrain (grass → dirt → dirt → bedrock) with 32 blocks of headroom to build in. Break and place blocks; bedrock is indestructible so you can't fall out of the world
- **Inventory** — 9 hotbar slots ("in hand") plus a 9 × 3 grid, with stacking to 64, pick-up/drop, right-click half-stacks and shift-click transfers. Broken blocks go into it, placed blocks come out of it
- **Three camera perspectives** — first person, third person from behind, and third person from the front, with an animated blocky avatar and a camera that pulls in instead of clipping through terrain
- **Works on an iPad with the Magic Keyboard** — click to lock the mouse, <kbd>Esc</kbd> to release it, click again to resume. The on-screen touch controls appear only while you're actually using a finger, so the same page suits both
- **Fast rendering** — face-culled voxel meshing (~18k quads instead of ~393k) split into chunks, so placing or breaking a block re-meshes 1/16th of the world instead of all of it
- **Adaptive resolution** — render scale and shadow quality drop automatically when FPS is low and recover when there's headroom (great on iPads/phones)
- **Minecraft-accurate movement** — walk 4.317, sprint 5.612, sneak 1.295 blocks/s, gravity 32 blk/s², jump ≈1.25 blocks, air drag, auto-step and sprint-cancel on wall bumps
- **Robust loading** — loading screen, friendly error screen instead of a silent black page, WebGL2 detection
- **Zero build step** — pure ES modules with no bare imports; Three.js is vendored in `vendor/` (MIT, see `vendor/THREE.LICENSE`)

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump (hold to keep jumping) |
| `Ctrl` / double-tap `W` | Sprint |
| `Shift` | Sneak |
| Mouse | Look |
| Left / right click | Break / place a block |
| Middle click | Pick the block you're looking at |
| `1`–`9` / scroll | Select a hotbar slot |
| `E` (or `I`) | Open/close the inventory |
| `V` (or `F5`) | Cycle first person → third person → front view |
| `G` (or `F3`) | Debug screen (position, speed, FPS, target block) |
| `Esc` | Release the mouse / pause · closes the inventory first |

Inside the inventory: click or tap a slot to pick a stack up and another slot to drop it, right-click to take half or place one, shift-click to send a stack between the hotbar and the grid.

### iPad

The Magic Keyboard has no function keys, which is why the camera is on `V` and the debug screen on `G`.

- **With the keyboard/trackpad**: press any key or click once to start — the pointer locks and the trackpad becomes mouse look. `Esc` releases it (the game pauses), and a click resumes.
- **With fingers**: tap to start. The left half of the screen is a virtual joystick, the right half looks around, and the on-screen buttons cover jump, sprint, sneak, break, place, view, inventory, debug and pause.
- Both work in the same session — the on-screen buttons hide as soon as you touch the keyboard and come back when you touch the screen.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

## Deploying to GitHub Pages

No build step needed — the repo *is* the site (browsers load the ES modules directly; `node_modules` and Vite are only used for local dev).

1. Push your code to GitHub.
2. Repo **Settings → Pages → Source: "Deploy from a branch"**.
3. Branch: the branch you pushed to, folder: `/` (root), Save.
4. Live at `https://<user>.github.io/<repo>/` — every push auto-updates the site.

All paths are relative and `.nojekyll` is present, so the game works from a project sub-path unchanged.

## Tests

```bash
npm test
```

94 headless checks across six suites: Minecraft movement speeds and jump height, world generation and chunk dirty-tracking, mesher face counts, face-table UV/winding validation, the inventory model (stacking, cursor, quick-move), and block targeting (voxel raycast, placement guard, third-person camera collision).

## What's next

World generation (noise terrain), chunked streaming for bigger worlds, more block types, crafting, sounds.
