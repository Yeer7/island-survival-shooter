import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { detailTextures } from '../world/textures';

/**
 * The two axes, built in code. Shared convention (same as before): origin = the grip
 * point, the handle runs up +Y, the head sits near y = 0.47 with the cutting edge facing
 * -Z and the back (hook / hammer) toward +Z; thickness along X.
 */

const HEAD_Y = 0.47;

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, repeat: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, mulberry32(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Worn red paint: scuffs down to grey metal, chips and grime. */
function wornRed(): THREE.CanvasTexture {
  return canvasTex(
    128,
    (g, r) => {
      g.fillStyle = '#a32419';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? '60,20,14' : '200,70,50'},${0.15 + r() * 0.2})`;
        g.beginPath();
        g.ellipse(r() * 128, r() * 128, 4 + r() * 12, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(170,165,160,0.6)';
      for (let i = 0; i < 40; i++) {
        const x = r() * 128;
        const y = r() * 128;
        g.lineWidth = 0.5 + r();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 8);
        g.stroke();
      }
      for (let i = 0; i < 25; i++) {
        g.fillStyle = 'rgba(120,118,114,0.8)';
        g.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1 + r() * 2);
      }
    },
    9,
    41,
  );
}

/** Dark forged steel: hammer-scale mottling and fine scratches. */
function forged(): THREE.CanvasTexture {
  return canvasTex(
    128,
    (g, r) => {
      g.fillStyle = '#4a4d52';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(${r() < 0.55 ? '22,23,26' : '120,124,130'},${0.12 + r() * 0.22})`;
        g.beginPath();
        g.ellipse(r() * 128, r() * 128, 2 + r() * 9, 2 + r() * 6, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(160,165,170,0.25)';
      for (let i = 0; i < 50; i++) {
        const x = r() * 128;
        const y = r() * 128;
        g.lineWidth = 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 24, y + (r() - 0.5) * 4);
        g.stroke();
      }
    },
    9,
    43,
  );
}

/** Knurled rubber grip. */
function knurl(): THREE.CanvasTexture {
  const t = canvasTex(
    64,
    (g) => {
      g.fillStyle = '#26282b';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(8,8,9,0.9)';
      g.lineWidth = 1.4;
      for (let i = -64; i < 128; i += 6) {
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
    1,
    7,
  );
  t.repeat.set(4, 6);
  return t;
}

let mats: Record<string, THREE.MeshStandardMaterial> | null = null;
function M(): Record<string, THREE.MeshStandardMaterial> {
  if (mats) return mats;
  const tex = detailTextures();
  const wood = tex.plank.clone();
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(1, 3);
  wood.needsUpdate = true;
  const fg = forged();
  mats = {
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4a32, map: wood, roughness: 0.75, metalness: 0 }),
    wrap: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9, metalness: 0 }),
    red: new THREE.MeshStandardMaterial({ map: wornRed(), roughness: 0.5, metalness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.22, metalness: 0.55 }),
    collar: new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.4, metalness: 0.6 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.78, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ map: knurl(), roughness: 0.95, metalness: 0, bumpMap: knurl(), bumpScale: 2 }),
    forged: new THREE.MeshStandardMaterial({ map: fg, bumpMap: fg, bumpScale: 1.5, roughness: 0.55, metalness: 0.5 }),
    bolt: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5, metalness: 0.6 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }),
  };
  return mats;
}

/** Extrude a side profile drawn in (z, y) into a plate of `depth` along X, centred on X = 0. */
function plate(shape: THREE.Shape, depth: number, bevel = 0.004): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, HEAD_Y, 0);
  return g;
}

const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.frustumCulled = false;
  return o;
};

/** Emergency / fire axe: S-curved dark wood handle, worn red head, polished steel edge, hooked spike. */
export function buildAxe(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  g.name = 'axe';
  // Handle: a gentle S curve.
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, -0.02, -0.012), new THREE.Vector3(0, 0.14, 0.012), new THREE.Vector3(0, 0.3, 0.004), new THREE.Vector3(0, 0.5, -0.004)]);
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.019, 9, false), m.wood));
  // Firm grip: a dark wrap with ridges, and a swelled butt.
  const grip = mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.2, 10), m.wrap);
  grip.position.set(0, -0.04, -0.006);
  g.add(grip);
  for (let k = 0; k < 6; k++) {
    const ring = mesh(new THREE.TorusGeometry(0.023, 0.004, 5, 12), m.wrap);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, -0.12 + k * 0.032, -0.006);
    g.add(ring);
  }
  const butt = mesh(new THREE.SphereGeometry(0.027, 10, 7), m.wood);
  butt.scale.set(1, 0.7, 1.2);
  butt.position.set(0, -0.155, 0);
  g.add(butt);
  // Metal collar where the head is fitted.
  const collar = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.1, 10), m.collar);
  collar.position.set(0, HEAD_Y, 0);
  g.add(collar);
  // Red head: a flared blade toward -Z.
  const head = new THREE.Shape();
  head.moveTo(0.035, 0.036);
  head.lineTo(-0.05, 0.036);
  head.quadraticCurveTo(-0.08, 0.05, -0.108, 0.078);
  head.lineTo(-0.112, -0.078);
  head.quadraticCurveTo(-0.08, -0.05, -0.05, -0.036);
  head.lineTo(0.035, -0.036);
  head.lineTo(0.035, 0.036);
  g.add(mesh(plate(head, 0.026), m.red));
  // Hooked spike curving down at the back.
  const pick = new THREE.Shape();
  pick.moveTo(0.03, 0.032);
  pick.quadraticCurveTo(0.09, 0.04, 0.128, -0.004);
  pick.quadraticCurveTo(0.09, 0.008, 0.03, -0.024);
  pick.lineTo(0.03, 0.032);
  g.add(mesh(plate(pick, 0.018), m.red));
  // Bevelled steel edge: thinner than the head so it reads as a chamfer.
  const edge = new THREE.Shape();
  edge.moveTo(-0.104, 0.08);
  edge.quadraticCurveTo(-0.118, 0, -0.108, -0.08);
  edge.lineTo(-0.124, -0.082);
  edge.quadraticCurveTo(-0.142, 0, -0.122, 0.082);
  edge.lineTo(-0.104, 0.08);
  g.add(mesh(plate(edge, 0.012, 0.003), m.steel));
  return g;
}

/** Tactical axe: ergonomic polymer handle, knurled rubber grip, bolted collar, dark forged head, silver edge, hex hammer poll. */
export function buildTacticalAxe(): THREE.Group {
  const m = M();
  const g = new THREE.Group();
  g.name = 'flameAxe';
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.13, 0.01), new THREE.Vector3(0, 0.02, -0.006), new THREE.Vector3(0, 0.2, -0.016), new THREE.Vector3(0, 0.36, -0.006), new THREE.Vector3(0, 0.46, 0)]);
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.021, 10, false), m.polymer));
  // Knurled rubber over the lower half.
  const rubber = mesh(new THREE.CylinderGeometry(0.0235, 0.0245, 0.2, 12), m.rubber);
  rubber.position.set(0, -0.03, -0.002);
  g.add(rubber);
  // Flared pommel with a lanyard hole.
  const pommel = mesh(new THREE.CylinderGeometry(0.024, 0.031, 0.06, 12), m.polymer);
  pommel.position.set(0, -0.155, 0.012);
  pommel.rotation.x = 0.15;
  g.add(pommel);
  for (const s of [-1, 1]) {
    const hole = mesh(new THREE.CircleGeometry(0.009, 12), m.hole);
    hole.rotation.y = (s * Math.PI) / 2;
    hole.position.set(s * 0.0305, -0.16, 0.016);
    g.add(hole);
  }
  // Bolted collar.
  const collar = mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.07, 6), m.bolt);
  collar.position.set(0, HEAD_Y - 0.02, 0.006);
  g.add(collar);
  for (const sx of [-1, 1]) {
    for (const yy of [-0.022, 0.022]) {
      const b = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), m.collar);
      b.rotation.z = Math.PI / 2;
      b.position.set(sx * 0.031, HEAD_Y - 0.02 + yy, 0.006);
      g.add(b);
    }
  }
  // Forged head with a long bearded blade toward -Z.
  const head = new THREE.Shape();
  head.moveTo(0.03, 0.05);
  head.lineTo(-0.035, 0.046);
  head.lineTo(-0.085, 0.072);
  head.lineTo(-0.098, -0.09);
  head.quadraticCurveTo(-0.06, -0.06, -0.03, -0.03);
  head.lineTo(0.03, -0.042);
  head.lineTo(0.03, 0.05);
  g.add(mesh(plate(head, 0.03), m.forged));
  // Silver bevelled edge.
  const edge = new THREE.Shape();
  edge.moveTo(-0.082, 0.07);
  edge.lineTo(-0.094, -0.088);
  edge.lineTo(-0.108, -0.09);
  edge.lineTo(-0.098, 0.072);
  edge.lineTo(-0.082, 0.07);
  g.add(mesh(plate(edge, 0.012, 0.003), m.steel));
  // Hexagonal hammer poll at the back.
  const poll = mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.07, 6), m.forged);
  poll.rotation.x = Math.PI / 2;
  poll.position.set(0, HEAD_Y + 0.005, 0.06);
  g.add(poll);
  const face = mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.008, 6), m.collar);
  face.rotation.x = Math.PI / 2;
  face.position.set(0, HEAD_Y + 0.005, 0.098);
  g.add(face);
  return g;
}
