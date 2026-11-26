import * as THREE from 'three';
import { barkMaterial } from '../world/pines';
import { AssetName, library } from '../assets/assets';
import { detailTextures } from '../world/textures';

/**
 * A CC0 model from public/assets, normalised (base at the origin) and wrapped so
 * callers keep the conventions below. Returns null before the library loads.
 */
function fromAsset(name: AssetName, fit: { by: 'height' | 'max' | 'footprint'; value: number }, setup: (inner: THREE.Group) => void): THREE.Group | null {
  const lib = library();
  if (!lib || !lib.has(name)) return null;
  const inner = lib.instance(name, fit);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });
  setup(inner);
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

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

export { buildAxe, buildTacticalAxe } from './axes';

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
    // Logs wear the same Poly Haven pine bark as the trees they came from.
    void tex;
    const ring = std(0xcaa472, 0.8);
    _logMats = [barkMaterial(), ring, ring];
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

/** Set when the CC0 spear's point faces +Z so it is turned to point along -Z. */
export let SPEAR_FLIP = true;
export function setSpearFlip(v: boolean): void {
  SPEAR_FLIP = v;
}

/** Sharpened wooden spear. Origin = grip, point along -Z. */
export function buildSpear(): THREE.Group {
  // The CC0 spear lies along Z; centre it on the grip a third of the way back.
  const a = fromAsset('spear', { by: 'max', value: 1.8 }, (i) => {
    i.rotation.y = SPEAR_FLIP ? Math.PI : 0;
    i.position.set(0, -0.06, -0.4);
  });
  if (a) return a;
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
  const model = fromAsset('bow', { by: 'height', value: 1.1 }, (i) => {
    i.position.y = -0.55;
    i.rotation.y = Math.PI / 2;
  });
  const sg0 = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.53, 0.02), new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(0, -0.53, 0.02)]);
  if (model) {
    const string = new THREE.Line(sg0, new THREE.LineBasicMaterial({ color: 0xe8e2cf }));
    const nock = new THREE.Object3D();
    nock.position.set(0, 0, 0.02);
    g.add(model, string, nock);
    return { group: g, string, nock };
  }
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
  // CC0 arrow stands along +Y with its head up; lay it along -Z with the nock at the origin.
  const a = fromAsset('arrow', { by: 'max', value: 0.74 }, (i) => (i.rotation.x = -Math.PI / 2));
  if (a) return a;
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
  const a = fromAsset('torch', { by: 'height', value: 0.56 }, (i) => (i.position.y = -0.08));
  if (a) {
    const flame = new THREE.Object3D();
    flame.name = 'flame';
    flame.position.y = 0.5;
    a.add(flame);
    return a;
  }
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
  const a = fromAsset('rod', { by: 'height', value: 1.45 }, (i) => (i.position.y = -0.12));
  if (a) {
    const tip = new THREE.Object3D();
    tip.name = 'tip';
    tip.position.y = 1.32;
    a.add(tip);
    return a;
  }
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

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const meatMats: Partial<Record<'raw' | 'cooked', THREE.MeshStandardMaterial[]>> = {};

/** Marbled steak face (raw) or seared crust with grill marks (cooked). */
function meatMaterials(cooked: boolean): THREE.MeshStandardMaterial[] {
  const key = cooked ? 'cooked' : 'raw';
  const cachedMats = meatMats[key];
  if (cachedMats) return cachedMats;
  let seed = cooked ? 7 : 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const face = canvasTex(256, 256, (g) => {
    g.fillStyle = cooked ? '#6b3417' : '#a8282b';
    g.fillRect(0, 0, 256, 256);
    // Fat marbling: thin wandering streaks.
    g.strokeStyle = cooked ? 'rgba(214,160,96,0.55)' : 'rgba(246,226,214,0.85)';
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 1 + rnd() * 3.5;
      g.beginPath();
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rnd() - 0.5) * 60;
        y += (rnd() - 0.5) * 60;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cooked ? `rgba(40,16,6,${rnd() * 0.25})` : `rgba(90,10,14,${rnd() * 0.3})`;
      g.fillRect(rnd() * 256, rnd() * 256, 3, 3);
    }
    if (cooked) {
      g.strokeStyle = 'rgba(25,10,4,0.85)';
      g.lineWidth = 9;
      for (let i = -1; i < 5; i++) {
        g.beginPath();
        g.moveTo(i * 60, 0);
        g.lineTo(i * 60 + 140, 256);
        g.stroke();
      }
    }
  });
  const edge = canvasTex(64, 64, (g) => {
    g.fillStyle = cooked ? '#4a240f' : '#e9d6c2';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = cooked ? '#6b3417' : '#b23a33';
    g.fillRect(0, 22, 64, 30);
  });
  const mats = [
    new THREE.MeshStandardMaterial({ map: face, roughness: cooked ? 0.75 : 0.45 }),
    new THREE.MeshStandardMaterial({ map: edge, roughness: cooked ? 0.8 : 0.5 }),
  ];
  meatMats[key] = mats;
  return mats;
}

/** A cut of meat on the bone: irregular slab with marbled faces and a bone. Origin at its base. */
export function buildMeat(cooked: boolean): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const pts = 14;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = 0.11 * (1 + 0.16 * Math.sin(a * 3 + 1) + 0.08 * Math.cos(a * 5));
    const x = Math.cos(a) * r * 1.35;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
  // Planar UVs on the faces so the marbling is not stretched.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 3 + 0.5, pos.getY(i) * 3 + 0.5);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.012, 0);
  const mats = meatMaterials(cooked);
  const slab = new THREE.Mesh(geo, [mats[0], mats[1]]);
  slab.castShadow = true;
  const boneMat = new THREE.MeshStandardMaterial({ color: cooked ? 0xd8c4a0 : 0xf1e8d6, roughness: 0.55 });
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.16, 8), boneMat);
  bone.rotation.z = Math.PI / 2;
  bone.position.set(0.19, 0.035, 0.01);
  const knob1 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), boneMat);
  knob1.position.set(0.27, 0.04, 0.018);
  const knob2 = knob1.clone();
  knob2.position.set(0.27, 0.035, -0.014);
  g.add(slab, bone, knob1, knob2);
  return g;
}

let hideMats: THREE.Material[] | null = null;

/** Rolled animal hide tied with two cords. Origin at its base. */
export function buildHide(): THREE.Group {
  if (!hideMats) {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const leather = canvasTex(128, 128, (g) => {
      g.fillStyle = '#8a5f3a';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1400; i++) {
        const v = rnd();
        g.fillStyle = v > 0.5 ? `rgba(120,84,52,${rnd() * 0.5})` : `rgba(70,44,24,${rnd() * 0.4})`;
        g.fillRect(rnd() * 128, rnd() * 128, 2 + rnd() * 4, 1 + rnd() * 2);
      }
    });
    const spiral = canvasTex(128, 128, (g) => {
      g.fillStyle = '#6e4a2c';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#b48a5e';
      g.lineWidth = 4;
      g.beginPath();
      for (let a = 0; a < Math.PI * 10; a += 0.1) {
        const r = 4 + a * 1.8;
        g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      g.stroke();
    });
    spiral.wrapS = spiral.wrapT = THREE.ClampToEdgeWrapping;
    hideMats = [
      new THREE.MeshStandardMaterial({ map: leather, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: spiral, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: spiral, roughness: 0.9 }),
    ];
  }
  const g = new THREE.Group();
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.46, 14), hideMats);
  roll.rotation.z = Math.PI / 2;
  roll.position.y = 0.1;
  roll.castShadow = true;
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 1 });
  for (const x of [-0.13, 0.13]) {
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.103, 0.009, 6, 18), cordMat);
    cord.rotation.y = Math.PI / 2;
    cord.position.set(x, 0.1, 0);
    g.add(cord);
  }
  // A loose flap of fur on top.
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.08), hideMats[0]);
  flap.position.set(0.02, 0.19, 0.06);
  flap.rotation.set(0.5, 0.1, 0);
  g.add(roll, flap);
  return g;
}

// ------------------------------------------------------------------ tribal pieces

const featherMats: Record<string, THREE.MeshStandardMaterial> = {};
/** A feather on a canvas: quill, notched vane, dark bars, coloured tip (alpha cut-out). */
export function featherMaterial(kind: 'dark' | 'eagle'): THREE.MeshStandardMaterial {
  if (featherMats[kind]) return featherMats[kind];
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const base = kind === 'dark' ? '#2b2420' : '#6a4a2c';
  const bar = kind === 'dark' ? '#16110e' : '#efe6d2';
  const tip = kind === 'dark' ? '#5e1a12' : '#1c1410';
  g.save();
  g.beginPath();
  g.moveTo(32, 250);
  g.bezierCurveTo(4, 200, 6, 60, 30, 6);
  g.lineTo(34, 6);
  g.bezierCurveTo(58, 60, 60, 200, 32, 250);
  g.closePath();
  g.clip();
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, tip);
  grd.addColorStop(0.22, base);
  grd.addColorStop(1, base);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = bar;
  g.globalAlpha = kind === 'dark' ? 0.7 : 0.85;
  for (let y = 40; y < 230; y += 26) g.fillRect(0, y, 64, 9);
  g.globalAlpha = 1;
  // Barbs, and a few splits in the vane.
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let y = 10; y < 250; y += 4) {
    g.beginPath();
    g.moveTo(32, y + 6);
    g.lineTo(4, y);
    g.moveTo(32, y + 6);
    g.lineTo(60, y);
    g.stroke();
  }
  g.globalCompositeOperation = 'destination-out';
  for (const [x, y] of [
    [8, 120],
    [56, 170],
    [10, 200],
  ]) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(32, y + 14);
    g.lineTo(x, y + 4);
    g.fill();
  }
  g.restore();
  g.strokeStyle = '#d8cdb6';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(32, 256);
  g.lineTo(32, 12);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  featherMats[kind] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.5 });
  return featherMats[kind];
}

/** A feather `len` long, quill at the origin, pointing up (+Y), slightly curved back. */
export function buildFeather(len: number, kind: 'dark' | 'eagle'): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(len * 0.25, len, 1, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / len + 0.5;
    p.setZ(i, -y * y * len * 0.12);
  }
  geo.translate(0, len / 2, 0);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, featherMaterial(kind));
  m.castShadow = true;
  return m;
}

/** A curved, tapering horn: chained frustums bending back in the YZ plane (base at origin, tip up). */
export function buildHorn(len: number, r0: number, bend: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const n = 6;
  const pt = (t: number) => new THREE.Vector3(0, (Math.sin(t * bend) / bend) * len, -((1 - Math.cos(t * bend)) / bend) * len);
  for (let i = 0; i < n; i++) {
    const a = pt(i / n);
    const b = pt((i + 1) / n);
    const ra = r0 * (1 - (i / n) * 0.85);
    const rb = r0 * (1 - ((i + 1) / n) * 0.85);
    const d = new THREE.Vector3().subVectors(b, a);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, d.length() * 1.04, 8), mat);
    seg.position.copy(a).addScaledVector(d, 0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    seg.castShadow = true;
    g.add(seg);
  }
  return g;
}

/** A bone with knuckled ends, `len` long along X. */
export function buildBone(len: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.06, len * 0.07, len * 0.8, 7), mat);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  for (const s of [-1, 1]) {
    for (const k of [-1, 1]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(len * 0.085, 8, 6), mat);
      knob.position.set(s * len * 0.42, 0, k * len * 0.06);
      g.add(knob);
    }
  }
  return g;
}

interface TotemMats {
  wood: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  ochre: THREE.MeshStandardMaterial;
  core: THREE.MeshStandardMaterial;
  cord: THREE.MeshStandardMaterial;
  pit: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
}
let totemMats: TotemMats | null = null;
function totemMaterials(): TotemMats {
  if (!totemMats) {
    const t = detailTextures();
    totemMats = {
      wood: new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85, map: t.bark, bumpMap: t.barkBump, bumpScale: 2.5 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x3e2a1a, roughness: 0.9, map: t.bark, bumpMap: t.barkBump, bumpScale: 2 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8b8780, roughness: 0.85, map: t.rock, bumpMap: t.rockBump, bumpScale: 2, flatShading: true }),
      bone: new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.65, bumpMap: t.rockBump, bumpScale: 0.6 }),
      ochre: new THREE.MeshStandardMaterial({ color: 0x9a2a1c, roughness: 0.8 }),
      core: new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff4a10, emissiveIntensity: 1.6, roughness: 0.3 }),
      cord: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }),
      pit: new THREE.MeshStandardMaterial({ color: 0x0c0705, roughness: 1 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x0a0604, emissive: 0x401006, emissiveIntensity: 0.8, roughness: 1 }),
    };
  }
  return totemMats;
}

/**
 * The Tribal Totem the chief drops: a carved post on a stone plinth, a scowling face
 * carved in relief, horns and crossed bones, a fan of feathers and a glowing amulet set
 * into its chest. Origin at its base, about 0.8 m tall.
 */
export function buildTotem(): THREE.Group {
  const g = new THREE.Group();
  const m = totemMaterials();
  const add = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true;
    });
    g.add(o);
    return o;
  };
  // Plinth: rough stone with a carved wooden step on top.
  const plinth = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.07, 9), m.stone));
  plinth.position.y = 0.035;
  const step = add(new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.05, 8), m.dark));
  step.position.y = 0.095;
  // Carved post: a lathe profile with cut rings and bulges.
  const P = [
    [0.0, 0.0], [0.095, 0.0], [0.1, 0.03], [0.082, 0.05], [0.09, 0.09], [0.096, 0.13], [0.078, 0.15], [0.085, 0.19],
    [0.088, 0.3], [0.072, 0.32], [0.082, 0.35], [0.09, 0.42], [0.07, 0.45], [0.075, 0.47], [0.0, 0.47],
  ];
  const post = add(new THREE.Mesh(new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 10), m.wood));
  post.position.y = 0.12;
  // Ochre bands in the carved grooves.
  for (const y of [0.17, 0.27, 0.44]) {
    const band = add(new THREE.Mesh(new THREE.TorusGeometry(0.081, 0.008, 4, 16), m.ochre));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
  }
  // Glowing amulet in a stone setting on the chest.
  const setting = add(new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.012, 6, 12), m.stone));
  setting.position.set(0, 0.24, 0.088);
  const core = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), m.core));
  core.position.set(0, 0.24, 0.094);
  core.scale.set(0.8, 1.1, 0.6);
  // Carved face in relief: mask plate, brow ridge, sunk eyes, nose and bared teeth.
  const face = new THREE.Shape();
  face.moveTo(0, 0.085);
  face.bezierCurveTo(0.07, 0.085, 0.078, 0.02, 0.06, -0.04);
  face.lineTo(0.0, -0.095);
  face.lineTo(-0.06, -0.04);
  face.bezierCurveTo(-0.078, 0.02, -0.07, 0.085, 0, 0.085);
  const plate = add(new THREE.Mesh(new THREE.ExtrudeGeometry(face, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 }), m.dark));
  plate.position.set(0, 0.47, 0.07);
  for (const s of [-1, 1]) {
    const brow = add(new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.02, 0.03), m.wood));
    brow.position.set(s * 0.032, 0.5, 0.104);
    brow.rotation.z = s * -0.35;
    const eye = add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), m.eye));
    eye.position.set(s * 0.03, 0.478, 0.097);
    eye.scale.set(1.3, 0.6, 0.5);
    const paint = add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.004), m.ochre));
    paint.position.set(s * 0.03, 0.448, 0.101);
  }
  const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.045, 4), m.wood));
  nose.position.set(0, 0.462, 0.103);
  nose.rotation.x = 0.35;
  const mouth = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.022, 0.01), m.pit));
  mouth.position.set(0, 0.425, 0.097);
  for (let k = 0; k < 6; k++) {
    const tooth = add(new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.016, 4), m.bone));
    tooth.position.set(-0.027 + k * 0.011, 0.432 - (k % 2) * 0.012, 0.102);
    tooth.rotation.z = k % 2 ? 0 : Math.PI;
  }
  // Head block: horns sweeping up and out, crossed bones behind.
  const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.06, 8), m.dark));
  cap.position.y = 0.62;
  for (const s of [-1, 1]) {
    const horn = buildHorn(0.2, 0.022, 1.4, m.bone);
    horn.position.set(s * 0.065, 0.63, 0);
    horn.rotation.set(0, (-s * Math.PI) / 2, -s * 0.5);
    add(horn);
  }
  for (const s of [-1, 1]) {
    const b = buildBone(0.3, m.bone);
    b.position.set(0, 0.6, -0.07);
    b.rotation.z = s * 0.7;
    add(b);
  }
  // Fan of feathers bound with cord.
  for (let k = 0; k < 7; k++) {
    const a = (k - 3) * 0.22;
    const f = buildFeather(0.26 + (k % 2) * 0.04, k % 3 === 1 ? 'dark' : 'eagle');
    f.position.set(Math.sin(a) * 0.03, 0.64, -0.04);
    f.rotation.set(-0.25, 0, -a);
    add(f);
  }
  const wrap = add(new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 5, 14), m.cord));
  wrap.rotation.x = Math.PI / 2;
  wrap.position.y = 0.65;
  // Strings of bone beads hanging from the cap.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const bead = add(new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), k % 2 ? m.bone : m.ochre));
      bead.position.set(s * 0.09, 0.6 - k * 0.026, 0.02);
    }
  }
  return g;
}

export function buildFish(cooked: boolean): THREE.Group {
  const a = fromAsset('fish', { by: 'max', value: 0.3 }, (i) => {
    if (!cooked) return;
    i.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.setRGB(0.55, 0.33, 0.16);
        m.material = mat;
      }
    });
  });
  if (a) return a;
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


