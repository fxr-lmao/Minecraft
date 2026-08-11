# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (block textures, the player skin, the sky and clouds) is procedurally generated. It runs on GitHub Pages with no build step.

## Status (alpha 0.5)

- **Infinite world** — procedurally generated hills, valleys and sandy lowlands streamed in 32×32 chunks as you walk, in every direction, forever. Chunks are generated from a seed and thrown away behind you, so memory stays flat however far you go
- **Render distance** — 2 to 7 chunks (64–224 blocks) in the settings, with fog tuned to the distance so terrain fades out instead of ending at a visible edge
- **One draw call per chunk** — every block face shares a single texture atlas with hand-built mipmaps, so a chunk is one mesh regardless of how many block types it contains. Chunk builds are spread over frames on a 4 ms budget, so streaming never hitches
- **Dig and build anywhere** — break and place blocks; bedrock is indestructible so you can't fall out of the world
- **Auto jump** — hops single blocks so hilly terrain doesn't mean holding space (toggleable, like Bedrock)
- **Inventory** — 9 hotbar slots ("in hand") plus a 9 × 3 grid, with stacking to 64, pick-up/drop, right-click half-stacks and shift-click transfers. Broken blocks go into it, placed blocks come out of it
- **Three camera perspectives** — first person, third person from behind, and third person from the front. The avatar's body turns toward where you're moving while the head follows your look, the camera sits off your shoulder so it isn't parked on the crosshair, pulls in smoothly instead of clipping through terrain, and zooms with <kbd>Shift</kbd>+scroll
- **Mouse look that always works** — pointer lock is used when the browser grants it, but iPadOS Safari refuses it *silently*, so the game verifies the lock actually engaged and otherwise switches to free look: the cursor drives the view and holding it near a screen edge keeps turning. Nothing is ever dead, and the pause menu says which mode you're in
- **Your world is saved** — block edits (as a diff against the generated terrain, so it stays small), inventory, position and view mode go into localStorage automatically. "Reset world" in the pause menu starts over
- **Paused means paused** — every animation, down to the drifting clouds and the idle arm sway, is driven by a clock that stops with the game
- **Settings** — mouse and touch sensitivity, field of view, render distance, invert-Y, auto jump, and a fullscreen toggle, all persisted
- **Adaptive resolution** — render scale and shadow quality drop automatically when FPS is low and recover when there's headroom (great on iPads/phones)
- **Minecraft-accurate movement** — walk 4.317, sprint 5.612, sneak 1.295 blocks/s, gravity 32 blk/s², jump ≈1.25 blocks, air drag, axis-separated collision that slides along walls, and sprint-cancel on wall bumps. Full blocks are jumped onto, not stepped onto, same as the real game
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
| `Shift` + scroll | Zoom the third-person camera |
| `E` (or `I`) | Open/close the inventory |
| `V` (or `F5`) | Cycle first person → third person → front view |
| `F` (or `F11`) | Fullscreen |
| `G` (or `F3`) | Debug screen (position, speed, FPS, target block) |
| `Esc` | Release the mouse / pause · closes the inventory first |

Inside the inventory: click or tap a slot to pick a stack up and another slot to drop it, right-click to take half or place one, shift-click to send a stack between the hotbar and the grid.

### iPad

The Magic Keyboard has no function keys, which is why the camera is on `V`, fullscreen on `F` and the debug screen on `G`.

- **With the keyboard/trackpad**: press any key or click once to start — the pointer locks and the trackpad becomes mouse look. `Esc` releases it (the game pauses), and a click resumes.
- **If Safari won't lock the pointer** (it often refuses in a normal tab, without reporting an error): the game notices within 400 ms and switches to free look instead of leaving the trackpad dead. Move the cursor to turn; hold it near a screen edge to keep turning past where the cursor stops. Going fullscreen usually makes the real lock work — the pause menu has a **Fullscreen** button and a **Lock the mouse** retry.
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

183 headless checks across six suites: Minecraft movement speeds, jump height, wall collision and auto jump; infinite-world chunking (negative coordinates, generation, eviction, edits surviving a regenerate); the mesher (face culling, chunk seams, atlas UVs); the inventory model; block targeting; and the save/settings/camera systems.

The tests run on a superflat world (`new World(seed, { flat: 3 })`) so that "walk forward for five seconds" has a deterministic answer.

## What's next

Caves and ores, trees, more block types, crafting, sounds.

## Known limits

- Free look can't recentre the cursor the way pointer lock does, so turning relies on the screen-edge zone. It is a fallback, not a replacement — use fullscreen and the retry button to get a real lock where the browser allows it.
- Saves live in this browser's localStorage: a different browser, or clearing site data, means a fresh world.
- The world is infinite horizontally but 64 blocks tall, and there are no caves or ores yet — terrain is a surface heightmap.
