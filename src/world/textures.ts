import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * Procedural detail textures painted into canvases at load (no downloads).
 * They are grayscale "detail" maps with a mean near 0.78: materials keep their
 * hue in vertex/instance colours and these add grain, fibre and cracks.
 */

/** Tileable value noise on a periodic lattice. */
class TileNoise {
  private cache = new Map<number, Float32Array>();
  constructor(private seed: number) {}

  private lattice(g: number): Float32Array {
    let l = this.cache.get(g);
    if (!l) {
      const r = mulberry32(this.seed + g * 131);
      l = new Float32Array(g * g);
      for (let i = 0; i < l.length; i++) l[i] = r();
      this.cache.set(g, l);
    }
    return l;
  }

  /** u,v in [0,1). gx,gy = lattice cells across the tile. */
  sample(u: number, v: number, gx: number, gy: number): number {
    const lx = this.lattice(Math.max(gx, gy));
    const g = Math.max(gx, gy);
    const x = u * gx;
    const y = v * gy;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (ix: number, iy: number) => lx[(((iy % gy) + gy) % gy) * g + (((ix % gx) + gx) % gx)];
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  fbm(u: number, v: number, gx: number, gy: number, oct = 4): number {
    let s = 0;
    let amp = 1;
    let n = 0;
    for (let o = 0; o < oct; o++) {
      s += this.sample(u, v, gx << o, gy << o) * amp;
      n += amp;
      amp *= 0.5;
    }
    return s / n;
  }
}

function makeTexture(size: number, fn: (u: number, v: number, x: number, y: number) => number, w = size, color = false, tint?: [number, number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(1, fn(x / w, y / size, x, y)));
      const i = (y * w + x) * 4;
      const t = tint ?? [1, 1, 1];
      img.data[i] = v * 255 * t[0];
      img.data[i + 1] = v * 255 * t[1];
      img.data[i + 2] = v * 255 * t[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface DetailSet {
  bark: THREE.CanvasTexture;
  barkBump: THREE.CanvasTexture;
  foliage: THREE.CanvasTexture;
  sand: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
  rock: THREE.CanvasTexture;
  rockBump: THREE.CanvasTexture;
  plank: THREE.CanvasTexture;
  /** Cut end of a log: growth rings around the centre (CylinderGeometry cap UVs). */
  rings: THREE.CanvasTexture;
}

let cached: DetailSet | null = null;

export function detailTextures(): DetailSet {
  if (cached) return cached;
  const n = new TileNoise(17);
  const n2 = new TileNoise(91);
  const r = mulberry32(5);

  // Bark: vertical fibres and dark fissures.
  const barkF = (u: number, v: number) => {
    const fibre = n.fbm(u, v, 24, 3, 3);
    const fissure = Math.pow(Math.abs(n2.fbm(u, v, 10, 2, 3) - 0.5) * 2, 0.35);
    return 0.45 + fibre * 0.4 + fissure * 0.28;
  };
  const bark = makeTexture(256, barkF, 128);
  const barkBump = makeTexture(256, barkF, 128);

  // Pine needles: many short light strokes on a darker base.
  const needles = new Float32Array(256 * 256).fill(0.62);
  for (let k = 0; k < 2600; k++) {
    const x0 = r() * 256;
    const y0 = r() * 256;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.6;
    const len = 4 + r() * 9;
    const b = 0.75 + r() * 0.45;
    for (let s = 0; s < len; s++) {
      const x = Math.floor(x0 + Math.cos(a) * s) & 255;
      const y = Math.floor(y0 + Math.sin(a) * s) & 255;
      needles[y * 256 + x] = b * (0.85 + 0.15 * (s / len));
    }
  }
  const foliage = makeTexture(256, (u, v, x, y) => needles[y * 256 + x] * (0.85 + n.fbm(u, v, 4, 4, 2) * 0.3), 256);

  // Sand: fine grains with sparse dark specks and soft ripples.
  const sand = makeTexture(256, (u, v) => {
    const grain = r();
    const ripple = Math.sin((v * 6 + n.fbm(u, v, 4, 4, 2) * 1.5) * Math.PI * 2) * 0.03;
    const speck = grain > 0.985 ? -0.25 : grain > 0.96 ? 0.12 : 0;
    return 0.74 + (grain - 0.5) * 0.12 + ripple + speck + n.fbm(u, v, 8, 8, 3) * 0.08;
  });

  // Grass: blade strokes over organic blotches.
  const blades = new Float32Array(256 * 256);
  for (let i = 0; i < blades.length; i++) blades[i] = 0.62 + r() * 0.08;
  for (let k = 0; k < 5200; k++) {
    const x0 = r() * 256;
    const y0 = r() * 256;
    const a = r() * Math.PI * 2;
    const len = 2 + r() * 6;
    const b = 0.7 + r() * 0.45;
    for (let s = 0; s < len; s++) {
      const x = Math.floor(x0 + Math.cos(a) * s) & 255;
      const y = Math.floor(y0 + Math.sin(a) * s) & 255;
      blades[y * 256 + x] = b;
    }
  }
  const grass = makeTexture(256, (u, v, x, y) => blades[y * 256 + x] * (0.8 + n2.fbm(u, v, 6, 6, 3) * 0.35));

  // Rock: layered fbm with crack lines.
  const rockF = (u: number, v: number) => {
    const base = n.fbm(u, v, 6, 6, 5);
    const crack = Math.abs(n2.fbm(u, v, 5, 5, 4) - 0.5);
    return 0.5 + base * 0.45 - (crack < 0.03 ? 0.25 : 0) + (r() - 0.5) * 0.06;
  };
  const rock = makeTexture(256, rockF, 256);
  const rockBump = makeTexture(256, rockF);

  // Planks for the cabin, dock and bench.
  const plank = makeTexture(256, (u, v) => {
    const board = Math.floor(v * 4);
    const seam = (v * 4) % 1 < 0.04 ? -0.3 : 0;
    const grain = n.fbm(u + board * 0.37, v, 2, 24, 3);
    return 0.58 + grain * 0.35 + seam + ((board * 0.13) % 0.1);
  }, 256);

  const rings = makeTexture(256, (u, v) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const wob = n.fbm(u, v, 6, 6, 2) * 0.06;
    const ring = Math.sin((r + wob) * 70) * 0.5 + 0.5;
    const edge = r > 0.9 ? 0.45 : 1;
    return (0.78 + ring * 0.14 - r * 0.08) * edge;
  });
  rings.colorSpace = THREE.SRGBColorSpace;
  rings.wrapS = rings.wrapT = THREE.ClampToEdgeWrapping;

  for (const t of [bark, barkBump]) t.repeat.set(1, 2);
  cached = { bark, barkBump, foliage, sand, grass, rock, rockBump, plank, rings };
  return cached;
}
