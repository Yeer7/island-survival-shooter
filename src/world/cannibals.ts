import * as THREE from 'three';
import { clamp, wrapAngle } from '../core/math';
import { ColliderGrid } from './colliders';
import { Terrain } from './terrain';

/**
 * scout: Day 1 night watcher that keeps 30-45 m away and runs if approached.
 * stalker: Day 2 night prowler that circles and fights only when provoked.
 * raider: Day 3+ night patrol that hunts the player.
 * guard / boss: live in the village; defend it day and night.
 */
export type Role = 'scout' | 'stalker' | 'raider' | 'guard' | 'boss';

export interface SafeZone {
  x: number;
  z: number;
  r: number;
}

interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  thighL: THREE.Group;
  thighR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
}

export interface Cannibal {
  role: Role;
  rig: Rig;
  scale: number;
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  state: 'idle' | 'move' | 'attack' | 'dead';
  attackT: number;
  attackCd: number;
  provoked: boolean;
  phase: number;
  deadT: number;
  dropped: boolean;
  home: THREE.Vector3;
  night: boolean;
  leaving: boolean;
  circleDir: number;
  hpBar: THREE.Sprite | null;
  hpCanvas: HTMLCanvasElement | null;
  shownHp: number;
}

const ROLE = {
  scout: { hp: 50, walk: 1.6, run: 5.5, damage: 0, reach: 0 },
  stalker: { hp: 60, walk: 1.8, run: 5.2, damage: 12, reach: 2.0 },
  raider: { hp: 65, walk: 2.0, run: 5.0, damage: 12, reach: 2.0 },
  guard: { hp: 80, walk: 1.6, run: 4.8, damage: 14, reach: 2.1 },
  boss: { hp: 280, walk: 1.5, run: 4.2, damage: 24, reach: 2.8 },
} as const;

let paintTex: THREE.CanvasTexture | null = null;
let maskTex: THREE.CanvasTexture | null = null;

/** Dark skin with pale clay stripes. */
function bodyPaint(): THREE.CanvasTexture {
  if (paintTex) return paintTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a2e22';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(226,214,196,0.85)';
  g.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, 20 + i * 28);
    g.lineTo(32, 30 + i * 28);
    g.lineTo(64, 20 + i * 28);
    g.lineTo(96, 30 + i * 28);
    g.lineTo(128, 20 + i * 28);
    g.stroke();
  }
  paintTex = new THREE.CanvasTexture(c);
  paintTex.colorSpace = THREE.SRGBColorSpace;
  return paintTex;
}

/** Carved wooden mask: hollow slit eyes, jagged painted teeth, red bars. Not friendly. */
function maskPaint(): THREE.CanvasTexture {
  if (maskTex) return maskTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a1a10';
  g.fillRect(0, 0, 128, 128);
  // Bone-white face plate on the front quarter of the UVs.
  g.fillStyle = '#d9cdb4';
  g.fillRect(40, 18, 48, 92);
  g.fillStyle = '#120804';
  // Angled slit eyes.
  g.beginPath();
  g.moveTo(44, 44);
  g.lineTo(62, 52);
  g.lineTo(44, 56);
  g.fill();
  g.beginPath();
  g.moveTo(84, 44);
  g.lineTo(66, 52);
  g.lineTo(84, 56);
  g.fill();
  // Teeth.
  g.fillRect(48, 80, 32, 14);
  g.fillStyle = '#d9cdb4';
  for (let x = 48; x < 80; x += 6) {
    g.beginPath();
    g.moveTo(x, 80);
    g.lineTo(x + 3, 89);
    g.lineTo(x + 6, 80);
    g.fill();
  }
  // Red war bars.
  g.fillStyle = '#9e2a22';
  g.fillRect(40, 26, 48, 5);
  g.fillRect(62, 56, 4, 20);
  maskTex = new THREE.CanvasTexture(c);
  maskTex.colorSpace = THREE.SRGBColorSpace;
  return maskTex;
}

function limb(len: number, r0: number, r1: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, len, 7);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Articulated tribal warrior built from parts, origin at the feet, facing +Z. */
export function buildCannibal(role: Role): { rig: Rig; scale: number } {
  const skin = new THREE.MeshStandardMaterial({ map: bodyPaint(), roughness: 0.8 });
  const skinPlain = new THREE.MeshStandardMaterial({ color: 0x4a2e22, roughness: 0.8 });
  const mask = new THREE.MeshStandardMaterial({ map: maskPaint(), roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x5b4a2a, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5d3f26, roughness: 0.9 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.6 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  body.add(hips);

  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.18, 8), skinPlain);
  pelvis.castShadow = true;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.32, 10, 1, true), cloth);
  skirt.position.y = -0.16;
  skirt.material.side = THREE.DoubleSide;
  hips.add(pelvis, skirt);

  const torso = new THREE.Group();
  torso.position.y = 0.08;
  hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.52, 10), skin);
  chest.position.y = 0.28;
  chest.scale.z = 0.7;
  chest.castShadow = true;
  const necklace = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 4, 12), bone);
  necklace.rotation.x = Math.PI / 2 - 0.3;
  necklace.position.set(0, 0.5, 0.03);
  torso.add(chest, necklace);

  const head = new THREE.Group();
  head.position.y = 0.6;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinPlain);
  skull.position.y = 0.12;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.3, 12, 1), mask);
  face.position.set(0, 0.12, 0.03);
  face.rotation.y = Math.PI;
  face.castShadow = true;
  const hair = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x120a06 }));
  hair.position.y = 0.3;
  head.add(skull, face, hair);
  if (role === 'boss') {
    // Feathered headdress.
    const colors = [0xb8322a, 0xe8c24a, 0xf2efe6, 0x1f6fb0];
    for (let k = 0; k < 11; k++) {
      const a = -Math.PI * 0.55 + (k / 10) * Math.PI * 1.1;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 4), new THREE.MeshStandardMaterial({ color: colors[k % 4], roughness: 0.8 }));
      f.position.set(Math.sin(a) * 0.15, 0.36 + Math.cos(a) * 0.08, -Math.cos(a) * 0.06 - 0.03);
      f.rotation.set(-0.35, 0, -a * 0.6);
      head.add(f);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 4, 14), new THREE.MeshStandardMaterial({ color: 0x9e2a22 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.22;
    head.add(band);
  }

  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.27, 0.48, 0);
    arm.add(limb(0.32, 0.06, 0.055, skin));
    const fore = new THREE.Group();
    fore.position.y = -0.32;
    fore.add(limb(0.3, 0.05, 0.04, skinPlain));
    arm.add(fore);
    torso.add(arm);
    return { arm, fore };
  };
  const L = mkArm(-1);
  const R = mkArm(1);

  // Weapon in the right hand: a knobbed club (boss: bigger, spiked) or a spear.
  const hand = new THREE.Group();
  hand.position.y = -0.3;
  R.fore.add(hand);
  if (role === 'stalker') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 6), wood);
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), bone);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1.0;
    hand.add(shaft, tip);
  } else {
    const big = role === 'boss' ? 1.5 : 1;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * big, 0.04 * big, 0.7 * big, 6), wood);
    handle.position.y = -0.3 * big;
    const knob = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11 * big, 0), wood);
    knob.position.y = -0.68 * big;
    hand.add(handle, knob);
    for (let k = 0; k < 5; k++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02 * big, 0.1 * big, 4), bone);
      const a = (k / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.1 * big, -0.68 * big, Math.sin(a) * 0.1 * big);
      spike.rotation.set(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4);
      hand.add(spike);
    }
  }

  const mkLeg = (side: number) => {
    const thigh = new THREE.Group();
    thigh.position.set(side * 0.1, -0.05, 0);
    thigh.add(limb(0.45, 0.08, 0.065, skinPlain));
    const shin = new THREE.Group();
    shin.position.y = -0.45;
    shin.add(limb(0.45, 0.06, 0.045, skin));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.2), skinPlain);
    foot.position.set(0, -0.46, 0.05);
    shin.add(foot);
    thigh.add(shin);
    hips.add(thigh);
    return { thigh, shin };
  };
  const LL = mkLeg(-1);
  const RL = mkLeg(1);

  const scale = role === 'boss' ? 1.4 : role === 'guard' ? 1.08 : 1;
  root.scale.setScalar(scale);
  return {
    rig: { root, body, hips, torso, head, thighL: LL.thigh, thighR: RL.thigh, shinL: LL.shin, shinR: RL.shin, armL: L.arm, armR: R.arm, foreL: L.fore, foreR: R.fore },
    scale,
  };
}

export interface TribeEvents {
  /** A blow landed on the player. */
  onHitPlayer(damage: number, from: Cannibal): void;
  onDeath(c: Cannibal): void;
  onSpotted(c: Cannibal): void;
}

/** All cannibals: village guards and chief, plus the night parties that grow each day. */
export class Tribe {
  readonly list: Cannibal[] = [];
  readonly group = new THREE.Group();
  private spawnedNight = -1;
  private tmp = new THREE.Vector3();
  private sinceSpawn = 0;

  constructor(private terrain: Terrain, private colliders: ColliderGrid, private village: { center: THREE.Vector3; radius: number }, private events: TribeEvents) {
    const c = village.center;
    this.spawn('boss', new THREE.Vector3(c.x + 3, 0, c.z - 3), false);
    this.spawn('guard', new THREE.Vector3(c.x - 6, 0, c.z + 7), false);
    this.spawn('guard', new THREE.Vector3(c.x + 9, 0, c.z - 8), false);
  }

  get boss(): Cannibal | undefined {
    return this.list.find((c) => c.role === 'boss');
  }

  private spawn(role: Role, at: THREE.Vector3, night: boolean): Cannibal {
    const { rig, scale } = buildCannibal(role);
    at.y = this.terrain.height(at.x, at.z);
    const c: Cannibal = {
      role,
      rig,
      scale,
      pos: at.clone(),
      heading: Math.random() * Math.PI * 2,
      speed: 0,
      hp: ROLE[role].hp,
      maxHp: ROLE[role].hp,
      state: 'idle',
      attackT: 0,
      attackCd: 0,
      provoked: false,
      phase: Math.random() * 6,
      deadT: 0,
      dropped: false,
      home: at.clone(),
      night,
      leaving: false,
      circleDir: Math.random() < 0.5 ? 1 : -1,
      hpBar: null,
      hpCanvas: null,
      shownHp: -1,
    };
    if (role === 'boss') {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = 16;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
      sp.scale.set(1.1, 0.14, 1);
      sp.position.y = 2.35;
      sp.visible = false;
      rig.root.add(sp);
      c.hpBar = sp;
      c.hpCanvas = cv;
    }
    rig.root.position.copy(c.pos);
    this.group.add(rig.root);
    this.list.push(c);
    return c;
  }

  private drawHpBar(c: Cannibal): void {
    if (!c.hpCanvas || !c.hpBar || c.shownHp === c.hp) return;
    c.shownHp = c.hp;
    const g = c.hpCanvas.getContext('2d')!;
    g.clearRect(0, 0, 128, 16);
    g.fillStyle = 'rgba(10,14,16,0.75)';
    g.fillRect(0, 0, 128, 16);
    g.fillStyle = '#d8403a';
    g.fillRect(2, 2, 124 * clamp(c.hp / c.maxHp, 0, 1), 12);
    (c.hpBar.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  /** A spot 45-80 m from the player on dry, open ground outside every safe zone. */
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

  /** Ray vs body spheres (torso and head). */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate = 0): { t: number; index: number } | null {
    let best = maxDist;
    let idx = -1;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (c.state === 'dead') continue;
      for (const [hy, r] of [
        [1.2, 0.34],
        [1.75, 0.2],
        [0.6, 0.22],
      ]) {
        const rr = (r + inflate) * c.scale;
        const ox = o.x - c.pos.x;
        const oy = o.y - (c.pos.y + hy * c.scale);
        const oz = o.z - c.pos.z;
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

  /** Returns true when the hit killed it. Any hit provokes. */
  damage(i: number, amount: number): boolean {
    const c = this.list[i];
    if (c.state === 'dead') return false;
    c.hp -= amount;
    c.provoked = true;
    // Guards rally when one of them (or the chief) is hit.
    if (c.role === 'guard' || c.role === 'boss') for (const o of this.list) if (o.role === 'guard' || o.role === 'boss') o.provoked = true;
    if (c.hp <= 0) {
      c.state = 'dead';
      c.deadT = 0;
      c.speed = 0;
      if (c.hpBar) c.hpBar.visible = false;
      return true;
    }
    return false;
  }

  /** Inside a fire's ring of light or a finished cabin's yard. */
  private zoneAt(x: number, z: number, zones: SafeZone[]): SafeZone | null {
    for (const s of zones) if (Math.hypot(x - s.x, z - s.z) < s.r) return s;
    return null;
  }

  update(dt: number, ctx: { player: THREE.Vector3; alive: boolean; night: boolean; day: number; zones: SafeZone[] }): void {
    const { player, zones } = ctx;
    this.sinceSpawn += dt;
    if (ctx.night && this.spawnedNight !== ctx.day) {
      this.spawnedNight = ctx.day;
      this.spawnNightParty(ctx.day, player, zones);
    }
    const playerSafe = this.zoneAt(player.x, player.z, zones);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      const cfg = ROLE[c.role];
      const dx = player.x - c.pos.x;
      const dz = player.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      const toPlayer = Math.atan2(dx, dz);

      if (c.state === 'dead') {
        c.deadT += dt;
        c.rig.body.rotation.x = -Math.min(Math.PI / 2, c.deadT * 3.2);
        c.rig.body.position.y = Math.min(0.12, c.deadT * 0.2);
        if (c.deadT > 0.9 && !c.dropped) {
          c.dropped = true;
          this.events.onDeath(c);
        }
        if (c.deadT > 6) {
          this.group.remove(c.rig.root);
          this.list.splice(i, 1);
        }
        continue;
      }

      // Dawn: the night party melts back into the forest.
      if (c.night && !ctx.night) c.leaving = true;
      if (c.leaving && dist > 55) {
        this.group.remove(c.rig.root);
        this.list.splice(i, 1);
        continue;
      }

      let targetHeading = c.heading;
      let targetSpeed = 0;
      let wantAttack = false;
      const run = cfg.run;
      const walk = cfg.walk;

      if (c.leaving || !ctx.alive) {
        targetHeading = toPlayer + Math.PI;
        targetSpeed = c.leaving ? run : walk;
      } else {
        switch (c.role) {
          case 'scout':
            if (dist <= 18) {
              targetHeading = toPlayer + Math.PI;
              targetSpeed = run;
            } else if (dist < 30) {
              targetHeading = toPlayer + Math.PI;
              targetSpeed = walk;
            } else if (dist > 45) {
              targetHeading = toPlayer;
              targetSpeed = walk;
            } else {
              targetHeading = toPlayer;
              if (Math.random() < dt * 0.3) this.events.onSpotted(c);
            }
            break;
          case 'stalker':
            if (c.provoked) {
              targetHeading = toPlayer;
              targetSpeed = dist > cfg.reach ? run : 0;
              wantAttack = dist <= cfg.reach;
            } else {
              // Circle the player at ~22 m without closing in.
              const ring = 22;
              if (dist > ring + 8) {
                targetHeading = toPlayer + c.circleDir * 0.35;
                targetSpeed = walk * 1.6;
              } else {
                targetHeading = toPlayer + c.circleDir * (Math.PI / 2) + (dist > ring ? -0.4 : 0.4) * c.circleDir;
                targetSpeed = walk * 1.2;
              }
            }
            break;
          case 'raider':
            targetHeading = toPlayer;
            targetSpeed = dist > cfg.reach ? (dist < 40 ? run : walk * 1.5) : 0;
            wantAttack = dist <= cfg.reach;
            break;
          case 'guard':
          case 'boss': {
            const fromHome = Math.hypot(player.x - c.home.x, player.z - c.home.z);
            const aggro = c.provoked || fromHome < (c.role === 'boss' ? 18 : 22);
            const leash = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z);
            if (aggro && leash < 40 && ctx.alive) {
              targetHeading = toPlayer;
              targetSpeed = dist > cfg.reach ? run : 0;
              wantAttack = dist <= cfg.reach;
            } else if (leash > 3) {
              targetHeading = Math.atan2(c.home.x - c.pos.x, c.home.z - c.pos.z);
              targetSpeed = walk;
              if (leash > 40) c.provoked = false;
            } else {
              c.phase += dt * 0.2;
              targetHeading = c.heading + Math.sin(c.phase) * 0.02;
            }
            break;
          }
        }
      }

      // Fear of fire and respect for the player's shelters: never step inside a safe zone,
      // and if already inside, back out. Village guards do not fear their own fire.
      const here = this.zoneAt(c.pos.x, c.pos.z, zones);
      if (here) {
        targetHeading = Math.atan2(c.pos.x - here.x, c.pos.z - here.z);
        targetSpeed = run;
        wantAttack = false;
      } else if (targetSpeed > 0) {
        const ax = c.pos.x + Math.sin(targetHeading) * 2.5;
        const az = c.pos.z + Math.cos(targetHeading) * 2.5;
        const ahead = this.zoneAt(ax, az, zones);
        if (ahead) {
          // Hold at the edge, pacing sideways, staring at the light.
          targetHeading = Math.atan2(c.pos.x - ahead.x, c.pos.z - ahead.z) + c.circleDir * Math.PI * 0.5;
          targetSpeed = walk * 0.6;
          wantAttack = false;
        }
      }
      if (playerSafe) wantAttack = false;

      // Avoid walking into water.
      const lx = c.pos.x + Math.sin(targetHeading) * 2;
      const lz = c.pos.z + Math.cos(targetHeading) * 2;
      if (this.terrain.height(lx, lz) < this.terrain.waterLevelAt(lx, lz) + 0.2) {
        targetHeading += c.circleDir * 1.3;
      }

      // Attack: wind up, then a heavy downward swing.
      c.attackCd -= dt;
      if (c.state === 'attack') {
        c.attackT += dt;
        targetSpeed = 0;
        targetHeading = toPlayer;
        if (c.attackT >= 0.55 && c.attackT - dt < 0.55 && dist <= cfg.reach + 0.4 && !playerSafe && ctx.alive) this.events.onHitPlayer(cfg.damage, c);
        if (c.attackT >= 0.95) {
          c.state = 'move';
          c.attackCd = c.role === 'boss' ? 1.4 : 1.1;
        }
      } else if (wantAttack && c.attackCd <= 0 && cfg.damage > 0) {
        c.state = 'attack';
        c.attackT = 0;
      } else {
        c.state = targetSpeed > 0.1 ? 'move' : 'idle';
      }

      c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 4);
      const diff = wrapAngle(targetHeading - c.heading);
      c.heading = wrapAngle(c.heading + clamp(diff, -3.5 * dt, 3.5 * dt));
      c.pos.x += Math.sin(c.heading) * c.speed * dt;
      c.pos.z += Math.cos(c.heading) * c.speed * dt;
      // Walls, gates, cabins and trees block them like they block the player.
      this.colliders.query(c.pos.x, c.pos.z, 3, (col) => {
        const ox = c.pos.x - col.x;
        const oz = c.pos.z - col.z;
        const d = Math.hypot(ox, oz);
        const min = col.r + 0.35 * c.scale;
        if (d < min && d > 1e-4) {
          c.pos.x += (ox / d) * (min - d);
          c.pos.z += (oz / d) * (min - d);
        }
      });
      c.pos.y = this.terrain.height(c.pos.x, c.pos.z);

      this.animate(c, dt);
      c.rig.root.position.copy(c.pos);
      c.rig.root.rotation.y = c.heading;
      c.rig.root.visible = dist < 140;

      if (c.hpBar) {
        c.hpBar.visible = (c.provoked || dist < 20) && dist < 35;
        if (c.hpBar.visible) this.drawHpBar(c);
      }
    }
  }

  private animate(c: Cannibal, dt: number): void {
    const r = c.rig;
    const cfg = ROLE[c.role];
    const s = c.speed;
    c.phase += (s * dt) / (0.75 * c.scale) * Math.PI;
    const amp = clamp(s / cfg.run, 0, 1) * 0.9 + (s > 0.1 ? 0.15 : 0);
    const sw = Math.sin(c.phase);
    r.thighL.rotation.x = sw * amp;
    r.thighR.rotation.x = -sw * amp;
    r.shinL.rotation.x = Math.max(0, -Math.cos(c.phase)) * amp * 1.2;
    r.shinR.rotation.x = Math.max(0, Math.cos(c.phase)) * amp * 1.2;
    r.body.position.y = Math.abs(Math.cos(c.phase)) * 0.05 * amp;
    r.torso.rotation.x = clamp(s / cfg.run, 0, 1) * 0.3;
    r.armL.rotation.x = -sw * amp * 0.8;
    r.foreL.rotation.x = -0.4 - amp * 0.3;
    if (c.state === 'attack') {
      const t = c.attackT;
      // Raise the weapon high, then bring it down hard.
      const up = t < 0.45 ? t / 0.45 : 1 - clamp((t - 0.45) / 0.15, 0, 1);
      r.armR.rotation.x = -2.6 * up + (t > 0.45 ? 0.6 * clamp((t - 0.45) / 0.15, 0, 1) : 0);
      r.foreR.rotation.x = -0.6 * up;
      r.torso.rotation.x = -0.25 * up + (t > 0.45 ? 0.35 : 0);
    } else {
      r.armR.rotation.x = sw * amp * 0.6 - 0.3;
      r.foreR.rotation.x = -0.5;
      // Idle: the head turns slowly, scanning.
      r.head.rotation.y = s < 0.1 ? Math.sin(c.phase * 0.2 + c.deadT) * 0.4 : 0;
    }
  }
}
