import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Crown, Keyboard } from "lucide-react";

const PassageCharacter = memo(function PassageCharacter({ char, state, caretRef }) {
  return <span className={`char ${state}`} ref={caretRef}>{char}</span>;
});

const PassageWord = memo(function PassageWord({ word, typedChars, startIndex, showSeparator, caretRef }) {
  const wordChars = [...word];
  const chars = wordChars.map((char, charIndex) => {
    const position = startIndex + charIndex;
    let state = position < typedChars.length
      ? typedChars[position] === char ? "correct" : "incorrect"
      : "pending";
    if (position === typedChars.length) state += " current";
    return (
      <PassageCharacter
        key={charIndex}
        char={char}
        state={state}
        caretRef={state.includes("current") ? caretRef : undefined}
      />
    );
  });

  return (
    <span className="word">
      {chars}
      {showSeparator && (
        <PassageCharacter
          char=" "
          state={startIndex + wordChars.length < typedChars.length
            ? typedChars[startIndex + wordChars.length] === " " ? "correct" : "incorrect"
            : startIndex + wordChars.length === typedChars.length ? "current" : "pending"}
          caretRef={startIndex + wordChars.length === typedChars.length ? caretRef : undefined}
        />
      )}
    </span>
  );
});

const TypingMetrics = memo(function TypingMetrics({
  status,
  liveWpm,
  grossWpm,
  accuracy,
  progressChars,
  progressLength,
  playerFinished,
  resultWpm,
  resultGrossWpm,
  resultAccuracy
}) {
  const shownNetWpm = status === "running" && !playerFinished ? liveWpm : resultWpm;
  const shownGrossWpm = status === "running" && !playerFinished ? grossWpm : resultGrossWpm;
  const shownAccuracy = status === "running" && !playerFinished ? accuracy : resultAccuracy;

  return (
    <div className={`metrics ${status === "lobby" ? "metrics-idle" : ""}`}>
      <div className="metric"><span className="metric-label">NET WPM</span><strong>{status === "lobby" ? "—" : shownNetWpm}</strong></div>
      <div className="metric"><span className="metric-label">GROSS WPM</span><strong>{status === "lobby" ? "—" : shownGrossWpm}</strong></div>
      <div className="metric"><span className="metric-label">ACCURACY</span><strong>{status === "lobby" ? "—" : `${shownAccuracy}%`}</strong></div>
      <div className="metric"><span className="metric-label">PROGRESS</span><strong>{progressChars}<small>/{progressLength}</small></strong></div>
    </div>
  );
});

const TypingTimer = memo(function TypingTimer({ status, mode, duration, startedAt, endsAt, serverOffset }) {
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (status !== "running") return undefined;
    const ticker = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(ticker);
  }, [status]);

  if (status !== "running") return null;
  const serverClock = clock + serverOffset;
  const elapsedSeconds = startedAt ? Math.max(0, serverClock - startedAt) / 1000 : 0;
  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - serverClock) / 1000)) : duration;
  return <span className="timer">{mode === "time" ? `${remaining}s` : `${Math.floor(elapsedSeconds)}s elapsed`}</span>;
});

const CountdownOverlay = memo(function CountdownOverlay({ startedAt, serverOffset }) {
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const ticker = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(ticker);
  }, []);

  const countdown = Math.max(1, Math.ceil((startedAt - (clock + serverOffset)) / 1000));
  return <div className="countdown-overlay"><span className="countdown-label">GET READY</span><strong>{countdown}</strong><span>find your rhythm</span></div>;
});

const TypingPanel = memo(function TypingPanel({
  status,
  mode,
  duration,
  passage,
  raceTargetLength,
  startedAt,
  endsAt,
  serverOffset,
  playerFinished,
  liveWpm,
  grossWpm,
  liveAccuracy,
  typedProgress,
  resultWpm,
  resultGrossWpm,
  resultAccuracy,
  won,
  onProgress,
  onReset
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef(null);
  const viewportRef = useRef(null);
  const currentCaretRef = useRef(null);

  useEffect(() => {
    if (status === "lobby" || status === "results") setTyped("");
  }, [status]);

  useEffect(() => {
    if (status === "running") inputRef.current?.focus();
  }, [status]);

  const targetWords = useMemo(() => {
    let position = 0;
    return passage.split(" ").map((word) => {
      const layout = { word, startIndex: position };
      position += Array.from(word).length + 1;
      return layout;
    });
  }, [passage]);
  const targetCharacters = useMemo(() => Array.from(passage), [passage]);
  const typedCharacters = useMemo(() => Array.from(typed), [typed]);
  const isPlaying = status === "running" && !playerFinished;
  const progressLength = mode === "race" ? raceTargetLength || targetCharacters.length : targetCharacters.length;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const caret = currentCaretRef.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !caret || !content) return;

    const caretBounds = caret.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    const lineHeight = Number.parseFloat(window.getComputedStyle(caret).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

    const visibleLines = Math.max(1, Math.floor(viewport.clientHeight / lineHeight));
    const activeLine = Math.max(0, Math.floor((caretBounds.top - contentBounds.top) / lineHeight));
    const targetLine = Math.max(0, activeLine - Math.floor(visibleLines / 2));
    const targetScrollTop = targetLine * lineHeight;
    if (Math.abs(viewport.scrollTop - targetScrollTop) >= lineHeight / 2) {
      viewport.scrollTop = targetScrollTop;
    }
  }, [typed, passage]);

  const focusInput = useCallback(() => {
    if (status === "running" && !playerFinished) inputRef.current?.focus();
  }, [status, playerFinished]);

  const handleType = useCallback((event) => {
    if (status !== "running" || playerFinished) return;
    const next = event.target.value.toLowerCase();
    const clipped = Array.from(next).slice(0, targetCharacters.length + 256).join("");
    setTyped(clipped);
    onProgress(clipped, Array.from(clipped).length);

  }, [onProgress, playerFinished, status, targetCharacters.length]);

  return (
    <section className="typing-panel">
      <div className="typing-meta">
        <div className="typing-meta-left">
          <span className="section-tag"><Activity size={14} /> {status === "lobby" ? "READY ROOM" : status === "countdown" ? "GET READY" : status === "results" ? "RACE COMPLETE" : "LIVE SESSION"}</span>
          <span className="meta-separator">/</span>
          <span className="meta-muted">{mode === "race" ? "shared passage" : "time attack"}</span>
        </div>
        <div className="typing-meta-right">
          <TypingTimer
            status={status}
            mode={mode}
            duration={duration}
            startedAt={startedAt}
            endsAt={endsAt}
            serverOffset={serverOffset}
          />
          <span className="word-count">{targetWords.length} words</span>
        </div>
      </div>
      <TypingMetrics
        status={status}
        liveWpm={liveWpm}
        grossWpm={grossWpm}
        accuracy={playerFinished ? resultAccuracy : liveAccuracy}
        progressChars={typedProgress}
        progressLength={progressLength}
        playerFinished={playerFinished}
        resultWpm={resultWpm}
        resultGrossWpm={resultGrossWpm}
        resultAccuracy={resultAccuracy}
      />

      <div className={`word-area ${status === "lobby" ? "idle" : ""}`} onClick={focusInput}>
        <div className="passage-viewport" ref={viewportRef}>
          <div className="passage-content">
            {targetWords.map(({ word, startIndex }, wordIndex) => {
              return (
                <PassageWord
                  key={wordIndex}
                  word={word}
                  typedChars={typedCharacters}
                  startIndex={startIndex}
                  showSeparator={wordIndex < targetWords.length - 1}
                  caretRef={isPlaying ? currentCaretRef : undefined}
                />
              );
            })}
            {typedCharacters.slice(targetCharacters.length).map((char, index) => (
              <span className="char incorrect" key={`extra-${index}`}>{char}</span>
            ))}
            {isPlaying && typedCharacters.length >= targetCharacters.length && <span className="typing-caret" ref={currentCaretRef} />}
          </div>
        </div>
        {status === "lobby" && <div className="typing-overlay"><span className="overlay-icon"><Keyboard size={22} /></span><strong>the words are waiting.</strong><span>hit start race, then type here.</span></div>}
        {status === "countdown" && <CountdownOverlay startedAt={startedAt} serverOffset={serverOffset} />}
        {status === "results" && <div className="result-overlay"><span className="result-icon">{won ? <Crown size={24} /> : <Check size={24} />}</span><strong>{won ? "you took the crown." : "race complete."}</strong><span>{resultWpm} wpm · {resultAccuracy}% accuracy</span></div>}
        <textarea
          ref={inputRef}
          className="typing-input"
          aria-label="Type the displayed words"
          value={typed}
          onChange={handleType}
          onPaste={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              event.preventDefault();
              if (status === "results") onReset();
            }
            if (event.key === "Enter") event.preventDefault();
          }}
          spellCheck="false"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          disabled={!isPlaying}
        />
      </div>
      <div className="typing-footer">
        <div className="keyboard-hint"><kbd>tab</kbd><span> + </span><kbd>enter</kbd><span> restart after results</span></div>
        <div className="type-status"><span className={isPlaying ? "pulse" : ""} />{status === "running" ? (playerFinished ? "finished — waiting for others" : "typing in progress") : status === "countdown" ? "race starting soon" : status === "results" ? "session ended" : "waiting for the host"}</div>
      </div>
    </section>
  );
});

export default TypingPanel;
