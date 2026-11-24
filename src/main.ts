import * as THREE from 'three';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const crosshair = document.getElementById('crosshair') as HTMLDivElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;

// Renderer otimizado para WebGL 60 FPS
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88bdd6);
scene.fog = new THREE.FogExp2(0x88bdd6, 0.0045);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 3.2, 45);

// Iluminação base
const hemi = new THREE.HemisphereLight(0xdff2ff, 0x3b4d32, 0.8);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1d0, 1.4);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// Oceano e Ilha inicial
const ocean = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshStandardMaterial({ color: 0x1a5f7a, roughness: 0.25, metalness: 0.1 })
);
ocean.rotation.x = -Math.PI / 2;
ocean.position.y = 0;
scene.add(ocean);

const island = new THREE.Mesh(
  new THREE.CylinderGeometry(85, 110, 4, 48),
  new THREE.MeshStandardMaterial({ color: 0x5c8a47, roughness: 0.9 })
);
island.position.y = 0.2;
island.receiveShadow = true;
scene.add(island);

const beach = new THREE.Mesh(
  new THREE.RingGeometry(82, 105, 48),
  new THREE.MeshStandardMaterial({ color: 0xdcc791, roughness: 0.95, side: THREE.DoubleSide })
);
beach.rotation.x = -Math.PI / 2;
beach.position.y = 0.35;
beach.receiveShadow = true;
scene.add(beach);

// Controles simples 1ª pessoa (PointerLock)
let isLocked = false;
let yaw = 0;
let pitch = 0;
const keys = new Set<string>();

playBtn.addEventListener('click', () => {
  canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === canvas;
  overlay.style.display = isLocked ? 'none' : 'flex';
  crosshair.style.display = isLocked ? 'block' : 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isLocked) return;
  yaw -= e.movementX * 0.0022;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch - e.movementY * 0.0022));
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
});

window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (isLocked) {
    const speed = keys.has('ShiftLeft') ? 16 : 10;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    if (keys.has('KeyW')) camera.position.addScaledVector(forward, speed * dt);
    if (keys.has('KeyS')) camera.position.addScaledVector(forward, -speed * dt);
    if (keys.has('KeyD')) camera.position.addScaledVector(right, speed * dt);
    if (keys.has('KeyA')) camera.position.addScaledVector(right, -speed * dt);
  }

  renderer.render(scene, camera);
}

animate();
