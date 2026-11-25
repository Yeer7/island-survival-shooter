import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge every static mesh under `root` into one mesh per material, expressed in
 * `root`'s own space. A hand-built set piece made of hundreds of logs, stakes and
 * props then costs one draw call per material instead of one per piece.
 * Meshes flagged `userData.keep` (things that move or break) are left alone.
 */
export function bakeStatic(root: THREE.Object3D): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const consumed: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || m.userData.keep || hasKeptAncestor(m, root)) return;
    consumed.push(m);
    rel.multiplyMatrices(inv, m.matrixWorld);
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(rel);
    if (!g.attributes.normal) g.computeVertexNormals();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    // Groups only pick materials from an array; with one material the whole geometry uses it.
    const groups = Array.isArray(m.material) && g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat) continue;
      const part = slice(g, gr.start, Math.min(gr.count, g.attributes.position.count - gr.start));
      let b = buckets.get(mat);
      if (!b) {
        b = { geos: [], shadow: false };
        buckets.set(mat, b);
      }
      b.geos.push(part);
      b.shadow ||= m.castShadow;
    }
    g.dispose();
  });
  for (const m of consumed) m.parent?.remove(m);
  const out: THREE.Mesh[] = [];
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}

function hasKeptAncestor(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData.keep) return true;
  return false;
}

/** A copy of vertices [start, start+count) with only position, normal and uv (uv zero-filled if absent). */
function slice(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const copy = (name: string, size: number) => {
    const src = g.attributes[name] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    const arr = new Float32Array(count * size);
    if (src) {
      for (let i = 0; i < count; i++) {
        const j = start + i;
        arr[i * size] = src.getX(j);
        arr[i * size + 1] = src.getY(j);
        if (size > 2) arr[i * size + 2] = src.getZ(j);
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  copy('position', 3);
  copy('normal', 3);
  copy('uv', 2);
  return out;
}
