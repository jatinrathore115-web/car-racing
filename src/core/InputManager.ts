import { clamp } from './utils';

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number; // +1 = left
  handbrake: boolean;
}

type Action = 'camera' | 'reset' | 'pause' | 'confirm' | 'back' | 'up' | 'down' | 'left' | 'right';

/**
 * Unified keyboard / gamepad / touch input. Analog values are read every frame from
 * `drive`; discrete actions are delivered as edge-triggered events.
 */
export class InputManager {
  readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private keys = new Set<string>();
  private handlers = new Map<Action, Set<() => void>>();
  private padPrev: boolean[] = [];
  private touch = { left: false, right: false, gas: false, brake: false };
  usingGamepad = false;
  isTouch = false;
  anyDriveInput = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.usingGamepad = false;
      const map: Record<string, Action> = {
        KeyC: 'camera',
        KeyR: 'reset',
        Escape: 'pause',
        KeyP: 'pause',
        Enter: 'confirm',
        Backspace: 'back',
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const a = map[e.code];
      // Buttons would also fire a native click on Enter/Space; the game handles confirm itself,
      // so suppress the native activation to guarantee exactly one action per key press.
      const t = e.target as HTMLElement | null;
      if ((e.code === 'Enter' || e.code === 'Space') && t && t.tagName === 'BUTTON') e.preventDefault();
      if (a) this.emit(a);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  on(action: Action, fn: () => void) {
    if (!this.handlers.has(action)) this.handlers.set(action, new Set());
    this.handlers.get(action)!.add(fn);
    return () => this.handlers.get(action)!.delete(fn);
  }

  private emit(a: Action) {
    this.handlers.get(a)?.forEach((h) => h());
  }

  setTouch(key: keyof InputManager['touch'], v: boolean) {
    this.touch[key] = v;
  }

  update(dt: number, sensitivity: number) {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') || this.touch.gas ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') || this.touch.brake ? 1 : 0;
    let steerTarget = 0;
    if (k.has('KeyA') || k.has('ArrowLeft') || this.touch.left) steerTarget += 1;
    if (k.has('KeyD') || k.has('ArrowRight') || this.touch.right) steerTarget -= 1;
    let analogSteer: number | null = null;
    let handbrake = k.has('Space');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const lx = p.axes[0] ?? 0;
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      if (Math.abs(lx) > 0.12 || rt > 0.05 || lt > 0.05) this.usingGamepad = true;
      if (this.usingGamepad) {
        const dz = 0.12;
        const ax = Math.abs(lx) < dz ? 0 : (Math.sign(lx) * (Math.abs(lx) - dz)) / (1 - dz);
        analogSteer = -Math.sign(ax) * Math.pow(Math.abs(ax), 1.5);
        throttle = Math.max(throttle, rt, p.buttons[0]?.pressed ? 1 : 0);
        brake = Math.max(brake, lt);
        handbrake = handbrake || !!p.buttons[2]?.pressed;
      }
      // Edge-triggered buttons
      const edges: [number, Action][] = [
        [3, 'camera'],
        [9, 'pause'],
        [8, 'reset'],
        [0, 'confirm'],
        [1, 'back'],
        [12, 'up'],
        [13, 'down'],
        [14, 'left'],
        [15, 'right'],
      ];
      for (const [i, a] of edges) {
        const pressed = !!p.buttons[i]?.pressed;
        if (pressed && !this.padPrev[i]) this.emit(a);
        this.padPrev[i] = pressed;
      }
      break;
    }

    const d = this.drive;
    d.throttle = throttle;
    d.brake = brake;
    d.handbrake = handbrake;
    if (analogSteer !== null) {
      d.steer = clamp(analogSteer * sensitivity, -1, 1);
    } else {
      // Digital steering ramps in progressively so keyboard input never feels twitchy.
      const rate = (steerTarget === 0 ? 7 : Math.sign(steerTarget) !== Math.sign(d.steer) && d.steer !== 0 ? 9 : 4.2) * sensitivity;
      const delta = steerTarget - d.steer;
      d.steer += clamp(delta, -rate * dt, rate * dt);
    }
    this.anyDriveInput = throttle > 0.1 || brake > 0.1 || Math.abs(d.steer) > 0.2;
  }
}
