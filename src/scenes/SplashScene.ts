import * as THREE from 'three';
import { buildWorld, type World } from '../race/World';
import { getTrack } from '../data/tracks';
import { getCar } from '../data/cars';
import { CarModel } from '../vehicle/CarModel';
import type { SeasonDef } from '../data/seasons';
import type { RenderPipeline } from '../core/Renderer';
import { audio } from '../core/AudioManager';
import { clamp, easeInOutCubic, easeOutCubic, smoothstep } from '../core/utils';

interface Runner {
  model: CarModel;
  ds: number;
  lat: number;
  phase: number;
}

/**
 * Animated key-art: a wet, dramatic grand-prix straight with the red hero car charging at the
 * lens, rivals stacked behind it in spray. Used as the opening "thumbnail" and title screen.
 */
export class SplashScene {
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 3000);
  world!: World;
  private runners: Runner[] = [];
  private hero!: Runner;
  private s0 = 0;
  private t = 0;
  private sweep!: THREE.PointLight;
  private fill!: THREE.DirectionalLight;
  private revDone = false;
  private speed = 44;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private carVel = new THREE.Vector3();
  started = false;

  constructor(
    private pipeline: RenderPipeline,
    readonly season: SeasonDef,
  ) {}

  async load(onProgress: (p: number) => void) {
    // Rainy key art uses the dramatic storm sky; every other season shows its own atmosphere.
    const s = this.season.id === 'rainy' ? { ...this.season, world: { ...this.season.world, preset: 'storm' as const } } : this.season;
    this.world = await buildWorld(getTrack('apex-park'), s, this.pipeline, (p) => onProgress(p * 0.9), { minReflection: 0.35 });
    const scene = this.world.scene;
    const tr = this.world.track;
    this.s0 = tr.length - 330;
    const lineup: [string, number, number][] = [
      ['crimson', 0, 0.6],
      ['phantom', -14, -2.6],
      ['azure', -27, 2.9],
      ['solar', -42, -0.8],
      ['emerald', -58, 3.4],
    ];
    for (const [id, ds, lat] of lineup) {
      const model = new CarModel(getCar(id), { castShadow: true });
      scene.add(model.root);
      const r = { model, ds, lat, phase: Math.random() * 10 };
      this.runners.push(r);
      if (id === 'crimson') this.hero = r;
    }
    // Moving specular sweep across the hero's bodywork
    this.sweep = new THREE.PointLight(0xfff1dd, 0, 9, 1.6);
    scene.add(this.sweep);
    this.world.built.racingLine.visible = false;
    // Cool key-art fill so the camera-side bodywork never collapses to black
    this.fill = new THREE.DirectionalLight(0xbfd2ff, 1.3);
    scene.add(this.fill, this.fill.target);
    this.world.built.startLights.forEach((m) => m.color.set(0xff1a1a).multiplyScalar(5));
    onProgress(1);
  }

  activate() {
    this.pipeline.setScene(this.world.scene, this.camera);
    this.pipeline.applyPreset(this.world.preset, true);
    this.pipeline.setDOF(true, 7, 0.00028, 0.012, true);
    this.t = 0;
    this.revDone = false;
    this.started = true;
  }

  deactivate() {
    this.pipeline.setDOF(false);
    this.pipeline.final.uniforms.uBlur.value = 0;
    this.started = false;
  }

  update(dt: number) {
    if (!this.started) return;
    this.t += dt;
    const t = this.t;
    const tr = this.world.track;
    const base = this.s0 + t * this.speed;
    const time = t;
    for (const r of this.runners) {
      const s = base + r.ds + Math.sin(time * 0.6 + r.phase) * (r === this.hero ? 0 : 1.6);
      const lat = r.lat + Math.sin(time * 0.45 + r.phase) * (r === this.hero ? 0.15 : 0.5);
      tr.pointAt(s, lat, this.v);
      const yaw = tr.headingAt(s);
      r.model.root.position.copy(this.v);
      r.model.root.rotation.set(0, yaw + Math.cos(time * 0.45 + r.phase) * 0.012, 0);
      r.model.update({ speed: this.speed, steerAngle: 0, wheelSpin: s / 0.365, brake: 0, pitch: -0.008, roll: 0, rain: true, time, bounce: Math.sin(time * 23 + r.phase) * 0.004 });
      // spray
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      for (const side of [-1, 1]) {
        const kick = this.season.id === 'rainy' ? 'spray' : this.season.id === 'desert' ? 'dust' : null;
        if (kick) this.world.particles.emit(kick, this.v.x - fx * 1.9 + fz * side * 0.8, this.v.y + 0.35, this.v.z - fz * 1.9 - fx * side * 0.8, fx * this.speed * 0.6, 1.2, fz * this.speed * 0.6, dt * (kick === 'spray' ? (this.season.id === 'winter' ? 5 : 14) : 3));
      }
    }

    // Camera: low front three-quarter, pushing in.
    const hero = this.hero.model.root;
    const push = 1.28 - easeInOutCubic(clamp((t - 0.6) / 0.9, 0, 1)) * 0.28;
    const drift = smoothstep(2, 8, t) * Math.sin((t - 2) * 0.18) * 0.35;
    this.v.set((3.15 + drift) * push, 0.4 + push * 0.06, 6.3 * push);
    hero.localToWorld(this.v);
    this.w.set(-0.55, 0.52, -0.2);
    hero.localToWorld(this.w);
    this.camera.position.copy(this.v);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.w);
    const dist = this.camera.position.distanceTo(this.w);
    this.pipeline.setDOF(true, dist, 0.0002, 0.012, true);

    // 0.85s: highlight sweep across the bodywork
    const sk = clamp((t - 0.85) / 0.55, 0, 1);
    this.sweep.intensity = sk > 0 && sk < 1 ? Math.sin(sk * Math.PI) * 60 : 0;
    this.v.set(1.6, 1.3, 3 - sk * 6);
    hero.localToWorld(this.v);
    this.sweep.position.copy(this.v);
    this.v.set(6, 3, 8);
    hero.localToWorld(this.v);
    this.fill.position.copy(this.v);
    this.fill.target.position.copy(hero.position);

    // 1.4s: engine rev
    if (!this.revDone && t > 1.4) {
      this.revDone = true;
      audio.rev(0.8);
    }
    if (audio.ready) {
      const rev = t > 1.4 ? Math.exp(-(t - 1.4) * 2.2) : 0;
      const ambient = smoothstep(0.4, 1.1, t);
      audio.engine.set(0.55 + rev * 0.45 + Math.sin(t * 0.7) * 0.03, 0.6 + rev * 0.4, ambient * 0.55, dt);
      audio.rival.set(0.5 + Math.sin(t * 0.5) * 0.05, 0.6, ambient * 0.3, dt);
      if (audio.ctx) {
        audio.rain.set(ambient * 0.14, audio.ctx, 0.3);
        audio.crowd.set(ambient * 0.12, audio.ctx, 0.3);
        audio.wind.set(ambient * 0.12, audio.ctx, 0.3);
      }
    }

    // 1.6s: background motion streak
    const fu = this.pipeline.final.uniforms;
    const streak = smoothstep(1.5, 1.9, t);
    fu.uBlur.value = 0.35 + streak * 0.35;
    fu.uFlash.value = 0;
    fu.uVignette.value = 0.55;
    fu.uDim.value = 1 - easeOutCubic(clamp(t / 0.4, 0, 1));

    this.world.env.update(t, this.camera, hero.position);
    this.world.built.update(t);
    this.world.reflection?.follow(this.camera.position.x, this.camera.position.z);
    this.carVel.set(Math.sin(hero.rotation.y) * this.speed, 0, Math.cos(hero.rotation.y) * this.speed);
    this.world.precip?.update(dt, this.camera, this.carVel, this.pipeline.height);
    this.world.particles.update(dt, this.camera, this.pipeline.height);
    // loop the straight before it runs out
    if (t > 22) {
      this.t = 3;
    }
  }

  dispose() {
    for (const r of this.runners) r.model.dispose();
    this.world?.dispose();
  }
}
