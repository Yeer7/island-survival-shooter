import * as THREE from 'three';
import { Input } from '../core/input';
import { clamp, damp, easeInOut, lerp, smoothstep } from '../core/math';
import { ColliderGrid } from '../world/colliders';
import { Dock } from '../world/landmarks';
import { Surface, Terrain } from '../world/terrain';

const EYE = 1.65;
const RADIUS = 0.38;
const GRAVITY = 24;
const JUMP = 7.4;
const WALK = 6;
/** Unlimited sprint. */
const RUN = 10;
const SWIM = 2.6;
const SENS = 0.0021;
const BASE_FOV = 80;

export interface ControllerEvents {
  onStep(surface: Surface, sprint: boolean): void;
  onLand(impactSpeed: number): void;
}

/**
 * First-person body: pointer-lock look, terrain-following walk, gravity, jump,
 * unlimited sprint, swimming, circle collisions and distance-driven head bob.
 */
export class PlayerController {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  swimming = false;
  sprinting = false;
  moving = false;
  speed01 = 0;
  bobPhase = 0;
  surface: Surface = 'sand';
  /** 0 → 1 during the wake-up sequence at the crash site. */
  wake = 1;
  carrySlow = 1;
  /** Mouse sensitivity multiplier from the pause menu. */
  sensitivity = 1;
  lookDX = 0;
  lookDY = 0;
  private stepAccum = 0;
  private recoilPitch = 0;
  private recoilVel = 0;
  private recoilYaw = 0;
  private recoilYawVel = 0;
  private trauma = 0;
  private time = 0;
  private fov = BASE_FOV;
  private wish = new THREE.Vector3();
  private right = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private terrain: Terrain,
    private colliders: ColliderGrid,
    private dock: Dock,
    private events: ControllerEvents,
  ) {}

  /** Place the feet at an exact point (used indoors, where there is no terrain). */
  placeAt(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  teleport(x: number, z: number, yaw: number): void {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  addRecoil(pitch: number, yaw: number): void {
    this.recoilVel += pitch;
    this.recoilYawVel += yaw;
  }

  addTrauma(t: number): void {
    this.trauma = clamp(this.trauma + t, 0, 1);
  }

  /** Indoors (the cave): a floor function and wall clamp replace the terrain and the sea. */
  interior: { ground(x: number, z: number): number; clamp(p: THREE.Vector3): void } | null = null;

  /** Extra walkable wooden floors (cabin floors, the boat deck), on top of the dock. */
  platforms: ((x: number, z: number) => number | null)[] = [];
  /** 0..1 aim zoom while the bow is drawn: the FOV narrows from 80 to 70. */
  aimZoom = 0;

  private platformAt(x: number, z: number, feetY: number): number | null {
    let best: number | null = null;
    const d = this.dock.groundAt(x, z);
    if (d !== null && feetY >= d - 0.6) best = d;
    for (const p of this.platforms) {
      const h = p(x, z);
      if (h !== null && feetY >= h - 0.6 && (best === null || h > best)) best = h;
    }
    return best;
  }

  private groundAt(x: number, z: number, feetY: number): number {
    if (this.interior) return this.interior.ground(x, z);
    const g = this.terrain.height(x, z);
    const p = this.platformAt(x, z, feetY);
    return p !== null ? Math.max(g, p) : g;
  }

  update(dt: number, input: Input, enabled: boolean): void {
    this.time += dt;
    const wakeActive = this.wake < 1;
    if (wakeActive) this.wake = Math.min(1, this.wake + dt / 3.2);
    const canLook = enabled && this.wake > 0.45;
    const canMove = enabled && this.wake >= 1;

    this.lookDX = canLook ? input.mouseDX : 0;
    this.lookDY = canLook ? input.mouseDY : 0;
    if (canLook) {
      this.yaw -= input.mouseDX * SENS * this.sensitivity;
      this.pitch = clamp(this.pitch - input.mouseDY * SENS * this.sensitivity, -1.52, 1.52);
    }

    const k = input.keys;
    const mx = canMove ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0;
    const mz = canMove ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0;
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.wish.set(0, 0, 0).addScaledVector(this.forward, mz).addScaledVector(this.right, mx);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    this.sprinting = canMove && (k.has('ShiftLeft') || k.has('ShiftRight')) && mz > 0 && !this.swimming;
    const target = (this.swimming ? SWIM : this.sprinting ? RUN : WALK) * this.carrySlow;
    const accel = this.onGround || this.swimming ? 12 : 2.5;
    this.vel.x = damp(this.vel.x, this.wish.x * target, accel, dt);
    this.vel.z = damp(this.vel.z, this.wish.z * target, accel, dt);

    if (this.swimming) {
      this.vel.y = damp(this.vel.y, canMove && k.has('Space') ? 1.5 : 0, 4, dt);
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.onGround && canMove && input.justPressed('Space')) {
        this.vel.y = JUMP;
        this.onGround = false;
      }
    }

    this.pos.addScaledVector(this.vel, dt);

    // Push out of trunks, rocks and the wreck.
    this.colliders.query(this.pos.x, this.pos.z, RADIUS + 3, (c) => {
      if (this.pos.y > c.y1 - 0.15 || this.pos.y + EYE < c.y0) return;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + RADIUS;
      if (d < min && d > 1e-5) {
        const push = (min - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
        const vn = (this.vel.x * dx + this.vel.z * dz) / d;
        if (vn < 0) {
          this.vel.x -= (vn * dx) / d;
          this.vel.z -= (vn * dz) / d;
        }
      }
    });

    // Keep the player on the island's playable disc (or inside the cave walls).
    const r = this.interior ? 0 : Math.hypot(this.pos.x, this.pos.z);
    if (this.interior) this.interior.clamp(this.pos);
    if (r > 330) {
      this.pos.x *= 330 / r;
      this.pos.z *= 330 / r;
    }

    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const wl = this.interior ? -1000 : this.terrain.waterLevelAt(this.pos.x, this.pos.z);
    const depth = wl - g;
    const wasGround = this.onGround;
    this.swimming = depth > 1.4 && this.pos.y < wl - 0.9;
    if (this.swimming) {
      this.pos.y = Math.max(g, damp(this.pos.y, wl - 1.3, 5, dt));
      this.onGround = false;
    } else if (this.pos.y <= g) {
      if (!wasGround && this.vel.y < -2) this.events.onLand(-this.vel.y);
      this.pos.y = g;
      this.vel.y = Math.max(0, this.vel.y);
      this.onGround = true;
    } else if (wasGround && this.vel.y <= 0 && this.pos.y - g < 0.45) {
      // Stick to the ground when walking downhill.
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Distance-driven bob and footsteps.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = clamp(hs / RUN, 0, 1);
    this.moving = hs > 0.4;
    if ((this.onGround || this.swimming) && hs > 0.3) {
      const stride = this.swimming ? 2.2 : this.sprinting ? 2.1 : 1.6;
      this.stepAccum += hs * dt;
      this.bobPhase += ((hs * dt) / stride) * Math.PI;
      if (this.stepAccum >= stride) {
        this.stepAccum -= stride;
        const floorY = this.interior ? null : this.platformAt(this.pos.x, this.pos.z, this.pos.y);
        this.surface = this.interior ? 'rock' : this.swimming ? 'water' : floorY !== null && Math.abs(this.pos.y - floorY) < 0.12 ? 'wood' : this.terrain.surfaceAt(this.pos.x, this.pos.z);
        if (depth > 0.15 && !this.swimming && this.surface !== 'wood') this.surface = 'water';
        this.events.onStep(this.surface, this.sprinting);
      }
    }

    // Recoil springs ride on top of the aim and return to it.
    const stiff = 160;
    const dampK = 2 * Math.sqrt(stiff) * 0.9;
    this.recoilVel += (-stiff * this.recoilPitch - dampK * this.recoilVel) * dt;
    this.recoilPitch = clamp(this.recoilPitch + this.recoilVel * dt, -0.02, 0.12);
    this.recoilYawVel += (-stiff * this.recoilYaw - dampK * this.recoilYawVel) * dt;
    this.recoilYaw = clamp(this.recoilYaw + this.recoilYawVel * dt, -0.05, 0.05);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const shake = this.trauma * this.trauma;
    const t = this.time;
    const sP = shake * 0.032 * (Math.sin(t * 31) * 0.6 + Math.sin(t * 47 + 1) * 0.4);
    const sY = shake * 0.038 * (Math.sin(t * 29 + 2) * 0.6 + Math.sin(t * 53) * 0.4);
    const sR = shake * 0.024 * Math.sin(t * 37 + 4);

    // Head bob (small, eased through the footfall).
    const amp = (this.onGround ? 1 : 0.3) * smoothstep(0.3, 4, hs) * (this.sprinting ? 1.25 : 1);
    const bobY = (Math.cos(this.bobPhase * 2) * -0.5 + 0.5) * -0.045 * amp;
    const bobX = Math.sin(this.bobPhase) * 0.025 * amp;

    // Wake-up: lying on the sand, then sitting up.
    const w = easeInOut(this.wake);
    const eyeH = lerp(0.35, EYE, w);
    const wakeRoll = lerp(0.5, 0, w);
    const wakePitch = lerp(0.9, 0, smoothstep(0, 0.8, this.wake));

    this.eye.set(this.pos.x + this.right.x * bobX, this.pos.y + eyeH + bobY, this.pos.z + this.right.z * bobX);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.pitch + this.recoilPitch + sP + (wakeActive ? wakePitch : 0), this.yaw + this.recoilYaw + sY, sR + wakeRoll, 'YXZ');

    const targetFov = BASE_FOV - 10 * this.aimZoom + (this.sprinting && hs > WALK && this.aimZoom < 0.05 ? 8 : 0);
    this.fov = damp(this.fov, targetFov, this.aimZoom > 0 ? 9 : 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** World-space look direction including recoil. */
  lookDirection(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }
}
