import type { SeasonDef } from '../data/seasons';
import { mulberry32 } from '../core/utils';

/**
 * Painted, living season backdrops (Canvas 2D). The static layers are rendered once per size into an
 * offscreen canvas; only the weather particles animate per frame, so browsing seasons stays smooth.
 */

const staticCache = new Map<string, HTMLCanvasElement>();

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function bez(p0: number, p1: number, p2: number, t: number) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

export function paintStatic(s: SeasonDef, w: number, h: number): HTMLCanvasElement {
  const key = `${s.id}|${w}|${h}`;
  const hit = staticCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const a = s.art;
  const r = mulberry32(s.id.length * 977 + 13);
  const hy = h * 0.6; // horizon

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, a.skyTop);
  sky.addColorStop(1, a.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hy + h * 0.09);

  // Sun / light source
  const sunY = s.id === 'desert' ? h * 0.2 : s.id === 'summer' ? h * 0.18 : s.id === 'rainy' ? h * 0.24 : h * 0.44;
  const sunX = s.id === 'autumn' ? w * 0.3 : w * 0.72;
  const glowR = Math.max(w, h) * (s.id === 'rainy' ? 0.35 : 0.5);
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowR);
  glow.addColorStop(0, s.id === 'rainy' ? 'rgba(220,235,245,0.35)' : a.sun);
  glow.addColorStop(0.08, s.id === 'rainy' ? 'rgba(220,235,245,0.18)' : hexA(a.sun, 0.75));
  glow.addColorStop(0.35, hexA(a.sun, s.id === 'rainy' ? 0.05 : 0.22));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, hy);
  if (s.id !== 'rainy') {
    ctx.fillStyle = a.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.min(w, h) * (s.id === 'winter' ? 0.035 : 0.045), 0, Math.PI * 2);
    ctx.fill();
  }

  // Clouds
  const clouds = s.id === 'rainy' ? 26 : s.id === 'summer' ? 7 : s.id === 'desert' ? 2 : 10;
  for (let i = 0; i < clouds; i++) {
    const cx = r() * w;
    const cy = (s.id === 'rainy' ? 0.05 + r() * 0.35 : 0.08 + r() * 0.3) * h;
    const cw = (0.12 + r() * 0.22) * w;
    const ch = cw * (0.18 + r() * 0.12);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw);
    const col = s.id === 'rainy' ? `rgba(${70 + r() * 40},${80 + r() * 40},${92 + r() * 40},0.55)` : s.id === 'autumn' ? 'rgba(255,214,180,0.5)' : 'rgba(255,255,255,0.6)';
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ch / cw);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, cw, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Far range: mountains or dunes
  ctx.fillStyle = a.far;
  ctx.beginPath();
  const farBase = hy + h * 0.09;
  const peaks: [number, number, number][] = [];
  ctx.moveTo(0, farBase);
  ctx.lineTo(0, hy);
  if (s.id === 'desert') {
    for (let x = 0; x <= w; x += w / 60) ctx.lineTo(x, hy - h * (0.05 + 0.04 * Math.sin(x / w * 7 + 1) + 0.025 * Math.sin(x / w * 17)));
  } else {
    let x = 0;
    while (x <= w) {
      const peak = h * (0.08 + r() * (s.id === 'winter' ? 0.2 : 0.13));
      const span = w * (0.06 + r() * 0.08);
      ctx.lineTo(x + span / 2, hy - peak);
      peaks.push([x + span / 2, hy - peak, span]);
      ctx.lineTo(x + span, hy - peak * (0.3 + r() * 0.3));
      x += span;
    }
  }
  ctx.lineTo(w, hy);
  ctx.lineTo(w, farBase);
  ctx.closePath();
  ctx.fill();
  if (a.far && (s.id === 'winter' || s.id === 'rainy')) {
    // snow caps (winter) / misted summits (monsoon)
    ctx.fillStyle = s.id === 'winter' ? '#f8fbff' : 'rgba(200,210,220,0.35)';
    for (const [px, py, span] of peaks) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - span * 0.17, py + span * 0.2);
      ctx.lineTo(px - span * 0.05, py + span * 0.16);
      ctx.lineTo(px + span * 0.04, py + span * 0.22);
      ctx.lineTo(px + span * 0.17, py + span * 0.19);
      ctx.closePath();
      ctx.fill();
    }
  }
  // atmospheric haze over the range
  const haze = ctx.createLinearGradient(0, hy - h * 0.3, 0, hy);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(1, hexA(a.skyBottom, 0.32));
  ctx.fillStyle = haze;
  ctx.fillRect(0, hy - h * 0.3, w, h * 0.3);

  // Mid hills + tree line
  ctx.fillStyle = a.mid;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, hy + h * 0.02 - h * 0.03 * Math.sin(x / w * 5 + 2) - h * 0.015 * Math.sin(x / w * 13));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  const treeCount = s.id === 'desert' ? 9 : s.id === 'winter' ? 70 : 90;
  for (let i = 0; i < treeCount; i++) {
    const x = r() * w;
    const base = hy + h * 0.02 - h * 0.03 * Math.sin(x / w * 5 + 2) - h * 0.015 * Math.sin(x / w * 13) + h * 0.012;
    const th = h * (0.025 + r() * 0.035);
    const col = a.foliage[Math.floor(r() * a.foliage.length)];
    if (s.id === 'desert') palm(ctx, x, base, th * 1.6, col);
    else if (s.id === 'winter') pine(ctx, x, base, th * 1.3, col, true);
    else if (s.id === 'rainy') pine(ctx, x, base, th * 1.2, col, false);
    else {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, base - th * 0.6, th * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ground
  const gg = ctx.createLinearGradient(0, hy, 0, h);
  gg.addColorStop(0, a.ground);
  gg.addColorStop(1, shade(a.ground, s.id === 'winter' ? -0.08 : -0.3));
  ctx.fillStyle = gg;
  ctx.fillRect(0, hy + h * 0.035, w, h);

  // Road: a sweeping perspective curve towards a vanishing point on the horizon
  const vx = w * 0.6;
  const vy = hy + h * 0.04;
  const N = 60;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const cxp = bez(w * 0.38, w * 0.95, vx, t);
    const cyp = bez(h * 1.05, h * 0.78, vy, t);
    const hw = lerp(w * 0.34, w * 0.004, Math.pow(t, 0.8));
    left.push([cxp - hw, cyp]);
    right.push([cxp + hw, cyp]);
  }
  // shoulders (snow banks / sand / grass edge)
  const shoulder = (pts: [number, number][], dir: number) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const k = 1 - i / N;
      const o = dir * w * 0.05 * k;
      if (i === 0) ctx.moveTo(x + o, y);
      else ctx.lineTo(x + o, y);
    });
    for (let i = N; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  ctx.fillStyle = s.id === 'winter' ? '#ffffff' : s.id === 'desert' ? '#f0cf9a' : shade(a.ground, 0.08);
  shoulder(left, -1);
  ctx.fill();
  shoulder(right, 1);
  ctx.fill();
  ctx.fillStyle = a.road;
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = N; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  // wet sheen / sky reflections on rainy tarmac, frost on winter edges
  if (s.id === 'rainy') {
    ctx.save();
    ctx.clip();
    const rg = ctx.createLinearGradient(0, vy, 0, h);
    rg.addColorStop(0, 'rgba(200,220,235,0.55)');
    rg.addColorStop(0.5, 'rgba(160,190,210,0.18)');
    rg.addColorStop(1, 'rgba(120,150,170,0.05)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, vy, w, h);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.2 + r() * 0.7);
      ctx.fillStyle = `rgba(230,240,250,${0.05 + r() * 0.08})`;
      ctx.fillRect(x, vy + r() * h * 0.2, w * 0.003, h * (0.1 + r() * 0.3));
    }
    ctx.restore();
  }
  // curbs along both edges
  for (const pts of [left, right]) {
    for (let i = 0; i < N - 6; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const k = 1 - i / N;
      ctx.fillStyle = i % 2 ? '#f4f4f0' : '#e1323c';
      const cw = w * 0.012 * k;
      ctx.beginPath();
      ctx.moveTo(x0 - cw, y0);
      ctx.lineTo(x1 - cw * 0.96, y1);
      ctx.lineTo(x1 + cw * 0.96, y1);
      ctx.lineTo(x0 + cw, y0);
      ctx.fill();
    }
  }
  // centre dashes
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 2; i < N - 8; i += 4) {
    const t0 = i / N;
    const t1 = (i + 1.6) / N;
    const x0 = bez(w * 0.38, w * 0.95, vx, t0);
    const y0 = bez(h * 1.05, h * 0.78, vy, t0);
    const x1 = bez(w * 0.38, w * 0.95, vx, t1);
    const y1 = bez(h * 1.05, h * 0.78, vy, t1);
    const lw = w * 0.006 * (1 - t0);
    ctx.beginPath();
    ctx.moveTo(x0 - lw, y0);
    ctx.lineTo(x1 - lw * 0.9, y1);
    ctx.lineTo(x1 + lw * 0.9, y1);
    ctx.lineTo(x0 + lw, y0);
    ctx.fill();
  }

  // Grade + vignette
  const vg = ctx.createRadialGradient(w * 0.55, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  staticCache.set(key, c);
  return c;
}

function pine(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, col: string, snowy: boolean) {
  ctx.fillStyle = col;
  for (let k = 0; k < 3; k++) {
    const y = base - h * (0.25 + k * 0.25);
    const wdt = h * (0.42 - k * 0.1);
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.32);
    ctx.lineTo(x - wdt, y + h * 0.12);
    ctx.lineTo(x + wdt, y + h * 0.12);
    ctx.fill();
    if (snowy) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.32);
      ctx.lineTo(x - wdt * 0.45, y - h * 0.08);
      ctx.lineTo(x + wdt * 0.45, y - h * 0.08);
      ctx.fill();
      ctx.fillStyle = col;
    }
  }
}

function palm(ctx: CanvasRenderingContext2D, x: number, base: number, h: number, col: string) {
  ctx.strokeStyle = '#8a6a48';
  ctx.lineWidth = Math.max(1, h * 0.05);
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.quadraticCurveTo(x + h * 0.15, base - h * 0.5, x + h * 0.05, base - h);
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, h * 0.06);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + h * 0.05, base - h);
    ctx.quadraticCurveTo(x + h * 0.05 + Math.cos(a) * h * 0.3, base - h - h * 0.15, x + h * 0.05 + Math.cos(a) * h * 0.45, base - h + Math.abs(Math.sin(a)) * h * 0.2);
    ctx.stroke();
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

interface Mote {
  x: number;
  y: number;
  z: number;
  s: number;
  p: number;
}

/** Animated full-screen backdrop that crossfades between seasons. */
export class SeasonBackdrop {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private current: SeasonDef | null = null;
  private previous: SeasonDef | null = null;
  private mix = 1;
  private motes: Mote[] = [];
  private raf = 0;
  private t = 0;
  private last = 0;
  running = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'season-bg';
    parent.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const r = mulberry32(7);
    for (let i = 0; i < 260; i++) this.motes.push({ x: r(), y: r(), z: 0.3 + r() * 0.7, s: r(), p: r() * 100 });
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w && h && (w !== this.canvas.width || h !== this.canvas.height)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  show(s: SeasonDef) {
    if (this.current?.id === s.id) return;
    this.previous = this.current;
    this.current = s;
    this.mix = this.previous ? 0 : 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      this.mix = Math.min(1, this.mix + dt * 2.4);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h || !this.current) return;
    // slow parallax drift keeps the painting alive
    const drift = Math.sin(this.t * 0.08) * w * 0.012;
    const scale = 1.04;
    const dw = w * scale;
    const dh = h * scale;
    const ox = (w - dw) / 2 + drift;
    const oy = (h - dh) / 2;
    if (this.previous && this.mix < 1) {
      ctx.globalAlpha = 1;
      ctx.drawImage(paintStatic(this.previous, w, h), ox, oy, dw, dh);
      ctx.globalAlpha = easeInOut(this.mix);
    }
    ctx.drawImage(paintStatic(this.current, w, h), ox, oy, dw, dh);
    ctx.globalAlpha = 1;
    this.particles(this.current, w, h);
  }

  private particles(s: SeasonDef, w: number, h: number) {
    const ctx = this.ctx;
    const t = this.t;
    const a = this.mix;
    const unit = Math.min(w, h);
    if (s.id === 'winter') {
      ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`;
      for (const m of this.motes) {
        const y = ((m.y + t * 0.05 * m.z) % 1) * h;
        const x = ((m.x + Math.sin(t * 0.6 + m.p) * 0.01 + t * 0.008) % 1) * w;
        ctx.beginPath();
        ctx.arc(x, y, unit * 0.003 * m.z + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s.id === 'rainy') {
      ctx.strokeStyle = `rgba(210,228,240,${0.35 * a})`;
      ctx.lineWidth = Math.max(1, unit * 0.0012);
      ctx.beginPath();
      for (const m of this.motes) {
        const y = ((m.y + t * 0.9 * m.z) % 1) * h;
        const x = ((m.x - t * 0.12 * m.z) % 1 + 1) % 1 * w;
        const len = unit * 0.045 * m.z;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.25, y + len);
      }
      ctx.stroke();
    } else if (s.id === 'autumn') {
      const cols = s.world.foliage;
      for (let i = 0; i < 70; i++) {
        const m = this.motes[i];
        const y = ((m.y + t * 0.06 * m.z) % 1) * h;
        const x = ((m.x + t * 0.03 + Math.sin(t * 0.9 + m.p) * 0.03) % 1 + 1) % 1 * w;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * (1 + m.s * 2) + m.p);
        ctx.scale(1, 0.4 + Math.abs(Math.sin(t * 2 + m.p)) * 0.6);
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath();
        ctx.ellipse(0, 0, unit * 0.008 * m.z + 2, unit * 0.004 * m.z + 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    } else if (s.id === 'desert') {
      // heat shimmer band + wind-blown dust
      const hy = h * 0.6;
      const band = ctx.createLinearGradient(0, hy - h * 0.05, 0, hy + h * 0.06);
      band.addColorStop(0, 'rgba(255,230,190,0)');
      band.addColorStop(0.5, `rgba(255,230,190,${(0.18 + Math.sin(t * 2) * 0.05) * a})`);
      band.addColorStop(1, 'rgba(255,230,190,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, hy - h * 0.05, w, h * 0.11);
      ctx.fillStyle = `rgba(243,210,160,${0.45 * a})`;
      for (let i = 0; i < 120; i++) {
        const m = this.motes[i];
        const x = ((m.x + t * 0.12 * m.z) % 1) * w;
        const y = (0.55 + m.y * 0.45) * h + Math.sin(t + m.p) * h * 0.01;
        ctx.fillRect(x, y, unit * 0.012 * m.z, Math.max(1, unit * 0.0015));
      }
    } else {
      // summer: drifting pollen glints + subtle sun rays
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const sx = w * 0.72;
      const sy = h * 0.18;
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * Math.PI * 2 + t * 0.03;
        ctx.fillStyle = `rgba(255,246,200,${0.045 * a})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(ang - 0.05) * w, sy + Math.sin(ang - 0.05) * w);
        ctx.lineTo(sx + Math.cos(ang + 0.05) * w, sy + Math.sin(ang + 0.05) * w);
        ctx.fill();
      }
      for (let i = 0; i < 60; i++) {
        const m = this.motes[i];
        const x = ((m.x + Math.sin(t * 0.2 + m.p) * 0.02) % 1) * w;
        const y = ((m.y - t * 0.01 * m.z) % 1 + 1) % 1 * h;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + m.p));
        ctx.fillStyle = `rgba(255,246,200,${0.6 * tw * a})`;
        ctx.beginPath();
        ctx.arc(x, y, unit * 0.0025 * m.z + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Static thumbnail for a season card (cached painting + a sprinkle of particles). */
export function paintThumb(target: HTMLCanvasElement, s: SeasonDef) {
  const w = target.width;
  const h = target.height;
  const ctx = target.getContext('2d')!;
  ctx.drawImage(paintStatic(s, w, h), 0, 0);
}
