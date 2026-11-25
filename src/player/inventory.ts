export type ToolId = 'axe' | 'flameAxe' | 'spear' | 'bow' | 'torch' | 'rod';
export type FoodId = 'food' | 'cookedMeat' | 'cookedFish' | 'meat' | 'fish' | 'bandage';
export type HotbarId = ToolId | FoodId;
export type MaterialId = 'sticks' | 'rocks' | 'cloth' | 'hide' | 'arrows' | 'totem' | 'relic';

export const HOTBAR_INFO: Record<HotbarId, { label: string; icon: string }> = {
  axe: { label: 'Machado de Emergência', icon: '🪓' },
  flameAxe: { label: 'Machado Flamejante', icon: '🔥' },
  spear: { label: 'Lança de Madeira', icon: '🔱' },
  bow: { label: 'Arco de Caça', icon: '🏹' },
  torch: { label: 'Tocha', icon: '🕯️' },
  rod: { label: 'Vara de Pesca', icon: '🎣' },
  food: { label: 'Comida enlatada', icon: '🥫' },
  cookedMeat: { label: 'Carne Assada', icon: '🍖' },
  cookedFish: { label: 'Peixe Assado', icon: '🐟' },
  meat: { label: 'Carne Crua', icon: '🥩' },
  fish: { label: 'Peixe Cru', icon: '🐠' },
  bandage: { label: 'Curativo', icon: '🩹' },
};

export const MATERIAL_INFO: Record<MaterialId, { label: string; icon: string }> = {
  sticks: { label: 'Gravetos', icon: '🥢' },
  rocks: { label: 'Pedras', icon: '🪨' },
  cloth: { label: 'Pano', icon: '🧵' },
  hide: { label: 'Pele', icon: '🟫' },
  arrows: { label: 'Flechas', icon: '➶' },
  totem: { label: 'Totem Tribal', icon: '🗿' },
  relic: { label: 'Relíquia da Caverna', icon: '💎' },
};

/** Effects of eating/using a consumable: hunger and health deltas. */
export const FOOD_EFFECT: Record<FoodId, { hunger: number; health: number; text: string }> = {
  food: { hunger: 35, health: 0, text: '+35 Fome' },
  cookedMeat: { hunger: 45, health: 5, text: '+45 Fome' },
  cookedFish: { hunger: 32, health: 5, text: '+32 Fome' },
  meat: { hunger: 12, health: -6, text: '+12 Fome (cru!)' },
  fish: { hunger: 9, health: -4, text: '+9 Fome (cru!)' },
  bandage: { hunger: 0, health: 40, text: '+40 Vida' },
};

const TOOL_ORDER: ToolId[] = ['axe', 'flameAxe', 'spear', 'bow', 'torch', 'rod'];
const FOOD_ORDER: FoodId[] = ['food', 'cookedMeat', 'cookedFish', 'meat', 'fish', 'bandage'];

export const MAX_LOGS = 3;

export class Inventory {
  readonly tools = new Set<ToolId>(['axe']);
  readonly food: Record<FoodId, number> = { food: 0, cookedMeat: 0, cookedFish: 0, meat: 0, fish: 0, bandage: 0 };
  readonly mats: Record<MaterialId, number> = { sticks: 0, rocks: 0, cloth: 0, hide: 0, arrows: 0, totem: 0, relic: 0 };
  /** Logs carried on the shoulder. */
  logs = 0;
  armor = 0;
  selected: HotbarId = 'axe';

  /** Only what the player actually owns, in a stable order. */
  hotbar(): HotbarId[] {
    const list: HotbarId[] = [];
    for (const t of TOOL_ORDER) if (this.tools.has(t)) list.push(t);
    for (const f of FOOD_ORDER) if (this.food[f] > 0) list.push(f);
    return list;
  }

  isTool(id: HotbarId): id is ToolId {
    return (TOOL_ORDER as string[]).includes(id);
  }

  has(id: HotbarId): boolean {
    return this.isTool(id) ? this.tools.has(id) : this.food[id as FoodId] > 0;
  }

  count(id: HotbarId): number | null {
    if (id === 'bow') return this.mats.arrows;
    return this.isTool(id) ? null : this.food[id as FoodId];
  }
}

export class Vitals {
  health = 100;
  maxHealth = 100;
  hunger = 100;
  hurtFlash = 0;
  dead = false;

  update(dt: number, sprinting: boolean): void {
    if (this.dead) return;
    this.hunger = Math.max(0, this.hunger - dt * (sprinting ? 0.14 : 0.09));
    if (this.hunger <= 0) this.damage(dt * 0.8, false);
    else if (this.hunger > 60 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + dt * 0.12);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
  }

  damage(amount: number, flash = true): void {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (flash) this.hurtFlash = Math.min(1, this.hurtFlash + amount / 25);
    if (this.health <= 0) this.dead = true;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }
}
