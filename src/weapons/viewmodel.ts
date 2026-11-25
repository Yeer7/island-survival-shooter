import * as THREE from 'three';
import { clamp, damp, easeOutCubic, lerp } from '../core/math';
import { SlotId } from '../player/inventory';
import { buildArm, buildAxe, buildLog, buildPistol } from './models';

type Action = 'none' | 'swing' | 'fire' | 'reload' | 'use' | 'draw';

interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

const REST: Record<SlotId, Pose> = {
  axe: { px: 0.3, py: -0.4, pz: -0.6, rx: -0.12, ry: -0.3, rz: -0.08 },
  pistol: { px: 0.19, py: -0.2, pz: -0.5, rx: 0.02, ry: -0.04, rz: 0 },
  food: { px: 0.24, py: -0.26, pz: -0.45, rx: 0.3, ry: -0.3, rz: 0 },
  bandage: { px: 0.24, py: -0.26, pz: -0.45, rx: 0.3, ry: -0.3, rz: 0 },
  cloth: { px: 0.24, py: -0.27, pz: -0.45, rx: 0.3, ry: -0.3, rz: 0 },
};

const mix = (out: Pose, a: Pose, b: Pose, t: number): Pose => {
  out.px = lerp(a.px, b.px, t);
  out.py = lerp(a.py, b.py, t);
  out.pz = lerp(a.pz, b.pz, t);
  out.rx = lerp(a.rx, b.rx, t);
  out.ry = lerp(a.ry, b.ry, t);
  out.rz = lerp(a.rz, b.rz, t);
  return out;
};

/**
 * Arms and held tools, drawn in their own scene with their own camera after the
 * world (so they never clip into trees) and their own small light rig.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private rightArm: THREE.Group;
  private leftArm: THREE.Group;
  private tools: Record<SlotId, THREE.Object3D>;
  private muzzle: THREE.Object3D;
  private flash: THREE.Mesh;
  private logs: THREE.Mesh[] = [];
  private hemi: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private current: SlotId = 'axe';
  private action: Action = 'draw';
  private actionT = 0;
  private actionDur = 0.3;
  private fireKick = 0;
  private fireKickVel = 0;
  private swayX = 0;
  private swayY = 0;
  private sprint = 0;
  private flashT = 0;
  private leftShow = 0;
  private logCount = 0;
  private pose: Pose = { ...REST.axe };
  private tmpPose: Pose = { ...REST.axe };
  private tmpPose2: Pose = { ...REST.axe };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.root);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.position.set(-0.6, 1, 0.5);
    this.scene.add(this.hemi, this.keyLight);

    this.rightArm = buildArm(false);
    this.root.add(this.rightArm);

    const axe = buildAxe();
    axe.position.set(0, 0.0, -0.01);
    axe.rotation.set(-0.35, 0, 0.12);
    axe.scale.setScalar(0.85);
    const pistol = buildPistol();
    pistol.position.set(0, -0.01, -0.035);
    const food = this.foodModel();
    const bandage = this.bandageModel();
    const cloth = this.clothModel();
    this.tools = { axe, pistol, food, bandage, cloth };
    for (const t of Object.values(this.tools)) {
      t.visible = false;
      this.rightArm.add(t);
    }
    axe.visible = true;
    this.muzzle = pistol.getObjectByName('muzzle')!;

    const flashTex = this.flashTexture();
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffc070 }),
    );
    this.flash.visible = false;
    this.muzzle.add(this.flash);

    this.leftArm = buildArm(true);
    this.leftArm.position.set(-0.34, -0.45, -0.64);
    this.leftArm.rotation.set(0.25, 0.25, 0.05);
    this.root.add(this.leftArm);
    // Logs lie across the forearm, stacked two-and-one, kept in the bottom-left corner.
    const stack = [
      [-0.12, 0.065, -0.02],
      [-0.12, 0.065, -0.16],
      [-0.1, 0.18, -0.09],
    ];
    for (let i = 0; i < 3; i++) {
      const log = buildLog(0.56, 0.065);
      log.rotation.set(0, (i - 1) * 0.06, Math.PI / 2);
      log.position.set(stack[i][0], stack[i][1], stack[i][2]);
      log.visible = false;
      this.leftArm.add(log);
      this.logs.push(log);
    }
    this.leftArm.visible = false;
    this.setPose(REST.axe);
  }

  private foodModel(): THREE.Group {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.3 }));
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0355, 0.0355, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xf2d16b }));
    g.add(can, label);
    g.position.set(-0.02, 0.05, -0.04);
    return g;
  }

  private bandageModel(): THREE.Group {
    const g = new THREE.Group();
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }));
    roll.rotation.z = Math.PI / 2;
    g.add(roll);
    g.position.set(-0.02, 0.05, -0.04);
    return g;
  }

  private clothModel(): THREE.Group {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.08), new THREE.MeshStandardMaterial({ color: 0x3b6ea5, roughness: 0.95 }));
    g.add(c);
    g.position.set(-0.02, 0.05, -0.04);
    return g;
  }

  private flashTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,230,1)');
    grd.addColorStop(0.25, 'rgba(255,200,90,0.9)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = grd;
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 === 0 ? 32 : 12;
      x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    x.closePath();
    x.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get busy(): boolean {
    return this.action !== 'none' && this.action !== 'fire';
  }

  equip(slot: SlotId): void {
    if (slot === this.current && this.action !== 'draw') return;
    this.current = slot;
    for (const [id, obj] of Object.entries(this.tools)) obj.visible = id === slot;
    this.start('draw', 0.3);
  }

  private start(a: Action, dur: number): void {
    this.action = a;
    this.actionT = 0;
    this.actionDur = dur;
  }

  /** Axe swing; impact lands at ~42% of the motion. */
  swing(duration: number): void {
    this.start('swing', duration);
  }

  fire(): void {
    this.fireKickVel += 9;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    if (this.action === 'none') this.start('fire', 0.12);
  }

  reload(duration: number): void {
    this.start('reload', duration);
  }

  use(duration: number): void {
    this.start('use', duration);
  }

  setLogs(n: number): void {
    this.logCount = n;
    this.logs.forEach((l, i) => (l.visible = i < n));
  }

  /** Muzzle position in world space, for tracers. */
  muzzleWorld(worldCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(out);
    // vm camera sits at the origin looking down -Z like the world camera; map across.
    out.applyMatrix4(worldCamera.matrixWorld);
    return out;
  }

  private setPose(p: Pose): void {
    this.rightArm.position.set(p.px, p.py, p.pz);
    this.rightArm.rotation.set(p.rx, p.ry, p.rz);
  }

  private actionPose(rest: Pose, out: Pose): Pose {
    const t = clamp(this.actionT / this.actionDur, 0, 1);
    switch (this.action) {
      case 'draw': {
        const e = easeOutCubic(t);
        mix(out, rest, rest, 0);
        out.py = rest.py - (1 - e) * 0.35;
        out.rx = rest.rx - (1 - e) * 0.8;
        return out;
      }
      case 'swing': {
        const windup: Pose = { px: rest.px + 0.06, py: rest.py + 0.1, pz: rest.pz + 0.02, rx: rest.rx + 0.5, ry: rest.ry - 0.15, rz: rest.rz - 0.35 };
        const strike: Pose = { px: rest.px - 0.16, py: rest.py - 0.04, pz: rest.pz - 0.12, rx: rest.rx - 1.25, ry: rest.ry + 0.15, rz: rest.rz + 0.45 };
        if (t < 0.3) return mix(out, rest, windup, easeOutCubic(t / 0.3));
        if (t < 0.42) {
          const k = (t - 0.3) / 0.12;
          return mix(out, windup, strike, k * k);
        }
        return mix(out, strike, rest, easeOutCubic((t - 0.42) / 0.58));
      }
      case 'reload': {
        const k = t < 0.25 ? easeOutCubic(t / 0.25) : t > 0.8 ? 1 - easeOutCubic((t - 0.8) / 0.2) : 1;
        mix(out, rest, rest, 0);
        out.py -= 0.1 * k;
        out.rx -= 0.55 * k;
        out.rz += 0.5 * k;
        out.px -= 0.05 * k;
        // Little tap when the new magazine seats.
        if (t > 0.55 && t < 0.65) out.py += Math.sin(((t - 0.55) / 0.1) * Math.PI) * 0.02;
        return out;
      }
      case 'use': {
        const k = t < 0.3 ? easeOutCubic(t / 0.3) : t > 0.75 ? 1 - easeOutCubic((t - 0.75) / 0.25) : 1;
        const target: Pose = { px: 0.07, py: -0.17, pz: -0.34, rx: 0.9, ry: -0.6, rz: 0.2 };
        mix(out, rest, target, k);
        if (k > 0.95) out.py += Math.sin(this.actionT * 30) * 0.004;
        return out;
      }
      default:
        return mix(out, rest, rest, 0);
    }
  }

  update(dt: number, s: { bobPhase: number; speed01: number; sprint: boolean; onGround: boolean; lookDX: number; lookDY: number; hemiSky: THREE.Color; hemiGround: THREE.Color; key: THREE.Color; keyIntensity: number; light: number }): void {
    // Lighting follows the world so the hands sit in the scene, with a floor so they stay readable at night.
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = Math.max(0.55, s.light * 1.05);
    this.keyLight.color.copy(s.key);
    this.keyLight.intensity = Math.max(0.35, s.keyIntensity * 0.75);

    if (this.action !== 'none') {
      this.actionT += dt;
      if (this.actionT >= this.actionDur) this.action = 'none';
    }

    const rest = REST[this.current];
    this.sprint = damp(this.sprint, s.sprint ? 1 : 0, 8, dt);
    const p = this.actionPose(rest, this.tmpPose);
    // Lower and tilt the tool when sprinting.
    const sp = this.sprint * (this.action === 'none' ? 1 : 0.3);
    p.py -= 0.05 * sp;
    p.rx -= 0.35 * sp;
    p.ry += 0.35 * sp;

    // Pistol kick spring (returns to the hold).
    this.fireKickVel += (-260 * this.fireKick - 26 * this.fireKickVel) * dt;
    this.fireKick += this.fireKickVel * dt;
    p.pz += this.fireKick * 0.03;
    p.rx += this.fireKick * 0.12;

    mix(this.pose, this.pose, p, 1 - Math.exp(-30 * dt));
    this.setPose(this.pose);

    // Bob follows the feet; a still player sees a still tool.
    const amp = s.onGround ? s.speed01 * (s.sprint ? 1.5 : 1) : 0;
    const bx = Math.sin(s.bobPhase) * 0.012 * amp;
    const by = -Math.abs(Math.cos(s.bobPhase)) * 0.01 * amp;
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.0006, -0.03, 0.03), 10, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.0006, -0.03, 0.03), 10, dt);
    this.root.position.set(bx + this.swayX, by + this.swayY, 0);
    this.root.rotation.set(this.swayY * 0.8, this.swayX * 1.2, 0);

    // Carried logs on the left arm.
    this.leftShow = damp(this.leftShow, this.logCount > 0 ? 1 : 0, 10, dt);
    this.leftArm.visible = this.leftShow > 0.02;
    this.leftArm.position.y = -0.45 - (1 - this.leftShow) * 0.4 + by * 0.8;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }
}
