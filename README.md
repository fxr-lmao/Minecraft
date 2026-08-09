# Minecraft (browser clone)

A from-scratch Minecraft-style game built with [Three.js](https://threejs.org/) — no external assets, everything (textures, sky, clouds) is procedurally generated.

## Status (alpha 0.1)

- **Flat world** — 128×128 superflat-style terrain (grass → dirt → dirt → bedrock), rendered with instanced meshes
- **Player movement** — WASD + mouse look (pointer lock)
- **Jumping** — Minecraft-accurate gravity (32 blocks/s²) and jump velocity (≈1.25 block jump height)
- **Sprinting** — hold **Ctrl** or double-tap **W**; accelerates to Minecraft's real 5.612 blocks/s
- **Sneaking** — hold **Shift**, 1.295 blocks/s
- **Real speeds** — walk 4.317, sprint 5.612, sneak 1.295 blocks/s — the exact values from the Minecraft wiki, implemented via Minecraft's per-tick acceleration/drag model
- **Physics** — AABB voxel collision, auto-step up ledges, world border, void respawn, head bob, sprint FOV
- **HUD** — crosshair, hotbar (block selector — placement comes later), F3 debug screen (position, speed, FPS, facing)

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump (hold to keep jumping) |
| `Ctrl` / double-tap `W` | Sprint |
| `Shift` | Sneak |
| `Mouse` | Look |
| `1–9` / scroll | Select hotbar slot |
| `F3` | Debug screen |
| `Esc` | Release mouse |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

Click the screen to capture the mouse, then move around.

## What's next

Block breaking/placing, world generation (noise terrain), chunked rendering, more blocks, sounds.
