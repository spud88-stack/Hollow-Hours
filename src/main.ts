import { sfx } from './audio';
import { openMinigame, type MiniHandle } from './minigames';
import { Renderer } from './render';
import type { Settings } from './sim/defs';
import { Game, KILL_RANGE, USE_RANGE, type Body, type Char, type GameEvent } from './sim/game';
import { randomSeedText } from './sim/rng';
import type { Station } from './sim/map';
import { UI, fmt, loadSettings, type HudButton } from './ui';

const STEP = 1 / 30;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const ui = new UI();

let g: Game | null = null;
let settings: Settings = loadSettings();
let mode: 'menu' | 'reveal' | 'play' | 'meeting' | 'ending' | 'over' = 'menu';
let acc = 0;
let speed = 1;
let showMap = false;
let mini: MiniHandle | null = null;
let cam = { x: 0, y: 0 };
let stepT = 0;
let alarmT = 0;
let lastSeed = '';
let follow = -1; // spectator: character the camera tracks, -1 for free camera
const keys = new Set<string>();

ui.onSpeed = (n) => (speed = n);

function start(s: Settings, seed?: string): void {
  settings = s;
  lastSeed = seed ?? (s.seed.trim() || randomSeedText());
  g = new Game(s, lastSeed, { hasPlayer: true });
  renderer.setGame(g);
  const p = g.player!;
  cam = { x: p.x, y: p.y };
  acc = 0;
  speed = 1;
  follow = -1;
  showMap = false;
  closeMini();
  mode = 'reveal';
  ui.hideHud();
  ui.showReveal(g, () => {
    mode = 'play';
    ui.showHud(g!);
  });
}

function menu(): void {
  mode = 'menu';
  g = null;
  renderer.g = null;
  ui.showMenu(settings, (s) => start(s));
}

function closeMini(): void {
  if (mini) {
    mini.close();
    mini = null;
  }
}

// ---------- what the player can do right now ----------

interface Ctx {
  station: Station | null;
  stationLabel: string;
  body: Body | null;
  cleanBody: Body | null;
  target: Char | null; // who Q would act on
  targetReady: boolean;
}

function context(game: Game, p: Char): Ctx {
  const c: Ctx = { station: null, stationLabel: '', body: null, cleanBody: null, target: null, targetReady: false };
  if (!p.alive) return c;
  let best = USE_RANGE;
  for (const s of game.map.stations) {
    const d = Math.hypot(s.x + 0.5 - p.x, s.y + 0.5 - p.y);
    if (d > best) continue;
    let label = '';
    if (s.kind === 'button') label = game.canCallEmergency(p) ? `Ring the bell (${p.emergencyLeft} left)` : '';
    else if (s.kind === 'critical') label = game.critical ? `Repair the ${s.name}` : '';
    else if (s.kind === 'breaker') label = game.lightsOut() ? `Restore the lights` : '';
    else if (p.tasks.includes(s.id)) label = s.name;
    else if (p.team !== 'civ') label = `Pretend: ${s.name}`;
    if (!label) continue;
    best = d;
    c.station = s;
    c.stationLabel = label;
  }
  let bd = Infinity;
  for (const b of game.bodies) {
    if (b.gone) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (game.canReport(p, b) && d < bd) {
      bd = d;
      c.body = b;
    }
    if (game.canClean(p, b)) c.cleanBody = b;
  }
  const range = p.team === 'murder' ? KILL_RANGE : p.role === 'vigilante' ? 3.2 : p.role === 'medic' ? 2.2 : 0;
  if (range && !(p.role === 'vigilante' && p.shots <= 0)) {
    let td = range;
    for (const o of game.chars) {
      if (o === p || !o.alive || (p.team === 'murder' && o.team === 'murder')) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= td && game.map.los(p.x, p.y, o.x, o.y)) {
        td = d;
        c.target = o;
      }
    }
    if (c.target) c.targetReady = p.team === 'murder' ? p.killCd <= 0 : p.role === 'medic' ? p.abilityCd <= 0 : true;
  }
  return c;
}

function use(): void {
  if (!g || mode !== 'play') return;
  const p = g.player!;
  const c = context(g, p);
  const s = c.station;
  if (!s || mini) return;
  if (s.kind === 'button') {
    g.callEmergency(p);
  } else if (s.kind === 'critical' || s.kind === 'breaker') {
    g.startAction(p, { kind: 'fix', station: s.id, t: 0, dur: g.fixDuration(p, s) });
  } else if (p.tasks.includes(s.id)) {
    g.startAction(p, { kind: 'task', station: s.id, t: 0, dur: Infinity });
    const game = g;
    mini = openMinigame(s.mini, s.name, ui.mini, () => {
      mini = null;
      game.completeTask(p, s.id);
      renderer.burst(p.x, p.y, '#ffe66b', 18, 3.5);
    });
  } else {
    g.startAction(p, { kind: 'fake', station: s.id, t: 0, dur: 6 });
  }
}

function report(): void {
  if (!g || mode !== 'play') return;
  const c = context(g, g.player!);
  if (c.body) g.report(g.player!, c.body);
}

function primary(): void {
  if (!g || mode !== 'play') return;
  const p = g.player!;
  const c = context(g, p);
  if (!c.target) return;
  if (p.team === 'murder') {
    const res = g.tryKill(p, c.target);
    if (res === 'blocked') ui.toast(`A ward protected ${fmt(g, `{c${c.target.id}}`)}. They saw your face.`, 'bad');
  } else if (p.role === 'vigilante') g.shoot(p, c.target);
  else if (p.role === 'medic') {
    if (g.ward(p, c.target)) ui.toast(`You warded ${fmt(g, `{c${c.target.id}}`)}. The next attack on them will fail.`, 'good');
  }
}

function clean(): void {
  if (!g || mode !== 'play') return;
  const p = g.player!;
  const c = context(g, p);
  if (c.cleanBody) g.startAction(p, { kind: 'clean', body: c.cleanBody.id, t: 0, dur: 2.5 });
}

function sabotage(kind: 'lights' | 'doors' | 'critical'): void {
  if (!g || mode !== 'play') return;
  g.sabotage(g.player!, kind);
}

// ---------- events from the simulation ----------

function onEvents(game: Game): void {
  const p = game.player!;
  for (const e of game.events) {
    const sees = (x?: number, y?: number) => !p.alive || (x !== undefined && game.canSeePoint(p, x, y!));
    switch (e.kind) {
      case 'kill':
        if (e.b === p.id) {
          closeMini();
          sfx.kill();
          renderer.burst(e.x!, e.y!, '#b01818', 26, 4);
          ui.toast(`You were killed by ${fmt(game, `{c${e.a}}`)}.`, 'bad', 9000);
        } else if (e.a === p.id) {
          sfx.kill();
          renderer.burst(e.x!, e.y!, '#b01818', 22, 4);
        } else if (sees(e.x, e.y)) {
          sfx.kill();
          renderer.burst(e.x!, e.y!, '#b01818', 22, 4);
          if (!p.alive) ui.toast(fmt(game, e.text), 'bad');
        }
        break;
      case 'witness':
        sfx.scream();
        ui.toast(fmt(game, e.text) + ' Report the body!', 'bad', 8000);
        break;
      case 'save':
        if (e.b === p.id) ui.toast(`${fmt(game, `{c${e.a}}`)} just tried to kill you. A Medic's ward saved your life!`, 'bad', 9000);
        else if (p.wardTarget === -1 && p.role === 'medic' && p.alive) ui.toast(`Your ward on ${fmt(game, `{c${e.b}}`)} just absorbed an attack!`, 'good', 8000);
        else if (p.mem.sawAttack.some((a) => a.t === e.t) || !p.alive) ui.toast(fmt(game, e.text), 'bad', 8000);
        if (sees(e.x, e.y) || e.b === p.id || e.a === p.id) {
          sfx.ward();
          renderer.burst(e.x!, e.y!, '#7ee0c8', 22, 3);
        }
        break;
      case 'sabotage': {
        const mine = p.team === 'murder' || !p.alive;
        if (e.what === 'lights') {
          sfx.lights();
          const s = game.map.stationsOfKind('breaker')[0];
          ui.toast(`${mine ? fmt(game, e.text) + ' ' : ''}The lights are out. The ${s.name} is in ${fmt(game, `{r${s.room}}`)}.`, 'bad');
        } else if (e.what === 'critical') {
          sfx.alarm();
          const s = game.map.stationsOfKind('critical')[0];
          ui.toast(`${mine ? fmt(game, e.text) + ' ' : ''}${game.map.theme.criticalAlert} Get to ${fmt(game, `{r${s.room}}`)}!`, 'bad', 8000);
        } else if (mine || game.regionOf(p) === e.region) {
          sfx.bad();
          ui.toast(mine ? fmt(game, e.text) : 'The doors slam shut and lock!', 'bad');
        }
        break;
      }
      case 'fixed':
        sfx.fixed();
        ui.toast(e.what === 'critical' ? `The ${game.map.theme.critical} has been repaired.` : 'The lights are back.', 'good');
        break;
      case 'shot':
        sfx.shot();
        if (e.x !== undefined) renderer.burst(e.x, e.y!, '#ffb35c', 20, 5);
        ui.toast(fmt(game, e.text), e.what === 'hit' ? 'good' : 'bad', 9000);
        break;
      case 'clean':
        if (e.a === p.id || !p.alive) ui.toast(fmt(game, e.text));
        if (sees(e.x, e.y)) renderer.burst(e.x!, e.y!, '#888', 12, 2);
        break;
      case 'ward':
        if (e.a === p.id) sfx.ward();
        break;
      case 'task':
        if (!p.alive || (e.a !== p.id && game.chars[e.a!] && sees(game.chars[e.a!].x, game.chars[e.a!].y))) renderer.burst(game.chars[e.a!].x, game.chars[e.a!].y, '#9fe870', 6, 2);
        break;
      default:
        break;
    }
  }
  game.events.length = 0;
}

// ---------- frame loop ----------

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
  if (!g) {
    renderer.draw(dt, { spectator: true, target: -1, prompt: null, showMap: false, camX: 0, camY: 0 });
    return;
  }
  logic(dt);
  if (!g) return;
  const game = g;
  const p = game.player!;
  const spect = !p.alive;
  draw(game, p, spect, dt);
}

function logic(dt: number): void {
  if (!g) return;
  const game = g;
  const p = game.player!;
  const spect = !p.alive;
  if (mode === 'play') {
    let ix = 0;
    let iy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (spect && follow >= 0 && !ix && !iy && game.chars[follow].alive) {
      const f = game.chars[follow];
      cam.x += (f.x - cam.x) * Math.min(1, dt * 8);
      cam.y += (f.y - cam.y) * Math.min(1, dt * 8);
    } else if (spect) {
      follow = -1;
      const len = Math.hypot(ix, iy) || 1;
      cam.x = Math.max(0, Math.min(game.map.w, cam.x + (ix / len) * 14 * dt));
      cam.y = Math.max(0, Math.min(game.map.h, cam.y + (iy / len) * 14 * dt));
      game.input.x = 0;
      game.input.y = 0;
    } else {
      game.input.x = ix;
      game.input.y = iy;
      if ((ix || iy) && mini) {
        closeMini();
        game.cancelAction(p);
      }
      if (ix || iy) {
        stepT -= dt;
        if (stepT <= 0) {
          stepT = 0.28;
          sfx.step();
        }
      }
    }
    acc += dt * (spect ? speed : 1);
    let guard = 0;
    while (acc >= STEP && guard++ < 40) {
      acc -= STEP;
      game.update(STEP);
      onEvents(game);
      if (game.state !== 'play') break;
    }
    if (guard >= 40) acc = 0;
    if (game.critical) {
      alarmT -= dt;
      if (alarmT <= 0) {
        alarmT = 1.1;
        sfx.alarm();
      }
    }
    if (!spect) {
      cam.x += (p.x - cam.x) * Math.min(1, dt * 10);
      cam.y += (p.y - cam.y) * Math.min(1, dt * 10);
    }
    if (game.state === 'meeting') {
      mode = 'meeting';
      closeMini();
      showMap = false;
      keys.clear();
      ui.openMeeting(game, () => {
        if (game.state === 'over') endRound(game);
        else {
          mode = 'play';
          if (p.alive) cam = { x: p.x, y: p.y };
        }
      });
    } else if (game.state === 'over') endRound(game);
  }
}

function draw(game: Game, p: Char, spect: boolean, dt: number): void {
  const c = mode === 'play' && p.alive ? context(game, p) : null;
  let prompt: { x: number; y: number; text: string } | null = null;
  if (c && !mini && !p.action) {
    if (c.body) prompt = { x: c.body.x, y: c.body.y, text: '[R] Report the body' };
    else if (c.station) prompt = { x: c.station.x + 0.5, y: c.station.y + 0.5, text: `[E] ${c.stationLabel}` };
  }
  renderer.draw(dt, { spectator: spect || mode === 'ending' || mode === 'over', target: c?.target ? c.target.id : -1, prompt, showMap, camX: cam.x, camY: cam.y });

  if (mode === 'play' || mode === 'meeting') {
    const buttons: HudButton[] = [];
    const alive = p.alive && mode === 'play';
    buttons.push({ id: 'map', label: 'Map', key: 'M', show: true, enabled: true, onClick: () => (showMap = !showMap) });
    if (p.team === 'murder') {
      const sab = alive && game.canSabotage(p);
      const cd = alive ? Math.max(0, game.sabCd) : 0;
      buttons.push({ id: 's3', label: game.map.theme.critical, key: '3', show: p.alive, enabled: sab, cd, onClick: () => sabotage('critical') });
      buttons.push({ id: 's2', label: 'Lock doors', key: '2', show: p.alive, enabled: sab, cd, onClick: () => sabotage('doors') });
      buttons.push({ id: 's1', label: 'Lights out', key: '1', show: p.alive, enabled: sab, cd, onClick: () => sabotage('lights') });
      if (p.role === 'cleaner') buttons.push({ id: 'clean', label: 'Hide body', key: 'F', show: p.alive, enabled: !!c?.cleanBody, cd: p.abilityCd, onClick: clean });
      buttons.push({ id: 'kill', label: 'Kill', key: 'Q', show: p.alive, enabled: !!c?.target && c.targetReady, cd: p.killCd, danger: true, onClick: primary });
    }
    if (p.role === 'vigilante') buttons.push({ id: 'shoot', label: p.shots ? 'Shoot' : 'No bullet', key: 'Q', show: p.alive, enabled: !!c?.target && p.shots > 0, danger: true, onClick: primary });
    if (p.role === 'medic') buttons.push({ id: 'ward', label: p.wardTarget >= 0 ? `Ward: ${game.chars[p.wardTarget].name}` : 'Ward', key: 'Q', show: p.alive, enabled: !!c?.target && c.targetReady, cd: p.abilityCd, onClick: primary });
    buttons.push({ id: 'report', label: 'Report', key: 'R', show: p.alive, enabled: !!c?.body, danger: !!c?.body, onClick: report });
    buttons.push({ id: 'use', label: c?.station ? (c.station.kind === 'button' ? 'Ring bell' : 'Use') : 'Use', key: 'E', show: p.alive, enabled: !!c?.station && !mini, onClick: use });
    let alert = '';
    if (game.critical) alert = `${game.map.theme.criticalAlert}  ${Math.ceil(game.critical.until - game.time)}s`;
    else if (game.lightsOut()) alert = p.team === 'murder' ? 'Lights out. You can still see.' : `Lights out! Find the ${game.map.stationsOfKind('breaker')[0].name}.`;
    const reg = spect ? game.map.regionAt(cam.x, cam.y) : game.regionOf(p);
    ui.updateHud(game, { buttons, alert, location: reg >= 0 ? game.map.regionName(reg) : '', spectator: spect && mode === 'play', speed });
  }
}

function endRound(game: Game): void {
  if (mode === 'ending' || mode === 'over') return;
  mode = 'ending';
  closeMini();
  showMap = false;
  ui.toast(`<b>${game.winReason}</b>`, '', 4000);
  setTimeout(() => {
    if (g !== game) return;
    mode = 'over';
    ui.showRecap(game, renderer.thumbnail(560, 300), 32, {
      again: () => start(settings),
      same: () => start(settings, lastSeed),
      menu,
    });
  }, 1800);
}

function cycleFollow(dir: number): void {
  if (!g) return;
  const alive = g.aliveChars();
  if (!alive.length) return;
  const i = alive.findIndex((c) => c.id === follow);
  follow = alive[(i + dir + alive.length) % alive.length].id;
  ui.toast(`Following ${fmt(g, `{c${follow}}`)}`, '', 1500);
}

// ---------- input ----------

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT') && (t as HTMLInputElement).type !== 'range') return;
  keys.add(e.code);
  if (mode !== 'play' || e.repeat) return;
  const spect = g && !g.player!.alive;
  switch (e.code) {
    case 'KeyE':
      spect ? cycleFollow(1) : use();
      break;
    case 'KeyR':
      report();
      break;
    case 'KeyQ':
      spect ? cycleFollow(-1) : primary();
      break;
    case 'KeyF':
      clean();
      break;
    case 'Digit1':
      spect ? (speed = 1) : sabotage('lights');
      break;
    case 'Digit2':
      spect ? (speed = 2) : sabotage('doors');
      break;
    case 'Digit3':
      spect ? (speed = 4) : sabotage('critical');
      break;
    case 'Digit4':
      if (spect) speed = 8;
      break;
    case 'KeyM':
    case 'Tab':
      e.preventDefault();
      showMap = !showMap;
      break;
    case 'Escape':
      if (mini && g) {
        closeMini();
        g.cancelAction(g.player!);
      }
      showMap = false;
      break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => renderer.resize());

// Handy for poking at a running round from the console.
(window as unknown as Record<string, unknown>).__hh = {
  get game() {
    return g;
  },
  start,
  /** Run the round forward without waiting for animation frames (testing aid). */
  advance(seconds: number) {
    for (let t = 0; t < seconds && mode === 'play'; t += STEP) logic(STEP);
    return mode;
  },
  keys,
  get settings() {
    return settings;
  },
};

let last = performance.now();
menu();
requestAnimationFrame(frame);

export type { GameEvent };
