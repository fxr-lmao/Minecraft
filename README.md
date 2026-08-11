# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (block textures, the player skin, the sky and clouds) is procedurally generated. It runs on GitHub Pages with no build step.

## Status (alpha 0.7)

- **Infinite world with four biomes** — plains, forest, desert and snow-capped mountains, streamed in 32×32 chunks as you walk, in every direction, forever. Biomes are blended weights rather than a hard choice, so a mountain range ramps down into the plains beside it instead of ending in a cliff, and the ground cover changes exactly where the shape does
- **Minecraft's vertical range** — the world runs from **y = −70 to y = 70**: bedrock (ragged, like the real thing) at the bottom, 70 blocks of headroom to build into at the top
- **Caves** — winding tunnels through the whole underground, carved where two 3D noise fields cross. The noise is sampled on a 4-block lattice and interpolated, which is what Minecraft does too, and what makes them smooth rather than speckled. They line up exactly across chunk borders
- **Deepslate below y ≈ 4** — stone gives way to deepslate on a boundary jittered per column, so it reads as a transition rather than a drawn line
- **Forests have trees** — oak logs and leaves, generated deterministically so canopies cross chunk borders intact and regrow identically when a chunk is reloaded
- **Render distance up to 40 chunks (1280 blocks)** in the settings, with fog tuned to the distance so terrain fades out instead of ending at a visible edge. The slider shows what each setting costs
- **One draw call per chunk** — every block face shares a single texture atlas with hand-built mipmaps, so a chunk is one mesh regardless of how many block types it contains. Chunk builds are spread over frames on a 4 ms budget, so streaming never hitches
- **Flat memory** — block data is only kept within 6 chunks of you; the meshes reach much further. Walking with a 24-chunk render distance holds the same voxel data as a 4-chunk one, because regenerating a chunk is cheaper than remembering it
- **Caves cost nothing at a distance** — they never break through to the sky, so the terrain shell above them is watertight and none of that geometry can be seen from outside it. Only chunks within 5 of you get their caves built; everything further is the shell alone, which is *less* geometry than before caves existed. Chunks you have dug into are always built in full, because a pit you made yourself is a real hole in that shell
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

## Play it as an iPad app (with a real mouse lock)

`ipad-app/` is a small Swift Playgrounds project that puts the game on the Home
Screen and gives it the one thing Safari won't: a genuine pointer lock, plus raw
trackpad deltas from `GCMouse`. It builds **on the iPad itself** — no Mac, no
developer account, no seven-day expiry.

It contains no copy of the game. It loads the live GitHub Pages build in a
`WKWebView` and handles only the pointer natively, so every push updates the app
with nothing to reinstall. See [`ipad-app/README.md`](ipad-app/README.md) for the
install steps and the JS ↔ Swift contract; the web half is `src/native.js`.

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

270 headless checks across seven suites: Minecraft movement speeds, jump height, wall collision and auto jump; infinite-world chunking (negative coordinates, generation, eviction, edits surviving a regenerate), caves and the deepslate transition; the mesher (face culling, chunk seams, atlas UVs); the inventory model; block targeting; the save/settings/camera systems; and pointer lock plus the native iPad bridge.

Two of them are worth calling out because they guard optimisations that would otherwise fail silently:

- **The shell mesh is proved complete.** Distant chunks skip their cave geometry. The test flood-fills the air connected to the sky, then asserts that every single face touching it is present in the shell mesh — so the shortcut can never leave a visible hole.
- **Both cave code paths are cross-checked.** Chunk generation interpolates a precomputed noise lattice; `generatedBlock` interpolates the same lattice one cell at a time. The test asserts they agree block for block, because a drift between them would show up as a seam.

The tests run on a superflat world (`new World(seed, { flat: 3 })`) so that "walk forward for five seconds" has a deterministic answer.

## What's next

Cave entrances, ores, water and lava, more block types, crafting, sounds.

## Known limits

- Free look can't recentre the cursor the way pointer lock does, so turning relies on the screen-edge zone. It is a fallback, not a replacement — use fullscreen and the retry button to get a real lock where the browser allows it, or the [iPad app](ipad-app/README.md), which gets one from UIKit.
- Saves live in this browser's localStorage: a different browser, or clearing site data, means a fresh world.
- **Caves never break through to the surface.** You find them by digging, not by walking into a hole in a hillside. That is not an accident: it is what makes the terrain shell watertight, which is what lets distant chunks skip their cave geometry entirely. Adding entrances means flagging the chunks that have one so they are always built in full — worth doing, but it is a change to the optimisation, not a tweak to the noise.
- No ores yet, and no water or lava — a cave is air.
- Render distance is not free. Voxel data stays flat, but chunk *geometry* is roughly 0.12 MB per chunk and the chunk count grows with the square of the distance:

  | Distance | Blocks | Chunks | Geometry | Draw calls |
  | --- | --- | --- | --- | --- |
  | 8 | 256 | 225 | ~25 MB | ~88 |
  | 16 | 512 | 861 | ~95 MB | ~290 |
  | 24 | 768 | 1930 | ~215 MB | ~600 |
  | 40 | 1280 | 5027 | ~560 MB | ~1600 |

  For reference, Minecraft's own maximum render distance is 32 of its 16-block chunks — 512 blocks, which is 16 here. Past ~20 the draw-call count, not the memory, is what costs you frames.

  Caves barely move these numbers, which is the point of the shell/deep split: a shell chunk is ~111 KB and a chunk with its caves built is ~365 KB, but only the ~80 chunks nearest you are ever the second kind.
