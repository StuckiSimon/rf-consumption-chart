import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { teamColors } from "./teamColors";
import { countStepDuration, increasedTeams, isRowVisible, presentationDelay, scrollPresentation } from "./presentation";
import { useIdleDisplay } from "./useIdleDisplay";
import { mickyMessages, mickyReaction } from "./mickyMessages";
import { eventAnimation } from "./eventAnimation";
import type { DisplayMode } from "./idleDisplay";
import type { ScoreStatistics } from "./statistics";
import type { ClientMessage, Scoreboard, ServerMessage, SituationEvent, Team } from "./scoreboard";
import styles from "./App.module.css";

const AnimationOverlay = lazy(() => import("./AnimationOverlay").then(({ AnimationOverlay }) => ({ default: AnimationOverlay })));

const isEditor = window.location.pathname === "/edit";
const isAdmin = window.location.pathname === "/admin";
const isPresentation = !isEditor && !isAdmin;

export function App() {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cinematicEvents, setCinematicEvents] = useState<SituationEvent[]>([]);
  const [mickyEvent, setMickyEvent] = useState<SituationEvent | null>(null);
  const [error, setError] = useState("");
  const [boardBusy, setBoardBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setError(""), 2600);
  }, []);

  const completeCinematicEvent = useCallback((event: SituationEvent) => {
    setMickyEvent(event);
    setCinematicEvents((events) => events.slice(1));
  }, []);

  const idle = useIdleDisplay({
    scoreboard: isPresentation ? scoreboard : null,
    connected: isConnected,
    busy: boardBusy || cinematicEvents.length > 0,
    onError: showError,
  });

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let socket: WebSocket;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (active) setIsConnected(true);
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setIsConnected(false);
        reconnectTimer = setTimeout(connect, 1200);
      });
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("message", (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "state") setScoreboard(message.state);
        else if (message.type === "error") showError(message.message);
        else if (isPresentation) setCinematicEvents((events) => [...events, ...message.events]);
      });
    }

    connect();
    return () => {
      active = false;
      clearTimeout(reconnectTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      socketRef.current = null;
      socket?.close();
    };
  }, [showError]);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    updateFullscreen();
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const send = useCallback((message: ClientMessage) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      showError("Noch nicht verbunden – bitte gleich nochmals versuchen.");
      return;
    }
    socketRef.current.send(JSON.stringify(message));
  }, [showError]);

  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      showError("Der Vollbildmodus ist in diesem Browser nicht verfügbar.");
    }
  };

  const updatedTime = scoreboard
    ? new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date(scoreboard.updatedAt))
    : null;

  return (
    <MotionConfig reducedMotion="user">
      <header className={`${styles.topbar} ${isPresentation ? styles.presentationTopbar : ""}`}>
        {!isPresentation
          ? (
            <a className={styles.brand} href="/" aria-label="Reppischfäger Dietikon – Startseite">
              <img className={styles.brandLogo} src="/reppischfaeger-wordmark.svg" alt="Reppisch Fäger" />
            </a>
          )
          : (
            <div className={styles.brand}>
              <img className={styles.brandLogo} src="/reppischfaeger-wordmark.svg" alt="Reppisch Fäger" />
            </div>
          )}
        <div className={styles.topbarRight}>
          <span className={`${styles.liveStatus} ${!isConnected ? styles.offline : ""}`}>
            <i />{isConnected ? "Live" : "Verbindung wird hergestellt"}
          </span>
          {!isPresentation && (
            <a className={styles.modeLink} href="/">
              Rangliste anzeigen <span aria-hidden="true">↗</span>
            </a>
          )}
          {isPresentation && !isFullscreen && (
            <button
              className={styles.fullscreenButton}
              onClick={enterFullscreen}
              type="button"
              aria-label="Präsentation im Vollbild anzeigen"
              title="Vollbild"
            >
              <span aria-hidden="true">⛶</span>
              Vollbild
            </button>
          )}
        </div>
      </header>
      {isAdmin
        ? <Admin scoreboard={scoreboard} send={send} />
        : isEditor
        ? <Editor scoreboard={scoreboard} updatedTime={updatedTime} send={send} />
        : (
          <>
            <div hidden={idle.mode !== "scoreboard"}>
              <Board
                scoreboard={scoreboard}
                updatedTime={updatedTime}
                isAnnouncing={cinematicEvents.length > 0 || idle.transition || idle.mode !== "scoreboard"}
                onBusyChange={setBoardBusy}
                visible={idle.mode === "scoreboard"}
                mickyEvent={mickyEvent}
              />
            </div>
            {idle.mode !== "scoreboard" && idle.statistics && scoreboard && (
              <StatisticsBoard mode={idle.mode} statistics={idle.statistics} scoreboard={scoreboard} />
            )}
          </>
        )}
      {isPresentation && idle.transition && (
        <DisplayTransition onReveal={idle.reveal} onComplete={idle.complete} />
      )}
      {isPresentation && !idle.transition && idle.mode === "scoreboard" && cinematicEvents[0] && (
        <CinematicPresentation
          key={`${cinematicEvents[0].sourceEventId}-${cinematicEvents[0].type}`}
          event={cinematicEvents[0]}
          scoreboard={scoreboard}
          onComplete={completeCinematicEvent}
        />
      )}
      {error && <div className={styles.toast} role="status">{error}</div>}
    </MotionConfig>
  );
}

function Board({
  scoreboard,
  updatedTime,
  isAnnouncing,
  onBusyChange,
  visible,
  mickyEvent,
}: {
  scoreboard: Scoreboard | null;
  updatedTime: string | null;
  isAnnouncing: boolean;
  onBusyChange: (busy: boolean) => void;
  visible: boolean;
  mickyEvent: SituationEvent | null;
}) {
  const [presented, setPresented] = useState(scoreboard);
  const presentedRef = useRef(scoreboard);
  const receivedRef = useRef(scoreboard);
  const pendingRef = useRef<Scoreboard | null>(null);
  const lastReceivedAt = useRef(0);
  const returnScroll = useRef<AbortController | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const [teamOrder, setTeamOrder] = useState<string[] | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const countCompletions = useRef(new Map<string, () => void>());

  useEffect(() => {
    onBusyChange(hasPending);
  }, [hasPending, onBusyChange]);

  useEffect(() => {
    if (!scoreboard || receivedRef.current === scoreboard) return;
    receivedRef.current = scoreboard;
    pendingRef.current = scoreboard;
    lastReceivedAt.current = performance.now();
    returnScroll.current?.abort();
    setHasPending(true);
  }, [scoreboard]);

  useEffect(() => {
    if (!hasPending || isAnnouncing) return;
    const controller = new AbortController();
    const { signal } = controller;
    let finished = false;
    const update = (state: Scoreboard) => {
      presentedRef.current = state;
      setPresented(state);
    };
    const reveal = async (id: string) => {
      const row = rows.current.get(id);
      if (!row) return false;
      const rect = row.getBoundingClientRect();
      if (isRowVisible(rect, window.innerHeight)) return false;
      await scrollPresentation(window.scrollY + rect.top - (window.innerHeight - rect.height) / 2, signal);
      return true;
    };

    async function present() {
      await presentationDelay(350, signal);
      if (signal.aborted) return;
      while (pendingRef.current && !signal.aborted) {
        const target = pendingRef.current;
        pendingRef.current = null;
        const previous = presentedRef.current;
        const increases = increasedTeams(previous, target);
        const previousCounts = new Map(previous?.teams.map(({ id, drinks }) => [id, drinks]));
        const waiting = new Set(increases.map(({ id }) => id));
        const order = previous
          ? [...previous.teams].sort((a, b) => b.drinks - a.drinks || a.name.localeCompare(b.name, "de-CH")).map(({ id }) => id)
          : null;
        if (increases.length > 0) setTeamOrder((current) => current ?? order);
        let scrolled = false;

        for (const team of increases) {
          scrolled = await reveal(team.id) || scrolled;
          if (signal.aborted) return;
          waiting.delete(team.id);
          const counted = new Promise<void>((resolve) => {
            const finish = () => {
              countCompletions.current.delete(team.id);
              signal.removeEventListener("abort", finish);
              resolve();
            };
            countCompletions.current.set(team.id, finish);
            signal.addEventListener("abort", finish, { once: true });
          });
          update({
            ...target,
            teams: target.teams.map((candidate) => waiting.has(candidate.id)
              ? { ...candidate, drinks: previousCounts.get(candidate.id) ?? candidate.drinks }
              : candidate),
          });
          await counted;
          if (signal.aborted) return;
        }
        update(target);
        if (pendingRef.current) continue;
        await presentationDelay(scrolled || window.scrollY > 0 ? 600 : 150, signal);
        while (!signal.aborted && performance.now() - lastReceivedAt.current < 350) {
          await presentationDelay(350, signal);
        }
        if (signal.aborted) return;
        if (pendingRef.current) continue;
        setTeamOrder(null);
        await presentationDelay(1800, signal);
        if (signal.aborted) return;
        if (pendingRef.current) continue;
        if (window.scrollY > 0) {
          const returning = new AbortController();
          returnScroll.current = returning;
          const cancelReturn = () => returning.abort();
          signal.addEventListener("abort", cancelReturn, { once: true });
          await scrollPresentation(0, returning.signal);
          signal.removeEventListener("abort", cancelReturn);
          returnScroll.current = null;
        }
      }
      if (!signal.aborted) {
        finished = true;
        setHasPending(false);
      }
    }

    void present().catch((error: unknown) => {
      console.error("Die Ranglisten-Präsentation konnte nicht abgespielt werden.", error);
    });
    return () => {
      controller.abort();
      if (!finished && receivedRef.current) pendingRef.current = receivedRef.current;
    };
  }, [hasPending, isAnnouncing]);

  const date = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short" }).format(new Date()).toUpperCase();
  const teams = presented
    ? [...presented.teams].sort((a, b) => teamOrder
      ? teamOrder.indexOf(a.id) - teamOrder.indexOf(b.id)
      : b.drinks - a.drinks || a.name.localeCompare(b.name, "de-CH"))
    : [];
  const highestDrinks = Math.max(...teams.map((team) => team.drinks), 0);
  const maxDrinks = Math.ceil(highestDrinks / 50) * 50;

  return (
    <main className={`${styles.pageShell} ${styles.presentationShell}`}>
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Shot Egge<span>{date}</span></p>
          <h1>Zäme fiire. <span>Zäme zelle.</span></h1>
        </div>
        {visible && <MickySpeech mode="scoreboard" scoreboard={presented} event={mickyEvent} paused={isAnnouncing || hasPending} />}
      </section>
      <section className={styles.scoreSection} aria-labelledby="score-title">
        <div className={styles.chart}>
          <div className={styles.chartAxis} aria-hidden="true">
            <span />
            <div><span>0</span><span>{Math.ceil(maxDrinks / 2)}</span><span>{maxDrinks}</span></div>
            <span />
          </div>
          <div className={styles.chartRows} aria-live="polite">
            {teams.map((team, index) => (
              <TeamBar
                key={team.id}
                team={team}
                rank={index + 1}
                maxDrinks={maxDrinks}
                rowRef={(row) => {
                  if (row) rows.current.set(team.id, row);
                  else rows.current.delete(team.id);
                }}
                onCountComplete={() => countCompletions.current.get(team.id)?.()}
              />
            ))}
          </div>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>REPPISCHFÄGER DIETIKON <span aria-hidden="true">·</span> GUGGENMUSIK</span>
        <span>{updatedTime ? `AKTUALISIERT ${updatedTime}` : "Warte auf die Rangliste …"}</span>
      </footer>
    </main>
  );
}

function TeamBar({ team, rank, maxDrinks, rowRef, onCountComplete }: {
  team: Team;
  rank: number;
  maxDrinks: number;
  rowRef: (row: HTMLDivElement | null) => void;
  onCountComplete: () => void;
}) {
  const width = `${(team.drinks / maxDrinks) * 100}%`;

  return (
    <motion.div
      ref={rowRef}
      className={styles.chartRow}
      layout="position"
      style={{ "--team-color": team.color } as CSSProperties}
    >
      <div className={styles.chartTeam}>
        <i className={styles.teamDot} />
        <span className={styles.chartTeamName}>{team.name}</span>
        <span className={styles.teamRank}>#{rank}</span>
      </div>
      <div
        className={styles.barTrack}
        role="meter"
        aria-label={`Shots von ${team.name}`}
        aria-valuemin={0}
        aria-valuemax={maxDrinks}
        aria-valuenow={team.drinks}
      >
        <div className={styles.barFill} style={{ width }} />
      </div>
      <strong className={styles.barScore}>
        <AnimatedCount value={team.drinks} onComplete={onCountComplete} />
      </strong>
    </motion.div>
  );
}

function AnimatedCount({ value, onComplete }: { value: number; onComplete?: () => void }) {
  const [displayedValue, setDisplayedValue] = useState(value);
  const [isCounting, setIsCounting] = useState(false);
  const displayedRef = useRef(value);
  const previousTarget = useRef(value);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const previousValue = previousTarget.current;
    previousTarget.current = value;
    if (value <= previousValue) {
      displayedRef.current = value;
      setDisplayedValue(value);
      setIsCounting(false);
      completeRef.current?.();
      return;
    }

    setIsCounting(true);
    const difference = value - displayedRef.current;
    const stepDuration = countStepDuration(difference);
    let frame = 0;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let lastStepAt = performance.now();

    const count = (now: number) => {
      const steps = Math.floor((now - lastStepAt) / stepDuration);
      if (steps > 0) {
        const nextValue = Math.min(value, displayedRef.current + steps);
        displayedRef.current = nextValue;
        setDisplayedValue(nextValue);
        lastStepAt += steps * stepDuration;
        if (nextValue >= value) {
          finishTimer = setTimeout(() => {
            setIsCounting(false);
            completeRef.current?.();
          }, 260);
          return;
        }
      }
      frame = requestAnimationFrame(count);
    };

    frame = requestAnimationFrame(count);
    return () => {
      cancelAnimationFrame(frame);
      if (finishTimer) clearTimeout(finishTimer);
    };
  }, [value]);

  const digits = [...displayedValue.toLocaleString("de-CH")];

  return (
    <span
      aria-label={displayedValue.toLocaleString("de-CH")}
      className={`${styles.countValue} ${isCounting ? styles.counting : ""}`}
      role="text"
    >
      {digits.map((digit, index) => (
        <span aria-hidden="true" className={styles.flipDigit} key={digits.length - index - 1}>
          <AnimatePresence initial={false} mode="sync">
            <motion.span
              animate={{ y: "0%" }}
              className={styles.flipDigitFace}
              exit={{ y: "-100%" }}
              initial={{ y: "100%" }}
              key={digit}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {digit === " " ? "\u00a0" : digit}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

function CinematicPresentation({
  event,
  scoreboard,
  onComplete,
}: {
  event: SituationEvent;
  scoreboard: Scoreboard | null;
  onComplete: (event: SituationEvent) => void;
}) {
  const [phase, setPhase] = useState<"logo" | "event" | "out">("logo");
  const [logoMarkup, setLogoMarkup] = useState<string | null>(null);
  const [animation] = useState(() => eventAnimation(event));
  const showConfetti = event.type === "team-milestone"
    ? event.milestone % 100 === 0
    : event.leaderIds.length === 1;
  const team = "teamId" in event ? scoreboard?.teams.find(({ id }) => id === event.teamId) : undefined;
  const eventTeams = event.type === "team-milestone"
    ? team ? [team] : []
    : event.leaderIds.flatMap((id) => {
      const leader = scoreboard?.teams.find((candidate) => candidate.id === id);
      return leader ? [leader] : [];
    });
  const leaders = event.type === "leaders-changed"
    ? event.leaderIds.map((id) => scoreboard?.teams.find((candidate) => candidate.id === id)?.name).filter(Boolean)
    : [];
  const presentation = event.type === "team-milestone"
    ? { heading: team?.name ?? "Gruppen-Meilenstein", detail: `${event.milestone.toLocaleString("de-CH")} Shots erreicht!` }
    : leaders.length > 1
        ? { heading: "Gleichstand an der Spitze", detail: leaders.join(" · ") }
        : leaders.length === 1
          ? { heading: "Neue Spitze!", detail: leaders[0]! }
          : { heading: "Die Rangliste ist wieder offen", detail: "Auf ein Neues!" };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch("/reppischfaeger-logo.svg", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Logo request failed with status ${response.status}.`);
        return response.text();
      })
      .then((svg) => {
        const document = new DOMParser().parseFromString(svg, "image/svg+xml");
        if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
          throw new Error("The logo is not a valid SVG.");
        }
        const rows = new Map<string, { path: Element; x: number }[]>();
        document.querySelectorAll("path.cls-3").forEach((path) => {
          const start = path.getAttribute("d")?.match(/^M\s*([\d.]+)[,\s]+([\d.]+)/);
          if (!start) throw new Error("A logo letter has no starting point.");
          const row = Number(start[2]) < 670 ? "upper" : "lower";
          path.setAttribute("data-logo-row", row);
          const letters = rows.get(row) ?? [];
          letters.push({ path, x: Number(start[1]) });
          rows.set(row, letters);
        });
        rows.forEach((letters) => {
          letters.sort((a, b) => a.x - b.x).forEach(({ path }, index) => {
            path.setAttribute("style", `--letter-index: ${index}`);
          });
        });
        if (active) setLogoMarkup(document.documentElement.outerHTML);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Could not load the Reppischfäger logo for the event presentation.", error);
        setLogoMarkup("");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [event.sourceEventId, event.type]);

  useEffect(() => {
    if (logoMarkup === null) return;
    const eventStartsAt = logoMarkup ? 5800 : 0;
    const timers = [
      setTimeout(() => setPhase("event"), eventStartsAt),
      setTimeout(() => setPhase("out"), eventStartsAt + 4200),
      setTimeout(() => onComplete(event), eventStartsAt + 4700),
    ];
    return () => timers.forEach(clearTimeout);
  }, [event.sourceEventId, event.type, logoMarkup, onComplete]);

  return (
    <div className={styles.cinematicPresentation}>
      <motion.div
        animate={{ opacity: phase === "out" ? 0 : 1 }}
        className={styles.cinematicBackdrop}
        initial={{ opacity: 0 }}
        transition={{ duration: phase === "out" ? 0.5 : 0.6, ease: "easeInOut" }}
      />
      <div className={styles.cinematicLogoStage} aria-hidden="true">
        <AnimatePresence mode="wait">
          {phase === "logo" && logoMarkup && (
            <motion.div
              key="full-logo"
              className={styles.cinematicFullLogo}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            >
              <LogoArtwork markup={logoMarkup} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {phase === "event" && showConfetti && (
        <Confetti delay={logoMarkup ? 0.5 : 0} />
      )}
      <motion.div
        className={styles.cinematicCharacter}
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === "event" ? 1 : 0 }}
        transition={{ duration: 0.5, delay: phase === "event" && logoMarkup ? 0.5 : 0, ease: "easeInOut" }}
      >
        <Suspense fallback={null}>
          <AnimationOverlay
            embedded fullBody initialAnimation={animation} playing={phase === "event"}
            shirtColor={eventTeams[0]?.color}
            pantsColor={(eventTeams[1] ?? eventTeams[0])?.color}
          />
        </Suspense>
      </motion.div>
      <AnimatePresence>
        {phase === "event" && (
          <motion.div
            animate={{ opacity: 1 }}
            className={`${styles.cinematicEvent} ${styles.cinematicEventWithCharacter}`}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
            initial={{ opacity: 0 }}
            role="status"
            transition={{ delay: logoMarkup ? 0.5 : 0, duration: 0.6, ease: "easeInOut" }}
          >
            <span className={styles.cinematicEyebrow}>REPPISCHFÄGER DIETIKON</span>
            <h2>{presentation.heading}</h2>
            <motion.p
              animate={{ opacity: 1 }}
              initial={{ opacity: 0 }}
              transition={{ delay: (logoMarkup ? 0.5 : 0) + 0.6, duration: 0.3, ease: "easeInOut" }}
            >
              {presentation.detail}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Confetti({ delay }: { delay: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const id = useId();

  useEffect(() => {
    const canvas = canvasRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!canvas || reducedMotion.matches) return;
    let active = true;
    let destroy: (() => void) | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const stop = () => {
      active = false;
      timers.forEach(clearTimeout);
      destroy?.();
    };
    const onMotionChange = () => {
      if (reducedMotion.matches) stop();
    };
    reducedMotion.addEventListener("change", onMotionChange);

    async function start() {
      const { confetti } = await import("@tsparticles/confetti");
      if (!active) return;
      const options = {
        colors: ["#e40134", "#fdc800", "#0e4194"],
        shapes: ["square", "circle"],
        disableForReducedMotion: true,
        gravity: 0.8,
        ticks: 180,
      };
      const fire = await confetti.create(canvas, { ...options, count: 0 });
      const container = await fire({ count: 0 });
      if (!container) throw new Error("Could not initialize the confetti canvas.");
      destroy = () => container.destroy();
      if (!active) {
        destroy();
        return;
      }
      for (let burst = 0; burst < 3; burst++) {
        timers.push(setTimeout(() => {
          if (!active) return;
          void fire({
            ...options,
            count: 120,
            position: { x: 20 + burst * 30 + Math.random() * 10, y: -5 },
            angle: 270,
            spread: 140,
            startVelocity: 25 + Math.random() * 15,
            drift: 2,
            scalar: 1.3 + Math.random() * 0.7,
          }).then((particles) => {
            if (!active) particles?.destroy();
          }).catch((error: unknown) => {
            console.error("Could not animate the event confetti.", error);
            stop();
          });
        }, delay * 1000 + burst * 180 + Math.random() * 100));
      }
    }

    void start().catch((error: unknown) => {
      console.error("Could not initialize the event confetti.", error);
      stop();
    });
    return () => {
      stop();
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, [delay]);

  return <canvas ref={canvasRef} id={id} className={styles.confetti} aria-hidden="true" />;
}

function LogoArtwork({ markup }: { markup: string }) {
  return (
    <div
      aria-label="Logo Reppischfäger Dietikon"
      className={styles.cinematicArtwork}
      dangerouslySetInnerHTML={{ __html: markup }}
      role="img"
    />
  );
}

function DisplayTransition({ onReveal, onComplete }: { onReveal: () => void; onComplete: () => void }) {
  const [markup, setMarkup] = useState("");
  const [started, setStarted] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/reppischfaeger-logo.svg", { signal: controller.signal });
        if (!response.ok) throw new Error(`Logo request failed: ${response.status}`);
        const svg = await response.text();
        if (!controller.signal.aborted) setMarkup(svg.replace(/^<\?xml[^>]*\?>\s*/, ""));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not load the transition logo.", error);
      }
      if (!controller.signal.aborted) setStarted(true);
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!started) return;
    const timers = [
      setTimeout(onReveal, 1050),
      setTimeout(() => setFading(true), 1250),
      setTimeout(onComplete, 1650),
    ];
    return () => timers.forEach(clearTimeout);
  }, [started, onReveal, onComplete]);

  return (
    <motion.div
      className={`${styles.cinematicPresentation} ${styles.displayTransition}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: fading ? 0 : 1 }}
      transition={{ duration: 0.35 }}
      aria-hidden="true"
    >
      <div className={styles.cinematicBackdrop} />
      {markup && <div className={styles.cinematicFullLogo}><LogoArtwork markup={markup} /></div>}
    </motion.div>
  );
}

function MickySpeech({ mode, scoreboard, event = null, paused = false }: {
  mode: DisplayMode;
  scoreboard: Scoreboard | null;
  event?: SituationEvent | null;
  paused?: boolean;
}) {
  const [speech, setSpeech] = useState<{ text: string } | null>(null);
  const speechText = useRef<HTMLSpanElement>(null);
  const previous = useRef(scoreboard);
  const lastEvent = useRef(event);
  const explainedMode = useRef<DisplayMode | null>(null);
  const idleIndex = useRef(0);

  useEffect(() => {
    if (paused) {
      setSpeech(null);
      return;
    }
    const freshEvent = event !== lastEvent.current ? event : null;
    const reaction = mode === "scoreboard" && scoreboard
      ? mickyReaction(previous.current, scoreboard, freshEvent)
      : null;
    previous.current = scoreboard;
    lastEvent.current = event;
    if (reaction) setSpeech({ text: reaction });
    else if (mode !== "scoreboard" && explainedMode.current !== mode) {
      setSpeech({ text: mickyMessages(mode, scoreboard)[0]! });
      explainedMode.current = mode;
      idleIndex.current = 1;
    }
    const timer = setInterval(() => {
      const messages = mickyMessages(mode, scoreboard);
      setSpeech({ text: messages[idleIndex.current++ % messages.length]! });
    }, mode === "scoreboard" ? 25_000 : 15_000);
    return () => clearInterval(timer);
  }, [mode, scoreboard, event, paused]);

  useEffect(() => {
    if (!speech) return;
    const timer = setTimeout(() => setSpeech(null), 7_000);
    return () => clearTimeout(timer);
  }, [speech]);

  useLayoutEffect(() => {
    const text = speechText.current;
    const bubble = text?.parentElement;
    if (!text || !bubble) return;
    const fit = () => {
      const style = getComputedStyle(bubble);
      const height = bubble.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const width = bubble.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (height <= 0 || width <= 0) return;
      let low = 1;
      let high = parseFloat(style.fontSize);
      text.style.fontSize = `${high}px`;
      if (text.scrollHeight <= height && text.scrollWidth <= width) return;
      for (let step = 0; step < 10; step++) {
        const size = (low + high) / 2;
        text.style.fontSize = `${size}px`;
        if (text.scrollHeight <= height && text.scrollWidth <= width) low = size;
        else high = size;
      }
      text.style.fontSize = `${low}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [speech]);

  return (
    <div className={styles.characterGreeting}>
      <div className={styles.speechSlot} aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="wait">
          {speech && (
            <motion.p
              className={styles.speechBubble}
              aria-label="Micky sagt"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
            >
              <span className={styles.speechBubbleText} ref={speechText}>{speech.text}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className={styles.characterWindow}>
        <Suspense fallback={<span role="status">Micky wird geladen …</span>}>
          <AnimationOverlay embedded initialAnimation="idle" rotateIdle />
        </Suspense>
      </div>
    </div>
  );
}

function StatisticsBoard({ mode, statistics, scoreboard }: {
  mode: Exclude<DisplayMode, "scoreboard">;
  statistics: ScoreStatistics;
  scoreboard: Scoreboard;
}) {
  const recent = mode === "recent";
  const teams = scoreboard.teams.map((team) => {
    const entry = statistics.teams.find(({ teamId }) => teamId === team.id);
    return { ...team, value: recent ? entry?.drinksLast30Minutes ?? 0 : entry?.leaderMilliseconds ?? 0 };
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "de-CH"));
  const max = Math.max(1, ...teams.map(({ value }) => value));
  const format = (value: number) => recent
    ? value.toLocaleString("de-CH")
    : `${Math.floor(value / 3_600_000)} h ${String(Math.floor(value / 60_000) % 60).padStart(2, "0")} min`;

  return (
    <main className={`${styles.pageShell} ${styles.presentationShell} ${styles.statisticsShell}`}>
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>SHOT EGGE · STATISTIK</p>
          <h1>{recent ? <>Die letzten <span>30 Minuten.</span></> : <>Zeit an der <span>Spitze.</span></>}</h1>
          <p className={styles.statisticsCopy}>
            {recent ? "Neu erfasste Shots in den letzten 30 Minuten" : "Gesammelte Zeit auf Platz 1 · Gleichstände zählen mit"}
          </p>
        </div>
        <MickySpeech mode={mode} scoreboard={scoreboard} />
      </section>
      <section className={styles.scoreSection} aria-label={recent ? "Shots in den letzten 30 Minuten" : "Zeit auf Platz 1"}>
        <div className={styles.chartRows}>
          {teams.map((team, index) => (
            <div key={team.id} className={styles.chartRow} style={{ "--team-color": team.color } as CSSProperties}>
              <div className={styles.chartTeam}>
                <i className={styles.teamDot} />
                <span className={styles.chartTeamName}>{team.name}</span>
                <span className={styles.teamRank}>#{index + 1}</span>
              </div>
              <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${team.value / max * 100}%` }} /></div>
              <strong className={styles.barScore}>{format(team.value)}</strong>
            </div>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>
        <span>REPPISCHFÄGER DIETIKON · GUGGENMUSIK</span>
        <span>Die Shot-Rangliste erscheint gleich wieder</span>
      </footer>
    </main>
  );
}

function Editor({
  scoreboard,
  updatedTime,
  send,
}: {
  scoreboard: Scoreboard | null;
  updatedTime: string | null;
  send: (message: ClientMessage) => void;
}) {
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const teams = scoreboard
    ? [...scoreboard.teams].sort((a, b) => b.drinks - a.drinks || a.name.localeCompare(b.name, "de-CH"))
    : [];
  return (
    <main className={`${styles.pageShell} ${styles.editorShell}`}>
      <div className={styles.editorHeading}>
        <div><p className={styles.eyebrow}>REPPISCHFÄGER DIETIKON</p><h1>Shot-Zähler<br /><span>bearbeiten.</span></h1></div>
        <a className={styles.editButton} href="/admin">Administration <span aria-hidden="true">↗</span></a>
      </div>
      <div className={styles.editorToolbar}>
        <p className={styles.editorCopy}>Shots erfassen oder Anzahl anpassen. Unter «Bearbeiten» kannst du Gruppenname und Farbe ändern.</p>
      </div>
      <section
        className={styles.teamList}
        aria-label="Shot-Zahlen der Gruppen bearbeiten"
      >
        {teams.map((team) => (
          <motion.article
            className={`${styles.editTeam} ${styles.scoreEntry}`}
            key={team.id}
            layout="position"
            style={{ "--team-color": team.color } as CSSProperties}
          >
            <div className={styles.scoreTeamIdentity}>
              <div className={styles.scoreTeamName}>
                <i className={styles.teamDot} />
                <span>{team.name}</span>
              </div>
              <button
                className={styles.teamEditToggle}
                aria-expanded={editingTeamId === team.id}
                onClick={() => setEditingTeamId(editingTeamId === team.id ? null : team.id)}
                type="button"
              >{editingTeamId === team.id ? "Fertig" : "Bearbeiten"}</button>
            </div>
            <ScoreInput team={team} send={send} />
            <button
              className={`${styles.stepButton} ${styles.increment}`}
              onClick={() => send({ type: "adjust-drinks", id: team.id, amount: 1 })}
              type="button"
              aria-label={`Einen Shot für ${team.name} erfassen`}
            >+1</button>
            <button
              className={`${styles.stepButton} ${styles.incrementFive}`}
              onClick={() => send({ type: "adjust-drinks", id: team.id, amount: 5 })}
              type="button"
              aria-label={`Fünf Shots für ${team.name} erfassen`}
            >+5</button>
            {editingTeamId === team.id && (
              <div className={styles.teamEditor}>
                <label className={styles.editName}>
                  <span>Gruppenname</span>
                  <input
                    aria-label={`${team.name}: Gruppenname`}
                    defaultValue={team.name}
                    maxLength={32}
                    onBlur={(event) => {
                      if (event.currentTarget.value !== team.name) {
                        send({ type: "rename-team", id: team.id, name: event.currentTarget.value });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
                <div className={styles.colorPicker} role="group" aria-label={`Farbe für ${team.name}`}>
                  {teamColors.map((color) => {
                    const isSelected = color === team.color.toLowerCase();
                    const isUnavailable = teams.some(
                      (otherTeam) => otherTeam.id !== team.id && otherTeam.color.toLowerCase() === color,
                    );
                    return (
                      <button
                        aria-label={`${color}${isSelected ? ", ausgewählt" : ""}${isUnavailable ? ", bereits vergeben" : ""}`}
                        aria-pressed={isSelected}
                        className={styles.colorSwatch}
                        disabled={isUnavailable}
                        key={color}
                        onClick={() => send({ type: "set-team-color", id: team.id, color })}
                        style={{ "--swatch-color": color } as CSSProperties}
                        title={`${color}${isUnavailable ? " (bereits vergeben)" : ""}`}
                        type="button"
                      />
                    );
                  })}
                  <label className={styles.customColorPicker}>
                    <span>Eigene Farbe</span>
                    <input
                      aria-label={`Eigene Farbe für ${team.name}`}
                      onChange={(event) => send({ type: "set-team-color", id: team.id, color: event.currentTarget.value })}
                      type="color"
                      value={/^#[\da-f]{6}$/i.test(team.color) ? team.color : "#e40134"}
                    />
                  </label>
                </div>
                <button
                  className={styles.removeButton}
                  disabled={teams.length <= 1}
                  onClick={() => {
                    if (window.confirm(`${team.name} und den Shot-Zähler entfernen?`)) {
                      send({ type: "remove-team", id: team.id });
                      setEditingTeamId(null);
                    }
                  }}
                  type="button"
                  aria-label={`${team.name} entfernen`}
                  title="Gruppe entfernen"
                >Gruppe entfernen</button>
              </div>
            )}
          </motion.article>
        ))}
      </section>
      <div className={styles.editorActions}>
        <button
          className={styles.addTeam}
          disabled={teams.length >= 24}
          onClick={() => send({ type: "add-team" })}
          type="button"
        >＋ &nbsp; Gruppe hinzufügen</button>
        <button className={styles.resetButton} onClick={() => {
          if (window.confirm("Alle Shot-Zähler auf null zurücksetzen?")) send({ type: "reset" });
        }} type="button">Shot-Zähler zurücksetzen</button>
      </div>
      <a className={styles.backLink} href="/">← Zurück zur Rangliste</a>
      <footer className={styles.footer}>
        <span>REPPISCHFÄGER DIETIKON <span aria-hidden="true">·</span> GUGGENMUSIK</span>
        <span>{updatedTime ? `AKTUALISIERT ${updatedTime}` : "Warte auf die Rangliste …"}</span>
      </footer>
    </main>
  );
}

function Admin({ scoreboard, send }: {
  scoreboard: Scoreboard | null;
  send: (message: ClientMessage) => void;
}) {
  return (
    <main className={`${styles.pageShell} ${styles.editorShell}`}>
      <div className={styles.editorHeading}>
        <div>
          <p className={styles.eyebrow}>REPPISCHFÄGER DIETIKON</p>
          <h1>Administration</h1>
        </div>
        <a className={styles.editButton} href="/edit">Shots erfassen <span aria-hidden="true">↗</span></a>
      </div>
      {scoreboard
        ? <ScoringStartSetting timestamp={scoreboard.scoringStartedAt} send={send} />
        : <p className={styles.editorCopy} role="status">Einstellungen werden geladen …</p>}
      <a className={styles.backLink} href="/edit">← Zurück zur Shot-Verwaltung</a>
    </main>
  );
}

function ScoringStartSetting({ timestamp, send }: {
  timestamp: string | undefined;
  send: (message: ClientMessage) => void;
}) {
  const localTimestamp = (value: string | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const [draft, setDraft] = useState(() => localTimestamp(timestamp));
  useEffect(() => setDraft(localTimestamp(timestamp)), [timestamp]);

  return (
    <form className={styles.scoringSetting} onSubmit={(event) => {
      event.preventDefault();
      const date = new Date(draft);
      if (!Number.isFinite(date.getTime())) return;
      send({ type: "set-scoring-start", timestamp: date.toISOString() });
    }}>
      <label htmlFor="scoring-start">Start der Zeitwertung</label>
      <p className={styles.editorCopy}>Nur die Zeit auf Platz 1 wird ab diesem Zeitpunkt gezählt. Shot-Zahlen bleiben unverändert. Die Auswahl gilt in deiner lokalen Zeitzone.</p>
      <input id="scoring-start" type="datetime-local" required value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
      <button className={styles.editButton} type="submit" disabled={!draft || draft === localTimestamp(timestamp)}>Speichern</button>
      <p className={styles.editorCopy} role="status">
        {timestamp
          ? `Gespeichert: ${new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))}`
          : "Noch kein Start festgelegt: Die gesamte gespeicherte Zeit zählt."}
      </p>
    </form>
  );
}

function ScoreInput({
  team,
  send,
}: {
  team: Team;
  send: (message: ClientMessage) => void;
}) {
  const [draft, setDraft] = useState(String(team.drinks));
  const isEditing = useRef(false);

  useEffect(() => {
    if (!isEditing.current) setDraft(String(team.drinks));
  }, [team.drinks]);

  return (
    <input
      aria-label={`Shot-Zahl von ${team.name}`}
      className={styles.editScore}
      inputMode="numeric"
      min={0}
      onBlur={() => {
        isEditing.current = false;
        const drinks = Number(draft);
        if (draft.trim() !== "" && Number.isSafeInteger(drinks) && drinks >= 0) {
          setDraft(String(drinks));
          if (drinks !== team.drinks) send({ type: "set-drinks", id: team.id, drinks });
        } else {
          setDraft(String(team.drinks));
        }
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={() => {
        isEditing.current = true;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      type="number"
      value={draft}
    />
  );
}
