export type RoleId =
  | 'civilian'
  | 'detective'
  | 'medic'
  | 'vigilante'
  | 'engineer'
  | 'lookout'
  | 'magistrate'
  | 'jester'
  | 'killer'
  | 'cleaner'
  | 'framer';

export type Team = 'civ' | 'murder' | 'neutral';

export interface RoleDef {
  name: string;
  team: Team;
  color: string;
  blurb: string;
  goal: string;
}

export const ROLES: Record<RoleId, RoleDef> = {
  civilian: {
    name: 'Guest',
    team: 'civ',
    color: '#9fd4a3',
    blurb: 'No special talents, just your wits and your eyes.',
    goal: 'Finish your chores, stay alive, and vote out the murderers.',
  },
  detective: {
    name: 'Detective',
    team: 'civ',
    color: '#7fb6ff',
    blurb: 'When a body is reported you examine the scene and get a shortlist of suspects. The killer is usually on it.',
    goal: 'Use your shortlists to steer the vote toward the murderers.',
  },
  medic: {
    name: 'Medic',
    team: 'civ',
    color: '#7ee0c8',
    blurb: 'Ward one nearby person at a time. A ward absorbs a single attack and exposes the attacker to anyone watching.',
    goal: 'Keep the right people alive and help vote out the murderers.',
  },
  vigilante: {
    name: 'Vigilante',
    team: 'civ',
    color: '#ffb35c',
    blurb: 'One bullet. Shoot a murderer and they die. Shoot an innocent guest and you die instead.',
    goal: 'Be certain, then take the shot.',
  },
  engineer: {
    name: 'Engineer',
    team: 'civ',
    color: '#e8d36a',
    blurb: 'Repairs sabotage three times faster, walks through locked doors, and keeps full vision in a blackout.',
    goal: 'Keep the place running and help vote out the murderers.',
  },
  lookout: {
    name: 'Lookout',
    team: 'civ',
    color: '#b9a4ff',
    blurb: 'Sharp eyes: you see noticeably farther than anyone else.',
    goal: 'See what others miss and tell the room about it.',
  },
  magistrate: {
    name: 'Magistrate',
    team: 'civ',
    color: '#f0a3c0',
    blurb: 'Your vote counts twice.',
    goal: 'Vote wisely. Your mistakes cost double.',
  },
  jester: {
    name: 'Jester',
    team: 'neutral',
    color: '#ff7ad9',
    blurb: 'You have no chores and no friends. You only win if the room votes YOU out.',
    goal: 'Look guilty enough to get voted out. Dying any other way is a loss.',
  },
  killer: {
    name: 'Murderer',
    team: 'murder',
    color: '#ff5b5b',
    blurb: 'Kill when nobody is watching. Lie when everybody is.',
    goal: 'Kill until murderers equal the rest, or let a critical sabotage run out.',
  },
  cleaner: {
    name: 'Cleaner',
    team: 'murder',
    color: '#ff5b5b',
    blurb: 'A murderer who can dispose of a body so it is never found. No body, no examination, no report.',
    goal: 'Kill until murderers equal the rest, or let a critical sabotage run out.',
  },
  framer: {
    name: 'Framer',
    team: 'murder',
    color: '#ff5b5b',
    blurb: 'A murderer whose kills leave planted evidence: the Detective’s shortlist will point at someone else.',
    goal: 'Kill until murderers equal the rest, or let a critical sabotage run out.',
  },
};

export const CIV_SPECIALS: RoleId[] = ['detective', 'medic', 'vigilante', 'engineer', 'lookout', 'magistrate'];

export type Difficulty = 'easy' | 'normal' | 'hard';
export type MapSize = 'small' | 'medium' | 'large';
export type ThemeChoice = 'random' | 'manor' | 'station' | 'ship' | 'lodge';

export interface Settings {
  npcCount: number;
  murderers: number;
  roleCounts: Record<string, number>; // civ specials + jester
  murdererVariants: boolean;
  theme: ThemeChoice;
  size: MapSize;
  seed: string;
  killCooldown: number;
  vision: number;
  tasks: number;
  discussTime: number;
  voteTime: number;
  difficulty: Difficulty;
  preferredRole: RoleId | 'random';
  revealRoles: boolean;
  autoBalance: boolean; // pick kill cooldown and chore count to suit the crowd
}

export function defaultSettings(): Settings {
  return {
    npcCount: 11,
    murderers: 2,
    roleCounts: { detective: 1, medic: 1, vigilante: 1, engineer: 1, lookout: 0, magistrate: 0, jester: 1 },
    murdererVariants: true,
    theme: 'random',
    size: 'medium',
    seed: '',
    killCooldown: 25,
    vision: 7,
    tasks: 7,
    discussTime: 45,
    voteTime: 30,
    difficulty: 'normal',
    preferredRole: 'random',
    revealRoles: true,
    autoBalance: true,
  };
}

export function maxMurderers(total: number): number {
  return Math.max(1, Math.min(3, Math.floor((total - 1) / 3)));
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));

/** Special roles can never outnumber the non-murderers; always leave at least one plain guest. */
function trimRoles(counts: Record<string, number>, total: number, murderers: number): Record<string, number> {
  const out: Record<string, number> = {};
  let room = total - murderers - 1;
  for (const r of [...CIV_SPECIALS, 'jester']) {
    const max = r === 'jester' ? 1 : 2;
    const n = Math.round(clamp(counts[r] ?? 0, 0, max));
    out[r] = Math.min(n, Math.max(0, room));
    room -= out[r];
  }
  return out;
}

/** Clamp everything into a legal combination. Returns a new object. */
export function sanitizeSettings(s: Settings): Settings {
  const d = defaultSettings();
  const o: Settings = { ...d, ...s, roleCounts: { ...d.roleCounts, ...(s.roleCounts || {}) } };
  o.npcCount = Math.round(clamp(o.npcCount, 3, 20));
  const total = o.npcCount + 1;
  o.murderers = Math.round(clamp(o.murderers, 1, maxMurderers(total)));
  o.killCooldown = clamp(o.killCooldown, 10, 60);
  o.vision = clamp(o.vision, 4, 11);
  o.tasks = Math.round(clamp(o.tasks, 2, 14));
  o.discussTime = Math.round(clamp(o.discussTime, 0, 120));
  o.voteTime = Math.round(clamp(o.voteTime, 0, 120));
  o.roleCounts = trimRoles(o.roleCounts, total, o.murderers);
  if (o.autoBalance) Object.assign(o, recommendedRules(o.npcCount, o.murderers, o.size, o.roleCounts));
  if (!['easy', 'normal', 'hard'].includes(o.difficulty)) o.difficulty = 'normal';
  if (!['small', 'medium', 'large'].includes(o.size)) o.size = 'medium';
  if (!['random', 'manor', 'station', 'ship', 'lodge'].includes(o.theme)) o.theme = 'random';
  if (o.preferredRole !== 'random' && !ROLES[o.preferredRole]) o.preferredRole = 'random';
  return o;
}

export interface CastEntry {
  name: string;
  color: string;
}

// 21 distinguishable cloaks. Names double as colour hints so meetings are readable.
export const CAST: CastEntry[] = [
  { name: 'Scarlet', color: '#e5484d' },
  { name: 'Cobalt', color: '#3e63dd' },
  { name: 'Fern', color: '#46a758' },
  { name: 'Saffron', color: '#f5c518' },
  { name: 'Plum', color: '#8e4ec6' },
  { name: 'Tangerine', color: '#f76b15' },
  { name: 'Teal', color: '#12a594' },
  { name: 'Rose', color: '#e93d82' },
  { name: 'Ivory', color: '#e9e6dc' },
  { name: 'Slate', color: '#69748c' },
  { name: 'Sky', color: '#7ce2fe' },
  { name: 'Moss', color: '#7a8a2e' },
  { name: 'Umber', color: '#8a5a3c' },
  { name: 'Lilac', color: '#c4a8f5' },
  { name: 'Mint', color: '#86ead4' },
  { name: 'Coral', color: '#ff9592' },
  { name: 'Indigo', color: '#3a2f8f' },
  { name: 'Sand', color: '#d6b98c' },
  { name: 'Wine', color: '#7d1d3f' },
  { name: 'Lime', color: '#bdee63' },
  { name: 'Ash', color: '#b4b4b4' },
];

export interface DifficultyTuning {
  memorySpan: number; // seconds an NPC reliably remembers sightings
  evidenceMiss: number; // chance an NPC overlooks a piece of its own evidence
  voteShift: number; // added to vote thresholds (lower = more decisive)
  cunning: number; // 0..1 how careful murderers are
  percInterval: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyTuning> = {
  easy: { memorySpan: 30, evidenceMiss: 0.3, voteShift: 0.5, cunning: 0.35, percInterval: 0.4 },
  normal: { memorySpan: 60, evidenceMiss: 0.12, voteShift: 0.25, cunning: 0.8, percInterval: 0.25 },
  hard: { memorySpan: 150, evidenceMiss: 0.02, voteShift: 0.1, cunning: 0.95, percInterval: 0.18 },
};

/**
 * One dial for how hard the house leans on the guests, used by auto-balance. From 0 to 0.5 the
 * kill cooldown falls from 60s to 30s and chores rise from 3 to 7. Past 0.5 the cooldown barely
 * moves (very fast kills just get murderers caught sooner) and the chore list grows to 14, which
 * is what actually buys murderers time in a big crowd.
 */
export function pressureToRules(x: number): { killCooldown: number; tasks: number } {
  const v = Math.max(0, Math.min(1, x));
  if (v < 0.5) return { killCooldown: Math.round(60 - 60 * v), tasks: Math.round(3 + 8 * v) };
  return { killCooldown: Math.round(30 - 8 * (v - 0.5)), tasks: Math.round(7 + 14 * (v - 0.5)) };
}

// Found by src/sim/calibrate.ts: all-AI rounds, searching for the pressure at which murderers win
// about 38%. Keys are size:murderers:npcCount. Where even the extreme setting cannot get there
// (one murderer against a crowd, say) the entry records how lopsided it stays.
// Each entry is [pressure, murderers' win % measured at that pressure].
export const BALANCE: Record<string, [number, number]> = {
  'small:1:3': [0.08, 45],
  'small:1:5': [0.42, 23],
  'small:1:7': [0.98, 25],
  'small:2:7': [0.17, 32],
  'small:1:9': [0.98, 22],
  'small:2:9': [0.33, 42],
  'small:3:9': [0.02, 62],
  'small:1:11': [0.98, 7],
  'small:2:11': [0.73, 32],
  'small:3:11': [0.17, 23],
  'small:1:14': [0.98, 0],
  'small:2:14': [0.98, 10],
  'small:3:14': [0.52, 42],
  'small:1:17': [0.98, 0],
  'small:2:17': [0.98, 3],
  'small:3:17': [0.98, 32],
  'small:1:20': [0.98, 0],
  'small:2:20': [0.98, 0],
  'small:3:20': [0.98, 15],
  'medium:1:3': [0.05, 27],
  'medium:1:5': [0.42, 30],
  'medium:1:7': [0.61, 23],
  'medium:2:7': [0.08, 43],
  'medium:1:9': [0.98, 23],
  'medium:2:9': [0.3, 27],
  'medium:3:9': [0.02, 57],
  'medium:1:11': [0.98, 7],
  'medium:2:11': [0.58, 43],
  'medium:3:11': [0.08, 42],
  'medium:1:14': [0.98, 5],
  'medium:2:14': [0.98, 32],
  'medium:3:14': [0.36, 35],
  'medium:1:17': [0.98, 0],
  'medium:2:17': [0.98, 7],
  'medium:3:17': [0.89, 47],
  'medium:1:20': [0.98, 0],
  'medium:2:20': [0.98, 3],
  'medium:3:20': [0.98, 18],
  'large:1:3': [0.05, 33],
  'large:1:5': [0.39, 40],
  'large:1:7': [0.8, 32],
  'large:2:7': [0.05, 27],
  'large:1:9': [0.98, 33],
  'large:2:9': [0.27, 43],
  'large:3:9': [0.02, 62],
  'large:1:11': [0.98, 22],
  'large:2:11': [0.55, 33],
  'large:3:11': [0.02, 40],
  'large:1:14': [0.98, 7],
  'large:2:14': [0.92, 28],
  'large:3:14': [0.27, 42],
  'large:1:17': [0.98, 2],
  'large:2:17': [0.98, 17],
  'large:3:17': [0.55, 28],
  'large:1:20': [0.98, 0],
  'large:2:20': [0.98, 5],
  'large:3:20': [0.98, 33],
};

function balancePoint(npcCount: number, murderers: number, size: MapSize): [number, number] {
  const pts: [number, number, number][] = [];
  for (const [k, v] of Object.entries(BALANCE)) {
    const [sz, m, n] = k.split(':');
    if (sz === size && +m === murderers) pts.push([+n, v[0], v[1]]);
  }
  if (!pts.length) return [0.5, 38];
  pts.sort((a, b) => a[0] - b[0]);
  if (npcCount <= pts[0][0]) return [pts[0][1], pts[0][2]];
  for (let i = 1; i < pts.length; i++) {
    if (npcCount <= pts[i][0]) {
      const t = (npcCount - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return [pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * t];
    }
  }
  const last = pts[pts.length - 1];
  return [last[1], last[2]];
}

// How many points of murderer win rate one copy of each role costs them (measured one role at a
// time at default settings). The table above was built with the default role mix, so auto-balance
// shifts the dial by the difference: a house with no Medic or Detective gets gentler rules.
const ROLE_WEIGHT: Record<string, number> = { detective: 14, medic: 22, vigilante: 0, engineer: 4, lookout: 5, magistrate: 2, jester: 7 };
const POINTS_PER_PRESSURE = 150;
const ROLE_OVERLAP = 0.77; // roles together help a bit less than the sum of each alone

function roleShift(npcCount: number, murderers: number, roleCounts: Record<string, number>): number {
  const score = (rc: Record<string, number>) => Object.entries(rc).reduce((a, [r, n]) => a + (ROLE_WEIGHT[r] ?? 0) * n, 0);
  const ref = trimRoles(defaultSettings().roleCounts, npcCount + 1, murderers);
  return ((score(roleCounts) - score(ref)) * ROLE_OVERLAP) / POINTS_PER_PRESSURE;
}

export function recommendedRules(npcCount: number, murderers: number, size: MapSize, roleCounts: Record<string, number>): { killCooldown: number; tasks: number } {
  return pressureToRules(balancePoint(npcCount, murderers, size)[0] + roleShift(npcCount, murderers, roleCounts));
}

/** Roughly how often murderers win all-AI test rounds with the auto-balanced rules for this crowd. */
export function testedMurderOdds(npcCount: number, murderers: number, size: MapSize, roleCounts: Record<string, number>): number {
  const [x, odds] = balancePoint(npcCount, murderers, size);
  const want = x + roleShift(npcCount, murderers, roleCounts);
  // If the dial ran out of travel, whatever it could not absorb shows up in the odds.
  const overflow = want - Math.max(0, Math.min(1, want));
  return Math.round(Math.max(0, Math.min(100, odds - overflow * POINTS_PER_PRESSURE)));
}
