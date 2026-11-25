import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { library } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';
import { buildLog, logMaterials, woodMaterial } from '../weapons/models';
import { Circle, ColliderGrid } from './colliders';
import { LAKE_CENTER, LAKE_LEVEL, Terrain } from './terrain';
import { detailTextures } from './textures';

export type BuildKind = 'cabin' | 'bed' | 'campfire' | 'logHolder' | 'wall' | 'gate';

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
  { id: 'cabin', label: 'Cabana de Madeira', icon: '🛖', level: 1, kind: 'build', cost: {}, desc: 'Cabana espaçosa (7,5 × 6,5 m) com porta, janelas, alpendre e lampião. Escolha o lugar e entregue 6 toras, 10 gravetos e 6 pedras com [E].' },
  { id: 'bed', label: 'Cama de Sobrevivência', icon: '🛏️', level: 1, kind: 'build', cost: { logs: 4, cloth: 4, hide: 2 }, desc: 'Coloque dentro da Cabana pronta. [E] Dormir e Salvar: vida cheia e pula para as 07:00.' },
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
      // Placement preview: floor, porch, walls and roof outline of the cabin footprint.
      const pm = plankMat();
      const W = CABIN_W;
      const D = CABIN_D;
      const floor = add(new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D + PORCH), pm));
      floor.position.set(0, 0.45, -PORCH / 2);
      for (const [w, d2, x, z] of [[W, 0.36, 0, D / 2 - 0.18], [0.36, D, -W / 2 + 0.18, 0], [0.36, D, W / 2 - 0.18, 0], [(W - DOOR_W) / 2, 0.36, -(W + DOOR_W) / 4, -D / 2 + 0.18], [(W - DOOR_W) / 2, 0.36, (W + DOOR_W) / 4, -D / 2 + 0.18]] as number[][]) {
        const wall = add(new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, d2), pm));
        wall.position.set(x, 0.55 + 1.7, z);
      }
      const roof = add(new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.1, 4), pm));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 1.05);
      roof.position.set(0, 0.55 + 3.4 + 1.05, -0.5);
      break;
    }
    case 'bed':
      buildBed(g, add);
      break;
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
export const FOOTPRINT: Record<BuildKind, number> = { cabin: 5.2, bed: 1.1, campfire: 0.8, logHolder: 1.0, wall: 1.6, gate: 1.6 };

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

/** Cabin size (metres): interior width, depth and wall height above the floor. */
export const CABIN_W = 7.5;
export const CABIN_D = 6.5;
const FLOOR_TOP = 0.54;
const LOG_R = 0.18;
const ROW = LOG_R * 1.9;
const ROWS = 10;
const DOOR_W = 1.3;
const DOOR_H = 2.3;
const WIN_W = 1.3;
const WIN_LO = 0.9;
const WIN_HI = 2.0;
const RISE = 2.0;
const PORCH = 1.7;
const STEP = 0.3;

/** Pieces of a wall row between openings: [start, end] spans along the wall. */
function rowSegments(length: number, holes: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let a = -length / 2;
  for (const [h0, h1] of holes) {
    if (h0 - a > 0.15) out.push([a, h0]);
    a = Math.max(a, h1);
  }
  if (length / 2 - a > 0.15) out.push([a, length / 2]);
  return out;
}

/**
 * The log cabin: a blueprint that fills in as materials are delivered. 7.5 x 6.5 m
 * with a 3.4 m wall height, closed gables under a pitched roof, two side windows,
 * a hinged front door with real colliders, a covered porch with steps and a lantern.
 */
export class Cabin {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  readonly delivered = { logs: 0, sticks: 0, rocks: 0 };
  private parts: CabinPart[] = [];
  private colliderSpots: { x: number; z: number; r: number }[] = [];
  private doorSpots: { x: number; z: number }[] = [];
  private doorColliders: Circle[] = [];
  private door = new THREE.Group();
  private lantern = new THREE.Group();
  private doorAngle = 0;
  /** Steps down from the porch (each STEP lower than the one before). */
  readonly steps: number;
  doorOpen = false;
  complete = false;

  constructor(terrain: Terrain, pos: THREE.Vector3, yaw: number, private colliders: ColliderGrid) {
    this.pos = pos.clone();
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    const W = CABIN_W;
    const D = CABIN_D;
    const front = -D / 2;
    const pm = plankMat();
    const logs = logMaterials();
    const add = (mesh: THREE.Mesh, solid: THREE.Material | THREE.Material[], parent: THREE.Object3D = this.group) => {
      mesh.material = ghostMat;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.parts.push({ mesh, solid });
      return mesh;
    };
    const local = (lx: number, lz: number) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      return terrain.height(pos.x + lx * c + lz * s, pos.z - lx * s + lz * c);
    };

    // Stilts down to the lowest ground under the cabin and porch.
    const postAt: [number, number][] = [];
    for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) for (const z of [front - PORCH + 0.2, front + 0.2, 0, D / 2 - 0.2]) postAt.push([x, z]);
    for (const [x, z] of postAt) {
      const h = FLOOR_TOP + Math.max(0, pos.y - local(x, z)) + 0.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, h, 7), woodMaterial());
      post.position.set(x, FLOOR_TOP - 0.1 - h / 2, z);
      add(post, woodMaterial());
    }
    // Floor (cabin + porch) and the steps down to the ground in front.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, D), pm);
    floor.position.y = FLOOR_TOP - 0.09;
    add(floor, pm);
    const porch = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, PORCH), pm);
    porch.position.set(0, FLOOR_TOP - 0.08, front - PORCH / 2);
    add(porch, pm);
    const ground = local(0, front - PORCH - 0.5);
    this.steps = Math.max(1, Math.min(6, Math.ceil((pos.y + FLOOR_TOP - ground - 0.15) / STEP)));
    for (let i = 0; i < this.steps; i++) {
      const top = FLOOR_TOP - STEP * (i + 1);
      const h = Math.max(0.12, top - (ground - pos.y) + 0.3);
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, h, 0.4), pm);
      step.position.set(0, top - h / 2, front - PORCH - 0.2 - i * 0.4);
      add(step, pm);
    }

    // Log walls, row by row, with the door and window openings left free.
    const rowY = (r: number) => FLOOR_TOP + 0.01 + LOG_R + r * ROW;
    const sideLift = LOG_R * 0.95;
    for (let r = 0; r < ROWS; r++) {
      const y = rowY(r);
      const off = r % 2 ? 0.08 : 0;
      for (const [zWall, isFront] of [
        [D / 2 - LOG_R, false],
        [front + LOG_R, true],
      ] as [number, boolean][]) {
        const holes: [number, number][] = isFront && y - LOG_R < FLOOR_TOP + DOOR_H ? [[-DOOR_W / 2, DOOR_W / 2]] : [];
        for (const [a, b] of rowSegments(W + 0.3, holes)) {
          const log = buildLog(b - a, LOG_R);
          log.rotation.z = Math.PI / 2;
          log.position.set((a + b) / 2 + (holes.length ? 0 : off), y, zWall);
          add(log, logs);
        }
      }
      const ys = y + sideLift;
      const winRow = ys > FLOOR_TOP + WIN_LO && ys < FLOOR_TOP + WIN_HI;
      for (const sx of [-1, 1]) {
        const holes: [number, number][] = winRow ? [[-WIN_W / 2, WIN_W / 2]] : [];
        for (const [a, b] of rowSegments(D + 0.3, holes)) {
          const log = buildLog(b - a, LOG_R);
          log.rotation.x = Math.PI / 2;
          log.position.set(sx * (W / 2 - LOG_R), ys, (a + b) / 2 + (holes.length ? 0 : off));
          add(log, logs);
        }
      }
    }
    const frontTop = rowY(ROWS - 1) + LOG_R;
    const eaveY = rowY(ROWS - 1) + sideLift + LOG_R;
    const ridgeY = eaveY + RISE;

    // Window frames (sill, head, jambs) through the side walls.
    let winBottom = 0;
    let winTop = 9;
    for (let r = 0; r < ROWS; r++) {
      const ys = rowY(r) + sideLift;
      const cut = ys > FLOOR_TOP + WIN_LO && ys < FLOOR_TOP + WIN_HI;
      if (!cut && ys < FLOOR_TOP + WIN_LO) winBottom = ys + LOG_R;
      if (!cut && ys > FLOOR_TOP + WIN_HI && winTop === 9) winTop = ys - LOG_R;
    }
    const frameMat = woodMaterial();
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - LOG_R);
      const depth = LOG_R * 2 + 0.14;
      const sill = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.08, 0.08, WIN_W + 0.3), frameMat);
      sill.position.set(x, winBottom + 0.04, 0);
      add(sill, frameMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.1, WIN_W + 0.2), frameMat);
      head.position.set(x, winTop - 0.05, 0);
      add(head, frameMat);
      for (const sz of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(depth, winTop - winBottom, 0.1), frameMat);
        jamb.position.set(x, (winTop + winBottom) / 2, sz * (WIN_W / 2 + 0.05));
        add(jamb, frameMat);
      }
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, winTop - winBottom, 0.06), frameMat);
      mullion.position.set(x + sx * (depth / 2 - 0.05), (winTop + winBottom) / 2, 0);
      add(mullion, frameMat);
    }
    // Door frame.
    for (const sx of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.1, DOOR_H + 0.1, LOG_R * 2 + 0.14), frameMat);
      jamb.position.set(sx * (DOOR_W / 2 + 0.05), FLOOR_TOP + (DOOR_H + 0.1) / 2, front + LOG_R);
      add(jamb, frameMat);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.3, 0.12, LOG_R * 2 + 0.14), frameMat);
    lintel.position.set(0, FLOOR_TOP + DOOR_H + 0.06, front + LOG_R);
    add(lintel, frameMat);

    // Tie beams across the room (the lantern hangs from the middle one).
    for (const z of [-1.6, 0, 1.6]) {
      const beam = buildLog(W - 0.2, 0.12);
      beam.rotation.z = Math.PI / 2;
      beam.position.set(0, eaveY - 0.12, z);
      add(beam, logs);
    }

    // Closed gables: boards fill the whole triangle under the roof, front and back.
    const gable = new THREE.Shape();
    const gb = frontTop - 0.05;
    gable.moveTo(-W / 2, gb);
    gable.lineTo(W / 2, gb);
    gable.lineTo(W / 2, eaveY);
    gable.lineTo(0, ridgeY);
    gable.lineTo(-W / 2, eaveY);
    gable.lineTo(-W / 2, gb);
    const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: 0.16, bevelEnabled: false });
    gableGeo.translate(0, 0, -0.08);
    const gableMat = plankMat();
    for (const z of [front + LOG_R, D / 2 - LOG_R]) {
      const g = new THREE.Mesh(gableGeo, gableMat);
      g.position.z = z;
      add(g, gableMat);
    }
    // Battens over the gable boards for a hand-built look.
    for (let i = -3; i <= 3; i++) {
      const x = i * 0.95;
      const top = ridgeY - Math.abs(x) * (RISE / (W / 2)) - 0.08;
      const h = top - gb;
      if (h < 0.2) continue;
      for (const [z, sz] of [
        [front + LOG_R, -1],
        [D / 2 - LOG_R, 1],
      ] as [number, number][]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.04), frameMat);
        b.position.set(x, gb + h / 2, z + sz * 0.1);
        add(b, frameMat);
      }
    }
    // Eave boards close the gap between the side walls and the roof.
    for (const sx of [-1, 1]) {
      const eave = new THREE.Mesh(new THREE.BoxGeometry(LOG_R * 2 + 0.1, 0.24, D + 0.3), frameMat);
      eave.position.set(sx * (W / 2 - LOG_R), eaveY + 0.06, 0);
      add(eave, frameMat);
    }

    // Pitched roof: two slabs from the ridge past the eaves, covering the porch too.
    const roofMat = plankMat();
    const ang = Math.atan2(RISE, W / 2);
    const over = 0.6;
    const span = (W / 2 + over) / Math.cos(ang);
    const T = 0.14;
    const back = D / 2 + 0.5;
    const fore = front - PORCH - 0.15;
    for (const sx of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(span, T, back - fore), roofMat);
      const hx = (W / 2 + over) / 2;
      slab.position.set(sx * hx + sx * Math.sin(ang) * (T / 2), ridgeY - hx * Math.tan(ang) + Math.cos(ang) * (T / 2), (back + fore) / 2);
      slab.rotation.z = -sx * ang;
      slab.castShadow = true;
      add(slab, roofMat);
    }
    const ridge = buildLog(back - fore + 0.1, 0.14);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.set(0, ridgeY + 0.1, (back + fore) / 2);
    add(ridge, logs);
    // Porch pillars under the front of the roof.
    const roofUnder = (x: number) => ridgeY - Math.abs(x) * Math.tan(ang);
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.35);
      const h = roofUnder(x) - FLOOR_TOP;
      const pillar = buildLog(h, 0.11);
      pillar.position.set(x, FLOOR_TOP + h / 2, front - PORCH + 0.25);
      add(pillar, logs);
      this.colliderSpots.push({ x, z: front - PORCH + 0.25, r: 0.18 });
    }

    // Hinged door: planks on a pivot at the left jamb (opens outward onto the porch).
    this.door.position.set(-DOOR_W / 2, FLOOR_TOP, front + LOG_R);
    this.group.add(this.door);
    const doorMat = plankMat();
    for (let i = 0; i < 5; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.255, DOOR_H - 0.04, 0.07), doorMat);
      plank.position.set(0.13 + i * 0.26, (DOOR_H - 0.04) / 2, 0);
      add(plank, doorMat, this.door);
    }
    for (const y of [0.35, DOOR_H - 0.4]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W - 0.1, 0.12, 0.05), frameMat);
      brace.position.set(DOOR_W / 2, y, -0.06);
      add(brace, frameMat, this.door);
    }
    const diag = new THREE.Mesh(new THREE.BoxGeometry(0.1, Math.hypot(DOOR_W - 0.2, DOOR_H - 0.75), 0.05), frameMat);
    diag.position.set(DOOR_W / 2, DOOR_H / 2 - 0.02, -0.06);
    diag.rotation.z = Math.atan2(DOOR_W - 0.2, DOOR_H - 0.75);
    add(diag, frameMat, this.door);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.6, metalness: 0.4 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 8), handleMat);
    handle.position.set(DOOR_W - 0.15, 1.05, -0.08);
    add(handle, handleMat, this.door);
    for (let i = -1; i <= 1; i++) this.doorSpots.push({ x: i * 0.42, z: front + 0.2 });

    // Lantern hanging from the middle tie beam (lit when the cabin is finished).
    const metal = new THREE.MeshStandardMaterial({ color: 0x2e2a25, roughness: 0.55, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffa040, emissiveIntensity: 0.9, transparent: true, opacity: 0.45, roughness: 0.2 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 8), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
    flame.position.y = -0.02;
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8, 1, true), glass);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.1, 8), metal);
    cap.position.y = 0.16;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.04, 8), metal);
    base.position.y = -0.13;
    const lampY = eaveY - 0.95;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, eaveY - 0.12 - lampY - 0.2, 4), metal);
    rope.position.y = 0.2 + (eaveY - 0.12 - lampY - 0.2) / 2;
    this.lantern.add(flame, cage, cap, base, rope);
    this.lantern.position.set(0, lampY, 0.12);
    this.lantern.visible = false;
    this.group.add(this.lantern);

    // Collider spots along the walls, leaving the doorway to the door's own colliders.
    for (let t = -W / 2; t <= W / 2 + 0.01; t += 0.5) {
      this.colliderSpots.push({ x: t, z: D / 2 - 0.2, r: 0.3 });
      if (Math.abs(t) > DOOR_W / 2 + 0.2) this.colliderSpots.push({ x: t, z: front + 0.2, r: 0.3 });
    }
    for (let t = -D / 2; t <= D / 2 + 0.01; t += 0.5) {
      this.colliderSpots.push({ x: -W / 2 + 0.2, z: t, r: 0.3 }, { x: W / 2 - 0.2, z: t, r: 0.3 });
    }
  }

  /** Cabin-local coordinates of a world point. */
  toLocal(x: number, z: number): { lx: number; lz: number } {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const yaw = this.group.rotation.y;
    return { lx: dx * Math.cos(yaw) - dz * Math.sin(yaw), lz: dx * Math.sin(yaw) + dz * Math.cos(yaw) };
  }

  /** World point from cabin-local coordinates. */
  toWorld(lx: number, lz: number, out: THREE.Vector3, ly = 0): THREE.Vector3 {
    const c = Math.cos(this.group.rotation.y);
    const s = Math.sin(this.group.rotation.y);
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y + ly, this.pos.z - lx * s + lz * c);
  }

  /** Inside the walls (not the porch). */
  inside(x: number, z: number, margin = 0.25): boolean {
    const { lx, lz } = this.toLocal(x, z);
    return Math.abs(lx) < CABIN_W / 2 - margin && Math.abs(lz) < CABIN_D / 2 - margin;
  }

  /** Walkable plank height at (x, z): floor and porch, then the steps; null elsewhere. */
  floorAt(x: number, z: number): number | null {
    const { lx, lz } = this.toLocal(x, z);
    const front = -CABIN_D / 2;
    if (Math.abs(lx) < CABIN_W / 2 && lz < CABIN_D / 2 && lz > front - PORCH) return this.pos.y + FLOOR_TOP;
    if (Math.abs(lx) < 0.9 && lz <= front - PORCH && lz > front - PORCH - this.steps * 0.4) {
      const i = Math.floor((front - PORCH - lz) / 0.4);
      return this.pos.y + FLOOR_TOP - STEP * (i + 1);
    }
    return null;
  }

  /** World position of the lantern flame. */
  lampWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.lantern.getWorldPosition(out);
  }

  /** World position of the middle of the doorway. */
  doorWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(0, -CABIN_D / 2, out, FLOOR_TOP + 1);
  }

  setDoor(open: boolean): void {
    this.doorOpen = open;
    for (const c of this.doorColliders) c.active = !open;
  }

  update(dt: number): void {
    const target = this.doorOpen ? 1.75 : 0;
    this.doorAngle += (target - this.doorAngle) * Math.min(1, dt * 7);
    this.door.rotation.y = this.doorAngle;
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
      this.lantern.visible = true;
      const v = new THREE.Vector3();
      const y0 = this.pos.y - 1;
      const y1 = this.pos.y + FLOOR_TOP + 4.5;
      for (const sp of this.colliderSpots) {
        this.toWorld(sp.x, sp.z, v);
        this.colliders.add({ x: v.x, z: v.z, r: sp.r, y0, y1, kind: 'plane', ref: 1 });
      }
      for (const sp of this.doorSpots) {
        this.toWorld(sp.x, sp.z, v);
        this.doorColliders.push(this.colliders.add({ x: v.x, z: v.z, r: 0.3, y0, y1, kind: 'plane', ref: 1 }));
      }
      this.setDoor(this.doorOpen);
    }
  }
}

/** Woven linen or tanned leather, drawn once on a canvas. */
const fabricCache: Record<string, THREE.CanvasTexture> = {};
function fabricTexture(kind: 'linen' | 'leather'): THREE.CanvasTexture {
  if (fabricCache[kind]) return fabricCache[kind];
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(s, s);
  const r = mulberry32(kind === 'linen' ? 11 : 23);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let v: number;
      if (kind === 'linen') {
        // Over-under weave plus slub noise.
        const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.94 : 1.0;
        v = weave * (0.9 + r() * 0.1) * (y % 2 && x % 3 === 0 ? 0.93 : 1);
      } else {
        // Grain: soft blotches and fine pores.
        v = 0.82 + 0.1 * Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2.2) * Math.sin(y * 0.17) + r() * 0.08;
      }
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.min(1, v));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (kind === 'leather') {
    // Stitched border.
    g.strokeStyle = 'rgba(255,240,210,0.55)';
    g.setLineDash([4, 4]);
    g.lineWidth = 2;
    g.strokeRect(6, 6, s - 12, s - 12);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  fabricCache[kind] = t;
  return t;
}

/** Rustic log bed: frame, plank base, linen mattress and pillow, leather blanket. Head at +Z. */
function buildBed(g: THREE.Group, add: (m: THREE.Mesh) => THREE.Mesh): void {
  const pm = plankMat();
  for (const x of [-0.56, 0.56]) {
    for (const z of [-0.98, 0.98]) {
      const tall = z > 0 ? 0.95 : 0.5;
      const post = add(buildLog(tall, 0.065));
      post.position.set(x, tall / 2, z);
    }
    const rail = add(buildLog(1.95, 0.055));
    rail.rotation.x = Math.PI / 2;
    rail.position.set(x, 0.28, 0);
  }
  for (const z of [-0.98, 0.98]) {
    const end = add(buildLog(1.12, 0.05));
    end.rotation.z = Math.PI / 2;
    end.position.set(0, 0.28, z);
  }
  const head = add(new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.42, 0.06), pm));
  head.position.set(0, 0.68, 0.98);
  const slats = add(new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.05, 1.92), pm));
  slats.position.y = 0.33;
  const linen = new THREE.MeshStandardMaterial({ color: 0xe9e1cc, roughness: 0.95, map: fabricTexture('linen') });
  const mattress = add(new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.2, 1.9, 3, 0.07), linen));
  mattress.position.y = 0.455;
  const pillow = add(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.13, 0.36, 3, 0.06), linen));
  pillow.position.set(0, 0.6, 0.7);
  pillow.rotation.x = -0.12;
  const leatherTex = fabricTexture('leather');
  const leather = new THREE.MeshStandardMaterial({ color: 0x9a6438, roughness: 0.78, map: leatherTex });
  const blanket = add(new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.05, 1.2, 2, 0.02), leather));
  blanket.position.set(0, 0.575, -0.33);
  for (const sx of [-1, 1]) {
    const drape = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 1.2), leather));
    drape.position.set(sx * 0.545, 0.47, -0.33);
  }
  const foot = add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.03), leather));
  foot.position.set(0, 0.47, -0.93);
  // Folded-back edge of the blanket.
  const fold = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.08, 10), leather));
  fold.rotation.z = Math.PI / 2;
  fold.position.set(0, 0.61, 0.27);
}

/** Everything the player builds anywhere on the island: cabins and free placements. */
export class BaseSite {
  readonly group = new THREE.Group();
  readonly cabins: Cabin[] = [];
  readonly placed: Placed[] = [];
  /** Level of the player's own crafting menu (1 → 3). */
  benchLevel = 1;

  constructor(private terrain: Terrain, private colliders: ColliderGrid) {}

  /** Plank height on a finished cabin's floor, porch or steps (walkable wood), else null. */
  cabinFloorAt(x: number, z: number): number | null {
    for (const c of this.cabins) {
      if (!c.complete) continue;
      const h = c.floorAt(x, z);
      if (h !== null) return h;
    }
    return null;
  }

  /** The finished cabin whose walls contain (x, z), if any. */
  cabinAround(x: number, z: number, margin = 0.25): Cabin | null {
    for (const c of this.cabins) if (c.complete && c.inside(x, z, margin)) return c;
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

  /** Lowest and highest ground under a cabin footprint (porch included). */
  private footprintRange(x: number, z: number, yaw: number): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let lx = -CABIN_W / 2; lx <= CABIN_W / 2 + 0.01; lx += CABIN_W / 4) {
      for (let lz = -CABIN_D / 2 - PORCH; lz <= CABIN_D / 2 + 0.01; lz += (CABIN_D + PORCH) / 4) {
        const h = this.terrain.height(x + lx * c + lz * s, z - lx * s + lz * c);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    return { min, max };
  }

  canPlace(kind: BuildKind, x: number, z: number, yaw = 0): boolean {
    if (kind === 'bed') return this.canPlaceBed(x, z, yaw);
    const h = this.terrain.height(x, z);
    if (h < LAKE_LEVEL + 0.2 && this.terrain.waterLevelAt(x, z) === LAKE_LEVEL) return false;
    if (h < 0.3) return false;
    if (this.terrain.slope(x, z) > 0.35) return false;
    if (this.cabins.some((c) => Math.hypot(x - c.pos.x, z - c.pos.z) < 6 + (kind === 'cabin' ? 4 : 0))) return false;
    if (kind === 'cabin') {
      if (this.terrain.slope(x, z) > 0.25) return false;
      const r = this.footprintRange(x, z, yaw);
      if (r.max - r.min > 1.3 || r.min < 0.3) return false;
    }
    return this.colliders.isFree(x, z, FOOTPRINT[kind] * 0.6);
  }

  /** A bed fits when its whole frame stands on one finished cabin's floor, clear of other beds. */
  canPlaceBed(x: number, z: number, yaw: number): boolean {
    const cabin = this.cabinAround(x, z, 0.3);
    if (!cabin) return false;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [lx, lz] of [[-0.62, -1.05], [0.62, -1.05], [-0.62, 1.05], [0.62, 1.05]]) {
      if (!cabin.inside(x + lx * c + lz * s, z - lx * s + lz * c, 0.3)) return false;
    }
    // Keep the doorway clear.
    const d = cabin.toLocal(x, z);
    if (d.lz < -CABIN_D / 2 + 1.6 && Math.abs(d.lx) < 1.5) return false;
    return !this.placed.some((p) => p.kind === 'bed' && Math.hypot(p.pos.x - x, p.pos.z - z) < 1.4);
  }

  /** A cabin blueprint where the player chose; materials are delivered with [E]. */
  placeCabin(x: number, z: number, yaw: number): Cabin {
    // Raise the floor clear of the highest ground under it; stilts and steps reach the rest.
    const r = this.footprintRange(x, z, yaw);
    const y = Math.max(this.terrain.height(x, z), r.max - 0.2);
    const cabin = new Cabin(this.terrain, new THREE.Vector3(x, y, z), yaw, this.colliders);
    this.cabins.push(cabin);
    this.group.add(cabin.group);
    return cabin;
  }

  place(kind: BuildKind, x: number, z: number, yaw: number): Placed {
    // A bed stands on the cabin's planks; everything else on the ground.
    const floor = kind === 'bed' ? this.cabinFloorAt(x, z) : null;
    const y = floor ?? this.terrain.height(x, z);
    const group = buildModel(kind);
    group.position.set(x, floor !== null ? y : y - 0.03, z);
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
      case 'bed':
        addC(0, -0.5, 0.5, 0.6);
        addC(0, 0.5, 0.5, 0.6);
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
    for (const c of this.cabins) c.update(dt);
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
