# LAN Type

A Monkeytype-inspired multiplayer typing site for friends on the same Wi-Fi.

## Requirements
- Node.js 20+ (Node 22+ recommended)
- npm

## Install
From this folder:

```bash
npm install
npm run install:all
```

## Run for local development
```bash
npm run dev
```

Open the Vite address printed in the terminal on the host computer, usually `http://localhost:5173`.

## Let friends join over Wi-Fi
1. Make sure everyone is connected to the same Wi-Fi network.
2. Find the host computer's local IPv4 address:
   - Windows: run `ipconfig` and look for the Wi-Fi adapter's IPv4 Address.
   - Linux: run `hostname -I`.
   - macOS: run `ipconfig getifaddr en0`.
3. Friends open `http://HOST-IP:5173` in their browser, e.g. `http://192.168.1.20:5173`.
4. If prompted, allow Node.js through the host computer's private-network firewall.

The Vite dev server is configured to listen on `0.0.0.0`; the Socket.IO client connects to the same host that served the page, on port 5000.

## Production-style local run
Build the frontend:
```bash
npm run build --prefix client
```
Then start the server:
```bash
npm start
```
Open `http://localhost:5000` or `http://HOST-IP:5000` from other devices.

## Tests
Run the backend typing-rule tests and the three-client Socket.IO integration test:
```bash
npm run test:backend
```

## Game rules
- Shared automatic lobby; no accounts or database required.
- Players choose Race or Time Attack. The lobby starts a race when the host clicks Start.
- Race mode: players finish when their own typed position reaches the end of the fixed shared target; mistakes do not prevent finishing. Finish places are assigned in order, and the race ends only after every connected player finishes or disconnects. The default target is 50 words; 25- and 100-word targets are also available. Race passages never extend.
- Time Attack: type for the selected duration after the countdown; the server ends the test at its deadline even if players are idle. Ranking uses WPM, then accuracy.
- Time Attack passages start with a duration-sized shared word list and extend only when needed before the passage runs out.
- The server owns the countdown and race clock. Each player's submitted text and character position are validated independently; client-supplied progress percentages are ignored. Leaderboard snapshots are broadcast up to ten times per second.
- Net WPM is correctly typed characters divided by five and elapsed minutes; gross WPM is all typed characters divided by five and elapsed minutes. Both use the server's official start time and millisecond precision.
- Accuracy is correctly typed characters divided by all typed characters. Substitutions and extra characters count as errors; untyped future characters do not. Metrics are calculated by character position and frozen when a player finishes.
- Player names and room state are in memory and reset when the server restarts.

## Notes
This is a LAN prototype. It does not use authentication, persistence, or internet matchmaking. Only share it on networks you trust.
