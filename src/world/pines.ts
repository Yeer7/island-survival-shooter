import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstancePart } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { gridGeometry } from './airliner';
import { detailTextures } from './textures';

/**
 * Pines built in code: a tapered, slightly wandering trunk with the Poly Haven "Pine
 * Bark" maps (CC0, 512 px), branches all the way up (the lowest ones dry and bare), and
 * layers of alpha-cut needle sprays along every living branch so light and shadow pass
 * between them. The foot of the trunk is exactly (0, 0, 0); PINE_CUT is where the axe
 * cuts and the stump ends.
 */
export const PINE_CUT = 0.85;

let bark: THREE.MeshStandardMaterial | null = null;

/** Matte pine bark (colour, normal and roughness maps). Shared by pines, stumps and logs. */
export function barkMaterial(): THREE.MeshStandardMaterial {
  if (bark) return bark;
  const L = new THREE.TextureLoader();
  const load = (f: string, srgb: boolean) => {
    const t = L.load(`assets/textures/${f}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  bark = new THREE.MeshStandardMaterial({
    map: load('pine_bark_diff_512.jpg', true),
    normalMap: load('pine_bark_nor_gl_512.jpg', false),
    roughnessMap: load('pine_bark_rough_512.jpg', false),
    normalScale: new THREE.Vector2(1.2, 1.2),
    color: 0xcfc4b8,
    roughness: 1,
    metalness: 0,
  });
  return bark;
}

let cutMat: THREE.MeshStandardMaterial | null = null;
/** Pale ring-cut wood for the cut faces. */
export function pineCutMaterial(): THREE.MeshStandardMaterial {
  if (!cutMat) cutMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd9b98a), roughness: 0.85, map: detailTextures().rings, side: THREE.DoubleSide });
  return cutMat;
}

/**
 * A spray of pine needles along a twig (u = along, v = across): dozens of small tufts of
 * radiating needles inside a tapering outline, alpha cut-out so light passes between.
 */
function needleTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = mulberry32(19);
  g.lineCap = 'round';
  // Thin twigs first.
  g.strokeStyle = '#3d2e1e';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W * 0.9, H / 2 + 4);
  g.stroke();
  for (let x = 20; x < W - 30; x += 22) {
    const half = (H / 2 - 10) * (1 - (x / W) * 0.7);
    for (const side of [-1, 1]) {
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, H / 2);
      g.lineTo(x + half * 0.7, H / 2 + side * half * 0.75);
      g.stroke();
    }
  }
  // Tufts of needles.
  for (let k = 0; k < 230; k++) {
    const x = Math.pow(r(), 0.8) * (W - 12) + 4;
    const half = (H / 2 - 8) * (1 - (x / W) * 0.72);
    const y = H / 2 + (r() * 2 - 1) * half;
    const n = 7 + Math.floor(r() * 6);
    const base = r() * 0.6 - 0.3;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2 * 0.5 - Math.PI * 0.25 + (r() - 0.5) * 0.4;
      const len = 5 + r() * 7;
      const s = 0.5 + r() * 0.5;
      g.strokeStyle = `rgb(${Math.round(22 + 24 * s)},${Math.round(52 + 52 * s)},${Math.round(24 + 18 * s)})`;
      g.lineWidth = 1.1 + r() * 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.9);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  return t;
}

let needles: THREE.MeshStandardMaterial | null = null;
/** Needle sprays: alpha-tested so light passes between the twigs and shadows are lacy. */
export function needleMaterial(): THREE.MeshStandardMaterial {
  if (needles) return needles;
  needles = new THREE.MeshStandardMaterial({ map: needleTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  return needles;
}

/** Tall forest pines: a clean trunk to ~5 m, a few dead stubs, then a high, wide crown. */
const VARIANTS = [
  { height: 17.0, seed: 5, branches: 18, clear: 5.0 },
  { height: 19.5, seed: 13, branches: 20, clear: 5.4 },
];


/** How a trunk is built, so a chopped tree can rebuild its foot ring for ring. */
export interface TrunkSpec {
  /** Polygon sides of the trunk. */
  sides: number;
  /** Corner j (0..sides) of the trunk ring at height h, exactly as the trunk mesh places it. */
  ring(h: number, j: number): THREE.Vector3;
  /** Axis point at height h. */
  center(h: number): THREE.Vector3;
  /** Bark texture coordinates of corner j at height h. */
  uv(j: number, h: number): [number, number];
  /** Heights of the trunk mesh's rings, bottom to top. */
  rows: number[];
}

export interface PineVariant {
  standing: InstancePart[];
  falling: InstancePart[];
  height: number;
  /** Trunk axis point, radius and polygon side count at height h (model space). */
  trunkAt(h: number): { c: THREE.Vector3; r: number; sides: number };
  trunk: TrunkSpec;
  /** Clearance samples (model space, root to crown) for resting a fallen tree on the ground. */
  spine: { p: THREE.Vector3; r: number }[];
}

/** Trunk radius at height h of a tree of height H. */
export function pineRadius(h: number, H = 9.8): number {
  return 0.04 + 0.3 * Math.pow(Math.max(0, 1 - h / H), 0.85) + 0.07 * Math.exp(-h * 3);
}

export function buildPineVariants(): PineVariant[] {
  const barkM = barkMaterial();
  const needleM = needleMaterial();
  const cut = pineCutMaterial();
  const up = new THREE.Vector3(0, 1, 0);
  return VARIANTS.map((v) => {
    const H = v.height;
    const r = mulberry32(v.seed);
    const ph = r() * 6;
    const spine = (h: number) => {
      const k = THREE.MathUtils.smoothstep(h, 0.6, 2.0);
      return new THREE.Vector3(0.06 * Math.sin(h * 0.8 + ph) * k, h, 0.06 * Math.cos(h * 0.65 + ph) * k);
    };
    // Thicker for their height: a tall forest trunk.
    const girth = Math.pow(H / 9.8, 0.55);
    const radius = (h: number) => pineRadius(h, H) * girth * (1 + 0.035 * Math.sin(h * 7 + ph));
    // Rings: dense at the foot (where the axe bites), sparse up the long clean trunk.
    const rows: number[] = [];
    for (let h = 0; h < 3; h += 0.25) rows.push(h);
    for (let h = 3; h < H; h += 1.2) rows.push(h);
    rows.push(H);
    const trunk = (h0: number) => {
      const hs = [h0, ...rows.filter((h) => h > h0 + 1e-3)];
      const geo = gridGeometry(hs.length - 1, 9, (i, j) => {
        const h = hs[i];
        const c = spine(h);
        const phi = (j / 9) * Math.PI * 2;
        const rad = radius(h);
        return { p: new THREE.Vector3(c.x + Math.cos(phi) * rad, h, c.z + Math.sin(phi) * rad), u: (j / 9) * 2, v: h / 1.4, c: 1 };
      });
      geo.deleteAttribute('color');
      return geo;
    };
    // Branches: golden-angle spiral from the clear trunk up. A few dead stubs just above
    // the clear height (high, never in the face); the crown is wide through its upper part
    // so neighbouring crowns nearly meet overhead.
    const branchGeos: THREE.BufferGeometry[] = [];
    const quads: { c: THREE.Vector3; a: THREE.Vector3; s: THREE.Vector3; len: number; w: number }[] = [];
    const twig = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number) => {
      // Open-ended and four-sided: the branch ends are hidden in the trunk and the needles.
      const g = new THREE.CylinderGeometry(r0 * 0.25, r0, len, 4, 1, true);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
      g.translate(from.x, from.y, from.z);
      branchGeos.push(g);
    };
    const yLow = v.clear;
    const yLive = yLow + 2.2;
    const crownW = (u: number) => 0.7 + 3.6 * Math.pow(1 - u, 0.7) * (0.55 + 0.45 * THREE.MathUtils.smoothstep(u, 0, 0.35));
    for (let k = 0; k < v.branches * 3; k++) {
      const level = Math.floor(k / 3);
      const t = level / (v.branches - 1);
      const y = yLow + (H - 1.0 - yLow) * Math.pow(t, 0.85) + (r() - 0.5) * 0.15;
      const az = (k % 3) * 2.094 + level * 0.9 + (r() - 0.5) * 0.5;
      const dead = y < yLive;
      if (dead && r() < 0.6) continue;
      const u = Math.max(0, (y - yLive) / (H - yLive));
      const len = dead ? 0.7 + r() * 0.7 : crownW(u) * (0.85 + r() * 0.3);
      const droop = dead ? -0.05 - r() * 0.3 : -0.1 - r() * 0.15 + u * 0.2;
      const dir = new THREE.Vector3(Math.cos(az), droop, Math.sin(az)).normalize();
      const c = spine(y);
      const from = c.clone().addScaledVector(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)), radius(y) * 0.7);
      twig(from, dir, len, dead ? 0.04 : 0.06 + 0.05 * (1 - u));
      if (dead) continue;
      // Needle sprays along the branch: a fan of tilted cards, two rows on long branches.
      const side = new THREE.Vector3().crossVectors(dir, up).normalize();
      const norm = new THREE.Vector3().crossVectors(side, dir).normalize();
      const rowsAlong = len > 2.2 ? [0.4, 0.78] : [0.55];
      for (const along of rowsAlong) {
        for (const tilt of [-0.85, -0.25, 0.3, 0.9]) {
          const tt = tilt + (r() - 0.5) * 0.25;
          const s2 = side.clone().multiplyScalar(Math.cos(tt)).addScaledVector(norm, Math.sin(tt));
          const seg = len / rowsAlong.length;
          quads.push({ c: from.clone().addScaledVector(dir, len * along), a: dir.clone(), s: s2, len: seg * 1.05 + 0.5, w: 0.9 + len * 0.28 });
        }
      }
    }
    // The leader at the top: a spire of cards.
    const top = spine(H);
    for (let k = 0; k < 5; k++) {
      const az = (k / 5) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(az) * 0.35, 1, Math.sin(az) * 0.35).normalize();
      const s2 = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
      quads.push({ c: top.clone().addScaledVector(dir, 0.3), a: dir, s: s2, len: 1.5, w: 0.8 });
    }
    const spineSamples: { p: THREE.Vector3; r: number }[] = [];
    for (let y = 1; y <= H; y += 0.9) spineSamples.push({ p: spine(y), r: y < yLive ? radius(y) + 0.1 : 0.3 + crownW(Math.max(0, (y - yLive) / (H - yLive))) * 0.6 });
    // Cards as one geometry; normals lean up so the sprays light like a canopy.
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const q of quads) {
      const n = new THREE.Vector3().crossVectors(q.s, q.a).normalize();
      if (n.y < 0) n.negate();
      n.lerp(up, 0.55).normalize();
      const b = pos.length / 3;
      for (const [ua, vs] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        const p = q.c
          .clone()
          .addScaledVector(q.a, (ua - 0.5) * q.len)
          .addScaledVector(q.s, (vs - 0.5) * q.w);
        p.y -= ua * ua * q.len * 0.12;
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        uv.push(ua, vs);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const foliage = new THREE.BufferGeometry();
    foliage.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    foliage.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    foliage.setIndex(idx);
    const wood = (h0: number) => mergeGeometries([trunk(h0), ...branchGeos.map((g) => g.clone())], false)!;
    const cutCap = new THREE.CircleGeometry(radius(PINE_CUT) * 1.02, 14);
    cutCap.rotateX(Math.PI / 2);
    cutCap.translate(0, PINE_CUT, 0);
    return {
      standing: [
        { geometry: wood(0), material: barkM },
        { geometry: foliage, material: needleM },
      ],
      falling: [
        { geometry: wood(PINE_CUT), material: barkM },
        { geometry: foliage, material: needleM },
        { geometry: cutCap, material: cut },
      ],
      height: H,
      spine: spineSamples,
      trunkAt: (h: number) => ({ c: spine(h).clone(), r: radius(h), sides: 9 }),
      trunk: {
        sides: 9,
        ring: (h: number, j: number) => {
          const c = spine(h);
          const phi = (j / 9) * Math.PI * 2;
          const rad = radius(h);
          return new THREE.Vector3(c.x + Math.cos(phi) * rad, h, c.z + Math.sin(phi) * rad);
        },
        center: (h: number) => spine(h),
        uv: (j: number, h: number) => [(j / 9) * 2, h / 1.4],
        rows,
      },
    };
  });
}

/** Pine stump: the trunk's own foot (same radius and bark) up to the cut, ring-cut top. */
export function pineStumpGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(pineRadius(PINE_CUT), pineRadius(0) * 1.03, PINE_CUT + 0.3, 12, 1);
  g.translate(0, (PINE_CUT - 0.3) / 2, 0);
  return g;
}
