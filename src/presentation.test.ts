import { afterEach, describe, expect, test } from "bun:test";
import { countStepDuration, increasedTeams, isRowVisible, presentationDelay, scrollPresentation } from "./presentation";
import type { Scoreboard } from "./scoreboard";

const state: Scoreboard = {
  teams: [
    { id: "a", name: "Alpha", drinks: 10, color: "#e40134" },
    { id: "b", name: "Beta", drinks: 20, color: "#fdc800" },
  ],
  updatedAt: "2026-10-24T12:00:00.000Z",
};
const restoreGlobals: (() => void)[] = [];

afterEach(() => {
  restoreGlobals.splice(0).reverse().forEach((restore) => restore());
});

function setGlobal(name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restoreGlobals.push(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}

function scrollingFixture(reducedMotion = false) {
  let position = 0;
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const destinations: number[] = [];
  setGlobal("window", {
    get scrollY() { return position; },
    innerHeight: 800,
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo: ({ top }: ScrollToOptions) => {
      position = top ?? 0;
      destinations.push(position);
    },
  });
  setGlobal("document", { documentElement: { scrollHeight: 2400 } });
  setGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  setGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  return {
    frames,
    destinations,
    frame(now: number) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

describe("scoreboard presentation", () => {
  test("only follows increases for existing teams, not initialization, additions, or corrections", () => {
    expect(increasedTeams(null, state)).toEqual([]);
    const next = {
      ...state,
      teams: [
        { ...state.teams[0]!, drinks: 15 },
        { ...state.teams[1]!, drinks: 19 },
        { id: "c", name: "Gamma", drinks: 30, color: "#0e4194" },
      ],
    };
    expect(increasedTeams(state, next).map(({ id }) => id)).toEqual(["a"]);
    expect(increasedTeams(state, state)).toEqual([]);
  });

  test("requires the entire row to be visible with room for the enlarged count", () => {
    expect(isRowVisible({ top: 24, bottom: 776 }, 800)).toBe(true);
    expect(isRowVisible({ top: 20, bottom: 100 }, 800)).toBe(false);
    expect(isRowVisible({ top: 750, bottom: 810 }, 800)).toBe(false);
    expect(isRowVisible({ top: 900, bottom: 970 }, 800)).toBe(false);
  });

  test("preserves the existing counting pace", () => {
    expect(countStepDuration(1)).toBe(500);
    expect(countStepDuration(5)).toBe(120);
    expect(countStepDuration(100)).toBe(20);
  });

  test("waits for scrolling to reach the target before resolving and can return to the top", async () => {
    const scrolling = scrollingFixture();
    const controller = new AbortController();
    const startedAt = performance.now();
    let finished = false;
    const scrollingDown = scrollPresentation(1200, controller.signal).then(() => { finished = true; });
    scrolling.frame(startedAt + 400);
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(scrolling.destinations.at(-1)).toBeGreaterThan(0);
    expect(scrolling.destinations.at(-1)).toBeLessThan(1200);
    scrolling.frame(startedAt + 900);
    await scrollingDown;
    expect(finished).toBe(true);
    expect(scrolling.destinations.at(-1)).toBe(1200);
    const scrollingUp = scrollPresentation(0, controller.signal);
    scrolling.frame(performance.now() + 900);
    await scrollingUp;
    expect(scrolling.destinations.at(-1)).toBe(0);
  });

  test("clamps scrolling to the document and respects reduced motion", async () => {
    const scrolling = scrollingFixture(true);
    await scrollPresentation(5000, new AbortController().signal);
    expect(scrolling.destinations).toEqual([1600]);
    expect(scrolling.frames.size).toBe(0);
  });

  test("cancels scrolling and dwell timers when the presentation is interrupted", async () => {
    const scrolling = scrollingFixture();
    const controller = new AbortController();
    const down = scrollPresentation(1200, controller.signal);
    const dwell = presentationDelay(1800, controller.signal);
    controller.abort();
    await Promise.all([down, dwell]);
    expect(scrolling.frames.size).toBe(0);
    expect(scrolling.destinations).toEqual([]);
    await scrollPresentation(1200, controller.signal);
    await presentationDelay(1800, controller.signal);
    expect(scrolling.frames.size).toBe(0);
  });
});
