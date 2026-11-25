import * as THREE from 'three';

/** Pooled debris: wood chips, sand puffs, sparks, suitcase fragments. One draw call. */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private floorY: Float32Array;
  private next = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private anyAlive = false;

  constructor(max = 260) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.floorY = new Float32Array(max);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    }
  }

  burst(
    p: THREE.Vector3,
    normal: THREE.Vector3,
    count: number,
    hex: number,
    opts: { speed?: number; size?: number; life?: number; floor?: number; spread?: number } = {},
  ): void {
    const speed = opts.speed ?? 4;
    const size = opts.size ?? 0.06;
    const life = opts.life ?? 1.2;
    const spread = opts.spread ?? 0.8;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = (normal.x + (Math.random() - 0.5) * spread * 2) * s;
      this.vel[i * 3 + 1] = (normal.y + 0.4 + Math.random() * spread) * s;
      this.vel[i * 3 + 2] = (normal.z + (Math.random() - 0.5) * spread * 2) * s;
      for (let k = 0; k < 3; k++) {
        this.rot[i * 3 + k] = Math.random() * 6;
        this.spin[i * 3 + k] = (Math.random() - 0.5) * 18;
      }
      this.life[i] = life * (0.7 + Math.random() * 0.6);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.floorY[i] = opts.floor ?? -100;
      this.color.setHex(hex).multiplyScalar(0.8 + Math.random() * 0.35);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.anyAlive = true;
  }

  update(dt: number): void {
    if (!this.anyAlive) return;
    let alive = false;
    const d = this.dummy;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        d.scale.setScalar(0);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      alive = true;
      const j = i * 3;
      this.vel[j + 1] -= 14 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < this.floorY[i]) {
        this.pos[j + 1] = this.floorY[i];
        this.vel[j] *= 0.4;
        this.vel[j + 2] *= 0.4;
        this.vel[j + 1] *= -0.25;
        this.spin[j] *= 0.5;
        this.spin[j + 1] *= 0.5;
        this.spin[j + 2] *= 0.5;
      }
      for (let k = 0; k < 3; k++) this.rot[j + k] += this.spin[j + k] * dt;
      const s = this.size[i] * Math.min(1, this.life[i] * 3);
      d.position.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      d.rotation.set(this.rot[j], this.rot[j + 1], this.rot[j + 2]);
      d.scale.set(s, s * 0.5, s * 1.4);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anyAlive = alive;
  }
}

const puffVertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const puffFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a < 0.01) discard;
  vec3 col = mix(uColor2, uColor, smoothstep(0.0, 0.45, d));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** Continuous emitter of soft round sprites: plane smoke and fire. */
export class PuffEmitter {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private lifeArr: Float32Array;
  private sizeArr: Float32Array;
  private alphaArr: Float32Array;
  private material: THREE.ShaderMaterial;
  origin = new THREE.Vector3();
  wind = new THREE.Vector3(0.8, 0, -0.3);

  constructor(
    count: number,
    private cfg: { life: number; rise: number; spread: number; size0: number; size1: number; alpha: number; color: number; color2: number; additive: boolean },
  ) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.lifeArr = new Float32Array(count);
    this.sizeArr = new Float32Array(count);
    this.alphaArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.lifeArr[i] = cfg.life * (0.7 + Math.random() * 0.6);
      this.age[i] = Math.random() * this.lifeArr[i];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(cfg.color) },
        uColor2: { value: new THREE.Color(cfg.color2) },
        uScale: { value: 600 },
      },
      vertexShader: puffVertex,
      fragmentShader: puffFragment,
      transparent: true,
      depthWrite: false,
      blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  private respawn(i: number): void {
    const c = this.cfg;
    const j = i * 3;
    this.pos[j] = this.origin.x + (Math.random() - 0.5) * c.spread;
    this.pos[j + 1] = this.origin.y + Math.random() * 0.3;
    this.pos[j + 2] = this.origin.z + (Math.random() - 0.5) * c.spread;
    this.vel[j] = (Math.random() - 0.5) * 0.6;
    this.vel[j + 1] = c.rise * (0.7 + Math.random() * 0.6);
    this.vel[j + 2] = (Math.random() - 0.5) * 0.6;
    this.age[i] = 0;
  }

  setTint(color: THREE.Color, color2: THREE.Color): void {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color);
    (this.material.uniforms.uColor2.value as THREE.Color).copy(color2);
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 0.6;
  }

  update(dt: number): void {
    const c = this.cfg;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.lifeArr[i]) this.respawn(i);
      const t = this.age[i] / this.lifeArr[i];
      const j = i * 3;
      this.pos[j] += (this.vel[j] + this.wind.x * t) * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += (this.vel[j + 2] + this.wind.z * t) * dt;
      this.sizeArr[i] = c.size0 + (c.size1 - c.size0) * t;
      this.alphaArr[i] = c.alpha * Math.min(1, t * 6) * (1 - t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}
