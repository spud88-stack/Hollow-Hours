import { Rng, hashSeed } from './rng';
import { CAST, CIV_SPECIALS, DIFFICULTY, ROLES, sanitizeSettings, type DifficultyTuning, type RoleId, type Settings, type Team } from './defs';
import { CORRIDOR_BASE, DOOR, GameMap, UNREACHABLE, generateMap, type Station } from './map';
import { THEME_IDS, type ThemeId } from './themes';
import { makeBrain, onPerceive, updateBrain, onSabotage, type Brain } from './ai';
import { createMeeting, type Meeting } from './meeting';

export interface Sight {
  region: number;
  t0: number;
  t1: number;
  task: boolean;
}

export interface Memory {
  sights: Sight[][]; // per character: stretches of time I had them in view, and where
  mine: Sight[]; // where I was
  bodies: Map<number, { t: number; near: number[] }>;
  sawKill: { killer: number; victim: number; t: number }[];
  sawAttack: { attacker: number; target: number; t: number }[];
  susp: Float32Array;
  sure: Int8Array; // 1 = I know they are a murderer, -1 = I know they are not
  clues: { victim: number; list: number[] }[];
}

export interface Action {
  kind: 'task' | 'fake' | 'fix' | 'clean';
  station?: number;
  body?: number;
  t: number;
  dur: number;
}

export interface Char {
  id: number;
  name: string;
  color: string;
  role: RoleId;
  team: Team;
  isPlayer: boolean;
  alive: boolean;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  wp: number; // NPC waypoint tile, -1 if none
  killCd: number;
  abilityCd: number;
  shots: number;
  wardTarget: number;
  wardBy: number;
  emergencyLeft: number;
  tasks: number[];
  tasksTotal: number;
  action: Action | null;
  visible: number[];
  visibleBodies: number[];
  percT: number;
  mem: Memory;
  brain: Brain | null;
  deathT: number;
  killedBy: number;
  cause: '' | 'murder' | 'ejected' | 'shot' | 'misfire';
  kills: number;
}

export interface Body {
  id: number;
  victim: number;
  killer: number;
  x: number;
  y: number;
  region: number;
  t: number;
  gone: boolean;
}

export type Winner = 'civ' | 'murder' | 'jester' | null;

export interface GameEvent {
  kind: 'kill' | 'report' | 'emergency' | 'eject' | 'noeject' | 'sabotage' | 'fixed' | 'save' | 'shot' | 'clean' | 'task' | 'end' | 'witness' | 'ward' | 'wardbreak';
  t: number;
  a?: number;
  b?: number;
  region?: number;
  x?: number;
  y?: number;
  text: string;
  what?: string;
}

export const KILL_RANGE = 1.5;
export const USE_RANGE = 1.3;
export const REPORT_RANGE = 2.4;
export const SPEED = 3.7;
const RADIUS = 0.3;

export const N = (id: number) => `{c${id}}`;
export const R = (reg: number) => `{r${reg}}`;

export class Game {
  settings: Settings;
  tuning: DifficultyTuning;
  seedText: string;
  rng: Rng;
  map: GameMap;
  chars: Char[] = [];
  bodies: Body[] = [];
  playerId: number;
  time = 0;
  state: 'play' | 'meeting' | 'over' = 'play';
  winner: Winner = null;
  winReason = '';
  meeting: Meeting | null = null;
  lastMeetingT = 0;
  meetingsHeld = 0;
  lightsUntil = 0;
  critical: { until: number; total: number } | null = null;
  sabCd = 25;
  events: GameEvent[] = []; // drained by the UI every frame
  log: GameEvent[] = []; // kept for the recap
  input = { x: 0, y: 0 };
  detClaims: number[] = [];
  publicInnocent = new Set<number>();

  constructor(settings: Settings, seedText: string, opts: { hasPlayer: boolean }) {
    this.settings = sanitizeSettings(settings);
    this.tuning = DIFFICULTY[this.settings.difficulty];
    this.seedText = seedText;
    const seed = hashSeed(seedText);
    this.rng = new Rng(seed ^ 0x9e3779b9);
    const mapRng = new Rng(seed);
    const theme: ThemeId = this.settings.theme === 'random' ? mapRng.pick(THEME_IDS) : this.settings.theme;
    this.map = generateMap(mapRng.int(1, 2 ** 31 - 1), theme, this.settings.size);
    this.playerId = opts.hasPlayer ? 0 : -1;
    this.setupCast();
  }

  get player(): Char | null {
    return this.playerId >= 0 ? this.chars[this.playerId] : null;
  }

  private setupCast(): void {
    const s = this.settings;
    const total = s.npcCount + 1;
    const rng = this.rng;
    const cast = rng.shuffle([...CAST]).slice(0, total);

    // Build the role deck.
    const variants: RoleId[] = [];
    for (let i = 0; i < s.murderers; i++) variants.push('killer');
    if (s.murdererVariants) {
      const pool = rng.shuffle<RoleId>(['cleaner', 'framer', 'killer']);
      for (let i = 0; i < s.murderers; i++) variants[i] = pool[i % pool.length];
    }
    const deck: RoleId[] = [...variants];
    for (const r of [...CIV_SPECIALS, 'jester'] as RoleId[]) for (let i = 0; i < (s.roleCounts[r] ?? 0); i++) deck.push(r);
    while (deck.length < total) deck.push('civilian');
    rng.shuffle(deck);
    // Honour the player's preferred role if the deck contains it (any murderer variant counts for "killer").
    if (this.playerId >= 0 && s.preferredRole !== 'random') {
      let k = deck.indexOf(s.preferredRole);
      if (k < 0 && ROLES[s.preferredRole].team === 'murder') {
        k = deck.findIndex((r) => ROLES[r].team === 'murder');
        if (k >= 0 && s.murdererVariants) deck[k] = s.preferredRole;
      }
      if (k >= 0) [deck[0], deck[k]] = [deck[k], deck[0]];
    }

    const hub = this.map.rooms[this.map.hub];
    const spots = this.spawnSpots(total);
    const taskStations = this.map.stationsOfKind('task');
    for (let i = 0; i < total; i++) {
      const role = deck[i];
      const team = ROLES[role].team;
      const tasks: number[] = [];
      if (team === 'civ') {
        const pool = rng.shuffle(taskStations.map((t) => t.id));
        for (let k = 0; k < Math.min(s.tasks, pool.length); k++) tasks.push(pool[k]);
      }
      const c: Char = {
        id: i,
        name: cast[i].name,
        color: cast[i].color,
        role,
        team,
        isPlayer: i === this.playerId,
        alive: true,
        x: spots[i].x,
        y: spots[i].y,
        dir: Math.atan2(hub.cy + 0.5 - spots[i].y, hub.cx + 0.5 - spots[i].x),
        moving: false,
        wp: -1,
        killCd: team === 'murder' ? s.killCooldown * 0.75 : 0,
        abilityCd: role === 'medic' ? 5 : 0,
        shots: role === 'vigilante' ? 1 : 0,
        wardTarget: -1,
        wardBy: -1,
        emergencyLeft: 1,
        tasks,
        tasksTotal: tasks.length,
        action: null,
        visible: [],
        visibleBodies: [],
        percT: rng.next() * 0.3,
        mem: {
          sights: Array.from({ length: total }, () => []),
          mine: [],
          bodies: new Map(),
          sawKill: [],
          sawAttack: [],
          susp: new Float32Array(total),
          sure: new Int8Array(total),
          clues: [],
        },
        brain: null,
        deathT: -1,
        killedBy: -1,
        cause: '',
        kills: 0,
      };
      this.chars.push(c);
    }
    for (const c of this.chars) {
      if (!c.isPlayer) c.brain = makeBrain(this, c);
      if (c.team === 'murder') for (const o of this.chars) if (o.team === 'murder') c.mem.sure[o.id] = -1;
    }
  }

  spawnSpots(n: number): { x: number; y: number }[] {
    const m = this.map;
    const hub = m.rooms[m.hub];
    const tiles = hub.floor
      .filter((t) => t !== hub.cy * m.w + hub.cx)
      .map((t) => ({ x: (t % m.w) + 0.5, y: Math.floor(t / m.w) + 0.5 }))
      .sort((a, b) => Math.hypot(a.x - hub.cx - 0.5, a.y - hub.cy - 0.5) - Math.hypot(b.x - hub.cx - 0.5, b.y - hub.cy - 0.5));
    // Prefer a loose checkerboard so people are not standing on each other's toes.
    const spaced = tiles.filter((t) => (Math.floor(t.x) + Math.floor(t.y)) % 2 === 0);
    const pool = spaced.length >= n ? spaced : tiles;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
    return out;
  }

  // ---------- queries ----------

  lightsOut(): boolean {
    return this.time < this.lightsUntil;
  }

  visionOf(c: Char): number {
    if (this.lightsOut() && c.team !== 'murder' && c.role !== 'engineer') return 2.6;
    return this.settings.vision * (c.role === 'lookout' ? 1.4 : 1);
  }

  canSeePoint(c: Char, x: number, y: number): boolean {
    const d = Math.hypot(x - c.x, y - c.y);
    return d <= this.visionOf(c) && this.map.los(c.x, c.y, x, y);
  }

  regionOf(c: Char): number {
    return this.map.regionAt(c.x, c.y);
  }

  aliveChars(): Char[] {
    return this.chars.filter((c) => c.alive);
  }

  counts(): { murder: number; others: number } {
    let murder = 0;
    let others = 0;
    for (const c of this.chars) if (c.alive) c.team === 'murder' ? murder++ : others++;
    return { murder, others };
  }

  taskProgress(): { done: number; total: number } {
    let done = 0;
    let total = 0;
    for (const c of this.chars) {
      if (c.team !== 'civ') continue;
      const d = c.tasksTotal - c.tasks.length;
      done += d;
      total += c.alive ? c.tasksTotal : d;
    }
    return { done, total };
  }

  station(id: number): Station {
    return this.map.stations[id];
  }

  nearStation(c: Char, st: Station): boolean {
    return Math.hypot(st.x + 0.5 - c.x, st.y + 0.5 - c.y) <= USE_RANGE;
  }

  activeBodies(): Body[] {
    return this.bodies.filter((b) => !b.gone);
  }

  emit(e: GameEvent, keep = true): void {
    this.events.push(e);
    if (keep) this.log.push(e);
  }

  // ---------- main loop ----------

  update(dt: number): void {
    if (this.state !== 'play') return;
    this.time += dt;
    const m = this.map;

    for (const d of m.doors) {
      if (d.lockedUntil && this.time >= d.lockedUntil) {
        d.lockedUntil = 0;
        m.setDoorLocked(d, false);
      }
    }
    if (this.sabCd > 0) this.sabCd -= dt;
    if (this.critical && this.time >= this.critical.until) {
      this.finish('murder', `${m.theme.critical} was never repaired.`);
      return;
    }

    for (const c of this.chars) {
      if (!c.alive) continue;
      if (c.killCd > 0) c.killCd -= dt;
      if (c.abilityCd > 0) c.abilityCd -= dt;
      c.moving = false;
      if (c.isPlayer) this.movePlayer(c, dt);
      else updateBrain(this, c, dt);
      if (this.state !== 'play') return;
      if (c.action) this.tickAction(c, dt);
      c.percT -= dt;
      if (c.percT <= 0) {
        c.percT = c.isPlayer ? 0.1 : this.tuning.percInterval;
        this.perceive(c);
        if (!c.isPlayer) onPerceive(this, c);
        if (this.state !== 'play') return;
      }
    }
  }

  private blockedFor(c: Char, x: number, y: number): boolean {
    const m = this.map;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!m.inb(tx, ty)) return true;
    const i = ty * m.w + tx;
    if (!m.blockMove[i]) return false;
    return !(c.role === 'engineer' && m.tiles[i] === DOOR);
  }

  private hits(c: Char, x: number, y: number): boolean {
    return this.blockedFor(c, x - RADIUS, y - RADIUS) || this.blockedFor(c, x + RADIUS, y - RADIUS) || this.blockedFor(c, x - RADIUS, y + RADIUS) || this.blockedFor(c, x + RADIUS, y + RADIUS);
  }

  private movePlayer(c: Char, dt: number): void {
    let { x: ix, y: iy } = this.input;
    const len = Math.hypot(ix, iy);
    if (len < 0.01) return;
    ix /= len;
    iy /= len;
    if (c.action) this.cancelAction(c);
    const step = SPEED * 1.04 * dt;
    const stuck = this.hits(c, c.x, c.y); // e.g. a door locked on top of us: let the player walk out
    const nx = c.x + ix * step;
    if (stuck || !this.hits(c, nx, c.y)) c.x = nx;
    const ny = c.y + iy * step;
    if (stuck || !this.hits(c, c.x, ny)) c.y = ny;
    c.dir = Math.atan2(iy, ix);
    c.moving = true;
  }

  /** Walk an NPC one step down a distance field. Returns true once it stands on the target tile. */
  stepField(c: Char, f: Uint16Array, dt: number): boolean {
    const m = this.map;
    let budget = SPEED * dt;
    for (let guard = 0; guard < 4 && budget > 1e-6; guard++) {
      const tx = Math.floor(c.x);
      const ty = Math.floor(c.y);
      const here = ty * m.w + tx;
      if (c.wp < 0) {
        if (f[here] === 0) {
          c.wp = here;
        } else if (f[here] === UNREACHABLE) {
          return true;
        } else {
          let best = -1;
          let bd = f[here];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = tx + dx;
              const ny = ty + dy;
              if (!m.inb(nx, ny)) continue;
              const ni = ny * m.w + nx;
              if (f[ni] >= bd) continue;
              if (dx && dy && (f[ty * m.w + nx] === UNREACHABLE || f[ny * m.w + tx] === UNREACHABLE)) continue;
              bd = f[ni];
              best = ni;
            }
          }
          if (best < 0) return true;
          c.wp = best;
        }
      }
      const wx = (c.wp % m.w) + 0.5;
      const wy = Math.floor(c.wp / m.w) + 0.5;
      // Locked door ahead: wait for it (engineers walk straight through).
      if (m.blockMove[c.wp] && c.wp !== here && c.role !== 'engineer') return false;
      const dx = wx - c.x;
      const dy = wy - c.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-4) {
        c.dir = Math.atan2(dy, dx);
        c.moving = true;
      }
      if (d <= budget) {
        c.x = wx;
        c.y = wy;
        budget -= d;
        const arrived = f[c.wp] === 0;
        c.wp = -1;
        if (arrived) return true;
      } else {
        c.x += (dx / d) * budget;
        c.y += (dy / d) * budget;
        budget = 0;
      }
    }
    return false;
  }

  private perceive(c: Char): void {
    const m = this.map;
    const t = this.time;
    const mem = c.mem;
    const note = (list: Sight[], region: number, task: boolean) => {
      const last = list[list.length - 1];
      if (last && last.region === region && t - last.t1 < 1.2) {
        last.t1 = t;
        if (task) last.task = true;
      } else {
        list.push({ region, t0: t, t1: t, task });
        if (list.length > 14) list.shift();
      }
    };
    note(mem.mine, this.regionOf(c), false);
    c.visible.length = 0;
    for (const o of this.chars) {
      if (o === c || !o.alive) continue;
      if (!this.canSeePoint(c, o.x, o.y)) continue;
      c.visible.push(o.id);
      note(mem.sights[o.id], this.regionOf(o), !!o.action && (o.action.kind === 'task' || o.action.kind === 'fake'));
    }
    c.visibleBodies.length = 0;
    for (const b of this.bodies) {
      if (b.gone || !this.canSeePoint(c, b.x, b.y)) continue;
      c.visibleBodies.push(b.id);
      if (!mem.bodies.has(b.id)) {
        const near = c.visible.filter((id) => Math.hypot(this.chars[id].x - b.x, this.chars[id].y - b.y) < 4.5);
        mem.bodies.set(b.id, { t, near });
      }
    }
  }

  // ---------- actions ----------

  startAction(c: Char, a: Action): void {
    c.action = a;
    c.wp = -1;
  }

  cancelAction(c: Char): void {
    c.action = null;
  }

  private tickAction(c: Char, dt: number): void {
    const a = c.action!;
    if (a.kind === 'fix') {
      const st = this.station(a.station!);
      const live = st.kind === 'critical' ? !!this.critical : this.lightsOut();
      if (!live) {
        c.action = null;
        return;
      }
    }
    if (a.kind === 'clean') {
      const b = this.bodies[a.body!];
      if (!b || b.gone) {
        c.action = null;
        return;
      }
    }
    a.t += dt;
    if (a.t < a.dur) return;
    c.action = null;
    if (a.kind === 'task') this.completeTask(c, a.station!);
    else if (a.kind === 'fix') this.completeFix(c, this.station(a.station!));
    else if (a.kind === 'clean') {
      const b = this.bodies[a.body!];
      b.gone = true;
      c.abilityCd = 30;
      this.emit({ kind: 'clean', t: this.time, a: c.id, b: b.victim, region: b.region, x: b.x, y: b.y, text: `${N(c.id)} disposed of ${N(b.victim)}'s body in ${R(b.region)}.` });
    }
  }

  completeTask(c: Char, stationId: number): void {
    const k = c.tasks.indexOf(stationId);
    if (k < 0) return;
    c.tasks.splice(k, 1);
    c.action = null;
    this.emit({ kind: 'task', t: this.time, a: c.id, text: '' }, false);
    this.checkWin();
  }

  fixDuration(c: Char, st: Station): number {
    const base = st.kind === 'critical' ? 4 : 3;
    return c.role === 'engineer' ? base / 3 : base;
  }

  private completeFix(c: Char, st: Station): void {
    if (st.kind === 'critical' && this.critical) {
      this.critical = null;
      this.emit({ kind: 'fixed', t: this.time, a: c.id, what: 'critical', text: `${N(c.id)} repaired the ${st.name}.` });
    } else if (st.kind === 'breaker' && this.lightsOut()) {
      this.lightsUntil = 0;
      this.emit({ kind: 'fixed', t: this.time, a: c.id, what: 'lights', text: `${N(c.id)} restored the lights.` });
    }
  }

  canKill(k: Char, v: Char): boolean {
    return k.alive && v.alive && k.team === 'murder' && v.team !== 'murder' && k.killCd <= 0 && Math.hypot(k.x - v.x, k.y - v.y) <= KILL_RANGE && this.map.los(k.x, k.y, v.x, v.y);
  }

  tryKill(k: Char, v: Char): 'killed' | 'blocked' | 'no' {
    if (this.state !== 'play' || !this.canKill(k, v)) return 'no';
    k.action = null;
    const witnesses = this.chars.filter((w) => w.alive && w !== k && w !== v && w.team !== 'murder' && this.canSeePoint(w, k.x, k.y));
    if (v.wardBy >= 0) {
      const medic = this.chars[v.wardBy];
      v.wardBy = -1;
      if (medic.alive) {
        medic.wardTarget = -1;
        medic.abilityCd = 20;
      }
      k.killCd = this.settings.killCooldown * 0.6;
      for (const w of [...witnesses, v]) {
        w.mem.sawAttack.push({ attacker: k.id, target: v.id, t: this.time });
        w.mem.sure[k.id] = 1;
        w.mem.susp[k.id] = 10;
      }
      this.emit({ kind: 'save', t: this.time, a: k.id, b: v.id, region: this.regionOf(v), x: v.x, y: v.y, text: `${N(k.id)} attacked ${N(v.id)} in ${R(this.regionOf(v))}, but a Medic's ward held.` });
      return 'blocked';
    }
    k.killCd = this.settings.killCooldown;
    k.kills++;
    for (const w of witnesses) {
      w.mem.sawKill.push({ killer: k.id, victim: v.id, t: this.time });
      w.mem.sure[k.id] = 1;
      w.mem.susp[k.id] = 10;
      if (w.isPlayer) this.emit({ kind: 'witness', t: this.time, a: k.id, b: v.id, text: `You saw ${N(k.id)} kill ${N(v.id)}!` }, false);
    }
    const region = this.regionOf(v);
    this.die(v, k.id, 'murder');
    this.bodies.push({ id: this.bodies.length, victim: v.id, killer: k.id, x: v.x, y: v.y, region, t: this.time, gone: false });
    this.emit({ kind: 'kill', t: this.time, a: k.id, b: v.id, region, x: v.x, y: v.y, text: `${N(k.id)} killed ${N(v.id)} in ${R(region)}${witnesses.length ? ` (seen by ${witnesses.map((w) => N(w.id)).join(', ')})` : ''}.` });
    this.checkWin();
    return 'killed';
  }

  private die(v: Char, by: number, cause: Char['cause']): void {
    v.alive = false;
    v.deathT = this.time;
    v.killedBy = by;
    v.cause = cause;
    v.action = null;
    if (v.wardTarget >= 0) {
      this.chars[v.wardTarget].wardBy = -1;
      v.wardTarget = -1;
    }
    if (v.wardBy >= 0) {
      this.chars[v.wardBy].wardTarget = -1;
      v.wardBy = -1;
    }
  }

  canWard(c: Char, t: Char): boolean {
    return c.alive && t.alive && c !== t && c.role === 'medic' && c.abilityCd <= 0 && Math.hypot(c.x - t.x, c.y - t.y) <= 2.2 && this.map.los(c.x, c.y, t.x, t.y);
  }

  ward(c: Char, t: Char): boolean {
    if (!this.canWard(c, t)) return false;
    if (c.wardTarget >= 0) this.chars[c.wardTarget].wardBy = -1;
    if (t.wardBy >= 0) this.chars[t.wardBy].wardTarget = -1;
    c.wardTarget = t.id;
    t.wardBy = c.id;
    c.abilityCd = 25;
    this.emit({ kind: 'ward', t: this.time, a: c.id, b: t.id, text: '' }, false);
    return true;
  }

  canShoot(c: Char, t: Char): boolean {
    return c.alive && t.alive && c !== t && c.role === 'vigilante' && c.shots > 0 && Math.hypot(c.x - t.x, c.y - t.y) <= 3.2 && this.map.los(c.x, c.y, t.x, t.y);
  }

  /** The Vigilante's shot is loud: everyone learns the outcome immediately. */
  shoot(c: Char, t: Char): boolean {
    if (this.state !== 'play' || !this.canShoot(c, t)) return false;
    c.shots = 0;
    c.action = null;
    const region = this.regionOf(t);
    if (t.team === 'civ') {
      this.die(c, c.id, 'misfire');
      this.emit({ kind: 'shot', t: this.time, a: c.id, b: t.id, region, x: c.x, y: c.y, what: 'miss', text: `${N(c.id)}, the Vigilante, drew on ${N(t.id)}, who was innocent. ${N(c.id)} paid for the mistake.` });
      this.publicInnocent.add(t.id);
    } else {
      this.die(t, c.id, 'shot');
      this.publicInnocent.add(c.id);
      this.emit({ kind: 'shot', t: this.time, a: c.id, b: t.id, region, x: t.x, y: t.y, what: 'hit', text: `${N(c.id)}, the Vigilante, shot ${N(t.id)}, who was ${t.team === 'murder' ? 'a murderer' : 'the Jester'}.` });
    }
    for (const o of this.chars) {
      for (const id of this.publicInnocent) {
        o.mem.sure[id] = -1;
        o.mem.susp[id] = -3;
      }
    }
    this.checkWin();
    return true;
  }

  canReport(c: Char, b: Body): boolean {
    return c.alive && !b.gone && Math.hypot(c.x - b.x, c.y - b.y) <= REPORT_RANGE && this.map.los(c.x, c.y, b.x, b.y);
  }

  report(c: Char, b: Body): boolean {
    if (this.state !== 'play' || !this.canReport(c, b)) return false;
    this.startMeeting(c.id, b);
    return true;
  }

  canCallEmergency(c: Char): boolean {
    return c.alive && c.emergencyLeft > 0 && !this.critical && this.time - this.lastMeetingT >= 15 && this.nearStation(c, this.station(0));
  }

  callEmergency(c: Char): boolean {
    if (this.state !== 'play' || !this.canCallEmergency(c)) return false;
    c.emergencyLeft--;
    this.startMeeting(c.id, null);
    return true;
  }

  canClean(c: Char, b: Body): boolean {
    return c.alive && c.role === 'cleaner' && c.abilityCd <= 0 && !b.gone && Math.hypot(c.x - b.x, c.y - b.y) <= 1.6;
  }

  canSabotage(c: Char): boolean {
    return c.alive && c.team === 'murder' && this.sabCd <= 0 && !this.critical && !this.lightsOut();
  }

  sabotage(c: Char, kind: 'lights' | 'doors' | 'critical'): boolean {
    if (this.state !== 'play' || !this.canSabotage(c)) return false;
    const m = this.map;
    if (kind === 'lights') {
      this.lightsUntil = this.time + 24;
      this.sabCd = 45;
      this.emit({ kind: 'sabotage', t: this.time, a: c.id, what: 'lights', text: `${N(c.id)} cut the lights.` });
    } else if (kind === 'critical') {
      const total = { small: 38, medium: 46, large: 56 }[this.settings.size];
      this.critical = { until: this.time + total, total };
      this.sabCd = total + 40;
      this.emit({ kind: 'sabotage', t: this.time, a: c.id, what: 'critical', text: `${N(c.id)} sabotaged the ${m.theme.critical}.` });
    } else {
      let reg = this.regionOf(c);
      if (reg >= CORRIDOR_BASE || reg < 0) {
        // In a corridor: lock the nearer of the two rooms it joins.
        const ends = reg >= CORRIDOR_BASE ? [m.corridors[reg - CORRIDOR_BASE].a, m.corridors[reg - CORRIDOR_BASE].b] : [m.hub];
        ends.sort((a, b) => Math.hypot(m.rooms[a].cx - c.x, m.rooms[a].cy - c.y) - Math.hypot(m.rooms[b].cx - c.x, m.rooms[b].cy - c.y));
        reg = ends[0];
      }
      const room = m.rooms[reg];
      if (!room.doors.length) return false;
      for (const id of room.doors) {
        m.doors[id].lockedUntil = this.time + 10;
        m.setDoorLocked(m.doors[id], true);
      }
      this.sabCd = 28;
      this.emit({ kind: 'sabotage', t: this.time, a: c.id, what: 'doors', region: reg, text: `${N(c.id)} locked the doors of ${R(reg)}.` });
    }
    for (const o of this.chars) if (o.alive && o.brain) onSabotage(this, o, kind);
    return true;
  }

  // ---------- meetings ----------

  startMeeting(reporter: number, body: Body | null): void {
    this.state = 'meeting';
    for (const c of this.chars) {
      c.action = null;
      c.wp = -1;
    }
    this.lightsUntil = 0;
    this.critical = null;
    for (const d of this.map.doors) {
      if (d.lockedUntil) {
        d.lockedUntil = 0;
        this.map.setDoorLocked(d, false);
      }
    }
    this.meetingsHeld++;
    const reg = body ? body.region : -1;
    this.emit(
      body
        ? { kind: 'report', t: this.time, a: reporter, b: body.victim, region: reg, x: body.x, y: body.y, text: `${N(reporter)} reported ${N(body.victim)}'s body in ${R(reg)}.` }
        : { kind: 'emergency', t: this.time, a: reporter, text: `${N(reporter)} rang the emergency bell.` },
    );
    this.meeting = createMeeting(this, reporter, body);
  }

  eject(id: number): void {
    const c = this.chars[id];
    this.die(c, -1, 'ejected');
    this.emit({ kind: 'eject', t: this.time, a: id, text: `${N(id)} was voted out. They were ${c.team === 'murder' ? 'a murderer' : c.role === 'jester' ? 'the Jester' : 'innocent'} (${ROLES[c.role].name}).` });
    if (c.role === 'jester') this.finish('jester', `${c.name} the Jester got exactly what they wanted.`);
  }

  endMeeting(): void {
    this.meeting = null;
    if (this.state === 'over') return;
    for (const b of this.bodies) b.gone = true;
    const alive = this.aliveChars();
    const spots = this.spawnSpots(alive.length);
    const hub = this.map.rooms[this.map.hub];
    alive.forEach((c, i) => {
      c.x = spots[i].x;
      c.y = spots[i].y;
      c.dir = Math.atan2(hub.cy + 0.5 - c.y, hub.cx + 0.5 - c.x);
      c.wp = -1;
      c.percT = this.rng.next() * 0.3;
      if (c.team === 'murder') c.killCd = Math.max(c.killCd, this.settings.killCooldown * 0.7);
      if (c.brain) c.brain.goal = null;
    });
    this.sabCd = Math.max(this.sabCd, 18);
    this.lastMeetingT = this.time;
    this.state = 'play';
    this.checkWin();
  }

  // ---------- endings ----------

  checkWin(): void {
    if (this.state === 'over') return;
    const { murder, others } = this.counts();
    if (murder === 0) return this.finish('civ', 'Every murderer has been dealt with.');
    if (murder >= others) return this.finish('murder', 'The murderers can no longer be outvoted.');
    const tp = this.taskProgress();
    if (tp.total > 0 && tp.done >= tp.total) return this.finish('civ', 'Every chore is done and help is on the way.');
  }

  finish(w: Winner, reason: string): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.winner = w;
    this.winReason = reason;
    this.emit({ kind: 'end', t: this.time, text: reason });
  }

  /** Did this character end up on the winning side? */
  won(c: Char): boolean {
    if (this.winner === 'jester') return c.role === 'jester' && c.cause === 'ejected';
    if (this.winner === 'civ') return c.team === 'civ';
    if (this.winner === 'murder') return c.team === 'murder';
    return false;
  }
}

export function plainText(g: Game, text: string): string {
  return text.replace(/\{c(\d+)\}/g, (_, i) => g.chars[+i].name).replace(/\{r(-?\d+)\}/g, (_, i) => g.map.regionName(+i));
}
