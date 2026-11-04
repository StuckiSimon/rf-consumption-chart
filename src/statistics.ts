import type { Scoreboard, StoredEvent } from "./scoreboard";

export type ScoreStatistics = {
  generatedAt: string;
  stateUpdatedAt: string;
  teams: { teamId: string; drinksLast30Minutes: number; leaderMilliseconds: number }[];
};

export class StatisticsProjection {
  private readonly leadership: { teamId: string; start: number; end: number }[] = [];
  private readonly drinks: { teamId: string; amount: number; at: number }[] = [];
  private leaders: string[] = [];
  private lastTime: number | null = null;

  apply(previous: Scoreboard | null, next: Scoreboard, event: StoredEvent) {
    const at = Math.max(this.lastTime ?? 0, Date.parse(event.occurredAt));
    if (this.lastTime !== null) {
      for (const id of this.leaders) {
        this.leadership.push({ teamId: id, start: this.lastTime, end: at });
      }
    }
    if (event.change.type === "drinks-set" || event.change.type === "drinks-adjusted") {
      for (const team of next.teams) {
        const old = previous?.teams.find(({ id }) => id === team.id);
        if (old && team.drinks > old.drinks) {
          this.drinks.push({ teamId: team.id, amount: team.drinks - old.drinks, at });
        }
      }
    }
    const highest = Math.max(...next.teams.map(({ drinks }) => drinks));
    this.leaders = highest > 0 ? next.teams.filter(({ drinks }) => drinks === highest).map(({ id }) => id) : [];
    this.lastTime = at;
  }

  snapshot(state: Scoreboard, now = Date.now()): ScoreStatistics {
    const cutoff = now - 30 * 60 * 1000;
    const recent = new Map<string, number>();
    const scoringStart = state.scoringStartedAt ? Date.parse(state.scoringStartedAt) : -Infinity;
    const leadership = new Map<string, number>();
    for (const interval of this.leadership) {
      const duration = Math.max(0, Math.min(now, interval.end) - Math.max(scoringStart, interval.start));
      leadership.set(interval.teamId, (leadership.get(interval.teamId) ?? 0) + duration);
    }
    for (const entry of this.drinks) {
      if (entry.at > cutoff && entry.at <= now) {
        recent.set(entry.teamId, (recent.get(entry.teamId) ?? 0) + entry.amount);
      }
    }
    return {
      generatedAt: new Date(now).toISOString(),
      stateUpdatedAt: state.updatedAt,
      teams: state.teams.map(({ id }) => ({
        teamId: id,
        drinksLast30Minutes: recent.get(id) ?? 0,
        leaderMilliseconds: (leadership.get(id) ?? 0)
          + (this.leaders.includes(id) ? Math.max(0, now - Math.max(scoringStart, this.lastTime ?? now)) : 0),
      })),
    };
  }
}
