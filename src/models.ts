import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Stylised low-poly creatures in the spirit of CC0 packs like Quaternius' monsters:
// chunky rounded bodies, big expressive eyes, solid colours and cel shading.
// Everything is generated here from primitives (no downloaded assets).
//
// Each enemy type is split into instancable parts so hundreds can run at once:
//   body   - tinted by the per-instance colour
//   accent - keeps its own colours (eyes, teeth, horns, armour, crown)
//   leg    - one leg, pivot at the hip; drawn mirrored with opposite swing
//   arm    - one arm, pivot at the shoulder; swings opposite to the leg on its side
// Models face +z (toward the player) with their feet at y = 0.

export type V3 = [number, number, number];
// `k` scales the vertex colour; > 1 makes that part bright enough to bloom (glowing details).
export type Part = { geo: THREE.BufferGeometry; color?: number; pos?: V3; rot?: V3; scale?: V3; k?: number };

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eul = new THREE.Euler();

export function merge(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(({ geo, color = 0xffffff, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], k = 1 }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    m4.compose(new THREE.Vector3(...pos), q.setFromEuler(eul.set(...rot)), new THREE.Vector3(...scale));
    g.applyMatrix4(m4);
    const c = new THREE.Color(color).multiplyScalar(k);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  merged.computeBoundingSphere();
  return merged;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sphere = (r: number, ws = 10, hs = 7) => new THREE.SphereGeometry(r, ws, hs);
const capsule = (r: number, l: number, rs = 8) => new THREE.CapsuleGeometry(r, l, 3, rs);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
const cyl = (rt: number, rb: number, h: number, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);

// Egg / pear shaped body via a lathe: `bulge` > 0 makes it bottom-heavy (bellies), < 0 top-heavy (chests).
export function egg(r: number, h: number, bulge = 0.25, seg = 12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 = bottom, 1 = top
    const a = t * Math.PI;
    const w = Math.sin(a) * r * (1 + bulge * Math.cos(a));
    pts.push(new THREE.Vector2(Math.max(w, 0.0001), -Math.cos(a) * h / 2));
  }
  return new THREE.LatheGeometry(pts, seg);
}

const WHITE = 0xffffff, BLACK = 0x15121c, BONE = 0xf4e9cf, METAL = 0xaab4c8, DARK_METAL = 0x5a6274;
const GOLD = 0xffc93c, GLOW = 0xff3030, MOUTH = 0x4a1424, TONGUE = 0xff6f91;

export const HIP_Y = 0.45;

// Big cartoon eye: white, coloured iris, pupil, and a specular highlight that sells the "finished" look.
function eye(x: number, y: number, z: number, r: number, iris = 0x3a2a1a, angry = 0): Part[] {
  const parts: Part[] = [
    { geo: sphere(r, 10, 7), color: WHITE, pos: [x, y, z], scale: [1, 1.1, 0.7] },
    { geo: sphere(r * 0.6, 9, 6), color: iris, pos: [x, y - r * 0.05, z + r * 0.45], scale: [1, 1, 0.5] },
    { geo: sphere(r * 0.32, 6, 4), color: BLACK, pos: [x, y - r * 0.05, z + r * 0.62], scale: [1, 1, 0.5] },
    { geo: sphere(r * 0.16, 6, 4), color: WHITE, pos: [x + r * 0.22, y + r * 0.25, z + r * 0.72] },
  ];
  // Angled brow for attitude.
  if (angry) parts.push({ geo: box(r * 2.1, r * 0.4, r * 0.4), color: BLACK, pos: [x, y + r * 1.05, z + r * 0.3], rot: [0, 0, -Math.sign(x) * angry] });
  return parts;
}
const eyePair = (y: number, z: number, spread: number, r: number, iris?: number, angry = 0) =>
  [-1, 1].flatMap((s) => eye(s * spread, y, z, r, iris, angry));

// Open mouth with teeth.
function mouth(y: number, z: number, w: number, teeth = 2, fangs = false): Part[] {
  const parts: Part[] = [
    { geo: sphere(w / 2, 9, 6), color: MOUTH, pos: [0, y, z], scale: [1, 0.45, 0.4] },
    { geo: sphere(w / 4, 8, 6), color: TONGUE, pos: [0, y - w * 0.08, z + w * 0.08], scale: [1, 0.4, 0.5] },
  ];
  for (let i = 0; i < teeth; i++) {
    const x = (i - (teeth - 1) / 2) * (w / (teeth + 1));
    parts.push({ geo: cone(w * 0.07, w * (fangs ? 0.3 : 0.18), 4), color: WHITE, pos: [x, y + w * 0.12, z + w * 0.15], rot: [Math.PI, 0, 0] });
  }
  return parts;
}

export type EnemyModel = {
  body: THREE.BufferGeometry; accent: THREE.BufferGeometry;
  leg: THREE.BufferGeometry; arm: THREE.BufferGeometry;
  hipX: number; shoulder: V3;
};

// Limbs: chunky tapered shapes with a rounded foot / mitten hand. Pivots at the joint (y = 0).
function makeLeg(r: number, footColor = 0x3a2f2a, len = HIP_Y): THREE.BufferGeometry {
  return merge([
    { geo: cyl(r, r * 0.8, len - r, 8), pos: [0, -(len - r) / 2, 0] },
    { geo: sphere(r * 1.15, 8, 6), color: footColor, pos: [0, -len + r * 0.8, r * 0.45], scale: [1, 0.7, 1.4] },
  ]);
}
function makeArm(r: number, len: number, handColor = 0xffffff, extra: Part[] = []): THREE.BufferGeometry {
  return merge([
    { geo: sphere(r * 1.15, 8, 6) },
    { geo: cyl(r, r * 0.85, len, 8), pos: [0, -len / 2, 0] },
    { geo: sphere(r * 1.3, 8, 6), color: handColor, pos: [0, -len, 0] },
    ...extra,
  ]);
}

export function buildEnemyModels(): Record<string, EnemyModel> {
  const models: Record<string, EnemyModel> = {};

  // Grunt: round goblin blob. Body and head are one egg; big ears, gappy grin.
  models.grunt = {
    body: merge([
      { geo: egg(0.42, 0.95, 0.3), pos: [0, HIP_Y + 0.42, 0] },
      ...[-1, 1].map((s): Part => ({ geo: cone(0.12, 0.4, 8), pos: [s * 0.42, 1.05, -0.02], rot: [0, 0, -s * 1.25], scale: [1, 1, 0.45] })),
      { geo: sphere(0.08, 8, 6), pos: [0, 0.98, 0.42] }, // nose
    ]),
    accent: merge([
      ...eyePair(1.1, 0.3, 0.15, 0.11, 0xd14b1f, 0.35),
      ...mouth(0.78, 0.36, 0.3, 2),
      { geo: box(0.7, 0.1, 0.62), color: 0x6b4423, pos: [0, HIP_Y + 0.08, 0] }, // belt
    ]),
    leg: makeLeg(0.11), arm: makeArm(0.08, 0.32),
    hipX: 0.16, shoulder: [0.4, 0.95, 0.05],
  };

  // Runner: skinny imp with huge eyes, long swept-back ears and a scarf.
  models.runner = {
    body: merge([
      { geo: egg(0.26, 0.6, 0.1), pos: [0, HIP_Y + 0.3, 0] },
      { geo: sphere(0.32, 9, 6), pos: [0, 1.15, 0.05] },
      ...[-1, 1].map((s): Part => ({ geo: cone(0.09, 0.55, 8), pos: [s * 0.25, 1.4, -0.18], rot: [-0.9, 0, -s * 0.5], scale: [1, 1, 0.4] })),
    ]),
    accent: merge([
      ...eyePair(1.18, 0.24, 0.13, 0.12, 0x2e9e4f),
      ...mouth(0.98, 0.31, 0.16, 2, true),
      { geo: new THREE.TorusGeometry(0.22, 0.06, 6, 16), color: 0xff3d7f, pos: [0, 0.86, 0], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.1, 0.05, 0.45), color: 0xff3d7f, pos: [0.08, 0.82, -0.38], rot: [0.5, 0.25, 0] },
    ]),
    leg: makeLeg(0.07, 0x2b2b3a), arm: makeArm(0.055, 0.3),
    hipX: 0.11, shoulder: [0.26, 0.82, 0.03],
  };

  // Blue: stout knight with a full helm, glowing eye slit, red plume, breastplate and kite shield.
  models.blue = {
    body: merge([
      { geo: egg(0.4, 0.9, -0.1), pos: [0, HIP_Y + 0.4, 0] },
    ]),
    accent: merge([
      { geo: cyl(0.3, 0.32, 0.42, 16), color: METAL, pos: [0, 1.23, 0] },
      { geo: sphere(0.3, 16, 8), color: METAL, pos: [0, 1.44, 0], scale: [1, 0.6, 1] },
      { geo: box(0.38, 0.06, 0.05), color: 0x6ff7ff, pos: [0, 1.25, 0.31] },
      { geo: box(0.05, 0.22, 0.05), color: DARK_METAL, pos: [0, 1.12, 0.31] },
      { geo: capsule(0.06, 0.4), color: 0xd9283a, pos: [0, 1.6, -0.15], rot: [-1.2, 0, 0] },
      { geo: egg(0.42, 0.55, -0.2), color: METAL, pos: [0, 0.9, 0.06], scale: [1, 1, 0.9] },
      { geo: box(0.9, 0.08, 0.7), color: DARK_METAL, pos: [0, HIP_Y + 0.06, 0] },
    ]),
    leg: makeLeg(0.12, DARK_METAL),
    arm: makeArm(0.09, 0.32, METAL, [
      { geo: cyl(0.26, 0.26, 0.05, 6), color: 0x2a5bd7, pos: [0, -0.32, 0.18], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.3] },
      { geo: cyl(0.1, 0.1, 0.07, 6), color: GOLD, pos: [0, -0.32, 0.22], rot: [Math.PI / 2, 0, 0] },
    ]),
    hipX: 0.17, shoulder: [0.44, 1.0, 0.0],
  };

  // Purple: imp-demon with bat wings, curled horns, a spade-tipped tail and glowing eyes.
  const wing = (s: number): Part[] => [
    { geo: cone(0.42, 0.9, 3), color: 0x3d1650, pos: [s * 0.55, 1.15, -0.3], rot: [0.2, s * 0.5, s * 1.9], scale: [1, 1, 0.12] },
    { geo: cyl(0.03, 0.03, 0.9, 5), color: 0x2a0f38, pos: [s * 0.52, 1.25, -0.3], rot: [0, 0, s * 1.2] },
  ];
  models.purple = {
    body: merge([
      { geo: egg(0.4, 0.95, 0.05), pos: [0, HIP_Y + 0.44, 0] },
      { geo: capsule(0.05, 0.55), pos: [0, 0.55, -0.48], rot: [1.1, 0, 0] },
    ]),
    accent: merge([
      ...eyePair(1.12, 0.3, 0.14, 0.1, GLOW, 0.5),
      ...mouth(0.82, 0.35, 0.28, 4, true),
      ...[-1, 1].flatMap((s): Part[] => [
        { geo: cone(0.08, 0.32, 8), color: BONE, pos: [s * 0.24, 1.43, 0], rot: [0, 0, -s * 0.6] },
        { geo: cone(0.05, 0.2, 6), color: BONE, pos: [s * 0.38, 1.56, -0.05], rot: [0, 0, -s * 1.5] },
      ]),
      ...wing(-1), ...wing(1),
      { geo: cone(0.1, 0.18, 4), color: 0x2a0f38, pos: [0, 0.32, -0.78], rot: [-2.0, 0, 0], scale: [1, 1, 0.4] },
    ]),
    leg: makeLeg(0.11, 0x2a0f38), arm: makeArm(0.08, 0.34, 0xffffff, [
      ...[-1, 0, 1].map((i): Part => ({ geo: cone(0.025, 0.12, 4), color: BONE, pos: [i * 0.05, -0.48, 0.06], rot: [Math.PI, 0, 0] })),
    ]),
    hipX: 0.16, shoulder: [0.4, 1.0, 0.02],
  };

  // Orange: pot-bellied ogre with an underbite, tusks, a topknot, loincloth and a spiked club.
  models.orange = {
    body: merge([
      { geo: egg(0.5, 1.0, 0.35), pos: [0, HIP_Y + 0.45, 0] },
      { geo: sphere(0.28, 10, 7), pos: [0, 1.3, 0.08] },
      { geo: sphere(0.09, 8, 6), pos: [0, 1.58, -0.02] }, // topknot
    ]),
    accent: merge([
      ...eyePair(1.36, 0.3, 0.1, 0.075, 0x4a2a10, 0.4),
      { geo: box(0.36, 0.1, 0.1), color: MOUTH, pos: [0, 1.17, 0.3] },
      ...[-1, 1].map((s): Part => ({ geo: cone(0.04, 0.16, 6), color: BONE, pos: [s * 0.12, 1.25, 0.32] })),
      { geo: cyl(0.52, 0.56, 0.18, 14), color: 0x7a4b25, pos: [0, HIP_Y + 0.12, 0] },
      { geo: box(0.3, 0.3, 0.05), color: 0x7a4b25, pos: [0, HIP_Y - 0.08, 0.5] },
      { geo: cyl(0.06, 0.06, 0.12, 8), color: 0x3a2a18, pos: [0, 1.66, -0.02] },
    ]),
    leg: makeLeg(0.15, 0x3a2a18), arm: makeArm(0.12, 0.38, 0xffffff, [
      { geo: cyl(0.06, 0.13, 0.75, 8), color: 0x6b4423, pos: [0, -0.42, 0.35], rot: [Math.PI / 2 + 0.3, 0, 0] },
      ...[0, 1, 2, 3].map((i): Part => {
        const a = (i / 4) * Math.PI * 2;
        return { geo: cone(0.035, 0.12, 4), color: BONE, pos: [Math.cos(a) * 0.13, -0.42 + Math.sin(a) * 0.13, 0.66], rot: [0, 0, a - Math.PI / 2] };
      }),
    ]),
    hipX: 0.22, shoulder: [0.52, 1.02, 0.0],
  };

  // Red: horned bull brute with a snout and nose ring, huge shoulders and spiked pauldrons.
  models.red = {
    body: merge([
      { geo: egg(0.5, 1.0, -0.3), pos: [0, HIP_Y + 0.48, 0] },
      { geo: sphere(0.3, 10, 7), pos: [0, 1.4, 0.12] },
      { geo: sphere(0.17, 9, 6), pos: [0, 1.3, 0.38], scale: [1.2, 0.8, 0.9] }, // snout
    ]),
    accent: merge([
      ...eyePair(1.5, 0.3, 0.13, 0.075, GLOW, 0.55),
      ...[-1, 1].map((s): Part => ({ geo: sphere(0.04, 6, 4), color: BLACK, pos: [s * 0.07, 1.31, 0.53] })),
      { geo: new THREE.TorusGeometry(0.06, 0.015, 6, 12), color: GOLD, pos: [0, 1.24, 0.53] },
      ...[-1, 1].flatMap((s): Part[] => [
        { geo: cone(0.09, 0.4, 8), color: BONE, pos: [s * 0.36, 1.62, 0.08], rot: [0.3, 0, -s * 1.1] },
        { geo: sphere(0.24, 9, 6), color: DARK_METAL, pos: [s * 0.52, 1.2, 0], scale: [1, 0.65, 1] },
        ...[0, 1].map((i): Part => ({ geo: cone(0.05, 0.22, 5), color: BONE, pos: [s * (0.55 + i * 0.06), 1.36, -0.08 + i * 0.16], rot: [0, 0, -s * 0.4] })),
      ]),
      { geo: box(0.95, 0.1, 0.75), color: 0x2a1a1a, pos: [0, HIP_Y + 0.08, 0] },
    ]),
    leg: makeLeg(0.16, 0x1a1010), arm: makeArm(0.13, 0.42, 0x2a1a1a),
    hipX: 0.24, shoulder: [0.56, 1.12, 0.0],
  };

  // Boss: crowned warlord. Royal cape, gold armour, glowing gem and eyes, and a great sword.
  models.boss = {
    body: merge([
      { geo: egg(0.48, 1.0, -0.15), pos: [0, HIP_Y + 0.46, 0] },
      { geo: sphere(0.3, 9, 6), pos: [0, 1.36, 0.04] },
    ]),
    accent: merge([
      ...eyePair(1.4, 0.28, 0.12, 0.075, GLOW, 0.6),
      ...mouth(1.2, 0.3, 0.2, 4, true),
      { geo: cyl(0.25, 0.23, 0.12, 14), color: GOLD, pos: [0, 1.64, 0] },
      ...Array.from({ length: 6 }, (_, i): Part => {
        const a = (i / 6) * Math.PI * 2;
        return { geo: cone(0.05, 0.18, 4), color: GOLD, pos: [Math.sin(a) * 0.22, 1.78, Math.cos(a) * 0.22] };
      }),
      ...[0, 2, 4].map((i): Part => {
        const a = (i / 6) * Math.PI * 2;
        return { geo: sphere(0.035, 6, 4), color: 0x7cf7ff, pos: [Math.sin(a) * 0.25, 1.65, Math.cos(a) * 0.25] };
      }),
      { geo: egg(0.5, 0.55, -0.2), color: GOLD, pos: [0, 0.98, 0.04], scale: [1, 1, 0.95] },
      { geo: new THREE.OctahedronGeometry(0.11), color: 0x7cf7ff, pos: [0, 1.0, 0.52] },
      { geo: box(1.0, 1.15, 0.05), color: 0x7a0f22, pos: [0, 0.82, -0.48], rot: [-0.18, 0, 0] },
      { geo: box(1.05, 0.12, 0.15), color: GOLD, pos: [0, 1.36, -0.44] },
      ...[-1, 1].map((s): Part => ({ geo: sphere(0.22, 9, 6), color: GOLD, pos: [s * 0.52, 1.24, 0], scale: [1, 0.6, 1] })),
    ]),
    leg: makeLeg(0.15, GOLD), arm: makeArm(0.12, 0.4, GOLD, [
      { geo: box(0.08, 0.06, 1.1), color: METAL, pos: [0, -0.42, 0.65] },
      { geo: box(0.3, 0.06, 0.06), color: GOLD, pos: [0, -0.42, 0.1] },
    ]),
    hipX: 0.22, shoulder: [0.55, 1.1, 0.0],
  };

  return models;
}
