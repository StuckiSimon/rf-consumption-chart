export type DisplayMode = "scoreboard" | "recent" | "leaders";

export const idleDisplayDelay = (mode: DisplayMode) => mode === "scoreboard" ? 60_000 : 30_000;

export const followingIdleChart = (mode: Exclude<DisplayMode, "scoreboard">): DisplayMode =>
  mode === "recent" ? "leaders" : "recent";
