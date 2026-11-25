import { SoundEngine } from '../audio/soundEngine';
import { ViewModel } from './viewmodel';

export interface MeleeSpec {
  kind: 'swing' | 'stab';
  duration: number;
  /** Fraction of the motion at which the blow lands. */
  impactAt: number;
  reach: number;
  tree: number;
  animal: number;
  luggage: number;
}

export const MELEE: Record<'axe' | 'flameAxe' | 'spear' | 'torch', MeleeSpec> = {
  torch: { kind: 'swing', duration: 0.5, impactAt: 0.42, reach: 2.4, tree: 3, animal: 14, luggage: 8 },
  axe: { kind: 'swing', duration: 0.62, impactAt: 0.42, reach: 2.7, tree: 25, animal: 35, luggage: 25 },
  flameAxe: { kind: 'swing', duration: 0.6, impactAt: 0.42, reach: 2.8, tree: 50, animal: 70, luggage: 50 },
  spear: { kind: 'stab', duration: 0.55, impactAt: 0.36, reach: 3.6, tree: 5, animal: 50, luggage: 12 },
};

/** What the tools need from the game world. */
export interface CombatWorld {
  meleeImpact(spec: MeleeSpec): void;
  shootArrow(power: number): void;
  kick(pitch: number, yaw: number, trauma: number): void;
}

/** Axe, flaming axe and spear: one motion, the blow resolved mid-motion. */
export class Melee {
  private cooldown = 0;
  private pending = -1;
  private spec: MeleeSpec = MELEE.axe;

  constructor(private vm: ViewModel, private world: CombatWorld, private sound: SoundEngine) {}

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  use(spec: MeleeSpec): void {
    if (this.cooldown > 0) return;
    this.spec = spec;
    this.cooldown = spec.duration;
    this.pending = spec.duration * spec.impactAt;
    if (spec.kind === 'swing') this.vm.swing(spec.duration);
    else this.vm.stab(spec.duration);
    this.sound.whoosh();
  }

  cancel(): void {
    this.pending = -1;
  }

  update(dt: number): void {
    this.cooldown -= dt;
    if (this.pending > 0) {
      this.pending -= dt;
      if (this.pending <= 0) this.world.meleeImpact(this.spec);
    }
  }
}

/** Hunting bow: hold to draw (0.7 s to full), release to loose a physical arrow. */
export class Bow {
  draw = 0;
  private drawing = false;
  private cooldown = 0;

  constructor(private vm: ViewModel, private world: CombatWorld, private sound: SoundEngine) {}

  update(dt: number, held: boolean, arrows: number): void {
    this.cooldown -= dt;
    const canDraw = arrows > 0 && this.cooldown <= 0;
    if (held && canDraw) {
      if (!this.drawing) this.sound.bowDraw();
      this.drawing = true;
      this.draw = Math.min(1, this.draw + dt / 0.7);
    } else if (this.drawing) {
      this.drawing = false;
      if (this.draw > 0.2) {
        this.world.shootArrow(this.draw);
        this.sound.bowRelease(this.draw);
        this.vm.release();
        this.cooldown = 0.35;
      }
      this.draw = 0;
    } else {
      this.draw = Math.max(0, this.draw - dt * 4);
    }
    this.vm.bowDraw = this.draw;
    this.vm.arrowNocked = arrows > 0 && this.cooldown < 0.1;
  }

  cancel(): void {
    this.drawing = false;
    this.draw = 0;
  }
}
