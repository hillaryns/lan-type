import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { calculateStats, getTypingPosition, shouldExtendPassage } from "../shared/typing.mjs";
import {
  cancelEmptyCountdown,
  endRaceIfComplete as transitionRaceToResults,
  expireTimeAttack,
  finishRace,
  getPassageWordCount,
  scheduleTimeAttackExpiration
} from "./game-rules.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] }
});

const PORT = Number(process.env.PORT || 5000);
const DEFAULT_RACE_LENGTH = 50;
const PASSAGE_EXTENSION_WORDS = 50;
const PASSAGE_EXTENSION_BUFFER = 20;
const PROGRESS_BROADCAST_INTERVAL = 100;
const WORDS = (
  "about above after again against air all almost along also always among an and animal another answer any are around as ask at away back because become before began begin being below between big bird black body book both boy bring build business call came can car carry change children city close cold come common complete country course cut day did different do does dog done door down during each early earth easy enough even every example eye face family far fast father feel few find first follow food for form found four friend from full game gave get girl give go good got great group grow had hand hard has have he head hear help her here high him his home house how however idea if important in in fact interest into is it its just keep kind know land language large last late learn leave left less let life light like line list little live long look made make man many map mark may me mean measure men might mile mind minute miss money month moon more morning most mother mountain move much music must my name near need never new next night no north not note now number object of off often old on once one only open or other our out over own page paper part people person picture place plan plant play point power problem public put question quick quite read real right river road room run said same saw say school sea second see seem sentence set several she should show side simple since small so some something sometimes song soon sound spell start state still story study such sun sure system take talk tell ten than that the their them then there these they thing think this those thought three through time to together too took tree true try turn two under unit until up us use usual very voice wait walk want war warm was watch water way we well went were what when where which while white who why will wind with word work world would write year yes yet you young"
).split(/\s+/);

function makePassage(count = 160) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
  }
  return result.join(" ");
}

let game = {
  status: "lobby",
  mode: "race",
  duration: 15,
  raceLength: DEFAULT_RACE_LENGTH,
  passage: makePassage(DEFAULT_RACE_LENGTH),
  raceTarget: null,
  startedAt: null,
  endsAt: null,
  players: {},
  nextFinishPosition: 1,
  resultPlayerIds: null
};
let roundId = 0;
let countdownTimer = null;
let cancelTimeAttackTimer = () => {};
let pendingProgressBroadcast = null;
let lastStateBroadcastAt = 0;

function publicState() {
  const resultPlayers = game.status === "results" && game.mode === "race" && game.resultPlayerIds
    ? Object.values(game.players).filter((player) => game.resultPlayerIds.has(player.id))
    : Object.values(game.players);
  const players = resultPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    progress: p.progress,
    wpm: p.finished ? p.finalWpm : p.wpm,
    rawWpm: p.finished ? p.finalRawWpm : p.rawWpm,
    accuracy: p.finished ? p.finalAccuracy : p.accuracy,
    finished: p.finished,
    finishPosition: p.finishPosition,
    finishTime: p.finishTime,
    finalWpm: p.finalWpm,
    finalRawWpm: p.finalRawWpm,
    finalAccuracy: p.finalAccuracy,
    typedPosition: p.typedPosition,
    typedProgress: p.typedProgress,
    connected: p.connected
  })).sort((a, b) => {
    if (game.mode === "time" && game.status === "results") {
      return b.wpm - a.wpm || b.accuracy - a.accuracy;
    }
    if (game.mode === "race" && a.finished && b.finished) {
      return a.finishPosition - b.finishPosition;
    }
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (b.progress !== a.progress) return b.progress - a.progress;
    return b.wpm - a.wpm;
  });

  return {
    status: game.status,
    mode: game.mode,
    duration: game.duration,
    raceLength: game.raceLength,
    passage: game.passage,
    raceTargetLength: game.raceTarget ? getTypingPosition(game.raceTarget) : 0,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    serverNow: Date.now(),
    players
  };
}

function broadcastState() {
  io.emit("game:state", publicState());
}

function emitState() {
  if (pendingProgressBroadcast !== null) {
    clearTimeout(pendingProgressBroadcast);
    pendingProgressBroadcast = null;
  }
  lastStateBroadcastAt = Date.now();
  broadcastState();
}

function emitProgressState() {
  const now = Date.now();
  const remaining = PROGRESS_BROADCAST_INTERVAL - (now - lastStateBroadcastAt);
  if (remaining <= 0) {
    lastStateBroadcastAt = now;
    broadcastState();
    return;
  }
  if (pendingProgressBroadcast !== null) return;

  pendingProgressBroadcast = setTimeout(() => {
    pendingProgressBroadcast = null;
    lastStateBroadcastAt = Date.now();
    broadcastState();
  }, remaining);
}

function clearGameTimers() {
  roundId++;
  if (countdownTimer !== null) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  cancelTimeAttackTimer();
  cancelTimeAttackTimer = () => {};
}

function resetPlayersForGame() {
  for (const [id, player] of Object.entries(game.players)) {
    if (!player.connected) delete game.players[id];
  }
  game.nextFinishPosition = 1;
  for (const p of Object.values(game.players)) {
    p.progress = 0;
    p.wpm = 0;
    p.rawWpm = 0;
    p.accuracy = 100;
    p.finished = false;
    p.finishPosition = null;
    p.finishTime = null;
    p.finalWpm = null;
    p.finalRawWpm = null;
    p.finalAccuracy = null;
    p.typedPosition = 0;
    p.typedProgress = 0;
    p.typedLength = 0;
    p.correctChars = 0;
    p.typed = "";
  }
}

function endGame() {
  if (game.status !== "running") return;
  if (game.mode !== "time" || !expireTimeAttack(game, Date.now())) return;
  const elapsedMs = Math.max(0, game.endsAt - game.startedAt);
  for (const p of Object.values(game.players)) {
    if (p.connected) updatePlayerStats(p, elapsedMs);
  }
  clearGameTimers();
  emitState();
  io.emit("game:ended", publicState());
}

function endRaceIfComplete() {
  if (!transitionRaceToResults(game)) return false;
  game.resultPlayerIds = new Set(Object.keys(game.players));
  clearGameTimers();
  emitState();
  io.emit("game:ended", publicState());
  return true;
}

function updatePlayerStats(player, elapsedMs) {
  const typed = player.typed || "";
  const stats = calculateStats(game.passage, typed, elapsedMs);
  player.typedLength = typed.length;
  player.correctChars = stats.correctChars;
  const progressLength = game.mode === "race" && game.raceTarget
    ? getTypingPosition(game.raceTarget)
    : getTypingPosition(game.passage);
  player.progress = Math.min(100, Math.round((stats.progressChars / progressLength) * 100));
  player.accuracy = stats.accuracy;
  player.rawWpm = stats.rawWpm;
  player.wpm = stats.wpm;
  player.typedPosition = stats.totalChars;
  player.typedProgress = stats.progressChars;
}

io.on("connection", (socket) => {
  const name = `player-${Math.floor(100 + Math.random() * 900)}`;
  game.players[socket.id] = {
    id: socket.id,
    name,
    progress: 0,
    wpm: 0,
    rawWpm: 0,
    accuracy: 100,
    finished: false,
    finishPosition: null,
    finishTime: null,
    finalWpm: null,
    finalRawWpm: null,
    finalAccuracy: null,
    typedPosition: 0,
    typedProgress: 0,
    typedLength: 0,
    correctChars: 0,
    typed: "",
    connected: true
  };

  socket.emit("session:welcome", { id: socket.id, name: game.players[socket.id].name });
  emitState();

  socket.on("player:name", (value) => {
    const p = game.players[socket.id];
    if (!p || typeof value !== "string") return;
    const clean = value.trim().replace(/\s+/g, " ").slice(0, 18);
    if (clean) p.name = clean;
    emitState();
  });

  socket.on("game:configure", (settings = {}) => {
    if (game.status !== "lobby" && game.status !== "results") return;
    if (!settings || typeof settings !== "object") return;
    if (settings.mode === "race" || settings.mode === "time") game.mode = settings.mode;
    const duration = Number(settings.duration);
    if ([15, 30, 60].includes(duration)) game.duration = duration;
    const raceLength = Number(settings.raceLength);
    if ([25, 50, 100].includes(raceLength)) game.raceLength = raceLength;
    emitState();
  });

  socket.on("game:start", () => {
    if (game.status !== "lobby" && game.status !== "results") return;
    clearGameTimers();
    const thisRound = roundId;
    game.resultPlayerIds = null;
    game.passage = makePassage(getPassageWordCount(game.mode, game.raceLength, game.duration));
    game.raceTarget = game.mode === "race" ? game.passage : null;
    resetPlayersForGame();
    game.status = "countdown";
    game.startedAt = Date.now() + 3000;
    game.endsAt = game.mode === "time" ? game.startedAt + game.duration * 1000 : null;
    emitState();
    io.emit("game:countdown", { startsAt: game.startedAt, mode: game.mode, duration: game.duration });
    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      if (thisRound !== roundId || game.status !== "countdown") return;
      game.status = "running";
      emitState();
      if (game.mode === "time") {
        cancelTimeAttackTimer = scheduleTimeAttackExpiration(game, () => {
          if (thisRound === roundId) endGame();
        });
      }
    }, Math.max(0, game.startedAt - Date.now()));
  });

  socket.on("player:progress", (payload = {}) => {
    const p = game.players[socket.id];
    if (!p || game.status !== "running" || p.finished) return;
    if (!payload || typeof payload !== "object") return;
    const now = Date.now();
    if (game.mode === "time" && now >= game.endsAt) {
      endGame();
      return;
    }
    if (typeof payload.typed !== "string") return;
    const typed = payload.typed;
    const typedPosition = getTypingPosition(typed);
    const maxPosition = Math.max(
      getTypingPosition(game.passage) + 256,
      game.raceTarget ? getTypingPosition(game.raceTarget) : 0
    );
    if (!Number.isSafeInteger(payload.typedPosition) || payload.typedPosition !== typedPosition
        || typedPosition > maxPosition) return;
    p.typed = typed;
    if (game.mode === "race" && finishRace(game, p, typed, now, typedPosition)) {
      if (!endRaceIfComplete()) emitState();
      return;
    }
    updatePlayerStats(p, Math.max(0, now - game.startedAt));
    if (game.mode === "time" && shouldExtendPassage(game.passage, typed, PASSAGE_EXTENSION_BUFFER)) {
      game.passage = `${game.passage} ${makePassage(PASSAGE_EXTENSION_WORDS)}`;
      updatePlayerStats(p, Math.max(0, now - game.startedAt));
    }
    emitProgressState();
  });

  socket.on("game:reset", () => {
    if (game.status !== "lobby" && game.status !== "results") return;
    clearGameTimers();
    game.status = "lobby";
    game.startedAt = null;
    game.endsAt = null;
    game.passage = makePassage(getPassageWordCount(game.mode, game.raceLength, game.duration));
    game.raceTarget = null;
    game.nextFinishPosition = 1;
    game.resultPlayerIds = null;
    resetPlayersForGame();
    emitState();
  });

  socket.on("disconnect", () => {
    const p = game.players[socket.id];
    if (p && game.mode === "race" && (game.status === "running" || game.status === "results")) {
      p.connected = false;
      if (game.status === "running" && endRaceIfComplete()) return;
      emitState();
      return;
    }
    delete game.players[socket.id];
    if (Object.keys(game.players).length === 0 && game.status === "countdown") {
      clearGameTimers();
      cancelEmptyCountdown(game);
      game.passage = makePassage();
      emitState();
      return;
    }
    emitState();
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "lan-type" }));

const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res, next) => {
  const indexPath = path.join(clientDist, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) next();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LAN Type server listening on http://0.0.0.0:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});