import * as THREE from 'three';
import { Simplex2D } from '../core/noise';
import { detailTextures } from './textures';
import { clamp, lerp, mulberry32, smoothstep } from '../core/math';

export const SEA_LEVEL = 0;
export const LAKE_LEVEL = 6;
export const LAKE_CENTER = { x: 50, z: -40 };
export const LAKE_RADIUS = 34;
/** Terrain grid covers the ~600 m island plus a ring of sea floor. */
export const TERRAIN_SIZE = 720;
const SEG = 288; // 2.5 m cells
const HALF = TERRAIN_SIZE / 2;
const STEP = TERRAIN_SIZE / SEG;
export const HEIGHT_TEX_MIN = -12;
export const HEIGHT_TEX_RANGE = 24;

export type Surface = 'sand' | 'grass' | 'rock' | 'water' | 'wood';

/**
 * Procedural island: organic coastline, wide southern beach, forest hills in the
 * centre, a rocky northern highland and a fresh-water lake inland.
 * North is -Z, East is +X.
 */
export class Terrain {
  readonly noise: Simplex2D;
  readonly grid: Float32Array;
  readonly mesh: THREE.Mesh;
  readonly heightTexture: THREE.DataTexture;
  private lastSand = 0;
  private lastRock = 0;
  private colorCache: { sand: THREE.Color; wet: THREE.Color; grass: THREE.Color; forest: THREE.Color; rock: THREE.Color; dark: THREE.Color; mud: THREE.Color; seabed: THREE.Color };

  constructor(seed = 1337) {
    this.noise = new Simplex2D(mulberry32(seed));
    this.colorCache = {
      sand: new THREE.Color(0xe3cf9a),
      wet: new THREE.Color(0xb59f6c),
      grass: new THREE.Color(0x7ea24a),
      forest: new THREE.Color(0x4c7434),
      rock: new THREE.Color(0x8a8781),
      dark: new THREE.Color(0x5f5c58),
      mud: new THREE.Color(0x6e6142),
      seabed: new THREE.Color(0x9c8a60),
    };
    const n = SEG + 1;
    this.grid = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        this.grid[iz * n + ix] = this.rawHeight(-HALF + ix * STEP, -HALF + iz * STEP);
      }
    }
    this.mesh = this.buildMesh();
    this.heightTexture = this.buildHeightTexture();
  }

  /** Radius of the coastline in the direction of (x, z). */
  islandRadius(x: number, z: number): number {
    const a = Math.atan2(z, x);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return 236 + this.noise.noise(c * 1.2 + 11, s * 1.2 - 4) * 24 + this.noise.noise(c * 3.1 + 2, s * 3.1 + 9) * 9;
  }

  /** Approximate distance from (x,z) to the coastline (positive inland). */
  coastDistance(x: number, z: number): number {
    return this.islandRadius(x, z) * 0.96 - Math.hypot(x, z);
  }

  private rawHeight(x: number, z: number): number {
    const n = this.noise;
    const d = Math.hypot(x, z);
    const t = d / this.islandRadius(x, z);
    const land = 1 - smoothstep(0.86, 1.06, t);
    let h = lerp(-10, 1.25, land);

    const south = smoothstep(40, 190, z);
    const north = smoothstep(30, 170, -z);
    const inlandStart = lerp(0.9, 0.78, south);
    const inland = 1 - smoothstep(inlandStart - 0.3, inlandStart, t);

    // Light domain warping bends hills and ridges so nothing lines up on the noise grid.
    const wx = x + n.fbm(x * 0.0035 + 31, z * 0.0035 - 17, 3) * 38;
    const wz = z + n.fbm(x * 0.0035 - 53, z * 0.0035 + 29, 3) * 38;
    // Four-octave FBM through a smooth elevation curve: flat lowlands, rounded tops.
    const hills01 = clamp(n.fbm(wx * 0.0052 + 3, wz * 0.0052 - 7, 4) * 0.58 + 0.5, 0, 1);
    const hillH = hills01 * hills01 * (3 - 2 * hills01);
    h += inland * (2.4 + hillH * 16) * (1 - 0.6 * south);

    // Northern range: a broad warped massif from soft-ridged FBM (smooth |r|, no creases),
    // banded along an east-west spine so it reads as one serra rather than scattered peaks.
    const r = n.fbm(wx * 0.0085 + 40, wz * 0.0085 + 13, 4);
    const softRidge = clamp(1 - Math.sqrt(r * r + 0.02), 0, 1);
    const ridge = softRidge * softRidge * (3 - 2 * softRidge);
    const spine = -150 + n.noise(x * 0.006 + 7, 3.3) * 28;
    const band = Math.exp(-(((z - spine) / 75) ** 2));
    const northInland = 1 - smoothstep(0.76, 0.97, t);
    h += north * northInland * (5 + band * (11 + ridge * 21) + hillH * 6);

    h += n.noise(x * 0.03, z * 0.03) * 0.25 * land;

    // Fresh-water lake basin.
    const lx = x - LAKE_CENTER.x;
    const lz = z - LAKE_CENTER.z;
    const ld = Math.hypot(lx, lz) / (LAKE_RADIUS * (1 + 0.18 * n.noise(x * 0.03 + 5, z * 0.03 + 5)));
    if (ld < 2.3) {
      const ring = 1 - smoothstep(1.0, 2.3, ld);
      const rim = LAKE_LEVEL + 0.6 + Math.max(0, ld - 0.9) * 4;
      h = lerp(h, rim, ring);
      const bowl = 1 - smoothstep(0.7, 1.0, ld);
      const bottom = LAKE_LEVEL - 0.5 - 4.5 * (1 - smoothstep(0, 0.8, ld));
      h = lerp(h, bottom, bowl);
    }
    return h;
  }

  /** Height that matches the rendered triangles exactly. */
  height(x: number, z: number): number {
    const gx = clamp((x + HALF) / STEP, 0, SEG - 0.0001);
    const gz = clamp((z + HALF) / STEP, 0, SEG - 0.0001);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const n = SEG + 1;
    const ha = this.grid[iz * n + ix];
    const hb = this.grid[(iz + 1) * n + ix];
    const hc = this.grid[(iz + 1) * n + ix + 1];
    const hd = this.grid[iz * n + ix + 1];
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  /** 0 = flat, 1 = vertical. */
  slope(x: number, z: number): number {
    const e = 1.5;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    const ny = 1 / Math.sqrt(1 + (dx / (2 * e)) ** 2 + (dz / (2 * e)) ** 2);
    return 1 - ny;
  }

  isInLake(x: number, z: number): boolean {
    return Math.hypot(x - LAKE_CENTER.x, z - LAKE_CENTER.z) < LAKE_RADIUS * 1.45 && this.height(x, z) < LAKE_LEVEL;
  }

  waterLevelAt(x: number, z: number): number {
    return Math.hypot(x - LAKE_CENTER.x, z - LAKE_CENTER.z) < LAKE_RADIUS * 1.6 ? LAKE_LEVEL : SEA_LEVEL;
  }

  surfaceAt(x: number, z: number): Surface {
    const h = this.height(x, z);
    const wl = this.waterLevelAt(x, z);
    if (h < wl - 0.25) return 'water';
    if (this.slope(x, z) > 0.32) return 'rock';
    const beachTop = 2.3 + smoothstep(40, 190, z) * 0.8;
    if (h < beachTop || (wl === LAKE_LEVEL && h < LAKE_LEVEL + 0.7)) return 'sand';
    return 'grass';
  }

  private surfaceColor(x: number, z: number, h: number, slope: number, out: THREE.Color): void {
    const c = this.colorCache;
    const n = this.noise;
    const v = n.noise(x * 0.08, z * 0.08) * 0.5 + 0.5;
    const south = smoothstep(40, 190, z);
    const north = smoothstep(30, 170, -z);
    const beachTop = 2.3 + south * 0.8;
    const nearLake = Math.hypot(x - LAKE_CENTER.x, z - LAKE_CENTER.z) < LAKE_RADIUS * 1.6;

    this.lastSand = 1;
    this.lastRock = 0;
    if (h < -0.8) {
      out.copy(c.seabed).lerp(c.wet, smoothstep(-6, -0.8, h));
    } else if (h < 0.55) {
      out.copy(c.wet).lerp(c.sand, smoothstep(0.1, 0.55, h));
    } else {
      const forest = smoothstep(-0.2, 0.4, n.noise(x * 0.012 + 70, z * 0.012 - 30));
      out.copy(c.grass).lerp(c.forest, forest * 0.8 + v * 0.2);
      const sandMix = 1 - smoothstep(beachTop - 0.4, beachTop + 0.6, h);
      out.lerp(c.sand, sandMix);
      this.lastSand = sandMix;
    }
    if (nearLake && h < LAKE_LEVEL + 0.8 && h > -0.5) {
      const shore = 1 - smoothstep(LAKE_LEVEL + 0.1, LAKE_LEVEL + 0.8, h);
      out.lerp(c.mud, shore * 0.85);
      this.lastSand = Math.max(this.lastSand, shore * 0.7);
    }
    // Slope blending: rock only on steep faces and on the high crest of the range.
    const rockMix = Math.max(smoothstep(0.3, 0.52, slope), north * smoothstep(30, 40, h) * 0.7);
    if (rockMix > 0 && h > 0.3) {
      out.lerp(v > 0.5 ? c.rock : c.dark, rockMix);
      this.lastRock = rockMix;
    }
    const shade = 0.92 + v * 0.16;
    out.multiplyScalar(shade);
  }

  private buildMesh(): THREE.Mesh {
    const n = SEG + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const surf = new Float32Array(n * n * 2);
    const col = new THREE.Color();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = -HALF + ix * STEP;
        const z = -HALF + iz * STEP;
        const h = this.grid[i];
        positions[i * 3] = x;
        positions[i * 3 + 1] = h;
        positions[i * 3 + 2] = z;
        const hx = this.grid[iz * n + Math.min(ix + 1, SEG)] - this.grid[iz * n + Math.max(ix - 1, 0)];
        const hz = this.grid[Math.min(iz + 1, SEG) * n + ix] - this.grid[Math.max(iz - 1, 0) * n + ix];
        const ny = 1 / Math.sqrt(1 + (hx / (2 * STEP)) ** 2 + (hz / (2 * STEP)) ** 2);
        this.surfaceColor(x, z, h, 1 - ny, col);
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
        surf[i * 2] = this.lastSand;
        surf[i * 2 + 1] = this.lastRock;
      }
    }
    const indices = new Uint32Array(SEG * SEG * 6);
    let k = 0;
    for (let iz = 0; iz < SEG; iz++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a = iz * n + ix;
        const b = (iz + 1) * n + ix;
        const c = (iz + 1) * n + ix + 1;
        const d = iz * n + ix + 1;
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const tex = detailTextures();
    // Sand, grass and rock detail blended per vertex, sampled in world space at two
    // scales so the tiling breaks up.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tSand = { value: tex.sand };
      shader.uniforms.tGrass = { value: tex.grass };
      shader.uniforms.tRock = { value: tex.rock };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 aSurf;
varying vec2 vSurf;
varying vec2 vTPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurf = aSurf;
vTPos = position.xz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tSand;
uniform sampler2D tGrass;
uniform sampler2D tRock;
varying vec2 vSurf;
varying vec2 vTPos;`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 tuv = vTPos * 0.33;
          float dSand = texture2D(tSand, tuv).r;
          float dGrass = texture2D(tGrass, tuv * 0.8).r;
          float dRock = texture2D(tRock, tuv * 0.3).r;
          float macro = texture2D(tGrass, vTPos * 0.011 + 0.3).r;
          float det = mix(dGrass, dSand, vSurf.x);
          det = mix(det, dRock, vSurf.y);
          diffuseColor.rgb *= det * 1.32 * (0.86 + 0.28 * macro);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor - (det - 0.7) * 0.25 - vSurf.y * 0.08, 0.6, 1.0);`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  private buildHeightTexture(): THREE.DataTexture {
    const n = SEG + 1;
    const data = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      data[i] = Math.round(clamp((this.grid[i] - HEIGHT_TEX_MIN) / HEIGHT_TEX_RANGE, 0, 1) * 255);
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** Walk from (x0,z0) along (dx,dz) and return the first point under `level`. */
  findShore(x0: number, z0: number, dx: number, dz: number, level: number, maxDist = 400): { x: number; z: number } {
    for (let t = 0; t < maxDist; t += 0.5) {
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      if (this.height(x, z) < level) return { x, z };
    }
    return { x: x0 + dx * maxDist, z: z0 + dz * maxDist };
  }
}
