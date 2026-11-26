import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * Procedural textures for the crashed airliner. The fuselage canvas wraps once around
 * a cylinder (u = around, v = along the length, v = 1 at the torn end): aluminium
 * panels with rivet lines, the airline stripe, soot and scratches, oval windows and a
 * ragged tear cut out of the alpha so the light comes through.
 */
export interface FuselageLayout {
  /** Length of the section in metres (v runs along it). */
  length: number;
  /** Window centres along the section (metres from the nose end, v = 0). */
  windows: number[];
  /** Angle (radians from the +Z side) of the window rows above the axis. */
  windowAngle: number;
}

const W = 1024;
const H = 1024;

function shape(g: CanvasRenderingContext2D, layout: FuselageLayout, draw: (u: number, v: number) => void): void {
  for (const m of layout.windows) {
    const v = (m / layout.length) * H;
    for (const side of [1, -1]) {
      // Cylinder u: angle θ around from +Z, windows sit at θ = ±windowAngle from the sides.
      const theta = side > 0 ? layout.windowAngle : Math.PI - layout.windowAngle;
      const u = ((theta / (Math.PI * 2)) % 1) * W;
      draw(u, v);
    }
  }
  void g;
}

/** Jagged tear profile: how far (px) the hull is missing at each column, near v = H. */
function tearProfile(seed: number): number[] {
  const r = mulberry32(seed);
  const cols: number[] = [];
  let cur = 30;
  for (let x = 0; x < W; x += 8) {
    cur = Math.max(6, Math.min(110, cur + (r() - 0.5) * 40));
    if (r() < 0.08) cur += 50 * r();
    cols.push(cur);
  }
  return cols;
}

function cutTear(g: CanvasRenderingContext2D, tear: number[]): void {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(0, H);
  tear.forEach((d, i) => g.lineTo(i * 8, H - d));
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  g.restore();
}

function cutWindows(g: CanvasRenderingContext2D, layout: FuselageLayout, ru: number, rv: number): void {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  shape(g, layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, ru, rv, 0, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
}

/** Outside: painted aluminium, rivets, the airline stripe, soot round the tear. */
export function fuselageTexture(layout: FuselageLayout): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = mulberry32(7);
  g.fillStyle = '#e4e6e8';
  g.fillRect(0, 0, W, H);
  // Panel tint variation.
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${200 + r() * 40},${204 + r() * 36},${210 + r() * 30},0.25)`;
    g.fillRect(Math.floor(r() * 16) * 64, Math.floor(r() * 16) * 64, 64, 64);
  }
  // Panel seams and rivet lines.
  g.strokeStyle = 'rgba(80,86,94,0.55)';
  g.lineWidth = 1.2;
  for (let x = 0; x <= W; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 0; y <= H; y += 46) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(60,66,74,0.6)';
  for (let x = 0; x <= W; x += 64) for (let y = 3; y < H; y += 7) g.fillRect(x - 3, y, 1.6, 1.6);
  for (let y = 0; y <= H; y += 46) for (let x = 3; x < W; x += 7) g.fillRect(x, y + 3, 1.6, 1.6);
  // Airline livery: a deep blue band under the windows with a thin orange cheat line.
  const wu = (layout.windowAngle / (Math.PI * 2)) * W;
  for (const centre of [wu, W / 2 - wu]) {
    const below = centre < W / 2 ? centre - 40 : centre + 22;
    g.fillStyle = '#173f6e';
    g.fillRect(below, 0, 18, H);
    g.fillStyle = '#e07a1c';
    g.fillRect(centre < W / 2 ? below - 6 : below + 20, 0, 4, H);
  }
  // Belly scuffs and a darker underside.
  const belly = g.createLinearGradient(W * 0.75 - 90, 0, W * 0.75 + 90, 0);
  belly.addColorStop(0, 'rgba(90,80,64,0)');
  belly.addColorStop(0.5, 'rgba(90,80,64,0.55)');
  belly.addColorStop(1, 'rgba(90,80,64,0)');
  g.fillStyle = belly;
  g.fillRect(W * 0.75 - 90, 0, 180, H);
  // Scratches.
  g.strokeStyle = 'rgba(120,124,130,0.5)';
  for (let i = 0; i < 160; i++) {
    const x = r() * W;
    const y = r() * H;
    g.lineWidth = 0.5 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 12);
    g.stroke();
  }
  // Window rims (dark rubber seal) before cutting the glass out.
  g.fillStyle = '#3a3e44';
  shape(g, layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, 15, 20, 0, 0, Math.PI * 2);
    g.fill();
  });
  // Soot: burned towards the tear and in drifting patches.
  const soot = g.createLinearGradient(0, H - 260, 0, H);
  soot.addColorStop(0, 'rgba(20,18,16,0)');
  soot.addColorStop(1, 'rgba(20,18,16,0.92)');
  g.fillStyle = soot;
  g.fillRect(0, H - 260, W, 260);
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = H - r() * 420;
    const rad = 20 + r() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(18,16,14,0.55)');
    grd.addColorStop(1, 'rgba(18,16,14,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  cutWindows(g, layout, 12, 17);
  cutTear(g, tearProfile(3));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Inside: cream cabin wall panels, window bezels, a darker dado line, the same cut-outs. */
export function cabinWallTexture(layout: FuselageLayout): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = mulberry32(11);
  g.fillStyle = '#d9d3c6';
  g.fillRect(0, 0, W, H);
  // Panel joints along the length.
  g.strokeStyle = 'rgba(120,112,98,0.6)';
  g.lineWidth = 2;
  for (let y = 0; y <= H; y += 92) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // Lower sidewall darker (below the windows) and the floor-level kick panel.
  const wu = (layout.windowAngle / (Math.PI * 2)) * W;
  for (const centre of [wu, W / 2 - wu]) {
    const x0 = centre < W / 2 ? centre - 120 : centre + 40;
    g.fillStyle = 'rgba(96,92,86,0.85)';
    g.fillRect(x0, 0, 80, H);
  }
  // Grime and scorch near the tear.
  for (let i = 0; i < 60; i++) {
    const x = r() * W;
    const y = H - r() * 500;
    const rad = 15 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(30,26,22,0.45)');
    grd.addColorStop(1, 'rgba(30,26,22,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Window bezels.
  g.fillStyle = '#efebe2';
  shape(g, layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, 22, 30, 0, 0, Math.PI * 2);
    g.fill();
  });
  g.strokeStyle = 'rgba(80,74,64,0.6)';
  g.lineWidth = 2;
  shape(g, layout, (u, v) => {
    g.beginPath();
    g.ellipse(u, v, 22, 30, 0, 0, Math.PI * 2);
    g.stroke();
  });
  cutWindows(g, layout, 12, 17);
  cutTear(g, tearProfile(3));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Cabin carpet: dark blue-grey with a small woven pattern and dirt tracked in. */
export function carpetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Seat fabric: navy with a fine check. */
export function seatFabricTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#23365a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 64; i += 4) {
    g.fillRect(i, 0, 1, 64);
    g.fillRect(0, i, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The airline's tail logo: a white rising bird over a blue field. */
export function tailLogoTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 256, 256, 0);
  grd.addColorStop(0, '#0f2d52');
  grd.addColorStop(1, '#1f5fa8');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(70, 170);
  g.quadraticCurveTo(120, 120, 196, 96);
  g.quadraticCurveTo(140, 140, 150, 190);
  g.quadraticCurveTo(120, 150, 70, 170);
  g.fill();
  g.fillStyle = '#e07a1c';
  g.fillRect(0, 210, 256, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
