import { RenderPipeline, detectQuality } from './Renderer';
import { InputManager } from './InputManager';
import { audio } from './AudioManager';
import { save, type Settings } from './SaveService';
import { configureTextures } from './Textures';
import { Screens, isTrackUnlocked } from '../ui/Screens';
import { HUD } from '../ui/HUD';
import { SplashScene } from '../scenes/SplashScene';
import { GarageScene } from '../scenes/GarageScene';
import { buildWorld, type World } from '../race/World';
import { RaceSession, type RaceConfig, type RaceMode } from '../race/RaceSession';
import { CARS, PLAYER_CARS, getCar, type CarDef } from '../data/cars';
import { TRACKS, CHAMPIONSHIP, getTrack, type TrackDef } from '../data/tracks';
import { PHYS } from '../track/Track';
import { getSeason, applySeasonTheme, type SeasonDef } from '../data/seasons';
import { formatTime, wait, nextFrame } from './utils';

export type GameState = 'BOOT' | 'SEASON' | 'SPLASH' | 'MAIN_MENU' | 'GARAGE' | 'TRACK_SELECT' | 'SETUP' | 'CHAMPIONSHIP' | 'LOADING' | 'RACE' | 'PAUSED' | 'RESULTS';

type ActiveScene = 'none' | 'splash' | 'garage' | 'race';

/**
 * Top-level orchestrator: owns the render pipeline, the explicit game state machine and every
 * transition between scenes. Only one 3D scene is ever simulated at a time.
 */
export class Game {
  readonly pipeline: RenderPipeline;
  readonly input = new InputManager();
  readonly ui: Screens;
  readonly hud: HUD;
  private splash: SplashScene | null = null;
  private garage!: GarageScene;
  private world: World | null = null;
  private session: RaceSession | null = null;
  private cfg: RaceConfig | null = null;
  state: GameState = 'BOOT';
  private active: ActiveScene = 'none';
  private last = performance.now();
  private time = 0;
  private transitioning = false;
  private pendingConfirm = false;
  private tutorialT = -1;
  private introVisible = false;
  private tutorialActive = false;
  private seasonFrom: 'boot' | 'menu' = 'boot';

  constructor() {
    const stage = document.getElementById('stage')!;
    this.pipeline = new RenderPipeline(stage);
    const s = save.settings;
    if (s.qualityAuto) s.quality = detectQuality(this.pipeline.renderer);
    this.pipeline.setQuality(s.quality, s.resolutionScale);
    configureTextures(this.pipeline.renderer, s.quality);
    document.body.classList.toggle('is-touch', this.input.isTouch);
    applySeasonTheme(getSeason(save.data.season));

    this.ui = new Screens({
      bootStart: () => this.bootStart(),
      seasonConfirm: (d) => this.seasonConfirm(d),
      play: () => this.play(),
      menu: (m) => this.menu(m),
      back: () => this.back(),
      previewCar: (d) => this.garage.setCar(d),
      selectCar: (d) => this.selectCar(d),
      buyCar: (d) => this.buyCar(d),
      garageContinue: () => this.garageContinue(),
      selectTrack: () => {},
      tracksContinue: () => this.tracksContinue(),
      startRace: () => this.startRace(),
      startChampionshipRound: () => this.startChampionshipRound(),
      resetChampionship: () => {
        save.data.championship = { round: 0, points: {}, active: false };
        save.commit();
        this.ui.refreshChampionship();
      },
      resume: () => this.resume(),
      restart: () => this.restart(),
      quitToMenu: () => this.quitToMenu(),
      openSettings: () => this.ui.openSettings(),
      closeSettings: () => this.ui.closeSettings(),
      settingsChanged: (st, k) => this.settingsChanged(st, k),
      retry: () => this.restart(),
      nextRace: () => this.nextRace(),
    });
    this.hud = new HUD(this.ui.root, this.input, () => this.pause());
    this.ui.registerHUD(this.hud.el);
    this.hud.units = s.units;
    this.ui.selectedCar = getCar(save.data.selectedCar);

    this.input.on('camera', () => this.session && this.state === 'RACE' && this.session.cycleCamera());
    this.input.on('reset', () => this.session && this.state === 'RACE' && this.session.resetPlayer());
    this.input.on('pause', () => {
      if (this.ui.settingsOpen) this.ui.closeSettings();
      else if (this.state === 'RACE') this.pause();
      else if (this.state === 'PAUSED') this.resume();
      else this.back();
    });
    this.input.on('back', () => {
      if (this.ui.settingsOpen) this.ui.closeSettings();
      else if (this.state === 'PAUSED') this.resume();
      else if (this.state !== 'RACE') this.back();
    });
    this.input.on('confirm', () => {
      if (this.transitioning) {
        // buffer the press so it isn't lost while a scene transition is still running
        this.pendingConfirm = true;
        return;
      }
      if (this.state === 'RACE') this.session?.skipIntro();
      else if (this.state !== 'BOOT' && this.state !== 'LOADING') this.ui.confirm();
    });
    for (const d of ['up', 'down', 'left', 'right'] as const) {
      this.input.on(d, () => {
        if (this.state !== 'RACE' && this.state !== 'BOOT' && this.state !== 'LOADING') this.ui.nav(d);
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && this.state !== 'BOOT') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => {});
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'RACE') this.pause();
    });
  }

  async start() {
    this.ui.show('boot');
    this.ui.setBootProgress(0.15, false);
    this.garage = new GarageScene(this.pipeline);
    this.garage.setCar(getCar(save.data.selectedCar));
    this.garage.applySeason(getSeason(save.data.season));
    requestAnimationFrame((t) => this.loop(t));
    this.ui.setBootProgress(0.5, false);
    try {
      this.garage.activate('menu');
      await this.pipeline.renderer.compileAsync(this.garage.scene, this.garage.camera);
    } catch {
      /* lazy compile fallback */
    }
    this.garage.deactivate();
    this.ui.setBootProgress(1, true);
  }

  // ------------------------------------------------------------------ transitions
  private async wipe(fn: () => void | Promise<void>) {
    // Serialise transitions: a request during a running wipe waits for it instead of interleaving.
    while (this.transitioning) await wait(40);
    this.transitioning = true;
    const w = document.getElementById('wipe')!;
    audio.whoosh();
    w.className = 'cover';
    await wait(470);
    w.className = 'covered';
    await fn();
    await nextFrame();
    await nextFrame();
    w.className = 'reveal';
    await wait(520);
    w.className = '';
    this.transitioning = false;
    if (this.pendingConfirm) {
      this.pendingConfirm = false;
      window.setTimeout(() => {
        if (this.state === 'RACE') this.session?.skipIntro();
        else if (this.state !== 'LOADING' && this.state !== 'BOOT') this.ui.confirm();
      }, 80);
    }
  }

  private fade(on: boolean) {
    document.getElementById('fade')!.classList.toggle('on', on);
  }

  // ------------------------------------------------------------------ flow
  private bootStart() {
    audio.init();
    audio.applySettings(save.settings);
    const fadeEl = document.getElementById('fade')!;
    fadeEl.style.transition = 'none';
    this.fade(true);
    void fadeEl.offsetWidth;
    fadeEl.style.transition = '';
    this.openSeason('boot');
    requestAnimationFrame(() => this.fade(false));
    audio.music?.play('menu');
    if (audio.music) audio.music.intensity = 0;
  }

  /** Season & environment selection: first step of the experience, also reachable from the menu. */
  private openSeason(from: 'boot' | 'menu') {
    this.seasonFrom = from;
    this.state = 'SEASON';
    if (from === 'menu') this.garage.deactivate();
    this.active = 'none';
    this.ui.openSeasonScreen(from);
  }

  private async seasonConfirm(def: SeasonDef) {
    if (this.state !== 'SEASON' || this.transitioning || this.ui.seasonBusy) return;
    save.data.season = def.id;
    save.commit();
    applySeasonTheme(def);
    this.garage.applySeason(def);
    audio.whoosh(0.15);
    if (this.seasonFrom === 'menu') {
      this.wipe(() => {
        this.ui.closeSeasonScreen();
        this.toMenu();
      });
      return;
    }
    // Build the key-art scene for the chosen season; progress lives on the CTA itself.
    this.ui.setSeasonProgress(0.06, `Preparing ${def.title}…`);
    this.splash?.dispose();
    this.splash = new SplashScene(this.pipeline, def);
    await this.splash.load((p) => this.ui.setSeasonProgress(0.06 + p * 0.84, `Preparing ${def.title}…`));
    this.splash.activate();
    this.splash.started = false;
    try {
      await this.pipeline.renderer.compileAsync(this.splash.world.scene, this.splash.camera);
    } catch {
      /* lazy compile fallback */
    }
    this.ui.setSeasonProgress(1, `Ready`);
    await wait(150);
    this.wipe(() => {
      this.ui.closeSeasonScreen();
      this.showSplash(def);
    });
  }

  private showSplash(def: SeasonDef) {
    this.state = 'SPLASH';
    const sp = this.ui.el('splash');
    sp.querySelector('.sp-season')!.textContent = `${def.name} · ${def.title}`;
    this.ui.show('splash');
    this.splash!.activate();
    this.active = 'splash';
    // logo + light streak at 1.1 s, PLAY at 1.9 s
    sp.classList.remove('show-logo', 'show-play');
    window.setTimeout(() => sp.classList.add('show-logo'), 1100);
    window.setTimeout(() => {
      sp.classList.add('show-play');
      this.ui.focusFirst('splash');
    }, 1900);
  }

  private play() {
    if (this.state !== 'SPLASH') return;
    this.wipe(() => {
      this.splash?.deactivate();
      this.splash?.dispose();
      this.splash = null;
      audio.silenceLoops();
      this.toMenu();
    });
  }

  private toMenu() {
    this.garage.setCar(getCar(save.data.selectedCar));
    this.garage.activate('menu');
    this.active = 'garage';
    this.state = 'MAIN_MENU';
    this.ui.flow = 'browse';
    this.ui.show('menu');
    audio.music?.play('menu');
    if (audio.music) audio.music.intensity = 1;
  }

  private menu(item: 'race' | 'championship' | 'timetrial' | 'garage' | 'settings' | 'season') {
    if (this.state !== 'MAIN_MENU' || this.transitioning) return;
    if (item === 'settings') {
      this.ui.openSettings();
      return;
    }
    if (item === 'season') {
      this.wipe(() => this.openSeason('menu'));
      return;
    }
    this.ui.flow = item === 'garage' ? 'browse' : item;
    this.ui.selectedCar = getCar(save.data.selectedCar);
    this.garage.setCar(this.ui.selectedCar);
    this.garage.setMode('garage');
    this.state = 'GARAGE';
    this.ui.show('garage');
  }

  private back() {
    if (this.transitioning) return;
    switch (this.state) {
      case 'SEASON':
        if (this.seasonFrom === 'menu' && !this.ui.seasonBusy)
          this.wipe(() => {
            this.ui.closeSeasonScreen();
            this.applySavedSeason();
            this.toMenu();
          });
        break;
      case 'GARAGE':
        this.garage.setCar(getCar(save.data.selectedCar));
        this.garage.setMode('menu');
        this.state = 'MAIN_MENU';
        this.ui.flow = 'browse';
        this.ui.show('menu');
        break;
      case 'TRACK_SELECT':
      case 'CHAMPIONSHIP':
        this.garage.setMode('garage');
        this.state = 'GARAGE';
        this.ui.show('garage');
        break;
      case 'SETUP':
        this.state = 'TRACK_SELECT';
        this.ui.show('tracks');
        break;
      case 'RESULTS':
        this.quitToMenu();
        break;
    }
  }

  /** Leaving the season screen without confirming restores the saved season theme. */
  private applySavedSeason() {
    applySeasonTheme(getSeason(save.data.season));
  }

  private selectCar(d: CarDef) {
    save.data.selectedCar = d.id;
    save.commit();
  }

  private buyCar(d: CarDef) {
    if (save.data.credits < d.price || save.data.unlockedCars.includes(d.id)) return;
    save.data.credits -= d.price;
    save.data.unlockedCars.push(d.id);
    save.data.selectedCar = d.id;
    save.commit();
    audio.sting(true);
    this.ui.refreshGarage();
  }

  private garageContinue() {
    if (this.state !== 'GARAGE') return;
    if (!save.data.unlockedCars.includes(this.ui.selectedCar.id)) return;
    save.data.selectedCar = this.ui.selectedCar.id;
    save.commit();
    this.garage.setMode('select');
    if (this.ui.flow === 'championship') {
      this.state = 'CHAMPIONSHIP';
      this.ui.show('champ');
    } else {
      if (!isTrackUnlocked(this.ui.selectedTrack)) this.ui.selectedTrack = TRACKS[0];
      this.state = 'TRACK_SELECT';
      this.ui.show('tracks');
    }
  }

  private tracksContinue() {
    if (this.state !== 'TRACK_SELECT') return;
    if (!isTrackUnlocked(this.ui.selectedTrack)) return;
    if (this.ui.flow === 'timetrial') this.startRace();
    else {
      this.state = 'SETUP';
      this.ui.show('setup');
    }
  }

  private startRace() {
    if (this.state !== 'SETUP' && this.state !== 'TRACK_SELECT') return;
    const mode: RaceMode = this.ui.flow === 'timetrial' ? 'timetrial' : this.ui.flow === 'championship' ? 'championship' : 'race';
    const track = this.ui.selectedTrack;
    this.loadRace({
      track,
      carId: save.data.selectedCar,
      mode,
      difficulty: save.settings.difficulty,
      laps: mode === 'timetrial' ? 3 : this.ui.laps,
      ghost: mode === 'timetrial' ? save.data.ghosts[track.id] ?? null : null,
    });
  }

  private startChampionshipRound() {
    if (this.state !== 'CHAMPIONSHIP' && this.state !== 'RESULTS') return;
    const ch = save.data.championship;
    if (ch.round >= CHAMPIONSHIP.rounds.length) {
      save.data.championship = { round: 0, points: {}, active: false };
    }
    save.data.championship.active = true;
    save.commit();
    const track = getTrack(CHAMPIONSHIP.rounds[save.data.championship.round]);
    this.ui.selectedTrack = track;
    this.loadRace({ track, carId: save.data.selectedCar, mode: 'championship', difficulty: save.settings.difficulty, laps: 3 });
  }

  private loadRace(cfg: RaceConfig) {
    if (this.state === 'LOADING') return;
    this.state = 'LOADING';
    this.cfg = cfg;
    this.wipe(async () => {
      this.state = 'LOADING';
      this.disposeRace();
      this.garage.deactivate();
      this.active = 'none';
      audio.music?.play('off');
      const label = cfg.mode === 'championship' ? `${save.data.championship.round + 1} · ${CHAMPIONSHIP.name}` : cfg.mode === 'timetrial' ? 'TIME TRIAL' : 'SINGLE RACE';
      this.ui.flow = cfg.mode === 'timetrial' ? 'timetrial' : cfg.mode === 'championship' ? 'championship' : 'race';
      this.ui.setupLoading(cfg.track, cfg.difficulty, label);
      this.ui.show('loading');
    }).then(async () => {
      await wait(250);
      const t0 = performance.now();
      this.world = await buildWorld(cfg.track, getSeason(save.data.season), this.pipeline, (p, stage) => this.ui.setLoading(p * 0.92, stage));
      this.createSession();
      try {
        await this.pipeline.renderer.compileAsync(this.world.scene, this.session!.camera);
      } catch {
        /* lazy compile fallback */
      }
      this.ui.setLoading(1, 'Ready');
      // never flash the loader: give it a minimum on-screen time
      const elapsed = performance.now() - t0;
      if (elapsed < 1400) await wait(1400 - elapsed);
      await wait(250);
      this.fade(true);
      await wait(500);
      this.beginRace();
      this.fade(false);
    });
  }

  private createSession() {
    if (!this.world || !this.cfg) return;
    this.world.particles.clear();
    this.session = new RaceSession(this.world, this.cfg, this.pipeline, save.settings, {
      countdown: (n) => {
        this.hud.countdown(n);
        if (this.tutorialActive) this.hud.tutorial(true);
      },
      go: () => {
        this.hud.countdown(0);
        this.hud.showMain(true);
      },
      overtake: (from, to) => this.hud.position(from, to),
      finalLap: () => this.hud.showBanner('<span class="accent">FINAL</span> LAP'),
      lap: (t, best) => {
        if (best && this.session && this.session.player.laps > 1) this.hud.showToast(`BEST LAP  ${formatTime(t)}`);
      },
      finished: () => {
        this.hud.showBanner(this.session!.player.position === 1 && this.cfg!.mode !== 'timetrial' ? '<span class="accent">VICTORY</span>' : 'FINISH');
        window.setTimeout(() => this.hud.showMain(false), 900);
        audio.music?.play('off');
      },
      results: () => this.showResults(),
      wrongWay: (on) => this.hud.setWrongWay(on),
    });
    const sea = getSeason(save.data.season);
    const sub = `${this.cfg.track.location.toUpperCase()} · ${sea.name.toUpperCase()}`;
    this.hud.setupTrack(this.world.track, this.session.cars.length, this.cfg.laps, this.cfg.track.name, sub);
    this.pipeline.setScene(this.world.scene, this.session.camera);
    this.pipeline.applyPreset(this.world.preset);
    const fu = this.pipeline.final.uniforms;
    fu.uDim.value = 0;
    fu.uBlur.value = 0;
  }

  private beginRace() {
    this.active = 'race';
    this.state = 'RACE';
    this.ui.show('hud');
    this.hud.setIntro(true);
    this.introVisible = true;
    this.hud.showMain(false);
    this.tutorialActive = !save.data.tutorialSeen;
    this.tutorialT = -1;
    audio.music?.play('race');
    if (audio.music) audio.music.intensity = 0;
  }

  private pause() {
    if (this.state !== 'RACE' || !this.session || this.session.phase === 'done') return;
    this.state = 'PAUSED';
    this.ui.overlay('pause', true);
    audio.silenceLoops();
    audio.uiClick();
  }

  private resume() {
    if (this.state !== 'PAUSED') return;
    this.ui.overlay('pause', false);
    this.state = 'RACE';
    this.last = performance.now();
  }

  private restart() {
    if (!this.world || !this.cfg || (this.state !== 'PAUSED' && this.state !== 'RESULTS')) return;
    this.wipe(() => {
      this.ui.overlay('pause', false);
      this.session?.dispose();
      this.session = null;
      if (this.cfg!.mode === 'timetrial') this.cfg!.ghost = save.data.ghosts[this.cfg!.track.id] ?? null;
      this.createSession();
      this.session!.skipIntro();
      this.beginRace();
      this.hud.setIntro(false);
      this.introVisible = false;
    });
  }

  private quitToMenu() {
    if (this.state !== 'PAUSED' && this.state !== 'RESULTS') return;
    this.wipe(() => {
      this.ui.overlay('pause', false);
      this.disposeRace();
      audio.silenceLoops();
      this.toMenu();
    });
  }

  private nextRace() {
    if (!this.cfg || this.state !== 'RESULTS') return;
    if (this.cfg.mode === 'championship') {
      if (save.data.championship.round < CHAMPIONSHIP.rounds.length) this.startChampionshipRound();
      else this.quitToMenu();
      return;
    }
    const idx = TRACKS.findIndex((t) => t.id === this.cfg!.track.id);
    for (let k = 1; k <= TRACKS.length; k++) {
      const t = TRACKS[(idx + k) % TRACKS.length];
      if (isTrackUnlocked(t)) {
        this.ui.selectedTrack = t;
        this.loadRace({ ...this.cfg, track: t, ghost: this.cfg.mode === 'timetrial' ? save.data.ghosts[t.id] ?? null : null });
        return;
      }
    }
  }

  private disposeRace() {
    this.session?.dispose();
    this.session = null;
    this.world?.dispose();
    this.world = null;
    this.hud.setWrongWay(false);
  }

  // ------------------------------------------------------------------ results & progression
  private referenceLap(track: TrackDef) {
    if (!this.world) return 90;
    const tr = this.world.track;
    let t = 0;
    for (let i = 0; i < tr.N; i++) t += tr.ds / Math.max(8, tr.profile[i]);
    return t * 1.04;
  }

  private showResults() {
    const s = this.session!;
    const cfg = this.cfg!;
    const pl = s.player;
    this.state = 'RESULTS';
    const tt = cfg.mode === 'timetrial';
    const rows = s.results();
    const pos = tt ? 1 : rows.findIndex((r) => r.car.isPlayer) + 1;
    let trophy = 0;
    if (tt) {
      const ref = this.referenceLap(cfg.track) * (save.settings.difficulty === 'rookie' ? 1.06 : save.settings.difficulty === 'expert' ? 0.98 : 1.02);
      trophy = pl.bestLap <= ref ? 3 : pl.bestLap <= ref * 1.04 ? 2 : pl.bestLap <= ref * 1.09 ? 1 : 0;
    } else trophy = pos === 1 ? 3 : pos === 2 ? 2 : pos === 3 ? 1 : 0;
    const diffMul = cfg.difficulty === 'rookie' ? 0.8 : cfg.difficulty === 'expert' ? 1.45 : 1;
    const base = tt ? [0, 900, 1500, 2400][trophy] + 400 : [3200, 2400, 1900, 1400, 1100, 900, 700, 500][pos - 1] * (cfg.laps / 3);
    const pb = save.recordLap(cfg.track.id, pl.bestLap);
    let reward = Math.round((base * diffMul + (pb ? 500 : 0)) / 10) * 10;
    save.awardTrophy(cfg.track.id, trophy as 0 | 1 | 2 | 3);
    if (tt && pb && s.bestGhost && s.bestGhost.length > 8) save.data.ghosts[cfg.track.id] = s.bestGhost;
    const prevRace = save.data.bestRaceTimes[cfg.track.id];
    if (!tt && pl.finishTime && (!prevRace || pl.finishTime < prevRace)) save.data.bestRaceTimes[cfg.track.id] = pl.finishTime;
    if (!save.data.tutorialSeen) save.data.tutorialSeen = true;

    let title = 'CLASSIFICATION';
    let nextLabel: string | null = tt ? null : 'NEXT RACE';
    let tableRows = rows.map((r, i) => ({
      name: r.car.name,
      color: r.car.color,
      time: i === 0 ? formatTime(r.time) : `+${(r.time - rows[0].time).toFixed(3)}`,
      me: r.car.isPlayer,
    }));
    if (tt) {
      title = 'LAP TIMES';
      const laps = [pl.bestLap, save.data.bestLaps[cfg.track.id]];
      tableRows = [
        { name: 'THIS SESSION', color: pl.color, time: formatTime(laps[0]), me: true },
        { name: 'PERSONAL BEST', color: '#c084fc', time: formatTime(laps[1]), me: false },
        { name: 'GOLD TARGET', color: '#f5c84c', time: formatTime(this.referenceLap(cfg.track) * 1.02), me: false },
      ];
    }
    if (cfg.mode === 'championship') {
      const ch = save.data.championship;
      rows.forEach((r, i) => {
        ch.points[r.car.name] = (ch.points[r.car.name] ?? 0) + (CHAMPIONSHIP.points[i] ?? 0);
      });
      ch.round++;
      title = `ROUND ${ch.round} · +${CHAMPIONSHIP.points[pos - 1] ?? 0} PTS`;
      if (ch.round >= CHAMPIONSHIP.rounds.length) {
        const standings = Object.entries(ch.points).sort((a, b) => b[1] - a[1]);
        const champPos = standings.findIndex(([n]) => n === 'YOU') + 1;
        reward += champPos === 1 ? 10000 : champPos === 2 ? 6000 : champPos === 3 ? 4000 : 1500;
        title = `FINAL STANDINGS · P${champPos} IN CHAMPIONSHIP`;
        tableRows = standings.map(([n, p]) => ({ name: n, color: n === 'YOU' ? pl.color : '#5d636c', time: `${p} PTS`, me: n === 'YOU' }));
        ch.active = false;
        nextLabel = null;
      } else nextLabel = 'NEXT ROUND';
    }
    save.data.credits += reward;
    save.commit();
    audio.sting(trophy > 0);
    this.ui.showResults({
      position: pos,
      total: s.cars.length,
      raceTime: pl.finishTime,
      bestLap: pl.bestLap,
      pb,
      reward,
      trophy,
      rows: tableRows,
      nextLabel,
      title,
      timeTrial: tt,
    });
  }

  private settingsChanged(s: Settings, key: keyof Settings) {
    if (['master', 'music', 'engine', 'effects'].includes(key)) audio.applySettings(s);
    if (key === 'quality' || key === 'resolutionScale') {
      if (s.qualityAuto) s.quality = detectQuality(this.pipeline.renderer);
      this.pipeline.setQuality(s.quality, s.resolutionScale);
      configureTextures(this.pipeline.renderer, s.quality);
      if (this.active === 'race' && this.session && this.world) {
        this.pipeline.setScene(this.world.scene, this.session.camera);
        this.pipeline.applyPreset(this.world.preset);
      } else if (this.active === 'garage') this.garage.activate(this.garage.mode);
      else if (this.active === 'splash' && this.splash) this.splash.activate();
    }
    if (key === 'units') this.hud.units = s.units;
    if (key === 'sensitivity' && this.session && this.cfg) this.session.player.phys.params.steer = getCar(this.cfg.carId).physics.steer * s.sensitivity;
    this.session?.applySettings(s);
    save.commit();
  }

  // ------------------------------------------------------------------ main loop
  private loop(now: number) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.input.update(dt, save.settings.sensitivity);

    switch (this.active) {
      case 'splash':
        this.splash?.update(dt);
        break;
      case 'garage':
        this.garage.update(dt);
        break;
      case 'race':
        if (this.session && this.state !== 'PAUSED') {
          this.session.update(dt, this.input.drive);
          this.hud.update(this.session);
          if (this.introVisible && this.session.phase !== 'intro') {
            this.introVisible = false;
            this.hud.setIntro(false);
            this.hud.showMain(true);
          }
          this.updateTutorial(dt);
        }
        break;
    }
    if (this.active !== 'none') this.pipeline.render(dt, this.time);
  }

  private updateTutorial(dt: number) {
    if (!this.tutorialActive || !this.session) return;
    if (this.session.phase === 'racing' && this.input.drive.throttle > 0.5 && this.tutorialT < 0) this.tutorialT = 0;
    if (this.tutorialT >= 0) {
      this.tutorialT += dt;
      if (this.tutorialT > 2.5) {
        this.hud.tutorial(false);
        this.tutorialActive = false;
        save.data.tutorialSeen = true;
        save.commit();
      }
    }
  }
}

// Re-export for convenience in debugging consoles
export { CARS, PLAYER_CARS, PHYS };
