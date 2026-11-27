import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { InstancePart } from '../assets/assets';
import { mulberry32 } from '../core/math';
import { gridGeometry } from './airliner';
import { detailTextures } from './textures';

/**
 * Coconut palms built in code. The foot of the trunk sits exactly at (0, 0, 0) and the
 * trunk rises straight for the first 0.7 m before it curves (toward model +X), so a cut
 * at PALM_CUT is a clean horizontal circle that lines up with the stump.
 */
export const PALM_CUT = 0.85;
const STRAIGHT = 0.7;

export interface PalmVariant {
  /** Whole palm for the instanced forest. */
  standing: InstancePart[];
  /** Everything above the cut, with a closed ring-cut base: the piece that falls. */
  falling: InstancePart[];
  /** Spine samples (model space) with a clearance radius, root to crown: for resting on the ground. */
  spine: { p: THREE.Vector3; r: number }[];
  height: number;
}

/** Trunk radius at height h: a flared foot, ring ridges every 0.3 m. */
export function palmRadius(h: number): number {
  const base = 0.16 + 0.1 * Math.exp(-Math.max(0, h) * 1.4);
  return base * (1 + 0.07 * Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * h) / 0.3), 4));
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Ringed coconut bark: two leaf-scar rings per tile, fibrous streaks. */
function trunkTexture(): THREE.CanvasTexture {
  return canvasTex(
    128,
    256,
    (g) => {
      const r = mulberry32(61);
      g.fillStyle = '#8c7458';
      g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '60,46,32' : '170,150,120'},${0.12 + r() * 0.18})`;
        g.fillRect(r() * 128, r() * 256, 1 + r() * 2, 6 + r() * 26);
      }
      for (const y0 of [0, 128]) {
        const grd = g.createLinearGradient(0, y0, 0, y0 + 128);
        grd.addColorStop(0, 'rgba(48,36,24,0.85)');
        grd.addColorStop(0.12, 'rgba(120,98,72,0.2)');
        grd.addColorStop(0.75, 'rgba(160,138,108,0.15)');
        grd.addColorStop(0.92, 'rgba(70,54,38,0.45)');
        grd.addColorStop(1, 'rgba(48,36,24,0.85)');
        g.fillStyle = grd;
        g.fillRect(0, y0, 128, 128);
        g.strokeStyle = 'rgba(36,26,16,0.8)';
        g.lineWidth = 3;
        g.beginPath();
        for (let x = 0; x <= 128; x += 8) g.lineTo(x, y0 + 2 + Math.sin(x * 0.2 + y0) * 2.5);
        g.stroke();
      }
    },
    true,
  );
}

/** One frond: a midrib with leaflets sweeping toward the tip (v = along, u = across), alpha cut. */
function frondTexture(): THREE.CanvasTexture {
  return canvasTex(
    128,
    256,
    (g) => {
      const r = mulberry32(83);
      g.clearRect(0, 0, 128, 256);
      g.lineCap = 'round';
      for (let y = 10; y < 252; y += 5) {
        const t = y / 256;
        const len = 60 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55);
        for (const s of [-1, 1]) {
          const shade = 70 + r() * 50;
          g.strokeStyle = `rgb(${Math.round(shade * 0.55)},${Math.round(shade + 40)},${Math.round(shade * 0.35)})`;
          g.lineWidth = 3.2 + r();
          g.beginPath();
          g.moveTo(64, y);
          g.quadraticCurveTo(64 + s * len * 0.5, y + 4, 64 + s * len, y + 14 + r() * 6);
          g.stroke();
        }
      }
      g.strokeStyle = '#8a8a3a';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(64, 0);
      g.lineTo(64, 256);
      g.stroke();
    },
    false,
  );
}

let shared: { trunk: THREE.MeshStandardMaterial; frond: THREE.MeshStandardMaterial; nut: THREE.MeshStandardMaterial; cut: THREE.MeshStandardMaterial } | null = null;

/** Materials shared by every palm (also used by the palm stumps). */
export function palmMaterials(): { trunk: THREE.MeshStandardMaterial; frond: THREE.MeshStandardMaterial; nut: THREE.MeshStandardMaterial; cut: THREE.MeshStandardMaterial } {
  if (shared) return shared;
  const tex = detailTextures();
  shared = {
    trunk: new THREE.MeshStandardMaterial({ map: trunkTexture(), roughness: 0.92, side: THREE.DoubleSide }),
    // A faint green emissive keeps the undersides of the fronds from going black against the sky.
    frond: new THREE.MeshStandardMaterial({ map: frondTexture(), roughness: 0.8, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0x1d3a12, emissiveIntensity: 0.6 }),
    nut: new THREE.MeshStandardMaterial({ color: 0x5b4a22, roughness: 0.7 }),
    cut: new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd9c09a), roughness: 0.85, map: tex.rings, side: THREE.DoubleSide }),
  };
  return shared;
}

const VARIANTS = [
  { height: 6.8, lean: 1.3, fronds: 7, seed: 11 },
  { height: 7.4, lean: 2.1, fronds: 8, seed: 23 },
  { height: 8.0, lean: 2.9, fronds: 9, seed: 37 },
];

export function buildPalmVariants(): PalmVariant[] {
  const mats = palmMaterials();
  return VARIANTS.map((v) => {
    const H = v.height;
    const r = mulberry32(v.seed);
    const spineAt = (h: number) => {
      const k = h <= STRAIGHT ? 0 : Math.pow((h - STRAIGHT) / (H - STRAIGHT), 1.8);
      return new THREE.Vector3(v.lean * k, h, 0);
    };
    const tangentAt = (h: number) => spineAt(Math.min(H, h + 0.02)).sub(spineAt(Math.max(0, h - 0.02))).normalize();
    const trunk = (h0: number) => {
      const rows = Math.ceil((H - h0) / 0.1);
      return gridGeometry(rows, 10, (i, j) => {
        const h = h0 + ((H - h0) * i) / rows;
        const c = spineAt(h);
        const t = tangentAt(h);
        const n2 = new THREE.Vector3(t.y, -t.x, 0);
        const phi = (j / 10) * Math.PI * 2;
        const rad = palmRadius(h);
        const p = c.addScaledVector(n2, Math.cos(phi) * rad).add(new THREE.Vector3(0, 0, Math.sin(phi) * rad));
        return { p, u: j / 10, v: h / 0.6, c: 1 };
      });
    };
    // Crown: arched fronds with a V-fold, plus a few drooping lower ones.
    const top = spineAt(H);
    const frondGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < v.fronds; k++) {
      const a = (k / v.fronds) * Math.PI * 2 + (r() - 0.5) * 0.4;
      const low = k % 3 === 2;
      const len = (low ? 2.4 : 2.9) + r() * 0.6;
      const lift = low ? 0.1 : 0.45 + r() * 0.15;
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      frondGeos.push(
        gridGeometry(10, 2, (i, j) => {
          const t = i / 10;
          const w = 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)), 0.6);
          const across = j - 1;
          const p = top
            .clone()
            .addScaledVector(d, len * t + 0.12)
            .add(new THREE.Vector3(0, len * (lift * t - (0.62 + (low ? 0.25 : 0)) * t * t), 0))
            .addScaledVector(side, across * w);
          p.y += across === 0 ? 0.07 * w : -0.05 * w;
          return { p, u: j / 2, v: t, c: 1 };
        }),
      );
    }
    const fronds = mergeGeometries(frondGeos.map((g) => g.toNonIndexed()), false)!;
    // Coconuts hanging under the crown.
    const nutGeos: THREE.BufferGeometry[] = [];
    const nuts = 2 + Math.floor(r() * 2);
    for (let k = 0; k < nuts; k++) {
      const a = r() * Math.PI * 2;
      const s = new THREE.SphereGeometry(0.14, 10, 8);
      s.scale(1, 1.12, 1);
      s.translate(top.x + Math.cos(a) * 0.24, top.y - 0.22 - r() * 0.08, top.z + Math.sin(a) * 0.24);
      nutGeos.push(s);
    }
    const nutGeo = mergeGeometries(nutGeos, false)!;
    // Closed caps: the crown top and, for the falling piece, the ring-cut base.
    const crownCap = new THREE.CircleGeometry(palmRadius(H), 10);
    crownCap.rotateX(-Math.PI / 2);
    crownCap.translate(top.x, top.y, top.z);
    const cutCap = new THREE.CircleGeometry(palmRadius(PALM_CUT) * 1.02, 14);
    cutCap.rotateX(Math.PI / 2);
    cutCap.translate(0, PALM_CUT, 0);
    const spine: { p: THREE.Vector3; r: number }[] = [];
    for (let h = PALM_CUT + 0.5; h < H; h += 0.5) spine.push({ p: spineAt(h), r: palmRadius(h) + 0.05 });
    spine.push({ p: top.clone(), r: 0.45 });
    // Folded fronds touch first; they bend, so only part of their reach counts.
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      spine.push({ p: top.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, -0.35, Math.sin(a) * 1.2)), r: 0.25 });
    }
    return {
      standing: [
        { geometry: trunk(0), material: mats.trunk },
        { geometry: fronds, material: mats.frond },
        { geometry: nutGeo, material: mats.nut },
        { geometry: crownCap, material: mats.cut },
      ],
      falling: [
        { geometry: trunk(PALM_CUT), material: mats.trunk },
        { geometry: fronds, material: mats.frond },
        { geometry: nutGeo, material: mats.nut },
        { geometry: mergeGeometries([crownCap, cutCap], false)!, material: mats.cut },
      ],
      spine,
      height: H,
    };
  });
}

/** Palm stump: the trunk from below the sand up to the cut, ring-cut top, same radius as the trunk. */
export function palmStumpGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(palmRadius(PALM_CUT), palmRadius(0) * 1.04, PALM_CUT + 0.3, 14, 1);
  g.translate(0, (PALM_CUT - 0.3) / 2, 0);
  return g;
}
