import * as THREE from 'three';
import { mulberry32 } from '../core/math';
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

const CONTENTS: ItemType[][] = [
  ['food', 'bandage'],
  ['stick', 'cloth'],
  ['food', 'stick'],
  ['cloth', 'cloth'],
  ['bandage', 'stick'],
  ['food'],
  ['cloth', 'food'],
  ['stick', 'bandage'],
];
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

  constructor(private terrain: Terrain, colliders: ColliderGrid) {
    // Find the southern beach: walk south from the interior until the ground is low sand.
    const shore = terrain.findShore(-10, 120, 0, 1, 1.5);
    const cx = shore.x;
    const cz = shore.z + 4;
    this.yaw = 0.22;
    const baseY = terrain.height(cx, cz);
    this.center.set(cx, baseY, cz);
    this.group.position.copy(this.center);
    this.group.rotation.y = this.yaw;

    const hull = std(0xe8e8e4, 0.55, 0.15);
    const stripe = std(0x1f5fa8, 0.5, 0.1);
    const charred = std(0x1d1b19, 0.95);
    const inner = std(0x2a2826, 0.95, 0, THREE.BackSide);
    const glass = std(0x0e1a24, 0.15, 0.6);
    const metal = std(0x9aa0a6, 0.45, 0.6);

    const add = (mesh: THREE.Mesh, cast = true) => {
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    // Front fuselage section, half buried and rolled.
    const front = new THREE.Group();
    front.position.set(0, 1.15, 0);
    front.rotation.set(0.12, 0, -0.04);
    this.group.add(front);
    const bodyGeo = new THREE.CylinderGeometry(1.7, 1.7, 11, 24, 1, true);
    bodyGeo.rotateZ(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, hull);
    const bodyIn = new THREE.Mesh(bodyGeo, inner);
    body.castShadow = body.receiveShadow = true;
    front.add(body, bodyIn);
    for (const th of [0.9, Math.PI + 0.9]) {
      const sg = new THREE.CylinderGeometry(1.715, 1.715, 11, 24, 1, true, th, 0.28);
      sg.rotateZ(Math.PI / 2);
      front.add(new THREE.Mesh(sg, stripe));
    }
    const noseGeo = new THREE.SphereGeometry(1.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    noseGeo.scale(1, 1.6, 1);
    noseGeo.rotateZ(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, hull);
    nose.position.x = 5.5;
    nose.castShadow = true;
    front.add(nose);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 2.2), glass);
    cockpit.position.set(6.3, 0.75, 0);
    cockpit.rotation.z = -0.5;
    front.add(cockpit);
    for (let i = 0; i < 9; i++) {
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.05), glass);
        w.position.set(-4 + i * 1.05, 0.55, side * 1.62);
        w.rotation.x = side * 0.3;
        front.add(w);
      }
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.16, 6, 18), charred);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = -5.5;
    front.add(rim);

    // Wing toward the sea with a burning engine.
    const wing = add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.22, 11), hull));
    wing.position.set(0.4, 0.55, 6.6);
    wing.rotation.set(-0.06, 0.12, 0.05);
    const engine = add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 2.6, 14), charred));
    engine.rotation.z = Math.PI / 2;
    engine.position.set(0.9, 0.5, 5.2);
    const intake = add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 6, 14), metal));
    intake.rotation.y = Math.PI / 2;
    intake.position.set(2.2, 0.5, 5.2);

    // Tail section thrown behind.
    const tail = new THREE.Group();
    tail.position.set(-13.5, 1.0, -2.2);
    tail.rotation.set(0.05, 0.55, 0.25);
    this.group.add(tail);
    const tailGeo = new THREE.CylinderGeometry(1.5, 0.5, 7, 18, 1, true);
    tailGeo.rotateZ(Math.PI / 2);
    const tailMesh = new THREE.Mesh(tailGeo, hull);
    tailMesh.castShadow = true;
    tail.add(tailMesh, new THREE.Mesh(tailGeo, inner));
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 0.18), stripe);
    fin.position.set(-2.6, 1.9, 0);
    fin.rotation.z = -0.35;
    fin.castShadow = true;
    tail.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 5), hull);
    stab.position.set(-2.8, 0.4, 0);
    stab.castShadow = true;
    tail.add(stab);
    const tailRim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.14, 6, 16), charred);
    tailRim.rotation.y = Math.PI / 2;
    tailRim.position.x = 3.5;
    tail.add(tailRim);

    // Scattered debris and scorch marks.
    const rand = mulberry32(31);
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(2 + rand() * 2.5, 18), scorchMat);
      s.rotation.x = -Math.PI / 2;
      const lx = -8 + rand() * 14;
      const lz = -2 + rand() * 9;
      s.position.copy(this.localToGround(lx, lz, 0.05)).sub(this.center);
      s.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      this.group.add(s);
    }
    for (let i = 0; i < 26; i++) {
      const piece = add(new THREE.Mesh(new THREE.BoxGeometry(0.2 + rand() * 0.9, 0.04 + rand() * 0.1, 0.2 + rand() * 0.7), rand() > 0.4 ? hull : charred));
      const lx = -16 + rand() * 30;
      const lz = -6 + rand() * 16;
      const p = this.localToGround(lx, lz, 0.05).sub(this.center).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
      piece.position.copy(p);
      piece.rotation.set(rand() * 0.5, rand() * 6, rand() * 0.5);
    }

    // Colliders along the hull, wing, engine and tail.
    for (let x = -5; x <= 7.5; x += 2.1) this.addCollider(colliders, x, 0, 1.75, 3.2);
    for (let z = 2.5; z <= 11; z += 1.8) this.addCollider(colliders, 0.4, z, 1.0, 1.0);
    this.addCollider(colliders, 0.9, 5.2, 1.1, 1.4);
    for (let x = -11; x >= -17; x -= 1.8) {
      const t = (x + 11) / -6;
      this.addCollider(colliders, x, -2.2 - (x + 11) * 0.55, 1.4 - t * 0.7, 2.6);
    }

    // Fire, smoke and the light they throw.
    this.firePos.copy(this.toWorld(0.9, 1.1, 5.2));
    const brokenEnd = this.toWorld(-5.8, 1.6, 0);
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
      [3.5, -4.2], [-1.5, -5.5], [7.5, -3.2], [-6.8, -4.0], [10.5, 2.8], [-9.5, 2.5], [4.8, 12.5], [-3.5, 8.8],
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

    this.spawn.copy(this.localToGround(1.5, -7.5, 0));
    // Face the wreck when waking up.
    const toPlane = new THREE.Vector3().subVectors(this.center, this.spawn);
    this.spawnYaw = Math.atan2(-toPlane.x, -toPlane.z);
  }

  private toWorld(lx: number, ly: number, lz: number): THREE.Vector3 {
    return new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.center);
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
