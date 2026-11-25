import * as THREE from 'three';
import { AssetLibrary } from './assets/assets';
import { SoundEngine } from './audio/soundEngine';
import { Input } from './core/input';
import { clamp, smoothstep } from './core/math';
import { Arrows, ArrowHitInfo } from './fx/arrows';
import { Debris } from './fx/particles';
import { PlayerController } from './player/controller';
import { FOOD_EFFECT, FoodId, HOTBAR_INFO, HotbarId, Inventory, MAX_LOGS, ToolId, Vitals } from './player/inventory';
import { CraftMenu, CraftState } from './ui/craftMenu';
import { Hud } from './ui/hud';
import { Bow, CombatWorld, MELEE, Melee, MeleeSpec } from './weapons/tools';
import { ViewModel } from './weapons/viewmodel';
import { Animal, Wildlife } from './world/animals';
import { BaseSite, BuildKind, CABIN_COST, Cost, LEVEL_UP, Placed, Recipe, buildModel, setGhost } from './world/base';
import { ColliderGrid } from './world/colliders';
import { CrashSite, Dock } from './world/landmarks';
import { ITEM_LABEL, ItemType, Pickup, PickupManager } from './world/pickups';
import { DayNight } from './world/sky';
import { LAKE_CENTER, LAKE_LEVEL, LAKE_RADIUS, Terrain } from './world/terrain';
import { Forest, Props, Tree, windUniform } from './world/vegetation';
import { Water } from './world/water';

type HitKind = 'tree' | 'case' | 'animal' | 'terrain' | 'water' | 'hard';
interface RayHit {
  kind: HitKind;
  t: number;
  index: number;
  metal: boolean;
}

interface Interactable {
  key: string;
  text: string;
  run: () => void;
}

const PIXEL_BUDGET = 2.4e6;
const TUTORIAL = [
  'Quebre uma mala perto do avião com o Machado',
  'Corte 1 árvore e pegue 1 tora com [E]',
  'Colete gravetos ou pedras no chão',
  'Siga [Base] na bússola até a cabana e a bancada no lago',
];

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage may be blocked */
    }
  },
};

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
  readonly base: BaseSite;
  readonly forest: Forest;
  readonly props: Props;
  readonly wildlife: Wildlife;
  readonly pickups = new PickupManager();
  readonly debris = new Debris();
  readonly arrows: Arrows;
  readonly player: PlayerController;
  readonly vm: ViewModel;
  readonly inv = new Inventory();
  readonly vitals = new Vitals();
  readonly melee: Melee;
  readonly bow: Bow;
  readonly hud: Hud;
  readonly craft = new CraftMenu();
  /** Fixed pool of real point lights: torch + two campfires (crash fire is separate). */
  private torchLight: THREE.PointLight;
  private campLights: THREE.PointLight[] = [];
  private campAssign: (Placed | null)[] = [null, null];
  private time = 0;
  private playing = false;
  private started = false;
  menuOpen = false;
  private fadeIn = 1;
  private deathT = 0;
  private sleepT = -1;
  private pendingUse: { id: FoodId; t: number } | null = null;
  private placing: { recipe: Recipe; kind: BuildKind; ghost: THREE.Group; yaw: number; valid: boolean; x: number; z: number } | null = null;
  private fishing: { phase: 'cast' | 'wait' | 'bite'; t: number; spot: THREE.Vector3; from: THREE.Vector3; dock: boolean } | null = null;
  private bobber: THREE.Mesh;
  private fishLine: THREE.Line;
  private lastArrowHit: RayHit | null = null;
  private boatBuilt = false;
  private tutorialStep = 0;
  private tutorialDone = store.get('iss.tutorialDone') === '1';
  private flags = { caseBroken: false, logTaken: false, gathered: false };
  private interact: Interactable | null = null;
  private clock = new THREE.Clock();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private showFps = new URLSearchParams(location.search).has('fps');
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private moonGlint = new THREE.Color(0x9fb8e8);
  frameMs = 0;

  constructor(private canvas: HTMLCanvasElement, lib: AssetLibrary) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    this.base = new BaseSite(this.terrain, this.colliders, this.crash.center);
    this.scene.add(this.base.group);

    const exclusions = [
      { x: this.crash.center.x, z: this.crash.center.z, r: 32 },
      { x: this.dock.start.x, z: this.dock.start.z, r: 7 },
      { x: this.base.center.x, z: this.base.center.z, r: 16 },
      { x: this.base.benchPos.x, z: this.base.benchPos.z, r: 9 },
    ];
    this.forest = new Forest(this.terrain, this.colliders, exclusions, {
      onFallStart: (t) => this.onTreeFallStart(t),
      onLanded: (t, d) => this.onTreeLanded(t, d),
      onSettled: (t, d) => this.onTreeSettled(t, d),
    }, lib);
    this.scene.add(this.forest.group);
    this.props = new Props(this.terrain, this.colliders, exclusions, this.forest, lib);
    this.scene.add(this.props.group);
    this.props.smallRocks.forEach((r, i) => this.pickups.addInstanced('rock', i, r.x, r.y, r.z));
    this.props.smallSticks.forEach((r, i) => this.pickups.addInstanced('stick', i, r.x, r.y, r.z));
    this.wildlife = new Wildlife(this.terrain, this.colliders, exclusions, (a) => this.onAnimalDeath(a), lib);
    this.scene.add(this.wildlife.group);
    this.arrows = new Arrows(
      (o, d, max) => {
        const h = this.raycast(o, d, max, 0);
        this.lastArrowHit = h;
        return h ? h.t : null;
      },
      (info) => this.onArrowHit(info),
    );
    this.scene.add(this.pickups.group, this.debris.mesh, this.arrows.group);

    this.torchLight = new THREE.PointLight(0xffa860, 0, 20, 1.5);
    this.scene.add(this.torchLight);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 18, 1.6);
      this.campLights.push(l);
      this.scene.add(l);
    }

    this.bobber = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3b2f, roughness: 0.5, emissive: 0x401010 }));
    this.bobber.visible = false;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.fishLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.7 }));
    this.fishLine.frustumCulled = false;
    this.fishLine.visible = false;
    this.scene.add(this.bobber, this.fishLine);

    this.player = new PlayerController(this.camera, this.terrain, this.colliders, this.dock, {
      onStep: (s, sprint) => this.sound.footstep(s, sprint),
      onLand: (v) => this.onLand(v),
    });
    this.player.teleport(this.crash.spawn.x, this.crash.spawn.z, this.crash.spawnYaw);
    this.player.wake = 0;
    const sens = Number(store.get('iss.sens'));
    if (sens > 0) this.player.sensitivity = sens;

    this.vm = new ViewModel(innerWidth / innerHeight);
    this.melee = new Melee(this.vm, this, this.sound);
    this.bow = new Bow(this.vm, this, this.sound);

    this.hud = new Hud([
      { name: 'Avião', cls: 'plane', x: this.crash.center.x, z: this.crash.center.z },
      { name: 'Base', cls: 'lake', x: this.base.benchPos.x, z: this.base.benchPos.z },
    ]);
    this.hud.setFade(1);
    this.hud.onSkipTutorial = () => this.skipTutorial();

    this.craft.onClose = () => this.closeMenu();
    this.craft.onCraft = (r) => this.doCraft(r);
    this.craft.onUpgrade = (l) => this.doUpgrade(l);
    document.addEventListener('keydown', (e) => {
      if (this.menuOpen && (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Tab')) {
        e.preventDefault();
        this.closeMenu();
      }
    });

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.warmUp();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Compile every shader variant before play so nothing hitches on first use. */
  private warmUp(): void {
    const warm = new THREE.Group();
    warm.add(this.forest.makeWarmupObject());
    for (const k of ['campfire', 'logHolder', 'wall', 'gate'] as BuildKind[]) {
      warm.add(buildModel(k));
      const g = buildModel(k);
      setGhost(g, true);
      warm.add(g);
      const b = buildModel(k);
      setGhost(b, false);
      warm.add(b);
    }
    warm.position.set(this.crash.center.x, -40, this.crash.center.z);
    this.scene.add(warm);
    for (const id of ['torch', 'bow', 'rod', 'spear', 'flameAxe'] as HotbarId[]) this.vm.equip(id);
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
    for (const p of this.base.placed) {
      p.fire?.setViewportHeight(h * ratio);
      p.smoke?.setViewportHeight(h * ratio);
    }
  }

  setSensitivity(v: number): void {
    this.player.sensitivity = v;
    store.set('iss.sens', String(v));
  }

  setPlaying(on: boolean): void {
    this.playing = on;
    this.input.locked = on;
    this.hud.show(on || this.started);
    if (on && !this.started) {
      this.started = true;
      this.sound.start();
      this.hud.message('ILHA DESCONHECIDA', 'Você sobreviveu à queda. Quebre as malas com o machado e siga para o lago.', 7);
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
      this.hud.setFps(this.showFps ? `${Math.round(this.fpsFrames / this.fpsAcc)} fps · ${this.renderer.info.render.calls} draws` : '');
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  private tick(dt: number): void {
    this.time += dt;
    const alive = !this.vitals.dead && this.sleepT < 0;
    this.handleInput(alive);

    this.player.carrySlow = 1 - this.inv.logs * 0.06;
    this.player.update(dt, this.input, alive);
    this.vitals.update(dt, this.player.sprinting);
    this.melee.update(dt);
    this.bow.update(dt, alive && this.inv.selected === 'bow' && this.input.mouseDown && !this.placing, this.inv.mats.arrows);
    this.updatePendingUse(dt);
    this.updateFishing(dt);
    this.updatePlacement();

    this.sky.update(dt, this.time, this.camera, this.player.pos);
    windUniform.value = this.time;
    this.forest.update(dt);
    this.debris.update(dt);
    this.arrows.update(dt);
    this.crash.update(dt, this.sky.ambient);
    this.base.update(dt, this.time, this.sky.ambient);
    this.updateCooking(dt);
    this.wildlife.update(dt, this.player.pos, this.player.sprinting || (this.player.moving && !this.input.keys.has('ControlLeft')));
    this.pickups.update(this.time);
    if (this.sky.night > 0.5) this.water.update(this.time, this.sky.moonDir, this.moonGlint, 0.9, this.sky.horizon, this.sky.ambient);
    else this.water.update(this.time, this.sky.sunDir, this.sky.sunColor, this.sky.daylight * 2.2, this.sky.horizon, this.sky.ambient);
    this.updateLights();

    this.updateTargets();
    this.updateTutorial();
    this.updateAudio();
    this.updateHud(dt);
    this.updateDeath(dt);
    this.updateSleep(dt);

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

  private select(id: HotbarId): void {
    if (!this.inv.has(id) || this.inv.selected === id) return;
    this.inv.selected = id;
    this.melee.cancel();
    this.bow.cancel();
    this.pendingUse = null;
    this.stopFishing();
    this.vm.equip(id);
  }

  private handleInput(alive: boolean): void {
    const inp = this.input;
    if (!alive || this.player.wake < 1) {
      inp.consumeClick();
      return;
    }
    const bar = this.inv.hotbar();
    for (let i = 0; i < Math.min(9, bar.length); i++) if (inp.justPressed(`Digit${i + 1}`)) this.select(bar[i]);
    if (inp.wheel !== 0 && !this.placing && bar.length > 1) {
      const cur = Math.max(0, bar.indexOf(this.inv.selected));
      this.select(bar[(cur + inp.wheel + bar.length * 10) % bar.length]);
    }
    if (!this.inv.has(this.inv.selected) && !this.pendingUse) this.select('axe');
    if (inp.justPressed('KeyT') && !this.tutorialDone) this.skipTutorial();
    if (inp.justPressed('F3')) this.showFps = !this.showFps;

    const click = inp.consumeClick();
    if (this.placing) {
      if (inp.justPressed('KeyR')) this.placing.yaw += Math.PI / 4;
      if (inp.justPressed('KeyQ')) this.cancelPlacement();
      else if (click) this.confirmPlacement();
      return;
    }

    const id = this.inv.selected;
    switch (id) {
      case 'axe':
      case 'flameAxe':
      case 'spear':
        if (inp.mouseDown && this.melee.ready && !this.vm.busy) this.melee.use(MELEE[id]);
        break;
      case 'rod':
        if (click) this.useRod();
        break;
      case 'bow':
      case 'torch':
        break;
      default:
        if (click) this.tryEat(id as FoodId);
    }

    if (inp.justPressed('KeyE') && this.interact) this.interact.run();
    if (inp.justPressed('KeyG')) this.dropLog();
  }

  private tryEat(id: FoodId): void {
    if (this.pendingUse || this.vm.busy) return;
    const fx = FOOD_EFFECT[id];
    if (id === 'bandage' && this.vitals.health >= this.vitals.maxHealth - 1) {
      this.hud.toast('Sua vida está cheia');
      return;
    }
    if (id !== 'bandage' && this.vitals.hunger > 97) {
      this.hud.toast('Você não está com fome');
      return;
    }
    const dur = id === 'bandage' ? 1.15 : 0.95;
    this.vm.use(dur);
    this.pendingUse = { id, t: dur * 0.65 };
    if (id === 'bandage') this.sound.bandage();
    else this.sound.eat();
    void fx;
  }

  private updatePendingUse(dt: number): void {
    if (!this.pendingUse) return;
    this.pendingUse.t -= dt;
    if (this.pendingUse.t > 0) return;
    const id = this.pendingUse.id;
    if (this.inv.food[id] > 0) {
      this.inv.food[id]--;
      const fx = FOOD_EFFECT[id];
      this.vitals.hunger = clamp(this.vitals.hunger + fx.hunger, 0, 100);
      if (fx.health > 0) this.vitals.heal(fx.health);
      else if (fx.health < 0) this.vitals.damage(-fx.health);
      this.hud.toast(`${HOTBAR_INFO[id].icon} ${fx.text}`);
    }
    this.pendingUse = null;
  }

  // ---------------------------------------------------------------- interaction

  private collect(p: Pickup): void {
    const inv = this.inv;
    switch (p.type) {
      case 'log':
        if (inv.logs >= MAX_LOGS) {
          this.sound.denied();
          this.hud.toast(`Ombro cheio (${MAX_LOGS}/${MAX_LOGS}) — [G] solta`);
          return;
        }
        inv.logs++;
        this.vm.setLogs(inv.logs);
        this.flags.logTaken = true;
        break;
      case 'food':
        inv.food.food += p.amount;
        break;
      case 'bandage':
        inv.food.bandage += p.amount;
        break;
      case 'meat':
        inv.food.meat += p.amount;
        break;
      case 'cloth':
        inv.mats.cloth += p.amount;
        break;
      case 'hide':
        inv.mats.hide += p.amount;
        break;
      case 'arrow':
        inv.mats.arrows += p.amount;
        break;
      case 'stick':
        inv.mats.sticks += p.amount;
        this.flags.gathered = true;
        if (p.instIndex >= 0) this.props.hideSmallStick(p.instIndex);
        break;
      case 'rock':
        inv.mats.rocks += 1;
        this.flags.gathered = true;
        if (p.instIndex >= 0) this.props.hideSmallRock(p.instIndex);
        break;
    }
    this.sound.pickup();
    this.hud.toast(`+ ${ITEM_LABEL[p.type]}${p.amount > 1 ? ` ×${p.amount}` : ''}`);
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

  /** What [E] does right now, for prompts and for the key itself. */
  private findInteractable(): Interactable | null {
    const target = this.pickups.highlighted;
    if (target) {
      if (target.type === 'log' && this.inv.logs >= MAX_LOGS) return { key: 'E', text: `Ombro cheio (${MAX_LOGS}/${MAX_LOGS})`, run: () => this.collect(target) };
      return { key: 'E', text: `Pegar ${ITEM_LABEL[target.type]}`, run: () => this.collect(target) };
    }
    const p = this.player.pos;
    for (const pl of this.base.placed) {
      const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
      if (pl.kind === 'campfire' && d < 2.4) {
        if (pl.cooking) return { key: 'E', text: `Assando… ${Math.ceil(pl.cooking.t)}s`, run: () => {} };
        const raw: 'meat' | 'fish' | null = this.inv.food.meat > 0 ? 'meat' : this.inv.food.fish > 0 ? 'fish' : null;
        if (raw) return { key: 'E', text: `Assar ${raw === 'meat' ? 'Carne' : 'Peixe'}`, run: () => this.startCooking(pl, raw) };
      }
      if (pl.kind === 'logHolder' && d < 2.4) {
        if (this.inv.logs > 0 && pl.logs < 12) return { key: 'E', text: `Guardar toras (${pl.logs}/12)`, run: () => this.depositLogs(pl) };
        if (pl.logs > 0 && this.inv.logs < MAX_LOGS) return { key: 'E', text: `Pegar tora (${pl.logs}/12)`, run: () => this.takeLog(pl) };
      }
      if (pl.kind === 'gate' && d < 2.8) return { key: 'E', text: pl.open ? 'Fechar portão' : 'Abrir portão', run: () => this.base.toggleGate(pl) };
    }
    const cab = this.base.cabin;
    if (Math.hypot(cab.pos.x - p.x, cab.pos.z - p.z) < 5.2) {
      if (cab.complete) return { key: 'E', text: 'Dormir até 07:00', run: () => this.startSleep() };
      const d = cab.delivered;
      const text = `Entregar (Toras ${d.logs}/${CABIN_COST.logs} · Gravetos ${d.sticks}/${CABIN_COST.sticks} · Pedras ${d.rocks}/${CABIN_COST.rocks})`;
      return { key: 'E', text, run: () => this.deliverCabin() };
    }
    if (Math.hypot(this.base.benchPos.x - p.x, this.base.benchPos.z - p.z) < 2.8) return { key: 'E', text: `Bancada de Criação (Nv ${this.base.benchLevel})`, run: () => this.openMenu() };
    return null;
  }

  private deliverCabin(): void {
    const take = this.base.cabin.deliver({ logs: this.inv.logs, sticks: this.inv.mats.sticks, rocks: this.inv.mats.rocks });
    const n = take.logs + take.sticks + take.rocks;
    if (n === 0) {
      this.sound.denied();
      this.hud.toast('Traga toras (no ombro), gravetos e pedras');
      return;
    }
    this.inv.logs -= take.logs;
    this.inv.mats.sticks -= take.sticks;
    this.inv.mats.rocks -= take.rocks;
    this.vm.setLogs(this.inv.logs);
    this.sound.build();
    this.player.addTrauma(0.08);
    if (this.base.cabin.complete) {
      this.hud.message('CABANA PRONTA', 'Agora você pode dormir [E] para curar e pular a noite.', 5);
      this.sound.levelUp();
    } else {
      this.hud.toast(`🛖 Cabana ${Math.round(this.base.cabin.progress * 100)}%`);
    }
  }

  private startSleep(): void {
    this.sleepT = 0;
    this.sound.sleep();
  }

  private updateSleep(dt: number): void {
    if (this.sleepT < 0) return;
    this.sleepT += dt;
    this.hud.setFade(Math.min(1, this.sleepT / 1.0) * (this.sleepT < 2.2 ? 1 : Math.max(0, 1 - (this.sleepT - 2.2) / 1.2)));
    if (this.sleepT >= 1.1 && this.sleepT - dt < 1.1) {
      this.sky.sleepUntil(7);
      this.vitals.health = this.vitals.maxHealth;
      this.vitals.hunger = Math.max(10, this.vitals.hunger - 20);
      this.hud.message(`DIA ${this.sky.day}`, 'Você dormiu e recuperou toda a vida.', 3.5);
    }
    if (this.sleepT > 3.4) {
      this.sleepT = -1;
      this.hud.setFade(0);
    }
  }

  private depositLogs(pl: Placed): void {
    const n = Math.min(this.inv.logs, 12 - pl.logs);
    this.inv.logs -= n;
    this.base.setHolderLogs(pl, pl.logs + n);
    this.vm.setLogs(this.inv.logs);
    this.sound.dropLog();
  }

  private takeLog(pl: Placed): void {
    this.base.setHolderLogs(pl, pl.logs - 1);
    this.inv.logs++;
    this.vm.setLogs(this.inv.logs);
    this.sound.pickup();
  }

  private startCooking(pl: Placed, item: 'meat' | 'fish'): void {
    this.inv.food[item]--;
    pl.cooking = { item, t: 4 };
    this.sound.sizzle();
    this.hud.toast(item === 'meat' ? '🔥 Assando carne…' : '🔥 Assando peixe…');
  }

  private updateCooking(dt: number): void {
    for (const pl of this.base.placed) {
      if (!pl.cooking) continue;
      pl.cooking.t -= dt;
      if (pl.cooking.t <= 0) {
        const cooked = pl.cooking.item === 'meat' ? 'cookedMeat' : 'cookedFish';
        this.inv.food[cooked]++;
        this.hud.toast(`${HOTBAR_INFO[cooked].icon} ${HOTBAR_INFO[cooked].label} pronto!`);
        this.sound.pickup();
        pl.cooking = null;
      }
    }
  }

  // ---------------------------------------------------------------- crafting

  private resources(): Required<Cost> {
    return {
      logs: this.inv.logs + this.base.storedLogs(this.player.pos),
      sticks: this.inv.mats.sticks,
      rocks: this.inv.mats.rocks,
      cloth: this.inv.mats.cloth,
      hide: this.inv.mats.hide,
    };
  }

  private pay(cost: Cost): void {
    let logs = cost.logs ?? 0;
    const fromShoulder = Math.min(this.inv.logs, logs);
    this.inv.logs -= fromShoulder;
    logs -= fromShoulder;
    if (logs > 0) this.base.takeStoredLogs(this.player.pos, logs);
    this.vm.setLogs(this.inv.logs);
    this.inv.mats.sticks -= cost.sticks ?? 0;
    this.inv.mats.rocks -= cost.rocks ?? 0;
    this.inv.mats.cloth -= cost.cloth ?? 0;
    this.inv.mats.hide -= cost.hide ?? 0;
  }

  private craftState(): CraftState {
    const owned = new Set<string>(this.inv.tools);
    if (this.inv.armor >= 1) owned.add('hideArmor');
    if (this.inv.armor >= 2) owned.add('reinforcedArmor');
    if (this.boatBuilt) owned.add('sailboat');
    return { level: this.base.benchLevel, have: this.resources(), bossItems: { totem: this.inv.mats.totem, relic: this.inv.mats.relic }, owned };
  }

  private openMenu(): void {
    this.menuOpen = true;
    this.craft.open(this.craftState());
    this.setPlaying(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.craft.close();
    this.requestLock();
  }

  /** Main wires this to pointer lock (or to direct play in debug mode). */
  requestLock: () => void = () => this.setPlaying(true);

  private doCraft(r: Recipe): void {
    const have = this.resources();
    if (!CraftMenu.affordable(r.cost, have) || r.level > this.base.benchLevel) return;
    if (r.kind === 'build') {
      this.closeMenu();
      this.startPlacement(r);
      return;
    }
    this.pay(r.cost);
    this.sound.craft();
    switch (r.kind) {
      case 'tool':
        this.inv.tools.add(r.id as ToolId);
        if (r.id === 'bow' && this.inv.mats.arrows === 0) this.inv.mats.arrows = 5;
        this.hud.toast(`${r.icon} ${r.label} criado!`);
        break;
      case 'item':
        this.inv.mats.arrows += 5;
        this.hud.toast('➶ +5 Flechas');
        break;
      case 'armor': {
        const lvl = r.id === 'hideArmor' ? 1 : 2;
        this.inv.armor = Math.max(this.inv.armor, lvl);
        const max = this.inv.armor === 2 ? 200 : 150;
        this.vitals.health += max - this.vitals.maxHealth;
        this.vitals.maxHealth = max;
        this.hud.toast(`${r.icon} ${r.label}: vida máxima ${max}`);
        break;
      }
      case 'boat':
        this.boatBuilt = true;
        this.spawnBoat();
        this.hud.message('VELEIRO DE FUGA', 'O barco está pronto na doca. A fuga chega na próxima fase!', 5);
        break;
    }
    this.craft.render(this.craftState());
  }

  private doUpgrade(level: 2 | 3): void {
    const up = LEVEL_UP[level];
    if (this.base.benchLevel !== level - 1 || this.inv.mats[up.boss] <= 0 || !CraftMenu.affordable(up.cost, this.resources())) return;
    this.pay(up.cost);
    this.inv.mats[up.boss]--;
    this.base.benchLevel = level;
    this.sound.levelUp();
    this.hud.toast(`🛠️ Bancada Nível ${level}!`);
    this.craft.render(this.craftState());
  }

  private spawnBoat(): void {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 4.2), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.85 }));
    hull.position.y = 0.2;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 6), new THREE.MeshStandardMaterial({ color: 0x5a4030 }));
    mast.position.y = 2.3;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.8), new THREE.MeshStandardMaterial({ color: 0xe8e0cc, side: THREE.DoubleSide, roughness: 0.95 }));
    sail.position.set(0, 2.5, 0.6);
    sail.rotation.y = Math.PI / 2;
    g.add(hull, mast, sail);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    g.position.copy(this.dock.end).setY(LAKE_LEVEL);
    g.lookAt(this.dock.start.x, LAKE_LEVEL, this.dock.start.z);
    g.position.x += 1.8;
    this.scene.add(g);
  }

  private startPlacement(r: Recipe): void {
    const kind = r.id as BuildKind;
    const ghost = buildModel(kind);
    setGhost(ghost, true);
    this.scene.add(ghost);
    this.placing = { recipe: r, kind, ghost, yaw: this.player.yaw, valid: false, x: 0, z: 0 };
    this.hud.toast(`${r.icon} Clique para colocar · [R] girar · [Q] cancelar`);
  }

  private updatePlacement(): void {
    const pl = this.placing;
    if (!pl) return;
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    let t = 9;
    for (let s = 0.5; s < 9; s += 0.25) {
      if (o.y + d.y * s < this.terrain.height(o.x + d.x * s, o.z + d.z * s)) {
        t = s;
        break;
      }
    }
    t = Math.max(2.2, t);
    pl.x = o.x + d.x * t;
    pl.z = o.z + d.z * t;
    const valid = this.base.canPlace(pl.kind, pl.x, pl.z) && Math.hypot(pl.x - this.player.pos.x, pl.z - this.player.pos.z) > 1.4;
    if (valid !== pl.valid) {
      pl.valid = valid;
      setGhost(pl.ghost, valid);
    }
    pl.ghost.position.set(pl.x, this.terrain.height(pl.x, pl.z), pl.z);
    pl.ghost.rotation.y = pl.yaw;
  }

  private confirmPlacement(): void {
    const pl = this.placing;
    if (!pl) return;
    if (!pl.valid || !CraftMenu.affordable(pl.recipe.cost, this.resources())) {
      this.sound.denied();
      this.hud.toast(pl.valid ? 'Materiais insuficientes' : 'Lugar inválido');
      return;
    }
    this.pay(pl.recipe.cost);
    const placed = this.base.place(pl.kind, pl.x, pl.z, pl.yaw);
    const ratio = this.renderer.getPixelRatio();
    placed.fire?.setViewportHeight(innerHeight * ratio);
    placed.smoke?.setViewportHeight(innerHeight * ratio);
    this.sound.build();
    this.debris.burst(this.v1.set(pl.x, this.terrain.height(pl.x, pl.z) + 0.2, pl.z), this.v3.set(0, 1, 0), 14, 0xc2a070, { speed: 2.5, size: 0.07, floor: this.terrain.height(pl.x, pl.z) });
    this.hud.toast(`${pl.recipe.icon} ${pl.recipe.label} construído`);
    this.cancelPlacement();
  }

  private cancelPlacement(): void {
    if (!this.placing) return;
    this.scene.remove(this.placing.ghost);
    this.placing = null;
  }

  // ---------------------------------------------------------------- fishing

  private useRod(): void {
    if (this.fishing) {
      this.stopFishing();
      this.hud.toast('Linha recolhida');
      return;
    }
    if (this.vm.busy) return;
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    const hit = this.raycast(o, d, 16, 0);
    if (!hit || hit.kind !== 'water') {
      this.sound.denied();
      this.hud.toast('Mire na água (lago ou mar) para lançar');
      return;
    }
    const spot = o.clone().addScaledVector(d, hit.t);
    const onDock = this.dock.groundAt(this.player.pos.x, this.player.pos.z) !== null;
    this.vm.cast(0.7);
    this.sound.cast();
    this.fishing = { phase: 'cast', t: 0.4, spot, from: this.player.pos.clone(), dock: onDock };
  }

  private stopFishing(): void {
    this.fishing = null;
    this.bobber.visible = false;
    this.fishLine.visible = false;
  }

  private updateFishing(dt: number): void {
    const f = this.fishing;
    if (!f) return;
    if (this.inv.selected !== 'rod' || this.player.pos.distanceTo(f.from) > 5) {
      this.stopFishing();
      return;
    }
    f.t -= dt;
    const wl = this.terrain.waterLevelAt(f.spot.x, f.spot.z);
    let y = wl + Math.sin(this.time * 2.2) * 0.02;
    if (f.phase === 'cast' && f.t <= 0) {
      f.phase = 'wait';
      f.t = (f.dock ? 1.5 : 2.5) + Math.random() * 0.6;
      this.bobber.visible = true;
      this.fishLine.visible = true;
      this.sound.splash();
      this.debris.burst(f.spot, this.v3.set(0, 1, 0), 6, 0xdff3ff, { speed: 1.5, size: 0.04, life: 0.5 });
    } else if (f.phase === 'wait' && f.t <= 0) {
      f.phase = 'bite';
      f.t = 0.55;
      this.sound.splash();
    } else if (f.phase === 'bite') {
      y -= 0.12 + Math.sin(this.time * 30) * 0.03;
      if (f.t <= 0) {
        this.inv.food.fish++;
        this.sound.fishCaught();
        this.debris.burst(f.spot, this.v3.set(0, 1, 0), 12, 0xdff3ff, { speed: 2.5, size: 0.05, life: 0.6 });
        this.hud.toast('🐠 +1 Peixe Cru (asse na fogueira)');
        this.vm.cast(0.6);
        this.stopFishing();
        return;
      }
    }
    if (this.bobber.visible) {
      this.bobber.position.set(f.spot.x, y, f.spot.z);
      const tip = this.vm.rodTipWorld(this.camera, this.v4);
      const a = this.fishLine.geometry.attributes.position as THREE.BufferAttribute;
      a.setXYZ(0, tip.x, tip.y, tip.z);
      a.setXYZ(1, f.spot.x, y + 0.05, f.spot.z);
      a.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- combat

  kick(pitch: number, yaw: number, trauma: number): void {
    this.player.addRecoil(pitch * 0.55, yaw * 0.5);
    this.player.addTrauma(trauma);
  }

  /** Ray against trunks, luggage, animals, hard props, terrain and water. */
  private raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate: number): RayHit | null {
    let best: RayHit | null = null;
    const tree = this.forest.raycast(o, d, maxDist, inflate);
    if (tree) best = { kind: 'tree', t: tree.t, index: tree.tree, metal: false };
    const c = this.crash.raycastCases(o, d, best ? best.t : maxDist, inflate * 0.6);
    if (c) best = { kind: 'case', t: c.t, index: c.index, metal: false };
    const an = this.wildlife.raycast(o, d, best ? best.t : maxDist, inflate * 0.7);
    if (an) best = { kind: 'animal', t: an.t, index: an.index, metal: false };

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
        best = { kind: 'hard', t, index: 0, metal: col.kind === 'plane' && col.ref === 0 };
      }
    }

    const limit = best ? best.t : maxDist;
    const step = 0.35;
    let prevT = 0;
    for (let t = Math.min(step, limit); t <= limit; t += step) {
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

  meleeImpact(spec: MeleeSpec): void {
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    const hit = this.raycast(o, d, spec.reach, spec.kind === 'stab' ? 0.25 : 0.35);
    if (!hit) return;
    const p = this.v1.copy(o).addScaledVector(d, hit.t);
    const n = this.v3.copy(d).negate().setY(0.3).normalize();
    const floor = this.terrain.height(p.x, p.z) + 0.02;
    const flame = this.inv.selected === 'flameAxe';
    switch (hit.kind) {
      case 'tree': {
        const tree = this.forest.trees[hit.index];
        const felled = this.forest.damage(hit.index, spec.tree, this.player.pos);
        this.debris.burst(p, n, spec.kind === 'stab' ? 5 : 12, 0xdcb98a, { speed: 3.2, size: 0.07, floor });
        if (spec.kind === 'swing') this.debris.burst(p, n, 4, flame ? 0xff9a3a : 0x5a3d26, { speed: 2.5, size: 0.09, floor, life: flame ? 0.5 : 1.2 });
        if (spec.kind === 'swing') this.sound.chopWood();
        else this.sound.impact('wood');
        this.hud.showTargetHealth(tree.hp / tree.maxHp);
        this.player.addTrauma(felled ? 0.25 : spec.kind === 'stab' ? 0.06 : 0.14);
        break;
      }
      case 'case':
        this.hitCase(hit.index, spec.luggage, p, n);
        this.player.addTrauma(0.12);
        break;
      case 'animal':
        this.hitAnimal(hit.index, spec.animal, p, n);
        this.player.addTrauma(0.1);
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

  shootArrow(power: number): void {
    if (this.inv.mats.arrows <= 0) return;
    this.inv.mats.arrows--;
    const d = this.camera.getWorldDirection(this.v2).clone();
    const right = this.v3.set(-d.z, 0, d.x).normalize();
    const origin = this.v1.copy(this.camera.position).addScaledVector(right, 0.05).addScaledVector(d, 0.2);
    origin.y -= 0.06;
    this.arrows.fire(origin, d, 22 + power * 34);
    this.kick(0.25 * power, 0, 0.03);
  }

  private onArrowHit(info: ArrowHitInfo): void {
    const hit = this.lastArrowHit;
    const kind = hit ? hit.kind : 'terrain';
    const p = info.point;
    const tip = this.v1.copy(p).addScaledVector(info.dir, 0.62);
    const n = this.v3.copy(info.dir).negate();
    const floor = this.terrain.height(tip.x, tip.z) + 0.02;
    switch (kind) {
      case 'animal':
        this.hitAnimal(hit!.index, 55, tip, n);
        this.sound.arrowHit('flesh');
        this.hud.hitMarker();
        // The arrow drops by the animal and can be recovered.
        this.pickups.addArrow(this.v4.set(tip.x, floor + 0.03, tip.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)));
        break;
      case 'case':
        this.hitCase(hit!.index, 25, tip, n);
        this.sound.arrowHit('wood');
        this.pickups.addArrow(this.v4.set(tip.x, floor + 0.03, tip.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)));
        break;
      case 'water':
        this.debris.burst(tip, this.v4.set(0, 1, 0), 10, 0xe6f6ff, { speed: 2.5, size: 0.05, life: 0.6 });
        this.sound.arrowHit('water');
        break;
      case 'hard':
        this.debris.burst(tip, n, 6, 0xbfb8a8, { speed: 2, size: 0.03, floor });
        this.sound.impact('rock');
        if (Math.random() < 0.6) this.pickups.addArrow(this.v4.set(tip.x, floor + 0.03, tip.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)));
        break;
      default:
        // Trees and ground: the arrow stays stuck where it hit.
        this.debris.burst(tip, n, 5, kind === 'tree' ? 0xdcb98a : 0x8a7a5a, { speed: 1.5, size: 0.03, floor });
        this.sound.arrowHit(kind === 'tree' ? 'wood' : 'ground');
        this.pickups.addArrow(p, info.quat);
        if (kind === 'tree' && hit) {
          const tree = this.forest.trees[hit.index];
          this.forest.damage(hit.index, 4, this.player.pos);
          this.hud.showTargetHealth(tree.hp / tree.maxHp);
        }
        break;
    }
  }

  private hitAnimal(i: number, dmg: number, p: THREE.Vector3, n: THREE.Vector3): void {
    const a = this.wildlife.animals[i];
    const killed = this.wildlife.damage(i, dmg, this.player.pos);
    this.debris.burst(p, n, killed ? 14 : 8, 0x8a1c1c, { speed: 2.5, size: 0.04, floor: a.pos.y + 0.02, life: 0.9 });
    this.sound.animalHurt(a.species === 'deer');
    this.hud.showTargetHealth(Math.max(0, a.hp) / a.cfg.hp);
    this.hud.hitMarker();
    if (killed) this.hud.toast(a.species === 'deer' ? '🦌 Cervo abatido' : '🐇 Coelho abatido');
  }

  private onAnimalDeath(a: Animal): void {
    const n = a.species === 'deer' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = a.pos.x + (Math.random() - 0.5) * 1.2;
      const z = a.pos.z + (Math.random() - 0.5) * 1.2;
      this.pickups.add('meat', this.v4.set(x, this.terrain.height(x, z), z));
      const hx = a.pos.x + (Math.random() - 0.5) * 1.2;
      const hz = a.pos.z + (Math.random() - 0.5) * 1.2;
      this.pickups.add('hide', this.v4.set(hx, this.terrain.height(hx, hz), hz));
    }
    this.debris.burst(this.v4.copy(a.pos).setY(a.pos.y + 0.3), this.v3.set(0, 1, 0), 10, a.species === 'deer' ? 0x8b5a32 : 0x8a7258, { speed: 1.5, size: 0.06, floor: a.pos.y });
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
    this.flags.caseBroken = true;
    this.scene.remove(s.mesh);
    this.sound.breakCase();
    this.debris.burst(s.pos, this.v3.set(0, 1, 0), 22, s.color, { speed: 3.5, size: 0.1, floor: s.pos.y - 0.1 });
    this.debris.burst(s.pos, this.v3.set(0, 1, 0), 10, 0xe8e2d2, { speed: 2.5, size: 0.08, floor: s.pos.y - 0.1 });
    s.contents.forEach((type: ItemType, k) => {
      const a = (k / s.contents.length) * Math.PI * 2 + Math.random();
      const x = s.pos.x + Math.cos(a) * 0.45;
      const z = s.pos.z + Math.sin(a) * 0.45;
      this.pickups.add(type, this.v1.set(x, this.terrain.height(x, z), z), 1);
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
    // Branches come down too.
    const bx = t.x + dir.x * 5 * t.scale + dir.z * 1.2;
    const bz = t.z + dir.z * 5 * t.scale - dir.x * 1.2;
    this.pickups.add('stick', this.v1.set(bx, this.groundY(bx, bz), bz), 2);
    this.hud.toast('🪵 3 toras + gravetos — [E] para pegar');
  }

  private onLand(speed: number): void {
    if (speed > 15) {
      this.vitals.damage((speed - 15) * 5);
      this.sound.hurt();
      this.player.addTrauma(0.4);
    } else if (speed > 6) {
      this.player.addTrauma(0.1 + (speed - 6) * 0.02);
      this.sound.footstep(this.player.surface, true);
    }
  }

  // ---------------------------------------------------------------- per-frame helpers

  private updateLights(): void {
    const t = this.time;
    // Torch: real light carried a little right of and ahead of the eye.
    const burning = this.inv.selected === 'torch' ? 1 : this.inv.selected === 'flameAxe' ? 0.45 : 0;
    if (burning > 0) {
      const d = this.camera.getWorldDirection(this.v2);
      this.torchLight.position.copy(this.camera.position).addScaledVector(d, 0.6);
      this.torchLight.position.x += -d.z * 0.35;
      this.torchLight.position.z += d.x * 0.35;
      this.torchLight.position.y += 0.15;
      this.torchLight.intensity = burning * (16 + Math.sin(t * 17) * 2 + Math.sin(t * 7.3) * 2);
    } else {
      this.torchLight.intensity = 0;
    }
    // Two pooled campfire lights go to the nearest fires (hysteresis keeps them from swapping).
    const fires = this.base.placed.filter((p) => p.kind === 'campfire');
    const p = this.player.pos;
    fires.sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p));
    for (let i = 0; i < 2; i++) {
      const cur = this.campAssign[i];
      const want = fires[i] ?? null;
      if (want !== cur && (!cur || !fires.includes(cur) || cur.pos.distanceTo(p) > want!.pos.distanceTo(p) * 1.3)) {
        if (!this.campAssign.includes(want)) this.campAssign[i] = want;
      }
      const f = this.campAssign[i];
      const l = this.campLights[i];
      if (f && f.pos.distanceTo(p) < 70) {
        l.position.set(f.pos.x, f.pos.y + 1.0, f.pos.z);
        l.intensity = 22 + Math.sin(t * 15 + i) * 3 + Math.sin(t * 6.1 + i * 2) * 3;
      } else {
        l.intensity = 0;
      }
    }
  }

  private updateTargets(): void {
    const eye = this.camera.position;
    const fwd = this.camera.getWorldDirection(this.v2);
    this.pickups.highlighted = this.placing ? null : this.pickups.findTarget(eye, fwd, this.player.pos);
    this.interact = this.placing || this.menuOpen ? null : this.findInteractable();

    const prompts: { key: string; text: string }[] = [];
    const sel = this.inv.selected;
    if (this.placing) {
      prompts.push({ key: 'Clique', text: this.placing.valid ? `Colocar ${this.placing.recipe.label}` : 'Lugar inválido' }, { key: 'R', text: 'Girar' }, { key: 'Q', text: 'Cancelar' });
    } else if (this.interact) {
      prompts.push({ key: this.interact.key, text: this.interact.text });
    } else {
      const tr = this.forest.raycast(eye, fwd, 3.0, 0.3);
      const cs = this.crash.raycastCases(eye, fwd, 3.0, 0.15);
      const chopper = sel === 'axe' || sel === 'flameAxe';
      if (cs && (!tr || cs.t < tr.t)) prompts.push(chopper ? { key: 'Clique', text: 'Quebrar mala' } : { key: '1', text: 'Machado para abrir a mala' });
      else if (tr) prompts.push(chopper ? { key: 'Clique', text: 'Cortar árvore' } : { key: '1', text: 'Machado para cortar' });
    }
    if (this.inv.logs > 0 && !this.placing) prompts.push({ key: 'G', text: 'Soltar Tora' });
    if (sel === 'bow' && this.inv.mats.arrows === 0) prompts.push({ key: '!', text: 'Sem flechas — crie na bancada' });
    if (sel === 'bow' && this.inv.mats.arrows > 0 && !this.placing) prompts.push({ key: 'Segure', text: 'Puxar o arco' });
    if (sel === 'rod' && !this.placing) prompts.push({ key: 'Clique', text: this.fishing ? 'Recolher linha' : 'Lançar na água' });
    if (!this.inv.isTool(sel) && !this.pendingUse && !this.placing) prompts.push({ key: 'Clique', text: sel === 'bandage' ? 'Usar curativo' : 'Comer' });
    this.hud.setPrompts(prompts);
  }

  private skipTutorial(): void {
    this.tutorialDone = true;
    store.set('iss.tutorialDone', '1');
    this.hud.setTutorial(0, 0, null);
  }

  private updateTutorial(): void {
    if (this.tutorialDone) return;
    const done = [
      this.flags.caseBroken,
      this.flags.logTaken,
      this.flags.gathered,
      Math.hypot(this.base.benchPos.x - this.player.pos.x, this.base.benchPos.z - this.player.pos.z) < 12,
    ];
    while (this.tutorialStep < TUTORIAL.length && done[this.tutorialStep]) {
      this.tutorialStep++;
      this.sound.pickup();
    }
    if (this.tutorialStep >= TUTORIAL.length) {
      this.hud.message('TUTORIAL CONCLUÍDO', 'Entregue materiais na cabana e use a bancada [E].', 4);
      this.skipTutorial();
      return;
    }
    this.hud.setTutorial(this.tutorialStep + 1, TUTORIAL.length, TUTORIAL[this.tutorialStep]);
  }

  private updateAudio(): void {
    const p = this.player.pos;
    const coast = this.terrain.coastDistance(p.x, p.z);
    const sea = 1 - smoothstep(0, 130, coast);
    let fire = 1 - smoothstep(3, 32, p.distanceTo(this.crash.firePos));
    for (const pl of this.base.placed) if (pl.kind === 'campfire') fire = Math.max(fire, (1 - smoothstep(1, 14, pl.pos.distanceTo(p))) * 0.6);
    if (this.inv.selected === 'torch') fire = Math.max(fire, 0.25);
    this.sound.updateAmbience(sea, fire, this.sky.night, p.y);
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    this.hud.updateVitals(this.sky.day, this.sky.clockText, this.vitals.health, this.vitals.hunger, this.vitals.maxHealth);
    this.hud.setArmor(this.inv.armor === 2 ? '🛡️ Armadura Reforçada' : this.inv.armor === 1 ? '🦺 Armadura de Pele' : '');
    const f = this.player.forward;
    const heading = (((Math.atan2(f.x, -f.z) * 180) / Math.PI) + 360) % 360;
    this.hud.updateCompass(heading, this.player.pos.x, this.player.pos.z);
    this.hud.updateInventory(this.inv);
    this.hud.setHurt(this.vitals.hurtFlash * 0.9 + (this.vitals.health < this.vitals.maxHealth * 0.25 ? 0.25 + Math.sin(this.time * 4) * 0.1 : 0));
    if (this.fadeIn > 0 && !this.vitals.dead && this.sleepT < 0) {
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
      this.vitals.health = this.vitals.maxHealth * 0.6;
      this.vitals.hunger = Math.max(this.vitals.hunger, 50);
      this.player.teleport(this.crash.spawn.x, this.crash.spawn.z, this.crash.spawnYaw);
      this.player.wake = 0;
      this.fadeIn = 1;
    }
  }

  /** Debug helper: boss items and a pile of materials to test every recipe. */
  debugGiveAll(): void {
    this.inv.mats.totem = 1;
    this.inv.mats.relic = 1;
    this.inv.mats.sticks += 60;
    this.inv.mats.rocks += 40;
    this.inv.mats.cloth += 20;
    this.inv.mats.hide += 20;
    this.inv.logs = MAX_LOGS;
    this.vm.setLogs(this.inv.logs);
  }
}
