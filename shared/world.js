export const WORLD_SIZE = 480;
export const MAX_PLAYERS = 50;
export const TICK_RATE = 20;
export const SNAPSHOT_RATE = 10;
export const WEAPONS = {
  pistol: {
    name: "P9 Sidearm",
    damage: 23,
    interval: 0.32,
    mag: 12,
    reload: 1.5,
    range: 90,
    spread: 0.013,
    pellets: 1,
    color: "#c6d6d5",
  },
  rifle: {
    name: "AR-30 Ranger",
    damage: 25,
    interval: 0.12,
    mag: 30,
    reload: 2.2,
    range: 190,
    spread: 0.011,
    pellets: 1,
    color: "#bbf371",
  },
  smg: {
    name: "Viper SMG",
    damage: 17,
    interval: 0.075,
    mag: 32,
    reload: 1.8,
    range: 90,
    spread: 0.024,
    pellets: 1,
    color: "#67d7e7",
  },
  marksman: {
    name: "Scout DMR",
    damage: 49,
    interval: 0.65,
    mag: 8,
    reload: 2.7,
    range: 320,
    spread: 0.002,
    pellets: 1,
    color: "#d1a5ff",
  },
  shotgun: {
    name: "Breach-6",
    damage: 12,
    interval: 0.9,
    mag: 6,
    reload: 2.6,
    range: 50,
    spread: 0.09,
    pellets: 8,
    color: "#ffc37b",
  },
};
export const GUN_ORDER = Object.keys(WEAPONS);
export function random(seed = 42) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeWorld(seed = 90210) {
  const rng = random(seed),
    buildings = [],
    walls = [],
    trees = [],
    rocks = [],
    loot = [];
  const box = (x, y, z, w, h, d) => walls.push({ x, y, z, w, h, d });
  const towns = [
    { x: -90, z: -80, name: "NORTHFIELD" },
    { x: 80, z: -75, name: "RELAY STATION" },
    { x: -85, z: 85, name: "OLD QUARTER" },
    { x: 85, z: 85, name: "SOUTH DOCKS" },
  ];
  for (const [ti, t] of towns.entries())
    for (let j = 0; j < 6; j++) {
      const x = t.x + ((j % 3) - 1) * 29,
        z = t.z + (Math.floor(j / 3) - 0.5) * 32,
        w = 14 + rng() * 4,
        d = 12 + rng() * 3,
        h = 5;
      buildings.push({ x, z, w, d, h, tone: ti, roof: j % 2 });
      // Open doorway; collision and shots use the same walls. Windows are decorative.
      box(x - w / 2, h / 2, z, 0.6, h, d);
      box(x + w / 2, h / 2, z, 0.6, h, d);
      box(x, h / 2, z - d / 2, w, h, 0.6);
      box(x - w / 4 - 1, h / 2, z + d / 2, w / 2 - 2, h, 0.6);
      box(x + w / 4 + 1, h / 2, z + d / 2, w / 2 - 2, h, 0.6);
      box(x, 4.2, z + d / 2, 4, 1.6, 0.6);
      box(x, h + 0.15, z, w + 0.8, 0.3, d + 0.8);
      // A waist-high cover block behind each house.
      box(x + w / 2 + 4, 0.65, z - 3, 2.5, 1.3, 4);
      const gun = GUN_ORDER[1 + ((j + ti) % 4)];
      loot.push({ id: `gun-${ti}-${j}`, x, z, y: 0.3, kind: gun });
      loot.push({
        id: `supply-${ti}-${j}`,
        x: x - 3,
        z: z + 2,
        y: 0.3,
        kind: ["ammo", "medkit", "armor"][j % 3],
      });
      loot.push({
        id: `street-${ti}-${j}`,
        x: x + 3,
        z: z + d / 2 + 5,
        y: 0.3,
        kind: j % 2 ? "ammo" : "medkit",
      });
    }
  for (let i = 0; i < 160; i++) {
    const x = (rng() - 0.5) * 430,
      z = (rng() - 0.5) * 430;
    if (
      Math.abs(x) < 13 ||
      Math.abs(z) < 13 ||
      buildings.some(
        (b) =>
          Math.abs(x - b.x) < b.w / 2 + 8 && Math.abs(z - b.z) < b.d / 2 + 8,
      )
    )
      continue;
    trees.push({ x, z, h: 5 + rng() * 6 });
    box(x, 1.7, z, 0.8, 3.4, 0.8);
  }
  for (let i = 0; i < 32; i++) {
    const x = (rng() - 0.5) * 410,
      z = (rng() - 0.5) * 410;
    if (
      buildings.some(
        (b) => Math.abs(x - b.x) < b.w && Math.abs(z - b.z) < b.d,
      ) ||
      Math.abs(x) < 15 ||
      Math.abs(z) < 15
    )
      continue;
    const s = 1.4 + rng() * 2;
    rocks.push({ x, z, s });
    box(x, s * 0.5, z, s * 1.5, s, s * 1.5);
  }
  // Supplies alongside the flight corridor make the first landing approachable.
  for (let i = 0; i < 16; i++)
    loot.push({
      id: `field-${i}`,
      x: (i - 8) * 20,
      z: i % 2 ? 18 : -18,
      y: 0.3,
      kind: GUN_ORDER[1 + (i % 4)],
    });
  return { seed, buildings, walls, trees, rocks, loot, towns };
}
export const WORLD = makeWorld();
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function collides(x, y, z, r = 0.4) {
  return WORLD.walls.some(
    (b) =>
      y < b.y + b.h / 2 &&
      y + 1.7 > b.y - b.h / 2 &&
      x + r > b.x - b.w / 2 &&
      x - r < b.x + b.w / 2 &&
      z + r > b.z - b.d / 2 &&
      z - r < b.z + b.d / 2,
  );
}
export function rayBox(o, d, b) {
  let near = 0,
    far = Infinity;
  for (const [axis, size] of [
    ["x", "w"],
    ["y", "h"],
    ["z", "d"],
  ]) {
    const lo = b[axis] - b[size] / 2,
      hi = b[axis] + b[size] / 2;
    if (Math.abs(d[axis]) < 1e-8) {
      if (o[axis] < lo || o[axis] > hi) return Infinity;
      continue;
    }
    let a = (lo - o[axis]) / d[axis],
      c = (hi - o[axis]) / d[axis];
    if (a > c) [a, c] = [c, a];
    near = Math.max(near, a);
    far = Math.min(far, c);
    if (near > far) return Infinity;
  }
  return near;
}
export function raySphere(o, d, c, r) {
  const x = o.x - c.x,
    y = o.y - c.y,
    z = o.z - c.z,
    b = x * d.x + y * d.y + z * d.z,
    k = x * x + y * y + z * z - r * r,
    q = b * b - k;
  if (q < 0) return Infinity;
  const t = -b - Math.sqrt(q);
  return t >= 0 ? t : Infinity;
}
