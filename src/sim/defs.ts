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

/** Clamp everything into a legal combination. Returns a new object. */
export function sanitizeSettings(s: Settings): Settings {
  const d = defaultSettings();
  const o: Settings = { ...d, ...s, roleCounts: { ...d.roleCounts, ...(s.roleCounts || {}) } };
  o.npcCount = Math.round(clamp(o.npcCount, 3, 20));
  const total = o.npcCount + 1;
  o.murderers = Math.round(clamp(o.murderers, 1, maxMurderers(total)));
  if (o.autoBalance) Object.assign(o, recommendedRules(o.npcCount, o.murderers, o.size));
  o.killCooldown = clamp(o.killCooldown, 10, 60);
  o.vision = clamp(o.vision, 4, 11);
  o.tasks = Math.round(clamp(o.tasks, 2, 9));
  o.discussTime = Math.round(clamp(o.discussTime, 0, 120));
  o.voteTime = Math.round(clamp(o.voteTime, 0, 120));
  // Special roles can never outnumber the non-murderers; always leave at least one plain guest.
  let room = total - o.murderers - 1;
  for (const r of [...CIV_SPECIALS, 'jester']) {
    const max = r === 'jester' ? 1 : 2;
    const n = Math.round(clamp(o.roleCounts[r] ?? 0, 0, max));
    o.roleCounts[r] = Math.min(n, Math.max(0, room));
    room -= o.roleCounts[r];
  }
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
 * One dial for how hard the house leans on the guests: 0 is gentle (slow kills, few chores),
 * 1 is brutal (fast kills, many chores). Used by auto-balance.
 */
export function pressureToRules(x: number): { killCooldown: number; tasks: number } {
  const v = Math.max(0, Math.min(1, x));
  return { killCooldown: Math.round(60 - 50 * v), tasks: Math.max(2, Math.min(9, Math.round(3 + 8 * v))) };
}

// Pressure values found by src/sim/calibrate.ts (all-AI rounds, murderers winning ~38%).
// Keys are size:murderers:npcCount.
export const BALANCE: Record<string, number> = {};

export function recommendedRules(npcCount: number, murderers: number, size: MapSize): { killCooldown: number; tasks: number } {
  const pts: [number, number][] = [];
  for (const [k, v] of Object.entries(BALANCE)) {
    const [sz, m, n] = k.split(':');
    if (sz === size && +m === murderers) pts.push([+n, v]);
  }
  if (!pts.length) return pressureToRules(0.5);
  pts.sort((a, b) => a[0] - b[0]);
  if (npcCount <= pts[0][0]) return pressureToRules(pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (npcCount <= pts[i][0]) {
      const t = (npcCount - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pressureToRules(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
    }
  }
  return pressureToRules(pts[pts.length - 1][1]);
}
