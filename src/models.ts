import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Characters are built from primitives and merged into a few geometries per enemy type,
// so hundreds of them can still be drawn with instancing. Each type has:
//   body   - tinted by the per-instance colour (torso, head, arms)
//   accent - keeps its own colours (eyes, horns, armour, crown)
//   leg    - one leg pivoting at the hip; drawn twice with opposite swing to animate a run
// Models face +z (toward the player) with their feet at y = 0.

type Part = { geo: THREE.BufferGeometry; color?: number; pos?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();

function merge(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map(({ geo, color = 0xffffff, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    m4.compose(new THREE.Vector3(...pos), q.setFromEuler(e.set(...rot)), new THREE.Vector3(...scale));
    g.applyMatrix4(m4);
    const c = new THREE.Color(color);
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
const sphere = (r: number, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const capsule = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 3, 8);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);

const WHITE = 0xffffff, BLACK = 0x111111, BONE = 0xf2e6c9, METAL = 0x9aa4b8, GOLD = 0xffc93c, GLOW = 0xff2a2a;

export const HIP_Y = 0.45;

export function eyes(y: number, z: number, spread = 0.11, r = 0.075, pupil = BLACK): Part[] {
  return [-1, 1].flatMap((s) => [
    { geo: sphere(r, 10, 8), color: WHITE, pos: [s * spread, y, z] as [number, number, number] },
    { geo: sphere(r * 0.55, 8, 6), color: pupil, pos: [s * spread, y, z + r * 0.6] as [number, number, number] },
  ]);
}

function baseBody(opts: { torso?: [number, number]; head?: number; armLen?: number; lean?: number } = {}): Part[] {
  const [tr, tl] = opts.torso ?? [0.3, 0.3];
  const hr = opts.head ?? 0.27;
  const al = opts.armLen ?? 0.45;
  const torsoY = HIP_Y + tl / 2 + tr * 0.7;
  const headY = torsoY + tl / 2 + tr + hr * 0.75;
  return [
    { geo: capsule(tr, tl), pos: [0, torsoY, 0] },
    { geo: sphere(hr, 12, 10), pos: [0, headY, 0.02] },
    // Arms reach forward like they're grabbing at you.
    ...[-1, 1].map((s) => ({
      geo: capsule(0.08, al), pos: [s * (tr + 0.08), torsoY + 0.1, 0.18] as [number, number, number],
      rot: [-1.1, 0, s * 0.15] as [number, number, number],
    })),
  ];
}

function headY(opts: { torso?: [number, number]; head?: number } = {}) {
  const [tr, tl] = opts.torso ?? [0.3, 0.3];
  const hr = opts.head ?? 0.27;
  return HIP_Y + tl / 2 + tr * 0.7 + tl / 2 + tr + hr * 0.75;
}

export type EnemyModel = { body: THREE.BufferGeometry; accent: THREE.BufferGeometry; leg: THREE.BufferGeometry };

const leg = (r = 0.1, accent?: number): THREE.BufferGeometry =>
  merge([
    { geo: capsule(r, HIP_Y - r * 2), pos: [0, -HIP_Y / 2, 0] },
    { geo: box(r * 2.2, r * 1.2, r * 3), color: accent ?? 0x777777, pos: [0, -HIP_Y + r * 0.5, r * 0.6] },
  ]);

export function buildEnemyModels(): Record<string, EnemyModel> {
  const hy = headY();
  const models: Record<string, EnemyModel> = {};

  // Grunt: plain little goblin with pointy ears and a toothy grin.
  models.grunt = {
    body: merge([
      ...baseBody(),
      ...[-1, 1].map((s) => ({ geo: cone(0.07, 0.28, 6), pos: [s * 0.3, hy + 0.08, 0] as [number, number, number], rot: [0, 0, -s * 1.1] as [number, number, number] })),
    ]),
    accent: merge([
      ...eyes(hy + 0.04, 0.22),
      { geo: box(0.2, 0.04, 0.04), color: BLACK, pos: [0, hy - 0.12, 0.25] },
      ...[-0.06, 0.06].map((x) => ({ geo: cone(0.025, 0.06, 4), color: WHITE, pos: [x, hy - 0.15, 0.26] as [number, number, number], rot: [Math.PI, 0, 0] as [number, number, number] })),
    ]),
    leg: leg(),
  };

  // Runner: skinny, big head, antenna and a headband streaming behind.
  const ro = { torso: [0.22, 0.32] as [number, number], head: 0.3 };
  const rhy = headY(ro);
  models.runner = {
    body: merge([
      ...baseBody({ ...ro, armLen: 0.4 }),
      { geo: capsule(0.025, 0.3), pos: [0, rhy + 0.42, -0.05], rot: [-0.4, 0, 0] },
    ]),
    accent: merge([
      ...eyes(rhy + 0.04, 0.25, 0.13, 0.09),
      { geo: sphere(0.06), color: 0xff3d7f, pos: [0, rhy + 0.56, -0.12] },
      { geo: new THREE.TorusGeometry(0.29, 0.035, 6, 16), color: 0xff3d7f, pos: [0, rhy + 0.08, 0], rot: [Math.PI / 2, 0, 0] },
      { geo: box(0.06, 0.04, 0.35), color: 0xff3d7f, pos: [0.12, rhy + 0.05, -0.4], rot: [0.3, 0.3, 0] },
    ]),
    leg: leg(0.08),
  };

  // Blue: soldier with a steel helmet, glowing visor and a round shield.
  models.blue = {
    body: merge(baseBody()),
    accent: merge([
      { geo: new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color: METAL, pos: [0, hy + 0.02, 0] },
      { geo: box(0.64, 0.05, 0.64), color: METAL, pos: [0, hy + 0.02, 0] },
      { geo: box(0.36, 0.08, 0.06), color: 0x6ff7ff, pos: [0, hy - 0.04, 0.26] },
      { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.06, 16), color: METAL, pos: [-0.42, 0.85, 0.3], rot: [Math.PI / 2, 0, 0] },
      { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), color: 0x2a5bd7, pos: [-0.42, 0.85, 0.34], rot: [Math.PI / 2, 0, 0] },
    ]),
    leg: leg(0.1, METAL),
  };

  // Purple: horned demon with back spikes and a tail.
  models.purple = {
    body: merge([
      ...baseBody({ torso: [0.32, 0.3] }),
      { geo: capsule(0.05, 0.5), pos: [0, 0.6, -0.4], rot: [1.0, 0, 0] },
    ]),
    accent: merge([
      ...eyes(hy + 0.06, 0.22, 0.11, 0.07, GLOW),
      ...[-1, 1].map((s) => ({ geo: cone(0.07, 0.35, 8), color: BONE, pos: [s * 0.17, hy + 0.3, 0] as [number, number, number], rot: [0.3, 0, -s * 0.5] as [number, number, number] })),
      ...[0.75, 0.95, 1.15].map((y) => ({ geo: cone(0.06, 0.2, 5), color: BONE, pos: [0, y, -0.32] as [number, number, number], rot: [-1.3, 0, 0] as [number, number, number] })),
      { geo: cone(0.08, 0.16, 4), color: BONE, pos: [0, 0.38, -0.66], rot: [-2.2, 0, 0] },
    ]),
    leg: leg(0.11),
  };

  // Orange: armoured heavy with huge pauldrons, chest plate and a club.
  const oo = { torso: [0.36, 0.32] as [number, number], head: 0.25 };
  const ohy = headY(oo);
  models.orange = {
    body: merge(baseBody({ ...oo, armLen: 0.5 })),
    accent: merge([
      ...eyes(ohy + 0.02, 0.2, 0.1, 0.06),
      ...[-1, 1].map((s) => ({ geo: sphere(0.2, 10, 8), color: METAL, pos: [s * 0.42, 1.2, 0] as [number, number, number], scale: [1, 0.7, 1] as [number, number, number] })),
      ...[-1, 1].map((s) => ({ geo: cone(0.05, 0.18, 5), color: BONE, pos: [s * 0.45, 1.36, 0] as [number, number, number] })),
      { geo: box(0.5, 0.42, 0.12), color: METAL, pos: [0, 0.98, 0.3] },
      { geo: new THREE.CylinderGeometry(0.07, 0.12, 0.8, 8), color: 0x6b4423, pos: [0.5, 1.05, 0.55], rot: [-0.6, 0, 0] },
    ]),
    leg: leg(0.13, METAL),
  };

  // Red: brute with a heavy jaw, tusks, horns and spiked shoulders.
  models.red = {
    body: merge([
      ...baseBody({ torso: [0.38, 0.34], head: 0.28, armLen: 0.55 }),
      { geo: box(0.4, 0.18, 0.3), pos: [0, hy - 0.12, 0.1] },
    ]),
    accent: merge([
      ...eyes(hy + 0.08, 0.22, 0.12, 0.065, GLOW),
      ...[-1, 1].map((s) => ({ geo: cone(0.04, 0.18, 6), color: BONE, pos: [s * 0.13, hy - 0.04, 0.26] as [number, number, number] })),
      ...[-1, 1].map((s) => ({ geo: cone(0.09, 0.5, 8), color: 0x2a1a1a, pos: [s * 0.28, hy + 0.3, 0] as [number, number, number], rot: [0, 0, -s * 0.9] as [number, number, number] })),
      ...[-1, 1].flatMap((s) => [0, 1, 2].map((i) => ({ geo: cone(0.05, 0.22, 5), color: BONE, pos: [s * (0.4 + i * 0.05), 1.3 - i * 0.06, -0.08 + i * 0.08] as [number, number, number], rot: [0, 0, -s * 0.6] as [number, number, number] }))),
    ]),
    leg: leg(0.14),
  };

  // Boss: crowned warlord with a cape, glowing eyes and a gem on the chest.
  models.boss = {
    body: merge([
      ...baseBody({ torso: [0.36, 0.34], head: 0.28, armLen: 0.5 }),
    ]),
    accent: merge([
      ...eyes(hy + 0.06, 0.22, 0.11, 0.07, GLOW),
      { geo: new THREE.CylinderGeometry(0.24, 0.22, 0.1, 12), color: GOLD, pos: [0, hy + 0.27, 0] },
      ...Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return { geo: cone(0.05, 0.16, 4), color: GOLD, pos: [Math.sin(a) * 0.21, hy + 0.39, Math.cos(a) * 0.21] as [number, number, number] };
      }),
      { geo: new THREE.OctahedronGeometry(0.1), color: 0x7cf7ff, pos: [0, 1.0, 0.36] },
      { geo: box(0.9, 1.0, 0.04), color: 0x5a0d1a, pos: [0, 0.8, -0.38], rot: [-0.15, 0, 0] },
      ...[-1, 1].map((s) => ({ geo: sphere(0.18, 10, 8), color: GOLD, pos: [s * 0.42, 1.22, 0] as [number, number, number], scale: [1, 0.6, 1] as [number, number, number] })),
    ]),
    leg: leg(0.14, GOLD),
  };

  return models;
}

// The player: a chunky little trooper with a helmet, visor and backpack.
export function buildPlayer(): { root: THREE.Group; legs: THREE.Object3D[] } {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  const YELLOW = 0xffd23f, DARK = 0x2b2d42, VISOR = 0x4dd8ff;
  const torsoY = HIP_Y + 0.15 + 0.22;
  const hy = torsoY + 0.15 + 0.3 + 0.2;
  const body = new THREE.Mesh(merge([
    { geo: capsule(0.3, 0.3), color: YELLOW, pos: [0, torsoY, 0] },
    { geo: box(0.5, 0.12, 0.5), color: DARK, pos: [0, HIP_Y + 0.08, 0] },
    { geo: box(0.4, 0.5, 0.25), color: DARK, pos: [0, torsoY + 0.05, 0.3] }, // backpack (player faces -z)
    { geo: capsule(0.03, 0.3), color: DARK, pos: [0.12, torsoY + 0.45, 0.35] },
    { geo: sphere(0.28, 16, 12), color: YELLOW, pos: [0, hy, 0] },
    { geo: box(0.4, 0.14, 0.1), color: VISOR, pos: [0, hy + 0.02, -0.24] },
    ...[-1, 1].map((s) => ({ geo: capsule(0.08, 0.3), color: YELLOW, pos: [s * 0.33, torsoY + 0.05, -0.15] as [number, number, number], rot: [Math.PI / 2, 0, 0] as [number, number, number] })),
  ]), mat);
  body.castShadow = true;
  root.add(body);
  const legGeo = merge([
    { geo: capsule(0.1, HIP_Y - 0.2), color: DARK, pos: [0, -HIP_Y / 2, 0] },
    { geo: box(0.22, 0.12, 0.3), color: 0x111111, pos: [0, -HIP_Y + 0.05, -0.06] },
  ]);
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(legGeo, mat);
    l.position.set(s * 0.14, HIP_Y, 0);
    l.castShadow = true;
    root.add(l);
    return l;
  });
  return { root, legs };
}
