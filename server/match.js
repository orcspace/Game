import {
  WORLD,
  WEAPONS,
  GUN_ORDER,
  collides,
  rayBox,
  raySphere,
  clamp,
  random,
} from "../shared/world.js";

export function makePlayer(id, name, bot = false) {
  return {
    id,
    name,
    bot,
    x: 0,
    y: 90,
    z: 0,
    yaw: 0,
    pitch: 0,
    hp: 100,
    armor: 0,
    alive: true,
    phase: "plane",
    kills: 0,
    weapon: "pistol",
    inventory: { pistol: { ammo: 12, reserve: 48 } },
    medkits: 1,
    input: {},
    inputAt: 0,
    lastShot: -99,
    reloadEnd: 0,
    healEnd: 0,
    botNext: 0,
    seq: 0,
  };
}
export class Match {
  constructor(
    players,
    {
      seed = Date.now(),
      countdown = 5,
      zoneDelay = 45,
      zoneDuration = 300,
    } = {},
  ) {
    this.players = new Map(players.map((p) => [p.id, p]));
    this.time = 0;
    this.status = "countdown";
    this.countdown = countdown;
    this.zoneDelay = zoneDelay;
    this.zoneDuration = zoneDuration;
    this.zone = { x: 0, z: 0, r: 230, damage: 2, closing: false };
    this.loot = WORLD.loot.map((l) => ({ ...l }));
    this.lootVersion = 0;
    this.events = [];
    this.rng = random(seed);
    this.winner = null;
    this.flight = 0;
    for (const p of players)
      if (p.bot) {
        p.weapon = "rifle";
        p.inventory.rifle = { ammo: 30, reserve: 180 };
        p.dropAt = 2 + this.rng() * 19;
      }
  }
  event(type, data = {}) {
    this.events.push({ type, ...data });
    if (this.events.length > 160) this.events.shift();
  }
  setInput(p, data) {
    if (!data || typeof data !== "object") return;
    for (const k of ["yaw", "pitch"]) if (!Number.isFinite(data[k])) return;
    p.input = {
      forward: Number.isFinite(data.forward) ? clamp(data.forward, -1, 1) : 0,
      right: Number.isFinite(data.right) ? clamp(data.right, -1, 1) : 0,
      sprint: data.sprint === true,
      fire: data.fire === true,
      aim: data.aim === true,
    };
    p.yaw = data.yaw % (Math.PI * 2);
    p.pitch = clamp(data.pitch, -1.35, 1.35);
    p.inputAt = this.time;
    p.seq = Number.isSafeInteger(data.seq) ? data.seq : 0;
  }
  action(p, type, value) {
    if (!p.alive || this.status !== "playing") return;
    if (type === "drop" && p.phase === "plane") {
      p.phase = "fall";
      return;
    }
    if (type === "chute" && p.phase === "fall") {
      p.phase = "chute";
      return;
    }
    if (p.phase !== "ground") return;
    if (type === "reload") this.reload(p);
    if (
      type === "heal" &&
      p.medkits > 0 &&
      p.hp < 100 &&
      !p.healEnd &&
      !p.reloadEnd
    ) {
      p.healEnd = this.time + 3;
      p.input.fire = false;
    }
    if (
      type === "equip" &&
      typeof value === "string" &&
      Object.hasOwn(WEAPONS, value) &&
      Object.hasOwn(p.inventory, value)
    ) {
      p.weapon = value;
      p.reloadEnd = 0;
      p.healEnd = 0;
    }
    if (type === "pickup") {
      let best = null,
        dist = 2.8;
      for (const l of this.loot) {
        const d = Math.hypot(l.x - p.x, l.z - p.z);
        if (d < dist) {
          best = l;
          dist = d;
        }
      }
      if (!best) return;
      // Prevent pickups through walls, even within interaction distance.
      const o = { x: p.x, y: 1, z: p.z },
        d = {
          x: (best.x - p.x) / Math.max(dist, 0.001),
          y: 0,
          z: (best.z - p.z) / Math.max(dist, 0.001),
        };
      if (WORLD.walls.some((b) => rayBox(o, d, b) < dist)) return;
      if (best.kind === "medkit") {
        if (p.medkits >= 5) return;
        p.medkits++;
      } else if (best.kind === "armor") {
        if (p.armor >= 100) return;
        p.armor = 100;
      } else if (best.kind === "ammo") {
        for (const [k, v] of Object.entries(p.inventory))
          v.reserve = Math.min(300, v.reserve + WEAPONS[k].mag * 2);
      } else if (WEAPONS[best.kind]) {
        const w = WEAPONS[best.kind];
        if (p.inventory[best.kind])
          p.inventory[best.kind].reserve = Math.min(
            300,
            p.inventory[best.kind].reserve + w.mag * 2,
          );
        else p.inventory[best.kind] = { ammo: w.mag, reserve: w.mag * 3 };
        p.weapon = best.kind;
        p.reloadEnd = 0;
      }
      this.loot.splice(this.loot.indexOf(best), 1);
      this.lootVersion++;
      this.event("pickup", { player: p.id, kind: best.kind });
    }
  }
  reload(p) {
    const a = p.inventory[p.weapon],
      w = WEAPONS[p.weapon];
    if (!p.reloadEnd && a.ammo < w.mag && a.reserve > 0) {
      p.reloadEnd = this.time + w.reload;
      p.healEnd = 0;
    }
  }
  damage(p, amount, source = null, head = false) {
    if (!p.alive) return;
    const absorbed = Math.min(p.armor, amount * 0.5);
    p.armor -= absorbed;
    p.hp = Math.max(0, p.hp - (amount - absorbed));
    p.healEnd = 0;
    if (source)
      this.event("hit", {
        player: source.id,
        target: p.id,
        damage: Math.round(amount - absorbed),
        head,
      });
    if (p.hp === 0) {
      p.alive = false;
      p.input = {};
      p.reloadEnd = 0;
      if (source) source.kills++;
      this.event("kill", {
        killer: source?.name || "The zone",
        victim: p.name,
        player: p.id,
      });
      if (p.phase === "ground") {
        this.loot.push({
          id: `drop-${p.id}`,
          x: p.x,
          z: p.z,
          y: 0.3,
          kind: p.weapon,
        });
        this.lootVersion++;
      }
    }
  }
  shoot(p) {
    if (p.phase !== "ground" || p.reloadEnd || p.healEnd) return;
    const w = WEAPONS[p.weapon],
      a = p.inventory[p.weapon];
    if (this.time - p.lastShot < w.interval) return;
    if (a.ammo <= 0) {
      this.reload(p);
      return;
    }
    a.ammo--;
    p.lastShot = this.time;
    const origin = { x: p.x, y: p.y + 1.55, z: p.z };
    let end = null;
    for (let i = 0; i < w.pellets; i++) {
      const spread = w.spread * (p.input.aim ? 0.45 : 1),
        yaw = p.yaw + (this.rng() - 0.5) * spread,
        pitch = p.pitch + (this.rng() - 0.5) * spread;
      const d = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y: Math.sin(pitch),
        z: -Math.cos(yaw) * Math.cos(pitch),
      };
      let distance = w.range,
        target = null,
        head = false;
      for (const b of WORLD.walls)
        distance = Math.min(distance, rayBox(origin, d, b));
      if (d.y < 0) distance = Math.min(distance, -origin.y / d.y);
      for (const other of this.players.values())
        if (other !== p && other.alive && other.phase !== "plane") {
          const th = raySphere(
              origin,
              d,
              { x: other.x, y: other.y + 1.5, z: other.z },
              0.28,
            ),
            tb = raySphere(
              origin,
              d,
              { x: other.x, y: other.y + 0.8, z: other.z },
              0.53,
            );
          const t = Math.min(th, tb);
          if (t < distance) {
            distance = t;
            target = other;
            head = th < tb;
          }
        }
      if (target)
        this.damage(
          target,
          w.damage * (head ? 1.7 : 1) * (distance > w.range * 0.65 ? 0.8 : 1),
          p,
          head,
        );
      end = {
        x: origin.x + d.x * distance,
        y: origin.y + d.y * distance,
        z: origin.z + d.z * distance,
      };
    }
    this.event("shot", {
      player: p.id,
      weapon: p.weapon,
      from: origin,
      to: end,
    });
  }
  move(p, dt) {
    const i = p.input,
      len = Math.hypot(i.forward || 0, i.right || 0) || 1,
      f = (i.forward || 0) / Math.max(1, len),
      r = (i.right || 0) / Math.max(1, len);
    const speed =
      p.phase === "ground"
        ? p.healEnd
          ? 0
          : i.sprint
            ? 8.5
            : i.aim
              ? 3
              : 5.4
        : p.phase === "chute"
          ? 11
          : 7;
    const dx = (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * r) * speed * dt,
      dz = (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * r) * speed * dt;
    const x = clamp(p.x + dx, -234, 234),
      z = clamp(p.z + dz, -234, 234);
    if (!collides(x, p.y, p.z)) p.x = x;
    if (!collides(p.x, p.y, z)) p.z = z;
    if (p.phase === "fall" || p.phase === "chute") {
      if (p.y < 35) p.phase = "chute";
      const y = Math.max(0, p.y - (p.phase === "fall" ? 18 : 6) * dt);
      // Push a descending player clear of roofs, avoiding trapped roof spawns.
      if (collides(p.x, y, p.z)) {
        const b = WORLD.buildings.find(
          (b) =>
            Math.abs(p.x - b.x) < b.w / 2 + 1 &&
            Math.abs(p.z - b.z) < b.d / 2 + 1,
        );
        if (b) p.z = b.z + b.d / 2 + 2;
        else p.x = clamp(p.x + 2, -233, 233);
      }
      p.y = y;
      if (p.y === 0) {
        p.phase = "ground";
        this.event("land", { player: p.id });
      }
    }
  }
  bot(p) {
    if (p.phase === "plane") {
      if (this.flight >= p.dropAt) p.phase = "fall";
      return;
    }
    if (p.phase !== "ground") {
      p.yaw = Math.sin(p.dropAt) * 3;
      p.input = { forward: 1 };
      return;
    }
    if (this.time < p.botNext) return;
    p.botNext = this.time + 0.25;
    let target = null,
      best = 110;
    for (const q of this.players.values())
      if (q !== p && q.alive && q.phase === "ground") {
        const dist = Math.hypot(q.x - p.x, q.z - p.z);
        if (dist < best) {
          const o = { x: p.x, y: 1.5, z: p.z },
            d = { x: (q.x - p.x) / dist, y: 0, z: (q.z - p.z) / dist };
          if (!WORLD.walls.some((b) => rayBox(o, d, b) < dist)) {
            target = q;
            best = dist;
          }
        }
      }
    const outside = Math.hypot(p.x, p.z) > this.zone.r * 0.75;
    const tx =
        target && !outside
          ? target.x
          : Math.sin(p.dropAt) * Math.min(60, this.zone.r * 0.35),
      tz =
        target && !outside
          ? target.z
          : Math.cos(p.dropAt) * Math.min(60, this.zone.r * 0.35);
    p.yaw =
      Math.atan2(-(tx - p.x), -(tz - p.z)) +
      (target ? (this.rng() - 0.5) * 0.12 : 0);
    p.pitch = target ? Math.atan2(target.y - p.y, Math.max(1, best)) : 0;
    p.input = {
      forward: target && !outside && best < 30 ? 0 : 1,
      right: target ? (this.rng() > 0.5 ? 0.7 : -0.7) : 0,
      fire: !!target && !outside,
      aim: true,
      sprint: outside,
    };
    if (collides(p.x - Math.sin(p.yaw) * 2, 0, p.z - Math.cos(p.yaw) * 2)) {
      p.yaw += 1.25;
      p.input.fire = false;
    }
    if (p.hp < 45 && p.medkits && !target) this.action(p, "heal");
    if (p.inventory[p.weapon].ammo === 0) this.reload(p);
    this.action(p, "pickup");
  }
  update(dt) {
    if (this.status === "finished") return;
    this.time += dt;
    if (this.time < this.countdown) return;
    this.status = "playing";
    this.flight = this.time - this.countdown;
    const t = clamp((this.flight - this.zoneDelay) / this.zoneDuration, 0, 1);
    this.zone = {
      x: 0,
      z: 0,
      r: 230 * (1 - t),
      damage: 2 + 8 * t,
      closing: t > 0,
    };
    for (const p of this.players.values())
      if (p.alive) {
        if (p.bot) this.bot(p);
        else if (this.time - p.inputAt > 0.5) p.input = {};
        if (p.phase === "plane") {
          p.x = -210 + Math.min(1, this.flight / 24) * 420;
          p.z = 0;
          if (this.flight >= 24) p.phase = "fall";
        } else this.move(p, dt);
        if (p.phase === "ground") {
          if (p.reloadEnd && this.time >= p.reloadEnd) {
            const a = p.inventory[p.weapon],
              take = Math.min(WEAPONS[p.weapon].mag - a.ammo, a.reserve);
            a.ammo += take;
            a.reserve -= take;
            p.reloadEnd = 0;
          }
          if (p.healEnd && this.time >= p.healEnd) {
            p.hp = Math.min(100, p.hp + 65);
            p.medkits--;
            p.healEnd = 0;
          }
          if (p.input.fire) this.shoot(p);
        }
        if (
          p.phase !== "plane" &&
          (Math.hypot(p.x, p.z) > this.zone.r || this.zone.r === 0)
        )
          this.damage(p, this.zone.damage * dt);
      }
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length <= 1 && this.flight > 1) {
      this.status = "finished";
      this.winner = alive[0]?.name || null;
      this.event("finished", { winner: this.winner });
    }
  }
  snapshot() {
    return {
      status: this.status,
      time: this.time,
      countdown: this.countdown,
      flight: this.flight,
      zone: this.zone,
      winner: this.winner,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        x: round(p.x),
        y: round(p.y),
        z: round(p.z),
        yaw: round(p.yaw),
        pitch: round(p.pitch),
        alive: p.alive,
        phase: p.phase,
        hp: Math.ceil(p.hp),
        armor: Math.ceil(p.armor),
        weapon: p.weapon,
        kills: p.kills,
      })),
      loot: this.loot,
    };
  }
  privateState(p) {
    return {
      inventory: p.inventory,
      medkits: p.medkits,
      reload: Math.max(0, p.reloadEnd - this.time),
      heal: Math.max(0, p.healEnd - this.time),
      seq: p.seq,
    };
  }
}
function round(n) {
  return Math.round(n * 1000) / 1000;
}
