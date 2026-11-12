// MeepleJacks — the forest, the simulation (you, lumberjacks, haulers) and saving.
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
    vr: new Uint8Array(NTILES), jx: new Int8Array(NTILES), jy: new Int8Array(NTILES),
    hp: new Map(), claim: new Map(), shake: new Map(), growing: new Set(), pileAt: new Map(), pileById: new Map(), bById: new Map(),
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
      if (W.kind[i]) { W.kind[i] = 0; W.growing.delete(i); W.hp.delete(i); W.claim.delete(i); }
    }
  }
}
const treeXY = i => ({ x: (i % MW) * TS + 8 + W.jx[i], y: ((i / MW) | 0) * TS + 12 + W.jy[i] });
const pileXY = p => { const t = treeXY(p.i); return { x: t.x + 5, y: t.y + 3 }; };
const bBase = b => ({ x: (b.x + BUILD[b.type].w / 2) * TS, y: (b.y + BUILD[b.type].h) * TS });   // bottom-centre of the footprint
const bDoor = b => ({ x: (b.x + (b.type === 'yard' ? 2.5 : 1.2)) * TS, y: (b.y + BUILD[b.type].h) * TS + 7 });
const yard = () => S.buildings[0];
const cabins = () => S.buildings.filter(b => b.type === 'cabin');
const crewOf = id => S.workers.filter(w => w.home === id);
const countRole = role => S.workers.reduce((n, w) => n + (w.role === role ? 1 : 0), 0);

// ---------------------------------------------------------------- new game
function blankState(slot, seed) {
  const z = () => new Array(NT).fill(0);
  return {
    v: 1, slot, seed, created: Date.now(), savedAt: 0, playTime: 0,
    coins: 0, inv: z(), sold: z(), seen: z(), autosell: z(),
    stats: { chopped: 0, delivered: 0, sales: 0, earned: 0, cut: z() },
    axe: 1, crewAxe: 1, boots: 0, pack: 0, crewBoots: 0, crewPack: 0,
    buildings: [{ id: 1, type: 'yard', x: CX - 2, y: CY - 2 }], nextId: 2,
    workers: [], piles: [], goal: 0, won: false,
    player: { x: YARD_X, y: (CY + 1) * TS + 12, face: 1, carry: [] },
  };
}
function resetTransient() {
  const P = S.player;
  Object.assign(P, { st: 'idle', path: [], queue: [], own: [], auto: false, target: -1, swing: 0, pause: 0, walkT: 0, moving: false });
  P.carry = P.carry || [];
  for (const w of S.workers) Object.assign(w, { st: 'idle', path: [], wait: Math.random(), target: -1, carry: [], res: 0, swing: 0, walkT: Math.random() * 3, moving: false, note: '', face: w.face || 1 });
  W.pileAt.clear(); W.pileById.clear();
  for (const p of S.piles) { p.res = 0; p.t = p.t || 0; W.pileAt.set(p.i, p); W.pileById.set(p.id, p); }
}
function newGame(slot) {
  S = blankState(slot, (Math.random() * 2e9) | 0);
  S.seen[0] = 1;
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
  const k = W.kind[i], T = TREES[k - 1], p = treeXY(i);
  W.hp.delete(i); W.claim.delete(i); W.g[i] = 0; W.growing.add(i);
  const pile = { id: S.nextId++, i, type: k - 1, n: T.logs, res: 0, t: 0.75 };
  S.piles.push(pile); W.pileAt.set(i, pile); W.pileById.set(pile.id, pile);
  S.stats.chopped++; S.stats.cut[k - 1]++; S.seen[k - 1] = 1;
  EV.push({ t: 'fall', x: p.x, y: p.y, k, v: W.vr[i], dir: who.x < p.x ? 1 : -1, me: who === S.player });
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
function sell(t, n) {
  n = Math.min(n, S.inv[t]); if (n <= 0) return 0;
  const v = n * TREES[t].price;
  S.inv[t] -= n; S.sold[t] += n; S.coins += v; S.stats.sales += n; S.stats.earned += v;
  return v;
}
function sellAll() { let v = 0; for (let t = 0; t < NT; t++) v += sell(t, S.inv[t]); return v; }
function deposit(e) {
  let coins = 0; const n = e.carry.length;
  for (const t of e.carry) { S.inv[t]++; S.stats.delivered++; S.seen[t] = 1; if (S.autosell[t]) coins += sell(t, 1); }
  e.carry = [];
  if (n) EV.push({ t: 'deposit', x: e.x, y: e.y, n, coins, me: e === S.player });
}
const canAfford = c => S.coins >= c.coins && c.wood.every(([t, n]) => S.inv[t] >= n);
function pay(c) { S.coins -= c.coins; for (const [t, n] of c.wood) S.inv[t] -= n; }

// ---------------------------------------------------------------- you
const playerCap = () => PLAYER_CARRY + S.pack;
const playerSpeed = () => PLAYER_SPEED * (1 + 0.12 * S.boots);
const crewSpeed = () => CREW_SPEED * (1 + 0.12 * S.crewBoots);
const haulerCap = () => HAULER_CARRY + 2 * S.crewPack;
const yardDrop = () => { const d = bDoor(yard()); return { x: d.x - 26 + Math.random() * 30, y: d.y + Math.random() * 4 }; };

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
  if (P.carry.length >= playerCap()) { P.st = 'toYard'; const d = yardDrop(); goTo(P, d.x, d.y); return; }
  goPile(P, pile);
}
function cmdYard() {
  const P = S.player; if (!P.carry.length) return false;
  P.auto = true; P.queue = []; P.st = 'toYard'; const d = yardDrop(); goTo(P, d.x, d.y); return true;
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
  if (P.carry.length >= playerCap() || (P.carry.length && !P.own.length)) { P.st = 'toYard'; const d = yardDrop(); goTo(P, d.x, d.y); return; }
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
function findTreeFor(w, home) {
  const R = BUILD.cabin.radius, cx = home.x + 1, cy = home.y + 1, P = S.player;
  let best = -1, bd = 1e9, tough = false;
  for (let y = Math.max(0, cy - R); y <= Math.min(MH - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(MW - 1, cx + R); x++) {
    const i = idx(x, y), k = W.kind[i];
    if (!k || W.g[i] < 1) continue;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > R * R) continue;
    if (!canCut(S.crewAxe, k)) { tough = true; continue; }
    if (W.claim.has(i) || P.target === i && (P.st === 'chop' || P.st === 'toTree')) continue;
    const d = Math.hypot(x * TS - w.x, y * TS - w.y);
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, tough };
}
function findPileFor(w, home, near) {
  const hd = bDoor(home); let best = null, bs = 1e9;
  for (const p of S.piles) {
    if (p.n - p.res <= 0) continue;
    const q = pileXY(p), dw = Math.hypot(q.x - w.x, q.y - w.y);
    if (near && dw > near) continue;
    const s = Math.hypot(q.x - hd.x, q.y - hd.y) + dw * 0.5;
    if (s < bs) { bs = s; best = p; }
  }
  return best;
}
function releaseWorker(w) {
  if (w.role === 'jack' && w.target >= 0 && W.claim.get(w.target) === w.id) W.claim.delete(w.target);
  if (w.role === 'hauler' && w.res) { const p = W.pileById.get(w.target); if (p) p.res = Math.max(0, p.res - w.res); w.res = 0; }
}
function tryJob(w, home) {
  if (w.role === 'jack') {
    const f = findTreeFor(w, home);
    if (f.i < 0) { w.note = f.tough ? 'Needs a better crew axe for these trees' : 'Waiting for trees to grow back'; return false; }
    W.claim.set(f.i, w.id); startChop(w, f.i); w.note = 'Off to chop ' + TREES[W.kind[f.i] - 1].name; return true;
  }
  const room = haulerCap() - w.carry.length;
  const p = room > 0 ? findPileFor(w, home, w.carry.length ? 8 * TS : 0) : null;
  if (p) { w.res = Math.min(room, p.n - p.res); p.res += w.res; goPile(w, p); w.note = 'Fetching ' + TREES[p.type].name + ' logs'; return true; }
  if (w.carry.length) { w.st = 'toYard'; const d = yardDrop(); goTo(w, d.x, d.y); w.note = 'Hauling ' + w.carry.length + ' logs to the yard'; return true; }
  w.note = 'No logs to haul';
  return false;
}
function updWorker(w, dt) {
  const sp = crewSpeed(), home = W.bById.get(w.home);
  if (w.swing > 0) w.swing -= dt;
  switch (w.st) {
    case 'idle':
    case 'home':
      if (w.st === 'home') { if (moveStep(w, dt, sp * 0.8)) w.st = 'idle'; } else w.moving = false;
      w.wait -= dt;
      if (w.wait > 0) break;
      if (!tryJob(w, home)) {
        w.wait = 1.6 + Math.random();
        const d = bDoor(home);
        if (w.st === 'idle' && Math.hypot(d.x - w.x, d.y - w.y) > 34) { w.st = 'home'; goTo(w, d.x - 14 + Math.random() * 28, d.y + Math.random() * 12); }
      }
      break;
    case 'toTree':
      if (!isMature(w.target)) { releaseWorker(w); w.st = 'idle'; w.wait = 0.2; break; }
      if (moveStep(w, dt, sp)) { w.st = 'chop'; w.swing = CREW_SWING * 0.6; w.face = treeXY(w.target).x > w.x ? 1 : -1; w.note = 'Chopping ' + TREES[W.kind[w.target] - 1].name; }
      break;
    case 'chop':
      w.moving = false;
      if (!isMature(w.target)) { releaseWorker(w); w.st = 'idle'; w.wait = 0.2; break; }
      if (w.swing <= 0) { w.swing += CREW_SWING; if (hitTree(w.target, S.crewAxe, w)) { w.st = 'idle'; w.wait = 1.6; w.swing = 0; w.target = -1; } }
      break;
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
  }
}
function hire(cabinId, role) {
  const home = W.bById.get(cabinId);
  if (!home || crewOf(cabinId).length >= BUILD.cabin.beds) return null;
  const cost = hireCost(role, countRole(role));
  if (S.coins < cost) return null;
  S.coins -= cost;
  const d = bDoor(home), used = new Set(S.workers.map(w => w.name));
  const free = NAMES.filter(n => !used.has(n));
  const w = { id: S.nextId++, role, home: cabinId, name: (free.length ? free : NAMES)[(Math.random() * (free.length || NAMES.length)) | 0], col: (Math.random() * 6) | 0, x: d.x, y: d.y, face: 1 };
  S.workers.push(w);
  Object.assign(w, { st: 'idle', path: [], wait: 0.6, target: -1, carry: [], res: 0, swing: 0, walkT: 0, moving: false, note: 'Just arrived' });
  EV.push({ t: 'hire', x: d.x, y: d.y, w });
  return w;
}
function dismiss(id) {
  const k = S.workers.findIndex(w => w.id === id); if (k < 0) return;
  const w = S.workers[k]; releaseWorker(w);
  for (const t of w.carry) S.inv[t]++;       // whatever they were carrying isn't lost
  S.workers.splice(k, 1);
}

// ---------------------------------------------------------------- building and upgrades
function canPlace(type, tx, ty) {
  const B = BUILD[type];
  for (let yy = 0; yy < B.h; yy++) for (let xx = 0; xx < B.w; xx++) {
    const x = tx + xx, y = ty + yy;
    if (x < 2 || y < 4 || x >= MW - 2 || y >= MH - 3) return false;
    const i = idx(x, y);
    if (W.block[i] || W.pileAt.has(i) || (W.kind[i] && W.g[i] >= 0.45)) return false;
  }
  // leave room around other buildings so roofs never cover a door or the yard's front
  for (const b of S.buildings) {
    const O = BUILD[b.type], front = b.type === 'yard' ? 3 : 2;
    if (tx < b.x + O.w + 1 && tx + B.w > b.x - 1 && ty < b.y + O.h + front && ty + B.h > b.y - 2) return false;
  }
  return !W.block[idx(tx + 1, ty + B.h)];
}
function placeCabin(tx, ty) {
  const cost = cabinCost(cabins().length);
  if (!canPlace('cabin', tx, ty) || !canAfford(cost)) return null;
  pay(cost);
  const b = { id: S.nextId++, type: 'cabin', x: tx, y: ty };
  S.buildings.push(b); rebuildBlocks();
  // anyone standing where the cabin went steps out to its door
  const d = bDoor(b);
  for (const e of [S.player].concat(S.workers)) if (blockedPx(e.x, e.y)) {
    const dest = e.path.length ? e.path[e.path.length - 1] : null;
    e.x = d.x + (Math.random() - 0.5) * 16; e.y = d.y + Math.random() * 6;
    if (dest) goTo(e, dest.x, dest.y);
  }
  const c = bBase(b); EV.push({ t: 'build', x: c.x, y: c.y, b });
  return b;
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
  const c = upgCost(k, S[k]); if (S.coins < c) return false;
  S.coins -= c; S[k]++; return true;
}

// ---------------------------------------------------------------- goals
function goalValue(key) {
  switch (key) {
    case 'chopped': return S.stats.chopped;
    case 'delivered': return S.stats.delivered;
    case 'sales': return S.stats.sales;
    case 'cabins': return cabins().length;
    case 'jacks': return countRole('jack');
    case 'haulers': return countRole('hauler');
    case 'workers': return S.workers.length;
    case 'axe': return S.axe;
  }
  return key.startsWith('sold') ? S.sold[+key.slice(4)] : 0;
}
function checkGoal() {
  const g = GOALS[S.goal]; if (!g) return;
  if (goalValue(g.key) < g.n) return;
  S.coins += g.r; S.stats.earned += g.r; S.goal++;
  if (g.win) S.won = true;
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
      if (g >= 1) { W.g[i] = 1; W.growing.delete(i); } else W.g[i] = g;
    }
    growAcc = 0;
  }
  goalAcc += dt;
  if (goalAcc > 0.4) { goalAcc = 0; checkGoal(); }
}

// ---------------------------------------------------------------- saving
function snapshot() {
  const grow = {}; for (const i of W.growing) grow[i] = Math.round(W.g[i] * 1000) / 1000;
  const P = S.player, inv = S.inv.slice();
  for (const w of S.workers) for (const t of w.carry) inv[t]++;      // logs in transit are banked
  return Object.assign({}, S, {
    inv, grow, savedAt: Date.now(),
    player: { x: Math.round(P.x), y: Math.round(P.y), face: P.face, carry: P.carry.slice() },
    workers: S.workers.map(w => ({ id: w.id, role: w.role, home: w.home, name: w.name, col: w.col, x: Math.round(w.x), y: Math.round(w.y), face: w.face })),
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
  const base = blankState(slot, d.seed);
  S = Object.assign(base, d, { slot, stats: Object.assign(base.stats, d.stats) });
  for (const k of ['inv', 'sold', 'seen', 'autosell']) { S[k] = (S[k] || []).slice(0, NT); while (S[k].length < NT) S[k].push(0); }
  while (S.stats.cut.length < NT) S.stats.cut.push(0);
  genMap(S.seed);
  for (const k in (d.grow || {})) { const i = +k; if (W.kind[i]) { W.g[i] = d.grow[k]; W.growing.add(i); } }
  delete S.grow;
  S.piles = (S.piles || []).filter(p => W.kind[p.i]);
  rebuildBlocks();
  S.workers = S.workers.filter(w => W.bById.has(w.home));
  resetTransient();
  return true;
}
function deleteSlot(slot) {
  try { localStorage.removeItem(SAVE_KEY(slot)); } catch (e) { }
  try { if (window.AndroidBridge && AndroidBridge.backup) AndroidBridge.backup(slot, ''); } catch (e) { }
}
;(window.__stage = window.__stage || []).push('world.js loaded');
