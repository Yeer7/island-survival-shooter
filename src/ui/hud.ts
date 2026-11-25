import './hud.css';
import { HOTBAR_INFO, HotbarId, Inventory, MATERIAL_INFO, MAX_LOGS } from '../player/inventory';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};

const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

export interface CompassTarget {
  name: string;
  cls: string;
  x: number;
  z: number;
}

/** Minimal HUD: clock + vitals top-right, compass top-centre, hotbar and prompts at the bottom. */
export class Hud {
  readonly root: HTMLDivElement;
  private clock: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private healthNum: HTMLSpanElement;
  private healthBar: HTMLDivElement;
  private hungerFill: HTMLDivElement;
  private hungerNum: HTMLSpanElement;
  private hungerBar: HTMLDivElement;
  private compassItems: { el: HTMLElement; deg: number }[] = [];
  private markers: { el: HTMLDivElement; t: CompassTarget }[] = [];
  private compassWidth = 380;
  private bar: HTMLDivElement;
  private barSig = '';
  private slots: { root: HTMLDivElement; cnt: HTMLSpanElement; id: HotbarId }[] = [];
  private prompts: HTMLDivElement;
  private mats: HTMLDivElement;
  private matEls = new Map<string, HTMLDivElement>();
  private armorEl: HTMLDivElement;
  private tutorial: HTMLDivElement;
  private tutorialText: HTMLSpanElement;
  private tutorialStep: HTMLSpanElement;
  onSkipTutorial: () => void = () => {};
  onCraftButton: () => void = () => {};
  private target: HTMLDivElement;
  private targetFill: HTMLDivElement;
  private targetTimer = 0;
  private toasts: HTMLDivElement;
  private hit: HTMLDivElement;
  private vignette: HTMLDivElement;
  private fade: HTMLDivElement;
  private msg: HTMLDivElement;
  private fps: HTMLDivElement;
  private cache = new Map<string, string>();
  private lastHeading = 999;

  constructor(compassTargets: CompassTarget[]) {
    this.root = el('div', '', document.body);
    this.root.id = 'hud';

    this.vignette = el('div', 'hud-vignette', this.root);

    const vit = el('div', 'hud-vitals', this.root);
    this.clock = el('div', 'hud-clock', vit, 'Dia 1 • 08:00');
    this.healthBar = el('div', 'hud-bar health', vit);
    el('span', 'ico', this.healthBar, '❤');
    const ht = el('div', 'track', this.healthBar);
    this.healthFill = el('div', 'fill', ht);
    this.healthNum = el('span', 'num', this.healthBar, '100');
    this.hungerBar = el('div', 'hud-bar hunger', vit);
    el('span', 'ico', this.hungerBar, '🍖');
    const hgt = el('div', 'track', this.hungerBar);
    this.hungerFill = el('div', 'fill', hgt);
    this.hungerNum = el('span', 'num', this.hungerBar, '100');
    this.armorEl = el('div', 'hud-armor', vit);

    const compass = el('div', 'hud-compass', this.root);
    const strip = el('div', 'strip', compass);
    for (let d = 0; d < 360; d += 15) {
      if (CARDINALS[d]) {
        const l = el('div', `lbl ${d % 90 ? 'minor' : ''} ${d === 0 ? 'north' : ''}`, strip, CARDINALS[d]);
        this.compassItems.push({ el: l, deg: d });
      } else {
        const t = el('div', 'tick', strip);
        this.compassItems.push({ el: t, deg: d });
      }
    }
    el('div', 'center', compass);
    for (const t of compassTargets) {
      const m = el('div', `marker ${t.cls}`, strip);
      this.markers.push({ el: m, t });
    }
    const measure = () => (this.compassWidth = compass.clientWidth || 380);
    window.addEventListener('resize', () => {
      measure();
      this.lastHeading = 999;
    });
    requestAnimationFrame(measure);

    this.tutorial = el('div', 'hud-tutorial', this.root);
    this.tutorialStep = el('span', 'step', this.tutorial);
    this.tutorialText = el('span', '', this.tutorial);
    const skip = el('button', '', this.tutorial, 'Pular (T)');
    skip.addEventListener('click', () => this.onSkipTutorial());
    this.tutorial.style.display = 'none';

    this.target = el('div', 'hud-target', this.root);
    this.targetFill = el('div', 'fill', this.target);
    this.toasts = el('div', 'hud-toasts', this.root);
    this.hit = el('div', 'hud-hit', this.root);

    const bottom = el('div', 'hud-bottom', this.root);
    this.prompts = el('div', 'hud-prompts', bottom);
    const craftBtn = el('button', 'hud-craft-btn', bottom, '<kbd>Tab</kbd> Criar / Construir');
    craftBtn.addEventListener('click', () => this.onCraftButton());
    const row = el('div', 'hud-row', bottom);
    this.mats = el('div', 'hud-mats', row);
    for (const [key, icon] of [['logs', '🪵'], ['sticks', MATERIAL_INFO.sticks.icon], ['rocks', MATERIAL_INFO.rocks.icon], ['cloth', MATERIAL_INFO.cloth.icon], ['hide', MATERIAL_INFO.hide.icon], ['arrows', MATERIAL_INFO.arrows.icon]]) {
      const e = el('div', 'item dim', this.mats, `${icon} 0`);
      e.dataset.icon = icon;
      this.matEls.set(key, e);
    }
    this.bar = el('div', 'hud-hotbar', row);

    this.msg = el('div', 'hud-center-msg', this.root);
    this.fade = el('div', 'hud-fade', this.root);
    this.fps = el('div', 'hud-fps', this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  private set(key: string, node: HTMLElement, value: string, prop: 'text' | 'html' | 'transform' | 'opacity' = 'text'): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (prop === 'text') node.textContent = value;
    else if (prop === 'html') node.innerHTML = value;
    else if (prop === 'transform') node.style.transform = value;
    else node.style.opacity = value;
  }

  updateVitals(day: number, clock: string, health: number, hunger: number, maxHealth = 100): void {
    this.set('clock', this.clock, `Dia ${day} • ${clock}`);
    const h = Math.ceil(health);
    const f = Math.ceil(hunger);
    this.set('hp', this.healthFill, `scaleX(${(h / maxHealth).toFixed(3)})`, 'transform');
    this.set('hpn', this.healthNum, String(h));
    this.set('hu', this.hungerFill, `scaleX(${(f / 100).toFixed(3)})`, 'transform');
    this.set('hun', this.hungerNum, String(f));
    this.healthBar.classList.toggle('low', h <= maxHealth * 0.25);
    this.hungerBar.classList.toggle('low', f <= 20);
  }

  /** heading in degrees, 0 = North, 90 = East. */
  updateCompass(heading: number, px: number, pz: number): void {
    const w = this.compassWidth;
    const ppd = w / 180;
    if (Math.abs(heading - this.lastHeading) > 0.15) {
      this.lastHeading = heading;
      for (const it of this.compassItems) {
        let d = it.deg - heading;
        d = ((d + 540) % 360) - 180;
        if (Math.abs(d) > 96) {
          it.el.style.display = 'none';
        } else {
          it.el.style.display = '';
          it.el.style.left = `${(w / 2 + d * ppd).toFixed(1)}px`;
        }
      }
    }
    for (const m of this.markers) {
      const dx = m.t.x - px;
      const dz = m.t.z - pz;
      const dist = Math.hypot(dx, dz);
      const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      let d = bearing - heading;
      d = ((d + 540) % 360) - 180;
      const clamped = Math.max(-84, Math.min(84, d));
      m.el.style.left = `${(w / 2 + clamped * ppd).toFixed(1)}px`;
      const label = `${m.t.name} ${Math.round(dist)}m`;
      const text = Math.abs(d) <= 84 ? label : d > 0 ? `${label} ›` : `‹ ${label}`;
      this.set(`mk-${m.t.name}`, m.el, text);
    }
  }

  /** Rebuilds the hotbar only when the owned set changes. */
  updateInventory(inv: Inventory): void {
    const list = inv.hotbar();
    const sig = list.join(',');
    if (sig !== this.barSig) {
      this.barSig = sig;
      this.bar.innerHTML = '';
      this.slots = list.map((id, i) => {
        const r = el('div', 'hud-slot', this.bar);
        el('span', 'key', r, String(i + 1));
        el('span', 'ico', r, HOTBAR_INFO[id].icon);
        el('span', 'name', r, HOTBAR_INFO[id].label);
        const cnt = el('span', 'cnt', r);
        return { root: r, cnt, id };
      });
      this.cache.forEach((_, k) => k.startsWith('cnt') && this.cache.delete(k));
    }
    this.slots.forEach((s, i) => {
      s.root.classList.toggle('sel', s.id === inv.selected);
      const c = inv.count(s.id);
      this.set(`cnt${i}`, s.cnt, c === null ? '' : String(c));
    });
    const mats: [string, number, string][] = [
      ['logs', inv.logs, `/${MAX_LOGS}`],
      ['sticks', inv.mats.sticks, ''],
      ['rocks', inv.mats.rocks, ''],
      ['cloth', inv.mats.cloth, ''],
      ['hide', inv.mats.hide, ''],
      ['arrows', inv.mats.arrows, ''],
    ];
    for (const [key, n, suffix] of mats) {
      const e = this.matEls.get(key)!;
      this.set(`mat-${key}`, e, `${e.dataset.icon} ${n}${suffix}`);
      e.classList.toggle('dim', n === 0);
      if (key === 'arrows') e.style.display = inv.tools.has('bow') || n > 0 ? '' : 'none';
    }
  }

  setArmor(text: string): void {
    this.set('armor', this.armorEl, text);
  }

  setTutorial(step: number, total: number, text: string | null): void {
    if (text === null) {
      this.tutorial.style.display = 'none';
      return;
    }
    this.tutorial.style.display = '';
    this.set('tut-step', this.tutorialStep, `${step}/${total}`);
    this.set('tut-text', this.tutorialText, text);
  }

  setPrompts(list: { key: string; text: string }[]): void {
    const html = list.map((p) => `<div class="hud-prompt"><kbd>${p.key}</kbd>${p.text}</div>`).join('');
    this.set('prompts', this.prompts, html, 'html');
  }

  showTargetHealth(frac: number): void {
    this.targetTimer = 2.2;
    this.target.classList.add('on');
    this.targetFill.style.transform = `scaleX(${Math.max(0, frac).toFixed(3)})`;
  }

  toast(text: string): void {
    const t = el('div', 'hud-toast', this.toasts, text);
    setTimeout(() => t.remove(), 1850);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
  }

  hitMarker(): void {
    this.hit.classList.remove('on');
    void this.hit.offsetWidth;
    this.hit.classList.add('on');
  }

  message(title: string, body: string, seconds: number): void {
    this.msg.innerHTML = `<b>${title}</b>${body}`;
    this.msg.classList.add('on');
    window.setTimeout(() => this.msg.classList.remove('on'), seconds * 1000);
  }

  setFade(v: number): void {
    this.set('fade', this.fade, v.toFixed(3), 'opacity');
  }

  setHurt(v: number): void {
    this.set('vig', this.vignette, v.toFixed(2), 'opacity');
  }

  setFps(text: string): void {
    this.set('fps', this.fps, text);
  }

  update(dt: number): void {
    if (this.targetTimer > 0) {
      this.targetTimer -= dt;
      if (this.targetTimer <= 0) this.target.classList.remove('on');
    }
  }
}
