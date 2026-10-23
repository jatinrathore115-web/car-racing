import * as THREE from 'three';
import type { AIPersonality } from '../data/cars';
import type { DriveInput } from '../core/InputManager';
import { Track } from '../track/Track';
import { VehiclePhysics } from '../vehicle/VehiclePhysics';
import { clamp, damp, lerp, smoothstep } from '../core/utils';
import type { Difficulty } from '../core/SaveService';

const DIFF = {
  rookie: { skill: 0.86, brake: 0.8, mistakes: 1.6, overtake: 0.6, accel: 0.94 },
  pro: { skill: 0.92, brake: 0.9, mistakes: 1.0, overtake: 0.85, accel: 0.975 },
  expert: { skill: 0.97, brake: 0.98, mistakes: 0.55, overtake: 1.0, accel: 1.0 },
};

const tmp = new THREE.Vector3();

export class AIDriver {
  readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private limit: Float32Array;
  private profile: Float32Array;
  private lane = 0;
  private laneTarget = 0;
  private laneHold = 0;
  private mistake: { kind: 'lift' | 'wide' | 'late' | null; t: number; dir: number } = { kind: null, t: 0, dir: 0 };
  private stuck = 0;
  private wobblePhase = Math.random() * 100;
  reaction: number;
  /** Rubber-band pace factor, set by the race manager (≈0.97..1.03). */
  pace = 1;
  readonly diff: (typeof DIFF)['pro'];

  constructor(
    readonly phys: VehiclePhysics,
    readonly p: AIPersonality,
    readonly track: Track,
    difficulty: Difficulty,
    wet: number,
  ) {
    this.diff = DIFF[difficulty];
    this.limit = new Float32Array(track.N);
    this.profile = new Float32Array(track.N);
    // phys.gripMul carries the season grip (snow, sand...) so AI and player face the same surface
    const grip = phys.params.grip * phys.gripMul * this.diff.skill * p.pace * lerp(1, 0.86, wet);
    const brake = phys.params.brake * 0.86 * this.diff.brake * p.brakeLate * lerp(1, 0.85, wet);
    track.buildSpeedProfile(brake, grip, phys.params.topSpeed, { limit: this.limit, profile: this.profile });
    phys.params = { ...phys.params, accel: phys.params.accel * this.diff.accel };
    this.reaction = 0.12 + Math.random() * 0.28 * (1.2 - p.consistency);
  }

  update(dt: number, cars: VehiclePhysics[], raceTime: number): DriveInput {
    const ph = this.phys;
    const tr = this.track;
    const inp = this.input;
    const v = ph.speed;
    const s = ph.q.s;
    const hw = tr.hw;

    if (raceTime < this.reaction) {
      inp.throttle = 0.6;
      inp.brake = 0;
      inp.steer = 0;
      return inp;
    }

    // ---- Mistakes (rare, recoverable)
    this.mistake.t -= dt;
    if (this.mistake.t <= 0) this.mistake.kind = null;
    if (!this.mistake.kind && Math.random() < dt * (1 - this.p.consistency) * 0.05 * this.diff.mistakes) {
      const r = Math.random();
      this.mistake = { kind: r < 0.35 ? 'lift' : r < 0.7 ? 'wide' : 'late', t: 0.7 + Math.random() * 0.8, dir: Math.sign(tr.sampleAt(tr.curv, s + 40)) || 1 };
    }

    // ---- Target speed
    const look = Math.max(0, v) * 0.12 + 2;
    let target = tr.sampleAt(this.profile, s + look) * this.pace;
    if (this.mistake.kind === 'late') target *= 1.07;
    if (ph.q.surface !== 'asphalt' && ph.q.surface !== 'curb') target = Math.min(target, 30);

    // ---- Traffic awareness
    let blocked = false;
    let myLat = ph.q.lateral;
    let pushLat = 0;
    for (const o of cars) {
      if (o === ph) continue;
      let d = o.q.s - s;
      if (d > tr.length / 2) d -= tr.length;
      if (d < -tr.length / 2) d += tr.length;
      const latDiff = o.q.lateral - myLat;
      if (d > 0 && d < 38 && Math.abs(latDiff) < 2.5) {
        const closing = v - o.speed;
        if (closing > -1) {
          blocked = true;
          const wantsPass = Math.random() < dt * 4 * (0.3 + this.p.aggression * this.diff.overtake);
          if (wantsPass || this.laneHold > 0) {
            const roomL = hw - 1.4 - o.q.lateral;
            const roomR = o.q.lateral + hw - 1.4;
            const nextK = tr.sampleAt(tr.curv, s + 60);
            let side = roomL > roomR ? 1 : -1;
            // aggressive drivers prefer the inside of the next corner
            if (this.p.aggression > 0.6 && Math.abs(nextK) > 1 / 300) side = Math.sign(nextK) > 0 ? (roomL > 2.6 ? 1 : -1) : roomR > 2.6 ? -1 : 1;
            const lineLat = tr.sampleAt(tr.line, s + 20);
            this.laneTarget = clamp(o.q.lateral + side * 3.1, -hw + 1.3, hw - 1.3) - lineLat;
            this.laneHold = 1.6;
          } else if (d < 16) {
            target = Math.min(target, o.speed + (d - 8) * 0.4);
          }
        }
      }
      // side-by-side: give each other room
      if (Math.abs(d) < 6 && Math.abs(latDiff) < 2.3) pushLat -= Math.sign(latDiff || 1) * (2.3 - Math.abs(latDiff)) * 0.9;
      // defend: cover the inside when someone is closing from behind
      if (d < 0 && d > -14 && Math.random() < dt * this.p.defend * 0.6 && this.laneHold <= 0) {
        const nextK = tr.sampleAt(tr.curv, s + 80);
        if (Math.abs(nextK) > 1 / 250) {
          const lineLat = tr.sampleAt(tr.line, s + 20);
          this.laneTarget = clamp(Math.sign(nextK) * (hw - 2.4), -hw + 1.3, hw - 1.3) - lineLat;
          this.laneTarget *= 0.6;
          this.laneHold = 1.2;
        }
      }
    }
    this.laneHold -= dt;
    if (this.laneHold <= 0) this.laneTarget = damp(this.laneTarget, 0, 0.8, dt);
    if (this.mistake.kind === 'wide') this.laneTarget = -this.mistake.dir * 2.5;
    this.lane = damp(this.lane, clamp(this.laneTarget + pushLat, -hw * 2, hw * 2), blocked ? 2.2 : 1.4, dt);

    // ---- Steering: pure pursuit on the (offset) racing line
    const lookD = 7 + Math.abs(v) * 0.42;
    const sT = s + lookD;
    const acc = this.p.lineAccuracy;
    this.wobblePhase += dt;
    const wobble = Math.sin(this.wobblePhase * 0.7) * (1 - acc) * 2.2;
    const lat = clamp(tr.sampleAt(tr.line, sT) * lerp(0.6, 1, acc) + this.lane + wobble, -hw + 1.2, hw - 1.2);
    tr.pointAt(sT, lat, tmp);
    const dx = tmp.x - ph.x;
    const dz = tmp.z - ph.z;
    const fx = Math.sin(ph.yaw);
    const fz = Math.cos(ph.yaw);
    const fwd = dx * fx + dz * fz;
    const left = dx * fz - dz * fx;
    const dist = Math.max(Math.hypot(dx, dz), 1);
    const alpha = Math.atan2(left, fwd);
    const curvature = (2 * Math.sin(alpha)) / dist;
    const steerAngle = Math.atan(curvature * 3.6);
    const range = lerp(0.42, 0.06, smoothstep(0, 78, Math.abs(v))) * ph.params.steer;
    inp.steer = clamp(steerAngle / range, -1, 1);

    // ---- Pedals
    const err = target - v;
    if (err > 1.2) {
      inp.throttle = 1;
      inp.brake = 0;
    } else if (err > -0.6) {
      inp.throttle = clamp(0.45 + err * 0.4, 0, 1);
      inp.brake = 0;
    } else {
      inp.throttle = 0;
      inp.brake = clamp(-err / 4.5, 0.2, 1);
    }
    if (this.mistake.kind === 'lift') inp.throttle *= 0.35;
    // traction care when understeering
    if (ph.understeer > 0.3) inp.throttle *= 0.6;
    inp.handbrake = false;

    // ---- Stuck recovery
    if (Math.abs(v) < 2 && raceTime > 4) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 2.5 || ph.wrongWay > 2) {
      ph.reset();
      this.stuck = 0;
      this.lane = this.laneTarget = 0;
    }
    return inp;
  }
}
