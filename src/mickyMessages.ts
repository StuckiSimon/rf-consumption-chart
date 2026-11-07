import type { DisplayMode } from "./idleDisplay";
import type { Scoreboard, SituationEvent } from "./scoreboard";

export function mickyReaction(
  previous: Scoreboard | null,
  next: Scoreboard,
  event?: SituationEvent | null,
  random = Math.random,
): string | null {
  if (event?.type === "team-milestone") {
    const team = next.teams.find(({ id }) => id === event.teamId);
    return team
      ? `${team.name} hend ${event.milestone.toLocaleString("de-CH")} Shots erreicht! Ich ha extra nomal nachezellt.`
      : null;
  }
  if (event?.type === "leaders-changed") {
    const leaders = next.teams.filter(({ id }) => event.leaderIds.includes(id));
    return leaders.length === 1
      ? `${leaders[0]!.name} übernehmet d Spitze! Ich rück de Stuehl zurecht.`
      : leaders.length > 1
        ? `Jetzt teiled sich ${leaders.map(({ name }) => name).join(" und ")} de Platz 1. Chli zämerutsche!`
        : "D Rangliste isch wieder offe. Ich reservier no nüt.";
  }
  if (!previous) return null;
  const increases = next.teams.filter((team) => {
    const old = previous.teams.find(({ id }) => id === team.id);
    return old && team.drinks > old.drinks;
  });
  if (increases.length) {
    const texts = [
      "Notiert! Min Taschenrechner het kei Pause.",
      "Da bewegt sich öppis! Und diesmal isch es nöd nume mis Tanzbei.",
      "Frisch verbuecht! Mini Buchhaltig het meh Rhythmus als mis Solo.",
      "D Rangliste isch aktualisiert. Min Bleistift brucht jetzt chli Wasser.",
      "Zack, i de Tabelle! So schnäll bin ich suscht nume bim Pause mache.",
    ];
    return `${increases.map(({ name }) => name).join(" und ")}: ${texts[Math.floor(random() * texts.length)]!}`;
  }
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
      "Das isch nöd de Gesamtstand: Älteri ihträg fallet nach 30 Minute use. Kei lebenslangi Rangliste!",
      "Korrekture nach unde und Resets ziehnd da kei bereits erfasste Shots ab. Gschicht isch Gschicht.",
      "Mini Erinnerig längt da genau 30 Minute. Für de Rest fröged bitte nöd mich.",
    ];
  }
  if (mode === "leaders") {
    return [
      "Da zellemer, wie lang jedi Gruppe insgesamt uf Platz 1 gsi isch.",
      "Bi Gleichstand sammled alli Gruppe a de Spitze gliichziitig Ziit.",
      "Da zellt d Ziit uf em Thron. S Chrönli isch us Karton, aber mit Liebi gmacht.",
    ];
  }
  if (!scoreboard) return ["D Rangliste wird grad glade. Ich suech no mini Brülle."];
  const highest = Math.max(0, ...scoreboard.teams.map(({ drinks }) => drinks));
  const leaders = scoreboard.teams.filter(({ drinks }) => drinks === highest);
  const standing =
    highest === 0
      ? "Alli Zähler sind uf null. No isch jede uf em Podest. Es wird chli eng."
      : leaders.length === 1
        ? `${leaders[0]!.name} isch aktuell uf Platz 1 mit ${highest.toLocaleString("de-CH")} Shots. S Chrönli sitzt, d Frisur liidet.`
        : `Gleichstand a de Spitze: ${leaders.map(({ name }) => name).join(" und ")} mit je ${highest.toLocaleString("de-CH")} Shots.`;
  return [
    "Hoi zäme! Ich bi de mit de Übersicht. Meistens.",
    standing,
    "Da gsehnd ihr de aktuelle Stand vo allne Gruppe. Kei Sorge, ich prüef nöd d Musiknote.",
    "I de Pause zeig ich eu d Statistik. Chli Zahle statt nume Blech.",
    "Ich ha de Rhythmus im Bluet und d Rangliste im Chopf. Eis devo stimmt meistens.",
    "Min Taschenrechner het meh Chnöpf als mis Fasnachtsgwändli. Und weniger Konfetti drin.",
    "D Trompete glänzt, d Zahle stimmed. Jetzt müesst nume no min Schnauz sitze.",
    "Wenn d Rangliste schräg usgseht, isch es villicht min Chopf. Ich ha chli mitgwippt.",
    "Mis Solo chunnt spöter. Es heisst «Bitte nöd uf de Bildschirm tätsche».",
    "De Bass gaht dur de Bode. Mini Buchhaltig bliibt trotzdem standhaft.",
    "Mini Tanzschritt sind streng geheim. Vor allem, will ich sie selber nöd verstah.",
    "Es Glas Wasser passt übrigens au wunderbar i d Hand. Ha ich persönlich usprobiert.",
    "Chli Pause, chli Wasser, chli d Füess sortiere. Au Legände müend mal sitze.",
    "De schönsti Gleichstand? Wenn alli im gliiche Takt klatsched. Rein theoretisch.",
  ];
}
