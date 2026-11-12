// MeepleJacks — synthesized audio: a generative campfire tune, forest ambience and sound effects.
'use strict';

const AUDIO = {
  ctx: null, master: null, music: null, sfxBus: null, amb: null, verb: null,
  vol: { master: 0.8, music: 0.5, sfx: 0.7, amb: 0.5 },
  started: false, nextBeat: 0, step: 0, lastSfx: {},
};

AUDIO.unlock = function () {
  if (AUDIO.ctx) { if (AUDIO.ctx.state === 'suspended' && !AUDIO.paused) AUDIO.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const c = AUDIO.ctx = new AC();
  AUDIO.master = c.createGain(); AUDIO.master.connect(c.destination);
  AUDIO.music = c.createGain(); AUDIO.music.connect(AUDIO.master);
  AUDIO.sfxBus = c.createGain(); AUDIO.sfxBus.connect(AUDIO.master);
  AUDIO.amb = c.createGain(); AUDIO.amb.connect(AUDIO.master);
  // a small wooden room for the music
  const conv = c.createConvolver(), len = Math.floor(c.sampleRate * 1.6), buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  conv.buffer = buf;
  AUDIO.verb = c.createGain(); AUDIO.verb.gain.value = 0.28; AUDIO.verb.connect(conv); conv.connect(AUDIO.music);
  AUDIO.applyVolume();
  AUDIO.nextBeat = c.currentTime + 0.3;
  AUDIO.started = true;
};
AUDIO.applyVolume = function () {
  if (!AUDIO.ctx) return;
  const v = AUDIO.vol;
  AUDIO.master.gain.value = v.master;
  AUDIO.music.gain.value = v.music * 0.6;
  AUDIO.sfxBus.gain.value = v.sfx;
  AUDIO.amb.gain.value = v.amb * 0.6;
};
AUDIO.suspend = function () { AUDIO.paused = true; if (AUDIO.ctx && AUDIO.ctx.state === 'running') AUDIO.ctx.suspend(); };
AUDIO.resume = function () { AUDIO.paused = false; if (AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume(); };

function tone(dest, type, f0, f1, t, dur, peak, attack = 0.005, filter) {
  const c = AUDIO.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o;
  if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); n = f; }
  n.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  return g;
}
function noise(dest, t, dur, peak, freq, q = 1, type = 'bandpass') {
  const c = AUDIO.ctx, len = Math.ceil(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(Math.max(0.0002, peak), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + dur);
}

// vol: 0..1 (far-away work is quieter) · k: tree tier for chops (bigger trees thud lower)
AUDIO.sfx = function (name, vol = 1, k = 0) {
  if (!AUDIO.started || AUDIO.ctx.state !== 'running' || vol <= 0.02) return;
  const c = AUDIO.ctx, t = c.currentTime, d = AUDIO.sfxBus;
  const lim = { chop: 0.06, fall: 0.2, pick: 0.08, drop: 0.12, coin: 0.12 }[name] || 0.03;
  if (AUDIO.lastSfx[name] && t - AUDIO.lastSfx[name] < lim) return;
  AUDIO.lastSfx[name] = t;
  const V = vol;
  switch (name) {
    case 'click': tone(d, 'sine', 880, 660, t, 0.06, 0.15); break;
    case 'open': tone(d, 'triangle', 520, 780, t, 0.12, 0.12); break;
    case 'close': tone(d, 'triangle', 700, 440, t, 0.1, 0.1); break;
    case 'error': tone(d, 'square', 220, 170, t, 0.16, 0.06, 0.005, 1000); break;
    case 'chop': {
      const p = 1 - k * 0.07 + (Math.random() - 0.5) * 0.12;
      noise(d, t, 0.06, 0.45 * V, 2200 * p, 1.6);
      tone(d, 'triangle', 240 * p, 85 * p, t, 0.11, 0.34 * V);
      noise(d, t + 0.02, 0.12, 0.12 * V, 700 * p, 0.8);
      break;
    }
    case 'fall': {
      const p = 1 - k * 0.06;
      tone(d, 'sawtooth', 330 * p, 95 * p, t, 0.5, 0.05 * V, 0.03, 900);
      tone(d, 'sawtooth', 210 * p, 70 * p, t + 0.12, 0.4, 0.04 * V, 0.03, 700);
      noise(d, t + 0.5, 0.55, 0.3 * V, 420, 0.6, 'lowpass');
      tone(d, 'sine', 95 * p, 42, t + 0.5, 0.35, 0.4 * V);
      noise(d, t + 0.55, 0.3, 0.1 * V, 3200, 0.8);
      break;
    }
    case 'pick': tone(d, 'triangle', 380, 620, t, 0.07, 0.13 * V); noise(d, t, 0.03, 0.08 * V, 1500, 2); break;
    case 'drop': [0, 0.07, 0.15].forEach((o, i) => { tone(d, 'triangle', [640, 520, 760][i], [420, 360, 500][i], t + o, 0.06, 0.16 * V); noise(d, t + o, 0.03, 0.1 * V, 2400, 2); }); break;
    case 'coin': tone(d, 'square', 988, 988, t, 0.08, 0.05 * V, 0.003, 3000); tone(d, 'square', 1319, 1319, t + 0.07, 0.22, 0.05 * V, 0.003, 3000); break;
    case 'build': [0, 0.13, 0.26, 0.42].forEach((o, i) => { noise(d, t + o, 0.06, 0.28, 1900 - i * 200, 3); tone(d, 'triangle', 320 - i * 20, 190, t + o, 0.08, 0.18); }); break;
    case 'hire': [392, 494, 587, 784].forEach((f, i) => tone(d, 'triangle', f, f * 1.01, t + i * 0.08, 0.3, 0.12)); break;
    case 'upgrade': [1245, 1865, 2489].forEach((f, i) => tone(d, 'sine', f, f * 0.995, t, 0.9 - i * 0.2, 0.09 - i * 0.02)); noise(d, t, 0.04, 0.3, 3000, 2); tone(d, 'triangle', 196, 392, t + 0.1, 0.3, 0.1); break;
    case 'goal': [392, 494, 587, 784, 988].forEach((f, i) => { tone(d, 'triangle', f, f, t + i * 0.11, 0.5, 0.14); tone(d, 'sine', f / 2, f / 2, t + i * 0.11, 0.6, 0.08); }); break;
    case 'queue': tone(d, 'sine', 660, 880, t, 0.07, 0.1); break;
  }
};

// ------------------------------------------------- generative music
// G major, ~100 bpm in eighths: boom-chick bass, plucked strings and a wandering whistle.
const CHORDS = [[43, 47, 50], [48, 52, 55], [43, 47, 50], [50, 54, 57], [40, 43, 47], [48, 52, 55], [43, 47, 50], [50, 54, 57]];
const SCALE = [62, 64, 67, 69, 71, 74, 76, 79, 81, 83];     // G major pentatonic
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
let melIdx = 4, melRest = 0, pluckPat = [0, 2, 1, 2, 0, 2, 1, 2];
AUDIO.tick = function () {
  if (!AUDIO.started || AUDIO.ctx.state !== 'running') return;
  const c = AUDIO.ctx, beat = 60 / 100 / 2;
  if (AUDIO.nextBeat < c.currentTime - 1) AUDIO.nextBeat = c.currentTime + 0.1;
  while (AUDIO.nextBeat < c.currentTime + 0.25) {
    const t = AUDIO.nextBeat, s = AUDIO.step, bar = Math.floor(s / 8), ch = CHORDS[bar % 8], b = s % 8;
    if (AUDIO.vol.music > 0.001) {
      const section = Math.floor(bar / 8) % 4;      // 0 sparse intro, 1-2 full, 3 breakdown
      // bass: root, then the fifth
      if (b === 0) tone(AUDIO.music, 'triangle', mtof(ch[0] - 12), 0, t, beat * 3.2, 0.13, 0.01, 500);
      if (b === 4) tone(AUDIO.music, 'triangle', mtof(ch[2] - (ch[2] > 52 ? 24 : 12)), 0, t, beat * 2.6, 0.1, 0.01, 500);
      // off-beat strum
      if ((b === 2 || b === 6) && section !== 0) ch.forEach((n, i) => tone(AUDIO.music, 'triangle', mtof(n + 12), 0, t + i * 0.012, 0.16, 0.035, 0.004, 1800));
      // plucked roll
      if (section === 1 || section === 2 || (section === 3 && b % 2 === 0)) {
        if (b === 0 && Math.random() < 0.3) pluckPat = [[0, 2, 1, 2, 0, 2, 1, 2], [0, 1, 2, 1, 0, 1, 2, 1], [2, 1, 0, 1, 2, 1, 0, 2]][(Math.random() * 3) | 0];
        const n = ch[pluckPat[b]] + 24;
        tone(AUDIO.music, 'square', mtof(n), 0, t, 0.22, 0.022, 0.003, 2600).connect(AUDIO.verb);
      }
      // melody: a whistled walk with rests, landing on chord tones at the bar line
      if (section !== 3 && b % 2 === 0) {
        if (melRest > 0) melRest--;
        else if (Math.random() < (section === 0 ? 0.45 : 0.62) || b === 0) {
          melIdx = clamp(melIdx + [-2, -1, -1, 0, 1, 1, 2][(Math.random() * 7) | 0], 0, SCALE.length - 1);
          let n = SCALE[melIdx];
          if (b === 0) { const ct = ch.map(x => x + 24).concat(ch.map(x => x + 36)); n = ct.reduce((a, x) => Math.abs(x - n) < Math.abs(a - n) ? x : a); }
          const long = Math.random() < 0.3, dur = beat * (long ? 4 : 2);
          const g = tone(AUDIO.music, 'sine', mtof(n), mtof(n) * 1.003, t, dur, 0.075, 0.03);
          tone(AUDIO.music, 'triangle', mtof(n), 0, t, dur * 0.8, 0.03, 0.02, 2400);
          g.connect(AUDIO.verb);
          if (long) melRest = 1;
          if (Math.random() < 0.12) melRest = 3;
        }
      }
    }
    // ambience: birds, a woodpecker, wind in the leaves
    if (AUDIO.vol.amb > 0.001) {
      if (Math.random() < 0.05) { const f = 2300 + Math.random() * 1800; for (let k = 0; k < 2 + (Math.random() * 3 | 0); k++) tone(AUDIO.amb, 'sine', f, f * (1.25 + Math.random() * 0.4), t + k * 0.1, 0.07, 0.03); }
      if (Math.random() < 0.012) { const f = 1700 + Math.random() * 500; tone(AUDIO.amb, 'sine', f, f * 0.8, t, 0.25, 0.03); tone(AUDIO.amb, 'sine', f * 0.8, f * 0.75, t + 0.3, 0.3, 0.025); }
      if (Math.random() < 0.006) for (let k = 0; k < 7; k++) noise(AUDIO.amb, t + k * 0.055, 0.03, 0.05, 1300, 5);
      if (Math.random() < 0.02) noise(AUDIO.amb, t, 2.8, 0.03, 600, 0.5, 'lowpass');
    }
    AUDIO.nextBeat += beat; AUDIO.step++;
  }
};
;(window.__stage = window.__stage || []).push('audio.js loaded');
