import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { Quality } from './SaveService';
import type { EnvPreset } from '../track/Environment';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0 },
    uVignette: { value: 0.35 },
    uSat: { value: 1.1 },
    uContrast: { value: 1.05 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uFlash: { value: 0 },
    uLines: { value: 0 },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.56) },
    uDim: { value: 0 },
    uAspect: { value: 16 / 9 },
    uTaps: { value: 8 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uBlur, uVignette, uSat, uContrast, uFlash, uLines, uTime, uDim, uAspect, uTaps;
    uniform vec3 uTint;
    uniform vec2 uCenter;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec2 dir = vUv - uCenter;
      float r = length(dir * vec2(uAspect, 1.0)) / uAspect * 1.6;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (uBlur > 0.001) {
        float amt = uBlur * smoothstep(0.16, 0.85, r);
        vec3 acc = col;
        float w = 1.0;
        for (int i = 1; i < 10; i++) {
          if (float(i) >= uTaps) break;
          float t = float(i) / uTaps;
          acc += texture2D(tDiffuse, vUv - dir * amt * 0.055 * t).rgb;
          w += 1.0;
        }
        col = acc / w;
      }
      if (uLines > 0.001) {
        float ang = atan(dir.y, dir.x * uAspect);
        float band = floor(ang * 90.0 / 6.2831853);
        float h = hash(band * 1.37 + floor(uTime * 14.0) * 7.13);
        float lineM = step(0.94, h) * smoothstep(0.55, 1.0, r);
        col += vec3(lineM) * uLines * 0.22;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = max((col - 0.18) * uContrast + 0.18, 0.0) * uTint;
      float vig = smoothstep(1.25, 0.35, r);
      col *= mix(1.0, vig, uVignette);
      col = mix(col, vec3(1.6), uFlash);
      col *= (1.0 - uDim);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface QualityProfile {
  pixelRatio: number;
  pixelCap: number;
  msaa: number;
  bloom: boolean;
  bloomScale: number;
  blurTaps: number;
  detail: number;
  reflectionRes: number;
  fxaa: boolean;
  softShadows: boolean;
  sceneryShadows: boolean;
  liteCars: boolean;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  performance: { pixelRatio: 1, pixelCap: 1.3e6, msaa: 0, bloom: true, bloomScale: 0.35, blurTaps: 3, detail: 0.55, reflectionRes: 0, fxaa: false, softShadows: false, sceneryShadows: false, liteCars: true },
  high: { pixelRatio: 1.5, pixelCap: 3.8e6, msaa: 4, bloom: true, bloomScale: 0.5, blurTaps: 7, detail: 1, reflectionRes: 0.4, fxaa: false, softShadows: true, sceneryShadows: true, liteCars: false },
  ultra: { pixelRatio: 2, pixelCap: 8.9e6, msaa: 4, bloom: true, bloomScale: 0.6, blurTaps: 9, detail: 1.4, reflectionRes: 0.55, fxaa: false, softShadows: true, sceneryShadows: true, liteCars: false },
};

export function detectQuality(renderer: THREE.WebGLRenderer): Quality {
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    /* ignore */
  }
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || /Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Basic Render/i.test(gpu)) return 'performance';
  if (/RTX|RX 6|RX 7|RX 9|Apple M[2-9]|Apple M1 (Pro|Max|Ultra)|Radeon Pro W|Arc A7/i.test(gpu)) return 'ultra';
  if (/Intel/i.test(gpu) && !/Arc/i.test(gpu)) return 'performance';
  return 'high';
}

export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private renderPass!: RenderPass;
  private bloom!: UnrealBloomPass;
  private bokeh!: BokehPass;
  readonly final: ShaderPass;
  private fxaa: FXAAPass | null = null;
  quality: Quality = 'high';
  profile: QualityProfile = QUALITY.high;
  userScale = 1;
  dynScale = 1;
  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera();
  private frameAvg = 1 / 60;
  private dynTimer = 0;
  dynamicEnabled = false;
  width = 1;
  height = 1;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.final = new ShaderPass(FinalShader);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality, userScale: number) {
    this.quality = q;
    this.profile = QUALITY[q];
    this.userScale = userScale;
    this.dynScale = 1;
    this.renderer.shadowMap.type = this.profile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.buildComposer();
    this.resize();
  }

  private buildComposer() {
    this.composer?.dispose();
    const p = this.profile;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: p.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 8, aperture: 0.004, maxblur: 0.008 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.9);
    this.bloom.enabled = p.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.final.uniforms.uTaps.value = p.blurTaps;
    this.composer.addPass(new OutputPass());
    this.fxaa = null;
    if (p.fxaa) {
      this.fxaa = new FXAAPass();
      this.composer.addPass(this.fxaa);
    }
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.bokeh.scene = scene;
    this.bokeh.camera = camera;
    this.resize();
  }

  setDOF(enabled: boolean, focus = 8, aperture = 0.004, maxblur = 0.008, force = false) {
    this.bokeh.enabled = enabled && (force || this.quality !== 'performance');
    const u = this.bokeh.uniforms as Record<string, THREE.IUniform>;
    u.focus.value = focus;
    u.aperture.value = aperture;
    u.maxblur.value = maxblur;
  }

  setBloom(strength: number, threshold: number) {
    this.bloom.enabled = this.profile.bloom;
    this.bloom.strength = strength;
    this.bloom.threshold = threshold;
  }

  /** `showcase` keeps full post for menu/splash scenes; races on Performance drop bloom except at night. */
  applyPreset(p: EnvPreset, showcase = false) {
    this.bloom.enabled = this.profile.bloom && (showcase || this.quality !== 'performance' || p.night);
    this.renderer.toneMappingExposure = p.exposure;
    this.bloom.strength = p.bloom;
    this.bloom.threshold = p.bloomThreshold;
    this.bloom.radius = 0.55;
    const u = this.final.uniforms;
    u.uSat.value = p.saturation;
    u.uContrast.value = p.contrast;
    u.uTint.value.set(...p.tint);
  }

  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    let pr = Math.min(dpr, this.profile.pixelRatio) * this.userScale * this.dynScale;
    if (this.quality === 'performance') pr *= 0.9;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const pixels = w * h * pr * pr;
    if (pixels > this.profile.pixelCap) pr *= Math.sqrt(this.profile.pixelCap / pixels);
    return Math.max(0.4, pr);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * this.profile.bloomScale, h * pr * this.profile.bloomScale);
    this.final.uniforms.uAspect.value = w / h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w * pr;
    this.height = h * pr;
  }

  render(dt: number, time: number) {
    this.final.uniforms.uTime.value = time;
    this.composer.render(dt);
    // Dynamic resolution keeps frame pacing smooth on weaker GPUs.
    if (this.dynamicEnabled && dt > 0 && dt < 0.2) {
      this.frameAvg = this.frameAvg * 0.95 + dt * 0.05;
      this.dynTimer += dt;
      if (this.dynTimer > 3) {
        if (this.frameAvg > 1 / 45 && this.dynScale > 0.7) {
          this.dynScale = Math.max(0.7, this.dynScale - 0.1);
          this.resize();
          this.dynTimer = 0;
        } else if (this.frameAvg < 1 / 57 && this.dynScale < 1 && this.dynTimer > 8) {
          this.dynScale = Math.min(1, this.dynScale + 0.1);
          this.resize();
          this.dynTimer = 0;
        } else if (this.frameAvg <= 1 / 45) this.dynTimer = Math.min(this.dynTimer, 8.5);
      }
    }
  }
}
