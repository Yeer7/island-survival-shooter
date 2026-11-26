import * as THREE from 'three';
import { AssetLibrary, AssetName } from '../assets/assets';
import { bakeStatic } from '../core/bake';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';
import { buildLog, logMaterials } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Suitcase } from './landmarks';
import { ItemType } from './pickups';
import { Terrain } from './terrain';
import { detailTextures } from './textures';

/** Interior space, far outside the island so it never shows from the surface. */
export const CAVE_ORIGIN = new THREE.Vector3(1900, 0, 0);
/** The chasm spans this stretch of the path (metres from the entrance, measured along -Z). */
const CHASM_Z0 = 35;
const CHASM_Z1 = 46;
const WATER_Y = -14;
const END_Z = 87;
/** How far the repaired bridge dips at its middle. */
const BRIDGE_SAG = 0.32;

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

let rockMaps: { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } | null = null;
const rockMats = new Map<number, THREE.MeshStandardMaterial>();
/**
 * Matte cave rock from the Poly Haven "Rock Face" scan (CC0): albedo, normal and
 * roughness at 512 px, tiled by world-scale UVs. One material per tint.
 */
function caveRock(tint = 0xffffff, vertexColors = false): THREE.MeshStandardMaterial {
  const key = tint + (vertexColors ? 0x1000000 : 0);
  const hit = rockMats.get(key);
  if (hit) return hit;
  if (!rockMaps) {
    const L = new THREE.TextureLoader();
    const load = (f: string, srgb: boolean) => {
      const t = L.load(`assets/textures/${f}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    rockMaps = { map: load('rock_face_diff_512.jpg', true), normal: load('rock_face_nor_gl_512.jpg', false), rough: load('rock_face_rough_512.jpg', false) };
  }
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    map: rockMaps.map,
    normalMap: rockMaps.normal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: rockMaps.rough,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    vertexColors,
    side: THREE.DoubleSide,
  });
  rockMats.set(key, m);
  return m;
}

const uvCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** Box-projected UVs (about three tiles across the model) so any rock model takes the rock texture. */
function boxUV(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = uvCache.get(src);
  if (hit) return hit;
  const g = src.index ? src.toNonIndexed() : src.clone();
  g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
  const k = 3 / size;
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (g.attributes.color) g.deleteAttribute('color');
  uvCache.set(src, g);
  return g;
}

const ROCK_MODELS = new Set(['rockMedium', 'rockSmall', 'rockTall', 'rockCliff', 'rockLarge', 'rockRound', 'pebble']);

let speleoMat: THREE.MeshStandardMaterial | null = null;
/** Wet limestone: rock texture with bump, slightly glossy. */
function limestone(): THREE.MeshStandardMaterial {
  if (!speleoMat) {
    const t = detailTextures();
    speleoMat = caveRock(0xd8d2c8);
    void t;
  }
  return speleoMat;
}

/**
 * A stalactite or stalagmite: a lathe with dripping bulges and rings, then every vertex
 * nudged by noise so no two are alike. Base at y=0, tip at y=h (flip for stalactites).
 */
function speleothem(h: number, r0: number, seed: number): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bulge = 1 + 0.22 * Math.sin(t * 9 + seed) + 0.1 * Math.sin(t * 23 + seed * 2);
    const r = i === n ? 0.001 : r0 * Math.pow(1 - t, 0.75) * bulge;
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * h));
  }
  const g = new THREE.LatheGeometry(pts, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (vnoise(x * 6 + seed, y * 3, z * 6) - 0.5) * 0.5;
    const lean = (vnoise(seed, y * 0.4, 1) - 0.5) * 0.25 * y;
    p.setXYZ(i, x * k + lean, y, z * k + lean * 0.5);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, limestone());
  m.castShadow = true;
  return m;
}

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
  /** Where the cave's skeletons and the Lord of the Depths stand guard. */
  readonly enemySpots = { skeletons: [] as THREE.Vector3[], guards: [] as THREE.Vector3[], lord: new THREE.Vector3() };
  /** The expedition chest in the hall (locked until the Lord of the Depths falls). */
  readonly chestPos = new THREE.Vector3();
  chestOpen = false;
  private chestLid = new THREE.Group();
  private lostCampCrate = new THREE.Vector3();
  private chestGlow: CaveLight | null = null;
  private chestGlowMat: THREE.MeshStandardMaterial | null = null;
  /** Crates and barrels inside that break like the luggage (the game adds them to its list). */
  readonly breakables: Suitcase[] = [];
  private puddles: THREE.Vector3[] = [];
  private floodHead = new THREE.Vector3();
  private floodTarget = new THREE.Vector3();
  private pillarSpots: [number, number][] = [
    [66, -6.5],
    [70, 7],
    [79, -8],
    [82, 5.5],
  ];
  // Ambient life: drips into the puddles, dust in the floodlight.
  private drops!: THREE.Points;
  private dropState: { y: number; v: number; p: THREE.Vector3 | null }[] = [];
  private rings: { m: THREE.Mesh; t: number }[] = [];
  private dripT = 0.5;
  private dust!: THREE.Points;
  private dustVel: Float32Array = new Float32Array(0);
  /** Called with the splash point when a drop lands (the game plays the sound). */
  onDrip: ((p: THREE.Vector3) => void) | null = null;

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
    const rock = ROCK_MODELS.has(name);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      if (rock) {
        mesh.geometry = boxUV(mesh.geometry);
        mesh.material = caveRock(0xb9b4ac);
      }
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
      let arc = 0;
      let px = 0;
      let py = 0;
      let pz = 0;
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
        const vx = o.x + s.x + nx * lat;
        const vz = o.z + s.z + nz * lat;
        if (j > 0) arc += Math.hypot(vx - px, y - py, vz - pz);
        px = vx;
        py = y;
        pz = vz;
        pos.push(vx, y, vz);
        // Wet slate: darker and bluer deep in the chasm, a teal sheen near the water.
        const deep = Math.min(1, Math.max(0, -y / 14));
        const wet = 0.85 + fine * 0.3;
        const lift = 1.9;
        col.push((0.42 - deep * 0.25) * wet * lift, ((0.44 - deep * 0.2) * wet + deep * 0.06 * (y < -10 ? 1 : 0)) * lift, ((0.48 - deep * 0.14) * wet + (y < -10 ? 0.08 : 0)) * lift);
        uv.push(arc / 2.4, s.d / 2.4);
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
    const slate = caveRock(0xffffff, true);
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
        fuv.push(lat / 2.4, s.d / 2.4);
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
    const floorMat = caveRock(0x8c8780);
    const floor = new THREE.Mesh(fg, floorMat);
    floor.receiveShadow = true;
    floor.userData.keep = true;
    this.inside.add(floor);

    this.buildTunnel(root, rand);
    this.buildChasm(root, rand);
    this.buildHall(root, rand);
    this.dress(root, rand);
    this.sealEnds(root, rand);

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
      this.puddles.push(p.clone());
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
    this.lostCampCrate.copy(crateP);
    this.enemySpots.skeletons.push(this.at(cd - 5, -1, 0), this.at(cd + 6, 1, 0));
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
    // Solid cliff faces dropping from both lips into the water (no floating floor edge).
    for (const [dd, face] of [
      [CHASM_Z0, 1],
      [CHASM_Z1, -1],
    ] as [number, number][]) {
      const w = halfWidth(dd) + 1.8;
      const cols = 18;
      const rows = 14;
      const cp: number[] = [];
      const cu: number[] = [];
      const ci: number[] = [];
      for (let r = 0; r <= rows; r++) {
        const y = 0.02 + ((WATER_Y - 2.5 - 0.02) * r) / rows;
        for (let c = 0; c <= cols; c++) {
          const lat = -w + (2 * w * c) / cols;
          const base = this.at(dd, lat, y);
          const bump = (fbm(base.x * 0.5, y * 0.5, base.z * 0.5, 4) - 0.35) * 1.6 * Math.min(1, r / 2);
          const p = this.at(dd + face * bump, lat, y);
          cp.push(p.x, p.y, p.z);
          cu.push(lat / 2.5, y / 2.5);
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = r * (cols + 1) + c;
          const b = a + cols + 1;
          ci.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
      cg.setIndex(ci);
      cg.computeVertexNormals();
      const cliff = new THREE.Mesh(cg, caveRock(0x9a9690));
      cliff.receiveShadow = true;
      root.add(cliff);
      // Boulders bulging out of each face.
      for (let k = 0; k < 4; k++) {
        const r = this.model('rockCliff', { by: 'footprint', value: 2.5 + rand() * 2 });
        if (!r) continue;
        r.position.copy(this.at(dd + face * 0.6, (rand() - 0.5) * w * 1.6, -3 - rand() * 9));
        r.rotation.set(rand() * 3, rand() * 6, rand() * 3);
        root.add(r);
      }
    }
    // Suspension bridge: posts at both lips, two thick cables under the deck, hand ropes,
    // vertical hangers every 1.2 m. Broken: only stubs and dangling planks remain.
    const plank = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.15), roughness: 0.9, map: detailTextures().plank });
    const rope = new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 });
    const z0 = CHASM_Z0 - 0.6;
    const z1 = CHASM_Z1 + 0.6;
    const span = z1 - z0;
    const sagAt = (dd: number) => -BRIDGE_SAG * Math.sin(Math.min(1, Math.max(0, (dd - z0) / span)) * Math.PI);
    const postTop: Record<string, THREE.Vector3> = {};
    for (const [dd, key] of [
      [z0, 'n'],
      [z1, 'f'],
    ] as [number, string][]) {
      for (const s of [-1, 1]) {
        const b = this.at(dd, s * 1.35, -0.6);
        const t = this.at(dd, s * 1.35, 1.4);
        root.add(this.logBetween(b, t, 0.11));
        postTop[key + s] = t.clone().setY(1.1);
        this.obstacles.push({ x: b.x, z: b.z, r: 0.2 });
      }
    }
    const tube = (pts: THREE.Vector3[], r: number, parent: THREE.Object3D) => parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), r, 6, false), rope));
    /** A rope following the bridge's catenary at height `y` above the deck line, `extra` more sag. */
    const cable = (lat: number, y: number, extra: number, parent: THREE.Object3D, from = z0, to = z1) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const dd = from + ((to - from) * i) / 16;
        const t = (dd - z0) / span;
        pts.push(this.at(dd, lat, y + sagAt(dd) - extra * Math.sin(t * Math.PI)));
      }
      tube(pts, lat === 0 ? 0.02 : 0.045, parent);
    };
    const hangers = (parent: THREE.Object3D, from: number, to: number) => {
      for (let dd = from; dd <= to + 0.01; dd += 1.2) {
        for (const s of [-1, 1]) {
          const t = (dd - z0) / span;
          const top = this.at(dd, s * 1.25, 1.05 + sagAt(dd) - 0.1 * Math.sin(t * Math.PI));
          const bot = this.at(dd, s * 1.2, sagAt(dd) - 0.04);
          tube([top, bot], 0.014, parent);
        }
      }
    };
    // Hand ropes still hang across when broken (sagging more).
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(postTop['n' + s].clone().lerp(postTop['f' + s], t).setY(1.1 - Math.sin(t * Math.PI) * 1.2));
      }
      tube(pts, 0.03, this.brokenBits);
    }
    // Snapped deck cables and planks dangling from each lip.
    for (const [dd, dir] of [
      [z0, 1],
      [z1, -1],
    ] as [number, number][]) {
      for (const s of [-1, 1]) {
        const a = this.at(dd, s * 1.2, -0.05);
        const m = this.at(dd + dir * 0.9, s * 1.15, -2.2);
        const b = this.at(dd + dir * 1.2, s * 1.0, -4.5 - rand() * 2);
        tube([a, m, b], 0.04, this.brokenBits);
      }
      for (let k = 0; k < 2; k++) {
        const p = this.at(dd + dir * (0.25 + k * 0.42), 0, -0.03);
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.34), plank);
        b.position.copy(p);
        b.rotation.y = this.headingAt(dd);
        b.rotation.z = (rand() - 0.5) * 0.08;
        this.brokenBits.add(b);
      }
      for (let k = 0; k < 4; k++) {
        const p = this.at(dd + dir * 1.0, (rand() - 0.5) * 1.6, -1.2 - k * 0.9);
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.34), plank);
        b.position.copy(p);
        b.rotation.set(rand() * 0.5 + 1.1, this.headingAt(dd) + (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.4, 'YXZ');
        this.brokenBits.add(b);
      }
    }
    // Lantern on the near post guiding the way.
    const lp = postTop['n-1'].clone();
    const lantern = this.lantern(0xffb25a);
    lantern.position.set(lp.x, lp.y + 0.32, lp.z);
    root.add(lantern);
    this.lights.push({ pos: lp.clone().setY(lp.y + 0.6), color: 0xffa84e, intensity: 9, distance: 16, flicker: true });
    // The repaired deck: 2.4 m planks laid across two thick cables, following the sag.
    for (let dd = z0; dd <= z1 + 0.01; dd += 0.4) {
      const p = this.at(dd, 0, sagAt(dd) - 0.02);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.07, 0.34), plank);
      b.position.copy(p);
      b.rotation.y = this.headingAt(dd);
      b.rotation.z = (rand() - 0.5) * 0.04;
      b.castShadow = true;
      b.receiveShadow = true;
      this.bridgeDeck.add(b);
    }
    for (const s of [-1, 1]) {
      cable(s * 1.05, -0.09, 0, this.bridgeDeck);
      cable(s * 1.25, 1.05, 0.1, this.bridgeDeck);
    }
    hangers(this.bridgeDeck, z0 + 0.6, z1 - 0.6);
    this.bridgePos.copy(this.at(CHASM_Z0 - 1.2, 0, 0));
  }

  /** Chamber 3: the cathedral hall with pillars, stalactites, a crystal pool, bones and the loot. */
  private buildHall(root: THREE.Group, rand: () => number): void {
    const C = 74;
    const pillarMat = caveRock(0xa8a39b);
    // Natural pillars, floor to ceiling.
    for (const [dd, lat] of this.pillarSpots) {
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
          if ((o as THREE.Mesh).isMesh) {
            (o as THREE.Mesh).geometry = boxUV((o as THREE.Mesh).geometry);
            (o as THREE.Mesh).material = pillarMat;
          }
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
    const spike = limestone();
    for (let k = 0; k < 16; k++) {
      const dd = C - 11 + rand() * 22;
      const w = halfWidth(dd);
      const lat = (rand() - 0.5) * w * 1.5;
      const top = ceiling(dd) * Math.sqrt(Math.max(0.05, 1 - (lat / (w + 0.3)) ** 2));
      const n = 3 + Math.floor(rand() * 4);
      for (let q = 0; q < n; q++) {
        const h = 0.8 + rand() * 3.2;
        const c = speleothem(h, 0.12 + h * 0.09, k * 7 + q);
        const p = this.at(dd + (rand() - 0.5) * 1.4, lat + (rand() - 0.5) * 1.4, top + 0.4);
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
      const p = this.at(dd, lat, -0.05);
      const c = speleothem(h, 0.18 + h * 0.13, k * 13 + 3);
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
    // The expedition camp: a proper table with a radio, a tent, a fuel can and the locked chest.
    const tp = this.at(C + 6, 3.4, 0);
    const hd = this.headingAt(C + 6);
    const across = new THREE.Vector3(Math.cos(hd), 0, -Math.sin(hd));
    const along = new THREE.Vector3(Math.sin(hd), 0, Math.cos(hd));
    const table = this.buildTable();
    table.position.copy(tp);
    table.rotation.y = hd;
    root.add(table);
    this.obstacles.push({ x: tp.x, z: tp.z, r: 0.9 });
    const radio = this.model('radio', { by: 'max', value: 0.42 });
    if (radio) {
      radio.position.copy(tp).addScaledVector(across, -0.35).setY(0.79);
      radio.rotation.y = hd + Math.PI + 0.3;
      root.add(radio);
    }
    const lamp = this.lantern(0xffc070);
    lamp.position.copy(tp).addScaledVector(across, 0.45).addScaledVector(along, 0.1).setY(0.79);
    root.add(lamp);
    // A map weighed down on the table.
    const map = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshStandardMaterial({ color: 0xd8c9a2, roughness: 0.95 }));
    map.rotation.set(-Math.PI / 2, 0, hd + 0.2);
    map.position.copy(tp).addScaledVector(across, 0.05).setY(0.795);
    root.add(map);
    const gas = this.model('gasCan', { by: 'height', value: 0.45 });
    if (gas) {
      gas.position.copy(tp).addScaledVector(across, 1.3).addScaledVector(along, -0.4);
      gas.rotation.y = hd + 0.6;
      root.add(gas);
    }
    const tentP = this.at(C + 9.5, -3.5, 0);
    const tent = this.model('tent', { by: 'max', value: 3.6 });
    if (tent) {
      tent.position.copy(tentP);
      tent.rotation.y = this.headingAt(C + 9.5) + Math.PI / 2;
      root.add(tent);
      this.obstacles.push({ x: tentP.x, z: tentP.z, r: 1.4 });
    }
    // The locked expedition chest (kept apart: its lid opens).
    const chestP = this.at(C + 3, 6.0, 0);
    const chest = this.buildChest();
    chest.position.copy(chestP);
    chest.rotation.y = Math.atan2(tp.x - chestP.x, tp.z - chestP.z);
    this.inside.add(chest);
    this.chestPos.copy(chestP);
    this.obstacles.push({ x: chestP.x, z: chestP.z, r: 0.6 });
    const front = new THREE.Vector3(Math.sin(chest.rotation.y), 0, Math.cos(chest.rotation.y));
    this.backpackPos.copy(chestP).addScaledVector(front, 0.85).setY(0);
    this.chestGlow = { pos: chestP.clone().setY(0.9), color: 0xffc76a, intensity: 0, distance: 8, flicker: false };
    this.lights.push(this.chestGlow);
    // The flashlight waits at the lost camp in the first chamber.
    this.lootPos.copy(this.lostCampCrate).setY(0.56);
    // Where the guards stand.
    this.enemySpots.guards.push(this.at(C - 6, -3, 0), this.at(C - 3, 4.5, 0));
    this.enemySpots.lord.copy(this.at(C + 2, -1, 0));
    // Floodlight on a tripod aimed at the table.
    const fp = this.at(C + 3.6, 5.2, 0);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.4 });
    const head = new THREE.Vector3(fp.x, 2.1, fp.z);
    this.floodHead.copy(head);
    this.floodTarget.copy(tp).setY(0.8);
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
    box.lookAt(tp.x, 0.75, tp.z);
    root.add(box);
    this.obstacles.push({ x: fp.x, z: fp.z, r: 0.5 });
    this.lights.push({ pos: head.clone().lerp(new THREE.Vector3(tp.x, 0.9, tp.z), 0.3), color: 0xe6eeff, intensity: 26, distance: 18, flicker: false });
    // A cold fill high in the vault so the hall reads as big.
    this.lights.push({ pos: this.at(C - 2, 0, 8), color: 0x6f8fb8, intensity: 18, distance: 30, flicker: false });
  }

  /**
   * A rough rock face across the path at distance `d`, spanning lateral lat0..lat1 and
   * heights y0..y1. FBM bumps only push away from the player's side (`face` = +1 when
   * the player stands at larger d), so the walkable space never shrinks.
   */
  private rockPanel(root: THREE.Object3D, d: number, face: number, lat0: number, lat1: number, y0: number, y1: number): void {
    const cols = Math.max(4, Math.round((lat1 - lat0) / 0.5));
    const rows = Math.max(4, Math.round((y1 - y0) / 0.5));
    const cp: number[] = [];
    const cu: number[] = [];
    const ci: number[] = [];
    for (let r = 0; r <= rows; r++) {
      const y = y0 + ((y1 - y0) * r) / rows;
      for (let c = 0; c <= cols; c++) {
        const lat = lat0 + ((lat1 - lat0) * c) / cols;
        const base = this.at(d, lat, y);
        const bump = Math.max(0, fbm(base.x * 0.45 + 11, y * 0.45, base.z * 0.45, 4) - 0.3) * 2.2;
        const p = this.at(d - face * bump, lat, y);
        cp.push(p.x, p.y, p.z);
        cu.push(lat / 2.4, y / 2.4);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + cols + 1;
        ci.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    g.setIndex(ci);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, caveRock(0xa09b94));
    m.receiveShadow = true;
    m.castShadow = true;
    root.add(m);
  }

  /** Close the far end of the hall with solid rock, and make the way out a narrow lit fissure. */
  private sealEnds(root: THREE.Group, rand: () => number): void {
    // Back of the cathedral: a full rock wall with boulders and formations at its foot.
    const bd = END_Z - 2.6;
    const bw = halfWidth(bd) + 3;
    this.rockPanel(root, bd, -1, -bw, bw, -1.5, ceiling(bd) + 3);
    for (let k = 0; k < 5; k++) {
      const r = this.model(k % 2 ? 'rockCliff' : 'rockLarge', { by: 'footprint', value: 2.2 + rand() * 2.2 });
      if (!r) continue;
      const lat = -bw * 0.7 + (k / 4) * bw * 1.4 + (rand() - 0.5);
      const p = this.at(bd + 0.2, lat, -0.4);
      r.position.copy(p);
      r.rotation.y = rand() * 6;
      root.add(r);
      this.obstacles.push({ x: p.x, z: p.z, r: 0.9 });
    }
    for (let k = 0; k < 6; k++) {
      const h = 0.6 + rand() * 1.8;
      const c = speleothem(h, 0.2 + h * 0.12, 90 + k);
      c.position.copy(this.at(bd - 0.8 - rand() * 0.8, (rand() - 0.5) * bw * 1.4, -0.05));
      root.add(c);
    }
    // The way out: rock closes in, leaving a narrow fissure with daylight behind it.
    const ed = 0.45;
    const ew = halfWidth(1) + 3;
    const eh = ceiling(1) + 2.5;
    const gap = 0.42;
    this.rockPanel(root, ed, 1, -ew, -gap, -1, eh);
    this.rockPanel(root, ed, 1, gap, ew, -1, eh);
    this.rockPanel(root, ed, 1, -gap - 0.05, gap + 0.05, 2.5, eh);
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(200,225,255,0.95)');
    grd.addColorStop(1, 'rgba(120,160,220,0.55)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const light = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    light.position.copy(this.at(ed - 0.12, 0, 1.25));
    light.rotation.y = this.headingAt(ed) + Math.PI;
    light.userData.keep = true;
    this.inside.add(light);
    // A faint shaft of that light spilling onto the floor.
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.6), new THREE.MeshBasicMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    shaft.rotation.x = -Math.PI / 2;
    shaft.rotation.z = -this.headingAt(1.6);
    shaft.position.copy(this.at(1.6, 0, 0.04));
    shaft.userData.keep = true;
    this.inside.add(shaft);
  }

  /** Recolour a model's meshes with one material (for glowing crystals and bioluminescent caps). */
  private paint(o: THREE.Object3D, mat: THREE.Material): void {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = mat;
    });
  }

  /**
   * Fills the cave: mine props holding up the tunnel, a plank walkway over the mud,
   * glowing crystals and cave mushrooms, rubble along every wall, the remains of lost
   * explorers, breakable supply crates, drips and dust.
   */
  private dress(root: THREE.Group, rand: () => number): void {
    const wetPlank = new THREE.MeshStandardMaterial({ color: 0x5e4630, roughness: 0.45, map: detailTextures().plank });
    // ---- mine props: two posts, a cap beam and braces, holding up the tunnel roof
    for (const d of [5.5, 10.5, 26.5, 30.5, 54]) {
      const w = halfWidth(d) - 0.25;
      const top = Math.min(ceiling(d) - 0.2, 3.8);
      const a = this.at(d, -w, -0.2);
      const b = this.at(d, w, -0.2);
      const at = a.clone().setY(top);
      const bt = b.clone().setY(top);
      root.add(this.logBetween(a, at, 0.13), this.logBetween(b, bt, 0.13));
      root.add(this.logBetween(this.at(d, -w - 0.3, top + 0.05), this.at(d, w + 0.3, top + 0.05), 0.15));
      root.add(this.logBetween(this.at(d, -w, top - 0.9), this.at(d, -w + 0.9, top), 0.07));
      root.add(this.logBetween(this.at(d, w, top - 0.9), this.at(d, w - 0.9, top), 0.07));
      // A lantern hook and planks wedged above the beam.
      for (let k = -1; k <= 1; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 1.4), wetPlank);
        plank.position.copy(this.at(d, k * 0.7, top + 0.22));
        plank.rotation.y = this.headingAt(d);
        root.add(plank);
      }
      this.obstacles.push({ x: a.x, z: a.z, r: 0.22 }, { x: b.x, z: b.z, r: 0.22 });
    }
    // ---- a crooked plank walkway over the mud and puddles
    for (let d = 1.5; d < 33.5; d += 0.34 + rand() * 0.12) {
      if (rand() < 0.12) continue;
      const lat = Math.sin(d * 0.35) * 0.4 + (rand() - 0.5) * 0.12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.1 + rand() * 0.3, 0.05, 0.24), wetPlank);
      b.position.copy(this.at(d, lat, 0.035));
      b.rotation.set((rand() - 0.5) * 0.06, this.headingAt(d) + (rand() - 0.5) * 0.25, (rand() - 0.5) * 0.06);
      b.receiveShadow = true;
      root.add(b);
    }
    for (let d = 47.5; d < 60; d += 0.36 + rand() * 0.12) {
      if (rand() < 0.15) continue;
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.0 + rand() * 0.3, 0.05, 0.24), wetPlank);
      b.position.copy(this.at(d, (rand() - 0.5) * 0.2, 0.035));
      b.rotation.set(0, this.headingAt(d) + (rand() - 0.5) * 0.25, 0);
      root.add(b);
    }

    // ---- glowing crystals
    const cyan = new THREE.MeshStandardMaterial({ color: 0x7fe8ff, emissive: 0x2ab8d8, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.1, flatShading: true });
    const amber = new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xd87a1a, emissiveIntensity: 1.3, roughness: 0.2, metalness: 0.1, flatShading: true });
    const crystal = (p: THREE.Vector3, size: number, glow: THREE.Material, light: boolean) => {
      const name = rand() < 0.5 ? 'crystalCluster' : rand() < 0.5 ? 'crystalSpire' : 'mineral';
      const c = this.model(name as AssetName, { by: 'max', value: size });
      if (!c) return;
      this.paint(c, glow);
      c.position.copy(p);
      c.rotation.set((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4);
      root.add(c);
      if (light) this.lights.push({ pos: p.clone().setY(p.y + 0.6), color: glow === cyan ? 0x58dcff : 0xffa850, intensity: 3.5, distance: 7, flicker: false });
    };
    // In the corners of the tunnel.
    for (const [d, side, mat] of [
      [7, 1, cyan],
      [13, -1, cyan],
      [22, -1, amber],
      [28.5, 1, cyan],
      [32.5, -1, amber],
    ] as [number, number, THREE.Material][]) {
      const w = halfWidth(d);
      for (let k = 0; k < 3; k++) crystal(this.at(d + (rand() - 0.5) * 1.2, side * (w - 0.1 - rand() * 0.3), -0.05), 0.4 + rand() * 0.5, mat, k === 0);
    }
    // Round the cathedral pillars.
    this.pillarSpots.forEach(([d, lat], i) => {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + rand();
        const p = this.at(d + Math.cos(a) * 1.7, lat + Math.sin(a) * 1.7, -0.05);
        crystal(p, 0.5 + rand() * 0.8, i % 2 ? amber : cyan, k === 0);
      }
    });
    // On the chasm cliffs.
    for (const [d, face] of [
      [CHASM_Z0, 1],
      [CHASM_Z1, -1],
    ] as [number, number][]) {
      for (let k = 0; k < 5; k++) crystal(this.at(d + face * 0.4, (rand() - 0.5) * 9, -1.5 - rand() * 9), 0.6 + rand() * 0.8, cyan, k === 2);
    }

    // ---- cave mushrooms, faintly glowing caps
    const shroomGlow = new THREE.Color(0x203a2a);
    const shroom = (p: THREE.Vector3, size: number) => {
      const m = this.model(rand() < 0.55 ? 'mushroomCluster' : 'mushroom', { by: 'height', value: size });
      if (!m) return;
      m.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh && !Array.isArray(mesh.material)) {
          const mm = (mesh.material as THREE.MeshStandardMaterial).clone();
          mm.emissive = shroomGlow;
          mm.emissiveIntensity = 1;
          mesh.material = mm;
        }
      });
      m.position.copy(p);
      m.rotation.y = rand() * 6;
      root.add(m);
    };
    for (let k = 0; k < 16; k++) {
      const d = 2 + rand() * 31;
      if (d > 14 && d < 24) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const base = this.at(d, side * (halfWidth(d) - 0.2), 0);
      for (let q = 0; q < 3; q++) shroom(base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6)), 0.15 + rand() * 0.3);
    }
    this.pillarSpots.forEach(([d, lat]) => {
      for (let q = 0; q < 4; q++) {
        const a = rand() * 6.28;
        shroom(this.at(d + Math.cos(a) * 1.5, lat + Math.sin(a) * 1.5, 0), 0.2 + rand() * 0.35);
      }
    });

    // ---- rubble along every wall
    for (let i = 0; i < 150; i++) {
      const d = 1 + rand() * (END_Z - 4);
      if (d > CHASM_Z0 - 0.5 && d < CHASM_Z1 + 0.5) continue;
      const w = halfWidth(d);
      const side = rand() < 0.5 ? -1 : 1;
      const big = rand() < 0.2;
      const name: AssetName = big ? 'rockMedium' : rand() < 0.5 ? 'rockSmall' : 'pebble';
      const size = big ? 0.6 + rand() * 0.6 : 0.15 + rand() * 0.35;
      const r = this.model(name, { by: 'footprint', value: size });
      if (!r) continue;
      const p = this.at(d, side * (w + 0.15 - rand() * 0.6), -size * 0.25);
      r.position.copy(p);
      r.rotation.set(rand() * 3, rand() * 6, rand() * 3);
      root.add(r);
      if (big) this.obstacles.push({ x: p.x, z: p.z, r: size * 0.4 });
    }

    // ---- remains of lost explorers
    const bone = (p: THREE.Vector3, len: number, yaw: number, tilt = 0) => {
      const b = this.model('bone', { by: 'max', value: len });
      if (!b) return;
      b.position.copy(p);
      b.rotation.set(0, yaw, tilt);
      root.add(b);
    };
    const remains = (d: number, side: number, kit: AssetName[]) => {
      const w = halfWidth(d);
      const lat = side * (w - 0.55);
      const base = this.at(d, lat, 0);
      const toWall = this.headingAt(d) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      // Slumped against a rock: skull, ribs, arms and legs.
      const rock = this.model('rockMedium', { by: 'footprint', value: 1.1 });
      if (rock) {
        rock.position.copy(this.at(d, side * (w + 0.1), -0.2));
        root.add(rock);
      }
      const sk = this.model('skull', { by: 'height', value: 0.23 });
      if (sk) {
        sk.position.copy(base).y += 0.5;
        sk.rotation.set(0.5, toWall + Math.PI, 0.3);
        root.add(sk);
      }
      for (let k = 0; k < 5; k++) bone(base.clone().add(new THREE.Vector3(0, 0.12 + k * 0.07, 0)), 0.32, toWall + Math.PI / 2, 0.15 * (k - 2));
      for (const s of [-1, 1]) {
        bone(this.at(d + s * 0.35, side * (w - 1.1), 0.02), 0.55, this.headingAt(d) + Math.PI / 2 + s * 0.2);
        bone(this.at(d + s * 0.4, side * (w - 0.5), 0.3), 0.4, toWall, 0.8);
      }
      kit.forEach((name, i) => {
        const m = this.model(name, name === 'shovel' ? { by: 'height', value: 1.1 } : name === 'backpack' ? { by: 'height', value: 0.45 } : { by: 'max', value: 0.3 });
        if (!m) return;
        const off = this.at(d + (i - (kit.length - 1) / 2) * 0.7, side * (w - 1.2 - (i % 2) * 0.3), 0);
        m.position.copy(off);
        if (name === 'shovel') {
          m.position.copy(this.at(d + 0.9, side * (w - 0.25), 0));
          m.rotation.set(0, toWall, side * 0.35);
        } else m.rotation.set(name === 'canOpen' || name === 'waterBottle' ? Math.PI / 2 : 0, rand() * 6, 0);
        root.add(m);
      });
      this.obstacles.push({ x: base.x, z: base.z, r: 0.5 });
    };
    remains(8.5, 1, ['shovel', 'waterBottle', 'canOpen']);
    remains(29.5, -1, ['backpack', 'battery', 'pan', 'canOpen']);
    remains(57.5, 1, ['shovel', 'propane', 'waterBottle']);

    // ---- breakable supply crates and barrels (food, bandage, cloth for the boss fight)
    const loot: [number, number, 'crate' | 'barrel', ItemType[]][] = [
      [9.8, -1, 'crate', ['food', 'bandage']],
      [25.5, 1, 'barrel', ['cloth', 'food']],
      [59.5, -1, 'crate', ['bandage', 'bandage']],
      [61, 1, 'barrel', ['food', 'cloth']],
    ];
    for (const [d, side, kind, contents] of loot) {
      const p = this.at(d, side * (halfWidth(d) - 0.9), 0);
      const g = new THREE.Group();
      const m = this.model(kind, { by: 'height', value: kind === 'crate' ? 0.62 : 0.9 });
      if (m) g.add(m);
      g.position.copy(p);
      g.rotation.y = rand() * 6;
      this.breakables.push({ mesh: g, pos: p.clone().setY(kind === 'crate' ? 0.31 : 0.45), hp: 50, color: 0x6b4a2e, contents, broken: false });
    }

    // ---- drips into the puddles
    const n = 10;
    const pos = new Float32Array(n * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.drops = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.05, transparent: true, opacity: 0.8, depthWrite: false }));
    this.drops.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 1] = -100;
      this.dropState.push({ y: -100, v: 0, p: null });
    }
    this.inside.add(this.drops);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd6f0ff, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 20), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.inside.add(ring);
      this.rings.push({ m: ring, t: 1 });
    }

    // ---- dust motes drifting in the floodlight, and the faint beam itself
    const dn = 70;
    const dp = new Float32Array(dn * 3);
    this.dustVel = new Float32Array(dn * 3);
    for (let i = 0; i < dn; i++) {
      const t = rand();
      const q = this.floodHead.clone().lerp(this.floodTarget, t);
      dp[i * 3] = q.x + (rand() - 0.5) * (0.4 + t * 1.6);
      dp[i * 3 + 1] = q.y + (rand() - 0.5) * (0.4 + t * 1.2);
      dp[i * 3 + 2] = q.z + (rand() - 0.5) * (0.4 + t * 1.6);
      this.dustVel[i * 3] = (rand() - 0.5) * 0.05;
      this.dustVel[i * 3 + 1] = (rand() - 0.5) * 0.03;
      this.dustVel[i * 3 + 2] = (rand() - 0.5) * 0.05;
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dp, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: 0xfff4dc, size: 0.025, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.inside.add(this.dust);
    const len = this.floodHead.distanceTo(this.floodTarget) + 0.6;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.3, len, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const dir = new THREE.Vector3().subVectors(this.floodTarget, this.floodHead).normalize();
    beam.position.copy(this.floodHead).addScaledVector(dir, len / 2);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this.inside.add(beam);
  }

  private updateAmbience(dt: number, player: THREE.Vector3): void {
    // Drips: now and then a drop falls from the roof into a puddle and rings spread.
    this.dripT -= dt;
    const pos = this.drops.geometry.attributes.position as THREE.BufferAttribute;
    if (this.dripT <= 0 && this.puddles.length) {
      this.dripT = 0.5 + Math.random() * 1.2;
      const free = this.dropState.find((d) => !d.p);
      if (free) {
        const p = this.puddles[Math.floor(Math.random() * this.puddles.length)];
        const { d } = this.locate(p.x, p.z);
        free.p = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6));
        free.y = ceiling(d) - 0.2;
        free.v = 0;
      }
    }
    this.dropState.forEach((d, i) => {
      if (!d.p) return;
      d.v -= 9.8 * dt;
      d.y += d.v * dt;
      if (d.y <= 0.03) {
        const ring = this.rings.find((r) => r.t >= 1);
        if (ring) {
          ring.t = 0;
          ring.m.position.set(d.p.x, 0.04, d.p.z);
          ring.m.visible = true;
        }
        if (Math.hypot(d.p.x - player.x, d.p.z - player.z) < 14) this.onDrip?.(d.p);
        d.p = null;
        pos.setXYZ(i, 0, -100, 0);
        return;
      }
      pos.setXYZ(i, d.p.x, d.y, d.p.z);
    });
    pos.needsUpdate = true;
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt * 1.4);
      const k = 1 + r.t * 5;
      r.m.scale.set(k, k, k);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - r.t);
      if (r.t >= 1) r.m.visible = false;
    }
    // Dust: slow drift inside the floodlight, wrapping back into the beam.
    if (player.distanceTo(this.floodHead) < 30) {
      const dp = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const a = dp.array as Float32Array;
      for (let i = 0; i < dp.count; i++) {
        a[i * 3] += this.dustVel[i * 3] * dt + Math.sin(this.t * 0.7 + i) * 0.002;
        a[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
        a[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
        const dx = a[i * 3] - this.floodTarget.x;
        const dz = a[i * 3 + 2] - this.floodTarget.z;
        if (Math.hypot(dx, dz) > 4 || a[i * 3 + 1] < 0.1 || a[i * 3 + 1] > 3) {
          const t = Math.random();
          const q = this.floodHead.clone().lerp(this.floodTarget, t);
          a[i * 3] = q.x + (Math.random() - 0.5) * (0.4 + t * 1.6);
          a[i * 3 + 1] = q.y + (Math.random() - 0.5) * 0.8;
          a[i * 3 + 2] = q.z + (Math.random() - 0.5) * (0.4 + t * 1.6);
        }
      }
      dp.needsUpdate = true;
    }
  }

  /** A camp table: plank top on four legs with cross braces. Origin on the floor, long side across. */
  private buildTable(): THREE.Group {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85, map: detailTextures().plank });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4e3826, roughness: 0.9, map: detailTextures().plank });
    for (let k = -1; k <= 1; k++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.27), wood);
      board.position.set(0, 0.76, k * 0.28);
      board.rotation.y = (k * 0.01);
      g.add(board);
    }
    for (const x of [-0.88, 0.88]) {
      for (const z of [-0.33, 0.33]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.74, 0.07), dark);
        leg.position.set(x, 0.37, z);
        g.add(leg);
      }
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), dark);
      brace.position.set(x, 0.2, 0);
      g.add(brace);
      const apron = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.76), dark);
      apron.position.set(x, 0.68, 0);
      g.add(apron);
    }
    const stretcher = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.05, 0.05), dark);
    stretcher.position.set(0, 0.2, 0);
    g.add(stretcher);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return g;
  }

  /** The expedition chest: banded planks, iron corners, a heavy padlock. Front faces +Z. */
  private buildChest(): THREE.Group {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a2c, roughness: 0.85, map: detailTextures().plank });
    const iron = new THREE.MeshStandardMaterial({ color: 0x3b3a38, roughness: 0.5, metalness: 0.5 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.4, metalness: 0.6 });
    // Hollow box: floor and four walls, lined dark inside, open at the top.
    const t = 0.045;
    const W = 1.1;
    const D = 0.62;
    const H = 0.5;
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(W, t, D), wood);
    bottom.position.y = t / 2;
    g.add(bottom);
    for (const z of [-D / 2 + t / 2, D / 2 - t / 2]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(W, H, t), wood);
      wall.position.set(0, H / 2, z);
      g.add(wall);
    }
    for (const x of [-W / 2 + t / 2, W / 2 - t / 2]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(t, H, D - 2 * t), wood);
      wall.position.set(x, H / 2, 0);
      g.add(wall);
    }
    const lining = new THREE.MeshStandardMaterial({ color: 0x3a1210, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * t, D - 2 * t), lining);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = t + 0.002;
    g.add(floor);
    for (const [x, z, ry, w] of [
      [0, -D / 2 + t + 0.002, 0, W - 2 * t],
      [0, D / 2 - t - 0.002, Math.PI, W - 2 * t],
      [-W / 2 + t + 0.002, 0, Math.PI / 2, D - 2 * t],
      [W / 2 - t - 0.002, 0, -Math.PI / 2, D - 2 * t],
    ] as [number, number, number, number][]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(w, H - t - 0.01), lining);
      side.position.set(x, t + (H - t) / 2, z);
      side.rotation.y = ry;
      g.add(side);
    }
    // Gold coins and a gem inside.
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b84a, roughness: 0.35, metalness: 0.7 });
    for (let k = 0; k < 9; k++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 10), gold);
      coin.position.set(-0.35 + (k % 5) * 0.12 + Math.sin(k) * 0.03, t + 0.01 + (k > 4 ? 0.012 : 0), -0.12 + Math.floor(k / 5) * 0.16);
      coin.rotation.set((k % 3) * 0.3, k, 0);
      g.add(coin);
    }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ color: 0x7fe8ff, emissive: 0x2ab8d8, emissiveIntensity: 1.4, roughness: 0.15 }));
    gem.position.set(0.3, t + 0.06, 0.05);
    g.add(gem);
    // Iron straps on the front and back faces.
    for (const x of [-0.42, 0.42]) {
      for (const z of [-D / 2 - 0.006, D / 2 + 0.006]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, H + 0.01, 0.012), iron);
        band.position.set(x, H / 2, z);
        g.add(band);
      }
    }
    // Lid on a hinge at the back edge.
    this.chestLid.position.set(0, 0.5, -0.31);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 1.1, 12, 1, false, 0, Math.PI), wood);
    lid.rotation.z = Math.PI / 2;
    lid.position.set(0, 0, 0.31);
    this.chestLid.add(lid);
    for (const x of [-0.42, 0.42]) {
      const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 0.06, 12, 1, false, 0, Math.PI), iron);
      lb.rotation.z = Math.PI / 2;
      lb.position.set(x, 0, 0.31);
      this.chestLid.add(lb);
    }
    g.add(this.chestLid);
    // Padlock and hasp on the front.
    const hasp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.03), iron);
    hasp.position.set(0, 0.46, 0.32);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.05), brass);
    lock.position.set(0, 0.36, 0.34);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 5, 10, Math.PI), iron);
    shackle.position.set(0, 0.42, 0.34);
    lock.name = 'lock';
    shackle.name = 'shackle';
    g.add(hasp, lock, shackle);
    // Treasure glow inside, shown when it opens.
    this.chestGlowMat = new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb040, emissiveIntensity: 0, transparent: true, opacity: 0 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.5), this.chestGlowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.049;
    g.add(glow);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return g;
  }

  /** The Lord of the Depths has fallen: the padlock drops, the lid swings up, gold light spills out. */
  unlockChest(): void {
    if (this.chestOpen) return;
    this.chestOpen = true;
    const g = this.chestLid.parent;
    if (g) {
      for (const n of ['lock', 'shackle']) {
        const o = g.getObjectByName(n);
        if (o) o.visible = false;
      }
    }
    if (this.chestGlow) this.chestGlow.intensity = 5;
    if (this.chestGlowMat) {
      this.chestGlowMat.opacity = 0.35;
      this.chestGlowMat.emissiveIntensity = 1.2;
    }
  }

  /** For enemies inside: is (x, z) off the floor, in the chasm or inside a prop? */
  blockedAt(x: number, z: number, r: number): boolean {
    const { d, lat } = this.locate(x, z);
    if (d < 0.8 || d > END_Z - 3.2) return true;
    if (Math.abs(lat) > halfWidth(d) - 0.35 - r * 0.5) return true;
    if (this.groundAt(x, z) < -5) return true;
    for (const o of this.obstacles) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return true;
    return false;
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
    // On the bridge the deck follows its sag.
    const z0 = CHASM_Z0 - 0.6;
    const z1 = CHASM_Z1 + 0.6;
    if (this.bridgeRepaired && d > z0 && d < z1 && Math.abs(lat) <= 1.2) return -BRIDGE_SAG * Math.sin(((d - z0) / (z1 - z0)) * Math.PI) + 0.02;
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
      this.updateAmbience(dt, player);
      if (this.chestOpen && this.chestLid.rotation.x > -1.9) this.chestLid.rotation.x = Math.max(-1.9, this.chestLid.rotation.x - dt * 2.5);
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
