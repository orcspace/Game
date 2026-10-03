import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Match, makePlayer } from "./match.js";
import { MAX_PLAYERS, TICK_RATE } from "../shared/world.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const cleanName = (v) =>
  typeof v === "string"
    ? v
        .replace(/[\x00-\x1f<>]/g, "")
        .trim()
        .slice(0, 20)
    : "";
export function createGameServer({
  maxRooms = 30,
  maxConnections = 1000,
  allowedOrigins = [],
} = {}) {
  const rooms = new Map(),
    ipLimits = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          rooms: rooms.size,
          connections: wss.clients.size,
        }),
      );
      return;
    }
    let relative;
    if (pathname === "/") relative = "client/index.html";
    else if (
      ["/vendor/three.module.js", "/vendor/three.core.js"].includes(pathname)
    )
      relative = "node_modules/three/build/" + path.basename(pathname);
    else if (pathname.startsWith("/shared/")) relative = pathname.slice(1);
    else relative = "client/" + pathname.slice(1);
    const filename = path.resolve(root, relative);
    const allowed = [
      path.join(root, "client") + path.sep,
      path.join(root, "shared") + path.sep,
      path.join(root, "node_modules/three/build") + path.sep,
    ];
    if (
      !allowed.some((p) => filename.startsWith(p)) ||
      !mime[path.extname(filename)]
    ) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const body = await readFile(filename);
      res.setHeader("Content-Type", mime[path.extname(filename)]);
      res.setHeader("Cache-Control", "no-cache");
      res.writeHead(200);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    let valid = false;
    try {
      const origin = req.headers.origin;
      valid =
        req.url === "/ws" &&
        (!origin ||
          new URL(origin).host === req.headers.host ||
          allowedOrigins.includes(origin));
    } catch {}
    const ip = req.socket.remoteAddress || "unknown";
    let ipState = ipLimits.get(ip);
    if (!ipState) {
      ipState = { count: 0, actions: [], last: Date.now() };
      ipLimits.set(ip, ipState);
    }
    if (!valid || wss.clients.size >= maxConnections || ipState.count >= 60) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ipState.count++;
      ws.ipState = ipState;
      wss.emit("connection", ws, req);
    });
  });
  const send = (ws, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 512 * 1024) {
        ws.close(1013, "Connection too slow");
        return;
      }
      ws.send(JSON.stringify(data));
    }
  };
  const error = (ws, message) => send(ws, { type: "error", message });
  const lobby = (room) => {
    const message = {
      type: "lobby",
      code: room.code,
      host: room.host,
      locked: !!room.passwordHash,
      bots: room.bots,
      maxPlayers: MAX_PLAYERS,
      players: [...room.members.values()].map((p) => ({
        id: p.id,
        name: p.name,
      })),
      status: room.match?.status || "lobby",
    };
    for (const p of room.members.values()) send(p.ws, message);
  };
  const remove = (ws) => {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.members.delete(ws.id);
    if (room.match) {
      const p = room.match.players.get(ws.id);
      if (p) {
        p.alive = false;
        p.hp = 0;
        room.match.event("kill", {
          killer: "Disconnected",
          victim: p.name,
          player: p.id,
        });
      }
    }
    if (room.members.size === 0) rooms.delete(room.code);
    else {
      if (room.host === ws.id) room.host = room.members.keys().next().value;
      lobby(room);
    }
    ws.room = null;
  };
  wss.on("connection", (ws) => {
    ws.id = randomUUID();
    ws.room = null;
    ws.alive = true;
    ws.tokens = 120;
    ws.lastRefill = Date.now();
    ws.lastSeen = Date.now();
    send(ws, { type: "hello", id: ws.id });
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      ws.ipState.count--;
      ws.ipState.last = Date.now();
      remove(ws);
    });
    ws.on("message", (raw) => {
      const now = Date.now();
      ws.tokens = Math.min(120, ws.tokens + (now - ws.lastRefill) * 0.08);
      ws.lastRefill = now;
      if (--ws.tokens < 0) {
        ws.close(1008, "Message rate exceeded");
        return;
      }
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        error(ws, "Invalid message.");
        return;
      }
      if (!m || typeof m !== "object" || Array.isArray(m)) return;
      ws.lastSeen = now;
      if (m.type === "ping") {
        send(ws, { type: "pong", at: typeof m.at === "number" ? m.at : 0 });
        return;
      }
      if (m.type === "leave") {
        remove(ws);
        send(ws, { type: "left" });
        return;
      }
      if (m.type === "create" || m.type === "join") {
        if (ws.room) {
          error(ws, "Leave your current lobby first.");
          return;
        }
        const limit = ws.ipState;
        limit.actions = limit.actions.filter((t) => now - t < 60000);
        limit.last = now;
        if (limit.actions.length >= 100) {
          error(ws, "Too many lobby requests. Try again in one minute.");
          return;
        }
        limit.actions.push(now);
        const name = cleanName(m.name);
        if (!name) {
          error(ws, "Enter a callsign.");
          return;
        }
        const password = typeof m.password === "string" ? m.password : "";
        if (password.length > 64) {
          error(ws, "Password must be 64 characters or fewer.");
          return;
        }
        let room;
        if (m.type === "create") {
          if (rooms.size >= maxRooms) {
            error(ws, "Server is full. Try again later.");
            return;
          }
          let code;
          do {
            code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
          } while (rooms.has(code));
          const salt = randomBytes(16).toString("hex");
          room = {
            code,
            host: ws.id,
            members: new Map(),
            bots: clampBots(m.bots),
            salt,
            passwordHash: password ? scryptSync(password, salt, 32) : null,
            created: now,
            match: null,
          };
          rooms.set(code, room);
        } else {
          const code =
            typeof m.code === "string" ? m.code.toUpperCase().trim() : "";
          room = rooms.get(code);
          if (!room) {
            error(ws, "Lobby not found. Check the code.");
            return;
          }
          if (
            room.passwordHash &&
            !timingSafeEqual(
              room.passwordHash,
              scryptSync(password, room.salt, 32),
            )
          ) {
            error(ws, "Incorrect lobby password.");
            return;
          }
          if (room.match) {
            error(ws, "This match has already started.");
            return;
          }
          if (room.members.size >= MAX_PLAYERS) {
            error(ws, "Lobby is full (50 players).");
            return;
          }
        }
        room.members.set(ws.id, { id: ws.id, name, ws });
        ws.room = room.code;
        send(ws, { type: "joined", id: ws.id, code: room.code });
        lobby(room);
        return;
      }
      const room = rooms.get(ws.room);
      if (!room) return;
      if (m.type === "settings" && !room.match && room.host === ws.id) {
        room.bots = clampBots(m.bots);
        lobby(room);
        return;
      }
      if (m.type === "start") {
        if (room.host !== ws.id) {
          error(ws, "Only the host can start the match.");
          return;
        }
        if (room.match) return;
        const players = [...room.members.values()].map((p) =>
          makePlayer(p.id, p.name),
        );
        const bots = Math.min(room.bots, MAX_PLAYERS - players.length);
        if (players.length + bots < 2) {
          error(ws, "Invite another player or add bots.");
          return;
        }
        for (let i = 0; i < bots; i++)
          players.push(
            makePlayer(
              `bot-${i}`,
              `RANGER ${String(i + 1).padStart(2, "0")}`,
              true,
            ),
          );
        room.match = new Match(players);
        room.sentLootVersion = -1;
        for (const p of room.members.values()) send(p.ws, { type: "started" });
        return;
      }
      if (
        m.type === "rematch" &&
        room.host === ws.id &&
        room.match?.status === "finished"
      ) {
        room.match = null;
        lobby(room);
        return;
      }
      const p = room.match?.players.get(ws.id);
      if (!p) return;
      if (m.type === "input") room.match.setInput(p, m);
      if (m.type === "action" && typeof m.action === "string")
        room.match.action(p, m.action, m.value);
    });
  });
  let tick = 0;
  const ticker = setInterval(() => {
    for (const room of rooms.values())
      if (room.match) {
        room.match.update(1 / TICK_RATE);
        if (tick % 2 === 0) {
          const state = room.match.snapshot(),
            events = room.match.events.splice(0);
          if (room.sentLootVersion === room.match.lootVersion)
            delete state.loot;
          else room.sentLootVersion = room.match.lootVersion;
          for (const member of room.members.values()) {
            const p = room.match.players.get(member.id);
            send(member.ws, {
              type: "snapshot",
              ...state,
              events,
              self: room.match.privateState(p),
            });
          }
        }
      }
    tick++;
  }, 1000 / TICK_RATE);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
      if (Date.now() - ws.lastSeen > 30 * 60000) ws.close(1000, "Idle timeout");
    }
    for (const [ip, v] of ipLimits)
      if (v.count === 0 && Date.now() - v.last > 60000) ipLimits.delete(ip);
    for (const room of rooms.values())
      if (!room.match && Date.now() - room.created > 2 * 60 * 60000) {
        for (const p of room.members.values())
          p.ws.close(1000, "Lobby expired");
        rooms.delete(room.code);
      }
  }, 30000);
  return {
    server,
    wss,
    rooms,
    close: async () => {
      clearInterval(ticker);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
function clampBots(v) {
  return Number.isInteger(v) ? Math.max(0, Math.min(49, v)) : 9;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT) || 3000,
    host = process.env.HOST || "0.0.0.0";
  const app = createGameServer({
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .filter(Boolean),
  });
  app.server.listen(port, host, () =>
    console.log(`LAST DROP running at http://localhost:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
