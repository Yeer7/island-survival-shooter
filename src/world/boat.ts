import * as THREE from 'three';
import { buildLog, logMaterials } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';
import { detailTextures } from './textures';
import { Water } from './water';

export const BOAT_COST = { logs: 15, sticks: 10, cloth: 8, heart: 1 };

interface Part {
  mesh: THREE.Mesh;
  solid: THREE.Material | THREE.Material[];
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

    // Hull: planks along each side (bow at +X), keel and transom.
    const L = 7.5;
    for (let row = 0; row < 4; row++) {
      for (const side of [-1, 1]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(L - row * 0.5, 0.28, 0.08), hullMat);
        plank.position.set(-row * 0.12, -0.55 + row * 0.27, side * (0.7 + row * 0.18));
        plank.rotation.x = side * (0.5 - row * 0.1);
        add(plank, hullMat);
      }
    }
    const keel = new THREE.Mesh(new THREE.BoxGeometry(L, 0.25, 0.5), hullMat);
    keel.position.y = -0.75;
    add(keel, hullMat);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.6, 4), hullMat);
    bow.rotation.z = -Math.PI / 2;
    bow.rotation.x = Math.PI / 4;
    bow.scale.set(1, 1, 0.7);
    bow.position.set(L / 2 + 0.6, -0.15, 0);
    add(bow, hullMat);
    const transom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 2.1), hullMat);
    transom.position.set(-L / 2, -0.1, 0);
    add(transom, hullMat);
    // Deck boards.
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 1.9 - Math.abs(i - 5.5) * 0.05), deckMat);
      b.position.set(-L / 2 + 0.4 + i * 0.58, 0.32, 0);
      add(b, deckMat);
    }
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
    const tiller = buildLog(1.4, 0.04);
    tiller.rotation.z = Math.PI / 2;
    tiller.position.set(-L / 2 + 0.5, 0.65, 0);
    add(tiller, logMaterials());

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

    // Colliders along the hull so a swimmer goes around it.
    const yaw = this.group.rotation.y;
    for (let x = -L / 2; x <= L / 2 + 1; x += 1.2) {
      const wx = this.pos.x + Math.cos(yaw) * x;
      const wz = this.pos.z - Math.sin(yaw) * x;
      colliders.add({ x: wx, z: wz, r: 1.0, y0: -3, y1: 6, kind: 'rock', ref: 0 });
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
  }

  update(dt: number, time: number): void {
    this.bobT += dt;
    const wave = Water.oceanOffset(this.pos.x, this.pos.z, time);
    this.group.position.y = wave * 0.8 + 0.15;
    this.group.rotation.z = Math.sin(this.bobT * 0.9) * 0.03;
    this.group.rotation.x = Math.sin(this.bobT * 0.7 + 1) * 0.02;
  }
}
