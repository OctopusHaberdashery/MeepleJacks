// MeepleJacks — renderer. Up close the world is drawn at one canvas pixel per art pixel and the
// browser scales the canvas up with crisp edges. Zoomed far out, the forest comes from cached
// half- and quarter-size layers so the whole map stays cheap to draw.
'use strict';

const CH = 256;                                  // ground chunk size in art pixels (16 tiles)
const CT = CH / TS;                              // tiles per chunk
const MAPW = MW * TS, MAPH = MH * TS;
const R = window.R = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, k: 3, kT: 3, z: 3, q: 1, bw: 0, bh: 0,
  cam: { x: YARD_X, y: YARD_Y + 20 }, follow: true, anchor: null, pinching: false,
  chunks: new Map(), far: { 2: { g: new Map(), t: new Map() }, 4: { g: new Map(), t: new Map() } },
  frame: 0, t: 0, parts: [], floats: [], falls: [], marks: [],
  ghost: null, radiusOf: null, ready: false, fade: true, smokeT: 0, stockKey: '', stock: [],
  season: 0,       // the season the ground and trees are drawn in; follows SEA
};

R.init = function (cv) {
  R.cv = cv; R.ctx = cv.getContext('2d', { alpha: false });
  R.resize(); R.k = R.kT = R.defaultK();
  R.ready = true;
};
R.resize = function () {
  R.dpr = window.devicePixelRatio || 1;
  R.W = window.innerWidth; R.H = window.innerHeight;
  // k = device pixels per art pixel. Whole numbers keep art pixels even; below 1 the whole map can fit.
  R.kMin = clamp(Math.min(R.W * R.dpr / (MAPW + 64), R.H * R.dpr / (MAPH + 64)), 0.1, 1);
  R.kMax = Math.max(3, Math.floor(6 * R.dpr));
  R.k = clamp(R.k, R.kMin, R.kMax); R.kT = R.snapK(R.kT);
  R.bw = 0;
};
R.snapK = k => clamp(k >= 1 ? Math.round(k) : k, R.kMin, R.kMax);
R.defaultK = () => clamp(Math.round(R.dpr * (Math.min(R.W, R.H) < 520 ? 2 : 3)), 1, R.kMax);
R.layout = function () {
  const q = R.q = R.k >= 1 ? 1 : R.k >= 0.5 ? 2 : 4, z = R.z = R.k / R.dpr;
  const bw = Math.ceil(R.W / (z * q)) + 2, bh = Math.ceil(R.H / (z * q)) + 2;
  if (bw !== R.bw || bh !== R.bh) { R.bw = bw; R.bh = bh; R.cv.width = bw; R.cv.height = bh; }
  R.ctx.imageSmoothingEnabled = q > 1;
  const cw = bw * q * z + 'px', chh = bh * q * z + 'px', ir = q > 1 ? 'auto' : 'pixelated';
  if (R.cv.style.width !== cw) R.cv.style.width = cw;
  if (R.cv.style.height !== chh) R.cv.style.height = chh;
  if (R.cv.style.imageRendering !== ir) R.cv.style.imageRendering = ir;
};
R.screenToWorld = (sx, sy) => ({ x: R.cam.x + (sx - R.W / 2) / R.z, y: R.cam.y + (sy - R.H / 2) / R.z });
R.worldToScreen = (wx, wy) => ({ x: (wx - R.cam.x) * R.z + R.W / 2, y: (wy - R.cam.y) * R.z + R.H / 2 });
R.clampCam = function () {
  const hw = R.W / R.z / 2, hh = R.H / R.z / 2, m = 24;
  R.cam.x = MAPW + 2 * m < hw * 2 ? MAPW / 2 : clamp(R.cam.x, hw - m, MAPW - hw + m);
  R.cam.y = MAPH + 2 * m < hh * 2 ? MAPH / 2 : clamp(R.cam.y, hh - m, MAPH - hh + m);
};
// zoom by steps around a point on screen: whole pixel sizes up close, gentle steps far out
R.zoomBy = function (steps, sx, sy) {
  const w = R.screenToWorld(sx, sy);
  let k = R.kT;
  for (let n = Math.abs(steps); n > 0; n--) k = steps > 0 ? (k >= 1 ? Math.floor(k) + 1 : Math.min(1, k * 1.35)) : (k > 1 ? Math.ceil(k) - 1 : k / 1.35);
  R.kT = R.snapK(k);
  R.anchor = { sx, sy, wx: w.x, wy: w.y };
};
R.reset = function () {
  R.parts = []; R.floats = []; R.falls = []; R.marks = []; R.chunks.clear(); R.ghost = null; R.radiusOf = null; R.stockKey = '';
  for (const q of [2, 4]) { R.far[q].g.clear(); R.far[q].t.clear(); }
  R.season = S ? SEA : 0;
};
// the season has turned: everything cached is redrawn a little at a time, the old picture standing in until then
R.turnSeason = function (sn) {
  R.season = sn;
  for (const ch of R.chunks.values()) ch.stale = true;
  for (const q of [2, 4]) { for (const g of R.far[q].g.values()) g.stale = true; for (const e of R.far[q].t.values()) e.stale = true; }
};

// ---------------------------------------------------------------- ground
const GPAL = [
  PAL('#3f7a3a', '#4f8f42', '#62a34c', '#79b85a'),   // pine meadow
  PAL('#578c38', '#6ca042', '#84b64c', '#9fca5c'),   // birch glade
  PAL('#326e38', '#40823e', '#519646', '#67aa52'),   // oak wood
  PAL('#5a7632', '#6c8a38', '#82a042', '#9ab44e'),   // maple grove
  PAL('#48884e', '#589c5a', '#6cb066', '#86c676'),   // cherry orchard
  PAL('#2a563a', '#346640', '#407848', '#508a52'),   // redwood deep
  PAL('#243c44', '#2c4a4e', '#365a5a', '#446c66'),   // ebony dark
];
const DIRT = PAL('#7a5c3a', '#8e6e48', '#a28256', '#b6966a');
const WATER = PAL('#a6dce0', '#5aaccc', '#4290bc', '#3478aa');
const SAND = PAL('#b89c64', '#cdb47c');
// the same colours through the year: [spring, summer, autumn, winter]
function tintC(c, hex, f) {
  const [r, g, b] = hexRgb(hex), cr = c & 255, cg = (c >> 8) & 255, cb = (c >> 16) & 255;
  return (0xff000000 | (Math.round(cb + (b - cb) * f) << 16) | (Math.round(cg + (g - cg) * f) << 8) | Math.round(cr + (r - cr) * f)) >>> 0;
}
const SEASON_TINT = [['#a8e060', 0.1], null, ['#c09438', 0.3], ['#eef4fa', 0.8]];
const seasonPal = (pal, sn, k = 1) => SEASON_TINT[sn] ? pal.map(c => tintC(c, SEASON_TINT[sn][0], SEASON_TINT[sn][1] * k)) : pal;
const GPAL_S = [0, 1, 2, 3].map(sn => GPAL.map(pal => seasonPal(pal, sn)));
const DIRT_S = [0, 1, 2, 3].map(sn => seasonPal(DIRT, sn, sn === 3 ? 0.7 : 0.4));
const SAND_S = [0, 1, 2, 3].map(sn => seasonPal(SAND, sn, sn === 3 ? 0.8 : 0.3));
const WATER_S = [0, 1, 2, 3].map(sn => sn === 3 ? WATER.map(c => tintC(c, '#9ab8cc', 0.35)) : WATER);
// what a tree's leaves look like as they fly: null is the tree's own colour
const SEASON_COL = [[null, '#9ccc48', '#55a03c', '#e88424', null, null, null], [], [null, '#e8b828', '#b8642a', '#c42a18', '#b85a48', null, null], ['#eef4fa', '#eef4fa', '#eef4fa', '#eef4fa', '#eef4fa', '#eef4fa', '#eef4fa']];
const LITTER = [['#d8401c', '#f08c28'], ['#f08c28', '#fcc450'], ['#b8642a', '#e8b828']];
const FLOWERS = [['#ffffff', '#ffe060'], ['#ffe060', '#fff4b0'], ['#7aa8f0', '#c8dcff'], ['#f08c28', '#d8401c'], ['#f6b4c8', '#ffffff'], ['#8a5a34', '#6a4426'], ['#58e0d0', '#b8fff0']];

// q: art pixels per canvas pixel (1 up close; 2 or 4 for the far-zoom layers, which skip small details)
function genChunk(cx, cy, q = 1) {
  const n = CH / q, c = newCanvas(n, n), g = c.getContext('2d'), id = g.createImageData(n, n), d = new Uint32Array(id.data.buffer);
  const seed = S.seed, X0 = cx * CH, Y0 = cy * CH, G = 4, GN = CH / G + 1;
  const sn = R.season, GP = GPAL_S[sn], DT = DIRT_S[sn], WT = WATER_S[sn], SD = SAND_S[sn];
  // slow-changing fields sampled on a coarse grid, then interpolated
  const wg = new Float32Array(GN * GN), zg = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { wg[j * GN + i] = waterV(X0 + i * G, Y0 + j * G, seed); zg[j * GN + i] = zoneD(X0 + i * G, Y0 + j * G, seed); }
  const lerp2 = (a, x, y) => {
    const i = x >> 2, j = y >> 2, u = (x & 3) / 4, v = (y & 3) / 4, k = j * GN + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + GN] * (1 - u) + a[k + GN + 1] * u) * v;
  };
  const zoneAt = q === 1 ? new Uint8Array(n * n) : null, grass = q === 1 ? new Uint8Array(n * n) : null;
  for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
    const x = xx * q, y = yy * q, px = X0 + x, py = Y0 + y, bx = (px / q) | 0, by = (py / q) | 0, dd = lerp2(zg, x, y), wv = wetV(lerp2(wg, x, y), dd), o = yy * n + xx;
    let col;
    if (wv > 0) {
      if (wv < 0.006) col = WT[bayer(bx, by) < 0.7 ? 0 : 1];
      else if (wv < 0.03) col = WT[1];
      else if (wv < 0.075) col = WT[bayer(bx, by) < (wv - 0.03) / 0.045 ? 2 : 1];
      else col = WT[bayer(bx, by) < (wv - 0.075) / 0.06 ? 3 : 2];
      if (q === 1 && wv > 0.012 && hash2(px >> 2, py, seed + 50) < 0.03) col = WT[wv < 0.05 ? 0 : 1];
    } else if (wv > -0.014) col = SD[bayer(bx, by) < (wv + 0.014) / 0.014 ? 1 : 0];
    else {
      let r = ringOf(dd);
      if (r < NT - 1) { const toNext = RINGS[r + 1] - dd; if (toNext < 1.6 && bayer(bx, by) * 1.6 > toNext) r++; }
      const dYard = Math.hypot(px - YARD_X, py - (YARD_Y + 14)) / TS;
      let dirt = false;
      if (dYard < 8) dirt = 1 - dYard / 5.2 + (fbm(px / 34, py / 34, seed + 13, 2) - 0.5) * 0.55 > bayer(bx, by) * 0.16;
      if (dirt) col = ptone(DT, fbm(px / 20, py / 20, seed + 14, 2) * 1.5 - 0.25 + (hash2(px, py, seed + 15) - 0.5) * 0.3, bx, by);
      else {
        col = ptone(GP[r], fbm(px / 26, py / 26, seed + 31, 2) * 1.6 - 0.3, bx, by);
        if (q === 1) {
          const sp = hash2(px, py, seed + 33);
          if (sp < 0.02) col = GP[r][3]; else if (sp > 0.975) col = GP[r][0];
          grass[o] = 1; zoneAt[o] = r;
        }
        if (wv > -0.02) col = GP[r][0];       // damp edge beside the shore
      }
    }
    d[o] = col;
  }
  // little details, a few per tile
  if (q === 1) {
    const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < CH && y < CH && grass[y * CH + x]) d[y * CH + x] = c; };
    for (let ty = 0; ty < CT; ty++) for (let tx = 0; tx < CT; tx++) {
      const gx = cx * CT + tx, gy = cy * CT + ty;
      for (let k = 0; k < 2; k++) {
        const h = hash2(gx, gy, seed + 60 + k), x = tx * TS + 2 + ((hash2(gx, gy, seed + 62 + k) * 12) | 0), y = ty * TS + 3 + ((hash2(gx, gy, seed + 64 + k) * 11) | 0);
        if (!grass[y * CH + x]) continue;
        const r = zoneAt[y * CH + x], P4 = GP[r], F = sn === 2 ? LITTER[(gx + gy + k) % 3] : FLOWERS[r];
        if (sn === 3) {          // winter: a few tufts and twigs poking through the snow
          if (h < 0.16) { put(x, y, C('#8aa48a')); put(x + 1, y - 1, C('#8aa48a')); put(x + 2, y, C('#a8bcae')); }
          else if (h < 0.22) { put(x, y, C('#8a8c90')); put(x + 1, y, C('#6a6c74')); put(x, y - 1, C('#ffffff')); }
          else if (h < 0.3) { put(x, y, C('#ffffff')); put(x + 1, y, C('#ffffff')); put(x + 2, y + 1, C('#d4e2ee')); }
          continue;
        }
        if (h < 0.34) { put(x, y, P4[0]); put(x + 1, y - 1, P4[0]); put(x + 2, y, P4[0]); put(x + 1, y - 2, P4[3]); put(x + 3, y - 1, P4[3]); }
        else if (h < 0.40) { put(x, y, C('#8a8c90')); put(x + 1, y, C('#6a6c74')); put(x, y - 1, C('#b4b6b8')); }
        else if (r === 3 && h < 0.72) { put(x, y, C(F[0])); put(x + 1, y, C(F[1])); put(x + 3, y + 2, C(F[0])); put(x - 2, y + 1, C('#fcc450')); }
        else if (r === 4 && h < 0.74) { put(x, y, C(F[0])); put(x + 2, y + 1, C(F[1])); put(x - 1, y + 3, C(F[0])); put(x + 4, y - 1, C('#e486a8')); }
        else if (r === 5 && h < 0.62) {
          if (h < 0.5) { put(x, y, C(F[0])); put(x + 1, y, C(F[0])); put(x + 2, y + 1, C(F[1])); put(x - 1, y + 1, C(F[1])); }
          else for (let j = 0; j < 4; j++) { put(x + j, y - (j & 1), C('#5ca050')); put(x + j, y + 1 - (j & 1), C('#2c6a3a')); }
        }
        else if (r === 6 && h < 0.5) { put(x, y, C(F[0])); put(x + 1, y, C(F[1])); put(x, y + 1, C('#d8d0c0')); }
        else if (r < 3 && h < (sn === 0 ? 0.68 : sn === 2 ? 0.6 : 0.47)) { put(x, y, C(F[0])); put(x + 1, y, C(F[0])); put(x, y - 1, C(F[1])); put(x, y + 1, P4[0]); }
      }
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}
// what stands on one tile, drawn at its place (used by both the close view and the far-zoom layers)
function tileSprite(i) {
  const k = W.kind[i];
  if (!k) return W.ter[i] === TER.ROCK ? ART.rock[W.vr[i]] : null;
  const g = W.g[i];
  const T = ART.trees[R.season][k - 1][W.vr[i]];
  return g >= 1 ? T[2] : g < 0.12 ? ART.stump[k - 1] : T[g < 0.45 ? 0 : 1];
}
// every tree in and around one chunk, drawn small onto a see-through layer
function treeChunk(cx, cy, q, into) {
  const n = CH / q, c = into || newCanvas(n, n), g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, n, n);
  g.setTransform(1 / q, 0, 0, 1 / q, -cx * CH / q, -cy * CH / q);
  g.imageSmoothingEnabled = true;
  for (let ty = Math.max(0, cy * CT - 1); ty <= Math.min(MH - 1, cy * CT + CT + 6); ty++)
    for (let tx = Math.max(0, cx * CT - 3); tx <= Math.min(MW - 1, cx * CT + CT + 2); tx++) {
      const i = ty * MW + tx, s = tileSprite(i); if (!s) continue;
      if (W.kind[i]) g.drawImage(s.c, tx * TS + 8 + W.jx[i] - s.ax, ty * TS + 12 + W.jy[i] - s.ay);
      else g.drawImage(s.c, tx * TS + 8 - s.ax, ty * TS + 13 - s.ay);
    }
  return c;
}
// trees that changed since last frame make their far-zoom layers stale
function markDirty() {
  if (!W.dirty.length) return;
  if (R.far[2].t.size || R.far[4].t.size) for (const i of W.dirty) {
    const x = i % MW, y = (i / MW) | 0;
    for (let cy = Math.max(0, Math.floor((y - 7) / CT)); cy <= Math.floor((y + 1) / CT); cy++)
      for (let cx = Math.max(0, Math.floor((x - 3) / CT)); cx <= Math.floor((x + 3) / CT); cx++)
        for (const q of [2, 4]) { const e = R.far[q].t.get(cy * 64 + cx); if (e) e.stale = true; }
  }
  W.dirty.length = 0;
}

// ---------------------------------------------------------------- events from the sim
function addPart(p) { if (R.q === 1 && R.parts.length < 460) R.parts.push(Object.assign({ life: 0, max: 1, vx: 0, vy: 0, g: 0, sz: 1 }, p)); }
function hearing(x, y, me) {
  const d = Math.hypot(x - R.cam.x, y - R.cam.y), reach = Math.min(900, Math.max(R.W, R.H) / R.z * 0.7);
  return Math.max(me ? 0.85 : 0, clamp(1.15 - d / reach, 0, 1));
}
const leafCols = t => { const c = SEASON_COL[R.season][t] || TREES[t].col; return [shade(c, -0.25), c, shade(c, 0.3)]; };
function burst(x, y, cols, n, spread = 30) {
  for (let i = 0; i < n; i++) addPart({ x: x + (Math.random() - 0.5) * spread, y: y - Math.random() * 12, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 40, g: 70, max: 1 + Math.random() * 0.6, col: cols[i % cols.length], sz: i % 3 === 0 ? 2 : 1 });
}
R.onEvent = function (e) {
  const vol = e.x != null ? hearing(e.x, e.y, e.me) : 1, seen = vol > 0.05;
  switch (e.t) {
    case 'chop': {
      AUDIO.sfx('chop', vol, e.k - 1);
      if (!seen) break;
      const wood = TREES[e.k - 1].wood, lc = leafCols(e.k - 1), h = ART.tree[e.k - 1][0][2].h;
      for (let i = 0; i < 4; i++) addPart({ x: e.x + e.side * 2, y: e.y - 5, vx: e.side * (12 + Math.random() * 28), vy: -20 - Math.random() * 30, g: 160, max: 0.5, col: i & 1 ? wood : shade(wood, -0.25) });
      const wide = e.anc ? 44 : 14, tall = e.anc ? h * 1.8 : h;
      for (let i = 0; i < (e.anc ? 3 : 2); i++) addPart({ x: e.x + (Math.random() - 0.5) * wide, y: e.y - tall * (0.5 + Math.random() * 0.3), vx: (Math.random() - 0.5) * 14, vy: 8, g: 26, max: e.anc ? 2.2 : 1.2, col: lc[(Math.random() * 3) | 0], sway: 1 });
      break;
    }
    case 'fall':
      AUDIO.sfx('fall', vol, e.k - 1);
      if (e.anc != null) { R.falls.push({ x: e.x, y: e.y, k: e.k, anc: e.anc, dir: e.dir, t: 0, dur: 1.5 }); AUDIO.sfx('fall', 1, e.k - 1); break; }
      if (R.q === 1 && seen) R.falls.push({ x: e.x, y: e.y, k: e.k, v: e.v, dir: e.dir, t: 0, dur: 0.75 });
      break;
    case 'bridge': AUDIO.sfx('build'); burst(e.x, e.y, ['#dca868', '#a06c38', '#ffffff'], 40, 70); break;
    case 'ancient': burst(e.x, e.y - 40, ['#ffe060', '#ffffff', '#8ad070', '#f6c83c'], 80, 90); break;
    case 'skill': if (seen) { burst(e.x, e.y - 14, ['#ffe060', '#ffffff'], 8, 8); if (R.q === 1) R.floats.push({ x: e.x, y: e.y - 26, txt: '+', col: '#ffe060', t: 0 }); } break;
    case 'pick': AUDIO.sfx('pick', vol); break;
    case 'deposit':
      AUDIO.sfx(e.coins ? 'coin' : 'drop', vol);
      if (seen && R.q === 1) R.floats.push({ x: e.x, y: e.y - 24, txt: '+' + (e.coins || e.n), col: e.coins ? '#ffd84a' : '#f4e8c8', t: 0 });
      break;
    case 'build': AUDIO.sfx('build'); burst(e.x, e.y, ['#d8c8a0', '#a28256'], 26, 50); break;
    case 'hire': AUDIO.sfx('hire'); burst(e.x, e.y - 8, ['#fff4b0', '#f6c83c'], 12, 12); break;
    case 'plant':
      AUDIO.sfx('plant', vol);
      if (seen) for (let i = 0; i < 6; i++) addPart({ x: e.x + (Math.random() - 0.5) * 8, y: e.y - 2, vx: (Math.random() - 0.5) * 16, vy: -24 - Math.random() * 16, g: 60, max: 0.7, col: i & 1 ? '#8ad070' : '#a28256' });
      break;
    case 'work':
      if (!seen) break;
      if (e.role === 'sawyer') { AUDIO.sfx('saw', vol); for (let i = 0; i < 4; i++) addPart({ x: e.x - 8 + Math.random() * 4, y: e.y - 12, vx: -8 - Math.random() * 20, vy: -10 - Math.random() * 20, g: 90, max: 0.6, col: i & 1 ? '#f0d890' : '#d8b860' }); }
      else if (e.role === 'collier') { AUDIO.sfx('crackle', vol); for (let i = 0; i < 3; i++) addPart({ x: e.x - 3 + Math.random() * 6, y: e.y - 6, vx: (Math.random() - 0.5) * 12, vy: -22 - Math.random() * 14, max: 0.8, col: i & 1 ? '#ffd84a' : '#f07a1a' }); }
      else { AUDIO.sfx('tap', vol); for (let i = 0; i < 2; i++) addPart({ x: e.wx, y: e.wy - 8, vx: (Math.random() - 0.5) * 30, vy: -24, g: 120, max: 0.4, col: '#e8b078' }); }
      break;
    case 'hat': burst(e.x, e.y - 20, ['#e8508a', '#f6c83c', '#58e0d0', '#ffffff'], 30, 20); break;
    case 'lodgeStep': burst(e.x, e.y - 20, ['#f6c83c', '#ffffff', '#8ad070'], 24, 60); break;
    case 'lodge': burst(e.x, e.y - 30, ['#e8508a', '#f6c83c', '#58e0d0', '#ffffff', '#8ad070'], 70, 80); break;
  }
};

// ---------------------------------------------------------------- drawing
// each Meeple has its own silly way of getting about
function gaitPose(g, t, o) {
  switch (g) {
    case 0: o.rot = Math.sin(t * 11) * 0.32; o.bob = -Math.abs(Math.sin(t * 11)); break;                          // waddle
    case 1: o.bob = -Math.abs(Math.sin(t * 7)) * 6; o.legs = false; break;                                        // bunny hop
    case 2: o.flip = true; o.rot = 0.16; break;                                                                    // moonwalk
    case 3: o.rot = t * 8; o.legs = false; break;                                                                  // cartwheel
    case 4: o.bob = -Math.abs(Math.sin(t * 8)) * 3.5; o.rot = Math.sin(t * 8) * 0.18; break;                      // skip
    case 5: o.xo = Math.sin(t * 13) * 2; o.rot = Math.cos(t * 13) * 0.26; break;                                  // wobble
    case 6: o.rot = 0.38; o.bob = (Math.floor(t * 16) & 1) ? -1 : 0; break;                                       // sneak
    case 7: { const s = Math.floor(t * 7) & 1; o.bob = s ? -2 : 0; o.rot = s ? 0.15 : -0.15; break; }             // march
    case 8: o.rot = 0.62; o.bob = -Math.abs(Math.sin(t * 18)) * 2; break;                                         // zoomies
    case 9: o.bob = -5 + Math.sin(t * 4) * 1.5; o.rot = Math.sin(t * 2.5) * 0.12; o.legs = false; break;          // float
    case 10: o.xo = (Math.floor(t * 22) & 1) ? 1 : -1; o.bob = (Math.floor(t * 11) & 1) ? -1 : 0; break;          // shimmy
    default: { const ph = (t * 1.5) % 1; o.bob = -Math.sin(ph * Math.PI) * 8; o.rot = -ph * 6.283; o.legs = false; }  // backflips
  }
}
const POSE = { rot: 0, bob: 0, xo: 0, legs: true, flip: false };
function drawMeeple(ctx, e, role, col, hat, gait, axeLv, swingT) {
  const fr = meepleFor(role, col, hat), o = POSE;
  o.rot = 0; o.bob = 0; o.xo = 0; o.legs = true; o.flip = false;
  let f = fr.stand, face = e.face < 0 ? -1 : 1, x = Math.round(e.x);
  const y = Math.round(e.y), chopping = e.st === 'chop' || e.st === 'chopAnc';
  if (e.moving) {
    gaitPose(gait, e.walkT, o);
    if (o.legs) { const ph = Math.floor(e.walkT * 9) & 3; f = ph === 1 ? fr.walkA : ph === 3 ? fr.walkB : fr.stand; }
    if (o.flip) face = -face;
  } else if (e.st === 'work') o.bob = Math.sin(R.t * 12 + e.x) > 0 ? -1 : 0;
  else if (e.st === 'plant') { o.rot = 0.45; o.bob = Math.sin(R.t * 10) > 0 ? 1 : 0; }
  ctx.fillStyle = 'rgba(10,26,16,0.3)'; ctx.fillRect(x - 5, y - 1, 10, 2); ctx.fillRect(x - 4, y + 1, 8, 1);
  let ang = -0.5;
  if (chopping) {
    const p = 1 - clamp(e.swing / swingT, 0, 1);       // 0 just after a hit, 1 at the next
    if (p < 0.18) { ang = 1.35; x += face; }
    else if (p < 0.68) { const u = (p - 0.18) / 0.5; ang = 1.35 - 2.6 * (u * u * (3 - 2 * u)); }
    else { const u = (p - 0.68) / 0.32; ang = -1.25 + 2.6 * u * u; if (u > 0.6) x += face; }
  }
  const carting = role === 'carter';
  if (carting) {      // the cart trails behind
    const cx = x - face * 13, c = ART.cart;
    if (face < 0) { ctx.save(); ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.drawImage(c.c, -c.ax, y + 1 - c.ay); ctx.restore(); } else ctx.drawImage(c.c, cx - c.ax, y + 1 - c.ay);
    for (let j = 0; j < Math.min(3, Math.ceil(e.carry.length / 8)); j++) ctx.drawImage(ART.end[e.carry[j * 8] % NT], cx - 6 + j * 4 - (face < 0 ? 2 : 0), y - 11 - (j === 1 ? 3 : 0));
  }
  ctx.save();
  ctx.translate(x + Math.round(o.xo), y - 9 + Math.round(o.bob)); ctx.scale(face, 1);
  if (o.rot) ctx.rotate(o.rot);
  ctx.drawImage(f.c, -f.ax, -f.ay + 9);
  if (e.carry && e.carry.length && !carting) {
    const n = Math.min(e.carry.length, 4);
    for (let j = 0; j < n; j++) { const s = ART.carry[e.carry[j]]; ctx.drawImage(s.c, -s.ax, -11 - j * 3 - s.ay); }
  } else if (axeLv) {
    const a = ART.axe[axeLv];
    ctx.translate(chopping ? 4 : -4, 1); ctx.rotate(ang);
    ctx.drawImage(a.c, -a.ax, -a.ay);
  }
  ctx.restore();
  if (e.carry && e.carry.length > 4 && !carting && R.q === 1) drawNum(ctx, '' + e.carry.length, x + 10, y - 34, '#fff4d0');
}
function stockList(counts, slots) {
  const total = counts.reduce((a, v) => a + v, 0), shown = Math.min(slots, total), out = [];
  for (let j = 0; j < shown; j++) {
    let target = (j + 0.5) / shown * total, t = 0;
    while (t < NT - 1 && target >= counts[t]) { target -= counts[t]; t++; }
    out.push(t);
  }
  return out;
}
function drawBuilding(ctx, b) {
  const base = bBase(b), s = spriteOf(b), bx = Math.round(base.x), by = Math.round(base.y - 2);
  drawSpr(ctx, s, bx, by);
  if (b.type === 'yard') {
    const logs = S.inv.slice(0, NT), key = logs.join(',');
    if (key !== R.stockKey) { R.stockKey = key; R.stock = stockList(logs, YARD_SLOTS.length); }
    for (let j = 0; j < R.stock.length; j++) ctx.drawImage(ART.end[R.stock[j]], bx + YARD_SLOTS[j][0], by + YARD_SLOTS[j][1]);
  } else if (b.type === 'depot') {
    const st = stockList(b.store.slice(0, NT).map(n => Math.ceil(n / 8)), DEPOT_SLOTS.length);
    for (let j = 0; j < st.length; j++) ctx.drawImage(ART.end[st[j]], bx + DEPOT_SLOTS[j][0], by + DEPOT_SLOTS[j][1]);
  }
  if (b.wood >= 0 && R.q === 1) {      // a little pennant showing the wood this building works with
    const px = bx + BUILD[b.type].w * 8 - 4, py = by - s.h + 12;
    ctx.fillStyle = '#1c120c'; ctx.fillRect(px - 1, py - 1, 3, 15); ctx.fillStyle = '#b88c54'; ctx.fillRect(px, py, 1, 13);
    ctx.fillStyle = '#1c120c'; ctx.fillRect(px + 1, py - 1, 9, 9); ctx.fillStyle = '#f4e8c8'; ctx.fillRect(px + 2, py, 7, 7);
    ctx.drawImage(ART.end[b.wood], px + 2, py);
  }
}
function drawFall(ctx, f) {
  const s = f.anc != null ? ART.anc[f.anc][R.season] : ART.trees[R.season][f.k - 1][f.v][2], u = clamp(f.t / f.dur, 0, 1);
  ctx.save();
  ctx.globalAlpha = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
  ctx.translate(Math.round(f.x), Math.round(f.y)); ctx.rotate(f.dir * Math.pow(u, 2.2) * 1.5);
  ctx.drawImage(s.c, -s.ax, -s.ay);
  ctx.restore();
}
function drawAncient(ctx, r) {
  const A = W.anc[r], P = S.player;
  if (S.anc[r].done) {
    if (R.falls.some(f => f.anc === r)) return;         // still toppling
    drawSpr(ctx, ART.ancStump[r], A.x, A.y); return;
  }
  const s = ART.anc[r][R.season], sh = W.ancShake[r] > 0 ? Math.round(Math.sin(W.ancShake[r] * 60) * W.ancShake[r] * 7) : 0;
  const hide = R.fade && UI.inGame && R.q === 1 && A.y > P.y + 1 && P.y > A.y - s.h + 8 && Math.abs(P.x - A.x) < s.w / 2 - 1;
  if (hide) ctx.globalAlpha = 0.4;
  ctx.drawImage(s.c, A.x + sh - s.ax, A.y - s.ay);
  ctx.globalAlpha = 1;
}
function ring(ctx, x, y, r, col, phase, sz = 1) {
  ctx.fillStyle = col;
  const n = Math.floor(r * 6.283 / (5 * sz));
  for (let i = 0; i < n; i++) { const a = (i + phase) / n * 6.283; ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.98), 2 * sz, sz); }
}
const crewHat = () => S.crewHat || null;
function drawEnt(ctx, e) {
  if (e.b) drawBuilding(ctx, e.b);
  else if (e.p) drawSpr(ctx, ART.pile[e.p.type][Math.min(6, e.p.n)], e.x, e.y);
  else if (e.w) { const w = e.w, boss = W.bById.get(w.home); drawMeeple(ctx, w, w.role, w.col, crewHat(), w.gait, w.role === 'jack' ? S.crewAxe : 0, CREW_SWING / (boss && boss.foreman ? 1.3 : 1)); }
  else if (e.me) drawMeeple(ctx, e.me, 'player', 0, S.hat, S.gait, S.axe, PLAYER_SWING);
  else if (e.boss) drawMeeple(ctx, e.boss, 'foreman', 0, null, 0, 0, 1);
  else if (e.f) drawFall(ctx, e.f);
  else if (e.rail) { const a = bridgeArt(e.rail).rail; ctx.drawImage(a.c, e.rail.x * TS - a.ax, e.rail.y * TS - a.ay); }
  else if (e.anc != null) drawAncient(ctx, e.anc);
  else if (e.ghost && e.ghost.bridge) {
    const b = e.ghost.bridge, a = bridgeArt(b).deck;
    ctx.fillStyle = b.ok ? 'rgba(120,255,120,0.35)' : 'rgba(255,80,60,0.45)';
    ctx.fillRect(b.x * TS - 2, b.y * TS - 2, b.w * TS + 4, b.h * TS + 4);
    ctx.globalAlpha = 0.85; ctx.drawImage(a.c, b.x * TS - a.ax, b.y * TS - a.ay); ctx.globalAlpha = 1;
  }
  else if (e.ghost) {
    const gh = e.ghost, B = BUILD[gh.type], s = gh.type === 'lodge' ? ART.spr['lodge' + Math.min(S.lodgeStage, LODGE.length)] : ART.spr[gh.type];
    ctx.fillStyle = gh.ok ? 'rgba(120,255,120,0.35)' : 'rgba(255,80,60,0.45)';
    ctx.fillRect(gh.tx * TS, gh.ty * TS, B.w * TS, B.h * TS);
    ctx.globalAlpha = 0.8; drawSpr(ctx, s, (gh.tx + B.w / 2) * TS, (gh.ty + B.h) * TS - 2); ctx.globalAlpha = 1;
  }
}

R.draw = function (dt) {
  R.t += dt; R.frame++;
  const P = S.player;
  if (SEA !== R.season) R.turnSeason(SEA);
  // ease zoom to its target, holding the anchor point still
  if (!R.pinching && R.k !== R.kT) {
    const d = R.kT - R.k;
    R.k = Math.abs(d) < 0.02 * Math.max(0.3, R.kT) ? R.kT : R.k + d * Math.min(1, dt * 16);
    R.z = R.k / R.dpr;
    if (R.anchor) { R.cam.x = R.anchor.wx - (R.anchor.sx - R.W / 2) / R.z; R.cam.y = R.anchor.wy - (R.anchor.sy - R.H / 2) / R.z; }
    if (R.k === R.kT) R.anchor = null;
  }
  R.layout();
  if (R.follow && UI.inGame && !R.anchor) {
    const f = Math.min(1, dt * 5);
    R.cam.x += (P.x - R.cam.x) * f; R.cam.y += (P.y - 10 - R.cam.y) * f;
  }
  R.clampCam();
  markDirty();
  const q = R.q, z = R.z, vw = R.W / z, vh = R.H / z, lx = R.cam.x - vw / 2, ly = R.cam.y - vh / 2;
  const ox = Math.floor(lx / q) * q, oy = Math.floor(ly / q) * q;       // top-left of the canvas, in art pixels
  const fx = (lx - ox) * z, fy = (ly - oy) * z;
  R.cv.style.transform = q === 1 ? `translate3d(${-Math.round(fx * R.dpr) / R.dpr}px,${-Math.round(fy * R.dpr) / R.dpr}px,0)` : `translate3d(${-fx}px,${-fy}px,0)`;
  const ctx = R.ctx, bw = R.bw * q, bh = R.bh * q;                      // canvas size in art pixels
  ctx.setTransform(1 / q, 0, 0, 1 / q, -ox / q, -oy / q);
  ctx.fillStyle = '#14281c'; ctx.fillRect(ox, oy, bw, bh);

  const c0x = Math.max(0, Math.floor(ox / CH)), c1x = Math.min(MAPW / CH - 1, Math.floor((ox + bw) / CH));
  const c0y = Math.max(0, Math.floor(oy / CH)), c1y = Math.min(MAPH / CH - 1, Math.floor((oy + bh) / CH));
  const inX = x => x > ox - 60 && x < ox + bw + 60, inY = y => y > oy - 20 && y < oy + bh + 110;

  // ---- ground
  if (q === 1) {
    let budget = R.chunks.size < 4 ? 30 : 2;
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const key = cy * 64 + cx; let ch = R.chunks.get(key);
      if (!ch || ch.stale) {
        if (budget-- > 0) { ch = { c: genChunk(cx, cy), used: 0 }; R.chunks.set(key, ch); }
        else if (!ch) { ctx.fillStyle = '#3f7a3a'; ctx.fillRect(cx * CH, cy * CH, CH, CH); continue; }
      }
      ch.used = R.frame; ctx.drawImage(ch.c, cx * CH, cy * CH);
    }
    if (R.chunks.size > 72) { let old = null, ok = 0; for (const [k, c] of R.chunks) if (!old || c.used < old.used) { old = c; ok = k; } R.chunks.delete(ok); }
  } else {
    const far = R.far[q]; let budget = q === 2 ? 5 : 16;
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const key = cy * 64 + cx; let g = far.g.get(key);
      if (!g || g.stale) {
        if (budget-- > 0) { g = { c: genChunk(cx, cy, q), stale: false }; far.g.set(key, g); }
        else if (!g) { ctx.fillStyle = '#3f7a3a'; ctx.fillRect(cx * CH, cy * CH, CH, CH); continue; }
      }
      ctx.drawImage(g.c, cx * CH, cy * CH, CH, CH);
    }
  }

  // ---- ground decals
  const seeRect = (x, y, w, h) => x < ox + bw + 8 && x + w > ox - 8 && y < oy + bh + 8 && y + h > oy - 8;
  for (const b of S.bridges) if (seeRect(b.x * TS, b.y * TS, b.w * TS, b.h * TS)) { const a = bridgeArt(b).deck; ctx.drawImage(a.c, b.x * TS - a.ax, b.y * TS - a.ay); }
  for (const b of S.buildings) { const base = bBase(b); if (inX(base.x) && inY(base.y)) drawSpr(ctx, apronOf(b), base.x, base.y - 6); }
  for (let i = R.marks.length - 1; i >= 0; i--) {
    const m = R.marks[i]; m.t += dt;
    if (m.t > 0.5) { R.marks.splice(i, 1); continue; }
    ring(ctx, m.x, m.y, 2 + m.t * 16, `rgba(255,255,255,${0.9 - m.t * 1.8})`, 0);
  }
  if ((P.st === 'toTree' || P.st === 'chop') && UI.inGame && isMature(P.target) && q === 1) {
    const t = treeXY(P.target), a = Math.round(Math.sin(R.t * 6));
    ctx.fillStyle = '#fff8d0';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const bx = t.x + sx * (9 + a), by = t.y + 1 + sy * 4;
      ctx.fillRect(sx < 0 ? bx : bx - 2, by, 3, 1); ctx.fillRect(bx, sy < 0 ? by : by - 1, 1, 2);
    }
  }

  // ---- everything standing on the ground
  const ents = [];
  for (const b of S.buildings) {
    const base = bBase(b); if (!inX(base.x) || !inY(base.y)) continue;
    ents.push({ y: base.y - 1, b });
    if (b.foreman) { const d = bDoor(b); ents.push({ y: d.y + 3, boss: { x: d.x + 15, y: d.y + 3, face: -1, moving: false, st: 'idle', carry: null } }); }
  }
  if (q < 4) for (const p of S.piles) { if (p.t > 0.25) continue; const t = pileXY(p); if (inX(t.x) && inY(t.y)) ents.push({ y: t.y, p, x: t.x }); }
  for (const w of S.workers) if (inX(w.x) && inY(w.y)) ents.push({ y: w.y, w });
  if (UI.inGame && inX(P.x) && inY(P.y)) ents.push({ y: P.y, me: P });
  for (const f of R.falls) ents.push({ y: f.y + 0.5, f });
  for (const b of S.bridges) if (!b.v && seeRect(b.x * TS, b.y * TS, b.w * TS, b.h * TS)) ents.push({ y: (b.y + b.h) * TS - 3, rail: b });
  for (let r = 0; r < NT; r++) { const A = W.anc[r]; if (A.x > ox - 100 && A.x < ox + bw + 100 && A.y > oy - 20 && A.y < oy + bh + 240) ents.push({ y: A.y, anc: r }); }
  if (R.ghost) ents.push({ y: R.ghost.bridge ? (R.ghost.bridge.y + R.ghost.bridge.h) * TS + 4 : (R.ghost.ty + BUILD[R.ghost.type].h) * TS - 1, ghost: R.ghost });
  ents.sort((a, b) => a.y - b.y);

  if (q === 1) {
    // up close: trees and everything else interleaved row by row, back to front
    let ei = 0;
    const tx0 = Math.max(0, Math.floor(ox / TS) - 2), tx1 = Math.min(MW - 1, Math.floor((ox + bw) / TS) + 2);
    const ty0 = Math.max(0, Math.floor(oy / TS) - 1), ty1 = Math.min(MH - 1, Math.floor((oy + bh) / TS) + 6);
    const fade = R.fade && UI.inGame;
    for (let ty = ty0; ty <= ty1; ty++) {
      const lim = ty * TS + 9;
      while (ei < ents.length && ents[ei].y < lim) drawEnt(ctx, ents[ei++]);
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * MW + tx, k = W.kind[i];
        if (!k) { if (W.ter[i] === TER.ROCK) drawSpr(ctx, ART.rock[W.vr[i]], tx * TS + 8, ty * TS + 13); continue; }
        const s = tileSprite(i); let x = tx * TS + 8 + W.jx[i]; const y = ty * TS + 12 + W.jy[i];
        if (W.g[i] >= 1) {
          const sh = W.shake.get(i); if (sh) x += Math.round(Math.sin(sh * 60) * sh * 8);
          if (fade && y > P.y + 1 && P.y > y - s.h + 8 && Math.abs(P.x - x) < s.w / 2 - 1) { ctx.globalAlpha = 0.38; ctx.drawImage(s.c, x - s.ax, y - s.ay); ctx.globalAlpha = 1; continue; }
        }
        ctx.drawImage(s.c, x - s.ax, y - s.ay);
      }
    }
    while (ei < ents.length) drawEnt(ctx, ents[ei++]);
  } else {
    // far out: the forest comes from cached layers, with buildings and Meeples on top
    const far = R.far[q]; let budget = q === 2 ? 6 : 16;
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const key = cy * 64 + cx; let e = far.t.get(key);
      if (!e || e.stale) {
        if (budget-- > 0) { e = { c: treeChunk(cx, cy, q, e && e.c), stale: false }; far.t.set(key, e); }
        else if (!e) continue;
      }
      ctx.drawImage(e.c, cx * CH, cy * CH, CH, CH);
    }
    for (const e of ents) drawEnt(ctx, e);
  }
  if (R.radiusOf) { const b = R.radiusOf; ring(ctx, (b.x + BUILD[b.type].w / 2) * TS, (b.y + 1) * TS, 22 + Math.sin(R.t * 4) * 2 + BUILD[b.type].w * 8, 'rgba(255,248,208,0.9)', R.t * 3, q); }

  for (let i = R.falls.length - 1; i >= 0; i--) {
    const f = R.falls[i]; f.t += dt;
    if (f.t >= f.dur) {
      R.falls.splice(i, 1);
      const lc = leafCols(f.k - 1), h = f.anc != null ? ART.anc[f.anc][1].h : ART.tree[f.k - 1][f.v][2].h;
      for (let n = 0; n < (f.anc != null ? 60 : 16); n++) { const u = 0.3 + Math.random() * 0.7; addPart({ x: f.x + f.dir * h * u, y: f.y - 2, vx: (Math.random() - 0.5) * 40, vy: -18 - Math.random() * 30, g: 70, max: 0.9, col: n % 4 === 0 ? '#c8b890' : lc[n % 3], sz: n % 5 === 0 ? 2 : 1 }); }
    }
  }
  if (q > 1) { R.parts.length = 0; R.floats.length = 0; return; }

  // ---- chop progress bars, queue numbers
  for (const [i, hp] of W.hp) {
    const k = W.kind[i]; if (!k) continue;
    const t = treeXY(i), s = ART.tree[k - 1][W.vr[i]][2], x = t.x - 7, y = t.y - s.h - 5, f = clamp(1 - hp / TREES[k - 1].hp, 0, 1);
    ctx.fillStyle = '#1c120c'; ctx.fillRect(x - 1, y - 1, 16, 4);
    ctx.fillStyle = '#5a3a26'; ctx.fillRect(x, y, 14, 2);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, y, Math.round(14 * f), 2);
  }
  for (let r = 0; r < NT; r++) {
    const a = S.anc[r]; if (a.done || a.hp >= ANCIENT_HP[r]) continue;
    const A = W.anc[r], x = A.x - 16, y = A.y - ART.anc[r][1].h - 8, f = clamp(1 - a.hp / ANCIENT_HP[r], 0, 1);
    ctx.fillStyle = '#1c120c'; ctx.fillRect(x - 1, y - 1, 34, 5);
    ctx.fillStyle = '#5a3a26'; ctx.fillRect(x, y, 32, 3);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, y, Math.round(32 * f), 3);
  }
  if (UI.inGame) P.queue.forEach((i, n) => { if (!isMature(i)) return; const t = treeXY(i), s = ART.tree[W.kind[i] - 1][W.vr[i]][2]; drawNum(ctx, '' + (n + 1), t.x + 1, t.y - s.h - 8 + Math.round(Math.sin(R.t * 5 + n)), '#ffd84a'); });

  // ---- chimney smoke and drifting bits of forest
  R.smokeT -= dt;
  if (R.smokeT <= 0) {
    R.smokeT = 0.45;
    for (const b of S.buildings) {
      const base = bBase(b); if (!inX(base.x) || !inY(base.y)) continue;
      if (b.type === 'cabin') addPart({ x: base.x + 12, y: base.y - 57, vx: 3 + Math.random() * 4, vy: -9, max: 2.4, col: '#d8d8d4', sz: 2, smoke: 1 });
      else if (b.type === 'workshop') addPart({ x: base.x - 14, y: base.y - 58, vx: 3 + Math.random() * 4, vy: -9, max: 2.4, col: '#d8d8d4', sz: 2, smoke: 1 });
      else if (b.type === 'kiln' && S.workers.some(w => w.home === b.id && w.st === 'work')) for (let n = 0; n < 2; n++) addPart({ x: base.x - 1 + Math.random() * 4, y: base.y - 38, vx: 2 + Math.random() * 5, vy: -11, max: 2.8, col: n ? '#6a6a70' : '#3a3a40', sz: 2, smoke: 1 });
    }
    for (let r = 0; r < NT; r++) {         // a glimmer about every Ancient tree still standing
      const A = W.anc[r]; if (S.anc[r].done || !inX(A.x) || A.y < oy || A.y > oy + bh + 200) continue;
      const sp = ART.anc[r][1];
      addPart({ x: A.x + (Math.random() - 0.5) * sp.w * 0.8, y: A.y - Math.random() * sp.h * 0.9, vy: -5, max: 2.4, col: Math.random() < 0.5 ? '#ffe890' : '#ffffff', blink: 1 });
    }
    const sn = R.season;
    for (let n = 0; n < (sn === 3 ? 8 : 3); n++) {
      const x = ox + Math.random() * bw, y = oy + Math.random() * bh, tx = Math.floor(x / TS), ty = Math.floor(y / TS);
      if (!inMap(tx, ty)) continue;
      if (sn === 3) { addPart({ x, y, vx: 3 + Math.random() * 5, vy: 12 + Math.random() * 8, max: 3.2, col: Math.random() < 0.7 ? '#ffffff' : '#d4e2ee', sway: 1, sz: Math.random() < 0.25 ? 2 : 1 }); continue; }
      if (W.ter[idx(tx, ty)] === TER.WATER) { addPart({ x, y, max: 0.5, col: '#ffffff' }); continue; }
      const r = ringOf(zoneD(x, y, S.seed));
      if (sn === 2 && r >= 1 && r <= 4) { const c = SEASON_COL[2][r]; addPart({ x, y, vx: 5 + Math.random() * 4, vy: 9, max: 3, col: Math.random() < 0.5 ? c : shade(c, 0.3), sway: 1 }); continue; }
      if (sn === 0 && Math.random() < 0.45) { addPart({ x, y, vx: 6, vy: 6, max: 3.2, col: Math.random() < 0.5 ? '#f6b4c8' : '#ffffff', sway: 1 }); continue; }
      if (r === 3) addPart({ x, y, vx: 5, vy: 9, max: 3, col: Math.random() < 0.5 ? '#f08c28' : '#d8401c', sway: 1 });
      else if (r === 4) addPart({ x, y, vx: 7, vy: 7, max: 3.4, col: Math.random() < 0.6 ? '#f6b4c8' : '#ffffff', sway: 1 });
      else if (r === 6) addPart({ x, y, vx: 0, vy: -4, max: 2.6, col: '#8ff0e0', blink: 1 });
      else if (r < 3 && Math.random() < 0.3) addPart({ x, y, vx: (Math.random() - 0.5) * 16, vy: -3, max: 3, col: Math.random() < 0.5 ? '#fff4b0' : '#ffffff', flutter: 1 });
    }
  }
  for (let i = R.parts.length - 1; i >= 0; i--) {
    const p = R.parts[i]; p.life += dt;
    if (p.life >= p.max) { R.parts[i] = R.parts[R.parts.length - 1]; R.parts.pop(); continue; }
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    let x = p.x;
    if (p.sway) x += Math.sin(p.life * 4 + p.y * 0.3) * 3;
    if (p.flutter) { x += Math.sin(p.life * 9) * 2; p.y += Math.cos(p.life * 13) * 0.25; }
    if (p.blink && Math.sin(p.life * 7 + p.x) < -0.2) continue;
    const u = p.life / p.max;
    if (p.smoke) ctx.globalAlpha = 0.55 * (1 - u); else if (u > 0.7) ctx.globalAlpha = (1 - u) / 0.3;
    ctx.fillStyle = p.col; ctx.fillRect(Math.round(x), Math.round(p.y), p.sz, p.sz);
    ctx.globalAlpha = 1;
  }
  for (let i = R.floats.length - 1; i >= 0; i--) {
    const f = R.floats[i]; f.t += dt;
    if (f.t > 1.1) { R.floats.splice(i, 1); continue; }
    drawNum(ctx, f.txt, f.x, f.y - f.t * 14, f.col);
  }
};

// a tile-per-pixel overview of the whole forest
R.minimap = function () {
  const c = newCanvas(MW, MH), g = c.getContext('2d'), id = g.createImageData(MW, MH), d = new Uint32Array(id.data.buffer);
  const tc = TREES.map((t, k) => C(shade(SEASON_COL[R.season][k] || t.col, -0.12))), gc = GPAL_S[R.season].map(p => p[2]);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y), k = W.kind[i];
    if (W.ter[i] === TER.WATER) d[i] = WATER_S[R.season][2];
    else if (W.ter[i] === TER.BRIDGE) d[i] = C('#dca868');
    else if (k && W.g[i] >= 1) d[i] = tc[k - 1];
    else d[i] = gc[ringOf(zoneD(x * TS + 8, y * TS + 8, S.seed))];
  }
  g.putImageData(id, 0, 0);
  for (const b of S.buildings) { g.fillStyle = '#1c120c'; g.fillRect(b.x - 1, b.y - 1, BUILD[b.type].w + 2, BUILD[b.type].h + 2); g.fillStyle = b.type === 'yard' ? '#ffd84a' : b.type === 'cabin' ? '#ff7a5a' : b.type === 'lodge' ? '#e8a0ff' : '#ffffff'; g.fillRect(b.x, b.y, BUILD[b.type].w, BUILD[b.type].h); }
  for (const w of S.workers) { g.fillStyle = w.role === 'jack' ? '#ffffff' : '#9ad4ff'; g.fillRect(Math.floor(w.x / TS), Math.floor(w.y / TS), 1, 1); }
  for (const b of S.bridges) { g.fillStyle = '#1c120c'; g.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); g.fillStyle = '#ffd8a0'; g.fillRect(b.x, b.y, b.w, b.h); }
  for (let r = 0; r < NT; r++) {       // Ancient trees: a gold mark while standing, grey once felled
    const x = W.anc[r].i % MW, y = (W.anc[r].i / MW) | 0;
    g.fillStyle = '#1c120c'; g.fillRect(x - 2, y - 2, 5, 5); g.fillStyle = S.anc[r].done ? '#9a9a9a' : '#ffe060'; g.fillRect(x - 1, y - 1, 3, 3);
  }
  return c;
};
;(window.__stage = window.__stage || []).push('render.js loaded');
