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
  {
    id: 'sunburst',
    name: 'Sunburst',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><polygon id="cc-ray" points="256,256 238,28 274,28"/></defs>
      <g fill="#ffd23f">
        <use href="#cc-ray"/>
        <use href="#cc-ray" transform="rotate(30 256 256)"/>
        <use href="#cc-ray" transform="rotate(60 256 256)"/>
        <use href="#cc-ray" transform="rotate(90 256 256)"/>
        <use href="#cc-ray" transform="rotate(120 256 256)"/>
        <use href="#cc-ray" transform="rotate(150 256 256)"/>
        <use href="#cc-ray" transform="rotate(180 256 256)"/>
        <use href="#cc-ray" transform="rotate(210 256 256)"/>
        <use href="#cc-ray" transform="rotate(240 256 256)"/>
        <use href="#cc-ray" transform="rotate(270 256 256)"/>
        <use href="#cc-ray" transform="rotate(300 256 256)"/>
        <use href="#cc-ray" transform="rotate(330 256 256)"/>
      </g>
      <circle cx="256" cy="256" r="92" fill="#ff4d00"/>
    </svg>`,
  },
  {
    id: 'crossed-flags',
    name: 'Crossed Flags',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><g id="cc-fl">
        <rect x="248" y="40" width="12" height="436" rx="6" fill="#101114"/>
        <rect x="260" y="52" width="186" height="124" fill="#f4f2ec"/>
        <g fill="#101114">
          <rect x="260" y="52" width="62" height="62"/>
          <rect x="384" y="52" width="62" height="62"/>
          <rect x="322" y="114" width="62" height="62"/>
        </g>
      </g></defs>
      <use href="#cc-fl" transform="rotate(24 256 470)"/>
      <use href="#cc-fl" transform="translate(512 0) scale(-1 1) rotate(24 256 470)"/>
    </svg>`,
  },
  {
    id: 'speed-lines',
    name: 'Speed Lines',
    svg: `<svg ${NS} viewBox="0 0 512 256" width="512" height="256">
      <g fill="#f4f2ec">
        <rect x="30" y="30" width="40" height="32" rx="16"/>
        <rect x="90" y="30" width="390" height="32" rx="16"/>
        <rect x="0" y="112" width="430" height="32" rx="16"/>
        <rect x="60" y="194" width="40" height="32" rx="16"/>
        <rect x="120" y="194" width="330" height="32" rx="16"/>
      </g>
    </svg>`,
  },
  {
    id: 'arrow-bold',
    name: 'Bold Arrow',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <polygon fill="#ff4d00" points="36,176 300,176 300,84 476,256 300,428 300,336 36,336"/>
    </svg>`,
  },
  {
    id: 'double-arrow',
    name: 'Twin Arrows',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <g fill="#f4f2ec">
        <polygon points="80,96 288,256 80,416"/>
        <polygon points="260,96 468,256 260,416"/>
      </g>
    </svg>`,
  },
  {
    id: 'piston',
    name: 'Piston',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <g fill="#f4f2ec">
        <rect x="146" y="52" width="220" height="104" rx="16"/>
        <rect x="176" y="156" width="160" height="44"/>
        <polygon points="232,200 280,200 306,376 206,376"/>
        <circle cx="256" cy="396" r="60"/>
      </g>
      <g fill="#101114">
        <rect x="146" y="92" width="220" height="12"/>
        <rect x="146" y="118" width="220" height="12"/>
        <circle cx="256" cy="396" r="26"/>
      </g>
    </svg>`,
  },
  {
    id: 'crossed-wrenches',
    name: 'Crossed Wrenches',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><g id="cc-wr" stroke="#f4f2ec" fill="none" stroke-linecap="round">
        <path d="M256 118 V394" stroke-width="44"/>
        <path d="M234 74 A52 52 0 1 0 278 74" stroke-width="34"/>
        <path d="M234 438 A52 52 0 1 1 278 438" stroke-width="34"/>
      </g></defs>
      <use href="#cc-wr" transform="rotate(45 256 256)"/>
      <use href="#cc-wr" transform="rotate(-45 256 256)"/>
    </svg>`,
  },
  {
    id: 'crown',
    name: 'Crown',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <polygon fill="#ffd23f" points="72,396 60,168 172,272 256,116 340,272 452,168 440,396"/>
      <g fill="#ffd23f">
        <circle cx="60" cy="160" r="24"/>
        <circle cx="256" cy="108" r="24"/>
        <circle cx="452" cy="160" r="24"/>
      </g>
      <rect x="72" y="344" width="368" height="12" fill="#101114"/>
    </svg>`,
  },
  {
    id: 'skull-racing',
    name: 'Racing Skull',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M256 40 C150 40 88 116 88 210 C88 280 120 320 150 344 L150 420 Q150 448 178 448 H334 Q362 448 362 420 L362 344 C392 320 424 280 424 210 C424 116 362 40 256 40 Z" fill="#f4f2ec"/>
      <g fill="#101114">
        <ellipse cx="190" cy="232" rx="44" ry="36"/>
        <ellipse cx="322" cy="232" rx="44" ry="36"/>
        <path d="M256 278 L232 330 H280 Z"/>
        <rect x="216" y="384" width="10" height="60"/>
        <rect x="251" y="384" width="10" height="60"/>
        <rect x="286" y="384" width="10" height="60"/>
      </g>
    </svg>`,
  },
  {
    id: 'eight-ball',
    name: 'Eight Ball',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <circle cx="256" cy="256" r="232" fill="#101114"/>
      <circle cx="256" cy="236" r="110" fill="#f4f2ec"/>
      <g fill="none" stroke="#101114" stroke-width="22">
        <circle cx="256" cy="192" r="26"/>
        <circle cx="256" cy="266" r="34"/>
      </g>
    </svg>`,
  },
  {
    id: 'dice',
    name: 'Lucky Dice',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <rect x="76" y="76" width="360" height="360" rx="56" fill="#f4f2ec"/>
      <g fill="#101114">
        <circle cx="166" cy="166" r="34"/>
        <circle cx="346" cy="166" r="34"/>
        <circle cx="256" cy="256" r="34"/>
        <circle cx="166" cy="346" r="34"/>
        <circle cx="346" cy="346" r="34"/>
      </g>
    </svg>`,
  },
  {
    id: 'horseshoe',
    name: 'Horseshoe',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M144 84 V296 A112 112 0 0 0 368 296 V84" fill="none" stroke="#d9b85c" stroke-width="60"/>
      <g fill="#101114">
        <circle cx="144" cy="130" r="13"/>
        <circle cx="144" cy="230" r="13"/>
        <circle cx="368" cy="130" r="13"/>
        <circle cx="368" cy="230" r="13"/>
        <circle cx="177" cy="375" r="13"/>
        <circle cx="335" cy="375" r="13"/>
      </g>
    </svg>`,
  },
  {
    id: 'shamrock',
    name: 'Shamrock',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><path id="cc-shl" d="M256 246 C226 186 156 186 156 136 C156 100 190 84 216 104 C234 118 248 142 256 166 C264 142 278 118 296 104 C322 84 356 100 356 136 C356 186 286 186 256 246 Z"/></defs>
      <g fill="#f4f2ec">
        <use href="#cc-shl" transform="rotate(45 256 256)"/>
        <use href="#cc-shl" transform="rotate(135 256 256)"/>
        <use href="#cc-shl" transform="rotate(225 256 256)"/>
        <use href="#cc-shl" transform="rotate(315 256 256)"/>
      </g>
      <path d="M262 296 C288 360 288 420 258 468" fill="none" stroke="#f4f2ec" stroke-width="24" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'ace-spade',
    name: 'Ace of Spades',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M256 44 C190 140 108 190 108 268 C108 330 160 360 210 336 C196 380 176 412 150 440 H362 C336 412 316 380 302 336 C352 360 404 330 404 268 C404 190 322 140 256 44 Z" fill="#f4f2ec"/>
    </svg>`,
  },
  {
    id: 'bolt-roundel',
    name: 'Bolt Roundel',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <circle cx="256" cy="256" r="232" fill="#101114"/>
      <circle cx="256" cy="256" r="200" fill="none" stroke="#f4f2ec" stroke-width="12"/>
      <path d="M292 128 L176 286 H250 L216 396 L352 232 H276 L318 128 Z" fill="#ffd23f"/>
    </svg>`,
  },
  {
    id: 'ribbon-banner',
    name: 'Ribbon Banner',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <g fill="#101114">
        <polygon points="16,226 96,226 96,346 16,346 58,286"/>
        <polygon points="496,226 416,226 416,346 496,346 454,286"/>
      </g>
      <rect x="86" y="196" width="340" height="120" rx="10" fill="#f4f2ec"/>
    </svg>`,
  },
  {
    id: 'scallops',
    name: 'Scallop Trim',
    svg: `<svg ${NS} viewBox="0 0 512 160" width="512" height="160">
      <rect width="512" height="12" fill="#ff4d00"/>
      <g fill="#f4f2ec">
        <rect y="12" width="512" height="30"/>
        <circle cx="64" cy="42" r="64"/>
        <circle cx="192" cy="42" r="64"/>
        <circle cx="320" cy="42" r="64"/>
        <circle cx="448" cy="42" r="64"/>
      </g>
    </svg>`,
  },
  {
    id: 'tribal-flame',
    name: 'Tribal Flame',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M256 496 C160 470 100 400 100 300 C100 220 150 180 176 120 C186 190 172 240 200 272 C206 210 190 140 256 16 C240 130 288 200 292 268 C330 226 322 150 356 96 C368 180 350 250 322 300 C382 274 402 220 412 168 C440 280 400 420 300 470 C286 478 270 490 256 496 Z" fill="#ff4d00"/>
    </svg>`,
  },
  {
    id: 'pinstripe-scroll',
    name: 'Pinstripe Scroll',
    svg: `<svg ${NS} viewBox="0 0 512 256" width="512" height="256">
      <defs><path id="cc-ps" d="M256 128 C190 60 100 52 66 104 C42 142 68 186 108 178 C140 172 148 136 122 126 C104 120 90 132 94 148 M256 168 C200 210 130 222 70 214"/></defs>
      <g fill="none" stroke="#f4f2ec" stroke-width="10" stroke-linecap="round">
        <use href="#cc-ps"/>
        <use href="#cc-ps" transform="translate(512 0) scale(-1 1)"/>
      </g>
      <polygon fill="#f4f2ec" points="256,84 268,128 256,172 244,128"/>
    </svg>`,
  },
  {
    id: 'halftone-disc',
    name: 'Halftone Disc',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <g fill="#f4f2ec">
        <circle cx="256" cy="256" r="118"/>
        <circle cx="416" cy="256" r="22"/><circle cx="369" cy="369" r="22"/>
        <circle cx="256" cy="416" r="22"/><circle cx="143" cy="369" r="22"/>
        <circle cx="96" cy="256" r="22"/><circle cx="143" cy="143" r="22"/>
        <circle cx="256" cy="96" r="22"/><circle cx="369" cy="143" r="22"/>
        <circle cx="450" cy="336" r="11"/><circle cx="336" cy="450" r="11"/>
        <circle cx="176" cy="450" r="11"/><circle cx="62" cy="336" r="11"/>
        <circle cx="62" cy="176" r="11"/><circle cx="176" cy="62" r="11"/>
        <circle cx="336" cy="62" r="11"/><circle cx="450" cy="176" r="11"/>
      </g>
    </svg>`,
  },
  {
    id: 'gradient-swoosh',
    name: 'Layered Swoosh',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <path d="M0 320 C160 300 320 240 512 120 L512 190 C330 300 170 350 0 368 Z" fill="#ff4d00"/>
      <path d="M0 380 C170 364 330 316 512 210 L512 258 C340 356 176 398 0 412 Z" fill="#ffd23f"/>
    </svg>`,
  },
  {
    id: 'hex-mesh-badge',
    name: 'Hex Mesh Badge',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <defs><polygon id="cc-hm" points="256,212 294,234 294,278 256,300 218,278 218,234"/></defs>
      <polygon fill="#101114" points="256,28 453,142 453,370 256,484 59,370 59,142"/>
      <polygon fill="#f4f2ec" points="256,76 412,166 412,346 256,436 100,346 100,166"/>
      <g fill="none" stroke="#101114" stroke-width="10">
        <use href="#cc-hm"/>
        <use href="#cc-hm" x="-76"/>
        <use href="#cc-hm" x="76"/>
        <use href="#cc-hm" x="-38" y="-66"/>
        <use href="#cc-hm" x="38" y="-66"/>
        <use href="#cc-hm" x="-38" y="66"/>
        <use href="#cc-hm" x="38" y="66"/>
      </g>
    </svg>`,
  },
  {
    id: 'number-circle',
    name: 'Number Circle',
    svg: `<svg ${NS} viewBox="0 0 512 512" width="512" height="512">
      <circle cx="256" cy="256" r="214" fill="none" stroke="#f4f2ec" stroke-width="52"/>
      <circle cx="256" cy="256" r="242" fill="none" stroke="#101114" stroke-width="8"/>
      <circle cx="256" cy="256" r="186" fill="none" stroke="#101114" stroke-width="8"/>
    </svg>`,
  },
  {
    id: 'rising-sun',
    name: 'Rising Sun',
    svg: `<svg ${NS} viewBox="0 0 512 288" width="512" height="288">
      <defs><polygon id="cc-rs" points="256,288 228,40 284,40"/></defs>
      <g fill="#ff4d00">
        <use href="#cc-rs" transform="rotate(-78 256 288)"/>
        <use href="#cc-rs" transform="rotate(-52 256 288)"/>
        <use href="#cc-rs" transform="rotate(-26 256 288)"/>
        <use href="#cc-rs"/>
        <use href="#cc-rs" transform="rotate(26 256 288)"/>
        <use href="#cc-rs" transform="rotate(52 256 288)"/>
        <use href="#cc-rs" transform="rotate(78 256 288)"/>
      </g>
      <path d="M136 288 A120 120 0 0 1 376 288 Z" fill="#ffd23f"/>
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
