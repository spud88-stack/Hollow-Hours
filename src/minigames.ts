// Four short chore minigames. Each takes a few seconds and can be abandoned by walking away.
import { sfx } from './audio';

export interface MiniHandle {
  close(): void;
}

const el = (tag: string, cls = '', text = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export const MINI_HINTS = ['Tap the numbers in order.', 'Stop the needle in the green, twice.', 'Watch the pattern, then repeat it.', 'Slide each lever onto its mark.'];

export function openMinigame(kind: number, title: string, host: HTMLElement, onDone: () => void): MiniHandle {
  host.innerHTML = '';
  host.classList.add('open');
  const box = el('div', 'mini');
  box.append(el('h3', '', title), el('p', 'mini-hint', MINI_HINTS[kind % 4]));
  const area = el('div', 'mini-area');
  box.append(area, el('p', 'mini-foot', 'Move to walk away.'));
  host.append(box);
  let alive = true;
  const timers: number[] = [];
  let raf = 0;
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => alive && fn(), ms));
  const finish = () => {
    if (!alive) return;
    box.classList.add('done');
    sfx.task();
    later(() => {
      close();
      onDone();
    }, 350);
  };
  const close = () => {
    alive = false;
    timers.forEach(clearTimeout);
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    host.classList.remove('open');
    host.innerHTML = '';
  };
  let onKey = (_e: KeyboardEvent) => {};

  switch (kind % 4) {
    case 0: {
      // numbers in order
      area.classList.add('mini-grid');
      const order = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
      let next = 1;
      for (const n of order) {
        const b = el('button', 'mini-num', String(n));
        b.onclick = () => {
          if (n === next) {
            b.classList.add('ok');
            (b as HTMLButtonElement).disabled = true;
            sfx.tick();
            if (++next > 6) finish();
          } else {
            sfx.bad();
            next = 1;
            area.querySelectorAll('button').forEach((x) => {
              x.classList.remove('ok');
              (x as HTMLButtonElement).disabled = false;
            });
          }
        };
        area.append(b);
      }
      break;
    }
    case 1: {
      // timing
      const bar = el('div', 'mini-bar');
      const zone = el('div', 'mini-zone');
      const needle = el('div', 'mini-needle');
      bar.append(zone, needle);
      const btn = el('button', 'mini-go', 'STOP  (Space)');
      const pips = el('div', 'mini-pips', '○ ○');
      area.append(bar, btn, pips);
      let hits = 0;
      let z0 = 0.4;
      const place = () => {
        z0 = 0.15 + Math.random() * 0.6;
        zone.style.left = `${z0 * 100}%`;
      };
      place();
      const t0 = performance.now();
      const at = () => 0.5 + 0.5 * Math.sin(((performance.now() - t0) / 1000) * (2.6 + hits * 0.8));
      const loop = () => {
        needle.style.left = `${at() * 100}%`;
        raf = requestAnimationFrame(loop);
      };
      loop();
      const stop = () => {
        const pos = at();
        needle.style.left = `${pos * 100}%`;
        if (pos >= z0 - 0.01 && pos <= z0 + 0.19) {
          hits++;
          sfx.tick();
          pips.textContent = hits === 1 ? '● ○' : '● ●';
          if (hits >= 2) finish();
          else place();
        } else {
          sfx.bad();
          hits = 0;
          pips.textContent = '○ ○';
        }
      };
      btn.onclick = stop;
      onKey = (e) => {
        if (e.code === 'Space') {
          e.preventDefault();
          stop();
        }
      };
      window.addEventListener('keydown', onKey);
      break;
    }
    case 2: {
      // repeat the pattern
      area.classList.add('mini-pads');
      const colors = ['#e5484d', '#3e63dd', '#46a758', '#f5c518'];
      const pads = colors.map((c) => {
        const b = el('button', 'mini-pad');
        b.style.background = c;
        area.append(b);
        return b as HTMLButtonElement;
      });
      const seq = Array.from({ length: 4 }, () => Math.floor(Math.random() * 4));
      let input = 0;
      let locked = true;
      const flash = (i: number) => {
        pads[i].classList.add('lit');
        sfx.tick();
        later(() => pads[i].classList.remove('lit'), 260);
      };
      const play = () => {
        locked = true;
        input = 0;
        seq.forEach((s, k) => later(() => flash(s), 350 + k * 420));
        later(() => (locked = false), 350 + seq.length * 420);
      };
      pads.forEach((b, i) => {
        b.onclick = () => {
          if (locked) return;
          flash(i);
          if (seq[input] === i) {
            if (++input >= seq.length) finish();
          } else {
            sfx.bad();
            play();
          }
        };
      });
      play();
      break;
    }
    default: {
      // levers
      area.classList.add('mini-sliders');
      const targets = [0, 1, 2].map(() => 10 + Math.floor(Math.random() * 80));
      const inputs: HTMLInputElement[] = [];
      const check = () => {
        let ok = true;
        inputs.forEach((inp, i) => {
          const good = Math.abs(+inp.value - targets[i]) <= 4;
          inp.parentElement!.classList.toggle('ok', good);
          if (!good) ok = false;
        });
        if (ok) finish();
      };
      targets.forEach((t) => {
        const row = el('div', 'mini-slider');
        const mark = el('div', 'mini-mark');
        mark.style.left = `${t}%`;
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = '0';
        inp.max = '100';
        inp.value = String(t > 50 ? 5 : 95);
        inp.oninput = check;
        row.append(mark, inp);
        inputs.push(inp);
        area.append(row);
      });
      break;
    }
  }
  return { close };
}
