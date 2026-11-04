import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "./eventStore";
import type { Scoreboard } from "./scoreboard";

const directories: string[] = [];
const stores: EventStore[] = [];
const baseline: Scoreboard = {
  teams: [
    { id: "a", name: "Alpha", drinks: 9, color: "#e40134" },
    { id: "b", name: "Beta", drinks: 85, color: "#fdc800" },
  ],
  updatedAt: "2026-10-24T12:00:00.000Z",
};

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

async function fixture(state: Scoreboard | null = baseline) {
  const directory = await mkdtemp(join(tmpdir(), "scoreboard-events-"));
  directories.push(directory);
  const path = join(directory, "events.sqlite");
  if (state) {
    const database = new Database(path);
    try {
      database.exec(`
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL,
          change TEXT NOT NULL
        );
      `);
      database.query("INSERT INTO events (occurred_at, change) VALUES (?, ?)").run(
        state.updatedAt, JSON.stringify({ type: "initialized", teams: state.teams }),
      );
    } finally {
      database.close();
    }
  }
  async function open() {
    const store = EventStore.open(path);
    stores.push(store);
    return store;
  }
  return { path, open };
}

describe("event storage", () => {
  test("replays all changes exactly after restart", async () => {
    const { open, path } = await fixture();
    const store = await open();
    expect(store.state).toEqual(baseline);
    const messages = [
      { type: "rename-team", id: "a", name: " Renamed " },
      { type: "set-team-color", id: "a", color: "#ABCDEF" },
      { type: "adjust-drinks", id: "a", amount: 5 },
      { type: "set-drinks", id: "b", drinks: 100 },
      { type: "add-team", name: "New team" },
      { type: "remove-team", id: "b" },
      { type: "reset" },
    ];
    for (const message of messages) expect(store.commit(message)).not.toBeNull();
    const expected = store.state;
    expect(expected.teams.map(({ name, drinks }) => ({ name, drinks }))).toEqual([
      { name: "Renamed", drinks: 0 }, { name: "New team", drinks: 0 },
    ]);
    expect(expected.teams[0]!.color).toBe("#abcdef");
    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect((await open()).state).toEqual(expected);
    const database = new Database(path, { readonly: true });
    try {
      const rows = database.query<{ change: string }, []>("SELECT change FROM events ORDER BY id").all();
      expect(rows.map(({ change }) => JSON.parse(change).type)).toEqual([
        "initialized", "team-renamed", "team-color-set", "drinks-adjusted",
        "drinks-set", "team-added", "team-removed", "drinks-reset",
      ]);
    } finally {
      database.close();
    }
  });

  test("persists generated initial IDs in a new SQLite database", async () => {
    const { open } = await fixture(null);
    const first = await open();
    expect(first.state.teams).toHaveLength(2);
    expect((await open()).state).toEqual(first.state);
  });

  test("rejects invalid commands without storing or changing anything", async () => {
    const { open, path } = await fixture();
    const store = await open();
    for (const message of [
      null, [], {}, { type: "unknown" },
      { type: "remove-team", id: "missing" },
      { type: "rename-team", id: "a", name: " " },
      { type: "set-team-color", id: "a", color: "#FDC800" },
      { type: "set-team-color", id: "a", color: "red" },
      { type: "set-drinks", id: "a", drinks: -1 },
      { type: "set-drinks", id: "a", drinks: 1.5 },
      { type: "set-drinks", id: "a", drinks: Number.MAX_SAFE_INTEGER + 1 },
      { type: "adjust-drinks", id: "a", amount: -1 },
      { type: "adjust-drinks", id: "a", amount: 2 },
      { type: "adjust-drinks", id: "a", amount: "1" },
    ]) expect(store.commit(message)).toBeNull();
    expect(store.state).toEqual(baseline);
    const database = new Database(path, { readonly: true });
    try {
      expect(database.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("keeps team limits, the last team, and safe-integer drink counts", async () => {
    const { open } = await fixture();
    const store = await open();
    store.commit({ type: "remove-team", id: "b" });
    expect(store.commit({ type: "remove-team", id: "a" })).toBeNull();
    for (let i = 1; i < 24; i++) expect(store.commit({ type: "add-team" })).not.toBeNull();
    expect(store.commit({ type: "add-team" })).toBeNull();
    store.commit({ type: "set-drinks", id: "a", drinks: Number.MAX_SAFE_INTEGER });
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 1 })).toBeNull();
  });

  test("does not expose mutable state to callers", async () => {
    const store = await (await fixture()).open();
    store.state.teams[0]!.drinks = 999;
    const result = store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!;
    result.state.teams[0]!.drinks = 999;
    expect(store.state.teams[0]!.drinks).toBe(10);
  });

  test("fails closed on a corrupt event history", async () => {
    const { open, path } = await fixture();
    const store = await open();
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const database = new Database(path);
    try {
      database.query("INSERT INTO events (occurred_at, change) VALUES (?, ?)").run(
        baseline.updatedAt, JSON.stringify({ type: "drinks-adjusted", id: "missing", amount: 1 }),
      );
    } finally {
      database.close();
    }
    await expect(open()).rejects.toThrow("Could not replay scoreboard event 2");
  });

  test("failed writes leave the projection and event log unchanged", async () => {
    const { open, path } = await fixture();
    const store = await open();
    const database = new Database(path);
    try {
      database.exec("CREATE TRIGGER fail_write BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
      expect(() => store.commit({ type: "adjust-drinks", id: "a", amount: 1 })).toThrow("disk failure");
      expect(store.state).toEqual(baseline);
      expect((await open()).state).toEqual(baseline);
      database.exec("DROP TRIGGER fail_write");
      expect(store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!.event.id).toBe(2);
    } finally {
      database.close();
    }
  });

  test("prevents a second process from overwriting a newer projection", async () => {
    const { open } = await fixture();
    const first = await open();
    const stale = await open();
    first.commit({ type: "adjust-drinks", id: "a", amount: 1 });
    expect(() => stale.commit({ type: "adjust-drinks", id: "a", amount: 5 })).toThrow("another process");
    expect(stale.state).toEqual(baseline);
    expect((await open()).state).toEqual(first.state);
  });
});

describe("situation events", () => {
  test("persists the scoring start across updates, resets, and restarts, rejecting invalid timestamps", async () => {
    const { open } = await fixture();
    const store = await open();
    const timestamp = "2026-10-24T12:30:00.000Z";
    const result = store.commit({ type: "set-scoring-start", timestamp })!;
    expect(result.state.scoringStartedAt).toBe(timestamp);
    expect(result.events).toEqual([]);
    expect(result.state.teams).toEqual(baseline.teams);
    for (const invalid of ["invalid", "", "2026-10-24", null, 123]) {
      expect(store.commit({ type: "set-scoring-start", timestamp: invalid })).toBeNull();
    }
    store.commit({ type: "adjust-drinks", id: "a", amount: 1 });
    store.commit({ type: "add-team" });
    store.commit({ type: "reset" });
    expect(store.state.scoringStartedAt).toBe(timestamp);
    expect((await open()).state).toEqual(store.state);
    const now = Date.now();
    expect((await open()).getStatistics(now)).toEqual(store.getStatistics(now));
  });

  test("restores statistics from SQLite history and keeps snapshots immutable", async () => {
    const { open } = await fixture();
    const store = await open();
    store.commit({ type: "adjust-drinks", id: "a", amount: 5 });
    const now = Date.now();
    const statistics = store.getStatistics(now);
    expect(statistics.teams.find(({ teamId }) => teamId === "a")!.drinksLast30Minutes).toBe(5);
    expect((await open()).getStatistics(now)).toEqual(statistics);
    statistics.teams[0]!.drinksLast30Minutes = 999;
    expect(store.getStatistics(now).teams[0]!.drinksLast30Minutes).toBe(5);
  });

  test("emits milestones only on upward crossings and links them to the durable update", async () => {
    const store = await (await fixture()).open();
    expect(store.commit({ type: "set-drinks", id: "a", drinks: 49 })!.events).toEqual([]);
    const result = store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!;
    expect(result.events).toEqual([
      { type: "team-milestone", teamId: "a", milestone: 50, sourceEventId: result.event.id, occurredAt: result.event.occurredAt },
    ]);
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 5 })!.events).toEqual([]);
    expect(store.commit({ type: "set-drinks", id: "a", drinks: 55 })!.events).toEqual([]);
    expect(store.commit({ type: "set-drinks", id: "a", drinks: 49 })!.events).toEqual([]);
    expect(store.commit({ type: "rename-team", id: "a", name: "Renamed" })!.events).toEqual([]);
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!.events[0]!.type).toBe("team-milestone");
  });

  test("emits the highest crossed milestone for large corrections without flooding clients", async () => {
    const store = await (await fixture()).open();
    const result = store.commit({ type: "set-drinks", id: "a", drinks: 1015 })!;
    expect(result.events.filter(({ type }) => type !== "leaders-changed").map((event) => (
      "milestone" in event ? event.milestone : null
    ))).toEqual([1000]);
  });

  test("detects ties, outright leads, removal, and reset without name-based false positives", async () => {
    const store = await (await fixture()).open();
    expect(store.commit({ type: "set-drinks", id: "a", drinks: 85 })!.events[0]).toMatchObject({
      type: "leaders-changed", previousLeaderIds: ["b"], leaderIds: ["a", "b"],
    });
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!.events[0]).toMatchObject({
      type: "leaders-changed", previousLeaderIds: ["a", "b"], leaderIds: ["a"],
    });
    expect(store.commit({ type: "rename-team", id: "a", name: "Z" })!.events).toEqual([]);
    expect(store.commit({ type: "remove-team", id: "a" })!.events[0]).toMatchObject({
      type: "leaders-changed", previousLeaderIds: ["a"], leaderIds: ["b"],
    });
    expect(store.commit({ type: "reset" })!.events).toEqual([
      expect.objectContaining({ type: "leaders-changed", previousLeaderIds: ["b"], leaderIds: [] }),
    ]);
    expect(store.commit({ type: "reset" })!.events).toEqual([]);
  });

  test.each([50, 100, 150, 200, 250, 300])("emits a team milestone at %i drinks", async (milestone) => {
    const store = await (await fixture({
      ...baseline,
      teams: baseline.teams.map((team, index) => ({
        ...team, drinks: index === 0 ? milestone - 1 : milestone + 10,
      })),
    })).open();
    const result = store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!;
    expect(result.events).toEqual([
      { type: "team-milestone", teamId: "a", milestone, sourceEventId: result.event.id, occurredAt: result.event.occurredAt },
    ]);
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!.events).toEqual([]);
  });

  test("does not emit ten-drink or overall-total milestones", async () => {
    const store = await (await fixture()).open();
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 1 })!.events).toEqual([]);
    expect(store.commit({ type: "adjust-drinks", id: "a", amount: 5 })!.events).toEqual([]);
    expect(store.commit({ type: "set-drinks", id: "a", drinks: 20 })!.events).toEqual([]);
  });

  test("keeps team milestones exact at safe-integer limits", async () => {
    const store = await (await fixture()).open();
    const result = store.commit({ type: "set-drinks", id: "a", drinks: Number.MAX_SAFE_INTEGER })!;
    expect(result.events.filter(({ type }) => type === "team-milestone")).toEqual([
      expect.objectContaining({ teamId: "a", milestone: 9007199254740950 }),
    ]);
  });
});
