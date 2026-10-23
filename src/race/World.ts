import * as THREE from 'three';
import { Track } from '../track/Track';
import { buildTrack, type BuiltTrack } from '../track/TrackBuilder';
import { Environment, PRESETS, type EnvPreset } from '../track/Environment';
import { PlanarReflection } from '../effects/PlanarReflection';
import { ParticleManager, Rain, Flurry } from '../effects/Particles';
import type { SeasonDef } from '../data/seasons';
import type { TrackDef } from '../data/tracks';
import type { RenderPipeline } from '../core/Renderer';
import { nextFrame } from '../core/utils';

export interface World {
  scene: THREE.Scene;
  track: Track;
  built: BuiltTrack;
  env: Environment;
  preset: EnvPreset;
  reflection: PlanarReflection | null;
  particles: ParticleManager;
  /** Seasonal precipitation (rain streaks, snow, leaves, dust or pollen). */
  precip: { update(dt: number, cam: THREE.PerspectiveCamera, vel: THREE.Vector3, renderHeight: number): void; dispose(): void } | null;
  season: SeasonDef;
  dispose(): void;
}

/** Builds a full circuit environment. Yields between stages so the loading UI can animate. */
export async function buildWorld(
  def: TrackDef,
  season: SeasonDef,
  pipeline: RenderPipeline,
  onProgress: (p: number, label: string) => void,
  opts: { minReflection?: number } = {},
): Promise<World> {
  const scene = new THREE.Scene();
  const preset = PRESETS[season.world.preset];
  const quality = pipeline.quality;
  onProgress(0.05, 'Surveying circuit');
  await nextFrame();
  const track = new Track(def);
  onProgress(0.25, 'Computing racing line');
  await nextFrame();
  // Planar reflections only where the road is near a single plane height (wet + flat sections)
  let reflection: PlanarReflection | null = null;
  const res = Math.max(pipeline.profile.reflectionRes, opts.minReflection ?? 0);
  if (preset.wet > 0.3 && res > 0) {
    const w = Math.round(pipeline.width * res);
    const h = Math.round(pipeline.height * res);
    reflection = new PlanarReflection(scene, track.py[0] + 0.0, Math.max(256, w), Math.max(144, h));
  }
  onProgress(0.4, 'Building track surface');
  await nextFrame();
  const env = new Environment(scene, pipeline.renderer, preset, quality);
  onProgress(0.55, 'Lighting environment');
  await nextFrame();
  const built = buildTrack(track, { preset, detail: pipeline.profile.detail, reflection, sceneryShadows: pipeline.profile.sceneryShadows, season: season.world });
  scene.add(built.group);
  onProgress(0.8, 'Placing grandstands & scenery');
  await nextFrame();
  const particles = new ParticleManager(scene, quality);
  const w = season.world;
  let precip: World['precip'] = null;
  if (w.precip === 'rain' || preset.rain > 0) {
    const r = new Rain(scene, Math.max(preset.rain, w.precipAmount), quality);
    precip = { update: (dt, cam, vel) => r.update(dt, cam, vel), dispose: () => r.dispose() };
  } else if (w.precip) {
    const palette = w.precip === 'leaves' ? w.foliage.slice(0, 5) : w.precip === 'dust' ? ['#e9c99a', '#d8b07a', '#f3dcb8'] : w.precip === 'pollen' ? ['#fff2b0', '#ffffff'] : ['#ffffff', '#eef4fb'];
    precip = new Flurry(scene, w.precip, w.precipAmount, quality, palette);
  }
  onProgress(0.9, 'Warming up shaders');
  await nextFrame();
  return {
    scene,
    track,
    built,
    env,
    preset,
    reflection,
    particles,
    precip,
    season,
    dispose() {
      built.dispose();
      env.dispose();
      reflection?.dispose();
      particles.dispose();
      precip?.dispose();
      scene.clear();
    },
  };
}
