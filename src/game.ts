import * as THREE from 'three';
import { SoundEngine } from './audio/soundEngine';
import { Input } from './core/input';
import { clamp, smoothstep } from './core/math';
import { Debris } from './fx/particles';
import { PlayerController } from './player/controller';
import { Inventory, MAG_SIZE, MAX_LOGS, SLOTS, SlotId, Vitals } from './player/inventory';
import { Hud } from './ui/hud';
import { Axe, CombatWorld, Pistol } from './weapons/tools';
import { ViewModel } from './weapons/viewmodel';
import { ColliderGrid } from './world/colliders';
import { CrashSite, Dock } from './world/landmarks';
import { ITEM_LABEL, ItemType, Pickup, PickupManager } from './world/pickups';
import { DayNight } from './world/sky';
import { LAKE_CENTER, LAKE_LEVEL, LAKE_RADIUS, Terrain } from './world/terrain';
import { Forest, Props, Tree, windUniform } from './world/vegetation';
import { Water } from './world/water';

type HitKind = 'tree' | 'case' | 'terrain' | 'water' | 'hard';
interface RayHit {
  kind: HitKind;
  t: number;
  index: number;
  metal: boolean;
}

const PIXEL_BUDGET = 2.4e6;

export class Game implements CombatWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly sound = new SoundEngine();
  readonly terrain: Terrain;
  readonly water: Water;
  readonly sky: DayNight;
  readonly colliders = new ColliderGrid();
  readonly crash: CrashSite;
  readonly dock: Dock;
  readonly forest: Forest;
  readonly props: Props;
  readonly pickups = new PickupManager();
  readonly debris = new Debris();
  readonly player: PlayerController;
  readonly vm: ViewModel;
  readonly inv = new Inventory();
  readonly vitals = new Vitals();
  readonly axe: Axe;
  readonly pistol: Pistol;
  readonly hud: Hud;
  private muzzleLight: THREE.PointLight;
  private muzzleT = 0;
  private time = 0;
  private playing = false;
  private started = false;
  private fadeIn = 1;
  private deathT = 0;
  private pendingUse: { slot: SlotId; t: number } | null = null;
  private clock = new THREE.Clock();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private showFps = new URLSearchParams(location.search).has('fps');
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private lookTree = -1;
  private lookCase = -1;
  private moonGlint = new THREE.Color(0x9fb8e8);
  frameMs = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.15, 1400);
    this.scene.add(this.camera);
    this.input = new Input(canvas);

    this.terrain = new Terrain(1337);
    this.scene.add(this.terrain.mesh);
    this.water = new Water(this.terrain.heightTexture, LAKE_LEVEL, LAKE_CENTER, LAKE_RADIUS);
    this.scene.add(this.water.ocean, this.water.lake);
    this.sky = new DayNight(this.scene);

    this.crash = new CrashSite(this.terrain, this.colliders);
    this.scene.add(this.crash.group, this.crash.fireLight);
    for (const s of this.crash.suitcases) this.scene.add(s.mesh);
    for (const e of [...this.crash.smoke, ...this.crash.fire]) this.scene.add(e.points);

    this.dock = new Dock(this.terrain, this.crash.center);
    this.scene.add(this.dock.group);

    const exclusions = [
      { x: this.crash.center.x, z: this.crash.center.z, r: 32 },
      { x: this.dock.start.x, z: this.dock.start.z, r: 7 },
    ];
    this.forest = new Forest(this.terrain, this.colliders, exclusions, {
      onFallStart: (t) => this.onTreeFallStart(t),
      onLanded: (t, d) => this.onTreeLanded(t, d),
      onSettled: (t, d) => this.onTreeSettled(t, d),
    });
    this.scene.add(this.forest.group);
    this.props = new Props(this.terrain, this.colliders, exclusions, this.forest);
    this.scene.add(this.props.group);
    this.props.smallRocks.forEach((r, i) => this.pickups.addRock(i, r.x, r.y, r.z));
    this.pickups.add('pistol', this.crash.pistolPos, 1);
    this.scene.add(this.pickups.group, this.debris.mesh);

    this.muzzleLight = new THREE.PointLight(0xffc27a, 0, 14, 2);
    this.scene.add(this.muzzleLight);

    this.player = new PlayerController(this.camera, this.terrain, this.colliders, this.dock, {
      onStep: (s, sprint) => this.sound.footstep(s, sprint),
      onLand: (v) => this.onLand(v),
    });
    this.player.teleport(this.crash.spawn.x, this.crash.spawn.z, this.crash.spawnYaw);
    this.player.wake = 0;

    this.vm = new ViewModel(innerWidth / innerHeight);
    this.axe = new Axe(this.vm, this, this.sound);
    this.pistol = new Pistol(this.vm, this, this.sound, this.inv);

    this.hud = new Hud([
      { name: 'Avião', cls: 'plane', x: this.crash.center.x, z: this.crash.center.z },
      { name: 'Lago', cls: 'lake', x: LAKE_CENTER.x, z: LAKE_CENTER.z },
    ]);
    this.hud.setFade(1);

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.warmUp();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Compile every shader variant before play so nothing hitches on first use. */
  private warmUp(): void {
    const warm = this.forest.makeWarmupObject();
    warm.position.set(this.crash.center.x, -40, this.crash.center.z);
    this.scene.add(warm);
    this.vm.equip('pistol');
    this.vm.fire();
    this.player.update(0, this.input, false);
    this.sky.update(0, 0, this.camera, this.player.pos);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.vm.scene, this.vm.camera);
    this.scene.remove(warm);
    this.vm.equip('axe');
  }

  private onResize(): void {
    const w = innerWidth;
    const h = innerHeight;
    const ratio = clamp(Math.sqrt(PIXEL_BUDGET / (w * h)), 0.75, Math.min(devicePixelRatio, 2));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.setAspect(w / h);
    for (const e of [...this.crash.smoke, ...this.crash.fire]) e.setViewportHeight(h * ratio);
  }

  setPlaying(on: boolean): void {
    this.playing = on;
    this.input.locked = on;
    this.hud.show(on || this.started);
    if (on && !this.started) {
      this.started = true;
      this.sound.start();
      this.hud.message('ILHA DESCONHECIDA', 'Você sobreviveu à queda. Quebre as malas com o machado e procure a pistola perto da cabine.', 7);
    } else if (on) {
      this.sound.start();
    }
  }

  // ---------------------------------------------------------------- frame

  private frame(): void {
    const t0 = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.playing) this.tick(dt);
    else this.player.update(0, this.input, false);
    this.render();
    this.input.endFrame();
    this.frameMs = performance.now() - t0;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      if (this.showFps) this.hud.setFps(`${Math.round(this.fpsFrames / this.fpsAcc)} fps · ${this.renderer.info.render.calls} draws`);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  private tick(dt: number): void {
    this.time += dt;
    const alive = !this.vitals.dead;
    this.handleInput(alive);

    this.player.carrySlow = 1 - this.inv.logs * 0.06;
    this.player.update(dt, this.input, alive);
    this.vitals.update(dt, this.player.sprinting);
    this.axe.update(dt);
    this.pistol.update(dt);
    this.updatePendingUse(dt);

    this.sky.update(dt, this.time, this.camera, this.player.pos);
    windUniform.value = this.time;
    this.forest.update(dt);
    this.debris.update(dt);
    this.crash.update(dt, this.sky.ambient);
    this.pickups.update(this.time);
    // Sun glint by day, a silver moon path on the sea at night.
    if (this.sky.night > 0.5) this.water.update(this.time, this.sky.moonDir, this.moonGlint, 0.9, this.sky.horizon, this.sky.ambient);
    else this.water.update(this.time, this.sky.sunDir, this.sky.sunColor, this.sky.daylight * 2.2, this.sky.horizon, this.sky.ambient);

    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      this.muzzleLight.intensity = this.muzzleT > 0 ? 40 : 0;
    }

    this.updateTargets();
    this.updateAudio();
    this.updateHud(dt);
    this.updateDeath(dt);

    this.vm.update(dt, {
      bobPhase: this.player.bobPhase,
      speed01: this.player.speed01,
      sprint: this.player.sprinting,
      onGround: this.player.onGround,
      lookDX: this.player.lookDX,
      lookDY: this.player.lookDY,
      hemiSky: this.sky.hemi.color,
      hemiGround: this.sky.hemi.groundColor,
      key: this.sky.key.color,
      keyIntensity: this.sky.key.intensity,
      light: this.sky.hemi.intensity,
    });
  }

  private render(): void {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.started) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }

  // ---------------------------------------------------------------- input

  private select(i: number): void {
    const s = SLOTS[i];
    if (!this.inv.available(s.id)) {
      this.sound.denied();
      this.hud.toast(s.id === 'pistol' ? 'Você ainda não achou a pistola' : `Sem ${s.label.toLowerCase()}`);
      return;
    }
    if (this.inv.selected === i) return;
    this.inv.selected = i;
    this.axe.cancel();
    this.pistol.cancel();
    this.pendingUse = null;
    this.vm.equip(s.id);
  }

  private handleInput(alive: boolean): void {
    const inp = this.input;
    if (!alive || this.player.wake < 1) {
      inp.consumeClick();
      return;
    }
    for (let i = 0; i < SLOTS.length; i++) if (inp.justPressed(`Digit${i + 1}`)) this.select(i);
    if (inp.wheel !== 0) {
      for (let k = 1; k <= SLOTS.length; k++) {
        const j = (this.inv.selected + inp.wheel * k + SLOTS.length * 10) % SLOTS.length;
        if (this.inv.available(SLOTS[j].id)) {
          this.select(j);
          break;
        }
      }
    }
    // Consumables that ran out fall back to the axe.
    if (!this.inv.available(this.inv.slot) && !this.pendingUse) this.select(0);

    const click = inp.consumeClick();
    switch (this.inv.slot) {
      case 'axe':
        if (inp.mouseDown && this.axe.ready && !this.vm.busy) this.axe.use();
        break;
      case 'pistol':
        if (click) this.pistol.trigger();
        if (inp.justPressed('KeyR')) this.pistol.reload();
        break;
      case 'food':
        if (click) this.tryUse('food');
        break;
      case 'bandage':
        if (click) this.tryUse('bandage');
        break;
      case 'cloth':
        if (click) this.hud.toast('🧵 Pano: material para criação (em breve)');
        break;
    }

    if (inp.justPressed('KeyE')) this.interact();
    if (inp.justPressed('KeyG')) this.dropLog();
    if (inp.justPressed('F3')) this.showFps = !this.showFps;
    if (!this.showFps) this.hud.setFps('');
  }

  private tryUse(slot: 'food' | 'bandage'): void {
    if (this.pendingUse || this.vm.busy) return;
    if (slot === 'food' && this.vitals.hunger > 97) {
      this.hud.toast('Você não está com fome');
      return;
    }
    if (slot === 'bandage' && this.vitals.health > 97) {
      this.hud.toast('Sua vida está cheia');
      return;
    }
    const dur = slot === 'food' ? 0.95 : 1.15;
    this.vm.use(dur);
    this.pendingUse = { slot, t: dur * 0.65 };
    if (slot === 'food') this.sound.eat();
    else this.sound.bandage();
  }

  private updatePendingUse(dt: number): void {
    if (!this.pendingUse) return;
    this.pendingUse.t -= dt;
    if (this.pendingUse.t > 0) return;
    if (this.pendingUse.slot === 'food' && this.inv.food > 0) {
      this.inv.food--;
      this.vitals.hunger = Math.min(100, this.vitals.hunger + 35);
      this.hud.toast('🥫 +35 Fome');
    } else if (this.pendingUse.slot === 'bandage' && this.inv.bandage > 0) {
      this.inv.bandage--;
      this.vitals.health = Math.min(100, this.vitals.health + 40);
      this.hud.toast('🩹 +40 Vida');
    }
    this.pendingUse = null;
  }

  private interact(): void {
    const p = this.pickups.highlighted;
    if (!p) return;
    this.collect(p);
  }

  private collect(p: Pickup): void {
    const inv = this.inv;
    switch (p.type) {
      case 'log':
        if (inv.logs >= MAX_LOGS) {
          this.sound.denied();
          this.hud.toast(`Braços cheios (${MAX_LOGS}/${MAX_LOGS}) — [G] solta`);
          return;
        }
        inv.logs++;
        this.vm.setLogs(inv.logs);
        break;
      case 'food':
        inv.food += p.amount;
        break;
      case 'bandage':
        inv.bandage += p.amount;
        break;
      case 'cloth':
        inv.cloth += p.amount;
        break;
      case 'ammo':
        inv.reserve += p.amount;
        break;
      case 'rock':
        inv.rocks += 1;
        this.props.hideSmallRock(p.rockIndex);
        break;
      case 'pistol':
        inv.hasPistol = true;
        inv.mag = MAG_SIZE;
        this.select(1);
        this.hud.message('PISTOLA DO PILOTO', `${MAG_SIZE} balas no pente. [2] equipa, [R] recarrega.`, 4.5);
        break;
    }
    this.sound.pickup();
    const amount = p.type === 'ammo' ? ` ×${p.amount}` : '';
    this.hud.toast(`+ ${ITEM_LABEL[p.type]}${amount}`);
    this.pickups.remove(p);
  }

  private dropLog(): void {
    if (this.inv.logs <= 0) return;
    this.inv.logs--;
    this.vm.setLogs(this.inv.logs);
    const f = this.player.forward;
    const x = this.player.pos.x + f.x * 1.5;
    const z = this.player.pos.z + f.z * 1.5;
    this.pickups.add('log', this.v1.set(x, this.groundY(x, z), z), 1, this.player.yaw);
    this.sound.dropLog();
  }

  private groundY(x: number, z: number): number {
    const d = this.dock.groundAt(x, z);
    return Math.max(this.terrain.height(x, z), d ?? -Infinity);
  }

  // ---------------------------------------------------------------- combat

  kick(pitch: number, yaw: number, trauma: number): void {
    this.player.addRecoil(pitch * 0.55, yaw * 0.5);
    this.player.addTrauma(trauma);
  }

  /** Ray against trunks, luggage, hard props, terrain and water. */
  private raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate: number): RayHit | null {
    let best: RayHit | null = null;
    const tree = this.forest.raycast(o, d, maxDist, inflate);
    if (tree) best = { kind: 'tree', t: tree.t, index: tree.tree, metal: false };
    const c = this.crash.raycastCases(o, d, best ? best.t : maxDist, inflate * 0.6);
    if (c) best = { kind: 'case', t: c.t, index: c.index, metal: false };

    // Rocks and the wreck.
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-6) {
      for (const col of this.colliders.all) {
        if (!col.active || (col.kind !== 'plane' && col.kind !== 'rock')) continue;
        const ox = o.x - col.x;
        const oz = o.z - col.z;
        const lim = (best ? best.t : maxDist) + col.r;
        if (ox * ox + oz * oz > lim * lim) continue;
        const b = 2 * (ox * d.x + oz * d.z);
        const cc = ox * ox + oz * oz - col.r * col.r;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) continue;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t < 0 || t > (best ? best.t : maxDist)) continue;
        const y = o.y + d.y * t;
        if (y < col.y0 || y > col.y1) continue;
        best = { kind: 'hard', t, index: 0, metal: col.kind === 'plane' };
      }
    }

    // Terrain and water by marching the heightfield.
    const limit = best ? best.t : maxDist;
    const step = 0.35;
    let prevT = 0;
    for (let t = step; t <= limit; t += step) {
      const px = o.x + d.x * t;
      const py = o.y + d.y * t;
      const pz = o.z + d.z * t;
      const h = this.terrain.height(px, pz);
      const wl = this.terrain.waterLevelAt(px, pz);
      if (py < wl && h < wl - 0.05) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m < wl) hi = m;
          else lo = m;
        }
        return { kind: 'water', t: hi, index: 0, metal: false };
      }
      if (py < h) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          if (o.y + d.y * m < this.terrain.height(o.x + d.x * m, o.z + d.z * m)) hi = m;
          else lo = m;
        }
        return { kind: 'terrain', t: hi, index: 0, metal: false };
      }
      prevT = t;
    }
    return best;
  }

  axeImpact(): void {
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    const hit = this.raycast(o, d, 2.7, 0.35);
    if (!hit) return;
    const p = this.v1.copy(o).addScaledVector(d, hit.t);
    const n = this.v3.copy(d).negate().setY(0.3).normalize();
    const floor = this.terrain.height(p.x, p.z) + 0.02;
    switch (hit.kind) {
      case 'tree': {
        const tree = this.forest.trees[hit.index];
        const felled = this.forest.damage(hit.index, 25, this.player.pos);
        this.debris.burst(p, n, 12, 0xdcb98a, { speed: 3.2, size: 0.07, floor });
        this.debris.burst(p, n, 4, 0x5a3d26, { speed: 2.5, size: 0.09, floor });
        this.sound.chopWood();
        this.hud.showTargetHealth(tree.hp / tree.maxHp);
        this.player.addTrauma(felled ? 0.25 : 0.14);
        break;
      }
      case 'case':
        this.hitCase(hit.index, 25, p, n);
        this.player.addTrauma(0.12);
        break;
      case 'hard':
        this.debris.burst(p, n, 8, hit.metal ? 0xffd27a : 0x8c8a85, { speed: 3, size: 0.03, floor, life: hit.metal ? 0.35 : 0.8 });
        this.sound.impact(hit.metal ? 'metal' : 'rock');
        this.player.addTrauma(0.18);
        break;
      case 'terrain': {
        const s = this.terrain.surfaceAt(p.x, p.z);
        this.debris.burst(p, n, 10, s === 'sand' ? 0xd8c391 : s === 'rock' ? 0x8c8a85 : 0x5f7a3a, { speed: 2.4, size: 0.05, floor });
        this.sound.impact(s);
        this.player.addTrauma(0.08);
        break;
      }
      case 'water':
        this.debris.burst(p, this.v3.set(0, 1, 0), 10, 0xdff3ff, { speed: 2.5, size: 0.05, life: 0.6 });
        this.sound.impact('water');
        break;
    }
  }

  fireBullet(): void {
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    d.x += (Math.random() - 0.5) * 0.006;
    d.y += (Math.random() - 0.5) * 0.006;
    d.normalize();
    this.muzzleT = 0.045;
    this.muzzleLight.position.copy(o).addScaledVector(d, 0.8);
    this.muzzleLight.intensity = 40;
    const hit = this.raycast(o, d, 220, 0);
    if (!hit) return;
    const p = this.v1.copy(o).addScaledVector(d, hit.t);
    const n = this.v3.copy(d).negate().normalize();
    const floor = this.terrain.height(p.x, p.z) + 0.02;
    switch (hit.kind) {
      case 'tree': {
        const tree = this.forest.trees[hit.index];
        this.forest.damage(hit.index, 8, this.player.pos);
        this.debris.burst(p, n, 9, 0xdcb98a, { speed: 3.5, size: 0.05, floor });
        this.sound.impact('wood');
        this.hud.showTargetHealth(tree.hp / tree.maxHp);
        this.hud.hitMarker();
        break;
      }
      case 'case':
        this.hitCase(hit.index, 25, p, n);
        this.hud.hitMarker();
        break;
      case 'hard':
        this.debris.burst(p, n, 10, hit.metal ? 0xffd27a : 0x9a968f, { speed: 5, size: 0.03, floor, life: hit.metal ? 0.3 : 0.9 });
        this.sound.impact(hit.metal ? 'metal' : 'rock');
        break;
      case 'terrain': {
        const s = this.terrain.surfaceAt(p.x, p.z);
        this.debris.burst(p, n.setY(Math.abs(n.y) + 0.5).normalize(), 12, s === 'sand' ? 0xd8c391 : s === 'rock' ? 0x8c8a85 : 0x6b5a3a, { speed: 3.5, size: 0.045, floor });
        break;
      }
      case 'water':
        this.debris.burst(p, this.v3.set(0, 1, 0), 14, 0xe6f6ff, { speed: 3.5, size: 0.05, life: 0.7, spread: 0.4 });
        break;
    }
  }

  private hitCase(i: number, dmg: number, p: THREE.Vector3, n: THREE.Vector3): void {
    const s = this.crash.suitcases[i];
    if (s.broken) return;
    s.hp -= dmg;
    this.debris.burst(p, n, 6, s.color, { speed: 2.5, size: 0.06, floor: s.pos.y - 0.1 });
    this.hud.showTargetHealth(s.hp / 50);
    if (s.hp > 0) {
      this.sound.hitSoft();
      s.mesh.rotation.y += (Math.random() - 0.5) * 0.3;
      return;
    }
    s.broken = true;
    this.scene.remove(s.mesh);
    this.sound.breakCase();
    this.debris.burst(s.pos, this.v3.set(0, 1, 0), 22, s.color, { speed: 3.5, size: 0.1, floor: s.pos.y - 0.1 });
    this.debris.burst(s.pos, this.v3.set(0, 1, 0), 10, 0xe8e2d2, { speed: 2.5, size: 0.08, floor: s.pos.y - 0.1 });
    s.contents.forEach((type: ItemType, k) => {
      const a = (k / s.contents.length) * Math.PI * 2 + Math.random();
      const x = s.pos.x + Math.cos(a) * 0.45;
      const z = s.pos.z + Math.sin(a) * 0.45;
      this.pickups.add(type, this.v1.set(x, this.terrain.height(x, z), z), type === 'ammo' ? 6 : 1);
    });
    this.hud.toast('🧳 Mala aberta');
  }

  private onTreeFallStart(_t: Tree): void {
    this.sound.treeCreak();
    this.hud.toast('🌲 Madeira!');
  }

  private onTreeLanded(t: Tree, dir: THREE.Vector3): void {
    const tip = this.v1.set(t.x + dir.x * 6 * t.scale, 0, t.z + dir.z * 6 * t.scale);
    tip.y = this.terrain.height(tip.x, tip.z) + 0.5;
    const dist = Math.hypot(t.x - this.player.pos.x, t.z - this.player.pos.z);
    this.sound.treeCrash(dist);
    this.player.addTrauma(0.45 * (1 - smoothstep(4, 30, dist)));
    this.debris.burst(tip, this.v3.set(0, 1, 0), 26, 0x3f6e34, { speed: 4, size: 0.12, floor: tip.y - 0.4, life: 1.4 });
  }

  private onTreeSettled(t: Tree, dir: THREE.Vector3): void {
    const rotY = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const along = (1.8 + i * 2.3) * t.scale;
      const side = (i - 1) * 0.25;
      const x = t.x + dir.x * along + dir.z * side;
      const z = t.z + dir.z * along - dir.x * side;
      const y = this.groundY(x, z);
      this.pickups.add('log', this.v1.set(x, y, z), 1, rotY + (Math.random() - 0.5) * 0.3);
      this.debris.burst(this.v1.set(x, y + 0.2, z), this.v3.set(0, 1, 0), 8, 0xc2a070, { speed: 2, size: 0.07, floor: y });
    }
    this.hud.toast('🪵 3 toras — [E] para pegar');
  }

  private onLand(speed: number): void {
    if (speed > 15) {
      const dmg = (speed - 15) * 5;
      this.vitals.damage(dmg);
      this.sound.hurt();
      this.player.addTrauma(0.4);
    } else if (speed > 6) {
      this.player.addTrauma(0.1 + (speed - 6) * 0.02);
      this.sound.footstep(this.player.surface, true);
    }
  }

  // ---------------------------------------------------------------- per-frame helpers

  private updateTargets(): void {
    const eye = this.camera.position;
    const fwd = this.camera.getWorldDirection(this.v2);
    const target = this.pickups.findTarget(eye, fwd, this.player.pos);
    this.pickups.highlighted = target;

    this.lookTree = -1;
    this.lookCase = -1;
    if (!target) {
      const tr = this.forest.raycast(eye, fwd, 3.0, 0.3);
      const cs = this.crash.raycastCases(eye, fwd, 3.0, 0.15);
      if (cs && (!tr || cs.t < tr.t)) this.lookCase = cs.index;
      else if (tr) this.lookTree = tr.tree;
    }

    const prompts: { key: string; text: string }[] = [];
    if (target) {
      if (target.type === 'log' && this.inv.logs >= MAX_LOGS) prompts.push({ key: 'E', text: `Braços cheios (${MAX_LOGS}/${MAX_LOGS})` });
      else prompts.push({ key: 'E', text: target.type === 'pistol' ? 'Pegar Pistola do Piloto' : `Coletar ${ITEM_LABEL[target.type]}` });
    } else if (this.lookTree >= 0) {
      prompts.push(this.inv.slot === 'axe' ? { key: 'Clique', text: 'Cortar árvore' } : { key: '1', text: 'Machado para cortar' });
    } else if (this.lookCase >= 0) {
      prompts.push(this.inv.slot === 'axe' ? { key: 'Clique', text: 'Quebrar mala' } : { key: '1', text: 'Machado para abrir a mala' });
    }
    if (this.inv.logs > 0) prompts.push({ key: 'G', text: 'Soltar Tora' });
    if (this.inv.slot === 'pistol' && this.inv.mag < MAG_SIZE && this.inv.reserve > 0 && !this.pistol.isReloading) prompts.push({ key: 'R', text: 'Recarregar' });
    if (this.inv.slot === 'pistol' && this.inv.mag === 0 && this.inv.reserve === 0) prompts.push({ key: '!', text: 'Sem munição — procure nas malas' });
    if ((this.inv.slot === 'food' || this.inv.slot === 'bandage') && !this.pendingUse) prompts.push({ key: 'Clique', text: this.inv.slot === 'food' ? 'Comer' : 'Usar curativo' });
    this.hud.setPrompts(prompts);
  }

  private updateAudio(): void {
    const p = this.player.pos;
    const coast = this.terrain.coastDistance(p.x, p.z);
    const sea = 1 - smoothstep(0, 130, coast);
    const fd = p.distanceTo(this.crash.firePos);
    const fire = 1 - smoothstep(3, 32, fd);
    this.sound.updateAmbience(sea, fire, this.sky.night, p.y);
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    this.hud.updateVitals(this.sky.day, this.sky.clockText, this.vitals.health, this.vitals.hunger);
    const f = this.player.forward;
    const heading = (((Math.atan2(f.x, -f.z) * 180) / Math.PI) + 360) % 360;
    this.hud.updateCompass(heading, this.player.pos.x, this.player.pos.z);
    this.hud.updateInventory(this.inv, this.pistol.isReloading);
    this.hud.setHurt(this.vitals.hurtFlash * 0.9 + (this.vitals.health < 25 ? 0.25 + Math.sin(this.time * 4) * 0.1 : 0));
    if (this.fadeIn > 0 && !this.vitals.dead) {
      this.fadeIn = Math.max(0, this.fadeIn - dt / 2.6);
      this.hud.setFade(this.fadeIn);
    }
  }

  private updateDeath(dt: number): void {
    if (!this.vitals.dead) return;
    this.deathT += dt;
    this.hud.setFade(Math.min(1, this.deathT / 1.5));
    if (this.deathT === dt) this.hud.message('VOCÊ DESMAIOU', 'Acordando de novo perto do avião…', 3);
    if (this.deathT > 2.6) {
      this.deathT = 0;
      this.vitals.dead = false;
      this.vitals.health = 60;
      this.vitals.hunger = Math.max(this.vitals.hunger, 50);
      this.player.teleport(this.crash.spawn.x, this.crash.spawn.z, this.crash.spawnYaw);
      this.player.wake = 0;
      this.fadeIn = 1;
    }
  }
}
