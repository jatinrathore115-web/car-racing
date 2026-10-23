import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/**
 * Planar reflection probe for wet asphalt / glossy floors. The probe renders a mirrored view into
 * a reduced-resolution target; patched standard materials blend it in with distortion, a
 * vertical streak blur and a height mask so only surfaces near the plane receive reflections.
 */
export class PlanarReflection {
  readonly reflector: Reflector;
  readonly uniforms = {
    tReflect: { value: null as THREE.Texture | null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflStrength: { value: 1 },
    uPlaneY: { value: 0 },
  };
  private inv = new THREE.Matrix4();

  constructor(scene: THREE.Scene, planeY: number, width: number, height: number) {
    this.reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
      textureWidth: width,
      textureHeight: height,
      clipBias: 0.02,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = planeY;
    this.reflector.frustumCulled = false;
    this.reflector.renderOrder = -100;
    const m = this.reflector.material as THREE.ShaderMaterial;
    m.colorWrite = false;
    m.depthWrite = false;
    this.reflector.updateMatrixWorld();
    this.uniforms.tReflect.value = this.reflector.getRenderTarget().texture;
    this.uniforms.uPlaneY.value = planeY;
    const tm = m.uniforms.textureMatrix.value as THREE.Matrix4;
    const orig = this.reflector.onBeforeRender.bind(this.reflector);
    this.reflector.onBeforeRender = (renderer, sc, camera, geometry, material, group) => {
      orig(renderer, sc, camera, geometry, material, group);
      this.inv.copy(this.reflector.matrixWorld).invert();
      this.uniforms.uReflMatrix.value.multiplyMatrices(tm, this.inv);
    };
    scene.add(this.reflector);
  }

  follow(x: number, z: number) {
    this.reflector.position.x = x;
    this.reflector.position.z = z;
  }

  dispose() {
    this.reflector.removeFromParent();
    this.reflector.dispose();
  }
}

/** Inject planar reflection sampling into a MeshStandardMaterial. */
export function applyReflection(mat: THREE.MeshStandardMaterial, refl: PlanarReflection, strength: number, streak = 1) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, refl.uniforms);
    shader.uniforms.uLocalStrength = { value: strength };
    shader.uniforms.uStreak = { value: streak };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflCoord;\nvarying float vWorldY;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvec4 wpR = modelMatrix * vec4(transformed, 1.0);\nvReflCoord = uReflMatrix * wpR;\nvWorldY = wpR.y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tReflect;\nuniform float uReflStrength;\nuniform float uLocalStrength;\nuniform float uStreak;\nuniform float uPlaneY;\nvarying vec4 vReflCoord;\nvarying float vWorldY;',
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec4 rc = vReflCoord;
          float wob = 0.0;
          #ifdef USE_MAP
            wob = texture2D(map, vMapUv * 2.7).r - 0.5;
          #endif
          rc.x += wob * 0.012 * rc.w;
          vec3 refl = vec3(0.0);
          for (int k = -3; k <= 3; k++) {
            vec4 c = rc;
            c.y += float(k) * 0.0055 * uStreak * rc.w;
            refl += texture2DProj(tReflect, c).rgb * (1.0 - abs(float(k)) * 0.12);
          }
          refl /= 5.56;
          float puddle = 1.0;
          #ifdef USE_ROUGHNESSMAP
            puddle = smoothstep(0.25, 0.75, 1.0 - texture2D(roughnessMap, vRoughnessMapUv * 0.37).g);
          #endif
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(V, normal)), 0.0, 1.0), 2.0);
          float mask = uReflStrength * uLocalStrength * (1.0 - smoothstep(0.12, 0.7, abs(vWorldY - uPlaneY)));
          outgoingLight = mix(outgoingLight, refl, clamp(mask * (0.25 + 0.55 * puddle) * (0.45 + 0.55 * fres), 0.0, 0.92));
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'refl' + strength + streak;
  mat.needsUpdate = true;
}
