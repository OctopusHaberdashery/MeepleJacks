// MeepleJacks — game data: map size, trees, goods, tools, buildings, crew, goals. Tune the game here.
'use strict';

const VERSION = '1.2';
const TS = 16;                 // art pixels per tile
const MW = 192, MH = 192;      // map size in tiles
const CX = 96, CY = 96;        // the Lumber Yard sits here
const NTILES = MW * MH;

// Trees, from the middle of the map outward. Each ring is tougher to cut and worth more.
//   hp: axe damage needed · logs: logs dropped (1.5 means 2 and 1 by turns) · price: coins per log · regrow: seconds to grow back
const TREES = [
  { id: 'pine',    name: 'Pine',    hp: 4,  logs: 1.5, price: 2,   regrow: 120, col: '#2f7a45', bark: '#6a4428', wood: '#e2b87a' },
  { id: 'birch',   name: 'Birch',   hp: 9,  logs: 1.5, price: 5,   regrow: 150, col: '#86b83e', bark: '#deded2', wood: '#f2deb0' },
  { id: 'oak',     name: 'Oak',     hp: 16, logs: 2,   price: 12,  regrow: 190, col: '#458a32', bark: '#5a3c22', wood: '#c89858' },
  { id: 'maple',   name: 'Maple',   hp: 26, logs: 2,   price: 28,  regrow: 240, col: '#d8601c', bark: '#6a4a3a', wood: '#e8b078' },
  { id: 'cherry',  name: 'Cherry',  hp: 38, logs: 2.5, price: 65,  regrow: 300, col: '#e486a8', bark: '#4a2a2a', wood: '#c8644a' },
  { id: 'redwood', name: 'Redwood', hp: 54, logs: 3,   price: 150, regrow: 380, col: '#2a663a', bark: '#8a3a22', wood: '#b8482c' },
  { id: 'ebony',   name: 'Ebony',   hp: 74, logs: 3,   price: 340, regrow: 480, col: '#2f4a7e', bark: '#2a2230', wood: '#4a3c52' },
];
const NT = TREES.length;
// how thickly each kind grows (the broad-crowned trees need more elbow room)
const DENSITY = [1, 1, 0.82, 0.8, 0.74, 0.74, 0.6];
// distance from the yard (in tiles) where each tree ring begins
const RINGS = [4.5, 21, 35, 49, 62, 74, 85];

// A river runs all the way round the camp where each ring gives way to the next, so the forest is a
// set of islands inside islands. Each river needs a bridge, and the first bridge over a river can
// only be built once the Ancient tree of the ring inside it has come down.
const RIVER_HALF = 1.25;       // half the width of a river, in tiles
const BRIDGE_MAX = 12;         // the longest a bridge can be, in tiles
const BRIDGE_COINS = [0, 60, 300, 1200, 5000, 20000, 70000];
const RIVER_NAMES = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
// One Ancient tree stands in each ring. It takes hp axe damage to fell (bring the crew) and drops a great heap of logs and a hat.
const ANCIENT_HP = [320, 900, 2000, 4000, 7200, 12000, 20000];
const ANCIENT_LOGS = [40, 50, 60, 70, 80, 90, 100];
const ANCIENT_CREW = 12;       // how many lumberjacks can swing at one at once

// ---------------------------------------------------------------- seasons
// The year turns as you play: four seasons of SEASON_LEN seconds each, starting in spring.
const SEASON_LEN = 300;
const SEASONS = [
  { id: 'spring', name: 'Spring', perk: 'Growth spurt: trees grow back 50% faster',                         want: 'plank', fair: 'Spring building' },
  { id: 'summer', name: 'Summer', perk: 'Long days: sawyers, colliers and carpenters work 20% faster',      want: 'furn',  fair: 'Summer fair' },
  { id: 'autumn', name: 'Autumn', perk: 'Harvest: orders pay 25% more and hats shake loose twice as often', want: 'log',   fair: 'Harvest festival' },
  { id: 'winter', name: 'Winter', perk: 'Snow: haulers and carters sled 25% faster, but trees grow back 40% slower', want: 'char', fair: 'Winter fuel' },
];
const SEASON_GROW = [1.5, 1, 1, 0.6];

// ---------------------------------------------------------------- goods
// Everything the yard can hold, by index: logs, then planks, then furniture, then charcoal.
const LOG = t => t, PLANK = t => NT + t, FURN = t => 2 * NT + t, CHAR = 3 * NT;
const FURN_NAMES = ['Pine Stool', 'Birch Chair', 'Oak Table', 'Maple Dresser', 'Cherry Cabinet', 'Redwood Bed', 'Ebony Piano'];
const ITEMS = [];
TREES.forEach((T, t) => { ITEMS[LOG(t)] = { name: T.name, price: T.price, kind: 'log', t }; });
TREES.forEach((T, t) => { ITEMS[PLANK(t)] = { name: T.name + ' planks', price: Math.round(T.price * 2.4), kind: 'plank', t }; });
TREES.forEach((T, t) => { ITEMS[FURN(t)] = { name: FURN_NAMES[t] + 's', price: Math.round(T.price * 2.4 * 2 * 1.7), kind: 'furn', t }; });
ITEMS[CHAR] = { name: 'Charcoal', price: 40, kind: 'char', t: 0 };
const NI = ITEMS.length;

// ---------------------------------------------------------------- tools
// An axe of level L cuts the first L kinds of tree and deals L damage per swing.
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
const CREW_AXE_MULT = 1.5;     // crew axes cost this much more than yours

// Other upgrades: level n+1 costs base * mult^n coins, plus `item` (goods × level) where given.
// `need` names a building that must exist before the upgrade shows.
const UPG = {
  boots:     { name: 'Trail Boots',    desc: 'You walk 12% faster',                          base: 30,   mult: 3, max: 6 },
  pack:      { name: 'Log Sling',      desc: 'You carry 1 more log',                         base: 50,   mult: 3, max: 5 },
  crewBoots: { name: 'Crew Boots',     desc: 'Your crew walks 12% faster',                   base: 60,   mult: 3, max: 6 },
  crewPack:  { name: 'Hauling Sleds',  desc: 'Haulers carry 2 more logs',                    base: 80,   mult: 3, max: 6 },
  seeds:     { name: 'Seedling Trays', desc: 'Replanted stumps get a bigger head start',     base: 400,  mult: 3, max: 4, need: 'forester' },
  blades:    { name: 'Mill Blades',    desc: 'Sawyers saw 30% faster and carry 2 more logs', base: 500,  mult: 3, max: 6, need: 'sawmill',  item: [CHAR, 10] },
  carts:     { name: 'Bigger Carts',   desc: 'Carters carry 12 more logs',                   base: 1500, mult: 3, max: 5, need: 'depot',    item: [PLANK(2), 15] },
  chisels:   { name: 'Fine Chisels',   desc: 'Carpenters work 30% faster and carry 2 more planks', base: 5000, mult: 3, max: 6, need: 'workshop', item: [CHAR, 20] },
};
function upgCost(k, lvl) {
  const U = UPG[k];
  return { coins: Math.round(U.base * Math.pow(U.mult, lvl)), wood: U.item ? [[U.item[0], U.item[1] * (lvl + 1)]] : [] };
}

// A bridge over river k (1 = between Pine and Birch). Each extra bridge over the same river costs twice the coins.
function bridgeCost(k, extra) {
  return { coins: BRIDGE_COINS[k] * Math.pow(2, extra || 0), wood: [[k <= 2 ? LOG(k - 1) : PLANK(k - 1), 10 + 10 * k]] };
}

const PLAYER_CARRY = 3, HAULER_CARRY = 6, CARTER_CARRY = 20, DEPOT_ROOM = 300;
const PLAYER_SPEED = 46, CREW_SPEED = 38;        // art pixels per second
const PLAYER_SWING = 0.5, CREW_SWING = 0.85;     // seconds per axe swing

// ---------------------------------------------------------------- buildings
// cost(n): price of the (n+1)th one · need: [counter, amount, how to unlock]
function cabinCost(n) {
  const coins = Math.round(30 * Math.pow(4.2, n) / 10) * 10;
  const t = Math.min(n, NT - 1);
  return { coins, wood: n === 0 ? [[0, 10]] : [[t - 1, 15], [t, 10]] };
}
const BUILD = {
  yard:     { name: 'Lumber Yard', w: 5, h: 3 },
  cabin:    { name: 'Lumberjack Cabin', w: 3, h: 2, beds: 4, roles: ['jack', 'hauler'], wood: NT, cost: cabinCost,
              desc: 'Lumberjacks cut the nearest trees they can, however far that takes them. Haulers carry log piles in.' },
  forester: { name: "Forester's Hut", w: 2, h: 2, beds: 3, roles: ['forester'], wood: NT, need: ['cabins', 2, 'Build two cabins'],
              cost: n => ({ coins: 300 * Math.pow(3, n), wood: [[LOG(1), 20]] }),
              desc: 'Foresters replant stumps near the hut so the trees come back much sooner.' },
  sawmill:  { name: 'Sawmill', w: 3, h: 2, beds: 3, roles: ['sawyer'], wood: NT, need: ['axe', 3, 'Forge a Steel Axe'],
              cost: n => ({ coins: 1500 * Math.pow(4, n), wood: [[LOG(1), 40], [LOG(2), 40]] }),
              desc: 'Sawyers fetch logs from the yard and saw them into planks worth 2.4 times as much. Build it close to the yard.' },
  kiln:     { name: 'Charcoal Kiln', w: 2, h: 2, beds: 2, roles: ['collier'], wood: 3, need: ['b:sawmill', 1, 'Build a Sawmill'],
              cost: n => ({ coins: 2500 * Math.pow(4, n), wood: [[LOG(0), 100], [LOG(2), 30]] }),
              desc: 'Colliers burn 3 Pine, Birch or Oak logs into a sack of charcoal: good money for cheap wood, and needed for upgrades.' },
  depot:    { name: 'Log Depot', w: 3, h: 2, beds: 2, roles: ['carter'], need: ['axe', 4, 'Forge a Felling Axe'],
              cost: n => ({ coins: 4000 * Math.pow(3, n), wood: [[PLANK(2), 30]] }),
              desc: 'A drop-off out in the woods. Haulers unload here when it is nearer than the yard, and Carters wheel big loads home.' },
  workshop: { name: "Carpenter's Workshop", w: 3, h: 2, beds: 3, roles: ['carpenter'], wood: NT, need: ['lodge', 1, 'Lay the Pine Foundations of the Great Lodge'],
              cost: n => ({ coins: 20000 * Math.pow(4, n), wood: [[PLANK(3), 60], [CHAR, 40]] }),
              desc: 'Carpenters turn 2 planks into a piece of furniture worth far more than the wood in it.' },
  lodge:    { name: 'The Great Lodge', w: 5, h: 3, unique: true, beds: 3, roles: ['builder'], need: ['made:plank', 50, 'Saw 50 planks'],
              cost: () => ({ coins: 5000, wood: [[PLANK(0), 40]] }),
              desc: 'A hall for the whole forest, raised one storey at a time from every kind of wood. Builders carry each piece from the yard, and every storey brings a lasting reward.' },
};

// The Great Lodge: seven storeys, one per wood, each raised in three steps. Builders carry every
// piece from the yard to the site. LODGE_Q is roughly how many pieces each storey takes in all.
const LODGE_Q = [2000, 4000, 6500, 9000, 12000, 16000, 21000];
const LODGE_COINS = [6000, 20000, 60000, 200000, 600000, 2000000, 6000000];
const LODGE_NAMES = [
  ['Pine Foundations', 'Every cabin gets 1 more bed',                        ['Footings', 'Sill beams', 'Cellar']],
  ['Birch Floors',     'The whole crew walks 10% faster',                    ['Joists', 'Floorboards', 'Benches']],
  ['Oak Frame',        'Every cabin gets 1 more bed',                        ['Posts', 'Beams', 'The great table']],
  ['Maple Walls',      'Sawyers, colliers and carpenters work 25% faster',   ['Studs', 'Wall boards', 'Furnishings']],
  ['Cherry Panelling', 'Every cabin gets 1 more bed',                        ['Door frames', 'Panels', 'Cabinets']],
  ['Redwood Roof',     'Haulers carry 4 more logs',                          ['Rafters', 'Shingles', 'Guest rooms']],
  ['Ebony Spire',      'The Great Lodge is finished!',                       ['Spire frame', 'Cladding', 'The music hall']],
];
const LODGE = LODGE_NAMES.map(([name, perk, steps], t) => {
  const q = LODGE_Q[t], c = LODGE_COINS[t], r = n => Math.round(n / 10) * 10;
  const last = t === 0 ? [[PLANK(0), r(q * 0.1)], [CHAR, r(q * 0.1)]] : [[FURN(t - 1), r(q * 0.1)], [FURN(t), r(q * 0.1)]];
  return { name, perk, steps: [
    { name: steps[0], coins: c * 0.2, need: [[LOG(t), r(q * 0.4)], [CHAR, r(q * 0.05)]] },
    { name: steps[1], coins: c * 0.3, need: [[PLANK(t), r(q * 0.35)]] },
    { name: steps[2], coins: c * 0.5, need: last },
  ] };
});
const BUILDER_CARRY = 5, BUILDER_TIME = 2;      // pieces per trip, seconds to fit each piece

// Standing with the neighbours grows with every order filled. n: orders needed in all.
const RANKS = [
  { n: 0,   name: 'Newcomer' },
  { n: 3,   name: 'Good Neighbour',       perk: 'slot', text: 'A 4th order at a time' },
  { n: 8,   name: 'Trusted Supplier',     perk: 'pay',  text: 'Orders pay 10% more' },
  { n: 15,  name: 'Friend of the Valley', perk: 'hat',  text: 'A gift: a hat you have not found' },
  { n: 25,  name: 'Master Supplier',      perk: 'fast', text: 'Orders arrive much more often' },
  { n: 40,  name: 'Pillar of the Valley', perk: 'slot', text: 'A 5th order at a time' },
  { n: 60,  name: 'Timber Baron',         perk: 'pay',  text: 'Orders pay another 10% more' },
  { n: 85,  name: 'Forest Legend',        perk: 'hat',  text: 'A gift: a hat you have not found' },
  { n: 120, name: 'Royal Woodwright',     perk: 'pay',  text: 'Orders pay another 10% more' },
];

// ---------------------------------------------------------------- crew
// cost: [first hire, growth per hire of the same kind]
const ROLES = {
  jack:      { name: 'Lumberjack', cost: [25, 1.55],   blurb: 'cuts trees' },
  hauler:    { name: 'Hauler',     cost: [20, 1.55],   blurb: 'carries log piles in' },
  forester:  { name: 'Forester',   cost: [150, 1.6],   blurb: 'replants stumps' },
  sawyer:    { name: 'Sawyer',     cost: [300, 1.7],   blurb: 'saws logs into planks' },
  collier:   { name: 'Collier',    cost: [400, 1.7],   blurb: 'burns logs into charcoal' },
  carter:    { name: 'Carter',     cost: [600, 1.7],   blurb: 'carts depot logs to the yard' },
  carpenter: { name: 'Carpenter',  cost: [3000, 1.7],  blurb: 'builds furniture from planks' },
  builder:   { name: 'Builder',    cost: [500, 2],     blurb: 'carries goods to the Great Lodge and fits them' },
};
const hireCost = (role, have) => Math.round(ROLES[role].cost[0] * Math.pow(ROLES[role].cost[1], have));
const foremanCost = have => Math.round(5000 * Math.pow(2.2, have));     // one per cabin: its crew works 30% faster
// what the workshop buildings make. per: inputs per output · time: seconds per output
const RECIPE = {
  sawyer:    { per: 1, time: 1.5, kind: 'plank', types: NT, inp: t => LOG(t),   out: t => PLANK(t) },
  collier:   { per: 3, time: 4,   kind: 'char',  types: 3,  inp: t => LOG(t),   out: () => CHAR },
  carpenter: { per: 2, time: 5,   kind: 'furn',  types: NT, inp: t => PLANK(t), out: t => FURN(t) },
};

// Every Meeple you hire has a quirk. `fits` lists the jobs it helps in; without it, it helps in any job.
const QUIRKS = [
  { id: 'strong',  name: 'Strong Back',    text: 'carries more on every trip',                      fits: ['hauler', 'carter', 'sawyer', 'collier', 'carpenter', 'builder'] },
  { id: 'quick',   name: 'Quick Feet',     text: 'walks 20% faster' },
  { id: 'swing',   name: 'Mighty Swing',   text: 'chops 25% faster',                                fits: ['jack'] },
  { id: 'magnet',  name: 'Hat Magnet',     text: 'shakes hats out of trees six times as often',     fits: ['jack'] },
  { id: 'thumb',   name: 'Green Thumb',    text: 'replants twice as fast',                          fits: ['forester'] },
  { id: 'nimble',  name: 'Nimble Fingers', text: 'works 25% faster at the bench',                   fits: ['sawyer', 'collier', 'carpenter', 'builder'] },
  { id: 'early',   name: 'Early Riser',    text: 'takes half as long between jobs' },
  { id: 'dreamer', name: 'Daydreamer',     text: 'dawdles between jobs, but learns twice as fast' },
  { id: 'snow',    name: 'Snow Lover',     text: '30% faster all winter' },
  { id: 'sun',     name: 'Sun Chaser',     text: '30% faster all summer' },
];
const QUIRK = {}; QUIRKS.forEach(q => { QUIRK[q.id] = q; });
const quirkFits = (q, role) => !!QUIRK[q] && (!QUIRK[q].fits || QUIRK[q].fits.includes(role));
// Meeples get better with time on the job. at: seconds of work to reach the level. Each level is SKILL_BONUS faster at everything.
const SKILL = [{ name: 'Greenhorn', at: 0 }, { name: 'Steady Hand', at: 600 }, { name: 'Old Hand', at: 1800 }, { name: 'Expert', at: 4500 }, { name: 'Master', at: 9000 }];
const SKILL_BONUS = 0.06;
const skillOf = xp => { let l = 0; while (l < SKILL.length - 1 && xp >= SKILL[l + 1].at) l++; return l; };

const NAMES = ['Birch', 'Timber', 'Knotty', 'Splinter', 'Sawyer', 'Chip', 'Woody', 'Barkley', 'Cedric', 'Hazel', 'Rowan', 'Aspen',
  'Twig', 'Bramble', 'Forrest', 'Juniper', 'Linden', 'Alder', 'Ash', 'Willow', 'Stumpy', 'Plank', 'Maple', 'Burl', 'Acorn', 'Fern',
  'Moss', 'Hickory', 'Elm', 'Sorrel', 'Thorn', 'Root', 'Bud', 'Sprig', 'Kindle', 'Tinder', 'Cork', 'Larch', 'Yew', 'Sapling',
  'Bracken', 'Conker', 'Dusty', 'Ember', 'Flint', 'Gnarl', 'Heath', 'Ivy', 'Jasper', 'Knot', 'Lichen', 'Mallet', 'Nettle', 'Oakley',
  'Pip', 'Quill', 'Reed', 'Sage', 'Thistle', 'Umber', 'Vale', 'Wren', 'Yarrow', 'Zephyr', 'Biscuit', 'Clover', 'Dibble', 'Figgy',
  'Gus', 'Hobnail', 'Inky', 'Jolly', 'Kettle', 'Lumpy', 'Muffin', 'Noggin', 'Otis', 'Pudding', 'Rusty', 'Scruff', 'Tumble', 'Whittle'];

// ---------------------------------------------------------------- silly walks and hats
const GAITS = ['Waddle', 'Bunny hop', 'Moonwalk', 'Cartwheel', 'Skip', 'Wobble', 'Sneak', 'March', 'Zoomies', 'Float', 'Shimmy', 'Backflips'];
// Hats hide in trees of one kind; felling that kind can shake one loose.
const HATS = [
  { id: 'pinecone', name: 'Pinecone Cap',     tree: 0 }, { id: 'feather',  name: 'Feathered Cap',   tree: 0 }, { id: 'nest',     name: "Bird's Nest",    tree: 0 },
  { id: 'daisies',  name: 'Daisy Chain',      tree: 1 }, { id: 'party',    name: 'Party Hat',       tree: 1 }, { id: 'bucket',   name: 'Sap Bucket',     tree: 1 },
  { id: 'acorn',    name: 'Acorn Cap',        tree: 2 }, { id: 'viking',   name: 'Viking Helm',     tree: 2 }, { id: 'tophat',   name: 'Top Hat',        tree: 2 },
  { id: 'leaves',   name: 'Autumn Crown',     tree: 3 }, { id: 'pancakes', name: 'Pancake Stack',   tree: 3 }, { id: 'ranger',   name: 'Ranger Hat',     tree: 3 },
  { id: 'blossom',  name: 'Blossom Wreath',   tree: 4 }, { id: 'cherries', name: 'Cherries on Top', tree: 4 }, { id: 'kasa',     name: 'Rice Hat',       tree: 4 },
  { id: 'bear',     name: 'Bear Ears',        tree: 5 }, { id: 'cone',     name: 'Traffic Cone',    tree: 5 }, { id: 'antlers',  name: 'Antlers',        tree: 5 },
  { id: 'wizard',   name: "Wizard's Hat",     tree: 6 }, { id: 'mushroom', name: 'Glowcap',         tree: 6 }, { id: 'crown',    name: 'Ebony Crown',    tree: 6 },
  // one for each season: any tree can drop it, but only in that season
  { id: 'bunny',    name: 'Bunny Ears',       tree: -1, season: 0 }, { id: 'sunhat', name: 'Sun Hat',       tree: -1, season: 1 },
  { id: 'pumpkin',  name: 'Pumpkin Head',     tree: -1, season: 2 }, { id: 'earmuffs', name: 'Earmuffs',    tree: -1, season: 3 },
];

// ---------------------------------------------------------------- goals
// The current goal is the first one not yet done. key reads a counter (see goalValue in world.js).
const GOALS = [
  { id: 'chop',     t: 'Chop down a Pine tree',      d: 'Tap a tree beside the Lumber Yard.',                           key: 'chopped',   n: 1,  r: 0 },
  { id: 'carry',    t: 'Carry 3 logs to the yard',   d: 'Your Meeple hauls what it cuts. Tap a log pile to fetch it.',  key: 'delivered', n: 3,  r: 5 },
  { id: 'sell',     t: 'Sell some wood',             d: 'Tap the Lumber Yard and sell your logs.',                      key: 'sales',     n: 6,  r: 5 },
  { id: 'cabin1',   t: 'Build a Lumberjack Cabin',   d: 'Build ➜ Cabin. Keep 10 Pine logs unsold for it.',              key: 'cabins',    n: 1,  r: 10 },
  { id: 'jack1',    t: 'Hire a lumberjack',          d: 'Tap your cabin and hire a lumberjack.',                        key: 'r:jack',    n: 1,  r: 10 },
  { id: 'hauler1',  t: 'Hire a hauler',              d: 'Haulers carry log piles back to the yard.',                    key: 'r:hauler',  n: 1,  r: 15 },
  { id: 'anc0',     t: 'Fell the Ancient Pine',      d: 'A giant stands among the pines: see the Map. Tap it and call your lumberjacks.', key: 'anc', n: 1, r: 30 },
  { id: 'axe2',     t: 'Forge an Iron Axe',          d: 'Yard ➜ Workshop: yours or the crew\'s. Birch grows across the river.', key: 'axe', n: 2,  r: 20 },
  { id: 'bridge1',  t: 'Bridge the First River',     d: 'Build ➜ Bridge. Then move a cabin across so its crew is near the Birch.', key: 'reach', n: 1, r: 40 },
  { id: 'birch10',  t: 'Sell 10 Birch logs',         d: 'Tap a cabin, then Move, to put its crew over the bridge.',                  key: 'sold1',     n: 10, r: 40 },
  { id: 'crew4',    t: 'Have a crew of 4',           d: 'Lumberjacks cut; haulers fetch. Keep them in balance.',        key: 'workers',   n: 4,  r: 60 },
  { id: 'axe3',     t: 'Forge a Steel Axe',          d: 'Yours or the crew\'s. Each new axe opens the next ring.',      key: 'axe',       n: 3,  r: 100 },
  { id: 'anc1',     t: 'Fell the Ancient Birch',     d: 'Each ring has one giant. Its fall opens the way over the next river.', key: 'anc', n: 2, r: 120 },
  { id: 'bridge2',  t: 'Bridge the Second River',    d: 'Oak grows on the far bank. A second bridge over a river saves long walks.', key: 'reach', n: 2, r: 150 },
  { id: 'oak20',    t: 'Sell 20 Oak logs',           d: 'Move a cabin over the bridges and set it to cut only Oak.',  key: 'sold2',     n: 20, r: 200 },
  { id: 'cabins2',  t: 'Build a second cabin',       d: 'Cabins can be moved for free whenever you like.',              key: 'cabins',    n: 2,  r: 250 },
  { id: 'forester', t: "Build a Forester's Hut",     d: 'Foresters replant stumps so cut land grows back sooner.',      key: 'b:forester', n: 1, r: 300 },
  { id: 'sawmill',  t: 'Build a Sawmill',            d: 'Planks sell for 2.4 times the price of the logs.',             key: 'b:sawmill', n: 1,  r: 400 },
  { id: 'sawyer1',  t: 'Hire a sawyer',              d: 'Tap the Sawmill to hire. Sawyers fetch logs from the yard.',   key: 'r:sawyer',  n: 1,  r: 300 },
  { id: 'planks50', t: 'Saw 50 planks',              d: 'Hold some logs back in the yard so there is wood to saw.',     key: 'made:plank', n: 50, r: 600 },
  { id: 'order1',   t: 'Fill an order',              d: 'Yard ➜ Orders. Neighbours pay well over the usual price.',     key: 'orders',    n: 1,  r: 500 },
  { id: 'hat1',     t: 'Find a hat',                 d: 'Hats hide in trees. Felling them yourself shakes them loose sooner.', key: 'hats', n: 1, r: 300 },
  { id: 'anc2',     t: 'Fell the Ancient Oak',       d: 'Call the lumberjacks: it is far too much for one axe.',        key: 'anc',       n: 3,  r: 500 },
  { id: 'bridge3',  t: 'Bridge the Third River',     d: 'This one wants Oak planks. Forge the Felling Axe for Maple.',  key: 'reach',     n: 3,  r: 600 },
  { id: 'maple30',  t: 'Sell 30 Maple logs',         d: 'The Maple ring glows orange.',                                 key: 'sold3',     n: 30, r: 600 },
  { id: 'kiln',     t: 'Build a Charcoal Kiln',      d: 'Charcoal turns cheap Pine into good money.',                   key: 'b:kiln',    n: 1,  r: 800 },
  { id: 'char30',   t: 'Burn 30 sacks of charcoal',  d: 'Hire a collier at the kiln.',                                  key: 'made:char', n: 30, r: 1000 },
  { id: 'lodge0',   t: 'Stake out the Great Lodge',  d: 'Build ➜ The Great Lodge. Choose a grand spot.',                key: 'b:lodge',   n: 1,  r: 1500 },
  { id: 'builder1', t: 'Hire a builder',             d: 'Tap the Lodge site. Builders carry what it needs from the yard.', key: 'r:builder', n: 1, r: 500 },
  { id: 'lodge1',   t: 'Lay the Pine Foundations',   d: 'Three steps: footings, sill beams, cellar. Keep the yard stocked.', key: 'lodge',  n: 1,  r: 3000 },
  { id: 'anc3',     t: 'Fell the Ancient Maple',     d: 'A blaze of orange taller than the Lodge will ever be.',        key: 'anc',       n: 4,  r: 2000 },
  { id: 'bridge4',  t: 'Bridge the Fourth River',    d: 'Cherry blossoms on the far side.',                             key: 'reach',     n: 4,  r: 2500 },
  { id: 'cherry40', t: 'Sell 40 Cherry logs',        d: 'Look for pink blossoms.',                                      key: 'sold4',     n: 40, r: 2000 },
  { id: 'depot',    t: 'Build a Log Depot',          d: 'Put it out where your crews are cutting.',                     key: 'b:depot',   n: 1,  r: 3000 },
  { id: 'carter1',  t: 'Hire a carter',              d: 'Carters wheel the depot\'s logs back to the yard.',            key: 'r:carter',  n: 1,  r: 1500 },
  { id: 'lodge2',   t: 'Lay the Birch Floors',       d: 'Point a cabin at Birch to stock up.',                          key: 'lodge',     n: 2,  r: 6000 },
  { id: 'workshop', t: "Build a Carpenter's Workshop", d: 'Furniture is worth far more than the planks in it.',         key: 'b:workshop', n: 1, r: 5000 },
  { id: 'furn20',   t: 'Build 20 pieces of furniture', d: 'Hire a carpenter and keep planks in stock.',                 key: 'made:furn', n: 20, r: 6000 },
  { id: 'orders15', t: 'Fill 15 orders',             d: 'Your standing with the neighbours brings rewards.',            key: 'orders',    n: 15, r: 8000 },
  { id: 'lodge3',   t: 'Raise the Oak Frame',        d: 'It wants Birch Chairs and Oak Tables as well as Oak.',         key: 'lodge',     n: 3,  r: 15000 },
  { id: 'anc4',     t: 'Fell the Ancient Cherry',    d: 'Petals for days.',                                             key: 'anc',       n: 5,  r: 6000 },
  { id: 'bridge5',  t: 'Bridge the Fifth River',     d: 'The Redwoods stand beyond.',                                   key: 'reach',     n: 5,  r: 8000 },
  { id: 'redwood50', t: 'Sell 50 Redwood logs',      d: 'Giants of the deep forest.',                                   key: 'sold5',     n: 50, r: 6000 },
  { id: 'foreman',  t: 'Appoint a foreman',          d: 'Tap a cabin. A foreman makes its crew 30% faster.',            key: 'foremen',   n: 1,  r: 8000 },
  { id: 'lodge4',   t: 'Build the Maple Walls',      d: 'Chairs, tables and a great deal of Maple.',                    key: 'lodge',     n: 4,  r: 40000 },
  { id: 'hats10',   t: 'Find 10 hats',               d: 'Each kind of tree hides three.',                               key: 'hats',      n: 10, r: 20000 },
  { id: 'orders60', t: 'Fill 60 orders',             d: 'Timber Baron has a ring to it.',                               key: 'orders',    n: 60, r: 60000 },
  { id: 'lodge5',   t: 'Fit the Cherry Panelling',   d: 'Look for pink blossoms, and bring dressers.',                  key: 'lodge',     n: 5,  r: 120000 },
  { id: 'anc5',     t: 'Fell the Ancient Redwood',   d: 'The biggest tree in the forest.',                              key: 'anc',       n: 6,  r: 20000 },
  { id: 'bridge6',  t: 'Bridge the Sixth River',     d: 'The last river, and the Ebony beyond it.',                     key: 'reach',     n: 6,  r: 25000 },
  { id: 'ebony60',  t: 'Sell 60 Ebony logs',         d: 'The rarest wood, at the edge of the map.',                     key: 'sold6',     n: 60, r: 20000 },
  { id: 'lodge6',   t: 'Raise the Redwood Roof',     d: 'Nearly there.',                                                key: 'lodge',     n: 6,  r: 400000 },
  { id: 'anc6',     t: 'Fell the Ancient Ebony',     d: 'The oldest thing in the valley.',                              key: 'anc',       n: 7,  r: 100000 },
  { id: 'lodge7',   t: 'Crown it with the Ebony Spire', d: 'The last storey of the Great Lodge.',                       key: 'lodge',     n: 7,  r: 1000000, win: true },
];
// goal order in v1.0 saves, for carrying progress over
const OLD_GOALS = ['chop', 'carry', 'sell', 'cabin1', 'jack1', 'hauler1', 'axe2', 'birch10', 'crew4', 'axe3', 'oak20', 'cabins2', 'maple30', 'cherry40', 'redwood50', 'ebony60'];

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
