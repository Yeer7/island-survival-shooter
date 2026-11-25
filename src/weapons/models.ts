import * as THREE from 'three';
import { detailTextures } from '../world/textures';

const std = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

const MAT = {
  handle: std(0x2b2b2e, 0.6),
  grip: std(0xd94a1e, 0.55),
  head: std(0xc22a1c, 0.45, 0.2),
  blade: std(0xd6dade, 0.25, 0.9),
  skin: std(0xc68e68, 0.65),
  sleeve: std(0x5d6b4c, 0.85),
  cuff: std(0x3f4a34, 0.9),
};

/** Emergency fire axe: red head, polished edge, black/orange grip. Origin = grip point. */
export function buildAxe(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'axe';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 8), MAT.handle);
  handle.position.y = 0.2;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), MAT.grip);
  grip.position.y = -0.02;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), MAT.handle);
  knob.position.y = -0.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.07, 0.15), MAT.head);
  head.position.set(0, 0.47, -0.03);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.05), MAT.blade);
  blade.position.set(0, 0.47, -0.125);
  const pick = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 6), MAT.head);
  pick.rotation.x = Math.PI / 2;
  pick.position.set(0, 0.47, 0.09);
  g.add(handle, grip, knob, head, blade, pick);
  return g;
}

/** The axe with a glowing, burning head (bench level 3). */
export function buildFlameAxe(): THREE.Group {
  const g = buildAxe();
  g.name = 'flameAxe';
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === MAT.head) {
      m.material = new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.5, emissive: 0xff5a10, emissiveIntensity: 1.4 });
    }
  });
  const flame = new THREE.Object3D();
  flame.name = 'flame';
  flame.position.set(0, 0.5, -0.03);
  g.add(flame);
  return g;
}

/** Sleeved forearm with a closed hand. Origin = palm centre. Forearm runs toward +Z/-Y. */
export function buildArm(left = false): THREE.Group {
  const g = new THREE.Group();
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.095), MAT.skin);
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.05), MAT.skin);
  fingers.position.set(left ? 0.02 : -0.02, 0.0, -0.055);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.055), MAT.skin);
  thumb.position.set(left ? 0.04 : -0.04, 0.03, -0.03);
  thumb.rotation.y = left ? -0.4 : 0.4;
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.08, 8), MAT.skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, -0.005, 0.07);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), MAT.cuff);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.01, 0.12);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.5, 10), MAT.sleeve);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(0, -0.015, 0.39);
  g.add(hand, fingers, thumb, wrist, cuff, sleeve);
  return g;
}

export function buildLog(length = 1.6, radius = 0.2): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.05, length, 9), logMaterials());
}

let _logMats: THREE.Material[] | null = null;
export function logMaterials(): THREE.Material[] {
  if (!_logMats) {
    const tex = detailTextures();
    const bark = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x6b4a2e).multiplyScalar(1.35), roughness: 0.95, map: tex.bark, bumpMap: tex.barkBump, bumpScale: 3 });
    const ring = std(0xcaa472, 0.8);
    _logMats = [bark, ring, ring];
  }
  return _logMats;
}

let _wood: THREE.MeshStandardMaterial | null = null;
export function woodMaterial(): THREE.MeshStandardMaterial {
  if (!_wood) {
    const tex = detailTextures();
    _wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x9a7048).multiplyScalar(1.3), roughness: 0.85, map: tex.bark });
  }
  return _wood;
}

/** Sharpened wooden spear. Origin = grip, point along -Z. */
export function buildSpear(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 1.7, 7), woodMaterial());
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.35;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.2, 7), std(0xc9a57a, 0.7));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -1.3;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 7), std(0x6d5a3e, 0.95));
  wrap.rotation.x = Math.PI / 2;
  wrap.position.z = -1.12;
  g.add(shaft, tip, wrap);
  return g;
}

/** Hunting bow: an arc along Y with a string; `string` holds the 3 string points. */
export function buildBow(): { group: THREE.Group; string: THREE.Line; nock: THREE.Object3D } {
  const g = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.55, 0.06), new THREE.Vector3(0, 0, -0.16), new THREE.Vector3(0, -0.55, 0.06));
  const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.014, 6, false), woodMaterial());
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), std(0x4a3524, 0.9));
  grip.position.z = -0.08;
  const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.55, 0.06), new THREE.Vector3(0, 0, 0.06), new THREE.Vector3(0, -0.55, 0.06)]);
  const string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xe8e2cf }));
  const nock = new THREE.Object3D();
  nock.position.set(0, 0, 0.06);
  g.add(limb, grip, string, nock);
  return { group: g, string, nock };
}

/** Arrow pointing along -Z, origin at the nock. */
export function buildArrow(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 5), std(0xb08a5a, 0.8));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.35;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 5), std(0x6f6f6f, 0.4, 0.4));
  head.rotation.x = -Math.PI / 2;
  head.position.z = -0.72;
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.03, 0.1), std(0xe8e2cf, 0.9));
  fl.position.z = -0.06;
  const fl2 = fl.clone();
  fl2.rotation.z = Math.PI / 2;
  g.add(shaft, head, fl, fl2);
  return g;
}

/** Torch: stick with a cloth-wrapped head. `flame` marks where fire sits. */
export function buildTorch(): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.5, 7), woodMaterial());
  stick.position.y = 0.12;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.1, 8), std(0x3d2c1c, 1));
  head.position.y = 0.4;
  const flame = new THREE.Object3D();
  flame.name = 'flame';
  flame.position.y = 0.48;
  g.add(stick, head, flame);
  return g;
}

/** Fishing rod; `tip` marks the end of the line. */
export function buildRod(): THREE.Group {
  const g = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.016, 1.4, 6), woodMaterial());
  rod.position.y = 0.55;
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), std(0x55606a, 0.5, 0.6));
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0.03, 0.05, 0);
  const tip = new THREE.Object3D();
  tip.name = 'tip';
  tip.position.y = 1.25;
  g.add(rod, reel, tip);
  return g;
}

export function buildMeat(cooked: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), std(cooked ? 0x7a4320 : 0xb4413c, 0.6));
  m.scale.set(1.3, 0.7, 1);
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), std(0xeee6d2, 0.6));
  bone.rotation.z = Math.PI / 2;
  bone.position.x = 0.08;
  g.add(m, bone);
  return g;
}

export function buildFish(cooked: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), std(cooked ? 0x8a5a2a : 0x8aa0ad, 0.4, cooked ? 0 : 0.3));
  body.scale.set(2.2, 0.8, 0.5);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 4), std(cooked ? 0x6a4320 : 0x6b8290, 0.5));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = 0.15;
  g.add(body, tail);
  return g;
}

export function buildSticks(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.5, 5), woodMaterial());
    s.rotation.set(Math.PI / 2, 0, 0);
    s.rotation.y = (i - 1) * 0.35;
    s.position.y = i * 0.025;
    g.add(s);
  }
  return g;
}

export function buildHide(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.4, 0.025, 0.3, 4, 1, 3);
  const m = new THREE.Mesh(geo, std(0x8b6a45, 1));
  return m;
}
