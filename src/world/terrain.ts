import * as THREE from 'three';
import { Simplex2D } from '../core/noise';
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

    const hills = n.fbm(x * 0.0055 + 3, z * 0.0055 - 7, 4) * 0.5 + 0.5;
    h += inland * (2.8 + hills * hills * 20) * (1 - 0.6 * south);

    // Rocky northern highland that falls steeply to the sea.
    const ridged = 1 - Math.abs(n.noise(x * 0.011 + 40, z * 0.011 + 13));
    const northInland = 1 - smoothstep(0.83, 0.98, t);
    h += north * northInland * (10 + ridged * ridged * 26 + hills * 10);

    h += (n.noise(x * 0.045, z * 0.045) * 0.35 + n.noise(x * 0.12, z * 0.12) * 0.12) * land;

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

    if (h < -0.8) {
      out.copy(c.seabed).lerp(c.wet, smoothstep(-6, -0.8, h));
    } else if (h < 0.55) {
      out.copy(c.wet).lerp(c.sand, smoothstep(0.1, 0.55, h));
    } else {
      const forest = smoothstep(-0.2, 0.4, n.noise(x * 0.012 + 70, z * 0.012 - 30));
      out.copy(c.grass).lerp(c.forest, forest * 0.8 + v * 0.2);
      const sandMix = 1 - smoothstep(beachTop - 0.4, beachTop + 0.6, h);
      out.lerp(c.sand, sandMix);
    }
    if (nearLake && h < LAKE_LEVEL + 0.8 && h > -0.5) {
      const shore = 1 - smoothstep(LAKE_LEVEL + 0.1, LAKE_LEVEL + 0.8, h);
      out.lerp(c.mud, shore * 0.85);
    }
    const rockMix = Math.max(smoothstep(0.22, 0.4, slope), north * smoothstep(20, 30, h) * 0.85);
    if (rockMix > 0 && h > 0.3) {
      out.lerp(v > 0.5 ? c.rock : c.dark, rockMix);
    }
    const shade = 0.92 + v * 0.16;
    out.multiplyScalar(shade);
  }

  private buildMesh(): THREE.Mesh {
    const n = SEG + 1;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
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
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
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
