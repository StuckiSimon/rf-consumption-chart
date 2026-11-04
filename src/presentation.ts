import type { Scoreboard, Team } from "./scoreboard";

export function increasedTeams(previous: Scoreboard | null, next: Scoreboard): Team[] {
  return next.teams.filter((team) => {
    const old = previous?.teams.find(({ id }) => id === team.id);
    return old !== undefined && team.drinks > old.drinks;
  });
}

export function countStepDuration(difference: number): number {
  return Math.max(20, Math.min(500, 600 / difference));
}

export function isRowVisible(rect: Pick<DOMRect, "top" | "bottom">, viewportHeight: number): boolean {
  return rect.top >= 24 && rect.bottom <= viewportHeight - 24;
}

export function presentationDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function scrollPresentation(top: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const start = window.scrollY;
    const destination = Math.max(0, Math.min(top, document.documentElement.scrollHeight - window.innerHeight));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(destination - start) < 1) {
      window.scrollTo({ top: destination, behavior: "instant" });
      resolve();
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const scroll = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 800);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      window.scrollTo({ top: start + (destination - start) * eased, behavior: "instant" });
      if (progress === 1) finish();
      else frame = requestAnimationFrame(scroll);
    };
    signal.addEventListener("abort", finish, { once: true });
    frame = requestAnimationFrame(scroll);
  });
}
