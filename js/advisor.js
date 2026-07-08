// Clearcoat Livery Advisor — a fully local, no-API design coach.
//
// Not an LLM: a small expert system. It matches what the user is going for
// ("make it look aggressive") to a curated knowledge base of racing-livery
// looks, then tailors the advice to THEIR current project — base color,
// finishes in use, layer makeup — so the tips are specific, not generic.
// Everything runs client-side; nothing leaves the browser.

import { MATERIALS, resolveParams } from './engine.js';

// ---------- color helpers ----------

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v || '000000', 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function relLum({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const la = relLum(hexToRgb(a)), lb = relLum(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hueName(h) {
  const names = [
    [15, 'red'], [45, 'orange'], [65, 'yellow'], [150, 'green'],
    [200, 'teal'], [255, 'blue'], [290, 'purple'], [340, 'magenta'], [360, 'red'],
  ];
  for (const [max, name] of names) if (h <= max) return name;
  return 'red';
}

function describeColor(hex) {
  const hsl = rgbToHsl(hexToRgb(hex));
  const lum = relLum(hexToRgb(hex));
  const lightness = lum < 0.06 ? 'very dark' : lum < 0.22 ? 'dark' : lum < 0.55 ? 'mid-tone' : 'light';
  const temp = hsl.s < 0.12 ? 'neutral' : (hsl.h < 70 || hsl.h > 300) ? 'warm' : 'cool';
  const chroma = hsl.s < 0.15 ? 'muted' : hsl.s > 0.6 ? 'vivid' : 'moderate';
  const name = hsl.s < 0.12
    ? (lum < 0.1 ? 'near-black' : lum > 0.8 ? 'near-white' : 'gray')
    : `${chroma} ${hueName(hsl.h)}`;
  return { hsl, lum, lightness, temp, chroma, name, hex, desc: `${lightness} ${name}` };
}

// ---------- read the current project into a context object ----------

export function readContext(doc) {
  const base = describeColor(doc.baseColor);
  const finishes = new Set([doc.baseMaterial || 'gloss']);
  const accents = [];
  let visible = 0, patterns = 0, ghosts = 0, texts = 0, images = 0, fills = 0;
  // material forensics: which layers actually scatter light / mute color
  const roughLayers = [], metalLayers = [], lowClearLayers = [];
  let multiplies = 0, tints = 0;
  for (const l of (doc.layers || [])) {
    if (l.visible === false) continue;
    visible++;
    finishes.add(l.material || 'gloss');
    if (l.type === 'pattern') patterns++;
    else if (l.type === 'text') texts++;
    else if (l.type === 'image') images++;
    else if (l.type === 'fill') { fills++; if (l.color) accents.push(l.color); }
    if ((l.material || '') === 'ghost') ghosts++;
    if (l.blend === 'multiply') multiplies++;
    if (l.matParams?.tintAmt) tints++;
    const p = resolveParams(l.material || 'gloss', l.matParams);
    if (p.rough > 150) roughLayers.push(l.name || l.type);
    if (p.met > 180) metalLayers.push(l.name || l.type);
    if (p.clear < 120) lowClearLayers.push(l.name || l.type);
  }
  const baseP = resolveParams(doc.baseMaterial || 'gloss', doc.baseMatParams);
  // best contrast between base and any accent color
  let accentContrast = 0;
  for (const a of accents) accentContrast = Math.max(accentContrast, contrastRatio(doc.baseColor, a));
  return {
    doc, base, baseColor: doc.baseColor, baseMaterial: doc.baseMaterial || 'gloss', baseP,
    finishes, accents, accentContrast,
    counts: { visible, patterns, ghosts, texts, images, fills },
    mats: { roughLayers, metalLayers, lowClearLayers, multiplies, tints },
    hasTemplate: !!doc.template,
  };
}

// ---------- general issues, checked for every request ----------

const SHINY = new Set(['chrome', 'candy', 'pearl', 'flake']);

function generalIssues(ctx) {
  const out = [];
  if ((ctx.baseMaterial === 'matte' || ctx.baseMaterial === 'satin')
      && [...ctx.finishes].some((f) => SHINY.has(f))) {
    out.push(`Your base is ${ctx.baseMaterial} but you've got a high-gloss finish on top — matte + chrome/candy/pearl tend to fight. Either gloss the base or keep accents satin/gloss for a consistent clear coat.`);
  }
  if (ctx.finishes.size > 4) {
    out.push(`You're mixing ${ctx.finishes.size} finishes (${[...ctx.finishes].join(', ')}). Liveries read cleaner and more "designed" with 2–3 materials — pick a hero finish and a supporting one.`);
  }
  if (ctx.base.lightness === 'light' && ctx.finishes.has('chrome')) {
    out.push(`Chrome barely reads on a light base — there's no dark surround for it to reflect. Chrome pops hardest against near-black.`);
  }
  if (ctx.counts.ghosts > 0 && !ctx.finishes.has('gloss') && ctx.baseMaterial !== 'gloss') {
    out.push(`You have a Ghost layer but little gloss around it — ghost designs show up in reflections, so they read best against a glossy base. Preview with Shine.`);
  }
  if (ctx.accents.length && ctx.accentContrast < 2.2) {
    out.push(`Your accent color is low-contrast against the base (ratio ~${ctx.accentContrast.toFixed(1)}:1). Push it lighter or darker so graphics stay legible at track distance.`);
  }
  if (!ctx.hasTemplate) {
    out.push(`Tip: load your car's template (Template panel) so your placement lands on the real panels — advice about "hood" or "doors" only helps if the sheet is mapped.`);
  }
  return out;
}

// ---------- the knowledge base: looks people ask for ----------

const LOOKS = [
  {
    id: 'aggressive',
    label: 'Aggressive / mean',
    keywords: ['aggressive', 'aggression', 'mean', 'menacing', 'angry', 'scary', 'intimidat', 'villain', 'evil', 'brutal', 'sinister', 'predator', 'nasty', 'beast'],
    summary: 'Menace comes from darkness, one sharp accent, and hard angles — not from adding more stuff.',
    advise(ctx) {
      const t = [];
      t.push(ctx.base.lightness.includes('dark')
        ? `Good — your ${ctx.base.desc} base already sets a menacing tone.`
        : `Your base is ${ctx.base.desc}. Aggression reads darkest — drop the base toward near-black (#111318) or a very dark version of your hue.`);
      t.push(`Add ONE high-chroma accent for bite — candy red, acid green, or hot orange — and keep everything else dark. Restraint makes the accent hit harder.`);
      t.push(`Break up flat panels with a Carbon weave Fill on the hood/splitter, or hard-edged angular Fill shapes (use the "stripe"/"triangle" shapes) instead of soft curves.`);
      t.push(`Run a Ghost stripe down the centerline so it only flashes in reflections — subtle intimidation. Check it with Shine.`);
      t.push(`Skip pearl and chrome here; they read "show car," not "predator." Matte or satin on the base sells stealthy menace.`);
      return t;
    },
  },
  {
    id: 'clean',
    label: 'Clean / minimal',
    keywords: ['clean', 'minimal', 'simple', 'modern', 'sleek', 'tidy', 'understated', 'less', 'refined', 'crisp'],
    summary: 'Minimal is about discipline: few colors, one finish, lots of negative space.',
    advise(ctx) {
      const t = [];
      t.push(`Limit yourself to 2 colors + 1 metal, and a single finish (gloss or satin). ${ctx.finishes.size > 2 ? `You're at ${ctx.finishes.size} finishes now — trim back.` : ''}`.trim());
      t.push(`Let the base color carry the car. Use big empty panels and place logos with generous margins — negative space is the whole point.`);
      t.push(`One accent stripe (a Fill "stripe" shape) or a single tonal panel is plenty. Resist filling every surface.`);
      t.push(`For interest without clutter, make one panel a slightly different finish of the SAME color — e.g. a satin panel on a gloss body. It only shows under light (try Shine/Studio).`);
      if (ctx.counts.visible > 6) t.push(`You have ${ctx.counts.visible} visible layers — a minimal look usually lives under ~5. Consider what you can remove.`);
      return t;
    },
  },
  {
    id: 'premium',
    label: 'Premium / factory GT3',
    keywords: ['premium', 'factory', 'gt3', 'oem', 'manufacturer', 'expensive', 'luxury', 'high-end', 'professional', 'official', 'works team', 'pro'],
    summary: 'Factory cars look expensive through tonal restraint, precise geometry, and pearl/metallic depth — never loud.',
    advise(ctx) {
      const t = [];
      t.push(`Base it in a deep, slightly desaturated color (manufacturer blues, silvers, deep reds) with a Pearl or Metallic finish for showroom depth — proof it in Studio, since pearl only reads on curvature.`);
      t.push(`Keep graphics geometric and symmetric. Use the Mirror feature (region map) so left/right match exactly — asymmetry reads "amateur."`);
      t.push(`Two-tone with a tonal split (e.g. gloss body + satin roof of the same family) rather than clashing colors. Add a single thin accent line to separate them.`);
      t.push(`Sponsor logos: fewer, larger, cleanly aligned along a shared baseline. Tint them to 1–2 brand colors so they feel curated.`);
      if (ctx.base.chroma === 'vivid') t.push(`Your base is quite vivid — factory liveries usually pull the saturation back a touch for that "paid-for" look.`);
      return t;
    },
  },
  {
    id: 'stealth',
    label: 'Stealth / murdered-out',
    keywords: ['stealth', 'murdered', 'blackout', 'black out', 'all black', 'dark', 'tonal', 'ghost', 'subtle', 'monochrome', 'shadow'],
    summary: 'All-black done right is about finish contrast, not color contrast.',
    advise(ctx) {
      const t = [];
      t.push(`Go near-black everywhere, then create the design purely through FINISH differences: matte base with gloss-black graphics, or satin panels on a gloss body. The livery only appears as light rakes across it.`);
      t.push(`Ghost layers are your best friend here — put logos/numbers as Ghost so they exist only in reflections. Preview with Shine and Studio.`);
      t.push(`A single carbon-weave panel adds texture without adding color. A whisper of dark candy (deep red/blue) over black reads almost black until the light hits it.`);
      t.push(`Keep clearcoat high on the glossy elements so they separate from the matte ones — that separation IS the design.`);
      return t;
    },
  },
  {
    id: 'loud',
    label: 'Loud / high-visibility',
    keywords: ['loud', 'bright', 'visib', 'bold', 'vibrant', 'colorful', 'flashy', 'eye-catching', 'pop', 'neon', 'stand out', 'fun', 'wild', 'crazy'],
    summary: 'Loud works when high-energy color is organized by strong shapes — not just cranked saturation.',
    advise(ctx) {
      const t = [];
      t.push(`Pair two vivid colors with a hard value contrast (e.g. hot pink + cyan, or orange + electric blue). ${ctx.accents.length && ctx.accentContrast < 3 ? 'Your current accent is a bit low-contrast — push it further from the base.' : ''}`.trim());
      t.push(`Contain the chaos with bold geometric shapes — big diagonal stripes, chevrons, or blocked panels — so it reads as "designed loud," not "messy."`);
      t.push(`Gloss finish keeps colors saturated and juicy; matte would mute the very thing you want. Add Flake to one hero panel for extra sparkle under light.`);
      t.push(`Give a bright base a thin dark outline between color zones — it stops vivid colors from vibrating against each other.`);
      return t;
    },
  },
  {
    id: 'showcar',
    label: 'Show car / flashy metal',
    keywords: ['show', 'chrome', 'flashy', 'bling', 'shiny', 'metallic', 'metal flake', 'candy', 'custom', 'lowrider', 'sparkle', 'pearl'],
    summary: 'Show finishes (chrome, candy, flake, pearl) are the star — give them room and dark surrounds.',
    advise(ctx) {
      const t = [];
      t.push(`Chrome and candy need a dark surround to reflect — put them on or beside near-black panels. ${ctx.base.lightness === 'light' ? 'Your light base is working against them; darken it.' : ''}`.trim());
      t.push(`Layer a Candy finish over a metallic base of the same hue for that deep, wet, lit-from-within look. Flake adds sparkle; use it sparingly on hero panels.`);
      t.push(`These finishes ONLY read on curvature and motion — judge them in Studio and Shine, not the flat sheet. What looks flat here will glow on the car.`);
      t.push(`Don't gloss-bomb everything. One or two show finishes against matte/satin makes them read as jewelry; everything shiny reads as noise.`);
      return t;
    },
  },
  {
    id: 'retro',
    label: 'Retro / vintage racing',
    keywords: ['retro', 'vintage', 'classic', 'old school', 'oldschool', 'heritage', '70s', '80s', '90s', 'throwback', 'nostalg', 'historic', 'gulf', 'martini'],
    summary: 'Vintage liveries lean on flat gloss color, iconic stripe motifs, and slightly muted palettes.',
    advise(ctx) {
      const t = [];
      t.push(`Use classic heritage palettes: powder-blue + orange (Gulf), white/red/navy (Martini-style), or cream + British racing green. Pull saturation back slightly for a period-correct feel.`);
      t.push(`Vintage = flat gloss color, not modern metal. Skip flake/carbon; a straightforward gloss or satin sells the era. Carbon weave especially reads "modern" and breaks the illusion.`);
      t.push(`Lean on horizontal stripe motifs and roundel number circles (check the Library for roundels/stripes). Keep numbers big and bold in a period typeface.`);
      t.push(`A tiny bit of grain/imperfection helps — but keep geometry clean; vintage racing graphics were simple and confident.`);
      return t;
    },
  },
  {
    id: 'corporate',
    label: 'Corporate / sponsor-heavy',
    keywords: ['corporate', 'sponsor', 'brand', 'logos', 'business', 'realistic', 'nascar', 'stock car', 'advertis', 'commercial'],
    summary: 'Sponsor-heavy cars stay legible through hierarchy: one hero sponsor, everyone else smaller and aligned.',
    advise(ctx) {
      const t = [];
      t.push(`Establish hierarchy: ONE hero sponsor owns the doors/hood, secondaries get a consistent smaller size, tertiaries line up along the rockers. Don't let everything compete.`);
      t.push(`Give logos a unified home — a white or light "billboard" panel keeps multicolor logos legible instead of scattering them on colored bodywork.`);
      t.push(`Align everything to shared baselines and margins. The difference between "pro" and "amateur" sponsor cars is almost entirely alignment and consistent sizing.`);
      t.push(`Gloss finish throughout — this is advertising, and gloss keeps logos crisp and colors accurate. Save exotic finishes for a personal car.`);
      if (ctx.counts.images < 2) t.push(`You've only got ${ctx.counts.images} image layer(s) — add your sponsor PNGs, then we can talk layout.`);
      return t;
    },
  },
  {
    id: 'elegant',
    label: 'Elegant / classy',
    keywords: ['elegant', 'classy', 'sophisticated', 'tasteful', 'refined', 'graceful', 'timeless', 'understated luxury', 'subtle'],
    summary: 'Elegance is restraint plus one luxurious detail — a pearl sheen, a gold pinstripe.',
    advise(ctx) {
      const t = [];
      t.push(`Start from a deep, sophisticated base — midnight blue, charcoal, deep burgundy, or a soft off-white — with a Pearl or Glaze finish for quiet depth.`);
      t.push(`Add ONE refined accent: a thin metallic-gold or silver pinstripe (Fill "stripe" with a metallic finish). One line, perfectly placed, beats any busy graphic.`);
      t.push(`Keep the palette tonal — variations of one color family — and let finish do the talking. Elegant cars whisper.`);
      t.push(`Symmetry and generous spacing throughout. Nothing rushed, nothing crowded.`);
      return t;
    },
  },
];

// ---------- the fixes: symptoms people report, diagnosed against the doc ----------
// Same shape as LOOKS but framed as problem → material-level cure. Each one
// leans on how the spec map actually works (R=metallic, G=roughness,
// B=clearcoat) and names the offending layers when it can.

const listSome = (arr) => arr.slice(0, 3).map((n) => `"${n}"`).join(', ') + (arr.length > 3 ? ` +${arr.length - 3} more` : '');

const FIXES = [
  {
    id: 'muted',
    label: 'Looks muted / washed out',
    kind: 'fix',
    keywords: ['muted', 'washed out', 'washed-out', 'dull', 'desaturat', 'faded', 'chalky', 'pale', 'lifeless', 'drab', 'pastel', 'not vibrant', 'colors pop', 'more pop', 'pop more', 'vibrant'],
    summary: 'Muted color is almost always a materials problem, not a color problem — roughness and metallic both steal saturation.',
    advise(ctx) {
      const t = [];
      if (ctx.mats.roughLayers.length || ctx.baseP.rough > 150) {
        const who = ctx.baseP.rough > 150 ? `your ${ctx.baseMaterial} base coat` : listSome(ctx.mats.roughLayers);
        t.push(`Prime suspect: high roughness on ${who}. Rough surfaces scatter light and read chalky. Switch to Gloss, or open the material's tuning and drag Roughness down toward ~40 — saturation comes back immediately.`);
      } else {
        t.push(`Your finishes aren't rough, so check saturation at the source: gloss keeps color juicy (roughness ~40, clearcoat 255). If a layer still looks flat, open its material tuning and confirm Roughness isn't cranked.`);
      }
      if (ctx.mats.metalLayers.length) {
        t.push(`High metallic also desaturates: ${listSome(ctx.mats.metalLayers)} take their color from reflections, so under the showroom's warm light the hue drifts and dilutes. For pure vivid paint, keep Metallic near 0; if you want metal depth WITH color, use Candy — it's metallic that stays hue-locked.`);
      }
      if (ctx.mats.lowClearLayers.length || ctx.baseP.clear < 120) {
        t.push(`Low clearcoat (blue channel) kills the wet look. iRacing wants it at 255 unless you're deliberately going matte — check ${ctx.baseP.clear < 120 ? 'the base coat' : listSome(ctx.mats.lowClearLayers)}.`);
      }
      if (ctx.base.chroma === 'muted') {
        t.push(`The base color itself is low-saturation (${ctx.base.desc}). Materials can't add chroma that isn't there — push the base's saturation up, then let gloss do the rest.`);
      }
      if (ctx.mats.multiplies) t.push(`You have ${ctx.mats.multiplies} Multiply-blend layer(s) — multiply only darkens. If one sits over the whole sheet (weathering/shading), it's dragging everything down; lower its opacity or cut it.`);
      if (ctx.mats.tints) t.push(`Tint washes desaturate too when the tint color is grayish — check the ${ctx.mats.tints} tinted layer(s).`);
      t.push(`Sanity-check in Shine (L) and Studio: a gloss/candy livery that still looks muted on the flat sheet often looks perfect on curvature. Judge on the 3D proof, not the sheet.`);
      return t;
    },
  },
  {
    id: 'toodark',
    label: 'Too dark',
    kind: 'fix',
    keywords: ['too dark', 'dark and', 'darker than', 'gloomy', 'murky', 'can barely see', 'too black', 'brighten', 'lighten'],
    summary: 'Darkness compounds: base value, multiply layers, and rough finishes all subtract light.',
    advise(ctx) {
      const t = [];
      if (ctx.base.lum < 0.1) t.push(`Your base is ${ctx.base.desc} — start there. Even one notch lighter shifts the whole car; the sim's ambient light has nothing to bounce off near-black.`);
      if (ctx.mats.multiplies) t.push(`${ctx.mats.multiplies} Multiply layer(s) are subtracting light on top. Swap shading layers to Soft light at reduced opacity — you keep the depth without the mud.`);
      if (ctx.mats.roughLayers.length || ctx.baseP.rough > 150) t.push(`Matte finishes read a full step darker than gloss under track lighting because they don't return highlights. Glossing the same color visibly lifts it.`);
      t.push(`Add a light-value element for range: a white/silver stripe or panel gives the eye a bright anchor and makes the dark read intentional instead of murky.`);
      t.push(`Try a Screen-blend glow accent or a Ghost element over gloss — reflected highlights brighten a dark car without changing its color.`);
      return t;
    },
  },
  {
    id: 'flat',
    label: 'Looks flat / no depth',
    kind: 'fix',
    keywords: ['flat', 'no depth', 'boring', 'plain', 'lifeless', 'plastic', 'toy', 'cheap', 'one-dimensional', 'depth', 'bland', 'sticker'],
    summary: 'Depth comes from finish CONTRAST — two materials on one color beat five colors on one material.',
    advise(ctx) {
      const t = [];
      if (ctx.finishes.size <= 1) t.push(`Everything is ${[...ctx.finishes][0]} right now — that's why it reads like a wrap sticker. Give one zone a different finish of the same color: satin roof on a gloss body, or a gloss stripe across matte.`);
      t.push(`Pearl and Glaze add lit-from-within depth that flat color can't. Glaze (validated in-sim) layers a pearl feel over existing artwork without muting it — perfect on top of a design you already like.`);
      t.push(`Use spec stacking: set an overlapping layer's spec blend to Add and the finishes compound where they overlap — that's how you get a candy-over-metal glow on a hero panel.`);
      t.push(`A Flake or Carbon panel adds micro-texture the eye reads as expensive. One panel, not the whole car.`);
      t.push(`Judge depth on curvature — the flat sheet hides everything pearl/candy/flake do. Open Studio (sphere or door panel) and sweep Shine (L).`);
      return t;
    },
  },
  {
    id: 'notshiny',
    label: 'Not shiny in the sim',
    kind: 'fix',
    keywords: ['not shiny', "isn't shiny", 'no shine', 'no gloss', 'not glossy', 'not reflect', 'no reflection', 'wont shine', "won't shine", 'looks matte', 'shine in the sim', 'not wet'],
    summary: 'Shine lives in the spec map: low roughness (G) + full clearcoat (B). If the sim ignores it, the spec map probably never made it there.',
    advise(ctx) {
      const t = [];
      const rough = [];
      if (ctx.baseP.rough > 100) rough.push('the base coat');
      if (ctx.mats.roughLayers.length) rough.push(listSome(ctx.mats.roughLayers));
      if (rough.length) t.push(`Roughness is the shine killer and it's elevated on ${rough.join(' and ')}. Gloss sits at ~40; drag it below 60 and keep Clearcoat at 255.`);
      else t.push(`Your materials look glossy on paper — so the likely culprit is the spec map not reaching the sim. "Save to iRacing" writes car_spec_<id>.tga next to the paint; the showroom needs both.`);
      t.push(`If you're running the livery through Trading Paints, remember TP needs the sim-generated .mip for the spec side — paint-only uploads come out uniformly semi-gloss. Save to iRacing → open the showroom once → Send to TP (it bundles the spec MIP).`);
      if (ctx.doc.target !== 'car') t.push(`Heads-up: this project targets a ${ctx.doc.target} — iRacing doesn't support spec maps for helmets/suits at all, so finish control only exists on cars.`);
      t.push(`Verify what you're shipping with Spec view (S): green = rough, blue = clearcoat. A shiny car's spec map looks predominantly blue with dark green.`);
      return t;
    },
  },
  {
    id: 'tooshiny',
    label: 'Too shiny / looks like plastic',
    kind: 'fix',
    keywords: ['too shiny', 'too glossy', 'plasticky', 'plastic', 'oily', 'greasy', 'too reflective', 'blinding', 'tone down the shine'],
    summary: 'Uniform gloss reads as plastic — real paint varies. Pull roughness up selectively.',
    advise(ctx) {
      const t = [];
      t.push(`Move the body to Satin (roughness ~120) and keep true Gloss only on graphics or a hero panel — the contrast makes the shine read as paint, not shrink-wrap.`);
      t.push(`If it's the metallic elements blowing out, drop their Metallic value or raise Roughness slightly (chrome at rough 10 is a mirror; rough 40 is brushed jewelry).`);
      t.push(`Clearcoat (blue channel) at 255 everywhere is correct per iRacing — control the plastic feel with Roughness, not clearcoat, so the paint still sits "under lacquer."`);
      t.push(`Check in Studio's Neutral environment — the showroom's warm key exaggerates hotspots that look fine in Dusk/track light.`);
      return t;
    },
  },
  {
    id: 'sparkle',
    label: 'Flake / sparkle not showing',
    kind: 'fix',
    keywords: ['flake', 'sparkle', 'glitter', 'metal flake', 'no sparkle', "can't see the flake", 'flakes', 'sparkly'],
    summary: 'Flake and Glitter are per-pixel spec textures — they need density, curvature, moving light, and the spec map actually reaching the sim.',
    advise(ctx) {
      const t = [];
      t.push(`Open the layer's material tuning: Density around 18–30 and Contrast near 100 make it obvious; the default is deliberately subtle.`);
      t.push(`If Flake still reads too fine, switch the layer to Glitter — same idea but multi-pixel chips, each flashing at its own angle. Its Size knob controls chip coarseness (4–8 px reads clearly at track distance).`);
      t.push(`Flake only exists in the spec map, so it's invisible in plain paint view — preview with Shine (L) where the sweeping light makes it sparkle, or orbit it in Studio.`);
      t.push(`It reads best on dark, saturated colors (the sparkle is bright metallic spikes — they vanish against white). Deep reds, blues, and black are flake's home turf.`);
      t.push(`In the sim: flake needs the spec TGA (Save to iRacing) — and on Trading Paints it needs the .mip spec upload, or your flake never leaves your machine.`);
      return t;
    },
  },
  {
    id: 'chromedull',
    label: 'Chrome looks grey / dead',
    kind: 'fix',
    keywords: ['chrome looks', 'chrome is', 'chrome not', 'chrome dull', 'chrome grey', 'chrome gray', 'chrome flat', 'mirror'],
    summary: 'Chrome has no color of its own — it is 100% reflected environment, so it lives or dies by what surrounds it.',
    advise(ctx) {
      const t = [];
      t.push(`Chrome is metallic 255 / roughness 10 — pure mirror. On the flat sheet it just shows the paint color underneath; the effect only exists on curvature under an environment. Judge it ONLY in Studio or the sim showroom.`);
      if (ctx.base.lightness === 'light') t.push(`Your base is ${ctx.base.desc} — chrome needs dark surrounds to have something to contrast against. Frame chrome elements with near-black panels or keylines.`);
      t.push(`Make the chrome layer's paint color a light neutral grey (#c8c8cc) rather than white — pure white blows out the reflection highlights.`);
      t.push(`If it's still grey in the sim, the spec map isn't loading (chrome without its spec data is just grey paint): Save to iRacing, and via Trading Paints upload the spec .mip.`);
      return t;
    },
  },
  {
    id: 'pearldrift',
    label: 'Pearl looks wrong / drifts yellow',
    kind: 'fix',
    keywords: ['pearl looks', 'pearl is', 'pearl not', 'pearl yellow', 'pearl warm', 'pearl white', 'pearl wrong', 'pearlescent'],
    summary: "Pearl's color comes half from reflections — the showroom's warm light pulls it yellow, and the Tint is the steering wheel.",
    advise(ctx) {
      const t = [];
      t.push(`The showroom key light is warm (~5500K), so high-metallic pearl drifts warm/yellow. Counter it with the layer's Tint: a cool blue-white tint at 15–30% pulls pearl back to neutral ice.`);
      t.push(`Pearl over existing artwork mutes it — that's what Glaze is for (metallic 75 / rough 55 / clear 255, validated in-sim): pearl sheen without washing out the design underneath.`);
      t.push(`Pearl is invisible on the flat sheet and weak on flat panels — it needs compound curves. Proof on Studio's sphere or door panel, and compare Showroom vs Neutral environments to separate the material from the lighting.`);
      t.push(`If pearl reads as plain white in the sim, the spec map isn't arriving — same checklist as gloss: Save to iRacing, showroom once, spec .mip for Trading Paints.`);
      return t;
    },
  },
  {
    id: 'simdiff',
    label: 'Colors look different in the sim',
    kind: 'fix',
    keywords: ['different in the sim', 'different in sim', 'different in game', 'in-game', 'showroom looks', "doesn't match", 'does not match', 'color shift', 'colours are', 'colors are wrong', 'hue shift'],
    summary: "The sim isn't showing your file wrong — it's lighting it. Warm light + material metallic are the two shifters.",
    advise(ctx) {
      const t = [];
      t.push(`The iRacing showroom uses a warm key light, so everything drifts warm: whites go cream, blues dull, reds glow. Clearcoat's Studio "Showroom" environment mimics this — design against it, and use "Neutral" to see the un-lit truth.`);
      if (ctx.mats.metalLayers.length) t.push(`Metallic layers (${listSome(ctx.mats.metalLayers)}) shift the most because reflections carry the environment's color. Drop Metallic for hue-critical elements (sponsor brand colors should be met 0, gloss).`);
      t.push(`Counter a known drift with Tint: e.g. pearl going yellow → cool tint at ~20%. Tune, Save to iRacing, and check the actual showroom — Live Sync makes that loop a few seconds.`);
      t.push(`Also confirm the sim is even loading your file and not a Trading Paints download — if you run the TP app, turn on TP Guard so your local save survives.`);
      return t;
    },
  },
  {
    id: 'legibility',
    label: 'Numbers / logos hard to read',
    kind: 'fix',
    keywords: ['hard to read', "can't read", 'cant read', 'be read', 'readab', 'illegible', 'legib', 'invisible', 'blends in', 'number', 'logo disappear', 'lost against', 'stand out more'],
    summary: 'Legibility at track distance = value contrast + a separating edge, not size alone.',
    advise(ctx) {
      const t = [];
      if (ctx.accents.length && ctx.accentContrast < 3) t.push(`Your accent-vs-base contrast is ~${ctx.accentContrast.toFixed(1)}:1 — that melts at 100 m. Aim for 4.5:1+; push the element lighter or darker rather than changing hue.`);
      t.push(`Give numbers and logos an Effects outline (select the layer → Effects → Outline): a 6–12 px contour in the opposite value creates separation on any background — it's also stamped into the spec map so the edge survives every lighting angle.`);
      t.push(`Park numbers on a dedicated plate: a white or black Fill behind them (Library has number plates/roundels). Race-control legibility is why real series mandate these.`);
      t.push(`Avoid putting text over busy patterns — or knock the pattern's opacity down 30% inside a plate zone. Contrast of VALUE beats contrast of color: check by squinting or zooming the viewport way out.`);
      t.push(`Keep finishes on text simple gloss — chrome/flake text sparkles but destroys reading distance.`);
      return t;
    },
  },
];

// keep the finish glossary handy for "what does X finish do" style questions
const FINISH_HELP = Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, m.label]));

// ---------- intent matching ----------

function matchLook(query) {
  const q = ` ${query.toLowerCase()} `;
  // problem phrasing nudges the fixes ahead of the looks on close scores
  const problemish = /fix|problem|wrong|why|how do i|how can i|too |not |isn't|is not|won't|wont|can't|cant|looks?\s/.test(q);
  let best = null, bestScore = 0, second = null;
  for (const look of [...LOOKS, ...FIXES]) {
    let score = 0;
    for (const kw of look.keywords) if (q.includes(kw)) score += kw.length > 4 ? 2 : 1;
    if (q.includes(look.id)) score += 2;
    if (score > 0 && problemish && look.kind === 'fix') score += 1;
    if (score > bestScore) { second = best; best = look; bestScore = score; }
    else if (score > 0 && score >= bestScore - 1 && look !== best) second = look;
  }
  return { look: bestScore > 0 ? best : null, score: bestScore, second: bestScore > 0 ? second : null };
}

// ---------- produce a full answer ----------

export function advise(query, doc) {
  const ctx = readContext(doc);
  const { look, second } = matchLook(query || '');
  const issues = generalIssues(ctx);

  if (!look) {
    return {
      title: 'Tell me the vibe you want',
      contextLine: contextLine(ctx),
      summary: `I couldn't pin that down. Describe a look you want ("aggressive", "factory GT3", "murdered-out", "vintage") or a problem to fix ("my livery looks muted", "chrome looks grey", "not shiny in the sim", "numbers are hard to read"). Or tap a chip below.`,
      tips: [],
      issues,
    };
  }
  return {
    title: look.label,
    contextLine: contextLine(ctx),
    summary: look.summary,
    tips: look.advise(ctx),
    alsoTry: second && second !== look ? second.label : null,
    issues,
  };
}

function contextLine(ctx) {
  const bits = [`Base: ${ctx.base.desc}, ${ctx.baseMaterial}`];
  bits.push(`${ctx.counts.visible} layer${ctx.counts.visible === 1 ? '' : 's'}`);
  if (ctx.finishes.size) bits.push(`finishes: ${[...ctx.finishes].join(', ')}`);
  return bits.join('  ·  ');
}

// ---------- UI ----------

const CSS = `
#advisor-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(6,7,9,.66);backdrop-filter:blur(2px)}
#advisor-modal[hidden]{display:none}
.advisor-panel{width:min(560px,92vw);max-height:86vh;overflow:auto;background:var(--panel);border:1px solid var(--seam-bright);border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.6);padding:20px 22px;font-family:var(--font-ui);color:var(--ink)}
.advisor-panel h2{font-family:var(--font-display);font-size:24px;letter-spacing:.4px;margin:0 0 2px;display:flex;align-items:center;gap:8px}
.advisor-close{margin-left:auto;background:none;border:1px solid var(--seam);color:var(--ink-dim);border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:15px}
.advisor-close:hover{color:var(--ink);border-color:var(--seam-bright)}
.advisor-sub{color:var(--ink-dim);font-size:13px;margin:0 0 14px}
.advisor-chips{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 14px}
.advisor-chip{border:1px solid var(--seam);background:var(--panel-raise);color:var(--ink);padding:6px 12px;border-radius:16px;font-size:13px;cursor:pointer;transition:.13s}
.advisor-chip:hover{border-color:var(--cyan);color:var(--cyan)}
.advisor-chip.fix{border-color:rgba(255,140,60,.35)}
.advisor-chip.fix:hover{border-color:var(--orange);color:var(--orange)}
.advisor-chip-head{font-family:var(--font-display);font-size:13px;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-faint);margin:2px 0 6px}
.advisor-form{display:flex;gap:8px;margin-bottom:6px}
.advisor-input{flex:1;background:var(--asphalt);border:1px solid var(--seam);color:var(--ink);border-radius:8px;padding:10px 12px;font-size:14px;font-family:var(--font-ui)}
.advisor-input:focus{outline:none;border-color:var(--cyan)}
.advisor-ask{background:var(--cyan);color:#06201d;border:0;font-weight:700;border-radius:8px;padding:0 18px;cursor:pointer;font-size:14px}
.advisor-ask:hover{filter:brightness(1.08)}
.advisor-ctx{font-family:var(--font-mono);font-size:11.5px;color:var(--ink-faint);margin:12px 0 4px;border-top:1px solid var(--seam);padding-top:12px}
.advisor-result h3{font-family:var(--font-display);font-size:20px;color:var(--cyan);margin:14px 0 4px}
.advisor-result .summary{color:var(--ink-dim);font-size:13.5px;font-style:italic;margin:0 0 12px}
.advisor-tips{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:9px}
.advisor-tips li{background:var(--panel-raise);border:1px solid var(--seam);border-left:3px solid var(--cyan);border-radius:8px;padding:10px 12px;font-size:13.5px;line-height:1.5}
.advisor-issues{margin-top:14px}
.advisor-issues .head{font-family:var(--font-display);font-size:16px;color:var(--orange-hot);margin:0 0 6px}
.advisor-issues li{border-left-color:var(--orange)}
.advisor-also{margin-top:12px;font-size:13px;color:var(--ink-dim)}
`;

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function initAdvisor(getDoc) {
  // inject styles once
  if (!document.getElementById('advisor-styles')) {
    const st = el('style'); st.id = 'advisor-styles'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  const modal = el('div'); modal.id = 'advisor-modal'; modal.hidden = true;
  const panel = el('div', 'advisor-panel');
  modal.appendChild(panel);

  const head = el('h2', null, '✨ Livery Advisor');
  const closeBtn = el('button', 'advisor-close', '✕'); closeBtn.title = 'Close (Esc)';
  head.appendChild(closeBtn);
  panel.appendChild(head);
  panel.appendChild(el('p', 'advisor-sub', 'Describe the look you want and I\'ll suggest changes based on your current livery. 100% local — nothing leaves your browser.'));

  const chips = el('div', 'advisor-chips');
  for (const look of LOOKS) {
    const c = el('button', 'advisor-chip', esc(look.label));
    c.onclick = () => { input.value = look.label; run(); };
    chips.appendChild(c);
  }
  panel.appendChild(chips);

  panel.appendChild(el('div', 'advisor-chip-head', 'Fix a problem'));
  const fixChips = el('div', 'advisor-chips');
  for (const fix of FIXES) {
    const c = el('button', 'advisor-chip fix', esc(fix.label));
    c.onclick = () => { input.value = fix.label; run(); };
    fixChips.appendChild(c);
  }
  panel.appendChild(fixChips);

  const form = el('form', 'advisor-form');
  const input = el('input', 'advisor-input');
  input.type = 'text';
  input.placeholder = 'e.g. "make it aggressive" or "my livery looks muted"';
  const ask = el('button', 'advisor-ask', 'Advise');
  ask.type = 'submit';
  form.appendChild(input); form.appendChild(ask);
  panel.appendChild(form);

  const result = el('div', 'advisor-result');
  panel.appendChild(result);

  function run() {
    const ans = advise(input.value.trim(), getDoc());
    result.innerHTML = '';
    result.appendChild(el('div', 'advisor-ctx', 'Reading your livery — ' + esc(ans.contextLine)));
    result.appendChild(el('h3', null, esc(ans.title)));
    if (ans.summary) result.appendChild(el('p', 'summary', esc(ans.summary)));
    if (ans.tips && ans.tips.length) {
      const ul = el('ul', 'advisor-tips');
      for (const tip of ans.tips) ul.appendChild(el('li', null, esc(tip)));
      result.appendChild(ul);
    }
    if (ans.alsoTry) result.appendChild(el('p', 'advisor-also', `Also worth trying: <b>${esc(ans.alsoTry)}</b> — tap its chip above.`));
    if (ans.issues && ans.issues.length) {
      const box = el('div', 'advisor-issues');
      box.appendChild(el('div', 'head', 'Things I noticed'));
      const ul = el('ul', 'advisor-tips');
      for (const iss of ans.issues) ul.appendChild(el('li', null, esc(iss)));
      box.appendChild(ul);
      result.appendChild(box);
    }
  }

  form.onsubmit = (e) => { e.preventDefault(); run(); };

  function open() { modal.hidden = false; input.focus(); }
  function close() { modal.hidden = true; }
  closeBtn.onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });

  document.body.appendChild(modal);

  const btn = document.getElementById('btn-advisor');
  if (btn) btn.addEventListener('click', open);

  return { open, close };
}
