import { Database } from "bun:sqlite";
import { StatisticsProjection } from "./statistics";
import {
  applyChange, decideChange, deriveSituations, initialState, isScoreboard,
  type Change, type Scoreboard, type SituationEvent, type StoredEvent,
} from "./scoreboard";

export class EventStore {
  private readonly database: Database;
  private currentState: Scoreboard;
  private version = 0;

  private constructor(database: Database, state: Scoreboard, version: number, private readonly statistics: StatisticsProjection) {
    this.database = database;
    this.currentState = state;
    this.version = version;
  }

  static open(path: string): EventStore {
    const database = new Database(path, { create: true, strict: true });
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          occurred_at TEXT NOT NULL,
          change TEXT NOT NULL
        );
      `);
      const loaded = database.transaction(() => {
        if (!database.query("SELECT id FROM events LIMIT 1").get()) {
          const state = initialState();
          database.query("INSERT INTO events (occurred_at, change) VALUES (?, ?)").run(
            state.updatedAt, JSON.stringify({ type: "initialized", teams: state.teams } satisfies Change),
          );
        }
        let state: Scoreboard | null = null;
        let version = 0;
        const statistics = new StatisticsProjection();
        const rows = database.query<{ id: number; occurred_at: string; change: string }, []>(
          "SELECT id, occurred_at, change FROM events ORDER BY id",
        );
        for (const row of rows.iterate()) {
          if (!Number.isFinite(Date.parse(row.occurred_at))) throw new Error(`Invalid timestamp in event ${row.id}.`);
          try {
            const change = JSON.parse(row.change) as Change;
            const next = applyChange(state, change, row.occurred_at);
            statistics.apply(state, next, { id: row.id, occurredAt: row.occurred_at, change });
            state = next;
          } catch (error) {
            throw new Error(`Could not replay scoreboard event ${row.id}.`, { cause: error });
          }
          version = row.id;
        }
        if (!state) throw new Error("Event log is empty.");
        return { state, version, statistics };
      }).immediate();
      return new EventStore(database, loaded.state, loaded.version, loaded.statistics);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  get state(): Scoreboard {
    return structuredClone(this.currentState);
  }

  getStatistics(now = Date.now()) {
    return this.statistics.snapshot(this.currentState, now);
  }

  commit(message: unknown): { event: StoredEvent; events: SituationEvent[]; state: Scoreboard } | null {
    const change = decideChange(this.currentState, message);
    if (!change) return null;
    const occurredAt = new Date().toISOString();
    const next = applyChange(this.currentState, change, occurredAt);
    const result = this.database.transaction(() => {
      const latest = this.database.query<{ id: number }, []>("SELECT id FROM events ORDER BY id DESC LIMIT 1").get();
      if (latest?.id !== this.version) throw new Error("Event log changed in another process; restart the server.");
      return this.database.query("INSERT INTO events (occurred_at, change) VALUES (?, ?)").run(occurredAt, JSON.stringify(change));
    }).immediate();
    const event: StoredEvent = { id: Number(result.lastInsertRowid), occurredAt, change };
    const events = deriveSituations(this.currentState, next, event);
    this.statistics.apply(this.currentState, next, event);
    this.currentState = next;
    this.version = event.id;
    return { event, events, state: this.state };
  }

  close() {
    this.database.close();
  }
}
