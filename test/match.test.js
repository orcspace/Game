import test from "node:test";
import assert from "node:assert/strict";
import { Match, makePlayer } from "../server/match.js";
import { WORLD, WEAPONS, collides, rayBox } from "../shared/world.js";
function setup() {
  const p = makePlayer("a", "Alpha"),
    q = makePlayer("b", "Bravo");
  const m = new Match([p, q], { seed: 1, countdown: 0 });
  m.status = "playing";
  for (const v of [p, q]) {
    v.phase = "ground";
    v.x = 0;
    v.y = 0;
    v.z = -30;
  }
  q.z = -50;
  return { m, p, q };
}
test("inputs cannot teleport, inject NaN, exploit object coercion, or equip prototype keys", () => {
  const { m, p } = setup();
  m.setInput(p, {
    yaw: 0,
    pitch: 0,
    forward: 1e9,
    right: 0,
    x: 9999,
    hp: 9999,
  });
  m.update(0.05);
  assert(p.z >= -30 - 0.5);
  assert.equal(p.hp, 100);
  assert.equal(p.x, 0);
  m.setInput(p, { yaw: NaN, pitch: 0, forward: 1 });
  assert(Number.isFinite(p.yaw));
  m.setInput(p, { yaw: 0, pitch: 0, forward: { toString: null }, right: {} });
  assert.equal(p.input.forward, 0);
  for (const key of ["__proto__", "constructor", "toString"])
    m.action(p, "equip", key);
  assert.equal(p.weapon, "pistol");
});
test("damage, headshots, armour, server fire cadence and ammunition", () => {
  const { m, p, q } = setup();
  q.armor = 100;
  m.shoot(p);
  assert(q.hp < 100 && q.hp > 65);
  assert(q.armor < 100);
  assert.equal(p.inventory.pistol.ammo, 11);
  const hp = q.hp;
  m.shoot(p);
  assert.equal(q.hp, hp);
  assert.equal(p.inventory.pistol.ammo, 11);
  m.time += 1;
  m.shoot(p);
  assert(q.hp < hp);
  assert(m.events.some((e) => e.type === "hit" && e.head));
});
test("building wall blocks a bullet; open doorway remains walkable", () => {
  const { m, p, q } = setup(),
    b = WORLD.buildings[0];
  p.x = b.x;
  p.z = b.z - b.d / 2 - 4;
  p.yaw = Math.PI;
  q.x = b.x;
  q.z = b.z;
  m.shoot(p);
  assert.equal(q.hp, 100);
  assert.equal(collides(b.x, 0, b.z + b.d / 2), false);
  assert.equal(collides(b.x - b.w / 2, 0, b.z), true);
});
test("reload transfers reserve only when complete, medkit heals and is consumed", () => {
  const { m, p } = setup();
  p.inventory.pistol.ammo = 0;
  m.action(p, "reload");
  m.update(1);
  assert.equal(p.inventory.pistol.ammo, 0);
  m.update(1);
  assert.equal(p.inventory.pistol.ammo, 12);
  assert.equal(p.inventory.pistol.reserve, 36);
  p.hp = 20;
  m.action(p, "heal");
  m.update(2);
  assert.equal(p.hp, 20);
  m.update(1.1);
  assert.equal(p.hp, 85);
  assert.equal(p.medkits, 0);
});
test("healing cancels on damage and weapon switch", () => {
  const { m, p } = setup();
  p.hp = 50;
  m.action(p, "heal");
  m.damage(p, 1);
  assert.equal(p.healEnd, 0);
  assert.equal(p.medkits, 1);
  m.action(p, "heal");
  m.action(p, "equip", "pistol");
  assert.equal(p.healEnd, 0);
});
test("loot grants a weapon once; pickups cannot cross a wall", () => {
  const { m, p } = setup(),
    l = m.loot.find((l) => l.kind === "rifle"),
    b = WORLD.buildings[0];
  p.x = l.x;
  p.z = l.z;
  m.action(p, "pickup");
  assert(p.inventory.rifle);
  assert.equal(p.weapon, "rifle");
  assert(!m.loot.includes(l));
  m.loot = [
    { id: "blocked", kind: "armor", x: b.x - b.w / 2 + 0.7, z: b.z, y: 0.3 },
  ];
  p.x = b.x - b.w / 2 - 0.7;
  p.z = b.z;
  m.action(p, "pickup");
  assert.equal(p.armor, 0);
  assert.equal(m.loot.length, 1);
});
test("drop transitions through automatic parachute to a safe landing", () => {
  const p = makePlayer("a", "A"),
    q = makePlayer("b", "B"),
    m = new Match([p, q], { countdown: 0 });
  m.update(0.05);
  m.action(p, "drop");
  assert.equal(p.phase, "fall");
  let chute = false;
  for (let i = 0; i < 400; i++) {
    m.update(0.05);
    if (p.phase === "chute") chute = true;
  }
  assert(chute);
  assert.equal(p.phase, "ground");
  assert.equal(p.y, 0);
  assert(!collides(p.x, p.y, p.z));
});
test("zone shrinks, damages outsiders, and match resolves a winner", () => {
  const { p, q } = setup(),
    m = new Match([p, q], { countdown: 0, zoneDelay: 0, zoneDuration: 10 });
  p.x = 0;
  p.z = 0;
  q.x = 225;
  q.z = 225;
  for (let i = 0; i < 180; i++) m.update(0.05);
  assert(m.zone.r < 30);
  assert(q.hp < 100);
  m.damage(q, 1000, p);
  m.update(0.05);
  assert.equal(m.status, "finished");
  assert.equal(m.winner, p.name);
  assert.equal(p.kills, 1);
});
test("zero-radius zone also damages the exact center, preventing endless ties", () => {
  const { p, q } = setup(),
    m = new Match([p, q], { countdown: 0, zoneDelay: 0, zoneDuration: 0.1 });
  p.x = q.x = 0;
  p.z = q.z = 0;
  m.update(0.2);
  assert(p.hp < 100 && q.hp < 100);
});
test("ray box handles parallel rays and rejects misses", () => {
  const b = { x: 0, y: 1, z: -10, w: 2, h: 2, d: 2 };
  assert.equal(rayBox({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, b), 9);
  assert.equal(
    rayBox({ x: 3, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, b),
    Infinity,
  );
});
test("full 50-player bot simulation stays finite and reaches a terminal state", () => {
  const p = makePlayer("human", "Tester");
  p.alive = false;
  p.hp = 0;
  const bots = Array.from({ length: 49 }, (_, i) =>
    makePlayer("bot-" + i, "Bot " + i, true),
  );
  const m = new Match([p, ...bots], {
    seed: 57,
    countdown: 0,
    zoneDelay: 1,
    zoneDuration: 35,
  });
  for (let i = 0; i < 1800 && m.status !== "finished"; i++) m.update(0.05);
  assert.equal(m.status, "finished");
  for (const p of m.players.values()) {
    assert(
      Number.isFinite(p.hp) && Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    assert(p.inventory[p.weapon].ammo >= 0);
    assert(p.inventory[p.weapon].ammo <= WEAPONS[p.weapon].mag);
  }
});
