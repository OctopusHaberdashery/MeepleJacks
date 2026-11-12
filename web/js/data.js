// MeepleJacks — game data: map size, trees, tools, buildings, goals. Tune the game here.
'use strict';

const VERSION = '1.0';
const TS = 16;                 // art pixels per tile
const MW = 192, MH = 192;      // map size in tiles
const CX = 96, CY = 96;        // the Lumber Yard sits here
const NTILES = MW * MH;

// Trees, from the middle of the map outward. Each ring is tougher to cut and worth more.
//   hp: axe damage needed · logs: logs dropped · price: coins per log · regrow: seconds to grow back
const TREES = [
  { id: 'pine',    name: 'Pine',    hp: 4,  logs: 3, price: 2,   regrow: 120, col: '#2f7a45', bark: '#6a4428', wood: '#e2b87a' },
  { id: 'birch',   name: 'Birch',   hp: 9,  logs: 3, price: 5,   regrow: 150, col: '#86b83e', bark: '#deded2', wood: '#f2deb0' },
  { id: 'oak',     name: 'Oak',     hp: 16, logs: 4, price: 12,  regrow: 190, col: '#458a32', bark: '#5a3c22', wood: '#c89858' },
  { id: 'maple',   name: 'Maple',   hp: 26, logs: 4, price: 28,  regrow: 240, col: '#d8601c', bark: '#6a4a3a', wood: '#e8b078' },
  { id: 'cherry',  name: 'Cherry',  hp: 38, logs: 5, price: 65,  regrow: 300, col: '#e486a8', bark: '#4a2a2a', wood: '#c8644a' },
  { id: 'redwood', name: 'Redwood', hp: 54, logs: 6, price: 150, regrow: 380, col: '#2a663a', bark: '#8a3a22', wood: '#b8482c' },
  { id: 'ebony',   name: 'Ebony',   hp: 74, logs: 6, price: 340, regrow: 480, col: '#2f4a7e', bark: '#2a2230', wood: '#4a3c52' },
];
const NT = TREES.length;
// how thickly each kind grows (the broad-crowned trees need more elbow room)
const DENSITY = [1, 1, 0.82, 0.8, 0.74, 0.74, 0.6];
// distance from the yard (in tiles) where each tree ring begins
const RINGS = [4.5, 21, 35, 49, 62, 74, 85];

// Axes. An axe of level L cuts the first L kinds of tree and deals L damage per swing.
const AXES = [
  null,
  { name: 'Rusty Hatchet' },
  { name: 'Iron Axe',       coins: 40,    wood: [0, 10] },
  { name: 'Steel Axe',      coins: 160,   wood: [1, 12] },
  { name: 'Felling Axe',    coins: 600,   wood: [2, 14] },
  { name: 'Double-Bit Axe', coins: 2200,  wood: [3, 16] },
  { name: 'Crosscut Saw',   coins: 8000,  wood: [4, 18] },
  { name: "Master's Axe",   coins: 28000, wood: [5, 20] },
  { name: 'Legendary Axe',  coins: 90000, wood: [6, 24] },
];
const MAX_AXE = AXES.length - 1;

// Other upgrades: cost of level n+1 is base * mult^n coins.
const UPG = {
  boots:     { name: 'Trail Boots',  desc: 'You walk 12% faster',              base: 30, mult: 3, max: 6 },
  pack:      { name: 'Log Sling',    desc: 'You carry 1 more log',             base: 50, mult: 3, max: 5 },
  crewBoots: { name: 'Crew Boots',   desc: 'Your crew walks 12% faster',       base: 60, mult: 3, max: 6 },
  crewPack:  { name: 'Hauling Sleds', desc: 'Haulers carry 2 more logs',       base: 80, mult: 3, max: 6 },
};
const upgCost = (k, lvl) => Math.round(UPG[k].base * Math.pow(UPG[k].mult, lvl));
const CREW_AXE_MULT = 1.5;     // crew axes cost this much more than yours

const PLAYER_CARRY = 3, HAULER_CARRY = 6;
const PLAYER_SPEED = 46, CREW_SPEED = 38;        // art pixels per second
const PLAYER_SWING = 0.5, CREW_SWING = 0.85;     // seconds per axe swing

const BUILD = {
  yard:  { name: 'Lumber Yard',      w: 5, h: 3 },
  cabin: { name: 'Lumberjack Cabin', w: 3, h: 2, beds: 4, radius: 9 },
};
function cabinCost(n) {
  const coins = Math.round(30 * Math.pow(4.2, n) / 10) * 10;
  const t = Math.min(n, NT - 1);
  const wood = n === 0 ? [[0, 10]] : [[t - 1, 15], [t, 10]];
  return { coins, wood };
}
const hireCost = (role, have) => Math.round((role === 'jack' ? 25 : 20) * Math.pow(1.55, have));

const NAMES = ['Birch', 'Timber', 'Knotty', 'Splinter', 'Sawyer', 'Chip', 'Woody', 'Barkley', 'Cedric', 'Hazel', 'Rowan', 'Aspen',
  'Twig', 'Bramble', 'Forrest', 'Juniper', 'Linden', 'Alder', 'Ash', 'Willow', 'Stumpy', 'Plank', 'Maple', 'Burl', 'Acorn', 'Fern',
  'Moss', 'Hickory', 'Elm', 'Sorrel', 'Thorn', 'Root', 'Bud', 'Sprig', 'Kindle', 'Tinder', 'Cork', 'Larch', 'Yew', 'Sapling'];

// Goals guide the early game. key reads a counter (see goalValue in world.js).
const GOALS = [
  { t: 'Chop down a Pine tree',        d: 'Tap a tree beside the Lumber Yard.',                     key: 'chopped',   n: 1,  r: 0 },
  { t: 'Carry 3 logs to the yard',     d: 'Your Meeple hauls what it cuts. Tap a log pile to fetch it.', key: 'delivered', n: 3,  r: 5 },
  { t: 'Sell some wood',               d: 'Tap the Lumber Yard and sell your logs.',                key: 'sales',     n: 6,  r: 5 },
  { t: 'Build a Lumberjack Cabin',     d: 'Build ➜ Cabin. Keep 10 Pine logs unsold for it.',        key: 'cabins',    n: 1,  r: 10 },
  { t: 'Hire a lumberjack',            d: 'Tap your cabin and hire a lumberjack.',                  key: 'jacks',     n: 1,  r: 10 },
  { t: 'Hire a hauler',                d: 'Haulers carry log piles back to the yard.',              key: 'haulers',   n: 1,  r: 15 },
  { t: 'Forge an Iron Axe',            d: 'Yard ➜ Workshop. Birch grows farther out.',              key: 'axe',       n: 2,  r: 20 },
  { t: 'Sell 10 Birch logs',           d: 'Birch is tougher than Pine but pays better.',            key: 'sold1',     n: 10, r: 40 },
  { t: 'Have a crew of 4',             d: 'Lumberjacks cut near their cabin; haulers fetch.',       key: 'workers',   n: 4,  r: 60 },
  { t: 'Forge a Steel Axe',            d: 'Each new axe opens the next ring of the forest.',        key: 'axe',       n: 3,  r: 100 },
  { t: 'Sell 20 Oak logs',             d: 'Give the crew better axes so they can cut Oak too.',     key: 'sold2',     n: 20, r: 200 },
  { t: 'Build a second cabin',         d: 'Put it out among the better trees.',                     key: 'cabins',    n: 2,  r: 250 },
  { t: 'Sell 30 Maple logs',           d: 'The Maple ring glows orange.',                           key: 'sold3',     n: 30, r: 600 },
  { t: 'Sell 40 Cherry logs',          d: 'Look for pink blossoms.',                                key: 'sold4',     n: 40, r: 2000 },
  { t: 'Sell 50 Redwood logs',         d: 'Giants of the deep forest.',                             key: 'sold5',     n: 50, r: 6000 },
  { t: 'Sell 60 Ebony logs',           d: 'The rarest wood, at the edge of the map.',               key: 'sold6',     n: 60, r: 20000, win: true },
];

// ---------------------------------------------------------------- shared maths
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fractal noise, normalised to 0..1
function fbm(x, y, s, oct) {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, y * f, s + i * 17) * amp; tot += amp; f *= 2; amp *= 0.5; }
  return v / tot;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
;(window.__stage = window.__stage || []).push('data.js loaded');
