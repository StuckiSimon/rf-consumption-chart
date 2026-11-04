import type { SituationEvent } from "./scoreboard";

export function eventAnimation(
  event: SituationEvent,
  random = Math.random,
): string {
  if (event.type !== "team-milestone")
    return event.leaderIds.length ? "happy-idle" : "idle";
  const tier = ((event.milestone - 50) % 200) + 50;
  const choices =
    tier === 50
      ? ["moonwalk", "dancing", "dancing-1"]
      : tier === 100
        ? ["silly-dancing", "salsa-dancing", "samba-dancing"]
        : tier === 150
          ? ["boxing", "boxing-1"]
          : ["drunk-walk"];
  return choices[Math.floor(random() * choices.length)]!;
}

//
