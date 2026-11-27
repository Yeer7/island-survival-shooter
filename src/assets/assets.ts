import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * CC0 models shipped in public/assets (sources and licences in ASSETS_LICENSE.md).
 * Every model is normalised on load to the project convention: metres, +Y up,
 * origin at the base (feet), centred on X/Z.
 */
export const ASSET_FILES = {
  rockLarge: 'assets/nature/rock_large.glb',
  rockMedium: 'assets/nature/rock_medium.glb',
  rockCliff: 'assets/nature/rock_cliff.glb',
  rockTall: 'assets/nature/rock_tall.glb',
  rockRound: 'assets/nature/rock_round.glb',
  rockSmall: 'assets/nature/rock_small.glb',
  pebble: 'assets/nature/pebble.glb',
  grass: 'assets/ultimate/Grass_Small.gltf',
  can: 'assets/survivalpack/Can_Red.fbx',
  backpack: 'assets/survivalpack/Backpack.fbx',
  tent: 'assets/survivalpack/Tent.fbx',
  pot: 'assets/survivalpack/Pot.fbx',
  woodTorch: 'assets/survivalpack/WoodenTorch.fbx',
  woodLog: 'assets/survivalpack/WoodLog.fbx',
  radio: 'assets/survivalpack/Radio.fbx',
  gasCan: 'assets/survivalpack/GasCan.fbx',
  shovel: 'assets/survivalpack/Shovel.fbx',
  waterBottle: 'assets/survivalpack/WaterBottle_1.fbx',
  battery: 'assets/survivalpack/Battery_Big.fbx',
  propane: 'assets/survivalpack/PropaneTank.fbx',
  canOpen: 'assets/survivalpack/Can_Open.fbx',
  pan: 'assets/survivalpack/Pan.fbx',
  crystalCluster: 'assets/cave/crystal_cluster.glb',
  crystalSpire: 'assets/cave/crystal_spire.glb',
  mineral: 'assets/cave/mineral.glb',
  mushroom: 'assets/cave/mushroom.glb',
  mushroomCluster: 'assets/cave/mushroom_cluster.glb',
  skull: 'assets/village/skull.glb',
  bone: 'assets/village/bone.glb',
  crate: 'assets/village/crate.glb',
  barrel: 'assets/village/barrel.glb',
  cauldron: 'assets/village/cauldron.glb',
  deer: 'assets/animals/deer.glb',
  enemyHuman: 'assets/enemies/tribal_human.glb',
  enemySkeleton: 'assets/enemies/cave_skeleton.glb',
  enemySpider: 'assets/enemies/cave_spider.glb',
  enemyDeepLord: 'assets/enemies/deep_lord.glb',
  stag: 'assets/animals/stag.glb',
  bow: 'assets/tools/bow.glb',
  arrow: 'assets/tools/arrow.glb',
  spear: 'assets/tools/spear.glb',
  torch: 'assets/tools/torch.glb',
  rod: 'assets/tools/fishing_rod.glb',
  campfire: 'assets/survival/campfire-pit.glb',
  fish: 'assets/survival/fish.glb',
} as const;

export type AssetName = keyof typeof ASSET_FILES;

/** FBX files reference textures by absolute paths from the author's disk, so their
 *  materials are rebuilt from these resized copies (matched by material name). */
const FBX_TEXTURES: Record<string, { leaves: string; bark: string }> = {
  palm: { leaves: 'assets/ultimate/PalmTree_Leaves.png', bark: 'assets/ultimate/PalmTree_Trunk.jpg' },
};

/** Flat-coloured SurvivalPack props regraded so they read on the ground (by material name). */
const FBX_RECOLOR: Partial<Record<AssetName, Record<string, { color: number; metalness?: number; roughness?: number }>>> = {
  // Tin can (a cave prop): red body, yellow label band, bright tin rims.
  can: { Grey: { color: 0xc8362a, roughness: 0.55 }, Red: { color: 0xf2c230, roughness: 0.6 }, LightGrey: { color: 0xc9ccd0, metalness: 0.6, roughness: 0.35 } },
  // Village: the camping tent becomes a tanned-hide shelter on wooden poles.
  tent: { Green: { color: 0x8a6442, roughness: 0.9 }, LightGreen: { color: 0xa98058, roughness: 0.9 }, DarkWood: { color: 0x5a3d26, roughness: 0.9 }, Black: { color: 0x2e2419, roughness: 0.95 } },
  pot: { Black: { color: 0x26221e, roughness: 0.7 }, Grey: { color: 0x4d4741, roughness: 0.6 } },
  woodTorch: { DarkWood: { color: 0x5e402a, roughness: 0.9 }, LightGrey: { color: 0xcdbf9f, roughness: 0.95 }, Yellow: { color: 0x9c7a3c, roughness: 0.9 } },
  woodLog: { Wood: { color: 0x6e4c31, roughness: 0.92 }, LightWood: { color: 0xbf9866, roughness: 0.9 } },
};

export interface LoadedAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface InstancePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();

/** Fix material settings that do not survive instancing (blend → cut-out). */
function fixMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (sm.transparent || sm.alphaTest > 0 || (sm.map && sm.name.toLowerCase().match(/leaf|leaves|bush|fern|flower/))) {
        sm.transparent = false;
        sm.alphaTest = 0.45;
        sm.depthWrite = true;
        sm.side = THREE.DoubleSide;
      }
      // No environment map in this scene, so metal reads black: keep these natural assets dielectric.
      if (sm.metalness !== undefined && !sm.metalnessMap) sm.metalness = Math.min(sm.metalness, 0.05);
    }
  });
}

export class AssetLibrary {
  private items = new Map<AssetName, LoadedAsset>();

  async load(onProgress: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    // Point the FBX's own texture lookups at a 1-pixel image so they never 404;
    // the real (resized) textures are assigned below.
    const fbxManager = new THREE.LoadingManager();
    const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    fbxManager.setURLModifier((u) => (/\.(png|jpe?g|tga|bmp|psd)$/i.test(u) ? BLANK : u));
    const fbx = new FBXLoader(fbxManager);
    const texLoader = new THREE.TextureLoader();
    const texCache = new Map<string, Promise<THREE.Texture>>();
    const tex = (url: string, srgb: boolean) => {
      let t = texCache.get(url);
      if (!t) {
        t = texLoader.loadAsync(url).then((x) => {
          if (srgb) x.colorSpace = THREE.SRGBColorSpace;
          return x;
        });
        texCache.set(url, t);
      }
      return t;
    };
    const names = Object.keys(ASSET_FILES) as AssetName[];
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        const url = ASSET_FILES[name];
        if (url.endsWith('.fbx')) {
          const group = await fbx.loadAsync(url);
          const set = FBX_TEXTURES[name.replace(/\d+$/, '')];
          const leaves = set ? await tex(set.leaves, true) : null;
          const bark = set ? await tex(set.bark, true) : null;
          group.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const old = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
            const rebuilt = old.map((mat) => {
              if (!set) {
                // Flat-coloured low-poly FBX (SurvivalPack): keep its colours, make it PBR.
                const src = mat as THREE.MeshPhongMaterial;
                const re = FBX_RECOLOR[name]?.[mat.name];
                if (re) return new THREE.MeshStandardMaterial({ name: mat.name, color: re.color, roughness: re.roughness ?? 0.75, metalness: re.metalness ?? 0 });
                return new THREE.MeshStandardMaterial({ name: mat.name, color: src.color ? src.color.clone() : new THREE.Color(0xcccccc), roughness: 0.75, metalness: 0 });
              }
              const isLeaf = /leaf|leaves/i.test(mat.name);
              return new THREE.MeshStandardMaterial({
                name: mat.name,
                map: isLeaf ? leaves : bark,
                roughness: 0.9,
                metalness: 0,
                alphaTest: isLeaf ? 0.45 : 0,
                side: isLeaf ? THREE.DoubleSide : THREE.FrontSide,
              });
            });
            m.material = rebuilt.length === 1 ? rebuilt[0] : rebuilt;
          });
          const wrap = new THREE.Group();
          wrap.add(group);
          fixMaterials(wrap);
          this.items.set(name, { scene: wrap, animations: [] });
        } else {
          const gltf = await loader.loadAsync(url);
          fixMaterials(gltf.scene);
          // Skulls and bones: weathered bone-white instead of the pack's muddy beige.
          if (name === 'skull' || name === 'bone') {
            gltf.scene.traverse((o) => {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
              if ((o as THREE.Mesh).isMesh && m?.color) {
                m.color.setHex(0xe4d8bc);
                m.roughness = 0.7;
              }
            });
          }
          this.items.set(name, { scene: gltf.scene, animations: gltf.animations });
        }
        onProgress(++done, names.length);
      }),
    );
  }

  has(name: AssetName): boolean {
    return this.items.has(name);
  }

  raw(name: AssetName): LoadedAsset {
    const a = this.items.get(name);
    if (!a) throw new Error(`asset ${name} not loaded`);
    return a;
  }

  /**
   * A normalised copy: base at y=0, centred on X/Z. `fit` scales so the given
   * measure (height, or the largest extent) equals `value` metres.
   */
  instance(name: AssetName, fit?: { by: 'height' | 'max' | 'footprint'; value: number }): THREE.Group {
    const src = this.raw(name);
    const clone = (src.animations.length ? SkeletonUtils.clone(src.scene) : src.scene.clone(true)) as THREE.Group;
    return normalize(clone, fit);
  }

  /**
   * Bakes every mesh of a model into normalised geometries (one per material) so
   * it can be drawn with InstancedMesh. `pick` keeps only the n-th child of the
   * root when a file holds several variants side by side.
   */
  parts(name: AssetName, fit: { by: 'height' | 'max' | 'footprint'; value: number }, pick?: number): InstancePart[] {
    let root: THREE.Object3D = this.raw(name).scene.clone(true);
    if (pick !== undefined) {
      const holder = root.children.length === 1 && root.children[0].children.length > 1 ? root.children[0] : root;
      const chosen = holder.children[Math.min(pick, holder.children.length - 1)];
      root.updateMatrixWorld(true);
      const solo = new THREE.Group();
      const c = chosen.clone(true);
      chosen.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      solo.add(c);
      root = solo;
    }
    const g = normalize(root as THREE.Group, fit);
    g.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const keep = ['position', 'normal', 'uv', 'color'];
      for (const k of Object.keys(geo.attributes)) if (!keep.includes(k)) geo.deleteAttribute(k);
      const flat = geo.index ? geo.toNonIndexed() : geo;
      const add = (mat: THREE.Material, g2: THREE.BufferGeometry) => {
        const list = byMat.get(mat) ?? [];
        list.push(g2);
        byMat.set(mat, list);
      };
      if (Array.isArray(m.material) && flat.groups.length) {
        // Multi-material meshes (e.g. FBX trunk + leaves): one geometry per material group.
        for (const grp of flat.groups) {
          const sub = new THREE.BufferGeometry();
          for (const [k, attr] of Object.entries(flat.attributes)) {
            const a = attr as THREE.BufferAttribute;
            const arr = (a.array as Float32Array).slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize);
            sub.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
          }
          add(m.material[grp.materialIndex ?? 0], sub);
        }
      } else {
        add(Array.isArray(m.material) ? m.material[0] : m.material, flat);
      }
    });
    const out: InstancePart[] = [];
    byMat.forEach((geos, material) => {
      const merged = geos.length === 1 ? geos[0] : mergeSimple(geos);
      merged.computeBoundingSphere();
      out.push({ geometry: merged, material });
    });
    return out;
  }
}

/** Concatenate non-indexed geometries that share attributes. */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const itemSize = geos[0].attributes[n].itemSize;
    const total = geos.reduce((s, g) => s + g.attributes[n].count * itemSize, 0);
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of geos) {
      const a = g.attributes[n] as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < itemSize; k++) arr[off++] = a.getComponent(i, k);
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, itemSize));
  }
  return out;
}

export function normalize(obj: THREE.Group, fit?: { by: 'height' | 'max' | 'footprint'; value: number }): THREE.Group {
  obj.position.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  box.setFromObject(obj, true);
  box.getSize(size);
  box.getCenter(center);
  let s = 1;
  if (fit) {
    const measure = fit.by === 'height' ? size.y : fit.by === 'footprint' ? Math.max(size.x, size.z) : Math.max(size.x, size.y, size.z);
    s = measure > 0 ? fit.value / measure : 1;
  }
  const wrap = new THREE.Group();
  obj.scale.multiplyScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  wrap.add(obj);
  wrap.userData.size = size.clone().multiplyScalar(s);
  return wrap;
}

let current: AssetLibrary | null = null;

/** The loaded library, shared by every model builder. */
export function setLibrary(l: AssetLibrary): void {
  current = l;
}

export function library(): AssetLibrary | null {
  return current;
}
