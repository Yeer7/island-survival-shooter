import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstancePart } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { gridGeometry } from './airliner';
import { barkMaterial, PineVariant } from './pines';

/**
 * Tall temperate broadleaf trees built in code: a straight, tall trunk in a greyer bark,
 * bare up to 5.5-7 m, then a few strong limbs that fork upward into a wide, high crown of
 * alpha-cut leaf clusters (light green to mid green), open enough for sun to fall through
 * in shafts. The foot of the trunk is exactly (0, 0, 0).
 */

let greyBark: THREE.MeshStandardMaterial | null = null;
/** The pine bark maps, tinted to a greyer, smoother-looking broadleaf bark. */
export function broadleafBarkMaterial(): THREE.MeshStandardMaterial {
  if (greyBark) return greyBark;
  greyBark = barkMaterial().clone();
  greyBark.color.setHex(0xe2ddd5);
  greyBark.normalScale.set(0.8, 0.8);
  return greyBark;
}

/** A cluster of small serrated leaves on fine twigs, alpha cut-out. */
function leafTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = mulberry32(77);
  g.strokeStyle = '#4a3a28';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S * 0.5, S);
  g.lineTo(S * 0.5, S * 0.2);
  g.stroke();
  for (let k = 0; k < 7; k++) {
    const y = S * (0.3 + k * 0.1);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(S * 0.5, y);
    g.lineTo(S * 0.5 + (k % 2 ? 1 : -1) * S * 0.3, y - S * 0.12);
    g.stroke();
  }
  for (let k = 0; k < 150; k++) {
    // Leaves fill a rounded cluster, denser in the middle.
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * S * 0.44;
    const x = S * 0.5 + Math.cos(a) * d;
    const y = S * 0.48 + Math.sin(a) * d * 0.9;
    const len = 12 + r() * 12;
    const w = len * (0.42 + r() * 0.12);
    const rot = r() * Math.PI * 2;
    const t = 0.55 + r() * 0.45;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = `rgb(${Math.round(58 + 60 * t)},${Math.round(96 + 70 * t)},${Math.round(34 + 30 * t)})`;
    g.beginPath();
    g.moveTo(0, -len / 2);
    g.quadraticCurveTo(w, 0, 0, len / 2);
    g.quadraticCurveTo(-w, 0, 0, -len / 2);
    g.fill();
    g.strokeStyle = 'rgba(30,50,20,0.35)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, -len / 2);
    g.lineTo(0, len / 2);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let leaves: THREE.MeshStandardMaterial | null = null;
export function broadleafLeafMaterial(): THREE.MeshStandardMaterial {
  if (leaves) return leaves;
  leaves = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  return leaves;
}

const VARIANTS = [
  { height: 17.5, seed: 41, limbs: 6, clear: 6.0 },
  { height: 20.5, seed: 59, limbs: 7, clear: 6.8 },
];

export function buildBroadleafVariants(): PineVariant[] {
  const barkM = broadleafBarkMaterial();
  const leafM = broadleafLeafMaterial();
  const up = new THREE.Vector3(0, 1, 0);
  return VARIANTS.map((v) => {
    const H = v.height;
    const r = mulberry32(v.seed);
    const ph = r() * 6;
    const SIDES = 10;
    const spine = (h: number) => {
      const k = THREE.MathUtils.smoothstep(h, 1.0, 6.0);
      return new THREE.Vector3(0.08 * Math.sin(h * 0.35 + ph) * k, h, 0.08 * Math.cos(h * 0.3 + ph) * k);
    };
    const trunkTop = H * 0.78;
    const radius = (h: number) => (0.07 + 0.36 * Math.pow(Math.max(0, 1 - h / (trunkTop * 1.25)), 0.8) + 0.08 * Math.exp(-h * 2.2)) * (1 + 0.025 * Math.sin(h * 5 + ph));
    // Rings: dense at the foot (where the axe bites), sparse above.
    const rows: number[] = [];
    for (let h = 0; h < 3; h += 0.25) rows.push(h);
    for (let h = 3; h < trunkTop; h += 1.2) rows.push(h);
    rows.push(trunkTop);
    const trunkGeo = gridGeometry(rows.length - 1, SIDES, (i, j) => {
      const h = rows[i];
      const c = spine(h);
      const phi = (j / SIDES) * Math.PI * 2;
      const rad = radius(h);
      return { p: new THREE.Vector3(c.x + Math.cos(phi) * rad, h, c.z + Math.sin(phi) * rad), u: (j / SIDES) * 2, v: h / 1.6, c: 1 };
    });
    trunkGeo.deleteAttribute('color');

    // Limbs: a few strong ones forking upward from the clear height into the crown.
    const branchGeos: THREE.BufferGeometry[] = [];
    const cards: { c: THREE.Vector3; size: number; tilt: number; az: number }[] = [];
    const limb = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number) => {
      const g = new THREE.CylinderGeometry(r0 * 0.45, r0, len, 5, 1, true);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
      g.translate(from.x, from.y, from.z);
      branchGeos.push(g);
      return from.clone().addScaledVector(dir, len);
    };
    const leafCluster = (at: THREE.Vector3, spread: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const p = at.clone().add(new THREE.Vector3((r() - 0.5) * spread, (r() - 0.3) * spread * 0.6, (r() - 0.5) * spread));
        cards.push({ c: p, size: 2.0 + r() * 1.4, tilt: (r() - 0.5) * 1.2, az: r() * Math.PI });
      }
    };
    for (let k = 0; k < v.limbs; k++) {
      const y = v.clear + (k / v.limbs) * (trunkTop - v.clear) * 0.9 + (r() - 0.5) * 0.4;
      const az = k * 2.4 + r() * 0.6;
      const outward = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const dir = outward.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.9 + r() * 0.3, 0)).normalize();
      const from = spine(y).addScaledVector(outward, radius(y) * 0.6);
      const len = 3.2 + r() * 1.6 - (y - v.clear) * 0.08;
      const end = limb(from, dir, len, 0.16 - k * 0.008);
      // Two or three forks, each ending in a leafy cluster.
      const forks = 2 + Math.floor(r() * 2);
      for (let f = 0; f < forks; f++) {
        const d2 = dir.clone().applyAxisAngle(up, (f - (forks - 1) / 2) * 0.9 + (r() - 0.5) * 0.3).add(new THREE.Vector3(0, 0.15, 0)).normalize();
        const tip = limb(end, d2, 2.0 + r() * 1.4, 0.07);
        leafCluster(tip, 3.2, 11);
        leafCluster(end.clone().lerp(tip, 0.5), 2.6, 6);
        leafCluster(end, 2.4, 3);
      }
    }
    // The leader continues up into the middle of the crown.
    const lead = limb(spine(trunkTop), new THREE.Vector3(0.05, 1, 0.03).normalize(), H - trunkTop - 1.2, radius(trunkTop));
    leafCluster(lead, 3.6, 16);
    leafCluster(spine(trunkTop + 1), 4.2, 12);

    // Leaf cards: crossed pairs, normals leaning up so the crown lights like a canopy.
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const q of cards) {
      for (const cross of [0, Math.PI / 2]) {
        const a = new THREE.Vector3(Math.cos(q.az + cross), 0, Math.sin(q.az + cross));
        const b = new THREE.Vector3(0, 1, 0).applyAxisAngle(a, q.tilt).normalize();
        const n = new THREE.Vector3().crossVectors(a, b).normalize();
        if (n.y < 0) n.negate();
        n.lerp(up, 0.6).normalize();
        const base = pos.length / 3;
        for (const [ua, vs] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]) {
          const p = q.c
            .clone()
            .addScaledVector(a, (ua - 0.5) * q.size)
            .addScaledVector(b, (vs - 0.5) * q.size);
          pos.push(p.x, p.y, p.z);
          nor.push(n.x, n.y, n.z);
          uv.push(ua, vs);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const foliage = new THREE.BufferGeometry();
    foliage.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    foliage.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    foliage.setIndex(idx);
    const wood = mergeGeometries([trunkGeo, ...branchGeos], false)!;

    // Clearance samples (model space) for resting the fallen tree on the ground.
    const spineSamples: { p: THREE.Vector3; r: number }[] = [];
    for (let y = 1; y <= H; y += 0.9) spineSamples.push({ p: spine(y), r: y < v.clear ? radius(y) + 0.1 : 0.4 + 3.2 * Math.sin(Math.PI * Math.min(1, (y - v.clear) / (H - v.clear))) * 0.7 });

    const parts: InstancePart[] = [
      { geometry: wood, material: barkM },
      { geometry: foliage, material: leafM },
    ];
    return {
      standing: parts,
      falling: parts,
      height: H,
      spine: spineSamples,
      trunkAt: (h: number) => ({ c: spine(h).clone(), r: radius(h), sides: SIDES }),
      trunk: {
        sides: SIDES,
        ring: (h: number, j: number) => {
          const c = spine(h);
          const phi = (j / SIDES) * Math.PI * 2;
          const rad = radius(h);
          return new THREE.Vector3(c.x + Math.cos(phi) * rad, h, c.z + Math.sin(phi) * rad);
        },
        center: (h: number) => spine(h),
        uv: (j: number, h: number) => [(j / SIDES) * 2, h / 1.6],
        rows,
      },
    };
  });
}
