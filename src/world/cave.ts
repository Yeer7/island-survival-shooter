import * as THREE from 'three';
import { AssetLibrary, AssetName } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { buildLog } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';
import { detailTextures } from './textures';

/** Interior space, far outside the island so it never shows from the surface. */
export const CAVE_ORIGIN = new THREE.Vector3(1900, 0, 0);
const HALF_W = 4.2;
const LENGTH = 74;
/** Chasm spanned by the broken bridge, in metres along the tunnel (negative Z). */
const CHASM_START = 30;
const CHASM_END = 39;

/**
 * The north cave. Outside: a mouth set into a wall of big rocks on the northern
 * range, in a rocky arena guarded by the Cave Guardian. Inside: a dark tunnel with
 * stalactites, a broken bridge over a chasm, and a ledge with the tactical
 * flashlight and backpack.
 */
export class Cave {
  readonly outside = new THREE.Group();
  readonly inside = new THREE.Group();
  readonly mouth = new THREE.Vector3();
  readonly arena = new THREE.Vector3();
  /** Where the player stands right after entering / leaving. */
  readonly entryInside = new THREE.Vector3();
  readonly exitOutside = new THREE.Vector3();
  readonly bridgePos = new THREE.Vector3();
  readonly lootPos = new THREE.Vector3();
  readonly backpackPos = new THREE.Vector3();
  bridgeRepaired = false;
  private bridgeDeck: THREE.Group;
  private facing: number;

  constructor(private terrain: Terrain, colliders: ColliderGrid, lib: AssetLibrary) {
    // Highest open ground on the northern range, away from the coast.
    let best = { x: 0, z: -170, score: -Infinity };
    for (let x = -150; x <= 150; x += 8) {
      for (let z = -215; z <= -140; z += 6) {
        if (terrain.coastDistance(x, z) < 22) continue;
        const h = terrain.height(x, z);
        const slope = terrain.slope(x, z);
        const score = h - slope * 40 - Math.abs(x) * 0.03;
        if (score > best.score) best = { x, z, score };
      }
    }
    // The mouth faces the island's centre; the arena opens in front of it.
    this.facing = Math.atan2(-best.x, -best.z);
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    this.mouth.set(best.x, terrain.height(best.x, best.z), best.z);
    this.arena.set(best.x + fx * 14, 0, best.z + fz * 14);
    this.arena.y = terrain.height(this.arena.x, this.arena.z);
    this.exitOutside.set(best.x + fx * 6, 0, best.z + fz * 6);
    this.exitOutside.y = terrain.height(this.exitOutside.x, this.exitOutside.z);

    this.buildOutside(lib, colliders, fx, fz);
    this.bridgeDeck = new THREE.Group();
    this.buildInside(lib);
    this.entryInside.set(CAVE_ORIGIN.x, 0, CAVE_ORIGIN.z - 3);
  }

  private buildOutside(lib: AssetLibrary, colliders: ColliderGrid, fx: number, fz: number): void {
    const rand = mulberry32(51);
    const rx = fz;
    const rz = -fx;
    const tex = detailTextures();
    const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8e8b84).multiplyScalar(1.2), roughness: 0.93, map: tex.rock, bumpMap: tex.rockBump, bumpScale: 3, flatShading: true });
    const rockAt = (name: AssetName, side: number, back: number, size: number, up: number) => {
      const r = lib.instance(name, { by: 'footprint', value: size });
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = stone;
          m.castShadow = m.receiveShadow = true;
        }
      });
      const x = this.mouth.x + rx * side - fx * back;
      const z = this.mouth.z + rz * side - fz * back;
      const g = Math.min(this.terrain.height(x, z), this.terrain.height(x + 2, z), this.terrain.height(x - 2, z), this.terrain.height(x, z + 2), this.terrain.height(x, z - 2));
      r.position.set(x, g - size * 0.25 + up, z);
      r.rotation.y = rand() * Math.PI * 2;
      this.outside.add(r);
      colliders.add({ x, z, r: size * 0.42, y0: g - 2, y1: g + size, kind: 'rock', ref: 0 });
    };
    // A wall of big rocks with a gap for the mouth, and one across the top.
    for (const [side, back, size] of [
      [-5.5, 1, 7],
      [5.5, 1, 7],
      [-11, 3, 8],
      [11, 3, 8],
      [-16, 6, 7],
      [16, 6, 7],
      [0, 6, 9],
    ]) {
      rockAt(rand() < 0.5 ? 'rockCliff' : 'rockLarge', side, back, size, 0);
    }
    rockAt('rockCliff', 0, 2.4, 7.5, 3.6);

    // The dark mouth: a half-tunnel lined inside, closing to black.
    const dark = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 1, side: THREE.BackSide });
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 7, 16, 1, true, -Math.PI / 2, Math.PI), dark);
    tunnel.rotation.x = Math.PI / 2;
    tunnel.rotation.z = Math.PI / 2;
    const group = new THREE.Group();
    group.position.set(this.mouth.x - fx * 2.5, this.mouth.y, this.mouth.z - fz * 2.5);
    group.rotation.y = this.facing;
    tunnel.rotation.set(Math.PI / 2, 0, 0);
    tunnel.position.y = 0;
    const back = new THREE.Mesh(new THREE.CircleGeometry(2.7, 16), new THREE.MeshBasicMaterial({ color: 0x020304 }));
    back.position.set(0, 0.2, -3.2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 7), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.05;
    group.add(tunnel, back, floor);
    // Bones scattered in front: a warning.
    const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });
    for (let k = 0; k < 7; k++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.45, 6), bone);
      b.rotation.set(Math.PI / 2, rand() * 6, 0);
      b.position.set((rand() - 0.5) * 4, 0.05, 3 + rand() * 4);
      group.add(b);
    }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bone);
    skull.position.set(1.2, 0.14, 4.2);
    group.add(skull);
    this.outside.add(group);
  }

  private buildInside(lib: AssetLibrary): void {
    const o = CAVE_ORIGIN;
    const tex = detailTextures();
    const rockTex = tex.rock.clone();
    rockTex.repeat.set(6, 20);
    rockTex.needsUpdate = true;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5c5f66, roughness: 0.95, map: rockTex, side: THREE.BackSide, flatShading: true });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x4a4844, roughness: 1, map: rockTex, flatShading: true });
    const rand = mulberry32(77);

    // Tunnel shell: a squashed, lumpy cylinder along -Z.
    const shell = new THREE.CylinderGeometry(HALF_W + 1.2, HALF_W + 1.2, LENGTH + 6, 18, 30, true);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rand() - 0.5) * 0.22;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k * 0.9);
    }
    shell.computeVertexNormals();
    shell.rotateX(Math.PI / 2);
    const tube = new THREE.Mesh(shell, wallMat);
    tube.position.set(o.x, 3.2, o.z - LENGTH / 2);
    tube.receiveShadow = true;
    this.inside.add(tube);
    for (const zEnd of [o.z + 3, o.z - LENGTH - 3]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(HALF_W + 1.6, 18), new THREE.MeshStandardMaterial({ color: 0x3d3f44, roughness: 1, side: THREE.DoubleSide }));
      cap.position.set(o.x, 3.2, zEnd);
      this.inside.add(cap);
    }

    // Floor before and after the chasm.
    const before = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 1, 1, CHASM_START + 3), floorMat);
    before.position.set(o.x, -0.5, o.z - (CHASM_START - 3) / 2);
    const after = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 1, 1, LENGTH - CHASM_END + 3), floorMat);
    after.position.set(o.x, -0.5, o.z - CHASM_END - (LENGTH - CHASM_END - 3) / 2);
    before.receiveShadow = after.receiveShadow = true;
    this.inside.add(before, after);
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 2, CHASM_END - CHASM_START), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(o.x, -18, o.z - (CHASM_START + CHASM_END) / 2);
    this.inside.add(pit);

    // Stalactites and stalagmites.
    const spike = new THREE.MeshStandardMaterial({ color: 0x6a6c72, roughness: 0.9, flatShading: true });
    for (let k = 0; k < 70; k++) {
      const z = o.z - rand() * LENGTH;
      const x = o.x + (rand() - 0.5) * HALF_W * 2;
      const h = 0.6 + rand() * 2.2;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.15 + rand() * 0.25, h, 6), spike);
      if (k % 3 === 0 && (z > o.z - CHASM_START + 1 || z < o.z - CHASM_END - 1) && Math.abs(x - o.x) > 1.6) {
        c.position.set(x, h / 2, z);
      } else {
        c.rotation.x = Math.PI;
        c.position.set(x, 6.1 - h / 2, z);
      }
      this.inside.add(c);
    }

    // Broken bridge: stubs on both sides of the chasm; the deck appears when repaired.
    const plank = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.2), roughness: 0.9, map: tex.plank });
    const stub = (z0: number, len: number) => {
      for (let i = 0; i < len / 0.45; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.38), plank);
        b.position.set(o.x + (rand() - 0.5) * 0.06, -0.02, o.z - z0 - i * 0.45);
        b.rotation.z = (rand() - 0.5) * 0.05;
        this.inside.add(b);
      }
    };
    stub(CHASM_START - 0.2, 1.4);
    stub(CHASM_END - 1.2, 1.4);
    for (let i = 0; i < (CHASM_END - CHASM_START) / 0.45; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.38), plank);
      b.position.set(o.x, -0.02, o.z - CHASM_START - i * 0.45);
      this.bridgeDeck.add(b);
    }
    for (const side of [-1, 1]) {
      const rail = buildLog(CHASM_END - CHASM_START + 2, 0.05);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(o.x + side * 1.15, 0.8, o.z - (CHASM_START + CHASM_END) / 2);
      this.bridgeDeck.add(rail);
    }
    this.bridgeDeck.visible = false;
    this.inside.add(this.bridgeDeck);
    this.bridgePos.set(o.x, 0, o.z - CHASM_START + 1.2);

    // Ledge with the loot at the far end.
    this.lootPos.set(o.x - 1.4, 0, o.z - LENGTH + 6);
    this.backpackPos.set(o.x + 1.4, 0, o.z - LENGTH + 6);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 2.2), floorMat);
    ledge.position.set(o.x, 0.25 - 0.25, o.z - LENGTH + 6);
    this.inside.add(ledge);
    void lib;
  }

  setBridge(repaired: boolean): void {
    this.bridgeRepaired = repaired;
    this.bridgeDeck.visible = repaired;
  }

  /** Floor height inside the tunnel (the chasm drops away until the bridge is fixed). */
  groundAt(x: number, z: number): number {
    const along = CAVE_ORIGIN.z - z;
    if (along > CHASM_START && along < CHASM_END && !this.bridgeRepaired) return -30;
    if (along > CHASM_START && along < CHASM_END && Math.abs(x - CAVE_ORIGIN.x) > 1.1) return -30;
    return 0;
  }

  /** Keep the player inside the tunnel walls. */
  clamp(p: THREE.Vector3): void {
    p.x = Math.min(CAVE_ORIGIN.x + HALF_W - 0.4, Math.max(CAVE_ORIGIN.x - HALF_W + 0.4, p.x));
    p.z = Math.min(CAVE_ORIGIN.z + 1.5, Math.max(CAVE_ORIGIN.z - LENGTH + 2, p.z));
  }

  isInside(p: THREE.Vector3): boolean {
    return Math.abs(p.x - CAVE_ORIGIN.x) < 50;
  }
}

/** The east altar: standing stones round a slab, braziers and bones. Lair of the Alpha Beast. */
export class Altar {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly radius = 20;

  constructor(terrain: Terrain, colliders: ColliderGrid, lib: AssetLibrary) {
    let best = { x: 180, z: 0, score: Infinity };
    for (let x = 140; x <= 215; x += 6) {
      for (let z = -70; z <= 70; z += 6) {
        if (terrain.coastDistance(x, z) < 28) continue;
        const h = terrain.height(x, z);
        if (h < 3) continue;
        let rough = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          rough += Math.abs(terrain.height(x + Math.cos(a) * 12, z + Math.sin(a) * 12) - h);
        }
        const score = rough + Math.abs(z) * 0.02;
        if (score < best.score) best = { x, z, score };
      }
    }
    this.center.set(best.x, terrain.height(best.x, best.z), best.z);
    const tex = detailTextures();
    const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x76736d).multiplyScalar(1.15), roughness: 0.93, map: tex.rock, bumpMap: tex.rockBump, bumpScale: 3, flatShading: true });
    const rand = mulberry32(303);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const x = this.center.x + Math.cos(a) * 11;
      const z = this.center.z + Math.sin(a) * 11;
      const r = lib.instance('rockTall', { by: 'height', value: 3.6 + rand() * 1.4 });
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = stone;
          m.castShadow = m.receiveShadow = true;
        }
      });
      const g = Math.min(terrain.height(x, z), terrain.height(x + 1, z), terrain.height(x - 1, z), terrain.height(x, z + 1), terrain.height(x, z - 1));
      r.position.set(x, g - 0.6, z);
      r.rotation.y = rand() * Math.PI * 2;
      this.group.add(r);
      colliders.add({ x, z, r: 0.9, y0: g - 1, y1: g + 4, kind: 'rock', ref: 0 });
    }
    // Slab altar with offerings.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.8), stone);
    slab.position.set(this.center.x, this.center.y + 0.3, this.center.z);
    slab.castShadow = slab.receiveShadow = true;
    this.group.add(slab);
    colliders.add({ x: this.center.x, z: this.center.z, r: 1.5, y0: this.center.y - 1, y1: this.center.y + 0.8, kind: 'rock', ref: 0 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), bone);
      s.position.set(this.center.x - 1.1 + k * 0.7, this.center.y + 0.88, this.center.z + (rand() - 0.5) * 0.6);
      this.group.add(s);
    }
    const ember = new THREE.MeshStandardMaterial({ color: 0x2a0a04, emissive: 0xff4a10, emissiveIntensity: 1.6 });
    for (const side of [-1, 1]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.35, 10), stone);
      const x = this.center.x + side * 3;
      const y = terrain.height(x, this.center.z);
      bowl.position.set(x, y + 0.9, this.center.z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), stone);
      leg.position.set(x, y + 0.4, this.center.z);
      const coals = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), ember);
      coals.position.set(x, y + 1.0, this.center.z);
      this.group.add(bowl, leg, coals);
    }
  }
}
