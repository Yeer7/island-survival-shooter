import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.5, h));
  col = mix(col, uHorizon * 0.75, smoothstep(0.0, -0.3, h));

  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 60.0) * 0.45);
  col += uSunColor * smoothstep(0.99925, 0.9996, sd) * 6.0;

  float md = dot(d, uMoonDir);
  float moonDisc = smoothstep(0.99880, 0.99905, md);
  // soft terminator shading on the disc
  float shade = 0.75 + 0.25 * smoothstep(-0.02, 0.02, dot(d - uMoonDir, vec3(0.6, 0.3, 0.2)));
  col += vec3(0.82, 0.88, 1.0) * moonDisc * 1.6 * shade * uNight;
  col += vec3(0.45, 0.55, 0.8) * pow(max(md, 0.0), 90.0) * 0.35 * uNight;

  vec3 sp = floor(d * 240.0);
  float st = hash(sp);
  float star = step(0.9978, st) * smoothstep(0.02, 0.25, h);
  star *= 0.55 + 0.45 * sin(uTime * 2.5 + st * 517.0);
  col += vec3(0.9, 0.93, 1.0) * star * uNight * 1.2;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Real seconds per in-game day (1 game minute = 1 real second). */
/** Real seconds per in-game day: a full 24 h cycle every 7 minutes. */
export const DAY_SECONDS = 420;

const C = (hex: number) => new THREE.Color(hex);
const DAY_ZENITH = C(0x3d82c4);
const DAY_HORIZON = C(0xb2d8ea);
const DUSK_HORIZON = C(0xf0904e);
const DAWN_HORIZON = C(0xf4c878);
const DAWN_ZENITH = C(0x5a78b0);
const DUSK_ZENITH = C(0x4a5d93);
const NIGHT_ZENITH = C(0x050b1c);
const NIGHT_HORIZON = C(0x1c2a46);
const SUN_LOW = C(0xff9a4a);
const SUN_HIGH = C(0xfff1d6);
const MOON_LIGHT = C(0xa9c0ec);
const HEMI_DAY_SKY = C(0xcfe5ff);
const HEMI_DAY_GROUND = C(0x5c6b45);
const HEMI_NIGHT_SKY = C(0x41588e);
const HEMI_NIGHT_GROUND = C(0x141a26);

/**
 * Day/night cycle: one shadow-casting key light that is the sun by day and the
 * moon by night, a hemisphere fill, fog and a procedural sky dome.
 */
export class DayNight {
  hours = 8;
  day = 1;
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  /** Direction of the light currently casting shadows. */
  readonly keyDir = new THREE.Vector3();
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();
  readonly sunColor = new THREE.Color();
  /** Multiplier for unlit-shader surfaces (water, particles). */
  readonly ambient = new THREE.Color();
  daylight = 1;
  /** Set while the player is inside the cave. */
  indoor = false;
  night = 0;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.FogExp2;

  constructor(scene: THREE.Scene) {
    this.fog = new THREE.FogExp2(0xb2d8ea, 0.0024);
    scene.fog = this.fog;
    scene.background = null;

    this.hemi = new THREE.HemisphereLight(0xcfe5ff, 0x5c6b45, 0.9);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const s = this.key.shadow.camera;
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 1;
    s.far = 400;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.04;
    scene.add(this.key);
    scene.add(this.key.target);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uMoonDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    scene.add(this.sky);
    this.compute();
  }

  get clockText(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Jump to an hour of the next morning (sleeping). */
  sleepUntil(hour: number): void {
    if (this.hours >= hour) this.day++;
    this.hours = hour;
    this.compute();
  }

  advance(dt: number): void {
    this.hours += (dt / DAY_SECONDS) * 24;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
  }

  private compute(): void {
    const a = ((this.hours - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.42).normalize();
    this.moonDir.set(-Math.cos(a) * 0.9, -Math.sin(a), 0.25).normalize();
    const sunElev = this.sunDir.y;
    const moonElev = this.moonDir.y;

    this.daylight = smoothstep(-0.12, 0.22, sunElev);
    this.night = 1 - smoothstep(-0.2, 0.05, sunElev);
    const dusk = (1 - smoothstep(0.0, 0.35, Math.abs(sunElev + 0.02))) * (1 - this.night * 0.6);

    const morning = this.hours < 12;
    this.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, this.daylight).lerp(morning ? DAWN_ZENITH : DUSK_ZENITH, dusk * 0.5);
    this.horizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, this.daylight).lerp(morning ? DAWN_HORIZON : DUSK_HORIZON, dusk * 0.8);
    this.sunColor.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.02, 0.4, sunElev));

    if (sunElev > -0.03) {
      this.keyDir.copy(this.sunDir);
      this.key.color.copy(this.sunColor);
      this.key.intensity = 2.6 * smoothstep(-0.03, 0.14, sunElev);
    } else {
      this.keyDir.copy(this.moonDir);
      this.key.color.copy(MOON_LIGHT);
      this.key.intensity = 0.7 * smoothstep(-0.02, 0.2, moonElev);
    }
    this.hemi.color.copy(HEMI_NIGHT_SKY).lerp(HEMI_DAY_SKY, this.daylight);
    this.hemi.groundColor.copy(HEMI_NIGHT_GROUND).lerp(HEMI_DAY_GROUND, this.daylight);
    this.hemi.intensity = lerp(0.55, 0.85, this.daylight);

    this.fog.color.copy(this.horizon);
    this.fog.density = lerp(0.0034, 0.0022, this.daylight);
    if (this.indoor) {
      // Inside the cave: dense blue-black fog, no sun or moon, a faint cold fill.
      this.fog.color.setHex(0x0a121c);
      this.fog.density = 0.034;
      this.key.intensity = 0;
      this.hemi.color.setHex(0x34465e);
      this.hemi.groundColor.setHex(0x0a0d12);
      this.hemi.intensity = 0.5;
      this.ambient.setRGB(0.12, 0.14, 0.18);
    }

    const amb = lerp(0.2, 1.0, this.daylight);
    this.ambient.setRGB(amb * lerp(0.75, 1, this.daylight), amb * lerp(0.85, 1, this.daylight), amb);
  }

  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.advance(dt);
    this.compute();
    this.sky.position.copy(camera.position);
    this.sky.visible = !this.indoor;
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).copy(this.zenith);
    (u.uHorizon.value as THREE.Color).copy(this.horizon);
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(this.moonDir);
    (u.uSunColor.value as THREE.Color).copy(this.sunColor).multiplyScalar(clamp(this.sunDir.y * 4 + 0.6, 0, 1));
    u.uNight.value = this.night;
    u.uTime.value = time;

    // Shadow camera follows the player, snapped to texels so shadows don't crawl.
    const texel = 140 / 2048;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.key.target.position.set(fx, focus.y, fz);
    this.key.position.set(fx + this.keyDir.x * 200, focus.y + this.keyDir.y * 200, fz + this.keyDir.z * 200);
  }
}
