import * as THREE from 'three';
import type { TrackDef } from '../data/tracks';
import { clamp, wrapAngle } from '../core/utils';

export type Surface = 'asphalt' | 'curb' | 'grass' | 'gravel' | 'sand';

export interface TrackQuery {
  index: number;
  s: number;
  lateral: number;
  height: number;
  slope: number;
  tx: number;
  tz: number;
  surface: Surface;
  wallL: number;
  wallR: number;
  curbSide: number; // -1 right, +1 left, 0 none
}

export const PHYS = {
  g: 9.81,
  gripBase: 1.55,
  downforce: 0.0042,
  brakeNominal: 27,
};

/** Lateral limit of grip at speed v for a given grip multiplier (m/s²). */
export function lateralLimit(v: number, grip: number) {
  return grip * (PHYS.gripBase * PHYS.g + PHYS.downforce * v * v);
}

/**
 * Immutable circuit description built from a TrackDef: uniformly spaced centreline samples,
 * frame vectors, walls, curbs, run-off surfaces, racing line and AI speed profile.
 */
export class Track {
  readonly N: number;
  readonly ds: number;
  readonly length: number;
  readonly hw: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly curv: Float32Array;
  readonly wallL: Float32Array;
  readonly wallR: Float32Array;
  readonly curbL: Uint8Array;
  readonly curbR: Uint8Array;
  readonly gravelL: Uint8Array;
  readonly gravelR: Uint8Array;
  readonly line: Float32Array; // racing line lateral offset
  readonly lineCurv: Float32Array;
  readonly cornerLimit: Float32Array; // curvature-only speed limit along racing line
  readonly profile: Float32Array; // braking-aware speed profile
  readonly zone: Uint8Array; // 0 green, 1 yellow, 2 red
  readonly outsideSign: number; // +1 if the left side of the start straight is outside the loop
  readonly minH: number;
  readonly maxH: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly checkpoints: number[];
  readonly runoffSurface: Surface;
  private grid = new Map<number, number[]>();
  private readonly cell = 24;

  constructor(readonly def: TrackDef) {
    const pts = def.points.map((p) => new THREE.Vector3(p[0], p[2] ?? 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const L = curve.getLength();
    const N = Math.round(L / 2);
    const sp = curve.getSpacedPoints(N);
    sp.pop();
    this.N = N;
    this.length = L;
    this.ds = L / N;
    this.hw = def.halfWidth;
    this.runoffSurface = def.theme === 'desert' ? 'sand' : def.theme === 'city' || def.theme === 'metro' ? 'asphalt' : 'grass';
    const alloc = () => new Float32Array(N);
    this.px = alloc();
    this.py = alloc();
    this.pz = alloc();
    this.tx = alloc();
    this.tz = alloc();
    this.curv = alloc();
    this.wallL = alloc();
    this.wallR = alloc();
    this.line = alloc();
    this.lineCurv = alloc();
    this.cornerLimit = alloc();
    this.profile = alloc();
    this.curbL = new Uint8Array(N);
    this.curbR = new Uint8Array(N);
    this.gravelL = new Uint8Array(N);
    this.gravelR = new Uint8Array(N);
    this.zone = new Uint8Array(N);

    let minH = Infinity;
    let maxH = -Infinity;
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < N; i++) {
      this.px[i] = sp[i].x;
      this.py[i] = sp[i].y;
      this.pz[i] = sp[i].z;
      minH = Math.min(minH, sp[i].y);
      maxH = Math.max(maxH, sp[i].y);
      b.minX = Math.min(b.minX, sp[i].x);
      b.maxX = Math.max(b.maxX, sp[i].x);
      b.minZ = Math.min(b.minZ, sp[i].z);
      b.maxZ = Math.max(b.maxZ, sp[i].z);
    }
    this.minH = minH;
    this.maxH = maxH;
    this.bounds = b;

    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 1);
      const c = this.wrap(i + 1);
      const dx = this.px[c] - this.px[a];
      const dz = this.pz[c] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    // Signed curvature (+ = left turn) from heading change, lightly smoothed.
    const raw = alloc();
    const k = 3;
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - k);
      const c = this.wrap(i + k);
      const ha = Math.atan2(this.tx[a], this.tz[a]);
      const hc = Math.atan2(this.tx[c], this.tz[c]);
      raw[i] = wrapAngle(hc - ha) / (2 * k * this.ds);
    }
    this.smoothInto(raw, this.curv, 4);

    // Which side of the start straight faces the outside of the loop
    const nx = this.tz[0];
    const nz = -this.tx[0];
    this.outsideSign = this.insideLoop(this.px[0] + nx * 60, this.pz[0] + nz * 60) ? -1 : 1;

    this.buildWalls();
    this.buildCurbs();
    this.buildRacingLine();
    this.buildSpeedProfile(PHYS.brakeNominal, 1.0);

    const K = 12;
    this.checkpoints = [];
    for (let i = 1; i <= K; i++) this.checkpoints.push((L * i) / K);

    for (let i = 0; i < N; i++) {
      const key = this.cellKey(this.px[i], this.pz[i]);
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }
  }

  wrap(i: number) {
    return ((i % this.N) + this.N) % this.N;
  }

  wrapS(s: number) {
    return ((s % this.length) + this.length) % this.length;
  }

  private smoothInto(src: Float32Array, dst: Float32Array, r: number) {
    for (let i = 0; i < this.N; i++) {
      let sum = 0;
      for (let o = -r; o <= r; o++) sum += src[this.wrap(i + o)];
      dst[i] = sum / (2 * r + 1);
    }
  }

  private insideLoop(x: number, z: number) {
    let inside = false;
    for (let i = 0, j = this.N - 1; i < this.N; j = i++) {
      const xi = this.px[i];
      const zi = this.pz[i];
      const xj = this.px[j];
      const zj = this.pz[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  private isStartStraight(i: number) {
    const s = i * this.ds;
    return s < 170 || s > this.length - 280;
  }

  private buildWalls() {
    const N = this.N;
    const hw = this.hw;
    const run = this.def.runoff;
    const street = this.def.theme === 'city' || this.def.theme === 'metro';
    const tmpL = new Float32Array(N);
    const tmpR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = this.curv[i];
      const outsideExtra = street ? Math.min(4, Math.abs(k) * 300) : Math.min(16, Math.abs(k) * 900);
      let l = hw + run + (k < 0 ? outsideExtra : 0);
      let r = hw + run + (k > 0 ? outsideExtra : 0);
      if (this.isStartStraight(i)) {
        // Tight pit wall on the pit side; grandstand side stays open.
        if (this.outsideSign > 0) l = hw + 4.5;
        else r = hw + 4.5;
      }
      tmpL[i] = l;
      tmpR[i] = r;
    }
    this.smoothInto(tmpL, this.wallL, 12);
    this.smoothInto(tmpR, this.wallR, 12);
    // Inside of tight corners must never exceed the local radius (ribbons would fold).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        let maxK = 0;
        for (let o = -6; o <= 6; o++) maxK = Math.max(maxK, Math.abs(this.curv[this.wrap(i + o)]));
        const lim = maxK > 1e-4 ? 0.75 / maxK : 1e9;
        const k = this.curv[i];
        if (k > 0) this.wallL[i] = Math.max(hw + 2.5, Math.min(this.wallL[i], lim));
        if (k < 0) this.wallR[i] = Math.max(hw + 2.5, Math.min(this.wallR[i], lim));
      }
    }
  }

  private buildCurbs() {
    const N = this.N;
    const ext = Math.round(14 / this.ds);
    const street = this.def.theme === 'city' || this.def.theme === 'metro';
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.curv[i]);
      if (k > 1 / 200) {
        for (let o = -ext; o <= ext; o++) {
          const j = this.wrap(i + o);
          this.curbL[j] = 1;
          this.curbR[j] = 1;
        }
      }
      if (!street && k > 1 / 110 && this.def.theme !== 'desert') {
        const extG = Math.round(30 / this.ds);
        for (let o = -extG / 2; o <= extG; o++) {
          const j = this.wrap(i + o);
          if (this.curv[i] > 0) this.gravelR[j] = 1;
          else this.gravelL[j] = 1;
        }
      }
    }
    // keep start/finish clean
    for (let i = 0; i < N; i++) if (this.isStartStraight(i)) this.curbL[i] = this.curbR[i] = this.gravelL[i] = this.gravelR[i] = 0;
  }

  private buildRacingLine() {
    const N = this.N;
    const lim = this.hw - 1.5;
    const off = this.line;
    off.fill(0);
    const schedule: [number, number][] = [
      [24, 160],
      [12, 160],
      [6, 140],
      [3, 80],
    ];
    for (const [k, iters] of schedule) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const a = this.wrap(i - k);
          const c = this.wrap(i + k);
          const ax = this.px[a] + this.tz[a] * off[a];
          const az = this.pz[a] - this.tx[a] * off[a];
          const cx = this.px[c] + this.tz[c] * off[c];
          const cz = this.pz[c] - this.tx[c] * off[c];
          const mx = (ax + cx) / 2 - this.px[i];
          const mz = (az + cz) / 2 - this.pz[i];
          const target = mx * this.tz[i] - mz * this.tx[i];
          off[i] = clamp(off[i] + (target - off[i]) * 0.55, -lim, lim);
        }
      }
    }
    // curvature of the racing line itself
    const hx = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 2);
      const c = this.wrap(i + 2);
      const ax = this.px[a] + this.tz[a] * off[a];
      const az = this.pz[a] - this.tx[a] * off[a];
      const cx = this.px[c] + this.tz[c] * off[c];
      const cz = this.pz[c] - this.tx[c] * off[c];
      hx[i] = Math.atan2(cx - ax, cz - az);
    }
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.wrap(i - 3);
      const c = this.wrap(i + 3);
      raw[i] = wrapAngle(hx[c] - hx[a]) / (6 * this.ds);
    }
    this.smoothInto(raw, this.lineCurv, 3);
  }

  /** Corner speed limits on the racing line + backward braking pass. */
  buildSpeedProfile(brake: number, grip: number, vmax = 95, out?: { limit: Float32Array; profile: Float32Array }) {
    const N = this.N;
    const limit = out?.limit ?? this.cornerLimit;
    const prof = out?.profile ?? this.profile;
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.lineCurv[i]);
      const denom = k - grip * PHYS.downforce;
      limit[i] = denom <= 1e-5 ? vmax : Math.min(vmax, Math.sqrt((grip * PHYS.gripBase * PHYS.g) / denom));
    }
    prof.set(limit);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const nxt = prof[this.wrap(i + 1)];
        const v = Math.sqrt(nxt * nxt + 2 * brake * this.ds);
        if (v < prof[i]) prof[i] = v;
      }
    }
    if (!out) {
      const look = Math.round(55 / this.ds);
      for (let i = 0; i < N; i++) this.zone[i] = prof[i] < limit[i] - 1.5 ? 2 : limit[i] < vmax * 0.82 ? 1 : 0;
      // pre-warn ahead of braking zones
      const z2 = this.zone.slice();
      for (let i = 0; i < N; i++) {
        if (z2[i] === 2 && z2[this.wrap(i - 1)] !== 2) {
          for (let o = 1; o <= look; o++) {
            const j = this.wrap(i - o);
            if (this.zone[j] === 0) this.zone[j] = 1;
          }
        }
      }
    }
  }

  private cellKey(x: number, z: number) {
    return Math.floor(x / this.cell) * 73856093 + Math.floor(z / this.cell) * 19349663;
  }

  /** Approximate distance from a point to the centreline (for prop placement). */
  distanceToCenter(x: number, z: number, maxCells = 6): number {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    for (let r = 0; r <= maxCells; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          const arr = this.grid.get(ix * 73856093 + iz * 19349663);
          if (!arr) continue;
          for (const i of arr) {
            const d = Math.hypot(this.px[i] - x, this.pz[i] - z);
            if (d < best) best = d;
          }
        }
      }
      if (best < (r - 0.5) * this.cell) break;
    }
    return best;
  }

  /** Projection of a world point onto the track using a local search around `hint`. */
  project(x: number, z: number, hint: number, out: TrackQuery): TrackQuery {
    const N = this.N;
    let best = -1;
    let bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    } else {
      for (let o = -30; o <= 30; o++) {
        const i = this.wrap(hint + o);
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    // refine on the adjacent segment
    let i0 = best;
    let t = (x - this.px[best]) * this.tx[best] + (z - this.pz[best]) * this.tz[best];
    if (t < 0) {
      i0 = this.wrap(best - 1);
      t += this.ds;
    }
    const f = clamp(t / this.ds, 0, 1);
    const i1 = this.wrap(i0 + 1);
    const cx = this.px[i0] + (this.px[i1] - this.px[i0]) * f;
    const cz = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * f;
    const ttx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * f;
    const ttz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * f;
    const tl = Math.hypot(ttx, ttz) || 1;
    const nx = ttz / tl;
    const nz = -ttx / tl;
    const lat = (x - cx) * nx + (z - cz) * nz;
    out.index = best;
    out.s = (i0 + f) * this.ds;
    out.lateral = lat;
    out.height = this.py[i0] + (this.py[i1] - this.py[i0]) * f;
    out.slope = (this.py[i1] - this.py[i0]) / this.ds;
    out.tx = ttx / tl;
    out.tz = ttz / tl;
    out.wallL = this.wallL[i0];
    out.wallR = this.wallR[i0];
    const al = Math.abs(lat);
    const left = lat > 0;
    out.curbSide = 0;
    if (al <= this.hw) out.surface = 'asphalt';
    else if (al <= this.hw + 1.4 && (left ? this.curbL[i0] : this.curbR[i0])) {
      out.surface = 'curb';
      out.curbSide = left ? 1 : -1;
    } else if (al > this.hw + 3 && (left ? this.gravelL[i0] : this.gravelR[i0])) out.surface = 'gravel';
    else out.surface = this.runoffSurface;
    return out;
  }

  /** World position at distance s with lateral offset (left positive). */
  pointAt(s: number, lateral: number, out: THREE.Vector3) {
    const f = this.wrapS(s) / this.ds;
    const i0 = Math.floor(f) % this.N;
    const i1 = this.wrap(i0 + 1);
    const t = f - Math.floor(f);
    const cx = this.px[i0] + (this.px[i1] - this.px[i0]) * t;
    const cz = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * t;
    const tx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const tz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.set(cx + (tz / l) * lateral, this.py[i0] + (this.py[i1] - this.py[i0]) * t, cz - (tx / l) * lateral);
    return out;
  }

  headingAt(s: number) {
    const i = Math.floor(this.wrapS(s) / this.ds) % this.N;
    return Math.atan2(this.tx[i], this.tz[i]);
  }

  sampleAt(arr: Float32Array, s: number) {
    const f = this.wrapS(s) / this.ds;
    const i0 = Math.floor(f) % this.N;
    const i1 = this.wrap(i0 + 1);
    const t = f - Math.floor(f);
    return arr[i0] + (arr[i1] - arr[i0]) * t;
  }

  /** Heights for a sorted set of brake points (used for distance boards). */
  brakingPoints(): number[] {
    const res: number[] = [];
    for (let i = 0; i < this.N; i++) {
      if (this.zone[i] === 2 && this.zone[this.wrap(i - 1)] !== 2) {
        const drop = this.profile[i] - Math.min(...Array.from({ length: 40 }, (_, o) => this.profile[this.wrap(i + o)]));
        if (drop > 18) res.push(i * this.ds);
      }
    }
    return res;
  }
}
