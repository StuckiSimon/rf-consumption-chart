import { afterEach, expect, mock, test } from "bun:test";
import * as React from "react";
import type { Scoreboard } from "./scoreboard";

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
let slots: Slot[] = [];
let cursor = 0;
let dirty = false;
let effects: (() => void)[] = [];

const sameDependencies = (a: readonly unknown[] | undefined, b: readonly unknown[]) =>
  a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));

mock.module("react", () => ({
  ...React,
  useState<T>(initial: T) {
    const index = cursor++;
    const slot = slots[index] ??= { value: initial };
    return [slot.value as T, (action: React.SetStateAction<T>) => {
      const value = typeof action === "function"
        ? (action as (previous: T) => T)(slot.value as T)
        : action;
      dirty ||= !Object.is(value, slot.value);
      slot.value = value;
    }];
  },
  useRef<T>(initial: T) {
    const slot = slots[cursor++] ??= { value: { current: initial } };
    return slot.value;
  },
  useCallback<T>(callback: T, deps: readonly unknown[]) {
    const index = cursor++;
    if (!sameDependencies(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
    return slots[index]!.value;
  },
  useEffect(effect: () => (() => void) | void, deps: readonly unknown[]) {
    const index = cursor++;
    if (sameDependencies(slots[index]?.deps, deps)) return;
    const previous = slots[index];
    const slot: Slot = { deps };
    slots[index] = slot;
    effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));

const { useIdleDisplay } = await import("./useIdleDisplay");
const restorations: (() => void)[] = [];

afterEach(() => {
  slots.forEach((slot) => slot.cleanup?.());
  restorations.splice(0).reverse().forEach((restore) => restore());
  slots = [];
  effects = [];
});

function setGlobal(name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restorations.push(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}

function renderHooks<T>(render: () => T): T {
  let result: T;
  do {
    dirty = false;
    cursor = 0;
    result = render();
    effects.splice(0).forEach((effect) => effect());
  } while (dirty);
  return result;
}

function fixture() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  setGlobal("setTimeout", (callback: () => void, delay: number) => {
    timers.set(++nextId, { at: now + delay, callback });
    return nextId;
  });
  setGlobal("clearTimeout", (id: number) => timers.delete(id));
  setGlobal("setInterval", () => ++nextId);
  setGlobal("clearInterval", () => {});
  setGlobal("window", { scrollTo() {}, location: { pathname: "/" } });
  const fetchStatistics = mock(async () => Response.json({
    stateUpdatedAt: "current", generatedAt: "now", teams: [],
  }));
  setGlobal("fetch", fetchStatistics);
  const scoreboard: Scoreboard = { updatedAt: "current", teams: [] };
  const props = { scoreboard, connected: true, busy: false, onError: mock(() => {}) };
  const render = () => renderHooks(() => useIdleDisplay(props));
  const tick = (milliseconds: number) => {
    now += milliseconds;
    for (const [id, timer] of timers) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  const advance = (milliseconds: number) => {
    tick(milliseconds);
    return render();
  };
  const enterChart = async () => {
    render();
    advance(60_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const transition = render();
    expect(transition.transition).toBe(true);
    transition.reveal();
    transition.complete();
    expect(render().mode).toBe("recent");
  };
  return { props, render, advance, tick, enterChart, fetchStatistics };
}

test("busy work cannot cancel or restart a statistics chart's return deadline", async () => {
  const display = fixture();
  await display.enterChart();
  display.advance(20_000);
  display.props.busy = true;
  display.render();
  expect(display.advance(9_999).transition).toBe(false);
  const returning = display.advance(1);
  expect(returning.transition).toBe(true);
  returning.reveal();
  returning.complete();
  expect(display.render().mode).toBe("scoreboard");
});

test("busy work still prevents entry into statistics and restarts the normal idle wait", async () => {
  const display = fixture();
  display.props.busy = true;
  display.render();
  expect(display.advance(60_000).transition).toBe(false);
  expect(display.fetchStatistics).not.toHaveBeenCalled();
  display.props.busy = false;
  display.render();
  display.advance(59_999);
  expect(display.fetchStatistics).not.toHaveBeenCalled();
  display.advance(1);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(display.render().transition).toBe(true);
});

test("display transitions reveal and complete even when the logo request never settles", async () => {
  const clock = fixture();
  let signal: AbortSignal | null | undefined;
  setGlobal("fetch", (_url: string, options: RequestInit) => {
    signal = options.signal;
    return new Promise<Response>(() => {});
  });
  const { DisplayTransition } = await import("./App");
  const props = { onReveal: mock(() => {}), onComplete: mock(() => {}) };
  const render = () => renderHooks(() => DisplayTransition(props));
  render();
  clock.tick(1050);
  expect(props.onReveal).toHaveBeenCalledTimes(1);
  expect(props.onComplete).not.toHaveBeenCalled();
  clock.tick(200);
  render();
  clock.tick(400);
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  slots.forEach((slot) => slot.cleanup?.());
  expect(signal?.aborted).toBe(true);
});
