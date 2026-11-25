import * as THREE from 'three';
import { clamp, damp, easeOutCubic, lerp } from '../core/math';
import { HotbarId } from '../player/inventory';
import { buildArm, buildArrow, buildAxe, buildBow, buildFish, buildFlameAxe, buildLog, buildMeat, buildRod, buildSpear, buildTorch } from './models';

type Action = 'none' | 'swing' | 'stab' | 'cast' | 'release' | 'use' | 'draw';

interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

const P = (px: number, py: number, pz: number, rx: number, ry: number, rz: number): Pose => ({ px, py, pz, rx, ry, rz });
const HELD = P(0.24, -0.26, -0.45, 0.3, -0.3, 0);

const REST: Record<HotbarId, Pose> = {
  axe: P(0.3, -0.4, -0.6, -0.12, -0.3, -0.08),
  flameAxe: P(0.3, -0.4, -0.6, -0.12, -0.3, -0.08),
  spear: P(0.22, -0.3, -0.36, 0, 0.08, 0.15),
  bow: P(-0.07, -0.22, -0.56, 0.1, 0.35, 1.2),
  torch: P(0.28, -0.34, -0.52, -0.25, -0.2, -0.1),
  rod: P(0.26, -0.34, -0.46, -1.0, -0.15, -0.05),
  food: HELD,
  cookedMeat: HELD,
  cookedFish: HELD,
  meat: HELD,
  fish: HELD,
  bandage: HELD,
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

function flameTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const grd = x.createRadialGradient(32, 40, 0, 32, 36, 30);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.3, 'rgba(255,190,80,0.9)');
  grd.addColorStop(0.7, 'rgba(255,90,20,0.45)');
  grd.addColorStop(1, 'rgba(255,60,10,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  private bowArm: THREE.Group;
  private tools: Record<HotbarId, THREE.Object3D>;
  private bowString: THREE.Line;
  private bowArrow: THREE.Object3D;
  private rodTip: THREE.Object3D;
  private flames: THREE.Sprite[] = [];
  private logs: THREE.Mesh[] = [];
  private hemi: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private fireLight: THREE.PointLight;
  private current: HotbarId = 'axe';
  private action: Action = 'draw';
  private actionT = 0;
  private actionDur = 0.3;
  private swayX = 0;
  private swayY = 0;
  private sprint = 0;
  private leftShow = 0;
  private logCount = 0;
  private flameT = 0;
  /** 0..1 bow draw, set by the bow logic. */
  bowDraw = 0;
  arrowNocked = true;
  private pose: Pose = { ...REST.axe };
  private tmpPose: Pose = { ...REST.axe };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.01, 10);
    this.scene.add(this.camera);
    this.camera.add(this.root);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.position.set(-0.6, 1, 0.5);
    // Warm light on the hands from a held flame; intensity 0 when nothing burns.
    this.fireLight = new THREE.PointLight(0xff9a4a, 0, 2, 2);
    this.fireLight.position.set(0.3, 0.1, -0.5);
    this.scene.add(this.hemi, this.keyLight);
    this.camera.add(this.fireLight);

    this.rightArm = buildArm(false);
    this.root.add(this.rightArm);

    const axe = buildAxe();
    axe.position.set(0, 0, -0.01);
    axe.rotation.set(-0.35, 0, 0.12);
    axe.scale.setScalar(0.85);
    const flameAxe = buildFlameAxe();
    flameAxe.position.copy(axe.position);
    flameAxe.rotation.copy(axe.rotation);
    flameAxe.scale.copy(axe.scale);
    const spear = buildSpear();
    const torch = buildTorch();
    torch.rotation.set(-0.2, 0, 0.1);
    const rod = buildRod();
    this.rodTip = rod.getObjectByName('tip')!;
    const held = (o: THREE.Object3D) => {
      o.position.set(-0.02, 0.05, -0.05);
      o.scale.setScalar(0.6);
      return o;
    };
    const bandage = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }));
    bandage.rotation.z = Math.PI / 2;
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.3 }));
    const bandG = new THREE.Group();
    bandG.add(bandage);
    const canG = new THREE.Group();
    canG.add(can);
    bandG.position.set(-0.02, 0.05, -0.04);
    canG.position.set(-0.02, 0.05, -0.04);

    this.tools = {
      axe,
      flameAxe,
      spear,
      bow: new THREE.Group(),
      torch,
      rod,
      food: canG,
      cookedMeat: held(buildMeat(true)),
      cookedFish: held(buildFish(true)),
      meat: held(buildMeat(false)),
      fish: held(buildFish(false)),
      bandage: bandG,
    };
    for (const t of Object.values(this.tools)) {
      t.visible = false;
      this.rightArm.add(t);
    }
    axe.visible = true;

    // Flames for the torch and the flaming axe.
    const ftex = flameTexture();
    for (const host of [torch, flameAxe]) {
      const anchor = host.getObjectByName('flame')!;
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        s.scale.setScalar(0.12);
        s.position.y = i * 0.03;
        anchor.add(s);
        this.flames.push(s);
      }
    }

    // Bow held in the left hand at the centre-left; right hand draws the string.
    this.bowArm = buildArm(true);
    this.bowArm.position.set(-0.13, -0.2, -0.62);
    this.bowArm.rotation.set(0.05, -0.15, 0);
    const bow = buildBow();
    bow.group.rotation.z = 0.22;
    bow.group.scale.setScalar(0.55);
    bow.group.position.set(0.01, 0.02, -0.03);
    this.bowString = bow.string;
    this.bowArrow = buildArrow();
    this.bowArrow.position.set(0.012, 0, 0.06);
    bow.group.add(this.bowArrow);
    this.bowArm.add(bow.group);
    this.bowArm.visible = false;
    this.root.add(this.bowArm);

    this.leftArm = buildArm(true);
    this.leftArm.position.set(-0.34, -0.45, -0.64);
    this.leftArm.rotation.set(0.25, 0.25, 0.05);
    this.root.add(this.leftArm);
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

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  get busy(): boolean {
    return this.action !== 'none' && this.action !== 'release';
  }

  get held(): HotbarId {
    return this.current;
  }

  equip(slot: HotbarId): void {
    if (slot === this.current && this.action !== 'draw') return;
    this.current = slot;
    for (const [id, obj] of Object.entries(this.tools)) obj.visible = id === slot;
    this.bowArm.visible = slot === 'bow';
    this.bowDraw = 0;
    this.start('draw', 0.3);
  }

  private start(a: Action, dur: number): void {
    this.action = a;
    this.actionT = 0;
    this.actionDur = dur;
  }

  swing(duration: number): void {
    this.start('swing', duration);
  }

  stab(duration: number): void {
    this.start('stab', duration);
  }

  cast(duration: number): void {
    this.start('cast', duration);
  }

  release(): void {
    this.start('release', 0.25);
  }

  use(duration: number): void {
    this.start('use', duration);
  }

  setLogs(n: number): void {
    this.logCount = n;
    this.logs.forEach((l, i) => (l.visible = i < n));
  }

  /** Rod tip in world space (vm camera sits at the origin like the world camera). */
  rodTipWorld(worldCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    this.rodTip.getWorldPosition(out);
    return out.applyMatrix4(worldCamera.matrixWorld);
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
        const windup = P(rest.px + 0.06, rest.py + 0.1, rest.pz + 0.02, rest.rx + 0.5, rest.ry - 0.15, rest.rz - 0.35);
        const strike = P(rest.px - 0.16, rest.py - 0.04, rest.pz - 0.12, rest.rx - 1.25, rest.ry + 0.15, rest.rz + 0.45);
        if (t < 0.3) return mix(out, rest, windup, easeOutCubic(t / 0.3));
        if (t < 0.42) {
          const k = (t - 0.3) / 0.12;
          return mix(out, windup, strike, k * k);
        }
        return mix(out, strike, rest, easeOutCubic((t - 0.42) / 0.58));
      }
      case 'stab': {
        const back = P(rest.px + 0.02, rest.py - 0.02, rest.pz + 0.1, rest.rx + 0.05, rest.ry, rest.rz);
        const thrust = P(rest.px - 0.08, rest.py + 0.04, rest.pz - 0.5, rest.rx - 0.04, rest.ry + 0.06, rest.rz);
        if (t < 0.25) return mix(out, rest, back, easeOutCubic(t / 0.25));
        if (t < 0.38) {
          const k = (t - 0.25) / 0.13;
          return mix(out, back, thrust, k * k);
        }
        return mix(out, thrust, rest, easeOutCubic((t - 0.38) / 0.62));
      }
      case 'cast': {
        const back = P(rest.px + 0.04, rest.py + 0.1, rest.pz + 0.05, rest.rx + 0.9, rest.ry, rest.rz);
        const fwd = P(rest.px - 0.02, rest.py - 0.02, rest.pz - 0.1, rest.rx - 0.35, rest.ry, rest.rz);
        if (t < 0.35) return mix(out, rest, back, easeOutCubic(t / 0.35));
        if (t < 0.55) return mix(out, back, fwd, (t - 0.35) / 0.2);
        return mix(out, fwd, rest, easeOutCubic((t - 0.55) / 0.45));
      }
      case 'use': {
        const k = t < 0.3 ? easeOutCubic(t / 0.3) : t > 0.75 ? 1 - easeOutCubic((t - 0.75) / 0.25) : 1;
        mix(out, rest, P(0.07, -0.17, -0.34, 0.9, -0.6, 0.2), k);
        if (k > 0.95) out.py += Math.sin(this.actionT * 30) * 0.004;
        return out;
      }
      default:
        return mix(out, rest, rest, 0);
    }
  }

  update(dt: number, s: { bobPhase: number; speed01: number; sprint: boolean; onGround: boolean; lookDX: number; lookDY: number; hemiSky: THREE.Color; hemiGround: THREE.Color; key: THREE.Color; keyIntensity: number; light: number }): void {
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
    if (this.current === 'bow') {
      // The drawing hand rides the string back toward the cheek.
      p.pz += this.bowDraw * 0.19;
      p.px -= this.bowDraw * 0.02;
    }
    const sp = this.sprint * (this.action === 'none' ? 1 : 0.3) * (this.current === 'bow' ? 0.3 : 1);
    p.py -= 0.05 * sp;
    p.rx -= 0.35 * sp;
    p.ry += 0.35 * sp;
    mix(this.pose, this.pose, p, 1 - Math.exp(-30 * dt));
    this.setPose(this.pose);

    if (this.current === 'bow') {
      const attr = this.bowString.geometry.attributes.position as THREE.BufferAttribute;
      const nz = 0.06 + this.bowDraw * 0.34;
      attr.setZ(1, nz);
      attr.needsUpdate = true;
      this.bowArrow.position.z = nz;
      this.bowArrow.visible = this.arrowNocked;
      const shown = this.action === 'draw' ? clamp(this.actionT / this.actionDur, 0, 1) : 1;
      this.bowArm.position.y = -0.2 - (1 - easeOutCubic(shown)) * 0.3;
    }

    // Bob follows the feet; a still player sees a still tool.
    const amp = s.onGround ? s.speed01 * (s.sprint ? 1.5 : 1) : 0;
    const bx = Math.sin(s.bobPhase) * 0.012 * amp;
    const by = -Math.abs(Math.cos(s.bobPhase)) * 0.01 * amp;
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.0006, -0.03, 0.03), 10, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.0006, -0.03, 0.03), 10, dt);
    this.root.position.set(bx + this.swayX, by + this.swayY, 0);
    this.root.rotation.set(this.swayY * 0.8, this.swayX * 1.2, 0);

    // Logs ride on the left arm (hidden while the bow needs that hand).
    const showLogs = this.logCount > 0 && this.current !== 'bow';
    this.leftShow = damp(this.leftShow, showLogs ? 1 : 0, 10, dt);
    this.leftArm.visible = this.leftShow > 0.02;
    this.leftArm.position.y = -0.45 - (1 - this.leftShow) * 0.4 + by * 0.8;

    // Flame flicker and the warm light it throws on the hands.
    this.flameT += dt;
    const burning = this.current === 'torch' || this.current === 'flameAxe';
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = 0.1 + Math.sin(this.flameT * (13 + i * 5) + i) * 0.015 + Math.random() * 0.01;
      f.scale.set(k * (i % 2 ? 0.8 : 1), k * 1.4, 1);
    }
    this.fireLight.intensity = burning ? 1.4 + Math.sin(this.flameT * 17) * 0.25 : 0;
  }
}
