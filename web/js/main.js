// MeepleJacks — boot, main loop, game lifecycle.
'use strict';

const DEV = /[?&]dev=(\d+)/.exec(location.search);
const DEV_SPEED = DEV ? +DEV[1] : 1;
let lastFrame = 0, acc = 0, autosaveT = 0, running = true, fpsT = 0, fpsN = 0, titleT = 0;

function startGame(slot, fresh) {
  closeModal(); closePanel(); if (UI.place) endPlace();
  if (fresh || !loadGame(slot)) newGame(slot);
  SET.lastSlot = slot; saveSettings();
  UI.inGame = true; UI.paused = false;
  R.reset(); EV.length = 0;
  R.follow = true; R.cam.x = S.player.x; R.cam.y = S.player.y - 10; R.k = R.kT = R.defaultK(); R.anchor = null;
  $('title').classList.add('hidden'); $('ver').classList.add('hidden'); $('hud').classList.remove('hidden');
  buildHud();
  saveGame();
  if (fresh) modal(`<img class="ico xxl" src="${ART.url.player}"><h2>Welcome to the woods</h2>
    <p class="p">You have a rusty hatchet, a Lumber Yard and a forest that goes on for miles.<br><br><b>Tap a pine tree</b> to chop it down. Your Meeple carries the logs back to the yard, where you can sell them.</p>
    <div class="btns"><button class="btn green" data-a="ok">Let's chop</button></div>`, () => closeModal());
}
function toTitle() {
  UI.inGame = false; closePanel(); if (UI.place) endPlace();
  $('hud').classList.add('hidden'); $('title').classList.remove('hidden'); $('ver').classList.remove('hidden');
  demoWorld();
  buildTitleMenu();
}
// a busy little camp behind the title screen
function demoWorld() {
  newGame(-1);
  R.reset(); EV.length = 0;
  S.coins = 1e7; S.crewAxe = 2; S.inv[0] = 40; S.inv[1] = 12;
  for (const [type, x, y, crew] of [['cabin', CX - 9, CY + 2, ['jack', 'jack', 'hauler']], ['cabin', CX + 6, CY - 6, ['jack', 'hauler', 'hauler']], ['sawmill', CX + 5, CY + 3, ['sawyer']], ['forester', CX - 8, CY - 5, ['forester']]]) {
    const b = { id: S.nextId++, type, x, y, wood: -1 };
    S.buildings.push(b); rebuildBlocks();
    for (const role of crew) hire(b.id, role);
  }
  R.follow = false; R.cam.x = YARD_X; R.cam.y = YARD_Y + 6; R.k = R.kT = R.defaultK(); R.anchor = null;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!running) { lastFrame = now; return; }
  const cap = SET.fps ? 1000 / SET.fps : 0;
  if (cap && now - lastFrame < cap - 2) return;
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!S) return;
  if (!(UI.inGame && UI.paused)) {
    acc += dt * (UI.inGame ? DEV_SPEED : 1);
    let steps = 0;
    while (acc > 0 && steps < 400) { const s = Math.min(0.05, acc); update(s); acc -= s; steps++; }
    acc = Math.max(0, acc);
  }
  while (EV.length) { const e = EV.shift(); R.onEvent(e); if (UI.inGame) onGameEvent(e); }
  if (!UI.inGame) { titleT += dt; R.cam.x = YARD_X + Math.sin(titleT * 0.07) * TS * 7; R.cam.y = YARD_Y + 6 + Math.cos(titleT * 0.05) * TS * 3; }
  R.draw(UI.inGame && UI.paused ? 0 : dt);
  if (UI.inGame) {
    updateHud();
    autosaveT += dt;
    if (autosaveT > SET.autosave) { autosaveT = 0; saveGame(); }
  }
  AUDIO.tick();
  fpsT += dt; fpsN++;
  if (fpsT > 0.5) { if (SET.showFps) $('fps').textContent = Math.round(fpsN / fpsT) + ' fps · ' + R.bw + '×' + R.bh; fpsT = 0; fpsN = 0; }
}
setInterval(() => { if (UI.inGame && UI.panel) renderPanel(false); }, 250);

// lifecycle: pause everything when the app is hidden (no offline progress)
function appPause() { if (UI.inGame) saveGame(); running = false; AUDIO.suspend(); }
function appResume() { running = true; lastFrame = performance.now(); acc = 0; AUDIO.resume(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) appPause(); else appResume(); });
window.addEventListener('pagehide', appPause);
window.onAppPause = appPause;
window.onAppResume = appResume;
window.addEventListener('resize', () => { if (R.ready) R.resize(); });

const stage = s => window.__stage.push(s);
async function boot() {
  const bar = p => { const el = $('loading'); if (el && el.firstChild) el.firstChild.textContent = 'Sharpening axes… ' + Math.round(p * 100) + '%'; };
  stage('boot start');
  loadSettings(); stage('settings');
  await buildArtAsync(p => bar(p * 0.95)); stage('art built');
  R.init($('game')); stage('renderer ' + R.W + 'x' + R.H);
  setupInput(); stage('input');
  applySettings(); stage('settings applied');
  toTitle(); stage('title');
  $('loading').remove();
  window.__booted = true;
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}
// Start as soon as the scripts are in (they sit at the end of <body>), not on window 'load',
// which some Android WebViews never deliver for local files.
let _bootStarted = false;
function startBoot(why) {
  if (_bootStarted) return; _bootStarted = true; stage('start via ' + why);
  boot().catch(e => window.__bootError && window.__bootError(e));
}
if (document.readyState !== 'loading') setTimeout(() => startBoot('ready'), 0);
document.addEventListener('DOMContentLoaded', () => startBoot('domcontentloaded'));
window.addEventListener('load', () => startBoot('load'));
setTimeout(() => startBoot('fallback'), 300);
;(window.__stage = window.__stage || []).push('main.js loaded');
