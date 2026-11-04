import { useCallback, useEffect, useRef, useState } from "react";
import type { Scoreboard } from "./scoreboard";
import type { ScoreStatistics } from "./statistics";
import { followingIdleChart, idleDisplayDelay, type DisplayMode } from "./idleDisplay";

export function useIdleDisplay({
  scoreboard, connected, busy, onError,
}: {
  scoreboard: Scoreboard | null;
  connected: boolean;
  busy: boolean;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<DisplayMode>("scoreboard");
  const [transition, setTransition] = useState(false);
  const [statistics, setStatistics] = useState<ScoreStatistics | null>(null);
  const [retry, setRetry] = useState(0);
  const target = useRef<DisplayMode>("scoreboard");
  const nextChart = useRef<DisplayMode>("recent");
  const previous = useRef(scoreboard);
  const activity = useRef(0);

  const switchTo = useCallback((next: DisplayMode) => {
    target.current = next;
    setTransition(true);
  }, []);
  const reveal = useCallback(() => {
    setMode(target.current);
    if (target.current !== "scoreboard") {
      nextChart.current = followingIdleChart(target.current);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const complete = useCallback(() => {
    setMode(target.current);
    setTransition(false);
  }, []);

  useEffect(() => {
    if (previous.current === scoreboard) return;
    previous.current = scoreboard;
    activity.current++;
    if (mode !== "scoreboard" || transition) switchTo("scoreboard");
  }, [scoreboard, mode, transition, switchTo]);

  useEffect(() => {
    if (!connected && (mode !== "scoreboard" || transition)) switchTo("scoreboard");
  }, [connected, mode, transition, switchTo]);

  useEffect(() => {
    if (!scoreboard || !connected || busy || transition) return;
    const controller = new AbortController();
    const version = activity.current;
    const timer = setTimeout(() => {
      if (mode !== "scoreboard") {
        switchTo("scoreboard");
        return;
      }
      void fetch("/api/statistics", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Statistics request failed: ${response.status}`);
          return await response.json() as ScoreStatistics;
        })
        .then((result) => {
          if (controller.signal.aborted || activity.current !== version) return;
          if (result.stateUpdatedAt !== scoreboard.updatedAt) {
            throw new Error("Statistics do not match the current scoreboard.");
          }
          setStatistics(result);
          switchTo(nextChart.current);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("Could not load scoreboard statistics.", error);
          onError("Die Statistik konnte nicht geladen werden.");
          setRetry((value) => value + 1);
        });
    }, idleDisplayDelay(mode));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [scoreboard, connected, busy, transition, mode, switchTo, onError, retry]);

  useEffect(() => {
    if (mode === "scoreboard" || transition || !scoreboard) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void fetch("/api/statistics", { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Statistics request failed: ${response.status}`);
          return await response.json() as ScoreStatistics;
        })
        .then((result) => {
          if (!controller.signal.aborted && result.stateUpdatedAt === scoreboard.updatedAt) setStatistics(result);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("Could not refresh scoreboard statistics.", error);
          onError("Die Statistik konnte nicht aktualisiert werden.");
          switchTo("scoreboard");
        });
    }, 10_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [mode, transition, scoreboard, onError, switchTo]);

  return { mode, transition, statistics, reveal, complete };
}
