import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';

/**
 * The Alpha Wolf, the island's final beast, built entirely in code. A colossal black
 * wolf (~2.2 m at the head, ~4.2 m nose to tail) with a broad, deep chest, a thick mane
 * of flat pointed tufts round the neck, cheeks and withers, a bushy tail, four jointed
 * legs on wide clawed paws, and a fierce head: an articulated jaw with long fangs, tall
 * ears (cream inside, the right one torn), narrow slanted red eyes set under pale brow
 * marks, a crimson mark on the brow and a jagged cream blaze on the chest.
 *
 * The model faces +Z with its feet on y = 0. `updateAnim` drives the rig procedurally:
 * idle, walk, run (gallop), attack, roar and death.
 */

export type WolfMode = 'idle' | 'walk' | 'run' | 'attack' | 'roar' | 'death';

export interface AlphaWolf {
  root: THREE.Group;
  /** Body materials that take the hit flash (not the glowing eyes and marks). */
  mats: THREE.MeshStandardMaterial[];
  /** Red embers and dark smoke off the chest (add `points` to the scene). */
  fx: PuffEmitter[];
  mode: WolfMode;
  /** Attack progress 0..1 and the fraction of it where the bite lands. */
  attack: number;
  bite: number;
  updateAnim(dt: number, p: { mode: WolfMode; speed: number; attack?: number; bite?: number }): void;
}

// ---------------------------------------------------------------- materials

function furTexture(base: string, strand: string, seed: number): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const r = mulberry32(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // Short and medium hairs, mostly along v (the length of each body part).
  for (let k = 0; k < 2600; k++) {
    const x = r() * S;
    const y = r() * S;
    const len = 6 + r() * 16;
    const a = Math.PI / 2 + (r() - 0.5) * 0.5;
    const light = r();
    g.strokeStyle = light < 0.55 ? strand : light < 0.85 ? 'rgba(0,0,0,0.55)' : 'rgba(120,120,135,0.35)';
    g.lineWidth = 0.6 + r() * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function materials() {
  const furTex = furTexture('#16171c', 'rgba(52,54,64,0.7)', 7);
  const creamTex = furTexture('#9f927d', 'rgba(196,184,162,0.7)', 13);
  return {
    fur: new THREE.MeshStandardMaterial({ map: furTex, bumpMap: furTex, bumpScale: 1.4, roughness: 0.82, side: THREE.DoubleSide }),
    cream: new THREE.MeshStandardMaterial({ map: creamTex, roughness: 0.85, side: THREE.DoubleSide }),
    nose: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.35, emissive: 0x2a0402, emissiveIntensity: 0.5 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe8e1cf, roughness: 0.4 }),
    claw: new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.5 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x3a0d10, roughness: 0.6, side: THREE.DoubleSide }),
    eye: new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1e12, emissiveIntensity: 2.6, toneMapped: false }),
    pupil: new THREE.MeshBasicMaterial({ color: 0x050000 }),
    mark: new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xc0140c, emissiveIntensity: 1.2, side: THREE.DoubleSide, toneMapped: false }),
    redTip: new THREE.MeshStandardMaterial({ color: 0x5a0a08, emissive: 0x6a0806, emissiveIntensity: 0.8, roughness: 0.8, side: THREE.DoubleSide }),
  };
}

// ---------------------------------------------------------------- geometry helpers

/**
 * A closed organic tube along a path, with an elliptical section (rx across, ry up)
 * at each point, and soft caps. `bulge` adds muscle bumps along the length.
 */
function loft(path: THREE.Vector3[], radii: [number, number][], seg = 16, bulge = 0, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const ph = [r() * 6, r() * 6];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = path.length;
  const up = new THREE.Vector3(0, 1, 0);
  let lenAcc = 0;
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    const ref = Math.abs(t.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : up;
    const side = new THREE.Vector3().crossVectors(t, ref).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, t).normalize();
    if (i > 0) lenAcc += path[i].distanceTo(path[i - 1]);
    const [rx, ry] = radii[i];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const b = 1 + bulge * (Math.sin(a * 2 + ph[0] + i) * 0.5 + Math.sin(a * 3 + ph[1] - i * 0.7) * 0.5);
      const p = path[i]
        .clone()
        .addScaledVector(side, Math.cos(a) * rx * b)
        .addScaledVector(nrm, Math.sin(a) * ry * b);
      pos.push(p.x, p.y, p.z);
      uv.push((j / seg) * 2, lenAcc * 1.5);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Caps: a pole at each end, pushed out a little so the ends are rounded.
  for (const [ring, sign] of [
    [0, -1],
    [n - 1, 1],
  ] as const) {
    const i0 = ring;
    const t = new THREE.Vector3().subVectors(path[Math.min(n - 1, i0 + 1)], path[Math.max(0, i0 - 1)]).normalize();
    const c = path[i0].clone().addScaledVector(t, sign * Math.min(radii[i0][0], radii[i0][1]) * 0.6);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    uv.push(0.5, sign > 0 ? lenAcc * 1.5 : 0);
    for (let j = 0; j < seg; j++) {
      const a = i0 * (seg + 1) + j;
      if (sign < 0) idx.push(a + 1, ci, a);
      else idx.push(a, ci, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const ellipsoid = (rx: number, ry: number, rz: number, seg = 16) => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg / 2));
  g.scale(rx, ry, rz);
  return g;
};

/**
 * A fan of three flat, pointed, curved blades of fur (a tuft), unit length along +Y,
 * curling toward +Z.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const fan of [-0.38, 0, 0.38]) {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const N = 4;
    const len = fan === 0 ? 1 : 0.8;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const w = 0.16 * (1 - t) * (1 - t * 0.2);
      const y = t * len;
      const z = t * t * 0.28;
      pos.push(-w, y, z, w, y, z);
      uv.push(0, t, 1, t);
      if (k < N) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.rotateZ(fan);
    parts.push(g.toNonIndexed());
  }
  const m = mergeGeometries(parts, false)!;
  m.computeVertexNormals();
  return m;
}
const TUFT = tuftGeometry();

/** Many tufts merged: each at `at`, pointing along `dir`, curling toward `curl`, of length `len`. */
function tufts(list: { at: THREE.Vector3; dir: THREE.Vector3; curl?: THREE.Vector3; len: number; width?: number }[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const t of list) {
    const g = TUFT.clone();
    const w = t.width ?? 1;
    g.scale(t.len * 0.9 * w, t.len, t.len);
    const dir = t.dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    // Roll so the curl faces the wanted way (default: away from the body's up).
    const curl = (t.curl ?? new THREE.Vector3(0, -1, 0)).clone();
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const proj = curl.sub(dir.clone().multiplyScalar(curl.dot(dir)));
    if (proj.lengthSq() > 1e-6) {
      proj.normalize();
      const ang = Math.atan2(new THREE.Vector3().crossVectors(z, proj).dot(dir), z.dot(proj));
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, ang));
    }
    g.applyQuaternion(q);
    g.translate(t.at.x, t.at.y, t.at.z);
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- build

export function buildAlphaWolf(): AlphaWolf {
  const m = materials();
  const r = mulberry32(2026);
  const root = new THREE.Group();
  root.name = 'alphaWolf';
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, shadow = true) => {
    const o = new THREE.Mesh(g, mat);
    o.castShadow = shadow;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };

  // Body: hips, waist and a broad, deep chest under high shoulders.
  const body = new THREE.Group();
  body.name = 'spine';
  root.add(body);
  mesh(
    loft(
      [V(0, 1.38, -1.22), V(0, 1.44, -0.95), V(0, 1.45, -0.55), V(0, 1.42, -0.2), V(0, 1.38, 0.2), V(0, 1.4, 0.55), V(0, 1.52, 0.86)],
      [
        [0.24, 0.28],
        [0.34, 0.38],
        [0.29, 0.31],
        [0.36, 0.44],
        [0.5, 0.66],
        [0.52, 0.66],
        [0.4, 0.46],
      ],
      20,
      0.05,
      3,
    ),
    m.fur,
    body,
  );

  // Chest group (front half): shoulders, front legs, neck, head, mane, blaze.
  const chest = new THREE.Group();
  chest.name = 'chest';
  chest.position.set(0, 1.38, 0.45);
  body.add(chest);
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.position.set(0, 1.4, -0.9);
  body.add(hips);

  // Jagged cream blaze over the middle of the chest.
  {
    const s = new THREE.Shape();
    const pts: [number, number][] = [];
    const N = 22;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      const rr = 1 + (k % 2 ? 0.28 : -0.05) * (r() * 0.8 + 0.4);
      pts.push([Math.cos(a) * 0.26 * rr, Math.sin(a) * 0.44 * rr]);
    }
    s.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
    const g = new THREE.ShapeGeometry(s, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, -p.getX(i) * p.getX(i) * 1.6 - Math.pow(p.getY(i) + 0.05, 2) * 0.5);
    g.computeVertexNormals();
    const blaze = mesh(g, m.cream, chest, false);
    blaze.position.set(0, -0.15, 0.8);
    blaze.rotation.x = 0.5;
  }

  // Neck and head.
  const neck = new THREE.Group();
  neck.name = 'neck';
  neck.position.set(0, 0.22, 0.42);
  chest.add(neck);
  mesh(loft([V(0, -0.15, -0.12), V(0, 0.1, 0.12), V(0, 0.3, 0.32), V(0, 0.44, 0.5)], [
    [0.4, 0.42],
    [0.34, 0.36],
    [0.28, 0.3],
    [0.23, 0.24],
  ], 16, 0.04, 5), m.fur, neck);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.47, 0.58);
  head.scale.setScalar(1.15);
  neck.add(head);

  // Skull, cheeks and muzzle.
  mesh(ellipsoid(0.26, 0.22, 0.28), m.fur, head).position.set(0, 0.02, 0);
  for (const sx of [-1, 1]) mesh(ellipsoid(0.12, 0.14, 0.14), m.fur, head).position.set(sx * 0.17, -0.06, 0.02);
  mesh(loft([V(0, -0.02, 0.12), V(0, -0.05, 0.34), V(0, -0.08, 0.52), V(0, -0.1, 0.62)], [
    [0.15, 0.13],
    [0.12, 0.1],
    [0.09, 0.075],
    [0.07, 0.06],
  ], 14, 0, 7), m.fur, head);
  // Nasal bridge ridge and the nose, its nostrils faintly warm.
  mesh(loft([V(0, 0.06, 0.12), V(0, 0.03, 0.4), V(0, -0.02, 0.6)], [
    [0.05, 0.04],
    [0.04, 0.035],
    [0.03, 0.03],
  ], 8, 0, 9), m.fur, head);
  mesh(ellipsoid(0.045, 0.034, 0.035, 10), m.nose, head).position.set(0, -0.065, 0.64);
  // Pale chin and upper lip line.
  mesh(ellipsoid(0.06, 0.022, 0.12, 10), m.cream, head).position.set(0, -0.145, 0.34);

  // Articulated lower jaw with fangs, tongue and a dark mouth.
  const jaw = new THREE.Group();
  jaw.name = 'jaw';
  jaw.position.set(0, -0.12, 0.1);
  head.add(jaw);
  mesh(loft([V(0, -0.02, 0.02), V(0, -0.04, 0.26), V(0, -0.04, 0.48)], [
    [0.11, 0.055],
    [0.085, 0.045],
    [0.055, 0.035],
  ], 12, 0, 11), m.fur, jaw);
  mesh(ellipsoid(0.07, 0.025, 0.18, 10), m.cream, jaw).position.set(0, -0.06, 0.26);
  const tongue = mesh(ellipsoid(0.055, 0.015, 0.2, 10), m.mouth, jaw, false);
  tongue.position.set(0, 0.01, 0.24);
  const fang = (len: number) => {
    const g = new THREE.ConeGeometry(0.016, len, 6);
    g.translate(0, -len / 2, 0);
    return g;
  };
  for (const sx of [-1, 1]) {
    const up = mesh(fang(0.11), m.bone, head, false);
    up.position.set(sx * 0.055, -0.14, 0.52);
    up.rotation.x = -0.15;
    const lo = mesh(fang(0.08), m.bone, jaw, false);
    lo.position.set(sx * 0.045, -0.0, 0.42);
    lo.rotation.x = Math.PI + 0.15;
  }
  for (let k = 0; k < 6; k++) {
    const t = mesh(fang(0.03), m.bone, head, false);
    t.position.set((k - 2.5) * 0.02, -0.13, 0.58);
  }
  // Upper mouth lining (seen when the jaw drops).
  const palate = mesh(new THREE.PlaneGeometry(0.16, 0.42), m.mouth, head, false);
  palate.rotation.x = Math.PI / 2;
  palate.position.set(0, -0.12, 0.36);

  const ears: THREE.Group[] = [];
  // Tall pointed ears: charcoal outside, cream inside; the right one torn at the tip.
  for (const sx of [-1, 1]) {
    const s = new THREE.Shape();
    s.moveTo(-0.08, 0);
    if (sx > 0) {
      // Battle tear: a V notch out of the outer edge near the tip.
      s.lineTo(0, 0.32);
      s.lineTo(0.032, 0.21);
      s.lineTo(0.008, 0.165);
      s.lineTo(0.05, 0.13);
      s.lineTo(0.08, 0);
    } else {
      s.lineTo(0, 0.32);
      s.lineTo(0.08, 0);
    }
    s.lineTo(-0.08, 0);
    const outer = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.012, bevelSegments: 2 });
    outer.translate(0, 0, -0.03);
    const ear = new THREE.Group();
    ears.push(ear);
    ear.position.set(sx * 0.14, 0.17, -0.04);
    ear.rotation.set(-0.15, sx * -0.2, sx * -0.28);
    head.add(ear);
    mesh(outer, m.fur, ear);
    const innerS = new THREE.Shape();
    innerS.moveTo(-0.05, 0.02);
    innerS.lineTo(0, 0.25);
    innerS.lineTo(0.05, 0.02);
    innerS.lineTo(-0.05, 0.02);
    const inner = mesh(new THREE.ShapeGeometry(innerS), m.cream, ear, false);
    inner.position.z = 0.02;
  }

  // Eyes: narrow, slanted almonds set deep under a heavy brow, with thin pupils.
  const eyes: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const brow = mesh(ellipsoid(0.085, 0.035, 0.07, 10), m.fur, head);
    brow.position.set(sx * 0.115, 0.1, 0.19);
    brow.rotation.z = sx * 0.35;
    const eye = mesh(ellipsoid(0.05, 0.016, 0.03, 12), m.eye, head, false);
    eye.position.set(sx * 0.115, 0.055, 0.215);
    // Inner corner low, outer corner high: a fierce slant.
    eye.rotation.set(0, sx * 0.35, sx * 0.38);
    eyes.push(eye);
    const pupil = mesh(new THREE.BoxGeometry(0.006, 0.026, 0.004), m.pupil, head, false);
    pupil.position.set(sx * 0.115, 0.055, 0.243);
    pupil.rotation.set(0, sx * 0.35, sx * 0.38);
    // Pale slanted brow marks above the eyes.
    const mark = mesh(new THREE.BoxGeometry(0.1, 0.014, 0.012), m.cream, head, false);
    mark.position.set(sx * 0.1, 0.115, 0.235);
    mark.rotation.set(-0.3, sx * 0.3, sx * -0.42);
  }
  // Crimson vertical diamond between the brows.
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0.06);
    s.lineTo(0.016, 0);
    s.lineTo(0, -0.06);
    s.lineTo(-0.016, 0);
    s.lineTo(0, 0.06);
    const d = mesh(new THREE.ShapeGeometry(s), m.mark, head, false);
    d.position.set(0, 0.13, 0.255);
    d.rotation.x = -0.45;
  }

  // Mane: layers of flat pointed tufts round the neck and cheeks, over the withers.
  const maneList: { at: THREE.Vector3; dir: THREE.Vector3; curl?: THREE.Vector3; len: number; width?: number }[] = [];
  const redList: typeof maneList = [];
  const creamList: typeof maneList = [];
  for (let ring = 0; ring < 4; ring++) {
    const z = -0.08 + ring * 0.15;
    const y = 0.0 + ring * 0.11;
    const rad = 0.42 - ring * 0.04;
    const count = 24 - ring * 3;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + ring * 0.3 + (r() - 0.5) * 0.2;
      if (Math.sin(a) < -0.75 && ring > 1) continue;
      const out = V(Math.cos(a), Math.sin(a) * 0.9 + 0.1, -0.35).normalize();
      const at = V(Math.cos(a) * rad, y + Math.sin(a) * rad * 0.9, z);
      if (Math.sin(a) < -0.55 && Math.abs(Math.cos(a)) < 0.42) {
        creamList.push({ at, dir: V(Math.cos(a) * 0.6, -1, 0.35 - ring * 0.1).normalize(), curl: V(0, 0, 1), len: 0.36 + r() * 0.2 - ring * 0.05, width: 1.2 });
        continue;
      }
      maneList.push({ at, dir: out, curl: V(0, -0.4, -1), len: 0.5 + r() * 0.25 - ring * 0.06, width: 1.3 });
    }
  }
  // Cheek ruffs, flaring out and back from the jaw line; a few strands tipped blood-red.
  const cheeks: typeof maneList = [];
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const y = -0.12 + k * 0.035;
      const at = V(sx * 0.2, y, 0.02 - k * 0.01);
      const dir = V(sx * 1, 0.1 - k * 0.05, -0.55 - r() * 0.3).normalize();
      (k % 3 === 1 ? redList : cheeks).push({ at, dir, curl: V(0, -1, 0), len: 0.22 + r() * 0.1 });
    }
  }
  mesh(tufts(maneList), m.fur, neck);
  mesh(tufts(creamList), m.cream, neck);
  mesh(tufts(cheeks), m.fur, head);
  mesh(tufts(redList), m.redTip, head, false);
  // Withers: a crest of tufts standing up along the top of the back.
  const withers: typeof maneList = [];
  for (let k = 0; k < 12; k++) {
    const z = 0.95 - k * 0.12;
    const y = 1.38 + (k < 6 ? 0.58 : 0.46);
    withers.push({ at: V((r() - 0.5) * 0.3, y - 0.08, z), dir: V((r() - 0.5) * 0.7, 0.5, -1).normalize(), curl: V(0, -1, 0), len: 0.26 + r() * 0.12, width: 1.4 });
  }
  mesh(tufts(withers), m.fur, body);
  // Shaggy belly fringe under the deep chest.
  const belly: typeof maneList = [];
  for (let k = 0; k < 10; k++) belly.push({ at: V((r() - 0.5) * 0.5, 0.82 + k * 0.01, 0.6 - k * 0.12), dir: V((r() - 0.5) * 0.4, -1, -0.3).normalize(), curl: V(0, 0, -1), len: 0.22 + r() * 0.1 });
  mesh(tufts(belly), m.fur, body);

  // Legs: hip/shoulder -> upper -> lower -> paw with four toes and dark claws.
  interface Leg {
    upper: THREE.Group;
    lower: THREE.Group;
    paw: THREE.Group;
    front: boolean;
    side: number;
    restU: number;
    restL: number;
    restP: number;
    phase: number;
  }
  const legs: Leg[] = [];
  const PAW_H = 0.12;
  const buildLeg = (parent: THREE.Object3D, at: THREE.Vector3, front: boolean, side: number) => {
    const upper = new THREE.Group();
    upper.position.copy(at);
    parent.add(upper);
    const L1 = front ? 0.62 : 0.56;
    const a1 = front ? 0.05 : -0.42;
    const a2 = front ? -0.05 : 0.95;
    // The foot reaches the ground: solve the lower length from the rest angles.
    const hipY = parent.position.y + at.y;
    const L2 = (hipY - PAW_H - L1 * Math.cos(a1)) / Math.cos(a1 + a2);
    mesh(loft([V(0, 0.12, 0), V(0, -L1 * 0.45, 0.02), V(0, -L1, 0)], front ? [
      [0.2, 0.26],
      [0.15, 0.18],
      [0.11, 0.12],
    ] : [
      [0.22, 0.3],
      [0.17, 0.22],
      [0.1, 0.12],
    ], 12, 0.06, front ? 21 : 23), m.fur, upper);
    const lower = new THREE.Group();
    lower.position.set(0, -L1, 0);
    upper.add(lower);
    mesh(loft([V(0, 0.04, 0), V(0, -L2 * 0.5, 0), V(0, -L2, 0.01)], [
      [0.11, 0.11],
      [0.08, 0.085],
      [0.07, 0.075],
    ], 10, 0.03, front ? 25 : 27), m.fur, lower);
    const paw = new THREE.Group();
    paw.position.set(0, -L2, 0);
    lower.add(paw);
    mesh(ellipsoid(0.12, 0.065, 0.15, 12), m.fur, paw).position.set(0, -PAW_H + 0.06, 0.05);
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * 0.055;
      const toe = mesh(ellipsoid(0.038, 0.034, 0.05, 8), m.fur, paw);
      toe.position.set(x, -PAW_H + 0.035, 0.15 - Math.abs(k - 1.5) * 0.02);
      const claw = new THREE.ConeGeometry(0.012, 0.06, 6);
      claw.rotateX(Math.PI / 2 + 0.6);
      const c = mesh(claw, m.claw, paw, false);
      c.position.set(x, -PAW_H + 0.02, 0.2 - Math.abs(k - 1.5) * 0.02);
    }
    // Feathering behind the elbow / hock.
    const fr: typeof maneList = [];
    for (let k = 0; k < 4; k++) fr.push({ at: V((r() - 0.5) * 0.1, -0.1 - k * 0.1, -0.12), dir: V(0, -0.6, -1).normalize(), curl: V(0, -1, 0), len: 0.16 + r() * 0.08 });
    mesh(tufts(fr), m.fur, upper);
    upper.rotation.x = a1;
    lower.rotation.x = a2;
    paw.rotation.x = -(a1 + a2);
    legs.push({ upper, lower, paw, front, side, restU: a1, restL: a2, restP: -(a1 + a2), phase: 0 });
  };
  buildLeg(chest, V(-0.27, 0.12, 0.08), true, -1);
  buildLeg(chest, V(0.27, 0.12, 0.08), true, 1);
  buildLeg(hips, V(-0.25, 0, 0), false, -1);
  buildLeg(hips, V(0.25, 0, 0), false, 1);

  // A thick, bushy tail in three segments.
  const tail: THREE.Group[] = [];
  let tParent: THREE.Object3D = hips;
  let tPos = V(0, 0.08, -0.3);
  for (let k = 0; k < 3; k++) {
    const seg = new THREE.Group();
    seg.position.copy(tPos);
    seg.rotation.x = k === 0 ? -2.3 : -0.25;
    tParent.add(seg);
    const L = 0.42;
    const r0 = 0.13 - k * 0.025;
    mesh(loft([V(0, 0, 0), V(0, L * 0.5, 0), V(0, L, 0)], [
      [r0, r0],
      [r0 * 1.05, r0 * 1.05],
      [r0 * 0.85, r0 * 0.85],
    ], 10, 0.05, 31 + k), m.fur, seg);
    const tt: typeof maneList = [];
    for (let j = 0; j < 9; j++) {
      const a = (j / 9) * Math.PI * 2;
      tt.push({ at: V(Math.cos(a) * r0 * 0.8, (j % 3) * 0.13 + 0.05, Math.sin(a) * r0 * 0.8), dir: V(Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8).normalize(), curl: V(0, 1, 0), len: 0.22 + r() * 0.1 - k * 0.02 });
    }
    mesh(tufts(tt), m.fur, seg);
    tail.push(seg);
    tParent = seg;
    tPos = V(0, L, 0);
  }

  // Embers and dark wisps drifting off the mane (world space, updated with the body).
  const embers = new PuffEmitter(14, { life: 1.6, rise: 0.6, spread: 0.45, size0: 0.1, size1: 0.025, alpha: 0.8, color: 0xff3a10, color2: 0x5a0a04, additive: true });
  const smoke = new PuffEmitter(10, { life: 2.2, rise: 0.35, spread: 0.5, size0: 0.25, size1: 0.6, alpha: 0.22, color: 0x1a1414, color2: 0x0a0808, additive: false });
  const fx = [embers, smoke];

  // ------------------------------------------------------------ animation
  const st = { t: 0, gait: 0, roar: 0, dead: 0, eyeGlow: 1 };
  const chestBase = chest.position.clone();
  const neckRest = -0.32;
  const headRest = 0.15;
  const tmp = new THREE.Vector3();
  const wolf: AlphaWolf = {
    root,
    mats: [m.fur, m.cream],
    fx,
    mode: 'idle',
    attack: 0,
    bite: 0.5,
    updateAnim(dt, p) {
      st.t += dt;
      const mode = p.mode;
      wolf.mode = mode;
      if (mode === 'roar') st.roar = Math.min(1, st.roar + dt * 4);
      else st.roar = Math.max(0, st.roar - dt * 2);
      const breathe = Math.sin(st.t * 1.6);

      if (mode === 'death') {
        st.dead = Math.min(1, st.dead + dt * 1.4);
        const e = st.dead * st.dead * (3 - 2 * st.dead);
        root.rotation.z = e * 1.45;
        root.position.y = -e * 0.35;
        for (const l of legs) {
          l.upper.rotation.x = l.restU + e * (l.front ? 0.5 : -0.6);
          l.lower.rotation.x = l.restL + e * (l.front ? -0.9 : 0.9);
        }
        neck.rotation.x = neckRest + e * 0.5;
        head.rotation.x = headRest + e * 0.3;
        jaw.rotation.x = e * 0.35;
        st.eyeGlow = Math.max(0, st.eyeGlow - dt * 0.5);
        m.eye.emissiveIntensity = 2.6 * st.eyeGlow;
        m.mark.emissiveIntensity = 1.2 * st.eyeGlow;
        m.nose.emissiveIntensity = 0.5 * st.eyeGlow;
        for (const f of fx) {
          f.points.visible = st.eyeGlow > 0.4;
          f.update(dt);
        }
        return;
      }

      // Gait: diagonal walk, or a gallop (fronts together, hinds together).
      const run = mode === 'run';
      const moving = mode === 'walk' || run;
      const freq = run ? 1.9 : 0.9 + p.speed * 0.25;
      if (moving) st.gait += dt * freq;
      const g = st.gait * Math.PI * 2;
      const swingA = run ? 0.75 : 0.4;
      for (const l of legs) {
        let ph: number;
        if (run) ph = l.front ? (l.side < 0 ? 0 : 0.12) : l.side < 0 ? 0.5 : 0.62;
        else ph = (l.front ? 0 : 0.5) + (l.side < 0 ? 0 : 0.5);
        const s = Math.sin(g + ph * Math.PI * 2);
        const lift = Math.max(0, Math.cos(g + ph * Math.PI * 2));
        const k = moving ? 1 : 0;
        l.upper.rotation.x = l.restU + k * s * swingA * (l.front ? 1 : 0.85);
        l.lower.rotation.x = l.restL + k * lift * (l.front ? (run ? 1.2 : 0.8) : run ? 0.7 : 0.45);
        l.paw.rotation.x = -(l.upper.rotation.x + l.lower.rotation.x) + k * lift * 0.4;
      }
      // Spine: a bob and, at the gallop, the flex and stretch of each bound.
      const bob = moving ? Math.abs(Math.sin(g)) * (run ? 0.08 : 0.03) : 0;
      body.position.y = bob - (run ? 0.04 : 0);
      chest.rotation.x = run ? Math.sin(g) * 0.12 : 0;
      hips.rotation.x = run ? -Math.sin(g) * 0.1 : 0;
      chest.position.y = chestBase.y;

      // Breathing: the chest swells, shoulders and mane roll a little.
      const br = mode === 'idle' ? 0.03 : 0.012;
      chest.scale.set(1 + breathe * br, 1 + breathe * br * 0.6, 1);

      // Head: low and staring at idle, nodding with the walk, flattened for the gallop.
      let neckX = neckRest + (mode === 'idle' ? 0.14 : run ? 0.3 : 0.08) + (moving ? Math.sin(g * 2) * 0.04 : 0);
      let headX = headRest + (mode === 'idle' ? 0.05 : 0);
      let jawX = mode === 'idle' ? 0.08 + breathe * 0.03 : run ? 0.25 : 0.05;
      let lunge = 0;

      if (mode === 'attack') {
        // Wind-up: crouch and pull back; strike: neck shoots out, jaws gape; bite; recover.
        const a = THREE.MathUtils.clamp(p.attack ?? 0, 0, 1);
        const b = p.bite ?? 0.5;
        if (a < b) {
          const w = a / b;
          lunge = -0.25 * Math.sin(w * Math.PI * 0.5);
          neckX += 0.25 * w;
          jawX = 0.2 + 0.7 * w;
          body.position.y -= 0.12 * w;
        } else {
          const w = (a - b) / (1 - b);
          const snap = w < 0.15 ? w / 0.15 : 1;
          lunge = 0.45 * (1 - w) * snap - 0.25 * (1 - snap);
          neckX -= 0.35 * (1 - w);
          jawX = w < 0.12 ? 0.9 * (1 - w / 0.12) : 0.05;
        }
      }
      if (st.roar > 0) {
        // Roar: chest and head up, jaws wide, mane bristling.
        neckX = THREE.MathUtils.lerp(neckX, neckRest - 0.12, st.roar);
        headX = THREE.MathUtils.lerp(headX, -0.05, st.roar);
        jawX = THREE.MathUtils.lerp(jawX, 0.95, st.roar);
        chest.rotation.x -= 0.15 * st.roar;
      }
      neck.rotation.x = neckX;
      head.rotation.x = headX;
      jaw.rotation.x = jawX;
      neck.position.z = 0.42 + lunge;
      neck.scale.setScalar(1 + st.roar * 0.06);
      // Ears flatten back at the gallop and in the lunge, prick up to roar.
      const earBack = run ? 0.75 : mode === 'attack' ? 0.5 : -0.1 * st.roar;
      for (const e of ears) e.rotation.x += (-0.15 - earBack - e.rotation.x) * Math.min(1, dt * 8);

      // Tail: a slow sway, streaming out behind at speed.
      for (let k = 0; k < tail.length; k++) {
        tail[k].rotation.z = Math.sin(st.t * (moving ? 3 : 1.2) - k * 0.6) * (0.12 + k * 0.05);
        if (k === 0) tail[k].rotation.x = run ? -1.7 : moving ? -2.0 : -2.3;
      }

      // Embers and smoke from the chest.
      chest.localToWorld(tmp.set(0, 0.0, 0.5));
      for (const f of fx) {
        f.origin.copy(tmp);
        f.update(dt);
      }
    },
  };
  return wolf;
}
