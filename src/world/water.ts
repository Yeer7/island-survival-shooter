import * as THREE from 'three';
import { HEIGHT_TEX_MIN, HEIGHT_TEX_RANGE, TERRAIN_SIZE } from './terrain';

const vertex = /* glsl */ `
uniform float uTime;
uniform float uWaveAmp;
varying vec3 vWorld;
varying vec3 vWaveNormal;
#include <fog_pars_vertex>

float wave(vec2 p, vec2 d, float k, float w, float a, inout vec2 g) {
  float ph = dot(p, d) * k + uTime * w;
  g += d * k * a * cos(ph);
  return a * sin(ph);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 g = vec2(0.0);
  float h = 0.0;
  h += wave(wp.xz, vec2(0.8, 0.6), 0.075, 1.0, 0.38, g);
  h += wave(wp.xz, vec2(-0.287, 0.958), 0.13, 1.55, 0.18, g);
  h += wave(wp.xz, vec2(0.98, -0.196), 0.21, 2.1, 0.08, g);
  h += wave(wp.xz, vec2(-0.6, -0.8), 0.34, 2.7, 0.04, g);
  wp.y += h * uWaveAmp;
  g *= uWaveAmp;
  vWaveNormal = normalize(vec3(-g.x, 1.0, -g.y));
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeight;
uniform float uLevel;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSpecular;
uniform vec3 uLight;
uniform float uFoam;
uniform float uRipple;
varying vec3 vWorld;
varying vec3 vWaveNormal;
#include <common>
#include <fog_pars_fragment>

void main() {
  vec2 uv = (vWorld.xz + ${(TERRAIN_SIZE / 2).toFixed(1)}) / ${TERRAIN_SIZE.toFixed(1)};
  float th = texture2D(uHeight, uv).r * ${HEIGHT_TEX_RANGE.toFixed(1)} + ${HEIGHT_TEX_MIN.toFixed(1)};
  float depth = uLevel - th;

  vec2 rp = vWorld.xz * 0.55;
  vec3 ripple = vec3(
    sin(rp.x + uTime * 1.7) * 0.5 + sin(rp.y * 1.7 - uTime * 1.2) * 0.5,
    0.0,
    cos(rp.y + uTime * 1.4) * 0.5 + cos(rp.x * 0.8 + uTime * 0.9) * 0.5);
  vec3 n = normalize(vWaveNormal + ripple * uRipple);

  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 7.0, depth));
  vec3 col = base * uLight;
  col = mix(col, uSkyColor, clamp(fres, 0.0, 1.0) * 0.7);

  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 240.0);
  col += uSunColor * spec * uSpecular;

  float foamLine = 1.0 - smoothstep(0.0, 1.1, depth);
  float foamN = 0.5 + 0.5 * sin(vWorld.x * 0.9 + uTime * 2.0) * sin(vWorld.z * 0.8 - uTime * 1.6);
  col = mix(col, vec3(0.93, 0.96, 0.97) * uLight, foamLine * uFoam * (0.5 + 0.5 * foamN));

  float alpha = mix(0.4, 0.95, smoothstep(0.0, 2.5, depth));
  alpha = max(alpha, fres * 0.9);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface WaterOptions {
  heightTexture: THREE.Texture;
  level: number;
  deep: number;
  shallow: number;
  waveAmp: number;
  foam: number;
  ripple: number;
}

export function createWaterMaterial(o: WaterOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHeight: { value: null },
        uLevel: { value: o.level },
        uDeep: { value: new THREE.Color(o.deep) },
        uShallow: { value: new THREE.Color(o.shallow) },
        uSkyColor: { value: new THREE.Color(0x9cc9e4) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSpecular: { value: 1.5 },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uWaveAmp: { value: o.waveAmp },
        uFoam: { value: o.foam },
        uRipple: { value: o.ripple },
      },
    ]),
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    fog: true,
  });
}

/** Ocean around the island plus the inland lake surface. */
export class Water {
  readonly ocean: THREE.Mesh;
  readonly lake: THREE.Mesh;
  private materials: THREE.ShaderMaterial[] = [];

  constructor(heightTexture: THREE.Texture, lakeLevel: number, lakeCenter: { x: number; z: number }, lakeRadius: number) {
    const oceanGeo = new THREE.PlaneGeometry(2600, 2600, 220, 220);
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMat = createWaterMaterial({ heightTexture, level: 0, deep: 0x0b4f74, shallow: 0x2fb5b5, waveAmp: 1, foam: 1, ripple: 0.05 });
    oceanMat.uniforms.uHeight.value = heightTexture;
    this.ocean = new THREE.Mesh(oceanGeo, oceanMat);
    this.ocean.renderOrder = 1;
    this.ocean.name = 'ocean';

    const lakeGeo = new THREE.CircleGeometry(lakeRadius * 1.5, 64);
    lakeGeo.rotateX(-Math.PI / 2);
    const lakeMat = createWaterMaterial({ heightTexture, level: lakeLevel, deep: 0x163f45, shallow: 0x4f8a78, waveAmp: 0.06, foam: 0.35, ripple: 0.035 });
    lakeMat.uniforms.uHeight.value = heightTexture;
    this.lake = new THREE.Mesh(lakeGeo, lakeMat);
    this.lake.position.set(lakeCenter.x, lakeLevel, lakeCenter.z);
    this.lake.renderOrder = 1;
    this.lake.name = 'lake';
    this.materials.push(oceanMat, lakeMat);
  }

  update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, specular: number, sky: THREE.Color, light: THREE.Color): void {
    for (const m of this.materials) {
      const u = m.uniforms;
      u.uTime.value = time;
      (u.uSunDir.value as THREE.Vector3).copy(sunDir);
      (u.uSunColor.value as THREE.Color).copy(sunColor);
      u.uSpecular.value = specular;
      (u.uSkyColor.value as THREE.Color).copy(sky);
      (u.uLight.value as THREE.Color).copy(light);
    }
  }

  /** Same wave sum as the shader, for swimming / splash heights. */
  static oceanOffset(x: number, z: number, time: number): number {
    const w = (dx: number, dz: number, k: number, sp: number, a: number) => a * Math.sin((x * dx + z * dz) * k + time * sp);
    return w(0.8, 0.6, 0.075, 1.0, 0.38) + w(-0.287, 0.958, 0.13, 1.55, 0.18) + w(0.98, -0.196, 0.21, 2.1, 0.08) + w(-0.6, -0.8, 0.34, 2.7, 0.04);
  }
}
