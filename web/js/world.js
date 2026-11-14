// MeepleJacks — the forest, the simulation (you and every kind of crew), orders, the Great Lodge and saving.
'use strict';

let S = null;      // saved state
let W = null;      // the generated map and other things rebuilt on load
const EV = [];     // events for the renderer, UI and audio
const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const TER = { GRASS: 0, WATER: 1, ROCK: 2 };
const SAVE_KEY = s => 'meeplejacks_slot' + s;
const YARD_X = (CX + 0.5) * TS, YARD_Y = (CY - 0.5) * TS;   // middle of the Lumber Yard

// ---------------------------------------------------------------- terrain (shared with the renderer; pixel coords)
function waterV(px, py, seed) {
  const d = Math.hypot(px - YARD_X, py - YARD_Y) / TS;
  return fbm(px / 300, py / 300, seed + 3, 3) - 0.715 - Math.max(0, 18 - d) * 0.03;
}
// distance from the yard in tiles, wobbled so the rings aren't perfect circles
function zoneD(px, py, seed) {
  return Math.hypot(px - YARD_X, py - YARD_Y) / TS + (fbm(px / 224, py / 224, seed + 7, 3) - 0.5) * 9;
}
function ringOf(dd) { let r = 0; while (r < NT - 1 && dd >= RINGS[r + 1]) r++; return r; }

function genMap(seed) {
  W = {
    kind: new Uint8Array(NTILES), g: new Float32Array(NTILES), ter: new Uint8Array(NTILES), block: new Uint8Array(NTILES),
    vr: new Uint8Array(NTILES), jx: new Int8Array(NTILES), jy: new Int8Array(NTILES), orig: null,
    hp: new Map(), claim: new Map(), shake: new Map(), growing: new Set(), pileAt: new Map(), pileById: new Map(), bById: new Map(),
    dirty: [],     // tiles whose look changed, for the zoomed-out tree cache
  };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y), px = x * TS + 8, py = y * TS + 8;
    const d = Math.hypot(px - YARD_X, py - YARD_Y) / TS, wv = waterV(px, py, seed);
    if (wv > -0.004) { W.ter[i] = TER.WATER; continue; }
    if (d > 7 && wv < -0.04 && hash2(x, y, seed + 2) < 0.005) { W.ter[i] = TER.ROCK; W.vr[i] = (hash2(x, y, seed + 4) * 3) | 0; continue; }
    if (d < 4.2 || wv > -0.03) continue;
    let dens = 0.2 + 0.42 * fbm(x / 9, y / 9, seed + 11, 2);
    if (d < 8.5) dens *= (d - 4.2) / 4.3;
    const dd = zoneD(px, py, seed);
    let r = ringOf(dd);
    // rings bleed into each other a little at their borders
    const lo = RINGS[r], hi = r < NT - 1 ? RINGS[r + 1] : 1e9, h = hash2(x, y, seed + 9);
    if (r < NT - 1 && hi - dd < 3 && h < (3 - (hi - dd)) / 6) r++;
    else if (r > 0 && dd - lo < 3 && h < (3 - (dd - lo)) / 6) r--;
    dens *= DENSITY[r];
    if (hash2(x, y, seed + 5) < dens) {
      W.kind[i] = r + 1; W.g[i] = 1;
      W.vr[i] = (hash2(x, y, seed + 6) * TREE_VARIANTS) | 0;
      W.jx[i] = ((hash2(x, y, seed + 21) * 7) | 0) - 3; W.jy[i] = ((hash2(x, y, seed + 22) * 5) | 0) - 2;
    }
  }
  W.orig = W.kind.slice();
}
function rebuildBlocks() {
  for (let i = 0; i < NTILES; i++) W.block[i] = W.ter[i] ? 1 : 0;
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
const crewSpeed = (w, home) => CREW_SPEED * (1 + 0.12 * S.crewBoots) * (lodgeDone(2) ? 1.1 : 1) * (home && home.foreman ? 1.3 : 1) * (w.role === 'carter' ? 1.15 : 1);
const haulerCap = () => HAULER_CARRY + 2 * S.crewPack + (lodgeDone(6) ? 4 : 0);
const carterCap = () => CARTER_CARRY + 12 * S.carts;
const craftSpeed = role => (role === 'sawyer' ? 1 + 0.3 * S.blades : role === 'carpenter' ? 1 + 0.3 * S.chisels : 1) * (lodgeDone(4) ? 1.25 : 1);
const craftBatch = role => role === 'sawyer' ? 6 + 2 * S.blades : role === 'carpenter' ? 6 + 2 * S.chisels : 9;
const plantTo = () => Math.min(0.9, 0.5 + 0.1 * S.seeds);

// ---------------------------------------------------------------- new game
function blankState(slot, seed) {
  const z = n => new Array(n).fill(0);
  return {
    v: 2, slot, seed, created: Date.now(), savedAt: 0, playTime: 0,
    coins: 0, inv: z(NI), sold: z(NI), seen: z(NI), autosell: z(NI), keep: z(NI),
    stats: { chopped: 0, delivered: 0, sales: 0, earned: 0, cut: z(NT), made: { plank: 0, furn: 0, char: 0 }, orders: 0, planted: 0 },
    axe: 1, crewAxe: 1, boots: 0, pack: 0, crewBoots: 0, crewPack: 0, seeds: 0, blades: 0, carts: 0, chisels: 0,
    buildings: [{ id: 1, type: 'yard', x: CX - 2, y: CY - 2 }], nextId: 2,
    workers: [], piles: [], goalsDone: {}, won: false, lodgeStage: 0, lodgeStep: 0,
    hats: [], hat: null, crewHat: null, gait: 0, hatPity: 0,
    orders: [], orderT: 60,
    player: { x: YARD_X, y: (CY + 1) * TS + 12, face: 1, carry: [] },
  };
}
function resetWorker(w) {
  Object.assign(w, { st: 'idle', path: [], wait: Math.random(), target: -1, carry: w.carry || [], res: 0, swing: 0, workT: 0, tick: 0, drop: 0, walkT: Math.random() * 3, moving: false, note: '', face: w.face || 1 });
  if (w.gait == null) w.gait = (Math.random() * GAITS.length) | 0;
}
function resetTransient() {
  const P = S.player;
  Object.assign(P, { st: 'idle', path: [], queue: [], own: [], auto: false, target: -1, swing: 0, pause: 0, walkT: 0, moving: false, drop: 0 });
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
// The nearest tile to (cx, cy) that passes `test`, searching outward in rings with no distance limit.
function nearestTile(cx, cy, test) {
  let best = -1, bd = 1e9, stop = 1e9;
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
    if (best >= 0 && stop === 1e9) stop = Math.ceil(r * 1.42) + 1;
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
  const pool = HATS.filter(h => h.tree === k - 1 && !S.hats.includes(h.id));
  if (pool.length) {
    const chance = me ? 0.04 + 0.012 * S.hatPity : 0.006;
    if (Math.random() < chance) { const h = pool[(Math.random() * pool.length) | 0]; S.hats.push(h.id); if (me) S.hatPity = 0; EV.push({ t: 'hat', hat: h, x: p.x, y: p.y, me: true }); }
    else if (me) S.hatPity++;
  }
  return pile;
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
// returns: ok | queued | unqueue | same | young | tough | none | full
function cmdChop(i) {
  const P = S.player, k = W.kind[i];
  if (!k) return 'none';
  if (W.g[i] < 1) return 'young';
  if (!canCut(S.axe, k)) return 'tough';
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
  P.auto = true; P.queue = [];
  if (!P.own.includes(pile.id)) P.own.push(pile.id);
  if (P.carry.length >= playerCap()) { goDrop(P); return; }
  goPile(P, pile);
}
function cmdDrop(b) {
  const P = S.player; if (!P.carry.length) return false;
  P.auto = true; P.queue = []; goDrop(P, b); return true;
}
function cmdWalk(x, y) {
  const P = S.player;
  P.auto = false; P.queue = []; P.st = 'walk'; goTo(P, x, y);
}
function goPile(e, pile) {
  const p = pileXY(pile), side = e.x < p.x ? -1 : 1;
  e.target = pile.id; e.st = 'toPile'; goTo(e, p.x + side * 8, p.y + 1);
}
function playerThink() {
  const P = S.player;
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
  }
}

// ---------------------------------------------------------------- the crew
function releaseWorker(w) {
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
      const want = home.wood;
      if (want >= 0 && !canCut(S.crewAxe, want + 1)) { w.note = 'Needs the ' + AXES[want + 1].name + ' to cut ' + TREES[want].name; return false; }
      const i = nearestTile(hx, hy, t => W.kind[t] > 0 && W.g[t] >= 1 && (want < 0 ? W.kind[t] <= S.crewAxe : W.kind[t] === want + 1) && !W.claim.has(t) && !(P.target === t && (P.st === 'chop' || P.st === 'toTree')));
      if (i < 0) { w.note = 'Waiting for ' + (want >= 0 ? TREES[want].name : 'trees') + ' to grow back'; return false; }
      W.claim.set(i, w.id); startChop(w, i); w.note = 'Off to chop ' + TREES[W.kind[i] - 1].name; return true;
    }
    case 'hauler': {
      const room = haulerCap() - w.carry.length;
      const p = room > 0 ? findPileFor(w, home, w.carry.length ? 8 * TS : 0) : null;
      if (p) { w.res = Math.min(room, p.n - p.res); p.res += w.res; goPile(w, p); w.note = 'Fetching ' + TREES[p.type].name + ' logs'; return true; }
      if (w.carry.length) { goDrop(w); w.note = 'Hauling ' + w.carry.length + ' logs in'; return true; }
      w.note = 'No logs to haul';
      return false;
    }
    case 'forester': {
      const want = home.wood;
      const i = nearestTile(hx, hy, t => W.kind[t] > 0 && W.g[t] < 0.45 && (want < 0 || W.kind[t] === want + 1) && !W.pileAt.has(t) && !W.claim.has(t));
      if (i < 0) { w.note = 'No stumps to replant'; return false; }
      W.claim.set(i, w.id); startChop(w, i); w.note = 'Off to replant ' + TREES[W.kind[i] - 1].name; return true;
    }
    case 'carter': {
      const d = bDoor(home);
      if (Math.hypot(d.x - w.x, d.y - w.y) > 26) { w.st = 'load'; goTo(w, d.x - 8 + Math.random() * 16, d.y + Math.random() * 4); w.note = 'Heading back to the depot'; return true; }
      const load = depotLoad(home), cap = carterCap();
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
function updWorker(w, dt) {
  const home = W.bById.get(w.home), sp = crewSpeed(w, home), boss = home.foreman ? 1.3 : 1;
  if (w.swing > 0) w.swing -= dt;
  switch (w.st) {
    case 'idle':
    case 'home':
      if (w.st === 'home') { if (moveStep(w, dt, sp * 0.8)) w.st = 'idle'; } else w.moving = false;
      w.wait -= dt;
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
      if (w.swing <= 0) { w.swing += CREW_SWING / boss; if (hitTree(w.target, S.crewAxe, w)) { w.st = 'idle'; w.wait = 1.6 / boss; w.swing = 0; w.target = -1; } }
      break;
    case 'plant': {
      w.moving = false; w.workT -= dt * boss;
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
          const take = Math.min(BUILDER_CARRY - w.carry.length, S.inv[it], n - (home.got[it] || 0) - (home.tr[it] || 0));
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
        const it = R.inp(t), n = Math.floor(Math.min(craftBatch(w.role), spare(it)) / R.per) * R.per;
        S.inv[it] -= n; for (let k = 0; k < n; k++) w.carry.push(it);
        w.target = t; w.st = 'toWork';
        const d = bDoor(home); goTo(w, d.x - 5 + Math.random() * 10, d.y + Math.random() * 3);
        EV.push({ t: 'pick', x: w.x, y: w.y });
        w.note = 'Carrying ' + ITEMS[it].name.toLowerCase() + ' to work';
      }
      break;
    case 'toWork':
      if (w.role === 'builder') { if (moveStep(w, dt, sp)) { w.st = 'work'; w.workT = w.carry.length * BUILDER_TIME; w.tick = 0; w.note = 'Building the Lodge'; } break; }
      if (moveStep(w, dt, sp)) {
        const R = RECIPE[w.role];
        w.st = 'work'; w.workT = (w.carry.length / R.per) * R.time / craftSpeed(w.role); w.tick = 0; w.face = 1;
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
    if (W.ter[i] || (W.block[i] && !mine(x, y)) || W.pileAt.has(i) || (W.kind[i] && W.g[i] >= 0.45)) return false;
  }
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
  const it = pool[Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 0.6) * pool.length))];
  const value = Math.max(40, S.stats.earned * 0.004) * (0.5 + Math.random());
  const n = clamp(Math.round(value / ITEMS[it].price), 4, 600);
  S.orders.push({ id: S.nextId++, item: it, n, pay: Math.round(n * ITEMS[it].price * (1.7 + Math.random() * 0.7) * (1 + 0.1 * rankPerks('pay'))), t: 600 + Math.random() * 300 });
  EV.push({ t: 'order' });
}
function fillOrder(id) {
  const k = S.orders.findIndex(o => o.id === id); if (k < 0) return false;
  const o = S.orders[k]; if (S.inv[o.item] < o.n) return false;
  const before = rankOf();
  S.inv[o.item] -= o.n; S.sold[o.item] += o.n; S.coins += o.pay; S.stats.earned += o.pay; S.stats.sales += o.n; S.stats.orders++;
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
  updPlayer(dt);
  for (const w of S.workers) updWorker(w, dt);
  for (const p of S.piles) if (p.t > 0) p.t -= dt;
  for (const [i, t] of W.shake) { if (t - dt <= 0) W.shake.delete(i); else W.shake.set(i, t - dt); }
  growAcc += dt;
  if (growAcc >= 0.5) {
    for (const i of W.growing) {
      if (W.pileAt.has(i)) continue;          // a stump under a log pile waits
      const g = W.g[i] + growAcc / TREES[W.kind[i] - 1].regrow;
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
  const P = S.player, inv = S.inv.slice();
  for (const w of S.workers) for (const t of w.carry) inv[t]++;      // goods in transit are banked
  return Object.assign({}, S, {
    inv, grow, savedAt: Date.now(),
    player: { x: Math.round(P.x), y: Math.round(P.y), face: P.face, carry: P.carry.slice() },
    workers: S.workers.map(w => ({ id: w.id, role: w.role, home: w.home, name: w.name, col: w.col, gait: w.gait, x: Math.round(w.x), y: Math.round(w.y), face: w.face })),
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
  const base = blankState(slot, d.seed), old = (d.v || 1) < 2;
  const stats = Object.assign(base.stats, d.stats);
  stats.made = Object.assign({ plank: 0, furn: 0, char: 0 }, stats.made);
  S = Object.assign(base, d, { slot, stats, v: 2 });
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
  for (const k in (d.grow || {})) { const i = +k; if (W.kind[i]) { W.g[i] = d.grow[k]; W.growing.add(i); } }
  delete S.grow;
  S.piles = (S.piles || []).filter(p => W.kind[p.i]);
  rebuildBlocks(); W.dirty.length = 0;
  S.workers = S.workers.filter(w => W.bById.has(w.home) && ROLES[w.role]);
  resetTransient();
  return true;
}
function deleteSlot(slot) {
  try { localStorage.removeItem(SAVE_KEY(slot)); } catch (e) { }
  try { if (window.AndroidBridge && AndroidBridge.backup) AndroidBridge.backup(slot, ''); } catch (e) { }
}
;(window.__stage = window.__stage || []).push('world.js loaded');
