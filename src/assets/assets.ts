import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * CC0 models shipped in public/assets (sources and licences in ASSETS_LICENSE.md).
 * Every model is normalised on load to the project convention: metres, +Y up,
 * origin at the base (feet), centred on X/Z.
 */
export const ASSET_FILES = {
  pineA: 'assets/nature/pine_a.glb',
  pineB: 'assets/nature/pine_b.glb',
  pineC: 'assets/nature/pine_c.glb',
  rockLarge: 'assets/nature/rock_large.glb',
  rockMedium: 'assets/nature/rock_medium.glb',
  rockCliff: 'assets/nature/rock_cliff.glb',
  rockTall: 'assets/nature/rock_tall.glb',
  rockRound: 'assets/nature/rock_round.glb',
  rockSmall: 'assets/nature/rock_small.glb',
  pebble: 'assets/nature/pebble.glb',
  bush: 'assets/nature/bush.glb',
  fern: 'assets/nature/fern.glb',
  stump: 'assets/nature/stump.glb',
  deer: 'assets/animals/deer.glb',
  stag: 'assets/animals/stag.glb',
  bow: 'assets/tools/bow.glb',
  arrow: 'assets/tools/arrow.glb',
  spear: 'assets/tools/spear.glb',
  torch: 'assets/tools/torch.glb',
  rod: 'assets/tools/fishing_rod.glb',
  axe: 'assets/survival/tool-axe.glb',
  axeUpgraded: 'assets/survival/tool-axe-upgraded.glb',
  workbench: 'assets/survival/workbench.glb',
  campfire: 'assets/survival/campfire-pit.glb',
  fish: 'assets/survival/fish.glb',
} as const;

export type AssetName = keyof typeof ASSET_FILES;

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
    const names = Object.keys(ASSET_FILES) as AssetName[];
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        const gltf = await loader.loadAsync(ASSET_FILES[name]);
        fixMaterials(gltf.scene);
        this.items.set(name, { scene: gltf.scene, animations: gltf.animations });
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
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const list = byMat.get(mat) ?? [];
      list.push(geo.index ? geo.toNonIndexed() : geo);
      byMat.set(mat, list);
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
