import * as THREE from 'three';
import type { Weather } from '../data/tracks';

export interface EnvPreset {
  skyTop: string;
  skyHorizon: string;
  skyGround: string;
  sunColor: string;
  sunIntensity: number;
  sunElevation: number;
  sunAzimuth: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fogColor: string;
  fogDensity: number;
  exposure: number;
  clouds: number;
  cloudColor: string;
  wet: number;
  rain: number;
  night: boolean;
  bloom: number;
  bloomThreshold: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  envIntensity: number;
}

export const PRESETS: Record<Weather, EnvPreset> = {
  winter: {
    skyTop: '#4f80c2', skyHorizon: '#dce8f4', skyGround: '#c4d0dc', sunColor: '#fff0dc', sunIntensity: 2.5, sunElevation: 16, sunAzimuth: 40,
    hemiSky: '#dbe8f8', hemiGround: '#c2cfdb', hemiIntensity: 1.25, fogColor: '#d3e0ec', fogDensity: 0.0016, exposure: 0.98, clouds: 0.5, cloudColor: '#f4f7fb',
    wet: 0.3, rain: 0, night: false, bloom: 0.35, bloomThreshold: 0.9, saturation: 1.02, contrast: 1.06, tint: [0.97, 1.0, 1.05], envIntensity: 1.05,
  },
  summer: {
    skyTop: '#0d5ad2', skyHorizon: '#98d2ff', skyGround: '#5d6b58', sunColor: '#fff6e4', sunIntensity: 3.5, sunElevation: 58, sunAzimuth: 30,
    hemiSky: '#b0d4ff', hemiGround: '#5f8a45', hemiIntensity: 1.0, fogColor: '#a8cdf0', fogDensity: 0.00045, exposure: 0.96, clouds: 0.34, cloudColor: '#ffffff',
    wet: 0, rain: 0, night: false, bloom: 0.3, bloomThreshold: 0.95, saturation: 1.26, contrast: 1.08, tint: [1.01, 1.0, 0.98], envIntensity: 1,
  },
  autumn: {
    skyTop: '#46699f', skyHorizon: '#f2c48c', skyGround: '#6b4a30', sunColor: '#ffcc86', sunIntensity: 3.0, sunElevation: 20, sunAzimuth: -40,
    hemiSky: '#e6d3bd', hemiGround: '#7a4a26', hemiIntensity: 0.95, fogColor: '#e3b98e', fogDensity: 0.0011, exposure: 1.0, clouds: 0.5, cloudColor: '#ffe2c0',
    wet: 0, rain: 0, night: false, bloom: 0.4, bloomThreshold: 0.9, saturation: 1.14, contrast: 1.07, tint: [1.04, 0.99, 0.93], envIntensity: 0.95,
  },
  clear: {
    skyTop: '#1a64d0', skyHorizon: '#a8d4fb', skyGround: '#5d6b58', sunColor: '#fff4e2', sunIntensity: 3.2, sunElevation: 48, sunAzimuth: 35,
    hemiSky: '#b4d6ff', hemiGround: '#5f7d45', hemiIntensity: 0.95, fogColor: '#b2d2ee', fogDensity: 0.00055, exposure: 0.95, clouds: 0.4, cloudColor: '#ffffff',
    wet: 0, rain: 0, night: false, bloom: 0.28, bloomThreshold: 0.95, saturation: 1.2, contrast: 1.06, tint: [1.0, 1.0, 1.0], envIntensity: 1,
  },
  sunset: {
    skyTop: '#33467f', skyHorizon: '#ff9750', skyGround: '#4a3c3a', sunColor: '#ff9447', sunIntensity: 3.0, sunElevation: 7, sunAzimuth: -60,
    hemiSky: '#c9bcc0', hemiGround: '#6b5038', hemiIntensity: 0.85, fogColor: '#d4946e', fogDensity: 0.001, exposure: 1.0, clouds: 0.45, cloudColor: '#ffb27a',
    wet: 0, rain: 0, night: false, bloom: 0.45, bloomThreshold: 0.9, saturation: 1.06, contrast: 1.06, tint: [1.02, 0.99, 0.96], envIntensity: 0.9,
  },
  night: {
    skyTop: '#01030a', skyHorizon: '#14203f', skyGround: '#07090e', sunColor: '#d6e4ff', sunIntensity: 1.6, sunElevation: 62, sunAzimuth: 120,
    hemiSky: '#3a4f88', hemiGround: '#121520', hemiIntensity: 0.75, fogColor: '#0d1830', fogDensity: 0.0016, exposure: 1.2, clouds: 0.18, cloudColor: '#2a3550',
    wet: 0.35, rain: 0, night: true, bloom: 0.85, bloomThreshold: 0.75, saturation: 1.12, contrast: 1.1, tint: [0.95, 0.98, 1.06], envIntensity: 0.8,
  },
  rain: {
    skyTop: '#46515f', skyHorizon: '#929ea9', skyGround: '#3a3f46', sunColor: '#dfe7f0', sunIntensity: 1.25, sunElevation: 40, sunAzimuth: 60,
    hemiSky: '#a2aebd', hemiGround: '#3d434b', hemiIntensity: 1.1, fogColor: '#8b96a1', fogDensity: 0.0032, exposure: 1.05, clouds: 0.95, cloudColor: '#8d96a0',
    wet: 1, rain: 1, night: false, bloom: 0.45, bloomThreshold: 0.85, saturation: 0.92, contrast: 1.08, tint: [0.97, 1.0, 1.04], envIntensity: 1.1,
  },
  desert: {
    skyTop: '#3a8be0', skyHorizon: '#f2dcb4', skyGround: '#b38a58', sunColor: '#fff0d2', sunIntensity: 3.7, sunElevation: 58, sunAzimuth: 20,
    hemiSky: '#cfe2ff', hemiGround: '#c49a62', hemiIntensity: 1.0, fogColor: '#e9d4ad', fogDensity: 0.0014, exposure: 0.98, clouds: 0.12, cloudColor: '#fff8ee',
    wet: 0, rain: 0, night: false, bloom: 0.34, bloomThreshold: 0.9, saturation: 1.1, contrast: 1.07, tint: [1.04, 1.0, 0.94], envIntensity: 1,
  },
  storm: {
    skyTop: '#1f2733', skyHorizon: '#b47b5c', skyGround: '#18191d', sunColor: '#ffc290', sunIntensity: 1.9, sunElevation: 9, sunAzimuth: -25,
    hemiSky: '#8a98b2', hemiGround: '#2a2d33', hemiIntensity: 0.9, fogColor: '#5f6168', fogDensity: 0.0022, exposure: 1.05, clouds: 0.78, cloudColor: '#8f8a8c',
    wet: 1, rain: 0.35, night: false, bloom: 0.55, bloomThreshold: 0.85, saturation: 1.1, contrast: 1.12, tint: [1.0, 0.99, 1.0], envIntensity: 0.85,
  },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunColor; uniform vec3 uSunDir;
uniform vec3 uCloudColor; uniform float uClouds; uniform float uTime; uniform float uStars; uniform float uEnvPass;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uGround, pow(min(-h * 6.0, 1.0), 0.6));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6) * (1.0 - uStars * 0.85);
  float disc = smoothstep(0.99955, 0.99975, sd);
  col += uSunColor * disc * mix(25.0, 3.0, uEnvPass) * (1.0 - uStars * 0.7);
  if (h > 0.0 && uClouds > 0.01) {
    vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float c = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.35, n) * smoothstep(0.0, 0.18, h);
    float shade = fbm(uv * 1.7 + 3.0);
    vec3 cc = mix(uCloudColor * 0.72, uCloudColor * 1.05, shade) + uSunColor * pow(sd, 4.0) * 0.45;
    col = mix(col, cc, c * 0.92);
  }
  if (uStars > 0.0 && h > 0.0) {
    vec2 g = floor(d.xz / (h + 0.3) * 260.0);
    float s = step(0.9965, hash(g)) * hash(g + 3.1) * smoothstep(0.05, 0.35, h);
    col += vec3(s) * 2.2 * uStars;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(p: EnvPreset) {
  const sunDir = sunDirection(p);
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(p.skyTop) },
      uHorizon: { value: new THREE.Color(p.skyHorizon) },
      uGround: { value: new THREE.Color(p.skyGround) },
      uSunColor: { value: new THREE.Color(p.sunColor) },
      uSunDir: { value: sunDir },
      uCloudColor: { value: new THREE.Color(p.cloudColor) },
      uClouds: { value: p.clouds },
      uTime: { value: 0 },
      uStars: { value: p.night ? 1 : 0 },
      uEnvPass: { value: 0 },
    },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

export function sunDirection(p: EnvPreset) {
  const el = THREE.MathUtils.degToRad(p.sunElevation);
  const az = THREE.MathUtils.degToRad(p.sunAzimuth);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
}

/**
 * Lighting rig + sky + image-based lighting for a scene. The sun's shadow frustum follows a
 * focus point so the hero car always receives crisp shadows without a giant shadow map.
 */
export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir: THREE.Vector3;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private shadowRange: number;

  constructor(
    private scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    readonly preset: EnvPreset,
    quality: 'performance' | 'high' | 'ultra',
  ) {
    const p = preset;
    this.sky = createSky(p);
    scene.add(this.sky);
    this.sunDir = sunDirection(p);
    scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
    scene.background = null;

    this.sun = new THREE.DirectionalLight(p.sunColor, p.sunIntensity);
    this.sun.castShadow = true;
    const ms = quality === 'ultra' ? 4096 : quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ms, ms);
    this.shadowRange = quality === 'ultra' ? 70 : quality === 'high' ? 55 : 40;
    const c = this.sun.shadow.camera;
    c.left = -this.shadowRange;
    c.right = this.shadowRange;
    c.top = this.shadowRange;
    c.bottom = -this.shadowRange;
    c.near = 1;
    c.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
    scene.add(this.hemi);

    // Image based lighting from the sky itself so reflections match the atmosphere.
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = createSky(p);
    (envSky.material as THREE.ShaderMaterial).uniforms.uEnvPass.value = 1;
    envScene.add(envSky);
    // A neutral ground disc gives believable lower-hemisphere reflections on paint.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.skyGround).multiplyScalar(0.6) }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5;
    envScene.add(ground);
    this.envRT = pm.fromScene(envScene, 0.02, 0.1, 3000);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = p.envIntensity;
    pm.dispose();
    envSky.geometry.dispose();
    (envSky.material as THREE.Material).dispose();
  }

  update(time: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.sky.position.copy(camera.position);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    // Snap shadow camera to texel grid to avoid shimmering.
    const step = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / step) * step;
    const fz = Math.round(focus.z / step) * step;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 200, focus.y + Math.max(this.sunDir.y, 0.25) * 200, fz + this.sunDir.z * 200);
  }

  dispose() {
    this.scene.remove(this.sky, this.sun, this.sun.target, this.hemi);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.envRT?.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
