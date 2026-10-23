import { PLAYER_CARS, CARS, type CarDef } from '../data/cars';
import { TRACKS, CHAMPIONSHIP, type TrackDef } from '../data/tracks';
import { SEASONS, getSeason, applySeasonTheme, type SeasonDef } from '../data/seasons';
import { SeasonBackdrop, paintThumb } from './SeasonArt';
import { save, type Settings, type Difficulty, type Quality } from '../core/SaveService';
import { ICON, trophySVG } from './icons';
import { audio } from '../core/AudioManager';
import { formatTime } from '../core/utils';
import * as THREE from 'three';

export type ScreenId = 'boot' | 'season' | 'splash' | 'menu' | 'garage' | 'tracks' | 'setup' | 'champ' | 'loading' | 'hud' | 'pause' | 'results' | 'settings';

export interface UIActions {
  bootStart(): void;
  seasonConfirm(s: SeasonDef): void;
  play(): void;
  menu(item: 'race' | 'championship' | 'timetrial' | 'garage' | 'settings' | 'season'): void;
  back(): void;
  previewCar(def: CarDef): void;
  selectCar(def: CarDef): void;
  buyCar(def: CarDef): void;
  garageContinue(): void;
  selectTrack(def: TrackDef): void;
  tracksContinue(): void;
  startRace(): void;
  startChampionshipRound(): void;
  resetChampionship(): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
  openSettings(): void;
  closeSettings(): void;
  settingsChanged(s: Settings, key: keyof Settings): void;
  retry(): void;
  nextRace(): void;
}

const meter = (n: number) => `<span class="meter">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span>`;

const DIFF_DESC: Record<Difficulty, string> = {
  rookie: 'Stronger assists and extra traction. Rivals brake earlier and race cleaner.',
  pro: 'Balanced assists. Rivals commit to overtakes and defend the inside.',
  expert: 'Minimal assists, punishing errors. Rivals brake late and rarely make mistakes.',
};

const TIPS = [
  'Brake in a straight line, then release gently as you turn in — the car rotates best off the brakes.',
  'Downforce builds with speed: fast corners hold more grip than you expect. Commit.',
  'Curbs are fine to use, but the grass beyond them will cost you grip and speed.',
  'Stuck or facing the wrong way? Press R to reset onto the racing line.',
  'Press C to cycle between chase, cockpit, nose and cinematic cameras.',
  'Rivals defend the inside into heavy braking zones. Try the switchback on exit.',
  'Wet track? Smooth inputs. The tyres forgive far less on standing water.',
];

/** Circuit outline as SVG path from the raw control points (cheap, no Track build needed). */
export function trackSVGPath(def: TrackDef, size = 100, pad = 8) {
  const curve = new THREE.CatmullRomCurve3(def.points.map((p) => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
  const pts = curve.getSpacedPoints(160);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ);
  const s = (size - pad * 2) / span;
  const ox = size / 2 - ((minX + maxX) / 2) * s;
  const oz = size / 2 - ((minZ + maxZ) / 2) * s;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * s + ox).toFixed(1)} ${(p.z * s + oz).toFixed(1)}`).join('') + 'Z';
  const start = pts[0];
  return { d, sx: start.x * s + ox, sy: start.z * s + oz };
}

export function isTrackUnlocked(def: TrackDef) {
  if (def.unlockAfter < 0) return true;
  const req = TRACKS[def.unlockAfter];
  return (save.data.trophies[req.id] ?? 0) >= 1;
}

export class Screens {
  readonly root: HTMLElement;
  private screens = new Map<ScreenId, HTMLElement>();
  current: ScreenId = 'boot';
  settingsOpen = false;
  selectedCar: CarDef = PLAYER_CARS[0];
  selectedTrack: TrackDef = TRACKS[0];
  laps = 3;
  flow: 'browse' | 'race' | 'championship' | 'timetrial' = 'browse';
  backdrop!: SeasonBackdrop;
  /** Season currently chosen on the season screen (committed on confirm). */
  seasonSel: SeasonDef = getSeason(save.data.season);

  get season() {
    return getSeason(save.data.season);
  }

  /** Hover/focus selects a season: re-themes the whole UI and crossfades the painted backdrop. */
  previewSeason(def: SeasonDef) {
    if (this.seasonBusy) return;
    applySeasonTheme(def);
    this.backdrop.show(def);
    const ss = this.el('season');
    ss.querySelectorAll<HTMLElement>('.season-card').forEach((c) => {
      const on = c.dataset.s === def.id;
      c.classList.toggle('active', on);
      c.setAttribute('aria-checked', String(on));
    });
    this.seasonSel = def;
    (ss.querySelector('.go .gl') as HTMLElement).textContent = `Race in ${def.name}`;
  }
  seasonBusy = false;

  openSeasonScreen(from: 'boot' | 'menu') {
    this.seasonBusy = false;
    this.el('season').classList.remove('busy');
    this.setSeasonProgress(0, '');
    this.seasonSel = this.season;
    this.show('season');
    this.previewSeason(this.seasonSel);
    this.backdrop.start();
    (this.el('season').querySelector('.steps') as HTMLElement).style.visibility = from === 'boot' ? 'visible' : 'hidden';
    window.setTimeout(() => (this.el('season').querySelector(`.season-card[data-s="${this.seasonSel.id}"]`) as HTMLElement)?.focus({ preventScroll: true }), 80);
  }

  setSeasonProgress(p: number, label: string) {
    const ss = this.el('season');
    (ss.querySelector('.go .fill') as HTMLElement).style.transform = `scaleX(${p})`;
    if (label) (ss.querySelector('.go .gl') as HTMLElement).textContent = label;
    ss.classList.toggle('busy', p > 0);
    this.seasonBusy = p > 0;
  }

  closeSeasonScreen() {
    this.backdrop.stop();
  }

  constructor(private a: UIActions) {
    this.root = document.getElementById('ui')!;
    this.build();
    // UI audio: hover ticks on any interactive element
    this.root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest('button, .track-card, .car-tile');
      if (t && !(t as HTMLButtonElement).disabled && t !== this.lastHover) {
        this.lastHover = t;
        audio.uiHover();
      }
    });
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t) {
        if (t.classList.contains('is-back')) audio.uiBack();
        else audio.uiClick();
      }
    });
  }
  private lastHover: Element | null = null;

  private section(id: ScreenId, html: string, cls = '') {
    const el = document.createElement('section');
    el.className = 'screen ' + cls;
    el.id = id;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screens.set(id, el);
    return el;
  }

  el(id: ScreenId) {
    return this.screens.get(id)!;
  }

  registerHUD(el: HTMLElement) {
    this.screens.set('hud', el);
  }

  private build() {
    const brand = (cls: string) =>
      `<div class="brand ${cls}">${ICON.mark}<span class="words"><span class="w1">APEX</span><span class="w2">VELOCITY</span></span><span class="streak"></span></div>`;
    const back = (title: string, crumb = '') =>
      `<div class="back"><button class="icon-btn is-back" data-nav aria-label="Back">${ICON.back}</button><div>${crumb ? `<span class="label crumb">${crumb}</span>` : ''}<span class="title">${title}</span></div></div>`;

    // Boot
    const boot = this.section(
      'boot',
      `<div class="inner">${brand('')}<div class="progress"><i></i></div><div class="press">CLICK OR PRESS ANY KEY</div><div class="hint">Best experienced with sound · press F for fullscreen</div></div>`,
    );
    const start = () => {
      if (boot.classList.contains('ready') && this.current === 'boot') this.a.bootStart();
    };
    boot.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);

    // Season & environment select (first screen of the experience)
    const ss = this.section(
      'season',
      `<div class="scrim"></div>
       <div class="top">
         ${brand('brand-sm')}
         <div class="steps"><span class="step on"><b>1</b>Season</span><span class="sep"></span><span class="step"><b>2</b>Car</span><span class="sep"></span><span class="step"><b>3</b>Circuit</span></div>
       </div>
       <div class="head enter"><h1>Pick your season.<br><span class="grad-text">Own the conditions.</span></h1><p>Every season reshapes the world: light, weather, scenery and how much grip your tyres find. You can switch any time from the main menu.</p></div>
       <div class="season-row" role="radiogroup" aria-label="Season"></div>
       <div class="cta"><div class="hint"><kbd>←</kbd><kbd>→</kbd> browse &nbsp;·&nbsp; <kbd>Enter</kbd> confirm</div><button class="btn primary go" data-nav><span class="fill"></span><span class="lbl"><span class="gl">Race in Summer</span><span class="arrow">${ICON.arrow}</span></span></button></div>`,
    );
    this.backdrop = new SeasonBackdrop(ss);
    const row = ss.querySelector('.season-row') as HTMLElement;
    row.innerHTML = SEASONS.map(
      (s, i) => `<button class="season-card" data-nav data-s="${s.id}" role="radio" aria-checked="false" style="--sa:${s.ui.accent};--sb:${s.ui.accent2}">
        <canvas width="480" height="640"></canvas>
        <span class="check">${ICON.check}</span>
        <span class="body">
          <span class="idx">0${i + 1}</span>
          <span class="nm" style="display:block">${s.name}</span>
          <span class="ttl" style="display:block">${s.title}</span>
          <span class="more" style="display:block">
            <span class="tag" style="display:block">${s.tagline}</span>
            <span class="traits">${s.traits.map((t) => `<span>${t}</span>`).join('')}</span>
            <span class="meters"><span class="label">GRIP</span>${meter(s.gripLevel)}<span class="label">VISIBILITY</span>${meter(s.visibility)}</span>
          </span>
        </span>
      </button>`,
    ).join('');
    row.querySelectorAll<HTMLButtonElement>('.season-card').forEach((card) => {
      const def = getSeason(card.dataset.s);
      paintThumb(card.querySelector('canvas')!, def);
      const preview = () => this.previewSeason(def);
      card.addEventListener('pointerenter', preview);
      card.addEventListener('focus', preview);
      // Selecting the already-active season (2nd click / Enter / A button) confirms it.
      card.addEventListener('click', () => {
        if (this.seasonSel.id === def.id && card.classList.contains('active')) this.a.seasonConfirm(def);
        else this.previewSeason(def);
      });
    });
    ss.querySelector('.go')!.addEventListener('click', () => this.a.seasonConfirm(this.seasonSel));

    // Splash (key art)
    const sp = this.section(
      'splash',
      `<div class="scrim"></div>
       <div class="logo-wrap">${brand('brand-lg')}<div class="tag"><span class="chip accent sp-season"></span><span>World Circuit Series</span></div></div>
       <button class="icon-btn gear" data-nav aria-label="Settings">${ICON.gear}</button>
       <div class="play-wrap"><button class="btn primary play" data-nav>Play <span class="arrow">${ICON.arrow}</span></button><div class="play-hint">or press <kbd>Enter</kbd></div></div>`,
    );
    sp.querySelector('.play')!.addEventListener('click', () => this.a.play());
    sp.querySelector('.gear')!.addEventListener('click', () => this.a.openSettings());

    // Main menu: one dominant action + secondary tiles
    const tile = (m: string, icon: string, name: string, sub: string) =>
      `<button class="tile enter" data-nav data-m="${m}"><span class="ic">${icon}</span><span><span class="tn" style="display:block">${name}</span><span class="ts" style="display:block">${sub}</span></span></button>`;
    const m = this.section(
      'menu',
      `<div class="scrim"></div>
       <div class="col">
        ${brand('')}
        <button class="menu-hero enter" data-nav data-m="race"><span class="k">QUICK RACE</span><span class="t">Race</span><span class="s">8 cars · 3 laps · <span class="mh-season"></span></span><span class="go">${ICON.arrow}</span></button>
        <div class="tiles">
          ${tile('championship', ICON.cup, 'Championship', `${CHAMPIONSHIP.rounds.length} rounds · points`)}
          ${tile('timetrial', ICON.stopwatch, 'Time Trial', 'Beat your ghost')}
          ${tile('garage', ICON.car, 'Garage', 'Cars & liveries')}
          ${tile('season', ICON.season.summer, 'Season', '<span class="mt-season"></span>')}
        </div>
       </div>
       <div class="topbar">
         <span class="chip">${ICON.coin}<b class="cr">0</b></span>
         <span class="chip">${ICON.cup}<b class="tr">0</b></span>
         <button class="icon-btn" data-nav data-m="settings" aria-label="Settings">${ICON.gear}</button>
       </div>`,
    );
    m.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => this.a.menu(b.dataset.m as never)));

    // Garage
    const g = this.section(
      'garage',
      `${back('Garage', 'STEP 2 · CAR')}
       <div class="panel glass">
         <div class="car-team enter"></div>
         <div class="car-name enter"></div>
         <div class="car-tag enter"></div>
         <div class="stats"></div>
         <div class="price"></div>
         <div class="actions"></div>
       </div>
       <div class="drag-hint">Drag to rotate · scroll to zoom</div>
       <div class="car-strip glass"></div>`,
    );
    g.querySelector('.is-back')!.addEventListener('click', () => this.a.back());

    // Tracks
    const t = this.section(
      'tracks',
      `${back('Select circuit', 'STEP 3 · CIRCUIT')}
       <div class="grid"></div>
       <div class="bottom-bar"><div class="grow sel-info"></div><button class="btn primary cont" data-nav>Continue <span class="arrow">${ICON.arrow}</span></button></div>`,
    );
    t.querySelector('.is-back')!.addEventListener('click', () => this.a.back());
    t.querySelector('.cont')!.addEventListener('click', () => this.a.tracksContinue());

    // Setup
    const s = this.section(
      'setup',
      `${back('Race setup')}
       <div class="wrap glass">
         <div class="summary"><div><div class="label">CIRCUIT</div><div class="big tname"></div><div class="twx" style="margin-top:.8rem"></div></div></div>
         <div class="opt"><span class="label">DIFFICULTY</span><div class="seg diff"><button data-v="rookie" data-nav>ROOKIE</button><button data-v="pro" data-nav>PRO</button><button data-v="expert" data-nav>EXPERT</button></div></div>
         <div class="diff-desc"></div>
         <div class="opt"><span class="label">LAPS</span><div class="seg laps"><button data-v="2" data-nav>2</button><button data-v="3" data-nav>3</button><button data-v="5" data-nav>5</button></div></div>
         <div class="opt"><span class="label">RACING LINE ASSIST</span><button class="toggle rl" data-nav aria-label="Racing line"></button></div>
         <div class="opt"><span class="label">CAR</span><span class="display carname" style="font-size:1rem"></span></div>
         <div class="actions" style="margin-top:1.8rem"><button class="btn primary go" data-nav>Start race <span class="arrow">${ICON.arrow}</span></button></div>
       </div>`,
    );
    s.querySelector('.is-back')!.addEventListener('click', () => this.a.back());
    s.querySelectorAll<HTMLButtonElement>('.diff button').forEach((b) =>
      b.addEventListener('click', () => {
        save.settings.difficulty = b.dataset.v as Difficulty;
        save.commit();
        this.refreshSetup();
      }),
    );
    s.querySelectorAll<HTMLButtonElement>('.laps button').forEach((b) =>
      b.addEventListener('click', () => {
        this.laps = Number(b.dataset.v);
        this.refreshSetup();
      }),
    );
    s.querySelector('.rl')!.addEventListener('click', () => {
      save.settings.racingLine = !save.settings.racingLine;
      save.commit();
      this.refreshSetup();
    });
    s.querySelector('.go')!.addEventListener('click', () => this.a.startRace());

    // Championship
    const c = this.section(
      'champ',
      `${back('Championship', 'STEP 3 · SEASON CUP')}
       <div class="wrap glass">
         <div class="label" style="color:var(--accent)">${CHAMPIONSHIP.name}</div>
         <div class="summary"><div class="big croundt"></div></div>
         <div class="rounds"></div>
         <div class="opt"><span class="label">DIFFICULTY</span><div class="seg cdiff"><button data-v="rookie" data-nav>ROOKIE</button><button data-v="pro" data-nav>PRO</button><button data-v="expert" data-nav>EXPERT</button></div></div>
         <div class="actions" style="margin-top:1.8rem"><button class="btn primary cgo" data-nav>Start round</button><button class="btn creset" data-nav>Reset</button></div>
       </div>
       <div class="standings glass"><div class="label" style="margin-bottom:.8rem">DRIVER STANDINGS</div><table class="table"></table></div>`,
    );
    c.querySelector('.is-back')!.addEventListener('click', () => this.a.back());
    c.querySelector('.cgo')!.addEventListener('click', () => this.a.startChampionshipRound());
    c.querySelector('.creset')!.addEventListener('click', () => this.a.resetChampionship());
    c.querySelectorAll<HTMLButtonElement>('.cdiff button').forEach((b) =>
      b.addEventListener('click', () => {
        save.settings.difficulty = b.dataset.v as Difficulty;
        save.commit();
        this.refreshChampionship();
      }),
    );

    // Loading
    this.section(
      'loading',
      `<svg class="map" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg>
       <div class="info glass">
         <div class="label" style="margin-bottom:1rem"><span class="rn"></span></div>
         <div class="tname"></div><div class="tloc"></div>
         <div class="chips"></div>
         <div class="progress"><i></i></div><div class="stage"></div>
       </div>
       <div class="tip glass"></div>`,
      'tinted',
    );

    // Pause
    const p = this.section(
      'pause',
      `<div class="col glass"><div class="title">Paused</div>
        <button class="menu-item primary" data-nav data-p="resume">Resume</button>
        <button class="menu-item" data-nav data-p="restart">Restart</button>
        <button class="menu-item" data-nav data-p="settings">Settings</button>
        <button class="menu-item" data-nav data-p="menu">Main menu</button></div>`,
    );
    p.querySelectorAll<HTMLElement>('[data-p]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.p;
        if (v === 'resume') this.a.resume();
        else if (v === 'restart') this.a.restart();
        else if (v === 'settings') this.a.openSettings();
        else this.a.quitToMenu();
      }),
    );

    // Results
    const r = this.section(
      'results',
      `<div class="left glass">
        <div class="finished enter">FINISHED</div>
        <div class="bigpos enter"></div>
        <div class="res-stats enter">
          <div><div class="label">RACE TIME</div><div class="v rt"></div></div>
          <div><div class="label">BEST LAP</div><div class="v bl"></div></div>
          <div><div class="label">REWARD</div><div class="v rw"></div></div>
          <div class="trophy-wrap"><div class="tsvg"></div><div><div class="label">TROPHY</div><div class="v tn" style="font-size:1.2rem"></div></div></div>
        </div>
        <div class="btns enter"><button class="btn primary rnext" data-nav>Next race</button><button class="btn rretry" data-nav>Retry</button><button class="btn rmenu" data-nav>Menu</button></div>
      </div>
      <div class="right glass enter"><div class="label rtitle" style="margin-bottom:.8rem">CLASSIFICATION</div><table class="table"></table></div>`,
    );
    r.querySelector('.rnext')!.addEventListener('click', () => this.a.nextRace());
    r.querySelector('.rretry')!.addEventListener('click', () => this.a.retry());
    r.querySelector('.rmenu')!.addEventListener('click', () => this.a.quitToMenu());

    // Settings
    const st = this.section(
      'settings',
      `<div class="sheet glass">
        <h2>Settings</h2>
        <h3>AUDIO</h3>
        ${this.sliderRow('Master Volume', 'master')}
        ${this.sliderRow('Music', 'music')}
        ${this.sliderRow('Engine', 'engine')}
        ${this.sliderRow('Effects', 'effects')}
        <h3>GRAPHICS</h3>
        <div class="opt"><span class="label">QUALITY</span><div class="seg q"><button data-v="auto" data-nav>AUTO</button><button data-v="performance" data-nav>PERFORMANCE</button><button data-v="high" data-nav>HIGH</button><button data-v="ultra" data-nav>ULTRA 4K</button></div></div>
        <div class="opt"><span class="label">RESOLUTION SCALE</span><div style="display:flex;align-items:center;gap:1rem"><input type="range" class="slider" data-k="resolutionScale" min="0.5" max="1" step="0.05" data-nav><span class="val" data-v="resolutionScale"></span></div></div>
        <div class="opt"><span class="label">MOTION BLUR</span><button class="toggle" data-t="motionBlur" data-nav></button></div>
        <div class="opt"><span class="label">CAMERA SHAKE</span><button class="toggle" data-t="cameraShake" data-nav></button></div>
        <h3>GAMEPLAY</h3>
        <div class="opt"><span class="label">RACING LINE</span><button class="toggle" data-t="racingLine" data-nav></button></div>
        <div class="opt"><span class="label">DIFFICULTY</span><div class="seg sd"><button data-v="rookie" data-nav>ROOKIE</button><button data-v="pro" data-nav>PRO</button><button data-v="expert" data-nav>EXPERT</button></div></div>
        <div class="opt"><span class="label">STEERING SENSITIVITY</span><div style="display:flex;align-items:center;gap:1rem"><input type="range" class="slider" data-k="sensitivity" min="0.6" max="1.4" step="0.05" data-nav><span class="val" data-v="sensitivity"></span></div></div>
        <div class="opt"><span class="label">SPEED UNITS</span><div class="seg un"><button data-v="kmh" data-nav>KM/H</button><button data-v="mph" data-nav>MPH</button></div></div>
        <div class="actions" style="margin-top:2rem"><button class="btn primary sdone is-back" data-nav>DONE</button></div>
      </div>`,
    );
    st.querySelector('.sdone')!.addEventListener('click', () => this.a.closeSettings());
    st.addEventListener('pointerdown', (e) => {
      if (e.target === st) this.a.closeSettings();
    });
    st.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as keyof Settings;
        (save.settings as unknown as Record<string, number>)[k] = Number(inp.value);
        this.refreshSettings();
        this.a.settingsChanged(save.settings, k);
      }),
    );
    st.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.t as keyof Settings;
        (save.settings as unknown as Record<string, boolean>)[k] = !(save.settings as unknown as Record<string, boolean>)[k];
        this.refreshSettings();
        this.a.settingsChanged(save.settings, k);
      }),
    );
    st.querySelectorAll<HTMLButtonElement>('.q button').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.v === 'auto') save.settings.qualityAuto = true;
        else {
          save.settings.qualityAuto = false;
          save.settings.quality = b.dataset.v as Quality;
        }
        this.refreshSettings();
        this.a.settingsChanged(save.settings, 'quality');
      }),
    );
    st.querySelectorAll<HTMLButtonElement>('.sd button').forEach((b) =>
      b.addEventListener('click', () => {
        save.settings.difficulty = b.dataset.v as Difficulty;
        this.refreshSettings();
        this.a.settingsChanged(save.settings, 'difficulty');
      }),
    );
    st.querySelectorAll<HTMLButtonElement>('.un button').forEach((b) =>
      b.addEventListener('click', () => {
        save.settings.units = b.dataset.v as 'kmh' | 'mph';
        this.refreshSettings();
        this.a.settingsChanged(save.settings, 'units');
      }),
    );
  }

  private sliderRow(label: string, key: string) {
    return `<div class="opt"><span class="label">${label.toUpperCase()}</span><div style="display:flex;align-items:center;gap:1rem"><input type="range" class="slider" data-k="${key}" min="0" max="1" step="0.05" data-nav><span class="val" data-v="${key}"></span></div></div>`;
  }

  // ------------------------------------------------------------------ navigation
  show(id: ScreenId) {
    // Never leave focus on a control inside a screen that is about to hide.
    (document.activeElement as HTMLElement | null)?.blur?.();
    for (const [k, el] of this.screens) {
      if (k === 'settings') continue;
      el.classList.toggle('is-active', k === id);
    }
    this.current = id;
    if (id === 'menu') this.refreshMenu();
    if (id === 'garage') this.refreshGarage();
    if (id === 'tracks') this.refreshTracks();
    if (id === 'setup') this.refreshSetup();
    if (id === 'champ') this.refreshChampionship();
    window.setTimeout(() => this.focusFirst(), 60);
  }

  /** Overlay a screen without deactivating the current one (pause over HUD). */
  overlay(id: ScreenId, on: boolean) {
    this.el(id).classList.toggle('is-active', on);
    if (on) window.setTimeout(() => this.focusFirst(id), 60);
  }

  openSettings() {
    this.settingsOpen = true;
    this.refreshSettings();
    this.el('settings').classList.add('is-active');
    window.setTimeout(() => this.focusFirst('settings'), 60);
  }

  closeSettings() {
    this.settingsOpen = false;
    this.el('settings').classList.remove('is-active');
    save.commit();
    window.setTimeout(() => this.focusFirst(), 60);
  }

  private activeRoot(): HTMLElement {
    if (this.settingsOpen) return this.el('settings');
    if (this.el('pause').classList.contains('is-active')) return this.el('pause');
    if (this.current === 'hud') return this.el('hud');
    return this.el(this.current);
  }

  private navItems(root = this.activeRoot()) {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-nav], .car-tile, .track-card:not(.locked)')).filter((e) => e.offsetParent !== null && !(e as HTMLButtonElement).disabled);
  }

  focusFirst(id?: ScreenId) {
    const root = id ? this.el(id) : this.activeRoot();
    const items = this.navItems(root);
    const pref = root.querySelector<HTMLElement>('.btn.primary, .menu-item.primary, .sel') ?? items[0];
    pref?.focus({ preventScroll: true });
  }

  nav(dir: 'up' | 'down' | 'left' | 'right') {
    const items = this.navItems();
    if (!items.length) return;
    const cur = document.activeElement as HTMLElement;
    if (!items.includes(cur)) {
      items[0].focus();
      return;
    }
    if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = Number(cur.step) || 0.05;
      cur.value = String(Number(cur.value) + (dir === 'right' ? step : -step));
      cur.dispatchEvent(new Event('input'));
      return;
    }
    // spatial navigation: nearest element in the requested direction
    const r0 = cur.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - c0.x;
      const dy = c.y - c0.y;
      const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
      if (!ok) continue;
      const primary = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
      const secondary = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      const score = primary + secondary * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      best.focus({ preventScroll: true });
      audio.uiHover();
      if (best.classList.contains('car-tile') || best.classList.contains('track-card')) best.click();
    }
  }

  confirm() {
    const cur = document.activeElement as HTMLElement;
    if (cur && this.navItems().includes(cur)) cur.click();
  }

  // ------------------------------------------------------------------ dynamic content
  refreshMenu() {
    const m = this.el('menu');
    m.querySelector('.cr')!.textContent = save.data.credits.toLocaleString();
    m.querySelector('.tr')!.textContent = String(save.totalTrophies());
    const sea = this.season;
    m.querySelector('.mh-season')!.textContent = sea.name;
    m.querySelector('.mt-season')!.textContent = `${sea.name} · ${sea.gripLabel}`;
    (m.querySelector('[data-m="season"] .ic') as HTMLElement).innerHTML = ICON.season[sea.id];
  }

  refreshGarage() {
    const g = this.el('garage');
    const car = this.selectedCar;
    const owned = save.data.unlockedCars.includes(car.id);
    g.querySelector('.car-name')!.textContent = car.name;
    g.querySelector('.car-team')!.textContent = car.team;
    g.querySelector('.car-tag')!.textContent = car.tagline;
    const cur = PLAYER_CARS.find((c) => c.id === save.data.selectedCar)!;
    const stats: [string, keyof CarDef['stats']][] = [
      ['TOP SPEED', 'topSpeed'],
      ['ACCELERATION', 'acceleration'],
      ['BRAKING', 'braking'],
      ['HANDLING', 'handling'],
    ];
    g.querySelector('.stats')!.innerHTML = stats
      .map(([l, k]) => {
        const v = car.stats[k];
        const base = cur.stats[k];
        return `<div class="stat enter"><div class="row"><span>${l}</span><b>${v}</b></div><div class="bar"><i class="delta" style="transform:scaleX(${Math.max(v, base) / 100})"></i><i style="transform:scaleX(${v / 100})"></i></div></div>`;
      })
      .join('');
    const price = g.querySelector('.price') as HTMLElement;
    const actions = g.querySelector('.actions') as HTMLElement;
    const flow = this.flow !== 'browse';
    if (owned) {
      price.innerHTML = car.id === save.data.selectedCar ? `<span class="label" style="color:var(--green)">SELECTED</span>` : `<span class="label">OWNED</span>`;
      actions.innerHTML = flow ? `<button class="btn primary gsel" data-nav>CONTINUE</button>` : car.id === save.data.selectedCar ? '' : `<button class="btn primary gsel" data-nav>SELECT</button>`;
    } else {
      const can = save.data.credits >= car.price;
      price.innerHTML = `${ICON.coin.replace('<svg', '<svg style="width:1.4rem;height:1.4rem"')}<span>${car.price.toLocaleString()} CR</span>`;
      actions.innerHTML = `<button class="btn primary gbuy" data-nav ${can ? '' : 'disabled'}>${can ? 'BUY' : 'NOT ENOUGH CREDITS'}</button>`;
    }
    actions.querySelector('.gsel')?.addEventListener('click', () => {
      this.a.selectCar(car);
      if (flow) this.a.garageContinue();
      else this.refreshGarage();
    });
    actions.querySelector('.gbuy')?.addEventListener('click', () => this.a.buyCar(car));
    const strip = g.querySelector('.car-strip') as HTMLElement;
    strip.innerHTML = PLAYER_CARS.map((c) => {
      const own = save.data.unlockedCars.includes(c.id);
      return `<button class="car-tile ${c.id === car.id ? 'sel' : ''}" data-id="${c.id}"><div class="sw"><i style="background:${c.livery.primary}"></i><i style="background:${c.livery.secondary}"></i><i style="background:${c.livery.accent}"></i></div><div class="nm">${c.name}</div>${own ? '' : `<span class="lk">${ICON.lock}</span>`}</button>`;
    }).join('');
    strip.querySelectorAll<HTMLElement>('.car-tile').forEach((t) =>
      t.addEventListener('click', () => {
        const def = CARS.find((c) => c.id === t.dataset.id)!;
        if (def.id === this.selectedCar.id) return;
        this.selectedCar = def;
        this.a.previewCar(def);
        this.refreshGarage();
        (g.querySelector(`.car-tile[data-id="${def.id}"]`) as HTMLElement)?.focus({ preventScroll: true });
      }),
    );
    (g.querySelector('.drag-hint') as HTMLElement).style.display = matchMedia('(pointer: coarse)').matches ? 'none' : '';
  }

  refreshTracks() {
    const t = this.el('tracks');
    const grid = t.querySelector('.grid') as HTMLElement;
    const sea = this.season;
    grid.innerHTML = TRACKS.map((def, i) => {
      const unlocked = isTrackUnlocked(def);
      const { d, sx, sy } = trackSVGPath(def);
      const troph = save.data.trophies[def.id] ?? 0;
      const best = save.data.bestLaps[def.id];
            return `<button class="track-card ${unlocked ? '' : 'locked'} ${def.id === this.selectedTrack.id ? 'sel' : ''}" data-i="${i}">
        <div class="wx"></div>
        <div class="meta"><span style="display:flex;align-items:center;gap:.5rem">${ICON.season[sea.id].replace('<svg', '<svg style="width:1.1rem;height:1.1rem"')}${sea.name.toUpperCase()}</span>${trophySVG(troph)}</div>
        <svg class="map" viewBox="0 0 100 100"><path d="${d}" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="5" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f5f7fc" stroke-width="2.4" stroke-linejoin="round"/><circle cx="${sx}" cy="${sy}" r="3.2" fill="var(--accent)"/></svg>
        <div class="tn">${def.name}</div>
        <div class="tl">${def.location.toUpperCase()}</div>
        <div class="meta" style="margin-top:.7rem"><span class="dots">${[1, 2, 3].map((k) => `<i class="${k <= def.difficulty ? 'on' : ''}"></i>`).join('')}</span><span>${best ? 'BEST ' + formatTime(best) : ''}</span></div>
        ${unlocked ? '' : `<div class="lockov"><div>${ICON.lock}PODIUM AT<br>${TRACKS[def.unlockAfter].name}</div></div>`}
      </button>`;
    }).join('');
    grid.querySelectorAll<HTMLElement>('.track-card').forEach((c) =>
      c.addEventListener('click', () => {
        const def = TRACKS[Number(c.dataset.i)];
        if (!isTrackUnlocked(def)) {
          audio.uiBack();
          return;
        }
        // Selecting the already-selected circuit (Enter / A button / second click) continues.
        if (def.id === this.selectedTrack.id && c.classList.contains('sel')) {
          this.a.tracksContinue();
          return;
        }
        this.selectedTrack = def;
        grid.querySelectorAll('.track-card').forEach((x) => x.classList.toggle('sel', x === c));
        this.a.selectTrack(def);
        this.updateTrackInfo();
      }),
    );
    this.updateTrackInfo();
  }

  private updateTrackInfo() {
    const t = this.el('tracks');
    const d = this.selectedTrack;
    t.querySelector('.sel-info')!.innerHTML = `${d.name} · ${this.season.name} · ${this.flow === 'timetrial' ? 'Time trial' : '8 cars'}`;
  }

  refreshSetup() {
    const s = this.el('setup');
    const d = this.selectedTrack;
    s.querySelector('.tname')!.textContent = d.name;
    s.querySelector('.twx')!.innerHTML = `<span class="chip accent">${ICON.season[this.season.id]}${this.season.name}</span> <span class="label" style="margin-left:.6rem">${d.location}</span>`;
    s.querySelectorAll<HTMLElement>('.diff button').forEach((b) => b.classList.toggle('on', b.dataset.v === save.settings.difficulty));
    s.querySelectorAll<HTMLElement>('.laps button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === this.laps));
    s.querySelector('.rl')!.classList.toggle('on', save.settings.racingLine);
    s.querySelector('.diff-desc')!.textContent = DIFF_DESC[save.settings.difficulty];
    s.querySelector('.carname')!.textContent = PLAYER_CARS.find((c) => c.id === save.data.selectedCar)!.name;
  }

  refreshChampionship() {
    const c = this.el('champ');
    const ch = save.data.championship;
    const round = ch.round;
    const done = round >= CHAMPIONSHIP.rounds.length;
    c.querySelector('.croundt')!.textContent = done ? 'SEASON COMPLETE' : `ROUND ${round + 1} OF ${CHAMPIONSHIP.rounds.length}`;
    c.querySelector('.rounds')!.innerHTML = CHAMPIONSHIP.rounds
      .map((id, i) => {
        const t = TRACKS.find((x) => x.id === id)!;
        return `<div class="round ${i < round ? 'done' : i === round ? 'cur' : ''}"><span class="n">${i + 1}</span><span style="flex:1">${t.name}</span><span class="label">${t.location}</span></div>`;
      })
      .join('');
    c.querySelectorAll<HTMLElement>('.cdiff button').forEach((b) => b.classList.toggle('on', b.dataset.v === save.settings.difficulty));
    (c.querySelector('.cgo') as HTMLButtonElement).textContent = done ? 'NEW SEASON' : round === 0 && !ch.active ? 'START SEASON' : `START ROUND ${round + 1}`;
    const rows = Object.entries(ch.points).sort((a, b) => b[1] - a[1]);
    c.querySelector('.standings .table')!.innerHTML = rows.length
      ? rows.map(([n, p], i) => `<tr class="${n === 'YOU' ? 'me' : ''}"><td class="p">${i + 1}</td><td>${n}</td><td class="t">${p} PTS</td></tr>`).join('')
      : `<tr><td class="label">No races completed yet</td></tr>`;
  }

  setBootProgress(p: number, ready: boolean) {
    const b = this.el('boot');
    (b.querySelector('.progress i') as HTMLElement).style.transform = `scaleX(${p})`;
    b.classList.toggle('ready', ready);
    (b.querySelector('.progress') as HTMLElement).style.opacity = ready ? '0' : '1';
  }

  setupLoading(def: TrackDef, difficulty: Difficulty, label: string) {
    const l = this.el('loading');
    const { d } = trackSVGPath(def);
    l.querySelector('.map')!.innerHTML = `<path d="${d}" fill="none" stroke="var(--accent)" stroke-opacity="0.35" stroke-width="5" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f5f7fc" stroke-width="1.6" stroke-linejoin="round"/>`;
    l.querySelector('.tname')!.textContent = def.name;
    l.querySelector('.tloc')!.textContent = def.location.toUpperCase();
    l.querySelector('.rn')!.textContent = label;
    l.querySelector('.chips')!.innerHTML = `<span class="chip accent">${ICON.season[this.season.id]}${this.season.name}</span><span class="chip">${difficulty[0].toUpperCase() + difficulty.slice(1)}</span><span class="chip">${this.flow === 'timetrial' ? 'Time trial' : `${this.laps} laps`}</span>`;
    l.querySelector('.tip')!.innerHTML = `<b>PRO TIP</b>${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
    this.setLoading(0, 'Preparing');
  }

  setLoading(p: number, stage: string) {
    const l = this.el('loading');
    (l.querySelector('.progress i') as HTMLElement).style.transform = `scaleX(${p})`;
    l.querySelector('.stage')!.textContent = stage;
  }

  refreshSettings() {
    const st = this.el('settings');
    const s = save.settings;
    st.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => (i.value = String((s as unknown as Record<string, number>)[i.dataset.k!])));
    st.querySelectorAll<HTMLElement>('.val[data-v]').forEach((v) => {
      const k = v.dataset.v!;
      const n = (s as unknown as Record<string, number>)[k];
      v.textContent = k === 'sensitivity' || k === 'resolutionScale' ? n.toFixed(2) : String(Math.round(n * 100));
    });
    st.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.classList.toggle('on', !!(s as unknown as Record<string, boolean>)[b.dataset.t!]));
    st.querySelectorAll<HTMLElement>('.q button').forEach((b) => b.classList.toggle('on', s.qualityAuto ? b.dataset.v === 'auto' : b.dataset.v === s.quality));
    st.querySelectorAll<HTMLElement>('.sd button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.difficulty));
    st.querySelectorAll<HTMLElement>('.un button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.units));
  }

  showResults(opts: {
    position: number;
    total: number;
    raceTime: number;
    bestLap: number;
    pb: boolean;
    reward: number;
    trophy: number;
    rows: { name: string; color: string; time: string; me: boolean }[];
    nextLabel: string | null;
    title: string;
    timeTrial: boolean;
  }) {
    const r = this.el('results');
    const sfx = (n: number) => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');
    const bp = r.querySelector('.bigpos') as HTMLElement;
    if (opts.timeTrial) {
      bp.innerHTML = `<span style="font-size:6rem">${formatTime(opts.bestLap)}</span>`;
      bp.classList.toggle('podium', opts.trophy === 3);
    } else {
      bp.innerHTML = `${opts.position}<sup>${sfx(opts.position)}</sup>`;
      bp.classList.toggle('podium', opts.position <= 3);
    }
    r.classList.toggle('podium-glow', opts.trophy > 0);
    r.querySelector('.finished')!.textContent = opts.timeTrial ? 'TIME TRIAL COMPLETE' : opts.position === 1 ? 'VICTORY' : 'FINISHED';
    r.querySelector('.rt')!.textContent = formatTime(opts.raceTime);
    const bl = r.querySelector('.bl') as HTMLElement;
    bl.textContent = formatTime(opts.bestLap) + (opts.pb ? '  PB' : '');
    bl.classList.toggle('pb', opts.pb);
    r.querySelector('.rw')!.textContent = `+${opts.reward.toLocaleString()} CR`;
    r.querySelector('.tsvg')!.innerHTML = trophySVG(opts.trophy);
    r.querySelector('.tn')!.textContent = ['NONE', 'BRONZE', 'SILVER', 'GOLD'][opts.trophy];
    (r.querySelector('.tn') as HTMLElement).style.color = ['var(--grey)', 'var(--bronze)', 'var(--silver)', 'var(--gold)'][opts.trophy];
    r.querySelector('.rtitle')!.textContent = opts.title;
    r.querySelector('.right .table')!.innerHTML = opts.rows
      .map((row, i) => `<tr class="${row.me ? 'me' : ''}"><td class="p">${i + 1}</td><td class="sw"><i style="background:${row.color}"></i></td><td>${row.name}</td><td class="t">${row.time}</td></tr>`)
      .join('');
    const next = r.querySelector('.rnext') as HTMLButtonElement;
    next.style.display = opts.nextLabel ? '' : 'none';
    if (opts.nextLabel) next.textContent = opts.nextLabel;
    this.show('results');
  }
}
