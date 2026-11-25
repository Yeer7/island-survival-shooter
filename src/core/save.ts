/** Everything that persists between sessions (localStorage, one slot). */
export interface SaveData {
  v: 1;
  day: number;
  hours: number;
  player: { x: number; z: number; yaw: number };
  health: number;
  maxHealth: number;
  hunger: number;
  inv: {
    tools: string[];
    food: Record<string, number>;
    mats: Record<string, number>;
    logs: number;
    armor: number;
    hasBackpack: boolean;
  };
  benchLevel: number;
  cabins: { x: number; z: number; yaw: number; delivered: { logs: number; sticks: number; rocks: number } }[];
  placed: { kind: string; x: number; z: number; yaw: number; logs: number }[];
  defeated: string[];
  bridgeRepaired: boolean;
  caveLoot: { flashlight: boolean; backpack: boolean };
  boat: { logs: number; sticks: number; cloth: number; heart: number };
  stats: { kills: number; hunted: number };
  tutorialDone: boolean;
  escaped: boolean;
  /** Ids of the effigies already knocked down (optional: older saves have none). */
  effigies?: number[];
}

const KEY = 'iss.save.v1';

export const SaveStore = {
  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d && d.v === 1 ? d : null;
    } catch {
      return null;
    }
  },
  save(d: SaveData): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem('iss.tutorialDone');
    } catch {
      /* storage blocked */
    }
  },
};
