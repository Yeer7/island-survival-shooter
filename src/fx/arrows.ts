import * as THREE from 'three';
import { buildArrow } from '../weapons/models';

export interface ArrowHitInfo {
  point: THREE.Vector3;
  dir: THREE.Vector3;
  quat: THREE.Quaternion;
}

interface Flight {
  mesh: THREE.Group;
  trail: THREE.Line;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  active: boolean;
  trailFade: number;
}

const GRAVITY = 6.5;

/**
 * Physical arrows: fixed pool, gravity, a short fading trail, and a segment ray
 * test each step so fast arrows never skip through a target.
 */
export class Arrows {
  readonly group = new THREE.Group();
  private pool: Flight[] = [];
  private tmpDir = new THREE.Vector3();
  private tmpNext = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, -1);
  private quat = new THREE.Quaternion();
  private head = new THREE.Vector3();

  constructor(
    private rayTest: (o: THREE.Vector3, d: THREE.Vector3, max: number) => number | null,
    private onHit: (info: ArrowHitInfo) => void,
  ) {
    for (let i = 0; i < 12; i++) {
      const mesh = buildArrow();
      mesh.visible = false;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.6, depthWrite: false }));
      trail.frustumCulled = false;
      trail.visible = false;
      this.group.add(mesh, trail);
      this.pool.push({ mesh, trail, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, active: false, trailFade: 0 });
    }
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, speed: number): void {
    const f = this.pool.find((p) => !p.active && p.trailFade <= 0) ?? this.pool[0];
    f.active = true;
    f.age = 0;
    f.pos.copy(origin);
    f.vel.copy(dir).multiplyScalar(speed);
    f.mesh.visible = true;
    f.trail.visible = true;
    f.trailFade = 1;
    this.orient(f);
  }

  private orient(f: Flight): void {
    this.tmpDir.copy(f.vel).normalize();
    this.quat.setFromUnitVectors(this.fwd, this.tmpDir);
    f.mesh.quaternion.copy(this.quat);
    // The mesh's origin is the nock, so the head leads by its length.
    f.mesh.position.copy(f.pos).addScaledVector(this.tmpDir, 0.72);
  }

  update(dt: number): void {
    for (const f of this.pool) {
      const attr = f.trail.geometry.attributes.position as THREE.BufferAttribute;
      if (!f.active) {
        if (f.trailFade > 0) {
          f.trailFade -= dt * 3;
          (f.trail.material as THREE.LineBasicMaterial).opacity = Math.max(0, f.trailFade) * 0.6;
          if (f.trailFade <= 0) f.trail.visible = false;
        }
        continue;
      }
      f.age += dt;
      f.vel.y -= GRAVITY * dt;
      this.tmpNext.copy(f.pos).addScaledVector(f.vel, dt);
      this.tmpDir.copy(this.tmpNext).sub(f.pos);
      const seg = this.tmpDir.length();
      this.tmpDir.divideScalar(seg || 1);
      // Test from the head, not the nock.
      const head = this.head.copy(f.pos).addScaledVector(this.tmpDir, 0.72);
      const t = this.rayTest(head, this.tmpDir, seg);
      if (t !== null) {
        const point = head.addScaledVector(this.tmpDir, t);
        f.active = false;
        f.mesh.visible = false;
        this.quat.setFromUnitVectors(this.fwd, this.tmpDir);
        // Leave the arrow embedded a few centimetres.
        const nock = point.clone().addScaledVector(this.tmpDir, -0.62);
        this.onHit({ point: nock, dir: this.tmpDir.clone(), quat: this.quat.clone() });
        attr.setXYZ(0, point.x, point.y, point.z);
        attr.needsUpdate = true;
        continue;
      }
      f.pos.copy(this.tmpNext);
      this.orient(f);
      attr.setXYZ(0, f.pos.x, f.pos.y, f.pos.z);
      const tail = Math.min(f.age, 0.07);
      attr.setXYZ(1, f.pos.x - f.vel.x * tail, f.pos.y - f.vel.y * tail, f.pos.z - f.vel.z * tail);
      attr.needsUpdate = true;
      if (f.age > 6) {
        f.active = false;
        f.mesh.visible = false;
      }
    }
  }
}
