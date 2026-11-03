import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

registerSW({ immediate: true });

// ---------- Tunables ----------
const ROAD_HALF = 4; // road spans x in [-4, 4]
const SPAWN_Z = -70;
const WORLD_SPEED = 5; // speed gates / crates move toward the player
const MAX_BULLETS = 800;
const MAX_ENEMIES = 400;
const PLAYER_LIVES = 5;

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1040);
scene.fog = new THREE.Fog(0x1a1040, 35, 75);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(0, 10, 9);
camera.lookAt(0, 0, -16);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x302040, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 15, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -40 });
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // Keep the whole road visible on narrow portrait screens.
  camera.fov = w / h < 0.6 ? 62 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Road (static: you hold your ground, everything comes to you) ----------
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_HALF * 2, 200),
  new THREE.MeshStandardMaterial({ color: 0x3a2f6b }),
);
road.rotation.x = -Math.PI / 2;
road.position.z = -80;
road.receiveShadow = true;
scene.add(road);

const stripeMat = new THREE.MeshBasicMaterial({ color: 0x5c4fa0 });
for (let i = 0; i < 20; i++) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 2), stripeMat);
  s.rotation.x = -Math.PI / 2;
  s.position.set(0, 0.01, -i * 5);
  scene.add(s);
}
for (const side of [-1, 1]) {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 200),
    new THREE.MeshStandardMaterial({ color: 0xff5d8f }),
  );
  rail.position.set(side * (ROAD_HALF + 0.15), 0.2, -80);
  scene.add(rail);
}

// ---------- Player ----------
const player = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.45, 0.6, 4, 12),
  new THREE.MeshStandardMaterial({ color: 0xffd23f }),
);
body.position.y = 0.75;
body.castShadow = true;
player.add(body);
const gunMat = new THREE.MeshStandardMaterial({ color: 0x333344 });
const guns: THREE.Mesh[] = [];
scene.add(player);

function rebuildGuns() {
  guns.forEach((g) => player.remove(g));
  guns.length = 0;
  for (const x of gunOffsets()) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.7), gunMat);
    g.position.set(x, 0.9, -0.45);
    player.add(g);
    guns.push(g);
  }
}

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
    ctx.font = `900 ${h * 0.5}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

// ---------- Game state ----------
type GateOp = { n: number }; // +n or -n bullets per volley
type GateRow = { z: number; passed: boolean; mid: number; ops: [GateOp, GateOp]; meshes: THREE.Mesh[] };
type Bullet = { x: number; z: number; vx: number; alive: boolean };
type EnemyKind = 'grunt' | 'runner' | 'blue' | 'purple' | 'orange' | 'red' | 'boss';
type Enemy = {
  x: number; z: number; hp: number; maxHp: number; speed: number; wobble: number;
  kind: EnemyKind; size: number; color: THREE.Color; dmg: number; points: number;
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
  boss: { hp: 600, speed: 0.4, size: 3, color: 0x3a0a0a, dmg: 3, points: 3000, wave: 5, weight: 0 },
};
type UpgradeKind = 'rate' | 'gun' | 'dmg' | 'speed';
type Crate = {
  x: number; z: number; hp: number; maxHp: number; open: boolean; kind: UpgradeKind;
  mesh: THREE.Mesh; sprite: THREE.Sprite; draw: (t: string, bg: string, fg?: string) => void;
};

const UPGRADES: Record<UpgradeKind, { label: string; color: string }> = {
  rate: { label: 'RATE+', color: '#29c46b' },
  gun: { label: 'GUN+', color: '#2f9bff' },
  dmg: { label: 'DMG+', color: '#ff8a29' },
  speed: { label: 'SPD+', color: '#c74bff' },
};

let state: 'menu' | 'play' | 'paused' | 'over' = 'menu';
let bullets: Bullet[] = [];
let enemies: Enemy[] = [];
let rows: GateRow[] = [];
let crates: Crate[] = [];
let playerX = 0, targetX = 0;
let lives = PLAYER_LIVES, score = 0, time = 0, wave = 0;
let fireRate = 5, gunCount = 1, gateBonus = 0, damage = 1, bulletSpeed = 30;
let fireTimer = 0, enemyTimer = 0, rowTimer = 2, crateTimer = 6;
let hurtFlash = 0;

// Bullets per volley = gun barrels + whatever the gates have added.
const shotsPerVolley = () => Math.max(1, gunCount + gateBonus);
const gunOffsets = () =>
  Array.from({ length: gunCount }, (_, i) => (i - (gunCount - 1) / 2) * 0.35);

// ---------- Instanced bullets & enemies ----------
const bulletMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.13, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
  MAX_BULLETS,
);
bulletMesh.frustumCulled = false;
scene.add(bulletMesh);

const enemyMesh = new THREE.InstancedMesh(
  new THREE.CapsuleGeometry(0.35, 0.5, 3, 8),
  new THREE.MeshStandardMaterial({ color: 0xffffff }),
  MAX_ENEMIES,
);
enemyMesh.castShadow = true;
enemyMesh.frustumCulled = false;
scene.add(enemyMesh);

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

// ---------- Spawning ----------
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function randomOp(good: boolean): GateOp {
  return { n: good ? pick([1, 2, 2, 3, 3, 5]) : -pick([1, 2, 3]) };
}
const opText = (o: GateOp) => (o.n > 0 ? '+' : '−') + Math.abs(o.n);
const isGood = (o: GateOp) => o.n > 0;

function spawnRow() {
  // Mostly one good + one bad side; sometimes both good with different values.
  const goodLeft = Math.random() < 0.5;
  const bothGood = Math.random() < 0.25;
  const ops: [GateOp, GateOp] = [
    randomOp(bothGood || goodLeft),
    randomOp(bothGood || !goodLeft),
  ];
  // The split between halves drifts so you have to aim, not just pick a side.
  const mid = rand(-1.5, 1.5);
  const meshes: THREE.Mesh[] = [];
  const spans: [number, number][] = [[-ROAD_HALF, mid], [mid, ROAD_HALF]];
  spans.forEach(([a, b], i) => {
    const { tex, draw } = makeLabel();
    draw(opText(ops[i]), isGood(ops[i]) ? '#1e88e5cc' : '#e53935cc');
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(b - a - 0.1, 2.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.position.set((a + b) / 2, 1.1, SPAWN_Z);
    scene.add(m);
    meshes.push(m);
  });
  rows.push({ z: SPAWN_Z, passed: false, mid, ops, meshes });
}

const WAVE_SECONDS = 20;

function spawnEnemy(kind: EnemyKind, cx?: number, z = SPAWN_Z + rand(-5, 0)) {
  if (enemies.length >= MAX_ENEMIES) return;
  const t = ENEMY_TYPES[kind];
  // Every tier also gets ~12% tougher per wave.
  const maxHp = Math.round(t.hp * Math.pow(1.12, wave - 1) * rand(0.9, 1.1));
  const edge = ROAD_HALF - 0.4 * t.size;
  enemies.push({
    x: kind === 'boss' ? 0 : THREE.MathUtils.clamp(cx ?? rand(-edge, edge), -edge, edge),
    z,
    hp: Math.max(1, maxHp), maxHp: Math.max(1, maxHp),
    speed: rand(6, 7.5) * (1 + (wave - 1) * 0.04) * t.speed,
    wobble: Math.random() * 10,
    kind, size: t.size, color: new THREE.Color(t.color), dmg: t.dmg, points: t.points,
  });
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
  const kind = pick<UpgradeKind>(['rate', 'gun', 'dmg', 'speed']);
  const maxHp = Math.round(30 + time * 1.5);
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
  const c: Crate = { x, z: SPAWN_Z, hp: maxHp, maxHp, open: false, kind, mesh, sprite, draw };
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
  for (const m of r.meshes) {
    scene.remove(m);
    m.geometry.dispose();
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

// ---------- Gate logic ----------
// Gates act on the player: walking through one changes bullets per volley.
function passGate(r: GateRow) {
  r.passed = true;
  const i = playerX < r.mid ? 0 : 1;
  gateBonus = Math.max(1 - gunCount, gateBonus + r.ops[i].n);
  const m = r.meshes[i].material as THREE.MeshBasicMaterial;
  m.opacity = 0.3;
  navigator.vibrate?.(r.ops[i].n > 0 ? 30 : 80);
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
    `wave ${wave} · shots ${shotsPerVolley()} · dmg ${damage}<br>rate ${fireRate.toFixed(1)}/s · spd ${bulletSpeed.toFixed(0)}<br>bullets ${bullets.length}`;
}

function reset() {
  bullets = []; enemies = [];
  rows.forEach(removeRow); rows = [];
  crates.forEach(removeCrate); crates = [];
  playerX = targetX = 0;
  lives = PLAYER_LIVES; score = 0; time = 0; wave = 0;
  fireRate = 5; gunCount = 1; gateBonus = 0; damage = 1; bulletSpeed = 30;
  fireTimer = 0; enemyTimer = 2; rowTimer = 0.5; crateTimer = 6;
  rebuildGuns();
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
  if (score > best()) localStorage.setItem('gate-runner-best', String(score));
  overlay.querySelector('h1')!.textContent = 'OVERRUN';
  overlay.querySelector('p')!.textContent = `Score ${score} · reached wave ${wave}`;
  startBtn.textContent = 'PLAY AGAIN';
  $('best').textContent = `Best ${best()}`;
  overlay.classList.remove('hidden');
}
$('best').textContent = best() ? `Best ${best()}` : '';

function collect(kind: UpgradeKind) {
  if (kind === 'rate') fireRate = Math.min(fireRate * 1.3, 20);
  if (kind === 'gun') { gunCount = Math.min(gunCount + 1, 6); rebuildGuns(); }
  if (kind === 'dmg') damage += 1;
  if (kind === 'speed') bulletSpeed = Math.min(bulletSpeed * 1.2, 70);
  navigator.vibrate?.(40);
}

// ---------- Main loop ----------
function update(dt: number) {
  time += dt;

  playerX += (targetX - playerX) * Math.min(1, dt * 14);
  player.position.x = playerX;
  body.rotation.z = (playerX - targetX) * 0.3;

  // Spawners: difficulty ramps with time.
  if (time >= wave * WAVE_SECONDS) startWave(wave + 1);
  enemyTimer -= dt;
  if (enemyTimer <= 0) {
    // Enemies arrive in packs that bunch up in one area, so you have to pick a lane.
    const pack = 2 + wave * 2 + Math.floor(Math.random() * 3);
    const cx = rand(-ROAD_HALF + 1, ROAD_HALF - 1);
    for (let i = 0; i < pack; i++) {
      spawnEnemy(randomKind(), cx + rand(-1.6, 1.6), SPAWN_Z - Math.floor(i / 4) * 1.2 + rand(-0.3, 0.3));
    }
    enemyTimer = Math.max(0.8, 2.2 * Math.pow(0.93, wave - 1));
  }
  rowTimer -= dt;
  if (rowTimer <= 0) { spawnRow(); rowTimer = rand(3.5, 5); }
  crateTimer -= dt;
  if (crateTimer <= 0) { spawnCrate(); crateTimer = rand(9, 13); }

  // Fire.
  fireTimer -= dt;
  if (fireTimer <= 0) {
    fireTimer = 1 / fireRate;
    const n = shotsPerVolley();
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5..0.5 across the fan
      const spread = Math.min(1.6, 0.2 * n);
      // Fan by angle, not fixed sideways speed, so faster bullets still cover the road.
      const angle = t * 2 * Math.min(0.2, 0.04 * n);
      if (bullets.length < MAX_BULLETS) {
        bullets.push({ x: playerX + t * spread, z: -1, vx: Math.tan(angle) * bulletSpeed, alive: true });
      }
    }
  }

  // Move gates & crates.
  for (const r of rows) {
    r.z += WORLD_SPEED * dt;
    r.meshes.forEach((m) => (m.position.z = r.z));
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
    b.z -= bulletSpeed * dt;
    b.x += b.vx * dt;
    if (b.z < SPAWN_Z - 5 || Math.abs(b.x) > ROAD_HALF) { b.alive = false; continue; }

    for (const c of crates) {
      if (!c.open && Math.abs(b.x - c.x) < 0.9 && Math.abs(b.z - c.z) < 0.9) {
        b.alive = false;
        c.hp -= damage;
        if (c.hp <= 0) {
          c.open = true;
          const u = UPGRADES[c.kind];
          (c.mesh.material as THREE.MeshStandardMaterial).color.set(u.color);
          c.draw(u.label, u.color);
        } else {
          c.draw(String(c.hp), '#000a');
        }
        break;
      }
    }
    if (!b.alive) continue;

    for (const e of enemies) {
      if (e.hp > 0 && Math.abs(b.x - e.x) < 0.45 && Math.abs(b.z - e.z) < 0.5) {
        b.alive = false;
        e.hp -= damage;
        if (e.hp <= 0) score += e.points;
        break;
      }
    }
  }
  bullets = bullets.filter((b) => b.alive);

  // Enemies march toward the player.
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    e.z += e.speed * dt;
    if (e.kind !== 'boss') e.x += Math.sin(time * 2 + e.wobble) * dt * 0.4;
    if (e.z > -0.3) {
      e.hp = 0;
      lives -= e.dmg;
      hurtFlash = 0.3;
      navigator.vibrate?.(120);
    }
  }
  enemies = enemies.filter((e) => e.hp > 0);

  // Crates: catch opened ones, lose them if they slip by.
  crates = crates.filter((c) => {
    if (c.open && c.z > -0.8 && c.z < 0.8 && Math.abs(c.x - playerX) < 1.3) {
      collect(c.kind);
      removeCrate(c);
      return false;
    }
    if (c.z > 3) { removeCrate(c); return false; }
    return true;
  });

  if (lives <= 0) gameOver();
}

function render(dt: number) {
  for (let i = 0; i < bullets.length; i++) {
    tmp.position.set(bullets[i].x, 0.9, bullets[i].z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(1);
    tmp.updateMatrix();
    bulletMesh.setMatrixAt(i, tmp.matrix);
  }
  bulletMesh.count = bullets.length;
  bulletMesh.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    tmp.position.set(e.x, 0.6 * e.size + Math.abs(Math.sin(time * 8 + e.wobble)) * 0.15, e.z);
    tmp.rotation.set(0.35, 0, Math.sin(time * 10 + e.wobble) * 0.15);
    tmp.scale.setScalar(e.size);
    tmp.updateMatrix();
    enemyMesh.setMatrixAt(i, tmp.matrix);
    enemyMesh.setColorAt(i, e.color);
  }
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const frac = Math.max(0, e.hp / e.maxHp);
    const y = 1.55 * e.size + 0.1;
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
  enemyMesh.count = enemies.length;
  enemyMesh.instanceMatrix.needsUpdate = true;
  if (enemyMesh.instanceColor) enemyMesh.instanceColor.needsUpdate = true;

  hurtFlash = Math.max(0, hurtFlash - dt);
  (scene.background as THREE.Color).setRGB(0.1 + hurtFlash * 1.5, 0.06, 0.25);

  renderer.render(scene, camera);
}

rebuildGuns();
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
