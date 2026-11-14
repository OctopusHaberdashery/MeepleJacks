// MeepleJacks — the forest, the simulation (you and every kind of crew), orders, the Great Lodge and saving.
'use strict';

let SEA = 0;       // the season just now: 0 spring, 1 summer, 2 autumn, 3 winter
let S = null;      // saved state
let W = null;      // the generated map and other things rebuilt on load
const EV = [];     // events for the renderer, UI and audio
const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const TER = { GRASS: 0, WATER: 1, ROCK: 2, BRIDGE: 3 };
const SAVE_KEY = s => 'meeplejacks_slot' + s;
const YARD_X = (CX + 0.5) * TS, YARD_Y = (CY - 0.5) * TS;   // middle of the Lumber Yard

// ---------------------------------------------------------------- terrain (shared with the renderer; pixel coords)
function waterV(px, py, seed) {
  const d = Math.hypot(px - YARD_X, py - YARD_Y) / TS, edge = Math.min(px, py, MW * TS - px, MH * TS - py) / TS;
  return fbm(px / 300, py / 300, seed + 3, 3) - 0.715 - Math.max(0, 18 - d) * 0.03 - Math.max(0, 5 - edge) * 0.1;
}
// distance from the yard in tiles, wobbled so the rings aren't perfect circles
function zoneD(px, py, seed) {
  return Math.hypot(px - YARD_X, py - YARD_Y) / TS + (fbm(px / 224, py / 224, seed + 7, 3) - 0.5) * 9;
}
function ringOf(dd) { let r = 0; while (r < NT - 1 && dd >= RINGS[r + 1]) r++; return r; }
// Rivers run where one ring meets the next. riverE: how far inside a river a spot is, in tiles (positive in the water).
function riverE(dd) { let e = -99; for (let k = 1; k < NT; k++) { const v = RIVER_HALF - Math.abs(dd - RINGS[k]); if (v > e) e = v; } return e; }
function riverK(dd) { let k = 1; for (let j = 2; j < NT; j++) if (Math.abs(dd - RINGS[j]) < Math.abs(dd - RINGS[k])) k = j; return k; }
// Ponds and rivers together, on the ponds' scale. Ponds shrink away from the rivers so that a ring is never cut in two.
function wetV(wv, dd) { const e = riverE(dd); return Math.max(wv - Math.max(0, 4.5 + e) * 0.1, e * 0.03); }
const seasonNow = () => Math.floor(S.playTime / SEASON_LEN) % 4;
const yearNow = () => Math.floor(S.playTime / (SEASON_LEN * 4)) + 1;

function genMap(seed) {
  W = {
    kind: new Uint8Array(NTILES), g: new Float32Array(NTILES), ter: new Uint8Array(NTILES), block: new Uint8Array(NTILES),
    vr: new Uint8Array(NTILES), jx: new Int8Array(NTILES), jy: new Int8Array(NTILES), orig: null,
    reg: new Uint8Array(NTILES),     // which ring a tile is in: the number of rivers between it and the yard
    riv: new Uint8Array(NTILES),     // for river water, which river (1 is the innermost)
    anc: [], ancSlots: [], ancShake: [],
    site: [],                        // site[k]: where the bridge over river k goes, { k, x, y, w, h, v, lo }
    hp: new Map(), claim: new Map(), shake: new Map(), growing: new Set(), pileAt: new Map(), pileById: new Map(), bById: new Map(),
    dirty: [],     // tiles whose look changed, for the zoomed-out tree cache
  };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y), px = x * TS + 8, py = y * TS + 8;
    const d = Math.hypot(px - YARD_X, py - YARD_Y) / TS, dd = zoneD(px, py, seed), re = riverE(dd) * 0.03, wv = wetV(waterV(px, py, seed), dd);
    const r = W.reg[i] = ringOf(dd);
    if (wv > -0.004) { W.ter[i] = TER.WATER; if (re > -0.004) W.riv[i] = riverK(dd); continue; }
    if (d > 7 && wv < -0.04 && hash2(x, y, seed + 2) < 0.005) { W.ter[i] = TER.ROCK; W.vr[i] = (hash2(x, y, seed + 4) * 3) | 0; continue; }
    if (d < 4.2 || wv > -0.03) continue;
    let dens = 0.2 + 0.42 * fbm(x / 9, y / 9, seed + 11, 2);
    if (d < 8.5) dens *= (d - 4.2) / 4.3;
    dens *= DENSITY[r];
    if (hash2(x, y, seed + 5) < dens) {
      W.kind[i] = r + 1; W.g[i] = 1;
      W.vr[i] = (hash2(x, y, seed + 6) * TREE_VARIANTS) | 0;
      W.jx[i] = ((hash2(x, y, seed + 21) * 7) | 0) - 3; W.jy[i] = ((hash2(x, y, seed + 22) * 5) | 0) - 2;
    }
  }
  placeAncients(seed);
  placeCrossings(seed);
  W.orig = W.kind.slice();
}
// The bridge that would cross the river at tile (tx, ty): two tiles wide, straight across, bank to bank.
// Returns { k, x, y, w, h, v, lo } or null if the banks there won't take one. lo: the yard side is the low end.
function bridgeGeom(tx, ty, seed) {
  const i0 = idx(tx, ty), k = W.riv[i0]; if (!k) return null;
  const px = tx * TS + 8, py = ty * TS + 8;
  const gx = zoneD(px + TS, py, seed) - zoneD(px - TS, py, seed), gy = zoneD(px, py + TS, seed) - zoneD(px, py - TS, seed);
  const v = Math.abs(gy) > Math.abs(gx) ? 1 : 0;       // 1: the bridge runs north to south
  const tile = (a, c) => v ? (inMap(c, a) ? idx(c, a) : -1) : (inMap(a, c) ? idx(a, c) : -1);      // a: along the bridge, c: across it
  const wet = (a, c) => { const i = tile(a, c); return i >= 0 && W.ter[i] === TER.WATER; };
  const a0 = v ? ty : tx, c0 = v ? tx : ty;
  let lo = 1e9, hi = -1e9;
  for (const c of [c0, c0 + 1]) {
    let st = a0;
    if (!wet(st, c)) {            // on a slanting river the second lane starts a tile or two along
      st = null;
      for (let d = 1; d <= 3 && st === null; d++) { if (wet(a0 + d, c)) st = a0 + d; else if (wet(a0 - d, c)) st = a0 - d; }
      if (st === null) continue;
    }
    let l = st, h = st;
    while (wet(l - 1, c) && st - l < 30) l--;
    while (wet(h + 1, c) && h - st < 30) h++;
    lo = Math.min(lo, l); hi = Math.max(hi, h);
  }
  const len = hi - lo + 1;
  if (len > BRIDGE_MAX || len < 2) return null;
  const land = (a, c) => { const i = tile(a, c); if (i < 0 || W.ter[i] !== TER.GRASS) return -1; const x = i % MW, y = (i / MW) | 0; return x < 4 || y < 6 || x >= MW - 4 || y >= MH - 4 ? -1 : W.reg[i]; };
  const A = land(lo - 1, c0), A2 = land(lo - 1, c0 + 1), B = land(hi + 1, c0), B2 = land(hi + 1, c0 + 1);
  if (A < 0 || B < 0 || A !== A2 || B !== B2 || Math.min(A, B) !== k - 1 || Math.max(A, B) !== k) return null;
  if (land(lo - 2, c0) !== A || land(lo - 2, c0 + 1) !== A || land(hi + 2, c0) !== B || land(hi + 2, c0 + 1) !== B) return null;      // room to step on and off
  for (let a = lo; a <= hi; a++) for (const c of [c0, c0 + 1]) { const i = tile(a, c); if (i < 0 || W.ter[i] === TER.ROCK) return null; }
  for (const T of W.anc) if (Math.hypot(T.i % MW - tx, ((T.i / MW) | 0) - ty) < 7) return null;
  return v ? { k, x: c0, y: lo, w: 2, h: len, v, lo: A === k - 1 ? 1 : 0 } : { k, x: lo, y: c0, w: len, h: 2, v, lo: A === k - 1 ? 1 : 0 };
}
// One crossing place on each river, at a bearing from the yard that is different for every river and every forest.
function placeCrossings(seed) {
  W.site = [null];
  for (let k = 1; k < NT; k++) {
    let site = null;
    for (let j = 0; j < 12 && !site; j++) {
      const a = (hash2(k, 13 + j, seed + 91) + hash2(seed % 977, k * 7 + j, 5)) * 6.283;
      const nx = clamp(Math.round(CX + 0.5 + Math.cos(a) * RINGS[k]), 0, MW - 1), ny = clamp(Math.round(CY - 0.5 + Math.sin(a) * RINGS[k]), 0, MH - 1);
      nearestTile(nx, ny, i => { if (W.riv[i] !== k) return false; const g = bridgeGeom(i % MW, (i / MW) | 0, seed); if (g && g.k === k) { site = g; return true; } return false; }, 30);
    }
    if (!site) nearestTile(CX, CY, i => { if (W.riv[i] !== k) return false; const g = bridgeGeom(i % MW, (i / MW) | 0, seed); if (g && g.k === k) { site = g; return true; } return false; });
    W.site[k] = site || { k, x: clamp(CX + Math.round(RINGS[k]) - 1, 2, MW - 6), y: CY, w: 4, h: 2, v: 0, lo: 1 };
    // the banks at each end are kept clear
    const s = W.site[k];
    for (let yy = -1; yy <= s.h; yy++) for (let xx = -1; xx <= s.w; xx++) if (inMap(s.x + xx, s.y + yy)) { const n = idx(s.x + xx, s.y + yy); W.kind[n] = 0; W.g[n] = 0; }
    for (const e of [0, 1]) { const p = siteEnd(s, e), tx = Math.floor(p.x / TS), ty = Math.floor(p.y / TS); for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) if (inMap(tx + xx, ty + yy)) { const n = idx(tx + xx, ty + yy); W.kind[n] = 0; W.g[n] = 0; if (W.ter[n] === TER.ROCK) W.ter[n] = 0; } }
  }
}
// the middle of the bank just off one end of a crossing, in pixels. inner: the end nearer the yard
function siteEnd(s, inner) {
  const low = inner ? s.lo : !s.lo;
  return s.v ? { x: (s.x + 1) * TS, y: (low ? s.y - 1 : s.y + s.h) * TS + 8 } : { x: (low ? s.x - 1 : s.x + s.w) * TS + 8, y: (s.y + 1) * TS };
}
// One Ancient tree per ring, in a glade of its own about halfway across the ring.
function placeAncients(seed) {
  const dry = (bx, by, r) => {
    if (bx < 6 || by < 13 || bx >= MW - 6 || by >= MH - 6) return false;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) { const n = idx(bx + xx, by + yy); if (W.ter[n] || W.reg[n] !== r) return false; }
    return true;
  };
  for (let r = 0; r < NT; r++) {
    const lo = Math.max(RINGS[r], 6) + 3.5, hi = (r < NT - 1 ? RINGS[r + 1] : RINGS[r] + 9) - 3.5, want = (lo + hi) / 2;
    let found = -1;
    for (let j = 0; j < 60 && found < 0; j++) {
      const a = hash2(r, 7, seed + 71) * 6.283 + j * 2.4;
      let best = -1, bd = 1e9;          // walk out along the ray to where the wobbled distance is right
      for (let rad = Math.max(4, want - 8); rad <= want + 8; rad += 0.5) {
        const x = Math.round(CX + 0.5 + Math.cos(a) * rad), y = Math.round(CY - 0.5 + Math.sin(a) * rad);
        if (!inMap(x, y)) continue;
        const e = Math.abs(zoneD(x * TS + 8, y * TS + 8, seed) - want);
        if (e < bd) { bd = e; best = idx(x, y); }
      }
      if (best >= 0 && bd < 1.5 && dry(best % MW, (best / MW) | 0, r)) found = best;
    }
    if (found < 0) {                    // nowhere on the rays: take the best dry spot anywhere in the ring
      let bd = 1e9;
      for (let i = 0; i < NTILES; i++) {
        if (W.reg[i] !== r || W.ter[i]) continue;
        const x = i % MW, y = (i / MW) | 0, e = Math.abs(zoneD(x * TS + 8, y * TS + 8, seed) - want);
        if (e < bd && dry(x, y, r)) { bd = e; found = i; }
      }
    }
    if (found < 0) found = idx(CX + 8 + r * 12, CY);
    const tx = found % MW, ty = (found / MW) | 0;
    W.anc[r] = { i: found, x: tx * TS + 8, y: ty * TS + 12 };
    W.ancSlots[r] = new Array(ANCIENT_CREW).fill(0); W.ancShake[r] = 0;
    for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (xx * xx + yy * yy <= 10 && inMap(tx + xx, ty + yy)) { const n = idx(tx + xx, ty + yy); W.kind[n] = 0; W.g[n] = 0; if (W.ter[n] === TER.ROCK) W.ter[n] = 0; }
  }
}
function rebuildBlocks() {
  for (let i = 0; i < NTILES; i++) W.block[i] = W.ter[i] === TER.WATER || W.ter[i] === TER.ROCK ? 1 : 0;
  for (const A of W.anc) W.block[A.i] = 1;          // the trunk of an Ancient tree, or its stump
  W.bById.clear();
  for (const b of S.buildings) {
    W.bById.set(b.id, b);
    const B = BUILD[b.type];
    for (let yy = 0; yy < B.h; yy++) for (let xx = 0; xx < B.w; xx++) {
      const i = idx(b.x + xx, b.y + yy);
      W.block[i] = 1;
      if (W.kind[i]) { W.kind[i] = 0; W.growing.delete(i); W.hp.delete(i); W.claim.delete(i); W.dirty.push(i); }
    }
  }
}
function setGrow(i, g) {     // change a tree's growth, noting when its sprite changes
  const a = W.g[i], st = v => v >= 1 ? 3 : v < 0.12 ? 0 : v < 0.45 ? 1 : 2;
  W.g[i] = g;
  if (st(a) !== st(g)) W.dirty.push(i);
}
const treeXY = i => ({ x: (i % MW) * TS + 8 + W.jx[i], y: ((i / MW) | 0) * TS + 12 + W.jy[i] });
const pileXY = p => { const t = treeXY(p.i); return { x: t.x + 5, y: t.y + 3 }; };
const bBase = b => ({ x: (b.x + BUILD[b.type].w / 2) * TS, y: (b.y + BUILD[b.type].h) * TS });   // bottom-centre of the footprint
const doorCol = type => BUILD[type].w === 5 ? 2.5 : BUILD[type].w === 2 ? 1 : 1.2;
const bDoor = b => ({ x: (b.x + doorCol(b.type)) * TS, y: (b.y + BUILD[b.type].h) * TS + 7 });
const yard = () => S.buildings[0];
const cabins = () => S.buildings.filter(b => b.type === 'cabin');
const countB = type => S.buildings.reduce((n, b) => n + (b.type === type ? 1 : 0), 0);
const crewOf = id => S.workers.filter(w => w.home === id);
const countRole = role => S.workers.reduce((n, w) => n + (w.role === role ? 1 : 0), 0);
const countForemen = () => S.buildings.reduce((n, b) => n + (b.foreman ? 1 : 0), 0);

// ---------------------------------------------------------------- lasting bonuses
const lodgeDone = n => S.lodgeStage >= n;
const cabinBeds = () => BUILD.cabin.beds + (lodgeDone(1) ? 1 : 0) + (lodgeDone(3) ? 1 : 0) + (lodgeDone(5) ? 1 : 0);
const bedsOf = b => b.type === 'cabin' ? cabinBeds() : b.type === 'lodge' ? BUILD.lodge.beds + (S.lodgeStage >> 1) : (BUILD[b.type].beds || 0);
const playerCap = () => PLAYER_CARRY + S.pack;
const playerSpeed = () => PLAYER_SPEED * (1 + 0.12 * S.boots);
// quirks, skill and the season: wPace is how much faster a Meeple is at everything it does
const quirk = (w, q) => !!w && w.quirk === q;
const wPace = w => (1 + SKILL_BONUS * (w.lvl || 0)) * (w.quirk === 'snow' && SEA === 3 ? 1.3 : 1) * (w.quirk === 'sun' && SEA === 1 ? 1.3 : 1);
const sledding = w => SEA === 3 && (w.role === 'hauler' || w.role === 'carter');
const crewSpeed = (w, home) => CREW_SPEED * (1 + 0.12 * S.crewBoots) * (lodgeDone(2) ? 1.1 : 1) * (home && home.foreman ? 1.3 : 1) * (w.role === 'carter' ? 1.15 : 1)
  * wPace(w) * (w.quirk === 'quick' ? 1.2 : 1) * (sledding(w) ? 1.25 : 1);
const haulerCap = w => HAULER_CARRY + 2 * S.crewPack + (lodgeDone(6) ? 4 : 0) + (quirk(w, 'strong') ? 3 : 0);
const carterCap = w => CARTER_CARRY + 12 * S.carts + (quirk(w, 'strong') ? 8 : 0);
const craftSpeed = role => (role === 'sawyer' ? 1 + 0.3 * S.blades : role === 'carpenter' ? 1 + 0.3 * S.chisels : 1) * (lodgeDone(4) ? 1.25 : 1) * (SEA === 1 ? 1.2 : 1);
const benchPace = w => wPace(w) * (w.quirk === 'nimble' ? 1.25 : 1);
const craftBatch = (role, w) => (role === 'sawyer' ? 6 + 2 * S.blades : role === 'carpenter' ? 6 + 2 * S.chisels : 9) + (quirk(w, 'strong') ? (RECIPE[role].per === 3 ? 3 : 2) : 0);
const builderCap = w => BUILDER_CARRY + (quirk(w, 'strong') ? 2 : 0);
const restPace = w => w.quirk === 'early' ? 2 : w.quirk === 'dreamer' ? 0.5 : 1;
const plantTo = () => Math.min(0.9, 0.5 + 0.1 * S.seeds);

// ---------------------------------------------------------------- new game
function blankState(slot, seed) {
  const z = n => new Array(n).fill(0);
  return {
    v: 3, slot, seed, created: Date.now(), savedAt: 0, playTime: 0,
    coins: 0, inv: z(NI), sold: z(NI), seen: z(NI), autosell: z(NI), keep: z(NI),
    stats: { chopped: 0, delivered: 0, sales: 0, earned: 0, cut: z(NT), made: { plank: 0, furn: 0, char: 0 }, orders: 0, planted: 0 },
    axe: 1, crewAxe: 1, boots: 0, pack: 0, crewBoots: 0, crewPack: 0, seeds: 0, blades: 0, carts: 0, chisels: 0,
    buildings: [{ id: 1, type: 'yard', x: CX - 2, y: CY - 2 }], nextId: 2,
    workers: [], piles: [], goalsDone: {}, won: false, lodgeStage: 0, lodgeStep: 0,
    hats: [], hat: null, crewHat: null, gait: 0, hatPity: 0,
    orders: [], orderT: 60,
    anc: ANCIENT_HP.map(hp => ({ hp, done: false, call: false, heap: 0 })),      // the Ancient tree of each ring; heap: timbers lying by its stump
    span: ANCIENT_HP.map(() => ({ got: 0, call: false })),              // span[k]: the bridge over river k; got: timbers hammered in
    bridges: [], reach: 0,                                              // reach: the outermost river bridged
    player: { x: YARD_X, y: (CY + 1) * TS + 12, face: 1, carry: [] },
  };
}
function resetWorker(w) {
  Object.assign(w, { st: 'idle', path: [], wait: Math.random(), target: -1, carry: w.carry || [], res: 0, swing: 0, workT: 0, tick: 0, drop: 0, walkT: Math.random() * 3, moving: false, note: '', face: w.face || 1, anc: -1, slot: 0, tim: 0 });
  if (w.gait == null) w.gait = (Math.random() * GAITS.length) | 0;
  if (!QUIRK[w.quirk]) w.quirk = QUIRKS[(Math.random() * QUIRKS.length) | 0].id;
  w.xp = +w.xp || 0; w.lvl = skillOf(w.xp);
}
function resetTransient() {
  const P = S.player;
  Object.assign(P, { st: 'idle', path: [], queue: [], own: [], auto: false, target: -1, swing: 0, pause: 0, walkT: 0, moving: false, drop: 0, anc: -1, tim: 0, span: 0, workT: 0, tick: 0 });
  SEA = seasonNow();
  for (const sl of W.ancSlots) sl.fill(0);
  P.carry = P.carry || [];
  for (const w of S.workers) { w.carry = []; resetWorker(w); }
  W.pileAt.clear(); W.pileById.clear();
  for (const p of S.piles) { p.res = 0; p.t = p.t || 0; W.pileAt.set(p.i, p); W.pileById.set(p.id, p); }
}
function newGame(slot) {
  S = blankState(slot, (Math.random() * 2e9) | 0);
  S.seen[0] = 1; S.gait = (Math.random() * GAITS.length) | 0;
  genMap(S.seed); rebuildBlocks(); resetTransient();
}

// ---------------------------------------------------------------- pathfinding (water, rocks and buildings block; trees don't)
const PF = { g: new Float32Array(NTILES), from: new Int32Array(NTILES), seen: new Uint32Array(NTILES), done: new Uint32Array(NTILES), gen: 0 };
function blockedPx(x, y) { const tx = Math.floor(x / TS), ty = Math.floor(y / TS); return !inMap(tx, ty) || W.block[idx(tx, ty)] === 1; }
function los(x0, y0, x1, y1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
  for (let k = 1; k < n; k++) if (blockedPx(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)) return false;
  return true;
}
function findPath(sx, sy, tx, ty) {
  const dest = { x: tx, y: ty };
  if (los(sx, sy, tx, ty)) return [dest];
  const tile = (x, y) => idx(clamp(Math.floor(x / TS), 0, MW - 1), clamp(Math.floor(y / TS), 0, MH - 1));
  const s0 = tile(sx, sy), t0 = tile(tx, ty);
  if (W.block[t0] || s0 === t0) return [dest];
  const gen = ++PF.gen, hi = [], hf = [];
  const push = (i, f) => {
    let k = hi.length; hi.push(i); hf.push(f);
    while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hi[k] = hi[p]; hf[k] = hf[p]; k = p; }
    hi[k] = i; hf[k] = f;
  };
  const pop = () => {
    const top = hi[0], li = hi.pop(), lf = hf.pop(), n = hi.length;
    if (n) {
      let k = 0;
      for (;;) { let c = k * 2 + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hi[k] = hi[c]; hf[k] = hf[c]; k = c; }
      hi[k] = li; hf[k] = lf;
    }
    return top;
  };
  const txx = t0 % MW, tyy = (t0 / MW) | 0;
  const h = i => { const dx = Math.abs(i % MW - txx), dy = Math.abs(((i / MW) | 0) - tyy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  PF.g[s0] = 0; PF.seen[s0] = gen; PF.from[s0] = -1; push(s0, h(s0));
  let found = false, guard = 0;
  while (hi.length && guard++ < 40000) {
    const c = pop();
    if (c === t0) { found = true; break; }
    if (PF.done[c] === gen) continue; PF.done[c] = gen;
    const cx = c % MW, cy = (c / MW) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy; if (!inMap(nx, ny)) continue;
      const ni = idx(nx, ny); if (W.block[ni] || PF.done[ni] === gen) continue;
      if (dx && dy && (W.block[idx(cx + dx, cy)] || W.block[idx(cx, cy + dy)])) continue;
      const g = PF.g[c] + (dx && dy ? 1.414 : 1);
      if (PF.seen[ni] !== gen || g < PF.g[ni]) { PF.g[ni] = g; PF.seen[ni] = gen; PF.from[ni] = c; push(ni, g + h(ni)); }
    }
  }
  if (!found) return [dest];
  const pts = [];
  for (let c = PF.from[t0]; c !== -1 && c !== s0; c = PF.from[c]) pts.push({ x: (c % MW) * TS + 8, y: ((c / MW) | 0) * TS + 8 });
  pts.reverse(); pts.push(dest);
  const out = []; let px = sx, py = sy, i = 0;      // pull the path taut
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !los(px, py, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]); px = pts[j].x; py = pts[j].y; i = j + 1;
  }
  return out;
}
function goTo(e, x, y) { e.path = findPath(e.x, e.y, x, y); }
function moveStep(e, dt, speed) {
  let left = speed * dt;
  while (left > 0 && e.path.length) {
    const p = e.path[0], dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.6) e.face = dx > 0 ? 1 : -1;
    if (d <= left) { e.x = p.x; e.y = p.y; left -= d; e.path.shift(); }
    else { e.x += dx / d * left; e.y += dy / d * left; left = 0; }
  }
  e.moving = e.path.length > 0; e.walkT += dt;
  return !e.path.length;
}
// The nearest tile to (cx, cy) that passes `test`, searching outward in rings, as far as maxR tiles if that is given.
function nearestTile(cx, cy, test, maxR = 1e9) {
  let best = -1, bd = 1e9, stop = maxR;
  const look = (x, y) => {
    if (x < 0 || y < 0 || x >= MW || y >= MH) return;
    const i = y * MW + x; if (!test(i)) return;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < bd) { bd = d; best = i; }
  };
  for (let r = 0; r <= stop; r++) {
    const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
    if (x0 < 0 && y0 < 0 && x1 >= MW && y1 >= MH) break;
    for (let x = x0; x <= x1; x++) { look(x, y0); if (r) look(x, y1); }
    for (let y = y0 + 1; y < y1; y++) { look(x0, y); look(x1, y); }
    if (best >= 0 && stop === maxR) stop = Math.min(maxR, Math.ceil(r * 1.42) + 1);
  }
  return best;
}

// ---------------------------------------------------------------- trees, piles, money
const canCut = (axe, kind) => axe >= kind;
const isMature = i => W.kind[i] > 0 && W.g[i] >= 1;
function hitTree(i, dmg, who) {
  const k = W.kind[i]; if (!k || W.g[i] < 1) return true;
  const hp = (W.hp.has(i) ? W.hp.get(i) : TREES[k - 1].hp) - dmg, p = treeXY(i);
  W.shake.set(i, 0.22);
  EV.push({ t: 'chop', x: p.x, y: p.y, k, side: who.x < p.x ? -1 : 1, me: who === S.player });
  if (hp > 0) { W.hp.set(i, hp); return false; }
  fellTree(i, who); return true;
}
function fellTree(i, who) {
  const k = W.kind[i], T = TREES[k - 1], p = treeXY(i), me = who === S.player;
  W.hp.delete(i); W.claim.delete(i); setGrow(i, 0); W.growing.add(i);
  // a half-log yield alternates: the 1st, 3rd, 5th… tree of a kind drops the extra log
  const logs = Math.floor(T.logs) + (T.logs % 1 && S.stats.cut[k - 1] % 2 === 0 ? 1 : 0);
  const pile = { id: S.nextId++, i, type: k - 1, n: logs, res: 0, t: 0.75 };
  S.piles.push(pile); W.pileAt.set(i, pile); W.pileById.set(pile.id, pile);
  S.stats.chopped++; S.stats.cut[k - 1]++; S.seen[k - 1] = 1;
  EV.push({ t: 'fall', x: p.x, y: p.y, k, v: W.vr[i], dir: who.x < p.x ? 1 : -1, me });
  // a hat may be hiding in the branches
  const pool = HATS.filter(h => (h.tree === k - 1 || h.season === SEA) && !S.hats.includes(h.id));
  if (pool.length) {
    const chance = (me ? 0.04 + 0.012 * S.hatPity : who.quirk === 'magnet' ? 0.036 : 0.006) * (SEA === 2 ? 2 : 1);
    if (Math.random() < chance) { const h = pool[(Math.random() * pool.length) | 0]; S.hats.push(h.id); if (me) S.hatPity = 0; EV.push({ t: 'hat', hat: h, x: p.x, y: p.y, me: true }); }
    else if (me) S.hatPity++;
  }
  return pile;
}

// ---------------------------------------------------------------- Ancient trees
const ancLeft = () => S.anc.filter(a => !a.done).length;
const ANC_SLOT = [[11, 3], [17, 1], [13, 8], [22, 4], [19, 10], [25, 2]];        // all in front of the trunk, so nobody hides behind it
// where the lumberjack in a slot stands: alternate sides of the trunk
function ancSpot(r, slot) { const A = W.anc[r], side = slot & 1 ? 1 : -1, o = ANC_SLOT[(slot >> 1) % ANC_SLOT.length]; return { x: A.x + side * o[0], y: A.y + o[1] }; }
// a called Ancient tree with room for one more axe: [ring, slot], or null
function ancJob() {
  for (let r = 0; r <= S.reach && r < NT; r++) {
    const A = S.anc[r];
    if (!A.call || A.done || !canCut(S.crewAxe, r + 1)) continue;
    const s = W.ancSlots[r].indexOf(0);
    if (s >= 0) return [r, s];
  }
  return null;
}
function hitAncient(r, dmg, who) {
  const A = S.anc[r], T = W.anc[r]; if (A.done) return true;
  A.hp -= dmg; W.ancShake[r] = 0.22;
  EV.push({ t: 'chop', x: T.x, y: T.y, k: r + 1, side: who.x < T.x ? -1 : 1, me: who === S.player, anc: 1 });
  if (A.hp > 0) return false;
  fellAncient(r, who); return true;
}
function fellAncient(r, who) {
  const A = S.anc[r], T = W.anc[r];
  A.hp = 0; A.done = true; A.call = false;
  if (r + 1 < NT) A.heap = ANCIENT_TIMBER[r];           // its timbers lie by the stump, waiting to become a bridge
  else {                                                // the last one has no river beyond it
    let i = T.i + MW; if (W.pileAt.has(i) || W.block[i]) i = T.i + MW + 1;
    const pile = { id: S.nextId++, i, type: r, n: ANCIENT_LOGS, res: 0, t: 1.5 };
    S.piles.push(pile); W.pileAt.set(i, pile); W.pileById.set(pile.id, pile);
  }
  S.stats.chopped++; S.stats.cut[r]++; S.seen[r] = 1;
  EV.push({ t: 'fall', x: T.x, y: T.y, k: r + 1, anc: r, dir: who.x < T.x ? 1 : -1, me: true });
  // there is always a hat in an Ancient tree, as long as one is left to find
  const mine = HATS.filter(h => h.tree === r && !S.hats.includes(h.id)), any = HATS.filter(h => h.tree >= 0 && !S.hats.includes(h.id));
  const pool = mine.length ? mine : any, hat = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
  if (hat) S.hats.push(hat.id);
  EV.push({ t: 'ancient', r, hat, x: T.x, y: T.y });
}
function callCrew(r, on) {
  const A = S.anc[r]; if (!A || A.done) return false;
  A.call = !!on;
  if (on) for (const w of S.workers) if (w.role === 'jack' && (w.st === 'idle' || w.st === 'home')) w.wait = Math.min(w.wait, Math.random() * 0.5);
  return true;
}
// returns: ok | done | river | tough
function cmdAncient(r) {
  const P = S.player, A = S.anc[r], T = W.anc[r];
  dropTimber(P); P.span = 0;
  if (A.done) return 'done';
  if (r > S.reach) return 'river';
  if (!canCut(S.axe, r + 1)) return 'tough';
  P.auto = true; P.queue = []; P.anc = r; P.st = 'toAnc';
  const side = P.x < T.x ? -1 : 1; goTo(P, T.x + side * 10, T.y + 6);
  return 'ok';
}

// ---------------------------------------------------------------- rivers and bridges
const canReach = i => W.reg[i] <= S.reach;
function applyBridge(b) {
  for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
    const i = idx(b.x + xx, b.y + yy);
    W.ter[i] = TER.BRIDGE; W.orig[i] = 0;
    if (W.kind[i]) { W.kind[i] = 0; W.growing.delete(i); W.hp.delete(i); W.claim.delete(i); W.dirty.push(i); }
  }
}
// why the bridge over river k can't be started yet, or '' if it can
function bridgeLock(k) {
  if (k > S.reach + 1) return 'Bridge the ' + RIVER_NAMES[k - 1] + ' River first';
  if (k === S.reach + 1 && !S.anc[k - 1].done) return 'Fell the Ancient ' + TREES[k - 1].name + ' first';
  return '';
}
// The bridge being built is always the one over the next river, once the Ancient tree before it is down.
const spanOpen = k => k >= 1 && k < NT && k === S.reach + 1 && S.anc[k - 1].done;
const spanNow = () => spanOpen(S.reach + 1) ? S.reach + 1 : 0;
const spanCrew = k => S.workers.reduce((n, w) => n + (w.tim === k ? 1 : 0), 0);
const heapSpot = r => { const T = W.anc[r]; return { x: T.x + 5, y: T.y + 19 }; };        // where the timbers lie
// someone carrying timber gives it up: it goes back on the heap
function dropTimber(e) {
  if (!e.tim) return;
  if (e.carry.length) { S.anc[e.tim - 1].heap += e.carry.length; e.carry = []; }
  e.tim = 0;
}
// send e to fetch a load of timber for the bridge over river k; false if there is none left to fetch
function spanTrip(e, k) {
  if (!spanOpen(k) || S.anc[k - 1].heap <= 0) return false;
  const h = heapSpot(k - 1), side = e.x < h.x ? -1 : 1;
  e.tim = k; e.st = 'toHeap'; goTo(e, h.x + side * (7 + Math.random() * 5), h.y + 1 + Math.random() * 5);
  return true;
}
// at the heap: shoulder up to cap timbers and set off for the crossing
function spanLoad(e, cap) {
  const k = e.tim, A = S.anc[k - 1], n = spanOpen(k) ? Math.min(cap, A.heap) : 0;
  if (n <= 0) { e.tim = 0; return false; }
  A.heap -= n; for (let j = 0; j < n; j++) e.carry.push(LOG(k - 1));
  const s = W.site[k], p = siteEnd(s, 1);
  e.st = 'toSpan'; goTo(e, p.x + (s.v ? (Math.random() - 0.5) * 22 : (Math.random() - 0.5) * 6), p.y + (s.v ? (Math.random() - 0.5) * 6 : (Math.random() - 0.5) * 22));
  EV.push({ t: 'pick', x: e.x, y: e.y, me: e === S.player });
  return true;
}
// at the crossing: hammer the timbers in one by one. Returns true when the load is used up.
function spanHammer(e, dt, pace) {
  const k = e.tim, sp = S.span[k], s = W.site[k];
  e.moving = false; e.workT -= dt * pace; e.tick -= dt;
  if (e.tick <= 0) { e.tick = 0.5; const p = siteEnd(s, 1); EV.push({ t: 'work', role: 'span', x: p.x, y: p.y, wx: e.x, wy: e.y }); }
  while (e.workT <= 0 && e.carry.length && spanOpen(k)) {
    e.carry.pop(); sp.got++; e.workT += BRIDGE_TIME;
    if (sp.got >= ANCIENT_TIMBER[k - 1]) { e.carry = []; finishSpan(k); }
  }
  if (e.carry.length && spanOpen(k)) return false;
  e.carry = []; e.tim = 0; return true;
}
function finishSpan(k) {
  const s = W.site[k], br = { k, x: s.x, y: s.y, w: s.w, h: s.h, v: s.v };
  S.span[k].call = false; S.anc[k - 1].heap = 0;
  S.bridges.push(br); applyBridge(br); rebuildBlocks();
  S.reach = Math.max(S.reach, k);
  EV.push({ t: 'bridge', k, first: true, x: (s.x + s.w / 2) * TS, y: (s.y + s.h / 2) * TS });
}
// send every hauler to the bridge (or back to their log piles)
function sendHaulers(k, on) {
  if (!spanOpen(k)) return false;
  S.span[k].call = !!on;
  for (const w of S.workers) if (w.role === 'hauler' && (w.st === 'idle' || w.st === 'home')) w.wait = Math.min(w.wait, Math.random() * 0.6);
  return true;
}
// you carry timbers to the bridge yourself, load after load. returns: ok | closed
function cmdSpan(k) {
  const P = S.player;
  if (!spanOpen(k)) return 'closed';
  P.auto = true; P.queue = []; P.own = []; P.span = k;
  if (P.st === 'toHeap' || P.st === 'toSpan' || P.st === 'hammer') return 'ok';
  if (P.carry.length) goDrop(P); else if (!spanTrip(P, k)) { P.span = 0; return 'closed'; }
  return 'ok';
}

function takeFromPile(e, pile, want) {
  const n = Math.min(want, pile.n);
  for (let k = 0; k < n; k++) e.carry.push(pile.type);
  pile.n -= n;
  if (pile.n <= 0) { S.piles.splice(S.piles.indexOf(pile), 1); W.pileAt.delete(pile.i); W.pileById.delete(pile.id); }
  if (n) EV.push({ t: 'pick', x: e.x, y: e.y, me: e === S.player });
  return n;
}
const spare = it => Math.max(0, S.inv[it] - S.keep[it]);     // what may be sold or used, above the amount held back
function sell(it, n) {
  n = Math.min(n, S.inv[it]); if (n <= 0) return 0;
  const v = n * ITEMS[it].price;
  S.inv[it] -= n; S.sold[it] += n; S.coins += v; S.stats.sales += n; S.stats.earned += v;
  return v;
}
function sellAll() { let v = 0; for (let it = 0; it < NI; it++) v += sell(it, spare(it)); return v; }
const depotLoad = b => b.store.reduce((a, n) => a + n, 0);
// where a load of logs should go: the yard, or a staffed depot with room if that is nearer
function dropFor(e) {
  let best = yard(); const d0 = bDoor(best); let bd = Math.hypot(d0.x - e.x, d0.y - e.y);
  for (const b of S.buildings) {
    if (b.type !== 'depot' || depotLoad(b) >= DEPOT_ROOM || !S.workers.some(w => w.home === b.id)) continue;
    const d = bDoor(b), dd = Math.hypot(d.x - e.x, d.y - e.y);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}
const yardDrop = () => { const d = bDoor(yard()); return { x: d.x - 26 + Math.random() * 30, y: d.y + Math.random() * 4 }; };
function goDrop(e, b) {
  b = b || dropFor(e); e.drop = b.id; e.st = 'toYard';
  const d = b.type === 'yard' ? yardDrop() : { x: bDoor(b).x - 10 + Math.random() * 20, y: bDoor(b).y + Math.random() * 4 };
  goTo(e, d.x, d.y);
}
function deposit(e) {
  const b = W.bById.get(e.drop), depot = b && b.type === 'depot' ? b : null;
  let coins = 0; const n = e.carry.length;
  for (const it of e.carry) {
    const log = ITEMS[it].kind === 'log';
    if (log && e.role !== 'carter') S.stats.delivered++;
    if (depot && log) { depot.store[it]++; continue; }
    S.inv[it]++; S.seen[it] = 1;
    if (S.autosell[it] && S.inv[it] > S.keep[it]) coins += sell(it, 1);
  }
  e.carry = [];
  if (n) EV.push({ t: 'deposit', x: e.x, y: e.y, n, coins, me: e === S.player });
}
const canAfford = c => S.coins >= c.coins && c.wood.every(([t, n]) => S.inv[t] >= n);
function pay(c) { S.coins -= c.coins; for (const [t, n] of c.wood) S.inv[t] -= n; }

// ---------------------------------------------------------------- you
function startChop(e, i) {
  const p = treeXY(i), side = e.x < p.x ? -1 : 1;
  e.target = i; e.st = 'toTree'; goTo(e, p.x + side * 7, p.y + 2);
}
// returns: ok | queued | unqueue | same | young | tough | none | full | river
function cmdChop(i) {
  const P = S.player, k = W.kind[i];
  if (!k) return 'none';
  if (!canReach(i)) return 'river';
  if (W.g[i] < 1) return 'young';
  if (!canCut(S.axe, k)) return 'tough';
  dropTimber(P); P.span = 0;
  P.auto = true;
  const busy = P.st === 'toTree' || P.st === 'chop';
  if (busy && P.target === i) return 'same';
  const q = P.queue.indexOf(i);
  if (q >= 0) { P.queue.splice(q, 1); return 'unqueue'; }
  if (busy) { if (P.queue.length >= 8) return 'full'; P.queue.push(i); return 'queued'; }
  startChop(P, i); return 'ok';
}
function cmdPile(pile) {
  const P = S.player;
  dropTimber(P); P.span = 0;
  P.auto = true; P.queue = [];
  if (!P.own.includes(pile.id)) P.own.push(pile.id);
  if (P.carry.length >= playerCap()) { goDrop(P); return; }
  goPile(P, pile);
}
function cmdDrop(b) {
  const P = S.player; if (!P.carry.length || P.tim) return false;
  P.span = 0; P.auto = true; P.queue = []; goDrop(P, b); return true;
}
function cmdWalk(x, y) {
  const P = S.player, tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  if (inMap(tx, ty) && !canReach(idx(tx, ty))) return false;
  dropTimber(P); P.span = 0;
  P.auto = false; P.queue = []; P.st = 'walk'; goTo(P, x, y);
  return true;
}
function goPile(e, pile) {
  const p = pileXY(pile), side = e.x < p.x ? -1 : 1;
  e.target = pile.id; e.st = 'toPile'; goTo(e, p.x + side * 8, p.y + 1);
}
function playerThink() {
  const P = S.player;
  if (P.span) {             // on bridge duty: back to the heap for another load
    if (P.carry.length && !P.tim) { goDrop(P); return; }
    if (spanTrip(P, P.span)) return;
    P.span = 0;
  }
  while (P.queue.length) { const i = P.queue.shift(); if (isMature(i) && canCut(S.axe, W.kind[i])) { startChop(P, i); return; } }
  P.own = P.own.filter(id => { const p = W.pileById.get(id); return p && p.n - p.res > 0; });
  if (P.carry.length >= playerCap() || (P.carry.length && !P.own.length)) { goDrop(P); return; }
  if (P.own.length) {
    let best = null, bd = 1e9;
    for (const id of P.own) { const p = W.pileById.get(id), q = pileXY(p), d = Math.hypot(q.x - P.x, q.y - P.y); if (d < bd) { bd = d; best = p; } }
    goPile(P, best); return;
  }
  P.auto = false;
}
function updPlayer(dt) {
  const P = S.player, sp = playerSpeed();
  if (P.swing > 0) P.swing -= dt;
  switch (P.st) {
    case 'idle':
      P.moving = false;
      if (P.pause > 0) { P.pause -= dt; break; }
      if (P.auto) playerThink();
      break;
    case 'walk': if (moveStep(P, dt, sp)) P.st = 'idle'; break;
    case 'toTree':
      if (!isMature(P.target)) { P.st = 'idle'; break; }
      if (moveStep(P, dt, sp)) { P.st = 'chop'; P.swing = PLAYER_SWING * 0.6; P.face = treeXY(P.target).x > P.x ? 1 : -1; }
      break;
    case 'chop':
      P.moving = false;
      if (!isMature(P.target)) { P.st = 'idle'; break; }
      if (P.swing <= 0) {
        P.swing += PLAYER_SWING;
        const i = P.target;
        if (hitTree(i, S.axe, P)) { const pile = W.pileAt.get(i); if (pile) P.own.push(pile.id); P.st = 'idle'; P.pause = 0.8; P.swing = 0; }
      }
      break;
    case 'toPile': {
      const pile = W.pileById.get(P.target);
      if (!pile || pile.n - pile.res <= 0) { P.st = 'idle'; break; }
      if (moveStep(P, dt, sp)) {
        if (pile.t > 0) break;
        takeFromPile(P, pile, Math.min(playerCap() - P.carry.length, pile.n - pile.res));
        P.st = 'idle'; P.pause = 0.15;
      }
      break;
    }
    case 'toYard': if (moveStep(P, dt, sp)) { deposit(P); P.st = 'idle'; P.pause = 0.2; } break;
    case 'toHeap':
      if (!spanOpen(P.tim)) { dropTimber(P); P.st = 'idle'; break; }
      if (moveStep(P, dt, sp)) { if (!spanLoad(P, playerCap())) { P.st = 'idle'; P.span = 0; } }
      break;
    case 'toSpan':
      if (!spanOpen(P.tim)) { dropTimber(P); P.st = 'idle'; break; }
      if (moveStep(P, dt, sp)) { const e = siteEnd(W.site[P.tim], 0); P.st = 'hammer'; P.workT = BRIDGE_TIME; P.tick = 0; P.face = (W.site[P.tim].v ? P.face : e.x > P.x ? 1 : -1); }
      break;
    case 'hammer':
      if (spanHammer(P, dt, 1)) { P.st = 'idle'; P.pause = 0.2; }
      break;
    case 'toAnc':
      if (!S.anc[P.anc] || S.anc[P.anc].done) { P.st = 'idle'; break; }
      if (moveStep(P, dt, sp)) { P.st = 'chopAnc'; P.swing = PLAYER_SWING * 0.6; P.face = W.anc[P.anc].x > P.x ? 1 : -1; }
      break;
    case 'chopAnc':
      P.moving = false;
      if (!S.anc[P.anc] || S.anc[P.anc].done) { P.st = 'idle'; P.auto = false; break; }
      if (P.swing <= 0) { P.swing += PLAYER_SWING; if (hitAncient(P.anc, S.axe, P)) { P.st = 'idle'; P.auto = false; P.pause = 0.8; P.swing = 0; } }
      break;
  }
}

// ---------------------------------------------------------------- the crew
function releaseWorker(w) {
  dropTimber(w);
  if (w.anc >= 0) { const sl = W.ancSlots[w.anc]; if (sl && sl[w.slot] === w.id) sl[w.slot] = 0; w.anc = -1; }
  if ((w.role === 'jack' || w.role === 'forester') && w.target >= 0 && W.claim.get(w.target) === w.id) W.claim.delete(w.target);
  if (w.role === 'hauler' && w.res) { const p = W.pileById.get(w.target); if (p) p.res = Math.max(0, p.res - w.res); w.res = 0; }
  if (w.role === 'builder' && w.carry.length) { const b = W.bById.get(w.home); for (const it of w.carry) { S.inv[it]++; if (b && b.tr[it]) b.tr[it]--; } w.carry = []; }
}
// A cabin set to one wood hauls that wood first, and only clears other piles when none of its own are waiting.
function findPileFor(w, home, near) {
  const hd = bDoor(home); let best = null, bs = 1e9, other = null, os = 1e9;
  for (const p of S.piles) {
    if (p.n - p.res <= 0) continue;
    const q = pileXY(p), dw = Math.hypot(q.x - w.x, q.y - w.y);
    if (near && dw > near) continue;
    const s = Math.hypot(q.x - hd.x, q.y - hd.y) + dw * 0.5;
    if (home.wood >= 0 && p.type !== home.wood) { if (s < os) { os = s; other = p; } }
    else if (s < bs) { bs = s; best = p; }
  }
  return best || other;
}
// what a sawyer, collier or carpenter should fetch next: -1 if the yard has nothing spare for them
function pickInput(role, b) {
  const R = RECIPE[role], ok = t => spare(R.inp(t)) >= R.per;
  if (b.wood >= 0) return b.wood < R.types && ok(b.wood) ? b.wood : -1;
  if (role === 'collier') { for (let t = 0; t < R.types; t++) if (ok(t)) return t; return -1; }   // cheapest wood first
  for (let t = R.types - 1; t >= 0; t--) if (ok(t)) return t;                                     // best wood first
  return -1;
}
const WOOD_NAME = b => b.wood >= 0 ? TREES[b.wood].name : '';
function tryJob(w, home) {
  const hx = home.x + (BUILD[home.type].w >> 1), hy = home.y + 1, P = S.player;
  if (w.role === 'builder') {
    if (w.carry.length) releaseWorker(w);
    const it = lodgeWants(home);
    if (it < 0) {
      const st = lodgeStep(), miss = st && st.need.find(([i, n]) => (home.got[i] || 0) + (home.tr[i] || 0) < n);
      w.note = !st ? 'Admiring the finished Lodge' : miss ? 'Waiting for ' + ITEMS[miss[0]].name.toLowerCase() + ' in the yard' : 'Waiting for the coins to be paid';
      return false;
    }
    const d = yardDrop(); w.st = 'fetch'; goTo(w, d.x, d.y); w.note = 'Fetching ' + ITEMS[it].name.toLowerCase();
    return true;
  }
  if (w.carry.length && w.role !== 'hauler') { goDrop(w, yard()); w.note = 'Taking a load to the yard'; return true; }
  switch (w.role) {
    case 'jack': {
      const aj = ancJob();
      if (aj) {           // the call has gone out: every free axe to the Ancient tree
        const [r, sl] = aj, p = ancSpot(r, sl);
        W.ancSlots[r][sl] = w.id; w.anc = r; w.slot = sl; w.st = 'toAnc'; goTo(w, p.x, p.y);
        w.note = 'Off to the Ancient ' + TREES[r].name; return true;
      }
      const want = home.wood, top = Math.min(S.crewAxe, S.reach + 1);
      if (want >= 0 && !canCut(S.crewAxe, want + 1)) { w.note = 'Needs the ' + AXES[want + 1].name + ' to cut ' + TREES[want].name; return false; }
      if (want > S.reach) { w.note = 'The ' + RIVER_NAMES[want] + ' River is in the way of the ' + TREES[want].name; return false; }
      const i = nearestTile(hx, hy, t => W.kind[t] > 0 && W.g[t] >= 1 && (want < 0 ? W.kind[t] <= top : W.kind[t] === want + 1) && !W.claim.has(t) && !(P.target === t && (P.st === 'chop' || P.st === 'toTree')));
      if (i < 0) { w.note = 'Waiting for ' + (want >= 0 ? TREES[want].name : 'trees') + ' to grow back'; return false; }
      W.claim.set(i, w.id); startChop(w, i); w.note = 'Off to chop ' + TREES[W.kind[i] - 1].name; return true;
    }
    case 'hauler': {
      const k = spanNow();
      if (k && S.span[k].call && S.anc[k - 1].heap > 0) {          // sent to the bridge
        if (w.carry.length) { goDrop(w); w.note = 'Dropping these logs off first'; return true; }
        if (spanTrip(w, k)) { w.note = 'Fetching timber for the bridge'; return true; }
      }
      const room = haulerCap(w) - w.carry.length;
      const p = room > 0 ? findPileFor(w, home, w.carry.length ? 8 * TS : 0) : null;
      if (p) { w.res = Math.min(room, p.n - p.res); p.res += w.res; goPile(w, p); w.note = 'Fetching ' + TREES[p.type].name + ' logs'; return true; }
      if (w.carry.length) { goDrop(w); w.note = 'Hauling ' + w.carry.length + ' logs in'; return true; }
      w.note = 'No logs to haul';
      return false;
    }
    case 'forester': {
      const want = home.wood;
      const i = nearestTile(hx, hy, t => W.kind[t] > 0 && W.g[t] < 0.45 && W.reg[t] <= S.reach && (want < 0 || W.kind[t] === want + 1) && !W.pileAt.has(t) && !W.claim.has(t));
      if (i < 0) { w.note = 'No stumps to replant'; return false; }
      W.claim.set(i, w.id); startChop(w, i); w.note = 'Off to replant ' + TREES[W.kind[i] - 1].name; return true;
    }
    case 'carter': {
      const d = bDoor(home);
      if (Math.hypot(d.x - w.x, d.y - w.y) > 26) { w.st = 'load'; goTo(w, d.x - 8 + Math.random() * 16, d.y + Math.random() * 4); w.note = 'Heading back to the depot'; return true; }
      const load = depotLoad(home), cap = carterCap(w);
      w.tick += 1;
      if (load <= 0 || (load < Math.min(cap, 12) && w.tick < 6)) { w.note = load ? 'Waiting for a fuller load' : 'The depot is empty'; return false; }
      w.tick = 0;
      for (let it = NT - 1; it >= 0 && w.carry.length < cap; it--) while (home.store[it] > 0 && w.carry.length < cap) { home.store[it]--; w.carry.push(it); }
      goDrop(w, yard()); w.note = 'Carting ' + w.carry.length + ' logs to the yard';
      EV.push({ t: 'pick', x: w.x, y: w.y });
      return true;
    }
    default: {      // sawyer, collier, carpenter
      const t = pickInput(w.role, home);
      if (t < 0) { w.note = 'Waiting for ' + (w.role === 'carpenter' ? 'planks' : 'logs') + ' to spare in the yard'; return false; }
      const d = yardDrop(); w.st = 'fetch'; goTo(w, d.x, d.y); w.note = 'Fetching ' + ITEMS[RECIPE[w.role].inp(t)].name.toLowerCase();
      return true;
    }
  }
}
// seconds between a lumberjack's swings
const crewSwing = (w, home) => CREW_SWING / ((home.foreman ? 1.3 : 1) * wPace(w) * (w.quirk === 'swing' ? 1.25 : 1));
function updWorker(w, dt) {
  const home = W.bById.get(w.home), sp = crewSpeed(w, home), boss = (home.foreman ? 1.3 : 1) * wPace(w);
  if (w.swing > 0) w.swing -= dt;
  if (w.st !== 'idle' && w.st !== 'home') {         // time on the job
    w.xp += w.quirk === 'dreamer' ? dt * 2 : dt;
    if (w.lvl < SKILL.length - 1 && w.xp >= SKILL[w.lvl + 1].at) { w.lvl++; EV.push({ t: 'skill', w, x: w.x, y: w.y }); }
  }
  switch (w.st) {
    case 'idle':
    case 'home':
      if (w.st === 'home') { if (moveStep(w, dt, sp * 0.8)) w.st = 'idle'; } else w.moving = false;
      w.wait -= dt * restPace(w);
      if (w.wait > 0) break;
      if (!tryJob(w, home)) {
        w.wait = 1.8 + Math.random();
        const d = bDoor(home);
        if (w.st === 'idle' && Math.hypot(d.x - w.x, d.y - w.y) > 34) { w.st = 'home'; goTo(w, d.x - 14 + Math.random() * 28, d.y + Math.random() * 12); }
      }
      break;
    case 'toTree': {
      const i = w.target, plant = w.role === 'forester';
      const ok = plant ? (W.kind[i] > 0 && W.g[i] < 0.45 && !W.pileAt.has(i)) : isMature(i);
      if (!ok) { releaseWorker(w); w.st = 'idle'; w.wait = 0.2; break; }
      if (moveStep(w, dt, sp)) {
        w.face = treeXY(i).x > w.x ? 1 : -1;
        if (plant) { w.st = 'plant'; w.workT = 1.4; w.note = 'Replanting ' + TREES[W.kind[i] - 1].name; }
        else { w.st = 'chop'; w.swing = CREW_SWING * 0.6; w.note = 'Chopping ' + TREES[W.kind[i] - 1].name; }
      }
      break;
    }
    case 'chop':
      w.moving = false;
      if (!isMature(w.target)) { releaseWorker(w); w.st = 'idle'; w.wait = 0.2; break; }
      if (w.swing <= 0) { w.swing += crewSwing(w, home); if (hitTree(w.target, S.crewAxe, w)) { w.st = 'idle'; w.wait = 1.6 / boss; w.swing = 0; w.target = -1; } }
      break;
    case 'toHeap':
      if (!spanOpen(w.tim) || !S.span[w.tim].call) { releaseWorker(w); w.st = 'idle'; w.wait = 0.3; break; }
      if (moveStep(w, dt, sp)) {
        if (spanLoad(w, haulerCap(w))) w.note = 'Carrying ' + w.carry.length + ' timbers to the ' + RIVER_NAMES[w.tim] + ' River';
        else { w.st = 'idle'; w.wait = 0.3; }
      }
      break;
    case 'toSpan':
      if (!spanOpen(w.tim)) { releaseWorker(w); w.st = 'idle'; w.wait = 0.3; break; }
      if (moveStep(w, dt, sp)) { const s = W.site[w.tim], e = siteEnd(s, 0); w.st = 'hammer'; w.workT = BRIDGE_TIME; w.tick = Math.random() * 0.5; if (!s.v) w.face = e.x > w.x ? 1 : -1; w.note = 'Hammering the bridge together'; }
      break;
    case 'hammer':
      if (spanHammer(w, dt, wPace(w))) { w.st = 'idle'; w.wait = 0.2; }
      break;
    case 'toAnc': {
      const A = S.anc[w.anc];
      if (!A || A.done || !A.call) { releaseWorker(w); w.st = 'idle'; w.wait = 0.3; break; }
      if (moveStep(w, dt, sp)) { w.st = 'chopAnc'; w.swing = CREW_SWING * 0.6 * Math.random(); w.face = W.anc[w.anc].x > w.x ? 1 : -1; w.note = 'Chopping the Ancient ' + TREES[w.anc].name; }
      break;
    }
    case 'chopAnc': {
      w.moving = false;
      const A = S.anc[w.anc];
      if (!A || A.done || !A.call) { releaseWorker(w); w.st = 'idle'; w.wait = 0.6 + Math.random(); break; }
      if (w.swing <= 0) { w.swing += crewSwing(w, home); hitAncient(w.anc, S.crewAxe, w); }
      break;
    }
    case 'plant': {
      w.moving = false; w.workT -= dt * boss * (w.quirk === 'thumb' ? 2 : 1);
      if (w.workT > 0) break;
      const i = w.target;
      if (W.kind[i] > 0 && W.g[i] < plantTo() && !W.pileAt.has(i)) { setGrow(i, plantTo()); S.stats.planted++; const p = treeXY(i); EV.push({ t: 'plant', x: p.x, y: p.y, k: W.kind[i] }); }
      releaseWorker(w); w.target = -1; w.st = 'idle'; w.wait = 0.4;
      break;
    }
    case 'toPile': {
      const pile = W.pileById.get(w.target);
      if (!pile) { w.res = 0; w.st = 'idle'; w.wait = 0.1; break; }
      if (moveStep(w, dt, sp)) {
        if (pile.t > 0) break;
        pile.res = Math.max(0, pile.res - w.res);
        takeFromPile(w, pile, w.res); w.res = 0;
        w.st = 'idle'; w.wait = 0.25;
      }
      break;
    }
    case 'toYard': if (moveStep(w, dt, sp)) { deposit(w); w.st = 'idle'; w.wait = 0.3; } break;
    case 'load': if (moveStep(w, dt, sp)) { w.st = 'idle'; w.wait = 0.3; } break;
    case 'fetch':
      if (w.role === 'builder') {
        if (!moveStep(w, dt, sp)) break;
        const st = lodgeStep();
        if (st) for (const [it, n] of st.need) {
          const take = Math.min(builderCap(w) - w.carry.length, S.inv[it], n - (home.got[it] || 0) - (home.tr[it] || 0));
          if (take > 0) { S.inv[it] -= take; home.tr[it] = (home.tr[it] || 0) + take; for (let k = 0; k < take; k++) w.carry.push(it); }
        }
        if (!w.carry.length) { w.st = 'idle'; w.wait = 2; break; }
        w.st = 'toWork'; const d = bDoor(home); goTo(w, d.x - 30 + Math.random() * 60, d.y + Math.random() * 5);
        EV.push({ t: 'pick', x: w.x, y: w.y }); w.note = 'Carrying ' + ITEMS[w.carry[0]].name.toLowerCase() + ' to the Lodge';
        break;
      }
      if (moveStep(w, dt, sp)) {
        const R = RECIPE[w.role], t = pickInput(w.role, home);
        if (t < 0) { w.st = 'idle'; w.wait = 2; w.note = 'Nothing to spare in the yard'; break; }
        const it = R.inp(t), n = Math.floor(Math.min(craftBatch(w.role, w), spare(it)) / R.per) * R.per;
        S.inv[it] -= n; for (let k = 0; k < n; k++) w.carry.push(it);
        w.target = t; w.st = 'toWork';
        const d = bDoor(home); goTo(w, d.x - 5 + Math.random() * 10, d.y + Math.random() * 3);
        EV.push({ t: 'pick', x: w.x, y: w.y });
        w.note = 'Carrying ' + ITEMS[it].name.toLowerCase() + ' to work';
      }
      break;
    case 'toWork':
      if (w.role === 'builder') { if (moveStep(w, dt, sp)) { w.st = 'work'; w.workT = w.carry.length * BUILDER_TIME / benchPace(w); w.tick = 0; w.note = 'Building the Lodge'; } break; }
      if (moveStep(w, dt, sp)) {
        const R = RECIPE[w.role];
        w.st = 'work'; w.workT = (w.carry.length / R.per) * R.time / (craftSpeed(w.role) * benchPace(w)); w.tick = 0; w.face = 1;
        w.note = w.role === 'sawyer' ? 'Sawing planks' : w.role === 'collier' ? 'Tending the kiln' : 'Building ' + FURN_NAMES[w.target] + 's';
      }
      break;
    case 'work': {
      w.moving = false; w.workT -= dt; w.tick -= dt;
      if (w.tick <= 0) { w.tick = 0.55; const b = bBase(home); EV.push({ t: 'work', role: w.role, x: b.x, y: b.y, wx: w.x, wy: w.y }); }
      if (w.workT > 0) break;
      if (w.role === 'builder') {
        for (const it of w.carry) { home.got[it] = (home.got[it] || 0) + 1; if (home.tr[it]) home.tr[it]--; }
        w.carry = []; w.st = 'idle'; w.wait = 0.2; lodgeCheck(home);
        break;
      }
      const R = RECIPE[w.role], n = w.carry.length / R.per, out = R.out(w.target);
      w.carry = []; for (let k = 0; k < n; k++) w.carry.push(out);
      S.stats.made[R.kind] += n;
      goDrop(w, yard()); w.note = 'Carrying ' + ITEMS[out].name.toLowerCase() + ' to the yard';
      break;
    }
  }
}
function hire(homeId, role) {
  const home = W.bById.get(homeId);
  if (!home || !(BUILD[home.type].roles || []).includes(role) || crewOf(homeId).length >= bedsOf(home)) return null;
  const cost = hireCost(role, countRole(role));
  if (S.coins < cost) return null;
  S.coins -= cost;
  const d = bDoor(home), used = new Set(S.workers.map(w => w.name));
  const free = NAMES.filter(n => !used.has(n)), pool = free.length ? free : NAMES;
  const w = { id: S.nextId++, role, home: homeId, name: pool[(Math.random() * pool.length) | 0], col: (Math.random() * 6) | 0, gait: (Math.random() * GAITS.length) | 0, x: d.x, y: d.y, face: 1, carry: [] };
  S.workers.push(w); resetWorker(w); w.wait = 0.6; w.note = 'Just arrived';
  EV.push({ t: 'hire', x: d.x, y: d.y, w });
  return w;
}
function dismiss(id) {
  const k = S.workers.findIndex(w => w.id === id); if (k < 0) return;
  const w = S.workers[k]; releaseWorker(w);
  for (const t of w.carry) S.inv[t]++;       // whatever they were carrying isn't lost
  S.workers.splice(k, 1);
}
// move a Meeple to another job: any building with a free place, at no cost
function reassign(id, homeId, role) {
  const w = S.workers.find(x => x.id === id), home = W.bById.get(homeId);
  if (!w || !home || !(BUILD[home.type].roles || []).includes(role)) return false;
  if (w.home === homeId && w.role === role) return false;
  if (w.home !== homeId && crewOf(homeId).length >= bedsOf(home)) return false;
  releaseWorker(w); w.res = 0;
  for (const t of w.carry) S.inv[t]++;
  w.carry = []; w.home = homeId; w.role = role; w.col = w.col || 0;
  resetWorker(w); w.wait = 0.5; w.note = 'Starting a new job';
  return true;
}
function buyForeman(id) {
  const b = W.bById.get(id); if (!b || b.type !== 'cabin' || b.foreman) return false;
  const c = foremanCost(countForemen()); if (S.coins < c) return false;
  S.coins -= c; b.foreman = true;
  const d = bDoor(b); EV.push({ t: 'hire', x: d.x, y: d.y });
  return true;
}
function setWood(id, t) { const b = W.bById.get(id); if (!b) return; b.wood = t; for (const w of crewOf(id)) if (w.st === 'idle' || w.st === 'home') w.wait = 0; }

// ---------------------------------------------------------------- building, moving and upgrades
const unlocked = type => { const nd = BUILD[type].need; return !nd || goalValue(nd[0]) >= nd[1]; };
// self: the building being moved, whose own footprint counts as free
function canPlace(type, tx, ty, self) {
  const B = BUILD[type];
  const mine = (x, y) => self && x >= self.x && x < self.x + B.w && y >= self.y && y < self.y + B.h;
  for (let yy = 0; yy < B.h; yy++) for (let xx = 0; xx < B.w; xx++) {
    const x = tx + xx, y = ty + yy;
    if (x < 2 || y < 4 || x >= MW - 2 || y >= MH - 3) return false;
    const i = idx(x, y);
    if (W.ter[i] || !canReach(i) || (W.block[i] && !mine(x, y)) || W.pileAt.has(i) || (W.kind[i] && W.g[i] >= 0.45)) return false;
  }
  for (const A of W.anc) { const ax = A.i % MW, ay = (A.i / MW) | 0; if (tx <= ax + 1 && tx + B.w > ax - 1 && ty <= ay + 3 && ty + B.h > ay - 2) return false; }
  if (nearCrossing(tx, ty, B.w, B.h)) return false;
  // leave room around other buildings so roofs never cover a door or the yard's front
  for (const b of S.buildings) {
    if (b === self) continue;
    const O = BUILD[b.type], front = b.type === 'yard' ? 3 : 2;
    if (tx < b.x + O.w + 1 && tx + B.w > b.x - 1 && ty < b.y + O.h + front && ty + B.h > b.y - 2) return false;
  }
  const dx = tx + Math.floor(doorCol(type)), dy = ty + B.h;
  return !W.ter[idx(dx, dy)] && (!W.block[idx(dx, dy)] || mine(dx, dy));
}
function stepOut(b) {      // anyone standing where a building now is steps out to its door
  const d = bDoor(b);
  for (const e of [S.player].concat(S.workers)) if (blockedPx(e.x, e.y)) {
    const dest = e.path.length ? e.path[e.path.length - 1] : null;
    e.x = d.x + (Math.random() - 0.5) * 16; e.y = d.y + Math.random() * 6;
    if (dest) goTo(e, dest.x, dest.y);
  }
}
// is a footprint on, or right at the ends of, a crossing place?
function nearCrossing(tx, ty, w, h) {
  for (let k = 1; k < NT; k++) { const s = W.site[k], m = 3; if (tx < s.x + s.w + m && tx + w > s.x - m && ty < s.y + s.h + m && ty + h + 1 > s.y - m) return true; }
  return false;
}
const buildCost = type => BUILD[type].cost(countB(type));
function placeBuilding(type, tx, ty) {
  const B = BUILD[type], cost = buildCost(type);
  if (!unlocked(type) || (B.unique && countB(type)) || !canPlace(type, tx, ty) || !canAfford(cost)) return null;
  pay(cost);
  const b = { id: S.nextId++, type, x: tx, y: ty, wood: -1 };
  if (type === 'depot') b.store = new Array(NI).fill(0);
  if (type === 'lodge') { b.got = {}; b.tr = {}; }
  S.buildings.push(b); rebuildBlocks(); stepOut(b);
  const c = bBase(b); EV.push({ t: 'build', x: c.x, y: c.y, b });
  return b;
}
function moveBuilding(id, tx, ty) {
  const b = W.bById.get(id);
  if (!b || b.type === 'yard' || !canPlace(b.type, tx, ty, b)) return false;
  const B = BUILD[b.type];
  // the old site goes back to forest: stumps where trees once stood
  for (let yy = 0; yy < B.h; yy++) for (let xx = 0; xx < B.w; xx++) {
    const i = idx(b.x + xx, b.y + yy);
    if (W.orig[i] && !W.ter[i]) { W.kind[i] = W.orig[i]; W.g[i] = 0; W.growing.add(i); W.dirty.push(i); }
  }
  b.x = tx; b.y = ty; rebuildBlocks(); stepOut(b);
  for (const w of crewOf(id)) { releaseWorker(w); w.res = 0; w.target = -1; w.st = 'idle'; w.path = []; w.wait = 0.4 + Math.random(); w.note = 'Moving house'; }
  const c = bBase(b); EV.push({ t: 'build', x: c.x, y: c.y, b });
  return true;
}
function axeCost(crew) {
  const lv = S[crew ? 'crewAxe' : 'axe']; if (lv >= MAX_AXE) return null;
  const a = AXES[lv + 1];
  return { coins: Math.round(a.coins * (crew ? CREW_AXE_MULT : 1)), wood: [a.wood] };
}
function buyAxe(crew) {
  const c = axeCost(crew); if (!c || !canAfford(c)) return false;
  pay(c); S[crew ? 'crewAxe' : 'axe']++; return true;
}
function buyUpg(k) {
  if (S[k] >= UPG[k].max) return false;
  const c = upgCost(k, S[k]); if (!canAfford(c)) return false;
  pay(c); S[k]++; return true;
}

// ---------------------------------------------------------------- the Great Lodge
const lodge = () => S.buildings.find(b => b.type === 'lodge');
const lodgeStep = () => LODGE[S.lodgeStage] ? LODGE[S.lodgeStage].steps[S.lodgeStep] : null;
// the next thing a builder could fetch right now: an item index, or -1
function lodgeWants(b) {
  const st = lodgeStep(); if (!st) return -1;
  for (const [it, n] of st.need) if (S.inv[it] > 0 && (b.got[it] || 0) + (b.tr[it] || 0) < n) return it;
  return -1;
}
function lodgePay() {
  const b = lodge(), st = lodgeStep(); if (!b || !st) return 0;
  const have = b.got.coins || 0, g = Math.min(S.coins, st.coins - have);
  if (g > 0) { S.coins -= g; b.got.coins = have + g; lodgeCheck(b); }
  return Math.max(0, g);
}
function lodgeCheck(b) {
  const st = lodgeStep(); if (!st) return;
  if (!st.need.every(([it, n]) => (b.got[it] || 0) >= n) || (b.got.coins || 0) < st.coins) return;
  const c = bBase(b), storey = S.lodgeStage, name = st.name;
  b.got = {}; b.tr = {}; S.lodgeStep++;
  if (S.lodgeStep >= LODGE[storey].steps.length) {
    S.lodgeStep = 0; S.lodgeStage++;
    EV.push({ t: 'lodge', stage: S.lodgeStage, x: c.x, y: c.y });
    if (S.lodgeStage >= LODGE.length) S.won = true;
  } else EV.push({ t: 'lodgeStep', name, next: lodgeStep().name, x: c.x, y: c.y });
}

// ---------------------------------------------------------------- orders and standing
const ordersOpen = () => S.stats.sales >= 60;
const rankOf = () => { let r = 0; while (r < RANKS.length - 1 && S.stats.orders >= RANKS[r + 1].n) r++; return r; };
const rankPerks = kind => { let n = 0; for (let r = 1; r <= rankOf(); r++) if (RANKS[r].perk === kind) n++; return n; };
const maxOrders = () => 3 + rankPerks('slot');
function newOrder() {
  const pool = [];
  for (let it = 0; it < NI; it++) if (S.seen[it] && !S.orders.some(o => o.item === it)) pool.push(it);
  if (!pool.length) return;
  pool.sort((a, b) => ITEMS[a].price - ITEMS[b].price);
  const pick = list => list[Math.min(list.length - 1, Math.floor(Math.pow(Math.random(), 0.6) * list.length))];
  // each season the neighbours hold a fair of their own, which wants one kind of goods and pays extra for it
  const wanted = pool.filter(i => ITEMS[i].kind === SEASONS[SEA].want), fair = wanted.length && Math.random() < 0.4 ? SEA + 1 : 0;
  const it = pick(fair ? wanted : pool);
  const value = Math.max(40, S.stats.earned * 0.004) * (0.5 + Math.random());
  const n = clamp(Math.round(value / ITEMS[it].price), 4, 600);
  S.orders.push({ id: S.nextId++, item: it, n, fair, pay: Math.round(n * ITEMS[it].price * (1.7 + Math.random() * 0.7) * (1 + 0.1 * rankPerks('pay')) * (fair ? 1.3 : 1)), t: 600 + Math.random() * 300 });
  EV.push({ t: 'order' });
}
const orderPay = o => Math.round(o.pay * (SEA === 2 ? 1.25 : 1));       // autumn is harvest time
function fillOrder(id) {
  const k = S.orders.findIndex(o => o.id === id); if (k < 0) return false;
  const o = S.orders[k]; if (S.inv[o.item] < o.n) return false;
  const before = rankOf(), paid = orderPay(o);
  S.inv[o.item] -= o.n; S.sold[o.item] += o.n; S.coins += paid; S.stats.earned += paid; S.stats.sales += o.n; S.stats.orders++;
  S.orders.splice(k, 1); S.orderT = Math.min(S.orderT, 45);
  const r = rankOf();
  if (r > before) {
    let hat = null;
    if (RANKS[r].perk === 'hat') { const pool = HATS.filter(h => !S.hats.includes(h.id)); if (pool.length) { hat = pool[(Math.random() * pool.length) | 0]; S.hats.push(hat.id); } }
    EV.push({ t: 'rank', rank: r, hat });
  }
  return true;
}
function tickOrders(dt) {
  for (let k = S.orders.length - 1; k >= 0; k--) { S.orders[k].t -= dt; if (S.orders[k].t <= 0) S.orders.splice(k, 1); }
  if (!ordersOpen()) return;
  S.orderT -= dt;
  if (S.orderT <= 0) { S.orderT = (140 + Math.random() * 140) * (rankPerks('fast') ? 0.6 : 1); if (S.orders.length < maxOrders()) newOrder(); }
}

// ---------------------------------------------------------------- goals
function goalValue(key) {
  switch (key) {
    case 'chopped': return S.stats.chopped;
    case 'delivered': return S.stats.delivered;
    case 'sales': return S.stats.sales;
    case 'cabins': return countB('cabin');
    case 'workers': return S.workers.length;
    case 'axe': return Math.max(S.axe, S.crewAxe);        // forging either yours or the crew's counts
    case 'orders': return S.stats.orders;
    case 'hats': return S.hats.length;
    case 'lodge': return S.lodgeStage;
    case 'foremen': return countForemen();
    case 'anc': return NT - ancLeft();
    case 'reach': return S.reach;
  }
  if (key.startsWith('sold')) return S.sold[+key.slice(4)];
  if (key.startsWith('b:')) return countB(key.slice(2));
  if (key.startsWith('r:')) return countRole(key.slice(2));
  if (key.startsWith('made:')) return S.stats.made[key.slice(5)] || 0;
  return 0;
}
const curGoal = () => GOALS.find(g => !S.goalsDone[g.id]);
function checkGoal() {
  const g = curGoal(); if (!g) return;
  if (goalValue(g.key) < g.n) return;
  S.coins += g.r; S.stats.earned += g.r; S.goalsDone[g.id] = 1;
  EV.push({ t: 'goal', g });
}

// ---------------------------------------------------------------- tick
let growAcc = 0, goalAcc = 0;
function update(dt) {
  S.playTime += dt;
  const sea = seasonNow();
  if (sea !== SEA) { SEA = sea; EV.push({ t: 'season', s: sea }); }
  updPlayer(dt);
  for (const w of S.workers) updWorker(w, dt);
  for (const p of S.piles) if (p.t > 0) p.t -= dt;
  for (const [i, t] of W.shake) { if (t - dt <= 0) W.shake.delete(i); else W.shake.set(i, t - dt); }
  for (let r = 0; r < NT; r++) if (W.ancShake[r] > 0) W.ancShake[r] -= dt;
  growAcc += dt;
  if (growAcc >= 0.5) {
    for (const i of W.growing) {
      if (W.pileAt.has(i)) continue;          // a stump under a log pile waits
      const g = W.g[i] + growAcc * SEASON_GROW[SEA] / TREES[W.kind[i] - 1].regrow;
      if (g >= 1) { setGrow(i, 1); W.growing.delete(i); } else setGrow(i, g);
    }
    tickOrders(growAcc);
    growAcc = 0;
  }
  goalAcc += dt;
  if (goalAcc > 0.4) { goalAcc = 0; checkGoal(); }
}

// ---------------------------------------------------------------- saving
function snapshot() {
  const grow = {}; for (const i of W.growing) grow[i] = Math.round(W.g[i] * 1000) / 1000;
  const P = S.player, inv = S.inv.slice(), anc = S.anc.map(a => Object.assign({}, a));
  for (const w of S.workers.concat(P)) if (w.tim) anc[w.tim - 1].heap += w.carry.length;      // timbers on a shoulder go back on the heap
  for (const w of S.workers) if (!w.tim) for (const t of w.carry) inv[t]++;      // goods in transit are banked
  return Object.assign({}, S, {
    inv, grow, anc, savedAt: Date.now(),
    player: { x: Math.round(P.x), y: Math.round(P.y), face: P.face, carry: P.tim ? [] : P.carry.slice() },
    workers: S.workers.map(w => ({ id: w.id, role: w.role, home: w.home, name: w.name, col: w.col, gait: w.gait, quirk: w.quirk, xp: Math.round(w.xp), x: Math.round(w.x), y: Math.round(w.y), face: w.face })),
    piles: S.piles.map(p => ({ id: p.id, i: p.i, type: p.type, n: p.n })),
  });
}
function saveGame() {
  if (!S || S.slot < 1) return false;
  let json;
  try { json = JSON.stringify(snapshot()); } catch (e) { console.error(e); return false; }
  // two independent copies: the app's own file (Android) and browser storage; either one is enough
  let ok = false;
  try { if (window.AndroidBridge && AndroidBridge.backup) { AndroidBridge.backup(S.slot, json); ok = true; } } catch (e) { console.error(e); }
  try { localStorage.setItem(SAVE_KEY(S.slot), json); ok = true; } catch (e) { console.error(e); }
  if (ok) S.savedAt = Date.now();
  return ok;
}
function readSlot(slot) {
  const parse = raw => { try { const d = raw ? JSON.parse(raw) : null; return d && d.seed != null && d.player ? d : null; } catch (e) { return null; } };
  let a = null, b = null;
  try { a = parse(localStorage.getItem(SAVE_KEY(slot))); } catch (e) { }
  try { if (window.AndroidBridge && AndroidBridge.restore) b = parse(AndroidBridge.restore(slot)); } catch (e) { }
  if (a && b) return (b.savedAt || 0) > (a.savedAt || 0) ? b : a;
  return a || b;
}
function loadGame(slot) {
  const d = readSlot(slot); if (!d) return false;
  const base = blankState(slot, d.seed), ver = d.v || 1, old = ver < 2;
  const stats = Object.assign(base.stats, d.stats);
  stats.made = Object.assign({ plank: 0, furn: 0, char: 0 }, stats.made);
  S = Object.assign(base, d, { slot, stats, v: 3 });
  S.anc = ANCIENT_HP.map((hp, r) => { const a = (d.anc || [])[r] || {}; return { hp: a.done ? 0 : Math.min(hp, a.hp > 0 ? a.hp : hp), done: !!a.done, call: !!a.call && !a.done, heap: a.done ? Math.max(0, +a.heap || 0) : 0 }; });
  S.reach = clamp(Math.max(+d.reach || 0, (d.bridges || []).reduce((m, b) => Math.max(m, (b && b.k) || 0), 0)), 0, NT - 1);
  S.span = ANCIENT_HP.map((_, k) => { const sp = (d.span || [])[k] || {}; return { got: Math.max(0, +sp.got || 0), call: !!sp.call }; });
  S.bridges = [];
  for (const k of ['inv', 'sold', 'seen', 'autosell', 'keep']) { S[k] = (S[k] || []).slice(0, NI).map(v => +v || 0); while (S[k].length < NI) S[k].push(0); }
  while (S.stats.cut.length < NT) S.stats.cut.push(0);
  if (old) {
    // v1.0 saves counted goals by position; carry over the ones already done
    S.goalsDone = {};
    for (let k = 0; k < Math.min(d.goal || 0, OLD_GOALS.length); k++) S.goalsDone[OLD_GOALS[k]] = 1;
    S.won = false; S.gait = (Math.random() * GAITS.length) | 0;
  }
  delete S.goal;
  S.hats = (S.hats || []).filter(id => HATS.some(h => h.id === id));
  for (const b of S.buildings) {
    if (b.wood == null) b.wood = -1;
    if (b.type === 'depot') { b.store = (b.store || []).slice(0, NI); while (b.store.length < NI) b.store.push(0); }
    if (b.type === 'lodge') { b.got = b.got || {}; b.tr = {}; }
  }
  S.buildings = S.buildings.filter(b => BUILD[b.type]);
  genMap(S.seed);
  // the bridges stand at this forest's crossing places; every Ancient tree inside the outermost one is down
  for (let k = 1; k <= S.reach; k++) { const s = W.site[k], br = { k, x: s.x, y: s.y, w: s.w, h: s.h, v: s.v }; S.bridges.push(br); applyBridge(br); S.anc[k - 1] = { hp: 0, done: true, call: false, heap: 0 }; }
  for (let k = S.reach + 1; k < NT; k++) {           // only the next one can be under way: what isn't hammered in is on the heap
    if (k === S.reach + 1 && S.anc[k - 1].done) { S.span[k].got = Math.min(S.span[k].got, ANCIENT_TIMBER[k - 1] - 1); S.anc[k - 1].heap = ANCIENT_TIMBER[k - 1] - S.span[k].got; }
    else { S.span[k] = { got: 0, call: false }; S.anc[k - 1].heap = 0; }
  }
  for (let k = 0; k <= S.reach; k++) S.span[k] = { got: 0, call: false };
  for (const k in (d.grow || {})) { const i = +k; if (W.kind[i]) { W.g[i] = d.grow[k]; W.growing.add(i); } }
  delete S.grow;
  S.piles = (S.piles || []).filter(p => inMap(p.i % MW, (p.i / MW) | 0) && !W.ter[p.i] && TREES[p.type]);
  rebuildBlocks();
  if (ver < 3) settleRivers();
  W.dirty.length = 0;
  S.workers = S.workers.filter(w => W.bById.has(w.home) && ROLES[w.role]);
  resetTransient();
  return true;
}
// A camp saved before the rivers came: every river it had already worked beyond is bridged, the Ancient
// trees in its way count as felled, and any building the water or a crossing now runs through is shifted.
function settleRivers() {
  let reach = 0;
  for (let t = 0; t < NT; t++) if (S.stats.cut[t] > 0 || S.seen[t]) reach = t;
  for (const b of S.buildings) reach = Math.max(reach, W.reg[idx(b.x, b.y)]);
  for (let k = S.reach + 1; k <= reach; k++) {
    const s = W.site[k], br = { k, x: s.x, y: s.y, w: s.w, h: s.h, v: s.v };
    S.anc[k - 1] = { hp: 0, done: true, call: false, heap: 0 };
    S.goalsDone['anc' + (k - 1)] = 1; S.goalsDone['bridge' + k] = 1;
    S.bridges.push(br); applyBridge(br); S.reach = k;
  }
  rebuildBlocks();
  for (const b of S.buildings.slice(1)) {
    const B = BUILD[b.type]; let bad = nearCrossing(b.x, b.y, B.w, B.h);
    for (let yy = 0; yy <= B.h && !bad; yy++) for (let xx = 0; xx < B.w; xx++) if (W.ter[idx(b.x + xx, Math.min(MH - 1, b.y + yy))] === TER.WATER || W.ter[idx(b.x + xx, Math.min(MH - 1, b.y + yy))] === TER.BRIDGE) { bad = true; break; }
    for (const A of W.anc) { const ax = A.i % MW, ay = (A.i / MW) | 0; if (b.x <= ax + 1 && b.x + B.w > ax - 1 && b.y <= ay + 3 && b.y + B.h > ay - 2) bad = true; }
    if (!bad) continue;
    let spot = null;
    for (let r = 1; r < 40 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (canPlace(b.type, b.x + dx, b.y + dy, b)) { spot = [b.x + dx, b.y + dy]; break; }
    }
    if (spot) { b.x = spot[0]; b.y = spot[1]; rebuildBlocks(); }
  }
  rebuildBlocks();
}
function deleteSlot(slot) {
  try { localStorage.removeItem(SAVE_KEY(slot)); } catch (e) { }
  try { if (window.AndroidBridge && AndroidBridge.backup) AndroidBridge.backup(slot, ''); } catch (e) { }
}
;(window.__stage = window.__stage || []).push('world.js loaded');
