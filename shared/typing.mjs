function getTokens(value) {
  return [...value.matchAll(/[^ ]+/g)].map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length
  }));
}

export function getTypingPosition(value) {
  return Array.from(value).length;
}

export function analyzeTyping(passage, typed) {
  const targetChars = Array.from(passage);
  const typedChars = Array.from(typed);
  const correctChars = typedChars.reduce((count, char, index) => (
    count + Number(index < targetChars.length && char === targetChars[index])
  ), 0);
  const totalChars = typedChars.length;
  const accuracy = totalChars
    ? Math.round((correctChars / totalChars) * 1000) / 10
    : 100;
  const typedTokens = getTokens(typed);

  return {
    targetWords: passage.split(" "),
    typedTokens,
    correctChars,
    totalChars,
    missingChars: Math.max(0, targetChars.length - totalChars),
    accuracy,
    progressChars: Math.min(totalChars, targetChars.length),
    currentWordIndex: typedTokens.length
      ? typedTokens.length - Number(typed.endsWith(" "))
      : 0,
    complete: isRaceComplete(passage, typed, totalChars)
  };
}

export function isRaceComplete(target, typed, typedPosition) {
  if (typeof target !== "string" || target.length === 0 || typeof typed !== "string") {
    return false;
  }

  const actualPosition = getTypingPosition(typed);
  const position = typedPosition === undefined ? actualPosition : typedPosition;
  return Number.isSafeInteger(position)
    && position === actualPosition
    && position >= getTypingPosition(target);
}

export function analyzeTypingWords(targetWords, typed) {
  const analysis = analyzeTyping(targetWords.join(" "), typed);
  return { ...analysis, targetWords };
}

export function calculateStats(passage, typed, elapsedMs) {
  const { correctChars, totalChars, accuracy, progressChars } = analyzeTyping(passage, typed);
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const elapsedMinutes = safeElapsedMs / 60000;
  const netWpm = elapsedMinutes > 0 ? (correctChars / 5) / elapsedMinutes : 0;
  const grossWpm = elapsedMinutes > 0 ? (totalChars / 5) / elapsedMinutes : 0;
  return {
    wpm: Math.round(netWpm * 10) / 10,
    rawWpm: Math.round(grossWpm * 10) / 10,
    netWpm: Math.round(netWpm * 10) / 10,
    grossWpm: Math.round(grossWpm * 10) / 10,
    accuracy,
    correctChars,
    totalChars,
    progressChars
  };
}

export function shouldExtendPassage(passage, typed, wordsAhead = 40) {
  const remainingWords = passage.split(" ").length - getTokens(typed).length;
  return remainingWords <= wordsAhead;
}
