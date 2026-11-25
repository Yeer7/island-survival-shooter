import { Cost, LEVEL_UP, RECIPES, Recipe } from '../world/base';

export interface CraftState {
  level: number;
  have: Required<Cost>;
  bossItems: { totem: number; relic: number };
  owned: Set<string>;
}

const COST_LABEL: Record<keyof Cost, string> = { logs: 'Toras', sticks: 'Gravetos', rocks: 'Pedras', cloth: 'Pano', hide: 'Pele' };

/** Crafting bench menu: levels 1→3, recipes with costs, locked tiers with their boss item. */
export class CraftMenu {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  isOpen = false;
  onCraft: (r: Recipe) => void = () => {};
  onUpgrade: (level: 2 | 3) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'craft-menu';
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  static affordable(cost: Cost, have: Required<Cost>): boolean {
    return (Object.keys(cost) as (keyof Cost)[]).every((k) => (have[k] ?? 0) >= (cost[k] ?? 0));
  }

  private costHtml(cost: Cost, have: Required<Cost>): string {
    return (Object.keys(cost) as (keyof Cost)[])
      .map((k) => {
        const need = cost[k] ?? 0;
        const ok = have[k] >= need;
        return `<span class="${ok ? '' : 'miss'}">${COST_LABEL[k]} ${have[k]}/${need}</span>`;
      })
      .join(' · ');
  }

  open(state: CraftState): void {
    this.isOpen = true;
    this.root.classList.add('on');
    this.render(state);
  }

  close(): void {
    this.isOpen = false;
    this.root.classList.remove('on');
  }

  render(state: CraftState): void {
    const h = state.have;
    let html = `<header><h2>CRIAÇÃO E CONSTRUÇÃO · NV ${state.level}</h2><button class="ghost" data-close>Fechar (Tab)</button></header>
      <div class="have">Toras ${h.logs} (ombro + suportes por perto) · Gravetos ${h.sticks} · Pedras ${h.rocks} · Pano ${h.cloth} · Pele ${h.hide}</div>`;
    for (const lvl of [1, 2, 3] as const) {
      const locked = state.level < lvl;
      let lockText = '';
      if (lvl > 1) {
        const up = LEVEL_UP[lvl as 2 | 3];
        lockText = locked ? `<span class="lock">🔒 requer ${up.bossLabel} (Chefe)</span>` : '';
      }
      html += `<h3>Nível ${lvl} ${lockText}</h3>`;
      if (lvl > 1 && locked && state.level === lvl - 1) {
        const up = LEVEL_UP[lvl as 2 | 3];
        const bossHave = state.bossItems[up.boss];
        const can = CraftMenu.affordable(up.cost, h) && bossHave > 0;
        html += `<div class="upgrade"><span>Evoluir para Nv ${lvl}: ${this.costHtml(up.cost, h)} · <span class="${bossHave > 0 ? '' : 'miss'}">${up.bossLabel} ${bossHave}/1</span></span>
          <button data-up="${lvl}" ${can ? '' : 'disabled'}>Evoluir</button></div>`;
      }
      html += '<div class="grid">';
      for (const r of RECIPES.filter((x) => x.level === lvl)) {
        const owned = state.owned.has(r.id);
        const can = !locked && !owned && CraftMenu.affordable(r.cost, h);
        const verb = r.kind === 'build' ? 'Construir' : r.kind === 'armor' ? 'Vestir' : 'Criar';
        html += `<div class="rec ${locked ? 'locked' : ''}">
          <div class="ico">${locked ? '🔒' : r.icon}</div>
          <div class="info"><div class="nm">${r.label}</div><div class="cost">${this.costHtml(r.cost, h)}</div><div class="desc">${r.desc}</div></div>
          <button data-r="${r.id}" ${can ? '' : 'disabled'}>${owned ? 'Feito' : verb}</button></div>`;
      }
      html += '</div>';
    }
    this.panel.innerHTML = html;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.onClose());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = RECIPES.find((x) => x.id === b.dataset.r);
        if (r) this.onCraft(r);
      }),
    );
    this.panel.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => this.onUpgrade(Number(b.dataset.up) as 2 | 3)));
  }
}
