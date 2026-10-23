import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Track } from './Track';
import type { EnvPreset } from './Environment';
import { Tex } from '../core/Textures';
import { mulberry32, clamp } from '../core/utils';
import { PlanarReflection, applyReflection } from '../effects/PlanarReflection';
import type { SeasonWorld } from '../data/seasons';

export interface BuildOptions {
  preset: EnvPreset;
  detail: number; // 0.5 performance .. 1.4 ultra
  sceneryShadows: boolean;
  reflection: PlanarReflection | null;
  season: SeasonWorld;
}

export interface BuiltTrack {
  group: THREE.Group;
  startLights: THREE.MeshBasicMaterial[];
  racingLine: THREE.Mesh;
  grandstandSpots: { x: number; z: number }[];
  update(t: number): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Generic strip along the track between two lateral offsets. */
function ribbon(
  tr: Track,
  opts: {
    from: (i: number) => number;
    to: (i: number) => number;
    segs?: number;
    y?: (i: number, lat: number, j: number) => number;
    u?: (lat: number, j: number) => number;
    vScale?: number;
    include?: (i: number) => boolean;
    color?: (i: number, lat: number) => number | [number, number, number] | [number, number, number, number];
  },
): THREE.BufferGeometry | null {
  const segs = opts.segs ?? 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const N = tr.N;
  const all = !opts.include;
  // Find runs
  const runs: [number, number][] = [];
  if (all) runs.push([0, N]);
  else {
    let start = -1;
    // rotate so we don't start inside a run
    let offset = 0;
    while (offset < N && opts.include!(offset)) offset++;
    if (offset === N) runs.push([0, N]);
    else {
      for (let k = 0; k <= N; k++) {
        const i = (k + offset) % N;
        const inc = k < N && opts.include!(i);
        if (inc && start < 0) start = k + offset;
        if (!inc && start >= 0) {
          runs.push([start, k + offset]);
          start = -1;
        }
      }
    }
  }
  for (const [a, b] of runs) {
    const base = pos.length / 3;
    const count = b - a + 1;
    for (let k = 0; k < count; k++) {
      const ii = a + k;
      const i = tr.wrap(ii);
      const nx = tr.tz[i];
      const nz = -tr.tx[i];
      const f = opts.from(i);
      const t = opts.to(i);
      for (let j = 0; j <= segs; j++) {
        const lat = f + ((t - f) * j) / segs;
        const y = tr.py[i] + (opts.y ? opts.y(i, lat, j) : 0);
        pos.push(tr.px[i] + nx * lat, y, tr.pz[i] + nz * lat);
        uv.push(opts.u ? opts.u(lat, j) : lat / 8, ii * tr.ds * (opts.vScale ?? 1 / 8));
        if (opts.color) {
          const c = opts.color(i, lat);
          if (typeof c === 'number') col.push(c, c, c);
          else col.push(...c);
        }
      }
    }
    const row = segs + 1;
    for (let k = 0; k < count - 1; k++) {
      for (let j = 0; j < segs; j++) {
        const p = base + k * row + j;
        const q = p + 1;
        const r = p + row;
        const s = r + 1;
        // ensure upward normals regardless of lateral direction
        if (opts.to(tr.wrap(a)) >= opts.from(tr.wrap(a))) idx.push(p, r, q, q, r, s);
        else idx.push(p, q, r, q, s, r);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, col.length / (pos.length / 3)));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical strip (walls, fences) at a lateral offset. */
function wallStrip(tr: Track, lat: (i: number) => number, y0: number, y1: number, vScale: number, include?: (i: number) => boolean) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const N = tr.N;
  let prevIncluded = false;
  let base = 0;
  for (let k = 0; k <= N; k++) {
    const i = tr.wrap(k);
    const inc = !include || include(i);
    if (inc) {
      const l = lat(i);
      const x = tr.px[i] + tr.tz[i] * l;
      const z = tr.pz[i] - tr.tx[i] * l;
      const idxNow = pos.length / 3;
      pos.push(x, tr.py[i] + y0, z, x, tr.py[i] + y1, z);
      uv.push(k * tr.ds * vScale, 0, k * tr.ds * vScale, 1);
      if (prevIncluded) {
        const p = base;
        idx.push(p, idxNow, p + 1, p + 1, idxNow, idxNow + 1);
      }
      base = idxNow;
    }
    prevIncluded = inc;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Local frame at track distance s, offset laterally; x = along track, z = away from track. */
function frameAt(tr: Track, s: number, lateral: number, side: number) {
  const p = tr.pointAt(s, lateral, new THREE.Vector3());
  const h = tr.headingAt(s);
  const m = new THREE.Matrix4();
  // forward = (sin h, cos h); outward = side * left = side * (cos h, -sin h)
  const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
  const out = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)).multiplyScalar(side);
  const xAxis = side > 0 ? fwd.clone().negate() : fwd.clone();
  m.makeBasis(xAxis, UP, out);
  m.setPosition(p);
  return m;
}

function geo(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  const c = g.index ? g.toNonIndexed() : g.clone();
  c.applyMatrix4(m);
  for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
  return c;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** World-space UV mapping for instanced boxes (windows don't stretch across sizes). */
function patchWorldUV(mat: THREE.MeshStandardMaterial, scale: THREE.Vector2) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWScale = { value: scale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 wpp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpp = instanceMatrix * wpp;
        #endif
        wpp = modelMatrix * wpp;
        vWP = wpp.xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
        #ifdef USE_INSTANCING
          vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform vec2 uWScale;')
      .replace(
        '#include <map_fragment>',
        `vec2 wuv = abs(vWN.x) > 0.5 ? vWP.zy : vWP.xy;
         wuv /= uWScale;
         float roof = step(0.7, vWN.y);
         vec4 texelColor = texture2D(map, wuv);
         texelColor.rgb = mix(texelColor.rgb, vec3(0.16, 0.17, 0.19), roof);
         diffuseColor *= texelColor;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
          vec4 emissiveColor = texture2D(emissiveMap, wuv);
          totalEmissiveRadiance *= emissiveColor.rgb * (1.0 - roof);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'worlduv';
}

export function buildTrack(tr: Track, opts: BuildOptions): BuiltTrack {
  const group = new THREE.Group();
  group.name = 'track';
  const P = opts.preset;
  const detail = opts.detail;
  const rnd = mulberry32(tr.def.seed);
  const theme = tr.def.theme;
  const season = opts.season;
  const seasonGround = () => (season.ground === 'snow' ? Tex.snow() : season.ground === 'sand' ? Tex.sand() : Tex.grass(season.grassTint));
  const wet = P.wet;
  const night = P.night;
  const disposables: { dispose(): void }[] = [];
  const updaters: ((t: number) => void)[] = [];
  const addMesh = (g: THREE.BufferGeometry | null, m: THREE.Material, opt: { cast?: boolean; receive?: boolean; order?: number } = {}) => {
    if (!g) return null;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = !!opt.cast && opts.sceneryShadows;
    mesh.receiveShadow = opt.receive !== false;
    if (opt.order !== undefined) mesh.renderOrder = opt.order;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    disposables.push(g, m);
    return mesh;
  };
  const hw = tr.hw;
  const minH = tr.minH;

  // ---------------------------------------------------------------- Road surface
  const asphaltMap = Tex.asphalt();
  const roughMap = Tex.asphaltRough();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    roughnessMap: roughMap,
    roughness: wet > 0.5 ? 0.32 : 0.92,
    metalness: wet > 0.5 ? 0.15 : 0.0,
    vertexColors: true,
    color: wet > 0.5 ? new THREE.Color(0.46, 0.48, 0.52) : new THREE.Color(1, 1, 1),
    envMapIntensity: wet > 0.5 ? 1.6 : 0.6,
  });
  if (opts.reflection && wet > 0.2) applyReflection(roadMat, opts.reflection, wet * 0.95, 1.4);
  const noise = (i: number) => 0.5 + 0.5 * Math.sin(i * 0.031 + 1.3) * Math.sin(i * 0.0173 + 0.4);
  addMesh(
    ribbon(tr, {
      from: () => -hw - 0.05,
      to: () => hw + 0.05,
      segs: 12,
      u: (lat) => lat / 9,
      vScale: 1 / 9,
      color: (i, lat) => {
        const line = tr.line[i];
        const d = Math.abs(lat - line);
        const braking = tr.zone[i] === 2 ? 1 : 0;
        const rubber = d < 1.6 ? (1 - d / 1.6) * (0.16 + braking * 0.12) : 0;
        const macro = 0.9 + noise(i) * 0.12 - Math.abs(lat / hw) * 0.03;
        const v = macro - rubber;
        return [v, v, v * 1.01];
      },
    }),
    roadMat,
  );

  // Edge lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf3f3ef, roughness: wet > 0.5 ? 0.3 : 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const sgn of [-1, 1]) {
    addMesh(
      ribbon(tr, { from: () => sgn * (hw - 0.55), to: () => sgn * (hw - 0.25), y: () => 0.012 }),
      lineMat,
      { order: 1 },
    );
  }

  // Start/finish checker + grid slots
  {
    const parts: THREE.BufferGeometry[] = [];
    const m = frameAt(tr, 0, 0, -1);
    const g = new THREE.PlaneGeometry(1.6, hw * 2);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.014, 0);
    parts.push(geo(g, m));
    const checker = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ map: Tex.startGrid(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
    (checker.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
    checker.receiveShadow = true;
    group.add(checker);
    disposables.push(checker.geometry, checker.material as THREE.Material);
    const slots: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 10; k++) {
      const s = tr.length - 12 - k * 9;
      const lat = k % 2 === 0 ? 2.6 : -2.6;
      const fm = frameAt(tr, s, lat, -1);
      const bar = new THREE.PlaneGeometry(0.22, 2.6);
      bar.rotateX(-Math.PI / 2);
      bar.translate(0, 0.014, 0);
      slots.push(geo(bar, fm));
      for (const e of [-1.2, 1.2]) {
        const side = new THREE.PlaneGeometry(1.3, 0.18);
        side.rotateX(-Math.PI / 2);
        side.translate(-0.6, 0.014, e);
        slots.push(geo(side, fm));
      }
    }
    addMesh(mergeGeometries(slots), lineMat, { order: 1 });
  }

  // ---------------------------------------------------------------- Curbs
  const curbMat = new THREE.MeshStandardMaterial({ map: Tex.curb(), roughness: wet > 0.5 ? 0.25 : 0.55, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const sgn of [-1, 1]) {
    const arr = sgn > 0 ? tr.curbL : tr.curbR;
    addMesh(
      ribbon(tr, {
        from: () => sgn * (hw - 0.1),
        to: () => sgn * (hw + 1.35),
        segs: 3,
        y: (_i, _lat, j) => [0.01, 0.06, 0.07, 0.03][j],
        u: (_l, j) => j / 3,
        vScale: 1 / 3,
        include: (i) => arr[i] === 1,
      }),
      curbMat,
    );
  }

  // ---------------------------------------------------------------- Run-off, gravel, verges
  const runTex = seasonGround();
  const street = theme === 'city' || theme === 'metro';
  const runMat = street
    ? new THREE.MeshStandardMaterial({ map: asphaltMap, color: wet > 0.5 ? 0x4a4d52 : 0x6f7378, roughness: wet > 0.5 ? 0.35 : 0.9, vertexColors: false })
    : new THREE.MeshStandardMaterial({ map: runTex, roughness: 0.95, color: wet > 0.5 ? 0xa8b0a0 : 0xffffff });
  if (street && opts.reflection && wet > 0.2) applyReflection(runMat, opts.reflection, wet * 0.7, 1.4);
  for (const sgn of [-1, 1]) {
    const wall = sgn > 0 ? tr.wallL : tr.wallR;
    addMesh(
      ribbon(tr, {
        from: () => sgn * (hw - 0.02),
        to: (i) => sgn * (wall[i] + 2),
        segs: 3,
        y: (_i, _l, j) => -0.03 * (j > 0 ? 1 : 0),
        u: (lat) => lat / 6,
        vScale: 1 / 6,
      }),
      runMat,
    );
    // Outer embankment down to ground level
    addMesh(
      ribbon(tr, {
        from: (i) => sgn * (wall[i] + 2),
        to: (i) => sgn * (wall[i] + 2 + Math.max(25, (tr.py[i] - minH) * 2.6)),
        segs: 2,
        y: (i, _l, j) => (j === 0 ? -0.03 : j === 1 ? -(tr.py[i] - minH) * 0.55 - 0.1 : -(tr.py[i] - minH) - 0.35),
        u: (lat) => lat / 6,
        vScale: 1 / 6,
      }),
      street ? runMat : new THREE.MeshStandardMaterial({ map: runTex, roughness: 1, color: 0xe8ece0 }),
    );
    const gravel = sgn > 0 ? tr.gravelL : tr.gravelR;
    addMesh(
      ribbon(tr, {
        from: () => sgn * (hw + 3),
        to: (i) => sgn * (wall[i] - 1),
        segs: 2,
        y: () => 0.01,
        u: (lat) => lat / 5,
        vScale: 1 / 5,
        include: (i) => gravel[i] === 1,
      }),
      new THREE.MeshStandardMaterial({ map: Tex.gravel(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
  }

  // ---------------------------------------------------------------- Walls + fences
  const wallMat = new THREE.MeshStandardMaterial({ map: Tex.adBoards(night ? 'night' : 'day'), roughness: 0.55, side: THREE.DoubleSide, emissive: night ? new THREE.Color(0.35, 0.35, 0.35) : new THREE.Color(0, 0, 0), emissiveMap: night ? Tex.adBoards('night') : null });
  const fenceMat = new THREE.MeshStandardMaterial({ map: Tex.fence(), alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, color: 0xd0d4d8 });
  Tex.fence().repeat.set(1, 1);
  for (const sgn of [-1, 1]) {
    const wall = sgn > 0 ? tr.wallL : tr.wallR;
    addMesh(wallStrip(tr, (i) => sgn * wall[i], -0.1, 1.15, sgn > 0 ? 1 / 20 : -1 / 20), wallMat, { cast: false });
    // wall top cap
    addMesh(
      ribbon(tr, { from: (i) => sgn * wall[i], to: (i) => sgn * (wall[i] + 0.35), y: () => 1.15 }),
      new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.8 }),
    );
    addMesh(wallStrip(tr, (i) => sgn * (wall[i] + 0.2), 1.15, 4.2, 1 / 3), fenceMat);
  }
  // fence posts
  {
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 4.4, 6);
    postGeo.translate(0, 2.1, 0);
    const count = Math.floor(tr.N / 3) * 2;
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.4 }), count);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < tr.N; i += 3) {
      for (const sgn of [-1, 1]) {
        const l = sgn * ((sgn > 0 ? tr.wallL[i] : tr.wallR[i]) + 0.3);
        m.makeTranslation(tr.px[i] + tr.tz[i] * l, tr.py[i], tr.pz[i] - tr.tx[i] * l);
        posts.setMatrixAt(n++, m);
      }
    }
    posts.count = n;
    group.add(posts);
    disposables.push(postGeo, posts.material as THREE.Material);
  }

  // ---------------------------------------------------------------- Racing line assist
  const lineCol = [new THREE.Color('#55E66A'), new THREE.Color('#FFD43B'), new THREE.Color('#E4202C')];
  const lineSm = new Float32Array(tr.N);
  for (let i = 0; i < tr.N; i++) {
    let s = 0;
    for (let o = -4; o <= 4; o++) s += tr.zone[tr.wrap(i + o)];
    lineSm[i] = s / 9;
  }
  const rlMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
  const racingLine = addMesh(
    ribbon(tr, {
      from: (i) => tr.line[i] - 0.4,
      to: (i) => tr.line[i] + 0.4,
      y: () => 0.03,
      color: (i) => {
        const z = lineSm[i];
        const c = z < 1 ? lineCol[0].clone().lerp(lineCol[1], z) : lineCol[1].clone().lerp(lineCol[2], z - 1);
        // green stays a whisper; braking guidance carries the emphasis
        const a = z < 1 ? 0.13 + z * 0.17 : 0.3 + (z - 1) * 0.1;
        return [c.r, c.g, c.b, a];
      },
    }),
    rlMat,
    { order: 2, receive: false },
  )!;

  // ---------------------------------------------------------------- Ground + backdrop
  const groundTex = seasonGround();
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex.clone(), roughness: 1, color: street ? (season.ground === 'snow' ? 0x9aa3ad : 0x5a5e62) : season.ground === 'snow' ? 0xf2f6fa : 0xd8dccc });
  groundMat.map!.repeat.set(500, 500);
  groundMat.map!.needsUpdate = true;
  if (street) groundMat.map = Tex.asphalt().clone();
  if (street) {
    groundMat.map!.repeat.set(300, 300);
    groundMat.map!.needsUpdate = true;
  }
  const cx = (tr.bounds.minX + tr.bounds.maxX) / 2;
  const cz = (tr.bounds.minZ + tr.bounds.maxZ) / 2;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4200, 48), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, minH - 0.4, cz);
  ground.receiveShadow = true;
  group.add(ground);
  disposables.push(ground.geometry, groundMat);

  // Water for coastal circuit
  if (theme === 'coastal') {
    const waterNormal = makeWaterNormal();
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x0f5d8c, roughness: 0.08, metalness: 0.3, normalMap: waterNormal, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.4 }),
    );
    waterNormal.repeat.set(220, 100);
    water.rotation.x = -Math.PI / 2;
    const coastZ = tr.bounds.minZ - 48;
    water.position.set(cx, minH - 0.3, coastZ - 2000);
    group.add(water);
    disposables.push(water.geometry, water.material as THREE.Material, waterNormal);
    updaters.push((t) => {
      waterNormal.offset.set(t * 0.01, t * 0.004);
    });
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(9000, 26), new THREE.MeshStandardMaterial({ map: Tex.sand(), roughness: 1 }));
    (beach.material as THREE.MeshStandardMaterial).map!.repeat.set(300, 1);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(cx, minH - 0.28, coastZ + 10);
    beach.receiveShadow = true;
    group.add(beach);
    disposables.push(beach.geometry, beach.material as THREE.Material);
    // yachts
    const yacht = new THREE.BoxGeometry(4, 2, 14);
    yacht.translate(0, 0.6, 0);
    const ym = new THREE.InstancedMesh(yacht, new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 }), 40);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, rnd() * Math.PI);
      const sc = 0.6 + rnd() * 1.2;
      m.compose(new THREE.Vector3(cx - 900 + rnd() * 1800, minH - 0.3, coastZ - 40 - rnd() * 500), q, new THREE.Vector3(sc, sc, sc));
      ym.setMatrixAt(i, m);
    }
    group.add(ym);
    disposables.push(yacht, ym.material as THREE.Material);
  }

  // Distant mountains / hills ring
  {
    const count = theme === 'mountain' ? 46 : theme === 'city' || theme === 'metro' ? 0 : 30;
    if (count) {
      const cone = new THREE.ConeGeometry(1, 1, 9, 4);
      cone.translate(0, 0.5, 0);
      const pos = cone.getAttribute('position');
      const jr = mulberry32(5);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 0.02 && y < 0.98) {
          pos.setX(i, pos.getX(i) * (0.85 + jr() * 0.35));
          pos.setZ(i, pos.getZ(i) * (0.85 + jr() * 0.35));
          pos.setY(i, y + (jr() - 0.5) * 0.08);
        }
      }
      cone.computeVertexNormals();
      const colors = new Float32Array(pos.count * 3);
      const lowC = new THREE.Color(season.mountainLow);
      const highC = new THREE.Color(theme === 'mountain' && !season.snowCaps && season.ground !== 'sand' ? '#eef2f6' : season.mountainHigh);
      const caps = season.snowCaps || theme === 'mountain';
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const c = lowC.clone().lerp(highC, caps ? clamp((y - 0.5) * 3.5, 0, 1) : y * 0.6);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      cone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mm = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rnd() * 0.2;
        const r = 1200 + rnd() * 900;
        const duneLike = season.drifts === 'dune' || (theme === 'desert' && season.ground === 'sand');
        const big = theme === 'mountain' ? 1 : duneLike ? 0.25 : 0.45;
        const h = (140 + rnd() * 320) * big;
        const w = h * (duneLike ? 4.5 : 1.6 + rnd());
        m.compose(new THREE.Vector3(cx + Math.cos(a) * r, minH - 2, cz + Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6), new THREE.Vector3(w, h, w));
        mm.setMatrixAt(i, m);
      }
      group.add(mm);
      disposables.push(cone, mm.material as THREE.Material);
    }
  }

  // ---------------------------------------------------------------- Scenery scattering
  const maxWall = (i: number) => Math.max(tr.wallL[i], tr.wallR[i]);
  let maxW = 0;
  for (let i = 0; i < tr.N; i++) maxW = Math.max(maxW, maxWall(i));
  const scatter = (count: number, minD: number, maxD: number, cb: (x: number, z: number, d: number) => void) => {
    let placed = 0;
    let tries = 0;
    const pad = maxD;
    while (placed < count && tries < count * 8) {
      tries++;
      const x = tr.bounds.minX - pad + rnd() * (tr.bounds.maxX - tr.bounds.minX + pad * 2);
      const z = tr.bounds.minZ - pad + rnd() * (tr.bounds.maxZ - tr.bounds.minZ + pad * 2);
      if (theme === 'coastal' && z < tr.bounds.minZ - 40) continue;
      const d = tr.distanceToCenter(x, z, Math.ceil(maxD / 24) + 1);
      if (d < minD || d > maxD) continue;
      cb(x, z, d);
      placed++;
    }
    return placed;
  };
  const groundY = (x: number, z: number, d: number) => {
    // approximate terrain height: blend from nearest track height to ground
    const q = tr.project(x, z, -1, tmpQ);
    const embank = Math.max(25, (q.height - minH) * 2.6) + maxW;
    return d > embank + 4 ? minH - 0.4 : q.height - 0.3;
  };
  const tmpQ = { index: 0, s: 0, lateral: 0, height: 0, slope: 0, tx: 0, tz: 0, surface: 'asphalt' as const, wallL: 0, wallR: 0, curbSide: 0 } as unknown as import('./Track').TrackQuery;

  if (theme === 'city' || theme === 'metro' || theme === 'coastal' || theme === 'stadium') {
    const count = Math.round((theme === 'city' ? 220 : theme === 'metro' ? 260 : theme === 'coastal' ? 110 : 70) * detail);
    const bgeo = new THREE.BoxGeometry(1, 1, 1);
    bgeo.translate(0, 0.5, 0);
    const wtex = Tex.windows(tr.def.seed, night);
    const bmat = new THREE.MeshStandardMaterial({
      map: wtex,
      roughness: 0.55,
      metalness: 0.2,
      color: theme === 'coastal' ? 0xf4ede2 : 0xffffff,
      emissive: night ? new THREE.Color(1, 0.85, 0.6) : new THREE.Color(0, 0, 0),
      emissiveMap: night ? wtex : null,
      emissiveIntensity: night ? 0.75 : 0,
    });
    patchWorldUV(bmat, new THREE.Vector2(14, 28));
    const im = new THREE.InstancedMesh(bgeo, bmat, count);
    const m = new THREE.Matrix4();
    const minD = maxW + (street ? 14 : 45);
    const maxD = theme === 'stadium' ? 700 : 420;
    let n = 0;
    scatter(count, minD, maxD, (x, z, d) => {
      const tall = theme === 'metro' ? 40 + rnd() * 150 : theme === 'city' ? 18 + rnd() * 70 : theme === 'coastal' ? 7 + rnd() * 16 : 20 + rnd() * 90;
      const near = clamp(1 - (d - minD) / 140, 0, 1);
      const h = theme === 'stadium' ? tall * (0.4 + (1 - near)) : tall * (1 - near * 0.4);
      const w = 14 + rnd() * 26;
      const dd = 14 + rnd() * 26;
      m.compose(new THREE.Vector3(x, minH - 0.4, z), new THREE.Quaternion().setFromAxisAngle(UP, Math.round(rnd() * 4) * (Math.PI / 2) + (street ? tr.headingAt(tr.project(x, z, -1, tmpQ).s) : rnd())), new THREE.Vector3(w, h, dd));
      im.setMatrixAt(n++, m);
    });
    im.count = n;
    im.castShadow = false;
    im.receiveShadow = true;
    group.add(im);
    disposables.push(bgeo, bmat);
    if (theme === 'coastal') {
      // terracotta roofs
      const roof = new THREE.ConeGeometry(0.75, 0.35, 4);
      roof.rotateY(Math.PI / 4);
      roof.translate(0, 1.17, 0);
      const rm = new THREE.InstancedMesh(roof, new THREE.MeshStandardMaterial({ color: 0xc0583a, roughness: 0.8 }), n);
      for (let i = 0; i < n; i++) {
        im.getMatrixAt(i, m);
        rm.setMatrixAt(i, m);
      }
      group.add(rm);
      disposables.push(roof, rm.material as THREE.Material);
    }
  }

  if (!street) {
    // Species follow the circuit, the season can override them (palms in the desert, snowy pines in winter).
    const kind = season.treeKind ?? (theme === 'forest' || theme === 'mountain' ? 'pine' : theme === 'coastal' ? 'palm' : 'broad');
    const pine = kind === 'pine';
    const palm = kind === 'palm';
    const base = theme === 'forest' ? 2600 : theme === 'mountain' ? 1600 : theme === 'coastal' ? 360 : theme === 'desert' ? 260 : 900;
    const count = Math.max(40, Math.round(base * detail * season.treeMul));
    const trunk = new THREE.CylinderGeometry(palm ? 0.18 : 0.22, palm ? 0.28 : 0.35, 1, 6);
    trunk.translate(0, 0.5, 0);
    let crown: THREE.BufferGeometry;
    if (pine) {
      const c1 = new THREE.ConeGeometry(1, 1.4, 8);
      c1.translate(0, 0.7, 0);
      const c2 = new THREE.ConeGeometry(0.75, 1.1, 8);
      c2.translate(0, 1.25, 0);
      const c3 = new THREE.ConeGeometry(0.5, 0.9, 8);
      c3.translate(0, 1.75, 0);
      crown = mergeGeometries([c1, c2, c3].map((g) => g.toNonIndexed()))!;
    } else if (palm) {
      const leaves: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 7; k++) {
        const leaf = new THREE.ConeGeometry(0.35, 2.6, 4, 1);
        leaf.scale(1, 1, 0.25);
        leaf.rotateZ(-Math.PI / 2 + 0.5);
        leaf.translate(1.2, -0.4, 0);
        leaf.rotateY((k / 7) * Math.PI * 2);
        leaves.push(leaf.toNonIndexed());
      }
      crown = mergeGeometries(leaves)!;
    } else {
      crown = new THREE.IcosahedronGeometry(1, 1);
      const p = crown.getAttribute('position');
      const jr = mulberry32(9);
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + jr() * 0.3), p.getY(i) * (0.8 + jr() * 0.3), p.getZ(i) * (0.85 + jr() * 0.3));
      crown.computeVertexNormals();
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: palm ? 0x8a6a48 : new THREE.Color(season.trunk), roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: !pine });
    const tm = new THREE.InstancedMesh(trunk, trunkMat, count);
    const cm = new THREE.InstancedMesh(crown, crownMat, count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const palette = season.foliage.map((f) => new THREE.Color(f));
    let n = 0;
    const minD = maxW + 8;
    scatter(count, minD, theme === 'forest' ? 320 : 380, (x, z, d) => {
      const y = groundY(x, z, d);
      const h = palm ? 8 + rnd() * 5 : pine ? 7 + rnd() * 12 : 5 + rnd() * 6;
      const r = pine ? h * 0.28 : palm ? 1 : h * 0.42;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6.28);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, palm ? h : h * 0.45, 1));
      tm.setMatrixAt(n, m);
      m.compose(new THREE.Vector3(x, y + (palm ? h : pine ? h * 0.25 : h * 0.62), z), q, new THREE.Vector3(r, pine ? h * 0.48 : palm ? 1.2 : r * 0.9, r));
      cm.setMatrixAt(n, m);
      c.copy(palette[Math.floor(rnd() * palette.length)]).offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.1);
      cm.setColorAt(n, c);
      n++;
    });
    tm.count = cm.count = n;
    cm.castShadow = detail > 1;
    group.add(tm, cm);
    disposables.push(trunk, crown, trunkMat, crownMat);
  }

  if (theme === 'desert' || season.rocks) {
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const rm = new THREE.InstancedMesh(rock, new THREE.MeshStandardMaterial({ color: 0xb07a4a, roughness: 1, flatShading: true }), Math.round(260 * detail));
    const m = new THREE.Matrix4();
    let n = 0;
    scatter(rm.count, maxW + 6, 420, (x, z, d) => {
      const s = 1 + rnd() * 6;
      m.compose(new THREE.Vector3(x, groundY(x, z, d), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), new THREE.Vector3(s * (1 + rnd()), s * 0.6, s));
      rm.setMatrixAt(n++, m);
    });
    rm.count = n;
    group.add(rm);
    disposables.push(rock, rm.material as THREE.Material);
    // dunes
    const dune = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const snowDrift = season.drifts === 'snow';
    const dm = new THREE.InstancedMesh(dune, new THREE.MeshStandardMaterial({ map: snowDrift ? Tex.snow() : Tex.sand(), roughness: 1, color: snowDrift ? 0xffffff : 0xf0d0a0 }), 60);
    n = 0;
    scatter(60, maxW + 80, 900, (x, z) => {
      m.compose(new THREE.Vector3(x, minH - 0.5, z), new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6), new THREE.Vector3(60 + rnd() * 120, 8 + rnd() * 18, 40 + rnd() * 80));
      dm.setMatrixAt(n++, m);
    });
    dm.count = n;
    group.add(dm);
    disposables.push(dune, dm.material as THREE.Material);
  }

  if (season.drifts === 'snow' && theme !== 'desert') {
    // soft snow banks beyond the barriers
    const drift = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const dm = new THREE.InstancedMesh(drift, new THREE.MeshStandardMaterial({ map: Tex.snow(), roughness: 0.9, color: 0xffffff }), Math.round(140 * detail));
    const m = new THREE.Matrix4();
    let n = 0;
    scatter(dm.count, maxW + 4, 260, (x, z, d) => {
      const sc = 4 + rnd() * 14;
      m.compose(new THREE.Vector3(x, groundY(x, z, d) - 0.2, z), new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6), new THREE.Vector3(sc * (1.2 + rnd()), sc * 0.18, sc));
      dm.setMatrixAt(n++, m);
    });
    dm.count = n;
    dm.receiveShadow = true;
    group.add(dm);
    disposables.push(drift, dm.material as THREE.Material);
  }

  // ---------------------------------------------------------------- Grandstands
  const crowdMat = new THREE.MeshStandardMaterial({ map: Tex.crowd(), roughness: 0.9 });
  crowdMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    updaters.push((t) => (sh.uniforms.uTime.value = t));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nfloat h21(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}')
      .replace(
        '#include <map_fragment>',
        `vec2 cuv = vMapUv;
         vec2 cell = floor(cuv * vec2(85.0, 16.0));
         float ph = h21(cell);
         cuv.y += sin(uTime * (3.0 + ph * 4.0) + ph * 30.0) * 0.004 * step(0.6, ph);
         vec4 texelColor = texture2D(map, cuv);
         texelColor.rgb *= 0.85 + 0.3 * step(0.93, fract(ph * 7.0 + uTime * 0.6));
         diffuseColor *= texelColor;`,
      );
  };
  const structMat = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.7, metalness: 0.1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  const fasciaMat = new THREE.MeshStandardMaterial({ map: Tex.adBoards('day'), roughness: 0.5, emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? Tex.adBoards('day') : null, emissiveIntensity: night ? 0.8 : 0 });
  const crowdParts: THREE.BufferGeometry[] = [];
  const structParts: THREE.BufferGeometry[] = [];
  const roofParts: THREE.BufferGeometry[] = [];
  const fasciaParts: THREE.BufferGeometry[] = [];
  const grandstandSpots: { x: number; z: number }[] = [];
  const addGrandstand = (s0: number, length: number, side: number, rows = 1) => {
    const segLen = 12;
    const nSeg = Math.max(1, Math.round(length / segLen));
    for (let k = 0; k < nSeg; k++) {
      const s = s0 + (k - nSeg / 2 + 0.5) * segLen;
      const i = tr.wrap(Math.round(tr.wrapS(s) / tr.ds));
      const wall = side > 0 ? tr.wallL[i] : tr.wallR[i];
      const fm = frameAt(tr, s, side * (wall + 5), side);
      const depth = 15 * rows;
      const height = 11 * rows;
      // crowd slope
      const slope = new THREE.PlaneGeometry(segLen + 0.2, Math.hypot(depth, height));
      slope.rotateY(Math.PI);
      slope.rotateX(Math.atan2(depth, height));
      slope.translate(0, 1.5 + height / 2, depth / 2);
      const uvA = slope.getAttribute('uv');
      for (let v = 0; v < uvA.count; v++) uvA.setXY(v, uvA.getX(v) * (segLen / 18), uvA.getY(v) * rows);
      crowdParts.push(geo(slope, fm));
      structParts.push(geo(boxAt(segLen, 1.5, 0.4, 0, 0.75, 0), fm));
      structParts.push(geo(boxAt(segLen, height + 4, 0.6, 0, (height + 4) / 2, depth + 0.5), fm));
      // stepped underside impression
      structParts.push(geo(boxAt(segLen, 0.4, depth, 0, 1.3, depth / 2), fm));
      for (const px of [-segLen / 2 + 0.3]) {
        structParts.push(geo(boxAt(0.5, height + 6, 0.5, px, (height + 6) / 2, depth + 0.4), fm));
        structParts.push(geo(boxAt(0.3, 0.3, depth + 4, px, height + 5.8, depth / 2 - 1), fm));
      }
      const roof = new THREE.PlaneGeometry(segLen + 0.1, depth + 5);
      roof.rotateX(-Math.PI / 2 + 0.08);
      roof.translate(0, height + 6, depth / 2 - 1.5);
      roofParts.push(geo(roof, fm));
      const fascia = new THREE.PlaneGeometry(segLen + 0.1, 1.6);
      const fu = fascia.getAttribute('uv');
      const off = ((k * 4) % 8) / 8;
      for (let v = 0; v < fu.count; v++) fu.setX(v, off + fu.getX(v) / 2);
      fascia.rotateY(Math.PI);
      fascia.translate(0, height + 5.6, -4);
      fasciaParts.push(geo(fascia, fm));
      const c = new THREE.Vector3().setFromMatrixPosition(fm);
      if (k % 2 === 0) grandstandSpots.push({ x: c.x, z: c.z });
    }
  };
  const gSide = -tr.outsideSign; // opposite of pits on the start straight
  addGrandstand(tr.length - 60, 180, gSide, 2);
  // major corners
  const corners: { s: number; k: number }[] = [];
  for (let i = 0; i < tr.N; i++) {
    const k = Math.abs(tr.curv[i]);
    if (k > 1 / 90 && Math.abs(tr.curv[i]) >= Math.abs(tr.curv[tr.wrap(i - 1)]) && Math.abs(tr.curv[i]) >= Math.abs(tr.curv[tr.wrap(i + 1)])) corners.push({ s: i * tr.ds, k: tr.curv[i] });
  }
  corners.sort((a, b) => Math.abs(b.k) - Math.abs(a.k));
  const chosen: typeof corners = [];
  for (const c of corners) {
    if (chosen.length >= Math.round(2 + detail * 2)) break;
    if (chosen.every((o) => Math.abs(o.s - c.s) > 300 && Math.abs(o.s - c.s) < tr.length - 300) && c.s > 260 && c.s < tr.length - 340) chosen.push(c);
  }
  for (const c of chosen) addGrandstand(c.s, 60 + rnd() * 50, c.k > 0 ? -1 : 1, 1);
  if (crowdParts.length) {
    addMesh(mergeGeometries(crowdParts), crowdMat);
    addMesh(mergeGeometries(structParts), structMat, { cast: true });
    addMesh(mergeGeometries(roofParts), roofMat, { cast: true });
    addMesh(mergeGeometries(fasciaParts), fasciaMat);
  }

  // ---------------------------------------------------------------- Pit complex
  {
    const side = tr.outsideSign;
    const parts: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    const doors: THREE.BufferGeometry[] = [];
    const segLen = 12;
    const lane = new THREE.MeshStandardMaterial({ map: asphaltMap, color: 0x8a8d92, roughness: wet > 0.5 ? 0.3 : 0.85 });
    addMesh(
      ribbon(tr, {
        from: () => side * (hw + 4.8),
        to: () => side * (hw + 19),
        segs: 2,
        y: () => 0.0,
        include: (i) => {
          const s = i * tr.ds;
          return s < 150 || s > tr.length - 260;
        },
      }),
      lane,
    );
    for (let s = -250; s < 140; s += segLen) {
      const fm = frameAt(tr, s, side * (hw + 19), side);
      parts.push(geo(boxAt(segLen, 4.5, 18, 0, 2.25, 9.5), fm));
      parts.push(geo(boxAt(segLen + 0.05, 0.6, 21, 0, 9.3, 9), fm));
      const d = new THREE.PlaneGeometry(segLen - 1.4, 3.6);
      d.rotateY(Math.PI);
      d.translate(0, 1.9, 0.45);
      doors.push(geo(d, fm));
      const g = new THREE.PlaneGeometry(segLen - 0.2, 3.8);
      g.rotateY(Math.PI);
      g.translate(0, 6.8, 2.55);
      glass.push(geo(g, fm));
      parts.push(geo(boxAt(segLen, 4.6, 16, 0, 6.8, 10.6), fm));
    }
    addMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.6 }), { cast: true });
    addMesh(mergeGeometries(doors), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, emissive: night ? 0x334455 : 0x000000 }));
    const gw = Tex.windows(7, true);
    addMesh(
      mergeGeometries(glass),
      new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.9, emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? gw : null, emissiveIntensity: night ? 0.6 : 0, envMapIntensity: 1.5 }),
    );
    // Roof sign
    const signM = frameAt(tr, -60, side * (hw + 19), side);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), new THREE.MeshStandardMaterial({ map: Tex.logoSign('APEX VELOCITY', 'WORLD CIRCUIT SERIES'), roughness: 0.4, emissive: 0xffffff, emissiveMap: Tex.logoSign('APEX VELOCITY', 'WORLD CIRCUIT SERIES'), emissiveIntensity: night ? 1.2 : 0.25 }));
    sign.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(0, 14.5, 3)).premultiply(signM));
    group.add(sign);
    disposables.push(sign.geometry, sign.material as THREE.Material);
  }

  // ---------------------------------------------------------------- Start gantry + lights
  const startLights: THREE.MeshBasicMaterial[] = [];
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 });
  const gantry = (s: number, withLights: boolean, label: string) => {
    const i = tr.wrap(Math.round(tr.wrapS(s) / tr.ds));
    const L = tr.wallL[i] + 1.2;
    const R = tr.wallR[i] + 1.2;
    const fm = frameAt(tr, s, 0, -1);
    const parts: THREE.BufferGeometry[] = [];
    // frame: x = along track, z = away from track on the right side (side -1 => z points to -left = right)
    parts.push(geo(boxAt(0.8, 8.5, 0.8, 0, 4.25, R), fm));
    parts.push(geo(boxAt(0.8, 8.5, 0.8, 0, 4.25, -L), fm));
    parts.push(geo(boxAt(1.2, 1.6, L + R + 0.8, 0, 8.2, (R - L) / 2), fm));
    addMesh(mergeGeometries(parts), steelMat, { cast: true });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(L + R, 26), 2.2), new THREE.MeshStandardMaterial({ map: Tex.logoSign(label, 'APEX VELOCITY'), roughness: 0.4, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: Tex.logoSign(label, 'APEX VELOCITY'), emissiveIntensity: night ? 1.0 : 0.15 }));
    board.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-0.62, 8.2, (R - L) / 2)).premultiply(fm));
    group.add(board);
    disposables.push(board.geometry, board.material as THREE.Material);
    if (withLights) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 4.6), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5 }));
      housing.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.9, 6.9, 0).premultiply(fm));
      group.add(housing);
      disposables.push(housing.geometry, housing.material as THREE.Material);
      const lampGeo = new THREE.CircleGeometry(0.28, 20);
      for (let k = 0; k < 5; k++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x220405, toneMapped: false });
        startLights.push(mat);
        for (const row of [0.22, -0.22]) {
          const lamp = new THREE.Mesh(lampGeo, mat);
          lamp.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-1.16, 6.9 + row, (k - 2) * 0.88)).premultiply(fm));
          group.add(lamp);
        }
      }
      disposables.push(lampGeo);
    }
  };
  gantry(0, true, 'START');
  // sponsor bridge on the longest other straight
  {
    let bestS = -1;
    let bestRun = 0;
    let run = 0;
    for (let i = 0; i < tr.N * 2; i++) {
      const j = tr.wrap(i);
      if (Math.abs(tr.curv[j]) < 1 / 600) run++;
      else {
        const s = (j - run / 2) * tr.ds;
        if (run > bestRun && Math.abs(tr.wrapS(s)) > 400 && Math.abs(tr.wrapS(s) - tr.length) > 400) {
          bestRun = run;
          bestS = s;
        }
        run = 0;
      }
    }
    if (bestS > 0) gantry(bestS, false, 'VELOCITY LABS');
  }

  // ---------------------------------------------------------------- Light towers, marshal posts, billboards, brake boards
  {
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.28, 14, 8);
    poleGeo.translate(0, 7, 0);
    const armGeo = new THREE.BoxGeometry(0.25, 0.25, 5);
    armGeo.translate(0, 13.8, -2.4);
    const headGeo = new THREE.BoxGeometry(1.4, 0.3, 0.8);
    headGeo.translate(0, 13.6, -4.8);
    const step = night ? 22 : 45;
    const count = Math.ceil(tr.N / step) + 2;
    const pm = new THREE.InstancedMesh(mergeGeometries([poleGeo.toNonIndexed(), armGeo.toNonIndexed()])!, steelMat, count);
    const hm = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(3, 2.9, 2.6) : new THREE.Color(0.5, 0.52, 0.55), toneMapped: !night }), count);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < tr.N; i += step) {
      const side = n % 2 === 0 ? 1 : -1;
      const wall = side > 0 ? tr.wallL[i] : tr.wallR[i];
      const fm = frameAt(tr, i * tr.ds, side * (wall + 2.5), side);
      pm.setMatrixAt(n, fm);
      hm.setMatrixAt(n, fm);
      n++;
    }
    pm.count = hm.count = n;
    pm.castShadow = opts.sceneryShadows;
    group.add(pm, hm);
    disposables.push(poleGeo, armGeo, headGeo, pm.geometry, hm.material as THREE.Material);

    // marshal posts
    const post = mergeGeometries([boxAt(2.2, 2.6, 2.2, 0, 1.3, 0).toNonIndexed(), boxAt(2.8, 0.2, 2.8, 0, 2.7, 0).toNonIndexed()])!;
    const mpCount = Math.ceil(tr.length / 280);
    const mpm = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: 0xff7b38, roughness: 0.6 }), mpCount);
    n = 0;
    for (let s = 140; s < tr.length - 300 && n < mpCount; s += 280) {
      const i = tr.wrap(Math.round(s / tr.ds));
      const side = tr.curv[i] > 0 ? -1 : 1;
      const wall = side > 0 ? tr.wallL[i] : tr.wallR[i];
      mpm.setMatrixAt(n++, frameAt(tr, s, side * (wall + 3.5), side));
    }
    mpm.count = n;
    mpm.castShadow = opts.sceneryShadows;
    group.add(mpm);
    disposables.push(post, mpm.material as THREE.Material);

    // billboards
    const bbParts: THREE.BufferGeometry[] = [];
    const bbLegs: THREE.BufferGeometry[] = [];
    let k = 0;
    for (let s = 220; s < tr.length - 200; s += 150 + rnd() * 80) {
      const i = tr.wrap(Math.round(s / tr.ds));
      const side = k % 2 === 0 ? 1 : -1;
      const wall = side > 0 ? tr.wallL[i] : tr.wallR[i];
      const fm = frameAt(tr, s, side * (wall + 6), side);
      const rot = new THREE.Matrix4().makeRotationY(side * 0.35);
      const b = new THREE.PlaneGeometry(10, 5);
      const uv = b.getAttribute('uv');
      const off = Math.floor(rnd() * 8) / 8;
      for (let v = 0; v < uv.count; v++) uv.setX(v, off + uv.getX(v) / 8 * 0.999);
      b.rotateY(Math.PI);
      b.translate(0, 5.2, 0);
      b.applyMatrix4(rot);
      bbParts.push(geo(b, fm));
      for (const lx of [-5, 5]) {
        const leg = boxAt(0.25, 2.8, 0.25, lx * 0.8, 1.4, 0.3);
        leg.applyMatrix4(rot);
        bbLegs.push(geo(leg, fm));
      }
      k++;
    }
    if (bbParts.length) {
      const adTex = Tex.adBoards('day');
      addMesh(mergeGeometries(bbParts), new THREE.MeshStandardMaterial({ map: adTex, side: THREE.DoubleSide, roughness: 0.5, emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? adTex : null, emissiveIntensity: 0.9 }));
      addMesh(mergeGeometries(bbLegs), steelMat, { cast: true });
    }

    // distance boards before heavy braking zones
    const boardParts: Record<string, THREE.BufferGeometry[]> = { '300': [], '200': [], '100': [] };
    for (const bs of tr.brakingPoints()) {
      const i = tr.wrap(Math.round(bs / tr.ds));
      // place on the outside of the coming corner
      let ksum = 0;
      for (let o = 0; o < 40; o++) ksum += tr.curv[tr.wrap(i + o)];
      const side = ksum > 0 ? -1 : 1;
      for (const d of [300, 200, 100]) {
        const s = bs + 40 - d;
        const j = tr.wrap(Math.round(tr.wrapS(s) / tr.ds));
        const wall = side > 0 ? tr.wallL[j] : tr.wallR[j];
        const fm = frameAt(tr, s, side * Math.min(wall - 0.8, hw + 6), side);
        const b = new THREE.PlaneGeometry(1.1, 1.1);
        b.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
        b.translate(0, 1.4, 0);
        boardParts[String(d)].push(geo(b, fm));
      }
    }
    for (const d of ['300', '200', '100']) {
      if (boardParts[d].length) addMesh(mergeGeometries(boardParts[d]), new THREE.MeshStandardMaterial({ map: Tex.distanceBoard(d), side: THREE.DoubleSide, roughness: 0.5 }));
    }
  }

  // Tyre stacks on the outside of gravel corners
  {
    const tyre = new THREE.TorusGeometry(0.42, 0.18, 6, 12);
    tyre.rotateX(Math.PI / 2);
    const stack = mergeGeometries([0, 1, 2].map((k) => tyre.clone().translate(0, 0.18 + k * 0.36, 0).toNonIndexed()))!;
    const max = 900;
    const im = new THREE.InstancedMesh(stack, new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 }), max);
    const colTop = new THREE.Color();
    let n = 0;
    const m = new THREE.Matrix4();
    for (let i = 0; i < tr.N && n < max; i++) {
      for (const sgn of [-1, 1]) {
        const g = sgn > 0 ? tr.gravelL : tr.gravelR;
        if (!g[i] || i % 1 !== 0) continue;
        const wall = sgn > 0 ? tr.wallL[i] : tr.wallR[i];
        const l = sgn * (wall - 0.55);
        m.makeTranslation(tr.px[i] + tr.tz[i] * l, tr.py[i], tr.pz[i] - tr.tx[i] * l);
        im.setMatrixAt(n, m);
        colTop.set(n % 2 ? 0xe4202c : 0xf4f4f4).multiplyScalar(0.5);
        im.setColorAt(n, n % 4 === 0 ? colTop : new THREE.Color(1, 1, 1));
        n++;
      }
    }
    im.count = n;
    group.add(im);
    disposables.push(tyre, stack, im.material as THREE.Material);
  }

  return {
    group,
    startLights,
    racingLine,
    grandstandSpots,
    update(t: number) {
      for (const u of updaters) u(t);
    },
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}

function makeWaterNormal() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const u = (x / s) * Math.PI * 2;
      const v = (y / s) * Math.PI * 2;
      h[y * s + x] = Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + u * 2) * 0.3 + Math.sin(u * 9 - v * 7) * 0.15;
    }
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = h[y * s + ((x + 1) % s)] - h[y * s + ((x - 1 + s) % s)];
      const dy = h[((y + 1) % s) * s + x] - h[((y - 1 + s) % s) * s + x];
      const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
      const o = (y * s + x) * 4;
      img.data[o] = (n.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
