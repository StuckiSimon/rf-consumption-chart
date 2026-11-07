import { expect, test } from "bun:test";
import { eventAnimation } from "./eventAnimation";

test("selects the requested animation sets for milestone tiers", () => {
  const milestone = (value: number, random: number) => eventAnimation({
    type: "team-milestone", teamId: "a", milestone: value,
    sourceEventId: 1, occurredAt: "2026-10-31T20:00:00.000Z",
  }, () => random);
  expect(milestone(50, 0)).toBe("moonwalk");
  expect(milestone(50, 0.5)).toBe("dancing");
  expect(milestone(50, 0.9)).toBe("dancing-1");
  expect(milestone(100, 0)).toBe("silly-dancing");
  expect(milestone(100, 0.5)).toBe("salsa-dancing");
  expect(milestone(100, 0.9)).toBe("samba-dancing");
  expect(milestone(150, 0)).toBe("boxing");
  expect(milestone(150, 0.9)).toBe("boxing-1");
  expect(milestone(200, 0)).toBe("drunk-walk");
  expect(milestone(250, 0)).toBe("moonwalk");
  expect(milestone(300, 0.9)).toBe("samba-dancing");
});
