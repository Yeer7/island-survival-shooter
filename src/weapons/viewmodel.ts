import * as THREE from 'three';
import { clamp, damp, easeOutCubic, lerp } from '../core/math';
import { HotbarId } from '../player/inventory';
import { buildChocolateBar, buildFirstAidPouch } from '../world/supplies';
import { armMaterials, buildArm, buildArrow, buildAxe, buildBow, buildFish, buildLog, buildTacticalAxe, buildMeat, buildRod, buildSpear, buildTorch } from './models';

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
/** Axe yaw on the handle relative to the arm: with REST.axe's ry this leaves the edge ~15° inward of straight ahead. */
const AXE_TURN = 0.3;

const REST: Record<HotbarId, Pose> = {
  axe: P(0.3, -0.4, -0.6, -0.12, -0.3, -0.08),
  flameAxe: P(0.3, -0.4, -0.6, -0.12, -0.3, -0.08),
  spear: P(0.22, -0.3, -0.36, 0, 0.08, 0.15),
  bow: P(-0.07, -0.22, -0.56, 0.1, 0.35, 1.2),
  torch: P(0.28, -0.34, -0.52, -0.25, -0.2, -0.1),
  rod: P(0.26, -0.34, -0.46, -1.0, -0.15, -0.05),
  flashlight: P(0.22, -0.24, -0.42, 0.02, -0.05, 0),
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
  /** Clock for the idle breathing. */
  private breathT = 0;
  /** Which of the two alternating chops is playing (0 = diagonal, 1 = side). */
  swingVariant = 0;
  private lastSwing = -10;
  private clock = 0;
  /** Hit-stop: the blade stays buried for a moment, trembling, then is wrenched back. */
  private stuckT = 0;
  private wrench = 0;
  /** Forearm drawn from the wrist down to an elbow below the camera (never across the view). */
  private forearm!: THREE.Mesh;
  private cuff!: THREE.Mesh;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
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

    this.rightArm = buildArm(false, true);
    {
      // The right forearm is not rigid with the hand: it runs from the wrist to a fixed
      // elbow low and to the right of the camera, so a chop never swings the sleeve up
      // across the screen.
      const am = armMaterials();
      const fg = new THREE.CylinderGeometry(0.05, 0.066, 1, 10, 1);
      fg.translate(0, -0.5, 0);
      this.forearm = new THREE.Mesh(fg, am.sleeve);
      const cg = new THREE.CylinderGeometry(0.051, 0.051, 0.05, 10);
      this.cuff = new THREE.Mesh(cg, am.cuff);
      this.root.add(this.forearm, this.cuff);
    }
    this.root.add(this.rightArm);

    const axe = buildAxe();
    axe.position.set(0, 0, -0.01);
    // Edge forward (-Z), turned only ~15° inward so the cheek of the head shows a little
    // while the blade is clearly ready to cut ahead.
    axe.rotation.set(-0.3, AXE_TURN, 0.1, 'XZY');
    axe.scale.setScalar(1.0);
    const flameAxe = buildTacticalAxe();
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
    // The same chocolate bar and first-aid pouch as the pickups, held in the palm.
    const pouch = buildFirstAidPouch();
    pouch.scale.setScalar(0.7);
    pouch.rotation.set(0.5, 0.35, 0.15);
    const bandG = new THREE.Group();
    bandG.add(pouch);
    const bar = buildChocolateBar();
    bar.scale.setScalar(0.66);
    bar.rotation.set(0.45, 0.55, 0.2);
    const canG = new THREE.Group();
    canG.add(bar);
    bandG.position.set(-0.03, 0.03, -0.05);
    canG.position.set(-0.045, 0.045, -0.05);

    // Tactical flashlight held forward, lens toward -Z.
    const flashlight = new THREE.Group();
    const fBody = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.17, 12), new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.45, metalness: 0.3 }));
    fBody.rotation.x = Math.PI / 2;
    fBody.position.z = -0.05;
    const fHead = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.021, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.4, metalness: 0.4 }));
    fHead.rotation.x = Math.PI / 2;
    fHead.position.z = -0.15;
    const fLens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0b0, emissiveIntensity: 1.5 }));
    fLens.position.z = -0.176;
    fLens.rotation.y = Math.PI;
    flashlight.add(fBody, fHead, fLens);
    flashlight.position.set(-0.01, 0.0, -0.02);

    this.tools = {
      flashlight,
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

    // Flames for the torch (the only burning tool).
    const ftex = flameTexture();
    for (const host of [torch]) {
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
      [-0.1, 0.29, -0.06],
    ];
    for (let i = 0; i < 4; i++) {
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
    // Chopping on in a rhythm alternates the diagonal chop and the side chop.
    this.swingVariant = this.clock - this.lastSwing < duration + 0.45 ? 1 - this.swingVariant : 0;
    this.lastSwing = this.clock;
    this.start('swing', duration);
  }

  /** The blow landed: bury the blade for a beat with a tremor, then wrench it back. */
  onImpact(heavy: boolean): void {
    this.stuckT = heavy ? 0.06 : 0.045;
    this.wrench = 1;
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

  /** Stretch the sleeve from the wrist to the elbow anchor below and right of the camera. */
  private updateForearm(): void {
    const show = this.rightArm.visible && this.current !== 'bow';
    this.forearm.visible = this.cuff.visible = show;
    if (!show) return;
    this.rightArm.updateMatrix();
    const wrist = this.v1.set(0, -0.012, 0.12).applyMatrix4(this.rightArm.matrix);
    const elbow = this.v2.set(0.4, -0.78, 0.12);
    const dir = elbow.clone().sub(wrist);
    const len = dir.length();
    dir.normalize();
    // The cylinder hangs from its top (the wrist) down along -Y; point -Y at the elbow.
    this.q1.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this.forearm.position.copy(wrist);
    this.forearm.quaternion.copy(this.q1);
    this.forearm.scale.set(1, len, 1);
    this.cuff.position.copy(wrist).addScaledVector(dir, 0.015);
    this.cuff.quaternion.copy(this.q1);
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
        const side = this.swingVariant === 1;
        // A: diagonal chop, high right to centre-left. B: flatter side chop, right to centre.
        const windup = side
          ? P(rest.px + 0.03, rest.py + 0.07, rest.pz + 0.06, rest.rx + 0.18, rest.ry - 0.35, rest.rz - 0.5)
          : P(rest.px + 0.03, rest.py + 0.17, rest.pz + 0.07, rest.rx + 0.38, rest.ry - 0.22, rest.rz - 0.2);
        const strike = side
          ? P(rest.px - 0.19, rest.py + 0.01, rest.pz - 0.18, rest.rx - 0.25, rest.ry + 0.5, rest.rz - 0.45)
          : P(rest.px - 0.17, rest.py - 0.02, rest.pz - 0.2, rest.rx - 0.5, rest.ry + 0.3, rest.rz + 0.55);
        // Follow-through: a little further, pulled back as the blade is freed.
        const follow = P(strike.px - 0.03, strike.py - 0.035, strike.pz + 0.035, strike.rx - 0.08, strike.ry + 0.06, strike.rz + (side ? 0.04 : 0.08));
        // The strike lands by 0.40 so the blade is fully through when the blow resolves
        // (impactAt 0.42) and the hit-stop buries it.
        if (t < 0.28) {
          // Heavy lift: slow to start, settling into the top of the arc.
          const k = t / 0.28;
          return mix(out, rest, windup, k * k * (3 - 2 * k));
        }
        if (t < 0.4) {
          // Explosive arc down through the crosshair.
          const k = (t - 0.28) / 0.12;
          return mix(out, windup, strike, k * k * k);
        }
        if (t < 0.54) return mix(out, strike, follow, easeOutCubic((t - 0.4) / 0.14));
        const k = (t - 0.54) / 0.46;
        const e = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.07;
        return mix(out, follow, rest, e);
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

    this.clock += dt;
    if (this.action !== 'none') {
      // While the blade is stuck in the wood the motion holds.
      if (this.stuckT > 0) this.stuckT -= dt;
      else this.actionT += dt;
      if (this.actionT >= this.actionDur) this.action = 'none';
    }
    this.wrench = Math.max(0, this.wrench - dt * 5);

    const rest = REST[this.current];
    this.sprint = damp(this.sprint, s.sprint ? 1 : 0, 8, dt);
    const p = this.actionPose(rest, this.tmpPose);
    if (this.current === 'bow') {
      // The drawing hand rides the string back toward the cheek.
      p.pz += this.bowDraw * 0.19;
      p.px -= this.bowDraw * 0.02;
    }
    const sp = this.sprint * (this.action === 'none' ? 1 : 0.3) * (this.current === 'bow' ? 0.3 : 1);
    // Sprinting: the tool drops and crosses a little toward the centre.
    p.py -= 0.06 * sp;
    p.px -= 0.035 * sp;
    p.rx -= 0.4 * sp;
    p.ry += 0.38 * sp;
    p.rz += 0.12 * sp;
    // Breathing: never a statue, even standing still (damped during an action).
    this.breathT += dt;
    const calm = this.action === 'none' ? 1 : 0.25;
    const bt = this.breathT;
    p.py += Math.sin(bt * 1.8) * 0.0045 * calm;
    p.px += Math.cos(bt * 0.9) * 0.0025 * calm;
    p.rx += Math.sin(bt * 1.8 + 0.6) * 0.012 * calm;
    p.rz += Math.cos(bt * 0.9) * 0.014 * calm;
    // Tremor while stuck, then the pull-back as it comes free.
    if (this.stuckT > 0) {
      p.px += (Math.random() - 0.5) * 0.007;
      p.py += (Math.random() - 0.5) * 0.007;
      p.rz += (Math.random() - 0.5) * 0.05;
    } else if (this.wrench > 0) {
      p.pz += 0.035 * this.wrench;
      p.py += 0.012 * this.wrench;
      p.rx += 0.1 * this.wrench;
    }
    // A chop is applied as animated (no smoothing to swallow the snap); everything else
    // eases in.
    if (this.action === 'swing') Object.assign(this.pose, p);
    else mix(this.pose, this.pose, p, 1 - Math.exp(-30 * dt));
    this.setPose(this.pose);
    this.updateForearm();

    if (this.current === 'bow') {
      const attr = this.bowString.geometry.attributes.position as THREE.BufferAttribute;
      const nz = 0.06 + this.bowDraw * 0.34;
      attr.setZ(1, nz);
      attr.needsUpdate = true;
      this.bowArrow.position.z = nz;
      this.bowArrow.visible = this.arrowNocked;
      const shown = this.action === 'draw' ? clamp(this.actionT / this.actionDur, 0, 1) : 1;
      this.bowArm.position.y = -0.2 - (1 - easeOutCubic(shown)) * 0.3;
      // The whole bow eases back toward the eye as it is drawn (and cants a touch).
      this.bowArm.position.z = -0.62 + this.bowDraw * 0.07;
      this.bowArm.rotation.z = this.bowDraw * 0.06;
    }

    // Bob follows the feet; a still player sees a still tool.
    // Walk bob: a soft figure of eight in step with the feet; sprinting swings harder.
    const amp = s.onGround ? s.speed01 * (s.sprint ? 1.7 : 1) : 0;
    const bx = Math.sin(s.bobPhase) * 0.016 * amp;
    const by = Math.sin(s.bobPhase * 2) * 0.0075 * amp - 0.004 * amp;
    const roll = Math.sin(s.bobPhase) * 0.035 * amp;
    this.swayX = damp(this.swayX, clamp(-s.lookDX * 0.0006, -0.03, 0.03), 10, dt);
    this.swayY = damp(this.swayY, clamp(s.lookDY * 0.0006, -0.03, 0.03), 10, dt);
    this.root.position.set(bx + this.swayX, by + this.swayY, 0);
    this.root.rotation.set(this.swayY * 0.8 + Math.cos(s.bobPhase * 2) * 0.012 * amp, this.swayX * 1.2, roll);

    // Logs ride on the left arm (hidden while the bow needs that hand).
    const showLogs = this.logCount > 0 && this.current !== 'bow';
    this.leftShow = damp(this.leftShow, showLogs ? 1 : 0, 10, dt);
    this.leftArm.visible = this.leftShow > 0.02;
    this.leftArm.position.y = -0.45 - (1 - this.leftShow) * 0.4 + by * 0.8;

    // Flame flicker and the warm light it throws on the hands.
    this.flameT += dt;
    const burning = this.current === 'torch';
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = 0.1 + Math.sin(this.flameT * (13 + i * 5) + i) * 0.015 + Math.random() * 0.01;
      f.scale.set(k * (i % 2 ? 0.8 : 1), k * 1.4, 1);
    }
    this.fireLight.intensity = burning ? 1.4 + Math.sin(this.flameT * 17) * 0.25 : 0;
  }
}
