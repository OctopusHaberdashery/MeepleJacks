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
// hat pixels, relative to the Meeple's top-left; rows may sit above the head
const HATS = {
  hard:   { rows: ['....hhhh....', '...hHhhhh...', '..hHhhhhhh..', '.dddddddddd.'], dx: 1, dy: -2, map: c => ({ h: C(c), H: C(shade(c, 0.5)), d: C(shade(c, -0.25)) }) },
  beanie: { rows: ['.....ww.....', '....hhhh....', '...hHhhhh...', '...dddddd...'], dx: 1, dy: -2, map: c => ({ h: C(c), H: C(shade(c, 0.35)), d: C(shade(c, -0.3)), w: C('#f4f0e4') }) },
  straw:  { rows: ['....hHhh....', '...hHhhhh...', '...bbbbbb...', 'dhhHhhhhhhhd'], dx: 1, dy: -2, map: c => ({ h: C(c), H: C(shade(c, 0.4)), d: C(shade(c, -0.22)), b: C('#8a4a2a') }) },
};
function buildMeeple(o) {
  const frames = {};
  for (const fr of ['stand', 'walkA', 'walkB']) {
    const p = new Pix(18, 22), ox = 2, oy = 4;
    const f = (x, y) => y >= 0 && y < 16 && x >= 0 && x < 14 && MEEPLE_ROWS[y][x] === '#' && !(y === 15 && ((fr === 'walkA' && x < 7) || (fr === 'walkB' && x >= 7)));
    const base = C(o.body), lt = C(shade(o.body, 0.32)), dk = C(shade(o.body, -0.3)), md = C(shade(o.body, -0.14));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 14; x++) {
      if (!f(x, y)) continue;
      let c = base;
      if (x >= 9 || (y >= 13 && (x === 5 || x === 12))) c = md;
      if (!f(x + 1, y) || !f(x, y + 1)) c = dk;
      else if (!f(x, y - 1) || (!f(x - 1, y) && y < 13)) c = lt;
      if (o.plaid && y >= 5 && y <= 12 && c !== lt) { if ((((x + 1) >> 1) + (y >> 1)) & 1) c = C(shade(o.body, c === dk ? -0.55 : -0.42)); }
      if (o.straps && y >= 5 && y <= 11 && (x === 4 || x === 9)) c = C('#6a4426');
      p.set(ox + x, oy + y, c);
    }
    if (o.hat) { const h = HATS[o.hat]; p.rows(h.rows, h.map(o.hatCol), ox + h.dx, oy + h.dy); }
    p.outline(C(shade(o.body, -0.72)));
    frames[fr] = { c: p.toCanvas(), w: 18, h: 22, ax: 9, ay: 20 };
  }
  return frames;
}
const JACK_COLS = ['#c8382a', '#3f8a4a', '#d87a2a', '#2f8a8a', '#8a4fa8', '#9a6a3a'];
const HAUL_COLS = ['#3f6fc8', '#4f9fd8', '#6a5fc8', '#3fa8a0', '#7a8a9a', '#5a78a8'];

function buildAxe(lvl) {
  const steel = ['#9aa2aa', '#9aa2aa', '#aeb8c2', '#c2ccd6', '#d0d8e0', '#e0c060', '#b8e0e8', '#f0d068', '#c8a0f0'][lvl] || '#aeb8c2';
  const p = new Pix(11, 14);
  p.rows(['....hSS.', '....hSSL', '....hSSL', '....hSS.', '....h...', '....h...', '....h...', '....h...', '....h...', '....h...'],
    { h: C('#a06a38'), S: C(steel), L: C(shade(steel, 0.55)) }, 1, 1);
  p.set(5, 10, C('#7a4a26'));
  p.outline(C('#1c120c'));
  return { c: p.toCanvas(), w: 11, h: 14, ax: 5.5, ay: 11 };
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
function buildCabin() {
  const p = new Pix(60, 64), L = PAL('#6e4622', '#a06c38', '#c08a4e'), roof = PAL('#7a2a1e', '#a83c28', '#d06040');
  shadow(p, 28, 57, 26);
  // chimney
  for (let y = 3; y <= 18; y++) for (let x = 38; x <= 43; x++) {
    const m = (y % 3 === 0) || ((x + ((y / 3) | 0) * 2) % 4 === 0);
    p.set(x, y, m ? C('#5a5a5c') : x < 40 ? C('#a8a8a4') : C('#868684'));
  }
  p.rect(37, 2, 8, 2, C('#4a4a4e'));
  // log walls
  for (let y = 30; y <= 55; y++) for (let x = 6; x <= 49; x++) {
    const k = (y - 30) % 4; let c = k === 0 ? L[2] : k === 3 ? L[0] : L[1];
    if (hash2(x >> 2, y, 12) < 0.07 && k !== 3) c = L[0];
    if (y < 33) c = k === 3 ? C('#4a2e16') : L[0];         // shade under the eaves
    p.set(x, y, c);
  }
  for (let y = 30; y <= 53; y += 4) for (const x of [6, 47]) {  // round log ends at the corners
    p.rect(x, y, 3, 4, L[0]); p.rect(x, y, 3, 3, C('#d8a868')); p.set(x + 1, y + 1, C('#a87a42'));
  }
  for (let x = 6; x <= 49; x++) p.set(x, 55, (x >> 2) & 1 ? C('#8a8a86') : C('#6c6c6a'));
  for (let x = 6; x <= 49; x++) p.set(x, 54, (x >> 2) & 1 ? C('#a4a4a0') : C('#868684'));
  // roof
  shingles(p, 10, 31, 11, 44, 3, 52, roof);
  p.rect(10, 9, 36, 1, C('#5a1e16'));
  p.rect(3, 32, 50, 1, C('#4a1810'));
  // door
  p.rect(14, 38, 9, 17, C('#3c2412'));
  for (let y = 39; y <= 54; y++) for (let x = 15; x <= 21; x++) p.set(x, y, (x - 15) % 3 === 2 ? C('#5a3418') : y < 41 ? C('#6a4020') : C('#8a5428'));
  p.set(20, 47, C('#f6c83c')); p.set(20, 48, C('#c88418'));
  p.rect(13, 55, 11, 2, C('#9c9c98')); p.rect(13, 56, 11, 1, C('#74747a'));
  // window with warm light
  p.rect(29, 36, 12, 10, C('#4a2c16'));
  for (let y = 37; y <= 44; y++) for (let x = 30; x <= 39; x++) p.set(x, y, (x === 34 || x === 35 || y === 40) ? C('#5a3a1e') : (x + y) % 5 === 0 ? C('#fff2b0') : y < 40 ? C('#ffd86a') : C('#ffb840'));
  p.rect(28, 46, 14, 2, C('#7a4a26'));
  p.rows(['.r.gr.g.r.gr', 'gggggggggggg'], { r: C('#e8504a'), g: C('#4a9a42') }, 29, 44);
  // lantern by the door
  p.rect(25, 40, 2, 1, C('#3a3a3e')); p.rect(25, 41, 2, 3, C('#ffd86a')); p.set(25, 41, C('#fff2b0')); p.rect(25, 44, 2, 1, C('#3a3a3e'));
  p.outline(C('#1c120c'));
  return p.sprite(28, 57);
}
function buildYard() {
  const p = new Pix(96, 80), post = PAL('#5a3a1e', '#8a5c30', '#b07e46'), roof = PAL('#28486a', '#3a6a8e', '#6094b6');
  shadow(p, 47, 73, 44);
  // shed interior
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
  // roof sign: a log emblem
  p.rect(26, 15, 14, 10, C('#e8d4a0')); p.rect(26, 15, 14, 1, C('#fff4d0')); p.rect(26, 24, 14, 1, C('#b89c68'));
  logEnd(p, 30, 17, 2);
  // sales stall
  for (let y = 38; y <= 54; y++) for (let x = 64; x <= 85; x++) p.set(x, y, C('#2e221a'));
  for (const x of [62, 86]) for (let y = 34; y <= 70; y++) { p.set(x, y, post[2]); p.set(x + 1, y, post[0]); }
  for (let y = 27; y <= 38; y++) for (let x = 60; x <= 89; x++) {
    const st = ((x - 60) / 3 | 0) & 1; if (y === 38 && !st) continue;
    let c = st ? C('#f4e8c8') : C('#c8382a');
    if (y === 27) c = st ? C('#ffffff') : C('#e8604a'); if (y >= 36) c = st ? C('#d0c098') : C('#96241c');
    p.set(x, y, c);
  }
  for (let y = 52; y <= 70; y++) for (let x = 62; x <= 87; x++) {
    let c = y < 55 ? (y === 52 ? C('#f0c88c') : C('#d8a868')) : ((x - 62) % 6 === 5 ? C('#7a5028') : y > 68 ? C('#8a5c30') : C('#b07a42'));
    p.set(x, y, c);
  }
  p.rows(['.YY.', 'YWYy', 'YYYy', '.yy.'], { Y: C('#f6c83c'), W: C('#fff4b0'), y: C('#c88418') }, 73, 41);   // hanging coin
  p.set(74, 39, C('#3a3a3e')); p.set(74, 40, C('#3a3a3e'));
  p.rows(['YYY', 'yyy', 'YYY', 'yyy', 'YYY'], { Y: C('#f6c83c'), y: C('#c88418') }, 66, 47);
  p.rows(['.YYY', '.yyy', '.YYY'], { Y: C('#f6c83c'), y: C('#c88418') }, 69, 49);
  // chopping block out front
  p.rect(1, 68, 6, 4, BARK[2][1]); p.rect(1, 66, 6, 2, C('#c89858')); p.rect(1, 71, 6, 1, BARK[2][0]); p.set(3, 66, C('#9a7240'));
  p.outline(C('#1c120c'));
  return p.sprite(47, 73);
}
// where stock shows inside the shed, relative to the yard sprite's anchor (bottom rows first)
const YARD_SLOTS = [];
for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - (row & 1); i++) {
  YARD_SLOTS.push([-33 + i * 7 + (row & 1) * 3, -12 - row * 5]);
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
  bed: [['............', 'h...........', 'h.ww........', 'hwwwrrrrrrr.', 'hhhhhhhhhhhh', 'hBBBBBBBBBBh', 'h..........h', 'h..........h'],
    { h: '#7a4a26', w: '#f4f0e4', r: '#c8382a', B: '#a06a38' }],
};
function buildIcon(name) {
  const [rows, map] = ICONS[name], m = {};
  for (const k in map) m[k] = C(map[k]);
  const p = new Pix(rows[0].length + 2, rows.length + 2);
  p.rows(rows, m, 1, 1);
  if (name !== 'menu' && name !== 'target') p.outline(C('#3d2a1f'));
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
      ART.log[t] = buildLog(t, 11, 6); ART.carry[t] = buildLog(t, 8, 3);
      const e = new Pix(6, 6); logEnd(e, 0, 0, t); ART.end[t] = e.toCanvas();
    });
  }
  jobs.push(() => {
    for (let v = 0; v < 3; v++) ART.rock[v] = buildRock(v);
    ART.meeple.player = buildMeeple({ body: '#d8402e', hat: 'hard', hatCol: '#f6c83c' });
    JACK_COLS.forEach((c, i) => { ART.meeple['jack' + i] = buildMeeple({ body: c, plaid: true, hat: 'beanie', hatCol: i === 0 ? '#2f6a8a' : '#c8382a' }); });
    HAUL_COLS.forEach((c, i) => { ART.meeple['hauler' + i] = buildMeeple({ body: c, straps: true, hat: 'straw', hatCol: '#e8c860' }); });
    ART.axe = []; for (let l = 0; l <= MAX_AXE; l++) ART.axe[l] = buildAxe(l);
  });
  jobs.push(() => {
    ART.spr.cabin = buildCabin(); ART.spr.yard = buildYard();
    ART.spr.apronCabin = buildApron(64, 30); ART.spr.apronYard = buildApron(104, 44);
  });
  for (let i = 0; i < jobs.length; i++) { jobs[i](); if (i % 4 === 3) { progress((i + 1) / jobs.length); await yieldNow(); } }
  // data URLs for the DOM
  const U = ART.url;
  for (const k in ICONS) U[k] = buildIcon(k).toDataURL();
  for (let t = 0; t < NT; t++) { U['log' + t] = ART.log[t].c.toDataURL(); U['tree' + t] = ART.tree[t][0][2].c.toDataURL(); U['pile' + t] = ART.pile[t][6].c.toDataURL(); }
  U.cabin = ART.spr.cabin.c.toDataURL(); U.yard = ART.spr.yard.c.toDataURL();
  U.player = ART.meeple.player.stand.c.toDataURL(); U.jack = ART.meeple.jack0.stand.c.toDataURL(); U.hauler = ART.meeple.hauler0.stand.c.toDataURL();
  for (let l = 1; l <= MAX_AXE; l++) U['axe' + l] = ART.axe[l].c.toDataURL();
  for (let i = 0; i < 6; i++) { U['jack' + i] = ART.meeple['jack' + i].stand.c.toDataURL(); U['hauler' + i] = ART.meeple['hauler' + i].stand.c.toDataURL(); }
  progress(1);
}
function ico(name, cls = '') { return `<img class="ico ${cls}" src="${ART.url[name] || ''}" alt="">`; }
;(window.__stage = window.__stage || []).push('art.js loaded');
