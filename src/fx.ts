import * as THREE from 'three';

// Short-lived visual effects: spawn portals, explosions, sparks and floating text.
// Everything is pooled/instanced so effects can fire constantly without allocations piling up.

const additive = (color: number, k: number, opacity = 1) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

type Pulse = { x: number; y: number; z: number; t: number; life: number; size: number; color: THREE.Color };

// A pool of instanced quads/meshes whose scale and fade follow a timeline.
function pool(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.MeshBasicMaterial, max: number) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  mesh.count = 0;
  // Per-instance colour doubles as fade (additive blending: darker = more transparent).
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  scene.add(mesh);
  let items: Pulse[] = [];
  return {
    add(p: Omit<Pulse, 't'>) { if (items.length < max) items.push({ ...p, t: 0 }); },
    clear() { items = []; },
    update(dt: number, place: (p: Pulse, k: number, o: THREE.Object3D) => number) {
      const o = new THREE.Object3D();
      const c = new THREE.Color();
      items = items.filter((p) => (p.t += dt) < p.life);
      items.forEach((p, i) => {
        const k = p.t / p.life;
        o.position.set(p.x, p.y, p.z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(1);
        const fade = place(p, k, o);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        mesh.setColorAt(i, c.copy(p.color).multiplyScalar(fade));
      });
      mesh.count = items.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
  };
}

export function createFx(scene: THREE.Scene, camera: THREE.Camera) {
  const white = (o = 1) => additive(0xffffff, 1, o);
  // Spawn portal: a ring that blooms open on the ground plus a beam of light that fades.
  const rings = pool(scene, new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2), white(), 120);
  const beams = pool(scene, new THREE.CylinderGeometry(0.5, 0.7, 1, 20, 1, true).translate(0, 0.5, 0), white(0.6), 120);
  // Explosions: a hot core sphere, an outer shock sphere and a ground shockwave ring.
  const cores = pool(scene, new THREE.SphereGeometry(1, 20, 14), white(), 60);
  const shocks = pool(scene, new THREE.SphereGeometry(1, 20, 14), white(0.35), 60);
  // Sparks: little stretched shards flung outward.
  type Spark = { p: THREE.Vector3; v: THREE.Vector3; t: number; life: number; color: THREE.Color };
  let sparks: Spark[] = [];
  const MAX_SPARKS = 500;
  const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.28), white(), MAX_SPARKS);
  sparkMesh.frustumCulled = false;
  sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPARKS * 3), 3);
  sparkMesh.count = 0;
  scene.add(sparkMesh);

  // Floating text: canvas sprites that rise and fade (gate results, pickups).
  type Text = { s: THREE.Sprite; t: number; life: number; vy: number };
  let texts: Text[] = [];

  // Camera shake.
  let shake = 0;
  const camBase = camera.position.clone();

  const tmpC = new THREE.Color();
  const api = {
    portal(x: number, z: number, color: number, size = 1) {
      const c = new THREE.Color(color).multiplyScalar(1.6);
      rings.add({ x, y: 0.05, z, life: 0.6, size, color: c });
      beams.add({ x, y: 0, z, life: 0.55, size, color: c });
      api.sparks(x, 0.3, z, color, 6, 3);
    },
    explosion(x: number, z: number, radius: number) {
      cores.add({ x, y: 0.7, z, life: 0.35, size: radius * 0.7, color: new THREE.Color(0xfff0b0).multiplyScalar(2.5) });
      shocks.add({ x, y: 0.6, z, life: 0.5, size: radius, color: new THREE.Color(0xff6a20).multiplyScalar(1.4) });
      rings.add({ x, y: 0.06, z, life: 0.45, size: radius * 1.3, color: new THREE.Color(0xffa040).multiplyScalar(1.5) });
      api.sparks(x, 0.7, z, 0xffa040, 18, 9);
      api.shake(0.12);
    },
    sparks(x: number, y: number, z: number, color: number, n: number, speed: number) {
      const c = new THREE.Color(color).multiplyScalar(2);
      for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.5 + Math.random()));
        v.y = Math.abs(v.y) + speed * 0.3;
        sparks.push({ p: new THREE.Vector3(x, y, z), v, t: 0, life: 0.35 + Math.random() * 0.35, color: c });
      }
    },
    text(x: number, y: number, z: number, str: string, color: string, size = 1) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 128;
      const g = cv.getContext('2d')!;
      g.font = '900 84px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.strokeText(str, 128, 68);
      g.fillStyle = color;
      g.fillText(str, 128, 68);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.scale.set(2.4 * size, 1.2 * size, 1);
      s.position.set(x, y, z);
      s.renderOrder = 20;
      scene.add(s);
      texts.push({ s, t: 0, life: 1.1, vy: 2.2 });
    },
    shake(amount: number) { shake = Math.max(shake, amount); },
    clear() {
      rings.clear(); beams.clear(); cores.clear(); shocks.clear(); sparks = [];
      texts.forEach((t) => { scene.remove(t.s); t.s.material.map?.dispose(); t.s.material.dispose(); });
      texts = [];
    },
    update(dt: number) {
      rings.update(dt, (p, k, o) => { o.scale.setScalar(p.size * (0.3 + k * 1.2)); return 1 - k; });
      beams.update(dt, (p, k, o) => { o.scale.set(p.size * (1 - k * 0.6), 4 * (1 - k * 0.3), p.size * (1 - k * 0.6)); return (1 - k) * (k < 0.15 ? k / 0.15 : 1); });
      cores.update(dt, (p, k, o) => { o.scale.setScalar(p.size * (0.4 + Math.sqrt(k) * 0.8)); return 1 - k; });
      shocks.update(dt, (p, k, o) => { o.scale.setScalar(p.size * (0.3 + k * 1.1)); return (1 - k) * 0.8; });

      const o = new THREE.Object3D();
      sparks = sparks.filter((s) => (s.t += dt) < s.life);
      sparks.forEach((s, i) => {
        s.v.y -= 14 * dt;
        s.p.addScaledVector(s.v, dt);
        o.position.copy(s.p);
        o.lookAt(s.p.x + s.v.x, s.p.y + s.v.y, s.p.z + s.v.z);
        o.scale.set(1, 1, 0.5 + s.v.length() * 0.12);
        o.updateMatrix();
        sparkMesh.setMatrixAt(i, o.matrix);
        sparkMesh.setColorAt(i, tmpC.copy(s.color).multiplyScalar(1 - s.t / s.life));
      });
      sparkMesh.count = sparks.length;
      sparkMesh.instanceMatrix.needsUpdate = true;
      sparkMesh.instanceColor!.needsUpdate = true;

      texts = texts.filter((t) => {
        t.t += dt;
        t.s.position.y += t.vy * dt;
        t.vy *= 0.94;
        const k = t.t / t.life;
        // Pop in big, settle, then fade.
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15));
        t.s.scale.set(2.4 * pop, 1.2 * pop, 1);
        t.s.material.opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        if (t.t >= t.life) { scene.remove(t.s); t.s.material.map?.dispose(); t.s.material.dispose(); return false; }
        return true;
      });

      shake = Math.max(0, shake - dt * 0.8);
      camera.position.set(
        camBase.x + (Math.random() - 0.5) * shake,
        camBase.y + (Math.random() - 0.5) * shake,
        camBase.z,
      );
    },
  };
  return api;
}
export type Fx = ReturnType<typeof createFx>;
