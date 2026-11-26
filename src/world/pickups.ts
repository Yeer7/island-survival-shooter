import * as THREE from 'three';
import { library } from '../assets/assets';
import { getLang } from '../ui/i18n';
import { buildArrow, buildHide, buildLog, buildMeat, buildSticks, buildTotem } from '../weapons/models';

export type ItemType = 'food' | 'bandage' | 'cloth' | 'stick' | 'log' | 'rock' | 'meat' | 'hide' | 'arrow' | 'totem' | 'coconut' | 'relic' | 'heart' | 'flashlight' | 'backpack';

const ITEM_PT: Record<ItemType, string> = {
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
  coconut: 'Coco',
  relic: 'Relíquia da Caverna',
  heart: 'Coração Alfa',
  flashlight: 'Lanterna Tática',
  backpack: 'Mochila Tática',
};
const ITEM_EN: Record<ItemType, string> = {
  food: 'Food',
  bandage: 'Bandage',
  cloth: 'Cloth',
  stick: 'Sticks',
  log: 'Log',
  rock: 'Rock',
  meat: 'Raw Meat',
  hide: 'Animal Hide',
  arrow: 'Arrow',
  totem: 'Tribal Totem',
  coconut: 'Coconut',
  relic: 'Cave Relic',
  heart: 'Alpha Heart',
  flashlight: 'Tactical Flashlight',
  backpack: 'Tactical Backpack',
};
/** Display names of pickups in the current language (ids and saves are unchanged). */
export const ITEM_LABEL: Record<ItemType, string> = new Proxy({} as Record<ItemType, string>, {
  get: (_, k: string) => (getLang() === 'en' ? ITEM_EN : ITEM_PT)[k as ItemType],
});

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
    case 'coconut': {
      const husk = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m(0x5a3a1e, 0.95));
      husk.scale.set(1, 0.92, 1.1);
      husk.position.y = 0.1;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), m(0x1e120a, 1));
      eye.position.set(0.03, 0.18, 0.08);
      g.add(husk, eye);
      break;
    }
    case 'relic': {
      // Glowing crystal on a carved stone base.
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.1, 8), m(0x6f6a62, 0.9));
      base.position.y = 0.05;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0x6fd8ff, emissive: 0x2a9fd8, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.1 }));
      gem.scale.y = 1.6;
      gem.position.y = 0.32;
      g.add(base, gem);
      break;
    }
    case 'heart': {
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshStandardMaterial({ color: 0x8a0f14, emissive: 0x5a0408, emissiveIntensity: 1.2, roughness: 0.35 }));
      heart.scale.set(1, 1.2, 0.9);
      heart.position.y = 0.13;
      g.add(heart);
      break;
    }
    case 'flashlight': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.26, 12), m(0x2b2f33, 0.5, 0.4));
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.04;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0b0, emissiveIntensity: 0.8 }));
      lens.rotation.z = Math.PI / 2;
      lens.position.set(0.15, 0.045, 0);
      g.add(body, lens);
      break;
    }
    case 'backpack': {
      const lib = library();
      if (lib?.has('backpack')) {
        g.add(lib.instance('backpack', { by: 'height', value: 0.55 }));
        break;
      }
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.25), m(0x4a5a34, 0.9)));
      break;
    }
    case 'food': {
      const lib = library();
      if (lib?.has('can')) {
        // Red-label tin, big enough to read on dark crash-site soil.
        g.add(lib.instance('can', { by: 'height', value: 0.32 }));
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
      const lib = library();
      if (lib?.has('bandages')) {
        // Rolled linen strips (SurvivalPack Bandages), lying on their side.
        g.add(lib.instance('bandages', { by: 'footprint', value: 0.35 }));
        break;
      }
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
    case 'rock': {
      // Loose pebble (instanced ground stones use no mesh: instIndex >= 0).
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), m(0x9a968e, 0.9));
      st.scale.set(1.2, 0.6, 1);
      g.add(st);
      break;
    }
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
    const still = !(type === 'totem' || type === 'relic' || type === 'heart');
    mesh.rotation.y = rotY;
    mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(mesh);
    const baseY = pos.y - bb.min.y + (still ? 0.005 : 0.1);
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
