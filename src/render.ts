// Canvas renderer: pre-rendered map, characters, fog of war, light, particles, overlay map.
import { CORRIDOR_BASE, DOOR, FLOOR, LOW, TALL, WALL, type GameMap, type Station } from './sim/map';
import type { Body, Char, Game } from './sim/game';

const TS = 32; // pre-render resolution per tile

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface DrawOpts {
  spectator: boolean;
  target: number; // character the action key would hit, -1 if none
  prompt: { x: number; y: number; text: string } | null;
  showMap: boolean;
  camX: number;
  camY: number;
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  g: Game | null = null;
  ts = 44;
  time = 0;
  private mapCanvas = document.createElement('canvas');
  private fogMask = document.createElement('canvas');
  private fogLayer = document.createElement('canvas');
  explored: Uint8Array = new Uint8Array(0);
  private particles: Particle[] = [];
  private visR = 7;
  private alpha: number[] = [];
  private poly: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.fogLayer.width = this.canvas.width;
    this.fogLayer.height = this.canvas.height;
    this.ts = Math.max(26, Math.min(64, Math.round(Math.min(this.canvas.width / 22, this.canvas.height / 14.5))));
  }

  setGame(g: Game): void {
    this.g = g;
    const m = g.map;
    this.explored = new Uint8Array(m.w * m.h);
    this.fogMask.width = m.w;
    this.fogMask.height = m.h;
    const f = this.fogMask.getContext('2d')!;
    f.fillStyle = '#000';
    f.fillRect(0, 0, m.w, m.h);
    this.particles = [];
    this.alpha = g.chars.map(() => 0);
    this.visR = g.settings.vision;
    this.prerender(m);
  }

  // ---------- static map art ----------

  private prerender(m: GameMap): void {
    const c = this.mapCanvas;
    c.width = m.w * TS;
    c.height = m.h * TS;
    const x = c.getContext('2d')!;
    const p = m.theme.palette;
    x.fillStyle = p.void;
    x.fillRect(0, 0, c.width, c.height);
    const tile = (tx: number, ty: number) => (m.inb(tx, ty) ? m.tiles[ty * m.w + tx] : WALL);
    const open = (tx: number, ty: number) => tile(tx, ty) !== WALL;
    const hash = (a: number, b: number) => {
      let h = (a * 374761393 + b * 668265263) ^ m.seed;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };

    // floors
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const t = tile(tx, ty);
        if (t === WALL) continue;
        const reg = m.region[ty * m.w + tx];
        const px = tx * TS;
        const py = ty * TS;
        const inRoom = reg >= 0 && reg < CORRIDOR_BASE;
        x.fillStyle = inRoom ? p.floors[m.rooms[reg].tint] : p.corridor;
        x.fillRect(px, py, TS, TS);
        x.fillStyle = `rgba(${hash(tx, ty) > 0.5 ? '255,255,255' : '0,0,0'},${(hash(ty, tx) * 0.05).toFixed(3)})`;
        x.fillRect(px, py, TS, TS);
        x.strokeStyle = p.floorLine;
        x.lineWidth = 1;
        x.beginPath();
        if (m.theme.floorStyle === 'planks' || m.theme.floorStyle === 'rugs') {
          for (let k = 0; k < 4; k++) {
            x.moveTo(px, py + k * 8 + 0.5);
            x.lineTo(px + TS, py + k * 8 + 0.5);
            const j = px + Math.floor(hash(tx * 4 + k, ty) * TS);
            x.moveTo(j + 0.5, py + k * 8);
            x.lineTo(j + 0.5, py + k * 8 + 8);
          }
        } else if (m.theme.floorStyle === 'plates') {
          x.rect(px + 0.5, py + 0.5, TS - 1, TS - 1);
          for (const [ox, oy] of [[4, 4], [TS - 4, 4], [4, TS - 4], [TS - 4, TS - 4]]) x.rect(px + ox - 0.5, py + oy - 0.5, 1, 1);
        } else {
          x.rect(px + 0.5, py + 0.5, TS / 2, TS / 2);
          x.rect(px + TS / 2 + 0.5, py + TS / 2 + 0.5, TS / 2, TS / 2);
        }
        x.stroke();
      }
    }

    // rugs / floor markings and room names
    for (const r of m.rooms) {
      if (r.kind === 'junction') continue;
      if (m.theme.floorStyle === 'rugs' || m.theme.id === 'manor') {
        if (r.w >= 5 && r.h >= 5) {
          x.fillStyle = `hsla(${Math.floor(hash(r.id, 7) * 360)},35%,32%,0.45)`;
          x.fillRect((r.x + 1.2) * TS, (r.y + 1.2) * TS, (r.w - 2.4) * TS, (r.h - 2.4) * TS);
          x.strokeStyle = 'rgba(255,230,180,0.22)';
          x.lineWidth = 2;
          x.strokeRect((r.x + 1.45) * TS, (r.y + 1.45) * TS, (r.w - 2.9) * TS, (r.h - 2.9) * TS);
        }
      } else {
        x.strokeStyle = 'rgba(255,255,255,0.07)';
        x.lineWidth = 3;
        x.strokeRect((r.x + 0.5) * TS, (r.y + 0.5) * TS, (r.w - 1) * TS, (r.h - 1) * TS);
      }
      x.save();
      x.font = `600 ${Math.min(20, Math.floor((r.w * TS) / (r.name.length * 0.62)))}px Georgia, serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillStyle = 'rgba(255,255,255,0.3)';
      x.fillText(r.name.toUpperCase(), (r.x + r.w / 2) * TS, (r.y + 0.75) * TS);
      x.restore();
    }

    // walls with a little depth: a lit face where a wall sits above floor
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        if (tile(tx, ty) !== WALL) continue;
        let edge = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (open(tx + dx, ty + dy)) edge = true;
        if (!edge) continue;
        const px = tx * TS;
        const py = ty * TS;
        x.fillStyle = p.wallTop;
        x.fillRect(px, py, TS, TS);
        if (open(tx, ty + 1)) {
          x.fillStyle = p.wallFace;
          x.fillRect(px, py + TS * 0.45, TS, TS * 0.55);
          x.fillStyle = p.wallEdge;
          x.fillRect(px, py + TS * 0.45, TS, 2);
          x.fillStyle = 'rgba(0,0,0,0.28)';
          x.fillRect(px, py + TS, TS, 6);
        }
        x.fillStyle = 'rgba(255,255,255,0.05)';
        if (open(tx - 1, ty)) x.fillRect(px, py, 2, TS);
        if (open(tx + 1, ty)) x.fillRect(px + TS - 2, py, 2, TS);
        if (open(tx, ty - 1)) x.fillRect(px, py, TS, 2);
      }
    }

    // doors and furniture
    for (const d of m.doors) {
      for (const t of d.tiles) {
        const px = (t % m.w) * TS;
        const py = Math.floor(t / m.w) * TS;
        x.fillStyle = 'rgba(0,0,0,0.25)';
        x.fillRect(px, py, TS, TS);
        x.fillStyle = p.door;
        if (d.horizontal) {
          x.fillRect(px, py + TS * 0.4, 4, TS * 0.2);
          x.fillRect(px + TS - 4, py + TS * 0.4, 4, TS * 0.2);
        } else {
          x.fillRect(px + TS * 0.4, py, TS * 0.2, 4);
          x.fillRect(px + TS * 0.4, py + TS - 4, TS * 0.2, 4);
        }
      }
    }
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const t = tile(tx, ty);
        if (t !== LOW && t !== TALL) continue;
        const px = tx * TS;
        const py = ty * TS;
        x.fillStyle = 'rgba(0,0,0,0.35)';
        x.fillRect(px + 3, py + 6, TS - 4, TS - 4);
        if (t === LOW) {
          const round = hash(tx, ty * 3) > 0.5;
          x.fillStyle = p.low;
          x.beginPath();
          if (round) x.arc(px + TS / 2, py + TS / 2, TS * 0.42, 0, Math.PI * 2);
          else x.roundRect(px + 3, py + 4, TS - 6, TS - 8, 4);
          x.fill();
          x.strokeStyle = 'rgba(255,255,255,0.14)';
          x.lineWidth = 1.5;
          x.stroke();
          x.fillStyle = p.accent;
          x.globalAlpha = 0.5;
          x.fillRect(px + TS / 2 - 3, py + TS / 2 - 3, 6, 6);
          x.globalAlpha = 1;
        } else {
          x.fillStyle = p.tall;
          x.fillRect(px + 2, py + 1, TS - 4, TS - 4);
          x.fillStyle = shade('#808080', -60);
          x.fillRect(px + 2, py + TS - 9, TS - 4, 6);
          x.strokeStyle = 'rgba(255,255,255,0.1)';
          x.lineWidth = 1;
          for (let k = 1; k < 3; k++) {
            x.beginPath();
            x.moveTo(px + 4, py + 1 + k * 7);
            x.lineTo(px + TS - 4, py + 1 + k * 7);
            x.stroke();
          }
        }
      }
    }

    for (const s of m.stations) this.drawStationArt(x, m, s);
  }

  private drawStationArt(x: CanvasRenderingContext2D, m: GameMap, s: Station): void {
    const p = m.theme.palette;
    const cx = (s.x + 0.5) * TS;
    const cy = (s.y + 0.5) * TS;
    if (s.kind === 'button') {
      x.fillStyle = 'rgba(0,0,0,0.4)';
      x.beginPath();
      x.arc(cx + 2, cy + 3, TS * 0.42, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#8a6a2a';
      x.beginPath();
      x.arc(cx, cy, TS * 0.42, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#e2b84f';
      x.beginPath();
      x.arc(cx, cy, TS * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#fff3c4';
      x.beginPath();
      x.arc(cx - 3, cy - 3, TS * 0.09, 0, Math.PI * 2);
      x.fill();
      return;
    }
    // A console pushed against its wall.
    const ox = cx + s.fx * TS * 0.3;
    const oy = cy + s.fy * TS * 0.3;
    const w = s.fx ? TS * 0.36 : TS * 0.8;
    const h = s.fx ? TS * 0.8 : TS * 0.36;
    x.fillStyle = 'rgba(0,0,0,0.4)';
    x.fillRect(ox - w / 2 + 2, oy - h / 2 + 3, w, h);
    x.fillStyle = s.kind === 'task' ? '#3b3f48' : s.kind === 'critical' ? '#5a2a2a' : '#4a4630';
    x.fillRect(ox - w / 2, oy - h / 2, w, h);
    x.strokeStyle = 'rgba(255,255,255,0.25)';
    x.lineWidth = 1;
    x.strokeRect(ox - w / 2 + 0.5, oy - h / 2 + 0.5, w - 1, h - 1);
    x.fillStyle = s.kind === 'task' ? p.accent : s.kind === 'critical' ? '#ff5b5b' : '#ffd84a';
    x.fillRect(ox - 3, oy - 3, 6, 6);
  }

  // ---------- particles ----------

  burst(x: number, y: number, color: string, n = 14, speed = 3): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.5, color, size: 0.05 + Math.random() * 0.08 });
    }
  }

  // ---------- frame ----------

  draw(dt: number, o: DrawOpts): void {
    const g = this.g;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!g) return;
    this.time += dt;
    const m = g.map;
    const ts = this.ts;
    const p = g.player;
    const spect = o.spectator || !p;
    const ox = Math.round(W / 2 - o.camX * ts);
    const oy = Math.round(H / 2 - o.camY * ts);
    const sx = (x: number) => ox + x * ts;
    const sy = (y: number) => oy + y * ts;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapCanvas, ox, oy, m.w * ts, m.h * ts);

    // locked doors
    for (const d of m.doors) {
      if (!d.lockedUntil) continue;
      for (const t of d.tiles) {
        const tx = t % m.w;
        const ty = Math.floor(t / m.w);
        ctx.fillStyle = '#7a1f1f';
        ctx.fillRect(sx(tx), sy(ty), ts, ts);
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx(tx) + 3, sy(ty) + 3, ts - 6, ts - 6);
        ctx.beginPath();
        ctx.moveTo(sx(tx) + 6, sy(ty) + 6);
        ctx.lineTo(sx(tx) + ts - 6, sy(ty) + ts - 6);
        ctx.moveTo(sx(tx) + ts - 6, sy(ty) + 6);
        ctx.lineTo(sx(tx) + 6, sy(ty) + ts - 6);
        ctx.stroke();
      }
    }

    // visibility
    let R = g.settings.vision;
    if (!spect && p) {
      const want = g.visionOf(p);
      this.visR += (want - this.visR) * Math.min(1, dt * 5);
      R = this.visR;
      this.computeVisibility(p.x, p.y, R);
    }
    const seen = (x: number, y: number) => spect || (p !== null && Math.hypot(x - p.x, y - p.y) <= R + 0.2 && m.los(p.x, p.y, x, y));

    // bodies
    for (const b of g.bodies) if (!b.gone && seen(b.x, b.y)) this.drawBody(g, b, sx(b.x), sy(b.y));

    // characters, back to front
    const order = g.chars.filter((c) => c.alive).sort((a, b) => a.y - b.y);
    for (const c of order) {
      const vis = c === p || seen(c.x, c.y);
      this.alpha[c.id] += ((vis ? 1 : 0) - this.alpha[c.id]) * Math.min(1, dt * 12);
      if (this.alpha[c.id] < 0.03) continue;
      this.drawChar(g, c, sx(c.x), sy(c.y), this.alpha[c.id], c.id === o.target, p);
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life += dt;
      if (q.life >= q.max) {
        this.particles.splice(i, 1);
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.92;
      q.vy *= 0.92;
      ctx.globalAlpha = 1 - q.life / q.max;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(sx(q.x), sy(q.y), q.size * ts, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!spect && p) this.drawFog(p, R, ox, oy);

    // things that read through the fog: station markers, names, prompts
    this.drawMarkers(g, p, spect, sx, sy);
    for (const c of order) {
      const a = this.alpha[c.id];
      if (a < 0.4) continue;
      this.drawName(g, c, sx(c.x), sy(c.y), a, p);
    }
    if (o.prompt) this.drawPrompt(sx(o.prompt.x), sy(o.prompt.y) - ts * 0.9, o.prompt.text);
    if (!spect && p) this.drawArrows(g, p, sx, sy);

    // mood overlays
    if (g.lightsOut() && !spect) {
      ctx.fillStyle = 'rgba(10,14,40,0.28)';
      ctx.fillRect(0, 0, W, H);
    }
    if (g.critical) {
      ctx.fillStyle = `rgba(255,30,30,${0.06 + 0.06 * Math.sin(this.time * 6)})`;
      ctx.fillRect(0, 0, W, H);
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (o.showMap) this.drawOverlayMap(g, p, spect);
  }

  private computeVisibility(px: number, py: number, R: number): void {
    const g = this.g!;
    const m = g.map;
    const RAYS = 300;
    const poly = this.poly;
    poly.length = 0;
    const f = this.fogMask.getContext('2d')!;
    const mark = (tx: number, ty: number) => {
      if (!m.inb(tx, ty)) return;
      const i = ty * m.w + tx;
      if (this.explored[i]) return;
      this.explored[i] = 1;
      f.clearRect(tx, ty, 1, 1);
    };
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const d = m.castRay(px, py, dx, dy, R);
      const reach = d < R ? d + 0.55 : d; // light the face of whatever the ray hit
      poly.push(px + dx * reach, py + dy * reach);
      for (let s = 0; s <= reach + 0.3; s += 0.45) mark(Math.floor(px + dx * s), Math.floor(py + dy * s));
    }
  }

  private drawFog(p: Char, R: number, ox: number, oy: number): void {
    const g = this.g!;
    const m = g.map;
    const ts = this.ts;
    const f = this.fogLayer.getContext('2d')!;
    const W = this.fogLayer.width;
    const H = this.fogLayer.height;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, H);
    f.fillStyle = 'rgba(3,5,10,0.74)'; // explored but not currently visible
    f.fillRect(0, 0, W, H);
    f.imageSmoothingEnabled = true;
    f.drawImage(this.fogMask, ox, oy, m.w * ts, m.h * ts); // never seen: solid black
    f.fillStyle = '#000';
    if (ox > 0) f.fillRect(0, 0, ox, H);
    if (oy > 0) f.fillRect(0, 0, W, oy);
    if (ox + m.w * ts < W) f.fillRect(ox + m.w * ts, 0, W - ox - m.w * ts, H);
    if (oy + m.h * ts < H) f.fillRect(0, oy + m.h * ts, W, H - oy - m.h * ts);
    f.globalCompositeOperation = 'destination-out';
    const cx = ox + p.x * ts;
    const cy = oy + p.y * ts;
    const grad = f.createRadialGradient(cx, cy, R * ts * 0.55, cx, cy, (R + 0.55) * ts);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = grad;
    f.beginPath();
    const poly = this.poly;
    for (let i = 0; i < poly.length; i += 2) {
      const x = ox + poly[i] * ts;
      const y = oy + poly[i + 1] * ts;
      if (i === 0) f.moveTo(x, y);
      else f.lineTo(x, y);
    }
    f.closePath();
    f.fill();
    f.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.fogLayer, 0, 0);
    // a warm pool of light around the player
    const ctx = this.ctx;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * ts * 0.8);
    glow.addColorStop(0, `rgba(${m.theme.palette.light},0.13)`);
    glow.addColorStop(1, `rgba(${m.theme.palette.light},0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.fillRect(cx - R * ts, cy - R * ts, R * ts * 2, R * ts * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawChar(g: Game, c: Char, x: number, y: number, alpha: number, targeted: boolean, p: Char | null): void {
    const ctx = this.ctx;
    const r = this.ts * 0.34;
    const bob = c.moving ? Math.sin(this.time * 14 + c.id) : 0;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.6, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (c === p) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.6, r * 1.2, r * 0.65, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (targeted) {
      ctx.strokeStyle = '#ff5b5b';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.time * 30;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const cs = Math.cos(c.dir);
    const sn = Math.sin(c.dir);
    // feet
    ctx.fillStyle = shade(c.color, -90);
    for (const side of [-1, 1]) {
      const f = side * bob * r * 0.28;
      ctx.beginPath();
      ctx.arc(x - sn * side * r * 0.45 + cs * f, y + cs * side * r * 0.45 + sn * f + r * 0.2, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    // cloak
    const yy = y - r * 0.15 - Math.abs(bob) * r * 0.06;
    ctx.fillStyle = c.color;
    ctx.strokeStyle = shade(c.color, -80);
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath();
    ctx.arc(x, yy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // hood
    const hx = x + cs * r * 0.22;
    const hy = yy + sn * r * 0.22;
    ctx.fillStyle = shade(c.color, 35);
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    // face shadow and eyes, turned toward the facing direction
    ctx.fillStyle = 'rgba(20,14,12,0.85)';
    ctx.beginPath();
    ctx.ellipse(hx + cs * r * 0.22, hy + sn * r * 0.22, r * 0.4, r * 0.34, c.dir, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hx + cs * r * 0.34 - sn * side * r * 0.16, hy + sn * r * 0.34 + cs * side * r * 0.16, r * 0.085, 0, Math.PI * 2);
      ctx.fill();
    }
    // busy at a console
    if (c.action) {
      const t = c.action.dur === Infinity ? (this.time * 0.5) % 1 : c.action.t / c.action.dur;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y - r * 1.9, r * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = c.action.kind === 'fix' ? '#ffd84a' : c.action.kind === 'clean' ? '#ff5b5b' : '#9fe870';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y - r * 1.9, r * 0.38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.05, Math.min(1, t)));
      ctx.stroke();
    }
    // the medic can see their own ward
    if (p && p.alive && p.role === 'medic' && p.wardTarget === c.id) {
      ctx.strokeStyle = `rgba(126,224,200,${0.5 + 0.3 * Math.sin(this.time * 4)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, yy, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    void g;
  }

  private drawName(g: Game, c: Char, x: number, y: number, alpha: number, p: Char | null): void {
    const ctx = this.ctx;
    const partner = !!p && p.team === 'murder' && c.team === 'murder' && c !== p;
    const fs = Math.max(11, Math.round(this.ts * 0.27));
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const label = c === p ? `${c.name} (you)` : c.name;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(label, x, y - this.ts * 0.62);
    ctx.fillStyle = partner ? '#ff7b7b' : !p || !p.alive ? (c.team === 'murder' ? '#ff7b7b' : '#fff') : '#fff';
    ctx.fillText(label, x, y - this.ts * 0.62);
    ctx.globalAlpha = 1;
    void g;
  }

  private drawBody(g: Game, b: Body, x: number, y: number): void {
    const ctx = this.ctx;
    const c = g.chars[b.victim];
    const r = this.ts * 0.34;
    ctx.fillStyle = 'rgba(120,10,10,0.75)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.2, y + r * 0.3, r * 1.5, r * 0.95, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.6 + b.id);
    ctx.fillStyle = shade(c.color, -30);
    ctx.strokeStyle = shade(c.color, -100);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.25, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade(c.color, 20);
    ctx.beginPath();
    ctx.arc(r * 0.8, 0, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a0f0f';
    ctx.lineWidth = 2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.85 - 3, s * r * 0.2 - 3);
      ctx.lineTo(r * 0.85 + 3, s * r * 0.2 + 3);
      ctx.moveTo(r * 0.85 + 3, s * r * 0.2 - 3);
      ctx.lineTo(r * 0.85 - 3, s * r * 0.2 + 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMarkers(g: Game, p: Char | null, spect: boolean, sx: (x: number) => number, sy: (y: number) => number): void {
    const ctx = this.ctx;
    const m = g.map;
    const ts = this.ts;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    for (const s of m.stations) {
      if (!spect && !this.explored[s.y * m.w + s.x]) continue;
      let color = '';
      if (s.kind === 'critical' && g.critical) color = '#ff4d4d';
      else if (s.kind === 'breaker' && g.lightsOut()) color = '#ffd84a';
      else if (s.kind === 'task' && p && p.alive && p.tasks.includes(s.id)) color = '#ffe66b';
      if (!color) continue;
      const x = sx(s.x + 0.5);
      const y = sy(s.y + 0.5);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45 + 0.5 * pulse;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, ts * (0.5 + 0.08 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.font = `900 ${Math.round(ts * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText('!', x, y - ts * 0.75 - pulse * 3);
      ctx.fillText('!', x, y - ts * 0.75 - pulse * 3);
    }
  }

  private drawPrompt(x: number, y: number, text: string): void {
    const ctx = this.ctx;
    const fs = Math.max(12, Math.round(this.ts * 0.3));
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(12,14,20,0.88)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - fs, w, fs * 1.9, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }

  /** Edge-of-screen pointers toward your remaining chores and any live emergency. */
  private drawArrows(g: Game, p: Char, sx: (x: number) => number, sy: (y: number) => number): void {
    if (!p.alive) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const targets: { s: Station; color: string }[] = [];
    for (const id of p.tasks) targets.push({ s: g.station(id), color: '#ffe66b' });
    if (g.critical) targets.push({ s: g.map.stationsOfKind('critical')[0], color: '#ff4d4d' });
    if (g.lightsOut()) targets.push({ s: g.map.stationsOfKind('breaker')[0], color: '#ffd84a' });
    const pad = 46;
    for (const t of targets) {
      const x = sx(t.s.x + 0.5);
      const y = sy(t.s.y + 0.5);
      if (x > pad && x < W - pad && y > pad && y < H - pad) continue;
      const a = Math.atan2(y - H / 2, x - W / 2);
      const k = Math.min((W / 2 - pad) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - pad) / Math.abs(Math.sin(a) || 1e-6));
      const ax = W / 2 + Math.cos(a) * k;
      const ay = H / 2 + Math.sin(a) * k;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -10);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawOverlayMap(g: Game, p: Char | null, spect: boolean): void {
    const ctx = this.ctx;
    const m = g.map;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = Math.min((W * 0.86) / m.w, (H * 0.8) / m.h);
    const x0 = (W - m.w * k) / 2;
    const y0 = (H - m.h * k) / 2;
    ctx.fillStyle = 'rgba(5,7,12,0.9)';
    ctx.fillRect(0, 0, W, H);
    const pal = m.theme.palette;
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = ty * m.w + tx;
        const t = m.tiles[i];
        if (t === WALL) continue;
        const reg = m.region[i];
        // You know the floor plan; places you have not walked yet are just drawn faintly.
        ctx.globalAlpha = spect || this.explored[i] ? 1 : 0.28;
        ctx.fillStyle = t === DOOR ? pal.door : t === FLOOR ? (reg >= CORRIDOR_BASE ? pal.corridor : pal.floors[m.rooms[reg]?.tint ?? 0]) : pal.low;
        ctx.fillRect(x0 + tx * k, y0 + ty * k, k + 0.5, k + 0.5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of m.rooms) {
      if (r.kind === 'junction' && !spect && !this.explored[r.cy * m.w + r.cx]) continue;
      ctx.font = `700 ${Math.max(10, Math.min(15, k * 1.25))}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(r.name, x0 + (r.x + r.w / 2) * k, y0 + (r.y + r.h / 2) * k);
      ctx.fillStyle = r.kind === 'junction' ? 'rgba(255,255,255,0.6)' : '#fff';
      ctx.fillText(r.name, x0 + (r.x + r.w / 2) * k, y0 + (r.y + r.h / 2) * k);
    }
    const dot = (x: number, y: number, color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x0 + x * k, y0 + y * k, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    const bell = g.station(0);
    dot(bell.x + 0.5, bell.y + 0.5, '#e2b84f', 5);
    if (p && p.alive) for (const id of p.tasks) dot(g.station(id).x + 0.5, g.station(id).y + 0.5, '#ffe66b', 5 + Math.sin(this.time * 5));
    if (g.critical) {
      const s = m.stationsOfKind('critical')[0];
      dot(s.x + 0.5, s.y + 0.5, '#ff4d4d', 7 + 2 * Math.sin(this.time * 8));
    }
    if (g.lightsOut()) {
      const s = m.stationsOfKind('breaker')[0];
      dot(s.x + 0.5, s.y + 0.5, '#ffd84a', 7 + 2 * Math.sin(this.time * 8));
    }
    if (spect) for (const c of g.chars) if (c.alive) dot(c.x, c.y, c.color, 4.5);
    if (p && p.alive) dot(p.x, p.y, '#fff', 6);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`${m.theme.name}  •  yellow: your chores   gold: emergency bell   white: you`, W / 2, y0 + m.h * k + 22);
  }

  /** Small standalone picture of the whole map, used by the recap. */
  thumbnail(maxW: number, maxH: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const k = Math.min(maxW / this.mapCanvas.width, maxH / this.mapCanvas.height);
    c.width = Math.round(this.mapCanvas.width * k);
    c.height = Math.round(this.mapCanvas.height * k);
    c.getContext('2d')!.drawImage(this.mapCanvas, 0, 0, c.width, c.height);
    return c;
  }
}
