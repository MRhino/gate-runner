import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { buildEnemyModels, HIP_Y, type EnemyModel } from './models';
import { createAmbient } from './env';
import { createHero, createSquad, createProjectiles, tierOf, tierCss } from './hero';
import { createFx } from './fx';
import { createGateRow, type GateRowVisual } from './gates';
import { WEAPONS, WEAPON_KINDS, type WeaponKind } from './weapons';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// A new deploy installs in the background and would normally reload the page straight
// away — mid-run if you'd just tapped play. Defer that reload until you're not playing.
let reloadPending = false;
declare const __APP_VERSION__: string, __COMMIT__: string;
const updateSW = registerSW({
  immediate: true,
  onNeedReload() {
    if (state === 'play' || state === 'paused') reloadPending = true;
    else location.reload();
  },
});

// ---------- Tunables ----------
const ROAD_HALF = 4; // road spans x in [-4, 4]
const SPAWN_Z = -70;
const WORLD_SPEED = 5; // speed gates / crates move toward the player
const MAX_BULLETS = 800;
const MAX_ENEMIES = 400;
const PLAYER_LIVES = 5;

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Fog uses exactly the sky's horizon colour, so the world fades into the sky with no seam.
const HORIZON = 0x5a2766;
scene.fog = new THREE.Fog(HORIZON, 35, 125);
// Gradient sky dome: deep violet overhead fading to a warm dusk glow at the horizon.
const skyUniforms = {
  top: { value: new THREE.Color(0x0d0828) },
  horizon: { value: new THREE.Color(HORIZON) },
  hurt: { value: 0 },
};
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(150, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform float hurt; varying vec3 vP;
      void main(){ float h = clamp(normalize(vP).y * 2.5, 0.0, 1.0);
        vec3 c = mix(horizon, top, h); c = mix(c, vec3(0.6,0.05,0.12), hurt);
        gl_FragColor = vec4(c, 1.0); }`,
  }),
));

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 320);
camera.position.set(0, 10, 9);
camera.lookAt(0, 0, -16);

scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x3a2050, 1.5));
const sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
sun.position.set(5, 15, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 2048);
sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -40 });
scene.add(sun);

// Bloom makes the emissive bits (bullets, enemy shots, lamps, visors) glow.
// Runs at reduced resolution to keep it cheap on phones (see resize).
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Threshold above 1: only things deliberately made brighter than white glow (flames, shots,
// lanterns). Plain white like gate and crate text stays crisp.
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  // Composer sizes bloom to the high-DPI buffer; resize it to CSS pixels instead (the pass halves
  // that again internally), which is visually identical for a soft glow and far cheaper on phones.
  bloom.setSize(w, h);
  camera.aspect = w / h;
  // Keep the whole road visible on narrow portrait screens.
  camera.fov = w / h < 0.6 ? 62 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Road (static: you hold your ground, everything comes to you) ----------
// Subtle tile pattern on the road via a canvas texture.
const roadTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3070'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#342a63'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#2a2150'; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 100);
  t.anisotropy = 4;
  return t;
})();
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_HALF * 2, 200),
  new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 }),
);
road.rotation.x = -Math.PI / 2;
road.position.z = -80;
road.receiveShadow = true;
scene.add(road);

// Ground either side of the road, with scattered rocks and glowing lamp posts.
// One huge ground plane (the old side strips ended mid-view, which looked like the world was cut off).
{
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x1d3a3a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -100);
  ground.receiveShadow = true;
  scene.add(ground);
}
{
  const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x4a5a6a, flatShading: true }), 60);
  const o = new THREE.Object3D();
  for (let i = 0; i < 60; i++) {
    const side = i % 2 ? 1 : -1;
    o.position.set(side * (ROAD_HALF + 1.2 + Math.random() * 10), 0.1, 6 - Math.random() * 90);
    o.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    o.scale.setScalar(0.4 + Math.random() * 1.4);
    o.updateMatrix();
    rocks.setMatrixAt(i, o.matrix);
  }
  rocks.castShadow = rocks.receiveShadow = true;
  scene.add(rocks);
}
const updateAmbient = createAmbient(scene, ROAD_HALF, camera);

const stripeMat = new THREE.MeshBasicMaterial({ color: 0x6d5fc0 });
for (let i = 0; i < 20; i++) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 2), stripeMat);
  s.rotation.x = -Math.PI / 2;
  s.position.set(0, 0.01, -i * 5);
  scene.add(s);
}
for (const side of [-1, 1]) {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 200),
    new THREE.MeshStandardMaterial({ color: 0xff5d8f, emissive: 0xff2d6f, emissiveIntensity: 0.6 }),
  );
  rail.position.set(side * (ROAD_HALF + 0.15), 0.2, -80);
  scene.add(rail);
}

// ---------- Player ----------
const player = new THREE.Group();
// Cel shading: a 3-step light ramp gives the clean, cartoon look of stylised low-poly packs.
const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const toon = () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp });
const hero = createHero(toon());
player.add(hero.root);
scene.add(player);
const fx = createFx(scene, camera);

// ---------- Text textures for gates and crates ----------
function makeLabel(w = 256, h = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (text: string, bg: string, fg = '#fff') => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.font = `900 ${Math.min(h * 0.5, (w * 1.5) / text.length)}px system-ui, sans-serif`; // shrink long labels (weapon names)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

// ---------- Game state ----------
type GateOp = { n: number }; // +n or -n squad members
type GateRow = { z: number; passed: boolean; mid: number; ops: [GateOp, GateOp]; vis: GateRowVisual };
type Bullet = { x: number; z: number; vx: number; alive: boolean; w: WeaponKind; crate?: Crate; pierced?: Set<Enemy> };
type Mate = { x: number; z: number; recoil: number; spawn: number };
type EnemyKind = 'grunt' | 'runner' | 'blue' | 'purple' | 'orange' | 'red' | 'boss';
type Enemy = {
  x: number; z: number; hp: number; maxHp: number; speed: number; wobble: number; fireCd: number;
  tx: number; retarget: number; vx: number; // weaving: lateral target, time until a new one, sideways velocity
  kind: EnemyKind; size: number; color: THREE.Color; dmg: number; points: number; flash: number;
  spawn: number; // 0 -> 1 as it materialises
};

// Tougher tiers are rarer: low-HP grunts make up the bulk of every pack, heavies get mixed in.
// `wave` = first wave the tier can appear; `weight` = relative spawn chance once unlocked.
type EnemyType = { hp: number; speed: number; size: number; color: number; dmg: number; points: number; wave: number; weight: number };
const ENEMY_TYPES: Record<EnemyKind, EnemyType> = {
  grunt: { hp: 2, speed: 1, size: 1, color: 0x4caf50, dmg: 1, points: 10, wave: 1, weight: 60 },
  runner: { hp: 1, speed: 1.7, size: 0.75, color: 0xffeb3b, dmg: 1, points: 15, wave: 2, weight: 18 },
  blue: { hp: 10, speed: 0.95, size: 1.15, color: 0x2196f3, dmg: 1, points: 40, wave: 2, weight: 14 },
  purple: { hp: 25, speed: 0.85, size: 1.35, color: 0x9c27b0, dmg: 1, points: 100, wave: 3, weight: 7 },
  orange: { hp: 60, speed: 0.75, size: 1.6, color: 0xff7a1a, dmg: 2, points: 250, wave: 5, weight: 4 },
  red: { hp: 150, speed: 0.65, size: 1.9, color: 0xe53935, dmg: 2, points: 600, wave: 7, weight: 2 },
  boss: { hp: 350, speed: 0.4, size: 3, color: 0x3a0a0a, dmg: 3, points: 3000, wave: 5, weight: 0 },
};
type UpgradeKind = 'rate' | 'gun' | 'dmg' | 'speed' | 'heal' | 'weapon';
type Crate = {
  x: number; z: number; hp: number; maxHp: number; open: boolean; kind: UpgradeKind; weapon?: WeaponKind; shown?: number;
  mesh: THREE.Mesh; sprite: THREE.Sprite; draw: (t: string, bg: string, fg?: string) => void;
};

const UPGRADES: Record<UpgradeKind, { label: string; color: string }> = {
  rate: { label: 'RATE+', color: '#29c46b' },
  gun: { label: 'ALLY+', color: '#2f9bff' },
  dmg: { label: 'DMG+', color: '#ff8a29' },
  speed: { label: 'SPD+', color: '#c74bff' },
  heal: { label: '+♥', color: '#ff4d8d' },
  weapon: { label: '', color: '' }, // label/colour come from the weapon itself
};

let state: 'menu' | 'play' | 'paused' | 'over' = 'menu';
let bullets: Bullet[] = [];
let enemies: Enemy[] = [];
let rows: GateRow[] = [];
let crates: Crate[] = [];
let playerX = 0, targetX = 0;
let weapon: WeaponKind = 'blaster';
let mates: Mate[] = []; // squad members other than you
let lives = PLAYER_LIVES, score = 0, time = 0, wave = 0;

// ---------- Difficulty director ----------
// One knob instead of stacked multipliers: the game sends a stream of enemy HP per
// second equal to a fraction ("pressure") of your firepower. Get stronger and more
// comes at you, but never faster than you can grow. Pressure rises gently per wave
// and nudges up/down with how comfortably you're winning.
const BASE_DPS = 5; // starting loadout: 1 trooper x 1 dmg x 5/s blaster
// Per-trooper damage per second with the current weapon (ignoring splash/pierce bonuses).
const trooperDps = () => damage * fireRate * WEAPONS[weapon].rate * WEAPONS[weapon].dmg;
const playerDps = () => shotsPerVolley() * trooperDps() * WEAPONS[weapon].crowdFactor;
// DPS you can put on a single target `width` units wide: only troopers lined up behind it count.
// A big squad is great against crowds but doesn't make one big enemy melt any faster.
function dpsOnTarget(width: number) {
  const inLine = squadSlots(shotsPerVolley()).filter((s) => Math.abs(s.x) <= width / 2 + 0.05).length;
  return inLine * trooperDps();
}
// Individual enemies get only mildly tankier (sqrt); extra power mostly means *more* enemies.
const hpScale = () => Math.sqrt(playerDps() / BASE_DPS);
// Not every bullet lands (the gun is narrower than the road), so pressure stays well under 1.
// Rises fastest in early waves, then flattens out toward 0.8 (~0.69 by wave 6, ~0.77 by wave 11).
const wavePressure = () => 0.5 + 0.3 * (1 - Math.exp(-(wave - 1) / 5));
// Performance nudge: killing far up the road pushes it up, close calls / lost hearts pull it down.
let perf = 1, killDepth = -30;
const PERF_MIN = 0.7, PERF_MAX = 1.3;
const pressure = () => wavePressure() * perf;
let hpBudget = 0;
let fireRate = 5, gunCount = 1, gateBonus = 0, damage = 1, bulletSpeed = 30;
let fireTimer = 0, enemyTimer = 0, rowTimer = 2, crateTimer = 6;
let hurtFlash = 0;

// Squad size = you + ALLY+ pickups + whatever the gates have added. Everyone fires.
const MAX_SHOTS = 30;
const shotsPerVolley = () => THREE.MathUtils.clamp(gunCount + gateBonus, 1, MAX_SHOTS);
// Formation: you at the front-centre, allies fanning out beside you, then rows behind.
// Up to 7 across (about 3 units wide); later rows are staggered so everyone has a firing lane.
function squadSlots(n: number) {
  const slots = [{ x: 0, z: 0 }];
  const order = [1, -1, 2, -2, 3, -3];
  for (let row = 0; slots.length < n; row++) {
    const stagger = row % 2 ? 0.25 : 0;
    const cols = row === 0 ? order : [0, ...order];
    for (const c of cols) {
      if (slots.length >= n) break;
      slots.push({ x: c * 0.5 + (c === 0 ? stagger : Math.sign(c) * stagger), z: row * 0.65 + (row === 0 ? 0.15 : 0.65) });
    }
  }
  return slots;
}
// Add or remove allies to match the squad size, with a beam-in / burst-out effect.
function syncSquad() {
  const want = shotsPerVolley() - 1;
  const slots = squadSlots(want + 1);
  while (mates.length < want) {
    const s = slots[mates.length + 1];
    const m = { x: playerX + s.x, z: s.z, recoil: 0, spawn: 0 };
    mates.push(m);
    fx.portal(m.x, m.z, 0x4de8ff, 0.6);
  }
  while (mates.length > want) {
    const m = mates.pop()!;
    fx.sparks(m.x, 0.9, m.z, 0xff4060, 14, 4);
  }
}

// ---------- Instanced bullets & enemies ----------
const drawProjectiles = createProjectiles(scene, MAX_BULLETS);
const drawSquad = createSquad(scene, toon(), MAX_SHOTS);

// One set of instanced meshes per enemy type: tinted body, untinted accents, and two legs.
const enemyMat = toon();
const accentMat = toon();
type EnemyMeshes = {
  body: THREE.InstancedMesh; accent: THREE.InstancedMesh;
  legL: THREE.InstancedMesh; legR: THREE.InstancedMesh; armL: THREE.InstancedMesh; armR: THREE.InstancedMesh;
};
const enemyMeshes: Record<string, EnemyMeshes> = {};
const enemyRigs: Record<string, EnemyModel> = {};
for (const [kind, model] of Object.entries(buildEnemyModels())) {
  enemyRigs[kind] = model;
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.InstancedMesh(geo, mat, MAX_ENEMIES);
    m.castShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  };
  enemyMeshes[kind] = {
    body: mk(model.body, enemyMat), accent: mk(model.accent, accentMat),
    legL: mk(model.leg, enemyMat), legR: mk(model.leg, enemyMat),
    armL: mk(model.arm, enemyMat), armR: mk(model.arm, enemyMat),
  };
  // Shadows from the body and legs are enough; skipping the small parts saves a lot on phones.
  enemyMeshes[kind].accent.castShadow = enemyMeshes[kind].armL.castShadow = enemyMeshes[kind].armR.castShadow = false;
}

// Enemy shots: slow glowing orbs fired by the bigger types. Dodge them or lose a heart.
const SHOOTERS: Partial<Record<EnemyKind, { cd: number; spread: number }>> = {
  purple: { cd: 4, spread: 1 },
  orange: { cd: 3.2, spread: 1 },
  red: { cd: 2.6, spread: 2 },
  boss: { cd: 1.6, spread: 3 },
};
const SHOT_SPEED = 9;
type Shot = { x: number; z: number; vx: number; vz: number };
let shots: Shot[] = [];
// Hot orange/red reads as "danger" against the violet road and your pale-yellow bullets.
const shotPart = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
  const m = new THREE.InstancedMesh(geo, mat, 200);
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
};
const additive = (color: number, k: number, opacity = 1) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const shotCore = shotPart(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2c0).multiplyScalar(1.6) }));
const shotHalo = shotPart(new THREE.SphereGeometry(0.3, 12, 8), additive(0xff5a10, 1.4, 0.75));
// Trail: a cone stretched behind the shot along its direction of travel (a cheap motion blur).
const shotTrail = shotPart(new THREE.ConeGeometry(0.22, 1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5), additive(0xff3a00, 1.2, 0.55));
// Marker on the ground under each shot so you can judge where it'll cross your line.
const shotMarker = shotPart(new THREE.RingGeometry(0.22, 0.34, 20).rotateX(-Math.PI / 2), additive(0xff4a10, 1, 0.6));
function enemyFire(e: Enemy) {
  const cfg = SHOOTERS[e.kind];
  if (!cfg) return;
  // Aim at where you are now; multi-shot types fan out so you have to pick a gap.
  for (let i = 0; i < cfg.spread; i++) {
    const off = (i - (cfg.spread - 1) / 2) * 1.2;
    const dx = playerX + off - e.x, dz = -e.z;
    const len = Math.hypot(dx, dz);
    if (shots.length < 200) shots.push({ x: e.x, z: e.z + 0.5 * e.size, vx: (dx / len) * SHOT_SPEED, vz: (dz / len) * SHOT_SPEED });
  }
}

// Death bursts: little cubes that pop out in the enemy's colour.
type Particle = { p: THREE.Vector3; v: THREE.Vector3; life: number; color: THREE.Color };
const MAX_PARTICLES = 600;
let particles: Particle[] = [];
const particleMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.14, 0.14, 0.14),
  new THREE.MeshStandardMaterial({ roughness: 0.5 }),
  MAX_PARTICLES,
);
particleMesh.frustumCulled = false;
scene.add(particleMesh);
function burst(e: Enemy) {
  const n = Math.min(6 + Math.round(e.size * 6), MAX_PARTICLES - particles.length);
  for (let i = 0; i < n; i++) {
    particles.push({
      p: new THREE.Vector3(e.x, 0.8 * e.size, e.z),
      v: new THREE.Vector3(rand(-3, 3), rand(3, 7), rand(-3, 3)).multiplyScalar(Math.sqrt(e.size)),
      life: rand(0.4, 0.8),
      color: e.color,
    });
  }
}

// Health bars: a dark backing plus a fill, both instanced and facing the camera.
const BAR_W = 0.9, BAR_H = 0.12;
const makeBars = (color: number, order: number) => {
  const m = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
    MAX_ENEMIES,
  );
  m.frustumCulled = false;
  m.renderOrder = order;
  scene.add(m);
  return m;
};
const barBack = makeBars(0x111111, 10);
const barFill = makeBars(0xffffff, 11);

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();
const legTmp = new THREE.Object3D(), limbScratch = new THREE.Color(); // reused every frame, no GC churn
const WHITE = new THREE.Color(0xffffff);

// ---------- Spawning ----------
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function randomOp(good: boolean): GateOp {
  return { n: good ? pick([1, 1, 1, 2, 2, 3]) : -pick([1, 2, 2, 3, 4]) };
}
const opText = (o: GateOp) => (o.n > 0 ? '+' : '−') + Math.abs(o.n);
const isGood = (o: GateOp) => o.n > 0;

function spawnRow() {
  // Mostly one good + one bad side; sometimes both good with different values.
  const goodLeft = Math.random() < 0.5;
  const bothGood = Math.random() < 0.1;
  const ops: [GateOp, GateOp] = [
    randomOp(bothGood || goodLeft),
    randomOp(bothGood || !goodLeft),
  ];
  // The split between halves drifts so you have to aim, not just pick a side.
  const mid = rand(-1.5, 1.5);
  const spans: [number, number][] = [[-ROAD_HALF, mid], [mid, ROAD_HALF]];
  const vis = createGateRow(scene, spans, ops.map(opText), ops.map(isGood));
  vis.setZ(SPAWN_Z);
  rows.push({ z: SPAWN_Z, passed: false, mid, ops, vis });
}

const WAVE_SECONDS = 20;

function spawnEnemy(kind: EnemyKind, cx?: number, z = SPAWN_Z + rand(-5, 0)): number {
  if (enemies.length >= MAX_ENEMIES) return 0;
  const t = ENEMY_TYPES[kind];
  // Bosses take ~(8 + 0.4 x wave) seconds of your full firepower; others scale gently with power.
  // Every enemy must be killable before it reaches you: cap its HP at a set number of
  // seconds of the fire you can actually land on something its width. Tougher types get longer.
  const width = 1.1 * t.size + 0.2;
  const killSeconds = kind === 'boss' ? 8 + wave * 0.4 : THREE.MathUtils.clamp(t.hp / 12, 0.4, 4);
  const cap = dpsOnTarget(width) * killSeconds;
  const maxHp = kind === 'boss'
    ? Math.round(cap * perf)
    : Math.round(Math.min(t.hp * hpScale(), cap) * rand(0.9, 1.1));
  const edge = ROAD_HALF - 0.4 * t.size;
  enemies.push({
    x: kind === 'boss' ? 0 : THREE.MathUtils.clamp(cx ?? rand(-edge, edge), -edge, edge),
    z,
    hp: Math.max(1, maxHp), maxHp: Math.max(1, maxHp),
    speed: rand(6, 7.5) * (1 + (wave - 1) * 0.04) * t.speed,
    wobble: Math.random() * 10,
    tx: 0, retarget: 0, vx: 0, fireCd: rand(1, 2.5),
    kind, size: t.size, color: new THREE.Color(t.color), dmg: t.dmg, points: t.points, flash: 0, spawn: 0,
  });
  const e = enemies[enemies.length - 1];
  fx.portal(e.x, e.z, t.color, 0.6 * t.size);
  return Math.max(1, maxHp);
}

function randomKind(): EnemyKind {
  // Heavier tiers become a bit more common the longer they've been unlocked.
  const pool = (Object.keys(ENEMY_TYPES) as EnemyKind[])
    .filter((k) => ENEMY_TYPES[k].weight > 0 && wave >= ENEMY_TYPES[k].wave)
    .map((k) => [k, ENEMY_TYPES[k].weight * (k === 'grunt' ? 1 : 1 + 0.15 * (wave - ENEMY_TYPES[k].wave))] as const);
  let roll = Math.random() * pool.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of pool) if ((roll -= w) <= 0) return k;
  return 'grunt';
}

function startWave(n: number) {
  wave = n;
  if (wave % 5 === 0) spawnEnemy('boss');
  showBanner(wave % 5 === 0 ? `WAVE ${wave} · BOSS` : `WAVE ${wave}`);
}

function spawnCrate() {
  // Hearts are rare (~1 in 7) and only offered when you're missing one.
  // About 1 in 3 crates offers a different weapon; the rest are stat upgrades.
  const kind: UpgradeKind = lives < PLAYER_LIVES && Math.random() < 0.15
    ? 'heal' : Math.random() < 0.33 ? 'weapon' : pick<UpgradeKind>(['rate', 'gun', 'dmg', 'speed']);
  const offered = kind === 'weapon' ? pick(WEAPON_KINDS.filter((k) => k !== weapon)) : undefined;
  // ~3s of focused fire from the barrels that actually fit across the crate (about 2 units
  // wide), not your whole gun. Tracking full DPS made crates unreachable once the gun got wide.
  const maxHp = Math.round(20 + dpsOnTarget(2) * 3);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x8a6a4a }),
  );
  mesh.castShadow = true;
  const x = rand(-ROAD_HALF + 1, ROAD_HALF - 1);
  mesh.position.set(x, 0.8, SPAWN_Z);
  const { tex, draw } = makeLabel();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2, 1, 1);
  sprite.position.set(x, 2.4, SPAWN_Z);
  scene.add(mesh, sprite);
  const c: Crate = { x, z: SPAWN_Z, hp: maxHp, maxHp, open: false, kind, weapon: offered, mesh, sprite, draw };
  draw(String(maxHp), '#000a');
  crates.push(c);
}

function removeCrate(c: Crate) {
  scene.remove(c.mesh, c.sprite);
  c.mesh.geometry.dispose();
  (c.mesh.material as THREE.Material).dispose();
  c.sprite.material.map?.dispose();
  c.sprite.material.dispose();
}
function removeRow(r: GateRow) {
  r.vis.dispose();
}

// ---------- Gate logic ----------
// Gates act on the player: walking through one adds or removes squad members.
function passGate(r: GateRow) {
  r.passed = true;
  const i = playerX < r.mid ? 0 : 1;
  const n = r.ops[i].n;
  const [a, b] = i === 0 ? [-ROAD_HALF, r.mid] : [r.mid, ROAD_HALF];
  r.vis.pass(i, THREE.MathUtils.clamp((playerX - a) / (b - a), 0, 1));
  gateBonus = THREE.MathUtils.clamp(gateBonus + n, 1 - gunCount, MAX_SHOTS - gunCount);
  syncSquad();
  fx.text(playerX, 2.6, 0.5, opText(r.ops[i]), n > 0 ? '#7fd8ff' : '#ff6b81', 1.3);
  fx.sparks(playerX, 1.2, 0, n > 0 ? 0x4de8ff : 0xff3050, 24, 6);
  if (n < 0) fx.shake(0.18);
  flashScreen(n > 0 ? 'rgba(80,200,255,0.35)' : 'rgba(255,40,70,0.4)');
  navigator.vibrate?.(n > 0 ? 30 : 80);
}

// Brief full-screen colour wash (gate results, pickups).
const screenFlash = document.createElement('div');
screenFlash.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;transition:opacity .35s ease-out;';
document.body.appendChild(screenFlash);
function flashScreen(color: string) {
  screenFlash.style.transition = 'none';
  screenFlash.style.background = `radial-gradient(ellipse at center, transparent 35%, ${color})`;
  screenFlash.style.opacity = '1';
  requestAnimationFrame(() => { screenFlash.style.transition = 'opacity .45s ease-out'; screenFlash.style.opacity = '0'; });
}

// ---------- Input: relative drag ----------
let dragging = false, dragStartX = 0, dragStartTarget = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragStartX = e.clientX;
  dragStartTarget = targetX;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const unitsPerPx = (ROAD_HALF * 2.4) / innerWidth;
  targetX = THREE.MathUtils.clamp(
    dragStartTarget + (e.clientX - dragStartX) * unitsPerPx,
    -ROAD_HALF + 0.5, ROAD_HALF - 0.5,
  );
});
const endDrag = () => (dragging = false);
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') targetX = Math.max(-ROAD_HALF + 0.5, targetX - 1);
  if (e.key === 'ArrowRight') targetX = Math.min(ROAD_HALF - 0.5, targetX + 1);
});

// ---------- HUD ----------
const $ = (id: string) => document.getElementById(id)!;
const overlay = $('overlay'), startBtn = $('start');
const best = () => Number(localStorage.getItem('gate-runner-best') ?? 0);

let bannerTimeout = 0;
function showBanner(text: string) {
  const el = $('banner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = window.setTimeout(() => el.classList.remove('show'), 1800);
}

function updateHud() {
  $('score').textContent = String(score);
  $('lives').textContent = '♥'.repeat(Math.max(lives, 0)) + '♡'.repeat(PLAYER_LIVES - Math.max(lives, 0));
  $('stats').innerHTML =
    `wave ${wave} · pressure ${pressure().toFixed(2)}<br>${WEAPONS[weapon].name} · squad ${shotsPerVolley()} · <span style="color:${tierCss(damage)}">dmg ${damage}</span><br>rate ${fireRate.toFixed(1)}/s · spd ${bulletSpeed.toFixed(0)}<br>bullets ${bullets.length}`;
}

function reset() {
  bullets = []; enemies = []; particles = []; shots = []; mates = [];
  fx.clear();
  rows.forEach(removeRow); rows = [];
  crates.forEach(removeCrate); crates = [];
  playerX = targetX = 0;
  lives = PLAYER_LIVES; score = 0; time = 0; wave = 0;
  perf = 1; killDepth = -30; hpBudget = 0;
  fireRate = 5; gunCount = 1; gateBonus = 0; damage = 1; bulletSpeed = 30;
  fireTimer = 0; enemyTimer = 2; rowTimer = 0.5; crateTimer = 6;
  setWeapon('blaster');
  updateHud();
}

startBtn.addEventListener('click', () => {
  reset();
  state = 'play';
  pauseBtn.textContent = 'II';
  $('paused').classList.remove('show');
  overlay.classList.add('hidden');
});

const pauseBtn = $('pause');
function setPaused(p: boolean) {
  if (p && state !== 'play') return;
  if (!p && state !== 'paused') return;
  state = p ? 'paused' : 'play';
  pauseBtn.textContent = p ? '▶' : 'II';
  $('paused').classList.toggle('show', p);
}
pauseBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  setPaused(state === 'play');
});
$('paused').addEventListener('pointerdown', () => setPaused(false));
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'Escape') setPaused(state === 'play');
});
// Auto-pause when the app is backgrounded (phone call, app switch, lock screen).
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

function gameOver() {
  state = 'over';
  if (reloadPending) { if (score > best()) localStorage.setItem('gate-runner-best', String(score)); location.reload(); return; }
  if (score > best()) localStorage.setItem('gate-runner-best', String(score));
  overlay.querySelector('h1')!.textContent = 'OVERRUN';
  overlay.querySelector('p')!.textContent = `Score ${score} · reached wave ${wave}`;
  startBtn.textContent = 'PLAY AGAIN';
  $('best').textContent = `Best ${best()}`;
  overlay.classList.remove('hidden');
}
$('best').textContent = best() ? `Best ${best()}` : '';

// Version + manual update check on the start screen.
$('version-text').textContent = `v${__APP_VERSION__.split('.').slice(0, 2).join('.')} · ${__COMMIT__}`;
$('refresh').addEventListener('click', async () => {
  const btn = $('refresh');
  btn.textContent = 'Checking…';
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update().catch(() => {});
  // If a new version was found it installs and activates on its own, then reloads the page
  // via onNeedReload. Either way, force a fresh reload shortly after so the button always does something.
  if (reg?.waiting) await updateSW(true);
  setTimeout(() => location.reload(), 1500);
});

const crateLook = (c: Crate) => c.kind === 'weapon'
  ? { label: WEAPONS[c.weapon!].name, color: '#' + new THREE.Color(WEAPONS[c.weapon!].color).getHexString() }
  : UPGRADES[c.kind];

function setWeapon(k: WeaponKind) {
  weapon = k;
  hero.setWeapon(k);
}

function damageEnemy(e: Enemy, dmg: number) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  e.flash = 0.08;
  if (e.hp <= 0) {
    score += e.points;
    burst(e);
    killDepth += (e.z - killDepth) * 0.05;
  }
}

function collect(c: Crate) {
  const kind = c.kind;
  const look = crateLook(c);
  fx.text(playerX, 2.6, 0.5, look.label, look.color, 1.1);
  fx.portal(playerX, 0, new THREE.Color(look.color).getHex(), 0.9);
  if (kind === 'weapon') setWeapon(c.weapon!);
  if (kind === 'rate') fireRate = Math.min(fireRate + 0.75, 12);
  if (kind === 'gun') {
    gunCount = Math.min(gunCount + 1, 4);
    gateBonus = Math.min(gateBonus, MAX_SHOTS - gunCount); // never exceed the squad cap invisibly
    syncSquad();
  }
  if (kind === 'dmg') {
    damage += 1;
    const tc = tierCss(damage);
    fx.text(playerX, 3.3, 0.5, `DMG ${damage}`, tc, 1.1);
    flashScreen(`${tc}66`);
  }
  if (kind === 'speed') bulletSpeed = Math.min(bulletSpeed + 4, 50);
  if (kind === 'heal') lives = Math.min(PLAYER_LIVES, lives + 1);
  navigator.vibrate?.(40);
}

// ---------- Main loop ----------
function update(dt: number) {
  time += dt;

  playerX += (targetX - playerX) * Math.min(1, dt * 14);
  player.position.x = playerX;
  // Allies hold formation around you, trailing slightly when you move.
  const slots = squadSlots(mates.length + 1);
  mates.forEach((m, i) => {
    const s = slots[i + 1];
    const tx = THREE.MathUtils.clamp(playerX + s.x, -ROAD_HALF + 0.25, ROAD_HALF - 0.25);
    m.x += (tx - m.x) * Math.min(1, dt * (10 - Math.min(6, s.z * 4)));
    m.z += (s.z - m.z) * Math.min(1, dt * 6);
    m.recoil = Math.max(0, m.recoil - dt * 10);
    m.spawn = Math.min(1, m.spawn + dt * 2.5);
  });
  hero.update(dt, time, {
    tilt: (playerX - targetX) * 0.3,
    strafe: Math.min(1, Math.abs(targetX - playerX) * 3),
    camera,
  });

  // Spawners: difficulty ramps with time.
  if (time >= wave * WAVE_SECONDS) startWave(wave + 1);
  // Accrue enemy HP to send; a living boss halves the flow so the fight stays focused.
  const bossAlive = enemies.some((e) => e.kind === 'boss');
  const flow = playerDps() * pressure() * (bossAlive ? 0.5 : 1);
  // Cap the backlog at ~3s of flow: if spawns are blocked (enemy cap), don't bank a surge.
  hpBudget = Math.min(hpBudget + flow * dt, flow * 3);
  enemyTimer -= dt;
  if (enemyTimer <= 0) {
    // Spend the budget as a pack bunched in one area, so you have to pick a lane.
    const cx = rand(-ROAD_HALF + 1, ROAD_HALF - 1);
    let i = 0;
    while (hpBudget > 0 && i < 40) {
      hpBudget -= spawnEnemy(randomKind(), cx + rand(-1.6, 1.6), SPAWN_Z - Math.floor(i / 4) * 1.2 + rand(-0.3, 0.3));
      i++;
    }
    enemyTimer = rand(1.8, 2.6);
  }
  rowTimer -= dt;
  if (rowTimer <= 0) { spawnRow(); rowTimer = rand(6, 8); }
  crateTimer -= dt;
  if (crateTimer <= 0) { spawnCrate(); crateTimer = rand(13, 17); }

  // Fire.
  fireTimer -= dt;
  if (fireTimer <= 0) {
    const w = WEAPONS[weapon];
    fireTimer = 1 / (fireRate * w.rate);
    hero.fire();
    const shooters = [{ x: playerX, z: 0 }, ...mates];
    mates.forEach((m) => (m.recoil = 1));
    for (const s of shooters) {
      const jitter = w.jitter ? (Math.random() - 0.5) * 2 * w.jitter : 0;
      if (bullets.length < MAX_BULLETS) bullets.push({ x: s.x + jitter, z: s.z - 1, vx: 0, alive: true, w: weapon });
    }
  }

  // Move gates & crates.
  for (const r of rows) {
    r.z += WORLD_SPEED * dt;
    r.vis.setZ(r.z);
    if (!r.passed && r.z >= 0) passGate(r);
  }
  rows = rows.filter((r) => (r.z > 3 ? (removeRow(r), false) : true));

  for (const c of crates) {
    c.z += WORLD_SPEED * dt * (c.open ? 1.4 : 1);
    c.mesh.position.z = c.sprite.position.z = c.z;
    if (c.open) c.mesh.rotation.y += dt * 3;
  }

  // Move bullets, pass gates, hit things.
  for (const b of bullets) {
    const prevZ = b.z;
    const w = WEAPONS[b.w];
    const dmg = damage * w.dmg;
    b.z -= bulletSpeed * w.speed * dt;
    b.x += b.vx * dt;
    if (b.z < SPAWN_Z - 5 || Math.abs(b.x) > ROAD_HALF) { b.alive = false; continue; }

    for (const c of crates) {
      // Bullets punch through crates, damaging each crate once on the way.
      if (!c.open && b.crate !== c && Math.abs(b.x - c.x) < 1 && c.z > b.z - 0.9 && c.z < prevZ + 0.9) {
        b.crate = c;
        c.hp -= dmg;
        if (c.hp <= 0) {
          c.open = true;
          const u = crateLook(c);
          (c.mesh.material as THREE.MeshStandardMaterial).color.set(u.color);
          c.draw(u.label, u.color);
          fx.sparks(c.x, 1, c.z, 0xffe080, 16, 5);
        } else {
          // Weapon damage can be fractional (gatling 0.42); only redraw when the shown number changes.
          const shown = Math.ceil(c.hp);
          if (shown !== c.shown) { c.shown = shown; c.draw(String(shown), '#000a'); }
        }
        break;
      }
    }

    for (const e of enemies) {
      if (e.hp > 0 && !b.pierced?.has(e) && Math.abs(b.x - e.x) < 0.55 * e.size + 0.1 && e.z > b.z - 0.6 * e.size && e.z < prevZ + 0.6 * e.size) {
        damageEnemy(e, dmg);
        if (w.pierce) {
          // Railgun slugs keep going, hitting each enemy in the line once.
          (b.pierced ??= new Set()).add(e);
          fx.sparks(e.x, 0.9, e.z, 0xc070ff, 4, 4);
          continue;
        }
        b.alive = false;
        if (w.splash) {
          // Rockets blow up: full damage to the target, 70% to everything nearby.
          fx.explosion(e.x, e.z, w.splash);
          for (const o of enemies) {
            if (o !== e && o.hp > 0 && Math.hypot(o.x - e.x, o.z - e.z) < w.splash + 0.4 * o.size) damageEnemy(o, dmg * 0.7);
          }
        }
        break;
      }
    }
  }
  bullets = bullets.filter((b) => b.alive);
  for (const e of enemies) e.spawn = Math.min(1, e.spawn + dt * 2.2);

  // Enemies march toward the player.
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    e.z += e.speed * dt;
    // Weave: every 0.8-2.5s pick a new spot across the road and drift toward it.
    // Small/fast types dart around a lot; big ones lumber and barely change lanes.
    if (e.kind !== 'boss') {
      const agility = 1.6 / e.size;
      if ((e.retarget -= dt) <= 0) {
        const edge = ROAD_HALF - 0.4 * e.size;
        e.tx = THREE.MathUtils.clamp(e.x + rand(-3, 3) * agility, -edge, edge);
        e.retarget = rand(0.8, 2.5);
      }
      // Steer rather than slide: ease into a sideways speed proportional to the distance left,
      // so they accelerate out of a lane, drift across, and slow as they settle.
      const desired = THREE.MathUtils.clamp((e.tx - e.x) * 1.5, -2.2 * agility, 2.2 * agility);
      e.vx += (desired - e.vx) * Math.min(1, dt * 3);
      e.x += e.vx * dt;
    }
    // Shoot only once on screen and not point-blank.
    if (e.z > -50 && e.z < -10 && (e.fireCd -= dt) <= 0) {
      enemyFire(e);
      e.fireCd = (SHOOTERS[e.kind]?.cd ?? 99) * rand(0.8, 1.2);
    }
    if (e.z > -0.3) {
      e.hp = 0;
      lives -= e.dmg;
      perf = Math.max(PERF_MIN, perf - 0.12 * e.dmg); // bigger hits ease off more
      hurtFlash = 0.3;
      navigator.vibrate?.(120);
    }
  }
  enemies = enemies.filter((e) => e.hp > 0);

  shots = shots.filter((sh) => {
    sh.x += sh.vx * dt;
    sh.z += sh.vz * dt;
    // An ally in the way takes the hit instead (and is lost).
    const hitMate = mates.findIndex((m) => m.spawn >= 1 && Math.abs(sh.x - m.x) < 0.35 && Math.abs(sh.z - m.z) < 0.4);
    if (hitMate >= 0) {
      const m = mates[hitMate];
      fx.sparks(m.x, 0.9, m.z, 0xff4060, 16, 4);
      fx.text(m.x, 2, m.z, '−1', '#ff6b81', 0.8);
      mates.splice(hitMate, 1);
      if (gateBonus > 1 - gunCount) gateBonus -= 1; else gunCount = Math.max(1, gunCount - 1);
      syncSquad(); // keep the on-screen squad and the count in lockstep
      return false;
    }
    if (Math.abs(sh.x - playerX) < 0.45 && Math.abs(sh.z) < 0.5) {
      lives -= 1;
      perf = Math.max(PERF_MIN, perf - 0.12);
      hurtFlash = 0.3;
      navigator.vibrate?.(120);
      return false;
    }
    return sh.z < 3 && Math.abs(sh.x) < ROAD_HALF + 1;
  });

  // Killing far away = cruising, so perf creeps up; close calls ease it back down.
  if (killDepth < -40) perf += dt * 0.01;
  else if (killDepth > -22) perf -= dt * 0.03;
  perf = THREE.MathUtils.clamp(perf, PERF_MIN, PERF_MAX);

  // Crates: catch opened ones, lose them if they slip by.
  crates = crates.filter((c) => {
    if (c.open && c.z > -0.8 && c.z < 0.8 && Math.abs(c.x - playerX) < 1.3) {
      collect(c);
      removeCrate(c);
      return false;
    }
    if (c.z > 3) { removeCrate(c); return false; }
    return true;
  });

  if (lives <= 0) gameOver();
}

function render(dt: number) {
  const power = tierOf(damage); // DMG+ tier: new shot colour, bigger shots, glowing guns
  hero.setPower(power);
  drawProjectiles(bullets, time, power);
  drawSquad(mates, weapon, time, Math.min(1, Math.abs(targetX - playerX) * 3), power);
  for (const r of rows) r.vis.update(dt, time);
  fx.update(state === 'play' ? dt : 0);

  const counts: Record<string, number> = {};
  for (const k in enemyMeshes) counts[k] = 0;
  for (const e of enemies) {
    const m = enemyMeshes[e.kind];
    const i = counts[e.kind]++;
    const phase = time * 12 * e.speed / 6 + e.wobble;
    e.flash = Math.max(0, e.flash - dt);
    tmpColor.copy(e.color).lerp(WHITE, e.flash > 0 ? 0.8 : 0);

    tmp.position.set(e.x, Math.abs(Math.sin(phase)) * 0.08 * e.size, e.z);
    // Turn to face where they're heading and bank into the turn.
    const yaw = Math.atan2(e.vx, e.speed);
    tmp.rotation.set(0.2, yaw, Math.sin(phase) * 0.08 - e.vx * 0.06, 'YXZ');
    // Materialise: scale up from nothing with a little overshoot.
    const k = e.spawn, back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    tmp.scale.setScalar(e.size * Math.max(0.01, back));
    tmp.updateMatrix();
    m.body.setMatrixAt(i, tmp.matrix);
    m.accent.setMatrixAt(i, tmp.matrix);
    m.body.setColorAt(i, tmpColor);

    // Legs swing in opposite phase from the hips.
    const rig = enemyRigs[e.kind];
    const limbColor = limbScratch.copy(tmpColor);
    for (const [leg, arm, side] of [[m.legL, m.armL, -1], [m.legR, m.armR, 1]] as const) {
      const swing = Math.sin(phase + (side > 0 ? Math.PI : 0));
      legTmp.position.set(side * rig.hipX, HIP_Y, 0);
      legTmp.rotation.set(swing * 0.7, 0, 0);
      legTmp.updateMatrix();
      legTmp.matrix.premultiply(tmp.matrix);
      leg.setMatrixAt(i, legTmp.matrix);
      leg.setColorAt(i, tmpColor.copy(limbColor).multiplyScalar(0.8));
      // Arms reach forward and pump opposite to the leg on the same side.
      legTmp.position.set(side * rig.shoulder[0], rig.shoulder[1], rig.shoulder[2]);
      legTmp.rotation.set(-0.7 - swing * 0.5, 0, side * 0.15);
      legTmp.updateMatrix();
      legTmp.matrix.premultiply(tmp.matrix);
      arm.setMatrixAt(i, legTmp.matrix);
      arm.setColorAt(i, limbColor);
    }
  }
  for (const k in enemyMeshes) {
    for (const mesh of Object.values(enemyMeshes[k])) {
      mesh.count = counts[k];
      mesh.visible = counts[k] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // Particles: simple gravity and shrink.
  particles = particles.filter((p) => (p.life -= dt) > 0);
  particles.forEach((p, i) => {
    p.v.y -= 20 * dt;
    p.p.addScaledVector(p.v, dt);
    if (p.p.y < 0.07) { p.p.y = 0.07; p.v.multiplyScalar(0.5); p.v.y *= -0.5; }
    tmp.position.copy(p.p);
    tmp.rotation.set(p.life * 10, p.life * 7, 0);
    tmp.scale.setScalar(Math.min(1, p.life * 2.5));
    tmp.updateMatrix();
    particleMesh.setMatrixAt(i, tmp.matrix);
    particleMesh.setColorAt(i, p.color);
  });
  shots.forEach((sh, i) => {
    const pulse = 1 + Math.sin(time * 25 + i) * 0.15;
    tmp.position.set(sh.x, 0.9, sh.z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(pulse);
    tmp.updateMatrix();
    shotCore.setMatrixAt(i, tmp.matrix);
    shotHalo.setMatrixAt(i, tmp.matrix);
    // Point the trail back along the velocity; it stretches ~1.6 units behind the orb.
    tmp.rotation.set(0, Math.atan2(sh.vx, sh.vz), 0);
    tmp.scale.set(1, 1, 1.6);
    tmp.updateMatrix();
    shotTrail.setMatrixAt(i, tmp.matrix);
    tmp.position.set(sh.x, 0.03, sh.z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(pulse);
    tmp.updateMatrix();
    shotMarker.setMatrixAt(i, tmp.matrix);
  });
  for (const m of [shotCore, shotHalo, shotTrail, shotMarker]) {
    m.count = shots.length;
    m.instanceMatrix.needsUpdate = true;
  }
  particleMesh.count = particles.length;
  particleMesh.instanceMatrix.needsUpdate = true;
  if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const frac = Math.max(0, e.hp / e.maxHp);
    const y = (e.kind === 'boss' ? 2.1 : 1.8) * e.size + 0.15;
    tmp.quaternion.copy(camera.quaternion);
    tmp.rotation.setFromQuaternion(tmp.quaternion);
    tmp.position.set(e.x, y, e.z);
    const w = BAR_W * Math.max(1, e.size * 0.8);
    tmp.scale.set(w + 0.06, BAR_H + 0.06, 1);
    tmp.updateMatrix();
    barBack.setMatrixAt(i, tmp.matrix);
    // Left-align the fill so it shrinks toward the left as HP drops.
    tmp.position.x = e.x - (w * (1 - frac)) / 2;
    tmp.scale.set(w * frac, BAR_H, 1);
    tmp.updateMatrix();
    barFill.setMatrixAt(i, tmp.matrix);
    barFill.setColorAt(i, tmpColor.setHSL(frac * 0.33, 0.9, 0.5)); // red -> green
  }
  tmp.rotation.set(0, 0, 0);
  for (const m of [barBack, barFill]) {
    m.count = enemies.length;
    m.instanceMatrix.needsUpdate = true;
  }
  if (barFill.instanceColor) barFill.instanceColor.needsUpdate = true;

  hurtFlash = Math.max(0, hurtFlash - dt);
  skyUniforms.hurt.value = Math.min(1, hurtFlash * 2.5);

  // Fixed strength: scaling it by bullet count made it pump brighter whenever bullets hit things.
  // Player bullets sit just under the threshold, so hundreds of them can't white out the screen.
  updateAmbient(dt, performance.now() / 1000); // runs on the menu too, not just in play
  composer.render();
}

let last = performance.now(), hudTimer = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 1 / 20); // clamp so tab switches don't teleport things
  last = now;
  if (state === 'play') {
    update(dt);
    hudTimer -= dt;
    if (hudTimer <= 0) { updateHud(); hudTimer = 0.1; }
  }
  render(dt);
});
