// Tiny synthesized sound set. No audio files: everything is oscillators and filtered noise.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, slideTo?: number): void {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.2, freq = 800, when = 0): void {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  setMuted(m: boolean) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  },
  isMuted: () => muted,
  click: () => tone(520, 0.06, 'triangle', 0.12),
  step: () => noise(0.05, 0.035, 500),
  task: () => {
    tone(660, 0.12, 'triangle', 0.16);
    tone(880, 0.14, 'triangle', 0.16, 0.09);
    tone(1320, 0.22, 'triangle', 0.14, 0.18);
  },
  tick: () => tone(900, 0.04, 'square', 0.05),
  bad: () => tone(180, 0.18, 'sawtooth', 0.12, 0, 120),
  kill: () => {
    noise(0.25, 0.4, 300);
    tone(140, 0.4, 'sawtooth', 0.22, 0, 50);
  },
  scream: () => {
    tone(700, 0.35, 'sawtooth', 0.08, 0, 300);
    noise(0.3, 0.12, 1800);
  },
  bell: () => {
    for (let i = 0; i < 3; i++) {
      tone(784, 0.5, 'sine', 0.22, i * 0.28);
      tone(1568, 0.4, 'sine', 0.08, i * 0.28);
    }
  },
  alarm: () => {
    tone(440, 0.22, 'square', 0.1);
    tone(330, 0.22, 'square', 0.1, 0.25);
  },
  lights: () => {
    tone(300, 0.5, 'sawtooth', 0.14, 0, 40);
    noise(0.4, 0.15, 400);
  },
  fixed: () => {
    tone(330, 0.1, 'square', 0.1);
    tone(495, 0.18, 'square', 0.1, 0.1);
  },
  vote: () => tone(300, 0.08, 'square', 0.1),
  speak: () => tone(380 + Math.random() * 120, 0.05, 'triangle', 0.06),
  shot: () => {
    noise(0.18, 0.5, 2500);
    tone(90, 0.25, 'square', 0.2, 0, 40);
  },
  ward: () => {
    tone(523, 0.3, 'sine', 0.12);
    tone(784, 0.4, 'sine', 0.1, 0.1);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.16, i * 0.14)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, 'sawtooth', 0.1, i * 0.2)),
  reveal: () => {
    tone(196, 0.9, 'sine', 0.18);
    tone(294, 0.9, 'sine', 0.12, 0.05);
  },
};
