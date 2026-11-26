import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetLibrary, AssetName, InstancePart } from '../assets/assets';
import { mulberry32, smoothstep } from '../core/math';
import { ColliderGrid, Circle } from './colliders';
import { LAKE_CENTER, LAKE_LEVEL, LAKE_RADIUS, Terrain } from './terrain';
import { detailTextures } from './textures';
import { buildBushVariants, bushMaterials } from './bushes';
import { PALM_CUT, buildPalmVariants, palmMaterials, palmStumpGeometry } from './palms';
import { PINE_CUT, barkMaterial, buildPineVariants, needleMaterial, pineCutMaterial, pineStumpGeometry } from './pines';
import { SEA_LEVEL } from './terrain';

export interface Exclusion {
  x: number;
  z: number;
  r: number;
}

/** Shared wind clock for every swaying material. */
export const windUniform = { value: 0 };

const winded = new WeakSet<THREE.Material>();

/** Sways vertices above `start` metres (in the model's own space). */
export function addWind(mat: THREE.Material, start: number, amount: number): void {
  if (winded.has(mat)) return;
  winded.add(mat);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float swayK = max(position.y - ${start.toFixed(2)}, 0.0) * ${amount.toFixed(4)};
        #ifdef USE_INSTANCING
          float swayPh = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.11;
        #else
          float swayPh = 0.0;
        #endif
        transformed.x += sin(uWindTime * 1.1 + swayPh) * swayK;
        transformed.z += cos(uWindTime * 0.83 + swayPh) * swayK * 0.7;`,
      );
  };
  mat.customProgramCacheKey = () => `wind-${start}-${amount}`;
}

/** One instanced draw per material part of a model, sharing one set of matrices. */
class InstancedSet {
  readonly meshes: THREE.InstancedMesh[];
  count = 0;

  constructor(parts: InstancePart[], capacity: number, castShadow: boolean) {
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, capacity));
      m.castShadow = castShadow;
      m.receiveShadow = true;
      m.count = 0;
      return m;
    });
  }

  push(matrix: THREE.Matrix4, color?: THREE.Color): number {
    const i = this.count++;
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      if (color) m.setColorAt(i, color);
    }
    return i;
  }

  set(i: number, matrix: THREE.Matrix4): void {
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  finish(group: THREE.Group): void {
    for (const m of this.meshes) {
      m.count = this.count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      group.add(m);
    }
  }
}

const PALM_HEIGHT = 8;
/** Normalised tree height in metres before the per-tree scale. */
const TREE_HEIGHT = 9.5;

export interface Tree {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  hp: number;
  maxHp: number;
  state: 'alive' | 'falling' | 'stump';
  collider: Circle;
  variant: number;
  slot: number;
  kind: 'pine' | 'palm';
}

interface FallingTree {
  tree: Tree;
  group: THREE.Group;
  pivot: THREE.Group;
  axis: THREE.Vector3;
  dir: THREE.Vector3;
  /** Where the pivot (top of the cut) starts, and the resting angle the ground allows. */
  base: THREE.Vector3;
  rest: number;
  cut: number;
  angle: number;
  vel: number;
  landed: number;
  bounces: number;
}


export interface ForestEvents {
  onFallStart(tree: Tree): void;
  /** `crown`: where the top hit the ground. */
  onLanded(tree: Tree, dir: THREE.Vector3, crown: THREE.Vector3): void;
  /** `along`: world points on the fallen trunk at 25 %, 50 %, 75 % and 100 % of its length. */
  onSettled(tree: Tree, dir: THREE.Vector3, along: THREE.Vector3[]): void;
}

/** ~350 instanced CC0 pines (three variants) that can be chopped, fall and leave stumps. */
export class Forest {
  readonly trees: Tree[] = [];
  readonly group = new THREE.Group();
  private variants: InstancePart[][];
  /** The piece that falls (palms: everything above the cut, with a closed base). */
  private fallParts: InstancePart[][];
  /** Spine samples per variant (model space) used to rest a fallen tree on the ground. */
  private spines: { p: THREE.Vector3; r: number }[][];
  private sets: InstancedSet[];
  private stumps: InstancedSet;
  private palmStumps: InstancedSet;
  private falling: FallingTree[] = [];
  private dummy = new THREE.Object3D();
  private q = new THREE.Quaternion();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private terrain: Terrain, colliders: ColliderGrid, exclusions: Exclusion[], private events: ForestEvents, lib: AssetLibrary, count = 350, groves: { x: number; z: number; r0: number; r1: number; count: number }[] = []) {
    // Variants 0-2 are the CC0 pines; 3-5 are coconut palms built in code (choppable too).
    const palmsV = buildPalmVariants();
    const pinesV = buildPineVariants();
    this.variants = [...pinesV.map((v) => v.standing), ...palmsV.map((v) => v.standing)];
    this.fallParts = [...pinesV.map((v) => v.falling), ...palmsV.map((v) => v.falling)];
    const pineSpine: { p: THREE.Vector3; r: number }[] = [];
    for (let y = 1; y <= TREE_HEIGHT; y += 0.75) {
      const crown = y < 2 ? 0 : 2.3 * (1 - (y - 2) / (TREE_HEIGHT - 2));
      pineSpine.push({ p: new THREE.Vector3(0, y, 0), r: 0.3 + crown * 0.18 });
    }
    this.spines = [pineSpine, pineSpine, pineSpine, ...palmsV.map((v) => v.spine)];
    this.variants.forEach((parts, v) => {
      for (const p of parts) {
        const sm = p.material as THREE.MeshStandardMaterial;
        if (sm.alphaTest > 0) addWind(sm, v < 3 ? 3.0 : 5.0, v < 3 ? 0.012 : 0.02);
      }
    });
    // Needle sprays are double-sided cards: keep their up-leaning normal on both faces so
    // the underside of a spray never turns black.
    {
      const nm = needleMaterial();
      const windCompile = nm.onBeforeCompile;
      nm.onBeforeCompile = (shader, renderer) => {
        windCompile.call(nm, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      };
      nm.customProgramCacheKey = () => 'pine-needles-wind';
    }

    const rand = mulberry32(4242);
    const placed: { x: number; z: number; kind: 'pine' | 'palm' }[] = [];
    const minDist = 6.5;
    let attempts = 0;
    // Dense groves first (e.g. the pines walling in the crash clearing).
    for (const gv of groves) {
      let n = 0;
      for (let k = 0; k < gv.count * 30 && n < gv.count; k++) {
        const a = rand() * Math.PI * 2;
        const r = gv.r0 + rand() * (gv.r1 - gv.r0);
        const x = gv.x + Math.cos(a) * r;
        const z = gv.z + Math.sin(a) * r;
        if (terrain.slope(x, z) > 0.3 || terrain.height(x, z) < 3) continue;
        if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 4.5 * 4.5)) continue;
        placed.push({ x, z, kind: 'pine' });
        n++;
      }
    }
    while (placed.length < count && attempts < 60000) {
      attempts++;
      const x = (rand() - 0.5) * 520;
      const z = (rand() - 0.5) * 520;
      const h = terrain.height(x, z);
      const beachTop = terrain.beachTopAt(z);
      if (h < beachTop + 0.8 || h > 34) continue;
      if (terrain.slope(x, z) > 0.27) continue;
      if (Math.hypot(x - LAKE_CENTER.x, z - LAKE_CENTER.z) < LAKE_RADIUS * 1.2) continue;
      if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
      const density = terrain.noise.noise(x * 0.012 + 70, z * 0.012 - 30) * 0.5 + 0.5;
      if (rand() > 0.25 + density * 0.9) continue;
      let ok = true;
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (ok) placed.push({ x, z, kind: 'pine' });
    }

    // Palms along the southern beach, on the sand strip.
    let palms = 0;
    attempts = 0;
    while (palms < 42 && attempts < 20000) {
      attempts++;
      const a = Math.PI * (0.12 + rand() * 0.76);
      const r0 = terrain.islandRadius(Math.cos(a), Math.sin(a)) * (0.84 + rand() * 0.1);
      const x = Math.cos(a) * r0;
      const z = Math.sin(a) * r0;
      const h = terrain.height(x, z);
      if (h < 0.7 || h > 4 || z < 40 || terrain.slope(x, z) > 0.2) continue;
      if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 25)) continue;
      placed.push({ x, z, kind: 'palm' });
      palms++;
    }

    this.sets = this.variants.map((parts) => new InstancedSet(parts, placed.length, true));
    // Cut stump: dark bark on the side (same as the logs) and a pale ring-cut top.
    const tex = detailTextures();
    // Pine stump: the trunk's own foot in the same Poly Haven bark, ring-cut top at PINE_CUT.
    void tex;
    const stumpGeo = pineStumpGeometry();
    const bark = barkMaterial();
    const cut = pineCutMaterial();
    const stumpMesh = new THREE.InstancedMesh(stumpGeo, [bark, cut, bark], Math.max(1, placed.length));
    this.stumps = new InstancedSet([], placed.length, true);
    stumpMesh.castShadow = true;
    stumpMesh.receiveShadow = true;
    stumpMesh.count = 0;
    // Stumps appear one by one from zero-scale instances, so the computed bounds are
    // useless: never cull them (they are one cheap draw).
    stumpMesh.frustumCulled = false;
    this.stumps.meshes.push(stumpMesh);
    // Palm stump: same radius and ringed bark as the palm trunk, so the cut lines up.
    const pm = palmMaterials();
    this.palmStumps = new InstancedSet([{ geometry: palmStumpGeometry(), material: pm.trunk }], placed.length, true);
    const palmStumpMesh = this.palmStumps.meshes[0];
    palmStumpMesh.material = [pm.trunk, pm.cut, pm.trunk];
    palmStumpMesh.frustumCulled = false;
    const tint = new THREE.Color();
    placed.forEach((p, i) => {
      const palm = p.kind === 'palm';
      const scale = palm ? 0.8 + rand() * 0.45 : 0.8 + rand() * 0.5;
      const variant = palm ? 3 + Math.floor(rand() * 3) : Math.floor(rand() * 3);
      const y = terrain.height(p.x, p.z) - 0.1;
      const height = (palm ? PALM_HEIGHT : TREE_HEIGHT) * scale;
      const collider = colliders.add({ x: p.x, z: p.z, r: (palm ? 0.32 : 0.42) * scale, y0: y, y1: y + height, kind: 'tree', ref: i });
      // A palm comes down in 3 axe blows; a pine takes 4.
      const hp = palm ? 75 : 100;
      const tree: Tree = { x: p.x, y, z: p.z, scale, rotY: rand() * Math.PI * 2, hp, maxHp: hp, state: 'alive', collider, variant, slot: 0, kind: p.kind };
      this.dummy.position.set(p.x, y, p.z);
      this.dummy.rotation.set(0, tree.rotY, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      if (palm) tint.setRGB(1, 1, 1);
      else tint.setScalar(0.88 + rand() * 0.22);
      tree.slot = this.sets[variant].push(this.dummy.matrix, tint);
      this.stumps.push(this.zero);
      this.palmStumps.push(this.zero);
      this.trees.push(tree);
    });
    for (const s of this.sets) s.finish(this.group);
    this.stumps.finish(this.group);
    this.palmStumps.finish(this.group);
  }

  private writeStump(i: number): void {
    const t = this.trees[i];
    this.sets[t.variant].set(t.slot, this.zero);
    // The stump is the trunk's own foot: same place, yaw and scale, top exactly at the cut.
    const set = t.kind === 'palm' ? this.palmStumps : this.stumps;
    this.dummy.position.set(t.x, t.y, t.z);
    this.dummy.rotation.set(0, t.rotY, 0);
    this.dummy.scale.setScalar(t.scale);
    this.dummy.updateMatrix();
    set.set(i, this.dummy.matrix);
    for (const m of set.meshes) m.computeBoundingSphere();
  }

  private fallMesh(variant: number): THREE.Group {
    const g = new THREE.Group();
    for (const p of this.fallParts[variant]) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  /** Builds a falling copy once so its shader variants compile at load, not mid-play. */
  makeWarmupObject(): THREE.Object3D {
    const g = new THREE.Group();
    for (let v = 0; v < this.variants.length; v++) g.add(this.fallMesh(v));
    return g;
  }

  /** Ray vs trunk cylinders. `inflate` widens trunks for forgiving melee. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate = 0): { t: number; tree: number } | null {
    let best = maxDist;
    let hit = -1;
    const dl = Math.hypot(d.x, d.z);
    if (dl < 1e-5) return null;
    for (let i = 0; i < this.trees.length; i++) {
      const tr = this.trees[i];
      if (tr.state !== 'alive') continue;
      const ox = o.x - tr.x;
      const oz = o.z - tr.z;
      if (ox * ox + oz * oz > (best + 3) * (best + 3)) continue;
      const r = tr.collider.r + inflate;
      const a = d.x * d.x + d.z * d.z;
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0) t = c < 0 ? 0 : -1;
      if (t < 0 || t > best) continue;
      const y = o.y + d.y * t;
      if (y < tr.y - 0.2 || y > tr.y + (tr.kind === 'palm' ? PALM_HEIGHT : TREE_HEIGHT) * tr.scale) continue;
      best = t;
      hit = i;
    }
    return hit >= 0 ? { t: best, tree: hit } : null;
  }

  /** Returns true when this hit felled the tree. */
  damage(i: number, amount: number, from: THREE.Vector3): boolean {
    const t = this.trees[i];
    if (t.state !== 'alive') return false;
    t.hp -= amount;
    if (t.hp > 0) return false;
    t.state = 'falling';
    const dir = new THREE.Vector3(t.x - from.x, 0, t.z - from.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    // Lean a little sideways so trees never fall straight onto the player.
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6);
    if (t.kind === 'palm') {
      // A palm goes where its curve and the weight of its crown pull it, nudged by the blow,
      // so it never swings over backwards onto its fronds.
      const lean = new THREE.Vector3(Math.cos(t.rotY), 0, -Math.sin(t.rotY));
      dir.multiplyScalar(0.55).addScaledVector(lean, 1.0);
      if (dir.lengthSq() < 0.05) dir.copy(lean);
      dir.normalize();
    }
    this.writeStump(i);
    t.collider.r = (t.kind === 'palm' ? 0.3 : 0.38) * t.scale;
    t.collider.y1 = t.y + 0.6 * t.scale;

    const cut = (t.kind === 'palm' ? PALM_CUT : PINE_CUT) * t.scale;
    const group = new THREE.Group();
    const base = new THREE.Vector3(t.x, t.y + cut, t.z);
    group.position.copy(base);
    const pivot = new THREE.Group();
    const inner = this.fallMesh(t.variant);
    inner.rotation.y = t.rotY;
    inner.scale.setScalar(t.scale);
    inner.position.y = -cut;
    pivot.add(inner);
    group.add(pivot);
    this.group.add(group);
    const axis = new THREE.Vector3(dir.z, 0, -dir.x);
    const f: FallingTree = { tree: t, group, pivot, axis, dir, base, rest: Math.PI / 2, cut, angle: 0.02, vel: 0.25, landed: -1, bounces: 0 };
    f.rest = this.restAngle(f);
    this.falling.push(f);
    this.events.onFallStart(t);
    return true;
  }

  /** Slide out of the axe notch: a few centimetres along the fall as it tips. */
  private slip(f: FallingTree, angle: number): number {
    return 0.14 * f.tree.scale * smoothstep(0.2, f.rest, angle);
  }

  /** World point of a model-space point on a falling tree at a given angle. */
  private fallPoint(f: FallingTree, p: THREE.Vector3, angle: number, out: THREE.Vector3): THREE.Vector3 {
    this.q.setFromAxisAngle(f.axis, angle);
    out.copy(p).multiplyScalar(f.tree.scale).applyAxisAngle(this.yAxis, f.tree.rotY);
    out.y -= f.cut;
    out.applyQuaternion(this.q).add(f.base).addScaledVector(f.dir, this.slip(f, angle));
    return out;
  }

  /** Lowest surface a fallen trunk can lie on at (x, z). */
  private restHeight(x: number, z: number): number {
    return Math.max(this.terrain.height(x, z), SEA_LEVEL - 0.35);
  }

  /** First angle at which any part of the trunk or crown touches the ground (slopes included). */
  private restAngle(f: FallingTree): number {
    const spine = this.spines[f.tree.variant];
    const w = new THREE.Vector3();
    for (let a = 0.3; a < 2.3; a += 0.015) {
      for (const sp of spine) {
        this.fallPoint(f, sp.p, a, w);
        if (w.y - sp.r * f.tree.scale < this.restHeight(w.x, w.z)) return Math.max(0.6, a - 0.015);
      }
    }
    return 2.3;
  }

  private yAxis = new THREE.Vector3(0, 1, 0);

  /** World points on a fallen trunk at fractions of its spine (root → crown). */
  private alongTrunk(f: FallingTree, fracs: number[]): THREE.Vector3[] {
    const spine = this.spines[f.tree.variant];
    const trunk = spine.filter((sp) => Math.abs(sp.p.x) + Math.abs(sp.p.z) < 6 || sp === spine[0]);
    const top = f.tree.kind === 'palm' ? trunk.findIndex((sp) => sp.r >= 0.45) : trunk.length - 1;
    const last = top > 0 ? top : trunk.length - 1;
    return fracs.map((fr) => {
      const k = Math.min(last, Math.round(fr * last));
      return this.fallPoint(f, trunk[k].p, f.angle, new THREE.Vector3());
    });
  }

  update(dt: number): void {
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k];
      if (f.landed < 0) {
        f.vel += 2.4 * Math.sin(f.angle + 0.06) * dt;
        f.angle += f.vel * dt;
        if (f.angle >= f.rest) {
          f.angle = f.rest;
          if (f.bounces === 0) {
            const crown = this.alongTrunk(f, [1])[0];
            crown.y = this.restHeight(crown.x, crown.z) + 0.3;
            this.events.onLanded(f.tree, f.dir, crown);
          }
          f.bounces++;
          // A damped rebound or two, then it lies still.
          f.vel = f.bounces < 3 ? -Math.abs(f.vel) * (f.bounces === 1 ? 0.2 : 0.1) : 0;
          if (f.bounces >= 3) f.landed = 0;
        }
      } else {
        f.landed += dt;
        if (f.landed > 0.55) {
          const along = this.alongTrunk(f, [0.25, 0.5, 0.75, 1]);
          this.group.remove(f.group);
          this.falling.splice(k, 1);
          f.tree.state = 'stump';
          this.events.onSettled(f.tree, f.dir, along);
          continue;
        }
      }
      this.q.setFromAxisAngle(f.axis, f.angle);
      f.pivot.quaternion.copy(this.q);
      f.group.position.copy(f.base).addScaledVector(f.dir, this.slip(f, f.angle));
    }
  }

  get aliveCount(): number {
    let n = 0;
    for (const t of this.trees) if (t.state === 'alive') n++;
    return n;
  }
}

/** Rocks, bushes, ferns, grass and small collectible stones and sticks: all instanced. */
export class Props {
  readonly group = new THREE.Group();
  readonly smallRocks: { x: number; y: number; z: number; active: boolean }[] = [];
  readonly smallSticks: { x: number; y: number; z: number; active: boolean }[] = [];
  private pebbles: InstancedSet;
  private stickMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(terrain: Terrain, colliders: ColliderGrid, exclusions: Exclusion[], tree: Forest, lib: AssetLibrary) {
    const rand = mulberry32(99);
    const d = this.dummy;
    const color = new THREE.Color();
    const nearTree = (x: number, z: number, r: number) => tree.trees.some((t) => Math.hypot(t.x - x, t.z - z) < r);
    const excluded = (x: number, z: number, pad = 0) => exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + pad);

    // Boulders: CC0 rocks normalised to a 2 m footprint (radius ~1), scaled per instance.
    // Highland rocks are the big cliff/tall shapes; the lowlands get rounder stones.
    const highland: AssetName[] = ['rockCliff', 'rockLarge', 'rockTall'];
    const lowland: AssetName[] = ['rockMedium', 'rockRound', 'rockSmall'];
    const rockNames = [...highland, ...lowland];
    // The CC0 rock shapes keep their geometry but share one natural grey stone material
    // (the detail rock texture with bump), so every rock reads as the same stone.
    const tex = detailTextures();
    const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x9a978f).multiplyScalar(1.25), roughness: 0.93, map: tex.rock, bumpMap: tex.rockBump, bumpScale: 3, flatShading: true });
    const stoneNoUv = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8e8b84).multiplyScalar(1.1), roughness: 0.93, flatShading: true });
    const rockSets = rockNames.map((n) => {
      const parts = lib.parts(n, { by: 'footprint', value: 2 }).map((p) => ({ geometry: p.geometry, material: p.geometry.attributes.uv ? stone : stoneNoUv }));
      return new InstancedSet(parts, 120, true);
    });
    // Rock heights after normalisation, to bury each one by a fraction of its height.
    const rockHeights = rockNames.map((n) => {
      const parts = lib.parts(n, { by: 'footprint', value: 2 });
      let top = 0;
      for (const p of parts) {
        p.geometry.computeBoundingBox();
        top = Math.max(top, p.geometry.boundingBox!.max.y);
      }
      return top;
    });
    /** Lowest ground under a footprint of radius r (centre plus a ring of samples). */
    const lowest = (x: number, z: number, r: number) => {
      let low = terrain.height(x, z);
      for (let k = 0; k < 8; k++) {
        const a2 = (k / 8) * Math.PI * 2;
        low = Math.min(low, terrain.height(x + Math.cos(a2) * r, z + Math.sin(a2) * r));
      }
      return low;
    };
    // Place a rock with its base sunk ~35% of its height below the lowest ground
    // under its footprint, so no rock ever floats over a slope.
    const placeRock = (set: number, x: number, z: number, s: number, sy: number, yaw: number) => {
      const footR = s * 0.9;
      const ground = lowest(x, z, footR);
      const height = rockHeights[set] * s * sy;
      d.position.set(x, ground - height * 0.35, z);
      d.rotation.set((rand() - 0.5) * 0.12, yaw, (rand() - 0.5) * 0.12);
      d.scale.set(s * (0.9 + rand() * 0.25), s * sy, s * (0.9 + rand() * 0.25));
      d.updateMatrix();
      color.setHSL(0.09, 0.03 + rand() * 0.05, 0.42 + rand() * 0.16).multiplyScalar(1.9);
      rockSets[set].push(d.matrix, color);
      const top = ground + height * 0.65;
      if (s > 0.7) colliders.add({ x, z, r: s * 0.85, y0: ground - 1, y1: top, kind: 'rock', ref: 0 });
    };

    // Northern cliffs: rows of large cliff/boulder rocks along the highland spine.
    let tries = 0;
    let clusters = 0;
    while (clusters < 16 && tries < 4000) {
      tries++;
      const cx = (rand() - 0.5) * 380;
      const cz = -110 - rand() * 90;
      const h = terrain.height(cx, cz);
      if (h < 6 || excluded(cx, cz, 10) || terrain.coastDistance(cx, cz) < 18) continue;
      const along = rand() * Math.PI;
      const count = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < count; k++) {
        const off = (k - count / 2) * (3.2 + rand() * 1.5);
        const x = cx + Math.cos(along) * off + (rand() - 0.5) * 2;
        const z = cz + Math.sin(along) * off + (rand() - 0.5) * 2;
        if (nearTree(x, z, 2)) continue;
        const s = 2.2 + rand() * 2.6;
        placeRock(rand() < 0.6 ? 0 : 1, x, z, s, 0.9 + rand() * 0.6, along + (rand() - 0.5) * 0.8);
      }
      clusters++;
    }

    // Scattered boulders elsewhere, mostly smaller and rounder.
    let b = 0;
    tries = 0;
    while (b < 150 && tries < 24000) {
      tries++;
      const x = (rand() - 0.5) * 540;
      const z = (rand() - 0.5) * 540;
      const h = terrain.height(x, z);
      if (h < 0.6 || excluded(x, z, 4)) continue;
      const north = smoothstep(30, 150, -z);
      if (rand() > 0.12 + north * 0.6) continue;
      if (terrain.isInLake(x, z) || nearTree(x, z, 2.5)) continue;
      const big = north > 0.5 && rand() < 0.35;
      const s = big ? 1.2 + rand() * rand() * 2.5 : 0.45 + rand() * rand() * 1.8;
      const set = big ? Math.floor(rand() * 3) : 3 + Math.floor(rand() * 3);
      placeRock(set, x, z, s, 0.8 + rand() * 0.4, rand() * Math.PI * 2);
      b++;
    }
    for (const s of rockSets) s.finish(this.group);

    // Shrubs built in code (dark twigs, alpha-cut moss/olive leaf sprays, two shapes) and
    // CC0 ferns under the trees; swaying, no cast shadows to keep the shadow pass light.
    const bushSets = buildBushVariants().map((parts) => new InstancedSet(parts, 130, false));
    const fernSet = new InstancedSet(lib.parts('fern', { by: 'height', value: 0.8 }), 260, false);
    for (const set of [...bushSets, fernSet]) for (const m of set.meshes) addWind(m.material as THREE.Material, 0.1, 0.06);
    {
      // Leaf sprays are double-sided cards: keep their up-leaning normal on both faces.
      const lm = bushMaterials().leaf;
      const windCompile = lm.onBeforeCompile;
      lm.onBeforeCompile = (shader, renderer) => {
        windCompile.call(lm, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      };
      lm.customProgramCacheKey = () => 'bush-leaves-wind';
    }
    const bushCount = () => bushSets.reduce((s2, b2) => s2 + b2.count, 0);
    tries = 0;
    while ((bushCount() < 240 || fernSet.count < 260) && tries < 30000) {
      tries++;
      const x = (rand() - 0.5) * 500;
      const z = (rand() - 0.5) * 500;
      if (terrain.surfaceAt(x, z) !== 'grass' || excluded(x, z)) continue;
      const h = terrain.height(x, z);
      const fern = nearTree(x, z, 5) ? rand() < 0.7 : rand() < 0.3;
      const set = fern ? fernSet : bushSets[rand() < 0.55 ? 0 : 1];
      if (set.count >= (fern ? 260 : 120)) continue;
      const s = fern ? 0.7 + rand() * 0.7 : 0.95 + rand() * 0.6;
      d.position.set(x, h - 0.05, z);
      d.rotation.set(0, rand() * 6, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      // Ferns keep their green tint; shrubs only vary in brightness (their leaves carry the colour).
      if (fern) color.setHSL(0.25 + (rand() - 0.5) * 0.06, 0.25, 0.55 + rand() * 0.1).multiplyScalar(1.75);
      else color.setScalar(0.85 + rand() * 0.3);
      set.push(d.matrix, color);
    }
    for (const b2 of bushSets) b2.finish(this.group);
    fernSet.finish(this.group);

    // Palms are part of the Forest now, so they can be chopped.


    // Grass is the dynamic low carpet in grass.ts (GrassField).

    // Small stones the player can pick up (CC0 pebble).
    this.pebbles = new InstancedSet(lib.parts('pebble', { by: 'footprint', value: 0.32 }).map((p) => ({ geometry: p.geometry, material: p.geometry.attributes.uv ? stone : stoneNoUv })), 70, true);
    tries = 0;
    while (this.pebbles.count < 70 && tries < 20000) {
      tries++;
      const x = (rand() - 0.5) * 480;
      const z = (rand() - 0.5) * 480;
      const h = terrain.height(x, z);
      if (h < 0.5 || terrain.isInLake(x, z) || terrain.slope(x, z) > 0.3) continue;
      if (this.pebbles.count < 12 && Math.abs(h - LAKE_LEVEL) > 2.5 && z < 120) continue;
      d.position.set(x, lowest(x, z, 0.15) - 0.04, z);
      d.rotation.set(0, rand() * 6, 0);
      d.scale.setScalar(0.9 + rand() * 0.4);
      d.updateMatrix();
      this.pebbles.push(d.matrix, color.setRGB(1, 1, 1));
      this.smallRocks.push({ x, y: h + 0.08, z, active: true });
    }
    this.pebbles.finish(this.group);

    // Sticks (gravetos) under the trees.
    const stickGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.75, 5);
    stickGeo.rotateZ(Math.PI / 2);
    const twig = new THREE.CylinderGeometry(0.012, 0.016, 0.25, 4);
    twig.rotateZ(Math.PI / 2 - 0.7);
    twig.translate(0.12, 0.06, 0);
    const stickAll = mergeGeometries([stickGeo, twig])!;
    const stickMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.3), roughness: 0.95, map: tex.bark });
    this.stickMesh = new THREE.InstancedMesh(stickAll, stickMat, 110);
    let nst = 0;
    tries = 0;
    while (nst < 110 && tries < 20000) {
      tries++;
      const tr = tree.trees[Math.floor(rand() * tree.trees.length)];
      if (!tr) break;
      const a = rand() * Math.PI * 2;
      const dist = 1.5 + rand() * 4;
      const x = tr.x + Math.cos(a) * dist;
      const z = tr.z + Math.sin(a) * dist;
      if (terrain.slope(x, z) > 0.3 || terrain.isInLake(x, z)) continue;
      const h = terrain.height(x, z);
      d.position.set(x, h + 0.04, z);
      d.rotation.set(0, rand() * 6, 0);
      d.scale.setScalar(0.9 + rand() * 0.3);
      d.updateMatrix();
      this.stickMesh.setMatrixAt(nst, d.matrix);
      this.smallSticks.push({ x, y: h + 0.05, z, active: true });
      nst++;
    }
    this.stickMesh.count = nst;
    this.stickMesh.castShadow = true;
    this.group.add(this.stickMesh);
  }

  hideSmallStick(i: number): void {
    this.smallSticks[i].active = false;
    this.stickMesh.setMatrixAt(i, this.zero);
    this.stickMesh.instanceMatrix.needsUpdate = true;
  }

  hideSmallRock(i: number): void {
    this.smallRocks[i].active = false;
    this.pebbles.set(i, this.zero);
  }

  private buildGrassTuft(): THREE.BufferGeometry {
    const blades = 5;
    const pos: number[] = [];
    const col: number[] = [];
    const nor: number[] = [];
    const base = new THREE.Color(0x355d22);
    const tip = new THREE.Color(0x9cc45a);
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + Math.random() * 0.6;
      const r = 0.08 + Math.random() * 0.1;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const w = 0.06;
      const px = -Math.sin(a) * w;
      const pz = Math.cos(a) * w;
      const hgt = 0.38 + Math.random() * 0.3;
      const lean = 0.12 + Math.random() * 0.12;
      pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, hgt, cz + Math.sin(a) * lean);
      col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  }
}
