import * as THREE from 'three';
import { AssetLibrary } from './assets/assets';
import { SoundEngine } from './audio/soundEngine';
import { Input } from './core/input';
import { clamp, smoothstep } from './core/math';
import { Arrows, ArrowHitInfo } from './fx/arrows';
import { Debris } from './fx/particles';
import { BurnFlames, Sparks } from './fx/sparks';
import { PlayerController } from './player/controller';
import { FOOD_EFFECT, FoodId, HOTBAR_INFO, HotbarId, Inventory, ToolId, Vitals } from './player/inventory';
import { CraftMenu, CraftState } from './ui/craftMenu';
import { Hud } from './ui/hud';
import { Bow, CombatWorld, MELEE, Melee, MeleeSpec } from './weapons/tools';
import { ViewModel } from './weapons/viewmodel';
import { Animal, Wildlife } from './world/animals';
import { BaseSite, BuildKind, CABIN_COST, CABIN_D, Cabin, Cost, LEVEL_UP, Placed, Recipe, buildModel, setGhost } from './world/base';
import { ColliderGrid } from './world/colliders';
import { CrashSite, Dock } from './world/landmarks';
import { ITEM_LABEL, ItemType, Pickup, PickupManager } from './world/pickups';
import { DayNight } from './world/sky';
import { LAKE_CENTER, LAKE_LEVEL, LAKE_RADIUS, Terrain } from './world/terrain';
import { Forest, Props, Tree, windUniform } from './world/vegetation';
import { BossRole, Cannibal, SafeZone, Tribe } from './world/cannibals';
import { Beach } from './world/beach';
import { BOAT_COST, Sailboat } from './world/boat';
import { Altar, Cave } from './world/cave';
import { SaveData, SaveStore } from './core/save';
import { Screens } from './ui/screens';
import { recipeLabel, tr } from './ui/i18n';
import { Village } from './world/village';
import { Effigies, trailSpots } from './world/effigies';
import { GrassField } from './world/grass';
import { Water } from './world/water';

type HitKind = 'tree' | 'case' | 'effigy' | 'animal' | 'enemy' | 'terrain' | 'water' | 'hard';
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
const TUTORIAL = (): string[] => [
  tr('Quebre uma mala perto do avião com o Machado', 'Break a suitcase near the plane with the Axe'),
  tr('Corte 1 árvore e pegue 1 tora com [E]', 'Chop 1 tree and pick up 1 log with [E]'),
  tr('Colete gravetos ou pedras no chão', 'Gather sticks or rocks from the ground'),
  tr('Aperte [Tab] para abrir seu menu de Criação e Construção!', 'Press [Tab] to open your Crafting and Building book!'),
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
  readonly village: Village;
  readonly effigies: Effigies;
  readonly cave: Cave;
  readonly altar: Altar;
  readonly beach: Beach;
  readonly boat: Sailboat;
  readonly screens = new Screens();
  /** Inside the north cave. */
  indoors = false;
  private flashlight: THREE.SpotLight;
  private caveLoot = { flashlight: false, backpack: false };
  private stats = { hunted: 0 };
  private escaped = false;
  private deathShown = false;
  private chasmT = 0;
  readonly tribe: Tribe;
  private zones: SafeZone[] = [];
  private spottedT = 0;
  readonly grass: GrassField;
  readonly wildlife: Wildlife;
  readonly pickups = new PickupManager();
  readonly debris = new Debris();
  readonly sparks = new Sparks();
  readonly burnFx = new BurnFlames();
  private burning: { owner: object; x: number; y: number; z: number; h: number }[] = [];
  /** Hitstop: the simulation runs at 8% for a few ms while render and look keep going. */
  private hitstopT = 0;
  private hitstopCooldown = 0;
  private lastAlertAt = -99;
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
  private cabinLight: THREE.PointLight;
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
  private tutorialStep = 0;
  private tutorialDone = store.get('iss.tutorialDone') === '1';
  private flags = { caseBroken: false, logTaken: false, gathered: false, menuOpened: false };
  private interact: Interactable | null = null;
  private clock = new THREE.Clock();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private showFps = new URLSearchParams(location.search).has('fps');
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private v5 = new THREE.Vector3();
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
    this.scene.add(this.crash.group, this.crash.fireLight, this.crash.dirt, this.crash.emergencyLight);
    for (const s of this.crash.suitcases) this.scene.add(s.mesh);
    for (const e of [...this.crash.smoke, ...this.crash.fire]) this.scene.add(e.points);

    this.dock = new Dock(this.terrain, this.crash.center);
    this.scene.add(this.dock.group);
    this.base = new BaseSite(this.terrain, this.colliders);
    this.scene.add(this.base.group);
    this.village = new Village(this.terrain, this.colliders, lib, this.crash.center);
    this.scene.add(this.village.group, this.village.fire.points, this.village.smoke.points, this.village.fireLight);
    for (const e of this.village.fx) this.scene.add(e.points);
    // Village crates open exactly like the luggage at the crash site.
    for (const c of this.village.crates) {
      this.crash.suitcases.push(c);
      this.scene.add(c.mesh);
    }
    this.cave = new Cave(this.terrain, this.colliders, lib);
    this.scene.add(this.cave.outside, this.cave.inside);
    for (const e of [...this.cave.fx, ...this.cave.innerFx]) this.scene.add(e.points);
    // Supply crates and barrels inside the cave break like the luggage.
    for (const b of this.cave.breakables) {
      this.crash.suitcases.push(b);
      this.scene.add(b.mesh);
    }
    this.cave.onDrip = (p) => this.sound.drip(Math.max(0.15, 1 - p.distanceTo(this.player.pos) / 14));
    this.altar = new Altar(this.terrain, this.colliders, lib);
    this.scene.add(this.altar.group);
    for (const e of this.altar.fx) this.scene.add(e.points);
    this.boat = new Sailboat(this.terrain, this.colliders);
    this.scene.add(this.boat.group);
    this.beach = new Beach(this.terrain, [{ x: this.boat.pos.x, z: this.boat.pos.z, r: 10 }]);
    this.scene.add(this.beach.group);
    // Barrels and crates washed ashore break like the luggage too.
    for (const b of this.beach.breakables) {
      this.crash.suitcases.push(b);
      this.scene.add(b.mesh);
    }
    const save = SaveStore.load();

    const exclusions = [
      { x: this.crash.center.x, z: this.crash.center.z, r: 25 },
      { x: this.dock.start.x, z: this.dock.start.z, r: 7 },
      { x: this.village.center.x, z: this.village.center.z, r: this.village.radius },
      { x: this.cave.arena.x, z: this.cave.arena.z, r: 20 },
      { x: this.cave.mouth.x, z: this.cave.mouth.z, r: 12 },
      { x: this.altar.center.x, z: this.altar.center.z, r: this.altar.radius },
    ];
    this.forest = new Forest(this.terrain, this.colliders, exclusions, {
      onFallStart: (t) => this.onTreeFallStart(t),
      onLanded: (t, d, c) => this.onTreeLanded(t, d, c),
      onSettled: (t, d, a) => this.onTreeSettled(t, d, a),
    }, lib, 330, [{ x: this.crash.center.x, z: this.crash.center.z, r0: 26, r1: 58, count: 70 }]);
    this.scene.add(this.forest.group);
    this.props = new Props(this.terrain, this.colliders, exclusions, this.forest, lib);
    this.scene.add(this.props.group);
    // Breakable effigies: round the village and along the trails between landmarks.
    const crashC = this.crash.center;
    const villageC = this.village.center;
    const mouth = this.cave.mouth;
    const altarC = this.altar.center;
    const trail = trailSpots(
      this.terrain,
      this.colliders,
      [
        { a: crashC, b: villageC, count: 3 },
        { a: villageC, b: mouth, count: 2 },
        { a: crashC, b: mouth, count: 2 },
        { a: crashC, b: altarC, count: 2 },
      ],
      [{ x: mouth.x, z: mouth.z, r0: 8, r1: 15, count: 2 }],
      [
        { x: crashC.x, z: crashC.z, r: 28 },
        { x: villageC.x, z: villageC.z, r: this.village.radius },
        { x: mouth.x, z: mouth.z, r: 7 },
        { x: this.cave.arena.x, z: this.cave.arena.z, r: 14 },
        { x: altarC.x, z: altarC.z, r: this.altar.radius + 3 },
        { x: this.dock.start.x, z: this.dock.start.z, r: 10 },
      ],
      this.village.effigySpots,
    );
    // New spots go at the end so saved effigy ids keep pointing at the same ones.
    this.effigies = new Effigies(this.terrain, this.colliders, lib, [...this.village.effigySpots, ...trail, ...this.crash.effigySpots]);
    this.scene.add(this.effigies.group);
    // Around the wreck the grass stops only at the blocks and the ploughed earth (ragged edge).
    this.grass = new GrassField(this.terrain, lib, [{ x: this.village.center.x, z: this.village.center.z, r: 21 }], (x, z) => this.crash.grassBlocked(x, z));
    this.scene.add(this.grass.mesh);
    this.props.smallRocks.forEach((r, i) => this.pickups.addInstanced('rock', i, r.x, r.y, r.z));
    this.props.smallSticks.forEach((r, i) => this.pickups.addInstanced('stick', i, r.x, r.y, r.z));
    for (const d of this.beach.driftwood) this.pickups.add('log', this.v1.set(d.x, d.y, d.z), 1, d.rotY);
    for (const pb of this.beach.pebbles) this.pickups.add('rock', pb, 1);
    this.wildlife = new Wildlife(this.terrain, this.colliders, exclusions, (a) => this.onAnimalDeath(a), lib);
    this.scene.add(this.wildlife.group);
    this.tribe = new Tribe(
      this.terrain,
      this.colliders,
      lib,
      { village: this.village, cave: this.cave.arena, altar: this.altar.center, caveInside: this.cave.enemySpots },
      {
        onHitPlayer: (dmg, c) => this.onCannibalHit(dmg, c),
        onDeath: (c) => this.onCannibalDeath(c),
        onSpotted: () => this.onScoutSpotted(),
        onRoar: (c) => this.sound.roar(c.role === 'alpha' ? 'alpha' : c.role === 'guardian' || c.role === 'deepLord' ? 'guardian' : 'boss'),
        onAlert: (c) => this.onCannibalAlert(c),
        onBurn: (c, killed) => {
          if (killed) this.hud.toast(tr(`🔥 ${c.cfg.name} queimou até cair`, `🔥 ${c.cfg.name} burned down`));
        },
      },
      (save?.defeated ?? []) as BossRole[],
    );
    this.tribe.blockers = this.village.aiBlockers;
    this.tribe.caveSpace = { clamp: (p) => this.cave.clamp(p), blockedAt: (x, z, r) => this.cave.blockedAt(x, z, r) };
    this.scene.add(this.tribe.group);
    this.arrows = new Arrows(
      (o, d, max) => {
        const h = this.raycast(o, d, max, 0);
        this.lastArrowHit = h;
        return h ? h.t : null;
      },
      (info) => this.onArrowHit(info),
    );
    this.scene.add(this.pickups.group, this.debris.mesh, this.arrows.group, this.sparks.points, this.burnFx.group);

    this.torchLight = new THREE.PointLight(0xffa860, 0, 20, 1.5);
    this.scene.add(this.torchLight);
    this.cabinLight = new THREE.PointLight(0xffb468, 0, 13, 1.7);
    this.scene.add(this.cabinLight);
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
    // Tactical flashlight: a real spot light that is part of the fixed light pool (0 when off).
    this.flashlight = new THREE.SpotLight(0xfff2dc, 0, 55, 0.42, 0.45, 1.2);
    this.scene.add(this.flashlight, this.flashlight.target);

    this.player = new PlayerController(this.camera, this.terrain, this.colliders, this.dock, {
      onStep: (s, sprint) => this.sound.footstep(s, sprint, this.indoors),
      onLand: (v) => this.onLand(v),
    });
    this.player.platforms.push((x, z) => this.crash.floorAt(x, z));
    this.player.placeAt(this.crash.spawn.x, this.crash.spawn.y, this.crash.spawn.z, this.crash.spawnYaw);
    this.player.wake = 0;
    // Sparks from the torn cables, with a crackle, when the player is near.
    this.crash.onSpark = (p) => {
      if (p.distanceTo(this.player.pos) > 16) return;
      this.sparks.burst(p, this.v3.set(0, -1, 0), 14, 3.2);
      this.sound.fireHit();
    };
    this.grass.update(this.player.pos.x, this.player.pos.z);
    const sens = Number(store.get('iss.sens'));
    if (sens > 0) this.player.sensitivity = sens;

    this.vm = new ViewModel(innerWidth / innerHeight);
    this.melee = new Melee(this.vm, this, this.sound);
    this.bow = new Bow(this.vm, this, this.sound);

    this.hud = new Hud([
      { get name() { return tr('Avião', 'Plane'); }, cls: 'plane', x: this.crash.center.x, z: this.crash.center.z },
      { get name() { return tr('Lago', 'Lake'); }, cls: 'lake', x: LAKE_CENTER.x, z: LAKE_CENTER.z },
      { get name() { return tr('Aldeia', 'Village'); }, cls: 'plane', x: this.village.center.x, z: this.village.center.z },
      { get name() { return tr('Caverna', 'Cave'); }, cls: 'plane', x: this.cave.mouth.x, z: this.cave.mouth.z },
      { name: 'Altar', cls: 'plane', x: this.altar.center.x, z: this.altar.center.z },
      { get name() { return tr('Veleiro', 'Sailboat'); }, cls: 'lake', x: this.boat.pos.x, z: this.boat.pos.z },
      { get name() { return tr('Saída', 'Exit'); }, cls: 'lake', x: this.cave.entryInside.x, z: this.cave.entryInside.z, indoor: true },
      { get name() { return tr('Chefe', 'Boss'); }, cls: 'plane', x: this.cave.chestPos.x, z: this.cave.chestPos.z, indoor: true },
    ]);
    this.hud.onCraftButton = () => (this.menuOpen ? this.closeMenu() : this.openMenu());
    this.hud.setFade(1);
    this.hud.onSkipTutorial = () => this.skipTutorial();

    this.craft.onClose = () => this.closeMenu();
    this.craft.onCraft = (r) => this.doCraft(r);
    this.craft.onUpgrade = (l) => this.doUpgrade(l);
    document.addEventListener('keydown', (e) => {
      if (this.menuOpen && (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyB')) {
        e.preventDefault();
        this.closeMenu();
      }
    });

    this.player.platforms.push(
      (x, z) => this.base.cabinFloorAt(x, z),
      (x, z) => this.boat.deckAt(x, z),
    );
    if (save) this.applySave(save);
    else this.stageFirstAnimal();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.warmUp();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Compile every shader variant before play so nothing hitches on first use. */
  private warmUp(): void {
    const warm = new THREE.Group();
    warm.add(this.forest.makeWarmupObject());
    for (const k of ['campfire', 'logHolder', 'wall', 'gate', 'bed', 'cabin', 'spikeTrap'] as BuildKind[]) {
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
    for (const id of ['torch', 'bow', 'rod', 'spear', 'flameAxe', 'flashlight'] as HotbarId[]) this.vm.equip(id);
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
    for (const e of [...this.crash.smoke, ...this.crash.fire, ...this.altar.fx]) e.setViewportHeight(h * ratio);
    this.sparks.setViewportHeight(h * ratio);
    this.village.setViewportHeight(h * ratio);
    this.cave.setViewportHeight(h * ratio);
    this.burnFx.setViewportHeight(h * ratio);
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
      if (this.loadedSave) this.hud.message(`${tr('DIA', 'DAY')} ${this.sky.day}`, tr('Progresso carregado. A ilha continua de onde você parou.', 'Progress loaded. The island picks up where you left it.'), 4);
      else this.startWakeUp();
    } else if (on) {
      this.sound.start();
    }
  }

  // ---------------------------------------------------------------- wake-up and title camera

  /** -1 when idle; seconds into the wake-up sequence of a new game otherwise. */
  private wakeT = -1;
  private menuT = 0;

  /** A new game opens on the cabin floor: eyes blinking open, muffled ringing, the camera sitting up. */
  private startWakeUp(): void {
    this.wakeT = 0;
    this.fadeIn = 0;
    this.hud.setFade(0);
    this.player.wake = 0;
    this.sound.wakeUp();
  }

  private updateWakeUp(realDt: number): void {
    if (this.wakeT < 0) return;
    this.wakeT += realDt;
    // Click or Space skips it.
    if (this.wakeT > 0.25 && (this.input.justPressed('Space') || this.input.mouseDown)) this.wakeT = 3;
    const t = this.wakeT;
    // Eyelids: open a crack, close, open more, a slow blink, then wide.
    const open =
      t < 0.6 ? (t / 0.6) * 0.35 : t < 0.85 ? 0.35 - ((t - 0.6) / 0.25) * 0.3 : t < 1.6 ? 0.05 + ((t - 0.85) / 0.75) * 0.65 : t < 1.8 ? 0.7 - ((t - 1.6) / 0.2) * 0.25 : Math.min(1, 0.45 + ((t - 1.8) / 1.2) * 0.55);
    const blur = Math.max(0, 1 - t / 3) * 7;
    this.hud.setWake(t >= 3 ? null : { open, blur });
    if (t >= 3) {
      this.wakeT = -1;
      this.player.wake = Math.max(this.player.wake, 1);
      this.hud.message(tr('ILHA DESCONHECIDA', 'UNKNOWN ISLAND'), tr('Você sobreviveu à queda no meio da floresta. Saia do avião e quebre as malas com o machado.', 'You survived the crash deep in the forest. Get out of the plane and break the suitcases with the axe.'), 7);
    }
  }

  /** Before play: the camera circles the smoking wreck in its clearing. */
  private menuTick(dt: number): void {
    this.menuT += dt;
    const c = this.crash.center;
    const a = this.menuT * 0.045 + 2.2;
    this.camera.position.set(c.x + Math.sin(a) * 27, c.y + 8.5 + Math.sin(this.menuT * 0.11) * 1.2, c.z + Math.cos(a) * 27);
    this.camera.lookAt(c.x - 2, c.y + 1.8, c.z);
    windUniform.value = this.menuT;
    this.sky.update(0, this.menuT, this.camera, c);
    this.crash.update(dt, this.sky.ambient);
    this.grass.update(c.x, c.z);
    this.water.update(this.menuT, this.sky.sunDir, this.sky.sunColor, this.sky.daylight * 2.2, this.sky.horizon, this.sky.ambient);
  }

  // ---------------------------------------------------------------- frame

  private frame(): void {
    const t0 = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.playing) this.tick(dt);
    else if (!this.started) this.menuTick(dt);
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

  private tick(realDt: number): void {
    // Hitstop: world and weapon motion run at 8% for the hold; input, look and render don't stop.
    this.hitstopCooldown -= realDt;
    let dt = realDt;
    if (this.hitstopT > 0) {
      this.hitstopT -= realDt;
      dt = realDt * 0.08;
    }
    this.time += dt;
    const alive = !this.vitals.dead && this.sleepT < 0;
    this.handleInput(alive);

    this.player.carrySlow = 1 - this.inv.logs * 0.06;
    this.player.aimZoom = this.inv.selected === 'bow' ? this.bow.draw : 0;
    this.player.update(realDt, this.input, alive);
    this.vitals.update(dt, this.player.sprinting);
    this.melee.update(dt);
    this.bow.update(dt, alive && this.inv.selected === 'bow' && this.input.mouseDown && !this.placing, this.inv.mats.arrows);
    this.updatePendingUse(dt);
    this.updateFishing(dt);
    this.updatePlacement();

    this.sky.indoor = this.indoors;
    this.sky.update(dt, this.time, this.camera, this.player.pos);
    this.boat.update(dt, this.time);
    this.updateCave(dt);
    windUniform.value = this.time;
    this.grass.update(this.player.pos.x, this.player.pos.z);
    this.forest.update(dt);
    this.debris.update(dt);
    this.arrows.update(dt);
    this.sparks.update(dt);
    this.updateBurning(dt);
    this.updateTraps(dt);
    this.crash.update(dt, this.sky.ambient);
    this.altar.update(dt);
    this.base.update(dt, this.time, this.sky.ambient);
    this.village.update(dt, this.sky.ambient, this.player.pos);
    this.cave.update(dt, this.player.pos);
    this.effigies.update(dt, this.time, this.player.pos);
    this.updateZones();
    this.tribe.update(dt, { player: this.player.pos, alive: !this.vitals.dead, night: this.sky.night > 0.5, day: this.sky.day, zones: this.zones, indoors: this.indoors });
    this.updateCooking(dt);
    this.wildlife.update(dt, this.player.pos, this.player.sprinting || (this.player.moving && !this.input.keys.has('ControlLeft')));
    this.pickups.update(this.time);
    if (this.sky.night > 0.5) this.water.update(this.time, this.sky.moonDir, this.moonGlint, 0.9, this.sky.horizon, this.sky.ambient);
    else this.water.update(this.time, this.sky.sunDir, this.sky.sunColor, this.sky.daylight * 2.2, this.sky.horizon, this.sky.ambient);
    this.updateLights();

    this.updateTargets();
    this.updateTutorial();
    this.updateQuest();
    this.updateAudio();
    this.updateHud(dt);
    this.updateDeath(dt);
    this.updateSleep(dt);
    this.updateWakeUp(realDt);

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
    if ((inp.justPressed('Tab') || inp.justPressed('KeyB')) && !this.placing) {
      this.openMenu();
      return;
    }
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
      case 'torch':
        if (inp.mouseDown && this.melee.ready && !this.vm.busy) this.melee.use(MELEE[id]);
        break;
      case 'flashlight':
        break;
      case 'rod':
        if (click) this.useRod();
        break;
      case 'bow':
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
      this.hud.toast(tr('Sua vida está cheia', 'Your health is full'));
      return;
    }
    if (id !== 'bandage' && this.vitals.hunger > 97) {
      this.hud.toast(tr('Você não está com fome', 'You are not hungry'));
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
        if (inv.logs >= this.inv.maxLogs) {
          this.sound.denied();
          this.hud.toast(tr(`Ombro cheio (${this.inv.maxLogs}/${this.inv.maxLogs}) — [G] solta`, `Shoulder full (${this.inv.maxLogs}/${this.inv.maxLogs}) — [G] drops`));
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
      case 'coconut':
        inv.food.food += p.amount;
        break;
      case 'cloth':
        inv.mats.cloth += p.amount;
        break;
      case 'hide':
        inv.mats.hide += p.amount;
        break;
      case 'totem':
        inv.mats.totem += 1;
        this.sound.levelUp();
        this.hud.message(tr('TOTEM TRIBAL', 'TRIBAL TOTEM'), tr('Abra o menu [Tab] e evolua para o Nível 2: Arco, Muro, Portão e Armadura Reforçada.', 'Open the book [Tab] and upgrade to Level 2: Bow, Wall, Gate and Reinforced Armor.'), 6);
        break;
      case 'arrow':
        inv.mats.arrows += p.amount;
        break;
      case 'relic':
        inv.mats.relic += 1;
        this.sound.levelUp();
        this.hud.message(tr('RELÍQUIA DA CAVERNA', 'CAVE RELIC'), tr('Evolua o Livro [Tab] para o Nível 3 (Machado Flamejante). A caverna está aberta.', 'Upgrade the Book [Tab] to Level 3 (Flaming Axe). The cave is open.'), 6);
        this.saveGame();
        break;
      case 'heart':
        inv.mats.heart += 1;
        this.sound.levelUp();
        this.hud.message(tr('CORAÇÃO ALFA', 'ALPHA HEART'), tr('Leve o coração ao Veleiro na Praia Sul para terminar o reparo.', 'Bring the heart to the Sailboat on the South Beach to finish the repair.'), 6);
        this.saveGame();
        break;
      case 'flashlight':
        inv.tools.add('flashlight');
        this.caveLoot.flashlight = true;
        this.select('flashlight');
        this.sound.flashlightClick();
        this.hud.message(tr('LANTERNA TÁTICA', 'TACTICAL FLASHLIGHT'), tr('Um feixe forte para a caverna e para as noites.', 'A strong beam for the cave and the nights.'), 4);
        break;
      case 'backpack':
        inv.hasBackpack = true;
        this.caveLoot.backpack = true;
        this.hud.message(tr('MOCHILA TÁTICA', 'TACTICAL BACKPACK'), tr('Agora você carrega 4 toras e coleta o dobro de gravetos e pedras.', 'You now carry 4 logs and gather twice the sticks and rocks.'), 5);
        break;
      case 'stick':
        inv.mats.sticks += p.amount * (inv.hasBackpack ? 2 : 1);
        this.flags.gathered = true;
        if (p.instIndex >= 0) this.props.hideSmallStick(p.instIndex);
        break;
      case 'rock':
        inv.mats.rocks += inv.hasBackpack ? 2 : 1;
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
      if (target.type === 'log' && this.inv.logs >= this.inv.maxLogs) return { key: 'E', text: tr(`Ombro cheio (${this.inv.maxLogs}/${this.inv.maxLogs})`, `Shoulder full (${this.inv.maxLogs}/${this.inv.maxLogs})`), run: () => this.collect(target) };
      return { key: 'E', text: `${tr('Pegar', 'Pick up')} ${ITEM_LABEL[target.type]}`, run: () => this.collect(target) };
    }
    const p = this.player.pos;
    for (const pl of this.base.placed) {
      const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
      if (pl.kind === 'campfire' && d < 2.4) {
        if (pl.cooking) return { key: 'E', text: `${tr('Assando…', 'Roasting…')} ${Math.ceil(pl.cooking.t)}s`, run: () => {} };
        const raw: 'meat' | 'fish' | null = this.inv.food.meat > 0 ? 'meat' : this.inv.food.fish > 0 ? 'fish' : null;
        if (raw) return { key: 'E', text: raw === 'meat' ? tr('Assar Carne', 'Roast Meat') : tr('Assar Peixe', 'Roast Fish'), run: () => this.startCooking(pl, raw) };
      }
      if (pl.kind === 'logHolder' && d < 2.4) {
        if (this.inv.logs > 0 && pl.logs < 12) return { key: 'E', text: `${tr('Guardar toras', 'Store logs')} (${pl.logs}/12)`, run: () => this.depositLogs(pl) };
        if (pl.logs > 0 && this.inv.logs < this.inv.maxLogs) return { key: 'E', text: `${tr('Pegar tora', 'Take log')} (${pl.logs}/12)`, run: () => this.takeLog(pl) };
      }
      if (pl.kind === 'bed' && d < 2.1) return { key: 'E', text: tr('Dormir e Salvar', 'Sleep and Save'), run: () => this.startSleep() };
      if (pl.kind === 'gate' && d < 2.8) return { key: 'E', text: pl.open ? tr('Fechar portão', 'Close gate') : tr('Abrir portão', 'Open gate'), run: () => this.base.toggleGate(pl) };
    }
    if (this.indoors) {
      if (p.distanceTo(this.cave.entryInside) < 3.2) return { key: 'E', text: tr('Voltar à Superfície', 'Back to the Surface'), run: () => this.leaveCave() };
      if (!this.cave.bridgeRepaired && Math.hypot(p.x - this.cave.bridgePos.x, p.z - this.cave.bridgePos.z) < 3.2) {
        return { key: 'E', text: tr(`Consertar ponte (Gravetos ${this.inv.mats.sticks}/4 · Panos ${this.inv.mats.cloth}/2)`, `Repair bridge (Sticks ${this.inv.mats.sticks}/4 · Cloth ${this.inv.mats.cloth}/2)`), run: () => this.repairBridge() };
      }
      return null;
    }
    if (Math.hypot(p.x - this.cave.mouth.x, p.z - this.cave.mouth.z) < 6) {
      if (this.tribe.defeated.has('guardian')) return { key: 'E', text: tr('Entrar na Caverna', 'Enter the Cave'), run: () => this.enterCave() };
      return { key: 'E', text: tr('O Guardião bloqueia a entrada', 'The Guardian blocks the entrance'), run: () => this.hud.toast(tr('💀 Derrote o Guardião da Caverna primeiro', '💀 Defeat the Cave Guardian first')) };
    }
    if (Math.hypot(p.x - this.boat.pos.x, p.z - this.boat.pos.z) < 8.5) {
      if (this.player.swimming) {
        return {
          key: 'E',
          text: tr('Subir pela escada do Veleiro', 'Climb the Sailboat ladder'),
          run: () => {
            const d = this.boat.sternDeck(this.v4);
            this.player.placeAt(d.x, d.y, d.z, this.player.yaw);
            this.sound.footstep('wood', false);
          },
        };
      }
      if (this.escaped) return null;
      if (this.boat.complete) return { key: 'E', text: tr('Zarpar no Veleiro', 'Set sail'), run: () => this.sail() };
      const d = this.boat.delivered;
      return {
        key: 'E',
        text: tr(
          `Reparar Veleiro (Toras ${d.logs}/${BOAT_COST.logs} · Gravetos ${d.sticks}/${BOAT_COST.sticks} · Panos ${d.cloth}/${BOAT_COST.cloth} · Coração ${d.heart}/1)`,
          `Repair Sailboat (Logs ${d.logs}/${BOAT_COST.logs} · Sticks ${d.sticks}/${BOAT_COST.sticks} · Cloth ${d.cloth}/${BOAT_COST.cloth} · Heart ${d.heart}/1)`,
        ),
        run: () => this.repairBoat(),
      };
    }
    const cab = this.base.cabinNear(p, 8);
    if (cab) {
      if (cab.complete) {
        const dw = cab.doorWorld(this.v4);
        if (Math.hypot(dw.x - p.x, dw.z - p.z) < 2.2) return { key: 'E', text: cab.doorOpen ? tr('Fechar Porta', 'Close Door') : tr('Abrir Porta', 'Open Door'), run: () => this.toggleCabinDoor(cab) };
        const hasBed = this.base.placed.some((pl) => pl.kind === 'bed' && cab.inside(pl.pos.x, pl.pos.z, 0));
        if (!hasBed && cab.inside(p.x, p.z, 0)) {
          return {
            key: 'E',
            text: tr('Dormir', 'Sleep'),
            run: () => {
              this.sound.denied();
              this.hud.toast(tr('🛏️ Construa uma Cama pelo Livro [Tab] e coloque aqui dentro para dormir!', '🛏️ Build a Bed from the Book [Tab] and place it in here to sleep!'));
            },
          };
        }
        return null;
      }
      const d = cab.delivered;
      const text = tr(
        `Entregar (Toras ${d.logs}/${CABIN_COST.logs} · Gravetos ${d.sticks}/${CABIN_COST.sticks} · Pedras ${d.rocks}/${CABIN_COST.rocks})`,
        `Deliver (Logs ${d.logs}/${CABIN_COST.logs} · Sticks ${d.sticks}/${CABIN_COST.sticks} · Rocks ${d.rocks}/${CABIN_COST.rocks})`,
      );
      return { key: 'E', text, run: () => this.deliverCabin(cab) };
    }
    return null;
  }

  private deliverCabin(cabin: Cabin): void {
    const take = cabin.deliver({ logs: this.inv.logs, sticks: this.inv.mats.sticks, rocks: this.inv.mats.rocks });
    const n = take.logs + take.sticks + take.rocks;
    if (n === 0) {
      this.sound.denied();
      this.hud.toast(tr('Traga toras (no ombro), gravetos e pedras', 'Bring logs (on your shoulder), sticks and rocks'));
      return;
    }
    this.inv.logs -= take.logs;
    this.inv.mats.sticks -= take.sticks;
    this.inv.mats.rocks -= take.rocks;
    this.vm.setLogs(this.inv.logs);
    this.sound.build();
    this.player.addTrauma(0.08);
    if (cabin.complete) {
      this.hud.message(tr('CABANA PRONTA', 'CABIN READY'), tr('Abra a porta com [E]. Construa uma Cama pelo Livro [Tab] para dormir e salvar.', 'Open the door with [E]. Build a Bed from the Book [Tab] to sleep and save.'), 5.5);
      this.sound.levelUp();
    } else {
      this.hud.toast(`🛖 ${tr('Cabana', 'Cabin')} ${Math.round(cabin.progress * 100)}%`);
    }
  }

  private toggleCabinDoor(cab: Cabin): void {
    cab.setDoor(!cab.doorOpen);
    this.sound.door(cab.doorOpen);
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
      // A night's rest takes the edge off real hunger (but is no meal).
      if (this.vitals.hunger < 30) this.vitals.hunger = Math.min(100, this.vitals.hunger + 20);
      this.saveGame();
      this.hud.message(`${tr('DIA', 'DAY')} ${this.sky.day} · 07:00`, tr('Você dormiu, recuperou toda a vida e o jogo foi salvo.', 'You slept, recovered all your health and the game was saved.'), 3.5);
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
    this.hud.toast(item === 'meat' ? tr('🔥 Assando carne…', '🔥 Roasting meat…') : tr('🔥 Assando peixe…', '🔥 Roasting fish…'));
  }

  private updateCooking(dt: number): void {
    for (const pl of this.base.placed) {
      if (!pl.cooking) continue;
      pl.cooking.t -= dt;
      if (pl.cooking.t <= 0) {
        const cooked = pl.cooking.item === 'meat' ? 'cookedMeat' : 'cookedFish';
        this.inv.food[cooked]++;
        this.hud.toast(`${HOTBAR_INFO[cooked].icon} ${HOTBAR_INFO[cooked].label} ${tr('pronto!', 'ready!')}`);
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
    return { level: this.base.benchLevel, have: this.resources(), bossItems: { totem: this.inv.mats.totem, relic: this.inv.mats.relic }, owned };
  }

  private openMenu(): void {
    this.menuOpen = true;
    this.flags.menuOpened = true;
    this.cancelPlacement();
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
        this.hud.toast(`${r.icon} ${recipeLabel(r)} ${tr('criado!', 'crafted!')}`);
        break;
      case 'item':
        this.inv.mats.arrows += 5;
        this.hud.toast(tr('➶ +5 Flechas', '➶ +5 Arrows'));
        break;
      case 'armor': {
        const lvl = r.id === 'hideArmor' ? 1 : 2;
        this.inv.armor = Math.max(this.inv.armor, lvl);
        const max = this.inv.armor === 2 ? 200 : 150;
        this.vitals.health += max - this.vitals.maxHealth;
        this.vitals.maxHealth = max;
        this.hud.toast(`${r.icon} ${recipeLabel(r)}: ${tr('vida máxima', 'max health')} ${max}`);
        break;
      }
    }
    this.craft.render(this.craftState());
  }

  private doUpgrade(level: 2 | 3): void {
    const up = LEVEL_UP[level];
    if (this.base.benchLevel !== level - 1 || this.inv.mats[up.boss] <= 0 || !CraftMenu.affordable(up.cost, this.resources())) return;
    this.pay(up.cost);
    this.inv.mats[up.boss]--;
    this.base.benchLevel = level;
    this.saveGame();
    this.sound.levelUp();
    this.hud.toast(`🛠️ ${tr('Livro Nível', 'Book Level')} ${level}!`);
    this.craft.render(this.craftState());
  }

  private startPlacement(r: Recipe): void {
    const kind = r.id as BuildKind;
    const ghost = buildModel(kind);
    setGhost(ghost, true);
    this.scene.add(ghost);
    this.placing = { recipe: r, kind, ghost, yaw: this.player.yaw, valid: false, x: 0, z: 0 };
    this.hud.toast(`${r.icon} ${tr('Clique para colocar · [R] girar · [Q] cancelar', 'Click to place · [R] rotate · [Q] cancel')}`);
  }

  private updatePlacement(): void {
    const pl = this.placing;
    if (!pl) return;
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    // Ground under the aim: terrain, or the planks of a finished cabin.
    const groundAt = (x: number, z: number) => {
      const f = this.base.cabinFloorAt(x, z);
      const g = this.terrain.height(x, z);
      return f !== null ? Math.max(f, g) : g;
    };
    let t = 9;
    for (let s = 0.5; s < 9; s += 0.25) {
      if (o.y + d.y * s < groundAt(o.x + d.x * s, o.z + d.z * s)) {
        t = s;
        break;
      }
    }
    t = Math.max(pl.kind === 'bed' ? 1.6 : 2.2, t);
    pl.x = o.x + d.x * t;
    pl.z = o.z + d.z * t;
    const valid = this.base.canPlace(pl.kind, pl.x, pl.z, pl.yaw) && Math.hypot(pl.x - this.player.pos.x, pl.z - this.player.pos.z) > (pl.kind === 'bed' ? 0.9 : 1.4);
    if (valid !== pl.valid) {
      pl.valid = valid;
      setGhost(pl.ghost, valid);
    }
    pl.ghost.position.set(pl.x, pl.kind === 'bed' ? groundAt(pl.x, pl.z) : this.terrain.height(pl.x, pl.z), pl.z);
    pl.ghost.rotation.y = pl.yaw;
  }

  private confirmPlacement(): void {
    const pl = this.placing;
    if (!pl) return;
    if (!pl.valid || !CraftMenu.affordable(pl.recipe.cost, this.resources())) {
      this.sound.denied();
      this.hud.toast(pl.valid ? tr('Materiais insuficientes', 'Not enough materials') : pl.kind === 'bed' ? tr('Coloque a Cama dentro de uma Cabana pronta', 'Place the Bed inside a finished Cabin') : tr('Lugar inválido', 'Invalid spot'));
      return;
    }
    this.pay(pl.recipe.cost);
    if (pl.kind === 'cabin') {
      this.base.placeCabin(pl.x, pl.z, pl.yaw);
      this.hud.message(tr('CABANA MARCADA', 'CABIN MARKED'), tr('Entregue 6 toras, 10 gravetos e 6 pedras com [E] para erguê-la.', 'Deliver 6 logs, 10 sticks and 6 rocks with [E] to raise it.'), 4.5);
    } else {
      const placed = this.base.place(pl.kind, pl.x, pl.z, pl.yaw);
      const ratio = this.renderer.getPixelRatio();
      placed.fire?.setViewportHeight(innerHeight * ratio);
      placed.smoke?.setViewportHeight(innerHeight * ratio);
    }
    this.sound.build();
    const fy = this.base.cabinFloorAt(pl.x, pl.z) ?? this.terrain.height(pl.x, pl.z);
    this.debris.burst(this.v1.set(pl.x, fy + 0.2, pl.z), this.v3.set(0, 1, 0), 14, 0xc2a070, { speed: 2.5, size: 0.07, floor: fy });
    this.hud.toast(`${pl.recipe.icon} ${recipeLabel(pl.recipe)} ${tr('construído', 'built')}`);
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
      this.hud.toast(tr('Linha recolhida', 'Line reeled in'));
      return;
    }
    if (this.vm.busy) return;
    const o = this.camera.position;
    const d = this.camera.getWorldDirection(this.v2);
    const hit = this.raycast(o, d, 16, 0);
    if (!hit || hit.kind !== 'water') {
      this.sound.denied();
      this.hud.toast(tr('Mire na água (lago ou mar) para lançar', 'Aim at the water (lake or sea) to cast'));
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
        this.hud.toast(tr('🐠 +1 Peixe Cru (asse na fogueira)', '🐠 +1 Raw Fish (roast it on the campfire)'));
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
    const ef = this.effigies.raycast(o, d, best ? best.t : maxDist, inflate * 0.5);
    if (ef) best = { kind: 'effigy', t: ef.t, index: ef.index, metal: false };
    const an = this.wildlife.raycast(o, d, best ? best.t : maxDist, inflate * 0.7);
    if (an) best = { kind: 'animal', t: an.t, index: an.index, metal: false };
    const en = this.tribe.raycast(o, d, best ? best.t : maxDist, inflate * 0.7);
    if (en) best = { kind: 'enemy', t: en.t, index: en.index, metal: false };

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

  /** Hold the simulation briefly on a solid hit (rate-capped so holds never stack into stutter). */
  private hitStop(ms: number): void {
    if (this.hitstopCooldown > 0) return;
    this.hitstopT = ms / 1000;
    this.hitstopCooldown = 0.25;
  }

  /** Weight on impact: a short hold plus a small camera jolt toward the side that was struck. */
  private impactFeel(heavy: boolean): void {
    this.hitStop(heavy ? 45 : 35);
    const side = this.inv.selected === 'spear' ? 0 : -1;
    this.player.addRecoil(heavy ? 0.5 : 0.32, side * (heavy ? 0.28 : 0.18));
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
    const fiery = flame || this.inv.selected === 'torch';
    const solid = hit.kind === 'tree' || hit.kind === 'case' || hit.kind === 'effigy' || hit.kind === 'animal' || hit.kind === 'enemy' || hit.kind === 'hard';
    if (solid) this.impactFeel(hit.kind === 'enemy' || flame);
    if (fiery && solid) {
      // Burning weapons throw sparks off whatever they strike.
      this.sparks.burst(p, n, flame ? 26 : 16, flame ? 6 : 4.5);
      this.sound.fireHit();
    }
    switch (hit.kind) {
      case 'tree': {
        const tree = this.forest.trees[hit.index];
        const felled = this.forest.damage(hit.index, spec.tree, this.player.pos);
        this.debris.burst(p, n, spec.kind === 'stab' ? 5 : 12, 0xdcb98a, { speed: 3.2, size: 0.07, floor });
        if (spec.kind === 'swing') this.debris.burst(p, n, 4, flame ? 0xff9a3a : 0x5a3d26, { speed: 2.5, size: 0.09, floor, life: flame ? 0.5 : 1.2 });
        if (spec.kind === 'swing') this.sound.chopWood();
        else this.sound.impact('wood');
        this.hud.showTargetHealth(tree.hp / tree.maxHp);
        this.hud.hitMarker('white');
        this.sound.hitConfirm(false);
        this.player.addTrauma(felled ? 0.25 : spec.kind === 'stab' ? 0.06 : 0.14);
        break;
      }
      case 'case':
        this.hitCase(hit.index, spec.luggage, p, n);
        this.hud.hitMarker('white');
        this.player.addTrauma(0.12);
        break;
      case 'effigy':
        // Axes and the spear take one of its two "lives" per blow; the torch half of one.
        this.hitEffigy(hit.index, this.inv.selected === 'torch' ? 0.5 : 1, p, n);
        break;
      case 'animal':
        this.hitAnimal(hit.index, spec.animal, p, n);
        this.player.addTrauma(0.1);
        break;
      case 'enemy':
        this.hitCannibal(hit.index, spec.animal, p, n);
        // Fire sets them alight: the flaming axe for longer than the torch.
        if (fiery) this.tribe.ignite(hit.index, flame ? 5 : 3.5);
        this.player.addTrauma(0.14);
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
        // The arrow drops by the animal and can be recovered.
        this.pickups.addArrow(this.v4.set(tip.x, floor + 0.03, tip.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)));
        break;
      case 'enemy':
        this.hitCannibal(hit!.index, 55, tip, n);
        this.sound.arrowHit('flesh');
        this.pickups.addArrow(this.v4.set(tip.x, floor + 0.03, tip.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)));
        break;
      case 'effigy': {
        this.hitEffigy(hit!.index, 0.5, tip, n);
        this.sound.arrowHit('wood');
        const e = this.effigies.list[hit!.index];
        const ax = e.pos.x + (Math.random() - 0.5) * 0.8;
        const az = e.pos.z + (Math.random() - 0.5) * 0.8;
        this.pickups.addArrow(this.v4.set(ax, this.terrain.height(ax, az) + 0.03, az), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, Math.PI / 2)));
        break;
      }
      case 'case':
        this.hitCase(hit!.index, 25, tip, n);
        this.sound.arrowHit('wood');
        this.hud.hitMarker('white');
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
          this.hud.hitMarker('white');
          this.sound.hitConfirm(false);
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
    this.hud.hitMarker(killed ? 'kill' : 'white');
    this.sound.hitConfirm(false, killed);
    if (killed) this.hud.toast(a.species === 'deer' ? tr('🦌 Cervo abatido', '🦌 Deer down') : a.species === 'turtle' ? tr('🐢 Tartaruga abatida', '🐢 Turtle down') : tr('🐇 Coelho abatido', '🐇 Rabbit down'));
  }

  private onAnimalDeath(a: Animal): void {
    this.stats.hunted++;
    const n = a.species === 'deer' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = a.pos.x + (Math.random() - 0.5) * 1.2;
      const z = a.pos.z + (Math.random() - 0.5) * 1.2;
      this.pickups.add('meat', this.v4.set(x, this.terrain.height(x, z), z));
      if (a.species === 'turtle') continue;
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
      this.pickups.add(type, this.v1.set(x, this.cave.isInside(s.pos) ? 0 : this.terrain.height(x, z), z), 1);
    });
    this.hud.toast(this.cave.isInside(s.pos) ? tr('📦 Suprimentos encontrados', '📦 Supplies found') : tr('🧳 Mala aberta', '🧳 Suitcase opened'));
  }

  /** A blow on an effigy: wobble and chips, and on the last blow it topples and drops cloth and sticks. */
  private hitEffigy(i: number, power: number, p: THREE.Vector3, n: THREE.Vector3): void {
    const e = this.effigies.list[i];
    if (e.broken) return;
    const res = this.effigies.hit(i, power, this.player.pos);
    const floor = e.pos.y + 0.02;
    this.debris.burst(p, n, 9, 0xc9a070, { speed: 3, size: 0.06, floor });
    this.debris.burst(p, n, 4, 0xd6c7a1, { speed: 2, size: 0.07, floor, life: 1.1 });
    this.hud.hitMarker('white');
    this.sound.hitConfirm(false);
    if (!res.broken) {
      this.hud.showTargetHealth(res.left);
      this.sound.effigyHit();
      this.player.addTrauma(0.1);
      return;
    }
    this.hud.showTargetHealth(0);
    this.sound.effigyBreak();
    this.player.addTrauma(0.2);
    const mid = this.effigies.middle(i, this.v1);
    this.debris.burst(mid, this.v3.set(0, 1, 0), 22, 0xb08a5a, { speed: 3.6, size: 0.08, floor, life: 1.4 });
    this.debris.burst(mid, this.v3.set(0, 1, 0), 10, 0x8e2a1e, { speed: 2.4, size: 0.08, floor, life: 1.6 });
    this.debris.burst(mid, this.v3.set(0, 1, 0), 8, 0xd6c7a1, { speed: 2.4, size: 0.08, floor, life: 1.6 });
    this.debris.burst(mid.setY(e.pos.y + 2), this.v3.set(0, 1, 0), 8, 0xe9dfca, { speed: 2.8, size: 0.05, floor, life: 1.2 });
    // Drops: 1-2 cloth and 2-3 sticks on the ground round its foot.
    const cloth = 1 + (Math.random() < 0.5 ? 1 : 0);
    const sticks = 2 + (Math.random() < 0.5 ? 1 : 0);
    const items: ItemType[] = [...Array(cloth).fill('cloth'), ...Array(sticks).fill('stick')];
    items.forEach((type, k) => {
      const a = (k / items.length) * Math.PI * 2 + Math.random() * 0.6;
      const d = 0.55 + Math.random() * 0.45;
      const x = e.pos.x + Math.sin(a) * d;
      const z = e.pos.z + Math.cos(a) * d;
      this.pickups.add(type, this.v2.set(x, this.terrain.height(x, z), z), 1);
    });
    this.hud.toast(tr(`🪵 Efígie derrubada: ${cloth} pano${cloth > 1 ? 's' : ''} e ${sticks} gravetos`, `🪵 Effigy torn down: ${cloth} cloth and ${sticks} sticks`));
  }

  private onTreeFallStart(_t: Tree): void {
    this.sound.treeCreak();
    this.hud.toast(tr('🌲 Madeira!', '🌲 Timber!'));
  }

  private onTreeLanded(t: Tree, _dir: THREE.Vector3, crown: THREE.Vector3): void {
    const tip = this.v1.copy(crown);
    const dist = Math.hypot(t.x - this.player.pos.x, t.z - this.player.pos.z);
    this.sound.treeCrash(dist);
    this.player.addTrauma(0.45 * (1 - smoothstep(4, 30, dist)));
    this.debris.burst(tip, this.v3.set(0, 1, 0), 26, t.kind === 'palm' ? 0x4f8a3a : 0x3f6e34, { speed: 4, size: 0.12, floor: tip.y - 0.4, life: 1.4 });
    // Palms come down on the beach: a puff of sand where the crown hits.
    if (t.kind === 'palm') this.debris.burst(tip, this.v3.set(0, 1, 0), 18, 0xd8c08a, { speed: 3, size: 0.07, floor: tip.y - 0.4, life: 1.1 });
  }

  private onTreeSettled(t: Tree, dir: THREE.Vector3, along: THREE.Vector3[]): void {
    const rotY = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    const drop = (type: 'log' | 'stick' | 'coconut', p: THREE.Vector3, amount: number, side = 0) => {
      const x = p.x + dir.z * side;
      const z = p.z - dir.x * side;
      const y = this.groundY(x, z);
      this.pickups.add(type, this.v1.set(x, y, z), amount, rotY + (Math.random() - 0.5) * 0.3);
      if (type === 'log') this.debris.burst(this.v1.set(x, y + 0.2, z), this.v3.set(0, 1, 0), 8, 0xc2a070, { speed: 2, size: 0.07, floor: y });
    };
    if (t.kind === 'palm') {
      // A palm gives 2 logs where its trunk lay and a coconut by its crown.
      drop('log', along[0], 1);
      drop('log', along[1], 1);
      drop('coconut', along[3], 1, 0.7);
      this.hud.toast(tr('🌴 2 toras + 1 coco — [E] para pegar', '🌴 2 logs + 1 coconut — [E] to pick up'));
      return;
    }
    drop('log', along[0], 1, -0.25);
    drop('log', along[1], 1);
    drop('log', along[2], 1, 0.25);
    // Branches come down too.
    drop('stick', along[3], 2, 1.2);
    this.hud.toast(tr('🪵 3 toras + gravetos — [E] para pegar', '🪵 3 logs + sticks — [E] to pick up'));
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
    // Tactical flashlight: a strong spot from just right of the eye along the view.
    if (this.inv.selected === 'flashlight') {
      const d = this.camera.getWorldDirection(this.v2);
      this.flashlight.position.copy(this.camera.position).addScaledVector(d, 0.3);
      this.flashlight.position.x += -d.z * 0.22;
      this.flashlight.position.z += d.x * 0.22;
      this.flashlight.position.y -= 0.12;
      this.flashlight.target.position.copy(this.camera.position).addScaledVector(d, 20);
      this.flashlight.intensity = 140;
    } else {
      this.flashlight.intensity = 0;
    }
    const p = this.player.pos;
    // In the cave the three pooled lights (two campfire slots and the cabin lantern) light
    // the nearest of its lanterns, glowsticks, glowing water and floodlight.
    const pool = [this.campLights[0], this.campLights[1], this.cabinLight];
    if (this.indoors) {
      const near = this.cave.lights.slice().sort((a, b) => a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p));
      pool.forEach((l, i) => {
        const a = near[i];
        if (!a) {
          l.intensity = 0;
          return;
        }
        l.position.copy(a.pos);
        l.color.setHex(a.color);
        l.distance = a.distance;
        l.intensity = a.intensity * (a.flicker ? 0.9 + Math.sin(t * 11 + i) * 0.06 + Math.sin(t * 23 + i * 2) * 0.04 : 1);
      });
      return;
    }
    this.campLights[0].color.setHex(0xff8a3a);
    this.campLights[1].color.setHex(0xff8a3a);
    this.campLights[0].distance = this.campLights[1].distance = 18;
    this.cabinLight.color.setHex(0xffb468);
    this.cabinLight.distance = 13;
    // Two pooled campfire lights go to the nearest fires (hysteresis keeps them from swapping).
    const fires = this.base.placed.filter((p) => p.kind === 'campfire');
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
    // A free campfire slot lights the altar braziers when the player is near the arena.
    const freeSlot = this.campLights.find((l) => l.intensity === 0);
    if (freeSlot && this.altar.lightPos.distanceTo(p) < 75) {
      freeSlot.position.copy(this.altar.lightPos);
      freeSlot.distance = 24;
      freeSlot.intensity = 26 + Math.sin(t * 13) * 3 + Math.sin(t * 5.3) * 3;
    }
    // The lantern inside the nearest finished cabin: a soft warm light with a slow flicker.
    let lamp: Cabin | null = null;
    let ld = 60;
    for (const c of this.base.cabins) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (c.complete && d < ld) {
        ld = d;
        lamp = c;
      }
    }
    if (lamp) {
      lamp.lampWorld(this.cabinLight.position);
      this.cabinLight.position.y -= 0.05;
      this.cabinLight.intensity = 7 + Math.sin(t * 9.3) * 0.6 + Math.sin(t * 23.1) * 0.35;
    } else {
      this.cabinLight.intensity = 0;
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
      prompts.push(
        { key: tr('Clique', 'Click'), text: this.placing.valid ? `${tr('Colocar', 'Place')} ${recipeLabel(this.placing.recipe)}` : tr('Lugar inválido', 'Invalid spot') },
        { key: 'R', text: tr('Girar', 'Rotate') },
        { key: 'Q', text: tr('Cancelar', 'Cancel') },
      );
    } else if (this.interact) {
      prompts.push({ key: this.interact.key, text: this.interact.text });
    } else {
      const treeHit = this.forest.raycast(eye, fwd, 3.0, 0.3);
      const cs = this.crash.raycastCases(eye, fwd, 3.0, 0.15);
      const chopper = sel === 'axe' || sel === 'flameAxe';
      if (cs && (!treeHit || cs.t < treeHit.t)) prompts.push(chopper ? { key: tr('Clique', 'Click'), text: tr('Quebrar mala', 'Break suitcase') } : { key: '1', text: tr('Machado para abrir a mala', 'Axe to open the suitcase') });
      else if (treeHit) prompts.push(chopper ? { key: tr('Clique', 'Click'), text: tr('Cortar árvore', 'Chop tree') } : { key: '1', text: tr('Machado para cortar', 'Axe to chop') });
    }
    if (this.inv.logs > 0 && !this.placing) prompts.push({ key: 'G', text: tr('Soltar Tora', 'Drop Log') });
    if (sel === 'bow' && this.inv.mats.arrows === 0) prompts.push({ key: '!', text: tr('Sem flechas — crie no Livro [Tab]', 'No arrows — craft them in the Book [Tab]') });
    if (sel === 'bow' && this.inv.mats.arrows > 0 && !this.placing) prompts.push({ key: tr('Segure', 'Hold'), text: tr('Puxar o arco', 'Draw the bow') });
    if (sel === 'rod' && !this.placing) prompts.push({ key: tr('Clique', 'Click'), text: this.fishing ? tr('Recolher linha', 'Reel in') : tr('Lançar na água', 'Cast into the water') });
    if (!this.inv.isTool(sel) && !this.pendingUse && !this.placing) prompts.push({ key: tr('Clique', 'Click'), text: sel === 'bandage' ? tr('Usar curativo', 'Use bandage') : tr('Comer', 'Eat') });
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
      this.flags.menuOpened,
    ];
    while (this.tutorialStep < TUTORIAL().length && done[this.tutorialStep]) {
      this.tutorialStep++;
      this.sound.pickup();
    }
    if (this.tutorialStep >= TUTORIAL().length) {
      this.hud.message(tr('TUTORIAL CONCLUÍDO', 'TUTORIAL COMPLETE'), tr('Construa sua cabana e uma fogueira antes da noite: o fogo afasta os canibais.', 'Build your cabin and a campfire before night: fire keeps the cannibals away.'), 5);
      this.skipTutorial();
      return;
    }
    this.hud.setTutorial(this.tutorialStep + 1, TUTORIAL().length, TUTORIAL()[this.tutorialStep]);
  }

  private updateAudio(): void {
    const p = this.player.pos;
    const coast = this.terrain.coastDistance(p.x, p.z);
    const sea = 1 - smoothstep(0, 130, coast);
    let fire = 1 - smoothstep(3, 32, p.distanceTo(this.crash.firePos));
    fire = Math.max(fire, (1 - smoothstep(2, 20, p.distanceTo(this.village.fire.origin))) * 0.7);
    for (const pl of this.base.placed) if (pl.kind === 'campfire') fire = Math.max(fire, (1 - smoothstep(1, 14, pl.pos.distanceTo(p))) * 0.6);
    if (this.inv.selected === 'torch') fire = Math.max(fire, 0.25);
    this.sound.updateAmbience(sea, fire, this.sky.night, p.y);
  }

  private updateHud(dt: number): void {
    this.hud.update(dt);
    this.hud.updateVitals(this.sky.day, this.sky.clockText, this.vitals.health, this.vitals.hunger, this.vitals.maxHealth);
    this.hud.setArmor(this.inv.armor === 2 ? tr('🛡️ Armadura Reforçada', '🛡️ Reinforced Armor') : this.inv.armor === 1 ? tr('🦺 Armadura de Pele', '🦺 Hide Armor') : '');
    const f = this.player.forward;
    const heading = (((Math.atan2(f.x, -f.z) * 180) / Math.PI) + 360) % 360;
    this.hud.setIndoorCompass(this.indoors);
    this.hud.updateCompass(heading, this.player.pos.x, this.player.pos.z);
    this.hud.updateInventory(this.inv);
    this.hud.setCharge(this.inv.selected === 'bow' ? this.bow.draw : 0);
    this.hud.setHurt(this.vitals.hurtFlash * 0.9 + (this.vitals.health < this.vitals.maxHealth * 0.25 ? 0.25 + Math.sin(this.time * 4) * 0.1 : 0));
    if (this.fadeIn > 0 && !this.vitals.dead && this.sleepT < 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt / 2.6);
      this.hud.setFade(this.fadeIn);
    }
  }

  private updateDeath(dt: number): void {
    if (!this.vitals.dead) return;
    this.deathT += dt;
    this.hud.setFade(Math.min(0.85, this.deathT / 1.5));
    if (this.deathT > 1.4 && !this.deathShown) {
      this.deathShown = true;
      this.sound.deathSting();
      this.menuOpen = true;
      this.setPlaying(false);
      if (document.pointerLockElement) document.exitPointerLock();
      this.screens.showDeath(this.runStats(), () => this.respawn(), () => this.newGame());
    }
  }

  /** Back on the island with all progress kept: at a finished cabin if there is one, else by the plane. */
  respawn(): void {
    this.deathT = 0;
    this.deathShown = false;
    this.vitals.dead = false;
    this.vitals.health = this.vitals.maxHealth * 0.6;
    this.vitals.hunger = Math.max(this.vitals.hunger, 50);
    if (this.indoors) this.setIndoors(false);
    const cabin = this.base.cabins.find((c) => c.complete);
    if (cabin) {
      const at = cabin.toWorld(0, -CABIN_D / 2 - 4.5, this.v4);
      this.player.teleport(at.x, at.z, cabin.group.rotation.y + Math.PI);
    }
    else this.player.placeAt(this.crash.spawn.x, this.crash.spawn.y, this.crash.spawn.z, this.crash.spawnYaw);
    this.player.wake = 0;
    this.fadeIn = 1;
    this.menuOpen = false;
    this.requestLock();
  }

  newGame(): void {
    SaveStore.clear();
    location.reload();
  }

  private runStats(): { days: number; kills: number; hunted: number } {
    return { days: this.sky.day, kills: this.tribe.kills, hunted: this.stats.hunted };
  }

  // ---------------------------------------------------------------- cave

  private setIndoors(on: boolean): void {
    this.indoors = on;
    this.player.interior = on ? { ground: (x, z) => this.cave.groundAt(x, z), clamp: (p) => this.cave.clamp(p) } : null;
  }

  private enterCave(): void {
    this.setIndoors(true);
    const e = this.cave.entryInside;
    this.player.placeAt(e.x, 0, e.z, 0);
    this.fadeIn = 1;
    this.sound.roar('guardian');
    this.hud.message(tr('CAVERNA NORTE', 'NORTH CAVE'), tr('Escura e úmida. Uma tocha ou lanterna ajuda. [E] na entrada para voltar.', 'Dark and damp. A torch or flashlight helps. [E] at the entrance to go back.'), 5);
  }

  private leaveCave(): void {
    this.setIndoors(false);
    const o = this.cave.exitOutside;
    this.player.teleport(o.x, o.z, Math.atan2(-(o.x - this.cave.mouth.x), -(o.z - this.cave.mouth.z)) + Math.PI);
    this.fadeIn = 1;
  }

  private repairBridge(): void {
    if (this.inv.mats.sticks < 4 || this.inv.mats.cloth < 2) {
      this.sound.denied();
      this.hud.toast(tr('A ponte precisa de 4 Gravetos e 2 Panos', 'The bridge needs 4 Sticks and 2 Cloth'));
      return;
    }
    this.inv.mats.sticks -= 4;
    this.inv.mats.cloth -= 2;
    this.cave.setBridge(true);
    this.sound.bridge();
    this.player.addTrauma(0.1);
    this.hud.toast(tr('🌉 Ponte consertada', '🌉 Bridge repaired'));
    this.saveGame();
  }

  /** A deer (or rabbit) grazing at the edge of the clearing, in view as the player leaves the wreck. */
  private stageFirstAnimal(): void {
    const a = this.wildlife.animals.find((x) => x.species === 'deer') ?? this.wildlife.animals.find((x) => x.species === 'rabbit');
    if (!a) return;
    const p = this.crash.localToGround(-19, 7, 0);
    a.pos.set(p.x, p.y, p.z);
    a.group.position.copy(a.pos);
    a.state = 'graze';
    a.timer = 6;
    a.heading = a.targetHeading = Math.atan2(this.crash.center.x - p.x, this.crash.center.z - p.z) + 1.4;
  }

  private cavePickupsPlaced = false;
  private backpackPlaced = false;

  /** The Lord of the Depths drops the backpack where he falls (or at his post, after a reload). */
  private dropCaveBackpack(at: THREE.Vector3, quiet = false): void {
    if (!quiet) this.sound.levelUp();
    if (!this.caveLoot.backpack && !this.backpackPlaced) {
      this.backpackPlaced = true;
      this.pickups.add('backpack', this.v4.set(at.x, 0, at.z), 1, -0.3);
    }
  }

  private updateCave(dt: number): void {
    if (!this.cavePickupsPlaced) {
      this.cavePickupsPlaced = true;
      if (!this.caveLoot.flashlight) this.pickups.add('flashlight', this.cave.lootPos, 1, 0.4);
      if (this.tribe.defeated.has('deepLord')) this.dropCaveBackpack(this.cave.backpackPos, true);
    }
    if (!this.indoors) return;
    // Falling into the chasm hurts and puts you back at the near edge.
    if (this.player.pos.y < -6) {
      this.chasmT += dt;
      if (this.chasmT > 0.3) {
        this.chasmT = 0;
        this.vitals.damage(20);
        this.sound.hurt();
        const b = this.cave.bridgePos;
        this.player.placeAt(b.x, 0, b.z + 3, 0);
        this.hud.toast(tr('Você caiu no abismo! Conserte a ponte [E].', 'You fell into the chasm! Repair the bridge [E].'));
      }
    }
  }

  // ---------------------------------------------------------------- escape

  private repairBoat(): void {
    const stored = this.base.storedLogs(this.player.pos, 30);
    const have = { logs: this.inv.logs + stored, sticks: this.inv.mats.sticks, cloth: this.inv.mats.cloth, heart: this.inv.mats.heart };
    const take = this.boat.deliver(have);
    if (take.logs + take.sticks + take.cloth + take.heart === 0) {
      this.sound.denied();
      this.hud.toast(tr('Traga toras, gravetos, panos e o Coração Alfa', 'Bring logs, sticks, cloth and the Alpha Heart'));
      return;
    }
    const fromShoulder = Math.min(this.inv.logs, take.logs);
    this.inv.logs -= fromShoulder;
    if (take.logs > fromShoulder) this.base.takeStoredLogs(this.player.pos, take.logs - fromShoulder, 30);
    this.vm.setLogs(this.inv.logs);
    this.inv.mats.sticks -= take.sticks;
    this.inv.mats.cloth -= take.cloth;
    this.inv.mats.heart -= take.heart;
    this.sound.repair();
    this.player.addTrauma(0.06);
    if (this.boat.complete) {
      this.hud.message(tr('VELEIRO PRONTO', 'SAILBOAT READY'), tr('Suba pela escada da popa e [E] para zarpar.', 'Climb the stern ladder and press [E] to set sail.'), 5);
      this.sound.levelUp();
    } else this.hud.toast(`⛵ ${tr('Veleiro', 'Sailboat')} ${Math.round(this.boat.progress * 100)}%`);
    this.saveGame();
  }

  private sail(): void {
    this.escaped = true;
    this.saveGame();
    this.sound.victory();
    this.menuOpen = true;
    this.setPlaying(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.screens.showVictory(this.runStats(), () => this.newGame(), () => {
      this.menuOpen = false;
      this.requestLock();
    });
  }

  // ---------------------------------------------------------------- quests

  private updateQuest(): void {
    const lvl = this.base.benchLevel;
    const d = this.tribe.defeated;
    const hasCabin = this.base.cabins.some((c) => c.complete);
    const hasFire = this.base.placed.some((p) => p.kind === 'campfire');
    let q: [string, string];
    const dusk = this.sky.day === 1 && this.sky.hours >= 17.5 && !hasFire;
    if (this.escaped) q = ['⛵', tr('Você escapou da ilha. Explore à vontade.', 'You escaped the island. Explore freely.')];
    else if (dusk) q = ['🌇', tr('Está anoitecendo — abra o Livro [Tab] e construa uma Fogueira!', 'Night is falling — open the Book [Tab] and build a Campfire!')];
    else if (!hasCabin || !hasFire) q = ['🛖', tr('Construa uma Cabana e uma Fogueira antes da noite [Tab]', 'Build a Cabin and a Campfire before nightfall [Tab]')];
    else if (!d.has('boss')) q = ['👑', tr('Derrote o Chefe Tribal na [Aldeia] a Oeste', 'Defeat the Tribal Chief in the [Village] to the west')];
    else if (lvl < 2) q = ['📜', tr('Evolua o Livro para o Nível 2 com o Totem Tribal [Tab]', 'Upgrade the Book to Level 2 with the Tribal Totem [Tab]')];
    else if (!d.has('guardian')) q = ['💀', tr('Derrote o Guardião da [Caverna] ao Norte', 'Defeat the Guardian of the [Cave] to the north')];
    else if (!this.caveLoot.flashlight || !this.caveLoot.backpack) q = ['🔦', tr('Caverna: lanterna no acampamento perdido, mochila com o Senhor das Profundezas', 'Cave: flashlight at the lost camp, backpack with the Lord of the Depths')];
    else if (lvl < 3) q = ['📜', tr('Evolua o Livro para o Nível 3 com a Relíquia [Tab]', 'Upgrade the Book to Level 3 with the Relic [Tab]')];
    else if (!d.has('alpha') && this.inv.mats.heart === 0 && this.boat.delivered.heart === 0) q = ['🐺', tr('Cace a Fera Alfa no [Altar] a Leste', 'Hunt the Alpha Beast at the [Altar] to the east')];
    else q = ['⛵', tr('Repare o [Veleiro] na Praia Sul e fuja da ilha', 'Repair the [Sailboat] on the South Beach and escape')];
    this.hud.setQuest(q[0], q[1]);
    this.hud.setMarkerVisible('Altar', lvl >= 2);
  }

  // ---------------------------------------------------------------- save

  saveGame(): void {
    const inv = this.inv;
    const data: SaveData = {
      v: 1,
      day: this.sky.day,
      hours: this.sky.hours,
      player: this.indoors ? { x: this.cave.exitOutside.x, z: this.cave.exitOutside.z, yaw: 0 } : { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      health: Math.max(1, this.vitals.health),
      maxHealth: this.vitals.maxHealth,
      hunger: this.vitals.hunger,
      inv: { tools: [...inv.tools], food: { ...inv.food }, mats: { ...inv.mats }, logs: inv.logs, armor: inv.armor, hasBackpack: inv.hasBackpack },
      benchLevel: this.base.benchLevel,
      cabins: this.base.cabins.map((c) => ({ x: c.pos.x, z: c.pos.z, yaw: c.group.rotation.y, delivered: { ...c.delivered } })),
      placed: this.base.placed.map((p) => ({ kind: p.kind, x: p.pos.x, z: p.pos.z, yaw: p.yaw, logs: p.logs })),
      defeated: [...this.tribe.defeated],
      bridgeRepaired: this.cave.bridgeRepaired,
      caveLoot: { ...this.caveLoot },
      boat: { ...this.boat.delivered },
      stats: { kills: this.tribe.kills, hunted: this.stats.hunted },
      tutorialDone: this.tutorialDone,
      escaped: this.escaped,
      effigies: this.effigies.brokenIds(),
    };
    if (SaveStore.save(data)) this.hud.toast(tr('💾 Jogo salvo', '💾 Game saved'));
  }

  private applySave(d: SaveData): void {
    this.sky.day = d.day;
    this.sky.hours = d.hours;
    this.vitals.maxHealth = d.maxHealth;
    this.vitals.health = d.health;
    this.vitals.hunger = d.hunger;
    const inv = this.inv;
    for (const t of d.inv.tools) inv.tools.add(t as ToolId);
    Object.assign(inv.food, d.inv.food);
    Object.assign(inv.mats, d.inv.mats);
    inv.logs = d.inv.logs;
    inv.armor = d.inv.armor;
    inv.hasBackpack = d.inv.hasBackpack;
    this.base.benchLevel = d.benchLevel;
    for (const c of d.cabins) {
      const cabin = this.base.placeCabin(c.x, c.z, c.yaw);
      cabin.deliver(c.delivered);
    }
    for (const p of d.placed) {
      const placed = this.base.place(p.kind as BuildKind, p.x, p.z, p.yaw);
      if (p.kind === 'logHolder') this.base.setHolderLogs(placed, p.logs);
    }
    this.cave.setBridge(d.bridgeRepaired);
    this.caveLoot = { ...d.caveLoot };
    this.boat.deliver(d.boat);
    this.tribe.kills = d.stats.kills;
    this.stats.hunted = d.stats.hunted;
    this.escaped = d.escaped;
    if (d.effigies) this.effigies.restore(d.effigies);
    if (d.tutorialDone) {
      this.tutorialDone = true;
      this.hud.setTutorial(0, 0, null);
    }
    this.player.teleport(d.player.x, d.player.z, d.player.yaw);
    this.vm.setLogs(inv.logs);
    this.loadedSave = true;
  }

  private loadedSave = false;

  /** Lit campfires (16 m) and finished cabins (8 m) keep cannibals out. */
  private updateZones(): void {
    this.zones.length = 0;
    for (const pl of this.base.placed) if (pl.kind === 'campfire') this.zones.push({ x: pl.pos.x, z: pl.pos.z, r: 16 });
    for (const c of this.base.cabins) if (c.complete) this.zones.push({ x: c.pos.x, z: c.pos.z, r: 10 });
  }

  /** Cooldown per (trap, enemy) pair so a stake bites once in a while, not every frame. */
  private trapCooldown = new Map<string, number>();

  /** Spike barricades hurt any cannibal or hostile beast pushing against them (never the player or passive animals). */
  private updateTraps(dt: number): void {
    for (const [k, v] of this.trapCooldown) {
      if (v - dt <= 0) this.trapCooldown.delete(k);
      else this.trapCooldown.set(k, v - dt);
    }
    for (const t of this.base.placed) {
      if (t.kind !== 'spikeTrap') continue;
      this.tribe.list.forEach((c, i) => {
        if (c.state === 'dead') return;
        // The barricade is 2.2 m wide: a body reaching within 1.6 m of its centre is on the stakes.
        if (Math.hypot(c.pos.x - t.pos.x, c.pos.z - t.pos.z) - c.cfg.radius > 1.6 || Math.abs(c.pos.y - t.pos.y) > 1.8) return;
        const key = `${t.group.uuid}:${i}`;
        if (this.trapCooldown.has(key)) return;
        this.trapCooldown.set(key, 0.9);
        const killed = this.tribe.damage(i, 18);
        this.v4.set(c.pos.x, c.pos.y + 0.6, c.pos.z);
        this.debris.burst(this.v4, this.v5.set(0, 1, 0), killed ? 14 : 8, 0x7a1414, { speed: 2.2, size: 0.04, floor: c.pos.y + 0.02, life: 0.8 });
        if (this.player.pos.distanceTo(c.pos) < 30) {
          this.sound.fireHit();
          this.sound.animalHurt(true);
        }
        if (killed && this.player.pos.distanceTo(c.pos) < 60) this.hud.toast(tr(`🪤 ${c.cfg.name} caiu na armadilha`, `🪤 ${c.cfg.name} died on the spikes`));
      });
    }
  }

  private hitCannibal(i: number, dmg: number, p: THREE.Vector3, n: THREE.Vector3): void {
    const c = this.tribe.list[i];
    const killed = this.tribe.damage(i, dmg);
    this.debris.burst(p, n, killed ? 16 : 9, 0x7a1414, { speed: 2.6, size: 0.04, floor: c.pos.y + 0.02, life: 0.9 });
    this.sound.animalHurt(true);
    this.hud.showTargetHealth(Math.max(0, c.hp) / c.maxHp);
    this.hud.hitMarker(killed ? 'kill' : 'red');
    this.sound.hitConfirm(true, killed);
    if (killed) this.hud.toast(c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha' ? `👑 ${c.cfg.name} ${tr('derrotado!', 'defeated!')}` : tr('💀 Canibal derrotado', '💀 Cannibal defeated'));
  }

  private onCannibalHit(dmg: number, c: Cannibal): void {
    this.vitals.damage(dmg);
    const big = c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha';
    if (big) this.sound.monsterHit();
    else this.sound.hurt();
    this.player.addTrauma(big ? 0.55 : 0.3);
    // Knock the player back a little from the blow.
    const dx = this.player.pos.x - c.pos.x;
    const dz = this.player.pos.z - c.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.player.vel.x += (dx / d) * 4;
    this.player.vel.z += (dz / d) * 4;
  }

  private onCannibalDeath(c: Cannibal): void {
    const drops: ItemType[] = [];
    const pool: ItemType[] = ['cloth', 'food', 'bandage'];
    const bossKill = c.role === 'boss' || c.role === 'guardian' || c.role === 'alpha' || c.role === 'deepLord';
    const count = bossKill ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < count; k++) drops.push(pool[Math.floor(Math.random() * pool.length)]);
    if (c.role === 'boss') drops.push('totem');
    if (c.role === 'guardian') drops.push('relic');
    if (c.role === 'alpha') drops.push('heart');
    drops.forEach((type, k) => {
      const a = (k / drops.length) * Math.PI * 2 + Math.random();
      const x = c.pos.x + Math.cos(a) * 0.8;
      const z = c.pos.z + Math.sin(a) * 0.8;
      this.pickups.add(type, this.v4.set(x, c.cave ? 0 : this.terrain.height(x, z), z), 1);
    });
    if (c.role === 'deepLord') {
      this.hud.message(tr('O SENHOR DAS PROFUNDEZAS CAIU', 'THE LORD OF THE DEPTHS HAS FALLEN'), tr('Ele deixou cair a Mochila Tática: pegue com [E]!', 'He dropped the Tactical Backpack: pick it up with [E]!'), 6);
      this.dropCaveBackpack(c.pos);
    }
    if (c.role === 'boss') this.hud.message(tr('O CHEFE CAIU', 'THE CHIEF HAS FALLEN'), tr('Pegue o Totem Tribal [E] para evoluir seu menu para o Nível 2.', 'Take the Tribal Totem [E] to upgrade your Book to Level 2.'), 6);
    if (c.role === 'guardian') this.hud.message(tr('O GUARDIÃO CAIU', 'THE GUARDIAN HAS FALLEN'), tr('Pegue a Relíquia [E]. A entrada da caverna está livre.', 'Take the Relic [E]. The cave entrance is clear.'), 6);
    if (c.role === 'alpha') this.hud.message(tr('A FERA ALFA CAIU', 'THE ALPHA BEAST HAS FALLEN'), tr('Pegue o Coração Alfa [E] e leve-o ao Veleiro.', 'Take the Alpha Heart [E] and bring it to the Sailboat.'), 6);
    if (bossKill) this.saveGame();
  }

  /** Small flames follow each burning enemy (fixed emitter pool). */
  private updateBurning(dt: number): void {
    this.burning.length = 0;
    for (const c of this.tribe.list) {
      if (c.burnT > 0 && c.state !== 'dead') this.burning.push({ owner: c, x: c.pos.x, y: c.pos.y, z: c.pos.z, h: c.cfg.height });
    }
    this.burnFx.update(dt, this.burning);
  }

  private onCannibalAlert(c: Cannibal): void {
    // A group that spots you together plays one sting, not a stack of them.
    const since = this.time - this.lastAlertAt;
    if (since >= 0 && since < 4) return;
    this.lastAlertAt = this.time;
    this.sound.alert();
    if (c.night) this.hud.toast(tr('⚠️ Você foi avistado!', '⚠️ You have been spotted!'));
  }

  private onScoutSpotted(): void {
    if (this.time - this.spottedT < 25) return;
    this.spottedT = this.time;
    this.hud.toast(tr('👁️ Algo está te observando da floresta…', '👁️ Something is watching you from the forest…'));
  }

  /** Debug helper: boss items and a pile of materials to test every recipe. */
  debugGiveAll(): void {
    this.inv.mats.totem = 1;
    this.inv.mats.relic = 1;
    this.inv.mats.sticks += 60;
    this.inv.mats.rocks += 40;
    this.inv.mats.cloth += 20;
    this.inv.mats.hide += 20;
    this.inv.logs = this.inv.maxLogs;
    this.vm.setLogs(this.inv.logs);
  }
}
