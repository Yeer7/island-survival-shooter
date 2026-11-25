import * as THREE from 'three';
import { library } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';
import { buildLog, logMaterials, woodMaterial } from '../weapons/models';
import { Circle, ColliderGrid } from './colliders';
import { LAKE_CENTER, LAKE_LEVEL, Terrain } from './terrain';
import { detailTextures } from './textures';

export type BuildKind = 'cabin' | 'campfire' | 'logHolder' | 'wall' | 'gate';

export interface Cost {
  logs?: number;
  sticks?: number;
  rocks?: number;
  cloth?: number;
  hide?: number;
}

export interface Recipe {
  id: string;
  label: string;
  icon: string;
  level: 1 | 2 | 3;
  kind: 'build' | 'tool' | 'armor' | 'item' | 'boat';
  cost: Cost;
  desc: string;
}

export const RECIPES: Recipe[] = [
  { id: 'cabin', label: 'Cabana de Madeira', icon: '🛖', level: 1, kind: 'build', cost: {}, desc: 'Escolha o lugar; depois entregue 6 toras, 10 gravetos e 6 pedras com [E]. Pronta: dormir.' },
  { id: 'campfire', label: 'Fogueira', icon: '🔥', level: 1, kind: 'build', cost: { logs: 1, sticks: 4, rocks: 4 }, desc: 'Assa carne e peixe, ilumina a noite.' },
  { id: 'logHolder', label: 'Suporte de Toras', icon: '🪵', level: 1, kind: 'build', cost: { logs: 2, sticks: 4 }, desc: 'Guarda até 12 toras perto da base.' },
  { id: 'torch', label: 'Tocha', icon: '🕯️', level: 1, kind: 'tool', cost: { sticks: 2, cloth: 1 }, desc: 'Luz quente para a noite.' },
  { id: 'rod', label: 'Vara de Pesca', icon: '🎣', level: 1, kind: 'tool', cost: { sticks: 3, cloth: 1 }, desc: 'Pesque no lago (mais rápido na doca).' },
  { id: 'spear', label: 'Lança de Madeira', icon: '🔱', level: 1, kind: 'tool', cost: { sticks: 4, rocks: 1 }, desc: 'Estocada de longo alcance.' },
  { id: 'hideArmor', label: 'Armadura de Pele', icon: '🦺', level: 1, kind: 'armor', cost: { hide: 3, cloth: 1 }, desc: 'Vida máxima 150.' },
  { id: 'wall', label: 'Muro / Paliçada', icon: '🧱', level: 2, kind: 'build', cost: { logs: 2 }, desc: 'Paliçada de troncos afiados (3 m).' },
  { id: 'gate', label: 'Portão', icon: '🚪', level: 2, kind: 'build', cost: { logs: 3, sticks: 2 }, desc: 'Portão de madeira que abre com [E].' },
  { id: 'bow', label: 'Arco de Caça', icon: '🏹', level: 2, kind: 'tool', cost: { sticks: 4, cloth: 1, hide: 1 }, desc: 'Combate à distância com flechas.' },
  { id: 'arrows', label: 'Flechas ×5', icon: '➶', level: 2, kind: 'item', cost: { sticks: 2, rocks: 1 }, desc: 'Munição do arco (recuperável).' },
  { id: 'reinforcedArmor', label: 'Armadura Reforçada', icon: '🛡️', level: 2, kind: 'armor', cost: { hide: 4, logs: 1, rocks: 3 }, desc: 'Vida máxima 200.' },
  { id: 'flameAxe', label: 'Machado Flamejante', icon: '🔥', level: 3, kind: 'tool', cost: { logs: 2, rocks: 4, cloth: 2 }, desc: 'Dobro de dano, cabeça em brasa.' },
];

export const LEVEL_UP: Record<2 | 3, { cost: Cost; boss: 'totem' | 'relic'; bossLabel: string }> = {
  2: { cost: { logs: 4, rocks: 4 }, boss: 'totem', bossLabel: 'Totem Tribal' },
  3: { cost: { logs: 6, rocks: 6 }, boss: 'relic', bossLabel: 'Relíquia da Caverna' },
};

export const CABIN_COST = { logs: 6, sticks: 10, rocks: 6 };

const ghostMat = new THREE.MeshStandardMaterial({ color: 0x6fb6ff, emissive: 0x2a6cff, emissiveIntensity: 0.35, transparent: true, opacity: 0.28, depthWrite: false });
const ghostBad = new THREE.MeshStandardMaterial({ color: 0xff6a6a, emissive: 0xff2a2a, emissiveIntensity: 0.35, transparent: true, opacity: 0.3, depthWrite: false });

function stoneMat(): THREE.MeshStandardMaterial {
  const t = detailTextures();
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8d8a84).multiplyScalar(1.3), roughness: 0.9, flatShading: true, map: t.rock });
}

function plankMat(): THREE.MeshStandardMaterial {
  const t = detailTextures();
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(0x9b7650).multiplyScalar(1.35), roughness: 0.88, map: t.plank });
}

/** Meshes for each buildable, shared by the placed object and its preview ghost. */
export function buildModel(kind: BuildKind): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Mesh) => {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const r = mulberry32(kind.length * 7);
  switch (kind) {
    case 'cabin': {
      // Placement preview: floor, walls and roof outline of the cabin footprint.
      const pm = plankMat();
      const floor = add(new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.2, 4.4), pm));
      floor.position.y = 0.45;
      for (const [w, d2, x, z] of [[5.4, 0.3, 0, 2.05], [0.3, 4.4, -2.55, 0], [0.3, 4.4, 2.55, 0], [1.9, 0.3, -1.75, -2.05], [1.9, 0.3, 1.75, -2.05]] as number[][]) {
        const wall = add(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d2), pm));
        wall.position.set(x, 1.75, z);
      }
      const roof = add(new THREE.Mesh(new THREE.ConeGeometry(4, 1.6, 4), pm));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 3.75;
      break;
    }
    case 'campfire': {
      const lib = library();
      if (lib && lib.has('campfire')) {
        const pit = lib.instance('campfire', { by: 'footprint', value: 1.4 });
        pit.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
        });
        g.add(pit);
        break;
      }
      const sm = stoneMat();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const s = add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), sm));
        s.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
        s.rotation.set(r() * 3, r() * 3, r() * 3);
        s.scale.set(1, 0.7, 1);
      }
      for (let i = 0; i < 4; i++) {
        const l = add(buildLog(0.8, 0.06));
        l.rotation.set(Math.PI / 2 - 0.5, (i / 4) * Math.PI * 2, 0, 'YXZ');
        l.position.set(Math.cos((i / 4) * Math.PI * 2) * 0.15, 0.2, Math.sin((i / 4) * Math.PI * 2) * 0.15);
      }
      const ash = add(new THREE.Mesh(new THREE.CircleGeometry(0.45, 12), new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 1 })));
      ash.rotation.x = -Math.PI / 2;
      ash.position.y = 0.02;
      break;
    }
    case 'logHolder': {
      const w = woodMaterial();
      for (const x of [-0.8, 0.8]) {
        for (const z of [-0.45, 0.45]) {
          const p = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6), w));
          p.position.set(x, 0.6, z);
        }
      }
      for (const x of [-0.8, 0.8]) {
        const b = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.0), w));
        b.position.set(x, 0.12, 0);
      }
      break;
    }
    case 'wall': {
      for (let i = 0; i < 6; i++) {
        const post = add(buildLog(2.6, 0.13 + r() * 0.03));
        post.position.set(-1.25 + i * 0.5, 1.3, 0);
        const tip = add(new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 7), woodMaterial()));
        tip.position.set(-1.25 + i * 0.5, 2.75, 0);
      }
      const brace = add(buildLog(3.0, 0.07));
      brace.rotation.z = Math.PI / 2;
      brace.position.set(0, 1.6, 0.16);
      break;
    }
    case 'gate': {
      for (const x of [-1.35, 1.35]) {
        const p = add(buildLog(3.0, 0.15));
        p.position.set(x, 1.5, 0);
      }
      const top = add(buildLog(3.0, 0.1));
      top.rotation.z = Math.PI / 2;
      top.position.set(0, 2.85, 0);
      const door = new THREE.Group();
      door.name = 'door';
      door.position.set(-1.2, 0, 0);
      const pm = plankMat();
      for (let i = 0; i < 5; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 2.4, 0.08), pm);
        plank.position.set(0.25 + i * 0.48, 1.3, 0);
        plank.castShadow = true;
        door.add(plank);
      }
      for (const y of [0.6, 2.0]) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.06), pm);
        cross.position.set(1.2, y, 0.07);
        door.add(cross);
      }
      g.add(door);
      break;
    }
  }
  return g;
}

export function setGhost(obj: THREE.Object3D, ok: boolean): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = ok ? ghostMat : ghostBad;
      m.castShadow = false;
    }
  });
}

/** Footprint radius used for placement checks and colliders. */
export const FOOTPRINT: Record<BuildKind, number> = { cabin: 3.6, campfire: 0.8, logHolder: 1.0, wall: 1.6, gate: 1.6 };

export interface Placed {
  kind: BuildKind;
  group: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  colliders: Circle[];
  logs: number;
  logMeshes: THREE.Mesh[];
  open: boolean;
  fire: PuffEmitter | null;
  smoke: PuffEmitter | null;
  cooking: { item: 'meat' | 'fish'; t: number } | null;
}

interface CabinPart {
  mesh: THREE.Mesh;
  solid: THREE.Material | THREE.Material[];
}

/** The broken log cabin: a blueprint that fills in as materials are delivered. */
export class Cabin {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  readonly delivered = { logs: 0, sticks: 0, rocks: 0 };
  private parts: CabinPart[] = [];
  private colliderSpots: { x: number; z: number }[] = [];
  complete = false;

  constructor(private terrain: Terrain, pos: THREE.Vector3, yaw: number, private colliders: ColliderGrid) {
    this.pos = pos.clone();
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    const W = 5.4;
    const D = 4.4;
    const floorY = 0.45;
    const pm = plankMat();
    const add = (mesh: THREE.Mesh, solid: THREE.Material | THREE.Material[]) => {
      mesh.material = ghostMat;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.parts.push({ mesh, solid });
    };
    // Stilts reach down to the ground so the cabin sits level on a slope.
    const lowest = this.lowestCorner(pos, yaw, W, D);
    for (const [x, z] of [[-W / 2 + 0.2, -D / 2 + 0.2], [W / 2 - 0.2, -D / 2 + 0.2], [-W / 2 + 0.2, D / 2 - 0.2], [W / 2 - 0.2, D / 2 - 0.2]]) {
      const h = floorY + (pos.y - lowest) + 0.6;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, h, 7), woodMaterial());
      post.position.set(x, floorY - h / 2, z);
      add(post, woodMaterial());
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, D), pm);
    floor.position.y = floorY;
    add(floor, pm);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.7), pm);
    step.position.set(0, floorY - 0.25, -D / 2 - 0.35);
    add(step, pm);

    const logs = logMaterials();
    const R = 0.16;
    for (let row = 0; row < 7; row++) {
      const y = floorY + 0.1 + R + row * R * 1.9;
      const off = row % 2 ? 0.08 : 0;
      const back = buildLog(W + 0.3, R);
      back.rotation.z = Math.PI / 2;
      back.position.set(off, y, D / 2 - R);
      add(back, logs);
      for (const sx of [-1, 1]) {
        const side = buildLog(D + 0.3, R);
        side.rotation.x = Math.PI / 2;
        side.position.set(sx * (W / 2 - R), y + R * 0.95, off);
        add(side, logs);
      }
      if (row < 5) {
        for (const sx of [-1, 1]) {
          const len = W / 2 - 0.7;
          const half = buildLog(len, R);
          half.rotation.z = Math.PI / 2;
          half.position.set(sx * (0.7 + len / 2), y, -D / 2 + R);
          add(half, logs);
        }
      } else {
        const lintel = buildLog(W + 0.3, R);
        lintel.rotation.z = Math.PI / 2;
        lintel.position.set(0, y, -D / 2 + R);
        add(lintel, logs);
      }
    }
    const wallTop = floorY + 0.1 + 7 * R * 1.9;
    const roofMat = plankMat();
    for (const sx of [-1, 1]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W / 2 + 0.7, 0.14, D + 1.0), roofMat);
      roof.position.set(sx * (W / 4 + 0.05), wallTop + 0.75, 0);
      roof.rotation.z = -sx * 0.52;
      roof.castShadow = true;
      add(roof, roofMat);
    }
    const ridge = buildLog(D + 1.1, 0.13);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.set(0, wallTop + 1.45, 0);
    add(ridge, logs);

    // Collider spots around the walls with a gap for the door.
    for (let t = -W / 2; t <= W / 2; t += 0.6) {
      this.colliderSpots.push({ x: t, z: D / 2 - 0.2 });
      if (Math.abs(t) > 0.75) this.colliderSpots.push({ x: t, z: -D / 2 + 0.2 });
    }
    for (let t = -D / 2; t <= D / 2; t += 0.6) {
      this.colliderSpots.push({ x: -W / 2 + 0.2, z: t }, { x: W / 2 - 0.2, z: t });
    }
  }

  private lowestCorner(pos: THREE.Vector3, yaw: number, W: number, D: number): number {
    let low = pos.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
      const wx = pos.x + x * c + z * s;
      const wz = pos.z - x * s + z * c;
      low = Math.min(low, this.terrain.height(wx, wz));
    }
    return low;
  }

  get progress(): number {
    const d = this.delivered;
    const c = CABIN_COST;
    return (Math.min(d.logs, c.logs) * 3 + Math.min(d.sticks, c.sticks) + Math.min(d.rocks, c.rocks)) / (c.logs * 3 + c.sticks + c.rocks);
  }

  /** Deliver what the player has; returns what was taken. */
  deliver(have: { logs: number; sticks: number; rocks: number }): { logs: number; sticks: number; rocks: number } {
    const take = {
      logs: Math.min(have.logs, CABIN_COST.logs - this.delivered.logs),
      sticks: Math.min(have.sticks, CABIN_COST.sticks - this.delivered.sticks),
      rocks: Math.min(have.rocks, CABIN_COST.rocks - this.delivered.rocks),
    };
    this.delivered.logs += take.logs;
    this.delivered.sticks += take.sticks;
    this.delivered.rocks += take.rocks;
    this.refresh();
    return take;
  }

  refresh(): void {
    const n = Math.floor(this.progress * this.parts.length + 1e-6);
    this.parts.forEach((p, i) => {
      const solid = i < n;
      p.mesh.material = solid ? p.solid : ghostMat;
      p.mesh.castShadow = solid;
    });
    if (!this.complete && this.progress >= 1) {
      this.complete = true;
      const c = Math.cos(this.group.rotation.y);
      const s = Math.sin(this.group.rotation.y);
      for (const sp of this.colliderSpots) {
        this.colliders.add({ x: this.pos.x + sp.x * c + sp.z * s, z: this.pos.z - sp.x * s + sp.z * c, r: 0.32, y0: this.pos.y - 1, y1: this.pos.y + 4, kind: 'plane', ref: 1 });
      }
    }
  }
}

/** Everything the player builds anywhere on the island: cabins and free placements. */
export class BaseSite {
  readonly group = new THREE.Group();
  readonly cabins: Cabin[] = [];
  readonly placed: Placed[] = [];
  /** Level of the player's own crafting menu (1 → 3). */
  benchLevel = 1;

  constructor(private terrain: Terrain, private colliders: ColliderGrid) {}

  /** Floor height inside a finished cabin (plank floor you can walk on), else null. */
  cabinFloorAt(x: number, z: number): number | null {
    for (const c of this.cabins) {
      if (!c.complete) continue;
      const dx = x - c.pos.x;
      const dz = z - c.pos.z;
      const yaw = c.group.rotation.y;
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (Math.abs(lx) < 2.55 && Math.abs(lz) < 2.05) return c.pos.y + 0.54;
    }
    return null;
  }

  /** Nearest cabin within `radius`, if any. */
  cabinNear(p: THREE.Vector3, radius: number): Cabin | null {
    let best: Cabin | null = null;
    let bd = radius;
    for (const c of this.cabins) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  canPlace(kind: BuildKind, x: number, z: number): boolean {
    const h = this.terrain.height(x, z);
    if (h < LAKE_LEVEL + 0.2 && this.terrain.waterLevelAt(x, z) === LAKE_LEVEL) return false;
    if (h < 0.3) return false;
    if (this.terrain.slope(x, z) > 0.35) return false;
    if (this.cabins.some((c) => Math.hypot(x - c.pos.x, z - c.pos.z) < 4.2 + (kind === 'cabin' ? 3 : 0))) return false;
    if (kind === 'cabin' && this.terrain.slope(x, z) > 0.25) return false;
    return this.colliders.isFree(x, z, FOOTPRINT[kind] * 0.6);
  }

  /** A cabin blueprint where the player chose; materials are delivered with [E]. */
  placeCabin(x: number, z: number, yaw: number): Cabin {
    const cabin = new Cabin(this.terrain, new THREE.Vector3(x, this.terrain.height(x, z), z), yaw, this.colliders);
    this.cabins.push(cabin);
    this.group.add(cabin.group);
    return cabin;
  }

  place(kind: BuildKind, x: number, z: number, yaw: number): Placed {
    const y = this.terrain.height(x, z);
    const group = buildModel(kind);
    group.position.set(x, y - 0.03, z);
    group.rotation.y = yaw;
    this.group.add(group);
    const p: Placed = { kind, group, pos: new THREE.Vector3(x, y, z), yaw, colliders: [], logs: 0, logMeshes: [], open: false, fire: null, smoke: null, cooking: null };
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const addC = (lx: number, lz: number, r: number, h: number) =>
      p.colliders.push(this.colliders.add({ x: x + lx * c + lz * s, z: z - lx * s + lz * c, r, y0: y - 1, y1: y + h, kind: 'rock', ref: 0 }));
    switch (kind) {
      case 'campfire':
        addC(0, 0, 0.55, 0.3);
        p.fire = new PuffEmitter(28, { life: 0.8, rise: 1.4, spread: 0.45, size0: 0.9, size1: 0.2, alpha: 0.9, color: 0xff5a12, color2: 0xffd27a, additive: true });
        p.fire.origin.set(x, y + 0.2, z);
        p.fire.wind.set(0.1, 0, 0);
        p.smoke = new PuffEmitter(18, { life: 4, rise: 1.4, spread: 0.3, size0: 0.6, size1: 3, alpha: 0.25, color: 0x3a3836, color2: 0x24221f, additive: false });
        p.smoke.origin.set(x, y + 1.0, z);
        this.group.add(p.fire.points, p.smoke.points);
        break;
      case 'logHolder':
        addC(0, 0, 0.9, 1.2);
        for (let i = 0; i < 12; i++) {
          const log = buildLog(1.5, 0.11);
          log.rotation.z = Math.PI / 2;
          const row = Math.floor(i / 4);
          log.position.set(0, 0.25 + row * 0.21, -0.33 + (i % 4) * 0.22 + (row % 2) * 0.05);
          log.visible = false;
          log.castShadow = true;
          group.add(log);
          p.logMeshes.push(log);
        }
        break;
      case 'wall':
        for (let i = 0; i < 6; i++) addC(-1.25 + i * 0.5, 0, 0.27, 3);
        break;
      case 'gate':
        addC(-1.35, 0, 0.25, 3);
        addC(1.35, 0, 0.25, 3);
        for (let i = 0; i < 5; i++) addC(-0.95 + i * 0.48, 0, 0.26, 3);
        break;
    }
    this.placed.push(p);
    return p;
  }

  setHolderLogs(p: Placed, n: number): void {
    p.logs = n;
    p.logMeshes.forEach((m, i) => (m.visible = i < n));
  }

  toggleGate(p: Placed): void {
    p.open = !p.open;
    // Door colliders are the last five.
    p.colliders.slice(2).forEach((c) => (c.active = !p.open));
  }

  /** Logs stored in holders within `radius` of a point. */
  storedLogs(near: THREE.Vector3, radius = 25): number {
    let n = 0;
    for (const p of this.placed) if (p.kind === 'logHolder' && p.pos.distanceTo(near) < radius) n += p.logs;
    return n;
  }

  takeStoredLogs(near: THREE.Vector3, count: number, radius = 25): void {
    for (const p of this.placed) {
      if (count <= 0) break;
      if (p.kind !== 'logHolder' || p.pos.distanceTo(near) > radius) continue;
      const t = Math.min(p.logs, count);
      this.setHolderLogs(p, p.logs - t);
      count -= t;
    }
  }

  private tintA = new THREE.Color();
  private tintB = new THREE.Color();

  update(dt: number, time: number, light: THREE.Color): void {
    this.tintA.setHex(0x3a3836).multiply(light);
    this.tintB.setHex(0x24221f).multiply(light);
    for (const p of this.placed) {
      if (p.fire) p.fire.update(dt);
      if (p.smoke) {
        p.smoke.setTint(this.tintA, this.tintB);
        p.smoke.update(dt);
      }
      if (p.kind === 'gate') {
        const door = p.group.getObjectByName('door');
        if (door) door.rotation.y += ((p.open ? -1.6 : 0) - door.rotation.y) * Math.min(1, dt * 6);
      }
    }
    void time;
  }
}
