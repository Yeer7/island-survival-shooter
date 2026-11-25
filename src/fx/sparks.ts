import * as THREE from 'three';
import { PuffEmitter } from './particles';

const vertex = /* glsl */ `
attribute float aLife;
varying float vLife;
uniform float uScale;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Small glowing points that never grow huge near the lens.
  gl_PointSize = clamp(uScale * (0.05 + 0.06 * aLife) / -mv.z, 1.5, 14.0);
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c)) * clamp(vLife * 2.5, 0.0, 1.0);
  if (a < 0.02) discard;
  vec3 hot = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.92, 0.6), clamp(vLife * 1.6, 0.0, 1.0));
  gl_FragColor = vec4(hot * a, a);
  #include <colorspace_fragment>
}
`;

/** Pooled additive sparks for the flaming axe and the torch: bright, short, with gravity. */
export class Sparks {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private live = false;
  private material: THREE.ShaderMaterial;

  constructor(count = 220) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 0.6;
  }

  burst(p: THREE.Vector3, dir: THREE.Vector3, count: number, speed = 5): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const j = i * 3;
      this.pos[j] = p.x;
      this.pos[j + 1] = p.y;
      this.pos[j + 2] = p.z;
      const s = speed * (0.4 + Math.random() * 0.9);
      this.vel[j] = (dir.x + (Math.random() - 0.5) * 1.6) * s;
      this.vel[j + 1] = (dir.y + 0.5 + Math.random() * 0.9) * s;
      this.vel[j + 2] = (dir.z + (Math.random() - 0.5) * 1.6) * s;
      this.life[i] = 0.35 + Math.random() * 0.45;
    }
    this.live = true;
  }

  update(dt: number): void {
    if (!this.live) return;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        continue;
      }
      any = true;
      const j = i * 3;
      this.vel[j + 1] -= 9 * dt;
      this.vel[j] *= 1 - dt * 1.5;
      this.vel[j + 2] *= 1 - dt * 1.5;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    this.live = any;
  }
}

/**
 * Small flames that cling to burning enemies: a fixed pool of fire emitters handed
 * to whoever is burning (no allocation during play).
 */
export class BurnFlames {
  readonly group = new THREE.Group();
  private emitters: { fx: PuffEmitter; owner: object | null; fade: number }[] = [];

  constructor(count = 6) {
    for (let i = 0; i < count; i++) {
      const fx = new PuffEmitter(18, { life: 0.6, rise: 1.6, spread: 0.45, size0: 0.7, size1: 0.15, alpha: 0.85, color: 0xff5a12, color2: 0xffd27a, additive: true });
      fx.origin.set(0, -500, 0);
      fx.wind.set(0, 0, 0);
      fx.points.visible = false;
      this.group.add(fx.points);
      this.emitters.push({ fx, owner: null, fade: 0 });
    }
  }

  setViewportHeight(h: number): void {
    for (const e of this.emitters) e.fx.setViewportHeight(h);
  }

  /** `burning` lists who is on fire and where (feet position, height of the body). */
  update(dt: number, burning: { owner: object; x: number; y: number; z: number; h: number }[]): void {
    // Release emitters whose owner stopped burning.
    for (const e of this.emitters) {
      if (e.owner && !burning.some((b) => b.owner === e.owner)) {
        e.owner = null;
        e.fade = 0.6;
      }
    }
    for (const b of burning) {
      let e = this.emitters.find((x) => x.owner === b.owner);
      if (!e) {
        e = this.emitters.find((x) => !x.owner);
        if (!e) continue;
        e.owner = b.owner;
        e.fx.points.visible = true;
      }
      e.fx.origin.set(b.x, b.y + b.h * 0.45, b.z);
    }
    for (const e of this.emitters) {
      if (!e.owner) {
        if (e.fade > 0) {
          e.fade -= dt;
          // Park the spawn point far away: live particles finish, no new ones appear.
          e.fx.origin.set(0, -500, 0);
          if (e.fade <= 0) e.fx.points.visible = false;
        }
      }
      if (e.fx.points.visible) e.fx.update(dt);
    }
  }
}
