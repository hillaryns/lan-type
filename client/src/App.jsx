import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Activity, ArrowRight, Check, CircleHelp, Crown, Keyboard, RotateCcw, Settings2, Users, Zap } from "lucide-react";
import TypingPanel from "./TypingPanel.jsx";

const socket = io(
  `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_SOCKET_PORT || 5000}`,
  { autoConnect: true, transports: ["websocket", "polling"] }
);

const initialState = {
  status: "connecting",
  mode: "race",
  duration: 15,
  raceLength: 50,
  passage: "",
  raceTargetLength: 0,
  startedAt: null,
  endsAt: null,
  players: []
};

const Topbar = memo(function Topbar({ connected }) {
  return (
    <header className="topbar">
      <a className="brand" href="#" aria-label="lan type home">
        <span className="brand-mark"><Keyboard size={19} strokeWidth={2.5} /></span>
        <span>lan<span className="brand-light">type</span></span>
        <span className="beta">LAN EDITION</span>
      </a>
      <div className="topbar-right">
        <span className={`connection ${connected ? "online" : "offline"}`}>
          <span className="connection-dot" /> {connected ? "connected" : "reconnecting"}
        </span>
        <button className="icon-button" title="About LAN Type" onClick={() => window.alert("LAN Type — a local Wi-Fi typing race. The host runs the server; friends visit the host's local IP address.")}>
          <CircleHelp size={18} />
        </button>
      </div>
    </header>
  );
});

const LobbyCard = memo(function LobbyCard({ playerCount }) {
  const [copied, setCopied] = useState(false);
  const copyAddress = useCallback(async () => {
    const address = `${window.location.protocol}//${window.location.hostname}:5173`;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this address for friends on the same Wi-Fi:", address);
    }
  }, []);

  return (
    <div className="host-card">
      <div className="host-card-head"><Users size={15} /><span>SHARED LOBBY</span><span className="live-pill">LIVE</span></div>
      <div className="host-count"><strong>{playerCount}</strong><span>{playerCount === 1 ? "player connected" : "players connected"}</span></div>
      <button className="share-button" onClick={copyAddress}>{copied ? <Check size={15} /> : <ArrowRight size={15} />}{copied ? "address copied" : "invite friends"} </button>
      <p className="host-hint">friends open the host's ip on port 5173</p>
    </div>
  );
});

const Hero = memo(function Hero({ playerCount }) {
  return (
    <section className="hero-row">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" /> SAME WI-FI. SAME WORDS. ONE WINNER.</div>
        <h1>type fast.<br /><span>talk trash later.</span></h1>
        <p className="subtitle">a tiny typing arena for your local network.</p>
      </div>
      <LobbyCard playerCount={playerCount} />
    </section>
  );
});

const Toolbar = memo(function Toolbar({ mode, duration, raceLength, status, onConfigure }) {
  const locked = status === "running" || status === "countdown";
  return (
    <section className="toolbar">
      <div className="toolbar-group">
        <span className="toolbar-label"><Settings2 size={14} /> MODE</span>
        <div className="segmented">
          <button className={mode === "race" ? "selected" : ""} disabled={locked} onClick={() => onConfigure("mode", "race")}>race</button>
          <button className={mode === "time" ? "selected" : ""} disabled={locked} onClick={() => onConfigure("mode", "time")}>time attack</button>
        </div>
      </div>
      <div className="toolbar-group">
        <span className="toolbar-label"><Zap size={14} /> {mode === "race" ? "WORDS" : "TIME"}</span>
        <div className="segmented compact">
          {(mode === "race" ? [25, 50, 100] : [15, 30, 60]).map((value) => {
            const selected = mode === "race" ? raceLength === value : duration === value;
            return (
              <button
                key={value}
                className={selected ? "selected" : ""}
                disabled={locked}
                onClick={() => onConfigure(mode === "race" ? "raceLength" : "duration", value)}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>
      <div className="toolbar-spacer" />
      <div className="room-status"><span className="room-dot" /> automatic lobby <span className="slash">/</span> no code needed</div>
    </section>
  );
});

const Leaderboard = memo(function Leaderboard({ players, playerId, status }) {
  return (
    <div className="leaderboard panel">
      <div className="panel-heading">
        <div><span className="heading-icon"><Crown size={16} /></span><div><h2>the leaderboard</h2><p>every keystroke counts.</p></div></div>
        <span className="player-count">{players.length.toString().padStart(2, "0")} PLAYERS</span>
      </div>
      {players.length === 0 ? <div className="empty-state">no one's here yet. suspicious.</div> : (
        <div className="player-list">
          {players.map((player, index) => (
            <div className={`player-row ${player.id === playerId ? "you" : ""}`} key={player.id}>
              <span className={`rank ${player.finishPosition === 1 ? "first" : ""}`}>
                {player.finishPosition === 1 ? <Crown size={14} /> : player.finished ? `${player.finishPosition}${player.finishPosition === 2 ? "ND" : player.finishPosition === 3 ? "RD" : "TH"}` : status === "results" && !player.connected ? "DNF" : String(index + 1).padStart(2, "0")}
              </span>
              <div className="player-info"><span className="player-name">{player.name}{player.id === playerId && <em>YOU</em>}{!player.connected && <em className="left-tag">LEFT</em>}</span><div className="progress-track"><span style={{ width: `${player.progress}%` }} /></div></div>
              <div className="player-stats"><strong>{player.wpm}</strong><span>wpm</span></div>
              <div className="player-accuracy">{player.accuracy}%<span>acc</span></div>
              {player.finished && <span className="finished-tag">DONE</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const RaceResults = memo(function RaceResults({ players }) {
  const finishers = [...players].filter((player) => player.finished)
    .sort((a, b) => a.finishPosition - b.finishPosition);
  const didNotFinish = players.filter((player) => !player.finished);
  const ordinal = (position) => {
    const lastTwoDigits = position % 100;
    const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
      ? "TH"
      : position % 10 === 1 ? "ST" : position % 10 === 2 ? "ND" : position % 10 === 3 ? "RD" : "TH";
    return `${position}${suffix}`;
  };
  const formatTime = (milliseconds) => `${(milliseconds / 1000).toFixed(2)}s`;

  return (
    <section className="race-results panel">
      <div className="panel-heading">
        <div><span className="heading-icon"><Crown size={16} /></span><div><h2>final podium</h2><p>the race is complete.</p></div></div>
        <span className="player-count">{finishers.length} FINISHERS</span>
      </div>
      <div className="results-list">
        {finishers.map((player) => (
          <div className={`results-row ${player.finishPosition <= 3 ? `place-${player.finishPosition}` : ""}`} key={player.id}>
            <strong className="results-place">{player.finishPosition === 1 ? <Crown size={16} /> : ordinal(player.finishPosition)}</strong>
            <span className="results-player">{player.name}{!player.connected && <em>LEFT</em>}</span>
            <span className="results-stat">{player.wpm}<small>WPM</small></span>
            <span className="results-stat">{player.accuracy}%<small>ACCURACY</small></span>
            <span className="results-stat">{formatTime(player.finishTime ?? 0)}<small>FINISH</small></span>
          </div>
        ))}
        {didNotFinish.map((player) => (
          <div className="results-row did-not-finish" key={player.id}>
            <strong className="results-place">DNF</strong>
            <span className="results-player">{player.name}<em>DISCONNECTED</em></span>
            <span className="results-stat">{player.wpm}<small>WPM</small></span>
            <span className="results-stat">{player.accuracy}%<small>ACCURACY</small></span>
            <span className="results-stat">—<small>FINISH</small></span>
          </div>
        ))}
      </div>
    </section>
  );
});

const RaceControl = memo(function RaceControl({ status, name, onNameChange, onStart, onReset }) {
  return (
    <aside className="control-panel panel">
      <div className="panel-heading">
        <div><span className="heading-icon"><Zap size={16} /></span><div><h2>race control</h2><p>your lobby, your rules.</p></div></div>
      </div>
      <label className="name-label" htmlFor="player-name">YOUR CALLSIGN</label>
      <input id="player-name" className="name-input" value={name} maxLength={18} onChange={(event) => onNameChange(event.target.value)} placeholder="pick a name" />
      <div className="control-note"><span className="note-dot" /><p>{status === "running" ? "race is live. no backing out now." : status === "countdown" ? "get those fingers ready." : status === "results" ? "the damage is done. run it back?" : "everyone connected? start when ready."}</p></div>
      {status === "lobby" || status === "results" ? (
        <button className="start-button" onClick={status === "results" ? onReset : onStart}>
          {status === "results" ? <><RotateCcw size={16} /> back to lobby</> : <><Zap size={16} fill="currentColor" /> start race <ArrowRight size={16} /></>}
        </button>
      ) : (
        <button className="start-button disabled-button" disabled><Activity size={16} /> {status === "countdown" ? "starting..." : "race in progress"}</button>
      )}
      {status === "results" && <button className="secondary-button" onClick={onStart}>run it back <RotateCcw size={14} /></button>}
      <div className="control-foot"><span>HOST CONTROLS</span><span>SOCKET.IO / LAN</span></div>
    </aside>
  );
});

const Footer = memo(function Footer() {
  return (
    <footer className="footer">
      <span><span className="footer-logo">lt.</span> built for friendly rivalries.</span>
      <span>LOCAL NETWORK ONLY <span className="footer-divider">·</span> NO ACCOUNTS <span className="footer-divider">·</span> ALL LOWERCASE</span>
    </footer>
  );
});

function App() {
  const [game, setGame] = useState(initialState);
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const serverOffsetRef = useRef(null);

  useEffect(() => {
    const onWelcome = (data) => {
      setPlayerId(data.id);
      setName(data.name);
    };
    const onState = (state) => {
      setGame(state);
      if (serverOffsetRef.current === null && Number.isFinite(state.serverNow)) {
        serverOffsetRef.current = state.serverNow - Date.now();
        setServerOffset(serverOffsetRef.current);
      }
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("session:welcome", onWelcome);
    socket.on("game:state", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("session:welcome", onWelcome);
      socket.off("game:state", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  const me = game.players.find((p) => p.id === playerId);
  const sortedPlayers = useMemo(() => [...game.players].sort((a, b) => {
    if (game.mode === "time" && game.status === "results") {
      return b.wpm - a.wpm || b.accuracy - a.accuracy;
    }
    if (a.finished && b.finished) return a.finishPosition - b.finishPosition;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (b.progress !== a.progress) return b.progress - a.progress;
    return b.wpm - a.wpm;
  }), [game.mode, game.players, game.status]);

  const configure = useCallback((key, value) => {
    socket.emit("game:configure", {
      mode: key === "mode" ? value : game.mode,
      duration: key === "duration" ? Number(value) : game.duration,
      raceLength: key === "raceLength" ? Number(value) : game.raceLength
    });
  }, [game.duration, game.mode, game.raceLength]);

  const start = useCallback(() => {
    socket.emit("game:start");
  }, []);

  const reset = useCallback(() => {
    socket.emit("game:reset");
  }, []);

  const sendProgress = useCallback((typed, typedPosition) => {
    socket.emit("player:progress", { typed, typedPosition });
  }, []);

  const updateName = useCallback((value) => {
    setName(value);
    socket.emit("player:name", value);
  }, []);

  const won = game.status === "results" && (game.mode === "race"
    ? me?.finishPosition === 1
    : sortedPlayers[0]?.id === playerId);

  return (
    <div className="app-shell">
      <Topbar connected={connected} />

      <main className="main">
        <Hero playerCount={game.players.length} />
        <Toolbar mode={game.mode} duration={game.duration} raceLength={game.raceLength} status={game.status} onConfigure={configure} />

        <TypingPanel
          status={game.status}
          mode={game.mode}
          duration={game.duration}
          passage={game.passage}
          raceTargetLength={game.raceTargetLength}
          startedAt={game.startedAt}
          endsAt={game.endsAt}
          serverOffset={serverOffset}
          playerFinished={Boolean(me?.finished)}
          liveWpm={me?.wpm ?? 0}
          grossWpm={me?.rawWpm ?? 0}
          liveAccuracy={me?.accuracy ?? 100}
          typedProgress={me?.typedProgress ?? 0}
          resultWpm={me?.wpm ?? 0}
          resultGrossWpm={me?.rawWpm ?? 0}
          resultAccuracy={me?.accuracy ?? 100}
          won={won}
          onProgress={sendProgress}
          onReset={reset}
        />

        {game.status === "results" && game.mode === "race" && <RaceResults players={game.players} />}

        <section className="bottom-grid">
          <Leaderboard players={sortedPlayers} playerId={playerId} status={game.status} />
          <RaceControl status={game.status} name={name} onNameChange={updateName} onStart={start} onReset={reset} />
        </section>
        <Footer />
      </main>
    </div>
  );
}

export default App;