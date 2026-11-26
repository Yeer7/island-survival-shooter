import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * The two axes, sculpted in code from parametric meshes (no flat extrusions).
 * Convention: origin = the grip point, the handle runs up +Y, the head sits around
 * y = 0.47 with the cutting edge facing -Z and the back (hook / hammer) toward +Z;
 * the head's thickness is along X, symmetric on both sides.
 */

const HEAD_Y = 0.47;
const TAU = Math.PI * 2;

/** A grid surface (rows i, columns j) with position, uv and per-vertex colour. */
function grid(ni: number, nj: number, fn: (i: number, j: number) => { p: THREE.Vector3; u: number; v: number; c?: THREE.Color }): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      const q = fn(i, j);
      pos.push(q.p.x, q.p.y, q.p.z);
      uv.push(q.u, q.v);
      const c = q.c ?? WHITE;
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  const row = nj + 1;
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const WHITE = new THREE.Color(1, 1, 1);

/** Cross-section of the head at a station: centre height, half-height, half-thickness. */
interface Station {
  z: number;
  c: number;
  hh: number;
  h: number;
}

/**
 * Loft the head along Z between stations s0..s1 of `at`. Each ring is a superellipse
 * (exponent `p`: 1 = faceted lens, <1 = boxy), so the head is a solid wedge with a
 * thick eye, cheeks that thin toward the edge, and a front edge bowed forward.
 */
function loftHead(at: (s: number) => Station, s0: number, s1: number, cols: number, ring: number, p: number, bow: number, paint?: (s: number, th: number) => THREE.Color): THREE.BufferGeometry {
  return grid(cols, ring, (i, j) => {
    const s = s0 + ((s1 - s0) * i) / cols;
    const st = at(s);
    const th = (j / ring) * TAU;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const x = st.h * Math.sign(cs) * Math.pow(Math.abs(cs), p);
    const y = st.c + st.hh * Math.sign(sn) * Math.pow(Math.abs(sn), p);
    // The cutting edge bows forward at mid-height.
    const z = st.z - bow * Math.pow(Math.max(0, s - 0.55) / 0.45, 1.5) * (1 - sn * sn);
    return { p: new THREE.Vector3(x, y, z), u: s, v: j / ring, c: paint?.(s, th) };
  });
}

/** Oval handle along a curve: sections ~`oval`× wider along Z than X. */
function ovalHandle(curve: THREE.Curve<THREE.Vector3>, t0: number, t1: number, rx: (t: number) => number, oval: number, rows: number, segs: number, grainV: number, cap: boolean): THREE.BufferGeometry {
  const X = new THREE.Vector3(1, 0, 0);
  const geo = grid(rows, segs, (i, j) => {
    const t = t0 + ((t1 - t0) * i) / rows;
    const c = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const N = new THREE.Vector3().crossVectors(T, X).normalize();
    const phi = (j / segs) * TAU;
    const r = rx(t);
    const p = c.clone().addScaledVector(X, Math.cos(phi) * r).addScaledVector(N, Math.sin(phi) * r * oval);
    return { p, u: j / segs, v: t * grainV };
  });
  if (!cap) return geo;
  // Close the butt with a fan.
  const c = curve.getPointAt(t0);
  const T = curve.getTangentAt(t0);
  const N = new THREE.Vector3().crossVectors(T, X).normalize();
  const pos: number[] = [];
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * TAU;
    const b = ((j + 1) / segs) * TAU;
    const r = rx(t0);
    const pa = c.clone().addScaledVector(X, Math.cos(a) * r).addScaledVector(N, Math.sin(a) * r * oval);
    const pb = c.clone().addScaledVector(X, Math.cos(b) * r).addScaledVector(N, Math.sin(b) * r * oval);
    const tip = c.clone().addScaledVector(T, -0.004);
    pos.push(tip.x, tip.y, tip.z, pb.x, pb.y, pb.z, pa.x, pa.y, pa.z);
  }
  const fan = new THREE.BufferGeometry();
  fan.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fan.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0.5), 2));
  fan.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  fan.computeVertexNormals();
  const flat = [geo.toNonIndexed(), fan];
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(flat.reduce((n, g) => n + g.attributes[name].count * size, 0));
    let o = 0;
    for (const g of flat) {
      arr.set(g.attributes[name].array as Float32Array, o);
      o += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, mulberry32(seed));
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Dark wood with clean grain running the length of the handle (v = along). */
function woodGrain(): THREE.CanvasTexture {
  return canvasTex(
    64,
    256,
    (g, r) => {
      g.fillStyle = '#4b3220';
      g.fillRect(0, 0, 64, 256);
      for (let k = 0; k < 46; k++) {
        const x = r() * 64;
        const w = 0.6 + r() * 1.8;
        g.fillStyle = r() < 0.5 ? `rgba(30,18,10,${0.35 + r() * 0.3})` : `rgba(120,84,52,${0.2 + r() * 0.25})`;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= 256; y += 16) g.lineTo(x + Math.sin(y * 0.03 + k) * 1.5, y);
        g.lineTo(x + w, 256);
        for (let y = 256; y >= 0; y -= 16) g.lineTo(x + w + Math.sin(y * 0.03 + k) * 1.5, y);
        g.fill();
      }
    },
    21,
  );
}

/** Dark forged steel: soft hammer-scale mottling, mapped once over the head (u along, v round). */
function forged(): THREE.CanvasTexture {
  return canvasTex(
    256,
    128,
    (g, r) => {
      g.fillStyle = '#8e939a';
      g.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${r() < 0.6 ? '28,29,32' : '125,130,136'},${0.1 + r() * 0.18})`;
        g.beginPath();
        g.ellipse(r() * 256, r() * 128, 3 + r() * 10, 2 + r() * 6, r() * 3, 0, TAU);
        g.fill();
      }
    },
    43,
  );
}

/** Knurled rubber (fine diamond pattern). */
function knurl(): THREE.CanvasTexture {
  const t = canvasTex(
    64,
    64,
    (g) => {
      g.fillStyle = '#2a2c2f';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(6,6,7,0.95)';
      g.lineWidth = 1.2;
      for (let i = -64; i < 128; i += 5) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 64, 64);
        g.stroke();
        g.beginPath();
        g.moveTo(i + 64, 0);
        g.lineTo(i, 64);
        g.stroke();
      }
    },
    7,
  );
  t.repeat.set(5, 7);
  return t;
}

let mats: Record<string, THREE.MeshStandardMaterial> | null = null;
function M(): Record<string, THREE.MeshStandardMaterial> {
  if (mats) return mats;
  const kn = knurl();
  mats = {
    wood: new THREE.MeshStandardMaterial({ map: woodGrain(), roughness: 0.7, metalness: 0 }),
    wrap: new THREE.MeshStandardMaterial({ map: kn, bumpMap: kn, bumpScale: 1.5, color: 0x77797c, roughness: 0.95, metalness: 0 }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.16, metalness: 0.6 }),
    forged: new THREE.MeshStandardMaterial({ map: forged(), color: 0xd0d4d8, roughness: 0.48, metalness: 0.18, flatShading: true }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x60646b, roughness: 0.68, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ map: kn, bumpMap: kn, bumpScale: 2, roughness: 0.95, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.5, metalness: 0.55 }),
    bolt: new THREE.MeshStandardMaterial({ color: 0x9a9fa5, roughness: 0.35, metalness: 0.65 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 1 }),
  };
  return mats;
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.frustumCulled = false;
  return o;
};

/** 0 at `a`, 1 at `b` (either order). */
const smooth = (a: number, b: number, x: number) => (a < b ? THREE.MathUtils.smoothstep(x, a, b) : 1 - THREE.MathUtils.smoothstep(x, b, a));

/** Emergency / fire axe: S-curved oval wood handle, satin red sculpted head with a polished bevel and a curved spike. */
export function buildAxe(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  g.name = 'axe';
  // Handle: oval sections along an S curve, thicker grip and a flared butt.
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.16, 0.014), new THREE.Vector3(0, -0.05, -0.006), new THREE.Vector3(0, 0.1, -0.012), new THREE.Vector3(0, 0.27, 0.004), new THREE.Vector3(0, 0.5, 0)]);
  const rx = (t: number) => 0.0122 + 0.0035 * smooth(0.45, 0.15, t) + 0.004 * smooth(0.06, 0, t);
  g.add(mesh(ovalHandle(curve, 0, 1, rx, 1.5, 40, 12, 3, true), m.wood));
  g.add(mesh(ovalHandle(curve, 0.05, 0.33, (t) => rx(t) + 0.0016, 1.45, 16, 12, 1, false), m.wrap));
  // Head: back spike (s 0 → 0.38), eye (0.38 → 0.55), cheek to the edge (0.55 → 1).
  const at = (s: number): Station => {
    if (s < 0.38) {
      const k = s / 0.38; // 0 at the spike tip, 1 at the eye
      return { z: 0.135 - k * 0.105, c: HEAD_Y + 0.006 - Math.pow(1 - k, 2) * 0.03, hh: 0.002 + 0.031 * Math.pow(k, 0.7), h: 0.0012 + 0.0165 * Math.pow(k, 0.6) };
    }
    if (s < 0.55) {
      const k = (s - 0.38) / 0.17;
      return { z: 0.03 - k * 0.055, c: HEAD_Y + 0.004, hh: 0.035, h: 0.0185 + 0.0015 * Math.sin(Math.PI * k) };
    }
    const k = (s - 0.55) / 0.45;
    return { z: -0.025 - k * 0.095, c: HEAD_Y + 0.004, hh: 0.035 + 0.043 * Math.pow(k, 1.5), h: 0.001 + 0.0175 * Math.pow(1 - k, 1.35) };
  };
  const red = new THREE.Color(0.74, 0.11, 0.08);
  const worn = new THREE.Color(0.52, 0.5, 0.48);
  const paint = (s: number, th: number) => {
    // Satin red; bare metal only where the paint rubs off: the corners and the spike tip.
    const corner = Math.pow(Math.abs(Math.sin(th)), 14);
    const noise = 0.5 + 0.5 * Math.sin(s * 91 + th * 7) * Math.sin(s * 37 - th * 3);
    const wear = THREE.MathUtils.clamp(corner * 1.4 * noise + smooth(0.1, 0, s) * 0.8, 0, 1);
    return red.clone().lerp(worn, wear * 0.75);
  };
  const BEVEL = 0.83;
  g.add(mesh(loftHead(at, 0, BEVEL, 36, 20, 0.62, 0.012, paint), m.paint));
  g.add(mesh(loftHead(at, BEVEL, 1, 6, 20, 0.62, 0.012), m.steel));
  return g;
}

/** Tactical axe: oval polymer handle with knurled rubber and a holed pommel, faceted forged head with a wide silver bevel, integrated hex hammer, bolted collar. */
export function buildTacticalAxe(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  g.name = 'flameAxe';
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.15, 0.02), new THREE.Vector3(0, -0.03, -0.004), new THREE.Vector3(0, 0.14, -0.018), new THREE.Vector3(0, 0.31, -0.008), new THREE.Vector3(0, 0.47, 0)]);
  const rx = (t: number) => 0.0128 + 0.0035 * smooth(0.5, 0.2, t) + 0.005 * smooth(0.08, 0, t) - 0.0012 * smooth(0.6, 0.9, t);
  g.add(mesh(ovalHandle(curve, 0, 1, rx, 1.55, 44, 14, 1, true), m.polymer));
  g.add(mesh(ovalHandle(curve, 0.07, 0.42, (t) => rx(t) + 0.0012, 1.5, 18, 14, 1, false), m.rubber));
  // Lanyard hole through the pommel.
  const pommel = curve.getPointAt(0.03);
  const hole = mesh(new THREE.CylinderGeometry(0.0065, 0.0065, rx(0.03) * 2 + 0.002, 14), m.hole);
  hole.rotation.z = Math.PI / 2;
  hole.position.copy(pommel);
  g.add(hole);
  // Head: hex hammer (s 0 → 0.3), eye (0.3 → 0.5), bearded blade (0.5 → 1); faceted rings.
  const at = (s: number): Station => {
    if (s < 0.3) {
      const k = s / 0.3;
      const r = 0.024 + 0.003 * k;
      return { z: 0.1 - k * 0.07, c: HEAD_Y + 0.01, hh: r, h: r };
    }
    if (s < 0.5) {
      const k = (s - 0.3) / 0.2;
      return { z: 0.03 - k * 0.058, c: HEAD_Y + 0.01 - k * 0.004, hh: 0.028 + 0.016 * k, h: 0.02 };
    }
    const k = (s - 0.5) / 0.5;
    return { z: -0.028 - k * 0.075, c: HEAD_Y + 0.006 - 0.03 * Math.pow(k, 1.4), hh: 0.044 + 0.046 * Math.pow(k, 1.25), h: 0.001 + 0.019 * Math.pow(1 - k, 1.3) };
  };
  const BEVEL = 0.78;
  g.add(mesh(loftHead(at, 0, BEVEL, 26, 8, 1, 0.008), m.forged));
  g.add(mesh(loftHead(at, BEVEL, 1, 5, 8, 1, 0.008), m.steel));
  // Hammer face.
  const face = mesh(new THREE.CircleGeometry(0.024, 8), m.dark);
  face.position.set(0, HEAD_Y + 0.01, 0.1005);
  g.add(face);
  // Close-fitting collar under the head, with subtle bolts.
  const collar = mesh(new THREE.CylinderGeometry(0.021, 0.023, 0.04, 8), m.dark);
  collar.scale.set(1, 1, 1.5);
  collar.position.set(0, HEAD_Y - 0.052, 0);
  g.add(collar);
  for (const sx of [-1, 1]) {
    const b = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 10), m.bolt);
    b.rotation.z = Math.PI / 2;
    b.position.set(sx * 0.022, HEAD_Y - 0.052, 0);
    g.add(b);
  }
  return g;
}
