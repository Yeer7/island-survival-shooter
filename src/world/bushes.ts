import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstancePart } from '../assets/assets';
import { mulberry32 } from '../core/math';

/**
 * Undergrowth shrubs built in code: dark forking twigs from the base and irregular
 * layers of alpha-cut leaf sprays in moss / olive tones (no smooth ball, no lime green).
 * About 1 m tall before the per-instance scale.
 */

function leafTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = mulberry32(53);
  // Twiglets.
  g.strokeStyle = '#3a2c1e';
  g.lineWidth = 2;
  for (let k = 0; k < 7; k++) {
    g.beginPath();
    g.moveTo(S / 2, S - 4);
    g.quadraticCurveTo(S / 2 + (r() - 0.5) * 80, S * 0.6, 30 + r() * (S - 60), 20 + r() * 120);
    g.stroke();
  }
  // Leaves: small pointed ovals, mostly inside a rough blob, darker toward the middle.
  for (let k = 0; k < 260; k++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * S * 0.44;
    const x = S / 2 + Math.cos(a) * rad;
    const y = S * 0.48 + Math.sin(a) * rad * 0.9;
    const len = 9 + r() * 9;
    const wid = len * (0.38 + r() * 0.12);
    const shade = 0.72 + r() * 0.35 - (1 - rad / (S * 0.44)) * 0.15;
    const hueMix = r();
    const R = Math.round((84 + 38 * hueMix) * shade);
    const G = Math.round((106 + 26 * hueMix) * shade);
    const B = Math.round((48 + 12 * hueMix) * shade);
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.fillStyle = `rgb(${R},${G},${B})`;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(0, -wid, len / 2, 0);
    g.quadraticCurveTo(0, wid, -len / 2, 0);
    g.fill();
    g.strokeStyle = `rgba(20,30,14,0.6)`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.lineTo(len / 2, 0);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

let mats: { twig: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial } | null = null;

export function bushMaterials(): { twig: THREE.MeshStandardMaterial; leaf: THREE.MeshStandardMaterial } {
  if (!mats) {
    mats = {
      twig: new THREE.MeshStandardMaterial({ color: 0x3b2d21, roughness: 0.95, metalness: 0 }),
      leaf: new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }),
    };
  }
  return mats;
}

/** One shrub shape: stems from the base, forks, and leaf sprays where the shape wants them. */
interface BushSpec {
  seed: number;
  stems: number;
  height: number;
  spread: number;
  /** Leaf sprays at the stem tip, at the fork tip, and along the stem. */
  tip: number;
  fork: number;
  mid: number;
  /** Low leafy skirt cards round the base. */
  skirt: number;
  /** Extra cards bunched in a small crown at the top (the sapling). */
  crown: number;
  stemRadius: number;
  /** How unevenly the stems are spaced and sized (0 = even). */
  ragged: number;
}

/** Sticks a cut shrub of each variant leaves behind. */
export const BUSH_STICKS = [2, 2, 3, 2];
/** Height (m, before scale) of each variant's leafy mass centre, for aiming at it. */
export const BUSH_CENTER = [0.35, 0.6, 1.1, 0.5];

/**
 * Four shrub variants: 0 low and spreading; 1 medium and full; 2 a tall, open sapling
 * (2-3 thin stems, light foliage at the top, ~2.3 m); 3 a sparse, irregular one with few
 * open branches.
 */
export function buildBushVariants(): InstancePart[][] {
  const m = bushMaterials();
  const up = new THREE.Vector3(0, 1, 0);
  const specs: BushSpec[] = [
    { seed: 3, stems: 11, height: 0.85, spread: 1.15, tip: 1, fork: 1, mid: 1, skirt: 6, crown: 0, stemRadius: 0.022, ragged: 0.4 },
    { seed: 9, stems: 9, height: 1.45, spread: 0.65, tip: 1, fork: 1, mid: 2, skirt: 5, crown: 0, stemRadius: 0.028, ragged: 0.3 },
    { seed: 17, stems: 3, height: 2.35, spread: 0.22, tip: 2, fork: 1, mid: 0, skirt: 0, crown: 9, stemRadius: 0.032, ragged: 0.5 },
    { seed: 27, stems: 5, height: 1.25, spread: 1.0, tip: 1, fork: 1, mid: 0, skirt: 1, crown: 0, stemRadius: 0.02, ragged: 0.9 },
  ];
  return specs.map((v) => {
    const r = mulberry32(v.seed);
    const twigs: THREE.BufferGeometry[] = [];
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const twig = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number) => {
      const g = new THREE.CylinderGeometry(rad * 0.35, rad, len, 4, 1, true);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
      g.translate(from.x, from.y, from.z);
      twigs.push(g);
    };
    const card = (c: THREE.Vector3, size: number) => {
      // Two crossed, randomly tilted squares per spray.
      for (let k = 0; k < 2; k++) {
        const yaw = r() * Math.PI * 2;
        const tilt = (r() - 0.5) * 0.9 + (k ? 0.9 : 0);
        const ax = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
        const ay = new THREE.Vector3(0, 1, 0).applyAxisAngle(ax, tilt);
        const n = new THREE.Vector3().crossVectors(ax, ay).normalize();
        if (n.y < 0) n.negate();
        n.lerp(up, 0.6).normalize();
        const b = pos.length / 3;
        for (const [u, w] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]) {
          const p = c.clone().addScaledVector(ax, (u - 0.5) * size).addScaledVector(ay, (w - 0.5) * size);
          pos.push(p.x, p.y, p.z);
          nor.push(n.x, n.y, n.z);
          uv.push(u, 1 - w);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    };
    const tops: THREE.Vector3[] = [];
    for (let s = 0; s < v.stems; s++) {
      const az = (s / v.stems) * Math.PI * 2 + (r() - 0.5) * (0.6 + v.ragged * 1.2);
      const outward = v.spread * (0.6 + r() * 0.5) * (1 + (r() - 0.5) * v.ragged);
      const dir = new THREE.Vector3(Math.cos(az) * outward, 1, Math.sin(az) * outward).normalize();
      const len = v.height * (0.55 + r() * 0.35) * (1 + (r() - 0.5) * v.ragged * 0.8);
      const base = new THREE.Vector3(Math.cos(az) * 0.05, 0, Math.sin(az) * 0.05);
      twig(base, dir, len, v.stemRadius);
      // A fork part way up.
      const fork = base.clone().addScaledVector(dir, len * (0.5 + r() * 0.2));
      const d2 = dir.clone().applyAxisAngle(up, (r() - 0.5) * 1.6).add(new THREE.Vector3(Math.cos(az) * 0.4, 0.1, Math.sin(az) * 0.4)).normalize();
      twig(fork, d2, len * 0.5, v.stemRadius * 0.6);
      const tip = base.clone().addScaledVector(dir, len);
      const tip2 = fork.clone().addScaledVector(d2, len * 0.5);
      tops.push(tip);
      for (let k = 0; k < v.tip; k++) card(tip.clone().add(new THREE.Vector3((r() - 0.5) * 0.25, (r() - 0.5) * 0.2, (r() - 0.5) * 0.25)), 0.55 + r() * 0.25);
      for (let k = 0; k < v.fork; k++) card(tip2, 0.45 + r() * 0.2);
      for (let k = 0; k < v.mid; k++) card(base.clone().addScaledVector(dir, len * (0.4 + r() * 0.3)), 0.4 + r() * 0.2);
    }
    // The sapling's light crown: a loose bunch of sprays round the stem tops.
    for (let k = 0; k < v.crown; k++) {
      const t = tops[k % tops.length];
      card(t.clone().add(new THREE.Vector3((r() - 0.5) * 0.9, (r() - 0.6) * 0.6, (r() - 0.5) * 0.9)), 0.6 + r() * 0.3);
    }
    // A low skirt of leaves near the ground so the base is not bare.
    for (let k = 0; k < v.skirt; k++) {
      const a = r() * Math.PI * 2;
      const d = 0.2 + r() * v.spread * 0.4;
      card(new THREE.Vector3(Math.cos(a) * d, 0.2 + r() * 0.15, Math.sin(a) * d), 0.5);
    }
    const leaves = new THREE.BufferGeometry();
    leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    leaves.setIndex(idx);
    leaves.computeBoundingSphere();
    return [
      { geometry: mergeGeometries(twigs, false)!, material: m.twig },
      { geometry: leaves, material: m.leaf },
    ];
  });
}
