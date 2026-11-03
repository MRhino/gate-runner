import * as THREE from 'three';
import { merge, type Part } from './models';

// Weapon types. Your whole squad carries the same weapon; weapon crates let you swap.
// Each trades fire rate against damage per hit, and some add area or piercing damage.
export type WeaponKind = 'blaster' | 'gatling' | 'rocket' | 'rail';

export type Weapon = {
  name: string;
  rate: number;     // fire-rate multiplier
  dmg: number;      // damage-per-hit multiplier
  speed: number;    // projectile speed multiplier
  splash: number;   // area radius (rockets); 0 = none
  pierce: boolean;  // passes through enemies (railgun)
  jitter: number;   // sideways scatter in units (gatling)
  // Rough multiplier on effective DPS from splash/pierce, used by the difficulty director.
  crowdFactor: number;
  color: number;    // UI / crate colour
};

export const WEAPONS: Record<WeaponKind, Weapon> = {
  blaster: { name: 'BLASTER', rate: 1, dmg: 1, speed: 1, splash: 0, pierce: false, jitter: 0, crowdFactor: 1, color: 0x4de8ff },
  gatling: { name: 'GATLING', rate: 2.6, dmg: 0.42, speed: 1.25, splash: 0, pierce: false, jitter: 0.12, crowdFactor: 1, color: 0xffc83d },
  rocket: { name: 'ROCKETS', rate: 0.32, dmg: 2.4, speed: 0.6, splash: 1.7, pierce: false, jitter: 0, crowdFactor: 1.7, color: 0xff7a30 },
  rail: { name: 'RAILGUN', rate: 0.42, dmg: 2.6, speed: 2.4, splash: 0, pierce: true, jitter: 0, crowdFactor: 1.5, color: 0xc070ff },
};
export const WEAPON_KINDS = Object.keys(WEAPONS) as WeaponKind[];

const GUNMETAL = 0x3a3f55, STEEL = 0x9aa4b8, DARK = 0x1c1e28, YELLOW = 0xffc83d;
const cyl = (rt: number, rb: number, h: number, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s).rotateX(Math.PI / 2);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const tor = (r: number, t: number) => new THREE.TorusGeometry(r, t, 6, 18);

// Gun models, built along -z from the grip (z = 0). `detail` lowers segment counts for squad mates.
// Returns the merged geometry, the muzzle z, and (gatling) the spinning barrel cluster separately.
export function buildWeaponGeo(kind: WeaponKind, detail = 1): { gun: THREE.BufferGeometry; spin?: THREE.BufferGeometry; muzzleZ: number } {
  const s = (n: number) => Math.max(6, Math.round(n * detail));
  const glow = (color: number, k = 2.2): Pick<Part, 'color' | 'k'> => ({ color, k });
  switch (kind) {
    case 'blaster':
      return {
        muzzleZ: -0.95,
        gun: merge([
          { geo: box(0.2, 0.15, 0.42), color: GUNMETAL, pos: [0, 0, -0.22] },
          { geo: box(0.21, 0.04, 0.3), color: YELLOW, pos: [0, 0.08, -0.26] },
          { geo: box(0.08, 0.16, 0.1), color: DARK, pos: [0, -0.13, -0.1] }, // grip
          { geo: cyl(0.05, 0.06, 0.55, s(16)), color: STEEL, pos: [0, 0.01, -0.62] },
          ...[-0.5, -0.65].map((z): Part => ({ geo: tor(0.064, 0.014), color: GUNMETAL, pos: [0, 0.01, z] })),
          { geo: cyl(0.068, 0.068, 0.05, s(16)), pos: [0, 0.01, -0.82], ...glow(0x4de8ff) },
          { geo: box(0.04, 0.05, 0.16), color: DARK, pos: [0, 0.11, -0.12] }, // sight
          { geo: box(0.025, 0.025, 0.03), pos: [0, 0.14, -0.12], ...glow(0xff4040) },
        ]),
      };
    case 'gatling': {
      // Six barrels around an axis; spun separately so it visibly whirs when firing.
      const barrels: Part[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        barrels.push({ geo: cyl(0.025, 0.025, 0.7, s(10)), color: STEEL, pos: [Math.cos(a) * 0.07, Math.sin(a) * 0.07, -0.35] });
      }
      barrels.push(
        ...[-0.1, -0.45, -0.68].map((z): Part => ({ geo: cyl(0.11, 0.11, 0.04, s(16)), color: GUNMETAL, pos: [0, 0, z] })),
        { geo: cyl(0.03, 0.03, 0.72, s(8)), color: DARK, pos: [0, 0, -0.36] },
      );
      return {
        muzzleZ: -1.05,
        spin: merge(barrels),
        gun: merge([
          { geo: box(0.26, 0.22, 0.38), color: GUNMETAL, pos: [0, 0, -0.18] },
          { geo: box(0.27, 0.05, 0.3), color: YELLOW, pos: [0, 0.12, -0.2] },
          { geo: cyl(0.13, 0.13, 0.14, s(18)), color: DARK, pos: [0, 0, -0.4] },
          { geo: box(0.18, 0.2, 0.22), color: 0x6b5a2a, pos: [0.2, -0.08, -0.1] }, // ammo box
          { geo: box(0.08, 0.16, 0.1), color: DARK, pos: [0, -0.16, -0.06] },
          { geo: cyl(0.02, 0.02, 0.1, s(8)), pos: [0.14, 0.08, -0.38], ...glow(0xffc83d) },
        ]),
      };
    }
    case 'rocket':
      return {
        muzzleZ: -0.95,
        gun: merge([
          { geo: cyl(0.13, 0.13, 0.95, s(20)), color: 0x4a5a3a, pos: [0, 0.06, -0.4] }, // tube
          { geo: cyl(0.155, 0.13, 0.12, s(20)), color: GUNMETAL, pos: [0, 0.06, -0.9] }, // muzzle flare
          { geo: cyl(0.14, 0.155, 0.14, s(20)), color: GUNMETAL, pos: [0, 0.06, 0.1] }, // rear exhaust
          ...[-0.15, -0.55].map((z): Part => ({ geo: tor(0.135, 0.018), color: YELLOW, pos: [0, 0.06, z] })),
          { geo: box(0.08, 0.16, 0.1), color: DARK, pos: [0, -0.12, -0.15] },
          { geo: box(0.06, 0.08, 0.2), color: DARK, pos: [0.14, 0.18, -0.3] }, // optic
          { geo: cyl(0.03, 0.03, 0.02, s(10)), pos: [0.14, 0.18, -0.41], ...glow(0xff6020) },
          { geo: new THREE.ConeGeometry(0.1, 0.18, s(14)).rotateX(-Math.PI / 2), color: 0xd04020, pos: [0, 0.06, -0.97] }, // loaded warhead
        ]),
      };
    case 'rail':
      return {
        muzzleZ: -1.15,
        gun: merge([
          { geo: box(0.18, 0.16, 0.5), color: 0x2a2a3a, pos: [0, 0, -0.25] },
          { geo: box(0.08, 0.16, 0.1), color: DARK, pos: [0, -0.15, -0.08] },
          ...[-1, 1].map((sd): Part => ({ geo: box(0.035, 0.07, 0.75), color: STEEL, pos: [sd * 0.06, 0.02, -0.75] })), // twin rails
          ...[-0.55, -0.72, -0.89, -1.06].map((z): Part => ({ geo: box(0.17, 0.11, 0.03), pos: [0, 0.02, z], ...glow(0xc070ff, 2.4) })), // coils
          { geo: box(0.19, 0.04, 0.36), color: 0xc070ff, pos: [0, 0.1, -0.24] },
          { geo: cyl(0.04, 0.04, 0.22, s(10)), color: DARK, pos: [0, 0.14, -0.1] }, // scope
        ]),
      };
  }
}
