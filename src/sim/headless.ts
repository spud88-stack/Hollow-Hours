// Headless balance / soak test: every character is AI-controlled.
//   npm run sim -- --n 300 --npc 11 --murderers 2 --difficulty normal --size medium --theme random
//   npm run sim -- --n 1 --verbose          (prints a full round, meetings included)
//   npm run sim -- --sweep                  (runs a spread of settings)
import { defaultSettings, type Settings } from './defs';
import { Game, plainText } from './game';
import { autoMeeting, finishMeeting, runVote, step } from './meeting';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flag = (name: string) => args.includes(`--${name}`);

const DT = 1 / 30;
const MAX_T = 60 * 25;

interface Result {
  winner: string;
  time: number;
  meetings: number;
  kills: number;
  goodEjects: number;
  badEjects: number;
  timeout: boolean;
  why: string;
}

function runOne(settings: Settings, seed: string, verbose: boolean): Result {
  const g = new Game(settings, seed, { hasPlayer: false });
  const say = (s: string) => verbose && console.log(s);
  say(`\n=== ${seed} | ${g.map.theme.name} ${g.map.w}x${g.map.h}, ${g.map.rooms.length} rooms ===`);
  say(g.chars.map((c) => `${c.name}:${c.role}(${c.brain!.pers.id})`).join('  '));
  let stuckT = 0;
  const last = g.chars.map((c) => ({ x: c.x, y: c.y, t: 0 }));
  let maxStuck = 0;
  while (g.state !== 'over' && g.time < MAX_T) {
    g.update(DT);
    for (const e of g.events) if (e.text && e.kind !== 'report' && e.kind !== 'emergency') say(`[${e.t.toFixed(0)}s] ${plainText(g, e.text)}`);
    g.events.length = 0;
    if (g.state === 'meeting') {
      const m = g.meeting!;
      if (verbose) {
        say(`--- meeting at ${g.time.toFixed(0)}s ---`);
        for (const s of m.feed) say(`   * ${plainText(g, s.text)}`);
        for (;;) {
          const st = step(g, m);
          if (st.type !== 'stmt') break;
          say(`   ${g.chars[st.stmt.by].name}${st.stmt.lie ? ' (LIE)' : ''}: ${plainText(g, st.stmt.text)}`);
        }
        runVote(g, m, null);
        say(`   votes: ${g.aliveChars().concat(m.result!.ejected >= 0 ? [g.chars[m.result!.ejected]] : []).map((c) => `${c.name}>${m.votes[c.id] < 0 ? 'skip' : g.chars[m.votes[c.id]].name}`).join(' ')}`);
        finishMeeting(g, m);
      } else autoMeeting(g);
      for (const e of g.events) if (e.text) say(`[${e.t.toFixed(0)}s] ${plainText(g, e.text)}`);
      g.events.length = 0;
      for (const l of last) l.t = g.time;
    }
    // Stuck detection: an NPC that has not moved for a long time while having somewhere to go.
    stuckT += DT;
    if (stuckT > 1) {
      stuckT = 0;
      for (const c of g.chars) {
        const l = last[c.id];
        if (!c.alive || c.action || Math.hypot(c.x - l.x, c.y - l.y) > 0.05 || c.brain?.goal?.kind === 'wait') {
          l.x = c.x;
          l.y = c.y;
          l.t = g.time;
        } else maxStuck = Math.max(maxStuck, g.time - l.t);
      }
    }
  }
  const ejects = g.log.filter((e) => e.kind === 'eject');
  const res: Result = {
    winner: g.winner ?? 'timeout',
    time: g.time,
    meetings: g.meetingsHeld,
    kills: g.log.filter((e) => e.kind === 'kill').length,
    goodEjects: ejects.filter((e) => g.chars[e.a!].team === 'murder').length,
    badEjects: ejects.filter((e) => g.chars[e.a!].team !== 'murder').length,
    timeout: g.state !== 'over',
    why: g.winReason,
  };
  if (maxStuck > 25) console.log(`  ! stuck NPC for ${maxStuck.toFixed(0)}s in seed ${seed}`);
  say(`=> ${res.winner} at ${res.time.toFixed(0)}s: ${res.why}`);
  return res;
}

function batch(label: string, settings: Settings, n: number, verbose: boolean): void {
  const wins: Record<string, number> = {};
  const whys: Record<string, number> = {};
  let time = 0;
  let meetings = 0;
  let kills = 0;
  let good = 0;
  let bad = 0;
  let timeouts = 0;
  let crashes = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const seed = `${label}-${i}`;
    try {
      const r = runOne(settings, seed, verbose);
      wins[r.winner] = (wins[r.winner] ?? 0) + 1;
      whys[r.why] = (whys[r.why] ?? 0) + 1;
      time += r.time;
      meetings += r.meetings;
      kills += r.kills;
      good += r.goodEjects;
      bad += r.badEjects;
      if (r.timeout) timeouts++;
    } catch (err) {
      crashes++;
      console.log(`  ! crash in seed ${seed}: ${(err as Error).stack}`);
    }
  }
  const pct = (k: string) => `${(((wins[k] ?? 0) / n) * 100).toFixed(0)}%`;
  console.log(
    `${label.padEnd(34)} civ ${pct('civ').padStart(4)}  murder ${pct('murder').padStart(4)}  jester ${pct('jester').padStart(4)} | ` +
      `avg ${(time / n).toFixed(0)}s, ${(meetings / n).toFixed(1)} meetings, ${(kills / n).toFixed(1)} kills, ejects ${(good / n).toFixed(1)} right / ${(bad / n).toFixed(1)} wrong | ` +
      `timeouts ${timeouts}, crashes ${crashes} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  if (flag('why')) for (const [k, v] of Object.entries(whys)) console.log(`      ${v}x ${k}`);
}

const n = +arg('n', '200');
const base = defaultSettings();
if (flag('sweep')) {
  const variants: [string, Partial<Settings>][] = [
    ['default', {}],
    ['easy', { difficulty: 'easy' }],
    ['hard', { difficulty: 'hard' }],
    ['tiny 3npc 1m', { npcCount: 3, murderers: 1, size: 'small' }],
    ['small 6npc 1m', { npcCount: 6, murderers: 1, size: 'small' }],
    ['small 8npc 2m', { npcCount: 8, murderers: 2, size: 'small' }],
    ['medium 14npc 2m', { npcCount: 14, murderers: 2 }],
    ['large 20npc 3m', { npcCount: 20, murderers: 3, size: 'large' }],
    ['large 20npc 1m', { npcCount: 20, murderers: 1, size: 'large' }],
    ['manor', { theme: 'manor' }],
    ['station', { theme: 'station' }],
    ['ship', { theme: 'ship' }],
    ['lodge', { theme: 'lodge' }],
    ['no specials', { roleCounts: { detective: 0, medic: 0, vigilante: 0, engineer: 0, lookout: 0, magistrate: 0, jester: 0 }, murdererVariants: false }],
    ['all specials x2', { npcCount: 16, roleCounts: { detective: 2, medic: 2, vigilante: 2, engineer: 2, lookout: 2, magistrate: 2, jester: 1 } }],
    ['fast kills', { killCooldown: 12, autoBalance: false }],
    ['slow kills many tasks', { killCooldown: 50, tasks: 9, autoBalance: false }],
    ['manual 25s / 7 chores', { killCooldown: 25, tasks: 7, autoBalance: false }],
    ['short sight', { vision: 4 }],
    ['long sight', { vision: 11 }],
  ];
  for (const [label, v] of variants) batch(label, { ...base, ...v }, n, false);
} else {
  const s: Settings = {
    ...base,
    npcCount: +arg('npc', String(base.npcCount)),
    murderers: +arg('murderers', String(base.murderers)),
    difficulty: arg('difficulty', base.difficulty) as Settings['difficulty'],
    size: arg('size', base.size) as Settings['size'],
    theme: arg('theme', base.theme) as Settings['theme'],
    killCooldown: +arg('cooldown', String(base.killCooldown)),
    tasks: +arg('tasks', String(base.tasks)),
    vision: +arg('vision', String(base.vision)),
    autoBalance: !(args.includes('--cooldown') || args.includes('--tasks')),
  };
  batch(arg('label', 'run'), s, n, flag('verbose'));
}
