import { expect, test } from "bun:test";
import { mickyMessages, mickyReaction } from "./mickyMessages";
import type { Scoreboard } from "./scoreboard";

const scoreboard: Scoreboard = {
  updatedAt: "2026-10-31T20:00:00.000Z",
  teams: [
    { id: "a", name: "Alpha", drinks: 10, color: "#e40134" },
    { id: "b", name: "Beta", drinks: 5, color: "#fdc800" },
  ],
};

test("matches scoreboard messages to loading, empty counts, leaders and ties", () => {
  expect(mickyMessages("scoreboard", null).join(" ")).toContain("glade");
  expect(mickyMessages("scoreboard", scoreboard).join(" ")).toContain("Alpha isch aktuell uf Platz 1 mit 10 Shots");
  const tie = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: 10 })) };
  expect(mickyMessages("scoreboard", tie).join(" ")).toContain("Alpha und Beta mit je 10 Shots");
  const zero = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: 0 })) };
  expect(mickyMessages("scoreboard", zero).join(" ")).toContain("Alli Zähler sind uf null");
});

test("explains the rolling window instead of describing it as the overall total", () => {
  const messages = mickyMessages("recent", scoreboard).join(" ");
  expect(messages).toContain("letschte 30 Minute");
  expect(messages).toContain("nöd de Gesamtstand");
  expect(messages).toContain("Resets");
});

test("explains tied leadership and respects whether a scoring start is configured", () => {
  const messages = mickyMessages("leaders", scoreboard).join(" ");
  expect(messages).toContain("gliichziitig Ziit");
  expect(messages).toContain("ganz gspeichereti Ziit");
  const started = mickyMessages("leaders", { ...scoreboard, scoringStartedAt: scoreboard.updatedAt }).join(" ");
  expect(started).toContain("erst ab em igstellte Start");
  expect(started).not.toContain("ganz gspeichereti Ziit");
});

test("reacts to updates but not initialization or unrelated team edits", () => {
  expect(mickyReaction(null, scoreboard)).toBeNull();
  expect(mickyReaction(scoreboard, { ...scoreboard, updatedAt: "2026-10-31T20:01:00.000Z" })).toBeNull();
  const updated = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: team.drinks + 1 })) };
  expect(mickyReaction(scoreboard, updated)).toContain("Alpha und Beta");
  const reset = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: 0 })) };
  expect(mickyReaction(scoreboard, reset)).toContain("wieder uf null");
});

test("prioritizes milestones and leadership events over generic score updates", () => {
  const base = { sourceEventId: 1, occurredAt: scoreboard.updatedAt };
  expect(mickyReaction(scoreboard, scoreboard, {
    ...base, type: "team-milestone", teamId: "a", milestone: 100,
  })).toContain("Alpha het 100 Shots erreicht");
  expect(mickyReaction(scoreboard, scoreboard, {
    ...base, type: "leaders-changed", previousLeaderIds: ["a"], leaderIds: ["b"],
  })).toContain("Beta übernimmt d Spitze");
  expect(mickyReaction(scoreboard, scoreboard, {
    ...base, type: "leaders-changed", previousLeaderIds: ["a"], leaderIds: ["a", "b"],
  })).toContain("Alpha und Beta");
});
