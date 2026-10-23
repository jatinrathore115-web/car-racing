import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/utils';
import type { VehiclePhysics } from '../vehicle/VehiclePhysics';
import type { CarModel } from '../vehicle/CarModel';

export type CamMode = 'chase' | 'cockpit' | 'nose' | 'cinematic';
export const CAM_MODES: CamMode[] = ['chase', 'cockpit', 'nose', 'cinematic'];

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const eTmp = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Racing camera. Shake is event-driven (trauma model) and directional impulses are simulated
 * with a damped spring, so nothing shakes continuously without a reason.
 */
export class CameraController {
  mode: CamMode = 'chase';
  shakeEnabled = true;
  private yaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = 60;
  private trauma = 0;
  private spring = new THREE.Vector3();
  private springV = new THREE.Vector3();
  private t = 0;
  private distOffset = 0;
  private initialized = false;
  private roll = 0;
  scripted = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap() {
    this.initialized = false;
  }

  addTrauma(a: number) {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** Directional kick in camera-local space (x right, y up, z forward). */
  impulse(x: number, y: number, z: number) {
    const k = this.shakeEnabled ? 1 : 0.35;
    this.springV.x += x * k;
    this.springV.y += y * k;
    this.springV.z += z * k;
  }

  update(dt: number, ph: VehiclePhysics, model: CarModel, longAcc: number) {
    this.t += dt;
    const cam = this.camera;
    const speed = Math.max(0, ph.speed);
    const kmh = speed * 3.6;
    const fx = Math.sin(ph.yaw);
    const fz = Math.cos(ph.yaw);

    if (!this.initialized) {
      this.yaw = ph.yaw;
      this.pos.set(ph.x - fx * 6.5, ph.y + 2, ph.z - fz * 6.5);
      this.look.set(ph.x, ph.y + 0.8, ph.z);
      this.initialized = true;
    }

    // spring impulses
    const k = 70;
    const c = 11;
    this.springV.addScaledVector(this.spring, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
    this.spring.addScaledVector(this.springV, dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.13 + o * 1.7) * 0.4;
    const shakeX = sh * n(31, 0) * 0.12;
    const shakeY = sh * n(37, 2) * 0.1;
    const shakeR = sh * n(23, 5) * 0.03;
    // subtle high-speed buzz
    const buzz = this.shakeEnabled ? smoothstep(240, 330, kmh) * 0.006 : 0;

    let targetFov = 60;
    if (this.mode === 'chase' || this.mode === 'cinematic') {
      const cine = this.mode === 'cinematic';
      // yaw lag: car rotates slightly before the camera catches up
      const velYaw = speed > 4 ? Math.atan2(ph.vx, ph.vz) : ph.yaw;
      const desiredYaw = ph.yaw + wrapAngle(velYaw - ph.yaw) * 0.35;
      this.yaw += wrapAngle(desiredYaw - this.yaw) * (1 - Math.exp(-(cine ? 2.6 : 5.2) * dt));
      // braking pulls the camera in, acceleration settles it back
      this.distOffset = damp(this.distOffset, clamp(-longAcc * 0.045, -0.9, 0.7), 4, dt);
      const dist = (cine ? 9.2 : 5.35) + speed * (cine ? 0.03 : 0.011) + this.distOffset;
      const height = (cine ? 1.25 : 1.58) + speed * 0.002;
      const bx = -Math.sin(this.yaw);
      const bz = -Math.cos(this.yaw);
      const side = cine ? 0.9 : 0;
      v1.set(ph.x + bx * dist + Math.cos(this.yaw) * side, ph.y + height, ph.z + bz * dist - Math.sin(this.yaw) * side);
      this.pos.x = damp(this.pos.x, v1.x, 14, dt);
      this.pos.z = damp(this.pos.z, v1.z, 14, dt);
      this.pos.y = damp(this.pos.y, v1.y, 7, dt);
      const ahead = 4 + speed * 0.06;
      v2.set(ph.x + fx * ahead, ph.y + 0.95 + Math.tan(ph.slopePitch) * ahead * 0.5, ph.z + fz * ahead);
      this.look.lerp(v2, 1 - Math.exp(-18 * dt));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      this.roll = damp(this.roll, clamp(-ph.yawRate * speed * 0.0016, -0.035, 0.035), 4, dt);
      cam.rotateZ(this.roll);
      targetFov = cine ? lerp(50, 62, smoothstep(10, 90, speed)) : lerp(58, 75, smoothstep(8, 88, speed));
    } else {
      // Car-mounted cameras follow the body's full orientation.
      model.body.updateWorldMatrix(true, false);
      const anchor = this.mode === 'cockpit' ? model.cockpitAnchor : model.frontWingAnchor;
      anchor.getWorldPosition(v1);
      if (this.mode === 'nose') {
        // centre the nose cam
        v1.set(0, 0.62, 2.0);
        model.body.localToWorld(v1);
      }
      cam.position.copy(v1);
      model.body.getWorldQuaternion(qTmp);
      cam.quaternion.copy(qTmp);
      // camera looks down -Z; car forward is +Z
      cam.rotateY(Math.PI);
      eTmp.set(this.mode === 'cockpit' ? -0.06 : -0.035, 0, 0);
      cam.rotateX(eTmp.x);
      targetFov = this.mode === 'cockpit' ? lerp(68, 82, smoothstep(10, 90, speed)) : lerp(66, 84, smoothstep(10, 90, speed));
      this.pos.copy(cam.position);
      this.yaw = ph.yaw;
      this.look.set(ph.x + fx * 10, ph.y + 0.8, ph.z + fz * 10);
    }

    // apply spring + shake in camera space
    v1.set(this.spring.x + shakeX + (Math.random() - 0.5) * buzz, this.spring.y + shakeY + (Math.random() - 0.5) * buzz, 0);
    v1.applyQuaternion(cam.quaternion);
    cam.position.add(v1);
    v2.set(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(this.spring.z);
    cam.position.add(v2);
    cam.rotateZ(shakeR);

    this.fov = damp(this.fov, targetFov, 2.2, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Scripted shot (grid cinematics, finish orbit). */
  shot(pos: THREE.Vector3, target: THREE.Vector3, fov: number) {
    const cam = this.camera;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.fov = fov;
    this.pos.copy(pos);
    this.look.copy(target);
  }
}
