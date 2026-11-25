import { Inventory, MAG_SIZE } from '../player/inventory';
import { SoundEngine } from '../audio/soundEngine';
import { ViewModel } from './viewmodel';

/** What the tools need from the game world. */
export interface CombatWorld {
  /** Resolve the axe blow at the moment the blade arrives. */
  axeImpact(): void;
  /** Fire one hitscan round from the eye along the look direction. */
  fireBullet(): void;
  kick(pitch: number, yaw: number, trauma: number): void;
}

const SWING_TIME = 0.62;
const IMPACT_AT = 0.42 * SWING_TIME;

/** [1] Emergency axe: fluid swing, impact resolved mid-motion. */
export class Axe {
  private cooldown = 0;
  private pending = -1;

  constructor(private vm: ViewModel, private world: CombatWorld, private sound: SoundEngine) {}

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  use(): void {
    if (this.cooldown > 0) return;
    this.cooldown = SWING_TIME;
    this.pending = IMPACT_AT;
    this.vm.swing(SWING_TIME);
    this.sound.whoosh();
  }

  cancel(): void {
    this.pending = -1;
  }

  update(dt: number): void {
    this.cooldown -= dt;
    if (this.pending > 0) {
      this.pending -= dt;
      if (this.pending <= 0) this.world.axeImpact();
    }
  }
}

/** [2] Pilot's pistol: semi-auto hitscan, 12-round magazine, [R] reload. */
export class Pistol {
  private cooldown = 0;
  private reloading = 0;

  constructor(private vm: ViewModel, private world: CombatWorld, private sound: SoundEngine, private inv: Inventory) {}

  get isReloading(): boolean {
    return this.reloading > 0;
  }

  trigger(): void {
    if (this.cooldown > 0 || this.reloading > 0) return;
    if (this.inv.mag <= 0) {
      this.sound.dryFire();
      this.cooldown = 0.25;
      if (this.inv.reserve > 0) this.reload();
      return;
    }
    this.inv.mag--;
    this.cooldown = 0.16;
    this.vm.fire();
    this.sound.gunshot();
    this.world.kick(0.9 + Math.random() * 0.3, (Math.random() - 0.5) * 0.35, 0.08);
    this.world.fireBullet();
  }

  reload(): void {
    if (this.reloading > 0 || this.inv.mag >= MAG_SIZE || this.inv.reserve <= 0) return;
    this.reloading = 1.3;
    this.vm.reload(1.3);
    this.sound.reload();
  }

  cancel(): void {
    this.reloading = 0;
  }

  update(dt: number): void {
    this.cooldown -= dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = MAG_SIZE - this.inv.mag;
        const take = Math.min(need, this.inv.reserve);
        this.inv.mag += take;
        this.inv.reserve -= take;
      }
    }
  }
}
