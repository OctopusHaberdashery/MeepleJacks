// MeepleJacks — renderer. The world is drawn at one canvas pixel per art pixel and the
// browser scales the canvas up with crisp edges, so even a zoomed-out forest is cheap to draw.
'use strict';

const CH = 256;                                  // ground chunk size in art pixels (16 tiles)
const MAPW = MW * TS, MAPH = MH * TS;
const R = window.R = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, k: 3, kT: 3, z: 3, bw: 0, bh: 0,
  cam: { x: YARD_X, y: YARD_Y + 20 }, follow: true, anchor: null, pinching: false,
  chunks: new Map(), frame: 0, t: 0, parts: [], floats: [], falls: [], marks: [],
  ghost: null, radiusOf: null, ready: false, fade: true, smokeT: 0, stockKey: '', stock: [],
};

R.init = function (cv) {
  R.cv = cv; R.ctx = cv.getContext('2d', { alpha: false });
  R.resize(); R.k = R.kT = R.defaultK();
  R.ready = true;
};
R.resize = function () {
  R.dpr = window.devicePixelRatio || 1;
  R.W = window.innerWidth; R.H = window.innerHeight;
  // k = device pixels per art pixel; whole numbers keep every art pixel the same size
  R.kMin = Math.max(1, Math.ceil(Math.max(0.8 * R.dpr, R.W * R.dpr / 1500)));
  R.kMax = Math.max(R.kMin + 2, Math.floor(6 * R.dpr));
  R.k = clamp(R.k, R.kMin, R.kMax); R.kT = clamp(Math.round(R.kT), R.kMin, R.kMax);
  R.bw = 0;
};
R.defaultK = () => clamp(Math.round(R.dpr * (Math.min(R.W, R.H) < 520 ? 2 : 3)), R.kMin, R.kMax);
R.layout = function () {
  const z = R.z = R.k / R.dpr, bw = Math.ceil(R.W / z) + 2, bh = Math.ceil(R.H / z) + 2;
  if (bw !== R.bw || bh !== R.bh) { R.bw = bw; R.bh = bh; R.cv.width = bw; R.cv.height = bh; R.ctx.imageSmoothingEnabled = false; }
  const cw = bw * z + 'px', chh = bh * z + 'px';
  if (R.cv.style.width !== cw) R.cv.style.width = cw;
  if (R.cv.style.height !== chh) R.cv.style.height = chh;
};
R.screenToWorld = (sx, sy) => ({ x: R.cam.x + (sx - R.W / 2) / R.z, y: R.cam.y + (sy - R.H / 2) / R.z });
R.worldToScreen = (wx, wy) => ({ x: (wx - R.cam.x) * R.z + R.W / 2, y: (wy - R.cam.y) * R.z + R.H / 2 });
R.clampCam = function () {
  const hw = R.W / R.z / 2, hh = R.H / R.z / 2, m = 24;
  R.cam.x = MAPW + 2 * m < hw * 2 ? MAPW / 2 : clamp(R.cam.x, hw - m, MAPW - hw + m);
  R.cam.y = MAPH + 2 * m < hh * 2 ? MAPH / 2 : clamp(R.cam.y, hh - m, MAPH - hh + m);
};
// zoom by whole steps around a point on screen
R.zoomBy = function (steps, sx, sy) {
  const w = R.screenToWorld(sx, sy);
  R.kT = clamp(Math.round(R.kT + steps), R.kMin, R.kMax);
  R.anchor = { sx, sy, wx: w.x, wy: w.y };
};
R.reset = function () { R.parts = []; R.floats = []; R.falls = []; R.marks = []; R.chunks.clear(); R.ghost = null; R.radiusOf = null; R.stockKey = ''; };

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
const FLOWERS = [['#ffffff', '#ffe060'], ['#ffe060', '#fff4b0'], ['#7aa8f0', '#c8dcff'], ['#f08c28', '#d8401c'], ['#f6b4c8', '#ffffff'], ['#8a5a34', '#6a4426'], ['#58e0d0', '#b8fff0']];

function genChunk(cx, cy) {
  const c = newCanvas(CH, CH), g = c.getContext('2d'), id = g.createImageData(CH, CH), d = new Uint32Array(id.data.buffer);
  const seed = S.seed, X0 = cx * CH, Y0 = cy * CH, G = 4, GN = CH / G + 1;
  // slow-changing fields sampled on a coarse grid, then interpolated
  const wg = new Float32Array(GN * GN), zg = new Float32Array(GN * GN);
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { wg[j * GN + i] = waterV(X0 + i * G, Y0 + j * G, seed); zg[j * GN + i] = zoneD(X0 + i * G, Y0 + j * G, seed); }
  const lerp2 = (a, x, y) => {
    const i = x >> 2, j = y >> 2, u = (x & 3) / 4, v = (y & 3) / 4, k = j * GN + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + GN] * (1 - u) + a[k + GN + 1] * u) * v;
  };
  const zoneAt = new Uint8Array(CH * CH), grass = new Uint8Array(CH * CH);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CH; x++) {
    const px = X0 + x, py = Y0 + y, wv = lerp2(wg, x, y), o = y * CH + x;
    let col;
    if (wv > 0) {
      if (wv < 0.006) col = WATER[bayer(px, py) < 0.7 ? 0 : 1];
      else if (wv < 0.03) col = WATER[1];
      else if (wv < 0.075) col = WATER[bayer(px, py) < (wv - 0.03) / 0.045 ? 2 : 1];
      else col = WATER[bayer(px, py) < (wv - 0.075) / 0.06 ? 3 : 2];
      if (wv > 0.012 && hash2(px >> 2, py, seed + 50) < 0.03) col = WATER[wv < 0.05 ? 0 : 1];
    } else if (wv > -0.014) col = SAND[bayer(px, py) < (wv + 0.014) / 0.014 ? 1 : 0];
    else {
      const dd = lerp2(zg, x, y);
      let r = ringOf(dd);
      if (r < NT - 1) { const toNext = RINGS[r + 1] - dd; if (toNext < 1.6 && bayer(px, py) * 1.6 > toNext) r++; }
      const dYard = Math.hypot(px - YARD_X, py - (YARD_Y + 14)) / TS;
      let dirt = false;
      if (dYard < 8) dirt = 1 - dYard / 5.2 + (fbm(px / 34, py / 34, seed + 13, 2) - 0.5) * 0.55 > bayer(px, py) * 0.16;
      if (dirt) col = ptone(DIRT, fbm(px / 20, py / 20, seed + 14, 2) * 1.5 - 0.25 + (hash2(px, py, seed + 15) - 0.5) * 0.3, px, py);
      else {
        col = ptone(GPAL[r], fbm(px / 26, py / 26, seed + 31, 2) * 1.6 - 0.3, px, py);
        const sp = hash2(px, py, seed + 33);
        if (sp < 0.02) col = GPAL[r][3]; else if (sp > 0.975) col = GPAL[r][0];
        if (wv > -0.02) col = GPAL[r][0];       // damp edge beside the shore
        grass[o] = 1; zoneAt[o] = r;
      }
    }
    d[o] = col;
  }
  // little details, a few per tile
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < CH && y < CH && grass[y * CH + x]) d[y * CH + x] = c; };
  for (let ty = 0; ty < CH / TS; ty++) for (let tx = 0; tx < CH / TS; tx++) {
    const gx = cx * (CH / TS) + tx, gy = cy * (CH / TS) + ty;
    for (let n = 0; n < 2; n++) {
      const h = hash2(gx, gy, seed + 60 + n), x = tx * TS + 2 + ((hash2(gx, gy, seed + 62 + n) * 12) | 0), y = ty * TS + 3 + ((hash2(gx, gy, seed + 64 + n) * 11) | 0);
      if (!grass[y * CH + x]) continue;
      const r = zoneAt[y * CH + x], P4 = GPAL[r], F = FLOWERS[r];
      if (h < 0.34) { put(x, y, P4[0]); put(x + 1, y - 1, P4[0]); put(x + 2, y, P4[0]); put(x + 1, y - 2, P4[3]); put(x + 3, y - 1, P4[3]); }
      else if (h < 0.40) { put(x, y, C('#8a8c90')); put(x + 1, y, C('#6a6c74')); put(x, y - 1, C('#b4b6b8')); }
      else if (r === 3 && h < 0.72) { put(x, y, C(F[0])); put(x + 1, y, C(F[1])); put(x + 3, y + 2, C(F[0])); put(x - 2, y + 1, C('#fcc450')); }
      else if (r === 4 && h < 0.74) { put(x, y, C(F[0])); put(x + 2, y + 1, C(F[1])); put(x - 1, y + 3, C(F[0])); put(x + 4, y - 1, C('#e486a8')); }
      else if (r === 5 && h < 0.62) {
        if (h < 0.5) { put(x, y, C(F[0])); put(x + 1, y, C(F[0])); put(x + 2, y + 1, C(F[1])); put(x - 1, y + 1, C(F[1])); }
        else for (let k = 0; k < 4; k++) { put(x + k, y - (k & 1), C('#5ca050')); put(x + k, y + 1 - (k & 1), C('#2c6a3a')); }
      }
      else if (r === 6 && h < 0.5) { put(x, y, C(F[0])); put(x + 1, y, C(F[1])); put(x, y + 1, C('#d8d0c0')); }
      else if (r < 3 && h < 0.47) { put(x, y, C(F[0])); put(x + 1, y, C(F[0])); put(x, y - 1, C(F[1])); put(x, y + 1, P4[0]); }
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- events from the sim
function addPart(p) { if (R.parts.length < 420) R.parts.push(Object.assign({ life: 0, max: 1, vx: 0, vy: 0, g: 0, sz: 1 }, p)); }
function hearing(x, y, me) {
  const d = Math.hypot(x - R.cam.x, y - R.cam.y), reach = Math.max(R.W, R.H) / R.z * 0.7;
  return Math.max(me ? 0.85 : 0, clamp(1.15 - d / reach, 0, 1));
}
const leafCols = t => [shade(TREES[t].col, -0.25), TREES[t].col, shade(TREES[t].col, 0.3)];
R.onEvent = function (e) {
  const vol = e.x != null ? hearing(e.x, e.y, e.me) : 1, seen = vol > 0.05;
  switch (e.t) {
    case 'chop': {
      AUDIO.sfx('chop', vol, e.k - 1);
      if (!seen) break;
      const wood = TREES[e.k - 1].wood, lc = leafCols(e.k - 1), h = ART.tree[e.k - 1][0][2].h;
      for (let i = 0; i < 4; i++) addPart({ x: e.x + e.side * 2, y: e.y - 5, vx: e.side * (12 + Math.random() * 28), vy: -20 - Math.random() * 30, g: 160, max: 0.5, col: i & 1 ? wood : shade(wood, -0.25) });
      for (let i = 0; i < 2; i++) addPart({ x: e.x + (Math.random() - 0.5) * 14, y: e.y - h * (0.5 + Math.random() * 0.3), vx: (Math.random() - 0.5) * 14, vy: 8, g: 26, max: 1.2, col: lc[(Math.random() * 3) | 0], sway: 1 });
      break;
    }
    case 'fall':
      AUDIO.sfx('fall', vol, e.k - 1);
      R.falls.push({ x: e.x, y: e.y, k: e.k, v: e.v, dir: e.dir, t: 0 });
      break;
    case 'pick': AUDIO.sfx('pick', vol); break;
    case 'deposit':
      AUDIO.sfx(e.coins ? 'coin' : 'drop', vol);
      if (seen) {
        if (e.coins) R.floats.push({ x: e.x, y: e.y - 22, txt: '+' + e.coins, col: '#ffd84a', t: 0 });
        else R.floats.push({ x: e.x, y: e.y - 22, txt: '+' + e.n, col: '#f4e8c8', t: 0 });
      }
      break;
    case 'build':
      AUDIO.sfx('build');
      for (let i = 0; i < 26; i++) addPart({ x: e.x + (Math.random() - 0.5) * 50, y: e.y - Math.random() * 10, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 24, g: 30, max: 0.9, col: i & 1 ? '#d8c8a0' : '#a28256', sz: 2 });
      break;
    case 'hire':
      AUDIO.sfx('hire');
      for (let i = 0; i < 12; i++) addPart({ x: e.x + (Math.random() - 0.5) * 12, y: e.y - 8 - Math.random() * 10, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 20, g: 60, max: 0.8, col: i & 1 ? '#fff4b0' : '#f6c83c' });
      break;
  }
};

// ---------------------------------------------------------------- drawing
function drawMeeple(ctx, e, key, axeLv, chopSwing) {
  const fr = ART.meeple[key] || ART.meeple.player; let f = fr.stand, bob = 0;
  if (e.moving) { const ph = Math.floor(e.walkT * 9) & 3; f = ph === 1 ? fr.walkA : ph === 3 ? fr.walkB : fr.stand; bob = (ph & 1) ? -1 : 0; }
  let x = Math.round(e.x), y = Math.round(e.y);
  const face = e.face < 0 ? -1 : 1, chopping = e.st === 'chop';
  ctx.fillStyle = 'rgba(10,26,16,0.3)'; ctx.fillRect(x - 5, y - 1, 10, 2); ctx.fillRect(x - 4, y + 1, 8, 1);
  let ang = -0.5, lean = 0;
  if (chopping) {
    const p = 1 - clamp(e.swing / chopSwing, 0, 1);       // 0 just after a hit, 1 at the next
    if (p < 0.18) { ang = 1.35; lean = 1; }
    else if (p < 0.68) { const u = (p - 0.18) / 0.5; ang = 1.35 - 2.6 * (u * u * (3 - 2 * u)); }
    else { const u = (p - 0.68) / 0.32; ang = -1.25 + 2.6 * u * u; lean = u > 0.6 ? 1 : 0; }
  }
  x += lean * face;
  if (face < 0) { ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(f.c, -f.ax, y - f.ay + bob); ctx.restore(); }
  else ctx.drawImage(f.c, x - f.ax, y - f.ay + bob);
  if (e.carry && e.carry.length) {
    const n = Math.min(e.carry.length, 4);
    for (let j = 0; j < n; j++) drawSpr(ctx, ART.carry[e.carry[j]], x, y - 20 - j * 3 + bob);
    if (e.carry.length > 4) drawNum(ctx, '' + e.carry.length, x + 10, y - 34, '#fff4d0');
  } else if (axeLv) {
    const a = ART.axe[axeLv];
    ctx.save();
    ctx.translate(x + (chopping ? face * 4 : -face * 4), y - 8 + bob); ctx.scale(face, 1); ctx.rotate(ang);
    ctx.drawImage(a.c, -a.ax, -a.ay);
    ctx.restore();
  }
}
function drawBuilding(ctx, b) {
  const base = bBase(b), s = ART.spr[b.type];
  drawSpr(ctx, s, base.x, base.y - 2);
  if (b.type === 'yard') {
    const key = S.inv.join(',');
    if (key !== R.stockKey) {
      R.stockKey = key; R.stock = [];
      const total = S.inv.reduce((a, v) => a + v, 0), shown = Math.min(YARD_SLOTS.length, total);
      for (let j = 0; j < shown; j++) {
        let target = (j + 0.5) / shown * total, t = 0;
        while (t < NT - 1 && target >= S.inv[t]) { target -= S.inv[t]; t++; }
        R.stock.push(t);
      }
    }
    for (let j = 0; j < R.stock.length; j++) ctx.drawImage(ART.end[R.stock[j]], Math.round(base.x) + YARD_SLOTS[j][0], Math.round(base.y - 2) + YARD_SLOTS[j][1]);
  }
}
function drawFall(ctx, f) {
  const s = ART.tree[f.k - 1][f.v][2], u = clamp(f.t / 0.75, 0, 1);
  ctx.save();
  ctx.globalAlpha = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
  ctx.translate(Math.round(f.x), Math.round(f.y)); ctx.rotate(f.dir * Math.pow(u, 2.2) * 1.5);
  ctx.drawImage(s.c, -s.ax, -s.ay);
  ctx.restore();
}
function ring(ctx, x, y, r, col, phase) {
  ctx.fillStyle = col;
  const n = Math.floor(r * 6.283 / 5);
  for (let i = 0; i < n; i++) { const a = (i + phase) / n * 6.283; ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.98), 2, 1); }
}

R.draw = function (dt) {
  R.t += dt; R.frame++;
  const P = S.player;
  // ease zoom to a whole step, holding the anchor point still
  if (!R.pinching && R.k !== R.kT) {
    const d = R.kT - R.k;
    R.k = Math.abs(d) < 0.03 ? R.kT : R.k + d * Math.min(1, dt * 16);
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
  const z = R.z, vw = R.W / z, vh = R.H / z, lx = R.cam.x - vw / 2, ly = R.cam.y - vh / 2, ox = Math.floor(lx), oy = Math.floor(ly);
  R.cv.style.transform = `translate3d(${-Math.round((lx - ox) * R.k) / R.dpr}px,${-Math.round((ly - oy) * R.k) / R.dpr}px,0)`;
  const ctx = R.ctx, bw = R.bw, bh = R.bh;
  ctx.setTransform(1, 0, 0, 1, -ox, -oy);
  ctx.fillStyle = '#14281c'; ctx.fillRect(ox, oy, bw, bh);

  // ground chunks (a couple of new ones per frame at most)
  let budget = R.chunks.size < 4 ? 30 : 2;
  for (let cy = Math.max(0, Math.floor(oy / CH)); cy <= Math.min(MAPH / CH - 1, Math.floor((oy + bh) / CH)); cy++)
    for (let cx = Math.max(0, Math.floor(ox / CH)); cx <= Math.min(MAPW / CH - 1, Math.floor((ox + bw) / CH)); cx++) {
      const key = cy * 64 + cx; let ch = R.chunks.get(key);
      if (!ch) {
        if (budget-- <= 0) { ctx.fillStyle = '#3f7a3a'; ctx.fillRect(cx * CH, cy * CH, CH, CH); continue; }
        ch = { c: genChunk(cx, cy), used: 0 }; R.chunks.set(key, ch);
      }
      ch.used = R.frame; ctx.drawImage(ch.c, cx * CH, cy * CH);
    }
  if (R.chunks.size > 72) { let old = null, ok = 0; for (const [k, c] of R.chunks) if (!old || c.used < old.used) { old = c; ok = k; } R.chunks.delete(ok); }

  // ground decals
  for (const b of S.buildings) { const base = bBase(b); drawSpr(ctx, b.type === 'yard' ? ART.spr.apronYard : ART.spr.apronCabin, base.x, base.y - 6); }
  if (R.radiusOf) { const b = R.radiusOf; ring(ctx, (b.x + 1.5) * TS, (b.y + 1.5) * TS, BUILD.cabin.radius * TS, 'rgba(255,248,208,0.85)', R.t * 3); }
  for (let i = R.marks.length - 1; i >= 0; i--) {
    const m = R.marks[i]; m.t += dt;
    if (m.t > 0.5) { R.marks.splice(i, 1); continue; }
    ring(ctx, m.x, m.y, 2 + m.t * 16, `rgba(255,255,255,${0.9 - m.t * 1.8})`, 0);
  }
  if ((P.st === 'toTree' || P.st === 'chop') && UI.inGame && isMature(P.target)) {
    const q = treeXY(P.target), a = Math.round(Math.sin(R.t * 6));
    ctx.fillStyle = '#fff8d0';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const bx = q.x + sx * (9 + a), by = q.y + 1 + sy * 4;
      ctx.fillRect(sx < 0 ? bx : bx - 2, by, 3, 1); ctx.fillRect(bx, sy < 0 ? by : by - 1, 1, 2);
    }
  }

  // everything standing on the ground, back to front
  const ents = [];
  const inX = x => x > ox - 60 && x < ox + bw + 60, inY = y => y > oy - 20 && y < oy + bh + 110;
  for (const b of S.buildings) { const base = bBase(b); if (inX(base.x) && inY(base.y)) ents.push({ y: base.y - 1, b }); }
  for (const p of S.piles) { if (p.t > 0.25) continue; const q = pileXY(p); if (inX(q.x) && inY(q.y)) ents.push({ y: q.y, p, x: q.x }); }
  for (const w of S.workers) if (inX(w.x) && inY(w.y)) ents.push({ y: w.y, w });
  if (UI.inGame && inX(P.x) && inY(P.y)) ents.push({ y: P.y, me: P });
  for (const f of R.falls) ents.push({ y: f.y + 0.5, f });
  if (R.ghost) ents.push({ y: (R.ghost.ty + BUILD[R.ghost.type].h) * TS - 1, ghost: R.ghost });
  ents.sort((a, b) => a.y - b.y);
  let ei = 0;
  const drawEnt = e => {
    if (e.b) drawBuilding(ctx, e.b);
    else if (e.p) drawSpr(ctx, ART.pile[e.p.type][Math.min(6, e.p.n)], e.x, e.y);
    else if (e.w) drawMeeple(ctx, e.w, e.w.role + e.w.col, e.w.role === 'jack' ? S.crewAxe : 0, CREW_SWING);
    else if (e.me) drawMeeple(ctx, e.me, 'player', S.axe, PLAYER_SWING);
    else if (e.f) drawFall(ctx, e.f);
    else if (e.ghost) {
      const gh = e.ghost, B = BUILD[gh.type];
      ctx.fillStyle = gh.ok ? 'rgba(120,255,120,0.35)' : 'rgba(255,80,60,0.45)';
      ctx.fillRect(gh.tx * TS, gh.ty * TS, B.w * TS, B.h * TS);
      ctx.globalAlpha = 0.8; drawSpr(ctx, ART.spr[gh.type], (gh.tx + B.w / 2) * TS, (gh.ty + B.h) * TS - 2); ctx.globalAlpha = 1;
    }
  };
  const tx0 = Math.max(0, Math.floor(ox / TS) - 2), tx1 = Math.min(MW - 1, Math.floor((ox + bw) / TS) + 2);
  const ty0 = Math.max(0, Math.floor(oy / TS) - 1), ty1 = Math.min(MH - 1, Math.floor((oy + bh) / TS) + 6);
  const fade = R.fade && UI.inGame;
  for (let ty = ty0; ty <= ty1; ty++) {
    const lim = ty * TS + 9;
    while (ei < ents.length && ents[ei].y < lim) drawEnt(ents[ei++]);
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * MW + tx, k = W.kind[i];
      if (!k) { if (W.ter[i] === TER.ROCK) drawSpr(ctx, ART.rock[W.vr[i]], tx * TS + 8, ty * TS + 13); continue; }
      const g = W.g[i]; let x = tx * TS + 8 + W.jx[i]; const y = ty * TS + 12 + W.jy[i];
      if (g >= 1) {
        const s = ART.tree[k - 1][W.vr[i]][2];
        const sh = W.shake.get(i); if (sh) x += Math.round(Math.sin(sh * 60) * sh * 8);
        if (fade && y > P.y + 1 && P.y > y - s.h + 8 && Math.abs(P.x - x) < s.w / 2 - 1) { ctx.globalAlpha = 0.38; ctx.drawImage(s.c, x - s.ax, y - s.ay); ctx.globalAlpha = 1; }
        else ctx.drawImage(s.c, x - s.ax, y - s.ay);
      } else if (g < 0.12) { const s = ART.stump[k - 1]; ctx.drawImage(s.c, x - s.ax, y - s.ay); }
      else { const s = ART.tree[k - 1][W.vr[i]][g < 0.45 ? 0 : 1]; ctx.drawImage(s.c, x - s.ax, y - s.ay); }
    }
  }
  while (ei < ents.length) drawEnt(ents[ei++]);
  for (let i = R.falls.length - 1; i >= 0; i--) {
    const f = R.falls[i]; f.t += dt;
    if (f.t >= 0.75) {
      R.falls.splice(i, 1);
      const lc = leafCols(f.k - 1), h = ART.tree[f.k - 1][f.v][2].h;
      for (let n = 0; n < 16; n++) { const u = 0.3 + Math.random() * 0.7; addPart({ x: f.x + f.dir * h * u, y: f.y - 2, vx: (Math.random() - 0.5) * 40, vy: -18 - Math.random() * 30, g: 70, max: 0.9, col: n % 4 === 0 ? '#c8b890' : lc[n % 3], sz: n % 5 === 0 ? 2 : 1 }); }
    }
  }

  // chop progress bars, queue numbers
  for (const [i, hp] of W.hp) {
    const k = W.kind[i]; if (!k) continue;
    const q = treeXY(i), s = ART.tree[k - 1][W.vr[i]][2], x = q.x - 7, y = q.y - s.h - 5, f = clamp(1 - hp / TREES[k - 1].hp, 0, 1);
    ctx.fillStyle = '#1c120c'; ctx.fillRect(x - 1, y - 1, 16, 4);
    ctx.fillStyle = '#5a3a26'; ctx.fillRect(x, y, 14, 2);
    ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, y, Math.round(14 * f), 2);
  }
  if (UI.inGame) P.queue.forEach((i, n) => { if (!isMature(i)) return; const q = treeXY(i), s = ART.tree[W.kind[i] - 1][W.vr[i]][2]; drawNum(ctx, '' + (n + 1), q.x + 1, q.y - s.h - 8 + Math.round(Math.sin(R.t * 5 + n)), '#ffd84a'); });

  // chimney smoke and drifting bits of forest
  R.smokeT -= dt;
  if (R.smokeT <= 0) {
    R.smokeT = 0.45;
    for (const b of S.buildings) if (b.type === 'cabin') { const base = bBase(b); if (inX(base.x) && inY(base.y)) addPart({ x: base.x + 12, y: base.y - 57, vx: 3 + Math.random() * 4, vy: -9, max: 2.4, col: '#d8d8d4', sz: 2, smoke: 1 }); }
    for (let n = 0; n < 3; n++) {
      const x = ox + Math.random() * bw, y = oy + Math.random() * bh, tx = Math.floor(x / TS), ty = Math.floor(y / TS);
      if (!inMap(tx, ty)) continue;
      if (W.ter[idx(tx, ty)] === TER.WATER) { addPart({ x, y, max: 0.5, col: '#ffffff' }); continue; }
      const r = ringOf(zoneD(x, y, S.seed));
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
  const tc = TREES.map(t => C(shade(t.col, -0.12))), gc = GPAL.map(p => p[2]);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y), k = W.kind[i];
    if (W.ter[i] === TER.WATER) d[i] = WATER[2];
    else if (k && W.g[i] >= 1) d[i] = tc[k - 1];
    else d[i] = gc[ringOf(zoneD(x * TS + 8, y * TS + 8, S.seed))];
  }
  g.putImageData(id, 0, 0);
  for (const b of S.buildings) { g.fillStyle = '#1c120c'; g.fillRect(b.x - 1, b.y - 1, BUILD[b.type].w + 2, BUILD[b.type].h + 2); g.fillStyle = b.type === 'yard' ? '#ffd84a' : '#ff7a5a'; g.fillRect(b.x, b.y, BUILD[b.type].w, BUILD[b.type].h); }
  for (const w of S.workers) { g.fillStyle = w.role === 'jack' ? '#ffffff' : '#9ad4ff'; g.fillRect(Math.floor(w.x / TS), Math.floor(w.y / TS), 1, 1); }
  return c;
};
;(window.__stage = window.__stage || []).push('render.js loaded');
