import { Game } from './game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const game = new Game(canvas);
if (import.meta.env.DEV || debug) (window as unknown as { __game: Game }).__game = game;

const setPlaying = (on: boolean) => {
  overlay.style.display = on ? 'none' : 'flex';
  crosshair.style.display = on ? 'block' : 'none';
  playBtn.textContent = 'CONTINUAR';
  game.setPlaying(on);
};

playBtn.addEventListener('click', () => {
  if (debug) {
    // Headless checks run without pointer lock.
    setPlaying(true);
    return;
  }
  game.sound.start();
  const req = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
  if (req && typeof req.catch === 'function') req.catch(() => setPlaying(true));
});

document.addEventListener('pointerlockchange', () => {
  setPlaying(document.pointerLockElement === canvas);
});
document.addEventListener('pointerlockerror', () => setPlaying(true));
