import * as THREE from 'three';
import { tr } from '../ui/i18n';
import { AssetLibrary, AssetName } from '../assets/assets';
import { clamp, wrapAngle } from '../core/math';
import { buildBone, buildFeather, buildHorn } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';

/**
 * scout: Day 1 night watcher that keeps 30-45 m away and runs if approached.
 * stalker: Day 2 night prowler that circles and fights only when provoked.
 * raider: Day 3+ night patrol that hunts the player.
 * guard / boss: the village and its Tribal Chief.
 * guardian: the giant skeleton at the north cave. alpha: the beast at the east altar.
 */
export type Role = 'scout' | 'stalker' | 'raider' | 'guard' | 'boss' | 'guardian' | 'alpha' | 'skeleton' | 'skelGuard' | 'deepLord';
export type BossRole = 'boss' | 'guardian' | 'alpha' | 'deepLord';

export interface SafeZone {
  x: number;
  z: number;
  r: number;
}

type ClipKey = 'idle' | 'walk' | 'run' | 'attack' | 'death';

interface RoleCfg {
  asset: AssetName;
  height: number;
  hp: number;
  walk: number;
  run: number;
  damage: number;
  reach: number;
  radius: number;
  /** Seconds from the start of the swing to the blow (the telegraph). */
  windup: number;
  attackTime: number;
  aggro: number;
  leash: number;
  name: string;
  clips: Record<ClipKey, RegExp>;
}

const HUMAN_CLIPS: Record<ClipKey, RegExp> = { idle: /\|Idle$/, walk: /\|Walk$/, run: /\|Run$/, attack: /\|Punch$/, death: /\|Death$/ };
const SKELETON_CLIPS: Record<ClipKey, RegExp> = { idle: /Skeleton_Idle$/, walk: /Skeleton_Running$/, run: /Skeleton_Running$/, attack: /Skeleton_Attack$/, death: /Skeleton_Death$/ };
const SPIDER_CLIPS: Record<ClipKey, RegExp> = { idle: /Spider_Idle$/, walk: /Spider_Walk$/, run: /Spider_Walk$/, attack: /Spider_Attack$/, death: /Spider_Death$/ };
const GIANT_CLIPS: Record<ClipKey, RegExp> = { idle: /\|Idle$/, walk: /\|Walk$/, run: /\|Run$/, attack: /\|Attack$/, death: /\|Death$/ };
const WOLF_CLIPS: Record<ClipKey, RegExp> = { idle: /^(AnimalArmature\|)?Idle$/, walk: /^(AnimalArmature\|)?Walk$/, run: /^(AnimalArmature\|)?Gallop$/, attack: /^(AnimalArmature\|)?Attack$/, death: /^(AnimalArmature\|)?Death$/ };

// The player sprints at 10 m/s: every enemy is slower, so running away always works.
const ROLE: Record<Role, RoleCfg> = {
  scout: { asset: 'enemyHuman', height: 1.72, hp: 50, walk: 1.6, run: 5.5, damage: 0, reach: 0, radius: 0.35, windup: 0.5, attackTime: 1, aggro: 0, leash: 0, name: 'Batedor', clips: HUMAN_CLIPS },
  stalker: { asset: 'enemyHuman', height: 1.75, hp: 60, walk: 1.8, run: 5.2, damage: 12, reach: 2.0, radius: 0.35, windup: 0.5, attackTime: 1, aggro: 0, leash: 0, name: 'Espreitador', clips: HUMAN_CLIPS },
  raider: { asset: 'enemyHuman', height: 1.78, hp: 65, walk: 2.0, run: 5.0, damage: 12, reach: 2.0, radius: 0.35, windup: 0.5, attackTime: 1, aggro: 0, leash: 0, name: 'Patrulha', clips: HUMAN_CLIPS },
  guard: { asset: 'enemyHuman', height: 1.85, hp: 80, walk: 1.6, run: 4.8, damage: 14, reach: 2.1, radius: 0.38, windup: 0.5, attackTime: 1, aggro: 22, leash: 40, name: 'Guarda', clips: HUMAN_CLIPS },
  boss: { asset: 'enemyHuman', height: 2.45, hp: 280, walk: 1.5, run: 4.2, damage: 24, reach: 2.8, radius: 0.5, windup: 0.7, attackTime: 1.3, aggro: 18, leash: 40, name: 'Chefe Tribal', clips: HUMAN_CLIPS },
  guardian: { asset: 'enemySkeleton', height: 3.6, hp: 450, walk: 1.4, run: 3.8, damage: 30, reach: 3.2, radius: 0.9, windup: 0.8, attackTime: 1.5, aggro: 22, leash: 36, name: 'Guardião da Caverna', clips: SKELETON_CLIPS },
  skeleton: { asset: 'enemySpider', height: 1.0, hp: 110, walk: 1.8, run: 4.6, damage: 14, reach: 2.3, radius: 0.85, windup: 0.45, attackTime: 1.0, aggro: 15, leash: 28, name: 'Aranha Gigante', clips: SPIDER_CLIPS },
  skelGuard: { asset: 'enemySkeleton', height: 1.95, hp: 130, walk: 1.3, run: 4.0, damage: 16, reach: 2.0, radius: 0.42, windup: 0.55, attackTime: 1.1, aggro: 16, leash: 26, name: 'Esqueleto Guarda', clips: SKELETON_CLIPS },
  deepLord: { asset: 'enemyDeepLord', height: 3.3, hp: 340, walk: 1.4, run: 3.8, damage: 28, reach: 3.0, radius: 0.9, windup: 0.75, attackTime: 1.4, aggro: 18, leash: 26, name: 'Senhor das Profundezas', clips: GIANT_CLIPS },
  alpha: { asset: 'enemyWolf', height: 2.3, hp: 650, walk: 1.8, run: 6.5, damage: 34, reach: 3.0, radius: 0.9, windup: 0.6, attackTime: 1.2, aggro: 26, leash: 45, name: 'Fera Alfa', clips: WOLF_CLIPS },
};
/** Enemy names follow the current language (the Portuguese ones stay in the table). */
const NAME_EN: Record<string, string> = {
  scout: 'Scout',
  stalker: 'Stalker',
  raider: 'Raider',
  guard: 'Guard',
  boss: 'Tribal Chief',
  guardian: 'Cave Guardian',
  skeleton: 'Giant Spider',
  skelGuard: 'Skeleton Guard',
  deepLord: 'Lord of the Depths',
  alpha: 'Alpha Beast',
};
for (const [role, cfg] of Object.entries(ROLE)) {
  const pt = cfg.name;
  Object.defineProperty(cfg, 'name', { get: () => tr(pt, NAME_EN[role] ?? pt) });
}


export interface Cannibal {
  role: Role;
  cfg: RoleCfg;
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<ClipKey, THREE.AnimationAction>>;
  clip: ClipKey | null;
  mats: THREE.MeshStandardMaterial[];
  flashT: number;
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  state: 'idle' | 'move' | 'attack' | 'dead';
  attackT: number;
  attackCd: number;
  provoked: boolean;
  deadT: number;
  dropped: boolean;
  home: THREE.Vector3;
  night: boolean;
  leaving: boolean;
  circleDir: number;
  hpBar: THREE.Sprite | null;
  hpCanvas: HTMLCanvasElement | null;
  shownHp: number;
  roarT: number;
  /** Seconds left on fire (flaming axe / torch), and the damage-tick clock. */
  burnT: number;
  burnTick: number;
  /** True once it has started hunting the player (plays the alert sting once). */
  alerted: boolean;
  /** Steering: time pinned against something, the side-step it chose and for how long. */
  stuckT: number;
  avoidOff: number;
  avoidT: number;
  lastX: number;
  lastZ: number;
  /** Fallback fall (no usable death clip): tilt toward the ground. */
  fallAng: number;
  /** Lives inside the cave: walks its floor, kept by its walls, only active while the player is in. */
  cave: boolean;
}

let maskTex: THREE.CanvasTexture | null = null;

/** Carved wooden mask: slit eyes, jagged painted teeth, red war bars. Not friendly. */
function maskPaint(): THREE.CanvasTexture {
  if (maskTex) return maskTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9cdb4';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#120804';
  g.beginPath();
  g.moveTo(18, 44);
  g.lineTo(56, 56);
  g.lineTo(18, 62);
  g.fill();
  g.beginPath();
  g.moveTo(110, 44);
  g.lineTo(72, 56);
  g.lineTo(110, 62);
  g.fill();
  g.fillRect(30, 86, 68, 20);
  g.fillStyle = '#d9cdb4';
  for (let x = 30; x < 98; x += 9) {
    g.beginPath();
    g.moveTo(x, 86);
    g.lineTo(x + 4.5, 99);
    g.lineTo(x + 9, 86);
    g.fill();
  }
  g.fillStyle = '#9e2a22';
  g.fillRect(0, 22, 128, 8);
  g.fillRect(60, 60, 8, 24);
  maskTex = new THREE.CanvasTexture(c);
  maskTex.colorSpace = THREE.SRGBColorSpace;
  return maskTex;
}

/** A bone-attached prop keeps its size in metres whatever the bone's own scale. */
function attach(bone: THREE.Object3D | undefined, obj: THREE.Object3D, worldScale: number, offset: [number, number, number] = [0, 0, 0]): void {
  if (!bone) return;
  const ws = new THREE.Vector3();
  bone.getWorldScale(ws);
  const k = 1 / (ws.x || 1);
  // Bones can carry a large scale (the rig was authored in centimetres): undo it so
  // size and offset are in metres.
  obj.scale.multiplyScalar(worldScale * k);
  obj.position.set(offset[0] * worldScale * k, offset[1] * worldScale * k, offset[2] * worldScale * k);
  bone.add(obj);
}

let chiefTex: THREE.CanvasTexture | null = null;

/** The chief's mask: blackened wood, bone-white skull paint round deep sockets, dried blood. */
function chiefMaskPaint(): THREE.CanvasTexture {
  if (chiefTex) return chiefTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#2a1d14');
  grd.addColorStop(1, '#17100b');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  // Wood grain.
  g.strokeStyle = 'rgba(80,56,36,0.35)';
  for (let x = 0; x < 256; x += 5) {
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 6, 80, x - 6, 170, x + 3, 256);
    g.stroke();
  }
  // Skull paint: pale band over the eyes and down the cheeks.
  g.fillStyle = 'rgba(214,202,176,0.88)';
  g.beginPath();
  g.ellipse(128, 104, 104, 46, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(70, 120, 116, 70);
  // Deep sockets and a slit nose.
  g.fillStyle = '#060302';
  for (const x of [84, 172]) {
    g.beginPath();
    g.ellipse(x, 106, 30, 22, x < 128 ? 0.25 : -0.25, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(128, 120);
  g.lineTo(116, 160);
  g.lineTo(140, 160);
  g.fill();
  // Stitched mouth with filed teeth.
  g.fillRect(78, 184, 100, 26);
  g.fillStyle = '#d6caae';
  for (let x = 80; x < 176; x += 10) {
    g.beginPath();
    g.moveTo(x, 184);
    g.lineTo(x + 5, 199);
    g.lineTo(x + 10, 184);
    g.fill();
    g.beginPath();
    g.moveTo(x, 210);
    g.lineTo(x + 5, 197);
    g.lineTo(x + 10, 210);
    g.fill();
  }
  // Dried blood streaks running from the sockets.
  g.strokeStyle = 'rgba(96,18,12,0.85)';
  g.lineWidth = 6;
  for (const x of [70, 96, 160, 188]) {
    g.beginPath();
    g.moveTo(x, 122);
    g.bezierCurveTo(x + 4, 160, x - 3, 200, x + 2, 250);
    g.stroke();
  }
  chiefTex = new THREE.CanvasTexture(c);
  chiefTex.colorSpace = THREE.SRGBColorSpace;
  return chiefTex;
}

/** Organic carved mask for the chief: bulging cheeks, narrow chin, brow ridge, tusks. Faces +Z. */
function chiefMask(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.145, 0.125, 0.34, 18, 8, true, -Math.PI * 0.46, Math.PI * 0.92);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i) / 0.34;
    let k = 1 + 0.1 * Math.cos(v * Math.PI * 1.4);
    if (v < -0.2) k *= 1 - (-0.2 - v) * 1.1;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: chiefMaskPaint(), roughness: 0.8, side: THREE.DoubleSide })));
  const dark = new THREE.MeshStandardMaterial({ color: 0x24170e, roughness: 0.9 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xc9bc9c, roughness: 0.7 });
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 16, Math.PI * 0.7), dark);
  brow.rotation.set(Math.PI / 2, 0, Math.PI * 0.15 + Math.PI / 2);
  brow.position.set(0, 0.05, 0.012);
  brow.scale.set(1, 1, 0.6);
  g.add(brow);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 4), dark);
  nose.position.set(0, 0.0, 0.15);
  nose.rotation.x = 0.4;
  g.add(nose);
  for (const sx of [-1, 1]) {
    const tusk = buildHorn(0.09, 0.012, 1.2, bone);
    tusk.position.set(sx * 0.06, -0.09, 0.13);
    tusk.rotation.set(0.2, Math.PI, sx * 0.25);
    g.add(tusk);
  }
  return g;
}

/** The chief's headdress: braided band, swept-back horns, a fan of dark feathers, bone and beads. */
function chiefCrown(): THREE.Group {
  const crown = new THREE.Group();
  const cord = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  const horn = new THREE.MeshStandardMaterial({ color: 0x9c8e72, roughness: 0.7 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xcfc3a6, roughness: 0.65 });
  const blood = new THREE.MeshStandardMaterial({ color: 0x5a1a12, roughness: 0.8 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.032, 6, 18), cord);
  band.rotation.x = Math.PI / 2;
  crown.add(band);
  for (const sx of [-1, 1]) {
    const h = buildHorn(0.36, 0.034, 1.7, horn);
    h.position.set(sx * 0.12, 0.02, -0.01);
    h.rotation.set(0, -sx * Math.PI / 2, -sx * 0.55);
    crown.add(h);
  }
  for (let k = 0; k < 9; k++) {
    const a = (k - 4) * 0.2;
    const f = buildFeather(0.4 + (k % 2) * 0.08, 'dark');
    f.position.set(Math.sin(a) * 0.1, 0.02, -0.1 - Math.cos(a) * 0.02);
    f.rotation.set(-0.45, a * 0.4, -a);
    crown.add(f);
  }
  const brow = buildBone(0.2, bone);
  brow.position.set(0, 0.01, 0.15);
  crown.add(brow);
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), k % 2 ? bone : blood);
      bead.position.set(sx * 0.15, -0.04 - k * 0.035, 0.02);
      crown.add(bead);
    }
  }
  return crown;
}

let stoneMaps: { map: THREE.Texture; normal: THREE.Texture } | null = null;
/** The Poly Haven rock scan used in the cave, shared for the stone giant's skin. */
function stoneSkin(): { map: THREE.Texture; normal: THREE.Texture } {
  if (!stoneMaps) {
    const L = new THREE.TextureLoader();
    const map = L.load('assets/textures/rock_face_diff_512.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(3, 3);
    const normal = L.load('assets/textures/rock_face_nor_gl_512.jpg');
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(3, 3);
    stoneMaps = { map, normal };
  }
  return stoneMaps;
}

/** The Lord of the Depths' gear: violet crystal pauldrons and a stone maul studded with crystals. */
function deepLordProps(): { pauldronL: THREE.Object3D; pauldronR: THREE.Object3D; maul: THREE.Object3D } {
  const stone = new THREE.MeshStandardMaterial({ color: 0x55525a, roughness: 0.95, flatShading: true });
  const crystal = new THREE.MeshStandardMaterial({ color: 0xc89cff, emissive: 0x8a3cff, emissiveIntensity: 1.6, roughness: 0.2, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3e2c1e, roughness: 0.9 });
  const pauldron = (side: number) => {
    const g = new THREE.Group();
    g.scale.setScalar(1.7);
    const plate = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), stone);
    plate.scale.set(1.2, 0.75, 1.1);
    g.add(plate);
    for (let k = 0; k < 5; k++) {
      const h = 0.35 + (k % 3) * 0.18;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.09 + (k % 2) * 0.04, h, 5), crystal);
      const a = (k / 5) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.22, 0.25 + h * 0.4, Math.sin(a) * 0.2);
      c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5 - side * 0.3);
      g.add(c);
    }
    return g;
  };
  const maul = new THREE.Group();
  // The arm bone points down: the haft runs on down from the fist to a heavy head near the ground.
  maul.rotation.x = 0.5;
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.0, 7), wood);
  haft.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 1.15), stone);
  head.position.y = 1.55;
  maul.add(haft, head);
  for (let k = 0; k < 6; k++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 5), crystal);
    c.position.set((k % 2 ? 1 : -1) * 0.33, 1.55 + ((k % 3) - 1) * 0.22, ((k % 3) - 1) * 0.36);
    c.rotation.z = (k % 2 ? -1 : 1) * Math.PI / 2;
    maul.add(c);
  }
  for (const o of [maul]) o.traverse((m) => ((m as THREE.Mesh).isMesh ? ((m as THREE.Mesh).castShadow = true) : null));
  return { pauldronL: pauldron(-1), pauldronR: pauldron(1), maul };
}

function tribalProps(role: Role): { mask: THREE.Object3D; weapon: THREE.Object3D; skirt: THREE.Object3D; crown: THREE.Object3D | null } {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5d3f26, roughness: 0.9 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });
  const mask = new THREE.Group();
  if (role === 'boss') mask.add(chiefMask());
  else mask.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.115, 0.28, 12, 1, true, -Math.PI * 0.42, Math.PI * 0.84), new THREE.MeshStandardMaterial({ map: maskPaint(), roughness: 0.7, side: THREE.DoubleSide })));

  const weapon = new THREE.Group();
  if (role === 'stalker') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 6), wood);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), bone);
    tip.position.y = 1.0;
    weapon.add(shaft, tip);
  } else {
    const big = role === 'boss' ? 1.5 : 1;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * big, 0.04 * big, 0.7 * big, 6), wood);
    handle.position.y = 0.3 * big;
    const knob = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11 * big, 0), wood);
    knob.position.y = 0.68 * big;
    weapon.add(handle, knob);
    for (let k = 0; k < 5; k++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02 * big, 0.1 * big, 4), bone);
      const a = (k / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.1 * big, 0.68 * big, Math.sin(a) * 0.1 * big);
      spike.rotation.set(-Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4);
      weapon.add(spike);
    }
  }
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.32, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x5b4a2a, roughness: 1, side: THREE.DoubleSide }));
  let crown: THREE.Object3D | null = null;
  if (role === 'boss') crown = chiefCrown();
  return { mask, weapon, skirt, crown };
}

export interface TribeEvents {
  onHitPlayer(damage: number, from: Cannibal): void;
  onDeath(c: Cannibal): void;
  onSpotted(c: Cannibal): void;
  onRoar(c: Cannibal): void;
  /** First time this enemy turns to hunt the player. */
  onAlert(c: Cannibal): void;
  /** Damage from burning, after a tick. */
  onBurn(c: Cannibal, killed: boolean): void;
}

export interface Lairs {
  village: { center: THREE.Vector3; radius: number };
  cave: THREE.Vector3;
  altar: THREE.Vector3;
  /** Guard posts inside the cave. */
  caveInside?: { skeletons: THREE.Vector3[]; guards: THREE.Vector3[]; lord: THREE.Vector3 };
}

/** The cave's floor and walls, for the enemies that live inside it. */
export interface CaveSpace {
  clamp(p: THREE.Vector3): void;
  blockedAt(x: number, z: number, r: number): boolean;
}

/** Every hostile: village tribe and chief, the cave guardian, the alpha beast, and the night parties. */
export class Tribe {
  readonly list: Cannibal[] = [];
  readonly group = new THREE.Group();
  /** Bosses already beaten (persisted in the save). */
  readonly defeated = new Set<BossRole>();
  kills = 0;
  /** Extra footprints the AI treats as solid (village huts), on top of the colliders. */
  blockers: { x: number; z: number; r: number }[] = [];
  /** Walls of the cave, for its skeletons (set by the game). */
  caveSpace: CaveSpace | null = null;
  private spawnedNight = -1;
  private tmp = new THREE.Vector3();

  constructor(private terrain: Terrain, private colliders: ColliderGrid, private lib: AssetLibrary, private lairs: Lairs, private events: TribeEvents, defeated: BossRole[] = []) {
    for (const d of defeated) this.defeated.add(d);
    const c = lairs.village.center;
    if (!this.defeated.has('boss')) this.spawn('boss', new THREE.Vector3(c.x + 3, 0, c.z - 3), false);
    this.spawn('guard', new THREE.Vector3(c.x - 6, 0, c.z + 7), false);
    this.spawn('guard', new THREE.Vector3(c.x + 9, 0, c.z - 8), false);
    if (!this.defeated.has('guardian')) this.spawn('guardian', lairs.cave.clone(), false);
    if (!this.defeated.has('alpha')) this.spawn('alpha', lairs.altar.clone(), false);
    const ci = lairs.caveInside;
    if (ci) {
      for (const p of ci.skeletons) this.spawn('skeleton', p.clone(), false, true);
      for (const p of ci.guards) this.spawn('skelGuard', p.clone(), false, true);
      if (!this.defeated.has('deepLord')) this.spawn('deepLord', ci.lord.clone(), false, true);
    }
  }

  bossOf(role: BossRole): Cannibal | undefined {
    return this.list.find((c) => c.role === role);
  }

  get boss(): Cannibal | undefined {
    return this.bossOf('boss');
  }

  private spawn(role: Role, at: THREE.Vector3, night: boolean, cave = false): Cannibal {
    const cfg = ROLE[role];
    const root = new THREE.Group();
    const model = this.lib.instance(cfg.asset, { by: 'height', value: cfg.height });
    root.add(model);
    // Own materials per enemy so the hit flash only lights the one that was hit.
    const mats: THREE.MeshStandardMaterial[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const list = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        if (cfg.asset === 'enemyHuman') {
          c.color.setHex(0x6b4432);
          c.roughness = 0.75;
        } else if (cfg.asset === 'enemyWolf') {
          c.color.multiplyScalar(0.42);
          c.roughness = 0.9;
        } else if (cfg.asset === 'enemySpider') {
          // Near-black carapace with a dull red mark.
          c.color.multiplyScalar(0.55);
          c.roughness = 0.6;
        } else if (cfg.asset === 'enemyDeepLord') {
          // Living rock: the cave's scanned stone over its body, cold grey with a violet cast.
          const rock = stoneSkin();
          c.map = rock.map;
          c.normalMap = rock.normal;
          c.color.setHex(0x9c98a8);
          c.roughness = 0.95;
          c.metalness = 0;
        } else {
          c.color.lerp(new THREE.Color(role === 'deepLord' ? 0x4e4366 : 0x9fb1c4), role === 'deepLord' ? 0.55 : 0.35);
        }
        mats.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? list : list[0];
    });
    this.group.add(root);
    root.updateMatrixWorld(true);
    model.updateMatrixWorld(true);

    if (cfg.asset === 'enemyHuman') {
      const props = tribalProps(role);
      const s = cfg.height / 1.75;
      attach(model.getObjectByName('Head'), props.mask, s, [0, 0.1, 0.03]);
      attach(model.getObjectByName('RightHand'), props.weapon, s, [0, 0.06, 0]);
      attach(model.getObjectByName('Hips'), props.skirt, s, [0, -0.08, 0]);
      if (props.crown) attach(model.getObjectByName('Head'), props.crown, s, [0, 0.2, 0]);
    } else {
      // Glowing eyes on the head bone: cyan for the guardian, red for the alpha.
      const head = model.getObjectByName('Head');
      const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: cfg.asset === 'enemyWolf' ? 0xff2a10 : role === 'deepLord' ? 0xb45cff : 0x6fe0ff, emissiveIntensity: role === 'deepLord' ? 3.2 : 2.5 });
      const eyes = new THREE.Group();
      for (const x of [-0.07, 0.07]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow);
        e.position.set(x, 0, 0);
        eyes.add(e);
      }
      if (cfg.asset === 'enemySpider') {
        // A cluster of small red eyes on the front of the head.
        const red = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a10, emissiveIntensity: 3 });
        const spiderEyes = new THREE.Group();
        for (const [x, y, r] of [
          [-0.08, 0.05, 0.035],
          [0.08, 0.05, 0.035],
          [-0.15, 0.02, 0.022],
          [0.15, 0.02, 0.022],
          [-0.04, 0.1, 0.018],
          [0.04, 0.1, 0.018],
        ]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), red);
          e.position.set(x, y, 0);
          spiderEyes.add(e);
        }
        attach(head, spiderEyes, cfg.height / 1.95, [0, 0.12, 0.45]);
      } else if (cfg.asset === 'enemyDeepLord') {
        // Big violet eyes burning in the stone face.
        const lordEyes = new THREE.Group();
        for (const x of [-0.2, 0.2]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), glow);
          e.position.set(x, 0, 0);
          e.scale.set(1.3, 0.8, 0.6);
          lordEyes.add(e);
        }
        attach(head, lordEyes, cfg.height / 3.92, [0, 0.62, 0.62]);
        const lord = deepLordProps();
        attach(model.getObjectByName('ArmL'), lord.pauldronL, cfg.height / 3.92, [0, 0.1, 0]);
        attach(model.getObjectByName('ArmR'), lord.pauldronR, cfg.height / 3.92, [0, 0.1, 0]);
        attach(model.getObjectByName('ArmR_end') ?? model.getObjectByName('ArmR'), lord.maul, cfg.height / 3.92, [0, 0, 0]);
      } else {
        attach(head, eyes, cfg.height / (cfg.asset === 'enemyWolf' ? 1.6 : 1.8), cfg.asset === 'enemyWolf' ? [0, 0.12, 0.22] : [0, 0.14, 0.12]);
      }
    }

    const mixer = new THREE.AnimationMixer(model.children[0] ?? model);
    const clips = this.lib.raw(cfg.asset).animations;
    const actions: Partial<Record<ClipKey, THREE.AnimationAction>> = {};
    for (const key of Object.keys(cfg.clips) as ClipKey[]) {
      const clip = clips.find((cl) => cfg.clips[key].test(cl.name));
      if (!clip) continue;
      const act = mixer.clipAction(clip);
      if (key === 'death' || key === 'attack') {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      actions[key] = act;
    }
    at.y = cave ? 0 : this.terrain.height(at.x, at.z);
    const c: Cannibal = {
      role,
      cfg,
      root,
      model,
      mixer,
      actions,
      clip: null,
      mats,
      flashT: 0,
      pos: at.clone(),
      heading: Math.random() * Math.PI * 2,
      speed: 0,
      hp: cfg.hp,
      maxHp: cfg.hp,
      state: 'idle',
      attackT: 0,
      attackCd: 0,
      provoked: false,
      deadT: 0,
      dropped: false,
      home: at.clone(),
      night,
      leaving: false,
      circleDir: Math.random() < 0.5 ? 1 : -1,
      hpBar: null,
      hpCanvas: null,
      shownHp: -1,
      roarT: 0,
      burnT: 0,
      burnTick: 0,
      alerted: false,
      stuckT: 0,
      avoidOff: 0,
      avoidT: 0,
      lastX: at.x,
      lastZ: at.z,
      fallAng: -1,
      cave,
    };
    if (role === 'boss' || role === 'guardian' || role === 'alpha' || role === 'deepLord') {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 40;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.scale.set(1.8, 0.28, 1);
      sp.position.y = cfg.height + 0.5;
      sp.visible = false;
      root.add(sp);
      c.hpBar = sp;
      c.hpCanvas = cv;
    }
    mixer.setTime(Math.random() * 2);
    this.play(c, 'idle', 0);
    root.position.copy(c.pos);
    this.list.push(c);
    return c;
  }

  private play(c: Cannibal, key: ClipKey, fade = 0.25): void {
    if (c.clip === key) return;
    const next = c.actions[key] ?? (key === 'run' ? c.actions.walk : undefined);
    if (!next) return;
    const prev = c.clip ? c.actions[c.clip] : null;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    c.clip = key;
  }

  private drawHpBar(c: Cannibal): void {
    if (!c.hpCanvas || !c.hpBar || c.shownHp === c.hp) return;
    c.shownHp = c.hp;
    const g = c.hpCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 40);
    g.fillStyle = 'rgba(10,14,16,0.7)';
    g.fillRect(0, 16, 256, 20);
    g.fillStyle = '#d8403a';
    g.fillRect(3, 19, 250 * clamp(c.hp / c.maxHp, 0, 1), 14);
    g.fillStyle = '#ffffff';
    g.font = '600 14px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(c.cfg.name, 128, 12);
    (c.hpBar.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  private nightSpot(player: THREE.Vector3, zones: SafeZone[]): THREE.Vector3 | null {
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 45 + Math.random() * 35;
      const x = player.x + Math.cos(a) * d;
      const z = player.z + Math.sin(a) * d;
      if (this.terrain.coastDistance(x, z) < 6) continue;
      const h = this.terrain.height(x, z);
      if (h < this.terrain.waterLevelAt(x, z) + 0.3 || this.terrain.slope(x, z) > 0.4) continue;
      if (zones.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + 4)) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  private spawnNightParty(day: number, player: THREE.Vector3, zones: SafeZone[]): void {
    const plan: Role[] = day <= 1 ? ['scout'] : day === 2 ? (Math.random() < 0.5 ? ['stalker'] : ['stalker', 'stalker']) : Math.random() < 0.5 ? ['raider', 'raider'] : ['raider', 'raider', 'raider'];
    const base = this.nightSpot(player, zones);
    if (!base) return;
    plan.forEach((role, i) => {
      const at = base.clone().add(this.tmp.set((i - 1) * 2.5, 0, (i % 2) * 2));
      this.spawn(role, at, true);
    });
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate = 0): { t: number; index: number } | null {
    let best = maxDist;
    let idx = -1;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (c.state === 'dead') continue;
      const h = c.cfg.height;
      const quad = c.cfg.asset === 'enemyWolf';
      // Spheres along the body: upright figures stack them, the beast lays them along its length.
      const spheres: [number, number, number][] = quad
        ? [
            [0.55, h * 0.45, c.cfg.radius * 0.9],
            [0, h * 0.5, c.cfg.radius],
            [-0.55, h * 0.45, c.cfg.radius * 0.9],
          ]
        : [
            [0, h * 0.3, c.cfg.radius * 0.8],
            [0, h * 0.62, c.cfg.radius],
            [0, h * 0.9, c.cfg.radius * 0.65],
          ];
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      for (const [fwd, hy, r] of spheres) {
        const rr = r + inflate;
        const ox = o.x - (c.pos.x + fx * fwd * h);
        const oy = o.y - (c.pos.y + hy);
        const oz = o.z - (c.pos.z + fz * fwd * h);
        const b = ox * d.x + oy * d.y + oz * d.z;
        const cc = ox * ox + oy * oy + oz * oz - rr * rr;
        const disc = b * b - cc;
        if (disc < 0) continue;
        let t = -b - Math.sqrt(disc);
        if (t < 0) t = cc < 0 ? 0 : -1;
        if (t >= 0 && t < best) {
          best = t;
          idx = i;
        }
      }
    }
    return idx >= 0 ? { t: best, index: idx } : null;
  }

  damage(i: number, amount: number): boolean {
    const c = this.list[i];
    if (c.state === 'dead') return false;
    c.hp -= amount;
    c.provoked = true;
    c.flashT = 0.16;
    if (c.role === 'guard' || c.role === 'boss') for (const o of this.list) if (o.role === 'guard' || o.role === 'boss') o.provoked = true;
    if (c.hp <= 0) {
      c.state = 'dead';
      c.deadT = 0;
      c.speed = 0;
      this.kills++;
      if (c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha' || c.role === 'deepLord') this.defeated.add(c.role);
      if (c.hpBar) c.hpBar.visible = false;
      this.die(c);
      return true;
    }
    return false;
  }

  /**
   * Death: every other clip fades out (nothing keeps running under the fall) and the
   * death clip plays once from the start at full weight, holding its last pose.
   */
  private die(c: Cannibal): void {
    for (const key of Object.keys(c.actions) as ClipKey[]) {
      const a = c.actions[key];
      if (!a || key === 'death') continue;
      a.fadeOut(0.12);
    }
    const d = c.actions.death;
    if (d) {
      d.reset();
      d.setLoop(THREE.LoopOnce, 1);
      d.clampWhenFinished = true;
      d.setEffectiveTimeScale(1);
      d.setEffectiveWeight(1);
      d.play();
      c.clip = 'death';
      c.fallAng = -1;
    } else {
      c.clip = null;
      c.fallAng = 0;
    }
  }

  /** Set it alight: burns for `seconds`, 8 damage per second, small flames on the body. */
  ignite(i: number, seconds: number): void {
    const c = this.list[i];
    if (!c || c.state === 'dead') return;
    c.burnT = Math.max(c.burnT, seconds);
  }

  /** Any collider in the way along `heading`, out to `range` metres (probes at three points). */
  private blocked(c: Cannibal, heading: number, range: number): boolean {
    const sx = Math.sin(heading);
    const sz = Math.cos(heading);
    const rad = c.cfg.radius * 0.9;
    let hit = false;
    for (const d of [Math.min(0.7, range), Math.min(1.45, range), range]) {
      const px = c.pos.x + sx * d;
      const pz = c.pos.z + sz * d;
      if (c.cave) {
        if (this.caveSpace?.blockedAt(px, pz, rad)) return true;
        continue;
      }
      this.colliders.query(px, pz, 2.5, (col) => {
        if (!hit && Math.hypot(col.x - px, col.z - pz) < col.r + rad) hit = true;
      });
      for (const b of this.blockers) if (Math.hypot(b.x - px, b.z - pz) < b.r + rad) hit = true;
      if (hit) return true;
    }
    return false;
  }

  /**
   * Obstacle avoidance: keep the wanted heading when the way is clear; otherwise try
   * side-steps of 40, 75 and 110 degrees, its own circling side first (so it does not
   * dither), and hold the chosen detour briefly to get round the corner.
   */
  private steer(c: Cannibal, want: number, dist: number, dt: number): number {
    const range = Math.max(0.6, Math.min(2.2, dist - c.cfg.reach * 0.5));
    c.avoidT -= dt;
    const stuck = c.stuckT > 0.35;
    if (c.avoidT > 0 && c.avoidOff !== 0 && !stuck && !this.blocked(c, want + c.avoidOff, range)) {
      // Back on the direct line as soon as it is clear and the corner is passed.
      if (c.avoidT < 0.25 && !this.blocked(c, want, range)) c.avoidOff = 0;
      return want + c.avoidOff;
    }
    if (!stuck && !this.blocked(c, want, range)) {
      c.avoidOff = 0;
      return want;
    }
    for (const deg of [40, 75, 110]) {
      for (const side of [c.circleDir, -c.circleDir]) {
        const off = side * (deg * Math.PI) / 180;
        if (!this.blocked(c, want + off, range)) {
          c.avoidOff = off;
          c.avoidT = 0.7;
          c.circleDir = side;
          if (stuck) c.stuckT = 0;
          return want + off;
        }
      }
    }
    // Boxed in: back away to the other side and try again.
    if (stuck) {
      c.circleDir = -c.circleDir;
      c.stuckT = 0;
    }
    c.avoidOff = c.circleDir * 2.2;
    c.avoidT = 0.5;
    return want + c.avoidOff;
  }

  private zoneAt(x: number, z: number, zones: SafeZone[]): SafeZone | null {
    for (const s of zones) if (Math.hypot(x - s.x, z - s.z) < s.r) return s;
    return null;
  }

  update(dt: number, ctx: { player: THREE.Vector3; alive: boolean; night: boolean; day: number; zones: SafeZone[]; indoors: boolean }): void {
    const { player, zones } = ctx;
    if (ctx.night && this.spawnedNight !== ctx.day && !ctx.indoors) {
      this.spawnedNight = ctx.day;
      this.spawnNightParty(ctx.day, player, zones);
    }
    const playerSafe = this.zoneAt(player.x, player.z, zones) || ctx.indoors;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const cfg = c.cfg;
      const dx = player.x - c.pos.x;
      const dz = player.z - c.pos.z;
      const away = c.cave ? !ctx.indoors : ctx.indoors;
      const safe = c.cave ? false : playerSafe;
      const dist = away ? 1e4 : Math.hypot(dx, dz);
      const toPlayer = Math.atan2(dx, dz);

      if (c.flashT > 0) {
        c.flashT -= dt;
        const k = Math.max(0, c.flashT / 0.16);
        for (const m of c.mats) {
          m.emissive.setRGB(0.9 * k, 0.15 * k, 0.1 * k);
        }
      }

      if (c.state === 'dead') {
        c.deadT += dt;
        // Once the fades are done, nothing but the death clip may still be running.
        if (c.deadT > 0.2) {
          for (const key of Object.keys(c.actions) as ClipKey[]) {
            const a = c.actions[key];
            if (a && key !== 'death' && a.isRunning()) a.stop();
          }
        }
        c.mixer.update(dt);
        if (c.fallAng >= 0) {
          // No usable death clip: topple over backwards onto the ground.
          c.fallAng = Math.min(Math.PI / 2, c.fallAng + dt * (1.5 + c.fallAng * 4));
          c.model.rotation.x = -c.fallAng;
        }
        if (c.deadT > 1.0 && !c.dropped) {
          c.dropped = true;
          this.events.onDeath(c);
        }
        // The body lies there for a few seconds, then sinks into the ground, wherever the player is.
        if (c.deadT > 6) c.root.position.y = c.pos.y - (c.deadT - 6) * 0.55;
        if (c.deadT > 7.6) {
          this.group.remove(c.root);
          this.list.splice(i, 1);
        }
        continue;
      }

      if (c.night && !ctx.night) c.leaving = true;
      if (c.leaving && dist > 55) {
        this.group.remove(c.root);
        this.list.splice(i, 1);
        continue;
      }

      if (c.burnT > 0) {
        c.burnT -= dt;
        c.burnTick += dt;
        if (c.burnTick >= 0.5) {
          c.burnTick = 0;
          const killed = this.damage(i, 4);
          this.events.onBurn(c, killed);
          if (killed) continue;
        }
      }

      let targetHeading = c.heading;
      let targetSpeed = 0;
      let wantAttack = false;

      if (c.leaving || !ctx.alive || away) {
        if (c.night) {
          targetHeading = toPlayer + Math.PI;
          targetSpeed = c.leaving ? cfg.run : cfg.walk;
        } else {
          const back = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);
          if (back > 3) {
            targetHeading = Math.atan2(c.home.x - c.pos.x, c.home.z - c.pos.z);
            targetSpeed = cfg.walk;
          }
          c.provoked = false;
        }
      } else {
        switch (c.role) {
          case 'scout':
            if (dist <= 18) {
              targetHeading = toPlayer + Math.PI;
              targetSpeed = cfg.run;
            } else if (dist < 30) {
              targetHeading = toPlayer + Math.PI;
              targetSpeed = cfg.walk;
            } else if (dist > 45) {
              targetHeading = toPlayer;
              targetSpeed = cfg.walk;
            } else {
              targetHeading = toPlayer;
              if (Math.random() < dt * 0.3) this.events.onSpotted(c);
            }
            break;
          case 'stalker':
            if (c.provoked) {
              targetHeading = toPlayer;
              targetSpeed = dist > cfg.reach ? cfg.run : 0;
              wantAttack = dist <= cfg.reach;
            } else {
              const ring = 22;
              if (dist > ring + 8) {
                targetHeading = toPlayer + c.circleDir * 0.35;
                targetSpeed = cfg.walk * 1.6;
              } else {
                targetHeading = toPlayer + c.circleDir * (Math.PI / 2) + (dist > ring ? -0.4 : 0.4) * c.circleDir;
                targetSpeed = cfg.walk * 1.2;
              }
            }
            break;
          case 'raider':
            targetHeading = toPlayer;
            targetSpeed = dist > cfg.reach ? (dist < 40 ? cfg.run : cfg.walk * 1.5) : 0;
            wantAttack = dist <= cfg.reach;
            break;
          default: {
            // Village guards, the chief, the cave guardian and the alpha defend their lair.
            const fromHome = Math.hypot(player.x - c.home.x, player.z - c.home.z);
            const aggro = c.provoked || fromHome < cfg.aggro;
            const leash = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);
            if (aggro && leash < cfg.leash) {
              if (c.roarT <= 0 && (c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha' || c.role === 'deepLord')) {
                c.roarT = 9;
                this.events.onRoar(c);
              }
              targetHeading = toPlayer;
              targetSpeed = dist > cfg.reach ? cfg.run : 0;
              wantAttack = dist <= cfg.reach;
            } else if (leash > 3) {
              targetHeading = Math.atan2(c.home.x - c.pos.x, c.home.z - c.pos.z);
              targetSpeed = cfg.walk;
              if (leash > cfg.leash) c.provoked = false;
            }
            break;
          }
        }
      }
      c.roarT -= dt;
      // First time it turns on the player: a tense sting (scouts only watch, they never hunt).
      const hunting = !c.leaving && ctx.alive && !away && c.role !== 'scout' && targetSpeed > 0 && Math.abs(wrapAngle(targetHeading - toPlayer)) < 0.6 && dist < 45 && (c.role !== 'stalker' || c.provoked);
      if (hunting && !c.alerted) {
        c.alerted = true;
        this.events.onAlert(c);
      }

      // Fear of fire and respect for the player's shelters.
      const here = this.zoneAt(c.pos.x, c.pos.z, zones);
      if (here) {
        targetHeading = Math.atan2(c.pos.x - here.x, c.pos.z - here.z);
        targetSpeed = cfg.run;
        wantAttack = false;
      } else if (targetSpeed > 0) {
        const ahead = this.zoneAt(c.pos.x + Math.sin(targetHeading) * 2.5, c.pos.z + Math.cos(targetHeading) * 2.5, zones);
        if (ahead) {
          targetHeading = Math.atan2(c.pos.x - ahead.x, c.pos.z - ahead.z) + c.circleDir * Math.PI * 0.5;
          targetSpeed = cfg.walk * 0.6;
          wantAttack = false;
        }
      }
      if (safe) wantAttack = false;

      const lx = c.pos.x + Math.sin(targetHeading) * 2;
      const lz = c.pos.z + Math.cos(targetHeading) * 2;
      if (!c.cave && this.terrain.height(lx, lz) < this.terrain.waterLevelAt(lx, lz) + 0.2) targetHeading += c.circleDir * 1.3;
      // Walk round tents, trees, rocks and fires instead of running into them.
      if (targetSpeed > 0.1 && c.state !== 'attack') targetHeading = this.steer(c, targetHeading, dist, dt);

      // Attack: the clip's wind-up is the telegraph; the blow lands at `windup`.
      c.attackCd -= dt;
      if (c.state === 'attack') {
        c.attackT += dt;
        targetSpeed = 0;
        targetHeading = toPlayer;
        if (c.attackT >= cfg.windup && c.attackT - dt < cfg.windup && dist <= cfg.reach + 0.5 && !safe && ctx.alive) this.events.onHitPlayer(cfg.damage, c);
        if (c.attackT >= cfg.attackTime) {
          c.state = 'move';
          c.attackCd = c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha' || c.role === 'deepLord' ? 1.2 : 1.0;
        }
      } else if (wantAttack && c.attackCd <= 0 && cfg.damage > 0) {
        c.state = 'attack';
        c.attackT = 0;
        const act = c.actions.attack;
        if (act) {
          c.clip = null;
          this.play(c, 'attack', 0.12);
          act.timeScale = act.getClip().duration / cfg.attackTime;
        }
      } else {
        c.state = targetSpeed > 0.1 ? 'move' : 'idle';
      }

      c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 4);
      const diff = wrapAngle(targetHeading - c.heading);
      c.heading = wrapAngle(c.heading + clamp(diff, -3.2 * dt, 3.2 * dt));
      c.pos.x += Math.sin(c.heading) * c.speed * dt;
      c.pos.z += Math.cos(c.heading) * c.speed * dt;
      if (c.cave) {
        // Inside: the cave walls, chasm edge and props hold it, on a flat floor.
        if (this.caveSpace) {
          if (this.caveSpace.blockedAt(c.pos.x, c.pos.z, 0)) {
            c.pos.x = c.lastX;
            c.pos.z = c.lastZ;
          }
          this.caveSpace.clamp(c.pos);
        }
      } else this.colliders.query(c.pos.x, c.pos.z, 4, (col) => {
        const ox = c.pos.x - col.x;
        const oz = c.pos.z - col.z;
        const d = Math.hypot(ox, oz);
        const min = col.r + cfg.radius;
        if (d < min && d > 1e-4) {
          c.pos.x += (ox / d) * (min - d);
          c.pos.z += (oz / d) * (min - d);
        }
      });
      if (!c.cave) for (const b of this.blockers) {
        const ox = c.pos.x - b.x;
        const oz = c.pos.z - b.z;
        const d = Math.hypot(ox, oz);
        const min = b.r + cfg.radius;
        if (d < min && d > 1e-4) {
          c.pos.x += (ox / d) * (min - d);
          c.pos.z += (oz / d) * (min - d);
        }
      }
      c.pos.y = c.cave ? 0 : this.terrain.height(c.pos.x, c.pos.z);
      // Pinned: it moved far less than its speed says it should have.
      const expected = c.speed * dt;
      const moved = Math.hypot(c.pos.x - c.lastX, c.pos.z - c.lastZ);
      if (expected > 0.015 && moved < expected * 0.35) c.stuckT += dt;
      else c.stuckT = Math.max(0, c.stuckT - dt * 2);
      c.lastX = c.pos.x;
      c.lastZ = c.pos.z;

      // Locomotion clip by speed, played at the rate the ground moves (no sliding feet).
      if (c.state !== 'attack') {
        const key: ClipKey = c.speed > cfg.walk * 1.35 ? 'run' : c.speed > 0.25 ? 'walk' : 'idle';
        this.play(c, key);
        const act = c.actions[key] ?? c.actions.walk;
        if (act && key !== 'idle') act.timeScale = clamp(c.speed / (key === 'run' ? cfg.run * 0.8 : cfg.walk), 0.5, 1.8);
      }
      const visible = dist < 140;
      c.root.visible = visible;
      if (visible && dist < 100) c.mixer.update(dt);
      c.root.position.copy(c.pos);
      c.root.rotation.y = c.heading;

      if (c.hpBar) {
        c.hpBar.visible = (c.provoked || dist < 22) && dist < 40;
        if (c.hpBar.visible) this.drawHpBar(c);
      }
    }
  }
}
