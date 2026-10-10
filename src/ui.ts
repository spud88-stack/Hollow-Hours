// DOM user interface: menu, role reveal, HUD, meetings, recap.
import { sfx } from './audio';
import { CIV_SPECIALS, ROLES, defaultSettings, maxMurderers, sanitizeSettings, testedMurderOdds, type RoleId, type Settings } from './sim/defs';
import type { Char, Game, GameEvent } from './sim/game';
import { finishMeeting, playerOptions, playerSay, runVote, specIsLie, step, type Meeting, type PlayerOptions, type PlayerSpec, type Reason, type Stmt } from './sim/meeting';
import { THEMES } from './sim/themes';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

export function h(tag: string, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') e.addEventListener(k, v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false) e.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) e.append(kid);
  return e;
}

const $ = (id: string) => document.getElementById(id)!;

/** Expand {c3} / {r5} tokens into coloured names and room labels. */
export function fmt(g: Game, text: string): string {
  return text
    .replace(/\{c(\d+)\}/g, (_, i) => {
      const c = g.chars[+i];
      return `<b class="nm" style="--c:${c.color}">${c.name}</b>`;
    })
    .replace(/\{r(-?\d+)\}/g, (_, i) => `<span class="rm">${g.map.regionName(+i)}</span>`);
}

const nameTag = (c: Char) => `<b class="nm" style="--c:${c.color}">${c.name}</b>`;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const STORE = 'hollow-hours-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    /* ignore corrupt storage */
  }
  return sanitizeSettings(defaultSettings());
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export interface HudButton {
  id: string;
  label: string;
  key: string;
  show: boolean;
  enabled: boolean;
  cd?: number;
  danger?: boolean;
  onClick: () => void;
}

export interface HudState {
  buttons: HudButton[];
  alert: string;
  location: string;
  spectator: boolean;
  speed: number;
}

export class UI {
  private overlay = $('overlay');
  private hud = $('hud');
  private meetingEl = $('meeting');
  private toasts = $('toasts');
  mini = $('mini');
  private btns = new Map<string, HTMLElement>();
  private lastTasks = '';
  onSpeed: (n: number) => void = () => {};

  // ---------- menu ----------

  showMenu(initial: Settings, onPlay: (s: Settings) => void): void {
    let s = sanitizeSettings(initial);
    this.hud.classList.remove('on');
    this.meetingEl.classList.remove('on');
    const ov = this.overlay;
    ov.className = 'on menu';
    const render = () => {
      s = sanitizeSettings(s);
      saveSettings(s);
      const total = s.npcCount + 1;
      const specials = Object.values(s.roleCounts).reduce((a, b) => a + b, 0);
      const plain = total - s.murderers - specials;
      const odds = testedMurderOdds(s.npcCount, s.murderers, s.size, s.roleCounts);
      const oddsText =
        `In all-AI test rounds of this setup the murderers won about ${odds}% of the time.` +
        (odds < 20 ? ' They are long shots here: add a murderer or trim the guest list for a closer fight.' : odds > 60 ? ' The guests are long shots here: add guests or remove a murderer for a closer fight.' : '');
      const set = (fn: (s: Settings) => void) => () => {
        fn(s);
        render();
      };
      const num = (label: string, value: number, min: number, max: number, stepV: number, apply: (v: number) => void, show: (v: number) => string = String, hint = '') => {
        const out = h('output', {}, show(value));
        const inp = h('input', {
          type: 'range',
          min,
          max,
          step: stepV,
          value,
          input: (e) => (out.textContent = show(+(e.target as HTMLInputElement).value)),
          change: (e) => {
            apply(+(e.target as HTMLInputElement).value);
            render();
          },
        });
        return h('label', { class: 'row', title: hint }, h('span', {}, label), inp, out);
      };
      const sel = (label: string, value: string, options: [string, string][], apply: (v: string) => void) =>
        h(
          'label',
          { class: 'row' },
          h('span', {}, label),
          h(
            'select',
            {
              change: (e) => {
                apply((e.target as HTMLSelectElement).value);
                render();
              },
            },
            ...options.map(([v, t]) => h('option', v === value ? { value: v, selected: true } : { value: v }, t)),
          ),
        );
      const stepper = (role: string, max: number) => {
        const n = s.roleCounts[role] ?? 0;
        const def = ROLES[role as RoleId];
        return h(
          'div',
          { class: 'role-row', title: def.blurb },
          h('span', { class: 'role-name', style: `color:${def.color}` }, def.name),
          h('span', { class: 'role-blurb' }, def.blurb),
          h('div', { class: 'stepper' }, h('button', { click: set((x) => (x.roleCounts[role] = Math.max(0, n - 1))) }, '−'), h('b', {}, String(n)), h('button', { click: set((x) => (x.roleCounts[role] = Math.min(max, n + 1))) }, '+')),
        );
      };
      const roleOptions: [string, string][] = [['random', 'Random']];
      for (const r of Object.keys(ROLES) as RoleId[]) {
        const inDeck = r === 'civilian' || (ROLES[r].team === 'murder' ? r === 'killer' || s.murdererVariants : (s.roleCounts[r] ?? 0) > 0);
        if (inDeck) roleOptions.push([r, ROLES[r].name]);
      }
      if (!roleOptions.some(([v]) => v === s.preferredRole)) s.preferredRole = 'random';

      ov.innerHTML = '';
      ov.append(
        h(
          'div',
          { class: 'menu-wrap' },
          h('header', {}, h('h1', {}, 'HOLLOW HOURS'), h('p', { class: 'tag' }, 'A murder-mystery for one. Everyone else is hiding something, and up to three of them are hiding a knife.')),
          h(
            'div',
            { class: 'menu-cols' },
            h(
              'section',
              { class: 'card' },
              h('h2', {}, 'The guest list'),
              num('Other guests (NPCs)', s.npcCount, 3, 20, 1, (v) => (s.npcCount = v)),
              num('Murderers', s.murderers, 1, 3, 1, (v) => (s.murderers = v), String, `Up to ${maxMurderers(total)} with ${total} people`),
              h('p', { class: 'note' }, `${total} people: ${s.murderers} murderer${s.murderers > 1 ? 's' : ''}, ${specials} with special roles, ${plain} ordinary guest${plain === 1 ? '' : 's'}.` + (s.murderers === maxMurderers(total) && s.murderers < 3 ? ' Add guests to allow more murderers.' : '')),
              sel('NPC sharpness', s.difficulty, [['easy', 'Easy: forgetful, careless'], ['normal', 'Normal'], ['hard', 'Hard: long memories, careful killers']], (v) => (s.difficulty = v as Settings['difficulty'])),
              sel('I want to play as', s.preferredRole, roleOptions, (v) => (s.preferredRole = v as Settings['preferredRole'])),
              h('h2', {}, 'The house'),
              sel('Setting', s.theme, [['random', 'Surprise me'], ...Object.values(THEMES).map((t) => [t.id, t.name] as [string, string])], (v) => (s.theme = v as Settings['theme'])),
              sel('Size', s.size, [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], (v) => (s.size = v as Settings['size'])),
              h(
                'label',
                { class: 'row' },
                h('span', {}, 'Map seed'),
                h('input', { type: 'text', value: s.seed, placeholder: 'blank = new map every round', maxlength: 40, change: (e) => (s.seed = (e.target as HTMLInputElement).value.trim()) && saveSettings(s), input: (e) => (s.seed = (e.target as HTMLInputElement).value.trim()) }),
              ),
              h('p', { class: 'note' }, 'The same seed and settings always build the same house and deal the same roles.'),
            ),
            h(
              'section',
              { class: 'card' },
              h('h2', {}, 'Special roles'),
              ...CIV_SPECIALS.map((r) => stepper(r, 2)),
              stepper('jester', 1),
              h(
                'label',
                { class: 'row check', title: 'Cleaner: can dispose of bodies. Framer: fools the Detective.' },
                h('input', s.murdererVariants ? { type: 'checkbox', checked: true, change: set((x) => (x.murdererVariants = !x.murdererVariants)) } : { type: 'checkbox', change: set((x) => (x.murdererVariants = !x.murdererVariants)) }),
                h('span', {}, 'Murderer variants (Cleaner, Framer)'),
              ),
            ),
            h(
              'section',
              { class: 'card' },
              h('h2', {}, 'House rules'),
              h(
                'label',
                { class: 'row check', title: 'Sets the kill cooldown and chore count to values that playtest evenly for this many guests and murderers.' },
                h('input', s.autoBalance ? { type: 'checkbox', checked: true, change: set((x) => (x.autoBalance = !x.autoBalance)) } : { type: 'checkbox', change: set((x) => (x.autoBalance = !x.autoBalance)) }),
                h('span', {}, 'Auto-balance for this crowd'),
              ),
              num('Kill cooldown', s.killCooldown, 10, 60, 1, (v) => ((s.killCooldown = v), (s.autoBalance = false)), (v) => `${v}s`),
              num('Chores per guest', s.tasks, 2, 14, 1, (v) => ((s.tasks = v), (s.autoBalance = false))),
              h('p', { class: 'note' }, s.autoBalance ? 'These two follow the guest list. Move either slider to take manual control.' : 'Manual rules. Tick auto-balance to go back to tested values.'),
              s.autoBalance ? h('p', { class: `note odds ${odds < 20 || odds > 60 ? 'warn' : ''}` }, oddsText) : null,
              num('Vision range', s.vision, 4, 11, 0.5, (v) => (s.vision = v), (v) => `${v} tiles`),
              num('Time to speak', s.discussTime, 0, 120, 5, (v) => (s.discussTime = v), (v) => (v ? `${v}s` : 'no limit')),
              num('Time to vote', s.voteTime, 0, 120, 5, (v) => (s.voteTime = v), (v) => (v ? `${v}s` : 'no limit')),
              h(
                'label',
                { class: 'row check' },
                h('input', s.revealRoles ? { type: 'checkbox', checked: true, change: set((x) => (x.revealRoles = !x.revealRoles)) } : { type: 'checkbox', change: set((x) => (x.revealRoles = !x.revealRoles)) }),
                h('span', {}, 'Reveal roles when someone is voted out'),
              ),
              h('button', { class: 'ghost', click: () => ((s = defaultSettings()), render()) }, 'Reset to defaults'),
              h('h2', {}, 'How to play'),
              h('div', {
                class: 'help',
                html:
                  '<kbd>WASD</kbd> move &nbsp; <kbd>E</kbd> use / chores / repairs &nbsp; <kbd>R</kbd> report a body<br>' +
                  '<kbd>Q</kbd> role action (kill, ward, shoot) &nbsp; <kbd>F</kbd> Cleaner: hide body<br>' +
                  '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> sabotage: lights, doors, critical &nbsp; <kbd>M</kbd> map<br><br>' +
                  'You only see what your character can see. In meetings, the others only know what <i>they</i> saw, so what you tell them, true or not, matters.',
              }),
            ),
          ),
          h('div', { class: 'menu-foot' }, h('button', { class: 'primary big', click: () => (sfx.click(), onPlay(sanitizeSettings(s))) }, 'Begin the evening')),
        ),
      );
    };
    render();
  }

  // ---------- role reveal ----------

  showReveal(g: Game, onDone: () => void): void {
    const p = g.player!;
    const def = ROLES[p.role];
    const partners = g.chars.filter((c) => c.team === 'murder' && c !== p);
    const ov = this.overlay;
    ov.className = 'on reveal';
    ov.innerHTML = '';
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', key);
      ov.className = '';
      onDone();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') go();
    };
    window.addEventListener('keydown', key);
    const { murder } = g.counts();
    ov.append(
      h(
        'div',
        { class: 'reveal-card', style: `--rc:${def.color}` },
        h('p', { class: 'where' }, `${g.map.theme.name}. ${g.map.theme.tagline}`),
        h('p', { class: 'youare', html: `You are ${nameTag(p)}, and tonight you are` }),
        h('h1', {}, p.team === 'murder' && p.role !== 'killer' ? `${def.name} (Murderer)` : def.name),
        h('p', { class: 'blurb' }, def.blurb),
        h('p', { class: 'goal' }, def.goal),
        p.team === 'murder' && partners.length ? h('p', { class: 'partners', html: `Your accomplice${partners.length > 1 ? 's' : ''}: ${partners.map((c) => `${nameTag(c)} (${ROLES[c.role].name})`).join(', ')}` }) : null,
        p.team !== 'murder' ? h('p', { class: 'partners' }, `There ${murder > 1 ? `are ${murder} murderers` : 'is 1 murderer'} among the ${g.chars.length} of you.`) : null,
        h('button', { class: 'primary', click: go }, 'Step inside'),
        h('p', { class: 'seed' }, `Map seed: ${g.seedText}`),
      ),
    );
    sfx.reveal();
  }

  // ---------- HUD ----------

  showHud(g: Game): void {
    this.overlay.className = '';
    this.hud.classList.add('on');
    this.btns.clear();
    this.lastTasks = '';
    $('actions').innerHTML = '';
    this.toasts.innerHTML = '';
    const p = g.player!;
    const def = ROLES[p.role];
    $('rolechip').innerHTML = `<span style="color:${def.color}">${def.name}</span> <small>${nameTag(p)}</small>`;
    $('rolechip').title = `${def.blurb}\n${def.goal}`;
    const mute = $('mute');
    mute.textContent = sfx.isMuted() ? 'Sound off' : 'Sound on';
    mute.onclick = () => {
      sfx.setMuted(!sfx.isMuted());
      mute.textContent = sfx.isMuted() ? 'Sound off' : 'Sound on';
    };
    const sp = $('spect');
    sp.innerHTML = '';
    sp.append(h('span', {}, 'You are dead. Watching: '), ...[1, 2, 4, 8].map((n) => h('button', { 'data-speed': n, click: () => this.onSpeed(n) }, `${n}×`)), h('span', { class: 'dim' }, '  WASD pans, Q/E follow someone, M shows everyone'));
  }

  updateHud(g: Game, st: HudState): void {
    const p = g.player!;
    const tp = g.taskProgress();
    ($('taskfill') as HTMLElement).style.width = `${tp.total ? (tp.done / tp.total) * 100 : 0}%`;
    $('tasklabel').textContent = `House chores ${tp.done}/${tp.total}`;

    // personal task list / objective
    let key: string;
    let html: string;
    if (!p.alive) {
      key = 'dead';
      html = `<div class="obj">You are out of the game, but your side can still win.</div>`;
    } else if (p.team === 'civ') {
      key = p.tasks.join(',');
      html = p.tasks.length ? p.tasks.map((id) => `<div class="task">${g.station(id).name} <small>${g.map.rooms[g.station(id).room].name}</small></div>`).join('') : `<div class="obj">Chores done. Stay alive and keep your eyes open.</div>`;
    } else if (p.team === 'murder') {
      const { murder, others } = g.counts();
      key = `m${murder}-${others}`;
      html = `<div class="obj">Kill ${others - murder} more to win. Any console lets you pretend to work (<kbd>E</kbd>).</div>`;
    } else {
      key = 'j';
      html = `<div class="obj">Get yourself voted out. Lie, lurk, act strange.</div>`;
    }
    if (key !== this.lastTasks) {
      this.lastTasks = key;
      $('tasklist').innerHTML = html;
    }

    const al = $('alert');
    al.textContent = st.alert;
    al.classList.toggle('on', !!st.alert);
    $('loc').textContent = st.location;
    const { murder, others } = g.counts();
    $('alive').textContent = `${murder + others} alive  •  ${clock(g.time)}`;

    const host = $('actions');
    for (const b of st.buttons) {
      let el = this.btns.get(b.id);
      if (!el) {
        el = h('button', { class: 'act' }, h('kbd', {}, b.key), h('span', { class: 'lbl' }, b.label), h('span', { class: 'cd' }));
        this.btns.set(b.id, el);
        host.append(el);
      }
      (el as unknown as { _b: HudButton })._b = b;
      el.onclick = () => {
        const cur = (el as unknown as { _b: HudButton })._b;
        if (cur.enabled) cur.onClick();
      };
      el.style.display = b.show ? '' : 'none';
      el.classList.toggle('off', !b.enabled);
      el.classList.toggle('danger', !!b.danger);
      el.querySelector('.lbl')!.textContent = b.label;
      el.querySelector('.cd')!.textContent = b.cd && b.cd > 0 ? `${Math.ceil(b.cd)}s` : '';
    }
    const sp = $('spect');
    sp.classList.toggle('on', st.spectator);
    if (st.spectator) sp.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', +b.dataset.speed! === st.speed));
  }

  toast(html: string, cls = '', ms = 5200): void {
    const t = h('div', { class: `toast ${cls}`, html });
    this.toasts.append(t);
    while (this.toasts.children.length > 6) this.toasts.firstChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  hideHud(): void {
    this.hud.classList.remove('on');
  }

  // ---------- meeting ----------

  openMeeting(g: Game, onDone: () => void): void {
    new MeetingView(g, this.meetingEl, onDone);
  }

  // ---------- recap ----------

  showRecap(g: Game, thumb: HTMLCanvasElement, tsPx: number, actions: { again: () => void; same: () => void; menu: () => void }): void {
    this.hud.classList.remove('on');
    const p = g.player!;
    const won = g.won(p);
    const ov = this.overlay;
    ov.className = 'on recap';
    ov.innerHTML = '';
    const side = g.winner === 'civ' ? 'The guests win' : g.winner === 'murder' ? 'The murderers win' : 'The Jester wins';
    const moments = g.log.filter((e) => e.text && e.kind !== 'task');
    const mapBox = h('div', { class: 'recap-map' });
    mapBox.append(thumb);
    const k = thumb.width / (g.map.w * tsPx);
    const pin = h('div', { class: 'pin' });
    mapBox.append(pin);
    const pins: HTMLElement[] = [];
    let n = 0;
    for (const e of moments) {
      if (e.x === undefined || (e.kind !== 'kill' && e.kind !== 'shot' && e.kind !== 'save')) continue;
      const d = h('div', { class: `mark ${e.kind}`, style: `left:${e.x * tsPx * k}px;top:${e.y! * tsPx * k}px` }, String(++n));
      pins.push(d);
      (e as GameEvent & { _n?: number })._n = n;
      mapBox.append(d);
    }
    const rows: HTMLElement[] = [];
    const list = h('div', { class: 'timeline' });
    const focus = (i: number) => {
      rows.forEach((r, j) => r.classList.toggle('sel', i === j));
      const e = moments[i];
      if (e && e.x !== undefined) {
        pin.style.display = 'block';
        pin.style.left = `${e.x * tsPx * k}px`;
        pin.style.top = `${e.y! * tsPx * k}px`;
      } else pin.style.display = 'none';
      rows[i]?.scrollIntoView({ block: 'nearest' });
    };
    moments.forEach((e, i) => {
      const num = (e as GameEvent & { _n?: number })._n;
      const row = h('div', { class: `ev ${e.kind}`, mouseenter: () => focus(i), click: () => focus(i) }, h('span', { class: 't' }, clock(e.t)), h('span', { class: 'x', html: (num ? `<i class="n">${num}</i> ` : '') + fmt(g, e.text) }));
      rows.push(row);
      list.append(row);
    });
    let playing = 0;
    const replay = h(
      'button',
      {
        class: 'ghost',
        click: () => {
          clearInterval(playing);
          let i = 0;
          focus(0);
          playing = window.setInterval(() => {
            if (++i >= moments.length) clearInterval(playing);
            else focus(i);
          }, 900);
        },
      },
      'Replay the night',
    );
    const cast = h('div', { class: 'cast' });
    for (const c of [...g.chars].sort((a, b) => (a.team === b.team ? 0 : a.team === 'murder' ? -1 : b.team === 'murder' ? 1 : a.team === 'neutral' ? -1 : 1))) {
      const fate = c.alive ? 'survived' : c.cause === 'murder' ? `killed by ${g.chars[c.killedBy].name}` : c.cause === 'ejected' ? 'voted out' : c.cause === 'shot' ? `shot by ${g.chars[c.killedBy].name}` : 'misfired';
      const extra = c.team === 'murder' ? `${c.kills} kill${c.kills === 1 ? '' : 's'}` : c.team === 'civ' ? `${c.tasksTotal - c.tasks.length}/${c.tasksTotal} chores` : '';
      cast.append(
        h('div', { class: `castrow ${c.alive ? '' : 'dead'} ${g.won(c) ? 'won' : ''}` }, h('span', { html: nameTag(c) + (c.isPlayer ? ' <small>(you)</small>' : ` <small class="dim">${c.brain?.pers.label ?? ''}</small>`) }), h('span', { style: `color:${ROLES[c.role].color}` }, ROLES[c.role].name), h('span', { class: 'dim' }, fate), h('span', { class: 'dim' }, extra)),
      );
    }
    ov.append(
      h(
        'div',
        { class: 'recap-wrap' },
        h('header', { class: won ? 'won' : 'lost' }, h('h1', {}, won ? 'You won' : 'You lost'), h('p', {}, `${side}. ${g.winReason}`), h('p', { class: 'dim' }, `${g.map.theme.name}  •  ${clock(g.time)}  •  seed: ${g.seedText}`)),
        h('div', { class: 'recap-cols' }, h('section', { class: 'card' }, h('h2', {}, 'Who was who'), cast), h('section', { class: 'card' }, h('h2', {}, 'How it happened'), mapBox, replay, list)),
        h('div', { class: 'menu-foot' }, h('button', { class: 'primary', click: actions.again }, 'New round'), h('button', { class: 'ghost', click: actions.same }, 'Same house again'), h('button', { class: 'ghost', click: actions.menu }, 'Change settings')),
      ),
    );
    if (won) sfx.win();
    else sfx.lose();
  }
}

// ---------- meeting view ----------

const REASON_LABEL: Record<Reason, string> = {
  witness: 'I saw them do it',
  attack: 'I saw them attack someone',
  scene: 'They were at the scene',
  withVictim: 'Last seen with the victim',
  nearBody: 'Standing by the body',
  lied: 'They lied about where they were',
  hunch: 'Just a feeling',
  agree: 'I agree with the room',
};

class MeetingView {
  private g: Game;
  private m: Meeting;
  private root: HTMLElement;
  private feed!: HTMLElement;
  private panel!: HTMLElement;
  private roster!: HTMLElement;
  private timerEl!: HTMLElement;
  private onDone: () => void;
  private fast = false;
  private shownRound = 0;
  private timer = 0;
  private tick = 0;
  private pick = -2;
  private spectating: boolean;
  private closed = false;

  constructor(g: Game, root: HTMLElement, onDone: () => void) {
    this.g = g;
    this.m = g.meeting!;
    this.root = root;
    this.onDone = onDone;
    this.spectating = !g.player!.alive;
    this.build();
    sfx.bell();
    for (const s of this.m.feed) this.addLine(s);
    setTimeout(() => this.advance(), 1100);
  }

  private build(): void {
    const { g, m, root } = this;
    root.innerHTML = '';
    root.classList.add('on');
    this.feed = h('div', { class: 'feed' });
    this.panel = h('div', { class: 'panel' });
    this.roster = h('div', { class: 'roster' });
    this.timerEl = h('div', { class: 'timer' });
    const fastBtn = h(
      'button',
      {
        class: 'ghost small',
        click: () => {
          this.fast = !this.fast;
          fastBtn.classList.toggle('sel', this.fast);
        },
      },
      'Fast forward',
    );
    root.append(
      h(
        'div',
        { class: 'meet' },
        h('header', {}, h('h2', {}, m.kind === 'body' ? 'A body has been found' : 'Emergency meeting'), h('span', { class: 'dim' }, this.spectating ? 'You are dead and can only listen.' : `You are ${g.player!.name}, ${ROLES[g.player!.role].name}`), fastBtn, this.timerEl),
        h('div', { class: 'meet-body' }, h('aside', {}, this.roster), h('main', {}, this.feed, this.panel)),
      ),
    );
    this.renderRoster();
  }

  private renderRoster(): void {
    const { g, m } = this;
    const p = g.player!;
    const voting = m.phase === 'vote' && !this.spectating;
    const res = m.result;
    this.roster.innerHTML = '';
    for (const c of g.chars) {
      const acc = (m.accusers.get(c.id) ?? []).length;
      const def = (m.defenders.get(c.id) ?? []).length;
      const votesFor = res ? g.chars.filter((v) => m.votes[v.id] === c.id) : [];
      const partner = p.team === 'murder' && c.team === 'murder' && c !== p;
      const wasAliveAtVote = res && m.votes[c.id] !== -2;
      const card = h(
        'div',
        {
          class: `rc ${c.alive || wasAliveAtVote ? '' : 'dead'} ${voting && c.alive && c !== p ? 'can' : ''} ${this.pick === c.id ? 'sel' : ''} ${res && res.ejected === c.id ? 'out' : ''}`,
          click: () => {
            if (!voting || !c.alive || c === p) return;
            this.pick = this.pick === c.id ? -2 : c.id;
            sfx.vote();
            this.renderRoster();
            this.renderVote();
          },
        },
        h('i', { class: 'dot', style: `background:${c.color}` }),
        h('span', { class: 'n' }, c.name + (c === p ? ' (you)' : '')),
        partner ? h('span', { class: 'tag red' }, 'accomplice') : null,
        g.publicInnocent.has(c.id) ? h('span', { class: 'tag green' }, 'cleared') : null,
        !res && acc ? h('span', { class: 'tag red', title: 'times accused this meeting' }, `accused ×${acc}`) : null,
        !res && def ? h('span', { class: 'tag green', title: 'times vouched for this meeting' }, `vouched ×${def}`) : null,
        res && votesFor.length ? h('span', { class: 'votes' }, ...votesFor.map((v) => h('i', { class: 'dot', title: v.name, style: `background:${v.color}` + (v.role === 'magistrate' && g.settings.revealRoles ? '' : '') }))) : null,
      );
      this.roster.append(card);
    }
    if (res) {
      const skips = g.chars.filter((v) => m.votes[v.id] === -1);
      this.roster.append(h('div', { class: 'rc skip' }, h('span', { class: 'n' }, 'Skipped'), h('span', { class: 'votes' }, ...skips.map((v) => h('i', { class: 'dot', title: v.name, style: `background:${v.color}` })))));
    }
  }

  private addLine(s: Stmt): void {
    const { g } = this;
    if (s.priv && this.spectating) return;
    let row: HTMLElement;
    if (s.by < 0) row = h('div', { class: `line sys ${s.priv ? 'priv' : ''}`, html: fmt(g, s.text) });
    else {
      const c = g.chars[s.by];
      const me = c.isPlayer;
      row = h('div', { class: `line ${me ? 'me' : ''} k-${s.kind}` }, h('i', { class: 'dot', style: `background:${c.color}` }), h('div', { class: 'bubble' }, h('b', { style: `color:${c.color}` }, c.name), h('span', { html: ' ' + fmt(g, s.text) }), me && s.lie ? h('em', { class: 'lie' }, 'lie') : null));
      sfx.speak();
    }
    this.feed.append(row);
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  private divider(text: string): void {
    this.feed.append(h('div', { class: 'line div' }, text));
  }

  private advance(): void {
    if (this.closed) return;
    const { g, m } = this;
    const st = step(g, m);
    if (m.round === 1 && this.shownRound === 0) {
      this.shownRound = 1;
      this.divider('Second round: replies');
    }
    if (st.type === 'stmt') {
      this.addLine(st.stmt);
      this.renderRoster();
      this.panel.innerHTML = '';
      this.panel.append(h('p', { class: 'dim wait' }, 'Listening…'));
      setTimeout(() => this.advance(), this.fast || this.spectating ? 260 : 1150);
    } else if (st.type === 'player') {
      this.renderRoster();
      this.playerTurn();
    } else {
      this.divider('Time to vote');
      this.renderRoster();
      if (this.spectating) setTimeout(() => this.castVote(null), 700);
      else {
        this.startTimer(g.settings.voteTime, () => this.castVote(null));
        this.renderVote();
      }
    }
  }

  private startTimer(seconds: number, onOut: () => void): void {
    clearInterval(this.tick);
    this.timerEl.textContent = '';
    if (!seconds) return;
    this.timer = seconds;
    const show = () => (this.timerEl.textContent = `${this.timer}s`);
    show();
    this.tick = window.setInterval(() => {
      this.timer--;
      show();
      if (this.timer <= 5 && this.timer > 0) sfx.tick();
      if (this.timer <= 0) {
        clearInterval(this.tick);
        this.timerEl.textContent = '';
        onOut();
      }
    }, 1000);
  }

  private stopTimer(): void {
    clearInterval(this.tick);
    this.timerEl.textContent = '';
  }

  // ----- the player's statement builder -----

  private playerTurn(): void {
    const { g, m } = this;
    const o = playerOptions(g, m);
    this.startTimer(g.settings.discussTime, () => this.speak({ kind: 'pass' }));
    this.renderChoices(o, null);
  }

  private speak(spec: PlayerSpec): void {
    this.stopTimer();
    const s = playerSay(this.g, this.m, spec);
    if (s) this.addLine(s);
    this.panel.innerHTML = '';
    this.renderRoster();
    setTimeout(() => this.advance(), 500);
  }

  private tagFor(spec: PlayerSpec): HTMLElement {
    if (spec.kind === 'accuse' && (spec.reason === 'hunch' || spec.reason === 'agree')) return h('em', { class: 'tg op' }, 'opinion');
    return specIsLie(this.g, this.m, spec) ? h('em', { class: 'tg lie' }, 'lie') : h('em', { class: 'tg true' }, 'true');
  }

  private opt(label: string, spec: PlayerSpec): HTMLElement {
    return h('button', { class: 'opt', click: () => (sfx.click(), this.speak(spec)) }, h('span', { html: label }), this.tagFor(spec));
  }

  private renderChoices(o: PlayerOptions, cat: string | null, target = -1): void {
    const { g, m } = this;
    const P = this.panel;
    P.innerHTML = '';
    const nm = (id: number) => nameTag(g.chars[id]);
    const rn = (r: number) => `<span class="rm">${g.map.regionName(r)}</span>`;
    const back = () => h('button', { class: 'ghost small', click: () => this.renderChoices(o, null) }, '‹ Back');
    const people = (onPick: (id: number) => void) =>
      h('div', { class: 'chips' }, ...o.others.map((id) => h('button', { class: 'chip', click: () => onPick(id) }, h('i', { class: 'dot', style: `background:${g.chars[id].color}` }), g.chars[id].name)));
    const roomSelect = (onPick: (r: number) => void, label: string) => {
      const s = h('select', {}, h('option', { value: '' }, label), ...o.rooms.map((r) => h('option', { value: r }, g.map.regionName(r)))) as HTMLSelectElement;
      s.onchange = () => s.value !== '' && onPick(+s.value);
      return s;
    };

    if (!cat) {
      // What you actually know, then what you might say.
      const facts: string[] = [];
      if (!o.emergency) facts.push(`You were in ${rn(o.whereTrue)}.`);
      for (const w of o.witnessed) facts.push(`You saw ${nm(w.killer)} kill ${nm(w.victim)}.`);
      for (const a of o.attacks) facts.push(`You saw ${nm(a.attacker)} attack ${nm(a.target)}.`);
      if (o.scene.length) facts.push(`At the scene around the time: ${o.scene.map(nm).join(', ')}.`);
      if (o.withVictim.length) facts.push(`Last seen with the victim: ${o.withVictim.map(nm).join(', ')}.`);
      if (o.nearBody.length) facts.push(`Near the body when you found it: ${o.nearBody.map(nm).join(', ')}.`);
      if (o.alibi.length) facts.push(`Elsewhere at the time: ${o.alibi.map((a) => `${nm(a.who)} (${g.map.regionName(a.region)})`).join(', ')}.`);
      if (o.clue) facts.push(`Your shortlist: ${o.clue.map(nm).join(', ')}.`);
      if (o.accusedBy.length) facts.push(`<b class="warn">You have been accused by ${o.accusedBy.map(nm).join(', ')}.</b>`);
      if (!facts.length) facts.push('You saw nothing useful this time.');
      P.append(h('div', { class: 'know', html: `<h4>What you know</h4>${facts.map((f) => `<p>${f}</p>`).join('')}` }));
      const cats: [string, string, boolean][] = [
        ['where', 'Say where I was', !o.emergency],
        ['saw', 'Say who I saw', true],
        ['accuse', 'Accuse someone', true],
        ['defend', 'Vouch for someone', !o.emergency],
        ['contradict', `Call out a lie${o.caught.length ? ` (${o.caught.length})` : ''}`, o.caught.length > 0],
        ['claim', 'Claim a role', true],
      ];
      P.append(
        h('h4', {}, m.round === 0 ? 'Your turn to speak' : 'Your reply'),
        h('div', { class: 'cats' }, ...cats.filter((c) => c[2]).map(([id, label]) => h('button', { class: `cat ${id === 'contradict' ? 'hot' : ''}`, click: () => this.renderChoices(o, id) }, label)), h('button', { class: 'cat quiet', click: () => this.speak({ kind: 'pass' }) }, 'Say nothing')),
      );
      return;
    }

    P.append(back());
    if (cat === 'where') {
      P.append(this.opt(`I was in ${rn(o.whereTrue)}`, { kind: 'where', region: o.whereTrue }), h('div', { class: 'liebox' }, 'Or claim to have been somewhere else: ', roomSelect((r) => this.speak({ kind: 'where', region: r }), 'choose a room…')));
    } else if (cat === 'saw') {
      if (!o.sawTrue.length) P.append(h('p', { class: 'dim' }, 'You did not see anyone around the time.'));
      for (const s of o.sawTrue.slice(0, 8)) P.append(this.opt(`I saw ${nm(s.who)} in ${rn(s.region)}`, { kind: 'saw', target: s.who, region: s.region }));
      if (target < 0) P.append(h('div', { class: 'liebox' }, 'Or invent a sighting of: ', people((id) => this.renderChoices(o, 'saw', id))));
      else P.append(h('div', { class: 'liebox', html: `Say you saw ${nm(target)} in: ` }, roomSelect((r) => this.speak({ kind: 'saw', target, region: r }), 'choose a room…')));
    } else if (cat === 'accuse') {
      if (target < 0) P.append(h('h4', {}, 'Accuse whom?'), people((id) => this.renderChoices(o, 'accuse', id)));
      else {
        P.append(h('h4', { html: `Accuse ${nm(target)}, because…` }));
        const reasons: Reason[] = o.emergency ? ['witness', 'attack', 'hunch'] : ['witness', 'scene', 'withVictim', 'nearBody', 'lied', 'hunch'];
        if (!o.emergency && o.attacks.some((a) => a.attacker === target)) reasons.unshift('attack');
        for (const r of reasons) P.append(this.opt(REASON_LABEL[r], { kind: 'accuse', target, reason: r }));
      }
    } else if (cat === 'defend') {
      for (const a of o.alibi.slice(0, 8)) P.append(this.opt(`It can't be ${nm(a.who)}, I saw them in ${rn(a.region)}`, { kind: 'defend', target: a.who, region: a.region }));
      if (target < 0) P.append(h('div', { class: 'liebox' }, 'Or give a false alibi to: ', people((id) => this.renderChoices(o, 'defend', id))));
      else P.append(h('div', { class: 'liebox', html: `Say you saw ${nm(target)} in: ` }, roomSelect((r) => this.speak({ kind: 'defend', target, region: r }), 'choose a room…')));
    } else if (cat === 'contradict') {
      for (const c of o.caught) P.append(this.opt(`${nm(c.who)} said ${c.claimed >= 0 ? rn(c.claimed) : 'otherwise'}, but I saw them in ${rn(c.region)}`, { kind: 'contradict', target: c.who, region: c.region }));
    } else if (cat === 'claim') {
      const roles: RoleId[] = ['civilian', ...CIV_SPECIALS];
      for (const r of roles) {
        if (r === 'detective') continue;
        P.append(this.opt(`I'm the ${ROLES[r].name}`, { kind: 'claim', role: r }));
      }
      if (o.role === 'detective' && o.clue) P.append(this.opt(`I'm the Detective, and my shortlist is ${o.clue.map(nm).join(', ')}`, { kind: 'claim', role: 'detective', clue: o.clue }));
      else if (o.role === 'detective') P.append(this.opt(`I'm the Detective`, { kind: 'claim', role: 'detective' }));
      else {
        // A fake detective needs a fake shortlist.
        const picked = new Set<number>();
        const box = h('div', { class: 'liebox' });
        const draw = () => {
          box.innerHTML = '';
          box.append(
            'Pose as the Detective. Pick up to three names for your "shortlist": ',
            h('div', { class: 'chips' }, ...o.others.map((id) => h('button', { class: `chip ${picked.has(id) ? 'sel' : ''}`, click: () => ((picked.has(id) ? picked.delete(id) : picked.size < 3 && picked.add(id)), draw()) }, h('i', { class: 'dot', style: `background:${g.chars[id].color}` }), g.chars[id].name))),
            h('button', { class: 'opt', click: () => this.speak({ kind: 'claim', role: 'detective', clue: [...picked] }) }, h('span', {}, 'Make the claim'), h('em', { class: 'tg lie' }, 'lie')),
          );
        };
        draw();
        P.append(box);
      }
    }
  }

  // ----- voting -----

  private renderVote(): void {
    const { g } = this;
    const P = this.panel;
    P.innerHTML = '';
    const chosen = this.pick >= 0 ? g.chars[this.pick] : null;
    P.append(
      h('h4', {}, 'Who should be voted out?'),
      h('p', { class: 'dim' }, 'Click a name on the left, or skip. A tie or a majority of skips means nobody leaves.'),
      h(
        'div',
        { class: 'cats' },
        h('button', chosen ? { class: 'primary', click: () => this.castVote(this.pick) } : { class: 'primary', disabled: true }, chosen ? `Vote out ${chosen.name}` : 'Pick someone'),
        h('button', { class: 'cat quiet', click: () => this.castVote(null) }, 'Skip vote'),
      ),
    );
  }

  private castVote(v: number | null): void {
    if (this.m.phase !== 'vote') return;
    this.stopTimer();
    const { g, m } = this;
    runVote(g, m, v);
    this.pick = -2;
    this.renderRoster();
    const res = m.result!;
    const ej = res.ejected >= 0 ? g.chars[res.ejected] : null;
    let html: string;
    if (!ej) html = res.tie ? 'The vote is tied. Nobody is voted out.' : 'The room votes to skip. Nobody is voted out.';
    else if (g.settings.revealRoles) html = fmt(g, g.log.filter((e) => e.kind === 'eject').pop()!.text);
    else html = `${nameTag(ej)} is voted out. Their role stays a secret.`;
    if (ej) sfx.kill();
    const P = this.panel;
    P.innerHTML = '';
    const go = () => {
      if (this.closed) return;
      this.closed = true;
      finishMeeting(g, m);
      this.root.classList.remove('on');
      this.root.innerHTML = '';
      this.onDone();
    };
    P.append(h('div', { class: `verdict ${ej && g.settings.revealRoles ? ((ej.team === 'murder') !== (g.player!.team === 'murder') ? 'good' : 'bad') : ''}`, html }), h('button', { class: 'primary', click: go }, g.state === 'over' ? 'See how it ended' : 'Back to the house'));
    if (this.spectating) setTimeout(go, this.fast ? 1200 : 3500);
  }
}
