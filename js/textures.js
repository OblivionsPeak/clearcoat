// Built-in seamless texture library — FLUX-generated tiling materials.
// Each texture inserts as a repeating 'pattern' layer over a resizable region
// (createPatternLayer), the same as an imported + Pattern. Full-res PNGs live
// in textures/full/, small picker thumbnails in textures/thumb/. Recolour after
// inserting with the material Tint, or leave as-is for photographic materials.

export const TEXTURES = [
  { id: 'carbon-twill', name: 'Carbon Twill', cat: 'Carbon' },
  { id: 'forged-carbon', name: 'Forged Carbon', cat: 'Carbon' },
  { id: 'woodland-camo', name: 'Woodland Camo', cat: 'Camo' },
  { id: 'desert-camo', name: 'Desert Camo', cat: 'Camo' },
  { id: 'digital-camo', name: 'Digital Camo', cat: 'Camo' },
  { id: 'urban-camo', name: 'Urban Camo', cat: 'Camo' },
  { id: 'brushed-alu', name: 'Brushed Aluminium', cat: 'Metal' },
  { id: 'diamond-plate', name: 'Diamond Plate', cat: 'Metal' },
  { id: 'hammered-ti', name: 'Hammered Titanium', cat: 'Metal' },
  { id: 'hydro-dip', name: 'Hydro Dip', cat: 'Abstract' },
  { id: 'liquid-marble', name: 'Liquid Marble', cat: 'Abstract' },
  { id: 'galaxy', name: 'Galaxy Nebula', cat: 'Abstract' },
  { id: 'geo-facets', name: 'Geo Facets', cat: 'Abstract' },
  { id: 'snakeskin', name: 'Snakeskin', cat: 'Organic' },
  { id: 'cracked-lava', name: 'Cracked Lava', cat: 'Organic' },
  { id: 'circuit', name: 'Circuit Board', cat: 'Tech' },
];

export const texThumb = (t) => `./textures/thumb/${t.id}.jpg`;
export const texFull = (t) => `./textures/full/${t.id}.webp`;

// category order for the picker
export const TEX_CATS = ['Carbon', 'Camo', 'Metal', 'Abstract', 'Organic', 'Tech'];
