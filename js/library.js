// Built-in starter graphics — generic racing shapes inserted as image layers.
// Each item is a complete inline SVG (512px-scale geometry, 2-3 hardcoded
// colors max — users recolor via the material Tint after inserting).

const NS = 'xmlns="http://www.w3.org/2000/svg"';

export const LIBRARY = [
  {
    id: 'roundel',
    name: 'Roundel',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <circle cx="256" cy="256" r="240" fill="#101114"/>
      <circle cx="256" cy="256" r="198" fill="#f4f2ec"/>
    </svg>`,
  },
  {
    id: 'number-plate',
    name: 'Number Plate',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <rect x="36" y="126" width="440" height="260" rx="44" fill="#101114"/>
      <rect x="54" y="144" width="404" height="224" rx="32" fill="#f4f2ec"/>
    </svg>`,
  },
  {
    id: 'star',
    name: 'Star',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <polygon fill="#f4f2ec" points="256,36 305.4,188 465.2,188 335.9,282 385.3,434 256,340 126.7,434 176.1,282 46.8,188 206.6,188"/>
    </svg>`,
  },
  {
    id: 'lightning',
    name: 'Lightning Bolt',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M300 24 L116 280 H234 L180 488 L398 212 H278 L348 24 Z"
        fill="#ffd23f" stroke="#101114" stroke-width="14" stroke-linejoin="round"/>
    </svg>`,
  },
  {
    id: 'chevrons',
    name: 'Triple Chevron',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><path id="cc-chv" d="M24 96 H116 L228 256 L116 416 H24 L136 256 Z"/></defs>
      <use href="#cc-chv" fill="#ff4d00"/>
      <use href="#cc-chv" x="138" fill="#ff4d00"/>
      <use href="#cc-chv" x="276" fill="#ff4d00"/>
    </svg>`,
  },
  {
    id: 'checkers',
    name: 'Checkered Block',
    svg: `<svg ${NS} viewBox="0 0 500 300" width="500" height="300">
      <rect width="500" height="300" fill="#f4f2ec"/>
      <g fill="#101114">
        <rect x="0" y="0" width="100" height="100"/><rect x="200" y="0" width="100" height="100"/><rect x="400" y="0" width="100" height="100"/>
        <rect x="100" y="100" width="100" height="100"/><rect x="300" y="100" width="100" height="100"/>
        <rect x="0" y="200" width="100" height="100"/><rect x="200" y="200" width="100" height="100"/><rect x="400" y="200" width="100" height="100"/>
      </g>
    </svg>`,
  },
  {
    id: 'laurel',
    name: 'Laurel Wreath',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><path id="cc-leaf" d="M256 68 C230 40 194 32 160 42 C180 72 220 82 256 68 Z"/></defs>
      <g id="cc-lbr" fill="#d9b85c">
        <path d="M256 444 A188 188 0 0 1 84 180" fill="none" stroke="#d9b85c" stroke-width="10" stroke-linecap="round"/>
        <use href="#cc-leaf" transform="rotate(-26 256 256)"/>
        <use href="#cc-leaf" transform="rotate(-54 256 256)"/>
        <use href="#cc-leaf" transform="rotate(-82 256 256)"/>
        <use href="#cc-leaf" transform="rotate(-110 256 256)"/>
        <use href="#cc-leaf" transform="rotate(-138 256 256)"/>
      </g>
      <use href="#cc-lbr" transform="translate(512 0) scale(-1 1)"/>
    </svg>`,
  },
  {
    id: 'shield',
    name: 'Shield Crest',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M256 32 L448 88 V264 C448 368 366 446 256 484 C146 446 64 368 64 264 V88 Z" fill="#101114"/>
      <path d="M256 68 L414 116 V262 C414 348 348 412 256 446 C164 412 98 348 98 262 V116 Z" fill="#f4f2ec"/>
    </svg>`,
  },
  {
    id: 'stripes',
    name: 'Twin Stripes',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <g fill="#f4f2ec">
        <rect x="122" y="0" width="10" height="512"/>
        <rect x="146" y="0" width="84" height="512"/>
        <rect x="282" y="0" width="84" height="512"/>
        <rect x="380" y="0" width="10" height="512"/>
      </g>
    </svg>`,
  },
  {
    id: 'swoosh',
    name: 'Arrow Swoosh',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M20 360 C150 344 280 296 380 210 L340 180 L500 98 L470 290 L424 254 C320 330 180 366 24 380 Z" fill="#ff4d00"/>
    </svg>`,
  },
  {
    id: 'flame',
    name: 'Flame Lick',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M256 32 C310 120 388 168 388 280 C388 388 332 472 256 480 C180 472 124 388 124 280 C124 208 160 170 188 128 C184 188 204 216 232 232 C220 168 232 96 256 32 Z" fill="#ff4d00"/>
      <path d="M256 168 C290 224 332 252 332 318 C332 386 300 428 256 436 C212 428 180 386 180 318 C180 280 198 258 214 234 C212 272 226 290 244 300 C236 256 242 212 256 168 Z" fill="#ffd23f"/>
    </svg>`,
  },
  {
    id: 'maltese',
    name: 'Maltese Cross',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><path id="cc-mx" d="M256 256 L168 36 L256 106 L344 36 Z"/></defs>
      <g fill="#f4f2ec">
        <use href="#cc-mx"/>
        <use href="#cc-mx" transform="rotate(90 256 256)"/>
        <use href="#cc-mx" transform="rotate(180 256 256)"/>
        <use href="#cc-mx" transform="rotate(270 256 256)"/>
      </g>
    </svg>`,
  },
  {
    id: 'target',
    name: 'Target Rings',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <circle cx="256" cy="256" r="232" fill="#101114"/>
      <circle cx="256" cy="256" r="178" fill="#f4f2ec"/>
      <circle cx="256" cy="256" r="124" fill="#101114"/>
      <circle cx="256" cy="256" r="70" fill="#f4f2ec"/>
      <circle cx="256" cy="256" r="28" fill="#ff4d00"/>
    </svg>`,
  },
  {
    id: 'wing',
    name: 'Wing Emblem',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <g id="cc-wg" fill="#f4f2ec">
        <path d="M238 196 C168 138 84 114 16 124 C52 170 130 206 238 228 Z"/>
        <path d="M238 240 C176 208 100 196 40 206 C76 248 150 268 238 270 Z"/>
        <path d="M238 282 C186 264 124 260 76 268 C108 300 168 312 238 308 Z"/>
      </g>
      <use href="#cc-wg" transform="translate(512 0) scale(-1 1)"/>
      <circle cx="256" cy="236" r="58" fill="#f4f2ec"/>
      <circle cx="256" cy="236" r="38" fill="#101114"/>
    </svg>`,
  },
  {
    id: 'hazard',
    name: 'Hazard Stripes',
    svg: `<svg ${NS} viewBox="0 0 512 192" width="512" height="192">
      <rect width="512" height="192" fill="#ffd23f"/>
      <g fill="#101114">
        <polygon points="-192,192 0,0 72,0 -120,192"/>
        <polygon points="-48,192 144,0 216,0 24,192"/>
        <polygon points="96,192 288,0 360,0 168,192"/>
        <polygon points="240,192 432,0 504,0 312,192"/>
        <polygon points="384,192 576,0 648,0 456,192"/>
      </g>
    </svg>`,
  },
  {
    id: 'hexagon',
    name: 'Hex Badge',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <polygon fill="#101114" points="256,28 453,142 453,370 256,484 59,370 59,142"/>
      <polygon fill="#f4f2ec" points="256,76 412,166 412,346 256,436 100,346 100,166"/>
    </svg>`,
  },
];

// Rasterize a library item to a PNG dataURL (project serialization and the
// TGA export pipeline both expect raster layer sources, not SVG).
export async function libraryItemToLayerSource(item) {
  const url = URL.createObjectURL(new Blob([item.svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Could not load graphic'));
      im.src = url;
    });
    const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
    const scale = 768 / Math.max(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
