// Clearcoat Livery Advisor — a fully local, no-API design coach.
//
// Not an LLM: a small expert system. It matches what the user is going for
// ("make it look aggressive") to a curated knowledge base of racing-livery
// looks, then tailors the advice to THEIR current project — base color,
// finishes in use, layer makeup — so the tips are specific, not generic.
// Everything runs client-side; nothing leaves the browser.

import { MATERIALS } from './engine.js';

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
  for (const l of (doc.layers || [])) {
    if (l.visible === false) continue;
    visible++;
    finishes.add(l.material || 'gloss');
    if (l.type === 'pattern') patterns++;
    else if (l.type === 'text') texts++;
    else if (l.type === 'image') images++;
    else if (l.type === 'fill') { fills++; if (l.color) accents.push(l.color); }
    if ((l.material || '') === 'ghost') ghosts++;
  }
  // best contrast between base and any accent color
  let accentContrast = 0;
  for (const a of accents) accentContrast = Math.max(accentContrast, contrastRatio(doc.baseColor, a));
  return {
    doc, base, baseColor: doc.baseColor, baseMaterial: doc.baseMaterial || 'gloss',
    finishes, accents, accentContrast,
    counts: { visible, patterns, ghosts, texts, images, fills },
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

// keep the finish glossary handy for "what does X finish do" style questions
const FINISH_HELP = Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, m.label]));

// ---------- intent matching ----------

function matchLook(query) {
  const q = ` ${query.toLowerCase()} `;
  let best = null, bestScore = 0, second = null;
  for (const look of LOOKS) {
    let score = 0;
    for (const kw of look.keywords) if (q.includes(kw)) score += kw.length > 4 ? 2 : 1;
    if (q.includes(look.id)) score += 2;
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
      summary: `I couldn't pin down a specific look from that. Try describing the feeling — "aggressive", "clean and modern", "factory GT3", "murdered-out", "loud and colorful", "vintage", "elegant", or "sponsor car". Or tap a chip below.`,
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

  const form = el('form', 'advisor-form');
  const input = el('input', 'advisor-input');
  input.type = 'text';
  input.placeholder = 'e.g. "make it look more aggressive"';
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
