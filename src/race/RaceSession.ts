import * as THREE from 'three';
import { CARS, DRIVERS, getCar, type CarDef } from '../data/cars';
import type { TrackDef } from '../data/tracks';
import { VehiclePhysics } from '../vehicle/VehiclePhysics';
import { CarModel } from '../vehicle/CarModel';
import { AIDriver } from '../ai/AIDriver';
import { CameraController, CAM_MODES } from '../camera/CameraController';
import type { World } from './World';
import type { DriveInput } from '../core/InputManager';
import type { Difficulty, Settings } from '../core/SaveService';
import { audio } from '../core/AudioManager';
import { clamp, damp, easeInOutCubic, lerp, smoothstep } from '../core/utils';
import type { RenderPipeline } from '../core/Renderer';

export type RaceMode = 'race' | 'championship' | 'timetrial';

export interface RaceConfig {
  track: TrackDef;
  carId: string;
  mode: RaceMode;
  difficulty: Difficulty;
  laps: number;
  ghost?: number[] | null;
}

export interface RaceCar {
  name: string;
  def: CarDef;
  phys: VehiclePhysics;
  model: CarModel;
  ai: AIDriver | null;
  autopilot: AIDriver | null;
  isPlayer: boolean;
  laps: number;
  nextCp: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  finished: boolean;
  finishTime: number;
  position: number;
  color: string;
  emitAcc: number;
}

export type Phase = 'intro' | 'countdown' | 'racing' | 'finishing' | 'done';

export interface RaceHooks {
  countdown(n: number): void;
  go(): void;
  overtake(from: number, to: number): void;
  finalLap(): void;
  lap(lapTime: number, best: boolean): void;
  finished(): void;
  results(): void;
  wrongWay(on: boolean): void;
}

const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const carVel = new THREE.Vector3();

export class RaceSession {
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 3000);
  readonly cam: CameraController;
  readonly cars: RaceCar[] = [];
  player!: RaceCar;
  phase: Phase = 'intro';
  raceTime = 0;
  phaseTime = 0;
  private finishOrder = 0;
  private time = 0;
  private lastPlayerPos = 0;
  private finalLapShown = false;
  private camModeIndex = 0;
  private longAcc = 0;
  private prevSpeed = 0;
  private countdownStep = 4;
  private ghostModel: CarModel | null = null;
  private ghostData: number[] | null;
  private recording: number[] = [];
  private recordTimer = 0;
  bestGhost: number[] | null = null;
  private crowdLevel = 0;
  private wrongWayShown = false;
  readonly totalLaps: number;
  private impactBuf = new Float32Array(8);
  private impactSideBuf = new Float32Array(8);
  private idle: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  private idleInput(c: RaceCar): DriveInput {
    this.idle.throttle = this.phase === 'countdown' ? 0.35 + Math.sin(this.time * 3 + c.position) * 0.3 : 0;
    return this.idle;
  }
  private introSkip = false;
  newBestLap = false;

  constructor(
    readonly world: World,
    readonly cfg: RaceConfig,
    readonly pipeline: RenderPipeline,
    private settings: Settings,
    private hooks: RaceHooks,
  ) {
    this.cam = new CameraController(this.camera);
    this.cam.shakeEnabled = settings.cameraShake;
    this.totalLaps = cfg.laps;
    this.ghostData = cfg.ghost ?? null;
    this.spawnCars();
    world.built.racingLine.visible = settings.racingLine;
    if (this.ghostData && this.ghostData.length > 8) {
      this.ghostModel = new CarModel(getCar(cfg.carId), { ghost: true });
      world.scene.add(this.ghostModel.root);
    }
  }

  private spawnCars() {
    const tr = this.world.track;
    const playerDef = getCar(this.cfg.carId);
    const solo = this.cfg.mode === 'timetrial';
    const n = solo ? 1 : 8;
    const playerSlot = solo ? 0 : this.cfg.difficulty === 'rookie' ? 4 : this.cfg.difficulty === 'pro' ? 5 : 7;
    const aiDefs = CARS.filter((c) => c.id !== playerDef.id);
    const drivers = [...DRIVERS];
    let ai = 0;
    for (let slot = 0; slot < n; slot++) {
      const isPlayer = slot === playerSlot;
      const def = isPlayer ? playerDef : aiDefs[ai % aiDefs.length];
      const s = tr.length - 12 - slot * 9;
      const lat = slot % 2 === 0 ? 2.6 : -2.6;
      const phys = new VehiclePhysics(tr, { ...def.physics });
      phys.placeAt(s, solo ? 0 : lat, -(12 + slot * 9));
      phys.locked = true;
      phys.wetness = this.world.preset.wet > 0.5 ? this.world.preset.wet : 0;
      phys.gripMul = this.world.season.world.grip;
      if (isPlayer) {
        const assist = this.cfg.difficulty === 'rookie' ? 1 : this.cfg.difficulty === 'pro' ? 0.4 : 0;
        phys.assist = assist;
        phys.gripMul *= this.cfg.difficulty === 'rookie' ? 1.07 : this.cfg.difficulty === 'pro' ? 1.02 : 0.98;
        phys.params.steer *= this.settings.sensitivity;
      }
      const model = new CarModel(def, { castShadow: true, lite: this.pipeline.profile.liteCars });
      this.world.scene.add(model.root);
      const pers = isPlayer ? DRIVERS[3] : drivers[ai % drivers.length];
      const car: RaceCar = {
        name: isPlayer ? 'YOU' : pers.name,
        def,
        phys,
        model,
        ai: isPlayer ? null : new AIDriver(phys, pers, tr, this.cfg.difficulty, phys.wetness),
        autopilot: null,
        isPlayer,
        laps: 0,
        nextCp: 0,
        lapStart: 0,
        lastLap: 0,
        bestLap: 0,
        finished: false,
        finishTime: 0,
        position: slot + 1,
        color: def.livery.primary,
        emitAcc: 0,
      };
      if (!isPlayer) ai++;
      this.cars.push(car);
      if (isPlayer) this.player = car;
    }
    this.lastPlayerPos = this.player.position;
    for (const c of this.cars) this.syncModel(c, 0);
  }

  skipIntro() {
    if (this.phase === 'intro') this.introSkip = true;
  }

  cycleCamera() {
    this.camModeIndex = (this.camModeIndex + 1) % CAM_MODES.length;
    this.cam.mode = CAM_MODES[this.camModeIndex];
    this.player.model.setHelmetVisible(this.cam.mode !== 'cockpit');
    this.cam.snap();
  }

  resetPlayer() {
    if (this.phase !== 'racing') return;
    this.player.phys.reset();
    this.cam.snap();
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.cam.shakeEnabled = s.cameraShake;
    this.world.built.racingLine.visible = s.racingLine;
  }

  // -------------------------------------------------------------------------------- main update
  update(dt: number, input: DriveInput) {
    this.time += dt;
    this.phaseTime += dt;
    const tr = this.world.track;
    switch (this.phase) {
      case 'intro':
        this.updateIntro();
        break;
      case 'countdown':
        this.updateCountdown();
        break;
      default:
        this.raceTime += dt;
    }

    // ---- drive
    const racing = this.phase === 'racing' || this.phase === 'finishing' || this.phase === 'done';
    const physCars = this.cars.map((c) => c.phys);
    // Fixed ~120 Hz physics substeps keep handling identical at any frame rate.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const maxImpact = this.impactBuf;
    const impactSide = this.impactSideBuf;
    let shifted = false;
    maxImpact.fill(0);
    for (let k = 0; k < steps; k++) {
      for (const c of this.cars) {
        let inp: DriveInput;
        if (c.isPlayer) {
          if (c.finished) {
            if (!c.autopilot) c.autopilot = new AIDriver(c.phys, DRIVERS[2], tr, 'rookie', c.phys.wetness);
            inp = c.autopilot.update(h, physCars, 99);
            // cool-down: coast and settle to a parade pace
            if (c.phys.speed > 42) {
              inp.throttle = 0;
              inp.brake = Math.max(inp.brake, c.phys.speed > 60 ? 0.25 : 0);
            } else inp.throttle = Math.min(inp.throttle, 0.5);
          } else inp = input;
        } else {
          inp = racing ? c.ai!.update(h, physCars, this.raceTime) : this.idleInput(c);
        }
        c.phys.step(h, inp);
      }
      if (racing) this.collide();
      this.updateLaps();
      this.cars.forEach((c, i) => {
        if (c.phys.impact > maxImpact[i]) {
          maxImpact[i] = c.phys.impact;
          impactSide[i] = c.phys.impactX;
        }
        if (c.isPlayer && c.phys.shifted) shifted = true;
      });
    }
    this.cars.forEach((c, i) => {
      c.phys.impact = maxImpact[i];
      c.phys.impactX = impactSide[i] || c.phys.impactX;
      if (c.isPlayer) c.phys.shifted = shifted;
    });
    this.updatePositions();
    if (racing && this.cfg.mode !== 'timetrial') this.rubberBand(dt);

    // ---- visuals
    for (const c of this.cars) this.syncModel(c, dt);
    this.updateGhost(dt);
    const p = this.player.phys;
    this.longAcc = damp(this.longAcc, (p.speed - this.prevSpeed) / Math.max(dt, 1e-3), 10, dt);
    this.prevSpeed = p.speed;

    if (this.phase === 'racing' || this.phase === 'countdown') {
      this.cam.update(dt, p, this.player.model, this.longAcc);
      if (this.phase === 'countdown') this.blendFromIntro();
    } else if (this.phase === 'finishing' || this.phase === 'done') {
      this.updateFinishCam(dt);
    }
    this.cameraFeedback(dt);
    this.updateEffects(dt);
    this.updateAudio(dt);

    // post effects driven by speed
    const fu = this.pipeline.final.uniforms;
    const speed01 = smoothstep(150, 330, p.kmh);
    const blurOn = this.settings.motionBlur && this.cam.mode !== 'nose' ? 1 : 0;
    fu.uBlur.value = damp(fu.uBlur.value, blurOn * speed01 * (this.phase === 'racing' ? 1 : this.phase === 'finishing' ? 0.5 : 0), 4, dt);
    fu.uLines.value = damp(fu.uLines.value, blurOn * smoothstep(285, 340, p.kmh), 3, dt);
    fu.uFlash.value = damp(fu.uFlash.value, 0, 6, dt);
    fu.uVignette.value = 0.32 + speed01 * 0.18;

    this.world.env.update(this.time, this.camera, v3.set(p.x, p.y, p.z));
    this.world.built.update(this.time);
    this.world.reflection?.follow(this.camera.position.x, this.camera.position.z);
    carVel.set(p.vx, 0, p.vz);
    this.world.precip?.update(dt, this.camera, carVel, this.pipeline.height);
    this.world.particles.update(dt, this.camera, this.pipeline.height);

    // wrong way
    const ww = p.wrongWay > 1.5 && this.phase === 'racing';
    if (ww !== this.wrongWayShown) {
      this.wrongWayShown = ww;
      this.hooks.wrongWay(ww);
    }
  }

  // -------------------------------------------------------------------------------- phases
  private introShots() {
    const tr = this.world.track;
    const pl = this.player;
    const t = this.phaseTime;
    const side = tr.outsideSign;
    if (t < 1.25) {
      // Shot 1: wide establishing shot across the grid and grandstands
      const k = t / 1.25;
      tr.pointAt(tr.length - 40 + k * 18, -side * 26, v3);
      v3.y += 16 - k * 3;
      tr.pointAt(tr.length - 35, 0, v4);
      this.cam.shot(v3, v4, 52);
    } else if (t < 2.4) {
      // Shot 2: low at the front wing / wheel
      const k = (t - 1.25) / 1.15;
      v3.set(1.5 - k * 0.5, 0.32, 3.3 - k * 0.4);
      pl.model.root.localToWorld(v3);
      v4.set(0, 0.55, 0.6);
      pl.model.root.localToWorld(v4);
      this.cam.shot(v3, v4, 42);
    } else {
      // Shot 3: rear view over the player towards the opponent grid
      const k = (t - 2.4) / 1.1;
      v3.set(0.9 - k * 0.6, 1.25 + k * 0.4, -7.5 + k * 1.2);
      pl.model.root.localToWorld(v3);
      v4.set(0, 0.6, 30);
      pl.model.root.localToWorld(v4);
      this.cam.shot(v3, v4, 48);
    }
  }

  private introCamPos = new THREE.Vector3();
  private introCamQuat = new THREE.Quaternion();

  private updateIntro() {
    this.introShots();
    this.pipeline.setDOF(this.phaseTime > 1.25 && this.phaseTime < 2.4, 3.2, 0.0008, 0.01);
    if (this.phaseTime > 3.5 || this.introSkip) {
      this.pipeline.setDOF(false);
      this.introCamPos.copy(this.camera.position);
      this.introCamQuat.copy(this.camera.quaternion);
      this.phase = 'countdown';
      this.phaseTime = 0;
      this.countdownStep = 4;
      this.cam.snap();
    }
  }

  private blendFromIntro() {
    const k = easeInOutCubic(clamp((this.phaseTime - 0.15) / 1.1, 0, 1));
    if (k >= 1) return;
    this.camera.position.lerpVectors(this.introCamPos, this.camera.position, k);
    this.camera.quaternion.slerpQuaternions(this.introCamQuat, this.camera.quaternion, k);
  }

  private updateCountdown() {
    const lights = this.world.built.startLights;
    const t = this.phaseTime - 0.6;
    const step = t < 0 ? 4 : 3 - Math.floor(t);
    if (step !== this.countdownStep && step >= 0 && step <= 3) {
      this.countdownStep = step;
      if (step > 0) {
        this.hooks.countdown(step);
        audio.countdown(step);
        const on = step === 3 ? 2 : step === 2 ? 4 : 5;
        lights.forEach((m, i) => m.color.set(i < on ? 0xff1a1a : 0x220405).multiplyScalar(i < on ? 6 : 1));
        this.cam.addTrauma(0.12);
      } else {
        lights.forEach((m) => m.color.set(0x220405));
        this.phase = 'racing';
        this.phaseTime = 0;
        this.raceTime = 0;
        for (const c of this.cars) {
          c.phys.locked = false;
          c.lapStart = 0;
        }
        // reward a well-timed launch
        const pl = this.player.phys;
        if (pl.launch > 0.5) {
          pl.vx += Math.sin(pl.yaw) * 2.5 * pl.launch;
          pl.vz += Math.cos(pl.yaw) * 2.5 * pl.launch;
        }
        this.hooks.go();
        audio.countdown(0);
        this.cam.impulse(0, 0, 1.4);
        this.cam.addTrauma(0.22);
        this.pipeline.final.uniforms.uFlash.value = 0.12;
        this.pipeline.dynamicEnabled = true;
      }
    }
  }

  private finishCamT = 0;
  private updateFinishCam(dt: number) {
    this.finishCamT += dt;
    const p = this.player;
    if (this.finishCamT < 1.6) {
      this.cam.mode = 'cinematic';
      this.cam.update(dt, p.phys, p.model, this.longAcc);
    } else {
      // slow orbit around the player car
      const a = (this.finishCamT - 1.6) * 0.32 + 2.4;
      const r = 7.5;
      v3.set(Math.sin(a) * r, 1.6 + Math.sin(this.finishCamT * 0.3) * 0.3, Math.cos(a) * r);
      p.model.root.localToWorld(v3);
      v4.set(0, 0.6, 0.6);
      p.model.root.localToWorld(v4);
      this.cam.shot(v3, v4, 45);
    }
    if (this.phase === 'finishing' && this.phaseTime > 2.6) {
      this.phase = 'done';
      this.phaseTime = 0;
      this.hooks.results();
    }
  }

  // -------------------------------------------------------------------------------- rules
  private updateLaps() {
    const tr = this.world.track;
    const K = tr.checkpoints.length;
    for (const c of this.cars) {
      if (c.finished) continue;
      const base = c.laps * tr.length;
      // Sequential checkpoint validation (no reverse/shortcut exploits: uses max progress)
      while (c.nextCp < K && c.phys.maxD >= base + tr.checkpoints[c.nextCp]) c.nextCp++;
      if (c.nextCp >= K) {
        c.nextCp = 0;
        c.laps++;
        const lapTime = this.raceTime - c.lapStart;
        c.lastLap = lapTime;
        c.lapStart = this.raceTime;
        const best = !c.bestLap || lapTime < c.bestLap;
        if (best) c.bestLap = lapTime;
        if (c.isPlayer) {
          if (best) {
            this.bestGhost = this.recording.slice();
          }
          this.recording = [];
          this.hooks.lap(lapTime, best);
          if (c.laps === this.totalLaps - 1 && !this.finalLapShown && this.totalLaps > 1) {
            this.finalLapShown = true;
            this.hooks.finalLap();
            audio.finalLap();
            if (audio.music) audio.music.intensity = 1;
          }
        }
        if (c.laps >= this.totalLaps) {
          c.finished = true;
          c.finishTime = this.raceTime;
          this.finishOrder++;
          if (c.isPlayer) {
            this.phase = 'finishing';
            this.phaseTime = 0;
            this.finishCamT = 0;
            this.hooks.finished();
            audio.finish();
            this.pipeline.dynamicEnabled = false;
          }
        }
      }
    }
  }

  private order: RaceCar[] = [];
  private updatePositions() {
    if (!this.order.length) this.order = [...this.cars].sort((a, b) => a.position - b.position);
    const score = (c: RaceCar) => (c.finished ? 1e9 - c.finishTime : c.phys.D);
    // bubble with hysteresis to avoid flicker
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.order.length - 1; i++) {
        const a = this.order[i];
        const b = this.order[i + 1];
        const hyst = a.finished || b.finished ? 0 : 0.6;
        if (score(b) > score(a) + hyst) {
          this.order[i] = b;
          this.order[i + 1] = a;
        }
      }
    }
    this.order.forEach((c, i) => (c.position = i + 1));
    const pp = this.player.position;
    if (pp !== this.lastPlayerPos && this.phase === 'racing') {
      this.hooks.overtake(this.lastPlayerPos, pp);
      if (pp < this.lastPlayerPos) audio.overtake();
    }
    this.lastPlayerPos = pp;
  }

  private rubberBand(dt: number) {
    const pD = this.player.phys.D;
    const strength = this.cfg.difficulty === 'expert' ? 0.5 : this.cfg.difficulty === 'pro' ? 0.8 : 1;
    for (const c of this.cars) {
      if (!c.ai) continue;
      const gap = c.phys.D - pD;
      const target = 1 + clamp(-gap / 500, -0.035, 0.03) * strength;
      c.ai.pace = damp(c.ai.pace, target, 0.5, dt);
    }
  }

  private collide() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i].phys;
        const b = cars[j].phys;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (dx * dx + dz * dz > 49) continue;
        if (a.immunity > 0 || b.immunity > 0) continue;
        // two circles per car along its heading
        for (const oa of [-1.35, 1.35]) {
          for (const ob of [-1.35, 1.35]) {
            const ax = a.x + Math.sin(a.yaw) * oa;
            const az = a.z + Math.cos(a.yaw) * oa;
            const bx = b.x + Math.sin(b.yaw) * ob;
            const bz = b.z + Math.cos(b.yaw) * ob;
            const ddx = bx - ax;
            const ddz = bz - az;
            const d2 = ddx * ddx + ddz * ddz;
            const R = 2.0;
            if (d2 < R * R && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const nx = ddx / d;
              const nz = ddz / d;
              const pen = (R - d) * 0.5;
              a.x -= nx * pen;
              a.z -= nz * pen;
              b.x += nx * pen;
              b.z += nz * pen;
              const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
              if (rv < 0) {
                const jimp = -rv * 0.6;
                a.vx -= nx * jimp;
                a.vz -= nz * jimp;
                b.vx += nx * jimp;
                b.vz += nz * jimp;
                const strength = -rv;
                for (const [car, sgn] of [
                  [a, 1],
                  [b, -1],
                ] as [VehiclePhysics, number][]) {
                  const lx = Math.cos(car.yaw);
                  const lz = -Math.sin(car.yaw);
                  const side = Math.sign(nx * lx + nz * lz) * sgn;
                  car.impact = Math.max(car.impact, strength);
                  car.impactX = side;
                  car.yawRate += -side * strength * 0.02;
                  if (strength > 4) car.steerDisturb = -side * 0.25;
                }
                const mx = (ax + bx) / 2;
                const mz = (az + bz) / 2;
                if (strength > 1.5) this.world.particles.emit('sparks', mx, a.y + 0.3, mz, (a.vx + b.vx) / 2, 1, (a.vz + b.vz) / 2, Math.min(20, strength * 2));
              }
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------------- presentation
  private syncModel(c: RaceCar, dt: number) {
    const p = c.phys;
    const root = c.model.root;
    root.position.set(p.x, p.y, p.z);
    root.rotation.set(-p.slopePitch, p.yaw, 0, 'YXZ');
    c.model.update({
      speed: Math.abs(p.speed),
      steerAngle: p.steerAngle * 0.8,
      wheelSpin: p.wheelSpin,
      brake: p.brake,
      pitch: p.pitchVis,
      roll: p.rollVis,
      rain: this.world.preset.rain > 0,
      time: this.time,
      bounce: p.bounce,
    });
    // fade out on reset immunity so overlapping cars read as "ghosted"
    c.model.root.visible = p.immunity <= 0 || Math.sin(this.time * 30) > -0.3;
    const cp = this.camera.position;
    c.model.setDetail(c.isPlayer || (p.x - cp.x) ** 2 + (p.z - cp.z) ** 2 < 32 * 32);
  }

  private cameraFeedback(dt: number) {
    const p = this.player.phys;
    if (this.phase !== 'racing') return;
    if (p.impact > 1.5) {
      const k = Math.min(1, p.impact / 25);
      this.cam.impulse(-p.impactX * 0.9 * k, 0.15 * k, -0.6 * k);
      this.cam.addTrauma(0.15 + k * 0.5);
      audio.impact(k);
      this.pipeline.final.uniforms.uFlash.value = Math.max(this.pipeline.final.uniforms.uFlash.value, k * 0.06);
    }
    if (p.q.surface === 'curb' && Math.abs(p.speed) > 12) this.cam.addTrauma(dt * 0.9);
    else if (p.q.surface !== 'asphalt' && Math.abs(p.speed) > 10) this.cam.addTrauma(dt * 0.6);
    if (p.scrape > 0.2 && Math.random() < 0.3) audio.scrape(p.scrape);
    if (p.shifted) audio.shift();
  }

  private updateEffects(dt: number) {
    const parts = this.world.particles;
    const wet = this.world.preset.wet > 0.5;
    const camPos = this.camera.position;
    for (const c of this.cars) {
      const p = c.phys;
      const sp = Math.abs(p.speed);
      const dist2 = (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2;
      if (dist2 > 160 * 160) continue;
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const lx = fz;
      const lz = -fx;
      c.emitAcc += dt;
      if (c.emitAcc < 1 / 45) continue;
      const edt = c.emitAcc;
      c.emitAcc = 0;
      for (const side of [-1, 1]) {
        const wx = p.x - fx * 1.9 + lx * side * 0.8;
        const wz = p.z - fz * 1.9 + lz * side * 0.8;
        const surf = p.q.surface;
        const vx = p.vx * 0.3;
        const vz = p.vz * 0.3;
        if (wet && sp > 14 && (surf === 'asphalt' || surf === 'curb')) {
          parts.emit('spray', wx, p.y + 0.35, wz, vx, 1.5, vz, sp * edt * 0.5);
        }
        if (!wet && p.slip > 3.2 && sp > 6 && (surf === 'asphalt' || surf === 'curb')) {
          parts.emit('smoke', wx, p.y + 0.2, wz, vx * 0.5, 0.8, vz * 0.5, Math.min(3, p.slip * 0.4) * edt * 30);
        }
        if (sp > 5 && (surf === 'grass' || surf === 'gravel' || surf === 'sand')) {
          const kind = surf === 'grass' ? 'dirt' : surf === 'gravel' ? 'gravel' : 'dust';
          parts.emit(kind, wx, p.y + 0.15, wz, vx, 2.5, vz, sp * edt * (kind === 'dust' ? 0.35 : 0.8));
        }
      }
      // plank sparks over curbs / bumps at very high speed
      if (sp > 70 && (p.q.surface === 'curb' || Math.random() < edt * 0.25)) {
        parts.emit('sparks', p.x - fx * 2.2, p.y + 0.05, p.z - fz * 2.2, p.vx * 0.7, 0.5, p.vz * 0.7, 3);
      }
      if (p.impact > 3) parts.emit(wet ? 'spray' : 'smoke', p.x, p.y + 0.4, p.z, 0, 1, 0, Math.min(8, p.impact * 0.4));
    }
    // podium sparkle in the results orbit
    if (this.phase === 'done' && this.player.position <= 3 && Math.random() < dt * 25) {
      const p = this.player.phys;
      parts.emit('gold', p.x + (Math.random() - 0.5) * 6, p.y + Math.random() * 2, p.z + (Math.random() - 0.5) * 6, 0, 0.6, 0, 1);
    }
  }

  private updateAudio(dt: number) {
    if (!audio.ready || !audio.ctx) return;
    const p = this.player.phys;
    const sp = Math.abs(p.speed);
    const ctx = audio.ctx;
    const engineVol = this.phase === 'done' ? 0.4 : 1;
    audio.engine.set(p.rpm, p.locked ? p.throttle : p.throttle * (p.shiftTimer > 0 ? 0.3 : 1), engineVol, dt);
    audio.wind.set(Math.min(0.5, (sp / 90) ** 2 * 0.5), ctx);
    audio.wind.filter.frequency.setTargetAtTime(300 + sp * 14, ctx.currentTime, 0.1);
    const onTarmac = p.q.surface === 'asphalt' || p.q.surface === 'curb';
    const squeal = onTarmac && !(this.world.preset.wet > 0.5) ? smoothstep(2.5, 7, p.slip) * Math.min(1, sp / 15) : 0;
    audio.tyre.set(squeal * 0.22, ctx, 0.05);
    const off = !onTarmac && sp > 2 ? Math.min(1, sp / 25) : 0;
    audio.offroad.set(off * 0.5, ctx, 0.05);
    audio.offroad.filter.frequency.setTargetAtTime(p.q.surface === 'gravel' ? 1400 : 320, ctx.currentTime, 0.05);
    audio.setCurb(p.q.surface === 'curb' && sp > 5 ? 1 : 0, sp);
    audio.rain.set(this.world.preset.rain * 0.18 + (this.world.preset.wet > 0.5 ? smoothstep(10, 60, sp) * 0.12 : 0), ctx, 0.3);
    // crowd swells near grandstands
    let near = 1e9;
    for (const g of this.world.built.grandstandSpots) near = Math.min(near, (g.x - p.x) ** 2 + (g.z - p.z) ** 2);
    const crowdT = clamp(1 - Math.sqrt(near) / 120, 0, 1) * 0.35 + (this.phase === 'done' && this.player.position <= 3 ? 0.25 : 0);
    this.crowdLevel = damp(this.crowdLevel, crowdT, 2, dt);
    audio.crowd.set(this.crowdLevel, ctx, 0.2);
    audio.ambience.set(0.05, ctx, 0.5);
    // nearest rival engine with simple distance attenuation and panning
    let best: RaceCar | null = null;
    let bd = 1e9;
    for (const c of this.cars) {
      if (c.isPlayer) continue;
      const d = (c.phys.x - p.x) ** 2 + (c.phys.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) {
      const d = Math.sqrt(bd);
      const vol = clamp(1 - d / 70, 0, 1) ** 2 * 0.55;
      audio.rival.set(best.phys.rpm, best.phys.throttle, vol, dt);
      const rx = (best.phys.x - p.x) * Math.cos(p.yaw) - (best.phys.z - p.z) * Math.sin(p.yaw);
      audio.rival.panner.pan.setTargetAtTime(clamp(-rx / 12, -0.8, 0.8), ctx.currentTime, 0.05);
    } else audio.rival.set(0.3, 0, 0, dt);
  }

  private updateGhost(dt: number) {
    const p = this.player.phys;
    if (this.phase === 'racing' && !this.player.finished) {
      this.recordTimer += dt;
      if (this.recordTimer >= 0.1) {
        this.recordTimer -= 0.1;
        this.recording.push(+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3));
      }
    }
    if (this.ghostModel && this.ghostData) {
      const lapT = this.raceTime - this.player.lapStart;
      const show = this.phase === 'racing' && this.player.laps >= 1;
      this.ghostModel.root.visible = show;
      if (show) {
        const f = lapT * 10;
        const i = Math.floor(f);
        const n = this.ghostData.length / 4;
        if (i + 1 < n) {
          const t = f - i;
          const g = this.ghostData;
          const yawA = g[i * 4 + 3];
          let yawB = g[(i + 1) * 4 + 3];
          if (yawB - yawA > Math.PI) yawB -= Math.PI * 2;
          if (yawA - yawB > Math.PI) yawB += Math.PI * 2;
          this.ghostModel.root.position.set(lerp(g[i * 4], g[(i + 1) * 4], t), lerp(g[i * 4 + 1], g[(i + 1) * 4 + 1], t), lerp(g[i * 4 + 2], g[(i + 1) * 4 + 2], t));
          this.ghostModel.root.rotation.set(0, lerp(yawA, yawB, t), 0);
        } else this.ghostModel.root.visible = false;
      }
    }
  }

  /** Estimated results for every car (unfinished AI are projected from their pace). */
  results() {
    const L = this.world.track.length;
    const rows = this.cars.map((c) => {
      let t = c.finishTime;
      if (!c.finished) {
        const remain = this.totalLaps * L - c.phys.D;
        const avg = Math.max(30, c.phys.D / Math.max(1, this.raceTime));
        t = this.raceTime + remain / avg;
      }
      return { car: c, time: t, best: c.bestLap };
    });
    rows.sort((a, b) => {
      if (a.car.finished && b.car.finished) return a.time - b.time;
      if (a.car.finished) return -1;
      if (b.car.finished) return 1;
      return a.time - b.time;
    });
    return rows;
  }

  dispose() {
    for (const c of this.cars) {
      c.model.root.removeFromParent();
      c.model.dispose();
    }
    this.ghostModel?.root.removeFromParent();
    this.ghostModel?.dispose();
    this.pipeline.dynamicEnabled = false;
    this.pipeline.setDOF(false);
    const fu = this.pipeline.final.uniforms;
    fu.uBlur.value = 0;
    fu.uLines.value = 0;
  }
}
