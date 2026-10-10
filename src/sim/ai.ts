// Overworld behaviour for NPCs. Everything here works from what the character itself has
// perceived (c.visible, c.mem) plus public facts everyone can see (alarms, the task bar).
import { CORRIDOR_BASE } from './map';
import type { Char, Game } from './game';

export interface Personality {
  id: string;
  label: string;
  speak: number; // how readily they volunteer low-stakes information
  trustW: number; // weight on what others say
  ownW: number; // weight on what they saw themselves
  voteT: number; // suspicion needed before they vote for someone
  bandwagon: number; // pull of the crowd
  paranoia: number;
  bold: number; // (murderers) appetite for risky lies
}

export const PERSONALITIES: Personality[] = [
  { id: 'steady', label: 'level-headed', speak: 0.7, trustW: 1, ownW: 1, voteT: 2.0, bandwagon: 0.3, paranoia: 0.3, bold: 0.3 },
  { id: 'trusting', label: 'trusting', speak: 0.65, trustW: 1.35, ownW: 0.9, voteT: 1.75, bandwagon: 0.5, paranoia: 0.1, bold: 0.2 },
  { id: 'paranoid', label: 'paranoid', speak: 0.85, trustW: 0.7, ownW: 1.25, voteT: 1.55, bandwagon: 0.2, paranoia: 0.8, bold: 0.5 },
  { id: 'quiet', label: 'quiet', speak: 0.3, trustW: 1, ownW: 1.1, voteT: 2.3, bandwagon: 0.3, paranoia: 0.3, bold: 0.1 },
  { id: 'follower', label: 'easily led', speak: 0.55, trustW: 1.2, ownW: 0.8, voteT: 1.8, bandwagon: 1.0, paranoia: 0.3, bold: 0.2 },
  { id: 'sharp', label: 'sharp', speak: 0.8, trustW: 0.9, ownW: 1.3, voteT: 2.2, bandwagon: 0.1, paranoia: 0.4, bold: 0.6 },
];

export interface Goal {
  kind: 'station' | 'spot' | 'body' | 'chase' | 'button' | 'wait';
  act?: 'task' | 'fake' | 'fix' | 'report' | 'lurk' | 'clean' | 'kill' | 'shoot';
  station?: number;
  body?: number;
  target?: number;
  tx: number;
  ty: number;
  wait: number;
  lost: number;
}

export interface Brain {
  pers: Personality;
  goal: Goal | null;
  ignore: Set<number>;
  respond: '' | 'critical' | 'lights';
  wantBell: boolean;
  attacksHandled: number;
  selfReportAt: number;
  selfReportBody: number;
  cdReadyT: number;
  nextUnease: number;
}

export function makeBrain(g: Game, _c: Char): Brain {
  return {
    pers: g.rng.pick(PERSONALITIES),
    goal: null,
    ignore: new Set(),
    respond: '',
    wantBell: false,
    attacksHandled: 0,
    selfReportAt: 0,
    selfReportBody: -1,
    cdReadyT: -1,
    nextUnease: 0,
  };
}

const goal = (kind: Goal['kind'], tx: number, ty: number, extra: Partial<Goal> = {}): Goal => ({ kind, tx, ty, wait: 0, lost: 0, ...extra });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function wander(g: Game, c: Char, minW: number, maxW: number): Goal {
  const m = g.map;
  const here = g.regionOf(c);
  const rooms = m.rooms.filter((r) => r.kind !== 'junction' && r.id !== here && r.floor.length);
  const r = g.rng.pick(rooms);
  const t = g.rng.pick(r.floor);
  return goal('spot', t % m.w, Math.floor(t / m.w), { wait: g.rng.range(minW, maxW) });
}

function stationGoal(g: Game, id: number, act: Goal['act']): Goal {
  const st = g.station(id);
  return goal('station', st.x, st.y, { station: id, act });
}

function chooseGoal(g: Game, c: Char): Goal {
  const m = g.map;
  const rng = g.rng;
  const b = c.brain!;
  const myField = () => m.field(Math.floor(c.x), Math.floor(c.y));

  if (c.team === 'civ') {
    if (b.wantBell && c.emergencyLeft > 0 && !g.critical) return goal('button', g.station(0).x, g.station(0).y);
    if (!c.tasks.length) return wander(g, c, 2, 5);
    if (rng.chance(0.4)) return wander(g, c, 2, 6);
    const f = myField();
    const sorted = [...c.tasks].sort((p, q) => f[m.idx(g.station(p).x, g.station(p).y)] - f[m.idx(g.station(q).x, g.station(q).y)]);
    return stationGoal(g, sorted.length > 1 && rng.chance(0.3) ? sorted[1] : sorted[0], 'task');
  }

  const tasks = m.stationsOfKind('task');
  if (c.team === 'murder') {
    if (c.killCd <= 4 && rng.chance(0.7)) {
      // Cooldown nearly ready: drift toward where somebody was seen recently.
      const leads: number[] = [];
      for (const o of g.chars) {
        if (!o.alive || o.team === 'murder') continue;
        const s = c.mem.sights[o.id];
        const last = s[s.length - 1];
        if (last && g.time - last.t1 < 25 && last.region >= 0 && last.region < CORRIDOR_BASE) leads.push(last.region);
      }
      if (leads.length) {
        const r = m.rooms[rng.pick(leads)];
        if (r.floor.length) {
          const t = rng.pick(r.floor);
          return goal('spot', t % m.w, Math.floor(t / m.w), { wait: rng.range(0.4, 1.4) });
        }
      }
      return wander(g, c, 0.4, 1.5);
    }
    if (rng.chance(0.2)) return wander(g, c, 1, 3);
    const f = myField();
    const near = [...tasks].sort((p, q) => f[m.idx(p.x, p.y)] - f[m.idx(q.x, q.y)]).slice(0, 6);
    return stationGoal(g, rng.pick(near).id, 'fake');
  }

  // Jester: aimless, clingy, generally a bit off.
  if (rng.chance(0.4)) return stationGoal(g, rng.pick(tasks).id, 'fake');
  if (c.visible.length && rng.chance(0.3)) {
    const o = g.chars[rng.pick(c.visible)];
    return goal('spot', Math.floor(o.x), Math.floor(o.y), { wait: rng.range(1, 2.5) });
  }
  return wander(g, c, 1, 4);
}

function fleeGoal(g: Game, c: Char): Goal {
  const m = g.map;
  const f = m.field(Math.floor(c.x), Math.floor(c.y));
  const here = g.regionOf(c);
  const tasks = m.stationsOfKind('task').filter((s) => s.room !== here);
  const mid = tasks.filter((s) => {
    const d = f[m.idx(s.x, s.y)];
    return d >= 150 && d <= 450;
  });
  const st = g.rng.pick(mid.length ? mid : tasks);
  return stationGoal(g, st.id, 'fake');
}

function doKill(g: Game, c: Char, t: Char): void {
  const b = c.brain!;
  const res = g.tryKill(c, t);
  b.goal = null;
  b.cdReadyT = -1;
  if (res !== 'killed' || g.state !== 'play') {
    if (res === 'blocked') b.goal = fleeGoal(g, c);
    return;
  }
  const body = g.bodies[g.bodies.length - 1];
  b.ignore.add(body.id);
  const seen = c.visible.filter((id) => id !== t.id && g.chars[id].alive && g.chars[id].team !== 'murder');
  if (c.role === 'cleaner' && c.abilityCd <= 0 && seen.length === 0) {
    g.startAction(c, { kind: 'clean', body: body.id, t: 0, dur: 2.5 });
  } else if (seen.length === 0 && g.rng.chance(0.1)) {
    b.selfReportAt = g.time + g.rng.range(1.2, 3);
    b.selfReportBody = body.id;
    b.goal = goal('wait', 0, 0, { wait: 4 });
  } else {
    b.goal = fleeGoal(g, c);
  }
}

export function updateBrain(g: Game, c: Char, dt: number): void {
  const b = c.brain!;
  const m = g.map;
  if (b.selfReportAt > 0 && g.time >= b.selfReportAt) {
    b.selfReportAt = 0;
    const body = g.bodies[b.selfReportBody];
    if (body && g.report(c, body)) return;
  }
  if (c.action) return;
  if (!b.goal) b.goal = chooseGoal(g, c);
  const go = b.goal;
  switch (go.kind) {
    case 'wait':
      go.wait -= dt;
      if (go.wait <= 0) b.goal = null;
      break;
    case 'spot':
      if (g.stepField(c, m.field(go.tx, go.ty), dt)) b.goal = goal('wait', 0, 0, { wait: go.wait });
      break;
    case 'station': {
      const st = g.station(go.station!);
      if (go.act === 'fix' && !(st.kind === 'critical' ? g.critical : g.lightsOut())) {
        b.goal = null;
        b.respond = '';
        break;
      }
      if (!g.stepField(c, m.field(go.tx, go.ty), dt)) break;
      b.goal = null;
      if (go.act === 'task') {
        if (c.tasks.includes(st.id)) g.startAction(c, { kind: 'task', station: st.id, t: 0, dur: g.rng.range(7, 12) });
      } else if (go.act === 'fake') {
        g.startAction(c, { kind: 'fake', station: st.id, t: 0, dur: g.rng.range(4, 8) });
      } else if (go.act === 'fix') {
        g.startAction(c, { kind: 'fix', station: st.id, t: 0, dur: g.fixDuration(c, st) });
        b.respond = '';
      }
      break;
    }
    case 'body': {
      const body = g.bodies[go.body!];
      if (!body || body.gone) {
        b.goal = null;
        break;
      }
      if (go.act === 'report' && g.report(c, body)) return;
      if (!g.stepField(c, m.field(go.tx, go.ty), dt)) break;
      if (go.act === 'clean' && g.canClean(c, body)) {
        b.goal = null;
        g.startAction(c, { kind: 'clean', body: body.id, t: 0, dur: 2.5 });
      } else {
        b.goal = goal('wait', 0, 0, { wait: go.act === 'lurk' ? 3.5 : 0.2 });
      }
      break;
    }
    case 'chase': {
      const t = g.chars[go.target!];
      if (!t.alive) {
        b.goal = null;
        break;
      }
      if (go.act === 'kill') {
        if (g.canKill(c, t)) return doKill(g, c, t);
        if (c.killCd > 0) {
          b.goal = null;
          break;
        }
      } else if (go.act === 'shoot') {
        if (g.canShoot(c, t)) {
          b.goal = null;
          g.shoot(c, t);
          return;
        }
        if (c.shots <= 0) {
          b.goal = null;
          break;
        }
      }
      go.lost = c.visible.includes(t.id) ? 0 : go.lost + dt;
      if (go.lost > 2.5) {
        b.goal = null;
        break;
      }
      g.stepField(c, m.field(Math.floor(t.x), Math.floor(t.y)), dt);
      break;
    }
    case 'button':
      if (g.callEmergency(c)) return;
      if (c.emergencyLeft <= 0 || g.critical) {
        b.goal = null;
        b.wantBell = false;
        break;
      }
      g.stepField(c, m.field(go.tx, go.ty), dt);
      break;
  }
}

export function onSabotage(g: Game, c: Char, kind: 'lights' | 'doors' | 'critical'): void {
  const b = c.brain!;
  if (kind === 'doors') return;
  if (c.team === 'murder') {
    if (g.rng.chance(0.3)) b.respond = kind;
    return;
  }
  if (kind === 'critical') {
    if (c.role === 'engineer' || g.rng.chance(0.6)) b.respond = 'critical';
  } else if (c.role === 'engineer' || g.rng.chance(0.3)) b.respond = 'lights';
}

/** Called right after the character's senses update. Urgent reactions that override the current goal. */
export function onPerceive(g: Game, c: Char): void {
  const b = c.brain!;
  const rng = g.rng;
  const m = g.map;
  if (c.team === 'murder') return perceiveMurderer(g, c);

  // A body in view trumps everything.
  for (const id of c.visibleBodies) {
    if (b.ignore.has(id)) continue;
    const body = g.bodies[id];
    if (c.role === 'jester' && rng.chance(0.15)) {
      b.ignore.add(id);
      c.action = null;
      b.goal = goal('body', Math.floor(body.x), Math.floor(body.y), { body: id, act: 'lurk' });
      return;
    }
    if (g.report(c, body)) return;
    if (!(b.goal && b.goal.kind === 'body' && b.goal.body === id)) {
      c.action = null;
      b.goal = goal('body', Math.floor(body.x), Math.floor(body.y), { body: id, act: 'report' });
    }
    return;
  }

  // Saw an attack bounce off a ward: go ring the bell.
  if (c.mem.sawAttack.length > b.attacksHandled) {
    b.attacksHandled = c.mem.sawAttack.length;
    if (c.emergencyLeft > 0) b.wantBell = true;
  }
  if (b.wantBell && c.emergencyLeft > 0 && !g.critical && !(b.goal && b.goal.kind === 'button')) {
    c.action = null;
    b.goal = goal('button', g.station(0).x, g.station(0).y);
    return;
  }

  // Alarms. Everyone drops what they're doing once a critical failure is half spent.
  if (g.critical && g.critical.until - g.time < g.critical.total * 0.55 && c.team === 'civ') b.respond = 'critical';
  if (b.respond) {
    const live = b.respond === 'critical' ? !!g.critical : g.lightsOut();
    if (!live) b.respond = '';
    else if (!(c.action && c.action.kind === 'fix') && !(b.goal && b.goal.act === 'fix')) {
      c.action = null;
      b.goal = stationGoal(g, m.stationsOfKind(b.respond === 'critical' ? 'critical' : 'breaker')[0].id, 'fix');
    }
    if (b.respond) return;
  }

  if (c.role === 'vigilante' && c.shots > 0) {
    let best = -1;
    for (const id of c.visible) if ((c.mem.sure[id] === 1 || c.mem.susp[id] >= 5) && (best < 0 || c.mem.susp[id] > c.mem.susp[best])) best = id;
    if (best >= 0) {
      const t = g.chars[best];
      if (g.shoot(c, t)) return;
      c.action = null;
      b.goal = goal('chase', 0, 0, { target: best, act: 'shoot' });
      return;
    }
  }

  if (c.role === 'medic' && c.abilityCd <= 0 && (c.wardTarget < 0 || c.mem.susp[c.wardTarget] > 1.2)) {
    let best = -1;
    for (const id of c.visible) {
      if (c.mem.susp[id] > 0.6 || id === c.wardTarget || !g.canWard(c, g.chars[id])) continue;
      if (best < 0 || c.mem.susp[id] < c.mem.susp[best]) best = id;
    }
    if (best >= 0) g.ward(c, g.chars[best]);
  }

  // Alone with someone I have real doubts about: find company.
  if (g.tuning.cunning >= 0.6 && g.time >= b.nextUnease && c.visible.length === 1 && !c.action) {
    const o = g.chars[c.visible[0]];
    if (c.mem.susp[o.id] >= 1.5 && dist(c, o) < 5 && b.goal && b.goal.kind !== 'body' && b.goal.act !== 'fix') {
      b.nextUnease = g.time + 10;
      const hub = m.rooms[m.hub];
      const t = rng.pick(hub.floor);
      b.goal = goal('spot', t % m.w, Math.floor(t / m.w), { wait: rng.range(1, 3) });
    }
  }
}

function perceiveMurderer(g: Game, c: Char): void {
  const b = c.brain!;
  const rng = g.rng;
  const cun = g.tuning.cunning;

  for (const id of c.visibleBodies) {
    if (b.ignore.has(id)) continue;
    b.ignore.add(id);
    const body = g.bodies[id];
    // A partner's handiwork. Sometimes "discover" it for cover.
    if (body.killer !== c.id && rng.chance(0.3)) {
      c.action = null;
      b.goal = goal('body', Math.floor(body.x), Math.floor(body.y), { body: id, act: 'report' });
      return;
    }
  }

  if (b.respond) {
    const live = b.respond === 'critical' ? !!g.critical : g.lightsOut();
    if (!live) b.respond = '';
    else if (c.killCd > 3 && !c.action && !(b.goal && b.goal.kind === 'station' && b.goal.act === 'fake' && g.station(b.goal.station!).kind !== 'task')) {
      // Be seen hurrying to help, then stand at the console doing nothing.
      b.goal = stationGoal(g, g.map.stationsOfKind(b.respond === 'critical' ? 'critical' : 'breaker')[0].id, 'fake');
    }
  }

  const { murder, others } = g.counts();
  const endgame = others <= murder + 1;
  const dark = g.lightsOut();
  const targets = c.visible.map((id) => g.chars[id]).filter((o) => o.team !== 'murder');
  targets.sort((p, q) => dist(c, p) - dist(c, q));
  const watching = (t: Char) => targets.filter((o) => o !== t && (!dark || dist(o, t) < 3.5 || dist(o, c) < 3.5));
  // Careful murderers also wait if somebody was in view moments ago: they may be just around the corner.
  const recentT = g.time - (1.5 + 4 * cun);
  const lurkers = (t: Char) =>
    dark ? 0 : g.chars.filter((o) => o.alive && o !== t && o.team !== 'murder' && !c.visible.includes(o.id) && (c.mem.sights[o.id][c.mem.sights[o.id].length - 1]?.t1 ?? -99) > recentT).length;

  if (b.goal && b.goal.kind === 'chase' && b.goal.act === 'kill') {
    // Call it off if someone else walks in.
    const t = g.chars[b.goal.target!];
    if (!endgame && watching(t).length && rng.chance(cun)) b.goal = null;
  } else if (c.killCd <= 0 && g.time - g.lastMeetingT > 5 && b.selfReportAt === 0) {
    if (b.cdReadyT < 0) b.cdReadyT = g.time;
    const impatience = g.time - b.cdReadyT;
    let pick: Char | null = null;
    if (targets.length) {
      if (endgame) pick = targets[0];
      else pick = targets.find((t) => watching(t).length === 0 && (lurkers(t) === 0 || impatience > 20)) ?? null;
      if (!pick && targets.length === 2 && impatience > 25 && rng.chance((1 - cun) * 0.08 + 0.006)) pick = targets[0];
      if (!pick && targets.length >= 2 && impatience > 10 && g.canSabotage(c) && rng.chance(0.04)) g.sabotage(c, 'lights');
    }
    if (pick) {
      c.action = null;
      b.goal = goal('chase', 0, 0, { target: pick.id, act: 'kill' });
      const reg = g.regionOf(c);
      if (reg >= 0 && reg < CORRIDOR_BASE && reg === g.regionOf(pick) && g.canSabotage(c) && rng.chance(0.12)) g.sabotage(c, 'doors');
      return;
    }
  } else if (c.killCd > 0) b.cdReadyT = -1;

  if (g.canSabotage(c) && g.time - g.lastMeetingT > 20 && rng.chance(0.01)) {
    g.sabotage(c, g.time > 60 && rng.chance(0.4) ? 'critical' : 'lights');
  }
}
