import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDef, Livery } from '../data/cars';
import { Tex } from '../core/Textures';

/**
 * Original Formula-style car built entirely from code: lofted superellipse body sections,
 * extruded aerofoil wing elements, tube halo, lathe tyres. Static parts are merged per material
 * to keep draw calls low. The public surface (`root`, `update`) is what gameplay uses, so a
 * GLTF model can replace the procedural mesh later without touching vehicle logic.
 */

interface Sec {
  z: number;
  w: number;
  h: number;
  y: number;
  x?: number;
  p?: number;
  flat?: number;
}

type PaintFn = (x: number, y: number, z: number) => THREE.Color;

function loft(secs: Sec[], seg = 32, caps = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = secs.length;
  for (let i = 0; i < n; i++) {
    const s = secs[i];
    const p = s.p ?? 2.6;
    for (let j = 0; j <= seg; j++) {
      const a = -Math.PI / 2 + (j / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const px = (s.x ?? 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      let py = s.y + s.h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p);
      if (s.flat !== undefined) py = Math.max(py, s.y - s.h * s.flat);
      pos.push(px, py, s.z);
      uv.push(j / seg, i / (n - 1));
    }
  }
  const row = seg + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const [ri, front] of [
      [0, true],
      [n - 1, false],
    ] as [number, boolean][]) {
      const s = secs[ri];
      const ci = pos.length / 3;
      pos.push(s.x ?? 0, s.y, s.z);
      uv.push(0.5, ri / (n - 1));
      for (let j = 0; j < seg; j++) {
        const a = ri * row + j;
        // Sections run front (+z) to back, so the first cap faces +z.
        if (front) idx.push(ci, a, a + 1);
        else idx.push(ci, a + 1, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Inverted aerofoil cross-section extruded along X (span). Leading edge faces +Z. */
function wing(chord: number, thick: number, span: number, camber = -0.05): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const N = 14;
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    const yc = camber * 4 * x * (1 - x);
    top.push([chord / 2 - x * chord, (yc + yt) * chord]);
    bot.push([chord / 2 - x * chord, (yc - yt) * chord]);
  }
  sh.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) sh.lineTo(top[i][0], top[i][1]);
  for (let i = bot.length - 1; i >= 0; i--) sh.lineTo(bot[i][0], bot[i][1]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, steps: 1, curveSegments: 4 });
  // rotateY(-90deg): shape-x -> +z, shape-y -> y, extrusion -> -x (proper rotation keeps winding)
  g.rotateY(-Math.PI / 2);
  g.translate(span / 2, 0, 0);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
  g.translate(0, len / 2, 0);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

function paint(g: THREE.BufferGeometry, fn: PaintFn | THREE.Color) {
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn instanceof THREE.Color ? fn : fn(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  return geo;
}

function plain(g: THREE.BufferGeometry) {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  return geo;
}

function liveryPaint(l: Livery): PaintFn {
  const P = new THREE.Color(l.primary);
  const S = new THREE.Color(l.secondary);
  const A = new THREE.Color(l.accent);
  const tmp = new THREE.Color();
  return (x, y, z) => {
    const ax = Math.abs(x);
    if (y < 0.27) return tmp.copy(S).multiplyScalar(0.7); // lower body / floor edges
    switch (l.pattern) {
      case 'classic':
        if (ax < 0.035 && z > 0.9 && z < 2.6 && y > 0.4) return tmp.copy(A);
        if (y < 0.33) return tmp.copy(S);
        if (z < -0.5 && y > 0.62 && ax < 0.05) return tmp.copy(A);
        return tmp.copy(P);
      case 'split':
        if (y > 0.62 && z < 0.2) return tmp.copy(S);
        if (z > 1.6 && y > 0.36) return tmp.copy(S);
        if (Math.abs(y - 0.38) < 0.025 && z < 0.6) return tmp.copy(A);
        return tmp.copy(P);
      case 'arrow': {
        const v = z - 1.15 - ax * 2.2;
        if (Math.abs(v) < 0.09 && y > 0.3) return tmp.copy(A);
        if (v > 0.09 && y > 0.3) return tmp.copy(S);
        if (z < -0.6 && y > 0.55) return tmp.copy(S);
        return tmp.copy(P);
      }
      case 'stripe':
        if (Math.abs(y - 0.4) < 0.035 && ax > 0.2) return tmp.copy(A);
        if (ax < 0.06 && y > 0.45) return tmp.copy(S);
        return tmp.copy(P);
    }
  };
}

interface CarGeoSet {
  paint: THREE.BufferGeometry;
  carbon: THREE.BufferGeometry;
  black: THREE.BufferGeometry;
  halo: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
}

const geoCache = new Map<string, CarGeoSet>();

function buildGeometry(def: CarDef): CarGeoSet {
  const l = def.livery;
  const pf = liveryPaint(l);
  const P = new THREE.Color(l.primary);
  const S = new THREE.Color(l.secondary);
  const A = new THREE.Color(l.accent);
  const paintParts: THREE.BufferGeometry[] = [];
  const carbon: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];

  const df = def.aero === 'highDownforce' ? 1.2 : def.aero === 'lowDrag' ? 0.75 : 1;

  // --- Monocoque, nose and engine cover (one continuous loft)
  paintParts.push(
    paint(
      loft([
        { z: 2.78, w: 0.04, h: 0.035, y: 0.23 },
        { z: 2.62, w: 0.09, h: 0.065, y: 0.25 },
        { z: 2.3, w: 0.13, h: 0.095, y: 0.29 },
        { z: 1.9, w: 0.17, h: 0.13, y: 0.355, flat: 0.8 },
        { z: 1.45, w: 0.215, h: 0.17, y: 0.42, flat: 0.8 },
        { z: 1.0, w: 0.27, h: 0.2, y: 0.465, flat: 0.85 },
        { z: 0.55, w: 0.33, h: 0.225, y: 0.48, flat: 0.9 },
        { z: 0.05, w: 0.37, h: 0.245, y: 0.47, flat: 0.9 },
        { z: -0.5, w: 0.36, h: 0.25, y: 0.46, flat: 0.9 },
        { z: -1.1, w: 0.28, h: 0.22, y: 0.43, flat: 0.9 },
        { z: -1.7, w: 0.19, h: 0.17, y: 0.39 },
        { z: -2.2, w: 0.12, h: 0.12, y: 0.37 },
        { z: -2.45, w: 0.07, h: 0.07, y: 0.37 },
      ], 40),
      pf,
    ),
  );

  // Airbox + engine cover hump with shark fin
  paintParts.push(
    paint(
      loft([
        { z: 0.1, w: 0.1, h: 0.13, y: 0.85, p: 2.2 },
        { z: -0.1, w: 0.135, h: 0.165, y: 0.83, p: 2.4 },
        { z: -0.5, w: 0.15, h: 0.17, y: 0.77, p: 2.6 },
        { z: -1.0, w: 0.13, h: 0.13, y: 0.67 },
        { z: -1.5, w: 0.09, h: 0.09, y: 0.57 },
        { z: -1.9, w: 0.05, h: 0.05, y: 0.49 },
      ], 28),
      pf,
    ),
  );
  {
    const fin = new THREE.Shape();
    fin.moveTo(-0.3, 0);
    fin.lineTo(-1.75, 0);
    fin.lineTo(-1.95, 0.32);
    fin.lineTo(-1.2, 0.2);
    fin.quadraticCurveTo(-0.6, 0.14, -0.3, 0);
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(0.006, 0.86, 0);
    paintParts.push(paint(g, (x, y) => (y > 1.05 ? A : P)));
  }
  // Airbox intake (black)
  black.push(plain(loft([
    { z: 0.115, w: 0.075, h: 0.095, y: 0.86, p: 2.2 },
    { z: 0.0, w: 0.07, h: 0.09, y: 0.86, p: 2.2 },
  ], 20)));

  // --- Sidepods (mirrored)
  for (const sgn of [-1, 1]) {
    const pod = loft([
      { z: 0.62, x: sgn * 0.6, w: 0.19, h: 0.12, y: 0.37, p: 3 },
      { z: 0.4, x: sgn * 0.62, w: 0.24, h: 0.16, y: 0.38, p: 3 },
      { z: 0.0, x: sgn * 0.61, w: 0.26, h: 0.165, y: 0.37, p: 3 },
      { z: -0.55, x: sgn * 0.56, w: 0.24, h: 0.15, y: 0.35, p: 2.8 },
      { z: -1.1, x: sgn * 0.45, w: 0.17, h: 0.12, y: 0.31 },
      { z: -1.6, x: sgn * 0.3, w: 0.08, h: 0.07, y: 0.27 },
    ], 28);
    paintParts.push(paint(pod, pf));
    // Inlet
    black.push(plain(box(0.36, 0.17, 0.05, sgn * 0.6, 0.39, 0.635)));
    // Side impact structure / bargeboard vanes
    carbon.push(plain(box(0.02, 0.22, 0.55, sgn * 0.82, 0.26, 0.85)));
    carbon.push(plain(box(0.02, 0.16, 0.4, sgn * 0.76, 0.22, 0.95, 0, sgn * 0.15, 0)));
  }

  // --- Floor (plan-view shape extruded thin)
  {
    const s = new THREE.Shape();
    s.moveTo(-0.32, 1.35);
    s.lineTo(0.32, 1.35);
    s.lineTo(0.78, 0.75);
    s.lineTo(0.8, -1.0);
    s.lineTo(0.62, -1.62);
    s.lineTo(0.52, -2.2);
    s.lineTo(-0.52, -2.2);
    s.lineTo(-0.62, -1.62);
    s.lineTo(-0.8, -1.0);
    s.lineTo(-0.78, 0.75);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.085, 0);
    carbon.push(plain(g));
    // Floor edge fences
    for (const sgn of [-1, 1]) carbon.push(plain(box(0.015, 0.06, 1.9, sgn * 0.79, 0.11, -0.1)));
  }

  // --- Diffuser
  for (let i = -3; i <= 3; i++) {
    carbon.push(plain(box(0.012, 0.22, 0.6, i * 0.15, 0.17, -2.32, -0.42, 0, 0)));
  }
  carbon.push(plain(box(1.0, 0.012, 0.62, 0, 0.17, -2.32, -0.42, 0, 0)));

  // --- Front wing: main plane + two flaps, swept endplates
  const fwSpan = 0.78;
  for (const sgn of [-1, 1]) {
    const cx = sgn * (0.17 + fwSpan / 2);
    const main = wing(0.36, 0.1, fwSpan, 0.05);
    main.rotateX(0.06);
    main.translate(cx, 0.1, 2.62);
    paintParts.push(paint(main, S));
    const f1 = wing(0.22, 0.09, fwSpan * 0.95, 0.07);
    f1.rotateX(0.32 * df);
    f1.translate(cx + sgn * 0.02, 0.17, 2.43);
    paintParts.push(paint(f1, P));
    const f2 = wing(0.16, 0.09, fwSpan * 0.85, 0.07);
    f2.rotateX(0.55 * df);
    f2.translate(cx + sgn * 0.05, 0.245, 2.35);
    paintParts.push(paint(f2, A));
    // Endplate
    const ep = new THREE.Shape();
    ep.moveTo(0.3, 0);
    ep.lineTo(-0.25, 0);
    ep.lineTo(-0.3, 0.27);
    ep.lineTo(0.05, 0.3);
    ep.quadraticCurveTo(0.28, 0.2, 0.3, 0);
    const eg = new THREE.ExtrudeGeometry(ep, { depth: 0.014, bevelEnabled: false });
    eg.rotateY(-Math.PI / 2);
    eg.translate(sgn * 0.96 + 0.007, 0.05, 2.55);
    paintParts.push(paint(eg, S));
    // Nose pillars
    carbon.push(plain(box(0.018, 0.16, 0.18, sgn * 0.08, 0.17, 2.52)));
  }
  // Central neutral section
  carbon.push(plain(box(0.34, 0.025, 0.32, 0, 0.1, 2.62)));

  // --- Rear wing
  {
    const span = 0.96;
    const main = wing(0.34, 0.11, span, 0.06);
    main.rotateX(0.12 * df);
    main.translate(0, 0.84, -2.42);
    paintParts.push(paint(main, S));
    const flap = wing(0.24, 0.09, span, 0.05);
    flap.rotateX(0.48 * df);
    flap.translate(0, 0.98, -2.56);
    paintParts.push(paint(flap, P));
    for (const sgn of [-1, 1]) {
      const ep = new THREE.Shape();
      ep.moveTo(0.28, 0.2);
      ep.lineTo(0.3, 0.68);
      ep.lineTo(-0.38, 0.72);
      ep.lineTo(-0.4, 0.42);
      ep.quadraticCurveTo(-0.1, 0.32, -0.05, 0.12);
      ep.lineTo(0.28, 0.2);
      const g = new THREE.ExtrudeGeometry(ep, { depth: 0.016, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      g.translate(sgn * 0.49 + 0.008, 0.38, -2.45);
      paintParts.push(paint(g, (x, y) => (y > 0.98 ? A : S)));
    }
    // Swan-neck pylon
    carbon.push(plain(box(0.025, 0.42, 0.12, 0, 0.66, -2.36, 0.25, 0, 0)));
    // Beam wing
    const beam = wing(0.2, 0.1, 0.72, 0.05);
    beam.rotateX(0.25);
    beam.translate(0, 0.44, -2.42);
    carbon.push(plain(beam));
    // Gearbox / crash structure
    carbon.push(plain(box(0.16, 0.14, 0.42, 0, 0.36, -2.4)));
  }

  // --- Suspension (wishbones + push rods)
  const hubF = 1.75;
  const hubR = -1.85;
  for (const sgn of [-1, 1]) {
    const wx = sgn * 0.68;
    // front
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.17, 0.42, hubF + 0.25), new THREE.Vector3(wx, 0.44, hubF), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.17, 0.42, hubF - 0.35), new THREE.Vector3(wx, 0.44, hubF), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.15, 0.27, hubF + 0.3), new THREE.Vector3(wx, 0.25, hubF), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.15, 0.27, hubF - 0.35), new THREE.Vector3(wx, 0.25, hubF), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.2, 0.55, hubF - 0.2), new THREE.Vector3(wx * 0.92, 0.27, hubF), 0.013)));
    // rear
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.14, 0.42, hubR + 0.3), new THREE.Vector3(wx, 0.45, hubR), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.14, 0.42, hubR - 0.35), new THREE.Vector3(wx, 0.45, hubR), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.12, 0.25, hubR + 0.3), new THREE.Vector3(wx, 0.24, hubR), 0.016)));
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.12, 0.25, hubR - 0.3), new THREE.Vector3(wx, 0.24, hubR), 0.016)));
    // Mirrors
    carbon.push(plain(rod(new THREE.Vector3(sgn * 0.3, 0.6, 0.62), new THREE.Vector3(sgn * 0.45, 0.68, 0.58), 0.012)));
    paintParts.push(paint(box(0.11, 0.05, 0.05, sgn * 0.47, 0.69, 0.58, 0, sgn * 0.15, 0), P));
    accent.push(plain(box(0.09, 0.035, 0.005, sgn * 0.47, 0.69, 0.523, 0, sgn * 0.15, 0)));
  }

  // --- Cockpit opening (black inset), headrest
  black.push(
    plain(
      loft([
        { z: 0.62, w: 0.13, h: 0.03, y: 0.715 },
        { z: 0.45, w: 0.22, h: 0.05, y: 0.712 },
        { z: 0.0, w: 0.24, h: 0.05, y: 0.71 },
        { z: -0.18, w: 0.2, h: 0.04, y: 0.715 },
      ], 24),
    ),
  );

  const halo = plain(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.3, 0.68, -0.15),
        new THREE.Vector3(-0.3, 0.84, 0.15),
        new THREE.Vector3(-0.2, 0.89, 0.5),
        new THREE.Vector3(0, 0.9, 0.62),
        new THREE.Vector3(0.2, 0.89, 0.5),
        new THREE.Vector3(0.3, 0.84, 0.15),
        new THREE.Vector3(0.3, 0.68, -0.15),
      ]),
      48,
      0.03,
      8,
      false,
    ),
  );
  const haloPillar = plain(rod(new THREE.Vector3(0, 0.9, 0.62), new THREE.Vector3(0, 0.62, 0.9), 0.028));

  const merge = (arr: THREE.BufferGeometry[]) => {
    const m = mergeGeometries(arr, false)!;
    m.computeBoundingSphere();
    return m;
  };
  return {
    paint: merge(paintParts),
    carbon: merge(carbon),
    black: merge(black),
    halo: merge([halo, haloPillar]),
    accent: merge(accent),
  };
}

// Shared wheel geometry
let wheelGeo: { tireF: THREE.BufferGeometry; tireR: THREE.BufferGeometry; side: THREE.BufferGeometry; rim: THREE.BufferGeometry; cover: THREE.BufferGeometry; disc: THREE.BufferGeometry; ring: THREE.BufferGeometry } | null = null;

function tireGeo(radius: number, width: number) {
  const r0 = radius * 0.64;
  const w = width / 2;
  const pts = [
    new THREE.Vector2(r0, -w),
    new THREE.Vector2(radius - 0.035, -w),
    new THREE.Vector2(radius - 0.01, -w + 0.02),
    new THREE.Vector2(radius, -w + 0.06),
    new THREE.Vector2(radius, w - 0.06),
    new THREE.Vector2(radius - 0.01, w - 0.02),
    new THREE.Vector2(radius - 0.035, w),
    new THREE.Vector2(r0, w),
  ];
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2);
  return g;
}

function getWheelGeo() {
  if (wheelGeo) return wheelGeo;
  const side = new THREE.RingGeometry(0.23, 0.345, 40, 1);
  const rim = new THREE.CylinderGeometry(0.232, 0.232, 0.3, 28, 1, true);
  rim.rotateZ(Math.PI / 2);
  const cover = new THREE.CircleGeometry(0.228, 32);
  const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 24);
  disc.rotateZ(Math.PI / 2);
  const ring = new THREE.RingGeometry(0.17, 0.2, 32, 1);
  wheelGeo = { tireF: tireGeo(0.36, 0.33), tireR: tireGeo(0.37, 0.42), side, rim, cover, disc, ring };
  return wheelGeo;
}

const wheelMetalCache = new Map<string, THREE.BufferGeometry>();

/** Rim + hub cover + livery ring merged into one vertex-coloured mesh (1 draw call per wheel). */
function wheelMetal(front: boolean, sgn: number, ringColor: string) {
  const key = `${front}|${sgn}|${ringColor}`;
  let g = wheelMetalCache.get(key);
  if (g) return g;
  const wg = getWheelGeo();
  const w = front ? 0.33 : 0.42;
  const rim = wg.rim.clone();
  rim.scale(w / 0.3, 1, 1);
  const place = (src: THREE.BufferGeometry, x: number) => {
    const c = src.clone();
    c.rotateY((sgn * Math.PI) / 2);
    c.translate(x, 0, 0);
    return c;
  };
  const cover = place(wg.cover, (sgn * w) / 2 - sgn * 0.03);
  const ring = place(wg.ring, (sgn * w) / 2 - sgn * 0.025);
  const parts = [paint(rim, new THREE.Color(0x24262a)), paint(cover, new THREE.Color(0x1b1d21)), paint(ring, new THREE.Color(ringColor))];
  g = mergeGeometries(parts, false)!;
  wheelMetalCache.set(key, g);
  return g;
}

const WHEEL_SPOTS: [number, number, number, boolean][] = [
  [0.8, 0.36, 1.75, true],
  [-0.8, 0.36, 1.75, true],
  [0.79, 0.37, -1.85, false],
  [-0.79, 0.37, -1.85, false],
];

const wheelCache = new Map<string, THREE.BufferGeometry>();
function wheelGeometry(front: boolean, sgn: number, ringColor: string) {
  const key = `${front}|${sgn}|${ringColor}`;
  let g = wheelCache.get(key);
  if (!g) {
    const wg = getWheelGeo();
    g = mergeGeometries([paint((front ? wg.tireF : wg.tireR).clone(), new THREE.Color(0x141416)), wheelMetal(front, sgn, ringColor)], false)!;
    wheelCache.set(key, g);
  }
  return g;
}

interface CarExtras {
  carbon: THREE.BufferGeometry;
  black: THREE.BufferGeometry;
  decals: THREE.BufferGeometry;
  decalTex: THREE.Texture;
  helmet: THREE.BufferGeometry;
  discs: THREE.BufferGeometry;
}
const extrasCache = new Map<string, CarExtras>();

/** Per-livery merged geometry + decal atlas (built once, shared by every instance of that car). */
function carExtras(def: CarDef): CarExtras {
  const hit = extrasCache.get(def.id);
  if (hit) return hit;
  const geos = geoCache.get(def.id)!;
  const l = def.livery;
  const ink = l.pattern === 'classic' || l.primary === '#F7F7F4' || l.primary === '#FFD43B' || l.primary === '#C9CED6' ? (l.primary === '#E4202C' ? '#F7F7F4' : '#101216') : '#F7F7F4';
  // Atlas layout (1024x256): number 128x128 | side sponsor 512x96 | rear sponsor 384x96 / endplate 512x128
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const slots: Record<string, number[]> = {
    num: [0, 0, 128, 128],
    side: [128, 0, 512, 96],
    rear: [640, 0, 384, 96],
    end: [128, 128, 512, 128],
  };
  const draw = (slot: number[], tex: THREE.Texture) => ctx.drawImage(tex.image as HTMLCanvasElement, slot[0], slot[1], slot[2], slot[3]);
  draw(slots.num, Tex.decal(String(l.number), ink, null, 128, 128, true));
  draw(slots.side, Tex.decal(l.sponsor, ink, null, 512, 96));
  draw(slots.rear, Tex.decal(l.sponsor, ink === '#101216' ? '#101216' : '#F7F7F4', null, 384, 96));
  draw(slots.end, Tex.decal(l.sponsor, l.primary === '#1B1D22' ? '#E4202C' : '#F7F7F4', null, 512, 128));
  const decalTex = new THREE.CanvasTexture(c);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.anisotropy = 4;
  const parts: THREE.BufferGeometry[] = [];
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const m = new THREE.Matrix4();
  const decal = (slot: number[], w: number, h: number, pos: [number, number, number], rot: [number, number, number], flipV = false) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = flipV ? 1 - uv.getY(i) : uv.getY(i);
      uv.setXY(i, (slot[0] + u * slot[2]) / W, 1 - (slot[1] + (1 - v) * slot[3]) / H);
    }
    e.set(rot[0], rot[1], rot[2], 'YXZ');
    m.makeRotationFromEuler(e).setPosition(pos[0], pos[1], pos[2]);
    g.applyMatrix4(m);
    parts.push(g.toNonIndexed());
  };
  decal(slots.num, 0.2, 0.2, [0, 0.505, 1.75], [-Math.PI / 2 + 0.3, 0, 0]);
  for (const sgn of [-1, 1]) {
    decal(slots.side, 0.78, 0.15, [sgn * 0.874, 0.39, -0.1], [0, (sgn * Math.PI) / 2, 0]);
    decal(slots.num, 0.17, 0.17, [sgn * 0.153, 0.8, -0.36], [0, (sgn * Math.PI) / 2, 0]);
    decal(slots.end, 0.55, 0.13, [sgn * 0.51, 0.82, -2.47], [0, (sgn * Math.PI) / 2, 0]);
  }
  decal(slots.rear, 0.84, 0.15, [0, 1.02, -2.6], [-0.72, Math.PI, 0]);

  const shell = new THREE.SphereGeometry(0.125, 20, 14);
  shell.scale(0.95, 1, 1.08);
  const visor = new THREE.SphereGeometry(0.128, 20, 8, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.2);
  visor.scale(0.95, 1, 1.08);
  const stripe = new THREE.TorusGeometry(0.12, 0.012, 6, 24);
  stripe.rotateX(Math.PI / 2 + 0.3);
  const helmet = mergeGeometries([paint(shell, new THREE.Color(l.helmet)), paint(visor, new THREE.Color(0x0c0e11)), paint(stripe, new THREE.Color(l.primary))], false)!;

  const wg = getWheelGeo();
  const discs = mergeGeometries(
    WHEEL_SPOTS.map(([x, r, z, front]) => {
      const w = front ? 0.33 : 0.42;
      const sgn = Math.sign(x);
      return plain(wg.disc.clone().translate(x + (-sgn * w) / 2 + sgn * 0.06, r, z));
    }),
    false,
  )!;
  const out: CarExtras = {
    carbon: mergeGeometries([geos.carbon, geos.halo], false)!,
    black: mergeGeometries([geos.black, geos.accent], false)!,
    decals: mergeGeometries(parts, false)!,
    decalTex,
    helmet,
    discs,
  };
  extrasCache.set(def.id, out);
  return out;
}

export interface CarVisualState {
  speed: number;
  steerAngle: number;
  wheelSpin: number;
  brake: number;
  pitch: number;
  roll: number;
  rain: boolean;
  time: number;
  bounce: number;
}

export class CarModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly cockpitAnchor = new THREE.Object3D();
  readonly frontWingAnchor = new THREE.Object3D();
  private wheels: { spin: THREE.Object3D; steer?: THREE.Object3D }[] = [];
  private brakeMat: THREE.MeshStandardMaterial;
  private rainLight: THREE.Mesh;
  readonly paintMat: THREE.MeshStandardMaterial;
  /** Fine detail (decals, helmet, tyre lettering) hidden at distance as a cheap LOD. */
  readonly detail = new THREE.Group();
  readonly shadow: THREE.Mesh;
  private helmet: THREE.Group;
  private sidewalls: THREE.Mesh[] = [];
  private detailOn = true;

  /** Distance LOD: drop decals, helmet detail and tyre lettering on far-away cars. */
  setDetail(on: boolean) {
    if (on === this.detailOn) return;
    this.detailOn = on;
    this.detail.visible = on;
    for (const sw of this.sidewalls) sw.visible = on;
  }

  constructor(readonly def: CarDef, opts: { castShadow?: boolean; ghost?: boolean; lite?: boolean } = {}) {
    let geos = geoCache.get(def.id);
    if (!geos) {
      geos = buildGeometry(def);
      geoCache.set(def.id, geos);
    }
    const l = def.livery;
    // Clear-coat paint for High/Ultra; Performance uses a tuned standard material (much cheaper per pixel).
    this.paintMat = opts.lite
      ? new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.33, envMapIntensity: 0.8 })
      : new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.7 });
    const carbonTex = Tex.carbon();
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, map: carbonTex, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.9 });
    carbonTex.repeat.set(6, 6);
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.6, metalness: 0.3 });
    const extra = carExtras(def);

    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.body, cast = !!opts.castShadow) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = !opts.ghost;
      parent.add(mesh);
      return mesh;
    };
    // Body = 3 draw calls: livery paint, carbon (incl. halo), black (incl. inlets & mirror glass).
    add(geos.paint, this.paintMat);
    add(extra.carbon, carbonMat);
    add(extra.black, blackMat);

    // All decals live in one per-livery atlas -> a single mesh.
    const decalMat = new THREE.MeshStandardMaterial({ map: extra.decalTex, transparent: true, roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, side: THREE.DoubleSide });
    if (!opts.ghost) add(extra.decals, decalMat, this.detail, false);

    // Driver helmet (shell, visor, stripe) merged into one vertex-coloured mesh.
    this.helmet = new THREE.Group();
    add(extra.helmet, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.35 }), this.helmet, false);
    this.helmet.position.set(0, 0.79, 0.12);
    if (!opts.ghost) this.detail.add(this.helmet);
    this.body.add(this.detail);

    // Wheels: tyre + rim + cover + livery ring = 1 mesh per wheel; all brake discs = 1 mesh.
    const wg = getWheelGeo();
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.62 });
    const sideMat = new THREE.MeshStandardMaterial({ map: Tex.tireSide(), roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    const ringColor = l.primary === '#1B1D22' ? l.secondary : l.primary;
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5, emissive: new THREE.Color(1, 0.35, 0.05), emissiveIntensity: 0 });
    add(extra.discs, this.brakeMat, this.body, false);
    const mats: THREE.Material[] = [this.paintMat, carbonMat, blackMat, wheelMat, sideMat];
    if (opts.ghost) {
      for (const m of mats) {
        m.transparent = true;
        m.opacity = 0.35;
        m.depthWrite = false;
      }
    }
    for (const [x, r, z, front] of WHEEL_SPOTS) {
      const steer = new THREE.Group();
      steer.position.set(x, r, z);
      const spin = new THREE.Group();
      steer.add(spin);
      const sgn = Math.sign(x);
      const w = front ? 0.33 : 0.42;
      add(wheelGeometry(front, sgn, ringColor), wheelMat, spin);
      if (!opts.lite && !opts.ghost) {
        const side = new THREE.Mesh(wg.side, sideMat);
        side.position.x = (sgn * w) / 2 + sgn * 0.002;
        side.rotation.y = (sgn * Math.PI) / 2;
        side.scale.setScalar(r / 0.36);
        spin.add(side);
        this.sidewalls.push(side);
      }
      this.body.add(steer);
      this.wheels.push({ spin, steer: front ? steer : undefined });
    }

    // Rain light
    this.rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xff1020 }));
    this.rainLight.position.set(0, 0.52, -2.55);
    this.rainLight.visible = false;
    this.body.add(this.rainLight);

    // Contact shadow keeps the car visually grounded even where the shadow map is coarse.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 5.9),
      new THREE.MeshBasicMaterial({ map: Tex.blob(), transparent: true, depthWrite: false, opacity: opts.ghost ? 0.2 : 0.85, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, 0.025, 0.05);
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    this.cockpitAnchor.position.set(0, 0.88, 0.34);
    this.frontWingAnchor.position.set(0.55, 0.42, 2.25);
    this.body.add(this.cockpitAnchor, this.frontWingAnchor);
    this.root.add(this.body);
  }

  setHelmetVisible(v: boolean) {
    this.helmet.visible = v;
  }

  update(s: CarVisualState) {
    for (const w of this.wheels) {
      w.spin.rotation.x = s.wheelSpin;
      if (w.steer) w.steer.rotation.y = s.steerAngle;
    }
    this.body.rotation.x = s.pitch;
    this.body.rotation.z = s.roll;
    this.body.position.y = s.bounce;
    this.brakeMat.emissiveIntensity = s.brake * Math.min(1, s.speed / 40) * 2.2;
    this.rainLight.visible = s.rain && Math.sin(s.time * 12) > -0.2;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.dispose();
    });
  }
}
