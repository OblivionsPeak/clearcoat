# Clearcoat — iRacing Livery Workbench

Photoshop-free iRacing livery editing in the browser, with **live preview on the real car** — Clearcoat saves directly into your iRacing paints folder and the sim showroom hot-reloads the paint within seconds.

**Live app:** https://oblivionspeak.github.io/clearcoat/

## How it works

1. **Load a template** — download your car's official template from [Trading Paints' template library](https://www.tradingpaints.com/cartemplates) (or in-sim via My Content → Car Manager → Download Template) and load the **PSD straight into Clearcoat** — it extracts the wireframe in the browser, no Photoshop needed. Plain PNG/JPG wireframes work too. The overlay is multiply-blended and never exported.
2. **Build your livery in layers** — pick a base coat color, then drag-and-drop PNGs/JPGs/SVGs (sponsor logos, artwork) onto the canvas. Move, scale, rotate, flip, reorder, set opacity.
3. **Pick materials, not spec maps** — every layer gets a finish (gloss / matte / metallic / chrome). Clearcoat bakes the iRacing spec map for you. Toggle **Spec view** to inspect it.
4. **Save to iRacing** — link your `Documents\iRacing\paints\<car>\` folder once (Chrome/Edge), enter your customer ID, and hit **Save to iRacing**. Keep the sim showroom open on a second monitor: it reloads `car_<custid>.tga` automatically when the file changes. Edit → save → see it on the car.

No install, no backend, no account. Everything runs client-side; projects autosave to your browser (IndexedDB) and can be exported/imported as `.clearcoat.json`.

## Exports

| Output | Format |
|---|---|
| Car paint | `car_<custid>.tga` — 2048×2048, 24-bit uncompressed TGA |
| Spec map | `car_spec_<custid>.tga` — R = metallic, G = roughness, B = clearcoat (iRacing PBR convention) |
| Portable | PNG download (e.g. for Trading Paints upload) |

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
| `S` | Toggle spec view |
| `F` | Fit to window |
| Scroll / Space-drag or right-drag | Zoom / pan |

## Development

Pure static site — no build step. Serve the folder with anything (`python -m http.server`) and open `index.html`. ES modules require http(s), not `file://`.

```
index.html
css/app.css
js/main.js      UI, viewport, interactions
js/engine.js    document model, paint + spec compositing
js/tga.js       24-bit TGA encoder
js/persist.js   IndexedDB autosave + File System Access handles
```

## Roadmap

- Per-car UV region annotations ("this island is the left door") with mirror-aware logo placement
- Text/number-plate layers
- Gradient and stripe shape layers
- Project gallery / shareable templates
