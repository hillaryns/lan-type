import { calculateStats, getTypingPosition, isRaceComplete } from "../shared/typing.mjs";

export function completeRace(game, player, typed, completedAt, typedPosition) {
  if (game.status !== "running" || game.mode !== "race" || player.finished || player.connected === false
      || typeof typed !== "string"
      || !isRaceComplete(game.raceTarget, typed, typedPosition === undefined
        ? getTypingPosition(typed)
        : typedPosition)) {
    return false;
  }

  const players = Object.values(game.players || {});
  const nextPosition = Number.isInteger(game.nextFinishPosition)
    ? game.nextFinishPosition
    : players.filter((entry) => entry.finished).length + 1;
  const finishTime = Math.max(0, completedAt - game.startedAt);
  const stats = calculateStats(game.raceTarget, typed, finishTime);
  player.finished = true;
  player.finishTime = finishTime;
  player.finishPosition = nextPosition;
  player.typed = typed;
  player.typedLength = stats.totalChars;
  player.correctChars = stats.correctChars;
  player.progress = Math.min(100, Math.round((stats.progressChars / getTypingPosition(game.raceTarget)) * 100));
  player.wpm = stats.wpm;
  player.rawWpm = stats.rawWpm;
  player.accuracy = stats.accuracy;
  player.finalWpm = stats.wpm;
  player.finalRawWpm = stats.rawWpm;
  player.finalAccuracy = stats.accuracy;
  player.typedProgress = stats.progressChars;
  player.typedPosition = stats.totalChars;
  game.nextFinishPosition = nextPosition + 1;
  return true;
}

export function finishRace(game, player, typed, completedAt, typedPosition) {
  return completeRace(game, player, typed, completedAt, typedPosition);
}

export function allRacePlayersFinished(game) {
  return Object.values(game.players || {})
    .filter((player) => player.connected !== false)
    .every((player) => player.finished);
}

export function endRaceIfComplete(game) {
  if (game.status !== "running" || game.mode !== "race" || !allRacePlayersFinished(game)) {
    return false;
  }
  game.status = "results";
  return true;
}

export function expireTimeAttack(game, now) {
  if (game.status !== "running" || game.mode !== "time" || now < game.endsAt) {
    return false;
  }

  game.status = "results";
  return true;
}

export function cancelEmptyCountdown(game) {
  if (game.status !== "countdown") return false;

  game.status = "lobby";
  game.startedAt = null;
  game.endsAt = null;
  game.raceTarget = null;
  return true;
}

export function getPassageWordCount(mode, raceLength, duration) {
  if (mode === "race") {
    return [25, 50, 100].includes(raceLength) ? raceLength : 50;
  }

  const safeDuration = [15, 30, 60].includes(duration) ? duration : 15;
  return Math.max(80, safeDuration * 3 + 40);
}

export function scheduleTimeAttackExpiration(game, onExpire, {
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let timer = null;
  let cancelled = false;

  const checkDeadline = () => {
    if (cancelled || game.status !== "running" || game.mode !== "time") return;

    const remaining = game.endsAt - now();
    if (remaining <= 0) {
      onExpire();
      return;
    }

    timer = setTimer(checkDeadline, remaining);
  };

  checkDeadline();
  return () => {
    cancelled = true;
    if (timer !== null) clearTimer(timer);
  };
}
