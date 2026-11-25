import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { Suitcase } from './landmarks';
import { ItemType } from './pickups';
import { Terrain } from './terrain';
import { detailTextures } from './textures';

/**
 * Life on the southern beach: barrels and crates washed ashore (break them like the
 * luggage), shells, driftwood logs and loose pebbles to pick up.
 */
export class Beach {
  readonly group = new THREE.Group();
  readonly breakables: Suitcase[] = [];
  readonly driftwood: { x: number; y: number; z: number; rotY: number }[] = [];
  readonly pebbles: THREE.Vector3[] = [];

  constructor(private terrain: Terrain, avoid: { x: number; z: number; r: number }[]) {
    const rand = mulberry32(2024);
    const spot = (minCoast: number, maxCoast: number): THREE.Vector3 | null => {
      for (let k = 0; k < 200; k++) {
        const a = Math.PI * (0.1 + rand() * 0.8);
        const r = terrain.islandRadius(Math.cos(a), Math.sin(a)) * (0.86 + rand() * 0.1);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (z < 35) continue;
        const cd = terrain.coastDistance(x, z);
        const h = terrain.height(x, z);
        const surf = terrain.surfaceAt(x, z);
        if (cd < minCoast || cd > maxCoast || h < 0.12 || surf === 'water' || surf === 'grass') continue;
        if (avoid.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
        return new THREE.Vector3(x, h, z);
      }
      return null;
    };

    const tex = detailTextures();
    const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.25), roughness: 0.9, map: tex.plank });
    const band = new THREE.MeshStandardMaterial({ color: 0x3d3a36, roughness: 0.6, metalness: 0.2 });
    const loot: ItemType[][] = [
      ['cloth', 'food'],
      ['bandage'],
      ['food', 'cloth'],
      ['cloth'],
      ['food', 'bandage'],
      ['cloth', 'cloth'],
      ['food'],
      ['bandage', 'cloth'],
    ];
    loot.forEach((contents, i) => {
      const p = spot(1, 18);
      if (!p) return;
      const g = new THREE.Group();
      const barrel = i % 2 === 0;
      if (barrel) {
        // Barrel lying on its side, half sunk in the sand.
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 14), wood);
        body.rotation.z = Math.PI / 2;
        body.position.y = 0.22;
        body.castShadow = true;
        g.add(body);
        for (const x of [-0.28, 0, 0.28]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.02, 4, 16), band);
          ring.rotation.y = Math.PI / 2;
          ring.position.set(x, 0.22, 0);
          g.add(ring);
        }
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.55), wood);
        box.position.y = 0.2;
        box.rotation.set(0.12, 0, 0.08);
        box.castShadow = true;
        g.add(box);
      }
      g.position.set(p.x, p.y - 0.05, p.z);
      g.rotation.y = rand() * Math.PI * 2;
      this.breakables.push({ mesh: g, pos: new THREE.Vector3(p.x, p.y + 0.22, p.z), hp: 50, color: 0x8a6440, contents, broken: false });
    });

    // Shells scattered near the waterline (one draw).
    const shellGeo = new THREE.ConeGeometry(0.06, 0.05, 7, 1, true);
    shellGeo.rotateX(Math.PI);
    shellGeo.scale(1, 1, 1.3);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xf3e6d3, roughness: 0.5, side: THREE.DoubleSide });
    const shells = new THREE.InstancedMesh(shellGeo, shellMat, 90);
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    let n = 0;
    for (let k = 0; k < 90; k++) {
      const p = spot(0, 14);
      if (!p) continue;
      d.position.set(p.x, p.y + 0.01, p.z);
      d.rotation.set(0, rand() * 6, 0);
      d.scale.setScalar(0.7 + rand() * 0.8);
      d.updateMatrix();
      shells.setMatrixAt(n, d.matrix);
      shells.setColorAt(n, col.setHSL(0.06 + rand() * 0.05, 0.4, 0.75 + rand() * 0.15));
      n++;
    }
    shells.count = n;
    shells.receiveShadow = true;
    this.group.add(shells);

    for (let k = 0; k < 7; k++) {
      const p = spot(2, 20);
      if (p) this.driftwood.push({ x: p.x, y: p.y, z: p.z, rotY: rand() * Math.PI });
    }
    for (let k = 0; k < 16; k++) {
      const p = spot(0, 22);
      if (p) this.pebbles.push(p);
    }
  }
}
