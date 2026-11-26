export type ColliderKind = 'tree' | 'rock' | 'plane' | 'suitcase' | 'dock';

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** Base and top heights, used for bullets and for stepping over low props. */
  y0: number;
  y1: number;
  kind: ColliderKind;
  ref: number;
  active: boolean;
}

const CELL = 12;

/** Vertical cylinders in a uniform grid: cheap circle-vs-circle player collision. */
export class ColliderGrid {
  readonly all: Circle[] = [];
  private cells = new Map<number, Circle[]>();

  private key(cx: number, cz: number): number {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  add(c: Omit<Circle, 'active'>): Circle {
    const circle: Circle = { ...c, active: true };
    this.all.push(circle);
    const x0 = Math.floor((c.x - c.r) / CELL);
    const x1 = Math.floor((c.x + c.r) / CELL);
    const z0 = Math.floor((c.z - c.r) / CELL);
    const z1 = Math.floor((c.z + c.r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(circle);
      }
    }
    return circle;
  }

  /** Visit circles whose cells overlap a disc. */
  query(x: number, z: number, radius: number, visit: (c: Circle) => void): void {
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) if (list[i].active) visit(list[i]);
      }
    }
  }

  /** True if a disc of radius r at (x,z) is clear of every collider. */
  isFree(x: number, z: number, r: number): boolean {
    let free = true;
    this.query(x, z, r + 4, (c) => {
      if (Math.hypot(c.x - x, c.z - z) < c.r + r) free = false;
    });
    return free;
  }
}

/** `ref` of spike-barricade colliders: solid, but enemies only steer round them once stuck on the stakes. */
export const SPIKE_REF = -77;
