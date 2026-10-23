import * as THREE from 'three';
import { Track, type TrackQuery, type Surface, lateralLimit } from '../track/Track';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/utils';
import type { DriveInput } from '../core/InputManager';

export interface VehicleParams {
  topSpeed: number;
  accel: number;
  brake: number;
  grip: number;
  steer: number;
}

const SURFACE_GRIP: Record<Surface, number> = { asphalt: 1, curb: 0.95, grass: 0.56, sand: 0.5, gravel: 0.42 };
const SURFACE_DRAG: Record<Surface, number> = { asphalt: 0, curb: 0.3, grass: 3.2, sand: 5.5, gravel: 12 };
const GEARS = [0.3, 0.42, 0.53, 0.63, 0.72, 0.81, 0.9, 1.0];
const WHEELBASE = 3.6;
const tmpV = new THREE.Vector3();
const HALF_WIDTH = 1.0;

/**
 * Formula-style arcade vehicle model (≈70% arcade / 30% sim):
 * - grip scales with aerodynamic downforce (v²), so fast corners are possible but limits exist
 * - steering lock reduces with speed; yaw rate is clamped by available lateral grip (understeer)
 * - lateral velocity is scrubbed by grip, leaving a small controllable slide at the limit
 * - surfaces change grip and rolling drag; walls deflect and scrub speed
 */
export class VehiclePhysics {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  speed = 0; // forward speed m/s
  latSpeed = 0;
  steerAngle = 0;
  wheelSpin = 0;
  pitchVis = 0;
  rollVis = 0;
  slopePitch = 0;
  bounce = 0;
  rpm = 0.25;
  gear = 0;
  shiftTimer = 0;
  shifted = false;
  throttle = 0;
  brake = 0;
  slip = 0;
  understeer = 0;
  locked = false;
  immunity = 0;
  impact = 0;
  impactX = 0; // local-space lateral sign of last impact (+left)
  scrape = 0;
  wrongWay = 0;
  steerDisturb = 0;
  readonly q: TrackQuery = { index: -1, s: 0, lateral: 0, height: 0, slope: 0, tx: 0, tz: 1, surface: 'asphalt', wallL: 10, wallR: 10, curbSide: 0 };
  // Race progress (continuous distance along the track, can decrease when reversing)
  D = 0;
  maxD = 0;
  private lastS = 0;
  // Last safe position for resets
  safeS = 0;
  safeLat = 0;
  private prevVf = 0;
  gripMul = 1;
  wetness = 0;
  assist = 0; // 0..1 (rookie stability assist)
  launch = 0;

  constructor(readonly track: Track, public params: VehicleParams) {}

  placeAt(s: number, lateral: number, D?: number) {
    const p = this.track.pointAt(s, lateral, tmpV);
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.yaw = this.track.headingAt(s);
    this.vx = this.vz = 0;
    this.yawRate = 0;
    this.speed = 0;
    this.latSpeed = 0;
    this.gear = 0;
    this.q.index = -1;
    this.track.project(this.x, this.z, -1, this.q);
    this.lastS = this.q.s;
    if (D !== undefined) {
      this.D = D;
      this.maxD = D;
    }
    this.safeS = s;
    this.safeLat = lateral;
  }

  /** Respawn at the last safe racing-line position with brief collision immunity. */
  reset() {
    const s = this.safeS;
    const D = this.D;
    this.placeAt(s, clamp(this.track.sampleAt(this.track.line, s), -this.track.hw + 2, this.track.hw - 2));
    this.D = D;
    this.immunity = 2.2;
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  step(dt: number, inp: DriveInput) {
    const tr = this.track;
    const P = this.params;
    this.impact = 0;
    this.scrape = Math.max(0, this.scrape - dt * 4);
    this.immunity = Math.max(0, this.immunity - dt);
    this.shifted = false;
    this.throttle = damp(this.throttle, inp.throttle, 14, dt);
    this.brake = damp(this.brake, inp.brake, 16, dt);

    if (this.locked) {
      // Held on the grid: free-revving engine only.
      this.rpm = damp(this.rpm, 0.25 + inp.throttle * 0.72, inp.throttle > 0.1 ? 5 : 3, dt);
      this.launch = inp.throttle;
      this.updateVisual(dt, 0);
      return;
    }

    const surf = this.q.surface;
    let mu = SURFACE_GRIP[surf];
    if (this.wetness > 0) {
      const wetPenalty = surf === 'asphalt' || surf === 'curb' ? 0.84 : 0.62;
      mu *= lerp(1, wetPenalty, this.wetness);
    }
    const gripMul = this.gripMul * P.grip * (1 + this.assist * 0.06);

    // ---- Longitudinal
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const lx = fz;
    const lz = -fx;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;
    const aspeed = Math.abs(vf);
    let a = 0;
    const thr = this.throttle;
    const brk = this.brake;
    const vTop = P.topSpeed;
    if (brk > 0.05 && vf > 0.8) {
      const aero = 0.55 + 0.45 * Math.min(1, (vf * vf) / 4900);
      a -= brk * P.brake * aero * Math.min(1, mu * 1.08);
    } else if (brk > 0.05 && vf <= 0.8) {
      if (vf > -9) a -= brk * 7;
    }
    if (thr > 0.02 && vf > -0.5) {
      const x = Math.max(0, vf) / vTop;
      let eng = P.accel * Math.max(0, 1 - Math.pow(x, 2.3));
      // traction-limited at low speed
      eng = Math.min(eng, lateralLimit(aspeed, gripMul * mu) * 1.05);
      if (this.shiftTimer > 0) eng *= 0.4;
      a += thr * eng * (brk > 0.05 ? 0.3 : 1);
    } else if (thr <= 0.02 && brk <= 0.05) {
      a -= Math.sign(vf) * (1.1 + 0.00035 * vf * vf);
    }
    // surface drag + rolling resistance
    a -= Math.sign(vf) * (SURFACE_DRAG[surf] * Math.min(1, aspeed / 8) + 0.12);
    if (vf > vTop * 1.02) a -= (vf - vTop) * 2;
    const vfNew = vf + a * dt;
    // don't let braking flip direction in a single step
    if (vf > 0 && vfNew < 0 && brk > 0.05 && thr < 0.05) vf = 0;
    else vf = vfNew;
    if (Math.abs(vf) < 0.05 && thr < 0.05 && brk < 0.05) vf = 0;

    // ---- Steering & yaw
    const sens = this.params.steer;
    const steerRange = lerp(0.42, 0.06, smoothstep(0, 78, aspeed)) * sens;
    const steerIn = clamp(inp.steer + this.steerDisturb, -1, 1);
    this.steerDisturb = damp(this.steerDisturb, 0, 4, dt);
    const targetSteer = steerIn * steerRange;
    this.steerAngle = damp(this.steerAngle, targetSteer, 18, dt);
    const desired = (vf * Math.tan(this.steerAngle)) / WHEELBASE;
    const aLat = lateralLimit(aspeed, gripMul * mu);
    const maxYaw = (aLat / Math.max(aspeed, 3)) * 1.07;
    let yawTarget = clamp(desired, -maxYaw, maxYaw);
    this.understeer = Math.abs(desired) > maxYaw ? Math.min(1, (Math.abs(desired) - maxYaw) / (maxYaw + 0.01)) : 0;
    // Trail-braking / handbrake rotation: small, manageable oversteer
    const rotate = inp.handbrake ? 1.5 : 1 + Math.min(brk, 1) * Math.abs(steerIn) * 0.12 * (1 - this.assist);
    yawTarget *= rotate;
    this.yawRate = damp(this.yawRate, yawTarget, aspeed < 3 ? 20 : 11, dt);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // recompose with the new heading
    const wx = fx * vf + lx * vl;
    const wz = fz * vf + lz * vl;
    const nfx = Math.sin(this.yaw);
    const nfz = Math.cos(this.yaw);
    const nlx = nfz;
    const nlz = -nfx;
    vf = wx * nfx + wz * nfz;
    vl = wx * nlx + wz * nlz;
    const latGrip = aLat * (inp.handbrake ? 0.35 : 1) * (brk > 0.7 && Math.abs(steerIn) > 0.5 ? 0.92 : 1) * (1 + this.assist * 0.15);
    const kill = Math.min(Math.abs(vl), latGrip * dt);
    vl -= Math.sign(vl) * kill;
    this.slip = Math.abs(vl) + this.understeer * aspeed * 0.08 + (brk > 0.9 && aspeed > 25 && mu < 0.9 ? 3 : 0);
    this.vx = nfx * vf + nlx * vl;
    this.vz = nfz * vf + nlz * vl;
    this.speed = vf;
    this.latSpeed = vl;

    // ---- Integrate
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // ---- Track interaction
    const q = tr.project(this.x, this.z, this.q.index, this.q);
    const nX = q.tz;
    const nZ = -q.tx;
    const limL = q.wallL - HALF_WIDTH - 0.25;
    const limR = q.wallR - HALF_WIDTH - 0.25;
    if (q.lateral > limL || q.lateral < -limR) {
      const side = q.lateral > limL ? 1 : -1;
      const pen = side > 0 ? q.lateral - limL : -limR - q.lateral;
      this.x -= nX * side * pen;
      this.z -= nZ * side * pen;
      const vn = (this.vx * nX + this.vz * nZ) * side;
      if (vn > 0) {
        const tX = q.tx;
        const tZ = q.tz;
        let vt = this.vx * tX + this.vz * tZ;
        const scrub = Math.min(Math.abs(vt), vn * 0.55 + 8 * dt);
        vt -= Math.sign(vt) * scrub;
        const bounceV = -vn * 0.28;
        this.vx = tX * vt + nX * side * bounceV;
        this.vz = tZ * vt + nZ * side * bounceV;
        this.impact = vn;
        this.impactX = side;
        this.scrape = Math.min(1, this.scrape + vn * 0.05 + Math.abs(vt) * 0.01);
        // align with the wall so the car doesn't stay stuck nose-in
        const th = Math.atan2(tX, tZ) + (vt < 0 ? Math.PI : 0);
        this.yaw = wrapAngle(this.yaw + wrapAngle(th - this.yaw) * Math.min(1, vn * 0.025));
        this.yawRate *= 0.5;
        if (vn > 6) this.steerDisturb = side * -0.35;
      }
      tr.project(this.x, this.z, q.index, q);
    }

    // height & attitude
    let bump = 0;
    if (q.surface === 'curb') bump = Math.abs(Math.sin(q.s * 2.1)) * 0.035 * Math.min(1, aspeed / 20);
    else if (q.surface !== 'asphalt') bump = (Math.sin(q.s * 5.3) * 0.5 + Math.sin(q.s * 2.7 + 1) * 0.5) * 0.02 * Math.min(1, aspeed / 15);
    this.y = q.height;
    this.bounce = damp(this.bounce, bump, 25, dt);
    this.slopePitch = Math.atan(q.slope);

    // ---- Progress tracking
    let dS = q.s - this.lastS;
    if (dS > tr.length / 2) dS -= tr.length;
    if (dS < -tr.length / 2) dS += tr.length;
    this.lastS = q.s;
    this.D += dS;
    this.maxD = Math.max(this.maxD, this.D);
    const heading = Math.atan2(q.tx, q.tz);
    const wrong = Math.abs(wrapAngle(this.yaw - heading)) > 1.9 && vf > 4;
    this.wrongWay = wrong ? this.wrongWay + dt : 0;
    if (Math.abs(q.lateral) < tr.hw - 1 && Math.abs(wrapAngle(this.yaw - heading)) < 0.6) {
      this.safeS = q.s;
      this.safeLat = q.lateral;
    }

    // ---- Gearbox
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const r = Math.abs(vf) / (vTop * GEARS[this.gear]);
    if (r > 0.965 && this.gear < GEARS.length - 1 && thr > 0.3) {
      this.gear++;
      this.shiftTimer = 0.085;
      this.shifted = true;
    } else if (this.gear > 0 && Math.abs(vf) < vTop * GEARS[this.gear - 1] * 0.8) {
      this.gear--;
      this.shifted = brk > 0.2;
    }
    const lowRatio = this.gear === 0 ? 0 : GEARS[this.gear - 1] / GEARS[this.gear];
    const rr = Math.abs(vf) / (vTop * GEARS[this.gear]);
    const low = 0.965 * lowRatio;
    const target =
      this.gear === 0
        ? 0.25 + (rr / 0.965) * 0.75 + (Math.abs(vf) < 3 ? thr * 0.3 : 0)
        : 0.6 + ((rr - low) / (0.965 - low)) * 0.4 - (thr < 0.1 ? 0.04 : 0);
    this.rpm = damp(this.rpm, clamp(target, 0.22, 1.02), this.shiftTimer > 0 ? 30 : 14, dt);

    this.updateVisual(dt, (vf - this.prevVf) / Math.max(dt, 1e-4));
    this.prevVf = vf;
  }

  private updateVisual(dt: number, longAcc: number) {
    this.wheelSpin += (this.speed / 0.365) * dt;
    if (this.wheelSpin > 1e4) this.wheelSpin -= Math.PI * 2 * 1000;
    const latAcc = this.speed * this.yawRate;
    this.pitchVis = damp(this.pitchVis, clamp(-longAcc * 0.0016, -0.03, 0.035), 7, dt);
    this.rollVis = damp(this.rollVis, clamp(latAcc * 0.0011, -0.03, 0.03), 7, dt);
  }
}
