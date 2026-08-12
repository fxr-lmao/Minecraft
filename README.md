# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (block textures, the player skin, the sky and clouds) is procedurally generated. It runs on GitHub Pages with no build step.

## Status (alpha 0.9)

- **Infinite world with four biomes** — plains, forest, desert and snow-capped mountains, streamed in 32×32 chunks as you walk, in every direction, forever. Biomes are blended weights rather than a hard choice, so a mountain range ramps down into the plains beside it instead of ending in a cliff, and the ground cover changes exactly where the shape does
- **Minecraft's elevations** — the world runs from **y = −64 to y = 190**, with sea level at 62, plains in the mid 60s, and mountains topping out around **150** with bare stone above 95 and snow above 120. Bedrock is ragged, like the real thing
- **Oceans, and water that flows** — the sea fills everything below y = 62, and dig a channel into it and it runs. Minecraft's fluid, rule for rule: a source reaches seven blocks and thins a level with each one; two sources on solid ground make a third, so a channel wider than one block stays full; go over a ledge and it falls, lands at full strength and gets another seven. Water *looks* for the drop — with a hole three blocks away it heads straight for it instead of spreading in a circle, which is what makes digging a channel feel like digging a channel
- **Water drawn as a surface, not as boxes** — the height of the water belongs to the *corners*, and a corner is the average of the four cells that touch it, so two neighbouring cells always agree about where their shared edge is. A spreading stream comes out as one sloping sheet rather than a staircase of floating slabs with the floor showing through the joints. Moving water and calm water are different textures, both scrolling; a flowing surface has its texture rotated to run downhill; a current pushes you along it at Minecraft's 1.4 blocks/s; and going under turns the world blue
- **Swimming** — Minecraft's water constants: 2.0 blocks/s swimming and 2.6 sprinting against 4.317 walking, sinking at 2.0 rather than 78.4, and holding jump lifts you at 1.2 — a seventh of a jump, but enough to surface and climb out
- **Caves** — winding tunnels through the whole underground, carved where two 3D noise fields cross. The noise is sampled on a 4-block lattice and interpolated, which is what Minecraft does too, and what makes them smooth rather than speckled. They line up exactly across chunk borders
- **Deepslate below y ≈ 0** — as in Minecraft, stone gives way to deepslate on a boundary jittered per column, so it reads as a transition rather than a drawn line
- **Forests have trees** — oak logs and leaves, generated deterministically so canopies cross chunk borders intact and regrow identically when a chunk is reloaded
- **Render distance up to 40 chunks (1280 blocks)** in the settings, with fog tuned to the distance so terrain fades out instead of ending at a visible edge. The slider shows what each setting costs
- **One draw call per chunk** — every block face shares a single texture atlas with hand-built mipmaps, so a chunk is one mesh regardless of how many block types it contains. Water is the one exception, drawn afterwards in a translucent pass: a chunk with sea in it pays for a second call, and a third only if some of that water is actually moving. Chunk builds are spread over frames on a 4 ms budget, so streaming never hitches
- **Flat memory** — block data is only kept within 6 chunks of you; the meshes reach much further. Walking with a 24-chunk render distance holds the same voxel data as a 4-chunk one, because regenerating a chunk is cheaper than remembering it
- **Caves cost nothing at a distance** — they never break through to the sky, so the terrain shell above them is watertight and none of that geometry can be seen from outside it. Only chunks within 4 of you get their caves built (16 ms and 497 KB each); everything further is the shell alone, at 5.5 ms and 83 KB. Chunks you or a neighbouring chunk have dug into are always built in full, because a pit you made yourself is a real hole in that shell
- **Dig and build anywhere** — break and place blocks; bedrock is indestructible so you can't fall out of the world
- **Auto jump** — hops single blocks so hilly terrain doesn't mean holding space (toggleable, like Bedrock)
- **Inventory** — 9 hotbar slots ("in hand") plus a 9 × 3 grid, with stacking to 64, pick-up/drop, right-click half-stacks and shift-click transfers. Broken blocks go into it, placed blocks come out of it
- **Three camera perspectives** — first person, third person from behind, and third person from the front. The avatar holds whatever you have selected, in a hand socket built to take a sword or a tool as easily as a block. The avatar's body turns toward where you're moving while the head follows your look, the camera sits off your shoulder so it isn't parked on the crosshair, pulls in smoothly instead of clipping through terrain, and zooms with <kbd>Shift</kbd>+scroll
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

386 headless checks across eight suites: Minecraft movement speeds, jump height, wall collision and auto jump; infinite-world chunking (negative coordinates, generation, eviction, edits surviving a regenerate), caves and the deepslate transition; the mesher (face culling, chunk seams, atlas UVs); the inventory model; block targeting; the save/settings/camera systems; pointer lock plus the native iPad bridge; and water, in both halves — how far it spreads, whether it finds the hole, what a drop does to it, what it refuses to touch, and then the geometry it turns into.

Three of them are worth calling out because they guard things that would otherwise fail silently:

- **The shell mesh is proved complete.** Distant chunks skip their cave geometry. The test flood-fills the air connected to the sky, then asserts that every single face touching it is present in the shell mesh — so the shortcut can never leave a visible hole.
- **Both cave code paths are cross-checked.** Chunk generation interpolates a precomputed noise lattice; `generatedBlock` interpolates the same lattice one cell at a time. The test asserts they agree block for block, because a drift between them would show up as a seam.
- **The water surface is proved gapless.** Water used to be drawn as a box per cell, and since a spreading stream is a staircase of different levels, it came out as a grid of floating slabs you could see the floor between. The test meshes a real spread and a real coastline, then walks every pair of adjacent water quads and asserts their shared edge is the same edge, to the vertex.

The tests run on a superflat world (`new World(seed, { flat: 3 })`) so that "walk forward for five seconds" has a deterministic answer.

## What's next

Cave entrances, ores, lava, buckets, swords and tools, more block types, crafting, sounds.

## Known limits

- Free look can't recentre the cursor the way pointer lock does, so turning relies on the screen-edge zone. It is a fallback, not a replacement — use fullscreen and the retry button to get a real lock where the browser allows it, or the [iPad app](ipad-app/README.md), which gets one from UIKit.
- Saves live in this browser's localStorage: a different browser, or clearing site data, means a fresh world. Worlds from before the terrain moved up are lifted 52 blocks on load, so anything built on the old surface lands back on the new one — near enough, though the hills underneath have changed shape.
- **Caves never break through to the surface.** You find them by digging, not by walking into a hole in a hillside. That is not an accident: it is what makes the terrain shell watertight, which is what lets distant chunks skip their cave geometry entirely. Adding entrances means flagging the chunks that have one so they are always built in full — worth doing, but it is a change to the optimisation, not a tweak to the noise.
- **Caves stop at y = 70**, so the inside of a mountain is solid. Carving all the way to 150 would cost a third again per chunk for tunnels sealed inside a peak.
- **The world is 255 layers and cannot simply be made taller.** Mesh vertex positions are packed into single bytes, and a block at the top layer needs a vertex one above it. Going higher means widening every position attribute from 3 bytes a vertex to 6.
- No ores yet, and no lava. Caves are dry: water fills the sea and anything you dig into it, but it does not seep into caves under the sea floor.
- Water has no bucket, so the only sources are the sea. You can dig channels from it and build waterfalls, but not carry it inland.
- Flowing water is never saved — it is a consequence of the terrain, so it is recomputed rather than stored, which is why a flood costs nothing in the save file. The cost is that a chunk coming back into memory comes back dry for a moment, until replaying its edits pokes the sea into finding the hole again.
- Render distance is not free. Voxel data stays flat, but chunk *geometry* is roughly 0.12 MB per chunk and the chunk count grows with the square of the distance:

  | Distance | Blocks | Chunks | Geometry | Draw calls |
  | --- | --- | --- | --- | --- |
  | 8 | 256 | 225 | ~39 MB | ~88 |
  | 16 | 512 | 861 | ~91 MB | ~290 |
  | 24 | 768 | 1930 | ~180 MB | ~600 |
  | 40 | 1280 | 5027 | ~437 MB | ~1600 |

  For reference, Minecraft's own maximum render distance is 32 of its 16-block chunks — 512 blocks, which is 16 here. Past ~20 the draw-call count, not the memory, is what costs you frames.

  A shell chunk is ~83 KB and a chunk with its caves built is ~497 KB, but only the ~49 nearest you are ever the second kind — that fixed ~24 MB is the whole cost of caves, at any distance.

  Block data is 255 KB per chunk and stays at ~42 MB however far you can see, because only 6 chunks' worth is kept.
