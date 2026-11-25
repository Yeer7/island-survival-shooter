import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ASSET_FILES, AssetLibrary, AssetName } from '../assets/assets';

/**
 * `?assets`: a lit room with an orbit camera showing every loaded model side by
 * side, each fitted to the same 2 m box, with its file name underneath.
 */
export function startGallery(canvas: HTMLCanvasElement, lib: AssetLibrary): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9dee2);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f94, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.position.set(12, 25, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -30;
  sc.right = sc.top = 30;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8dcff, 0.6);
  fill.position.set(-15, 10, -10);
  scene.add(fill);

  const names = Object.keys(ASSET_FILES) as AssetName[];
  const cols = 7;
  const spacing = 3.4;
  const rows = Math.ceil(names.length / cols);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(cols * spacing + 6, rows * spacing + 6), new THREE.MeshStandardMaterial({ color: 0xb9bec3, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(Math.max(cols, rows) * spacing + 6, Math.max(cols, rows) * 4, 0x9aa0a6, 0xa9aeb3);
  grid.position.y = 0.002;
  scene.add(grid);

  const mixers: THREE.AnimationMixer[] = [];
  names.forEach((name, i) => {
    if (!lib.has(name)) return;
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * spacing;
    const z = (r - (rows - 1) / 2) * spacing;
    const obj = lib.instance(name, { by: 'max', value: 2 });
    obj.position.set(x, 0, z);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    scene.add(obj);
    const clips = lib.raw(name).animations;
    if (clips.length) {
      const mixer = new THREE.AnimationMixer(obj.children[0]);
      const idle = clips.find((cl) => /(^|\|)Walk$/.test(cl.name)) ?? clips[0];
      mixer.clipAction(idle).play();
      mixers.push(mixer);
    }
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32), new THREE.MeshStandardMaterial({ color: 0xcfd3d7, roughness: 1 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.004, z);
    pad.receiveShadow = true;
    scene.add(pad);
    scene.add(label(ASSET_FILES[name].replace('assets/', ''), x, z + 1.45));
  });

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
  camera.position.set(0, 8.5, rows * spacing * 0.75 + 2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.8, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.update();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const m of mixers) m.update(dt);
    controls.update();
    renderer.render(scene, camera);
  });
  (window as unknown as { __gallery: unknown }).__gallery = { scene, camera, controls, renderer, count: names.filter((n) => lib.has(n)).length };
}

/** File name drawn on a canvas, lying on the floor under each model. */
function label(text: string, x: number, z: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,26,30,0.85)';
  g.beginPath();
  g.roundRect(4, 6, 504, 52, 12);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '600 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 33, 490);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.375), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.01, z);
  return m;
}
