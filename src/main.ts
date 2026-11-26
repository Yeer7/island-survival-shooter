import { AssetLibrary, setLibrary } from './assets/assets';
import { SaveStore } from './core/save';
import { Game } from './game';
import { startGallery } from './ui/gallery';
import { Lang, getLang, onLangChange, setLang, tr } from './ui/i18n';

/** Title screen text in both languages. */
function menuText(): Record<string, string> {
  return {
    kicker: tr('OpenGame Jam · Sobrevivência', 'OpenGame Jam · Survival'),
    sub: tr('Cinzas da Floresta', 'Ashes of the Forest'),
    tagline: tr(
      'Você acordou dentro do avião caído no meio da floresta. Quebre as malas, corte lenha e erga sua base antes do anoitecer.',
      'You come round inside the crashed airliner, deep in the forest. Break the suitcases, chop wood and raise your camp before nightfall.',
    ),
    controls: tr(
      '<li><kbd>WASD</kbd> mover · <kbd>Shift</kbd> correr · <kbd>Espaço</kbd> pular</li><li><kbd>Clique</kbd> usar / segurar para puxar o arco · <kbd>1</kbd>–<kbd>9</kbd> / roda: trocar item</li><li><kbd>E</kbd> interagir · <kbd>Tab</kbd>/<kbd>B</kbd> Livro de Sobrevivência · <kbd>G</kbd> soltar tora · <kbd>R</kbd> girar · <kbd>Q</kbd> cancelar</li>',
      '<li><kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump</li><li><kbd>Click</kbd> use / hold to draw the bow · <kbd>1</kbd>–<kbd>9</kbd> / wheel: switch item</li><li><kbd>E</kbd> interact · <kbd>Tab</kbd>/<kbd>B</kbd> Survival Book · <kbd>G</kbd> drop log · <kbd>R</kbd> rotate · <kbd>Q</kbd> cancel</li>',
    ),
    sens: tr('Sensibilidade do mouse', 'Mouse sensitivity'),
    newgame: tr('Novo Jogo (Apagar Save)', 'New Game (Erase Save)'),
    credits: tr('Créditos CC0', 'CC0 Credits'),
    creditsBody: `<h2>${tr('Créditos', 'Credits')}</h2>
      <p>${tr('Todos os modelos e texturas de terceiros são CC0 (domínio público). Obrigado!', 'Every third-party model and texture is CC0 (public domain). Thank you!')}</p>
      <ul>
        <li><b>Quaternius</b> — ${tr('árvores, palmeiras, arbustos, grama, pedras, animais, inimigos (humano, esqueleto, lobo, aranha, gigante), ferramentas, crânios, ossos, caixotes, barris, caldeirão, cogumelos e o Survival Pack', 'trees, palms, bushes, grass, rocks, animals, enemies (human, skeleton, wolf, spider, giant), tools, skulls, bones, crates, barrels, cauldron, mushrooms and the Survival Pack')} · quaternius.com · poly.pizza</li>
        <li><b>Kenney</b> — Survival Kit 2.0 (${tr('fogueira, peixe', 'campfire pit, fish')}), Impact Sounds (${tr('impactos', 'impacts')}) · kenney.nl</li>
        <li><b>Freesound (CC0)</b> — ${tr('sons gravados', 'recorded sounds')}: Alex_hears_things (${tr('mar', 'sea')}), Nox_Sound (${tr('floresta de dia', 'forest by day')}), timothyd4y (${tr('floresta à noite', 'forest at night')}), marb7e (${tr('fogueira', 'campfire')}), micahlg (${tr('machado', 'axe')}), Sadiquecat (${tr('golpe no ar', 'swing')}), ozymandias37 (${tr('árvore caindo', 'falling tree')}), Fission9 (${tr('passos', 'footsteps')}) · freesound.org</li>
        <li><b>Poly Haven</b> — ${tr('texturas "Rock Face" (caverna) e "Pine Bark" (pinheiros, tocos e toras)', '"Rock Face" (cave) and "Pine Bark" (pines, stumps and logs) textures')} · polyhaven.com</li>
        <li><b>iPoly3D</b> — ${tr('cristais da caverna', 'cave crystals')} · poly.pizza</li>
        <li>${tr('Avião, machados, pinheiros, palmeiras, grama, arbustos, cabanas, aldeia, efígies, caverna, ambiência e efeitos: feitos em código (Three.js).', 'Airliner, axes, pines, palms, grass, shrubs, cabins, village, effigies, cave, ambience and effects: made in code (Three.js).')}</li>
      </ul>
      <button class="close" data-close>${tr('Fechar', 'Close')}</button>`,
  };
}

/** Fill every tagged element of the title screen with the current language. */
function applyMenuLang(): void {
  const t = menuText();
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t[el.dataset.i18n!] ?? ''));
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => (el.innerHTML = t[el.dataset.i18nHtml!] ?? ''));
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  document.querySelector('#credits [data-close]')?.addEventListener('click', () => document.getElementById('credits')!.classList.remove('on'));
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const newGameBtn = document.getElementById('newgame-btn') as HTMLButtonElement;
const sens = document.getElementById('sens') as HTMLInputElement;
const sensVal = document.getElementById('sens-val') as HTMLSpanElement;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

async function boot(): Promise<void> {
  document.documentElement.lang = getLang() === 'pt' ? 'pt-BR' : 'en';
  applyMenuLang();
  let playState: 'loading' | 'continue' | 'enter' | 'resume' = 'loading';
  let progress = '';
  const playLabel = () => {
    playBtn.textContent =
      playState === 'loading'
        ? `${tr('CARREGANDO MODELOS', 'LOADING MODELS')} ${progress}`
        : playState === 'continue'
          ? tr('CONTINUAR JOGO', 'CONTINUE')
          : playState === 'resume'
            ? tr('CONTINUAR', 'RESUME')
            : tr('ENTRAR NA ILHA', 'ENTER THE ISLAND');
  };
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang as Lang)));
  onLangChange(() => {
    applyMenuLang();
    playLabel();
  });
  document.getElementById('credits-btn')!.addEventListener('click', () => document.getElementById('credits')!.classList.add('on'));
  document.getElementById('credits')!.addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('on');
  });
  playBtn.disabled = true;
  playLabel();
  const lib = new AssetLibrary();
  try {
    await lib.load((done, total) => {
      progress = `${done}/${total}`;
      playLabel();
    });
  } catch (e) {
    console.warn('Some models failed to load; using built-in shapes where needed.', e);
  }
  setLibrary(lib);
  if (params.has('assets')) {
    // Asset inspection gallery instead of the game.
    overlay.style.display = 'none';
    startGallery(canvas, lib);
    return;
  }
  const game = new Game(canvas, lib);
  if (import.meta.env.DEV || debug) (window as unknown as { __game: Game }).__game = game;
  playBtn.disabled = false;
  const hasSave = SaveStore.load() !== null;
  playState = hasSave ? 'continue' : 'enter';
  playLabel();
  newGameBtn.style.display = hasSave ? '' : 'none';
  newGameBtn.addEventListener('click', () => game.newGame());

  sens.value = String(game.player.sensitivity);
  sensVal.textContent = `${game.player.sensitivity.toFixed(2)}×`;
  sens.addEventListener('input', () => {
    const v = Number(sens.value);
    game.setSensitivity(v);
    sensVal.textContent = `${v.toFixed(2)}×`;
  });

  const show = (playing: boolean) => {
    overlay.style.display = playing || game.menuOpen || game.screens.open ? 'none' : 'flex';
    if (!playing && SaveStore.load()) newGameBtn.style.display = '';
    crosshair.style.display = playing ? 'block' : 'none';
  };

  const lock = () => {
    if (debug) {
      show(true);
      game.setPlaying(true);
      return;
    }
    game.sound.start();
    const req = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (req && typeof req.catch === 'function') req.catch(() => show(false));
  };
  game.requestLock = lock;

  playBtn.addEventListener('click', () => {
    playState = 'resume';
    playLabel();
    lock();
  });

  document.addEventListener('pointerlockchange', () => {
    const on = document.pointerLockElement === canvas;
    game.setPlaying(on);
    show(on);
  });
  document.addEventListener('pointerlockerror', () => show(false));
}

void boot();
