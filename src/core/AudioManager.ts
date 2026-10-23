import { clamp } from './utils';
import type { Settings } from './SaveService';

/**
 * Fully procedural audio: layered engine synthesis, environmental loops, one-shot SFX and a
 * small step-sequenced soundtrack. No external audio assets are required.
 */

class EngineVoice {
  private oscMain: OscillatorNode;
  private oscHigh: OscillatorNode;
  private oscSub: OscillatorNode;
  private gMain: GainNode;
  private gHigh: GainNode;
  private gSub: GainNode;
  private mech: AudioBufferSourceNode;
  private mechFilter: BiquadFilterNode;
  private gMech: GainNode;
  private filter: BiquadFilterNode;
  private shaper: WaveShaperNode;
  readonly out: GainNode;
  readonly panner: StereoPannerNode;
  private lfo: OscillatorNode;
  private lastThrottle = 0;
  private crackleCooldown = 0;

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, private am: AudioManager) {
    const c = ctx;
    // Harmonic stack voiced like a high-revving turbo V6: strong fundamental, buzzy odd partials.
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      imag[i] = (i % 2 ? 1 : 0.55) / Math.pow(i, 0.85);
      if (i === 3 || i === 6) imag[i] *= 1.6;
    }
    const wave = c.createPeriodicWave(real, imag);
    this.oscMain = c.createOscillator();
    this.oscMain.setPeriodicWave(wave);
    this.oscHigh = c.createOscillator();
    this.oscHigh.type = 'sawtooth';
    this.oscSub = c.createOscillator();
    this.oscSub.type = 'triangle';
    this.gMain = c.createGain();
    this.gHigh = c.createGain();
    this.gSub = c.createGain();
    this.gMain.gain.value = 0.5;
    this.gHigh.gain.value = 0;
    this.gSub.gain.value = 0.3;

    this.mech = c.createBufferSource();
    this.mech.buffer = noise;
    this.mech.loop = true;
    this.mechFilter = c.createBiquadFilter();
    this.mechFilter.type = 'bandpass';
    this.mechFilter.Q.value = 3;
    this.gMech = c.createGain();
    this.gMech.gain.value = 0;

    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    this.shaper.curve = curve;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.4;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.panner = c.createStereoPanner();

    // Subtle frequency jitter makes the tone feel mechanical rather than synthetic.
    this.lfo = c.createOscillator();
    this.lfo.frequency.value = 7.3;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 3;
    this.lfo.connect(lfoGain);
    lfoGain.connect(this.oscMain.detune);
    lfoGain.connect(this.oscHigh.detune);

    this.oscMain.connect(this.gMain).connect(this.shaper);
    this.oscHigh.connect(this.gHigh).connect(this.shaper);
    this.oscSub.connect(this.gSub).connect(this.shaper);
    this.mech.connect(this.mechFilter).connect(this.gMech).connect(this.filter);
    this.shaper.connect(this.filter).connect(this.out).connect(this.panner).connect(dest);

    this.oscMain.start();
    this.oscHigh.start();
    this.oscSub.start();
    this.mech.start();
    this.lfo.start();
  }

  /** rpm 0..1 normalised (idle≈0.3, redline≈1). */
  set(rpm01: number, throttle: number, volume: number, dt: number) {
    const t = this.ctx.currentTime;
    const rpm = 3800 + rpm01 * 8600;
    const f = (rpm / 60) * 3 * 0.5; // half firing frequency keeps it in a rich register
    const tc = 0.025;
    this.oscMain.frequency.setTargetAtTime(f, t, tc);
    this.oscHigh.frequency.setTargetAtTime(f * 2.001, t, tc);
    this.oscSub.frequency.setTargetAtTime(f * 0.5, t, tc);
    this.mechFilter.frequency.setTargetAtTime(f * 4.2, t, tc);
    const hi = clamp((rpm01 - 0.45) / 0.55, 0, 1);
    this.gMain.gain.setTargetAtTime(0.42 + throttle * 0.12, t, 0.05);
    this.gHigh.gain.setTargetAtTime(hi * hi * (0.1 + throttle * 0.16), t, 0.05);
    this.gSub.gain.setTargetAtTime(0.32 * (1 - hi * 0.7), t, 0.05);
    this.gMech.gain.setTargetAtTime(0.05 + hi * 0.25 * throttle, t, 0.05);
    const cutoff = 700 + rpm01 * 3200 + throttle * 2600;
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.04);
    this.out.gain.setTargetAtTime(volume * (0.55 + throttle * 0.45), t, 0.05);

    // Overrun crackle when lifting at high rpm.
    this.crackleCooldown -= dt;
    if (this.lastThrottle > 0.7 && throttle < 0.2 && rpm01 > 0.55 && this.crackleCooldown <= 0 && volume > 0.05) {
      this.am.crackle(volume);
      this.crackleCooldown = 0.6;
    }
    this.lastThrottle = throttle;
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.1);
  }
}

class NoiseLoop {
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  constructor(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, type: BiquadFilterType, freq: number, q: number) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(dest);
    src.start(ctx.currentTime + Math.random() * 0.5);
  }
  set(g: number, ctx: AudioContext, tc = 0.08) {
    this.gain.gain.setTargetAtTime(g, ctx.currentTime, tc);
  }
}

type MusicStyle = 'off' | 'menu' | 'race';

class Music {
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  style: MusicStyle = 'off';
  intensity = 0;
  private bus: GainNode;
  private padGain: GainNode;
  constructor(private ctx: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.6;
    this.padGain.connect(this.bus);
    this.bus.connect(dest);
  }

  play(style: MusicStyle) {
    if (style === this.style) return;
    this.style = style;
    const t = this.ctx.currentTime;
    if (style === 'off') {
      this.bus.gain.setTargetAtTime(0, t, 0.4);
      return;
    }
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(style === 'race' ? 0.36 : 0.8, t, 0.6);
    if (this.timer === null) {
      this.step = 0;
      this.nextTime = t + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  private get bpm() {
    return this.style === 'race' ? 132 : 122;
  }

  private schedule() {
    if (this.style === 'off' && this.bus.gain.value < 0.001) {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    const spb = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 256;
    }
  }

  private playStep(step: number, t: number) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const roots = [55, 43.65, 65.41, 49]; // A, F, C, G
    const chords = [
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
      [261.63, 329.63, 392],
      [196, 246.94, 293.66],
    ];
    const root = roots[bar];
    const race = this.style === 'race';
    const hi = this.intensity > 0.5 || !race;
    if (s16 % 4 === 0) this.kick(t);
    if (s16 === 4 || s16 === 12) this.clap(t, race ? 0.18 : 0.26);
    if (hi && s16 % 2 === 1) this.hat(t, 0.06);
    if (this.intensity > 0.9 && s16 % 2 === 0) this.hat(t, 0.025);
    if (s16 % 2 === 1 || (s16 === 0 && bar === 0)) this.bass(t, root * (s16 === 7 || s16 === 15 ? 2 : 1));
    if (s16 === 0) this.pad(t, chords[bar], (60 / this.bpm) * 4);
    if (hi && !(race && this.intensity < 0.5)) {
      const ch = chords[bar];
      const arpNote = ch[[0, 1, 2, 1, 2, 0, 1, 2][s16 % 8]] * (s16 >= 8 ? 2 : 1);
      this.pluck(t, arpNote, race ? 0.035 : 0.05);
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.9, 0.003, 0.28);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.35);
    // Sidechain-style pump on the pad
    this.padGain.gain.setValueAtTime(0.25, t);
    this.padGain.gain.linearRampToValueAtTime(0.6, t + 0.22);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, decay: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.002, decay);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 1.5);
    s.stop(t + decay + 0.05);
  }

  private clap(t: number, v: number) {
    this.noiseHit(t, 'bandpass', 1500, v, 0.16);
  }
  private hat(t: number, v: number) {
    this.noiseHit(t, 'highpass', 8000, v, 0.045);
  }

  private bass(t: number, f: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 6;
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(140, t + 0.14);
    const g = this.ctx.createGain();
    this.env(g, t, 0.32, 0.004, 0.16);
    o.connect(filt).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.22);
  }

  private pad(t: number, notes: number[], dur: number) {
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = n;
        o.detune.value = det;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1100;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 0.5);
        g.gain.setValueAtTime(0.028, t + dur - 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(this.padGain);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private pluck(t: number, f: number, v: number) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(3200, t);
    filt.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g, t, v, 0.003, 0.13);
    o.connect(filt).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.18);
  }
}

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private engineBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  engine!: EngineVoice;
  rival!: EngineVoice;
  wind!: NoiseLoop;
  tyre!: NoiseLoop;
  offroad!: NoiseLoop;
  rain!: NoiseLoop;
  crowd!: NoiseLoop;
  ambience!: NoiseLoop;
  private curbOsc!: OscillatorNode;
  private curbGain!: GainNode;
  music!: Music;
  ready = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.engineBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.engineBus.connect(this.master);
    this.sfxBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.engine = new EngineVoice(ctx, this.engineBus, this.noise, this);
    this.rival = new EngineVoice(ctx, this.engineBus, this.noise, this);
    this.wind = new NoiseLoop(ctx, this.sfxBus, this.noise, 'bandpass', 500, 0.6);
    this.tyre = new NoiseLoop(ctx, this.sfxBus, this.noise, 'bandpass', 1250, 9);
    this.offroad = new NoiseLoop(ctx, this.sfxBus, this.noise, 'lowpass', 300, 0.8);
    this.rain = new NoiseLoop(ctx, this.sfxBus, this.noise, 'highpass', 2600, 0.5);
    this.crowd = new NoiseLoop(ctx, this.sfxBus, this.noise, 'bandpass', 950, 0.7);
    this.ambience = new NoiseLoop(ctx, this.sfxBus, this.noise, 'lowpass', 420, 0.5);

    this.curbOsc = ctx.createOscillator();
    this.curbOsc.type = 'square';
    this.curbOsc.frequency.value = 30;
    const curbFilter = ctx.createBiquadFilter();
    curbFilter.type = 'lowpass';
    curbFilter.frequency.value = 260;
    this.curbGain = ctx.createGain();
    this.curbGain.gain.value = 0;
    this.curbOsc.connect(curbFilter).connect(this.curbGain).connect(this.sfxBus);
    this.curbOsc.start();

    this.music = new Music(ctx, this.musicBus, this.noise);
    this.ready = true;
  }

  applySettings(s: Settings) {
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * 0.7, t, 0.05);
    this.engineBus.gain.setTargetAtTime(s.engine * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.effects, t, 0.05);
  }

  /** Silence all continuous layers (used when leaving a race). */
  silenceLoops() {
    if (!this.ready || !this.ctx) return;
    this.engine.stop();
    this.rival.stop();
    for (const l of [this.wind, this.tyre, this.offroad, this.rain, this.crowd, this.ambience]) l.set(0, this.ctx, 0.2);
    this.curbGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  setCurb(amount: number, speed: number) {
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.curbOsc.frequency.setTargetAtTime(clamp(speed / 1.1, 8, 70), t, 0.03);
    this.curbGain.gain.setTargetAtTime(amount * 0.35, t, 0.03);
  }

  private shot(type: BiquadFilterType, freq: number, peak: number, decay: number, q = 1, sweepTo?: number, delay = 0, bus?: AudioNode) {
    if (!this.ready || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(g).connect(bus ?? this.sfxBus);
    s.start(t, Math.random() * 1.5);
    s.stop(t + decay + 0.05);
  }

  private tone(freq: number, peak: number, decay: number, type: OscillatorType = 'sine', delay = 0, freqTo?: number, attack = 0.005) {
    if (!this.ready || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  crackle(v: number) {
    for (let i = 0; i < 5; i++) {
      if (Math.random() < 0.7) this.shot('highpass', 1800 + Math.random() * 2000, 0.25 * v, 0.03 + Math.random() * 0.03, 1, undefined, i * 0.045 + Math.random() * 0.03, this.engineBus);
    }
  }

  uiHover() {
    this.tone(1900, 0.03, 0.05, 'sine');
  }
  uiClick() {
    this.tone(1200, 0.08, 0.07, 'triangle', 0, 700);
    this.shot('highpass', 5000, 0.04, 0.04);
  }
  uiBack() {
    this.tone(700, 0.06, 0.08, 'triangle', 0, 420);
  }
  whoosh(v = 0.22) {
    this.shot('bandpass', 400, v, 0.45, 1.4, 3200);
  }
  bassHit(v = 0.6) {
    this.tone(70, v, 0.5, 'sine', 0, 32);
  }
  countdown(n: number) {
    if (n > 0) {
      this.tone(620, 0.16, 0.32, 'sine');
      this.tone(1240, 0.04, 0.2, 'sine');
      this.bassHit(0.5);
    } else {
      this.tone(980, 0.2, 0.6, 'sine');
      this.tone(1960, 0.06, 0.4, 'sine');
      this.bassHit(0.8);
    }
  }
  shift() {
    this.shot('bandpass', 2600, 0.07, 0.05, 2, undefined, 0, this.engineBus);
  }
  impact(strength: number) {
    const v = clamp(strength, 0.05, 1);
    this.shot('lowpass', 900, 0.5 * v, 0.35, 0.8);
    this.tone(90, 0.5 * v, 0.25, 'sine', 0, 40);
    this.shot('bandpass', 3200, 0.2 * v, 0.25 + v * 0.3, 3, 1500);
  }
  scrape(v: number) {
    this.shot('bandpass', 2400 + Math.random() * 1500, 0.12 * v, 0.18, 6);
  }
  overtake() {
    this.tone(1320, 0.05, 0.12, 'sine');
    this.tone(1760, 0.05, 0.16, 'sine', 0.07);
  }
  finalLap() {
    this.tone(880, 0.07, 0.25, 'triangle');
    this.tone(1320, 0.07, 0.35, 'triangle', 0.12);
  }
  finish() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.09, 0.9, 'triangle', i * 0.09));
    this.bassHit(0.6);
  }
  sting(win: boolean) {
    const notes = win ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [440, 523.25, 493.88, 392];
    notes.forEach((f, i) => {
      this.tone(f, 0.08, win ? 1.2 : 0.8, 'sawtooth', i * 0.11, undefined, 0.02);
      this.tone(f / 2, 0.05, 1.1, 'triangle', i * 0.11);
    });
  }
  rev(v = 1) {
    // Short blip used by the splash sequence: driven through the main engine voice by the caller.
    this.shot('lowpass', 300, 0.25 * v, 0.6, 1, 1600);
  }
}

export const audio = new AudioManager();
