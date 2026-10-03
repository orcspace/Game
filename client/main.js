import { IslandScene } from "./scene.js";
import { WORLD, WEAPONS, GUN_ORDER, clamp } from "/shared/world.js";
const $ = (id) => document.getElementById(id);
const coarse =
  matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle("touch-mode", coarse);
let view,
  ws,
  myId,
  room,
  state,
  mode = "create",
  connected = false,
  inMatch = false,
  deathShown = false,
  finishedShown = false,
  lastHP = 100,
  spectating = false;
let audio,
  muted = false,
  toastTimer,
  hitTimer,
  damageTimer,
  reconnectTimer,
  seq = 0,
  lastUiWeapon = "";
const keys = new Set(),
  look = { yaw: 0, pitch: 0, fire: false, aim: false },
  stick = { x: 0, y: 0 };
let menuPending = false;
let ignoreMouseUntil = 0;
try {
  view = new IslandScene($("world"));
} catch (e) {
  $("fatal").hidden = false;
  $("fatal-message").textContent =
    "This browser could not initialize WebGL 2. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.";
  console.error(e);
}
$("retry").onclick = () => location.reload();
try {
  $("name").value = localStorage.getItem("last-drop-name") || "Rookie";
} catch {}
function send(m) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.opacity = 0), 3500);
}
function action(action, value) {
  send({ type: "action", action, value });
}
function setMode(next) {
  mode = next;
  $("create-fields").hidden = mode !== "create";
  $("join-fields").hidden = mode !== "join";
  for (const k of ["create", "join"]) {
    $(`${k}-tab`).classList.toggle("selected", k === mode);
    $(`${k}-tab`).setAttribute("aria-selected", String(k === mode));
  }
  $("enter").textContent =
    mode === "create" ? "CREATE LOBBY ↗" : "JOIN LOBBY ↗";
  $("menu-error").textContent = "";
}
$("create-tab").onclick = () => setMode("create");
$("join-tab").onclick = () => setMode("join");
function updateConnection(ok) {
  connected = ok;
  $("enter").disabled = !ok || menuPending;
  $("connection").textContent = ok ? "SERVER ONLINE" : "SERVER OFFLINE";
  $("connection").style.color = ok ? "#bfd6b0" : "#f9b094";
}
function connect() {
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  ws.onopen = () => {
    updateConnection(true);
    clearTimeout(reconnectTimer);
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(m);
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    updateConnection(false);
    menuPending = false;
    if (inMatch || room) {
      returnToMenu();
      toast(
        "Disconnected. Your match slot was removed. Rejoin or create a new lobby.",
      );
    }
    reconnectTimer = setTimeout(connect, 2500);
  };
}
function handle(m) {
  if (m.type === "hello") {
    myId = m.id;
    return;
  }
  if (m.type === "pong") {
    $("ping").textContent = `${Math.round(performance.now() - m.at)} ms`;
    return;
  }
  if (m.type === "error") {
    menuPending = false;
    $("enter").disabled = !connected;
    $("menu-error").textContent = m.message;
    toast(m.message);
    return;
  }
  if (m.type === "joined") {
    menuPending = false;
    myId = m.id;
    return;
  }
  if (m.type === "left") {
    returnToMenu();
    return;
  }
  if (m.type === "lobby") {
    room = m;
    if (m.status !== "lobby") return;
    if (inMatch) {
      inMatch = false;
      view?.reset();
      document.body.classList.remove("playing");
      for (const id of ["hud", "loading", "capture", "result"])
        $(id).hidden = true;
      document.exitPointerLock?.();
    }
    $("menu").hidden = true;
    $("lobby").hidden = false;
    $("room-code").textContent = m.code;
    $("roster-count").textContent = `${m.players.length} / 50 PLAYERS`;
    $("lock-status").textContent = m.locked
      ? "PASSWORD PROTECTED"
      : "CODE ACCESS";
    $("roster").replaceChildren();
    for (const p of m.players) {
      const item = document.createElement("div");
      item.className = "roster-player";
      item.textContent = p.name;
      const tag = document.createElement("span");
      tag.textContent = p.id === m.host ? "HOST" : p.id === myId ? "YOU" : "";
      item.append(tag);
      $("roster").append(item);
    }
    const host = m.host === myId;
    $("start").hidden = !host;
    $("lobby-bots").disabled = !host;
    $("lobby-bots").value = m.bots;
    $("lobby-note").textContent =
      `${Math.min(m.bots, 50 - m.players.length)} bots will join. ${host ? "Start whenever everyone is ready." : "Waiting for the host to start."}`;
    return;
  }
  if (m.type === "started") {
    inMatch = true;
    state = null;
    deathShown = false;
    finishedShown = false;
    spectating = false;
    lastHP = 100;
    lastUiWeapon = "";
    look.yaw = 0;
    look.pitch = -0.15;
    look.fire = false;
    keys.clear();
    $("lobby").hidden = true;
    $("menu").hidden = true;
    $("loading").hidden = false;
    $("hud").hidden = true;
    document.body.classList.add("playing");
    return;
  }
  if (m.type === "snapshot") {
    if (!inMatch) return;
    m.loot ??= state?.loot || [];
    state = m;
    view?.sync(m, myId);
    if (m.status === "countdown") {
      $("loading").hidden = false;
      $("loading-count").textContent = Math.max(
        1,
        Math.ceil(m.countdown - m.time),
      );
      return;
    }
    const wasLoading = !$("loading").hidden;
    $("loading").hidden = true;
    $("hud").hidden = false;
    if (wasLoading && !coarse) $("capture").hidden = false;
    updateHUD(m);
    for (const e of m.events) event(e);
    const me = m.players.find((p) => p.id === myId);
    if (me && !me.alive && !deathShown) {
      deathShown = true;
      showResult(false, m, me);
    }
    if (m.status === "finished" && !finishedShown) {
      finishedShown = true;
      showResult(true, m, me);
    }
  }
}
$("enter").onclick = () => {
  if (!connected || menuPending) return;
  const name = $("name").value.trim();
  if (!name) {
    $("menu-error").textContent = "Enter a callsign first.";
    return;
  }
  if (mode === "join" && !/^[a-f0-9]{6}$/i.test($("code").value.trim())) {
    $("menu-error").textContent = "Enter the 6-character lobby code.";
    return;
  }
  unlockAudio();
  try {
    localStorage.setItem("last-drop-name", name);
  } catch {}
  menuPending = true;
  $("enter").disabled = true;
  $("menu-error").textContent = "";
  send({
    type: mode,
    name,
    password: $("password").value,
    bots: Number($("bots").value),
    code: $("code").value.trim(),
  });
};
$("copy-code").onclick = async () => {
  try {
    await navigator.clipboard.writeText(room.code);
    toast("Lobby code copied.");
  } catch {
    toast(`Your lobby code: ${room.code}`);
  }
};
$("lobby-bots").onchange = () =>
  send({ type: "settings", bots: Number($("lobby-bots").value) });
$("start").onclick = () => {
  unlockAudio();
  send({ type: "start" });
};
for (const id of ["leave", "exit-match", "result-leave"])
  $(id).onclick = () => {
    send({ type: "leave" });
    returnToMenu();
  };
$("rematch").onclick = () => send({ type: "rematch" });
$("spectate").onclick = () => {
  spectating = true;
  $("result").hidden = true;
};
$("resume").onclick = () => {
  unlockAudio();
  if (coarse) {
    $("capture").hidden = true;
    return;
  }
  try {
    const request = $("world").requestPointerLock();
    request?.catch(() =>
      toast("Mouse capture was denied. Click Enter the action again."),
    );
  } catch {
    toast("Mouse capture is unavailable in this browser.");
  }
};
function returnToMenu() {
  inMatch = false;
  state = null;
  room = null;
  view?.reset();
  keys.clear();
  look.fire = false;
  look.aim = false;
  stick.x = stick.y = 0;
  document.exitPointerLock?.();
  document.body.classList.remove("playing", "aim");
  for (const id of ["hud", "lobby", "loading", "capture", "result"])
    $(id).hidden = true;
  $("menu").hidden = false;
  $("enter").disabled = !connected;
}
function showResult(finished, s, me) {
  document.exitPointerLock?.();
  keys.clear();
  look.fire = false;
  $("capture").hidden = true;
  $("result").hidden = false;
  const won = me?.alive && finished;
  $("result-tag").textContent = finished ? "MATCH COMPLETE" : "ELIMINATED";
  $("result-title").textContent = won
    ? "LAST ONE STANDING."
    : finished
      ? "DROP. FIGHT. REPEAT."
      : "YOUR RUN ENDS HERE.";
  $("result-detail").textContent = finished
    ? `${s.winner ? `${s.winner} wins.` : "No survivors."} You secured ${me?.kills || 0} elimination(s).`
    : `You secured ${me?.kills || 0} elimination(s). Watch the remaining survivors or start again.`;
  $("spectate").hidden = finished;
  $("rematch").hidden = !(finished && room?.host === myId);
}
function updateHUD(s) {
  const p = s.players.find((p) => p.id === myId);
  if (!p) return;
  const gear = s.self.inventory[p.weapon];
  $("alive").textContent = s.players.filter((q) => q.alive).length;
  $("kills").textContent = p.kills;
  $("hp").textContent = p.hp;
  $("health-bar").style.width = p.hp + "%";
  $("armor-bar").style.width = p.armor + "%";
  $("armor").textContent = p.armor + " ARMOR";
  $("meds").textContent =
    s.self.medkits + " MEDKIT" + (s.self.medkits === 1 ? "" : "S");
  $("weapon-name").textContent = WEAPONS[p.weapon].name.toUpperCase();
  $("ammo").textContent = gear.ammo;
  $("reserve").textContent = gear.reserve;
  $("weapon-status").textContent = s.self.reload
    ? `RELOADING ${s.self.reload.toFixed(1)}s`
    : s.self.heal
      ? `HEALING ${s.self.heal.toFixed(1)}s`
      : "R RELOAD · 1–5 SWITCH · H HEAL";
  $("phase-label").textContent = !p.alive
    ? "SPECTATING"
    : p.phase === "ground"
      ? "BOOTS ON THE GROUND"
      : p.phase === "plane"
        ? "ON THE FLIGHT PATH"
        : p.phase === "fall"
          ? "FREEFALL"
          : "PARACHUTE DEPLOYED";
  const invKey = p.weapon + Object.keys(s.self.inventory).join();
  if (lastUiWeapon !== invKey) {
    lastUiWeapon = invKey;
    $("inventory").replaceChildren();
    for (const [i, k] of GUN_ORDER.entries())
      if (s.self.inventory[k]) {
        const b = document.createElement("button");
        b.textContent = `${i + 1} ${k.toUpperCase()}`;
        b.className = k === p.weapon ? "active" : "";
        b.onclick = () => action("equip", k);
        $("inventory").append(b);
      }
  }
  const outside = Math.hypot(p.x, p.z) > s.zone.r;
  $("zone-text").textContent = outside
    ? "OUTSIDE ZONE — MOVE IN"
    : s.zone.closing
      ? `ZONE CLOSING · ${Math.round(s.zone.r)}m`
      : `ZONE CLOSES IN ${Math.ceil(Math.max(0, 45 - s.flight))}s`;
  $("zone-text").style.color = outside ? "#ffb096" : "#dcecef";
  $("flight-help").hidden = p.phase === "ground" || !p.alive;
  $("flight-help").textContent =
    p.phase === "plane"
      ? coarse
        ? "TAP JUMP TO EXIT THE AIRCRAFT"
        : "SPACE — JUMP FROM AIRCRAFT"
      : p.phase === "fall"
        ? coarse
          ? "FREEFALL · TAP CHUTE TO DEPLOY"
          : "FREEFALL · SPACE TO DEPLOY PARACHUTE"
        : "STEER TO A BUILDING · WASD / JOYSTICK";
  $("touch-drop").hidden = p.phase === "ground" || !p.alive;
  $("touch-drop").textContent = p.phase === "plane" ? "JUMP" : "CHUTE";
  $("touch-use").hidden = p.phase !== "ground";
  $("crosshair").hidden = p.phase !== "ground" || !p.alive;
  const nearest = s.loot
    .filter((l) => Math.hypot(l.x - p.x, l.z - p.z) < 2.8)
    .sort(
      (a, b) =>
        Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
    )[0];
  $("prompt").textContent =
    p.alive && p.phase === "ground" && nearest
      ? `${coarse ? "USE" : "E"} · PICK UP ${(WEAPONS[nearest.kind]?.name || nearest.kind).toUpperCase()}`
      : s.self.heal
        ? "APPLYING MEDKIT…"
        : s.self.reload
          ? "RELOADING…"
          : "";
  if (p.hp < lastHP) {
    $("damage-overlay").style.opacity = 1;
    clearTimeout(damageTimer);
    damageTimer = setTimeout(
      () => ($("damage-overlay").style.opacity = 0),
      280,
    );
  }
  lastHP = p.hp;
  drawMap(s, p);
}
function event(e) {
  if (e.type === "shot") {
    view?.shot(e);
    if (e.player === myId) sound("shot", 1, e.weapon);
    else {
      const p = state.players.find((p) => p.id === myId),
        d = p ? Math.hypot(p.x - e.from.x, p.z - e.from.z) : 100;
      if (d < 130)
        sound("shot", Math.max(0.015, (1 - d / 130) * 0.25), e.weapon);
    }
  }
  if (e.type === "hit" && e.player === myId) {
    $("hitmarker").style.opacity = 1;
    $("hitmarker").style.color = e.head ? "#ffba65" : "white";
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => ($("hitmarker").style.opacity = 0), 160);
    sound("hit", 0.15);
  }
  if (e.type === "pickup" && e.player === myId) {
    toast(`Picked up ${WEAPONS[e.kind]?.name || e.kind}`);
    sound("pickup", 0.15);
  }
  if (e.type === "kill") {
    const item = document.createElement("div");
    item.className = "feeditem";
    item.textContent = `${e.killer}  ▸  ${e.victim}`;
    $("killfeed").prepend(item);
    while ($("killfeed").children.length > 4) $("killfeed").lastChild.remove();
    setTimeout(() => item.remove(), 6000);
  }
}
function drawMap(s, p) {
  const canvas = $("map"),
    c = canvas.getContext("2d"),
    scale = 190 / 500,
    to = (n) => 95 + n * scale;
  c.clearRect(0, 0, 190, 190);
  c.fillStyle = "#355962";
  c.fillRect(0, 0, 190, 190);
  c.fillStyle = "#60765d";
  c.fillRect(to(-240), to(-240), 480 * scale, 480 * scale);
  c.fillStyle = "#819078";
  c.fillRect(92, 4, 6, 182);
  c.fillRect(4, 92, 182, 6);
  c.fillStyle = "#c4baa1";
  for (const b of WORLD.buildings)
    c.fillRect(to(b.x - b.w / 2), to(b.z - b.d / 2), b.w * scale, b.d * scale);
  c.save();
  c.beginPath();
  c.rect(0, 0, 190, 190);
  c.arc(95, 95, s.zone.r * scale, 0, Math.PI * 2, true);
  c.fillStyle = "#478ece55";
  c.fill("evenodd");
  c.restore();
  c.strokeStyle = "#c1e9ff";
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(95, 95, s.zone.r * scale, 0, Math.PI * 2);
  c.stroke();
  if (p.phase === "plane") {
    c.strokeStyle = "#eee2b880";
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(10, 95);
    c.lineTo(180, 95);
    c.stroke();
    c.setLineDash([]);
  }
  c.save();
  c.translate(to(p.x), to(p.z));
  c.rotate(-look.yaw);
  c.fillStyle = "#ffe5a4";
  c.beginPath();
  c.moveTo(0, -5);
  c.lineTo(3.5, 4);
  c.lineTo(0, 2);
  c.lineTo(-3.5, 4);
  c.fill();
  c.restore();
  c.fillStyle = "#ecf4e8";
  c.font = "8px monospace";
  c.fillText("N", 92, 10);
}
function input() {
  const active =
    inMatch &&
    state?.status === "playing" &&
    $("capture").hidden &&
    $("result").hidden &&
    !document.hidden;
  return {
    yaw: look.yaw,
    pitch: look.pitch,
    forward: active
      ? clamp(
          (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
            (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) -
            stick.y,
          -1,
          1,
        )
      : 0,
    right: active
      ? clamp(
          (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
            (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) +
            stick.x,
          -1,
          1,
        )
      : 0,
    sprint:
      active && (keys.has("ShiftLeft") || Math.hypot(stick.x, stick.y) > 0.9),
    fire: active && look.fire,
    aim: active && look.aim,
  };
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && inMatch) {
    document.exitPointerLock?.();
    keys.clear();
    look.fire = false;
    look.aim = false;
    if (state?.status === "playing" && !deathShown) $("capture").hidden = false;
    return;
  }
  if (
    !inMatch ||
    !$("capture").hidden ||
    !$("result").hidden ||
    /INPUT|SELECT/.test(e.target.tagName)
  )
    return;
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      e.code,
    )
  )
    e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyE") action("pickup");
  if (e.code === "KeyR") action("reload");
  if (e.code === "KeyH") action("heal");
  if (e.code === "Space") {
    const p = state?.players.find((p) => p.id === myId);
    action(p?.phase === "plane" ? "drop" : "chute");
  }
  if (/^Digit[1-5]$/.test(e.code))
    action("equip", GUN_ORDER[Number(e.code.slice(-1)) - 1]);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  look.fire = false;
  look.aim = false;
  stick.x = stick.y = 0;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    look.fire = false;
    look.aim = false;
    send({ type: "input", ...input(), forward: 0, right: 0, fire: false });
  }
});
document.addEventListener("pointerlockchange", () => {
  if (!inMatch) return;
  const locked = document.pointerLockElement === $("world");
  if (locked) ignoreMouseUntil = performance.now() + 150;
  if (state?.status === "playing" && !spectating && !deathShown)
    $("capture").hidden = locked;
  keys.clear();
  look.fire = false;
});
window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== $("world")) return;
  // Some browsers emit a large cursor-warp delta when acquiring pointer lock.
  if (
    performance.now() < ignoreMouseUntil ||
    Math.abs(e.movementX) > 250 ||
    Math.abs(e.movementY) > 250
  )
    return;
  const scale = look.aim ? 0.0012 : 0.002;
  look.yaw -= e.movementX * scale;
  look.pitch = clamp(look.pitch - e.movementY * scale, -1.35, 1.35);
});
$("world").addEventListener("mousedown", (e) => {
  if (document.pointerLockElement !== $("world")) return;
  if (e.button === 0) look.fire = true;
  if (e.button === 2) look.aim = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) look.fire = false;
  if (e.button === 2) look.aim = false;
});
window.addEventListener("contextmenu", (e) => {
  if (inMatch) e.preventDefault();
});
function touchButton(id, onDown, onUp = () => {}) {
  const b = $(id);
  b.onpointerdown = (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    unlockAudio();
    onDown();
  };
  b.onpointerup = b.onpointercancel = b.onlostpointercapture = onUp;
}
touchButton(
  "touch-fire",
  () => (look.fire = true),
  () => (look.fire = false),
);
touchButton("touch-aim", () => (look.aim = !look.aim));
touchButton("touch-use", () => action("pickup"));
touchButton("touch-reload", () => action("reload"));
touchButton("touch-heal", () => action("heal"));
touchButton("touch-drop", () => {
  const p = state?.players.find((p) => p.id === myId);
  action(p?.phase === "plane" ? "drop" : "chute");
});
touchButton("touch-swap", () => {
  if (!state) return;
  const p = state.players.find((p) => p.id === myId),
    guns = GUN_ORDER.filter((k) => state.self.inventory[k]);
  action("equip", guns[(guns.indexOf(p.weapon) + 1) % guns.length]);
});
let stickPointer = null;
const joystick = $("stick");
function stickMove(e) {
  if (e.pointerId !== stickPointer) return;
  const r = joystick.getBoundingClientRect(),
    dx = (e.clientX - r.left - r.width / 2) / 40,
    dy = (e.clientY - r.top - r.height / 2) / 40,
    len = Math.max(1, Math.hypot(dx, dy));
  stick.x = dx / len;
  stick.y = dy / len;
  $("stick-knob").style.transform =
    `translate(${stick.x * 34}px,${stick.y * 34}px)`;
}
joystick.onpointerdown = (e) => {
  if (stickPointer !== null) return;
  e.preventDefault();
  stickPointer = e.pointerId;
  joystick.setPointerCapture(e.pointerId);
  stickMove(e);
};
joystick.onpointermove = stickMove;
joystick.onpointerup =
  joystick.onpointercancel =
  joystick.onlostpointercapture =
    (e) => {
      if (e.pointerId !== stickPointer) return;
      stickPointer = null;
      stick.x = stick.y = 0;
      $("stick-knob").style.transform = "";
    };
let lookPointer = null,
  prevX = 0,
  prevY = 0;
const pad = $("lookpad");
pad.onpointerdown = (e) => {
  e.preventDefault();
  lookPointer = e.pointerId;
  prevX = e.clientX;
  prevY = e.clientY;
  pad.setPointerCapture(e.pointerId);
};
pad.onpointermove = (e) => {
  if (e.pointerId !== lookPointer) return;
  look.yaw -= (e.clientX - prevX) * 0.005;
  look.pitch = clamp(look.pitch - (e.clientY - prevY) * 0.005, -1.35, 1.35);
  prevX = e.clientX;
  prevY = e.clientY;
};
pad.onpointerup = pad.onpointercancel = (e) => {
  if (e.pointerId === lookPointer) lookPointer = null;
};
function unlockAudio() {
  try {
    if (!audio)
      audio = new (window.AudioContext || window.webkitAudioContext)();
    audio.resume().catch(() => {});
  } catch {}
}
function sound(kind, volume, weapon) {
  if (!audio || muted || audio.state !== "running") return;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume * 0.3, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.13);
  gain.connect(audio.destination);
  if (kind === "shot") {
    const buffer = audio.createBuffer(
        1,
        Math.ceil(audio.sampleRate * 0.12),
        audio.sampleRate,
      ),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const n = audio.createBufferSource();
    n.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = weapon === "marksman" ? 650 : 1500;
    n.connect(filter);
    filter.connect(gain);
    n.start();
    n.onended = () => {
      n.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  } else {
    const o = audio.createOscillator();
    o.frequency.setValueAtTime(kind === "hit" ? 650 : 850, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(400, audio.currentTime + 0.1);
    o.connect(gain);
    o.start();
    o.stop(audio.currentTime + 0.12);
    o.onended = () => {
      o.disconnect();
      gain.disconnect();
    };
  }
}
$("sound").onclick = () => {
  muted = !muted;
  $("sound").textContent = muted ? "SOUND OFF" : "SOUND ON";
};
let last = performance.now(),
  inputAcc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  inputAcc += dt;
  const i = input();
  if (inMatch && inputAcc >= 1 / 30) {
    send({ type: "input", ...i, seq: ++seq });
    inputAcc = 0;
  }
  document.body.classList.toggle("aim", i.aim);
  if (inMatch) {
    const degrees = ((((look.yaw * -180) / Math.PI) % 360) + 360) % 360;
    const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    $("compass").textContent =
      `${points[Math.round(degrees / 45) % 8]}  ${String(Math.round(degrees)).padStart(3, "0")}°`;
  }
  view?.render(dt, i);
  requestAnimationFrame(frame);
}
if (view) {
  connect();
  requestAnimationFrame(frame);
}
setInterval(() => {
  if (connected) send({ type: "ping", at: performance.now() });
}, 2500);
