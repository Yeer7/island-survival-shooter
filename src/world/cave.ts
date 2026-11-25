import * as THREE from 'three';
import { AssetLibrary, AssetName } from '../assets/assets';
import { bakeStatic } from '../core/bake';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';
import { buildLog, logMaterials } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';
import { detailTextures } from './textures';

/** Interior space, far outside the island so it never shows from the surface. */
export const CAVE_ORIGIN = new THREE.Vector3(1900, 0, 0);
/** The chasm spans this stretch of the path (metres from the entrance, measured along -Z). */
const CHASM_Z0 = 35;
const CHASM_Z1 = 46;
const WATER_Y = -14;
const END_Z = 87;

// ------------------------------------------------------------------ noise

function hash(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 0xffff;
}

function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/** Fractal value noise in 0..1. */
function fbm(x: number, y: number, z: number, oct = 4): number {
  let a = 0.5;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    n += a;
    f *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ the path through the cave

interface Sample {
  x: number;
  z: number;
  /** Distance along -Z from the entrance (the profile is keyed on this). */
  d: number;
  tx: number;
  tz: number;
}

/** Local centre line: winding tunnel, a straight run over the chasm, then into the hall. */
const PATH: [number, number][] = [
  [0, 3], [0, -2], [3.2, -8], [2.6, -14], [-2.4, -20], [-3.6, -25], [-0.6, -30], [0, -33], [0, -48], [0, -51], [-3, -56], [-2, -62], [0, -68], [0, -90],
];

/** Half-width of the walkable floor along the path. */
function halfWidth(d: number): number {
  let w = 3.4 + 0.7 * Math.sin(d * 0.45) + 0.4 * Math.sin(d * 1.3 + 1);
  w += 2.6 * smooth(12, 16, d) * (1 - smooth(21, 25, d)); // the lost camp's alcove
  w = w + (6.2 - w) * smooth(31, 34, d) * (1 - smooth(47, 50, d)); // the chasm
  const hall = Math.max(0, 1 - ((d - 74) / 14) ** 2);
  w = Math.max(w, 12 * Math.sqrt(hall));
  if (d > END_Z - 3) w *= Math.max(0.15, (END_Z - d) / 3);
  if (d < 1) w *= Math.max(0.2, d + 0.2);
  return Math.max(0.4, w);
}

/** Ceiling height along the path. */
function ceiling(d: number): number {
  let h = 4.4 + 1.1 * Math.sin(d * 0.31 + 0.5);
  h = h + (8 - h) * smooth(31, 34, d) * (1 - smooth(47, 50, d));
  const hall = Math.max(0, 1 - ((d - 74) / 14) ** 2);
  h = Math.max(h, 11 * Math.sqrt(hall));
  return h;
}

/** How deep the walls go below the floor (the chasm drops to the water). */
function depth(d: number): number {
  return 1.5 + 16 * smooth(CHASM_Z0 - 1.5, CHASM_Z0 + 0.5, d) * (1 - smooth(CHASM_Z1 - 0.5, CHASM_Z1 + 1.5, d));
}

function buildPath(): Sample[] {
  const curve = new THREE.CatmullRomCurve3(PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = 260;
  const out: Sample[] = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, p);
    curve.getTangentAt(i / n, t);
    out.push({ x: p.x, z: p.z, d: -p.z, tx: t.x, tz: t.z });
  }
  return out;
}

// ------------------------------------------------------------------ textures

function causticTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#06343c';
  g.fillRect(0, 0, 128, 128);
  const r = mulberry32(5);
  // Soft light patches, then faint wavy caustic threads.
  for (let i = 0; i < 26; i++) {
    const x = r() * 128;
    const y = r() * 128;
    const rad = 10 + r() * 22;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(90,230,245,0.35)');
    grd.addColorStop(1, 'rgba(90,230,245,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.strokeStyle = 'rgba(160,250,255,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const y0 = r() * 128;
    for (let x = 0; x <= 128; x += 4) g.lineTo(x, y0 + Math.sin(x * 0.12 + i) * 5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface CaveLight {
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  distance: number;
  flicker: boolean;
}

/**
 * The north cave. Outside: a timbered grotto set into a wall of big rocks on the
 * northern range, lit by torches and marked with skulls, in the arena guarded by the
 * Cave Guardian. Inside, three spaces along one winding path: a tunnel with roots,
 * puddles, glowsticks and a lost camp; a deep chasm over glowing water spanned by a
 * broken rope bridge; and a tall cathedral hall with rock pillars, a crystal pool and
 * the floodlit table holding the tactical flashlight and the backpack.
 */
export class Cave {
  readonly outside = new THREE.Group();
  readonly inside = new THREE.Group();
  readonly mouth = new THREE.Vector3();
  readonly arena = new THREE.Vector3();
  /** Where the player stands right after entering / leaving. */
  readonly entryInside = new THREE.Vector3();
  readonly exitOutside = new THREE.Vector3();
  readonly bridgePos = new THREE.Vector3();
  readonly lootPos = new THREE.Vector3();
  readonly backpackPos = new THREE.Vector3();
  /** Light anchors inside: the game hands its pooled lights to the nearest ones. */
  readonly lights: CaveLight[] = [];
  /** Torch flames at the mouth (added to the scene by the game). */
  readonly fx: PuffEmitter[] = [];
  bridgeRepaired = false;
  private bridgeDeck = new THREE.Group();
  private brokenBits = new THREE.Group();
  private facing: number;
  private path: Sample[];
  private obstacles: { x: number; z: number; r: number }[] = [];
  private water: THREE.MeshStandardMaterial[] = [];
  private t = 0;

  constructor(
    private terrain: Terrain,
    colliders: ColliderGrid,
    private lib: AssetLibrary,
  ) {
    // Highest open ground on the northern range, away from the coast.
    let best = { x: 0, z: -170, score: -Infinity };
    for (let x = -150; x <= 150; x += 8) {
      for (let z = -215; z <= -140; z += 6) {
        if (terrain.coastDistance(x, z) < 22) continue;
        const h = terrain.height(x, z);
        const slope = terrain.slope(x, z);
        const score = h - slope * 40 - Math.abs(x) * 0.03;
        if (score > best.score) best = { x, z, score };
      }
    }
    // The mouth faces the island's centre; the arena opens in front of it.
    this.facing = Math.atan2(-best.x, -best.z);
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    this.mouth.set(best.x, terrain.height(best.x, best.z), best.z);
    this.arena.set(best.x + fx * 14, 0, best.z + fz * 14);
    this.arena.y = terrain.height(this.arena.x, this.arena.z);
    this.exitOutside.set(best.x + fx * 6, 0, best.z + fz * 6);
    this.exitOutside.y = terrain.height(this.exitOutside.x, this.exitOutside.z);

    this.path = buildPath();
    this.buildOutside(colliders, fx, fz);
    this.buildInside();
    this.entryInside.set(CAVE_ORIGIN.x, 0, CAVE_ORIGIN.z - 3);
  }

  // ---------------------------------------------------------------- helpers

  private model(name: AssetName, fit: { by: 'height' | 'max' | 'footprint'; value: number }): THREE.Group | null {
    if (!this.lib.has(name)) return null;
    const m = this.lib.instance(name, fit);
    m.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return m;
  }

  private logBetween(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Mesh {
    const d = new THREE.Vector3().subVectors(b, a);
    const log = buildLog(d.length(), r);
    log.position.copy(a).addScaledVector(d, 0.5);
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    log.castShadow = true;
    return log;
  }

  /** Nearest point of the centre line: its sample, the distance along and the signed lateral offset. */
  private locate(x: number, z: number): { i: number; d: number; lat: number } {
    const lx = x - CAVE_ORIGIN.x;
    const lz = z - CAVE_ORIGIN.z;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const s = this.path[i];
      const q = (s.x - lx) ** 2 + (s.z - lz) ** 2;
      if (q < bd) {
        bd = q;
        bi = i;
      }
    }
    const s = this.path[bi];
    const lat = (lx - s.x) * s.tz - (lz - s.z) * s.tx;
    const along = (lx - s.x) * s.tx + (lz - s.z) * s.tz;
    return { i: bi, d: s.d - along, lat };
  }

  /** World point at distance `d` along the path, `lat` metres to its right, `y` up. */
  private at(d: number, lat: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    let i = 0;
    while (i < this.path.length - 2 && this.path[i + 1].d < d) i++;
    const a = this.path[i];
    const b = this.path[i + 1];
    const t = Math.min(1, Math.max(0, (d - a.d) / Math.max(1e-4, b.d - a.d)));
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const tx = a.tx + (b.tx - a.tx) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const n = Math.hypot(tx, tz) || 1;
    return out.set(CAVE_ORIGIN.x + x + (tz / n) * lat, y, CAVE_ORIGIN.z + z - (tx / n) * lat);
  }

  /** Heading (rotation.y) that faces along the path at distance d. */
  private headingAt(d: number): number {
    const p = this.at(d, 0, 0);
    const q = this.at(d + 0.5, 0, 0);
    return Math.atan2(q.x - p.x, q.z - p.z);
  }

  // ---------------------------------------------------------------- outside

  private buildOutside(colliders: ColliderGrid, fx: number, fz: number): void {
    const rand = mulberry32(51);
    const rx = fz;
    const rz = -fx;
    const tex = detailTextures();
    const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8e8b84).multiplyScalar(1.2), roughness: 0.93, map: tex.rock, bumpMap: tex.rockBump, bumpScale: 3, flatShading: true });
    const W = (side: number, back: number, y = 0) => new THREE.Vector3(this.mouth.x + rx * side - fx * back, y, this.mouth.z + rz * side - fz * back);
    const rockAt = (name: AssetName, side: number, back: number, size: number, up: number) => {
      const r = this.lib.instance(name, { by: 'footprint', value: size });
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = stone;
          m.castShadow = m.receiveShadow = true;
        }
      });
      const p = W(side, back);
      const g = Math.min(this.terrain.height(p.x, p.z), this.terrain.height(p.x + 2, p.z), this.terrain.height(p.x - 2, p.z), this.terrain.height(p.x, p.z + 2), this.terrain.height(p.x, p.z - 2));
      r.position.set(p.x, g - size * 0.25 + up, p.z);
      r.rotation.y = rand() * Math.PI * 2;
      this.outside.add(r);
      colliders.add({ x: p.x, z: p.z, r: size * 0.42, y0: g - 2, y1: g + size, kind: 'rock', ref: 0 });
    };
    // A wall of big rocks with a gap for the mouth, one across the top and a cliff behind.
    for (const [side, back, size] of [
      [-5.6, 1, 7],
      [5.6, 1, 7],
      [-11, 3, 8],
      [11, 3, 8],
      [-16, 6, 7],
      [16, 6, 7],
      [0, 8, 10],
      [-6, 8, 9],
      [6, 8, 9],
    ]) {
      rockAt(rand() < 0.5 ? 'rockCliff' : 'rockLarge', side, back, size, 0);
    }
    rockAt('rockCliff', 0, 2.6, 7.5, 3.9);

    // The grotto: an organic throat going deep into the rock, darkening to black.
    const y0 = this.mouth.y;
    const throat = new THREE.Group();
    throat.position.set(this.mouth.x, y0, this.mouth.z);
    throat.rotation.y = this.facing + Math.PI;
    const rings = 16;
    const M = 20;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const depthIn = -1 + t * 11;
      const w = (2.7 - t * 1.3) * (i === rings ? 0.1 : 1);
      const h = (3.6 - t * 1.5) * (i === rings ? 0.1 : 1);
      const shade = Math.max(0.02, 1 - t * 1.25);
      for (let j = 0; j <= M; j++) {
        const a = (j / M) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        let x = ca * w;
        let y = sa >= 0 ? sa * h : sa * 0.8;
        const n = fbm(x * 0.5 + 3, y * 0.5, depthIn * 0.5, 3) * 0.9;
        x += ca * n;
        y += Math.max(0, sa) * n;
        pos.push(x, y, depthIn);
        col.push(0.55 * shade, 0.56 * shade, 0.6 * shade);
        uv.push((j / M) * 4, t * 3);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j;
        const b = a + M + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tex.rock, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, flatShading: true }));
    tm.receiveShadow = true;
    throat.add(tm);
    // Mud floor into the dark.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 10), new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.04, 4);
    throat.add(floor);
    // Timber props: two frames of posts, a lintel and braces.
    for (const dIn of [0.2, 3.4]) {
      const sz = 1 - dIn * 0.06;
      for (const s of [-1, 1]) {
        throat.add(this.logBetween(new THREE.Vector3(s * 2.05 * sz, -0.3, dIn), new THREE.Vector3(s * 1.95 * sz, 3.15 * sz, dIn), 0.14));
        throat.add(this.logBetween(new THREE.Vector3(s * 1.95 * sz, 2.25 * sz, dIn), new THREE.Vector3(s * 1.1 * sz, 3.0 * sz, dIn), 0.08));
      }
      throat.add(this.logBetween(new THREE.Vector3(-2.4 * sz, 3.1 * sz, dIn), new THREE.Vector3(2.4 * sz, 3.1 * sz, dIn), 0.13));
    }
    for (const s of [-1, 1]) throat.add(this.logBetween(new THREE.Vector3(s * 2.0, 3.0, 0.2), new THREE.Vector3(s * 1.8, 2.9, 3.4), 0.08));
    this.outside.add(throat);
    // Keep the player out of the throat (they go in with [E]).
    for (const dIn of [2, 4.5, 7]) {
      const p = W(0, dIn - 0.5);
      colliders.add({ x: p.x, z: p.z, r: 1.7, y0: y0 - 1, y1: y0 + 4, kind: 'rock', ref: 0 });
    }

    // Torches either side of the mouth.
    for (const s of [-1, 1]) {
      const p = W(s * 3.0, -0.6);
      p.y = this.terrain.height(p.x, p.z);
      const t = this.model('woodTorch', { by: 'height', value: 1.9 });
      if (t) {
        t.position.set(p.x, p.y - 0.25, p.z);
        this.outside.add(t);
      }
      const flame = new PuffEmitter(10, { life: 0.55, rise: 1.2, spread: 0.12, size0: 0.5, size1: 0.12, alpha: 0.9, color: 0xff6a1a, color2: 0xffd27a, additive: true });
      flame.origin.set(p.x, p.y + 1.5, p.z);
      flame.wind.set(0.15, 0, 0);
      this.fx.push(flame);
      colliders.add({ x: p.x, z: p.z, r: 0.15, y0: p.y - 1, y1: p.y + 2, kind: 'rock', ref: 0 });
    }
    // Skulls on stakes and a crossed-stick effigy as a warning; bones scattered.
    for (const [side, back] of [
      [-4.2, -2.4],
      [4.4, -2.0],
      [-2.2, -4.6],
    ]) {
      const p = W(side, back);
      p.y = this.terrain.height(p.x, p.z);
      this.outside.add(this.logBetween(new THREE.Vector3(p.x, p.y - 0.3, p.z), new THREE.Vector3(p.x, p.y + 1.7, p.z), 0.045));
      const sk = this.model('skull', { by: 'height', value: 0.28 });
      if (sk) {
        sk.position.set(p.x, p.y + 1.66, p.z);
        sk.rotation.y = this.facing + (rand() - 0.5) * 0.6;
        this.outside.add(sk);
      }
    }
    const e = W(3.4, -4.4);
    e.y = this.terrain.height(e.x, e.z);
    const ex = new THREE.Vector3(rx, 0, rz);
    for (const s of [-1, 1]) {
      this.outside.add(this.logBetween(e.clone().addScaledVector(ex, s * 0.7).setY(e.y - 0.2), e.clone().addScaledVector(ex, -s * 0.7).setY(e.y + 2.2), 0.05));
    }
    const esk = this.model('skull', { by: 'height', value: 0.32 });
    if (esk) {
      esk.position.set(e.x, e.y + 1.05, e.z);
      esk.rotation.y = this.facing;
      this.outside.add(esk);
    }
    for (let k = 0; k < 9; k++) {
      const p = W((rand() - 0.5) * 7, -1 - rand() * 6);
      const b = this.model('bone', { by: 'max', value: 0.35 + rand() * 0.25 });
      if (!b) break;
      b.position.set(p.x, this.terrain.height(p.x, p.z), p.z);
      b.rotation.set(0, rand() * 6, (rand() - 0.5) * 0.3);
      this.outside.add(b);
    }
  }

  // ---------------------------------------------------------------- inside

  private buildInside(): void {
    const o = CAVE_ORIGIN;
    const tex = detailTextures();
    const rand = mulberry32(77);
    const root = new THREE.Group();
    const P = this.path;

    // ---- the shell: one continuous organic tube along the path (FBM-displaced, wet slate)
    const M = 30;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i < P.length; i++) {
      const s = P[i];
      const w = halfWidth(s.d) + 0.3;
      const h = ceiling(s.d);
      const dn = depth(s.d);
      const n = Math.hypot(s.tx, s.tz) || 1;
      const nx = s.tz / n;
      const nz = -s.tx / n;
      for (let j = 0; j <= M; j++) {
        const a = (j / M) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const lat0 = ca * w;
        const y0 = sa >= 0 ? sa * h : sa * dn;
        const wx = o.x + s.x + nx * lat0;
        const wz = o.z + s.z + nz * lat0;
        // Bumps only push outward, so the walkable space is never narrower than the profile.
        const big = fbm(wx * 0.22, y0 * 0.3, wz * 0.22, 4);
        const fine = fbm(wx * 1.1 + 7, y0 * 1.1, wz * 1.1, 3);
        const out = big * 1.8 + fine * 0.45;
        const lat = lat0 + ca * out;
        const y = y0 + (sa > 0 ? sa * out * 0.9 : sa * out * 0.4);
        pos.push(o.x + s.x + nx * lat, y, o.z + s.z + nz * lat);
        // Wet slate: darker and bluer deep in the chasm, a teal sheen near the water.
        const deep = Math.min(1, Math.max(0, -y / 14));
        const wet = 0.85 + fine * 0.3;
        col.push((0.42 - deep * 0.25) * wet, (0.44 - deep * 0.2) * wet + deep * 0.06 * (y < -10 ? 1 : 0), (0.48 - deep * 0.14) * wet + (y < -10 ? 0.08 : 0));
        uv.push((j / M) * (w + h) * 0.7, s.d / 2.5);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < P.length - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j;
        const b = a + M + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    const slate = new THREE.MeshStandardMaterial({ map: tex.rock, bumpMap: tex.rockBump, bumpScale: 2.5, vertexColors: true, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide, flatShading: true });
    const shell = new THREE.Mesh(sg, slate);
    shell.receiveShadow = true;
    shell.userData.keep = true;
    this.inside.add(shell);

    // ---- the floor: a ribbon along the path with a hole over the chasm
    const fpos: number[] = [];
    const fuv: number[] = [];
    const fidx: number[] = [];
    const FW = 8;
    let row = 0;
    for (let i = 0; i < P.length; i++) {
      const s = P[i];
      if (s.d > CHASM_Z0 && s.d < CHASM_Z1) {
        row = 0;
        continue;
      }
      const w = halfWidth(s.d) + 0.9;
      const n = Math.hypot(s.tx, s.tz) || 1;
      const nx = s.tz / n;
      const nz = -s.tx / n;
      for (let j = 0; j <= FW; j++) {
        const lat = (j / FW - 0.5) * 2 * w;
        const x = o.x + s.x + nx * lat;
        const z = o.z + s.z + nz * lat;
        fpos.push(x, (fbm(x * 0.8, 0, z * 0.8, 2) - 0.5) * 0.06 - (Math.abs(lat) > w - 0.6 ? 0.08 : 0), z);
        fuv.push(lat / 2.5, s.d / 2.5);
      }
      const base = fpos.length / 3 - (FW + 1);
      if (row > 0) {
        for (let j = 0; j < FW; j++) {
          const a = base - (FW + 1) + j;
          const b = base + j;
          fidx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      row++;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(fidx);
    fg.computeVertexNormals();
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x4a4946, map: tex.rock, bumpMap: tex.rockBump, bumpScale: 1.5, roughness: 0.7, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(fg, floorMat);
    floor.receiveShadow = true;
    floor.userData.keep = true;
    this.inside.add(floor);

    this.buildTunnel(root, rand);
    this.buildChasm(root, rand);
    this.buildHall(root, rand);

    for (const m of bakeStatic(root)) m.receiveShadow = true;
    this.inside.add(root);
    this.bridgeDeck.visible = false;
    this.inside.add(this.bridgeDeck, this.brokenBits);
    // Ambient anchors at the entrance (cold daylight bleeding in).
    this.lights.push({ pos: this.at(1.5, 0, 2.5), color: 0x7f9cc4, intensity: 6, distance: 14, flicker: false });
  }

  /** Chamber 1: roots through the ceiling, puddles, rocks, glowsticks and a lost camp. */
  private buildTunnel(root: THREE.Group, rand: () => number): void {
    const bark = logMaterials()[0];
    // Roots: tangled ones crossing the ceiling and others dangling down.
    for (let k = 0; k < 18; k++) {
      const d = 3 + rand() * 28;
      const w = halfWidth(d);
      const h = ceiling(d);
      const pts: THREE.Vector3[] = [];
      if (k % 3 === 0) {
        const lat0 = -w - 0.5;
        const lat1 = w + 0.5;
        for (let s = 0; s <= 6; s++) {
          const t = s / 6;
          pts.push(this.at(d + (rand() - 0.5) * 0.6, lat0 + (lat1 - lat0) * t, h + 0.3 - Math.sin(t * Math.PI) * (0.6 + rand() * 0.5)));
        }
      } else {
        const lat = (rand() - 0.5) * w * 1.4;
        const len = 1.2 + rand() * 2.2;
        for (let s = 0; s <= 6; s++) {
          const t = s / 6;
          pts.push(this.at(d + Math.sin(t * 3 + k) * 0.25, lat + Math.sin(t * 4 + k) * 0.3, h + 0.6 - t * len));
        }
      }
      const r = k % 3 === 0 ? 0.11 : 0.05 + rand() * 0.04;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 6, false), bark);
      tube.castShadow = true;
      root.add(tube);
      // Rootlets off the hanging ones.
      if (k % 3 !== 0) {
        const tip = pts[pts.length - 1];
        for (let q = 0; q < 3; q++) {
          const end = tip.clone().add(new THREE.Vector3((rand() - 0.5) * 0.6, -0.3 - rand() * 0.5, (rand() - 0.5) * 0.6));
          root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([pts[pts.length - 2], tip, end]), 6, 0.018, 4, false), bark));
        }
      }
    }
    // Puddles of black water on the floor.
    const puddle = new THREE.MeshStandardMaterial({ color: 0x0b1820, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.9 });
    for (let k = 0; k < 8; k++) {
      const d = 4 + rand() * 28;
      const p = this.at(d, (rand() - 0.5) * halfWidth(d) * 1.2, 0.025);
      const pg = new THREE.CircleGeometry(0.6 + rand() * 0.9, 14);
      const pp = pg.attributes.position;
      for (let i = 1; i < pp.count; i++) {
        const k2 = 0.7 + vnoise(pp.getX(i) * 2 + k, pp.getY(i) * 2, 0) * 0.6;
        pp.setXY(i, pp.getX(i) * k2, pp.getY(i) * k2);
      }
      const m = new THREE.Mesh(pg, puddle);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(p);
      root.add(m);
    }
    // Rocks along the walls (solid).
    for (let k = 0; k < 14; k++) {
      const d = 2 + rand() * 30;
      const side = rand() < 0.5 ? -1 : 1;
      const w = halfWidth(d);
      const r = 0.5 + rand() * 0.9;
      const p = this.at(d, side * (w - r * 0.4), 0);
      const m = this.model(rand() < 0.5 ? 'rockMedium' : 'rockSmall', { by: 'footprint', value: r * 2 });
      if (!m) continue;
      m.position.set(p.x, -0.15, p.z);
      m.rotation.y = rand() * 6;
      root.add(m);
      this.obstacles.push({ x: p.x, z: p.z, r: r * 0.85 });
    }
    // Glowsticks left on the floor to mark the way: green, then red near the chasm.
    for (let d = 4, k = 0; d < 33; d += 4.2, k++) {
      const red = d > 22;
      const glow = new THREE.MeshStandardMaterial({ color: red ? 0xff4a4a : 0x5cff7a, emissive: red ? 0xff2020 : 0x30ff60, emissiveIntensity: 2.2 });
      const p = this.at(d, (k % 2 ? 1 : -1) * (halfWidth(d) - 1.1), 0.03);
      const g = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.15, 3, 6), glow);
      g.rotation.set(Math.PI / 2, 0, rand() * 6);
      g.position.copy(p);
      root.add(g);
      if (k % 3 === 1) this.lights.push({ pos: p.clone().setY(0.4), color: red ? 0xff3a3a : 0x46ff70, intensity: 2.5, distance: 7, flicker: false });
    }
    // The lost camp in the alcove: tent, crate with a dim lantern, bedroll, a cold fire.
    const cd = 18.5;
    const side = halfWidth(cd) - 2.2;
    const tentP = this.at(cd + 1.4, side, 0);
    const heading = this.headingAt(cd);
    const tent = this.model('tent', { by: 'max', value: 3.4 });
    if (tent) {
      tent.position.copy(tentP);
      tent.rotation.y = heading + Math.PI / 2;
      root.add(tent);
      this.obstacles.push({ x: tentP.x, z: tentP.z, r: 1.3 });
    }
    const crateP = this.at(cd - 1.2, side + 0.4, 0);
    const crate = this.model('crate', { by: 'height', value: 0.55 });
    if (crate) {
      crate.position.copy(crateP);
      crate.rotation.y = heading + 0.3;
      root.add(crate);
      this.obstacles.push({ x: crateP.x, z: crateP.z, r: 0.45 });
    }
    const lantern = this.lantern(0xffb25a);
    lantern.position.copy(crateP).y += 0.55;
    root.add(lantern);
    this.lights.push({ pos: crateP.clone().setY(0.9), color: 0xffa04a, intensity: 5, distance: 10, flicker: true });
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x5b5a3a, roughness: 1 }));
    roll.rotation.z = Math.PI / 2;
    roll.position.copy(this.at(cd + 1.6, side - 1.9, 0.16));
    root.add(roll);
    const can = this.model('can', { by: 'height', value: 0.2 });
    if (can) {
      can.position.copy(this.at(cd - 0.4, side - 0.9, 0));
      can.rotation.z = Math.PI / 2;
      root.add(can);
    }
    const ash = this.at(cd - 0.2, side - 1.6, 0.02);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.9, flatShading: true }));
      st.position.set(ash.x + Math.cos(a) * 0.4, 0.05, ash.z + Math.sin(a) * 0.4);
      root.add(st);
    }
    const coal = new THREE.Mesh(new THREE.CircleGeometry(0.32, 10), new THREE.MeshStandardMaterial({ color: 0x161412, roughness: 1 }));
    coal.rotation.x = -Math.PI / 2;
    coal.position.copy(ash);
    root.add(coal);
  }

  /** A small hurricane lantern with a glowing glass. */
  private lantern(color: number): THREE.Group {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2e2a25, roughness: 0.6, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: color, emissiveIntensity: 1.6, roughness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.04, 10), metal);
    base.position.y = 0.02;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), glass);
    body.position.y = 0.12;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 10), metal);
    cap.position.y = 0.24;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), metal);
    handle.position.y = 0.28;
    g.add(base, body, cap, handle);
    return g;
  }

  /** Chamber 2: the deep chasm over glowing water and the broken rope bridge. */
  private buildChasm(root: THREE.Group, rand: () => number): void {
    // Glowing underground water far below.
    const ct = causticTexture();
    ct.repeat.set(4, 3);
    const water = new THREE.MeshStandardMaterial({ color: 0x0d4a55, emissive: 0x1290a4, emissiveIntensity: 1.3, emissiveMap: ct, map: ct, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92 });
    this.water.push(water);
    const len = CHASM_Z1 - CHASM_Z0 + 6;
    const wp = new THREE.Mesh(new THREE.PlaneGeometry(22, len), water);
    wp.rotation.x = -Math.PI / 2;
    wp.position.copy(this.at((CHASM_Z0 + CHASM_Z1) / 2, 0, WATER_Y));
    wp.rotation.z = -this.headingAt(40) + Math.PI;
    wp.userData.keep = true;
    this.inside.add(wp);
    this.lights.push({ pos: this.at(40.5, 0, WATER_Y + 5), color: 0x3ad8e8, intensity: 14, distance: 30, flicker: false });
    // Rock fins dropping into the water along the walls.
    for (let k = 0; k < 8; k++) {
      const d = CHASM_Z0 + 0.5 + rand() * (CHASM_Z1 - CHASM_Z0 - 1);
      const side = k % 2 ? 1 : -1;
      const r = this.model('rockTall', { by: 'height', value: 7 + rand() * 5 });
      if (!r) continue;
      r.scale.x *= 0.5;
      r.scale.z *= 0.5;
      r.position.copy(this.at(d, side * (halfWidth(d) + 0.4), WATER_Y - 2));
      r.rotation.y = rand() * 6;
      root.add(r);
    }
    // Bridge: posts at both lips, hand ropes, snapped deck ropes and broken planks.
    const plank = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.15), roughness: 0.9, map: detailTextures().plank });
    const rope = new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 });
    const z0 = CHASM_Z0 - 0.6;
    const z1 = CHASM_Z1 + 0.6;
    const postTop: Record<string, THREE.Vector3> = {};
    for (const [dd, key] of [
      [z0, 'n'],
      [z1, 'f'],
    ] as [number, string][]) {
      for (const s of [-1, 1]) {
        const b = this.at(dd, s * 1.3, -0.5);
        const t = this.at(dd, s * 1.3, 1.35);
        root.add(this.logBetween(b, t, 0.1));
        postTop[key + s] = t.clone().setY(1.05);
        this.obstacles.push({ x: b.x, z: b.z, r: 0.2 });
      }
    }
    const ropeAlong = (a: THREE.Vector3, b: THREE.Vector3, sag: number, r: number, parent: THREE.Object3D, mat = rope) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag));
      }
      parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, r, 5, false), mat));
    };
    // Hand ropes still hang across (sagging).
    for (const s of [-1, 1]) ropeAlong(postTop['n' + s], postTop['f' + s], 0.9, 0.025, root);
    // Snapped deck ropes and planks dangling from each lip.
    for (const [dd, dir] of [
      [z0, 1],
      [z1, -1],
    ] as [number, number][]) {
      for (const s of [-1, 1]) {
        const a = this.at(dd, s * 1.15, -0.05);
        const b = this.at(dd + dir * 1.2, s * 1.0, -4.5 - rand() * 2);
        ropeAlong(a, b, -0.2, 0.02, this.brokenBits);
      }
      for (let k = 0; k < 2; k++) {
        const p = this.at(dd + dir * (0.25 + k * 0.42), 0, -0.02);
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.36), plank);
        b.position.copy(p);
        b.rotation.y = this.headingAt(dd) + Math.PI / 2;
        b.rotation.z = (rand() - 0.5) * 0.08;
        this.brokenBits.add(b);
      }
      for (let k = 0; k < 4; k++) {
        const p = this.at(dd + dir * 1.0, (rand() - 0.5) * 1.6, -1.2 - k * 0.9);
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.36), plank);
        b.position.copy(p);
        b.rotation.set(rand() * 0.5 + 1.1, this.headingAt(dd) + Math.PI / 2 + (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.4, 'YXZ');
        this.brokenBits.add(b);
      }
    }
    // Lantern on the near post guiding the way.
    const lp = postTop['n-1'].clone();
    const lantern = this.lantern(0xffb25a);
    lantern.position.set(lp.x, lp.y + 0.32, lp.z);
    root.add(lantern);
    this.lights.push({ pos: lp.clone().setY(lp.y + 0.6), color: 0xffa84e, intensity: 9, distance: 16, flicker: true });
    // The repaired deck: planks across with fresh rope rails.
    for (let dd = z0; dd <= z1; dd += 0.42) {
      const p = this.at(dd, 0, -0.02);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.36), plank);
      b.position.copy(p);
      b.rotation.y = this.headingAt(dd) + Math.PI / 2;
      b.rotation.z = (rand() - 0.5) * 0.04;
      b.castShadow = true;
      this.bridgeDeck.add(b);
    }
    for (const s of [-1, 1]) {
      ropeAlong(this.at(z0, s * 1.15, -0.05), this.at(z1, s * 1.15, -0.05), 0.0, 0.03, this.bridgeDeck);
      ropeAlong(postTop['n' + s].clone().setY(1.0), postTop['f' + s].clone().setY(1.0), 0.15, 0.03, this.bridgeDeck);
    }
    this.bridgePos.copy(this.at(CHASM_Z0 - 1.2, 0, 0));
  }

  /** Chamber 3: the cathedral hall with pillars, stalactites, a crystal pool, bones and the loot. */
  private buildHall(root: THREE.Group, rand: () => number): void {
    const C = 74;
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x6a6b70, roughness: 0.65, map: detailTextures().rock, bumpMap: detailTextures().rockBump, bumpScale: 3, flatShading: true });
    // Natural pillars, floor to ceiling.
    for (const [dd, lat] of [
      [66, -6.5],
      [70, 7],
      [79, -8],
      [82, 5.5],
    ] as [number, number][]) {
      const p = this.at(dd, lat, -0.5);
      const top = ceiling(dd) * Math.sqrt(Math.max(0.05, 1 - (lat / (halfWidth(dd) + 1)) ** 2)) + 1.5;
      for (const [name, frac] of [
        ['rockTall', 1],
        ['rockCliff', 0.45],
      ] as [AssetName, number][]) {
        const r = this.model(name, { by: 'height', value: top * frac + 0.5 });
        if (!r) continue;
        r.scale.x *= frac === 1 ? 0.38 : 0.7;
        r.scale.z *= frac === 1 ? 0.38 : 0.7;
        r.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = pillarMat;
        });
        r.position.copy(p);
        r.rotation.y = rand() * 6;
        if (frac < 1) r.position.y = top + 0.3;
        root.add(r);
        if (frac < 1) r.rotation.x = Math.PI;
      }
      this.obstacles.push({ x: p.x, z: p.z, r: 1.4 });
    }
    // Stalactite clusters hanging from the vault, stalagmites rising to meet them.
    const spike = new THREE.MeshStandardMaterial({ color: 0x7d7a74, roughness: 0.55, flatShading: true });
    for (let k = 0; k < 16; k++) {
      const dd = C - 11 + rand() * 22;
      const w = halfWidth(dd);
      const lat = (rand() - 0.5) * w * 1.5;
      const top = ceiling(dd) * Math.sqrt(Math.max(0.05, 1 - (lat / (w + 0.3)) ** 2));
      const n = 3 + Math.floor(rand() * 4);
      for (let q = 0; q < n; q++) {
        const h = 0.8 + rand() * 3.2;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.1 + h * 0.08, h, 7), spike);
        const p = this.at(dd + (rand() - 0.5) * 1.4, lat + (rand() - 0.5) * 1.4, top + 0.4 - h / 2);
        c.position.copy(p);
        c.rotation.set(Math.PI + (rand() - 0.5) * 0.15, rand() * 6, (rand() - 0.5) * 0.15);
        root.add(c);
      }
    }
    for (let k = 0; k < 14; k++) {
      const dd = C - 11 + rand() * 22;
      const w = halfWidth(dd);
      const lat = (rand() < 0.5 ? -1 : 1) * (w * (0.45 + rand() * 0.5));
      const h = 0.5 + rand() * 2.4;
      const p = this.at(dd, lat, h / 2 - 0.05);
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.15 + h * 0.12, h, 7), spike);
      c.position.copy(p);
      c.rotation.y = rand() * 6;
      root.add(c);
      if (h > 1) this.obstacles.push({ x: p.x, z: p.z, r: 0.25 + h * 0.08 });
    }
    // Crystal pool in a corner of the hall.
    const ct = causticTexture();
    ct.repeat.set(2, 2);
    const pool = new THREE.MeshStandardMaterial({ color: 0x1a8a9a, emissive: 0x0c7a8e, emissiveIntensity: 0.8, emissiveMap: ct, map: ct, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 });
    this.water.push(pool);
    const poolP = this.at(80, -6.2, 0.04);
    const pg = new THREE.CircleGeometry(3.6, 28);
    const pp = pg.attributes.position;
    for (let i = 1; i < pp.count; i++) {
      const k2 = 0.85 + vnoise(pp.getX(i) * 1.5, pp.getY(i) * 1.5, 3) * 0.3;
      pp.setXY(i, pp.getX(i) * k2, pp.getY(i) * k2);
    }
    const pm = new THREE.Mesh(pg, pool);
    pm.rotation.x = -Math.PI / 2;
    pm.position.copy(poolP);
    pm.userData.keep = true;
    this.inside.add(pm);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + rand() * 0.2, 0), spike);
      st.position.set(poolP.x + Math.cos(a) * 3.7, 0.05, poolP.z + Math.sin(a) * 3.7);
      st.scale.set(1, 0.55, 1);
      st.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      root.add(st);
    }
    this.lights.push({ pos: poolP.clone().setY(1.2), color: 0x48e0f0, intensity: 7, distance: 14, flicker: false });
    // Bones of those who came before.
    for (let k = 0; k < 14; k++) {
      const p = this.at(C - 9 + rand() * 16, (rand() - 0.5) * 14, 0);
      const b = this.model(k % 4 === 0 ? 'skull' : 'bone', k % 4 === 0 ? { by: 'height', value: 0.24 } : { by: 'max', value: 0.3 + rand() * 0.3 });
      if (!b) continue;
      b.position.copy(p);
      b.rotation.set(k % 4 === 0 ? (rand() - 0.5) * 0.6 : 0, rand() * 6, (rand() - 0.5) * 0.3);
      root.add(b);
    }
    // The treasure table: planks on two crates under a camp floodlight.
    const tp = this.at(C + 6, 3.2, 0);
    const hd = this.headingAt(C + 6);
    const across = new THREE.Vector3(Math.cos(hd), 0, -Math.sin(hd));
    for (const s of [-1, 1]) {
      const c = this.model('crate', { by: 'height', value: 0.62 });
      if (!c) continue;
      c.position.copy(tp).addScaledVector(across, s * 0.75);
      c.rotation.y = hd;
      root.add(c);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85, map: detailTextures().plank }));
    top.position.copy(tp).setY(0.65);
    top.rotation.y = hd + Math.PI / 2;
    root.add(top);
    this.obstacles.push({ x: tp.x, z: tp.z, r: 1.0 });
    this.lootPos.copy(tp).addScaledVector(across, -0.55).setY(0.68);
    this.backpackPos.copy(tp).addScaledVector(across, 0.55).setY(0.68);
    // Floodlight on a tripod aimed at the table.
    const fp = this.at(C + 3.6, 5.2, 0);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.4 });
    const head = new THREE.Vector3(fp.x, 2.1, fp.z);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const foot = new THREE.Vector3(fp.x + Math.cos(a) * 0.45, 0, fp.z + Math.sin(a) * 0.45);
      const d = new THREE.Vector3().subVectors(head, foot);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, d.length(), 5), metal);
      leg.position.copy(foot).addScaledVector(d, 0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      root.add(leg);
    }
    const box = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.2), metal);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 3 }));
    lens.position.z = 0.101;
    box.add(shell, lens);
    box.position.copy(head);
    box.lookAt(tp.x, 0.7, tp.z);
    root.add(box);
    this.obstacles.push({ x: fp.x, z: fp.z, r: 0.5 });
    this.lights.push({ pos: head.clone().lerp(new THREE.Vector3(tp.x, 0.9, tp.z), 0.3), color: 0xe6eeff, intensity: 26, distance: 18, flicker: false });
    // A cold fill high in the vault so the hall reads as big.
    this.lights.push({ pos: this.at(C - 2, 0, 8), color: 0x6f8fb8, intensity: 18, distance: 30, flicker: false });
  }

  // ---------------------------------------------------------------- behaviour

  setBridge(repaired: boolean): void {
    this.bridgeRepaired = repaired;
    this.bridgeDeck.visible = repaired;
    this.brokenBits.visible = !repaired;
  }

  /** Floor height inside (the chasm drops away until the bridge is fixed; only the deck holds). */
  groundAt(x: number, z: number): number {
    const { d, lat } = this.locate(x, z);
    if (d > CHASM_Z0 && d < CHASM_Z1) {
      if (!this.bridgeRepaired || Math.abs(lat) > 1.1) return -30;
    }
    return 0;
  }

  /** Keep the player inside the winding walls and off the rocks, pillars and props. */
  clamp(p: THREE.Vector3): void {
    for (let pass = 0; pass < 2; pass++) {
      const { i, d, lat } = this.locate(p.x, p.z);
      const s = this.path[i];
      const n = Math.hypot(s.tx, s.tz) || 1;
      const nx = s.tz / n;
      const nz = -s.tx / n;
      const lim = Math.max(0.3, halfWidth(Math.max(0, d)) - 0.35);
      if (Math.abs(lat) > lim) {
        const k = Math.sign(lat) * lim - lat;
        p.x += nx * k;
        p.z += nz * k;
      }
      if (d < 0.6) this.at(0.6, Math.max(-0.5, Math.min(0.5, lat)), p.y, p);
      if (d > END_Z - 3.2) this.at(END_Z - 3.2, Math.max(-1, Math.min(1, lat)), p.y, p);
    }
    for (const o of this.obstacles) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const dd = Math.hypot(dx, dz);
      const min = o.r + 0.35;
      if (dd < min && dd > 1e-4) {
        p.x += (dx / dd) * (min - dd);
        p.z += (dz / dd) * (min - dd);
      }
    }
  }

  isInside(p: THREE.Vector3): boolean {
    return Math.abs(p.x - CAVE_ORIGIN.x) < 80;
  }

  setViewportHeight(h: number): void {
    for (const e of this.fx) e.setViewportHeight(h);
  }

  update(dt: number, player: THREE.Vector3): void {
    this.t += dt;
    const near = Math.hypot(player.x - this.mouth.x, player.z - this.mouth.z) < 120;
    if (near) for (const e of this.fx) e.update(dt);
    if (this.isInside(player)) {
      for (const m of this.water) {
        if (m.map) {
          m.map.offset.x = Math.sin(this.t * 0.11) * 0.2;
          m.map.offset.y = this.t * 0.02;
        }
        m.emissiveIntensity = 1.15 + Math.sin(this.t * 0.9) * 0.2;
      }
    }
  }
}

/** The east altar: standing stones round a slab, braziers and bones. Lair of the Alpha Beast. */
export class Altar {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly radius = 20;

  constructor(terrain: Terrain, colliders: ColliderGrid, lib: AssetLibrary) {
    let best = { x: 180, z: 0, score: Infinity };
    for (let x = 140; x <= 215; x += 6) {
      for (let z = -70; z <= 70; z += 6) {
        if (terrain.coastDistance(x, z) < 28) continue;
        const h = terrain.height(x, z);
        if (h < 3) continue;
        let rough = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          rough += Math.abs(terrain.height(x + Math.cos(a) * 12, z + Math.sin(a) * 12) - h);
        }
        const score = rough + Math.abs(z) * 0.02;
        if (score < best.score) best = { x, z, score };
      }
    }
    this.center.set(best.x, terrain.height(best.x, best.z), best.z);
    const tex = detailTextures();
    const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x76736d).multiplyScalar(1.15), roughness: 0.93, map: tex.rock, bumpMap: tex.rockBump, bumpScale: 3, flatShading: true });
    const rand = mulberry32(303);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const x = this.center.x + Math.cos(a) * 11;
      const z = this.center.z + Math.sin(a) * 11;
      const r = lib.instance('rockTall', { by: 'height', value: 3.6 + rand() * 1.4 });
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = stone;
          m.castShadow = m.receiveShadow = true;
        }
      });
      const g = Math.min(terrain.height(x, z), terrain.height(x + 1, z), terrain.height(x - 1, z), terrain.height(x, z + 1), terrain.height(x, z - 1));
      r.position.set(x, g - 0.6, z);
      r.rotation.y = rand() * Math.PI * 2;
      this.group.add(r);
      colliders.add({ x, z, r: 0.9, y0: g - 1, y1: g + 4, kind: 'rock', ref: 0 });
    }
    // Slab altar with offerings.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.8), stone);
    slab.position.set(this.center.x, this.center.y + 0.3, this.center.z);
    slab.castShadow = slab.receiveShadow = true;
    this.group.add(slab);
    colliders.add({ x: this.center.x, z: this.center.z, r: 1.5, y0: this.center.y - 1, y1: this.center.y + 0.8, kind: 'rock', ref: 0 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), bone);
      s.position.set(this.center.x - 1.1 + k * 0.7, this.center.y + 0.88, this.center.z + (rand() - 0.5) * 0.6);
      this.group.add(s);
    }
    const ember = new THREE.MeshStandardMaterial({ color: 0x2a0a04, emissive: 0xff4a10, emissiveIntensity: 1.6 });
    for (const side of [-1, 1]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.35, 10), stone);
      const x = this.center.x + side * 3;
      const y = terrain.height(x, this.center.z);
      bowl.position.set(x, y + 0.9, this.center.z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), stone);
      leg.position.set(x, y + 0.4, this.center.z);
      const coals = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), ember);
      coals.position.set(x, y + 1.0, this.center.z);
      this.group.add(bowl, leg, coals);
    }
  }
}
