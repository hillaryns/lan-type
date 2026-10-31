import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { calculateStats, getTypingPosition } from "../shared/typing.mjs";

const requireFromClient = createRequire(new URL("../client/package.json", import.meta.url));
const { io } = requireFromClient("socket.io-client");

async function getFreePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => {
    probe.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function waitForSocketEvent(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Socket.IO event "${event}"`));
    }, timeoutMs);
    const onEvent = (...args) => {
      cleanup();
      resolve(args.length === 1 ? args[0] : args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      socket.off("connect_error", onError);
    };

    socket.once(event, onEvent);
    socket.once("connect_error", onError);
  });
}

function waitForState(client, predicate, timeoutMs = 10_000) {
  if (client.latestState && predicate(client.latestState)) {
    return Promise.resolve(client.latestState);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the expected game state"));
    }, timeoutMs);
    const onState = (state) => {
      if (!predicate(state)) return;
      cleanup();
      resolve(state);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off("game:state", onState);
    };

    client.socket.on("game:state", onState);
  });
}

async function startServer(port) {
  const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
  const process = spawn(globalThis.process.execPath, [serverPath], {
    env: { ...globalThis.process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  process.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  process.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });

  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Server exited before becoming ready:\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { process, getOutput: () => output };
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  process.kill();
  throw new Error(`Server did not become ready: ${lastError}\n${output}`);
}

function makeHalfIncorrect(target) {
  return Array.from(target, (_char, index) => {
    if (index % 2 !== 0) return _char;
    return "!";
  }).join("");
}

test("three Socket.IO players finish independently and receive authoritative results", {
  timeout: 30_000
}, async () => {
  const port = await getFreePort();
  const { process: serverProcess, getOutput } = await startServer(port);
  const clients = [];

  try {
    for (let index = 0; index < 3; index++) {
      const socket = io(`http://127.0.0.1:${port}`, {
        autoConnect: false,
        transports: ["websocket"]
      });
      const welcome = waitForSocketEvent(socket, "session:welcome");
      const client = { socket, latestState: null, welcome: null };
      socket.on("game:state", (state) => { client.latestState = state; });
      clients.push(client);
      socket.connect();
      client.welcome = await welcome;
    }

    clients[0].socket.emit("game:configure", {
      mode: "race",
      duration: 15,
      raceLength: 25
    });
    await waitForState(clients[0], (state) => state.status === "lobby" && state.raceLength === 25);

    const finalResultEvents = clients.map(({ socket }) => waitForSocketEvent(socket, "game:ended"));
    clients[0].socket.emit("game:start");
    const runningStates = await Promise.all(
      clients.map((client) => waitForState(client, (state) => state.status === "running"))
    );
    const target = runningStates[0].passage;
    const playerIds = clients.map((client) => client.welcome.id);

    await delay(1_100);
    const playerATyped = makeHalfIncorrect(target);
    clients[0].socket.emit("player:progress", {
      typed: playerATyped,
      typedPosition: getTypingPosition(playerATyped)
    });
    const afterA = await waitForState(clients[0], (state) => (
      state.players.find((player) => player.id === playerIds[0])?.finished
    ));
    assert.equal(afterA.status, "running");
    assert.equal(afterA.players.find((player) => player.id === playerIds[0]).finishPosition, 1);

    await delay(100);
    clients[1].socket.emit("player:progress", {
      typed: target,
      typedPosition: getTypingPosition(target)
    });
    const afterB = await waitForState(clients[1], (state) => (
      state.players.find((player) => player.id === playerIds[1])?.finished
    ));
    assert.equal(afterB.status, "running");
    assert.equal(afterB.players.find((player) => player.id === playerIds[1]).finishPosition, 2);

    const partial = Array.from(target).slice(0, Math.floor(getTypingPosition(target) / 2)).join("");
    const partialPosition = getTypingPosition(partial);
    clients[2].socket.emit("player:progress", {
      typed: partial,
      typedPosition: partialPosition,
      progress: 100
    });
    const afterPartial = await waitForState(clients[2], (state) => (
      state.players.find((player) => player.id === playerIds[2])?.typedPosition === partialPosition
    ));
    const playerCAfterPartial = afterPartial.players.find((player) => player.id === playerIds[2]);
    assert.equal(afterPartial.status, "running");
    assert.equal(playerCAfterPartial.finished, false);
    assert.ok(playerCAfterPartial.progress < 100);

    clients[2].socket.emit("player:progress", {
      typed: partial,
      typedPosition: partialPosition
    });
    await delay(150);
    assert.equal(
      clients[2].latestState.players.find((player) => player.id === playerIds[2]).typedPosition,
      partialPosition,
      "duplicate snapshots must not be accumulated as extra input"
    );

    clients[2].socket.emit("player:progress", {
      typed: target,
      typedPosition: getTypingPosition(target)
    });
    const endedStates = await Promise.all(finalResultEvents);
    for (const finalState of endedStates) {
      assert.equal(finalState.status, "results");
      assert.deepEqual(
        finalState.players.map((player) => player.id).sort(),
        playerIds.slice().sort()
      );
    }

    const finalState = endedStates[0];
    for (const [index, typed] of [playerATyped, target, target].entries()) {
      const player = finalState.players.find((entry) => entry.id === playerIds[index]);
      const expected = calculateStats(target, typed, player.finishTime);
      assert.equal(player.finished, true);
      assert.equal(player.finishPosition, index + 1);
      assert.equal(player.wpm, expected.wpm);
      assert.equal(player.rawWpm, expected.rawWpm);
      assert.equal(player.accuracy, expected.accuracy);
      assert.equal(player.finalWpm, expected.wpm);
      assert.equal(player.finalRawWpm, expected.rawWpm);
      assert.equal(player.finalAccuracy, expected.accuracy);
    }

    const frozenMetrics = finalState.players.map((player) => [
      player.id,
      player.finishPosition,
      player.finishTime,
      player.wpm,
      player.rawWpm,
      player.accuracy
    ]);
    clients[0].socket.emit("player:progress", {
      typed: "x".repeat(getTypingPosition(target)),
      typedPosition: getTypingPosition(target)
    });
    await delay(150);
    assert.deepEqual(
      clients[0].latestState.players.map((player) => [
        player.id,
        player.finishPosition,
        player.finishTime,
        player.wpm,
        player.rawWpm,
        player.accuracy
      ]),
      frozenMetrics
    );
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${getOutput()}`, { cause: error });
  } finally {
    for (const { socket } of clients) socket.disconnect();
    if (serverProcess.exitCode === null) {
      const exited = once(serverProcess, "exit");
      serverProcess.kill();
      await Promise.race([exited, delay(2_000)]);
    }
  }
});
