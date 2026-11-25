import * as THREE from 'three';
import { AssetLibrary, AssetName } from '../assets/assets';
import { bakeStatic } from '../core/bake';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';
import { buildFish, buildLog, buildMeat, logMaterials } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Suitcase } from './landmarks';
import { ItemType } from './pickups';
import { Terrain } from './terrain';

// ------------------------------------------------------------------ textures

type Rnd = () => number;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Bundled straw: long strokes, light and dark, with tied bands. One tile is about 1.4 x 1 m. */
function thatchTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#8f7340';
  g.fillRect(0, 0, 256, 256);
  const r = mulberry32(5);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const l = 14 + r() * 40;
    g.strokeStyle = r() > 0.45 ? `rgba(206,176,108,${0.35 + r() * 0.55})` : `rgba(84,62,28,${0.3 + r() * 0.45})`;
    g.lineWidth = 0.8 + r() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 5, y + l);
    g.stroke();
  }
  g.fillStyle = 'rgba(52,36,16,0.5)';
  for (let y = 60; y < 256; y += 128) g.fillRect(0, y, 256, 4);
  return finish(c);
}

/** Ragged straw fringe for roof edges: transparent below uneven straw ends. */
function fringeTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 64);
  const r = mulberry32(17);
  for (let i = 0; i < 900; i++) {
    const x = r() * 256;
    const len = 26 + r() * 36;
    g.strokeStyle = r() > 0.45 ? `rgba(206,176,108,${0.75 + r() * 0.25})` : `rgba(110,84,40,${0.8 + r() * 0.2})`;
    g.lineWidth = 1 + r() * 1.8;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (r() - 0.5) * 6, len);
    g.stroke();
  }
  return finish(c);
}

/** Wattle and daub: woven branches with mud pressed between them. */
function wattleTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#4a3624';
  g.fillRect(0, 0, 256, 256);
  const r = mulberry32(29);
  for (let row = 0; row < 18; row++) {
    const y = row * 14.2 + 6;
    g.strokeStyle = row % 2 ? '#7d5d3a' : '#694b2d';
    g.lineWidth = 9;
    g.beginPath();
    for (let x = -10; x <= 266; x += 8) {
      const yy = y + Math.sin((x / 256) * Math.PI * 8 + row * Math.PI) * 2.2;
      if (x === -10) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
    g.strokeStyle = 'rgba(30,20,10,0.5)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  // Uprights showing through the weave.
  for (let x = 16; x < 256; x += 32) {
    g.fillStyle = 'rgba(40,28,16,0.55)';
    g.fillRect(x, 0, 5, 256);
  }
  // Mud daub patches.
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${110 + r() * 30},${92 + r() * 20},${70 + r() * 16},${0.35 + r() * 0.4})`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 8 + r() * 26, 5 + r() * 14, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** A stretched animal hide with an irregular outline and lacing holes (alpha cut-out). */
function hideTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  const r = mulberry32(41);
  const pts: [number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const leg = i % 9 === 2 || i % 9 === 6 ? 1.16 : 1;
    const k = (0.82 + r() * 0.14) * leg;
    pts.push([128 + Math.cos(a) * 118 * k, 128 + Math.sin(a) * 112 * k]);
  }
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 130);
  grad.addColorStop(0, '#a8784b');
  grad.addColorStop(1, '#6d4628');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 500; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(60,36,18,0.12)' : 'rgba(200,160,110,0.1)';
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 2 + r() * 10, 1 + r() * 5, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(25,14,6,0.9)';
  pts.forEach(([x, y]) => {
    g.beginPath();
    g.arc(128 + (x - 128) * 0.9, 128 + (y - 128) * 0.9, 3, 0, Math.PI * 2);
    g.fill();
  });
  return finish(c);
}

/** The clearing floor: packed earth, an ash ring round the fire and trodden paths. */
function earthTexture(R: number, paths: { a: number; len: number; w: number }[]): THREE.CanvasTexture {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const r = mulberry32(73);
  const px = (m: number) => (m / R) * (S / 2);
  // Irregular edge: a blob that fades out.
  g.save();
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const k = 0.86 + 0.08 * Math.sin(a * 5 + 1.3) + 0.05 * Math.sin(a * 11);
    const x = S / 2 + Math.sin(a) * (S / 2) * k;
    const y = S / 2 + Math.cos(a) * (S / 2) * k;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.clip();
  const base = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S / 2);
  base.addColorStop(0, 'rgba(98,76,52,1)');
  base.addColorStop(0.8, 'rgba(92,72,48,0.96)');
  base.addColorStop(1, 'rgba(84,66,44,0)');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // Soft mottling (no hard specks: one texel here is about 5 cm on the ground).
  for (let i = 0; i < 1600; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * S * 0.47;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const rad = 8 + r() * 38;
    const k = r();
    const col = k > 0.6 ? '62,46,28' : k > 0.3 ? '138,110,76' : '112,104,92';
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${col},${0.06 + r() * 0.1})`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Small pebbles and grit.
  for (let i = 0; i < 1800; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * S * 0.47;
    g.fillStyle = r() > 0.4 ? `rgba(160,148,128,${0.2 + r() * 0.25})` : `rgba(56,42,28,${0.08 + r() * 0.1})`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0.5 + r() * 0.7, 0, Math.PI * 2);
    g.fill();
  }
  // Trodden paths: lighter, compacted.
  for (const p of paths) {
    g.strokeStyle = 'rgba(150,122,88,0.45)';
    g.lineCap = 'round';
    g.lineWidth = px(p.w);
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    const steps = 12;
    for (let s = 1; s <= steps; s++) {
      const d = (p.len * s) / steps;
      const wob = Math.sin(s * 1.7 + p.a * 3) * 0.6;
      g.lineTo(S / 2 + px(Math.sin(p.a) * d + Math.cos(p.a) * wob), S / 2 + px(Math.cos(p.a) * d - Math.sin(p.a) * wob));
    }
    g.stroke();
  }
  // Ash and charcoal round the central fire.
  const ash = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, px(4.2));
  ash.addColorStop(0, 'rgba(40,36,34,0.95)');
  ash.addColorStop(0.45, 'rgba(78,74,70,0.85)');
  ash.addColorStop(1, 'rgba(110,104,96,0)');
  g.fillStyle = ash;
  g.beginPath();
  g.arc(S / 2, S / 2, px(4.2), 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * px(5);
    g.fillStyle = `rgba(20,18,16,${0.25 + r() * 0.35})`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0.6 + r() * 1.1, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return finish(c);
}

/** Uniform texel density: stretch a geometry's UVs so one material tiles evenly everywhere. */
function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// ------------------------------------------------------------------ village

interface Spot {
  x: number;
  z: number;
  r: number;
}

/**
 * The tribal village in a clearing on the west side. Everything here is built from
 * leaning logs, wattle, thatch, hides, bones and the CC0 props (skulls, bones,
 * crates, barrels, cauldron, pots, torches, hide tents), then baked into one mesh
 * per material. Guarded by the tribe and its chief.
 */
export class Village {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly crates: Suitcase[] = [];
  readonly fire: PuffEmitter;
  readonly smoke: PuffEmitter;
  readonly fireLight: THREE.PointLight;
  /** Torch flames and the cauldron's steam (added to the scene by the game). */
  readonly fx: PuffEmitter[] = [];
  /** Where the village's breakable effigies stand (built by the effigy system). */
  readonly effigySpots: { x: number; z: number; yaw: number }[] = [];
  readonly radius = 26;
  /** Hut footprints enemies treat as solid (they walk round a hut, never into its doorway). */
  readonly aiBlockers: { x: number; z: number; r: number }[] = [];
  private flicker = 0;
  private occupied: Spot[] = [];

  constructor(
    private terrain: Terrain,
    private colliders: ColliderGrid,
    private lib: AssetLibrary | null,
    toward?: { x: number; z: number },
  ) {
    // Flattest dry spot in the west, away from the coast.
    let best = { x: -170, z: 0, score: Infinity };
    for (let x = -230; x <= -110; x += 6) {
      for (let z = -70; z <= 70; z += 6) {
        if (terrain.coastDistance(x, z) < 30) continue;
        const h = terrain.height(x, z);
        if (h < 3 || terrain.isInLake(x, z)) continue;
        let rough = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          rough += Math.abs(terrain.height(x + Math.cos(a) * 14, z + Math.sin(a) * 14) - h);
        }
        const score = rough + Math.abs(z) * 0.02;
        if (score < best.score) best = { x, z, score };
      }
    }
    this.center.set(best.x, terrain.height(best.x, best.z), best.z);
    const C = this.center;
    const rand = mulberry32(808);
    const root = new THREE.Group();

    // Shared materials (one draw per material after baking).
    const thatch = new THREE.MeshStandardMaterial({ map: thatchTexture(), roughness: 1, color: 0xe2cc98, side: THREE.DoubleSide });
    const fringe = new THREE.MeshStandardMaterial({ map: fringeTexture(), roughness: 1, color: 0xe2cc98, side: THREE.DoubleSide, alphaTest: 0.45 });
    const wattle = new THREE.MeshStandardMaterial({ map: wattleTexture(), roughness: 0.95, color: 0xd8c2a4, side: THREE.DoubleSide });
    const hide = new THREE.MeshStandardMaterial({ map: hideTexture(), roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24190f, roughness: 1, side: THREE.BackSide });
    const rope = new THREE.MeshStandardMaterial({ color: 0x4b3a26, roughness: 1 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x7c7972, roughness: 0.9, flatShading: true });

    // Gates face the crash site and are spread round the clearing.
    const gateA = toward ? Math.atan2(toward.x - C.x, toward.z - C.z) : 1.1;
    const gates = [gateA, gateA + 2.15, gateA - 2.1];

    // Structures (local offsets from the centre).
    const chief = { x: -10, z: -4 };
    const small = { x: -4, z: 13.5 };
    const aframe = { x: 10.5, z: 7 };
    this.occupied.push(
      { x: 0, z: 0, r: 4.4 },
      { x: chief.x, z: chief.z, r: 4.6 },
      { x: small.x, z: small.z, r: 3.6 },
      { x: aframe.x, z: aframe.z, r: 3.6 },
      // Guard and chief spawn points stay clear.
      { x: -6, z: 7, r: 1.6 },
      { x: 9, z: -8, r: 1.6 },
      { x: 3, z: -3, r: 1.6 },
    );

    // ---- ground: packed earth over the whole clearing
    const paths = [
      ...gates.map((a) => ({ a, len: 22, w: 2.4 })),
      { a: Math.atan2(chief.x, chief.z), len: 7.5, w: 2 },
      { a: Math.atan2(small.x, small.z), len: 11, w: 1.6 },
      { a: Math.atan2(aframe.x, aframe.z), len: 10, w: 1.8 },
    ];
    const R = 24;
    const earthGeo = new THREE.PlaneGeometry(R * 2, R * 2, 48, 48);
    earthGeo.rotateX(-Math.PI / 2);
    const ep = earthGeo.attributes.position;
    for (let i = 0; i < ep.count; i++) ep.setY(i, terrain.height(C.x + ep.getX(i), C.z + ep.getZ(i)) - C.y + 0.05);
    earthGeo.computeVertexNormals();
    const earth = new THREE.Mesh(earthGeo, new THREE.MeshStandardMaterial({ map: earthTexture(R, paths), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    earth.position.copy(C);
    earth.receiveShadow = true;
    earth.userData.keep = true;
    this.group.add(earth);

    // ---- central fire: stone ring, logs, flames, benches and the cauldron
    const fp = this.at(0, 0);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26 + rand() * 0.08, 0), stone);
      st.position.set(fp.x + Math.sin(a) * 1.15, fp.y + 0.07, fp.z + Math.cos(a) * 1.15);
      st.scale.set(1, 0.65, 1);
      st.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      st.castShadow = true;
      root.add(st);
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const l = buildLog(1.5, 0.09);
      l.rotation.set(Math.PI / 2 - 0.55, a, 0, 'YXZ');
      l.position.set(fp.x + Math.sin(a) * 0.28, fp.y + 0.36, fp.z + Math.cos(a) * 0.28);
      l.castShadow = true;
      root.add(l);
    }
    this.colliders.add({ x: fp.x, z: fp.z, r: 1.15, y0: fp.y - 1, y1: fp.y + 0.6, kind: 'rock', ref: 0 });
    this.fire = new PuffEmitter(40, { life: 0.9, rise: 1.9, spread: 0.9, size0: 1.6, size1: 0.3, alpha: 0.9, color: 0xff5a12, color2: 0xffd27a, additive: true });
    this.fire.origin.set(fp.x, fp.y + 0.3, fp.z);
    this.smoke = new PuffEmitter(28, { life: 5, rise: 1.8, spread: 0.6, size0: 1, size1: 5, alpha: 0.28, color: 0x3a3836, color2: 0x24221f, additive: false });
    this.smoke.origin.set(fp.x, fp.y + 1.5, fp.z);
    this.fireLight = new THREE.PointLight(0xff8a3a, 28, 24, 1.6);
    this.fireLight.position.set(fp.x, fp.y + 1.4, fp.z);
    // Log benches round the fire.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const b = this.put('woodLog', { by: 'max', value: 1.55 }, Math.sin(a) * 3.3, Math.cos(a) * 3.3, a + Math.PI / 2, 0.05, root);
      if (b) this.collide(Math.sin(a) * 3.3, Math.cos(a) * 3.3, 0.55, 0.45, 'rock');
    }
    // The cannibals' cauldron on its own small fire, hung from a tripod.
    const cx = 4.3;
    const cz = 3.4;
    const cp = this.at(cx, cz);
    const caul = this.put('cauldron', { by: 'height', value: 0.85 }, cx, cz, 0.4, 0.02, root);
    if (caul) {
      caul.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material) && m.material.name === 'Soup') {
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          (m.material as THREE.MeshStandardMaterial).color.setHex(0x7a2e1e);
        }
      });
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      root.add(this.logBetween(new THREE.Vector3(cp.x + Math.sin(a) * 0.95, cp.y - 0.1, cp.z + Math.cos(a) * 0.95), new THREE.Vector3(cp.x - Math.sin(a) * 0.12, cp.y + 2.05, cp.z - Math.cos(a) * 0.12), 0.045));
    }
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 4), rope);
    chain.position.set(cp.x, cp.y + 1.45, cp.z);
    root.add(chain);
    this.collide(cx, cz, 0.7, 1.0, 'rock');
    this.occupied.push({ x: cx, z: cz, r: 1.6 });
    const steam = new PuffEmitter(12, { life: 3, rise: 0.9, spread: 0.25, size0: 0.5, size1: 1.8, alpha: 0.16, color: 0xd8d4cc, color2: 0xbdb8ae, additive: false });
    steam.origin.set(cp.x, cp.y + 0.9, cp.z);
    steam.wind.set(0.2, 0, -0.1);
    this.fx.push(steam);

    // ---- huts
    this.roundHut(root, chief.x, chief.z, 3.4, 2.15, { thatch, fringe, wattle, hide, dark, rope }, true);
    this.roundHut(root, small.x, small.z, 2.5, 1.9, { thatch, fringe, wattle, hide, dark, rope }, false);
    this.aFrameHut(root, aframe.x, aframe.z, { thatch, fringe, hide, dark });

    // ---- hide tents at the edge of the clearing
    for (const [tx, tz] of [
      [12.5, -10],
      [-12.5, -11.5],
    ]) {
      const yaw = Math.atan2(-tx, -tz);
      if (this.put('tent', { by: 'max', value: 3.6 }, tx, tz, yaw, 0.04, root)) {
        // The tent's long side runs along its local Z: three colliders down its length.
        for (const s of [-1, 0, 1]) this.collide(tx + Math.sin(yaw) * s * 1.15, tz + Math.cos(yaw) * s * 1.15, 0.95, 1.6, 'plane');
      }
      this.occupied.push({ x: tx, z: tz, r: 2.8 });
    }

    // ---- drying racks with hides, fish and meat
    this.rack(root, 5, -11.5, 0.5, hide, rope);
    this.rack(root, -15.5, 3.5, 1.9, hide, rope);

    // ---- skull gates and short palisades at each way in
    for (const a of gates) this.gate(root, a, 19.5, rope);

    // ---- torches by the gates and the chief's door (flames are particles, no extra lights)
    const torchAt: [number, number][] = [];
    for (const a of gates) {
      for (const s of [-1, 1]) {
        const aa = a + (s * 2.3) / 18.4;
        torchAt.push([Math.sin(aa) * 18.4, Math.cos(aa) * 18.4]);
      }
    }
    const chiefDoor = Math.atan2(-chief.x, -chief.z);
    const doorX = chief.x + Math.sin(chiefDoor) * 3.9;
    const doorZ = chief.z + Math.cos(chiefDoor) * 3.9;
    for (const s of [-1, 1]) torchAt.push([doorX + Math.cos(chiefDoor) * s * 1.15, doorZ - Math.sin(chiefDoor) * s * 1.15]);
    for (const [x, z] of torchAt) {
      const t = this.put('woodTorch', { by: 'height', value: 1.9 }, x, z, rand() * 6, 0.25, root);
      if (!t) continue;
      const p = this.at(x, z);
      const flame = new PuffEmitter(10, { life: 0.55, rise: 1.2, spread: 0.12, size0: 0.5, size1: 0.12, alpha: 0.9, color: 0xff6a1a, color2: 0xffd27a, additive: true });
      flame.origin.set(p.x, p.y + 1.5, p.z);
      flame.wind.set(0.15, 0, 0);
      this.fx.push(flame);
      this.collide(x, z, 0.12, 1.9, 'plane');
      this.occupied.push({ x, z, r: 0.8 });
    }

    // ---- skulls, bones, pots and barrels
    const skullFace = (o: THREE.Object3D, yaw: number) => (o.rotation.y = yaw);
    // Skull pile beside the chief's door.
    const pileX = doorX + Math.cos(chiefDoor) * 2.1;
    const pileZ = doorZ - Math.sin(chiefDoor) * 2.1;
    for (let k = 0; k < 6; k++) {
      const layer = k < 4 ? 0 : 1;
      const a = (k / (layer ? 2 : 4)) * Math.PI * 2 + layer;
      const rr = layer ? 0.14 : 0.26;
      const s = this.put('skull', { by: 'height', value: 0.24 }, pileX + Math.sin(a) * rr, pileZ + Math.cos(a) * rr, 0, 0.02 - layer * 0.17, root);
      if (s) {
        skullFace(s, chiefDoor + (rand() - 0.5) * 1.2);
        s.rotation.x = (rand() - 0.5) * 0.4;
      }
    }
    this.occupied.push({ x: pileX, z: pileZ, r: 1 });
    // Skulls on stakes along the path to the chief's hut.
    for (const t of [0.35, 0.62]) {
      for (const s of [-1, 1]) {
        const px = chief.x * (1 - t) + 0 * t + Math.cos(chiefDoor) * s * 1.6;
        const pz = chief.z * (1 - t) + 0 * t - Math.sin(chiefDoor) * s * 1.6;
        const p = this.at(px, pz);
        const top = p.clone().setY(p.y + 1.85);
        root.add(this.logBetween(p.clone().setY(p.y - 0.25), top, 0.045));
        const sk = this.put('skull', { by: 'height', value: 0.26 }, px, pz, chiefDoor + Math.PI + (rand() - 0.5) * 0.6, -1.78, root);
        if (sk) sk.rotation.z = (rand() - 0.5) * 0.25;
        this.collide(px, pz, 0.12, 2, 'plane');
        this.occupied.push({ x: px, z: pz, r: 0.9 });
      }
    }
    // Bones scattered round the fire and the huts.
    for (let k = 0; k < 14; k++) {
      const a = rand() * Math.PI * 2;
      const d = 2.2 + rand() * 9;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      if (this.blocked(x, z, 0.3)) continue;
      const b = this.put('bone', { by: 'max', value: 0.35 + rand() * 0.25 }, x, z, rand() * 6, 0.0, root);
      if (b) b.rotation.z = (rand() - 0.5) * 0.3;
    }
    // Pots: one inside the chief's hut, two by the fire.
    this.put('pot', { by: 'max', value: 0.7 }, chief.x - 1.2, chief.z - 0.6, 0.3, 0.02, root);
    for (const [x, z] of [
      [1.9, -2.6],
      [-2.4, 2.1],
    ]) {
      if (this.put('pot', { by: 'max', value: 0.5 }, x, z, rand() * 6, 0.02, root)) this.collide(x, z, 0.3, 0.4, 'rock');
    }
    // Barrels of water and fermenting fruit.
    for (const [x, z] of [
      [13.6, 3.2],
      [14.2, 4.4],
      [-12.8, 8.2],
      [2.6, 15.6],
    ]) {
      if (this.blocked(x, z, 0.6)) continue;
      if (this.put('barrel', { by: 'height', value: 1.0 }, x, z, rand() * 6, 0.03, root)) {
        this.collide(x, z, 0.48, 1.0, 'plane');
        this.occupied.push({ x, z, r: 0.9 });
      }
    }

    // ---- lootable crates (open like the luggage)
    const loot: ItemType[][] = [
      ['food', 'cloth'],
      ['bandage', 'food'],
      ['cloth', 'bandage'],
      ['food', 'food'],
    ];
    const crateAt: [number, number, number][] = [
      [aframe.x - 0.6, aframe.z - 0.2, 0.3],
      [chief.x + 2.6, chief.z - 3.6, 1.1],
      [7.2, -12.6, 0.2],
      [-1.2, 11.2, 2.4],
    ];
    loot.forEach((contents, i) => {
      const [x, z, yaw] = crateAt[i];
      const p = this.at(x, z);
      const g = new THREE.Group();
      const model = this.lib?.has('crate') ? this.lib.instance('crate', { by: 'height', value: 0.62 }) : null;
      if (model) {
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
        });
        g.add(model);
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }));
        box.position.y = 0.31;
        g.add(box);
      }
      g.position.set(p.x, p.y - 0.02, p.z);
      g.rotation.y = yaw;
      this.crates.push({ mesh: g, pos: new THREE.Vector3(p.x, p.y + 0.31, p.z), hp: 50, color: 0x6b4a2e, contents, broken: false });
      this.occupied.push({ x, z, r: 0.9 });
    });

    // ---- spots for the breakable effigies on a ring between the buildings
    for (let k = 0; k < 120 && this.effigySpots.length < 5; k++) {
      const a = k * 2.399 + 0.4;
      const d = 12.5 + (k % 4) * 1.4;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      if (this.blocked(x, z, 1.6)) continue;
      if (this.effigySpots.some((s) => Math.hypot(s.x - (C.x + x), s.z - (C.z + z)) < 7)) continue;
      if (gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.22)) continue;
      this.effigySpots.push({ x: C.x + x, z: C.z + z, yaw: Math.atan2(-x, -z) });
      this.occupied.push({ x, z, r: 1.2 });
    }

    // Bake every static piece into one mesh per material.
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true;
    });
    for (const m of bakeStatic(root)) this.group.add(m);
  }

  // ---------------------------------------------------------------- helpers

  /** World point on the ground at a local offset from the centre. */
  private at(dx: number, dz: number): THREE.Vector3 {
    const x = this.center.x + dx;
    const z = this.center.z + dz;
    return new THREE.Vector3(x, this.terrain.height(x, z), z);
  }

  private blocked(x: number, z: number, r: number): boolean {
    return this.occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r);
  }

  private collide(dx: number, dz: number, r: number, h: number, kind: 'rock' | 'plane'): void {
    const p = this.at(dx, dz);
    this.colliders.add({ x: p.x, z: p.z, r, y0: p.y - 1, y1: p.y + h, kind, ref: 1 });
  }

  /** A CC0 model standing on the ground at a local offset. */
  private put(name: AssetName, fit: { by: 'height' | 'max' | 'footprint'; value: number }, dx: number, dz: number, yaw: number, sink: number, parent: THREE.Object3D): THREE.Group | null {
    if (!this.lib?.has(name)) return null;
    const o = this.lib.instance(name, fit);
    const p = this.at(dx, dz);
    o.position.set(p.x, p.y - sink, p.z);
    o.rotation.y = yaw;
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true;
    });
    parent.add(o);
    return o;
  }

  /** A log from a to b. */
  private logBetween(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Mesh {
    const d = new THREE.Vector3().subVectors(b, a);
    const log = buildLog(d.length(), r);
    log.position.copy(a).addScaledVector(d, 0.5);
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    log.castShadow = true;
    return log;
  }

  /** Thatched cone roof in tiers with ragged straw fringes, an inner shade and crown poles. */
  private coneRoof(parent: THREE.Object3D, cx: number, eaveY: number, cz: number, Rb: number, H: number, wallR: number, mats: { thatch: THREE.Material; fringe: THREE.Material; dark: THREE.Material }): void {
    const tiers = 3;
    for (let k = 0; k < tiers; k++) {
      const s0 = k / tiers;
      const s1 = Math.min(1, (k + 1) / tiers + 0.14);
      const off = 0.05 + 0.09 * k;
      const rB = Rb * (1 - s0) + off;
      const rT = Math.max(0.06, Rb * (1 - s1) + off * (1 - s1 * 0.8));
      const yB = eaveY + H * s0;
      const yT = eaveY + H * s1;
      const h = yT - yB;
      const geo = new THREE.CylinderGeometry(rT, rB, h, 28, 3, true);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const a = Math.atan2(x, z);
        const j = 1 + 0.035 * Math.sin(a * 5 + k * 1.7) + 0.02 * Math.sin(a * 13 + k);
        pos.setX(i, x * j);
        pos.setZ(i, z * j);
      }
      geo.computeVertexNormals();
      scaleUV(geo, (Math.PI * 2 * rB) / 1.4, h / 1.0);
      const tier = new THREE.Mesh(geo, mats.thatch);
      tier.position.set(cx, yB + h / 2, cz);
      tier.castShadow = true;
      parent.add(tier);
      const fr = new THREE.CylinderGeometry(rB + 0.02, rB + 0.16, 0.46, 28, 1, true);
      scaleUV(fr, (Math.PI * 2 * rB) / 1.2, 1);
      const fringe = new THREE.Mesh(fr, mats.fringe);
      fringe.position.set(cx, yB - 0.15, cz);
      fringe.castShadow = true;
      parent.add(fringe);
    }
    const inner = new THREE.Mesh(new THREE.ConeGeometry(Rb, H, 24, 1, true), mats.dark);
    inner.position.set(cx, eaveY + H / 2 - 0.05, cz);
    parent.add(inner);
    // Crown: the frame poles cross at the apex and stick out above it.
    const apex = new THREE.Vector3(cx, eaveY + H + 0.05, cz);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const s = new THREE.Vector3(cx + Math.sin(a) * wallR * 0.92, eaveY - 0.05, cz + Math.cos(a) * wallR * 0.92);
      const d = new THREE.Vector3().subVectors(apex, s).normalize();
      parent.add(this.logBetween(s, apex.clone().addScaledVector(d, 0.85 + (i % 3) * 0.12), 0.045));
    }
    // Lashing round the crown.
    const lash = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 5, 12), mats.thatch);
    lash.rotation.x = Math.PI / 2;
    lash.position.copy(apex).y -= 0.1;
    parent.add(lash);
  }

  /** Round hut: stake wall with wattle, thatch cone roof, door posts, hide curtain and skulls. */
  private roundHut(
    parent: THREE.Object3D,
    dx: number,
    dz: number,
    R: number,
    wallH: number,
    m: { thatch: THREE.Material; fringe: THREE.Material; wattle: THREE.Material; hide: THREE.Material; dark: THREE.Material; rope: THREE.Material },
    chief: boolean,
  ): void {
    const r = mulberry32(Math.round(dx * 31 + dz * 7) + 99);
    const c = this.at(dx, dz);
    this.aiBlockers.push({ x: c.x, z: c.z, r: R + 0.25 });
    const eave = c.y + wallH;
    const door = Math.atan2(-dx, -dz);
    const gap = 0.68 / R;
    const wrapDiff = (a: number) => Math.atan2(Math.sin(a - door), Math.cos(a - door));
    // Stake wall following the ground.
    const n = Math.round((Math.PI * 2 * R) / 0.22);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(wrapDiff(a)) < gap) continue;
      const x = c.x + Math.sin(a) * R;
      const z = c.z + Math.cos(a) * R;
      const g = this.terrain.height(x, z);
      const top = eave + 0.12 + r() * 0.22;
      const lean = (r() - 0.5) * 0.05;
      parent.add(this.logBetween(new THREE.Vector3(x, g - 0.2, z), new THREE.Vector3(x + lean, top, z + lean), 0.055 + r() * 0.025));
    }
    // Woven wattle panel just inside the stakes, open at the door.
    const wall = new THREE.CylinderGeometry(R - 0.07, R - 0.07, wallH + 0.25, 36, 1, true, door + gap, Math.PI * 2 - gap * 2);
    scaleUV(wall, (Math.PI * 2 * R) / 2.2, (wallH + 0.25) / 2.2);
    const wm = new THREE.Mesh(wall, m.wattle);
    wm.position.set(c.x, c.y + (wallH + 0.25) / 2 - 0.2, c.z);
    wm.castShadow = true;
    parent.add(wm);
    // Two woven bands round the outside.
    for (const hgt of [0.55, 1.35]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) {
        const a = door + gap + (i / 40) * (Math.PI * 2 - gap * 2);
        pts.push(new THREE.Vector3(c.x + Math.sin(a) * (R + 0.05), c.y + hgt * (wallH / 2), c.z + Math.cos(a) * (R + 0.05)));
      }
      const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.04, 5, false), m.rope);
      parent.add(band);
    }
    this.coneRoof(parent, c.x, eave, c.z, R + 0.95, R * 0.95 + 1.1, R, m);
    // Door posts, lintel, hide curtain, skulls and crossed bones.
    const posts: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const a = door + s * gap;
      const x = c.x + Math.sin(a) * (R + 0.05);
      const z = c.z + Math.cos(a) * (R + 0.05);
      const g = this.terrain.height(x, z);
      const top = new THREE.Vector3(x, eave + 0.3, z);
      parent.add(this.logBetween(new THREE.Vector3(x, g - 0.25, z), top, 0.1));
      posts.push(top);
      const sk = this.lib?.has('skull') ? this.lib.instance('skull', { by: 'height', value: chief ? 0.3 : 0.24 }) : null;
      if (sk) {
        sk.position.copy(top);
        sk.rotation.y = door + (r() - 0.5) * 0.3;
        sk.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        parent.add(sk);
      }
    }
    const lintel = this.logBetween(posts[0].clone().setY(eave - 0.05), posts[1].clone().setY(eave - 0.05), 0.07);
    parent.add(lintel);
    const dw = posts[0].distanceTo(posts[1]);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(dw * 0.62, wallH * 0.92), m.hide);
    const mid = posts[0].clone().lerp(posts[1], 0.3);
    curtain.position.set(mid.x - Math.sin(door) * 0.08, c.y + wallH * 0.46, mid.z - Math.cos(door) * 0.08);
    curtain.rotation.y = door;
    parent.add(curtain);
    if (chief && this.lib?.has('bone')) {
      for (const s of [-1, 1]) {
        const b = this.lib.instance('bone', { by: 'max', value: 0.55 });
        b.position.set(c.x + Math.sin(door) * (R + 0.16), eave + 0.08, c.z + Math.cos(door) * (R + 0.16));
        b.rotation.set(0, door + Math.PI / 2, s * 0.55, 'YXZ');
        parent.add(b);
      }
    }
    // Inside: a hide on the floor.
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.9, R * 0.9), m.hide);
    mat.rotation.set(-Math.PI / 2, 0, r() * 3);
    mat.position.set(c.x - Math.sin(door) * R * 0.35, c.y + 0.07, c.z - Math.cos(door) * R * 0.35);
    parent.add(mat);
    // Wall colliders, leaving the doorway open.
    const steps = Math.round((Math.PI * 2 * R) / 0.6);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      if (Math.abs(wrapDiff(a)) < gap + 0.12) continue;
      this.colliders.add({ x: c.x + Math.sin(a) * R, z: c.z + Math.cos(a) * R, r: 0.36, y0: c.y - 1, y1: eave + 0.5, kind: 'plane', ref: 1 });
    }
  }

  /** A-frame lodge: leaning rafters on a ridge, thatch on both slopes, stick back wall, hide flap. */
  private aFrameHut(parent: THREE.Object3D, dx: number, dz: number, m: { thatch: THREE.Material; fringe: THREE.Material; hide: THREE.Material; dark: THREE.Material }): void {
    const L = 5.2;
    const W = 4.0;
    const H = 3.1;
    const c = this.at(dx, dz);
    this.aiBlockers.push({ x: c.x, z: c.z, r: 2.8 });
    // Open end (local -X) faces the fire.
    const yaw = Math.atan2(-dz, dx);
    const g = new THREE.Group();
    g.position.copy(c);
    g.rotation.y = yaw;
    parent.add(g);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    g.add(this.logBetween(v(-L / 2 - 0.35, H, 0), v(L / 2 + 0.35, H, 0), 0.09));
    for (const x of [-L / 2, L / 2]) {
      for (const s of [-1, 1]) g.add(this.logBetween(v(x, -0.25, s * (W / 2 + 0.2)), v(x, H + 0.55, -s * 0.3), 0.1));
    }
    for (let x = -L / 2 + 0.45; x < L / 2 - 0.2; x += 0.55) {
      for (const s of [-1, 1]) g.add(this.logBetween(v(x, -0.2, s * (W / 2 + 0.12)), v(x, H + 0.22, -s * 0.16), 0.055));
    }
    // Thatch slopes (thick boxes) with fringes along the eaves.
    const slope = Math.hypot(W / 2 + 0.4, H + 0.1);
    const ang = Math.atan2(H + 0.1, W / 2 + 0.4);
    for (const s of [-1, 1]) {
      const geo = new THREE.BoxGeometry(L + 0.8, 0.16, slope + 0.2);
      scaleUV(geo, (L + 0.8) / 1.4, (slope + 0.2) / 1.0);
      const panel = new THREE.Mesh(geo, m.thatch);
      panel.position.set(0, (H + 0.1) / 2 + 0.12, s * ((W / 2 + 0.4) / 2 + 0.06));
      panel.rotation.x = s * ang;
      panel.castShadow = true;
      g.add(panel);
      const fg = new THREE.PlaneGeometry(L + 0.8, 0.5);
      scaleUV(fg, (L + 0.8) / 1.2, 1);
      const fr = new THREE.Mesh(fg, m.fringe);
      fr.position.set(0, -0.05, s * (W / 2 + 0.42));
      fr.rotation.x = s * 0.25;
      g.add(fr);
    }
    // Back wall of upright sticks under the gable.
    for (let z = -W / 2 + 0.1; z < W / 2 - 0.05; z += 0.15) {
      const h = H * (1 - Math.abs(z) / (W / 2 + 0.2));
      g.add(this.logBetween(v(L / 2 - 0.08, -0.2, z), v(L / 2 - 0.08, h, z), 0.04));
    }
    // Hide flap over half the doorway.
    const tri = new THREE.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(W / 2 + 0.1, 0);
    tri.lineTo(0, H);
    tri.lineTo(0, 0);
    const tg = new THREE.ShapeGeometry(tri);
    scaleUV(tg, 1 / (W / 2 + 0.1), 1 / H);
    const flap = new THREE.Mesh(tg, m.hide);
    flap.rotation.y = -Math.PI / 2;
    flap.position.set(-L / 2 + 0.06, 0, 0);
    g.add(flap);
    // Colliders along the eaves and the back.
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const add = (lx: number, lz: number, r: number) => this.colliders.add({ x: c.x + lx * cs + lz * sn, z: c.z - lx * sn + lz * cs, r, y0: c.y - 1, y1: c.y + H, kind: 'plane', ref: 1 });
    for (let x = -L / 2; x <= L / 2 + 0.01; x += 0.6) {
      add(x, W / 2, 0.36);
      add(x, -W / 2, 0.36);
    }
    for (let z = -W / 2 + 0.6; z < W / 2; z += 0.6) add(L / 2, z, 0.3);
  }

  /** Drying rack: two forked posts, a pole, hides stretched on it and fish and meat on strings. */
  private rack(parent: THREE.Object3D, dx: number, dz: number, yaw: number, hide: THREE.Material, rope: THREE.Material): void {
    const c = this.at(dx, dz);
    const g = new THREE.Group();
    g.position.copy(c);
    g.rotation.y = yaw;
    parent.add(g);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (const x of [-1.4, 1.4]) {
      g.add(this.logBetween(v(x, -0.2, -0.3), v(x, 2.05, 0.05), 0.06));
      g.add(this.logBetween(v(x, -0.2, 0.3), v(x, 2.05, -0.05), 0.06));
    }
    g.add(this.logBetween(v(-1.7, 1.95, 0), v(1.7, 1.95, 0), 0.05));
    for (const x of [-0.75, 0.55]) {
      const h = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.25), hide);
      h.position.set(x, 1.3, 0.02);
      h.rotation.z = (x > 0 ? 1 : -1) * 0.05;
      g.add(h);
    }
    const hang = (o: THREE.Object3D, x: number, drop: number) => {
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, drop, 3), rope);
      str.position.set(x, 1.95 - drop / 2, 0.12);
      g.add(str);
      o.position.set(x, 1.95 - drop - 0.05, 0.12);
      g.add(o);
    };
    const f1 = buildFish(false);
    f1.rotation.set(0, 0, Math.PI / 2);
    hang(f1, -1.1, 0.25);
    const f2 = buildFish(false);
    f2.rotation.set(0, 0.4, Math.PI / 2);
    hang(f2, 1.15, 0.3);
    const meat = buildMeat(false);
    meat.rotation.set(Math.PI / 2, 0, 0);
    hang(meat, 0, 0.35);
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const x of [-1.4, 1.4]) this.colliders.add({ x: c.x + x * cs, z: c.z - x * sn, r: 0.22, y0: c.y - 1, y1: c.y + 2, kind: 'plane', ref: 1 });
    this.occupied.push({ x: dx, z: dz, r: 2 });
  }

  /** Skull gate at angle `a`: two tall posts, a cross bar hung with bones, and sharpened palisades either side. */
  private gate(parent: THREE.Object3D, a: number, R: number, rope: THREE.Material): void {
    const r = mulberry32(Math.round(a * 1000) + 7);
    const point = (ang: number, rad: number) => this.at(Math.sin(ang) * rad, Math.cos(ang) * rad);
    const half = 1.7 / R;
    const tops: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const p = point(a + s * half, R);
      const top = p.clone().setY(p.y + 3.7);
      parent.add(this.logBetween(p.clone().setY(p.y - 0.3), top, 0.14));
      tops.push(top);
      const sk = this.lib?.has('skull') ? this.lib.instance('skull', { by: 'height', value: 0.3 }) : null;
      if (sk) {
        sk.position.copy(top).y -= 0.02;
        sk.rotation.y = a + (r() - 0.5) * 0.4;
        parent.add(sk);
      }
      this.colliders.add({ x: p.x, z: p.z, r: 0.2, y0: p.y - 1, y1: p.y + 3.7, kind: 'plane', ref: 1 });
      this.occupied.push({ x: p.x - this.center.x, z: p.z - this.center.z, r: 0.8 });
    }
    const barY = Math.min(tops[0].y, tops[1].y) - 0.45;
    parent.add(this.logBetween(tops[0].clone().setY(barY), tops[1].clone().setY(barY), 0.08));
    // Bones hanging from the bar.
    if (this.lib?.has('bone')) {
      for (let k = 0; k < 3; k++) {
        const p = tops[0].clone().lerp(tops[1], 0.28 + k * 0.22).setY(barY);
        const drop = 0.35 + r() * 0.35;
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, drop, 3), rope);
        str.position.copy(p).y -= drop / 2;
        parent.add(str);
        const b = this.lib.instance('bone', { by: 'max', value: 0.42 });
        b.position.copy(p).y -= drop + 0.22;
        b.rotation.set(0, a + Math.PI / 2, Math.PI / 2 + (r() - 0.5) * 0.3, 'YXZ');
        parent.add(b);
      }
    }
    // Sharpened stakes either side of the gate, leaning outward.
    for (const s of [-1, 1]) {
      for (let k = 0; k < 11; k++) {
        const ang = a + s * (half + (0.5 + k * 0.45) / R);
        const p = point(ang, R);
        const h = 2.3 + r() * 0.6;
        const out = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        const top = p.clone().addScaledVector(out, 0.45).setY(p.y + h);
        parent.add(this.logBetween(p.clone().setY(p.y - 0.3), top, 0.09 + r() * 0.03));
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 7), logMaterials()[0]);
        const dir = new THREE.Vector3().subVectors(top, p).normalize();
        tip.position.copy(top).addScaledVector(dir, 0.2);
        tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        parent.add(tip);
        this.colliders.add({ x: p.x, z: p.z, r: 0.26, y0: p.y - 1, y1: p.y + h, kind: 'plane', ref: 1 });
      }
      // A lashing pole along the stakes.
      const p0 = point(a + s * (half + 0.5 / R), R).addScaledVector(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 0.18);
      const p1 = point(a + s * (half + 5 / R), R).addScaledVector(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 0.18);
      p0.y += 1.3;
      p1.y += 1.3;
      parent.add(this.logBetween(p0, p1, 0.05));
    }
  }

  setViewportHeight(h: number): void {
    this.fire.setViewportHeight(h);
    this.smoke.setViewportHeight(h);
    for (const e of this.fx) e.setViewportHeight(h);
  }

  update(dt: number, light: THREE.Color, player?: THREE.Vector3): void {
    this.fire.update(dt);
    this.smoke.setTint(new THREE.Color(0x3a3836).multiply(light), new THREE.Color(0x24221f).multiply(light));
    this.smoke.update(dt);
    this.flicker += dt;
    this.fireLight.intensity = 26 + Math.sin(this.flicker * 15) * 4 + Math.sin(this.flicker * 6.7) * 3;
    // Torch flames and steam only animate when someone could see them.
    if (!player || Math.hypot(player.x - this.center.x, player.z - this.center.z) < 140) for (const e of this.fx) e.update(dt);
  }
}
