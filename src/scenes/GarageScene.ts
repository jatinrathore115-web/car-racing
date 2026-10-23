import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CarModel } from '../vehicle/CarModel';
import type { CarDef } from '../data/cars';
import type { RenderPipeline } from '../core/Renderer';
import { PlanarReflection, applyReflection } from '../effects/PlanarReflection';
import { Tex } from '../core/Textures';
import { clamp, damp, easeOutCubic } from '../core/utils';
import type { SeasonDef } from '../data/seasons';

export type GarageMode = 'menu' | 'garage' | 'select';

/** Premium pit-garage showroom used behind the main menu, garage and track selection. */
export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 400);
  private car: CarModel | null = null;
  private outgoing: CarModel | null = null;
  private table: THREE.Group;
  private ring: THREE.MeshBasicMaterial;
  private t = 0;
  private swapT = 1;
  mode: GarageMode = 'menu';
  private yaw = 0.6;
  private yawV = 0;
  private dragging = false;
  private lastX = 0;
  private dist = 8.2;
  private distTarget = 8.2;
  private orbit = 0;
  private reflection: PlanarReflection | null = null;
  private envRT: THREE.WebGLRenderTarget;
  private look = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  active = false;
  private rimL!: THREE.SpotLight;
  private rimR!: THREE.SpotLight;
  private accent = new THREE.Color(0xe4202c);

  constructor(private pipeline: RenderPipeline) {
    const s = this.scene;
    s.background = new THREE.Color(0x07080b);
    s.fog = new THREE.Fog(0x07080b, 18, 45);
    const pm = new THREE.PMREMGenerator(pipeline.renderer);
    this.envRT = pm.fromScene(new RoomEnvironment(), 0.03);
    s.environment = this.envRT.texture;
    s.environmentIntensity = 0.62;
    pm.dispose();

    // Floor
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.32, metalness: 0.4, map: Tex.asphalt(), envMapIntensity: 0.5 });
    if (pipeline.profile.reflectionRes > 0) {
      this.reflection = new PlanarReflection(s, 0, Math.round(pipeline.width * 0.5), Math.round(pipeline.height * 0.5));
      applyReflection(floorMat, this.reflection, 0.4, 0.35);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // Turntable
    this.table = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.8, 0.1, 96), new THREE.MeshStandardMaterial({ color: 0x1c1f25, metalness: 0.75, roughness: 0.22 }));
    disc.position.y = 0.05;
    disc.receiveShadow = true;
    this.ring = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe4202c).multiplyScalar(2.2), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.76, 0.025, 8, 160), this.ring);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    const inner = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.03, 128), new THREE.MeshBasicMaterial({ color: 0x3a3e46 }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.102;
    this.table.add(disc, ring, inner);
    s.add(this.table);

    // Back wall panels + logo
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.7, metalness: 0.2 });
    for (let i = -6; i <= 6; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 8, 0.2), wallMat);
      const a = i * 0.13;
      panel.position.set(Math.sin(a) * 16, 4, -Math.cos(a) * 16 + 4);
      panel.rotation.y = -a;
      s.add(panel);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 7.4, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1).multiplyScalar(i % 3 === 0 ? 2.5 : 0.6), toneMapped: false }));
      strip.position.set(Math.sin(a + 0.065) * 15.85, 4, -Math.cos(a + 0.065) * 15.85 + 4);
      s.add(strip);
    }
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: Tex.logoSign('APEX VELOCITY', 'RACING DIVISION'), transparent: true, opacity: 0.9 }));
    logo.position.set(0, 5.6, -11.8);
    s.add(logo);

    // Ceiling LED bars (show up as long highlights on the paint)
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(1.6), toneMapped: false });
    for (let i = -2; i <= 2; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 9), ledMat);
      bar.position.set(i * 1.4, 6.2, 0);
      s.add(bar);
    }
    // Tyre racks & cabinets for context
    const tyre = new THREE.TorusGeometry(0.36, 0.17, 10, 24);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.85 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe4202c, roughness: 0.5 });
    for (const [x, z] of [
      [-8.5, -6],
      [-7.6, -7.2],
      [8.2, -6.5],
    ]) {
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(tyre, tyreMat);
        m.rotation.x = Math.PI / 2;
        m.position.set(x, 0.17 + k * 0.34, z);
        s.add(m);
        const st = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 32), stripeMat);
        st.rotation.x = Math.PI / 2;
        st.position.set(x, 0.17 + k * 0.34 + 0.17, z);
        s.add(st);
      }
    }
    const cab = new THREE.MeshStandardMaterial({ color: 0xa70f1b, roughness: 0.35, metalness: 0.5 });
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.7), cab);
      c.position.set(-11 + k * 1.25, 0.55, -9.5);
      c.castShadow = true;
      s.add(c);
    }

    // Lighting
    const key = new THREE.SpotLight(0xffffff, 38, 30, 0.6, 0.6, 1.6);
    key.position.set(2.5, 9, 4);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    s.add(key, key.target);
    this.rimL = new THREE.SpotLight(0xff3a3a, 38, 25, 0.5, 0.8, 1.6);
    this.rimL.position.set(-8, 3, -6);
    s.add(this.rimL, this.rimL.target);
    this.rimR = new THREE.SpotLight(0x7ac8ff, 30, 25, 0.5, 0.8, 1.6);
    this.rimR.position.set(8, 3, -5);
    s.add(this.rimR, this.rimR.target);
    s.add(new THREE.HemisphereLight(0x9ab0d0, 0x0a0b0e, 0.25));

    const el = pipeline.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!this.active || this.mode !== 'garage') return;
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.yawV = dx * 0.006;
      this.yaw += dx * 0.006;
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.mode !== 'garage') return;
        this.distTarget = clamp(this.distTarget + e.deltaY * 0.004, 5.6, 11);
      },
      { passive: true },
    );
  }

  setCar(def: CarDef) {
    if (this.car && this.car.def.id === def.id) return;
    if (this.outgoing) {
      this.outgoing.root.removeFromParent();
      this.outgoing.dispose();
    }
    this.outgoing = this.car;
    this.car = new CarModel(def, { castShadow: true });
    this.car.shadow.visible = true;
    this.table.add(this.car.root);
    this.car.root.position.y = 0.1;
    this.swapT = this.outgoing ? 0 : 1;
    this.ring.color.copy(this.accent).multiplyScalar(2.2);
  }

  /** Season accent drives the showroom lighting: ring, rim lights and a faint room tint. */
  applySeason(def: SeasonDef) {
    this.accent.set(def.ui.accent);
    this.ring.color.copy(this.accent).multiplyScalar(2.2);
    this.rimL.color.set(def.ui.accent);
    this.rimR.color.set(def.ui.accent2);
    const bg = new THREE.Color(def.ui.bg0).multiplyScalar(0.55);
    (this.scene.background as THREE.Color).copy(bg);
    (this.scene.fog as THREE.Fog).color.copy(bg);
  }

  activate(mode: GarageMode) {
    this.mode = mode;
    this.active = true;
    this.pipeline.setScene(this.scene, this.camera);
    this.pipeline.renderer.toneMappingExposure = 1.0;
    this.pipeline.setBloom(0.28, 1.4);
    const fu = this.pipeline.final.uniforms;
    fu.uSat.value = 1.08;
    fu.uContrast.value = 1.08;
    fu.uTint.value.set(1, 1, 1);
    fu.uBlur.value = 0;
    fu.uLines.value = 0;
    fu.uVignette.value = 0.55;
    fu.uFlash.value = 0;
    this.distTarget = mode === 'garage' ? 8.2 : mode === 'select' ? 10.5 : 9;
  }

  setMode(mode: GarageMode) {
    this.mode = mode;
    this.distTarget = mode === 'garage' ? 8.2 : mode === 'select' ? 10.5 : 9;
  }

  deactivate() {
    this.active = false;
    this.pipeline.setDOF(false);
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    const fu = this.pipeline.final.uniforms;
    fu.uDim.value = damp(fu.uDim.value, this.mode === 'select' ? 0.45 : 0, 5, dt);
    // swap animation: outgoing slides away, new car drives in
    this.swapT = Math.min(1, this.swapT + dt * 1.8);
    const k = easeOutCubic(this.swapT);
    if (this.car) {
      this.car.root.position.z = (1 - k) * 9;
      this.car.update({ speed: (1 - k) * 15, steerAngle: 0, wheelSpin: (1 - k) * 9 / 0.36, brake: 1 - k, pitch: (1 - k) * 0.02, roll: 0, rain: false, time: this.t, bounce: 0 });
    }
    if (this.outgoing) {
      this.outgoing.root.position.z = -k * 12;
      this.outgoing.update({ speed: 15, steerAngle: 0, wheelSpin: -k * 12 / 0.36, brake: 0, pitch: 0, roll: 0, rain: false, time: this.t, bounce: 0 });
      if (this.swapT >= 1) {
        this.outgoing.root.removeFromParent();
        this.outgoing.dispose();
        this.outgoing = null;
      }
    }
    if (this.mode === 'garage') {
      if (!this.dragging) {
        this.yawV = damp(this.yawV, 0.0025, 1.5, dt);
        this.yaw += this.yawV * dt * 60 * 0.4;
      }
      this.table.rotation.y = this.yaw;
      this.orbit = damp(this.orbit, 0, 2, dt);
    } else {
      this.table.rotation.y += dt * 0.12;
      this.orbit += dt * 0.07;
    }
    this.dist = damp(this.dist, this.distTarget, 3, dt);
    const a = this.mode === 'garage' ? 0.85 : 0.75 + Math.sin(this.orbit) * 0.5;
    const h = this.mode === 'garage' ? 1.9 : 1.6 + Math.sin(this.orbit * 0.7) * 0.25;
    this.camPos.set(Math.sin(a) * this.dist, h, Math.cos(a) * this.dist);
    // On the menu the car sits right of centre so the menu column breathes on the left
    const offX = this.mode === 'menu' ? -1.35 : this.mode === 'garage' ? 0.9 : 0;
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    this.camera.position.copy(this.camPos).addScaledVector(right, offX);
    this.look.set(0, 0.55, 0).addScaledVector(right, offX);
    this.camera.lookAt(this.look);
    this.pipeline.setDOF(true, this.dist, 0.0004, 0.006);
    this.reflection?.follow(0, 0);
  }

  dispose() {
    this.car?.dispose();
    this.reflection?.dispose();
    this.envRT.dispose();
  }
}
