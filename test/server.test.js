import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createGameServer } from "../server/index.js";
async function client(url) {
  const ws = new WebSocket(url),
    queue = [],
    waiters = [];
  ws.on("message", (data) => {
    const m = JSON.parse(data);
    queue.push(m);
    for (const check of [...waiters]) check();
  });
  const wait = (type, predicate = () => true, timeout = 4000) =>
    new Promise((resolve, reject) => {
      let timer;
      const check = () => {
        const i = queue.findIndex((m) => m.type === type && predicate(m));
        if (i < 0) return;
        const m = queue.splice(i, 1)[0];
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(check), 1);
        resolve(m);
      };
      waiters.push(check);
      timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(check), 1);
        reject(Error("Timeout: " + type));
      }, timeout);
      check();
    });
  const hello = await wait("hello");
  return { ws, id: hello.id, send: (m) => ws.send(JSON.stringify(m)), wait };
}
test("multiplayer lobby lifecycle, password, host authority, authoritative snapshot, host transfer", async () => {
  const app = createGameServer();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`,
    url = base.replace("http", "ws") + "/ws";
  try {
    const a = await client(url),
      b = await client(url),
      c = await client(url);
    a.send({
      type: "create",
      name: "Host",
      password: "test-password",
      bots: 0,
    });
    const room = await a.wait("lobby");
    assert.equal(room.locked, true);
    assert(!JSON.stringify(room).includes("test-password"));
    b.send({ type: "join", name: "Guest", code: room.code, password: "wrong" });
    assert.match((await b.wait("error")).message, /password/i);
    b.send({
      type: "join",
      name: "Guest",
      code: room.code,
      password: "test-password",
    });
    await b.wait("lobby", (m) => m.players.length === 2);
    b.send({ type: "start" });
    assert.match((await b.wait("error")).message, /host/i);
    a.send({ type: "start" });
    await b.wait("started");
    const s = await b.wait("snapshot");
    assert.equal(s.players.length, 2);
    assert.equal(s.self.inventory.pistol.ammo, 12);
    c.send({
      type: "join",
      name: "Late",
      code: room.code,
      password: "test-password",
    });
    assert.match((await c.wait("error")).message, /started/i);
    a.ws.close();
    const migrated = await b.wait("lobby", (m) => m.host === b.id);
    assert.equal(migrated.players.length, 1);
    const health = await fetch(base + "/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    for (const file of [
      "/",
      "/main.js",
      "/shared/world.js",
      "/vendor/three.module.js",
      "/vendor/three.core.js",
    ])
      assert.equal((await fetch(base + file)).status, 200, file);
    assert.equal((await fetch(base + "/server/index.js")).status, 404);
    assert.equal((await fetch(base + "/%2e%2e%2fpackage.json")).status, 404);
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
  } finally {
    await app.close();
  }
});
test("50 real sockets can join one lobby; a 51st cannot; oversized payload closes socket", async () => {
  const app = createGameServer();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${app.server.address().port}/ws`;
  try {
    const host = await client(url);
    host.send({ type: "create", name: "Host", bots: 0 });
    const { code } = await host.wait("lobby");
    const clients = await Promise.all(
      Array.from({ length: 50 }, () => client(url)),
    );
    for (let i = 0; i < 49; i++) {
      clients[i].send({ type: "join", name: "P" + i, code });
      await clients[i].wait("lobby");
    }
    clients[49].send({ type: "join", name: "Extra", code });
    assert.match((await clients[49].wait("error")).message, /full/);
    host.send({ type: "start" });
    const snap = await clients[48].wait("snapshot");
    assert.equal(snap.players.length, 50);
    assert(
      Array.isArray(snap.loot),
      "First snapshot must include the loot map",
    );
    const delta = await clients[48].wait("snapshot", (m) => m.time > snap.time);
    assert.equal(
      delta.loot,
      undefined,
      "Unchanged loot should not be retransmitted",
    );
    for (const c of clients.slice(0, 49))
      c.send({
        type: "input",
        yaw: 0,
        pitch: 0,
        forward: { toString: null },
        hp: 9999,
      });
    const close = new Promise((r) =>
      clients[49].ws.once("close", (code) => r(code)),
    );
    clients[49].ws.send("x".repeat(5000));
    assert.equal(await close, 1009);
  } finally {
    await app.close();
  }
});
test("cross-origin websocket upgrade is rejected", async () => {
  const app = createGameServer();
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const status = await new Promise((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${app.server.address().port}/ws`,
        { origin: "https://untrusted.example" },
      );
      ws.on("unexpected-response", (_, res) => {
        resolve(res.statusCode);
        res.resume();
        ws.terminate();
      });
      ws.on("error", () => {});
    });
    assert.equal(status, 403);
  } finally {
    await app.close();
  }
});
