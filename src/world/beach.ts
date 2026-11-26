import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';
import { Suitcase } from './landmarks';
import { ItemType } from './pickups';
import { Terrain } from './terrain';
import { detailTextures } from './textures';
import { addWind } from './vegetation';

/**
 * Life on the southern beach: barrels and crates washed ashore (break them like the
 * luggage), driftwood logs and loose pebbles to pick up, and shore life laid along the
 * narrower sand strip: starfish, scallops and whelks, seaweed at the tide line, smooth
 * coastal rocks and wet pebbles by the water, and beach grass where sand meets grass.
 */
export class Beach {
  readonly group = new THREE.Group();
  readonly breakables: Suitcase[] = [];
  readonly driftwood: { x: number; y: number; z: number; rotY: number }[] = [];
  readonly pebbles: THREE.Vector3[] = [];

  constructor(private terrain: Terrain, avoid: { x: number; z: number; r: number }[]) {
    const rand = mulberry32(2024);
    const spot = (minCoast: number, maxCoast: number): THREE.Vector3 | null => {
      for (let k = 0; k < 200; k++) {
        const a = Math.PI * (0.1 + rand() * 0.8);
        const r = terrain.islandRadius(Math.cos(a), Math.sin(a)) * (0.86 + rand() * 0.1);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (z < 35) continue;
        const cd = terrain.coastDistance(x, z);
        const h = terrain.height(x, z);
        const surf = terrain.surfaceAt(x, z);
        if (cd < minCoast || cd > maxCoast || h < 0.12 || surf === 'water' || surf === 'grass') continue;
        if (avoid.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
        return new THREE.Vector3(x, h, z);
      }
      return null;
    };

    const tex = detailTextures();
    const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.25), roughness: 0.9, map: tex.plank });
    const band = new THREE.MeshStandardMaterial({ color: 0x3d3a36, roughness: 0.6, metalness: 0.2 });
    const loot: ItemType[][] = [
      ['cloth', 'food'],
      ['bandage'],
      ['food', 'cloth'],
      ['cloth'],
      ['food', 'bandage'],
      ['cloth', 'cloth'],
      ['food'],
      ['bandage', 'cloth'],
    ];
    loot.forEach((contents, i) => {
      const p = spot(1, 18);
      if (!p) return;
      const g = new THREE.Group();
      const barrel = i % 2 === 0;
      if (barrel) {
        // Barrel lying on its side, half sunk in the sand.
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 14), wood);
        body.rotation.z = Math.PI / 2;
        body.position.y = 0.22;
        body.castShadow = true;
        g.add(body);
        for (const x of [-0.28, 0, 0.28]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.02, 4, 16), band);
          ring.rotation.y = Math.PI / 2;
          ring.position.set(x, 0.22, 0);
          g.add(ring);
        }
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.55), wood);
        box.position.y = 0.2;
        box.rotation.set(0.12, 0, 0.08);
        box.castShadow = true;
        g.add(box);
      }
      g.position.set(p.x, p.y - 0.05, p.z);
      g.rotation.y = rand() * Math.PI * 2;
      this.breakables.push({ mesh: g, pos: new THREE.Vector3(p.x, p.y + 0.22, p.z), hp: 50, color: 0x8a6440, contents, broken: false });
    });

    // ---------------------------------------------------------------- shore life
    // Everything below is instanced: one draw per kind. Spots are picked by height on
    // the sand so they follow the (narrower) beach: wet sand at the waterline, the tide
    // line a little higher, beach grass where the sand meets the grass.
    const shore = (hMin: number, hMax: number): THREE.Vector3 | null => {
      for (let k = 0; k < 300; k++) {
        const a = Math.PI * (0.06 + rand() * 0.88);
        const r = terrain.islandRadius(Math.cos(a), Math.sin(a)) * (0.8 + rand() * 0.22);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (z < 30) continue;
        const h = terrain.height(x, z);
        if (h < hMin || h > hMax || terrain.slope(x, z) > 0.25) continue;
        if (avoid.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
        return new THREE.Vector3(x, h, z);
      }
      return null;
    };
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const scatter = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, place: (i: number) => { p: THREE.Vector3; yaw: number; s: number; tilt?: number; c: THREE.Color } | null, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      let n = 0;
      for (let i = 0; i < count; i++) {
        const q = place(i);
        if (!q) continue;
        d.position.copy(q.p);
        d.rotation.set(q.tilt ?? 0, q.yaw, 0, 'YXZ');
        d.scale.setScalar(q.s);
        d.updateMatrix();
        m.setMatrixAt(n, d.matrix);
        m.setColorAt(n, q.c);
        n++;
      }
      m.count = n;
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const top = (z: number) => terrain.beachTopAt(z);

    // Starfish: a raised central disc and five plump, tapering arms, each studded with a
    // row of pale tubercles; ~18-26 cm across.
    const starGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const add = (g: THREE.BufferGeometry, shade: number) => {
        g.deleteAttribute('uv');
        const n = g.index ? g.toNonIndexed() : g;
        n.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 3).fill(shade), 3));
        parts.push(n);
      };
      const disc = new THREE.SphereGeometry(0.03, 14, 7);
      disc.scale(1, 0.5, 1);
      disc.translate(0, 0.008, 0);
      add(disc, 0.9);
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2;
        const arm = new THREE.SphereGeometry(1, 14, 7);
        const ap = arm.attributes.position;
        for (let i = 0; i < ap.count; i++) {
          const x = (ap.getX(i) + 1) * 0.052;
          const taper = 1 - (x / 0.104) * 0.72;
          ap.setXYZ(i, x, ap.getY(i) * 0.013 * taper + 0.006, ap.getZ(i) * 0.024 * taper);
        }
        arm.computeVertexNormals();
        arm.rotateY(ang);
        add(arm, 1);
        for (let t = 0; t < 4; t++) {
          const x = 0.02 + t * 0.02;
          const bump = new THREE.SphereGeometry(0.0055 * (1 - t * 0.15), 6, 4);
          bump.translate(x, 0.006 + 0.012 * (1 - (x / 0.104) * 0.72), 0);
          bump.rotateY(ang);
          add(bump, 1.25);
        }
      }
      return mergeGeometries(parts, false)!;
    })();
    const starMat = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true });
    const starCols = [0xe8703a, 0xc24a2a, 0xb8782e, 0xd9592f];
    scatter(starGeo, starMat, 55, () => {
      const p = shore(0.06, 0.7);
      if (!p) return null;
      return { p: p.add(new THREE.Vector3(0, 0.012, 0)), yaw: rand() * 6.3, s: 0.85 + rand() * 0.35, c: col.setHex(starCols[Math.floor(rand() * starCols.length)]).multiplyScalar(0.9 + rand() * 0.2) };
    });

    // Shell colour is painted per vertex (growth bands on the scallop, a spiral band on
    // the whelk) and tinted per instance, so no two shells read the same.
    const paint = (g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => number) => {
      const p = g.attributes.position;
      const c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) c.fill(f(p.getX(i), p.getY(i), p.getZ(i)), i * 3, i * 3 + 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    };

    // Scallops: a domed fan with radiating ribs, scalloped rim, growth bands and the two
    // small hinge ears; ~12-18 cm.
    const fan = (() => {
      const R = 12;
      const A = 28;
      const pos: number[] = [];
      const idx: number[] = [];
      const shade: number[] = [];
      for (let i = 0; i <= R; i++) {
        const u = i / R;
        for (let j = 0; j <= A; j++) {
          const th = -1.2 + (2.4 * j) / A;
          const rib = Math.cos(th * 14);
          const r = u * 0.075 * (1 + rib * 0.035 * u);
          const dome = (1 - u * u) * 0.014 + 0.003 + Math.max(0, rib) * 0.004 * u;
          pos.push(Math.sin(th) * r, dome, Math.cos(th) * r - 0.035);
          shade.push(0.78 + 0.16 * Math.max(0, rib) + 0.08 * Math.sin(u * 38));
        }
      }
      for (let i = 0; i < R; i++) {
        for (let j = 0; j < A; j++) {
          const a = i * (A + 1) + j;
          const b = a + A + 1;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(shade.flatMap((v) => [v, v * 0.97, v * 0.95]), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const ears = new THREE.CylinderGeometry(0.018, 0.006, 0.004, 3);
      ears.scale(1.4, 1, 0.6);
      ears.translate(0, 0.004, -0.036);
      ears.deleteAttribute('uv');
      paint(ears, () => 0.8);
      return mergeGeometries([g.toNonIndexed(), ears.toNonIndexed()], false)!;
    })();
    const shellMat = new THREE.MeshStandardMaterial({ roughness: 0.55, vertexColors: true, side: THREE.DoubleSide });
    const shellCols = [0xf0dcc4, 0xeccabc, 0xe2c09c, 0xf2e4d2, 0xe6b8a8];
    scatter(fan, shellMat, 70, () => {
      const p = shore(0.05, 1.1);
      if (!p) return null;
      return { p: p.add(new THREE.Vector3(0, 0.003, 0)), yaw: rand() * 6.3, s: 1.1 + rand() * 0.6, tilt: (rand() - 0.5) * 0.3, c: col.setHex(shellCols[Math.floor(rand() * shellCols.length)]) };
    });

    // Whelks: a turned spire with shouldered whorls and a spiral colour band, lying on
    // its side with the flared aperture down; ~14-22 cm.
    const whelk = (() => {
      const L = 0.15;
      const turns = 5.5;
      const prof: THREE.Vector2[] = [];
      for (let k = 0; k <= 48; k++) {
        const y = L * (1 - k / 48);
        const e = Math.pow(1 - y / L, 0.85) * 0.036;
        const f = ((y / L) * turns) % 1;
        const shoulder = 0.82 + 0.18 * Math.sin(Math.min(1, f * 1.4) * Math.PI);
        prof.push(new THREE.Vector2(Math.max(0.0008, e * shoulder), y));
      }
      prof.push(new THREE.Vector2(0.0005, -0.004));
      const lathe = new THREE.LatheGeometry(prof, 16);
      lathe.deleteAttribute('uv');
      paint(lathe, (x, y, z) => {
        const ang = Math.atan2(z, x);
        return 0.8 + 0.14 * Math.sin(ang + (y / L) * turns * Math.PI * 2) + 0.06 * Math.sin(y * 300);
      });
      const lip = new THREE.SphereGeometry(0.028, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      lip.scale(1, 0.55, 1.35);
      lip.rotateX(Math.PI);
      lip.translate(0, 0.012, 0.006);
      lip.deleteAttribute('uv');
      paint(lip, () => 0.95);
      const m = mergeGeometries([lathe.toNonIndexed(), lip.toNonIndexed()], false)!;
      m.rotateZ(Math.PI / 2);
      m.translate(0, 0.028, 0);
      return m;
    })();
    scatter(whelk, shellMat, 40, () => {
      const p = shore(0.05, 1.0);
      if (!p) return null;
      return { p, yaw: rand() * 6.3, s: 0.95 + rand() * 0.5, c: col.setHex(shellCols[Math.floor(rand() * shellCols.length)]).lerp(new THREE.Color(0xc89a70), 0.2 + rand() * 0.4) };
    });

    // Seaweed: a tangled wrack of thin, tapering fronds with small air bladders, washed
    // up along the tide line. Each strand wanders, so no clump reads as a flat strip.
    const weed = (() => {
      const r = mulberry32(11);
      const pos: number[] = [];
      const cols: number[] = [];
      const idx: number[] = [];
      const parts: THREE.BufferGeometry[] = [];
      for (let s = 0; s < 16; s++) {
        // Strands start spread along the clump's long axis and mostly run along it,
        // so the wrack lies as a tangled line on the tide mark, not a radiating hand.
        let x = (r() - 0.5) * 0.6;
        let z = (r() - 0.5) * 0.1;
        let a = (r() - 0.5) * 0.8 + (s % 2 ? Math.PI : 0);
        const len = 0.45 + r() * 0.45;
        const w0 = 0.016 + r() * 0.018;
        const shade = 0.7 + r() * 0.45;
        const N = 12;
        const base = pos.length / 3;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const w = w0 * (1 - t * 0.75) * (0.8 + 0.2 * Math.sin(t * 20 + s));
          const nx = -Math.sin(a);
          const nz = Math.cos(a);
          const y = 0.006 + s * 0.0015 + Math.abs(Math.sin(t * 9 + s)) * 0.008;
          pos.push(x + nx * w, y, z + nz * w, x - nx * w, y + 0.002, z - nz * w);
          const c = shade * (1 - t * 0.25);
          cols.push(c, c, c, c * 0.9, c * 0.9, c * 0.9);
          // Wound to face up (lit like the sand it lies on).
          if (k < N) idx.push(base + k * 2, base + k * 2 + 2, base + k * 2 + 1, base + k * 2 + 1, base + k * 2 + 2, base + k * 2 + 3);
          a += (r() - 0.5) * 0.5;
          x += Math.cos(a) * (len / N);
          z += Math.sin(a) * (len / N);
          if (k % 3 === 1 && r() < 0.45) {
            const bl = new THREE.SphereGeometry(0.009 + r() * 0.006, 6, 4);
            bl.scale(1, 0.7, 1);
            bl.translate(x, y + 0.004, z);
            const n = bl.toNonIndexed();
            n.deleteAttribute('uv');
            const bc = new Float32Array(n.attributes.position.count * 3).fill(shade * 0.8);
            n.setAttribute('color', new THREE.BufferAttribute(bc, 3));
            parts.push(n);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(idx);
      return mergeGeometries([g.toNonIndexed(), ...parts], false)!;
    })();
    const weedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, vertexColors: true });
    const weedCols = [0x5a5a2a, 0x4a4b22, 0x635228, 0x47401f];
    scatter(weed, weedMat, 110, () => {
      const p = shore(0.25, 0.75);
      if (!p) return null;
      // Laid roughly along the shore (perpendicular to the way inland).
      const along = Math.atan2(p.x, p.z) + Math.PI / 2 + (rand() - 0.5) * 0.9;
      return { p, yaw: along, s: 0.55 + rand() * 0.45, c: col.setHex(weedCols[Math.floor(rand() * weedCols.length)]) };
    });

    // Coastal rocks: smooth, flattened boulders in small groups by the water.
    const rockGeo = new THREE.DodecahedronGeometry(0.35, 1);
    {
      const pos = rockGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * 0.55);
      rockGeo.computeVertexNormals();
    }
    const rockMat = new THREE.MeshStandardMaterial({ map: tex.rock, roughness: 0.8 });
    let group: THREE.Vector3 | null = null;
    scatter(
      rockGeo,
      rockMat,
      48,
      (i) => {
        if (i % 4 === 0) group = shore(-0.3, 0.45);
        if (!group) return null;
        const p = group.clone().add(new THREE.Vector3((rand() - 0.5) * 2.2, 0, (rand() - 0.5) * 2.2));
        p.y = terrain.height(p.x, p.z) - 0.05;
        return { p, yaw: rand() * 6.3, s: 0.5 + rand() * 1.1, c: col.setScalar(0.62 + rand() * 0.2) };
      },
      true,
    );
    // Wet pebbles concentrated at the water's edge.
    const pebbleGeo = new THREE.DodecahedronGeometry(0.035, 0);
    pebbleGeo.scale(1, 0.55, 1.2);
    scatter(pebbleGeo, rockMat, 260, () => {
      const p = shore(-0.15, 0.35);
      if (!p) return null;
      return { p: p.add(new THREE.Vector3(0, 0.008, 0)), yaw: rand() * 6.3, s: 0.6 + rand() * 1.2, c: col.setScalar(0.45 + rand() * 0.35) };
    });

    // Beach grass: thin dry / olive blades in tufts where the sand meets the grass.
    const tuft = (() => {
      const pos: number[] = [];
      const idx: number[] = [];
      const r = mulberry32(5);
      for (let b = 0; b < 22; b++) {
        const a = r() * Math.PI * 2;
        const off = r() * 0.12;
        const h = 0.35 + r() * 0.3;
        const lean = 0.12 + r() * 0.2;
        const bx = Math.cos(a) * off;
        const bz = Math.sin(a) * off;
        const f = r() * Math.PI;
        const fx = Math.cos(f) * 0.012;
        const fz = Math.sin(f) * 0.012;
        const base = pos.length / 3;
        for (let k = 0; k <= 2; k++) {
          const t = k / 2;
          const w = k === 2 ? 0.0008 : 1 - t * 0.6;
          const cx = bx + Math.cos(a) * lean * t * t;
          const cz = bz + Math.sin(a) * lean * t * t;
          pos.push(cx - fx * w, h * t, cz - fz * w, cx + fx * w, h * t, cz + fz * w);
        }
        for (let k = 0; k < 2; k++) {
          const i0 = base + k * 2;
          idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const nrm = new Float32Array(pos.length);
      for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setIndex(idx);
      return g;
    })();
    const grassMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
    addWind(grassMat, 0.05, 0.18);
    // Keep the up-normal on back faces too, or half the blades render black.
    const windCompile = grassMat.onBeforeCompile;
    grassMat.onBeforeCompile = (shader, renderer) => {
      windCompile.call(grassMat, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    };
    grassMat.customProgramCacheKey = () => 'beach-grass-up-normals';
    const grassCols = [0x9a9a5a, 0x7d8a48, 0xb4a66a, 0x6f7d3e];
    scatter(tuft, grassMat, 240, () => {
      for (let k = 0; k < 20; k++) {
        const p = shore(0.4, 3.2);
        if (!p) return null;
        const tp = top(p.z);
        // Only along the band where dry sand meets grass, irregularly.
        if (p.y < tp - 0.55 || p.y > tp + 0.35) continue;
        return { p: p.add(new THREE.Vector3(0, -0.02, 0)), yaw: rand() * 6.3, s: 0.8 + rand() * 0.7, c: col.setHex(grassCols[Math.floor(rand() * grassCols.length)]) };
      }
      return null;
    });


    for (let k = 0; k < 7; k++) {
      const p = spot(2, 20);
      if (p) this.driftwood.push({ x: p.x, y: p.y, z: p.z, rotY: rand() * Math.PI });
    }
    for (let k = 0; k < 16; k++) {
      const p = spot(0, 22);
      if (p) this.pebbles.push(p);
    }
  }
}
