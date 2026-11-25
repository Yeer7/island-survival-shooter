import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { PuffEmitter } from '../fx/particles';
import { buildLog, logMaterials } from '../weapons/models';
import { ColliderGrid } from './colliders';
import { Suitcase } from './landmarks';
import { ItemType } from './pickups';
import { Terrain } from './terrain';
import { detailTextures } from './textures';

function thatchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9c7f45';
  g.fillRect(0, 0, 128, 256);
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 128;
    const y = rnd() * 256;
    const l = 10 + rnd() * 26;
    g.strokeStyle = rnd() > 0.5 ? `rgba(196,164,96,${0.4 + rnd() * 0.5})` : `rgba(96,72,34,${0.3 + rnd() * 0.4})`;
    g.lineWidth = 1 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 4, y + l);
    g.stroke();
  }
  // Tied rings of straw.
  g.fillStyle = 'rgba(60,40,18,0.55)';
  for (let y = 40; y < 256; y += 64) g.fillRect(0, y, 128, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

/**
 * Tribal village in a clearing on the west side: two thatched huts, a central
 * fire, skull totems and lootable crates. Guarded by the tribe and its chief.
 */
export class Village {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  readonly crates: Suitcase[] = [];
  readonly fire: PuffEmitter;
  readonly smoke: PuffEmitter;
  readonly fireLight: THREE.PointLight;
  readonly radius = 26;
  private flicker = 0;

  constructor(private terrain: Terrain, colliders: ColliderGrid) {
    // Flattest dry spot in the west, away from the coast.
    let best = { x: -170, z: 0, score: Infinity };
    for (let x = -230; x <= -110; x += 6) {
      for (let z = -70; z <= 70; z += 6) {
        if (terrain.coastDistance(x, z) < 30) continue;
        const h = terrain.height(x, z);
        if (h < 3 || terrain.isInLake(x, z)) continue;
        let rough = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          rough += Math.abs(terrain.height(x + Math.cos(a) * 14, z + Math.sin(a) * 14) - h);
        }
        const score = rough + Math.abs(z) * 0.02;
        if (score < best.score) best = { x, z, score };
      }
    }
    this.center.set(best.x, terrain.height(best.x, best.z), best.z);
    const rand = mulberry32(808);
    const tex = detailTextures();
    const thatch = new THREE.MeshStandardMaterial({ map: thatchTexture(), roughness: 1, color: 0xd8c08a });
    const bark = logMaterials()[0];
    const bone = new THREE.MeshStandardMaterial({ color: 0xe9dfca, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x150c06, roughness: 1 });
    const red = new THREE.MeshStandardMaterial({ color: 0x9e2a22, roughness: 0.8 });
    void tex;

    const at = (dx: number, dz: number) => new THREE.Vector3(this.center.x + dx, this.terrain.height(this.center.x + dx, this.center.z + dz), this.center.z + dz);

    // Two huts (ocas): log ring wall and a tall cone of thatch, slightly irregular.
    for (const [dx, dz, s] of [
      [-9, -5, 1],
      [8, 6, 1.15],
    ]) {
      const p = at(dx, dz);
      const hut = new THREE.Group();
      hut.position.copy(p).y -= 0.15;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * s, 2.7 * s, 1.9 * s, 18, 1, true), bark);
      wall.position.y = 0.95 * s;
      const roofGeo = new THREE.ConeGeometry(3.5 * s, 3.4 * s, 18, 4, true);
      const rp = roofGeo.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const k = 1 + (rand() - 0.5) * 0.08;
        rp.setX(i, rp.getX(i) * k);
        rp.setZ(i, rp.getZ(i) * k);
      }
      roofGeo.computeVertexNormals();
      const roof = new THREE.Mesh(roofGeo, thatch);
      roof.position.y = 1.9 * s + 1.5 * s;
      const roofIn = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a14, side: THREE.BackSide }));
      roofIn.position.copy(roof.position);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1 * s, 1.6 * s), dark);
      const toCenter = Math.atan2(-dx, -dz);
      door.position.set(Math.sin(toCenter) * 2.62 * s, 0.8 * s, Math.cos(toCenter) * 2.62 * s);
      door.rotation.y = toCenter;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 6), thatch);
      tip.position.y = roof.position.y + 1.9 * s;
      for (const m of [wall, roof, tip]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      hut.add(wall, roof, roofIn, door, tip);
      this.group.add(hut);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        colliders.add({ x: p.x + Math.cos(a) * 2.5 * s, z: p.z + Math.sin(a) * 2.5 * s, r: 0.55, y0: p.y - 1, y1: p.y + 4, kind: 'rock', ref: 0 });
      }
    }

    // Central fire: ring of stones, logs and flames.
    const fp = at(0, 0);
    const stones = new THREE.MeshStandardMaterial({ color: 0x7c7972, roughness: 0.9, flatShading: true });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stones);
      st.position.set(fp.x + Math.cos(a) * 1.1, fp.y + 0.08, fp.z + Math.sin(a) * 1.1);
      st.scale.set(1, 0.7, 1);
      st.castShadow = true;
      this.group.add(st);
    }
    for (let k = 0; k < 4; k++) {
      const l = buildLog(1.4, 0.09);
      l.rotation.set(Math.PI / 2 - 0.5, (k / 4) * Math.PI * 2, 0, 'YXZ');
      l.position.set(fp.x + Math.cos((k / 4) * Math.PI * 2) * 0.25, fp.y + 0.35, fp.z + Math.sin((k / 4) * Math.PI * 2) * 0.25);
      this.group.add(l);
    }
    colliders.add({ x: fp.x, z: fp.z, r: 1.1, y0: fp.y - 1, y1: fp.y + 0.6, kind: 'rock', ref: 0 });
    this.fire = new PuffEmitter(40, { life: 0.9, rise: 1.9, spread: 0.9, size0: 1.6, size1: 0.3, alpha: 0.9, color: 0xff5a12, color2: 0xffd27a, additive: true });
    this.fire.origin.set(fp.x, fp.y + 0.3, fp.z);
    this.smoke = new PuffEmitter(28, { life: 5, rise: 1.8, spread: 0.6, size0: 1, size1: 5, alpha: 0.28, color: 0x3a3836, color2: 0x24221f, additive: false });
    this.smoke.origin.set(fp.x, fp.y + 1.5, fp.z);
    this.fireLight = new THREE.PointLight(0xff8a3a, 28, 24, 1.6);
    this.fireLight.position.set(fp.x, fp.y + 1.4, fp.z);

    // Skull totems around the clearing.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const p = at(Math.cos(a) * 15, Math.sin(a) * 15);
      const pole = buildLog(3.2, 0.12);
      pole.position.set(p.x, p.y + 1.5, p.z);
      pole.castShadow = true;
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), bone);
      skull.scale.set(1, 0.9, 1.15);
      skull.position.set(p.x, p.y + 3.25, p.z);
      skull.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
      skull.castShadow = true;
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.2), bone);
      jaw.position.set(p.x, p.y + 3.05, p.z);
      this.group.add(pole, skull, jaw);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), dark);
        const fx = -Math.cos(a);
        const fz = -Math.sin(a);
        eye.position.set(p.x + fx * 0.22 + -fz * side * 0.09, p.y + 3.28, p.z + fz * 0.22 + fx * side * 0.09);
        this.group.add(eye);
      }
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 4, 10), red);
      band.rotation.x = Math.PI / 2;
      band.position.set(p.x, p.y + 2.6, p.z);
      this.group.add(band);
      colliders.add({ x: p.x, z: p.z, r: 0.25, y0: p.y - 1, y1: p.y + 3.4, kind: 'rock', ref: 0 });
    }

    // Lootable crates (opened like the luggage).
    const plank = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a6440).multiplyScalar(1.3), roughness: 0.9, map: tex.plank });
    const loot: ItemType[][] = [
      ['food', 'cloth'],
      ['bandage', 'food'],
      ['cloth', 'bandage'],
      ['food', 'food'],
    ];
    loot.forEach((contents, i) => {
      const a = rand() * Math.PI * 2;
      const r = 5 + rand() * 6;
      const p = at(Math.cos(a) * r + (i % 2 ? 3 : -3), Math.sin(a) * r);
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.55), plank);
      box.position.y = 0.27;
      box.castShadow = true;
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.77, 0.06, 0.57), new THREE.MeshStandardMaterial({ color: 0x3b2a1a }));
      strap.position.y = 0.4;
      g.add(box, strap);
      g.position.set(p.x, p.y - 0.03, p.z);
      g.rotation.y = rand() * Math.PI;
      this.crates.push({ mesh: g, pos: new THREE.Vector3(p.x, p.y + 0.27, p.z), hp: 50, color: 0x8a6440, contents, broken: false });
    });
  }

  update(dt: number, light: THREE.Color): void {
    this.fire.update(dt);
    this.smoke.setTint(new THREE.Color(0x3a3836).multiply(light), new THREE.Color(0x24221f).multiply(light));
    this.smoke.update(dt);
    this.flicker += dt;
    this.fireLight.intensity = 26 + Math.sin(this.flicker * 15) * 4 + Math.sin(this.flicker * 6.7) * 3;
  }
}
