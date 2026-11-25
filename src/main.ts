import { Game } from './game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const sens = document.getElementById('sens') as HTMLInputElement;
const sensVal = document.getElementById('sens-val') as HTMLSpanElement;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const game = new Game(canvas);
if (import.meta.env.DEV || debug) (window as unknown as { __game: Game }).__game = game;

sens.value = String(game.player.sensitivity);
sensVal.textContent = `${game.player.sensitivity.toFixed(2)}×`;
sens.addEventListener('input', () => {
  const v = Number(sens.value);
  game.setSensitivity(v);
  sensVal.textContent = `${v.toFixed(2)}×`;
});

const show = (playing: boolean) => {
  overlay.style.display = playing || game.menuOpen ? 'none' : 'flex';
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
