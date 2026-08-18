# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (block textures, the player skin, the sky and clouds) is procedurally generated. It runs on GitHub Pages with no build step.

## Status (alpha 0.9)

- **Infinite world with four biomes** — plains, forest, desert and snow-capped mountains, streamed in 32×32 chunks as you walk, in every direction, forever. Biomes are blended weights rather than a hard choice, so a mountain range ramps down into the plains beside it instead of ending in a cliff, and the ground cover changes exactly where the shape does
- **Minecraft's elevations** — the world runs from **y = −64 to y = 190**, with sea level at 62, plains in the mid 60s, and mountains topping out around **150** with bare stone above 95 and snow above 120. Bedrock is ragged, like the real thing
- **Oceans, and water that flows** — the sea fills everything below y = 62, and dig a channel into it and it runs. Minecraft's fluid, rule for rule: a source reaches seven blocks and thins a level with each one; two sources on solid ground make a third, so a channel wider than one block stays full; go over a ledge and it falls, lands at full strength and gets another seven. Water *looks* for the drop — with a hole three blocks away it heads straight for it instead of spreading in a circle, which is what makes digging a channel feel like digging a channel
- **Water drawn as a surface, not as boxes** — the height of the water belongs to the *corners*, and a corner is the average of the four cells that touch it, so two neighbouring cells always agree about where their shared edge is. A spreading stream comes out as one sloping sheet rather than a staircase of floating slabs with the floor showing through the joints. Moving water and calm water are different textures, both scrolling; a flowing surface has its texture rotated to run downhill; a current pushes you along it at Minecraft's 1.4 blocks/s
- **…and shaded by measuring, not guessing.** Water gets its own renderer: the world is drawn off-screen first, with a depth texture, so the surface can look up what is behind each of its pixels *and how far through the water that light travelled*. Everything else follows from that one number — **Beer-Lambert absorption** per channel (red is absorbed eight times faster than blue, which is why a hand's depth over sand is faintly green and six blocks of it is deep blue; there is no colour ramp anywhere, just one exponential); **refraction**, so the sea floor shifts under the ripples; a **shoreline** that finds itself wherever the water gets thin, so foam appears around a block standing in a pond as readily as along a coast, softly and with no line; and **caustics** cast onto the point behind the surface, which is why they can no longer land on dry sand. Then a second off-screen pass from a camera mirrored through the water plane puts **the actual world** in the reflection — trees, cliffs, the sun — scattered by the wave normal. On top: a real swell, four crossing waves summed in *world* space so neighbouring chunks agree along their shared edge without knowing about each other, with normals from the derivative of the same sum so highlights can never slide off the waves. And Fresnel over all of it, which is most of the difference between "blue glass" and "a lake"
- **Underwater is its own grade, not a blue filter.** The same depth buffer gives the world position of every pixel, so being submerged means light absorbed per channel over the real distance it travelled (down from the surface to whatever it hit, then back to your eye — so a deep sea floor is dim as well as blue), caustics moving across everything the sun can still reach, shafts of light where you look toward it, and a vignette. Looking up you get **Snell's window**: the whole sky squeezed into a 97° cone overhead, a mirror of the depths outside it
- **Buckets** — the water was only ever where the sea put it. Now you can dip a bucket in it and pour it out anywhere: a pond on a clifftop, a moat, a waterfall down the side of whatever you built. It fills from a *source* and never from flowing water, which is Minecraft's rule and the right one — scooping a stream would take a level that upstream replaces on the next tick, so the bucket would be a tap that never runs dry. What you pour out is a source like any other, so it spreads its seven blocks, finds holes, and makes a new source wherever two of them sit on solid ground. Buckets aim with their own raycast: block targeting goes *through* water on purpose, so that you can build in the shallows, and a bucket that could not see the sea would have nothing to fill from
- **Splashes** — jumping into water throws a crown of droplets and a collar of foam, sized by how hard you hit it; bubbles come off you while you are under; a swimmer leaves a wake; and anything falling throws spray where it lands. One pooled buffer, one draw call, nothing allocated while the game is running. They are ordinary scene geometry, which is what makes them composite correctly with the water for free: a droplet above the surface writes depth so the water stays behind it, and a bubble below it gets absorbed and tinted like everything else down there
- **Water quality is a setting**, because each level is another render of the world: *Fast* is one pass and shades the surface from a procedural sky, *Fancy* adds the depth pass, and *Reflections* adds the mirrored one. The debug screen reports what the water is costing you in milliseconds
- **Swimming** — Minecraft's water constants: 2.0 blocks/s swimming and 2.6 sprinting against 4.317 walking, sinking at 2.0 rather than 78.4, and holding jump lifts you at 1.2 — a seventh of a jump, and enough to reach the surface
- **Getting back out** — swimming up is *not* enough on its own, and the arithmetic says so: it tops out at the surface, gravity gives you 1.2²/2g = 0.022 blocks of coast, and the bank is 0.111 above the waterline. You end up ninety millimetres short, forever. Minecraft has a separate move for this and so does this — swim into the edge and you haul yourself onto it, no jump key needed. It only fires where the hitbox is free 0.6 higher, so a bank works and a cliff does not
- **Swim mode** — sprint in water and you go flat out, exactly as Minecraft does it: the hitbox becomes a 0.6 cube with the eye at 0.4, and you steer with the whole look vector instead of its flattened shadow, so aiming down dives, aiming up surfaces, and level holds your depth. A float pulls you to the waterline when you are near it and lets go a metre and a half down, so a dive stays a dive. The 0.6 hitbox is not cosmetic — it takes you through flooded one-block tunnels you could never walk down, and you stay in the crawl until there is headroom to stand up again. In third person the avatar lies out along the look direction and swims a front crawl
- **...but not in every puddle** — Minecraft asks two different questions and they are not the same question. To *start* a swim your eyes have to be under the surface (`isUnderWater`); to *keep* one, merely being in the water is enough (`isInWater`). That asymmetry is the whole difference between a game where sprinting through ankle-deep water throws you flat on your face in it and one where you run straight through, because a one-block puddle stands 8/9 high and your eye is at 1.62. Wading out to sea still takes you under, and that is the moment the crawl begins — several strides after your boots got wet. And once you are swimming, coming up for air does not stand you back upright
- **Ice** — water freezes where it is cold enough, which here means the mountains: they sit at freezing on Minecraft's temperature scale before you climb them, and the air cools by 0.005 a block above y = 80, so the ice line and the snow line are the same line. Minecraft's rule, condition for condition — a *source* block, cold enough, and at least one of its four neighbours not water — and that last one is the whole reason a frozen pond looks like one: ice can only form where the water meets something that is not, so it starts at the bank and works inwards, each new block of it making the next cell an edge. Pour a bucket out on a peak and it ices over while you stand there. It is written transiently, exactly like flowing water, so a frozen lake costs nothing in the save file and freezes again by itself when you come back; build a roof over one and it thaws. You cannot carry it away — that needs Silk Touch, and there is none here — so breaking ice leaves the water it was made of, or nothing at all if you took the floor out from under it first, and the hole you cut stays open for a quarter of a minute before it closes over
- **...and ice is slippery.** Minecraft's friction is 0.98 against the ground's 0.6, and it compensates in the acceleration by (0.6/friction)³, so the two very nearly cancel: you reach the same 4.3 blocks/s you would have walked at, and the whole difference is that the drag is a fifth of the ground's, so you take five times as long to get there and coast the better part of two blocks after you stop asking (the test measures 1.87 against 0.34). The continuous model here already scales acceleration by (1 − f), which *is* that compensation, so ice is one number
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
- **Settings** — mouse and touch sensitivity, field of view, render distance, water quality, invert-Y, auto jump, and a fullscreen toggle, all persisted
- **Adaptive resolution** — render scale and shadow quality drop automatically when FPS is low and recover when there's headroom (great on iPads/phones)
- **Minecraft-accurate movement** — walk 4.317, sprint 5.612, sneak 1.295 blocks/s, gravity 32 blk/s², jump ≈1.25 blocks, air drag, axis-separated collision that slides along walls, and sprint-cancel on wall bumps. Full blocks are jumped onto, not stepped onto, same as the real game
- **Robust loading** — loading screen, friendly error screen instead of a silent black page, WebGL2 detection
- **Zero build step** — pure ES modules with no bare imports; Three.js is vendored in `vendor/` (MIT, see `vendor/THREE.LICENSE`)

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump (hold to keep jumping) |
| `Ctrl` / double-tap `W` | Sprint — in water, swim |
| `Shift` | Sneak |
| Mouse | Look |
| Left / right click | Break / place a block |
| Middle click | Pick the block you're looking at |
| `1`–`9` / scroll | Select a hotbar slot |
| Right click with a bucket | Fill from water, or pour it out |
| `Shift` + scroll | Zoom the third-person camera |
| `E` (or `I`) | Open/close the inventory |
| `V` (or `F5`) | Cycle first person → third person → front view |
| `F` (or `F11`) | Fullscreen |
| `G` (or `F3`) | Debug screen (position, speed, FPS, water cost, target block) |
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

536 headless checks across eight suites: Minecraft movement speeds, jump height, wall collision, auto jump and the swimming pose; infinite-world chunking (negative coordinates, generation, eviction, edits surviving a regenerate), caves and the deepslate transition; the mesher (face culling, chunk seams, atlas UVs); the inventory model; block targeting; the save/settings/camera systems; pointer lock plus the native iPad bridge; and water, in three halves — how far it spreads, whether it finds the hole, what a drop does to it, what it refuses to touch; the geometry it turns into; and now where it freezes, which is its own set of rules to get wrong.

Four of them are worth calling out because they guard things that would otherwise fail silently:

- **The shell mesh is proved complete.** Distant chunks skip their cave geometry. The test flood-fills the air connected to the sky, then asserts that every single face touching it is present in the shell mesh — so the shortcut can never leave a visible hole.
- **Both cave code paths are cross-checked.** Chunk generation interpolates a precomputed noise lattice; `generatedBlock` interpolates the same lattice one cell at a time. The test asserts they agree block for block, because a drift between them would show up as a seam.
- **The water surface is proved gapless.** Water used to be drawn as a box per cell, and since a spreading stream is a staircase of different levels, it came out as a grid of floating slabs you could see the floor between. The test meshes a real spread and a real coastline, then walks every pair of adjacent water quads and asserts their shared edge is the same edge, to the vertex.
- **And proved gapless once it starts moving.** The swell lifts the surface by up to a twentieth of a block, and a surface quad and the top of the wall beneath it are different quads that happen to share a corner. If they were ever lifted by different amounts a crack would open between them, so the amplitude is a property of the corner rather than of the face — and the test asserts exactly that, by collecting every vertex position in a meshed pool and checking that no position is ever handed two different amplitudes.
- **The reflection is proved anchored.** The shading is GLSL and cannot run in Node, but the arithmetic that decides *where* it samples can, and it is the part that fails silently: a reflection that is out by a fraction slides across the surface as you walk instead of staying put. The test takes a point standing above the water, works out where its reflection should land on the surface, and asserts the water there looks it up exactly where the mirrored camera drew it. It also checks that the mirrored view is a rotation rather than a reflection — a mirror matrix has a negative determinant and would flip the winding of every triangle in the world.

- **Nothing freezes in open water.** The edge rule is the one that makes a frozen pond look frozen, and it is invisible in the end state — run it long enough and every cell is ice either way. So the test freezes a pond one cell a step and keeps the order they went in, then walks it and asserts that each cell was either on the bank or next to something that had already frozen. It also does it once in the game's own world, with the real biome noise: a real mountain 507 blocks from spawn, a bucket poured out on it, and the stream that runs off it left unfrozen because it is still moving.

The tests run on a superflat world (`new World(seed, { flat: 3 })`) so that "walk forward for five seconds" has a deterministic answer, and a fixed climate (`{ temperature: -0.1 }`) where the question is what freezes.

## What's next

Cave entrances, ores, lava, swords and tools, more block types, crafting, sounds.

## How the water is put together

Four files, and they only talk to each other through data:

| File | What it owns |
| --- | --- |
| `src/water.js` | Where the water *is*. Minecraft's `FlowingFluid`, rule for rule: `getNewLiquid`, `spread`, `getSpread`, the four-block slope search, infinite sources — and, in the second half, where it freezes: `Biome.shouldFreeze`'s four conditions, and the three ways a cell comes up for consideration |
| `src/water-mesh.js` | What shape it is, and four bytes a vertex the shader cannot work out for itself: depth, shore, wave amplitude, churn. No THREE, no DOM — arrays in, arrays out, so the tests can read the geometry directly |
| `src/water-render.js` | The passes. Render targets, the mirrored camera, the quality levels, and the order the three renders happen in |
| `src/water-shader.js` | The surface. Absorption, refraction, reflection, Fresnel, foam, glitter, Snell's window |
| `src/underwater.js` | The composite, which above water is a copy and below it is the whole underwater grade |
| `src/water-glsl.js` | The GLSL more than one of them needs — the swell and the caustics — in one place, so the surface and the underwater pass can never disagree at the waterline |
| `src/particles.js` | Water in the air: splashes, spray, bubbles and wake, in one pooled buffer |
| `src/items.js` | Things you carry that are not blocks. Buckets, and the rules for filling and emptying them — pure, so the rules are unit-tested |
| `src/textures.js` | The two 16×16 tiles, which hold no colour at all any more — only light and shade around a mid grey, because the colour of water depends on how deep it is and which way you are looking, and a tile knows neither |

The passes, in order, and what each one is for:

1. **Refraction.** Everything except the water, into an off-screen target with a depth texture. This is also the image you end up looking at — the composite blits it rather than drawing the world twice.
2. **Reflection.** The world again from a camera mirrored through the water plane, at half resolution, with everything below the surface clipped away. Skipped below the top quality setting, and skipped when you are underwater.
3. **Composite.** Blit, then the water surface on top — the only geometry in the pass, depth-testing itself against the texture from pass 1 — and then the block in your hand, which is a hand and not scenery, so the sea is not allowed to draw over it.

So the world is rasterised once at full resolution and once at half, against once before. The debug screen reports the total in milliseconds; at a 4-chunk distance with the sea filling the screen it measures 1.9 ms on *Fast*, 2.6 on *Fancy* and 3.0 with reflections — a software rasteriser, so treat the ratios rather than the numbers as the finding.

## Known limits

- Free look can't recentre the cursor the way pointer lock does, so turning relies on the screen-edge zone. It is a fallback, not a replacement — use fullscreen and the retry button to get a real lock where the browser allows it, or the [iPad app](ipad-app/README.md), which gets one from UIKit.
- Saves live in this browser's localStorage: a different browser, or clearing site data, means a fresh world. Worlds from before the terrain moved up are lifted 52 blocks on load, so anything built on the old surface lands back on the new one — near enough, though the hills underneath have changed shape.
- **Caves never break through to the surface.** You find them by digging, not by walking into a hole in a hillside. That is not an accident: it is what makes the terrain shell watertight, which is what lets distant chunks skip their cave geometry entirely. Adding entrances means flagging the chunks that have one so they are always built in full — worth doing, but it is a change to the optimisation, not a tweak to the noise.
- **Caves stop at y = 70**, so the inside of a mountain is solid. Carving all the way to 150 would cost a third again per chunk for tunnels sealed inside a peak.
- **The world is 255 layers and cannot simply be made taller.** Mesh vertex positions are packed into single bytes, and a block at the top layer needs a vertex one above it. Going higher means widening every position attribute from 3 bytes a vertex to 6.
- **The first ice in a world is yours.** Water only generates below sea level and the cold only starts high up a mountain, so the two never meet on their own: nothing freezes until you carry a bucket up there. A snowy biome down at sea level would fix that, and the climate is already written to take one — `BIOME_TEMPERATURE` in `terrain.js` is a number per biome, and a cold one at 0.0 would ice its own coastline over.
- **Ice is opaque.** Minecraft's is translucent and you can see the water and the fish under it. Here it is an ordinary solid block: the only translucent pass is the water's own, and putting ice through it would mean the surface shader shading something that is not a surface.
- No ores yet, and no lava. Caves are dry: water fills the sea and anything you dig into it, but it does not seep into caves under the sea floor.
- **A planar reflection has one plane.** The mirrored camera is aimed at the water surface nearest you, found by scanning a short way up and down the column you are standing in. Water at a *different* height — a pond up a hill while you stand at the shore — still reflects, but it reflects the procedural sky rather than the world, because it is not the plane the second pass was rendered for.
- **A bucket is the only item.** There is no crafting and no way to get a second one, so the one in your starting hotbar is the one you have. Losing it means resetting the world.
- **The reflection does not contain the water.** Nothing in a mirror can reflect a mirror without another pass, so a waterfall pouring into a lake does not appear in the lake.
- **Refraction reads a depth buffer, so it can only bend light around things it can see.** A block hidden behind another block cannot be refracted into view, and at the very edge of the screen the refracted sample is clamped rather than invented.
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
