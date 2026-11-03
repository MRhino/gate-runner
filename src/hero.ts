import * as THREE from 'three';
import { merge, egg, HIP_Y, type Part, type V3 } from './models';

// The player: an armoured trooper with a glowing visor and chest core, layered pauldrons,
// a twin-thruster jetpack with live flames, and a modular energy cannon whose barrels are
// added side by side as you gain shots. Faces -z, feet at y = 0.
// Only one of these exists, so it can afford far more detail than the enemies.

const YELLOW = 0xffc83d, YELLOW_LT = 0xffe07a, CHARCOAL = 0x2a2c3a, STEEL = 0x8c95a8, RUBBER = 0x15151c, GOLD = 0xffb21e;
const CYAN = 0x4de8ff;

const sph = (r: number, w = 32, h = 20) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, s = 24) => new THREE.CylinderGeometry(rt, rb, h, s);
const tor = (r: number, t: number, s = 32) => new THREE.TorusGeometry(r, t, 8, s);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

// A cylinder spanning two points (for arm segments).
function between(a: V3, b: V3, r: number, color: number): Part {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const dir = vb.clone().sub(va);
  const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(qn);
  return { geo: cyl(r, r * 0.9, dir.length(), 16), color, pos: [mid.x, mid.y, mid.z], rot: [e.x, e.y, e.z] };
}

const glowMat = (color: number, k: number, additive = false, opacity = 1) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color).multiplyScalar(k), transparent: additive || opacity < 1, opacity,
  blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive,
});

// Soft star texture for muzzle flashes.
function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(160,240,255,0.9)');
  grad.addColorStop(1, 'rgba(0,160,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(200,250,255,0.9)';
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(32, 32); g.rotate((i * Math.PI) / 4); g.fillRect(-32, -2, 64, 4); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createHero(toon: THREE.Material) {
  const root = new THREE.Group();
  const torso = new THREE.Group(); // everything above the hips; tilts when strafing, bobs when idle
  root.add(torso);

  const shoulderY = 1.02;
  const hand: V3 = [0.17, 0.9, -0.4];
  const elbow: V3 = [0.4, 0.8, -0.16];

  const torsoGeo = merge([
    // Core body and armour
    { geo: egg(0.31, 0.62, -0.12, 32), color: CHARCOAL, pos: [0, 0.8, 0] },
    { geo: sph(0.3), color: YELLOW, pos: [0, 0.9, -0.06], scale: [1.05, 0.85, 0.75] }, // chest plate
    { geo: sph(0.22), color: YELLOW_LT, pos: [0, 0.95, -0.15], scale: [1.1, 0.55, 0.5] }, // chest highlight plate
    { geo: tor(0.085, 0.022), color: CHARCOAL, pos: [0, 0.9, -0.29] }, // core socket
    ...[0.6, 0.67].map((y): Part => ({ geo: tor(0.275, 0.03), color: STEEL, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] })), // ab bands
    // Belt with buckle and pouches
    { geo: cyl(0.33, 0.33, 0.09, 32), color: RUBBER, pos: [0, 0.52, 0] },
    { geo: box(0.13, 0.09, 0.04), color: GOLD, pos: [0, 0.52, -0.33] },
    ...[-1, 1].map((s): Part => ({ geo: box(0.12, 0.13, 0.1), color: CHARCOAL, pos: [s * 0.28, 0.48, -0.14], rot: [0, s * 0.5, 0] })),
    ...[-1, 1].map((s): Part => ({ geo: box(0.1, 0.12, 0.09), color: CHARCOAL, pos: [s * 0.24, 0.48, 0.2], rot: [0, -s * 0.6, 0] })),
    // Layered pauldrons
    ...[-1, 1].flatMap((s): Part[] => [
      { geo: sph(0.21), color: YELLOW, pos: [s * 0.38, shoulderY, 0], scale: [1.15, 0.72, 1.15] },
      { geo: sph(0.17), color: CHARCOAL, pos: [s * 0.43, shoulderY - 0.08, 0], scale: [1.05, 0.6, 1.05] },
      { geo: tor(0.2, 0.018), color: STEEL, pos: [s * 0.38, shoulderY - 0.02, 0], rot: [Math.PI / 2, 0, 0], scale: [1.15, 1.15, 1] },
      { geo: box(0.05, 0.03, 0.2), color: CHARCOAL, pos: [s * 0.4, shoulderY + 0.14, 0] },
    ]),
    // Arms reaching forward to the cannon grip
    ...[-1, 1].flatMap((s): Part[] => {
      const sh: V3 = [s * 0.38, shoulderY - 0.05, 0];
      const el: V3 = [s * elbow[0], elbow[1], elbow[2]];
      const hd: V3 = [s * hand[0], hand[1], hand[2]];
      return [
        between(sh, el, 0.085, CHARCOAL),
        { geo: sph(0.1, 20, 12), color: STEEL, pos: el }, // elbow joint
        between(el, hd, 0.095, YELLOW), // gauntlet
        { geo: tor(0.1, 0.02, 20), color: CHARCOAL, pos: [(el[0] + hd[0]) / 2, (el[1] + hd[1]) / 2, (el[2] + hd[2]) / 2], rot: [Math.PI / 2 - 0.5, 0, 0] },
        { geo: sph(0.085, 20, 12), color: RUBBER, pos: hd, scale: [1, 0.9, 1.2] }, // glove
      ];
    }),
    // Neck and helmet
    { geo: cyl(0.12, 0.14, 0.12), color: RUBBER, pos: [0, 1.13, 0] },
    { geo: sph(0.29, 40, 28), color: YELLOW, pos: [0, 1.34, 0] },
    { geo: box(0.07, 0.1, 0.42), color: CHARCOAL, pos: [0, 1.6, 0.03] }, // crest
    { geo: box(0.3, 0.08, 0.14), color: CHARCOAL, pos: [0, 1.17, -0.2] }, // chin guard
    ...[-1, 1].flatMap((s): Part[] => [
      { geo: cyl(0.1, 0.1, 0.09), color: CHARCOAL, pos: [s * 0.29, 1.33, 0.02], rot: [0, 0, Math.PI / 2] }, // ear pods
      { geo: cyl(0.055, 0.055, 0.1), color: STEEL, pos: [s * 0.33, 1.33, 0.02], rot: [0, 0, Math.PI / 2] },
    ]),
    { geo: cyl(0.012, 0.012, 0.32, 8), color: STEEL, pos: [0.31, 1.55, 0.06] }, // antenna
    { geo: sph(0.25, 40, 24), color: 0x0d1b2a, pos: [0, 1.36, -0.08], scale: [1.1, 0.55, 0.92] }, // visor glass
    // Jetpack
    { geo: box(0.48, 0.52, 0.22), color: CHARCOAL, pos: [0, 0.88, 0.3] },
    { geo: box(0.38, 0.1, 0.04), color: YELLOW, pos: [0, 1.02, 0.42] },
    ...[-1, 1].flatMap((s): Part[] => [
      { geo: cyl(0.1, 0.11, 0.48), color: STEEL, pos: [s * 0.15, 0.78, 0.45] },
      { geo: tor(0.105, 0.015, 24), color: CHARCOAL, pos: [s * 0.15, 0.88, 0.45], rot: [Math.PI / 2, 0, 0] },
      { geo: tor(0.105, 0.015, 24), color: CHARCOAL, pos: [s * 0.15, 0.7, 0.45], rot: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.07, 0.11, 0.1), color: RUBBER, pos: [s * 0.15, 0.5, 0.45] }, // nozzle
      { geo: sph(0.1, 20, 12), color: STEEL, pos: [s * 0.15, 1.02, 0.45], scale: [1, 0.5, 1] },
    ]),
  ]);
  const torsoMesh = new THREE.Mesh(torsoGeo, toon);
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);

  // Emissive details (bright enough to bloom).
  const visorStrip = new THREE.Mesh(box(0.38, 0.04, 0.02), glowMat(CYAN, 2.2));
  visorStrip.position.set(0, 1.37, -0.31);
  const core = new THREE.Mesh(sph(0.06, 20, 12), glowMat(CYAN, 2.6));
  core.position.set(0, 0.9, -0.3);
  const antennaTip = new THREE.Mesh(sph(0.03, 12, 8), glowMat(0xff4040, 2.4));
  antennaTip.position.set(0.31, 1.72, 0.06);
  const packLights = [-1, 1].map((s) => {
    const m = new THREE.Mesh(sph(0.025, 10, 6), glowMat(0x7dff7a, 2.4));
    m.position.set(s * 0.08, 0.72, 0.42);
    return m;
  });
  torso.add(visorStrip, core, antennaTip, ...packLights);

  // Thruster flames: nested additive cones pointing down out of the nozzles.
  const flameGeo = new THREE.ConeGeometry(0.08, 1, 16, 1, true).rotateX(Math.PI).translate(0, -0.5, 0);
  const flames = [-1, 1].flatMap((s) => [
    { m: new THREE.Mesh(flameGeo, glowMat(0x2a8cff, 1.4, true, 0.6)), w: 1.3, h: 0.35, s },
    { m: new THREE.Mesh(flameGeo, glowMat(0xc8f4ff, 2.2, true, 0.9)), w: 0.6, h: 0.22, s },
  ]);
  flames.forEach((f) => { f.m.position.set(f.s * 0.15, 0.45, 0.45); torso.add(f.m); });

  // Legs: thigh, armoured knee, shin guard and heavy boot. Pivot at the hip.
  const legGeo = merge([
    { geo: cyl(0.11, 0.1, 0.2, 20), color: CHARCOAL, pos: [0, -0.1, 0] },
    { geo: sph(0.085, 20, 12), color: YELLOW, pos: [0, -0.2, -0.06], scale: [1, 0.9, 0.8] }, // knee pad
    { geo: cyl(0.095, 0.085, 0.2, 20), color: YELLOW, pos: [0, -0.3, 0] }, // shin guard
    { geo: box(0.2, 0.1, 0.3), color: CHARCOAL, pos: [0, -HIP_Y + 0.06, -0.05] }, // boot
    { geo: box(0.21, 0.03, 0.32), color: RUBBER, pos: [0, -HIP_Y + 0.015, -0.05] }, // sole
    { geo: sph(0.1, 20, 10), color: STEEL, pos: [0, -HIP_Y + 0.07, -0.18], scale: [1, 0.55, 0.7] }, // toe cap
  ]);
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(legGeo, toon);
    l.position.set(s * 0.15, HIP_Y, 0);
    l.castShadow = true;
    root.add(l);
    return l;
  });

  // ---------- Energy cannon ----------
  const gun = new THREE.Group();
  gun.position.set(0, 0.9, 0);
  torso.add(gun);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f55, metalness: 0.8, roughness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: YELLOW, metalness: 0.3, roughness: 0.5 });
  const barrelGeo = merge([
    { geo: cyl(0.045, 0.055, 0.62, 20), color: 0xffffff, pos: [0, 0, -0.31], rot: [Math.PI / 2, 0, 0] },
    ...[0.12, 0.3, 0.48].map((z): Part => ({ geo: tor(0.058, 0.014, 20), color: 0x9aa4b8, pos: [0, 0, -z] })),
    { geo: cyl(0.07, 0.06, 0.08, 20), color: 0x9aa4b8, pos: [0, 0, -0.66], rot: [Math.PI / 2, 0, 0] }, // muzzle
  ]);
  const barrelMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x4a5070, metalness: 0.8, roughness: 0.3 });
  const coilGeo = cyl(0.064, 0.064, 0.05, 20).rotateX(Math.PI / 2);
  const coilMat = glowMat(CYAN, 2.0);
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flashGeo = new THREE.PlaneGeometry(0.6, 0.6);
  let muzzles: THREE.Mesh[] = [];

  function setBarrels(offsets: number[]) {
    gun.clear();
    muzzles = [];
    const width = offsets[offsets.length - 1] - offsets[0];
    // Housing: a central body the hands grip, plus a rail spanning all barrels.
    const body = new THREE.Mesh(box(0.26, 0.16, 0.42), metal);
    body.position.set(0, -0.02, -0.25);
    const stripe = new THREE.Mesh(box(0.27, 0.04, 0.3), accent);
    stripe.position.set(0, 0.06, -0.28);
    gun.add(body, stripe);
    if (width > 0) {
      const rail = new THREE.Mesh(box(width + 0.16, 0.08, 0.2), metal);
      rail.position.set(0, 0, -0.38);
      const railTrim = new THREE.Mesh(box(width + 0.18, 0.02, 0.06), accent);
      railTrim.position.set(0, 0.05, -0.44);
      gun.add(rail, railTrim);
    }
    for (const x of offsets) {
      const b = new THREE.Mesh(barrelGeo, barrelMat);
      b.position.set(x, 0, -0.3);
      const coil = new THREE.Mesh(coilGeo, coilMat);
      coil.position.set(x, 0, -0.84); // glowing band around the barrel near the muzzle
      const flash = new THREE.Mesh(flashGeo, flashMat);
      flash.position.set(x, 0, -1.05);
      flash.visible = false;
      gun.add(b, coil, flash);
      muzzles.push(flash);
    }
  }

  let recoil = 0, flashT = 0;
  function fire() {
    recoil = 1;
    flashT = 0.05;
  }

  function update(dt: number, t: number, opts: { tilt: number; strafe: number; camera: THREE.Camera }) {
    // Idle breathing, strafe lean and stride.
    torso.position.y = Math.sin(t * 2.2) * 0.012;
    torso.rotation.z = opts.tilt;
    legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 18 + i * Math.PI) * 0.6 * opts.strafe));
    // Cannon kick.
    recoil = Math.max(0, recoil - dt * 12);
    gun.position.z = recoil * 0.06;
    // Muzzle flashes face the camera with a random spin and size.
    flashT -= dt;
    for (const f of muzzles) {
      f.visible = flashT > 0;
      if (f.visible) {
        f.quaternion.copy(opts.camera.quaternion);
        f.rotateZ(Math.random() * Math.PI);
        f.scale.setScalar(0.7 + Math.random() * 0.6);
      }
    }
    // Thruster flames flicker; glows pulse.
    flames.forEach((f, i) => {
      const k = 1 + Math.sin(t * 40 + i * 2) * 0.15 + Math.sin(t * 67 + i) * 0.1;
      f.m.scale.set(f.w, f.h * k * (1 + opts.strafe * 0.6), f.w);
    });
    const pulse = 0.85 + Math.sin(t * 4) * 0.15;
    (core.material as THREE.MeshBasicMaterial).color.setScalar(1).multiply(new THREE.Color(CYAN)).multiplyScalar(2.6 * pulse);
    antennaTip.visible = Math.sin(t * 5) > -0.3;
  }

  return { root, setBarrels, fire, update };
}

// Player bolts: a white-hot core, a cyan glow sleeve and a fading trail behind.
export function createBoltMeshes(scene: THREE.Scene, max: number) {
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  };
  const core = mk(new THREE.CapsuleGeometry(0.05, 0.4, 4, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8fdff).multiplyScalar(0.95) }));
  const sleeve = mk(new THREE.CapsuleGeometry(0.11, 0.5, 4, 12).rotateX(Math.PI / 2), glowMat(CYAN, 0.9, true, 0.28));
  const trail = mk(new THREE.ConeGeometry(0.09, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), glowMat(0x2ab8ff, 0.9, true, 0.22));
  const o = new THREE.Object3D();
  return (bullets: { x: number; z: number }[]) => {
    bullets.forEach((b, i) => {
      o.position.set(b.x, 0.9, b.z);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      core.setMatrixAt(i, o.matrix);
      sleeve.setMatrixAt(i, o.matrix);
      o.scale.set(1, 1, 1.4);
      o.updateMatrix();
      trail.setMatrixAt(i, o.matrix);
    });
    for (const m of [core, sleeve, trail]) {
      m.count = bullets.length;
      m.instanceMatrix.needsUpdate = true;
    }
  };
}
