import { Rng } from './rng';
import { THEMES, type Theme, type ThemeId } from './themes';
import type { MapSize } from './defs';

export const WALL = 0;
export const FLOOR = 1;
export const DOOR = 2;
export const LOW = 3; // furniture: blocks movement, not sight
export const TALL = 4; // furniture: blocks both

export const CORRIDOR_BASE = 1000;
export const UNREACHABLE = 65535;

export interface Room {
  id: number;
  name: string;
  kind: 'room' | 'junction' | 'hub';
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  doors: number[];
  floor: number[]; // walkable tile indices
  tint: number;
}

export interface Door {
  id: number;
  room: number;
  tiles: number[];
  lockedUntil: number;
  horizontal: boolean; // true when the doorway sits in a horizontal wall (you walk through it vertically)
}

export type StationKind = 'task' | 'breaker' | 'critical' | 'button';

export interface Station {
  id: number;
  x: number;
  y: number;
  room: number;
  name: string;
  kind: StationKind;
  mini: number;
  fx: number; // direction of the wall it hugs
  fy: number;
}

export interface Corridor {
  a: number;
  b: number;
}

export class GameMap {
  w = 0;
  h = 0;
  tiles!: Uint8Array;
  region!: Int16Array;
  doorAt!: Int16Array;
  blockMove!: Uint8Array;
  blockSight!: Uint8Array;
  rooms: Room[] = [];
  doors: Door[] = [];
  stations: Station[] = [];
  corridors: Corridor[] = [];
  theme!: Theme;
  hub = 0;
  seed = 0;
  private fields = new Map<number, Uint16Array>();

  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  walkable(x: number, y: number): boolean {
    if (!this.inb(x, y)) return false;
    const t = this.tiles[y * this.w + x];
    return t === FLOOR || t === DOOR;
  }
  regionAt(x: number, y: number): number {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.inb(tx, ty)) return -1;
    return this.region[ty * this.w + tx];
  }
  regionName(r: number): string {
    if (r < 0) return 'somewhere';
    if (r >= CORRIDOR_BASE) {
      const c = this.corridors[r - CORRIDOR_BASE];
      return `${this.rooms[c.a].name}–${this.rooms[c.b].name} passage`;
    }
    return this.rooms[r].name;
  }
  /** Rooms touching a region: for a room, its neighbours; for a corridor, both ends. */
  nearRegions(r: number): number[] {
    if (r < 0) return [];
    if (r >= CORRIDOR_BASE) {
      const c = this.corridors[r - CORRIDOR_BASE];
      return [c.a, c.b];
    }
    const out: number[] = [];
    this.corridors.forEach((c, i) => {
      if (c.a === r || c.b === r) out.push(CORRIDOR_BASE + i);
    });
    return out;
  }

  setDoorLocked(door: Door, locked: boolean): void {
    for (const t of door.tiles) {
      this.blockMove[t] = locked ? 1 : 0;
      this.blockSight[t] = locked ? 1 : 0;
    }
  }

  /** Distance field (cost 10 straight / 14 diagonal) to a tile. Ignores door locks. Cached. */
  field(tx: number, ty: number): Uint16Array {
    const key = ty * this.w + tx;
    let f = this.fields.get(key);
    if (f) return f;
    if (this.fields.size > 600) this.fields.clear();
    f = this.computeField(key);
    this.fields.set(key, f);
    return f;
  }

  clearFields(): void {
    this.fields.clear();
  }

  private computeField(target: number): Uint16Array {
    const { w, h, tiles } = this;
    const dist = new Uint16Array(w * h).fill(UNREACHABLE);
    const heap: number[] = [];
    const push = (v: number) => {
      let i = heap.length;
      heap.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p] <= v) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = v;
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      const n = heap.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = i * 2 + 1;
          if (c >= n) break;
          if (c + 1 < n && heap[c + 1] < heap[c]) c++;
          if (heap[c] >= last) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      return top;
    };
    const ok = (i: number) => tiles[i] === FLOOR || tiles[i] === DOOR;
    dist[target] = 0;
    push(target);
    while (heap.length) {
      const v = pop();
      const d = Math.floor(v / 8192);
      const i = v % 8192;
      if (d > dist[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!ok(ni)) continue;
          if (dx && dy && (!ok(y * w + nx) || !ok(ny * w + x))) continue;
          const nd = d + (dx && dy ? 14 : 10);
          if (nd < dist[ni]) {
            dist[ni] = nd;
            push(nd * 8192 + ni);
          }
        }
      }
    }
    return dist;
  }

  /** Distance to the first sight-blocking tile along a ray, capped at maxD. */
  castRay(x: number, y: number, dx: number, dy: number, maxD: number): number {
    const { w, h, blockSight } = this;
    let tx = Math.floor(x);
    let ty = Math.floor(y);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const tdx = adx > 1e-9 ? 1 / adx : Infinity;
    const tdy = ady > 1e-9 ? 1 / ady : Infinity;
    let tmx = adx > 1e-9 ? (dx > 0 ? tx + 1 - x : x - tx) / adx : Infinity;
    let tmy = ady > 1e-9 ? (dy > 0 ? ty + 1 - y : y - ty) / ady : Infinity;
    for (;;) {
      let t: number;
      if (tmx < tmy) {
        t = tmx;
        tx += sx;
        tmx += tdx;
      } else {
        t = tmy;
        ty += sy;
        tmy += tdy;
      }
      if (t >= maxD) return maxD;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return t;
      if (blockSight[ty * w + tx]) return t;
    }
  }

  los(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return true;
    return this.castRay(x0, y0, dx / d, dy / d, d) >= d - 0.02;
  }

  stationsOfKind(kind: StationKind): Station[] {
    return this.stations.filter((s) => s.kind === kind);
  }
}

class UF {
  p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    while (this.p[a] !== a) a = this.p[a] = this.p[this.p[a]];
    return a;
  }
  union(a: number, b: number): boolean {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return false;
    this.p[a] = b;
    return true;
  }
}

export function generateMap(seed: number, themeId: ThemeId, size: MapSize): GameMap {
  for (let attempt = 0; attempt < 50; attempt++) {
    const m = tryGenerate((seed + attempt * 7919) >>> 0, themeId, size);
    if (m) {
      m.seed = seed;
      return m;
    }
  }
  throw new Error('map generation failed');
}

function tryGenerate(seed: number, themeId: ThemeId, size: MapSize): GameMap | null {
  const rng = new Rng(seed);
  const theme = THEMES[themeId];
  const { cols, rows, cellW, cellH } = theme.layouts[size];
  const cw = theme.corridorW;
  const lm = cw + 1; // margin before a room inside its cell (leaves space for corridor trunks)
  const rm = 1;
  const m = new GameMap();
  m.theme = theme;
  m.w = cols * cellW + 2;
  m.h = rows * cellH + 2;
  const n = m.w * m.h;
  m.tiles = new Uint8Array(n);
  m.region = new Int16Array(n).fill(-1);
  m.doorAt = new Int16Array(n).fill(-1);

  // --- assign cells to rooms (the hub may span several cells) ---
  const cellRoom = new Int16Array(cols * rows).fill(-1);
  const [mw, mh] = [Math.min(theme.hubMerge[0], cols), Math.min(theme.hubMerge[1], rows)];
  const hx = Math.floor((cols - mw) / 2);
  const hy = Math.floor((rows - mh) / 2);
  interface Proto {
    kind: Room['kind'];
    c0: number;
    r0: number;
    cs: number;
    rs: number;
    deg: number;
  }
  const protos: Proto[] = [{ kind: 'hub', c0: hx, r0: hy, cs: mw, rs: mh, deg: 0 }];
  for (let r = hy; r < hy + mh; r++) for (let c = hx; c < hx + mw; c++) cellRoom[r * cols + c] = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellRoom[r * cols + c] >= 0) continue;
      cellRoom[r * cols + c] = protos.length;
      protos.push({ kind: rng.chance(theme.junctionP) ? 'junction' : 'room', c0: c, r0: r, cs: 1, rs: 1, deg: 0 });
    }
  }

  // --- choose connections: random spanning tree plus some loops ---
  interface Edge {
    c: number;
    r: number;
    horiz: boolean; // connects (c,r) to (c+1,r) if horiz, else to (c,r+1)
    a: number;
    b: number;
  }
  const all: Edge[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = cellRoom[r * cols + c];
      if (c + 1 < cols && cellRoom[r * cols + c + 1] !== a) all.push({ c, r, horiz: true, a, b: cellRoom[r * cols + c + 1] });
      if (r + 1 < rows && cellRoom[(r + 1) * cols + c] !== a) all.push({ c, r, horiz: false, a, b: cellRoom[(r + 1) * cols + c] });
    }
  }
  rng.shuffle(all);
  const uf = new UF(protos.length);
  const edges: Edge[] = [];
  const spare: Edge[] = [];
  for (const e of all) (uf.union(e.a, e.b) ? edges : spare).push(e);
  for (const e of spare) if (rng.chance(theme.loopP)) edges.push(e);
  for (const e of edges) {
    protos[e.a].deg++;
    protos[e.b].deg++;
  }
  // A junction with a single exit is just a pointless stub; make it a real (dead-end) room.
  for (const p of protos) if (p.kind === 'junction' && p.deg < 2) p.kind = 'room';

  // --- room rectangles ---
  const names = rng.shuffle([...theme.rooms]);
  const jnames = rng.shuffle([...theme.junctions]);
  let ni = 0;
  let ji = 0;
  for (let i = 0; i < protos.length; i++) {
    const p = protos[i];
    const x0 = 1 + p.c0 * cellW + lm;
    const y0 = 1 + p.r0 * cellH + lm;
    const aw = p.cs * cellW - lm - rm;
    const ah = p.rs * cellH - lm - rm;
    let w: number, h: number;
    if (p.kind === 'junction') {
      w = 3;
      h = 3;
    } else if (p.kind === 'hub') {
      w = aw - rng.int(0, 1);
      h = ah - rng.int(0, 1);
    } else {
      w = rng.int(Math.max(4, Math.ceil(aw * theme.fillMin)), aw);
      h = rng.int(Math.max(4, Math.ceil(ah * theme.fillMin)), ah);
    }
    const x = x0 + rng.int(0, aw - w);
    const y = y0 + rng.int(0, ah - h);
    const name = p.kind === 'hub' ? theme.hub : p.kind === 'junction' ? jnames[ji++] ?? `Passage ${ji}` : names[ni++] ?? `Room ${ni}`;
    m.rooms.push({ id: i, name, kind: p.kind, x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), doors: [], floor: [], tint: rng.int(0, theme.palette.floors.length - 1) });
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        m.tiles[yy * m.w + xx] = FLOOR;
        m.region[yy * m.w + xx] = i;
      }
    }
  }
  m.hub = 0;

  // --- corridors ---
  const carve = (x: number, y: number, reg: number) => {
    const i = y * m.w + x;
    if (m.tiles[i] === WALL) m.tiles[i] = FLOOR;
    if (m.region[i] < 0) m.region[i] = reg;
  };
  const addDoor = (room: Room, tiles: number[], horizontal: boolean) => {
    if (room.kind === 'junction') return;
    const d: Door = { id: m.doors.length, room: room.id, tiles, lockedUntil: 0, horizontal };
    for (const t of tiles) {
      m.tiles[t] = DOOR;
      m.doorAt[t] = d.id;
    }
    m.doors.push(d);
    room.doors.push(d.id);
  };
  const pickSpan = (aLo: number, aHi: number, bLo: number, bHi: number): [number, number] => {
    const lo = Math.max(aLo, bLo);
    const hi = Math.min(aHi, bHi);
    if (lo <= hi && rng.chance(0.7)) {
      const v = rng.int(lo, hi);
      return [v, v];
    }
    return [rng.int(aLo, aHi), rng.int(bLo, bHi)];
  };
  for (const e of edges) {
    const A = m.rooms[e.a];
    const B = m.rooms[e.b];
    const reg = CORRIDOR_BASE + m.corridors.length;
    m.corridors.push({ a: e.a, b: e.b });
    if (e.horiz) {
      const rowLo = 1 + e.r * cellH + lm;
      const rowHi = 1 + e.r * cellH + cellH - 1 - rm - (cw - 1);
      const [ya, yb] = pickSpan(Math.max(A.y, rowLo), Math.min(A.y + A.h - cw, rowHi), Math.max(B.y, rowLo), Math.min(B.y + B.h - cw, rowHi));
      const mid = 1 + (e.c + 1) * cellW;
      const ax = A.x + A.w;
      const bx = B.x - 1;
      for (let k = 0; k < cw; k++) {
        for (let x = ax; x <= mid + cw - 1; x++) carve(x, ya + k, reg);
        for (let x = mid; x <= bx; x++) carve(x, yb + k, reg);
        for (let y = Math.min(ya, yb); y <= Math.max(ya, yb) + cw - 1; y++) carve(mid + k, y, reg);
      }
      addDoor(A, Array.from({ length: cw }, (_, k) => (ya + k) * m.w + ax), false);
      addDoor(B, Array.from({ length: cw }, (_, k) => (yb + k) * m.w + bx), false);
    } else {
      const colLo = 1 + e.c * cellW + lm;
      const colHi = 1 + e.c * cellW + cellW - 1 - rm - (cw - 1);
      const [xa, xb] = pickSpan(Math.max(A.x, colLo), Math.min(A.x + A.w - cw, colHi), Math.max(B.x, colLo), Math.min(B.x + B.w - cw, colHi));
      const mid = 1 + (e.r + 1) * cellH;
      const ay = A.y + A.h;
      const by = B.y - 1;
      for (let k = 0; k < cw; k++) {
        for (let y = ay; y <= mid + cw - 1; y++) carve(xa + k, y, reg);
        for (let y = mid; y <= by; y++) carve(xb + k, y, reg);
        for (let x = Math.min(xa, xb); x <= Math.max(xa, xb) + cw - 1; x++) carve(x, mid + k, reg);
      }
      addDoor(A, Array.from({ length: cw }, (_, k) => ay * m.w + xa + k), true);
      addDoor(B, Array.from({ length: cw }, (_, k) => by * m.w + xb + k), true);
    }
  }

  // --- stations ---
  const isDoorNear = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.inb(x + dx, y + dy) && m.tiles[(y + dy) * m.w + x + dx] === DOOR) return true;
    return false;
  };
  const taken = new Set<number>();
  const edgeSpots = (r: Room) => {
    const out: { x: number; y: number; fx: number; fy: number }[] = [];
    for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
      out.push({ x, y: r.y, fx: 0, fy: -1 });
      out.push({ x, y: r.y + r.h - 1, fx: 0, fy: 1 });
    }
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
      out.push({ x: r.x, y, fx: -1, fy: 0 });
      out.push({ x: r.x + r.w - 1, y, fx: 1, fy: 0 });
    }
    return rng.shuffle(out.filter((s) => !isDoorNear(s.x, s.y) && m.tiles[(s.y + s.fy) * m.w + s.x + s.fx] === WALL));
  };
  const place = (r: Room, name: string, kind: StationKind): boolean => {
    for (const s of edgeSpots(r)) {
      let clash = false;
      for (const t of taken) {
        const tx = t % m.w;
        const ty = (t - tx) / m.w;
        if (Math.abs(tx - s.x) + Math.abs(ty - s.y) < 3) clash = true;
      }
      if (clash) continue;
      taken.add(s.y * m.w + s.x);
      m.stations.push({ id: m.stations.length, x: s.x, y: s.y, room: r.id, name, kind, mini: rng.int(0, 3), fx: s.fx, fy: s.fy });
      return true;
    }
    return false;
  };
  const taskNames = rng.shuffle([...theme.tasks]);
  let ti = 0;
  const hub = m.rooms[m.hub];
  m.stations.push({ id: 0, x: hub.cx, y: hub.cy, room: hub.id, name: 'Emergency Bell', kind: 'button', mini: 0, fx: 0, fy: 0 });
  taken.add(hub.cy * m.w + hub.cx);
  const realRooms = m.rooms.filter((r) => r.kind !== 'junction');
  for (const r of realRooms) {
    const count = r.kind === 'hub' ? 1 : 2;
    for (let k = 0; k < count; k++) place(r, taskNames[ti++ % taskNames.length], 'task');
  }
  // The critical system lives as far from the hub as the layout allows; the breaker somewhere else.
  const hubField = m.field(hub.cx, hub.cy);
  const others = realRooms.filter((r) => r.kind === 'room').sort((a, b) => hubField[b.cy * m.w + b.cx] - hubField[a.cy * m.w + a.cx]);
  if (others.length < 2) return null;
  if (!place(others[0], theme.critical, 'critical')) return null;
  const breakerRoom = others[1 + rng.int(0, Math.max(0, Math.min(others.length - 2, 3)))];
  if (!place(breakerRoom, theme.breaker, 'breaker')) return null;
  if (m.stationsOfKind('task').length < 6) return null;

  // --- furniture: isolated single tiles, so it can never cut a room in two ---
  for (const r of realRooms) {
    if (r.w < 5 || r.h < 5) continue;
    const want = Math.round(r.w * r.h * theme.furniture * rng.range(0.6, 1.5));
    for (let k = 0, tries = 0; k < want && tries < want * 8; tries++) {
      const x = rng.int(r.x + 1, r.x + r.w - 2);
      const y = rng.int(r.y + 1, r.y + r.h - 2);
      if (Math.abs(x - r.cx) <= 1 && Math.abs(y - r.cy) <= 1) continue;
      let free = true;
      for (let dy = -1; dy <= 1 && free; dy++) for (let dx = -1; dx <= 1; dx++) if (m.tiles[(y + dy) * m.w + x + dx] !== FLOOR) free = false;
      if (!free) continue;
      m.tiles[y * m.w + x] = rng.chance(0.4) ? TALL : LOW;
      k++;
    }
  }

  // --- derived data ---
  m.blockMove = new Uint8Array(n);
  m.blockSight = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = m.tiles[i];
    m.blockMove[i] = t === FLOOR || t === DOOR ? 0 : 1;
    m.blockSight[i] = t === WALL || t === TALL ? 1 : 0;
    if (t === FLOOR && m.region[i] >= 0 && m.region[i] < CORRIDOR_BASE) m.rooms[m.region[i]].floor.push(i);
  }
  m.clearFields();

  // --- validate: everything walkable must be reachable from the hub ---
  const f = m.field(hub.cx, hub.cy);
  for (let i = 0; i < n; i++) if (!m.blockMove[i] && f[i] === UNREACHABLE) return null;
  return m;
}
