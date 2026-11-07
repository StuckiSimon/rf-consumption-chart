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

test("explains accumulated leadership time and tied leadership", () => {
  const messages = mickyMessages("leaders", scoreboard).join(" ");
  expect(messages).toContain("wie lang jedi Gruppe insgesamt uf Platz 1 gsi isch");
  expect(messages).toContain("gliichziitig Ziit");
});

test("reacts to updates but not initialization or unrelated team edits", () => {
  expect(mickyReaction(null, scoreboard)).toBeNull();
  expect(mickyReaction(scoreboard, { ...scoreboard, updatedAt: "2026-10-31T20:01:00.000Z" })).toBeNull();
  const updated = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: team.drinks + 1 })) };
  expect(mickyReaction(scoreboard, updated)).toContain("Alpha und Beta");
  const reset = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: 0 })) };
  expect(mickyReaction(scoreboard, reset)).toContain("wieder uf null");
});

test("varies score increase reactions and names only the teams whose counts increased", () => {
  const updated = { ...scoreboard, teams: scoreboard.teams.map((team) => ({
    ...team, drinks: team.drinks + (team.id === "a" ? 1 : -1),
  })) };
  const first = mickyReaction(scoreboard, updated, null, () => 0);
  const middle = mickyReaction(scoreboard, updated, null, () => 0.5);
  const last = mickyReaction(scoreboard, updated, null, () => 0.999);
  expect(first).toBe("Alpha: Notiert! Min Taschenrechner het kei Pause.");
  expect(middle).toStartWith("Alpha: ");
  expect(last).toStartWith("Alpha: ");
  expect(new Set([first, middle, last]).size).toBe(3);
});

test("prioritizes milestones and leadership events over generic score updates", () => {
  const base = { sourceEventId: 1, occurredAt: scoreboard.updatedAt };
  const updated = { ...scoreboard, teams: scoreboard.teams.map((team) => ({ ...team, drinks: team.drinks + 1 })) };
  expect(mickyReaction(scoreboard, updated, {
    ...base, type: "team-milestone", teamId: "a", milestone: 100,
  })).toContain("Alpha hend 100 Shots erreicht");
  expect(mickyReaction(scoreboard, updated, {
    ...base, type: "leaders-changed", previousLeaderIds: ["a"], leaderIds: ["b"],
  })).toContain("Beta übernehmet d Spitze");
  expect(mickyReaction(scoreboard, updated, {
    ...base, type: "leaders-changed", previousLeaderIds: ["a"], leaderIds: ["a", "b"],
  })).toContain("Jetzt teiled sich Alpha und Beta de Platz 1");
});
