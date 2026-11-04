import { expect, test } from "bun:test";
import { followingIdleChart, idleDisplayDelay } from "./idleDisplay";

test("waits a full minute on the normal scoreboard and displays each idle chart for 30 seconds", () => {
  expect(idleDisplayDelay("scoreboard")).toBe(60_000);
  expect(idleDisplayDelay("recent")).toBe(30_000);
  expect(idleDisplayDelay("leaders")).toBe(30_000);
});

test("alternates charts across idle visits, rather than switching straight between charts", () => {
  expect(followingIdleChart("recent")).toBe("leaders");
  expect(followingIdleChart("leaders")).toBe("recent");
});
