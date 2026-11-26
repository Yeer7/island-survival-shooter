import { bilabel, tr } from '../ui/i18n';

export type ToolId = 'axe' | 'flameAxe' | 'spear' | 'bow' | 'torch' | 'rod' | 'flashlight';
export type FoodId = 'food' | 'cookedMeat' | 'cookedFish' | 'meat' | 'fish' | 'bandage';
export type HotbarId = ToolId | FoodId;
export type MaterialId = 'sticks' | 'rocks' | 'cloth' | 'hide' | 'arrows' | 'totem' | 'relic' | 'heart';

export const HOTBAR_INFO: Record<HotbarId, { label: string; icon: string }> = {
  axe: bilabel('Machado de Emergência', 'Emergency Axe', '🪓'),
  flameAxe: bilabel('Machado Tático', 'Tactical Axe', '🪓'),
  spear: bilabel('Lança de Madeira', 'Wooden Spear', '🔱'),
  bow: bilabel('Arco de Caça', 'Hunting Bow', '🏹'),
  torch: bilabel('Tocha', 'Torch', '🕯️'),
  rod: bilabel('Vara de Pesca', 'Fishing Rod', '🎣'),
  flashlight: bilabel('Lanterna Tática', 'Tactical Flashlight', '🔦'),
  food: bilabel('Comida enlatada', 'Canned Food', '🥫'),
  cookedMeat: bilabel('Carne Assada', 'Roast Meat', '🍖'),
  cookedFish: bilabel('Peixe Assado', 'Roast Fish', '🐟'),
  meat: bilabel('Carne Crua', 'Raw Meat', '🥩'),
  fish: bilabel('Peixe Cru', 'Raw Fish', '🐠'),
  bandage: bilabel('Curativo', 'Bandage', '🩹'),
};

export const MATERIAL_INFO: Record<MaterialId, { label: string; icon: string }> = {
  sticks: bilabel('Gravetos', 'Sticks', '🥢'),
  rocks: bilabel('Pedras', 'Rocks', '🪨'),
  cloth: bilabel('Pano', 'Cloth', '🧵'),
  hide: bilabel('Pele', 'Hide', '🟫'),
  arrows: bilabel('Flechas', 'Arrows', '➶'),
  totem: bilabel('Totem Tribal', 'Tribal Totem', '🗿'),
  relic: bilabel('Relíquia da Caverna', 'Cave Relic', '💎'),
  heart: bilabel('Coração Alfa', 'Alpha Heart', '❤️‍🔥'),
};

/** Effects of eating/using a consumable: hunger and health deltas. */
export const FOOD_EFFECT: Record<FoodId, { hunger: number; health: number; text: string }> = {
  food: { hunger: 35, health: 0, get text() { return tr('+35 Fome', '+35 Hunger'); } },
  cookedMeat: { hunger: 45, health: 5, get text() { return tr('+45 Fome', '+45 Hunger'); } },
  cookedFish: { hunger: 32, health: 5, get text() { return tr('+32 Fome', '+32 Hunger'); } },
  meat: { hunger: 12, health: -6, get text() { return tr('+12 Fome (cru!)', '+12 Hunger (raw!)'); } },
  fish: { hunger: 9, health: -4, get text() { return tr('+9 Fome (cru!)', '+9 Hunger (raw!)'); } },
  bandage: { hunger: 0, health: 40, get text() { return tr('+40 Vida', '+40 Health'); } },
};

const TOOL_ORDER: ToolId[] = ['axe', 'flameAxe', 'spear', 'bow', 'torch', 'flashlight', 'rod'];
const FOOD_ORDER: FoodId[] = ['food', 'cookedMeat', 'cookedFish', 'meat', 'fish', 'bandage'];

export const MAX_LOGS = 3;

export class Inventory {
  readonly tools = new Set<ToolId>(['axe']);
  readonly food: Record<FoodId, number> = { food: 0, cookedMeat: 0, cookedFish: 0, meat: 0, fish: 0, bandage: 0 };
  readonly mats: Record<MaterialId, number> = { sticks: 0, rocks: 0, cloth: 0, hide: 0, arrows: 0, totem: 0, relic: 0, heart: 0 };
  /** Tactical backpack from the cave: 4 logs on the shoulder and double sticks/stones. */
  hasBackpack = false;

  get maxLogs(): number {
    return this.hasBackpack ? 4 : MAX_LOGS;
  }
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
