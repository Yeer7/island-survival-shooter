import './book.css';
import { Cost, LEVEL_UP, RECIPES, Recipe } from '../world/base';

export interface CraftState {
  level: number;
  have: Required<Cost>;
  bossItems: { totem: number; relic: number };
  owned: Set<string>;
}

type Tab = 'build' | 'gear' | 'levels';

const COST_LABEL: Record<keyof Cost, string> = { logs: 'Toras', sticks: 'Gravetos', rocks: 'Pedras', cloth: 'Pano', hide: 'Pele' };
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'build', label: 'Construções', icon: '🛖' },
  { id: 'gear', label: 'Equipamentos', icon: '🪓' },
  { id: 'levels', label: 'Níveis 1 → 3', icon: '📜' },
];

/**
 * The Survival Book ([Tab]/[B]): an open journal with two parchment pages, a spine
 * and side tabs (Constructions, Equipment, Levels). Left page lists the entries of
 * the open tab; the right page shows the chosen entry with its cost and action.
 */
export class CraftMenu {
  readonly root: HTMLDivElement;
  private book: HTMLDivElement;
  isOpen = false;
  private tab: Tab = 'build';
  private selected: string | null = null;
  private state: CraftState | null = null;
  onCraft: (r: Recipe) => void = () => {};
  onUpgrade: (level: 2 | 3) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'survival-book';
    this.book = document.createElement('div');
    this.book.className = 'book';
    this.root.appendChild(this.book);
    document.body.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  static affordable(cost: Cost, have: Required<Cost>): boolean {
    return (Object.keys(cost) as (keyof Cost)[]).every((k) => (have[k] ?? 0) >= (cost[k] ?? 0));
  }

  private costHtml(cost: Cost, have: Required<Cost>): string {
    const keys = Object.keys(cost) as (keyof Cost)[];
    if (!keys.length) return '<li>Sem custo agora — materiais entregues depois com [E]</li>';
    return keys
      .map((k) => {
        const need = cost[k] ?? 0;
        const ok = have[k] >= need;
        return `<li class="${ok ? 'ok' : 'miss'}"><span>${COST_LABEL[k]}</span><b>${have[k]}/${need}</b></li>`;
      })
      .join('');
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

  private entries(): Recipe[] {
    if (this.tab === 'build') return RECIPES.filter((r) => r.kind === 'build');
    if (this.tab === 'gear') return RECIPES.filter((r) => r.kind !== 'build');
    return [];
  }

  render(state: CraftState): void {
    this.state = state;
    const h = state.have;
    const list = this.entries();
    if (this.tab !== 'levels' && (!this.selected || !list.some((r) => r.id === this.selected))) this.selected = list[0]?.id ?? null;

    const tabs = TABS.map((t) => `<button class="tab ${t.id === this.tab ? 'on' : ''}" data-tab="${t.id}"><span>${t.icon}</span>${t.label}</button>`).join('');
    let left = '';
    let right = '';
    if (this.tab === 'levels') {
      left = `<h2>Níveis do Livro</h2><p class="lead">Seu nível atual: <b>${state.level}</b>. Cada nível pede madeira, pedra e um troféu de chefe.</p>`;
      for (const lvl of [1, 2, 3] as const) {
        const items = RECIPES.filter((r) => r.level === lvl).map((r) => `${r.icon} ${r.label}`).join(' · ');
        const status = state.level >= lvl ? '<span class="stamp">liberado</span>' : '<span class="stamp lock">🔒 bloqueado</span>';
        left += `<div class="lvl"><h3>Nível ${lvl} ${status}</h3><p>${items}</p></div>`;
      }
      right = '<h2>Evoluir</h2>';
      if (state.level >= 3) right += '<p class="lead">O livro está completo. Agora: o Veleiro na Praia Sul.</p>';
      else {
        const next = (state.level + 1) as 2 | 3;
        const up = LEVEL_UP[next];
        const bossHave = state.bossItems[up.boss];
        const can = CraftMenu.affordable(up.cost, h) && bossHave > 0;
        right += `<p class="lead">Para o Nível ${next}:</p><ul class="cost">${this.costHtml(up.cost, h)}<li class="${bossHave > 0 ? 'ok' : 'miss'}"><span>${up.bossLabel}</span><b>${bossHave}/1</b></li></ul>
          <p class="hint">${next === 2 ? 'O Totem Tribal fica com o Chefe da Aldeia (Oeste).' : 'A Relíquia está com o Guardião da Caverna (Norte).'}</p>
          <button class="act" data-up="${next}" ${can ? '' : 'disabled'}>Evoluir para Nível ${next}</button>`;
      }
    } else {
      left = `<h2>${this.tab === 'build' ? 'Construções' : 'Equipamentos'}</h2><ul class="entries">`;
      for (const r of list) {
        const locked = r.level > state.level;
        const owned = state.owned.has(r.id);
        left += `<li class="${r.id === this.selected ? 'sel' : ''} ${locked ? 'locked' : ''}" data-sel="${r.id}"><span class="ico">${locked ? '🔒' : r.icon}</span><span class="nm">${r.label}</span><span class="lv">${owned ? '✓' : `Nv ${r.level}`}</span></li>`;
      }
      left += '</ul>';
      const r = list.find((x) => x.id === this.selected);
      if (r) {
        const locked = r.level > state.level;
        const owned = state.owned.has(r.id);
        const can = !locked && !owned && CraftMenu.affordable(r.cost, h);
        const verb = r.kind === 'build' ? 'Construir' : r.kind === 'armor' ? 'Vestir' : 'Criar';
        right = `<div class="sketch">${r.icon}</div><h2>${r.label}</h2><p class="lead">${r.desc}</p>
          <ul class="cost">${this.costHtml(r.cost, h)}</ul>
          ${locked ? `<p class="hint">🔒 Requer Nível ${r.level} do livro.</p>` : ''}
          <button class="act" data-r="${r.id}" ${can ? '' : 'disabled'}>${owned ? 'Já feito' : verb}</button>`;
      }
    }
    this.book.innerHTML = `<nav class="tabs">${tabs}</nav>
      <section class="page left">${left}</section>
      <div class="spine"></div>
      <section class="page right">${right}<footer>Toras ${h.logs} (ombro + suportes) · Gravetos ${h.sticks} · Pedras ${h.rocks} · Pano ${h.cloth} · Pele ${h.hide}</footer></section>
      <button class="close" data-close>Fechar [Tab]</button>`;

    this.book.querySelector('[data-close]')?.addEventListener('click', () => this.onClose());
    this.book.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        this.selected = null;
        if (this.state) this.render(this.state);
      }),
    );
    this.book.querySelectorAll<HTMLElement>('[data-sel]').forEach((li) =>
      li.addEventListener('click', () => {
        this.selected = li.dataset.sel!;
        if (this.state) this.render(this.state);
      }),
    );
    this.book.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        const rec = RECIPES.find((x) => x.id === b.dataset.r);
        if (rec) this.onCraft(rec);
      }),
    );
    this.book.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => this.onUpgrade(Number(b.dataset.up) as 2 | 3)));
  }
}
