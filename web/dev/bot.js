// Dev-only: a simple autoplayer for measuring how long the game takes. Not part of the APK.
// Usage (browser console, on the title screen):  runBot().then(r => console.log(r))
// It plays greedily and never rests, so a person will take noticeably longer than it does.
'use strict';

window.BOT = { log: [], status: 'idle' };

function botFindSpot(type, cx, cy) {
  let best = null, bd = 1e9;
  for (let r = 0; r < 40 && !best; r += 2) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < r - 1) continue;
    if (canPlace(type, cx + dx, cy + dy)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [cx + dx, cy + dy]; } }
  }
  return best;
}
function botThink() {
  const P = S.player;
  // --- you: keep chopping the nearest tree you can
  if (P.st === 'idle' && !P.auto && P.pause <= 0) {
    const i = nearestTile(Math.floor(P.x / TS), Math.floor(P.y / TS), t => isMature(t) && W.kind[t] <= S.axe && !W.claim.has(t));
    if (i >= 0) cmdChop(i);
  }
  for (const o of S.orders.slice()) if (S.inv[o.item] >= o.n) fillOrder(o.id);

  // --- what we'd like to buy, cheapest first
  const wants = [];
  const add = (coins, wood, go, tag) => wants.push({ coins, wood: wood || [], go, tag });
  for (const crew of [true, false]) { const c = axeCost(crew); if (c && (crew || S.axe < S.crewAxe + 1)) add(c.coins, c.wood, () => buyAxe(crew), 'axe'); }
  for (const k in UPG) { const U = UPG[k]; if (S[k] < U.max && (!U.need || countB(U.need))) { const c = upgCost(k, S[k]); add(c.coins, c.wood, () => buyUpg(k), k); } }
  const fullOf = type => S.buildings.filter(b => b.type === type).every(b => crewOf(b.id).length >= bedsOf(b));
  const top = Math.min(S.crewAxe, NT) - 1;
  const caps = { cabin: 99, forester: 2, sawmill: 4, kiln: 3, depot: 2, workshop: 4, lodge: 1 };
  for (const type of ['cabin', 'forester', 'sawmill', 'kiln', 'depot', 'workshop', 'lodge']) {
    if (!unlocked(type) || countB(type) >= caps[type] || !fullOf(type)) continue;
    const c = buildCost(type);
    add(c.coins, c.wood, () => {
      const far = type === 'depot' ? RINGS[top] + 3 : 0, ang = countB(type) * 2.4 + 0.5;
      const spot = botFindSpot(type, Math.round(CX + Math.cos(ang) * (far || 7 + countB(type) * 1.5 + S.buildings.length)), Math.round(CY + Math.sin(ang) * (far || 7 + S.buildings.length)));
      return spot && placeBuilding(type, spot[0], spot[1]);
    }, type);
  }
  for (const b of S.buildings) {
    const B = BUILD[b.type]; if (!B.roles || crewOf(b.id).length >= bedsOf(b)) continue;
    let role = B.roles[0];
    if (b.type === 'cabin') {
      const mine = S.piles.filter(p => b.wood < 0 || p.type === b.wood).length, crew = crewOf(b.id);
      const j = crew.filter(w => w.role === 'jack').length, h = crew.length - j;
      role = j === 0 ? 'jack' : (mine > 4 + 3 * h || h < j * 0.8) ? 'hauler' : 'jack';
    }
    add(hireCost(role, countRole(role)), [], () => hire(b.id, role), role);
  }
  for (const b of S.buildings) if (b.type === 'cabin' && !b.foreman && crewOf(b.id).length >= 4) add(foremanCost(countForemen()), [], () => buyForeman(b.id), 'foreman');
  const lg = lodge(), st = lg && lodgeStep();
  if (st) { const left = st.coins - (lg.got.coins || 0); if (left > 0) add(left, [], () => lodgePay(), 'lodge-coins'); }
  wants.sort((a, b) => a.coins - b.coins);

  // --- what to hold back: the Lodge's needs and the next few purchases
  const keep = new Array(NI).fill(0);
  if (st) {
    for (const [it, n] of st.need) keep[it] += Math.max(0, n - (lg.got[it] || 0) - (lg.tr[it] || 0));
    // stock up for the step after this one too, as a person would
    const L = LODGE[S.lodgeStage], nx = L.steps[S.lodgeStep + 1] || (LODGE[S.lodgeStage + 1] && LODGE[S.lodgeStage + 1].steps[0]);
    if (nx) for (const [it, n] of nx.need) keep[it] += n;
  }
  for (const w of wants) if (w.coins <= S.coins * 2 + 50) for (const [it, n] of w.wood) keep[it] = Math.max(keep[it], n);
  // goods we must make pull on what they are made from
  const feed = new Array(NI).fill(0);
  for (let t = 0; t < NT; t++) {
    const needF = Math.max(0, keep[FURN(t)] - S.inv[FURN(t)]); feed[PLANK(t)] += needF * 2;
    const needP = Math.max(0, keep[PLANK(t)] + feed[PLANK(t)] - S.inv[PLANK(t)]); feed[LOG(t)] += needP;
  }
  const needC = Math.max(0, keep[CHAR] - S.inv[CHAR]); feed[LOG(0)] += needC * 3;
  // something for the workshops to chew on when nothing is wanted in particular
  const saw = countRole('sawyer'), carp = countRole('carpenter'), col = countRole('collier');
  if (saw && top >= 0) feed[LOG(top)] = Math.max(feed[LOG(top)], 40 * saw);
  if (carp && top >= 0) { feed[PLANK(top)] = Math.max(feed[PLANK(top)], 30 * carp); }
  if (col) feed[LOG(0)] = Math.max(feed[LOG(0)], 30 * col);
  for (let it = 0; it < NI; it++) { S.keep[it] = keep[it]; const extra = S.inv[it] - keep[it] - feed[it]; if (extra > 0) sell(it, extra); }

  // --- point buildings at the wood that is short
  const short = [];
  for (let t = 0; t < NT; t++) if (t < S.crewAxe && keep[LOG(t)] + feed[LOG(t)] > S.inv[LOG(t)]) short.push(t);
  const cs = cabins();
  cs.forEach((c, k) => { const want = cs.length > 1 && k < short.length && k < cs.length - 1 ? short[k] : top; if (c.wood !== want) setWood(c.id, want); });
  const pShort = []; for (let t = NT - 1; t >= 0; t--) if (keep[PLANK(t)] + feed[PLANK(t)] > S.inv[PLANK(t)]) pShort.push(t);
  S.buildings.filter(b => b.type === 'sawmill').forEach((m, k) => { const want = k < pShort.length ? pShort[k] : -1; if (m.wood !== want) setWood(m.id, want); });
  const fShort = []; for (let t = NT - 1; t >= 0; t--) if (keep[FURN(t)] > S.inv[FURN(t)]) fShort.push(t);
  S.buildings.filter(b => b.type === 'workshop').forEach((m, k) => { const want = k < fShort.length ? fShort[k] : -1; if (m.wood !== want) setWood(m.id, want); });

  // --- buy whatever we can afford, cheapest first
  for (const w of wants) if (S.coins >= w.coins && w.wood.every(([it, n]) => S.inv[it] >= n)) w.go();
}

window.runBot = async function (maxHours = 60, dt = 0.1) {
  running = false;                       // stop the normal frame loop while the bot runs
  newGame(-1); UI.inGame = false;
  const B = window.BOT; B.log = []; B.status = 'running'; B.goals = {}; B.lodge = {};
  let tick = 0, nextSnap = 1800, lastStage = 0;
  const hrs = () => +(S.playTime / 3600).toFixed(2);
  while (!S.won && S.playTime < maxHours * 3600 && B.status === 'running') {
    for (let n = 0; n < 3000 && !S.won; n++) {
      update(dt);
      for (const e of EV) if (e.t === 'goal') B.goals[e.g.id] = hrs();
      EV.length = 0; W.dirty.length = 0;
      if (++tick % 10 === 0) botThink();
      if (S.lodgeStage !== lastStage) { lastStage = S.lodgeStage; B.lodge[lastStage] = hrs(); }
    }
    if (S.playTime >= nextSnap) {
      nextSnap += 1800;
      const roles = {}; for (const w of S.workers) roles[w.role] = (roles[w.role] || 0) + 1;
      B.log.push({ h: hrs(), coins: Math.round(S.coins), earned: Math.round(S.stats.earned), crew: S.workers.length, roles, cabins: countB('cabin'), axe: S.axe + '/' + S.crewAxe, lodge: S.lodgeStage, hats: S.hats.length, goal: (curGoal() || {}).id });
    }
    await new Promise(r => setTimeout(r, 0));
  }
  B.status = S.won ? 'won' : 'stopped'; B.hours = hrs(); B.steps = B.steps || {};
  return { hours: B.hours, won: S.won, goals: B.goals, lodge: B.lodge };
};
