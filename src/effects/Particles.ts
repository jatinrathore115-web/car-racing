import * as THREE from 'three';
import { Tex } from '../core/Textures';

export type ParticleKind = 'smoke' | 'spray' | 'dirt' | 'gravel' | 'sparks' | 'dust' | 'gold';

interface Preset {
  size0: number;
  size1: number;
  life: number;
  alpha: number;
  color: [number, number, number];
  gravity: number;
  drag: number;
  additive: boolean;
  jitter: number;
}

const PRESETS: Record<ParticleKind, Preset> = {
  smoke: { size0: 0.8, size1: 3.4, life: 1.1, alpha: 0.17, color: [0.86, 0.86, 0.88], gravity: -0.5, drag: 1.6, additive: false, jitter: 1.2 },
  spray: { size0: 0.7, size1: 3.4, life: 0.7, alpha: 0.14, color: [0.82, 0.86, 0.92], gravity: 1.5, drag: 2.0, additive: false, jitter: 1.5 },
  dirt: { size0: 0.22, size1: 0.12, life: 0.7, alpha: 0.95, color: [0.33, 0.27, 0.16], gravity: 11, drag: 0.6, additive: false, jitter: 2.2 },
  gravel: { size0: 0.14, size1: 0.1, life: 0.6, alpha: 1, color: [0.6, 0.56, 0.5], gravity: 12, drag: 0.4, additive: false, jitter: 2.6 },
  sparks: { size0: 0.16, size1: 0.05, life: 0.4, alpha: 1, color: [4.0, 1.9, 0.6], gravity: 7, drag: 0.6, additive: true, jitter: 4 },
  dust: { size0: 1.2, size1: 5.5, life: 1.6, alpha: 0.32, color: [0.86, 0.72, 0.52], gravity: -0.3, drag: 1.3, additive: false, jitter: 1.5 },
  gold: { size0: 0.18, size1: 0.05, life: 2.4, alpha: 1, color: [3.2, 2.3, 0.9], gravity: -0.6, drag: 0.4, additive: true, jitter: 0.8 },
};

const vert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform sampler2D uTex;
varying vec4 vColor;
void main() {
  float a = texture2D(uTex, gl_PointCoord).a;
  if (vColor.a * a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private kind: Uint8Array;
  private head = 0;
  private alive = 0;
  readonly mat: THREE.ShaderMaterial;
  private kinds: ParticleKind[];

  constructor(readonly cap: number, additive: boolean) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.kinds = Object.keys(PRESETS) as ParticleKind[];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTex: { value: Tex.particle() }, uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    const p = PRESETS[kind];
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const j = p.jitter;
    this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
    this.vel[i * 3] = vx + (Math.random() - 0.5) * j;
    this.vel[i * 3 + 1] = vy + Math.random() * j * 0.6;
    this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * j;
    this.maxLife[i] = this.life[i] = p.life * (0.7 + Math.random() * 0.6);
    this.kind[i] = this.kinds.indexOf(kind);
  }

  update(dt: number) {
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      const p = PRESETS[this.kinds[this.kind[i]]];
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const drag = Math.max(0, 1 - p.drag * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - p.gravity * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = p.size0 + (p.size1 - p.size0) * t;
      this.col[i * 4] = p.color[0];
      this.col[i * 4 + 1] = p.color[1];
      this.col[i * 4 + 2] = p.color[2];
      const fadeIn = Math.min(1, t * 8);
      this.col[i * 4 + 3] = p.alpha * fadeIn * (1 - t) * (1 - t * 0.3);
    }
    if (alive || this.alive) {
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    }
    this.alive = alive;
  }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
  }
}

export class ParticleManager {
  private normal: Pool;
  private additive: Pool;
  density = 1;

  constructor(scene: THREE.Scene, quality: 'performance' | 'high' | 'ultra') {
    const cap = quality === 'ultra' ? 4000 : quality === 'high' ? 2600 : 1200;
    this.density = quality === 'ultra' ? 1.3 : quality === 'high' ? 1 : 0.55;
    this.normal = new Pool(cap, false);
    this.additive = new Pool(Math.round(cap / 3), true);
    scene.add(this.normal.points, this.additive.points);
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, count = 1) {
    const pool = PRESETS[kind].additive ? this.additive : this.normal;
    let n = count * this.density;
    while (n > 0) {
      if (n >= 1 || Math.random() < n) pool.emit(kind, x, y, z, vx, vy, vz);
      n -= 1;
    }
  }

  update(dt: number, camera: THREE.PerspectiveCamera, renderHeight: number) {
    const scale = renderHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.normal.mat.uniforms.uScale.value = scale;
    this.additive.mat.uniforms.uScale.value = scale;
    this.normal.update(dt);
    this.additive.update(dt);
  }

  clear() {
    this.normal.clear();
    this.additive.clear();
  }

  dispose() {
    for (const p of [this.normal, this.additive]) {
      p.points.removeFromParent();
      p.points.geometry.dispose();
      p.mat.dispose();
    }
  }
}

/** Camera-local rain streaks. Drops very close to the lens are culled to keep the view clear. */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private drops: Float32Array;
  private count: number;
  private box = new THREE.Vector3(60, 30, 60);
  constructor(scene: THREE.Scene, intensity: number, quality: 'performance' | 'high' | 'ultra') {
    this.count = Math.round((quality === 'ultra' ? 5000 : quality === 'high' ? 3200 : 1500) * intensity);
    this.drops = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.drops[i * 3 + 1] = Math.random() * this.box.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.22, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number, cam: THREE.Camera, carVel: THREE.Vector3) {
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = 22;
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    const sx = -carVel.x * 0.025;
    const sz = -carVel.z * 0.025;
    for (let i = 0; i < this.count; i++) {
      let x = this.drops[i * 3];
      let y = this.drops[i * 3 + 1] - fall * dt;
      let z = this.drops[i * 3 + 2];
      x -= carVel.x * dt * 0.5;
      z -= carVel.z * dt * 0.5;
      if (y < -4) y += this.box.y;
      if (x < -this.box.x / 2) x += this.box.x;
      if (x > this.box.x / 2) x -= this.box.x;
      if (z < -this.box.z / 2) z += this.box.z;
      if (z > this.box.z / 2) z -= this.box.z;
      this.drops[i * 3] = x;
      this.drops[i * 3 + 1] = y;
      this.drops[i * 3 + 2] = z;
      const near = x * x + (y - 0) * (y - 0) + z * z < 9;
      const o = i * 6;
      const wx = cx + x;
      const wy = cy + y - 6;
      const wz = cz + z;
      arr[o] = wx;
      arr[o + 1] = near ? -1e4 : wy;
      arr[o + 2] = wz;
      arr[o + 3] = wx + sx;
      arr[o + 4] = near ? -1e4 : wy + 0.55;
      arr[o + 5] = wz + sz;
    }
    pos.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export type FlurryKind = 'snow' | 'leaves' | 'dust' | 'pollen';

const flurryVert = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aSpin;
varying vec3 vColor;
varying float vSpin;
varying float vFade;
uniform float uScale;
uniform vec3 uCam;
void main() {
  vColor = aColor;
  vSpin = aSpin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = length(position - uCam);
  vFade = smoothstep(1.2, 3.5, d) * (1.0 - smoothstep(30.0, 42.0, d));
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;

const flurryFrag = /* glsl */ `
uniform float uLeaf;
uniform float uAlpha;
varying vec3 vColor;
varying float vSpin;
varying float vFade;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a;
  if (uLeaf > 0.5) {
    // rotated ellipse = tumbling leaf silhouette
    float c = cos(vSpin), s = sin(vSpin);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    q.y *= 2.2 + sin(vSpin * 1.7) * 1.2;
    a = 1.0 - smoothstep(0.32, 0.4, length(q));
  } else {
    a = 1.0 - smoothstep(0.15, 0.5, length(p));
  }
  a *= vFade * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

/**
 * Camera-wrapped ambient particles for the seasons: snowflakes, tumbling leaves, drifting sand
 * dust and sunlit pollen. Particles inside ~1.5 m of the lens fade out so they never block the view.
 */
export class Flurry {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private spin: Float32Array;
  private phase: Float32Array;
  private count: number;
  private box = 70;
  private mat: THREE.ShaderMaterial;
  private t = 0;

  constructor(scene: THREE.Scene, readonly kind: FlurryKind, amount: number, quality: 'performance' | 'high' | 'ultra', palette: string[]) {
    const q = quality === 'ultra' ? 1.3 : quality === 'high' ? 1 : 0.55;
    const base = kind === 'snow' ? 3200 : kind === 'leaves' ? 520 : kind === 'dust' ? 900 : 260;
    this.count = Math.round(base * q * amount);
    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.spin = new Float32Array(n);
    this.phase = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const cols = palette.map((p) => new THREE.Color(p));
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box;
      this.pos[i * 3 + 1] = Math.random() * 24 - 2;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box;
      this.phase[i] = Math.random() * 100;
      const c = cols[i % cols.length];
      const k = 0.85 + Math.random() * 0.3;
      col[i * 3] = c.r * k;
      col[i * 3 + 1] = c.g * k;
      col[i * 3 + 2] = c.b * k;
      size[i] = kind === 'snow' ? 0.05 + Math.random() * 0.09 : kind === 'leaves' ? 0.16 + Math.random() * 0.12 : kind === 'dust' ? 0.05 + Math.random() * 0.08 : 0.04 + Math.random() * 0.05;
      this.vel[i * 3 + 1] = kind === 'snow' ? -(0.8 + Math.random() * 0.9) : kind === 'leaves' ? -(0.9 + Math.random() * 0.8) : kind === 'dust' ? (Math.random() - 0.5) * 0.2 : (Math.random() - 0.3) * 0.15;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: flurryVert,
      fragmentShader: flurryFrag,
      uniforms: {
        uScale: { value: 500 },
        uCam: { value: new THREE.Vector3() },
        uLeaf: { value: kind === 'leaves' ? 1 : 0 },
        uAlpha: { value: kind === 'snow' ? 0.95 : kind === 'leaves' ? 1 : kind === 'dust' ? 0.35 : 0.8 },
      },
      transparent: true,
      depthWrite: false,
      blending: kind === 'pollen' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  update(dt: number, cam: THREE.PerspectiveCamera, carVel: THREE.Vector3, renderHeight = 1080) {
    this.t += dt;
    const out = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = out.array as Float32Array;
    const half = this.box / 2;
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    const wind = this.kind === 'dust' ? 3.2 : this.kind === 'leaves' ? 1.2 : 0.4;
    for (let i = 0; i < this.count; i++) {
      const ph = this.phase[i];
      let x = this.pos[i * 3];
      let y = this.pos[i * 3 + 1];
      let z = this.pos[i * 3 + 2];
      const sway = Math.sin(this.t * (0.7 + (ph % 1)) + ph) * (this.kind === 'leaves' ? 1.6 : 0.5);
      x += (wind + sway - carVel.x * 0.35) * dt;
      z += (Math.cos(this.t * 0.6 + ph) * 0.4 - carVel.z * 0.35) * dt;
      y += this.vel[i * 3 + 1] * dt;
      if (this.kind === 'leaves') this.spin[i] = ph + this.t * (2 + (ph % 3));
      if (y < -3) y += 26;
      if (y > 23) y -= 26;
      if (x < -half) x += this.box;
      else if (x > half) x -= this.box;
      if (z < -half) z += this.box;
      else if (z > half) z -= this.box;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      arr[i * 3] = cx + x;
      arr[i * 3 + 1] = cy - 4 + y;
      arr[i * 3 + 2] = cz + z;
    }
    out.needsUpdate = true;
    if (this.kind === 'leaves') (this.points.geometry.attributes.aSpin as THREE.BufferAttribute).needsUpdate = true;
    this.mat.uniforms.uCam.value.copy(cam.position);
    this.mat.uniforms.uScale.value = renderHeight / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
