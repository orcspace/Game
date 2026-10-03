# Validation record — 2026-10-03

This is a prototype validation record, not a production capacity certification.

## Automated checks

- `npm test`: 14 passing tests covering movement/input bounds, prototype-key rejection, hit/armour/ammo rules, walls and doors, reload, healing/cancellation, loot/line of sight, parachute/landing, zone/winner resolution, a complete 50-combatant bot simulation, room passwords and host authority, host migration, static-file boundaries, 50 WebSocket connections with rejection of a 51st room member, loot delta delivery, oversized payloads and origin checks.
- `npm audit --omit=dev`: zero known dependency vulnerabilities reported at the time of this run. `ws` is pinned to 8.22.0; the dependency lockfile is included.
- JavaScript syntax checks passed for the client, renderer and server modules.

## Local network load check

Command: `LOAD_SECONDS=30 npm run loadtest`.

| Measurement                       | Observed          |
| --------------------------------- | ----------------- |
| Synthetic clients                 | 50                |
| Wall time                         | 30.0 seconds      |
| Simulation time                   | 29.9 seconds      |
| Received snapshots, total         | 14,950            |
| Server outbound traffic           | 5.79 MB/s         |
| Event loop delay, 99th percentile | 18.78 ms          |
| Combined process CPU              | 12.5% of one core |
| Combined process resident memory  | 77 MB             |

Both server and synthetic clients ran in the same Node.js process over loopback. The clients sent controls and received snapshots; no graphics were rendered in this load check. These values do not predict internet latency, deployment sizing, bandwidth billing or the frame rate of 50 real devices. Full player snapshots still use significant bandwidth. Longer WAN testing and visibility-based replication are needed for a public service.

## Browser checks

Headless Chromium with software WebGL was used to exercise the menu, password rejection, a second browser joining the lobby, countdown, mouse capture, aircraft exit, landing, firing/ammo consumption, reload, Escape and leaving the match. Screenshots were inspected and camera-capture and short-landscape-layout issues were corrected. Software rendering was slow and is not a graphics performance benchmark.

The touch layout is tested in browser emulation; no physical phone, Safari/iOS run or mobile performance measurement was performed.

## Not validated

- Docker build or a production deployment.
- Internet matches involving 50 independent devices.
- Real latency/loss, reconnect resume, horizontal scaling, accounts or persistent data.
- Competitive anti-cheat, visibility filtering, navigation-mesh AI or lag-compensated hit rewind.

The repository contains the client, backend, tests, launcher helpers and deployment recipe. It does not include an already-hosted public game server.
