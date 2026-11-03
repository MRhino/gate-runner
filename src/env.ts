import * as THREE from 'three';

// Ambient world dressing: nothing here affects gameplay, it just makes the world feel alive.
// Flaming braziers along the road, distant mountains, a ringed moon, a bat flock, rising sky
// lanterns, shooting stars and a drifting airship. Returns an update(dt, time) for animation.

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const glow = (color: number, k: number, opacity = 1) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
});

export function createAmbient(scene: THREE.Scene, roadHalf: number) {
  const o = new THREE.Object3D();
  const updaters: ((dt: number, t: number) => void)[] = [];

  // ---------- Braziers with live flames ----------
  const braziers: THREE.Vector3[] = [];
  for (let z = 4; z > -80; z -= 10) for (const s of [-1, 1]) braziers.push(new THREE.Vector3(s * (roadHalf + 0.8), 0, z));
  const nB = braziers.length;
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.9, flatShading: true });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2633, metalness: 0.7, roughness: 0.4 });
  const pillar = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6), stoneMat, nB);
  const bowl = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.22, 0.32, 10), ironMat, nB);
  pillar.castShadow = true;
  braziers.forEach((p, i) => {
    o.position.set(p.x, 1.2, p.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix();
    pillar.setMatrixAt(i, o.matrix);
    o.position.y = 2.55; o.updateMatrix();
    bowl.setMatrixAt(i, o.matrix);
  });
  scene.add(pillar, bowl);
  // Flame = three nested additive cones (red outer, orange mid, yellow-white core) that flicker.
  const flameGeo = new THREE.ConeGeometry(0.3, 1, 10, 1, true).translate(0, 0.5, 0);
  const flameLayers = [
    { mat: glow(0xff3a0a, 1.2, 0.55), w: 1.1, h: 1.0 },
    { mat: glow(0xff8a1a, 1.5, 0.7), w: 0.75, h: 0.8 },
    { mat: glow(0xfff0a0, 2.2, 0.9), w: 0.4, h: 0.55 },
  ].map((l) => ({ ...l, mesh: new THREE.InstancedMesh(flameGeo, l.mat, nB) }));
  flameLayers.forEach((l) => { l.mesh.frustumCulled = false; scene.add(l.mesh); });
  const seeds = braziers.map(() => Math.random() * 100);
  // Embers drifting up out of each brazier.
  const EMBERS = nB * 4;
  const embers = Array.from({ length: EMBERS }, (_, i) => ({ b: i % nB, y: rand(0, 2), x: 0, z: 0, s: rand(0.6, 1.4) }));
  const emberMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 4, 3), glow(0xffa040, 2.5), EMBERS);
  emberMesh.frustumCulled = false;
  scene.add(emberMesh);
  updaters.push((dt, t) => {
    braziers.forEach((p, i) => {
      const s = seeds[i];
      flameLayers.forEach((l, k) => {
        const flick = 1 + Math.sin(t * 13 + s + k) * 0.12 + Math.sin(t * 29 + s * 2) * 0.08;
        o.position.set(p.x, 2.68, p.z);
        o.rotation.set(Math.sin(t * 3 + s) * 0.08, t * (2 + k), Math.cos(t * 2.5 + s) * 0.08);
        o.scale.set(l.w * (2 - flick) , l.h * flick, l.w * (2 - flick));
        o.updateMatrix();
        l.mesh.setMatrixAt(i, o.matrix);
      });
    });
    flameLayers.forEach((l) => (l.mesh.instanceMatrix.needsUpdate = true));
    embers.forEach((e, i) => {
      e.y += dt * 1.2 * e.s;
      if (e.y > 2.2) { e.y = 0; e.x = rand(-0.2, 0.2); e.z = rand(-0.2, 0.2); }
      const p = braziers[e.b];
      o.position.set(p.x + e.x + Math.sin(t * 2 + i) * 0.15 * e.y, 2.8 + e.y, p.z + e.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(Math.max(0, 1 - e.y / 2.2));
      o.updateMatrix();
      emberMesh.setMatrixAt(i, o.matrix);
    });
    emberMesh.instanceMatrix.needsUpdate = true;
  });
  // One real light near the player so flames visibly light the road close up.
  const fireLight = new THREE.PointLight(0xff8a3a, 6, 12, 1.6);
  fireLight.position.set(0, 3, 0);
  scene.add(fireLight);
  updaters.push((_, t) => (fireLight.intensity = 6 + Math.sin(t * 17) * 0.8 + Math.sin(t * 31) * 0.5));

  // ---------- Distant mountains (a ring of faceted peaks behind the fog line) ----------
  const peakGeo = new THREE.ConeGeometry(1, 1, 5);
  const peaks = new THREE.InstancedMesh(peakGeo, new THREE.MeshStandardMaterial({ color: 0x2a1840, flatShading: true, roughness: 1 }), 70);
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 1.6 - Math.PI * 1.3; // arc across the back and sides
    const r = rand(85, 115);
    o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r - 30);
    const h = rand(14, 40);
    o.scale.set(rand(10, 22), h, rand(10, 22));
    o.position.y = h / 2 - 2;
    o.rotation.set(0, rand(0, 6), 0);
    o.updateMatrix();
    peaks.setMatrixAt(i, o.matrix);
  }
  scene.add(peaks);

  // ---------- Ringed moon, slowly turning ----------
  const moon = new THREE.Group();
  moon.add(new THREE.Mesh(new THREE.SphereGeometry(9, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffe2c4, fog: false })));
  const ring = new THREE.Mesh(new THREE.RingGeometry(12, 17, 48), glow(0xffb0e0, 0.6, 0.45));
  (ring.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  ring.rotation.x = 1.2;
  moon.add(ring);
  moon.add(new THREE.Mesh(new THREE.SphereGeometry(13, 24, 12), glow(0xff9ad0, 0.5, 0.25)));
  moon.position.set(-38, 48, -120);
  scene.add(moon);
  updaters.push((dt) => (ring.rotation.z += dt * 0.05));

  // ---------- Stars ----------
  const starPos = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y) * 0.9 + 0.1;
    v.normalize().multiplyScalar(140);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, fog: false, transparent: true, opacity: 0.8 }));
  scene.add(stars);
  updaters.push((_, t) => ((stars.material as THREE.PointsMaterial).opacity = 0.65 + Math.sin(t * 1.5) * 0.15));

  // ---------- Bat flock circling over the side fields ----------
  const BATS = 24;
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.2, 0, 0, -0.2, 1, 0, 0]), 3));
  wing.computeVertexNormals();
  const batMat = new THREE.MeshBasicMaterial({ color: 0x120a1c, side: THREE.DoubleSide });
  const batL = new THREE.InstancedMesh(wing, batMat, BATS);
  const batR = new THREE.InstancedMesh(wing, batMat, BATS);
  scene.add(batL, batR);
  const bats = Array.from({ length: BATS }, (_, i) => ({
    cx: (i % 2 ? 1 : -1) * rand(14, 24), cz: rand(-60, -25), r: rand(4, 9), y: rand(9, 16),
    sp: rand(0.4, 0.8) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, 6), flap: rand(10, 14),
  }));
  const wingTmp = new THREE.Object3D();
  updaters.push((_, t) => {
    bats.forEach((b, i) => {
      const a = b.ph + t * b.sp;
      o.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 1.3 + b.ph) * 1.2, b.cz + Math.sin(a) * b.r);
      o.rotation.set(0, -a + (b.sp > 0 ? 0 : Math.PI), 0);
      o.scale.setScalar(1.2);
      o.updateMatrix();
      const f = Math.sin(t * b.flap + b.ph) * 0.8;
      for (const [mesh, side] of [[batL, -1], [batR, 1]] as const) {
        wingTmp.rotation.set(0, side < 0 ? Math.PI : 0, side * f);
        wingTmp.updateMatrix();
        wingTmp.matrix.premultiply(o.matrix);
        mesh.setMatrixAt(i, wingTmp.matrix);
      }
    });
    batL.instanceMatrix.needsUpdate = batR.instanceMatrix.needsUpdate = true;
  });

  // ---------- Sky lanterns rising from the fields ----------
  const LANTERNS = 28;
  const lanternMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.25, 0.6, 8), glow(0xffa64a, 1.6, 0.9), LANTERNS);
  const lanternHalo = new THREE.InstancedMesh(new THREE.SphereGeometry(0.8, 10, 8), glow(0xff7a20, 0.6, 0.3), LANTERNS);
  lanternMesh.frustumCulled = lanternHalo.frustumCulled = false;
  scene.add(lanternMesh, lanternHalo);
  const spawnLantern = (l: { x: number; y: number; z: number; v: number; ph: number }, anyHeight: boolean) => {
    l.x = (Math.random() < 0.5 ? -1 : 1) * rand(roadHalf + 4, 30);
    l.z = rand(-70, 0);
    l.y = anyHeight ? rand(0, 30) : 0;
    l.v = rand(0.6, 1.2);
    l.ph = rand(0, 6);
  };
  const lanterns = Array.from({ length: LANTERNS }, () => { const l = { x: 0, y: 0, z: 0, v: 0, ph: 0 }; spawnLantern(l, true); return l; });
  updaters.push((dt, t) => {
    lanterns.forEach((l, i) => {
      l.y += l.v * dt;
      if (l.y > 32) spawnLantern(l, false);
      o.position.set(l.x + Math.sin(t * 0.5 + l.ph) * 1.5, l.y + 0.5, l.z);
      o.rotation.set(0, t * 0.3 + l.ph, Math.sin(t + l.ph) * 0.1);
      o.scale.setScalar(Math.min(1, l.y / 2) * (1 + Math.sin(t * 6 + l.ph) * 0.05));
      o.updateMatrix();
      lanternMesh.setMatrixAt(i, o.matrix);
      lanternHalo.setMatrixAt(i, o.matrix);
    });
    lanternMesh.instanceMatrix.needsUpdate = lanternHalo.instanceMatrix.needsUpdate = true;
  });

  // ---------- Shooting stars every few seconds ----------
  const streak = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.25, 14, 6, 1, true).rotateZ(Math.PI / 2).translate(7, 0, 0),
    glow(0xd8ecff, 2, 0.9),
  );
  streak.visible = false;
  scene.add(streak);
  let starT = 3, starLife = 0;
  const starDir = new THREE.Vector3();
  updaters.push((dt) => {
    if (streak.visible) {
      starLife -= dt;
      streak.position.addScaledVector(starDir, dt * 90);
      (streak.material as THREE.MeshBasicMaterial).opacity = Math.max(0, starLife / 0.8);
      if (starLife <= 0) streak.visible = false;
    } else if ((starT -= dt) <= 0) {
      starT = rand(3, 8);
      starLife = 0.8;
      streak.visible = true;
      streak.position.set(rand(-60, 60), rand(45, 70), rand(-130, -90));
      starDir.set(rand(-1, 1) < 0 ? -1 : 1, -0.35, 0).normalize();
      streak.rotation.set(0, 0, Math.atan2(starDir.y, starDir.x) + Math.PI);
    }
  });

  // ---------- Airship drifting across the far sky ----------
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7, flatShading: true });
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0xc94a5a, roughness: 0.8, flatShading: true }));
  balloon.scale.set(7, 2.6, 2.6);
  balloon.position.y = 3.2;
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 1.4), hullMat);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 3), hullMat);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(-7.3, 3.2, 0);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 1.45), glow(0xffd27a, 1.8));
  ship.add(balloon, gondola, fin, windows);
  scene.add(ship);
  let shipX = -90;
  updaters.push((dt, t) => {
    shipX += dt * 2.2;
    if (shipX > 90) shipX = -90;
    ship.position.set(shipX, 30 + Math.sin(t * 0.4) * 1.5, -95);
    ship.rotation.z = Math.sin(t * 0.6) * 0.03;
  });

  return (dt: number, t: number) => updaters.forEach((u) => u(dt, t));
}
