import type { DisplayMode } from "./idleDisplay";
import type { Scoreboard, SituationEvent } from "./scoreboard";

export function mickyReaction(
  previous: Scoreboard | null,
  next: Scoreboard,
  event?: SituationEvent | null,
): string | null {
  if (event?.type === "team-milestone") {
    const team = next.teams.find(({ id }) => id === event.teamId);
    return team
      ? `${team.name} het ${event.milestone.toLocaleString("de-CH")} Shots erreicht! Ich ha extra nomal nachezellt.`
      : null;
  }
  if (event?.type === "leaders-changed") {
    const leaders = next.teams.filter(({ id }) => event.leaderIds.includes(id));
    return leaders.length === 1
      ? `${leaders[0]!.name} übernimmt d Spitze! Ich rück de Stuehl zurecht.`
      : leaders.length > 1
        ? `Jetzt teiled sich ${leaders.map(({ name }) => name).join(" und ")} de Platz 1. Chli zämerutsche!`
        : "D Rangliste isch wieder offe. Ich reservier no nüt.";
  }
  if (!previous) return null;
  const increases = next.teams.filter((team) => {
    const old = previous.teams.find(({ id }) => id === team.id);
    return old && team.drinks > old.drinks;
  });
  if (increases.length)
    return `${increases.map(({ name }) => name).join(" und ")}: Notiert! Min Taschenrechner het kei Pause.`;
  if (
    previous.teams.some(({ drinks }) => drinks > 0) &&
    next.teams.every(({ drinks }) => drinks === 0)
  ) {
    return "D Zähler sind wieder uf null. Min Taschenrechner atmet uf.";
  }
  return null;
}

export function mickyMessages(
  mode: DisplayMode,
  scoreboard: Scoreboard | null,
): string[] {
  if (mode === "recent") {
    return [
      "Da gsehnd ihr die neu erfasste Shots vo de letschte 30 Minute. Ich führ Buech.",
      "Das isch nöd de Gesamtstand: Älteri Einträg falle nach 30 Minute use. Kei lebenslangi Rangliste!",
      "Korrekture nach unde und Resets ziehnd da kei bereits erfasste Shots ab. Gschicht isch Gschicht.",
    ];
  }
  if (mode === "leaders") {
    return [
      "Da zellemer, wie lang jedi Gruppe insgesamt uf Platz 1 gsi isch. D Stoppuhr isch neutral.",
      "Bi Gleichstand sammled alli Gruppe a de Spitze gliichziitig Ziit. Platz hets für alli.",
      scoreboard?.scoringStartedAt
        ? "D Ziit zählt erst ab em igstellte Start vo de Ziitwertig."
        : "Ohni igstellte Start zählt die ganz gspeichereti Ziit a de Spitze.",
      "Sind alli Zähler uf null, sammlet niemer Ziit. D bisherigi Ziit bliibt. Sogar d Stoppuhr macht Pause.",
    ];
  }
  if (!scoreboard) return ["D Rangliste wird grad glade. Ich suech no mini Brülle."];
  const highest = Math.max(0, ...scoreboard.teams.map(({ drinks }) => drinks));
  const leaders = scoreboard.teams.filter(({ drinks }) => drinks === highest);
  const standing =
    highest === 0
      ? "Alli Zähler sind uf null. No isch jede uf em Podest."
      : leaders.length === 1
        ? `${leaders[0]!.name} isch aktuell uf Platz 1 mit ${highest.toLocaleString("de-CH")} Shots.`
        : `Gleichstand a de Spitze: ${leaders.map(({ name }) => name).join(" und ")} mit je ${highest.toLocaleString("de-CH")} Shots.`;
  return [
    "Hoi zäme! Ich bi de mit de Übersicht. Meistens.",
    standing,
    "Da gsehnd ihr de aktuelle Stand vo allne Gruppe. Kei Sorge, ich prüef nöd d Musiknote.",
    "I de Pause zeig ich eu d Statistik. Chli Zahle statt nume Blech.",
  ];
}
