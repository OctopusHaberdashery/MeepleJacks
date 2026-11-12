// MeepleJacks — pixel art. Every sprite is drawn in code, one pixel at a time, into small
// buffers: limited palettes, top-left light, ordered dithering and a dark outline.
'use strict';

const ART = { tree: [], stump: [], pile: [], log: [], carry: [], end: [], meeple: {}, rock: [], url: {}, spr: {} };

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function shade(hex, f) {
  const [r, g, b] = hexRgb(hex);
  if (f >= 0) return rgbHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
  const k = 1 + f;
  return rgbHex(r * k + 12 * -f, g * k + 6 * -f, b * k + 22 * -f);   // shadows lean cool
}
// '#rrggbb' -> 32-bit pixel as ImageData stores it (little-endian ABGR)
const _cc = new Map();
function C(hex, a = 255) {
  let v = _cc.get(hex);
  if (v === undefined) { const [r, g, b] = hexRgb(hex); v = ((b << 16) | (g << 8) | r) >>> 0; _cc.set(hex, v); }
  return ((a << 24) | v) >>> 0;
}
const PAL = (...h) => h.map(x => C(x));

// 4x4 ordered dither
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (B4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
function ptone(pal, L, x, y, dith = 1) {
  const n = pal.length, i = Math.floor(L * n + (bayer(x, y) - 0.5) * dith);
  return pal[i < 0 ? 0 : i >= n ? n - 1 : i];
}

class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
  set(x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; }
  get(x, y) { x |= 0; y |= 0; return (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.d[y * this.w + x] : 0; }
  solid(x, y) { return (this.get(x, y) >>> 24) >= 250; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  ell(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy <= 1) this.set(x, y, c);
    }
  }
  line(x0, y0, x1, y1, c, th = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); this.rect(x, y, th, 1, c); }
  }
  // dark outline hugging every solid pixel
  outline(c) {
    const o = new Uint32Array(this.d);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.solid(x, y)) continue;
      if (this.solid(x - 1, y) || this.solid(x + 1, y) || this.solid(x, y - 1) || this.solid(x, y + 1)) o[y * this.w + x] = c;
    }
    this.d = o; return this;
  }
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const v = src.d[y * src.w + x]; if (v >>> 24) this.set(dx + x, dy + y, v); }
    return this;
  }
  rows(rows, map, dx = 0, dy = 0) {
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = map[row[x]]; if (c !== undefined) this.set(dx + x, dy + y, c); } });
    return this;
  }
  toCanvas() {
    const c = newCanvas(this.w, this.h);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.d.buffer.slice(0)), this.w, this.h), 0, 0);
    return c;
  }
  // crop to the drawn pixels and return a sprite anchored at (ax, ay)
  sprite(ax, ay) {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.d[y * this.w + x] >>> 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    const q = new Pix(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) q.d[(y - y0) * q.w + (x - x0)] = this.d[y * this.w + x];
    return { c: q.toCanvas(), w: q.w, h: q.h, ax: ax - x0, ay: ay - y0 };
  }
}
function drawSpr(ctx, s, x, y) { ctx.drawImage(s.c, Math.round(x) - s.ax, Math.round(y) - s.ay); }

// ---------------------------------------------------------------- foliage and bark
const LEAF = [
  PAL('#143a2c', '#1f5a3a', '#2f7a45', '#4a9a52', '#7cc066'),   // pine
  PAL('#3c6b2a', '#5c9434', '#86b83e', '#b4d858', '#e0f090'),   // birch
  PAL('#1c4424', '#2c642a', '#438632', '#64a63e', '#96ca5c'),   // oak
  PAL('#7a2414', '#b03a18', '#d8601c', '#f08c28', '#fcc450'),   // maple
  PAL('#8c3a62', '#c05a86', '#e486a8', '#f6b4c8', '#fde4ec'),   // cherry
  PAL('#102c1e', '#1a462c', '#28623a', '#3c8048', '#60a258'),   // redwood
  PAL('#14183a', '#20285a', '#2c467c', '#387292', '#5cb0a8'),   // ebony
];
const BARK = [
  PAL('#3e2616', '#6a4428', '#946238'),
  PAL('#9a9a90', '#d8d8cc', '#f6f6ee'),
  PAL('#33200f', '#5a3c22', '#80582f'),
  PAL('#3f2a22', '#6a4a3a', '#927056'),
  PAL('#2a1418', '#4a2a2a', '#70443c'),
  PAL('#4a1e14', '#8a3a22', '#bc5a34'),
  PAL('#17121c', '#2a2233', '#4a3e58'),
];
const TREE_OUT = ['#0c1c18', '#22381c', '#0e2214', '#3c120c', '#4a1c36', '#0a1810', '#0a0c20'];
const SHADOW = C('#0a1a10', 70);

function shadow(p, cx, by, rx) { p.ell(cx + 0.5, by + 0.5, rx, Math.max(1.5, rx * 0.32), SHADOW); }

// A leafy mass built from overlapping lit spheres, painted back to front.
function canopy(p, blobs, pal, seed) {
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
  for (const b of blobs) { y0 = Math.min(y0, b.y - b.ry); y1 = Math.max(y1, b.y + b.ry); x0 = Math.min(x0, b.x - b.rx); x1 = Math.max(x1, b.x + b.rx); }
  blobs.sort((a, b) => a.y - b.y);
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    let L = -9;
    for (const b of blobs) {
      const dx = (x + 0.5 - b.x) / b.rx, dy = (y + 0.5 - b.y) / b.ry, d2 = dx * dx + dy * dy;
      if (d2 < 1) L = 0.46 - dx * 0.26 - dy * 0.34 + Math.sqrt(1 - d2) * 0.12 + (b.l || 0);
    }
    if (L === -9) continue;
    L += (0.5 - (y - y0) / (y1 - y0)) * 0.34 + (hash2(x, y, seed) - 0.5) * 0.14;
    p.set(x, y, ptone(pal, L, x, y));
  }
}
function crown(r, cx, cy, rx, ry, n, br) {
  const bl = [{ x: cx, y: cy, rx: rx * 0.78, ry: ry * 0.78 }];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + r() * 0.7, k = 0.5 + r() * 0.28, rr = br * (0.8 + r() * 0.45);
    bl.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k, rx: rr, ry: rr * 0.9 });
  }
  for (let i = 0; i < n / 2; i++) bl.push({ x: cx + (r() - 0.5) * rx, y: cy + (r() - 0.5) * ry * 0.8, rx: br * 0.7, ry: br * 0.6, l: 0.06 });
  return bl;
}
// stacked, drooping boughs with a toothed fringe
function conifer(p, cx, top, bot, n, hw, pal, seed, r) {
  const span = bot - top, th = span / (n * 0.62 + 0.38);
  for (let k = 0; k < n; k++) {
    const b = Math.round(bot - k * th * 0.62), w = hw * (1 - k / n * 0.74), apex = b - th, ph = (r() * 4) | 0;
    for (let y = Math.floor(apex); y <= b; y++) {
      const v = clamp((y - apex) / th, 0, 1), half = 0.7 + w * Math.pow(v, 0.85);
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
        const u = (x - cx) / half; if (Math.abs(u) > 1) continue;
        const tooth = ((x + ph + 64) % 4) < 2 ? 0 : (w > 6 ? 2 : 1);
        if (y > b - tooth) continue;
        const L = 0.28 + 0.44 * v - 0.3 * u + (hash2(x, y, seed) - 0.5) * 0.16;
        p.set(x, y, ptone(pal, L, x, y));
      }
    }
  }
}
function trunk(p, cx, y0, y1, w, pal, seed, o = {}) {
  for (let y = Math.round(y0); y <= y1; y++) {
    const flare = (y >= y1 - 1 && w >= 3) ? 1 : 0;
    const off = o.twist ? Math.round(Math.sin((y1 - y) * o.twist) * o.amp * Math.min(1, (y1 - y) / 8)) : 0;
    const xa = cx - (w >> 1) - flare + off, xb = cx + ((w - 1) >> 1) + flare + off;
    for (let x = xa; x <= xb; x++) {
      const u = xb > xa ? (x - xa) / (xb - xa) : 0.5;
      let c = w === 1 ? pal[1] : u < 0.34 ? pal[2] : u > 0.7 ? pal[0] : pal[1];
      if (hash2(x, (y / 3) | 0, seed + 5) < (o.furrow || 0.18) && c !== pal[0]) c = c === pal[2] ? pal[1] : pal[0];
      p.set(x, y, c);
    }
    if (o.marks && hash2(3, y, seed + 9) < 0.34) { const mx = xa + ((hash2(5, y, seed) * (xb - xa + 1)) | 0); p.set(mx, y, o.marks); if (w > 2) p.set(mx + 1, y, o.marks); }
  }
}

const TREE_DRAW = [
  // 0 pine
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 8 * s + 1);
    trunk(p, cx, by - Math.round(9 * s) - 1, by, s > 0.8 ? 3 : s > 0.5 ? 2 : 1, BARK[0], seed);
    conifer(p, cx, by - Math.round(39 * s), by - Math.round(6 * s) - 1, Math.max(2, Math.round(4 * s)), 10.5 * s + 1, LEAF[0], seed, r);
  },
  // 1 birch
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 7 * s + 1);
    trunk(p, cx, by - Math.round(27 * s), by, s > 0.8 ? 3 : s > 0.5 ? 2 : 1, BARK[1], seed, { marks: C('#3a3a38'), furrow: 0.06 });
    canopy(p, crown(r, cx + 0.5, by - 30 * s - 1, 8.5 * s + 1, 11.5 * s + 1, Math.round(4 + 4 * s), 4.2 * s + 1), LEAF[1], seed);
  },
  // 2 oak
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 12 * s + 1);
    const th = Math.round(15 * s);
    trunk(p, cx, by - th, by, s > 0.8 ? 5 : s > 0.5 ? 3 : 2, BARK[2], seed);
    canopy(p, crown(r, cx + 0.5, by - th - 9 * s, 15 * s + 1, 11.5 * s + 1, Math.round(5 + 4 * s), 6.2 * s + 1), LEAF[2], seed);
  },
  // 3 maple
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 11 * s + 1);
    const th = Math.round(16 * s), cy = by - th - 11 * s;
    trunk(p, cx, by - th, by, s > 0.8 ? 4 : s > 0.5 ? 3 : 2, BARK[3], seed);
    const bl = crown(r, cx + 0.5, cy, 13.5 * s + 1, 13 * s + 1, Math.round(5 + 4 * s), 5.6 * s + 1);
    bl.push({ x: cx + 0.5, y: cy - 11 * s, rx: 5 * s + 1, ry: 5 * s + 1 });
    canopy(p, bl, LEAF[3], seed);
  },
  // 4 cherry
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 12 * s + 1);
    const th = Math.round(13 * s), cy = by - th - 8 * s;
    trunk(p, cx, by - th, by, s > 0.5 ? 3 : 2, BARK[4], seed, { twist: 0.5, amp: s > 0.8 ? 1 : 0 });
    if (s > 0.5) { p.line(cx, by - th, cx - Math.round(8 * s), by - th - Math.round(6 * s), BARK[4][1], 2); p.line(cx, by - th, cx + Math.round(8 * s), by - th - Math.round(5 * s), BARK[4][0], 2); }
    canopy(p, crown(r, cx + 0.5, cy, 16.5 * s + 1, 8.5 * s + 1, Math.round(5 + 5 * s), 5.4 * s + 1), LEAF[4], seed);
    const leafSet = new Set(LEAF[4]);
    for (let i = 0; i < 46 * s; i++) {      // blossom flecks
      const x = (cx + (r() - 0.5) * 38 * s) | 0, y = (cy + (r() - 0.5) * 24 * s) | 0;
      if (leafSet.has(p.get(x, y))) p.set(x, y, r() < 0.6 ? C('#ffffff') : C('#ffd0e0'));
    }
  },
  // 5 redwood
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 12 * s + 1);
    const w = s > 0.8 ? 7 : s > 0.5 ? 5 : 3;
    trunk(p, cx, by - Math.round(62 * s), by, w, BARK[5], seed, { furrow: 0.34 });
    if (s > 0.5) { p.rect(cx - (w >> 1) - 2, by, w + 4, 1, BARK[5][0]); p.set(cx - (w >> 1) - 2, by - 1, BARK[5][1]); p.set(cx + (w >> 1) + 2, by - 1, BARK[5][0]); }
    if (s > 0.8) for (const [dy, sd] of [[26, -1], [31, 1]]) {      // low branch stubs
      const y = by - dy, x = cx + sd * (w >> 1);
      p.line(x, y, x + sd * 4, y - 2, BARK[5][0], 1);
      canopy(p, [{ x: x + sd * 6, y: y - 3, rx: 4, ry: 3 }], LEAF[5], seed + dy);
    }
    conifer(p, cx, by - Math.round(88 * s), by - Math.round(35 * s), Math.max(3, Math.round(7 * s)), 13 * s + 1, LEAF[5], seed, r);
  },
  // 6 ebony
  (p, cx, by, s, r, seed) => {
    shadow(p, cx, by, 13 * s + 1);
    const th = Math.round(24 * s), cy = by - th - 6 * s;
    trunk(p, cx, by - th, by, s > 0.8 ? 5 : s > 0.5 ? 3 : 2, BARK[6], seed, { twist: 0.42, amp: s > 0.5 ? 1.6 : 0 });
    if (s > 0.5) { p.line(cx, by - th + 2, cx - Math.round(10 * s), by - th - Math.round(5 * s), BARK[6][1], 2); p.line(cx + 1, by - th + 2, cx + Math.round(10 * s), by - th - Math.round(6 * s), BARK[6][0], 2); }
    const bl = crown(r, cx + 0.5, cy, 18 * s + 1, 9 * s + 1, Math.round(5 + 5 * s), 6 * s + 1)
      .concat(crown(r, cx + 0.5, cy - 10 * s, 12.5 * s + 1, 8.5 * s + 1, Math.round(4 + 3 * s), 5.5 * s + 1));
    canopy(p, bl, LEAF[6], seed);
    const leafSet = new Set(LEAF[6]);
    for (let i = 0; i < 9 * s; i++) {       // glowing seed pods
      const x = (cx + (r() - 0.5) * 34 * s) | 0, y = (cy - 5 * s + (r() - 0.5) * 26 * s) | 0;
      if (leafSet.has(p.get(x, y)) && leafSet.has(p.get(x + 1, y))) { p.set(x, y, C('#b8fff0')); p.set(x + 1, y, C('#58e0d0')); }
    }
  },
];
const STAGE_SCALE = [0.42, 0.68, 1];
function buildTree(t, v, stage) {
  const p = new Pix(76, 108), cx = 38, by = 104, seed = 1000 + t * 97 + v * 13 + stage * 7;
  TREE_DRAW[t](p, cx, by, STAGE_SCALE[stage], mulberry(seed), seed);
  p.outline(C(TREE_OUT[t]));
  return p.sprite(cx, by);
}
const STUMP_W = [5, 5, 7, 7, 7, 11, 9];
function buildStump(t) {
  const p = new Pix(24, 16), cx = 12, by = 12, w = STUMP_W[t], x0 = cx - (w >> 1), bk = BARK[t], wd = TREES[t].wood;
  shadow(p, cx, by, w * 0.8);
  for (let y = by - 3; y <= by; y++) for (let x = x0 - (y === by ? 1 : 0); x < x0 + w + (y === by ? 1 : 0); x++) {
    const u = (x - x0) / (w - 1); p.set(x, y, u < 0.3 ? bk[2] : u > 0.7 ? bk[0] : bk[1]);
  }
  p.rect(x0 + 1, by - 6, w - 2, 1, C(shade(wd, 0.15)));
  p.rect(x0, by - 5, w, 2, C(wd));
  p.rect(x0 + 1, by - 3, w - 2, 1, C(shade(wd, -0.18)));
  p.rect(cx - 1, by - 5, 2, 1, C(shade(wd, -0.3)));
  if (w > 6) { p.set(x0 + 1, by - 4, C(shade(wd, -0.2))); p.set(x0 + w - 2, by - 5, C(shade(wd, -0.2))); }
  p.outline(C(TREE_OUT[t]));
  return p.sprite(cx, by);
}
// one log seen end-on, 6x6
function logEnd(p, x, y, t) {
  const bk = BARK[t], wd = TREES[t].wood, W1 = C(wd), W2 = C(shade(wd, 0.22)), W0 = C(shade(wd, -0.28));
  p.rows(['.abbc.', 'aLLwwc', 'bLrrwc', 'bwrrwc', 'bwwwwc', '.bccc.'], { a: bk[2], b: bk[1], c: bk[0], L: W2, w: W1, r: W0 }, x, y);
}
const PILE_LAYOUT = [null, [[0, 0]], [[-3, 0], [3, 0]], [[-3, 0], [3, 0], [0, -5]], [[-6, 0], [0, 0], [6, 0], [-3, -5]],
  [[-6, 0], [0, 0], [6, 0], [-3, -5], [3, -5]], [[-6, 0], [0, 0], [6, 0], [-3, -5], [3, -5], [0, -10]]];
function buildPile(t, n) {
  const p = new Pix(28, 24), cx = 14, by = 20;
  shadow(p, cx, by, 4 + n * 1.2);
  for (const [dx, dy] of PILE_LAYOUT[n]) logEnd(p, cx - 3 + dx, by - 5 + dy, t);
  p.outline(C('#1c120c'));
  return p.sprite(cx, by);
}
// a log lying on its side (icon and shoulder-carry)
function buildLog(t, len, th) {
  const p = new Pix(len + 6, th + 4), bk = BARK[t], wd = TREES[t].wood, x0 = 1, y0 = 2;
  for (let y = 0; y < th; y++) for (let x = 0; x < len; x++) {
    const v = y / (th - 1); let c = v < 0.25 ? bk[2] : v > 0.7 ? bk[0] : bk[1];
    if (hash2(x >> 1, y, t + 3) < 0.16) c = bk[0];
    if (t === 1 && hash2(x, y, 77) < 0.12) c = C('#3a3a38');
    p.set(x0 + x, y0 + y, c);
  }
  p.ell(x0 + len + 0.2, y0 + th / 2, Math.max(1.2, th * 0.36), th / 2, C(wd));
  p.set(x0 + len, y0 + (th >> 1), C(shade(wd, -0.3)));
  if (th > 4) { p.set(x0 + len, y0 + 1, C(shade(wd, 0.25))); p.set(x0 + len - 1, y0 + (th >> 1) - 1, C(shade(wd, 0.2))); }
  p.outline(C('#1c120c'));
  return p.sprite((len + 6) >> 1, th + 3);
}
function buildRock(v) {
  const p = new Pix(32, 26), cx = 16, by = 22, r = mulberry(500 + v * 31);
  const pal = PAL('#4a4c54', '#6a6e76', '#8c9098', '#aeb2b8', '#d0d2d4');
  shadow(p, cx, by, 9 + v);
  const bl = [{ x: cx, y: by - 5 - v, rx: 8 + v, ry: 6 + v }, { x: cx - 5, y: by - 3, rx: 5, ry: 4 }, { x: cx + 5 + v, y: by - 3, rx: 4.5, ry: 3.5 }];
  canopy(p, bl, pal, 300 + v);
  for (let y = by; y < 26; y++) for (let x = 0; x < 32; x++) if (p.solid(x, y)) p.set(x, y, SHADOW);   // flat base
  for (let i = 0; i < 7; i++) { const x = (cx + (r() - 0.5) * 16) | 0, y = (by - 9 - v + r() * 4) | 0; if (p.solid(x, y)) { p.set(x, y, C('#6a9a48')); if (p.solid(x + 1, y)) p.set(x + 1, y, C('#4a7a38')); } }
  p.outline(C('#22222c'));
  return p.sprite(cx, by);
}

// ---------------------------------------------------------------- Meeples
const MEEPLE_ROWS = [
  '.....####.....',
  '....######....',
  '....######....',
  '....######....',
  '.....####.....',
  '...########...',
  '.############.',
  '##############',
  '##############',
  '.##.######.##.',
  '....######....',
  '...########...',
  '..##########..',
  '..####..####..',
  '.#####..#####.',
  '.####....####.',
];
// Hats: pixel rows placed over the head (dy rows above its top), each with its own little palette.
// The first few are work hats; the rest hide in trees (see HATS in data.js).
const HAT_ART = {
  hard:     { dy: -2, rows: ['....hhhh....', '...hHhhhh...', '..hHhhhhhh..', '.dddddddddd.'], pal: { h: '#f6c83c', H: '#fff0a0', d: '#c8941c' } },
  beanie:   { dy: -2, rows: ['.....ww.....', '....hhhh....', '...hHhhhh...', '...dddddd...'], pal: { h: '#c8382a', H: '#e8705a', d: '#8a241c', w: '#f4f0e4' } },
  beanieB:  { dy: -2, rows: ['.....ww.....', '....hhhh....', '...hHhhhh...', '...dddddd...'], pal: { h: '#2f6a8a', H: '#5a9aba', d: '#1c4660', w: '#f4f0e4' } },
  straw:    { dy: -2, rows: ['....hHhh....', '...hHhhhh...', '...bbbbbb...', 'dhhHhhhhhhhd'], pal: { h: '#e8c860', H: '#fff0a0', d: '#b89a40', b: '#8a4a2a' } },
  forester: { dy: -3, rows: ['......g..r..', '.....gGg.r..', '....gGggr...', '...gGggggg..', '..dddddddd..'], pal: { g: '#3f8a4a', G: '#72c070', d: '#245a30', r: '#e8503a' } },
  flatcap:  { dy: -1, rows: ['....cccc....', '...cCccccc..', '..dddddddccd'], pal: { c: '#8a7a68', C: '#b0a08c', d: '#5a4e42' } },
  bandana:  { dy: 0,  rows: ['....rrrr....', '...rwrrwrr..', '.........rr.'], pal: { r: '#c8382a', w: '#ffffff' } },
  carpcap:  { dy: -1, rows: ['....yyyy....', '...yYyyyy...', '...dyyyyyoo.'], pal: { y: '#4f7fb8', Y: '#8ab4e0', d: '#2f5a8a', o: '#2f5a8a' } },
  carter:   { dy: -1, rows: ['....bBbb....', '...bBbbbb...', '.dbbBbbbbbd.'], pal: { b: '#7a4a2a', B: '#a8703a', d: '#4a2c16' } },
  foreman:  { dy: -2, rows: ['....hhhh....', '...hHhhhh...', '..hHhhhhhh..', '.dddddddddd.'], pal: { h: '#f0f0ea', H: '#ffffff', d: '#b0b0aa' } },
  // --- found in Pine
  pinecone: { dy: -3, rows: ['.....bb.....', '....bBbb....', '...bBbBbb...', '...BbBbBb...', '...bbbbbb...'], pal: { b: '#7a4a26', B: '#b07a42' } },
  feather:  { dy: -3, rows: ['.......r....', '......rR....', '....ggggr...', '...gGgggg...', '..ggggggggg.'], pal: { g: '#3f8a4a', G: '#72c070', r: '#d8402e', R: '#f08a70' } },
  nest:     { dy: -2, rows: ['....ee.e....', '..t.eeeee.t.', '..tTttTttt..', '...tTttTt...'], pal: { t: '#8a6a3a', T: '#c09a52', e: '#b8e0f0' } },
  // --- Birch
  daisies:  { dy: -1, rows: ['...w..w..w..', '..wywwywwyw.', '..gwggwggwg.'], pal: { w: '#ffffff', y: '#f6c83c', g: '#5aa348' } },
  party:    { dy: -5, rows: ['.....ww.....', '.....pp.....', '....pyyp....', '....yppy....', '...pyyppy...', '...yppyypy..'], pal: { p: '#e8508a', y: '#f6c83c', w: '#ffffff' } },
  bucket:   { dy: -2, rows: ['...ssssss...', '...sSsssd...', '...sSsssd...', '..ssSsssdd..'], pal: { s: '#9aa4b0', S: '#e0e8f0', d: '#6a7480' } },
  // --- Oak
  acorn:    { dy: -3, rows: ['.....kk.....', '....aAaa....', '...aAaAaa...', '..aaAaAaaa..', '..dddddddd..'], pal: { a: '#9a6a3a', A: '#c89858', d: '#5a3c22', k: '#5a3c22' } },
  viking:   { dy: -3, rows: ['.w........w.', '.ww......ww.', '..wssSsssw..', '...sSssss...', '...dddddd...'], pal: { s: '#9aa4b0', S: '#e0e8f0', d: '#6a7480', w: '#f4f0e4' } },
  tophat:   { dy: -4, rows: ['...kkkkkk...', '...kKkkkk...', '...kKkkkk...', '...rrrrrr...', '.kkkkkkkkkk.'], pal: { k: '#2a2230', K: '#55506a', r: '#c8382a' } },
  // --- Maple
  leaves:   { dy: -1, rows: ['...o..y..r..', '..oryoroyro.', '..royoryoro.'], pal: { o: '#f08c28', r: '#d8401c', y: '#fcc450' } },
  pancakes: { dy: -4, rows: ['.....yy.....', '...sssssss..', '...pPpppps..', '...sssssss..', '...pPppppp..'], pal: { p: '#e8b060', P: '#f8d890', s: '#8a4a1a', y: '#fff2a0' } },
  ranger:   { dy: -2, rows: ['.....tt.....', '....tTtt....', '....bbbb....', '.dttTttttd..'], pal: { t: '#b08a4a', T: '#d8b472', d: '#7a5a2a', b: '#4a3418' } },
  // --- Cherry
  blossom:  { dy: -1, rows: ['...p..w..p..', '..pwppwppwp.', '..wpywpywpy.'], pal: { p: '#f6a4c0', w: '#ffffff', y: '#f6c83c' } },
  cherries: { dy: -4, rows: ['.....gg.....', '....g..g....', '...g....g...', '..rr....rr..', '..rR....rR..'], pal: { g: '#4a8a3a', r: '#c8243a', R: '#f06a7a' } },
  kasa:     { dy: -3, rows: ['.....tt.....', '....tTtt....', '...tTtttt...', '..tTtttttt..', '.dddddddddd.'], pal: { t: '#e8d08a', T: '#fff4c0', d: '#b89858' } },
  // --- Redwood
  bear:     { dy: -2, rows: ['..bb....bb..', '..bpb..bpb..', '...bbbbbb...', '...bBbbbb...'], pal: { b: '#7a4a2a', B: '#a87a50', p: '#e8a0a0' } },
  cone:     { dy: -5, rows: ['.....oo.....', '.....oo.....', '....wwww....', '....oooo....', '...wwwwww...', '..oooooooo..'], pal: { o: '#f07a1a', w: '#ffffff' } },
  antlers:  { dy: -4, rows: ['.a.a....a.a.', '.aaa....aaa.', '..a......a..', '..aa....aa..', '...a....a...'], pal: { a: '#c8a878' } },
  // --- Ebony
  wizard:   { dy: -6, rows: ['......v.....', '.....vv.....', '.....vVv....', '....vvyv....', '....vVvvv...', '...vvvvyv...', '.vvvvvvvvvv.'], pal: { v: '#5a3a9a', V: '#9a7ae0', y: '#ffe060' } },
  mushroom: { dy: -3, rows: ['....cccc....', '..ccCcccwc..', '.cCcwcccccc.', '.cccccccccc.'], pal: { c: '#2f7494', C: '#5cb0a8', w: '#b8fff0' } },
  crown:    { dy: -3, rows: ['..k..kk..k..', '..kk.kk.kk..', '..kckkgkkc..', '..yyyyyyyy..'], pal: { k: '#3a3040', c: '#58e0d0', g: '#e8508a', y: '#f6c83c' } },
};
// how each kind of Meeple dresses: body colours to pick from, trim, and usual hat
const LOOKS = {
  player:    { cols: ['#d8402e'], hat: 'hard' },
  jack:      { cols: ['#c8382a', '#3f8a4a', '#d87a2a', '#2f8a8a', '#8a4fa8', '#9a6a3a'], plaid: true, hat: 'beanie' },
  hauler:    { cols: ['#3f6fc8', '#4f9fd8', '#6a5fc8', '#3fa8a0', '#7a8a9a', '#5a78a8'], straps: '#6a4426', hat: 'straw' },
  forester:  { cols: ['#4a8a3a', '#5a9a4a', '#3a7a4a', '#6a8a3a', '#4a7a2a', '#588a58'], straps: '#7a5a2a', hat: 'forester' },
  sawyer:    { cols: ['#c8a868', '#d8b878', '#b89858', '#c8b080', '#d0a060', '#b8a070'], apron: '#f4f0e4', hat: 'flatcap' },
  collier:   { cols: ['#5a5a62', '#6a6a70', '#4a4a54', '#62626a', '#55555e', '#6e6e78'], soot: true, hat: 'bandana' },
  carter:    { cols: ['#9a3a4a', '#8a4a6a', '#a84a3a', '#7a3a5a', '#9a5a4a', '#8a3a3a'], straps: '#3a2414', hat: 'carter' },
  carpenter: { cols: ['#a8703a', '#b8804a', '#98683a', '#a87848', '#b07038', '#9a7040'], apron: '#4f7fb8', hat: 'carpcap' },
  builder:   { cols: ['#e08a2a', '#d89a3a', '#e07a3a', '#c88a2a', '#e8a04a', '#d08030'], straps: '#f0f0ea', hat: 'hard' },
  foreman:   { cols: ['#2f4a7a'], tie: true, hat: 'foreman' },
};
function buildMeeple(o) {
  const frames = {};
  for (const fr of ['stand', 'walkA', 'walkB']) {
    const p = new Pix(18, 28), ox = 2, oy = 10;
    const f = (x, y) => y >= 0 && y < 16 && x >= 0 && x < 14 && MEEPLE_ROWS[y][x] === '#' && !(y === 15 && ((fr === 'walkA' && x < 7) || (fr === 'walkB' && x >= 7)));
    const base = C(o.body), lt = C(shade(o.body, 0.32)), dk = C(shade(o.body, -0.3)), md = C(shade(o.body, -0.14));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 14; x++) {
      if (!f(x, y)) continue;
      let c = base;
      if (x >= 9 || (y >= 13 && (x === 5 || x === 12))) c = md;
      const edge = !f(x + 1, y) || !f(x, y + 1), top = !f(x, y - 1) || (!f(x - 1, y) && y < 13);
      if (edge) c = dk; else if (top) c = lt;
      if (o.plaid && y >= 5 && y <= 12 && c !== lt) { if ((((x + 1) >> 1) + (y >> 1)) & 1) c = C(shade(o.body, c === dk ? -0.55 : -0.42)); }
      if (o.apron && y >= 6 && y <= 12 && x >= 4 && x <= 9 && !edge) c = C(x >= 8 ? shade(o.apron, -0.15) : o.apron);
      if (o.straps && y >= 5 && y <= 11 && (x === 4 || x === 9)) c = C(o.straps);
      if (o.tie && x === 6 && y >= 5 && y <= 9) c = C('#d8402e');
      if (o.tie && (x === 5 || x === 7) && y === 5) c = C('#f0f0ea');
      if (o.soot && hash2(x, y, 77) < 0.14 && !top) c = C('#2a2a30');
      p.set(ox + x, oy + y, c);
    }
    const h = HAT_ART[o.hat];
    if (h) { const m = {}; for (const k in h.pal) m[k] = C(h.pal[k]); p.rows(h.rows, m, ox + 1, oy + h.dy); }
    p.outline(C(shade(o.body, -0.72)));
    frames[fr] = { c: p.toCanvas(), w: 18, h: 28, ax: 9, ay: 26 };
  }
  return frames;
}
// sprites for one Meeple, made the first time that outfit is seen
function meepleFor(role, col, hat) {
  const L = LOOKS[role] || LOOKS.jack, usual = role === 'jack' && col === 0 ? 'beanieB' : L.hat, key = role + '|' + col + '|' + (hat || '');
  return ART.meeple[key] || (ART.meeple[key] = buildMeeple({ body: L.cols[col % L.cols.length], plaid: L.plaid, straps: L.straps, apron: L.apron, soot: L.soot, tie: L.tie, hat: hat || usual }));
}
function meepleURL(role, col, hat) {
  const k = 'm|' + role + '|' + col + '|' + (hat || '');
  return ART.url[k] || (ART.url[k] = meepleFor(role, col, hat).stand.c.toDataURL());
}

function buildAxe(lvl) {
  const steel = ['#9aa2aa', '#9aa2aa', '#aeb8c2', '#c2ccd6', '#d0d8e0', '#e0c060', '#b8e0e8', '#f0d068', '#c8a0f0'][lvl] || '#aeb8c2';
  const p = new Pix(11, 14);
  p.rows(['....hSS.', '....hSSL', '....hSSL', '....hSS.', '....h...', '....h...', '....h...', '....h...', '....h...', '....h...'],
    { h: C('#a06a38'), S: C(steel), L: C(shade(steel, 0.55)) }, 1, 1);
  p.set(5, 10, C('#7a4a26'));
  p.outline(C('#1c120c'));
  return { c: p.toCanvas(), w: 11, h: 14, ax: 5.5, ay: 11 };
}

// ---------------------------------------------------------------- goods: icons and what Meeples carry
const woodMap = t => { const w = TREES[t].wood; return { w: C(w), l: C(shade(w, 0.28)), d: C(shade(w, -0.3)), D: C(shade(w, -0.5)) }; };
const FURN_ART = [
  ['............', '............', '..llllllll..', '..wwwwwwww..', '..dddddddd..', '...w....w...', '...w....w...', '...wddddw...', '...w....w...', '...w....w...', '..dd....dd..'],
  ['..ll........', '..lw........', '..lw........', '..lw........', '..lwwwwwww..', '..lllllllw..', '..dddddddd..', '..w......w..', '..w......w..', '..w......w..', '.dd.....dd..'],
  ['............', '............', 'llllllllllll', 'wwwwwwwwwwww', 'dddddddddddd', '.ww......ww.', '.ww......ww.', '.ww......ww.', '.ww......ww.', '.ww......ww.', '.dd......dd.'],
  ['.llllllllll.', '.wwwwwwwwww.', '.wddddddddw.', '.wwwwyywwww.', '.wddddddddw.', '.wwwwyywwww.', '.wddddddddw.', '.wwwwyywwww.', '.wwwwwwwwww.', '.dd......dd.'],
  ['..llllllll..', '..wwwwwwww..', '..wggwwggw..', '..wgGwwgGw..', '..wggwwggw..', '..wwwwwwww..', '..wddwwddw..', '..wdywwydw..', '..wddwwddw..', '..wwwwwwww..', '..dd....dd..'],
  ['............', 'll..........', 'lw..........', 'lw.pp.......', 'lwpppcccccc.', 'lwwwwwwwwwwl', 'lddddddddddw', 'lw........lw', 'dd........dd'],
  ['............', '.llllllllll.', '.wwwwwwwwww.', '.wwwwwwwwww.', '.wddddddddw.', '.KkKkKKkKkK.', '.KKKKKKKKKK.', '.wwwwwwwwww.', '.ww......ww.', '.ww......ww.', '.dd......dd.'],
];
const PLANK_ART = ['............', '..llllllllll', '..wwwwwwwwww', '..dddddddddd', '.llllllllll.', '.wwwwwwwwww.', '.dddddddddd.', 'llllllllll..', 'wwwwwwwwww..', 'dddddddddd..'];
const CHAR_ART = ['............', '....kk......', '...kKkk.kk..', '..kkkkkkKkk.', '..kKkkokkkk.', '.kkkkkkkkKk.', '.kkokkKkkkk.', '..kkkkkkok..', '...kkkkkk...'];
const EXTRA = { y: C('#f6c83c'), g: C('#a8d8e8'), G: C('#e8f8ff'), p: C('#f4f0e4'), c: C('#c8382a'), K: C('#f4f0e4'), k: C('#1c1820'), o: C('#f07a1a') };
function buildItemIcon(it) {
  const I = ITEMS[it], p = new Pix(14, 13);
  if (I.kind === 'char') p.rows(CHAR_ART, { k: C('#2a2a30'), K: C('#5a5a64'), o: C('#f07a1a') }, 1, 1);
  else p.rows(I.kind === 'plank' ? PLANK_ART : FURN_ART[I.t], Object.assign({}, EXTRA, woodMap(I.t)), 1, 1);
  p.outline(C('#1c120c'));
  return p.toCanvas();
}
// what a Meeple balances on its head
function buildCarry(it) {
  const I = ITEMS[it];
  if (I.kind === 'log') return buildLog(I.t, 8, 3);
  const p = new Pix(14, 9), m = woodMap(I.t);
  if (I.kind === 'plank') { p.rect(2, 3, 10, 1, m.l); p.rect(2, 4, 10, 1, m.d); }
  else if (I.kind === 'char') { p.rows(['.kkk.', 'kKkkk', 'kkokk', '.kkk.'], { k: C('#2a2a30'), K: C('#5a5a64'), o: C('#f07a1a') }, 4, 2); }
  else { p.rect(4, 2, 6, 1, m.l); p.rect(4, 3, 6, 3, m.w); p.rect(4, 5, 6, 1, m.d); p.rect(6, 3, 2, 1, m.D); }
  p.outline(C('#1c120c'));
  return p.sprite(7, 7);
}

// ---------------------------------------------------------------- buildings
function shingles(p, yTop, yBot, xl0, xr0, xl1, xr1, pal) {
  for (let y = yTop; y <= yBot; y++) {
    const v = (y - yTop) / (yBot - yTop), xl = Math.round(xl0 + (xl1 - xl0) * v), xr = Math.round(xr0 + (xr1 - xr0) * v);
    const row = ((y - yTop) / 3) | 0, k = (y - yTop) % 3;
    for (let x = xl; x <= xr; x++) {
      let c = k === 0 ? pal[2] : k === 1 ? pal[1] : pal[0];
      if ((x + (row & 1) * 3) % 6 === 0 && k < 2) c = pal[0];
      if (hash2(x, row, 41) < 0.08 && k === 1) c = pal[2];
      if (x - xl < 2) c = pal[2]; else if (xr - x < 2) c = pal[0];
      p.set(x, y, c);
    }
  }
}
const LOGW = PAL('#6e4622', '#a06c38', '#c08a4e');
function logWall(p, x0, x1, y0, y1, L = LOGW) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = (y - y0) % 4; let c = k === 0 ? L[2] : k === 3 ? L[0] : L[1];
    if (hash2(x >> 2, y, 12) < 0.07 && k !== 3) c = L[0];
    if (y < y0 + 3) c = k === 3 ? C('#4a2e16') : L[0];         // shade under the eaves
    p.set(x, y, c);
  }
  for (let y = y0; y <= y1 - 2; y += 4) for (const x of [x0, x1 - 2]) { p.rect(x, y, 3, 4, L[0]); p.rect(x, y, 3, 3, C('#d8a868')); p.set(x + 1, y + 1, C('#a87a42')); }
}
function plankWall(p, x0, x1, y0, y1, L) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let c = (x - x0) % 4 === 3 ? L[0] : hash2(x, y >> 2, 19) < 0.1 ? L[2] : L[1];
    if (y < y0 + 2) c = L[0];
    p.set(x, y, c);
  }
}
function stoneRow(p, x0, x1, y) { for (let x = x0; x <= x1; x++) { p.set(x, y, (x >> 2) & 1 ? C('#a4a4a0') : C('#868684')); p.set(x, y + 1, (x >> 2) & 1 ? C('#8a8a86') : C('#6c6c6a')); } }
function door(p, x, y0, y1, w = 9) {
  p.rect(x, y0, w, y1 - y0 + 1, C('#3c2412'));
  for (let y = y0 + 1; y <= y1; y++) for (let i = 1; i < w - 1; i++) p.set(x + i, y, (i - 1) % 3 === 2 ? C('#5a3418') : y < y0 + 3 ? C('#6a4020') : C('#8a5428'));
  p.set(x + w - 3, ((y0 + y1) >> 1) + 1, C('#f6c83c'));
  p.rect(x - 1, y1 + 1, w + 2, 1, C('#9c9c98')); p.rect(x - 1, y1 + 2, w + 2, 1, C('#74747a'));
}
function windowLit(p, x, y, w, h) {
  p.rect(x - 1, y - 1, w + 2, h + 2, C('#4a2c16'));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.set(x + i, y + j, (i === (w >> 1) || j === (h >> 1)) ? C('#5a3a1e') : (i + j) % 5 === 0 ? C('#fff2b0') : j < h / 2 ? C('#ffd86a') : C('#ffb840'));
  p.rect(x - 2, y + h + 1, w + 4, 1, C('#7a4a26'));
}
function chimney(p, x, y0, y1) {
  for (let y = y0; y <= y1; y++) for (let i = 0; i < 6; i++) {
    const m = (y % 3 === 0) || ((x + i + ((y / 3) | 0) * 2) % 4 === 0);
    p.set(x + i, y, m ? C('#5a5a5c') : i < 2 ? C('#a8a8a4') : C('#868684'));
  }
  p.rect(x - 1, y0 - 1, 8, 2, C('#4a4a4e'));
}
function buildCabin() {
  const p = new Pix(60, 64), roof = PAL('#7a2a1e', '#a83c28', '#d06040');
  shadow(p, 28, 57, 26);
  chimney(p, 38, 3, 18);
  logWall(p, 6, 49, 30, 55);
  stoneRow(p, 6, 49, 54);
  shingles(p, 10, 31, 11, 44, 3, 52, roof);
  p.rect(10, 9, 36, 1, C('#5a1e16')); p.rect(3, 32, 50, 1, C('#4a1810'));
  door(p, 14, 38, 54);
  windowLit(p, 30, 37, 10, 8);
  p.rows(['.r.gr.g.r.gr', 'gggggggggggg'], { r: C('#e8504a'), g: C('#4a9a42') }, 29, 44);
  p.rect(25, 40, 2, 1, C('#3a3a3e')); p.rect(25, 41, 2, 3, C('#ffd86a')); p.set(25, 41, C('#fff2b0')); p.rect(25, 44, 2, 1, C('#3a3a3e'));
  p.outline(C('#1c120c'));
  return p.sprite(28, 57);
}
function buildYard() {
  const p = new Pix(96, 80), post = PAL('#5a3a1e', '#8a5c30', '#b07e46'), roof = PAL('#28486a', '#3a6a8e', '#6094b6');
  shadow(p, 47, 73, 44);
  for (let y = 30; y <= 68; y++) for (let x = 10; x <= 55; x++) {
    let c = (x % 5 === 0) ? C('#2c2018') : C('#3e2c20');
    if (y < 36) c = C('#241a14');
    if (y >= 62) c = ((x + y) % 7 === 0) ? C('#7a5c3a') : y === 62 ? C('#5a4028') : C('#94704a');
    p.set(x, y, c);
  }
  for (const x of [8, 31, 54]) for (let y = 28; y <= 70; y++) { p.set(x, y, post[2]); p.set(x + 1, y, post[1]); p.set(x + 2, y, post[0]); }
  p.rect(8, 69, 49, 2, C('#6a4a2a')); p.rect(8, 70, 49, 1, C('#4a3018'));
  shingles(p, 10, 30, 13, 52, 4, 61, roof);
  p.rect(12, 9, 42, 1, C('#1c3450')); p.rect(4, 31, 58, 2, C('#4a3018')); p.rect(4, 31, 58, 1, C('#7a5430'));
  p.rect(26, 15, 14, 10, C('#e8d4a0')); p.rect(26, 15, 14, 1, C('#fff4d0')); p.rect(26, 24, 14, 1, C('#b89c68'));
  logEnd(p, 30, 17, 2);
  for (let y = 38; y <= 54; y++) for (let x = 64; x <= 85; x++) p.set(x, y, C('#2e221a'));
  for (const x of [62, 86]) for (let y = 34; y <= 70; y++) { p.set(x, y, post[2]); p.set(x + 1, y, post[0]); }
  for (let y = 27; y <= 38; y++) for (let x = 60; x <= 89; x++) {
    const st = ((x - 60) / 3 | 0) & 1; if (y === 38 && !st) continue;
    let c = st ? C('#f4e8c8') : C('#c8382a');
    if (y === 27) c = st ? C('#ffffff') : C('#e8604a'); if (y >= 36) c = st ? C('#d0c098') : C('#96241c');
    p.set(x, y, c);
  }
  for (let y = 52; y <= 70; y++) for (let x = 62; x <= 87; x++) {
    const c = y < 55 ? (y === 52 ? C('#f0c88c') : C('#d8a868')) : ((x - 62) % 6 === 5 ? C('#7a5028') : y > 68 ? C('#8a5c30') : C('#b07a42'));
    p.set(x, y, c);
  }
  p.rows(['.YY.', 'YWYy', 'YYYy', '.yy.'], { Y: C('#f6c83c'), W: C('#fff4b0'), y: C('#c88418') }, 73, 41);
  p.set(74, 39, C('#3a3a3e')); p.set(74, 40, C('#3a3a3e'));
  p.rows(['YYY', 'yyy', 'YYY', 'yyy', 'YYY'], { Y: C('#f6c83c'), y: C('#c88418') }, 66, 47);
  p.rows(['.YYY', '.yyy', '.YYY'], { Y: C('#f6c83c'), y: C('#c88418') }, 69, 49);
  p.rect(1, 68, 6, 4, BARK[2][1]); p.rect(1, 66, 6, 2, C('#c89858')); p.rect(1, 71, 6, 1, BARK[2][0]); p.set(3, 66, C('#9a7240'));
  p.outline(C('#1c120c'));
  return p.sprite(47, 73);
}
// where stock shows inside the yard's shed, relative to its sprite anchor (bottom rows first)
const YARD_SLOTS = [];
for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - (row & 1); i++) YARD_SLOTS.push([-33 + i * 7 + (row & 1) * 3, -12 - row * 5]);
const DEPOT_SLOTS = [];
for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - (row & 1); i++) DEPOT_SLOTS.push([-18 + i * 7 + (row & 1) * 3, -11 - row * 5]);

function buildForester() {
  const p = new Pix(48, 60), roof = PAL('#2c5a34', '#3f7a44', '#62a058');
  shadow(p, 22, 53, 20);
  logWall(p, 6, 37, 32, 51);
  stoneRow(p, 6, 37, 50);
  shingles(p, 14, 33, 12, 31, 3, 40, roof);
  p.rect(11, 13, 22, 1, C('#1c3c24')); p.rect(3, 34, 38, 1, C('#1c3c24'));
  for (let i = 0; i < 16; i++) { const x = 6 + ((hash2(i, 3, 5) * 32) | 0), y = 16 + ((hash2(i, 9, 5) * 16) | 0); if (p.solid(x, y)) p.set(x, y, C('#8ac86a')); }   // moss
  door(p, 17, 38, 50, 8);
  for (let y = 38; y <= 42; y++) for (let x = 29; x <= 33; x++) if (Math.abs(x - 31) + Math.abs(y - 40) < 4) p.set(x, y, (x + y) & 1 ? C('#ffd86a') : C('#ffb840'));
  // seedlings in pots, and a spade
  for (const x of [38, 42]) { p.rect(x, 50, 3, 3, C('#b0603a')); p.set(x + 1, 49, C('#3f8a4a')); p.set(x, 48, C('#62b058')); p.set(x + 2, 48, C('#62b058')); p.set(x + 1, 47, C('#8ad070')); }
  p.rect(3, 40, 1, 11, C('#a06a38')); p.rect(2, 50, 3, 3, C('#9aa4b0'));
  p.outline(C('#1c120c'));
  return p.sprite(22, 53);
}
function buildSawmill() {
  const p = new Pix(64, 64), wall = PAL('#8a6436', '#c09454', '#deb878'), roof = PAL('#3c4450', '#5a6676', '#8492a2');
  shadow(p, 28, 57, 27);
  plankWall(p, 6, 49, 30, 55, wall);
  stoneRow(p, 6, 49, 54);
  shingles(p, 10, 31, 11, 44, 3, 52, roof);
  p.rect(10, 9, 36, 1, C('#262c36')); p.rect(3, 32, 50, 1, C('#262c36'));
  // wide open doorway with the saw inside
  p.rect(10, 36, 22, 19, C('#2a1e16'));
  for (let y = 38; y <= 52; y++) for (let x = 14; x <= 28; x++) {
    const dx = x - 21, dy = y - 45, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 7.4) p.set(x, y, d > 6 ? (((Math.atan2(dy, dx) * 6) | 0) & 1 ? C('#e8eef4') : C('#6a7480')) : d < 1.5 ? C('#3a3a3e') : (dx - dy < 0 ? C('#c2ccd6') : C('#9aa4b0')));
  }
  p.rect(10, 53, 22, 2, C('#8a6436'));
  windowLit(p, 37, 38, 8, 7);
  // a log waiting on the ramp, and sawdust
  p.rect(50, 49, 10, 4, BARK[2][1]); p.rect(50, 49, 10, 1, BARK[2][2]); p.rect(50, 52, 10, 1, BARK[2][0]); p.rect(59, 49, 2, 4, C('#c89858'));
  p.rect(50, 53, 2, 3, C('#6e4622')); p.rect(57, 53, 2, 3, C('#6e4622'));
  for (let i = 0; i < 14; i++) p.set(2 + ((hash2(i, 1, 8) * 8) | 0), 54 + ((hash2(i, 2, 8) * 3) | 0), C(i & 1 ? '#f0d890' : '#d8b860'));
  // sign: a plank
  p.rect(20, 16, 16, 9, C('#e8d4a0')); p.rect(22, 19, 12, 1, C('#f2deb0')); p.rect(22, 20, 12, 2, C('#c89858')); p.rect(22, 22, 12, 1, C('#8a6436'));
  p.outline(C('#1c120c'));
  return p.sprite(28, 57);
}
function buildKiln() {
  const p = new Pix(48, 56), pal = PAL('#5a2e22', '#8a4a34', '#b06a48', '#cc8a62', '#e0a882');
  shadow(p, 22, 49, 20);
  canopy(p, [{ x: 22, y: 36, rx: 16, ry: 15 }, { x: 22, y: 26, rx: 10, ry: 8 }], pal, 91);
  for (let y = 16; y <= 49; y++) for (let x = 4; x <= 40; x++) if (p.solid(x, y) && (y % 4 === 0 || (x + ((y >> 2) & 1) * 3) % 6 === 0)) p.set(x, y, pal[0]);     // brick courses
  for (let y = 50; y < 56; y++) for (let x = 0; x < 48; x++) if (p.solid(x, y)) p.set(x, y, 0);
  p.rect(18, 15, 9, 3, C('#3a3a3e')); p.rect(19, 14, 7, 1, C('#5a5a5c'));
  // fire door
  for (let y = 38; y <= 49; y++) for (let x = 16; x <= 28; x++) {
    const dx = (x - 22) / 6.5, dy = (y - 49) / 11; if (dx * dx + dy * dy > 1) continue;
    const d = dx * dx + dy * dy; p.set(x, y, d > 0.7 ? C('#2a1a16') : d > 0.35 ? C('#d8501c') : (x + y) & 1 ? C('#ffd84a') : C('#f8a030'));
  }
  // stacked logs beside it
  logEnd(p, 37, 43, 0); logEnd(p, 40, 38, 1); logEnd(p, 42, 43, 0);
  p.outline(C('#1c120c'));
  return p.sprite(22, 50);
}
function buildDepot() {
  const p = new Pix(64, 60), post = PAL('#5a3a1e', '#8a5c30', '#b07e46'), roof = PAL('#2e5a3a', '#44804e', '#6aa868');
  shadow(p, 28, 53, 27);
  // deck
  for (let y = 44; y <= 52; y++) for (let x = 5; x <= 50; x++) p.set(x, y, y === 44 ? C('#d8b078') : (x % 6 === 0) ? C('#7a5630') : y > 50 ? C('#8a6436') : C('#b88c54'));
  for (let y = 26; y <= 44; y++) for (let x = 8; x <= 47; x++) p.set(x, y, (x % 5 === 0) ? C('#2c2018') : C('#3a2a1e'));
  for (const x of [5, 27, 48]) for (let y = 24; y <= 52; y++) { p.set(x, y, post[2]); p.set(x + 1, y, post[1]); p.set(x + 2, y, post[0]); }
  shingles(p, 10, 25, 11, 44, 2, 53, roof);
  p.rect(10, 9, 36, 1, C('#1c3c24')); p.rect(2, 26, 52, 2, C('#4a3018'));
  // signpost with an arrow home
  p.rect(57, 36, 2, 17, post[1]); p.rect(52, 34, 11, 6, C('#e8d4a0')); p.rect(54, 36, 6, 2, C('#c8382a')); p.set(53, 37, C('#c8382a')); p.set(53, 36, C('#c8382a'));
  p.outline(C('#1c120c'));
  return p.sprite(28, 53);
}
function buildWorkshop() {
  const p = new Pix(64, 66), roof = PAL('#8a4a1e', '#b86a2a', '#e09244'), beam = C('#4a2c16');
  shadow(p, 28, 59, 27);
  chimney(p, 12, 5, 18);
  // timber frame over plaster
  for (let y = 31; y <= 57; y++) for (let x = 6; x <= 49; x++) p.set(x, y, y < 34 ? C('#b8ae98') : hash2(x >> 1, y >> 1, 23) < 0.08 ? C('#d8d0bc') : C('#efe8d6'));
  for (const x of [6, 20, 35, 48]) p.rect(x, 31, 2, 27, beam);
  p.rect(6, 31, 44, 2, beam); p.rect(6, 44, 44, 2, beam);
  p.line(8, 56, 19, 46, beam); p.line(37, 46, 47, 56, beam);
  stoneRow(p, 6, 49, 56);
  shingles(p, 11, 32, 11, 44, 3, 52, roof);
  p.rect(10, 10, 36, 1, C('#5a2e12')); p.rect(3, 33, 50, 1, C('#5a2e12'));
  door(p, 23, 40, 56, 9);
  windowLit(p, 10, 36, 8, 7); windowLit(p, 38, 36, 8, 7);
  // hanging sign with a hammer, and a chair out front
  p.rect(22, 18, 14, 10, C('#e8d4a0')); p.rect(28, 20, 2, 7, C('#a06a38')); p.rect(25, 20, 8, 3, C('#8a949e')); p.rect(25, 20, 8, 1, C('#d8e0e8'));
  p.rows(['l...', 'l...', 'lwww', 'dddd', 'w..w', 'w..w'], woodMap(2), 54, 53);
  p.outline(C('#1c120c'));
  return p.sprite(28, 59);
}
// The Great Lodge at each stage of building: 0 is a staked-out site, 7 is finished.
function buildLodge(st) {
  const p = new Pix(100, 104), cx = 48, by = 97;
  const wd = t => { const w = TREES[t].wood; return [C(shade(w, -0.35)), C(w), C(shade(w, 0.25))]; };
  shadow(p, cx, by, 46);
  // site: bare earth, stakes and string
  for (let y = 78; y <= 96; y++) for (let x = 8; x <= 88; x++) p.set(x, y, ptone(PAL('#7a5c3a', '#8e6e48', '#a28256'), hash2(x >> 1, y >> 1, 9), x, y));
  if (st === 0) {
    for (const [x, y] of [[9, 80], [87, 80], [9, 95], [87, 95]]) { p.rect(x, y - 6, 2, 7, C('#c89858')); p.set(x, y - 7, C('#e8503a')); p.set(x + 1, y - 7, C('#e8503a')); }
    for (let x = 11; x < 87; x += 2) { p.set(x, 76, C('#f4f0e4')); p.set(x, 91, C('#f4f0e4')); }
    p.rect(44, 70, 2, 14, C('#8a5c30')); p.rect(38, 64, 14, 9, C('#e8d4a0')); p.rect(40, 66, 10, 1, C('#8a6436')); p.rect(40, 68, 7, 1, C('#8a6436')); p.rect(40, 70, 9, 1, C('#8a6436'));
    p.outline(C('#1c120c'));
    return p.sprite(cx, by);
  }
  const X0 = 10, X1 = 86, WT = 52;
  // 1 pine foundations: stone course and sill logs
  stoneRow(p, X0, X1, 94); stoneRow(p, X0, X1, 92);
  { const L = wd(0); for (let y = 86; y <= 91; y++) for (let x = X0; x <= X1; x++) p.set(x, y, (y - 86) % 3 === 0 ? L[2] : (y - 86) % 3 === 2 ? L[0] : L[1]); }
  // 2 birch floor, seen from the front as a pale deck and steps
  if (st >= 2) { const L = wd(1); p.rect(X0 - 2, 84, X1 - X0 + 5, 2, L[2]); p.rect(X0 - 2, 86, X1 - X0 + 5, 1, L[0]); p.rect(40, 92, 18, 2, L[1]); p.rect(38, 94, 22, 2, L[2]); p.rect(38, 96, 22, 1, L[0]); }
  // 3 oak frame: posts, beams and braces
  if (st >= 3) {
    const L = wd(2);
    for (const x of [X0, 28, 46, 64, X1 - 2]) for (let y = WT; y <= 84; y++) { p.set(x, y, L[2]); p.set(x + 1, y, L[1]); p.set(x + 2, y, L[0]); }
    p.rect(X0, WT, X1 - X0 + 1, 3, L[1]); p.rect(X0, WT, X1 - X0 + 1, 1, L[2]); p.rect(X0, WT + 2, X1 - X0 + 1, 1, L[0]);
    if (st === 3) { p.line(X0 + 3, 64, 27, WT + 3, L[0]); p.line(66, WT + 3, X1 - 3, 64, L[0]); p.line(31, WT + 3, 45, 66, L[0]); p.line(49, 66, 63, WT + 3, L[0]); }
  }
  // 4 maple walls
  if (st >= 4) {
    const L = wd(3);
    for (let y = WT + 3; y <= 83; y++) for (let x = X0 + 3; x <= X1 - 3; x++) {
      if (x === 28 || x === 29 || x === 30 || x === 46 || x === 47 || x === 48 || x === 64 || x === 65 || x === 66) continue;
      const k = (y - WT) % 4; p.set(x, y, k === 0 ? L[2] : k === 3 ? L[0] : hash2(x >> 2, y, 7) < 0.08 ? L[0] : L[1]);
    }
    p.rect(40, 62, 17, 22, C('#241a14'));                                   // doorway
    for (const x of [16, 70]) p.rect(x, 62, 9, 10, C('#241a14'));            // window openings
  }
  // 5 cherry panelling: doors, windows and banners
  if (st >= 5) {
    const L = wd(4);
    for (let y = 63; y <= 83; y++) for (let x = 41; x <= 55; x++) p.set(x, y, x === 48 ? L[0] : (x - 41) % 4 === 3 ? L[0] : y < 66 ? L[2] : L[1]);
    p.set(46, 74, C('#f6c83c')); p.set(50, 74, C('#f6c83c'));
    p.rect(39, 60, 19, 2, L[0]); p.rect(39, 60, 19, 1, L[2]);
    for (const x of [17, 71]) windowLit(p, x, 63, 7, 8);
    for (const x of [32, 61]) { p.rect(x, 58, 5, 12, C('#c8382a')); p.rect(x, 58, 5, 1, C('#f6c83c')); p.set(x + 2, 63, C('#f6c83c')); p.set(x, 70, C('#c8382a')); p.set(x + 4, 70, C('#c8382a')); }
  }
  // 6 redwood roof
  if (st >= 6) {
    const L = wd(5), roof = [L[0], L[1], C(shade(TREES[5].wood, 0.35))];
    shingles(p, 24, WT + 2, 22, 74, 4, 92, roof);
    p.rect(21, 23, 55, 1, L[0]); p.rect(4, WT + 3, 89, 1, C('#3c140c'));
    // dormer
    p.rect(40, 34, 17, 12, C('#efe8d6')); windowLit(p, 44, 37, 9, 7);
    shingles(p, 28, 35, 46, 50, 37, 59, roof);
  }
  // 7 ebony spire, flags and a lit hall
  if (st >= 7) {
    const L = wd(6);
    for (let y = 6; y <= 24; y++) { const hw = Math.round((y - 6) * 0.42) + 1; for (let x = cx - hw; x <= cx + hw; x++) p.set(x, y, x < cx - hw / 3 ? L[2] : x > cx + hw / 3 ? L[0] : L[1]); }
    p.rect(cx, 1, 1, 5, C('#f6c83c')); p.rows(['rrrr', 'rrr.', 'rr..'], { r: C('#e8503a') }, cx + 1, 1);
    for (const x of [8, 88]) { p.rect(x, WT - 12, 1, 14, C('#8a5c30')); p.rows(['yyyy', 'yyy.', 'yy..'], { y: C('#f6c83c') }, x + 1, WT - 12); }
    for (const x of [16, 70]) for (let y = 62; y <= 71; y++) for (let i = 0; i < 9; i++) if (p.get(x + i, y) === C('#ffb840')) p.set(x + i, y, C('#ffe89a'));
  }
  p.outline(C('#1c120c'));
  return p.sprite(cx, by);
}
// a carter's handcart
function buildCart() {
  const p = new Pix(18, 12);
  p.rows(['.bBBBBBBBBb...', '.bbbbbbbbbbhhh', '.bBBBBBBBBb...', '.ddddddddddd..', '...kk...kk....', '..kwwk.kwwk...', '...kk...kk....'],
    { b: C('#8a5c30'), B: C('#b88c54'), d: C('#5a3a1e'), h: C('#a06a38'), k: C('#2a2230'), w: C('#9aa4b0') }, 1, 3);
  p.outline(C('#1c120c'));
  return { c: p.toCanvas(), w: 18, h: 12, ax: 7, ay: 10 };
}

// soft patch of bare earth under a building
function buildApron(w, h) {
  const p = new Pix(w, h), pal = PAL('#7a5c3a', '#8e6e48', '#a28256');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2), d = 1 - (dx * dx + dy * dy);
    if (d <= 0 || d * 3 < bayer(x, y)) continue;
    p.set(x, y, ptone(pal, 0.2 + hash2(x >> 1, y >> 1, 9) * 0.7, x, y));
  }
  return { c: p.toCanvas(), w, h, ax: w >> 1, ay: h >> 1 };
}

// ---------------------------------------------------------------- UI icons (drawn large in the DOM)
const ICONS = {
  coin: [['....YYYY....', '..YYYYYYYY..', '.YYWWYYYYYD.', '.YWYYYddYYD.', 'YYWYYdYYYYDD', 'YYWYYdYYYYDD', 'YYYYYdYYYYDD', 'YYYYYdYYYYDD', '.YYYYYddYDD.', '.YYYYYYYDDD.', '..DDDDDDDD..', '....DDDD....'],
    { Y: '#f6c83c', W: '#fff4b0', d: '#c88418', D: '#d89a20' }],
  hammer: [['..SSSSSSS...', '.SLLLLLLSS..', '.SSSSSSSSS..', '..SSShSSS...', '.....hH.....', '.....hH.....', '.....hH.....', '.....hH.....', '.....hH.....', '.....hH.....', '.....hH.....', '.....hh.....'],
    { S: '#8a949e', L: '#d8e0e8', h: '#a06a38', H: '#7a4a26' }],
  boots: [['..bbbb......', '..bBBb......', '..bBBb......', '..bBBb......', '..bBBbb.....', '..bBBBBbb...', '..bBBBBBBbb.', '..bBBBBBBBBb', '..bbbbbbbbbb', '..dddddddddd'],
    { b: '#7a4a26', B: '#a86a34', d: '#3a2414' }],
  pack: [['....rrrr....', '...r....r...', '..bbbbbbbb..', '.bBBBBBBBBb.', '.bBBLLLLBBb.', '.bBBBBBBBBb.', '.bBddddddBb.', '.bBdBBBBdBb.', '.bBdBBBBdBb.', '.bBBBBBBBBb.', '..bbbbbbbb..'],
    { r: '#6a4426', b: '#5a6e3a', B: '#7e9a4e', L: '#a8c070', d: '#4a5a2e' }],
  map: [['.pppp..pppp.', 'pPPPPppPPPPp', 'pPgPPPPPPgPp', 'pPggPPbPPPPp', 'pPPPPbbPPPPp', 'pPPrPPbPPgPp', 'pPPPPPPPggPp', 'pPgPPPPPPPPp', 'pPPPPppPPPPp', '.pppp..pppp.'],
    { p: '#b89c68', P: '#f0e0b0', g: '#5aa348', b: '#4f9fc4', r: '#d8402e' }],
  target: [['.....kk.....', '...kkkkkk...', '..kk....kk..', '.kk......kk.', '.k...rr...k.', 'kk..rrrr..kk', 'kk..rrrr..kk', '.k...rr...k.', '.kk......kk.', '..kk....kk..', '...kkkkkk...', '.....kk.....'],
    { k: '#3d2a1f', r: '#d8402e' }],
  menu: [['............', '.kkkkkkkkkk.', '.kkkkkkkkkk.', '............', '.kkkkkkkkkk.', '.kkkkkkkkkk.', '............', '.kkkkkkkkkk.', '.kkkkkkkkkk.', '............'],
    { k: '#3d2a1f' }],
  sled: [['............', '.LLLLLLLLL..', '.bbbbbbbbb..', '.LLLLLLLLL..', '.bbbbbbbbb..', 'wwwwwwwwwwww', '.w........w.', '.w........w.', 'ssssssssssss'],
    { L: '#c89858', b: '#5a3c22', w: '#a06a38', s: '#8a949e' }],
  blade: [['....s.ss.s..', '..s.ssssss.s', '..ssSSSSsss.', '.ssSSsssSss.', 'sssSskkSsSss', '.sSSskkSsSs.', '.ssSSsssSss.', 'sssSSSSSsss.', '..sssssssss.', '..s.ss.s.s..'],
    { s: '#8a949e', S: '#d8e0e8', k: '#3a3a3e' }],
  chisel: [['.........SS.', '........SLS.', '.......SLS..', '......SLS...', '.....hhS....', '....hHh.....', '...hHh......', '..hHh.......', '.hHh........', '.hh.........'],
    { S: '#8a949e', L: '#e0e8f0', h: '#a06a38', H: '#d8a868' }],
  seedling: [['......gg....', '.gg..gGg....', '.gGg.gg.....', '..ggg.......', '....g.......', '....g..gg...', '....g.gGg...', '....ggg.....', '..bbbbbbb...', '..bBBBBBb...', '...bbbbb....'],
    { g: '#3f8a4a', G: '#8ad070', b: '#8a4a2a', B: '#b0603a' }],
  cart: [['............', '.bBBBBBBBb..', '.bbbbbbbbbhh', '.bBBBBBBBb..', '.ddddddddd..', '..kk...kk...', '.kwwk.kwwk..', '..kk...kk...'],
    { b: '#8a5c30', B: '#b88c54', d: '#5a3a1e', h: '#a06a38', k: '#2a2230', w: '#9aa4b0' }],
  move: [['.....kk.....', '....kkkk....', '...kkkkkk...', '.....kk.....', '.k...kk...k.', 'kkkkkkkkkkkk', 'kkkkkkkkkkkk', '.k...kk...k.', '.....kk.....', '...kkkkkk...', '....kkkk....', '.....kk.....'],
    { k: '#3d2a1f' }],
  scroll: [['..pppppppp..', '.pPPPPPPPPp.', '.pPkkkkkPPp.', '.pPPPPPPPPp.', '.pPkkkkkkPp.', '.pPPPPPPPPp.', '.pPkkkkPPPp.', '.pPPPPPPPPp.', '.pPPPPPrrPp.', '.pPPPPPrrPp.', '..pppppppp..'],
    { p: '#b89c68', P: '#f0e0b0', k: '#6a4a32', r: '#c8382a' }],
  bed: [['............', 'h...........', 'h.ww........', 'hwwwrrrrrrr.', 'hhhhhhhhhhhh', 'hBBBBBBBBBBh', 'h..........h', 'h..........h'],
    { h: '#7a4a26', w: '#f4f0e4', r: '#c8382a', B: '#a06a38' }],
};
function buildIcon(name) {
  const [rows, map] = ICONS[name], m = {};
  for (const k in map) m[k] = C(map[k]);
  const p = new Pix(rows[0].length + 2, rows.length + 2);
  p.rows(rows, m, 1, 1);
  if (name !== 'menu' && name !== 'target' && name !== 'move') p.outline(C('#3d2a1f'));
  return p.toCanvas();
}

// tiny 3x5 font for numbers floating in the world
const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  '+': '000010111010000', '-': '000000111000000', 'k': '100101110101101', '.': '000000000000010', '!': '010010010000010', 'x': '000101010101000',
};
function drawNum(ctx, str, x, y, col, out = '#1c120c') {
  x = Math.round(x - str.length * 2); y = Math.round(y);
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass ? col : out;
    for (let i = 0; i < str.length; i++) {
      const g = FONT[str[i]]; if (!g) continue;
      for (let k = 0; k < 15; k++) if (g[k] === '1') {
        const px = x + i * 4 + (k % 3), py = y + ((k / 3) | 0);
        if (pass) ctx.fillRect(px, py, 1, 1); else ctx.fillRect(px - 1, py - 1, 3, 3);
      }
    }
  }
}

// ---------------------------------------------------------------- build everything
const TREE_VARIANTS = 3;
function yieldNow() { return new Promise(r => setTimeout(r, 0)); }
async function buildArtAsync(progress) {
  const jobs = [];
  for (let t = 0; t < NT; t++) {
    ART.tree[t] = [];
    for (let v = 0; v < TREE_VARIANTS; v++) { ART.tree[t][v] = []; for (let st = 0; st < 3; st++) jobs.push(() => { ART.tree[t][v][st] = buildTree(t, v, st); }); }
    jobs.push(() => {
      ART.stump[t] = buildStump(t);
      ART.pile[t] = [null]; for (let n = 1; n <= 6; n++) ART.pile[t][n] = buildPile(t, n);
      ART.log[t] = buildLog(t, 11, 6);
      const e = new Pix(6, 6); logEnd(e, 0, 0, t); ART.end[t] = e.toCanvas();
    });
  }
  jobs.push(() => {
    for (let v = 0; v < 3; v++) ART.rock[v] = buildRock(v);
    for (let it = 0; it < NI; it++) ART.carry[it] = buildCarry(it);
    ART.axe = []; for (let l = 0; l <= MAX_AXE; l++) ART.axe[l] = buildAxe(l);
    ART.cart = buildCart();
  });
  jobs.push(() => { ART.spr.cabin = buildCabin(); ART.spr.yard = buildYard(); ART.spr.forester = buildForester(); });
  jobs.push(() => { ART.spr.sawmill = buildSawmill(); ART.spr.kiln = buildKiln(); ART.spr.depot = buildDepot(); ART.spr.workshop = buildWorkshop(); });
  for (let st = 0; st <= LODGE.length; st++) jobs.push(() => { ART.spr['lodge' + st] = buildLodge(st); });
  jobs.push(() => { ART.spr.apron2 = buildApron(48, 26); ART.spr.apron3 = buildApron(64, 30); ART.spr.apron5 = buildApron(104, 44); });
  for (let i = 0; i < jobs.length; i++) { jobs[i](); if (i % 4 === 3) { progress((i + 1) / jobs.length); await yieldNow(); } }
  // data URLs for the DOM
  const U = ART.url;
  for (const k in ICONS) U[k] = buildIcon(k).toDataURL();
  for (let t = 0; t < NT; t++) { U['it' + t] = U['log' + t] = ART.log[t].c.toDataURL(); U['tree' + t] = ART.tree[t][0][2].c.toDataURL(); }
  for (let it = NT; it < NI; it++) U['it' + it] = buildItemIcon(it).toDataURL();
  for (const k of ['cabin', 'yard', 'forester', 'sawmill', 'kiln', 'depot', 'workshop']) U[k] = ART.spr[k].c.toDataURL();
  U.lodge = ART.spr['lodge' + LODGE.length].c.toDataURL();
  for (let st = 0; st <= LODGE.length; st++) U['lodge' + st] = ART.spr['lodge' + st].c.toDataURL();
  U.player = meepleURL('player', 0);
  for (const r in ROLES) U[r] = meepleURL(r, 0);
  U.foreman = meepleURL('foreman', 0);
  for (let l = 1; l <= MAX_AXE; l++) U['axe' + l] = ART.axe[l].c.toDataURL();
  for (const h of HATS) U['hat_' + h.id] = meepleURL('player', 0, h.id);
  U.hats = meepleURL('player', 0, 'tophat');
  progress(1);
}
const spriteOf = b => b.type === 'lodge' ? ART.spr['lodge' + Math.min(S.lodgeStage, LODGE.length)] : ART.spr[b.type];
const apronOf = b => ART.spr['apron' + BUILD[b.type].w];
function ico(name, cls = '') { return `<img class="ico ${cls}" src="${ART.url[name] || ''}" alt="">`; }
;(window.__stage = window.__stage || []).push('art.js loaded');
