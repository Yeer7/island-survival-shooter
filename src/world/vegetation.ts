import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep } from '../core/math';
import { ColliderGrid, Circle } from './colliders';
import { LAKE_CENTER, LAKE_LEVEL, LAKE_RADIUS, Terrain } from './terrain';

export interface Exclusion {
  x: number;
  z: number;
  r: number;
}

/** Shared wind clock for every swaying material. */
export const windUniform = { value: 0 };

function addWind(mat: THREE.Material, start: number, amount: number): void {
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
}

function paint(geo: THREE.BufferGeometry, bottom: THREE.Color, top: THREE.Color, y0: number, y1: number, jitter = 0): void {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = smoothstep(y0, y1, pos.getY(i));
    c.copy(bottom).lerp(top, t);
    if (jitter) c.multiplyScalar(1 - jitter / 2 + Math.random() * jitter);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function buildTrunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.2, 0.34, 3.8, 7, 2);
  g.translate(0, 1.9, 0);
  paint(g, new THREE.Color(0x4f3622), new THREE.Color(0x7a5636), 0, 3.8, 0.15);
  return g;
}

function buildFoliageGeometry(): THREE.BufferGeometry {
  const layers = [
    { r: 2.7, h: 3.4, y: 3.9 },
    { r: 2.25, h: 3.0, y: 5.5 },
    { r: 1.75, h: 2.6, y: 6.9 },
    { r: 1.1, h: 2.2, y: 8.2 },
  ];
  const parts: THREE.BufferGeometry[] = [];
  const rand = mulberry32(7);
  layers.forEach((l, i) => {
    const g = new THREE.ConeGeometry(l.r, l.h, 8, 1);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      if (pos.getY(v) < 0) {
        pos.setX(v, pos.getX(v) * (0.9 + rand() * 0.25));
        pos.setZ(v, pos.getZ(v) * (0.9 + rand() * 0.25));
        pos.setY(v, pos.getY(v) + (rand() - 0.5) * 0.35);
      }
    }
    g.rotateY(i * 0.4);
    g.translate(0, l.y, 0);
    const dark = new THREE.Color(0x1f4a2a).multiplyScalar(0.9 + i * 0.05);
    const light = new THREE.Color(0x4f8a3e).multiplyScalar(0.95 + i * 0.06);
    paint(g, dark, light, l.y - l.h / 2, l.y + l.h / 2, 0.1);
    parts.push(g);
  });
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

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
}

interface FallingTree {
  tree: Tree;
  group: THREE.Group;
  pivot: THREE.Group;
  axis: THREE.Vector3;
  dir: THREE.Vector3;
  angle: number;
  vel: number;
  landed: number;
  bounced: boolean;
}

export interface ForestEvents {
  onFallStart(tree: Tree): void;
  onLanded(tree: Tree, dir: THREE.Vector3): void;
  onSettled(tree: Tree, dir: THREE.Vector3): void;
}

/** ~350 instanced pines that can be chopped, fall over and leave stumps. */
export class Forest {
  readonly trees: Tree[] = [];
  readonly trunks: THREE.InstancedMesh;
  readonly foliage: THREE.InstancedMesh;
  readonly group = new THREE.Group();
  private trunkGeo: THREE.BufferGeometry;
  private foliageGeo: THREE.BufferGeometry;
  private trunkMat: THREE.MeshStandardMaterial;
  private foliageMat: THREE.MeshStandardMaterial;
  private falling: FallingTree[] = [];
  private dummy = new THREE.Object3D();
  private q = new THREE.Quaternion();

  constructor(terrain: Terrain, colliders: ColliderGrid, exclusions: Exclusion[], private events: ForestEvents, count = 350) {
    this.trunkGeo = buildTrunkGeometry();
    this.foliageGeo = buildFoliageGeometry();
    this.trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    addWind(this.foliageMat, 3.0, 0.014);

    const rand = mulberry32(4242);
    const placed: { x: number; z: number }[] = [];
    const minDist = 6.5;
    let attempts = 0;
    while (placed.length < count && attempts < 60000) {
      attempts++;
      const x = (rand() - 0.5) * 520;
      const z = (rand() - 0.5) * 520;
      const h = terrain.height(x, z);
      const beachTop = 2.3 + smoothstep(40, 190, z) * 0.8;
      if (h < beachTop + 1.0 || h > 40) continue;
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
      if (!ok) continue;
      placed.push({ x, z });
    }

    this.trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, placed.length);
    this.foliage = new THREE.InstancedMesh(this.foliageGeo, this.foliageMat, placed.length);
    const tint = new THREE.Color();
    placed.forEach((p, i) => {
      const scale = 0.75 + rand() * 0.6;
      const y = terrain.height(p.x, p.z) - 0.15;
      const collider = colliders.add({ x: p.x, z: p.z, r: 0.42 * scale, y0: y, y1: y + 9 * scale, kind: 'tree', ref: i });
      const tree: Tree = { x: p.x, y, z: p.z, scale, rotY: rand() * Math.PI * 2, hp: 100, maxHp: 100, state: 'alive', collider };
      this.trees.push(tree);
      this.writeAlive(i);
      tint.setHSL(0.27 + (rand() - 0.5) * 0.06, 0.3 + rand() * 0.25, 0.42 + rand() * 0.16);
      this.foliage.setColorAt(i, tint.multiplyScalar(2.1));
      this.trunks.setColorAt(i, tint.setRGB(1, 1, 1).multiplyScalar(0.85 + rand() * 0.3));
    });
    for (const m of [this.trunks, this.foliage]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
  }

  private writeAlive(i: number): void {
    const t = this.trees[i];
    const d = this.dummy;
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(0, t.rotY, 0);
    d.scale.setScalar(t.scale);
    d.updateMatrix();
    this.trunks.setMatrixAt(i, d.matrix);
    this.foliage.setMatrixAt(i, d.matrix);
  }

  private writeStump(i: number): void {
    const t = this.trees[i];
    const d = this.dummy;
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(0, t.rotY, 0);
    d.scale.set(t.scale, 0.16, t.scale);
    d.updateMatrix();
    this.trunks.setMatrixAt(i, d.matrix);
    d.scale.setScalar(0);
    d.updateMatrix();
    this.foliage.setMatrixAt(i, d.matrix);
    this.trunks.instanceMatrix.needsUpdate = true;
    this.foliage.instanceMatrix.needsUpdate = true;
  }

  /** Builds a falling copy once so its shader variants compile at load, not mid-play. */
  makeWarmupObject(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.trunkGeo, this.trunkMat), new THREE.Mesh(this.foliageGeo, this.foliageMat));
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
      if (y < tr.y - 0.2 || y > tr.y + 9 * tr.scale) continue;
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
    this.writeStump(i);
    t.collider.r = 0.38 * t.scale;
    t.collider.y1 = t.y + 0.6;

    const group = new THREE.Group();
    group.position.set(t.x, t.y + 0.55, t.z);
    const pivot = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.y = t.rotY;
    inner.scale.setScalar(t.scale);
    inner.position.y = -0.55;
    const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMat);
    const fol = new THREE.Mesh(this.foliageGeo, this.foliageMat);
    trunk.castShadow = fol.castShadow = true;
    inner.add(trunk, fol);
    pivot.add(inner);
    group.add(pivot);
    this.group.add(group);
    const axis = new THREE.Vector3(dir.z, 0, -dir.x);
    this.falling.push({ tree: t, group, pivot, axis, dir, angle: 0.02, vel: 0.25, landed: -1, bounced: false });
    this.events.onFallStart(t);
    return true;
  }

  update(dt: number): void {
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k];
      if (f.landed < 0) {
        f.vel += 2.4 * Math.sin(f.angle + 0.06) * dt;
        f.angle += f.vel * dt;
        const rest = Math.PI / 2 - 0.08;
        if (f.angle >= rest) {
          f.angle = rest;
          if (!f.bounced) {
            f.bounced = true;
            f.vel = -f.vel * 0.18;
            this.events.onLanded(f.tree, f.dir);
          } else {
            f.vel = 0;
            f.landed = 0;
          }
        }
      } else {
        f.landed += dt;
        if (f.landed > 0.55) {
          this.group.remove(f.group);
          this.falling.splice(k, 1);
          f.tree.state = 'stump';
          this.events.onSettled(f.tree, f.dir);
          continue;
        }
      }
      // Rotate about the axis perpendicular to the fall direction (right-hand rule tips +y toward dir).
      this.q.setFromAxisAngle(f.axis, f.angle);
      f.pivot.quaternion.copy(this.q);
    }
  }

  get aliveCount(): number {
    let n = 0;
    for (const t of this.trees) if (t.state === 'alive') n++;
    return n;
  }

}

/** Rocks, bushes, grass and small collectible stones: all instanced. */
export class Props {
  readonly group = new THREE.Group();
  readonly smallRocks: { x: number; y: number; z: number; active: boolean }[] = [];
  private smallRockMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(terrain: Terrain, colliders: ColliderGrid, exclusions: Exclusion[], tree: Forest) {
    const rand = mulberry32(99);
    const d = this.dummy;
    const color = new THREE.Color();
    const nearTree = (x: number, z: number, r: number) => tree.trees.some((t) => Math.hypot(t.x - x, t.z - z) < r);
    const excluded = (x: number, z: number, pad = 0) => exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + pad);

    // Boulders: mostly on the northern highland, a few on the beaches.
    const boulderGeo = new THREE.DodecahedronGeometry(1, 0);
    const boulderMat = new THREE.MeshStandardMaterial({ color: 0x8c8a85, roughness: 0.92, flatShading: true });
    const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, 170);
    let b = 0;
    let tries = 0;
    while (b < 170 && tries < 20000) {
      tries++;
      const x = (rand() - 0.5) * 540;
      const z = (rand() - 0.5) * 540;
      const h = terrain.height(x, z);
      if (h < 0.6 || excluded(x, z, 4)) continue;
      const north = smoothstep(30, 150, -z);
      if (rand() > 0.12 + north * 0.8) continue;
      if (terrain.isInLake(x, z) || nearTree(x, z, 2.5)) continue;
      const s = 0.6 + rand() * rand() * 3.2 * (0.6 + north);
      d.position.set(x, h + s * 0.15, z);
      d.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      d.scale.set(s * (0.9 + rand() * 0.5), s * (0.6 + rand() * 0.4), s * (0.9 + rand() * 0.5));
      d.updateMatrix();
      boulders.setMatrixAt(b, d.matrix);
      color.setHSL(0.08, 0.05 + rand() * 0.06, 0.42 + rand() * 0.18);
      boulders.setColorAt(b, color.multiplyScalar(1.6));
      if (s > 0.9) colliders.add({ x, z, r: s * 0.95, y0: h - 1, y1: h + s * 0.8, kind: 'rock', ref: b });
      b++;
    }
    boulders.count = b;
    boulders.castShadow = true;
    boulders.receiveShadow = true;
    this.group.add(boulders);

    // Bushes.
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    paint(bushGeo, new THREE.Color(0x2b5226), new THREE.Color(0x5d8f3c), -1, 1, 0.15);
    const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    addWind(bushMat, -0.2, 0.05);
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 300);
    let nb = 0;
    tries = 0;
    while (nb < 300 && tries < 20000) {
      tries++;
      const x = (rand() - 0.5) * 500;
      const z = (rand() - 0.5) * 500;
      if (terrain.surfaceAt(x, z) !== 'grass' || excluded(x, z)) continue;
      const h = terrain.height(x, z);
      const s = 0.5 + rand() * 0.8;
      d.position.set(x, h + s * 0.25, z);
      d.rotation.set(0, rand() * 6, 0);
      d.scale.set(s * 1.3, s * 0.85, s * 1.2);
      d.updateMatrix();
      bushes.setMatrixAt(nb, d.matrix);
      color.setHSL(0.26 + (rand() - 0.5) * 0.08, 0.5, 0.5);
      bushes.setColorAt(nb, color.multiplyScalar(1.8));
      nb++;
    }
    bushes.count = nb;
    bushes.castShadow = true;
    bushes.receiveShadow = true;
    this.group.add(bushes);

    // Grass tufts: one draw call, no shadows cast.
    const grassGeo = this.buildGrassTuft();
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    addWind(grassMat, 0.05, 0.18);
    const GRASS = 18000;
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS);
    let ng = 0;
    tries = 0;
    while (ng < GRASS && tries < 120000) {
      tries++;
      const x = (rand() - 0.5) * 520;
      const z = (rand() - 0.5) * 520;
      const meadow = terrain.noise.noise(x * 0.02 - 13, z * 0.02 + 8) * 0.5 + 0.5;
      if (rand() > meadow * 1.3) continue;
      if (terrain.surfaceAt(x, z) !== 'grass') continue;
      const h = terrain.height(x, z);
      const s = 0.7 + rand() * 0.8;
      d.position.set(x, h - 0.03, z);
      d.rotation.set(0, rand() * 6, 0);
      d.scale.set(s, s * (0.8 + rand() * 0.5), s);
      d.updateMatrix();
      grass.setMatrixAt(ng, d.matrix);
      color.setHSL(0.24 + (rand() - 0.5) * 0.06, 0.45, 0.5);
      grass.setColorAt(ng, color.multiplyScalar(1.9));
      ng++;
    }
    grass.count = ng;
    grass.receiveShadow = true;
    this.group.add(grass);

    // Small stones the player can pick up.
    const smallGeo = new THREE.DodecahedronGeometry(0.16, 0);
    const smallMat = new THREE.MeshStandardMaterial({ color: 0x9b978f, roughness: 0.85, flatShading: true });
    this.smallRockMesh = new THREE.InstancedMesh(smallGeo, smallMat, 70);
    let ns = 0;
    tries = 0;
    while (ns < 70 && tries < 20000) {
      tries++;
      const x = (rand() - 0.5) * 480;
      const z = (rand() - 0.5) * 480;
      const h = terrain.height(x, z);
      if (h < 0.5 || terrain.isInLake(x, z) || terrain.slope(x, z) > 0.3) continue;
      if (ns < 12) {
        // A handful near the lake shore and the crash site so players find them early.
        if (Math.abs(h - LAKE_LEVEL) > 2.5 && z < 120) continue;
      }
      d.position.set(x, h + 0.06, z);
      d.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      d.scale.set(1 + rand() * 0.4, 0.7, 1 + rand() * 0.3);
      d.updateMatrix();
      this.smallRockMesh.setMatrixAt(ns, d.matrix);
      this.smallRocks.push({ x, y: h + 0.08, z, active: true });
      ns++;
    }
    this.smallRockMesh.count = ns;
    this.smallRockMesh.castShadow = true;
    this.group.add(this.smallRockMesh);
  }

  hideSmallRock(i: number): void {
    const r = this.smallRocks[i];
    r.active = false;
    this.dummy.position.set(r.x, -100, r.z);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.smallRockMesh.setMatrixAt(i, this.dummy.matrix);
    this.smallRockMesh.instanceMatrix.needsUpdate = true;
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
