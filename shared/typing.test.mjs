import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTyping,
  analyzeTypingWords,
  calculateStats,
  getTypingPosition,
  isRaceComplete,
  shouldExtendPassage
} from "./typing.mjs";
import {
  cancelEmptyCountdown,
  endRaceIfComplete,
  completeRace,
  expireTimeAttack,
  finishRace,
  getPassageWordCount,
  scheduleTimeAttackExpiration
} from "../server/game-rules.mjs";

test("typing analysis compares each input character at its actual target position", () => {
  const analysis = analyzeTyping("apple house", "applx house");

  assert.equal(analysis.correctChars, 10);
  assert.equal(analysis.totalChars, 11);
  assert.equal(analysis.complete, true);
});

test("word-array analysis delegates to the same character-position calculation", () => {
  const targetWords = ["apple", "house"];
  const analysis = analyzeTypingWords(targetWords, "applx house");

  assert.equal(analysis.targetWords, targetWords);
  assert.equal(analysis.correctChars, 10);
  assert.equal(analysis.totalChars, 11);
  assert.equal(analysis.accuracy, 90.9);
});

test("perfect typing produces standard net and gross WPM at a known speed", () => {
  const target = "a".repeat(100);
  const stats = calculateStats(target, target, 60_000);

  assert.equal(stats.correctChars, 100);
  assert.equal(stats.wpm, 20);
  assert.equal(stats.rawWpm, 20);
  assert.equal(stats.accuracy, 100);
});

test("50% incorrect typing lowers net WPM and accuracy without lowering gross WPM", () => {
  const stats = calculateStats("abcdefghij", "abcdezzzzz", 60_000);

  assert.equal(stats.correctChars, 5);
  assert.equal(stats.wpm, 1);
  assert.equal(stats.rawWpm, 2);
  assert.equal(stats.accuracy, 50);
});

test("90% incorrect typing reports the one correct character", () => {
  const stats = calculateStats("abcdefghij", "zzzzzzzziz", 60_000);

  assert.equal(stats.correctChars, 1);
  assert.equal(stats.wpm, 0.2);
  assert.equal(stats.accuracy, 10);
});

test("all incorrect characters produce zero net WPM and accuracy", () => {
  const stats = calculateStats("abcdefghij", "zzzzzzzzzz", 60_000);

  assert.equal(stats.correctChars, 0);
  assert.equal(stats.wpm, 0);
  assert.equal(stats.rawWpm, 2);
  assert.equal(stats.accuracy, 0);
});

test("extra input counts as errors and contributes to gross WPM", () => {
  const stats = calculateStats("abc", "abcz", 60_000);

  assert.equal(stats.correctChars, 3);
  assert.equal(stats.totalChars, 4);
  assert.equal(stats.wpm, 0.6);
  assert.equal(stats.rawWpm, 0.8);
  assert.equal(stats.accuracy, 75);
});

test("incomplete input does not treat untyped future characters as errors", () => {
  const analysis = analyzeTyping("abcdefghij", "abc");

  assert.equal(analysis.correctChars, 3);
  assert.equal(analysis.totalChars, 3);
  assert.equal(analysis.missingChars, 7);
  assert.equal(analysis.accuracy, 100);
  assert.equal(analysis.progressChars, 3);
  assert.equal(analysis.complete, false);
});

test("accuracy counts substitutions and extra characters once each", () => {
  const substitution = analyzeTyping("abcde", "abXde");
  const extra = analyzeTyping("abcde", "abcdeX");

  assert.equal(substitution.correctChars, 4);
  assert.equal(substitution.totalChars, 5);
  assert.equal(substitution.accuracy, 80);
  assert.equal(extra.correctChars, 5);
  assert.equal(extra.totalChars, 6);
  assert.equal(extra.accuracy, 83.3);
});

test("arbitrary incorrect characters still advance the position and count once", () => {
  const typed = "a!c?e?g?i?";
  const analysis = analyzeTyping("abcdefghij", typed);

  assert.equal(getTypingPosition(typed), 10);
  assert.equal(analysis.progressChars, 10);
  assert.equal(analysis.correctChars, 5);
  assert.equal(analysis.totalChars, 10);
  assert.equal(analysis.accuracy, 50);
  assert.equal(analysis.complete, true);
});

test("typing positions and metrics count Unicode characters consistently", () => {
  const target = "a😀c";
  const typed = "a😀x";
  const analysis = analyzeTyping(target, typed);

  assert.equal(getTypingPosition(typed), 3);
  assert.equal(analysis.correctChars, 2);
  assert.equal(analysis.totalChars, 3);
  assert.equal(analysis.progressChars, 3);
  assert.equal(analysis.complete, true);
});

test("completion accepts final character with or without one trailing space", () => {
  const target = "apple house";
  assert.equal(isRaceComplete(target, target), true);
  assert.equal(isRaceComplete(target, `${target} `), true);
  assert.equal(analyzeTyping(target, target).complete, true);
  assert.equal(analyzeTyping(target, `${target} `).complete, true);
});

test("accuracy and completion stats use one WPM value for leaderboard and results", () => {
  const stats = calculateStats("apple house", "applx housx", 30_000);

  assert.equal(stats.wpm, stats.netWpm);
  assert.equal(stats.rawWpm, stats.grossWpm);
  assert.equal(stats.accuracy, 81.8);
  assert.equal(stats.wpm, 3.6);
  assert.equal(stats.rawWpm, 4.4);
});

test("sub-second duration uses millisecond precision and zero duration is safe", () => {
  assert.equal(calculateStats("abcde", "abcde", 500).wpm, 120);
  assert.equal(calculateStats("abcde", "abcde", 0).wpm, 0);
  assert.equal(calculateStats("abcde", "abcde", -1).wpm, 0);
});

function createRaceGame(playerCount) {
  const players = Object.fromEntries(Array.from({ length: playerCount }, (_, index) => {
    const player = {
      id: `player-${index + 1}`,
      finished: false,
      connected: true,
      finishPosition: null,
      finishTime: null,
      wpm: 42 + index,
      rawWpm: 45 + index,
      accuracy: 80 + index,
      typedProgress: 0
    };
    return [player.id, player];
  }));
  return {
    status: "running",
    mode: "race",
    raceTarget: "apple house",
    startedAt: 10_000,
    nextFinishPosition: 1,
    players
  };
}

function finishPlayer(game, playerId, time = 16_000) {
  return finishRace(game, game.players[playerId], "applx housx", time);
}

test("first, second, and third finishers receive places while the race remains active", () => {
  const game = createRaceGame(4);
  for (const [index, playerId] of ["player-1", "player-2", "player-3"].entries()) {
    assert.equal(finishPlayer(game, playerId, 16_000 + index * 1000), true);
    assert.equal(game.players[playerId].finishPosition, index + 1);
    assert.equal(game.status, "running");
    assert.equal(endRaceIfComplete(game), false);
  }
});

test("race results start only after every connected player finishes", () => {
  const game = createRaceGame(3);
  finishPlayer(game, "player-1");
  finishPlayer(game, "player-2");
  assert.equal(game.status, "running");
  finishPlayer(game, "player-3");

  assert.equal(endRaceIfComplete(game), true);
  assert.equal(game.status, "results");
  assert.equal(endRaceIfComplete(game), false);
});

test("disconnecting an unfinished player lets remaining finishers end the race", () => {
  const game = createRaceGame(3);
  game.players["player-2"].connected = false;
  finishPlayer(game, "player-1");
  assert.equal(endRaceIfComplete(game), false);
  finishPlayer(game, "player-3");

  assert.equal(endRaceIfComplete(game), true);
  assert.equal(game.players["player-2"].finished, false);
  assert.equal(game.players["player-2"].connected, false);
});

test("finishing preserves final statistics and rejects later input", () => {
  const game = createRaceGame(2);
  const player = game.players["player-1"];
  assert.equal(finishPlayer(game, player.id), true);
  const snapshot = {
    finishPosition: player.finishPosition,
    finishTime: player.finishTime,
    finalWpm: player.finalWpm,
    finalAccuracy: player.finalAccuracy,
    typedProgress: player.typedProgress
  };

  player.wpm = 999;
  player.accuracy = 100;
  assert.equal(finishPlayer(game, player.id, 99_000), false);
  assert.deepEqual({
    finishPosition: player.finishPosition,
    finishTime: player.finishTime,
    finalWpm: player.finalWpm,
    finalAccuracy: player.finalAccuracy,
    typedProgress: player.typedProgress
  }, snapshot);
});

test("a completed race always has a nonzero final WPM when input was entered", () => {
  const game = createRaceGame(1);
  const player = game.players["player-1"];
  player.wpm = 0;
  player.rawWpm = 0;
  assert.equal(finishPlayer(game, player.id, 16_000), true);
  assert.ok(player.finalWpm > 0);
});

test("duplicate finish events never change an assigned finishing position", () => {
  const game = createRaceGame(3);
  finishPlayer(game, "player-1");
  const nextPosition = game.nextFinishPosition;
  assert.equal(finishPlayer(game, "player-1", 99_000), false);
  assert.equal(game.players["player-1"].finishPosition, 1);
  assert.equal(game.nextFinishPosition, nextPosition);
  finishPlayer(game, "player-2");
  assert.equal(game.players["player-2"].finishPosition, 2);
});

test("duplicate progress after completion cannot mutate final metrics", () => {
  const game = createRaceGame(2);
  const player = game.players["player-1"];
  const typed = "applx housx";
  assert.equal(finishRace(game, player, typed, 16_000), true);
  const finalValues = [player.finishPosition, player.finishTime, player.finalWpm, player.finalRawWpm, player.finalAccuracy];

  assert.equal(finishRace(game, player, "zzzzzzzzzzz", 99_000), false);
  assert.deepEqual([player.finishPosition, player.finishTime, player.finalWpm, player.finalRawWpm, player.finalAccuracy], finalValues);
});

test("one player's finish does not interrupt another player's typing", () => {
  const game = createRaceGame(2);
  finishPlayer(game, "player-1");
  assert.equal(game.status, "running");
  game.players["player-2"].typedProgress = 6;
  assert.equal(game.players["player-2"].typedProgress, 6);
  assert.equal(game.players["player-2"].finished, false);
});

test("a one-player race enters results immediately after that player finishes", () => {
  const game = createRaceGame(1);
  finishPlayer(game, "player-1");
  assert.equal(endRaceIfComplete(game), true);
  assert.equal(game.status, "results");
  assert.equal(game.players["player-1"].finishPosition, 1);
});

test("Race completion accepts the final position with or without a terminal space", () => {
  for (const typed of ["apple housx", "apple housx "]) {
    const game = createRaceGame(2);
    const player = game.players["player-1"];
    assert.equal(completeRace(game, player, typed, 16_000), true);
    assert.equal(game.status, "running");
    assert.equal(player.finished, true);
    assert.equal(player.finishTime, 6_000);
    assert.equal(player.finalWpm, 20);
    assert.equal(player.finalRawWpm, typed.length === 11 ? 22 : 24);
    assert.equal(player.finalAccuracy, typed.length === 11 ? 90.9 : 83.3);
    assert.equal(completeRace(game, player, typed, 17_000), false);
  }
});

test("server completion validates the submitted character position", () => {
  const game = createRaceGame(1);
  const player = game.players["player-1"];

  assert.equal(completeRace(game, player, "apple house", 16_000, 10), false);
  assert.equal(player.finished, false);
  assert.equal(completeRace(game, player, "apple house", 16_000, 12), false);
  assert.equal(player.finished, false);
  assert.equal(completeRace(game, player, "apple house", 16_000, 11), true);
  assert.equal(player.finished, true);
});

test("race completion uses input position and safely accepts extra input", () => {
  assert.equal(isRaceComplete("apple house", "apple hous"), false);
  assert.equal(isRaceComplete("apple house", "appl house"), false);
  assert.equal(isRaceComplete("apple house", "applx house"), true);
  assert.equal(isRaceComplete("apple house", "apple houses more"), true);
  assert.equal(isRaceComplete("apple house", "applex houses"), true);
  assert.equal(isRaceComplete("apple house", " apple house"), true);
  assert.equal(isRaceComplete("apple house", "apple house  "), true);
  assert.equal(isRaceComplete("apple house", "apple  house"), true);
  assert.equal(isRaceComplete("apple house", "apple house"), true);
  assert.equal(isRaceComplete("apple house", "apple house "), true);
});

test("perfect typing, one typo, and multiple typos all finish by typed position", () => {
  const target = "abcdefghij";
  for (const typed of ["abcdefghij", "zbcdefghij", "zzzzzzzzzz"]) {
    const game = { status: "running", mode: "race", raceTarget: target, startedAt: 1_000 };
    const player = { finished: false, finishTime: null };
    assert.equal(completeRace(game, player, typed, 2_000), true);
    assert.equal(player.finished, true);
    assert.equal(game.status, "running");
  }
});

test("80% and 50% accuracy do not prevent race completion", () => {
  const target = "abcdefghij";
  const eightyPercent = "zbcdefghiz";
  const fiftyPercent = "zzzzzfghij";

  assert.equal(analyzeTyping(target, eightyPercent).accuracy, 80);
  assert.equal(analyzeTyping(target, fiftyPercent).accuracy, 50);
  for (const typed of [eightyPercent, fiftyPercent]) {
    const game = { status: "running", mode: "race", raceTarget: target, startedAt: 1_000 };
    const player = { finished: false, finishTime: null };
    assert.equal(completeRace(game, player, typed, 2_000), true);
    assert.equal(player.finished, true);
    assert.equal(game.status, "running");
  }
});

test("typing mistakes continue to advance race progress by input position", () => {
  const analysis = analyzeTyping("apple house", "applx housx");

  assert.equal(analysis.progressChars, 11);
  assert.equal(analysis.complete, true);
  assert.equal(analysis.accuracy, 81.8);
});

test("Race passage length defaults to 50 and supports 25 and 100 word targets", () => {
  assert.equal(getPassageWordCount("race", undefined, 15), 50);
  assert.equal(getPassageWordCount("race", 25, 15), 25);
  assert.equal(getPassageWordCount("race", 50, 15), 50);
  assert.equal(getPassageWordCount("race", 100, 15), 100);
  assert.equal(getPassageWordCount("race", 500, 15), 50);
});

test("Time Attack receives a duration-sized initial passage without changing race length", () => {
  assert.equal(getPassageWordCount("time", 50, 15), 85);
  assert.equal(getPassageWordCount("time", 50, 30), 130);
  assert.equal(getPassageWordCount("time", 50, 60), 220);
});

test("an empty countdown returns to the lobby and clears its start timestamps", () => {
  const game = {
    status: "countdown",
    startedAt: 13_000,
    endsAt: 28_000,
    raceTarget: "apple house"
  };

  assert.equal(cancelEmptyCountdown(game), true);
  assert.deepEqual(game, {
    status: "lobby",
    startedAt: null,
    endsAt: null,
    raceTarget: null
  });
});

test("Time Attack deadline ends results at the configured elapsed duration while idle", () => {
  let now = 1_000;
  let scheduled;
  let expirationCount = 0;
  const game = { status: "running", mode: "time", endsAt: 16_000 };
  const setTimer = (callback, delay) => {
    scheduled = { callback, delay };
    return scheduled;
  };
  const clearTimer = () => {};
  const cancel = scheduleTimeAttackExpiration(game, () => {
    if (expireTimeAttack(game, now)) expirationCount++;
  }, { now: () => now, setTimer, clearTimer });

  assert.equal(scheduled.delay, 15_000);
  now = 15_999;
  scheduled.callback();
  assert.equal(game.status, "running");
  assert.equal(expirationCount, 0);
  assert.equal(scheduled.delay, 1);
  now = 16_000;
  scheduled.callback();
  assert.equal(game.status, "results");
  assert.equal(expirationCount, 1);
  cancel();
});

test("WPM is zero before one second and never divides by zero", () => {
  assert.equal(calculateStats("abc", "abc", 0).wpm, 0);
  assert.equal(calculateStats("abc", "abc", -1).wpm, 0);
});

test("passage extension starts before the player reaches the final words", () => {
  const passage = Array.from({ length: 160 }, (_, index) => `word${index}`).join(" ");
  const nearEnd = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ");
  const earlier = Array.from({ length: 119 }, (_, index) => `word${index}`).join(" ");

  assert.equal(shouldExtendPassage(passage, nearEnd), true);
  assert.equal(shouldExtendPassage(passage, earlier), false);
  assert.equal(shouldExtendPassage(`${passage} word160`, nearEnd), false);
});
