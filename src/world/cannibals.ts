import * as THREE from 'three';
import { AssetLibrary, AssetName } from '../assets/assets';
import { clamp, wrapAngle } from '../core/math';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';

/**
 * scout: Day 1 night watcher that keeps 30-45 m away and runs if approached.
 * stalker: Day 2 night prowler that circles and fights only when provoked.
 * raider: Day 3+ night patrol that hunts the player.
 * guard / boss: the village and its Tribal Chief.
 * guardian: the giant skeleton at the north cave. alpha: the beast at the east altar.
 */
export type Role = 'scout' | 'stalker' | 'raider' | 'guard' | 'boss' | 'guardian' | 'alpha';
export type BossRole = 'boss' | 'guardian' | 'alpha';

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
const WOLF_CLIPS: Record<ClipKey, RegExp> = { idle: /^(AnimalArmature\|)?Idle$/, walk: /^(AnimalArmature\|)?Walk$/, run: /^(AnimalArmature\|)?Gallop$/, attack: /^(AnimalArmature\|)?Attack$/, death: /^(AnimalArmature\|)?Death$/ };

// The player sprints at 10 m/s: every enemy is slower, so running away always works.
const ROLE: Record<Role, RoleCfg> = {
  scout: { asset: 'enemyHuman', height: 1.72, hp: 50, walk: 1.6, run: 5.5, damage: 0, reach: 0, radius: 0.35, windup: 0.5, attackTime: 1, aggro: 0, leash: 0, name: 'Batedor', clips: HUMAN_CLIPS },
  stalker: { asset: 'enemyHuman', height: 1.75, hp: 60, walk: 1.8, run: 5.2, damage: 12, reach: 2.0, radius: 0.35, windup: 0.5, attackTime: 1, aggro: 0, leash: 0, name: 'Espreitador', clips: HUMAN_CLIPS },
  raider: { asset: 'enemyHuman', height: 1.78, hp: 65, walk: 2.0, run: 5.0, damage: 12, reach: 2.0, radius: 0.35, windup: 0.5, attackTime: 1, aggro: 0, leash: 0, name: 'Patrulha', clips: HUMAN_CLIPS },
  guard: { asset: 'enemyHuman', height: 1.85, hp: 80, walk: 1.6, run: 4.8, damage: 14, reach: 2.1, radius: 0.38, windup: 0.5, attackTime: 1, aggro: 22, leash: 40, name: 'Guarda', clips: HUMAN_CLIPS },
  boss: { asset: 'enemyHuman', height: 2.45, hp: 280, walk: 1.5, run: 4.2, damage: 24, reach: 2.8, radius: 0.5, windup: 0.7, attackTime: 1.3, aggro: 18, leash: 40, name: 'Chefe Tribal', clips: HUMAN_CLIPS },
  guardian: { asset: 'enemySkeleton', height: 3.6, hp: 450, walk: 1.4, run: 3.8, damage: 30, reach: 3.2, radius: 0.9, windup: 0.8, attackTime: 1.5, aggro: 22, leash: 36, name: 'Guardião da Caverna', clips: SKELETON_CLIPS },
  alpha: { asset: 'enemyWolf', height: 2.3, hp: 650, walk: 1.8, run: 6.5, damage: 34, reach: 3.0, radius: 0.9, windup: 0.6, attackTime: 1.2, aggro: 26, leash: 45, name: 'Fera Alfa', clips: WOLF_CLIPS },
};

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

function tribalProps(role: Role): { mask: THREE.Object3D; weapon: THREE.Object3D; skirt: THREE.Object3D; crown: THREE.Object3D | null } {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5d3f26, roughness: 0.9 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });
  const mask = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.115, 0.28, 12, 1, true, -Math.PI * 0.42, Math.PI * 0.84), new THREE.MeshStandardMaterial({ map: maskPaint(), roughness: 0.7, side: THREE.DoubleSide }));
  mask.add(face);

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
  if (role === 'boss') {
    crown = new THREE.Group();
    const colors = [0xb8322a, 0xe8c24a, 0xf2efe6, 0x1f6fb0];
    for (let k = 0; k < 11; k++) {
      const a = -Math.PI * 0.55 + (k / 10) * Math.PI * 1.1;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 4), new THREE.MeshStandardMaterial({ color: colors[k % 4], roughness: 0.8 }));
      f.position.set(Math.sin(a) * 0.15, 0.16 + Math.cos(a) * 0.08, -Math.cos(a) * 0.06 - 0.03);
      f.rotation.set(-0.35, 0, -a * 0.6);
      crown.add(f);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 4, 14), new THREE.MeshStandardMaterial({ color: 0x9e2a22 }));
    band.rotation.x = Math.PI / 2;
    crown.add(band);
  }
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
}

/** Every hostile: village tribe and chief, the cave guardian, the alpha beast, and the night parties. */
export class Tribe {
  readonly list: Cannibal[] = [];
  readonly group = new THREE.Group();
  /** Bosses already beaten (persisted in the save). */
  readonly defeated = new Set<BossRole>();
  kills = 0;
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
  }

  bossOf(role: BossRole): Cannibal | undefined {
    return this.list.find((c) => c.role === role);
  }

  get boss(): Cannibal | undefined {
    return this.bossOf('boss');
  }

  private spawn(role: Role, at: THREE.Vector3, night: boolean): Cannibal {
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
        } else {
          c.color.lerp(new THREE.Color(0x9fb1c4), 0.35);
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
      const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: cfg.asset === 'enemyWolf' ? 0xff2a10 : 0x6fe0ff, emissiveIntensity: 2.5 });
      const eyes = new THREE.Group();
      for (const x of [-0.07, 0.07]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow);
        e.position.set(x, 0, 0);
        eyes.add(e);
      }
      attach(head, eyes, cfg.height / (cfg.asset === 'enemyWolf' ? 1.6 : 1.8), cfg.asset === 'enemyWolf' ? [0, 0.12, 0.22] : [0, 0.14, 0.12]);
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
    at.y = this.terrain.height(at.x, at.z);
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
    };
    if (role === 'boss' || role === 'guardian' || role === 'alpha') {
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
      if (c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha') this.defeated.add(c.role);
      if (c.hpBar) c.hpBar.visible = false;
      this.play(c, 'death', 0.12);
      return true;
    }
    return false;
  }

  /** Set it alight: burns for `seconds`, 8 damage per second, small flames on the body. */
  ignite(i: number, seconds: number): void {
    const c = this.list[i];
    if (!c || c.state === 'dead') return;
    c.burnT = Math.max(c.burnT, seconds);
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
      const dist = ctx.indoors ? 1e4 : Math.hypot(dx, dz);
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
        c.mixer.update(dt);
        if (c.deadT > 1.0 && !c.dropped) {
          c.dropped = true;
          this.events.onDeath(c);
        }
        // Bodies stay while the player can see them; cleared later, out of sight.
        if (c.deadT > 25 && dist > 35) {
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

      if (c.leaving || !ctx.alive || ctx.indoors) {
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
              if (c.roarT <= 0 && (c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha')) {
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
      const hunting = !c.leaving && ctx.alive && !ctx.indoors && c.role !== 'scout' && targetSpeed > 0 && Math.abs(wrapAngle(targetHeading - toPlayer)) < 0.6 && dist < 45 && (c.role !== 'stalker' || c.provoked);
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
      if (playerSafe) wantAttack = false;

      const lx = c.pos.x + Math.sin(targetHeading) * 2;
      const lz = c.pos.z + Math.cos(targetHeading) * 2;
      if (this.terrain.height(lx, lz) < this.terrain.waterLevelAt(lx, lz) + 0.2) targetHeading += c.circleDir * 1.3;

      // Attack: the clip's wind-up is the telegraph; the blow lands at `windup`.
      c.attackCd -= dt;
      if (c.state === 'attack') {
        c.attackT += dt;
        targetSpeed = 0;
        targetHeading = toPlayer;
        if (c.attackT >= cfg.windup && c.attackT - dt < cfg.windup && dist <= cfg.reach + 0.5 && !playerSafe && ctx.alive) this.events.onHitPlayer(cfg.damage, c);
        if (c.attackT >= cfg.attackTime) {
          c.state = 'move';
          c.attackCd = c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha' ? 1.2 : 1.0;
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
      this.colliders.query(c.pos.x, c.pos.z, 4, (col) => {
        const ox = c.pos.x - col.x;
        const oz = c.pos.z - col.z;
        const d = Math.hypot(ox, oz);
        const min = col.r + cfg.radius;
        if (d < min && d > 1e-4) {
          c.pos.x += (ox / d) * (min - d);
          c.pos.z += (oz / d) * (min - d);
        }
      });
      c.pos.y = this.terrain.height(c.pos.x, c.pos.z);

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
