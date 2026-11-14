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
const UI = { inGame: false, paused: false, panel: null, tab: 'sell', bid: 0, ancR: 0, place: null, hatFor: 'you', hud: {}, panelHtml: '', panelTouch: false, modalAct: null, modalBack: null };

function toast(msg, kind, icon) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.innerHTML = (icon ? ico(icon) : '') + '<span>' + msg + '</span>';
  const box = $('toasts'); box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 3400);
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
  $('toolbar').innerHTML = [['yard', 'yard', 'Yard'], ['build', 'hammer', 'Build'], ['crew', 'jack', 'Crew'], ['hats', 'hats', 'Hats'], ['map', 'map', 'Map']]
    .map(([a, i, l]) => `<button class="btn tool" data-a="${a}">${ico(i)}${l}</button>`).join('');
  $('hMenu').innerHTML = ico('menu'); $('hLocate').innerHTML = ico('target');
  UI.hud = {};
}
function setHud(id, html) { if (UI.hud[id] !== html) { UI.hud[id] = html; $(id).innerHTML = html; } }
function updateHud() {
  const P = S.player;
  setHud('hCoins', ico('coin') + fmt(S.coins));
  setHud('hCarry', ico('it' + (P.carry.length ? P.carry[P.carry.length - 1] : 0)) + P.carry.length + '/' + playerCap());
  setHud('hCrew', ico('jack') + S.workers.length);
  setHud('hSeason', ico(SEASONS[SEA].id) + `<span class="lbl">${SEASONS[SEA].name}</span>`);
  const g = curGoal();
  if (g) {
    const v = Math.min(g.n, goalValue(g.key));
    setHud('hGoal', `<div class="gt">${esc(g.t)}</div><div class="gd">${esc(g.d)}</div><div class="gp"><div class="bar"><i style="width:${v / g.n * 100}%"></i></div><span>${fmt(v)}/${fmt(g.n)}</span>${g.r ? `<span>${ico('coin', 'sm')}${fmt(g.r)}</span>` : ''}</div>`);
  } else setHud('hGoal', `<div class="gt">★ Master of the Forest</div><div class="gd">The Great Lodge stands. Keep the saws singing!</div><div class="gp"><span>${ico('coin', 'sm')}${fmt(S.stats.earned)} earned · ${fmt(S.stats.chopped)} trees felled</span></div>`);
  $('hLocate').classList.toggle('on', R.follow);
}

// ---------------------------------------------------------------- panel pieces
function chips(cost) {
  let h = '';
  if (cost.coins) h += `<span class="chip ${S.coins >= cost.coins ? '' : 'bad'}">${ico('coin')}${fmt(cost.coins)}</span>`;
  for (const [t, n] of cost.wood) h += `<span class="chip ${S.inv[t] >= n ? '' : 'bad'}">${ico('it' + t)}${S.inv[t] >= n ? n : fmt(S.inv[t]) + '/' + n} ${ITEMS[t].name}</span>`;
  return h;
}
const bIcon = b => b.type === 'lodge' ? 'lodge' + Math.min(S.lodgeStage, LODGE.length) : b.type;
const bName = b => { const n = countB(b.type); return BUILD[b.type].name + (n > 1 ? ' ' + (S.buildings.filter(x => x.type === b.type).indexOf(b) + 1) : ''); };
const WOOD_VERB = { cabin: 'Cut and haul', forester: 'Replant', sawmill: 'Saw', kiln: 'Burn', workshop: 'Build from' };
function crewRows(b) {
  const crew = crewOf(b.id);
  if (!crew.length) return '<p class="s">Nobody works here yet.</p>';
  return crew.map(w => `<div class="wk"><img class="ico" src="${meepleURL(w.role, w.col, S.crewHat)}"><div class="grow"><div class="t">${esc(w.name)} <span class="s">${ROLES[w.role].name.toLowerCase()} · ${SKILL[w.lvl].name} · ${GAITS[w.gait].toLowerCase()}</span></div>
    <div class="s">${quirkLine(w)}</div><div class="s">${esc(w.note || '')}</div></div>
    <div class="wkb"><button class="btn sm" data-a="find" data-v="${w.id}">Find</button><button class="btn sm" data-a="job" data-v="${w.id}">Job</button><button class="btn sm red" data-a="dismiss" data-v="${w.id}">✕</button></div></div>`).join('');
}
// a Meeple's quirk, and whether it is any use in the job they have
function quirkLine(w, role) {
  const q = QUIRK[w.quirk]; if (!q) return '';
  return quirkFits(w.quirk, role || w.role) ? `<b class="qk">${q.name}</b>: ${q.text}` : `<b class="qk off">${q.name}</b>: ${q.text} <i>(no help to a ${ROLES[role || w.role].name.toLowerCase()})</i>`;
}
function skillLine(w) {
  const nx = SKILL[w.lvl + 1];
  return SKILL[w.lvl].name + (w.lvl ? `: ${Math.round(SKILL_BONUS * w.lvl * 100)}% faster at everything` : ': still learning the ropes') + (nx ? ` · ${nx.name} after ${fmtTime(nx.at - w.xp)} more work` : '');
}
// choose a new job for a Meeple: any building with a free place
function openJobs(w) {
  let rows = '';
  for (const b of S.buildings) {
    const B = BUILD[b.type]; if (!B.roles) continue;
    const here = b.id === w.home, room = here || crewOf(b.id).length < bedsOf(b);
    for (const role of B.roles) {
      if (here && role === w.role) continue;
      const fits = quirkFits(w.quirk, role) && QUIRK[w.quirk].fits;
      rows += `<div class="wk">${ico(role)}<div class="grow"><div class="t">${ROLES[role].name} <span class="s">at ${bName(b)}${b.wood >= 0 ? ' · ' + TREES[b.wood].name : ''}</span></div>
        <div class="s">${room ? crewOf(b.id).length + '/' + bedsOf(b) + ' places taken' : 'No free place'}${fits ? ' · <b class="qk">suits ' + QUIRK[w.quirk].name + '</b>' : ''}</div></div>
        <button class="btn sm green" data-a="go" data-v="${b.id}|${role}" ${room ? '' : 'disabled'}>Move</button></div>`;
    }
  }
  modal(`<h2>A new job for ${esc(w.name)}</h2><p class="s" style="text-align:left">${quirkLine(w)}<br>${skillLine(w)}</p><div style="text-align:left">${rows || '<p class="p">There is nowhere else to work yet.</p>'}</div>
    <div class="btns"><button class="btn" data-a="no">Stay put</button></div>`, (a, v) => {
    closeModal();
    if (a !== 'go') return;
    const [id, role] = v.split('|');
    if (reassign(w.id, +id, role)) { toast(`${esc(w.name)} is now a ${ROLES[role].name.toLowerCase()}`, 'good', role); saveGame(); } else AUDIO.sfx('error');
    renderPanel(true);
  });
}
function hireRow(b) {
  const B = BUILD[b.type]; if (!B.roles) return '';
  const full = crewOf(b.id).length >= bedsOf(b);
  let h = '<div class="row wrap" style="margin-top:.55rem">' + B.roles.map(r => {
    const c = hireCost(r, countRole(r));
    return `<button class="btn green grow" data-a="hire" data-v="${b.id}|${r}" ${!full && S.coins >= c ? '' : 'disabled'}>${ico(r, 'sm')}${ROLES[r].name} ${ico('coin', 'sm')}${fmt(c)}</button>`;
  }).join('') + '</div>';
  if (full) h += `<p class="s" style="margin:.5rem 0 0">Every place here is taken. Build another ${B.name.toLowerCase()} for more.</p>`;
  return h;
}
function woodRow(b) {
  const B = BUILD[b.type]; if (!B.wood) return '';
  let h = `<div class="sec">${WOOD_VERB[b.type]}</div><div class="row wrap"><button class="btn sm ${b.wood < 0 ? 'on' : ''}" data-a="wood" data-v="${b.id}|-1">${b.type === 'kiln' ? 'Cheapest' : b.type === 'cabin' || b.type === 'forester' ? 'Nearest' : 'Best'}</button>`;
  for (let t = 0; t < B.wood; t++) if (S.seen[t]) h += `<button class="btn sm ${b.wood === t ? 'on' : ''}" data-a="wood" data-v="${b.id}|${t}">${ico('log' + t, 'sm')}${TREES[t].name}</button>`;
  return h + '</div>';
}
function lodgeBody(b) {
  const L = LODGE[S.lodgeStage], st = lodgeStep();
  let h = `<div class="row"><img class="bimg" src="${ART.url['lodge' + Math.min(S.lodgeStage, LODGE.length)]}"><div class="grow">`;
  if (!st) return h + '<div class="t">The Great Lodge is finished</div><div class="s">Every storey stands, from Pine foundations to the Ebony spire. The whole forest is welcome.</div></div></div>';
  h += `<div class="t">Storey ${S.lodgeStage + 1} of ${LODGE.length}: ${L.name}</div><div class="s">Step ${S.lodgeStep + 1} of ${L.steps.length}: <b>${st.name}</b></div><div class="s">Reward for the storey: <b>${L.perk}</b></div></div></div><div class="sec">This step needs</div>`;
  for (const [it, n] of st.need) {
    const got = b.got[it] || 0, left = n - got;
    h += `<div class="req">${ico('it' + it)}<div class="grow"><div class="row"><b class="grow">${ITEMS[it].name}</b><span>${fmt(got)}/${fmt(n)}</span></div><div class="bar"><i style="width:${got / n * 100}%"></i></div><div class="s">${left <= 0 ? 'Done' : S.inv[it] > 0 ? fmt(S.inv[it]) + ' in the yard' : 'None in the yard: the builders are waiting'}</div></div></div>`;
  }
  const gc = b.got.coins || 0, left = st.coins - gc;
  h += `<div class="req">${ico('coin')}<div class="grow"><div class="row"><b class="grow">Coins</b><span>${fmt(gc)}/${fmt(st.coins)}</span></div><div class="bar"><i style="width:${gc / st.coins * 100}%"></i></div></div>
    <button class="btn gold sm" data-a="paylodge" ${left > 0 && S.coins > 0 ? '' : 'disabled'}>${left > 0 ? 'Pay ' + fmt(Math.min(S.coins, left)) : 'Paid'}</button></div>`;
  return h + `<p class="s">Builders carry each piece from the yard, ${BUILDER_CARRY} at a time, and fit it. Holding goods back in the Sell tab keeps them from being sold, but never from the builders.</p>`;
}
function bldBody(b) {
  const B = BUILD[b.type];
  let h = '';
  if (b.type === 'lodge') h += lodgeBody(b);
  else h += `<p class="s" style="margin-top:0">${B.desc}</p>`;
  if (b.type === 'depot') {
    const load = depotLoad(b);
    h += `<div class="sec">In the depot · ${load}/${DEPOT_ROOM}</div><div class="row wrap">${load ? b.store.map((n, it) => n ? `<span class="chip">${ico('it' + it)}${n} ${ITEMS[it].name}</span>` : '').join('') : '<span class="s">Empty. Haulers unload here once a carter is hired.</span>'}</div>`;
  }
  h += woodRow(b);
  if (B.roles) h += `<div class="sec">Crew · ${crewOf(b.id).length}/${bedsOf(b)}</div>` + crewRows(b) + hireRow(b);
  if (b.type === 'cabin') {
    const c = foremanCost(countForemen());
    h += b.foreman ? `<div class="wk">${ico('foreman')}<div class="grow"><div class="t">Foreman</div><div class="s">This cabin's crew walks and works 30% faster.</div></div></div>`
      : `<div class="wk">${ico('foreman')}<div class="grow"><div class="t">Foreman</div><div class="s">Makes this cabin's crew 30% faster.</div></div><button class="btn sm green" data-a="foreman" data-v="${b.id}" ${S.coins >= c ? '' : 'disabled'}>${ico('coin', 'sm')}${fmt(c)}</button></div>`;
  }
  if (b.type !== 'yard') h += `<div class="row" style="margin-top:.7rem"><button class="btn grow" data-a="move" data-v="${b.id}">${ico('move', 'sm')}Move (free)</button></div>`;
  return h;
}
const KEEP_STEPS = [0, 10, 25, 50, 100, 250, 500, 1000, 2500];
function sellCard(it) {
  const n = S.inv[it], sp = spare(it), k = S.keep[it];
  return `<div class="card"><div class="row">${ico('it' + it, 'lg')}<div class="grow"><div class="t">${ITEMS[it].name} <span class="s">× ${fmt(n)}</span></div><div class="s">${ico('coin', 'sm')}${fmt(ITEMS[it].price)} each</div></div>
    <button class="btn sm" data-a="sell" data-v="${it}|10" ${sp ? '' : 'disabled'}>Sell 10</button><button class="btn sm gold" data-a="sell" data-v="${it}|all" ${sp ? '' : 'disabled'}>All</button></div>
    <div class="row" style="margin-top:.4rem"><span class="s">Auto-sell</span><div class="toggle"><button class="${S.autosell[it] ? 'on' : ''}" data-a="auto" data-v="${it}|1">On</button><button class="${S.autosell[it] ? '' : 'on'}" data-a="auto" data-v="${it}|0">Off</button></div>
    <span class="s grow" style="text-align:right">Keep</span><div class="toggle"><button data-a="keep" data-v="${it}|-1">−</button><button class="mid" disabled>${fmt(k)}</button><button data-a="keep" data-v="${it}|1">+</button></div></div></div>`;
}
const PANELS = {
  yard() {
    const stock = S.inv.reduce((a, n) => a + n, 0);
    const head = `${ico('yard')}<h2>Lumber Yard<small>${fmt(stock)} goods in stock</small></h2>`;
    const tabList = [['sell', 'Sell'], ['orders', 'Orders' + (S.orders.length ? ' ' + S.orders.length : '')], ['shop', 'Workshop'], ['trees', 'Trees']];
    const tabs = `<div class="tabs">${tabList.map(([k, l]) => `<button class="btn tab ${UI.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    let b = '';
    if (UI.tab === 'sell') {
      let total = 0; for (let it = 0; it < NI; it++) total += spare(it) * ITEMS[it].price;
      b += `<button class="btn gold wide" data-a="sellall" ${total ? '' : 'disabled'}>Sell everything spare ${ico('coin', 'sm')}${fmt(total)}</button><p class="s">“Keep” holds that many back in the yard: they aren't sold, sawn or burned, so they are there for building, orders and the Lodge.</p>`;
      for (const [title, from, to] of [['Logs', 0, NT], ['Planks', NT, 2 * NT], ['Furniture and charcoal', 2 * NT, NI]]) {
        let sec = '';
        for (let it = from; it < to; it++) if (S.seen[it]) sec += sellCard(it);
        if (sec) b += `<div class="sec">${title}</div>` + sec;
      }
      const next = S.seen.slice(0, NT).indexOf(0);
      if (next > 0) b += '<div class="card locked"><div class="t">???</div><div class="s">A tougher, pricier wood grows farther from the yard.</div></div>';
    } else if (UI.tab === 'orders') {
      if (!ordersOpen()) b = '<p class="p">Sell a little more wood and the neighbours will start sending orders.</p>';
      else {
        const r = rankOf(), nx = RANKS[r + 1];
        b = `<div class="card"><div class="row">${ico('scroll', 'lg')}<div class="grow"><div class="t">${RANKS[r].name}</div><div class="s">${fmt(S.stats.orders)} orders filled${nx ? ` · <b>${nx.name}</b> at ${nx.n}` : ''}</div>
          ${nx ? `<div class="bar" style="margin:.2rem 0"><i style="width:${(S.stats.orders - RANKS[r].n) / (nx.n - RANKS[r].n) * 100}%"></i></div><div class="s">Next reward: ${nx.text}</div>` : '<div class="s">The whole valley knows your name.</div>'}</div></div></div>
          <p class="s">Neighbours pay well over the usual price. Orders fill from the yard and expire if left too long.${SEA === 2 ? ' <b>It is harvest time: every order pays 25% more.</b>' : ''}</p>`;
        for (const o of S.orders) {
          const have = S.inv[o.item];
          b += `<div class="card"><div class="row">${ico('it' + o.item, 'lg')}<div class="grow"><div class="t">${fmt(o.n)} ${ITEMS[o.item].name}</div><div class="s">${have >= o.n ? 'Ready to deliver' : fmt(have) + ' of ' + fmt(o.n) + ' in the yard'} · ${fmtTime(o.t)} left</div>
            <span class="chip ok">${ico('coin')}${fmt(orderPay(o))}</span><span class="chip">usual price ${fmt(o.n * ITEMS[o.item].price)}</span>${o.fair ? `<span class="chip">${ico(SEASONS[o.fair - 1].id)}${SEASONS[o.fair - 1].fair}</span>` : ''}</div>
            <button class="btn green" data-a="order" data-v="${o.id}" ${have >= o.n ? '' : 'disabled'}>Deliver</button></div></div>`;
        }
        if (!S.orders.length) b += '<p class="p">No orders just now. Another will arrive soon.</p>';
      }
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
        if (U.need && !countB(U.need)) return '';
        return `<div class="card row">${ico(icon, 'lg')}<div class="grow"><div class="t">${U.name} <span class="s">${lv}/${U.max}</span></div><div class="s">${U.desc}</div>${max ? '' : chips(c)}</div>
          <button class="btn green" data-a="upg" data-v="${k}" ${!max && canAfford(c) ? '' : 'disabled'}>${max ? 'Max' : 'Buy'}</button></div>`;
      };
      b += '<div class="sec">You</div>' + axeCard(false) + upg('boots', 'boots') + upg('pack', 'pack');
      b += '<div class="sec">Crew</div>' + axeCard(true) + upg('crewBoots', 'boots') + upg('crewPack', 'sled') + upg('seeds', 'seedling') + upg('blades', 'blade') + upg('carts', 'cart') + upg('chisels', 'chisel');
    } else {
      const left = SEASON_LEN - S.playTime % SEASON_LEN;
      b += `<div class="card row">${ico(SEASONS[SEA].id, 'lg')}<div class="grow"><div class="t">${SEASONS[SEA].name}, year ${yearNow()} <span class="s">${fmtTime(left)} until ${SEASONS[(SEA + 1) % 4].name.toLowerCase()}</span></div><div class="s">${SEASONS[SEA].perk}.</div></div></div>`;
      b += '<p class="s">The farther from the yard, the tougher the tree and the better the price. A river rings each kind of wood, and one Ancient tree stands in every ring.</p>';
      for (let t = 0; t < NT; t++) {
        const T = TREES[t], can = canCut(S.axe, t + 1), hats = HATS.filter(h => h.tree === t), found = hats.filter(h => S.hats.includes(h.id)).length;
        b += `<div class="card row"><img class="timg" src="${ART.url['tree' + t]}"><div class="grow"><div class="t">${T.name}</div>
          <div class="s">${t === 0 ? 'Right around the yard' : 'Beyond the ' + RIVER_NAMES[t] + ' River' + (t > S.reach ? ', not bridged yet' : '')}</div>
          <div class="s">${can ? Math.ceil(T.hp / S.axe) + ' swings to fell' : 'Needs the ' + AXES[t + 1].name} · drops ${T.logs % 1 ? Math.floor(T.logs) + ' or ' + Math.ceil(T.logs) : T.logs} logs</div>
          <span class="chip">${ico('coin')}${T.price} a log</span><span class="chip">regrows in ${fmtTime(T.regrow / SEASON_GROW[SEA])}</span><span class="chip">${ico('hats')}${found}/${hats.length} hats</span>
          <button class="chip tap ${S.anc[t].done ? '' : 'ok'}" data-a="showanc" data-v="${t}">${ico('star')}Ancient ${T.name}: ${S.anc[t].done ? 'felled' : 'standing'}</button></div></div>`;
      }
    }
    return [head, tabs, b];
  },
  build() {
    const head = `${ico('hammer')}<h2>Build<small>${S.buildings.length - 1} building${S.buildings.length === 2 ? '' : 's'} so far</small></h2>`;
    let b = '';
    const nk = S.reach + 1;
    if (nk < NT) {
      const lock = bridgeLock(nk), c = bridgeCost(nk, 0);
      b += `<div class="card"><div class="row">${ico('bridge', 'xl')}<div class="grow"><div class="t">Bridge over the ${RIVER_NAMES[nk]} River</div><div class="s">The only way across to the ${TREES[nk].name}. It can go anywhere along the river, so choose a spot that suits your camp.</div></div></div>
        <div class="row" style="margin-top:.45rem"><div class="grow">${lock ? `<span class="s">To unlock: ${lock}.</span>` : chips(c)}</div>${lock ? `<button class="btn" data-a="showanc" data-v="${nk - 1}">Show me</button>` : `<button class="btn green" data-a="place" data-v="bridge|${nk}" ${canAfford(c) ? '' : 'disabled'}>Place</button>`}</div></div>`;
    }
    if (S.reach >= 1) {
      const c = bridgeCost(1, bridgesOver(1));
      b += `<div class="card"><div class="row">${ico('bridge', 'lg')}<div class="grow"><div class="t">Another bridge <span class="s">× ${S.bridges.length} so far</span></div><div class="s">A second way over a river you have already bridged saves the crew long walks. Each extra one over the same river costs twice the coins.</div></div></div>
        <div class="row" style="margin-top:.45rem"><div class="grow"><span class="chip">${ico('coin')}from ${fmt(c.coins)}</span></div><button class="btn green" data-a="place" data-v="bridge|0">Place</button></div></div>`;
    }
    for (const type of ['cabin', 'forester', 'sawmill', 'kiln', 'depot', 'workshop', 'lodge']) {
      const B = BUILD[type], img = type === 'lodge' ? ART.url.lodge : ART.url[type];
      if (!unlocked(type)) { b += `<div class="card locked row"><img class="bimg" src="${img}" style="filter:brightness(0) opacity(.45)"><div class="grow"><div class="t">${B.name}</div><div class="s">To unlock: ${B.need[2]}.</div></div></div>`; continue; }
      if (B.unique && countB(type)) { b += `<div class="card row"><img class="bimg" src="${img}"><div class="grow"><div class="t">${B.name}</div><div class="s">Already staked out. Tap it on the map to see what the next storey needs.</div></div></div>`; continue; }
      const c = buildCost(type);
      b += `<div class="card"><div class="row"><img class="bimg" src="${img}"><div class="grow"><div class="t">${B.name}${countB(type) ? ' <span class="s">× ' + countB(type) + '</span>' : ''}</div><div class="s">${B.desc}</div></div></div>
        <div class="row" style="margin-top:.45rem"><div class="grow">${chips(c)}</div><button class="btn green" data-a="place" data-v="${type}" ${canAfford(c) ? '' : 'disabled'}>Place</button></div></div>`;
    }
    b += '<p class="s">Buildings need clear, dry ground on your side of the rivers with no grown trees, so chop a clearing first if you want one out in the woods. Any building can be moved later for free.</p>';
    return [head, '', b];
  },
  crew() {
    const counts = Object.keys(ROLES).map(r => [r, countRole(r)]).filter(x => x[1]);
    const head = `${ico('jack')}<h2>Crew<small>${S.workers.length} Meeple${S.workers.length === 1 ? '' : 's'} at work</small></h2>`;
    let b = counts.length ? `<div class="row wrap">${counts.map(([r, n]) => `<span class="chip">${ico(r)}${n} ${ROLES[r].name}${n > 1 ? 's' : ''}</span>`).join('')}</div>` : '';
    const staffed = S.buildings.filter(x => BUILD[x.type].roles);
    if (!staffed.length) b = '<p class="p">No crew yet. Build a <b>Lumberjack Cabin</b>, then hire lumberjacks to cut and haulers to carry.</p><button class="btn green" data-a="gobuild">Build a cabin</button>';
    else for (const c of staffed) b += `<div class="card"><div class="row">${ico(c.type, 'lg')}<div class="grow"><div class="t">${bName(c)}${c.wood >= 0 ? ' <span class="s">· ' + TREES[c.wood].name + '</span>' : ''}</div><div class="s">${crewOf(c.id).length}/${bedsOf(c)} places${c.foreman ? ' · foreman' : ''}</div></div><button class="btn sm" data-a="show" data-v="${c.id}">Show</button></div>${crewRows(c)}</div>`;
    return [head, '', b];
  },
  bld() {
    const b = W.bById.get(UI.bid);
    if (!b) return ['<h2>Gone</h2>', '', ''];
    const B = BUILD[b.type];
    return [`${ico(bIcon(b))}<h2>${bName(b)}<small>${B.roles ? crewOf(b.id).length + '/' + bedsOf(b) + ' places' : b.type === 'lodge' ? S.lodgeStage + ' of ' + LODGE.length + ' storeys built' : ''}</small></h2>`, '', bldBody(b)];
  },
  anc() {
    const r = UI.ancR, a = S.anc[r], T = TREES[r], name = 'Ancient ' + T.name;
    if (a.done) {
      let b = `<div class="row"><img class="bimg" src="${ART.url['ancStump' + r]}"><div class="grow"><div class="t">Felled</div><div class="s">Only the stump is left, and it will be here for a hundred years.</div></div></div>`;
      if (r + 1 < NT) {
        const k = r + 1, done = S.reach >= k, c = bridgeCost(k, 0);
        b += `<div class="sec">The ${RIVER_NAMES[k]} River</div>` + (done ? `<p class="s">Bridged. The ${TREES[k].name} is yours to cut.</p>`
          : `<p class="s">With the ${name} down, the river can be bridged to reach the ${TREES[k].name}.</p><div class="row"><div class="grow">${chips(c)}</div><button class="btn green" data-a="place" data-v="bridge|${k}" ${canAfford(c) ? '' : 'disabled'}>Place a bridge</button></div>`);
      }
      return [`${ico('star')}<h2>${name}<small>felled</small></h2>`, '', b];
    }
    const far = r > S.reach, at = W.ancSlots[r].filter(Boolean).length, jacks = countRole('jack');
    let b = `<div class="row"><img class="bimg tall" src="${ART.url['anc' + r]}"><div class="grow"><div class="s">The oldest ${T.name} in the forest, and far too much tree for one axe. When it falls it leaves <b>${ANCIENT_LOGS[r]} ${T.name} logs</b> and <b>a hat</b>${r + 1 < NT ? `, and the <b>${RIVER_NAMES[r + 1]} River</b> can be bridged` : ''}.</div>
      <div class="bar" style="margin:.4rem 0 .15rem"><i style="width:${(1 - a.hp / ANCIENT_HP[r]) * 100}%"></i></div><div class="s">${fmt(ANCIENT_HP[r] - a.hp)} of ${fmt(ANCIENT_HP[r])} chopped${at ? ' · ' + at + ' lumberjack' + (at > 1 ? 's' : '') + ' at it' : ''}</div></div></div>`;
    if (far) b += `<p class="s"><b>It stands beyond the ${RIVER_NAMES[r]} River.</b> Bridge that first.</p>`;
    const mine = !far && canCut(S.axe, r + 1), crew = !far && canCut(S.crewAxe, r + 1);
    b += `<div class="wk">${ico('player')}<div class="grow"><div class="t">You</div><div class="s">${far ? 'Out of reach' : mine ? AXES[S.axe].name + ': ' + S.axe + ' a swing' : 'Your ' + AXES[S.axe].name + " can't bite it. Forge the " + AXES[r + 1].name}</div></div><button class="btn sm green" data-a="ancchop" data-v="${r}" ${mine ? '' : 'disabled'}>Chop</button></div>`;
    b += `<div class="wk">${ico('jack')}<div class="grow"><div class="t">The lumberjacks <span class="s">${jacks} hired</span></div><div class="s">${far ? 'Out of reach' : !crew ? 'The crew need the ' + AXES[r + 1].name : !jacks ? 'Hire some at a cabin' : a.call ? 'Called: they come as they finish their trees' : 'Up to ' + ANCIENT_CREW + ' will leave their own trees to help'}</div></div>
      <button class="btn sm ${a.call ? '' : 'green'}" data-a="anccall" data-v="${r}|${a.call ? 0 : 1}" ${crew && jacks ? '' : 'disabled'}>${a.call ? 'Send back' : 'Call them'}</button></div>`;
    return [`${ico('star')}<h2>${name}<small>${fmt(a.hp)} left to chop</small></h2>`, '', b];
  },
  hats() {
    const head = `${ico('hats')}<h2>Hats and walks<small>${S.hats.length} of ${HATS.length} hats found</small></h2>`;
    const you = UI.hatFor === 'you', cur = you ? S.hat : S.crewHat;
    const tabs = `<div class="tabs"><button class="btn tab ${you ? 'on' : ''}" data-a="hatfor" data-v="you">You</button><button class="btn tab ${you ? '' : 'on'}" data-a="hatfor" data-v="crew">Your crew</button></div>`;
    const cell = (id, name, src, on) => `<button class="hat ${on ? 'on' : ''}" data-a="hat" data-v="${id}"><img src="${src}"><span>${name}</span></button>`;
    let b = `<div class="hatgrid">${cell('', you ? 'Hard hat' : 'Work hats', you ? meepleURL('player', 0) : meepleURL('jack', 1), !cur)}`;
    for (const h of HATS) b += S.hats.includes(h.id) ? cell(h.id, h.name, you ? meepleURL('player', 0, h.id) : meepleURL('jack', 1, h.id), cur === h.id)
      : h.tree < 0 ? `<div class="hat lost"><img src="${ART.url[SEASONS[h.season].id]}" style="filter:none;opacity:.6"><span>Only in ${SEASONS[h.season].name.toLowerCase()}</span></div>`
      : `<div class="hat lost"><img src="${ART.url['tree' + h.tree]}"><span>Hidden in ${TREES[h.tree].name}</span></div>`;
    b += '</div><p class="s">Felling a tree sometimes shakes a hat loose. Trees you fell yourself are much more likely to drop one. Every Ancient tree hides a hat for certain, and four hats only turn up in their own season.</p>';
    if (you) b += `<div class="sec">Your walk</div><div class="row wrap">${GAITS.map((g, i) => `<button class="btn sm ${S.gait === i ? 'on' : ''}" data-a="gait" data-v="${i}">${g}</button>`).join('')}</div>`;
    else b += '<p class="s">Every crew member walks their own way. You can see how in the Crew list.</p>';
    return [head, tabs, b];
  },
};
function openPanel(name, arg) {
  if (UI.place) endPlace();
  UI.panel = name; UI.panelHtml = '';
  if (name === 'bld') UI.bid = arg;
  if (name === 'anc') UI.ancR = arg;
  if (name === 'yard' && arg) UI.tab = arg;
  R.radiusOf = name === 'bld' ? W.bById.get(arg) : null;
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
  const el = $('panel'), old = el.querySelector('.pb'), st = old && fresh !== 'top' ? old.scrollTop : 0;
  el.innerHTML = `<div class="ph">${head}<button class="btn close" data-a="close">✕</button></div>${tabs}<div class="pb">${body}</div>`;
  el.querySelector('.pb').scrollTop = st;
}
function panTo(x, y) { R.follow = false; R.anchor = null; R.cam.x = x; R.cam.y = y; R.clampCam(); }
function panelAct(a, v) {
  let ok = true, snd = 'click';
  if (a === 'close') { closePanel(); AUDIO.sfx('close'); return; }
  else if (a === 'tab') { UI.tab = v; renderPanel('top'); AUDIO.sfx('click'); return; }
  else if (a === 'hatfor') { UI.hatFor = v; }
  else if (a === 'hat') { if (UI.hatFor === 'you') S.hat = v || null; else S.crewHat = v || null; snd = 'pick'; }
  else if (a === 'gait') { S.gait = +v; snd = 'pick'; }
  else if (a === 'sell') { const [t, n] = v.split('|'); ok = sell(+t, Math.min(spare(+t), n === 'all' ? 1e9 : 10)) > 0; snd = 'coin'; }
  else if (a === 'sellall') { ok = sellAll() > 0; snd = 'coin'; }
  else if (a === 'auto') { const [t, on] = v.split('|'); S.autosell[+t] = +on; if (+on) sell(+t, spare(+t)); }
  else if (a === 'keep') { const [t, d] = v.split('|'), i = KEEP_STEPS.findIndex(s => s >= S.keep[+t]); S.keep[+t] = KEEP_STEPS[clamp((i < 0 ? KEEP_STEPS.length - 1 : i) + +d, 0, KEEP_STEPS.length - 1)]; }
  else if (a === 'order') { ok = fillOrder(+v); snd = 'coin'; if (ok) toast('Order delivered', 'good', 'coin'); }
  else if (a === 'axe') { ok = buyAxe(v === '1'); snd = 'upgrade'; if (ok) toast((v === '1' ? 'The crew now swing the ' : 'You forged the ') + AXES[S[v === '1' ? 'crewAxe' : 'axe']].name + '!', 'good', 'axe' + S[v === '1' ? 'crewAxe' : 'axe']); }
  else if (a === 'upg') { ok = buyUpg(v); snd = 'upgrade'; }
  else if (a === 'place') { if (v.startsWith('bridge')) startBridge(+v.split('|')[1]); else startPlace(v); return; }
  else if (a === 'showanc') { const A = W.anc[+v]; panTo(A.x, A.y - 40); if (R.k < 1) R.kT = R.defaultK(); openPanel('anc', +v); return; }
  else if (a === 'ancchop') {
    const r = cmdAncient(+v); ok = r === 'ok';
    if (ok) { closePanel(); R.follow = true; R.anchor = null; AUDIO.sfx('click'); return; }
  }
  else if (a === 'anccall') { const [r, on] = v.split('|'); ok = callCrew(+r, on === '1'); snd = on === '1' ? 'hire' : 'click'; if (ok && on === '1') toast('The call goes out: every free axe to the Ancient ' + TREES[+r].name, 'good', 'jack'); }
  else if (a === 'job') { const w = S.workers.find(x => x.id === +v); if (w) { AUDIO.sfx('open'); openJobs(w); } return; }
  else if (a === 'move') { startPlace(W.bById.get(+v).type, +v); return; }
  else if (a === 'gobuild') { openPanel('build'); return; }
  else if (a === 'show') { const b = W.bById.get(+v), c = bBase(b); panTo(c.x, c.y - 20); openPanel('bld', b.id); return; }
  else if (a === 'wood') { const [id, t] = v.split('|'); setWood(+id, +t); }
  else if (a === 'hire') { const [id, role] = v.split('|'); const w = hire(+id, role); ok = !!w; snd = null; if (w) toast(`${esc(w.name)} the ${ROLES[role].name.toLowerCase()} joined the crew. <b>${QUIRK[w.quirk].name}</b>: ${QUIRK[w.quirk].text}`, 'good', role); }
  else if (a === 'foreman') { ok = buyForeman(+v); snd = null; if (ok) toast('A foreman takes charge of the cabin', 'good', 'foreman'); }
  else if (a === 'paylodge') { ok = lodgePay() > 0; snd = 'coin'; }
  else if (a === 'find') { const w = S.workers.find(x => x.id === +v); if (w) panTo(w.x, w.y - 10); }
  else if (a === 'dismiss') {
    const w = S.workers.find(x => x.id === +v); if (!w) return;
    modal(`<h2>Send ${esc(w.name)} home?</h2><p class="p">Their place opens up for someone else. The hiring fee isn't refunded.</p><div class="btns"><button class="btn" data-a="no">Keep</button><button class="btn red" data-a="yes">Send home</button></div>`,
      x => { closeModal(); if (x === 'yes') { dismiss(w.id); renderPanel(true); } });
    return;
  }
  if (!ok) AUDIO.sfx('error'); else if (snd) AUDIO.sfx(snd);
  renderPanel(true);
}

// ---------------------------------------------------------------- placing or moving a building
function setBridgeGhost(tx, ty) {
  const b = planBridge(tx, ty);
  R.ghost = b ? { bridge: b } : null;
  const can = b && b.ok && canAfford(b.cost);
  $('modebar').innerHTML = `<span>${!b ? 'Tap a river to choose where the bridge goes.' : !b.ok ? b.why + '.' : RIVER_NAMES[b.k] + ' River: ' + chips(b.cost)}</span>
    <button class="btn green ${can ? '' : 'dis'}" data-a="ok">Build</button><button class="btn" data-a="cancel">Cancel</button>`;
}
// k: the river to start on, or 0 for whichever is nearest
function startBridge(k) {
  closePanel();
  UI.place = { type: 'bridge' }; $('modebar').classList.remove('hidden');
  const P = S.player, px = Math.floor(P.x / TS), py = Math.floor(P.y / TS);
  let plan = null;
  for (const j of k ? [k] : Array.from({ length: S.reach }, (_, n) => S.reach - n)) { plan = findBridgeSpot(j, px, py); if (plan) break; }
  if (plan) { panTo((plan.x + plan.w / 2) * TS, (plan.y + plan.h / 2) * TS); if (R.k < 1) R.kT = R.defaultK(); setBridgeGhost(plan.tx, plan.ty); }
  else { const w = R.screenToWorld(R.W / 2, R.H / 2); setBridgeGhost(Math.floor(w.x / TS), Math.floor(w.y / TS)); }
  toast('Tap anywhere along a river to choose the spot, then press Build', null, 'bridge');
}
function setGhost(tx, ty) {
  const pl = UI.place, self = pl.moveId ? W.bById.get(pl.moveId) : null;
  R.ghost = { type: pl.type, tx, ty, ok: canPlace(pl.type, tx, ty, self) };
  $('modebar').innerHTML = `<span>${R.ghost.ok ? (self ? 'Move it here?' : 'Build it here?') : 'Needs clear, dry ground. Tap another spot.'}</span>
    <button class="btn green ${R.ghost.ok ? '' : 'dis'}" data-a="ok">${self ? 'Move' : 'Build'}</button><button class="btn" data-a="cancel">Cancel</button>`;
}
function startPlace(type, moveId) {
  closePanel();
  UI.place = { type, moveId: moveId || 0 }; $('modebar').classList.remove('hidden');
  const B = BUILD[type], self = moveId ? W.bById.get(moveId) : null;
  // start on the nearest free spot to the middle of the screen
  const w = R.screenToWorld(R.W / 2, R.H / 2), cx = Math.floor(w.x / TS) - (B.w >> 1), cy = Math.floor(w.y / TS) - 1;
  let best = null, bd = 1e9;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -10; dx <= 10; dx++) {
    if (self && cx + dx === self.x && cy + dy === self.y) continue;
    if (canPlace(type, cx + dx, cy + dy, self)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [cx + dx, cy + dy]; } }
  }
  setGhost(best ? best[0] : cx, best ? best[1] : cy);
  toast(`Tap the ground to choose a spot, then press ${self ? 'Move' : 'Build'}`, null, type === 'lodge' ? 'lodge' : type);
}
function endPlace() { UI.place = null; R.ghost = null; $('modebar').classList.add('hidden'); }
function confirmPlace() {
  const g = R.ghost, pl = UI.place; if (!pl) return;
  if (pl.type === 'bridge') {
    const b = g && g.bridge;
    if (!b || !b.ok) { AUDIO.sfx('error'); toast(b ? b.why : 'Tap a river first', 'bad'); return; }
    if (!buildBridge(b)) { AUDIO.sfx('error'); toast(canAfford(b.cost) ? "It can't go there" : "You can't afford it yet", 'bad'); return; }
    endPlace(); saveGame(); return;
  }
  if (!g) return;
  if (pl.moveId) {
    if (!moveBuilding(pl.moveId, g.tx, g.ty)) { AUDIO.sfx('error'); toast("It can't go there", 'bad'); setGhost(g.tx, g.ty); return; }
    const id = pl.moveId; endPlace(); openPanel('bld', id); saveGame(); return;
  }
  const b = placeBuilding(pl.type, g.tx, g.ty);
  if (!b) { AUDIO.sfx('error'); toast(canAfford(buildCost(pl.type)) ? "It can't go there" : "You can't afford it any more", 'bad'); setGhost(g.tx, g.ty); return; }
  endPlace(); openPanel('bld', b.id); saveGame();
}

// ---------------------------------------------------------------- touching the world
function pickTree(wx, wy) {
  const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS);
  for (let y = Math.min(MH - 1, ty + 6); y >= Math.max(0, ty - 1); y--) for (let x = Math.max(0, tx - 2); x <= Math.min(MW - 1, tx + 2); x++) {
    const i = idx(x, y), k = W.kind[i]; if (!k || W.g[i] < 0.12) continue;
    const s = tileSprite(i), p = treeXY(i);
    if (Math.abs(wx - p.x) <= Math.max(5, s.w * 0.42) && wy <= p.y + 3 && wy >= p.y - s.h + 2) return i;
  }
  return -1;
}
function riverToast(i) {
  const k = S.reach + 1, lock = bridgeLock(k);
  toast(`The ${RIVER_NAMES[k]} River is in the way. ${lock ? lock + ', then build a bridge' : 'Build a bridge: Build ➜ Bridge'}.`, 'bad', 'bridge');
}
function onWorldTap(sx, sy) {
  const w = R.screenToWorld(sx, sy);
  if (UI.place && UI.place.type === 'bridge') { setBridgeGhost(Math.floor(w.x / TS), Math.floor(w.y / TS)); AUDIO.sfx('click'); return; }
  if (UI.place) { const B = BUILD[UI.place.type]; setGhost(Math.floor(w.x / TS) - (B.w >> 1), Math.floor(w.y / TS) - (B.h >> 1)); AUDIO.sfx('click'); return; }
  for (const b of S.buildings) {
    const base = bBase(b), s = spriteOf(b);
    if (Math.abs(w.x - base.x) < BUILD[b.type].w * TS / 2 + 2 && w.y < base.y + 2 && w.y > base.y - s.h + 8) {
      if (b.type === 'yard') { cmdDrop(b); openPanel('yard'); } else { if (b.type === 'depot') cmdDrop(b); openPanel('bld', b.id); }
      return;
    }
  }
  if (R.q > 1) { R.follow = false; R.anchor = { sx, sy, wx: w.x, wy: w.y }; R.kT = R.defaultK(); return; }      // far out, a tap on the forest zooms in there
  for (let r = 0; r < NT; r++) {         // an Ancient tree, or its stump
    const A = W.anc[r], sp = ART.anc[r][1], dx = Math.abs(w.x - A.x), up = A.y - w.y;
    if (S.anc[r].done ? dx < 14 && up > -4 && up < 16 : dx < Math.max(12, sp.w * 0.3) && up > -4 && up < sp.h * 0.8) { openPanel('anc', r); return; }
  }
  let best = null, bd = 11;
  for (const p of S.piles) { const t = pileXY(p), d = Math.hypot(t.x - w.x, t.y - 4 - w.y); if (d < bd) { bd = d; best = p; } }
  if (best) { cmdPile(best); AUDIO.sfx('click'); R.marks.push({ x: pileXY(best).x, y: pileXY(best).y, t: 0 }); return; }
  for (const k of S.workers) if (Math.hypot(k.x - w.x, k.y - 9 - w.y) < 9) { openPanel('bld', k.home); return; }
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
      else if (r === 'river') riverToast(i);
    }
    return;
  }
  if (blockedPx(w.x, w.y)) { AUDIO.sfx('error'); return; }
  if (!cmdWalk(w.x, w.y)) { AUDIO.sfx('error'); riverToast(idx(Math.floor(w.x / TS), Math.floor(w.y / TS))); return; }
  R.marks.push({ x: w.x, y: w.y, t: 0 });
}

const PTR = new Map();
let pinch = null, dragMoved = false, downAt = 0, wheelAcc = 0;
function setupInput() {
  const cv = R.cv;
  cv.addEventListener('pointerdown', e => {
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
      R.kT = R.snapK(R.k); R.anchor = { sx: pinch.cx, sy: pinch.cy, wx: w.x, wy: w.y };
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
  // Sound may only start from a finished tap, click or key press (iOS does not count the press itself).
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => AUDIO.unlock(), { capture: true });
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
  $('hLocate').addEventListener('click', () => { AUDIO.sfx('click'); R.follow = true; R.anchor = null; if (R.k < 1) R.kT = R.defaultK(); });
  $('hGoal').addEventListener('click', () => { const g = curGoal(); if (g) toast(esc(g.d)); });
  $('hSeason').addEventListener('click', () => { AUDIO.sfx('click'); toast(`<b>${SEASONS[SEA].name}, year ${yearNow()}.</b> ${SEASONS[SEA].perk}. ${SEASONS[(SEA + 1) % 4].name} comes in ${fmtTime(SEASON_LEN - S.playTime % SEASON_LEN)}.`, null, SEASONS[SEA].id); });
}

// ---------------------------------------------------------------- events from the sim
function onGameEvent(e) {
  if (e.t === 'hat') { AUDIO.sfx('hat'); toast(`A hat fell out of the tree: <b>${esc(e.hat.name)}</b>! Try it on under Hats.`, 'good', 'hat_' + e.hat.id); saveGame(); return; }
  if (e.t === 'order') { AUDIO.sfx('order'); toast('A new order has come in', null, 'scroll'); return; }
  if (e.t === 'season') { AUDIO.sfx('order'); toast(`<b>${SEASONS[e.s].name}</b> is here. ${SEASONS[e.s].perk}.`, null, SEASONS[e.s].id); return; }
  if (e.t === 'skill') { if (e.w.lvl === SKILL.length - 1) toast(`${esc(e.w.name)} is now a <b>Master</b> ${ROLES[e.w.role].name.toLowerCase()}`, 'good', e.w.role); return; }
  if (e.t === 'bridge') {
    if (e.first) toast(`The ${RIVER_NAMES[e.k]} River is bridged. <b>${TREES[e.k].name}</b> grows on the far bank: move a cabin across to cut it.`, 'good', 'bridge');
    else toast('Another way across', 'good', 'bridge');
    return;
  }
  if (e.t === 'ancient') {
    AUDIO.sfx('goal'); if (e.hat) AUDIO.sfx('hat');
    const T = TREES[e.r], k = e.r + 1;
    if (UI.panel === 'anc') closePanel();
    modal(`<img class="bigimg anc" src="${ART.url['anc' + e.r]}"><h2>The Ancient ${T.name} is down!</h2>
      <p class="p">It leaves a heap of <b>${ANCIENT_LOGS[e.r]} ${T.name} logs</b> for the haulers${e.hat ? `, and out of its branches falls a hat: the <b>${esc(e.hat.name)}</b>` : ''}.${k < NT ? `<br><br>The <b>${RIVER_NAMES[k]} River</b> can now be bridged, to reach the ${TREES[k].name}. Look under <b>Build</b>.` : '<br><br>Every Ancient tree in the forest has fallen to your axes.'}</p>
      <div class="btns"><button class="btn green" data-a="ok">Onward</button></div>`, () => closeModal());
    saveGame(); return;
  }
  if (e.t === 'lodgeStep') { AUDIO.sfx('hire'); toast(`The Lodge's ${esc(e.name.toLowerCase())} are done. Next: <b>${esc(e.next)}</b>`, 'good', 'lodge'); saveGame(); return; }
  if (e.t === 'rank') {
    AUDIO.sfx('goal');
    toast(`The neighbours now call you <b>${RANKS[e.rank].name}</b>. ${RANKS[e.rank].text}${e.hat ? ': the ' + esc(e.hat.name) : ''}.`, 'good', e.hat ? 'hat_' + e.hat.id : 'scroll');
    saveGame(); return;
  }
  if (e.t === 'lodge') {
    AUDIO.sfx('goal');
    const st = LODGE[e.stage - 1], done = e.stage >= LODGE.length;
    modal(`<img class="bigimg" src="${ART.url['lodge' + e.stage]}"><h2>${done ? 'The Great Lodge is finished!' : st.name + ' complete'}</h2>
      <p class="p">${done ? `From a rusty hatchet and a single pine to a hall of every wood in the forest.<br><br>Played for <b>${fmtTime(S.playTime)}</b>, felled <b>${fmt(S.stats.chopped)}</b> trees and earned <b>${fmt(S.stats.earned)}</b> coins.` : `Storey ${e.stage} of ${LODGE.length} stands.<br><br>Reward: <b>${st.perk}</b>.`}</p>
      <div class="btns"><button class="btn green" data-a="ok">${done ? 'Keep logging' : 'Onward'}</button></div>`, () => closeModal());
    saveGame(); return;
  }
  if (e.t !== 'goal') return;
  AUDIO.sfx('goal');
  toast(`Goal done: ${esc(e.g.t)}${e.g.r ? ' · +' + fmt(e.g.r) + ' coins' : ''}`, 'good', 'coin');
  saveGame();
}

// ---------------------------------------------------------------- menus
function handleBack() {
  if (modalOpen()) { const b = UI.modalBack; if (b) b(); else closeModal(); return true; }
  if (UI.place) { endPlace(); return true; }
  if (UI.panel) { closePanel(); return true; }
  if (UI.inGame) { openPause(); return true; }
  return false;
}
window.onBackPressed = handleBack;

function slotInfo(s) {
  const d = readSlot(s); if (!d) return null;
  const crew = (d.workers || []).length, lodgeSt = d.lodgeStage || 0;
  return { text: `${fmt(d.coins)} coins · ${crew} crew · ${AXES[d.axe || 1].name}${lodgeSt ? ' · Lodge ' + lodgeSt + '/' + LODGE.length : ''}`, sub: `Played ${fmtTime(d.playTime)} · saved ${new Date(d.savedAt || d.created).toLocaleString()}`, axe: d.axe || 1 };
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
  $('logoMeeples').innerHTML = `<img class="t" src="${ART.url.tree0}"><img src="${meepleURL('jack', 0, 'viking')}"><img src="${meepleURL('player', 0)}"><img src="${meepleURL('hauler', 0)}"><img src="${meepleURL('sawyer', 0, 'party')}"><img class="t" src="${ART.url.tree3}">`;
  $('ver').textContent = 'v' + VERSION;
  // in Safari on an iPhone or iPad, say how to put the game on the home screen
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let tip = $('installTip');
  if (ios && !navigator.standalone && location.protocol === 'https:') {
    if (!tip) { tip = document.createElement('div'); tip.id = 'installTip'; tip.className = 'install'; $('title').appendChild(tip); }
    tip.textContent = 'To install: tap Share, then “Add to Home Screen”. It then opens full screen and works offline.';
  } else if (tip) tip.remove();
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
    <div class="setrow"><span>Sound check</span><div class="toggle"><button data-a="testsound">Play test sound</button></div></div>
    <p class="s" id="sndState">${esc(AUDIO.status())}</p>
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
    else if (a === 'testsound') {
      AUDIO.unlock();
      // the device takes a moment to let the sound through after the tap
      setTimeout(() => { AUDIO.test(); const el = $('sndState'); if (el) el.textContent = AUDIO.status(); }, 250);
    }
  }, back);
  m.oninput = e => { const k = e.target.dataset.k; if (k) { SET[k] = +e.target.value; applySettings(); } };
  m.onchange = e => { if (e.target.dataset.k) { saveSettings(); AUDIO.sfx('pick'); } };
}
function openHelp(fromPause) {
  const back = () => { if (fromPause) openPause(); else closeModal(); };
  modal(`<h2>How to Play</h2><div style="text-align:left" class="p">
    <p>${ico('player', 'sm')} <b>Tap a tree</b> and your Meeple walks over and chops it down. Tap more trees to line them up (tap again to cancel one).</p>
    <p>${ico('log0', 'sm')} Felled trees leave a <b>log pile</b>. Your Meeple carries its own piles to the <b>Lumber Yard</b>; tap any other pile to fetch it.</p>
    <p>${ico('coin', 'sm')} Tap the yard to <b>sell</b>. Set <b>Keep</b> on anything you want held back for building, orders and the Lodge.</p>
    <p>${ico('cabin', 'sm')} <b>Lumberjacks</b> cut the nearest trees to their cabin, however far that is. <b>Haulers</b> carry the piles in. Tap a cabin to hire, to pick <b>one kind of wood</b> for it, or to <b>move</b> it for free.</p>
    <p>${ico('axe2', 'sm')} The forest grows in rings. Pine by the yard is soft and cheap. Birch, Oak, Maple, Cherry, Redwood and Ebony each lie farther out, take a better <b>axe</b>, and sell for more.</p>
    <p>${ico('bridge', 'sm')} A <b>river</b> runs round every ring. To cross one, first fell the ring's ${ico('star', 'sm')} <b>Ancient tree</b> (find it on the Map, tap it and call your lumberjacks), then build a <b>bridge</b> wherever you like along the river. Move a cabin across so its crew is close to the new wood.</p>
    <p>${ico('autumn', 'sm')} The <b>seasons</b> turn every few minutes: trees grow back fastest in spring and slowest in winter, the workshops are quickest in summer, orders pay best in autumn, and haulers sled over winter snow. Tap the season at the top of the screen to see what it does.</p>
    <p>${ico('hauler', 'sm')} Every Meeple has a <b>quirk</b> and gets better with time on the job. If a quirk is wasted where they are, tap <b>Job</b> in their building to move them somewhere it helps.</p>
    <p>${ico('forester', 'sm')} <b>Foresters</b> replant stumps. ${ico('sawyer', 'sm')} <b>Sawyers</b> saw logs into planks. ${ico('collier', 'sm')} <b>Colliers</b> burn cheap logs into charcoal. ${ico('carpenter', 'sm')} <b>Carpenters</b> build furniture. ${ico('carter', 'sm')} <b>Carters</b> wheel loads home from a Log Depot. Each needs its own building.</p>
    <p>${ico('scroll', 'sm')} <b>Orders</b> in the yard pay well over the usual price, and every one filled raises your standing with the neighbours.</p>
    <p>${ico('lodge', 'sm')} <b>The Great Lodge</b> is the long project: seven storeys, one for each wood. ${ico('builder', 'sm')} <b>Builders</b> carry every piece from the yard, and each storey brings a lasting reward.</p>
    <p>${ico('hats', 'sm')} Trees sometimes drop <b>hats</b>. Wear them, dress the crew, and pick your walk under Hats.</p>
    <p>${ico('map', 'sm')} Drag to look around and pinch to zoom, all the way out to the whole forest. Press ${ico('target', 'sm')} to follow your Meeple again.</p>
    </div><div class="btns"><button class="btn green" data-a="ok">Got it</button></div>`, back, back);
}
function openMap() {
  UI.paused = true;
  const done = () => { closeModal(); UI.paused = false; };
  const box = modal(`<h2>The Forest</h2><canvas id="mapcv" width="${MW}" height="${MH}"></canvas>
    <div class="row wrap" style="justify-content:center;margin-top:.5rem">${TREES.map((t, i) => `<span class="chip"><i style="width:.8rem;height:.8rem;background:${shade(t.col, -0.12)};border:2px solid var(--ink)"></i>${t.name}</span>`).join('')}</div>
    <div class="row wrap" style="justify-content:center"><span class="chip"><i style="width:.8rem;height:.8rem;background:#ffe060;border:2px solid var(--ink)"></i>Ancient tree</span><span class="chip"><i style="width:.8rem;height:.8rem;background:#ffd8a0;border:2px solid var(--ink)"></i>Bridge</span></div>
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
    if (R.k < 1) R.kT = R.defaultK();
    done();
  });
}
;(window.__stage = window.__stage || []).push('ui.js loaded');
