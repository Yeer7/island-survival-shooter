import * as THREE from 'three';
import { buildLog, logMaterials } from '../weapons/models';
import { gridGeometry } from './airliner';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';
import { detailTextures } from './textures';
import { Water } from './water';

export const BOAT_COST = { logs: 15, sticks: 10, cloth: 8, heart: 1 };

interface Part {
  mesh: THREE.Mesh;
  solid: THREE.Material | THREE.Material[];
}

/** Hull lines: stern at x = -3.75, the bow stem at x = 4.8. */
const STERN = -3.75;
const STEM = 4.8;
function hullWidth(x: number): number {
  const t = THREE.MathUtils.clamp((x - STERN) / (STEM - STERN), 0, 1);
  return 1.12 * (1 - Math.pow(Math.max(0, (t - 0.5) / 0.5), 1.7)) * (0.86 + 0.14 * Math.min(1, t / 0.3));
}
function hullDepth(x: number): number {
  const t = THREE.MathUtils.clamp((x - STERN) / (STEM - STERN), 0, 1);
  return 1.05 * (1 - 0.6 * Math.pow(Math.max(0, (t - 0.6) / 0.4), 2));
}
/** Gunwale height: the sheer line sweeps up towards the bow. */
function sheer(x: number): number {
  const t = THREE.MathUtils.clamp((x - STERN) / (STEM - STERN), 0, 1);
  return 0.4 + 0.38 * Math.pow(t, 3);
}

const ghost = new THREE.MeshStandardMaterial({ color: 0x6fb6ff, emissive: 0x2a6cff, emissiveIntensity: 0.35, transparent: true, opacity: 0.3, depthWrite: false });

/**
 * The escape sailboat, damaged and anchored in the shallows of the southern beach.
 * Hull, deck, mast, sail and rudder show as a blue blueprint and fill in as the
 * player delivers logs, sticks, cloth and the Alpha Heart. A ladder on the stern
 * lets a swimmer reach it.
 */
export class Sailboat {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly delivered = { logs: 0, sticks: 0, cloth: 0, heart: 0 };
  private parts: Part[] = [];
  private bobT = 0;
  complete = false;
  private lanternGlass: THREE.MeshStandardMaterial | null = null;

  constructor(terrain: Terrain, colliders: ColliderGrid) {
    // Shallow water (about 1.2-2 m deep) straight off the middle of the southern beach.
    let spot = { x: 0, z: 240 };
    for (let t = 120; t < 330; t += 1) {
      const h = terrain.height(0, t);
      if (h < -1.3) {
        spot = { x: 0, z: t + 2 };
        break;
      }
    }
    this.pos.set(spot.x, 0, spot.z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.PI / 2 + 0.25;

    const tex = detailTextures();
    const hullMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x7a5434).multiplyScalar(1.25), roughness: 0.85, map: tex.plank });
    const deckMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xa07a50).multiplyScalar(1.25), roughness: 0.85, map: tex.plank });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xeee6d2, roughness: 0.95, side: THREE.DoubleSide });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 });
    const add = (mesh: THREE.Mesh, solid: THREE.Material | THREE.Material[]) => {
      mesh.material = ghost;
      this.group.add(mesh);
      this.parts.push({ mesh, solid });
    };

    // Hull: one continuous planked shell from the transom to a fine bow stem, in three
    // sections that fill in one after another.
    const L = 7.5;
    const hullSection = (x0: number, x1: number) =>
      gridGeometry(Math.max(4, Math.round((x1 - x0) / 0.25)), 14, (i, j) => {
        const n = Math.max(4, Math.round((x1 - x0) / 0.25));
        const x = x0 + ((x1 - x0) * i) / n;
        const phi = -Math.PI / 2 + (Math.PI * j) / 14;
        const w = hullWidth(x);
        const top = sheer(x);
        const bottom = 0.38 - hullDepth(x);
        const sn = Math.sin(phi);
        const y = top - (top - bottom) * Math.pow(Math.cos(phi), 0.75);
        const z = w * Math.sign(sn) * Math.pow(Math.abs(sn), 0.55);
        return { p: new THREE.Vector3(x, y, z), u: x / 1.6, v: (phi + Math.PI / 2) * 1.4, c: 1 };
      });
    const hullSide = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x7a5434).multiplyScalar(1.25), roughness: 0.85, map: tex.plank, side: THREE.DoubleSide });
    for (const [x0, x1] of [
      [STERN, -0.9],
      [-0.9, 2.0],
      [2.0, STEM],
    ]) {
      add(new THREE.Mesh(hullSection(x0, x1), hullSide), hullSide);
    }
    // Rubbing strake along the gunwale.
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let x = STERN; x <= STEM + 1e-6; x += 0.35) pts.push(new THREE.Vector3(x, sheer(x) + 0.03, side * hullWidth(x)));
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.05, 6, false), deckMat), deckMat);
    }
    const keel = new THREE.Mesh(new THREE.BoxGeometry(L, 0.25, 0.3), hullMat);
    keel.position.set(0.3, -0.72, 0);
    add(keel, hullMat);
    const transom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, hullWidth(STERN) * 2), hullMat);
    transom.position.set(STERN, -0.12, 0);
    add(transom, hullMat);
    // Deck boards.
    for (let i = 0; i < 12; i++) {
      const x = -L / 2 + 0.4 + i * 0.58;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, Math.max(0.6, 2 * (Math.min(hullWidth(x - 0.27), hullWidth(x + 0.27)) - 0.06))), deckMat);
      b.position.set(x, 0.32, 0);
      add(b, deckMat);
    }
    // Bench across the stern cockpit and a small cuddy cabin over the bow.
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 1.7), deckMat);
    bench.position.set(-2.55, 0.72, 0);
    add(bench, deckMat);
    for (const z of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.08), hullMat);
      leg.position.set(-2.55, 0.52, z);
      add(leg, hullMat);
    }
    const cuddy = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.2), hullMat);
    cuddy.position.set(3.55, 0.6, 0);
    add(cuddy, hullMat);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.07, 1.35), deckMat);
    roof.position.set(3.55, 0.88, 0);
    add(roof, deckMat);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.5), deckMat);
    hatch.position.set(2.99, 0.6, 0);
    add(hatch, deckMat);
    // Mast, boom and sail.
    const mast = buildLog(6.5, 0.1);
    mast.position.set(0.6, 3.5, 0);
    add(mast, logMaterials());
    const boom = buildLog(3.6, 0.07);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(-1.1, 1.3, 0);
    add(boom, logMaterials());
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(-3.4, 0);
    sailShape.quadraticCurveTo(-1.6, 2.6, 0, 5.2);
    sailShape.lineTo(0, 0);
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
    sail.position.set(0.55, 1.4, 0.02);
    add(sail, sailMat);
    for (const z of [-0.9, 0.9]) {
      const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 6.6, 4), ropeMat);
      stay.position.set(1.8, 3.4, z * 0.6);
      stay.rotation.set(z * 0.12, 0, 0.38);
      add(stay, ropeMat);
    }
    // Rudder and tiller.
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.6), hullMat);
    rudder.position.set(-L / 2 - 0.2, -0.4, 0);
    add(rudder, hullMat);
    // Helm: a spoked wheel on a short pedestal.
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), hullMat);
    pedestal.position.set(-1.75, 0.72, 0);
    add(pedestal, hullMat);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 24), deckMat);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(-1.88, 1.15, 0);
    add(wheel, deckMat);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.08, 5), deckMat);
      spoke.position.set(-1.9, 1.15, 0);
      spoke.rotation.x = a;
      add(spoke, deckMat);
    }
    // Bow lantern: lit once the boat is ready to sail.
    const lpost = buildLog(0.9, 0.035);
    lpost.position.set(4.25, sheer(4.25) + 0.45, 0);
    add(lpost, logMaterials());
    this.lanternGlass = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.3 });
    const glassMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8), this.lanternGlass);
    glassMesh.position.set(4.25, sheer(4.25) + 1.0, 0);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.5, roughness: 0.5 }));
    cage.position.set(4.25, sheer(4.25) + 1.15, 0);
    this.group.add(glassMesh, cage);

    // Boarding ladder on the stern (always solid: it is how you climb aboard).
    const ladder = new THREE.Group();
    for (const z of [-0.25, 0.25]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.05), ropeMat);
      rail.position.set(-L / 2 - 0.12, -0.4, z + 0.5);
      ladder.add(rail);
    }
    for (let i = 0; i < 5; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.5), ropeMat);
      rung.position.set(-L / 2 - 0.12, -1.0 + i * 0.3, 0.5);
      ladder.add(rung);
    }
    this.group.add(ladder);
    this.refresh();

    // Colliders along the hull so a swimmer goes around it. Their top sits below the
    // lowest point the bobbing deck reaches, so someone standing on deck is never pushed off.
    const yaw = this.group.rotation.y;
    for (let x = -L / 2; x <= STEM - 0.4; x += 1.2) {
      const wx = this.pos.x + Math.cos(yaw) * x;
      const wz = this.pos.z - Math.sin(yaw) * x;
      colliders.add({ x: wx, z: wz, r: 1.0, y0: -3, y1: -0.35, kind: 'rock', ref: 0 });
    }
  }

  get progress(): number {
    const d = this.delivered;
    const c = BOAT_COST;
    return (Math.min(d.logs, c.logs) * 2 + Math.min(d.sticks, c.sticks) + Math.min(d.cloth, c.cloth) * 1.5 + Math.min(d.heart, c.heart) * 6) / (c.logs * 2 + c.sticks + c.cloth * 1.5 + c.heart * 6);
  }

  deliver(have: { logs: number; sticks: number; cloth: number; heart: number }): { logs: number; sticks: number; cloth: number; heart: number } {
    const take = {
      logs: Math.min(have.logs, BOAT_COST.logs - this.delivered.logs),
      sticks: Math.min(have.sticks, BOAT_COST.sticks - this.delivered.sticks),
      cloth: Math.min(have.cloth, BOAT_COST.cloth - this.delivered.cloth),
      heart: Math.min(have.heart, BOAT_COST.heart - this.delivered.heart),
    };
    this.delivered.logs += take.logs;
    this.delivered.sticks += take.sticks;
    this.delivered.cloth += take.cloth;
    this.delivered.heart += take.heart;
    this.refresh();
    return take;
  }

  refresh(): void {
    const n = Math.floor(this.progress * this.parts.length + 1e-6);
    this.parts.forEach((p, i) => {
      const solid = i < n;
      p.mesh.material = solid ? p.solid : ghost;
      p.mesh.castShadow = solid;
    });
    this.complete = this.progress >= 1;
    if (this.lanternGlass) this.lanternGlass.emissiveIntensity = this.complete ? 3 : 0;
  }

  /** Deck height when (x, z) is over the deck boards, else null (walkable planks). */
  deckAt(x: number, z: number): number | null {
    const yaw = this.group.rotation.y;
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) < 3.6 && Math.abs(lz) < 0.85) return this.group.position.y + 0.36;
    return null;
  }

  /** World point at the top of the stern ladder (where a swimmer climbs aboard). */
  sternDeck(out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.group.rotation.y;
    const lx = -3.0;
    return out.set(this.pos.x + lx * Math.cos(yaw), this.group.position.y + 0.36, this.pos.z - lx * Math.sin(yaw));
  }

  update(dt: number, time: number): void {
    this.bobT += dt;
    const wave = Water.oceanOffset(this.pos.x, this.pos.z, time);
    this.group.position.y = wave * 0.8 + 0.15;
    this.group.rotation.z = Math.sin(this.bobT * 0.9) * 0.03;
    this.group.rotation.x = Math.sin(this.bobT * 0.7 + 1) * 0.02;
  }
}
