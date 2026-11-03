import * as THREE from 'three';
import { merge, egg, type Part } from './models';

// Ambient world dressing: nothing here affects gameplay, it just makes the world feel alive.
// Flaming braziers along the road, distant mountains, a ringed moon, a bat flock, rising sky
// lanterns, shooting stars and a drifting airship. Returns an update(dt, time) for animation.

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const glow = (color: number, k: number, opacity = 1) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
});

export function createAmbient(scene: THREE.Scene, roadHalf: number, camera: THREE.Camera) {
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

  // ---------- Bats: furry bodies, big ears, glowing eyes, two-part scalloped membrane wings ----------
  // Each wing is an inner section (shoulder to wrist) and an outer section (wrist to tip) so the
  // wing can fold on the upstroke and spread on the downstroke, like a real bat.
  const BATS = 22;
  const FUR = 0x2b1b33, MEMBRANE = 0x3a2140, BONE_C = 0x1a0f20;
  const wingPart = (pts: [number, number][], bones: [number, number][]) => {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 2) shape.quadraticCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    const membrane = new THREE.ShapeGeometry(shape, 12).rotateX(Math.PI / 2);
    const parts: Part[] = [{ geo: membrane, color: MEMBRANE }];
    // Finger bones fan out from the joint to the scallop points.
    for (const [x, z] of bones) {
      const len = Math.hypot(x, z);
      // Bone lies flat in the wing plane, pointing from the joint toward (x, z).
      parts.push({ geo: new THREE.CylinderGeometry(0.012, 0.02, len, 5).rotateX(Math.PI / 2), color: BONE_C, pos: [x / 2, 0.005, z / 2], rot: [0, Math.atan2(x, z), 0] });
    }
    return merge(parts);
  };
  // Shape coords: x = out along the wing, y = toward the front (becomes +z).
  const innerGeo = wingPart(
    [[0, 0.14], [0.3, 0.2], [0.58, 0.16], [0.56, 0.0], [0.48, -0.16], [0.36, -0.08], [0.24, -0.2], [0.12, -0.1], [0, -0.14], [0, 0, ], [0, 0.14]],
    [[0.58, 0.16]],
  );
  const outerGeo = wingPart(
    [[0, 0.16], [0.4, 0.14], [0.8, 0.0], [0.7, -0.1], [0.58, -0.26], [0.46, -0.12], [0.34, -0.34], [0.22, -0.14], [0.1, -0.3], [0.04, -0.1], [0, 0.0]],
    [[0.8, 0.0], [0.58, -0.26], [0.34, -0.34], [0.1, -0.3]],
  );
  const batBody = merge([
    { geo: egg(0.11, 0.34, 0.15, 14), color: FUR, rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.SphereGeometry(0.1, 16, 12), color: FUR, pos: [0, 0.03, 0.2] },
    { geo: new THREE.SphereGeometry(0.045, 10, 8), color: 0x4a2a50, pos: [0, 0.0, 0.29], scale: [1, 0.8, 1] }, // snout
    ...[-1, 1].flatMap((sd): Part[] => [
      { geo: new THREE.ConeGeometry(0.045, 0.16, 8), color: FUR, pos: [sd * 0.06, 0.14, 0.18], rot: [-0.2, 0, -sd * 0.35] },
      { geo: new THREE.ConeGeometry(0.025, 0.11, 6), color: 0x8a4a6a, pos: [sd * 0.06, 0.14, 0.195], rot: [-0.2, 0, -sd * 0.35] },
      { geo: new THREE.ConeGeometry(0.012, 0.035, 4), color: 0xffffff, pos: [sd * 0.02, -0.04, 0.3], rot: [Math.PI, 0, 0] }, // fangs
      { geo: new THREE.CylinderGeometry(0.012, 0.008, 0.1, 5), color: BONE_C, pos: [sd * 0.04, -0.06, -0.16], rot: [0.6, 0, 0] }, // feet
    ]),
  ]);
  const batEyesGeo = merge([-1, 1].map((sd): Part => ({ geo: new THREE.SphereGeometry(0.022, 8, 6), pos: [sd * 0.045, 0.06, 0.28] })));
  const batMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const mkBat = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.InstancedMesh(geo, mat, BATS);
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const batBodies = mkBat(batBody, batMat);
  const batEyes = mkBat(batEyesGeo, glow(0xff2020, 2.5));
  const wingMeshes = [mkBat(innerGeo, batMat), mkBat(outerGeo, batMat), mkBat(innerGeo, batMat), mkBat(outerGeo, batMat)];
  const bats = Array.from({ length: BATS }, (_, i) => ({
    cx: (i % 2 ? 1 : -1) * rand(13, 24), cz: rand(-60, -22), r: rand(4, 9), y: rand(8, 15),
    sp: rand(0.35, 0.7) * (Math.random() < 0.5 ? 1 : -1), ph: rand(0, 6), flap: rand(7, 10), size: rand(1.6, 2.4),
  }));
  const wi = new THREE.Matrix4(), wo = new THREE.Matrix4(), tmpM = new THREE.Matrix4(), mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  updaters.push((_, t) => {
    bats.forEach((b, i) => {
      const a = b.ph + t * b.sp;
      // Fly tangent to the circle, banking into the turn.
      o.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 1.3 + b.ph) * 1.2, b.cz + Math.sin(a) * b.r);
      o.rotation.set(0, Math.atan2(-Math.sin(a) * b.sp, Math.cos(a) * b.sp), -Math.sign(b.sp) * 0.35, 'YXZ');
      o.scale.setScalar(b.size);
      o.updateMatrix();
      batBodies.setMatrixAt(i, o.matrix);
      batEyes.setMatrixAt(i, o.matrix);
      const ph = t * b.flap + b.ph;
      const f = Math.sin(ph); // +1 = wings up
      const fold = Math.max(0, f) * 0.9; // outer wing folds in on the upstroke
      for (let side = 0; side < 2; side++) {
        wi.makeTranslation(0.06, 0.02, 0.02).multiply(tmpM.makeRotationZ(f * 0.9));
        wo.copy(wi).multiply(tmpM.makeTranslation(0.56, 0, 0)).multiply(tmpM.makeRotationZ(-f * 0.5 + fold * 0.4)).multiply(tmpM.makeRotationY(fold * 0.8));
        const base = side === 0 ? o.matrix.clone().multiply(mirror) : o.matrix;
        wingMeshes[side * 2].setMatrixAt(i, tmpM.copy(base).multiply(wi));
        wingMeshes[side * 2 + 1].setMatrixAt(i, tmpM.copy(base).multiply(wo));
      }
    });
    for (const m of [batBodies, batEyes, ...wingMeshes]) m.instanceMatrix.needsUpdate = true;
  });

  // ---------- Paper sky lanterns ----------
  // Tapered paper shell (lathe) lit from inside: brightest at the open bottom near the flame,
  // darker toward the top. Bamboo ribs and hoop, a wire cross with a burning fuel cell, and a soft halo.
  const LANTERNS = 26;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const tt = i / 16;
    const r = tt < 0.82 ? 0.28 + 0.16 * Math.sin((tt / 0.82) * Math.PI * 0.5) : 0.44 * Math.cos(((tt - 0.82) / 0.18) * Math.PI * 0.5);
    profile.push(new THREE.Vector2(Math.max(0.001, r), tt * 1.05));
  }
  const paper = new THREE.LatheGeometry(profile, 28);
  const pc = new Float32Array(paper.attributes.position.count * 3);
  const lo = new THREE.Color(1.9, 1.15, 0.5), hi = new THREE.Color(0.85, 0.32, 0.12), cc = new THREE.Color();
  for (let i = 0; i < paper.attributes.position.count; i++) {
    cc.copy(lo).lerp(hi, Math.min(1, paper.attributes.position.getY(i) / 1.05));
    pc.set([cc.r, cc.g, cc.b], i * 3);
  }
  paper.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  const paperMesh = new THREE.InstancedMesh(paper, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.93, fog: false }), LANTERNS);
  const ribParts: Part[] = [];
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    for (let i = 0; i < 16; i += 2) {
      const a = profile[i], b = profile[i + 2];
      const mid = new THREE.Vector3(((a.x + b.x) / 2) * Math.cos(ang), (a.y + b.y) / 2, ((a.x + b.x) / 2) * Math.sin(ang));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const tilt = Math.atan2(b.x - a.x, b.y - a.y);
      ribParts.push({ geo: new THREE.BoxGeometry(0.018, len, 0.018), color: 0x6b3a1a, pos: [mid.x * 1.01, mid.y, mid.z * 1.01], rot: [0, -ang, 0] });
      const rp = ribParts[ribParts.length - 1];
      rp.rot = [Math.sin(ang) * tilt, 0, -Math.cos(ang) * tilt]; // lean the rib outward with the paper
    }
  }
  ribParts.push({ geo: new THREE.TorusGeometry(0.28, 0.022, 8, 28), color: 0xa8743a, rot: [Math.PI / 2, 0, 0] });
  ribParts.push({ geo: new THREE.BoxGeometry(0.56, 0.01, 0.01), color: 0x555555 });
  ribParts.push({ geo: new THREE.BoxGeometry(0.01, 0.01, 0.56), color: 0x555555 });
  ribParts.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), color: 0x3a2a1a, pos: [0, -0.01, 0] });
  const ribMesh = new THREE.InstancedMesh(merge(ribParts), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), LANTERNS);
  const flameMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 12, 8).scale(1, 1.8, 1).translate(0, 0.1, 0), glow(0xfff2b0, 3), LANTERNS);
  // Soft radial-gradient halo billboard.
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,190,110,0.9)'); gr.addColorStop(0.4, 'rgba(255,120,40,0.35)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  })();
  const haloMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), LANTERNS);
  for (const m of [paperMesh, ribMesh, flameMesh, haloMesh]) { m.frustumCulled = false; scene.add(m); }
  const spawnLantern = (l: { x: number; y: number; z: number; v: number; ph: number }, anyHeight: boolean) => {
    l.x = (Math.random() < 0.5 ? -1 : 1) * rand(roadHalf + 4, 30);
    l.z = rand(-70, 0);
    l.y = anyHeight ? rand(0, 30) : 0;
    l.v = rand(0.6, 1.1);
    l.ph = rand(0, 6);
  };
  const lanterns = Array.from({ length: LANTERNS }, () => { const l = { x: 0, y: 0, z: 0, v: 0, ph: 0 }; spawnLantern(l, true); return l; });
  updaters.push((dt, t) => {
    lanterns.forEach((l, i) => {
      l.y += l.v * dt;
      if (l.y > 32) spawnLantern(l, false);
      const grow = Math.min(1, l.y / 2) * 1.3;
      o.position.set(l.x + Math.sin(t * 0.5 + l.ph) * 1.5, l.y, l.z);
      o.rotation.set(Math.sin(t * 0.8 + l.ph) * 0.06, t * 0.25 + l.ph, Math.cos(t * 0.7 + l.ph) * 0.06);
      o.scale.setScalar(grow);
      o.updateMatrix();
      paperMesh.setMatrixAt(i, o.matrix);
      ribMesh.setMatrixAt(i, o.matrix);
      o.scale.setScalar(grow * (1 + Math.sin(t * 18 + l.ph * 5) * 0.15));
      o.updateMatrix();
      flameMesh.setMatrixAt(i, o.matrix);
      o.position.y += 0.45 * grow;
      o.quaternion.copy(camera.quaternion);
      o.scale.setScalar(grow * (1 + Math.sin(t * 6 + l.ph) * 0.06));
      o.updateMatrix();
      haloMesh.setMatrixAt(i, o.matrix);
    });
    for (const m of [paperMesh, ribMesh, flameMesh, haloMesh]) m.instanceMatrix.needsUpdate = true;
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
