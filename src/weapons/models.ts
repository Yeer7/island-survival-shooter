import * as THREE from 'three';

const std = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

const MAT = {
  handle: std(0x2b2b2e, 0.6),
  grip: std(0xd94a1e, 0.55),
  head: std(0xc22a1c, 0.45, 0.2),
  blade: std(0xd6dade, 0.25, 0.9),
  gunMetal: std(0x2a2d31, 0.38, 0.75),
  gunGrip: std(0x1a1a1b, 0.8),
  sight: std(0xe6e1c8, 0.4),
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

/** Compact pilot's pistol. Origin = grip, barrel along -Z. */
export function buildPistol(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pistol';
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.038, 0.19), MAT.gunMetal);
  slide.position.set(0, 0.075, -0.06);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.15), MAT.gunGrip);
  frame.position.set(0, 0.047, -0.045);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.045), MAT.gunGrip);
  grip.position.set(0, 0.0, 0.0);
  grip.rotation.x = -0.22;
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 4, 10, Math.PI), MAT.gunGrip);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, 0.035, -0.035);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 8), MAT.gunGrip);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.075, -0.158);
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.008), MAT.sight);
  front.position.set(0, 0.098, -0.145);
  const rearL = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.008), MAT.sight);
  rearL.position.set(-0.01, 0.098, 0.025);
  const rearR = rearL.clone();
  rearR.position.x = 0.01;
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.075, -0.175);
  g.add(slide, frame, grip, guard, barrel, front, rearL, rearR, muzzle);
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
    const bark = std(0x5a3d26, 0.95);
    const ring = std(0xcaa472, 0.8);
    _logMats = [bark, ring, ring];
  }
  return _logMats;
}
