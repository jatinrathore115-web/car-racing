import type { RaceSession } from '../race/RaceSession';
import type { Track } from '../track/Track';
import { formatTime } from '../core/utils';
import { ICON } from './icons';
import type { InputManager } from '../core/InputManager';

const ARC_START = 135; // degrees, clockwise from +x
const ARC_SWEEP = 270;

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Race HUD. DOM writes are diffed so nothing touches layout unless the value changed. */
export class HUD {
  readonly el: HTMLElement;
  private posRoll: HTMLElement;
  private posBox: HTMLElement;
  private posTot: HTMLElement;
  private lapCur: HTMLElement;
  private lapTot: HTMLElement;
  private tLap: HTMLElement;
  private tBest: HTMLElement;
  private tLast: HTMLElement;
  private spd: HTMLElement;
  private gear: HTMLElement;
  private speedo: HTMLElement;
  private rpmArc: SVGPathElement;
  private rpmLen = 1;
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapBg: HTMLCanvasElement | null = null;
  private mapXf = { s: 1, ox: 0, oz: 0 };
  private banner: HTMLElement;
  private toast: HTMLElement;
  private wrong: HTMLElement;
  private cd: HTMLElement;
  private tut: HTMLElement;
  private main: HTMLElement;
  private skip: HTMLElement;
  private bars: HTMLElement;
  private introTitle: HTMLElement;
  private last: Record<string, string | number> = {};
  private shownPos = 0;
  private dpr = 1;
  units: 'kmh' | 'mph' = 'kmh';
  private accentCol = '#ffd23f';

  constructor(root: HTMLElement, input: InputManager, onPause: () => void) {
    const ticks: string[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = ((ARC_START + (ARC_SWEEP * i) / 12) * Math.PI) / 180;
      const r0 = i % 2 === 0 ? 86 : 89;
      ticks.push(`<line x1="${100 + Math.cos(a) * r0}" y1="${100 + Math.sin(a) * r0}" x2="${100 + Math.cos(a) * 94}" y2="${100 + Math.sin(a) * 94}" stroke="${i >= 10 ? '#ff5d6c' : 'rgba(255,255,255,0.45)'}" stroke-width="${i % 2 === 0 ? 2 : 1.2}"/>`);
    }
    this.el = document.createElement('section');
    this.el.className = 'screen passthrough cinebars';
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="hud-main off">
        <div class="tl">
          <div class="hud-box posbox"><div class="label">POS</div><div class="pos"><span class="roll"><span>1</span></span><span class="tot">/8</span></div></div>
          <div class="hud-box"><div class="label">LAP</div><div class="lap"><span class="cur">1</span><span class="tot"> / 3</span></div></div>
        </div>
        <div class="tr">
          <div class="timing">
            <div class="row"><span class="label">TIME</span><span class="v lapt">0:00.000</span></div>
            <div class="row sm"><span class="label">BEST</span><span class="v best bestt">--:--.---</span></div>
            <div class="row sm"><span class="label">LAST</span><span class="v lastt">--:--.---</span></div>
          </div>
          <canvas class="minimap"></canvas>
        </div>
        <div class="speedo">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="98" fill="rgba(8,12,24,0.62)" stroke="rgba(255,255,255,0.12)" stroke-width="1.2"/>
            <path d="${arcPath(100, 100, 80, ARC_START, ARC_START + ARC_SWEEP)}" stroke="rgba(255,255,255,0.1)" stroke-width="9" fill="none"/>
            <path class="rpm" d="${arcPath(100, 100, 80, ARC_START, ARC_START + ARC_SWEEP)}" stroke="url(#rpmg)" stroke-width="9" fill="none" stroke-linecap="round"/>
            <defs><linearGradient id="rpmg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" style="stop-color:var(--accent-2)"/><stop offset="0.75" style="stop-color:var(--accent)"/><stop offset="1" stop-color="#ff5d6c"/></linearGradient></defs>
            ${ticks.join('')}
          </svg>
          <div class="center"><div class="gear">N</div><div class="spd">0</div><div class="unit">KM/H</div></div>
        </div>
      </div>
      <div class="banner"></div>
      <div class="toast"></div>
      <div class="wrongway">WRONG WAY</div>
      <div class="countdown"><span></span></div>
      <div class="tutorial"><span class="kb"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / ARROWS · DRIVE</span><span class="kb"><kbd>C</kbd> CAMERA</span><span class="kb"><kbd>R</kbd> RESET</span><span class="kb"><kbd>ESC</kbd> PAUSE</span><span class="tch">LEFT PADS STEER · RIGHT PADS GAS / BRAKE</span></div>
      <div class="skip-hint">PRESS <kbd>ENTER</kbd> TO SKIP</div>
      <div class="intro-title"><div class="a"></div><div class="b"></div></div>
      <div class="touch">
        <div class="pad interactive" data-t="left" style="left:1.6rem">${ICON.left}</div>
        <div class="pad interactive" data-t="right" style="left:11.2rem">${ICON.right}</div>
        <div class="pad interactive" data-t="brake" style="right:11.2rem">BRAKE</div>
        <div class="pad interactive" data-t="gas" style="right:1.6rem">GAS</div>
        <button class="icon-btn pause-t interactive">${ICON.pause}</button>
      </div>`;
    root.appendChild(this.el);
    const q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
    this.posRoll = q('.roll');
    this.posBox = q('.posbox');
    this.posTot = q('.pos .tot');
    this.lapCur = q('.lap .cur');
    this.lapTot = q('.lap .tot');
    this.tLap = q('.lapt');
    this.tBest = q('.bestt');
    this.tLast = q('.lastt');
    this.spd = q('.spd');
    this.gear = q('.gear');
    this.speedo = q('.speedo');
    this.rpmArc = q('.rpm');
    this.rpmLen = this.rpmArc.getTotalLength();
    this.rpmArc.style.strokeDasharray = `${this.rpmLen}`;
    this.map = q('.minimap');
    this.mapCtx = this.map.getContext('2d')!;
    this.banner = q('.banner');
    this.toast = q('.toast');
    this.wrong = q('.wrongway');
    this.cd = q('.countdown span');
    this.tut = q('.tutorial');
    this.main = q('.hud-main');
    this.skip = q('.skip-hint');
    this.bars = this.el;
    this.introTitle = q('.intro-title');

    // touch controls
    this.el.querySelectorAll<HTMLElement>('.pad').forEach((pad) => {
      const key = pad.dataset.t as 'left' | 'right' | 'gas' | 'brake';
      const on = (v: boolean) => (e: Event) => {
        e.preventDefault();
        input.setTouch(key, v);
        pad.classList.toggle('on', v);
      };
      pad.addEventListener('pointerdown', on(true));
      pad.addEventListener('pointerup', on(false));
      pad.addEventListener('pointercancel', on(false));
      pad.addEventListener('pointerleave', on(false));
    });
    q<HTMLElement>('.pause-t').addEventListener('click', onPause);
  }

  setupTrack(track: Track, totalCars: number, laps: number, name: string, sub: string) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.accentCol = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffd23f';
    const size = this.map.clientWidth || 216;
    this.map.width = this.map.height = Math.round(size * this.dpr);
    const W = this.map.width;
    const b = track.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const s = (W * 0.82) / span;
    this.mapXf = { s, ox: W / 2 - ((b.minX + b.maxX) / 2) * s, oz: W / 2 - ((b.minZ + b.maxZ) / 2) * s };
    const bg = document.createElement('canvas');
    bg.width = bg.height = W;
    const c = bg.getContext('2d')!;
    c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i <= track.N; i += 2) {
      const j = i % track.N;
      const x = track.px[j] * s + this.mapXf.ox;
      const y = track.pz[j] * s + this.mapXf.oz;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 9 * this.dpr;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.88)';
    c.lineWidth = 4 * this.dpr;
    c.stroke();
    // start line marker
    const sx = track.px[0] * s + this.mapXf.ox;
    const sy = track.pz[0] * s + this.mapXf.oz;
    c.save();
    c.translate(sx, sy);
    c.rotate(Math.atan2(track.pz[1] - track.pz[0], track.px[1] - track.px[0]));
    c.fillStyle = this.accentCol;
    c.fillRect(-1.5 * this.dpr, -7 * this.dpr, 3 * this.dpr, 14 * this.dpr);
    c.restore();
    this.mapBg = bg;
    this.posTot.textContent = `/${totalCars}`;
    this.lapTot.textContent = ` / ${laps}`;
    this.posBox.style.display = totalCars > 1 ? '' : 'none';
    this.last = {};
    this.shownPos = 0;
    this.main.classList.add('off');
    (this.introTitle.querySelector('.a') as HTMLElement).textContent = name;
    (this.introTitle.querySelector('.b') as HTMLElement).textContent = sub;
    this.wrong.classList.remove('show');
  }

  setIntro(on: boolean) {
    this.bars.classList.toggle('on', on);
    this.introTitle.classList.toggle('show', on);
    this.skip.classList.toggle('show', on);
  }

  showMain(on: boolean) {
    this.main.classList.toggle('off', !on);
  }

  private set(el: HTMLElement, key: string, v: string) {
    if (this.last[key] !== v) {
      this.last[key] = v;
      el.textContent = v;
    }
  }

  countdown(n: number) {
    this.cd.classList.remove('show', 'go');
    void this.cd.offsetWidth;
    this.cd.textContent = n > 0 ? String(n) : 'GO';
    if (n <= 0) this.cd.classList.add('go');
    this.cd.classList.add('show');
  }

  showBanner(html: string) {
    this.banner.innerHTML = html;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  setWrongWay(on: boolean) {
    this.wrong.classList.toggle('show', on);
  }

  tutorial(on: boolean) {
    this.tut.classList.toggle('show', on);
  }

  /** Position change: vertical number roll + subtle pulse, never a popup. */
  position(from: number, to: number) {
    const better = to < from;
    this.posRoll.innerHTML = better ? `<span>${from}</span><span>${to}</span>` : `<span>${to}</span><span>${from}</span>`;
    const spans = Array.from(this.posRoll.querySelectorAll('span')) as HTMLElement[];
    for (const sp of spans) {
      sp.style.transition = 'none';
      sp.style.transform = better ? 'translateY(0)' : 'translateY(-100%)';
    }
    void this.posRoll.offsetWidth;
    for (const sp of spans) {
      sp.style.transition = '';
      sp.style.transform = better ? 'translateY(-100%)' : 'translateY(0)';
    }
    this.posBox.classList.remove('pulse', 'lose');
    void this.posBox.offsetWidth;
    this.posBox.classList.add(better ? 'pulse' : 'lose');
    this.shownPos = to;
    window.setTimeout(() => {
      if (this.shownPos === to) this.posRoll.innerHTML = `<span>${to}</span>`;
    }, 420);
  }

  update(r: RaceSession) {
    const pl = r.player;
    if (!this.shownPos) {
      this.shownPos = pl.position;
      this.posRoll.innerHTML = `<span>${pl.position}</span>`;
    }
    this.set(this.lapCur, 'lap', String(Math.min(pl.laps + 1, r.totalLaps)));
    const lapT = r.phase === 'racing' || r.phase === 'finishing' ? (pl.finished ? pl.lastLap : r.raceTime - pl.lapStart) : 0;
    this.set(this.tLap, 'lapt', formatTime(lapT || 0.0001).replace('--:--.---', '0:00.000'));
    this.set(this.tBest, 'best', formatTime(pl.bestLap));
    this.set(this.tLast, 'lastl', formatTime(pl.lastLap));
    const kmh = pl.phys.kmh;
    const v = this.units === 'mph' ? kmh * 0.621371 : kmh;
    this.set(this.spd, 'spd', String(Math.round(v)));
    const g = pl.phys.speed < -0.5 ? 'R' : Math.abs(pl.phys.speed) < 0.5 && pl.phys.throttle < 0.1 ? 'N' : String(pl.phys.gear + 1);
    this.set(this.gear, 'gear', g);
    const rpm = Math.min(1, Math.max(0, (pl.phys.rpm - 0.2) / 0.8));
    const off = (this.rpmLen * (1 - rpm)).toFixed(1);
    if (this.last.rpm !== off) {
      this.last.rpm = off;
      this.rpmArc.style.strokeDashoffset = off;
    }
    const red = rpm > 0.93;
    if (this.last.red !== String(red)) {
      this.last.red = String(red);
      this.speedo.classList.toggle('redline', red);
    }
    this.drawMap(r);
  }

  private drawMap(r: RaceSession) {
    if (!this.mapBg) return;
    const c = this.mapCtx;
    const W = this.map.width;
    c.clearRect(0, 0, W, W);
    c.drawImage(this.mapBg, 0, 0);
    const { s, ox, oz } = this.mapXf;
    const d = this.dpr;
    for (const car of r.cars) {
      if (car.isPlayer) continue;
      c.beginPath();
      c.arc(car.phys.x * s + ox, car.phys.z * s + oz, 3.6 * d, 0, Math.PI * 2);
      c.fillStyle = car.color;
      c.fill();
      c.lineWidth = 1.2 * d;
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.stroke();
    }
    const p = r.player.phys;
    c.beginPath();
    c.arc(p.x * s + ox, p.z * s + oz, 5.5 * d, 0, Math.PI * 2);
    c.fillStyle = this.accentCol;
    c.fill();
    c.lineWidth = 2 * d;
    c.strokeStyle = '#fff';
    c.stroke();
  }
}
