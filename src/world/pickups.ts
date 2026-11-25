import * as THREE from 'three';
import { buildLog, buildPistol } from '../weapons/models';

export type ItemType = 'food' | 'bandage' | 'ammo' | 'cloth' | 'log' | 'rock' | 'pistol';

export const ITEM_LABEL: Record<ItemType, string> = {
  food: 'Comida',
  bandage: 'Curativo',
  ammo: 'Munição',
  cloth: 'Pano',
  log: 'Tora',
  rock: 'Pedra',
  pistol: 'Pistola do Piloto',
};

export interface Pickup {
  type: ItemType;
  pos: THREE.Vector3;
  mesh: THREE.Object3D | null;
  active: boolean;
  amount: number;
  baseY: number;
  phase: number;
  spin: boolean;
  /** Index in Props.smallRocks for instanced stones. */
  rockIndex: number;
}

const m = (color: number, rough = 0.6, metal = 0, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: 0.25 });

function itemMesh(type: ItemType): THREE.Object3D {
  const g = new THREE.Group();
  switch (type) {
    case 'food': {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 14), m(0xc0392b, 0.5, 0.2, 0x3a0d08));
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.015, 14), m(0xbfc3c7, 0.3, 0.9));
      lid.position.y = 0.065;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0715, 0.0715, 0.05, 14), m(0xf2d16b, 0.6));
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.07), m(0x8b5a2b, 0.7, 0, 0x1a0f05));
      bar.position.set(0.12, -0.045, 0.02);
      bar.rotation.y = 0.5;
      g.add(can, lid, label, bar);
      break;
    }
    case 'bandage': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.14), m(0xf3f3f0, 0.6, 0, 0x202020));
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.002, 0.03), m(0xd62828, 0.5));
      c1.position.y = 0.036;
      const c2 = c1.clone();
      c2.rotation.y = Math.PI / 2;
      g.add(box, c1, c2);
      break;
    }
    case 'ammo': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.09), m(0x4f5a32, 0.8, 0, 0x101405));
      g.add(box);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.035, 6), m(0xd4a63a, 0.3, 0.9, 0x2a1d05));
        b.position.set(-0.03 + i * 0.03, 0.055, 0);
        g.add(b);
      }
      break;
    }
    case 'cloth': {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.22), m(0x3b6ea5, 0.95, 0, 0x08131f));
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.2), m(0xd8cfb8, 0.95, 0, 0x1a1810));
      b.position.y = 0.045;
      b.rotation.y = 0.3;
      g.add(a, b);
      break;
    }
    case 'pistol': {
      const p = buildPistol();
      p.rotation.set(0, 0.6, Math.PI / 2);
      p.scale.setScalar(1.4);
      g.add(p);
      break;
    }
    case 'log': {
      const log = buildLog(1.6, 0.2);
      log.rotation.z = Math.PI / 2;
      log.castShadow = true;
      g.add(log);
      break;
    }
    case 'rock':
      break;
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** Ground items the player collects with [E]. */
export class PickupManager {
  readonly items: Pickup[] = [];
  readonly group = new THREE.Group();
  private tmp = new THREE.Vector3();
  highlighted: Pickup | null = null;

  add(type: ItemType, pos: THREE.Vector3, amount = 1, rotY = Math.random() * Math.PI * 2): Pickup {
    const mesh = itemMesh(type);
    const spin = type !== 'log';
    const baseY = pos.y + (type === 'log' ? 0.2 : 0.12);
    mesh.position.set(pos.x, baseY, pos.z);
    mesh.rotation.y = rotY;
    this.group.add(mesh);
    const p: Pickup = { type, pos: new THREE.Vector3(pos.x, baseY, pos.z), mesh, active: true, amount, baseY, phase: Math.random() * 6, spin, rockIndex: -1 };
    this.items.push(p);
    return p;
  }

  addRock(index: number, x: number, y: number, z: number): void {
    this.items.push({ type: 'rock', pos: new THREE.Vector3(x, y, z), mesh: null, active: true, amount: 1, baseY: y, phase: 0, spin: false, rockIndex: index });
  }

  remove(p: Pickup): void {
    p.active = false;
    if (p.mesh) this.group.remove(p.mesh);
    const i = this.items.indexOf(p);
    if (i >= 0) this.items.splice(i, 1);
    if (this.highlighted === p) this.highlighted = null;
  }

  /** Item under the reticle (or right at the player's feet). */
  findTarget(eye: THREE.Vector3, forward: THREE.Vector3, feet: THREE.Vector3): Pickup | null {
    let best: Pickup | null = null;
    let bestScore = Infinity;
    for (const p of this.items) {
      if (!p.active) continue;
      const dx = p.pos.x - feet.x;
      const dz = p.pos.z - feet.z;
      const flat = Math.hypot(dx, dz);
      if (flat > 3.4) continue;
      this.tmp.copy(p.pos).sub(eye);
      const dist = this.tmp.length();
      const dot = this.tmp.dot(forward) / Math.max(dist, 1e-4);
      const reach = p.type === 'log' ? 3.2 : 2.8;
      const ok = (dist < reach && dot > 0.86) || flat < 0.9;
      if (!ok) continue;
      const score = dist * (2 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  update(time: number): void {
    for (const p of this.items) {
      if (!p.mesh || !p.spin) continue;
      const hl = p === this.highlighted;
      p.mesh.position.y = p.baseY + Math.sin(time * 2 + p.phase) * 0.03 + (hl ? 0.05 : 0);
      p.mesh.rotation.y = p.phase + time * 0.5;
    }
  }
}
