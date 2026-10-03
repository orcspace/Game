import * as THREE from "/vendor/three.module.js";
import { WORLD, random, WEAPONS } from "/shared/world.js";

export class IslandScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    const touch = matchMedia("(pointer:coarse)").matches;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#b7d0d4");
    this.scene.fog = new THREE.FogExp2("#c6d8d6", 0.0026);
    this.camera = new THREE.PerspectiveCamera(
      75,
      innerWidth / innerHeight,
      0.08,
      1500,
    );
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xdaedf0, 0x788461, 2.2));
    const sun = new THREE.DirectionalLight(0xffe1af, 3.5);
    sun.position.set(80, 150, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -130,
      right: 130,
      top: 130,
      bottom: -130,
      near: 1,
      far: 400,
    });
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.materials = new Map();
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.players = new Map();
    this.loot = new Map();
    this.tracers = [];
    this.camPos = new THREE.Vector3();
    this.readyCam = false;
    this.recoil = 0;
    this.buildIsland();
    this.plane = this.buildPlane();
    this.scene.add(this.plane);
    this.buildGun();
    const zoneMat = new THREE.MeshBasicMaterial({
      color: 0x5ec8f6,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.zoneWall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 70, 128, 1, true),
      zoneMat,
    );
    this.zoneWall.position.y = 33;
    this.scene.add(this.zoneWall);
    this.zoneRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.004, 6, 128),
      new THREE.MeshBasicMaterial({ color: 0x84e4ff }),
    );
    this.zoneRing.rotation.x = Math.PI / 2;
    this.zoneRing.position.y = 0.16;
    this.scene.add(this.zoneRing);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  mat(color, roughness = 0.85) {
    if (!this.materials.has(color))
      this.materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness }),
      );
    return this.materials.get(color);
  }
  box(x, y, z, w, h, d, color, parent = this.scene) {
    const m = new THREE.Mesh(this.boxGeometry, this.mat(color));
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  buildIsland() {
    this.box(0, -3.5, 0, 2500, 2, 2500, "#4d8291");
    this.box(0, -1.6, 0, 501, 2.8, 501, "#c9bd90");
    this.box(0, -0.2, 0, 480, 0.4, 480, "#74856b");
    this.box(0, 0.012, 0, 16, 0.03, 468, "#505b58");
    this.box(0, 0.013, 0, 468, 0.03, 16, "#505b58");
    for (let j = -22; j <= 22; j++) {
      this.box(j * 10, 0.04, 0, 4, 0.02, 0.18, "#d9ce9b");
      this.box(0, 0.04, j * 10, 0.18, 0.02, 4, "#d9ce9b");
    }
    for (const t of WORLD.towns) {
      this.box(t.x, 0.01, t.z, 94, 0.03, 58, "#adb196");
      this.box(t.x, 0.04, t.z, 100, 0.03, 9, "#69736c");
    }
    const tones = ["#c8c0a7", "#91a2a0", "#b6a08b", "#c3b998"];
    // First eight collision boxes per building represent the actual house and cover.
    WORLD.walls
      .slice(0, WORLD.buildings.length * 8)
      .forEach((b, i) =>
        this.box(
          b.x,
          b.y,
          b.z,
          b.w,
          b.h,
          b.d,
          b.h === 0.3
            ? "#606761"
            : b.h === 1.3
              ? "#6e795e"
              : tones[WORLD.buildings[Math.floor(i / 8)].tone],
        ),
      );
    WORLD.buildings.forEach((b, i) => {
      this.box(b.x, 0.03, b.z, b.w, 0.04, b.d, "#b3a791");
      this.box(b.x, 3.4, b.z + b.d / 2 + 0.06, 3.5, 0.2, 0.9, "#717969");
      this.box(b.x, 5.55, b.z - 2, 2.1, 0.8, 2.2, "#747c75");
      this.box(b.x, 6.1, b.z - 2, 1.7, 0.3, 1.9, "#a3a394");
      if (b.roof) {
        this.box(b.x + b.w / 2 - 2, 6.1, b.z - 3, 0.1, 2, 0.1, "#576b67");
        this.box(b.x + b.w / 2 - 2, 6.7, b.z - 3, 2, 0.06, 0.06, "#576b67");
      }
      for (const side of [-1, 1])
        for (const z of [-2, 2]) {
          this.box(
            b.x + side * (b.w / 2 + 0.33),
            2.8,
            b.z + z,
            0.06,
            1.4,
            1.7,
            "#344e54",
          );
          this.box(
            b.x + side * (b.w / 2 + 0.39),
            2.8,
            b.z + z,
            0.06,
            0.08,
            1.7,
            "#c7cbbb",
          );
        }
      // Door frame, doorstep, utility box, number plate.
      this.box(b.x, 0.08, b.z + b.d / 2 + 1, 4, 0.16, 2, "#b5b2a1");
      this.box(b.x + 4, 1.2, b.z + b.d / 2 + 0.5, 0.8, 1.4, 0.5, "#727e72");
      this.box(b.x - 3, 3, b.z + b.d / 2 + 0.32, 0.9, 0.4, 0.04, "#516f72");
    });
    const matrix = new THREE.Object3D();
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.42, 1, 5),
      this.mat("#736b52"),
      WORLD.trees.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      this.mat("#4b705f"),
      WORLD.trees.length * 2,
    );
    WORLD.trees.forEach((t, i) => {
      matrix.position.set(t.x, t.h * 0.3, t.z);
      matrix.scale.set(1, t.h * 0.6, 1);
      matrix.rotation.set(0, 0, 0);
      matrix.updateMatrix();
      trunks.setMatrixAt(i, matrix.matrix);
      for (let j = 0; j < 2; j++) {
        matrix.position.set(t.x, t.h * (0.6 + j * 0.18), t.z);
        matrix.scale.set(
          t.h * (0.33 - j * 0.09),
          t.h * 0.3,
          t.h * (0.3 - j * 0.08),
        );
        matrix.rotation.y = i;
        matrix.updateMatrix();
        crowns.setMatrixAt(i * 2 + j, matrix.matrix);
      }
    });
    trunks.castShadow = crowns.castShadow = true;
    this.scene.add(trunks, crowns);
    const stones = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      this.mat("#959b8b"),
      WORLD.rocks.length,
    );
    WORLD.rocks.forEach((r, i) => {
      matrix.position.set(r.x, r.s * 0.4, r.z);
      matrix.scale.set(r.s * 0.8, r.s * 0.65, r.s * 0.8);
      matrix.rotation.set(0, i, 0);
      matrix.updateMatrix();
      stones.setMatrixAt(i, matrix.matrix);
    });
    stones.castShadow = true;
    this.scene.add(stones);
    const rng = random(51);
    const grass = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.16, 0.6, 3),
      this.mat("#87916a"),
      800,
    );
    for (let i = 0; i < 800; i++) {
      matrix.position.set((rng() - 0.5) * 464, 0.25, (rng() - 0.5) * 464);
      matrix.scale.set(1, 1 + rng(), 1);
      matrix.rotation.set(0, rng() * 6, 0);
      matrix.updateMatrix();
      grass.setMatrixAt(i, matrix.matrix);
    }
    this.scene.add(grass);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: "#edf1e3",
      roughness: 1,
      flatShading: true,
    });
    for (let i = 0; i < 18; i++) {
      const cloud = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        cloudMat,
      );
      cloud.position.set(
        (rng() - 0.5) * 1100,
        125 + rng() * 65,
        (rng() - 0.5) * 1100,
      );
      cloud.scale.set(20 + rng() * 25, 4 + rng() * 5, 12 + rng() * 12);
      this.scene.add(cloud);
    }
    // A radio mast in the island center.
    this.box(24, 12, 23, 0.6, 24, 0.6, "#adb7ae");
    this.box(24, 20, 23, 7, 0.18, 0.18, "#adb7ae");
    this.box(24, 16, 23, 5, 0.18, 0.18, "#adb7ae");
    for (let i = 0; i < 4; i++)
      this.box(24, 5 + i * 5, 23, 0.75, 1, 0.75, "#c78968");
  }
  buildPlane() {
    const p = new THREE.Group();
    this.box(0, 0, 0, 17, 2.5, 3.5, "#bac7bd", p);
    this.box(0, 0.3, 0, 5, 0.4, 20, "#a0b2ac", p);
    this.box(-7, 1, 0, 3, 0.35, 8, "#9cadab", p);
    this.box(-7, 2, 0, 3, 3, 0.35, "#91a5a1", p);
    this.box(6, 1, 0, 3, 0.8, 2.4, "#395965", p);
    for (const z of [-6, 6]) {
      this.box(1, -0.5, z, 4, 1.4, 1.4, "#6c8485", p);
      this.box(3.2, -0.5, z, 0.15, 4, 0.3, "#334e56", p);
    }
    p.position.set(-150, 90, 0);
    return p;
  }
  buildGun() {
    this.gun = new THREE.Group();
    this.camera.add(this.gun);
    this.gun.position.set(0.28, -0.3, -0.6);
    this.box(0, 0, 0, 0.12, 0.13, 0.38, "#2d3a3e", this.gun);
    this.box(0, 0.02, -0.3, 0.035, 0.035, 0.35, "#1b292e", this.gun);
    this.box(0, -0.13, 0.04, 0.07, 0.2, 0.1, "#323c38", this.gun);
    this.box(0, -0.1, -0.08, 0.07, 0.15, 0.09, "#717b62", this.gun);
    this.box(0, 0.1, -0.04, 0.07, 0.07, 0.08, "#172d35", this.gun);
    this.box(0.05, -0.19, 0.15, 0.14, 0.22, 0.28, "#9c967d", this.gun);
    this.box(-0.1, -0.13, -0.12, 0.12, 0.13, 0.2, "#7d8970", this.gun);
    this.muzzle = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd380 }),
    );
    this.muzzle.position.set(0, 0.02, -0.52);
    this.gun.add(this.muzzle);
    this.muzzle.visible = false;
    this.gun.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 100;
        o.material = o.material.clone();
        o.material.depthTest = false;
      }
    });
    this.gun.visible = false;
  }
  makeAvatar(id) {
    const g = new THREE.Group();
    const color = id.startsWith("bot") ? "#aa9170" : "#7d9b8b";
    this.box(0, 1.05, 0, 0.7, 0.72, 0.38, color, g);
    this.box(0, 1.1, -0.22, 0.56, 0.46, 0.09, "#3e554b", g);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 6),
      this.mat("#c2a587"),
    );
    head.position.y = 1.61;
    g.add(head);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      this.mat("#52655b"),
    );
    helmet.position.y = 1.63;
    g.add(helmet);
    const arms = [
      this.box(-0.44, 1, -0.11, 0.18, 0.62, 0.22, color, g),
      this.box(0.44, 1, -0.11, 0.18, 0.62, 0.22, color, g),
    ];
    arms.forEach((a) => (a.rotation.x = -0.6));
    const legs = [
      this.box(-0.2, 0.35, 0, 0.25, 0.7, 0.28, "#3e5149", g),
      this.box(0.2, 0.35, 0, 0.25, 0.7, 0.28, "#3e5149", g),
    ];
    this.box(0.35, 1.05, -0.5, 0.09, 0.11, 0.75, "#243c42", g);
    this.box(0, 1.03, 0.29, 0.5, 0.58, 0.2, "#5e705b", g);
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.47),
      new THREE.MeshStandardMaterial({
        color: "#d0af76",
        side: THREE.DoubleSide,
      }),
    );
    canopy.scale.y = 0.4;
    canopy.position.y = 4.2;
    chute.add(canopy);
    for (const x of [-2, 2])
      for (const z of [-2, 2]) {
        const points = [
          new THREE.Vector3(x, 4.4, z),
          new THREE.Vector3(x * 0.15, 1.2, z * 0.15),
        ];
        chute.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: "#e5e2c7" }),
          ),
        );
      }
    g.add(chute);
    this.scene.add(g);
    return {
      g,
      legs,
      chute,
      last: new THREE.Vector3(),
      target: new THREE.Vector3(),
    };
  }
  sync(state, id) {
    this.state = state;
    this.id = id;
    const ids = new Set(state.players.map((p) => p.id));
    for (const [key, a] of this.players)
      if (!ids.has(key)) {
        this.disposeGroup(a.g);
        this.players.delete(key);
      }
    for (const p of state.players) {
      let a = this.players.get(p.id);
      if (!a) {
        a = this.makeAvatar(p.id);
        a.g.position.set(p.x, p.y, p.z);
        this.players.set(p.id, a);
      }
      a.target.set(p.x, p.y, p.z);
      a.data = p;
    }
    const lootIds = new Set(state.loot.map((l) => l.id));
    for (const [key, g] of this.loot)
      if (!lootIds.has(key)) {
        this.disposeGroup(g);
        this.loot.delete(key);
      }
    for (const l of state.loot)
      if (!this.loot.has(l.id)) {
        const g = new THREE.Group(),
          color =
            WEAPONS[l.kind]?.color ||
            { ammo: "#ecc873", medkit: "#f1f0d7", armor: "#80c9ec" }[l.kind];
        if (WEAPONS[l.kind]) {
          this.box(0, 0.3, 0, 0.16, 0.2, 0.8, color, g);
          this.box(0, 0.2, 0.16, 0.1, 0.25, 0.13, "#384942", g);
        } else this.box(0, 0.3, 0, 0.6, 0.4, 0.45, color, g);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.52, 0.64, 20),
          new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.7,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.035;
        g.add(ring);
        g.position.set(l.x, 0, l.z);
        this.scene.add(g);
        this.loot.set(l.id, g);
      }
    this.zoneWall.scale.set(state.zone.r, 1, state.zone.r);
    this.zoneRing.scale.setScalar(state.zone.r);
    this.zoneRing.scale.z = 1;
  }
  shot(e) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(e.from.x, e.from.y, e.from.z),
        new THREE.Vector3(e.to.x, e.to.y, e.to.z),
      ]),
      new THREE.LineBasicMaterial({
        color: e.player === this.id ? 0xffe8aa : 0xffc291,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.scene.add(line);
    this.tracers.push({ line, life: 0.1 });
    if (e.player === this.id) {
      this.recoil = 0.055;
      this.muzzle.visible = true;
    }
  }
  disposeGroup(g) {
    this.scene.remove(g);
    const shared = new Set(this.materials.values());
    g.traverse((o) => {
      if (o.geometry && o.geometry !== this.boxGeometry) o.geometry.dispose();
      if (o.material && !shared.has(o.material)) o.material.dispose();
    });
  }
  render(dt, input = {}) {
    const t = performance.now() / 1000,
      state = this.state;
    let me = state?.players.find((p) => p.id === this.id);
    this.recoil = Math.max(0, this.recoil - dt * 0.32);
    this.muzzle.visible = this.recoil > 0.04;
    for (const item of this.tracers) item.life -= dt;
    this.tracers = this.tracers.filter((item) => {
      if (item.life > 0) return true;
      this.scene.remove(item.line);
      item.line.geometry.dispose();
      item.line.material.dispose();
      return false;
    });
    if (!state) {
      this.camera.position.set(Math.sin(t * 0.018) * 140 + 30, 105, 180);
      this.camera.lookAt(-20, 0, -20);
      this.plane.position.set(Math.sin(t * 0.07) * 180, 75, -40);
      this.gun.visible = false;
      this.zoneWall.visible = this.zoneRing.visible = false;
      this.readyCam = false;
    } else {
      this.zoneWall.visible = this.zoneRing.visible = true;
      this.plane.visible = state.flight < 32;
      this.plane.position.set(
        -210 + Math.min(1, (state.flight || 0) / 24) * 420,
        90,
        0,
      );
      for (const [key, a] of this.players) {
        const p = a.data;
        a.g.visible = p.alive && p.phase !== "plane";
        a.chute.visible = p.phase === "chute";
        a.g.position.lerp(a.target, Math.min(1, dt * 13));
        a.g.rotation.y = p.yaw;
        const movement = a.last.distanceToSquared(a.g.position);
        a.legs[0].rotation.x = movement > 0.0002 ? Math.sin(t * 12) * 0.45 : 0;
        a.legs[1].rotation.x = -a.legs[0].rotation.x;
        a.last.copy(a.g.position);
      }
      if (me && !me.alive) {
        me = state.players.find((p) => p.alive && p.phase !== "plane") || me;
      }
      if (me) {
        const own = me.id === this.id && me.alive,
          avatar = this.players.get(me.id),
          pos = avatar?.g.position || new THREE.Vector3(me.x, me.y, me.z);
        if (own && me.phase === "ground") {
          avatar.g.visible = false;
          const target = new THREE.Vector3(pos.x, pos.y + 1.55, pos.z);
          if (!this.readyCam) {
            this.camPos.copy(target);
            this.readyCam = true;
          }
          this.camPos.lerp(target, Math.min(1, dt * 24));
          this.camera.position.copy(this.camPos);
          this.camera.rotation.set(input.pitch || 0, input.yaw || 0, 0, "YXZ");
          this.gun.visible = true;
          const moving =
            Math.abs(input.forward || 0) + Math.abs(input.right || 0) > 0;
          const bob = moving
            ? Math.sin(t * 10) * 0.012
            : Math.sin(t * 1.5) * 0.003;
          this.gun.position.lerp(
            new THREE.Vector3(
              input.aim ? 0 : 0.28,
              (input.aim ? -0.21 : -0.3) + bob,
              -0.6 + this.recoil,
            ),
            Math.min(1, dt * 14),
          );
          this.gun.rotation.x = this.recoil;
          this.camera.fov = THREE.MathUtils.lerp(
            this.camera.fov,
            input.aim ? (me.weapon === "marksman" ? 28 : 49) : 75,
            Math.min(1, dt * 12),
          );
        } else {
          this.gun.visible = false;
          this.readyCam = false;
          this.camera.fov = 75;
          const yaw = own ? input.yaw || 0 : me.yaw,
            dist = me.phase === "plane" ? 25 : me.phase === "ground" ? 7 : 12;
          const target = new THREE.Vector3(
            me.x + Math.sin(yaw) * dist,
            me.y + (me.phase === "plane" ? 10 : 5),
            me.z + Math.cos(yaw) * dist,
          );
          this.camera.position.lerp(target, Math.min(1, dt * 4));
          this.camera.lookAt(me.x, me.y + 1, me.z);
        }
      }
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  reset() {
    this.state = null;
    this.plane.visible = true;
    for (const a of this.players.values()) this.disposeGroup(a.g);
    this.players.clear();
    for (const g of this.loot.values()) this.disposeGroup(g);
    this.loot.clear();
  }
}
