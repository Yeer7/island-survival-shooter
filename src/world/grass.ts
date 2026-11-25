import * as THREE from 'three';
import { AssetLibrary } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { Terrain } from './terrain';
import { addWind } from './vegetation';

const CELL = 6;
const RADIUS = 75;
const CAPACITY = 20000;
/** Candidate clumps per cell before the grass/slope tests and distance thinning. */
const PER_CELL = 45;
const REBUILD_STEP = 6;

interface Cell {
  /** Packed matrices (16 floats each) and colours (3 floats each). */
  m: Float32Array;
  c: Float32Array;
  x: Float32Array;
  z: Float32Array;
  n: number;
}

/**
 * Low grass (Quaternius Grass_Small, ~0.3 m) carpeting the terrain around the
 * player. Clumps are generated per 6 m cell (deterministically, cached) and the
 * instance buffer is refilled from the cells inside a 75 m disc whenever the
 * player has moved a few metres, so the whole island reads as grassy at one
 * draw call. Normals point straight up so every blade takes the ground's light
 * and no face ever turns black.
 */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  private cells = new Map<number, Cell>();
  private center = new THREE.Vector2(1e9, 1e9);
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(private terrain: Terrain, lib: AssetLibrary, private bare: { x: number; z: number; r: number }[] = []) {
    const parts = lib.parts('grass', { by: 'height', value: 0.3 });
    const geo = parts[0].geometry;
    const normals = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
    normals.needsUpdate = true;
    // The pack's Grass.png is a dark-to-light green gradient along the blade. Keep that
    // shape as a grey ramp (same UV layout) and take the hue from the ground, so the
    // carpet never goes darker than the terrain it stands on.
    const ramp = document.createElement('canvas');
    ramp.width = 4;
    ramp.height = 64;
    const rg = ramp.getContext('2d')!;
    const grad = rg.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#a8a8a8');
    rg.fillStyle = grad;
    rg.fillRect(0, 0, 4, 64);
    const rampTex = new THREE.CanvasTexture(ramp);
    rampTex.colorSpace = THREE.SRGBColorSpace;
    rampTex.flipY = false;
    const mat = new THREE.MeshStandardMaterial({ map: rampTex, color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    addWind(mat, 0.02, 0.25);
    // DoubleSide normally flips the normal on back faces, which would point it down and
    // turn those blades black. Keep the up-normal on both sides.
    const windCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      windCompile.call(mat, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      );
    };
    mat.customProgramCacheKey = () => 'grass-up-normals';
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    // The instances always surround the camera; skip culling instead of chasing bounds.
    this.mesh.frustumCulled = false;
  }

  private key(cx: number, cz: number): number {
    return (cx + 500) * 1000 + (cz + 500);
  }

  private cell(cx: number, cz: number): Cell {
    const k = this.key(cx, cz);
    let c = this.cells.get(k);
    if (c) return c;
    const rand = mulberry32(k * 2654435761);
    const m = new Float32Array(PER_CELL * 16);
    const colors = new Float32Array(PER_CELL * 3);
    const xs = new Float32Array(PER_CELL);
    const zs = new Float32Array(PER_CELL);
    let n = 0;
    const d = this.dummy;
    for (let i = 0; i < PER_CELL; i++) {
      const x = (cx + rand()) * CELL;
      const z = (cz + rand()) * CELL;
      const s = 0.85 + rand() * 0.35;
      const yaw = rand() * Math.PI * 2;
      const tint = 0.9 + rand() * 0.2;
      if (this.terrain.surfaceAt(x, z) !== 'grass' || this.terrain.slope(x, z) >= 0.18) continue;
      if (this.bare.some((b) => Math.hypot(x - b.x, z - b.z) < b.r)) continue;
      d.position.set(x, this.terrain.height(x, z) - 0.02, z);
      d.rotation.set(0, yaw, 0);
      d.scale.set(s, s * (0.85 + rand() * 0.3), s);
      d.updateMatrix();
      d.matrix.toArray(m, n * 16);
      // Take the hue of the ground underneath so the carpet blends with the terrain.
      this.terrain.colorAt(x, z, this.col);
      colors[n * 3] = this.col.r * 1.25 * tint;
      colors[n * 3 + 1] = this.col.g * 1.3 * tint;
      colors[n * 3 + 2] = this.col.b * 1.15 * tint;
      xs[n] = x;
      zs[n] = z;
      n++;
    }
    c = { m, c: colors, x: xs, z: zs, n };
    this.cells.set(k, c);
    return c;
  }

  /** Refill around (x, z) once the player has moved far enough. */
  update(x: number, z: number): void {
    if (Math.hypot(x - this.center.x, z - this.center.y) < REBUILD_STEP) return;
    this.center.set(x, z);
    const im = this.mesh.instanceMatrix.array as Float32Array;
    const ic = this.mesh.instanceColor!.array as Float32Array;
    let count = 0;
    const r = Math.ceil(RADIUS / CELL);
    const pcx = Math.floor(x / CELL);
    const pcz = Math.floor(z / CELL);
    for (let dz = -r; dz <= r && count < CAPACITY; dz++) {
      for (let dx = -r; dx <= r && count < CAPACITY; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const cellDist = Math.hypot((cx + 0.5) * CELL - x, (cz + 0.5) * CELL - z);
        if (cellDist > RADIUS + CELL) continue;
        const c = this.cell(cx, cz);
        for (let i = 0; i < c.n && count < CAPACITY; i++) {
          const dist = Math.hypot(c.x[i] - x, c.z[i] - z);
          if (dist > RADIUS) continue;
          // Full density close by, thinning toward the edge of the disc.
          if (dist > 28 && ((i * 7919) % 100) / 100 > 1 - ((dist - 28) / (RADIUS - 28)) * 0.7) continue;
          im.set(c.m.subarray(i * 16, i * 16 + 16), count * 16);
          ic.set(c.c.subarray(i * 3, i * 3 + 3), count * 3);
          count++;
        }
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    // Forget cells far behind so the cache stays small on long walks.
    if (this.cells.size > 2500) {
      for (const [k, c] of this.cells) {
        if (c.n === 0 || Math.hypot(c.x[0] - x, c.z[0] - z) > RADIUS * 2) this.cells.delete(k);
      }
    }
  }
}
