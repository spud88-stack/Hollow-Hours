// Finds, for each crowd size / murderer count / map size, the kill cooldown and chore count
// at which murderers win roughly 38% of all-AI rounds. Output feeds BALANCE in defs.ts.
//   npx tsx src/sim/calibrate.ts
import { defaultSettings, maxMurderers, pressureToRules, type MapSize, type Settings } from './defs';
import { Game } from './game';
import { autoMeeting } from './meeting';

const N = +(process.argv[2] ?? 80);
const TARGET = 0.38;

function murderRate(s: Settings, label: string): number {
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const g = new Game(s, `${label}-${i}`, { hasPlayer: false });
    while (g.state !== 'over' && g.time < 1500) {
      g.update(1 / 30);
      g.events.length = 0;
      if (g.state === 'meeting') autoMeeting(g);
    }
    if (g.winner === 'murder') wins++;
  }
  return wins / N;
}

const out: Record<string, number> = {};
for (const size of ['small', 'medium', 'large'] as MapSize[]) {
  for (const npc of [3, 5, 7, 9, 11, 14, 17, 20]) {
    for (let m = 1; m <= maxMurderers(npc + 1); m++) {
      let lo = 0;
      let hi = 1;
      let rate = 0;
      for (let k = 0; k < 5; k++) {
        const x = (lo + hi) / 2;
        const s: Settings = { ...defaultSettings(), autoBalance: false, npcCount: npc, murderers: m, size, ...pressureToRules(x) };
        rate = murderRate(s, `cal-${size}-${npc}-${m}-${k}`);
        if (rate < TARGET) lo = x;
        else hi = x;
      }
      const x = +((lo + hi) / 2).toFixed(2);
      out[`${size}:${m}:${npc}`] = x;
      console.log(`${size.padEnd(6)} npc ${String(npc).padStart(2)} m ${m}  pressure ${x}  ${JSON.stringify(pressureToRules(x))}  (last murder rate ${(rate * 100).toFixed(0)}%)`);
    }
  }
}
console.log(JSON.stringify(out));
