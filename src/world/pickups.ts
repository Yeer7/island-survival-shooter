import * as THREE from 'three';
import { library } from '../assets/assets';
import { buildArrow, buildHide, buildLog, buildMeat, buildSticks, buildTotem } from '../weapons/models';

export type ItemType = 'food' | 'bandage' | 'cloth' | 'stick' | 'log' | 'rock' | 'meat' | 'hide' | 'arrow' | 'totem';

export const ITEM_LABEL: Record<ItemType, string> = {
  food: 'Comida',
  bandage: 'Curativo',
  cloth: 'Pano',
  stick: 'Gravetos',
  log: 'Tora',
  rock: 'Pedra',
  meat: 'Carne Crua',
  hide: 'Pele Animal',
  arrow: 'Flecha',
  totem: 'Totem Tribal',
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
  /** Index into Props.smallRocks / smallSticks for instanced ground items. */
  instIndex: number;
}

const m = (color: number, rough = 0.6, metal = 0, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: 0.25 });

function itemMesh(type: ItemType): THREE.Object3D {
  const g = new THREE.Group();
  switch (type) {
    case 'totem':
      g.add(buildTotem());
      break;
    case 'food': {
      const lib = library();
      if (lib?.has('can')) {
        g.add(lib.instance('can', { by: 'height', value: 0.13 }));
        break;
      }
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
      const lib = library();
      if (lib?.has('firstAid')) {
        g.add(lib.instance('firstAid', { by: 'footprint', value: 0.3 }));
        break;
      }
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.14), m(0xf3f3f0, 0.6, 0, 0x202020));
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.002, 0.03), m(0xd62828, 0.5));
      c1.position.y = 0.036;
      const c2 = c1.clone();
      c2.rotation.y = Math.PI / 2;
      g.add(box, c1, c2);
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
    case 'stick':
      g.add(buildSticks());
      break;
    case 'meat':
      g.add(buildMeat(false));
      break;
    case 'hide':
      g.add(buildHide());
      break;
    case 'arrow':
      g.add(buildArrow());
      break;
    case 'log': {
      const log = buildLog(1.6, 0.2);
      log.rotation.z = Math.PI / 2;
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
    // Every drop rests on the ground: its lowest point sits on the terrain, no floating.
    const still = type !== 'totem';
    mesh.rotation.y = rotY;
    mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(mesh);
    const baseY = pos.y - bb.min.y + (type === 'totem' ? 0.08 : 0.005);
    mesh.position.set(pos.x, baseY, pos.z);
    this.group.add(mesh);
    const p: Pickup = { type, pos: new THREE.Vector3(pos.x, baseY, pos.z), mesh, active: true, amount, baseY, phase: Math.random() * 6, spin: !still, instIndex: -1 };
    this.items.push(p);
    return p;
  }

  /** An arrow stuck where it landed, keeping its flight orientation. */
  addArrow(pos: THREE.Vector3, quat: THREE.Quaternion): Pickup {
    const mesh = itemMesh('arrow');
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    this.group.add(mesh);
    const p: Pickup = { type: 'arrow', pos: pos.clone(), mesh, active: true, amount: 1, baseY: pos.y, phase: 0, spin: false, instIndex: -1 };
    this.items.push(p);
    return p;
  }

  addInstanced(type: 'rock' | 'stick', index: number, x: number, y: number, z: number): void {
    this.items.push({ type, pos: new THREE.Vector3(x, y, z), mesh: null, active: true, amount: type === 'stick' ? 2 : 1, baseY: y, phase: 0, spin: false, instIndex: index });
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
      if (!p.mesh) continue;
      const hl = p === this.highlighted;
      if (!p.spin) {
        // Grounded items: highlight with a slight swell instead of lifting off the ground.
        const k = hl ? 1.08 + Math.sin(time * 6) * 0.02 : 1;
        p.mesh.scale.setScalar(k);
        continue;
      }
      p.mesh.position.y = p.baseY + Math.sin(time * 2 + p.phase) * 0.03 + (hl ? 0.05 : 0);
      p.mesh.rotation.y = p.phase + time * 0.5;
    }
  }
}
