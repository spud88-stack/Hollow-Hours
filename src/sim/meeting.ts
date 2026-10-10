// Meetings: structured statements, how NPCs weigh them against their own memory, and voting.
// NPC reasoning only ever reads the NPC's own Memory plus what has been said out loud.
import { ROLES, type RoleId } from './defs';
import { CORRIDOR_BASE, type GameMap } from './map';
import { N, R, type Body, type Char, type Game, type Sight } from './game';

export type Reason = 'witness' | 'attack' | 'scene' | 'withVictim' | 'nearBody' | 'lied' | 'hunch' | 'agree';

export interface Stmt {
  by: number; // -1 for narration
  kind: 'system' | 'where' | 'saw' | 'accuse' | 'defend' | 'claim' | 'contradict' | 'deny';
  target?: number;
  region?: number;
  region2?: number;
  reason?: Reason;
  role?: RoleId;
  clue?: number[];
  vouch?: number;
  victim?: number;
  lie?: boolean;
  priv?: boolean; // only the player sees this line
  text: string;
}

/** Per-character scratch state for one meeting. */
interface MT {
  myRegion: number;
  alibi: Map<number, number>; // people I saw somewhere else at the time, and where
  scene: Set<number>; // people I saw at the scene around the time
  withV: Set<number>;
  nearBody: Set<number>;
  caught: Map<number, number>; // people whose "where" claim contradicts what I saw -> where I saw them
  falseAboutMe: Map<number, number>;
  basis: Map<number, Reason>;
  said: Set<string>;
  defended: boolean;
}

export interface Meeting {
  kind: 'body' | 'emergency';
  reporter: number;
  body: Body | null;
  victim: number;
  region: number;
  deathT: number;
  newDead: number[];
  order: number[];
  pos: number;
  round: number;
  phase: 'discuss' | 'vote' | 'result';
  feed: Stmt[];
  mt: MT[];
  heat: Float32Array; // how much the room as a whole has pointed at each person
  whereClaims: Map<number, number>;
  accusers: Map<number, { by: number; reason: Reason }[]>;
  defenders: Map<number, number[]>;
  clues: Map<number, number[]>;
  votes: Int16Array; // -2 none, -1 skip
  result: { ejected: number; tie: boolean; tally: { id: number; votes: number }[] } | null;
}

export type Step = { type: 'stmt'; stmt: Stmt } | { type: 'player' } | { type: 'vote' };

const STRONG = (r?: Reason) => r === 'witness' || r === 'attack';

function sameArea(map: GameMap, a: number, b: number): boolean {
  if (a === b) return true;
  if (a < 0 || b < 0) return false;
  if (a >= CORRIDOR_BASE) {
    const c = map.corridors[a - CORRIDOR_BASE];
    if (c.a === b || c.b === b) return true;
  }
  if (b >= CORRIDOR_BASE) {
    const c = map.corridors[b - CORRIDOR_BASE];
    if (c.a === a || c.b === a) return true;
  }
  return false;
}

/** Close enough that someone could honestly be in either within a few seconds. */
function near(map: GameMap, a: number, b: number): boolean {
  if (sameArea(map, a, b)) return true;
  if (a < 0 || b < 0) return false;
  const ends = (r: number) => (r >= CORRIDOR_BASE ? [map.corridors[r - CORRIDOR_BASE].a, map.corridors[r - CORRIDOR_BASE].b] : [r]);
  const ea = ends(a);
  const eb = ends(b);
  if (ea.some((r) => eb.includes(r))) return true;
  return map.corridors.some((c) => (ea.includes(c.a) && eb.includes(c.b)) || (ea.includes(c.b) && eb.includes(c.a)));
}

/** Where a remembered subject was at time t (within slack seconds), or -1. */
function at(list: Sight[], t: number, slack: number): number {
  let best = -1;
  let gap = slack;
  for (const s of list) {
    const d = t < s.t0 ? s.t0 - t : t > s.t1 ? t - s.t1 : 0;
    if (d <= gap) {
      gap = d;
      best = s.region;
      if (d === 0) break;
    }
  }
  return best;
}

function sys(text: string, priv = false): Stmt {
  return { by: -1, kind: 'system', text, priv };
}

function makeClue(g: Game, body: Body, det: Char): number[] | null {
  const killer = g.chars[body.killer];
  if (!killer.alive) return null;
  const alive = g.aliveChars().filter((c) => c.id !== det.id);
  const size = alive.length >= 7 ? 3 : 2;
  const list: number[] = [];
  if (killer.role === 'framer') {
    // Planted evidence: the shortlist is all innocents.
    const pool = g.rng.shuffle(alive.filter((c) => c.team !== 'murder'));
    for (const c of pool.slice(0, size)) list.push(c.id);
  } else {
    list.push(killer.id);
    const pool = g.rng.shuffle(alive.filter((c) => c.id !== killer.id));
    for (const c of pool.slice(0, size - 1)) list.push(c.id);
  }
  return list.length ? g.rng.shuffle(list) : null;
}

export function createMeeting(g: Game, reporter: number, body: Body | null): Meeting {
  const n = g.chars.length;
  const alive = g.aliveChars();
  const order = g.rng.shuffle(alive.map((c) => c.id).filter((id) => id !== reporter));
  order.unshift(reporter);
  const m: Meeting = {
    kind: body ? 'body' : 'emergency',
    reporter,
    body,
    victim: body ? body.victim : -1,
    region: body ? body.region : -1,
    deathT: body ? body.t : g.time,
    newDead: g.chars.filter((c) => !c.alive && c.cause === 'murder' && c.deathT > g.lastMeetingT && (!body || c.id !== body.victim)).map((c) => c.id),
    order,
    pos: 0,
    round: 0,
    phase: 'discuss',
    feed: [],
    mt: [],
    heat: new Float32Array(n),
    whereClaims: new Map(),
    accusers: new Map(),
    defenders: new Map(),
    clues: new Map(),
    votes: new Int16Array(n).fill(-2),
    result: null,
  };
  for (let i = 0; i < n; i++) m.mt.push({ myRegion: -1, alibi: new Map(), scene: new Set(), withV: new Set(), nearBody: new Set(), caught: new Map(), falseAboutMe: new Map(), basis: new Map(), said: new Set(), defended: false });

  if (body) {
    const ago = Math.max(1, Math.round((g.time - body.t) / 5) * 5);
    m.feed.push(sys(`${N(reporter)} found ${N(body.victim)} dead in ${R(body.region)}. The body is ${ago <= 5 ? 'still warm' : `about ${ago} seconds cold`}.`));
  } else {
    m.feed.push(sys(`${N(reporter)} rang the emergency bell.`));
  }
  if (m.newDead.length) m.feed.push(sys(`${m.newDead.map(N).join(', ')} ${m.newDead.length > 1 ? 'are' : 'is'} missing and presumed dead.`));

  if (body) {
    for (const d of alive) {
      if (d.role !== 'detective') continue;
      const list = makeClue(g, body, d);
      if (!list) continue;
      d.mem.clues.push({ victim: body.victim, list });
      m.clues.set(d.id, list);
      if (d.isPlayer) m.feed.push(sys(`Your examination of the scene: the killer is one of ${list.map(N).join(', ')}. (Unless a Framer planted the evidence.)`, true));
    }
  }
  for (const c of alive) analyze(g, m, c);
  return m;
}

/** Turn a character's own memory into suspicion, given what the meeting just made public. */
function analyze(g: Game, m: Meeting, c: Char): void {
  const mem = c.mem;
  const mt = m.mt[c.id];
  const map = g.map;
  const td = m.deathT;
  const judge = c.team !== 'murder' && !c.isPlayer;
  const pers = c.brain?.pers;
  const ownW = pers?.ownW ?? 1;
  const forgot = (t: number) => !c.isPlayer && (g.time - t > g.tuning.memorySpan || g.rng.chance(g.tuning.evidenceMiss));
  const bump = (id: number, v: number, why?: Reason) => {
    if (!judge || mem.sure[id] !== 0) return;
    mem.susp[id] += v;
    if (why && !mt.basis.has(id)) mt.basis.set(id, why);
  };
  const mine = at(mem.mine, td, 4);
  mt.myRegion = mine >= 0 ? mine : g.regionOf(c);

  for (const k of mem.sawKill) if (g.chars[k.killer].alive) mt.basis.set(k.killer, 'witness');
  for (const a of mem.sawAttack) if (g.chars[a.attacker].alive && !mt.basis.has(a.attacker)) mt.basis.set(a.attacker, 'attack');

  if (m.body) {
    const victimSights = mem.sights[m.victim];
    const lastV = victimSights[victimSights.length - 1];
    const found = mem.bodies.get(m.body.id);
    for (const x of g.chars) {
      if (!x.alive || x === c) continue;
      const seen = at(mem.sights[x.id], td, 3.5);
      if (seen >= 0 && !forgot(td)) {
        if (sameArea(map, seen, m.region)) {
          mt.scene.add(x.id);
          bump(x.id, 1.3 * ownW * (1 + (pers?.paranoia ?? 0) * 0.4), 'scene');
        } else if (!near(map, seen, m.region) || at(mem.sights[x.id], td, 1) >= 0) {
          mt.alibi.set(x.id, seen);
          bump(x.id, -1.4 * ownW);
        }
      }
      if (lastV && td - lastV.t1 >= -1 && td - lastV.t1 < 9 && !mt.alibi.has(x.id) && !forgot(lastV.t1)) {
        const r = at(mem.sights[x.id], lastV.t1 - 1, 1.5);
        if (r >= 0 && sameArea(map, r, lastV.region)) mt.withV.add(x.id);
      }
      if (found && found.near.includes(x.id) && !mt.alibi.has(x.id)) {
        mt.nearBody.add(x.id);
        bump(x.id, 0.9 / found.near.filter((id) => g.chars[id].alive).length, 'nearBody');
      }
    }
  }
  // "Last seen with the victim" means little if half the house was there.
  if (mt.withV.size > 2) mt.withV.clear();
  for (const id of mt.withV) bump(id, 0.7 * ownW, 'withVictim');
  // People who vanished without a body: weaker version of "last seen with".
  for (const u of m.newDead) {
    const vs = mem.sights[u];
    const lastV = vs[vs.length - 1];
    if (!lastV || g.time - lastV.t1 > 40 || forgot(lastV.t1)) continue;
    for (const x of g.chars) {
      if (!x.alive || x === c) continue;
      const r = at(mem.sights[x.id], lastV.t1 - 1, 1.5);
      if (r >= 0 && sameArea(map, r, lastV.region)) bump(x.id, 0.5 * ownW, 'withVictim');
    }
  }
}

// ---------- wording ----------

function names(ids: number[]): string {
  return ids.map(N).join(', ');
}

function wording(g: Game, m: Meeting, s: Stmt): string {
  const v = (arr: string[]) => arr[(s.by * 7 + m.feed.length) % arr.length];
  const t = s.target ?? -1;
  const emergency = m.kind === 'emergency';
  switch (s.kind) {
    case 'where': {
      let out = emergency ? `I've been around ${R(s.region!)}.` : v([`I was in ${R(s.region!)}.`, `I was over in ${R(s.region!)} when it happened.`, `${R(s.region!)}. That's where I was.`]);
      if (m.mt[s.by].defended) out = `It wasn't me. ${out}`;
      if (!emergency && sameArea(g.map, s.region!, m.region) && s.by !== m.reporter) out += ` I didn't see who did it.`;
      if (s.vouch !== undefined) out += ` ${N(s.vouch)} can vouch for me.`;
      return out;
    }
    case 'saw':
      return sameArea(g.map, s.region!, m.region) && !emergency ? `${N(t)} was in ${R(s.region!)} right around when it happened.` : `I saw ${N(t)} in ${R(s.region!)} around then.`;
    case 'accuse':
      switch (s.reason) {
        case 'witness':
          return v([`I saw it happen. ${N(t)} killed ${N(s.victim ?? m.victim)}.`, `It was ${N(t)}! I watched them kill ${N(s.victim ?? m.victim)}.`]);
        case 'attack':
          return `${N(t)} went for ${s.victim !== undefined && s.victim !== s.by ? N(s.victim) : 'me'} with a blade. A ward stopped it, but I saw everything.`;
        case 'scene':
          return v([`${N(t)} was in ${R(m.region)} right when it happened.`, `I saw ${N(t)} at the scene. ${R(m.region)}, right at the time.`]);
        case 'withVictim':
          return `The last time I saw ${N(s.victim ?? m.victim)} alive, ${N(t)} was right there with them.`;
        case 'nearBody':
          return `${N(t)} was standing by the body when I got there, and said nothing.`;
        case 'lied':
          return `${N(t)} lied about where they were. Why lie?`;
        case 'agree':
          return v([`I agree. It's ${N(t)}.`, `That settles it for me. ${N(t)}.`]);
        default:
          return v([`I don't trust ${N(t)}.`, `Something is off about ${N(t)}.`, `Keep an eye on ${N(t)}.`]);
      }
    case 'defend':
      return v([`It can't be ${N(t)}. I saw them in ${R(s.region!)} when it happened.`, `${N(t)} was in ${R(s.region!)} at the time. I saw them.`]);
    case 'claim':
      if (s.role === 'detective' && s.clue?.length) return `I'm the Detective. The scene points to one of these: ${names(s.clue)}.`;
      return `I'm the ${ROLES[s.role!].name}.`;
    case 'contradict':
      return s.region2 !== undefined && s.region2 >= 0 ? `That's not true. I saw ${N(t)} in ${R(s.region!)}, not ${R(s.region2)}.` : `That's not true. I saw ${N(t)} in ${R(s.region!)}.`;
    case 'deny':
      return `${N(t)} is lying. I was never in ${R(s.region!)}.`;
    default:
      return s.text;
  }
}

// ---------- speaking and hearing ----------

export function say(g: Game, m: Meeting, s: Stmt): void {
  const mt = m.mt[s.by];
  if (s.kind === 'where' && (m.accusers.get(s.by)?.length ?? 0) > 0) mt.defended = true;
  s.text = wording(g, m, s);
  m.feed.push(s);
  const t = s.target ?? -1;
  if (s.kind === 'where') m.whereClaims.set(s.by, s.region!);
  if (s.kind === 'accuse') {
    if (!m.accusers.has(t)) m.accusers.set(t, []);
    m.accusers.get(t)!.push({ by: s.by, reason: s.reason! });
    m.heat[t] += STRONG(s.reason) ? 2 : s.reason === 'hunch' || s.reason === 'agree' ? 0.5 : 1;
  }
  if (s.kind === 'contradict') m.heat[t] += 1.2;
  if (s.kind === 'defend') {
    if (!m.defenders.has(t)) m.defenders.set(t, []);
    m.defenders.get(t)!.push(s.by);
    m.heat[t] -= 0.8;
  }
  if (s.kind === 'claim' && s.role === 'detective') {
    if (!g.detClaims.includes(s.by)) g.detClaims.push(s.by);
    for (const id of s.clue ?? []) m.heat[id] += 0.6;
  }
  for (const c of g.chars) if (c.alive && c.id !== s.by) hear(g, m, c, s);
}

function hear(g: Game, m: Meeting, L: Char, s: Stmt): void {
  const mem = L.mem;
  const mt = m.mt[L.id];
  const map = g.map;
  const by = s.by;
  const t = s.target ?? -1;
  const judge = L.team !== 'murder' && !L.isPlayer;
  const pers = L.brain?.pers;
  const ownW = pers?.ownW ?? 1;
  const trust = mem.sure[by] === 1 ? 0 : Math.max(0.1, Math.min(1, 1 - mem.susp[by] / 3)) * (pers?.trustW ?? 1);
  const add = (id: number, v: number) => {
    if (judge && mem.sure[id] === 0) mem.susp[id] += v;
  };

  switch (s.kind) {
    case 'accuse':
      if (t === L.id) {
        add(by, STRONG(s.reason) ? 4 : s.reason === 'hunch' || s.reason === 'agree' ? 0.2 : 0.6);
      } else if (mem.sure[t] === 1) {
        add(by, -0.8);
      } else if (STRONG(s.reason)) {
        if (s.reason === 'witness' && m.kind === 'body' && (s.victim ?? m.victim) === m.victim && mt.alibi.has(t)) add(by, 2.5 * ownW);
        else add(t, 2.6 * trust);
      } else if (s.reason === 'hunch' || s.reason === 'agree') {
        add(t, 0.35 * trust * (1 + (pers?.bandwagon ?? 0)));
      } else if (mt.alibi.has(t) && s.reason === 'scene') {
        add(by, 0.9);
      } else {
        add(t, 0.9 * trust);
      }
      break;
    case 'defend':
      if (mem.sure[t] === 1) add(by, 1.5);
      else if (t !== L.id) {
        add(t, -1.1 * trust);
        if (mt.scene.has(t)) add(by, 1.2);
      }
      break;
    case 'where': {
      const seen = at(mem.sights[by], m.deathT, 2);
      if (m.kind === 'body' && seen >= 0) {
        if (!near(map, seen, s.region!)) {
          mt.caught.set(by, seen);
          add(by, 1.5 * ownW);
        } else add(by, -0.5);
      } else if (s.vouch === L.id) add(by, 0.3);
      break;
    }
    case 'saw':
      if (t === L.id) {
        if (!near(map, mt.myRegion, s.region!)) {
          mt.falseAboutMe.set(by, s.region!);
          add(by, 2.5);
        }
      } else {
        const seen = at(mem.sights[t], m.deathT, 2);
        if (seen >= 0 && !near(map, seen, s.region!)) add(by, 1.2);
        else if (m.kind === 'body' && sameArea(map, s.region!, m.region)) add(t, 0.7 * trust);
      }
      break;
    case 'claim':
      if (s.role === 'detective') {
        const real = g.settings.roleCounts.detective ?? 0;
        if ((L.role === 'detective' && real <= 1) || real === 0) add(by, 4);
        else if (g.detClaims.length > real) add(by, 1.2);
        else {
          add(by, -0.6);
          for (const id of s.clue ?? []) if (id !== L.id) add(id, 1.0 * trust);
        }
      } else add(by, -0.15);
      break;
    case 'contradict':
      if (t === L.id) add(by, 2.5);
      else add(t, 1.1 * trust);
      break;
    case 'deny':
      add(t, 0.3 * trust);
      break;
  }
}

// ---------- what NPCs choose to say ----------

interface Opt {
  p: number;
  s: Stmt;
  key: string;
}

function stmt(by: number, kind: Stmt['kind'], extra: Partial<Stmt> = {}): Stmt {
  return { by, kind, text: '', ...extra };
}

function topSuspect(g: Game, c: Char): number {
  let best = -1;
  for (const x of g.chars) {
    if (!x.alive || x === c) continue;
    if (best < 0 || c.mem.susp[x.id] > c.mem.susp[best]) best = x.id;
  }
  return best;
}

function civilianOptions(g: Game, m: Meeting, c: Char): Opt[] {
  const mem = c.mem;
  const mt = m.mt[c.id];
  const pers = c.brain!.pers;
  const opts: Opt[] = [];
  const alive = (id: number) => g.chars[id].alive;

  for (const k of mem.sawKill) if (alive(k.killer)) opts.push({ p: 100, key: `acc${k.killer}`, s: stmt(c.id, 'accuse', { target: k.killer, reason: 'witness', victim: k.victim }) });
  for (const a of mem.sawAttack) if (alive(a.attacker)) opts.push({ p: 95, key: `acc${a.attacker}`, s: stmt(c.id, 'accuse', { target: a.attacker, reason: 'attack', victim: a.target }) });
  for (const [x, seen] of mt.caught) if (alive(x)) opts.push({ p: 88, key: `con${x}`, s: stmt(c.id, 'contradict', { target: x, region: seen, region2: m.whereClaims.get(x) }) });
  for (const [x, r] of mt.falseAboutMe) if (alive(x)) opts.push({ p: 86, key: `deny${x}`, s: stmt(c.id, 'deny', { target: x, region: r }) });

  const clue = m.clues.get(c.id);
  if (clue) opts.push({ p: 80, key: 'claim', s: stmt(c.id, 'claim', { role: 'detective', clue }) });

  const accusedMe = m.accusers.get(c.id) ?? [];
  if (accusedMe.length) {
    let vouch: number | undefined;
    for (const [x, r] of mt.alibi) if (alive(x) && sameArea(g.map, r, mt.myRegion)) vouch = x;
    opts.push({ p: 78, key: 'where', s: stmt(c.id, 'where', { region: mt.myRegion, vouch }) });
  }
  for (const [t, list] of m.accusers) {
    if (t !== c.id && alive(t) && list.length && mt.alibi.has(t)) opts.push({ p: 70, key: `def${t}`, s: stmt(c.id, 'defend', { target: t, region: mt.alibi.get(t) }) });
  }

  const top = topSuspect(g, c);
  if (top >= 0 && mem.sure[top] !== 1) {
    const su = mem.susp[top];
    const basis = mt.basis.get(top);
    const same = (m.accusers.get(top) ?? []).filter((a) => a.reason === basis).length;
    if (basis && su >= 1.0 && same < 2) opts.push({ p: 55 + su * 3, key: `acc${top}`, s: stmt(c.id, 'accuse', { target: top, reason: basis }) });
    else if (basis && su >= 1.0) opts.push({ p: 30, key: `acc${top}`, s: stmt(c.id, 'accuse', { target: top, reason: 'agree' }) });
    else if (su >= 1.8) opts.push({ p: 34, key: `acc${top}`, s: stmt(c.id, 'accuse', { target: top, reason: mt.caught.has(top) ? 'lied' : 'hunch' }) });
  }
  for (const x of mt.scene) if (alive(x)) opts.push({ p: 42, key: `acc${x}`, s: stmt(c.id, 'saw', { target: x, region: m.region }) });

  if (m.round === 1 && pers.bandwagon > 0.4) {
    let lead = -1;
    for (const x of g.chars) if (x.alive && x !== c && (lead < 0 || m.heat[x.id] > m.heat[lead])) lead = x.id;
    if (lead >= 0 && m.heat[lead] >= 2 && mem.susp[lead] > 0.3) opts.push({ p: 32, key: `acc${lead}`, s: stmt(c.id, 'accuse', { target: lead, reason: 'agree' }) });
  }
  if (m.kind === 'body' && m.round === 0) opts.push({ p: 20, key: 'where', s: stmt(c.id, 'where', { region: mt.myRegion }) });
  return opts;
}

function murdererOptions(g: Game, m: Meeting, c: Char): Opt[] {
  const mem = c.mem;
  const mt = m.mt[c.id];
  const pers = c.brain!.pers;
  const rng = g.rng;
  const cun = g.tuning.cunning;
  const opts: Opt[] = [];
  const innocent = (id: number) => g.chars[id].alive && g.chars[id].team !== 'murder';
  const accusedMe = m.accusers.get(c.id) ?? [];
  const strong = accusedMe.find((a) => STRONG(a.reason) && innocent(a.by));
  const isKiller = !!m.body && m.body.killer === c.id;
  // Who might have seen me around the time? (I only know who *I* saw.)
  const seenNear: number[] = [];
  if (m.body) for (const x of g.chars) if (innocent(x.id) && at(mem.sights[x.id], m.deathT, 6) >= 0) seenNear.push(x.id);

  // He-said-she-said: turn a direct accusation back on the accuser.
  if (strong) opts.push({ p: rng.chance(0.65) ? 92 : 40, key: `acc${strong.by}`, s: stmt(c.id, 'accuse', { target: strong.by, reason: 'witness', lie: true }) });

  // An alibi. Lying is safest when nobody was around; careless murderers lie anyway.
  if (m.kind === 'body') {
    let region = mt.myRegion;
    let lie = false;
    if (isKiller && (seenNear.length === 0 || !rng.chance(cun))) {
      const earlier = [...mem.mine].reverse().find((s) => s.t1 < m.deathT && s.region >= 0 && !sameArea(g.map, s.region, m.region));
      const rooms = g.map.rooms.filter((r) => r.kind !== 'junction' && !sameArea(g.map, r.id, m.region));
      region = earlier && rng.chance(0.3 + cun * 0.6) ? earlier.region : rng.pick(rooms).id;
      lie = true;
    }
    opts.push({ p: accusedMe.length ? 84 : isKiller ? 58 : 22, key: 'where', s: stmt(c.id, 'where', { region, lie }) });
  }

  // Point the room at somebody else.
  let lead = -1;
  for (const x of g.chars) if (innocent(x.id) && (lead < 0 || m.heat[x.id] > m.heat[lead])) lead = x.id;
  if (lead >= 0 && m.heat[lead] >= 1) {
    opts.push({ p: 50 + m.heat[lead] * 4, key: `acc${lead}`, s: stmt(c.id, 'accuse', { target: lead, reason: m.round === 1 ? 'agree' : 'hunch', lie: true }) });
  } else if (m.kind === 'body') {
    const atScene = [...mt.scene, ...mt.nearBody].filter(innocent);
    const pool = atScene.length ? atScene : seenNear;
    if (pool.length && rng.chance(0.4 + pers.bold * 0.5)) {
      const t = rng.pick(pool);
      const brazen = rng.chance(pers.bold * (1 - cun * 0.7));
      opts.push({ p: 54, key: `acc${t}`, s: stmt(c.id, 'accuse', { target: t, reason: brazen ? 'witness' : mt.scene.has(t) ? 'scene' : 'hunch', lie: true }) });
    }
  }

  // Quietly cover for a partner who is under light pressure.
  for (const [t, list] of m.accusers) {
    const p = g.chars[t];
    if (p.alive && p.team === 'murder' && p !== c && !list.some((a) => STRONG(a.reason)) && rng.chance(0.25)) {
      const rooms = g.map.rooms.filter((r) => r.kind !== 'junction' && !sameArea(g.map, r.id, m.region));
      opts.push({ p: 45, key: `def${t}`, s: stmt(c.id, 'defend', { target: t, region: rng.pick(rooms).id, lie: true }) });
    }
  }
  return opts;
}

function jesterOptions(g: Game, m: Meeting, c: Char): Opt[] {
  const rng = g.rng;
  const opts: Opt[] = [];
  const rooms = g.map.rooms.filter((r) => r.kind !== 'junction');
  const others = g.aliveChars().filter((x) => x !== c);
  if (g.meetingsHeld < 2) return opts; // behave at first; start stirring later
  if (m.kind === 'body' && rng.chance(0.1)) opts.push({ p: 60, key: 'where', s: stmt(c.id, 'where', { region: rng.chance(0.6) ? m.region : rng.pick(rooms).id, lie: true }) });
  if (others.length && rng.chance(0.08)) opts.push({ p: 65, key: 'accx', s: stmt(c.id, 'accuse', { target: rng.pick(others).id, reason: rng.chance(0.25) ? 'witness' : 'hunch', lie: true }) });
  return opts;
}

function npcStatement(g: Game, m: Meeting, c: Char): Stmt | null {
  const mt = m.mt[c.id];
  const pers = c.brain!.pers;
  const opts = (c.team === 'murder' ? murdererOptions(g, m, c) : c.role === 'jester' ? jesterOptions(g, m, c) : civilianOptions(g, m, c)).filter((o) => !mt.said.has(o.key));
  if (!opts.length) return null;
  opts.sort((a, b) => b.p - a.p);
  const o = opts[0];
  // Low-stakes chatter depends on temperament; important things always get said.
  if (o.p < 50 && !g.rng.chance(pers.speak * (m.round === 0 ? 0.75 : 0.5))) return null;
  mt.said.add(o.key);
  return o.s;
}

export function step(g: Game, m: Meeting): Step {
  for (;;) {
    if (m.pos >= m.order.length) {
      if (m.round === 0) {
        m.round = 1;
        m.pos = 0;
        continue;
      }
      m.phase = 'vote';
      return { type: 'vote' };
    }
    const c = g.chars[m.order[m.pos]];
    if (!c.alive) {
      m.pos++;
      continue;
    }
    if (c.isPlayer) return { type: 'player' };
    m.pos++;
    const s = npcStatement(g, m, c);
    if (!s) continue;
    say(g, m, s);
    return { type: 'stmt', stmt: s };
  }
}

// ---------- the player's side ----------

export interface PlayerOptions {
  emergency: boolean;
  whereTrue: number;
  rooms: number[];
  sawTrue: { who: number; region: number }[];
  witnessed: { killer: number; victim: number }[];
  attacks: { attacker: number; target: number }[];
  scene: number[];
  withVictim: number[];
  nearBody: number[];
  alibi: { who: number; region: number }[];
  caught: { who: number; region: number; claimed: number }[];
  accusedBy: number[];
  others: number[];
  clue: number[] | null;
  role: RoleId;
}

export function playerOptions(g: Game, m: Meeting): PlayerOptions {
  const p = g.player!;
  const mt = m.mt[p.id];
  const alive = (id: number) => g.chars[id].alive;
  const sawTrue: { who: number; region: number }[] = [];
  for (const x of g.chars) {
    if (!x.alive || x === p) continue;
    const r = at(p.mem.sights[x.id], m.deathT, m.kind === 'body' ? 5 : 12);
    if (r >= 0) sawTrue.push({ who: x.id, region: r });
  }
  return {
    emergency: m.kind === 'emergency',
    whereTrue: mt.myRegion,
    rooms: g.map.rooms.filter((r) => r.kind !== 'junction').map((r) => r.id),
    sawTrue,
    witnessed: p.mem.sawKill.filter((k) => alive(k.killer)).map((k) => ({ killer: k.killer, victim: k.victim })),
    attacks: p.mem.sawAttack.filter((a) => alive(a.attacker)).map((a) => ({ attacker: a.attacker, target: a.target })),
    scene: [...mt.scene].filter(alive),
    withVictim: [...mt.withV].filter(alive),
    nearBody: [...mt.nearBody].filter(alive),
    alibi: [...mt.alibi].filter(([id]) => alive(id)).map(([who, region]) => ({ who, region })),
    caught: [...mt.caught].filter(([id]) => alive(id)).map(([who, region]) => ({ who, region, claimed: m.whereClaims.get(who) ?? -1 })),
    accusedBy: (m.accusers.get(p.id) ?? []).map((a) => a.by),
    others: g.aliveChars().filter((c) => c !== p).map((c) => c.id),
    clue: m.clues.get(p.id) ?? null,
    role: p.role,
  };
}

export interface PlayerSpec {
  kind: 'where' | 'saw' | 'accuse' | 'defend' | 'claim' | 'contradict' | 'pass';
  target?: number;
  region?: number;
  reason?: Reason;
  role?: RoleId;
  clue?: number[];
}

/** Is this statement consistent with what the player actually experienced? */
export function specIsLie(g: Game, m: Meeting, spec: PlayerSpec): boolean {
  const p = g.player!;
  const mt = m.mt[p.id];
  const t = spec.target ?? -1;
  switch (spec.kind) {
    case 'where':
      return !sameArea(g.map, spec.region!, mt.myRegion);
    case 'saw': {
      const r = at(p.mem.sights[t], m.deathT, m.kind === 'body' ? 5 : 12);
      return r < 0 || !sameArea(g.map, r, spec.region!);
    }
    case 'accuse':
      if (spec.reason === 'witness') return !p.mem.sawKill.some((k) => k.killer === t);
      if (spec.reason === 'attack') return !p.mem.sawAttack.some((a) => a.attacker === t);
      if (spec.reason === 'scene') return !mt.scene.has(t);
      if (spec.reason === 'withVictim') return !mt.withV.has(t);
      if (spec.reason === 'nearBody') return !mt.nearBody.has(t);
      if (spec.reason === 'lied') return !mt.caught.has(t);
      return false;
    case 'defend':
      return !mt.alibi.has(t);
    case 'claim':
      return spec.role !== p.role;
    case 'contradict':
      return !mt.caught.has(t);
    default:
      return false;
  }
}

export function playerSay(g: Game, m: Meeting, spec: PlayerSpec): Stmt | null {
  const p = g.player!;
  m.pos++;
  if (spec.kind === 'pass') return null;
  const s = stmt(p.id, spec.kind, { target: spec.target, region: spec.region, reason: spec.reason, role: spec.role, clue: spec.clue, lie: specIsLie(g, m, spec) });
  if (spec.kind === 'accuse' && spec.reason === 'witness') s.victim = p.mem.sawKill.find((k) => k.killer === spec.target)?.victim ?? (m.victim >= 0 ? m.victim : m.newDead[0]);
  if (spec.kind === 'accuse' && spec.reason === 'attack') s.victim = p.mem.sawAttack.find((a) => a.attacker === spec.target)?.target;
  if (spec.kind === 'contradict') s.region2 = m.whereClaims.get(spec.target!);
  say(g, m, s);
  return s;
}

// ---------- voting ----------

function npcVote(g: Game, m: Meeting, c: Char): number {
  const rng = g.rng;
  const alive = g.aliveChars().filter((x) => x !== c);
  if (c.role === 'jester') return rng.chance(0.5) ? rng.pick(alive).id : -1;
  if (c.team === 'murder') {
    const innocents = alive.filter((x) => x.team !== 'murder');
    if (!innocents.length) return -1;
    let lead = innocents[0];
    for (const x of innocents) if (m.heat[x.id] > m.heat[lead.id]) lead = x;
    const { murder, others } = g.counts();
    if (others - 1 <= murder) return lead.id; // one more ejection wins it: vote together
    const strong = (m.accusers.get(c.id) ?? []).find((a) => STRONG(a.reason) && g.chars[a.by].alive && g.chars[a.by].team !== 'murder');
    if (strong && m.heat[lead.id] < 2) return strong.by;
    return m.heat[lead.id] >= 1.5 ? lead.id : -1;
  }
  const pers = c.brain!.pers;
  let best = -1;
  let bs = -Infinity;
  for (const x of alive) {
    const sc = c.mem.sure[x.id] === 1 ? 99 : c.mem.susp[x.id] + pers.bandwagon * 0.25 * Math.max(0, m.heat[x.id]);
    if (sc > bs) {
      bs = sc;
      best = x.id;
    }
  }
  let threshold = pers.voteT + g.tuning.voteShift;
  if (g.aliveChars().length <= 5) threshold -= 0.5;
  return bs >= threshold ? best : -1;
}

export function runVote(g: Game, m: Meeting, playerVote: number | null): void {
  const tally = new Map<number, number>();
  for (const c of g.aliveChars()) {
    const v = c.isPlayer ? playerVote ?? -1 : npcVote(g, m, c);
    m.votes[c.id] = v;
    tally.set(v, (tally.get(v) ?? 0) + (c.role === 'magistrate' ? 2 : 1));
  }
  const sorted = [...tally].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
  const tie = sorted.length > 1 && sorted[0].votes === sorted[1].votes;
  const ejected = !tie && sorted[0].id >= 0 ? sorted[0].id : -1;
  m.result = { ejected, tie, tally: sorted };
  m.phase = 'result';
  if (ejected >= 0) g.eject(ejected);
  else g.emit({ kind: 'noeject', t: g.time, text: tie ? 'The vote was tied. Nobody was voted out.' : 'The room voted to skip. Nobody was voted out.' });
}

/** After the result: everyone draws conclusions from how it went, then play resumes. */
export function finishMeeting(g: Game, m: Meeting): void {
  const ej = m.result?.ejected ?? -1;
  for (const L of g.chars) {
    if (!L.alive || L.isPlayer || L.team === 'murder') continue;
    const mem = L.mem;
    const add = (id: number, v: number) => {
      if (id !== L.id && mem.sure[id] === 0) mem.susp[id] += v;
    };
    if (ej >= 0 && g.settings.revealRoles) {
      const guilty = g.chars[ej].team === 'murder';
      for (const a of m.accusers.get(ej) ?? []) add(a.by, guilty ? -0.7 : STRONG(a.reason) ? 3.5 : 0.3);
      for (const d of m.defenders.get(ej) ?? []) add(d, guilty ? 0.9 : -0.2);
      for (const c of g.chars) if (c.alive && m.votes[c.id] === ej) add(c.id, guilty ? -0.3 : 0.15);
    }
    for (let i = 0; i < mem.susp.length; i++) {
      if (mem.sure[i] === 1) mem.susp[i] = 10;
      else if (mem.sure[i] === -1) mem.susp[i] = -3;
      else mem.susp[i] = Math.max(-3, Math.min(8, mem.susp[i] * 0.65));
    }
  }
  g.endMeeting();
}

/** Headless / spectator: run a whole meeting with no player input. */
export function autoMeeting(g: Game): void {
  const m = g.meeting!;
  while (step(g, m).type !== 'vote');
  runVote(g, m, null);
  finishMeeting(g, m);
}
