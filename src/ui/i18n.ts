/**
 * Two-language UI (Brazilian Portuguese and English). Strings live next to where they
 * are used as `tr(pt, en)` pairs; the choice is saved and the page re-renders on change.
 * Default: the saved choice, else the browser's language (Portuguese browsers get PT).
 */
export type Lang = 'pt' | 'en';

const KEY = 'aotf.lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'pt' || v === 'en') return v;
  } catch {
    /* storage blocked */
  }
  return (navigator.language || 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

let lang: Lang = initial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage blocked */
  }
  document.documentElement.lang = l === 'pt' ? 'pt-BR' : 'en';
  for (const f of listeners) f();
}

export function onLangChange(f: () => void): void {
  listeners.add(f);
}

export const tr = (pt: string, en: string): string => (lang === 'pt' ? pt : en);

/** `{ label }` whose text follows the current language (for static tables read every frame). */
export const bilabel = (pt: string, en: string, icon: string): { label: string; icon: string } => ({
  icon,
  get label() {
    return tr(pt, en);
  },
});

/** A Survival Book recipe's name in the current language. */
export const recipeLabel = (r: { id: string; label: string }): string => (lang === 'en' ? (RECIPE_EN[r.id]?.label ?? r.label) : r.label);

/** English names and descriptions for the Survival Book recipes (the Portuguese ones live in RECIPES). */
export const RECIPE_EN: Record<string, { label: string; desc: string }> = {
  cabin: { label: 'Log Cabin', desc: 'A roomy cabin (7.5 × 6.5 m) with a door, windows, porch and lantern. Pick the spot, then deliver 6 logs, 10 sticks and 6 rocks with [E].' },
  bed: { label: 'Survival Bed', desc: 'Place inside a finished cabin. [E] Sleep and Save: full health and skip to 07:00.' },
  campfire: { label: 'Campfire', desc: 'Roasts meat and fish, lights the night and keeps cannibals away.' },
  spikeTrap: { label: 'Spike Trap', desc: 'A low frame of sharpened stakes: hurts cannibals and beasts that step on it. Never hurts you or animals.' },
  logHolder: { label: 'Log Holder', desc: 'Stores up to 12 logs near your base.' },
  torch: { label: 'Torch', desc: 'Warm light for the night.' },
  rod: { label: 'Fishing Rod', desc: 'Fish in the lake (faster from the dock).' },
  spear: { label: 'Wooden Spear', desc: 'Long-reach thrust.' },
  hideArmor: { label: 'Hide Armor', desc: 'Max health 150.' },
  wall: { label: 'Palisade Wall', desc: 'A wall of sharpened logs (3 m).' },
  gate: { label: 'Gate', desc: 'Wooden gate that opens with [E].' },
  bow: { label: 'Hunting Bow', desc: 'Ranged combat with arrows.' },
  arrows: { label: 'Arrows ×5', desc: 'Bow ammunition (recoverable).' },
  reinforcedArmor: { label: 'Reinforced Armor', desc: 'Max health 200.' },
  flameAxe: { label: 'Flaming Axe', desc: 'Double damage, a glowing hot head.' },
};
