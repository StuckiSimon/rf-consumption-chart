import { randomUUID } from "node:crypto";
import { teamColors } from "./teamColors";

export type Team = { id: string; name: string; drinks: number; color: string };
export type Scoreboard = { teams: Team[]; updatedAt: string; scoringStartedAt?: string };
export type ClientMessage =
  | { type: "set-scoring-start"; timestamp: string }
  | { type: "add-team"; name?: string }
  | { type: "rename-team"; id: string; name: string }
  | { type: "set-team-color"; id: string; color: string }
  | { type: "set-drinks"; id: string; drinks: number }
  | { type: "remove-team"; id: string }
  | { type: "adjust-drinks"; id: string; amount: number }
  | { type: "reset" };

export type Change =
  | { type: "scoring-start-set"; timestamp: string }
  | { type: "initialized"; teams: Team[] }
  | { type: "team-added"; team: Team }
  | { type: "team-renamed"; id: string; name: string }
  | { type: "team-color-set"; id: string; color: string }
  | { type: "drinks-set"; id: string; drinks: number }
  | { type: "drinks-adjusted"; id: string; amount: number }
  | { type: "team-removed"; id: string }
  | { type: "drinks-reset" };

export type StoredEvent = { id: number; occurredAt: string; change: Change };
export type SituationEvent = { sourceEventId: number; occurredAt: string } & (
  | { type: "leaders-changed"; previousLeaderIds: string[]; leaderIds: string[] }
  | { type: "team-milestone"; teamId: string; milestone: number }
);
export type ServerMessage =
  | { type: "state"; state: Scoreboard }
  | { type: "events"; events: SituationEvent[] }
  | { type: "error"; message: string };

export function initialState(): Scoreboard {
  return {
    teams: [
      { id: randomUUID(), name: "Gugge 1", drinks: 0, color: teamColors[0]! },
      { id: randomUUID(), name: "Gugge 2", drinks: 0, color: teamColors[1]! },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function isTeam(value: unknown): value is Team {
  return Boolean(value && typeof value === "object"
    && "id" in value && typeof value.id === "string"
    && "name" in value && typeof value.name === "string"
    && "drinks" in value && typeof value.drinks === "number" && Number.isSafeInteger(value.drinks) && value.drinks >= 0
    && "color" in value && typeof value.color === "string");
}

export function isScoreboard(value: unknown): value is Scoreboard {
  return Boolean(value && typeof value === "object"
    && "teams" in value && Array.isArray(value.teams) && value.teams.length >= 1 && value.teams.length <= 24
    && value.teams.every(isTeam) && new Set(value.teams.map((team) => team.id)).size === value.teams.length
    && (!("scoringStartedAt" in value) || (typeof value.scoringStartedAt === "string"
      && Number.isFinite(Date.parse(value.scoringStartedAt))))
    && "updatedAt" in value && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)));
}

export function decideChange(state: Scoreboard, message: unknown): Change | null {
  if (!message || typeof message !== "object" || !("type" in message)) return null;
  const team = "id" in message ? state.teams.find(({ id }) => id === message.id) : undefined;

  switch (message.type) {
    case "set-scoring-start": {
      if (!("timestamp" in message) || typeof message.timestamp !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(message.timestamp)
        || !Number.isFinite(Date.parse(message.timestamp))) return null;
      return { type: "scoring-start-set", timestamp: new Date(message.timestamp).toISOString() };
    }
    case "add-team": {
      if (state.teams.length >= 24) return null;
      const name = "name" in message && typeof message.name === "string" ? message.name.trim().slice(0, 32) : "";
      const usedColors = new Set(state.teams.map(({ color }) => color.toLowerCase()));
      const color = teamColors.find((candidate) => !usedColors.has(candidate));
      return color ? {
        type: "team-added",
        team: { id: randomUUID(), name: name || `Gugge ${state.teams.length + 1}`, drinks: 0, color },
      } : null;
    }
    case "rename-team": {
      if (!team || !("name" in message) || typeof message.name !== "string") return null;
      const name = message.name.trim().slice(0, 32);
      return name ? { type: "team-renamed", id: team.id, name } : null;
    }
    case "set-team-color": {
      if (!team || !("color" in message) || typeof message.color !== "string") return null;
      const color = message.color.toLowerCase();
      if (!/^#[\da-f]{6}$/.test(color)) return null;
      if (state.teams.some(({ id, color: usedColor }) => id !== team.id && usedColor.toLowerCase() === color)) return null;
      return { type: "team-color-set", id: team.id, color };
    }
    case "remove-team":
      return team && state.teams.length > 1 ? { type: "team-removed", id: team.id } : null;
    case "set-drinks":
      return team && "drinks" in message && typeof message.drinks === "number"
        && Number.isSafeInteger(message.drinks) && message.drinks >= 0
        ? { type: "drinks-set", id: team.id, drinks: message.drinks } : null;
    case "adjust-drinks":
      return team && "amount" in message && typeof message.amount === "number"
        && [1, 5].includes(message.amount) && Number.isSafeInteger(team.drinks + message.amount)
        ? { type: "drinks-adjusted", id: team.id, amount: message.amount } : null;
    case "reset":
      return { type: "drinks-reset" };
    default:
      return null;
  }
}

export function applyChange(state: Scoreboard | null, change: Change, occurredAt: string): Scoreboard {
  if (change.type === "initialized") {
    if (state !== null) throw new Error("Scoreboard is already initialized.");
    const next = { teams: change.teams.map((team) => ({ ...team })), updatedAt: occurredAt };
    if (!isScoreboard(next)) throw new Error("Invalid initial scoreboard.");
    return next;
  }
  if (!state) throw new Error("Missing initial scoreboard event.");
  if (change.type === "scoring-start-set") {
    if (JSON.stringify(decideChange(state, { type: "set-scoring-start", timestamp: change.timestamp })) !== JSON.stringify(change)) {
      throw new Error("Invalid scoring-start-set event.");
    }
    return { ...state, scoringStartedAt: change.timestamp, updatedAt: occurredAt };
  }

  let message: ClientMessage;
  switch (change.type) {
    case "team-added": {
      if (!isTeam(change.team) || change.team.drinks !== 0 || state.teams.length >= 24
        || state.teams.some(({ id, color }) => id === change.team.id || color.toLowerCase() === change.team.color.toLowerCase())
        || !/^#[\da-f]{6}$/i.test(change.team.color)) throw new Error("Invalid team-added event.");
      return { ...state, teams: [...state.teams, { ...change.team }], updatedAt: occurredAt };
    }
    case "team-renamed": message = { type: "rename-team", id: change.id, name: change.name }; break;
    case "team-color-set": message = { type: "set-team-color", id: change.id, color: change.color }; break;
    case "drinks-set": message = { type: "set-drinks", id: change.id, drinks: change.drinks }; break;
    case "drinks-adjusted": message = { type: "adjust-drinks", id: change.id, amount: change.amount }; break;
    case "team-removed": message = { type: "remove-team", id: change.id }; break;
    case "drinks-reset": message = { type: "reset" }; break;
    default: throw new Error("Unknown scoreboard event.");
  }
  if (JSON.stringify(decideChange(state, message)) !== JSON.stringify(change)) throw new Error("Invalid scoreboard event.");
  const teams = state.teams.flatMap((team): Team[] => {
    if (change.type === "drinks-reset") return [{ ...team, drinks: 0 }];
    if (team.id !== change.id) return [team];
    switch (change.type) {
      case "team-renamed": return [{ ...team, name: change.name }];
      case "team-color-set": return [{ ...team, color: change.color }];
      case "drinks-set": return [{ ...team, drinks: change.drinks }];
      case "drinks-adjusted": return [{ ...team, drinks: team.drinks + change.amount }];
      case "team-removed": return [];
    }
  });
  return { ...state, teams, updatedAt: occurredAt };
}

function leaderIds(state: Scoreboard): string[] {
  const highest = Math.max(...state.teams.map(({ drinks }) => drinks));
  return highest > 0 ? state.teams.filter(({ drinks }) => drinks === highest).map(({ id }) => id).sort() : [];
}

export function deriveSituations(previous: Scoreboard, next: Scoreboard, event: StoredEvent): SituationEvent[] {
  const metadata = { sourceEventId: event.id, occurredAt: event.occurredAt };
  const events: SituationEvent[] = [];
  const previousLeaderIds = leaderIds(previous);
  const nextLeaderIds = leaderIds(next);
  if (JSON.stringify(previousLeaderIds) !== JSON.stringify(nextLeaderIds)) {
    events.push({ ...metadata, type: "leaders-changed", previousLeaderIds, leaderIds: nextLeaderIds });
  }
  if (event.change.type !== "drinks-set" && event.change.type !== "drinks-adjusted") return events;

  for (const team of next.teams) {
    const old = previous.teams.find(({ id }) => id === team.id);
    if (!old || team.drinks <= old.drinks) continue;
    const milestone = Math.floor(team.drinks / 50) * 50;
    if (milestone > old.drinks) events.push({ ...metadata, type: "team-milestone", teamId: team.id, milestone });
  }
  return events;
}
