import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * Procedural textures and geometry helpers for the crashed airliner (all small canvases,
 * nothing imported). The livery is a weathered matte white: grey panel joints, rivets,
 * grime and oil stains; soot near the tears comes from vertex colours on the meshes.
 */
export interface FuselageLayout {
  /** Length of the walkable section in metres (v runs along it). */
  length: number;
  /** Window centres along the section (metres from its rear end). */
  windows: number[];
  /** Angle (radians from the +Z side) of the window rows above the axis. */
  windowAngle: number;
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
};

const finish = (c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.flipY = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

/** Soft dark blotch. */
function smudge(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, a: number): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  grd.addColorStop(0, `rgba(${rgb},${a})`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

/** Weathered white aluminium: panel joints, rivets, grime, scratches and oil stains. */
function weatheredWhite(g: CanvasRenderingContext2D, w: number, h: number, seed: number, px: number, py: number): void {
  const r = mulberry32(seed);
  g.fillStyle = '#d5d7d6';
  g.fillRect(0, 0, w, h);
  // Panels slightly differently aged.
  for (let y = 0; y < h; y += py) {
    for (let x = 0; x < w; x += px) {
      const k = r();
      g.fillStyle = k < 0.5 ? `rgba(240,240,236,${0.25 * r()})` : `rgba(150,148,140,${0.16 * r()})`;
      g.fillRect(x, y, px, py);
    }
  }
  // Grime: broad soft patches.
  for (let i = 0; i < 26; i++) smudge(g, r() * w, r() * h, 20 + r() * 60, 10 + r() * 40, '96,88,74', 0.12 + r() * 0.12);
  // Joints with oil weeping out of them.
  g.lineWidth = 1.3;
  for (let x = 0; x <= w; x += px) {
    g.strokeStyle = 'rgba(70,72,74,0.3)';
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, h);
    g.stroke();
    for (let k = 0; k < 2; k++) if (r() < 0.5) smudge(g, x, r() * h, 6 + r() * 6, 18 + r() * 30, '40,36,30', 0.2);
  }
  for (let y = 0; y <= h; y += py) {
    g.strokeStyle = 'rgba(70,72,74,0.26)';
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(w, y + 0.5);
    g.stroke();
  }
  g.fillStyle = 'rgba(80,82,84,0.3)';
  for (let x = 0; x <= w; x += px) for (let y = 2; y < h; y += 5) g.fillRect(x - 2.5, y, 1.2, 1.2);
  for (let y = 0; y <= h; y += py) for (let x = 2; x < w; x += 5) g.fillRect(x, y + 2.5, 1.2, 1.2);
  // Scratches.
  for (let i = 0; i < 120; i++) {
    const x = r() * w;
    const y = r() * h;
    g.strokeStyle = `rgba(${r() < 0.5 ? '120,122,124' : '250,250,248'},${0.25 + r() * 0.3})`;
    g.lineWidth = 0.5 + r() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 10);
    g.stroke();
  }
  // Oil drips.
  for (let i = 0; i < 10; i++) {
    const x = r() * w;
    const y = r() * h;
    const grd = g.createLinearGradient(x, y, x, y + 40);
    grd.addColorStop(0, 'rgba(30,26,20,0.4)');
    grd.addColorStop(1, 'rgba(30,26,20,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, 2 + r() * 3, 40);
  }
}

/**
 * Main fuselage skin, 512², repeating every few metres along the hull (u = around the
 * section, u = 0.75 the belly). No windows: those are real geometry.
 */
export function hullTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 512);
  weatheredWhite(g, 512, 512, 7, 64, 74);
  // Belly scuffed and stained by the slide through the trees.
  const belly = g.createLinearGradient(384 - 90, 0, 384 + 90, 0);
  belly.addColorStop(0, 'rgba(70,60,46,0)');
  belly.addColorStop(0.5, 'rgba(70,60,46,0.65)');
  belly.addColorStop(1, 'rgba(70,60,46,0)');
  g.fillStyle = belly;
  g.fillRect(384 - 90, 0, 180, 512);
  return finish(c, true);
}

/** Thin brushed-metal streaks for the engine lips. */
export function brushedTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 64);
  const r = mulberry32(17);
  g.fillStyle = '#b9bcc0';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '70,72,76'},${0.08 + r() * 0.14})`;
    g.fillRect(0, r() * 64, 128, 0.6 + r());
  }
  return finish(c, true);
}

/** A cockpit window: four corners as (φ from the top, metres along the nose). */
export type CockpitWindow = [number, number][];

export interface NoseLayout {
  /** Length of the nose block in metres (v runs from the torn rear, v = 0). */
  length: number;
  windows: CockpitWindow[];
  /** Door on the left (-Z) side: θ range around the axis and metres along. */
  door: { t0: number; t1: number; x0: number; x1: number };
}

/** The detached nose: weathered white, framed cockpit windows cut out, the front door outlined. */
export function noseTexture(n: NoseLayout): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S, S);
  weatheredWhite(g, S, S, 23, 48, 64);
  const uv = (theta: number, x: number): [number, number] => [(((theta / (Math.PI * 2)) % 1) + 1) % 1 * S, (x / n.length) * S];
  const quad = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
  };
  // Windows on both sides of the top (θ = π/2 ∓ φ).
  for (const side of [1, -1]) {
    for (const w of n.windows) {
      const pts = w.map(([phi, x]) => uv(Math.PI / 2 - side * phi, x));
      const cx = pts.reduce((a, p) => a + p[0], 0) / 4;
      const cy = pts.reduce((a, p) => a + p[1], 0) / 4;
      const grow = (k: number) => pts.map(([px, py]) => [cx + (px - cx) * k, cy + (py - cy) * k] as [number, number]);
      // Painted surround, a dark rubber frame, and a light lip on the far edge: reads as recessed.
      g.fillStyle = 'rgba(150,152,150,0.9)';
      quad(grow(1.34));
      g.fill();
      g.fillStyle = '#26282a';
      quad(grow(1.18));
      g.fill();
      g.strokeStyle = 'rgba(245,245,240,0.8)';
      g.lineWidth = 1.5;
      quad(grow(1.36));
      g.stroke();
      g.save();
      g.globalCompositeOperation = 'destination-out';
      quad(pts);
      g.fill();
      g.restore();
    }
  }
  // Front passenger door: seam, hinge side, handle plate and the evacuation arrow.
  const d = n.door;
  const [ax, ay] = uv(d.t0, d.x0);
  const [bx, by] = uv(d.t1, d.x1);
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  g.strokeStyle = 'rgba(40,42,44,0.85)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.roundRect(x0, ay, x1 - x0, by - ay, 7);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x0 + 3, ay + 3, x1 - x0 - 6, by - ay - 6, 5);
  g.stroke();
  g.fillStyle = '#5c5f62';
  g.fillRect((x0 + x1) / 2 - 7, ay + (by - ay) * 0.62, 14, 6);
  g.fillStyle = 'rgba(30,30,30,0.6)';
  g.fillRect((x0 + x1) / 2 - 3, (ay + by) / 2 - 18, 6, 12);
  return finish(c);
}

/**
 * Wing / stabiliser skin (u = chord, LE → TE; v = span, root → tip): panel lines,
 * the flap and aileron cut lines, a black band near the tip.
 */
export function wingTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 512);
  weatheredWhite(g, 256, 512, 41, 64, 56);
  // Leading edge: bare, slightly darker metal.
  g.fillStyle = 'rgba(150,152,154,0.55)';
  g.fillRect(0, 0, 14, 512);
  // Control surfaces near the trailing edge.
  g.strokeStyle = 'rgba(40,42,44,0.75)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(190, 0);
  g.lineTo(190, 512);
  for (const y of [120, 250, 340, 470]) {
    g.moveTo(190, y);
    g.lineTo(256, y);
  }
  g.stroke();
  // Black band near the tip.
  g.fillStyle = '#121314';
  g.fillRect(0, 410, 256, 36);
  g.fillStyle = 'rgba(18,19,20,0.85)';
  g.fillRect(0, 498, 256, 14);
  return finish(c);
}

/** Vertical stabiliser (u = chord, v = height): white with black diagonal bands and a black cap. */
export function finTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 512);
  weatheredWhite(g, 256, 512, 57, 64, 64);
  g.fillStyle = '#111213';
  const band = (v0: number, v1: number, slope: number) => {
    g.beginPath();
    g.moveTo(0, v0 * 512);
    g.lineTo(256, (v0 + slope) * 512);
    g.lineTo(256, (v1 + slope) * 512);
    g.lineTo(0, v1 * 512);
    g.closePath();
    g.fill();
  };
  band(0.3, 0.44, 0.22);
  band(0.56, 0.63, 0.22);
  g.fillRect(0, 0.9 * 512, 256, 0.1 * 512);
  // Rudder hinge line.
  g.strokeStyle = 'rgba(40,42,44,0.8)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(180, 0);
  g.lineTo(180, 512);
  g.stroke();
  return finish(c);
}

const WALL_W = 1024;
const WALL_H = 1024;

function windowShapes(layout: FuselageLayout, draw: (u: number, v: number) => void): void {
  for (const m of layout.windows) {
    const v = (m / layout.length) * WALL_H;
    for (const side of [1, -1]) {
      const theta = side > 0 ? layout.windowAngle : Math.PI - layout.windowAngle;
      draw((theta / (Math.PI * 2)) * WALL_W, v);
    }
  }
}

/** Inside: cream cabin wall panels, window bezels, a darker dado line, the window cut-outs. */
export function cabinWallTexture(layout: FuselageLayout): THREE.CanvasTexture {
  const { c, g } = canvas(WALL_W, WALL_H);
  const r = mulberry32(11);
  g.fillStyle = '#d9d3c6';
  g.fillRect(0, 0, WALL_W, WALL_H);
  g.strokeStyle = 'rgba(120,112,98,0.6)';
  g.lineWidth = 2;
  for (let y = 0; y <= WALL_H; y += 92) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(WALL_W, y);
    g.stroke();
  }
  // Lower sidewall darker (below the windows).
  const wu = (layout.windowAngle / (Math.PI * 2)) * WALL_W;
  g.fillStyle = 'rgba(96,92,86,0.85)';
  g.fillRect(wu - 130, 0, 80, WALL_H);
  g.fillRect(WALL_W / 2 - wu + 50, 0, 80, WALL_H);
  // Grime, heavier towards the torn front (v = 1).
  for (let i = 0; i < 60; i++) smudge(g, r() * WALL_W, WALL_H - Math.pow(r(), 1.6) * 700, 15 + r() * 60, 15 + r() * 60, '30,26,22', 0.45);
  g.fillStyle = '#efebe2';
  windowShapes(layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, 28, 20, 0, 0, Math.PI * 2);
    g.fill();
  });
  g.strokeStyle = 'rgba(80,74,64,0.6)';
  windowShapes(layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, 28, 20, 0, 0, Math.PI * 2);
    g.stroke();
  });
  g.save();
  g.globalCompositeOperation = 'destination-out';
  windowShapes(layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, 15, 11, 0, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
  return finish(c);
}

/** Cabin carpet: dark blue-grey with a small woven pattern and dirt tracked in. */
export function carpetTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  const r = mulberry32(5);
  g.fillStyle = '#2c3440';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) {
    for (let x = (y / 8) % 2 ? 4 : 0; x < 256; x += 8) {
      g.fillStyle = 'rgba(70,84,104,0.45)';
      g.fillRect(x, y, 3, 3);
    }
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(70,56,40,${0.08 + r() * 0.15})`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 6 + r() * 20, 4 + r() * 12, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = finish(c, true);
  t.flipY = true;
  return t;
}

/** Seat fabric: navy with a fine check. */
export function seatFabricTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(64, 64);
  g.fillStyle = '#23365a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 64; i += 4) {
    g.fillRect(i, 0, 1, 64);
    g.fillRect(0, i, 64, 1);
  }
  const t = finish(c, true);
  t.flipY = true;
  return t;
}

// ---------------------------------------------------------------- geometry helpers

/**
 * A grid surface: `fn(i, j)` gives the point, uv and colour of row i (0…ni) and column
 * j (0…nj). Faces wind so that a tube with rows along +X and columns going round
 * θ = atan2(y, z) faces outward.
 */
export function gridGeometry(ni: number, nj: number, fn: (i: number, j: number) => { p: THREE.Vector3; u: number; v: number; c: number }): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const col: number[] = [];
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      const q = fn(i, j);
      pos.push(q.p.x, q.p.y, q.p.z);
      uvs.push(q.u, q.v);
      col.push(q.c, q.c, q.c);
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export interface Planform {
  /** Leading edge x at the root, root chord and tip chord (metres). */
  rootLE: number;
  rootChord: number;
  tipChord: number;
  span: number;
  /** Leading-edge sweep and dihedral (radians). */
  sweep: number;
  dihedral: number;
  /** Thickness / chord at root and tip. */
  thickRoot: number;
  thickTip: number;
  /** Root position (y, z) and which way the span runs (+1 = +Z, -1 = -Z, 0 = straight up). */
  y0: number;
  z0: number;
  side: number;
}

/**
 * An airfoil-section lifting surface between span fractions f0 and f1. uv = (chord
 * fraction, span fraction) so the band textures line up on every piece. A torn end gets
 * a ragged span-wise edge and soot.
 */
export function liftingSurface(pf: Planform, f0: number, f1: number, opts: { tornRoot?: boolean; tornTip?: boolean; seed?: number } = {}): THREE.BufferGeometry {
  const r = mulberry32(opts.seed ?? 3);
  const NC = 10;
  const loop: { c: number; up: boolean }[] = [];
  for (let k = NC; k >= 0; k--) loop.push({ c: (1 - Math.cos((k / NC) * Math.PI)) / 2, up: true });
  for (let k = 1; k <= NC; k++) loop.push({ c: (1 - Math.cos((k / NC) * Math.PI)) / 2, up: false });
  const jagRoot = loop.map(() => (r() - 0.5) * 0.5);
  const jagTip = loop.map(() => (r() - 0.5) * 0.5);
  const NS = Math.max(4, Math.ceil((f1 - f0) * 24));
  const point = (f: number, c: number, up: boolean) => {
    const w = f * pf.span;
    const chord = pf.rootChord + (pf.tipChord - pf.rootChord) * f;
    const thick = pf.thickRoot + (pf.thickTip - pf.thickRoot) * f;
    const xLE = pf.rootLE - w * Math.tan(pf.sweep);
    const t = 5 * thick * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c * c * c - 0.1036 * c * c * c * c);
    const camber = 0.02 * chord * Math.sin(Math.PI * c);
    const yy = (up ? t : -t * 0.55) * chord + camber;
    const x = xLE - c * chord;
    if (pf.side === 0) return new THREE.Vector3(x, pf.y0 + w, pf.z0 + yy);
    return new THREE.Vector3(x, pf.y0 + yy + w * Math.tan(pf.dihedral), pf.z0 + pf.side * w);
  };
  const tornDark = (f: number) => {
    let k = 1;
    if (opts.tornRoot) k = Math.min(k, 0.15 + ((f - f0) / 0.05) * 0.85);
    if (opts.tornTip) k = Math.min(k, 0.15 + ((f1 - f) / 0.05) * 0.85);
    return THREE.MathUtils.clamp(k, 0.12, 1);
  };
  const geo = gridGeometry(NS, loop.length - 1, (i, j) => {
    let f = f0 + ((f1 - f0) * i) / NS;
    if (i === 0 && opts.tornRoot) f += jagRoot[j] / pf.span + 0.25 / pf.span;
    if (i === NS && opts.tornTip) f += jagTip[j] / pf.span - 0.25 / pf.span;
    const l = loop[j];
    return { p: point(f, l.c, l.up), u: l.c, v: f, c: tornDark(f) * (l.up ? 1 : 0.86) };
  });
  // Close both ends with a fan so the section reads solid.
  const caps: THREE.BufferGeometry[] = [geo];
  for (const end of [0, NS]) {
    const f = f0 + ((f1 - f0) * end) / NS;
    const ring = loop.map((l) => point(f, l.c, l.up));
    const centre = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const dark = (end === 0 && opts.tornRoot) || (end === NS && opts.tornTip) ? 0.1 : 0.9;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      pos.push(centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(0.5, f, 0.5, f, 0.5, f);
      col.push(dark, dark, dark, dark, dark, dark, dark, dark, dark);
    }
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cap.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cap.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    cap.computeVertexNormals();
    caps.push(cap);
  }
  const flat = caps.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const size = name === 'uv' ? 2 : 3;
    const total = flat.reduce((a, g) => a + g.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of flat) {
      arr.set(g.attributes[name].array as Float32Array, o);
      o += g.attributes[name].count * size;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return merged;
}

/** Point on a lifting surface's mid-plane (for engines, fairings and colliders). */
export function surfacePoint(pf: Planform, f: number, c: number): THREE.Vector3 {
  const w = f * pf.span;
  const chord = pf.rootChord + (pf.tipChord - pf.rootChord) * f;
  const xLE = pf.rootLE - w * Math.tan(pf.sweep);
  if (pf.side === 0) return new THREE.Vector3(xLE - c * chord, pf.y0 + w, pf.z0);
  return new THREE.Vector3(xLE - c * chord, pf.y0 + w * Math.tan(pf.dihedral), pf.z0 + pf.side * w);
}

export function chordAt(pf: Planform, f: number): number {
  return pf.rootChord + (pf.tipChord - pf.rootChord) * f;
}
