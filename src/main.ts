import { AssetLibrary, setLibrary } from './assets/assets';
import { SaveStore } from './core/save';
import { Game } from './game';
import { startGallery } from './ui/gallery';

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
  playBtn.disabled = true;
  playBtn.textContent = 'CARREGANDO MODELOS…';
  const lib = new AssetLibrary();
  try {
    await lib.load((done, total) => (playBtn.textContent = `CARREGANDO MODELOS ${done}/${total}`));
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
  playBtn.textContent = hasSave ? 'CONTINUAR JOGO' : 'ENTRAR NA ILHA';
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
    playBtn.textContent = 'CONTINUAR';
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
