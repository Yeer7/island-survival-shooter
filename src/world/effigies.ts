import * as THREE from 'three';
import { AssetLibrary } from '../assets/assets';
import { bakeStatic } from '../core/bake';
import { mulberry32 } from '../core/math';
import { buildLog } from '../weapons/models';
import { Circle, ColliderGrid } from './colliders';
import { Terrain } from './terrain';

/** Blows from an axe or spear needed to bring an effigy down. */
export const EFFIGY_HITS = 2;

export interface Effigy {
  id: number;
  /** Pivot at the foot: it wobbles and topples around this point. */
  root: THREE.Group;
  /** Cloth strips (kept apart from the baked mesh so they can sway). */
  cloth: THREE.Group;
  pos: THREE.Vector3;
  height: number;
  hits: number;
  broken: boolean;
  collider: Circle;
  axis: THREE.Vector3;
  tilt: number;
  tiltV: number;
  fallT: number;
  phase: number;
}

let clothTex: THREE.CanvasTexture | null = null;
/** Three hanging strips (dyed red, natural linen, dark) with frayed, torn ends. */
function clothTexture(): THREE.CanvasTexture {
  if (clothTex) return clothTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const r = mulberry32(61);
  const cols = ['#8e2a1e', '#d6c7a1', '#4a3322'];
  for (let k = 0; k < 3; k++) {
    const x0 = 6 + k * 41;
    const w = 32 + r() * 4;
    const bottom = 170 + r() * 70;
    g.fillStyle = cols[k];
    g.beginPath();
    g.moveTo(x0, 0);
    g.lineTo(x0 + w, 0);
    // Frayed, torn lower edge.
    for (let x = x0 + w; x >= x0; x -= 4) g.lineTo(x + (r() - 0.5) * 2, bottom - r() * 34);
    g.closePath();
    g.fill();
    // Weave threads and grime.
    for (let y = 0; y < bottom; y += 3) {
      g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
      g.fillRect(x0, y, w, 1);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(40,24,10,${r() * 0.25})`;
      g.beginPath();
      g.ellipse(x0 + r() * w, r() * bottom, 2 + r() * 6, 2 + r() * 9, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Loose threads.
    g.strokeStyle = cols[k];
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = x0 + r() * w;
      g.beginPath();
      g.moveTo(x, bottom - 30);
      g.lineTo(x + (r() - 0.5) * 6, bottom + r() * 16);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  clothTex = t;
  return t;
}

let mats: { cloth: THREE.MeshStandardMaterial; rope: THREE.MeshStandardMaterial; stone: THREE.MeshStandardMaterial } | null = null;
function materials() {
  if (!mats) {
    mats = {
      cloth: new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5 }),
      rope: new THREE.MeshStandardMaterial({ color: 0x3b2c1c, roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x7d7a73, roughness: 0.9, flatShading: true }),
    };
  }
  return mats;
}

function logBetween(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const log = buildLog(d.length(), r);
  log.position.copy(a).addScaledVector(d, 0.5);
  log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  log.castShadow = true;
  return log;
}

/**
 * Tribal effigies: crossed stakes lashed with rope, strips of cloth, a skull on top and
 * bones tied on. Two blows from an axe or spear knock one down (it topples and drops
 * cloth and sticks). They mark the village and the trails through the forest.
 */
export class Effigies {
  readonly group = new THREE.Group();
  readonly list: Effigy[] = [];
  private v = new THREE.Vector3();

  constructor(
    private terrain: Terrain,
    colliders: ColliderGrid,
    private lib: AssetLibrary | null,
    spots: { x: number; z: number; yaw: number }[],
  ) {
    spots.forEach((s, id) => {
      const r = mulberry32(id * 977 + 13);
      const y = terrain.height(s.x, s.z);
      const root = new THREE.Group();
      root.position.set(s.x, y, s.z);
      const body = new THREE.Group();
      body.rotation.y = s.yaw;
      root.add(body);
      const { cloth, height } = id % 2 === 0 ? this.buildCross(body, r) : this.buildX(body, r);
      cloth.userData.keep = true;
      for (const m of bakeStatic(body)) m.castShadow = true;
      this.group.add(root);
      const collider = colliders.add({ x: s.x, z: s.z, r: 0.35, y0: y - 1, y1: y + height, kind: 'rock', ref: 2 });
      this.list.push({ id, root, cloth, pos: new THREE.Vector3(s.x, y, s.z), height, hits: 0, broken: false, collider, axis: new THREE.Vector3(1, 0, 0), tilt: 0, tiltV: 0, fallT: -1, phase: r() * 6 });
    });
  }

  private skull(parent: THREE.Object3D, x: number, y: number, z: number, yaw: number, tilt: number, size = 0.3): void {
    if (this.lib?.has('skull')) {
      const s = this.lib.instance('skull', { by: 'height', value: size });
      s.position.set(x, y, z);
      s.rotation.set(tilt, yaw, 0, 'YXZ');
      parent.add(s);
    } else {
      const s = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe9dfca, roughness: 0.6 }));
      s.position.set(x, y + size * 0.5, z);
      parent.add(s);
    }
  }

  private bone(parent: THREE.Object3D, x: number, y: number, z: number, rz: number, size = 0.42): void {
    if (!this.lib?.has('bone')) return;
    const b = this.lib.instance('bone', { by: 'max', value: size });
    // The bone lies along X with its base at y=0: centre it on its middle.
    b.position.set(x, y - 0.03, z);
    b.rotation.set(0, 0, rz);
    parent.add(b);
  }

  private lash(parent: THREE.Object3D, x: number, y: number, z: number, rx: number, rz: number): void {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.024, 5, 10), materials().rope);
    t.position.set(x, y, z);
    t.rotation.set(rx, 0, rz);
    parent.add(t);
  }

  private stones(parent: THREE.Object3D, r: () => number): void {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r();
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + r() * 0.08, 0), materials().stone);
      st.position.set(Math.sin(a) * 0.32, 0.03, Math.cos(a) * 0.32);
      st.scale.set(1, 0.6, 1);
      st.rotation.set(r() * 3, r() * 3, r() * 3);
      parent.add(st);
    }
  }

  /** Cloth strips on a pivot at their top edge (local +Z is the effigy's front). */
  private clothAt(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), materials().cloth);
    plane.position.y = -h / 2;
    plane.castShadow = true;
    pivot.add(plane);
    parent.add(pivot);
    return pivot;
  }

  /** Variant A: a stake with a cross bar, cloth hanging from the bar, bones tied in an X. */
  private buildCross(body: THREE.Group, r: () => number): { cloth: THREE.Group; height: number } {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const lean = (r() - 0.5) * 0.12;
    body.add(logBetween(v(0, -0.35, 0), v(lean, 2.2, 0), 0.07));
    body.add(logBetween(v(-0.78, 1.72, 0.05), v(0.8, 1.78, 0.05), 0.045));
    this.lash(body, lean * 0.75, 1.75, 0.04, 0, Math.PI / 4);
    // Short sticks crossed below the bar.
    body.add(logBetween(v(-0.42, 0.75, 0.09), v(0.42, 1.35, 0.09), 0.035));
    body.add(logBetween(v(0.42, 0.75, 0.09), v(-0.42, 1.35, 0.09), 0.035));
    this.lash(body, lean * 0.4, 1.05, 0.1, Math.PI / 2, 0);
    this.bone(body, lean * 0.4, 1.05, 0.15, 0.7, 0.4);
    this.bone(body, lean * 0.4, 1.05, 0.17, -0.7, 0.4);
    this.skull(body, lean, 2.12, 0.02, (r() - 0.5) * 0.5, (r() - 0.5) * 0.25);
    // Bones hanging from the ends of the bar.
    if (this.lib?.has('bone')) {
      for (const s of [-1, 1]) {
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 3), materials().rope);
        str.position.set(s * 0.68, 1.6, 0.05);
        body.add(str);
        const b = this.lib.instance('bone', { by: 'max', value: 0.36 });
        b.position.set(s * 0.68, 1.12, 0.05);
        b.rotation.set(0, (r() - 0.5) * 0.6, Math.PI / 2);
        body.add(b);
      }
    }
    this.stones(body, r);
    const cloth = this.clothAt(body, 0, 1.7, 0.1, 0.62, 0.95);
    return { cloth, height: 2.35 };
  }

  /** Variant B: two long sticks crossed in an X, a stake through the middle with the skull. */
  private buildX(body: THREE.Group, r: () => number): { cloth: THREE.Group; height: number } {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    body.add(logBetween(v(-0.62, -0.3, 0), v(0.66, 2.35, 0.02), 0.055));
    body.add(logBetween(v(0.62, -0.3, 0), v(-0.66, 2.35, 0.02), 0.055));
    body.add(logBetween(v(0, -0.35, -0.06), v(0, 1.95, -0.06), 0.06));
    this.lash(body, 0, 1.0, 0.03, Math.PI / 2, 0);
    this.lash(body, 0, 1.9, -0.02, Math.PI / 2, 0);
    this.skull(body, 0, 1.92, 0.0, (r() - 0.5) * 0.5, -0.1 + (r() - 0.5) * 0.2, 0.32);
    this.bone(body, 0, 1.0, 0.1, 0.55, 0.46);
    this.bone(body, 0, 1.0, 0.12, -0.55, 0.46);
    // A second, smaller skull tied lower on one arm.
    this.skull(body, 0.38, 0.58, 0.06, (r() - 0.5) * 0.8, 0.3, 0.2);
    this.lash(body, 0.4, 0.82, 0.03, Math.PI / 2, 0.3);
    this.stones(body, r);
    const cloth = this.clothAt(body, -0.45, 1.86, 0.08, 0.5, 0.85);
    return { cloth, height: 2.4 };
  }

  /** Ray against each standing effigy's upright cylinder. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate = 0): { t: number; index: number } | null {
    let best = maxDist;
    let idx = -1;
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-8) return null;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.broken) continue;
      const rr = 0.42 + inflate;
      const ox = o.x - e.pos.x;
      const oz = o.z - e.pos.z;
      if (ox * ox + oz * oz > (best + rr) * (best + rr)) continue;
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - rr * rr;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0) t = c < 0 ? 0 : -1;
      if (t < 0 || t >= best) continue;
      const y = o.y + d.y * t;
      if (y < e.pos.y - 0.2 || y > e.pos.y + e.height) continue;
      best = t;
      idx = i;
    }
    return idx >= 0 ? { t: best, index: idx } : null;
  }

  /**
   * A blow worth `power` hits, struck from `from`. Returns whether it came down and
   * how much of it is left (0..1) for the target bar.
   */
  hit(i: number, power: number, from: THREE.Vector3): { broken: boolean; left: number } {
    const e = this.list[i];
    if (e.broken) return { broken: false, left: 0 };
    e.hits += power;
    // Tip away from whoever struck it.
    const dx = e.pos.x - from.x;
    const dz = e.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    e.axis.set(dz / len, 0, -dx / len);
    if (e.hits >= EFFIGY_HITS - 1e-6) {
      e.broken = true;
      e.collider.active = false;
      e.fallT = 0;
      return { broken: true, left: 0 };
    }
    e.tiltV += 2.6;
    return { broken: false, left: 1 - e.hits / EFFIGY_HITS };
  }

  /** Broken ones are saved by id. */
  brokenIds(): number[] {
    return this.list.filter((e) => e.broken).map((e) => e.id);
  }

  restore(ids: number[]): void {
    for (const id of ids) {
      const e = this.list[id];
      if (!e) continue;
      e.broken = true;
      e.collider.active = false;
      e.root.visible = false;
    }
  }

  /** World position of an effigy's middle (for debris and drops). */
  middle(i: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.list[i];
    return out.copy(e.pos).setY(e.pos.y + 1.2);
  }

  update(dt: number, time: number, player: THREE.Vector3): void {
    for (const e of this.list) {
      if (!e.root.visible) continue;
      const near = Math.hypot(e.pos.x - player.x, e.pos.z - player.z) < 60;
      if (e.fallT >= 0) {
        // Topple: accelerate like a falling pole, thud and settle, then sink into the ground.
        e.fallT += dt;
        const t = e.fallT;
        let ang = Math.min(1.42, 5.2 * t * t);
        if (t > 0.52) ang = 1.42 - Math.abs(Math.sin((t - 0.52) * 14)) * 0.1 * Math.exp(-(t - 0.52) * 7);
        e.root.quaternion.setFromAxisAngle(e.axis, ang);
        if (t > 2.2) e.root.position.y = e.pos.y - (t - 2.2) * 0.45;
        if (t > 3.6) e.root.visible = false;
        continue;
      }
      if (!near) continue;
      // Spring wobble from a blow.
      e.tiltV += (-90 * e.tilt - 7 * e.tiltV) * dt;
      e.tilt += e.tiltV * dt;
      if (Math.abs(e.tilt) > 1e-4 || Math.abs(e.tiltV) > 1e-4) e.root.quaternion.setFromAxisAngle(e.axis, e.tilt * 0.18);
      e.cloth.rotation.x = Math.sin(time * 1.3 + e.phase) * 0.09 + Math.sin(time * 2.9 + e.phase * 2) * 0.03 - e.tilt * 0.4;
      e.cloth.rotation.z = Math.sin(time * 0.9 + e.phase) * 0.04;
    }
    void this.v;
    void this.terrain;
  }
}

/**
 * Effigy spots along the forest trails between landmarks (a few metres to the side of
 * each straight route) and round the cave mouth. Deterministic for a given world.
 */
export function trailSpots(
  terrain: Terrain,
  colliders: ColliderGrid,
  routes: { a: { x: number; z: number }; b: { x: number; z: number }; count: number }[],
  rings: { x: number; z: number; r0: number; r1: number; count: number }[],
  avoid: { x: number; z: number; r: number }[],
  taken: { x: number; z: number }[] = [],
): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const r = mulberry32(4242);
  const ok = (x: number, z: number) => {
    const h = terrain.height(x, z);
    if (h < 1.2 || terrain.isInLake(x, z) || terrain.waterLevelAt(x, z) > h - 0.3) return false;
    if (terrain.slope(x, z) > 0.3) return false;
    if (Math.hypot(x, z) > 300) return false;
    if (avoid.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) return false;
    if ([...taken, ...out].some((c) => Math.hypot(c.x - x, c.z - z) < 26)) return false;
    return colliders.isFree(x, z, 1.1);
  };
  for (const route of routes) {
    let got = 0;
    const dx = route.b.x - route.a.x;
    const dz = route.b.z - route.a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    for (let t = 0.14; t < 0.88 && got < route.count; t += 0.025) {
      const side = (got + Math.round(t * 40)) % 2 ? 1 : -1;
      const off = side * (2.6 + r() * 1.6);
      const px = route.a.x + dx * t;
      const pz = route.a.z + dz * t;
      const x = px + nx * off;
      const z = pz + nz * off;
      if (!ok(x, z)) continue;
      out.push({ x, z, yaw: Math.atan2(px - x, pz - z) });
      got++;
    }
  }
  for (const ring of rings) {
    let got = 0;
    for (let k = 0; k < 60 && got < ring.count; k++) {
      const a = k * 2.399 + 0.7;
      const d = ring.r0 + ((k * 0.37) % 1) * (ring.r1 - ring.r0);
      const x = ring.x + Math.sin(a) * d;
      const z = ring.z + Math.cos(a) * d;
      if (!ok(x, z)) continue;
      out.push({ x, z, yaw: Math.atan2(ring.x - x, ring.z - z) });
      got++;
    }
  }
  return out;
}
