import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bakeStatic } from '../core/bake';
import { mulberry32 } from '../core/math';
import { logMaterials } from '../weapons/models';
import { cabinWallTexture, carpetTexture, fuselageTexture, seatFabricTexture, tailLogoTexture } from './airliner';
import { PuffEmitter } from '../fx/particles';
import { ColliderGrid } from './colliders';
import { ItemType } from './pickups';
import { LAKE_CENTER, LAKE_LEVEL, Terrain } from './terrain';

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
/** Airliner section layout in the wreck's local frame (metres; +X toward the nose). */
const TORN = -5.8;
const NOSE_X = 5.6;
const AXIS_Y = 2.0;
const RADIUS = 2.0;
const FLOOR = 0.75;
const FLOOR_HALF = 1.5;

const CASE_COLORS = [0x2f4f7f, 0x7a2e2e, 0x2d2d2d, 0x6b5b3e, 0x3e6b4f, 0x8a6a2a, 0x5a3f6b, 0x404a52];

/** The broken airliner on the south beach: wake-up point, smoke, fire and luggage. */
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
  private engineLocal = new THREE.Vector3();

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
    this.dirt = this.buildDirtPatch(19);

    // ------------------------------------------------------------ the airliner
    // Local frame: +X toward the nose, the torn end at X = TORN, the cabin floor at FLOOR.
    const rand = mulberry32(31);
    const L = NOSE_X - TORN;
    const layout = { length: L, windows: [] as number[], windowAngle: 0.3 };
    for (let m = 1.0; m < L - 1.6; m += 0.92) layout.windows.push(m);
    const skin = new THREE.MeshStandardMaterial({ map: fuselageTexture(layout), roughness: 0.42, metalness: 0.55, alphaTest: 0.5, side: THREE.FrontSide });
    const wall = new THREE.MeshStandardMaterial({ map: cabinWallTexture(layout), roughness: 0.85, metalness: 0, alphaTest: 0.5, side: THREE.BackSide });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.4, metalness: 0.75 });
    const charred = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.95 });
    const sootMetal = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.6, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.08, metalness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe4e6e8, roughness: 0.4, metalness: 0.5 });
    const root = new THREE.Group();
    this.group.add(root);
    const put = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = root): T => {
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true;
      });
      parent.add(o);
      return o;
    };

    // Fuselage: outside livery and the cabin wall inside, windows and tear cut from the alpha.
    const cyl = (r: number) => {
      const g = new THREE.CylinderGeometry(r, r, L, 56, 20, true);
      g.rotateZ(-Math.PI / 2);
      g.rotateX(Math.PI);
      g.translate((NOSE_X + TORN) / 2, AXIS_Y, 0);
      return g;
    };
    put(new THREE.Mesh(cyl(RADIUS), skin));
    put(new THREE.Mesh(cyl(RADIUS - 0.07), wall));
    // Nose cone with the cockpit glazing.
    const noseGeo = new THREE.SphereGeometry(RADIUS, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    noseGeo.scale(1, 1.45, 1);
    noseGeo.rotateZ(-Math.PI / 2);
    noseGeo.translate(NOSE_X, AXIS_Y, 0);
    put(new THREE.Mesh(noseGeo, white));
    const noseIn = new THREE.Mesh(noseGeo, new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.9, side: THREE.BackSide }));
    put(noseIn);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.05), glass);
        w.position.set(NOSE_X + 1.5 + k * 0.38, AXIS_Y + 1.28 - k * 0.24, s * (0.72 + k * 0.3));
        w.rotation.set(s * 0.45, s * (0.35 + k * 0.4), -0.75, 'YXZ');
        put(w);
      }
    }
    // Cabin floor (carpet) with emergency strips down the aisle.
    const carpet = carpetTexture();
    carpet.repeat.set(L / 1.5, 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.2, FLOOR_HALF * 2), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((NOSE_X + TORN) / 2, FLOOR, 0);
    put(floor);
    const strip = new THREE.MeshStandardMaterial({ color: 0x9cffb4, emissive: 0x3cff78, emissiveIntensity: 1.4 });
    for (let x = TORN + 0.4; x < NOSE_X - 0.6; x += 0.35) {
      if (rand() < 0.18) continue;
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.015, 0.03), strip);
        e.position.set(x, FLOOR + 0.008, s * 0.48);
        root.add(e);
      }
    }
    // Seats: double seats either side of the aisle, a few knocked crooked.
    const fabric = new THREE.MeshStandardMaterial({ map: seatFabricTexture(), roughness: 0.9 });
    const cover = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.9 });
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
    let ri = 0;
    for (let x = TORN + 1.1; x < NOSE_X - 1.4; x += 0.84, ri++) {
      for (const s of [-1, 1]) {
        const broken = (ri === 2 && s > 0) || (ri === 5 && s < 0) || ri === 1;
        seatRow(x, s, broken ? s * (0.12 + rand() * 0.18) : 0);
        this.seatSpots.push({ x, z: s * 1.12 });
      }
    }
    // Overhead bins, some hanging open.
    for (const s of [-1, 1]) {
      for (let x = TORN + 0.8; x < NOSE_X - 1.0; x += 1.25) {
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
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(L - 1, 0.04, 0.5), cover);
    ceil.position.set((NOSE_X + TORN) / 2, AXIS_Y + 1.92, 0);
    put(ceil);
    const cable = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    for (let k = 0; k < 6; k++) {
      const x = TORN + 0.4 + rand() * 2.2;
      const z = (rand() - 0.5) * 1.6;
      const pts = [new THREE.Vector3(x, AXIS_Y + 1.85, z), new THREE.Vector3(x + (rand() - 0.5) * 0.3, AXIS_Y + 1.2, z + (rand() - 0.5) * 0.3), new THREE.Vector3(x + (rand() - 0.5) * 0.5, AXIS_Y + 0.6 + rand() * 0.5, z + (rand() - 0.5) * 0.4)];
      put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.018, 4, false), cable));
    }
    this.sparkLocal.set(TORN + 1.2, AXIS_Y + 1.8, 0.5);
    // Cockpit: instrument panel with dim screens, two control yokes.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 2.2), charred);
    panel.position.set(NOSE_X + 0.9, FLOOR + 0.85, 0);
    panel.rotation.z = 0.5;
    put(panel);
    this.screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1e14, emissive: 0x2ad48a, emissiveIntensity: 0.6 });
    for (const z of [-0.7, -0.25, 0.25, 0.7]) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), this.screenMat);
      sc.position.set(NOSE_X + 0.66, FLOOR + 0.98, z);
      sc.rotation.set(0, -Math.PI / 2, 0.5, 'YXZ');
      sc.userData.keep = true;
      root.add(sc);
    }
    for (const z of [-0.55, 0.55]) {
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 5, 10, Math.PI), frame);
      yoke.position.set(NOSE_X + 0.45, FLOOR + 0.85, z);
      yoke.rotation.y = Math.PI / 2;
      put(yoke);
    }
    for (const z of [-0.55, 0.55]) {
      const pilot = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.9, 0.5, 2, 0.06), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }));
      pilot.position.set(NOSE_X - 0.2, FLOOR + 0.55, z);
      put(pilot);
    }
    // The tear: exposed frames (ribs) and stringers, crumpled skin peeled outward.
    for (const [x, arc] of [
      [TORN + 0.15, 4.6],
      [TORN - 0.35, 3.4],
      [TORN - 0.8, 2.2],
    ] as [number, number][]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(RADIUS - 0.04, 0.05, 6, 40, arc), metal);
      rib.position.set(x, AXIS_Y, 0);
      rib.rotation.set(0, Math.PI / 2, rand() * 6);
      put(rib);
    }
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rand() * 0.2;
      if (Math.sin(a) < -0.4) continue;
      const len = 0.5 + rand() * 1.2;
      const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.06), metal);
      s.position.set(TORN - len / 2 + 0.1, AXIS_Y + Math.sin(a) * (RADIUS - 0.05), Math.cos(a) * (RADIUS - 0.05));
      s.rotation.set(a, 0, (rand() - 0.5) * 0.4, 'XYZ');
      put(s);
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 1.6 - 0.3;
      const peel = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 0.02, RADIUS + 0.02, 0.9 + rand() * 0.6, 6, 1, true, a, 0.55), skin);
      peel.rotation.z = -Math.PI / 2;
      peel.position.set(TORN - 0.3, AXIS_Y, 0);
      const pivot = new THREE.Group();
      pivot.add(peel);
      pivot.position.set(0, 0, 0);
      pivot.rotation.set((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.25, (rand() - 0.5) * 0.2);
      put(pivot);
    }
    // Debris ramp down from the torn floor (a fallen floor panel).
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.9), sootMetal);
    ramp.position.set(TORN - 0.9, FLOOR / 2 - 0.02, 0);
    ramp.rotation.z = Math.atan2(FLOOR, 1.9);
    put(ramp);

    // ------------------------------------------------------------ wing and engine
    const wingG = new THREE.Group();
    wingG.position.set(0.2, 0.28, 3.4);
    wingG.rotation.set(0.04, -0.12, 0.05);
    put(wingG);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(-4.2, 0);
    wingShape.lineTo(-6.2, 9.5);
    wingShape.lineTo(-4.8, 9.5);
    wingShape.lineTo(0, 0);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
    wingGeo.rotateX(Math.PI / 2);
    put(new THREE.Mesh(wingGeo, white), wingG);
    for (let k = 0; k < 3; k++) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 2.4), white);
      flap.position.set(-4.45 - k * 0.48, -0.25, 1.6 + k * 2.6);
      flap.rotation.set(0, -0.2, -0.45 - k * 0.1);
      put(flap, wingG);
    }
    const winglet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.1), new THREE.MeshStandardMaterial({ map: tailLogoTexture(), roughness: 0.4 }));
    winglet.position.set(-5.6, 0.5, 9.5);
    winglet.rotation.z = -0.3;
    put(winglet, wingG);
    // Engine nacelle with fan blades, spinner and exhaust, blackened.
    const eng = new THREE.Group();
    eng.position.set(-1.2, -0.15, 3.6);
    wingG.add(eng);
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.72, 3.0, 28, 1, true), sootMetal);
    nacelle.rotation.z = Math.PI / 2;
    put(nacelle, eng);
    const nacIn = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.7, 3.0, 28, 1, true), charred);
    nacIn.material = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.9, side: THREE.BackSide });
    nacIn.rotation.z = Math.PI / 2;
    put(nacIn, eng);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.08, 8, 28), metal);
    lip.rotation.y = Math.PI / 2;
    lip.position.x = 1.5;
    put(lip, eng);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 14), metal);
    spinner.rotation.z = -Math.PI / 2;
    spinner.position.x = 1.25;
    put(spinner, eng);
    this.fan.position.set(1.05, 0, 0);
    for (let k = 0; k < 18; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.66, 0.16), metal);
      const a = (k / 18) * Math.PI * 2;
      blade.position.set(0, Math.cos(a) * 0.45, Math.sin(a) * 0.45);
      blade.rotation.set(a, 0.5, 0);
      this.fan.add(blade);
    }
    this.fan.userData.keep = true;
    eng.add(this.fan);
    const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 16, 1, true), charred);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.x = -1.9;
    put(exhaust, eng);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.22), white);
    pylon.position.set(-0.4, 0.62, 0);
    put(pylon, eng);
    eng.updateMatrixWorld(true);
    this.engineLocal.copy(eng.getWorldPosition(new THREE.Vector3())).sub(this.group.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);

    // ------------------------------------------------------------ tail section, thrown behind
    const tail = new THREE.Group();
    tail.position.set(-15.5, 1.1, -3.2);
    tail.rotation.set(0.05, 0.5, 0.18);
    put(tail);
    const coneGeo = new THREE.CylinderGeometry(1.75, 0.45, 7.6, 40, 8, true);
    coneGeo.rotateZ(-Math.PI / 2);
    coneGeo.rotateX(Math.PI);
    put(new THREE.Mesh(coneGeo, skin), tail);
    put(new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.95, side: THREE.BackSide })), tail);
    const tailRib = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.05, 6, 36, 4.2), metal);
    tailRib.rotation.set(0, Math.PI / 2, 0.6);
    tailRib.position.x = 3.7;
    put(tailRib, tail);
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(-2.4, 3.9);
    finShape.lineTo(-3.9, 3.9);
    finShape.lineTo(-3.6, 0);
    finShape.lineTo(0, 0);
    const logo = tailLogoTexture();
    logo.wrapS = logo.wrapT = THREE.RepeatWrapping;
    logo.repeat.set(1 / 4, 1 / 4);
    logo.offset.set(1, 0);
    const finMat = new THREE.MeshStandardMaterial({ map: logo, roughness: 0.4, metalness: 0.3 });
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }), finMat);
    fin.position.set(-0.6, 1.2, -0.1);
    put(fin, tail);
    const rudderShape = new THREE.Shape();
    rudderShape.moveTo(0, 0);
    rudderShape.lineTo(-0.25, 3.6);
    rudderShape.lineTo(-0.85, 3.6);
    rudderShape.lineTo(-0.75, 0);
    rudderShape.lineTo(0, 0);
    const rudder = new THREE.Mesh(new THREE.ExtrudeGeometry(rudderShape, { depth: 0.16, bevelEnabled: false }), finMat);
    rudder.position.set(-4.2, 1.35, -0.08);
    rudder.rotation.y = 0.35;
    put(rudder, tail);
    for (const s of [-1, 1]) {
      const stab = new THREE.Shape();
      stab.moveTo(0, 0);
      stab.lineTo(-1.6, 2.8);
      stab.lineTo(-2.6, 2.8);
      stab.lineTo(-2.6, 0);
      stab.lineTo(0, 0);
      const sg = new THREE.ExtrudeGeometry(stab, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
      sg.rotateX(s * Math.PI / 2);
      const m = new THREE.Mesh(sg, white);
      m.position.set(-1.0, 0.25, s * 0.35);
      put(m, tail);
    }

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

    // Scattered debris and scorch marks.
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(2 + rand() * 2.5, 18), scorchMat);
      s.rotation.x = -Math.PI / 2;
      const lx = -8 + rand() * 14;
      const lz = -2 + rand() * 9;
      s.position.copy(this.localToGround(lx, lz, 0.05)).sub(this.center);
      s.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      s.userData.keep = true;
      this.group.add(s);
    }
    for (let i = 0; i < 26; i++) {
      const piece = new THREE.Mesh(new THREE.BoxGeometry(0.2 + rand() * 0.9, 0.04 + rand() * 0.1, 0.2 + rand() * 0.7), rand() > 0.4 ? white : charred);
      const lx = -16 + rand() * 30;
      const lz = -6 + rand() * 16;
      if (lx > TORN - 1 && lx < NOSE_X + 2 && Math.abs(lz) < 2.6) continue;
      const p = this.localToGround(lx, lz, 0.05).sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      piece.position.copy(p);
      piece.rotation.set(rand() * 0.5, rand() * 6, rand() * 0.5);
      put(piece);
    }
    // Merge every static piece (screens, fan and scorch decals stay apart).
    for (const m of bakeStatic(root)) m.castShadow = true;

    // Colliders: the hull walls (the torn end stays open), nose, seats, wing, engine and tail.
    for (let x = TORN + 0.3; x <= NOSE_X; x += 0.55) {
      this.addCollider(colliders, x, -RADIUS - 0.12, 0.34, 3.6);
      this.addCollider(colliders, x, RADIUS + 0.12, 0.34, 3.6);
    }
    for (let a = -1.2; a <= 1.2; a += 0.4) this.addCollider(colliders, NOSE_X + Math.cos(a) * 2.6, Math.sin(a) * 2.0, 0.5, 3.6);
    for (const s of this.seatSpots) this.addCollider(colliders, s.x, s.z, 0.4, 2.0);
    for (let k = 0; k < 6; k++) this.addCollider(colliders, -1.6 - k * 0.6, 4.4 + k * 1.6, 0.7, 0.9);
    {
      const e = this.engineLocal;
      this.addCollider(colliders, e.x, e.z, 1.05, 1.6);
      this.addCollider(colliders, e.x - 1.2, e.z, 0.9, 1.6);
    }
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const lx = -15.5 + Math.cos(0.5) * (3.8 - t * 7.6);
      const lz = -3.2 - Math.sin(0.5) * (3.8 - t * 7.6);
      this.addCollider(colliders, lx, lz, 1.6 - t * 1.0, 3.2);
    }

    // Emergency light: a slow red pulse inside the cabin (part of the fixed light pool).
    this.emergencyLight = new THREE.PointLight(0xff2a1a, 0, 9, 1.6);
    this.emergencyLight.position.copy(this.toWorld(0.5, AXIS_Y + 1.6, 0));

    // Fire, smoke and the light they throw.
    this.firePos.copy(this.toWorld(this.engineLocal.x - 0.8, this.engineLocal.y + 0.4, this.engineLocal.z));
    const brokenEnd = this.toWorld(TORN - 0.4, AXIS_Y + 1.4, 0);
    const smokeCfg = { life: 7, rise: 2.2, spread: 1.4, size0: 1.6, size1: 7.5, alpha: 0.42, color: 0x3a3836, color2: 0x24221f, additive: false };
    const fireCfg = { life: 0.9, rise: 1.8, spread: 0.9, size0: 1.3, size1: 0.3, alpha: 0.9, color: 0xff5a12, color2: 0xffd27a, additive: true };
    const s1 = new PuffEmitter(70, smokeCfg);
    s1.origin.copy(this.firePos).y += 0.8;
    const s2 = new PuffEmitter(45, { ...smokeCfg, alpha: 0.3, size1: 5.5 });
    s2.origin.copy(brokenEnd);
    const f1 = new PuffEmitter(46, fireCfg);
    f1.origin.copy(this.firePos);
    const f2 = new PuffEmitter(24, { ...fireCfg, size0: 0.8, spread: 0.7 });
    f2.origin.copy(brokenEnd).y -= 0.4;
    this.smoke.push(s1, s2);
    this.fire.push(f1, f2);
    this.fireLight = new THREE.PointLight(0xff8a3a, 30, 22, 1.6);
    this.fireLight.position.copy(this.firePos).y += 1.2;

    // Luggage scattered on the landward side.
    const casePositions = [
      [3.5, -4.6], [-1.5, -5.8], [8.5, -3.8], [-8.2, -2.5], [10.5, 3.2], [-10.5, 2.5], [4.8, 13.5], [-8.5, 9.5],
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

    // Wake up in the aisle near the front, looking back through the tear at the clearing.
    this.spawn.copy(this.toWorld(3.2, FLOOR, 0));
    this.spawnYaw = Math.atan2(Math.cos(this.yaw), -Math.sin(this.yaw));
    // Effigies at the edge of the clearing, facing the wreck.
    for (const [lx, lz] of [
      [-9, 17],
      [13, -15],
    ]) {
      const p = this.toWorld(lx, 0, lz);
      this.effigySpots.push({ x: p.x, z: p.z, yaw: Math.atan2(this.center.x - p.x, this.center.z - p.z) });
    }
  }

  readonly dirt: THREE.Mesh;

  /** Churned earth around the impact: a disc that follows the ground, fading at its rim. */
  private buildDirtPatch(radius: number): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grad.addColorStop(0, 'rgba(92,70,46,1)');
    grad.addColorStop(0.72, 'rgba(88,68,44,0.92)');
    grad.addColorStop(1, 'rgba(80,62,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 118;
      g.fillStyle = rnd() > 0.5 ? `rgba(60,44,28,${0.35 * rnd()})` : `rgba(130,104,72,${0.3 * rnd()})`;
      g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2 + rnd() * 5, 1 + rnd() * 3);
    }
    // Furrows ploughed by the fuselage.
    g.strokeStyle = 'rgba(40,28,16,0.45)';
    g.lineWidth = 6;
    for (let k = -2; k <= 2; k++) {
      g.beginPath();
      g.moveTo(30, 128 + k * 14);
      g.bezierCurveTo(90, 120 + k * 16, 170, 136 + k * 12, 236, 128 + k * 10);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const seg = 40;
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + this.center.x;
      const z = pos.getZ(i) + this.center.z;
      pos.setY(i, this.terrain.height(x, z) - this.center.y + 0.04);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.position.copy(this.center);
    mesh.receiveShadow = true;
    mesh.renderOrder = 0;
    return mesh;
  }

  private toWorld(lx: number, ly: number, lz: number): THREE.Vector3 {
    return new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.center);
  }

  /** Walkable cabin floor (and the fallen panel ramp at the tear), else null. */
  floorAt(x: number, z: number): number | null {
    const l = new THREE.Vector3(x - this.center.x, 0, z - this.center.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    if (l.x > TORN - 0.05 && l.x < NOSE_X + 0.9 && Math.abs(l.z) < FLOOR_HALF) return this.center.y + FLOOR;
    if (l.x <= TORN - 0.05 && l.x > TORN - 1.85 && Math.abs(l.z) < 0.95) return this.center.y + FLOOR * ((l.x - (TORN - 1.9)) / 1.85);
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

  private smokeA = new THREE.Color(0x3a3836);
  private smokeB = new THREE.Color(0x24221f);
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
