import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetLibrary, AssetName, InstancePart } from '../assets/assets';
import { mulberry32, smoothstep } from '../core/math';
import { ColliderGrid, Circle } from './colliders';
import { LAKE_CENTER, LAKE_LEVEL, LAKE_RADIUS, Terrain } from './terrain';
import { detailTextures } from './textures';
import { buildBushVariants, bushMaterials } from './bushes';
import { PALM_CUT, buildPalmVariants, palmMaterials, palmStumpGeometry } from './palms';
import { PINE_CUT, TrunkSpec, barkMaterial, buildPineVariants, needleMaterial, pineCutMaterial, pineStumpGeometry } from './pines';
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
  /** Cut height in model space: spine samples below it stay with the stump. */
  cutM: number;
  angle: number;
  vel: number;
  landed: number;
  bounces: number;
}


/** A tree being chopped: drawn on its own so its notch can deepen and the tree can shake. */
interface Wounded {
  tree: Tree;
  /** At the tree's foot: shakes as a whole. */
  group: THREE.Group;
  /** At the cut: carries the part above, leans and finally falls. */
  pivot: THREE.Group;
  upper: THREE.Group;
  /** The rebuilt foot of the trunk (bark + bitten wood). */
  foot: THREE.Mesh;
  spec: TrunkSpec;
  /** Horizontal direction (world) the tree leans away from the player, and its axis. */
  away: THREE.Vector3;
  axis: THREE.Vector3;
  axisModel: THREE.Vector3;
  lean: number;
  leanTarget: number;
  /** Lean the foot mesh was last bent to. */
  builtLean: number;
  shakeT: number;
  shakeAmp: number;
  /** Direction to the player in model space (the side the axe bites). */
  dx: number;
  dz: number;
  /** Trunk radius at the cut (model space), and jag phases. */
  r: number;
  ph: number[];
  /** Cut height in model space and in metres; top of the rebuilt foot (a trunk ring). */
  cutM: number;
  cut: number;
  yTop: number;
}

/** Height (m) where every tree is felled: a low, natural stump. */
const CUT_HEIGHT = 0.78;

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
  private wounded = new Map<number, Wounded>();
  private trunkSpecs: TrunkSpec[] = [];
  private barkAboveCache = new Map<string, THREE.BufferGeometry>();
  private dummy = new THREE.Object3D();
  private q = new THREE.Quaternion();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private terrain: Terrain, colliders: ColliderGrid, exclusions: Exclusion[], private events: ForestEvents, lib: AssetLibrary, count = 350, groves: { x: number; z: number; r0: number; r1: number; count: number }[] = []) {
    // Variants 0-2 are the CC0 pines; 3-5 are coconut palms built in code (choppable too).
    const palmsV = buildPalmVariants();
    const pinesV = buildPineVariants();
    this.variants = [...pinesV.map((v) => v.standing), ...palmsV.map((v) => v.standing)];
    this.fallParts = [...pinesV.map((v) => v.falling), ...palmsV.map((v) => v.falling)];
    this.trunkSpecs = [...pinesV.map((v) => v.trunk), ...palmsV.map((v) => v.trunk)];
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
      const hp = 100;
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

  /** Hide the standing instance and show the stump; `cutM` (model space) sets its top. */
  private writeStump(i: number, cutM?: number): void {
    const t = this.trees[i];
    this.sets[t.variant].set(t.slot, this.zero);
    // The stump is the trunk's own foot: same place, yaw and scale, top exactly at the cut.
    const set = t.kind === 'palm' ? this.palmStumps : this.stumps;
    this.dummy.position.set(t.x, t.y, t.z);
    this.dummy.rotation.set(0, t.rotY, 0);
    this.dummy.scale.setScalar(t.scale);
    this.dummy.updateMatrix();
    const m = this.dummy.matrix.clone();
    if (cutM !== undefined) {
      // Stretch the stump (foot at -0.3, top at the default cut) so its top meets this cut.
      const base = t.kind === 'palm' ? PALM_CUT : PINE_CUT;
      const k = (cutM + 0.3) / (base + 0.3);
      m.multiply(new THREE.Matrix4().makeTranslation(0, 0.3 * k - 0.3, 0)).multiply(new THREE.Matrix4().makeScale(1, k, 1));
    }
    set.set(i, m);
    for (const mm of set.meshes) mm.computeBoundingSphere();
  }

  /** Builds the chopping materials once so their shaders compile at load, not mid-play. */
  makeWarmupObject(): THREE.Object3D {
    const g = new THREE.Group();
    for (const v of [0, this.variants.length - 1]) {
      const bark = this.variants[v][0].material as THREE.Material;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), [bark, this.freshWood(v < 3 ? 'pine' : 'palm')]));
      for (const p of this.variants[v]) g.add(new THREE.Mesh(p.geometry, p.material));
    }
    for (const m of [pineCutMaterial(), palmMaterials().cut]) g.add(new THREE.Mesh(new THREE.CircleGeometry(0.1, 6), m));
    return g;
  }

  /** The standing bark mesh with everything below `yTop` removed (cached per variant/height). */
  private barkAbove(variant: number, yTop: number): THREE.BufferGeometry {
    const key = `${variant}:${yTop.toFixed(4)}`;
    const known = this.barkAboveCache.get(key);
    if (known) return known;
    const src = this.variants[variant][0].geometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    const p = g.attributes.position;
    const keep: number[] = [];
    for (let t = 0; t < p.count; t += 3) {
      if (Math.min(p.getY(t), p.getY(t + 1), p.getY(t + 2)) >= yTop - 0.02) keep.push(t);
    }
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      const n = a.itemSize;
      const arr = new Float32Array(keep.length * 3 * n);
      keep.forEach((t, k) => arr.set((a.array as Float32Array).subarray(t * n, (t + 3) * n), k * 3 * n));
      out.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    this.barkAboveCache.set(key, out);
    return out;
  }

  /**
   * Rebuild the foot of a tree being chopped as one closed tube of dense rings, matching
   * the trunk ring for ring at the top so it joins seamlessly. Rings near the cut are
   * pulled in toward the axis: a wedge bitten from the side facing the player, deepening
   * with damage, then an hourglass down to a thin core; the edges are jagged, and the
   * faces pulled in show pale split wood. Above the cut it bends with the tree's lean.
   */
  private buildFoot(w: Wounded, from = 0, to = w.yTop, intact = false): THREE.BufferGeometry {
    const spec = w.spec;
    const S = 6;
    const M = spec.sides * S;
    const cutM = w.cutM;
    // Rings: sparse at the foot, dense through the cut, then up to the trunk ring at yTop.
    const hs: number[] = [];
    const push = (h: number) => {
      if (h >= from - 1e-6 && h <= to + 1e-6 && (!hs.length || h > hs[hs.length - 1] + 1e-4)) hs.push(h);
    };
    push(from);
    for (let h = 0.25; h < cutM - 0.42; h += 0.25) push(h);
    for (let h = cutM - 0.42; h <= cutM + 0.42 + 1e-6; h += 0.02) push(h);
    for (let h = cutM + 0.6; h < to - 0.05; h += 0.2) push(h);
    push(to);

    const frac = THREE.MathUtils.clamp(1 - Math.max(0, w.tree.hp) / w.tree.maxHp, 0, 1);
    const D = intact ? 0 : Forest.depthFrac(frac);
    const R = w.r;
    const depth = 2 * R * D;
    const K = 0.62;
    const core = R * (1 - 0.74 * THREE.MathUtils.smoothstep(D, 0.6, 0.85));
    const axisM = w.axisModel;
    const pivot = new THREE.Vector3(0, cutM, 0);
    const q = new THREE.Quaternion();
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const wood: boolean[] = [];
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const h of hs) {
      const c = spec.center(h);
      const bend = intact ? 0 : w.lean * THREE.MathUtils.smoothstep(h, cutM, cutM + 0.12);
      q.setFromAxisAngle(axisM, bend);
      for (let m = 0; m <= M; m++) {
        const j = Math.floor(m / S);
        const f = (m % S) / S;
        const a = spec.ring(h, j);
        const b = spec.ring(h, Math.min(spec.sides, j + 1));
        const p = a.lerp(b, f);
        const rx = p.x - c.x;
        const rz = p.z - c.z;
        const rr = Math.hypot(rx, rz) || 1e-6;
        const ux = rx / rr;
        const uz = rz / rr;
        const cos = ux * w.dx + uz * w.dz;
        const th = Math.atan2(uz, ux);
        const dy = h - cutM;
        let s = rr;
        if (D > 0) {
          // Jagged edges: the wedge's reach wavers around the trunk and along it.
          const jag = 0.5 * Math.sin(th * 5 + w.ph[0]) + 0.3 * Math.sin(th * 11 + h * 37 + w.ph[1]) + 0.2 * Math.sin(h * 71 + th * 3 + w.ph[2]);
          const dyE = Math.abs(dy) * (1 + 0.22 * jag);
          // The bite is narrow at first and widens as it deepens (never a full half-ring).
          const spread = THREE.MathUtils.lerp(0.72, 0.2, THREE.MathUtils.smoothstep(D, 0.25, 0.75));
          const T = R - depth * THREE.MathUtils.smoothstep(cos, spread, 0.97) + dyE / K;
          if (cos > 0.02) {
            if (rr * cos > T) s = Math.max(T / cos, R * 0.05);
          } else if (T < 0 && rr * cos > T) s = R * 0.05;
          // Hourglass: the last blows bite all the way round, leaving a thin core.
          s = Math.min(s, core + dyE / 0.6);
          if (s < rr - 1e-4) s *= 1 + 0.05 * Math.sin(th * 17 + h * 93 + w.ph[3]);
          s = Math.min(s, rr);
        }
        const isWood = rr - s > 0.006;
        v.set(c.x + ux * s, p.y, c.z + uz * s);
        n.set(ux, 0, uz);
        if (bend) {
          v.sub(pivot).applyQuaternion(q).add(pivot);
          n.applyQuaternion(q);
        }
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        const [u0, v0] = spec.uv(j, h);
        const [u1] = spec.uv(Math.min(spec.sides, j + 1), h);
        uv.push(u0 + (u1 - u0) * f, v0);
        wood.push(isWood);
      }
    }
    const row = M + 1;
    const barkIdx: number[] = [];
    const woodIdx: number[] = [];
    for (let i = 0; i < hs.length - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        const tris = [
          [a, b, a + 1],
          [b, b + 1, a + 1],
        ];
        for (const t of tris) (t.some((k) => wood[k]) ? woodIdx : barkIdx).push(...t);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([...barkIdx, ...woodIdx]);
    g.addGroup(0, barkIdx.length, 0);
    g.addGroup(barkIdx.length, woodIdx.length, 1);
    // Bitten faces take their own shading; the intact bark keeps the trunk's radial normals.
    if (woodIdx.length) {
      const smooth = g.clone();
      smooth.computeVertexNormals();
      const sn = smooth.attributes.normal;
      const gn = g.attributes.normal;
      for (let k = 0; k < wood.length; k++) if (wood[k] || (k >= row && wood[k - row]) || (k + row < wood.length && wood[k + row])) gn.setXYZ(k, sn.getX(k), sn.getY(k), sn.getZ(k));
      smooth.dispose();
    }
    return g;
  }

  /**
   * At the first blow, swap the instance for the tree's own mesh: the trunk above yTop as
   * it was, and its foot rebuilt as a solid tube that the axe bites into at a fixed, low,
   * natural cut height. The whole tree sits on a group that shakes from the foot; the part
   * above the cut sits on a pivot that leans and, at the last blow, falls.
   */
  private wound(i: number, from: THREE.Vector3): Wounded {
    const t = this.trees[i];
    this.sets[t.variant].set(t.slot, this.zero);
    for (const m of this.sets[t.variant].meshes) m.computeBoundingSphere();
    const spec = this.trunkSpecs[t.variant];
    const cut = CUT_HEIGHT;
    const cutM = cut / t.scale;
    const yTop = spec.rows.find((h) => h >= cutM + 0.45) ?? spec.rows[spec.rows.length - 1];
    const toPlayer = new THREE.Vector3(from.x - t.x, 0, from.z - t.z);
    if (toPlayer.lengthSq() < 1e-4) toPlayer.set(1, 0, 0);
    toPlayer.normalize();
    const local = toPlayer.clone().applyAxisAngle(this.yAxis, -t.rotY);
    const away = toPlayer.clone().negate();
    const axis = new THREE.Vector3(away.z, 0, -away.x);
    const frame = (y: number) => {
      const g = new THREE.Group();
      g.rotation.y = t.rotY;
      g.scale.setScalar(t.scale);
      g.position.y = y;
      return g;
    };
    const group = new THREE.Group();
    group.position.set(t.x, t.y, t.z);
    const pivot = new THREE.Group();
    pivot.position.y = cut;
    const upper = frame(-cut);
    const parts = this.variants[t.variant];
    for (const p of parts) {
      const m = new THREE.Mesh(p === parts[0] ? this.barkAbove(t.variant, yTop) : p.geometry, p.material);
      m.castShadow = true;
      upper.add(m);
    }
    pivot.add(upper);
    const footFrame = frame(0);
    const bark = parts[0].material as THREE.Material;
    const rCut = this.trunkSpecs[t.variant].ring(cutM, 0).sub(spec.center(cutM));
    const r = mulberry32(i * 7 + 3);
    const w: Wounded = {
      tree: t,
      group,
      pivot,
      upper,
      foot: new THREE.Mesh(new THREE.BufferGeometry(), [bark, this.freshWood(t.kind)]),
      spec,
      away,
      axis,
      axisModel: axis.clone().applyAxisAngle(this.yAxis, -t.rotY),
      lean: 0,
      leanTarget: 0,
      builtLean: -1,
      shakeT: 10,
      shakeAmp: 0,
      dx: local.x,
      dz: local.z,
      r: Math.hypot(rCut.x, rCut.z),
      ph: [r() * 6, r() * 6, r() * 6, r() * 6],
      cutM,
      cut,
      yTop,
    };
    w.foot.castShadow = true;
    w.foot.receiveShadow = true;
    footFrame.add(w.foot);
    group.add(footFrame, pivot);
    this.group.add(group);
    this.wounded.set(i, w);
    return w;
  }

  private freshWoodMats: Partial<Record<'pine' | 'palm', THREE.MeshStandardMaterial>> = {};
  /** Freshly split wood for the bite: pale, fibrous and torn along the grain. */
  private freshWood(kind: 'pine' | 'palm'): THREE.MeshStandardMaterial {
    let m = this.freshWoodMats[kind];
    if (!m) {
      const S = 128;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const c = cv.getContext('2d')!;
      const r = mulberry32(kind === 'palm' ? 71 : 37);
      c.fillStyle = kind === 'palm' ? '#dcc69c' : '#ead0a0';
      c.fillRect(0, 0, S, S);
      // Long fibres along the grain (v), lighter and darker, with torn splinter marks.
      for (let k = 0; k < 90; k++) {
        const x = r() * S;
        const wd = 0.6 + r() * 1.6;
        c.fillStyle = r() < 0.5 ? `rgba(120,80,40,${0.08 + r() * 0.16})` : `rgba(255,244,220,${0.1 + r() * 0.2})`;
        c.fillRect(x, 0, wd, S);
      }
      for (let k = 0; k < 18; k++) {
        c.strokeStyle = `rgba(90,60,30,${0.25 + r() * 0.25})`;
        c.lineWidth = 1;
        c.beginPath();
        const x = r() * S;
        const y = r() * S;
        c.moveTo(x, y);
        c.lineTo(x + (r() - 0.5) * 6, y + 10 + r() * 20);
        c.stroke();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 3);
      tex.anisotropy = 4;
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0x4a3520, emissiveIntensity: 0.2, emissiveMap: tex });
      this.freshWoodMats[kind] = m;
    }
    return m;
  }

  /** Map damage to bite depth: ~25 %, ~55 %, ~80 % of the trunk over three blows. */
  private static depthFrac(frac: number): number {
    const pts = [
      [0, 0],
      [0.25, 0.25],
      [0.34, 0.33],
      [0.5, 0.55],
      [0.67, 0.75],
      [0.75, 0.8],
      [1, 0.9],
    ];
    for (let k = 1; k < pts.length; k++) {
      if (frac <= pts[k][0]) {
        const [x0, y0] = pts[k - 1];
        const [x1, y1] = pts[k];
        return y0 + ((frac - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return 0.9;
  }

  /** Bite deeper to the damage done; a dry elastic shudder, and a lean when nearly through. */
  private chop(w: Wounded): void {
    const t = w.tree;
    w.shakeT = 0;
    w.shakeAmp = t.kind === 'palm' ? 0.022 : 0.016;
    w.leanTarget = t.hp > 0 && t.hp / t.maxHp <= 0.3 ? 0.06 : 0;
    w.foot.geometry.dispose();
    w.foot.geometry = this.buildFoot(w);
    w.builtLean = w.lean;
  }

  /** True when this tree has just been brought to its last blow (it creaks). */
  nearlyThrough(t: Tree): boolean {
    return t.state === 'alive' && t.hp > 0 && t.hp / t.maxHp <= 0.3;
  }

  /** Every tree being chopped (for leaf fall and checks). */
  get chopping(): Tree[] {
    return [...this.wounded.values()].map((w) => w.tree);
  }

  /** Cut height (world, above the tree's foot) of a tree being chopped, or null. */
  cutHeight(t: Tree): number | null {
    for (const w of this.wounded.values()) if (w.tree === t) return w.cut;
    return null;
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
    const w = this.wounded.get(i) ?? this.wound(i, from);
    this.chop(w);
    if (t.hp > 0) return false;
    t.state = 'falling';
    this.wounded.delete(i);
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
    t.collider.r = (t.kind === 'palm' ? 0.3 : 0.38) * t.scale;
    t.collider.y1 = t.y + w.cut + 0.05;

    // It parts at the notch: the foot becomes the stump, its top exactly at the cut, and
    // the piece above falls hinging there, from the lean it already had, a clean cut cap
    // closing its base.
    // The thin core snaps: the foot becomes the stump, its top at the cut, and the tree
    // above falls hinging there, from the lean it already had. Its butt is the trunk from
    // the cut up to the foot's top ring, closed by a clean cut cap.
    this.writeStump(i, w.cutM);
    w.group.remove(w.foot.parent!);
    w.foot.geometry.dispose();
    const butt = new THREE.Mesh(this.buildFoot(w, w.cutM, w.yTop, true), [w.foot.material as THREE.Material[]][0]);
    butt.castShadow = true;
    w.upper.add(butt);
    const c0 = w.spec.center(w.cutM);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(w.r * 1.06, 18), t.kind === 'palm' ? palmMaterials().cut : pineCutMaterial());
    cap.rotation.x = Math.PI / 2;
    cap.position.set(c0.x, w.cutM, c0.z);
    w.upper.add(cap);
    const cut = w.cut;
    const base = new THREE.Vector3(t.x, t.y + cut, t.z);
    const { group, pivot } = w;
    group.position.copy(base);
    group.quaternion.identity();
    pivot.position.set(0, 0, 0);
    const axis = new THREE.Vector3(dir.z, 0, -dir.x);
    const f: FallingTree = { tree: t, group, pivot, axis, dir, base, rest: Math.PI / 2, cut, cutM: w.cutM, angle: 0.02 + w.lean * 0.8, vel: 0.25, landed: -1, bounces: 0 };
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
        if (sp.p.y < f.cutM + 0.2) continue;
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
    for (const w of this.wounded.values()) {
      // A dry, elastic shudder from the foot after each blow, dying out fast.
      w.shakeT += dt;
      const shake = w.shakeAmp * Math.exp(-7 * w.shakeT) * Math.sin(w.shakeT * 26);
      this.q.setFromAxisAngle(w.axis, shake);
      w.group.quaternion.copy(this.q);
      // Nearly through: the part above the cut leans, the foot bending with it.
      w.lean += (w.leanTarget - w.lean) * Math.min(1, dt * 2.5);
      this.q.setFromAxisAngle(w.axis, w.lean);
      w.pivot.quaternion.copy(this.q);
      if (Math.abs(w.lean - w.builtLean) > 0.002) {
        w.foot.geometry.dispose();
        w.foot.geometry = this.buildFoot(w);
        w.builtLean = w.lean;
      }
    }
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
