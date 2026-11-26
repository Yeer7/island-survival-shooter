import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bakeStatic } from '../core/bake';
import { mulberry32 } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { logMaterials } from '../weapons/models';
import {
  FuselageLayout,
  NoseLayout,
  Planform,
  brushedTexture,
  cabinWallTexture,
  carpetTexture,
  chordAt,
  finTexture,
  gridGeometry,
  hullTexture,
  liftingSurface,
  noseTexture,
  seatFabricTexture,
  surfacePoint,
  wingTexture,
} from './airliner';
import { PuffEmitter } from '../fx/particles';
import { ColliderGrid } from './colliders';
import { ItemType } from './pickups';
import { LAKE_CENTER, LAKE_LEVEL, Terrain } from './terrain';

/** Flat rounded rectangle centred on the origin (window panes and rims). */
function roundedRect(w: number, h: number, rad: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + rad, y);
  s.lineTo(x + w - rad, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rad);
  s.lineTo(x + w, y + h - rad);
  s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  s.lineTo(x + rad, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rad);
  s.lineTo(x, y + rad);
  s.quadraticCurveTo(x, y, x + rad, y);
  return new THREE.ShapeGeometry(s, 4);
}

const std = (color: number, roughness = 0.7, metalness = 0, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, side });

export interface Suitcase {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  hp: number;
  color: number;
  contents: ItemType[];
  broken: boolean;
}

// Luggage holds only survival supplies; sticks come from the forest floor.
const CONTENTS: ItemType[][] = [
  ['food', 'bandage'],
  ['cloth', 'food'],
  ['food', 'cloth'],
  ['cloth', 'cloth'],
  ['bandage', 'cloth'],
  ['food'],
  ['cloth', 'food'],
  ['bandage', 'food'],
];
/**
 * Airliner layout in the wreck's local frame (metres; +X toward the front of the aircraft,
 * +Z its right side). Three blocks: the walkable cabin with the tail still attached (torn
 * open at its front, X = TEAR), the nose thrown ahead of it, and the right wing lying
 * on its own to the right.
 */
const TEAR = 5.8;
const REAR = -5.6;
const TAIL_LEN = 11;
const TIP = REAR - TAIL_LEN;
const AXIS_Y = 2.0;
const RADIUS = 2.0;
const FLOOR = 0.75;
const FLOOR_HALF = 1.5;
const NOSE_LEN = 7.8;
const NOSE_STRAIGHT = 3.2;
/** Depth over which a torn edge is remapped into its ragged outline. */
const JAG_D = 2.2;
const WINDOW_ANGLE = 0.12;
const TAU = Math.PI * 2;

const PH = (() => {
  const r = mulberry32(77);
  return Array.from({ length: 10 }, () => r() * TAU);
})();
/** How far (m) the hull is missing behind the cabin's front mouth at angle θ around the axis. */
function mouthJag(t: number): number {
  let j = 0.5 + 0.28 * Math.sin(3 * t + PH[0]) + 0.17 * Math.sin(7 * t + PH[1]) + 0.1 * Math.sin(13 * t + PH[2]) + 0.25 * Math.pow(Math.abs(Math.sin(11 * t + PH[3])), 6) + 0.5 * Math.max(0, Math.sin(t));
  if (Math.sin(t) < -0.35) j *= 0.55;
  return THREE.MathUtils.clamp(j, 0.08, 1.75);
}
/** Same for the nose's torn rear (kept short on the left side, where the door is). */
function noseJag(t: number): number {
  const j = 0.45 + 0.25 * Math.sin(2 * t + PH[4]) + 0.16 * Math.sin(5 * t + PH[5]) + 0.1 * Math.sin(11 * t + PH[6]) + 0.22 * Math.pow(Math.abs(Math.sin(9 * t + PH[7])), 6);
  return THREE.MathUtils.clamp(j * (1 - 0.5 * Math.max(0, -Math.cos(t))), 0.06, 1.4);
}
/** Fuselage radius and axis height along the main block (the tail cone sweeps up). */
function hullProfile(x: number): { r: number; cy: number } {
  if (x >= REAR) return { r: RADIUS, cy: AXIS_Y };
  const t = Math.min(1, (REAR - x) / TAIL_LEN);
  return { r: RADIUS * (1 - 0.82 * Math.pow(t, 1.25)), cy: AXIS_Y + 0.85 * Math.pow(t, 1.5) };
}
/** Nose block: straight, then an ogive drooping slightly to the tip. */
function noseProfile(x: number): { r: number; cy: number } {
  const t = THREE.MathUtils.clamp((x - NOSE_STRAIGHT) / (NOSE_LEN - NOSE_STRAIGHT), 0, 1);
  return { r: RADIUS * Math.pow(Math.max(0, 1 - t * t), 0.55), cy: AXIS_Y - 0.4 * t * t };
}
const range = (a: number, b: number, step: number): number[] => {
  const n = Math.max(1, Math.round((b - a) / step));
  return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
};
/** Wing planform shared by both sides (the right one is broken into a stub and a loose piece). */
const wingPlan = (side: number): Planform => ({
  rootLE: 2.2,
  rootChord: 6.4,
  tipChord: 1.5,
  span: 14,
  sweep: 0.54,
  dihedral: 0.1,
  thickRoot: 0.13,
  thickTip: 0.09,
  y0: 1.15,
  z0: side * 1.2,
  side,
});
const STUB_F = 0.19;
const ENGINE_F = 5 / 14;

const CASE_COLORS = [0x2f4f7f, 0x7a2e2e, 0x2d2d2d, 0x6b5b3e, 0x3e6b4f, 0x8a6a2a, 0x5a3f6b, 0x404a52];

/** The broken airliner in its forest clearing: wake-up point, smoke, fire and luggage. */
export class CrashSite {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly spawn = new THREE.Vector3();
  spawnYaw = 0;
  readonly firePos = new THREE.Vector3();
  readonly suitcases: Suitcase[] = [];
  readonly smoke: PuffEmitter[] = [];
  readonly fire: PuffEmitter[] = [];
  readonly fireLight: THREE.PointLight;
  private yaw: number;
  private flicker = 0;
  /** Red emergency light pulsing inside the cabin (added to the scene by the game). */
  emergencyLight!: THREE.PointLight;
  /** Called with a world point when a severed cable throws sparks. */
  onSpark: ((p: THREE.Vector3) => void) | null = null;
  /** Spots at the edge of the clearing for breakable effigies. */
  readonly effigySpots: { x: number; z: number; yaw: number }[] = [];
  private seatSpots: { x: number; z: number }[] = [];
  private sparkLocal = new THREE.Vector3();
  private sparkT = 2;
  private screenMat: THREE.MeshStandardMaterial | null = null;
  private fan = new THREE.Group();

  constructor(private terrain: Terrain, colliders: ColliderGrid) {
    // A clearing in the pine forest of the centre-south (like The Forest): the flattest
    // inland spot well away from the beach, the lake and the coast.
    let best = { x: 0, z: 90, score: Infinity };
    for (let x = -90; x <= 90; x += 6) {
      for (let z = 40; z <= 150; z += 6) {
        if (terrain.coastDistance(x, z) < 55) continue;
        if (Math.hypot(x - LAKE_CENTER.x, z - LAKE_CENTER.z) < 80) continue;
        const h = terrain.height(x, z);
        if (h < 4.5) continue;
        let rough = 0;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          rough += Math.abs(terrain.height(x + Math.cos(a) * 16, z + Math.sin(a) * 16) - h);
        }
        const score = rough + Math.abs(z - 95) * 0.03 + Math.abs(x) * 0.02;
        if (score < best.score) best = { x, z, score };
      }
    }
    const cx = best.x;
    const cz = best.z;
    this.yaw = 0.22;
    const baseY = terrain.height(cx, cz);
    this.center.set(cx, baseY, cz);
    this.group.position.copy(this.center);
    this.group.rotation.y = this.yaw;

    const rand = mulberry32(31);
    const L = TEAR - REAR;
    const root = new THREE.Group();
    this.group.add(root);
    const put = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = root): T => {
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
      });
      parent.add(o);
      return o;
    };
    const groundOff = (lx: number, lz: number) => this.localToGround(lx, lz, 0).y - this.center.y;

    // ------------------------------------------------------------ materials (all procedural)
    const layout: FuselageLayout = { length: L, windows: [], windowAngle: WINDOW_ANGLE };
    const rowXs: number[] = [];
    for (let x = REAR + 1.2; x < TEAR - 1.1; x += 0.84) rowXs.push(x);
    for (const x of rowXs) layout.windows.push(x + 0.12 - REAR);
    const hullTex = hullTexture();
    const hullMat = new THREE.MeshStandardMaterial({ map: hullTex, vertexColors: true, roughness: 0.6, metalness: 0.15 });
    const petalMat = new THREE.MeshStandardMaterial({ map: hullTex, vertexColors: true, roughness: 0.62, metalness: 0.2, side: THREE.DoubleSide });
    const wallMat = new THREE.MeshStandardMaterial({ map: cabinWallTexture(layout), vertexColors: true, roughness: 0.85, alphaTest: 0.5, side: THREE.BackSide });
    const wingMat = new THREE.MeshStandardMaterial({ map: wingTexture(), vertexColors: true, roughness: 0.58, metalness: 0.18, side: THREE.DoubleSide });
    const finMat = new THREE.MeshStandardMaterial({ map: finTexture(), vertexColors: true, roughness: 0.58, metalness: 0.18, side: THREE.DoubleSide });
    const cowlMat = new THREE.MeshStandardMaterial({ map: hullTex, color: 0xeeeeea, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
    const burntCowl = new THREE.MeshStandardMaterial({ color: 0x4a4845, roughness: 0.85, metalness: 0.25, side: THREE.DoubleSide });
    const lipMat = new THREE.MeshStandardMaterial({ map: brushedTexture(), color: 0xd4d7da, roughness: 0.3, metalness: 0.65 });
    const fanMat = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.35, metalness: 0.7 });
    const voidIn = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.BackSide });
    const voidFront = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.4, metalness: 0.75 });
    const charred = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.95 });
    const sootMetal = new THREE.MeshStandardMaterial({ color: 0x3e3d3b, roughness: 0.65, metalness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223442, roughness: 0.12, metalness: 0.35 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.6, metalness: 0.3 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xd2d4d3, roughness: 0.6, metalness: 0.15 });

    /** A fuselage shell: rows of stations along X, a ragged torn edge at one end. */
    const SEG = 56;
    const tube = (xs: number[], prof: (x: number) => { r: number; cy: number }, off: number, edge: 1 | -1, jag: (t: number) => number, uv: (x: number, t: number) => [number, number], seed: number) =>
      gridGeometry(xs.length - 1, SEG, (i, j) => {
        const t = (j / SEG) * TAU;
        const x0 = xs[i];
        const { r, cy } = prof(x0);
        const end = edge > 0 ? xs[xs.length - 1] : xs[0];
        const d = Math.abs(end - x0);
        const J = jag(t);
        let x = x0;
        let de = 99;
        if (d < JAG_D) {
          x = x0 - edge * J * (1 - d / JAG_D);
          de = d * (1 - J / JAG_D);
        }
        const crumple = de < 3 ? 0.06 * Math.exp(-de * 2) * Math.sin(7 * t + x0 * 3 + seed) + 0.05 * Math.exp(-de * 5) : 0;
        const rr = (r + off) * (1 + crumple);
        const dirt = 0.9 + 0.07 * Math.sin(x0 * 0.9 + 3 * t + seed) * Math.sin(x0 * 0.37 - 2 * t) + 0.04 * Math.sin(t);
        const reach = 0.6 + 0.8 * Math.pow(Math.sin(4 * t + seed), 2);
        const soot = THREE.MathUtils.clamp(1 - de / reach, 0, 1);
        const [u, v] = uv(x0, t);
        return { p: new THREE.Vector3(x, cy + rr * Math.sin(t), rr * Math.cos(t)), u, v, c: THREE.MathUtils.lerp(dirt, 0.07, Math.pow(soot, 1.3)) };
      });
    /** Exposed frames inside a torn edge, only where the skin still reaches them. */
    const ribs = (xs: number[], present: (t: number, x: number) => boolean, radius: number, parent: THREE.Object3D) => {
      for (const xr of xs) {
        let run: THREE.Vector3[] = [];
        const flush = () => {
          if (run.length > 2) put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(run), run.length * 2, 0.045, 5, false), sootMetal), parent);
          run = [];
        };
        for (let j = 0; j <= 60; j++) {
          const t = (j / 60) * TAU;
          if (present(t, xr) && Math.sin(t) > -0.55) run.push(new THREE.Vector3(xr, AXIS_Y + radius * Math.sin(t), radius * Math.cos(t)));
          else flush();
        }
        flush();
      }
    };
    /** Skin sheets bent outward along a torn edge (`edgeAt` gives the edge X at angle θ). */
    const petals = (angles: number[], edgeAt: (t: number) => number, dir: 1 | -1, parent: THREE.Object3D) => {
      for (const tc of angles) {
        const len = 0.45 + rand() * 0.5;
        const wid = 0.3 + rand() * 0.3;
        const curl = 0.25 + rand() * 0.45;
        const twist = (rand() - 0.5) * 0.5;
        const geo = gridGeometry(6, 4, (i, j) => {
          const v = i / 6;
          const t = tc + (j / 4 - 0.5) * wid * (1 - 0.6 * v) + twist * v * v;
          const s = -0.25 + v * len;
          const out = Math.max(0, s);
          const r = RADIUS + 0.012 + out * out * curl;
          const x = edgeAt(t) + dir * (s - out * out * curl * 0.35);
          return { p: new THREE.Vector3(x, AXIS_Y + r * Math.sin(t), r * Math.cos(t)), u: t / TAU, v: x / 4, c: 0.62 - 0.5 * v };
        });
        put(new THREE.Mesh(geo, petalMat), parent);
      }
    };
    const stringers = (count: number, edgeAt: (t: number) => number, dir: 1 | -1, parent: THREE.Object3D) => {
      for (let k = 0; k < count; k++) {
        const t = (k / count) * TAU + rand() * 0.15;
        if (Math.sin(t) < -0.5) continue;
        const len = 0.4 + rand() * 0.8;
        const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.07), sootMetal);
        s.position.set(edgeAt(t) + dir * (len / 2 - 0.15), AXIS_Y + (RADIUS - 0.04) * Math.sin(t), (RADIUS - 0.04) * Math.cos(t));
        s.rotation.set(Math.PI / 2 - t, 0, (rand() - 0.5) * 0.3);
        put(s, parent);
      }
    };

    // ============================================================ BLOCK 2: cabin + attached tail
    // Outer skin from the tail tip to the torn mouth; the cabin wall inside it.
    const hullXs = [...range(TIP, TEAR - 2.4, 0.5), ...range(TEAR - 2.4, TEAR, 0.15).slice(1)];
    put(new THREE.Mesh(tube(hullXs, hullProfile, 0, 1, mouthJag, (x, t) => [t / TAU, (x - TIP) / 4], 1.3), hullMat));
    const wallXs = [...range(REAR, TEAR - 2.4, 0.5), ...range(TEAR - 2.4, TEAR, 0.15).slice(1)];
    put(new THREE.Mesh(tube(wallXs, hullProfile, -0.07, 1, mouthJag, (x, t) => [t / TAU, (x - REAR) / L], 1.3), wallMat));
    // Tail tip (APU exhaust).
    {
      const tp = hullProfile(TIP);
      const apu = new THREE.Mesh(new THREE.CylinderGeometry(tp.r * 0.85, tp.r * 0.6, 0.5, 16), charred);
      apu.rotation.z = Math.PI / 2;
      apu.position.set(TIP - 0.2, tp.cy, 0);
      put(apu);
    }
    // Cabin windows: dark glass in rubber rims, all in one row level with the seats.
    const paneGeo = roundedRect(0.24, 0.34, 0.09);
    const rimGeo = roundedRect(0.33, 0.43, 0.13);
    const basis = new THREE.Matrix4();
    for (const m of layout.windows) {
      const x = REAR + m;
      for (const t of [WINDOW_ANGLE, Math.PI - WINDOW_ANGLE]) {
        if (x > TEAR - mouthJag(t) - 0.45) continue;
        const n = new THREE.Vector3(0, Math.sin(t), Math.cos(t));
        basis.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, Math.cos(t), -Math.sin(t)), n);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.quaternion.setFromRotationMatrix(basis);
        rim.position.set(x, AXIS_Y, 0).addScaledVector(n, RADIUS + 0.008);
        const pane = new THREE.Mesh(paneGeo, glass);
        pane.quaternion.copy(rim.quaternion);
        pane.position.set(x, AXIS_Y, 0).addScaledVector(n, RADIUS + 0.014);
        put(rim);
        put(pane);
      }
    }
    // Rear bulkhead closing the cabin off from the tail cone, with the galley door.
    const cover = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.9 });
    {
      const bulk = new THREE.Mesh(new THREE.CircleGeometry(RADIUS - 0.08, 40), cover);
      bulk.geometry.rotateY(Math.PI / 2);
      bulk.position.set(REAR, AXIS_Y, 0);
      put(bulk);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.85, 0.85), new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.8 }));
      door.position.set(REAR + 0.03, FLOOR + 0.93, 0);
      put(door);
    }
    // Cabin floor (carpet) with emergency strips down the aisle.
    const carpet = carpetTexture();
    carpet.repeat.set(L / 1.5, 2);
    const carpetMat = new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, FLOOR_HALF * 2), carpetMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((TEAR + REAR) / 2, FLOOR, 0);
    put(floor);
    const strip = new THREE.MeshStandardMaterial({ color: 0x9cffb4, emissive: 0x3cff78, emissiveIntensity: 1.4 });
    for (let x = REAR + 0.4; x < TEAR - 0.6; x += 0.35) {
      if (rand() < 0.18) continue;
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.015, 0.03), strip);
        e.position.set(x, FLOOR + 0.008, s * 0.48);
        root.add(e);
      }
    }
    // Seats: double seats either side of the aisle, a few knocked crooked.
    const fabric = new THREE.MeshStandardMaterial({ map: seatFabricTexture(), roughness: 0.9 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.5, metalness: 0.5 });
    const seatRow = (x: number, side: number, tilt: number) => {
      const row = new THREE.Group();
      row.position.set(x, FLOOR, side * 1.06);
      row.rotation.set(tilt * 0.4, 0, tilt);
      for (const k of [-0.24, 0.24]) {
        const base = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.13, 0.46, 2, 0.04), fabric);
        base.position.set(0, 0.44, k);
        const back = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.72, 0.46, 2, 0.04), fabric);
        back.position.set(-0.24, 0.84, k);
        back.rotation.z = -0.16;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.38), cover);
        head.position.set(-0.3, 1.13, k);
        head.rotation.z = -0.16;
        row.add(base, back, head);
      }
      for (const k of [-0.5, 0, 0.5]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.05), frame);
        arm.position.set(0.02, 0.62, k * 0.96);
        row.add(arm);
      }
      for (const k of [-0.35, 0.35]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.05), frame);
        leg.position.set(0, 0.19, k);
        row.add(leg);
      }
      put(row);
    };
    rowXs.forEach((x, ri) => {
      for (const s of [-1, 1]) {
        // Rows nearest the tear are the ones thrown crooked.
        const k = rowXs.length - 1 - ri;
        const broken = (k === 2 && s > 0) || (k === 5 && s < 0) || k === 1;
        seatRow(x, s, broken ? s * (0.12 + rand() * 0.18) : 0);
        this.seatSpots.push({ x, z: s * 1.12 });
      }
    });
    // Overhead bins, some hanging open.
    for (const s of [-1, 1]) {
      for (let x = REAR + 0.8; x < TEAR - 1.0; x += 1.25) {
        const bin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.36, 0.5), cover);
        bin.position.set(x, AXIS_Y + 0.75, s * 1.28);
        bin.rotation.x = s * 0.35;
        put(bin);
        const open = rand() < 0.45;
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.34, 0.03), cover);
        door.position.set(x, AXIS_Y + 0.75 + (open ? 0.22 : 0), s * (1.02 + (open ? 0.05 : 0)));
        door.rotation.x = s * (open ? -0.9 : 0.35);
        put(door);
      }
    }
    // Ceiling light strip (dead) and dangling cables near the tear.
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(L - 1.6, 0.04, 0.5), cover);
    ceil.position.set((TEAR + REAR) / 2 - 0.6, AXIS_Y + 1.92, 0);
    put(ceil);
    const cable = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    for (let k = 0; k < 6; k++) {
      const x = TEAR - 0.9 - rand() * 2.2;
      const z = (rand() - 0.5) * 1.6;
      const pts = [new THREE.Vector3(x, AXIS_Y + 1.85, z), new THREE.Vector3(x + (rand() - 0.5) * 0.3, AXIS_Y + 1.2, z + (rand() - 0.5) * 0.3), new THREE.Vector3(x + (rand() - 0.5) * 0.5, AXIS_Y + 0.6 + rand() * 0.5, z + (rand() - 0.5) * 0.4)];
      put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.018, 4, false), cable));
    }
    this.sparkLocal.set(TEAR - 1.6, AXIS_Y + 1.8, 0.5);
    // The mouth: exposed frames and stringers, skin peeled outward, the floor's broken edge.
    ribs([TEAR - 0.3, TEAR - 0.8, TEAR - 1.35], (t, x) => TEAR - mouthJag(t) > x - 0.25, RADIUS - 0.06, root);
    stringers(18, (t) => TEAR - mouthJag(t), 1, root);
    petals([0.35, 0.9, 1.45, 1.95, 2.55, 3.1, -0.15, 3.5], (t) => TEAR - mouthJag(t), 1, root);
    {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, FLOOR_HALF * 2 + 0.1), sootMetal);
      beam.position.set(TEAR, FLOOR - 0.06, 0);
      put(beam);
      const hold = new THREE.Mesh(new THREE.BoxGeometry(0.06, FLOOR - 0.05, 3.3), charred);
      hold.position.set(TEAR - 0.35, FLOOR / 2, 0);
      put(hold);
      // Fallen floor panel: the ramp out of the cabin.
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.9), sootMetal);
      ramp.position.set(TEAR + 0.9, FLOOR / 2 - 0.02, 0);
      ramp.rotation.z = -Math.atan2(FLOOR, 1.9);
      put(ramp);
    }

    // Wings: the left one whole, the right one broken off near the root.
    const engine = (burnt: boolean) => {
      const g = new THREE.Group();
      const cowl = new THREE.LatheGeometry(
        [
          [0.84, -1.9],
          [0.98, -1.2],
          [1.14, -0.2],
          [1.23, 0.8],
          [1.25, 1.4],
          [1.2, 1.85],
          [1.12, 2.0],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        40,
      );
      cowl.rotateZ(-Math.PI / 2);
      put(new THREE.Mesh(cowl, burnt ? burntCowl : cowlMat), g);
      const duct = new THREE.CylinderGeometry(1.02, 1.02, 1.6, 32, 1, true);
      duct.rotateZ(Math.PI / 2);
      duct.translate(1.25, 0, 0);
      put(new THREE.Mesh(duct, voidIn), g);
      const back = new THREE.Mesh(new THREE.CircleGeometry(1.02, 32), voidFront);
      back.geometry.rotateY(Math.PI / 2);
      back.position.x = 0.5;
      put(back, g);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.14, 12, 40), burnt ? sootMetal : lipMat);
      lip.geometry.rotateY(Math.PI / 2);
      lip.position.x = 2.0;
      put(lip, g);
      const fan = new THREE.Group();
      fan.position.x = 1.3;
      for (let k = 0; k < 22; k++) {
        const a = (k / 22) * TAU;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.72, 0.3), burnt ? sootMetal : fanMat);
        blade.position.set(0, Math.cos(a) * 0.64, Math.sin(a) * 0.64);
        blade.rotation.set(a, 0.55, 0);
        fan.add(blade);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.26, 18), fanMat);
      hub.rotation.z = Math.PI / 2;
      fan.add(hub);
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 20), burnt ? sootMetal : metal);
      spinner.rotation.z = -Math.PI / 2;
      spinner.position.x = 0.48;
      fan.add(spinner);
      put(fan, g);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.74, 0.8, 28, 1, true), sootMetal);
      nozzle.material = new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.x = -2.25;
      put(nozzle, g);
      const plug = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 20), sootMetal);
      plug.rotation.z = Math.PI / 2;
      plug.position.x = -2.75;
      put(plug, g);
      const pylonShape = new THREE.Shape();
      pylonShape.moveTo(0.9, 1.0);
      pylonShape.lineTo(-2.9, 0.7);
      pylonShape.lineTo(-2.9, 1.9);
      pylonShape.lineTo(-0.5, 1.95);
      pylonShape.lineTo(0.9, 1.3);
      pylonShape.lineTo(0.9, 1.0);
      const pylon = new THREE.ExtrudeGeometry(pylonShape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
      pylon.translate(0, 0, -0.17);
      put(new THREE.Mesh(pylon, burnt ? burntCowl : cowlMat), g);
      return { g, fan };
    };
    const enginePos = (pf: Planform) => surfacePoint(pf, ENGINE_F, 0).add(new THREE.Vector3(0, -0.83, 0));
    const fairings = (pf: Planform, parent: THREE.Object3D, from: number) => {
      for (const f of [0.22, 0.46, 0.6, 0.76]) {
        if (f < from) continue;
        const chord = chordAt(pf, f);
        const le = surfacePoint(pf, f, 0);
        const front = le.x - chord * 0.5;
        const backX = le.x - chord - 0.9;
        const len = front - backX;
        const pts: THREE.Vector2[] = [];
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          pts.push(new THREE.Vector2(0.24 * Math.pow(Math.sin(Math.PI * t), 0.6) * (1 - 0.25 * t) + 0.001, t * len));
        }
        const geo = new THREE.LatheGeometry(pts, 12);
        geo.rotateZ(-Math.PI / 2);
        const m = new THREE.Mesh(geo, cowlMat);
        m.position.set(backX, le.y - 0.26, le.z);
        put(m, parent);
      }
    };
    const winglet = (pf: Planform, parent: THREE.Object3D) => {
      const tip = surfacePoint(pf, 1, 0);
      const wl: Planform = { rootLE: tip.x - 0.05, rootChord: pf.tipChord * 0.95, tipChord: 0.55, span: 1.7, sweep: 0.75, dihedral: 0, thickRoot: 0.1, thickTip: 0.08, y0: 0, z0: 0, side: 0 };
      const m = new THREE.Mesh(liftingSurface(wl, 0, 1, { seed: 9 }), wingMat);
      m.position.set(0, tip.y, tip.z);
      m.rotation.x = pf.side * 0.22;
      put(m, parent);
    };
    const left = wingPlan(-1);
    put(new THREE.Mesh(liftingSurface(left, 0, 1, { seed: 5 }), wingMat));
    winglet(left, root);
    fairings(left, root, 0);
    const leftEng = engine(false);
    leftEng.g.position.copy(enginePos(left));
    put(leftEng.g);
    this.fan = leftEng.fan;
    this.fan.userData.keep = true;
    const right = wingPlan(1);
    put(new THREE.Mesh(liftingSurface(right, 0, STUB_F, { tornTip: true, seed: 6 }), wingMat));
    {
      // Spar ends sticking out of the stub.
      for (const c of [0.18, 0.62]) {
        const p = surfacePoint(right, STUB_F, c);
        const spar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.9), sootMetal);
        spar.position.set(p.x, p.y, p.z + 0.25);
        spar.rotation.set(0.2 * (rand() - 0.5), 0.3 * (rand() - 0.5), 0.15);
        put(spar);
      }
    }

    // Tail: fin with black bands, stabilisers with black tips.
    const finPlan: Planform = { rootLE: -9.6, rootChord: 5.6, tipChord: 1.9, span: 5.6, sweep: 0.72, dihedral: 0, thickRoot: 0.12, thickTip: 0.1, y0: 3.25, z0: 0, side: 0 };
    put(new THREE.Mesh(liftingSurface(finPlan, 0, 1, { seed: 7 }), finMat));
    for (const s of [-1, 1]) {
      const stab: Planform = { rootLE: -12.2, rootChord: 3.4, tipChord: 1.2, span: 5.2, sweep: 0.62, dihedral: 0.12, thickRoot: 0.1, thickTip: 0.09, y0: 2.5, z0: s * 0.5, side: s };
      put(new THREE.Mesh(liftingSurface(stab, 0, 1, { seed: 8 }), wingMat));
    }

    // ============================================================ BLOCK 1: the nose, thrown ahead
    const noseLayout: NoseLayout = {
      length: NOSE_LEN,
      windows: [
        [
          [0.06, 4.05],
          [0.44, 4.0],
          [0.5, 4.55],
          [0.06, 4.62],
        ],
        [
          [0.55, 3.9],
          [0.88, 3.75],
          [0.95, 4.35],
          [0.6, 4.5],
        ],
        [
          [0.99, 3.65],
          [1.2, 3.55],
          [1.25, 4.05],
          [1.03, 4.25],
        ],
      ],
      door: { t0: 2.86, t1: 3.78, x0: 1.75, x1: 2.7 },
    };
    const noseMat = new THREE.MeshStandardMaterial({ map: noseTexture(noseLayout), vertexColors: true, roughness: 0.6, metalness: 0.15, alphaTest: 0.5 });
    const noseG = new THREE.Group();
    noseG.position.set(TEAR + 6.2, groundOff(TEAR + 9, -3.2) - 0.12, -2.6);
    noseG.rotation.set(0.07, 0.36, 0.02, 'YXZ');
    put(noseG);
    const noseXs = [...range(0, 2.4, 0.15), ...range(2.4, NOSE_LEN, 0.2).slice(1)];
    const noseUv = (x: number, t: number): [number, number] => [t / TAU, x / NOSE_LEN];
    put(new THREE.Mesh(tube(noseXs, noseProfile, 0, -1, noseJag, noseUv, 4.1), noseMat), noseG);
    put(new THREE.Mesh(tube(noseXs, noseProfile, -0.12, -1, noseJag, noseUv, 4.1), new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.9, side: THREE.BackSide })), noseG);
    // Recessed cockpit glazing behind the cut-outs.
    for (const side of [1, -1]) {
      for (const w of noseLayout.windows) {
        const ts = w.map(([phi]) => Math.PI / 2 - side * phi);
        const xs = w.map(([, x]) => x);
        const t0 = Math.min(...ts) - 0.05;
        const t1 = Math.max(...ts) + 0.05;
        const x0 = Math.min(...xs) - 0.08;
        const x1 = Math.max(...xs) + 0.08;
        const geo = gridGeometry(4, 4, (i, j) => {
          const x = x0 + ((x1 - x0) * i) / 4;
          const t = t0 + ((t1 - t0) * j) / 4;
          const { r, cy } = noseProfile(x);
          return { p: new THREE.Vector3(x, cy + (r - 0.06) * Math.sin(t), (r - 0.06) * Math.cos(t)), u: 0, v: 0, c: 1 };
        });
        put(new THREE.Mesh(geo, glass), noseG);
      }
    }
    // Front door in relief.
    {
      const d = noseLayout.door;
      const geo = gridGeometry(3, 6, (i, j) => {
        const x = d.x0 + 0.05 + ((d.x1 - d.x0 - 0.1) * i) / 3;
        const t = d.t0 + 0.03 + ((d.t1 - d.t0 - 0.06) * j) / 6;
        const r = RADIUS + 0.03;
        return { p: new THREE.Vector3(x, AXIS_Y + r * Math.sin(t), r * Math.cos(t)), u: t / TAU, v: x / NOSE_LEN, c: 0.9 };
      });
      put(new THREE.Mesh(geo, noseMat), noseG);
    }
    // Torn rear: frames, stringers and bent sheets.
    ribs([0.35, 0.8], (t, x) => noseJag(t) < x + 0.25, RADIUS - 0.06, noseG);
    stringers(14, (t) => noseJag(t), -1, noseG);
    petals([0.6, 1.6, 2.4, -0.1], (t) => noseJag(t), -1, noseG);
    // The cockpit inside: floor, instrument panel with dim screens, yokes, pilot seats.
    {
      const nf = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.5), carpetMat);
      nf.rotation.x = -Math.PI / 2;
      nf.position.set(2.4, FLOOR, 0);
      put(nf, noseG);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 2.2), charred);
      panel.position.set(4.0, FLOOR + 0.85, 0);
      panel.rotation.z = 0.5;
      put(panel, noseG);
      this.screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1e14, emissive: 0x2ad48a, emissiveIntensity: 0.6 });
      for (const z of [-0.7, -0.25, 0.25, 0.7]) {
        const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), this.screenMat);
        sc.position.set(3.76, FLOOR + 0.98, z);
        sc.rotation.set(0, -Math.PI / 2, 0.5, 'YXZ');
        sc.userData.keep = true;
        noseG.add(sc);
      }
      for (const z of [-0.55, 0.55]) {
        const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 5, 10, Math.PI), frame);
        yoke.position.set(3.55, FLOOR + 0.85, z);
        yoke.rotation.y = Math.PI / 2;
        put(yoke, noseG);
        const pilot = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.9, 0.5, 2, 0.06), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }));
        pilot.position.set(2.9, FLOOR + 0.55, z);
        put(pilot, noseG);
      }
    }

    // ============================================================ BLOCK 3: the right wing, torn off
    const detG = new THREE.Group();
    const detI = new THREE.Group();
    const pivot = surfacePoint(right, STUB_F, 0.4);
    detI.position.copy(pivot).multiplyScalar(-1);
    detG.add(detI);
    detG.position.set(pivot.x - 0.8, 0, pivot.z + 7.4);
    detG.rotation.set(0.05, -0.3, 0.13, 'YXZ');
    put(new THREE.Mesh(liftingSurface(right, STUB_F, 1, { tornRoot: true, seed: 6 }), wingMat), detI);
    winglet(right, detI);
    fairings(right, detI, STUB_F);
    const rightEng = engine(true);
    const rePos = enginePos(right);
    rightEng.g.position.copy(rePos);
    put(rightEng.g, detI);
    // Rest it on the ground: drop the piece until its lowest point touches the earth.
    const detLocal = (p: THREE.Vector3) => {
      detG.updateMatrix();
      detI.updateMatrix();
      return p.clone().applyMatrix4(detI.matrix).applyMatrix4(detG.matrix);
    };
    {
      const probes = [rePos.clone().add(new THREE.Vector3(0.6, -1.25, 0)), rePos.clone().add(new THREE.Vector3(-1.6, -0.95, 0))];
      for (const f of [STUB_F, 0.6, 1]) for (const c of [0, 1]) probes.push(surfacePoint(right, f, c));
      const low = Math.min(...probes.map((p) => detLocal(p).y));
      const gp = detLocal(rePos);
      detG.position.y += groundOff(gp.x, gp.z) - 0.15 - low;
    }
    put(detG);
    const rootFire = detLocal(surfacePoint(right, STUB_F + 0.01, 0.45));
    const engineFire = detLocal(rePos.clone().add(new THREE.Vector3(-2.8, 0, 0)));
    const detTip = detLocal(surfacePoint(right, 1, 0.5));

    // ------------------------------------------------------------ the swath through the trees
    const logMats = logMaterials();
    for (let k = 0; k < 9; k++) {
      const lx = -21 - k * 2.4 - rand() * 2;
      const lz = -4 + (rand() - 0.5) * 9;
      const len = 4 + rand() * 4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22 + rand() * 0.1, 0.3 + rand() * 0.1, len, 9), logMats);
      const p = this.localToGround(lx, lz, 0.25).sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      log.position.copy(p);
      log.rotation.set(Math.PI / 2, 0, rand() * Math.PI, 'YXZ');
      log.rotation.y = rand() * Math.PI;
      put(log);
      const yawL = log.rotation.y;
      for (const t of [-0.35, 0, 0.35]) this.addCollider(colliders, lx + Math.sin(yawL) * len * t, lz + Math.cos(yawL) * len * t, 0.35, 0.6);
    }
    for (let k = 0; k < 7; k++) {
      const lx = -22 - k * 3 - rand() * 2;
      const lz = -10 + (k % 2 ? 1 : -1) * (4 + rand() * 4);
      const h = 0.7 + rand() * 1.1;
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, h, 9), logMats);
      const p = this.localToGround(lx, lz, h / 2 - 0.1).sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      stump.position.copy(p);
      put(stump);
      for (let q = 0; q < 4; q++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3 + rand() * 0.3, 4), logMats[1]);
        sp.position.copy(p).add(new THREE.Vector3(Math.cos(q * 1.6) * 0.18, h / 2 + 0.1, Math.sin(q * 1.6) * 0.18));
        put(sp);
      }
      this.addCollider(colliders, lx, lz, 0.38, h);
    }

    // Scorch marks round the fires and the mouth, debris on the dark earth.
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
    for (const [lx, lz, r] of [
      [rootFire.x, rootFire.z, 3.6],
      [engineFire.x, engineFire.z, 2.6],
      [TEAR + 2.5, 0.3, 2.4],
      [TEAR + 5.5, -2.2, 2.2],
    ]) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(r, 18), scorchMat);
      s.rotation.x = -Math.PI / 2;
      s.position.copy(this.localToGround(lx, lz, 0.06)).sub(this.center);
      s.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      s.userData.keep = true;
      this.group.add(s);
    }
    for (let i = 0; i < 34; i++) {
      const piece = new THREE.Mesh(new THREE.BoxGeometry(0.2 + rand() * 0.9, 0.04 + rand() * 0.1, 0.2 + rand() * 0.7), rand() > 0.4 ? whiteMat : charred);
      const lx = -18 + rand() * 36;
      const lz = -8 + rand() * 22;
      if (lx > TIP - 1 && lx < TEAR + 0.5 && Math.abs(lz) < 2.8) continue;
      if (lx > TEAR && lx < TEAR + 7 && Math.abs(lz) < 1.6) continue;
      const p = this.localToGround(lx, lz, 0.05).sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      piece.position.copy(p);
      piece.rotation.set(rand() * 0.5, rand() * 6, rand() * 0.5);
      put(piece);
    }
    // Merge every static piece (screens, fan and scorch decals stay apart).
    for (const m of bakeStatic(root)) m.castShadow = true;

    // ------------------------------------------------------------ colliders
    // Cabin walls (the torn mouth stays open), rear bulkhead, tail cone sides, seats.
    for (let x = REAR + 0.1; x <= TEAR - 0.5; x += 0.55) {
      this.addCollider(colliders, x, -RADIUS - 0.12, 0.34, 3.6);
      this.addCollider(colliders, x, RADIUS + 0.12, 0.34, 3.6);
    }
    for (let z = -1.6; z <= 1.6; z += 0.4) this.addCollider(colliders, REAR - 0.25, z, 0.42, 3.6);
    for (let x = REAR - 0.5; x >= TIP + 0.5; x -= 0.6) {
      const r = hullProfile(x).r;
      this.addCollider(colliders, x, -r - 0.1, 0.34, 3.6);
      this.addCollider(colliders, x, r + 0.1, 0.34, 3.6);
    }
    this.addCollider(colliders, TIP - 0.2, 0, 0.7, 3.6);
    for (const s of this.seatSpots) this.addCollider(colliders, s.x, s.z, 0.4, 2.0);
    // Wings (a few points across the chord at each span station) and engines.
    const wingCols = (pf: Planform, f0: number, f1: number, map: (p: THREE.Vector3) => THREE.Vector3) => {
      for (let f = f0; f <= f1 + 1e-6; f += 0.07) {
        const rr = Math.min(0.95, chordAt(pf, f) * 0.18);
        for (const c of [0.15, 0.45, 0.78]) {
          const p = map(surfacePoint(pf, f, c));
          if (Math.abs(p.z) < RADIUS + 0.6 + rr && p.x > TIP && p.x < TEAR) continue;
          this.addCollider(colliders, p.x, p.z, rr, 2.2);
        }
      }
    };
    wingCols(left, 0.12, 1, (p) => p);
    wingCols(right, 0.12, STUB_F, (p) => p);
    wingCols(right, STUB_F + 0.02, 1, detLocal);
    for (const [pos, map] of [
      [enginePos(left), (p: THREE.Vector3) => p],
      [rePos, detLocal],
    ] as [THREE.Vector3, (p: THREE.Vector3) => THREE.Vector3][]) {
      const a = map(pos.clone().add(new THREE.Vector3(0.9, 0, 0)));
      const b = map(pos.clone().add(new THREE.Vector3(-1.4, 0, 0)));
      this.addCollider(colliders, a.x, a.z, 1.3, 2.6);
      this.addCollider(colliders, b.x, b.z, 1.05, 2.6);
    }
    // The nose is solid all round; it lies well clear of the ramp out of the mouth.
    noseG.updateMatrix();
    for (let x = 0.7; x <= NOSE_LEN - 0.4; x += 0.7) {
      const p = new THREE.Vector3(x, 0, 0).applyMatrix4(noseG.matrix);
      this.addCollider(colliders, p.x, p.z, Math.min(1.95, noseProfile(x).r * 0.95), 3.6);
    }

    // Emergency light: a slow red pulse inside the cabin (part of the fixed light pool).
    this.emergencyLight = new THREE.PointLight(0xff2a1a, 0, 9, 1.6);
    this.emergencyLight.position.copy(this.toWorld(0, AXIS_Y + 1.6, 0));

    // Fire and black smoke at the wing's torn root and behind its engine; a wisp from the mouth.
    this.firePos.copy(this.toWorld(rootFire.x, rootFire.y + 0.2, rootFire.z));
    const engFireW = this.toWorld(engineFire.x, engineFire.y, engineFire.z);
    const mouthW = this.toWorld(TEAR - 0.6, AXIS_Y + 1.7, 0);
    const smokeCfg = { life: 7.5, rise: 2.4, spread: 1.4, size0: 1.8, size1: 8, alpha: 0.55, color: 0x1e1d1c, color2: 0x0e0d0c, additive: false };
    const fireCfg = { life: 0.9, rise: 1.8, spread: 0.9, size0: 1.4, size1: 0.3, alpha: 0.9, color: 0xff5a12, color2: 0xffd27a, additive: true };
    const s1 = new PuffEmitter(80, smokeCfg);
    s1.origin.copy(this.firePos).y += 0.9;
    const s2 = new PuffEmitter(50, { ...smokeCfg, alpha: 0.45, size1: 6 });
    s2.origin.copy(engFireW).y += 0.8;
    const s3 = new PuffEmitter(26, { ...smokeCfg, alpha: 0.18, size1: 4.5, life: 6 });
    s3.origin.copy(mouthW);
    const f1 = new PuffEmitter(50, fireCfg);
    f1.origin.copy(this.firePos);
    const f2 = new PuffEmitter(28, { ...fireCfg, size0: 0.9, spread: 0.7 });
    f2.origin.copy(engFireW);
    this.smoke.push(s1, s2, s3);
    this.fire.push(f1, f2);
    this.fireLight = new THREE.PointLight(0xff8a3a, 30, 22, 1.6);
    this.fireLight.position.copy(this.firePos).y += 1.2;

    // One continuous patch of burned earth under the three blocks.
    noseG.updateMatrix();
    const noseTip = new THREE.Vector3(NOSE_LEN, 0, 0).applyMatrix4(noseG.matrix);
    const noseRear = new THREE.Vector3(0.4, 0, 0).applyMatrix4(noseG.matrix);
    this.dirtSegs = [
      [TIP - 3, 0, TEAR + 1, 0, 4.6],
      [TEAR, 0, noseRear.x, noseRear.z, 3.4],
      [noseRear.x, noseRear.z, noseTip.x, noseTip.z, 3.6],
      [-1, -2.5, -6, -15, 3.4],
      [-1, 3, rootFire.x, rootFire.z, 3.4],
      [rootFire.x, rootFire.z, detTip.x, detTip.z, 3.4],
      [-6, -4, -10, 6, 4],
    ];
    this.dirt = this.buildDirtPatch(this.dirtSegs);
    this.buildDirtEdge(this.dirtSegs);

    // Luggage thrown round the wreck on the dark patch.
    const casePositions = [
      [8.6, 2.9],
      [6.8, -5.8],
      [14.8, 4.2],
      [2.4, 6.6],
      [-3.2, 5.4],
      [-9.5, -4.2],
      [-13.5, 3.6],
      [11.5, -8.0],
    ];
    casePositions.forEach(([lx, lz], i) => {
      const color = CASE_COLORS[i];
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 0.5), std(color, 0.7));
      body.castShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.04, 0.52), std(0x1a1a1a, 0.6));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 4, 8, Math.PI), std(0x111111, 0.6));
      handle.position.set(0, 0, 0.27);
      handle.rotation.x = Math.PI / 2;
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.09), std(0xf4e04d, 0.5));
      tag.position.set(0.2, 0.135, 0.1);
      g.add(body, trim, handle, tag);
      const pos = this.localToGround(lx, lz, 0.13);
      g.position.copy(pos);
      g.rotation.set((rand() - 0.5) * 0.15, rand() * 6, (rand() - 0.5) * 0.15);
      this.suitcases.push({ mesh: g, pos, hp: 50, color, contents: CONTENTS[i], broken: false });
    });

    // Wake up in the aisle near the rear, looking forward through the torn mouth.
    this.spawn.copy(this.toWorld(-3.0, FLOOR, 0));
    this.spawnYaw = Math.atan2(-Math.cos(this.yaw), Math.sin(this.yaw));
    // Effigies at the edge of the clearing, facing the wreck.
    for (const [lx, lz] of [
      [-13, 15],
      [13, -15],
    ]) {
      const p = this.toWorld(lx, 0, lz);
      this.effigySpots.push({ x: p.x, z: p.z, yaw: Math.atan2(this.center.x - p.x, this.center.z - p.z) });
    }
  }

  dirt!: THREE.Mesh;
  /** Burned/ploughed earth as segments [x0, z0, x1, z1, width] in the wreck's frame. */
  private dirtSegs: number[][] = [];

  /** Distance (m) from a local point to the nearest dirt segment, minus that segment's half-width. */
  private dirtDistance(lx: number, lz: number): number {
    let best = Infinity;
    for (const [x0, z0, x1, z1, w] of this.dirtSegs) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const l2 = dx * dx + dz * dz || 1;
      const t = THREE.MathUtils.clamp(((lx - x0) * dx + (lz - z0) * dz) / l2, 0, 1);
      best = Math.min(best, Math.hypot(lx - (x0 + dx * t), lz - (z0 + dz * t)) - w * 0.5);
    }
    return best;
  }

  /**
   * No grass under the wreck blocks and the core of the ploughed earth; the edge is
   * ragged (noise plus a sparse fringe) so tall grass meets the dirt naturally.
   */
  grassBlocked(x: number, z: number): boolean {
    const l = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    for (const sc of this.suitcases) if (Math.hypot(x - sc.pos.x, z - sc.pos.z) < 0.9) return true;
    const d = this.dirtDistance(l.x, l.z);
    if (d > 2) return false;
    const n = Math.sin(l.x * 1.7 + l.z * 0.6) * Math.sin(l.z * 2.3 - l.x * 0.4) * 0.6 + Math.sin(l.x * 5.1 + 1.3) * Math.sin(l.z * 4.7) * 0.3;
    const edge = 0.35 + n * 0.55;
    if (d < edge) return true;
    // A sparse fringe just outside the edge.
    const h = Math.abs(Math.sin(l.x * 127.1 + l.z * 311.7) * 43758.5) % 1;
    return d < edge + 0.9 && h < 0.45;
  }

  /**
   * A scatter of pebbles, wood chips and small metal fragments where the churned earth
   * meets the grass.
   */
  private buildDirtEdge(segs: number[][]): void {
    const r = mulberry32(57);
    const toLocal = (lx: number, lz: number, lift: number) =>
      this.localToGround(lx, lz, lift).sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const stones: THREE.BufferGeometry[] = [];
    const chips: THREE.BufferGeometry[] = [];
    const metal: THREE.BufferGeometry[] = [];
    const place = (g: THREE.BufferGeometry, p: THREE.Vector3, yaw: number, tilt = 0) => {
      g.rotateX(tilt);
      g.rotateY(yaw);
      g.translate(p.x, p.y, p.z);
      return g;
    };
    // Scatter along every segment's edge.
    for (const [x0, z0, x1, z1, w] of segs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / (len || 1);
      const uz = (z1 - z0) / (len || 1);
      for (let k = 0; k < len * 2.2; k++) {
        const t = r();
        const side = r() < 0.5 ? -1 : 1;
        const off = w * 0.5 + (r() - 0.3) * 1.2;
        const lx = x0 + (x1 - x0) * t - uz * side * off;
        const lz = z0 + (z1 - z0) * t + ux * side * off;
        const kind = r();
        if (kind < 0.5) {
          const g = new THREE.DodecahedronGeometry(0.05 + r() * 0.09, 0);
          g.scale(1, 0.6, 1);
          stones.push(place(g, toLocal(lx, lz, 0.02), r() * 6));
        } else if (kind < 0.8) {
          chips.push(place(new THREE.BoxGeometry(0.08 + r() * 0.22, 0.025, 0.03 + r() * 0.05), toLocal(lx, lz, 0.02), r() * 6, (r() - 0.5) * 0.4));
        } else {
          metal.push(place(new THREE.BoxGeometry(0.1 + r() * 0.3, 0.012, 0.06 + r() * 0.15), toLocal(lx, lz, 0.02), r() * 6, (r() - 0.5) * 0.5));
        }
      }
    }
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!geos.length) return;
      const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      for (const g of flat) g.deleteAttribute('uv');
      const merged = mergeGeometries(flat, false);
      if (!merged) return;
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    add(stones, new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.9, flatShading: true }));
    add(chips, new THREE.MeshStandardMaterial({ color: 0xb38d5f, roughness: 0.9 }));
    add(metal, new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.45, metalness: 0.6 }));
  }

  /**
   * Burned earth: one irregular dark patch draped on the ground, made of soft blobs laid
   * along segments [x0, z0, x1, z1, width] in the wreck's frame.
   */
  private buildDirtPatch(segments: number[][]): THREE.Mesh {
    const X0 = -26;
    const Z0 = -22;
    const W = 54;
    const D = 48;
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const r = mulberry32(9);
    const px = (x: number) => ((x - X0) / W) * S;
    const pz = (z: number) => ((z - Z0) / D) * S;
    // The outline is a greyscale mask (alphaMap): an opaque core with a soft ragged rim.
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    const blob = (x: number, z: number, rad: number) => {
      const grd = g.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), (rad / W) * S);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.55, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    };
    for (const [x0, z0, x1, z1, w] of segments) {
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.6) + 1;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        blob(x0 + (x1 - x0) * t + (r() - 0.5) * w * 0.6, z0 + (z1 - z0) * t + (r() - 0.5) * w * 0.6, w * (0.8 + r() * 0.5));
      }
    }
    const mask = new THREE.CanvasTexture(c);
    mask.flipY = false;
    // The surface: a fine tiling texture of churned earth (2 m tiles) with clods lit on
    // top and shadowed below, fine gravel and charcoal crumbs. It doubles as the bump map.
    const T = 256;
    const tc = document.createElement('canvas');
    tc.width = tc.height = T;
    const tg = tc.getContext('2d')!;
    tg.fillStyle = 'rgb(58,44,31)';
    tg.fillRect(0, 0, T, T);
    const wrap = (f: (x: number, y: number) => void, x: number, y: number) => {
      for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) f(x + ox, y + oy);
    };
    for (let i = 0; i < 900; i++) {
      const x = r() * T;
      const y = r() * T;
      const rad = 2 + r() * 6;
      const rot = r() * 3;
      const lit = `rgba(${92 + r() * 34},${70 + r() * 24},${46 + r() * 18},${0.7 + r() * 0.3})`;
      wrap((xx, yy) => {
        tg.fillStyle = 'rgba(18,12,8,0.75)';
        tg.beginPath();
        tg.ellipse(xx + 1.2, yy + 1.6, rad, rad * 0.7, rot, 0, Math.PI * 2);
        tg.fill();
        tg.fillStyle = lit;
        tg.beginPath();
        tg.ellipse(xx, yy, rad * 0.85, rad * 0.6, rot, 0, Math.PI * 2);
        tg.fill();
      }, x, y);
    }
    for (let i = 0; i < 4200; i++) {
      const k = r();
      tg.fillStyle = k < 0.3 ? `rgba(8,7,6,${0.55 + r() * 0.4})` : k < 0.62 ? `rgba(140,132,120,${0.4 + r() * 0.3})` : `rgba(76,57,37,${0.5 + r() * 0.4})`;
      tg.fillRect(r() * T, r() * T, 1 + r() * 2, 1 + r() * 2);
    }
    const tex = new THREE.CanvasTexture(tc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(W / 2, D / 2);
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(W, D, 72, 64);
    geo.rotateX(Math.PI / 2);
    geo.translate(X0 + W / 2, 0, Z0 + D / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    // Large-scale variation in vertex colours: charred, darker zones and drier brown ones.
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      uv.setXY(i, (lx - X0) / W, (lz - Z0) / D);
      const wp = this.toWorld(lx, 0, lz);
      pos.setY(i, this.terrain.height(wp.x, wp.z) - this.center.y + 0.04);
      const n = 0.5 + 0.5 * Math.sin(lx * 0.31 + Math.sin(lz * 0.23) * 2) * Math.sin(lz * 0.27 - lx * 0.11);
      const k = 0.55 + 0.5 * n;
      col[i * 3] = k;
      col[i * 3 + 1] = k * 0.97;
      col[i * 3 + 2] = k * 0.94;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // rotateX(+π/2) leaves the faces looking down; flip them up.
    const idx = geo.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, alphaMap: mask, bumpMap: tex, bumpScale: 3, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    mesh.position.copy(this.center);
    mesh.rotation.y = this.yaw;
    mesh.receiveShadow = true;
    mesh.renderOrder = 0;
    return mesh;
  }

  private toWorld(lx: number, ly: number, lz: number): THREE.Vector3 {
    return new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.center);
  }

  /** Walkable cabin floor and the fallen floor panel sloping down out of the mouth, else null. */
  floorAt(x: number, z: number): number | null {
    const l = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    if (l.x > REAR - 0.1 && l.x < TEAR + 0.05 && Math.abs(l.z) < FLOOR_HALF) return this.center.y + FLOOR;
    if (l.x >= TEAR + 0.05 && l.x < TEAR + 1.85 && Math.abs(l.z) < 0.95) return this.center.y + FLOOR * ((TEAR + 1.9 - l.x) / 1.85);
    return null;
  }

  /** Local plane coordinates to a point on the sand. */
  localToGround(lx: number, lz: number, lift: number): THREE.Vector3 {
    const p = this.toWorld(lx, 0, lz);
    p.y = this.terrain.height(p.x, p.z) + lift;
    return p;
  }

  private addCollider(colliders: ColliderGrid, lx: number, lz: number, r: number, h: number): void {
    const p = this.toWorld(lx, 0, lz);
    colliders.add({ x: p.x, z: p.z, r, y0: this.center.y - 1, y1: this.center.y + h, kind: 'plane', ref: 0 });
  }

  /** Ray vs luggage spheres. */
  raycastCases(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate = 0): { t: number; index: number } | null {
    let best = maxDist;
    let idx = -1;
    const r = 0.42 + inflate;
    for (let i = 0; i < this.suitcases.length; i++) {
      const s = this.suitcases[i];
      if (s.broken) continue;
      const ox = o.x - s.pos.x;
      const oy = o.y - s.pos.y;
      const oz = o.z - s.pos.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = c < 0 ? 0 : -1;
      if (t >= 0 && t < best) {
        best = t;
        idx = i;
      }
    }
    return idx >= 0 ? { t: best, index: idx } : null;
  }

  private smokeA = new THREE.Color(0x1e1d1c);
  private smokeB = new THREE.Color(0x0e0d0c);
  private tintA = new THREE.Color();
  private tintB = new THREE.Color();

  /** `light` is the scene's ambient multiplier so the smoke darkens at night. */
  update(dt: number, light: THREE.Color): void {
    this.tintA.copy(this.smokeA).multiply(light);
    this.tintB.copy(this.smokeB).multiply(light);
    for (const e of this.smoke) {
      e.setTint(this.tintA, this.tintB);
      e.update(dt);
    }
    for (const e of this.fire) e.update(dt);
    this.flicker += dt;
    const f = Math.sin(this.flicker * 17) * 0.5 + Math.sin(this.flicker * 7.3) * 0.5;
    this.fireLight.intensity = 26 + f * 7;
    // Red emergency lamp: a slow pulse; the cockpit screens flicker; the dead fan turns in the wind.
    if (this.emergencyLight) this.emergencyLight.intensity = 1.2 + 4.5 * Math.pow(0.5 + 0.5 * Math.sin(this.flicker * 2.2), 2);
    if (this.screenMat) this.screenMat.emissiveIntensity = Math.random() < 0.04 ? 0.05 : 0.45 + Math.sin(this.flicker * 13) * 0.1;
    this.fan.rotation.x += dt * 0.5;
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 1.5 + Math.random() * 3.5;
      this.onSpark?.(this.toWorld(this.sparkLocal.x, this.sparkLocal.y, this.sparkLocal.z));
    }
  }
}

/** Small wooden dock on the lake shore nearest the crash site. */
export class Dock {
  readonly group = new THREE.Group();
  readonly start = new THREE.Vector3();
  readonly end = new THREE.Vector3();
  readonly top = LAKE_LEVEL + 0.5;
  private dir = new THREE.Vector2();
  private length = 12;
  private halfWidth = 1.15;

  constructor(terrain: Terrain, toward: THREE.Vector3) {
    const dx = toward.x - LAKE_CENTER.x;
    const dz = toward.z - LAKE_CENTER.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    // Shore = first point walking out from the centre that is above water.
    let shoreT = 0;
    for (let t = 0; t < 80; t += 0.25) {
      if (terrain.height(LAKE_CENTER.x + ux * t, LAKE_CENTER.z + uz * t) > LAKE_LEVEL + 0.3) {
        shoreT = t;
        break;
      }
    }
    const sx = LAKE_CENTER.x + ux * (shoreT + 1.5);
    const sz = LAKE_CENTER.z + uz * (shoreT + 1.5);
    this.start.set(sx, this.top, sz);
    this.end.set(sx - ux * this.length, this.top, sz - uz * this.length);
    this.dir.set(-ux, -uz);

    const plank = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
    const post = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.95 });
    const yaw = Math.atan2(ux, uz);
    this.group.position.copy(this.start);
    this.group.rotation.y = yaw;
    for (let i = 0; i < this.length / 0.42; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(this.halfWidth * 2, 0.07, 0.36), plank);
      p.position.set((Math.random() - 0.5) * 0.04, -0.035 + (Math.random() - 0.5) * 0.015, -i * 0.42);
      p.rotation.y = (Math.random() - 0.5) * 0.03;
      p.castShadow = p.receiveShadow = true;
      this.group.add(p);
    }
    for (let i = 0; i <= 4; i++) {
      for (const side of [-1, 1]) {
        const z = -i * (this.length / 4);
        const wx = this.start.x + this.dir.x * -z;
        const wz = this.start.z + this.dir.y * -z;
        const bed = terrain.height(wx, wz);
        const h = this.top - bed + 0.4;
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, h, 7), post);
        c.position.set(side * (this.halfWidth - 0.08), -h / 2 + 0.25, z);
        c.castShadow = true;
        this.group.add(c);
      }
    }
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, this.length), post);
      beam.position.set(side * (this.halfWidth - 0.08), -0.12, -this.length / 2);
      this.group.add(beam);
    }
  }

  /** Walkable deck height if (x,z) is on the dock. */
  groundAt(x: number, z: number): number | null {
    const rx = x - this.start.x;
    const rz = z - this.start.z;
    const along = rx * this.dir.x + rz * this.dir.y;
    const across = -rx * this.dir.y + rz * this.dir.x;
    if (along < -0.8 || along > this.length + 0.2 || Math.abs(across) > this.halfWidth) return null;
    return this.top;
  }
}
