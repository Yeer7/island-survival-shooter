export type SlotId = 'axe' | 'pistol' | 'food' | 'bandage' | 'cloth';

export const SLOTS: { id: SlotId; label: string; icon: string }[] = [
  { id: 'axe', label: 'Machado', icon: '🪓' },
  { id: 'pistol', label: 'Pistola', icon: '🔫' },
  { id: 'food', label: 'Comida', icon: '🥫' },
  { id: 'bandage', label: 'Curativo', icon: '🩹' },
  { id: 'cloth', label: 'Pano', icon: '🧵' },
];

export const MAG_SIZE = 12;
export const MAX_LOGS = 3;

export class Inventory {
  selected = 0;
  hasPistol = false;
  mag = 0;
  reserve = 0;
  food = 0;
  bandage = 0;
  cloth = 0;
  rocks = 0;
  logs = 0;

  get slot(): SlotId {
    return SLOTS[this.selected].id;
  }

  count(id: SlotId): number | null {
    switch (id) {
      case 'axe':
        return null;
      case 'pistol':
        return this.hasPistol ? this.mag + this.reserve : 0;
      case 'food':
        return this.food;
      case 'bandage':
        return this.bandage;
      case 'cloth':
        return this.cloth;
    }
  }

  available(id: SlotId): boolean {
    if (id === 'axe') return true;
    if (id === 'pistol') return this.hasPistol;
    return (this.count(id) ?? 0) > 0;
  }
}

/** Health and hunger. Hunger empties over ~14 in-game hours of walking. */
export class Vitals {
  health = 100;
  hunger = 100;
  hurtFlash = 0;
  dead = false;

  update(dt: number, sprinting: boolean): void {
    if (this.dead) return;
    this.hunger = Math.max(0, this.hunger - dt * (sprinting ? 0.14 : 0.09));
    if (this.hunger <= 0) this.damage(dt * 0.8, false);
    else if (this.hunger > 60 && this.health < 100) this.health = Math.min(100, this.health + dt * 0.12);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
  }

  damage(amount: number, flash = true): void {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (flash) this.hurtFlash = Math.min(1, this.hurtFlash + amount / 25);
    if (this.health <= 0) this.dead = true;
  }
}
