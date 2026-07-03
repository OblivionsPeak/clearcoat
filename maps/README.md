# Community region maps

Region maps label the panels of a car's 2048×2048 paint sheet — hood, doors,
bumpers — and record mirror pairs ("Left Door mirrors Right Door"). In
Clearcoat they power hover panel names, the **Regions** overlay, and one-click
**Mirror**. This folder is the shared library: one map per car, contributed
via pull request, loaded in-app with the **Get map…** button.

## Format

Each map is a JSON file in the `clearcoat-regions/1` format, exactly as
exported by Clearcoat itself:

```json
{
  "format": "clearcoat-regions/1",
  "car": "Mazda MX-5 Cup",
  "regions": [
    { "id": "hood",       "name": "Hood",       "x": 128, "y": 96,  "w": 480, "h": 360 },
    { "id": "left_door",  "name": "Left Door",  "x": 700, "y": 500, "w": 300, "h": 260, "mirror": "right_door" },
    { "id": "right_door", "name": "Right Door", "x": 1100, "y": 500, "w": 300, "h": 260, "mirror": "left_door" }
  ]
}
```

- All coordinates are in 2048-sheet space; rectangles only (v1).
- `mirror` is optional and must reference another region's `id`.

## Contributing a map

1. In Clearcoat, load your car's template and switch on **Annotate** mode
   (the warning-colored button in the viewport HUD). Drag rectangles over
   the panels, name them, and record mirror partners as prompted.
2. Click **Export map** in the Template panel to download the JSON.
3. Rename the file to `<car-folder-name>.json`, where `<car-folder-name>`
   is the car's subfolder name under your iRacing `paints` directory
   (e.g. `mx5 mx52016.json`, `ferrari296gt3.json`).
4. Add the file to this folder and add an entry to `index.json`:

   ```json
   { "car": "<car-folder-name>", "file": "<car-folder-name>.json", "label": "Human-readable car name" }
   ```

5. Open a pull request. One file per car — if a map already exists for your
   car, improve it instead of adding a duplicate.
