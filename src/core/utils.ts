export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing. `rate` ~ 1/seconds to close ~63% of the gap. */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeOutQuart = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 4);
export const easeInOutCubic = (t: number) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Deterministic PRNG so procedural worlds are identical between visits. */
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(t: number | null | undefined): string {
  if (t == null || !isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
