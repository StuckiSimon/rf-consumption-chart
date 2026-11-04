import { describe, expect, test } from "bun:test";
import { applyChange, type Change, type Scoreboard } from "./scoreboard";
import { StatisticsProjection } from "./statistics";

const base = Date.parse("2026-10-24T12:00:00.000Z");
const minute = 60_000;

function history() {
  const statistics = new StatisticsProjection();
  let state: Scoreboard | null = null;
  let id = 0;
  const apply = (minutes: number, change: Change) => {
    const event = { id: ++id, occurredAt: new Date(base + minutes * minute).toISOString(), change };
    const next = applyChange(state, change, event.occurredAt);
    statistics.apply(state, next, event);
    state = next;
  };
  apply(0, {
    type: "initialized",
    teams: [
      { id: "a", name: "Alpha", drinks: 0, color: "#e40134" },
      { id: "b", name: "Beta", drinks: 0, color: "#fdc800" },
    ],
  });
  return {
    apply,
    snapshot: (minutes: number) => {
      if (!state) throw new Error("Missing state");
      return statistics.snapshot(state, base + minutes * minute);
    },
  };
}

describe("historical scoreboard statistics", () => {
  test("recalculates leadership at a selected start, including partial periods, ties, and future starts", () => {
    const log = history();
    log.apply(10, { type: "drinks-set", id: "a", drinks: 10 });
    log.apply(20, { type: "drinks-set", id: "b", drinks: 10 });
    log.apply(30, { type: "drinks-adjusted", id: "b", amount: 1 });
    log.apply(40, { type: "scoring-start-set", timestamp: new Date(base + 25 * minute).toISOString() });
    expect(log.snapshot(50).teams.map(({ leaderMilliseconds }) => leaderMilliseconds)).toEqual([5 * minute, 25 * minute]);
    log.apply(51, { type: "scoring-start-set", timestamp: new Date(base + 15 * minute).toISOString() });
    expect(log.snapshot(52).teams.map(({ leaderMilliseconds }) => leaderMilliseconds)).toEqual([15 * minute, 32 * minute]);
    log.apply(53, { type: "scoring-start-set", timestamp: new Date(base + 60 * minute).toISOString() });
    expect(log.snapshot(55).teams.map(({ leaderMilliseconds }) => leaderMilliseconds)).toEqual([0, 0]);
    expect(log.snapshot(62).teams.map(({ leaderMilliseconds }) => leaderMilliseconds)).toEqual([0, 2 * minute]);
  });

  test("changing the leadership start leaves recent drinks unchanged", () => {
    const log = history();
    log.apply(1, { type: "drinks-adjusted", id: "a", amount: 5 });
    log.apply(2, { type: "scoring-start-set", timestamp: new Date(base + 10 * minute).toISOString() });
    expect(log.snapshot(3).teams[0]).toMatchObject({ drinksLast30Minutes: 5, leaderMilliseconds: 0 });
  });

  test("uses a rolling 30-minute window with no initial or future drinks", () => {
    const log = history();
    log.apply(1, { type: "drinks-adjusted", id: "a", amount: 5 });
    log.apply(2, { type: "drinks-adjusted", id: "a", amount: 1 });
    log.apply(30, { type: "drinks-adjusted", id: "b", amount: 5 });
    expect(log.snapshot(31).teams.map(({ drinksLast30Minutes }) => drinksLast30Minutes)).toEqual([1, 5]);
    expect(log.snapshot(32).teams.map(({ drinksLast30Minutes }) => drinksLast30Minutes)).toEqual([0, 5]);
    expect(log.snapshot(61).teams.map(({ drinksLast30Minutes }) => drinksLast30Minutes)).toEqual([0, 0]);
  });

  test("accumulates leadership across ties and stops at zero after resets", () => {
    const log = history();
    log.apply(10, { type: "drinks-set", id: "a", drinks: 10 });
    log.apply(20, { type: "drinks-set", id: "b", drinks: 10 });
    log.apply(30, { type: "drinks-adjusted", id: "b", amount: 1 });
    log.apply(40, { type: "drinks-reset" });
    log.apply(50, { type: "drinks-adjusted", id: "a", amount: 1 });
    expect(log.snapshot(60).teams.map(({ leaderMilliseconds }) => leaderMilliseconds)).toEqual([30 * minute, 20 * minute]);
    expect(log.snapshot(61).teams[0]!.leaderMilliseconds).toBe(31 * minute);
    expect(log.snapshot(60).teams[0]!.leaderMilliseconds).toBe(30 * minute);
  });

  test("counts positive deltas only and keeps history across corrections and resets", () => {
    const log = history();
    log.apply(1, { type: "drinks-set", id: "a", drinks: 10 });
    log.apply(2, { type: "drinks-set", id: "a", drinks: 7 });
    log.apply(3, { type: "drinks-reset" });
    log.apply(4, { type: "drinks-adjusted", id: "a", amount: 5 });
    log.apply(5, { type: "team-renamed", id: "a", name: "Neu" });
    expect(log.snapshot(6).teams[0]!.drinksLast30Minutes).toBe(15);
    log.apply(7, { type: "team-removed", id: "a" });
    expect(log.snapshot(8).teams.map(({ teamId }) => teamId)).toEqual(["b"]);
  });

  test("does not award time before initialization or treat initial scores as recent drinks", () => {
    const statistics = new StatisticsProjection();
    const teams = [{ id: "a", name: "Alpha", drinks: 100, color: "#e40134" }];
    const state = { teams, updatedAt: new Date(base).toISOString() };
    statistics.apply(null, state, { id: 1, occurredAt: state.updatedAt, change: { type: "initialized", teams } });
    expect(statistics.snapshot(state, base + minute).teams).toEqual([
      { teamId: "a", drinksLast30Minutes: 0, leaderMilliseconds: minute },
    ]);
  });
});
