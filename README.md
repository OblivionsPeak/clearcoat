# Clearcoat — iRacing Livery Workbench

Photoshop-free iRacing livery editing in the browser, with **live preview on the real car** — Clearcoat saves directly into your iRacing paints folder and the sim showroom hot-reloads the paint within seconds.

**Live app:** https://oblivionspeak.github.io/clearcoat/

## How it works

1. **Load a template** — download your car's official template from [Trading Paints' template library](https://www.tradingpaints.com/cartemplates) (or in-sim via My Content → Car Manager → Download Template) and load the **PSD straight into Clearcoat** — it extracts the wireframe in the browser, no Photoshop needed. Plain PNG/JPG wireframes work too. The overlay is multiply-blended and never exported.
2. **Build your livery in layers** — pick a base coat color, then drag-and-drop PNGs/JPGs/SVGs (sponsor logos, artwork) onto the canvas. **+ Text** adds names and numbers (Google Fonts or your own font file), **+ Fill** adds shapes and gradients, **+ Library** inserts ready-made racing graphics. Move, scale, rotate, skew, flip, reorder, set opacity and per-layer **blend modes** (multiply for shading/weathering, screen for glows, overlay/soft-light for contrast) — with full undo/redo, multi-select (Ctrl+click the list, Shift+click or Shift+drag a marquee on the canvas), and **snapping** to the sheet center/edges and region-map lines (hold Alt to move freely). The **magic wand** (`W`) selects a color region on the finished livery and turns it into a material-only layer, or recolors it outright.
3. **Pick materials, not spec maps** — every layer gets a finish: **gloss, matte, satin, metallic, chrome, candy, pearl, glaze, metal flake, brushed metal, carbon weave, or ghost**. Clearcoat bakes the iRacing spec map for you, including per-pixel micro-textures (flake sparkle, brushed grain, twill weave) that are effectively impossible to author by hand. **Ghost** layers are skipped in the paint map entirely — the design exists only in reflections. Toggle **Spec view** to inspect the result, or open **Studio** for an orbitable 3D proof (sphere / cylinder / door panel under showroom, neutral, or dusk lighting) — pearl, candy, flake and chrome only read truthfully on curvature.
4. **Tile seamless textures** — **+ Pattern** adds an image as a tiling fill across the whole sheet. Generate seamless textures with [SimTex Pro](https://oblivionspeak.github.io/simtex-pro/) (use its seamless export), drop them in as patterns, and put any material on top.
5. **Know where you're painting** — load a **region map** for your car and the sheet's panels get hover labels, a **Regions** overlay, and one-click **Mirror** (drop a flipped copy of a layer onto the partner panel). No map for your car yet? **Annotate** mode lets you build one and export it as shareable JSON. Stuck on direction? The **Livery Advisor** turns a description of the look you want into concrete changes — fully local, no AI keys.
6. **Plays nice with Trading Paints** — saving to iRacing first snapshots whatever is already in the folder (your active Trading Paints livery) into `clearcoat-backup/`; one-click **Restore** swaps it back. **Import current car paint…** pulls the existing `car_<id>.tga` into the editor as a full-sheet layer so you can design on top of your TP livery instead of replacing it.
7. **Save to iRacing** — link your `Documents\iRacing\paints\` folder once (Chrome/Edge) and pick the car from the topbar dropdown (linking a single `paints\<car>\` folder directly still works), enter your customer ID, and hit **Save to iRacing**. Keep the sim showroom open on a second monitor: it reloads `car_<custid>.tga` automatically when the file changes. Turn on **Live Sync** and settled edits stream into the folder on their own (2.5 s debounce) — the showroom becomes your live preview. Helmets and suits are paint targets too (`helmet_<id>.tga` at 1024×1024, `suit_<id>.tga`), and a **Custom Number** toggle saves `car_num_<id>.tga` for number-rules series.

No install, no backend, no account. Everything runs client-side; projects autosave to your browser (IndexedDB) and can be exported/imported as `.clearcoat.json`.

Clearcoat is free. If it saves you time (or a Photoshop license), you can [support development on Ko-fi](https://ko-fi.com/metalprophecymedia). ♥

## Exports

| Output | Format |
|---|---|
| Car paint | `car_<custid>.tga` — 2048×2048, 24-bit uncompressed TGA (`car_num_<custid>.tga` with Custom Number on) |
| Spec map | `car_spec_<custid>.tga` — R = metallic, G = roughness, B = clearcoat (iRacing PBR convention) |
| Helmet / suit | `helmet_<custid>.tga` (1024×1024) / `suit_<custid>.tga` — no spec map, per iRacing |
| Spec MIPs | **Get MIPs** downloads the sim-generated `.mip` files for Trading Paints spec upload |
| Portable | PNG download (e.g. for Trading Paints upload) |
| Region map | Panel-label JSON, shareable with other painters of the same car |

## Browser support

- **Chrome / Edge** — full experience including Save to iRacing (File System Access API).
- **Firefox / Safari** — editor and downloads work; direct folder save is unavailable.

## Shortcuts

| Key | Action |
|---|---|
| Drag / corner handles / teal handle | Move / scale / rotate (Shift = snap 15°) |
| Arrows (+ Shift) | Nudge layer 1px (10px) |
| `Delete` | Delete layer |
| `Ctrl+D` | Duplicate layer |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+click` (layer list) | Multi-select — group move, delete, duplicate, nudge |
| `Shift+click` (canvas) | Add/remove a layer from the selection |
| `Shift+drag` (empty canvas) | Marquee-select layers |
| `Alt` (while moving) | Disable snapping |
| `W` | Magic wand — select a contiguous color (Shift+click: that color everywhere) |
| `S` | Toggle spec view |
| `L` | Toggle Shine view — a light sweeps the livery so finishes preview in-app (gloss flashes, flake sparkles, ghost layers appear) |
| `F` | Fit to window |
| `F1` or `?` | Help overlay — workflow, shortcuts, tips |
| `Esc` | Exit tool / deselect |
| Scroll / Space-drag or right-drag | Zoom / pan |

## Development

Pure static site — no build step. Serve the folder with anything (`python -m http.server`) and open `index.html`. ES modules require http(s), not `file://`.

Bump the `#app-version` stamp in `index.html` with every deploy — GitHub Pages caches assets for 10 minutes, and the visible version (top-left, next to the wordmark) is how users confirm they're on the latest build after a hard refresh (Ctrl+F5).

```
index.html
css/app.css
js/main.js        UI, viewport, interactions
js/engine.js      document model, paint + spec compositing
js/tga.js         TGA encoder/decoder (24/32-bit, uncompressed + RLE read)
js/persist.js     IndexedDB autosave + File System Access handles
js/psd.js         PSD template import — wireframe extraction, no Photoshop
js/advisor.js     Livery Advisor — local expert system, no AI keys
js/studio.js      Studio — orbitable 3D material proofing bench
js/regions.js     region maps — labeled panels, mirror pairs, pure data helpers
js/wand.js        magic wand — color-based selection over the composited paint
js/lightsweep.js  Shine view — WebGL per-pixel light sweep over the sheet
js/library.js     built-in starter graphics (inline SVGs)
js/shaderball.js  material picker swatches rendered as shaded spheres
js/vendor/        vendored ag-psd (pinned, no runtime CDN dependency)
icons/            PWA install icons (any + maskable)
```

Unit tests (node only, no dependencies): `npm test` runs `node --test` over `test/` — the pure TGA encode/decode paths and the region-map helpers.

## Roadmap

- Studio improvements — car-shaped geometry, more environments
- Project gallery / shareable templates
