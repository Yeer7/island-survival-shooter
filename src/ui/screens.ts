import { tr } from './i18n';
const css = `
.end-screen {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 24px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #f4f7f5;
}
.end-screen.on {
  display: flex;
  animation: end-in 1.2s ease-out;
}
@keyframes end-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.end-screen.death {
  background: radial-gradient(ellipse at center, rgba(60, 4, 4, 0.82), rgba(6, 0, 0, 0.96));
}
.end-screen.victory {
  background: radial-gradient(ellipse at 50% 40%, rgba(255, 196, 120, 0.35), rgba(8, 20, 30, 0.92) 70%);
}
.end-screen h1 {
  font-size: clamp(30px, 6vw, 58px);
  letter-spacing: 0.12em;
  font-weight: 800;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
}
.end-screen.death h1 {
  color: #e8c3bc;
}
.end-screen p {
  max-width: 520px;
  color: #d9dcd8;
  font-size: 15px;
}
.end-screen .stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(110px, 1fr));
  gap: 10px;
  margin: 8px 0 6px;
}
.end-screen .stat {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.end-screen .stat b {
  display: block;
  font-size: 26px;
  font-variant-numeric: tabular-nums;
}
.end-screen .stat span {
  font-size: 11.5px;
  opacity: 0.8;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.end-screen .row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.end-screen button {
  border: 0;
  border-radius: 8px;
  padding: 12px 22px;
  font: 700 15px system-ui, sans-serif;
  cursor: pointer;
  background: #d97706;
  color: #fff;
}
.end-screen button.ghost {
  background: rgba(255, 255, 255, 0.14);
}
`;

export interface RunStats {
  days: number;
  kills: number;
  hunted: number;
}

/** Full-screen death and victory screens. */
export class Screens {
  private death: HTMLDivElement;
  private victory: HTMLDivElement;

  constructor() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    this.death = document.createElement('div');
    this.death.className = 'end-screen death';
    this.victory = document.createElement('div');
    this.victory.className = 'end-screen victory';
    document.body.append(this.death, this.victory);
  }

  get open(): boolean {
    return this.death.classList.contains('on') || this.victory.classList.contains('on');
  }

  showDeath(stats: RunStats, onRespawn: () => void, onNewGame: () => void): void {
    this.death.innerHTML = `<h1>${tr('VOCÊ MORREU', 'YOU DIED')}</h1>
      <p>${tr(`A ilha cobrou seu preço no dia ${stats.days}. Seu progresso salvo continua com você.`, `The island took its toll on day ${stats.days}. Your saved progress stays with you.`)}</p>
      <div class="row"><button data-a="respawn">${tr('Renascer na Ilha', 'Respawn on the Island')}</button><button class="ghost" data-a="new">${tr('Novo Jogo', 'New Game')}</button></div>`;
    this.death.querySelector('[data-a="respawn"]')!.addEventListener('click', () => {
      this.hide();
      onRespawn();
    });
    this.death.querySelector('[data-a="new"]')!.addEventListener('click', onNewGame);
    this.death.classList.add('on');
  }

  showVictory(stats: RunStats, onAgain: () => void, onContinue: () => void): void {
    this.victory.innerHTML = `<h1>${tr('VOCÊ ESCAPOU', 'YOU ESCAPED')}</h1>
      <p>${tr('O veleiro deixa a ilha para trás enquanto o sol toca o mar.', 'The sailboat leaves the island behind as the sun touches the sea.')}</p>
      <div class="stats">
        <div class="stat"><b>${stats.days}</b><span>${tr('Dias sobrevividos', 'Days survived')}</span></div>
        <div class="stat"><b>${stats.kills}</b><span>${tr('Inimigos derrotados', 'Enemies defeated')}</span></div>
        <div class="stat"><b>${stats.hunted}</b><span>${tr('Animais caçados', 'Animals hunted')}</span></div>
      </div>
      <div class="row"><button data-a="again">${tr('Jogar Novamente', 'Play Again')}</button><button class="ghost" data-a="continue">${tr('Continuar na Ilha', 'Stay on the Island')}</button></div>`;
    this.victory.querySelector('[data-a="again"]')!.addEventListener('click', onAgain);
    this.victory.querySelector('[data-a="continue"]')!.addEventListener('click', () => {
      this.hide();
      onContinue();
    });
    this.victory.classList.add('on');
  }

  hide(): void {
    this.death.classList.remove('on');
    this.victory.classList.remove('on');
  }
}
