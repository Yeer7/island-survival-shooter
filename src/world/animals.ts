import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetLibrary } from '../assets/assets';
import { clamp, mulberry32, wrapAngle } from '../core/math';
import { ColliderGrid } from './colliders';
import { Exclusion } from './vegetation';
import { Terrain } from './terrain';

export type Species = 'rabbit' | 'deer';

interface SpeciesCfg {
  walk: number;
  flee: number;
  scare: number;
  hp: number;
  radius: number;
  height: number;
  stride: number;
  turn: number;
}

// Wander and flee speeds are tuned against the player's 15 m/s sprint so game can be run down.
const CFG: Record<Species, SpeciesCfg> = {
  rabbit: { walk: 3.5, flee: 9.0, scare: 9, hp: 20, radius: 0.3, height: 0.35, stride: 0.7, turn: 3.0 },
  deer: { walk: 4.0, flee: 10.5, scare: 17, hp: 60, radius: 0.75, height: 1.3, stride: 1.6, turn: 1.8 },
};

/** Clip names inside the CC0 deer/stag files. */
const CLIP = { idle: 'Idle', graze: 'Eating', walk: 'Walk', run: 'Gallop', death: 'Death' } as const;
type ClipKey = keyof typeof CLIP;

export interface Animal {
  species: Species;
  cfg: SpeciesCfg;
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D | null;
  legs: THREE.Object3D[];
  pos: THREE.Vector3;
  heading: number;
  targetHeading: number;
  speed: number;
  state: 'graze' | 'walk' | 'flee' | 'dead';
  timer: number;
  hp: number;
  legPhase: number;
  deadT: number;
  dropped: boolean;
  respawnT: number;
  /** Rabbits stop for a beat now and then while fleeing. */
  pauseT: number;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<ClipKey, THREE.AnimationAction>>;
  clip: ClipKey | null;
}

function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r;
    arr[i + 1] = c.g;
    arr[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });

/** Leg geometry hanging down from its hip at the origin. */
function legGeo(len: number, r: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 0.7, len, 5);
  g.translate(0, -len / 2, 0);
  return colored(g, hex);
}

function buildRabbit(): { group: THREE.Group; body: THREE.Group; head: null; legs: THREE.Object3D[] } {
  const fur = 0x8a7258;
  const parts = [
    colored(new THREE.SphereGeometry(0.15, 8, 6).scale(1, 0.95, 1.35).translate(0, 0.2, 0), fur),
    colored(new THREE.SphereGeometry(0.09, 8, 6).translate(0, 0.32, 0.17), fur),
    colored(new THREE.BoxGeometry(0.03, 0.14, 0.05).translate(-0.035, 0.45, 0.14), 0x9a8268),
    colored(new THREE.BoxGeometry(0.03, 0.14, 0.05).translate(0.035, 0.45, 0.14), 0x9a8268),
    colored(new THREE.SphereGeometry(0.045, 6, 4).translate(0, 0.25, -0.2), 0xf2eee6),
    colored(new THREE.SphereGeometry(0.015, 4, 3).translate(-0.045, 0.34, 0.24), 0x111111),
    colored(new THREE.SphereGeometry(0.015, 4, 3).translate(0.045, 0.34, 0.24), 0x111111),
  ];
  const body = new THREE.Group();
  const bodyMesh = new THREE.Mesh(mergeGeometries(parts)!, mat);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  const group = new THREE.Group();
  group.add(body);
  const legs: THREE.Object3D[] = [];
  const front = legGeo(0.12, 0.022, 0x7a6450);
  const back = legGeo(0.15, 0.035, 0x7a6450);
  for (const [x, z, g] of [[-0.06, 0.1, front], [0.06, 0.1, front], [-0.08, -0.1, back], [0.08, -0.1, back]] as [number, number, THREE.BufferGeometry][]) {
    const leg = new THREE.Mesh(g, mat);
    leg.position.set(x, 0.14, z);
    body.add(leg);
    legs.push(leg);
  }
  return { group, body, head: null, legs };
}

function buildDeer(rand: () => number): { group: THREE.Group; body: THREE.Group; head: THREE.Object3D; legs: THREE.Object3D[] } {
  const fur = 0x8b5a32;
  const belly = 0xd8c3a0;
  const parts = [
    colored(new THREE.CapsuleGeometry(0.26, 0.75, 4, 8).rotateX(Math.PI / 2).translate(0, 1.0, 0), fur),
    colored(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.6, 1.6).translate(0, 0.86, 0), belly),
    colored(new THREE.ConeGeometry(0.07, 0.15, 5).rotateX(-0.6).translate(0, 1.12, -0.55), 0xf4efe6),
  ];
  const body = new THREE.Group();
  const bodyMesh = new THREE.Mesh(mergeGeometries(parts)!, mat);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);

  const head = new THREE.Group();
  head.position.set(0, 1.15, 0.45);
  const headParts = [
    colored(new THREE.CylinderGeometry(0.08, 0.11, 0.55, 6).translate(0, 0.27, 0).rotateX(0.55), fur),
    colored(new THREE.BoxGeometry(0.16, 0.16, 0.3).translate(0, 0.5, 0.36), fur),
    colored(new THREE.BoxGeometry(0.09, 0.08, 0.1).translate(0, 0.47, 0.54), 0x3a2a1c),
    colored(new THREE.ConeGeometry(0.05, 0.14, 4).rotateZ(0.9).translate(-0.11, 0.62, 0.3), fur),
    colored(new THREE.ConeGeometry(0.05, 0.14, 4).rotateZ(-0.9).translate(0.11, 0.62, 0.3), fur),
  ];
  if (rand() > 0.4) {
    for (const s of [-1, 1]) {
      headParts.push(colored(new THREE.CylinderGeometry(0.012, 0.018, 0.32, 4).rotateZ(-s * 0.35).translate(s * 0.08, 0.74, 0.3), 0xd8c8a8));
      headParts.push(colored(new THREE.CylinderGeometry(0.01, 0.014, 0.16, 4).rotateX(0.7).translate(s * 0.13, 0.84, 0.36), 0xd8c8a8));
    }
  }
  const headMesh = new THREE.Mesh(mergeGeometries(headParts)!, mat);
  headMesh.castShadow = true;
  head.add(headMesh);
  body.add(head);

  const group = new THREE.Group();
  group.add(body);
  const legs: THREE.Object3D[] = [];
  const lg = legGeo(0.85, 0.045, 0x6e4626);
  for (const [x, z] of [[-0.15, 0.38], [0.15, 0.38], [-0.15, -0.38], [0.15, -0.38]]) {
    const leg = new THREE.Mesh(lg, mat);
    leg.position.set(x, 0.9, z);
    body.add(leg);
    legs.push(leg);
  }
  return { group, body, head, legs };
}

/** Rabbits and deer: graze, wander in curves and flee from the player. */
export class Wildlife {
  readonly animals: Animal[] = [];
  readonly group = new THREE.Group();
  private rand = mulberry32(777);

  constructor(private terrain: Terrain, private colliders: ColliderGrid, private exclusions: Exclusion[], private onDeath: (a: Animal) => void, private lib: AssetLibrary | null = null) {
    for (let i = 0; i < 14; i++) this.spawn('rabbit', null);
    for (let i = 0; i < 8; i++) this.spawn('deer', null);
  }

  private findSpot(avoid: THREE.Vector3 | null): THREE.Vector3 {
    for (let k = 0; k < 400; k++) {
      const x = (this.rand() - 0.5) * 460;
      const z = (this.rand() - 0.5) * 460;
      if (this.terrain.surfaceAt(x, z) !== 'grass') continue;
      if (this.exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + 10)) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 70) continue;
      return new THREE.Vector3(x, this.terrain.height(x, z), z);
    }
    return new THREE.Vector3(0, this.terrain.height(0, 0), 0);
  }

  private spawn(species: Species, avoid: THREE.Vector3 | null, reuse?: Animal): void {
    const pos = this.findSpot(avoid);
    if (reuse) {
      reuse.pos.copy(pos);
      reuse.hp = reuse.cfg.hp;
      reuse.state = 'graze';
      reuse.timer = 3;
      reuse.deadT = 0;
      reuse.dropped = false;
      reuse.speed = 0;
      reuse.body.rotation.set(0, 0, 0);
      reuse.group.visible = true;
      if (reuse.mixer) {
        reuse.mixer.stopAllAction();
        reuse.clip = null;
        this.play(reuse, 'graze');
      }
      return;
    }
    const built: { group: THREE.Group; body: THREE.Group; head: THREE.Object3D | null; legs: THREE.Object3D[]; mixer?: THREE.AnimationMixer; actions?: Partial<Record<ClipKey, THREE.AnimationAction>> } =
      species === 'rabbit' ? buildRabbit() : this.buildDeerAsset() ?? buildDeer(this.rand);
    const heading = this.rand() * Math.PI * 2;
    const a: Animal = {
      species,
      cfg: CFG[species],
      group: built.group,
      body: built.body,
      head: built.head,
      legs: built.legs,
      pos,
      heading,
      targetHeading: heading,
      speed: 0,
      state: 'graze',
      timer: 1 + this.rand() * 4,
      hp: CFG[species].hp,
      legPhase: 0,
      deadT: 0,
      dropped: false,
      respawnT: 0,
      pauseT: 0,
      mixer: null,
      actions: {},
      clip: null,
    };
    if (built.mixer && built.actions) {
      a.mixer = built.mixer;
      a.actions = built.actions;
      a.mixer.setTime(this.rand() * 3);
      this.play(a, 'graze');
    }
    this.group.add(a.group);
    this.animals.push(a);
  }

  /** CC0 animated doe or stag (Quaternius), with its own mixer. */
  private buildDeerAsset(): { group: THREE.Group; body: THREE.Group; head: null; legs: THREE.Object3D[]; mixer: THREE.AnimationMixer; actions: Partial<Record<ClipKey, THREE.AnimationAction>> } | null {
    const lib = this.lib;
    if (!lib) return null;
    const stag = this.rand() < 0.4;
    const name = stag ? 'stag' : 'deer';
    if (!lib.has(name)) return null;
    const model = lib.instance(name, { by: 'height', value: stag ? 1.95 : 1.45 });
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    const body = new THREE.Group();
    body.add(model);
    const group = new THREE.Group();
    group.add(body);
    const mixer = new THREE.AnimationMixer(model);
    const clips = lib.raw(name).animations;
    const actions: Partial<Record<ClipKey, THREE.AnimationAction>> = {};
    for (const key of Object.keys(CLIP) as ClipKey[]) {
      const clip = clips.find((c) => c.name === CLIP[key]) ?? clips.find((c) => c.name.endsWith(`|${CLIP[key]}`));
      if (!clip) continue;
      const act = mixer.clipAction(clip);
      if (key === 'death') {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      actions[key] = act;
    }
    return { group, body, head: null, legs: [], mixer, actions };
  }

  private play(a: Animal, key: ClipKey): void {
    if (!a.mixer || a.clip === key) return;
    const next = a.actions[key];
    if (!next) return;
    const prev = a.clip ? a.actions[a.clip] : null;
    next.reset().play();
    if (prev) next.crossFadeFrom(prev, key === 'death' ? 0.15 : 0.35, false);
    a.clip = key;
  }

  /** Ray vs body spheres. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, inflate = 0): { t: number; index: number } | null {
    let best = maxDist;
    let idx = -1;
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (a.state === 'dead' || !a.group.visible) continue;
      const r = a.cfg.radius + inflate;
      const cy = a.pos.y + a.cfg.height * 0.65;
      const ox = o.x - a.pos.x;
      const oy = o.y - cy;
      const oz = o.z - a.pos.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) t = c < 0 ? 0 : -1;
      if (t >= 0 && t < best) {
        best = t;
        idx = i;
      }
    }
    return idx >= 0 ? { t: best, index: idx } : null;
  }

  /** Returns true if this hit killed it. */
  damage(i: number, amount: number, from: THREE.Vector3): boolean {
    const a = this.animals[i];
    if (a.state === 'dead') return false;
    a.hp -= amount;
    if (a.hp <= 0) {
      a.state = 'dead';
      a.deadT = 0;
      a.speed = 0;
      return true;
    }
    this.startFlee(a, from);
    return false;
  }

  private startFlee(a: Animal, from: THREE.Vector3): void {
    a.state = 'flee';
    a.timer = 6 + this.rand() * 4;
    a.targetHeading = Math.atan2(a.pos.x - from.x, a.pos.z - from.z);
  }

  private blocked(x: number, z: number): boolean {
    const h = this.terrain.height(x, z);
    if (h < this.terrain.waterLevelAt(x, z) + 0.3) return true;
    if (this.terrain.coastDistance(x, z) < 12) return true;
    if (this.terrain.slope(x, z) > 0.42) return true;
    return this.exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r * 0.6);
  }

  update(dt: number, player: THREE.Vector3, playerMoving: boolean): void {
    for (const a of this.animals) {
      const dx = a.pos.x - player.x;
      const dz = a.pos.z - player.z;
      const dist = Math.hypot(dx, dz);

      if (a.state === 'dead') {
        a.deadT += dt;
        if (a.mixer) {
          this.play(a, 'death');
          a.mixer.update(dt);
        } else a.body.rotation.z = Math.min(Math.PI / 2, a.deadT * 5) * 0.95;
        if (a.deadT > 1.0 && !a.dropped) {
          a.dropped = true;
          this.onDeath(a);
        }
        if (a.deadT > 1.6 && a.group.visible) a.group.visible = false;
        if (a.deadT > 60) this.spawn(a.species, player, a);
        continue;
      }
      a.group.visible = dist < 150;
      if (dist > 170) continue;

      const c = a.cfg;
      // Perception: running or close players scare animals.
      if (a.state !== 'flee' && (dist < c.scare * 0.5 || (dist < c.scare && playerMoving))) this.startFlee(a, player);

      a.timer -= dt;
      let targetSpeed = 0;
      switch (a.state) {
        case 'graze':
          targetSpeed = 0;
          if (a.timer <= 0) {
            a.state = 'walk';
            a.timer = 3 + this.rand() * 5;
            a.targetHeading = a.heading + (this.rand() - 0.5) * 2.4;
          }
          break;
        case 'walk':
          targetSpeed = c.walk;
          if (this.rand() < dt * 0.4) a.targetHeading += (this.rand() - 0.5) * 1.2;
          if (a.timer <= 0) {
            a.state = 'graze';
            a.timer = 2 + this.rand() * 5;
          }
          break;
        case 'flee':
          targetSpeed = c.flee;
          if (a.species === 'rabbit') {
            a.pauseT -= dt;
            if (a.pauseT < -1.2 - this.rand() * 1.2) a.pauseT = 0.25 + this.rand() * 0.25;
            if (a.pauseT > 0) targetSpeed = 0.4;
          }
          if (dist < c.scare * 2) a.targetHeading = Math.atan2(dx, dz) + Math.sin(a.timer * 1.7) * 0.4;
          if (a.timer <= 0 && dist > c.scare * 2) {
            a.state = 'walk';
            a.timer = 2 + this.rand() * 3;
          }
          break;
      }

      // Steer away from water, cliffs, the coast and the camps.
      const look = 2 + a.speed * 0.6;
      if (this.blocked(a.pos.x + Math.sin(a.heading) * look, a.pos.z + Math.cos(a.heading) * look)) {
        const left = !this.blocked(a.pos.x + Math.sin(a.heading + 1) * look, a.pos.z + Math.cos(a.heading + 1) * look);
        a.targetHeading = a.heading + (left ? 1.4 : -1.4);
        if (a.state === 'graze') {
          a.state = 'walk';
          a.timer = 2;
        }
      }

      a.speed += (targetSpeed - a.speed) * Math.min(1, dt * (a.state === 'flee' ? 3 : 1.6));
      // Turn only while moving, at a rate that grows with speed: no spinning in place.
      const moving = clamp(a.speed / c.walk, 0, 1);
      const diff = wrapAngle(a.targetHeading - a.heading);
      const maxTurn = c.turn * moving * dt;
      a.heading = wrapAngle(a.heading + clamp(diff, -maxTurn, maxTurn));

      a.pos.x += Math.sin(a.heading) * a.speed * dt;
      a.pos.z += Math.cos(a.heading) * a.speed * dt;
      this.colliders.query(a.pos.x, a.pos.z, 4, (col) => {
        const ox = a.pos.x - col.x;
        const oz = a.pos.z - col.z;
        const d = Math.hypot(ox, oz);
        const min = col.r + c.radius * 0.6;
        if (d < min && d > 1e-4) {
          a.pos.x += (ox / d) * (min - d);
          a.pos.z += (oz / d) * (min - d);
        }
      });
      a.pos.y = this.terrain.height(a.pos.x, a.pos.z);

      if (a.mixer) {
        // Clip by speed; playback rate follows ground speed so hooves do not slide.
        const key: ClipKey = a.speed > c.walk * 1.25 ? 'run' : a.speed > 0.35 ? 'walk' : a.state === 'graze' ? 'graze' : 'idle';
        this.play(a, key);
        const act = a.actions[key];
        if (act) act.timeScale = key === 'run' ? clamp(a.speed / (c.flee * 0.75), 0.6, 1.6) : key === 'walk' ? clamp(a.speed / (c.walk * 0.6), 0.5, 2) : 1;
        if (dist < 90) a.mixer.update(dt);
        a.group.position.copy(a.pos);
        a.group.rotation.y = a.heading;
        continue;
      }
      // Legs swing with distance travelled.
      a.legPhase += (a.speed * dt) / c.stride * Math.PI;
      const amp = clamp(a.speed / c.walk, 0, 1.4) * (a.species === 'rabbit' ? 0.7 : 0.45);
      if (a.species === 'rabbit') {
        const hop = a.state === 'flee' ? Math.abs(Math.sin(a.legPhase)) * 0.12 : Math.abs(Math.sin(a.legPhase)) * 0.03 * moving;
        a.body.position.y = hop;
        const s = Math.sin(a.legPhase);
        a.legs[0].rotation.x = s * amp;
        a.legs[1].rotation.x = s * amp;
        a.legs[2].rotation.x = -s * amp;
        a.legs[3].rotation.x = -s * amp;
      } else {
        const s = Math.sin(a.legPhase);
        a.legs[0].rotation.x = s * amp;
        a.legs[3].rotation.x = s * amp;
        a.legs[1].rotation.x = -s * amp;
        a.legs[2].rotation.x = -s * amp;
        a.body.position.y = Math.abs(Math.cos(a.legPhase)) * 0.04 * moving;
        if (a.head) {
          const grazing = a.state === 'graze' && a.speed < 0.2;
          a.head.rotation.x += ((grazing ? 1.1 : 0) - a.head.rotation.x) * Math.min(1, dt * 2.5);
        }
      }
      a.group.position.copy(a.pos);
      a.group.rotation.y = a.heading;
    }
  }
}
