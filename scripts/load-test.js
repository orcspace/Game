import { WebSocket } from "ws";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { createGameServer } from "../server/index.js";
import assert from "node:assert/strict";

const duration = Math.max(5, Number(process.env.LOAD_SECONDS) || 30),
  count = 50;
const app = createGameServer();
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const url = `ws://127.0.0.1:${app.server.address().port}/ws`,
  clients = [];
let bytes = 0,
  snapshots = 0,
  lastTime = 0;
const delays = monitorEventLoopDelay({ resolution: 10 });
delays.enable();
async function connect() {
  const ws = new WebSocket(url),
    pending = [];
  let hello, joined, lobby;
  const c = {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (type) =>
      new Promise((resolve, reject) => {
        if (type === "hello" && hello) return resolve(hello);
        if (type === "joined" && joined) return resolve(joined);
        if (type === "lobby" && lobby) return resolve(lobby);
        const timer = setTimeout(
          () => reject(Error("Timed out: " + type)),
          5000,
        );
        pending.push({
          type,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      }),
  };
  ws.on("message", (raw) => {
    bytes += raw.length;
    const m = JSON.parse(raw);
    if (m.type === "hello") hello = m;
    if (m.type === "joined") joined = m;
    if (m.type === "lobby") lobby = m;
    if (m.type === "snapshot") {
      snapshots++;
      lastTime = m.time;
    }
    if (m.type === "error") console.error(m.message);
    for (let i = pending.length - 1; i >= 0; i--)
      if (pending[i].type === m.type) {
        pending[i].resolve(m);
        pending.splice(i, 1);
      }
  });
  await c.wait("hello");
  clients.push(c);
  return c;
}
let inputs;
try {
  const host = await connect();
  host.send({ type: "create", name: "Load host", bots: 0 });
  const room = await host.wait("lobby");
  for (let i = 1; i < count; i++) {
    const c = await connect();
    c.send({ type: "join", code: room.code, name: "Load " + i });
    await c.wait("joined");
  }
  host.send({ type: "start" });
  await host.wait("started");
  const cpu = process.cpuUsage(),
    start = performance.now();
  bytes = 0;
  snapshots = 0;
  let seq = 0;
  inputs = setInterval(() => {
    seq++;
    for (const [i, c] of clients.entries()) {
      c.send({
        type: "input",
        yaw: i * 0.27,
        pitch: 0,
        forward: seq % 90 < 60 ? 1 : 0,
        right: 0,
        fire: true,
        seq,
      });
      if (seq % 30 === 0) c.send({ type: "action", action: "drop" });
    }
  }, 1000 / 30);
  await new Promise((r) => setTimeout(r, duration * 1000));
  clearInterval(inputs);
  const elapsed = (performance.now() - start) / 1000,
    usage = process.cpuUsage(cpu);
  assert(snapshots >= count * duration * 7, `Too few snapshots: ${snapshots}`);
  assert(
    lastTime >= duration * 0.8,
    `Simulation is falling behind: ${lastTime}`,
  );
  console.log(
    JSON.stringify(
      {
        clients: count,
        seconds: +elapsed.toFixed(1),
        snapshots,
        simulationSeconds: +lastTime.toFixed(2),
        serverOutboundMBPerSecond: +(bytes / elapsed / 1e6).toFixed(2),
        eventLoopP99Ms: +(delays.percentile(99) / 1e6).toFixed(2),
        processCpuPercent: +(
          ((usage.user + usage.system) / 1e6 / elapsed) *
          100
        ).toFixed(1),
        rssMB: Math.round(process.memoryUsage().rss / 1e6),
        scope:
          "Local loopback, server and synthetic clients in the same process; not an internet or graphics benchmark.",
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(inputs);
  delays.disable();
  await app.close();
}
