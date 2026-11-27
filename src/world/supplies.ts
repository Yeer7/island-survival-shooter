import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../core/math';

/**
 * Hand-made supplies found in the luggage, at real scale (metres), built in code:
 * a folded cotton rag (cloth), a travel chocolate bar in a sealed foil wrapper (food) and
 * a compact first-aid pouch with a red cross (bandage). Each builder returns a group whose
 * origin is at the bottom centre, lying flat, longest side along X.
 */

const canvasTex = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** Plain-weave cotton: a base colour with warp/weft threads, wear and a little dirt. */
export function weave(base: string, seed: number, dirt = 0.5): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    const r = mulberry32(seed);
    c.fillStyle = base;
    c.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 128; k += 2) {
      c.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.05})`;
      c.fillRect(0, k, 128, 1);
      c.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`;
      c.fillRect(k, 0, 1, 128);
    }
    for (let k = 0; k < 10 * dirt; k++) {
      const x = r() * 128;
      const y = r() * 128;
      const g = c.createRadialGradient(x, y, 0, x, y, 6 + r() * 16);
      g.addColorStop(0, `rgba(90,70,45,${0.15 + r() * 0.15})`);
      g.addColorStop(1, 'rgba(90,70,45,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    }
  });
}

/** Soft wrinkles: displace the upper vertices of a subdivided box by smooth noise. */
export function crumple(g: THREE.BufferGeometry, amp: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const a = [r() * 6, r() * 6, r() * 6, r() * 6];
  const p = g.attributes.position;
  g.computeBoundingBox();
  const top = g.boundingBox!.max.y;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const y = p.getY(i);
    if (y < top - 1e-4) continue;
    const n = Math.sin(x * 38 + a[0]) * Math.sin(z * 31 + a[1]) * 0.6 + Math.sin(x * 83 + z * 47 + a[2]) * 0.4;
    p.setY(i, y + n * amp);
  }
  g.computeVertexNormals();
  return g;
}

let clothMat: THREE.MeshStandardMaterial | null = null;
/** Cloth: a cotton rag folded in three, ~19 x 14 cm and ~3.5 cm thick. */
export function buildCloth(): THREE.Group {
  clothMat ??= (() => {
    // Coarse unbleached cotton: visible threads, a darker hem stripe, wear and dirt.
    const t = canvasTex(128, 128, (c) => {
      const r = mulberry32(7);
      c.fillStyle = '#c9b994';
      c.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 128; k += 2) {
        c.fillStyle = `rgba(255,248,230,${0.1 + r() * 0.1})`;
        c.fillRect(0, k, 128, 1);
        c.fillStyle = `rgba(70,55,35,${0.1 + r() * 0.08})`;
        c.fillRect(k, 0, 1, 128);
      }
      c.fillStyle = 'rgba(120,85,50,0.35)';
      c.fillRect(0, 10, 128, 3);
      c.fillRect(0, 16, 128, 1);
      for (let k = 0; k < 5; k++) {
        const x = r() * 128;
        const y = r() * 128;
        const g = c.createRadialGradient(x, y, 0, x, y, 8 + r() * 14);
        g.addColorStop(0, 'rgba(85,62,38,0.25)');
        g.addColorStop(1, 'rgba(85,62,38,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 128, 128);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.5, 1.5);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.97 });
  })();
  const g = new THREE.Group();
  const W = 0.19;
  const D = 0.14;
  const T = 0.011;
  for (let k = 0; k < 3; k++) {
    const layer = crumple(new RoundedBoxGeometry(W - k * 0.006, T, D - k * 0.008, 4, T * 0.45), 0.0035, 3 + k);
    const m = new THREE.Mesh(layer, clothMat);
    m.position.set(k * 0.003, T / 2 + k * T, k * 0.002);
    m.rotation.y = (k - 1) * 0.04;
    m.castShadow = true;
    g.add(m);
  }
  // The rounded fold along one long edge, binding the layers.
  const fold = new THREE.Mesh(new THREE.CylinderGeometry(T * 1.5, T * 1.5, W - 0.012, 12), clothMat);
  fold.rotation.z = Math.PI / 2;
  fold.position.set(0.002, T * 1.5, -D / 2 + 0.008);
  fold.castShadow = true;
  g.add(fold);
  return g;
}

let barMats: { wrap: THREE.MeshStandardMaterial; seal: THREE.MeshStandardMaterial } | null = null;
/** Food: a travel chocolate bar in a satin foil wrapper, ~17 x 7 x 2.5 cm. */
export function buildChocolateBar(): THREE.Group {
  barMats ??= (() => {
    const art = canvasTex(256, 128, (c) => {
      c.fillStyle = '#4a2414';
      c.fillRect(0, 0, 256, 128);
      // Gold diagonal band and a red ribbon.
      c.fillStyle = '#d7a93a';
      c.beginPath();
      c.moveTo(150, 0);
      c.lineTo(196, 0);
      c.lineTo(150, 128);
      c.lineTo(104, 128);
      c.closePath();
      c.fill();
      c.fillStyle = '#c4262e';
      c.fillRect(0, 92, 256, 14);
      c.fillStyle = '#f0d27a';
      c.fillRect(0, 90, 256, 2);
      c.fillRect(0, 106, 256, 2);
      // Name and a small chocolate-square motif.
      c.fillStyle = '#f6e7c8';
      c.font = 'bold 34px system-ui, sans-serif';
      c.fillText('CHOCO', 18, 58);
      c.font = 'bold 13px system-ui, sans-serif';
      c.fillStyle = '#f0d27a';
      c.fillText('ENERGY · 100 g', 20, 80);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          c.fillStyle = '#2e140a';
          c.fillRect(196 + i * 18, 20 + j * 18, 15, 15);
          c.fillStyle = 'rgba(255,255,255,0.18)';
          c.fillRect(196 + i * 18, 20 + j * 18, 15, 3);
        }
      }
      // Creases and scuffs on the foil.
      const r = mulberry32(21);
      for (let k = 0; k < 18; k++) {
        c.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`;
        c.lineWidth = 1;
        c.beginPath();
        const x = r() * 256;
        c.moveTo(x, 0);
        c.lineTo(x + (r() - 0.5) * 40, 128);
        c.stroke();
      }
    });
    const crimp = canvasTex(
      64,
      16,
      (c) => {
        for (let x = 0; x < 64; x += 4) {
          c.fillStyle = '#b0b0b0';
          c.fillRect(x, 0, 2, 16);
          c.fillStyle = '#404040';
          c.fillRect(x + 2, 0, 2, 16);
        }
      },
      false,
    );
    return {
      wrap: new THREE.MeshStandardMaterial({ map: art, roughness: 0.36, metalness: 0.35 }),
      seal: new THREE.MeshStandardMaterial({ color: 0x4a2414, roughness: 0.4, metalness: 0.4, bumpMap: crimp, bumpScale: 1.5 }),
    };
  })();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.024, 0.07, 3, 0.008), barMats.wrap);
  body.position.y = 0.012;
  body.castShadow = true;
  g.add(body);
  // Flat crimped seals at both ends.
  for (const s of [-1, 1]) {
    const seal = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.066), barMats.seal);
    seal.position.set(s * 0.081, 0.012, 0);
    seal.rotation.z = s * 0.06;
    g.add(seal);
  }
  return g;
}

let kitMats: { shell: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial } | null = null;
/** Bandage: a compact first-aid pouch with a zip and a red cross, ~17 x 12 x 4 cm. */
export function buildFirstAidPouch(): THREE.Group {
  kitMats ??= (() => {
    const top = canvasTex(256, 192, (c) => {
      c.fillStyle = '#ecebe6';
      c.fillRect(0, 0, 256, 192);
      const r = mulberry32(33);
      for (let k = 0; k < 192; k += 2) {
        c.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.03})`;
        c.fillRect(0, k, 256, 1);
      }
      // White disc with a bold red cross, readable from a few metres away.
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(128, 96, 66, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#d0202a';
      c.fillRect(110, 46, 36, 100);
      c.fillRect(78, 78, 100, 36);
      // Wear and dirt from the crash.
      for (let k = 0; k < 6; k++) {
        const x = r() * 256;
        const y = r() * 192;
        const g = c.createRadialGradient(x, y, 0, x, y, 10 + r() * 24);
        g.addColorStop(0, 'rgba(90,70,45,0.22)');
        g.addColorStop(1, 'rgba(90,70,45,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 256, 192);
      }
    });
    return {
      shell: new THREE.MeshStandardMaterial({ map: top, roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.85 }),
    };
  })();
  const g = new THREE.Group();
  const H = 0.04;
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.17, H, 0.12, 4, 0.017), kitMats.shell);
  body.position.y = H / 2;
  body.castShadow = true;
  // Zip running round the middle: a band just proud of the body.
  const zip = new THREE.Mesh(new RoundedBoxGeometry(0.173, 0.006, 0.123, 3, 0.0025), kitMats.dark);
  zip.position.y = H / 2;
  // Zip puller with its tab at one corner.
  const pull = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.005, 0.008), kitMats.metal);
  pull.position.set(0.07, H / 2, 0.063);
  const tab = new THREE.Mesh(new RoundedBoxGeometry(0.008, 0.003, 0.022, 2, 0.0012), kitMats.dark);
  tab.position.set(0.07, H / 2 - 0.004, 0.075);
  tab.rotation.x = 0.4;
  // Carry loop on one short side.
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 4, 10, Math.PI), kitMats.dark);
  loop.position.set(-0.086, H / 2, 0);
  loop.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  g.add(body, zip, pull, tab, loop);
  return g;
}
