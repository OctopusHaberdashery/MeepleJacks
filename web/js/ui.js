// MeepleJacks — HUD, panels, menus and touch input.
'use strict';

const $ = id => document.getElementById(id);
function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return (n / 1000).toFixed(n < 1e5 ? 1 : 0) + 'k';
  if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
  return (n / 1e9).toFixed(2) + 'B';
}
function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'meeplejacks_settings';
const SET_DEFAULT = { master: 0.8, music: 0.5, sfx: 0.7, amb: 0.5, fps: 60, showFps: false, uiScale: 1, autosave: 60, keepAwake: true, fade: true, lastSlot: null };
let SET = Object.assign({}, SET_DEFAULT);
function loadSettings() { try { Object.assign(SET, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SET)); } catch (e) { } }
function applySettings() {
  AUDIO.vol = { master: SET.master, music: SET.music, sfx: SET.sfx, amb: SET.amb }; AUDIO.applyVolume();
  document.documentElement.style.fontSize = (16 * SET.uiScale) + 'px';
  R.fade = SET.fade;
  $('fps').classList.toggle('hidden', !SET.showFps);
  if (window.AndroidBridge && AndroidBridge.keepScreenOn) AndroidBridge.keepScreenOn(!!SET.keepAwake);
}

// ---------------------------------------------------------------- state, toasts, modals
const UI = { inGame: false, paused: false, panel: null, tab: 'sell', cabinId: 0, mode: null, hud: {}, panelHtml: '', panelTouch: false, modalAct: null, modalBack: null };

function toast(msg, kind, icon) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.innerHTML = (icon ? ico(icon) : '') + '<span>' + msg + '</span>';
  const box = $('toasts'); box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 3200);
}
function modal(html, onAct, onBack) {
  const m = $('modal');
  m.innerHTML = `<div class="mbox">${html}</div>`;
  m.classList.remove('hidden');
  UI.modalAct = onAct; UI.modalBack = onBack || null;
  return m.firstChild;
}
function closeModal() { $('modal').classList.add('hidden'); $('modal').innerHTML = ''; UI.modalAct = UI.modalBack = null; }
const modalOpen = () => !$('modal').classList.contains('hidden');

// ---------------------------------------------------------------- HUD
function buildHud() {
  $('toolbar').innerHTML = [['yard', 'yard', 'Yard'], ['build', 'hammer', 'Build'], ['crew', 'jack', 'Crew'], ['map', 'map', 'Map']]
    .map(([a, i, l]) => `<button class="btn tool" data-a="${a}">${ico(i)}${l}</button>`).join('');
  $('hMenu').innerHTML = ico('menu'); $('hLocate').innerHTML = ico('target');
  UI.hud = {};
}
function setHud(id, html) { if (UI.hud[id] !== html) { UI.hud[id] = html; $(id).innerHTML = html; } }
function updateHud() {
  const P = S.player;
  setHud('hCoins', ico('coin') + fmt(S.coins));
  setHud('hCarry', ico('log' + (P.carry.length ? P.carry[P.carry.length - 1] : 0)) + P.carry.length + '/' + playerCap());
  setHud('hCrew', ico('jack') + S.workers.length);
  const g = GOALS[S.goal];
  if (g) {
    const v = Math.min(g.n, goalValue(g.key));
    setHud('hGoal', `<div class="gt">${esc(g.t)}</div><div class="gd">${esc(g.d)}</div><div class="gp"><div class="bar"><i style="width:${v / g.n * 100}%"></i></div><span>${fmt(v)}/${fmt(g.n)}</span>${g.r ? `<span>${ico('coin', 'sm')}${fmt(g.r)}</span>` : ''}</div>`);
  } else setHud('hGoal', `<div class="gt">★ Master of the Forest</div><div class="gd">Every goal is done. Keep the saws singing!</div><div class="gp"><span>${ico('coin', 'sm')}${fmt(S.stats.earned)} earned · ${fmt(S.stats.chopped)} trees felled</span></div>`);
  $('hLocate').classList.toggle('on', R.follow);
}

// ---------------------------------------------------------------- panels
function chips(cost) {
  let h = '';
  if (cost.coins) h += `<span class="chip ${S.coins >= cost.coins ? '' : 'bad'}">${ico('coin')}${fmt(cost.coins)}</span>`;
  for (const [t, n] of cost.wood) h += `<span class="chip ${S.inv[t] >= n ? '' : 'bad'}">${ico('log' + t)}${S.inv[t] >= n ? n : S.inv[t] + '/' + n} ${TREES[t].name}</span>`;
  return h;
}
function cabinBody(b) {
  const crew = crewOf(b.id), full = crew.length >= BUILD.cabin.beds, cj = hireCost('jack', countRole('jack')), ch = hireCost('hauler', countRole('hauler'));
  let h = crew.map(w => `<div class="wk">${ico(w.role + w.col)}<div class="grow"><div class="t">${esc(w.name)} <span class="s">${w.role === 'jack' ? 'lumberjack' : 'hauler'}</span></div><div class="s">${esc(w.note || '')}</div></div>
    <button class="btn sm" data-a="find" data-v="${w.id}">Find</button><button class="btn sm red" data-a="dismiss" data-v="${w.id}">✕</button></div>`).join('');
  if (!crew.length) h = '<p class="s">Nobody lives here yet.</p>';
  h += `<div class="row" style="margin-top:.55rem">
    <button class="btn green grow" data-a="hire" data-v="${b.id}|jack" ${!full && S.coins >= cj ? '' : 'disabled'}>${ico('jack', 'sm')}Lumberjack ${ico('coin', 'sm')}${fmt(cj)}</button>
    <button class="btn green grow" data-a="hire" data-v="${b.id}|hauler" ${!full && S.coins >= ch ? '' : 'disabled'}>${ico('hauler', 'sm')}Hauler ${ico('coin', 'sm')}${fmt(ch)}</button></div>`;
  if (full) h += '<p class="s" style="margin:.5rem 0 0">Every bed is taken. Build another cabin for more crew.</p>';
  return h;
}
const PANELS = {
  yard() {
    const stock = S.inv.reduce((a, n) => a + n, 0);
    const head = `${ico('yard')}<h2>Lumber Yard<small>${fmt(stock)} logs in stock</small></h2>`;
    const tabs = `<div class="tabs">${[['sell', 'Sell'], ['shop', 'Workshop'], ['trees', 'Trees']].map(([k, l]) => `<button class="btn tab ${UI.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    let b = '';
    if (UI.tab === 'sell') {
      const total = S.inv.reduce((a, n, t) => a + n * TREES[t].price, 0);
      b += `<button class="btn gold wide" data-a="sellall" ${total ? '' : 'disabled'}>Sell everything ${ico('coin', 'sm')}${fmt(total)}</button><div style="height:.7rem"></div>`;
      for (let t = 0; t < NT; t++) {
        if (!S.seen[t]) { b += `<div class="card locked"><div class="t">???</div><div class="s">A tougher, pricier wood grows farther from the yard.</div></div>`; break; }
        const n = S.inv[t];
        b += `<div class="card"><div class="row">${ico('log' + t, 'lg')}<div class="grow"><div class="t">${TREES[t].name} <span class="s">× ${fmt(n)}</span></div><div class="s">${ico('coin', 'sm')}${TREES[t].price} a log</div></div>
          <button class="btn sm" data-a="sell" data-v="${t}|10" ${n ? '' : 'disabled'}>Sell 10</button><button class="btn sm gold" data-a="sell" data-v="${t}|all" ${n ? '' : 'disabled'}>All</button></div>
          <div class="row" style="margin-top:.4rem"><span class="s grow">Sell as soon as it's delivered</span><div class="toggle"><button class="${S.autosell[t] ? 'on' : ''}" data-a="auto" data-v="${t}|1">On</button><button class="${S.autosell[t] ? '' : 'on'}" data-a="auto" data-v="${t}|0">Off</button></div></div></div>`;
      }
      b += '<p class="s">Logs you keep can be spent on cabins and better axes.</p>';
    } else if (UI.tab === 'shop') {
      const axeCard = crew => {
        const lv = S[crew ? 'crewAxe' : 'axe'], c = axeCost(crew);
        let h = `<div class="card"><div class="row">${ico('axe' + lv, 'xl')}<div class="grow"><div class="t">${crew ? 'Crew axes' : 'Your axe'}: ${AXES[lv].name}</div><div class="s">Cuts ${TREES.slice(0, Math.min(lv, NT)).map(t => t.name).join(', ')}. ${lv} damage a swing.</div></div></div>`;
        if (c) h += `<div class="row" style="margin-top:.4rem"><div class="grow"><div class="s"><b>${AXES[lv + 1].name}</b>${lv < NT ? ' cuts ' + TREES[lv].name : ' chops even faster'}</div>${chips(c)}</div><button class="btn green" data-a="axe" data-v="${crew ? 1 : 0}" ${canAfford(c) ? '' : 'disabled'}>Forge</button></div>`;
        else h += '<div class="s" style="margin-top:.3rem">The finest axe there is.</div>';
        return h + '</div>';
      };
      const upg = (k, icon) => {
        const U = UPG[k], lv = S[k], c = upgCost(k, lv), max = lv >= U.max;
        return `<div class="card row">${ico(icon, 'lg')}<div class="grow"><div class="t">${U.name} <span class="s">${lv}/${U.max}</span></div><div class="s">${U.desc}</div>${max ? '' : `<span class="chip ${S.coins >= c ? '' : 'bad'}">${ico('coin')}${fmt(c)}</span>`}</div>
          <button class="btn green" data-a="upg" data-v="${k}" ${!max && S.coins >= c ? '' : 'disabled'}>${max ? 'Max' : 'Buy'}</button></div>`;
      };
      b += '<div class="sec">You</div>' + axeCard(false) + upg('boots', 'boots') + upg('pack', 'pack');
      b += '<div class="sec">Crew</div>' + axeCard(true) + upg('crewBoots', 'boots') + upg('crewPack', 'sled');
    } else {
      b += '<p class="s">The farther from the yard, the tougher the tree and the better the price.</p>';
      for (let t = 0; t < NT; t++) {
        const T = TREES[t], can = canCut(S.axe, t + 1);
        b += `<div class="card row"><img class="timg" src="${ART.url['tree' + t]}"><div class="grow"><div class="t">${T.name}</div>
          <div class="s">${t === 0 ? 'Right around the yard' : 'From about ' + RINGS[t] + ' tiles out'}</div>
          <div class="s">${can ? Math.ceil(T.hp / S.axe) + ' swings to fell' : 'Needs the ' + AXES[t + 1].name} · drops ${T.logs} logs</div>
          <span class="chip">${ico('coin')}${T.price} a log</span><span class="chip">regrows in ${fmtTime(T.regrow)}</span></div></div>`;
      }
    }
    return [head, tabs, b];
  },
  build() {
    const c = cabinCost(cabins().length);
    const head = `${ico('hammer')}<h2>Build<small>${cabins().length} cabin${cabins().length === 1 ? '' : 's'} so far</small></h2>`;
    const b = `<div class="card"><div class="row"><img class="bimg" src="${ART.url.cabin}"><div class="grow"><div class="t">Lumberjack Cabin</div>
      <div class="s">Beds for ${BUILD.cabin.beds} crew. Lumberjacks cut trees within ${BUILD.cabin.radius} tiles of the cabin; haulers carry log piles back to the yard.</div></div></div>
      <div class="row" style="margin-top:.45rem"><div class="grow">${chips(c)}</div><button class="btn green" data-a="place" ${canAfford(c) ? '' : 'disabled'}>Place</button></div></div>
      <p class="s">A cabin needs a clear 3 × 2 patch: no water, rocks or grown trees. Chop a clearing first if you want it out in the woods. Each cabin costs more than the last, and asks for wood from farther out.</p>`;
    return [head, '', b];
  },
  crew() {
    const head = `${ico('jack')}<h2>Crew<small>${countRole('jack')} lumberjacks · ${countRole('hauler')} haulers</small></h2>`;
    let b = '';
    const cs = cabins();
    if (!cs.length) b = '<p class="p">No crew yet. Build a <b>Lumberjack Cabin</b>, then hire lumberjacks to cut and haulers to carry.</p><button class="btn green" data-a="gobuild">Build a cabin</button>';
    else cs.forEach((c, n) => { b += `<div class="card"><div class="row">${ico('cabin', 'lg')}<div class="grow"><div class="t">Cabin ${n + 1}</div><div class="s">${crewOf(c.id).length}/${BUILD.cabin.beds} beds</div></div><button class="btn sm" data-a="showcabin" data-v="${c.id}">Show</button></div>${cabinBody(c)}</div>`; });
    return [head, '', b];
  },
  cabin() {
    const b = W.bById.get(UI.cabinId);
    if (!b) return ['<h2>Cabin</h2>', '', ''];
    const head = `${ico('cabin')}<h2>Lumberjack Cabin ${cabins().indexOf(b) + 1}<small>${crewOf(b.id).length}/${BUILD.cabin.beds} beds · cuts inside the dotted ring</small></h2>`;
    return [head, '', cabinBody(b)];
  },
};
function openPanel(name, arg) {
  if (UI.mode) endPlace();
  UI.panel = name; UI.panelHtml = '';
  if (name === 'cabin') UI.cabinId = arg;
  if (name === 'yard' && arg) UI.tab = arg;
  R.radiusOf = name === 'cabin' ? W.bById.get(arg) : null;
  $('panel').classList.remove('hidden');
  renderPanel(true); AUDIO.sfx('open');
}
function closePanel() {
  if (!UI.panel) return;
  UI.panel = null; R.radiusOf = null; $('panel').classList.add('hidden'); $('panel').innerHTML = '';
}
function renderPanel(fresh) {
  if (!UI.panel || (UI.panelTouch && !fresh)) return;
  const [head, tabs, body] = PANELS[UI.panel]();
  const html = head + tabs + body;
  if (html === UI.panelHtml) return;
  UI.panelHtml = html;
  const el = $('panel'), old = el.querySelector('.pb'), st = old && !fresh ? old.scrollTop : 0;
  el.innerHTML = `<div class="ph">${head}<button class="btn close" data-a="close">✕</button></div>${tabs}<div class="pb">${body}</div>`;
  el.querySelector('.pb').scrollTop = st;
}
function panTo(x, y) { R.follow = false; R.anchor = null; R.cam.x = x; R.cam.y = y; R.clampCam(); }
function panelAct(a, v) {
  let ok = true, snd = 'click';
  if (a === 'close') { closePanel(); AUDIO.sfx('close'); return; }
  else if (a === 'tab') { UI.tab = v; renderPanel(true); AUDIO.sfx('click'); return; }
  else if (a === 'sell') { const [t, n] = v.split('|'); ok = sell(+t, n === 'all' ? S.inv[+t] : 10) > 0; snd = 'coin'; }
  else if (a === 'sellall') { ok = sellAll() > 0; snd = 'coin'; }
  else if (a === 'auto') { const [t, on] = v.split('|'); S.autosell[+t] = +on; if (+on) sell(+t, S.inv[+t]); }
  else if (a === 'axe') { ok = buyAxe(v === '1'); snd = 'upgrade'; if (ok) toast((v === '1' ? 'The crew now swing the ' : 'You forged the ') + AXES[S[v === '1' ? 'crewAxe' : 'axe']].name + '!', 'good', 'axe' + S[v === '1' ? 'crewAxe' : 'axe']); }
  else if (a === 'upg') { ok = buyUpg(v); snd = 'upgrade'; }
  else if (a === 'place') { startPlace(); return; }
  else if (a === 'gobuild') { openPanel('build'); return; }
  else if (a === 'showcabin') { const b = W.bById.get(+v), c = bBase(b); panTo(c.x, c.y - 20); openPanel('cabin', b.id); return; }
  else if (a === 'hire') { const [id, role] = v.split('|'); const w = hire(+id, role); ok = !!w; snd = null; if (w) toast(`${esc(w.name)} the ${role === 'jack' ? 'lumberjack' : 'hauler'} joined the crew`, 'good', role); }
  else if (a === 'find') { const w = S.workers.find(x => x.id === +v); if (w) panTo(w.x, w.y - 10); }
  else if (a === 'dismiss') {
    const w = S.workers.find(x => x.id === +v); if (!w) return;
    modal(`<h2>Send ${esc(w.name)} home?</h2><p class="p">Their bed opens up for someone else. The hiring fee isn't refunded.</p><div class="btns"><button class="btn" data-a="no">Keep</button><button class="btn red" data-a="yes">Send home</button></div>`,
      x => { closeModal(); if (x === 'yes') { dismiss(w.id); renderPanel(true); } });
    return;
  }
  if (!ok) AUDIO.sfx('error'); else if (snd) AUDIO.sfx(snd);
  renderPanel(true);
}

// ---------------------------------------------------------------- placing a cabin
function setGhost(tx, ty) {
  R.ghost = { type: 'cabin', tx, ty, ok: canPlace('cabin', tx, ty) };
  R.radiusOf = { x: tx, y: ty };
  $('modebar').innerHTML = `<span>${R.ghost.ok ? 'Build the cabin here?' : 'Needs clear, dry ground. Tap another spot.'}</span>
    <button class="btn green ${R.ghost.ok ? '' : 'dis'}" data-a="ok">Build</button><button class="btn" data-a="cancel">Cancel</button>`;
}
function startPlace() {
  closePanel();
  UI.mode = 'place'; $('modebar').classList.remove('hidden');
  // start on the nearest free spot to the middle of the screen
  const w = R.screenToWorld(R.W / 2, R.H / 2), cx = Math.floor(w.x / TS) - 1, cy = Math.floor(w.y / TS) - 1;
  let best = null, bd = 1e9;
  for (let dy = -7; dy <= 7; dy++) for (let dx = -9; dx <= 9; dx++) if (canPlace('cabin', cx + dx, cy + dy)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [cx + dx, cy + dy]; } }
  setGhost(best ? best[0] : cx, best ? best[1] : cy);
  toast('Tap the ground to move the cabin, then press Build', null, 'cabin');
}
function endPlace() { UI.mode = null; R.ghost = null; R.radiusOf = null; $('modebar').classList.add('hidden'); }
function confirmPlace() {
  const g = R.ghost; if (!g) return;
  const b = placeCabin(g.tx, g.ty);
  if (!b) { AUDIO.sfx('error'); toast(canAfford(cabinCost(cabins().length)) ? "A cabin can't go there" : "You can't afford the cabin any more", 'bad'); setGhost(g.tx, g.ty); return; }
  endPlace(); openPanel('cabin', b.id); saveGame();
}

// ---------------------------------------------------------------- touching the world
function pickTree(wx, wy) {
  const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS);
  for (let y = Math.min(MH - 1, ty + 6); y >= Math.max(0, ty - 1); y--) for (let x = Math.max(0, tx - 2); x <= Math.min(MW - 1, tx + 2); x++) {
    const i = idx(x, y), k = W.kind[i]; if (!k || W.g[i] < 0.12) continue;
    const g = W.g[i], s = ART.tree[k - 1][W.vr[i]][g >= 1 ? 2 : g < 0.45 ? 0 : 1], p = treeXY(i);
    if (Math.abs(wx - p.x) <= Math.max(5, s.w * 0.42) && wy <= p.y + 3 && wy >= p.y - s.h + 2) return i;
  }
  return -1;
}
function onWorldTap(sx, sy) {
  const w = R.screenToWorld(sx, sy);
  if (UI.mode === 'place') { setGhost(Math.floor(w.x / TS) - 1, Math.floor(w.y / TS) - 1); AUDIO.sfx('click'); return; }
  for (const b of S.buildings) {
    const base = bBase(b), s = ART.spr[b.type];
    if (Math.abs(w.x - base.x) < BUILD[b.type].w * TS / 2 + 2 && w.y < base.y + 2 && w.y > base.y - s.h + 8) {
      if (b.type === 'yard') { cmdYard(); openPanel('yard'); } else openPanel('cabin', b.id);
      return;
    }
  }
  let best = null, bd = 11;
  for (const p of S.piles) { const q = pileXY(p), d = Math.hypot(q.x - w.x, q.y - 4 - w.y); if (d < bd) { bd = d; best = p; } }
  if (best) { cmdPile(best); AUDIO.sfx('click'); R.marks.push({ x: pileXY(best).x, y: pileXY(best).y, t: 0 }); return; }
  for (const k of S.workers) if (Math.hypot(k.x - w.x, k.y - 9 - w.y) < 9) { openPanel('cabin', k.home); return; }
  const i = pickTree(w.x, w.y);
  if (i >= 0) {
    const r = cmdChop(i), T = TREES[W.kind[i] - 1];
    if (r === 'ok' || r === 'same') AUDIO.sfx('click');
    else if (r === 'queued' || r === 'unqueue') AUDIO.sfx('queue');
    else {
      AUDIO.sfx('error');
      if (r === 'tough') toast(`${T.name} is too tough for your ${AXES[S.axe].name}. Forge the ${AXES[W.kind[i]].name} in the Workshop.`, 'bad', 'axe' + W.kind[i]);
      else if (r === 'young') toast('That one is still growing', null, 'tree' + (W.kind[i] - 1));
      else if (r === 'full') toast('Your chopping list is full');
    }
    return;
  }
  if (blockedPx(w.x, w.y)) { AUDIO.sfx('error'); return; }
  cmdWalk(w.x, w.y); R.marks.push({ x: w.x, y: w.y, t: 0 });
}

const PTR = new Map();
let pinch = null, dragMoved = false, downAt = 0, wheelAcc = 0;
function setupInput() {
  const cv = R.cv;
  cv.addEventListener('pointerdown', e => {
    AUDIO.unlock();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    PTR.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (PTR.size === 1) { dragMoved = false; downAt = performance.now(); }
    if (PTR.size === 2) {
      const [a, b] = [...PTR.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: R.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      dragMoved = true; R.pinching = true; R.anchor = null; R.follow = false;
    }
  });
  cv.addEventListener('pointermove', e => {
    const p = PTR.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (PTR.size === 1) {
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 10) dragMoved = true;
      if (dragMoved) { R.follow = false; R.anchor = null; R.cam.x -= dx / R.z; R.cam.y -= dy / R.z; R.clampCam(); }
    } else if (PTR.size === 2 && pinch) {
      const [a, b] = [...PTR.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const before = R.screenToWorld(cx, cy);
      R.k = clamp(pinch.k * d / pinch.d, R.kMin, R.kMax); R.z = R.k / R.dpr;
      const after = R.screenToWorld(cx, cy);
      R.cam.x += before.x - after.x - (cx - pinch.cx) / R.z; R.cam.y += before.y - after.y - (cy - pinch.cy) / R.z;
      pinch.cx = cx; pinch.cy = cy; R.clampCam();
    }
  });
  const up = e => {
    if (!PTR.has(e.pointerId)) return;
    PTR.delete(e.pointerId);
    if (pinch && PTR.size < 2) {
      const w = R.screenToWorld(pinch.cx, pinch.cy);
      R.kT = clamp(Math.round(R.k), R.kMin, R.kMax); R.anchor = { sx: pinch.cx, sy: pinch.cy, wx: w.x, wy: w.y };
      pinch = null; R.pinching = false;
    }
    if (PTR.size === 0 && !dragMoved && e.type === 'pointerup' && performance.now() - downAt < 700 && UI.inGame && !UI.paused) onWorldTap(e.clientX, e.clientY);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) >= 50) { R.follow = false; R.zoomBy(wheelAcc < 0 ? 1 : -1, e.clientX, e.clientY); wheelAcc = 0; }
  }, { passive: false });
  document.addEventListener('pointerdown', () => AUDIO.unlock(), { capture: true });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') handleBack(); });

  // DOM buttons
  const act = (el, fn) => el.addEventListener('click', e => { const t = e.target.closest('[data-a]'); if (t && !t.disabled) fn(t.dataset.a, t.dataset.v); });
  act($('panel'), panelAct);
  $('panel').addEventListener('pointerdown', () => { UI.panelTouch = true; });
  for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => { setTimeout(() => { UI.panelTouch = false; }, 60); });
  act($('modal'), (a, v) => { AUDIO.sfx('click'); if (UI.modalAct) UI.modalAct(a, v); });
  act($('toolbar'), a => {
    if (a === 'map') { AUDIO.sfx('open'); openMap(); return; }
    if (UI.panel === a) { closePanel(); AUDIO.sfx('close'); } else openPanel(a);
  });
  act($('modebar'), a => { if (a === 'ok') confirmPlace(); else { endPlace(); AUDIO.sfx('close'); } });
  $('hMenu').addEventListener('click', () => { AUDIO.sfx('click'); openPause(); });
  $('hLocate').addEventListener('click', () => { AUDIO.sfx('click'); R.follow = true; R.anchor = null; });
  $('hGoal').addEventListener('click', () => { const g = GOALS[S.goal]; if (g) toast(esc(g.d)); });
}

// ---------------------------------------------------------------- events from the sim
function onGameEvent(e) {
  if (e.t !== 'goal') return;
  AUDIO.sfx('goal');
  if (e.g.win) {
    modal(`<img class="ico xxl" src="${ART.url.tree6}"><h2>Master of the Forest!</h2><p class="p">From a rusty hatchet and a single pine to Ebony from the edge of the map. Your camp is the pride of the woods.<br><br>
      Played for <b>${fmtTime(S.playTime)}</b>, felled <b>${fmt(S.stats.chopped)}</b> trees and earned <b>${fmt(S.stats.earned)}</b> coins.</p>
      <div class="btns"><button class="btn green" data-a="ok">Keep logging</button></div>`, () => closeModal());
  } else toast(`Goal done: ${esc(e.g.t)}${e.g.r ? ' · +' + fmt(e.g.r) + ' coins' : ''}`, 'good', 'coin');
  saveGame();
}

// ---------------------------------------------------------------- menus
function handleBack() {
  if (modalOpen()) { const b = UI.modalBack; if (b) b(); else closeModal(); return true; }
  if (UI.mode) { endPlace(); return true; }
  if (UI.panel) { closePanel(); return true; }
  if (UI.inGame) { openPause(); return true; }
  return false;
}
window.onBackPressed = handleBack;

function slotInfo(s) {
  const d = readSlot(s); if (!d) return null;
  const crew = (d.workers || []).length;
  return { text: `${fmt(d.coins)} coins · ${crew} crew · ${AXES[d.axe || 1].name}`, sub: `Played ${fmtTime(d.playTime)} · saved ${new Date(d.savedAt || d.created).toLocaleString()}`, axe: d.axe || 1 };
}
function openSlots(mode) {
  const rows = [1, 2, 3].map(s => {
    const inf = slotInfo(s);
    return `<div class="card slot">${ico(inf ? 'axe' + inf.axe : 'tree0', 'xl')}<div class="grow"><div class="t">Camp ${s}</div><div class="s">${inf ? inf.text + '<br>' + inf.sub : 'Untouched forest'}</div></div>
      <div style="display:flex;flex-direction:column;gap:.45rem">${inf ? `<button class="btn sm green" data-a="load" data-v="${s}">Play</button><button class="btn sm red" data-a="del" data-v="${s}">Delete</button>` : `<button class="btn sm green" data-a="new" data-v="${s}">New</button>`}</div></div>`;
  }).join('');
  modal(`<h2>${mode === 'new' ? 'Choose a camp' : 'Your camps'}</h2>${rows}<div class="btns"><button class="btn" data-a="back">Back</button></div>`, (a, v) => {
    if (a === 'back') closeModal();
    else if (a === 'load') { closeModal(); startGame(+v, false); }
    else if (a === 'new') { closeModal(); startGame(+v, true); }
    else if (a === 'del') {
      modal(`<h2>Delete Camp ${v}?</h2><p class="p">This can't be undone.</p><div class="btns"><button class="btn" data-a="no">Cancel</button><button class="btn red" data-a="yes">Delete</button></div>`,
        b => { if (b === 'yes') { deleteSlot(+v); if (SET.lastSlot == v) { SET.lastSlot = null; saveSettings(); } } openSlots(mode); buildTitleMenu(); });
    }
  });
}
function buildTitleMenu() {
  const last = SET.lastSlot && readSlot(SET.lastSlot) ? SET.lastSlot : null;
  const any = [1, 2, 3].some(s => readSlot(s)), items = [];
  if (last) items.push('<button class="btn green" data-a="continue">▶ Continue</button>');
  items.push(`<button class="btn ${last ? '' : 'green'}" data-a="newgame">New Camp</button>`);
  if (any) items.push('<button class="btn" data-a="load">Load Camp</button>');
  items.push('<button class="btn" data-a="settings">Settings</button>');
  items.push('<button class="btn" data-a="help">How to Play</button>');
  if (window.AndroidBridge && AndroidBridge.exitApp) items.push('<button class="btn" data-a="quit">Quit</button>');
  $('mainMenu').innerHTML = items.join('');
  $('mainMenu').onclick = e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    AUDIO.unlock(); AUDIO.sfx('click');
    const a = el.dataset.a;
    if (a === 'continue') startGame(last, false);
    else if (a === 'newgame') { const free = [1, 2, 3].find(s => !readSlot(s)); if (free && !any) startGame(free, true); else openSlots('new'); }
    else if (a === 'load') openSlots('load');
    else if (a === 'settings') openSettings();
    else if (a === 'help') openHelp();
    else if (a === 'quit') AndroidBridge.exitApp();
  };
  $('logoMeeples').innerHTML = `<img class="t" src="${ART.url.tree0}"><img src="${ART.url.jack}"><img src="${ART.url.player}"><img src="${ART.url.hauler}"><img class="t" src="${ART.url.tree3}">`;
  $('ver').textContent = 'v' + VERSION;
}
function openPause() {
  UI.paused = true;
  modal(`<h2>Paused</h2><div class="menu" style="margin:0 auto">
    <button class="btn green" data-a="resume">▶ Resume</button>
    <button class="btn" data-a="save">Save Game</button>
    <button class="btn" data-a="settings">Settings</button>
    <button class="btn" data-a="help">How to Play</button>
    <button class="btn" data-a="title">Save & Return to Title</button></div>`, a => {
    if (a === 'resume') { closeModal(); UI.paused = false; }
    else if (a === 'save') { const ok = saveGame(); toast(ok ? 'Game saved' : 'Save failed!', ok ? 'good' : 'bad'); }
    else if (a === 'settings') openSettings(true);
    else if (a === 'help') openHelp(true);
    else if (a === 'title') { saveGame(); closeModal(); UI.paused = false; toTitle(); }
  }, () => { closeModal(); UI.paused = false; });
}
function openSettings(fromPause) {
  const sl = (k, l) => `<div class="setrow"><span>${l}</span><input type="range" min="0" max="1" step="0.05" value="${SET[k]}" data-k="${k}"></div>`;
  const tg = (k, l, opts) => `<div class="setrow"><span>${l}</span><div class="toggle">${opts.map(([v, t]) => `<button class="${SET[k] === v ? 'on' : ''}" data-a="set" data-v="${k}|${esc(JSON.stringify(v))}">${t}</button>`).join('')}</div></div>`;
  const back = () => { saveSettings(); if (fromPause) openPause(); else closeModal(); };
  const m = modal(`<h2>Settings</h2><div style="text-align:left">
    <div class="sec">Sound</div>${sl('master', 'Master')}${sl('music', 'Music')}${sl('sfx', 'Effects')}${sl('amb', 'Forest sounds')}
    <div class="sec">Display</div>
    ${tg('uiScale', 'Button size', [[0.85, 'Small'], [1, 'Medium'], [1.15, 'Large'], [1.3, 'Huge']])}
    ${tg('fade', 'See through trees', [[true, 'On'], [false, 'Off']])}
    ${tg('fps', 'Frame rate', [[30, '30'], [60, '60'], [0, 'Max']])}
    ${tg('showFps', 'Show FPS', [[true, 'On'], [false, 'Off']])}
    <div class="sec">System</div>
    ${tg('autosave', 'Autosave', [[30, '30s'], [60, '1 min'], [180, '3 min'], [300, '5 min']])}
    ${tg('keepAwake', 'Keep screen on', [[true, 'On'], [false, 'Off']])}
    <p class="s">The camp only works while the game is open on screen. There's no offline progress.</p>
    </div><div class="btns"><button class="btn" data-a="reset">Reset defaults</button><button class="btn green" data-a="done">Done</button></div>`, (a, v) => {
    if (a === 'set') { const [k, raw] = v.split('|'); SET[k] = JSON.parse(raw); saveSettings(); applySettings(); openSettings(fromPause); }
    else if (a === 'reset') { SET = Object.assign({}, SET_DEFAULT, { lastSlot: SET.lastSlot }); saveSettings(); applySettings(); openSettings(fromPause); }
    else if (a === 'done') back();
  }, back);
  m.oninput = e => { const k = e.target.dataset.k; if (k) { SET[k] = +e.target.value; applySettings(); } };
  m.onchange = e => { if (e.target.dataset.k) { saveSettings(); AUDIO.sfx('pick'); } };
}
function openHelp(fromPause) {
  const back = () => { if (fromPause) openPause(); else closeModal(); };
  modal(`<h2>How to Play</h2><div style="text-align:left" class="p">
    <p>${ico('player', 'sm')} <b>Tap a tree</b> and your Meeple walks over and chops it down. Tap more trees to line them up (tap again to cancel one).</p>
    <p>${ico('log0', 'sm')} Felled trees leave a <b>log pile</b>. Your Meeple carries its own piles to the <b>Lumber Yard</b>; tap any other pile to fetch it.</p>
    <p>${ico('coin', 'sm')} Tap the yard to <b>sell</b> wood. Keep some back: cabins and axes cost logs as well as coins.</p>
    <p>${ico('cabin', 'sm')} Build a <b>Lumberjack Cabin</b>, then tap it to hire. <b>Lumberjacks</b> cut every tree they can inside the dotted ring; <b>haulers</b> carry log piles to the yard.</p>
    <p>${ico('axe2', 'sm')} The forest grows in rings. Pine by the yard is soft and cheap. Birch, Oak, Maple, Cherry, Redwood and Ebony each lie farther out, take a better <b>axe</b>, and sell for more.</p>
    <p>${ico('tree1', 'sm')} Stumps grow back into trees after a few minutes, so a cabin never runs dry for long.</p>
    <p>${ico('map', 'sm')} The <b>Map</b> shows the whole forest. Tap it to jump there. Drag to look around, pinch to zoom, and press ${ico('target', 'sm')} to follow your Meeple again.</p>
    </div><div class="btns"><button class="btn green" data-a="ok">Got it</button></div>`, back, back);
}
function openMap() {
  UI.paused = true;
  const done = () => { closeModal(); UI.paused = false; };
  const box = modal(`<h2>The Forest</h2><canvas id="mapcv" width="${MW}" height="${MH}"></canvas>
    <div class="row wrap" style="justify-content:center;margin-top:.5rem">${TREES.map((t, i) => `<span class="chip"><i style="width:.8rem;height:.8rem;background:${shade(t.col, -0.12)};border:2px solid var(--ink)"></i>${t.name}</span>`).join('')}</div>
    <p class="s">Tap the map to look there.</p><div class="btns"><button class="btn green" data-a="ok">Close</button></div>`, done, done);
  const cv = box.querySelector('#mapcv'), g = cv.getContext('2d'), P = S.player;
  g.drawImage(R.minimap(), 0, 0);
  const px = Math.floor(P.x / TS), py = Math.floor(P.y / TS);
  g.fillStyle = '#ffffff'; g.fillRect(px - 2, py - 2, 5, 5); g.fillStyle = '#d8402e'; g.fillRect(px - 1, py - 1, 3, 3);
  const hw = R.W / R.z / TS / 2, hh = R.H / R.z / TS / 2;
  g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.strokeRect(Math.round(R.cam.x / TS - hw) + 0.5, Math.round(R.cam.y / TS - hh) + 0.5, Math.round(hw * 2), Math.round(hh * 2));
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect();
    panTo((e.clientX - r.left) / r.width * MAPW, (e.clientY - r.top) / r.height * MAPH);
    done();
  });
}
;(window.__stage = window.__stage || []).push('ui.js loaded');
